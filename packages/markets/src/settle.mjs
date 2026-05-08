// @scoutcore/markets/settle — função única que decide se um slot foi GREEN/RED/PUSH
// dado o resultado real. Sem ambiguidade: cada family×scope×period mapeia para
// um observable derivado de Result; cada direction+line vira inequação fixa.

import { parseMarketKey } from './registry.mjs';

/** Map (family, scope, period) → função que extrai o observable do Result. */
function extractObservable(slot, result) {
  const { family, scope, period } = slot;

  // helpers
  const homeFt = result.home_goals_ft;
  const awayFt = result.away_goals_ft;
  const homeHt = result.home_goals_ht;
  const awayHt = result.away_goals_ht;
  const totalFt = (homeFt != null && awayFt != null) ? homeFt + awayFt : null;
  const totalHt = (homeHt != null && awayHt != null) ? homeHt + awayHt : null;
  const total2T = (totalFt != null && totalHt != null) ? totalFt - totalHt : null;
  const home2T = (homeFt != null && homeHt != null) ? homeFt - homeHt : null;
  const away2T = (awayFt != null && awayHt != null) ? awayFt - awayHt : null;

  // GOLS
  if (family === 'gols') {
    if (period === 'FT') {
      if (scope === 'total') return totalFt;
      if (scope === 'home')  return homeFt;
      if (scope === 'away')  return awayFt;
    }
    if (period === 'HT') {
      if (scope === 'total') return totalHt;
      if (scope === 'home')  return homeHt;
      if (scope === 'away')  return awayHt;
    }
    if (period === '2T') {
      if (scope === 'total') return total2T;
      if (scope === 'home')  return home2T;
      if (scope === 'away')  return away2T;
    }
  }

  // BTTS — observable booleano (1/0) ↦ tratado abaixo no compare
  if (family === 'btts') {
    if (period === 'FT') return (homeFt > 0 && awayFt > 0) ? 1 : 0;
    if (period === 'HT') return (homeHt > 0 && awayHt > 0) ? 1 : 0;
  }

  // 1X2
  if (family === '1x2') {
    if (period === 'FT') return Math.sign(homeFt - awayFt);  // -1 away, 0 draw, +1 home
    if (period === 'HT') return Math.sign(homeHt - awayHt);
  }

  // ESCANTEIOS
  if (family === 'escanteios') {
    const hf = result.home_corners, af = result.away_corners;
    const hh = result.home_corners_ht, ah = result.away_corners_ht;
    const tf = (hf != null && af != null) ? hf + af : null;
    const th = (hh != null && ah != null) ? hh + ah : null;
    if (period === 'FT' && scope === 'total') return tf;
    if (period === 'FT' && scope === 'home')  return hf;
    if (period === 'FT' && scope === 'away')  return af;
    if (period === 'HT' && scope === 'total') return th;
    if (period === 'HT' && scope === 'home')  return hh;
    if (period === 'HT' && scope === 'away')  return ah;
  }

  // CHUTES (total = chutes; alvo é família separada se quiser; aqui só chutes)
  if (family === 'chutes') {
    const hs = result.home_shots, as_ = result.away_shots;
    if (period === 'FT' && scope === 'total') return (hs != null && as_ != null) ? hs + as_ : null;
    if (period === 'FT' && scope === 'home')  return hs;
    if (period === 'FT' && scope === 'away')  return as_;
  }

  // CARTOES (yc + 2*rc, regra padrão de mercado)
  if (family === 'cartoes') {
    const hyc = result.home_yc ?? 0, ayc = result.away_yc ?? 0;
    const hrc = result.home_rc ?? 0, arc = result.away_rc ?? 0;
    const homePts = hyc + 2 * hrc;
    const awayPts = ayc + 2 * arc;
    if (period === 'FT' && scope === 'total') return homePts + awayPts;
    if (period === 'FT' && scope === 'home')  return homePts;
    if (period === 'FT' && scope === 'away')  return awayPts;
  }

  // FALTAS
  if (family === 'faltas') {
    const hf = result.home_fouls, af = result.away_fouls;
    if (period === 'FT' && scope === 'total') return (hf != null && af != null) ? hf + af : null;
  }

  return null;
}

/**
 * settle(slot, result): { outcome: 'green'|'red'|'push'|'void', observable }
 * - void: dados insuficientes no Result.
 * - push: linhas exatas (raras se line termina em .5; ainda assim cobrimos).
 */
export function settle(slot, result) {
  const m = typeof slot === 'string' ? parseMarketKey(slot) : slot;
  if (!m) return { outcome: 'void', reason: 'unknown_market' };
  const obs = extractObservable(m, result);
  if (obs == null) return { outcome: 'void', reason: 'missing_observable', observable: null };

  const dir = m.direction;
  const line = m.line;

  // Over/Under
  if (dir === 'over' || dir === 'under') {
    if (line == null) return { outcome: 'void', reason: 'missing_line' };
    if (obs > line)  return { outcome: dir === 'over'  ? 'green' : 'red',  observable: obs };
    if (obs < line)  return { outcome: dir === 'under' ? 'green' : 'red',  observable: obs };
    return { outcome: 'push', observable: obs };
  }

  // BTTS sim/nao (observable 0/1)
  if (dir === 'sim' || dir === 'nao') {
    const isYes = obs === 1;
    if ((dir === 'sim' && isYes) || (dir === 'nao' && !isYes)) return { outcome: 'green', observable: obs };
    return { outcome: 'red', observable: obs };
  }

  // 1X2 (observable -1/0/+1)
  if (dir === 'home') return { outcome: obs > 0 ? 'green' : 'red', observable: obs };
  if (dir === 'draw') return { outcome: obs === 0 ? 'green' : 'red', observable: obs };
  if (dir === 'away') return { outcome: obs < 0 ? 'green' : 'red', observable: obs };

  return { outcome: 'void', reason: 'unsupported_direction' };
}
