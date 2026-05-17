---
description: "Audita profundamente o ScoutCore: regras, mercados, funcionalidades, auditorias, riscos, defeitos, gaps e prontidao para jogos reais, sem inventar."
name: "Revisao Profunda ScoutCore"
argument-hint: "Opcional: foco extra, recorte, modulo prioritario ou caminho de saida"
agent: "agent"
---

Faca uma revisao profunda e cetica do SCOUTCORE_QUANT usando somente evidencias reais do workspace.

Objetivo:
- Validar regras de negocio, catalogo e uso de mercados, funcionalidades implementadas, qualidade das auditorias, riscos operacionais, defeitos e gaps.
- Determinar o que ja esta pronto, o que esta parcial e o que ainda falta para rodar com jogos reais.
- Verificar se as saidas de auditoria ja sustentam um fluxo auditavel e se podem ser consolidadas em um unico artefato confiavel sem inventar campos.

Fontes de verdade prioritarias:
- [README](../../README.md)
- [SPEC formal](../../docs/spec/SCOUTCORE_SPEC.md)
- [Quality gates](../../config/quality-gates.json)
- [audit/meta.json](../../audit/meta.json)
- [audit/predictions.csv](../../audit/predictions.csv)
- [audit/scout.csv](../../audit/scout.csv)
- [audit/signature.csv](../../audit/signature.csv)
- [audit/coverage_audit.csv](../../audit/coverage_audit.csv)
- [audit/ev_ranked.csv](../../audit/ev_ranked.csv)
- [audit/ev_capped_out.csv](../../audit/ev_capped_out.csv)

Escopo minimo que precisa ser checado:
- apps/api, apps/jobs, ml-sidecar, packages, migrations, scripts e audit.
- Contratos de predict, settle, markets, health e replay.
- Implementacao de mercados, calibragem, evidence pack, provenance, settlement, audit trail e readiness operacional.
- Consistencia entre SPEC, README, codigo real, testes e artefatos de auditoria.

Regras obrigatorias:
- Nao invente feature, cobertura, integracao, dado historico, coluna, validacao, risco mitigado ou prontidao.
- Para toda conclusao importante, aponte a evidencia concreta: arquivo e linha, teste, script, comando executavel ou artefato encontrado.
- Se algo nao puder ser comprovado, marque explicitamente como "nao evidenciado".
- Diferencie com rigor: implementado, parcialmente implementado, stub, planejado, ausente, nao validado.
- Nao trate nome promissor, comentario ou spec como implementacao.
- Se houver divergencia entre spec e codigo, descreva o delta e diga qual lado parece ser a verdade operacional hoje.
- Se existir teste, smoke, script de diagnostico ou verificacao barata para confirmar um fluxo, prefira executa-lo em vez de assumir.
- Se precisar propor unificacao de auditoria, descreva o schema alvo e os gaps, mas nao preencha valores inexistentes.

Checklist de revisao:
1. Regras e arquitetura
- Compare a SPEC com o codigo controlador real.
- Valide se os principios criticos aparecem na implementacao: point-in-time, zero-bloqueio, calibracao antes de Kelly, provenance, engine_signature, evidence auditavel e settlement economico.
2. Mercados
- Verifique catalogo, cobertura, aliases, families, lines, FT/HT/team/total e riscos de inconsistencias entre contratos e implementacao.
- Identifique mercados prometidos mas sem calculo, sem mapeamento, sem testes ou sem evidencia auditavel.
3. Funcionalidades e fluxo operacional
- Avalie predict, batch, settle, replay, health, jobs, migrations, sidecar ML e integracoes internas.
- Aponte gargalos para producao real: dependencias frageis, bootstrap manual, dados ausentes, scripts incompletos, falta de testes, ausencia de validacao de ponta a ponta, risco de leakage e risco de schema drift.
4. Auditorias
- Inspecione os arquivos de audit e diga se o conjunto atual e coerente, rastreavel e suficiente.
- Verifique chaves de juncao, granularidade, duplicidade, ausencia de campos criticos e capacidade de reconstruir: confronto, data e hora do jogo, mercado, linha, odds previstas, odds de mercado, odds reais ou closing quando existirem, predicao, resultado e assinatura do motor.
- Responda objetivamente se as saidas atuais estao ok para auditoria operacional.
5. Prontidao para jogos reais
- Liste o que esta pronto hoje.
- Liste o que bloqueia uso real agora.
- Liste o que ainda falta, por ordem de criticidade e dependencia.
- De uma nota final de prontidao de 0 a 10, com criterio explicito e conservador.

Formato de saida obrigatorio:
1. Diagnostico executivo
- Veredito em 5 a 10 linhas.
- Nota final de prontidao: X/10.
- Resposta curta para: "Da para rodar com jogos reais hoje?"
2. Tabela de readiness
- Colunas: area, status (pronto/parcial/faltando/nao evidenciado), evidencia principal, risco.
- Areas minimas: dados, catalogo de mercados, API, settlement, audit trail, ML sidecar, jobs, migrations, testes e operacao.
3. Principais findings
- Ordene por severidade: critico, alto, medio, baixo.
- Cada finding deve ter: problema, impacto, evidencia, consequencia pratica e correcao sugerida.
4. SPEC vs realidade
- Liste promessas da SPEC que estao confirmadas, parciais, ausentes ou contraditas.
5. Auditoria e arquivo unico
- Diga se o conjunto atual de saidas de audit ja equivale a um arquivo unico confiavel.
- Se nao equivaler, proponha o schema minimo do arquivo unico com os campos exatos e indique, para cada campo, de qual arquivo ele viria ou se esta faltando.
- Nao invente joins que o workspace nao sustenta.
6. Fechamento objetivo
- "Pronto hoje"
- "Falta para producao real"
- "Maior risco escondido"
- "Proxima validacao recomendada"

Se o usuario passar argumentos adicionais, trate-os como prioridade de foco sem perder o checklist minimo acima.