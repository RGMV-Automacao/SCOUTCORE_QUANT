// Superbet odds lookup — mapeamento HONESTO baseado em nomenclatura real
// observada no DB (fonte='superbet'). Não inventa correspondência: quando
// market_key não tem regra, retorna `unmapped_in_motor_catalog`.
//
// Nomenclatura real Superbet (verificada em jogos BR):
//   1x2 FT       : mercado='Resultado Final',                selecao IN {'1','X','2'}
//   BTTS FT      : mercado='Ambas as Equipes Marcam',        selecao IN {'Sim','Não'}
//   BTTS HT      : mercado LIKE '%Tempo - Ambas as Equipes Marcam', idem
//   Gols Total FT: mercado='Total de Gols',                  selecao='Mais|Menos de X.X', linha='X.X'
//   Gols Total HT: mercado='1º Tempo - Total de Gols',       idem
//   Escanteios   : mercado='Total de Escanteios' (FT) / '1º Tempo - Total de Escanteios' (HT)
//                  Por equipe: '{Time} - Total de Escanteios' (FT) / '1º Tempo - Total de Escanteios de {Time}' (HT)
//   Cartões      : mesmo padrão (Total de Cartões)
//   Chutes Gol   : mesmo padrão (Total de Chutes no Gol). HT por equipe varia muito.
//
// ATENÇÃO: caractere ordinal varia ('º' ordinal e '°' grau aparecem indistintamente
// em mercados HT). Usamos LIKE '%Tempo%' para ser robusto.

function parseLine(token) {
  const m = token.match(/^(\d+)_(\d+)$/);
  if (m) return `${m[1]}.${m[2]}`;
  if (/^\d+$/.test(token)) return token;
  return null;
}

function selecaoOverUnder(dir, linha) {
  return dir === 'over' ? `Mais de ${linha}` : `Menos de ${linha}`;
}

export function buildLookupPlan(market_key, home, away) {
  const k = String(market_key).toLowerCase();
  const plans = [];

  let m = k.match(/^1x2(?:_ft)?_(home|draw|away)$/);
  if (m) {
    const sel = m[1] === 'home' ? '1' : m[1] === 'draw' ? 'X' : '2';
    plans.push({ mercadoEqOrLike: { eq: 'Resultado Final' }, selecao: sel });
    return plans;
  }

  m = k.match(/^btts(?:_(ft|ht))?_(sim|nao)$/);
  if (m) {
    const period = m[1] || 'ft';
    const sel = m[2] === 'sim' ? 'Sim' : 'Não';
    if (period === 'ft') {
      plans.push({ mercadoEqOrLike: { eq: 'Ambas as Equipes Marcam' }, selecao: sel });
    } else {
      plans.push({ mercadoEqOrLike: { like: '%Tempo - Ambas as Equipes Marcam' }, selecao: sel });
    }
    return plans;
  }

  m = k.match(/^gols_total_(ft|ht)_(over|under)_(\d+_\d+|\d+)$/);
  if (m) {
    const period = m[1], dir = m[2], lineRaw = m[3];
    const linha = parseLine(lineRaw);
    if (!linha) return [];
    const sel = selecaoOverUnder(dir, linha);
    if (period === 'ft') {
      plans.push({ mercadoEqOrLike: { eq: 'Total de Gols' }, selecao: sel, linha });
    } else {
      plans.push({ mercadoEqOrLike: { like: '%Tempo - Total de Gols' }, selecao: sel, linha });
    }
    return plans;
  }

  m = k.match(/^(escanteios|cartoes|chutes(?:_no_gol)?)_(total|home|away)_(ft|ht)_(over|under)_(\d+_\d+|\d+)$/);
  if (m) {
    const famRaw = m[1], scope = m[2], period = m[3], dir = m[4], lineRaw = m[5];
    const linha = parseLine(lineRaw);
    if (!linha) return [];
    const sel = selecaoOverUnder(dir, linha);
    const famLabel = famRaw === 'escanteios' ? 'Escanteios'
                  : famRaw === 'cartoes'    ? 'Cartões'
                  : famRaw === 'chutes'     ? 'Chutes'
                  : 'Chutes no Gol';
    const teamName = scope === 'home' ? home : scope === 'away' ? away : null;

    if (scope === 'total') {
      if (period === 'ft') {
        plans.push({ mercadoEqOrLike: { eq: `Total de ${famLabel}` }, selecao: sel, linha });
      } else {
        plans.push({ mercadoEqOrLike: { like: `%Tempo - Total de ${famLabel}` }, selecao: sel, linha });
      }
    } else if (teamName) {
      if (period === 'ft') {
        plans.push({ mercadoEqOrLike: { eq: `${teamName} - Total de ${famLabel}` }, selecao: sel, linha });
      } else {
        plans.push({ mercadoEqOrLike: { like: `%Tempo - Total de ${famLabel} de ${teamName}` }, selecao: sel, linha });
        if (famRaw.startsWith('chutes')) {
          plans.push({ mercadoEqOrLike: { like: `%Tempo - ${teamName} ${famLabel}` }, selecao: sel, linha });
          plans.push({ mercadoEqOrLike: { like: `%Tempo - ${famLabel.toLowerCase()} de ${teamName}` }, selecao: sel, linha });
        }
      }
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
