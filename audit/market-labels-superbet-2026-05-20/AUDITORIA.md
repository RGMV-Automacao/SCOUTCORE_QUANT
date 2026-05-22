# Auditoria de Labels Superbet - 2026-05-20

## Conclusao honesta

Havia divergencia real. A analise anterior nao podia ser considerada completa porque labels visiveis na tela da Superbet estavam ausentes ou incompletos em `HEADING_MAP`, `inferMarketKey`, mapper runtime e catalogo.

Impacto: o backtest/run feito com 487 slots nao e comparavel ao contrato atual. Ele continua historico para os mercados que existiam e estavam corretamente normalizados, mas fica invalido como certificacao do universo completo atual. O catalogo atual e `2.1.1` com 598 slots.

## Evidencia DB antes/depois

Reinferencia feita contra `data/scout_extraction.db`, sem alterar dados:

| Label | Linhas DB | `legacy_raw_*` antes | `legacy_raw_*` apos reinferir |
|---|---:|---:|---:|
| `1º Tempo - Finalizações 1X2` | 180 | 180 | 0 |
| `Total de Desarmes` | 328 | 328 | 0 |
| `Total de Gols Ímpar/Par` | 2188 | 2188 | 0 |
| `Ímpar/Par - Escanteios` | 2052 | 2052 | 0 |
| `1º Tempo - Escanteios Ímpar/Par` | 2050 | 2050 | 0 |
| `1° Tempo - Cartões 1X2` | 1315 | 1060 | 0 |

## Correcoes aplicadas

- Parser/API adapter: adicionados labels exatos da tela para `Resultado Final (1X2)`, `1º Tempo - Finalizações 1X2`, defesas total/equipe FT/HT, desarmes total/equipe, `2º Tempo - Total de Gols` e aliases legados aceitos.
- Normalizador de outcome: mercados 1X2 agora aceitam selecao por `1/X/2`, `Empate` ou nome do time.
- Inferencia canonica: desarmes, defesas por equipe, odd/even, `Resultado Final (1X2)` e 1X2 de finalizacoes 1T deixam de cair em `legacy_raw_*`.
- Mapper runtime: lookup suporta labels atuais e legados, sempre com tentativa por `mercado_key` exato primeiro.
- Catalogo: `MARKETS_VERSION=2.1.1`, 598 slots; inclui `cartoes_1x2` HT, `defesas` HT, `faltas` HT, linhas reais de desarmes, `cartoes_total_ft_0.5`, escanteios FT combinaveis `3.5` a `18.5` e handicap de escanteios FT `±5.5`.
- Writer live: agora grava apenas `mercado_key` existente no catalogo; chaves `legacy_raw_*` e chaves canonicas fora do registry sao descartadas como fora do contrato, sem contaminar a tabela `odds`.
- Contrato de times: `inferMarketKey`, `buildQuoteKey`, `buildQuoteSignature` e `prepareOddsRowsForMatch` aceitam tanto `home_team/away_team` quanto `equipe_home/equipe_away`; `Resultado Final (1X2)` tambem aceita selecao pelo nome do time, nao apenas `1/X/2`.
- Settlement: `cartoes_1x2` usa o periodo do slot, e o settler job nao cai mais no bloco generico de gols para mercados count 1X2.

## Simulacao Arsenal x Burnley salva em `book_Arsenal_Burnley.json`

O JSON nao traz texto literal `Criar Aposta`. A evidencia tecnica mais forte encontrada foi a tag `Combinable` em `tags`/`extra.tags`; tambem existem tags `BPWM` e `pm_boostable_market`, mas elas cobrem mais mercados e nao provam sozinhas que a odd entra no construtor.

Resultado da simulacao sem gravar no banco:

| Cenario | Odds entrada | Raw entries | Parsed | Skipped | Rows | `legacy_raw_*` | Fora do catalogo |
|---|---:|---:|---:|---:|---:|---:|---:|
| Todas as odds ativas | 4734 | 1216 | 369 | 847 | 311 | 0 | 58 |
| Apenas `Combinable` | 57 | 57 | 57 | 0 | 57 | 0 | 0 |
| Apenas impar/par | 6 | 6 | 6 | 0 | 6 | 0 | 0 |

Revisao de contrato de campos:

| Chamador | Campos de time | Status |
|---|---|---|
| `apps/jobs/src/extract-bookline-odds.mjs` | Normaliza `match.home_team/away_team` e `match.equipe_home/equipe_away` | OK, teste cobre os dois dialetos |
| `scripts/backfill-bookline-live-metadata.mjs` | Le de `odds.home_team/away_team`; mapper tambem aceitaria `equipe_home/equipe_away` | OK |
| `scripts/migrate-legacy-bookline-odds.mjs` | Import legado usa `home_team/away_team`; mapper agora e compativel com ambos | OK |

Simulacao adicional com `match.equipe_home/equipe_away`: `rows=311`, `out_of_catalog=58`, `legacy_raw_*=0`, handicaps `escanteios_handicap_total_ft_home_minus_5_5`, `escanteios_handicap_total_ft_away_plus_5_5`, `escanteios_handicap_total_ht_home_minus_2_5` e `escanteios_handicap_total_ht_away_plus_2_5` gravaveis.

Classificacao honesta:

- Se `Combinable` for a marca de `Criar Aposta`, o pipeline de mesa esta limpo para este response: 57/57 odds viram `mercado_key` canonico e todos existem no catalogo.
- `Total de Gols Ímpar/Par`, `Ímpar/Par - Escanteios` e `1º Tempo - Escanteios Ímpar/Par` existem com odds e agora parseiam corretamente, mas nesse payload nao tinham `Combinable`; devem ser tratados como candidatos de backtest/single, nao como mesa `Criar Aposta`, ate prova contraria.
- Player markets existem com odds, mas tambem sem `Combinable` neste response e seguem fora do motor por falta de contrato de jogador/settlement.
- `1º Tempo - {Time} - Marcar Gol` foi confirmado como fora do catalogo dos 50 escolhidos; nao foi adicionado ao registry e nao sera gravado como `legacy_raw_*`.

### As 58 linhas fora do registry no cenario todas-as-odds

Nenhuma dessas 58 apareceu no recorte `Combinable`; portanto nao bloqueia a mesa `Criar Aposta` se `Combinable` for a marca correta. Elas explicam apenas o cenario amplo de todas as odds ativas do JSON. O gap real de `Escanteios - Handicap` foi corrigido: Arsenal `-5.5` FT, Burnley `+5.5` FT, Arsenal `-2.5` HT e Burnley `+2.5` HT agora viram chaves canonicas de registry.

| Qtde | Mercado | Linhas/selecao | Motivo |
|---:|---|---|---|
| 16 | `Total de Escanteios da Equipe` | Arsenal Mais/Menos `8.5` a `13.5`; Burnley Mais/Menos `0.5` e `1.5` | Linhas por equipe fora do registry atual |
| 10 | `1º Tempo - Total de Escanteios` / equipe | Total Mais/Menos `1.5`, `7.5`, `8.5`, `9.5`; Arsenal equipe Mais/Menos `5.5` | Linhas HT fora do registry atual |
| 12 | `Total de Finalizações da Equipe` | Arsenal Mais/Menos `19.5`, `20.5`, `21.5`; Burnley Mais/Menos `5.5`, `6.5`, `7.5` | Linhas por equipe fora do registry atual |
| 4 | `1º Tempo - Finalizações Totais da Equipe` | Arsenal Mais/Menos `9.5`; Burnley Mais/Menos `2.5` | Linhas HT por equipe fora do registry atual |
| 6 | `Total de Chutes no Gol da Equipe` | Arsenal Mais/Menos `7.5`; Burnley Mais/Menos `0.5` e `1.5` | Linhas por equipe fora do registry atual |
| 8 | Gols total/equipe | `1º Tempo - Total de Gols 4.5`, `2º Tempo - Total de Gols 4.5`, Arsenal FT `4.5`, Arsenal HT `2.5` | Linhas fora do registry atual |
| 2 | `1º Tempo - Total de Impedimentos` | Mais/Menos `1.5` | Linha HT fora do registry atual |

## Classificacao dos 50 labels da tela

| Status | Labels |
|---|---|
| OK atual | `Resultado Final (1X2)`, `Dupla Chance`, `Ambas as Equipes Marcam` |
| OK atual | `1° Tempo - Cartões 1X2`, `1º Tempo - Total de Cartões`, `1º Tempo - Total de Cartões da Equipe`, `Equipe com Mais Cartões (1X2)`, `Total de Cartões da Equipe`, `Total de Cartões` |
| OK atual | `Equipe Com Mais Finalizações (1X2)`, `Equipe Com Mais Chutes no Gol (1X2)`, `Equipe Com Mais Escanteios (1X2)`, `1º Tempo - Finalizações 1X2`, `1º Tempo - Time com Mais Escanteios`, `Escanteios - Handicap`, `1º Tempo - Handicap de Escanteio` |
| OK atual | `1º Tempo - Total de Finalizações`, `1º Tempo - Finalizações Totais da Equipe`, `Total de Finalizações`, `Total de Finalizações da Equipe` |
| OK atual | `1º Tempo - Total de Chutes no Gol`, `1º Tempo - Chutes no Gol Totais da Equipe`, `Total de Chutes no Gol da Equipe`, `Total de Chutes no Gol` |
| OK atual | `1º Tempo - Total de Defesas do Goleiro`, `1º Tempo - Total de Defesas do Goleiro da Equipe`, `Total de Defesas do Goleiro da Equipe`, `Total de Defesas do Goleiro` |
| OK atual | `Total de Desarmes da Equipe`, `Total de Desarmes` |
| OK atual | `1º Tempo - Total de Escanteios`, `1º Tempo - Total de Escanteios da Equipe`, `Total de Escanteios da Equipe`, `Total de Escanteios` |
| OK atual | `1º Tempo - Total de Faltas`, `1º Tempo - Total de Faltas da Equipe`, `Total de Faltas da Equipe`, `Total de Faltas` |
| OK atual | `1º Tempo - Total de Gols`, `2º Tempo - Total de Gols`, `Total de Gols da Equipe`, `Total de Gols` |
| OK atual | `Total de Impedimentos`, `Total de Impedimentos da Equipe` |
| Fora do motor por decisao | `Jogador - Finalizações`, `Jogador - Chutes no Gol`, `Jogador - Faltas Cometidas` |
| OK atual / backtest candidato | `Ímpar/Par - Escanteios`, `Total de Gols Ímpar/Par`, `1º Tempo - Escanteios Ímpar/Par` |

## Pendencias reais

1. Reexecutar backtest e recalibracao sobre o catalogo `2.1.1` antes de declarar validade estatistica dos 598 slots.
2. Se quiser usar mercados de jogador, criar contrato separado de parser, features de jogador e settlement; eles nao foram ativados no motor.
3. Backfill opcional: atualizar `odds.mercado_key` historico para remover `legacy_raw_*` dos labels corrigidos no banco atual.

## Validacao

- `node --test packages/superbet-scraper/test/scraper.test.mjs apps/jobs/test/migrate-legacy-bookline-odds.test.mjs apps/jobs/test/extract-bookline-odds.test.mjs apps/api/test/superbet-mapping.test.mjs packages/markets/test/registry.test.mjs packages/engine-a/test/lambda-mult.test.mjs` -> 47 pass, 0 fail.
- `npm test` -> 210 pass, 0 fail.
- `npm run lint` -> 0 errors, 46 warnings preexistentes.