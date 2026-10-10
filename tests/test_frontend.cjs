/* Dependency-free integration tests for the browser script with a small DOM/timer adapter. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'static/js/script.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'static/index.html'), 'utf8');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'static/sample_result.json'), 'utf8'));

// Only the DOM operations used by the page are modeled; this does not test layout.
class Node {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.listeners = {};
    this.className = ''; this.style = {}; this.dataset = {}; this.value = '';
    this._text = ''; this.disabled = false;
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(n => n.textContent).join(''); }
  set value(value) { this._value = String(value); }
  get value() { return this._value; }
  get firstChild() { return this.children[0]; }
  get classList() { return { contains: name => this.className.split(' ').includes(name) }; }
  set innerHTML(_) { throw new Error('Use text-safe DOM rendering.'); }
  append(...nodes) { nodes.forEach(n => { n.parent = this; this.children.push(n); }); }
  replaceChildren(...nodes) { this._text = ''; this.children = []; this.append(...nodes); }
  remove() { this.parent.children = this.parent.children.filter(n => n !== this); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type) {
    for (const fn of this.listeners[type] || []) fn({ target: this });
    if (this.parent) this.parent.dispatch(type);
  }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.classList.contains(selector.slice(1))) return child;
      const match = child.querySelector(selector);
      if (match) return match;
    }
    return null;
  }
}

function setup() {
  const nodes = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Node()]));
  nodes.speed.value = '1';
  const timers = new Map();
  let nextTimer = 0;
  const context = vm.createContext({
    document: { getElementById: id => nodes[id], createElement: tag => new Node(tag), documentElement: new Node('html') },
    localStorage: { getItem: () => null, setItem: () => {} }, AbortController,
    setTimeout: (fn, delay) => { timers.set(++nextTimer, { fn, delay }); return nextTimer; },
    clearTimeout: id => timers.delete(id),
    fetch: async () => ({ ok: true, status: 200, json: async () => structuredClone(fixture) })
  });
  vm.runInContext(script, context);
  const run = code => vm.runInContext(code, context);
  return { nodes, timers, context, run, tick() {
    const [id, timer] = timers.entries().next().value;
    timers.delete(id); timer.fn();
  } };
}
const plain = value => JSON.parse(JSON.stringify(value));
function fillRow(env, pid, arrival, burst, index = 0) {
  const row = env.nodes.processRows.children[index];
  row.querySelector('.pid-input').value = pid;
  row.querySelector('.at-input').value = arrival;
  row.querySelector('.bt-input').value = burst;
}
async function reference(env) { env.run('loadSample()'); await env.run('runSRTF()'); }

// Full response replay must agree with the canonical backend fixture at every clock boundary.
test('reference request, tick snapshots, chronological events, metrics and proportional Gantt', async () => {
  const e = setup(); let request;
  e.context.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => fixture };
  };
  await reference(e);
  assert.equal(request.url, '/simulate');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(request.options.body).processes, plain(e.run('SAMPLE')));
  assert.equal(e.nodes.avgWT.textContent, '—');
  const expectedEvents = [];
  for (let time = 0; time <= fixture.steps.length; time++) {
    if (time > 0) expectedEvents.push(...fixture.steps[time - 1].events.filter(event => event.at === time));
    if (time < fixture.steps.length) {
      const step = fixture.steps[time];
      expectedEvents.push(...step.events.filter(event => event.at === time));
      assert.equal(e.nodes.cpuState.textContent, step.running);
      assert.equal(e.nodes.remainingWork.textContent, `${step.remaining[step.running]} units remaining`);
      assert.deepEqual(e.nodes.readyQueue.children.map(n => n.textContent), step.ready.length
        ? step.ready.map(pid => `${pid} · ${step.remaining[pid]} left`) : ['No waiting processes.']);
    }
    assert.equal(e.nodes.currentTime.textContent, String(time));
    assert.deepEqual(e.nodes.logContainer.children.map(row => row.textContent), expectedEvents.map(event => `t = ${event.at}${event.text}`));
    if (time < fixture.steps.length) e.run('advance()');
  }
  assert.equal(e.nodes.avgWT.textContent, '6.50');
  assert.equal(e.nodes.avgTAT.textContent, '13.00');
  assert.equal(e.nodes.avgRT.textContent, '4.25');
  assert.equal(e.nodes.cpuUtil.textContent, '100.00%');
  assert.deepEqual(e.nodes.resultsBody.children.map(row => row.children[0].textContent), ['P1', 'P2', 'P3', 'P4']);
  const blocks = e.nodes.gantt.firstChild.children;
  assert.deepEqual(blocks.map(n => [n.firstChild.textContent, n.style.left, n.style.width]), fixture.gantt.map(b => [b.pid, `${b.start * 48}px`, `${(b.end - b.start) * 48}px`]));
  assert.ok(blocks[1].classList.contains('preempted'));
  assert.equal(blocks.at(-1).children.at(-1).textContent, '26');
  assert.ok(e.nodes.playBtn.disabled && e.nodes.stepBtn.disabled && e.nodes.pauseBtn.disabled);
});

test('one filled row is accepted among five defaults and PIDs are trimmed', () => {
  const e = setup();
  fillRow(e, ' custom ', '0', '2');
  assert.deepEqual(plain(e.run('getProcessesFromInputs()')), [{ pid: 'custom', arrival: 0, burst: 2 }]);
  assert.equal(e.nodes.processRows.firstChild.querySelector('.pid-input').value, 'custom');
});

for (const count of [1, 5, 15]) test(`${count} processes map exactly and row limit is enforced`, () => {
  const e = setup(); e.run('clearAll()');
  for (let i = 0; i < count; i++) e.run(`addRow('job${i}', 0, 1)`);
  assert.equal(e.run('getProcessesFromInputs().length'), count);
  if (count === 15) { e.run('addRow()'); assert.equal(e.nodes.processRows.children.length, 15); assert.ok(e.nodes.addRowBtn.disabled); }
});

test('validation still rejects over fifteen populated rows if the UI is bypassed', () => {
  const e = setup(); e.run('clearAll()');
  for (let i = 0; i < 15; i++) e.run(`addRow('job${i}', 0, 1)`);
  const row = new Node();
  for (const [name, value] of [['pid-input', 'extra'], ['at-input', '0'], ['bt-input', '1']]) {
    const input = new Node('input'); input.className = name; input.value = value; row.append(input);
  }
  e.nodes.processRows.append(row);
  assert.throws(() => e.run('getProcessesFromInputs()'), /maximum of 15/);
});

for (const [pid, arrival, burst, message] of [
  ['', '0', '1', /PID/], ['IDLE', '0', '1', /reserved/], ['x'.repeat(33), '0', '1', /32/],
  ['P1', '', '1', /Arrival/], ['P1', '0', '', /Burst/], ['P1', '-1', '1', /Arrival/],
  ['P1', '0', '0', /Burst/], ['P1', '1.5', '1', /Arrival/], ['P1', '0', '1.5', /Burst/],
  ['P1', '1e2', '1', /Arrival/], ['P1', '0x10', '1', /Arrival/], ['P1', 'NaN', '1', /Arrival/],
  ['P1', '0', 'Infinity', /Burst/], ['P1', '9007199254740992', '1', /Arrival/],
  ['P1', '0', '9007199254740992', /Burst/]
]) test(`invalid input ${JSON.stringify([pid, arrival, burst])}`, () => {
  const e = setup(); fillRow(e, pid, arrival, burst);
  assert.throws(() => e.run('getProcessesFromInputs()'), message);
});

test('empty workloads, partial rows and trimmed duplicates are rejected', () => {
  const e = setup(); assert.throws(() => e.run('getProcessesFromInputs()'), /at least one/);
  fillRow(e, 'P1', '0', '1'); fillRow(e, ' P1 ', '1', '2', 1);
  assert.throws(() => e.run('getProcessesFromInputs()'), /Duplicate PID/);
});

test('delete and add preserve unrelated PID identity', () => {
  const e = setup(); e.nodes.processRows.children[1].children[3].dispatch('click');
  assert.deepEqual(e.nodes.processRows.children.map(row => row.firstChild.value), ['P1', 'P3', 'P4', 'P5']);
  e.run('addRow()');
  assert.deepEqual(e.nodes.processRows.children.map(row => row.firstChild.value), ['P1', 'P3', 'P4', 'P5', 'P2']);
});

for (const [name, response, pattern] of [
  ['400', { ok: false, status: 400, json: async () => ({ error: 'Bad workload' }) }, /Bad workload/],
  ['413', { ok: false, status: 413, json: async () => ({}) }, /too large/],
  ['500 JSON', { ok: false, status: 500, json: async () => null }, /HTTP 500/],
  ['non-JSON 500', { ok: false, status: 500, json: async () => { throw new SyntaxError(); } }, /non-JSON.*500/],
  ['non-JSON 200', { ok: true, status: 200, json: async () => { throw new SyntaxError(); } }, /non-JSON.*200/],
  ['invalid shape', { ok: true, status: 200, json: async () => ({}) }, /invalid simulation/],
  ['connection failure', null, /Could not reach/]
]) test(`${name} is handled and previous results are cleared`, async () => {
  const e = setup(); await reference(e); e.run('advance()');
  e.context.fetch = async () => { if (!response) throw new TypeError('Failed to fetch'); return response; };
  await e.run('runSRTF()');
  assert.match(e.nodes.error.textContent, pattern);
  assert.equal(e.run('state.result'), null);
  assert.equal(e.nodes.avgWT.textContent, '—');
  assert.equal(e.nodes.currentTime.textContent, '0');
  assert.ok(!e.nodes.runBtn.disabled && e.nodes.playBtn.disabled);
});

for (const mutation of [
  data => { delete data.metrics.P1; }, data => { data.averages.waiting = '6.5'; },
  data => { data.steps[0].remaining = {}; }, data => { data.steps[0].ready = ['unknown']; },
  data => { data.steps[0].events[0].at = 9; }, data => { data.gantt[0].end = 2; },
  data => { data.steps[0] = null; }, data => { data.gantt = []; }
]) test('malformed response fields are rejected before rendering', async () => {
  const e = setup(); const data = structuredClone(fixture); mutation(data);
  e.context.fetch = async () => ({ ok: true, status: 200, json: async () => data });
  await reference(e);
  assert.match(e.nodes.error.textContent, /invalid simulation/);
  assert.equal(e.run('state.result'), null);
});

// Deferred fetches deliberately ignore abort to prove generation guards work too.
for (const action of ['clearAll()', 'resetPlayback()', 'loadSample()', 'addRow()', 'invalidate()']) {
  test(`${action} cancels a pending request; repeated Run does not submit twice`, async () => {
    const e = setup(); e.run('loadSample()'); let resolve, signal, calls = 0;
    e.context.fetch = (_, options) => { calls++; signal = options.signal; return new Promise(r => { resolve = r; }); };
    const pending = e.run('runSRTF()'); await e.run('runSRTF()');
    assert.equal(calls, 1); assert.ok(e.nodes.runBtn.disabled);
    e.run(action); assert.ok(signal.aborted);
    resolve({ ok: true, status: 200, json: async () => fixture }); await pending;
    assert.equal(e.run('state.result'), null); assert.equal(e.nodes.error.textContent, '');
    assert.ok(e.nodes.playBtn.disabled);
  });
}

test('older response cannot replace newer results or clear a newer pending request', async () => {
  const e = setup(); e.run('loadSample()'); const resolvers = [];
  e.context.fetch = () => new Promise(resolve => resolvers.push(resolve));
  const first = e.run('runSRTF()'); e.run('loadSample()'); const second = e.run('runSRTF()');
  resolvers[0]({ ok: false, status: 400, json: async () => ({ error: 'old failure' }) }); await first;
  assert.ok(e.nodes.runBtn.disabled); assert.equal(e.nodes.error.textContent, '');
  resolvers[1]({ ok: true, status: 200, json: async () => fixture }); await second;
  assert.equal(e.nodes.cpuState.textContent, 'P1'); assert.ok(!e.nodes.runBtn.disabled);
});

test('play/pause/step/reset/speed use one timer and never duplicate start events', async () => {
  const e = setup(); await reference(e); const initialLog = e.nodes.logContainer.textContent;
  e.run('play(); play()'); assert.equal(e.timers.size, 1); assert.ok(e.nodes.stepBtn.disabled);
  e.nodes.speed.value = '20'; e.nodes.speed.dispatch('input');
  assert.equal(e.timers.size, 1); assert.equal([...e.timers.values()][0].delay, 50);
  e.tick(); assert.equal(e.nodes.currentTime.textContent, '1'); assert.equal(e.timers.size, 1);
  e.run('pause()'); assert.equal(e.timers.size, 0);
  e.run('advance()'); assert.equal(e.nodes.currentTime.textContent, '2');
  e.run('play(); resetPlayback()'); assert.equal(e.timers.size, 0);
  assert.equal(e.nodes.currentTime.textContent, '0'); assert.equal(e.nodes.logContainer.textContent, initialLog);
  e.run('play()'); while (e.timers.size) e.tick();
  assert.equal(e.nodes.currentTime.textContent, '26'); assert.ok(!e.run('state.playing'));
});

test('input events stop playback and invalidate existing results', async () => {
  const e = setup(); await reference(e); e.run('play()');
  e.nodes.processRows.firstChild.querySelector('.at-input').dispatch('input');
  assert.equal(e.timers.size, 0); assert.equal(e.run('state.result'), null);
});

// A small recorded idle response tests CPU state and completion-at-end without a JS scheduler.
test('delayed one-process response replays idle and completion accurately', async () => {
  const e = setup(); e.run('clearAll(); addRow("job", 2, 1)');
  const data = {
    steps: [0, 1, 2].map(time => ({ time, running: time < 2 ? 'IDLE' : 'job', ready: [], remaining: { job: 1 },
      events: time < 2 ? [{ type: 'idle', at: time, pid: null, text: 'CPU idle' }]
        : [{ type: 'arrival', at: 2, pid: 'job', text: 'job arrived' }, { type: 'complete', at: 3, pid: 'job', text: 'job completed' }] })),
    gantt: [{ pid: 'IDLE', start: 0, end: 2 }, { pid: 'job', start: 2, end: 3 }],
    metrics: { job: { completion: 3, turnaround: 1, waiting: 0, response: 0 } },
    averages: { turnaround: 1, waiting: 0, response: 0 }
  };
  e.context.fetch = async () => ({ ok: true, status: 200, json: async () => data });
  await e.run('runSRTF()'); assert.equal(e.nodes.cpuState.textContent, 'IDLE');
  e.run('advance(); advance()'); assert.doesNotMatch(e.nodes.logContainer.textContent, /completed/);
  assert.equal(e.nodes.cpuState.textContent, 'job');
  e.run('advance()'); assert.match(e.nodes.logContainer.textContent, /t = 3job completed/);
  assert.ok(e.nodes.gantt.firstChild.firstChild.classList.contains('idle'));
  assert.equal(e.nodes.cpuUtil.textContent, '33.33%');
});

test('HTML-like PIDs, special object keys, and API text are rendered as literal text', async () => {
  const e = setup(); const pid = '<img src=x onerror=alert(1)>';
  const data = JSON.parse(JSON.stringify(fixture).replaceAll('P1', pid).replaceAll('P2', '__proto__'));
  e.run('loadSample()'); fillRow(e, pid, '0', '8'); fillRow(e, '__proto__', '1', '4', 1);
  e.context.fetch = async () => ({ ok: true, status: 200, json: async () => data });
  await e.run('runSRTF()'); e.run('while (state.time < state.result.steps.length) advance()');
  assert.equal(e.nodes.resultsBody.firstChild.firstChild.textContent, pid);
  assert.match(e.nodes.logContainer.textContent, /<img src=x onerror=alert\(1\)>/);
});

test('PID length counts Unicode characters like Python and theme tolerates denied storage', () => {
  const e = setup(); fillRow(e, '😀'.repeat(32), '0', '1');
  assert.equal(e.run('getProcessesFromInputs().length'), 1);
  e.context.localStorage.setItem = () => { throw new Error('denied'); };
  e.run('toggleTheme()'); assert.equal(e.context.document.documentElement.dataset.theme, 'dark');
});

// Optional real HTTP checks reuse the same page controller and the running Flask server.
const serverURL = process.env.SRTF_TEST_URL;
for (const [name, processes] of [
  ['one', [{ pid: 'solo', arrival: 0, burst: 1 }]],
  ['five at zero', Array.from({ length: 5 }, (_, i) => ({ pid: `P${i + 1}`, arrival: 0, burst: i + 1 }))],
  ['fifteen', Array.from({ length: 15 }, (_, i) => ({ pid: `P${i + 1}`, arrival: i, burst: 2 }))],
  ['equal remaining', [{ pid: 'P1', arrival: 0, burst: 3 }, { pid: 'P2', arrival: 1, burst: 2 }]],
  ['completion before arrival', [{ pid: 'A', arrival: 0, burst: 1 }, { pid: 'B', arrival: 1, burst: 1 }]],
  ['delayed first arrival', [{ pid: 'late', arrival: 3, burst: 2 }]],
  ['reference', [{ pid: 'P1', arrival: 0, burst: 8 }, { pid: 'P2', arrival: 1, burst: 4 }, { pid: 'P3', arrival: 2, burst: 9 }, { pid: 'P4', arrival: 3, burst: 5 }]]
]) test(`live Flask: ${name}`, { skip: !serverURL }, async () => {
  const e = setup(); e.run('clearAll()'); let responseData;
  for (const process of processes) e.run(`addRow(${JSON.stringify(process.pid)}, ${process.arrival}, ${process.burst})`);
  e.context.fetch = async (url, options) => {
    const response = await fetch(new URL(url, serverURL), options);
    responseData = await response.json();
    return { ok: response.ok, status: response.status, json: async () => responseData };
  };
  await e.run('runSRTF()');
  assert.equal(e.nodes.error.textContent, ''); assert.ok(e.run('state.result'));
  e.run('play()'); while (e.timers.size) e.tick();
  assert.deepEqual(e.nodes.gantt.firstChild.children.map(n => [n.firstChild.textContent, n.style.left, n.style.width]), responseData.gantt.map(b => [b.pid, `${b.start * 48}px`, `${(b.end - b.start) * 48}px`]));
  assert.deepEqual(e.nodes.logContainer.children.map(n => n.textContent), responseData.steps.flatMap(s => s.events).map(event => `t = ${event.at}${event.text}`));
  assert.equal(e.nodes.avgWT.textContent, responseData.averages.waiting.toFixed(2));
  if (name === 'reference') assert.deepEqual(responseData, fixture);
});

test('ten-thousand-tick playback stays cancellable with one timer', async () => {
  const e = setup(); e.run('clearAll(); addRow("late", 9999, 1)');
  const data = {
    steps: Array.from({ length: 10000 }, (_, time) => ({ time, running: time < 9999 ? 'IDLE' : 'late', ready: [], remaining: { late: 1 },
      events: time < 9999 ? [{ type: 'idle', at: time, pid: null, text: 'CPU idle' }]
        : [{ type: 'arrival', at: 9999, pid: 'late', text: 'late arrived' }, { type: 'complete', at: 10000, pid: 'late', text: 'late completed' }] })),
    gantt: [{ pid: 'IDLE', start: 0, end: 9999 }, { pid: 'late', start: 9999, end: 10000 }],
    metrics: { late: { completion: 10000, turnaround: 1, waiting: 0, response: 0 } },
    averages: { turnaround: 1, waiting: 0, response: 0 }
  };
  e.context.fetch = async () => ({ ok: true, status: 200, json: async () => data });
  await e.run('runSRTF()'); e.run('play()');
  for (let i = 0; i < 10000; i++) { assert.equal(e.timers.size, 1); e.tick(); }
  assert.equal(e.timers.size, 0); assert.equal(e.nodes.currentTime.textContent, '10000');
  assert.equal(e.nodes.gantt.firstChild.children[0].style.width, `${9999 * 48}px`);
  assert.equal(e.nodes.logContainer.children.length, 10001);
  e.run('resetPlayback(); play(); clearAll()'); assert.equal(e.timers.size, 0);
});

test('a late success cannot overwrite a newer completed request', async () => {
  const e = setup(); e.run('loadSample()'); let resolveOld;
  e.context.fetch = () => new Promise(resolve => { resolveOld = resolve; });
  const oldRequest = e.run('runSRTF()'); e.run('loadSample()');
  e.context.fetch = async () => ({ ok: true, status: 200, json: async () => fixture });
  await e.run('runSRTF()'); e.run('advance()');
  resolveOld({ ok: true, status: 200, json: async () => fixture }); await oldRequest;
  assert.equal(e.nodes.currentTime.textContent, '1'); assert.equal(e.nodes.cpuState.textContent, 'P2');
});

test('cancellation also protects the asynchronous JSON parsing phase', async () => {
  const e = setup(); e.run('loadSample()'); let resolveJSON, started;
  const parsing = new Promise(resolve => { started = resolve; });
  e.context.fetch = async () => ({ ok: true, status: 200, json: () => new Promise(resolve => { resolveJSON = resolve; started(); }) });
  const pending = e.run('runSRTF()'); await parsing;
  e.run('clearAll()'); resolveJSON(fixture); await pending;
  assert.equal(e.run('state.result'), null); assert.equal(e.nodes.processRows.children.length, 0);
});

test('numeric PIDs keep submitted result order instead of object key order', async () => {
  const e = setup();
  const data = JSON.parse(JSON.stringify(fixture).replaceAll('P1', '10').replaceAll('P2', '2').replaceAll('P3', '1').replaceAll('P4', '3'));
  e.run('clearAll(); addRow("10", 0, 8); addRow("2", 1, 4); addRow("1", 2, 9); addRow("3", 3, 5)');
  e.context.fetch = async () => ({ ok: true, status: 200, json: async () => data });
  await e.run('runSRTF()'); e.run('while (state.time < state.result.steps.length) advance()');
  assert.deepEqual(e.nodes.resultsBody.children.map(row => row.firstChild.textContent), ['10', '2', '1', '3']);
});

test('preemption marker appears at the start boundary, before the new interval executes', async () => {
  const e = setup(); await reference(e); e.run('advance()');
  const marker = e.nodes.gantt.firstChild.children.at(-1);
  assert.ok(marker.classList.contains('preemption-marker')); assert.equal(marker.style.left, '48px');
  assert.equal(e.nodes.gantt.firstChild.children[0].style.width, '48px');
});
