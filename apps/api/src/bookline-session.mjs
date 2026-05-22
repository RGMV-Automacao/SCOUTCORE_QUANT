// Bookline (Superbet) — singleton Playwright session.
// Porta `launchSession` + `ensureLoggedIn` + `refreshAntifraudToken` + `extractSessionId`
// do legado `ApolloFinalV2/bot/{superbet-core,api-submitter}.mjs`, adaptado para servir
// o submitter da API. Mantém um único browser/context/page vivo no processo da API
// para preservar o cookie `sb-production-token` e o token antifraud entre submits.
//
// Habilitado quando `BOOKLINE_SUBMIT_VIA_BROWSER=true` (default true se as credenciais
// existirem). Quando desabilitado ou Playwright não estiver instalado, o submitter
// faz fallback para `fetch` direto usando `BOOKLINE_SESSIONID`/`BOOKLINE_COOKIE`.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';

const SITE = 'https://superbet.bet.br';
const DEFAULT_STORAGE = resolve(process.cwd(), 'data', '.bookline-session.json');
const USER_AGENT_CTX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

function envFlag(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw));
}

function getCredentials() {
  return {
    user: process.env.BOOKLINE_EMAIL || process.env.BOOKLINE_USERNAME || process.env.SB_EMAIL || process.env.SB_USERNAME || null,
    pass: process.env.BOOKLINE_PASSWORD || process.env.BOOKLINE_PASS || process.env.SB_PASSWORD || process.env.SB_PASS || null,
  };
}

function getStorageStatePath() {
  const envPath = process.env.BOOKLINE_STORAGE_STATE;
  if (!envPath) return DEFAULT_STORAGE;
  return isAbsolute(envPath) ? envPath : resolve(process.cwd(), envPath);
}

export function isBrowserSubmitEnabled() {
  const creds = getCredentials();
  const explicit = process.env.BOOKLINE_SUBMIT_VIA_BROWSER;
  if (explicit != null && explicit !== '') return envFlag('BOOKLINE_SUBMIT_VIA_BROWSER', false);
  // default: ligado se credenciais ou storage state existirem
  return Boolean(creds.user && creds.pass) || existsSync(getStorageStatePath());
}

let _state = null; // { browser, context, page, sessionFile, sessionidCache, sessionidCachedAt }
let _launching = null; // promise dedup

async function loadChromium() {
  try {
    const mod = await import('playwright');
    return mod.chromium;
  } catch (err) {
    const e = new Error(`playwright_not_installed:${err?.message || err}`);
    e.code = 'PLAYWRIGHT_MISSING';
    throw e;
  }
}

async function launchInternal() {
  const chromium = await loadChromium();
  const sessionFile = getStorageStatePath();
  mkdirSync(dirname(sessionFile), { recursive: true });

  const headless = envFlag('BOOKLINE_HEADLESS', true);
  const launchOptions = {
    args: ['--disable-blink-features=AutomationControlled'],
    headless,
  };
  const browser = await chromium.launch(launchOptions);

  const contextOptions = {
    viewport: { width: 1440, height: 900 },
    userAgent: USER_AGENT_CTX,
    locale: 'pt-BR',
    geolocation: { latitude: -23.5505, longitude: -46.6333 },
    permissions: ['geolocation'],
  };
  if (existsSync(sessionFile)) contextOptions.storageState = sessionFile;

  const context = await browser.newContext(contextOptions);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const page = await context.newPage();
  return { browser, context, page, sessionFile };
}

async function saveSession(context, sessionFile) {
  try {
    const state = await context.storageState();
    writeFileSync(sessionFile, JSON.stringify(state, null, 2), 'utf8');
  } catch { /* best effort */ }
}

async function isLoggedIn(page, context) {
  const hasCookie = (await context.cookies().catch(() => [])).some((c) => c.name === 'sb-production-token');
  const uiState = await page.evaluate(() => {
    const hasLoginBtn = Array.from(document.querySelectorAll('a, button')).some((el) => {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const rect = el.getBoundingClientRect();
      return /^(entrar|registre-se)$/i.test(t) && rect.width > 0 && rect.height > 0;
    });
    const hasDeposit = /depositar/i.test(document.body.innerText || '');
    const hasMyBets = !!document.querySelector('a.e2e-nav-my-bets, a[href*="/minhas-apostas"]');
    let hasUserId = false;
    try {
      const raw = localStorage.getItem('user');
      const u = raw ? JSON.parse(raw) : null;
      hasUserId = !!(u?.value?.userId || u?.userId);
    } catch { hasUserId = false; }
    return { hasLoginBtn, hasDeposit, hasMyBets, hasUserId };
  }).catch(() => ({ hasLoginBtn: true, hasDeposit: false, hasMyBets: false, hasUserId: false }));

  if (!uiState.hasUserId) return false;
  if (hasCookie && (uiState.hasDeposit || uiState.hasMyBets) && !uiState.hasLoginBtn) return true;
  if (!uiState.hasLoginBtn && (uiState.hasDeposit || uiState.hasMyBets)) return true;
  if (hasCookie && !uiState.hasLoginBtn) return true;
  return false;
}

async function acceptCookies(page) {
  try {
    const btn = await page.$('button:has-text("Aceitar"), button:has-text("Aceito"), button:has-text("Concordar"), button[aria-label*="Aceitar" i]');
    if (btn) {
      await btn.click({ force: true }).catch(() => null);
      await page.waitForTimeout(500);
    }
  } catch { /* ignore */ }
}

async function closeBlockingOverlays(page) {
  try {
    const closers = await page.$$('button[aria-label*="Fechar" i], button[aria-label*="Close" i], [data-testid*="close" i], button:has-text("×")');
    for (const el of closers.slice(0, 3)) {
      await el.click({ force: true }).catch(() => null);
      await page.waitForTimeout(200);
    }
  } catch { /* ignore */ }
}

async function fillLoginForm(page, creds) {
  try {
    const userInput = await page.waitForSelector(
      'input[name="username"], input[name="email"], input[type="email"], #username-0',
      { state: 'visible', timeout: 12000 },
    );
    const passwordInput = await page.waitForSelector(
      'input[name="password"], input[type="password"]',
      { state: 'visible', timeout: 8000 },
    );
    await userInput.click({ force: true });
    await userInput.fill('');
    await page.waitForTimeout(200);
    await userInput.type(creds.user, { delay: 45 });
    await page.waitForTimeout(500);
    await passwordInput.click({ force: true });
    await passwordInput.fill('');
    await page.waitForTimeout(200);
    await passwordInput.type(creds.pass, { delay: 45 });
    await page.waitForTimeout(600);
    const submitBtn = await page.$('button[type="submit"]') ?? await page.$('button:has-text("Entrar")');
    if (submitBtn) {
      await submitBtn.scrollIntoViewIfNeeded().catch(() => null);
      await page.waitForTimeout(300);
      await submitBtn.click({ force: true });
    } else {
      await page.keyboard.press('Enter').catch(() => null);
    }
    await page.waitForTimeout(4500);
    return true;
  } catch {
    return false;
  }
}

async function loginViaRoute(page, creds) {
  await page.goto(`${SITE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
  await page.waitForTimeout(2500);
  await acceptCookies(page);
  return fillLoginForm(page, creds);
}

async function loginInNewTab(context, creds) {
  const tab = await context.newPage();
  try {
    const ok = await loginViaRoute(tab, creds);
    if (!ok) return false;
    await tab.waitForTimeout(1500);
    return await isLoggedIn(tab, context);
  } finally {
    await tab.close().catch(() => null);
  }
}

async function ensureLoggedIn({ page, context, sessionFile }) {
  const creds = getCredentials();

  await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
  await page.waitForTimeout(1500);
  await acceptCookies(page);

  if (await isLoggedIn(page, context)) {
    await saveSession(context, sessionFile);
    return true;
  }

  const hasCookie = (await context.cookies().catch(() => [])).some((c) => c.name === 'sb-production-token');
  if (hasCookie) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
    await page.waitForTimeout(2000);
    if (await isLoggedIn(page, context)) {
      await saveSession(context, sessionFile);
      return true;
    }
  }

  if (!creds.user || !creds.pass) {
    throw new Error('bookline_credentials_missing: defina BOOKLINE_EMAIL e BOOKLINE_PASSWORD ou forneça BOOKLINE_STORAGE_STATE válido');
  }

  // Estratégia 1: clicar em "Entrar" na home e preencher modal
  try {
    await closeBlockingOverlays(page);
    const loginButton = await page.$('button:has-text("Entrar"), a:has-text("Entrar")');
    if (loginButton) {
      await loginButton.scrollIntoViewIfNeeded().catch(() => null);
      await loginButton.click({ force: true }).catch(() => null);
      await page.waitForTimeout(1200);
      const formOk = await fillLoginForm(page, creds);
      if (formOk && (await isLoggedIn(page, context))) {
        await saveSession(context, sessionFile);
        return true;
      }
    }
  } catch { /* fallthrough */ }

  // Estratégia 2: nova tab em /login
  try {
    const ok = await loginInNewTab(context, creds);
    if (ok) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
      await page.waitForTimeout(2000);
      if (await isLoggedIn(page, context)) {
        await saveSession(context, sessionFile);
        return true;
      }
    }
  } catch { /* fallthrough */ }

  // Estratégia 3: própria page em /login
  const routeOk = await loginViaRoute(page, creds);
  if (routeOk && (await isLoggedIn(page, context))) {
    await saveSession(context, sessionFile);
    if (/\/login/i.test(page.url())) {
      await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
    }
    return true;
  }

  throw new Error('bookline_login_failed_after_submit');
}

/**
 * Força regeneração do antifraud token (porta de api-submitter.mjs#refreshAntifraudToken).
 * @returns {Promise<boolean>} true se token >=1000 chars apareceu em algum storage candidato.
 */
export async function refreshAntifraudToken(page, { force = true, timeoutMs = 30000 } = {}) {
  if (force) {
    await page.evaluate(() => {
      try {
        localStorage.removeItem('antifraud:session');
        localStorage.removeItem('antifraud:sessionId');
        sessionStorage.removeItem('_sbaSessionId');
      } catch { /* ignore */ }
    }).catch(() => null);
  }

  const url = page.url();
  if (!/superbet\.bet\.br\/apostas\//.test(url)) {
    await page.goto(`${SITE}/apostas/futebol/`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
  } else {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const probe = await page.evaluate(() => {
      const tryParse = (v) => { try { return JSON.parse(v); } catch { return v; } };
      const candidateKeys = ['antifraud:session', 'antifraud:sessionId', '_sbaSessionId', '_sbaSession'];
      let best = { key: null, len: 0 };
      for (const k of candidateKeys) {
        const raw = localStorage.getItem(k) || sessionStorage.getItem(k);
        if (!raw) continue;
        const parsed = tryParse(raw);
        const val = typeof parsed === 'string' ? parsed : (parsed?.value || parsed?.sessionId || '');
        const len = (val || '').length;
        if (len > best.len) best = { key: k, len };
      }
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || /^(user|store|cachedPing|sports::|PersistentDataQueue|experiment-engagement|gss|superSocialUserToken|_fs_)/.test(k)) continue;
        const raw = localStorage.getItem(k);
        if (!raw || raw.length < 1000) continue;
        if (raw.length > best.len) best = { key: k, len: raw.length };
      }
      return best;
    }).catch(() => ({ key: null, len: 0 }));
    if (probe.len >= 1000) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

/**
 * Extrai sessionid no formato `${antifraud}|${userId}` (porta de api-submitter.mjs#extractSessionId).
 * @returns {Promise<string|null>} sessionid pronto para o header, ou null se faltar userId.
 */
export async function extractSessionId(page) {
  if (!page.url().startsWith(SITE)) {
    await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(2000);
  }

  const refreshed = await refreshAntifraudToken(page, { force: true, timeoutMs: 45000 });
  if (!refreshed) {
    // segue mesmo sem token forte; quem decide é a API.
  }

  const sid = await page.evaluate(() => {
    const tryParse = (v) => { try { return JSON.parse(v); } catch { return v; } };
    const NAMED_KEYS = ['antifraud:session', 'antifraud:sessionId', '_sbaSessionId', '_sbaSession'];
    let antiValue = '';
    let antiKey = null;
    for (const k of NAMED_KEYS) {
      const raw = localStorage.getItem(k) || sessionStorage.getItem(k);
      if (!raw) continue;
      const parsed = tryParse(raw);
      const v = typeof parsed === 'string' ? parsed : (parsed?.value || parsed?.sessionId || '');
      if ((v || '').length > antiValue.length) { antiValue = v; antiKey = k; }
    }
    const SKIP = /^(user|store|cachedPing|sports::|PersistentDataQueue|experiment-engagement|gss|superSocialUserToken|lastSuccessfulGeoVault|xtremepush|_fs_)/;
    const long = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || SKIP.test(k)) continue;
      const raw = localStorage.getItem(k);
      if (!raw || raw.length < 800) continue;
      long.push({ key: k, len: raw.length });
    }
    long.sort((a, b) => b.len - a.len);
    if (!antiValue && long.length) {
      const top = long[0];
      const raw = localStorage.getItem(top.key);
      const parsed = tryParse(raw);
      antiValue = typeof parsed === 'string' ? parsed : (parsed?.value || parsed?.sessionId || raw || '');
      antiKey = top.key;
    }
    const userRaw = localStorage.getItem('user');
    const user = tryParse(userRaw);
    const userId = user?.value?.userId || user?.userId || null;
    let s = antiValue || '';
    if (s && userId && !s.includes('|')) s = `${s}|${userId}`;
    return { sid: s || null, userId, antiLen: (antiValue || '').length, antiKey };
  });

  if (!sid.userId) return null;
  return sid.sid || `|${sid.userId}`;
}

async function bootstrap() {
  const st = await launchInternal();
  try {
    await ensureLoggedIn(st);
  } catch (err) {
    await st.browser.close().catch(() => null);
    throw err;
  }
  _state = { ...st, sessionidCache: null, sessionidCachedAt: 0 };
  return _state;
}

/** Garante uma sessão Playwright logada e retorna `{ page, context, browser, getSessionId }`. */
export async function getBooklineSession() {
  if (_state?.page && !_state.page.isClosed?.()) return _state;
  if (_launching) return _launching;
  _launching = bootstrap().finally(() => { _launching = null; });
  return _launching;
}

/**
 * Devolve um sessionid fresco (cache curto para não rotacionar a cada submit).
 * TTL configurável via BOOKLINE_SESSIONID_TTL_MS (default 25_000).
 */
export async function ensureBooklineSessionId({ force = false } = {}) {
  const ttl = Math.max(5_000, Number(process.env.BOOKLINE_SESSIONID_TTL_MS || 25_000));
  const state = await getBooklineSession();
  const now = Date.now();
  if (!force && state.sessionidCache && (now - state.sessionidCachedAt) < ttl) {
    return state.sessionidCache;
  }
  // Antes de extrair, valida login — se cookie caiu, refaz login.
  const stillLogged = await isLoggedIn(state.page, state.context).catch(() => false);
  if (!stillLogged) {
    await ensureLoggedIn(state).catch(() => null);
  }
  const sid = await extractSessionId(state.page);
  if (sid) {
    state.sessionidCache = sid;
    state.sessionidCachedAt = now;
  }
  return sid;
}

/**
 * Invalida cache de sessionid e força regeneração de antifraud na próxima chamada.
 * Usar quando a Superbet retornar `sessionNotValid`/401.
 */
export async function invalidateBooklineSession() {
  if (!_state) return;
  _state.sessionidCache = null;
  _state.sessionidCachedAt = 0;
  try {
    await _state.page?.evaluate?.(() => {
      try {
        localStorage.removeItem('antifraud:session');
        localStorage.removeItem('antifraud:sessionId');
        sessionStorage.removeItem('_sbaSessionId');
        sessionStorage.removeItem('_sbaSession');
      } catch { /* ignore */ }
    });
  } catch { /* ignore */ }
}

/** Fecha a sessão e libera o browser. Idempotente. */
export async function closeBooklineSession() {
  if (!_state) return;
  const { browser, context, sessionFile } = _state;
  try { if (context) await saveSession(context, sessionFile); } catch { /* ignore */ }
  try { await browser?.close(); } catch { /* ignore */ }
  _state = null;
}
