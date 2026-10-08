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
