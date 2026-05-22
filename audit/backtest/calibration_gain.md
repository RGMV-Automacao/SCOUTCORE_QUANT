# Calibration Gain Report

Gerado: 2026-05-19T10:50:12.027Z
Curvas isotônicas carregadas: 374
Amostras (com fit aplicável): 5.152.024

## Resumo (média ponderada por n)

| Métrica           | RAW           | Calibrado     | Δ              |
|-------------------|---------------|---------------|----------------|
| Brier             | 0.198390 | 0.185694 | -0.012696 (-6.40%) |
| \|gap\| médio      | 0.047673 | 0.006442 | -0.041231 |

Buckets melhorados: **1101/1235**  ·  piorados: 134/1235

## Top 10 maiores ganhos (Δ Brier mais negativo)

| Liga | Family | Period | Direction | n | cov | Brier raw | Brier cal | Δ Brier |
|------|--------|--------|-----------|---|-----|-----------|-----------|---------|
| superliga-argentina | escanteios_handicap | FT | away_minus_4_5 | 587 | 100% | 0.6938 | 0.0633 | -0.6305 |
| la-liga-2 | escanteios_handicap | FT | away_minus_4_5 | 323 | 100% | 0.6822 | 0.0621 | -0.6202 |
| serie-a | escanteios_handicap | FT | away_minus_4_5 | 1718 | 100% | 0.6886 | 0.0804 | -0.6083 |
| la-liga | escanteios_handicap | FT | away_minus_4_5 | 1728 | 100% | 0.6733 | 0.0716 | -0.6017 |
| ligue-1 | escanteios_handicap | FT | away_minus_4_5 | 1520 | 100% | 0.6897 | 0.0892 | -0.6004 |
| bundesliga | escanteios_handicap | FT | away_minus_4_5 | 1362 | 100% | 0.6805 | 0.0803 | -0.6002 |
| superliga-argentina | escanteios_handicap | FT | away_plus_4_5 | 587 | 100% | 0.7521 | 0.1562 | -0.5960 |
| ligue-1 | escanteios_handicap | FT | away_plus_4_5 | 1520 | 100% | 0.7358 | 0.1484 | -0.5874 |
| superliga-argentina | escanteios_handicap | HT | away_minus_2_5 | 587 | 100% | 0.6666 | 0.0805 | -0.5860 |
| la-liga-2 | escanteios_handicap | FT | away_plus_4_5 | 323 | 100% | 0.7398 | 0.1591 | -0.5807 |

## Top 10 regressões (Δ Brier > 0, n ≥ 1000)

| Liga | Family | Period | Direction | n | Brier raw | Brier cal | Δ Brier |
|------|--------|--------|-----------|---|-----------|-----------|---------|
| brasileirao | chutes_alvo_1x2 | HT | draw | 1855 | 0.1558 | 0.1665 | +0.0107 |
| bundesliga | chutes_alvo_1x2 | HT | away | 1362 | 0.2248 | 0.2343 | +0.0095 |
| brasileirao | chutes_1x2 | FT | draw | 1855 | 0.0328 | 0.0416 | +0.0088 |
| championship | chutes_alvo | FT | under | 7395 | 0.1936 | 0.1978 | +0.0042 |
| primeira-liga | cartoes | HT | over | 1712 | 0.1920 | 0.1949 | +0.0030 |
| primeira-liga | cartoes | HT | under | 1712 | 0.1920 | 0.1948 | +0.0028 |
| championship | chutes_alvo | FT | over | 7395 | 0.1936 | 0.1961 | +0.0025 |
| premier-league | escanteios_oddeven | HT | par | 1721 | 0.2500 | 0.2520 | +0.0020 |
| premier-league | escanteios_oddeven | HT | impar | 1721 | 0.2500 | 0.2520 | +0.0020 |
| primeira-liga | cartoes | FT | under | 3210 | 0.1854 | 0.1871 | +0.0017 |
