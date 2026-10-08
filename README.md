# SRTF Scheduler Simulator

A web-based simulator that visualizes **Shortest Remaining Time First (SRTF)** CPU scheduling, also known as Preemptive Shortest Job Next (SJN). The user enters processes, runs the simulation, and watches an animated Gantt chart show which process holds the CPU, which are waiting, and when preemptions happen.

> Course project — Operating Systems

---

## Table of Contents
1. [About the Project](#about-the-project)
2. [The Algorithm](#the-algorithm)
3. [Features](#features)
4. [Technology Stack](#technology-stack)
5. [Project Structure](#project-structure)
6. [Getting Started](#getting-started)
7. [How to Use](#how-to-use)
8. [Branches](#branches)
9. [Git Workflow](#git-workflow)
10. [Scope and Limitations](#scope-and-limitations)
11. [Project Status](#project-status)
12. [References](#references)

---

## About the Project

Scheduling algorithms are easy to get wrong when traced by hand. This simulator runs SRTF on a user-defined set of processes and replays the result as an animation, together with the computed metrics, so that preemption and waiting time can be seen step by step.

## The Algorithm

- At every time unit, the CPU runs the process with the **smallest remaining burst time** among those that have arrived.
- If a newly arrived process has a shorter remaining time than the running one, the running process is **preempted**.
- Ties: keep the running process, then earlier arrival, then lower PID.

| Metric | Formula |
|---|---|
| Turnaround Time (TAT) | Completion Time − Arrival Time |
| Waiting Time (WT) | TAT − Burst Time |
| Response Time (RT) | First CPU start − Arrival Time |

Reference example (default sample and primary test case):

| PID | Arrival | Burst |
|---|---|---|
| P1 | 0 | 8 |
| P2 | 1 | 4 |
| P3 | 2 | 9 |
| P4 | 3 | 5 |

Expected Gantt chart: `P1 [0–1] | P2 [1–5] | P4 [5–10] | P1 [10–17] | P3 [17–26]`
Expected averages: **WT = 6.5, TAT = 13.0**.

## Features

- Add, remove, and clear processes
- Correct SRTF with preemption and CPU idle gaps
- Animated Gantt chart with play, pause, step, reset, and speed control
- Live ready queue, CPU status panel, and event log
- Results table with completion, turnaround, waiting, and response times plus averages
- Input validation in the browser and on the server
- Sample data and random process generator

*(Features are planned; see [Project Status](#project-status).)*

## Technology Stack

| Layer | Technology |
|---|---|
| Scheduling engine | Python 3 |
| Server | Flask |
| Interface and animation | HTML5, CSS3, JavaScript |
| Version control | Git and GitHub |

## Project Structure

```
srtf-simulator/
├── app.py                  # Flask server and validation
├── engine.py               # SRTF engine (pure Python)
├── requirements.txt        # Runtime dependencies (Flask)
├── requirements-dev.txt    # Development and test dependencies (pytest)
├── pytest.ini              # Makes plain pytest find engine.py
├── tests/
│   ├── test_engine.py      # Scheduling and validation tests
│   └── test_app.py         # Flask endpoint tests
├── static/
│   ├── index.html          # page structure
│   ├── sample_result.json  # worked-example result for frontend development
│   ├── css/
│   │   ├── style.css       # theme, layout, animation
│   │   └── input.css       # input panel styles
│   └── js/
│       ├── player.js       # playback controller
│       ├── gantt.js        # Gantt chart drawing
│       ├── ui.js           # CPU panel, ready queue, event log, results table
│       ├── main.js         # Run button and wiring
│       └── input.js        # input form and browser validation
├── docs/
│   ├── INTERFACE_CONTRACT.md   # JSON agreement between Python and browser
│   ├── FRONTEND_GUIDE.md       # guide for the frontend developers
│   ├── document/               # written document
│   ├── manual/                 # user manual
│   ├── slides/                 # presentation slides
│   └── screenshots/            # images for the manual
├── .gitignore
└── README.md
```

## Getting Started

### Requirements
- Python 3.10 or newer
- A modern web browser (Chrome, Edge, or Firefox)
- Git

### Installation

```bash
git clone https://github.com/Furina-star/srtf-simulator
cd srtf-simulator

# create a virtual environment
python -m venv .venv

# activate it (use the line that matches your terminal)
source .venv/Scripts/activate      # Git Bash on Windows
.venv\Scripts\Activate.ps1         # Windows PowerShell
source .venv/bin/activate          # macOS / Linux

pip install -r requirements.txt
```

To run automated tests, install the development dependencies (including `pytest`):

```bash
pip install -r requirements-dev.txt
```

`requirements-dev.txt` includes the normal application dependencies, so you can also install only that file when developing.

### Run

```bash
python app.py
```

Then open **http://127.0.0.1:5000** in a web browser.

### Run Tests

From the repository root (the directory containing `pytest.ini`), run:

```bash
pytest
```

`python -m pytest` also works. The `pytest.ini` file adds the repository root to the module search path, so both commands can import `engine.py`.

## How to Use

1. Enter a PID, arrival time, and burst time, then press **Add**. Repeat for each process, or press **Load Sample**.
2. Press **Run** to compute the schedule.
3. Press **Play** to watch the Gantt chart build, or **Step** to advance one time unit at a time. Use the **Speed** slider to change the pace.
4. Read the results table and averages once the animation ends.
5. Press **Reset** to replay, or **Clear** to start over.

*(A full user manual with screenshots will be added in `docs/manual/`.)*

## Branches

| Branch | Purpose |
|---|---|
| `main` | Stable, working version. Only finished work is merged here. |
| `backend` | Python engine and Flask server (`app.py`, `engine.py`). |
| `frontend` | Web interface and animation (everything in `static/`). |

Work is done on `backend` or `frontend` and merged into `main` when it works. The JSON format exchanged between the two sides is defined in [`docs/INTERFACE_CONTRACT.md`](docs/INTERFACE_CONTRACT.md); frontend setup and responsibilities are in [`docs/FRONTEND_GUIDE.md`](docs/FRONTEND_GUIDE.md).

## Git Workflow

Commands are for **Git Bash**. The example uses the `frontend` branch; the backend developer uses the same commands with `backend`.

### Every work session

```bash
git checkout frontend
git pull origin frontend           # get the other member's latest work first
# ... work on your own files ...
git add .
git commit -m "Describe what changed"
git pull origin frontend           # again, in case the partner pushed meanwhile
git push origin frontend
```

### Rules

- Pull before you start, and pull again before you push.
- Edit only your own files.
- Never commit the `.venv` folder.
- Commit small and often, and push at the end of every work session.
- If a push is rejected, run `git pull origin frontend` and push again.
- Only Furina merges into `main`.

## Scope and Limitations

**Scope:** single CPU; integer arrival and burst times; no I/O bursts; no priorities; zero context-switch cost; one simulation at a time; runs locally in a web browser.

**Limitations:** burst times must be known in advance; no multi-core support; no I/O wait modeling; starvation of long processes is demonstrated but not prevented; requires Python and Flask to run; limited to 15 processes; intended for learning, not for real OS scheduling.

## Project Status

- [x] Repository and project structure
- [x] Interface contract drafted (`docs/INTERFACE_CONTRACT.md`)
- [x] Sample result file for frontend development (`static/sample_result.json`)
- [ ] SRTF engine
- [ ] Flask server and validation
- [ ] Frontend layout
- [ ] Gantt animation and playback controls
- [ ] Input form and browser-side validation
- [ ] Manual testing against the expected-results table
- [ ] Written document (title page, introduction, references)
- [ ] User manual
- [ ] Presentation slides
- [ ] Final testing on the presentation laptop

## References

The reference list (APA 7th edition) is maintained in `docs/document/`.