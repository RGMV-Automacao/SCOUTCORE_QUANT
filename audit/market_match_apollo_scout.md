# Match de Mercados: ApolloFinalV2 x Apollo src/motor x Scout

## Fontes comparadas
- ApolloFinalV2: C:/Users/Rogerio/Desktop/RGMV_PROJETOS/SOLUCAO_IA/opta-extractor/ApolloFinalV2/config/market-config.json
- Apollo src/motor: C:/Users/Rogerio/Desktop/RGMV_PROJETOS/SOLUCAO_IA/opta-extractor/src/motor/config/market-config.json
- Scout: packages/markets/src/registry.mjs

## Resultado do match
Os dois catálogos Apollo têm a mesma superfície base de famílias:
- cartoes
- chutes
- escanteios
- faltas
- finalizacoes
- gols
- impedimentos

No Apollo, Resultado Final e Dupla Chance entram via product-contract.json.

## Normalização Apollo -> Scout
| Apollo | Scout |
|---|---|
| gols.total/equipe/1T | gols |
| gols.btts | btts |
| escanteios.total/equipe/1T | escanteios |
| cartoes.total/equipe/1T | cartoes |
| finalizacoes.total/equipe/1T | chutes |
| chutes no gol.total/equipe/1T | chutes_alvo |
| faltas.total/equipe/1T | faltas |
| impedimentos.total/equipe/1T | impedimentos |
| Resultado Final | 1x2 |
| Dupla Chance | dupla |

## Famílias removidas do catálogo Scout nesta mudança
- btts_ambos_tempos (2 mercados)
- correct_score (38 mercados)
- dnb (6 mercados)
- escanteios_asian (12 mercados)
- escanteios_exato (16 mercados)
- handicap (12 mercados)
- marca (4 mercados)
- marca_primeiro (3 mercados)
- marca_ultimo (3 mercados)
- margem (9 mercados)

Total removido: 105 mercados

## Catálogo Scout após o corte
- 18 famílias ativas
- 471 mercados ativos

Famílias Scout ainda fora da superfície Apollo normalizada:
- asian_handicap (16)
- asian_total (18)
- btts_algum_tempo (2)
- cartoes_1x2 (3)
- defesas (26)
- escanteios_1x2 (6)
- escanteios_race (9)
- htft (9)

## Observação
O corte aplicado nesta sessão seguiu exatamente a lista pedida pelo usuário. As famílias acima continuam no Scout e representam drift remanescente em relação à superfície Apollo atual.
