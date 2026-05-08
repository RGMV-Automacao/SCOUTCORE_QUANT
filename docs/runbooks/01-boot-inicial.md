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

Cria: `motor_run_v2`, `calib_state_v2`, `isotonic_blob`, `clv_history`, `feature_snapshot_cache`, `replay_progress`, `sync_check_log`, `schema_version`.

### 5. Replay histórico (Opção B) — ~10 dias

```powershell
npm run setup:replay
```

> ⚠️ **STUB neste momento.** Implementação real depende dos pacotes `engine-a`, `engine-b-bridge`, `markets`, `data-access`, `evidence`. Ver SPEC §17.4.

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

## Verificação final

- [ ] `data/scout.db` criado
- [ ] `predictions` zerada, `partidas` com 14998 linhas
- [ ] Migrations 001 aplicada (`SELECT * FROM schema_version`)
- [ ] `npm run dev:api` sobe sem erro
- [ ] `GET /health` retorna `{status:"ok"}`
- [ ] FutMax dual-write configurado
- [ ] Sync-check sem drift
