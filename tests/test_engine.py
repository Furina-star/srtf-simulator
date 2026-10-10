"""Verify SRTF scheduling, event timestamps, metrics, and input limits."""

import pytest
from engine import MAX_PROCESSES, MAX_SIMULATION_STEPS, srtf


def test_preemption_and_metrics():
    result = srtf([
        {"pid": "P1", "arrival": 0, "burst": 4},
        {"pid": "P2", "arrival": 1, "burst": 1},
    ])
    assert result["gantt"] == [
        {"pid": "P1", "start": 0, "end": 1},
        {"pid": "P2", "start": 1, "end": 2},
        {"pid": "P1", "start": 2, "end": 5},
    ]
    assert result["metrics"]["P1"] == {
        "completion": 5, "turnaround": 5, "waiting": 1, "response": 0
    }
    assert result["metrics"]["P2"] == {
        "completion": 2, "turnaround": 1, "waiting": 0, "response": 0
    }


def test_completion_occurs_at_end_of_tick():
    steps = srtf([{"pid": "P1", "arrival": 0, "burst": 1}])["steps"]
    assert steps[0]["time"] == 0
    assert steps[0]["remaining"]["P1"] == 1
    assert [e for e in steps[0]["events"] if e["type"] == "complete"][0]["at"] == 1
    assert [e for e in steps[0]["events"] if e["type"] == "arrival"][0]["at"] == 0


def test_preempt_and_arrival_occurs_at_start_of_tick():
    steps = srtf([
        {"pid": "P1", "arrival": 0, "burst": 4},
        {"pid": "P2", "arrival": 1, "burst": 1},
    ])["steps"]
    assert [(e["type"], e["at"]) for e in steps[1]["events"]] == [
        ("arrival", 1), ("preempt", 1), ("complete", 2)
    ]


def test_idle_time_does_not_count_as_waiting():
    result = srtf([{"pid": "P1", "arrival": 3, "burst": 2}])
    assert result["gantt"] == [
        {"pid": "IDLE", "start": 0, "end": 3},
        {"pid": "P1", "start": 3, "end": 5},
    ]
    assert result["metrics"]["P1"]["waiting"] == 0
    assert all(e["at"] == step["time"] for step in result["steps"]
               for e in step["events"] if e["type"] == "idle")


def test_equal_remaining_time_does_not_unnecessarily_preempt():
    result = srtf([
        {"pid": "P1", "arrival": 0, "burst": 3},
        {"pid": "P2", "arrival": 1, "burst": 2},
    ])
    assert result["gantt"] == [
        {"pid": "P1", "start": 0, "end": 3},
        {"pid": "P2", "start": 3, "end": 5},
    ]


def test_empty_process_list_is_rejected():
    with pytest.raises(ValueError, match=r"^Add at least one process\.$"):
        srtf([])


@pytest.mark.parametrize("processes", [
    [{"pid": "P1", "arrival": 0, "burst": 0}],
    [{"pid": "P1", "arrival": -1, "burst": 2}],
    [{"pid": "P1", "arrival": 0, "burst": True}],
    [{"pid": "IDLE", "arrival": 0, "burst": 1}],
    [{"pid": "P1", "arrival": 0, "burst": 1},
     {"pid": " P1 ", "arrival": 1, "burst": 1}],
    [{"pid": "P" * 33, "arrival": 0, "burst": 1}],
    [{"pid": "P1", "arrival": 0}],
    [{"pid": "P1", "arrival": 0, "burst": 1}] * (MAX_PROCESSES + 1),
])
def test_invalid_inputs(processes):
    with pytest.raises(ValueError):
        srtf(processes)


def test_pid_is_trimmed():
    result = srtf([{"pid": " P1 ", "arrival": 0, "burst": 1}])
    assert list(result["metrics"]) == ["P1"]


def test_simulation_step_limit():
    with pytest.raises(ValueError, match="Simulation exceeds"):
        srtf([{"pid": "P1", "arrival": MAX_SIMULATION_STEPS, "burst": 1}])


def test_final_tick_on_limit_is_allowed():
    result = srtf([{"pid": "P1", "arrival": MAX_SIMULATION_STEPS - 1, "burst": 1}])
    assert result["metrics"]["P1"]["completion"] == MAX_SIMULATION_STEPS


@pytest.mark.parametrize("processes", [
    None, {}, [None],
    [{"pid": "", "arrival": 0, "burst": 1}],
    [{"pid": "  ", "arrival": 0, "burst": 1}],
    [{"pid": 1, "arrival": 0, "burst": 1}],
    [{"pid": "P1", "arrival": True, "burst": 1}],
    [{"pid": "P1", "arrival": "0", "burst": 1}],
    [{"pid": "P1", "arrival": 0.5, "burst": 1}],
    [{"pid": "P1", "arrival": 0, "burst": 1.5}],
    [{"pid": "P1", "arrival": 0, "burst": "1"}],
])
def test_malformed_process_fields(processes):
    with pytest.raises(ValueError):
        srtf(processes)


def test_lexicographic_ties_and_ready_queue():
    processes = [{"pid": pid, "arrival": 0, "burst": 1}
                 for pid in ["P2", "P10", "P1"]]
    result = srtf(processes)
    assert [block["pid"] for block in result["gantt"]] == ["P1", "P10", "P2"]
    assert result["steps"][0]["ready"] == ["P10", "P2"]
    assert list(result["metrics"]) == ["P2", "P10", "P1"]
    assert result["metrics"]["P2"]["response"] == 2


def test_completion_then_arrival_at_same_boundary_and_later_idle():
    result = srtf([
        {"pid": "A", "arrival": 0, "burst": 1},
        {"pid": "B", "arrival": 1, "burst": 1},
        {"pid": "C", "arrival": 4, "burst": 1},
    ])
    events = [event for step in result["steps"] for event in step["events"]]
    assert [(e["type"], e["pid"]) for e in events if e["at"] == 1] == [
        ("complete", "A"), ("arrival", "B")
    ]
    assert result["gantt"][2] == {"pid": "IDLE", "start": 2, "end": 4}
    assert result["averages"]["waiting"] == 0


def test_custom_pid_identity_and_input_are_preserved():
    processes = [{"pid": pid, "arrival": 0, "burst": 1}
                 for pid in ["__proto__", "constructor", "<b>job</b>", "😀" * 32]]
    original = [dict(process) for process in processes]
    result = srtf(processes)
    assert processes == original
    assert list(result["metrics"]) == [p["pid"] for p in processes]
