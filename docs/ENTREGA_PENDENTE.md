# SCOUTCORE — PLANO DE CORREÇÃO E ENTREGA FINAL

> **Para o dev:** Este documento é a especificação do que falta entregar.
> Cada item tem critério de aceite claro. Não há margem para interpretação.
> Leia o arquivo de referência citado antes de codificar qualquer item.
>
> **Referência obrigatória:** `C:\Users\Rogerio\Desktop\RGMV_PROJETOS\SOLUCAO_IA\opta-extractor\web\src\app\(app)\apollo-turbo\page.tsx`

---

## BLOCO 0 — PRÉ-REQUISITO: DADOS REAIS NO BANCO

Antes de tocar qualquer linha de UI, o sistema precisa ter dados. Sem dados, nenhum teste de UI é válido.

### 0.1 — Popular o scout.db

Execute na raiz do projeto, **nesta ordem exata**:

```bash
npm run setup:copy-legacy       # copia opta.db → scout.db
npm run setup:wipe-state        # limpa tabelas legadas do motor
npm run setup:migrate           # roda migrações
node apps/jobs/src/rebuild-team-profiles.mjs  # reconstrói team_profiles (sem npm script)
npm run setup:replay            # backfill histórico (pode demorar horas)
```

**Critério de aceite 0.1:**
Rodar o script de auditoria para qualquer partida real do dia anterior e obter:
```json
{
  "certified": true,
  "warnings": []
}
```
Se `certified: false` aparecer por falta de dados de time ou liga, o banco está incompleto. Não avance.

### 0.2 — Garantir Engine B rodando

O Python sidecar precisa estar ativo antes de qualquer run:

```bash
cd apps/ml-sidecar
pip install -r requirements.txt
python src/server.py
```

**Critério de aceite 0.2:**
O `audit/meta.json` não pode conter `engine_b_unavailable`. O campo `engine_b.available` deve ser `true`.

---

## BLOCO 1 — UI: REGRAS GERAIS (leia antes de tudo)

1. **Não inventar dados.** Se um dado não vem da API, mostre `—` ou `0`, nunca um número fixo no código.
2. **Toda odd, stake, status, contagem deve ser dinâmica.** Proibido hardcode de valores numéricos em JSX.
3. **O arquivo de referência é lei.** Para cada componente abaixo há um nome de componente no Apollo Turbo. Leia esse componente antes de codificar.
4. **Não criar novos nomes de componentes** sem necessidade. Se o componente já existe no Apollo Turbo com esse nome, use o mesmo nome.
5. A UI usa Next.js 15 com React 19. Leia `apps/web/AGENTS.md` antes de escrever qualquer código Next.js.

---

## BLOCO 2 — CORRIGIR: PIPELINE MONITOR

**Arquivo atual:** `apps/web/src/app/page.tsx` — aba `pipeline` (linha 164)

**Problema:** O pipeline sempre mostra "Pipeline Concluída" com 8 bolinhas verdes estáticas. Não reflete estado real.

**Referência:** No Apollo Turbo, o componente chama-se `LivePipelineMonitor`. Leia-o completamente antes de começar.

### O que deve funcionar

O monitor deve mostrar **11 estágios** (não 8). Os nomes corretos são:

| # | Nome exibido | Descrição |
|---|---|---|
| 1 | Jogos | Coleta partidas do período |
| 2 | Motor A·B | Estatístico (Poisson) + ML (XGBoost) |
| 3 | Curinga | Árbitro edge + odds inline + certified |
| 4 | Scout IA | Auditoria — validação de edge |
| 5 | Combine | Combinator · seleção de legs |
| 6 | Validar | Quality gates + diversidade de board |
| 7 | Board | Top confrontos certificados |
| 8 | Yankee | BIBD · combinatória de tickets |
| 9 | Singles | Mercados EV+ unitários |
| 10 | Submit | Envio para casa |
| 11 | Resolver | Fechar tickets pós-jogo |

### O que cada card de estágio deve mostrar

- Número do estágio (1–11)
- Nome e descrição
- Status com ícone:
  - `running` → spinner animado, fundo ciano pulsando
  - `ok` → ícone de check, fundo verde
  - `failed` → ícone de alerta, fundo vermelho pulsando
  - `skip` → fundo âmbar
  - `pending` → fundo cinza
- `items_out` / `items_in` se disponíveis
- Duração do estágio (live se rodando)

### O que o banner deve mostrar

- Ícone de status global (spinning se rodando, check se concluído, X se falhou)
- `run_id` atual
- Nome do estágio atual e sua descrição
- Tempo decorrido (MM:SS, incrementando ao vivo se rodando)
- ETA estimado
- Barra de progresso horizontal (cor gradiente verde→ciano, pulsando se rodando)

### Como obter o estado real dos estágios

O backend expõe `GET /v1/runs/:id` que deve retornar os stages. Se esse endpoint não retorna stages ainda, adicione ao backend antes de implementar a UI.

### Critério de aceite 2

- [ ] 11 estágios visíveis com os nomes corretos
- [ ] Ao clicar "Rodar Dia", o banner muda imediatamente para "Rodando" com spinner
- [ ] Cada estágio muda de cinza → ciano (running) → verde (ok) conforme avança
- [ ] Se qualquer estágio falhar, seu card fica vermelho pulsando e o banner mostra falha
- [ ] Tempo decorrido incrementa ao vivo (não pode ser estático)
- [ ] Nenhum dado hardcoded: nem texto, nem status

---

## BLOCO 3 — CORRIGIR: YANKEE MATRIX

**Arquivo atual:** `apps/web/src/app/page.tsx` — aba `yankee`

**Problema:** Odds hardcoded (3.05, 2.80, 3.15, 2.65), stake hardcoded (R$3), status hardcoded ("Submetido"), resumo hardcoded (0/4 G / 0 R).

**Referência:** Componente `ApolloYankeeMatrix` no Apollo Turbo.

### O que deve funcionar

#### 3.1 — Cabeçalho da matrix

- Badge: `{N} confrontos × {tickets.length} quadras`
- Badge BIBD: se todos os confrontos aparecem exatamente 4 vezes → `"BIBD 4× cada"` (verde); caso contrário → `"balanceamento parcial"` (âmbar)
- Botão toggle `10` / `12` se houver dados para ambos os tamanhos

#### 3.2 — Tabela de tickets

Colunas: `# | Jogo 1 | Odd 1 | Jogo 2 | Odd 2 | Jogo 3 | Odd 3 | Jogo 4 | Odd 4 | Odd Final | Stake | Status | Resumo`

Para cada ticket:
- `#` → `#01`, `#02`, etc.
- `Jogo N` → nome do time casa do confronto N (da API, não hardcoded)
- Hover/focus em `Jogo N` → card fixo com detalhes de legs, odd, score e resultado; não renderizar popover absoluto dentro da célula da tabela
- `Odd N` → odd combinada do confronto N (da API, não hardcoded)
- `Odd Final` → `ticket_odd` da API (negrito, cor ouro)
- `Stake` → `stake_brl` da API (não hardcoded)
- `Status` → badge dinâmico: `ready` (âmbar) / `submitted` (ciano) / `green` (verde) / `red` (rosa) — vem da API
- `Resumo` → `X/4 g` greens e `Y r` reds — calculado do campo `result` de cada leg na API

**Regra:** Se a API não retornar odds por confronto, mostre `—`. Não invente valores.

#### 3.2.1 — Cards de resultado da Yankee

- `Greens` e `Reds` contam confrontos únicos presentes na Yankee, deduplicados por `match_id`.
- Não somar aparições por ticket BIBD; em BIBD 4×, `2` confrontos green não podem virar `8`.
- `3 acertos` e `4 acertos` continuam sendo contagem de quadras/tickets.

#### 3.3 — Card de frequência BIBD

Abaixo da tabela, um card mostrando grid de confrontos com a frequência de cada um nos tickets:
- `confronto_rank ## | N×`
- Verde se N=4 (balanceado), âmbar se diferente

#### 3.4 — Controles de submissão

Dois botões:
- **Dry-run** (ciano): valida sem apostar. Mostra resultado de validação.
- **Submeter Yankee real** (vermelho): exige dupla confirmação:
  - Primeiro clique → botão muda para "Confirmar" e abre janela de 15 segundos
  - Segundo clique dentro dos 15s → executa. Depois dos 15s → cancela e volta ao estado inicial

Campo de stake por ticket: `input[type=number]` com min=1, max=100. Stake total = `retryable_count × stake_input`.

#### 3.5 — Score Médio na aba Confrontos

**Linha 221 do arquivo atual:**
```jsx
<span className="text-2xl font-bold text-purple-400">4.01</span>
```
**Isso é hardcoded e está errado.** Substituir por:
```jsx
<span className="text-2xl font-bold text-purple-400">
  {yankeeData?.board?.stats?.avg_score?.toFixed(2) ?? '—'}
</span>
```

### Critério de aceite 3

- [ ] Nenhum número hardcoded na tabela Yankee
- [ ] Odds de cada jogo vêm de `t.legs` ou da estrutura que a API retornar
- [ ] Status do ticket reflete `result` da API, não string fixa
- [ ] Resumo (greens/reds) é calculado, não hardcoded
- [x] Cards Greens/Reds contam confrontos únicos, não aparições repetidas no BIBD
- [ ] Card BIBD de frequência presente e dinâmico
- [ ] Botão de submissão com dupla confirmação funciona
- [ ] Score Médio na aba Confrontos é dinâmico
- [x] Hover/focus dos confrontos usa card fixo e não desloca a matriz Yankee

---

## BLOCO 4 — CORRIGIR: AGRESSIVAS (simples E duplas)

**Arquivo atual:** `apps/web/src/app/page.tsx` — aba `agressivas`

**Problema:** A aba foi renomeada para "Singulares EV+" e mostra picks individuais. O pedido era **simples E duplas**. Duplas são pares de legs do mesmo confronto (same-game parlay).

**Referência:** Componente `ApolloAgressivasPanel` no Apollo Turbo.

### Contexto de negócio

Uma **dupla** é uma aposta combinada de dois mercados do **mesmo jogo**. Exemplo: `Over 2.5 gols FT + Ambos marcam FT` no mesmo Barcelona × Alavés. A probabilidade conjunta real é maior que `P(over 2.5) × P(btts)` porque esses eventos são positivamente correlacionados. O sistema já calcula os legs — a UI precisa agrupá-los por `match_id` e exibir pares.

### O que a aba deve ter

**Status atual (2026-05-16):** a aba `Agressivas EV+` tem painel executivo com cards `Duplas` e `Simples`, contagem `filtradas/total`, percentual `do total`, Green/Red com percentual sobre resolvidos, filtro de tipo `Todos/Duplas/Simples` e abertura/fechamento independente das duas seções para manter a página compacta.

#### 4.1 — Seção de Duplas (parte superior)

Cada linha é uma dupla:
- Nome do jogo (`Home × Away`)
- Liga
- Odd combinada da dupla (produto das duas odds)
- EV% da dupla (cor: verde se ≥8%, âmbar se ≥4%, branco se menor)
- Badge `"no board"` se o confronto está no board do Yankee
- Seta expansível: ao clicar, expande e mostra as duas legs individuais com `market_key`, odd, EV%, prob

**Como construir duplas a partir da API:**
- Chamar `GET /v1/runs/:id/strategy/family_filter` ou `combo_scored`
- Agrupar resultados por `match_id`
- Para cada `match_id` com ≥2 legs, pegar os 2 de maior EV — essa é a dupla

#### 4.2 — Seção de Simples / Top picks (parte inferior)

Tabela com colunas: `Rank | Família | Período | Mercado | Odd | EV% | Tier | Selecionado`

- Máximo 7 picks
- `Selecionado` = badge verde se o pick está em algum ticket Yankee

#### 4.3 — Nome da aba

O nome deve ser `Agressivas EV+`, não "Singulares EV+".

#### 4.4 — Remover "Trincas EV+"

A seção "Trincas EV+ (Correlação Aplicada)" que está hoje no código **não foi pedida** e deve ser removida. Não há ticket de solicitação para ela.

### Critério de aceite 4

- [x] Aba nomeada "Agressivas EV+"
- [x] Seção de duplas presente com agrupamento por `match_id`
- [x] Cada dupla mostrando odd combinada e EV% dinâmicos
- [x] Expansão de dupla mostrando as duas legs com detalhes
- [x] Seção de simples presente e dinâmica
- [x] Badge "no board" funcional (cruza com dados do Yankee)
- [x] Seção "Trincas" removida
- [x] Cards executivos de `Duplas` e `Simples` com contador e percentual
- [x] Cards executivos mostram Green/Red e percentual de cada produto sobre resolvidos
- [x] Filtro `Todos/Duplas/Simples` funcional
- [x] Seções `Duplas` e `Simples` com abrir/fechar independente

---

## BLOCO 5 — ABA RESOLVER

**Estado atual:** Aba implementada em `apps/web/src/app/page.tsx` com resumo, dry-run, reparo, liquidação, painel de progresso e exportação CSV.

**Referência:** Aba `value="resolver"` no Apollo Turbo — seção "Resolver · predições Motor Turbo".

Esta aba é o coração operacional. Sem ela, não há como fechar posições após os jogos.

### O que deve funcionar

#### 5.1 — Controles

- Botão **"Liquidar Run"** (âmbar): liquida predições pendentes contra resultados reais
  - Chama `POST /v1/settle/:run_id`
  - Dupla confirmação: mesmo padrão do botão Yankee (clique → 15s → confirma)
  - Após confirmar, exibe progresso por etapas e fica desabilitado apenas enquanto a ação roda
- Botão **"Reparar histórico"** (ciano): reseta e reliquida um run fechado com as regras atuais
- Botão **"Dry-run"**: simula o settlement sem gravar e exibe progresso/resultado próprio
- Botão **"Atualizar"** (verde): recarrega os dados sem fazer settlement

#### 5.2 — Atividade e resultado

Durante dry-run, liquidação ou reparo, exibir um painel de atividade com:
- Status de confirmação, andamento, sucesso ou erro
- Barra de progresso e etapas numeradas
- Detalhe operacional curto, por exemplo `"API avaliando resultados reais"`

Após conclusão, exibir apenas o banner compacto do último resultado operacional:
- Modo `dry-run`: `"Dry-run — simulação (sem gravação)"`
- Modo `settle`: `"Última liquidação gravada"`
- Modo `repair`: `"Histórico reparado"`

Ao iniciar uma nova ação do Resolver, limpar banners antigos de dry-run/liquidação/reparo para evitar cards redundantes.

#### 5.3 — KPIs (6 colunas)

`Predições | Green | Red | Pendentes | Cert. | Taxa`

Cores: Green → verde; Red → rosa; Pendentes → âmbar se >0, cinza se 0.

Cards `Green` e `Red` mostram quantidade e percentual no mesmo card. A base do percentual é `green + red` (resolvidas), por exemplo `3324 / Green / 48.4% dos resolvidos`.

#### 5.4 — Tabela de predições

Colunas: `Run ID | Home | Away | Liga | Mercado | Família | Período | Direção | Linha | Odd Mercado | Odd Curinga | Edge % | Conf | Selecionado | Resultado | Valor Real | Delta | Liquidado em`

Cores de linha: verde para `GREEN`, rosa para `RED`, neutro para pendente.

Para estabilidade da Web, a tela renderiza uma amostra inicial de 500 predições e mantém o CSV completo no botão de exportação.

### Critério de aceite 5

- [x] Aba "Resolver" aparece no menu de tabs
- [x] Botão "Liquidar Run" faz `POST /v1/settle/:run_id` e exibe resultado
- [x] Dupla confirmação funciona para liquidação e reparo
- [x] Ações exibem progresso visual e limpam banners antigos ao iniciar nova operação
- [x] KPIs dinâmicos refletem o estado real das predições
- [x] Tabela mostra predições com cores corretas por resultado sem renderizar o run inteiro no DOM
- [x] Exportar CSV funciona com a lista completa

---

## BLOCO 6 — ADICIONAR: ABA APRENDIZADO

**Arquivo atual:** Aba não existe.

**Referência:** Aba `value="aprendizado"` no Apollo Turbo.

### O que deve funcionar

#### 6.1 — KPIs (6 colunas)

`Predições | Resolvidas | Selecionadas | Eixos | EWMA A | EWMA B`

- EWMA A e B: verde se > 0.5, âmbar se ≤ 0.5

#### 6.2 — Card "Maiores desvios"

Tabela: `Família | Direção | N amostras | HR real | Prob esperada | Bias (pp)`

- `HR real` em verde
- `Bias` em verde se positivo, vermelho se negativo
- Ordenado por `|Bias|` decrescente

#### 6.3 — Card "Estados recentes"

Tabela: `Liga | Família | Dir | EWMA A | EWMA B | Amostras`

Máximo 10 linhas, ordenado por `updated_at` DESC.

Fonte de dados: `GET /v1/calibration/:liga` para a liga do run atual, ou todos se sem run.

### Critério de aceite 6

- [ ] Aba "Aprendizado" aparece no menu
- [ ] KPIs dinâmicos vindos da API de calibração
- [ ] Tabela de maiores desvios presente e dinâmica
- [ ] Tabela de estados recentes presente e dinâmica

---

## BLOCO 7 — ADICIONAR: ABA RESULTADOS

**Arquivo atual:** Aba não existe.

**Referência:** Aba `value="resultados"` no Apollo Turbo.

### O que deve funcionar

Lista dos últimos 30 runs com:

- `Run ID` (font-mono)
- `Data` (data_start do run)
- `Tipo` (atual / histórico)
- `Jogos` (count de partidas)
- `Boards` (count de confrontos aprovados)
- `Tickets` (count de tickets Yankee)
- `Status` (badge de status)
- `Notas` (texto do campo `notes` do run, truncado)
- Botão de deletar run (ícone lixeira, aparece no hover)
  - Ao clicar: substituir pelo par "Sim / Não" de confirmação
  - "Sim" → `DELETE /v1/runs/:id` → remove da lista
  - "Não" → cancela

Botão "Limpar tudo" no topo direito com mesmo padrão de dupla confirmação.

Clicar em uma linha → seleciona esse run e atualiza todas as outras abas para mostrar dados desse run.

### Critério de aceite 7

- [ ] Aba "Resultados" aparece no menu
- [ ] Lista de runs carregada de `GET /v1/runs`
- [ ] Deletar run individual com confirmação funciona
- [ ] "Limpar tudo" com confirmação funciona
- [ ] Clicar na linha muda o run ativo globalmente

---

## BLOCO 8 — ADICIONAR: RUN SELECTOR GLOBAL (sticky)

**Referência:** Seção de "Run Selector" no topo da página Apollo Turbo (sticky, com backdrop blur).

Hoje a UI mostra apenas o `run_id` atual em texto estático. Precisa virar um seletor interativo.

### O que deve funcionar

No topo da página, acima das tabs, fixo ao scroll (`position: sticky, top: 0`):

- Ícone de histórico + label "Run"
- `<select>` ou dropdown listando os últimos 30 runs:
  - Cada opção: `run_id (mono) | N boards | N tickets | notas`
  - Run atual marcado com badge verde "atual"
  - Runs históricos com badge ciano "histórico"
- Ao trocar de run no dropdown → todas as abas recarregam com dados do run selecionado
- KPIs inline no header (não podem ser hardcoded):
  - **Abertos** = tickets com `status = 'ready'` ou `'submitted'`
  - **Resolvidos hoje** = tickets com `settled_at` = hoje
  - **Stake** = soma de `stake_brl` de todos os tickets abertos (formato BRL: `R$ X.XXX,XX`)

### Critério de aceite 8

- [ ] Dropdown de runs funcional listando dados reais da API
- [ ] Trocar run no dropdown atualiza todas as abas
- [ ] KPIs no header são dinâmicos e refletem o run selecionado
- [ ] Header é sticky (não some ao rolar a página)

---

## BLOCO 9 — ITENS DE QUALIDADE GERAL

Estes itens se aplicam a toda a UI e devem ser corrigidos junto com os blocos acima.

### 9.1 — URL da API configurável

**Hoje:** `http://127.0.0.1:4040` hardcoded no `handleRunTerreo`.

**Corrigir:** Usar variável de ambiente:
```
NEXT_PUBLIC_API_URL=http://127.0.0.1:4040
```
No código: `process.env.NEXT_PUBLIC_API_URL`. Sem essa variável setada, exibir erro claro na UI, não silenciar.

### 9.2 — Estado de erro visível

Hoje o `catch` só faz `console.error`. O usuário não vê nada.

**Corrigir:** Exibir banner de erro vermelho com a mensagem quando qualquer chamada à API falhar. O banner deve ter botão de fechar.

### 9.3 — Estado de loading por aba

Hoje existe um único `loading` global. Quando está carregando, nenhuma aba mostra indicador.

**Corrigir:** Cada aba deve mostrar um skeleton ou spinner enquanto seus dados estão sendo carregados.

### 9.4 — Remover todos os hardcodes numéricos

Buscar no arquivo por qualquer número literal em JSX que não seja `0` ou `1` de condição. Exemplos a remover:
- `3.05`, `2.80`, `3.15`, `2.65` (odds hardcoded)
- `R$3` (stake hardcoded)
- `4.01` (score hardcoded)
- `R$ 30,00` (stake total hardcoded)
- `8/8 estágios concluídos` (pipeline hardcoded)

### Critério de aceite 9

- [ ] Sem nenhum número de negócio hardcoded no JSX
- [ ] URL da API via env var
- [ ] Erros de API visíveis ao usuário
- [ ] Loading state por aba

---

## BLOCO 10 — IMPLEMENTAR: SCOUT IA (opt-in)

**Arquivo atual:** `packages/scout/src/index.mjs` existe mas **não é IA** — é um formatador de string determinístico que monta um texto com o top pick. Não há nenhuma chamada a LLM em nenhum lugar do projeto.

**Referência de spec:** `C:\Users\Rogerio\Desktop\RGMV_PROJETOS\MOTOR4x4\scripts\MOTOR4x4_SPEC.md` — Seção 9 "SCOUT — auditoria IA opt-in"

**O que o HTML do MOTOR4x4 mostra que deve ser entregue e não foi:**
O diagrama animado (`MOTOR4x4_ANIMACAO.html`) representa corretamente o SCOUT como módulo ativo na pipeline com pacote rosa animado. O problema é que o diagrama é a especificação — não a implementação.

---

### O que o SCOUT real deve fazer

O SCOUT recebe o contexto completo da predição (slots + evidence + odds_snapshot) e chama um LLM para auditar se o edge identificado faz sentido contextualmente. Ele **não substitui** a decisão do motor — apenas anota flags e ajusta confidence dentro de limites controlados.

**Ativação:** `options.scout: true` na request (default `false`). Quando `false`, o campo `"scout": null` na response e o módulo não é nem carregado.

---

### 10.1 — Contrato de saída (ScoutOverlay)

O campo `scout` na response deve ter esta estrutura quando ativado:

```json
{
  "model": "gpt-4o",
  "latency_ms": 890,
  "tokens_used": 1240,
  "red_flags": [
    {
      "market_key": "gols_total_ft_over_25",
      "reason": "chuva forte prevista reduz volume de jogo",
      "severity": "medium",
      "confidence_delta": -0.10,
      "rationale": "precipitação >15mm historicamente reduz over 2.5 em 8pp"
    }
  ],
  "narrative": "Partida equilibrada. Motor detectou edge em gols e escanteios. Chuva é variável de risco não capturada nos dados históricos — revisar antes de apostar.",
  "scout_score": 78,
  "skip_reason": null
}
```

Quando todos os providers falharem:
```json
{
  "model": null,
  "latency_ms": 20003,
  "tokens_used": 0,
  "red_flags": [],
  "narrative": null,
  "scout_score": null,
  "skip_reason": "all_providers_failed"
}
```

---

### 10.2 — Cadeia de fallback de providers

**Ordem obrigatória:** GPT-4o → Perplexity → Claude

Cada provider tem timeout de 20 segundos. Se estourar ou retornar erro, tenta o próximo. Se todos falharem, retorna `skip_reason: "all_providers_failed"` e a pipeline continua normalmente sem scout.

Configurar via variáveis de ambiente:
```
OPENAI_API_KEY=...
PERPLEXITY_API_KEY=...
ANTHROPIC_API_KEY=...
SCOUT_TIMEOUT_MS=20000
```

Se nenhuma das três variáveis estiver definida, o módulo deve retornar `skip_reason: "no_provider_configured"` sem erro fatal.

---

### 10.3 — Restrições que o orquestrador deve aplicar

Antes de aplicar os deltas do SCOUT ao response final, o orquestrador deve **clipar**:

```javascript
// confidence_delta fora do range [-0.20, +0.15] → clipar, não rejeitar
const clipped = Math.max(-0.20, Math.min(+0.15, flag.confidence_delta));
```

Valores fora do range são clipados silenciosamente. O `rationale` do SCOUT é preservado mesmo quando clipado.

**severity** aceita apenas: `low | medium | high`. Qualquer outro valor → ignorar a flag.

---

### 10.4 — Posição na pipeline

O SCOUT deve rodar **depois** da calibração isotônica e **antes** da montagem do response final. Ele é não-bloqueante: roda em `Promise.allSettled` junto com o Evidence Pack. Se o timeout estourar, a predição retorna sem scout overlay — nunca atrasa a response além do timeout configurado.

```
Curinga
  └─▶ Isotonic (D8)
        └─▶ [paralelo] Evidence Pack  +  SCOUT (se opt-in)
              └─▶ Orquestrador aplica confidence_delta
                    └─▶ Response
```

---

### 10.5 — Prompt base para o LLM

O prompt deve incluir, **no mínimo**:

- Nome dos times, liga, data
- Top 5 slots do `ev_ranked` com `market_key`, `fair_prob`, `market_odd`, `edge_pct`, `confidence`
- Evidence resumido: médias ofensivas/defensivas dos dois times, H2H últimos 5 jogos
- `match_context.regime_hints` se presentes (derby, chuva, etc.)

O LLM deve retornar JSON estruturado (use `response_format: { type: "json_object" }` no OpenAI). Valide o retorno com Zod antes de usar.

---

### 10.6 — Onde fica o código

Reescrever `packages/scout/src/index.mjs` substituindo o gerador de texto atual pela integração real com LLM. O arquivo de entrada do módulo deve exportar:

```javascript
export async function runScout({ slots, evidence, matchContext, options })
// Retorna ScoutOverlay | null (null se scout=false)
```

O módulo atual (`buildScoutReport`) pode ser mantido como fallback de texto humano nos `scout_notes`, mas **não pode ser apresentado como "auditoria IA"**.

---

### 10.7 — Diagnósticos no response

Quando SCOUT rodar, adicionar ao campo `diagnostics`:

```json
"scout_ms": 890,
"scout_provider": "gpt-4o",
"scout_tokens": 1240
```

Quando `scout=false` ou falhou:
```json
"scout_ms": null,
"scout_provider": null,
"scout_tokens": 0
```

---

### Critério de aceite 10

- [ ] `options.scout: false` → campo `"scout": null` no response, zero chamadas externas, zero latência adicionada
- [ ] `options.scout: true` + `OPENAI_API_KEY` configurada → response contém `ScoutOverlay` com `model: "gpt-4o"`
- [ ] Se OpenAI falhar → tenta Perplexity → tenta Claude → `skip_reason: "all_providers_failed"`
- [ ] `confidence_delta` fora de `[-0.20, +0.15]` é clipado antes de entrar no response
- [ ] Timeout de 20s respeitado — pipeline não trava além disso
- [ ] `tokens_used` e `scout_ms` registrados em `diagnostics`
- [ ] Sem nenhuma chave de API hardcoded no código — apenas via env var
- [ ] `packages/scout/src/index.mjs` não usa mais `if/else` para gerar texto de "IA" — usa LLM real

---

## CHECKLIST FINAL DE ENTREGA

O dev só pode considerar entregue quando **todos** os itens abaixo estiverem marcados:

**Backend / Dados**
- [ ] `setup:replay` executado — `scout.db` tem `team_profiles` e `league_priors`
- [ ] Engine B rodando — `engine_b.available: true` no audit
- [ ] Ao menos um run do dia atual com `certified: true` e zero warnings de dados

**UI — Abas existentes corrigidas**
- [ ] Pipeline monitor: 11 estágios dinâmicos, sem nada hardcoded
- [ ] Yankee matrix: odds, stake, status e resumo todos dinâmicos
- [ ] Yankee: card de frequência BIBD presente
- [ ] Yankee: botões de dry-run e submissão real com dupla confirmação
- [x] Agressivas: renomeada para "Agressivas EV+"
- [x] Agressivas: seção de duplas implementada
- [x] Agressivas: seção "Trincas" removida
- [x] Agressivas: cards executivos, filtro por tipo e abrir/fechar por seção
- [ ] Confrontos: Score Médio dinâmico (linha 221 do arquivo original)

**UI — Abas novas**
- [ ] Aba Resolver implementada e funcional
- [ ] Aba Aprendizado implementada e funcional
- [ ] Aba Resultados com deletar individual e limpar tudo
- [ ] Run Selector sticky no topo com KPIs dinâmicos

**SCOUT IA (backend)**
- [ ] `options.scout: false` → `"scout": null` no response, zero chamadas externas
- [ ] `options.scout: true` → LLM real chamado (GPT-4o → Perplexity → Claude)
- [ ] Cadeia de fallback e timeout de 20s funcionando
- [ ] `confidence_delta` clipado em `[-0.20, +0.15]` pelo orquestrador
- [ ] Chaves de API via env var, nunca hardcoded
- [ ] `packages/scout/src/index.mjs` não usa mais `if/else` para simular IA

**Qualidade**
- [ ] URL da API via `NEXT_PUBLIC_API_URL`
- [ ] Erros de API exibidos na tela
- [ ] Loading state por aba
- [ ] Zero números de negócio hardcoded

---

## REFERÊNCIAS DE CÓDIGO

| O que implementar | Onde ler no projeto de referência |
|---|---|
| Pipeline monitor ao vivo | `opta-extractor/web/src/app/(app)/apollo-turbo/page.tsx` — componente `LivePipelineMonitor` e constante `STAGE_DEFS` |
| Yankee matrix | `opta-extractor/web/src/...` — componente `ApolloYankeeMatrix` |
| Submissão Yankee | `opta-extractor/web/src/...` — componente `TurboYankeeSubmitPanel` |
| Agressivas duplas + simples | `opta-extractor/web/src/...` — componente `ApolloAgressivasPanel` |
| Resolver/settlement | `opta-extractor/web/src/...` — aba `value="resolver"` |
| Aprendizado/EWMA | `opta-extractor/web/src/...` — aba `value="aprendizado"` |
| Resultados/histórico | `opta-extractor/web/src/...` — aba `value="resultados"` |
| Run selector sticky | `opta-extractor/web/src/...` — seção de "Run Selector" no topo |
| SCOUT IA — spec completa | `MOTOR4x4\scripts\MOTOR4x4_SPEC.md` — Seção 9 "SCOUT — auditoria IA opt-in" |
| SCOUT IA — posição na pipeline | `MOTOR4x4\scripts\MOTOR4x4_ANIMACAO.html` — etapa 11 da animação e caixa tracejada no SVG |

**Caminho completo da referência UI:**
`C:\Users\Rogerio\Desktop\RGMV_PROJETOS\SOLUCAO_IA\opta-extractor\web\src\app\(app)\apollo-turbo\`

**Caminho completo da referência SCOUT:**
`C:\Users\Rogerio\Desktop\RGMV_PROJETOS\MOTOR4x4\scripts\MOTOR4x4_SPEC.md` — Seção 9 (linha 644)

---

## REGRA DE OURO

> Se você está colocando um número entre aspas dentro de JSX que não veio de uma variável da API — você está fazendo errado. Pare. Volte à API. Encontre o campo correto. Use-o.

---

*Documento gerado em 2026-05-13 com base em auditoria do código-fonte.*
*Atualizado em 2026-05-13 — adicionado Bloco 10 (SCOUT IA) após auditoria do MOTOR4x4.*
*Versão do sistema auditado: motor 0.8.0 / UI page.tsx 503 linhas / MOTOR4x4_SPEC.md v1.0.*
