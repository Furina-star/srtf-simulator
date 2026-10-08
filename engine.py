"""Validate processes and produce a tick-by-tick SRTF scheduling result."""

from typing import TypedDict

MAX_PROCESSES = 15
MAX_PID_LENGTH = 32
MAX_SIMULATION_STEPS = 10_000


class Process(TypedDict):
    """A validated process with integer arrival and CPU burst times."""

    pid: str
    arrival: int
    burst: int


class Event(TypedDict, total=False):
    """A timeline announcement, with its actual occurrence time in `at`."""

    type: str
    pid: str | None
    text: str
    at: int
    by: str


class Step(TypedDict):
    """The CPU, queue, and remaining work at the start of one time unit."""

    time: int
    running: str
    ready: list[str]
    remaining: dict[str, int]
    events: list[Event]


class GanttBlock(TypedDict):
    """A continuous CPU assignment with an exclusive end time."""

    pid: str
    start: int
    end: int


class SimulationResult(TypedDict):
    """The JSON-compatible response shared with the Flask endpoint."""

    steps: list[Step]
    gantt: list[GanttBlock]
    metrics: dict[str, dict[str, int]]
    averages: dict[str, float]


def _validate_process(process: object, index: int, seen: set[str]) -> Process:
    """Validate one process before its fields become dictionary keys or times."""
    # Reject malformed entries before accessing their fields.
    if not isinstance(process, dict):
        raise ValueError(f"Process {index} must be a dictionary.")

    pid = process.get("pid")
    arrival_time = process.get("arrival")
    burst_time = process.get("burst")

    # PIDs must identify one process, rather than overwrite an earlier entry.
    if not isinstance(pid, str) or not pid.strip():
        raise ValueError(f"Process {index} must have a non-empty PID.")
    pid = pid.strip()
    if len(pid) > MAX_PID_LENGTH:
        raise ValueError(f"PID must have no more than {MAX_PID_LENGTH} characters.")
    if pid in seen:
        raise ValueError(f"Duplicate PID: {pid}.")

    # Exact integer checks also reject booleans, which subclass int in Python.
    if type(arrival_time) is not int or arrival_time < 0:
        raise ValueError(
            f"Arrival time of {pid} must be a whole number of 0 or more."
        )
    if type(burst_time) is not int or burst_time < 1:
        raise ValueError(
            f"Burst time of {pid} must be a whole number of 1 or more."
        )

    # The response format reserves this label for an unused CPU.
    if pid == "IDLE":
        raise ValueError("PID IDLE is reserved for CPU idle time.")

    seen.add(pid)
    return {"pid": pid, "arrival": arrival_time, "burst": burst_time}


def _validate_processes(processes: object) -> list[Process]:
    """Validate the collection and return copies of the required input fields."""
    # Reject invalid containers and empty workloads before validating individual rows.
    if not isinstance(processes, list):
        raise ValueError("Processes must be a list.")
    if not processes:
        raise ValueError("Add at least one process.")
    if len(processes) > MAX_PROCESSES:
        raise ValueError(f"A maximum of {MAX_PROCESSES} processes is allowed.")

    seen: set[str] = set()
    # Validate in input order so error messages identify the offending row.
    return [
        _validate_process(process, index, seen)
        for index, process in enumerate(processes, start=1)
    ]


def _record_preemption(
    events: list[Event],
    running: str | None,
    current: str,
    remaining: dict[str, int],
    time: int,
) -> None:
    """Announce a switch only when the previous process was interrupted."""
    # The first run or a run after idle time has no previous process to interrupt.
    if running is None:
        return

    # After the guard, the previous CPU owner is a process ID.
    previous = running
    # A completed process has no remaining work and cannot be preempted.
    if previous != current and remaining[previous] > 0:
        events.append({
            "type": "preempt",
            "at": time,
            "pid": previous,
            "by": current,
            "text": f"{previous} preempted by {current}",
        })


def _make_step(
    time: int,
    current: str,
    ready: list[str],
    remaining: dict[str, int],
    arrival: dict[str, int],
    events: list[Event],
) -> Step:
    """Capture a tick before execution and order the waiting queue for display."""
    # Exclude the CPU owner; waiting ties use arrival time followed by PID.
    waiting = sorted(
        (pid for pid in ready if pid != current),
        key=lambda pid: (remaining[pid], arrival[pid], pid),
    )
    return {
        "time": time,
        "running": current,
        "ready": waiting,
        # Copy work counts so later execution cannot change an earlier snapshot.
        "remaining": dict(remaining),
        # Share this tick's list so completion can be appended after execution.
        "events": events,
    }


def _simulate(
    processes: list[Process],
) -> tuple[list[Step], dict[str, int], dict[str, int]]:
    """Run the clock until every process finishes, recording steps and timings."""
    # Track mutable work separately from the validated input.
    remaining = {process["pid"]: process["burst"] for process in processes}
    arrival = {process["pid"]: process["arrival"] for process in processes}
    arrivals_by_time: dict[int, list[Event]] = {}
    # Index announcements once, retaining input order for simultaneous arrivals.
    for process in processes:
        process_id = process["pid"]
        arrival_event: Event = {
            "type": "arrival", "at": process["arrival"],
            "pid": process_id, "text": f"{process_id} arrived",
        }
        arrivals_by_time.setdefault(process["arrival"], []).append(arrival_event)

    first_start: dict[str, int] = {}
    completion: dict[str, int] = {}
    steps: list[Step] = []
    running: str | None = None
    time = 0

    # Each iteration records exactly one unit, including idle intervals.
    while len(completion) < len(processes):
        # Reject oversized runs instead of returning incomplete metrics.
        if time >= MAX_SIMULATION_STEPS:
            raise ValueError(
                f"Simulation exceeds the limit of "
                f"{MAX_SIMULATION_STEPS} time units."
            )

        # Consume this tick's arrivals before appending switches or completion.
        events: list[Event] = arrivals_by_time.pop(time, [])
        # Future and completed processes cannot compete for the CPU.
        ready = [
            pid for pid in remaining if arrival[pid] <= time and remaining[pid] > 0
        ]

        # Preserve idle ticks for animation and clear the previous CPU owner.
        if not ready:
            events.append({"type": "idle", "at": time, "pid": None, "text": "CPU idle"})
            steps.append(_make_step(time, "IDLE", ready, remaining, arrival, events))
            running = None
            time += 1
            continue

        # Bind the previous owner now; ties retain it, then use arrival and PID.
        current = min(
            ready,
            key=lambda pid, previous=running: (
                remaining[pid], 0 if pid == previous else 1, arrival[pid], pid
            ),
        )
        _record_preemption(events, running, current, remaining, time)
        steps.append(_make_step(time, current, ready, remaining, arrival, events))

        # setdefault preserves the first start when a preempted process resumes.
        first_start.setdefault(current, time)
        remaining[current] -= 1
        running = current
        time += 1

        # Completion belongs to the executed step, but its time is the tick's end.
        if remaining[current] == 0:
            completion[current] = time
            events.append({
                "type": "complete",
                "at": time,
                "pid": current,
                "text": f"{current} completed",
            })

    return steps, first_start, completion


def _build_gantt(steps: list[Step]) -> list[GanttBlock]:
    """Merge neighboring ticks with the same CPU owner, including idle ticks."""
    gantt: list[GanttBlock] = []
    # Process the recorded timeline in chronological order.
    for step in steps:
        end = step["time"] + 1
        # Extend only the last block, preserving separate runs after preemption.
        if gantt and gantt[-1]["pid"] == step["running"]:
            gantt[-1]["end"] = end
        else:
            # A different owner starts a new half-open interval [start, end).
            gantt.append({
                "pid": step["running"],
                "start": step["time"],
                "end": end,
            })
    return gantt


def _calculate_metrics(
    processes: list[Process],
    first_start: dict[str, int],
    completion: dict[str, int],
) -> dict[str, dict[str, int]]:
    """Calculate each process's finish time, total duration, wait, and response."""
    metrics: dict[str, dict[str, int]] = {}
    # Original burst times exclude CPU execution from total waiting time.
    for process in processes:
        pid = process["pid"]
        turnaround = completion[pid] - process["arrival"]
        metrics[pid] = {
            "completion": completion[pid],
            "turnaround": turnaround,
            "waiting": turnaround - process["burst"],
            "response": first_start[pid] - process["arrival"],
        }
    return metrics


def _calculate_averages(metrics: dict[str, dict[str, int]]) -> dict[str, float]:
    """Average the three duration metrics, with zeros for an empty workload."""
    count = len(metrics)
    averages: dict[str, float] = {}
    # Round only the final averages, preserving each process's exact metrics.
    for name in ("turnaround", "waiting", "response"):
        total = sum(values[name] for values in metrics.values())
        # Empty workloads have no denominator and retain the existing zero result.
        averages[name] = round(total / count, 2) if count else 0.0
    return averages


def srtf(processes: object) -> SimulationResult:
    """Return the SRTF timeline and metrics; raise ValueError for invalid input."""
    # Validate once, then keep scheduling and result calculations independent.
    validated = _validate_processes(processes)
    steps, first_start, completion = _simulate(validated)
    metrics = _calculate_metrics(validated, first_start, completion)

    # Keep the public response shape compatible with the frontend contract.
    return {
        "steps": steps,
        "gantt": _build_gantt(steps),
        "metrics": metrics,
        "averages": _calculate_averages(metrics),
    }


def _run_self_checks() -> None:
    """Run the sample and regression checks only when this file is executed."""
    import json
    from pathlib import Path

    # Compare every response field with the agreed frontend sample.
    sample = [
        {"pid": "P1", "arrival": 0, "burst": 8},
        {"pid": "P2", "arrival": 1, "burst": 4},
        {"pid": "P3", "arrival": 2, "burst": 9},
        {"pid": "P4", "arrival": 3, "burst": 5},
    ]
    result = srtf(sample)
    sample_path = Path(__file__).parent / "static" / "sample_result.json"
    expected = json.loads(sample_path.read_text(encoding="utf-8"))
    assert result == expected, "Result differs from sample_result.json"
    print("Sample result matches.")

    # Verify idle time is recorded without adding to a late process's waiting.
    idle_result = srtf([{"pid": "P1", "arrival": 2, "burst": 2}])
    assert idle_result["gantt"] == [
        {"pid": "IDLE", "start": 0, "end": 2},
        {"pid": "P1", "start": 2, "end": 4},
    ]
    assert idle_result["metrics"]["P1"] == {
        "completion": 4, "turnaround": 2, "waiting": 0, "response": 0,
    }
    print("Idle case passed.")

    # Keep input regressions local so their variable names cannot shadow globals.
    invalid_cases = [
        ("zero burst", [{"pid": "P1", "arrival": 0, "burst": 0}]),
        ("negative arrival", [{"pid": "P1", "arrival": -1, "burst": 2}]),
        ("duplicate PID", [
            {"pid": "P1", "arrival": 0, "burst": 2},
            {"pid": "P1", "arrival": 1, "burst": 3},
        ]),
        ("missing burst", [{"pid": "P1", "arrival": 0}]),
        ("boolean burst", [{"pid": "P1", "arrival": 0, "burst": True}]),
        ("reserved PID", [{"pid": "IDLE", "arrival": 0, "burst": 1}]),
    ]
    # Each invalid workload must fail before simulation starts.
    for label, invalid_processes in invalid_cases:
        try:
            srtf(invalid_processes)
        except ValueError as error:
            # Validation errors are the expected result of these checks.
            print(f"Rejected {label}: {error}")
        else:
            # An accepted invalid workload is a failed regression check.
            raise AssertionError(f"Invalid input accepted: {label}")


# Importing the engine from Flask must not execute the demonstration checks.
if __name__ == "__main__":
    _run_self_checks()
