# MOTOR 4x4 — Technical Specification

| Campo | Valor |
|---|---|
| **Documento** | SPEC formal v1.0 |
| **Status** | Aprovada para implementação |
| **Data** | 07/05/2026 |
| **Autor** | Consultoria de Arquitetura Quantitativa |
| **Escopo** | Motor único de predição esportiva (futebol pré-jogo) servindo qualquer sistema consumidor (FutMaxStats, Apollo32, ApolloFinalV2, B2B futuros) com contrato de saída versionado, auditável e extensível para novos mercados/ligas. |
| **Não-escopo** | Live betting, esportes não-futebol, geração de tip (responsabilidade dos consumidores), captura de odds, scraping. |
| **Substitui** | Todos os documentos exploratórios anteriores (R&D, propostas paralelas, análises técnicas). Esta é a fonte única de verdade. |

---

## Sumário

1. [Visão e Princípios](#1-visão-e-princípios)
2. [Glossário](#2-glossário)
3. [Decisões Arquiteturais (D1–D15)](#3-decisões-arquiteturais)
4. [Contrato de I/O — V1 congelado](#4-contrato-de-io)
5. [Componentes do Sistema](#5-componentes-do-sistema)
6. [Repository Pattern e Point-in-Time](#6-repository-pattern-e-point-in-time)
7. [Curinga — Meta-Arbiter](#7-curinga--meta-arbiter)
8. [Calibração Isotônica (D8)](#8-calibração-isotônica)
9. [SCOUT — resumo determinístico opt-in](#9-scout--resumo-determinístico-opt-in)
10. [Bandas 10min (v1.5 planejado)](#10-bandas-10min-v15-planejado)
11. [Settlement & Self-Evaluation Loop](#11-settlement--self-evaluation-loop)
12. [Stack Tecnológico](#12-stack-tecnológico)
13. [Roadmap por Release](#13-roadmap-por-release)
14. [Riscos e Mitigações](#14-riscos-e-mitigações)
15. [Produtos de Saída Esperados (Consumidores)](#15-produtos-de-saída-esperados-consumidores)
16. [Concorrência e Escalabilidade](#16-concorrência-e-escalabilidade)
17. [Camada de Dados (Read-Only do Legado)](#17-camada-de-dados-read-only-do-legado)
18. [Anexo A — Validação Empírica](#anexo-a--validação-empírica)
19. [Anexo B — Avaliação de Propostas Externas](#anexo-b--avaliação-de-propostas-externas)
20. [Anexo C — Pontos de Validação Humana](#anexo-c--pontos-de-validação-humana)
21. [Anexo D — Inventario do Legado e Gap Analysis](#anexo-d--inventario-do-legado-e-gap-analysis)

---

## 1. Visão e Princípios

**Visão.** O Motor 4x4 é a **infraestrutura analítica** que precifica e audita previsões de futebol. Não é um produto B2C — é o backend que alimenta produtos. O moat não está em qual modelo está rodando, está em **três camadas combinadas**:

1. **Curinga** — meta-arbiter com calibração EWMA por família × liga.
2. **Provenance completo** — cada predição responde "qual engine venceu, por quê, qual a divergência, qual o ewma_hr vigente".
3. **engine_signature reproduzível** — toda predição é replayable; permite construir CLV histórico.

**Princípios não-negociáveis:**

| P# | Princípio | Implicação prática |
|---|---|---|
| P1 | **Modelos são cegos ao mercado.** Engines A e B nunca recebem `market_odd`. | Odds atravessam a fronteira só no Curinga. Mata data leakage no treino. |
| P2 | **Point-in-Time obrigatório.** Toda leitura de feature exige `as_of`. | Backtest sem leakage por contrato, não por convenção. |
| P3 | **Calibração antes de Kelly.** `fair_prob` exposto é sempre pós-isotônica. | `fair_prob=0.80` significa 80% real. |
| P4 | **Provenance não-opcional.** Todo slot retorna o caminho de decisão. | Auditável e explicável. |
| P5 | **Reprodutibilidade por engine_signature.** Hash determinístico do motor + modelos + calibração. | Replay histórico viável para CLV. |
| P6 | **Contrato versionado SemVer.** `contract_version` em todo response. | Consumidores não quebram em upgrade minor. |
| P7 | **Reuso máximo do legado.** Componentes do `opta-extractor` que funcionam não são reescritos, são extraídos. | Zero invenção, baixo risco. |
| P8 | **Toda predição carrega evidências auditáveis.** O slot retorna o `evidence` — lista crua das métricas que justificam a probabilidade (médias for/against, splits casa/fora, H2H, league priors, regime). | Tela do cliente exibe os dados crus que sustentam o pick. Sem caixa-preta. |
| P9 | **Zero bloqueio. Só calibragem.** Nenhum mercado é vetado, suspenso ou descartado pelo motor. Os 576 mercados do catálogo entram todos vivos, com `confidence` e `fair_prob` reportados honestamente. Mercados ruidosos recebem `confidence` reduzido (D13 + D14), nunca filtragem. Suspensão pontual (caso o usuário peça) entra como `options.suppress_markets[]` na request — decisão do consumidor, não do motor. | Apollo, FutMax e qualquer outro consumidor decidem o que apostar. O motor entrega o universo completo, sempre. |

---

## 2. Glossário

| Termo | Definição |
|---|---|
| **Slot** | Uma linha do response correspondente a um par (`market_key`, instância). Ex.: `gols_total_ft_over_25` para a partida X. |
| **market_key** | Identificador canônico do mercado, slug definido pelo pacote `@motor4x4/markets`. |
| **fair_prob_raw** | Probabilidade após Curinga, antes da calibração isotônica. |
| **fair_prob** | Probabilidade pós-calibração — usar esta para Kelly. |
| **fair_odd** | `1 / fair_prob`. |
| **edge_pct** | `(market_odd / fair_odd − 1) × 100`. |
| **ewma_hr** | Hit-rate exponencialmente ponderado por (engine, família, liga). |
| **CLV** | Closing Line Value — `(closing_odd / market_odd_apostada − 1)`. |
| **engine_signature** | Hash determinístico identificando motor + modelos + catálogo + calibração vigentes. |
| **as_of** | Timestamp de corte para leitura de features (PIT). |
| **regime_hint** | Flag de contexto manual no input (ex.: `derby`, `final_temporada`). |
| **certified** | Bandeira booleana — `true` quando todos os gates passaram. |

---

## 3. Decisões Arquiteturais

| # | Decisão | Justificativa |
|---|---|---|
| **D1** | Runtime HTTP Node 22 ESM com Python sidecar FastAPI para Engine B. | Isola ML Python do orquestrador Node. Latência pré-jogo é aceitável quando o sidecar está pré-carregado. |
| **D2** | Persistência: SQLite WAL via `better-sqlite3` + Repository Pattern injetável. | SQLite WAL atende caso pré-jogo (read-heavy). Adapter Postgres futuro sem refatorar engines. |
| **D3** | Catálogo de mercados em pacote SemVer `@motor4x4/markets` + `market_alias_map` opcional na entrada. | Motor é fonte de verdade. Consumidores legados (Apollo) traduzem suas chaves antigas sem fork. |
| **D4** | Contrato versionado SemVer com `engine_signature` em todo response. | Auditável, reproduzível, comparável historicamente. |
| **D5** | SCOUT determinístico é opt-in via `options.scout: boolean` (default `false`). | Evita custo externo e mantém auditoria local; camada LLM fica fora do MVP até existir contrato/provedor configurado. |
| **D6** | Plug-in de modelos via interface `EnginePlugin`. | A, B e qualquer futuro (Engine C Elo) registram-se no orquestrador. |
| **D7** | Feature Store leve em SQLite com `feature_set` versionado. | Feast é overkill para 13 ligas × 6 temporadas. |
| **D8** | Calibração isotônica obrigatória pós-Curinga, treinada por (família × liga) em walk-forward. | EWMA mede direção, não calibra probabilidade. Sem isotônica, Kelly quebra. |
| **D9** | Point-in-Time enforcement incremental no Repository (P2). | Leituras V2 usam `as_of`; fallback legacy gera warning `*_legacy_non_pit` e não certifica o match. `team_stat`/`feature_snapshot` com `valid_from` ainda são pendência. |
| **D10** | Schema CORE vs EXTENSIONS. | CORE: `match`, `team_stat`, `feature_snapshot`, `calib_state`, `motor_run`. EXTENSIONS: `eventos_faixa` (habilita v1.5 — bandas 15min), `clv_history` (habilita v1.6 — feedback econômico). Motor expõe ao `/v1/markets` apenas o que o repo declarar em `capabilities()`. |
| **D11** | **Economic Feedback Loop + Brier Calibration via Replay (Opção B — §17.4).** Motor não herda nada do legado. Replay histórico de ~14.998 partidas roda Engine A + B com nossos modelos atuais para popular `clv_history` retroativo (~10 dias de processamento). A partir daí o settlement em produção calcula `brier`, `log_loss` e `CLV` por slot. Recalibração do Curinga usa `ewma_precision = 1 − ewma_brier`. `BRIER_BOOTSTRAP_MIN_SAMPLES=30` por (família × liga); abaixo disso usa `ewma_hr` como score (UX-only) até atingir o threshold. | Brier separa quem realmente atribuiu probabilidade superior. Combinado com CLV, fecha o ciclo. Replay garante calibração 100% do nosso modelo, sem herança contaminável do motor antigo — é backtest formal disfarçado de bootstrap. |
| **D12** | **Reversal Detection (herdada do legado).** Quando `H2H ou histórico recente ≥ reversal_streak_threshold` (default `5`) jogos no mesmo padrão (ex.: 6/6 Under), aplicar penalty `-1.8pp` no λ da família (cap `-6pp`) e adicionar `reversal_detected` em `provenance.regime_applied[]`. Detecção automatizada no Engine A; Engine B recebe como feature `reversal_streak` no `feature_snapshot`. | Sem isso, Apollo gera picks cegos a sequências longas que estatisticamente quebram (ver lesson aprendida no SP×Cruzeiro 6/6 Under quebrou → SP 2-1). É regra já backtestada e em produção no `stat-engine.cjs`. |
| **D13** | **Market Reliability Multiplier (calibragem, não bloqueio).** `quality-gates.json.market_reliability` define `multiplier ∈ [0.5, 1.0]` por (`market_heading`, `liga`) baseado em ROI walk-forward. Aplicado a `confidence` (não filtra, não descarta). Mercados ruidosos históricos recebem `multiplier < 1.0`; mercados consistentes recebem `1.0`. Exposto em `provenance.market_reliability_multiplier`. **Nenhum mercado é bloqueado.** Consumidor (Apollo, FutMax) decide o que fazer com `confidence` baixa. | Princípio P9: motor calibra, não veta. 576 mercados ficam todos vivos. Demote/promote do legado vira escala contínua, não binária. |
| **D14** | **Confidence Multipliers por mercado (calibragem por classe).** Tabela em `quality-gates.json.confidence_multipliers` reduz `confidence` por classe de mercado: `corners_total: 0.82`, `cards_handicap: 0.76`, `cards_ht_handicap: 0.72`, `shots: 0.78`, `ht_goals: 0.90`, etc. Aplicado pelo Engine A; visível em `provenance.confidence_multiplier`. **Não filtra** — apenas reduz `confidence` reportado. | Refletem ruído intrínseco de cada classe. SPEC sem isso entrega `confidence` inflada em famílias mais ruidosas. |
| **D15** | **Family engine weights são sempre não-zero e dinamizados (sem veto).** Default por família (`gols 0.42/0.58`, `escanteios 0.57/0.43`, etc.) baseado em backtest A vs B. Em v1.6+ os pesos são **redefinidos** dinamicamente por `(1 − ewma_brier_engine)` por (família, liga) após `BRIER_BOOTSTRAP_MIN_SAMPLES=100`. Pesos exclusivos `0.0` ou `1.0` não são permitidos no MVP — todo engine que cobre uma família contribui. Se um engine não cobre (`fair_odd` ausente), Curinga aplica regra `a_only` ou `b_only` no slot específico, mas o peso da família permanece. | Princípio P9: zero veto manual. O legado vetava `chutes.w_b=0.00` sem evidência atualizada — SPEC nova reabre. Brier diferencial pós-MVP pode reduzir peso de um engine para `0.05`, mas nunca zero. |

**Decisões explicitamente rejeitadas (com motivo):**

- ❌ Engines separados por família (`GoalEngine`, `CornerEngine`...) — duplica infra; `family_engine_weights` + `quality-gates.json` já oferecem o efeito sem fragmentar.
- ❌ Meta-learner novo "engine aprende qual engine vence" — já implementado como `ewma_hr` na regra `calibration` do Curinga; evolução natural é stacking (v1.4).
- ❌ Granularidade <10min (ex.: 0-15min) — schema é 10min nativo; exigiria re-extração minute-level no extractor.
- ❌ Kafka/Flink/Feast/Edge Functions — sobre-engenharia para o caso pré-jogo.
- ❌ Transformer para predição tabular — custo alto, ganho marginal.

---

## 4. Contrato de I/O

### 4.1. Endpoints

| Método | Rota | Função |
|---|---|---|
| `POST` | `/v1/predict` | Predição de uma partida. |
| `POST` | `/v1/predict/batch` | Predição em lote (máximo 50 partidas). |
| `GET` | `/v1/markets` | Catálogo canônico vigente (filtra por capabilities do repo). |
| `GET` | `/v1/health` | engine_signature, versões, status dos engines. |
| `GET` | `/v1/calibration/:liga` | Estado de calibração: `ewma_hr` e `clv_score` por família. |
| `GET` | `/v1/replay/:run_id` | Reexecuta uma predição histórica sem persistir e compara assinatura/slots quando o run salvo possui payload completo. |
| `POST` | `/v1/settle/:run_id` | **Liquidação (D11).** Lê resultado real do repo, aceita `closing_odds` opcional, persiste em `clv_history` e atualiza `ewma_hr`/`ewma_brier`. |
| `POST` | `/v1/settle/batch` | Liquidação em lote (cron `settlement_resolver`). |
| `GET`  | `/v1/evaluation/:run_id` | Lê a avaliação já liquidada de um run. |

### 4.2. Request — `POST /v1/predict`

```jsonc
{
  "contract_version": "1.0.0",
  "client": { "system": "futmax", "version": "16.4.0" },

  "match": {
    "external_id": "opta:2877441",
    "home": "Flamengo",
    "away": "Palmeiras",
    "liga": "brasileirao-a",
    "date": "2026-05-12",
    "hora": "20:00"
  },

  "match_context": {                          // OPCIONAL — contexto operacional + D11/regime hints
    "regime_hints": ["derby", "final_temporada"],
    "weather": "rain_heavy",
    "referee": "Wilton Pereira Sampaio",
    "stadium": "Maracanã",
    "venue_city": "Rio de Janeiro",
    "home_city": "Rio de Janeiro",
    "away_city": "São Paulo",
    "rodada": 36,
    "season": "2026"
  },

  "odds_snapshot": {                          // opcional
    "gols_total_ft_over_25": 1.85,
    "btts_sim": 1.72
  },

  "market_alias_map": {                       // opcional
    "over_2_5_goals_ft": "gols_total_ft_over_25"
  },

  "options": {
    "scout":           false,                 // ativa resumo scout determinístico
    "include_engines": ["A", "B"],
    "min_edge_pp":     2,
    "feature_set":     "v3"
  }
}
```

**regras de validação (Zod / Pydantic):**

- `match.liga` precisa estar em `markets_catalog.supported_leagues`.
- `match.date` no passado → 400 (use `/v1/replay`).
- `odds_snapshot[k]` deve estar em `[1.01, 1000]`.
- `match_context` aceita `referee`, `stadium`/`venue`, `venue_city`, `home_city`, `away_city`, `rodada`/`round`, `season`/`temporada` e `weather`; esses campos alimentam a camada SCOUT/Sonar quando `options.scout=true`.
- `regime_hints[]` valores válidos: `derby`, `classic`, `final_temporada`, `relegation_battle`, `cup_decider`, `friendly`, `weather_rain`, `weather_extreme`. Outros viram warning e são ignorados.

### 4.3. Response

```jsonc
{
  "contract_version": "1.0.0",

  "engine_signature": {
    "motor_version":            "4.0.1",
    "model_a_version":          "poisson-dc-ewma-2.3",
    "model_b_version":          "xgb-lgbm-ft-ht-1.7",
    "isotonic_version":         "iso-2026-05-10",
    "calib_snapshot_id":        "calib-2026-05-10",
    "markets_catalog_version":  "1.4.0",
    "hash":                     "sha256:9f2e..."
  },

  "match": { /* echo do request */ },

  "certified": true,
  "warnings":  [],

  "slots": [
    {
      "market_key":     "gols_total_ft_over_25",
      "family":         "gols",
      "scope":          "total",
      "period":         "FT",
      "direction":      "over",
      "label":          null,
      "line":           2.5,

      "fair_prob_raw":  0.624,
      "fair_prob":      0.612,
      "fair_odd":       1.634,
      "market_odd":     1.85,
      "edge_pct":       13.22,
      "confidence":     0.78,

      "provenance": {
        "fair_odd_a":              1.640,
        "fair_odd_b":              1.628,
        "divergence":              0.012,
        "divergence_resolved_by":  "consensus",
        "weight_a":                0.46,
        "weight_b":                0.54,
        "ewma_hr_a":               0.61,    // métrica de UX — não afeta decisão
        "ewma_hr_b":               0.65,
        "ewma_brier_a":            0.182,   // D11 — métrica de DECISÃO do Curinga
        "ewma_brier_b":            0.156,
        "ewma_precision_a":        0.818,   // 1 − ewma_brier_a
        "ewma_precision_b":        0.844,
        "clv_score_a":             0.012,    // média móvel CLV últimos 90d
        "clv_score_b":             0.018,
        "quality_gate_multiplier":     1.0,
        "confidence_multiplier":       0.82,  // D14 — corners_total
        "market_reliability_multiplier": 1.0, // D13 — 1.0 = neutro
        "isotonic_applied":            true,
        "feature_set":                 "v3",
        "regime_applied":              ["derby", "reversal_detected:5"]  // D12
      },

      "evidence": {                        // P8 — dados crus que sustentam a predição
        "feature_set": "v3",
        "as_of":       "2026-05-11T20:00:00Z",

        "team_home": {
          "name":         "Flamengo",
          "sample_size": 10,
          "metrics_for":     { "gols": 1.80, "chutes": 12.3, "chutes_alvo": 4.2,
                                "escanteios": 5.1, "cartoes_amar": 1.7,
                                "btts_rate": 0.60, "over_25_rate": 0.50 },
          "metrics_against": { "gols": 1.20, "chutes":  9.8, "chutes_alvo": 3.4,
                                "escanteios": 4.6, "cartoes_amar": 1.9 },
          "home_split":      { "sample_size": 5, "gols_for": 2.10, "gols_against": 0.80,
                                "over_25_rate": 0.60 }
        },
        "team_away": {
          "name":         "Palmeiras",
          "sample_size": 10,
          "metrics_for":     { "gols": 1.40, "chutes": 10.8, "chutes_alvo": 3.9,
                                "escanteios": 4.7, "cartoes_amar": 2.1,
                                "btts_rate": 0.50, "over_25_rate": 0.40 },
          "metrics_against": { "gols": 0.90, "chutes":  9.1, "chutes_alvo": 3.0,
                                "escanteios": 4.2, "cartoes_amar": 2.0 },
          "away_split":      { "sample_size": 5, "gols_for": 1.20, "gols_against": 1.10,
                                "over_25_rate": 0.40 }
        },

        "h2h": { "n": 6, "btts_rate": 0.50, "over_25_rate": 0.33,
                 "avg_total_goals": 2.00, "home_wins": 2, "draws": 2, "away_wins": 2 },

        "league_priors": { "liga": "brasileirao-a", "season": "2026",
                           "btts_rate": 0.52, "over_25_rate": 0.48,
                           "avg_goals_total": 2.45 },

        "regime_applied": ["derby"],

        "drivers": [                       // top-K métricas que mais empurraram a probabilidade
          { "metric": "home.metrics_for.chutes",     "value": 12.3, "league_avg": 10.5,
            "z_score": 1.40, "contribution": "+0.04 prob" },
          { "metric": "away.metrics_against.gols",   "value":  0.90, "league_avg":  1.25,
            "z_score": -0.85, "contribution": "-0.02 prob" },
          { "metric": "h2h.over_25_rate",            "value":  0.33, "n": 6,
            "contribution": "-0.01 prob" },
          { "metric": "home.home_split.gols_for",    "value":  2.10, "league_avg":  1.40,
            "z_score": 1.10, "contribution": "+0.03 prob" }
        ]
      },

      "certified": true
    }
  ],

  "ev_ranked": ["gols_total_ft_over_25", "btts_sim", "..."],

  "scout":     null,

  "diagnostics": {
    "latency_ms":   412,
    "engines_used": ["A", "B"],
    "engine_a_ms":  38,
    "engine_b_ms":  287,
    "curinga_ms":   4,
    "isotonic_ms":  2,
    "scout_ms":     null,
    "errors":       { "engine_a": null, "engine_b": null }
  }
}
```

### 4.4. Garantias contratuais

| Garantia | Como é cumprida |
|---|---|
| **Backwards compatibility minor.** | v1.X só adiciona campos opcionais; nunca remove ou muda tipo. |
| **Replay determinístico.** | Runs novos persistem response completo; `/v1/replay/:run_id` reexecuta sem persistir e retorna `deterministic=true/false` quando assinatura e payload são comparáveis. |
| **Auditabilidade total.** | `motor_run` persiste request + response + engine_signature; `prediction` persiste slots por `run_id`. |
| **Sem leakage temporal.** | `as_of` é derivado de `match.date`; o repo consulta perfis/priores com `as_of <= match.date`. Replay histórico ainda depende da qualidade dos snapshots existentes. |

---

## 5. Componentes do Sistema

```
┌─────────────────────────────────────────────────────────────────────┐
│  CONSUMIDORES                                                       │
│  FutMaxStats │ Apollo32 │ ApolloFinalV2 │ B2B futuros               │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTP/JSON
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  MOTOR 4x4 — Edge Service (Node 22 ESM, Fastify 5)                  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  API Layer (fastify + zod)                                    │  │
│  │  validação · alias map · injeção de engine_signature          │  │
│  └─────────────────────────────┬─────────────────────────────────┘  │
│                                ▼                                    │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Orchestrator (motor.js)  —  Promise.allSettled([A, B])       │  │
│  │     ┌─────────────┐         ┌─────────────┐                   │  │
│  │     │  Engine A   │         │  Engine B   │                   │  │
│  │     │  Poisson DC │ ‖       │  ML Bridge  │                   │  │
│  │     │  EWMA + QG  │         │  XGB + LGBM │                   │  │
│  │     └──────┬──────┘         └──────┬──────┘                   │  │
│  │            └────────┬───────────────┘                         │  │
│  │                     ▼                                         │  │
│  │           CURINGA Meta-Arbiter (4 regras + gates)             │  │
│  │                     │                                         │  │
│  │                     ▼                                         │  │
│  │           Isotonic Calibration (D8)                           │  │
│  │                     │                                         │  │
│  │                     ▼                                         │  │
│  │           SCOUT determinístico (opt-in)                       │  │
│  └─────────────────────┬─────────────────────────────────────────┘  │
│                        ▼                                            │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Repository Pattern — MatchRepository (interface injetável)   │  │
│  │  CORE: match · team_stat · feature_snapshot · calib_state     │  │
│  │  CORE: motor_run                                              │  │
│  │  EXT (v1.5): eventos_faixa  (bandas 10min)                    │  │
│  │  EXT (v1.6): clv_history    (feedback econômico)              │  │
│  │  Default: SQLite WAL · Adapter Postgres opcional              │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ subprocess (spawn)
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  ML Sidecar — Python 3.11                                           │
│  XGBoost (CUDA) · LightGBM · Optuna · TimeSeriesSplit · stdio JSON  │
└─────────────────────────────────────────────────────────────────────┘
```

**Jobs assíncronos (out-of-band, fora do request):**

| Job | Trigger | Função | Versão |
|---|---|---|---|
| `walk_forward_calibration` | cron diário 03:00 BRT | Recalcula `ewma_hr` por (engine, família, liga). | v1.0 |
| `isotonic_retrain` | cron semanal | Re-treina isotônica por (família × liga) com fold walk-forward. | v1.0 |
| `settlement_resolver` | cron 05:00 BRT (após jogos) | Pega resultado + closing line, calcula CLV, persiste em `clv_history`. | **v1.6** |
| `clv_weighted_recalib` | cron diário 04:00 BRT | Recalcula `clv_score` por (engine, família, liga) usando últimos 90d de CLV. | **v1.6** |

---

## 6. Repository Pattern e Point-in-Time

### 6.1. Interface

```typescript
interface MatchRepository {
  capabilities(): RepoCapabilities;       // declara extensions disponíveis

  getMatch(externalId: string, asOf: Date): Match;
  getTeamStats(team: string, liga: string, asOf: Date, n: number): TeamStat[];
  getFeatureSnapshot(matchId: string, featureSet: string, asOf: Date): FeatureSnapshot | null;
  getCalibState(family: Family, liga: string, asOf: Date): CalibState;

  // EXTENSIONS (retornam null se capabilities não declarar)
  getEventBands?(matchId: string, asOf: Date): EventBand[] | null;            // v1.5
  getClvHistory?(engine: 'A'|'B', family: Family, liga: string, days: number): ClvSample[] | null; // v1.6

  saveMotorRun(run: MotorRun): void;
}
```

### 6.2. Schema CORE

```sql
-- match
CREATE TABLE match (
  id              TEXT PRIMARY KEY,         -- external_id namespaced (opta:..., book:...)
  liga            TEXT NOT NULL,
  home            TEXT NOT NULL,
  away            TEXT NOT NULL,
  date            TEXT NOT NULL,
  hora            TEXT,
  external_ids    TEXT NOT NULL             -- JSON: { statsline, bookline, ... }
);

-- team_stat (PIT)
CREATE TABLE team_stat (
  team         TEXT NOT NULL,
  liga         TEXT NOT NULL,
  match_date   TEXT NOT NULL,
  stat_payload TEXT NOT NULL,               -- JSON
  valid_from   TEXT NOT NULL,               -- D9 — PIT
  PRIMARY KEY (team, liga, match_date)
);

-- feature_snapshot (PIT)
CREATE TABLE feature_snapshot (
  match_id     TEXT NOT NULL,
  feature_set  TEXT NOT NULL,
  payload      TEXT NOT NULL,               -- JSON
  generated_at TEXT NOT NULL,
  valid_from   TEXT NOT NULL,               -- D9
  PRIMARY KEY (match_id, feature_set)
);

-- calib_state
CREATE TABLE calib_state (
  engine             TEXT NOT NULL,         -- 'A' | 'B'
  family             TEXT NOT NULL,
  liga               TEXT NOT NULL,
  ewma_hr            REAL NOT NULL,         -- métrica de UX (não afeta decisão a partir de v1.5)
  ewma_brier         REAL,                  -- D11 — métrica de DECISÃO do Curinga (v1.5+)
  clv_score          REAL,                  -- D11 — populado em v1.6
  isotonic_blob      BLOB,                  -- D8 — modelo serializado
  isotonic_version   TEXT,
  sample_size        INTEGER NOT NULL,
  updated_at         TEXT NOT NULL,
  PRIMARY KEY (engine, family, liga)
);

-- motor_run (auditoria/replay)
CREATE TABLE motor_run (
  run_id            TEXT PRIMARY KEY,
  match_id          TEXT NOT NULL,
  engine_signature  TEXT NOT NULL,           -- JSON
  request_payload   TEXT NOT NULL,
  response_payload  TEXT NOT NULL,
  created_at        TEXT NOT NULL
);
```

### 6.3. Schema EXTENSIONS

```sql
-- v1.5: bandas 10min (já existe no opta-extractor com 223k linhas)
CREATE TABLE eventos_faixa (
  id                INTEGER PRIMARY KEY,
  liga              TEXT NOT NULL,
  id_confronto      TEXT NOT NULL,
  temporada         TEXT,
  time              TEXT NOT NULL,
  faixa             TEXT NOT NULL,           -- '0-10','11-20',...,'80-90'
  escanteios        INTEGER DEFAULT 0,
  chutes            INTEGER DEFAULT 0,
  chutes_no_alvo    INTEGER DEFAULT 0,
  faltas            INTEGER DEFAULT 0,
  cartoes_amarelos  INTEGER DEFAULT 0,
  cartoes_vermelhos INTEGER DEFAULT 0,
  gols              INTEGER DEFAULT 0,
  impedimentos      INTEGER DEFAULT 0,
  criado_em         TEXT DEFAULT (datetime('now'))
);

-- v1.6: histórico de CLV
CREATE TABLE clv_history (
  run_id            TEXT NOT NULL,
  match_id          TEXT NOT NULL,
  market_key        TEXT NOT NULL,
  engine_winner     TEXT NOT NULL,           -- 'A' | 'B' | 'consensus'
  family            TEXT NOT NULL,
  liga              TEXT NOT NULL,
  fair_odd          REAL NOT NULL,
  market_odd_open   REAL NOT NULL,
  market_odd_close  REAL NOT NULL,
  result_hit        INTEGER NOT NULL,        -- 0 | 1
  clv               REAL NOT NULL,           -- (close/open - 1)
  settled_at        TEXT NOT NULL,
  PRIMARY KEY (run_id, market_key)
);
```

### 6.4. PIT enforcement incremental (D9)

**Estado real do MVP.** O repository aplica corte `as_of` em `team_profile_v2` e `league_priors`; quando cai no fallback `team_profiles` legacy, emite warning `*_legacy_non_pit` e o match não fica certificado. Ainda não existe `feature_snapshot.valid_from` populado nem `PitViolationError` hard-fail no runtime.

**Pendência para certificação financeira.** Ativar `feature_snapshot_cache`/`team_stat` com `valid_from <= as_of`, adicionar teste de regressão em CI para backtest histórico vs produção dentro de tolerância `1e-6`, e só então trocar o modo incremental por enforcement estrito.

---

## 7. Curinga — Meta-Arbiter

### 7.1. Regras (promovidas do legado `curinga.js`)

| Regra | Condição | Resolução |
|---|---|---|
| `a_only` | `fair_odd_b == null` | usa A com `confidence × A_ONLY_CONFIDENCE_FACTOR` (`0.85`) |
| `consensus` | `\|fair_odd_a − fair_odd_b\| < 0.10` | média ponderada por `family_engine_weights × score(engine)` |
| `calibration` | `0.10 ≤ \|Δ\| < 0.30` | escolhe engine com maior `family_engine_weights × score(engine)` |
| `flagged` | `\|Δ\| ≥ 0.30` | conservador (`min(fair_odd_a, fair_odd_b)`) e `certified=false` |

**`score(engine)` evolui por release:**
- **v1.0** (bootstrap, sem amostra de brier): `score = ewma_hr` — usado apenas até `clv_history` ter ≥ 100 jogos liquidados por (engine, família, liga).
- **v1.5+** (já há histórico de brier): `score = ewma_precision = 1 − ewma_brier`. **Hit-rate sai da decisão** porque empata divergências entre modelos calibrado-confiante e calibrado-conservador.
- **v1.6+** (CLV ativo): `score = α × ewma_precision + (1 − α) × normalize(clv_score)` com `α = 0.4` (CLV pesa 60%).

`ewma_hr` continua sendo persistido e exposto em `/v1/calibration/:liga` como métrica de UX legível ao usuário final, mas **não** entra no cálculo de `score(engine)` a partir de v1.5.

### 7.2. Sanity gates (após resolução)

| Gate | Condição | Ação |
|---|---|---|
| min_fair_odd | `fair_odd_curinga < 1.10` | descarta slot, warning `fair_odd_abaixo_minimo` |
| min_edge | `edge_pct < EDGE_MIN_PP` (default `2pp`) | descarta slot, warning `edge_insuficiente` |
| max_edge | `edge_pct > 60` | mantém slot, força `certified=false`, warning `edge_suspeito` |

### 7.3. Configuração

`config/product-contract.json` (versionado, entra no `engine_signature.hash`):

```jsonc
{
  "EDGE_MIN_PP":                  2,
  "EV_MIN_PCT":                   3.0,
  "A_ONLY_CONFIDENCE_FACTOR":     0.85,
  "DIVERGENCE_LOW":               0.10,
  "DIVERGENCE_HIGH":              0.30,
  "MAX_EDGE_PP":                  60,
  "MIN_FAIR_ODD":                 1.10,
  "PHANTOM_EDGE_THRESHOLD_PP":    15,         // edge > 15pp dispara warning, não descarta
  "SAMPLE_MIN":                   5,          // amostra mínima para stats confiáveis
  "ALPHA_PRECISION_VS_CLV":       0.4,
  "BRIER_BOOTSTRAP_MIN_SAMPLES":  30,         // reduzido de 100 — base legado tem 6318 predições liquidadas com prob_a+prob_b+result
  "EWMA_ALPHA":                   0.10,
  "REVERSAL_STREAK_THRESHOLD":    5,          // D12
  "REVERSAL_LAMBDA_PENALTY_PP":   1.8,        // D12 — cap em 6pp
  "REVERSAL_LAMBDA_PENALTY_CAP":  6.0,

  "family_engine_weights": {                  // D15 — P9 zero-veto, todos > 0
    "gols":        { "w_a": 0.42, "w_b": 0.58 },
    "btts":        { "w_a": 0.50, "w_b": 0.50 },
    "escanteios":  { "w_a": 0.57, "w_b": 0.43 },
    "cartoes":     { "w_a": 0.56, "w_b": 0.44 },
    "faltas":      { "w_a": 0.47, "w_b": 0.53 },
    "chutes":      { "w_a": 0.50, "w_b": 0.50 }   // motor novo: B reaberto, sem evidência para veto
  },

  "confidence_multipliers": {                 // D14 — herdado do legado
    "corners_total":     0.82,
    "corners_team":      0.80,
    "corners_handicap":  0.82,
    "corners_ht":        0.80,
    "cards_audited":     0.88,
    "cards_handicap":    0.76,
    "cards_ht_handicap": 0.72,
    "sot":               0.82,
    "shots":             0.78,
    "fouls_audited":     0.88,
    "ht_goals":          0.90,
    "goals_handicap":    0.72,
    "ht_handicap":       0.87
  },

  "market_reliability": {                     // D13 — calibragem contínua, não filtra
    // Exemplos baseados em ROI walk-forward do legado, agora como multiplicador [0.5, 1.0]
    "1º Tempo - Total de Gols":          { "multiplier": 0.78 },  // ROI histórico fraco
    "Total de Gols da Equipe":           { "multiplier": 0.82 },
    "1º Tempo - Total de Gols Equipe":   { "multiplier": 0.72 },
    "1º Tempo - Handicap":               { "multiplier": 0.68 },
    "Cartões - Handicap":                { "multiplier": 0.75 }
    // mercados ausentes da tabela = multiplier 1.0 (neutro)
  },

  "poisson": {                                // D14 / Engine A internals
    "half_life_games":  8,
    "lambda_home_clamp":[0.3, 4.0],
    "lambda_away_clamp":[0.2, 3.5],
    "grid_size":        8,
    "ht_share":         0.45                  // λ_HT = λ_FT × 0.45
  },

  "season_blend": {                           // SPEC: peso temporada atual domina
    "current_base_weight":  0.70,
    "previous_max_weight":  0.30
  }
}
```

---

## 8. Calibração Isotônica

**Por quê é obrigatória.** EWMA-hit-rate mede acerto direcional, não calibra probabilidade. Sem isotônica, `fair_prob = 0.80` ≠ 80% real → Kelly explode.

**Como funciona.**

1. Para cada par (família × liga), coleta-se walk-forward histórico de `(fair_prob_raw, hit_real)`.
2. Treina-se `IsotonicRegression` (`out_of_bounds='clip'`).
3. Modelo serializado em `calib_state.isotonic_blob` com `isotonic_version`.
4. Em inferência: `fair_prob = isotonic.transform(fair_prob_raw)`.

**Fallback transparente.** Famílias com amostra `< 200` jogos calibrados → `isotonic_applied: false`, `fair_prob = fair_prob_raw`. Aparece em `provenance` para o consumidor saber.

**Job de retreino.** Semanal. Roll-out canário: novo `isotonic_version` testado em 10% do tráfego por 24h, comparando Brier score com versão atual; promove se reduzir Brier > 1%.

---

## 9. SCOUT — resumo determinístico opt-in

**Ativação.** `options.scout: true` (default `false`). Não mistura com query string.

**Estado real do MVP.** O pacote `@scoutcore/scout` gera um resumo determinístico sobre `ev_ranked`, `warnings`, phantom edges, caps de família e baixa confiança. Não chama GPT-4o, Perplexity ou Claude; não possui `tokens_used`; não aplica `confidence_delta`; não altera probabilidades.

**Formato atual:**

```jsonc
{
  "version": "0.1.0",
  "summary": "Top pick: gols_total_ft_over_1_5 @ 1.35...",
  "notes": [
    "phantom_edge_detected: revisar odds e lambda"
  ],
  "top_picks": [
    {
      "market_key": "gols_total_ft_over_1_5",
      "family": "gols",
      "fair_prob": 0.8318,
      "market_odd": 1.35,
      "edge_pct": 12.3,
      "confidence": 0.6675
    }
  ]
}
```

**Futuro possível.** Uma camada LLM pode ser adicionada depois como `scout_overlay`, mas só deve entrar quando houver provedor, budget, timeout, auditoria de tokens e contrato explícito de que ela não substitui o modelo quantitativo.

---

## 10. Bandas 10min (v1.5 planejado)

**Estado real do MVP.** A base possui `eventos_faixa` e o repository consegue ler faixas, mas o catálogo vivo ainda não expõe mercados `b{a}_{b}` e o settlement atual não liquida por minutagem granular. A tabela abaixo é desenho-alvo, não funcionalidade certificada do MVP.

### 10.1. Mercados canônicos suportados

Para cada estatística com banda (escanteios, cartões amarelos, chutes), expostos os 4 mercados:

| Mercado | Convenção `market_key` | Cálculo |
|---|---|---|
| Total Over 0.5 | `{stat}_total_b{a}_{b}_over_05` | `P(home + away ≥ 1)` na banda |
| Total Under 1.5 | `{stat}_total_b{a}_{b}_under_15` | `P(home + away ≤ 1)` na banda |
| Equipe Over 0.5 | `{stat}_{team}_b{a}_{b}_over_05` | `P(team ≥ 1)` na banda |
| Equipe Under 0.5 | `{stat}_{team}_b{a}_{b}_under_05` | `P(team = 0)` na banda |

Bandas: `{0_10, 11_20, 21_30, 31_40, 41_50, 51_60, 61_70, 71_80, 81_90}`.

### 10.2. Implementação no Engine A

Poisson independente por banda: `λ_banda = mean(banda) com EWMA decay`. Não tenta-se modelar dependência temporal entre bandas; esta é uma simplificação consciente que mantém o Poisson rastreável.

### 10.3. Implementação no Engine B

Features novas em `feature_snapshot` (`feature_set: "v3-bands"`):
- Para cada (time, banda, stat): `mean_last_10`, `mean_last_20`, `share_of_full_match`.
- Para cada (liga, banda, stat): `league_mean`, `league_std` (priors).

### 10.4. Granularidade rejeitada

`<10min` (ex.: 0-15min) **não é suportado**. Schema é nativo 10min; expor 0-15min exigiria re-extração minute-level no extractor (fora do escopo).

---

## 11. Settlement & Self-Evaluation Loop

O motor não é só preditor — é **avaliador de si mesmo**. Toda predição que sai do `/v1/predict` vira uma linha em `motor_run`. Após o jogo acontecer e a base interna do consumidor (FutMax, opta.db, etc.) ser atualizada, o consumidor chama `/v1/settle/:run_id` (ou o cron `settlement_resolver` varre `motor_run` sem `settled_at`). O motor então:

1. Lê a predição original via `engine_signature` (replay garantido).
2. Recebe o resultado real + closing odds.
3. Calcula, **por slot**: hit/miss, Brier score, log-loss, CLV.
4. Classifica em 5 níveis (excellent → very_bad).
5. Persiste em `clv_history`.
6. Atualiza `calib_state.ewma_hr` e `calib_state.clv_score` por (engine, família, liga).

### 11.1. Fluxo de ponta a ponta

```
  D-1   FutMax/Apollo → POST /v1/predict          → motor_run salvo (run_id, engine_signature)
  D-0   T-5min → job:snapshot-closing              → audit/closing-*.json com odds frescas de `odds`
  D-0   jogo acontece
  D+1   FutMax atualiza opta.db (extração)
  D+1   cron 05:00 BRT → settlement_resolver:
          ├─ varre motor_run sem settled_at, > 12h após match.date
          ├─ POST /v1/settle/:run_id  (interno) com closing_odds quando disponível
          ├─ motor avalia cada slot, persiste clv_history
          └─ calib_state recalibra (ewma_hr e clv_score)
  D+1   cron 04:00 BRT (dia seguinte) → clv_weighted_recalib
          ├─ recalcula clv_score por (engine, família, liga) com janela 90d
          └─ score do Curinga em v1.6+ passa a ser α·ewma + (1-α)·clv_score
```

### 11.2. Request — `POST /v1/settle/:run_id`

```jsonc
{
  "contract_version": "1.0.0",
  "closing_odds": {
    "gols_total_ft_over_2_5": 1.78,
    "btts_total_ft_sim":      1.70
  }
}
```

### 11.3. Response — avaliação por slot

```jsonc
{
  "run_id":            "r_2026-05-12_flapal_a4f2",
  "engine_signature":  { /* idêntico ao do predict original */ },

  "evaluation": {
    "summary": {
      "n_slots":             18,
      "n_certified":         12,
      "hit_rate":            0.667,        // 12/18
      "hit_rate_certified":  0.750,
      "avg_brier":           0.182,
      "avg_log_loss":        0.512,
      "avg_clv":             0.014,
      "verdict_distribution": {
        "excellent":  4, "good": 7, "acceptable": 5, "bad": 2, "very_bad": 0
      }
    },

    "slots": [
      {
        "market_key":     "gols_total_ft_over_25",
        "fair_prob":      0.612,
        "market_odd":     1.85,
        "closing_odd":    1.78,
        "result_hit":     1,                // jogo acabou 2-1 (3 gols ≥ 2.5)
        "brier_score":    0.151,            // (0.612 - 1)^2
        "log_loss":       0.491,            // -ln(0.612)
        "clv":            0.039,            // (1.85/1.78 - 1) — apostou em odd melhor que a fechada
        "verdict":        "good",
        "verdict_reason": "fair_prob 0.612 e jogo bateu Over; brier 0.151 (boa); CLV +3.9%"
      },
      {
        "market_key":     "btts_sim",
        "fair_prob":      0.58,
        "result_hit":     1,
        "brier_score":    0.176,
        "verdict":        "acceptable"
      }
    ]
  },

  "calibration_updates": [
    { "engine":"A", "family":"gols", "liga":"brasileirao-a",
      "ewma_brier_before": 0.182, "ewma_brier_after": 0.179,    // métrica de decisão
      "ewma_hr_before":    0.610, "ewma_hr_after":    0.621,    // métrica de UX
      "clv_score_before":  0.012, "clv_score_after":  0.015,

  "settled_at": "2026-05-13T05:00:14Z"
}
```

### 11.4. Função de veredicto (regra fixa, versionada no `engine_signature`)

Para cada slot, `brier = (fair_prob − hit)²` (sempre em [0,1], 0 = perfeito):

| `brier` | `verdict` | Interpretação |
|---|---|---|
| ≤ 0.05 | `excellent` | acertou com altíssima confiança (ou negou com altíssima confiança) |
| 0.05–0.15 | `good` | predição confiante e correta, ou neutra com leve viés correto |
| 0.15–0.25 | `acceptable` | predição morna, jogo poderia ter ido para qualquer lado |
| 0.25–0.40 | `bad` | predição com viés errado |
| > 0.40 | `very_bad` | errou com confiança — exige investigação |

Faixas configuráveis em `config/product-contract.json` chave `verdict_buckets`. **Sample size mínimo** para que o slot conte na recalibração: `sample_size_for_engine_family_liga ≥ 30`. Abaixo disso, o slot é avaliado mas **não** atualiza `ewma_hr` (evita ruído em ligas/famílias rasas).

### 11.5. Atualização de `ewma_brier`, `ewma_hr` e `clv_score`

```
α_ewma = 0.10                            // peso do novo sample
hit    = result_hit                      // 0 ou 1
brier  = (fair_prob - hit)^2             // [0,1] — 0 = perfeito
clv    = (market_odd / closing_odd) - 1

new_ewma_brier = (1 - α_ewma) × old_ewma_brier + α_ewma × brier   // ← métrica de decisão
new_ewma_hr    = (1 - α_ewma) × old_ewma_hr    + α_ewma × hit     // ← métrica de UX
new_clv_score  = (1 - α_ewma) × old_clv_score  + α_ewma × clv     // ← peso econômico
```

`ewma_precision = 1 − ewma_brier` é derivado em tempo de leitura (não persistido).

A atualização é por **engine vencedor** do slot (`provenance.divergence_resolved_by`):
- `consensus` → atualiza A e B (ambos contribuíram).
- `calibration` → atualiza só o engine que ganhou.
- `a_only` → atualiza só A.
- `flagged` → **não** atualiza (slot foi conservador, não é sinal puro de nenhum engine).

### 11.6. Garantias do loop

| Garantia | Como |
|---|---|
| Idempotência | `clv_history.run_id + market_key` possui índice único para novos settlements. Re-settle do mesmo run não duplica linha útil. |
| Auditoria | `motor_run` persiste request e response; runs novos têm payload completo para comparação via `/v1/replay/:run_id`. |
| Replay determinístico | Quando `engine_signature.hash` bate e o payload salvo tem slots, `/v1/replay/:run_id` retorna `deterministic=true/false`. |
| Closing line | `job:snapshot-closing` gera JSON a partir da tabela `odds` e impõe frescor padrão de 15min. Se `closing_odds` for omitido, `odd_close` e `clv_pct` ficam nulos; hit/miss e EWMA continuam. |
| Não corrompe stats | O settler lê resultados de `partidas`/`eventos_faixa`; ausência de dados retorna `no_data` sem efeito colateral no slot. |

### 11.7. O que o consumidor ganha

- **Painel "como o motor está performando":** consulta `/v1/calibration/:liga` e mostra `ewma_hr` + `clv_score` por família.
- **Auditoria pós-jogo:** consulta `/v1/evaluation/:run_id` e exibe ao usuário final "esse pick foi `good`, brier 0.15".
- **Fechamento do ciclo:** o motor que prevê é o mesmo que se avalia — o moat é justamente o histórico CLV acumulado.

---

## 12. Stack Tecnológico

| Camada | Tecnologia | Justificativa |
|---|---|---|
| Runtime API | Node.js 22 LTS, ESM | Já é o que `motor.js` usa. |
| HTTP framework | Fastify 5 + `@fastify/zod` | Validação automática do contrato. |
| Persistência | SQLite WAL via `better-sqlite3` | Já em produção. P99 < 1 ms em reads. |
| Abstração | Repository Pattern (`MatchRepository`) | Adapter Postgres futuro sem refatorar engines. |
| Motor estatístico | `stat-engine.cjs` + `model-a.js` | Reaproveitamento direto do legado. |
| ML | Python 3.11 + XGBoost + LightGBM + Optuna | Já em produção em `ml/ml_predictor.py`. |
| Bridge Node↔Python | HTTP para sidecar FastAPI local + timeout/fallback | Bridge nunca lança; degrada para Engine A quando B está indisponível. |
| Catálogo | Pacote pnpm `@motor4x4/markets` | Promove `core/markets.cjs` para SemVer. |
| Validação contrato | Zod (Node) + Pydantic (Python) do mesmo JSON Schema | Consistência ponta a ponta. |
| Observabilidade | Pino (logs) + OpenTelemetry traces | Padrão Node moderno. |
| Testes | Jest ESM + walk-forward backtest harness | Já existem no legado. |
| Scout (opt-in) | Resumo determinístico local | Já implementado; LLM scout não faz parte do MVP atual. |
| Containerização | Docker multi-stage (`node:22-alpine` + `python:3.11-slim`) | Padrão atual. |

---

## 13. Roadmap por Release

| Marco | Entregas | Critério de aceite |
|---|---|---|
| **MVP (4 semanas)** | Fases 1–3: contratos, repository PIT, HTTP. Motor servindo `/v1/predict` para FutMax com paridade ao legado. **Evidence pack (P8) já no MVP** — sem ele, tela do cliente fica vazia. | A/B test 7d: `\|Δfair_odd\|` médio < 1%; 100% dos slots `certified=true` retornam `evidence` não-vazio. |
| **v1.0** | Migração Apollo32 + ApolloFinalV2. Pacote `@motor4x4/markets` interno. Isotônica D8 ativa. **Endpoint `/v1/settle` ativo** — começa a coletar `clv_history`. | 3 consumidores em prod, zero incidentes; `clv_history` com ≥ 500 linhas. |
| **v1.1** | Adapter Postgres opcional. `/v1/calibration/:liga` exposto. | 1 consumidor em Postgres. |
| **v1.2** | Batch endpoint via gRPC local (não `spawn`). | P95 batch-50 < 5 s. |
| **v1.3** | Endpoint `/v1/replay/:run_id` implementado para runs com payload completo. Job CI de regressão PIT bit-a-bit ainda pendente. | Runs novos retornam `signature_match`, `comparable` e `deterministic`; CI futuro deve exigir tolerância 1e-6. |
| **v1.4** | Stacking Meta-Learner opcional. Gate: `≥800 jogos efetivos por (família × liga) após walk-forward holdout` AND `Brier melhor que regras em 30d de produção real` AND par está nas 6 ligas principais. | Stacking ativo em ≥3 famílias×liga sem regressão de CLV. |
| **v1.5** | **Bandas 10min** — 4 mercados canônicos × 9 bandas × 3 estatísticas. λ por banda no Engine A. Features de banda no Engine B. Catálogo bumpado para 1.5.0. | Backtest pré-prod: hit-rate Total Under 1.5 escanteios 0-10 ≥ 65% nas 6 ligas principais. |
| **v1.6** | **Economic Feedback Loop (D11)** — `settlement_resolver` + `clv_history` + `clv_weighted_recalib` + score do Curinga muda para `α·ewma + (1-α)·clv_score`. | CLV médio dos slots `certified=true` ≥ 0 em 30 dias de produção. |
| **v2.0** | Engine C plugável (Elo dinâmico). Feature Lineage (SHAP no Engine B + decomposição de λ no A). Regime Detector automático. Relatório CLV histórico por liga. | Backtest 6 temporadas mostra CLV ≥ 0 nas 6 ligas principais com Engine C ativo. |

---

## 14. Riscos e Mitigações

| Risco | Severidade | Mitigação |
|---|---|---|
| Drift de calibração após extração | Alta | Snapshot da `calib_map` antes da migração; A/B 7d com `\|Δfair_odd\| < 0.02`. |
| `market_alias_map` mal mantido vira bug silencioso | Média | Logar warning em todo alias resolvido; relatório semanal de aliases mais usados. |
| SQLite WAL falha sob escrita concorrente | Baixa | Pré-jogo é read-heavy. Pool de readers + único writer. Switch Postgres se P95 write > 50 ms. |
| `spawn` Python vira gargalo em batch | Média | Cache 30 min existente; v1.2 substitui por gRPC local. |
| Versão de catálogo dessincronizada | Média | `engine_signature.markets_catalog_version` no response; consumidor compara e alerta. |
| Overfit ao adicionar liga nova | Alta | Liga nova começa com `ewma_hr=0.5` e exige 30 jogos walk-forward antes de gerar tip `certified=true`. |
| CLV resolver pega closing line errada | Alta (impacta v1.6) | Source of truth: snapshot `bookline` 5 min antes do kickoff; sanity check `closing_odd ∈ [0.5×opening, 2×opening]`; falhas são `null` (não corrompem o `clv_score`). |
| Regime hint do consumidor é inconsistente | Média | Catálogo fixo de hints válidos; valores fora viram warning, não erro. v2.0 substitui por classificador. |

---

## 15. Produtos de Saída Esperados (Consumidores)

O Motor 4x4 **não produz** estes itens diretamente — ele entrega o universo de slots precificados (`fair_prob`, `fair_odd`, `confidence`, `ev_pct`, `provenance`, `evidence`). Os 5 produtos abaixo são **gerados pelos consumidores** consumindo `/v1/predict/batch` + `/v1/predict`. SPEC documenta a contrapartida que o motor precisa garantir.

| Produto consumidor | Descrição | O que o motor precisa entregar |
|---|---|---|
| **Apollo 32 — Estratégia Yankee** | Quadras (4 picks) montadas via combinador yankee, target odd combinada 2.50–3.50, desconto flat 0.854. | `slots[]` com `ev_pct` por leg, `confidence`, `family`, `market_heading`. Endpoint: `/v1/predict/batch`. |
| **Bom Retiro — Estratégia Técnica** | Picks únicos selecionados por critérios técnicos (sample mínimo, regime ausente, evidence forte). | Mesmo `slots[]` + `evidence` completo (drivers, splits, h2h). |
| **Lista completa EV+** | Todos os mercados (576) ordenados por `ev_pct > 0` por confronto. | `/v1/predict` com **todos os slots** retornados, sem filtragem (P9). Consumidor ordena. |
| **Duplas EV+ por confronto** | Pares de slots EV+ do mesmo confronto, com avaliação de correlação. | `slots[]` + `correlation_hint` opcional no `evidence` (ex.: `Over 2.5` e `BTTS Sim` correlacionam). v1.4. |
| **Bingo dos 7 melhores** | Ranking dos 7 picks com maior `score = ev_pct × confidence × reliability` em todos os jogos do dia. | `/v1/predict/batch` retornando todos os jogos; cliente faz o ranking. |

**Implicação direta para o motor:** sem P9 (zero bloqueio), produtos 3, 4 e 5 não funcionam. O motor **deve** retornar todos os mercados habilitados em `capabilities()`, mesmo os com `confidence` baixo. Filtragem é responsabilidade do consumidor.

**Endpoint dedicado opcional (v1.1):** `/v1/predict?include=all_markets` retorna explicitamente o universo completo. Default mantém o comportamento atual (todos os mercados, ordenados por `ev_pct DESC`).

---

## 16. Concorrência e Escalabilidade

**Pergunta direta:** o endpoint está preparado para várias chamadas simultâneas?

**Resposta: parcialmente sim, com gargalos identificados.** Detalhamento por camada:

### 16.1. Camada HTTP (Fastify)

✅ **Concorrência nativa.** Fastify é async I/O (libuv); um único processo Node atende centenas de requests simultâneos sem bloqueio. **Sem mudanças necessárias.**

### 16.2. Camada Repository (SQLite WAL)

✅ **Leituras concorrentes ilimitadas.** WAL permite múltiplos readers em paralelo.  
⚠️ **Escritas serializadas.** `motor_run` INSERT precisa lock. Mitigação: writes assíncronos via fila in-memory; resposta da API não espera persistência (`fire-and-forget` com retry).  
⚠️ **`/v1/settle/:run_id` precisa lock por `run_id`** para idempotência. Implementação: `INSERT OR IGNORE` no `clv_history` com PK `(run_id, market_key, period)`.

### 16.3. Camada Engine A (puro Node)

✅ **Stateless e thread-safe.** Pode rodar N requests em paralelo sem contenção.

### 16.4. Camada Engine B (Python sidecar) — **GARGALO PRINCIPAL**

🔴 **`spawn` por request não escala.** Cada chamada cria processo Python, carrega XGBoost+LGBM (~800 ms), responde. Em paralelo: memória explode, CPU satura.

**Mitigação MVP (já no legado):**
- **Cache de inferência 30 min** por `(match_id, feature_set)` — repete predição idêntica sem chamar Python.
- **Pool de workers Python persistentes** (3–5 processos), comunicação via stdio JSON com round-robin. Cada worker carrega o modelo uma vez na inicialização.

**Mitigação v1.2:**
- **gRPC local com pool gerenciado.** Substitui `spawn` por servidor Python persistente. Suporta ~50 RPS com latência P95 < 100 ms.

### 16.5. Camada SCOUT (opt-in)

✅ **Não-bloqueante por simplicidade.** O MVP atual executa um resumo determinístico local após o ranking. Não há chamada externa nem `scout_overlay` LLM. Se uma camada LLM for adicionada, ela deve ter timeout, orçamento por cliente e fallback explícito sem alterar probabilidades.

### 16.6. Limites de produção (MVP)

| Métrica | Limite | Como sustentar |
|---|---|---|
| RPS sustentado `/v1/predict` | ~30 | 1 processo Node + pool 5 Python workers + cache 30 min |
| RPS de pico | ~80 | Cache hit > 70%; pool com fila |
| `/v1/predict/batch` máx | 50 partidas/request | Hard limit no Fastify schema |
| Latência P95 single | < 800 ms (cache miss) / < 50 ms (hit) | Engine B é o piso |
| Latência P95 batch-50 | < 12 s (MVP), < 5 s (v1.2 gRPC) | Pool + gRPC |

### 16.7. Pré-requisitos para horizontal scaling (v1.5+)

- **Estado não-volátil:** `calib_state` precisa virar leitura compartilhada (Redis cache LRU 5 min) se rodar > 1 instância Node.
- **Settlement deduplicado:** `/v1/settle` precisa lock distribuído (Redis SETNX) se múltiplas instâncias rodarem o cron.
- **engine_signature compartilhado:** todas as instâncias precisam servir o mesmo hash; pin de versão no deploy.

**Resumo:** MVP atende 30 RPS sustentados em uma instância. Para o caso de uso atual (FutMax + Apollo + Bom Retiro + ~3 batches/dia), isso é **mais que suficiente**. Crescimento real força v1.2 (gRPC) antes de horizontal scaling.

---

## 17. Camada de Dados (Dual-Write + Replay)

O motor **não** extrai dados. Toda extração (Opta, Superbet) continua no **FutMax extractor**, que passa a fazer **dual-write** em duas bases SQLite independentes:

- `opta.db` — base legada do Apollo, intocada estruturalmente (continua alimentando os produtos antigos).
- `scout.db` — base nova do motor, schema livre para evoluir (backtest, calibração, replay) sem afetar Apollo.

### 17.1. Princípio do dual-write

```
┌────────────────────────────────────────────────────────────┐
│  FutMax Extractor (1 extração apenas)                      │
│                                                            │
│  Opta API + Superbet ──▶ writer.dualWrite()                │
│                            ├─▶ tx_legacy → opta.db   (Apollo) │
│                            └─▶ tx_scout  → scout.db  (Motor) │
│                                                            │
│  Ordem: legacy FIRST (Apollo nunca pode quebrar)           │
│         scout SECOND (se falhar, log + retry, NUNCA        │
│         rollback do legacy)                                │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│  SCOUTCORE_QUANT (motor)                                   │
│                                                            │
│  ▶ Lê e escreve apenas em scout.db                         │
│  ▶ Job sync-check diário compara COUNT/MAX em ambos DBs    │
│  ▶ Schema do scout.db evolui livremente (migrations próprias) │
│  ▶ Calibração nova, partindo do zero (Opção B + replay)    │
└────────────────────────────────────────────────────────────┘
```

### 17.2. Boot inicial (one-time, dia 0)

1. **Cópia única** do legado: `Copy-Item opta-extractor\db\opta.db SCOUTCORE_QUANT\data\scout.db`.
2. **Wipe das tabelas de motor antigo** no `scout.db` (decisão "tudo novo, nada de herança"):

```sql
-- scout.db: zerar estado de motor antigo
DELETE FROM predictions;             -- 6.318 predições do motor velho → fora
DELETE FROM ml_predictions;          -- output bruto do XGB antigo → fora
DELETE FROM calibration_states;      -- 160 EWMAs antigas → fora
DELETE FROM motor_runs;
DELETE FROM motor_boards;
DELETE FROM motor_yankee_tickets;
DELETE FROM banca_apostas;           -- carteira do Apollo legado → fora
DELETE FROM tips;                    -- tips antigas → fora

-- MANTER (são dados crus, não estado de motor):
--   partidas, team_profiles, eventos_faixa, odds, odds_historico, 
--   odds_coletas, leagues, teams (e tabelas auxiliares de extração)

VACUUM;
```

3. **Criar tabelas próprias do motor** em `scout.db`:

```sql
CREATE TABLE motor_run        (...);  -- request/response + engine_signature
CREATE TABLE prediction       (...);  -- slots persistidos por run_id/market_key
CREATE TABLE calib_state      (...);  -- EWMA + brier do nosso modelo
CREATE TABLE isotonic_blob    (...);  -- calibradores serializados
CREATE TABLE clv_history      (...);  -- CLV settlement nosso
CREATE TABLE feature_snapshot_cache (...);
CREATE TABLE replay_progress  (...);  -- controle do backfill (17.4)
```

### 17.3. FutMax dual-writer (mudança no extractor)

Wrapper único `futmax/lib/dual-writer.cjs`:

```javascript
// futmax/lib/dual-writer.cjs
const Database = require('better-sqlite3');

const legacy = new Database(process.env.OPTA_LEGACY_DB);  // opta.db (Apollo vive aqui)
const scout  = new Database(process.env.SCOUT_DB);        // scout.db (motor novo)

legacy.pragma('journal_mode = WAL');
scout.pragma('journal_mode = WAL');

function dualWrite(table, columns, rows) {
  const placeholders = columns.map(() => '?').join(',');
  const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`;

  // 1. LEGACY FIRST — Apollo não pode quebrar
  const stmtLeg = legacy.prepare(sql);
  const txLeg = legacy.transaction((rs) => { for (const r of rs) stmtLeg.run(...r); });
  txLeg(rows);

  // 2. SCOUT SECOND — falha não trava extração
  try {
    const stmtSc = scout.prepare(sql);
    const txSc = scout.transaction((rs) => { for (const r of rs) stmtSc.run(...r); });
    txSc(rows);
  } catch (e) {
    logger.error({ err: e.message, table, n: rows.length }, 'scout_write_failed_legacy_ok');
    // sync-check job recupera depois
  }
}

module.exports = { dualWrite };
```

Pontos no FutMax que viram `dualWrite()`: scripts de extração de `partidas`, `eventos_faixa`, `odds`, `odds_historico`, `team_profiles` (estimativa: 5–10 arquivos).

### 17.4. Replay histórico (Opção B — bootstrap do brier)

Em vez de herdar as 6.318 predições do motor antigo, o motor **rerroda Engine A + Engine B em todas as 14.998 partidas históricas** com seus próprios modelos. Resultado popula `clv_history` retroativo, gerando brier diferencial honesto do **modelo novo**.

```javascript
// scoutcore/jobs/replay-bootstrap.mjs
// Roda uma única vez no setup. Estimativa: ~10 dias de processamento.

const partidas = scout.prepare(`
  SELECT id_confronto, home_team, away_team, league, season, kickoff
  FROM partidas
  WHERE finalizado = 1
  ORDER BY kickoff ASC
`).all();

for (const p of partidas) {
  // 1. Reconstrói feature snapshot point-in-time (PIT enforced)
  const snap = await buildFeatureSnapshotPIT(p.id_confronto, p.kickoff);
  
  // 2. Roda Engine A (Poisson) + Engine B (XGB/LGBM) com modelos atuais
  const predA = await engineA.predict(snap);
  const predB = await engineB.predict(snap);
  
  // 3. Settlement com placar real → green/red
  const result = await settle(p.id_confronto);
  
  // 4. Persiste em clv_history
  scout.prepare(`
    INSERT INTO clv_history (match_id, family, liga, prob_a, prob_b, result, settled_at, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'replay_v1')
  `).run(...);
  
  // 5. Checkpoint a cada 100 jogos
  scout.prepare('INSERT OR REPLACE INTO replay_progress VALUES (?, ?)').run('last_match_id', p.id_confronto);
}
```

Resultado esperado: ~14.998 partidas × ~50 mercados ativos por partida = ~750k linhas em `clv_history`. Brier diferencial calibrado com **nosso modelo**, sem nenhuma herança do motor antigo.

### 17.5. Sync-check diário (motor)

Cron `03:00 America/Sao_Paulo` em `scoutcore/jobs/sync-check.mjs`:

```javascript
const tables = ['partidas', 'team_profiles', 'eventos_faixa', 'odds', 'odds_historico'];
const drift = {};
for (const t of tables) {
  const cLeg   = legacy.prepare(`SELECT COUNT(*) c, MAX(criado_em) m FROM ${t}`).get();
  const cScout = scout.prepare(`SELECT COUNT(*) c, MAX(criado_em) m FROM ${t}`).get();
  drift[t] = { legacy: cLeg, scout: cScout, delta: cLeg.c - cScout.c };
  if (Math.abs(drift[t].delta) > SYNC_DRIFT_THRESHOLD) {
    alert(`sync_drift:${t}:${drift[t].delta}`);
  }
}
scout.prepare('INSERT INTO sync_check_log (run_at, payload) VALUES (?, ?)').run(now(), JSON.stringify(drift));
```

`SYNC_DRIFT_THRESHOLD = 5` (default). Se algum dual-write falhou e ficou drift, alerta no painel de ops.

### 17.6. Freshness Guard (em runtime)

A cada `/v1/predict`:

```javascript
const optaAge = Date.now() - getMaxCriadoEm(scout, 'partidas', matchId);
const oddsAge = Date.now() - getMaxCriadoEm(scout, 'odds', matchId);

if (optaAge > FRESHNESS_OPTA_SOFT_MS) warnings.push(`opta_stale:${humanize(optaAge)}`);
if (optaAge > FRESHNESS_OPTA_HARD_MS) throw new Error('opta_too_stale');
if (oddsAge > FRESHNESS_ODDS_SOFT_MS) warnings.push(`odds_stale:${humanize(oddsAge)}`);
if (oddsAge > FRESHNESS_ODDS_HARD_MS) throw new Error('odds_too_stale');
```

Thresholds: opta soft 24h / hard 7d, odds soft 30min / hard 6h.

### 17.7. data_snapshot_hash no engine_signature

Para reprodutibilidade (P5):

```json
{
  "engine_signature": {
    "hash": "9f2e...",
    "calib_snapshot_id": "a7c1...",
    "data_snapshot_hash": "b42d..."
  }
}
```

**Estado real do MVP.** `calib_snapshot_id` é derivado de `calib_state` + `isotonic_blob`; `data_snapshot_hash` é derivado dos inputs efetivamente usados na run (`match`, temporada, `profile_home`, `profile_away`, `league_priors_ft`). Assim, replay de runs novos deixa de ser apenas hash de código/modelos. Ainda não há snapshot imutável do banco inteiro nem validação por `scout.db.mtime`; essa camada continua pendência operacional para SOX completo.

### 17.8. Caminho evolutivo

| Fase | Estratégia | Acoplamento ao FutMax |
|---|---|---|
| **MVP** | Dual-write FutMax → 2 SQLite locais. Motor lê/escreve só `scout.db`. | 🟡 Médio (1 wrapper) |
| **v1.5** | FutMax expõe `/v1/extract-event` em HTTP. Dual-write fica do lado do motor (mensageria). | 🟢 Baixo |
| **v2.0** | Schema do `scout.db` totalmente independente; motor recebe eventos via Kafka/Webhook do FutMax. | 🟢 Zero |

**Decisão "tudo novo":** o motor não herda **nada** de calibração ou predição do legado. Apenas dados crus (stats Opta, odds Superbet) são compartilhados. Brier, EWMA, isotônica e CLV são construídos do zero pelo replay (~10 dias de processamento) e pelo settlement em produção.

---

## Anexo A — Validação Empírica

**Banco analisado:** `opta.db` (1.46 GB), 14.998 partidas, 223.152 linhas em `eventos_faixa`. Script de auditoria reproduzível em [`scripts/motor4x4_faixa_audit.py`](scripts/motor4x4_faixa_audit.py).

### A.1. Volume por liga (suporta gate de stacking v1.4)

| Liga | Jogos | Stacking-ready (≥1500)? |
|---|---:|:---:|
| brasileirao | 2.280 | ✅ |
| serie-a (Itália) | 1.901 | ✅ |
| la-liga | 1.900 | ✅ |
| premier-league | 1.900 | ✅ |
| ligue-1 | 1.678 | ✅ |
| bundesliga | 1.530 | ✅ |
| superliga-argentina | 998 | ⚠️ marginal |
| brasileirao-b, championship, la-liga-2, serie-b-italia, liga-mx, primeira-liga | 306–764 | ❌ |

### A.2. Mercado bandas 10min — escanteios faixa 0-10 (suporta v1.5)

**Brasileirão (2.037 partidas):**

| Mercado | Hit-rate | fair_odd |
|---|---:|---:|
| Total Over 0.5 | 66.4% | 1.506 |
| Total Under 1.5 | **70.7%** | **1.414** |
| Total Over 1.5 | 29.3% | 3.418 |
| Total Under 0.5 | 33.6% | 2.978 |

**Serie A Itália (1.869 partidas):**

| Mercado | Hit-rate | fair_odd |
|---|---:|---:|
| Total Over 0.5 | 62.0% | 1.613 |
| Total Under 1.5 | **73.6%** | **1.358** |
| Total Over 1.5 | 26.4% | 3.791 |
| Total Under 0.5 | 38.0% | 2.632 |

**Times com taxa extrema Equipe Under 0.5 escanteios 0-10 (≥50 jogos):**

| Liga | Time | Taxa | fair_odd |
|---|---|---:|---:|
| brasileirao | Chapecoense | 76.5% | 1.308 |
| brasileirao | Juventude | 70.4% | 1.421 |
| serie-a | Venezia | 76.3% | 1.310 |
| serie-a | Parma | 74.0% | 1.352 |

**Times com taxa extrema Equipe Over 0.5 chutes 0-10 (≥50 jogos, brasileirao):**

| Time | Taxa | fair_odd |
|---|---:|---:|
| Palmeiras | 79.4% | 1.259 |
| Mirassol | 74.5% | 1.342 |
| RB Bragantino | 74.5% | 1.342 |
| Flamengo | 72.4% | 1.381 |
| Bahia | 72.1% | 1.387 |
| Botafogo | 72.1% | 1.387 |
| América Mineiro | 71.9% | 1.390 |
| Fluminense | 71.6% | 1.397 |
| Atlético Mineiro | 71.1% | 1.407 |

**Conclusão.** Mercado tem valor real e mensurável. v1.5 prioritária.

---

## Anexo B — Avaliação de Propostas Externas

Foram avaliadas 5 propostas vindas de uma revisão paralela (consultor externo). A avaliação seguiu o princípio "rejeitar com critério, não aceitar para agradar".

| # | Proposta | Veredicto | Justificativa |
|---|---|---|---|
| 1 | **Feature Lineage** — provenance da feature (SHAP por contribuição). | ✅ Aceito parcial — entra na **v2.0**. | Ideia forte (explainability institucional). Engine B (XGB/LGBM) suporta SHAP nativo; Engine A (Poisson) precisa decomposição manual de λ (`home_attack_strength`, `away_defense_weakness`, `home_advantage`). Custo de implementação não é zero, e v1.0 tem entregas mais críticas (PIT, isotônica, contrato). |
| 2 | **Engine Family Layer** — separar em GoalEngine, CornerEngine, CardEngine, etc. | ❌ **Rejeitado.** | Já existe `family_engine_weights` por (família × liga) no Curinga + multiplicadores por (família × heading) em `quality-gates.json`. Fragmentar em N engines duplica infra (CI, deploy, monitoring, calibração) sem ganho probabilístico. O efeito desejado (calibração específica por família) já está implementado de forma mais barata. Renomear conceitualmente "calibration scope" no docs basta. |
| 3 | **Market Regime Detection** — detectar `high_volatility`, `derby`, etc. e aplicar `confidence_penalty`. | ✅ Aceito como semente em v1.0 + automatizado em **v2.0**. | v1.0 expõe `match_context.regime_hints[]` no contrato (flag manual: `derby`, `final_temporada`, `weather_rain`, ...). Engine A multiplica `quality_gate_multiplier` por regime. Classificador automático (HMM/change-point detection) é v2.0+ — exige histórico anotado que ainda não temos. |
| 4 | **Meta-layer "engine aprende qual engine vence em qual contexto"**. | ❌ **Rejeitado como novidade — já implementado.** | Isso descreve exatamente `ewma_hr per (engine, family, liga)` na regra `calibration` do Curinga: o engine com maior hit-rate recente naquela família×liga ganha em divergências médias. A evolução natural é stacking, já planejado para v1.4. O consultor externo não auditou o legado antes de propor. |
| 5 | **Economic Feedback Loop** — CLV → ROI → recalibração econômica. | ✅ **Aceito forte — promovido para v1.6 (D11).** | É o gap real do projeto. Hoje recalibra por hit/miss; deveria recalibrar por CLV (sinal econômico real). Spec concreta: tabela `clv_history`, job `settlement_resolver` (cron 05:00 BRT), `clv_score` por (engine, família, liga), score do Curinga muda para `α × ewma_hr + (1-α) × clv_score`. |

**Recomendações de "não fazer" — concorda integralmente:**
- ❌ Não entrar em transformer (já estava rejeitado).
- ❌ Não virar enterprise demais (Kafka/Flink/Feast já estavam rejeitados).

---

## Anexo C — Pontos de Validação Humana

Decisões de negócio não-técnicas que ficam fora do escopo desta SPEC:

| # | Pergunta | Sugestão técnica |
|---|---|---|
| 1 | Política de aposentadoria de versões: quanto tempo manter `contract_version: "1.0.0"` depois de sair `2.0.0`? | 6 meses + 1 release de aviso (`Deprecation` header). |
| 2 | SLA para consumidores B2B externos: qual P95 prometer? | 800 ms single, 5 s batch-50. |
| 3 | Custo de um eventual SCOUT LLM: quem paga? | Pendente. Só adicionar quando houver bilhetagem por `client.system` + `tokens_used` no diagnostics. |
| 4 | Domínio do `@motor4x4/markets`: npm público, registry privado, monorepo? | Privado (GitHub Packages) até v2.0. |
| 5 | Quem mantém `quality-gates.json` e `calib_map`: automatizado ou revisão humana? | Automatizado walk-forward + guard-rail manual para deltas > 15% (notifica Slack). |
| 6 | Source of truth para closing line do CLV (D11): `bookline` (Superbet) ou consenso multi-house? | Começar com `bookline` snapshot 5 min pré-kickoff. v2.0 adiciona consenso. |

---

**Resumo executivo honesto:** o Motor 4x4 já roda como serviço HTTP versionado, com Engine A, sidecar B opcional, Curinga, `engine_signature`, persistência de runs/slots, settlement com Brier/CLV quando houver closing odds, evidence pack e scout determinístico. Ainda não está pronto para B2B financeiro sem reforçar PIT, isotônica por família, cobertura B, captura automática de closing line e CI E2E.

---

## Anexo D — Inventario do Legado e Gap Analysis

Auditoria profunda do legado em [opta-extractor/src/motor/](file:///C:\Users\Rogerio\Desktop\RGMV_PROJETOS\SOLUCAO_IA_Motor4x4\opta-extractor\src\motor) e [ApolloFinalV2/](file:///C:\Users\Rogerio\Desktop\RGMV_PROJETOS\SOLUCAO_IA_Motor4x4\opta-extractor\ApolloFinalV2) realizada em 07/05/2026.

### D.1. Componentes legíveis e mapeados

| Componente legado | Status na SPEC | Local na SPEC |
|---|---|---|
| `motor.js` (orquestrador A‖B) | ✅ absorvido | §5 Componentes |
| `model-a.js` (Poisson DC + EWMA) | ✅ absorvido | §5 Engine A |
| `model-b.js` (bridge Python) | ✅ absorvido | §5 Engine B |
| `curinga.js` (4 regras) | ✅ absorvido + refinado | §7 Curinga (score: D11) |
| `scout.js` (GPT-4o→Claude→Perplexity) | ⏳ não absorvido no MVP | §9 Scout hoje é determinístico; LLM fica pendente. |
| `model-a-calibration.js` (EWMA persist) | ✅ absorvido | §6 calib_state schema |
| `motor-db.js` (INSERT predictions) | ✅ evolução | §6 motor_run table + replay |
| `contracts.js` (JSDoc types) | ✅ evolução (Zod + Pydantic) | §4 contrato I/O |
| `stat-engine.cjs` (Poisson core) | ✅ absorvido | §5 Engine A |
| `quality-gates.json` | ✅ absorvido | §7.3 config |
| `product-contract.json` | ✅ absorvido | §7.3 config |
| `ml/ml_predictor.py` + `best_params.json` | ✅ absorvido | §5 ML sidecar |
| `optuna_study.db` | ✅ mantido como artefato | fora do core |
| `backtest.js` + `backtest-ab.js` | ✅ mantido como tooling | fora do core (CI) |
| `combinator.js` (Yankee) | ⚠ Apollo-only | não entra no Motor; Apollo consome `ev_ranked` |
| `board-validator.js` | ⚠ Apollo-only | idem |
| `ApolloFinalV2/product/*` | ⚠ consumidor | não entra no Motor; vive como cliente |
| `ApolloFinalV2/core/guardrails.cjs` | ⚠ consumidor | bankroll/kelly são do Apollo, não do Motor |
| `ApolloFinalV2/bot/superbet-core.mjs` | ⚠ consumidor | submission vêículo do Apollo |

**Princípio mantido:** o Motor entrega `slots` precificados + `evidence`; **cliente** (Apollo, FutMax) decide se vira tip, qual stake, em qual bônus. SPEC não engloba geração de tip nem submissão.

### D.2. Regras absorvidas (D12–D15)

Quatro decisões novas codificam o que estava espalhado em `quality-gates.json` e `stat-engine.cjs`, **traduzidas para o regime P9 (zero bloqueio, só calibragem)**:

- **D12 — Reversal detection:** `reversal_streak_threshold=5`, penalty `-1.8pp` no λ (cap `-6pp`). Calibragem do λ, não filtragem.
- **D13 — Market reliability multiplier:** o que era `demote/promote` binário vira escala contínua `[0.5, 1.0]` aplicada a `confidence`. Mercado ruidoso reporta `confidence` mais baixo, **não é descartado**.
- **D14 — Confidence multipliers por classe:** mantém valores do legado (corners 0.82, cards_handicap 0.76 etc.). Reduz `confidence`, não filtra.
- **D15 — Family weights sempre > 0:** `chutes.w_b` reaberto para 0.50 no MVP (sem evidência atualizada para veto). Brier diferencial pós-MVP pode reduzir até `0.05`, nunca zero.

### D.3. Regras explicitamente NÃO absorvidas (justificativa)

| Regra legada | Por que não entra | Onde fica |
|---|---|---|
| `kelly_fraction = 1/3` | Bankroll é do consumidor | ApolloFinalV2/product/stake.cjs |
| `max_consecutive_reds = 5` | Kill-switch é do consumidor | ApolloFinalV2/core/guardrails.cjs |
| `max_drawdown_day_pct = 20` | idem | idem |
| `builder_discount_base = 0.854` | Quadra/Yankee é do consumidor | ApolloFinalV2/product/combinator |
| `prob_min_tier_A = 0.65`, tiers A/B/C | Tiering é seleção de tip, não predição | ApolloFinalV2/product/gold-picks |
| `blocked_market_headings` | Apollo decide o que apostar | ApolloFinalV2 |
| `n_confrontos_options [10,12]` | Tamanho do board | ApolloFinalV2 |
| `odd_max_leg = 2.10` | Filtro de tip | ApolloFinalV2 |

**Linha clara:** SPEC = predição + provenance + evidence. Apollo (e qualquer outro consumidor) = seleção + stake + submissão.

### D.4. Brier inicial — via replay histórico (Opção B)

**Decisão do usuário (07/05/2026):** motor não herda nada do legado. Opção B aprovada — replay de todas as ~14.998 partidas históricas com Engine A + B novos popula `clv_history` retroativo. Estimativa: ~10 dias de processamento (gargalo Engine B Python). Resultado: brier diferencial 100% calibrado com nosso modelo, sem nenhuma herança do motor antigo. Threshold `BRIER_BOOTSTRAP_MIN_SAMPLES=30`; abaixo disso usa `ewma_hr`.

As 6.318 predições do motor legado em `predictions` são **descartadas** no boot inicial (§17.2 wipe).

### D.5. Risco residual

| Risco | Mitigação |
|---|---|
| Bootstrap do `ewma_brier` antes de 30 jogos em (família × liga) | `BRIER_BOOTSTRAP_MIN_SAMPLES=30` cai pra `ewma_hr` enquanto isso |
| `chutes.w_b = 0.50` reaberto sem backtest atualizado | Brier diferencial calculável já no MVP via §17.6; ajuste fino em < 7 dias de produção |
| Market reliability multiplier desatualizado | Job semanal de walk-forward atualiza pesos; SPEC §5 jobs assíncronos cobre |
| Reversal threshold magic number `5` | Configurável; pode virar parâmetro Bayesiano em v2.0 |
| Consumidor não filtra mercados ruidosos (P9 dá trabalho) | `confidence` honesto + `evidence` completo são suficientes; documentação do consumidor (Apollo) sustenta o filtro |
| `opta.db` legado migrar/compactar e quebrar replay | Hash do arquivo (`opta_db_mtime` + `opta_db_size`) entra no `engine_signature.data_snapshot`; replay retorna `replay_unavailable` se hash diverge |
| Path absoluto do `opta.db` hardcoded no `.env` | v2.0 substitui por HTTP `/v1/feature-snapshot` no FutMax (§17.7) |
