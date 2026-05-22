PLANO — DRY-RUN E SUBMIT REAL SUPERBET NO MOTOR UNIFICADO

CONTEXTO ARQUITETURAL

O pipeline atual de submit do motor opera assim:

fetch-superbet-odds (job/cron)
        ↓
  /v1/run  (batch predict: Engine A + B + Curinga + Scout)
        ↓
  /v1/runs/:id/strategy/yankee  (combinator + board-validator + BIBD)
        ↓
        /v1/runs/:id/yankee/dry-run   ← opcional: valida board local + catálogo/quote público da Superbet e persiste status='external_passed' ou 'external_failed', is_dry_run=1
        ↓  (atalho permitido sem dry-run)
        /v1/runs/:id/yankee/submit    ← monta/repara/valida no próprio submit; se houver dry-run, reutiliza overrides efetivos; tenta submit real se o executor estiver habilitado
        ↓  (após os jogos)
  /v1/settle/tickets            ← settlement cascata no DB

A “submissão real” agora tem duas camadas: persistência auditável local em `yankee_submissions`/`yankee_submission_tickets` e executor externo opcional. Sem `SCOUTCORE_BOOKLINE_REAL_SUBMIT=true` ou `BOOKLINE_REAL_SUBMIT=true`, o submit fica em `ready_for_real_submit`; com credenciais de sessão/cookie configuradas, o backend tenta enviar ticket a ticket e grava recibo/erro para retry.

CANAL DE SUBMIT (browser vs. fetch)

O executor externo tem dois canais:

- `browser` (default quando `BOOKLINE_EMAIL`/`BOOKLINE_PASSWORD` ou `BOOKLINE_STORAGE_STATE` existem): a API mantém um Playwright singleton (`apps/api/src/bookline-session.mjs`), faz login automaticamente, força refresh do token antifraud (`refreshAntifraudToken`), extrai `sessionid = ${antifraud}|${userId}` e dispara o POST via `page.request.post`, reusando o cookie jar autenticado (`sb-production-token`). Esse é o único caminho certificável — equivalente ao legado `ApolloFinalV2/bot/api-submitter.mjs`.
- `fetch` (fallback explícito com `BOOKLINE_SUBMIT_VIA_BROWSER=false`): a API usa `fetch` direto com `BOOKLINE_SESSIONID`/`BOOKLINE_COOKIE` de env. Funciona enquanto o token não rotacionar; serve apenas para debug.

Variáveis relevantes:

- `BOOKLINE_EMAIL` / `BOOKLINE_PASSWORD` — credenciais Superbet.
- `BOOKLINE_STORAGE_STATE` — caminho do storage state (default `data/.bookline-session.json`).
- `BOOKLINE_HEADLESS` — `true` por padrão; `false` para diagnóstico visual.
- `BOOKLINE_SUBMIT_VIA_BROWSER` — override explícito do canal (`true`/`false`).
- `BOOKLINE_SESSIONID_TTL_MS` — cache do sessionid extraído (default 25000ms).
- `SCOUTCORE_BOOKLINE_REAL_SUBMIT` / `BOOKLINE_REAL_SUBMIT` — habilita o executor.

Pré-requisito: `npm install` em `apps/api` (Playwright é `optionalDependency`). Depois, `npx playwright install chromium` uma vez.


Notas operacionais do estado atual:

- O gap de aliases numéricos de market_key já foi corrigido no registry. Não é mais pré-requisito deste runbook.
- Os comandos abaixo assumem PowerShell. Neste ambiente, curl é alias de Invoke-WebRequest; por isso o runbook usa Invoke-RestMethod.
- O entrypoint atual da API é apps/api/src/index.mjs. Em dev, o caminho mais simples é .\dev.ps1 -Api -Sidecar.
- O /v1/run já resolve odds do banco internamente. Não é necessário enviar options.resolve_odds.
- O POST /v1/settle/tickets lê dry_run no body, não na query string.

BLOCO 0 — PRÉ-RUN

Tarefa 0.1 — Verificar ambiente e dados

1. Banco configurado, partidas futuras e odds do dia

$script = @'
import 'dotenv/config';
import Database from 'better-sqlite3';

const db = new Database(process.env.SCOUT_DB, { readonly: true });
const today = new Date().toISOString().slice(0, 10);

const partidas = db.prepare(`
  SELECT COUNT(*) AS n
  FROM partidas
  WHERE date(data_partida) >= date(?)
`).get(today);

const odds = db.prepare(`
  SELECT COUNT(*) AS n
  FROM odds
  WHERE data_jogo = ?
`).get(today);

console.log(JSON.stringify({
  scout_db: process.env.SCOUT_DB,
  partidas_hoje_ou_futuras: partidas.n,
  odds_hoje: odds.n,
}, null, 2));

db.close();
'@
$script | node --input-type=module -

2. Sidecar ML

Invoke-RestMethod 'http://127.0.0.1:4055/health' -TimeoutSec 10

3. Chaves externas, só relevantes se scout=true

'OPENAI_API_KEY','ANTHROPIC_API_KEY','PERPLEXITY_API_KEY','ENGINE_B_URL' |
  ForEach-Object {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_))) {
      Write-Host "$_ = ausente"
    } else {
      Write-Host "$_ = configurada"
    }
  }

Se odds estiverem ausentes, executar antes de prosseguir:

node apps/jobs/src/fetch-superbet-odds.mjs

Tarefa 0.2 — Subir a API e o sidecar

Opção recomendada em dev:

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv_scq\Scripts\Activate.ps1
.\dev.ps1 -Api -Sidecar

Alternativa direta só para a API:

node apps/api/src/index.mjs

Health checks:

Invoke-RestMethod 'http://127.0.0.1:4040/health' -TimeoutSec 10
Invoke-RestMethod 'http://127.0.0.1:4055/health' -TimeoutSec 10

Tarefa 0.3 — Parâmetros operacionais

- include_engines: ['A','B'] quando o sidecar estiver saudável; usar ['A'] se o sidecar estiver fora.
- scout: false para smoke rápido; true só quando quiser enriquecimento LLM e tiver keys configuradas.
- include_started: false por padrão; usar true apenas em replay/teste retrospectivo, quando já houver jogos iniciados no intervalo.
- date_start/date_end: estes são os nomes corretos do range no contrato atual do /v1/run.

BLOCO 1 — DRY-RUN

Tarefa 1.1 — Executar /v1/run

$today = (Get-Date).ToString('yyyy-MM-dd')
$tomorrow = (Get-Date).AddDays(1).ToString('yyyy-MM-dd')

$runBody = @{
  date_start = $today
  date_end = $tomorrow
  options = @{
    include_engines = @('A','B')
    scout = $false
    min_edge_pp = 2
    feature_set = 'v3'
  }
} | ConvertTo-Json -Depth 10

$runResponse = Invoke-RestMethod 'http://127.0.0.1:4040/v1/run' `
  -Method Post `
  -ContentType 'application/json' `
  -Body $runBody `
  -TimeoutSec 180

$runId = $runResponse.run_id
Write-Host "Run ID: $runId"
Write-Host "Matches: $($runResponse.matches)"
Write-Host "Slots: $($runResponse.slots)"
Write-Host "Motor runs: $(@($runResponse.motor_runs).Count)"
Write-Host "Engines: $($runResponse.engines -join ', ')"

Verificações esperadas:

- matches > 0
- slots > 0

Observação:

- O response agregado do /v1/run não traz warnings por confronto.
- Para inspecionar warnings e diagnostics de um confronto específico, use um item de motor_runs:

$sampleMotorRunId = $runResponse.motor_runs[0].run_id
$motor = Invoke-RestMethod "http://127.0.0.1:4040/v1/motor-runs/$sampleMotorRunId"
$motor.response.warnings

Monitorar progresso:

- O POST acima é síncrono; com Invoke-RestMethod ele só retorna quando o run termina.
- O endpoint /v1/runs/:id/progress é útil quando o POST foi disparado por outro cliente, UI ou terminal.

Exemplo de polling:

do {
  $prog = Invoke-RestMethod "http://127.0.0.1:4040/v1/runs/$runId/progress" -TimeoutSec 10
  Write-Host "status=$($prog.status) fase=$($prog.phase) jogos=$($prog.matches_done)/$($prog.total_matches) slots=$($prog.slots_built)"
  if ($prog.status -ne 'running') { break }
  Start-Sleep -Seconds 2
} while ($true)

Tarefa 1.2 — Aplicar strategy Yankee (preview)

$yankeePreview = Invoke-RestMethod "http://127.0.0.1:4040/v1/runs/$runId/strategy/yankee" `
  -Method Post `
  -ContentType 'application/json' `
  -Body '{}' `
  -TimeoutSec 120

Write-Host "Board status: $($yankeePreview.board.board_status)"
Write-Host "Confrontos aprovados: $($yankeePreview.board.stats.approved_count)"
Write-Host "Confrontos prontos: $($yankeePreview.board.stats.ready_count)"
Write-Host "Tickets gerados: $(@($yankeePreview.tickets).Count)"
Write-Host "Yankee status: $($yankeePreview.meta.yankee_status)"
Write-Host "Avg ticket odd (informativa): $($yankeePreview.meta.avg_ticket_odd)"

$comboStats = $yankeePreview.board.ready_combos |
  Measure-Object -Property combo_odd -Minimum -Maximum -Average

Write-Host "Combo odd min: $($comboStats.Minimum)"
Write-Host "Combo odd max: $($comboStats.Maximum)"
Write-Host "Combo odd avg: $([Math]::Round($comboStats.Average, 4))"

Critérios de qualidade reais:

- board.board_status deve ser ok para seguir para um dry-run sério de operação.
- tickets.Count > 0
- O gate de 2.50–3.50 vale para combo_odd por confronto, não para ticket_odd final.
- No Yankee, combo_odd já aplica `builder_discount` a partir de `builder_discount_min_legs` (3 legs por padrão).
- avg_ticket_odd é informativa e costuma ser muito maior, porque cada ticket multiplica 4 combo_odd.

Se board_status for insufficient:

- ampliar date_end
- verificar odds disponíveis no banco
- revisar cobertura de partidas no intervalo

Tarefa 1.3 — Executar dry-run Yankee

$dryBody = @{
  stake_per_ticket = 3
} | ConvertTo-Json -Depth 20

$dryRun = Invoke-RestMethod "http://127.0.0.1:4040/v1/runs/$runId/yankee/dry-run" `
  -Method Post `
  -ContentType 'application/json' `
  -Body $dryBody `
  -TimeoutSec 120

Write-Host "Submission ID: $($dryRun.submission_id)"
Write-Host "Status: $($dryRun.status)"
Write-Host "Tickets: $($dryRun.tickets_count)"
Write-Host "Stake total: R$ $($dryRun.stake_total)"
Write-Host "Escopo: $($dryRun.validation_scope)"
Write-Host "Blocking: $($dryRun.blocking -join ', ')"
Write-Host "Warnings: $($dryRun.warnings -join ', ')"
Write-Host "Superbet summary: $($dryRun.external_validation.summary | ConvertTo-Json -Compress)"

Verificações:

- status = external_passed
- tickets_count > 0
- validation_scope = local_board_plus_superbet_catalog
- external_validation.summary.tickets_total > 0
- can_submit_real = true
- blocking = [] para um dry-run aprovado; se vier `superbet_boards_failed:*` ou `superbet_gaps:*`, mesmo após o reparo automático, o ticket ainda não está apto
- stake_total = tickets_count × stake_per_ticket

Observação importante:

- No contrato atual, o dry-run persiste uma linha em yankee_submissions com is_dry_run=1 e status semântico: `external_passed` se aprovado; `external_failed` se houver bloqueio.
- O dry-run agora também tenta casar cada board com o catálogo público do Bet Builder e pedir a quote combinada da Superbet.
- Se a validação externa reprovar um confronto por `price_drift_combo:*` e/ou `actual_ev_combo:*`, a montagem automática da Yankee exclui esse match_id e tenta remontar o board com os próximos confrontos aprovados.
- O payload expõe esse histórico em `repair_history[]`, agora com `excluded_matches[] { match_id, match, reasons[] }` e `added_matches[] { match_id, match }`, e adiciona warnings no formato `superbet_repair_pass:N:excluded_matches:X`.
- status=external_passed sozinho ainda deve ser conferido junto com `blocking=[]`, `can_submit_real=true` e `external_validation.summary.tickets_ok = tickets_total`.
- Divergência de preço acima do limite atual também entra em blocking, no formato `price_drift_combo:*` dentro de external_validation.tickets[].boards[].gaps.
- EV real combinado abaixo do mínimo configurado entra em blocking como `actual_ev_combo:*`; padrão atual aceita pequena variação até `min_actual_combo_ev=-0.01` (-1%).
- Mercado ausente, seleção ausente ou quote inativa continuam apenas como trava; nesses casos o board não é trocado automaticamente.
- Submit real agora pode ser chamado sem dry-run prévio; nesse caso o backend monta a Yankee, aplica reparo automático, valida catálogo/quote público e só tenta tickets `ok`.
- Submit real também pode seguir em modo parcial quando houver tickets `ok` e outros bloqueados. Os inválidos ficam fora do submit e podem ser ajustados depois.
- Se `repair_history` vier preenchido no dry-run e `blocking` estiver vazio, o submit real deve enviar `overrides = $dryRun.effective_overrides` para usar o board reparado retornado na própria resposta. Sem dry-run, o backend calcula os overrides efetivos no próprio submit.

Tarefa 1.4 — Preview seguro de 1 quadra sem submit

Antes de qualquer teste real, validar a montagem do payload de 1 quadra sem POST de aposta:

$previewBody = @{
  dry_run_submission_id = $dryRun.submission_id
  stake_per_ticket = 1
  ticket_kind = 'fourfold'
  max_tickets = 1
} | ConvertTo-Json -Depth 10

$submitPreview = Invoke-RestMethod "http://127.0.0.1:4040/v1/runs/$runId/yankee/submit-preview" `
  -Method Post `
  -ContentType 'application/json' `
  -Body $previewBody `
  -TimeoutSec 30

Write-Host "Mode: $($submitPreview.mode)"
Write-Host "Executor real habilitado: $($submitPreview.real_submit_enabled)"
Write-Host "Ready: $($submitPreview.summary.ready)/$($submitPreview.summary.selected_total)"
Write-Host "Failed: $($submitPreview.summary.failed)"
Write-Host "Skipped: $($submitPreview.summary.skipped)"
Write-Host "Ticket: $($submitPreview.tickets[0] | ConvertTo-Json -Compress)"

Verificações:

- mode = submit_preview_no_post
- summary.ready = 1
- summary.failed = 0
- summary.selected_total = 1
- summary.skipped = tickets_total - 1
- Nenhuma linha nova com is_dry_run=0 deve aparecer em /v1/runs/:id/yankee/submissions.

Observações:

- Yankee automático não persiste `kind`; a API infere `fourfold` quando o ticket tem 4 boards/match_ids.
- `submit-preview` reusa o dry-run aprovado, remonta payload, quote/meta e hash, mas não chama o endpoint real de aposta.
- Na UI, o botão “Testar 1 quadra” usa este contrato.

Tarefa 1.5 — Inspecionar tickets do dry-run

$dryRun.tickets | ForEach-Object {
  Write-Host "--- Ticket $($_.ticket_idx) | Odd: $($_.ticket_odd) | Stake: R$ $($_.stake_brl) ---"
  $_.boards | ForEach-Object {
    Write-Host "  Match: $($_.match_id) | Status: $($_.status)"
    $_.legs | ForEach-Object {
      Write-Host "    - $($_.market_key)"
    }
  }
}

Exportar CSV de auditoria do run:

npm run run:audit -- --run-id=$runId --out="audit/dry-run-$(Get-Date -Format 'yyyy-MM-dd')"

Tarefa 1.6 — Critérios de aprovação do dry-run

Critério | Gate | Ação se falhar
board_status = ok | Obrigatório | Expandir janela, revisar oferta de odds ou reduzir filtros
tickets_count ≥ 1 | Obrigatório | Verificar odds no DB, reexecutar scraper, ampliar janela
blocking = [] | Obrigatório | Não seguir para submit; revisar strategy, drift e gaps retornados por external_validation
external_validation.summary.tickets_ok = tickets_total | Obrigatório | Não seguir para submit; ajustar board ou reexecutar mais perto do horário do jogo
repair_history revisado | Recomendado | Conferir quais confrontos foram excluídos automaticamente e se o board final continua coerente
combo_odd por confronto dentro da faixa do Yankee | Obrigatório | Revisar odd_combo_range e odd_combo_exception
Warnings críticos revisados | Recomendado | Inspecionar board.warnings e motor-runs do run
stake_total ≤ limite diário | Obrigatório | Ajustar stake_per_ticket

BLOCO 2 — SUBMIT REAL

Pré-condição:

- kickoffs ainda no futuro para os jogos dos tickets
- nenhuma submissão real anterior para o mesmo run
- dry-run aprovado é recomendado para auditoria/preview, mas não é obrigatório para o botão Superbet

Tarefa 2.1 — Confirmar estado pré-submit

$submissions = Invoke-RestMethod "http://127.0.0.1:4040/v1/runs/$runId/yankee/submissions"
$realSubs = @($submissions.items | Where-Object { -not $_.is_dry_run })

if ($realSubs.Count -gt 0) {
  Write-Host 'Já existe submit real para este run. Abortando.'
  exit 1
}

Conferir kickoff manualmente usando /v1/matches no mesmo intervalo do run:

$matches = Invoke-RestMethod "http://127.0.0.1:4040/v1/matches?date_start=$today&date_end=$tomorrow"
$byId = @{}
$matches.items | ForEach-Object { $byId[$_.id_confronto] = $_ }

$dryRun.tickets | ForEach-Object {
  $_.boards | ForEach-Object {
    $m = $byId[$_.match_id]
    if ($null -ne $m) {
      Write-Host "Match $($m.id_confronto) | $($m.home) x $($m.away) | $($m.data) $($m.hora) | status=$($m.status)"
    } else {
      Write-Host "Match $($_.match_id) não encontrado em /v1/matches; verificar no DB"
    }
  }
}

Tarefa 2.2 — Executar submit real limitado a 1 quadra

Para teste controlado, submeter apenas 1 quadra aprovada. Este é o mesmo filtro usado pelo preview seguro:

$submitBody = @{
  stake_per_ticket = 1
  confirm = $true
  ticket_kind = 'fourfold'
  max_tickets = 1
} | ConvertTo-Json -Depth 10

if ($dryRun) {
  $submitBodyObj = $submitBody | ConvertFrom-Json
  $submitBodyObj | Add-Member -NotePropertyName dry_run_submission_id -NotePropertyValue $dryRun.submission_id -Force
  $submitBodyObj | Add-Member -NotePropertyName overrides -NotePropertyValue $dryRun.effective_overrides -Force
  $submitBody = $submitBodyObj | ConvertTo-Json -Depth 10
}

$submitResult = Invoke-RestMethod "http://127.0.0.1:4040/v1/runs/$runId/yankee/submit" `
  -Method Post `
  -ContentType 'application/json' `
  -Body $submitBody `
  -TimeoutSec 120

Write-Host "Submission ID: $($submitResult.submission_id)"
Write-Host "Status: $($submitResult.status)"
Write-Host "Tickets gerados: $($submitResult.tickets_count)"
Write-Host "Real submit: $($submitResult.real_submit_summary | ConvertTo-Json -Compress)"

Verificações:

- real_submit_summary.selected_total = 1
- real_submit_summary.skipped = tickets_ok - 1
- Se executor real estiver habilitado, somente 1 ticket deve aparecer como submitted/failed; os demais tickets OK ficam `skipped`, não `pending`.
- Se executor real estiver desligado, status esperado é `ready_for_real_submit`.
- Se nenhum dry-run foi enviado, a resposta ainda deve trazer `validation_scope=local_board_plus_superbet_catalog` e `external_validation.summary`.

Tarefa 2.3 — Executar submit real de todos os tickets OK

$submitBody = @{
  stake_per_ticket = 3
  confirm = $true
  dry_run_submission_id = $dryRun.submission_id
  overrides = $dryRun.effective_overrides
} | ConvertTo-Json -Depth 10

$submitResult = Invoke-RestMethod "http://127.0.0.1:4040/v1/runs/$runId/yankee/submit" `
  -Method Post `
  -ContentType 'application/json' `
  -Body $submitBody `
  -TimeoutSec 120

Write-Host "Submission ID: $($submitResult.submission_id)"
Write-Host "Status: $($submitResult.status)"
Write-Host "Tickets: $($submitResult.tickets_count)"
Write-Host "Stake total: R$ $($submitResult.stake_total)"
Write-Host "Real submit: $($submitResult.real_submit_summary | ConvertTo-Json -Compress)"

Observações:

- confirm=true é obrigatório no contrato atual.
- `overrides=$dryRun.effective_overrides` evita voltar ao board anterior quando o dry-run trocou confrontos por drift/EV real.
- `ticket_kind`/`ticket_idx`/`max_tickets` limitam o escopo do submit real. Sem esses campos, a API tenta todos os tickets OK.
- Se o executor real estiver desativado, status esperado é `ready_for_real_submit` e os tickets ficam persistidos para colocação manual ou retry após habilitar credenciais.
- Se o executor real estiver ativado, status esperado é `submitted`; falhas parciais retornam `partial_submitted` ou `submit_failed` e ficam retryáveis por ticket.
- Se houver bloqueio, o endpoint rejeita a submissão e o payload precisa ser revisado antes de nova tentativa.

Retry idempotente de uma submissão já criada:

$retryBody = @{
  confirm = $true
} | ConvertTo-Json

$retry = Invoke-RestMethod "http://127.0.0.1:4040/v1/runs/$runId/yankee/submissions/$($submitResult.submission_id)/retry-real" `
  -Method Post `
  -ContentType 'application/json' `
  -Body $retryBody `
  -TimeoutSec 120

$retry | ConvertTo-Json -Depth 5

Tarefa 2.4 — Exportar mesa para colocação manual na Superbet

$csvPath = "submit-$runId.csv"
"ticket_idx,match_id,market_key,ticket_odd,stake_brl" | Out-File $csvPath -Encoding utf8

$submitResult.tickets | ForEach-Object {
  $ticketIdx = $_.ticket_idx
  $ticketOdd = $_.ticket_odd
  $stake = $_.stake_brl
  $_.boards | ForEach-Object {
    $matchId = $_.match_id
    $_.legs | ForEach-Object {
      "$ticketIdx,$matchId,$($_.market_key),$ticketOdd,$stake" | Out-File $csvPath -Append -Encoding utf8
    }
  }
}

Write-Host "Exportado: $csvPath"

Checklist de colocação manual:

- abrir o site da Superbet
- montar cada ticket na ordem do CSV
- verificar se a odd final está aceitável versus ticket_odd
- stake = R$ 3,00 por ticket
- registrar o slip ID manualmente, se houver controle externo

Tarefa 2.5 — Verificar persistência da submissão

$finalCheck = Invoke-RestMethod "http://127.0.0.1:4040/v1/runs/$runId/yankee/submissions"
$finalCheck.items | Format-Table submission_id, status, is_dry_run, tickets_count, stake_total, submitted_at

BLOCO 3 — SETTLEMENT

Observação:

- O settlement de tickets considera submissões com status submitted ou pending.
- Dry-runs com status `external_passed`/`external_failed` não entram no settle.

Tarefa 3.1 — Settlement dry-run

$settleTestBody = @{
  dry_run = $true
} | ConvertTo-Json

$settleTest = Invoke-RestMethod 'http://127.0.0.1:4040/v1/settle/tickets' `
  -Method Post `
  -ContentType 'application/json' `
  -Body $settleTestBody `
  -TimeoutSec 120

Write-Host "Settled: $($settleTest.settled)"
Write-Host "Pending: $($settleTest.pending)"
Write-Host "Green: $($settleTest.green)"
Write-Host "Red: $($settleTest.red)"

Tarefa 3.2 — Settlement real

$settleReal = Invoke-RestMethod 'http://127.0.0.1:4040/v1/settle/tickets' `
  -Method Post `
  -ContentType 'application/json' `
  -Body '{}' `
  -TimeoutSec 120

$settleReal | ConvertTo-Json -Depth 5

CHECKLIST FINAL PRÉ-VIRADA DE CHAVE

[ ] Ambiente validado: DB, odds, API e sidecar
[ ] API respondendo em /health
[ ] /v1/run retornou matches > 0 e slots > 0
[ ] Preview Yankee retornou board_status = ok e tickets > 0
[ ] Dry-run opcional retornou status = external_passed com blocking = [] e can_submit_real = true, quando usado
[ ] Preview opcional de 1 quadra retornou mode = submit_preview_no_post, ready = 1 e failed = 0, quando usado
[ ] Tickets inspecionados manualmente
[ ] Nenhum submit real anterior no run
[ ] Submit real de teste foi limitado com ticket_kind = fourfold e max_tickets = 1, ou houve decisão explícita de enviar todos os tickets OK
[ ] Submit real retornou status = submitted/partial_submitted, ou ready_for_real_submit se executor externo estiver desligado
[ ] CSV exportado para colocação manual quando executor externo estiver desligado
[ ] Settlement testado após os jogos

NOTAS PARA O AGENTE

Parâmetros ajustáveis por run:

- stake_per_ticket: padrão 3
- include_engines: ['A','B'] ou ['A']
- scout: false para smoke, true para operação com enriquecimento
- date_start/date_end: expandir se houver poucos jogos
- include_started: usar apenas em replay/retroteste

Rollback local de submissão, se necessário:

$script = @'
import 'dotenv/config';
import Database from 'better-sqlite3';

const db = new Database(process.env.SCOUT_DB);
db.prepare("UPDATE yankee_submissions SET status='cancelled' WHERE submission_id=?")
  .run('sub-xxx');
console.log('submission cancelada');
db.close();
'@
$script | node --input-type=module -

Não existe ação destrutiva irreversível até a colocação manual na Superbet. Todos os comandos acima até o submit operam apenas no banco local.

