# Calibration Gain Report

Gerado: 2026-05-14T03:29:02.225Z
Curvas isotônicas carregadas: 544
Amostras (com fit aplicável): 6.283.421

## Resumo (média ponderada por n)

| Métrica           | RAW           | Calibrado     | Δ              |
|-------------------|---------------|---------------|----------------|
| Brier             | 0.160981 | 0.157953 | -0.003028 (-1.88%) |
| \|gap\| médio      | 0.030501 | 0.006016 | -0.024485 |

Buckets melhorados: **2026/2275**  ·  piorados: 249/2275

## Top 10 maiores ganhos (Δ Brier mais negativo)

| Liga | Family | Period | Direction | n | cov | Brier raw | Brier cal | Δ Brier |
|------|--------|--------|-----------|---|-----|-----------|-----------|---------|
| brasileirao-b | handicap | FT | away_minus_2 | 310 | 100% | 0.1920 | 0.1481 | -0.0440 |
| brasileirao-b | asian_handicap | FT | away_minus_1_5 | 310 | 100% | 0.1920 | 0.1481 | -0.0440 |
| brasileirao-b | asian_handicap | FT | home_minus_1_5 | 310 | 100% | 0.1920 | 0.1481 | -0.0440 |
| brasileirao-b | handicap | FT | home_minus_1 | 310 | 100% | 0.1920 | 0.1481 | -0.0440 |
| brasileirao-b | marca | FT | away_nao | 310 | 100% | 0.2724 | 0.2296 | -0.0429 |
| brasileirao-b | marca | FT | away_sim | 310 | 100% | 0.2724 | 0.2296 | -0.0429 |
| primeira-liga | btts | FT | nao | 205 | 100% | 0.2945 | 0.2575 | -0.0370 |
| primeira-liga | btts | FT | sim | 205 | 100% | 0.2945 | 0.2575 | -0.0370 |
| liga-mx | handicap | FT | home_minus_2 | 235 | 100% | 0.1226 | 0.0875 | -0.0352 |
| superliga-argentina | marca | FT | away_nao | 581 | 100% | 0.2778 | 0.2435 | -0.0343 |

## Top 10 regressões (Δ Brier > 0, n ≥ 1000)

| Liga | Family | Period | Direction | n | Brier raw | Brier cal | Δ Brier |
|------|--------|--------|-----------|---|-----------|-----------|---------|
| primeira-liga | cartoes | HT | over | 1640 | 0.1910 | 0.1947 | +0.0037 |
| primeira-liga | cartoes | HT | under | 1640 | 0.1910 | 0.1947 | +0.0036 |
| brasileirao | escanteios_exato | FT | eq_10 | 1845 | 0.1057 | 0.1084 | +0.0027 |
| brasileirao | correct_score | HT | 1_1 | 1845 | 0.0954 | 0.0975 | +0.0021 |
| championship | cartoes | HT | under | 3480 | 0.1661 | 0.1680 | +0.0020 |
| championship | cartoes | HT | over | 3480 | 0.1661 | 0.1680 | +0.0019 |
| brasileirao | correct_score | FT | 1_1 | 1845 | 0.1140 | 0.1159 | +0.0019 |
| brasileirao | escanteios_exato | FT | eq_6 | 1845 | 0.0677 | 0.0695 | +0.0018 |
| brasileirao | escanteios_exato | FT | eq_13 | 1845 | 0.0717 | 0.0732 | +0.0015 |
| primeira-liga | cartoes | FT | under | 3075 | 0.1833 | 0.1848 | +0.0015 |
