# Calibration Report — Isotonic (walk-forward)

**Cutoff:** 2025-11-28
**Amostras de teste:** 1.414.740
**Cobertura de fit:** 100.0%
**Curvas isotônicas persistidas:** 544

## Brier ponderado (por n de amostras)

| Subconjunto | n | Brier raw | Brier calibrado | Δ-Brier abs | Δ-Brier rel |
|---|---:|---:|---:|---:|---:|
| Todas as amostras | 1.410.504 | 0.16143 | 0.15889 | 0.00254 | 1.57% |
| Apenas com fit aplicável | 1.410.504 | 0.16143 | 0.15889 | 0.00254 | 1.57% |

## Reliability gap |mean(p) − base_rate|

- Buckets (n≥500, coverage≥0.5) com gap_raw ≥ 5pp: **78**
- Desses, gap_cal ≥ 5pp pós-calibração: **4** (corrigidos: 74)

## Top-15 ganhos de Brier (n≥500)

| liga | family | period | direction | n | gap_raw → gap_cal | brier_raw → brier_cal | Δ |
|---|---|---|---|---:|---|---|---:|
| superliga-argentina | cartoes | HT | over | 1880 | -12.2pp → 3.2pp | 0.2127 → 0.2003 | 0.0124 |
| superliga-argentina | cartoes | HT | under | 1880 | 12.2pp → -3.4pp | 0.2127 → 0.2003 | 0.0124 |
| liga-mx | cartoes | HT | over | 1376 | -11.3pp → -3.5pp | 0.2173 → 0.2051 | 0.0122 |
| liga-mx | cartoes | HT | under | 1376 | 11.3pp → 3.5pp | 0.2173 → 0.2051 | 0.0121 |
| serie-b-italia | cartoes | HT | under | 2024 | 10.5pp → 2.7pp | 0.1956 → 0.1846 | 0.0110 |
| serie-b-italia | cartoes | HT | over | 2024 | -10.5pp → -2.7pp | 0.1956 → 0.1847 | 0.0110 |
| brasileirao | chutes_alvo | HT | under | 1476 | 9.7pp → 1.6pp | 0.2125 → 0.2022 | 0.0103 |
| ligue-1 | cartoes | HT | under | 1424 | 9.8pp → -0.1pp | 0.1898 → 0.1797 | 0.0101 |
| brasileirao | cartoes | HT | over | 1312 | -9.4pp → 1.6pp | 0.2113 → 0.2013 | 0.0100 |
| brasileirao | chutes_alvo | HT | over | 1476 | -9.7pp → -1.3pp | 0.2125 → 0.2025 | 0.0100 |
| brasileirao | cartoes | HT | under | 1312 | 9.4pp → -1.7pp | 0.2113 → 0.2014 | 0.0100 |
| ligue-1 | cartoes | HT | over | 1424 | -9.8pp → 0.0pp | 0.1898 → 0.1799 | 0.0099 |
| brasileirao-b | chutes_alvo | FT | over | 510 | 9.8pp → 1.1pp | 0.2239 → 0.2142 | 0.0098 |
| brasileirao-b | chutes_alvo | FT | under | 510 | -9.8pp → -0.9pp | 0.2239 → 0.2142 | 0.0097 |
| brasileirao-b | escanteios | FT | over | 600 | 4.4pp → 0.2pp | 0.2063 → 0.1967 | 0.0096 |

## Top-10 regressões (calibração piora; investigar)

| liga | family | period | direction | n | gap_raw → gap_cal | brier_raw → brier_cal | Δ |
|---|---|---|---|---:|---|---|---:|
| serie-a | chutes_alvo | HT | under | 2160 | 3.8pp → 4.9pp | 0.2080 → 0.2143 | -0.0064 |
| superliga-argentina | asian_total | FT | over | 1105 | 2.3pp → -0.0pp | 0.1829 → 0.1871 | -0.0043 |
| superliga-argentina | asian_total | FT | under | 1105 | -2.3pp → 0.0pp | 0.1829 → 0.1871 | -0.0043 |
| bundesliga | cartoes | HT | over | 1584 | -0.4pp → 6.4pp | 0.1566 → 0.1604 | -0.0039 |
| serie-a | cartoes | HT | under | 1920 | -0.1pp → -5.7pp | 0.1609 → 0.1647 | -0.0038 |
| bundesliga | cartoes | HT | under | 1584 | 0.4pp → -6.1pp | 0.1566 → 0.1603 | -0.0038 |
| serie-a | cartoes | HT | over | 1920 | 0.1pp → 5.7pp | 0.1609 → 0.1645 | -0.0037 |
| primeira-liga | cartoes | HT | over | 1584 | -1.8pp → 6.1pp | 0.1907 → 0.1943 | -0.0036 |
| primeira-liga | cartoes | HT | under | 1584 | 1.8pp → -6.1pp | 0.1907 → 0.1942 | -0.0035 |
| brasileirao | escanteios | HT | over | 2460 | 0.0pp → 5.2pp | 0.1806 → 0.1835 | -0.0028 |

## Notas

- Cutoff é o 80º percentil das datas de partida — split puramente temporal (sem vazamento).
- "Coverage" < 100% indica buckets sem fit (amostra de treino abaixo de `--min-liga`/`--min-global`).
- Δ-Brier > 0 ⇒ calibração melhorou. Δ-Brier < 0 ⇒ regrediu (revisar buckets de baixa amostra ou drift de mercado).
