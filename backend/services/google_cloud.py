"""
Google Cloud platform glue for NeuroBridge: Secret Manager, Cloud Logging,
Cloud Monitoring (via log-based metrics) and BigQuery product analytics.

Everything here is optional and fails soft: with no GCP credentials the app
runs exactly as before (plain logs, no secrets fetched, no BigQuery rows).

Privacy contract — NEVER pass conversation text, document content, emails or
raw user ids into `emit_event`. Only event names, module names, statuses,
counts and latencies. BigQuery rows carry no user identifier at all.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import sys
import threading
import time
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger("neurobridge")

GCP_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("GCP_PROJECT") or os.getenv("FIREBASE_PROJECT_ID") or ""
ON_CLOUD_RUN = bool(os.getenv("K_SERVICE"))
STRUCTURED = ON_CLOUD_RUN or os.getenv("LOG_FORMAT", "").lower() == "json"

# --------------------------------------------------------------------------
# Secret Manager
# --------------------------------------------------------------------------

def load_secrets_into_env() -> list[str]:
    """Pull secrets named in GCP_SECRET_NAMES (comma list) from Secret Manager
    into os.environ, unless already set. Must run before modules that read env
    at import time (auth, agent_service). Returns the names it loaded."""
    names = [n.strip() for n in os.getenv("GCP_SECRET_NAMES", "").split(",") if n.strip()]
    project = os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("GCP_PROJECT") or ""
    if not names or not project:
        return []
    try:
        from google.cloud import secretmanager
        client = secretmanager.SecretManagerServiceClient()
    except Exception as e:  # library or credentials missing
        print(f"[secret-manager] unavailable: {type(e).__name__}", file=sys.stderr)
        return []
    loaded = []
    for name in names:
        if os.getenv(name):
            continue
        try:
            resp = client.access_secret_version(name=f"projects/{project}/secrets/{name}/versions/latest")
            os.environ[name] = resp.payload.data.decode("utf-8").strip()
            loaded.append(name)
        except Exception as e:
            print(f"[secret-manager] could not load {name}: {type(e).__name__}", file=sys.stderr)
    return loaded


# --------------------------------------------------------------------------
# Cloud Logging — structured JSON on stdout (Cloud Run's native ingestion path)
# --------------------------------------------------------------------------

class _CloudJsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "severity": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
            "time": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
        }
        fields = getattr(record, "nb_fields", None)
        if fields:
            entry.update(fields)
        trace = getattr(record, "nb_trace", None)
        if trace and GCP_PROJECT:
            entry["logging.googleapis.com/trace"] = f"projects/{GCP_PROJECT}/traces/{trace}"
        return json.dumps(entry, default=str)


def setup_logging() -> None:
    """JSON logs on Cloud Run (or LOG_FORMAT=json); human-readable locally."""
    root = logging.getLogger()
    if getattr(root, "_nb_configured", False):
        return
    handler = logging.StreamHandler(sys.stdout)
    if STRUCTURED:
        handler.setFormatter(_CloudJsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
    root.addHandler(handler)
    root.setLevel(os.getenv("LOG_LEVEL", "INFO"))
    root._nb_configured = True  # type: ignore[attr-defined]


def log_structured(message: str, severity: int = logging.INFO, trace: Optional[str] = None, **fields: Any) -> None:
    logger.log(severity, message, extra={"nb_fields": fields, "nb_trace": trace})


# --------------------------------------------------------------------------
# Product events -> Cloud Logging (metrics) + BigQuery (analytics)
# --------------------------------------------------------------------------

BQ_DATASET = os.getenv("BIGQUERY_DATASET", "")
BQ_TABLE = os.getenv("BIGQUERY_EVENTS_TABLE", "product_events")
_ALLOWED_FIELDS = {"module", "status", "latency_ms", "tool", "model", "count", "source"}

_bq_queue: "queue.Queue[dict]" = queue.Queue(maxsize=5000)
_bq_thread: Optional[threading.Thread] = None
_bq_client = None
bq_stats = {"inserted": 0, "errors": 0, "last_error": None}


def _bq_table_id() -> str:
    return f"{GCP_PROJECT}.{BQ_DATASET}.{BQ_TABLE}"


def _bq_worker() -> None:
    global _bq_client
    while True:
        rows = [_bq_queue.get()]
        deadline = time.monotonic() + 2.0
        while len(rows) < 200 and time.monotonic() < deadline:
            try:
                rows.append(_bq_queue.get(timeout=0.25))
            except queue.Empty:
                pass
        try:
            if _bq_client is None:
                from google.cloud import bigquery
                _bq_client = bigquery.Client(project=GCP_PROJECT)
            errors = _bq_client.insert_rows_json(_bq_table_id(), rows)
            if errors:
                bq_stats["errors"] += len(errors)
                bq_stats["last_error"] = str(errors[0])[:300]
            else:
                bq_stats["inserted"] += len(rows)
        except Exception as e:
            bq_stats["errors"] += len(rows)
            bq_stats["last_error"] = f"{type(e).__name__}: {str(e)[:250]}"


def bigquery_enabled() -> bool:
    return bool(BQ_DATASET and GCP_PROJECT)


def emit_event(event_name: str, **fields: Any) -> None:
    """Record a privacy-safe product event. Unknown fields are dropped."""
    global _bq_thread
    safe = {k: v for k, v in fields.items() if k in _ALLOWED_FIELDS and v is not None}
    # `nb_event` is the key the Cloud Monitoring log-based metrics filter on (see deploy/).
    log_structured(f"event {event_name}", nb_event=event_name, **safe)
    if not bigquery_enabled():
        return
    if _bq_thread is None or not _bq_thread.is_alive():
        _bq_thread = threading.Thread(target=_bq_worker, name="bq-events", daemon=True)
        _bq_thread.start()
    row = {"event_name": event_name, "event_ts": datetime.now(timezone.utc).isoformat(), **safe}
    if "latency_ms" in row:
        row["latency_ms"] = int(row["latency_ms"])
    try:
        _bq_queue.put_nowait(row)
    except queue.Full:
        bq_stats["errors"] += 1


def status() -> dict:
    return {
        "project": GCP_PROJECT or None,
        "on_cloud_run": ON_CLOUD_RUN,
        "cloud_run_service": os.getenv("K_SERVICE"),
        "cloud_run_revision": os.getenv("K_REVISION"),
        "structured_logging": STRUCTURED,
        "secret_manager_names": [n for n in os.getenv("GCP_SECRET_NAMES", "").split(",") if n],
        "bigquery": {"enabled": bigquery_enabled(), "table": _bq_table_id() if bigquery_enabled() else None, **bq_stats},
    }
