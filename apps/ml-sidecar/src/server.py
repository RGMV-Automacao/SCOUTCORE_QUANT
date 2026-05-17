"""
server.py — FastAPI Engine B sidecar v0.4.0.

Endpoints:
  GET  /health        — { ok, version, models_loaded: [..] }
  GET  /families      — { covered: [..] }  (mercados que o B suporta)
  POST /predict       — { features } → { available, slots: [{market_key, fair_prob}, ...] }

Não recomputa features: o cliente (api JS) envia features já calculadas, OU
o cliente envia { home, away, liga, data } e o servidor extrai (precisa SCOUT_DB).

Compatível com feature set v3 (32 features). Modelos treinados com v2 (12 features)
são automaticamente detectados e usados com fallback.
"""
import json
import os
import sys
import sqlite3
import time
from pathlib import Path
from typing import Optional
from collections import Counter

import joblib
import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent))
from features import extract_features, FEATURE_NAMES  # noqa: E402

DEFAULT_MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
MODELS_DIR = Path(os.environ.get("ENGINE_B_MODELS_DIR", DEFAULT_MODELS_DIR)).expanduser()
if not MODELS_DIR.is_absolute():
    MODELS_DIR = (Path.cwd() / MODELS_DIR).resolve()
ENGINE_B_VERSION = os.environ.get("ENGINE_B_VERSION", "0.4.0-xgb-lgbm")

# carrega modelos disponíveis
MODELS = {}
MANIFEST = {}
MODEL_BACKENDS = Counter()
LOAD_STARTED = time.perf_counter()
if MODELS_DIR.exists():
    mf = MODELS_DIR / "manifest.json"
    if mf.exists():
        try:
            MANIFEST = json.loads(mf.read_text(encoding="utf-8"))
        except Exception:
            MANIFEST = {}
    for f in sorted(MODELS_DIR.glob("*.joblib")):
        try:
            blob = joblib.load(f)
            MODELS[f.stem] = blob
            MODEL_BACKENDS[str(blob.get("backend", "unknown"))] += 1
        except Exception as e:
            print(f"[server] failed loading {f}: {e}", file=sys.stderr)
LOAD_MS = int((time.perf_counter() - LOAD_STARTED) * 1000)

app = FastAPI(title="ScoutCore Engine B Sidecar", version=ENGINE_B_VERSION)

# Conexão SQLite persistente (aberta 1x na inicialização; thread-safe=True para uvicorn).
_DB_CON: Optional[sqlite3.Connection] = None

def _get_db() -> Optional[sqlite3.Connection]:
    global _DB_CON
    if _DB_CON is not None:
        return _DB_CON
    scout_db = os.environ.get("SCOUT_DB")
    if scout_db:
        _DB_CON = sqlite3.connect(scout_db, check_same_thread=False)
    return _DB_CON


def canonical_market_key(name: str) -> str:
    if name == "btts_sim":
        return "btts_total_ft_sim"
    if name == "btts_nao":
        return "btts_total_ft_nao"
    if name == "1x2_home":
        return "1x2_total_ft_home"
    if name == "1x2_draw":
        return "1x2_total_ft_draw"
    if name == "1x2_away":
        return "1x2_total_ft_away"
    return name


CANONICAL_MODEL_KEYS = {canonical_market_key(name) for name in MODELS.keys()}


class PredictRequest(BaseModel):
    home: str
    away: str
    liga: str
    data: str = Field(..., description="YYYY-MM-DD")
    features: Optional[dict] = None


class Slot(BaseModel):
    market_key: str
    fair_prob: float


class PredictResponse(BaseModel):
    available: bool
    reason: Optional[str] = None
    version: str = ENGINE_B_VERSION
    feature_set: str = MANIFEST.get("feature_set", "v3")
    slots: list[Slot] = []


@app.get("/health")
def health():
    return {
        "ok": True,
        "version": ENGINE_B_VERSION,
        "feature_set": MANIFEST.get("feature_set", "v3"),
        "n_features": MANIFEST.get("n_features", len(FEATURE_NAMES)),
        "manifest_version": MANIFEST.get("version"),
        "validation_strategy": MANIFEST.get("validation_strategy"),
        "backend_preference": MANIFEST.get("backend_preference"),
        "backends_available": MANIFEST.get("backends_available"),
        "models_dir": str(MODELS_DIR),
        "models_load_ms": LOAD_MS,
        "model_backends": dict(MODEL_BACKENDS),
        "models_loaded": sorted(MODELS.keys()),
        "canonical_models_loaded": sorted(CANONICAL_MODEL_KEYS),
        "models_count": len(MODELS),
    }


@app.get("/families")
def families():
    return {"covered": sorted(MODELS.keys())}


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    if not MODELS:
        return PredictResponse(available=False, reason="no_models_trained")

    feats = req.features
    if feats is None:
        con = _get_db()
        if con is None:
            return PredictResponse(available=False, reason="no_features_and_no_db")
        try:
            feats = extract_features(con, req.liga, req.home, req.away, req.data)
        except Exception as e:
            return PredictResponse(available=False, reason=f"feature_error:{e}")
        if feats is None:
            return PredictResponse(available=False, reason="insufficient_history")

    # Resolve feature vector — suporta modelos com feature set diferente
    try:
        X = np.array([[feats[k] for k in FEATURE_NAMES]])
    except KeyError as e:
        return PredictResponse(available=False, reason=f"missing_feature:{e}")

    slots = []
    for name, blob in MODELS.items():
        clf = blob["model"]
        model_features = blob.get("features", FEATURE_NAMES)

        # Se modelo foi treinado com feature set diferente, usa apenas as features dele
        if model_features != FEATURE_NAMES:
            try:
                X_model = np.array([[feats[k] for k in model_features]])
            except KeyError:
                continue  # modelo incompatível, pula
        else:
            X_model = X

        p = float(clf.predict_proba(X_model)[0, 1])
        key = canonical_market_key(name)
        slots.append(Slot(market_key=key, fair_prob=p))
        # Complementos apenas se o modelo complementar nao foi treinado/carregado.
        if key.endswith("_sim"):
            complement = key.replace("_sim", "_nao")
            if complement not in CANONICAL_MODEL_KEYS:
                slots.append(Slot(market_key=complement, fair_prob=1.0 - p))
        elif "_over_" in key:
            complement = key.replace("_over_", "_under_")
            if complement not in CANONICAL_MODEL_KEYS:
                slots.append(Slot(market_key=complement, fair_prob=1.0 - p))

    return PredictResponse(available=True, slots=slots)
