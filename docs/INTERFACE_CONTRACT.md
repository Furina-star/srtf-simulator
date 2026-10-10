# Frontend–Backend Interface Contract

[Repository README](../README.md) · [Frontend guide](FRONTEND_GUIDE.md) · [Deployment guide](DEPLOYMENT.md)

This contract describes the current Python **`engine.py` → `app.py` → browser** interface. Scheduling and per-process metrics are computed in Python; JavaScript validates and replays the result. Changes to this schema or scheduling rules require coordinated backend/frontend updates and regression checks. The complete reference response is [`../static/sample_result.json`](../static/sample_result.json).

## Endpoint and input

**`POST /simulate`** with header **`Content-Type: application/json`**.

```json
{
  "processes": [
    {"pid": "P1", "arrival": 0, "burst": 8},
    {"pid": "P2", "arrival": 1, "burst": 4},
    {"pid": "P3", "arrival": 2, "burst": 9},
    {"pid": "P4", "arrival": 3, "burst": 5}
  ]
}
```

Each process has `pid` (string), `arrival` (integer), and `burst` (integer). See [input limits](#input-limits) for complete validation rules. The Flask application serves the same-origin page at `GET /` and browser assets under `/static/`.

## Successful response: HTTP 200

The response has exactly the four top-level categories used by the frontend:

- `steps`: per-time-unit snapshots and timestamped events.
- `gantt`: contiguous CPU assignment intervals, including idle time.
- `metrics`: per-process CT, TAT, WT, RT data keyed by trimmed PID.
- `averages`: mean turnaround, waiting, and response times, rounded to two decimal places.

The example below is **illustrative and abbreviated**, not the full response. It shows only the time-1 step, two Gantt blocks, and one process metric. Use the JSON fixture for all time units.

```json
{
  "steps": [
    {
      "time": 1,
      "running": "P2",
      "ready": ["P1"],
      "remaining": {"P1": 7, "P2": 4, "P3": 9, "P4": 5},
      "events": [
        {"type": "arrival", "pid": "P2", "at": 1, "text": "P2 arrived"},
        {"type": "preempt", "pid": "P1", "by": "P2", "at": 1, "text": "P1 preempted by P2"}
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

### `steps[]`

The engine emits **one step for each time unit**, beginning at `time: 0`. For time `t`:

| Field | Meaning |
|---|---|
| `time` | Start time of the tick (`t`) |
| `running` | PID using the CPU this tick, or literal `"IDLE"` |
| `ready` | Arrived, incomplete PIDs waiting for the CPU, **excluding** `running` |
| `remaining` | Remaining work of **all** processes at the **start** of the tick |
| `events` | Ordered event list associated with this tick |

The `ready` list is sorted by ascending remaining time, then earlier arrival time, then lexicographic PID. The `remaining` map also contains **future arrivals**; a process is **not ready** just because it appears in `remaining`.

### `events[]` and time boundaries

Each event contains `type`, `pid`, `at` (actual occurrence time), and `text`; a `preempt` event additionally has `by`, the incoming PID.

| Event type | Meaning | `at` | PID value |
|---|---|---|---|
| `arrival` | Process enters the system | `step.time` | Arriving PID |
| `preempt` | Running process is interrupted | `step.time` | Interrupted PID; `by` is incoming PID |
| `complete` | Process finishes the time unit | `step.time + 1` | Completed PID |
| `idle` | CPU has no ready work | `step.time` | `null` |

The frontend must show tick-start arrivals/preemptions **before** running that unit, and completions **after** it. At a shared clock boundary, an earlier tick's completion comes before the next tick's arrival. Two events can share a timestamp while belonging to different steps; do not globally deduplicate events by time.

**Example idle snapshot:**

```json
{
  "time": 0,
  "running": "IDLE",
  "ready": [],
  "remaining": {"P1": 2},
  "events": [{"type": "idle", "at": 0, "pid": null, "text": "CPU idle"}]
}
```

This snapshot is from a separate case where P1 arrives at t=2 with burst 2.

### `gantt[]`

Every item is `{ "pid": string, "start": integer, "end": integer }`. The range is **half-open `[start, end)`**: a start is included, an end is excluded. Consecutive ticks with the same CPU owner are merged into one block. Idle intervals use `pid: "IDLE"`. The frontend's chart clips these authoritative intervals at the current playback boundary; it must not choose a new CPU owner itself.

### `metrics` and `averages`

`metrics[trimmedPid]` contains four integers:

| Key | Definition |
|---|---|
| `completion` | Time when the process finishes |
| `turnaround` | Completion − arrival |
| `waiting` | Turnaround − original burst |
| `response` | First CPU start − arrival |

`averages` contains `turnaround`, `waiting`, and `response` as numbers rounded to **two decimals**. Flask disables JSON-key sorting to preserve insertion order, but the frontend must render the results table in the **original submitted process order**, not rely on JavaScript object enumeration (especially with numeric PIDs).

**CPU utilization is not part of the API.** The frontend displays `(sum of non-IDLE Gantt durations / number of steps) × 100%`.

## Input limits

**Server-side enforcement in `engine.py` and `app.py`:**

| Constraint | Rule |
|---|---|
| Workload | JSON array of **1–15 processes** |
| PID | String, trimmed, nonempty, at most **32 Unicode characters**, unique after trimming |
| Reserved PID | Exact uppercase `IDLE` rejected |
| Arrival | Exact Python integer **≥ 0** (`bool` and floating-point values rejected) |
| Burst | Exact Python integer **≥ 1** (`bool` and floating-point values rejected) |
| Timeline | At most **10,000 time units**, counting idle time from t=0; final completion **may equal 10,000** |
| Request body | Maximum **16,384 bytes (16 KiB)** |

The frontend independently checks nonempty/unique trimmed PIDs and decimal-digit, nonnegative/positive safe integer times before sending; it skips visible rows with **both time fields blank** and rejects partially filled rows. The backend remains the final authority; direct API requests cannot bypass these server limits.

## Error responses

**HTTP 400** reports malformed JSON, a bad envelope, invalid process data, or a workload that cannot finish within the timeline limit. **HTTP 413** reports a request body exceeding 16 KiB. Both use a JSON error envelope:

```json
{"error": "Add at least one process."}
```

or:

```json
{"error": "Request body is too large (maximum 16 KB)."}
```

Other HTTP failures, network unavailability, and non-JSON responses must be handled by the frontend without reusing stale results. Only `POST /simulate` is valid for simulations; `GET /simulate` returns HTTP 405.

## Scheduling and tie rules

At each discrete time unit, choose the arrived and unfinished PID with minimum remaining burst. If the currently running process has the **same shortest remaining work**, keep it rather than preempting. If multiple other processes tie, prefer earlier arrival, then lexicographically smaller PID (so `P10` comes before `P2`). There is one CPU, no I/O blocking, and zero modeled context-switch overhead.

## Canonical reference case

| PID | Arrival | Burst | Completion | Turnaround | Waiting | Response |
|---|---:|---:|---:|---:|---:|---:|
| P1 | 0 | 8 | 17 | 17 | 9 | 0 |
| P2 | 1 | 4 | 5 | 4 | 0 | 0 |
| P3 | 2 | 9 | 26 | 24 | 15 | 15 |
| P4 | 3 | 5 | 10 | 7 | 2 | 2 |

Gantt: `P1 [0,1) | P2 [1,5) | P4 [5,10) | P1 [10,17) | P3 [17,26)`.

Average waiting = **6.50**; turnaround = **13.00**; response = **4.25**. CPU utilization = **100.00%**. This example is shared by the [README](../README.md), [frontend guide](FRONTEND_GUIDE.md), and [`sample_result.json`](../static/sample_result.json).

## Change control

Keep this contract, `engine.py`, `app.py`, `static/js/script.js`, `static/sample_result.json`, regression tests, and the related documentation in sync when changing any input rule, tie-breaker, timestamp, or response field. Do not change this contract solely to add a frontend UI control such as the slider: those operate on the existing steps and Gantt data.
