# Interface Contract

This is the single agreement between the Python side (engine and server) and the browser side
(HTML, CSS, JavaScript). The JSON shape must not change unless the backend developer and both
frontend developers agree first, because code on both sides depends on it.

A working example of a **full** success response is `static/sample_result.json`. Use the
updated sample containing `events[].at`, not an older copy without timestamps.

## Request

`POST /simulate`

Send JSON with the `Content-Type: application/json` header:

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

`processes` must be an array containing **1 to 15** valid processes. See [Input rules](#input-rules).

## Success response (HTTP 200)

The example below shows **only the step at time 1** of the reference case and abbreviated
Gantt/metric fields to illustrate the shape. It is **not the complete response**; consult
`static/sample_result.json` for every step, Gantt block, and metric.

```json
{
  "steps": [
    {
      "time": 1,
      "running": "P2",
      "ready": ["P1"],
      "remaining": {"P1": 7, "P2": 4, "P3": 9, "P4": 5},
      "events": [
        {"type": "arrival", "at": 1, "pid": "P2", "text": "P2 arrived"},
        {"type": "preempt", "at": 1, "pid": "P1", "by": "P2", "text": "P1 preempted by P2"}
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

### Field rules

**`steps`**: one entry per time unit, in order, starting at time 0.

- `time`: the **start** of the time unit (0, 1, 2, ...).
- `running`: the PID assigned to the CPU during this unit, or `"IDLE"` when no process is ready.
- `ready`: PIDs that have arrived and are waiting (**excluding** `running`), sorted by remaining time, then earlier arrival, then lexicographical PID. **Draw the on-screen ready queue from this list.**
- `remaining`: remaining work of **every** process at the **start** of the unit, before CPU execution.
- `events`: announcements associated with this step, in execution order. May be empty.

> **Important:** `remaining` includes processes that have **not arrived yet** (P3 and P4 at
> time 1 in the example). A PID's appearance in `remaining` does not mean it has arrived or is
> waiting. Use `ready` and `arrival` events for those states.

**`events[]`**: each event has `type`, `at`, `pid`, and `text`. Only a `preempt` event
also has `by`.

| `type` | Meaning | `at` (timestamp) | Additional rule |
|---|---|---|---|
| `arrival` | A process arrived | `step.time` | `pid` is the arriving process |
| `preempt` | The previous process was interrupted by another with less remaining work | `step.time` | `pid` is interrupted process; `by` is new CPU owner |
| `complete` | A process finished executing | **`step.time + 1`** | `pid` is the completed process |
| `idle` | CPU has no ready process | `step.time` | `pid` is `null` |

`at` is the **actual time of the event**, not necessarily the value of the enclosing
`step.time`. Every event has a `text` string suitable for the event log.

Event timing and ordering:

- Arrival and preemption happen at the **start** of a step; arrival events appear before any preemption event.
- Completion belongs to the **last step that executes the process**, but happens at the **end** of that step. Example: a process running in step `time = 1` that finishes has a `complete` event with `at = 2`.
- Show start-of-step events before animating that CPU unit and completion events after it. Do not show a completion early just because it is stored in the same step's `events` array.
- A completion at time 2 and an arrival at time 2 can belong to **different steps**; play each event from its own step rather than globally deduplicating timestamps.

**Idle steps:** when P1 arrives at time 2 with burst 2, the step at time 0 looks like this:

```json
{
  "time": 0,
  "running": "IDLE",
  "ready": [],
  "remaining": {"P1": 2},
  "events": [{"type": "idle", "at": 0, "pid": null, "text": "CPU idle"}]
}
```

**`gantt`**: consecutive time units with the same CPU owner are merged into one block.
Each `{ "pid", "start", "end" }` interval is **start-inclusive and end-exclusive**:
`[start, end)`. Idle periods appear as `"pid": "IDLE"`. Animate using `steps`; use
`gantt` to display/check the completed chart.

**`metrics`**: a dictionary keyed by each **trimmed PID**, with `completion`,
`turnaround` (TAT), `waiting` (WT), and `response` (RT). The backend preserves the input
process order in this object by disabling Flask's JSON-key sorting, but the frontend must
**render the results table in the order of the submitted process array**, not rely on
`Object.keys(metrics)` or `Object.entries(metrics)`.

**`averages`**: average `turnaround`, `waiting`, and `response`, rounded to 2 decimals.

## Error responses (HTTP 400 and 413)

**HTTP 400**: invalid JSON/body, missing `processes`, malformed entries, or a workload
that violates the input or simulation limits. The response shape is always:

```json
{"error": "Add at least one process."}
```

For example, `{"processes": []}` returns **400**, not an empty successful simulation.
Other errors use the same `{"error": "..."}` shape with an appropriate message.

**HTTP 413**: the JSON request body exceeds **16,384 bytes (16 KiB)**, the server's
16 KB request limit. It uses the **same error shape**:

```json
{"error": "Request body is too large (maximum 16 KB)."}
```

The frontend must display either error type to the user. It must also handle the case
where the server cannot be reached or does not return JSON.

## Input rules

These are the **server-enforced** rules:

- `processes`: a JSON array with **at least 1 and at most 15** entries. An empty list is invalid (`"Add at least one process."`).
- Each process: a JSON object with `pid`, `arrival`, and `burst`.
- `pid`: a string, non-empty after leading/trailing whitespace is removed. The backend **trims** it before use; its trimmed length must be **1 to 32 characters**. PIDs must be **unique after trimming**.
- `"IDLE"` is a **reserved PID** because it identifies unused CPU time. This exact uppercase spelling is rejected.
- `arrival`: a JSON integer **0 or greater**.
- `burst`: a JSON integer **1 or greater**.
- Booleans, decimal numbers, numeric strings, and missing values are not accepted as integer fields.
- Simulation: **at most 10,000 time units**, counting idle units from time 0 as well as CPU execution. The final completion time may equal 10,000, but a run requiring the CPU at or beyond time 10,000 is rejected with HTTP 400.
- JSON body: at most **16,384 bytes**, enforced by Flask with HTTP 413 if exceeded.

### Frontend validation guidance

The browser's form validation should mirror the server rules **before** calling
`/simulate`: non-empty process list, maximum 15 processes, trimmed/unique 1–32-character
PIDs, rejection of `"IDLE"`, and integer arrival/burst constraints. Send the trimmed PID
in the request. Show readable errors returned by the backend rather than silently
ignoring them.

To keep animations readable, the team may **add a smaller, frontend-only input range**
(for example, arrival `0–100` and burst `1–100`). These example per-field caps are **not
backend limits** and should be agreed with the team before enforcing them. The backend's
10,000-unit simulation limit remains authoritative for any inputs the browser allows.

### Frontend implementation notes

- Save the submitted process array when starting a simulation. For the results table, iterate over that array and look up `metrics[process.pid.trim()]`.
- For each step, show events with `at === step.time` at the **start** of playback, and events with `at === step.time + 1` at the **end** of playback.
- Use `step.ready` for the waiting queue and `step.remaining` for the before-execution numbers. Do not infer ready/arrival state from the keys of `remaining`.
- Check the frontend against the **updated** `static/sample_result.json`, which includes `events[].at`.

## Scheduling rules

- The available process with the smallest remaining burst time runs first (SRTF).
- Ties: keep the currently running process, then earlier arrival, then **lexicographically smaller PID** (string comparison, not numeric suffix comparison).
- Time advances in whole units; context-switch cost is zero.

## Reference test case (worked example)

| PID | Arrival | Burst |
|---|---|---|
| P1 | 0 | 8 |
| P2 | 1 | 4 |
| P3 | 2 | 9 |
| P4 | 3 | 5 |

Gantt: `P1 [0–1] | P2 [1–5] | P4 [5–10] | P1 [10–17] | P3 [17–26]`

| PID | Completion | TAT | WT | RT |
|---|---|---|---|---|
| P1 | 17 | 17 | 9 | 0 |
| P2 | 5 | 4 | 0 | 0 |
| P3 | 26 | 24 | 15 | 15 |
| P4 | 10 | 7 | 2 | 2 |

Averages: WT = 6.5, TAT = 13.0, RT = 4.25.
