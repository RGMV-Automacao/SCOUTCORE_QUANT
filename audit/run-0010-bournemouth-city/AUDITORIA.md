# RUN #0010 ? auditoria mercado a mercado ? AFC Bournemouth x Manchester City

- run_id: `run-2026-05-19-to-2026-05-24-14273a3c5dc3`
- motor_run: `run-2026-05-19-to-2026-05-24-14273a3c5dc3__51wruvqfagv0fz9vzksxri4gk`
- horario do motor: `2026-05-19 16:35:44`
- confronto: `AFC Bournemouth x Manchester City` ? `2026-05-19 18:30` ? `51wruvqfagv0fz9vzksxri4gk`
- slots auditados: `487`

## Classificacao geral
- `RESOLVIDO_NO_RUN_0010`: 119
- `GAP_MAPPER_NO_RUN_0010`: 26
- `ODD_ENTROU_APOS_RUN_0010`: 25
- `GAP_EXTRACAO_NORMALIZACAO_TEAM_MARKET`: 24
- `SEM_ODD_NO_SNAPSHOT_LOCAL`: 293

## Por familia
| familia | resolvido_run | gap_mapper_run | entrou_apos_run | gap_extracao_normalizacao_team | sem_snapshot_local | total |
|---|---:|---:|---:|---:|---:|---:|
| 1x2 | 6 | 0 | 0 | 0 | 0 | 6 |
| btts | 4 | 0 | 0 | 0 | 0 | 4 |
| cartoes | 20 | 3 | 2 | 0 | 24 | 49 |
| chutes | 32 | 6 | 12 | 0 | 92 | 142 |
| defesas | 0 | 0 | 0 | 0 | 34 | 34 |
| desarmes | 0 | 0 | 0 | 0 | 34 | 34 |
| dupla | 3 | 3 | 0 | 0 | 0 | 6 |
| escanteios | 26 | 14 | 2 | 0 | 62 | 104 |
| faltas | 4 | 0 | 2 | 0 | 22 | 28 |
| gols | 22 | 0 | 1 | 24 | 13 | 60 |
| impedimentos | 2 | 0 | 6 | 0 | 12 | 20 |

## Diagnostico curto
- O RUN #0010 nao estava vazio de odds: 119/487 mercados resolveram no confronto.
- 26 mercados eram gap real de mapper/resolucao no horario do RUN #0010: Dupla FT, 1X2 de escanteios/chutes/chutes no gol/cartoes e handicap de escanteios. Eles ja tinham odds antes do motor, mas o run nao casou.
- 25 mercados apareceram no banco apenas depois do horario do motor; nao eram resolviveis naquele instante.
- 24 mercados de gols por equipe FT/HT (`Total de Gols da Equipe` e `1º Tempo - Total de Gols do Time`) sao gap confirmado de extracao/normalizacao: o parser reconhecia o heading e o time, mas `recordToPortugueseRow()` descartava `scope=equipe_*`, entao a tabela nao recebia `gols_home_*`/`gols_away_*` canonico.
- 293 mercados ainda nao possuem linha exata no snapshot local de odds para esse confronto. Isso inclui mercados por equipe de outras familias, defesas e desarmes; alguns podem ser oferta real nao capturada, mas ainda exigem prova mercado a mercado antes de afirmar.
- O CSV contem a decisao linha a linha com odd do RUN, odd antes do RUN e odd mais recente quando existir.

## Arquivo detalhado
- `audit/run-0010-bournemouth-city/market_audit.csv`
