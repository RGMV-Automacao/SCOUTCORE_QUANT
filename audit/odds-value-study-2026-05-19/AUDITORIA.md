# Estudo de odds, valor e acerto

Data do estudo: 2026-05-19

## Premissas honestas
- Uma aposta por `id_confronto + mercado_key`: usei a odd mais recente no banco; quando havia mais de uma linha no mesmo timestamp, usei a media da odd.
- Exclui `legacy_raw_*`, odds <= 1.00 e odds >= 50.
- `Valor` aqui significa valor pelo modelo/backtest: `fair_prob * odd - 1 > 0`. O filtro operacional usado nas tabelas principais e `EV >= 3%` e `edge >= 2pp`.
- A massa grande de odds e majoritariamente `legacy-bookline-import-v1`; isso permite estudar associacao historica, mas nao prova que a odd estava disponivel pre-kickoff em todos os casos.
- O estudo mede acerto/ROI flat em linhas que casaram com `backtest_eval.observed`; nao e recomendacao automatica de aposta.

## Cobertura
- `odds_rows`: 1706069
- `legacy_raw_rows`: 1564821
- `canonical_pairs`: 113548
- `joined_pairs`: 67607
- `joined_matches`: 1008
- `joined_market_keys`: 194
- `outcome_matches`: 14186
- `eval_rows`: 5152024
- `study_rows`: 67607
- `value_ev_gt_0_rows`: 25006
- `value_operational_rows`: 20324
- `pre_date_sane_rows`: 67070
- `value_operational_pre_date_sane_rows`: 20147

## Leitura executiva
- Base estudavel real: `67.607` pares resolvidos `confronto + mercado_key`, nao os `1,7M` brutos. O motivo e que `1.564.821` linhas ainda sao `legacy_raw_*` e nao entram no settlement canonico.
- Todos os pares casados: `49,1%` de acerto, ROI flat `-8,4%`.
- Valor simples (`EV > 0` e edge positivo): `25.006` entradas, `51,5%` de acerto, ROI `-6,1%`.
- Valor operacional (`EV >= 3%` e `edge >= 2pp`): `20.324` entradas, `51,4%` de acerto, ROI `-6,1%`.
- Conclusao direta: range de odd sozinho nao achou lucro. Oportunidade aparece em mercados especificos, principalmente `BTTS`, alguns `chutes`, alguns `chutes_alvo` e poucos `escanteios FT`; varios mercados frequentes de valor pelo modelo deram ROI negativo.
- Melhor range por acerto com amostra grande foi `1.20-1.50` (`72,5%` no range sobreposto), mas ficou abaixo do breakeven medio e deu ROI negativo. O range `1.01-1.20` ficou positivo, mas tem so `16` entradas e nao deve ser usado como evidencia.

## Odds ranges - filtro operacional de valor
| odds_range | n | wins | hit_rate | avg_odd | avg_fair_prob | avg_ev | avg_edge | roi | profit | breakeven |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1.01-1.20 | 16 | 15 | 93.8% | 1.14 | 92.4% | 5.4% | 4.7% | 7.1% | 1.1 | 87.6% |
| 1.20-1.50 | 5437 | 3946 | 72.6% | 1.34 | 82.9% | 10.4% | 7.7% | -3.6% | -194.5 | 74.9% |
| 1.50-1.70 | 2641 | 1630 | 61.7% | 1.60 | 72.4% | 15.4% | 9.7% | -1.6% | -41.0 | 62.6% |
| 1.70-1.90 | 2674 | 1400 | 52.4% | 1.79 | 66.4% | 18.8% | 10.5% | -6.2% | -165.5 | 55.8% |
| 1.90-2.10 | 2228 | 1026 | 46.1% | 1.98 | 60.8% | 20.6% | 10.4% | -8.8% | -195.8 | 50.4% |
| 2.10-2.50 | 2626 | 1117 | 42.5% | 2.26 | 55.4% | 24.7% | 10.9% | -4.1% | -108.3 | 44.3% |
| 2.50-3.00 | 2018 | 711 | 35.2% | 2.71 | 48.2% | 30.2% | 11.2% | -4.7% | -95.4 | 37.0% |
| 3.00-4.00 | 1634 | 412 | 25.2% | 3.39 | 39.0% | 31.6% | 9.4% | -15.2% | -248.4 | 29.5% |
| 4.00+ | 1050 | 189 | 18.0% | 4.89 | 29.9% | 40.2% | 8.1% | -18.6% | -195.5 | 20.4% |

## Ranges sobrepostos pedidos
| odds_range | n | wins | hit_rate | avg_odd | avg_fair_prob | avg_ev | avg_edge | roi | profit | breakeven |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1.20-1.50 | 5560 | 4029 | 72.5% | 1.34 | 82.8% | 10.4% | 7.7% | -3.5% | -193.0 | 74.7% |
| 1.30-1.70 | 6187 | 4052 | 65.5% | 1.49 | 76.6% | 13.3% | 8.9% | -3.2% | -199.4 | 67.3% |
| 1.40-1.80 | 5853 | 3554 | 60.7% | 1.60 | 72.5% | 15.4% | 9.6% | -3.7% | -214.0 | 62.6% |
| 1.50-2.00 | 6750 | 3710 | 55.0% | 1.75 | 67.7% | 17.8% | 10.1% | -4.7% | -317.8 | 57.2% |
| 1.60-2.20 | 7362 | 3742 | 50.8% | 1.87 | 64.2% | 19.5% | 10.4% | -5.6% | -413.2 | 53.3% |
| 1.70-2.50 | 7628 | 3583 | 47.0% | 2.02 | 60.8% | 21.5% | 10.6% | -6.2% | -469.6 | 49.6% |
| 2.00-3.00 | 5826 | 2329 | 40.0% | 2.39 | 53.4% | 26.0% | 10.9% | -5.7% | -331.2 | 41.9% |
| 2.50-4.00 | 3767 | 1146 | 30.4% | 3.04 | 43.8% | 30.9% | 10.3% | -9.7% | -366.8 | 32.9% |

## Mercados com mais ocorrencias de valor operacional
| market_key | family | direction | n | wins | hit_rate | avg_odd | avg_ev | roi | profit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| btts_total_ft_nao | btts | nao | 884 | 387 | 43.8% | 2.62 | 43.8% | 13.0% | 114.9 |
| 1x2_total_ft_home | 1x2 | home | 732 | 313 | 42.8% | 2.40 | 35.9% | -9.6% | -70.0 |
| escanteios_total_ht_under_5_5 | escanteios | under | 676 | 443 | 65.5% | 1.42 | 13.4% | -7.8% | -52.8 |
| escanteios_total_ht_under_4_5 | escanteios | under | 639 | 326 | 51.0% | 1.81 | 18.6% | -9.0% | -57.2 |
| cartoes_total_ht_under_1_5 | cartoes | under | 588 | 320 | 54.4% | 1.86 | 16.5% | -1.5% | -8.8 |
| escanteios_total_ht_under_3_5 | escanteios | under | 537 | 175 | 32.6% | 2.60 | 24.5% | -16.7% | -89.5 |
| dupla_total_ft_1x | dupla_chance | other | 532 | 356 | 66.9% | 1.52 | 17.0% | -1.8% | -9.5 |
| gols_total_ht_under_0_5 | gols | under | 453 | 117 | 25.8% | 3.09 | 21.5% | -20.7% | -93.8 |
| gols_total_2t_over_1_5 | gols | over | 450 | 191 | 42.4% | 2.17 | 19.1% | -10.6% | -47.9 |
| escanteios_total_ht_under_6_5 | escanteios | under | 428 | 329 | 76.9% | 1.24 | 9.5% | -5.2% | -22.2 |
| gols_total_ht_under_1_5 | gols | under | 418 | 257 | 61.5% | 1.49 | 10.4% | -9.6% | -40.3 |
| chutes_alvo_total_ht_under_3_5 | chutes_alvo | under | 406 | 195 | 48.0% | 1.99 | 14.1% | -4.9% | -19.7 |
| escanteios_total_ft_under_11_5 | escanteios | under | 402 | 298 | 74.1% | 1.38 | 12.3% | 1.1% | 4.3 |
| cartoes_total_ft_under_5_5 | cartoes | under | 392 | 238 | 60.7% | 1.65 | 17.2% | -2.9% | -11.2 |
| escanteios_total_ft_under_10_5 | escanteios | under | 372 | 239 | 64.2% | 1.57 | 15.7% | -0.2% | -0.7 |

## Mercados de valor por ROI - min 80 ocorrencias
| market_key | family | direction | n | wins | hit_rate | avg_odd | avg_ev | roi | profit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| btts_total_ft_sim | btts | sim | 283 | 154 | 54.4% | 2.23 | 20.0% | 21.7% | 61.5 |
| 1x2_total_ft_draw | 1x2 | draw | 96 | 31 | 32.3% | 3.77 | 18.0% | 21.6% | 20.7 |
| cartoes_total_ht_under_0_5 | cartoes | under | 111 | 36 | 32.4% | 3.70 | 20.1% | 16.9% | 18.8 |
| btts_total_ft_nao | btts | nao | 884 | 387 | 43.8% | 2.62 | 43.8% | 13.0% | 114.9 |
| chutes_total_ft_over_26_5 | chutes | over | 112 | 62 | 55.4% | 2.00 | 27.5% | 9.8% | 11.0 |
| chutes_alvo_total_ft_under_8_5 | chutes_alvo | under | 165 | 85 | 51.5% | 2.07 | 13.3% | 5.0% | 8.2 |
| chutes_total_ft_over_25_5 | chutes | over | 137 | 77 | 56.2% | 1.87 | 24.8% | 4.5% | 6.2 |
| escanteios_total_ft_over_9_5 | escanteios | over | 308 | 175 | 56.8% | 1.84 | 19.2% | 2.9% | 8.8 |
| escanteios_total_ft_under_11_5 | escanteios | under | 402 | 298 | 74.1% | 1.38 | 12.3% | 1.1% | 4.3 |
| chutes_alvo_total_ft_under_9_5 | chutes_alvo | under | 134 | 77 | 57.5% | 1.83 | 15.2% | 0.1% | 0.1 |
| escanteios_total_ft_under_10_5 | escanteios | under | 372 | 239 | 64.2% | 1.57 | 15.7% | -0.2% | -0.7 |
| gols_total_ft_under_3_5 | gols | under | 310 | 216 | 69.7% | 1.44 | 11.9% | -0.7% | -2.3 |
| chutes_total_ft_under_23_5 | chutes | under | 109 | 53 | 48.6% | 2.07 | 29.7% | -1.1% | -1.2 |
| cartoes_total_ht_under_2_5 | cartoes | under | 140 | 104 | 74.3% | 1.35 | 14.2% | -1.4% | -2.0 |
| cartoes_total_ht_under_1_5 | cartoes | under | 588 | 320 | 54.4% | 1.86 | 16.5% | -1.5% | -8.8 |

## Familia + direcao - min 150 ocorrencias
| group | n | wins | hit_rate | avg_odd | avg_ev | roi | profit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| btts|sim | 285 | 155 | 54.4% | 2.27 | 20.1% | 23.3% | 66.3 |
| btts|nao | 884 | 387 | 43.8% | 2.62 | 43.8% | 13.0% | 114.9 |
| chutes|over | 887 | 479 | 54.0% | 1.87 | 23.4% | -0.3% | -2.5 |
| chutes_alvo|under | 1022 | 533 | 52.2% | 1.93 | 15.6% | -1.6% | -16.8 |
| cartoes|under | 2146 | 1165 | 54.3% | 1.98 | 17.9% | -2.9% | -62.2 |
| chutes_alvo|over | 315 | 160 | 50.8% | 2.00 | 11.3% | -3.6% | -11.3 |
| dupla_chance|other | 1324 | 892 | 67.4% | 1.48 | 12.8% | -3.8% | -50.8 |
| escanteios|over | 1870 | 975 | 52.1% | 2.16 | 19.9% | -4.5% | -83.4 |
| escanteios|under | 4515 | 2489 | 55.1% | 1.95 | 18.0% | -7.6% | -342.1 |
| chutes|under | 876 | 443 | 50.6% | 1.86 | 23.2% | -7.7% | -67.2 |
| 1x2|home | 737 | 315 | 42.7% | 2.40 | 35.9% | -9.3% | -68.6 |
| impedimentos|under | 187 | 92 | 49.2% | 1.85 | 19.1% | -13.2% | -24.7 |
| gols|under | 2265 | 1050 | 46.4% | 2.26 | 17.4% | -14.6% | -331.7 |
| gols|over | 2079 | 886 | 42.6% | 2.61 | 21.8% | -14.7% | -306.3 |
| cartoes|over | 376 | 178 | 47.3% | 2.04 | 13.9% | -14.9% | -56.2 |
| impedimentos|over | 216 | 102 | 47.2% | 1.85 | 20.1% | -15.7% | -34.0 |

## Ligas - valor operacional min 100 ocorrencias
| liga | n | wins | hit_rate | avg_odd | avg_ev | roi | profit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| serie-b-italia | 1102 | 603 | 54.7% | 2.12 | 20.9% | 1.0% | 11.4 |
| la-liga-2 | 1584 | 853 | 53.9% | 2.11 | 20.4% | -1.1% | -17.8 |
| la-liga | 2125 | 1163 | 54.7% | 2.04 | 19.6% | -1.5% | -30.9 |
| serie-a | 1560 | 814 | 52.2% | 2.10 | 19.0% | -2.1% | -33.3 |
| brasileirao | 2460 | 1332 | 54.1% | 2.15 | 19.9% | -2.3% | -57.7 |
| superliga-argentina | 1541 | 825 | 53.5% | 2.00 | 21.2% | -3.2% | -49.1 |
| premier-league | 1905 | 977 | 51.3% | 2.13 | 19.3% | -5.1% | -96.3 |
| championship | 2025 | 1001 | 49.4% | 2.11 | 19.5% | -9.2% | -187.1 |
| liga-mx | 1164 | 571 | 49.1% | 2.11 | 23.1% | -10.3% | -120.2 |
| primeira-liga | 1188 | 583 | 49.1% | 2.11 | 25.3% | -10.6% | -125.7 |
| ligue-1 | 1381 | 657 | 47.6% | 2.10 | 18.1% | -12.0% | -166.2 |
| bundesliga | 1624 | 766 | 47.2% | 2.08 | 18.3% | -14.3% | -231.9 |
| brasileirao-b | 665 | 301 | 45.3% | 2.29 | 25.2% | -20.8% | -138.3 |

## EV bands - todas as linhas casadas
| ev_range | n | wins | hit_rate | avg_odd | avg_ev | roi | profit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| -1000% to 0% | 42601 | 20293 | 47.6% | 2.28 | -22.9% | -9.8% | -4159.7 |
| 0% to 3% | 3612 | 2094 | 58.0% | 1.87 | 1.5% | -4.1% | -147.6 |
| 3% to 6% | 3425 | 1952 | 57.0% | 1.86 | 4.5% | -5.7% | -195.8 |
| 6% to 10% | 4014 | 2291 | 57.1% | 1.92 | 7.9% | -4.6% | -183.3 |
| 10% to 15% | 3931 | 2157 | 54.9% | 1.99 | 12.4% | -5.2% | -203.2 |
| 15% to 25% | 4759 | 2264 | 47.6% | 2.16 | 19.5% | -10.0% | -475.6 |
| 25%+ | 5265 | 2128 | 40.4% | 2.71 | 43.6% | -6.2% | -324.2 |

## Arquivos
- `audit/odds-value-study-2026-05-19/odds_ranges.csv`
- `audit/odds-value-study-2026-05-19/odds_ranges_overlapping.csv`
- `audit/odds-value-study-2026-05-19/top_value_markets.csv`
- `audit/odds-value-study-2026-05-19/top_value_markets_by_roi_min80.csv`
- `audit/odds-value-study-2026-05-19/family_summary_value_operational.csv`
- `audit/odds-value-study-2026-05-19/family_direction_summary_value_operational.csv`
- `audit/odds-value-study-2026-05-19/league_summary_value_operational_min100.csv`
- `audit/odds-value-study-2026-05-19/ev_bands.csv`
