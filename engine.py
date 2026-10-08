
def srtf(processes):

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

        events = [{"type": "arrival", "pid": pid, "text": f"{pid} arrived"} for pid in rem if arrival[pid] == t]

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
            events.append({"type": "complete", "pid": current, "text": f"{current} completed"})

        # Break the loop if the time exceeds 200 to prevent infinite loops in case of errors
        if t > 200:
            break

    for s in steps:
        if s["events"]:
            print(s["time"], [e["text"] for e in s["events"]])

# Temporary test code to run the SRTF function with a sample input
if __name__ == "__main__":
    sample = [
        {"pid": "P1", "arrival": 0, "burst": 8},
        {"pid": "P2", "arrival": 1, "burst": 4},
        {"pid": "P3", "arrival": 2, "burst": 9},
        {"pid": "P4", "arrival": 3, "burst": 5},
    ]
    srtf(sample)

    print("\nIdle case:")
    srtf([{"pid": "P1", "arrival": 2, "burst": 2}])
