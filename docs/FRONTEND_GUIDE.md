# Frontend Implementation Guide

[Repository README](../README.md) · [Interface contract](INTERFACE_CONTRACT.md) · [Deployment guide](DEPLOYMENT.md)

## Responsibilities and files

The web interface **replays an already computed Python schedule**. `engine.py` owns SRTF decisions and process metrics. `app.py` serves the frontend and the stateless `POST /simulate` API. Do **not** add separate scheduling or metric calculation logic in JavaScript.

| File | Responsibility |
|---|---|
| `../static/index.html` | Process inputs, controls, CPU panel, ready queue, chart, logs, final table |
| `../static/js/script.js` | Input validation, API requests, cancellation, timeline state, playback, safe DOM rendering |
| `../static/css/style.css` | Responsive layout, themes, time-scale styling, input errors, highlight animations |
| `../static/sample_result.json` | Canonical Python result shared by tests |
| `../tests/test_frontend.cjs` | Node DOM/timer-adapter checks and optional live Flask HTTP tests |

Open the frontend via `python app.py` and http://127.0.0.1:5000, **not** via `file://` or a separate static server; otherwise the `/simulate` endpoint is missing.

## Input rules

- Five blank-time rows are initially shown, with editable PIDs `P1` through `P5`.
- Rows with both time fields empty are ignored. One missing time field is invalid. The badge shows **active rows** and **visible rows** separately.
- A submission requires **1–15** valid processes. Add Row stops at 15 visible rows, including blank ones.
- PID: trimmed, unique, case-sensitive, **1–32 Unicode characters**; exact uppercase `IDLE` is reserved.
- Arrival: decimal whole number **≥ 0**. Burst: decimal whole number **≥ 1**. The browser rejects non-decimal, fractional, non-finite, and unsafe JS integers.
- Removing a row does not rename other PIDs. Inline validation identifies and highlights the invalid field; editing resets the warning.
- The backend remains authoritative for the **10,000-unit simulated timeline** and **16 KiB request** limits.
- **Load Sample** uses `P1(0,8), P2(1,4), P3(2,9), P4(3,5)`.

The frontend posts `{ "processes": [{ "pid": "P1", "arrival": 0, "burst": 8 }, ...] }`. Exact JSON shapes and error status codes are in the [interface contract](INTERFACE_CONTRACT.md).

## Request and cancellation lifecycle

1. **Run SRTF** validates input, clears old output, and sends a `fetch()` POST to `/simulate`.
2. An `AbortController` tracks the active request. Repeated Run is ignored while that request is pending.
3. Any input edit, add/remove, Clear All, or Load Sample invalidates old results and aborts the pending request. A version counter also prevents late responses or JSON parsing from overwriting newer state.
4. On HTTP 200, the frontend checks the response structure (`steps`, `gantt`, `metrics`, `averages`) and stores it for playback. It does not recompute which process runs.
5. HTTP 400/413 errors, non-JSON responses, and unreachable-server errors display a readable message with stale results removed. PIDs/event text/API messages enter the DOM through safe text operations, not `innerHTML`.

## Playback: one boundary at a time

Let `steps[t]` represent the Python snapshot **at the start of time unit `t`**. It includes `running`, `ready`, and `remaining` before that unit executes. An event's `at` value is its true timestamp.

| Control | Behavior |
|---|---|
| Run | Displays time 0 paused with its start events; final metrics remain hidden |
| Play | Advances one time unit per timer callback |
| Pause | Stops the outstanding timer, keeping current boundary |
| Step Forward | Completes one unit and shows the next boundary |
| Speed | Adjusts playback between **1–20 units/second** |
| Reset | Rewinds the saved result to time 0 and clears later logs/metrics; if a request is pending, cancels it |
| Jump to End | Seeks to the final boundary without replaying thousands of timers |
| Timeline slider | Seeks to an integer boundary, reconstructing log, CPU state, Gantt, and results from the saved Python response |

**Ordering matters:** arrivals and preemptions happen at the **start** of a tick; completion events occur at the **end** (timestamp `t+1`). If a completion and arrival share a boundary, display completion from the previous step before the new step's arrival. `prepareStep()` handles start events, `advance()` handles completed ticks, and `seekToTime()` reconstructs the same chronology. Seeking does not send a new API request.

The waiting queue is exactly `steps[t].ready`. Do not show future processes from `remaining` merely because their PIDs exist in the dictionary. Final per-process metrics and averages are shown **only at the last boundary**.

## Gantt chart and logs

- The frontend clips `gantt` intervals from Python at the current playback time. Each unit uses a fixed **48-pixel** horizontal scale; intervals are `[start, end)`.
- CPU idle periods are striped; preemption is marked. Long PIDs are abbreviated inside narrow blocks, with the full name in titles and elsewhere in the UI.
- The current CPU border and waiting queue chips are colored by process. Arrivals/preemptions have brief visual highlighting; reduced-motion preferences suppress animation.
- Consecutive idle events are **visually grouped** in the log. The backend still returns the complete tick/event history.
- CPU utilization is the only result derived for display in JavaScript: `(sum of non-IDLE Gantt durations / total simulated steps) × 100`.

## Quality checks

From the repository root:

```sh
python -m pip install -r requirements-dev.txt
python -m pytest -q
python engine.py
node --check static/js/script.js
node --test tests/test_frontend.cjs
```

The Node test suite uses a simulated DOM/timer adapter, so it does **not** measure real CSS layout, browser painting, or timer throttling. Seven optional HTTP integration cases are skipped without `SRTF_TEST_URL`.

For those real HTTP cases, run `python app.py` in one terminal. In another PowerShell terminal:

```powershell
$env:SRTF_TEST_URL = 'http://127.0.0.1:5000'
node --test tests/test_frontend.cjs
Remove-Item Env:SRTF_TEST_URL
```

## Manual browser review checklist

This is a **suggested checklist**, not a claim that tests were performed. The project tester should record actual observations separately.

- [ ] **Reference:** Load Sample → Run → Jump to End. Final time **26**, averages WT **6.50**, TAT **13.00**, RT **4.25**.
- [ ] **Preemption:** P1 `(0,4)`, P2 `(1,1)` → P2 runs at t=1 and P1 resumes after it completes.
- [ ] **Idle:** P1 `(3,2)` → CPU is idle for `[0,3)` and utilization is **40%**.
- [ ] **Input limits:** One, five, fifteen processes; duplicate/empty PID; reserved `IDLE`; negative arrival; burst 0; 16 processes rejected by direct API.
- [ ] **Playback:** Play, Pause, Step, Reset, Speed, slider seeking both directions, Jump to End, and seeking backward after completion.
- [ ] **Race conditions:** Edit inputs or Clear while running; old results/timers never return. Retry after network failure.
- [ ] **Safe text:** An HTML-like PID displays literally, not as markup.
- [ ] **Responsive layout:** Inspect mobile (~375 px), tablet (~768 px), desktop (~1440 px), and both themes.
- [ ] **Long timeline:** Test a late arrival near the 10,000-unit cap, including slider response, log grouping, and scrollability.
- [ ] **Free hosting:** Allow for Render startup after inactivity and confirm Run works at the public URL.

## Known limitations and maintenance notes

The browser may throttle playback timers in background tabs. A 10,000-unit animated replay is slow at 1–20×; **Jump to End** avoids waiting. Seeking a long timeline reconstructs earlier logs each time and can become slower on constrained devices. The simulator has no random process generator, export, persistence, context-switch cost, or multicore support.

If API fields or tie-breaking change, first update the [interface contract](INTERFACE_CONTRACT.md), `static/sample_result.json`, and relevant regression tests; then update this guide and the [repository README](../README.md).
