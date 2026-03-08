import ast
import json
import logging
import math
import os
import re
import threading
import time
from collections import OrderedDict
from copy import deepcopy
from typing import Any, Dict, Iterable, List, Optional, Tuple

try:
    from cachetools import TTLCache  # type: ignore
except ImportError:  # pragma: no cover - optional dependency
    TTLCache = None  # type: ignore

logger = logging.getLogger(__name__)


class LocalTTLCache:
    """Simple thread-safe TTL cache as a fallback when cachetools is unavailable."""

    def __init__(self, maxsize: int, ttl: int) -> None:
        if maxsize <= 0:
            raise ValueError("maxsize must be positive")
        if ttl <= 0:
            raise ValueError("ttl must be positive")
        self.maxsize = maxsize
        self.ttl = ttl
        self._store: "OrderedDict[Any, Tuple[Any, float]]" = OrderedDict()
        self._lock = threading.Lock()

    def __getitem__(self, key: Any) -> Any:
        with self._lock:
            self._purge_expired()
            if key not in self._store:
                raise KeyError(key)
            value, expire_at = self._store[key]
            if expire_at < time.time():
                del self._store[key]
                raise KeyError(key)
            self._store.move_to_end(key)
            return value

    def __setitem__(self, key: Any, value: Any) -> None:
        with self._lock:
            now = time.time()
            self._store[key] = (value, now + self.ttl)
            self._store.move_to_end(key)
            self._purge_expired(now)
            self._enforce_size()

    def get(self, key: Any, default: Any = None) -> Any:
        try:
            return self.__getitem__(key)
        except KeyError:
            return default

    def _purge_expired(self, now: Optional[float] = None) -> None:
        if now is None:
            now = time.time()
        expired_keys = [k for k, (_, exp) in self._store.items() if exp < now]
        for k in expired_keys:
            self._store.pop(k, None)

    def _enforce_size(self) -> None:
        while len(self._store) > self.maxsize:
            self._store.popitem(last=False)


def _env_bool(name: str, default: bool = False) -> bool:
    val = os.getenv(name)
    if val is None:
        return default
    return str(val).strip().lower() in {"1", "true", "yes", "on"}


def parse_model_json(text: str) -> Dict[str, Any]:
    """Try to locate and parse the first JSON object within freeform LLM text."""
    if not text:
        return {}
    s = text.strip()
    s = re.sub(r"^```[a-zA-Z]*\n|\n```$", "", s)
    start = s.find("{")
    end = s.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return {}
    candidate = s[start : end + 1]
    candidate = candidate.replace("'", '"')
    candidate = re.sub(r",\s*([}\]])", r"\1", candidate)

    try:
        return json.loads(candidate)
    except Exception:
        try:
            candidate2 = re.sub(r"([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)", r'\1"\2"\3', candidate)
            return json.loads(candidate2)
        except Exception:
            return {}


class _SafeEval(ast.NodeVisitor):
    allowed_nodes = (
        ast.Expression, ast.BinOp, ast.UnaryOp, ast.Add, ast.Sub, ast.Mult,
        ast.Div, ast.Pow, ast.Mod, ast.USub, ast.UAdd, ast.FloorDiv,
        ast.Constant, ast.Load, ast.Call, ast.Name,
    )

    allowed_funcs = {
        'sin': math.sin, 'cos': math.cos, 'tan': math.tan,
        'log': math.log, 'log10': math.log10, 'sqrt': math.sqrt,
        'exp': math.exp, 'pow': pow, 'abs': abs,
        'floor': math.floor, 'ceil': math.ceil, 'round': round,
        'pi': math.pi, 'e': math.e,
    }

    def __init__(self) -> None:
        self._names: Dict[str, Any] = {k: v for k, v in self.allowed_funcs.items()}

    def visit(self, node: ast.AST) -> Any:
        if not isinstance(node, self.allowed_nodes):
            raise ValueError(f"Disallowed expression: {type(node).__name__}")
        return super().visit(node)

    def visit_Expression(self, node: ast.Expression) -> Any:
        return self.visit(node.body)

    def visit_BinOp(self, node: ast.BinOp) -> Any:
        left = self.visit(node.left)
        right = self.visit(node.right)
        if isinstance(node.op, ast.Add): return left + right
        if isinstance(node.op, ast.Sub): return left - right
        if isinstance(node.op, ast.Mult): return left * right
        if isinstance(node.op, ast.Div): return left / right
        if isinstance(node.op, ast.Pow): return left ** right
        if isinstance(node.op, ast.Mod): return left % right
        if isinstance(node.op, ast.FloorDiv): return left // right
        raise ValueError("Unsupported binary operator")

    def visit_UnaryOp(self, node: ast.UnaryOp) -> Any:
        operand = self.visit(node.operand)
        if isinstance(node.op, ast.UAdd): return +operand
        if isinstance(node.op, ast.USub): return -operand
        raise ValueError("Unsupported unary operator")

    def visit_Constant(self, node: ast.Constant) -> Any:
        if isinstance(node.value, (int, float)):
            return node.value
        raise ValueError("Constants other than numbers are not allowed")

    def visit_Name(self, node: ast.Name) -> Any:
        if node.id in self._names:
            return self._names[node.id]
        raise ValueError(f"Name '{node.id}' is not allowed")

    def visit_Call(self, node: ast.Call) -> Any:
        if not isinstance(node.func, ast.Name) or node.func.id not in self._names:
            raise ValueError("Only selected math functions are allowed")
        func = self._names[node.func.id]
        args = [self.visit(a) for a in node.args]
        if node.keywords:
            raise ValueError("Keyword arguments are not allowed")
        return func(*args)


def safe_basic_eval(expr: str) -> Optional[float]:
    try:
        tree = ast.parse(expr, mode='eval')
        evaluator = _SafeEval()
        return float(evaluator.visit(tree))
    except Exception:
        return None


class AIOrchestrator:
    def __init__(self) -> None:
        self.primary_model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        self.search_model = os.getenv("SEARCH_MODEL", "gpt-4o-mini")
        self.api_key = os.getenv("OPENAI_API_KEY")
        self.search_enabled = _env_bool("AI_SEARCH_ENABLED", False)
        ttl = int(os.getenv("AI_CACHE_TTL", "600"))
        maxsize = int(os.getenv("AI_CACHE_MAX", "256"))

        if TTLCache is not None:
            self.cache = TTLCache(maxsize=maxsize, ttl=ttl)
        else:
            self.cache = LocalTTLCache(maxsize=maxsize, ttl=ttl)

        self._openai_client = None
        self._sympy = None
        self.logger = logging.getLogger(self.__class__.__name__)

    def _get_openai(self):
        if self._openai_client is not None:
            return self._openai_client
        if not self.api_key:
            return None
        try:
            from openai import OpenAI
        except Exception as exc:
            self.logger.warning("OpenAI SDK not available: %s", exc)
            return None
        try:
            self._openai_client = OpenAI(api_key=self.api_key)
            return self._openai_client
        except Exception as exc:
            self.logger.error("Failed to init OpenAI client: %s", exc)
            return None

    def _get_sympy(self):
        if self._sympy is not None:
            return self._sympy
        try:
            import sympy
            self._sympy = sympy
        except Exception:
            self._sympy = None
        return self._sympy

    def chat(self, message: str, conversation: List[Dict[str, str]], metadata: Dict[str, Any]) -> Dict[str, Any]:
        cache_key = ("chat", message.strip(), tuple(sorted((k, str(metadata.get(k))) for k in (metadata or {}).keys())))
        cached = self.cache.get(cache_key)
        if cached:
            return deepcopy(cached)

        needs_search_hint = self._needs_search_heuristic(message)
        client = self._get_openai()

        if client is None:
            resp = {
                "response": self._mock_tutor_response(message),
                "steps": self._mock_steps(message),
                "model_used": "mock",
                "search_invoked": False,
                "search_summary": None,
            }
            self.cache[cache_key] = resp
            return deepcopy(resp)

        system_prompt = (
            "You are a helpful AI tutor. Give hints first, ask clarifying questions, "
            "and only reveal final answers when the student explicitly requests them. "
            "Return a compact JSON with keys: response (string), steps (array of short strings), "
            "confidence (0..1), needs_search (boolean). Keep it concise."
        )

        msgs = [{"role": "system", "content": system_prompt}]
        for m in conversation[-6:]:
            role = m.get("role", "user")
            text = m.get("text") or m.get("content") or ""
            if text:
                msgs.append({"role": role, "content": text[-2000:]})
        msgs.append({"role": "user", "content": message[-4000:]})

        result = self._call_openai_json(client, self.primary_model, msgs)
        confidence = float(result.get("confidence", 0.6))
        needs_search = bool(result.get("needs_search", False) or needs_search_hint)

        search_invoked = False
        search_summary = None
        if needs_search and self.search_enabled:
            search_invoked = True
            summary, _ = self._maybe_search(message)
            search_summary = summary
            refine_msgs = [
                {"role": "system", "content": system_prompt + " Use the following evidence if relevant: " + (search_summary or "")},
                {"role": "user", "content": message[-4000:]},
            ]
            result = self._call_openai_json(client, self.primary_model, refine_msgs)

        response_text = str(result.get("response") or result.get("answer") or "I'm here to help. Let's break this down.")
        steps_list = result.get("steps")
        steps: List[str] = []
        if isinstance(steps_list, list):
            steps = [str(s) for s in steps_list][:8]
        else:
            steps = self._heuristic_steps_from_text(response_text)

        out = {
            "response": response_text,
            "steps": steps,
            "model_used": self.primary_model + ("+search" if search_invoked else ""),
            "search_invoked": search_invoked,
            "search_summary": search_summary,
        }
        self.logger.info("chat model=%s search=%s", out["model_used"], search_invoked)
        self.cache[cache_key] = out
        return deepcopy(out)

    def analyze(self, question: str, context: Dict[str, Any]) -> Dict[str, Any]:
        cache_key = ("analyze", question.strip())
        cached = self.cache.get(cache_key)
        if cached:
            return deepcopy(cached)

        client = self._get_openai()
        if client is None:
            out = {
                "problem_type": "unknown",
                "concepts": ["reading comprehension", "estimation"],
                "suggested_strategy": "Identify what is asked, list knowns/unknowns, and choose a method.",
                "steps": [
                    "Restate the problem in your own words",
                    "Identify given information and what is required",
                    "Select formulas or concepts that connect them",
                    "Work through calculations carefully",
                ],
                "hints": ["Underline key quantities", "Sketch a quick diagram if it helps"],
                "confidence": 0.7,
            }
            self.cache[cache_key] = out
            return deepcopy(out)

        system_prompt = (
            "Analyze the student's problem and return compact JSON with keys: "
            "problem_type (string), concepts (array), suggested_strategy (string), steps (array of strings), "
            "hints (array of strings), confidence (0..1)."
        )
        msgs = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": question[-6000:]},
        ]
        result = self._call_openai_json(client, self.primary_model, msgs)
        out = {
            "problem_type": str(result.get("problem_type") or result.get("type") or "unknown"),
            "concepts": [str(c) for c in (result.get("concepts") or [])][:8],
            "suggested_strategy": str(result.get("suggested_strategy") or result.get("strategy") or ""),
            "steps": [str(s) for s in (result.get("steps") or [])][:10],
            "hints": [str(h) for h in (result.get("hints") or [])][:8],
            "confidence": float(result.get("confidence", 0.6)),
        }
        self.cache[cache_key] = out
        return deepcopy(out)

    def math_help(self, expression: str, options: Dict[str, Any]) -> Dict[str, Any]:
        self._get_sympy()
        expression = (expression or "").strip()
        if not expression:
            return {"result": None, "steps": [], "used_sympy": bool(self._sympy), "error": "Empty expression."}

        show_steps = bool(options.get("show_steps"))
        numeric = bool(options.get("numeric"))
        precision = options.get("precision")

        if self._sympy is not None:
            try:
                sympy_expr = self._sympy.sympify(expression)
                simplified = self._sympy.simplify(sympy_expr)
                result_value: Any = simplified
                if numeric:
                    if isinstance(precision, int) and 2 <= precision <= 50:
                        result_value = simplified.evalf(precision)
                    else:
                        result_value = simplified.evalf()
                steps: List[str] = []
                if show_steps:
                    steps.append(f"Parsed expression: {sympy_expr}")
                    if simplified != sympy_expr:
                        steps.append(f"Simplified form: {simplified}")
                    if numeric:
                        steps.append(f"Numeric evaluation: {result_value}")
                return {"result": str(result_value), "steps": steps, "used_sympy": True, "error": None}
            except Exception as exc:
                self.logger.debug("Sympy evaluation failed (%s); attempting fallback.", exc)

        value = safe_basic_eval(expression)
        if value is not None:
            steps = [f"Evaluated arithmetic expression: {expression}"] if show_steps else []
            return {"result": value, "steps": steps, "used_sympy": False, "error": None}

        return {"result": None, "steps": [], "used_sympy": bool(self._sympy), "error": "Unable to evaluate expression safely."}

    def _needs_search_heuristic(self, text: str) -> bool:
        t = (text or "").lower()
        year_match = re.findall(r"\b(202[4-9]|203\d)\b", t)
        keywords = ["latest", "current", "recent", "news", "today", "this year", "update"]
        return bool(year_match or any(k in t for k in keywords))

    def _heuristic_steps_from_text(self, text: str) -> List[str]:
        bullets = re.split(r"\n\s*(?:[-*•]|\d+[.)])\s+", text)
        parts = [p.strip() for p in bullets if p.strip()]
        if len(parts) >= 2:
            return parts[:8]
        sents = re.split(r"(?<=[.!?])\s+", text)
        return [s.strip() for s in sents if s.strip()][:5]

    def _call_openai_json(self, client: Any, model: str, messages: List[Dict[str, str]]) -> Dict[str, Any]:
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.2,
                response_format={"type": "json_object"},
                max_completion_tokens=800,  # fixed: was max_tokens
            )
            content = resp.choices[0].message.content if resp and resp.choices else "{}"
            return parse_model_json(content) or {}
        except Exception as exc:
            self.logger.error("OpenAI call failed: %s", exc)
            return {}

    def _maybe_search(self, query: str) -> Tuple[Optional[str], List[Dict[str, Any]]]:
        info = self.run_search(query)
        if not info.get("invoked"):
            return None, []
        results = info.get("results") or []
        if info.get("summary"):
            return str(info["summary"]), results
        titles = ", ".join([r.get("title", "") for r in results[:3]])
        return f"Search found {len(results)} results: {titles}", results

    def run_search(self, query: str) -> Dict[str, Any]:
        if not self.search_enabled:
            return {"invoked": False, "summary": None, "results": []}

        tav_key = os.getenv("TAVILY_API_KEY")
        if tav_key:
            try:
                from tavily import TavilyClient
                tc = TavilyClient(api_key=tav_key)
                data = tc.search(query=query, max_results=3)
                results = [
                    {"title": r.get("title"), "url": r.get("url"), "content": r.get("content")}
                    for r in data.get("results", [])[:3]
                ]
                pieces = [r.get("content", "") for r in results]
                summary = " ".join(" ".join(pieces).split()[:120])
                return {"invoked": True, "summary": summary, "results": results}
            except Exception as exc:
                self.logger.warning("Tavily search failed: %s", exc)

        results = [
            {"title": "Reference 1", "url": "https://example.com/ref1", "content": "General background and definitions."},
            {"title": "Reference 2", "url": "https://example.com/ref2", "content": "Worked examples and common pitfalls."},
        ]
        summary = "Mocked search summary: reviewed 2 references with background info and examples relevant to the query."
        return {"invoked": True, "summary": summary, "results": results}

    def _mock_tutor_response(self, message: str) -> str:
        return (
            "Let's approach this step by step. What is the problem asking for? "
            "Identify given values and the goal. I can offer hints first—would you like a nudge or the full solution?"
        )

    def _mock_steps(self, message: str) -> List[str]:
        return [
            "Restate the question in your own words",
            "List knowns and unknowns",
            "Choose a method or formula",
            "Compute carefully and check units",
            "Reflect: does the answer make sense?",
        ]
