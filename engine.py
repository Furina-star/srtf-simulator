
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
        # Find all processes that are ready to run
        ready = [pid for pid in rem if arrival[pid] <= t and rem[pid] > 0]

        if not ready: # No process is ready to run
            running = None
            t += 1
            continue

        # Select the process with the shortest remaining time, breaking ties by arrival time and PID
        current = min(ready, key=lambda pid: (rem[pid], 0 if pid == running else 1, arrival[pid], pid))
        print("t=", t, "ready=", ready, "current=", current)

        if t >= 6: # Debugging: print the ready queue at time t
            break
        t += 1

# Temporary test code to run the SRTF function with a sample input
if __name__ == "__main__":
    sample = [
        {"pid": "P1", "arrival": 0, "burst": 8},
        {"pid": "P2", "arrival": 1, "burst": 4},
        {"pid": "P3", "arrival": 2, "burst": 9},
        {"pid": "P4", "arrival": 3, "burst": 5},
    ]
    srtf(sample)