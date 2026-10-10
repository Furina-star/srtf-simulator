"""Verify Flask routing, JSON validation, and integration with the scheduling engine."""

import json
from pathlib import Path

import pytest
pytest.importorskip("flask")
from app import app


@pytest.fixture
def client():
    app.config.update(TESTING=True)
    with app.test_client() as client:
        yield client


def test_simulation_endpoint(client):
    response = client.post("/simulate", json={"processes": [
        {"pid": "P1", "arrival": 0, "burst": 1}
    ]})
    assert response.status_code == 200
    assert response.get_json()["metrics"]["P1"]["completion"] == 1


def test_missing_processes(client):
    response = client.post("/simulate", json={})
    assert response.status_code == 400
    assert "error" in response.get_json()


def test_invalid_process(client):
    response = client.post("/simulate", json={"processes": [
        {"pid": "P1", "arrival": 0, "burst": 0}
    ]})
    assert response.status_code == 400


def test_request_size_limit(client):
    response = client.post("/simulate", data="x" * 17000,
                           content_type="application/json")
    assert response.status_code == 413
    assert "error" in response.get_json()


def test_metrics_keep_input_order_for_double_digit_pids(client):
    pids = [f"P{i}" for i in range(1, 13)]
    processes = [{"pid": pid, "arrival": 0, "burst": 1} for pid in pids]
    response = client.post("/simulate", json={"processes": processes})

    assert response.status_code == 200
    assert list(response.get_json()["metrics"]) == pids


def test_empty_processes_returns_400_with_expected_message(client):
    response = client.post("/simulate", json={"processes": []})
    assert response.status_code == 400
    assert response.get_json() == {"error": "Add at least one process."}


def test_reference_endpoint_matches_frontend_fixture(client):
    sample = [
        {"pid": "P1", "arrival": 0, "burst": 8},
        {"pid": "P2", "arrival": 1, "burst": 4},
        {"pid": "P3", "arrival": 2, "burst": 9},
        {"pid": "P4", "arrival": 3, "burst": 5},
    ]
    fixture = Path(__file__).resolve().parents[1] / "static" / "sample_result.json"
    expected = json.loads(fixture.read_text(encoding="utf-8"))

    response = client.post("/simulate", json={"processes": sample})
    assert response.status_code == 200
    assert response.get_json() == expected


# Exercise envelope parsing separately from engine validation.
@pytest.mark.parametrize("body, content_type, message", [
    ("{", "application/json", "Request body must be a JSON object."),
    ("", "application/json", "Request body must be a JSON object."),
    ("null", "application/json", "Request body must be a JSON object."),
    ("[]", "application/json", "Request body must be a JSON object."),
    ('{"processes": []}', "text/plain", "Request body must be a JSON object."),
    ('{}', "application/json", "Missing processes field."),
    ('{"processes": null}', "application/json", "Processes must be a list."),
    ('{"processes": [{}]}', "application/json", "Process 1 must have a non-empty PID."),
])
def test_invalid_request_envelopes(client, body, content_type, message):
    response = client.post("/simulate", data=body, content_type=content_type)
    assert response.status_code == 400
    assert response.get_json() == {"error": message}


@pytest.mark.parametrize("count", [1, 5, 15, 16])
def test_workload_counts(client, count):
    processes = [{"pid": f"P{i}", "arrival": 0, "burst": 1}
                 for i in range(1, count + 1)]
    response = client.post("/simulate", json={"processes": processes})
    assert response.status_code == (200 if count <= 15 else 400)
    if count <= 15:
        assert list(response.get_json()["metrics"]) == [p["pid"] for p in processes]
        assert len(response.get_json()["steps"]) == count
    else:
        assert response.get_json() == {"error": "A maximum of 15 processes is allowed."}


# The exact byte boundary must remain unchanged.
@pytest.mark.parametrize("size, status", [(16384, 200), (16385, 413)])
def test_request_size_boundary(client, size, status):
    body = json.dumps({"processes": [{"pid": "P1", "arrival": 0, "burst": 1}]})
    response = client.post("/simulate", data=body.ljust(size),
                           content_type="application/json")
    assert response.status_code == status


@pytest.mark.parametrize("path, content_type, marker", [
    ("/", "text/html", b'/static/js/script.js'),
    ("/static/js/script.js", "javascript", b'fetch("/simulate"'),
    ("/static/css/style.css", "text/css", b'.gantt-block'),
    ("/static/sample_result.json", "application/json", b'"steps"'),
])
def test_frontend_assets(client, path, content_type, marker):
    response = client.get(path)
    assert response.status_code == 200
    assert content_type in response.content_type
    assert marker in response.data


def test_only_post_is_allowed_for_simulation(client):
    assert client.get("/simulate").status_code == 405
