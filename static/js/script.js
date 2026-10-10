/* Validate inputs and replay the Python timeline without scheduling locally. */
"use strict";
const $ = id => document.getElementById(id);
const state = {
  result: null, processes: [], time: 0, playing: false, timer: null,
  controller: null, version: 0, colors: new Map(), dark: false
};
const SAMPLE = [
  { pid: "P1", arrival: 0, burst: 8 }, { pid: "P2", arrival: 1, burst: 4 },
  { pid: "P3", arrival: 2, burst: 9 }, { pid: "P4", arrival: 3, burst: 5 }
];
const UNIT_WIDTH = 48;

// Variable text, including PIDs and server errors, enters the DOM only as text.
function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function init() {
  try { state.dark = localStorage.getItem("srtf-theme") === "dark"; } catch { /* Storage is optional. */ }
  applyTheme();
  for (const [id, handler] of Object.entries({
    addRowBtn: () => addRow(), runBtn: runSRTF, clearBtn: clearAll,
    resetBtn: resetPlayback, sampleBtn: loadSample, themeBtn: toggleTheme,
    playBtn: play, pauseBtn: pause, stepBtn: advance, endBtn: jumpToEnd
  })) $(id).addEventListener("click", handler);
  $("speed").addEventListener("input", () => {
    $("speedValue").textContent = `${$("speed").value}×`;
    if (state.playing) scheduleTick();
  });
  $("timelineSeek").addEventListener("input", () => seekToTime(Number($("timelineSeek").value)));
  $("processRows").addEventListener("input", invalidate);
  for (let i = 0; i < 5; i++) addRow();
  invalidate();
}

// Suggest an unused PID without renaming any existing row.
function addRow(pid, arrival = "", burst = "") {
  const container = $("processRows");
  if (container.children.length >= 15) return;
  invalidate();
  if (pid === undefined) {
    const used = new Set(Array.from(container.children, row => row.querySelector(".pid-input").value.trim()));
    let index = 1;
    while (used.has(`P${index}`)) index++;
    pid = `P${index}`;
  }
  const row = element("div", "process-input-row");
  for (const [className, value, label] of [
    ["pid-input", pid, "Process ID"], ["at-input", arrival, "Arrival time"], ["bt-input", burst, "Burst time"]
  ]) {
    const input = element("input", className);
    // Text inputs retain malformed numeric text, so it cannot become a skipped blank row.
    input.type = "text";
    input.value = value;
    input.setAttribute("aria-label", `${label}, row ${container.children.length + 1}`);
    if (className !== "pid-input") input.inputMode = "numeric";
    input.placeholder = className === "at-input" ? "0" : className === "bt-input" ? "5" : "PID";
    row.append(input);
  }
  const remove = element("button", "row-del-btn", "×");
  remove.title = "Remove process";
  remove.setAttribute("aria-label", "Remove process");
  remove.addEventListener("click", () => { row.remove(); updateRowLabels(); invalidate(); });
  row.append(remove);
  container.append(row);
  updateRowLabels();
  updateControls();
}

// Give repeated fields a distinct accessible name after add/remove.
function updateRowLabels() {
  for (const [index, row] of Array.from($("processRows").children).entries()) {
    for (const [selector, name] of [[".pid-input", "Process ID"], [".at-input", "Arrival time"], [".bt-input", "Burst time"]]) {
      row.querySelector(selector).setAttribute("aria-label", `${name}, row ${index + 1}`);
    }
  }
}

// Ignore unused rows with both time fields blank; validate every partial row.
function getProcessesFromInputs() {
  const processes = [];
  const seen = new Set();
  for (const [index, row] of Array.from($("processRows").children).entries()) {
    const pidInput = row.querySelector(".pid-input");
    const pid = pidInput.value.trim();
    const arrivalText = row.querySelector(".at-input").value.trim();
    const burstText = row.querySelector(".bt-input").value.trim();
    if (!arrivalText && !burstText) continue;
    const prefix = `Row ${index + 1}: `;
    if (!pid || Array.from(pid).length > 32) throw new Error(prefix + "PID must contain 1 to 32 characters.");
    if (pid === "IDLE") throw new Error(prefix + "PID IDLE is reserved for CPU idle time.");
    if (seen.has(pid)) throw new Error(prefix + `Duplicate PID: ${pid}.`);
    const arrival = Number(arrivalText);
    const burst = Number(burstText);
    if (!/^\d+$/.test(arrivalText) || !Number.isSafeInteger(arrival) || arrival < 0) {
      throw new Error(prefix + "Arrival time must be a safe whole number of 0 or more.");
    }
    if (!/^\d+$/.test(burstText) || !Number.isSafeInteger(burst) || burst < 1) {
      throw new Error(prefix + "Burst time must be a safe whole number of 1 or more.");
    }
    seen.add(pid);
    pidInput.value = pid;
    processes.push({ pid, arrival, burst });
  }
  if (!processes.length) throw new Error("Add at least one process with arrival and burst times.");
  if (processes.length > 15) throw new Error("A maximum of 15 processes is allowed.");
  return processes;
}

function clearAll() {
  $("processRows").replaceChildren();
  invalidate();
}

function loadSample() {
  clearAll();
  SAMPLE.forEach(p => addRow(p.pid, p.arrival, p.burst));
}

// Clear inline field errors when an input changes or the user starts over.
function clearFieldErrors() {
  for (const row of $("processRows").children) {
    for (const selector of [".pid-input", ".at-input", ".bt-input"]) {
      const input = row.querySelector(selector);
      input.className = input.className.replace(/\s*field-error\b/g, "");
      input.setAttribute("aria-invalid", "false");
    }
  }
}

// Identify the exact invalid field without replacing its original error message.
function highlightInvalidField(message) {
  clearFieldErrors();
  const match = /^Row (\d+):/.exec(message);
  if (!match) return;
  const row = $("processRows").children[Number(match[1]) - 1];
  if (!row) return;
  const selector = /PID|Duplicate/.test(message) ? ".pid-input"
    : /Arrival/.test(message) ? ".at-input" : /Burst/.test(message) ? ".bt-input" : null;
  if (!selector) return;
  const input = row.querySelector(selector);
  input.className += " field-error";
  input.setAttribute("aria-invalid", "true");
  if (typeof input.focus === "function") input.focus();
}

// Version checks also reject responses arriving after an abort or newer request.
function invalidate() {
  pause();
  clearFieldErrors();
  state.version++;
  if (state.controller) state.controller.abort();
  state.controller = null;
  state.result = null;
  state.processes = [];
  clearDisplay();
  $("error").textContent = "";
  $("statusText").textContent = "Run the scheduler to generate results.";
  updateControls();
}

function clearDisplay() {
  state.time = 0;
  for (const id of ["avgWT", "avgTAT", "avgRT", "cpuUtil", "timelineInfo", "cpuState", "remainingWork"]) $(id).textContent = "—";
  $("currentTime").textContent = "0";
  $("cpuState").style.borderColor = "";
  $("cpuState").className = "";
  $("readyQueue").replaceChildren(element("span", "chart-placeholder", "No waiting processes."));
  const row = element("tr");
  const cell = element("td", "table-empty", "Final results appear when playback finishes.");
  cell.colSpan = 7;
  row.append(cell);
  $("resultsBody").replaceChildren(row);
  $("gantt").className = "gantt empty-chart";
  $("gantt").replaceChildren(element("div", "chart-placeholder", "Your execution timeline will appear here."));
  $("gantt").scrollLeft = 0;
  $("logContainer").className = "log-container empty-log";
  $("logContainer").replaceChildren(element("div", "chart-placeholder", "Run the simulation to view execution events."));
}

// Check every field consumed by rendering without recomputing schedules or metrics.
function validateResponse(data, processes) {
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const pids = processes.map(p => p.pid);
  const known = pid => pids.includes(pid);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const require = condition => { if (!condition) throw new Error("The server returned an invalid simulation result. Please try again."); };
  require(object(data) && Array.isArray(data.steps) && data.steps.length > 0 && data.steps.length <= 10000);
  require(Array.isArray(data.gantt) && data.gantt.length > 0 && object(data.metrics) && object(data.averages));
  data.steps.forEach((step, index) => {
    require(object(step) && step.time === index && (known(step.running) || step.running === "IDLE"));
    require(Array.isArray(step.ready) && step.ready.every(pid => known(pid) && pid !== step.running)
      && new Set(step.ready).size === step.ready.length);
    require(object(step.remaining) && pids.every(pid => own(step.remaining, pid) && integer(step.remaining[pid])));
    require(Array.isArray(step.events));
    step.events.forEach(event => {
      require(object(event) && ["arrival", "preempt", "complete", "idle"].includes(event.type) && typeof event.text === "string");
      require(event.at === index + (event.type === "complete" ? 1 : 0));
      require(event.type === "idle" ? event.pid === null : known(event.pid));
      if (event.type === "preempt") require(known(event.by));
    });
  });
  let end = 0;
  data.gantt.forEach(block => {
    require(object(block) && (known(block.pid) || block.pid === "IDLE")
      && block.start === end && integer(block.end) && block.end > end && block.end <= data.steps.length);
    for (let time = block.start; time < block.end; time++) require(data.steps[time].running === block.pid);
    end = block.end;
  });
  require(end === data.steps.length);
  pids.forEach(pid => require(own(data.metrics, pid) && object(data.metrics[pid])
    && ["completion", "turnaround", "waiting", "response"].every(key => integer(data.metrics[pid][key]))));
  require(["waiting", "turnaround", "response"].every(key => Number.isFinite(data.averages[key]) && data.averages[key] >= 0));
}

async function runSRTF() {
  if (state.controller) return;
  invalidate();
  const version = state.version;
  try {
    const processes = getProcessesFromInputs();
    state.controller = new AbortController();
    $("statusText").textContent = "Requesting simulation…";
    updateControls();
    let response;
    try {
      response = await fetch("/simulate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ processes }), signal: state.controller.signal
      });
    } catch (error) {
      if (error.name === "AbortError") throw error;
      throw new Error("Could not reach the simulator server. Is app.py running?");
    }
    let data;
    try { data = await response.json(); } catch {
      throw new Error(`The server returned a non-JSON response (HTTP ${response.status}). Please try again.`);
    }
    if (version !== state.version) return;
    if (!response.ok) {
      const fallback = response.status === 413 ? "Request body is too large (maximum 16 KB)."
        : response.status === 400 ? "The server rejected the process inputs." : "The server could not simulate this workload.";
      throw new Error(data && typeof data.error === "string" ? data.error : `${fallback} (HTTP ${response.status})`);
    }
    validateResponse(data, processes);
    state.processes = processes;
    state.result = data;
    state.colors = new Map(processes.map((p, index) => [p.pid, `hsl(${155 + index * 47} 55% 42%)`]));
    prepareStep();
  } catch (error) {
    if (version !== state.version || error.name === "AbortError") return;
    state.result = null;
    state.processes = [];
    clearDisplay();
    $("error").textContent = error.message;
    highlightInvalidField(error.message);
    $("statusText").textContent = "Simulation failed. Check the inputs or server and run again.";
  } finally {
    if (version === state.version) { state.controller = null; updateControls(); }
  }
}

function updateControls() {
  const pending = state.controller !== null;
  const playable = state.result !== null && state.time < state.result.steps.length;
  $("runBtn").disabled = pending || $("processRows").children.length === 0;
  $("playBtn").disabled = !playable || state.playing;
  $("pauseBtn").disabled = !state.playing;
  $("stepBtn").disabled = !playable || state.playing;
  $("resetBtn").disabled = !pending && !state.result;
  $("speed").disabled = !playable;
  $("addRowBtn").disabled = $("processRows").children.length >= 15;
  $("clearBtn").disabled = $("processRows").children.length === 0 && !pending && !state.result;
  const rows = Array.from($("processRows").children);
  const active = rows.filter(row => row.querySelector(".at-input").value.trim() || row.querySelector(".bt-input").value.trim()).length;
  $("processCount").textContent = `${active} active · ${rows.length}/15 rows`;
  $("endBtn").disabled = !state.result || state.time >= state.result.steps.length;
  $("timelineSeek").disabled = !state.result;
  $("timelineSeek").max = state.result ? String(state.result.steps.length) : "0";
  $("timelineSeek").value = String(state.time);
  $("timelineProgress").textContent = `${state.time} / ${state.result ? state.result.steps.length : 0}`;
}

// Only one timer is outstanding; speed changes replace it and pause cancels it.
function scheduleTick() {
  clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    if (!state.playing) return;
    advance();
    if (state.playing) scheduleTick();
  }, 1000 / Number($("speed").value));
}

function play() {
  if (!state.result || state.playing || state.time >= state.result.steps.length) return;
  state.playing = true;
  $("statusText").textContent = "Playing simulation.";
  updateControls();
  scheduleTick();
}

function pause() {
  clearTimeout(state.timer);
  state.timer = null;
  state.playing = false;
  if (state.result && state.time < state.result.steps.length) $("statusText").textContent = "Paused. Play or step forward to continue.";
  updateControls();
}

function resetPlayback() {
  if (state.controller) { invalidate(); return; }
  pause();
  clearDisplay();
  if (state.result) prepareStep();
  $("error").textContent = "";
  updateControls();
}

// Paint the current backend snapshot without duplicating earlier log events.
function renderSnapshot() {
  const step = state.result.steps[state.time];
  const arriving = new Set(step.events.filter(event => event.type === "arrival").map(event => event.pid));
  $("currentTime").textContent = step.time;
  const cpu = $("cpuState");
  cpu.textContent = step.running;
  cpu.className = step.events.some(event => event.type === "preempt") ? "cpu-preempt-flash"
    : arriving.has(step.running) ? "cpu-arrival-flash" : "";
  cpu.style.borderColor = state.colors.get(step.running) || "var(--muted)";
  $("remainingWork").textContent = step.running === "IDLE" ? "No process running" : `${step.remaining[step.running]} units remaining`;
  $("readyQueue").replaceChildren(...step.ready.map(pid => {
    const chip = element("span", arriving.has(pid) ? "queue-chip new-arrival" : "queue-chip", `${pid} · ${step.remaining[pid]} left`);
    chip.style.borderColor = state.colors.get(pid);
    return chip;
  }));
  if (!step.ready.length) $("readyQueue").append(element("span", "chart-placeholder", "No waiting processes."));
  $("statusText").textContent = state.playing ? "Playing simulation." : "Ready. Play or step forward to continue.";
}

// Show start events once; completions in this step stay hidden until its end.
function prepareStep() {
  renderSnapshot();
  const step = state.result.steps[state.time];
  appendEvents(step.events.filter(event => event.at === step.time));
}

// Finish the previous tick before showing the next tick's arrivals at the same time.
function advance() {
  if (!state.result || state.time >= state.result.steps.length) return;
  const step = state.result.steps[state.time];
  state.time++;
  $("currentTime").textContent = state.time;
  renderGantt();
  appendEvents(step.events.filter(event => event.at === state.time));
  if (state.time < state.result.steps.length) prepareStep();
  else showCompletedState();
  updateControls();
}

// Final metrics appear only when the timeline reaches the last boundary.
function showCompletedState() {
  pause();
  $("cpuState").className = "";
  $("cpuState").textContent = "Complete";
  $("remainingWork").textContent = "All processes finished";
  $("readyQueue").replaceChildren(element("span", "chart-placeholder", "No waiting processes."));
  renderResults();
  $("statusText").textContent = `Simulation complete · ${state.processes.length} processes scheduled`;
}

function appendEvents(events) {
  const container = $("logContainer");
  if (container.classList.contains("empty-log")) { container.replaceChildren(); container.className = "log-container"; }
  for (const event of events) {
    const last = container.children[container.children.length - 1];
    // Adjacent idle ticks share one visible interval; original events are untouched.
    if (event.type === "idle" && last && last.dataset.idleEnd === String(event.at)) {
      last.dataset.idleEnd = String(event.at + 1);
      last.children[0].textContent = `t = ${last.dataset.idleStart}–${event.at + 1}`;
      last.children[1].textContent = `CPU idle from t=${last.dataset.idleStart} to t=${event.at + 1}`;
      continue;
    }
    const row = element("div", `log-item event-${event.type}`);
    row.append(element("span", "log-time", `t = ${event.at}`), element("span", "log-msg", event.text));
    if (event.type === "idle") {
      row.dataset.idleStart = String(event.at);
      row.dataset.idleEnd = String(event.at + 1);
    }
    container.append(row);
  }
  container.scrollTop = container.scrollHeight;
}

// Clip backend Gantt intervals at the clock; do not infer CPU choices locally.
function renderGantt() {
  const chart = $("gantt");
  const track = element("div", "gantt-track");
  track.style.width = `${state.time * UNIT_WIDTH}px`;
  for (const block of state.result.gantt) {
    if (block.start >= state.time) break;
    const end = Math.min(block.end, state.time);
    const preempted = state.result.steps[block.start].events.some(event => event.type === "preempt");
    const node = element("div", `gantt-block${block.pid === "IDLE" ? " idle" : ""}${preempted ? " preempted" : ""}`);
    node.style.left = `${block.start * UNIT_WIDTH}px`;
    node.style.width = `${(end - block.start) * UNIT_WIDTH}px`;
    node.style.borderColor = state.colors.get(block.pid) || "var(--muted)";
    node.title = `${block.pid} [${block.start}–${end}]${preempted ? " · preemption" : ""}`;
    node.append(element("strong", "", block.pid), element("span", "dur", `${end - block.start} units`), element("span", "time-label time-start", block.start));
    if (end === state.time) node.append(element("span", "time-label time-end", end));
    track.append(node);
  }
  // A preemption at the current boundary is visible before its first CPU unit runs.
  const next = state.result.steps[state.time];
  if (next && next.events.some(event => event.type === "preempt")) {
    const marker = element("div", "preemption-marker");
    marker.style.left = `${state.time * UNIT_WIDTH}px`;
    marker.title = `Preemption at t = ${state.time}`;
    marker.setAttribute("aria-label", marker.title);
    track.append(marker);
  }
  chart.className = "gantt";
  chart.replaceChildren(track);
  chart.scrollLeft = chart.scrollWidth;
  $("timelineInfo").textContent = `0–${state.time} / ${state.result.steps.length} units`;
}

// Reconstruct one selected playback boundary directly from backend events.
function seekToTime(target) {
  if (!state.result || !Number.isFinite(target)) return;
  pause();
  const total = state.result.steps.length;
  const boundary = Math.max(0, Math.min(total, Math.trunc(target)));
  clearDisplay();
  state.time = boundary;
  $("currentTime").textContent = String(boundary);
  const events = [];
  for (let time = 0; time <= boundary; time++) {
    if (time > 0) events.push(...state.result.steps[time - 1].events.filter(event => event.at === time));
    if (time < total) events.push(...state.result.steps[time].events.filter(event => event.at === time));
  }
  appendEvents(events);
  if (boundary > 0) renderGantt();
  if (boundary < total) {
    renderSnapshot();
    $("statusText").textContent = `At t=${boundary}. Play or step forward to continue.`;
  } else showCompletedState();
  updateControls();
}

// Jump to the final result without creating thousands of timer callbacks.
function jumpToEnd() {
  if (state.result) seekToTime(state.result.steps.length);
}

function renderResults() {
  $("resultsBody").replaceChildren(...state.processes.map(process => {
    const metrics = state.result.metrics[process.pid];
    const row = element("tr");
    for (const value of [process.pid, process.arrival, process.burst, metrics.completion, metrics.turnaround, metrics.waiting, metrics.response]) row.append(element("td", "", value));
    row.firstChild.style.borderLeft = `3px solid ${state.colors.get(process.pid)}`;
    return row;
  }));
  $("avgWT").textContent = state.result.averages.waiting.toFixed(2);
  $("avgTAT").textContent = state.result.averages.turnaround.toFixed(2);
  $("avgRT").textContent = state.result.averages.response.toFixed(2);
  // Utilization is a display statistic from backend intervals, not a scheduling metric.
  const busy = state.result.gantt.reduce((total, block) => total + (block.pid === "IDLE" ? 0 : block.end - block.start), 0);
  $("cpuUtil").textContent = `${(busy / state.result.steps.length * 100).toFixed(2)}%`;
}

function applyTheme() {
  document.documentElement.dataset.theme = state.dark ? "dark" : "light";
  $("themeBtn").textContent = state.dark ? "☀" : "☾";
}

function toggleTheme() {
  state.dark = !state.dark;
  applyTheme();
  try { localStorage.setItem("srtf-theme", state.dark ? "dark" : "light"); } catch { /* Keep the theme for this page when storage is blocked. */ }
}

init();
