# SCOUTCORE_QUANT

> **Motor de predição quantitativo para futebol** — engine A (Poisson) + engine B (XGB/LGBM) com curinga calibrado, evidence pack auditável e settlement econômico (brier + CLV).

---

## Visão de uma linha

Motor de predição **probabilística** com 576 mercados todos abertos (P9 zero-bloqueio), reaproveitando a extração statsline + bookline do FutMax via **dual-write** em SQLite, e construindo calibração própria do zero via **replay histórico** de ~14.998 partidas.

A spec formal está em [`docs/spec/SCOUTCORE_SPEC.md`](docs/spec/SCOUTCORE_SPEC.md).

## Estrutura do monorepo

```
SCOUTCORE_QUANT/
├─ apps/
│  ├─ api/             # HTTP Fastify — /v1/predict, /v1/settle, /v1/markets
│  ├─ ml-sidecar/      # Python sidecar (XGB + LGBM via stdio JSON)
│  └─ jobs/            # Cron: replay-bootstrap, settlement, sync-check
├─ packages/
│  ├─ contracts/       # Tipos compartilhados
│  ├─ markets/         # Catálogo SemVer dos 576 mercados
│  ├─ engine-a/        # Poisson independente
│  ├─ engine-b-bridge/ # Cliente do sidecar Python
│  ├─ curinga/         # Meta-arbiter (brier + EWMA + reversal)
│  ├─ isotonic/        # Calibrador isotônico
│  ├─ data-access/     # Repository pattern sobre scout.db
│  └─ evidence/        # Evidence Pack builder (P8)
├─ data/scout.db       # NÃO commitado
├─ migrations/
├─ scripts/
├─ docs/
│  ├─ spec/SCOUTCORE_SPEC.md
│  └─ runbooks/
└─ .github/workflows/
```

## Branches

- **`main`** — produção. Protegida. Merge via PR.
- **`dev`** — branch de trabalho.

## Setup (boot inicial, one-time)

```bash
# 1. Pré-requisitos
node --version    # >= 22.x
python --version  # >= 3.11

# 2. Instalar deps
npm install

# 3. Variáveis
copy .env.example .env

# 4. Boot
npm run setup:copy-legacy   # copia statsline.db -> data/scout.db (one-time)
npm run setup:wipe-state    # apaga tabelas de motor antigo
npm run setup:migrate       # cria tabelas do motor novo
npm run setup:replay        # replay historico (~10 dias)

# 5. Run
npm run dev:api
```

## Stack

- **Runtime:** Node 22 ESM + Fastify + better-sqlite3
- **ML:** Python sidecar (XGBoost + LightGBM) via JSON-over-stdio
- **DB:** SQLite WAL (motor escreve) + dual-write do FutMax
- **CI:** GitHub Actions

## Status

- [x] SPEC v1.4 (zero-bloqueio + dual-write + replay Opção B)
- [ ] FutMax dual-writer
- [ ] Cópia inicial scout.db
- [ ] Migrations do motor novo
- [ ] Replay histórico
- [ ] API MVP

---

**Princípio:** zero invenção, zero veto, zero extração duplicada, máxima reutilização. Pronto para B2B.
