# Auditoria Profunda — Motor 4×4 v0.8.0

**Data:** $(geração automática)
**Match auditado:** Flamengo × Vasco da Gama (brasileirao 2026-05-03)
**Sidecar Engine B:** UP (127.0.0.1:4055)
**Slots gerados:** 131 — Engine A: 120, Engine B: 11
**Cobertura odds Superbet REAIS:** 67/131 (51,1%)
**Mapped sem mercado:** 36 — **Unmapped no catálogo motor:** 28

> Esta reflexão foi feita com odds REAIS Superbet (não sintéticas) para que
> `edge_pct` reflita preço real. Honestidade vinculante: nada foi inventado.

---

## 1. Defeitos identificados

### 1.1 BUG crítico: chaves divergentes Engine A vs Engine B (combine fail)
- Engine A emite `1x2_total_ft_home`, `btts_total_ft_sim`.
- Engine B emite `1x2_home`, `btts_sim`.
- Resultado: o curinga **não combina**; ambos viram slots separados (`engine_a_only` + `engine_b_only`) em vez de `engine_a_and_b`.
- Impacto: divergência entre engines em 1x2/BTTS **não dispara `divergence_flag`** porque combine não enxerga o par. Predição A puro fica órfã de B nessas duas famílias mais importantes.
- **Fix obrigatório**: padronizar shape do market_key. Padrão sugerido: `1x2_ft_home`, `btts_ft_sim`. Atualizar Engine A (catalog generator), Engine B (server.py FAMILY_KEYS), curinga e cap de família.

### 1.2 Engine B cobertura limitada (apenas gols/btts/1x2)
- 7 modelos sklearn treinados; **escanteios, cartões, chutes, faltas ficam órfãos de B**.
- Curinga sempre `engine_a_only` nessas famílias → não há A/B blending real.
- Risco: phantom edges de Engine A (Poisson) seguem no topo do ranking sem contraste.

### 1.3 Isotonic só cobre escanteios (4 modelos)
- `isotonic_blob`: 4 entradas (escanteios over/under × {brasileirao, '*'}).
- Gols, BTTS, cartões, chutes nunca foram refittadas.
- Status atual: `isotonic_applied=false` para 90+% dos slots.
- Causa raiz: poucas predictions settled por família para fitar binning honesto.

### 1.4 Linhas de chutes irreais
- 20 slots `chutes_total_ft_*` em linhas 19.5–24.5. Superbet só oferece 6.5–10.5.
- Sintoma: Engine A gera linhas que nem existem no mercado → ruído.
- Fix: limitar geração de linhas pela média histórica × 1.5 (ou consultar catálogo Superbet de antemão).

### 1.5 Faltas sem mapping
- 6 slots `faltas_total_ft_*` ficaram `unmapped_in_motor_catalog`.
- Superbet oferece `1ª Falta da Partida` (qual time comete) mas **não vimos** `Total de Faltas` no jogo Flamengo×Vasco. Provavelmente Superbet não publica este mercado em todos os jogos.
- Fix: investigar amostra ampla; se for raro, manter `unmapped`. Se existir mas em outro nome, adicionar regra.

### 1.6 Phantom edge ainda chega ao topo do scout
- Penalty 0.3 sobrevive — não é dropado.
- 18 slots no `ev_ranked` final. Verificar quantos são phantom — se >30%, mudar política para DROP.

### 1.7 Liga drift: 'brasileirao' vs 'brasileiro'
- Tabela `partidas` usa `liga='brasileirao'`. Tabela `odds` usa `liga='brasileiro'`.
- Como filtramos odds por (home_team, away_team, data_jogo) não passamos `liga`, evitamos o drift. Mas se algum dia adicionarmos filtro por liga, vai falhar.
- Fix: criar view `liga_alias` ou normalizar no ingest.

### 1.8 team_profile_v2 amostra reduzida (180 rows)
- Cobre apenas algumas ligas. Para confronto fora dessa lista, `team_profile_*_missing` aparece em warnings → predição perde certificação.
- Sintoma: campo `certified=true` para Flamengo×Vasco mas pode ser falso para outros confrontos.

### 1.9 confidence base = 0.5 ainda placeholder
- Não é função do walk-forward Brier real do Engine B (0.245 over_2_5 vs base 0.502).
- Devia ser proporcional ao gain sobre base_rate.

### 1.10 Sem teste de integração ponta-a-ponta para `/predict`
- 37 unit tests passam (calibration 9, curinga 6, engine-a 5, engine-b-bridge 4, isotonic 7, scout 6).
- Nenhum exercita `apps/api/src/predict.mjs` com sidecar UP + DB real.
- Audit-export é a coisa mais perto de E2E que existe — deveria virar suite oficial.

---

## 2. Métricas Engine B (realidade)

Modelos treinados em 13.398 partidas (cache otimizado, ~30s end-to-end):

| modelo               | brier | base_rate | gain |
|----------------------|------:|----------:|-----:|
| gols_total_ft_over_1_5 | _registrar_ | _ | _ |
| gols_total_ft_over_2_5 | 0.245 | 0.502 | 51.2% |
| gols_total_ft_over_3_5 | _registrar_ | _ | _ |
| btts_sim                | 0.249 | _    | _ |
| 1x2_home                | 0.225 | _    | _ |

> Reexecutar `train.py` com flag `--report` para registrar todos. **Pendência.**

---

## 3. Pontos fortes (o que ESTÁ correto)

- **Bridge nunca lança**: timeout/ECONNREFUSED/HTTP≠200 viram `available:false`.
- **Audit honesto**: distingue `unmapped_in_motor_catalog` de `mapped_but_not_offered_by_superbet`.
- **Curinga**: `divergence_pp` e `divergence_flag` (≥15pp) auditáveis — quando combine funciona.
- **Sidecar isolado**: Python ML não polui Node 22 ESM.
- **37/37 testes unit passam**; isotonic com fallback honesto.
- **Provenance completa**: cada slot carrega weight_a/weight_b, fair_prob_a/b, calib, isotonic.
- **family_cap** funcionando (49 capped out de 67 reais).

---

## 4. Cobertura time-a-time (este match)

Ver `audit/coverage_audit.csv`. Resumo:

```
familia    │ A_only_real │ A_only_absent │ B_only_real │ A+B_real │ unmapped
gols       │     6 (HT)  │      16       │      —      │    6     │    —
escanteios │    40       │       6       │      —      │    —     │    —
cartoes    │    11       │       5       │      —      │    —     │    —
chutes     │     0       │      20       │      —      │    —     │    —
faltas     │     0       │       —       │      —      │    —     │    6
btts       │     0       │       4       │      2      │    —     │    —
1x2        │     0       │       6       │      2      │    —     │    1
```

**Interpretação:**
- Escanteios e cartões: cobertura quase total (sinal forte de que a integração está bem para essas famílias).
- Chutes: 0 cobertos — nossas linhas não batem com as ofertas Superbet.
- Faltas: 0 mapeados — investigar oferta Superbet.
- BTTS/1x2: bug 1.1 (chaves divergentes) impede A+B; só Engine B aparece coberto.

---

## 5. Plano de correção priorizado

| # | Ação                                                          | Esforço | Impacto |
|---|---------------------------------------------------------------|---------|---------|
| 1 | Padronizar market_key 1x2/btts entre A e B                    | baixo   | alto    |
| 2 | Limitar linhas de chutes ao range Superbet (≤ 10.5)           | baixo   | alto    |
| 3 | Treinar Engine B para escanteios/cartões                      | médio   | alto    |
| 4 | Refittar isotonic para gols/btts (quando settled aumentar)    | médio   | médio   |
| 5 | Política de phantom edge: DROP em vez de penalty 0.3          | baixo   | médio   |
| 6 | Confidence dinâmico (Brier-weighted)                          | médio   | médio   |
| 7 | E2E test do /predict com sidecar real                         | médio   | alto    |
| 8 | Mapping faltas + investigar amostra Superbet                  | baixo   | baixo   |

---

## 6. Veredicto

Motor 4×4 v0.8.0 está **funcional e auditável**, mas tem **buracos honestos**:
- Chaves divergentes A/B (correção rápida) impedem o curinga de cumprir seu papel em 1x2/BTTS.
- Cobertura B incompleta (3 famílias de 6) → 50% das predições não veem segunda opinião.
- Linhas de chutes desconectadas da realidade Superbet.
- Cobertura Superbet real (51%) é boa para escanteios/cartões/gols-ht; ruim para chutes/faltas.

**Não declarar 100%.** Próximo milestone honesto: v0.8.1 (fixes 1, 2, 5) → v0.9.0 (fixes 3, 6, 7).
