'use strict';

/**
 * ═══════════════════════════════════════════════════════════════
 * SB API ADAPTER — Superbet API payload → rawEntries
 * ═══════════════════════════════════════════════════════════════
 *
 * Transforma o payload de /events/{eventId} da API Superbet no mesmo
 * formato `rawEntries` que o scraper DOM produz:
 *   { heading, lineText, outcome, odd, teamTab, sectionName }
 *
 * Resultado: o parser existente (parseRawEntries em sb-odds-parser.cjs)
 * consome tanto scraper DOM quanto API sem modificação.
 *
 * Diferenças do payload vs DOM:
 * - Heading da API às vezes embute o nome do time direto:
 *     "Inter de Milão - Total de Gols"
 *   No DOM, isso viria como heading="Total de Gols da Equipe" + teamTab="Inter de Milão".
 *   O adapter detecta o padrão "<Team> - <HeadingKnown>" e normaliza.
 * - Selection text ("Mais de 1.5", "Menos de 0.5", "Sim", "1", etc.)
 *   já tem tudo que precisamos para derivar outcome e line.
 * - specialBetValue / specifiers.total / specifiers.hcp entram como
 *   fallback para extrair linha quando o `name` é ambíguo.
 *
 * Mercados NÃO suportados pelo HEADING_MAP (ex: "Jogador - Finalizações",
 * "Intervalo/Resultado Final") passam direto como unknown_heading e
 * entram em `skipped` do parser. Isso é desejado — só coletamos os
 * mercados do contrato.
 */

const { HEADING_MAP } = require('./sb-selectors.cjs');

// Lista de patterns "Time - HeadingConhecido" para normalização.
// Gerada por: pegar cada heading do HEADING_MAP que tem "da Equipe"
// e inferir o sufixo sem " da Equipe".
// Mais barato ter lista explícita para clareza e tests.
const TEAM_PREFIXED_MAP = Object.freeze({
  // GOLS
  'Total de Gols':                        'Total de Gols da Equipe',
  '1º Tempo - Total de Gols':             '1º Tempo - Total de Gols do Time',
  // ESCANTEIOS
  'Total de Escanteios':                  'Total de Escanteios da Equipe',
  '1º Tempo - Total de Escanteios':       '1º Tempo - Total de Escanteios da Equipe',
  // CARTÕES
  'Total de Cartões':                     'Total de Cartões da Equipe',
  '1º Tempo - Total de Cartões':          '1º Tempo - Total de Cartões da Equipe',
  // CHUTES
  'Total de Chutes no Gol':               'Total de Chutes no Gol da Equipe',
  '1º Tempo - Total de Chutes no Gol':    '1º Tempo - Chutes no Gol Totais da Equipe',
  // FALTAS
  'Total de Faltas':                      'Total de Faltas da Equipe',
  '1º Tempo - Total de Faltas':           '1º Tempo - Total de Faltas da Equipe',
  // FINALIZAÇÕES
  'Total de Finalizações':                'Total de Finalizações da Equipe',
  '1º Tempo - Total de Finalizações':     '1º Tempo - Finalizações Totais da Equipe',
  // IMPEDIMENTOS
  'Total de Impedimentos':                'Total de Impedimentos da Equipe',
});

// Pattern C — sufixos curtos (sem "Total de") usados pela API quando vem
// como "{Time} - {SufixoCurto}" (ex.: "Vasco da Gama - Chutes no Gol").
const SHORT_TEAM_SUFFIX_MAP = Object.freeze({
  'Chutes no Gol': 'Total de Chutes no Gol da Equipe',
});

// Pattern B — quando a API inverte e vem como "{HeadingTotal} {Time}"
// SEM hífen (ex.: "Total de Finalizações Vasco da Gama"). Lista de
// totais conhecidos cuja contraparte por equipe é mapeada.
const SUFFIX_TEAM_MAP = Object.freeze({
  'Total de Finalizações':   'Total de Finalizações da Equipe',
  '1º Tempo - Total de Finalizações': '1º Tempo - Finalizações Totais da Equipe',
  'Total de Chutes no Gol':  'Total de Chutes no Gol da Equipe',
  'Total de Cartões':        'Total de Cartões da Equipe',
  'Total de Escanteios':     'Total de Escanteios da Equipe',
  'Total de Faltas':         'Total de Faltas da Equipe',
  'Total de Impedimentos':   'Total de Impedimentos da Equipe',
  'Total de Gols':           'Total de Gols da Equipe',
});

// Pattern D/F — "1º Tempo - <X> de {Time}" e "1º Tempo - Total de <X> de {Time}".
// Mapa (X normalizado lowercase) → heading canônico do HEADING_MAP.
const FIRST_HALF_DE_MAP = Object.freeze({
  'gols':            '1º Tempo - Total de Gols do Time',
  'cartões':         '1º Tempo - Total de Cartões da Equipe',
  'cartoes':         '1º Tempo - Total de Cartões da Equipe',
  'escanteios':      '1º Tempo - Total de Escanteios da Equipe',
  'faltas':          '1º Tempo - Total de Faltas da Equipe',
  'chutes no gol':   '1º Tempo - Chutes no Gol Totais da Equipe',
  'finalizações':    '1º Tempo - Finalizações Totais da Equipe',
  'finalizacoes':    '1º Tempo - Finalizações Totais da Equipe',
});

// Pattern E — "1º Tempo - {Time} {SufixoCurto}". Sufixo (lowercase) → heading.
const FIRST_HALF_TEAM_SUFFIX_MAP = Object.freeze({
  'faltas':          '1º Tempo - Total de Faltas da Equipe',
  'chutes no gol':   '1º Tempo - Chutes no Gol Totais da Equipe',
  'finalizações':    '1º Tempo - Finalizações Totais da Equipe',
  'finalizacoes':    '1º Tempo - Finalizações Totais da Equipe',
  'gols totais':     '1º Tempo - Total de Gols do Time',
  'cartões':         '1º Tempo - Total de Cartões da Equipe',
  'cartoes':         '1º Tempo - Total de Cartões da Equipe',
  'escanteios':      '1º Tempo - Total de Escanteios da Equipe',
});

function _stripDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// TEAM ALIASES — fonte única (config/team-aliases.json) para resolver variantes
// entre API (ex.: "Tottenham", "Cruzeiro MG") e canônico do DB (ex.:
// "Tottenham Hotspur", "Cruzeiro"). Se não encontrar no arquivo, cai em
// heurística de tokens e registra a variante desconhecida em
// logs/audit/unknown-team-variants.log para revisão humana.
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path');
const fs = require('fs');

let _aliasMap = null;          // canonical(lower) -> Set(alias lower stripped)
let _aliasReverseMap = null;   // alias lower stripped -> canonical original
function _loadAliases() {
  if (_aliasMap) return;
  _aliasMap = new Map();
  _aliasReverseMap = new Map();
  try {
    const p = path.join(__dirname, '..', 'config', 'team-aliases.json');
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const [canonical, aliases] of Object.entries(raw)) {
      const all = [canonical, ...(Array.isArray(aliases) ? aliases : [])];
      const setKey = _stripDiacritics(canonical);
      const set = new Set();
      for (const a of all) {
        const k = _stripDiacritics(a);
        if (!k) continue;
        set.add(k);
        if (!_aliasReverseMap.has(k)) _aliasReverseMap.set(k, canonical);
      }
      _aliasMap.set(setKey, set);
    }
  } catch { /* arquivo opcional */ }
}

const _unknownLogged = new Set();
function _logUnknownVariant(apiName, dbName) {
  if (process.env.APOLLO_DISABLE_TEAM_LOG === '1') return;
  // Não logar quando o candidate parece outcome estruturado, não nome de time isolado
  if (/[;:()\[\]]/.test(apiName)) return;
  if (/^\d+\s*-/.test(apiName)) return; // "11 - Time"
  // Compostos de mercado que contêm o nome do time como substring
  if (/\b(vence|empate|tempo|gol|maior|menor|mais|menos|over|under|sim|não|nao|defesas?|goleiro|outra)\b/i.test(apiName)) return;
  if (/\s+e\s+/i.test(apiName)) return; // "X e Y", "X e Sim"
  if (apiName.split(/\s+/).length > 4) return; // nome de time real raramente passa de 4 tokens
  if (_stripDiacritics(apiName) === _stripDiacritics(dbName)) return;
  const key = `${apiName}|${dbName}`;
  if (_unknownLogged.has(key)) return;
  _unknownLogged.add(key);
  try {
    const dir = path.join(__dirname, '..', 'logs', 'audit');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const line = `${new Date().toISOString()}\tAPI=${apiName}\tDB=${dbName}\n`;
    fs.appendFileSync(path.join(dir, 'unknown-team-variants.log'), line);
  } catch { /* best-effort */ }
}

// Tokens curtos típicos de variantes (sufixos cidade/estado/categoria)
// que a Superbet adiciona/remove livremente.
const TEAM_TOKEN_NOISE = new Set([
  'fc','sc','cf','ac','sk','if','bk','sv','ec','ca','cs',
  'mg','sp','rj','rs','pr','sc','ba','pe','go','ce','df','am',
  'city','town','united','utd','de','do','da','dos','das','la','el','el','los','las',
  'jr','b','ii','iii',
]);

function _teamTokens(s) {
  return _stripDiacritics(s).split(/[\s\-/.()]+/).filter(Boolean);
}

function _isStrictSubset(a, b) {
  // a ⊆ b com pelo menos 1 token significativo coincidindo
  const bSet = new Set(b);
  let significant = 0;
  for (const tok of a) {
    if (!bSet.has(tok)) return false;
    if (!TEAM_TOKEN_NOISE.has(tok) && tok.length >= 3) significant++;
  }
  return significant >= 1;
}

function _matchTeam(candidate, teams) {
  if (!candidate || !teams || !teams.length) return null;
  _loadAliases();
  const c = _stripDiacritics(candidate.trim());
  // 1) match exato (case + diacritics insensitive)
  for (const t of teams) {
    if (t && _stripDiacritics(t) === c) return t;
  }
  // 2) match via team-aliases.json: candidate é alias de algum dos teams?
  for (const t of teams) {
    if (!t) continue;
    const tKey = _stripDiacritics(t);
    const aliasSet = _aliasMap.get(tKey);
    if (aliasSet && aliasSet.has(c)) return t;
    // Inverso: candidate é canonical e t é alias dele?
    const canonOfCandidate = _aliasReverseMap.get(c);
    if (canonOfCandidate && _stripDiacritics(canonOfCandidate) === tKey) return t;
    const canonOfT = _aliasReverseMap.get(tKey);
    if (canonOfT && _stripDiacritics(canonOfT) === c) return t;
    if (canonOfCandidate && canonOfT && canonOfCandidate === canonOfT) return t;
  }
  // 3) match bidirecional por tokens (heurístico, fallback)
  // Resolve casos novos antes de virem para o aliases.json.
  const cTokens = _teamTokens(candidate);
  if (!cTokens.length) return null;
  const candidates = [];
  for (const t of teams) {
    if (!t) continue;
    const tTokens = _teamTokens(t);
    if (!tTokens.length) continue;
    if (_isStrictSubset(cTokens, tTokens) || _isStrictSubset(tTokens, cTokens)) {
      const tSet = new Set(tTokens);
      let score = 0;
      for (const tok of cTokens) {
        if (tSet.has(tok) && !TEAM_TOKEN_NOISE.has(tok) && tok.length >= 3) score++;
      }
      candidates.push({ t, score });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  const matched = candidates[0].t;
  // 4) registrar variante desconhecida para revisão humana
  if (_stripDiacritics(matched) !== c) _logUnknownVariant(candidate.trim(), matched);
  return matched;
}

/**
 * Parse do campo `name` da API (ex: "Mais de 1.5", "Menos de 0.5",
 * "Sim", "Não", "1", "X", "2", "Inter de Milão (-1.25)", "1X").
 *
 * @param {string} name
 * @param {object} [specifiers]
 * @param {{homeTeam?: string, awayTeam?: string}} [opts]
 * @returns {{ outcome: string|null, lineText: string|null, teamTokFromName: string|null }}
 */
function parseApiSelection(name, specifiers, opts) {
  if (!name) return { outcome: null, lineText: null, teamTokFromName: null };
  const raw = String(name).trim();
  const s = raw.toLowerCase();
  const homeTeam = opts && opts.homeTeam;
  const awayTeam = opts && opts.awayTeam;

  // Mais de / Menos de X.X
  let m = raw.match(/^(Mais de|Menos de|Over|Under)\s+(-?\d+(?:[.,]\d+)?)/i);
  if (m) {
    const dir = /mais|over/i.test(m[1]) ? 'mais' : 'menos';
    return { outcome: dir, lineText: m[2].replace(',', '.'), teamTokFromName: null };
  }

  // Sim / Não
  if (s === 'sim' || s === 'yes') return { outcome: 'sim', lineText: null, teamTokFromName: null };
  if (s === 'não' || s === 'nao' || s === 'no') return { outcome: 'nao', lineText: null, teamTokFromName: null };

  // 1X2 e duplas literais
  if (['1', 'x', '2', '1x', '12', 'x2'].includes(s)) {
    return { outcome: s === 'x' ? 'X' : s === '1x' ? '1X' : s === 'x2' ? 'X2' : s, lineText: null, teamTokFromName: null };
  }

  // Dupla Chance textual: "1 ou Empate", "Empate ou 2", "1 ou 2"
  if (s === '1 ou empate' || s === 'empate ou 1') {
    return { outcome: '1X', lineText: null, teamTokFromName: null };
  }
  if (s === '2 ou empate' || s === 'empate ou 2') {
    return { outcome: 'X2', lineText: null, teamTokFromName: null };
  }
  if (s === '1 ou 2' || s === '2 ou 1') {
    return { outcome: '12', lineText: null, teamTokFromName: null };
  }

  // Mercados "Equipe Com Mais X (1X2)" e "Resultado": API usa nomes literais
  // do time + "Empate" ao invés de "1"/"X"/"2".
  if (s === 'empate' || s === 'draw') {
    return { outcome: 'X', lineText: null, teamTokFromName: null };
  }

  // Handicap: "Nome do Time (-1.25)" ou "Nome do Time (+0.5)"
  // Avaliado ANTES do match bidirecional de time, pois o nome do time
  // dentro do handicap também bate em _matchTeam (ex.: "Cruz Azul (+1.5)").
  m = raw.match(/^(.+?)\s*\(([+-]?\d+(?:[.,]\d+)?)\)$/);
  if (m) {
    const line = m[2].replace(',', '.');
    return { outcome: 'mais', lineText: line, teamTokFromName: m[1].trim() };
  }

  if (homeTeam) {
    const m1 = _matchTeam(raw, [homeTeam]);
    if (m1) return { outcome: '1', lineText: null, teamTokFromName: m1 };
  }
  if (awayTeam) {
    const m2 = _matchTeam(raw, [awayTeam]);
    if (m2) return { outcome: '2', lineText: null, teamTokFromName: m2 };
  }

  // Fallback: tenta extrair via specifiers
  if (specifiers && (specifiers.total != null || specifiers.hcp != null)) {
    const line = String(specifiers.total ?? specifiers.hcp);
    return { outcome: null, lineText: line, teamTokFromName: null };
  }

  return { outcome: null, lineText: null, teamTokFromName: null };
}

/**
 * Tenta normalizar um heading "Time - SufixoConhecido" para o formato do
 * HEADING_MAP (heading='Total de Gols da Equipe', teamTab='Time').
 *
 * Patterns suportados (ordem de avaliação):
 *  A. "{Time} - {SufixoConhecido}"          → ex.: "Vasco da Gama - Total de Gols"
 *  B. "{HeadingTotal} {Time}"                → ex.: "Total de Finalizações Vasco da Gama"
 *  C. "{Time} - {SufixoCurto}"               → ex.: "Vasco da Gama - Chutes no Gol"
 *  D. "1[º°] Tempo - Total de {X} de {Time}" → ex.: "1º Tempo - Total de Gols de São Paulo"
 *  F. "1[º°] Tempo - {X} de {Time}"          → ex.: "1° Tempo - Chutes no gol de São Paulo"
 *  E. "1[º°] Tempo - {Time} {SufixoCurto}"   → ex.: "1º Tempo - Vasco da Gama Faltas"
 *
 * Quando os times não são fornecidos via opts, o pattern A é aplicado sem
 * validação (compat com tests antigos). Quando fornecidos, todos os patterns
 * exigem que o token extraído bata com home/awayTeam, evitando falsos
 * positivos como "2º Tempo - Total de Gols" ser tratado como time.
 *
 * @param {string} rawHeading
 * @param {{homeTeam?: string, awayTeam?: string}} [opts]
 * @returns {{ heading: string, teamTab: string|null }}
 */
function normalizeHeading(rawHeading, opts) {
  if (!rawHeading) return { heading: rawHeading, teamTab: null };
  // Se já é um heading conhecido, retorna direto.
  if (HEADING_MAP[rawHeading]) return { heading: rawHeading, teamTab: null };

  const teams = [opts && opts.homeTeam, opts && opts.awayTeam].filter(Boolean);
  const hasTeams = teams.length > 0;

  // Pattern A: "<Time> - <SufixoConhecido>"
  for (const [suffix, teamHeading] of Object.entries(TEAM_PREFIXED_MAP)) {
    const needle = ` - ${suffix}`;
    if (rawHeading.endsWith(needle)) {
      const team = rawHeading.slice(0, -needle.length);
      // Bug fix: ignorar quando o "time" extraído é "1º Tempo" / "2º Tempo".
      if (/^[12][º°]\s*Tempo$/i.test(team)) continue;
      if (hasTeams) {
        const matched = _matchTeam(team, teams);
        if (!matched) continue;
        return { heading: teamHeading, teamTab: matched };
      }
      return { heading: teamHeading, teamTab: team };
    }
  }

  // Pattern C: "<Time> - <SufixoCurto>" (sem "Total de").
  for (const [suffix, teamHeading] of Object.entries(SHORT_TEAM_SUFFIX_MAP)) {
    const needle = ` - ${suffix}`;
    if (rawHeading.endsWith(needle)) {
      const team = rawHeading.slice(0, -needle.length);
      if (/^[12][º°]\s*Tempo$/i.test(team)) continue;
      if (hasTeams) {
        const matched = _matchTeam(team, teams);
        if (!matched) continue;
        return { heading: teamHeading, teamTab: matched };
      }
    }
  }

  // Pattern B: "<HeadingTotal> <Time>" (sufixo de time sem hífen).
  // Só aplica se conhecemos os times — sem isso o risco de falso positivo é alto.
  if (hasTeams) {
    for (const [prefix, teamHeading] of Object.entries(SUFFIX_TEAM_MAP)) {
      const needle = `${prefix} `;
      if (rawHeading.startsWith(needle)) {
        const team = rawHeading.slice(needle.length).trim();
        const matched = _matchTeam(team, teams);
        if (matched) return { heading: teamHeading, teamTab: matched };
      }
    }
  }

  // Pattern D/F: "1[º°] Tempo - [Total de] <X> de <Time>"
  // Cuidado: <X> pode conter " de " (ex.: "Total de Cartões"), então
  // varremos as ocorrências de " de " da direita para a esquerda
  // procurando a primeira que produz um time conhecido.
  if (hasTeams) {
    const m = rawHeading.match(/^1[º°]\s*Tempo\s*-\s*(.+)$/i);
    if (m) {
      const inner = m[1].trim();
      const positions = [];
      const re = /\s+de\s+/gi;
      let mm;
      while ((mm = re.exec(inner)) !== null) positions.push(mm.index);
      for (let i = positions.length - 1; i >= 0; i--) {
        const pos = positions[i];
        const after = inner.slice(pos).replace(/^\s+de\s+/i, '').trim();
        const team = _matchTeam(after, teams);
        if (!team) continue;
        const x = inner.slice(0, pos).trim();
        const xKey = x.toLowerCase().replace(/^total de\s+/, '').trim();
        const target = FIRST_HALF_DE_MAP[xKey];
        if (target) return { heading: target, teamTab: team };
        break; // sufixo é time mas X não está mapeado — não tente posições anteriores
      }
    }
  }

  // Pattern E: "1[º°] Tempo - <Time> <SufixoCurto>"
  if (hasTeams) {
    const m = rawHeading.match(/^1[º°]\s*Tempo\s*-\s*(.+)$/i);
    if (m) {
      const rest = m[1].trim();
      for (const team of teams) {
        const tStripped = _stripDiacritics(team);
        const restStripped = _stripDiacritics(rest);
        if (restStripped.startsWith(tStripped + ' ')) {
          const suffix = rest.slice(team.length + 1).trim().toLowerCase();
          const target = FIRST_HALF_TEAM_SUFFIX_MAP[suffix];
          if (target) return { heading: target, teamTab: team };
        }
      }
    }
  }

  return { heading: rawHeading, teamTab: null };
}

/**
 * Converte um payload de evento da API Superbet (`/events/{id}`) em
 * rawEntries para o parseRawEntries existente.
 *
 * @param {object} payload — { odds: [...], homeTeam, awayTeam, matchName, ... }
 * @param {{homeTeam?: string, awayTeam?: string}} [opts] — sobrescreve nomes
 *   inferidos do payload (ex.: nomes canônicos do banco, com aliases).
 * @returns {Array<{heading, lineText, outcome, odd, teamTab, sectionName}>}
 */
function eventToRawEntries(payload, opts) {
  if (!payload || !Array.isArray(payload.odds)) return [];
  const entries = [];

  // Resolve homeTeam/awayTeam: opts > payload.homeTeam > parse de matchName.
  let homeTeam = (opts && opts.homeTeam) || payload.homeTeam || null;
  let awayTeam = (opts && opts.awayTeam) || payload.awayTeam || null;
  if ((!homeTeam || !awayTeam) && typeof payload.matchName === 'string') {
    // matchName vem como "Home·Away" (middle dot) ou "Home - Away".
    const parts = payload.matchName.split(/\s*[·•—–-]\s*/);
    if (parts.length === 2) {
      if (!homeTeam) homeTeam = parts[0].trim();
      if (!awayTeam) awayTeam = parts[1].trim();
    }
  }
  const teamOpts = { homeTeam, awayTeam };

  for (const o of payload.odds) {
    if (o.status && o.status !== 'active') continue;
    const mn = o.marketName;
    const nm = o.name;
    if (!mn || !nm) continue;
    const price = Number(o.price);
    if (!Number.isFinite(price) || price <= 1) continue;

    const { outcome, lineText, teamTokFromName } = parseApiSelection(nm, o.specifiers, teamOpts);
    if (!outcome) continue;

    const { heading, teamTab } = normalizeHeading(mn, teamOpts);
    // Para mercados de handicap, o nome da odd carrega o time
    // (ex.: "Chivas Guadalajara (-1.5)"). Sem essa tag, o match-engine
    // bypassa filterByTeamTab e atribui a odd do oponente ao slot
    // do home, gerando pipes com sinal/lado invertido.
    const isHandicapMarket = /handicap/i.test(mn);
    const resolvedTeamTab = teamTab || (isHandicapMarket ? teamTokFromName : null) || null;
    entries.push({
      heading,
      lineText,
      outcome,
      odd: price,
      teamTab: resolvedTeamTab,
      sectionName: mn, // preserva o marketName original para auditoria
    });
  }
  return entries;
}

module.exports = {
  parseApiSelection,
  normalizeHeading,
  eventToRawEntries,
  TEAM_PREFIXED_MAP,
  SHORT_TEAM_SUFFIX_MAP,
  SUFFIX_TEAM_MAP,
  FIRST_HALF_DE_MAP,
  FIRST_HALF_TEAM_SUFFIX_MAP,
};
