# Analise dos mercados preferidos

Data do estudo: 2026-05-19

## Metodo
- Mesma metodologia do estudo anterior: uma odd canonica por `id_confronto + mercado_key`, usando a odd mais recente do banco.
- Exclui `legacy_raw_*`, odds <= 1.00 e odds >= 50.
- Duas leituras: `all_*` mede toda linha casada com settlement; `value_*` mede apenas quando `EV >= 3%` e `edge >= 2pp`.
- O split por liga usa apenas segmentos com `n>=20`; chutes no gol por liga usa `n>=15`.
- A analise `Over 1.5 + Under 3.5` usa duas singles no mesmo jogo; nao e odd real de bet builder. Nao trate o produto como cotacao bookline.

## Leitura curta
- `Over 1.5 gols` tem acerto alto no bruto, mas ficou negativo tanto sem filtro quanto com filtro de valor. No banco atual, nao substitui `BTTS Sim` como regra estatistica.
- `Under 3.5 gols` e muito estavel em acerto, mas tambem quase break-even. Funciona melhor como filtro de roteiro/conservador do que como regra isolada.
- `BTTS Sim` segue mais forte que `Over 1.5` como bolso estatistico neste banco: ROI positivo tanto no bruto quanto no filtro de valor.
- `Under 10.5/11.5 escanteios` nao validou como regra geral. `Under 11.5` e melhor que `Under 10.5`, mas ficou praticamente neutro.
- Chutes no gol tem sinal, mas bem seletivo: `Under 7.5 FT` apareceu forte com amostra curta; `Under 8.5 FT` e o candidato mais usavel por volume; `Under 9.5 FT` ficou perto de zero; HT under 4.5 tem acerto razoavel mas ROI negativo.

## Mercados alvo - all vs filtro de valor
| market_key | verdict | all_n | all_hit_rate | all_avg_odd | all_roi | all_profit | value_n | value_hit_rate | value_avg_odd | value_roi | value_roi_ci_low | value_roi_ci_high | value_profit | value_league_segments_n | value_league_positive_n |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| btts_total_ft_sim | VALIDADO_FORTE | 1007 | 56.4% | 1.88 | 6.4% | 64.3 | 283 | 54.4% | 2.23 | 21.7% | 8.6% | 34.9% | 61.5 | 7 | 6 |
| btts_total_ft_nao | VALIDADO_FORTE | 1007 | 43.6% | 2.57 | 10.6% | 106.4 | 884 | 43.8% | 2.62 | 13.0% | 4.4% | 21.6% | 114.9 | 13 | 12 |
| escanteios_total_ft_under_11_5 | POSITIVO_FRAGIL | 932 | 71.5% | 1.38 | -1.9% | -18.2 | 402 | 74.1% | 1.38 | 1.1% | -4.8% | 7.0% | 4.3 | 12 | 6 |
| escanteios_total_ft_under_10_5 | NAO_VALIDADO | 942 | 61.5% | 1.59 | -3.6% | -34.0 | 372 | 64.2% | 1.57 | -0.2% | -7.8% | 7.4% | -0.7 | 11 | 6 |
| gols_total_ft_under_3_5 | NAO_VALIDADO | 902 | 71.7% | 1.41 | -0.5% | -4.6 | 310 | 69.7% | 1.44 | -0.7% | -8.2% | 6.7% | -2.3 | 9 | 4 |
| gols_total_ft_over_1_5 | NAO_VALIDADO | 850 | 74.2% | 1.34 | -1.2% | -10.0 | 236 | 67.8% | 1.35 | -9.3% | -17.4% | -1.3% | -22.0 | 3 | 1 |

## Por temporada - filtro de valor
| market_key | segment | n | hit_rate | avg_odd | roi | profit | roi_ci_low | roi_ci_high |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| btts_total_ft_nao | 2026 | 233 | 46.8% | 2.47 | 14.4% | 33.7 | -1.4% | 30.3% |
| btts_total_ft_nao | 2025/2026 | 651 | 42.7% | 2.68 | 12.5% | 81.2 | 2.3% | 22.7% |
| btts_total_ft_sim | 2026 | 26 | 65.4% | 2.33 | 51.7% | 13.4 | 8.4% | 94.9% |
| btts_total_ft_sim | 2025/2026 | 257 | 53.3% | 2.22 | 18.7% | 48.1 | 5.0% | 32.4% |
| escanteios_total_ft_under_10_5 | 2026 | 58 | 70.7% | 1.53 | 6.4% | 3.7 | -11.7% | 24.4% |
| escanteios_total_ft_under_10_5 | 2025/2026 | 314 | 63.1% | 1.58 | -1.4% | -4.4 | -9.8% | 7.0% |
| escanteios_total_ft_under_11_5 | 2026 | 66 | 81.8% | 1.37 | 10.7% | 7.0 | -2.2% | 23.5% |
| escanteios_total_ft_under_11_5 | 2025/2026 | 336 | 72.6% | 1.38 | -0.8% | -2.7 | -7.4% | 5.7% |
| gols_total_ft_over_1_5 | 2026 | 93 | 68.8% | 1.42 | -3.2% | -3.0 | -16.6% | 10.2% |
| gols_total_ft_over_1_5 | 2025/2026 | 143 | 67.1% | 1.30 | -13.3% | -19.1 | -23.3% | -3.3% |
| gols_total_ft_under_3_5 | 2026 | 22 | 81.8% | 1.28 | 4.6% | 1.0 | -16.1% | 25.3% |
| gols_total_ft_under_3_5 | 2025/2026 | 288 | 68.8% | 1.46 | -1.1% | -3.3 | -9.1% | 6.8% |

## Melhores ligas - filtro de valor
| market_key | segment | n | hit_rate | avg_odd | roi | profit | roi_ci_low | roi_ci_high |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| btts_total_ft_sim | brasileirao | 26 | 65.4% | 2.33 | 51.7% | 13.4 | 8.4% | 94.9% |
| btts_total_ft_sim | ligue-1 | 29 | 62.1% | 2.30 | 46.6% | 13.5 | 4.3% | 88.9% |
| btts_total_ft_sim | la-liga-2 | 28 | 64.3% | 2.21 | 40.6% | 11.4 | 1.3% | 79.8% |
| btts_total_ft_sim | championship | 31 | 51.6% | 2.21 | 15.5% | 4.8 | -24.2% | 55.1% |
| btts_total_ft_nao | serie-a | 69 | 59.4% | 2.57 | 50.0% | 34.5 | 19.8% | 80.1% |
| btts_total_ft_nao | serie-b-italia | 69 | 49.3% | 2.70 | 30.8% | 21.2 | -1.0% | 62.6% |
| btts_total_ft_nao | premier-league | 53 | 43.4% | 2.75 | 17.9% | 9.5 | -19.0% | 54.7% |
| btts_total_ft_nao | la-liga | 86 | 43.0% | 2.68 | 15.6% | 13.4 | -13.0% | 44.2% |
| gols_total_ft_over_1_5 | brasileirao | 48 | 77.1% | 1.34 | 3.7% | 1.8 | -12.4% | 19.7% |
| gols_total_ft_over_1_5 | superliga-argentina | 29 | 62.1% | 1.53 | -5.4% | -1.6 | -32.5% | 21.7% |
| gols_total_ft_over_1_5 | la-liga | 20 | 60.0% | 1.32 | -21.1% | -4.2 | -49.4% | 7.3% |
| gols_total_ft_under_3_5 | championship | 48 | 81.2% | 1.40 | 13.4% | 6.4 | -2.4% | 29.1% |
| gols_total_ft_under_3_5 | serie-a | 23 | 78.3% | 1.37 | 6.7% | 1.6 | -16.6% | 30.0% |
| gols_total_ft_under_3_5 | premier-league | 28 | 67.9% | 1.53 | 5.9% | 1.6 | -21.7% | 33.5% |
| gols_total_ft_under_3_5 | la-liga | 32 | 71.9% | 1.46 | 3.9% | 1.3 | -19.5% | 27.3% |
| escanteios_total_ft_under_10_5 | serie-a | 23 | 82.6% | 1.46 | 20.1% | 4.6 | -2.5% | 42.7% |
| escanteios_total_ft_under_10_5 | la-liga-2 | 42 | 73.8% | 1.51 | 11.2% | 4.7 | -8.9% | 31.3% |
| escanteios_total_ft_under_10_5 | serie-b-italia | 24 | 70.8% | 1.53 | 8.6% | 2.1 | -19.4% | 36.6% |
| escanteios_total_ft_under_10_5 | la-liga | 42 | 66.7% | 1.57 | 3.5% | 1.5 | -18.7% | 25.8% |
| escanteios_total_ft_under_11_5 | brasileirao | 21 | 81.0% | 1.48 | 18.2% | 3.8 | -6.4% | 42.8% |
| escanteios_total_ft_under_11_5 | serie-a | 26 | 88.5% | 1.28 | 13.5% | 3.5 | -2.3% | 29.3% |
| escanteios_total_ft_under_11_5 | la-liga-2 | 44 | 84.1% | 1.33 | 11.7% | 5.1 | -2.7% | 26.1% |
| escanteios_total_ft_under_11_5 | superliga-argentina | 32 | 87.5% | 1.25 | 9.0% | 2.9 | -5.3% | 23.3% |

## Piores ligas - filtro de valor
| market_key | segment | n | hit_rate | avg_odd | roi | profit | roi_ci_low | roi_ci_high |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| btts_total_ft_sim | la-liga | 33 | 42.4% | 2.26 | -6.5% | -2.1 | -43.9% | 30.9% |
| btts_total_ft_sim | premier-league | 49 | 49.0% | 2.22 | 9.2% | 4.5 | -22.4% | 40.7% |
| btts_total_ft_sim | bundesliga | 35 | 54.3% | 2.09 | 12.1% | 4.2 | -22.2% | 46.5% |
| btts_total_ft_nao | bundesliga | 53 | 24.5% | 2.81 | -30.9% | -16.4 | -64.1% | 2.4% |
| btts_total_ft_nao | championship | 98 | 39.8% | 2.66 | 2.1% | 2.1 | -23.4% | 27.6% |
| btts_total_ft_nao | liga-mx | 40 | 37.5% | 2.75 | 3.4% | 1.3 | -39.3% | 46.0% |
| gols_total_ft_over_1_5 | la-liga | 20 | 60.0% | 1.32 | -21.1% | -4.2 | -49.4% | 7.3% |
| gols_total_ft_over_1_5 | superliga-argentina | 29 | 62.1% | 1.53 | -5.4% | -1.6 | -32.5% | 21.7% |
| gols_total_ft_over_1_5 | brasileirao | 48 | 77.1% | 1.34 | 3.7% | 1.8 | -12.4% | 19.7% |
| gols_total_ft_under_3_5 | bundesliga | 28 | 42.9% | 1.68 | -29.0% | -8.1 | -60.1% | 2.1% |
| gols_total_ft_under_3_5 | primeira-liga | 23 | 56.5% | 1.49 | -15.7% | -3.6 | -46.8% | 15.5% |
| gols_total_ft_under_3_5 | ligue-1 | 22 | 63.6% | 1.52 | -2.4% | -0.5 | -33.7% | 29.0% |
| escanteios_total_ft_under_10_5 | ligue-1 | 29 | 51.7% | 1.55 | -21.0% | -6.1 | -48.9% | 6.8% |
| escanteios_total_ft_under_10_5 | liga-mx | 26 | 53.8% | 1.60 | -13.8% | -3.6 | -44.6% | 16.9% |
| escanteios_total_ft_under_10_5 | bundesliga | 32 | 56.2% | 1.63 | -11.1% | -3.5 | -38.3% | 16.2% |
| escanteios_total_ft_under_11_5 | liga-mx | 26 | 61.5% | 1.39 | -14.4% | -3.7 | -40.5% | 11.7% |
| escanteios_total_ft_under_11_5 | championship | 39 | 61.5% | 1.46 | -10.2% | -4.0 | -32.5% | 12.2% |
| escanteios_total_ft_under_11_5 | bundesliga | 32 | 65.6% | 1.41 | -9.1% | -2.9 | -32.0% | 13.7% |

## Chutes no gol
| market_key | all_n | all_hit_rate | all_avg_odd | all_roi | value_n | value_hit_rate | value_avg_odd | value_roi | value_roi_ci_low | value_roi_ci_high | value_profit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| chutes_alvo_total_ft_over_10_5 | 232 | 38.4% | 2.75 | 0.4% | 4 | 75.0% | 3.36 | 155.0% | 9.4% | 300.6% | 6.2 |
| chutes_alvo_total_ft_under_6_5 | 233 | 29.6% | 3.00 | -14.6% | 3 | 66.7% | 3.59 | 125.7% | -61.1% | 312.4% | 3.8 |
| chutes_alvo_total_ft_under_7_5 | 517 | 43.7% | 2.28 | -1.4% | 44 | 54.5% | 2.56 | 42.6% | 3.3% | 81.9% | 18.7 |
| chutes_alvo_total_ft_under_8_5 | 624 | 49.8% | 1.87 | -8.5% | 165 | 51.5% | 2.07 | 5.0% | -10.8% | 20.8% | 8.2 |
| chutes_alvo_total_ft_over_6_5 | 209 | 68.9% | 1.34 | -8.6% | 54 | 72.2% | 1.42 | 2.1% | -15.0% | 19.2% | 1.1 |
| chutes_alvo_total_ft_under_9_5 | 475 | 60.4% | 1.58 | -6.8% | 134 | 57.5% | 1.83 | 0.1% | -14.7% | 14.9% | 0.1 |
| chutes_alvo_total_ht_under_4_5 | 154 | 57.8% | 1.70 | -3.0% | 154 | 57.8% | 1.70 | -3.0% | -16.1% | 10.2% | -4.6 |
| chutes_alvo_total_ht_under_3_5 | 571 | 48.2% | 1.95 | -6.6% | 406 | 48.0% | 1.99 | -4.9% | -14.5% | 4.8% | -19.7 |
| chutes_alvo_total_ft_over_7_5 | 516 | 56.2% | 1.58 | -11.9% | 105 | 55.2% | 1.71 | -5.2% | -21.7% | 11.2% | -5.5 |
| chutes_alvo_total_ft_over_9_5 | 477 | 39.4% | 2.30 | -12.5% | 48 | 33.3% | 2.83 | -7.3% | -44.8% | 30.2% | -3.5 |
| chutes_alvo_total_ft_over_8_5 | 624 | 50.2% | 1.88 | -7.4% | 104 | 42.3% | 2.16 | -9.2% | -29.7% | 11.3% | -9.6 |
| chutes_alvo_total_ft_under_10_5 | 221 | 62.4% | 1.43 | -13.6% | 84 | 52.4% | 1.61 | -19.1% | -35.8% | -2.3% | -16.0 |
| chutes_alvo_total_ht_over_3_5 | 571 | 51.8% | 1.77 | -9.0% | 0 |  |  |  |  |  | 0.0 |
| chutes_alvo_total_ht_over_4_5 | 154 | 42.2% | 2.04 | -15.5% | 0 |  |  |  |  |  | 0.0 |

## Over 1.5 vs BTTS Sim vs Under 3.5
| pattern | matches | over15_hit_rate | over15_roi | btts_sim_hit_rate | btts_sim_roi | under35_hit_rate | under35_roi | dual_over15_under35_roi_per_stake | goals_2_or_3_rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| btts_value_over15_not_value | 136 | 72.8% | -7.5% | 52.9% | 20.9% | 73.5% | 2.3% | -2.6% | 46.3% |
| btts_sim_and_under35_both_value | 34 | 73.5% | -8.9% | 47.1% | 10.1% | 73.5% | 6.0% | -1.4% | 47.1% |
| over15_value_btts_not_value | 132 | 70.5% | -5.8% | 49.2% | -18.0% | 74.2% | -4.4% | -5.1% | 44.7% |

## Decisao para mesa
- `BTTS Sim`: manter como regra candidata principal, mas nao cega; exigir valor operacional e liga favoravel.
- `Over 1.5 gols`: nao promover como substituto do `BTTS Sim` neste banco. Pode ajudar como leitura de roteiro, mas como pick isolada ficou negativa ate quando o filtro de valor sinalizou entrada.
- `Under 3.5 gols`: bom filtro de protecao de roteiro, nao pick principal por si so. Pode compor leitura de jogo com placar esperado 2-3 gols, mas bet builder precisa de cotacao real.
- `Under 11.5 escanteios`: melhor que `Under 10.5`, mas ainda fraco; usar so por liga favoravel. `Under 10.5` ficou negativo no filtro geral.
- `Chutes no gol`: priorizar estudo segmentado em `chutes_alvo_total_ft_under_7_5` e `under_8_5`; tratar `under_9_5` como neutro e evitar HT under como regra enquanto ROI estiver negativo.

## Arquivos
- `audit/preference-markets-2026-05-19/target_market_summary.csv`
- `audit/preference-markets-2026-05-19/target_by_league_value.csv`
- `audit/preference-markets-2026-05-19/target_by_season_value.csv`
- `audit/preference-markets-2026-05-19/target_by_league_season_value.csv`
- `audit/preference-markets-2026-05-19/target_odds_ranges_value.csv`
- `audit/preference-markets-2026-05-19/shots_on_target_summary.csv`
- `audit/preference-markets-2026-05-19/shots_on_target_by_league_value.csv`
- `audit/preference-markets-2026-05-19/goal_replacement_overlap.csv`
