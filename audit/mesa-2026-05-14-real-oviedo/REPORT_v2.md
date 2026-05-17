# Mesa — Real Madrid × Real Oviedo (2026-05-14 16:30 BRT, La Liga R36) — v2

## Run
- `run_id`: `9a1174b5-9a60-4056-be3e-f69c933b6e00`
- `engine_signature.hash`: `291c4674c9efc3a6`
- `calib_snapshot_id`: `68fd2e6191ef50e6`
- `latency_ms`: 13.214 (scout 9.861 + engine_b 3.034 + engine_a 29 + curinga 4 + isotonic 13)
- `warnings`: `[]`
- `slots`: **530** (vs 419 na mesa anterior sem Engine B)

## Bloqueadores RESOLVIDOS (v1 → v2)

| # | Bloqueador v1 | Causa raiz | Correção aplicada | Status v2 |
|---|---|---|---|---|
| 1 | `SCOUT skip_reason=no_provider_configured` | API rodando processo stale (pid 94192 de 13/05) anterior ao `@scoutcore/scout@0.3.1`; `dotenv` não recarregado | Mata pid 94192 + relança via `Start-Process node apps/api/src/index.mjs` (cwd = workspace root → `import 'dotenv/config'` em index.mjs:4 carrega `.env`). Keys confirmadas: `OPENAI_API_KEY` (164 chars) e `PERPLEXITY_API_KEY` (53 chars). | ✅ `scout_provider=gpt-4o`, `scout_web_context=true`, 1.732 tokens, `scout_score=55`, 3 red_flags |
| 2 | `Engine B: no_features_and_no_db` | Sidecar (pid 75188) iniciado sem `SCOUT_DB` no env → `_get_db()` retornava `None` em server.py:64–72, fallback DB nunca disparava | Mata pid 75188 + relança com `$env:SCOUT_DB='data/scout.db'; Start-Process python -m uvicorn ...` (pid 374184). | ✅ `engines_used=["A","B"]`, sidecar `/predict` retorna 53 slots `available=true`, divergence calculada em todos os slots multi-engine |
| 3 | EWMA settler virgem no signature atual | `calib_state` vazio porque `settle-results.mjs` nunca rodou nesse DB | `node apps/jobs/src/settle-results.mjs` (1 ciclo full). | ✅ 59.992 predictions settled, **460 grupos `calib_state`** atualizados via EWMA (α=0.15), 12.492 inserts em `clv_history` |

### Calib_state (engine A) — amostra pós-settler

| family | direction | liga | sample_size | ewma_hr | λ_mult | conf_factor |
|---|---|---|---|---|---|---|
| chutes | over | la-liga | 1.804 | 0.509 | 0.83 | 0.78 |
| chutes | over | premier-league | 1.540 | 0.427 | 0.65 | 0.60 |
| escanteios | over | la-liga | 1.435 | 0.525 | 1.00 | 1.05 |
| escanteios | under | premier-league | 1.225 | 0.690 | 1.128 | 0.87 |
| gols | over | la-liga | 1.148 | 0.404 | 1.00 | 0.84 |
| cartoes | over | la-liga | (n>100) | — | — | — |

Total: 460 grupos `(family, direction, liga)` calibrados.

## SCOUT IA (camada 2) — narrativa

> "O Real Madrid é amplamente favorito contra o Real Oviedo, que tem um desempenho fraco como visitante. No entanto, os edges extremamente altos em mercados como escanteios HT e vitória do mandante levantam suspeitas de erro de modelagem. A baixa confiança do modelo em cartões também sugere cautela. A partida não é um clássico, o que minimiza a expectativa de alta intensidade emocional."

### Red flags (3)

| Mercado | Severidade | Δ confiança | Razão |
|---|---|---|---|
| `escanteios_total_ht_under_6_5` | medium | -0.20 | Alta variância em escanteios HT |
| `cartoes_total_ft_over_2_5` | low | -0.15 | Confiança baixa no modelo |
| `1x2_total_ft_home` | medium | -0.20 | Edge muito alto sem razão clara |

## Engine A vs B — divergência

| input | valor |
|---|---|
| λ_home | 4.061 |
| λ_away | 0.554 |
| λ_total | 4.614 |
| leagueAvg | 2.705 |
| attH / defA | 1.696 / 1.609 |
| attA / defH | 0.739 / 0.609 |

Slot exemplo `gols_total_ft_over_0_5`:
- fair_prob_A = 0.9890
- fair_prob_B = 0.9780
- divergence_pp = 1.1 pp → `divergence_flag=false`
- `divergence_resolved_by`: `consensus`
- pesos: `weight_a=0.75`, `weight_b=0.25` (`weight_source=a_only_history`)

## EV Ranked (certificados pós-isotonic + QG + Scout)

| # | mercado | odd | fair | edge | conf | cert |
|---|---|---|---|---|---|---|
| 1 | `escanteios_total_ht_under_6_5` | 1.29 | 0.873 | +12.62% | 0.181 | ✓ |
| 2 | `cartoes_total_ft_over_2_5` | 1.50 | 0.763 | +14.47% | 0.154 | ✓ |
| 3 | `1x2_total_ft_home` | 1.28 | 0.853 | +9.21% | 0.200 | ✗ (Scout flag) |
| 4 | `escanteios_total_ft_under_12_5` | 1.33 | 0.803 | +6.74% | 0.390 | ✓ |
| 5 | `escanteios_total_ft_under_11_5` | 1.50 | 0.703 | +5.51% | 0.390 | ✓ |
| 6 | `btts_total_ft_nao` | 1.80 | 0.590 | +6.17% | 0.327 | ✓ |

Slots certificados totais: 365 de 530.

## Arquivos atualizados
- `audit/mesa-2026-05-14-real-oviedo/response.json`
- `audit/mesa-2026-05-14-real-oviedo/audit_table.json`
- `audit/mesa-2026-05-14-real-oviedo/audit_report_v2.txt`
- `audit/mesa-2026-05-14-real-oviedo/REPORT_v2.md` (este arquivo)
