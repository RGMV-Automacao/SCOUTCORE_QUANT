# Runbook: Boot inicial do SCOUTCORE_QUANT

## Pré-requisitos

- [ ] `opta.db` existe em `OPTA_LEGACY_DB` (default: `C:\Users\Rogerio\Desktop\RGMV_PROJETOS\SOLUCAO_IA\opta-extractor\db\opta.db`)
- [ ] FutMax extractor parado durante a cópia inicial (evitar inconsistência)
- [ ] Espaço em disco: ~3 GB livres (cópia + WAL + replay outputs)
- [ ] Node 22+, Python 3.11+

## Passos

### 1. Configurar ambiente

```powershell
cd C:\Users\Rogerio\Desktop\RGMV_PROJETOS\SCOUTCORE_QUANT
git checkout dev
copy .env.example .env
# editar .env e ajustar OPTA_LEGACY_DB e SCOUT_DB
npm install
```

### 2. Cópia única do opta.db → scout.db

```powershell
npm run setup:copy-legacy
```

Saída esperada: `OK — 1532 MB em ~30s`. Idempotente: aborta se `data/scout.db` já existe.

### 3. Wipe do estado de motor antigo

```powershell
npm run setup:wipe-state
```

Apaga: `predictions`, `ml_predictions`, `calibration_states`, `motor_runs`, `motor_boards`, `motor_yankee_tickets`, `banca_apostas`, `tips`. Mantém: `partidas`, `team_profiles`, `eventos_faixa`, `odds`, `odds_historico` (dados crus). Roda `VACUUM` no final.

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

### 7. Configurar dual-write no FutMax

Ver runbook separado (TODO). Resumo: criar `futmax/lib/dual-writer.cjs` e substituir `legacy.prepare(...).run(...)` por `dualWrite(...)` nos extractors de `partidas`, `eventos_faixa`, `odds`, `odds_historico`, `team_profiles`.

### 8. Validar dual-write

Após primeira extração com dual-write ativo:

```powershell
npm run job:sync-check
```

Esperado: `OK <table>: delta=0` em todas as tabelas. Se houver drift > 5, investigar logs do FutMax.

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

- [ ] `data/scout.db` criado
- [ ] `predictions` zerada, `partidas` com 14998 linhas
- [ ] Migrations 001 aplicada (`SELECT * FROM schema_version`)
- [ ] `npm run dev:api` sobe sem erro
- [ ] `GET /health` retorna `{status:"ok"}`
- [ ] FutMax dual-write configurado
- [ ] Sync-check sem drift
- [ ] `npm run job:snapshot-closing -- --dry-run` retorna cobertura compatível com a coleta de odds recente
