# Interface Contract

This is the single agreement between the Python side (engine and server) and the browser side
(HTML, CSS, JavaScript). Changes to this file must be agreed on by Roles 1, 2, and 3 before
any code that depends on it is edited.

## Request

`POST /simulate`

```json
{
  "processes": [
    {"pid": "P1", "arrival": 0, "burst": 8},
    {"pid": "P2", "arrival": 1, "burst": 4}
  ]
}
```

## Success response (HTTP 200)

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

### Field rules
- `steps`: one entry per time unit. `running` is a PID or `"IDLE"`.
- `remaining`: remaining time of every process at the **start** of that time unit.
- `ready`: waiting PIDs, sorted by remaining time.
- `events[].type`: one of `arrival`, `preempt`, `complete`, `idle`.
- `gantt`: merged consecutive blocks of the same PID.
- `metrics`: completion, turnaround (TAT), waiting (WT), response (RT) per process.
- `averages`: average turnaround, waiting, and response times, rounded to 2 decimals.

## Error response (HTTP 400)

```json
{"error": "Burst time of P3 must be a whole number of 1 or more."}
```

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