# Frontend Guide

This guide is for the two frontend developers. It explains what to build, who owns which file, how the page talks to the backend, and how to use Git.

**Key idea:** the backend does all the scheduling. The frontend never calculates a schedule. It sends the process list, receives a finished result, and **replays it as an animation**.

---

## 1. Split of work

| | Frontend A (Animation) | Frontend B (Input and wiring) |
|---|---|---|
| **Files** | `static/js/player.js`, `static/js/gantt.js`, `static/js/ui.js`, `static/css/style.css` | `static/index.html`, `static/js/input.js`, `static/js/main.js`, `static/css/input.css` |
| **Builds** | Playback controls logic, Gantt chart animation, CPU panel, ready queue, event log, results table | Page structure, process input form and table, validation, sample/random/clear buttons, Run button and the call to the backend |

Edit only your own files. If the other developer's file needs a change, ask them.

`index.html` needs a `<script>` tag for every JS file and a `<link>` for every CSS file. Frontend B owns it, so Frontend A asks B to add anything new. Script order: `input.js`, `gantt.js`, `ui.js`, `player.js`, then `main.js` last.

## 2. What each file does

| File | Job |
|---|---|
| `index.html` | The page: all panels and buttons, each with an `id` the scripts use |
| `input.js` | Reads what the user types, adds and removes table rows, validates, handles Load Sample, Random, and Clear, and returns the list of processes |
| `main.js` | The conductor. On Run it takes the processes from `input.js`, sends them to the backend, gets the result, creates the `Player`, and connects the Play, Pause, Step, Reset, and Speed buttons |
| `player.js` | Works like a video player. It holds the list of steps and a position in it. Play, Pause, Step, and Reset move that position, and for each step it tells the page what to draw |
| `gantt.js` | Draws and animates the Gantt chart blocks and the time ruler |
| `ui.js` | Updates the clock, the CPU panel, the ready queue, the event log, and the results table |
| `style.css` / `input.css` | Layout, colors, and animation styles |

## 3. Flow of the page

1. The user fills the table (or presses **Load Sample**) and presses **Run**.
2. `main.js` sends the processes to the backend and receives the **result**.
3. A `Player` is created from the result.
4. **Play** replays the result one time unit at a time. Each tick updates the Gantt chart, the CPU panel, the ready queue, and the event log.
5. After the last step, the results table and averages appear.

## 4. The data format (no scheduling knowledge needed)

Treat the backend as a black box. You send a list in one shape and get back one object in another shape. The full definition is in `docs/INTERFACE_CONTRACT.md`. A working example is `static/sample_result.json`.

### What you send

```json
{ "processes": [ {"pid": "P1", "arrival": 0, "burst": 8}, {"pid": "P2", "arrival": 1, "burst": 4} ] }
```

### What you get back, in plain words

| Field | Meaning |
|---|---|
| `steps` | A film strip. **Each entry is one second of CPU time.** Draw one entry per tick. |
| `steps[i].time` | Which second this is (0, 1, 2, ...) |
| `steps[i].running` | Who has the CPU this second (`"P1"`, `"P2"`, ... or `"IDLE"` if nobody has arrived yet) |
| `steps[i].ready` | Who is waiting in line this second, already in the right order. **Draw the ready queue from this list.** |
| `steps[i].remaining` | How much work each process has left at the start of this second |
| `steps[i].events` | Things to announce in the event log this second |
| `gantt` | The finished chart, already merged into blocks (the animation is built from `steps`; this is for checking) |
| `metrics` | One row per process for the results table (completion, turnaround, waiting, response) |
| `averages` | The three averages shown under the results table |

> **Careful:** `remaining` lists **every** process, including ones that have not arrived yet. Do not show a process in the queue just because it appears in `remaining`. Use `ready` for the queue.

### Event types

| `type` | What it means | What the page should do |
|---|---|---|
| `arrival` | A process just arrived | Add its chip to the ready queue with a short highlight |
| `preempt` | The running process was interrupted by a shorter one (`pid` was interrupted, `by` took over) | Red marker at that point on the Gantt chart, red log line, brief flash on the CPU panel |
| `complete` | A process finished | Gray out its row, add a log line |
| `idle` | Nobody to run | Striped gray IDLE block on the Gantt chart; CPU panel shows IDLE |

Each event also has `text` (ready to print in the log) and `pid`.

## 5. Talking to the backend

**No JSON file is created.** JSON is just text sent over the connection and nothing is saved.

```js
// 1. Build the list from the table (this is what input.js returns)
const processes = [ {pid: "P1", arrival: 0, burst: 8}, {pid: "P2", arrival: 1, burst: 4} ];

// 2. Send it
const response = await fetch("/simulate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ processes })        // JavaScript object -> JSON text
});

// 3. Receive it
const result = await response.json();         // JSON text -> JavaScript object

if (!response.ok) {
  showError(result.error);                    // backend sends {"error": "..."} on bad input
  return;
}
// result.steps, result.gantt, result.metrics, result.averages are now ready to use
```

### Develop first with the sample file, switch to the real backend later

The backend may not be finished when you start. Until it is, load the sample instead:

```js
const response = await fetch("/static/sample_result.json");   // fake backend reply
const result = await response.json();
```

When the backend is ready, replace those two lines with the `fetch("/simulate", ...)` version. Nothing else changes, because both return the same shape.

### Running the page

**Do not double-click `index.html`.** Opening it as a file breaks `fetch`. Use one of these:

- **VS Code Live Server extension:** open the **project root folder** in VS Code, right-click `static/index.html`, choose *Open with Live Server*.
- **Flask:** once `app.py` serves the page, run `python app.py` and open `http://127.0.0.1:5000`.

**Always use paths that start with `/static/`** in `index.html` and in `fetch`, for example `/static/css/style.css`, `/static/js/main.js`, `/static/sample_result.json`. That way they work under both Live Server and Flask.

Press **F12 → Network** in the browser to see exactly what was sent and received when something goes wrong.

## 6. How the animation works

### Player (`player.js`)

The player holds `steps` and a counter `i`. Each tick it shows `steps[i]` and increases `i`.

- **Play:** repeat the tick using `setTimeout(tick, delay)`.
- **Pause:** stop the timer. **Play** resumes from the same `i`.
- **Step:** show exactly one step and do not start the timer.
- **Reset:** set `i = 0` and clear the chart, queue, log, and results.
- **Speed slider:** changes `delay` (for example `delay = 1100 - sliderValue * 100`), even while playing.
- After the last step, show the results table and averages.

Per step, the player calls the drawing functions: update the clock, the CPU panel (running process and its remaining time), the ready queue (from `ready`), the Gantt chart, and the event log (from `events`).

### Gantt chart (`gantt.js`)

- One time unit is a fixed width in pixels (for example 48 px).
- Each block is an absolutely positioned `div`: `left = start × unit`, `width = length × unit`.
- If the running process is the same as the previous step, **grow** the existing block by one unit. If it is different, create a new block starting at zero width and grow it.
- Smooth growth comes from a CSS `transition` on `width`. Set `transition-duration` equal to the current delay so the bar grows continuously.
- Show a time tick under the right edge of each new unit. When the chart is wider than the screen, scroll to keep the newest block in view.
- `IDLE` blocks use light gray with diagonal stripes.

### Look and feel (`style.css`)

- **One fixed color per process**, used everywhere (Gantt bar, ready-queue chip, CPU panel, results table). Keep one object, for example `pid -> color`, shared by all scripts.
- Suggested palette: `#4E79A7, #F28E2B, #E15759, #76B7B2, #59A14F, #EDC948, #B07AA1, #FF9DA7, #9C755F, #BAB0AC`.
- CSS variables for the theme, CSS Grid for the page layout, Flexbox inside panels.
- Preemption uses red. Text on bars must be readable against the bar color.

## 7. Controls

| Control | Behavior |
|---|---|
| **Run** | Validates, gets the result, creates the Player, shows time 0 |
| **Play / Pause** | Starts or stops the replay |
| **Step** | Advances one time unit |
| **Reset** | Clears chart, queue, log, and results. Keeps the process table |
| **Speed** | Changes the delay immediately |
| **Clear** | Empties the process table and the display |
| **Load Sample** | Fills the table with the 4 sample processes |
| **Random** | Fills the table with valid random processes |

Disable buttons that make no sense: Play before Run, Step after the last step.

### Input rules (browser-side validation)
- Arrival is a whole number, 0 or more. Burst is a whole number, 1 or more.
- PID cannot be blank or duplicated. Suggest the next PID (P1, P2, P3, ...) automatically.
- Maximum 15 processes.
- Show a clear message next to the field. Never let the page crash.
- If the server cannot be reached, show: "Could not reach the simulator server. Is app.py running?"

## 8. Git workflow (Git Bash)

### One-time setup

```bash
git clone https://github.com/Furina-star/srtf-simulator
cd srtf-simulator
git checkout frontend

python -m venv .venv
source .venv/Scripts/activate        # Git Bash on Windows
pip install -r requirements.txt
```

### Every work session

```bash
git checkout frontend
git pull origin frontend             # get your partner's latest work FIRST

# ... work on your own files ...

git add .
git commit -m "Describe what you changed"
git pull origin frontend             # again, in case your partner pushed meanwhile
git push origin frontend
```

### Rules
- **Pull before you start. Pull again before you push.**
- Only edit your own files.
- Never commit the `.venv` folder.
- Commit small and often. Push at the end of every work session.
- If a push is rejected, run `git pull origin frontend` and push again.
- If a merge conflict appears, do not panic. Ask the backend developer before changing anything.
- Only the backend developer merges into `main`.

## 9. Checklist

**Frontend B**
- [ ] Page structure with all ids in place and scripts linked with `/static/...` paths
- [ ] Input form adds and removes rows, validates, and shows clear messages
- [ ] Load Sample, Random, and Clear work
- [ ] Run sends the data and handles both the success and the error response

**Frontend A**
- [ ] Gantt chart builds block by block with smooth growth
- [ ] CPU panel, ready queue, and event log update every step
- [ ] Preemption is clearly visible
- [ ] Play, Pause, Step, Reset, and Speed all work
- [ ] Results table and averages appear after the last step
- [ ] Colors are consistent across all panels

**Both**
- [ ] Works with `static/sample_result.json`
- [ ] Works with the real backend
- [ ] Looks fine at different window sizes
- [ ] A first-time user can run a simulation in under one minute without help