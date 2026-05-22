# Extracao Propria — Technical Specification

| Campo | Valor |
|---|---|
| Documento | SPEC formal v1.0 |
| Status | Em execucao controlada — POC local com gaps de escala/auditoria sendo fechados |
| Data | 17/05/2026 |
| Autor | GitHub Copilot |
| Escopo | Criar uma camada propria de extracao de dados de statsline e bookline, com banco separado, cron recorrente, auditoria de certificacao e normalizacao gradual do legado dentro do SCOUTCORE_QUANT. |
| Nao-escopo | Reescrever UI do legado, migrar produto Apollo, remover eventos_faixa imediatamente, trocar o motor de predicao nesta fase, cobrir live betting. |
| Substitui | Decisoes ad hoc em conversa. Esta spec passa a ser a fonte unica de verdade para a iniciativa de extracao propria. |

---

## Sumario

1. Visao
2. Objetivo
3. Principios
4. Decisoes Arquiteturais
5. Escopo de Dados
6. Banco Novo
7. Passo 1 — Dados statsline
8. Passo 2 — Dados bookline
9. Passo 3 — Auditoria e Certificacao da Extracao
10. Passo 4 — Normalizacao de Bancos e Limpeza Estrutural
11. Cron e Operacao
12. Criterios de Aceite
13. Riscos e Mitigacoes
14. Ordem de Implementacao
15. Anexo A — Matriz de Ligas e Temporadas

---

## 1. Visao

O SCOUTCORE_QUANT deve deixar de depender operacionalmente do projeto legado para extracao de dados. A nova camada de extracao sera propria, controlada por este repositorio, e passara a abastecer o sistema por meio de um banco separado. O objetivo nao e reinventar o extractor: o objetivo e reaproveitar o nucleo server-side ja validado do legado, portar o comportamento necessario e operar daqui em diante dentro do SCOUTCORE_QUANT.

O desenho final tem quatro fases:

1. Ingestao de dados statsline.
2. Ingestao de odds bookline.
3. Auditoria e certificacao da extracao.
4. Normalizacao dos bancos e reducao do legado interno desnecessario.

Durante a transicao, a tabela eventos_faixa permanece suportada por compatibilidade. Ela nao sera removida nesta etapa.

---

## 2. Objetivo

Entregar uma infraestrutura de extracao propria com estas propriedades:

1. Banco proprio da extracao, separado do banco operacional atual.
2. Cobertura inicial das 13 ligas do legado e de todas as temporadas configuradas hoje.
3. Coleta de statsline e bookline via jobs recorrentes controlados pelo scheduler local.
4. Auditoria formal de completude, consistencia e certificacao por confronto, liga e rodada de coleta.
5. Base pronta para, apos certificacao, virar a origem oficial do sistema.

---

## 3. Principios

| P# | Principio | Implicacao pratica |
|---|---|---|
| P1 | Reuso maximo do legado | Portar apenas os modulos server-side necessarios; nao reescrever do zero. |
| P2 | Banco separado obrigatorio | A POC nasce isolada para evitar contaminar o banco operacional enquanto a paridade nao fecha. |
| P3 | Idempotencia obrigatoria | Reexecutar uma extracao nao pode inflar linhas, duplicar confrontos ou corromper odds. |
| P4 | Auditoria antes de cutover | Nenhuma liga vira oficial sem certificacao objetiva de qualidade. |
| P5 | Fonte primaria limpa | O estado final deve priorizar `times` e `confronto`; `eventos_faixa` fica apenas como compatibilidade temporaria. |
| P6 | Cron local e observavel | Toda extracao recorrente deve ser executada pelo scheduler do SCOUTCORE_QUANT e deixar rastros auditaveis. |

---

## 4. Decisoes Arquiteturais

| # | Decisao | Justificativa |
|---|---|---|
| D1 | Criar um banco novo para a extracao propria. | Permite validar a POC sem risco operacional para o sistema atual. |
| D2 | O banco novo tera duas camadas logicas: ingestao e publicacao. | A ingestao preserva o bruto; a publicacao entrega o contrato que o motor consome. |
| D3 | O reaproveitamento do legado sera por modulo, nao por integracao HTTP com telas Next. | As telas sao referencia funcional; o contrato real esta no server-side. |
| D4 | `eventos_faixa` nao sera removida agora. | Hoje ainda ha dependencias em settle, perfis, priors, ML e scripts de backtest. |
| D5 | O estado alvo apos a fase 4 tratara `times` e `confronto` como fonte primaria para stats agregadas. | Sao os dados considerados limpos para FT e HT. |
| D6 | A extracao bookline seguira modo API como caminho principal; scraper DOM fica como fallback manual. | Menor custo operacional e menor fragilidade. |
| D7 | O scheduler local sera a unica orquestracao recorrente. | Evita dependencia de agendadores externos e centraliza operacao. |
| D8 | Banco da extracao sera SQLite local com WAL. | Postgres em nuvem foi avaliado e descartado: a coleta bookline nao e replicada para o banco em nuvem, e o motor depende de leituras rapidas e locais. |
| D9 | Nenhuma dependencia operacional de banco em nuvem. | Mantem o sistema autosuficiente, sem custo recorrente externo e sem vendor lock-in. |

---

## 5. Escopo de Dados

### 5.1. Tabelas obrigatorias da extracao propria

1. `partidas`
2. `times`
3. `confronto`
4. `eventos_faixa`
5. `jogadores`
6. `arbitros`
7. `partida_arbitro`
8. `odds`
9. `odds_historico`
10. `extracoes_log`
11. `odds_coletas`
12. Tabelas de apoio de auditoria e certificacao

### 5.2. Tabelas obrigatorias do motor que continuarao existindo

1. `match`
2. `prediction`
3. `calib_state`
4. `motor_run`
5. `team_profile_v2`
6. `league_priors`

### 5.3. Regra de transicao

Enquanto houver consumidores dependentes de `eventos_faixa`, a tabela permanece viva. O objetivo da fase 4 nao e apagar a tabela por decreto; e reduzir seu papel de fonte estrutural e permitir futura aposentadoria sem quebra.

---

## 6. Banco Novo

### 6.1. Nome e papel

O banco novo da POC sera `data/scout_extraction.db`. Ele sera o banco da extracao propria e deve ser tratado como o candidato a origem oficial apos certificacao.

### 6.2. Requisitos do banco

1. SQLite com WAL.
2. Tabelas de ingestao e publicacao no mesmo arquivo na fase inicial.
3. Chaves unicas e upserts idempotentes por confronto, time, mercado e coleta.
4. Colunas de rastreabilidade: `criado_em`, `atualizado_em`, `run_id` ou equivalente, `source_system`, `source_version` e `status_certificacao` quando aplicavel.

### 6.3. Regras de completude

O estado de completude da extracao nao pode depender apenas de `eventos_faixa`. Deve existir um marcador explicito de integridade por confronto, por exemplo:

1. `partidas.processado_stats = 1`
2. `partidas.processado_odds = 1`
3. `partidas.certificado_em`

### 6.4. Regra de chaves para odds

As odds usam duas identidades separadas:

1. `snapshot_id` / `quote_key`: chave fisica do snapshot de uma cotacao em uma coleta especifica. Preserva idempotencia por coleta e evita colapsar snapshots historicos.
2. `quote_signature`: assinatura estavel da cotacao, independente da coleta, usada para comparar movimentos de odd entre coletas e alimentar `odds_historico`.

Nao tratar `quote_key` como identidade historica estavel. Historico e drift devem sempre usar `quote_signature` quando disponivel.

---

## 7. Passo 1 — Dados statsline

### 7.1. Objetivo

Portar a extracao de calendario, placar, stats FT, stats HT e agregados por confronto/time do legado para dentro do SCOUTCORE_QUANT, abastecendo o banco novo.

### 7.2. Superficie a reaproveitar

Do legado, devem ser espelhados apenas os modulos server-side necessarios para:

1. Configuracao de ligas, temporadas e URLs.
2. Resolucao de `tmcl` e variaveis por temporada.
3. Pipeline de calendario e parsing de confrontos.
4. Coleta de `matchstats` e `matchevent`.
5. Mapeamento de stats para `times`, `confronto`, `jogadores`, `arbitros`, `partida_arbitro` e `eventos_faixa`.
6. Logs e idempotencia de extracao.

### 7.2.1. Contrato observado da API legada

Antes de considerar o port completo, a API real do legado deve ser executada e auditada. Execucao feita em 17/05/2026:

1. Servidor legado ativo em `POST /api/extract`, autenticado com `Bearer` admin.
2. Chamada real no banco legado: `{ leagueId: 'brasileirao', season: '2025' }`.
3. Resposta HTTP imediata: `Extração Brasileirão Série A 2025 (FT+HT+Faixas)`; execucao segue assíncrona e deve ser acompanhada por `/api/status` e `extracoes_log`.
4. Log legado observado: `380 partidas (380 novas) | Stats: 0/0`, mesmo com partidas já existentes, porque `insertPartida()` usa upsert e sempre retorna `true` quando grava/atualiza.
5. Execucao sandbox da mesma API em copia temporaria do legado, com 1 confronto marcado como pendente, produziu: `380 partidas (380 novas) | Stats: 1/1`.
6. Fluxo real do legado: lista calendario, faz upsert em `partidas`, seleciona `status = 'Played' AND processado = 0`, processa stats em batches de 5, grava `times`, `confronto`, `jogadores`, `eventos_faixa`, atualiza metadados e marca `partidas.processado = 1`.
7. O legado executa `runFullDivergenceCheck()` apos a extracao e reportou divergencia esperada para confrontos sem times definidos (`?`) em `brasileirao-b`.
8. Reprocessar no proprio legado um confronto cujo nome de jogador mudou na fonte cria duas linhas para o mesmo `player_id` quando o `jogador` textual muda; portanto divergencias antigas de nomes de jogadores contra o banco legado historico nao devem ser tratadas automaticamente como erro estatistico.

Regras derivadas para o SCOUTCORE_QUANT:

1. O parser de calendario deve aceitar confrontos sem times definidos e persistir `? x ?`, como o legado.
2. Nomes de times devem passar pelo mesmo resolver PT -> original do legado antes de gravar `partidas`, `times`, `jogadores` e `eventos_faixa`.
3. Cartoes amarelos HT devem ser alinhados ao array `card` do payload (`type = 'YC'`, periodo 1), nao apenas a eventos genéricos `CARD`.
4. Paridade de jogadores deve ser auditada por `player_id` e valores estatisticos alem da chave textual `jogador`, porque a fonte pode alterar `matchName` ao longo do tempo.

### 7.3. Entregaveis

1. Config local com as 13 ligas e 41 temporadas do legado.
2. Job local de extracao statsline com execucao por liga e temporada.
3. Persistencia em `partidas`, `times`, `confronto`, `jogadores`, `arbitros`, `partida_arbitro` e `eventos_faixa`.
4. Tabela `extracoes_log` preenchida por execucao.

### 7.3.1. Configuracao local certificada

A matriz local de ligas e temporadas fica em `config/extraction-leagues.json`. Ela contem apenas metadados, nomes de variaveis e contadores esperados; URLs reais e tokens ficam exclusivamente no ambiente local.

O contrato novo usa variaveis `STATSLINE_URL_*`. Durante a transicao, cada temporada tambem declara `legacy_env_key` para permitir fallback controlado aos nomes antigos `API_URL_*`, sem copiar valores sensiveis para o repositorio.

Auditoria obrigatoria desta etapa:

1. `npm run extraction:audit:config`
2. Total de ligas = 13.
3. Total de temporadas = 41.
4. Identidade unica por liga, temporada e variavel de ambiente.
5. Opcionalmente, `node scripts/audit-extraction-config.mjs --require-env` valida se as URLs locais estao configuradas e possuem `tmcl`.

Temporadas sem URL no legado podem ser desconsideradas somente quando marcadas com `enabled: false` e `ignore_reason` na matriz. A temporada `primeira-liga` `2024/2025` esta nesse estado por ausencia confirmada de URL no legado.

As requisicoes reais usam headers configurados por ambiente local neutro: `STATSLINE_REFERER` e `STATSLINE_USER_AGENT`. Esses valores nao devem ser versionados com hosts ou tokens reais.

### 7.3.2. Job de calendario statsline

O primeiro job operacional e `npm run extraction:statsline:schedule -- --liga=<liga> --temporada=<temporada>`. Ele busca apenas calendario, identidade dos confrontos, placar disponivel no payload de agenda, metadados de data/hora, estadio, publico e arbitros quando o payload de agenda trouxer `matchOfficial`. Ele grava somente em `data/scout_extraction.db`.

Regras de seguranca desta etapa:

1. Nao grava `times`, `confronto` nem `eventos_faixa`.
2. Nao marca `processado_stats = 1`.
3. Usa upsert por `id_confronto`, preservando idempotencia.
4. Registra execucao em `extracoes_log`.
5. Grava `arbitros` e `partida_arbitro` somente quando o payload de calendario trouxer oficiais; `jogadores` pertence ao job posterior de `matchstats`.
6. Aceita `--dry-run` para validar parsing sem tocar no banco.
7. Usa retry curto para falhas transitórias de rede no fetch do calendario.

O modo agregado fica em `npm run extraction:statsline:schedule:all`. Ele percorre todas as temporadas habilitadas na matriz, pula temporadas `enabled: false`, continua a execucao em falhas isoladas e reporta `failed`/`skipped` no resumo final.

### 7.3.3. Job de stats por confronto

O segundo job operacional e `npm run extraction:statsline:matchstats -- --liga=<liga> --temporada=<temporada>`. Ele processa somente partidas com `status = 'Played'` e, por padrao, apenas registros ainda pendentes de stats (`processado_stats = 0`). Para auditoria e reparo controlado, aceita `--match-id=<id_confronto>`, `--limit=N`, `--force`, `--dry-run` e `--all`. Desde 2026-05-19, o writer de matchstats voltou a publicar em `times` e `confronto` as colunas legadas compatíveis (`assistencias`, `chutes_bloqueados`, `passes`, `desarmes`, `faltas_*`, `escanteios_sofridos`, `chutes_sofridos`, `posse`, `passes_certos`, `desarmes_certos`, `clean_sheet`), com dados reconstruídos por extração direta.

Regras de seguranca desta etapa:

1. Busca `matchstats` e `matchevent` do confronto.
2. Grava 4 linhas em `times` por partida processada: mandante/visitante em FT e HT.
3. Grava 2 linhas em `confronto` por partida processada: FT e HT.
4. Grava `jogadores` a partir do lineup do payload de stats.
5. Grava 16 linhas em `eventos_faixa` por partida processada: 2 times x 8 faixas.
6. Atualiza `home_goals_ht`, `away_goals_ht`, `formacao_casa`, `formacao_fora` quando o payload trouxer esses campos.
7. Marca `partidas.processado_stats = 1` somente apos persistir stats, jogadores e faixas sem erro fatal.
8. Usa upserts por chaves naturais para permitir reexecucao sem duplicar dados.
9. Registra execucao em `extracoes_log` com job `extract-statsline-matchstats`.

O job deriva `STATSLINE_API_BASE` automaticamente das URLs de calendario quando a variavel nao estiver definida explicitamente, mas `STATSLINE_TOKEN` continua obrigatorio no ambiente local.

Status certificado em 17/05/2026:

1. Teste automatizado do job de matchstats integrado ao SQLite temporario.
2. Piloto real `brasileirao` `2025`: 380/380 partidas com `processado_stats = 1`.
3. Contagens finais da liga piloto: `times = 1520`, `confronto = 760`, `eventos_faixa = 6080`, `jogadores = 17396`.
4. Depois da execucao e auditoria da API legada, `brasileirao` `2025` ficou com paridade de contagem e valores em `times`; `eventos_faixa` tambem fechou contagem; divergencias remanescentes em `jogadores` foram classificadas como drift textual historico de nomes de jogador na fonte.

### 7.4. Teste minimo obrigatorio

Executar uma extracao completa de uma liga piloto com partidas jogadas. Liga recomendada para stats: `brasileirao` temporada `2025`. Temporadas futuras, como `brasileirao` `2026`, devem ser usadas para validar calendario, mas nao para certificar stats enquanto nao houver partidas `Played`.

### 7.5. Criterios de aceite do passo 1

1. A liga piloto e carregada sem erro fatal.
2. `partidas`, `times` e `confronto` sao preenchidas.
3. `eventos_faixa` e preenchida por compatibilidade.
4. A reexecucao da mesma liga nao duplica dados.
5. Pelo menos um confronto auditado manualmente bate com a extracao.

---

## 8. Passo 2 — Dados bookline

### 8.1. Objetivo

Portar a coleta de odds para o SCOUTCORE_QUANT usando a API da bookline como caminho principal, alimentando o banco novo.

### 8.2. Superficie a reaproveitar

Do legado, devem ser espelhados os modulos necessarios para:

1. Catalogo de ligas suportadas.
2. Resolucao de torneios e mapeamento de ligas.
3. Coleta via API.
4. Normalizacao de mercados e selecoes.
5. Persistencia idempotente em `odds`.
6. Sessao de coleta em `odds_coletas`.
7. Geracao de `odds_historico` quando houver mudanca relevante.

### 8.3. Entregaveis

1. Job local de coleta bookline via API: `npm run extraction:bookline:odds`.
2. Persistencia de odds por confronto, mercado e snapshot.
3. Registro de sessao e status de coleta em `odds_coletas`.
4. Historico por `quote_signature` em `odds_historico`.
5. Certificacao persistida em `certificacao_extracao` e `certificacao_liga`.
6. Scripts de validacao: `npm run extraction:audit:bookline-live` e `npm run extraction:audit:coverage`.

Regra operacional portada do legado: a coleta live bookline deve usar `source_event_id` ja conhecido como caminho principal, equivalente ao uso legado de `event_url`/`url_partida`, e chamar direto `/events/{eventId}`. O lookup publico por lista de eventos/fuzzy match fica desligado por padrao e so pode ser ativado de forma explicita (`--resolve-missing-events` ou `SCOUT_BOOKLINE_RESOLVE_MISSING_EVENTS=true`). Isso evita varrer partidas sem cotacao e impede que timeouts/retries por confronto transformem a coleta de 4 dias em execucao longa. O fetch de eventos roda em paralelo controlado por `SCOUT_BOOKLINE_FETCH_CONCURRENCY`/`--concurrency`, default 6 e cap 12.

Status em 17/05/2026:

1. Migração legada de odds para `data/scout_extraction.db` validada por contagem/paridade: 1.687.053 linhas importadas do legado.
2. Writer live bookline implementado e testado em POC curta; o banco já recebeu coletas `bookline-live-v1`.
3. A partir da migration `004_odds_signatures_certification.sql`, novas coletas live gravam `snapshot_id`, `quote_signature`, `odds_historico`, certificação e checkpoint WAL pós-run.
4. A migration `005_odds_coleta_indexes.sql` adiciona indice por `coleta_id` em `odds` e `odds_historico`; sem isso, certificacao e pos-processamento varriam a tabela inteira de odds.
5. Scale-out real de 13 ligas em 17/05/2026, janela hoje + 3, limit 25, concorrencia 6: 14,5s totais, 60 partidas checadas, 1.656 odds gravadas, 1.656 linhas de historico, WAL checkpoint `TRUNCATE` com `busy=0`.
6. Status do scale-out real: 7 ligas `ok`, 1 `partial`, 3 `empty_window`, 2 `failed` por ausencia de evento bookline retornado pela API. Fallback opt-in rodado nas ligas pendentes levou 6,8s e confirmou `sem_eventos_superbet` para Serie B Italia, Ligue 1 pendente e Superliga Argentina.

### 8.4. Teste minimo obrigatorio

Executar uma coleta de uma liga em uma janela curta de datas e validar um confronto manualmente.

### 8.5. Criterios de aceite do passo 2

1. Uma liga piloto retorna odds via API.
2. `odds` e `odds_coletas` sao preenchidas.
3. `odds_historico` e preenchida por `quote_signature` e nao depende de `quote_key` como identidade historica.
4. `mercado_key` nao pode ficar em `legacy_raw_*` para mercados suportados pelo catalogo atual.
5. Reexecucao da mesma janela nao corrompe o banco.
6. O WAL e consolidado por checkpoint ao final da run para reduzir leituras externas defasadas.

---

## 9. Passo 3 — Auditoria e Certificacao da Extracao

### 9.1. Objetivo

Criar um mecanismo formal de certificacao para a extracao statsline e bookline antes do cutover do sistema.

### 9.2. Escopo da auditoria

Cada execucao deve ser avaliada em quatro dimensoes:

1. Completude — confrontos esperados vs confrontos carregados.
2. Consistencia — FT, HT, totais por time e total por confronto.
3. Idempotencia — rerun sem drift indevido.
4. Frescor — dados atualizados dentro da janela operacional esperada.

### 9.3. Certificacao minima por liga

Uma liga so pode ser considerada certificada quando houver:

1. Extracao statsline OK.
2. Extracao bookline OK.
3. Auditoria de confrontos amostrais OK.
4. Drift zero ou dentro de tolerancia definida.
5. Evidencia registrada em tabela ou relatorio auditavel.

### 9.4. Entregaveis

1. Tabela e relatorio de certificacao por coleta.
2. Script de auditoria comparando `partidas`, `times`, `confronto`, `eventos_faixa`, `odds` e `odds_historico`.
3. Status por liga: `nao_iniciada`, `em_teste`, `certificada`, `bloqueada`.

Comandos versionados:

1. `npm run extraction:audit:schema`
2. `npm run extraction:audit:config`
3. `npm run extraction:audit:bookline-live`
4. `npm run extraction:audit:coverage`

### 9.5. Criterios de aceite do passo 3

1. Toda liga piloto gera relatorio de auditoria.
2. Existe criterio objetivo de aprovacao e reprova.
3. O cutover fica bloqueado sem certificacao.

---

## 10. Passo 4 — Normalizacao de Bancos e Limpeza Estrutural

### 10.1. Objetivo

Depois da certificacao, reduzir tabelas desnecessarias, eliminar duplicidade de funcao e consolidar a estrutura do banco novo como origem oficial.

### 10.2. Regras desta fase

1. `eventos_faixa` nao sera removida nesta spec. Ela sera mantida enquanto houver consumidor dependente.
2. `times` e `confronto` passam a ser as fontes oficiais para stats agregadas.
3. Jobs e consultas que hoje usam `eventos_faixa` devem migrar para `times` e `confronto` quando funcionalmente possivel.
4. Scripts de legado sem necessidade operacional serao isolados ou aposentados.

### 10.3. Alvos de normalizacao

1. `settle-results` derivando FT, HT e 2T de `times` e `confronto`.
2. `rebuild-team-profiles` migrado para `times`.
3. `rebuild-league-priors` migrado para `confronto`.
4. ML sidecar migrado para fontes agregadas limpas.
5. `eventos_faixa` rebaixada a compatibilidade e auditoria, nao a fonte primaria.

### 10.4. Criterios de aceite do passo 4

1. O sistema principal funciona sem depender de `eventos_faixa` como fonte primaria.
2. `times` e `confronto` estao sempre atualizadas no novo pipeline.
3. Nenhuma tabela permanece apenas por inercia; cada uma tem papel declarado.

---

## 11. Cron e Operacao

### 11.1. Orquestracao

O scheduler local do SCOUTCORE_QUANT sera a orquestracao oficial.

O scheduler local inicial fica em `npm run extraction:scheduler`. Ele executa o refresh de calendario, processa um lote controlado de stats pendentes e coleta odds bookline em janela configuravel. Nao ha sobreposicao de ticks: se uma rodada anterior ainda estiver em andamento, a rodada seguinte e pulada.

Parametros operacionais:

1. `SCOUT_EXTRACTION_SCHEDULE_INTERVAL_MIN`: intervalo recorrente do scheduler, com default de 60 minutos.
2. `SCOUT_EXTRACTION_STATS_LIMIT_PER_TICK`: limite de confrontos de stats processados por tick, com default de 50.
3. `SCOUT_EXTRACTION_ODDS_LIMIT_PER_TICK`: limite de confrontos de odds por tick, com default de 25.
4. `SCOUT_EXTRACTION_ODDS_WINDOW_DAYS`: janela futura de odds por tick. **Default 4 (hoje + 3 dias inclusivos)** espelhando o legado bookline. **Cap rigido MAX_ODDS_WINDOW_DAYS=4**: pedidos maiores sao truncados com warning. Razao: evitar gravar mercados de partidas distantes que ainda nao tem cotacao na casa.
5. `SCOUT_BOOKLINE_RESOLVE_MISSING_EVENTS=true`: ativa fallback diagnostico por lista/fuzzy para partidas sem `source_event_id`; default desligado para espelhar o legado e evitar tempo morto.
6. `SCOUT_BOOKLINE_FETCH_CONCURRENCY`: paralelismo de fetch de eventos bookline, default 6, cap 12.
7. `SCOUT_EXTRACTION_ODDS_ENABLED=false`: desliga odds no scheduler quando necessario para smoke/diagnostico.
8. `--schedule-only`: executa somente calendario.
9. `--stats-only`: executa somente stats pendentes.
10. `--odds-only`: executa somente odds bookline.
11. `--no-odds`: pula odds neste tick.
12. `--stats-limit=N`: sobrescreve o limite de stats do tick.
13. `--odds-limit=N`, `--odds-concurrency=N`, `--odds-window-days=N`, `--odds-date=YYYY-MM-DD`, `--odds-from=YYYY-MM-DD`, `--odds-to=YYYY-MM-DD`: controlam a janela bookline no scheduler. O CLI direto `extract-bookline-odds.mjs` aplica o **mesmo cap rigido (MAX_WINDOW_SPAN_DAYS=4)**; janelas explicitas maiores resultam em erro `Janela ... excede MAX_WINDOW_SPAN_DAYS`.
14. `--concurrency=N`: no CLI direto de odds e no scale-out, controla o paralelismo de fetch por liga.
15. `--resolve-missing-events`: no CLI direto de odds, ativa lookup publico por lista/fuzzy apenas para diagnostico ou descoberta controlada.

Atalho local recomendado para operacao assistida:

1. `start_extraction_bot.bat`: sobe `dev.ps1 -All` em background/servicos locais, isto e, API `4040`, Web `3001`, ML sidecar `4055` e bot de extracao; registra PIDs em `.pids` e logs em `logs/*_stdout.log`/`logs/*_stderr.log`.
2. `stop_extraction_bot.bat`: chama `stop.ps1 -Bot` e encerra o scheduler local, incluindo o processo Node filho.
3. Defaults do bot: `intervalo=30min`, `odds_window=2d` (hoje + amanha), `odds_limit=80`, `odds_concurrency=6`, `stats_limit=50`, modo `schedule+stats+odds`.
4. O bot usa o mesmo `extractStatslineMatchstats()` validado no reparo de 2026-05-19; um tick real em modo `--stats-only --once --stats-limit=1` confirmou escrita de `times=4`, `confronto=2`, `jogadores=45`, `eventos_faixa=16` no schema restaurado.
5. Para coleta rapida so de odds mantendo a stack de apoio, usar `start_extraction_bot.bat -BotOddsOnly`; para smoke sem tick imediato, usar `start_extraction_bot.bat -BotNoImmediate`.

Observacao operacional: a execucao `schedule --all` pode levar horas quando cobre todas as 40 temporadas habilitadas. Por isso, a fase de stats dentro do scheduler e limitada por tick e deve ser acompanhada por auditoria de backlog antes de qualquer cutover.

### 11.2. Novos jobs previstos

1. `extract-statsline-schedule` — extrai calendario/partidas.
2. `extract-statsline-matchstats` — extrai stats de confrontos elegiveis.
3. `extract-bookline-odds` — coleta odds em janela configuravel.
4. `audit-extraction` — audita e certifica o lote mais recente.
5. `normalize-extraction-db` — executa derivacoes, limpeza controlada e consolidacao de estados.

### 11.3. Frequencias iniciais sugeridas

1. Statsline schedule: a cada 60 minutos no ambiente inicial; aumentar o intervalo se `schedule --all` continuar acima da janela configurada.
2. Statsline matchstats: a cada tick do scheduler, com limite inicial de 50 confrontos pendentes.
3. Bookline odds: a cada tick do scheduler na POC; reduzir o intervalo para 10 minutos somente depois que a auditoria de cobertura por liga estiver aprovada.
4. Auditoria: a cada 60 minutos ou ao final de cada lote.
5. Normalizacao: diaria em horario fixo, com opcao manual.

---

## 12. Criterios de Aceite Globais

O trabalho sera considerado pronto quando os itens abaixo forem verdadeiros:

1. O banco novo existe e esta operacional.
2. As 13 ligas e 41 temporadas estao configuradas localmente.
3. Existe teste validado de uma liga statsline e uma liga bookline.
4. A extracao recorrente roda via scheduler local.
5. Existe trilha de auditoria e certificacao da extracao.
6. O plano de cutover para o novo banco esta pronto.
7. `eventos_faixa` permanece apenas como compatibilidade, sem remocao forçada nesta fase.

---

## 13. Riscos e Mitigacoes

| Risco | Impacto | Mitigacao |
|---|---|---|
| Drift entre banco novo e banco atual | Alto | Auditoria por liga e confronto antes do cutover. |
| Reexecucao gerar duplicacao | Alto | Upserts e chaves unicas obrigatorias. |
| Mudanca em API da bookline | Medio | Modo API principal com fallback manual controlado. |
| Completar stats sem flag confiavel | Alto | Criar marcador de completude proprio por confronto. |
| `times` e `confronto` nao refletirem o banco novo em tempo real | Alto | Derivacao interna obrigatoria e auditoria de frescor. |
| Remocao prematura de `eventos_faixa` | Alto | Proibida nesta spec; apenas rebaixamento gradual de papel. |
| Leitor externo abrir SQLite sem considerar WAL | Medio | Checkpoint `wal_checkpoint(TRUNCATE)` apos runs de odds e validacao por scripts `better-sqlite3`. |

---

## 14. Ordem de Implementacao

1. Criar o banco novo e o schema inicial.
2. Portar a configuracao das 13 ligas e 41 temporadas.
3. Implementar a extracao statsline e testar uma liga piloto.
4. Implementar a coleta bookline e testar uma liga piloto.
5. Implementar logs, rastreabilidade e chaves idempotentes.
6. Implementar a auditoria e certificacao da extracao.
7. Ligar os novos jobs no scheduler local.
8. Iniciar a normalizacao de consumidores para `times` e `confronto`.
9. Preparar o cutover do sistema para o banco novo.

---

## 15. Anexo A — Matriz de Ligas e Temporadas

### 15.1. Quantitativo

1. Total de ligas: 13
2. Total de temporadas configuradas hoje: 41

### 15.2. Ligas

| Liga | Temporadas |
|---|---:|
| premier-league | 5 |
| brasileirao | 6 |
| la-liga | 5 |
| serie-a | 5 |
| bundesliga | 5 |
| brasileirao-b | 2 |
| superliga-argentina | 2 |
| liga-mx | 1 |
| ligue-1 | 5 |
| primeira-liga | 2 |
| championship | 1 |
| la-liga-2 | 1 |
| serie-b-italia | 1 |

### 15.3. Regra operacional

Nenhuma liga entra em cron recorrente sem ter passado pela sequencia abaixo:

1. Configuracao validada.
2. Extracao statsline validada.
3. Extracao bookline validada.
4. Auditoria e certificacao concluida.

---

## Estado Final Desejado

Ao final desta iniciativa, o SCOUTCORE_QUANT tera sua propria camada de extracao, seu proprio banco de dados operacional e sua propria trilha de certificacao, sem dependencia operacional do projeto legado. A tabela `eventos_faixa` ainda existira durante a transicao, mas deixara de ser a ancora arquitetural do sistema.