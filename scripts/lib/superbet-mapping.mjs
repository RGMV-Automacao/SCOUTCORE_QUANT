// Superbet odds lookup — mapeamento HONESTO baseado em nomenclatura real
// observada no DB (fonte='superbet'). Não inventa correspondência: quando
// market_key não tem regra, retorna `unmapped_in_motor_catalog`.
//
// Nomenclatura real Superbet (verificada via SELECT mercado, selecao, linha):
//   1x2 FT       : mercado='Resultado Final'                selecao IN {'1','X','2'}
//   1x2 HT/2T    : '1º Tempo - Resultado (1X2)' / '2º Tempo - Resultado (1X2)' selecao IN {'1','X','2'}
//   Dupla        : 'Dupla Chance' selecao IN {'1 ou Empate','1 ou 2','Empate ou 2'}
//                  '1º Tempo - Dupla Chance' / '2º Tempo - Dupla Chance' selecao IN {'1X','12','X2'}
//   DNB          : 'Empate Anula Aposta' selecao='{team_name}'  (1º Tempo, 2º Tempo análogos)
//   HT/FT        : 'Intervalo/Resultado Final' selecao IN {'1/1','1/X','1/2','X/1','X/X','X/2','2/1','2/X','2/2'}
//   Resultado Exato: 'Resultado Correto' selecao='{h}:{a}' OR 'Outros resultados'
//                    '1º Tempo - Resultado Correto' selecao='{h}:{a}' OR 'Outros'
//   Margem       : 'Resultado Final & Intervalo de Gols' (compostos) — não cobrimos
//   Marca primeiro: 'Próximo Gol (1º Gol)' selecao='{team_name}' (none não aparece)
//   Marca último : 'Último Gol' selecao='{team_name}'
//   Marca (sim/nao): 'Time {Casa/Fora} Marcar' (não há mercado direto consolidado — skip)
//   Handicap (.5): 'Handicap' selecao='{Team} ({±N.5})'
//   Handicap (.25/.75): 'Handicap Asiático' selecao='{Team} ({±N.25})'
//   Handicap 3-way: 'Handicap 3-way' selecao='{Team} (0:N)' significa home com -N
//   Total Gols Asiático: 'Total de Gols Asiático' selecao='Mais|Menos de X.XX' linha=X.XX (vazia em inteiros)
//   Gols Total FT: 'Total de Gols' selecao='Mais|Menos de X.X' linha='X.X'
//   Gols Total HT: '1º Tempo - Total de Gols'
//   Gols Total 2T: '2º Tempo - Total de Gols'
//   Gols por Equipe: 'Total de Gols da Equipe' selecao='MAIS|MENOS {Team}' linha='X.X'
//   Escanteios   : 'Total de Escanteios' (FT) / '1º Tempo - Total de Escanteios' (HT)
//   Escanteios 1x2: 'Equipe Com Mais Escanteios (1X2)' selecao='{team}' ou 'Empate'
//   Escanteios race: 'Corrida até X Escanteios' selecao='{N} - {team}' ou '{N} - Nenhuma das equipes -'
//   Escanteios exato: 'Número Exato' não tem; usar 'Faixa de Escanteios' (range) — não cobrimos eq_X individual
//   Cartões      : 'Total de Cartões' / '1º Tempo - Total de Cartões'
//   Cartões 1x2  : 'Equipe com Mais Cartões (1X2)' selecao='{team}'/'Empate'/'1'/'X'/'2'
//   Chutes_alvo  : 'Total de Chutes no Gol' (FT) / '1º Tempo - Total de Chutes no Gol' (HT)
//   Chutes (todos): 'Total de Finalizações' / '1º Tempo - Total de Finalizações'
//   Defesas      : 'Total de Defesas do Goleiro' / '1º Tempo - Total de Defesas do Goleiro'
//   Impedimentos : 'Total de Impedimentos'
//   Faltas       : 'Total de Faltas'
//   BTTS Ambos   : 'Ambas as Equipes Marcam nos Dois Tempos' (selecao composto, não cobrimos sim/nao puro)
//   BTTS Algum   : 'Ambas as Equipes Marcam em Algum dos Tempos' selecao IN {'Sim','Não'}

function parseLine(token) {
  const m = token.match(/^(\d+)_(\d+)$/);
  if (m) return `${m[1]}.${m[2]}`;
  if (/^\d+$/.test(token)) return token;
  return null;
}

function selecaoOverUnder(dir, linha) {
  return dir === 'over' ? `Mais de ${linha}` : `Menos de ${linha}`;
}

// Sinal/n para chaves do tipo 'minus_1', 'plus_2_5', '1', '0_5'
function parseHandicapSuffix(rest) {
  // rest pode ser: 'minus_0_5', 'plus_1_5', 'minus_1', '0_5'
  if (rest.startsWith('minus_')) {
    const num = parseLine(rest.slice(6));
    return num ? `-${num}` : null;
  }
  if (rest.startsWith('plus_')) {
    const num = parseLine(rest.slice(5));
    return num ? `+${num}` : null;
  }
  // Caso direto sem prefixo (ex: '1', '2_5')
  const num = parseLine(rest);
  return num ? `+${num}` : null;
}

export function buildLookupPlan(market_key, home, away) {
  const k = String(market_key).toLowerCase();
  const plans = [];

  // ─────────────────────── 1X2 ───────────────────────
  let m = k.match(/^1x2_total_(ft|ht|2t)_(home|draw|away)$/);
  if (m) {
    const period = m[1], dir = m[2];
    const sel = dir === 'home' ? '1' : dir === 'draw' ? 'X' : '2';
    if (period === 'ft') {
      plans.push({ mercadoEqOrLike: { eq: 'Resultado Final' }, selecao: sel });
    } else if (period === 'ht') {
      plans.push({ mercadoEqOrLike: { like: '%Tempo - Resultado (1X2)' }, selecao: sel });
      plans.push({ mercadoEqOrLike: { like: '%Tempo - Resultado (1x2)' }, selecao: sel });
    } else {
      plans.push({ mercadoEqOrLike: { like: '%Tempo - Resultado (1X2)' }, selecao: sel });
      plans.push({ mercadoEqOrLike: { like: '%Tempo - Resultado (1x2)' }, selecao: sel });
    }
    return plans;
  }

  // ─────────────────────── Dupla chance ───────────────────────
  m = k.match(/^dupla_total_(ft|ht|2t)_(1x|12|x2)$/);
  if (m) {
    const period = m[1], dir = m[2];
    if (period === 'ft') {
      const map = { '1x': '1 ou Empate', '12': '1 ou 2', 'x2': 'Empate ou 2' };
      plans.push({ mercadoEqOrLike: { eq: 'Dupla Chance' }, selecao: map[dir] });
    } else {
      const sel = dir === '1x' ? '1X' : dir === '12' ? '12' : 'X2';
      plans.push({ mercadoEqOrLike: { like: '%Tempo - Dupla Chance' }, selecao: sel });
    }
    return plans;
  }

  // ─────────────────────── DNB (empate anula) ───────────────────────
  m = k.match(/^dnb_total_(ft|ht|2t)_(home|away)$/);
  if (m) {
    const period = m[1], dir = m[2];
    const team = dir === 'home' ? home : away;
    if (!team) return [];
    if (period === 'ft') {
      plans.push({ mercadoEqOrLike: { eq: 'Empate Anula Aposta' }, selecao: team });
    } else if (period === 'ht') {
      plans.push({ mercadoEqOrLike: { like: '%Tempo - Empate Anula Aposta' }, selecao: team });
    } else {
      plans.push({ mercadoEqOrLike: { like: '%Tempo - Empate sem Aposta' }, selecao: team });
      plans.push({ mercadoEqOrLike: { like: '%Tempo - Empate Anula Aposta' }, selecao: team });
    }
    return plans;
  }

  // ─────────────────────── HT/FT ───────────────────────
  m = k.match(/^htft_total_full_(1|x|2)_(1|x|2)$/);
  if (m) {
    const a = m[1] === 'x' ? 'X' : m[1];
    const b = m[2] === 'x' ? 'X' : m[2];
    plans.push({ mercadoEqOrLike: { eq: 'Intervalo/Resultado Final' }, selecao: `${a}/${b}` });
    return plans;
  }

  // ─────────────────────── Resultado Correto ───────────────────────
  m = k.match(/^correct_score_total_(ft|ht)_(\d+)_(\d+)$/);
  if (m) {
    const period = m[1], h = m[2], a = m[3];
    if (period === 'ft') {
      plans.push({ mercadoEqOrLike: { eq: 'Resultado Correto' }, selecao: `${h}:${a}` });
    } else {
      plans.push({ mercadoEqOrLike: { like: '%Tempo - Resultado Correto' }, selecao: `${h}:${a}` });
    }
    return plans;
  }
  m = k.match(/^correct_score_total_(ft|ht)_other(?:_(home|draw|away))?$/);
  if (m) {
    const period = m[1];
    if (period === 'ft') {
      // Superbet só oferece "Outros resultados" agregando os 3. Sem desambiguação:
      // mapeamos somente quando direction='other_home|draw|away' não — fica unmapped honestamente.
      // Marcamos como mapeado mas inválido: oferta agregada não isola direction.
      return [];
    } else {
      plans.push({ mercadoEqOrLike: { like: '%Tempo - Resultado Correto' }, selecao: 'Outros' });
    }
    return plans;
  }

  // ─────────────────────── Margem (composto Superbet) ───────────────────────
  if (/^margem_total_ft_/.test(k)) {
    // Superbet vende como 'Resultado Final & Intervalo de Gols' (composto, não puro). Skip.
    return [];
  }

  // ─────────────────────── Marca primeiro/último ───────────────────────
  m = k.match(/^marca_primeiro_total_ft_(home|away|none)$/);
  if (m) {
    if (m[1] === 'none') return []; // raro na Superbet
    const team = m[1] === 'home' ? home : away;
    plans.push({ mercadoEqOrLike: { eq: 'Próximo Gol (1º Gol)' }, selecao: team });
    return plans;
  }
  m = k.match(/^marca_ultimo_total_ft_(home|away|none)$/);
  if (m) {
    if (m[1] === 'none') return [];
    const team = m[1] === 'home' ? home : away;
    plans.push({ mercadoEqOrLike: { eq: 'Último Gol' }, selecao: team });
    return plans;
  }

  // ─────────────────────── Marca sim/nao por equipe ───────────────────────
  if (/^marca_total_ft_(home|away)_(sim|nao)$/.test(k)) {
    // Superbet não tem mercado isolado consolidado (vem em compostos). Skip.
    return [];
  }

  // ─────────────────────── Handicap europeu (3-way) ───────────────────────
  m = k.match(/^handicap_total_(ft|ht)_(home|draw|away)_(.+)$/);
  if (m) {
    const period = m[1], dirCat = m[2], rest = m[3];
    const sign = parseHandicapSuffix(rest);
    if (!sign) return [];
    // Handicap 3-way Superbet: selecao 'Bournemouth (0:1)' = home perde de 1 gol (home -1)
    // 'Bournemouth (1:0)' = home começa ganhando 1 gol (home +1)
    // Empate aparece como 'Empate (0:N)' / 'Empate (N:0)'
    const num = sign.replace(/^[+\-]/, '').replace(/\.\d+$/, m => m); // "1" ou "2"
    // Apenas inteiros são oferecidos no 3-way; meios vão pro 'Handicap'
    const isInteger = !sign.includes('.');
    if (!isInteger) return [];
    const baseTeam = dirCat === 'home' ? home : dirCat === 'away' ? away : 'Empate';
    if (!baseTeam) return [];
    // Convenção Superbet: par "(home_advantage : away_advantage)" no contexto da equipe selecionada.
    // home com handicap -N: na linha do home, mostra "(0:N)"; na linha do away, mostra "(N:0)".
    let parens;
    if (sign.startsWith('-')) parens = `(0:${num})`;
    else parens = `(${num}:0)`;
    plans.push({
      mercadoEqOrLike: period === 'ft' ? { eq: 'Handicap 3-way' } : { like: '%Tempo - Handicap 3-way' },
      selecao: `${baseTeam} ${parens}`,
    });
    return plans;
  }

  // ─────────────────────── Handicap asiático (.5 europeu / .25/.75 quarter) ───────────────────────
  m = k.match(/^asian_handicap_total_(ft|ht)_(home|away)_(.+)$/);
  if (m) {
    const period = m[1], dirCat = m[2], rest = m[3];
    const sign = parseHandicapSuffix(rest);
    if (!sign) return [];
    const team = dirCat === 'home' ? home : away;
    if (!team) return [];
    const frac = sign.match(/\.(\d+)$/);
    const isHalf = frac && frac[1] === '5';
    const isQuarter = frac && (frac[1] === '25' || frac[1] === '75');
    const mercados = period === 'ft'
      ? (isHalf ? [{ eq: 'Handicap' }] : isQuarter ? [{ eq: 'Handicap Asiático' }] : [{ eq: 'Handicap Asiático' }])
      : (isHalf ? [{ like: '%Tempo - Handicap' }] : [{ like: '%Tempo - Handicap Asiático' }]);
    for (const me of mercados) {
      plans.push({ mercadoEqOrLike: me, selecao: `${team} (${sign})` });
    }
    return plans;
  }

  // ─────────────────────── Asian total ───────────────────────
  m = k.match(/^asian_total_total_(ft|ht)_(over|under)_(\d+_\d+|\d+)$/);
  if (m) {
    const period = m[1], dir = m[2], lineRaw = m[3];
    const linha = parseLine(lineRaw);
    if (!linha) return [];
    const sel = selecaoOverUnder(dir, linha);
    if (period === 'ft') {
      plans.push({ mercadoEqOrLike: { eq: 'Total de Gols Asiático' }, selecao: sel });
    } else {
      plans.push({ mercadoEqOrLike: { like: '%Tempo - Total de Gols Asiático' }, selecao: sel });
    }
    return plans;
  }

  // ─────────────────────── BTTS sim/nao FT/HT (preserva regra antiga) ───────────────────────
  m = k.match(/^btts_total_(ft|ht)_(sim|nao)$/);
  if (m) {
    const period = m[1];
    const sel = m[2] === 'sim' ? 'Sim' : 'Não';
    if (period === 'ft') {
      plans.push({ mercadoEqOrLike: { eq: 'Ambas as Equipes Marcam' }, selecao: sel });
    } else {
      plans.push({ mercadoEqOrLike: { like: '%Tempo - Ambas as Equipes Marcam' }, selecao: sel });
    }
    return plans;
  }

  // BTTS algum tempo
  m = k.match(/^btts_algum_tempo_(sim|nao)$/);
  if (m) {
    const sel = m[1] === 'sim' ? 'Sim' : 'Não';
    plans.push({ mercadoEqOrLike: { eq: 'Ambas as Equipes Marcam em Algum dos Tempos' }, selecao: sel });
    return plans;
  }
  // BTTS ambos os tempos — Superbet vende com selecoes compostas que não isolam sim/nao puro
  if (/^btts_ambos_tempos_(sim|nao)$/.test(k)) {
    if (k.endsWith('_sim')) {
      plans.push({ mercadoEqOrLike: { eq: 'Ambas as Equipes Marcam nos Dois Tempos' }, selecao: 'Sim' });
      return plans;
    }
    return []; // 'nao' não isolado
  }

  // ─────────────────────── Gols total FT/HT/2T over/under ───────────────────────
  m = k.match(/^gols_total_(ft|ht|2t)_(over|under)_(\d+_\d+|\d+)$/);
  if (m) {
    const period = m[1], dir = m[2], lineRaw = m[3];
    const linha = parseLine(lineRaw);
    if (!linha) return [];
    const sel = selecaoOverUnder(dir, linha);
    if (period === 'ft') {
      plans.push({ mercadoEqOrLike: { eq: 'Total de Gols' }, selecao: sel, linha });
    } else if (period === 'ht') {
      plans.push({ mercadoEqOrLike: { like: '%Tempo - Total de Gols' }, selecao: sel, linha });
    } else {
      plans.push({ mercadoEqOrLike: { like: '%Tempo - Total de Gols' }, selecao: sel, linha });
    }
    return plans;
  }

  // Gols por equipe FT (Superbet usa 'Total de Gols da Equipe')
  m = k.match(/^gols_(home|away)_ft_(over|under)_(\d+_\d+|\d+)$/);
  if (m) {
    const scope = m[1], dir = m[2], lineRaw = m[3];
    const linha = parseLine(lineRaw);
    if (!linha) return [];
    const team = scope === 'home' ? home : away;
    if (!team) return [];
    const prefix = dir === 'over' ? 'MAIS' : 'MENOS';
    plans.push({ mercadoEqOrLike: { eq: 'Total de Gols da Equipe' }, selecao: `${prefix} ${team}`, linha });
    return plans;
  }

  // ─────────────────────── Escanteios over/under ───────────────────────
  m = k.match(/^escanteios_(total|home|away)_(ft|ht)_(over|under)_(\d+_\d+|\d+)$/);
  if (m) {
    const scope = m[1], period = m[2], dir = m[3], lineRaw = m[4];
    const linha = parseLine(lineRaw);
    if (!linha) return [];
    const sel = selecaoOverUnder(dir, linha);
    const team = scope === 'home' ? home : scope === 'away' ? away : null;
    if (scope === 'total') {
      if (period === 'ft') plans.push({ mercadoEqOrLike: { eq: 'Total de Escanteios' }, selecao: sel, linha });
      else plans.push({ mercadoEqOrLike: { like: '%Tempo - Total de Escanteios' }, selecao: sel, linha });
    } else if (team) {
      if (period === 'ft') {
        plans.push({ mercadoEqOrLike: { eq: `${team} - Total de Escanteios` }, selecao: sel, linha });
      } else {
        plans.push({ mercadoEqOrLike: { like: `%Tempo - Total de Escanteios de ${team}` }, selecao: sel, linha });
      }
    }
    return plans;
  }

  // Escanteios 1x2
  m = k.match(/^escanteios_1x2_total_(ft|ht)_(home|draw|away)$/);
  if (m) {
    const period = m[1], dir = m[2];
    const team = dir === 'home' ? home : dir === 'away' ? away : 'Empate';
    if (!team) return [];
    if (period === 'ft') {
      plans.push({ mercadoEqOrLike: { eq: 'Equipe Com Mais Escanteios (1X2)' }, selecao: team });
    } else {
      plans.push({ mercadoEqOrLike: { like: '%Tempo - Time com Mais Escanteios' }, selecao: team });
      plans.push({ mercadoEqOrLike: { like: '%Tempo - Equipe Com Mais Escanteios (1X2)' }, selecao: team });
    }
    return plans;
  }

  // Escanteios race (Corrida até X)
  m = k.match(/^escanteios_race_total_ft_(home|away|none)_(\d+)$/);
  if (m) {
    const dir = m[1], n = m[2];
    const team = dir === 'home' ? home : dir === 'away' ? away : null;
    const sel = team ? `${n} - ${team}` : `${n} - Nenhuma das equipes -`;
    plans.push({ mercadoEqOrLike: { eq: 'Corrida até X Escanteios' }, selecao: sel });
    return plans;
  }

  // Escanteios exato — Superbet não tem mercado direto por número exato; só faixas
  if (/^escanteios_exato_total_ft_/.test(k)) return [];

  // ─────────────────────── Cartões over/under ───────────────────────
  m = k.match(/^cartoes_(total|home|away)_(ft|ht)_(over|under)_(\d+_\d+|\d+)$/);
  if (m) {
    const scope = m[1], period = m[2], dir = m[3], lineRaw = m[4];
    const linha = parseLine(lineRaw);
    if (!linha) return [];
    const sel = selecaoOverUnder(dir, linha);
    const team = scope === 'home' ? home : scope === 'away' ? away : null;
    if (scope === 'total') {
      if (period === 'ft') plans.push({ mercadoEqOrLike: { eq: 'Total de Cartões' }, selecao: sel, linha });
      else plans.push({ mercadoEqOrLike: { like: '%Tempo - Total de Cartões' }, selecao: sel, linha });
    } else if (team) {
      if (period === 'ft') {
        plans.push({ mercadoEqOrLike: { eq: `${team} - Total de Cartões` }, selecao: sel, linha });
      } else {
        plans.push({ mercadoEqOrLike: { like: `%Tempo - Total de Cartões de ${team}` }, selecao: sel, linha });
      }
    }
    return plans;
  }

  // Cartões 1x2
  m = k.match(/^cartoes_1x2_total_ft_(home|draw|away)$/);
  if (m) {
    const dir = m[1];
    const team = dir === 'home' ? home : dir === 'away' ? away : 'Empate';
    if (!team) return [];
    plans.push({ mercadoEqOrLike: { eq: 'Equipe com Mais Cartões (1X2)' }, selecao: team });
    plans.push({ mercadoEqOrLike: { eq: 'Equipe Com Mais Cartões (1X2)' }, selecao: team });
    return plans;
  }

  // ─────────────────────── Chutes (Total de Finalizações) ───────────────────────
  m = k.match(/^chutes_(total|home|away)_(ft|ht)_(over|under)_(\d+_\d+|\d+)$/);
  if (m) {
    const scope = m[1], period = m[2], dir = m[3], lineRaw = m[4];
    const linha = parseLine(lineRaw);
    if (!linha) return [];
    const sel = selecaoOverUnder(dir, linha);
    const team = scope === 'home' ? home : scope === 'away' ? away : null;
    if (scope === 'total') {
      if (period === 'ft') plans.push({ mercadoEqOrLike: { eq: 'Total de Finalizações' }, selecao: sel, linha });
      else plans.push({ mercadoEqOrLike: { like: '%Tempo - Total de Finalizações' }, selecao: sel, linha });
    } else if (team) {
      if (period === 'ft') {
        plans.push({ mercadoEqOrLike: { eq: `${team} - Total de Finalizações` }, selecao: sel, linha });
      } else {
        plans.push({ mercadoEqOrLike: { like: `%Tempo - Finalizações de ${team}` }, selecao: sel, linha });
      }
    }
    return plans;
  }

  // ─────────────────────── Chutes no gol (alvo) ───────────────────────
  m = k.match(/^chutes_alvo_(total|home|away)_(ft|ht)_(over|under)_(\d+_\d+|\d+)$/);
  if (m) {
    const scope = m[1], period = m[2], dir = m[3], lineRaw = m[4];
    const linha = parseLine(lineRaw);
    if (!linha) return [];
    const sel = selecaoOverUnder(dir, linha);
    const team = scope === 'home' ? home : scope === 'away' ? away : null;
    if (scope === 'total') {
      if (period === 'ft') plans.push({ mercadoEqOrLike: { eq: 'Total de Chutes no Gol' }, selecao: sel, linha });
      else plans.push({ mercadoEqOrLike: { like: '%Tempo - Total de Chutes no Gol' }, selecao: sel, linha });
    } else if (team) {
      if (period === 'ft') {
        plans.push({ mercadoEqOrLike: { eq: `${team} - Total de Chutes no Gol` }, selecao: sel, linha });
      } else {
        plans.push({ mercadoEqOrLike: { like: `%Tempo - Chutes no Gol de ${team}` }, selecao: sel, linha });
      }
    }
    return plans;
  }

  // ─────────────────────── Defesas do goleiro ───────────────────────
  // FT total: 'Total de Defesas do Goleiro'
  // HT total: '1º Tempo - Total de Defesas do Goleiro'
  // FT por equipe: 'Total de Defesas do Goleiro {Team}' (sem hífen, time no final)
  // HT por equipe: '1º Tempo - Total de Defesas do Goleiro {Team}'
  m = k.match(/^defesas_(total|home|away)_(ft|ht)_(over|under)_(\d+_\d+|\d+)$/);
  if (m) {
    const scope = m[1], period = m[2], dir = m[3], lineRaw = m[4];
    const linha = parseLine(lineRaw);
    if (!linha) return [];
    const sel = selecaoOverUnder(dir, linha);
    const team = scope === 'home' ? home : scope === 'away' ? away : null;
    if (scope === 'total') {
      if (period === 'ft') plans.push({ mercadoEqOrLike: { eq: 'Total de Defesas do Goleiro' }, selecao: sel, linha });
      else plans.push({ mercadoEqOrLike: { like: '%Tempo - Total de Defesas do Goleiro' }, selecao: sel, linha });
    } else if (team) {
      if (period === 'ft') {
        plans.push({ mercadoEqOrLike: { eq: `Total de Defesas do Goleiro ${team}` }, selecao: sel, linha });
      } else {
        plans.push({ mercadoEqOrLike: { like: `%Tempo - Total de Defesas do Goleiro ${team}` }, selecao: sel, linha });
      }
    }
    return plans;
  }

  // ─────────────────────── Impedimentos ───────────────────────
  // FT total: 'Total de Impedimentos'
  // HT total: '1º Tempo - Total de Impedimentos'
  // FT por equipe: '{Team} - Total de Impedimentos'
  // HT por equipe: '1º Tempo - {Team} Impedimentos' (sem 'Total de', sem hífen)
  m = k.match(/^impedimentos_(total|home|away)_(ft|ht)_(over|under)_(\d+_\d+|\d+)$/);
  if (m) {
    const scope = m[1], period = m[2], dir = m[3], lineRaw = m[4];
    const linha = parseLine(lineRaw);
    if (!linha) return [];
    const sel = selecaoOverUnder(dir, linha);
    const team = scope === 'home' ? home : scope === 'away' ? away : null;
    if (scope === 'total') {
      if (period === 'ft') plans.push({ mercadoEqOrLike: { eq: 'Total de Impedimentos' }, selecao: sel, linha });
      else plans.push({ mercadoEqOrLike: { like: '%Tempo - Total de Impedimentos' }, selecao: sel, linha });
    } else if (team) {
      if (period === 'ft') {
        plans.push({ mercadoEqOrLike: { eq: `${team} - Total de Impedimentos` }, selecao: sel, linha });
      } else {
        plans.push({ mercadoEqOrLike: { like: `%Tempo - ${team} Impedimentos` }, selecao: sel, linha });
      }
    }
    return plans;
  }

  // ─────────────────────── Faltas ───────────────────────
  m = k.match(/^faltas_(total|home|away)_ft_(over|under)_(\d+_\d+|\d+)$/);
  if (m) {
    const scope = m[1], dir = m[2], lineRaw = m[3];
    const linha = parseLine(lineRaw);
    if (!linha) return [];
    const sel = selecaoOverUnder(dir, linha);
    const team = scope === 'home' ? home : scope === 'away' ? away : null;
    if (scope === 'total') {
      plans.push({ mercadoEqOrLike: { eq: 'Total de Faltas' }, selecao: sel, linha });
    } else if (team) {
      plans.push({ mercadoEqOrLike: { eq: `${team} - Total de Faltas` }, selecao: sel, linha });
    }
    return plans;
  }

  return null;
}

export function lookupSuperbetOdd(db, { market_key, home, away, data }) {
  const plans = buildLookupPlan(market_key, home, away);
  if (plans === null) return { found: false, reason: 'unmapped_in_motor_catalog' };
  if (plans.length === 0) return { found: false, reason: 'mapped_but_invalid_line' };

  for (const p of plans) {
    const where = [`fonte='superbet'`, `home_team=?`, `away_team=?`, `data_jogo=?`];
    const params = [home, away, data];
    if (p.mercadoEqOrLike.eq != null) {
      where.push(`mercado = ?`);
      params.push(p.mercadoEqOrLike.eq);
    } else if (p.mercadoEqOrLike.like != null) {
      where.push(`mercado LIKE ?`);
      params.push(p.mercadoEqOrLike.like);
    }
    if (p.selecao != null) {
      where.push(`selecao = ?`);
      params.push(p.selecao);
    }
    if (p.linha != null) {
      where.push(`linha = ?`);
      params.push(p.linha);
    }
    const sql = `SELECT odd, mercado, selecao, linha FROM odds WHERE ${where.join(' AND ')} ORDER BY criado_em DESC LIMIT 1`;
    const r = db.prepare(sql).get(...params);
    if (r) {
      return {
        found: true,
        odd: r.odd,
        mercado_superbet: r.mercado,
        selecao_superbet: r.selecao,
        linha_superbet: r.linha,
      };
    }
  }
  return { found: false, reason: 'mapped_but_not_offered_by_superbet' };
}

export function mapMarketKey(market_key) {
  const p = buildLookupPlan(market_key, '__home__', '__away__');
  return p === null ? null : { candidates: p };
}
