// @scoutcore/scout — SCOUT IA opt-in (MOTOR4x4_SPEC §9)
// Arquitetura atual:
//   1) Perplexity Sonar (camada de enriquecimento web) — opcional, gera contexto
//      dinâmico (lesões, técnico, próximo jogo, logística, clima) ─ sai gracioso
//      se PERPLEXITY_API_KEY não estiver definida.
//   2) Cadeia de análise LLM com fallback: GPT-4o → Perplexity → Claude.
//      Cada provider recebe o mesmo prompt analítico e emite ScoutOverlay validado.
// Timeout por provider: SCOUT_TIMEOUT_MS (default 20s); web fetch: SCOUT_WEB_TIMEOUT_MS (15s).
// confidence_delta clipped a [-0.20, +0.15]; severity ∈ {low,medium,high}.
// Zero chamadas externas quando options.scout !== true.

export const SCOUT_VERSION = '0.4.0';

const DELTA_MIN = -0.20;
const DELTA_MAX = +0.15;
const VALID_SEVERITIES = new Set(['low', 'medium', 'high']);
const OPENAI_URL  = 'https://api.openai.com/v1/chat/completions';
const SONAR_URL   = 'https://api.perplexity.ai/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const GPT_MODEL   = 'gpt-4o';
const SONAR_MODEL = 'sonar-pro';
const CLAUDE_MODEL_FALLBACK = 'claude-3-5-sonnet-latest';
const SONAR_MAX_CHARS = 3600;
const DEFAULT_WEB_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const webContextCache = new Map();

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
3. Forma recente / variância dos top slots (min, max, últimos valores quando disponível)
4. Contexto da partida (liga, data, regime hints quando disponíveis)

## Regras
- Analise CADA slot com edge ≥ 3%
- Emita red_flag apenas quando houver evidência concreta, não suspeita vaga
- confidence_delta entre -0.20 e +0.15 (pequenos ajustes, não overrides)
- scout_score 0–100: reflete confiança GERAL no jogo, não em slots individuais
- narrative DEVE citar: (a) o slot mais confiável por confidence numérica (não necessariamente o #1 do ranking) e por que merece ou não confiança, (b) o fator contextual web mais relevante ou ausência dele, (c) conclusão acionável: "edge parece limpo", "cautela recomendada" ou "evitar"
- Se um slot com edge ≥ 5% NÃO receber red_flag, mencione brevemente por que foi aceito: confiança adequada, variância controlada ou ausência de contexto adverso
- Evite linguagem genérica sem dado específico (ex: "tendência moderada", "jogo equilibrado", "time forte")
- Não invente estatísticas — use apenas os dados fornecidos
- market_key nas red_flags DEVE ser exatamente uma das chaves listadas

## Âncoras scout_score
- 85–100: top slots com conf ≥ 0.50, edge ≤ 15%, variância recente controlada e web context sem flags materiais
- 60–80: 1–2 red_flags LOW/MEDIUM presentes, edge moderado, sem fator crítico confirmado
- 35–59: flag HIGH presente, ou conf < 0.30 em todos os top slots, ou variância recente muito aberta no mercado principal
- <35: múltiplas flags HIGH, ou web context revelou fator crítico confirmado (desfalque GK/artilheiro, clássico com escalação incerta, rotação pesada ≤4 dias)

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
    hora:         matchContext?.hora ?? null,
    temporada:    matchContext?.temporada ?? matchContext?.season ?? null,
    rodada:       matchContext?.rodada ?? matchContext?.round ?? null,
    stadium:      matchContext?.stadium ?? matchContext?.venue ?? null,
    referee:      matchContext?.referee ?? null,
    weather:      matchContext?.weather ?? null,
    profileHome:  evidence?.profileHome ?? null,
    profileAway:  evidence?.profileAway ?? null,
    matchEvidence: evidence?.matchEvidence ?? null,
    slotForm:     evidence?.slotForm ?? [],
    topSlots,
    regimeHints:  matchContext?.regime_hints ?? [],
  };
}

function formatProfile(profile, name) {
  if (!profile) return `${name}: perfil não disponível`;
  const val = (...keys) => {
    for (const k of keys) if (profile[k] != null) return profile[k];
    return null;
  };
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '?');
  const parts = [];
  const scored = val('avg_gols_marcados', 'avg_goals_scored_home', 'avg_goals_scored_away', 'avg_goals_scored');
  const conceded = val('avg_gols_sofridos', 'avg_goals_conceded_home', 'avg_goals_conceded_away', 'avg_goals_conceded');
  const goalsTotal = val('avg_gols_total', 'avg_goals_total');
  const corners = val('avg_escanteios', 'avg_corners');
  const cornersAgainst = val('avg_escanteios_sofridos', 'avg_corners_against');
  const shots = val('avg_chutes', 'avg_shots');
  const shotsOnTarget = val('avg_chutes_no_alvo', 'avg_shots_on_target');
  const yellowCards = val('avg_cartoes_amarelos', 'avg_yellow_cards');
  const redCards = val('avg_cartoes_vermelhos', 'avg_red_cards');
  const fouls = val('avg_faltas_cometidas', 'avg_fouls');
  if (scored != null) parts.push(`gols_marcados=${num(scored)}`);
  if (conceded != null) parts.push(`gols_sofridos=${num(conceded)}`);
  if (goalsTotal != null) parts.push(`gols_total=${num(goalsTotal)}`);
  if (corners != null) parts.push(`esc_favor=${num(corners)}`);
  if (cornersAgainst != null) parts.push(`esc_contra=${num(cornersAgainst)}`);
  if (shots != null) parts.push(`chutes=${num(shots)}`);
  if (shotsOnTarget != null) parts.push(`chutes_alvo=${num(shotsOnTarget)}`);
  if (yellowCards != null) parts.push(`cart_am=${num(yellowCards)}`);
  if (redCards != null) parts.push(`cart_verm=${num(redCards)}`);
  if (fouls != null) parts.push(`faltas=${num(fouls)}`);
  if (profile.n_events != null) parts.push(`n_eventos=${profile.n_events}`);
  if (profile.as_of != null) parts.push(`as_of=${profile.as_of}`);
  if (profile.n != null) parts.unshift(`n=${profile.n}`);
  return `${name}: ${parts.length ? parts.join(' ') : 'sem médias'}`;
}

function formatMatchDetails(ctx) {
  const parts = [];
  if (ctx.temporada) parts.push(`temporada=${ctx.temporada}`);
  if (ctx.rodada) parts.push(`rodada=${ctx.rodada}`);
  if (ctx.hora) parts.push(`hora=${ctx.hora}`);
  if (ctx.stadium) parts.push(`estadio=${ctx.stadium}`);
  if (ctx.referee) parts.push(`arbitro=${ctx.referee}`);
  if (ctx.weather) parts.push(`clima_previo=${ctx.weather}`);
  return parts.length ? `Detalhes: ${parts.join(' | ')}` : null;
}

function formatSequenceSummary(summary) {
  if (!summary) return 'indisponível';
  const seq = Array.isArray(summary.values) ? summary.values.join(',') : '?';
  const parts = [`ult=[${seq}]`];
  if (summary.min != null) parts.push(`min=${summary.min}`);
  if (summary.max != null) parts.push(`max=${summary.max}`);
  if (summary.avg != null) parts.push(`avg=${summary.avg}`);
  if (summary.n != null) parts.push(`n=${summary.n}`);
  return parts.join(' ');
}

function formatSlotForm(slotForm) {
  if (!Array.isArray(slotForm) || slotForm.length === 0) return null;
  const lines = [];
  for (const item of slotForm.slice(0, 3)) {
    lines.push(`${item.market_key}: home_${item.metric} ${formatSequenceSummary(item.home)} | away_${item.metric} ${formatSequenceSummary(item.away)}`);
  }
  return lines.length ? lines.join('\n') : null;
}

function formatEdgePct(edgePct) {
  const value = Number(edgePct);
  if (!Number.isFinite(value)) return '?';
  const pct = Math.abs(value) <= 1 ? value * 100 : value;
  return `${pct.toFixed(1)}%`;
}

// ── Prompt builder ────────────────────────────────────────────────────────────
function buildPrompt(ctx) {
  const slotsBlock = ctx.topSlots.length
    ? ctx.topSlots.map((s, i) =>
        `${i + 1}. ${s.market_key} — prob=${(s.fair_prob * 100).toFixed(1)}%, ` +
        `odd=${s.market_odd ?? '?'}, edge=${s.edge_pct != null ? formatEdgePct(s.edge_pct) : '?'}, ` +
        `conf=${s.confidence != null ? (s.confidence * 100).toFixed(0) + '%' : '?'}`)
        .join('\n')
    : 'Nenhum mercado com edge positivo detectado.';

  const blocks = [
    `=== PARTIDA: ${ctx.home} vs ${ctx.away} | ${ctx.liga} | ${ctx.date} ===`,
    formatMatchDetails(ctx),
    '',
    formatProfile(ctx.profileHome, ctx.home),
    formatProfile(ctx.profileAway, ctx.away),
    formatSlotForm(ctx.slotForm) ? `\n=== FORMA RECENTE / VARIÂNCIA DOS TOP SLOTS ===\n${formatSlotForm(ctx.slotForm)}` : '',
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
- Não invente fatos dinâmicos. Seja conciso — cada item em 1-3 linhas.
- Se o espaço for limitado, priorize: (1) próximo compromisso ≤4 dias, (2) desfalques confirmados de titulares, (3) cansaço/viagem do visitante, (4) demais categorias.

Qualidade de fonte:
- Priorize fontes oficiais, liga, clubes, ESPN, SofaScore, Flashscore e veículos jornalísticos reconhecidos.
- Não use YouTube, redes sociais, páginas de odds, páginas de palpite ou live pages como prova única de desfalque, escalação, tabela ou resultado.
- Nunca trate vídeo/highlight/placar futuro como resultado confirmado quando o jogo ainda não tem status final confirmado.
- Não derive STAKES de records soltos em boxscore/live score. Use tabela/classificação somente se a fonte mostrar explicitamente posição, pontos e rodada.
- Se uma fonte parecer placeholder, conflitante ou pós-jogo antes do kickoff informado, escreva "fonte conflitante/ignorada" e não afirme o fato.
- Quando mencionar lesões/suspensões/escalação, indique uma certeza: "confirmado pelo clube", "noticiado" ou "incerto". Nunca misture níveis de certeza na mesma afirmação.
- Não use Markdown.
- Responda exatamente 8 itens numerados, um por categoria, com 1-3 linhas cada.
- Em cada linha, marque CONFIANÇA: alta, média ou baixa.`;

function clean(v) {
  return v == null || v === '' ? null : String(v);
}

function buildWebContextCacheKey(match) {
  return [
    match?.home, match?.away, match?.liga, match?.date, match?.hora,
    match?.stadium ?? match?.venue, match?.rodada ?? match?.round,
  ].map((v) => clean(v)?.toLowerCase() ?? '').join('|');
}

function resolveCacheTtlMs(cacheTtlMs) {
  const raw = cacheTtlMs ?? process.env.SCOUT_WEB_CACHE_TTL_MS;
  if (raw == null) return DEFAULT_WEB_CACHE_TTL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_WEB_CACHE_TTL_MS;
}

export function clearWebContextCache() {
  webContextCache.clear();
}

function formatSonarMatchMeta(match) {
  const lines = [
    `- Jogo: ${match.home} x ${match.away}`,
    `- Competição/liga: ${match.liga}`,
    `- Data: ${match.date}${match.hora ? ` ${match.hora}` : ''}`,
  ];
  const temporada = match.temporada ?? match.season;
  const rodada = match.rodada ?? match.round;
  const stadium = match.stadium ?? match.venue;
  if (temporada) lines.push(`- Temporada: ${temporada}`);
  if (rodada) lines.push(`- Rodada: ${rodada}`);
  if (stadium) lines.push(`- Estádio: ${stadium}`);
  if (match.referee) lines.push(`- Árbitro: ${match.referee}`);
  if (match.weather) lines.push(`- Clima informado pelo motor: ${match.weather}`);
  if (match.venue_city) lines.push(`- Cidade do jogo: ${match.venue_city}`);
  if (match.home_city) lines.push(`- Cidade do mandante: ${match.home_city}`);
  if (match.away_city) lines.push(`- Cidade do visitante: ${match.away_city}`);
  return lines.join('\n');
}

function buildSonarQuery(match) {
  const { home, away, date } = match;
  const homePlace = match.home_city ?? match.venue_city ?? home;
  const awayPlace = match.away_city ?? away;
  return `DADOS ESTRUTURADOS DO MOTOR (use como âncora; não substitua por páginas genéricas):
${formatSonarMatchMeta(match)}

Pesquise APENAS contexto pré-jogo ou contexto atual verificável sobre este confronto.
Se encontrar página com placar/resultado/highlight antes de status final confirmado, ignore essa informação e marque como fonte conflitante.

Pesquise e responda CADA categoria abaixo sobre este jogo:

1. CLÁSSICO/RIVALIDADE — É derby? Intensidade emocional? [impacto: cartões, faltas]
2. STAKES — Situação na tabela. O que está em jogo? [impacto: intensidade, rotação]
3. DESFALQUES CONFIRMADOS — Lesões/suspensões (goleiro titular, artilheiro, armador). [impacto: gols]
4. ESCALAÇÃO / NOVIDADES — Retornos, pistas do técnico, rotação por Copa? [impacto: força real]
5. PRÓXIMO COMPROMISSO de ${home} e ${away} — competição, adversário, data; jogo decisivo em ≤4 dias? Time misto? [impacto CRÍTICO: rotação]
6. CLIMA EMOCIONAL / TROCA DE TÉCNICO — troca nas últimas 4 semanas? Crise interna? [impacto: imprevisível]
7. FATORES LOGÍSTICOS:
   a) DISTÂNCIA: ${homePlace} ↔ ${awayPlace}, km aproximados (curta<500 / média 500-1500 / longa>1500 / extrema>2500)
   b) CANSAÇO: último jogo do ${away} antes de ${date}, dias de descanso, foi pesado?
   c) TRIPLA RODADA: ${away} faz >2 jogos em 7 dias?
   d) CLIMA: temperatura/chuva prevista no local do jogo em ${date} (>30°C? chuva intensa?)
   e) ALTITUDE: local do jogo acima de 700m?
   [impacto: under gols/escanteios visitante, mandante favorecido]
8. ESTATÍSTICA MARCANTE — sequência relevante (invencibilidade, jejum, over/under recente).

Formato obrigatório: exatamente 8 itens numerados, sem Markdown, sem bullets extras.
Cada item: "N. CATEGORIA — fato útil ou sem informação; impacto; certeza/fonte curta; CONFIANÇA: alta|média|baixa".
Se não confirmar uma categoria, escreva "sem informação" e não explique longamente.
Responda em português, categoriado exatamente como acima.`;
}

export async function fetchWebContext(match, { timeoutMs, cacheTtlMs } = {}) {
  if (!process.env.PERPLEXITY_API_KEY) return null;
  const ms = Number(timeoutMs ?? process.env.SCOUT_WEB_TIMEOUT_MS ?? 15000);
  const resolvedCacheTtlMs = resolveCacheTtlMs(cacheTtlMs);
  const cacheKey = buildWebContextCacheKey(match);
  const cached = webContextCache.get(cacheKey);
  if (resolvedCacheTtlMs > 0 && cached && Date.now() - cached.created_at <= resolvedCacheTtlMs) {
    return cached.value;
  }
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
        max_tokens:       1100,
        temperature:      0.1,
        return_citations: true,
      }),
    }, ms);
    if (!res.ok) return null;
    const body = await res.json();
    const text = body?.choices?.[0]?.message?.content;
    if (!text) return null;
    const truncated = text.length > SONAR_MAX_CHARS ? text.slice(0, SONAR_MAX_CHARS) + '\n[truncado]' : text;
    const header = [match.home, 'x', match.away, '|', match.liga, '|', match.date, match.hora, match.stadium ?? match.venue].filter(Boolean).join(' ');
    const value = `=== INTELIGÊNCIA DE MERCADO (Perplexity Sonar) ===\n${header}\n\n${truncated}`;
    if (resolvedCacheTtlMs > 0) webContextCache.set(cacheKey, { created_at: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}

// ── Providers de análise com fallback ────────────────────────────────────────
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
    raw:    parseProviderJson(content, 'openai'),
    tokens: body.usage?.total_tokens ?? 0,
    ms:     Date.now() - t0,
  };
}

function parseProviderJson(content, provider) {
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error(`${provider}_empty`);
  }
  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(content.slice(start, end + 1));
      } catch {
        // continua para o erro final abaixo
      }
    }
    throw new Error(`${provider}_invalid_json`);
  }
}

function resolvePerplexityModel() {
  return process.env.SCOUT_PERPLEXITY_MODEL || SONAR_MODEL;
}

function resolveAnthropicModel() {
  return process.env.SCOUT_ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL || CLAUDE_MODEL_FALLBACK;
}

async function callPerplexity(systemPrompt, userPrompt, ms) {
  const t0 = Date.now();
  const res = await fetchTimeout(SONAR_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: resolvePerplexityModel(),
      temperature: 0.2,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt + JSON_SCHEMA_SUFFIX },
        { role: 'user', content: userPrompt },
      ],
    }),
  }, ms);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`perplexity_${res.status}:${text.slice(0, 160)}`);
  }
  const body = await res.json();
  const content = body?.choices?.[0]?.message?.content;
  return {
    model: resolvePerplexityModel(),
    raw: parseProviderJson(content, 'perplexity'),
    tokens: body?.usage?.total_tokens ?? 0,
    ms: Date.now() - t0,
  };
}

async function callAnthropic(systemPrompt, userPrompt, ms) {
  const t0 = Date.now();
  const res = await fetchTimeout(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: resolveAnthropicModel(),
      system: systemPrompt + JSON_SCHEMA_SUFFIX,
      max_tokens: 1024,
      temperature: 0.2,
      messages: [
        { role: 'user', content: userPrompt },
      ],
    }),
  }, ms);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`anthropic_${res.status}:${text.slice(0, 160)}`);
  }
  const body = await res.json();
  const content = Array.isArray(body?.content)
    ? body.content.filter((item) => item?.type === 'text').map((item) => item.text).join('\n')
    : '';
  return {
    model: resolveAnthropicModel(),
    raw: parseProviderJson(content, 'anthropic'),
    tokens: Number(body?.usage?.input_tokens ?? 0) + Number(body?.usage?.output_tokens ?? 0),
    ms: Date.now() - t0,
  };
}

function listScoutProviders() {
  const providers = [];
  if (process.env.OPENAI_API_KEY) providers.push({ name: 'openai', call: callOpenAI });
  if (process.env.PERPLEXITY_API_KEY) providers.push({ name: 'perplexity', call: callPerplexity });
  if (process.env.ANTHROPIC_API_KEY) providers.push({ name: 'anthropic', call: callAnthropic });
  return providers;
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

function capScoutScore(validated, topSlots) {
  if (validated.scout_score == null) return validated;
  const confidences = (topSlots ?? [])
    .map((slot) => Number(slot.confidence))
    .filter((value) => Number.isFinite(value));
  const top3 = confidences.slice(0, 3);
  const redFlags = validated.red_flags ?? [];
  let cap = 100;

  if (top3.length > 0 && top3.every((confidence) => confidence < 0.30)) cap = Math.min(cap, 59);
  if (confidences.length > 0 && confidences.every((confidence) => confidence < 0.40)) cap = Math.min(cap, 65);
  if (redFlags.some((flag) => flag.severity === 'high')) cap = Math.min(cap, 59);
  if (redFlags.filter((flag) => flag.severity === 'medium').length >= 2) cap = Math.min(cap, 59);
  if (redFlags.filter((flag) => flag.severity === 'high').length >= 2) cap = Math.min(cap, 34);

  return { ...validated, scout_score: Math.min(validated.scout_score, cap) };
}

function emptyOverlay({ skip_reason, latency_ms = 0, tokens_used = 0, model = null, web_context_used = false }) {
  return { model, latency_ms, tokens_used, red_flags: [], narrative: null, scout_score: null, web_context_used, skip_reason };
}

// ── Main export ───────────────────────────────────────────────────────────────
/**
 * runScout — SCOUT IA opt-in.
 * Arquitetura: Perplexity Sonar (web context opcional) → GPT-4o → Perplexity → Claude.
 * Retorna ScoutOverlay | null.
 * null quando options.scout !== true (zero latência adicionada).
 */
export async function runScout({ slots, evidence, matchContext, evRanked, options }) {
  if (options?.scout !== true) return null;

  const startedAt = Date.now();
  const timeoutMs = Number(process.env.SCOUT_TIMEOUT_MS ?? 20000);
  const ctx       = buildContext({ slots, evidence, matchContext, evRanked });

  if (!ctx.topSlots.length) {
    return emptyOverlay({ skip_reason: 'no_eligible_slots' });
  }

  const providers = listScoutProviders();
  if (!providers.length) {
    return emptyOverlay({ skip_reason: 'no_provider_configured' });
  }

  // Fase 1: enriquecimento web (opcional, não-bloqueante).
  // options.scout_web === false desativa explicitamente.
  let webContext = null;
  if (options.scout_web !== false && matchContext) {
    webContext = await fetchWebContext(matchContext);
  }
  ctx.webContext = webContext;

  // Fase 2: análise LLM com fallback em ordem fixa.
  const userPrompt  = buildPrompt(ctx);
  const allowedKeys = ctx.topSlots.map((s) => s.market_key);

  for (const provider of providers) {
    try {
      const result = await provider.call(SYSTEM_PROMPT, userPrompt, timeoutMs);
      const validated = capScoutScore(validateOverlay(result.raw, allowedKeys), ctx.topSlots);
      return {
        model: result.model,
        latency_ms: Date.now() - startedAt,
        tokens_used: result.tokens,
        web_context_used: !!webContext,
        ...validated,
        skip_reason: null,
      };
    } catch {
      // tenta o próximo provider configurado
    }
  }

  return emptyOverlay({
    skip_reason: 'all_providers_failed',
    latency_ms: Date.now() - startedAt,
    web_context_used: !!webContext,
  });
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
