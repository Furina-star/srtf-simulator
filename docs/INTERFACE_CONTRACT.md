# Interface Contract

This is the single agreement between the Python side (engine and server) and the browser side
(HTML, CSS, JavaScript). The JSON shape must not change unless the backend developer and both
frontend developers agree first, because code on both sides depends on it.

A working example of a full success response is `static/sample_result.json`.

## Request

`POST /simulate`

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

## Success response (HTTP 200)

The example below is the step at time 1 of the reference case, followed by the other fields in short form.

```json
{
  "steps": [
    {
      "time": 1,
      "running": "P2",
      "ready": ["P1"],
      "remaining": {"P1": 7, "P2": 4, "P3": 9, "P4": 5},
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

### Field rules

**`steps`**: one entry per time unit, in order, starting at time 0.
- `time`: the start of this time unit (0, 1, 2, ...).
- `running`: the PID that has the CPU during this time unit, or `"IDLE"` if no process has arrived yet.
- `ready`: PIDs that have arrived and are waiting (not the running one), sorted by remaining time. Ties are broken by earlier arrival, then lower PID. **The ready queue on screen is drawn from this list.**
- `remaining`: remaining time of **every** process at the **start** of this time unit.
- `events`: things to announce in the log during this time unit. May be empty.

> **Important:** `remaining` includes processes that have **not arrived yet** (at time 1 above, P3 and P4 are listed with their full burst times). Do not treat a process as arrived or waiting just because it appears in `remaining`. Use `ready` and the `arrival` events instead.

**`events[].type`** is one of:

| Type | Meaning | Extra fields |
|---|---|---|
| `arrival` | A process arrived at this time | `pid` |
| `preempt` | The running process was interrupted by a shorter one | `pid` (interrupted process), `by` (process that took over) |
| `complete` | A process finished | `pid` |
| `idle` | The CPU has nothing to run | `pid` is `null` |

Every event also has `text`, a ready-to-print message for the event log.

Notes on events:
- A `complete` event appears on the **last** step the process runs. The process finishes at the end of that time unit, so its completion time is `time + 1`.
- At the start of a time unit, `arrival` events come before `preempt` events.

**Idle steps:** when no process has arrived, the step looks like this:

```json
{
  "time": 0,
  "running": "IDLE",
  "ready": [],
  "remaining": {"P1": 2},
  "events": [{"type": "idle", "pid": null, "text": "CPU idle"}]
}
```

**`gantt`**: merged consecutive blocks of the same PID. Idle time appears as a block with `"pid": "IDLE"`. The animation is built from `steps`; `gantt` is the finished chart and is useful for checking.

**`metrics`**: one entry per process with `completion`, `turnaround` (TAT), `waiting` (WT), and `response` (RT).

**`averages`**: average `turnaround`, `waiting`, and `response`, rounded to 2 decimals.

## Error response (HTTP 400)

```json
{"error": "Burst time of P3 must be a whole number of 1 or more."}
```

The frontend must also handle the case where the server cannot be reached at all (no JSON reply) and show a readable message.

## Input rules
- `pid`: non-empty, unique.
- `arrival`: whole number, 0 or greater.
- `burst`: whole number, 1 or greater.
- Maximum of 15 processes.

## Scheduling rules
- Smallest remaining time runs first.
- Ties: keep the currently running process, then earlier arrival, then lower PID.
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