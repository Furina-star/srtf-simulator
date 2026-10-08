
def srtf(processes):
    rem = {p['pid']: p['burst'] for p in processes}
    burst = dict(rem)
    arrival = {p['pid']: p['arrival'] for p in processes}
    first_start = {}
    completion = {}
    steps = []
    running = None
    t = 0
    done = 0

    while done < len(processes):
        ready = [pid for pid in rem if arrival[pid] <= t and rem[pid] > 0]
        print("t =", t, "ready =", ready)
        if not ready:
            running = None
            t += 1
            continue
        if t >= 6:
            break

        t += 1

if __name__ == "__main__":
    sample = [
        {"pid": "P1", "arrival": 3, "burst": 8},
        {"pid": "P2", "arrival": 1, "burst": 4},
        {"pid": "P3", "arrival": 2, "burst": 9},
        {"pid": "P4", "arrival": 3, "burst": 5},
    ]
    srtf(sample)