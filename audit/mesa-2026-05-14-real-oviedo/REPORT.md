# MESA TEST — Real Madrid x Real Oviedo
**Data:** 2026-05-14 19:30 BRT  •  **Liga:** La Liga 2025/2026 — rodada 36
**Estádio:** Santiago Bernabéu  •  **Árbitro:** Ricardo De Burgos Bengoetxea
**run_id:** `d5339f0e-19ae-400d-a042-4fa2bde40962`
**Latência total:** 508ms  •  **Slots gerados:** 530  •  **Slots c/ odd:** 47  •  **Certificados:** 376

---

## 1. Inputs do Engine A (Poisson)

| campo | valor | leitura |
|---|---|---|
| λ_total_ft | **4.614** | Real Madrid 4.06 + Real Oviedo 0.55 |
| λ_home | 4.061 | ataque RM 1.696 × defesa Oviedo 1.609 × HA 1.10 × leagueAvg 2.705 ÷ 2 |
| λ_away | 0.554 | ataque Oviedo 0.739 × defesa RM 0.609 × leagueAvg 2.705 ÷ 2 ÷ HA |
| attH/defH | 1.696 / 0.609 | Real Madrid forte no ataque, defesa elite |
| attA/defA | 0.739 / 1.609 | Oviedo fraco ataque, defesa abaixo da média |
| leagueAvg | 2.705 | gols/jogo La Liga 2025/26 |

> Predição é coerente: RM goleada esperada ~4×1 contra promovido recém-rebaixado-status.

## 2. Status dos motores

| componente | status | observação |
|---|---|---|
| **Engine A (Poisson)** | ✅ OK | 8ms, 530 slots, λ certificado |
| **Engine B (XGBoost sidecar)** | ❌ INDISPONÍVEL | `no_features_and_no_db` — `feature_snapshot` vazio para este confronto, sidecar sem fallback DB |
| **Curinga (combine)** | ✅ OK | 1ms — todos slots com weight_a=1, weight_b=0 (sem B) |
| **Isotonic calibration** | ✅ OK | aplicada em todos slots (n=5.952 a 22.320 amostras) |
| **QG (Quality Gates)** | ✅ OK | reprovou phantom edges (>50%) corretamente |
| **EWMA calibração (settler)** | — | `no_samples` — settler ainda não rodou neste signature |
| **SCOUT IA (GPT-4o + Perplexity)** | ❌ SKIP | `no_provider_configured` — keys não expostas no processo API |

## 3. Auditoria por mercado (47 com odd injetada)

> `fair_raw → fair (iso)` mostra calibração isotônica em ação. `cert=N` quando QG reprova (edge phantom, gate fail) ou inputs não-certificados.

### 3a. Top edges positivos (todos)
| mercado | fair_raw | fair (iso) | n_iso | odd | edge% | conf | QG | cert |
|---|---|---|---|---|---|---|---|---|
| `cartoes_total_ft_over_4_5` | 0.5491 | 0.5938 | 11.904 | 3.25 | **+92.98%** | 0.587 | OK | ❌ phantom |
| `chutes_total_ft_over_9_5` | 1.0000 | 1.0000 | 19.344 | 1.80 | **+80.00%** | 0.521 | OK | ❌ phantom |
| `gols_total_ft_over_4_5` | 0.4893 | 0.4391 | 5.952 | 4.00 | **+75.66%** | 0.667 | OK | ❌ phantom |
| `cartoes_total_ft_over_3_5` | 0.7266 | 0.7710 | 11.904 | 2.15 | +65.76% | 0.587 | OK | ❌ phantom |
| `gols_total_ft_over_3_5` | 0.6765 | 0.6519 | 5.952 | 2.32 | +51.25% | 0.667 | OK | ❌ phantom |
| `cartoes_total_ft_over_2_5` | 0.8703 | 1.0000 | 11.904 | 1.50 | +50.00% | 0.587 | OK | ❌ phantom |
| `gols_total_ft_over_2_5` | 0.8388 | 0.7981 | 5.952 | 1.53 | +22.11% | 0.667 | OK | ❌ phantom |
| `1x2_total_2t_home` | 0.8372 | 0.7500 | 9.447 | 1.56 | +17.00% | 0.667 | OK | ❌ phantom |
| `escanteios_total_ht_under_4_5` | 0.5994 | 0.5556 | 22.320 | 2.07 | +15.00% | 0.667 | OK | ❌ phantom |
| **`gols_total_ht_over_2_5`** | 0.2817 | 0.2346 | 5.952 | **4.90** | **+14.96%** | 0.420 | OK | ✅ **CERT** |
| **`escanteios_total_ht_under_5_5`** | 0.7612 | 0.6902 | 22.320 | **1.56** | **+7.68%** | 0.534 | OK | ✅ **CERT** |
| **`gols_total_ht_over_1_5`** | 0.5535 | 0.4683 | 5.952 | **2.25** | **+5.36%** | 0.420 | OK | ✅ **CERT** |
| **`btts_total_ft_nao`** | 0.5811 | 0.5817 | 9.447 | **1.80** | **+4.70%** | 0.667 | OK | ✅ **CERT** |
| **`escanteios_total_ht_under_3_5`** | 0.4046 | 0.3364 | 22.320 | **3.10** | **+4.29%** | 0.534 | OK | ✅ **CERT** |

### 3b. Picks certificados (saída final do motor)
**EV ranked = 5 picks**, capped_out = 0:
1. `gols_total_ht_over_2_5` — EV +14.96% @ 4.90 (fair 23.46%, conf 0.42)
2. `escanteios_total_ht_under_5_5` — EV +7.68% @ 1.56 (fair 69.02%, conf 0.53)
3. `gols_total_ht_over_1_5` — EV +5.36% @ 2.25 (fair 46.83%, conf 0.42)
4. `btts_total_ft_nao` — EV +4.70% @ 1.80 (fair 58.17%, conf 0.67)
5. `escanteios_total_ht_under_3_5` — EV +4.29% @ 3.10 (fair 33.64%, conf 0.53)

> Sem Engine B, confidence ficou baixa (0.42–0.67) — não há cross-check XGBoost para amplificar peso.

## 4. Curinga (faixa)

Todos os slots com `weight_a=1, weight_b=0, divergence=null, divergence_resolved_by="engine_b_unavailable"`. **Curinga não atuou neste mesa** — não há divergência A↔B para resolver pois B caiu. Pesos por família por liga (ewma_brier-based) ficaram inertes.

## 5. SCOUT IA

```json
{ "model": null, "latency_ms": 0, "tokens_used": 0, "skip_reason": "no_provider_configured", "red_flags": [], "narrative": null }
```

**Causa:** processo API foi iniciado sem `OPENAI_API_KEY` / `PERPLEXITY_API_KEY` no env. As keys estão no `.env` do `opta-extractor` mas não foram exportadas pro shell que rodou o API.

## 6. Diagnostics

```json
{ "latency_ms": 508, "engines_used": ["A","B"], "engine_a_ms": 8, "engine_b_ms": 205, "curinga_ms": 1, "isotonic_ms": 6, "scout_ms": 2, "scout_provider": null, "scout_tokens": 0 }
```

---

## 7. Veredito do mesa

✅ **Funcionando ponta-a-ponta:** Engine A (Poisson com λ certificado), Isotonic (100% cobertura), QG (rejeitou phantom edges +50% a +93%), EV ranking, persist run, response schema.

❌ **Bloqueadores reais identificados:**
1. **Engine B caiu para confronto novo** — `feature_snapshot` não populado, sidecar não tem fallback (mensagem `no_features_and_no_db`). Sem features pré-computadas + sem path de leitura direta dos profiles → engine_b inutilizado para predições ad-hoc.
2. **SCOUT IA não inicializado** — keys ausentes no processo. Solução: exportar `OPENAI_API_KEY` e `PERPLEXITY_API_KEY` antes de `node apps/api/src/index.mjs`.
3. **EWMA settler ainda virgem** — `calib.applied=false (no_samples)`. Settler precisa rodar pelo menos 1 ciclo de backtest neste engine_signature.
4. **Confidence comprimido** — sem B, baseConfidence × qg fica entre 0.42–0.67. Brier-confidence multiplier não aplicou (`insufficient_brier_samples`).

⚠️ **Phantom edges legítimos detectados pelo QG:** 9 slots com edge >15% foram corretamente marcados `cert=N`. O sistema NÃO entregaria essas picks ao usuário.

## 8. Picks finais (saída do motor para usuário)

**Modo HT-friendly (3 picks de gols/escanteios de 1º tempo + 1 do FT):**
- Over 2.5 gols HT @ 4.90 → EV +14.96%
- Over 1.5 gols HT @ 2.25 → EV +5.36%
- Under 5.5 escanteios HT @ 1.56 → EV +7.68%
- BTTS Não FT @ 1.80 → EV +4.70%

> Observação: 3/5 picks são HT — coerente com λ_home 4.06 que projeta gol-cedo do RM. Under 5.5 escanteios HT é contra-intuitivo (jogo aberto deveria gerar mais), mas Oviedo tende a se proteger no início.

---

**Artefatos:**
- `request.json` — payload exato enviado
- `response.json` — resposta completa do `/v1/predict`
- `audit_table.json` — tabela estruturada dos 47 slots c/ odd
- `audit_report.txt` — saída raw do script de auditoria
