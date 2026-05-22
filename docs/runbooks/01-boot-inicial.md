# Runbook: Boot inicial do SCOUTCORE_QUANT

> Estado atual: o runtime opera em **banco único**. `SCOUT_DB` deve apontar para `data/scout_extraction.db`. As seções antigas de dual-write neste runbook estão obsoletas.

## Pré-requisitos

- [ ] DB legado existe em `STATSLINE_LEGACY_DB`
- [ ] FutMax extractor parado durante a cópia inicial (evitar inconsistência)
- [ ] Espaço em disco: ~3 GB livres (cópia + WAL + replay outputs)
- [ ] Node 22+, Python 3.11+

## Passos

### 1. Configurar ambiente

```powershell
cd C:\Users\Rogerio\Desktop\RGMV_PROJETOS\SCOUTCORE_QUANT
git checkout dev
copy .env.example .env
# editar .env e ajustar STATSLINE_LEGACY_DB e SCOUT_DB
npm install
```

### 2. Preparar banco único

```powershell
npm run extraction:migrate
npm run single-db:copy   # opcional em ambiente novo/importacao legada
```

O runtime atual usa `data/scout_extraction.db` como banco canônico. Em ambiente já migrado, valide `SCOUT_DB` e pule a cópia legada.

### 3. Wipe do estado de motor antigo

```powershell
npm run setup:wipe-state
```

Apaga o estado runtime atual e legado: `yankee_submission_tickets`, `yankee_submission_audit`, `yankee_submissions`, `run_slots`, `runs`, `prediction`, `motor_run`, `clv_history` e, se existirem, `predictions`, `ml_predictions`, `calibration_states`, `motor_runs`, `motor_boards`, `motor_yankee_tickets`, `banca_apostas`, `tips`. Mantém: `partidas`, `team_profiles`, `eventos_faixa`, `odds`, `odds_historico` (dados crus). `VACUUM` é opt-in com `SCOUT_WIPE_VACUUM=1`.

### 4. Aplicar migrations do motor novo

```powershell
npm run setup:migrate
```

Cria/normaliza: `motor_run`, `prediction`, `calib_state`, `isotonic_blob`, `clv_history`, `feature_snapshot_cache`, `replay_progress`, `sync_check_log`, `schema_version`. As tabelas iniciais `motor_run_v2` e `calib_state_v2` são removidas pela migration 004 porque o runtime nunca escreve nelas.

### 5. Replay histórico (Opção B) — ~10 dias

```powershell
npm run setup:replay -- --engines=A,B
```

O replay usa Engine A+B por padrão (`REPLAY_ENGINES=A,B`). Se o sidecar B estiver indisponível, o bridge degrada a execução sem derrubar o job.

### 6. Subir API

```powershell
npm run dev:api
# health: http://127.0.0.1:4040/health
```

### 7. Dual-write no FutMax

Obsoleto no estado atual. Após a migração para banco único, o runtime do SCOUTCORE não depende mais de dual-write para operar.

### 8. Validar dual-write

Obsoleto no estado atual. A validação operacional agora é feita por `integrity_check`, smokes de API/sidecar e jobs rodando sobre `data/scout_extraction.db`.

### 9. Snapshot de closing line

O motor aceita closing odds no settlement. Para produzir o arquivo de entrada a partir da tabela `odds`, rode o snapshot perto do kickoff, idealmente T-5min:

```powershell
npm run job:snapshot-closing -- --date=2026-05-12 --out=audit\closing-2026-05-12.json
```

Por padrão o job só aceita odds coletadas nos últimos 15 minutos. Para auditoria/backfill sem filtro de frescor, use `--max-age-minutes=0`; isso é útil para diagnóstico, mas não deve ser tratado como CLV financeiro.

O arquivo gerado é consumido pelo settler:

```powershell
node apps\jobs\src\settle-results.mjs --run-id=<run_id> --closing-odds=audit\closing-2026-05-12.json
```

## Verificação final

- [ ] `data/scout_extraction.db` criado
- [ ] `predictions` zerada, `partidas` com 14998 linhas
- [ ] Migrations 001 aplicada (`SELECT * FROM schema_version`)
- [ ] `npm run dev:api` sobe sem erro
- [ ] `GET /health` retorna `{status:"ok"}`
- [ ] API + sidecar usando `SCOUT_DB=data/scout_extraction.db`
- [ ] `npm run job:snapshot-closing -- --dry-run` retorna cobertura compatível com a coleta de odds recente
