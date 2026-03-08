import os
from fastapi.testclient import TestClient

os.environ.pop("OPENAI_API_KEY", None)  # ensure mock path

from backend.main import app  # noqa: E402

client = TestClient(app)


def test_healthz():
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_chat_mock():
    payload = {
        "message": "Help me factor x^2 - 5x + 6",
        "context": {"conversation": [{"role": "user", "text": "Hi"}]},
        "metadata": {"page_url": "http://example.com", "detected_question_id": None},
    }
    r = client.post("/chat", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "response" in data and isinstance(data["response"], str)
    assert isinstance(data.get("steps", []), list)
    assert data.get("search_invoked") in (True, False)


def test_analyze_mock():
    r = client.post("/analyze", json={"question": "Integrate x^2", "context": {}})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "problem_type" in data
    assert isinstance(data.get("concepts", []), list)
    assert isinstance(data.get("confidence", 0), (int, float))


def test_math_help_simple():
    r = client.post("/math_help", json={"expression": "2*(3+4)", "options": {"show_steps": True}})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("result") in (14, "14", 14.0)
    assert data.get("error") in (None, "")
