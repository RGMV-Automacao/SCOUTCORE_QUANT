ALTER TABLE times ADD COLUMN id_liga TEXT;
ALTER TABLE times ADD COLUMN confronto TEXT;
ALTER TABLE times ADD COLUMN rodada TEXT;
ALTER TABLE times ADD COLUMN status TEXT;
ALTER TABLE times ADD COLUMN assistencias INTEGER;
ALTER TABLE times ADD COLUMN chutes_bloqueados INTEGER;
ALTER TABLE times ADD COLUMN passes INTEGER;
ALTER TABLE times ADD COLUMN cruzamentos INTEGER;
ALTER TABLE times ADD COLUMN desarmes INTEGER;
ALTER TABLE times ADD COLUMN faltas_cometidas INTEGER;
ALTER TABLE times ADD COLUMN faltas_sofridas INTEGER;
ALTER TABLE times ADD COLUMN escanteios_sofridos INTEGER;
ALTER TABLE times ADD COLUMN chutes_sofridos INTEGER;
ALTER TABLE times ADD COLUMN chutes_noalvo_sofridos INTEGER;
ALTER TABLE times ADD COLUMN posse REAL;
ALTER TABLE times ADD COLUMN passes_certos INTEGER;
ALTER TABLE times ADD COLUMN desarmes_certos INTEGER;
ALTER TABLE times ADD COLUMN clean_sheet INTEGER;

ALTER TABLE confronto ADD COLUMN id_liga TEXT;
ALTER TABLE confronto ADD COLUMN confronto TEXT;
ALTER TABLE confronto ADD COLUMN rodada TEXT;
ALTER TABLE confronto ADD COLUMN status TEXT;
ALTER TABLE confronto ADD COLUMN gols INTEGER;
ALTER TABLE confronto ADD COLUMN assistencias INTEGER;
ALTER TABLE confronto ADD COLUMN cartoes_vermelhos INTEGER;
ALTER TABLE confronto ADD COLUMN cartoes_amarelos INTEGER;
ALTER TABLE confronto ADD COLUMN escanteios INTEGER;
ALTER TABLE confronto ADD COLUMN chutes INTEGER;
ALTER TABLE confronto ADD COLUMN chutes_no_alvo INTEGER;
ALTER TABLE confronto ADD COLUMN chutes_bloqueados INTEGER;
ALTER TABLE confronto ADD COLUMN passes INTEGER;
ALTER TABLE confronto ADD COLUMN cruzamentos INTEGER;
ALTER TABLE confronto ADD COLUMN desarmes INTEGER;
ALTER TABLE confronto ADD COLUMN impedimentos INTEGER;
ALTER TABLE confronto ADD COLUMN faltas_cometidas INTEGER;
ALTER TABLE confronto ADD COLUMN faltas_sofridas INTEGER;
ALTER TABLE confronto ADD COLUMN defesas INTEGER;

UPDATE times
   SET id_liga = COALESCE(id_liga, (SELECT p.id_liga FROM partidas p WHERE p.id_confronto = times.id_confronto)),
       confronto = COALESCE(confronto, (SELECT p.confronto FROM partidas p WHERE p.id_confronto = times.id_confronto)),
       rodada = COALESCE(rodada, (SELECT p.rodada FROM partidas p WHERE p.id_confronto = times.id_confronto)),
       status = COALESCE(status, (SELECT p.status FROM partidas p WHERE p.id_confronto = times.id_confronto)),
       faltas_cometidas = COALESCE(faltas_cometidas, faltas);

UPDATE confronto
   SET id_liga = COALESCE(id_liga, (SELECT p.id_liga FROM partidas p WHERE p.id_confronto = confronto.id_confronto)),
       confronto = COALESCE(confronto, (SELECT p.confronto FROM partidas p WHERE p.id_confronto = confronto.id_confronto)),
       rodada = COALESCE(rodada, (SELECT p.rodada FROM partidas p WHERE p.id_confronto = confronto.id_confronto)),
       status = COALESCE(status, (SELECT p.status FROM partidas p WHERE p.id_confronto = confronto.id_confronto)),
       gols = COALESCE(gols, total_gols),
       cartoes_vermelhos = COALESCE(cartoes_vermelhos, total_cartoes_vermelhos),
       cartoes_amarelos = COALESCE(cartoes_amarelos, total_cartoes_amarelos),
       escanteios = COALESCE(escanteios, total_escanteios),
       chutes = COALESCE(chutes, total_chutes),
       chutes_no_alvo = COALESCE(chutes_no_alvo, total_chutes_no_alvo),
       impedimentos = COALESCE(impedimentos, total_impedimentos),
       faltas_cometidas = COALESCE(faltas_cometidas, total_faltas),
       faltas_sofridas = COALESCE(faltas_sofridas, total_faltas);