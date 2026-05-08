"""
server.py — FastAPI Engine B sidecar.

Endpoints:
  GET  /health        — { ok, version, models_loaded: [..] }
  GET  /families      — { covered: [..] }  (mercados que o B suporta)
  POST /predict       — { features } → { available, slots: [{market_key, fair_prob}, ...] }

Não recomputa features: o cliente (api JS) envia features já calculadas, OU
o cliente envia { home, away, liga, data } e o servidor extrai (precisa SCOUT_DB).
"""
import json
import os
import sys
import sqlite3
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent))
from features import extract_features, FEATURE_NAMES  # noqa: E402

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
ENGINE_B_VERSION = "0.1.0"

# carrega modelos disponíveis
MODELS = {}
MANIFEST = {}
if MODELS_DIR.exists():
    for f in MODELS_DIR.glob("*.joblib"):
        try:
            blob = joblib.load(f)
            MODELS[f.stem] = blob
        except Exception as e:
            print(f"[server] failed loading {f}: {e}", file=sys.stderr)
    mf = MODELS_DIR / "manifest.json"
    if mf.exists():
        try:
            MANIFEST = json.loads(mf.read_text(encoding="utf-8"))
        except Exception:
            MANIFEST = {}

app = FastAPI(title="ScoutCore Engine B Sidecar", version=ENGINE_B_VERSION)


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
    slots: list[Slot] = []


@app.get("/health")
def health():
    return {
        "ok": True,
        "version": ENGINE_B_VERSION,
        "models_loaded": sorted(MODELS.keys()),
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
        scout_db = os.environ.get("SCOUT_DB")
        if not scout_db:
            return PredictResponse(available=False, reason="no_features_and_no_db")
        con = sqlite3.connect(scout_db)
        try:
            feats = extract_features(con, req.liga, req.home, req.away, req.data)
        finally:
            con.close()
        if feats is None:
            return PredictResponse(available=False, reason="insufficient_history")

    try:
        X = np.array([[feats[k] for k in FEATURE_NAMES]])
    except KeyError as e:
        return PredictResponse(available=False, reason=f"missing_feature:{e}")

    slots = []
    for name, blob in MODELS.items():
        clf = blob["model"]
        p = float(clf.predict_proba(X)[0, 1])
        slots.append(Slot(market_key=name, fair_prob=p))
        # complement para under/nao
        if name.endswith("_sim"):
            slots.append(Slot(market_key=name.replace("_sim", "_nao"), fair_prob=1.0 - p))
        elif "_over_" in name:
            slots.append(Slot(market_key=name.replace("_over_", "_under_"), fair_prob=1.0 - p))

    return PredictResponse(available=True, slots=slots)
