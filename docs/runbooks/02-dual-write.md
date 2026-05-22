# Runbook 02 — Dual-write FutMax → scout.db

> Obsoleto desde 2026-05-17. O runtime do SCOUTCORE passou a operar com `SCOUT_DB=data/scout_extraction.db` como banco único. Este runbook fica apenas como registro histórico do fluxo anterior.

## Objetivo
Ativar a gravação espelhada das tabelas core (`partidas`, `eventos_faixa`, `odds`, `odds_historico`) do FutMax (opta.db legacy) para `scout.db` (motor SCOUTCORE), liga a liga.

## Componentes
- `opta-extractor/src/dual-writer.js` — módulo de espelhamento (lazy, gateado, fail-safe).
- Hooks no FutMax:
  - `database.js` → `insertPartida`, `updatePartidaMetadata`, `saveOdd`, `saveOddsBatch`.
  - `extractor.js` → batch `eventos_faixa` + `UPDATE partidas SET processado=1`.
- Não espelhamos `team_profiles`: motor reconstrói via job próprio.

## Variáveis de ambiente (no `.env` do FutMax)
```
SCOUT_DB=C:\Users\Rogerio\Desktop\RGMV_PROJETOS\SCOUTCORE_QUANT\data\scout.db
DUAL_WRITE_LEAGUES=        # vazio = kill switch (nada é espelhado)
```

Para ligar uma liga, listar codinome partida-liga (csv). O dual-writer expande automaticamente para os apelidos do mercado de odds:

| partida-liga          | aliases odds expandidos              |
|-----------------------|--------------------------------------|
| brasileirao           | brasileiro                           |
| brasileirao-b         | brasileirob                          |
| la-liga               | laliga                               |
| la-liga-2             | laliga2                              |
| serie-a               | seriea                               |
| serie-b-italia        | serieb                               |
| ligue-1               | ligue1                               |
| liga-mx               | ligamx                               |
| premier-league        | premier                              |
| primeira-liga         | liga-portugal, ligaportugal          |
| superliga-argentina   | argentina                            |

## Garantias
- `opta.db` é SAGRADO. Nenhum erro do dual-writer pode rolbackar/throwar no fluxo legacy.
- Falha em scout.db → `dbLog.error('[dual-writer] scout_write_failed_legacy_ok ...')`. Apollo segue intacto.
- Sem `SCOUT_DB`, dual-writer auto-desabilita.
- Sem `DUAL_WRITE_LEAGUES`, todas as ligas são bloqueadas (kill switch).

## Smoke test (não toca opta.db)
```pwsh
cd C:\Users\Rogerio\Desktop\RGMV_PROJETOS\SOLUCAO_IA\opta-extractor
$env:SCOUT_DB='C:\Users\Rogerio\Desktop\RGMV_PROJETOS\SCOUTCORE_QUANT\data\scout.db'
$env:DUAL_WRITE_LEAGUES='brasileirao'
node scripts/smoke-dual-writer.mjs
```
Resultado esperado: `[smoke] OK ✅` + cleanup. Repetir com `DUAL_WRITE_LEAGUES=''` para confirmar kill switch (nenhuma row escrita).

## Plano de roll-out
1. **Liga piloto: `brasileirao`.**
   - Setar `DUAL_WRITE_LEAGUES=brasileirao` no `.env` do FutMax.
   - Rodar o smoke test acima.
   - Disparar a extração de uma rodada via UI / scheduler normal.
  - Historicamente, a validação era feita com sync-check (passo abaixo).
2. **Demais ligas: validação manual via UI.** Adicionar uma liga por vez ao csv conforme o usuário confirmar pela interface visual que `partidas`/`eventos_faixa`/`odds` estão chegando ao scout.db.
3. Quando todas as ligas-alvo passarem 7 dias consecutivos sem drift, considerar o dual-write de regime estável e iniciar o replay-bootstrap do motor.

## Validação via sync-check (histórico)
O script `apps/jobs/src/sync-check.mjs` foi removido no cutover para banco único. Este passo não deve ser executado no runtime atual.

Critério histórico de sucesso por liga ativa: drift = 0 em `partidas`, `eventos_faixa`, `odds`, `odds_historico` (tolerância pequena no `MAX(criado_em)` por causa de timing de transação cross-db).

## Rollback
- `DUAL_WRITE_LEAGUES=` → desliga sem deploy.
- `SCOUT_DB` removido → desliga.
- Reverter `dual-writer.js` ou hooks: `git revert` no opta-extractor (repo separado).

## Tabelas explicitamente NÃO espelhadas
- `team_profiles` — motor reconstrói via job (independência total da rotina antiga).
- `ml_predictions`, `calibration_states`, `motor_runs`, `motor_boards` — wipados em scout.db; motor escreve do zero.
- `arbitros`, `partida_clima`, `escalacoes_provavel` — fase 2 (avaliar se features pedem).

## Observações
- `partidas.rodada` no scout.db pode aparecer como `'100.0'` por affinity SQLite quando o legacy gravou `100`. Comparações no motor devem usar `Number()`.
- `odds_historico` é populado SOMENTE quando há mudança ≥ 0.01 — esperado lag pequeno entre dbs.
