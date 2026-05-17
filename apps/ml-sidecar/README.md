# @scoutcore/ml-sidecar — Engine B v0.4.0 (gradient boosting)

Sidecar Python que serve Engine B do Motor 4x4 via HTTP.

## Engine B v0.4.0 — Changelog

- **Feature set v3**: 32 features (era 12 no v0.3.0)
  - Gols: marcados, sofridos, btts, form_pts5 (home/away) — 10
  - Contagem: escanteios, chutes, chutes_alvo, cartões, faltas (home/away) — 10
  - Splits: gols marcados/sofridos separados casa/fora — 4
  - H2H: avg total goals, btts rate, over 2.5 rate, n games — 4
  - Diferenças: gols, sofridos, escanteios, chutes — 4
- **28 targets** (era 17):
  - Gols FT: over 0.5, 1.5, 2.5, 3.5, 4.5
  - Gols HT: over 0.5, 1.5
  - BTTS FT: sim
  - 1x2 FT: home, draw, away
  - Escanteios FT: over 7.5, 8.5, 9.5, 10.5, 11.5
  - Cartões FT: over 2.5, 3.5, 4.5, 5.5
  - Chutes FT: over 19.5, 21.5, 23.5, 25.5
  - Faltas FT: over 19.5, 21.5, 23.5, 25.5
- **Walk-forward validation**: 3 folds temporal (era holdout 80/20)
- **Backend**: XGBoost (preferred), LightGBM, sklearn fallback

## Arquitetura

```
apps/ml-sidecar/
  src/
    server.py        # FastAPI POST /predict, GET /health, GET /families
    train.py         # CLI: lê DB SQLite, treina modelos, salva em models/
    features.py      # extrator de features v3 (32 features)
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

Saída: `models/{target}.joblib` + `models/manifest.json`.

## Servir

```bash
SCOUT_DB="C:\path\to\scout.db" uvicorn src.server:app --host 127.0.0.1 --port 4055
```

Health: `http://127.0.0.1:4055/health`.

## Bridge JS

`packages/engine-b-bridge` envia POST para `ENGINE_B_URL` (default
`http://127.0.0.1:4055/predict`). Se falhar (timeout/connection refused) ou
sidecar reportar `available:false`, o curinga degrada para A puro.
