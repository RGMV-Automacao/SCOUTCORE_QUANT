// @scoutcore/scout — SCOUT IA opt-in (MOTOR4x4_SPEC §9)
// Arquitetura em duas camadas (portada do Motor Turbo):
//   1) Perplexity Sonar (camada de enriquecimento web) — opcional, gera contexto
//      dinâmico (lesões, técnico, próximo jogo, logística, clima) ─ sai gracioso
//      se PERPLEXITY_API_KEY não estiver definida.
//   2) OpenAI GPT-4o (cérebro analítico ÚNICO) — recebe contexto do motor + web
//      context (quando disponível) e emite ScoutOverlay validado.
// Timeout total: SCOUT_TIMEOUT_MS (default 20s); web fetch: SCOUT_WEB_TIMEOUT_MS (15s).
// confidence_delta clipped a [-0.20, +0.15]; severity ∈ {low,medium,high}.
// Zero chamadas externas quando options.scout !== true.

export const SCOUT_VERSION = '0.3.1';

const DELTA_MIN = -0.20;
const DELTA_MAX = +0.15;
const VALID_SEVERITIES = new Set(['low', 'medium', 'high']);
const OPENAI_URL  = 'https://api.openai.com/v1/chat/completions';
const SONAR_URL   = 'https://api.perplexity.ai/chat/completions';
const GPT_MODEL   = 'gpt-4o';
const SONAR_MODEL = 'sonar-pro';
const SONAR_MAX_CHARS = 2200;

// ── System prompt (portado do Motor Turbo, ajustado p/ SCOUTCORE) ─────────────
const SYSTEM_PROMPT = `Você é o SCOUT — analista quantitativo-qualitativo de apostas esportivas.

## Papel
Você não valida predições. Você questiona o edge encontrado pelo motor:
"Por que o mercado está pagando mais do que os modelos acham justo?"

- Se não encontrar razão contextual → edge provavelmente real → confidence_delta positivo
- Se encontrar razão contextual que explica o edge → red_flag + confidence_delta negativo

## O que você recebe
1. Top slots com edge positivo (fair_prob, market_odd, edge_pct, confidence)
2. Perfil estatístico dos times (médias de gols, escanteios, cartões, etc.)
3. Contexto da partida (liga, data, regime hints quando disponíveis)

## Regras
- Analise CADA slot com edge ≥ 3%
- Emita red_flag apenas quando houver evidência concreta, não suspeita vaga
- confidence_delta entre -0.20 e +0.15 (pequenos ajustes, não overrides)
- scout_score 0–100: reflete confiança GERAL no jogo, não em slots individuais
- Seja conciso na narrative (3–5 frases, português)
- Não invente estatísticas — use apenas os dados fornecidos
- market_key nas red_flags DEVE ser exatamente uma das chaves listadas

## Sinais críticos a considerar
- Mercados de cartões e escanteios HT têm alta variância — exigir edge mais alto para confiar
- Edge > 20% sem razão contextual é provavelmente phantom — red_flag MEDIUM
- Confidence < 0.4 do motor + edge alto = sinal ambíguo — red_flag LOW
- Derby/clássico aumenta confiança em edges de cartões/faltas
- Visitante com viagem longa ou jogo curto: red_flag MEDIUM em slots ofensivos do visitante

## Quando o bloco "INTELIGÊNCIA DE MERCADO" estiver presente
Use os sinais dinâmicos (lesões, troca técnico, próximo jogo decisivo ≤4 dias, viagem longa,
calor ≥30°C, terceiro jogo em 7 dias, altitude ≥800m, clássico/derby) como ÊNFASE adicional:
- Desfalque de goleiro/artilheiro do mandante: red_flag HIGH em "casa marca / vence"
- Visitante com jogo decisivo em ≤4 dias (Copa/Libertadores): red_flag HIGH em slots ofensivos do visitante
- Troca de técnico nas últimas 4 semanas: red_flag MEDIUM em previsões baseadas em padrão estatístico (efeito Lazarus)
- Sem informação útil no bloco web: ignorar, NÃO inventar.`;

const JSON_SCHEMA_SUFFIX = `

## Output JSON obrigatório (siga EXATAMENTE esta estrutura):
{
  "red_flags": [
    {
      "market_key": "string (uma das chaves listadas)",
      "reason": "string curta em português",
      "severity": "low" | "medium" | "high",
      "confidence_delta": número entre -0.20 e +0.15,
      "rationale": "uma frase em português"
    }
  ],
  "narrative": "string (3-5 frases em português)",
  "scout_score": número inteiro 0-100
}
Não use nenhuma outra chave além dessas três no objeto raiz.`;

// ── Context assembler ─────────────────────────────────────────────────────────
function buildContext({ slots, evidence, matchContext, evRanked }) {
  const slotByKey = new Map(slots.map((s) => [s.market_key, s]));
  const topSlots  = (evRanked ?? []).slice(0, 5).map((k) => slotByKey.get(k)).filter(Boolean);

  return {
    home:         matchContext?.home  ?? '?',
    away:         matchContext?.away  ?? '?',
    liga:         matchContext?.liga  ?? '?',
    date:         matchContext?.date  ?? '?',
    profileHome:  evidence?.profileHome ?? null,
    profileAway:  evidence?.profileAway ?? null,
    topSlots,
    regimeHints:  matchContext?.regime_hints ?? [],
  };
}

function formatProfile(profile, name) {
  if (!profile) return `${name}: perfil não disponível`;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '?');
  const parts = [];
  if (profile.avg_goals_scored_home != null) parts.push(`gols_casa=${num(profile.avg_goals_scored_home)}`);
  if (profile.avg_goals_scored_away != null) parts.push(`gols_fora=${num(profile.avg_goals_scored_away)}`);
  if (profile.avg_goals_conceded_home != null) parts.push(`sof_casa=${num(profile.avg_goals_conceded_home)}`);
  if (profile.avg_goals_conceded_away != null) parts.push(`sof_fora=${num(profile.avg_goals_conceded_away)}`);
  if (profile.avg_corners != null) parts.push(`escanteios=${num(profile.avg_corners)}`);
  if (profile.avg_cards != null) parts.push(`cartoes=${num(profile.avg_cards)}`);
  if (profile.avg_shots != null) parts.push(`chutes=${num(profile.avg_shots)}`);
  if (profile.n != null) parts.unshift(`n=${profile.n}`);
  return `${name}: ${parts.length ? parts.join(' ') : 'sem médias'}`;
}

// ── Prompt builder ────────────────────────────────────────────────────────────
function buildPrompt(ctx) {
  const slotsBlock = ctx.topSlots.length
    ? ctx.topSlots.map((s, i) =>
        `${i + 1}. ${s.market_key} — prob=${(s.fair_prob * 100).toFixed(1)}%, ` +
        `odd=${s.market_odd ?? '?'}, edge=${s.edge_pct != null ? (s.edge_pct * 100).toFixed(1) + '%' : '?'}, ` +
        `conf=${s.confidence != null ? (s.confidence * 100).toFixed(0) + '%' : '?'}`)
        .join('\n')
    : 'Nenhum mercado com edge positivo detectado.';

  const blocks = [
    `=== PARTIDA: ${ctx.home} vs ${ctx.away} | ${ctx.liga} | ${ctx.date} ===`,
    '',
    formatProfile(ctx.profileHome, ctx.home),
    formatProfile(ctx.profileAway, ctx.away),
    '',
    '=== TOP SLOTS COM EDGE ===',
    slotsBlock,
    ctx.regimeHints?.length ? `\nRegime hints: ${ctx.regimeHints.join(', ')}` : '',
    ctx.webContext ? `\n${ctx.webContext}` : '',
    '',
    '=== TAREFA ===',
    'Analise os slots acima. Para cada um com edge ≥ 3%, determine se o edge é real ou há razão contextual.',
    'Responda em JSON conforme o schema fornecido no system prompt.',
  ];
  return blocks.filter(Boolean).join('\n');
}

// ── Timeout fetch helper ──────────────────────────────────────────────────────
async function fetchTimeout(url, opts, ms) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Camada de enriquecimento web: Perplexity Sonar ───────────────────────────
// Portado do Motor Turbo (scout-perplexity.js). Busca inteligência dinâmica
// (lesões, técnico, próximo jogo, logística, clima). Retorna null em qualquer
// falha — SCOUT continua sem contexto web (modo degradado).
const SONAR_SYSTEM = `Você é um agente de inteligência esportiva para um modelo quantitativo de apostas.
Sua missão: fornecer inteligência concreta sobre o jogo que possa afetar mercados de apostas.

Regras:
- Para fatos DINÂMICOS (lesões, escala, próximos jogos, clima recente): busque na web e cite fontes.
- Para fatos ESTÁTICOS (distância entre cidades, altitude, histórico de rivalidade): use seu próprio conhecimento.
- Se não encontrar informação dinâmica sobre uma categoria, escreva "sem informação".
- Não invente fatos dinâmicos. Seja conciso — cada item em 1-3 linhas.`;

function buildSonarQuery({ home, away, liga, date }) {
  return `Jogo: ${home} x ${away} | ${liga} | ${date}

Pesquise e responda CADA categoria abaixo sobre este jogo:

1. CLÁSSICO/RIVALIDADE — É derby? Intensidade emocional? [impacto: cartões, faltas]
2. STAKES — Situação na tabela. O que está em jogo? [impacto: intensidade, rotação]
3. DESFALQUES CONFIRMADOS — Lesões/suspensões (goleiro titular, artilheiro, armador). [impacto: gols]
4. ESCALAÇÃO / NOVIDADES — Retornos, pistas do técnico, rotação por Copa? [impacto: força real]
5. PRÓXIMO COMPROMISSO de ${home} e ${away} — competição, adversário, data; jogo decisivo em ≤4 dias? Time misto? [impacto CRÍTICO: rotação]
6. CLIMA EMOCIONAL / TROCA DE TÉCNICO — troca nas últimas 4 semanas? Crise interna? [impacto: imprevisível]
7. FATORES LOGÍSTICOS:
   a) DISTÂNCIA: cidade ${home} ↔ cidade ${away}, km aproximados (curta<500 / média 500-1500 / longa>1500 / extrema>2500)
   b) CANSAÇO: último jogo do ${away} antes de ${date}, dias de descanso, foi pesado?
   c) TRIPLA RODADA: ${away} faz >2 jogos em 7 dias?
   d) CLIMA: temperatura/chuva prevista em ${home} em ${date} (>30°C? chuva intensa?)
   e) ALTITUDE: cidade ${home} acima de 700m?
   [impacto: under gols/escanteios visitante, mandante favorecido]
8. ESTATÍSTICA MARCANTE — sequência relevante (invencibilidade, jejum, over/under recente).

Responda em português, categoriado exatamente como acima.`;
}

export async function fetchWebContext(match, { timeoutMs } = {}) {
  if (!process.env.PERPLEXITY_API_KEY) return null;
  const ms = Number(timeoutMs ?? process.env.SCOUT_WEB_TIMEOUT_MS ?? 15000);
  try {
    const res = await fetchTimeout(SONAR_URL, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model:       SONAR_MODEL,
        messages: [
          { role: 'system', content: SONAR_SYSTEM },
          { role: 'user',   content: buildSonarQuery(match) },
        ],
        max_tokens:       750,
        temperature:      0.1,
        return_citations: true,
      }),
    }, ms);
    if (!res.ok) return null;
    const body = await res.json();
    const text = body?.choices?.[0]?.message?.content;
    if (!text) return null;
    const truncated = text.length > SONAR_MAX_CHARS ? text.slice(0, SONAR_MAX_CHARS) + '\n[truncado]' : text;
    return `=== INTELIGÊNCIA DE MERCADO (Perplexity Sonar) ===\n${match.home} x ${match.away} | ${match.date}\n\n${truncated}`;
  } catch {
    return null;
  }
}

// ── Provider único: OpenAI GPT-4o ─────────────────────────────────────────────
async function callOpenAI(systemPrompt, userPrompt, ms) {
  const t0  = Date.now();
  const res = await fetchTimeout(OPENAI_URL, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model:           GPT_MODEL,
      response_format: { type: 'json_object' },
      temperature:     0.2,
      max_tokens:      1024,
      messages: [
        { role: 'system', content: systemPrompt + JSON_SCHEMA_SUFFIX },
        { role: 'user',   content: userPrompt },
      ],
    }),
  }, ms);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`openai_${res.status}:${text.slice(0, 160)}`);
  }
  const body    = await res.json();
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error('openai_empty');
  return {
    model:  GPT_MODEL,
    raw:    JSON.parse(content),
    tokens: body.usage?.total_tokens ?? 0,
    ms:     Date.now() - t0,
  };
}

// ── Validator + clipper ───────────────────────────────────────────────────────
function validateOverlay(raw, allowedMarketKeys) {
  const allow = allowedMarketKeys ? new Set(allowedMarketKeys) : null;
  const red_flags = [];
  for (const f of Array.isArray(raw?.red_flags) ? raw.red_flags : []) {
    if (typeof f.market_key !== 'string') continue;
    if (allow && !allow.has(f.market_key)) continue;
    if (!VALID_SEVERITIES.has(f.severity)) continue;
    const delta = typeof f.confidence_delta === 'number' ? f.confidence_delta : 0;
    red_flags.push({
      market_key:       f.market_key,
      reason:           String(f.reason    ?? ''),
      severity:         f.severity,
      confidence_delta: Math.max(DELTA_MIN, Math.min(DELTA_MAX, delta)),
      rationale:        String(f.rationale ?? ''),
    });
  }
  const scout_score = typeof raw?.scout_score === 'number'
    ? Math.min(100, Math.max(0, Math.round(raw.scout_score)))
    : null;
  const narrative = typeof raw?.narrative === 'string' ? raw.narrative : null;
  return { red_flags, narrative, scout_score };
}

function emptyOverlay({ skip_reason, latency_ms = 0, tokens_used = 0, model = null, web_context_used = false }) {
  return { model, latency_ms, tokens_used, red_flags: [], narrative: null, scout_score: null, web_context_used, skip_reason };
}

// ── Main export ───────────────────────────────────────────────────────────────
/**
 * runScout — SCOUT IA opt-in.
 * Arquitetura: Perplexity Sonar (web context opcional) → GPT-4o (cérebro único).
 * Retorna ScoutOverlay | null.
 * null quando options.scout !== true (zero latência adicionada).
 */
export async function runScout({ slots, evidence, matchContext, evRanked, options }) {
  if (options?.scout !== true) return null;

  if (!process.env.OPENAI_API_KEY) {
    return emptyOverlay({ skip_reason: 'no_openai_key' });
  }

  const timeoutMs = Number(process.env.SCOUT_TIMEOUT_MS ?? 20000);
  const ctx       = buildContext({ slots, evidence, matchContext, evRanked });

  if (!ctx.topSlots.length) {
    return emptyOverlay({ skip_reason: 'no_eligible_slots' });
  }

  // Fase 1: enriquecimento web (opcional, não-bloqueante).
  // options.scout_web === false desativa explicitamente.
  let webContext = null;
  if (options.scout_web !== false && matchContext) {
    webContext = await fetchWebContext({
      home: matchContext.home,
      away: matchContext.away,
      liga: matchContext.liga,
      date: matchContext.date,
    });
  }
  ctx.webContext = webContext;

  // Fase 2: análise GPT-4o (cérebro único).
  const userPrompt  = buildPrompt(ctx);
  const allowedKeys = ctx.topSlots.map((s) => s.market_key);

  try {
    const result    = await callOpenAI(SYSTEM_PROMPT, userPrompt, timeoutMs);
    const validated = validateOverlay(result.raw, allowedKeys);
    return {
      model:            result.model,
      latency_ms:       result.ms,
      tokens_used:      result.tokens,
      web_context_used: !!webContext,
      ...validated,
      skip_reason:      null,
    };
  } catch (err) {
    const msg = err?.name === 'AbortError' ? 'timeout' : (err?.message ?? 'unknown_error');
    return emptyOverlay({
      skip_reason:      `openai_failed:${msg.slice(0, 80)}`,
      latency_ms:       timeoutMs,
      web_context_used: !!webContext,
    });
  }
}

// ── Apply overlay to slots ────────────────────────────────────────────────────
/**
 * Aplica confidence_delta do ScoutOverlay nos slots.
 * Clipping já feito pelo validator — aplicamos direto.
 */
export function applyScoutOverlay(slots, overlay) {
  if (!overlay?.red_flags?.length) return slots;
  const byKey = new Map(slots.map((s) => [s.market_key, s]));
  for (const flag of overlay.red_flags) {
    const slot = byKey.get(flag.market_key);
    if (!slot) continue;
    slot.confidence = Math.min(1, Math.max(0, (slot.confidence ?? 0.5) + flag.confidence_delta));
    slot.provenance = {
      ...(slot.provenance ?? {}),
      scout_flag: { severity: flag.severity, delta_applied: flag.confidence_delta, reason: flag.reason },
    };
  }
  return slots;
}

// ── Legacy text report (mantido para compatibilidade — NÃO é IA) ──────────────
export const SCOUT_VERSION_LEGACY = '0.1.0';

export function buildScoutReport({ match, slots, evRanked, evRankedCappedOut, warnings }) {
  const slotByKey = new Map(slots.map((s) => [s.market_key, s]));
  const topPicks  = (evRanked ?? []).slice(0, 5).map((k) => {
    const s = slotByKey.get(k);
    if (!s) return null;
    return {
      market_key: k,
      family:     s.family,
      fair_prob:  s.fair_prob,
      market_odd: s.market_odd ?? null,
      edge_pct:   s.edge_pct ?? null,
      confidence: s.confidence ?? null,
      phantom:    s.provenance?.phantom_edge_flag === true,
    };
  }).filter(Boolean);

  const notes = [...(warnings ?? [])];

  // no_odds_provided: nenhum slot com odd no ranking
  if (topPicks.length === 0 && (slots ?? []).some((s) => s.market_odd == null)) {
    notes.push(`no_odds_provided:${slots.length}_slots`);
  }

  // phantom_edge_detected
  for (const p of topPicks) {
    if (p.phantom) notes.push(`phantom_edge_detected:${p.market_key}`);
  }

  // low_confidence_in_top5
  if (topPicks.some((p) => (p.confidence ?? 1) < 0.4)) {
    notes.push('low_confidence_in_top5');
  }

  // family_cap_filtered
  const cappedOut = (evRankedCappedOut ?? []);
  if (cappedOut.length > 0) {
    notes.push(`family_cap_filtered:${cappedOut.length}`);
  }

  const summary = topPicks.length === 0
    ? `Sem picks ranqueados para ${match.home} × ${match.away}.`
    : `Top: ${topPicks[0].market_key} @ ${topPicks[0].market_odd ?? '?'} (edge=${topPicks[0].edge_pct ?? '?'}pp).`;

  return {
    version:        SCOUT_VERSION_LEGACY,
    summary,
    top_picks:      topPicks,
    capped_out_count: cappedOut.length,
    notes,
    generated_in_ms: 0,
  };
}
