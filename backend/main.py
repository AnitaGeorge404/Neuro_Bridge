import os
import time

from dotenv import load_dotenv

load_dotenv()

# Google Cloud bootstrap must run before any module reads secrets at import time.
from .services import google_cloud  # noqa: E402

google_cloud.setup_logging()
_LOADED_SECRETS = google_cloud.load_secrets_into_env()

from fastapi import Depends, FastAPI, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from .auth import verify_app_check  # noqa: E402
from .database import Base, engine  # noqa: E402
from .routers import (  # noqa: E402
    adhd_router, agent_router, ai_proxy_router, anxiety_router, document_router, google_router, ocd_router, privacy_router,
)
from .services import google_ai_service  # noqa: E402

# Create database tables (in a real app, use Alembic migrations)
from .models import adhd_models, agent_models, anxiety_models, asd_models, google_models, ocd_models  # noqa: E402,F401

Base.metadata.create_all(bind=engine)

app = FastAPI(title="NeuroBridge API")

_allowed_origins = [origin.strip() for origin in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if origin.strip()]
if not _allowed_origins:
    # Local dev fallback only — production must set CORS_ALLOWED_ORIGINS explicitly.
    _allowed_origins = [
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _request_telemetry(request: Request, call_next):
    """One structured Cloud Logging entry per request (route template, status,
    latency; never bodies or headers), correlated with Cloud Trace on Cloud Run."""
    start = time.monotonic()
    trace = (request.headers.get("x-cloud-trace-context") or "").split("/")[0] or None
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    finally:
        if google_cloud.STRUCTURED:
            google_cloud.log_structured(
                "request",
                trace=trace,
                nb_event="http_request",
                httpRequest={"requestMethod": request.method, "status": status_code,
                             "latency": f"{time.monotonic() - start:.3f}s"},
                route=request.url.path,  # paths carry only numeric ids, never user text
                latency_ms=int((time.monotonic() - start) * 1000),
            )


_app_check = [Depends(verify_app_check)]
app.include_router(ocd_router.router, prefix="/api/ocd", tags=["ocd"])
app.include_router(agent_router.router, prefix="/api/agent", tags=["agent"], dependencies=_app_check)
app.include_router(adhd_router.router, prefix="/api/adhd", tags=["adhd"])
app.include_router(anxiety_router.router, prefix="/api/anxiety", tags=["anxiety"])
app.include_router(ai_proxy_router.router, prefix="/api/ai", tags=["ai"], dependencies=_app_check)
app.include_router(privacy_router.router, prefix="/api/privacy", tags=["privacy"])
app.include_router(document_router.router, prefix="/api/documents", tags=["documents"], dependencies=_app_check)
app.include_router(google_router.router, prefix="/api/google", tags=["google"])


@app.get("/")
def read_root():
    return {"message": "Welcome to NeuroBridge API"}


@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "service": "NeuroBridge API",
        "version": "1.1.0",
        "google_ai_configured": google_ai_service.is_configured(),
        "google_ai_backend": google_ai_service.backend_name(),
        "secrets_from_secret_manager": _LOADED_SECRETS,
        "revision": os.getenv("K_REVISION"),
        "database": "connected",
    }
