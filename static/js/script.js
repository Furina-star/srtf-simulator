const state = {
  processes: [],
  segments: [],
  dark: localStorage.getItem("srtf-theme") === "dark"
};

const $ = id => document.getElementById(id);

function init() {
  if (state.dark) document.documentElement.dataset.theme = "dark";
  $("themeBtn").textContent = state.dark ? "☀" : "☾";

  $("addRowBtn").addEventListener("click", () => addRow());
  $("runBtn").addEventListener("click", runSRTF);
  $("clearBtn").addEventListener("click", clearAll);
  $("resetBtn").addEventListener("click", resetResults);
  $("sampleBtn").addEventListener("click", loadSample);
  $("themeBtn").addEventListener("click", toggleTheme);

  // Load 5 default empty rows (A, B, C, D, E) on start
  loadDefaultEmptyRows();
}

function getLetterPID(index) {
  let pid = "";
  let i = index;
  while (i >= 0) {
    pid = String.fromCharCode((i % 26) + 65) + pid;
    i = Math.floor(i / 26) - 1;
  }
  return pid;
}

function loadDefaultEmptyRows() {
  const container = $("processRows");
  container.innerHTML = "";
  for (let i = 0; i < 5; i++) {
    addRow(getLetterPID(i), "", "");
  }
}

function addRow(pid = "", at = "", bt = "") {
  showError();
  const container = $("processRows");
  const index = container.children.length;
  const pName = pid || getLetterPID(index);

  const row = document.createElement("div");
  row.className = "process-input-row";
  row.innerHTML = `
    <span class="pid-badge">${escapeHTML(pName)}</span>
    <input type="number" class="at-input" min="0" step="1" value="${at}" placeholder="0">
    <input type="number" class="bt-input" min="1" step="1" value="${bt}" placeholder="5">
    <button class="row-del-btn" onclick="removeRow(this)" title="Remove process">×</button>
  `;
  container.appendChild(row);
  updateProcessCount();
}

window.removeRow = function(btn) {
  const row = btn.closest(".process-input-row");
  row.remove();
  reindexPIDs();
  updateProcessCount();
  resetResults(false);
};

function reindexPIDs() {
  const rows = document.querySelectorAll("#processRows .process-input-row");
  rows.forEach((row, i) => {
    row.querySelector(".pid-badge").textContent = getLetterPID(i);
  });
}

function updateProcessCount() {
  const count = document.querySelectorAll("#processRows .process-input-row").length;
  $("processCount").textContent = count;
}

function getProcessesFromInputs() {
  const rows = document.querySelectorAll("#processRows .process-input-row");
  const list = [];
  let isValid = true;

  if (!rows.length) {
    showError("Please add at least one process row before running.");
    return null;
  }

  rows.forEach((row, index) => {
    if (!isValid) return;

    const pid = row.querySelector(".pid-badge").textContent.trim();
    const atVal = row.querySelector(".at-input").value.trim();
    const btVal = row.querySelector(".bt-input").value.trim();

    if (atVal === "") {
      showError(`Please fill in Arrival Time for ${pid} (Row ${index + 1}).`);
      isValid = false;
      return;
    }
    if (btVal === "") {
      showError(`Please fill in Burst Time for ${pid} (Row ${index + 1}).`);
      isValid = false;
      return;
    }

    const at = Number(atVal);
    const bt = Number(btVal);

    if (!Number.isInteger(at) || at < 0) {
      showError(`Row ${index + 1} (${pid}): Arrival Time must be a whole number ≥ 0.`);
      isValid = false;
      return;
    }
    if (!Number.isInteger(bt) || bt <= 0) {
      showError(`Row ${index + 1} (${pid}): Burst Time must be a whole number > 0.`);
      isValid = false;
      return;
    }

    list.push({ pid, at, bt });
  });

  return isValid ? list : null;
}

function showError(message = "") {
  $("error").textContent = message;
}

function clearAll() {
  $("processRows").innerHTML = "";
  updateProcessCount();
  resetResults();
  showError();
}

function loadSample() {
  const sampleData = [
    { pid: "A", at: 0, bt: 8 },
    { pid: "B", at: 1, bt: 4 },
    { pid: "C", at: 2, bt: 2 },
    { pid: "D", at: 3, bt: 1 },
    { pid: "E", at: 4, bt: 3 }
  ];
  const container = $("processRows");
  container.innerHTML = "";
  sampleData.forEach(p => addRow(p.pid, p.at, p.bt));
  resetResults(false);
}

function resetResults(clearStatus = true) {
  state.segments = [];
  $("avgWT").textContent = "—";
  $("avgTAT").textContent = "—";
  $("avgRT").textContent = "—";
  $("cpuUtil").textContent = "—";
  $("timelineInfo").textContent = "—";
  $("resultsBody").innerHTML = `<tr><td colspan="7" class="table-empty">No results yet.</td></tr>`;
  $("gantt").className = "gantt empty-chart";
  $("gantt").innerHTML = `<div class="chart-placeholder">Your execution timeline will appear here.</div>`;
  
  const logBox = $("logContainer");
  logBox.className = "log-container empty-log";
  logBox.innerHTML = `<div class="chart-placeholder">Run the simulation to view step-by-step decision logs.</div>`;

  if (clearStatus) $("statusText").textContent = "Run the scheduler to generate results.";
}

async function runSRTF() {
  showError();
  const inputProcesses = getProcessesFromInputs();
  if (!inputProcesses) return;

  const payload = {
    processes: inputProcesses.map(p => ({ pid: p.pid, arrival: p.at, burst: p.bt }))
  };

  let data;
  try {
    const response = await fetch("/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    data = await response.json();
    if (!response.ok) {
      showError(data.error);
      return;
    }
  } catch (err) {
    showError("Could not reach the simulator server. Is app.py running?");
    return;
  }

  // Build the rows for their results table, in input order
  const burstByPid = Object.fromEntries(inputProcesses.map(p => [p.pid, p.bt]));
  const results = inputProcesses.map(p => {
    const m = data.metrics[p.pid];
    return { pid: p.pid, at: p.at, bt: p.bt,
             ct: m.completion, tat: m.turnaround, wt: m.waiting, rt: m.response };
  });

  const startTime = data.gantt[0].start;
  const endTime = data.gantt[data.gantt.length - 1].end;
  const busyTime = data.gantt
    .filter(b => b.pid !== "IDLE")
    .reduce((sum, b) => sum + (b.end - b.start), 0);

  state.segments = data.gantt;
  renderGanttAnimated(state.segments, startTime, endTime);
  renderLogs(buildLogs(data.steps, data.gantt, burstByPid));
  renderResults(results);

  $("avgWT").textContent = format(data.averages.waiting);
  $("avgTAT").textContent = format(data.averages.turnaround);
  $("avgRT").textContent = format(data.averages.response);
  $("cpuUtil").textContent = `${format((busyTime / (endTime - startTime)) * 100)}%`;
  $("timelineInfo").textContent = `${state.segments.length} segments • ${startTime}–${endTime}`;
  $("statusText").textContent = `Simulation complete • ${results.length} processes scheduled`;
}

function addSegment(segments, pid, start, end) {
  segments.push({pid, start, end});
}

function mergeSegments(segments) {
  const merged = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && last.pid === seg.pid && last.end === seg.start) {
      last.end = seg.end;
    } else {
      merged.push({...seg});
    }
  }
  return merged;
}

function renderLogs(logs) {
  const container = $("logContainer");
  container.className = "log-container";
  container.innerHTML = logs.map(l => `
    <div class="log-item">
      <span class="log-time">t = ${l.time}</span>
      <span class="log-msg">${l.msg}</span>
    </div>
  `).join("");
}

function renderGanttAnimated(segments, minTime, maxTime) {
  const gantt = $("gantt");
  gantt.className = "gantt";
  const total = maxTime - minTime || 1;

  const trackHTML = segments.map((seg, i) => {
    const width = Math.max(((seg.end - seg.start) / total) * 100, 4.5);
    const idle = seg.pid === "IDLE";
    const duration = seg.end - seg.start;
    const isLast = i === segments.length - 1;

    return `
      <div class="gantt-block" style="width:${width}%${idle ? ";opacity:.55" : ""}">
        <strong>${escapeHTML(seg.pid)}</strong>
        <span class="dur">${duration} unit${duration === 1 ? "" : "s"}</span>
        <span class="time-label time-start">${seg.start}</span>
        ${isLast ? `<span class="time-label time-end">${seg.end}</span>` : ""}
      </div>
    `;
  }).join("");

  gantt.innerHTML = `<div class="gantt-track">${trackHTML}</div>`;

  const blocks = gantt.querySelectorAll(".gantt-block");
  blocks.forEach((block, index) => {
    setTimeout(() => {
      block.classList.add("visible");
    }, index * 180);
  });
}

function renderResults(results) {
  $("resultsBody").innerHTML = results.map(p => `
    <tr>
      <td>${escapeHTML(p.pid)}</td>
      <td>${p.at}</td>
      <td>${p.bt}</td>
      <td>${p.ct}</td>
      <td>${p.tat}</td>
      <td>${p.wt}</td>
      <td>${p.rt}</td>
    </tr>
  `).join("");
}

function format(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function toggleTheme() {
  state.dark = !state.dark;
  document.documentElement.dataset.theme = state.dark ? "dark" : "light";
  localStorage.setItem("srtf-theme", state.dark ? "dark" : "light");
  $("themeBtn").textContent = state.dark ? "☀" : "☾";
}

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function buildLogs(steps, gantt, burstByPid) {
  const logs = [];
  let prev = null;
  for (const s of steps) {
    const of = type => s.events.filter(e => e.type === type);

    of("arrival").forEach(e => logs.push({ time: e.at,
      msg: `📥 <strong>Process ${e.pid}</strong> arrived (Burst Time: ${burstByPid[e.pid]})` }));

    const pre = of("preempt")[0];
    if (pre) {
      logs.push({ time: s.time,
        msg: `⚡ <strong>Preemption:</strong> Process ${pre.by} (Remaining BT: ${s.remaining[pre.by]}) preempts Process ${pre.pid} (Remaining BT: ${s.remaining[pre.pid]})` });
    } else if (s.running !== "IDLE" && s.running !== prev) {
      logs.push({ time: s.time,
        msg: `▶️ <strong>CPU Assigned:</strong> Process ${s.running} begins execution (Remaining BT: ${s.remaining[s.running]})` });
    }

    if (s.running === "IDLE" && prev !== "IDLE") {
      const block = gantt.find(b => b.pid === "IDLE" && b.start === s.time);
      logs.push({ time: s.time,
        msg: `⏸️ CPU is <strong>IDLE</strong> until t = ${block.end}` });
    }

    of("complete").forEach(e => logs.push({ time: e.at,
      msg: `✅ <strong>Process ${e.pid}</strong> finished execution (Completion Time: ${e.at})` }));

    prev = s.running;
  }
  return logs;
}

init();