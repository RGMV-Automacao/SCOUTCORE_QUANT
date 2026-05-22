# Auditoria Profunda de Motores

Gerado em: 2026-05-19T15:55:35.959Z
Banco: data/scout_extraction.db

## Veredito

- Status quantitativo: PASS_WITH_WARNINGS
- Status runtime/front: NOT_EXECUTED_BY_THIS_SCRIPT
- Garantia honesta: Motores/backtest sem falhas criticas/altas; ha warnings operacionais que impedem garantia total de produto front sem ressalvas.

## Resumo de Dados

- Backtest predictions: 5.152.024
- Backtest eval: 5.152.024
- Outcomes: 14.186
- Ligas: 13
- Famílias: 17
- Isotonic blobs: 374
- calib_state: 756
- ML models trained/skipped: 28/0

## Checks

| ID | Severidade | Status | Check | Detalhe |
|---|---:|---:|---|---|
| BT-001 | CRITICAL | PASS | Cada slot de backtest tem avaliação | 5152024 predictions vs 5152024 eval rows |
| BT-002 | CRITICAL | PASS | Sem órfãos entre predictions e eval | missing_eval=0; orphan_eval=0 |
| BT-003 | CRITICAL | PASS | Settling coerente com observed | observed_mismatch=0; null_observed=0; outcomes=[{"outcome":"red","n":2619048},{"outcome":"green","n":2532976}] |
| BT-004 | CRITICAL | PASS | Probabilidades e fair_odd válidos no backtest | {"bad_fair_prob":0,"bad_fair_prob_raw":0,"bad_fair_odd":0,"null_fair_odd":0} |
| BT-005 | HIGH | PASS | Families/period/direction dentro do contrato | unknown_families=none; unknown_periods=none; null_directions=0 |
| CAL-001 | CRITICAL | PASS | Todo grupo de backtest tem fit isotônico efetivo | effective=1235/1235; missing=0 |
| CAL-002 | HIGH | PASS | calib_state EWMA válido | {"calib_state_rows":756,"non_a_rows":0,"bad_hr":0,"bad_brier":0,"below_min_sample":0} |
| CAL-003 | HIGH | PASS | EWMA warmup 60d cobre exatamente as chaves esperadas | cutoff=2026-03-19; expected=756; missing=0; extra=0 |
| DATA-001 | HIGH | PASS | Perfis e priors FT atuais incluem desarmes | profiles 2418/2418; FT priors 40/40; all periods 40/120 |
| DATA-002 | MEDIUM | WARN | HT/2T priors não carregam eventos por desenho | rebuild-league-priors anexa eventos somente em FT; HT/2T preservam apenas gols/btts/over_25. |
| LIVE-001 | CRITICAL | PASS | Predictions persistidas estão aptas para front | {"rows":10714,"runs":22,"matches":22,"certified_rows":39,"certified_without_odd":0,"certified_without_edge":0,"bad_fair_prob":0,"bad_confidence":0,"bad_provenance_json":0} |
| LIVE-002 | HIGH | WARN | Cobertura de odds por confronto para produto front | matches_with_any_odd=6/22; sem_odds=16; with_odds_no_certified=0 |
| ML-001 | HIGH | PASS | ML sidecar treinado com todos os modelos esperados | trained=28; skipped=0; n_features=32; joblib_files=28; stale=none |
| CAL-004 | MEDIUM | PASS | Relatório de ganho de calibração existe | audit/backtest/calibration_gain.md encontrado |

## Observações

- Modo --fast: cobertura por família/ligas reaproveitada dos CSVs já gerados em audit/backtest e audit/motors.
- Este script certifica coerência quantitativa dos artefatos atuais. Ele não prova ausência absoluta de bug futuro nem substitui teste runtime das rotas HTTP.
- Gaps de observabilidade em fair_prob_raw/fair_prob pós-curinga/isotonic não quebram o fluxo atual, mas limitam auditoria forense de probabilidade por etapa.
- Engine B offline é degradada por desenho para A-only; para certificação operacional, validar /v1/health com sidecar reachable=true.

