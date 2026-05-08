# @scoutcore/ml-sidecar — Engine B (gradient boosting)

Sidecar Python que serve Engine B do Motor 4x4 via HTTP.

**Honestidade**: usa `sklearn.GradientBoostingClassifier` (não XGBoost/LightGBM
para evitar dependência nativa pesada). Treina em famílias com amostra
suficiente; quando dados não bastam, o endpoint reporta `available:false` por
família e a bridge JS degrada para Engine A puro.

## Arquitetura

```
apps/ml-sidecar/
  src/
    server.py        # FastAPI POST /predict, GET /health, GET /families
    train.py         # CLI: lê DB SQLite, treina modelos, salva em models/
    features.py      # extrator de features de match/team_profile
    schema.py        # Pydantic models (request/response)
  models/            # *.joblib (gerados por train.py — gitignored)
  requirements.txt
```

## Setup

```bash
cd apps/ml-sidecar
pip install -r requirements.txt
```

## Treinar

```bash
SCOUT_DB="C:\path\to\scout.db" python src/train.py
```

Saída: `models/{family}__{direction}.joblib` + `models/manifest.json`.

## Servir

```bash
uvicorn src.server:app --host 127.0.0.1 --port 4055
```

Health: `http://127.0.0.1:4055/health`.

## Bridge JS

`packages/engine-b-bridge` envia POST para `ENGINE_B_URL` (default
`http://127.0.0.1:4055/predict`). Se falhar (timeout/connection refused) ou
sidecar reportar `available:false`, o curinga degrada para A puro.
