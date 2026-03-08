import os
from backend.ai_engine import AIOrchestrator


def test_chat_mock_mode_without_openai_key():
    os.environ.pop("OPENAI_API_KEY", None)
    ai = AIOrchestrator()
    out = ai.chat(message="Help with factoring x^2-5x+6", conversation=[{"role": "user", "text": "Hi"}], metadata={})
    assert isinstance(out, dict)
    assert isinstance(out.get("response"), str)
    assert isinstance(out.get("steps", []), list)
    assert out.get("model_used") in ("mock", ai.primary_model, f"{ai.primary_model}+search")


def test_analyze_mock_mode_without_openai_key():
    os.environ.pop("OPENAI_API_KEY", None)
    ai = AIOrchestrator()
    out = ai.analyze(question="Integrate x^2", context={})
    assert isinstance(out, dict)
    assert "problem_type" in out
    assert isinstance(out.get("concepts", []), list)


def test_math_help_basic_eval():
    ai = AIOrchestrator()
    res = ai.math_help("2*(3+4)", {"show_steps": True})
    assert res.get("error") in (None, "")
    assert str(res.get("result")) in {"14", "14.0"} or res.get("result") in (14, 14.0)
