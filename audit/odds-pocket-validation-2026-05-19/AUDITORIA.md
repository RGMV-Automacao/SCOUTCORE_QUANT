# Validacao dos bolsoes por liga, temporada e casa/fora

Data do estudo: 2026-05-19

## Metodo
- Entrada: os mercados com ROI positivo e pelo menos 80 ocorrencias no estudo anterior, sempre dentro do filtro operacional `EV >= 3%` e `edge >= 2pp`.
- Usei uma linha por `id_confronto + mercado_key`, pegando a odd mais recente canonica do banco.
- Segmentos minimos: liga `n>=20`, temporada `n>=20`, liga-temporada `n>=15`, mandante/visitante `n>=5`.
- `split casa/fora` aqui significa performance do mesmo mercado quando determinado time aparece como mandante ou visitante. Para mercados totais/BTTS isso e um split contextual, nao uma selecao home/away.
- O intervalo `roi_ci_low/high` e uma aproximacao normal sobre lucro flat por unidade. Se o intervalo cruza zero, o bolso ainda nao esta estatisticamente fechado.

## Leitura curta
- Dois bolsoes passaram no criterio forte deste corte: `BTTS Sim` e `BTTS Nao`, ambos com intervalo aproximado de ROI acima de zero.
- `BTTS Sim` e o melhor candidato operacional: ROI `+21,7%`, 283 entradas, 6/7 ligas positivas, 2/2 temporadas positivas e baixa concentracao por liga.
- `BTTS Nao` tem o maior lucro absoluto: ROI `+13,0%`, 884 entradas, 12/13 ligas positivas, 2/2 temporadas positivas e baixa concentracao por liga.
- `Chutes FT Over 26.5` e `Chutes FT Over 25.5` parecem oportunidades reais de nicho, mas com amostra curta e forte dependencia de liga/time.
- `Escanteios FT Over 9.5` e `Under 11.5` sao quase neutros: positivos no agregado, mas fracos para virar regra geral.
- `Chutes no Gol Under 9.5` foi praticamente break-even; eu nao promoveria a regra.
- Split mandante/visitante por time existe, mas e exploratorio: mesmo com `n>=5`, varios mercados ficam sem amostra suficiente por time.

## Resumo por bolso
| market_key | verdict | n | hit_rate | avg_odd | roi | roi_ci_low | roi_ci_high | profit | league_segments_n | league_segments_positive | league_positive_share | top_liga | top_liga_share | season_segments_n | season_segments_positive |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| btts_total_ft_sim | VALIDADO_FORTE | 283 | 54.4% | 2.23 | 21.7% | 8.6% | 34.9% | 61.5 | 7 | 6 | 85.7% | premier-league | 17.3% | 2 | 2 |
| btts_total_ft_nao | VALIDADO_FORTE | 884 | 43.8% | 2.62 | 13.0% | 4.4% | 21.6% | 114.9 | 13 | 12 | 92.3% | brasileirao | 12.4% | 2 | 2 |
| cartoes_total_ht_under_0_5 | PROMISSOR_SEGMENTAR | 111 | 32.4% | 3.70 | 16.9% | -14.9% | 48.7% | 18.8 | 3 | 2 | 66.7% | ligue-1 | 28.8% | 1 | 1 |
| chutes_total_ft_over_26_5 | PROMISSOR_SEGMENTAR | 112 | 55.4% | 2.00 | 9.8% | -8.8% | 28.4% | 11.0 | 1 | 1 | 100.0% | brasileirao | 35.7% | 2 | 2 |
| chutes_alvo_total_ft_under_8_5 | PROMISSOR_SEGMENTAR | 165 | 51.5% | 2.07 | 5.0% | -10.8% | 20.8% | 8.2 | 3 | 2 | 66.7% | championship | 24.2% | 2 | 2 |
| 1x2_total_ft_draw | AMOSTRA_CURTA | 96 | 32.3% | 3.77 | 21.6% | -14.2% | 57.3% | 20.7 | 0 | 0 |  |  | 0.0% | 1 | 1 |
| chutes_total_ft_over_25_5 | FRAGIL | 137 | 56.2% | 1.87 | 4.5% | -11.2% | 20.3% | 6.2 | 2 | 1 | 50.0% | brasileirao | 29.2% | 2 | 2 |
| escanteios_total_ft_over_9_5 | FRAGIL | 308 | 56.8% | 1.84 | 2.9% | -7.3% | 13.0% | 8.8 | 8 | 6 | 75.0% | brasileirao | 17.5% | 2 | 1 |
| escanteios_total_ft_under_11_5 | FRAGIL | 402 | 74.1% | 1.38 | 1.1% | -4.8% | 7.0% | 4.3 | 12 | 6 | 50.0% | la-liga-2 | 10.9% | 2 | 1 |
| chutes_alvo_total_ft_under_9_5 | FRAGIL | 134 | 57.5% | 1.83 | 0.1% | -14.7% | 14.9% | 0.1 | 2 | 1 | 50.0% | la-liga | 21.6% | 1 | 0 |

## Por temporada
| market_key | segment | n | hit_rate | avg_odd | roi | profit | roi_ci_low | roi_ci_high |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1x2_total_ft_draw | 2025/2026 | 83 | 31.3% | 3.87 | 21.3% | 17.6 | -17.8% | 60.4% |
| btts_total_ft_nao | 2025/2026 | 651 | 42.7% | 2.68 | 12.5% | 81.2 | 2.3% | 22.7% |
| btts_total_ft_nao | 2026 | 233 | 46.8% | 2.47 | 14.4% | 33.7 | -1.4% | 30.3% |
| btts_total_ft_sim | 2025/2026 | 257 | 53.3% | 2.22 | 18.7% | 48.1 | 5.0% | 32.4% |
| btts_total_ft_sim | 2026 | 26 | 65.4% | 2.33 | 51.7% | 13.4 | 8.4% | 94.9% |
| cartoes_total_ht_under_0_5 | 2025/2026 | 110 | 32.7% | 3.69 | 18.0% | 19.8 | -14.1% | 50.0% |
| chutes_alvo_total_ft_under_8_5 | 2025/2026 | 129 | 48.1% | 2.12 | 0.5% | 0.6 | -17.8% | 18.8% |
| chutes_alvo_total_ft_under_8_5 | 2026 | 36 | 63.9% | 1.91 | 21.2% | 7.6 | -9.1% | 51.5% |
| chutes_alvo_total_ft_under_9_5 | 2025/2026 | 118 | 54.2% | 1.85 | -4.5% | -5.3 | -20.6% | 11.5% |
| chutes_total_ft_over_25_5 | 2025/2026 | 86 | 53.5% | 1.91 | 0.6% | 0.5 | -19.5% | 20.8% |
| chutes_total_ft_over_25_5 | 2026 | 51 | 60.8% | 1.81 | 11.1% | 5.6 | -14.0% | 36.1% |
| chutes_total_ft_over_26_5 | 2025/2026 | 62 | 58.1% | 2.00 | 14.1% | 8.7 | -10.5% | 38.6% |
| chutes_total_ft_over_26_5 | 2026 | 50 | 52.0% | 2.00 | 4.5% | 2.3 | -23.8% | 32.8% |
| escanteios_total_ft_over_9_5 | 2025/2026 | 220 | 58.6% | 1.82 | 6.2% | 13.5 | -5.7% | 18.1% |
| escanteios_total_ft_over_9_5 | 2026 | 88 | 52.3% | 1.88 | -5.4% | -4.8 | -24.5% | 13.7% |
| escanteios_total_ft_under_11_5 | 2025/2026 | 336 | 72.6% | 1.38 | -0.8% | -2.7 | -7.4% | 5.7% |
| escanteios_total_ft_under_11_5 | 2026 | 66 | 81.8% | 1.37 | 10.7% | 7.0 | -2.2% | 23.5% |

## Melhores ligas por bolso
| market_key | segment | n | hit_rate | avg_odd | roi | profit | roi_ci_low | roi_ci_high |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| btts_total_ft_sim | brasileirao | 26 | 65.4% | 2.33 | 51.7% | 13.4 | 8.4% | 94.9% |
| btts_total_ft_sim | ligue-1 | 29 | 62.1% | 2.30 | 46.6% | 13.5 | 4.3% | 88.9% |
| btts_total_ft_sim | la-liga-2 | 28 | 64.3% | 2.21 | 40.6% | 11.4 | 1.3% | 79.8% |
| cartoes_total_ht_under_0_5 | premier-league | 24 | 41.7% | 3.66 | 44.8% | 10.8 | -24.4% | 113.9% |
| cartoes_total_ht_under_0_5 | bundesliga | 26 | 38.5% | 3.44 | 31.6% | 8.2 | -32.9% | 96.2% |
| cartoes_total_ht_under_0_5 | ligue-1 | 32 | 21.9% | 3.59 | -19.2% | -6.2 | -72.9% | 34.5% |
| btts_total_ft_nao | serie-a | 69 | 59.4% | 2.57 | 50.0% | 34.5 | 19.8% | 80.1% |
| btts_total_ft_nao | serie-b-italia | 69 | 49.3% | 2.70 | 30.8% | 21.2 | -1.0% | 62.6% |
| btts_total_ft_nao | premier-league | 53 | 43.4% | 2.75 | 17.9% | 9.5 | -19.0% | 54.7% |
| chutes_total_ft_over_26_5 | brasileirao | 40 | 55.0% | 2.02 | 11.0% | 4.4 | -20.7% | 42.7% |
| chutes_alvo_total_ft_under_8_5 | superliga-argentina | 24 | 70.8% | 1.80 | 27.3% | 6.5 | -5.7% | 60.2% |
| chutes_alvo_total_ft_under_8_5 | la-liga | 28 | 53.6% | 2.19 | 18.2% | 5.1 | -23.2% | 59.5% |
| chutes_alvo_total_ft_under_8_5 | championship | 40 | 40.0% | 1.89 | -25.8% | -10.3 | -54.0% | 2.4% |
| chutes_total_ft_over_25_5 | brasileirao | 40 | 65.0% | 1.82 | 19.0% | 7.6 | -8.8% | 46.9% |
| chutes_total_ft_over_25_5 | premier-league | 21 | 52.4% | 1.83 | -7.1% | -1.5 | -45.3% | 31.0% |
| escanteios_total_ft_over_9_5 | serie-a | 24 | 58.3% | 2.06 | 17.9% | 4.3 | -22.3% | 58.1% |
| escanteios_total_ft_over_9_5 | premier-league | 25 | 68.0% | 1.67 | 15.2% | 3.8 | -15.9% | 46.4% |
| escanteios_total_ft_over_9_5 | la-liga-2 | 26 | 61.5% | 1.87 | 15.1% | 3.9 | -20.1% | 50.4% |
| escanteios_total_ft_under_11_5 | brasileirao | 21 | 81.0% | 1.48 | 18.2% | 3.8 | -6.4% | 42.8% |
| escanteios_total_ft_under_11_5 | serie-a | 26 | 88.5% | 1.28 | 13.5% | 3.5 | -2.3% | 29.3% |
| escanteios_total_ft_under_11_5 | la-liga-2 | 44 | 84.1% | 1.33 | 11.7% | 5.1 | -2.7% | 26.1% |
| chutes_alvo_total_ft_under_9_5 | la-liga | 29 | 65.5% | 1.80 | 11.6% | 3.4 | -18.4% | 41.5% |
| chutes_alvo_total_ft_under_9_5 | bundesliga | 23 | 17.4% | 2.18 | -62.1% | -14.3 | -95.9% | -28.3% |

## Piores ligas por bolso
| market_key | segment | n | hit_rate | avg_odd | roi | profit | roi_ci_low | roi_ci_high |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| btts_total_ft_sim | la-liga | 33 | 42.4% | 2.26 | -6.5% | -2.1 | -43.9% | 30.9% |
| btts_total_ft_sim | premier-league | 49 | 49.0% | 2.22 | 9.2% | 4.5 | -22.4% | 40.7% |
| btts_total_ft_sim | bundesliga | 35 | 54.3% | 2.09 | 12.1% | 4.2 | -22.2% | 46.5% |
| cartoes_total_ht_under_0_5 | ligue-1 | 32 | 21.9% | 3.59 | -19.2% | -6.2 | -72.9% | 34.5% |
| cartoes_total_ht_under_0_5 | bundesliga | 26 | 38.5% | 3.44 | 31.6% | 8.2 | -32.9% | 96.2% |
| cartoes_total_ht_under_0_5 | premier-league | 24 | 41.7% | 3.66 | 44.8% | 10.8 | -24.4% | 113.9% |
| btts_total_ft_nao | bundesliga | 53 | 24.5% | 2.81 | -30.9% | -16.4 | -64.1% | 2.4% |
| btts_total_ft_nao | championship | 98 | 39.8% | 2.66 | 2.1% | 2.1 | -23.4% | 27.6% |
| btts_total_ft_nao | liga-mx | 40 | 37.5% | 2.75 | 3.4% | 1.3 | -39.3% | 46.0% |
| chutes_total_ft_over_26_5 | brasileirao | 40 | 55.0% | 2.02 | 11.0% | 4.4 | -20.7% | 42.7% |
| chutes_alvo_total_ft_under_8_5 | championship | 40 | 40.0% | 1.89 | -25.8% | -10.3 | -54.0% | 2.4% |
| chutes_alvo_total_ft_under_8_5 | la-liga | 28 | 53.6% | 2.19 | 18.2% | 5.1 | -23.2% | 59.5% |
| chutes_alvo_total_ft_under_8_5 | superliga-argentina | 24 | 70.8% | 1.80 | 27.3% | 6.5 | -5.7% | 60.2% |
| chutes_total_ft_over_25_5 | premier-league | 21 | 52.4% | 1.83 | -7.1% | -1.5 | -45.3% | 31.0% |
| chutes_total_ft_over_25_5 | brasileirao | 40 | 65.0% | 1.82 | 19.0% | 7.6 | -8.8% | 46.9% |
| escanteios_total_ft_over_9_5 | superliga-argentina | 20 | 25.0% | 2.18 | -45.6% | -9.1 | -86.9% | -4.3% |
| escanteios_total_ft_over_9_5 | bundesliga | 20 | 45.0% | 1.81 | -18.9% | -3.8 | -58.3% | 20.4% |
| escanteios_total_ft_over_9_5 | championship | 43 | 60.5% | 1.68 | 1.3% | 0.6 | -23.2% | 25.9% |
| escanteios_total_ft_under_11_5 | liga-mx | 26 | 61.5% | 1.39 | -14.4% | -3.7 | -40.5% | 11.7% |
| escanteios_total_ft_under_11_5 | championship | 39 | 61.5% | 1.46 | -10.2% | -4.0 | -32.5% | 12.2% |
| escanteios_total_ft_under_11_5 | bundesliga | 32 | 65.6% | 1.41 | -9.1% | -2.9 | -32.0% | 13.7% |
| chutes_alvo_total_ft_under_9_5 | bundesliga | 23 | 17.4% | 2.18 | -62.1% | -14.3 | -95.9% | -28.3% |
| chutes_alvo_total_ft_under_9_5 | la-liga | 29 | 65.5% | 1.80 | 11.6% | 3.4 | -18.4% | 41.5% |

## Melhores splits de mandante
| market_key | segment | n | hit_rate | avg_odd | roi | profit |
| --- | --- | --- | --- | --- | --- | --- |
| btts_total_ft_sim | Manchester United | 5 | 100.0% | 2.13 | 113.2% | 5.7 |
| btts_total_ft_sim | Freiburg | 5 | 80.0% | 2.14 | 70.8% | 3.5 |
| 1x2_total_ft_draw | Real Oviedo | 6 | 33.3% | 3.17 | 5.8% | 0.4 |
| btts_total_ft_nao | Udinese | 5 | 100.0% | 2.76 | 175.9% | 8.8 |
| btts_total_ft_nao | West Bromwich Albion | 5 | 80.0% | 2.53 | 122.7% | 6.1 |
| chutes_total_ft_over_26_5 | Botafogo | 5 | 60.0% | 1.96 | 17.8% | 0.9 |
| chutes_total_ft_over_25_5 | Botafogo | 6 | 66.7% | 1.83 | 22.0% | 1.3 |
| escanteios_total_ft_over_9_5 | Internazionale | 5 | 80.0% | 1.90 | 52.0% | 2.6 |
| escanteios_total_ft_over_9_5 | Middlesbrough | 5 | 80.0% | 1.58 | 26.4% | 1.3 |
| escanteios_total_ft_under_11_5 | Real Oviedo | 6 | 83.3% | 1.35 | 12.2% | 0.7 |
| escanteios_total_ft_under_11_5 | Casa Pia | 5 | 80.0% | 1.34 | 6.8% | 0.3 |

## Melhores splits de visitante
| market_key | segment | n | hit_rate | avg_odd | roi | profit |
| --- | --- | --- | --- | --- | --- | --- |
| btts_total_ft_sim | Gremio | 5 | 60.0% | 2.37 | 42.0% | 2.1 |
| btts_total_ft_nao | Getafe | 5 | 100.0% | 2.39 | 139.3% | 7.0 |
| btts_total_ft_nao | Atletico Mineiro | 6 | 83.3% | 2.67 | 122.6% | 7.4 |
| chutes_total_ft_over_26_5 | Flamengo | 7 | 42.9% | 2.33 | -0.1% | -0.0 |
| chutes_total_ft_over_25_5 | Flamengo | 7 | 57.1% | 1.97 | 12.4% | 0.9 |
| escanteios_total_ft_over_9_5 | Cruzeiro | 5 | 100.0% | 1.74 | 73.6% | 3.7 |
| escanteios_total_ft_over_9_5 | Gremio | 5 | 80.0% | 1.76 | 41.2% | 2.1 |
| escanteios_total_ft_under_11_5 | Derby County | 5 | 80.0% | 1.42 | 16.8% | 0.8 |

## Decisao para mesa
- Prioridade de regra candidata: `btts_total_ft_sim` e `btts_total_ft_nao`, sempre mantendo filtro de valor operacional e checagem por liga.
- Trabalhar como candidatos segmentares, nao regras gerais: `cartoes_total_ht_under_0_5`, `chutes_total_ft_over_26_5`, `chutes_total_ft_over_25_5`, `chutes_alvo_total_ft_under_8_5`.
- Nao promover por enquanto: `chutes_alvo_total_ft_under_9_5` e escanteios FT amplos; manter apenas se tambem houver confirmacao por liga/time.
- Para operacionalizar, o proximo filtro deve exigir liga positiva e, quando houver, split mandante/visitante favoravel; range de odd sozinho continua insuficiente.

## Arquivos
- `audit/odds-pocket-validation-2026-05-19/pocket_overall.csv`
- `audit/odds-pocket-validation-2026-05-19/pocket_by_league.csv`
- `audit/odds-pocket-validation-2026-05-19/pocket_by_season.csv`
- `audit/odds-pocket-validation-2026-05-19/pocket_by_league_season.csv`
- `audit/odds-pocket-validation-2026-05-19/pocket_by_home_team.csv`
- `audit/odds-pocket-validation-2026-05-19/pocket_by_away_team.csv`
- `audit/odds-pocket-validation-2026-05-19/pocket_best_worst_segments.csv`
- `audit/odds-pocket-validation-2026-05-19/pocket_team_best_worst_segments.csv`
