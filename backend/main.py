import asyncio
import inspect
import logging
import os
import time
from collections import defaultdict, deque
from typing import Any, Callable, Deque, Dict, List, Optional, Sequence

from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator, ConfigDict
from starlette.middleware.base import BaseHTTPMiddleware

from backend.ai_engine import AIOrchestrator

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger("backend.main")
access_logger = logging.getLogger("backend.access")

MAX_MESSAGE_LENGTH = 6000
MAX_EXPRESSION_LENGTH = 400
MAX_BODY_SIZE = 1_048_576
PAGE_URL_MAX_LENGTH = 2048
METADATA_ID_MAX_LENGTH = 256


class ConversationTurn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True)

    role: str = Field(..., description="Speaker role", min_length=1, max_length=64)
    text: str = Field(..., description="Utterance content")

    @field_validator("role", "text", mode="before")
    @classmethod
    def trim_strings(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()
        return value


class ChatContext(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True)

    conversation: List[ConversationTurn] = Field(default_factory=list)


class ChatMetadata(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True)

    page_url: Optional[str] = None
    detected_question_id: Optional[str] = None

    @field_validator("page_url", "detected_question_id", mode="before")
    @classmethod
    def trim_optional_strings(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()
        return value


class ChatRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True)

    message: str
    context: Optional[ChatContext] = Field(default_factory=ChatContext)
    metadata: Optional[ChatMetadata] = Field(default_factory=ChatMetadata)

    @field_validator("message", mode="before")
    @classmethod
    def trim_message(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()
        return value


class ChatResponseModel(BaseModel):
    response: str
    steps: List[str]
    model_used: str
    search_invoked: bool
    search_summary: Optional[str] = None


class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True)

    question: str
    context: Optional[Dict[str, Any]] = Field(default_factory=dict)

    @field_validator("question", mode="before")
    @classmethod
    def trim_question(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()
        return value


class AnalyzeResponseModel(BaseModel):
    problem_type: str
    concepts: List[str]
    suggested_strategy: str
    steps: List[str]
    hints: List[str]
    confidence: float


class MathHelpOptions(BaseModel):
    show_steps: Optional[bool] = False


class MathHelpRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True)

    expression: str
    options: Optional[MathHelpOptions] = Field(default_factory=MathHelpOptions)


class MathHelpResponseModel(BaseModel):
    result: Optional[str]
    steps: List[str] = []
    used_sympy: bool = False
    error: Optional[str] = None


# ---------------- Middleware -----------------
class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: FastAPI, max_body_size: int) -> None:
        super().__init__(app)
        self.max_body_size = max_body_size

    async def dispatch(self, request: Request, call_next: Callable):  # type: ignore[override]
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > self.max_body_size:
            return JSONResponse(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, content={"detail": "Request body too large."})
        # Otherwise, proceed; Starlette will stream body. We avoid buffering here for performance.
        return await call_next(request)


class SlidingWindowRateLimiter(BaseHTTPMiddleware):
    def __init__(self, app: FastAPI, max_requests: int, window_seconds: int) -> None:
        super().__init__(app)
        self.max_requests = max_requests
        self.window = window_seconds
        self.hits: Dict[str, Deque[float]] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next: Callable):  # type: ignore[override]
        ip = request.client.host if request.client else "unknown"
        now = time.time()
        dq = self.hits[ip]
        # purge
        while dq and (now - dq[0]) > self.window:
            dq.popleft()
        if len(dq) >= self.max_requests:
            retry_after = max(1, int(self.window - (now - dq[0]))) if dq else self.window
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                headers={"Retry-After": str(retry_after)},
                content={"detail": "Rate limit exceeded. Please try again later."},
            )
        dq.append(now)
        return await call_next(request)


class AccessLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable):  # type: ignore[override]
        start = time.time()
        try:
            response = await call_next(request)
            return response
        finally:
            dur_ms = int((time.time() - start) * 1000)
            access_logger.info("%s %s %s %dms", request.client.host if request.client else "-", request.method, request.url.path, dur_ms)


# ---------------- App init -----------------
app = FastAPI(title="StudyNHelp AI Tutor", version="1.0.0")

# CORS
raw_origins = os.getenv("CORS_ALLOW_ORIGINS", "*")
origins = [o.strip() for o in raw_origins.split(",")] if raw_origins else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Body size + rate limiting
app.add_middleware(BodySizeLimitMiddleware, max_body_size=MAX_BODY_SIZE)
rate_limit = int(os.getenv("RATE_LIMIT", "60"))
rate_window = int(os.getenv("RATE_WINDOW", "60"))
app.add_middleware(SlidingWindowRateLimiter, max_requests=rate_limit, window_seconds=rate_window)
app.add_middleware(AccessLogMiddleware)

orchestrator = AIOrchestrator()


# ---------------- Utilities -----------------

def sanitize_text(s: Optional[str]) -> Optional[str]:
    if s is None:
        return None
    s2 = s.replace("\u0000", "").strip()
    return s2


def enforce_max_length(s: str, max_len: int, field_name: str) -> str:
    if len(s) > max_len:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=f"{field_name} is too long (>{max_len} chars)")
    return s


async def _invoke_orchestrator(func_names: Sequence[str], kwargs: Dict[str, Any]) -> Dict[str, Any]:
    # Try multiple possible method names for resilience
    for name in func_names:
        if hasattr(orchestrator, name):
            fn = getattr(orchestrator, name)
            try:
                if inspect.iscoroutinefunction(fn):
                    return await fn(**kwargs)
                return fn(**kwargs)
            except HTTPException:
                raise
            except Exception as exc:  # pragma: no cover - safeguard
                logger.error("orchestrator error in %s: %s", name, exc)
                raise HTTPException(status_code=500, detail="Internal error.") from None
    raise HTTPException(status_code=500, detail="Service not available.")


# ---------------- Routes -----------------
@app.get("/healthz")
async def healthz() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/assistant.js")
async def serve_assistant_js() -> Response:
    path = os.path.join(os.getcwd(), "frontend", "assistant.js")
    if not os.path.exists(path):
        return JSONResponse(status_code=404, content={
            "detail": "assistant.js not found. Run: cd frontend && npm install && npm run build"
        })
    with open(path, "rb") as f:
        content = f.read()
    headers = {
        "Cache-Control": "public, max-age=600",
        "Content-Type": "application/javascript; charset=utf-8",
    }
    return Response(content=content, media_type="application/javascript", headers=headers)


@app.post("/chat", response_model=ChatResponseModel)
async def chat_endpoint(chat_request: ChatRequest) -> Dict[str, Any]:
    message = chat_request.message
    if not isinstance(message, str) or not message.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="message must be a non-empty string.")

    message = sanitize_text(message) or ""
    message = enforce_max_length(message, MAX_MESSAGE_LENGTH, "message")

    conv_list = chat_request.context.conversation if chat_request.context else []
    conversation = [{"role": t.role, "text": t.text} for t in conv_list][:12]

    md = chat_request.metadata or ChatMetadata()
    page_url = (md.page_url or "")[:PAGE_URL_MAX_LENGTH]
    detected_id = (md.detected_question_id or "")[:METADATA_ID_MAX_LENGTH]
    metadata = {"page_url": page_url, "detected_question_id": detected_id}

    result = await _invoke_orchestrator(("chat", "tutor", "converse"), {"message": message, "conversation": conversation, "metadata": metadata})

    # Validate and coerce response
    response = ChatResponseModel(**result)
    return response.dict(exclude_none=True)


@app.post("/analyze", response_model=AnalyzeResponseModel)
async def analyze_endpoint(analyze_request: AnalyzeRequest) -> Dict[str, Any]:
    question = analyze_request.question
    if not isinstance(question, str) or not question.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="question must be a non-empty string.")

    question = sanitize_text(question) or ""
    question = enforce_max_length(question, MAX_MESSAGE_LENGTH, "question")

    context_payload = analyze_request.context or {}
    if not isinstance(context_payload, dict):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="context must be an object.",
        )

    result = await _invoke_orchestrator(("analyze", "analyze_question", "process_analysis"), {"question": question, "context": context_payload})

    analyze_response = AnalyzeResponseModel(**result)
    return analyze_response.dict(exclude_none=True)


@app.post("/math_help", response_model=MathHelpResponseModel)
async def math_help_endpoint(math_request: MathHelpRequest) -> Dict[str, Any]:
    expression = math_request.expression
    if not isinstance(expression, str) or not expression.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="expression must be a non-empty string.",
        )
    expression = sanitize_text(expression) or ""
    expression = enforce_max_length(expression, MAX_EXPRESSION_LENGTH, "expression")

    show_steps = bool(math_request.options.show_steps) if math_request.options else False

    result = await _invoke_orchestrator(("math_help", "solve_math", "process_math_request"), {"expression": expression, "options": {"show_steps": show_steps}})

    if "used_sympy" in result:
        result["used_sympy"] = bool(result["used_sympy"])
    else:
        result["used_sympy"] = False

    math_response = MathHelpResponseModel(**result)
    return math_response.dict(exclude_none=True)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "backend.main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        reload=False,
    )
