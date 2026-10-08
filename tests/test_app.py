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
