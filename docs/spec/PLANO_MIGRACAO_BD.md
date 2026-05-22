# PLANO DE MIGRAÇÃO — Consolidar em `scout_extraction.db` (BD ÚNICO)

> Versão: 2 (corrige v1 que assumia 2 BDs)
> Gerado em: 2026-05-17  
> Baseado em introspecção real dos 3 BDs + grep de uso real no código.  
> **Premissa imutável:** `scout_extraction.db` passa a ser o **único** banco do scout.  
> `scout.db` e `opta.db` serão **aposentados** (arquivados, não deletados).

---

## 0. Decisões já tomadas pelo dono (não revisar)

1. **BD único**: `data/scout_extraction.db` absorve tudo. Sem dual-write, sem 2 conexões.
2. **Backtest**: migrar **todas** as tabelas `backtest_*` (preservar histórico).
3. **Tabelas de app**: migrar **somente** as tabelas que o scout back/front usa de fato.  
   Não poluir o BD novo com tabelas legadas de outros projetos (banca, tips, users, etc.).
4. **Não inventar**. Em caso de dúvida, perguntar.

---

## 1. ESTADO REAL DOS 3 BANCOS

### 1.1 `data/scout_extraction.db` (alvo — já existe, ~stats prontos)
Tabelas presentes (já populadas via extração nova):
```
arbitros, certificacao_extracao, certificacao_liga, confronto,
eventos_faixa, extracoes_log, extraction_schema_version,
jogadores, odds, odds_coletas, odds_historico,
partida_arbitro, partidas, times
```
Tem **todo** o conteúdo de stats que o `opta.db` tinha + extras de extração nova.

### 1.2 `data/scout.db` (9.5 GB — a aposentar)
Contém mistura de:
- Stats antigos (duplicata do que já está em `scout_extraction.db`) → **NÃO migrar**.
- Estado próprio do motor scout (calibração, predições, runs, yankee, clv) → **MIGRAR**.
- Backtest histórico → **MIGRAR**.
- Tabelas legadas de outros projetos (banca, tips, escalações, rascunhos, users) → **NÃO migrar**.

### 1.3 `C:\...\SOLUCAO_IA\opta-extractor\db\opta.db` (1.75 GB — a aposentar)
Fonte original dos stats. Já 100% replicado em `scout_extraction.db`. **NÃO migrar nada.**

---

## 2. INVENTÁRIO DE TABELAS — DECISÃO POR TABELA

Critério: rodei grep por `FROM/INTO/UPDATE <tabela>` em `apps/api/src`, `apps/jobs/src`, `packages/**`,
ignorando testes, node_modules, scratch, audit. Resultado real (contagem de matches):

### 2.1 ✅ MIGRAR — Motor (estado vivo do scout)
| Tabela | Refs no código | Origem |
|---|---|---|
| `prediction` | 18 | scout.db |
| `runs` | 12 | scout.db |
| `calib_state` | 7 | scout.db |
| `isotonic_blob` | 6 | scout.db |
| `yankee_submissions` | 5 | scout.db |
| `clv_history` | 5 | scout.db |
| `run_slots` | 5 | scout.db |
| `league_priors` | 4 | scout.db |
| `team_profile_v2` | 4 | scout.db |
| `motor_run` | 3 | scout.db |
| `team_profiles` | 1 | **schema apenas** — repopular do zero (não copiar dados antigos) |

### 2.2 ✅ MIGRAR — Backtest (decisão do dono: preservar tudo)
| Tabela | Refs |
|---|---|
| `backtest_outcomes` | 22 |
| `backtest_predictions` | 15 |
| `backtest_eval` | 15 |
| `backtest_team_profiles` | 9 |
| `backtest_league_priors` | 7 |

### 2.3 ❌ NÃO MIGRAR — Já existem em scout_extraction.db (stats)
`partidas, eventos_faixa, jogadores, times, odds, odds_coletas, odds_historico,`
`extracoes_log, arbitros, partida_arbitro, confronto, certificacao_extracao, certificacao_liga`.

### 2.4 ❌ NÃO MIGRAR — Tabelas mortas no scout (zero uso no back/front)
Confirmadas por grep como **não referenciadas** pelo runtime do scout:
- App legacy: `users, auth_log, refresh_tokens, tips, tips_sessions, estrategia_registros,`
  `banca_apostas, banca_config, banca_movimentos, escalacoes_provavel, rascunhos`.
- Snapshots/cache não usados: `feature_snapshot, feature_snapshot_cache, ml_predictions,`
  `partida_clima, replay_progress, family_blend_weights`.
- Schema legado v2 abandonado (motor antigo): `motor_runs, motor_stage_runs,`
  `motor_telegram_log, motor_boards, motor_yankee_tickets` (substituídos por `motor_run`/`runs`/`run_slots`/`prediction`/`yankee_submissions`).
- Outros vazios/abandonados: `calibration_states, predictions, odds_valuebets, team_stat, match`.
- `sync_check_log`: usada apenas por `apps/jobs/src/sync-check.mjs`, que **será deprecado** (era do dual-write opta×scout). Não migrar.

### 2.5 DÚVIDAS RESOLVIDAS (decisão do dono — 2026-05-17)
- ✅ `team_profiles`: **será usada**. Criar tabela vazia em Fase B e popular via novo job de
  normalização em Fase F.5 (ver `scripts/rebuild-team-profiles-normalized.mjs`).
  **Não copiar dados antigos** de `scout.db` (legado pode estar sujo); repopular do zero a partir
  do `scout_extraction.db` normalizado.
- ✅ `schema_migrations` × `extraction_schema_version`: **manter os dois** no BD único.
  Cada um serve um runner distinto (`apps/api/src/migrate.mjs` usa `schema_migrations`;
  a pasta `migrations/extraction/` usa `extraction_schema_version`). Custo zero, evita refactor de runners.
- ✅ Rotas API lendo tabelas "mortas": confirmado pelo dono — **não há**. Seguir só com o que o grep encontrou.

---

## 3. INCOMPATIBILIDADES DE SCHEMA A RESOLVER

Detectadas comparando `scout.db` (origem) vs `scout_extraction.db` (alvo) para tabelas reutilizadas:

| # | Local | Problema | Ação |
|---|---|---|---|
| 1 | `apps/ml-sidecar/src/features.py` | usa `partidas.processado` | trocar para `processado_stats` (nome no novo BD) |
| 2 | `apps/ml-sidecar/src/features.py` | usava `times.escanteios_sofridos` antes da restauracao de colunas em 2026-05-19 | resolvido: a coluna voltou a existir e a extracao full reconstruiu os dados direto da fonte |
| 3 | `odds` | possíveis diffs de colunas | já tratado: `scripts/migrate-legacy-bookline-odds.mjs` (manter) |
| 4 | `times` | possíveis diffs de PK | mapeamento por (liga, time) — validar antes do refactor do repositório |

> Detalhar cada diff em script de pré-validação (Fase D.0) antes de migrar dados.

---

## 4. PLANO DE EXECUÇÃO POR FASES

### Fase A — Preparação (sem mudar nada em produção)
- A.1 Backup físico: copiar `scout.db` e `opta.db` para `data/_archive/YYYYMMDD/`.
- A.2 `PRAGMA integrity_check` nos 3 bancos.
- A.3 Snapshot de contagem de linhas (script `scripts/snapshot-row-counts.mjs`) — gera baseline para Fase H.
- A.4 Branch `feat/single-db-scout-extraction`.

### Fase B — Migrations DDL no `scout_extraction.db`
Criar (apply via `apps/api/src/migrate.mjs`):

- `migrations/extraction/006_motor_state.sql`
  - CREATE TABLE: `calib_state`, `isotonic_blob`, `team_profile_v2`, `team_profiles`,
    `league_priors`, `prediction`, `motor_run`, `runs`, `run_slots`,
    `clv_history`, `yankee_submissions`, `schema_migrations`.
  - Copiar **literalmente** os CREATE TABLE atuais (introspectar via
    `SELECT sql FROM sqlite_master`) para garantir paridade exata de colunas,
    defaults e PKs (importante: `prediction` foi alterada por mig 006 do projeto antigo).
  - Recriar índices existentes.
  - `extraction_schema_version` já existe — não mexer.

- `migrations/extraction/007_backtest.sql`
  - CREATE TABLE: `backtest_outcomes`, `backtest_predictions`, `backtest_eval`,
    `backtest_team_profiles`, `backtest_league_priors` + índices.

> Não criar tabelas da seção 2.4. Sem app/banca/tips/users/etc.

### Fase C — Validação pré-cópia (script `scripts/validate-pre-migration.mjs`)
- Conferir que cada tabela do alvo tem schema **idêntico** ao da origem (colunas, tipos, PK).
- Listar diffs e abortar se houver qualquer mismatch.
- Saída: `audit/migration/pre-check.json`.

### Fase D — Cópia de dados (script `scripts/copy-scout-to-extraction.mjs`)
- Usa `ATTACH DATABASE 'data/scout.db' AS src;`
- Para cada tabela das seções 2.1 e 2.2 (**exceto** `team_profiles` — ver F.5):
  ```sql
  INSERT OR IGNORE INTO <tabela> SELECT * FROM src.<tabela>;
  ```
- Executar em ordem: motor primeiro (FKs leves), depois backtest.
- Em transação por tabela. Log de `rowcount_before/after` por tabela.
- Idempotente: `INSERT OR IGNORE` permite re-rodar com segurança.
- `team_profiles` fica **vazia** após esta fase (será populada em F.5).
- Saída: `audit/migration/copy-report.json`.

### Fase E — Refactor de configuração (adotado — sem swap de nomes)

> **Estratégia executada (2026-05-17):** o runtime passou a apontar **explicitamente** para `data/scout_extraction.db`.
> Não houve swap de nomes de arquivo. `scout_extraction.db` permanece canônico e `scout.db` fica preservado como legado/rollback.

- `.env` e `.env.example`:
  - `SCOUT_DB=data/scout_extraction.db`.
  - `SCOUT_EXTRACTION_DB` fica mantido como alias de compatibilidade para scripts de extração/migração.
- Entry points atualizados para default de banco único:
  - `run_sidecar.py`
  - `start_sidecar.bat`
  - fallbacks em `apps/api/src/scheduler.mjs`, `apps/jobs/src/settle-results.mjs`, `apps/jobs/src/replay-bootstrap.mjs`
- Scripts e docs com referência operacional a `data/scout.db` devem ser revisados e/ou marcados como legado.

### Fase F — Refactor de código (mínimo necessário)
- `apps/ml-sidecar/src/features.py`:
  - Validação real do schema mostrou que `partidas.processado` continua existindo no alvo.
  - Ajuste efetivamente necessário: remover o filtro legado `modo = 'FT'`, inexistente em `scout_extraction.db`.
- `packages/data-access/src/SqliteMatchRepository.mjs`:
  - Validado em smoke real sem mudança funcional.
- Smoke test cobrindo: `GET /predict`, sidecar `/predict`, job `rebuild-team-profiles`.

### Fase F.5 — Repopular `team_profiles` (novo job)
- Reusar `apps/jobs/src/rebuild-team-profiles.mjs` (já existente).
- Lê `partidas` + `eventos_faixa` + `times` do `scout_extraction.db` **já normalizado**.
- Agrega por (liga, temporada, time, side) com a mesma lógica do legado, mas
  partindo de dados limpos (sem o lixo herdado do scout.db antigo).
- Idempotente: `DELETE FROM team_profiles WHERE liga=? AND temporada=?` antes de inserir o bloco.
- Saída: `audit/migration/team-profiles-rebuild.json` com contagens por liga.
- Certificação executada em `premier-league 2025/2026` com 349 partidas elegíveis e 20 times escritos.

### Fase G — Deprecar scripts e docs do mundo 2-BD
- DELETE / mover para `scripts/_deprecated/`:
  - `scripts/setup-copy-legacy.mjs` (copiava opta.db → scout.db)
  - `apps/jobs/src/sync-check.mjs` (comparava opta vs scout)
  - `scripts/diag-recent.mjs` (lê opta.db e scout.db lado a lado)
- Atualizar:
  - `docs/runbooks/02-dual-write.md` → marcar como obsoleto.
  - `README.md` (seção de bancos).

### Fase H — Validação pós-cópia (com `SCOUT_DB` já no banco único)
- Re-rodar `snapshot-row-counts.mjs` no `scout_extraction.db` e diff contra Fase A.3.
  - Para cada tabela migrada: contagem no alvo ≥ contagem na origem.
- `PRAGMA integrity_check;` no `scout_extraction.db`.
- Smoke com `SCOUT_DB=data/scout_extraction.db`:
  1. `node apps/api/src/migrate.mjs`
  2. Start API e sidecar
  3. `/v1/health` e `/v1/predict` retornam dados válidos.
  4. Job `rebuild-team-profiles` roda end-to-end.
  5. Job de backtest lê histórico OK.
- **Não** reverter `SCOUT_DB` após smoke; o cutover já fica efetivo no banco único.
- Gravar `audit/migration/post-check.json`.

### Fase I — Arquivar legado sem swap de nomes
**Pré-requisitos:** Fase H 100% verde + todos os serviços parados (API, sidecar, jobs, watchers).

1. Parar tudo: `pnpm stop` / matar processos node + python que abrem o BD.
2. Confirmar zero handles abertos: `handle.exe data\scout_extraction.db` (Sysinternals) ou equivalente.
3. Backup extra (paranoia): `Copy-Item data\scout_extraction.db data\_archive\YYYYMMDD\scout_extraction.db.post-cutover`.
4. Arquivar `scout.db` legado quando a operação estiver estável: `Move-Item data\scout.db data\_archive\YYYYMMDD\scout.legacy.db`.
5. Arquivar `opta.db` legado externo: `Move-Item ...\opta.db ...\_archive\YYYYMMDD\opta.legacy.db`.
6. Subir serviços. Rodar smoke novamente (agora sem override manual de path).
7. Atualizar `.gitignore` se necessário. Tag git: `db-consolidated-v1`.
8. Aguardar **14 dias** de operação estável antes de qualquer remoção definitiva dos arquivos legados.

---

## 5. ROLLBACK

Se Fase H falhar (antes do cutover definitivo):
1. Reapontar `SCOUT_DB` para `data/scout.db` no ambiente local, se necessário.
2. Investigar `scout_extraction.db`, corrigir, re-rodar Fase D/H.

Se falhar **depois** do cutover no `.env`:
1. Parar serviços.
2. Restaurar `SCOUT_DB=data/scout.db` temporariamente.
3. Se `scout.db` já tiver sido arquivado, restaurar de `data\_archive\YYYYMMDD\scout.legacy.db`.
3. Subir serviços — mundo volta ao estado pré-migração em segundos.
3. Restaurar do backup A.1 se houve qualquer escrita no alvo durante o teste.

---

## 6. CHECKLIST DE EXECUÇÃO

- [x] Confirmar dúvidas da seção 2.5 com o dono (resolvidas 2026-05-17)
- [x] A.1–A.4 Preparação (backup em `data/_archive/20260517-193859/`, integrity OK, snapshot inicial, branch)
- [x] B Migrations DDL aplicadas (`006_motor_state.sql` + `007_backtest.sql` versionadas em `migrations/extraction/`, idempotentes — validadas em DB temp)
- [x] C Pré-validação OK (16/16 schemas paritários — `audit/migration/pre-check.json`)
- [x] D Cópia executada e relatório arquivado (15 tabelas, 14.709.890 linhas — `audit/migration/copy-report.json`)
- [x] E `.env` atualizado em dev (single-db, `SCOUT_DB=data/scout_extraction.db`; vars órfãs `OPTA_LEGACY_DB` / `STATSLINE_LEGACY_DB` / `SCOUT_EXTRACTION_DB` removidas)
- [x] F Refactors de código + smoke local (features.py, scheduler/settle/replay fallbacks; ~13 scripts utilitários migrados para `process.env.SCOUT_DB || 'data/scout_extraction.db'`)
- [x] F.5 `team_profiles` repopulada via novo job (smoke `premier-league 2025/2026`: 349 partidas, 20 times)
- [x] G Scripts legados movidos para `scripts/_deprecated/` (`sync-check.mjs`, `setup-copy-legacy.mjs`, `diag-recent.mjs`, `audit-legacy-parity.mjs`)
- [x] H Validação pós-migração (API certified=true, sidecar 33 models, integrity_check pré+pós OK — `audit/migration/post-check.json`)
- [ ] I Bancos antigos arquivados — **não executado**. Optou-se por **não fazer swap** de nomes (custo de refactor em 20+ scripts de extração que usam `scout_extraction.db` como canônico era maior do que o ganho). `scout.db` legado permanece em `data/` apenas como referência/rollback rápido; arquivar fisicamente após 14 dias de operação estável (≥ 2026-05-31).

---

## 7. O QUE ESTE PLANO **NÃO** FAZ (escopo fora)
- Não cria schema novo, só replica o existente do scout.db.
- Não migra tabelas de banca/tips/users/escalações.
- Não toca em opta.db (apenas arquiva).
- Não muda formato de odds nem regra de mapeamento (já feito por mig 005 + scripts existentes).
- Não altera o frontend (a web só consome a API; agnóstica ao BD).

---

## 8. ENCERRAMENTO (2026-05-17 — pós-execução)

| Item | Estado |
|---|---|
| Banco único ativo | `data/scout_extraction.db` (32 tabelas: 14 extração + 12 motor + 5 backtest + `schema_migrations`) |
| Banco legado | `data/scout.db` (9.97 GB) — congelado, não escrito por runtime |
| Backup físico | `data/_archive/20260517-193859/` |
| Migrations versionadas | `migrations/extraction/001`…`005` (extração) + `006_motor_state.sql` + `007_backtest.sql` |
| Variáveis de ambiente removidas | `OPTA_LEGACY_DB`, `STATSLINE_LEGACY_DB`, `SCOUT_EXTRACTION_DB` |
| Scripts deprecados | `scripts/_deprecated/` (`sync-check.mjs`, `setup-copy-legacy.mjs`, `diag-recent.mjs`, `audit-legacy-parity.mjs`) |
| Certificação | `audit/migration/post-check.json` |
| Próxima ação | Após 14 dias estáveis, executar Fase I (arquivar `scout.db` legado em `data/_archive/`). |
