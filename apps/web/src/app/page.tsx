"use client";

import { useState, useCallback, useRef, useEffect, Fragment } from "react";
import {
  Play, Settings, TrendingUp, Grid, ShieldAlert, Cpu, CheckCircle,
  Activity, LayoutGrid, Zap, History, Search, Database, Eye,
  ChevronDown, ChevronRight, Download, RefreshCw, Trash2,
  Loader2, AlertTriangle, Clock, CheckCircle2, Radio,
  Wallet, Ticket, Brain, Layers3, Swords, ArrowUpRight, Target, Sparkles,
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4040";
const YANKEE_OVERRIDES = {};

// ── Visual tokens (apollo-turbo) ──────────────────────────────────────────────
const PANEL =
  "relative rounded-2xl border border-emerald-500/30 bg-[linear-gradient(135deg,rgba(12,53,43,0.96)_0%,rgba(23,30,30,0.97)_48%,rgba(30,35,35,0.96)_100%)] shadow-[0_20px_44px_rgba(0,0,0,0.34)]";
const CARD =
  "relative rounded-xl border border-emerald-500/18 bg-[linear-gradient(180deg,rgba(32,36,36,0.98)_0%,rgba(28,32,32,0.99)_100%)] shadow-[0_10px_22px_rgba(0,0,0,0.22)]";
const SOFT_CARD =
  "rounded-xl border border-emerald-500/18 bg-[linear-gradient(180deg,rgba(13,42,35,0.72)_0%,rgba(20,27,27,0.94)_100%)]";
const TABLE_SHELL =
  "overflow-x-auto rounded-xl border border-emerald-500/18 bg-[linear-gradient(180deg,rgba(12,35,31,0.74)_0%,rgba(18,24,24,0.96)_100%)]";
const TABLE_HEAD = "bg-emerald-950/25";
const TABLE_HEAD_ROW = "text-white/45 border-b border-emerald-500/15";
const TABLE_ROW = "border-b border-emerald-500/10 hover:bg-emerald-500/10 transition-colors";
const SUBTLE_BUTTON =
  "border border-emerald-500/25 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/18";

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

const fmtRunSeq = (run: any) =>
  run?.run_label || (run?.run_seq ? `RUN #${String(run.run_seq).padStart(4, "0")}` : "RUN sem seq");

const fmtRunCreatedAt = (createdAt: string | null | undefined) => {
  if (!createdAt) return "sem horário";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "horário inválido";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const runShortId = (runId: string | null | undefined) =>
  runId ? runId.split("-").at(-1)?.slice(0, 12) || runId.slice(-12) : "sem-id";

const runDisplayLabel = (run: any) =>
  `${fmtRunSeq(run)} · ${fmtRunCreatedAt(run?.created_at)} · ${run?.date_start ?? "?"}→${run?.date_end ?? "?"} · ${run?.matches ?? 0} jogos · ${run?.slots ?? 0} slots`;

// ── Pipeline stages (Apollo Turbo, 11 cards) ──────────────────────────────────
const PIPELINE_STAGES = [
  { id: 1,  label: "Jogos",     icon: Wallet },
  { id: 2,  label: "Motor A·B", icon: Cpu },
  { id: 3,  label: "Curinga",   icon: Sparkles },
  { id: 4,  label: "Scout IA",  icon: Brain, optIn: true },
  { id: 5,  label: "Combine",   icon: Layers3 },
  { id: 6,  label: "Validar",   icon: ShieldAlert },
  { id: 7,  label: "Board",     icon: Swords },
  { id: 8,  label: "Yankee",    icon: Ticket },
  { id: 9,  label: "Singles",   icon: Target },
  { id: 10, label: "Submit",    icon: ArrowUpRight },
  { id: 11, label: "Resolver",  icon: CheckCircle2 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtElapsed = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

const fmtPct = (v: number | null | undefined) =>
  v == null ? "—" : `${(v * 100).toFixed(1)}%`;

// edge_pct vem do backend já em pontos percentuais (ex: 11.51 = 11.51%).
// Não multiplicar por 100 — fmtPct é para frações [0..1].
const fmtEdge = (v: number | null | undefined) =>
  v == null ? "—" : `${v.toFixed(1)}%`;

const fmtValidationScope = (scope: string | null | undefined) => {
  if (scope === "local_board_plus_superbet_catalog") return "Board local + catálogo/quote público da Superbet";
  if (scope === "local_board_only") return "Somente board local";
  return "Escopo indisponível";
};

const fmtValidationReason = (reason: string | null | undefined) => {
  if (!reason) return "Falha não classificada";
  if (reason.startsWith("price_drift_combo:")) {
    return `Drift de preço do combo (${reason.replace("price_drift_combo:", "")})`;
  }
  if (reason.startsWith("quote_inactive:")) {
    return `Quote inativa (${reason.replace("quote_inactive:", "")})`;
  }
  if (reason === "market_or_selection_missing_in_superbet") return "Mercado ou seleção ausente na Superbet";
  if (reason === "event_id_unresolved") return "Evento não localizado na Superbet";
  if (reason === "unmapped_in_motor_catalog") return "Mercado sem mapeamento no catálogo do motor";
  if (reason === "mapped_but_invalid_line") return "Linha inválida no mapeamento do motor";
  if (reason === "slot_metadata_missing") return "Metadados do slot ausentes no run";
  return reason;
};

function uniqueValidationGaps(items: any[] = []) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item?.match_id ?? "-"}|${item?.reason ?? "-"}|${item?.market_key ?? "-"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type ThemedSelectOption = {
  value: string;
  label: string;
};

function ThemedSelect({
  value,
  options,
  onChange,
  ariaLabel,
  className = "",
  buttonClassName = "",
  listClassName = "",
}: {
  value: string;
  options: ThemedSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  buttonClassName?: string;
  listClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border border-emerald-500/34 bg-[linear-gradient(135deg,rgba(8,38,32,0.96)_0%,rgba(12,18,18,0.98)_100%)] px-2.5 py-1.5 text-left text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-colors hover:border-emerald-400/60 hover:bg-emerald-500/10 focus:outline-none focus:border-emerald-300 ${buttonClassName}`}
      >
        <span className="truncate">{selected?.label ?? "Selecionar"}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-emerald-300 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          role="listbox"
          className={`absolute left-0 right-0 z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border border-emerald-500/35 bg-[linear-gradient(180deg,rgba(9,40,34,0.98)_0%,rgba(12,18,18,0.99)_100%)] p-1 text-white shadow-[0_22px_48px_rgba(0,0,0,0.62)] ring-1 ring-emerald-400/10 ${listClassName}`}
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value || "__empty"}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${
                  isSelected
                    ? "bg-emerald-500/20 text-emerald-100"
                    : "text-white/80 hover:bg-emerald-500/10 hover:text-white"
                }`}
              >
                <span className="truncate">{option.label}</span>
                {isSelected && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Pretty market label (Superbet-style) ──────────────────────────────────────
// Usa rótulos vindos do provedor (provenance.odd.mercado/selecao ou sb_market/sb_selection).
// Faz fallback determinístico a partir de market_key/family/direction/line/scope/period.
const FAMILY_PT: Record<string, string> = {
  gols: "Total de Gols",
  btts: "Ambas Marcam",
  escanteios: "Total de Escanteios",
  cartoes: "Total de Cartões",
  chutes: "Total de Chutes",
  chutes_no_gol: "Total de Chutes no Gol",
  finalizacoes: "Total de Finalizações",
  faltas: "Total de Faltas",
  impedimentos: "Total de Impedimentos",
  resultado: "Resultado",
  dnb: "Aposta Sem Empate",
  htft: "Intervalo / Final",
  asian_total: "Total Asiático",
  dupla: "Dupla Chance",
  handicap: "Handicap",
};

function prettyMarket(leg: any, ctx?: { home?: string; away?: string }) {
  // 1) labels diretos vindos do backend
  const mercado = leg?.sb_market ?? leg?.provenance?.odd?.mercado ?? null;
  const selecao = leg?.sb_selection ?? leg?.provenance?.odd?.selecao ?? null;
  if (mercado && selecao) return `${mercado} · ${selecao}`;

  // 2) reconstrução a partir do market_key
  const fam = (leg?.family ?? "").toString();
  const dir = (leg?.direction ?? "").toString();
  const line = leg?.line;
  const scope = (leg?.scope ?? "").toString();
  const period = (leg?.period ?? "").toString();
  const key = (leg?.market_key ?? leg?.key ?? "").toString();
  // detectar scope/period via key se não vierem explícitos
  const inferScope = scope || (key.includes("_home_") ? "home" : key.includes("_away_") ? "away" : "total");
  const inferPeriod = period || (key.includes("_ht_") ? "HT" : key.includes("_2t_") ? "2T" : "FT");

  const periodPref = inferPeriod === "HT" || inferPeriod === "1T" ? "1º Tempo - " : inferPeriod === "2T" ? "2º Tempo - " : "";
  const familyBase = FAMILY_PT[fam] ?? fam;
  let mercadoStr = `${periodPref}${familyBase}`;
  if (inferScope === "home" || inferScope === "away") {
    const teamName = inferScope === "home" ? ctx?.home : ctx?.away;
    mercadoStr += teamName ? ` de ${teamName}` : " da Equipe";
  }

  let selecaoStr: string;
  if (dir === "over" || dir === "mais") selecaoStr = line != null ? `Mais de ${line}` : "Mais";
  else if (dir === "under" || dir === "menos") selecaoStr = line != null ? `Menos de ${line}` : "Menos";
  else if (dir === "sim") selecaoStr = "Sim";
  else if (dir === "nao" || dir === "não") selecaoStr = "Não";
  else if (dir === "home") selecaoStr = ctx?.home ?? "Mandante";
  else if (dir === "away") selecaoStr = ctx?.away ?? "Visitante";
  else if (dir === "draw" || dir === "empate") selecaoStr = "Empate";
  else selecaoStr = dir || (line != null ? String(line) : "—");

  return `${mercadoStr} · ${selecaoStr}`;
}

const tier = (conf: number | null | undefined): string => {
  if (conf == null) return "—";
  if (conf >= 0.82) return "A";
  if (conf >= 0.72) return "B";
  return "C";
};

function buildDuplas(picks: any[]) {
  const byMatch = new Map<string, any[]>();
  for (const p of picks) {
    const key = p.match_id ?? `${p.home}_${p.away}`;
    if (!byMatch.has(key)) byMatch.set(key, []);
    byMatch.get(key)!.push(p);
  }
  const out: any[] = [];
  for (const [, legs] of byMatch) {
    const sorted = [...legs].sort((a, b) => (b.edge_pct ?? 0) - (a.edge_pct ?? 0));
    if (sorted.length < 2) continue;
    const [a, b] = sorted;
    // Evitar dupla com mesma família (sem valor de diversificação)
    if (a.family && a.family === b.family) continue;
    out.push({
      home: a.home ?? "—", away: a.away ?? "—", liga: a.liga ?? "—",
      match_id: a.match_id,
      leg_a: { key: a.market_key ?? "—", odd: a.market_odd ?? 1, edge: a.edge_pct ?? 0, family: a.family },
      leg_b: { key: b.market_key ?? "—", odd: b.market_odd ?? 1, edge: b.edge_pct ?? 0, family: b.family },
      combo_odd: +((a.market_odd ?? 1) * (b.market_odd ?? 1)).toFixed(2),
      avg_edge:  +(((a.edge_pct ?? 0) + (b.edge_pct ?? 0)) / 2).toFixed(4),
    });
  }
  return out.sort((a, b) => b.avg_edge - a.avg_edge);
}

function avgQualityScore(combos: any[]): string | null {
  if (!combos.length) return null;
  return (combos.reduce((s, c) => s + (c.quality_score ?? 0), 0) / combos.length).toFixed(2);
}

// ── Settle visual helpers (badge green/red + valor real) ─────────────────────
// Mostra `predito X · real Y → ✓/✗` em todas as telas onde aparece mercado.
// Backend popula `result` ('green'|'red'|null) e `actual_value` (number|null)
// em cada leg/pick (via enrichWithSettlement em apps/api/.../strategies.mjs).
function fmtPredLine(leg: any): string | null {
  const line = leg?.line;
  const dir = String(leg?.direction ?? "").toLowerCase();
  if (line != null && (dir === "over" || dir === "under" || dir === "mais" || dir === "menos")) {
    const pref = dir === "over" || dir === "mais" ? ">" : "<";
    return `${pref}${line}`;
  }
  if (line != null) return String(line);
  return null;
}

function ResultBadge({
  result,
  actual,
  leg,
  size = "sm",
  showActual = true,
}: {
  result?: "green" | "red" | null;
  actual?: number | null;
  leg?: any;
  size?: "xs" | "sm";
  showActual?: boolean;
}) {
  const px = size === "xs" ? "px-1.5 py-0" : "px-2 py-0.5";
  const fz = size === "xs" ? "text-[10px]" : "text-[11px]";
  if (result === "green" || result === "red") {
    // Paleta legado FutMaxStats: pill sólido, borda saturada, texto bem brilhante.
    const cls = result === "green"
      ? "bg-emerald-600/35 border-emerald-400 text-emerald-100"
      : "bg-rose-600/35 border-rose-400 text-rose-100";
    const icon = result === "green" ? "✓" : "X";
    const lbl = result === "green" ? "GREEN" : "RED";
    const predTxt = leg ? fmtPredLine(leg) : null;
    const realTxt = (showActual && actual != null && Number.isFinite(actual)) ? `real ${actual}` : null;
    const tip = [predTxt && `pred ${predTxt}`, realTxt].filter(Boolean).join(" · ");
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md border font-bold font-mono whitespace-nowrap ${cls} ${px} ${fz}`}
        title={tip || lbl}
      >
        <span className="leading-none">{icon}</span>
        <span>{lbl}</span>
        {realTxt && <span className="font-normal opacity-95 ml-0.5">· {realTxt}</span>}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border bg-amber-600/25 border-amber-400/70 text-amber-100 font-bold font-mono ${px} ${fz}`}
      title="pendente"
    >
      <span className="leading-none">O</span>
      <span>PEND</span>
    </span>
  );
}

// Agrega resultado de várias legs num único veredito de confronto.
// all green → GREEN; qualquer red → RED; senão PEND.
function aggregateLegsResult(legs: any[] | undefined | null): {
  status: "GREEN" | "RED" | "PEND";
  greens: number;
  reds: number;
  total: number;
} {
  const arr = Array.isArray(legs) ? legs : [];
  const total = arr.length;
  const greens = arr.filter((l) => l?.result === "green").length;
  const reds = arr.filter((l) => l?.result === "red").length;
  let status: "GREEN" | "RED" | "PEND";
  if (reds > 0) status = "RED";
  else if (greens > 0 && greens === total) status = "GREEN";
  else status = "PEND";
  return { status, greens, reds, total };
}

// Formata duração curta estilo apollo-turbo (0ms / 1.8s / 58.9s / 2m41s)
const fmtStageDur = (ms: number | null | undefined): string => {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s - m * 60);
  return `${m}m${String(rs).padStart(2, "0")}s`;
};

// Próximo domingo (cobre fim de semana). Se hoje já é domingo, usa hoje mesmo.
function defaultRange(): { start: string; end: string } {
  const now  = new Date();
  const dow  = now.getDay();           // 0=dom, 5=sex, 6=sab
  const addEnd = dow === 0 ? 0 : dow <= 5 ? (7 - dow) : 1; // sex→2 (dom), sab→1, dom→0
  const end  = new Date(now.getTime() + addEnd * 86400000);
  const fmt = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  return { start: fmt(now), end: fmt(end) };
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ScoutCorePage() {
  const _defaults = defaultRange();

  // Form
  const [startDate, setStartDate] = useState(_defaults.start);
  const [endDate,   setEndDate]   = useState(_defaults.end);

  // Navigation
  const [activeTab, setActiveTab] = useState("execucao");

  // Global error
  const [error, setError] = useState<string | null>(null);

  // Modo simulação — block real submit (deixar pronto sem apostar)
  const [simulationMode, setSimulationMode] = useState(true);

  // Pipeline
  const [loading,          setLoading]          = useState(false);
  const [pipelinePhase,    setPipelinePhase]     = useState<"idle"|"running"|"done"|"error">("idle");
  const [pipelineProgress, setPipelineProgress]  = useState(0);
  const [elapsed,          setElapsed]           = useState(0);
  const [progress,         setProgress]          = useState<any>(null); // dados reais de /v1/runs/:id/progress
  const [stageDurations,   setStageDurations]    = useState<Record<number, number>>({});
  const stageStartRef = useRef<{ stage: number; startedAt: number } | null>(null);
  const elapsedTimer  = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pipelineLaunchGraceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef  = useRef<number | null>(null);

  // Run data
  const [runData,    setRunData]    = useState<any>(null);
  const [yankeeData, setYankeeData] = useState<any>(null);
  const [picksData,  setPicksData]  = useState<any>(null);
  const [duplasData, setDuplasData] = useState<any>(null);

  // Resolver
  const [settleResult,    setSettleResult]    = useState<any>(null);
  const [settleLoading,   setSettleLoading]   = useState(false);
  const [settleConfirm,   setSettleConfirm]   = useState(false);
  const [settleCountdown, setSettleCountdown] = useState<number | null>(null);
  const [dryRunResult,    setDryRunResult]    = useState<any>(null);
  const [dryRunLoading,   setDryRunLoading]   = useState(false);
  const [resolverActivity, setResolverActivity] = useState<any>(null);
  const settleTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Yankee submit (Bloco 3.4) — stake + dry-run + double-confirm 15s
  const [yankeeStake,         setYankeeStake]         = useState(3);
  const [yankeeDryRunResult,  setYankeeDryRunResult]  = useState<any>(null);
  const [yankeeDryRunLoading, setYankeeDryRunLoading] = useState(false);
  const [yankeeSubmitConfirm, setYankeeSubmitConfirm] = useState(false);
  const [yankeeSubmitCountdown, setYankeeSubmitCountdown] = useState<number | null>(null);
  const [yankeeSubmitLoading, setYankeeSubmitLoading] = useState(false);
  const [yankeeSubmitResult,  setYankeeSubmitResult]  = useState<any>(null);
  const [yankeeHover,         setYankeeHover]         = useState<any>(null);
  const yankeeSubmitTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Predictions table (Resolver)
  const [predsData,    setPredsData]    = useState<any>(null);
  const [predsLoading, setPredsLoading] = useState(false);

  // Agressivas — expandable rows
  const [expandedDuplas, setExpandedDuplas] = useState<Set<number>>(new Set());
  const [aggDuplasOpen, setAggDuplasOpen] = useState<boolean>(false);
  const [aggSinglesOpen, setAggSinglesOpen] = useState<boolean>(false);

  // Agressivas — filtros inteligentes
  const [aggSearch,    setAggSearch]    = useState<string>("");
  const [aggProduct,   setAggProduct]   = useState<"all" | "duplas" | "simples">("all");
  const [aggFamilies,  setAggFamilies]  = useState<Set<string>>(new Set());
  const [aggLigas,     setAggLigas]     = useState<Set<string>>(new Set());
  const [aggPeriod,    setAggPeriod]    = useState<"all" | "ft" | "ht" | "1t">("all");
  const [aggEdgeMin,   setAggEdgeMin]   = useState<number>(0);
  const [aggOddMin,    setAggOddMin]    = useState<number>(0);
  const [aggOddMax,    setAggOddMax]    = useState<number>(0);
  const [aggOnlyBoard, setAggOnlyBoard] = useState<boolean>(false);
  const [aggSort,      setAggSort]      = useState<"edge" | "odd_asc" | "odd_desc" | "ev">("edge");

  // Aprendizado
  const [calibData,    setCalibData]    = useState<any>(null);
  const [calibLoading, setCalibLoading] = useState(false);
  const [evalData,     setEvalData]     = useState<any>(null);

  // Resultados
  const [runsList,    setRunsList]    = useState<any[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [clearConfirm,    setClearConfirm]    = useState(false);

  // Cleanup timers on unmount
  useEffect(() => () => {
    if (settleTimer.current) clearInterval(settleTimer.current);
    if (elapsedTimer.current) clearInterval(elapsedTimer.current);
    if (progressTimer.current) clearInterval(progressTimer.current);
    if (pipelineLaunchGraceTimer.current) clearTimeout(pipelineLaunchGraceTimer.current);
    if (yankeeSubmitTimer.current) clearInterval(yankeeSubmitTimer.current);
  }, []);

  // ── Pipeline progress mapping ────────────────────────────────────────────────
  // Backend reporta { phase, sub_phase, matches_done, total_matches, slots_built, current_match }.
  // Mapeamos para a barra de 11 estágios SEM inventar dados:
  //  • discover/lookups → Jogos
  //  • engine_a/engine_b → Motor A·B
  //  • curinga/evidence_gates/ev_rank → cards certificados do board
  //  • persisting/done → predição concluída; Submit/Resolver só avançam em ações reais
  const SUB_PHASE_STAGE: Record<string, number> = {
    lookups: 1,
    engine_a: 2,
    engine_b: 2,
    curinga: 3,
    evidence_gates: 6,
    ev_rank: 7,
  };
  const phaseToProgress = (p: any): number => {
    if (!p) return 0;
    switch (p.phase) {
      case 'discover':   return 1;
      case 'predicting': return SUB_PHASE_STAGE[p.sub_phase ?? ''] ?? 2;
      case 'persisting': return 7;
      case 'done':       return 7;
      case 'failed':     return 0;
      default:           return 0;
    }
  };

  // Busca o resumo do run salvo (matches/slots/datas) e popula runData.
  const fetchRunSummary = useCallback(async (runId: string): Promise<any | null> => {
    try {
      const r = await fetch(`${API_BASE}/v1/runs`);
      if (!r.ok) return null;
      const j = await r.json();
      const summary = (j.items ?? []).find((it: any) => it.run_id === runId);
      return summary ?? null;
    } catch { return null; }
  }, []);

  // Finaliza o run a partir do polling: popula runData, marca done, carrega estratégias.
  const finalizeRunFromPolling = useCallback(async (runId: string) => {
    const summary = await fetchRunSummary(runId);
    if (summary) setRunData(summary);
    setPipelineProgress((prev) => Math.max(prev, 7));
    setPipelinePhase("done");
    setError(null);
    if (elapsedTimer.current) clearInterval(elapsedTimer.current);
    setLoading(false);
    try {
      await loadRunStrategies(runId);
      await loadPredictions(runId);
    } catch { /* não derruba o run */ }
  }, [fetchRunSummary]);

  const pollProgress = useCallback((runId: string) => {
    if (progressTimer.current) clearInterval(progressTimer.current);
    progressTimer.current = setInterval(async () => {
      try {
        const r = await fetch(`${API_BASE}/v1/runs/${runId}/progress`);
        if (!r.ok) return;
        const p = await r.json();
        setProgress(p);
        const stage = phaseToProgress(p);
        setPipelineProgress((prev) => {
          // Quando o estágio avança, fecha o anterior com duração real.
          if (stage > prev && stage > 0) {
            const now = Date.now();
            const tracker = stageStartRef.current;
            if (tracker && tracker.stage > 0 && tracker.stage <= 11) {
              const dur = now - tracker.startedAt;
              setStageDurations((d) => ({ ...d, [tracker.stage]: dur }));
            }
            stageStartRef.current = { stage, startedAt: now };
          }
          return Math.max(prev, stage);
        });
        if (p.status === 'done' || p.status === 'failed') {
          if (progressTimer.current) clearInterval(progressTimer.current);
          const tracker = stageStartRef.current;
          if (tracker && p.status === 'done') {
            setStageDurations((d) => ({ ...d, [tracker.stage]: Date.now() - tracker.startedAt }));
          }
          if (p.status === 'done') {
            // O backend terminou — polling é a fonte da verdade, mesmo se o POST /v1/run
            // foi abortado pelo cliente (HMR, reload). Não marca FAIL falso.
            finalizeRunFromPolling(runId);
          } else {
            setPipelinePhase("error");
            setError(p.error ? `Pipeline falhou: ${p.error}` : "Pipeline falhou — verificar logs do backend");
            setLoading(false);
            if (elapsedTimer.current) clearInterval(elapsedTimer.current);
          }
        }
      } catch { /* ignore transient errors */ }
    }, 500);
  }, [finalizeRunFromPolling]);

  const loadRunStrategies = async (runId: string) => {
    const [yr, pr, dr] = await Promise.allSettled([
      fetch(`${API_BASE}/v1/runs/${runId}/strategy/yankee`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(YANKEE_OVERRIDES),
      }),
      fetch(`${API_BASE}/v1/runs/${runId}/strategy/singles-ev`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ top_n: 500 }),
      }),
      fetch(`${API_BASE}/v1/runs/${runId}/strategy/duplas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ top_n: 100 }),
      }),
    ]);
    if (yr.status === "fulfilled" && yr.value.ok) setYankeeData(await yr.value.json());
    if (pr.status === "fulfilled" && pr.value.ok) setPicksData(await pr.value.json());
    if (dr.status === "fulfilled" && dr.value.ok) setDuplasData(await dr.value.json());
    setPipelineProgress((prev) => Math.max(prev, 9));
  };

  // ── Main run ────────────────────────────────────────────────────────────────
  const handleRun = async () => {
    setError(null);
    setRunData(null); setYankeeData(null); setPicksData(null); setDuplasData(null);
    setSettleResult(null); setDryRunResult(null); setRepairResult(null);
    setSettleConfirm(false); setSettleCountdown(null);
    setResolverActivity(null);
    setPredsData(null); setExpandedDuplas(new Set());
    setYankeeDryRunResult(null); setYankeeSubmitResult(null);
    setYankeeSubmitConfirm(false); setYankeeSubmitCountdown(null);
    setProgress(null);
    setLoading(true);
    setPipelinePhase("running");
    setPipelineProgress(0);
    setElapsed(0);
    setStageDurations({});
    stageStartRef.current = { stage: 1, startedAt: Date.now() };
    if (pipelineLaunchGraceTimer.current) clearTimeout(pipelineLaunchGraceTimer.current);
    setActiveTab("execucao");

    // Pré-gerar suffix do run_id para o cliente conhecer antes do POST responder
    // (permite polling em paralelo de /v1/runs/:id/progress).
    const clientRunSuffix = (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)).replace(/-/g, "").slice(0, 12);
    const expectedRunId = `run-${startDate}-to-${endDate}-${clientRunSuffix.slice(0, 16)}`;

    // Elapsed timer + polling de progresso real (substitui animação fake)
    startTimeRef.current = Date.now();
    if (elapsedTimer.current) clearInterval(elapsedTimer.current);
    elapsedTimer.current = setInterval(() => {
      setElapsed(Date.now() - (startTimeRef.current ?? Date.now()));
    }, 500);

    // Inicia polling após pequeno delay para garantir que o backend já registrou progress
    setTimeout(() => pollProgress(expectedRunId), 250);

    let pollingTookOver = false;
    try {
      const runRes = await fetch(`${API_BASE}/v1/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date_start: startDate, date_end: endDate, run_id: clientRunSuffix }),
      });
      if (!runRes.ok) {
        const e = await runRes.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${runRes.status}`);
      }
      const run = await runRes.json();
      setRunData(run);

      if (progressTimer.current) clearInterval(progressTimer.current);
      if (elapsedTimer.current) clearInterval(elapsedTimer.current);
      setPipelineProgress(7);
      setPipelinePhase("done");

      await loadRunStrategies(run.run_id);
      await loadPredictions(run.run_id);

      setActiveTab("confrontos");
    } catch (e: any) {
      const launchErrorMessage = e?.message ?? "fetch abortado";
      const mayBeTransientLaunchError = /failed to fetch|networkerror|load failed|interrompido|abort|tempo limite|timed out/i.test(launchErrorMessage);

      // Se o fetch foi abortado pelo cliente mas o backend ainda está vivo,
      // não marcamos erro: deixamos o polling concluir o run e finalizar.
      try {
        const pr = await fetch(`${API_BASE}/v1/runs/${expectedRunId}/progress`);
        if (pr.ok) {
          const p = await pr.json();
          if (p.status === 'running') {
            // Já está rodando — polling vai finalizar. Apenas notifica.
            setError("Execução longa detectada. Acompanhando o progresso em segundo plano; a tela continua atualizando automaticamente.");
            pollingTookOver = true;
            return;
          }
          if (p.status === 'done') {
            // Já terminou em background — finaliza agora.
            await finalizeRunFromPolling(expectedRunId);
            setActiveTab("confrontos");
            pollingTookOver = true;
            return;
          }
        }
      } catch { /* progress inacessível: cai no erro real abaixo */ }

      if (mayBeTransientLaunchError) {
        setError("Execução longa detectada. Acompanhando o progresso em segundo plano; a tela continua atualizando automaticamente.");
        pipelineLaunchGraceTimer.current = setTimeout(async () => {
          try {
            const pr = await fetch(`${API_BASE}/v1/runs/${expectedRunId}/progress`);
            if (!pr.ok) throw new Error(`progress_http_${pr.status}`);
            const p = await pr.json();
            if (p.status === 'done') {
              await finalizeRunFromPolling(expectedRunId);
              setActiveTab("confrontos");
              return;
            }
            if (p.status === 'running') {
              setProgress(p);
              setPipelinePhase("running");
              return;
            }
            if (p.status === 'failed') {
              if (progressTimer.current) clearInterval(progressTimer.current);
              if (elapsedTimer.current) clearInterval(elapsedTimer.current);
              setPipelinePhase("error");
              setError(p.error ? `Pipeline falhou: ${p.error}` : "Pipeline falhou — verificar logs do backend");
              setLoading(false);
              return;
            }
          } catch {
            if (progressTimer.current) clearInterval(progressTimer.current);
            if (elapsedTimer.current) clearInterval(elapsedTimer.current);
            setPipelinePhase("error");
            setError(`POST /v1/run falhou e o run ${expectedRunId} não apareceu no progresso. Último erro: ${launchErrorMessage}`);
            setLoading(false);
          }
        }, 10000);
        pollingTookOver = true;
        return;
      }

      if (progressTimer.current) clearInterval(progressTimer.current);
      if (elapsedTimer.current) clearInterval(elapsedTimer.current);
      setPipelinePhase("error");
      setError(launchErrorMessage);
    } finally {
      if (!pollingTookOver) setLoading(false);
    }
  };

  // ── Yankee submission (Bloco 3.4) ───────────────────────────────────────────
  const handleYankeeDryRun = async () => {
    if (!runData?.run_id) return;
    setYankeeDryRunLoading(true);
    setYankeeDryRunResult(null);
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/v1/runs/${runData.run_id}/yankee/dry-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stake_per_ticket: yankeeStake, overrides: YANKEE_OVERRIDES }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setYankeeDryRunResult(data);
    } catch (e: any) {
      setError(`Yankee dry-run: ${e.message ?? "erro desconhecido"}`);
    } finally {
      setYankeeDryRunLoading(false);
    }
  };

  const startYankeeSubmitConfirm = () => {
    setYankeeSubmitConfirm(true);
    setYankeeSubmitCountdown(15);
    if (yankeeSubmitTimer.current) clearInterval(yankeeSubmitTimer.current);
    yankeeSubmitTimer.current = setInterval(() => {
      setYankeeSubmitCountdown((prev) => {
        if (prev == null || prev <= 1) {
          clearInterval(yankeeSubmitTimer.current!);
          setYankeeSubmitConfirm(false);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const cancelYankeeSubmit = () => {
    if (yankeeSubmitTimer.current) clearInterval(yankeeSubmitTimer.current);
    setYankeeSubmitConfirm(false);
    setYankeeSubmitCountdown(null);
  };

  const handleYankeeSubmit = async () => {
    if (!runData?.run_id) return;
    if (simulationMode) {
      setError("Modo Simulação ativo — submit real bloqueado. Use Dry-run ou desligue o modo no header.");
      return;
    }
    if (yankeeSubmitTimer.current) clearInterval(yankeeSubmitTimer.current);
    setYankeeSubmitConfirm(false);
    setYankeeSubmitCountdown(null);
    setYankeeSubmitLoading(true);
    setYankeeSubmitResult(null);
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/v1/runs/${runData.run_id}/yankee/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stake_per_ticket: yankeeStake, confirm: true, overrides: YANKEE_OVERRIDES }),
      });
      const data = await r.json();
      if (!r.ok && r.status !== 409) throw new Error(data.error ?? `HTTP ${r.status}`);
      setYankeeSubmitResult(data);
      setPipelineProgress((prev) => Math.max(prev, 10));
    } catch (e: any) {
      setError(`Yankee submit: ${e.message ?? "erro desconhecido"}`);
    } finally {
      setYankeeSubmitLoading(false);
    }
  };

  // ── Resolver ─────────────────────────────────────────────────────────────────
  const startSettleConfirm = () => {
    setSettleConfirm(true);
    setSettleCountdown(15);
    setResolverActivity({
      kind: "settle",
      status: "confirm",
      title: "Confirmação necessária",
      detail: "Clique em Confirmar para liquidar este run. A ação grava green/red nas predições.",
      step: 0,
      steps: ["Confirmar", "Processar", "Atualizar tela"],
    });
    if (settleTimer.current) clearInterval(settleTimer.current);
    settleTimer.current = setInterval(() => {
      setSettleCountdown((prev) => {
        if (prev == null || prev <= 1) {
          clearInterval(settleTimer.current!);
          setSettleConfirm(false);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const cancelSettleConfirm = () => {
    if (settleTimer.current) clearInterval(settleTimer.current);
    setSettleConfirm(false);
    setSettleCountdown(null);
    setResolverActivity(null);
  };

  const updateResolverActivity = (kind: "dryRun" | "settle" | "repair", step: number, detail: string, status = "running") => {
    const config = {
      dryRun: {
        title: "Dry-run em andamento",
        steps: ["Preparar", "Simular na API", "Atualizar prévia"],
      },
      settle: {
        title: "Liquidação em andamento",
        steps: ["Preparar", "Avaliar resultados", "Gravar settlement", "Recarregar tela"],
      },
      repair: {
        title: "Reparo em andamento",
        steps: ["Resetar histórico", "Reliquidar", "Recarregar tela"],
      },
    }[kind];
    setResolverActivity({ kind, status, title: config.title, steps: config.steps, step, detail });
  };

  const settleRun = async (dryRun = false) => {
    if (!runData?.run_id) return;
    const kind = dryRun ? "dryRun" : "settle";
    cancelSettleConfirm();
    updateResolverActivity(kind, 0, dryRun ? "Preparando simulação sem gravação..." : "Preparando liquidação do run...");
    if (dryRun) {
      setDryRunLoading(true); setDryRunResult(null);
      setSettleResult(null); setRepairResult(null);
    } else {
      setSettleLoading(true); setSettleResult(null);
      setDryRunResult(null); setRepairResult(null);
    }
    try {
      const url = `${API_BASE}/v1/settle/${runData.run_id}${dryRun ? "?dry_run=true" : ""}`;
      updateResolverActivity(kind, 1, dryRun ? "API simulando settlement; nada será gravado." : "API avaliando resultados reais e mercados elegíveis.");
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error ?? `HTTP ${res.status}`); }
      const data = await res.json();
      if (dryRun) {
        setDryRunResult(data);
        updateResolverActivity(kind, 2, "Recarregando contadores e lista de predições...");
        await loadPredictions(runData.run_id);
        setResolverActivity({ kind, status: "done", title: "Dry-run concluído", steps: ["Preparar", "Simular na API", "Atualizar prévia"], step: 2, detail: `${data.settled ?? 0} seriam liquidadas · ${data.skipped ?? 0} skipped` });
      } else {
        setSettleResult(data);
        setPipelineProgress((prev) => Math.max(prev, 11));
        updateResolverActivity(kind, 2, "Settlement gravado. Recarregando predições...");
        await loadPredictions(runData.run_id);
        updateResolverActivity(kind, 3, "Atualizando estratégias, Yankee e badges de resultado...");
        await loadRunStrategies(runData.run_id);
        setResolverActivity({ kind, status: "done", title: "Liquidação concluída", steps: ["Preparar", "Avaliar resultados", "Gravar settlement", "Recarregar tela"], step: 3, detail: `${data.settled ?? 0} liquidadas · ${data.green ?? 0} green · ${data.red ?? 0} red` });
      }
    } catch (e: any) {
      setError(e.message);
      setResolverActivity({ kind, status: "error", title: dryRun ? "Dry-run falhou" : "Liquidação falhou", steps: dryRun ? ["Preparar", "Simular na API", "Atualizar prévia"] : ["Preparar", "Avaliar resultados", "Gravar settlement", "Recarregar tela"], step: 0, detail: e.message ?? "Erro desconhecido" });
    } finally {
      if (dryRun) setDryRunLoading(false);
      else        setSettleLoading(false);
    }
  };

  async function loadPredictions(runId: string) {
    setPredsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/predictions/${runId}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setPredsData(data);
        return data;
      }
    } catch { /* non-fatal */ }
    finally { setPredsLoading(false); }
    return null;
  }

  // Reparar histórico (Bloco 5.1) — reseta + reliquida com regras atuais.
  // Confirmação inline (2 cliques) em vez de window.confirm(), que pode ser
  // bloqueado pelo browser e dar a sensação de "nada acontece".
  const [repairLoading, setRepairLoading] = useState(false);
  const [repairResult,  setRepairResult]  = useState<any>(null);
  const [repairConfirm, setRepairConfirm] = useState(false);
  const repairRun = async () => {
    if (!runData?.run_id) { setError("Sem run ativo para reparar."); return; }
    if (!repairConfirm) {
      setRepairConfirm(true);
      setError(null);
      setResolverActivity({
        kind: "repair",
        status: "confirm",
        title: "Confirme o reparo histórico",
        detail: "Clique novamente em Reparar histórico para resetar e reliquidar este run com as regras atuais.",
        step: 0,
        steps: ["Confirmar", "Resetar", "Reliquidar"],
      });
      // Auto-cancel após 8s se não confirmar
      setTimeout(() => setRepairConfirm((v) => {
        if (v) setResolverActivity(null);
        return v ? false : v;
      }), 8000);
      return;
    }
    setRepairConfirm(false);
    setRepairLoading(true);
    setRepairResult(null);
    setDryRunResult(null); setSettleResult(null);
    setError(null);
    updateResolverActivity("repair", 0, "Resetando histórico de settlement deste run...");
    try {
      updateResolverActivity("repair", 1, "API reliquidando predições com as regras atuais...");
      const res = await fetch(`${API_BASE}/v1/settle/${runData.run_id}/repair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? data.message ?? `HTTP ${res.status}`);
      setRepairResult(data);
      updateResolverActivity("repair", 2, "Recarregando predições e estratégias...");
      await loadPredictions(runData.run_id);
      await loadRunStrategies(runData.run_id);
      setResolverActivity({ kind: "repair", status: "done", title: "Reparo concluído", steps: ["Resetar histórico", "Reliquidar", "Recarregar tela"], step: 2, detail: `${data.reset_predictions ?? 0} resetadas · ${data.settled ?? 0} reliquidadas` });
    } catch (e: any) {
      setError(`Reparar: ${e.message ?? "erro desconhecido"}`);
      setResolverActivity({ kind: "repair", status: "error", title: "Reparo falhou", steps: ["Resetar histórico", "Reliquidar", "Recarregar tela"], step: 0, detail: e.message ?? "Erro desconhecido" });
    } finally {
      setRepairLoading(false);
    }
  };

  // ── Aprendizado ──────────────────────────────────────────────────────────────
  const loadCalib = async (engine = "A") => {
    setCalibLoading(true);
    try {
      const [calibRes, evalRes] = await Promise.allSettled([
        fetch(`${API_BASE}/v1/calibration?engine=${engine}`),
        fetch(`${API_BASE}/v1/evaluation/by-family`),
      ]);
      if (calibRes.status === "fulfilled" && calibRes.value.ok) setCalibData(await calibRes.value.json());
      if (evalRes.status  === "fulfilled" && evalRes.value.ok)  setEvalData(await evalRes.value.json());
    } catch (e: any) { setError(e.message); }
    finally { setCalibLoading(false); }
  };

  // ── Resultados ───────────────────────────────────────────────────────────────
  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/runs`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRunsList((await res.json()).items ?? []);
    } catch (e: any) { setError(e.message); }
    finally { setRunsLoading(false); }
  }, []);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  const deleteRun = async (id: string) => {
    try {
      await fetch(`${API_BASE}/v1/runs/${id}`, { method: "DELETE" });
      setRunsList((p) => p.filter((r) => r.run_id !== id));
      if (runData?.run_id === id) setRunData(null);
    } catch (e: any) { setError(e.message); }
    finally { setDeleteConfirmId(null); }
  };

  const deleteAllRuns = async () => {
    try {
      await fetch(`${API_BASE}/v1/runs`, { method: "DELETE" });
      setRunsList([]);
    } catch (e: any) { setError(e.message); }
    finally { setClearConfirm(false); }
  };

  // Select run from Resultados / dropdown → set as active.
  // UX: NÃO mudamos de aba; o usuário pode estar na Yankee/Confrontos/Resolver
  // e só quer trocar o run ativo. Trocar de aba sozinho frustra a navegação.
  const selectRun = (r: any) => {
    setRunData(r);
    setYankeeData(null); setPicksData(null); setDuplasData(null);
    setSettleResult(null); setDryRunResult(null);
    setSettleConfirm(false); setSettleCountdown(null);
    setResolverActivity(null);
    setYankeeHover(null);
    setPredsData(null);
    setPipelinePhase("done");
    setPipelineProgress(7);
    loadRunStrategies(r.run_id).catch((e: any) => setError(e.message ?? "Erro ao carregar estratégias do run"));
    loadPredictions(r.run_id).catch(() => {});
  };

  // ── Derived ───────────────────────────────────────────────────────────────────
  const readyCombos: any[] = yankeeData?.board?.ready_combos ?? [];
  const tickets:     any[] = yankeeData?.tickets ?? [];
  const picks:       any[] = picksData?.picks ?? [];
  const duplas:      any[] = duplasData?.picks ?? buildDuplas(picks);
  const readyComboByMatchId = new Map(readyCombos.map((combo: any) => [combo.match_id, combo]));

  const showYankeeHover = (event: any, combo: any, leg: any) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const margin = 12;
    const width = Math.min(420, Math.max(320, window.innerWidth - margin * 2));
    const estimatedHeight = 292;
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
    const below = rect.bottom + 8;
    const top = below + estimatedHeight > window.innerHeight
      ? Math.max(margin, rect.top - estimatedHeight - 8)
      : below;
    setYankeeHover({ combo, leg, left, top, width });
  };

  const getTicketBoards = (ticket: any): any[] => {
    const rawBoards = Array.isArray(ticket?.boards) && ticket.boards.length
      ? ticket.boards
      : (ticket?.confronto_indices ?? []).map((idx: number) => readyCombos[idx]);

    return rawBoards.map((board: any) => {
      if (!board) return null;
      const fullBoard = readyComboByMatchId.get(board.match_id);
      if (!fullBoard) return board;

      const ticketLegs = Array.isArray(board.legs) ? board.legs : [];
      return {
        ...fullBoard,
        ...board,
        legs: (fullBoard.legs ?? []).map((fullLeg: any) => {
          const ticketLeg = ticketLegs.find((leg: any) => leg.market_key === fullLeg.market_key);
          if (!ticketLeg) return fullLeg;
          return {
            ...fullLeg,
            ...ticketLeg,
            home: ticketLeg.home ?? fullLeg.home,
            away: ticketLeg.away ?? fullLeg.away,
            liga: ticketLeg.liga ?? fullLeg.liga,
            result: ticketLeg.result ?? fullLeg.result ?? null,
            actual_value: ticketLeg.actual_value ?? fullLeg.actual_value ?? null,
          };
        }),
      };
    }).filter(Boolean);
  };
  const visiblePredRows: any[] = (predsData?.rows ?? []).slice(0, 500);
  const hiddenPredRows = Math.max(0, (predsData?.rows?.length ?? 0) - visiblePredRows.length);
  const resolverStats = predsData
    ? {
      count: predsData.count ?? 0,
      green: predsData.green ?? 0,
      red: predsData.red ?? 0,
      pending: predsData.pending ?? 0,
      certified: predsData.certified ?? 0,
    }
    : runData
      ? {
        count: Number(runData.slots ?? 0),
        green: 0,
        red: 0,
        pending: Number(runData.slots ?? 0),
        certified: 0,
      }
      : null;
  const resolverSettledTotal = resolverStats ? resolverStats.green + resolverStats.red : 0;
  const resolverGreenPct = resolverStats && resolverSettledTotal > 0
    ? `${((resolverStats.green / resolverSettledTotal) * 100).toFixed(1)}% dos resolvidos`
    : "—";
  const resolverRedPct = resolverStats && resolverSettledTotal > 0
    ? `${((resolverStats.red / resolverSettledTotal) * 100).toFixed(1)}% dos resolvidos`
    : "—";
  const avgScore           = avgQualityScore(readyCombos);
  const boardStatus        = yankeeData?.board?.board_status;
  const boardWarnings:string[] = yankeeData?.board?.warnings ?? [];

  // BIBD frequency — confronto_index → count across all tickets
  const bibdFreq = tickets.reduce((m: Map<number,number>, t: any) => {
    for (const ci of t.confronto_indices ?? []) m.set(ci, (m.get(ci) ?? 0) + 1);
    return m;
  }, new Map<number,number>());
  const isBibd = bibdFreq.size > 0 && [...bibdFreq.values()].every((v) => v === 4);

  const singlesEv = [...picks]
    .filter((p: any) => p?.market_key && (p?.market_odd ?? 0) > 1)
    .reduce((acc: any[], p: any) => {
      const key = `${p.match_id ?? p.home + "_" + p.away}|${p.market_key}`;
      if (!acc.some((x: any) => x.__dedupe_key === key)) acc.push({ ...p, __dedupe_key: key });
      return acc;
    }, [])
    .sort((a, b) => (b.edge_pct ?? 0) - (a.edge_pct ?? 0))
    .map(({ __dedupe_key, ...p }) => p);

  // "no board" check — match is in readyCombos
  const inBoard = (home: string, away: string) =>
    readyCombos.some((c) => c.legs?.[0]?.home === home && c.legs?.[0]?.away === away);

  const yankeeDryValidation = yankeeDryRunResult?.external_validation ?? null;
  const yankeeDrySummary = yankeeDryValidation?.summary ?? null;
  const yankeeDryGaps = uniqueValidationGaps(yankeeDryValidation?.sample_gaps ?? []).slice(0, 5);
  const yankeeSubmitValidation = yankeeSubmitResult?.external_validation ?? null;
  const yankeeSubmitSummary = yankeeSubmitValidation?.summary ?? null;
  const yankeeSubmitGaps = uniqueValidationGaps(yankeeSubmitValidation?.sample_gaps ?? []).slice(0, 5);

  // Aprendizado: maiores desvios ordenados por |ewma_hr - 0.5|
  const desvios = [...(calibData?.items ?? [])]
    .filter((r: any) => r.ewma_hr != null)
    .sort((a: any, b: any) => Math.abs(b.ewma_hr - 0.5) - Math.abs(a.ewma_hr - 0.5))
    .slice(0, 10);

  // Aprendizado KPIs from evalData
  const evalSummary = evalData?.items
    ? evalData.items.reduce((s: any, r: any) => ({ n: s.n + r.n, green: s.green + r.green }), { n: 0, green: 0 })
    : null;

  // CSV export for predictions
  const exportPredsCsv = () => {
    if (!predsData?.rows?.length) return;
    const header = "partida,liga,mercado,familia,odd,edge_pct,confianca,resultado,liquidado_em";
    const rows = predsData.rows.map((r: any) =>
      [
        `"${r.home ?? "?"}×${r.away ?? "?"}"`,
        r.liga, r.market_key, r.family,
        r.market_odd ?? "", r.edge_pct != null ? r.edge_pct.toFixed(2) : "",
        r.confidence != null ? r.confidence.toFixed(3) : "",
        r.result ?? "pendente", r.settled_at ?? "",
      ].join(",")
    );
    const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `predictions_${runData?.run_id ?? "export"}.csv`;
    a.click();
  };

  // ── Sub-component ─────────────────────────────────────────────────────────────
  const TabBtn = ({ id, label, Icon }: { id: string; label: string; Icon: React.ElementType }) => (
    <button
      onClick={() => { setYankeeHover(null); setActiveTab(id); }}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-colors ${
        activeTab === id
          ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.12)]"
          : "text-white/55 hover:text-white hover:bg-emerald-500/10 border border-transparent"
      }`}
    >
      <Icon size={13} />{label}
    </button>
  );

  // ── Render ────────────────────────────────────────────────────────────────────
  const totalStake = tickets.reduce(
    (s: number, t: any) => s + (t.stake_brl ?? 0), 0
  );
  const isLivePipe = pipelinePhase === "running";

  return (
    <div className="min-h-screen bg-[#0b0f10] text-white">
      <div className="max-w-7xl mx-auto p-4 space-y-5">

        {/* ── PageBanner (Apollo Turbo) ─────────────────────────────────── */}
        <header
          className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-[linear-gradient(135deg,rgba(12,53,43,0.96)_0%,rgba(18,24,24,0.96)_55%,rgba(22,28,28,0.96)_100%)] px-5 py-4 shadow-[0_24px_48px_rgba(0,0,0,0.4)]"
        >
          <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_36%),radial-gradient(circle_at_top_right,rgba(34,211,238,0.10),transparent_40%)]" />
          <div className="relative flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10">
                <Cpu className="h-5 w-5 text-emerald-300" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-bold text-white tracking-tight">Apollo Turbo · SCOUTCORE</h1>
                <p className="mt-0.5 text-[12px] text-white/65 leading-snug max-w-3xl">
                  Selecione 1 data ou período → pipeline A·B · Curinga · Scout IA processa todos os jogos →
                  top confrontos → Yankee BIBD · Duplas EV+ · Singles EV+
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSimulationMode((v) => !v)}
                title="Quando ligado, submits reais ficam bloqueados (somente dry-run/análise)."
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                  simulationMode
                    ? "border-amber-500/45 bg-amber-500/12 text-amber-300 hover:bg-amber-500/20"
                    : "border-rose-500/45 bg-rose-500/12 text-rose-300 hover:bg-rose-500/20"
                }`}
              >
                <ShieldAlert className="h-3 w-3" />
                {simulationMode ? "Simulação · sem aposta" : "MODO REAL · cuidado"}
              </button>
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                Motor A+B
              </span>
              <button
                type="button"
                onClick={() => { loadRuns(); }}
                disabled={runsLoading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
              >
                {runsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Atualizar
              </button>
            </div>
          </div>
        </header>

        {/* ── Run strip sticky ─────────────────────────────────────────── */}
        <section
          className="sticky top-2 z-20 rounded-xl border border-emerald-500/30 bg-[linear-gradient(135deg,rgba(12,53,43,0.97)_0%,rgba(18,24,24,0.96)_100%)] px-3 py-2 shadow-[0_12px_28px_rgba(0,0,0,0.32)] backdrop-blur"
          aria-label="Run em análise"
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 shrink-0">
              <History className="h-4 w-4 text-cyan-300" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-white/80">Run</span>
            </div>
            {runsList.length > 0 ? (
              <ThemedSelect
                value={runData?.run_id ?? ""}
                ariaLabel="Selecionar run"
                options={[
                  { value: "", label: "— selecionar run —" },
                  ...runsList.map((runItem) => ({
                    value: runItem.run_id,
                    label: runDisplayLabel(runItem),
                  })),
                ]}
                onChange={(nextRunId) => {
                  const selectedRun = runsList.find((runItem) => runItem.run_id === nextRunId);
                  if (selectedRun) selectRun(selectedRun);
                }}
                className="flex-1 min-w-60"
                buttonClassName="text-[11px] font-mono"
                listClassName="max-h-96 text-[11px] font-mono"
              />
            ) : (
              <span className="text-[11px] text-white/45 font-mono truncate flex-1">
                {runData ? runDisplayLabel(runData) : "nenhum run ativo — execute o pipeline ou carregue o histórico"}
              </span>
            )}
            {runData ? (
              <span className="rounded border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-300">
                Atual
              </span>
            ) : null}
            <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px]">
              <div className="flex items-center gap-1.5">
                <Ticket className="h-3.5 w-3.5 text-emerald-300" />
                <span className="text-white/55">Abertos</span>
                <strong className="text-white font-mono tabular-nums">{tickets.length}</strong>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                <span className="text-white/55">Resolvidos</span>
                <strong className="text-white font-mono tabular-nums">{settleResult?.settled ?? 0}</strong>
              </div>
              <div className="flex items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5 text-cyan-300" />
                <span className="text-white/55">Stake</span>
                <strong className="text-cyan-200 font-mono tabular-nums">{fmtBRL(totalStake)}</strong>
              </div>
            </div>
          </div>
        </section>

        {/* Status banner */}
        {error && (
          <div className={`rounded-xl p-3 flex items-start gap-2.5 ${error.startsWith("Execução longa detectada")
            ? "bg-cyan-950/50 border border-cyan-700/40"
            : "bg-rose-950/60 border border-rose-700/50"
          }`}>
            {error.startsWith("Execução longa detectada") ? (
              <Clock size={15} className="text-cyan-300 mt-0.5 shrink-0" />
            ) : (
              <ShieldAlert size={15} className="text-rose-400 mt-0.5 shrink-0" />
            )}
            <div className="flex-1">
              <div className={`text-sm font-semibold ${error.startsWith("Execução longa detectada") ? "text-cyan-100" : "text-rose-200"}`}>
                {error.startsWith("Execução longa detectada") ? "Acompanhando execução" : "Erro"}
              </div>
              <div className={`text-xs mt-0.5 break-all ${error.startsWith("Execução longa detectada") ? "text-cyan-200/80" : "text-rose-300/80 font-mono"}`}>
                {error}
              </div>
            </div>
            <button
              onClick={() => setError(null)}
              className={`${error.startsWith("Execução longa detectada") ? "text-cyan-300 hover:text-cyan-100" : "text-rose-400 hover:text-rose-200"} text-lg leading-none ml-1`}
            >×</button>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex flex-wrap gap-1 rounded-xl border border-emerald-500/25 bg-[linear-gradient(135deg,rgba(8,33,28,0.78)_0%,rgba(10,15,15,0.88)_100%)] p-1">
          <TabBtn id="execucao"    label="Execução"     Icon={Zap} />
          <TabBtn id="confrontos" label="Confrontos"   Icon={Swords} />
          <TabBtn id="yankee"     label="Yankee"       Icon={Ticket} />
          <TabBtn id="agressivas" label="Agressivas EV+" Icon={Layers3} />
          <TabBtn id="resolver"   label="Resolver"     Icon={CheckCircle2} />
          <TabBtn id="aprendizado" label="Aprendizado" Icon={Brain} />
          <TabBtn id="resultados" label="Resultados"   Icon={History} />
          <TabBtn id="pipeline"   label="Pipeline"     Icon={Radio} />
        </div>

        {/* ════════════════════════════════════════════ EXECUÇÃO */}
        {activeTab === "execucao" && (
          <>
            <section className={`${PANEL} p-5 space-y-4`} aria-label="Executar pipeline">
              <header className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-emerald-300" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-white/85">Executar Pipeline</h2>
              </header>
              <div className="grid grid-cols-2 gap-3">
                {[["Data inicial", startDate, setStartDate], ["Data final", endDate, setEndDate]].map(([label, val, set]) => (
                  <div key={label as string}>
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-white/55 mb-1.5">{label as string}</label>
                    <input
                      type="date"
                      value={val as string}
                      onChange={(e) => (set as any)(e.target.value)}
                      className="w-full bg-black/30 border border-emerald-500/25 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-emerald-400"
                    />
                  </div>
                ))}
              </div>
              <button
                onClick={handleRun}
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/50 bg-[linear-gradient(135deg,rgba(16,185,129,0.32),rgba(11,120,88,0.42))] px-4 py-3 text-sm font-bold uppercase tracking-wide text-white hover:bg-[linear-gradient(135deg,rgba(16,185,129,0.42),rgba(11,120,88,0.52))] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play size={15} />}
                {loading ? "Executando pipeline…" : "Rodar período"}
              </button>
            </section>

            <section className={`${PANEL} p-4 mt-4 space-y-3`} aria-label="Monitor da pipeline">
              <header className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-emerald-300" />
                <h3 className="text-sm font-semibold uppercase tracking-wide text-white/85">Monitor da Pipeline</h3>
                <span className="ml-2 text-[11px] text-white/55">
                  {runData
                    ? <><span className="font-mono text-white/75">{fmtRunSeq(runData)}</span> · {isLivePipe ? "em execução" : pipelinePhase === "done" ? "concluído" : "pronto"}</>
                    : "Selecione um período e clique em Rodar período"}
                </span>
              </header>

              {/* Banner status */}
              <div className={`rounded-xl border p-3 ${
                pipelinePhase === "done"    ? "border-emerald-500/45 bg-[linear-gradient(135deg,rgba(11,80,55,0.92),rgba(15,22,22,0.96))]" :
                pipelinePhase === "error"   ? "border-rose-500/45 bg-[linear-gradient(135deg,rgba(80,18,28,0.85),rgba(20,12,15,0.96))]" :
                pipelinePhase === "running" ? "border-emerald-500/35 bg-[linear-gradient(135deg,rgba(12,53,43,0.96),rgba(20,28,28,0.97))]" :
                                              "border-white/10 bg-black/30"}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg border ${
                    pipelinePhase === "error" ? "border-rose-500/45 bg-rose-500/12" : "border-emerald-500/40 bg-emerald-500/10"}`}>
                    {pipelinePhase === "running" ? <Loader2 className="h-4 w-4 animate-spin text-emerald-300" /> :
                     pipelinePhase === "done"    ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> :
                     pipelinePhase === "error"   ? <AlertTriangle className="h-4 w-4 text-rose-300" /> :
                                                   <Clock className="h-4 w-4 text-white/55" />}
                  </div>
                  <div className="flex-1 min-w-60">
                    <div className="flex items-center gap-2">
                      <h3 className={`text-[11px] font-bold uppercase tracking-wide ${
                        pipelinePhase === "error" ? "text-rose-300" :
                        pipelinePhase === "done"  ? "text-emerald-300" :
                        pipelinePhase === "running" ? "text-emerald-300" : "text-white/55"}`}>
                        Pipeline {pipelinePhase === "done" ? "concluído" : pipelinePhase === "error" ? "falhou" : pipelinePhase === "running" ? "em execução" : "aguardando"}
                      </h3>
                      {runData && <span className="font-mono text-[10px] text-white/55">{fmtRunSeq(runData)}</span>}
                      {runData && <span className="font-mono text-[10px] text-cyan-300/70">{runShortId(runData.run_id)}</span>}
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-white/70">
                      {pipelinePhase === "running" && PIPELINE_STAGES[pipelineProgress - 1]
                        ? <>Estágio: <span className="font-semibold text-emerald-200">{PIPELINE_STAGES[pipelineProgress - 1].label}</span></>
                        : pipelinePhase === "done"
                          ? <>Run finalizado · {pipelineProgress}/11 estágios concluídos</>
                          : pipelinePhase === "error"
                            ? <>Falha — verificar logs do backend</>
                            : <>Aguardando dados…</>}
                    </p>
                    {progress && pipelinePhase === "running" && (
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-white/60">
                        <span>partidas: <strong className="text-white">{progress.matches_done ?? 0}/{progress.total_matches ?? "?"}</strong></span>
                        {progress.matches_skipped > 0 && <span className="text-amber-300">skip: {progress.matches_skipped}</span>}
                        <span>slots: <strong className="text-emerald-300">{progress.slots_built ?? 0}</strong></span>
                        {progress.current_match && (
                          <span className="truncate max-w-[28ch]">→ {progress.current_match.home} × {progress.current_match.away}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-stretch gap-1.5">
                    <div className="rounded-md border border-emerald-500/30 bg-black/35 px-2 py-1 text-center">
                      <p className="text-[8px] uppercase tracking-wide text-white/55">Decorrido</p>
                      <p className={`font-mono text-sm font-semibold tabular-nums ${isLivePipe ? "text-emerald-300" : "text-white/85"}`}>
                        {fmtElapsed(elapsed)}
                      </p>
                    </div>
                    <div className="rounded-md border border-white/12 bg-black/35 px-2 py-1 text-center">
                      <p className="text-[8px] uppercase tracking-wide text-white/55">Etapas</p>
                      <p className="font-mono text-sm font-semibold tabular-nums text-white/90">{pipelineProgress}/11</p>
                    </div>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-2 h-1.5 overflow-hidden rounded-full border border-white/8 bg-black/40">
                  <div
                    className={`h-full transition-all duration-500 ${
                      pipelinePhase === "error"
                        ? "bg-[linear-gradient(90deg,#ef4444,#f97316)]"
                        : pipelinePhase === "done"
                          ? "bg-[linear-gradient(90deg,#10b981,#22d3ee)]"
                          : "bg-[linear-gradient(90deg,#10b981,#22d3ee)] animate-pulse"
                    }`}
                    style={{ width: `${(pipelineProgress / 11) * 100}%` }}
                  />
                </div>
              </div>

              {/* Stages — grid compacto no padrão Apollo Turbo */}
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-11">
                  {PIPELINE_STAGES.map((stage) => {
                    const done   = pipelineProgress >= stage.id && pipelinePhase !== "error";
                    const active = pipelinePhase === "running" && pipelineProgress === stage.id;
                    // FAIL: só marca o estágio EM EXECUÇÃO quando o backend reportou falha.
                    // Antes pintava `stage.id - 1`, o que carimbava o estágio seguinte como FAIL
                    // mesmo quando a falha era no atual. Agora alinhamos com pipelineProgress.
                    const fail   = pipelinePhase === "error" && stage.id === pipelineProgress && stage.id > 0;
                    const Icon   = stage.icon;

                    // Contagem por estágio (mapeamento heurístico p/ não inventar dados):
                    //  • Jogos / Motor / Curinga / Scout → partidas processadas
                    //  • Combine / Validar / Board → slots certificados
                    //  • Yankee / Singles → artefatos já carregados na tela
                    let count: number | string = "—";
                    if (stage.id === 1)       count = progress?.total_matches ?? (done ? runData?.matches ?? "—" : "—");
                    else if (stage.id <= 4)   count = progress?.matches_done ?? (done ? runData?.matches ?? "—" : "—");
                    else if (stage.id <= 7)   count = progress?.slots_built ?? (done ? runData?.slots ?? "—" : "—");
                    else if (stage.id === 8)  count = done ? tickets.length : "—";
                    else if (stage.id === 9)  count = done ? picks.length : "—";
                    else if (stage.id === 10) count = simulationMode ? "OFF" : done ? (tickets.length || readyCombos.length) : "—";
                    else if (stage.id === 11) count = done ? "OK" : "—";

                    const dur = stageDurations[stage.id] ?? (active && stageStartRef.current?.stage === stage.id
                      ? Date.now() - stageStartRef.current.startedAt
                      : null);
                    const submitLocked = stage.id === 10 && simulationMode;
                    const pct = submitLocked ? 0 : fail ? 0 : done ? 100 : active ? 50 : 0;
                    const badgeText = submitLocked ? "OFF" : fail ? "FAIL" : done ? "OK" : active ? "RUN" : "—";
                    const badgeCls  = submitLocked
                      ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                      : fail
                      ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                      : done
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                        : active
                          ? "bg-cyan-500/20 text-cyan-200 border-cyan-500/40"
                          : "bg-white/5 text-white/40 border-white/10";
                    const cardCls = submitLocked
                      ? "border-amber-500/35 bg-[linear-gradient(180deg,rgba(85,56,16,0.48),rgba(20,18,14,0.92))]"
                      : fail
                      ? "border-rose-500/45 bg-[linear-gradient(180deg,rgba(60,15,22,0.65),rgba(20,12,15,0.95))]"
                      : done
                        ? "border-emerald-500/35 bg-[linear-gradient(180deg,rgba(11,80,55,0.55),rgba(15,22,22,0.92))]"
                        : active
                          ? "border-cyan-500/35 bg-[linear-gradient(180deg,rgba(15,55,68,0.6),rgba(15,22,22,0.92))] animate-pulse"
                          : "border-white/10 bg-black/30";

                    return (
                      <div
                        key={stage.id}
                        className={`relative min-h-26 rounded-lg border px-2 py-1.5 transition-all ${cardCls}`}
                      >
                        {/* topo: # + badge */}
                        <div className="flex items-center justify-between">
                          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                            submitLocked ? "bg-amber-400/20 text-amber-200" :
                            done ? "bg-emerald-500/80 text-white" :
                            active ? "bg-cyan-400 text-cyan-950" :
                            fail ? "bg-rose-500/80 text-white" :
                            "bg-white/10 text-white/45"
                          }`}>{stage.id}</span>
                          <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide ${badgeCls}`}>{badgeText}</span>
                        </div>

                        {/* meio: ícone + label + count */}
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <Icon size={11} className={submitLocked ? "text-amber-300" : done ? "text-emerald-300" : active ? "text-cyan-200" : "text-white/40"} />
                          <span className={`text-[9px] font-bold uppercase tracking-wide ${
                            submitLocked ? "text-amber-100" : done ? "text-emerald-100" : active ? "text-cyan-100" : "text-white/55"
                          }`}>{stage.label.length > 14 ? stage.label.slice(0, 14) : stage.label}</span>
                        </div>
                        <div className={`mt-1 text-center font-mono text-base font-bold tabular-nums ${
                          submitLocked ? "text-amber-200" : done ? "text-emerald-200" : active ? "text-cyan-200" : "text-white/40"
                        }`}>
                          {count}
                        </div>

                        {/* rodapé: dur + pct */}
                        <div className="mt-1 flex items-center justify-between text-[9px] font-mono">
                          <span className={submitLocked ? "text-amber-300/85" : done ? "text-emerald-300/85" : active ? "text-cyan-300/85" : "text-white/40"}>
                            {fmtStageDur(dur)}
                          </span>
                          <span className={submitLocked ? "text-amber-300" : done ? "text-emerald-300" : active ? "text-cyan-300" : "text-white/40"}>
                            {pct}%
                          </span>
                        </div>

                        {/* mini progress bar */}
                        <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-black/40">
                          <div
                            className={`h-full transition-all duration-500 ${
                              submitLocked ? "bg-amber-400" : fail ? "bg-rose-400" : done ? "bg-emerald-400" : active ? "bg-cyan-400 animate-pulse" : "bg-white/10"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>

                        {(stage as any).optIn && (
                          <span className="absolute -top-1.5 -right-1.5 rounded-full border border-fuchsia-500/50 bg-fuchsia-500/20 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-fuchsia-200">
                            opt-in
                          </span>
                        )}
                      </div>
                    );
                  })}
              </div>

              {runData && pipelinePhase === "done" && (
                <div className="grid grid-cols-3 gap-3 pt-1">
                  {[["partidas", runData.matches, "text-white"],["slots", runData.slots, "text-emerald-300"],["ready", readyCombos.length, "text-cyan-300"]].map(([l,v,c]) => (
                    <div key={l as string} className={`${CARD} p-3 text-center`}>
                      <div className={`text-2xl font-bold ${c}`}>{v as number}</div>
                      <div className="text-[10px] uppercase tracking-wide text-white/55 mt-0.5">{l as string}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {/* ════════════════════════════════════════════ PIPELINE (atalho para Execução) */}
        {activeTab === "pipeline" && (
          <section className={`${PANEL} p-6 text-center space-y-3`}>
            <Radio className="h-6 w-6 text-emerald-300 mx-auto" />
            <h3 className="text-sm font-semibold uppercase tracking-wide text-white/85">Monitor da Pipeline</h3>
            <p className="text-[12px] text-white/55 max-w-md mx-auto">
              O monitor ao vivo dos 11 estágios fica integrado à aba <button onClick={() => setActiveTab("execucao")} className="text-emerald-300 hover:underline font-semibold">Execução</button>.
              Use esta aba como referência de fases:
            </p>
            <div className="grid sm:grid-cols-2 gap-1.5 max-w-2xl mx-auto pt-2">
              {PIPELINE_STAGES.map((s) => {
                const Icon = s.icon;
                return (
                  <div key={s.id} className={`${CARD} flex items-center gap-2 px-3 py-2 text-left`}>
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-[10px] font-bold text-emerald-300 shrink-0">{s.id}</span>
                    <Icon size={13} className="text-emerald-300/70" />
                    <span className="text-[11px] text-white/75">{s.label}</span>
                    {(s as any).optIn && <span className="ml-auto text-[9px] uppercase text-fuchsia-300/70 font-mono">opt-in</span>}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ════════════════════════════════════════════ CONFRONTOS */}
        {activeTab === "confrontos" && (
          <section className={`${PANEL} p-5 space-y-4`}>
            <header className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Swords className="h-4 w-4 text-emerald-300" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-white/85">Board — Confrontos Ready</h2>
              </div>
              <div className="flex items-center gap-3 text-xs">
                {avgScore && <span className="text-yellow-400">Score médio: <strong>{avgScore}</strong></span>}
                {boardStatus && (
                  <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold tracking-wide border ${
                    boardStatus === "ok"
                      ? "border-emerald-500/40 bg-emerald-500/12 text-emerald-300"
                      : "border-rose-500/40 bg-rose-500/12 text-rose-300"
                  }`}>
                    {boardStatus}
                  </span>
                )}
              </div>
            </header>
            {boardWarnings.length > 0 && (
              <div className="bg-yellow-900/20 border border-yellow-800/40 rounded-lg p-2.5 space-y-1">
                {boardWarnings.map((w, i) => <div key={i} className="text-xs text-yellow-400">⚠ {w}</div>)}
              </div>
            )}
            {!readyCombos.length ? (
              <p className="text-gray-600 text-sm text-center py-10">{loading ? "Carregando…" : "Execute o pipeline primeiro."}</p>
            ) : (
              <>
                {/* Cards executivos de resultado */}
                {(() => {
                  const statsCombos = readyCombos.map((c: any) => aggregateLegsResult(c.legs));
                  const cGreen    = statsCombos.filter((x: any) => x.status === "GREEN").length;
                  const cRed      = statsCombos.filter((x: any) => x.status === "RED").length;
                  const cPend     = statsCombos.filter((x: any) => x.status === "PEND").length;
                  const cResolved = cGreen + cRed;
                  const cTotal    = statsCombos.length;
                  const pct = (n: number, d: number) => d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—";
                  return (
                    <div className="grid grid-cols-3 gap-2">
                      {/* GREEN */}
                      <div className="rounded-xl border border-emerald-500/25 bg-[linear-gradient(160deg,rgba(6,46,28,0.60)_0%,rgba(12,22,18,0.92)_100%)] px-4 py-3 flex items-center gap-3 shadow-[0_4px_14px_rgba(0,0,0,0.22)]">
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300/55">Greens</div>
                          <div className="text-2xl font-bold font-mono text-emerald-300 leading-none mt-1">{cGreen}</div>
                          <div className="text-[10px] text-white/35 mt-1">confrontos ✓</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[10px] text-white/30">de resolvidos</div>
                          <div className="text-base font-bold font-mono text-emerald-300/80">{pct(cGreen, cResolved)}</div>
                        </div>
                      </div>
                      {/* RED */}
                      <div className="rounded-xl border border-rose-500/25 bg-[linear-gradient(160deg,rgba(46,6,18,0.60)_0%,rgba(22,10,14,0.92)_100%)] px-4 py-3 flex items-center gap-3 shadow-[0_4px_14px_rgba(0,0,0,0.22)]">
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-300/55">Reds</div>
                          <div className="text-2xl font-bold font-mono text-rose-300 leading-none mt-1">{cRed}</div>
                          <div className="text-[10px] text-white/35 mt-1">confrontos ✗</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[10px] text-white/30">de resolvidos</div>
                          <div className="text-base font-bold font-mono text-rose-300/80">{pct(cRed, cResolved)}</div>
                        </div>
                      </div>
                      {/* PENDENTES */}
                      <div className="rounded-xl border border-amber-500/25 bg-[linear-gradient(160deg,rgba(42,26,4,0.60)_0%,rgba(22,18,8,0.92)_100%)] px-4 py-3 flex items-center gap-3 shadow-[0_4px_14px_rgba(0,0,0,0.22)]">
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-300/55">Pendentes</div>
                          <div className="text-2xl font-bold font-mono text-amber-300 leading-none mt-1">{cPend}</div>
                          <div className="text-[10px] text-white/35 mt-1">aguardando</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[10px] text-white/30">do total</div>
                          <div className="text-base font-bold font-mono text-amber-300/80">{pct(cPend, cTotal)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div className={TABLE_SHELL}>
                <table className="w-full text-xs">
                  <thead className={TABLE_HEAD}><tr className={TABLE_HEAD_ROW}>
                    <th className="text-left py-2 pr-3 font-medium">#</th>
                    <th className="text-left py-2 pr-3 font-medium">Confronto</th>
                    <th className="text-left py-2 pr-3 font-medium">Liga</th>
                    <th className="text-left py-2 pr-3 font-medium">Status</th>
                    <th className="text-left py-2 pr-3 font-medium">Resultado</th>
                    <th className="text-right py-2 pr-3 font-medium">Odd</th>
                    <th className="text-right py-2 pr-3 font-medium">Score</th>
                    <th className="text-right py-2 pr-3 font-medium">Legs</th>
                    <th className="text-left py-2 font-medium">Famílias</th>
                  </tr></thead>
                  <tbody>
                    {readyCombos.map((c: any, i: number) => {
                      const head = c.legs?.[0] ?? {};
                      const families: string[] = c.families ?? [];
                      // Resultado: agrega legs (já enriquecidas com result/actual_value pelo backend).
                      // Fallback legacy: settle/predictions in-memory.
                      const agg = aggregateLegsResult(c.legs);
                      let res: "PEND" | "GREEN" | "RED" = agg.status;
                      if (res === "PEND") {
                        const outcome = (settleResult?.results ?? predsData?.predictions ?? [])
                          .find((x: any) => x.match_id === c.match_id && x.combo_signature && x.combo_signature === c.match_id);
                        if (outcome?.status === "won") res = "GREEN";
                        else if (outcome?.status === "lost") res = "RED";
                      }
                      const resBadge =
                        res === "GREEN" ? "bg-emerald-600/35 border border-emerald-400 text-emerald-100"
                        : res === "RED" ? "bg-rose-600/35 border border-rose-400 text-rose-100"
                        : "bg-amber-600/25 border border-amber-400/70 text-amber-100";
                      return (
                        <tr key={i} className={TABLE_ROW}>
                          <td className="py-2 pr-3 text-gray-600">{i + 1}</td>
                          <td className="py-2 pr-3">
                            <div className="text-gray-100">{head.home ?? "—"} × {head.away ?? "—"}</div>
                            <div className="font-mono text-[10px] text-gray-600">{c.match_id?.slice(0, 24)}</div>
                          </td>
                          <td className="py-2 pr-3 text-gray-500">{head.liga ?? "—"}</td>
                          <td className="py-2 pr-3">
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-900/30 border border-emerald-700/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                              ✓ {c.status ?? "ready"}
                            </span>
                          </td>
                          <td className="py-2 pr-3">
                            <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold font-mono ${resBadge}`}>
                              {res === "GREEN" ? "✓" : res === "RED" ? "X" : "O"} {res}
                            </span>
                            {agg.total > 0 && (
                              <div className="text-[10px] font-mono text-gray-500 mt-0.5">
                                {agg.greens}/{agg.total} g · {agg.reds} R
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono text-white font-semibold">{c.combo_odd?.toFixed(2) ?? "—"}</td>
                          <td className="py-2 pr-3 text-right font-mono text-yellow-400">{c.quality_score?.toFixed(2) ?? "—"}</td>
                          <td className="py-2 pr-3 text-right font-mono text-gray-300">{c.n_legs ?? c.legs?.length ?? "—"}</td>
                          <td className="py-2">
                            <div className="flex flex-wrap gap-1">
                              {families.map((f) => (
                                <span key={f} className="rounded-md border border-emerald-500/20 bg-emerald-950/25 px-1.5 py-0.5 text-[10px] text-emerald-100/75 font-mono">{f}</span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </section>
        )}

        {/* ════════════════════════════════════════════ YANKEE */}
        {activeTab === "yankee" && (
          <section className={`${PANEL} p-5 space-y-4`}>
            {/* Header com badge BIBD */}
            <header className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Ticket className="h-4 w-4 text-emerald-300" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-white/85">Yankee — BIBD</h2>
              </div>
              <div className="flex items-center gap-2">
                {readyCombos.length > 0 && tickets.length > 0 && (
                  <span className="text-[11px] text-white/45">
                    {readyCombos.length} confrontos × {tickets.length} quadras
                    {yankeeData?.board?.stats?.approved_count > readyCombos.length
                      ? ` · ${yankeeData.board.stats.approved_count} aprovados`
                      : ""}
                  </span>
                )}
                {bibdFreq.size > 0 && (
                  <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold tracking-wide border ${
                    isBibd
                      ? "border-emerald-500/40 bg-emerald-500/12 text-emerald-300"
                      : "border-amber-500/40 bg-amber-500/12 text-amber-300"
                  }`}>
                    {isBibd ? "BIBD 4× cada" : "balanceamento parcial"}
                  </span>
                )}
              </div>
            </header>

            {!tickets.length ? (
              <p className="text-gray-600 text-sm text-center py-10">{loading ? "Montando bilhetes…" : "Execute o pipeline primeiro."}</p>
            ) : (
              <>
                {/* Matriz Yankee — JOGO 1..4 × ODD do confronto + ODD final + STAKE + STATUS + RESUMO */}
                {/* Mini card de resultados da Yankee */}
                {(() => {
                  const ticketBoards = tickets.map((t: any) => getTicketBoards(t).filter(Boolean));
                  const uniqueConfrontos = new Map<string, any>();
                  for (const boards of ticketBoards) {
                    for (const c of boards) {
                      const head = c?.legs?.[0] ?? {};
                      const key = c?.match_id ?? `${head.home ?? ""}|${head.away ?? ""}`;
                      if (!key || uniqueConfrontos.has(key)) continue;
                      uniqueConfrontos.set(key, aggregateLegsResult(c?.legs));
                    }
                  }
                  const uniqueResults = [...uniqueConfrontos.values()];
                  const allPerConfronto = ticketBoards.map((boards: any[]) => {
                    return boards.map((c) => aggregateLegsResult(c?.legs));
                  });
                  const hasSettled = uniqueResults.some((x) => x.status !== "PEND");
                  if (!hasSettled) return null;
                  const totalGreen = uniqueResults.filter((x) => x.status === "GREEN").length;
                  const totalRed = uniqueResults.filter((x) => x.status === "RED").length;
                  let acertos3 = 0, acertos4 = 0;
                  for (const pc of allPerConfronto) {
                    const g = pc.filter((x) => x.status === "GREEN").length;
                    if (g === 4) acertos4++;
                    else if (g === 3) acertos3++;
                  }
                  return (
                    <div className="grid grid-cols-4 gap-2">
                      {/* GREEN */}
                      <div className="rounded-xl border border-emerald-500/25 bg-[linear-gradient(160deg,rgba(6,46,28,0.60)_0%,rgba(12,22,18,0.92)_100%)] p-3 text-center shadow-[0_4px_14px_rgba(0,0,0,0.22)]">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300/55">Greens</div>
                        <div className="text-2xl font-bold font-mono text-emerald-300 mt-1 leading-none">{totalGreen}</div>
                        <div className="mt-1 text-[10px] text-white/35">confrontos ✓</div>
                      </div>
                      {/* RED */}
                      <div className="rounded-xl border border-rose-500/25 bg-[linear-gradient(160deg,rgba(46,6,18,0.60)_0%,rgba(22,10,14,0.92)_100%)] p-3 text-center shadow-[0_4px_14px_rgba(0,0,0,0.22)]">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-300/55">Reds</div>
                        <div className="text-2xl font-bold font-mono text-rose-300 mt-1 leading-none">{totalRed}</div>
                        <div className="mt-1 text-[10px] text-white/35">confrontos ✗</div>
                      </div>
                      {/* 3 ACERTOS */}
                      <div className="rounded-xl border border-amber-500/25 bg-[linear-gradient(160deg,rgba(42,26,4,0.60)_0%,rgba(22,18,8,0.92)_100%)] p-3 text-center shadow-[0_4px_14px_rgba(0,0,0,0.22)]">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-300/55">3 acertos</div>
                        <div className="text-2xl font-bold font-mono text-amber-300 mt-1 leading-none">{acertos3}</div>
                        <div className="mt-1 text-[10px] text-white/35">quadras 3/4</div>
                      </div>
                      {/* 4 ACERTOS */}
                      <div className="rounded-xl border border-cyan-500/25 bg-[linear-gradient(160deg,rgba(4,28,42,0.60)_0%,rgba(8,18,26,0.92)_100%)] p-3 text-center shadow-[0_4px_14px_rgba(0,0,0,0.22)]">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300/55">4 acertos</div>
                        <div className="text-2xl font-bold font-mono text-cyan-300 mt-1 leading-none">{acertos4}</div>
                        <div className="mt-1 text-[10px] text-white/35">quadras 4/4</div>
                      </div>
                    </div>
                  );
                })()}

                <div className={TABLE_SHELL}>
                  <table className="w-full text-xs">
                    <thead className={TABLE_HEAD}>
                      <tr className={TABLE_HEAD_ROW}>
                        <th className="text-left py-2 px-3 font-medium">#</th>
                        {[1,2,3,4].map((n) => (
                          <th key={`h-${n}`} className="text-left py-2 px-2 font-medium" colSpan={2}>Jogo {n}</th>
                        ))}
                        <th className="text-right py-2 px-3 font-medium">Odd final</th>
                        <th className="text-right py-2 px-3 font-medium">Stake</th>
                        <th className="text-center py-2 px-3 font-medium">Status</th>
                        <th className="text-center py-2 px-3 font-medium">Resumo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tickets.map((t: any, i: number) => {
                        const legs: any[] = getTicketBoards(t);
                        const submitted = !!yankeeSubmitResult?.tickets?.some?.((x: any) => x.ticket_idx === (t.ticket_idx ?? i));
                        const tStatus = submitted ? "SUBMETIDO" : "READY";
                        // Resumo: agrega resultados das legs já enriquecidas pelo backend.
                        // Cada confronto é GREEN se TODAS as suas legs forem green.
                        const perConfronto = legs.map((c) => aggregateLegsResult(c?.legs));
                        const greens = perConfronto.filter((x) => x.status === "GREEN").length;
                        const reds = perConfronto.filter((x) => x.status === "RED").length;
                        const settled = greens + reds;
                        // Fallback in-memory (compat com settleResult legacy)
                        let resumoTxt: string;
                        if (settled > 0) {
                          resumoTxt = `${greens}/${legs.length} g · ${reds} R`;
                        } else {
                          const legacy = (settleResult?.results ?? []).filter((r: any) =>
                            legs.some((c) => r.match_id === c.match_id));
                          const g2 = legacy.filter((r: any) => r.status === "won").length;
                          const r2 = legacy.filter((r: any) => r.status === "lost").length;
                          resumoTxt = legacy.length ? `${g2}/${legs.length} g · ${r2} R` : `${legs.length}/${legs.length} prontas`;
                        }
                        const resumoColor = reds > 0
                          ? "text-rose-300"
                          : (settled > 0 && greens === legs.length)
                            ? "text-emerald-300"
                            : "text-gray-400";
                        return (
                          <tr key={i} className={TABLE_ROW}>
                            <td className="py-2 px-3 font-mono text-gray-500">#{String((t.ticket_idx ?? i) + 1).padStart(2, "0")}</td>
                            {Array.from({ length: 4 }).map((_, j) => {
                              const c = legs[j];
                              if (!c) return (<td key={`l-${j}`} colSpan={2} className="py-2 px-2 text-gray-700">—</td>);
                              const leg = c.legs?.[0] ?? {};
                              const ciIdx = (t.confronto_indices ?? [])[j];
                              const cellAgg = perConfronto[j];
                              const cellIcon = cellAgg.status === "GREEN" ? "✓" : cellAgg.status === "RED" ? "X" : "O";
                              const cellColor = cellAgg.status === "GREEN" ? "text-emerald-300"
                                : cellAgg.status === "RED" ? "text-rose-300" : "text-amber-300";
                              return (
                                <Fragment key={`l-${j}`}>
                                  <td
                                    className="py-2 px-2 cursor-help outline-none focus-visible:ring-1 focus-visible:ring-emerald-400/70"
                                    tabIndex={0}
                                    onMouseEnter={(event) => showYankeeHover(event, c, leg)}
                                    onFocus={(event) => showYankeeHover(event, c, leg)}
                                    onMouseLeave={() => setYankeeHover(null)}
                                    onBlur={() => setYankeeHover(null)}
                                  >
                                    <div className="flex items-center gap-1.5 max-w-[18ch] truncate">
                                      <span className="font-mono text-[10px] text-gray-500">{String((ciIdx ?? 0) + 1).padStart(2, "0")}</span>
                                      <span className={`${cellColor} shrink-0 font-bold`}>{cellIcon}</span>
                                      <span className="text-gray-200 truncate">{leg.home ?? "?"} × {leg.away ?? "?"}</span>
                                    </div>
                                  </td>
                                  <td className="py-2 px-2 text-right font-mono text-gray-300 whitespace-nowrap">{c.combo_odd?.toFixed?.(2) ?? "—"}</td>
                                </Fragment>
                              );
                            })}
                            <td className="py-2 px-3 text-right font-mono text-green-400 font-bold">{t.ticket_odd?.toFixed(2) ?? "—"}</td>
                            <td className="py-2 px-3 text-right font-mono text-white">R$ {t.stake_brl?.toFixed(2) ?? "—"}</td>
                            <td className="py-2 px-3 text-center">
                              <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold font-mono ${
                                tStatus === "SUBMETIDO" ? "bg-cyan-900/40 border border-cyan-700/40 text-cyan-300" : "bg-emerald-950/25 border border-emerald-500/20 text-emerald-100/65"
                              }`}>{tStatus}</span>
                            </td>
                            <td className="py-2 px-3 text-center font-mono text-[11px] {resumoColor}"><span className={resumoColor}>{resumoTxt}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {yankeeHover && (
                  <div
                    className="pointer-events-none fixed z-80 max-h-[70vh] overflow-y-auto rounded-xl border border-emerald-500/35 bg-[linear-gradient(180deg,rgba(8,38,32,0.98)_0%,rgba(12,18,18,0.99)_100%)] p-3 text-[11px] text-white shadow-[0_24px_60px_rgba(0,0,0,0.62)] ring-1 ring-emerald-400/10"
                    style={{ left: yankeeHover.left, top: yankeeHover.top, width: yankeeHover.width }}
                  >
                    <div className="font-semibold text-emerald-200">{yankeeHover.leg?.home} × {yankeeHover.leg?.away}</div>
                    <div className="mt-1 text-white/55">Liga: <span className="text-white/80">{yankeeHover.leg?.liga}</span></div>
                    <div className="mt-2 grid grid-cols-3 gap-1 border-t border-emerald-500/15 pt-2">
                      <div><div className="text-white/45">Odd conf.</div><div className="font-mono font-semibold text-emerald-300">{yankeeHover.combo?.combo_odd?.toFixed?.(2) ?? "—"}</div></div>
                      <div><div className="text-white/45">Legs</div><div className="font-mono text-cyan-300">{yankeeHover.combo?.n_legs ?? yankeeHover.combo?.legs?.length ?? "—"}</div></div>
                      <div><div className="text-white/45">Score</div><div className="font-mono text-yellow-300">{yankeeHover.combo?.quality_score?.toFixed?.(2) ?? "—"}</div></div>
                    </div>
                    <div className="mt-2 space-y-1.5 border-t border-emerald-500/15 pt-2">
                      {(yankeeHover.combo?.legs ?? []).map((x: any, k: number) => (
                        <div key={k} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
                          <span className="min-w-0">
                            <span className="text-white/55">{x.family ?? "—"}</span>
                            <span className="font-mono text-white/90 break-all"> · {x.market_key}</span>
                            <span className="font-mono text-yellow-300"> · edge {x.edge_pct?.toFixed?.(2) ?? "—"}%</span>
                          </span>
                          <ResultBadge result={x.result} actual={x.actual_value} leg={x} size="xs" />
                          <span className="font-mono text-emerald-300">{x.market_odd?.toFixed?.(2) ?? "—"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Total */}
                <div className={`${SOFT_CARD} p-3 flex items-center justify-between`}>
                  <span className="text-sm text-gray-400">Total investido</span>
                  <span className="text-sm font-bold text-white font-mono">R$ {tickets.reduce((s: number, t: any) => s + (t.stake_brl ?? 0), 0).toFixed(2)}</span>
                </div>

                {/* BIBD Frequency Card (Bloco 3.3) */}
                {bibdFreq.size > 0 && (
                  <div className={`${SOFT_CARD} p-4 space-y-3`}>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Frequência BIBD por Confronto</h3>
                    <div className="grid grid-cols-5 gap-1.5">
                      {[...bibdFreq.entries()].sort((a,b) => a[0]-b[0]).map(([ci, count]) => (
                        <div key={ci} className={`rounded-lg p-2 text-center ${count === 4 ? "bg-green-950/60 border border-green-800/40" : "bg-yellow-950/40 border border-yellow-700/40"}`}>
                          <div className="text-xs text-gray-500">#{ci+1}</div>
                          <div className={`text-sm font-bold font-mono ${count === 4 ? "text-green-400" : "text-yellow-400"}`}>{count}×</div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-gray-600">BIBD balanceado = cada confronto aparece exatamente 4× nos 10 bilhetes.</p>
                  </div>
                )}

                {/* Controles de submissão (Bloco 3.4) ─────────────────────── */}
                <div className={`${SOFT_CARD} p-4 space-y-3`}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Submissão</h3>
                    <span className="text-xs text-gray-600">Stake total: <span className="text-white font-mono font-semibold">R$ {(tickets.length * yankeeStake).toFixed(2)}</span></span>
                  </div>

                  {simulationMode && (
                    <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-200">
                      Simulação ativa: envio real bloqueado. O Dry-run Superbet continua liberado para validar catálogo e quote sem apostar.
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <label className="text-xs text-gray-400 flex items-center gap-2">
                      Stake por ticket (R$)
                      <input
                        type="number"
                        min={1}
                        max={100}
                        step={0.5}
                        value={yankeeStake}
                        onChange={(e) => setYankeeStake(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                        disabled={yankeeSubmitLoading || yankeeSubmitConfirm}
                        className="w-20 rounded border border-emerald-500/25 bg-black/25 px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-emerald-400 disabled:opacity-50"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={handleYankeeDryRun}
                      disabled={yankeeDryRunLoading || yankeeSubmitLoading || yankeeSubmitConfirm}
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-cyan-500/35 bg-[linear-gradient(135deg,rgba(8,60,75,0.70)_0%,rgba(8,30,40,0.90)_100%)] text-cyan-200 hover:border-cyan-400/55 hover:bg-cyan-950/70 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                    >
                      {yankeeDryRunLoading ? (
                        <><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />Validando…</>
                      ) : (
                        <>✓³ Dry-run Superbet</>
                      )}
                    </button>

                    {!yankeeSubmitConfirm ? (
                      <button
                        type="button"
                        onClick={startYankeeSubmitConfirm}
                        disabled={simulationMode || yankeeSubmitLoading || tickets.length === 0}
                        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-rose-500/35 bg-[linear-gradient(135deg,rgba(60,15,22,0.65)_0%,rgba(22,10,15,0.90)_100%)] text-rose-300/80 hover:border-rose-500/55 hover:text-rose-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-medium"
                      >
                        {simulationMode ? "Submit real bloqueado" : yankeeSubmitLoading ? "Submetendo…" : "Submeter Yankee real"}
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={handleYankeeSubmit}
                          disabled={simulationMode || yankeeSubmitLoading}
                          className="text-xs px-3 py-1.5 rounded bg-red-700 border border-red-500 text-white font-semibold animate-pulse"
                        >
                          Confirmar ({yankeeSubmitCountdown}s)
                        </button>
                        <button
                          type="button"
                          onClick={cancelYankeeSubmit}
                          className={`text-xs px-2 py-1.5 rounded ${SUBTLE_BUTTON}`}
                        >
                          Cancelar
                        </button>
                      </>
                    )}
                  </div>

                  {/* Resultado dry-run */}
                  {yankeeDryRunResult && (() => {
                    const isBlocked = (yankeeDryRunResult.blocking?.length ?? 0) > 0;
                    const hasWarn   = (yankeeDryRunResult.warnings?.length ?? 0) > 0;
                    const statusLabel = isBlocked ? "TRAVA" : hasWarn ? "AVISO" : "PASS";
                    const statusCls   = isBlocked
                      ? "border-amber-500/45 bg-amber-500/14 text-amber-200"
                      : hasWarn
                        ? "border-amber-500/40 bg-amber-500/12 text-amber-200"
                        : "border-emerald-500/40 bg-emerald-500/12 text-emerald-300";
                    const outerCls    = isBlocked
                      ? "border-amber-500/35 bg-[linear-gradient(160deg,rgba(13,42,35,0.70)_0%,rgba(42,26,4,0.42)_48%,rgba(18,24,24,0.97)_100%)]"
                      : hasWarn
                        ? "border-amber-500/35 bg-[linear-gradient(160deg,rgba(42,26,4,0.72)_0%,rgba(20,16,8,0.97)_100%)]"
                        : "border-emerald-500/35 bg-[linear-gradient(160deg,rgba(6,46,28,0.72)_0%,rgba(10,20,16,0.97)_100%)]";
                    return (
                      <div className={`text-xs rounded-xl border p-4 space-y-3 shadow-[0_10px_32px_rgba(0,0,0,0.42)] ${outerCls}`}>
                        {/* Linha de status */}
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full border ${statusCls}`}>
                              {statusLabel}
                            </span>
                            <span className="font-semibold text-white/85">Dry-run Superbet</span>
                          </div>
                          <span className="font-mono text-white/60 text-[11px]">
                            {yankeeDryRunResult.tickets_count} tickets · R$ {yankeeDryRunResult.stake_per_ticket}/ticket · <span className="text-white font-semibold">R$ {yankeeDryRunResult.stake_total} total</span>
                          </span>
                        </div>
                        {/* Escopo */}
                        <div className="text-[11px] text-white/40">
                          Escopo: {fmtValidationScope(yankeeDryRunResult.validation_scope)}
                        </div>
                        {/* Bloqueios */}
                        {isBlocked && (
                          <div className="flex flex-wrap gap-1.5">
                            {yankeeDryRunResult.blocking.map((b: string, i: number) => (
                              <span key={i} className="rounded-lg border border-amber-500/50 bg-amber-500/20 px-2.5 py-1 text-[10px] font-semibold font-mono text-amber-100 shadow-[0_2px_8px_rgba(180,120,0,0.18)]">⚠ {b}</span>
                            ))}
                          </div>
                        )}
                        {/* Avisos */}
                        {!isBlocked && hasWarn && (
                          <div className="flex flex-wrap gap-1.5">
                            {yankeeDryRunResult.warnings.slice(0, 3).map((w: string, i: number) => (
                              <span key={i} className="rounded-lg border border-amber-500/50 bg-amber-500/20 px-2.5 py-1 text-[10px] font-semibold font-mono text-amber-100 shadow-[0_2px_8px_rgba(180,120,0,0.18)]">⚠ {w}</span>
                            ))}
                          </div>
                        )}
                        {/* Summary cards */}
                        {yankeeDrySummary && (
                          <div className="space-y-2">
                            <div className="grid grid-cols-3 gap-2">
                              <div className={`rounded-xl border px-3 py-3 shadow-[0_4px_14px_rgba(0,0,0,0.28)] ${
                                yankeeDrySummary.tickets_ok === yankeeDrySummary.tickets_total
                                  ? "border-emerald-500/30 bg-[linear-gradient(160deg,rgba(6,46,28,0.72)_0%,rgba(12,22,18,0.95)_100%)]"
                                  : "border-amber-500/30 bg-[linear-gradient(160deg,rgba(42,26,4,0.72)_0%,rgba(22,18,8,0.95)_100%)]"
                              }`}>
                                <div className="text-[10px] font-semibold uppercase tracking-wider text-white/55">Tickets liberados</div>
                                <div className={`font-mono text-2xl font-bold leading-none mt-1 ${
                                  yankeeDrySummary.tickets_ok === yankeeDrySummary.tickets_total ? "text-emerald-300" : "text-amber-300"
                                }`}>{yankeeDrySummary.tickets_ok}<span className="text-sm font-normal text-white/40">/{yankeeDrySummary.tickets_total}</span></div>
                              </div>
                              <div className={`rounded-xl border px-3 py-3 shadow-[0_4px_14px_rgba(0,0,0,0.28)] ${
                                yankeeDrySummary.boards_ok === yankeeDrySummary.boards_total
                                  ? "border-emerald-500/30 bg-[linear-gradient(160deg,rgba(6,46,28,0.72)_0%,rgba(12,22,18,0.95)_100%)]"
                                  : "border-amber-500/30 bg-[linear-gradient(160deg,rgba(42,26,4,0.72)_0%,rgba(22,18,8,0.95)_100%)]"
                              }`}>
                                <div className="text-[10px] font-semibold uppercase tracking-wider text-white/55">Boards OK</div>
                                <div className={`font-mono text-2xl font-bold leading-none mt-1 ${
                                  yankeeDrySummary.boards_ok === yankeeDrySummary.boards_total ? "text-emerald-300" : "text-amber-300"
                                }`}>{yankeeDrySummary.boards_ok}<span className="text-sm font-normal text-white/40">/{yankeeDrySummary.boards_total}</span></div>
                              </div>
                              <div className={`rounded-xl border px-3 py-3 shadow-[0_4px_14px_rgba(0,0,0,0.28)] ${
                                yankeeDrySummary.gaps_total === 0
                                  ? "border-emerald-500/30 bg-[linear-gradient(160deg,rgba(6,46,28,0.72)_0%,rgba(12,22,18,0.95)_100%)]"
                                  : "border-amber-500/30 bg-[linear-gradient(160deg,rgba(42,26,4,0.72)_0%,rgba(22,18,8,0.95)_100%)]"
                              }`}>
                                <div className="text-[10px] font-semibold uppercase tracking-wider text-white/55">Issues</div>
                                <div className={`font-mono text-2xl font-bold leading-none mt-1 ${
                                  yankeeDrySummary.gaps_total === 0 ? "text-emerald-300" : "text-amber-300"
                                }`}>{yankeeDrySummary.gaps_total}</div>
                              </div>
                            </div>
                            {/* Gap list */}
                            {yankeeDryGaps.length > 0 && (
                              <div className="rounded-xl border border-amber-500/30 bg-[linear-gradient(160deg,rgba(42,26,4,0.45)_0%,rgba(18,14,4,0.90)_100%)] divide-y divide-amber-500/10">
                                <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-amber-300/90">
                                  ⚠ Travas detectadas ({yankeeDryGaps.length})
                                </div>
                                {yankeeDryGaps.map((gap: any, idx: number) => (
                                  <div key={idx} className="px-3 py-2.5 flex items-start gap-2 flex-wrap">
                                    <span className="text-white/90 font-semibold shrink-0">{gap.match ?? "—"}</span>
                                    <span className="rounded-md border border-amber-500/45 bg-amber-500/18 px-1.5 py-0.5 text-[10px] font-semibold font-mono text-amber-100 shrink-0">
                                      {fmtValidationReason(gap.reason)}
                                    </span>
                                    {gap.market_key && (
                                      <span className="rounded-md border border-cyan-500/25 bg-cyan-500/8 px-1.5 py-0.5 text-[10px] font-mono text-cyan-300/70">
                                        {gap.market_key}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {/* Footer */}
                        <div className="text-[10px] font-mono text-white/25">ID: {yankeeDryRunResult.submission_id}</div>
                      </div>
                    );
                  })()}

                  {/* Resultado submit */}
                  {yankeeSubmitResult && (() => {
                    const isOk = yankeeSubmitResult.status === "submitted";
                    const outerCls = isOk
                      ? "border-emerald-500/35 bg-[linear-gradient(160deg,rgba(6,46,28,0.72)_0%,rgba(10,20,16,0.97)_100%)]"
                      : "border-rose-500/35 bg-[linear-gradient(160deg,rgba(46,6,18,0.72)_0%,rgba(22,12,16,0.97)_100%)]";
                    const statusCls = isOk
                      ? "border-emerald-500/40 bg-emerald-500/12 text-emerald-300"
                      : "border-rose-500/40 bg-rose-500/12 text-rose-200";
                    return (
                      <div className={`text-xs rounded-xl border p-4 space-y-3 shadow-[0_10px_32px_rgba(0,0,0,0.42)] ${outerCls}`}>
                        {/* Status */}
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full border ${statusCls}`}>
                              {isOk ? "✓ SUBMETIDO" : "✗ REJEITADO"}
                            </span>
                            <span className="font-semibold text-white/85">Yankee Superbet</span>
                          </div>
                          <span className="font-mono text-white/60 text-[11px]">
                            {yankeeSubmitResult.tickets_count} tickets · <span className="text-white font-semibold">R$ {yankeeSubmitResult.stake_total} total</span>
                          </span>
                        </div>
                        <div className="text-[11px] text-white/40">Escopo: {fmtValidationScope(yankeeSubmitResult.validation_scope)}</div>
                        {/* Bloqueios */}
                        {(yankeeSubmitResult.blocking?.length ?? 0) > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {yankeeSubmitResult.blocking.map((b: string, i: number) => (
                              <span key={i} className="rounded-lg border border-rose-500/50 bg-rose-500/20 px-2.5 py-1 text-[10px] font-semibold font-mono text-rose-100 shadow-[0_2px_8px_rgba(180,0,40,0.18)]">✗ {b}</span>
                            ))}
                          </div>
                        )}
                        {/* Summary cards */}
                        {yankeeSubmitSummary && (
                          <div className="space-y-2">
                            <div className="grid grid-cols-3 gap-2">
                              <div className={`rounded-xl border px-3 py-3 shadow-[0_4px_14px_rgba(0,0,0,0.28)] ${
                                yankeeSubmitSummary.tickets_ok === yankeeSubmitSummary.tickets_total
                                  ? "border-emerald-500/30 bg-[linear-gradient(160deg,rgba(6,46,28,0.72)_0%,rgba(12,22,18,0.95)_100%)]"
                                  : "border-amber-500/30 bg-[linear-gradient(160deg,rgba(42,26,4,0.72)_0%,rgba(22,18,8,0.95)_100%)]"
                              }`}>
                                <div className="text-[10px] font-semibold uppercase tracking-wider text-white/55">Tickets liberados</div>
                                <div className={`font-mono text-2xl font-bold leading-none mt-1 ${
                                  yankeeSubmitSummary.tickets_ok === yankeeSubmitSummary.tickets_total ? "text-emerald-300" : "text-amber-300"
                                }`}>{yankeeSubmitSummary.tickets_ok}<span className="text-sm font-normal text-white/40">/{yankeeSubmitSummary.tickets_total}</span></div>
                              </div>
                              <div className={`rounded-xl border px-3 py-3 shadow-[0_4px_14px_rgba(0,0,0,0.28)] ${
                                yankeeSubmitSummary.boards_ok === yankeeSubmitSummary.boards_total
                                  ? "border-emerald-500/30 bg-[linear-gradient(160deg,rgba(6,46,28,0.72)_0%,rgba(12,22,18,0.95)_100%)]"
                                  : "border-amber-500/30 bg-[linear-gradient(160deg,rgba(42,26,4,0.72)_0%,rgba(22,18,8,0.95)_100%)]"
                              }`}>
                                <div className="text-[10px] font-semibold uppercase tracking-wider text-white/55">Boards OK</div>
                                <div className={`font-mono text-2xl font-bold leading-none mt-1 ${
                                  yankeeSubmitSummary.boards_ok === yankeeSubmitSummary.boards_total ? "text-emerald-300" : "text-amber-300"
                                }`}>{yankeeSubmitSummary.boards_ok}<span className="text-sm font-normal text-white/40">/{yankeeSubmitSummary.boards_total}</span></div>
                              </div>
                              <div className={`rounded-xl border px-3 py-3 shadow-[0_4px_14px_rgba(0,0,0,0.28)] ${
                                yankeeSubmitSummary.gaps_total === 0
                                  ? "border-emerald-500/30 bg-[linear-gradient(160deg,rgba(6,46,28,0.72)_0%,rgba(12,22,18,0.95)_100%)]"
                                  : "border-rose-500/30 bg-[linear-gradient(160deg,rgba(46,6,18,0.72)_0%,rgba(22,10,14,0.95)_100%)]"
                              }`}>
                                <div className="text-[10px] font-semibold uppercase tracking-wider text-white/55">Issues</div>
                                <div className={`font-mono text-2xl font-bold leading-none mt-1 ${
                                  yankeeSubmitSummary.gaps_total === 0 ? "text-emerald-300" : "text-rose-300"
                                }`}>{yankeeSubmitSummary.gaps_total}</div>
                              </div>
                            </div>
                            {yankeeSubmitGaps.length > 0 && (
                              <div className="rounded-xl border border-rose-500/30 bg-[linear-gradient(160deg,rgba(46,6,18,0.45)_0%,rgba(18,8,12,0.90)_100%)] divide-y divide-rose-500/10">
                                <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-rose-300/90">
                                  ✗ Motivos da rejeição ({yankeeSubmitGaps.length})
                                </div>
                                {yankeeSubmitGaps.map((gap: any, idx: number) => (
                                  <div key={idx} className="px-3 py-2.5 flex items-start gap-2 flex-wrap">
                                    <span className="text-white/90 font-semibold shrink-0">{gap.match ?? "—"}</span>
                                    <span className="rounded-md border border-rose-500/45 bg-rose-500/18 px-1.5 py-0.5 text-[10px] font-semibold font-mono text-rose-100 shrink-0">
                                      {fmtValidationReason(gap.reason)}
                                    </span>
                                    {gap.market_key && (
                                      <span className="rounded-md border border-cyan-500/25 bg-cyan-500/8 px-1.5 py-0.5 text-[10px] font-mono text-cyan-300/70">
                                        {gap.market_key}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        <div className="text-[10px] font-mono text-white/25">ID: {yankeeSubmitResult.submission_id}</div>
                      </div>
                    );
                  })()}
                </div>
              </>
            )}
          </section>
        )}

        {/* ════════════════════════════════════════════ AGRESSIVAS */}
        {activeTab === "agressivas" && (() => {
          // Helpers locais
          const periodOf = (mk: any): "ft" | "ht" | "1t" => {
            const s = String(mk ?? "").toLowerCase();
            if (s.includes("1t") || s.includes("1st_half") || s.includes("first_half")) return "1t";
            if (s.includes("ht") || s.includes("half_time") || s.includes("halftime")) return "ht";
            return "ft";
          };
          const matchSearch = (d: any) => {
            if (!aggSearch.trim()) return true;
            const q = aggSearch.trim().toLowerCase();
            return [d.home, d.away, d.liga].some((x) => String(x ?? "").toLowerCase().includes(q));
          };
          const familyOf = (d: any): string[] => {
            const legs = d.legs ?? [d.leg_a, d.leg_b].filter(Boolean);
            return legs.map((l: any) => String(l.family ?? "")).filter(Boolean);
          };

          // Universo p/ chips
          const allFamilies = new Set<string>();
          const allLigas    = new Set<string>();
          for (const d of duplas) {
            familyOf(d).forEach((f) => allFamilies.add(f));
            if (d.liga) allLigas.add(d.liga);
          }
          for (const p of singlesEv) {
            if (p.family) allFamilies.add(p.family);
            if (p.liga) allLigas.add(p.liga);
          }
          const famList  = [...allFamilies].sort();
          const ligaList = [...allLigas].sort();

          // Filtros
          const filteredDuplas = duplas.filter((d) => {
            if (!matchSearch(d)) return false;
            if (aggLigas.size > 0 && !aggLigas.has(d.liga)) return false;
            if (aggFamilies.size > 0) {
              const fams = familyOf(d);
              if (!fams.some((f) => aggFamilies.has(f))) return false;
            }
            if (aggOnlyBoard && !inBoard(d.home, d.away)) return false;
            const odd = Number(d.combo_odd ?? 0);
            if (aggOddMin > 0 && odd < aggOddMin) return false;
            if (aggOddMax > 0 && odd > aggOddMax) return false;
            const legs = d.legs ?? [d.leg_a, d.leg_b].filter(Boolean);
            const edge = d.ev_sum_pct != null && (d.n_legs ?? legs.length) > 0
              ? d.ev_sum_pct / (d.n_legs ?? legs.length)
              : d.avg_edge ?? 0;
            if (aggEdgeMin > 0 && edge < aggEdgeMin) return false;
            if (aggPeriod !== "all") {
              const periods = legs.map((l: any) => periodOf(l.market_key ?? l.key));
              if (!periods.includes(aggPeriod)) return false;
            }
            return true;
          });
          const sortedDuplas = [...filteredDuplas].sort((a, b) => {
            const legsA = a.legs ?? [a.leg_a, a.leg_b].filter(Boolean);
            const legsB = b.legs ?? [b.leg_a, b.leg_b].filter(Boolean);
            const edA = a.ev_sum_pct != null && (a.n_legs ?? legsA.length) > 0
              ? a.ev_sum_pct / (a.n_legs ?? legsA.length) : a.avg_edge ?? 0;
            const edB = b.ev_sum_pct != null && (b.n_legs ?? legsB.length) > 0
              ? b.ev_sum_pct / (b.n_legs ?? legsB.length) : b.avg_edge ?? 0;
            const oA = Number(a.combo_odd ?? 0);
            const oB = Number(b.combo_odd ?? 0);
            if (aggSort === "edge")    return edB - edA;
            if (aggSort === "odd_asc") return oA - oB;
            if (aggSort === "odd_desc")return oB - oA;
            if (aggSort === "ev")      return (b.ev_sum_pct ?? 0) - (a.ev_sum_pct ?? 0);
            return 0;
          });

          const filteredSingles = singlesEv.filter((p: any) => {
            if (!matchSearch(p)) return false;
            if (aggLigas.size > 0 && !aggLigas.has(p.liga)) return false;
            if (aggFamilies.size > 0 && !aggFamilies.has(p.family ?? "")) return false;
            if (aggOnlyBoard && !inBoard(p.home, p.away)) return false;
            const odd = Number(p.market_odd ?? 0);
            if (aggOddMin > 0 && odd < aggOddMin) return false;
            if (aggOddMax > 0 && odd > aggOddMax) return false;
            const edge = Number(p.edge_pct ?? 0);
            if (aggEdgeMin > 0 && edge < aggEdgeMin) return false;
            if (aggPeriod !== "all" && periodOf(p.market_key) !== aggPeriod) return false;
            return true;
          });

          const fmtAggShare = (count: number, total: number) => (
            total > 0 ? `${((count / total) * 100).toFixed(1)}% do total` : "—"
          );
          const fmtAggResultShare = (count: number, total: number) => (
            total > 0 ? `${((count / total) * 100).toFixed(1)}%` : "—"
          );
          const duplasResultStats = sortedDuplas.reduce((acc: any, d: any) => {
            const legs = d.legs ?? [d.leg_a, d.leg_b].filter(Boolean);
            const result = aggregateLegsResult(legs);
            if (result.status === "GREEN") acc.green += 1;
            else if (result.status === "RED") acc.red += 1;
            else acc.pending += 1;
            return acc;
          }, { green: 0, red: 0, pending: 0 });
          duplasResultStats.resolved = duplasResultStats.green + duplasResultStats.red;
          const singlesResultStats = filteredSingles.reduce((acc: any, p: any) => {
            if (p.result === "green") acc.green += 1;
            else if (p.result === "red") acc.red += 1;
            else acc.pending += 1;
            return acc;
          }, { green: 0, red: 0, pending: 0 });
          singlesResultStats.resolved = singlesResultStats.green + singlesResultStats.red;
          const showAggDuplas = aggProduct !== "simples";
          const showAggSingles = aggProduct !== "duplas";
          const duplasLegs = duplasData?.meta?.eligible_legs ?? picksData?.meta?.after_filter ?? 0;
          const duplasShare = fmtAggShare(sortedDuplas.length, duplas.length);
          const singlesShare = fmtAggShare(filteredSingles.length, singlesEv.length);

          const resetFilters = () => {
            setAggSearch(""); setAggFamilies(new Set()); setAggLigas(new Set());
            setAggPeriod("all"); setAggEdgeMin(0); setAggOddMin(0); setAggOddMax(0);
            setAggOnlyBoard(false); setAggSort("edge"); setAggProduct("all");
          };

          const toggleSet = (set: Set<string>, value: string, setter: (s: Set<string>) => void) => {
            const next = new Set(set);
            next.has(value) ? next.delete(value) : next.add(value);
            setter(next);
          };

          const activeFilters =
            (aggSearch ? 1 : 0) + aggFamilies.size + aggLigas.size +
            (aggPeriod !== "all" ? 1 : 0) + (aggEdgeMin > 0 ? 1 : 0) +
            (aggOddMin > 0 ? 1 : 0) + (aggOddMax > 0 ? 1 : 0) +
            (aggOnlyBoard ? 1 : 0) + (aggProduct !== "all" ? 1 : 0);

          return (
          <section className={`${PANEL} p-5 space-y-5`}>
            {/* Header */}
            <header className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-emerald-300" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-white/85">Agressivas EV+</h2>
              </div>
              <span className="text-[11px] text-white/55">
                {sortedDuplas.length < duplas.length ? `${sortedDuplas.length} de ${duplas.length}` : sortedDuplas.length} duplas · {filteredSingles.length < singlesEv.length ? `${filteredSingles.length} de ${singlesEv.length}` : filteredSingles.length} simples
                {activeFilters > 0 && <> · <span className="text-emerald-300">{activeFilters} filtro{activeFilters > 1 ? "s" : ""}</span></>}
              </span>
            </header>

            <div className="flex flex-col gap-2">
              {[
                {
                  id: "duplas",
                  label: "Duplas",
                  value: sortedDuplas.length < duplas.length
                    ? `${sortedDuplas.length} de ${duplas.length}`
                    : `${duplas.length}`,
                  detail: sortedDuplas.length < duplas.length
                    ? duplasShare
                    : "confrontos EV+",
                  meta: `${duplasLegs} legs EV+`,
                  results: duplasResultStats,
                  open: aggDuplasOpen,
                  onToggle: () => setAggDuplasOpen((open) => !open),
                  tone: "emerald",
                },
                {
                  id: "simples",
                  label: "Simples",
                  value: filteredSingles.length < singlesEv.length
                    ? `${filteredSingles.length} de ${singlesEv.length}`
                    : `${singlesEv.length}`,
                  detail: filteredSingles.length < singlesEv.length
                    ? singlesShare
                    : "mercados EV+",
                  meta: "mercados EV+",
                  results: singlesResultStats,
                  open: aggSinglesOpen,
                  onToggle: () => setAggSinglesOpen((open) => !open),
                  tone: "cyan",
                },
              ].map((card) => {
                const active = aggProduct === "all" || aggProduct === card.id;
                const tone = card.tone === "cyan"
                  ? "border-cyan-400/35 bg-cyan-500/10 text-cyan-100"
                  : "border-emerald-400/35 bg-emerald-500/10 text-emerald-100";
                return (
                  <div key={card.id} className={`${SOFT_CARD} px-4 py-3 flex items-center gap-4 flex-wrap ${active ? "" : "opacity-60"}`}>
                    {/* Título + volume */}
                    <div className="min-w-18">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-white/45">{card.label}</div>
                      <div className="text-base font-bold font-mono text-white leading-tight">{card.value}</div>
                      <div className={`text-[10px] font-mono ${card.tone === "cyan" ? "text-cyan-300" : "text-emerald-300"}`}>{card.detail}</div>
                    </div>
                    {/* Separador */}
                    <div className="w-px self-stretch bg-emerald-500/15 hidden sm:block" />
                    {/* Green */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold uppercase text-emerald-300/60">G</span>
                      <span className="text-base font-bold font-mono text-emerald-300 leading-tight">{card.results.green}</span>
                      <span className="text-[10px] font-mono text-emerald-300/70">{fmtAggResultShare(card.results.green, card.results.resolved)}</span>
                    </div>
                    {/* Red */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold uppercase text-rose-300/60">R</span>
                      <span className="text-base font-bold font-mono text-rose-300 leading-tight">{card.results.red}</span>
                      <span className="text-[10px] font-mono text-rose-300/70">{fmtAggResultShare(card.results.red, card.results.resolved)}</span>
                    </div>
                    {/* Base */}
                    <div className="text-[10px] text-white/35 hidden sm:block">
                      {card.results.resolved > 0
                        ? `${card.results.resolved} resol.${card.results.pending > 0 ? ` · ${card.results.pending} pend.` : ""}`
                        : card.results.pending > 0 ? `${card.results.pending} pend.` : "sem settlement"}
                    </div>
                    {/* Meta */}
                    <div className="text-[10px] text-white/35 ml-auto hidden md:block">{card.meta}</div>
                    {/* Separador */}
                    <div className="w-px self-stretch bg-emerald-500/15 hidden sm:block" />
                    {/* Ações */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => setAggProduct(card.id as "duplas" | "simples")}
                        className={`rounded-lg border px-2 py-0.5 text-[11px] font-medium transition-colors ${aggProduct === card.id ? tone : "border-emerald-500/18 bg-black/25 text-white/60 hover:border-emerald-400/40 hover:bg-emerald-500/10"}`}
                      >
                        Filtrar
                      </button>
                      <button
                        onClick={card.onToggle}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/18 bg-black/25 px-2 py-0.5 text-[11px] font-medium text-white/65 transition-colors hover:border-emerald-400/40 hover:bg-emerald-500/10"
                      >
                        {card.open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                        {card.open ? "Fechar" : "Abrir"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Filtros inteligentes ─────────────────────────────────── */}
            <div className={`${CARD} p-3 space-y-3`}>
              {/* Linha 1: busca + ordenação + reset */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-50">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40" />
                  <input
                    type="text"
                    value={aggSearch}
                    onChange={(e) => setAggSearch(e.target.value)}
                    placeholder="Buscar time ou liga…"
                    className="w-full bg-black/30 border border-emerald-500/20 rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder:text-white/35 focus:outline-none focus:border-emerald-400"
                  />
                </div>
                <div className="flex items-center gap-1 rounded-lg border border-emerald-500/18 bg-black/20 p-0.5">
                  {([
                    ["all", "Todos"],
                    ["duplas", "Duplas"],
                    ["simples", "Simples"],
                  ] as const).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setAggProduct(id)}
                      className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${aggProduct === id ? "bg-emerald-500/22 text-emerald-100" : "text-white/55 hover:bg-emerald-500/10 hover:text-white/75"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <ThemedSelect
                  value={aggSort}
                  ariaLabel="Ordenar agressivas"
                  options={[
                    { value: "edge", label: "↓ Edge médio" },
                    { value: "ev", label: "↓ EV soma" },
                    { value: "odd_desc", label: "↓ Odd combo" },
                    { value: "odd_asc", label: "↑ Odd combo" },
                  ]}
                  onChange={(nextSort) => setAggSort(nextSort as any)}
                  className="w-44"
                  buttonClassName="py-1.5 text-xs"
                  listClassName="text-xs"
                />
                <button
                  onClick={() => setAggOnlyBoard(!aggOnlyBoard)}
                  className={`text-[11px] px-2.5 py-1.5 rounded-lg border font-medium transition-colors ${aggOnlyBoard ? "bg-cyan-500/18 border-cyan-400/45 text-cyan-100" : "bg-black/25 border-emerald-500/18 text-white/60 hover:border-emerald-400/40 hover:bg-emerald-500/10"}`}
                >
                  no board {aggOnlyBoard && "✓"}
                </button>
                {activeFilters > 0 && (
                  <button
                    onClick={resetFilters}
                    className="text-[11px] px-2.5 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 transition-colors"
                  >
                    Limpar
                  </button>
                )}
              </div>

              {/* Linha 2: período + edge + odds */}
              <div className="flex flex-wrap items-center gap-3 text-[11px]">
                <div className="flex items-center gap-1">
                  <span className="text-white/55 uppercase tracking-wide text-[10px]">Período:</span>
                  {(["all", "ft", "ht", "1t"] as const).map((pid) => (
                    <button
                      key={pid}
                      onClick={() => setAggPeriod(pid)}
                      className={`px-2 py-0.5 rounded-md border font-mono uppercase transition-colors ${aggPeriod === pid ? "bg-emerald-500/25 border-emerald-400/50 text-emerald-100" : "bg-black/25 border-emerald-500/18 text-white/55 hover:border-emerald-400/40 hover:bg-emerald-500/10"}`}
                    >{pid === "all" ? "todos" : pid}</button>
                  ))}
                </div>
                <label className="flex items-center gap-1.5 text-white/65">
                  <span className="uppercase tracking-wide text-[10px]">Edge mín:</span>
                  <input
                    type="number" min={0} max={100} step={0.5} value={aggEdgeMin || ""}
                    onChange={(e) => setAggEdgeMin(Math.max(0, Number(e.target.value) || 0))}
                    placeholder="0"
                    className="w-14 bg-black/30 border border-emerald-500/20 rounded px-1.5 py-0.5 text-xs font-mono text-white focus:outline-none focus:border-emerald-400"
                  />
                  <span className="text-white/40">%</span>
                </label>
                <label className="flex items-center gap-1.5 text-white/65">
                  <span className="uppercase tracking-wide text-[10px]">Odd:</span>
                  <input
                    type="number" min={0} step={0.05} value={aggOddMin || ""}
                    onChange={(e) => setAggOddMin(Math.max(0, Number(e.target.value) || 0))}
                    placeholder="min"
                    className="w-14 bg-black/30 border border-emerald-500/20 rounded px-1.5 py-0.5 text-xs font-mono text-white focus:outline-none focus:border-emerald-400"
                  />
                  <span className="text-white/40">–</span>
                  <input
                    type="number" min={0} step={0.05} value={aggOddMax || ""}
                    onChange={(e) => setAggOddMax(Math.max(0, Number(e.target.value) || 0))}
                    placeholder="max"
                    className="w-14 bg-black/30 border border-emerald-500/20 rounded px-1.5 py-0.5 text-xs font-mono text-white focus:outline-none focus:border-emerald-400"
                  />
                </label>
              </div>

              {/* Linha 3: chips de famílias */}
              {famList.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-white/55 uppercase tracking-wide text-[10px] mr-1">Famílias:</span>
                  {famList.map((f) => {
                    const on = aggFamilies.has(f);
                    return (
                      <button
                        key={f}
                        onClick={() => toggleSet(aggFamilies, f, setAggFamilies)}
                        className={`text-[10px] px-2 py-0.5 rounded-md border font-mono transition-colors ${on ? "bg-emerald-500/25 border-emerald-400/50 text-emerald-100" : "bg-black/25 border-emerald-500/18 text-white/55 hover:border-emerald-400/40 hover:bg-emerald-500/10"}`}
                      >{f}</button>
                    );
                  })}
                </div>
              )}

              {/* Linha 4: chips de ligas */}
              {ligaList.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-white/55 uppercase tracking-wide text-[10px] mr-1">Ligas:</span>
                  {ligaList.map((l) => {
                    const on = aggLigas.has(l);
                    return (
                      <button
                        key={l}
                        onClick={() => toggleSet(aggLigas, l, setAggLigas)}
                        className={`text-[10px] px-2 py-0.5 rounded-md border transition-colors ${on ? "bg-cyan-500/20 border-cyan-400/50 text-cyan-100" : "bg-black/25 border-emerald-500/18 text-white/55 hover:border-emerald-400/40 hover:bg-emerald-500/10"}`}
                      >{l}</button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Duplas */}
            {showAggDuplas && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300/85">Duplas Same-Game</h3>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-white/55">{sortedDuplas.length} duplas · {duplasLegs} legs EV+</span>
                  <button
                    onClick={() => setAggDuplasOpen((open) => !open)}
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/18 bg-black/25 px-2.5 py-1 text-[11px] font-medium text-white/65 transition-colors hover:border-emerald-400/40 hover:bg-emerald-500/10"
                  >
                    {aggDuplasOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    {aggDuplasOpen ? "Fechar" : "Abrir"}
                  </button>
                </div>
              </div>

              {aggDuplasOpen && (!duplas.length ? (
                <p className="text-white/40 text-sm text-center py-8">{loading ? "Computando…" : picks.length > 0 ? "Sem partidas com ≥2 picks EV+ de famílias distintas." : "Execute o pipeline primeiro."}</p>
              ) : !sortedDuplas.length ? (
                <p className="text-white/40 text-sm text-center py-8">Nenhuma dupla atende aos filtros. <button onClick={resetFilters} className="text-emerald-300 hover:underline">Limpar filtros</button></p>
              ) : (
                sortedDuplas.map((d, i) => {
                  const expanded = expandedDuplas.has(i);
                  const onBoard  = inBoard(d.home, d.away);
                  const pairLegs = d.legs ?? [d.leg_a, d.leg_b].filter(Boolean);
                  const avgEdge = d.ev_sum_pct != null && (d.n_legs ?? pairLegs.length) > 0
                    ? d.ev_sum_pct / (d.n_legs ?? pairLegs.length)
                    : d.avg_edge ?? 0;
                  return (
                    <div key={i} className={`${CARD} overflow-hidden`}>
                      <button className="w-full text-left p-4 flex items-start gap-3 hover:bg-emerald-500/5 transition-colors" onClick={() => {
                        const s = new Set(expandedDuplas);
                        s.has(i) ? s.delete(i) : s.add(i);
                        setExpandedDuplas(s);
                      }}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-white">{d.home} × {d.away}</span>
                            {onBoard && <span className="text-[10px] px-1.5 py-0.5 rounded border border-cyan-400/40 bg-cyan-500/15 text-cyan-100">no board</span>}
                            {(() => {
                              const agg = aggregateLegsResult(pairLegs);
                              if (agg.total > 0 && (agg.greens > 0 || agg.reds > 0)) {
                                const color = agg.status === "GREEN" ? "bg-emerald-600/35 border-emerald-400 text-emerald-100"
                                  : agg.status === "RED" ? "bg-rose-600/35 border-rose-400 text-rose-100"
                                  : "bg-amber-600/25 border-amber-400/70 text-amber-100";
                                const ic = agg.status === "GREEN" ? "✓" : agg.status === "RED" ? "X" : "O";
                                return (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-md border font-mono font-bold ${color}`}>
                                    {ic} {agg.greens}/{agg.total} g · {agg.reds} R
                                  </span>
                                );
                              }
                              return null;
                            })()}
                            {pairLegs.map((l: any, k: number) => (
                              <span key={k} className="text-[9px] px-1.5 py-0.5 rounded border border-emerald-500/18 bg-emerald-950/20 text-emerald-100/65 font-mono">{l.family ?? "?"}</span>
                            ))}
                          </div>
                          <div className="text-[11px] text-white/45 mt-0.5">{d.liga}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xl font-bold text-yellow-400 font-mono">{Number(d.combo_odd ?? 0).toFixed(2)}</div>
                          <div className="text-[11px] text-emerald-300/85">edge: {avgEdge.toFixed(1)}%</div>
                        </div>
                        <div className="self-center ml-1">
                          {expanded ? <ChevronDown size={14} className="text-white/40" /> : <ChevronRight size={14} className="text-white/40" />}
                        </div>
                      </button>
                      {expanded && (
                        <div className="grid grid-cols-2 gap-2 px-4 pb-4">
                          {pairLegs.map((leg: any, j: number) => (
                            <div key={j} className="rounded-lg border border-emerald-500/15 bg-emerald-950/15 p-3 space-y-1">
                              <div className="flex items-start justify-between gap-2">
                                <div className="text-[12px] text-white/90 leading-snug flex-1">{prettyMarket(leg, { home: d.home, away: d.away })}</div>
                                <ResultBadge result={leg.result} actual={leg.actual_value} leg={leg} size="xs" />
                              </div>
                              <div className="text-[10px] font-mono text-white/40 break-all">{leg.market_key ?? leg.key}</div>
                              <div className="text-[11px] text-white/55">Família: <span className="text-white/75">{leg.family ?? "—"}</span></div>
                              <div className="flex justify-between text-xs mt-1">
                                <span className="text-yellow-300 font-mono font-semibold">{(leg.market_odd ?? leg.odd)?.toFixed?.(2) ?? "—"}</span>
                                <span className="text-emerald-300/85">edge: {(leg.edge_pct ?? leg.edge ?? 0).toFixed(1)}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              ))}
            </div>
            )}

            {/* Simples EV+ */}
            {showAggSingles && singlesEv.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300/85">Simples EV+</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-white/55">{filteredSingles.length}/{singlesEv.length} mercados</span>
                    <button
                      onClick={() => setAggSinglesOpen((open) => !open)}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/18 bg-black/25 px-2.5 py-1 text-[11px] font-medium text-white/65 transition-colors hover:border-emerald-400/40 hover:bg-emerald-500/10"
                    >
                      {aggSinglesOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {aggSinglesOpen ? "Fechar" : "Abrir"}
                    </button>
                  </div>
                </div>
                {aggSinglesOpen && (!filteredSingles.length ? (
                  <p className="text-white/40 text-sm text-center py-6">Nenhum mercado atende aos filtros.</p>
                ) : (
                  <div className={TABLE_SHELL}>
                    <table className="w-full text-xs">
                      <thead className={TABLE_HEAD}><tr className={TABLE_HEAD_ROW}>
                        <th className="text-left py-2 px-3 font-medium">Rank</th>
                        <th className="text-left py-2 pr-3 font-medium">Partida</th>
                        <th className="text-left py-2 pr-3 font-medium">Liga</th>
                        <th className="text-left py-2 pr-3 font-medium">Mercado</th>
                        <th className="text-right py-2 pr-3 font-medium">Odd</th>
                        <th className="text-right py-2 pr-3 font-medium">Edge%</th>
                        <th className="text-right py-2 pr-3 font-medium">Tier</th>
                        <th className="text-right py-2 pr-3 font-medium">Resultado</th>
                        <th className="text-right py-2 pr-3 font-medium">Board</th>
                      </tr></thead>
                      <tbody>
                        {filteredSingles.map((p: any, i: number) => (
                          <tr key={i} className={TABLE_ROW}>
                            <td className="py-1.5 px-3 text-white/40 font-mono">#{i+1}</td>
                            <td className="py-1.5 pr-3 text-white/85">{p.home ?? "—"} × {p.away ?? "—"}</td>
                            <td className="py-1.5 pr-3 text-white/45">{p.liga ?? "—"}</td>
                            <td className="py-1.5 pr-3 max-w-[34ch]">
                              <div className="text-white/85 leading-snug">{prettyMarket(p, { home: p.home, away: p.away })}</div>
                              <div className="text-[10px] font-mono text-white/35 break-all">{p.market_key ?? "—"}</div>
                            </td>
                            <td className="py-1.5 pr-3 text-right font-mono text-yellow-300 font-semibold">{p.market_odd?.toFixed(2) ?? "—"}</td>
                            <td className="py-1.5 pr-3 text-right font-mono text-emerald-300">{fmtEdge(p.edge_pct)}</td>
                            <td className="py-1.5 pr-3 text-right">
                              <span className={`px-1.5 py-0.5 rounded font-bold text-[10px] border ${tier(p.confidence) === "A" ? "bg-emerald-500/20 border-emerald-400/40 text-emerald-200" : tier(p.confidence) === "B" ? "bg-yellow-500/20 border-yellow-400/40 text-yellow-200" : "bg-emerald-950/20 border-emerald-500/15 text-white/50"}`}>
                                {tier(p.confidence)}
                              </span>
                            </td>
                            <td className="py-1.5 pr-3 text-right">
                              <ResultBadge result={p.result} actual={p.actual_value} leg={p} size="xs" />
                            </td>
                            <td className="py-1.5 pr-3 text-right">
                              {inBoard(p.home, p.away) ? <span className="text-xs text-cyan-300">✓</span> : <span className="text-xs text-white/25">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </section>
          );
        })()}

        {/* ════════════════════════════════════════════ RESOLVER */}
        {activeTab === "resolver" && (
          <section className={`${PANEL} p-5 space-y-5`}>
            <header className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-white/85">Resolver — Liquidar Run</h2>
            </header>

            {!runData ? (
              <p className="text-gray-600 text-sm text-center py-10">Nenhum run ativo. Execute o pipeline ou selecione um run no histórico.</p>
            ) : (
              <>
                {/* Run info */}
                <div className={`${SOFT_CARD} p-4 space-y-1.5`}>
                  <div className="text-xs text-gray-500">Run ativo</div>
                  <div className="font-mono text-sm text-emerald-300">{fmtRunSeq(runData)}</div>
                  <div className="text-xs text-gray-500">{runData.date_start} → {runData.date_end} · {runData.matches} partidas · ID {runShortId(runData.run_id)}</div>
                </div>

                {/* KPIs dinâmicos (Bloco 5.3) */}
                {resolverStats && (
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      ["Predições", resolverStats.count,     "text-white", null],
                      ["Green",     resolverStats.green,     "text-green-400", resolverGreenPct],
                      ["Red",       resolverStats.red,       "text-red-400", resolverRedPct],
                      ["Pendentes", resolverStats.pending,   resolverStats.pending > 0 ? "text-yellow-400" : "text-gray-500", null],
                      ["Cert.",     resolverStats.certified, "text-cyan-300", null],
                      ["Taxa",      resolverStats.green > 0 || resolverStats.red > 0
                        ? `${((resolverStats.green / Math.max(1, resolverStats.green + resolverStats.red)) * 100).toFixed(1)}%`
                        : "—",                          "text-emerald-400", null],
                    ].map(([l, v, c, detail]) => (
                      <div key={l as string} className={`${SOFT_CARD} p-3 text-center`}>
                        <div className={`text-xl font-bold ${c}`}>{v as any}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{l as string}</div>
                        {detail && (
                          <div className={`mt-1 text-[11px] font-mono ${l === "Green" ? "text-emerald-300" : "text-rose-300"}`}>
                            {detail as string}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {resolverActivity && (
                  <div className={`rounded-xl border p-4 space-y-3 ${
                    resolverActivity.status === "error" ? "bg-rose-950/30 border-rose-800/50" :
                    resolverActivity.status === "confirm" ? "bg-amber-950/30 border-amber-800/50" :
                    resolverActivity.status === "done" ? "bg-emerald-950/30 border-emerald-800/50" :
                    "bg-cyan-950/30 border-cyan-800/50"
                  }`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className={`text-xs font-semibold ${
                          resolverActivity.status === "error" ? "text-rose-300" :
                          resolverActivity.status === "confirm" ? "text-amber-300" :
                          resolverActivity.status === "done" ? "text-emerald-300" : "text-cyan-300"
                        }`}>{resolverActivity.title}</div>
                        <div className="text-xs text-gray-300 mt-1 truncate">{resolverActivity.detail}</div>
                      </div>
                      {resolverActivity.status === "running" ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-cyan-300" />
                      ) : resolverActivity.status === "done" ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />
                      ) : resolverActivity.status === "error" ? (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-rose-300" />
                      ) : (
                        <Clock className="h-4 w-4 shrink-0 text-amber-300" />
                      )}
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-950/70 border border-white/5">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          resolverActivity.status === "error" ? "bg-rose-400" :
                          resolverActivity.status === "confirm" ? "bg-amber-400" :
                          resolverActivity.status === "done" ? "bg-emerald-400" : "bg-cyan-400"
                        }`}
                        style={{ width: `${resolverActivity.status === "confirm" ? 12 : Math.min(100, ((resolverActivity.step + 1) / Math.max(1, resolverActivity.steps.length)) * 100)}%` }}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                      {resolverActivity.steps.map((stepLabel: string, stepIndex: number) => (
                        <div key={`${stepLabel}-${stepIndex}`} className={`rounded-lg border px-2 py-1.5 ${
                          stepIndex <= resolverActivity.step
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                            : "border-emerald-500/12 bg-black/25 text-white/40"
                        }`}>
                          {stepIndex + 1}. {stepLabel}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Dry-run result */}
                {dryRunResult && (
                  <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-4 space-y-1">
                    <div className="text-xs font-semibold text-cyan-300">Dry-run — simulação (sem gravação)</div>
                    <div className="text-xs text-gray-400">
                      Total: {dryRunResult.total ?? 0} · Settled: {dryRunResult.settled ?? 0} · Skipped: {dryRunResult.skipped ?? 0}
                    </div>
                  </div>
                )}

                {/* Settle result */}
                {settleResult && (
                  <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-xl p-4 space-y-1">
                    <div className="text-xs font-semibold text-emerald-300">Última liquidação gravada</div>
                    <div className="text-xs text-gray-300">
                      {settleResult.settled ?? 0} liquidadas · {settleResult.green ?? 0} green · {settleResult.red ?? 0} red
                      {typeof settleResult.skipped === "number" ? ` · ${settleResult.skipped} skipped` : ""}
                      {typeof settleResult.no_data === "number" ? ` · ${settleResult.no_data} sem dado` : ""}
                    </div>
                    {settleResult.settled === 0 && (
                      <div className="text-xs text-yellow-300 pt-1">
                        Nenhuma predição liquidada. Verifique se há resultados disponíveis no banco.
                      </div>
                    )}
                  </div>
                )}

                {/* Repair result (Bloco 5.1) */}
                {repairResult && (
                  <div className="bg-cyan-950/30 border border-cyan-800/40 rounded-xl p-4 space-y-1">
                    <div className="text-xs font-semibold text-cyan-300">Reparo concluído</div>
                    <div className="text-xs text-gray-300">
                      {repairResult.reset_predictions ?? 0} predições resetadas · {repairResult.settled ?? 0} reliquidadas
                      {typeof repairResult.skipped === "number" ? ` · ${repairResult.skipped} skipped` : ""}
                      {typeof repairResult.no_data  === "number" ? ` · ${repairResult.no_data} sem dado` : ""}
                    </div>
                  </div>
                )}

                {/* Botões */}
                <div className="grid grid-cols-3 gap-3">
                  <button onClick={() => settleRun(true)} disabled={dryRunLoading || settleLoading || repairLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-500/35 bg-cyan-500/15 py-2.5 text-sm font-medium text-cyan-100 transition-colors hover:bg-cyan-500/25 disabled:opacity-50">
                    {dryRunLoading && <Loader2 size={14} className="animate-spin" />}
                    {dryRunLoading ? "Simulando dry-run…" : "Dry-run"}
                  </button>

                  <button onClick={repairRun} disabled={repairLoading || dryRunLoading || settleLoading || !runData?.run_id}
                    className={`inline-flex items-center justify-center gap-2 ${repairConfirm ? "bg-amber-600 hover:bg-amber-500" : "bg-cyan-800 hover:bg-cyan-700"} disabled:opacity-50 text-white font-medium py-2.5 rounded-xl transition-colors text-sm`}
                    title="Reseta result/settled_at e reliquida com as regras atuais. Clique duas vezes para confirmar.">
                    {repairLoading && <Loader2 size={14} className="animate-spin" />}
                    {repairLoading ? "Reparando…" : repairConfirm ? "Clique de novo p/ confirmar" : "Reparar histórico"}
                  </button>

                  {!settleConfirm ? (
                    <button onClick={startSettleConfirm} disabled={dryRunLoading || repairLoading || settleLoading || !runData?.run_id}
                      className="inline-flex items-center justify-center gap-2 bg-orange-700 hover:bg-orange-600 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm">
                      {settleLoading && <Loader2 size={14} className="animate-spin" />}
                      {settleLoading ? "Liquidando run…" : "Liquidar Run"}
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={cancelSettleConfirm} disabled={settleLoading}
                        className={`flex-1 rounded-xl py-2.5 text-sm transition-colors disabled:opacity-50 ${SUBTLE_BUTTON}`}>
                        Cancelar
                      </button>
                      <button onClick={() => settleRun(false)} disabled={settleLoading}
                        className="inline-flex flex-1 items-center justify-center gap-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm">
                        {settleLoading && <Loader2 size={14} className="animate-spin" />}
                        {settleLoading ? "Liquidando…" : `Confirmar (${settleCountdown}s)`}
                      </button>
                    </div>
                  )}
                </div>

                {/* Prediction table (Bloco 5.4) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Predições do Run</h3>
                    <div className="flex items-center gap-2">
                      {hiddenPredRows > 0 && (
                        <span className="text-[11px] text-gray-500">mostrando 500 · CSV completo</span>
                      )}
                      <button onClick={() => loadPredictions(runData.run_id)} disabled={predsLoading}
                        className={`text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${SUBTLE_BUTTON}`}>
                        {predsLoading ? "Carregando…" : "Carregar"}
                      </button>
                      {predsData?.rows?.length > 0 && (
                        <button onClick={exportPredsCsv}
                          className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg transition-colors ${SUBTLE_BUTTON}`}>
                          <Download size={11} /> CSV
                        </button>
                      )}
                    </div>
                  </div>

                  {!predsData ? (
                    <p className="text-xs text-gray-600 text-center py-4">Clique em "Carregar" para ver as predições deste run.</p>
                  ) : !predsData.rows?.length ? (
                    <p className="text-xs text-gray-600 text-center py-4">Sem predições para este run. O banco pode estar vazio.</p>
                  ) : (
                    <div className={`${TABLE_SHELL} max-h-80 overflow-y-auto`}>
                      <table className="w-full text-xs">
                        <thead className={`sticky top-0 ${TABLE_HEAD}`}>
                          <tr className={TABLE_HEAD_ROW}>
                            <th className="text-left py-2 pr-3 font-medium">Partida</th>
                            <th className="text-left py-2 pr-3 font-medium">Liga</th>
                            <th className="text-left py-2 pr-3 font-medium">Mercado</th>
                            <th className="text-right py-2 pr-3 font-medium">Odd</th>
                            <th className="text-right py-2 pr-3 font-medium">Edge%</th>
                            <th className="text-right py-2 pr-3 font-medium">Conf</th>
                            <th className="text-right py-2 font-medium">Resultado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visiblePredRows.map((r: any, i: number) => (
                            <tr key={i} className={`border-b border-emerald-500/10 transition-colors ${
                              r.result === "green" ? "bg-green-950/20" :
                              r.result === "red"   ? "bg-red-950/20" : "hover:bg-emerald-500/10"}`}>
                              <td className="py-1.5 pr-3 text-gray-200">{r.home ?? r.match_id?.slice(0,8) ?? "—"} × {r.away ?? "?"}</td>
                              <td className="py-1.5 pr-3 text-gray-500">{r.liga}</td>
                              <td className="py-1.5 pr-3 font-mono text-gray-400">{r.market_key}</td>
                              <td className="py-1.5 pr-3 text-right font-mono text-white">{r.market_odd?.toFixed(2) ?? "—"}</td>
                              <td className="py-1.5 pr-3 text-right font-mono text-green-400">{fmtEdge(r.edge_pct)}</td>
                              <td className="py-1.5 pr-3 text-right text-gray-400">{r.confidence?.toFixed(2) ?? "—"}</td>
                              <td className="py-1.5 text-right">
                                <ResultBadge result={r.result} actual={r.actual_value} leg={r} size="xs" />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {/* ════════════════════════════════════════════ APRENDIZADO */}
        {activeTab === "aprendizado" && (
          <section className={`${PANEL} p-5 space-y-5`}>
            <header className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-emerald-300" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-white/85">Aprendizado — Calibração EWMA</h2>
              </div>
              <div className="flex items-center gap-2">
                {["A","B"].map((e) => (
                  <button key={e} onClick={() => loadCalib(e)} disabled={calibLoading}
                    className={`text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${SUBTLE_BUTTON}`}>
                    {calibLoading ? "…" : `Engine ${e}`}
                  </button>
                ))}
              </div>
            </header>

            {/* KPIs (Bloco 6.1) */}
            {(calibData || evalSummary) && (
              <div className="grid grid-cols-3 gap-3">
                {[
                  ["Registros calib.", calibData?.count ?? "—",  "text-white"],
                  ["Resolvidas",       evalSummary?.n ?? "—",    "text-white"],
                  ["Greens",           evalSummary?.green ?? "—","text-green-400"],
                  ["Taxa hit",         evalSummary?.n > 0
                    ? `${((evalSummary.green / evalSummary.n) * 100).toFixed(1)}%` : "—", "text-emerald-400"],
                  ["EWMA A médio",     calibData?.items?.length
                    ? `${((calibData.items.reduce((s: number, r: any) => s + (r.ewma_hr ?? 0), 0) / calibData.items.length) * 100).toFixed(1)}%` : "—",
                    calibData?.items?.length && (calibData.items.reduce((s: number, r: any) => s + (r.ewma_hr ?? 0), 0) / calibData.items.length) > 0.5
                      ? "text-green-400" : "text-yellow-400"],
                  ["Famílias", calibData?.items ? new Set(calibData.items.map((r: any) => r.family)).size : "—", "text-cyan-300"],
                ].map(([l,v,c]) => (
                  <div key={l as string} className={`${SOFT_CARD} p-3 text-center`}>
                    <div className={`text-xl font-bold ${c}`}>{v as any}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{l as string}</div>
                  </div>
                ))}
              </div>
            )}

            {!calibData ? (
              <p className="text-gray-600 text-sm text-center py-10">Clique em "Engine A" para carregar a calibração EWMA.</p>
            ) : (
              <>
                {/* Maiores desvios (Bloco 6.2) */}
                {desvios.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Maiores Desvios (|HR − 0.5|)</h3>
                    <div className={TABLE_SHELL}>
                      <table className="w-full text-xs">
                        <thead className={TABLE_HEAD}><tr className={TABLE_HEAD_ROW}>
                          <th className="text-left py-2 pr-3 font-medium">Família</th>
                          <th className="text-left py-2 pr-3 font-medium">Dir.</th>
                          <th className="text-left py-2 pr-3 font-medium">Liga</th>
                          <th className="text-right py-2 pr-3 font-medium">HR real</th>
                          <th className="text-right py-2 pr-3 font-medium">Bias (pp)</th>
                          <th className="text-right py-2 font-medium">Amostras</th>
                        </tr></thead>
                        <tbody>
                          {desvios.map((r: any, i: number) => {
                            const bias = (r.ewma_hr - 0.5) * 100;
                            return (
                              <tr key={i} className={TABLE_ROW}>
                                <td className="py-1.5 pr-3 font-mono text-gray-200">{r.family}</td>
                                <td className="py-1.5 pr-3 text-gray-500">{r.direction ?? "—"}</td>
                                <td className="py-1.5 pr-3 text-gray-500">{r.liga ?? "global"}</td>
                                <td className="py-1.5 pr-3 text-right font-mono text-green-400">{fmtPct(r.ewma_hr)}</td>
                                <td className={`py-1.5 pr-3 text-right font-mono ${bias > 0 ? "text-green-400" : "text-red-400"}`}>
                                  {bias > 0 ? "+" : ""}{bias.toFixed(1)}pp
                                </td>
                                <td className="py-1.5 text-right text-gray-500">{r.sample_size ?? "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Estados recentes (Bloco 6.3) */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Estados Recentes — Engine {calibData.engine}</h3>
                  <div className={TABLE_SHELL}>
                    <table className="w-full text-xs">
                      <thead className={TABLE_HEAD}><tr className={TABLE_HEAD_ROW}>
                        <th className="text-left py-2 pr-3 font-medium">Família</th>
                        <th className="text-left py-2 pr-3 font-medium">Liga</th>
                        <th className="text-right py-2 pr-3 font-medium">Hit Rate</th>
                        <th className="text-right py-2 pr-3 font-medium">Brier</th>
                        <th className="text-right py-2 pr-3 font-medium">λ mult</th>
                        <th className="text-right py-2 font-medium">Amostras</th>
                      </tr></thead>
                      <tbody>
                        {[...(calibData.items ?? [])].sort((a: any, b: any) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "")).slice(0,10).map((r: any, i: number) => (
                          <tr key={i} className={TABLE_ROW}>
                            <td className="py-1.5 pr-3 font-mono text-gray-200">{r.family}</td>
                            <td className="py-1.5 pr-3 text-gray-500">{r.liga ?? "global"}</td>
                            <td className="py-1.5 pr-3 text-right font-mono text-green-400">{fmtPct(r.ewma_hr)}</td>
                            <td className="py-1.5 pr-3 text-right font-mono text-yellow-400">{r.ewma_brier?.toFixed(4) ?? "—"}</td>
                            <td className="py-1.5 pr-3 text-right font-mono text-cyan-300">{r.lambda_mult?.toFixed(3) ?? "—"}</td>
                            <td className="py-1.5 text-right text-gray-500">{r.sample_size ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </section>
        )}

        {/* ════════════════════════════════════════════ RESULTADOS */}
        {activeTab === "resultados" && (
          <section className={`${PANEL} p-5 space-y-4`}>
            <header className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-emerald-300" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-white/85">Resultados — Histórico de Runs</h2>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={loadRuns} disabled={runsLoading}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${SUBTLE_BUTTON}`}>
                  {runsLoading ? "Carregando…" : "Atualizar"}
                </button>
                {runsList.length > 0 && !clearConfirm && (
                  <button onClick={() => setClearConfirm(true)}
                    className="flex items-center gap-1 text-xs bg-red-950/50 hover:bg-red-900/60 border border-red-800/40 px-3 py-1.5 rounded-lg text-red-400 transition-colors">
                    <Trash2 size={11} /> Limpar tudo
                  </button>
                )}
                {clearConfirm && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-orange-400">Confirmar?</span>
                    <button onClick={deleteAllRuns} className="text-xs bg-red-700 hover:bg-red-600 px-2 py-1 rounded text-white">Sim</button>
                    <button onClick={() => setClearConfirm(false)} className={`text-xs px-2 py-1 rounded ${SUBTLE_BUTTON}`}>Não</button>
                  </div>
                )}
              </div>
            </header>

            {!runsList.length ? (
              <p className="text-gray-600 text-sm text-center py-10">{runsLoading ? "Carregando…" : "Nenhum run. Clique em Atualizar."}</p>
            ) : (
              <div className="space-y-2">
                {runsList.map((r) => (
                  <div key={r.run_id} className={`${SOFT_CARD} p-3 flex items-center gap-3 group cursor-pointer transition-colors hover:bg-emerald-500/10 ${runData?.run_id === r.run_id ? "ring-1 ring-emerald-400/60" : ""}`}
                    onClick={() => selectRun(r)}>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-xs text-emerald-300 truncate">{fmtRunSeq(r)} · ID {runShortId(r.run_id)}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {r.date_start} → {r.date_end} · {r.matches} partidas · {r.slots} slots
                      </div>
                    </div>
                    <div className="text-xs text-gray-600 shrink-0 hidden sm:block">
                      {new Date(r.created_at).toLocaleString("pt-BR")}
                    </div>
                    {deleteConfirmId === r.run_id ? (
                      <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => deleteRun(r.run_id)} className="text-xs bg-red-700 hover:bg-red-600 px-2 py-1 rounded text-white">Sim</button>
                        <button onClick={() => setDeleteConfirmId(null)} className={`text-xs px-2 py-1 rounded ${SUBTLE_BUTTON}`}>Não</button>
                      </div>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(r.run_id); }}
                        className="text-gray-600 hover:text-red-400 shrink-0 p-1 rounded transition-colors opacity-0 group-hover:opacity-100">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-700 text-center">Clique em uma linha para selecionar o run e abrir o Resolver.</p>
          </section>
        )}

      </div>
    </div>
  );
}
