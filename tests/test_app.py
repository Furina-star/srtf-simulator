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
