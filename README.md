# SRTF Scheduler Simulator

An Operating Systems learning project that computes **Shortest Remaining Time First (SRTF)** schedules in Python and replays them in a browser. Flask serves the page and the stateless JSON API. The frontend displays backend results; it does not calculate scheduling decisions or process metrics.

## The algorithm

- At each integer time unit, the available process with the smallest remaining burst runs.
- A shorter arriving process may preempt the current process.
- Equal remaining times keep the running process, then prefer earlier arrival, then the lexicographically smaller PID (`P10` comes before `P2`).
- One CPU, no I/O bursts or priorities, and zero context-switch cost.

| Metric | Formula |
|---|---|
| Turnaround time (TAT) | Completion time − Arrival time |
| Waiting time (WT) | TAT − Burst time |
| Response time (RT) | First CPU start − Arrival time |

The **Load Sample** workload is the canonical reference:

| PID | Arrival | Burst |
|---|---|---|
| P1 | 0 | 8 |
| P2 | 1 | 4 |
| P3 | 2 | 9 |
| P4 | 3 | 5 |

Gantt: `P1 [0–1] | P2 [1–5] | P4 [5–10] | P1 [10–17] | P3 [17–26]`

Expected averages: **WT = 6.50, TAT = 13.00, RT = 4.25**.

## Setup and execution

Requires Python 3.10+, Flask, and a modern browser. Node.js 18+ is optional for frontend regression tests; there are no npm dependencies.

```sh
git clone https://github.com/Furina-star/srtf-simulator
cd srtf-simulator
python -m venv .venv
```

Activate the environment using the command for your shell:

```powershell
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
```

```sh
# Git Bash on Windows
source .venv/Scripts/activate
# macOS / Linux
source .venv/bin/activate
```

Then install dependencies and start Flask:

```sh
python -m pip install -r requirements.txt
python app.py
```

Open **http://127.0.0.1:5000**. Stop the server with Ctrl+C. Open the page through Flask; double-clicking the HTML file or using a separate static server does not provide `/simulate`.

For development, `python -m pip install -r requirements-dev.txt` installs Flask and pytest together.

## Live demo and deployment

**Live demo:** https://srtf-simulator.onrender.com

The deployed site runs the same Flask app under Gunicorn. The host installs `requirements.txt` and starts the app with:

```sh
gunicorn app:app
```

`python app.py` is for local use only; it listens on `127.0.0.1`. Gunicorn does not run on Windows, so use `python app.py` there. The app keeps no state and has no database, so the number of workers does not affect results. Free hosting plans may put an idle app to sleep, so open the live URL a minute before any demonstration.

## Using the simulator

Five unused rows start with editable P1–P5 suggestions. Fill any 1–15 rows, or load the four-process sample. Rows with **both time fields blank** are ignored; a row with only one time is invalid. The badge separately displays the number of active rows and all visible rows. Add Row suggests an unused PID. Removing a row never renames the others.

PIDs are trimmed, case-sensitive, unique, and 1–32 Unicode characters. `IDLE` is reserved. Arrival must be a nonnegative integer and burst a positive integer. Numeric inputs use decimal digits; fractions, exponent notation, non-finite values, and integers outside JavaScript's safe range are rejected. The server remains authoritative for the 10,000-unit timeline limit, including idle time, and the 16 KiB request limit.

| Control | Behavior |
|---|---|
| Run SRTF | Validates and requests a backend result; displays time 0, paused, with its start events. Disabled while requesting. |
| Play | Advances one simulation unit per timer tick. |
| Pause | Cancels the timer and keeps the current time. |
| Step Forward | While paused, completes one unit and displays the next boundary. |
| Jump to End | Immediately displays the final chart, events, and metrics without timed playback. |
| Timeline slider | Seeks to a selected boundary, reconstructing CPU state, log, and completed work from the Python response. |
| Reset | Stops playback and rewinds the same result to time 0, clearing final metrics and later events. During a request, cancels it; Run is then required. Keeps inputs. |
| Playback Speed | 1–20 units per second; changes the next timer delay immediately. |
| Clear all | Cancels requests/playback and removes all rows and results. |
| Load Sample | Cancels previous work and loads the four reference rows; press Run afterward. |
| Add/remove/edit a row | Cancels previous work and invalidates its results immediately. |
| Theme button | Toggles light/dark mode; remembers it when browser storage is available. |

The CPU and ready queue show `steps` snapshots and their remaining work. Arrivals/preemptions appear at tick start; completions appear at tick end, before arrivals at the same boundary. Final metrics and averages appear only after the last tick. CPU utilization is busy Gantt duration divided by total timeline duration.

Consecutive idle events are collapsed into one visible interval in the log; the backend event data stays unchanged. Invalid fields are highlighted and CPU arrivals/preemptions receive brief visual emphasis (except when reduced motion is requested).

The Gantt chart uses 48 pixels per time unit, labels interval boundaries, marks preemptions in red, and stripes idle blocks. It scrolls horizontally and follows playback. Long PIDs are shortened visually within blocks; hover for the full PID and interval. Full PIDs remain visible in the CPU/queue/results.

## Architecture and files

```text
app.py                       Flask routes and JSON errors
engine.py                    Validation, SRTF steps, Gantt, metrics, averages
requirements.txt             Runtime dependencies (Flask, Gunicorn)
requirements-dev.txt         Runtime dependencies and pytest
pytest.ini                   Test import configuration
static/index.html            Input, playback, CPU/queue, chart, log, results
static/js/script.js          Validation, requests, cancellation, and replay
static/css/style.css         Responsive layout and light/dark themes
static/sample_result.json    Canonical backend fixture (do not regenerate casually)
tests/test_engine.py         Engine regression tests
tests/test_app.py            API, validation, and static asset tests
tests/test_frontend.cjs      Dependency-free Node controller/DOM-adapter tests
docs/INTERFACE_CONTRACT.md   Public JSON contract and scheduling details
docs/document/               Written report
docs/manual/                 User manual
docs/slides/                 Presentation slides
docs/screenshots/            Images for the manual and slides
.github/workflows/tests.yml  Automated tests on every push and pull request
```

`POST /simulate` sends `{ "processes": [{ "pid": "P1", "arrival": 0, "burst": 8 }] }` and receives `steps`, `gantt`, `metrics`, and `averages`. HTTP 400 and 413 use `{ "error": "..." }`. The frontend validates the response before rendering, handles connection/non-JSON errors, and ignores stale responses after cancellation. There is no database or automatic offline fixture fallback. See the [interface contract](docs/INTERFACE_CONTRACT.md).

## Testing

From the repository root, with development dependencies installed:

```sh
python -m pytest -q
python engine.py
node --check static/js/script.js
node --test tests/test_frontend.cjs
```

Every push and pull request also runs these checks through GitHub Actions (`.github/workflows/tests.yml`); the Actions tab shows whether the latest run passed.

The Node suite uses a small DOM adapter and controllable timers. It tests input mapping, unsafe text, response validation, HTTP/network errors, request races, event ordering, Gantt proportions, and 10,000-tick playback. It does **not** test browser layout. Seven live HTTP tests are skipped unless a server URL is provided.

To include those tests, run `python app.py` in another terminal, then:

```powershell
# PowerShell
$env:SRTF_TEST_URL = 'http://127.0.0.1:5000'
node --test tests/test_frontend.cjs
Remove-Item Env:SRTF_TEST_URL
```

```sh
# Bash
SRTF_TEST_URL=http://127.0.0.1:5000 node --test tests/test_frontend.cjs
```

## Development workflow

Start a feature branch from the latest main with a clean working tree:

```sh
git fetch origin main
git switch -c fix/my-change origin/main
```

The `main` branch is protected: changes reach it only through a pull request, and direct pushes are blocked. Run the regression suites before proposing a commit or PR. Coordinate changes across the frontend and backend using the interface contract. Do not commit virtual environments or local editor settings.

Python files use a descriptive module docstring at the top and concise comments for functions/classes and non-obvious logic. JavaScript, HTML, and CSS use language-specific introductory and explanatory comments.

## Documentation

Detailed technical documentation is available in the `docs/` directory:

| Document | Description |
|---|---|
| [Frontend Guide](docs/FRONTEND_GUIDE.md) | Explains the frontend architecture, playback controls, state management, and backend integration. |
| [Interface Contract](docs/INTERFACE_CONTRACT.md) | Defines the API request/response structure, validation rules, scheduling events, and metrics. |
| [Deployment Guide](docs/DEPLOYMENT.md) | Provides instructions for deploying the application using Render and Gunicorn, including troubleshooting. |

## Status and limitations

- [x] SRTF engine, validation, Flask routes, and canonical sample fixture
- [x] Editable input rows and matching sample workload
- [x] Backend communication, response checks, cancellation, and error feedback
- [x] Tick playback, CPU state, ready queue, chronological events, proportional Gantt
- [x] Final metrics/averages and light/dark styling
- [x] Backend and lightweight frontend regression tests, including live HTTP checks
- [x] Visual checks across browsers, small screens, and the presentation laptop
- [ ] Written academic report, user manual with screenshots, and presentation slides

The model assumes known CPU bursts, with no multicore or I/O scheduling. Long jobs can starve; the simulator does not prevent starvation. Workloads are limited to 15 processes and 10,000 time units. Long runs need horizontal scrolling and can take several minutes at maximum playback speed unless the user jumps or seeks directly. Timers may slow in background tabs without changing event order. Random workload generation and export are not implemented.