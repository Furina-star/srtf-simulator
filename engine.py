
def srtf(processes):

    # Check inputs before creating the scheduling dictionaries.
    if not isinstance(processes, list):
        raise ValueError("Processes must be a list.")

    if len(processes) > 15:
        raise ValueError("A maximum of 15 processes is allowed.")

    seen = set()

    for index, process in enumerate(processes, start=1):
        if not isinstance(process, dict):
            raise ValueError(f"Process {index} must be a dictionary.")

        pid = process.get("pid")
        arrival_time = process.get("arrival")
        burst_time = process.get("burst")

        if not isinstance(pid, str) or not pid.strip():
            raise ValueError(f"Process {index} must have a non-empty PID.")

        if pid in seen:
            raise ValueError(f"Duplicate PID: {pid}.")

        seen.add(pid)

        if type(arrival_time) is not int or arrival_time < 0:
            raise ValueError(
                f"Arrival time of {pid} must be a whole number of 0 or more."
            )

        if type(burst_time) is not int or burst_time < 1:
            raise ValueError(
                f"Burst time of {pid} must be a whole number of 1 or more."
            )

    # Declare variables
    rem = {p['pid']: p['burst'] for p in processes}
    burst = dict(rem)
    arrival = {p['pid']: p['arrival'] for p in processes}
    first_start = {}
    completion = {}
    steps = []
    running = None
    t = 0
    done = 0

    # Clock loop: Find the next process to run at each time step
    while done < len(processes):

        # Arrived events, if any process arrives at this time step, record it
        events = [{
            "type": "arrival",
            "pid": pid,
            "text": f"{pid} arrived"
        } for pid in rem if arrival[pid] == t]

        # Find all processes that are ready to run
        ready = [pid for pid in rem if arrival[pid] <= t and rem[pid] > 0]

        # If no processes are ready, increment time and continue
        if not ready:
            events.append({
                "type": "idle",
                "pid": None,
                "text": "CPU idle",
            })
            steps.append({
                "time": t,
                "running": "IDLE",
                "ready": [],
                "remaining": dict(rem),
                "events": events,
            })
            running = None
            t += 1
            continue

        # Select the process with the shortest remaining time, breaking ties by arrival time and PID
        current = min(ready, key=lambda pid: (rem[pid], 0 if pid == running else 1, arrival[pid], pid))

        # Record an interruption only if the previous process still has work left.
        if running is not None and running != current and rem[running] > 0:
            events.append({
                "type": "preempt",
                "pid": running,
                "by": current,
                "text": f"{running} preempted by {current}",
            })

        # Record the state of the system at this time step
        steps.append({
            "time": t,
            "running": current,
            "ready": sorted([pid for pid in ready if pid != current], key=lambda pid: (rem[pid], arrival[pid], pid)),
            "remaining": dict(rem),
            "events": events,
        })

        # Record the first time the current process starts running
        if current not in first_start:
            first_start[current] = t

        # Update the remaining time for the currently running process
        rem[current] -= 1
        running = current

        t += 1

        # If the current process has finished, record its completion time
        if rem[current] == 0:
            completion[current] = t
            done += 1
            events.append({
                "type": "complete",
                "pid": current,
                "text": f"{current} completed"
            })

    # Merge consecutive steps into a Gantt blocks.
    gantt = []

    for step in steps:
        pid = step["running"]
        start = step["time"]
        end = start + 1

        # If the last Gantt block is for the same process, extend its end time; otherwise, create a new block.
        if gantt and gantt[-1]["pid"] == pid:
            gantt[-1]["end"] = end
        else:
            gantt.append({
                "pid": pid,
                "start": start,
                "end": end
            })

    # Calculate scheduling metrics for each process
    metrics = {}

    for pid in burst:
        turnaround = completion[pid] - arrival[pid]
        waiting = turnaround - burst[pid]
        response = first_start[pid] - arrival[pid]
        metrics[pid] = {
            "completion": completion[pid],
            "turnaround": turnaround,
            "waiting": waiting,
            "response": response,
        }

    # Calculate averages across all processes.
    count = len(metrics)
    averages = {}

    for name in ("turnaround", "waiting", "response"):
        total = sum(values[name] for values in metrics.values())
        averages[name] = round(total / count, 2) if count else 0.0

    # Return the results as a dictionary containing the steps, Gantt chart, metrics, and averages.
    return {
        "steps": steps,
        "gantt": gantt,
        "metrics": metrics,
        "averages": averages
    }

# Temporary test code to run the SRTF function with a sample input
if __name__ == "__main__":
    sample = [
        {"pid": "P1", "arrival": 0, "burst": 8},
        {"pid": "P2", "arrival": 1, "burst": 4},
        {"pid": "P3", "arrival": 2, "burst": 9},
        {"pid": "P4", "arrival": 3, "burst": 5},
    ]

    result = srtf(sample)

    print("Gantt:", result["gantt"])

    for pid, values in result["metrics"].items():
        print(pid, values)

    print("Averages:", result["averages"])

    import json
    from pathlib import Path

    sample_path = Path(__file__).parent / "static" / "sample_result.json"
    expected = json.loads(sample_path.read_text(encoding="utf-8"))

    assert result == expected, "Result differs from sample_result.json"
    print("Sample result matches.")

    idle_result = srtf([{"pid": "P1", "arrival": 2, "burst": 2}])

    assert idle_result["gantt"] == [
        {"pid": "IDLE", "start": 0, "end": 2},
        {"pid": "P1", "start": 2, "end": 4},
    ]
    assert idle_result["metrics"]["P1"] == {
        "completion": 4,
        "turnaround": 2,
        "waiting": 0,
        "response": 0,
    }
    print("Idle case passed.")

    invalid_cases = [
        ("zero burst", [
            {"pid": "P1", "arrival": 0, "burst": 0},
        ]),
        ("negative arrival", [
            {"pid": "P1", "arrival": -1, "burst": 2},
        ]),
        ("duplicate PID", [
            {"pid": "P1", "arrival": 0, "burst": 2},
            {"pid": "P1", "arrival": 1, "burst": 3},
        ]),
        ("missing burst", [
            {"pid": "P1", "arrival": 0},
        ]),
        ("boolean burst", [
            {"pid": "P1", "arrival": 0, "burst": True},
        ]),
    ]

    for label, processes in invalid_cases:
        try:
            srtf(processes)
        except ValueError as error:
            print(f"Rejected {label}: {error}")
        else:
            raise AssertionError(f"Invalid input accepted: {label}")
