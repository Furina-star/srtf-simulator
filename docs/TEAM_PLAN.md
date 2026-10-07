# SRTF Scheduler Simulator — Team Plan

**Algorithm:** Shortest Remaining Time First (SRTF) / Preemptive SJN
**Group size:** 5 members
**Technology:** Python 3 + Flask (engine and server) · HTML5 + CSS3 + JavaScript (interface and animation)
**Presentation:** October 12 (document submitted before the presentation)

---

## 1. System Overview

The system is a web-based simulator, served locally by a Python Flask application, that visualizes how an operating system schedules CPU time using SRTF. A user enters processes (PID, arrival time, burst time), runs the simulation, and watches an animated **Gantt chart** build one time unit at a time. The simulator shows which process is on the CPU, which processes are in the ready queue, when a preemption happens, and finally the computed metrics (completion, turnaround, waiting, and response times, plus averages).

**Purpose:** help students understand preemptive scheduling by seeing it happen instead of tracing it by hand.

---

## 2. The Algorithm

### In plain words
- At every moment, the CPU runs the process with the **smallest remaining burst time** among all processes that have already arrived.
- When a new process arrives with a burst time **shorter than the remaining time** of the running process, the running process is **preempted**.
- It is the preemptive version of Shortest Job Next (SJN/SJF).
- **Strength:** gives the minimum average waiting time among common scheduling algorithms.
- **Weakness:** long processes may starve; burst times must be known in advance; more context switches.

### Formulas
| Metric | Formula |
|---|---|
| Turnaround Time (TAT) | Completion Time − Arrival Time |
| Waiting Time (WT) | TAT − Burst Time |
| Response Time (RT) | First CPU start − Arrival Time |

### Pseudocode
```
t = 0
while not all processes finished:
    ready = processes with arrival <= t and remaining > 0
    if ready is empty:
        CPU idle for 1 unit; t += 1; continue
    current = process in ready with smallest remaining time
              (ties: keep the running one, then earlier arrival, then lower PID)
    if current has never run: record first start time
    run current for 1 unit; remaining -= 1; t += 1
    if remaining == 0: record completion time
merge consecutive 1-unit slices of the same PID into Gantt blocks
```

### Worked example (default demo data and primary test case)
| PID | Arrival | Burst |
|---|---|---|
| P1 | 0 | 8 |
| P2 | 1 | 4 |
| P3 | 2 | 9 |
| P4 | 3 | 5 |

**Gantt chart:** `P1 [0–1] | P2 [1–5] | P4 [5–10] | P1 [10–17] | P3 [17–26]`

| PID | Completion | TAT | WT | RT |
|---|---|---|---|---|
| P1 | 17 | 17 | 9 | 0 |
| P2 | 5 | 4 | 0 | 0 |
| P3 | 26 | 24 | 15 | 15 |
| P4 | 10 | 7 | 2 | 2 |

**Average WT = 6.5 | Average TAT = 13.0.** The system must reproduce these exact values.

---

## 3. System Architecture

The system has two sides that communicate through one JSON message: a **Python side** (engine and Flask server) and a **browser side** (HTML, CSS, JavaScript).

```
        BROWSER (HTML / CSS / JavaScript)                 PYTHON (Flask)
 ┌──────────────────────────────────────────┐      ┌─────────────────────────┐
 │  Input form + process table              │      │  app.py                 │
 │        │  validate (JS)                  │      │   POST /simulate        │
 │        ▼                                 │ JSON │   validate (Python)     │
 │  Run button ── fetch("/simulate") ───────┼─────▶│        │                │
 │                                          │      │        ▼                │
 │  Playback controller (player.js) ◀───────┼──────┤  engine.py  srtf()      │
 │   Play/Pause/Step/Reset/Speed   result   │ JSON │  returns result object  │
 │        │ one step per tick               │      └─────────────────────────┘
 │        ▼                                 │
 │  Gantt • CPU panel • Ready queue         │
 │  Event log • Results table               │
 └──────────────────────────────────────────┘
```

### Core design rule
**The engine computes everything first. The browser only replays the result.**

1. The user fills the process table and presses **Run**.
2. JavaScript validates the data and sends it to `POST /simulate`.
3. Flask validates again, calls `srtf()`, and returns the complete `result` as JSON.
4. The playback controller walks through `result.steps` one entry at a time on a timer.
5. For each step, the interface updates the Gantt chart, CPU panel, ready queue, clock, and event log.
6. After the last step, the results table and averages are filled from `result.metrics` and `result.averages`.

**Why this design:**
- The engine has no web or UI code, so it can be tested alone against hand-computed answers.
- The browser has no scheduling logic, so animation bugs and scheduling bugs are never mixed.
- Pause, step, reset, and speed control only move an index over a list.
- The interface can be built against a hard-coded sample `result` (a plain `.json` file) before the engine or server exists.

### Interface contract (the single agreement everything depends on)

**Request:** `POST /simulate` with body

```json
{
  "processes": [
    {"pid": "P1", "arrival": 0, "burst": 8},
    {"pid": "P2", "arrival": 1, "burst": 4}
  ]
}
```

**Success response (200):**

```json
{
  "steps": [
    {
      "time": 1,
      "running": "P2",
      "ready": ["P1", "P3"],
      "remaining": {"P1": 7, "P2": 4, "P3": 9},
      "events": [
        {"type": "arrival", "pid": "P2", "text": "P2 arrived"},
        {"type": "preempt", "pid": "P1", "by": "P2", "text": "P1 preempted by P2"}
      ]
    }
  ],
  "gantt": [
    {"pid": "P1", "start": 0, "end": 1},
    {"pid": "P2", "start": 1, "end": 5}
  ],
  "metrics": {
    "P1": {"completion": 17, "turnaround": 17, "waiting": 9, "response": 0}
  },
  "averages": {"turnaround": 13.0, "waiting": 6.5, "response": 4.25}
}
```

Field rules:
- `steps`: one entry per time unit. `running` is a PID or `"IDLE"`. `remaining` is the remaining time of every process at the **start** of that time unit. `ready` is sorted by remaining time.
- `events[].type` is one of `arrival`, `preempt`, `complete`, `idle`. The engine produces events so the browser never has to guess when a preemption happened.
- `gantt`: merged blocks, used for the final layout and for checking correctness.

**Error response (400):**

```json
{"error": "Burst time of P3 must be a whole number of 1 or more."}
```

A reference sample file (`static/sample_result.json`, generated from the worked example) lets the interface be developed and tested with no server.

---

## 4. Backend Implementation (Python)

### 4.1 Engine reference skeleton (`engine.py`)

```python
def srtf(processes):
    rem = {p["pid"]: p["burst"] for p in processes}
    burst = dict(rem)
    arrival = {p["pid"]: p["arrival"] for p in processes}
    first_start, completion = {}, {}
    steps, running, t, done = [], None, 0, 0

    while done < len(processes):
        events = [{"type": "arrival", "pid": p["pid"], "text": f'{p["pid"]} arrived'}
                  for p in processes if p["arrival"] == t]
        ready = [p["pid"] for p in processes
                 if p["arrival"] <= t and rem[p["pid"]] > 0]

        if not ready:
            events.append({"type": "idle", "pid": None, "text": "CPU idle"})
            steps.append({"time": t, "running": "IDLE", "ready": [],
                          "remaining": dict(rem), "events": events})
            running, t = None, t + 1
            continue

        # smallest remaining; ties -> keep running, then earlier arrival, then PID
        cur = min(ready, key=lambda x: (rem[x], 0 if x == running else 1,
                                        arrival[x], x))
        if running and running != cur and rem[running] > 0:
            events.append({"type": "preempt", "pid": running, "by": cur,
                           "text": f"{running} preempted by {cur}"})
        first_start.setdefault(cur, t)

        waiting = sorted((x for x in ready if x != cur),
                         key=lambda x: (rem[x], arrival[x], x))
        steps.append({"time": t, "running": cur, "ready": waiting,
                      "remaining": dict(rem), "events": events})

        rem[cur] -= 1
        running, t = cur, t + 1
        if rem[cur] == 0:
            completion[cur] = t
            done += 1
            steps[-1]["events"].append(
                {"type": "complete", "pid": cur, "text": f"{cur} completed"})

    gantt = []
    for s in steps:
        if gantt and gantt[-1]["pid"] == s["running"] and gantt[-1]["end"] == s["time"]:
            gantt[-1]["end"] += 1
        else:
            gantt.append({"pid": s["running"], "start": s["time"], "end": s["time"] + 1})

    metrics = {}
    for pid in rem:
        tat = completion[pid] - arrival[pid]
        metrics[pid] = {"completion": completion[pid], "turnaround": tat,
                        "waiting": tat - burst[pid],
                        "response": first_start[pid] - arrival[pid]}
    n = len(metrics)
    averages = {k: round(sum(m[k] for m in metrics.values()) / n, 2)
                for k in ("turnaround", "waiting", "response")}

    return {"steps": steps, "gantt": gantt, "metrics": metrics, "averages": averages}
```

### 4.2 Flask server (`app.py`)

```python
from flask import Flask, request, jsonify, send_from_directory
from engine import srtf

app = Flask(__name__, static_folder="static", static_url_path="/static")
MAX_PROCESSES = 15

def validate(processes):
    if not isinstance(processes, list) or not processes:
        return "Add at least one process."
    if len(processes) > MAX_PROCESSES:
        return f"A maximum of {MAX_PROCESSES} processes is allowed."
    seen = set()
    for p in processes:
        pid = str(p.get("pid", "")).strip()
        if not pid:
            return "Every process needs a PID."
        if pid in seen:
            return f"Duplicate PID: {pid}."
        seen.add(pid)
        if not isinstance(p.get("arrival"), int) or p["arrival"] < 0:
            return f"Arrival time of {pid} must be a whole number of 0 or more."
        if not isinstance(p.get("burst"), int) or p["burst"] < 1:
            return f"Burst time of {pid} must be a whole number of 1 or more."
    return None

@app.route("/")
def index():
    return send_from_directory("static", "index.html")

@app.route("/simulate", methods=["POST"])
def simulate():
    data = request.get_json(silent=True) or {}
    processes = data.get("processes")
    error = validate(processes)
    if error:
        return jsonify({"error": error}), 400
    return jsonify(srtf(processes))

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
```

**Notes**
- `jsonify` keeps the engine output as-is, so the engine does not need to know it is behind a web server.
- Validation exists in both places on purpose: JavaScript gives instant feedback, Python protects the engine from bad data.

### 4.3 Running the system (also used in the User Manual)

```
pip install -r requirements.txt     # requirements.txt contains: Flask
python app.py
# open http://127.0.0.1:5000 in a web browser
```

---

## 5. Frontend Implementation (HTML / CSS / JavaScript)

### 5.1 Page layout

```
┌────────────────────────────────────────────────────────────────────┐
│  SRTF Scheduler Simulator                                           │
├───────────────────────────────┬────────────────────────────────────┤
│  PROCESS INPUT                │  CPU STATUS                         │
│  PID [__] Arrival [__] Burst [__] [Add]   Clock : 07               │
│  ┌───────────────────────┐    │  Running: [ P4 ]  remaining: 3     │
│  │ PID │ Arrival │ Burst │    │  ──────────────────────────────    │
│  │ P1  │   0     │  8    │    │  EVENT LOG                          │
│  │ P2  │   1     │  4    │    │  t=1  P2 arrived                    │
│  └───────────────────────┘    │  t=1  P1 preempted by P2            │
│  [Load Sample][Random][Clear] │  t=5  P2 completed                  │
├───────────────────────────────┴────────────────────────────────────┤
│  READY QUEUE   [ P1 : 7 ] [ P3 : 9 ]                                │
├────────────────────────────────────────────────────────────────────┤
│  GANTT CHART                                                        │
│  ┃P1┃    P2    ┃     P4     ┃ ...                                  │
│  0  1  2  3  4  5  6  7  8  9 10                                    │
├────────────────────────────────────────────────────────────────────┤
│  [ Run ] [ ▶ Play / ⏸ Pause ] [ Step ] [ Reset ]   Speed ──●────    │
├────────────────────────────────────────────────────────────────────┤
│  RESULTS  PID │ Completion │ TAT │ WT │ RT      Avg WT / Avg TAT    │
└────────────────────────────────────────────────────────────────────┘
```

### 5.2 HTML structure (element IDs the scripts rely on)

```html
<main>
  <section id="input-panel">           <!-- form, #process-table, sample/random/clear buttons -->
  <section id="cpu-panel">             <!-- #clock, #running-pid, #running-remaining -->
  <section id="event-log">             <!-- <ul id="log"> -->
  <section id="ready-queue">           <!-- <div id="queue"> chips are added here -->
  <section id="gantt-section">
    <div id="gantt"></div>             <!-- position: relative; blocks are absolutely positioned -->
    <div id="ruler"></div>             <!-- time ticks under the chart -->
  </section>
  <section id="controls">              <!-- #run #play #step #reset #speed -->
  <section id="results">               <!-- <table id="results-table">, #avg-wt, #avg-tat, #avg-rt -->
</main>
```

### 5.3 Visual style (CSS)
- **CSS variables** for the whole theme (`--bg`, `--panel`, `--text`, `--accent`, `--danger`) so colors change in one place.
- **One fixed color per process**, assigned by order from a palette (example: `#4E79A7, #F28E2B, #E15759, #76B7B2, #59A14F, #EDC948, #B07AA1, #FF9DA7, #9C755F, #BAB0AC`). The same color is used in the Gantt bar, ready-queue chip, CPU panel, and results table.
- **IDLE** blocks use light gray with a diagonal-stripe `repeating-linear-gradient`.
- Preemption uses `--danger` red (marker at the boundary, red log entry).
- CSS Grid for the page layout and Flexbox inside panels, so the page adapts to different window sizes.
- One font family across the page; consistent spacing (8–10 px scale).
- Text color inside bars chosen for contrast with the bar color.

### 5.4 Gantt chart animation (CSS-driven)

One time unit is `UNIT` pixels wide (for example 48). Each block is a `div` positioned with `left = start × UNIT` and sized with `width = length × UNIT`. Smooth growth comes from a CSS `transition` on `width`, so no frame-by-frame code is required.

```css
.gantt-block {
  position: absolute;
  top: 0;
  height: 48px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 600;
  transition-property: width;
  transition-timing-function: linear;   /* duration is set from JS to match the speed slider */
}
```

```js
const UNIT = 48;
const blocks = [];                      // { pid, start, el }

function extendGantt(step, delayMs) {
  const gantt = document.getElementById("gantt");
  const last = blocks[blocks.length - 1];

  if (last && last.pid === step.running) {
    // same process continues: grow the existing block by one unit
    last.el.style.transitionDuration = delayMs + "ms";
    last.el.style.width = ((step.time + 1 - last.start) * UNIT) + "px";
  } else {
    // new process on the CPU: create a block and grow it from zero width
    const el = document.createElement("div");
    el.className = "gantt-block" + (step.running === "IDLE" ? " idle" : "");
    el.textContent = step.running;
    el.style.left = (step.time * UNIT) + "px";
    el.style.width = "0px";
    el.style.background = colorOf(step.running);
    gantt.appendChild(el);
    blocks.push({ pid: step.running, start: step.time, el });
    el.getBoundingClientRect();                       // force layout so the transition runs
    el.style.transitionDuration = delayMs + "ms";
    el.style.width = UNIT + "px";
  }
  addRulerTick(step.time + 1);
  gantt.parentElement.scrollLeft = gantt.parentElement.scrollWidth;   // follow the newest block
}
```

### 5.5 Playback controller (`player.js`) — the link between engine output and the page

```js
class Player {
  constructor(result, ui) {
    this.result = result;
    this.steps = result.steps;
    this.ui = ui;
    this.i = 0;
    this.playing = false;
    this.delay = 600;                    // milliseconds per time unit
    this.timer = null;
  }
  play()  { if (!this.playing) { this.playing = true; this.tick(); } }
  pause() { this.playing = false; clearTimeout(this.timer); }
  step()  { this.pause(); this.advance(); }
  reset() { this.pause(); this.i = 0; this.ui.clear(); }
  setSpeed(sliderValue) { this.delay = 1100 - sliderValue * 100; }   // slider 1..10

  tick() {
    if (!this.playing || this.i >= this.steps.length) { this.playing = false; return; }
    this.advance();
    this.timer = setTimeout(() => this.tick(), this.delay);
  }

  advance() {
    if (this.i >= this.steps.length) return;
    const s = this.steps[this.i];
    this.ui.updateClock(s.time);
    this.ui.updateCpuPanel(s.running, s.remaining);
    this.ui.updateReadyQueue(s.ready, s.remaining);
    extendGantt(s, this.delay);
    this.ui.logEvents(s.time, s.events);              // preempt events styled red
    this.i++;
    if (this.i === this.steps.length) {
      this.ui.showResults(this.result.metrics, this.result.averages);
    }
  }
}
```

### 5.6 Sending the request (`main.js`)

```js
async function runSimulation() {
  const processes = readProcessTable();               // [{pid, arrival, burst}, ...]
  const response = await fetch("/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ processes })
  });
  const data = await response.json();
  if (!response.ok) { showError(data.error); return; }
  player = new Player(data, ui);
  ui.clear();
  enableControls();
}
```

### 5.7 What happens on screen at each event

| Event `type` | Interface reaction |
|---|---|
| `arrival` | New chip appears in the ready queue with a short highlight animation |
| `preempt` | Red marker at the Gantt boundary, red log entry, brief flash on the CPU panel |
| `complete` | Row in the process table is grayed out, completion entry in the log |
| `idle` | Striped gray IDLE block grows; CPU panel shows "IDLE" |

### 5.8 Control behavior

| Control | Behavior |
|---|---|
| **Run** | Validates input, calls `/simulate`, creates a new `Player`, shows time 0 |
| **Play / Pause** | Starts or stops the timer loop |
| **Step** | Advances exactly one time unit |
| **Reset** | Clears Gantt, queue, log, and results; keeps the process list |
| **Speed slider** | Updates `delay` immediately, even during playback |
| **Clear** | Empties the process list and the display |

Buttons are disabled when they make no sense (Play before Run, Step after the final step), which prevents errors and makes the page easier to understand.

### 5.9 Input validation (supports user-friendliness)
- Arrival: whole number, 0 or greater. Burst: whole number, 1 or greater.
- PID cannot be blank or duplicated; the next PID (P1, P2, P3...) is suggested automatically.
- Maximum of 15 processes to keep the Gantt readable.
- Errors appear as a clear inline message next to the field, never as a crash or a silent failure.
- If the server cannot be reached, a readable message appears ("Could not reach the simulator server. Is `app.py` running?").

---

## 6. Feature List (mapped to the rubric)

### Functionality — 50%
- Add, remove, and clear processes
- Correct SRTF with preemption, including idle gaps when no process has arrived
- Documented tie-breaking rule
- Results table with completion, turnaround, waiting, response times, and averages
- Input validation on both the browser and the server
- Stable with 1 process, 15 processes, and simultaneous arrivals

### Design / Animation — 20%
- Gantt chart that builds block by block with smooth CSS growth
- Consistent per-process colors across every panel
- Live ready queue and CPU status panels
- Visible preemption indicator
- Play, Pause, Step, Reset, and speed control
- Responsive layout

### User-friendliness — 10%
- "Load Sample" button (the worked example)
- "Random" generator button
- Clear labels, readable fonts, helpful error messages
- Buttons disabled when not applicable
- One-command startup with a short on-page "How to use" hint

### Optional (only if time allows)
- Export results as CSV or image
- Context switch counter
- Side-by-side comparison with SJF or FCFS
- Dark/light theme toggle

---

## 7. Division of Work

Work is divided by area of responsibility. Each member owns separate files to avoid merge conflicts. The interface contract in Section 3 is agreed on **Day 1** so every area can progress in parallel.

| # | Role | Assigned to | Main deliverables |
|---|---|---|---|
| 1 | **Lead Developer / Engine and Server** | __________ | `engine.py`, `app.py`, server-side validation, integration testing of the full system, final code review and bug fixes |
| 2 | **Frontend: Design and Animation** | __________ | `index.html` structure, `style.css`, `gantt.js`, `player.js`, `main.js`: layout, Gantt animation, CPU panel, ready queue, playback controls (Sections 5.1–5.8) |
| 3 | **Input, Validation, and QA** | __________ | Process input form and table (`input.js`, `input.css`), browser-side validation (5.9), sample and random data, `tests/`, test cases and bug reports |
| 4 | **Documentation Lead** | __________ | Title page (UNP-CCIT format), Introduction (overview, algorithm, scope and limitations, languages used), proofreading |
| 5 | **User Manual and Presentation** | __________ | User manual with annotated screenshots, APA 7th references, presentation slides, demo script and rehearsal |

### How the roles connect
- **Role 1 ↔ Role 2:** exchange through the JSON `result` only. Role 2 builds the page from `sample_result.json`, then switches to the live `/simulate` endpoint by changing one `fetch` call.
- **Role 1 ↔ Role 3:** Role 3 writes test cases with hand-computed answers; Role 1 runs the engine against them. Role 3 also tests that invalid input is rejected by both browser and server.
- **Role 3 ↔ Role 2:** the input form hands a validated process list to the Run button (`readProcessTable()`); the input panel markup lives inside `index.html` in its own marked block.
- **Roles 4 and 5** use finished screens and verified outputs for screenshots, examples, and explanations.

### Rubric coverage
- **Functionality (50%):** Roles 1 and 3
- **Design/Animation (20%):** Role 2
- **Documentation (20%):** Roles 4 and 5
- **User-friendliness (10%):** Roles 2, 3, and 5

---

## 8. Document Outline

| Section | Owner | Notes |
|---|---|---|
| **Title Page** | Role 4 | Follow the **UNP-CCIT Thesis Manuscript Title Page Format** exactly; confirm margins and fonts against a sample manuscript |
| **Introduction** | Role 4 | |
| – System Overview | Role 4 | What it does, its purpose, the problem it solves |
| – Assigned Algorithm | Role 4 (facts from Role 1) | Explanation of SRTF, pseudocode, formulas, worked example from Section 2 |
| – Scope and Limitations | Roles 4 and 1 | See suggestions below |
| – Programming Languages Used | Role 4 | Python 3 and Flask (engine and server); HTML5, CSS3, and JavaScript (interface); reason for each |
| **User Manual** | Role 5 | Installation (Section 4.3), screenshots, step-by-step usage, common errors and fixes |
| **References (APA 7th)** | Role 5 | Operating systems textbook, lecture notes, Flask documentation, MDN Web Docs |

**Suggested scope:** single CPU; integer arrival and burst times; no I/O bursts; no priorities; zero context-switch cost; one simulation at a time; runs locally in a web browser.

**Suggested limitations:** burst times must be known in advance; no multi-core support; no I/O wait modeling; starvation of long processes is demonstrated but not prevented; requires Python and Flask installed to run; limited to 15 processes; intended for learning, not for real OS scheduling.

**APA 7th reference examples (verify against the editions and pages actually used):**
> Silberschatz, A., Galvin, P. B., & Gagne, G. (2018). *Operating system concepts* (10th ed.). Wiley.

> Pallets. (n.d.). *Flask documentation*. https://flask.palletsprojects.com/

> Mozilla. (n.d.). *MDN web docs*. https://developer.mozilla.org/

---

## 9. Timeline (October 7 – October 12)

| Day | Role 1 (Engine/Server) | Role 2 (Frontend) | Role 3 (Input/QA) | Role 4 (Docs) | Role 5 (Manual/Slides) |
|---|---|---|---|---|---|
| **Oct 7** | Team call: confirm interface contract and repo; create `sample_result.json`; start engine | Page skeleton and layout from the wireframe | Write 8–10 test cases with hand-computed answers | Collect title page format; start Introduction | Gather references; outline manual |
| **Oct 8** | Finish engine; add Flask route and validation | Gantt animation and player using `sample_result.json` | Input form and browser-side validation | Algorithm and scope sections | Draft slides |
| **Oct 9** | Integration: connect frontend to `/simulate` | Switch to live endpoint; events, controls, speed | Test integrated build; log bugs | Finish Introduction draft | Capture screenshots as features stabilize |
| **Oct 10** | Bug fixes; **feature freeze at end of day** | Visual polish; preemption indicator; responsive checks | Final regression and edge-case tests | Proofread and format | Write user manual with final screenshots |
| **Oct 11** | Final review; test on the presentation laptop; backup copy | Final visual check | Dry run as a first-time user | Final proofreading; title page check | Demo rehearsal with the whole team |
| **Oct 12** | Presentation | | | | |

---

## 10. Working Rules

1. One shared **GitHub repository**:
   ```
   srtf-simulator/
   ├── app.py                 # Flask server, validation        (Role 1)
   ├── engine.py              # SRTF engine                      (Role 1)
   ├── requirements.txt       # Flask                            (Role 1)
   ├── static/
   │   ├── index.html         # page structure                   (Role 2; input panel block: Role 3)
   │   ├── sample_result.json # worked-example result            (Role 1)
   │   ├── css/
   │   │   ├── style.css      # theme, layout, animation         (Role 2)
   │   │   └── input.css      # input panel styles               (Role 3)
   │   └── js/
   │       ├── player.js      # playback controller              (Role 2)
   │       ├── gantt.js       # Gantt drawing                    (Role 2)
   │       ├── main.js        # Run button, fetch, wiring        (Role 2)
   │       └── input.js       # input form, browser validation   (Role 3)
   ├── tests/                 # engine and API tests             (Role 3)
   └── docs/                  # document, manual, slides         (Roles 4 and 5)
   ```
2. Each member edits only their own files; changes to shared files are discussed first.
3. Commit small and often; push at the end of every work session.
4. **Feature freeze on October 10 night.** After that, bug fixes only.
5. **Every member must be able to explain the algorithm.** A 15-minute walkthrough of the worked example (Section 2) is held so everyone can explain preemption and the metrics during the defense.
6. Keep a backup of the final app and document on a USB drive and in cloud storage.

---

## 11. Demo Day Plan

**Before the presentation**
- Install Python and Flask on the presentation laptop and run the full system there at least once before October 12.
- Start the server (`python app.py`) and open the page **before** the presentation begins.
- Keep a **screen recording** of a full successful run as a backup in case of technical problems.

**Demo script (about 5–7 minutes)**

| Step | Presenter | What happens |
|---|---|---|
| 1 | Role 5 | Introduces the system and the SRTF algorithm (1 min) |
| 2 | Role 1 | Loads sample data, presses Run, narrates the preemption at time 1 (2 min) |
| 3 | Role 2 | Points out the ready queue, CPU panel, and event log; explains the metrics table (1 min) |
| 4 | Role 3 | Shows input validation with a bad value, then adds a custom process live (1 min) |
| 5 | Role 1 | Demonstrates an idle gap (first process arrives at time 3) (30 sec) |
| 6 | Role 4 | States scope and limitations, then opens for questions (1 min) |

---

## 12. Pre-Submission Checklist

**Functionality**
- [ ] Worked example gives exactly: average WT 6.5, average TAT 13.0
- [ ] Idle gaps, ties, and simultaneous arrivals handled
- [ ] Invalid input is rejected by both the browser and the server, with no crashes
- [ ] Server starts with `python app.py` on a clean machine after `pip install -r requirements.txt`

**Design / Animation**
- [ ] Gantt animates smoothly at every speed
- [ ] Colors are consistent across all panels
- [ ] Preemption is clearly visible
- [ ] Page displays correctly in the browser used for the demo

**Documentation**
- [ ] Title page matches the UNP-CCIT format
- [ ] All required sections present, all programming languages stated
- [ ] APA 7th references, alphabetical, hanging indent
- [ ] Screenshots match the final UI

**User-friendliness**
- [ ] A first-time user can run a simulation within one minute without help

---

## 13. Technical Tips

- Keep the engine a **pure function** (data in, data out, no Flask imports) so it is easy to test.
- Test order: worked example first, then edge cases (single process, all arrive at 0, identical burst times, long idle gap).
- Build the frontend against `sample_result.json` first; the live server comes after the animation works.
- Use `setTimeout` for the playback loop and CSS `transition` for bar growth. Avoid busy-wait loops, which freeze the page.
- Store process colors in one object (`pid → color`) shared by every panel.
- While developing, hard-refresh the browser (Ctrl+Shift+R) after changing CSS or JavaScript, since cached files cause confusing results.
- Confirm with the instructor early that the title page format and a multi-language system (Python backend with a web frontend) are acceptable.