# Auditoria — Respostas e Vereditos

Atualizado em: 2026-05-15

Este arquivo centraliza a revisão dos itens de auditoria enviados na conversa.

Critérios de veredito:
- Verdadeiro: a afirmação bate com o código e com o comportamento atual.
- Parcialmente verdadeiro: existe um fundo correto, mas a redação distorce o estado real.
- Falso: a afirmação contradiz o código atual.
- Desatualizado: poderia ter sido verdade antes, mas não representa mais o sistema atual.
- Não verificável: faltam evidências suficientes no repositório ou no runtime atual.

## E6 — Engine B (ML/XGBoost Python)

Finding original:

| Componente | Regra | Motor Legado | Motor Unificado | Status |
| --- | --- | --- | --- | --- |
| ENGINE | E6 | Engine B (ML/XGBoost Python) integrado (match-engine) | Não existe — Curinga assume slotsB=null | Gap arquitetural (design consciente) |

Veredito: Parcialmente verdadeiro

Pode desconsiderar do jeito que está: Sim

Resumo:
- A parte "Engine B não existe" não é verdadeira no sistema atual.
- O Engine B existe no motor unificado como sidecar Python consumido por bridge HTTP.
- O que é verdadeiro é que o Curinga aceita slotsB=null e degrada para A-only quando o sidecar B está indisponível ou sem slots.
- Portanto, o finding atual mistura duas coisas diferentes: inexistência do Engine B e fallback de indisponibilidade. Só a segunda parte está correta.

Evidências no código:
- apps/api/src/predict.mjs: o pipeline chama explicitamente o Engine B e documenta a degradação para A puro.
  - Ver comentário em ../apps/api/src/predict.mjs:119 e chamada em ../apps/api/src/predict.mjs:124.
- packages/engine-b-bridge/src/index.mjs: existe um cliente HTTP dedicado para o sidecar Python, com versão declarada e contrato predictBatch().
  - Ver ../packages/engine-b-bridge/src/index.mjs:11 e ../packages/engine-b-bridge/src/index.mjs:36.
- apps/api/src/engine-signature.mjs: a assinatura da API expõe model_b_version.
  - Ver ../apps/api/src/engine-signature.mjs:97.
- packages/curinga/src/index.mjs: o combine aceita slotsB = null e marca divergence_resolved_by como engine_b_unavailable ou engine_b_no_slot.
  - Ver ../packages/curinga/src/index.mjs:73, ../packages/curinga/src/index.mjs:74, ../packages/curinga/src/index.mjs:86 e ../packages/curinga/src/index.mjs:121.

Leitura honesta:
- No motor unificado atual, o Engine B existe e está integrado.
- A integração não é rígida: se o sidecar falhar, o sistema continua com Engine A puro.
- Isso caracteriza fallback consciente e degradação graciosa, não ausência do Engine B.

Formulação mais precisa para substituir o finding:

| Componente | Regra | Motor Legado | Motor Unificado | Status |
| --- | --- | --- | --- | --- |
| ENGINE | E6 | Engine B (ML/XGBoost Python) integrado ao orquestrador | Engine B integrado via sidecar Python + bridge HTTP; em indisponibilidade, Curinga degrada para A-only | Diferença arquitetural, sem gap funcional de inexistência |

Observação:
- Se a auditoria quiser destacar um risco real, o texto correto é dependência operacional do sidecar B e cobertura degradável, não inexistência do Engine B.

---

## C1 — Blend A/B com pesos dinâmicos

Finding original:

| Componente | Regra | Motor Legado | Motor Unificado | Status |
| --- | --- | --- | --- | --- |
| CURINGA | C1 | Pesos estáticos — w_a/w_b por família em product-contract.json | Pesos dinâmicos via ewma_brier (menor Brier score → maior peso) | Superior |

Veredito: Parcialmente verdadeiro

Pode desconsiderar do jeito que está: Sim

Resumo:
- O motor unificado realmente usa pesos dinâmicos por family::liga com base em ewma_brier.
- Mas o legado não era apenas estático. Ele tinha priors por família no product-contract.json, com override por blend_weights vindos do banco quando havia amostra suficiente.
- Esses blend_weights do legado eram atualizados por Brier no settler, então a frase "pesos estáticos" simplifica demais e distorce o comportamento real.
- A palavra "Superior" não é auditável só pelo código. Ela exigiria benchmark de qualidade out-of-sample.

Evidências no código atual:
- packages/curinga/src/index.mjs: pesos dinâmicos por ewma_brier e family::liga em ../packages/curinga/src/index.mjs:34, ../packages/curinga/src/index.mjs:39, ../packages/curinga/src/index.mjs:45, ../packages/curinga/src/index.mjs:101 e ../packages/curinga/src/index.mjs:104.

Evidências no legado:
- src/motor/config/product-contract.json: priors por família em linhas 45, 47, 49, 53 e 54.
- src/motor/curinga.js: getFamilyWeights() prioriza blend_weights do banco em vez do contrato quando há amostra suficiente, em linhas 47 e 64.
- src/motor/settler.js: os blend weights eram atualizados dinamicamente por avg_brier_a/avg_brier_b e EWMA lenta em linhas 491, 496, 497, 501, 502, 505 e 511.

Leitura honesta:
- Atual: blend mais diretamente dinâmico e contextualizado por family::liga.
- Legado: blend híbrido, com prior estático por família mais correção dinâmica persistida no banco.
- Diferença real existe, mas "estático vs dinâmico" está simplificado demais.

Formulação mais precisa para substituir o finding:

| Componente | Regra | Motor Legado | Motor Unificado | Status |
| --- | --- | --- | --- | --- |
| CURINGA | C1 | Blend híbrido: prior por família no contrato, com override dinâmico por blend_weights do banco quando há amostra | Pesos dinâmicos por family::liga via ewma_brier, com reliability boost heurístico | Diferença arquitetural real; superioridade depende de benchmark |

---

## C2 — Consensus (divergência pequena)

Finding original:

| Componente | Regra | Motor Legado | Motor Unificado | Status |
| --- | --- | --- | --- | --- |
| CURINGA | C2 | |diff| < 10pp → média ponderada | divPp ≤ 5pp → consensus | Threshold mais rígido (5pp vs 10pp; mais slots vão para calibration) |

Veredito: Falso como está escrito

Pode desconsiderar do jeito que está: Sim

Resumo:
- O motor unificado realmente usa consensus com divPp ≤ 5pp.
- Mas o legado não usava "10pp" de probabilidade. Ele usava divergência em fair odd absoluta: divergence < 0.10.
- Portanto, a comparação "5pp vs 10pp" mistura unidades diferentes e não é defensável do jeito que está.

Evidências no código atual:
- packages/curinga/src/index.mjs: threshold de consensus em ../packages/curinga/src/index.mjs:17 e ../packages/curinga/src/index.mjs:201.

Evidências no legado:
- src/motor/curinga.js: divergência calculada como abs(fair_odd_a - fair_odd_b) na linha 109.
- src/motor/curinga.js: consensus quando divergence < 0.10 nas linhas 122 e 133.

Leitura honesta:
- O threshold atual é explícito e estreito em pontos percentuais de probabilidade.
- O threshold legado era em delta absoluto de fair odd.
- Os dois critérios podem gerar comportamentos diferentes, mas não dá para resumir isso como "5pp vs 10pp" sem converter a métrica.

Formulação mais precisa para substituir o finding:

| Componente | Regra | Motor Legado | Motor Unificado | Status |
| --- | --- | --- | --- | --- |
| CURINGA | C2 | Consensus quando abs(fair_odd_a - fair_odd_b) < 0.10 | Consensus quando divPp ≤ 5pp | Critérios diferentes; comparação direta exige normalizar unidade |

---

## C4 — Flagged (divergência alta)

Finding original:

| Componente | Regra | Motor Legado | Motor Unificado | Status |
| --- | --- | --- | --- | --- |
| CURINGA | C4 | |diff| ≥ 30pp → certified=false | divPp ≥ 15pp OU fairOddDeltaPct ≥ 20% → certified=false | Threshold mais rígido (flag mais agressivo; impacto no recall de slots) |

Veredito: Parcialmente verdadeiro

Pode desconsiderar do jeito que está: Sim

Resumo:
- O motor unificado de fato é mais agressivo para marcar flagged: usa duas condições, divPp ≥ 15 ou fairOddDeltaPct ≥ 20%.
- Mas o trecho do legado está escrito na unidade errada. O legado não usava 30pp de probabilidade; usava divergence ≥ 0.30 em fair odd absoluta.
- Então a conclusão qualitativa pode até apontar na direção certa, mas a comparação numérica está incorreta.

Evidências no código atual:
- packages/curinga/src/index.mjs: thresholds em ../packages/curinga/src/index.mjs:18, ../packages/curinga/src/index.mjs:20, ../packages/curinga/src/index.mjs:198 e ../packages/curinga/src/index.mjs:199.

Evidências no legado:
- src/motor/curinga.js: divergência medida em fair odd absoluta na linha 109.
- src/motor/curinga.js: faixa de calibration até divergence < 0.30 na linha 135, logo flagged para divergence ≥ 0.30.
- src/motor/curinga.js: flagged derruba certified=false e aplica confiança conservadora no bloco logo abaixo da linha 135.

Leitura honesta:
- Atual: flagged mais cedo e por mais de um gatilho.
- Legado: flagged só quando o delta de fair odd passava de 0.30.
- Existe endurecimento real no motor atual, mas a comparação correta é entre métricas diferentes, não entre 15pp e 30pp.

Formulação mais precisa para substituir o finding:

| Componente | Regra | Motor Legado | Motor Unificado | Status |
| --- | --- | --- | --- | --- |
| CURINGA | C4 | Flagged quando abs(fair_odd_a - fair_odd_b) ≥ 0.30; certified=false | Flagged quando divPp ≥ 15 ou fairOddDeltaPct ≥ 20%; certified=false | Endurecimento real, mas com mudança de métrica |

---

## C5 — A-Only (B indisponível)

Finding original:

| Componente | Regra | Motor Legado | Motor Unificado | Status |
| --- | --- | --- | --- | --- |
| CURINGA | C5 | confidence × 0.85 (penalidade explícita) | wA=1, wB=0 — SEM penalidade de confiança | Bloqueante — A-only factor 0.85 não portado |

Veredito: Verdadeiro no mérito técnico, com ressalva de severidade

Pode desconsiderar do jeito que está: Não

Resumo:
- No legado, a penalidade A-only de 0.85 existia explicitamente no contrato e era aplicada no Curinga quando o slot B não existia.
- No motor unificado atual, o A-only vira weight_a=1, weight_b=0 e não existe multiplicador equivalente de 0.85 no Curinga.
- Depois disso, a confidence é recalculada no predict por baseConfidence × qg_confidence, com ajuste opcional por Brier, mas sem uma penalidade específica para engine_b_unavailable ou engine_b_no_slot.
- Portanto, o drift técnico é real: o fator 0.85 do legado não foi portado.

Evidências no legado:
- src/motor/config/product-contract.json: a_only_confidence_factor = 0.85 na linha 43.
- src/motor/curinga.js: constante em linha 33; regra A-only em linha 116; aplicação da penalidade em linha 119.

Evidências no código atual:
- packages/curinga/src/index.mjs: A-only usa weight_a=1 e weight_b=0 em ../packages/curinga/src/index.mjs:83, ../packages/curinga/src/index.mjs:84, ../packages/curinga/src/index.mjs:86, ../packages/curinga/src/index.mjs:119 e ../packages/curinga/src/index.mjs:121.
- apps/api/src/predict.mjs: confidence recalculada depois do Curinga em ../apps/api/src/predict.mjs:203, ../apps/api/src/predict.mjs:205, ../apps/api/src/predict.mjs:206 e ../apps/api/src/predict.mjs:207.
- apps/api/src/predict.mjs: ranking usa score = edge_pct × confidence em ../apps/api/src/predict.mjs:228 e ../apps/api/src/predict.mjs:242.
- apps/api/src/predict.mjs: computeBrierConfidence usa apenas weight_a/weight_b e ewma_brier, sem penalidade A-only explícita, em ../apps/api/src/predict.mjs:593, ../apps/api/src/predict.mjs:598, ../apps/api/src/predict.mjs:599, ../apps/api/src/predict.mjs:607 e ../apps/api/src/predict.mjs:611.

Leitura honesta:
- Se o objetivo é manter paridade comportamental com o legado, esse finding procede.
- Se o objetivo é só ter um pipeline funcional, o sistema continua funcionando, mas com drift de ranking e priorização para slots A-only.
- Eu não chamaria de "bloqueante" em termos absolutos de operação, mas chamaria de gap real e relevante para paridade e ordenação de EV.

Formulação mais precisa para substituir o finding:

| Componente | Regra | Motor Legado | Motor Unificado | Status |
| --- | --- | --- | --- | --- |
| CURINGA | C5 | A-only recebe penalidade explícita de confidence × 0.85 | A-only vira weight_a=1, weight_b=0, sem penalidade específica de confidence; downstream recalcula confidence sem regra equivalente | Gap funcional real; severidade depende da exigência de paridade com o legado |

---

## T6 — Trusted Families: resultado / 1x2 / dupla

Finding original:

| Componente | Regra | Motor Legado | Motor Unificado | Status |
| --- | --- | --- | --- | --- |
| STRATEGY | T6 | Trusted families: {gols, btts, resultado, dupla_chance} | ✅ (resultado → 1x2? verificar alias) | Verificar mapeamento |

Veredito: Gap real

Pode desconsiderar do jeito que está: Não

Resumo:
- No legado, trusted families eram gols, btts, resultado e dupla_chance.
- No strategy-engine atual, o combinator e a config do Yankee continuam usando resultado e dupla_chance.
- Só que o catálogo canônico novo usa family 1x2 e dupla, não resultado e dupla_chance.
- Portanto, o status atual não é ✅. Há drift real de nomenclatura e ele afeta score e seleção.

Evidências no código atual:
- packages/strategy-engine/src/lib/combinator.mjs: TRUSTED_FAMILIES ainda usa resultado e dupla_chance em linhas 11, 13 e 75.
- packages/strategy-engine/config/strategies/yankee.json: trusted_families ainda usa resultado e dupla_chance na linha 23.
- packages/strategy-engine/config/strategies/bingo-resultado.json: mistura resultado, 1x2 e dupla_chance na linha 7.
- packages/strategy-engine/test/engine-e2e.test.mjs: o próprio teste aceita resultado, 1x2 e dupla_chance nas linhas 124 e 127, sinal de transição incompleta.
- packages/markets/src/registry.mjs: o catálogo canônico atual registra btts_total_*, 1x2_total_* e dupla_total_* nas linhas 52, 64 e 67.

Leitura honesta:
- O drift não é só resultado → 1x2.
- Existe também dupla_chance → dupla.
- Isso pode reduzir trusted_count e quality_score para slots canônicos atuais de 1x2/dupla, além de enviesar filtros por família.

Formulação mais precisa para substituir o finding:

| Componente | Regra | Motor Legado | Motor Unificado | Status |
| --- | --- | --- | --- | --- |
| STRATEGY | T6 | Trusted families: gols, btts, resultado, dupla_chance | Strategy-engine ainda carrega nomes legado, enquanto o catálogo canônico usa 1x2 e dupla | Gap funcional real de alias/migração |

---

## S3 — Fallback LLM do Scout

Finding original:

| Componente | Regra | Motor Legado | Motor Unificado | Status |
| --- | --- | --- | --- | --- |
| SCOUT | S3 | Claude Sonnet 4.6 quando GPT-4o falha | Nenhum — retorna empty overlay | Bloqueante — resiliência reduzida |

Veredito: Verdadeiro no mérito técnico, com ressalva de severidade

Pode desconsiderar do jeito que está: Não

Resumo:
- O legado tinha fallback explícito GPT-4o → Claude Sonnet 4.6.
- O Scout atual usa GPT-4o como cérebro único; em falha, retorna emptyOverlay com skip_reason openai_failed.
- Portanto, a redução de resiliência é real.
- Eu não chamaria isso de bloqueante para o motor base, porque o Scout é opt-in e a predição continua sem overlay. Mas é um gap real se a operação depende da camada Scout para red flags.

Evidências no legado:
- src/motor/scout.js: comentário de fallback Claude em linha 9.
- src/motor/scout.js: implementação de callClaude em linha 126.
- src/motor/scout.js: runScout tenta GPT-4o e faz fallback Claude nas linhas 273, 285, 287, 291, 293 e 294.

Evidências no código atual:
- packages/scout/src/index.mjs: emptyOverlay em linha 447.
- packages/scout/src/index.mjs: runScout retorna emptyOverlay em falha OpenAI na linha 497.
- packages/scout/src/index.mjs: não há callClaude nem callAnthropic no pacote atual.

Formulação mais precisa para substituir o finding:

| Componente | Regra | Motor Legado | Motor Unificado | Status |
| --- | --- | --- | --- | --- |
| SCOUT | S3 | GPT-4o primário com fallback Claude Sonnet 4.6 | GPT-4o único; falha devolve empty overlay com skip_reason | Gap real de resiliência do Scout, não do motor base |

---

## M12 — Formato de market_key

Finding original:

| Componente | Regra | Motor Legado | Motor Unificado | Status |
| --- | --- | --- | --- | --- |
| MARKETS | M12 | Apollo canonical: gols_total_ft_over_25 | Kebab canônico: gols_total_ft_over_2_5 | Incompatível — quebra integração DB/API |

Veredito: Parcialmente verdadeiro

Pode desconsiderar do jeito que está: Sim

Resumo:
- A incompatibilidade de market_key entre legado e catálogo canônico atual existe de fato.
- Mas a frase "quebra integração DB/API" está ampla demais.
- No runtime atual, parte dessa diferença já é absorvida por normalizações específicas.
- O gap real é de interoperabilidade entre artefatos legado e consumidores que não forneçam alias map ou tradução compartilhada.

Evidências do legado / dialeto antigo:
- src/motor/contracts.js: market_key Apollo canônico em linha 21.
- src/motor/audit-export.js: exemplos gols_total_ft_over_25, btts_ft_sim, resultado_1x2_ft_home e escanteios_total_ft_over_95 nas linhas 30, 38, 40 e 55.
- packages/superbet-scraper/src/index.mjs: pacote atual ainda expõe snapshot em dialeto legado; ver comentário de reescrita do odds-service na linha 2, export fetchOddsSnapshot na linha 175, e chaves btts_/resultado_1x2_/resultado_dupla_ nas linhas 198, 202 e 205.

Evidências do canônico atual:
- packages/markets/src/registry.mjs: exemplos canônicos na documentação das linhas 6 a 9.
- packages/markets/src/registry.mjs: chaves btts_total_*, 1x2_total_* e dupla_total_* nas linhas 52, 64 e 67.

Mitigações já existentes no runtime atual:
- apps/api/src/predict.mjs: normalizeOddsSnapshot aceita market_alias_map nas linhas 56 e 569.
- packages/engine-b-bridge/src/index.mjs: canonicaliza btts_sim e 1x2_home/draw/away para o formato novo nas linhas 80 a 85.
- apps/api/src/routes/runs.mjs: /v1/run usa buildDbOddsResolver na linha 193 e injeta esse resolver na linha 254.
- scripts/lib/superbet-mapping.mjs: resolve odds do banco a partir do canônico novo; ver buildLookupPlan na linha 67 e regras para 1x2, dupla, btts e gols nas linhas 72, 89, 244 e 273.

Leitura honesta:
- Misturar snapshot legado diretamente com /v1/predict sem alias map pode falhar no lookup de odds.
- Cruzar histórico legado com market_keys novos para EWMA/auditoria também pode falhar sem tradução.
- Mas não é correto dizer que o pipeline atual inteiro está quebrado por isso, porque há adaptações locais já implementadas.

Formulação mais precisa para substituir o finding:

| Componente | Regra | Motor Legado | Motor Unificado | Status |
| --- | --- | --- | --- | --- |
| MARKETS | M12 | Dialeto Apollo legado (ex: gols_total_ft_over_25, resultado_1x2_ft_home) | Catálogo canônico novo (ex: gols_total_ft_over_2_5, 1x2_total_ft_home, dupla_total_ft_1x) | Incompatibilidade real de interoperabilidade; runtime atual tem mitigações parciais |

---

## I1 — Odds scraper Superbet

Finding original:

| Componente | Regra | Motor Legado | Motor Unificado | Status |
| --- | --- | --- | --- | --- |
| INFRA | I1 | odds-service.js com fuzzy match | Responsabilidade do cliente (injeção via API) | Gap operacional |

Veredito: Desatualizado / parcialmente falso

Pode desconsiderar do jeito que está: Sim

Resumo:
- O repositório atual já tem um package portado do odds-service legado: @scoutcore/superbet-scraper.
- Esse package já é usado em jobs para popular o banco de odds.
- Além disso, o fluxo /v1/run não depende do cliente injetar odds; ele usa um resolver de odds em cima do banco.
- O ponto real é outro: o endpoint /v1/predict puro continua dependendo de odds_snapshot ou market_alias_map quando chamado sem resolver.

Evidências no código atual:
- packages/superbet-scraper/src/index.mjs: reescrita ESM do odds-service legado na linha 2.
- apps/jobs/src/fetch-superbet-odds.mjs: uso real do package nas linhas 2, 24, 27 e 111.
- apps/api/src/routes/runs.mjs: buildDbOddsResolver na linha 193 e uso dentro de /v1/run na linha 254.
- apps/api/src/predict.mjs: o endpoint puro normaliza odds_snapshot recebido do request nas linhas 56 e 569.

Leitura honesta:
- O scraper não está ausente.
- O acoplamento mudou: scraping/ingestão virou responsabilidade de job + banco, e o predict puro permaneceu desacoplado.
- Se a crítica for "não existe fetch live opt-in dentro do /v1/predict", isso faz sentido. Se a crítica for "o sistema atual não tem odds-service", isso está desatualizado.

Formulação mais precisa para substituir o finding:

| Componente | Regra | Motor Legado | Motor Unificado | Status |
| --- | --- | --- | --- | --- |
| INFRA | I1 | odds-service integrado ao motor legado | superbet-scraper portado e usado em jobs; /v1/run resolve odds do banco; /v1/predict puro segue desacoplado e aceita snapshot/alias map | Diferença arquitetural real, sem ausência do scraper |

---

## I2 — Product Contract centralizado

Finding original:

| Componente | Regra | Motor Legado | Motor Unificado | Status |
| --- | --- | --- | --- | --- |
| INFRA | I2 | product-contract.json v2.0.0 centralizado | Disperso em strategy/*.json + gates runtime | Governança fragmentada |

Veredito: Parcialmente verdadeiro

Pode desconsiderar do jeito que está: Não

Resumo:
- O motor atual realmente não tem um único product-contract.json equivalente ao legado.
- Há uma parte centralizada em config/quality-gates.json.
- Mas parâmetros de estratégia vivem em packages/strategy-engine/config/strategies/*.json, e outras decisões relevantes seguem hardcoded em código, como thresholds do Curinga e TRUSTED_FAMILIES do combinator.
- Portanto, a fragmentação de governança é real, embora a descrição "só strategy/*.json + runtime" ainda simplifique demais.

Evidências no código atual:
- packages/quality-gates/src/index.mjs: carrega config/quality-gates.json como fonte central de QG no topo do arquivo.
- packages/strategy-engine/src/index.mjs: carrega configs JSON do diretório de estratégias no topo do arquivo.
- packages/strategy-engine/src/runners/board_based.mjs: extrai gates e defaults a partir dos params nas linhas 12 a 39.
- packages/strategy-engine/src/lib/combinator.mjs: TRUSTED_FAMILIES e FAMILY_RELIABILITY hardcoded nas linhas 11 e 13.
- packages/curinga/src/index.mjs: thresholds e FAMILY_RELIABILITY hardcoded nas linhas 17 a 31.

Leitura honesta:
- Existe centralização parcial.
- Não existe uma única fonte de verdade com a abrangência do product-contract legado.
- Isso é um problema real de governança e drift.

Formulação mais precisa para substituir o finding:

| Componente | Regra | Motor Legado | Motor Unificado | Status |
| --- | --- | --- | --- | --- |
| INFRA | I2 | product-contract.json como fonte dominante de gates e pesos | Configuração dividida entre quality-gates.json, strategy configs e constantes em código | Fragmentação real de governança |

---

## Bloco 3 — Análise crítica da arquitetura

### 3.1 Engine A por contexto injetado

Veredito: Faz sentido

Resumo:
- A leitura arquitetural está correta: o Engine A atual é puro e recebe profileHome, profileAway e priors por contexto, em vez de acoplar ao banco.
- Isso o torna testável e mais modular.
- O risco apontado também faz sentido: não encontrei schema Zod específico para profileHome/profileAway nem checagem de staleness antes do predict().

Evidências:
- packages/engine-a/src/engine.mjs: computeLambdas depende de profileHome/profileAway/priors nas linhas 45, 47, 50 e 53.
- packages/engine-a/src/engine.mjs: predict(ctx) é puro e exportado na linha 254.
- apps/api/src/predict.mjs: o boundary validado é o request via PredictRequestZ; os perfis são obtidos depois pelo repo.
- packages/contracts/src/index.mjs: existe PredictRequestZ, mas não encontrei ProfileZ dedicado.

Conclusão:
- A recomendação de validar profiles e staleness antes da execução faz sentido.
- É melhoria válida, não correção de bug comprovado.

### 3.2 Odds service, latência e acoplamento

Veredito: Parcialmente verdadeiro

Resumo:
- A crítica de acoplamento faz sentido para o endpoint /v1/predict puro.
- Mas ela ignora que o repositório atual já tem o scraper portado, um job de ingestão e um resolver de odds no /v1/run.
- Então o risco de delay de 30s não é uma propriedade única do "novo motor"; depende do pipeline operacional adotado.

Conclusão:
- A recomendação de expor um cliente opt-in faz sentido em espírito.
- Na prática, já existe base portável em @scoutcore/superbet-scraper; o trabalho é mais de wiring/normalização do que de port do zero.

### 3.3 Market key incompatibilidade

Veredito: Alta criticidade para interoperabilidade legado↔novo, mas não destruição universal do runtime atual

Resumo:
- A incompatibilidade é real e séria quando você mistura histórico legado, snapshots legados e catálogo novo sem tradução.
- Mas a tabela do texto exagera o impacto ao dizer que toda integração DB/API quebra.
- Dentro do runtime atual já existem remendos locais: engine-b-bridge canonicaliza parte das chaves, /v1/predict aceita alias map e /v1/run usa mapping do canônico novo para odds do banco.

---

## Bloco 4/5 — Julgamento dos GAPs remanescentes

- GAP-01: vide C5. Gap real; severidade depende da exigência de paridade com o legado.
- GAP-02: deriva de M12. Faz sentido como gap de interoperabilidade, mas não como quebra universal do sistema atual.
- GAP-03: deriva de S3. Gap real de resiliência do Scout. Não bloqueia o motor base, mas enfraquece a camada de auditoria.
- GAP-04: vide C2 e C4. Há endurecimento real no atual, mas a comparação original mistura métricas diferentes e precisa de validação empírica antes de mudar threshold.
- GAP-05: deriva de I2. Faz sentido.
- GAP-06: deriva de T6. Faz sentido e é mais grave do que o texto original sugeria, porque envolve 1x2 e também dupla.
- GAP-07: do jeito que está escrito, não faz sentido. O odds service não está ausente; o ponto correto é que ele não está ligado como fetch live opt-in no boundary puro de /v1/predict.

---

## Bloco 6 — Vantagens técnicas do motor atual

Confirmadas no código:
- Pesos dinâmicos no Curinga.
- Family reliability shift heurístico no Curinga.
- checkContradiction no combinator e runners.
- Seleção de board com diversityBoost em duas passagens.
- capScoutScore no Scout.
- Slot form history no prompt do Scout.
- Regime hints no Scout.
- Mercados expandidos no registry.
- Arquitetura modular por packages.
- Validação Zod no boundary de request/response.

Parciais / com ressalva:
- Contratos Zod runtime: confirmado no boundary da API, mas não encontrei validação Zod específica do ctx interno do Engine A.
- Regime hints para Curinga: não encontrei evidência de uso no Curinga; a evidência encontrada é no Scout.
- Superioridade quantitativa: não auditável só pelo código.

Não verificável com honestidade a partir do que foi lido:
- "18 de 35 dimensões auditadas".
- "13 equivalentes".
- "todos endereçáveis em menos de uma sprint".

---

## Bloco 8 — Veredicto sobre o texto completo

Síntese honesta:
- O texto mistura achados corretos com alguns exageros e alguns itens já desatualizados.
- Faz sentido manter como gaps reais: C5/A-only factor, S3/fallback do Scout, T6/trusted families alias, I2/governança fragmentada e M12/interoperabilidade de market_key.
- Faz sentido rejeitar ou reescrever: I1 como "ausência do odds service", C2/C4 quando comparam thresholds em unidades erradas, e qualquer frase que trate M12 como quebra universal do runtime atual.
- A conclusão global de que o motor atual é mais modular e mais maduro faz sentido qualitativamente.
- A contagem exata de dimensões, o número de bloqueantes e a estimativa de sprint não são auditáveis com sinceridade a partir apenas do código e dos checks feitos aqui.

---

## Plano objetivo de correção por impacto

Escopo deste plano:
- Inclui apenas gaps reais confirmados no código atual.
- Exclui itens rejeitados, desatualizados ou dependentes de benchmark antes de qualquer mudança.
- Ordem pensada para reduzir primeiro drift funcional em ranking, matching e resiliência.

### P0 — Corrigir drift funcional direto no output

#### P0.1 — Portar penalidade A-only no Curinga

Motivo:
- Gap confirmado em C5.
- Afeta confidence e, por consequência, o score edge_pct × confidence e a ordenação final dos slots.

Objetivo:
- Reintroduzir penalidade explícita para slots A-only, preservando o comportamento legado quando B estiver indisponível ou sem slot correspondente.

Arquivos-alvo:
- packages/curinga/src/index.mjs
- apps/api/src/predict.mjs
- packages/curinga/test/curinga.test.mjs

Mudança mínima sugerida:
- Quando o slot sair como engine_b_unavailable ou engine_b_no_slot, carregar uma marca explícita no provenance.
- Aplicar fator multiplicador de confidence equivalente ao legado antes do ranking final, sem conflitar com os multiplicadores já existentes de QG e Brier.

Critério de aceite:
- Slot A-only passa a sair com confidence menor que o slot equivalente A+B, tudo o mais constante.
- Ranking final reflete essa penalidade.
- Testes cobrindo engine_b_unavailable e engine_b_no_slot passam.

#### P0.2 — Corrigir aliases de família no strategy-engine

Motivo:
- Gap confirmado em T6.
- Hoje 1x2 e dupla canônicos podem perder trusted_count, quality_score e encaixe limpo em estratégias que ainda pensam em resultado e dupla_chance.

Objetivo:
- Tornar strategy-engine consistente com o catálogo canônico atual sem quebrar compatibilidade com dados de transição.

Arquivos-alvo:
- packages/strategy-engine/src/lib/combinator.mjs
- packages/strategy-engine/config/strategies/yankee.json
- packages/strategy-engine/config/strategies/bingo-resultado.json
- packages/strategy-engine/test/engine-e2e.test.mjs

Mudança mínima sugerida:
- Incluir 1x2 e dupla na camada de trusted families e reliability.
- Decidir se resultado e dupla_chance permanecem como aliases transitórios ou se serão removidos após normalização total.

Critério de aceite:
- Slots de family 1x2 e dupla recebem o mesmo tratamento estrutural esperado para resultado e dupla_chance.
- Estratégias bingo-resultado e Yankee aceitam o dialeto canônico atual sem perda de score.
- Testes explicitam essa paridade.

#### P0.3 — Criar tradução canônica compartilhada de market_key

Motivo:
- Gap confirmado em M12.
- Hoje existem mitigações locais, mas a tradução ainda está fragmentada: parte no engine-b-bridge, parte por alias map do request, parte no superbet-scraper em dialeto legado e parte no mapper do banco.

Objetivo:
- Ter uma única função de tradução/normalização de market_key entre dialeto legado e canônico atual.

Arquivos-alvo:
- packages/markets/src/index.mjs ou novo módulo em packages/markets/src
- packages/engine-b-bridge/src/index.mjs
- packages/superbet-scraper/src/index.mjs
- apps/api/src/predict.mjs
- scripts/lib/superbet-mapping.mjs

Mudança mínima sugerida:
- Centralizar translateLegacyMarketKey() e normalizeMarketKey().
- Fazer engine-b-bridge, superbet-scraper e predict consumirem essa tradução compartilhada.
- Manter compatibilidade de leitura com snapshots legados, mas padronizar saída interna no canônico novo.

Critério de aceite:
- Exemplo legado → novo funciona para pelo menos: gols_total_ft_over_25, btts_ft_sim, resultado_1x2_ft_home, resultado_dupla_ft_1x e escanteios_total_ft_over_95.
- /v1/predict aceita snapshot legado com tradução centralizada, sem depender de alias map ad hoc para os casos suportados.
- Resolver de odds, engine-b-bridge e scraper param de reimplementar pedaços diferentes da mesma tradução.

### P1 — Corrigir resiliência e governança

#### P1.1 — Reintroduzir fallback LLM no Scout

Motivo:
- Gap confirmado em S3.
- Não bloqueia o motor base, mas reduz a utilidade operacional do Scout em falhas de OpenAI.

Objetivo:
- Restaurar fallback explícito para um segundo provedor no Scout opt-in.

Arquivos-alvo:
- packages/scout/src/index.mjs
- packages/scout/test/scout.test.mjs
- apps/api/src/predict.mjs se precisar propagar configuração

Mudança mínima sugerida:
- Manter GPT-4o como primário.
- Em erro do OpenAI, tentar provedor secundário antes de retornar emptyOverlay.
- Se ambos falharem, manter comportamento honesto atual com skip_reason explícito.

Critério de aceite:
- Falha simulada do OpenAI não silencia o Scout quando o provedor secundário está disponível.
- Falha dupla continua retornando overlay vazio com motivo explícito.

#### P1.2 — Consolidar governança de parâmetros centrais

Motivo:
- Gap confirmado em I2.
- Hoje há mistura entre quality-gates.json, strategy configs e constantes em código.

Objetivo:
- Reduzir drift entre estratégia, QG, Curinga e combinator sem tentar resolver tudo em uma única refatoração grande.

Arquivos-alvo:
- config/quality-gates.json
- packages/quality-gates/src/index.mjs
- packages/strategy-engine/src/lib/combinator.mjs
- packages/curinga/src/index.mjs
- packages/strategy-engine/config/strategies/*.json

Mudança mínima sugerida:
- Criar uma camada central de config compartilhada só para parâmetros globais que hoje se repetem ou divergem.
- Deixar strategy JSON focado em parâmetros de produto/runner.
- Remover do hardcode pelo menos: trusted families, family reliability compartilhável e thresholds globais que não deveriam morar espalhados.

Critério de aceite:
- Alterar um parâmetro global relevante exige mudança em um único ponto de verdade.
- Strategy-engine e Curinga deixam de carregar listas centrais divergentes do catálogo.

### P2 — Hardening e ergonomia operacional

#### P2.1 — Validar contexto interno do Engine A

Motivo:
- Não é bug confirmado, mas a análise arquitetural apontou risco real de ctx ruim entrar silenciosamente no Engine A.

Objetivo:
- Validar profiles e priors internos antes do predict do Engine A com erro explícito e rastreável.

Arquivos-alvo:
- packages/contracts/src/index.mjs
- packages/engine-a/src/engine.mjs
- apps/api/src/predict.mjs

Mudança mínima sugerida:
- Adicionar schemas dedicados para profile/priors internos ou validação equivalente de shape e staleness.

Critério de aceite:
- Contexto ausente ou claramente inválido falha de forma explícita antes da geração de slots.

#### P2.2 — Expor fetch de odds opt-in no boundary puro de predict

Motivo:
- Não é ausência do odds-service, mas ainda existe diferença entre o fluxo rico de /v1/run e o boundary puro de /v1/predict.

Objetivo:
- Permitir operação desacoplada por default, mas com opção explícita de resolver odds automaticamente quando necessário.

Arquivos-alvo:
- apps/api/src/predict.mjs
- packages/superbet-scraper/src/index.mjs ou módulo de serviço fino por cima dele

Critério de aceite:
- /v1/predict continua aceitando odds_snapshot direto.
- Quando habilitado, consegue resolver odds sem exigir orchestration externa manual.

### Itens que NÃO entram na execução imediata

- Ajuste de thresholds do Curinga por consensus/flagged.
Motivo: existe diferença real, mas a comparação original estava em métricas incompatíveis; precisa benchmark antes de qualquer mudança.

- Recontagem de “18 de 35 dimensões”, “3 bloqueantes” e estimativa de sprint.
Motivo: não são fatos confirmados por leitura de código; precisam nova auditoria executiva quando as correções reais estiverem aplicadas.

### Sequência prática de execução

1. P0.2 — aliases de família no strategy-engine
2. P0.1 — penalidade A-only no Curinga
3. P0.3 — tradução compartilhada de market_key
4. P1.1 — fallback LLM do Scout
5. P1.2 — consolidação mínima de governança
6. P2.1 e P2.2 — hardening/ergonomia, se não aparecer regressão antes

### Definição de pronto para pedir nova auditoria

- Strategy-engine sem drift entre resultado/1x2 e dupla_chance/dupla.
- Curinga com penalidade A-only coberta por teste.
- Tradução de market_key centralizada e consumida por pelo menos bridge, scraper e predict.
- Scout com fallback funcional ou decisão explícita documentada de não usar fallback.
- Fonte de verdade de parâmetros centrais reduzida e documentada.

### Status de execução do plano

Status desta workspace após a execução técnica:

- P0.1 — concluído.
  O pipeline atual passou a aplicar a penalidade A-only no fechamento de confidence, com provenance explícito no Curinga e cobertura de teste para engine_b_unavailable e engine_b_no_slot.

- P0.2 — concluído.
  O strategy-engine agora normaliza resultado/1x2 e dupla_chance/dupla de forma consistente no combinator e nos filtros, mantendo compatibilidade com slots legados.

- P0.3 — concluído.
  A tradução legado → canônico de market_key foi centralizada no pacote de markets e consumida por predict, engine-b-bridge e superbet-scraper; além de btts/1x2/dupla, o registry cobre aliases numéricos compactos como `gols_total_ft_over_25` → `gols_total_ft_over_2_5` e `escanteios_total_ft_over_95` → `escanteios_total_ft_over_9_5`.

- P1.1 — concluído.
  O Scout deixou de ser GPT-4o único e passou a operar com fallback em ordem fixa GPT-4o → Perplexity → Claude, com skip_reason no_provider_configured e all_providers_failed.

- P1.2 — concluído em escopo mínimo.
  Parâmetros globais realmente repetidos foram movidos para config compartilhada em quality-gates.json, consumida por quality-gates, combinator e Curinga; o Yankee deixou de carregar trusted_families/quality_score_formula como metadado morto.

- P2.1 — concluído.
  O Engine A passou a validar explicitamente o contexto interno via contratos dedicados, e o predict agora expõe warning específico quando profile/prior internos chegam inválidos.

- P2.2 — concluído.
  O boundary puro de runPredict continua aceitando odds_snapshot manual, mas agora consegue resolver odds do DB quando `options.resolve_odds=true`, reutilizando o mesmo mapper real do fluxo rico.

Validação executada nesta sessão:

- strategy-engine: engine-e2e.test.mjs e board-based.test.mjs verdes.
- curinga + predict: curinga.test.mjs e predict-a-only.test.mjs verdes.
- markets + bridge + scraper: registry.test.mjs, bridge.test.mjs e scraper.test.mjs verdes.
- scout: scout.test.mjs verde.
- engine-a + mapper + predict opt-in: lambda-mult.test.mjs e superbet-mapping.test.mjs verdes.

---

## Próximos itens

Cole aqui os próximos findings na conversa e este arquivo será atualizado com novos vereditos.