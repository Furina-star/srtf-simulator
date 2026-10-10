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

function runSRTF() {
  showError();
  const inputProcesses = getProcessesFromInputs();
  if (!inputProcesses) return;

  const ps = inputProcesses.map((p, index) => ({
    ...p, index, remaining: p.bt, firstStart: null, ct: null
  }));

  let time = Math.min(...ps.map(p => p.at));
  const startTime = time;
  let completed = 0;
  const segments = [];
  let busyTime = 0;
  let prevPid = null;
  const logs = [];

  // Log initial arrivals at start time
  ps.filter(p => p.at === startTime).forEach(p => {
    logs.push({ time: startTime, msg: `📥 <strong>Process ${p.pid}</strong> arrived (Burst Time: ${p.bt})` });
  });

  while (completed < ps.length) {
    // Log arrivals occurring at current time unit
    if (time > startTime) {
      ps.filter(p => p.at === time).forEach(p => {
        logs.push({ time, msg: `📥 <strong>Process ${p.pid}</strong> arrived (Burst Time: ${p.bt})` });
      });
    }

    const ready = ps.filter(p => p.at <= time && p.remaining > 0);

    if (!ready.length) {
      const nextArrival = Math.min(...ps.filter(p => p.remaining > 0).map(p => p.at));
      addSegment(segments, "IDLE", time, nextArrival);
      logs.push({ time, msg: `⏸️ CPU is <strong>IDLE</strong> until t = ${nextArrival}` });
      time = nextArrival;
      prevPid = "IDLE";
      continue;
    }

    ready.sort((a,b) => a.remaining - b.remaining || a.at - b.at || a.index - b.index);
    const current = ready[0];

    // Log CPU preemption or context switch
    if (current.pid !== prevPid) {
      if (prevPid && prevPid !== "IDLE") {
        const prevProc = ps.find(p => p.pid === prevPid);
        if (prevProc && prevProc.remaining > 0) {
          logs.push({
            time,
            msg: `⚡ <strong>Preemption:</strong> Process ${current.pid} (Remaining BT: ${current.remaining}) preempts Process ${prevProc.pid} (Remaining BT: ${prevProc.remaining})`
          });
        } else {
          logs.push({
            time,
            msg: `▶️ <strong>CPU Assigned:</strong> Process ${current.pid} begins execution (Remaining BT: ${current.remaining})`
          });
        }
      } else {
        logs.push({
          time,
          msg: `▶️ <strong>CPU Assigned:</strong> Process ${current.pid} begins execution (Remaining BT: ${current.remaining})`
        });
      }
    }

    if (current.firstStart === null) current.firstStart = time;
    addSegment(segments, current.pid, time, time + 1);
    current.remaining--;
    busyTime++;
    prevPid = current.pid;
    time++;

    // Log process completion
    if (current.remaining === 0) {
      current.ct = time;
      completed++;
      logs.push({
        time,
        msg: `✅ <strong>Process ${current.pid}</strong> finished execution (Completion Time: ${time})`
      });
    }
  }

  const results = ps.map(p => ({
    ...p,
    tat: p.ct - p.at,
    wt: (p.ct - p.at) - p.bt,
    rt: p.firstStart - p.at
  }));

  state.segments = mergeSegments(segments);
  
  renderGanttAnimated(state.segments, startTime, time);
  renderLogs(logs);
  renderResults(results);

  const avg = key => results.reduce((sum,p) => sum + p[key], 0) / results.length;
  $("avgWT").textContent = format(avg("wt"));
  $("avgTAT").textContent = format(avg("tat"));
  $("avgRT").textContent = format(avg("rt"));
  
  const totalDuration = time - startTime;
  $("cpuUtil").textContent = totalDuration > 0 ? `${format((busyTime / totalDuration) * 100)}%` : "—";
  $("timelineInfo").textContent = `${state.segments.length} segments • ${startTime}–${time}`;
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

init();