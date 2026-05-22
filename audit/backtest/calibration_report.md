# Calibration Report — Isotonic (walk-forward)

**Cutoff:** 2025-11-30
**Amostras de teste:** 1.168.172
**Cobertura de fit:** 100.0%
**Curvas isotônicas persistidas:** 374

## Brier ponderado (por n de amostras)

| Subconjunto | n | Brier raw | Brier calibrado | Δ-Brier abs | Δ-Brier rel |
|---|---:|---:|---:|---:|---:|
| Todas as amostras | 1.165.826 | 0.19770 | 0.18567 | 0.01203 | 6.08% |
| Apenas com fit aplicável | 1.165.826 | 0.19770 | 0.18567 | 0.01203 | 6.08% |

## Reliability gap |mean(p) − base_rate|

- Buckets (n≥500, coverage≥0.5) com gap_raw ≥ 5pp: **90**
- Desses, gap_cal ≥ 5pp pós-calibração: **10** (corrigidos: 80)

## Top-15 ganhos de Brier (n≥500)

| liga | family | period | direction | n | gap_raw → gap_cal | brier_raw → brier_cal | Δ |
|---|---|---|---|---:|---|---|---:|
| brasileirao-b | cartoes | FT | under | 510 | 14.5pp → 7.5pp | 0.1868 → 0.1677 | 0.0191 |
| brasileirao-b | cartoes | FT | over | 510 | -14.5pp → -7.5pp | 0.1868 → 0.1679 | 0.0189 |
| liga-mx | chutes | FT | under | 4002 | 3.8pp → 4.9pp | 0.2497 → 0.2337 | 0.0160 |
| liga-mx | chutes | FT | over | 4002 | -3.8pp → -4.9pp | 0.2497 → 0.2337 | 0.0160 |
| liga-mx | cartoes | HT | under | 1392 | 11.8pp → 4.0pp | 0.2171 → 0.2041 | 0.0129 |
| liga-mx | cartoes | HT | over | 1392 | -11.8pp → -4.0pp | 0.2171 → 0.2042 | 0.0128 |
| brasileirao | cartoes | HT | under | 1360 | 10.6pp → -0.5pp | 0.2174 → 0.2048 | 0.0126 |
| brasileirao | cartoes | HT | over | 1360 | -10.6pp → 0.5pp | 0.2174 → 0.2049 | 0.0125 |
| superliga-argentina | cartoes | HT | under | 1928 | 12.2pp → -3.4pp | 0.2137 → 0.2012 | 0.0125 |
| superliga-argentina | cartoes | HT | over | 1928 | -12.2pp → 3.3pp | 0.2137 → 0.2012 | 0.0125 |
| serie-b-italia | cartoes | HT | under | 1984 | 10.6pp → 2.8pp | 0.1963 → 0.1852 | 0.0111 |
| serie-b-italia | cartoes | HT | over | 1984 | -10.6pp → -2.8pp | 0.1963 → 0.1852 | 0.0111 |
| ligue-1 | cartoes | HT | under | 1472 | 9.9pp → -0.1pp | 0.1901 → 0.1798 | 0.0103 |
| ligue-1 | cartoes | HT | over | 1472 | -9.9pp → -0.0pp | 0.1901 → 0.1800 | 0.0101 |
| bundesliga | faltas | FT | over | 2814 | 11.6pp → 7.7pp | 0.2041 → 0.1945 | 0.0096 |

## Top-10 regressões (calibração piora; investigar)

| liga | family | period | direction | n | gap_raw → gap_cal | brier_raw → brier_cal | Δ |
|---|---|---|---|---:|---|---|---:|
| championship | chutes_alvo | FT | under | 5814 | 1.1pp → -7.1pp | 0.1924 → 0.1989 | -0.0064 |
| serie-a | cartoes | HT | over | 1960 | 0.7pp → 6.3pp | 0.1616 → 0.1660 | -0.0044 |
| serie-a | cartoes | HT | under | 1960 | -0.7pp → -6.3pp | 0.1616 → 0.1660 | -0.0044 |
| championship | chutes_alvo | FT | over | 5814 | -1.1pp → 6.6pp | 0.1924 → 0.1968 | -0.0043 |
| bundesliga | cartoes | HT | over | 1608 | -0.8pp → 5.9pp | 0.1588 → 0.1621 | -0.0033 |
| bundesliga | cartoes | HT | under | 1608 | 0.8pp → -5.7pp | 0.1588 → 0.1620 | -0.0032 |
| bundesliga | gols | 2T | over | 804 | 0.2pp → -5.2pp | 0.1609 → 0.1636 | -0.0027 |
| bundesliga | gols | 2T | under | 804 | -0.2pp → 5.2pp | 0.1609 → 0.1636 | -0.0027 |
| premier-league | chutes_alvo | HT | over | 2916 | -1.8pp → 5.5pp | 0.1868 → 0.1893 | -0.0025 |
| premier-league | chutes_alvo | HT | under | 2916 | 1.8pp → -5.5pp | 0.1868 → 0.1893 | -0.0025 |

## Notas

- Cutoff é o 80º percentil das datas de partida — split puramente temporal (sem vazamento).
- "Coverage" < 100% indica buckets sem fit (amostra de treino abaixo de `--min-liga`/`--min-global`).
- Δ-Brier > 0 ⇒ calibração melhorou. Δ-Brier < 0 ⇒ regrediu (revisar buckets de baixa amostra ou drift de mercado).
