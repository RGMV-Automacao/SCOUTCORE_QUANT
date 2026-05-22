# Atualização de Dados — Runbook

Fluxo completo para atualizar dados antes de gerar uma nova RUN.  
Executar sempre a partir da raiz do repositório com `.env` carregado.

---

## Ordem de execução (dia a dia)

### 1. Schedule (fixtures / calendário)

Popula partidas futuras e passadas. Pré-requisito de todos os outros steps.

```powershell
# Todas as ligas configuradas em config/extraction-leagues.json
node apps/jobs/src/extract-statsline-schedule.mjs --all

# Liga + temporada específica
node apps/jobs/src/extract-statsline-schedule.mjs --liga=brasileirao --temporada=2026
node apps/jobs/src/extract-statsline-schedule.mjs --liga=premier-league --temporada=2025/2026
node apps/jobs/src/extract-statsline-schedule.mjs --liga=la-liga --temporada=2025/2026
node apps/jobs/src/extract-statsline-schedule.mjs --liga=la-liga-2 --temporada=2025/2026
node apps/jobs/src/extract-statsline-schedule.mjs --liga=brasileirao-b --temporada=2026
node apps/jobs/src/extract-statsline-schedule.mjs --liga=liga-mx --temporada=2026
```

Flags opcionais: `--dry-run` (simula sem gravar), `--limit=N`, `--json` (output estruturado).

---

### 2. Match stats (resultados + eventos de partidas já jogadas)

Busca estatísticas de partidas que já ocorreram e ainda não foram processadas.

```powershell
# Todas as ligas pendentes
node apps/jobs/src/extract-statsline-matchstats.mjs --all

# Liga específica (boa opção pós-rodada)
node apps/jobs/src/extract-statsline-matchstats.mjs --liga=brasileirao --temporada=2026 --limit=10
node apps/jobs/src/extract-statsline-matchstats.mjs --liga=premier-league --temporada=2025/2026 --limit=10
```

Flags opcionais: `--concurrency=N` (padrão 8), `--force` (reprocessa já extraídos), `--dry-run`.

---

### 3. Odds (bookline)

Busca odds da casa de apostas para partidas do período.

```powershell
# Jogos de hoje
node apps/jobs/src/extract-bookline-odds.mjs --date=2026-05-17

# Janela de datas (ex: próximos 3 dias)
node apps/jobs/src/extract-bookline-odds.mjs --from=2026-05-17 --to=2026-05-19

# Liga específica
node apps/jobs/src/extract-bookline-odds.mjs --date=2026-05-17 --liga=brasileirao

# Partida específica por match-id
node apps/jobs/src/extract-bookline-odds.mjs --match-id=<id>
```

Flags opcionais: `--resolve-missing-events` (tenta casar eventos sem ID), `--dry-run`, `--json`.

---

### 4. Reconstruir perfis e priors

**Executar após importar stats novas.** Necessário para que engine-a use dados atualizados.

Desde 2026-05-19, o bot local de extração reconstrói automaticamente `team_profile_v2` e `league_priors` para as ligas/temporadas que tiveram matchstats processadas no tick. Para atualizar tudo sob demanda:

```powershell
.\update_team_profiles.bat
# ou
npm run profiles:rebuild
```

Para rodar apenas a etapa de perfis/priors pelo bot:

```powershell
node apps/jobs/src/extraction-local-scheduler.mjs --profiles-only --once
```

```powershell
# Team profiles (uma chamada por liga)
node apps/jobs/src/rebuild-team-profiles.mjs --liga=brasileirao --temporada=2026
node apps/jobs/src/rebuild-team-profiles.mjs --liga=brasileirao-b --temporada=2026
node apps/jobs/src/rebuild-team-profiles.mjs --liga=premier-league --temporada=2025/2026
node apps/jobs/src/rebuild-team-profiles.mjs --liga=la-liga --temporada=2025/2026
node apps/jobs/src/rebuild-team-profiles.mjs --liga=la-liga-2 --temporada=2025/2026
node apps/jobs/src/rebuild-team-profiles.mjs --liga=liga-mx --temporada=2026

# League priors (uma chamada por liga)
node apps/jobs/src/rebuild-league-priors.mjs --liga=brasileirao --temporada=2026
node apps/jobs/src/rebuild-league-priors.mjs --liga=premier-league --temporada=2025/2026
node apps/jobs/src/rebuild-league-priors.mjs --liga=la-liga --temporada=2025/2026
```

Flag opcional: `--as-of=YYYY-MM-DD` (PIT — ponto no tempo para backtest).

---

## Steps periódicos (não diários)

### 5. Settle resultados (pós-partida)

Resolve predictions abertas contra resultados reais e atualiza `calib_state`.

```powershell
node apps/jobs/src/settle-results.mjs --liga=brasileirao --temporada=2026
node apps/jobs/src/settle-results.mjs --liga=premier-league --temporada=2025/2026
```

### 6. Refit isotônico (D+8 ou semanal)

Treina regressão isotônica sobre predictions settled. Mínimo 20 amostras por chave.

```powershell
node apps/jobs/src/refit-isotonic.mjs
```

---

## Automatizado (scheduler local)

`extraction-local-scheduler.mjs` executa o ciclo 1 → 2 → 3 → 4 em loop com intervalo configurável.

### Subir o scheduler

```powershell
# A partir da raiz do repo
node apps/jobs/src/extraction-local-scheduler.mjs
```

Roda em foreground. Para deixar em background, abra um terminal separado e deixe rodando.

Intervalo controlado por `SCOUT_EXTRACTION_SCHEDULE_INTERVAL_MIN` no `.env` (padrão: 60 min).  
Limite de stats por tick: `SCOUT_EXTRACTION_STATS_LIMIT_PER_TICK` (padrão: 50).

O scheduler usa o mesmo writer de `extract-statsline-matchstats.mjs`; desde 2026-05-19 isso inclui o preenchimento das colunas legadas compatíveis restauradas em `times` e `confronto`, e o rebuild automático de `team_profile_v2`/`league_priors` quando houver stats novas. Para desligar esse rebuild, use `--no-profiles` ou `SCOUT_EXTRACTION_REBUILD_PROFILES_ENABLED=false`.

### Encontrar o PID do scheduler em execução

```powershell
# Lista todos os processos node com a linha de comando
Get-WmiObject Win32_Process -Filter "Name='node.exe'" |
  Select-Object ProcessId, @{N='Cmd';E={$_.CommandLine}} |
  Where-Object { $_.Cmd -like '*extraction-local-scheduler*' }
```

Ou versão curta (só o PID):
```powershell
(Get-WmiObject Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*extraction-local-scheduler*' }).ProcessId
```

### Parar o scheduler

```powershell
# Pelo PID encontrado acima (substitua <PID>)
Stop-Process -Id <PID> -Force

# Ou matar direto sem buscar PID manualmente
Get-WmiObject Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*extraction-local-scheduler*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force; "Parado PID $($_.ProcessId)" }
```

### Rodar uma vez (sem loop, útil para atualização pontual)

```powershell
node apps/jobs/src/extraction-local-scheduler.mjs --once
```

Para reparo controlado de um backlog já marcado como processado, prefira o comando direto abaixo em vez do loop do bot:

```powershell
node apps/jobs/src/extract-statsline-matchstats.mjs --force --all --json
```

---

## Verificar dados atuais no DB

```powershell
# Contagem rápida via API
$h = Invoke-RestMethod http://127.0.0.1:4040/health
$h.checks | ConvertTo-Json -Depth 3
```

Campos relevantes: `team_profiles_v2.max_as_of`, `league_priors.max_as_of`, `isotonic_blob.max_fit_at`.
