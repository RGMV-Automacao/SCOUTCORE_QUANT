PLANO — DRY-RUN E SUBMIT REAL SUPERBET NO MOTOR UNIFICADO

CONTEXTO ARQUITETURAL

O pipeline atual de submit do motor opera assim:

fetch-superbet-odds (job/cron)
        ↓
  /v1/run  (batch predict: Engine A + B + Curinga + Scout)
        ↓
  /v1/runs/:id/strategy/yankee  (combinator + board-validator + BIBD)
        ↓
        /v1/runs/:id/yankee/dry-run   ← valida board local + catálogo/quote público da Superbet e persiste status='validated', is_dry_run=1
        ↓  (aprovação manual)
        /v1/runs/:id/yankee/submit    ← repete a validação externa; só persiste status='submitted' se não houver bloqueios
        ↓  (após os jogos)
  /v1/settle/tickets            ← settlement cascata no DB

A “submissão real” neste sistema continua sendo a persistência local em yankee_submissions para posterior colocação manual na Superbet ou automação futura. Ainda não existe bot de aposta automática, mas agora o gate de dry-run/submit já compara os tickets com o catálogo e a quote pública da casa antes de liberar o passo seguinte.

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
} | ConvertTo-Json

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

- status = validated
- tickets_count > 0
- validation_scope = local_board_plus_superbet_catalog
- external_validation.summary.tickets_total > 0
- blocking = [] para um dry-run aprovado; se vier `superbet_boards_failed:*` ou `superbet_gaps:*`, o ticket ainda não está apto
- stake_total = tickets_count × stake_per_ticket

Observação importante:

- No contrato atual, o dry-run sempre persiste uma linha em yankee_submissions com is_dry_run=1 e status=validated.
- O dry-run agora também tenta casar cada board com o catálogo público do Bet Builder e pedir a quote combinada da Superbet.
- status=validated sozinho não basta; blocking precisa estar vazio e external_validation.summary.tickets_ok precisa bater com tickets_total antes do submit real.
- Divergência de preço acima do limite atual também entra em blocking, no formato `price_drift_combo:*` dentro de external_validation.tickets[].boards[].gaps.

Tarefa 1.4 — Inspecionar tickets do dry-run

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

Tarefa 1.5 — Critérios de aprovação do dry-run

Critério | Gate | Ação se falhar
board_status = ok | Obrigatório | Expandir janela, revisar oferta de odds ou reduzir filtros
tickets_count ≥ 1 | Obrigatório | Verificar odds no DB, reexecutar scraper, ampliar janela
blocking = [] | Obrigatório | Não seguir para submit; revisar strategy, drift e gaps retornados por external_validation
external_validation.summary.tickets_ok = tickets_total | Obrigatório | Não seguir para submit; ajustar board ou reexecutar mais perto do horário do jogo
combo_odd por confronto dentro da faixa do Yankee | Obrigatório | Revisar odd_combo_range e odd_combo_exception
Warnings críticos revisados | Recomendado | Inspecionar board.warnings e motor-runs do run
stake_total ≤ limite diário | Obrigatório | Ajustar stake_per_ticket

BLOCO 2 — SUBMIT REAL

Pré-condição:

- dry-run aprovado
- kickoffs ainda no futuro para os jogos dos tickets
- nenhuma submissão real anterior para o mesmo run

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

Tarefa 2.2 — Executar submit real

$submitBody = @{
  stake_per_ticket = 3
  confirm = $true
} | ConvertTo-Json

$submitResult = Invoke-RestMethod "http://127.0.0.1:4040/v1/runs/$runId/yankee/submit" `
  -Method Post `
  -ContentType 'application/json' `
  -Body $submitBody `
  -TimeoutSec 120

Write-Host "Submission ID: $($submitResult.submission_id)"
Write-Host "Status: $($submitResult.status)"
Write-Host "Tickets: $($submitResult.tickets_count)"
Write-Host "Stake total: R$ $($submitResult.stake_total)"

Observações:

- confirm=true é obrigatório no contrato atual.
- Se houver bloqueio, o endpoint rejeita a submissão e o payload precisa ser revisado antes de nova tentativa.

Tarefa 2.3 — Exportar mesa para colocação manual na Superbet

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

Tarefa 2.4 — Verificar persistência da submissão

$finalCheck = Invoke-RestMethod "http://127.0.0.1:4040/v1/runs/$runId/yankee/submissions"
$finalCheck.items | Format-Table submission_id, status, is_dry_run, tickets_count, stake_total, submitted_at

BLOCO 3 — SETTLEMENT

Observação:

- O settlement de tickets considera submissões com status submitted ou pending.
- Dry-runs com status validated não entram no settle.

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
[ ] Dry-run retornou status = validated com blocking = []
[ ] Tickets inspecionados manualmente
[ ] Nenhum submit real anterior no run
[ ] Submit real retornou status = submitted
[ ] CSV exportado para colocação manual
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

