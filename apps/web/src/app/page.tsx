"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Play, Settings, TrendingUp, Grid, ShieldAlert, Cpu, CheckCircle,
  Activity, LayoutGrid, Zap, History, Search, Database, Eye,
  ChevronDown, ChevronRight, Download, RefreshCw, Trash2,
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4040";

// ── Pipeline stages (MOTOR4x4_SPEC §pipeline, 11 estágios) ───────────────────
const PIPELINE_STAGES = [
  { id: 1,  label: "Descoberta de Partidas",           icon: Search },
  { id: 2,  label: "Normalização de Inputs",           icon: Database },
  { id: 3,  label: "Engine A — Poisson + Dixon-Coles", icon: Cpu },
  { id: 4,  label: "Engine B — XGBoost / LightGBM",    icon: Cpu },
  { id: 5,  label: "Curinga — Meta-Árbitro",           icon: Zap },
  { id: 6,  label: "Regressão Isotônica",              icon: TrendingUp },
  { id: 7,  label: "Quality Gates",                    icon: ShieldAlert },
  { id: 8,  label: "Board — Strategy Engine",          icon: Grid },
  { id: 9,  label: "BIBD — Yankee Builder",            icon: LayoutGrid },
  { id: 10, label: "Family Filter — Agressivas",       icon: Activity },
  { id: 11, label: "SCOUT IA",                         icon: Eye, optIn: true },
];
const STAGE_DELAYS = [300, 400, 700, 900, 500, 500, 350, 600, 650, 550, 250];

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

// ── Component ─────────────────────────────────────────────────────────────────
export default function ScoutCorePage() {
  const today    = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

  // Form
  const [startDate, setStartDate] = useState(today);
  const [endDate,   setEndDate]   = useState(tomorrow);

  // Navigation
  const [activeTab, setActiveTab] = useState("execucao");

  // Global error
  const [error, setError] = useState<string | null>(null);

  // Pipeline
  const [loading,          setLoading]          = useState(false);
  const [pipelinePhase,    setPipelinePhase]     = useState<"idle"|"running"|"done"|"error">("idle");
  const [pipelineProgress, setPipelineProgress]  = useState(0);
  const [elapsed,          setElapsed]           = useState(0);
  const cancelAnim    = useRef(false);
  const elapsedTimer  = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef  = useRef<number | null>(null);

  // Run data
  const [runData,    setRunData]    = useState<any>(null);
  const [yankeeData, setYankeeData] = useState<any>(null);
  const [picksData,  setPicksData]  = useState<any>(null);

  // Resolver
  const [settleResult,    setSettleResult]    = useState<any>(null);
  const [settleLoading,   setSettleLoading]   = useState(false);
  const [settleConfirm,   setSettleConfirm]   = useState(false);
  const [settleCountdown, setSettleCountdown] = useState<number | null>(null);
  const [dryRunResult,    setDryRunResult]    = useState<any>(null);
  const [dryRunLoading,   setDryRunLoading]   = useState(false);
  const settleTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Predictions table (Resolver)
  const [predsData,    setPredsData]    = useState<any>(null);
  const [predsLoading, setPredsLoading] = useState(false);

  // Agressivas — expandable rows
  const [expandedDuplas, setExpandedDuplas] = useState<Set<number>>(new Set());

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
  }, []);

  // ── Pipeline animation ──────────────────────────────────────────────────────
  const startPipelineAnim = useCallback(() => {
    cancelAnim.current = false;
    setPipelineProgress(0);
    let stage = 0;
    const tick = () => {
      if (cancelAnim.current) return;
      stage++;
      setPipelineProgress(stage);
      if (stage < 11) setTimeout(tick, STAGE_DELAYS[stage] ?? 400);
    };
    setTimeout(tick, STAGE_DELAYS[0]);
  }, []);

  // ── Main run ────────────────────────────────────────────────────────────────
  const handleRun = async () => {
    setError(null);
    setRunData(null); setYankeeData(null); setPicksData(null);
    setSettleResult(null); setDryRunResult(null);
    setSettleConfirm(false); setSettleCountdown(null);
    setPredsData(null); setExpandedDuplas(new Set());
    setLoading(true);
    setPipelinePhase("running");
    setPipelineProgress(0);
    setElapsed(0);
    setActiveTab("pipeline");

    // Start animation + elapsed timer
    startPipelineAnim();
    startTimeRef.current = Date.now();
    if (elapsedTimer.current) clearInterval(elapsedTimer.current);
    elapsedTimer.current = setInterval(() => {
      setElapsed(Date.now() - (startTimeRef.current ?? Date.now()));
    }, 500);

    try {
      const runRes = await fetch(`${API_BASE}/v1/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date_start: startDate, date_end: endDate }),
      });
      if (!runRes.ok) {
        const e = await runRes.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${runRes.status}`);
      }
      const run = await runRes.json();
      setRunData(run);

      cancelAnim.current = true;
      if (elapsedTimer.current) clearInterval(elapsedTimer.current);
      setPipelineProgress(11);
      setPipelinePhase("done");

      const [yr, pr] = await Promise.allSettled([
        fetch(`${API_BASE}/v1/runs/${run.run_id}/strategy/yankee`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ diversity: { min_families: 1, min_team_or_ht: 0, max_same_family_pct: 1.0, max_per_league: 50 } }),
        }),
        fetch(`${API_BASE}/v1/runs/${run.run_id}/strategy/family_filter`, { method: "POST" }),
      ]);
      if (yr.status === "fulfilled" && yr.value.ok) setYankeeData(await yr.value.json());
      if (pr.status === "fulfilled" && pr.value.ok) setPicksData(await pr.value.json());

      setActiveTab("confrontos");
    } catch (e: any) {
      cancelAnim.current = true;
      if (elapsedTimer.current) clearInterval(elapsedTimer.current);
      setPipelinePhase("error");
      setError(e.message ?? "Erro desconhecido ao executar o pipeline");
    } finally {
      setLoading(false);
    }
  };

  // ── Resolver ─────────────────────────────────────────────────────────────────
  const startSettleConfirm = () => {
    setSettleConfirm(true);
    setSettleCountdown(15);
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
  };

  const settleRun = async (dryRun = false) => {
    if (!runData?.run_id) return;
    if (dryRun) { setDryRunLoading(true); setDryRunResult(null); }
    else        { setSettleLoading(true); setSettleResult(null); }
    cancelSettleConfirm();
    try {
      const url = `${API_BASE}/v1/settle/${runData.run_id}${dryRun ? "?dry_run=true" : ""}`;
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error ?? `HTTP ${res.status}`); }
      const data = await res.json();
      if (dryRun) setDryRunResult(data);
      else        { setSettleResult(data); loadPredictions(runData.run_id); }
    } catch (e: any) {
      setError(e.message);
    } finally {
      if (dryRun) setDryRunLoading(false);
      else        setSettleLoading(false);
    }
  };

  const loadPredictions = async (runId: string) => {
    setPredsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/predictions/${runId}`);
      if (res.ok) setPredsData(await res.json());
    } catch { /* non-fatal */ }
    finally { setPredsLoading(false); }
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
  const loadRuns = async () => {
    setRunsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/runs`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRunsList((await res.json()).items ?? []);
    } catch (e: any) { setError(e.message); }
    finally { setRunsLoading(false); }
  };

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

  // Select run from Resultados → set as active for Resolver
  const selectRun = (r: any) => {
    setRunData(r);
    setSettleResult(null); setDryRunResult(null);
    setSettleConfirm(false); setSettleCountdown(null);
    setPredsData(null);
    setActiveTab("resolver");
  };

  // ── Derived ───────────────────────────────────────────────────────────────────
  const readyCombos: any[] = yankeeData?.board?.ready_combos ?? [];
  const tickets:     any[] = yankeeData?.tickets ?? [];
  const picks:       any[] = picksData?.picks ?? [];
  const duplas             = buildDuplas(picks);
  const avgScore           = avgQualityScore(readyCombos);
  const boardStatus        = yankeeData?.board?.board_status;
  const boardWarnings:string[] = yankeeData?.board?.warnings ?? [];

  // BIBD frequency — confronto_index → count across all tickets
  const bibdFreq = tickets.reduce((m: Map<number,number>, t: any) => {
    for (const ci of t.confronto_indices ?? []) m.set(ci, (m.get(ci) ?? 0) + 1);
    return m;
  }, new Map<number,number>());
  const isBibd = bibdFreq.size > 0 && [...bibdFreq.values()].every((v) => v === 4);

  // Top-7 picks for Agressivas simples section
  const top7 = [...picks]
    .sort((a, b) => (b.edge_pct ?? 0) - (a.edge_pct ?? 0))
    .slice(0, 7);

  // "no board" check — match is in readyCombos
  const inBoard = (home: string, away: string) =>
    readyCombos.some((c) => c.legs?.[0]?.home === home && c.legs?.[0]?.away === away);

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
      onClick={() => setActiveTab(id)}
      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
        activeTab === id ? "bg-green-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-700"
      }`}
    >
      <Icon size={13} />{label}
    </button>
  );

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-white">

      {/* ── Run Selector sticky (Bloco 8) ────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-4 py-2.5">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <History size={14} className="text-green-400" />
            <span className="text-xs text-gray-500 font-medium">Run</span>
          </div>

          {runsList.length > 0 ? (
            <select
              value={runData?.run_id ?? ""}
              onChange={(e) => {
                const r = runsList.find((x) => x.run_id === e.target.value);
                if (r) selectRun(r);
              }}
              className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-200 font-mono focus:outline-none focus:border-green-600"
            >
              <option value="">— selecione um run —</option>
              {runsList.map((r) => (
                <option key={r.run_id} value={r.run_id}>
                  {r.run_id}  ·  {r.matches} jogos  ·  {r.slots} slots
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-gray-600 font-mono truncate flex-1">
              {runData?.run_id ?? "nenhum run ativo — execute o pipeline ou carregue o histórico"}
            </span>
          )}

          <div className="flex items-center gap-3 shrink-0 text-xs text-gray-500">
            {runData && (
              <>
                <span>Jogos: <strong className="text-white">{runData.matches}</strong></span>
                <span>Slots: <strong className="text-green-400">{runData.slots}</strong></span>
                {tickets.length > 0 && (
                  <span>Stake: <strong className="text-white">
                    R$ {tickets.reduce((s: number, t: any) => s + (t.stake_brl ?? 0), 0).toFixed(2)}
                  </strong></span>
                )}
              </>
            )}
            <button onClick={loadRuns} className="p-1 hover:text-green-400 transition-colors" title="Carregar histórico">
              <RefreshCw size={12} />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between pt-1">
          <div>
            <h1 className="text-xl font-bold text-green-400 tracking-tight">SCOUTCORE</h1>
            <p className="text-xs text-gray-600 mt-0.5">Motor preditivo unificado — v0.4.0</p>
          </div>
          <span className="text-xs text-gray-700 font-mono">{API_BASE}</span>
        </div>

        {/* Error banner */}
        {error && (
          <div className="bg-red-950 border border-red-800 rounded-xl p-3 flex items-start gap-2.5">
            <ShieldAlert size={15} className="text-red-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-red-300">Erro</div>
              <div className="text-xs text-red-400 mt-0.5 font-mono break-all">{error}</div>
            </div>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-300 text-lg leading-none ml-1">×</button>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex flex-wrap gap-1 bg-gray-900 rounded-xl p-1.5">
          <TabBtn id="execucao"    label="Execução"     Icon={Play} />
          <TabBtn id="pipeline"   label="Pipeline"     Icon={Activity} />
          <TabBtn id="confrontos" label="Confrontos"   Icon={Grid} />
          <TabBtn id="yankee"     label="Yankee"       Icon={LayoutGrid} />
          <TabBtn id="agressivas" label="Agressivas"   Icon={Zap} />
          <TabBtn id="resolver"   label="Resolver"     Icon={CheckCircle} />
          <TabBtn id="aprendizado" label="Aprendizado" Icon={TrendingUp} />
          <TabBtn id="resultados" label="Resultados"   Icon={History} />
        </div>

        {/* ════════════════════════════════════════════ EXECUÇÃO */}
        {activeTab === "execucao" && (
          <div className="bg-gray-900 rounded-xl p-6 space-y-6">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Nova Execução</h2>
            <div className="grid grid-cols-2 gap-4">
              {[["Data inicial", startDate, setStartDate], ["Data final", endDate, setEndDate]].map(([label, val, set]) => (
                <div key={label as string}>
                  <label className="block text-xs text-gray-500 mb-1.5">{label as string}</label>
                  <input type="date" value={val as string} onChange={(e) => (set as any)(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-green-600" />
                </div>
              ))}
            </div>
            <button onClick={handleRun} disabled={loading}
              className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
              <Play size={15} />{loading ? "Executando pipeline…" : "Executar Pipeline"}
            </button>
          </div>
        )}

        {/* ════════════════════════════════════════════ PIPELINE */}
        {activeTab === "pipeline" && (
          <div className="bg-gray-900 rounded-xl p-6 space-y-4">
            {/* Banner */}
            <div className={`rounded-xl p-4 flex items-center gap-3 ${
              pipelinePhase === "done"    ? "bg-green-950/60 border border-green-800/40" :
              pipelinePhase === "error"   ? "bg-red-950/60 border border-red-800/40" :
              pipelinePhase === "running" ? "bg-yellow-950/50 border border-yellow-700/50" :
                                           "bg-gray-800/40 border border-gray-700/30"}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                pipelinePhase === "done"    ? "bg-green-600" :
                pipelinePhase === "error"   ? "bg-red-600" :
                pipelinePhase === "running" ? "bg-yellow-500 animate-pulse" : "bg-gray-700"}`}>
                {pipelinePhase === "done"  ? "✓" :
                 pipelinePhase === "error" ? "✗" :
                 pipelinePhase === "running" ? <Activity size={14} className="text-gray-900" /> : "—"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">
                  {pipelinePhase === "done"    ? "Pipeline Concluído" :
                   pipelinePhase === "error"   ? "Pipeline com Erro" :
                   pipelinePhase === "running" ? `Estágio ${pipelineProgress}/11 — ${PIPELINE_STAGES[pipelineProgress]?.label ?? "…"}` :
                                                "Aguardando execução"}
                </div>
                {runData && <div className="text-xs text-gray-500 font-mono truncate mt-0.5">{runData.run_id}</div>}
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-mono text-gray-300">{fmtElapsed(elapsed)}</div>
                <div className="text-xs text-gray-600 mt-0.5">{pipelineProgress}/11</div>
              </div>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full transition-all duration-300 rounded-full"
                style={{ width: `${(pipelineProgress / 11) * 100}%`, background: "linear-gradient(to right, #16a34a, #34d399)" }} />
            </div>

            {/* Stages */}
            <div className="space-y-1.5">
              {PIPELINE_STAGES.map((stage) => {
                const done   = pipelineProgress >= stage.id;
                const active = pipelinePhase === "running" && pipelineProgress === stage.id - 1;
                const Icon   = stage.icon;
                return (
                  <div key={stage.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${
                    done   ? "bg-green-950/60 border border-green-800/40" :
                    active ? "bg-yellow-950/50 border border-yellow-700/50 animate-pulse" :
                             "bg-gray-800/40 border border-transparent"}`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      done ? "bg-green-600 text-white" : active ? "bg-yellow-500 text-gray-900" : "bg-gray-700 text-gray-500"}`}>
                      {done ? "✓" : stage.id}
                    </div>
                    <Icon size={13} className={done ? "text-green-400" : active ? "text-yellow-400" : "text-gray-600"} />
                    <span className={`text-xs ${done ? "text-green-300" : active ? "text-yellow-200" : "text-gray-500"}`}>{stage.label}</span>
                    {stage.optIn && <span className="ml-auto text-xs text-pink-500/70 font-mono">opt-in</span>}
                  </div>
                );
              })}
            </div>

            {runData && pipelinePhase === "done" && (
              <div className="grid grid-cols-3 gap-3 pt-1">
                {[["partidas", runData.matches, "text-white"],["slots", runData.slots, "text-green-400"],["ready", readyCombos.length, "text-blue-400"]].map(([l,v,c]) => (
                  <div key={l as string} className="bg-gray-800 rounded-xl p-3 text-center">
                    <div className={`text-2xl font-bold ${c}`}>{v as number}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{l as string}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════ CONFRONTOS */}
        {activeTab === "confrontos" && (
          <div className="bg-gray-900 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Board — Confrontos Ready</h2>
              <div className="flex items-center gap-3 text-xs">
                {avgScore && <span className="text-yellow-400">Score médio: <strong>{avgScore}</strong></span>}
                {boardStatus && (
                  <span className={`px-2 py-0.5 rounded-full font-medium ${boardStatus === "ok" ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"}`}>
                    {boardStatus}
                  </span>
                )}
              </div>
            </div>
            {boardWarnings.length > 0 && (
              <div className="bg-yellow-900/20 border border-yellow-800/40 rounded-lg p-2.5 space-y-1">
                {boardWarnings.map((w, i) => <div key={i} className="text-xs text-yellow-400">⚠ {w}</div>)}
              </div>
            )}
            {!readyCombos.length ? (
              <p className="text-gray-600 text-sm text-center py-10">{loading ? "Carregando…" : "Execute o pipeline primeiro."}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-gray-600 border-b border-gray-800">
                    <th className="text-left py-2 pr-3 font-medium">#</th>
                    <th className="text-left py-2 pr-3 font-medium">Partida</th>
                    <th className="text-left py-2 pr-3 font-medium">Liga</th>
                    <th className="text-left py-2 pr-3 font-medium">Mercado</th>
                    <th className="text-right py-2 pr-3 font-medium">Odd</th>
                    <th className="text-right py-2 pr-3 font-medium">Edge%</th>
                    <th className="text-right py-2 font-medium">Score</th>
                  </tr></thead>
                  <tbody>
                    {readyCombos.map((c: any, i: number) => (
                      <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/30 transition-colors">
                        <td className="py-2 pr-3 text-gray-600">{i+1}</td>
                        <td className="py-2 pr-3 text-gray-200">{c.legs?.[0]?.home ?? "—"} × {c.legs?.[0]?.away ?? "—"}</td>
                        <td className="py-2 pr-3 text-gray-500">{c.legs?.[0]?.liga ?? "—"}</td>
                        <td className="py-2 pr-3 font-mono text-gray-400">{c.legs?.[0]?.market_key ?? "—"}</td>
                        <td className="py-2 pr-3 text-right font-mono text-white font-semibold">{c.combo_odd?.toFixed(2) ?? "—"}</td>
                        <td className="py-2 pr-3 text-right font-mono text-green-400">{fmtEdge(c.legs?.[0]?.edge_pct)}</td>
                        <td className="py-2 text-right font-mono text-yellow-400">{c.quality_score?.toFixed(2) ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════ YANKEE */}
        {activeTab === "yankee" && (
          <div className="bg-gray-900 rounded-xl p-6 space-y-4">
            {/* Header com badge BIBD */}
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Yankee — BIBD</h2>
              <div className="flex items-center gap-2">
                {readyCombos.length > 0 && tickets.length > 0 && (
                  <span className="text-xs text-gray-500">{readyCombos.length} confrontos × {tickets.length} quadras</span>
                )}
                {bibdFreq.size > 0 && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isBibd ? "bg-green-900 text-green-300" : "bg-yellow-900 text-yellow-300"}`}>
                    {isBibd ? "BIBD 4× cada" : "balanceamento parcial"}
                  </span>
                )}
              </div>
            </div>

            {!tickets.length ? (
              <p className="text-gray-600 text-sm text-center py-10">{loading ? "Montando bilhetes…" : "Execute o pipeline primeiro."}</p>
            ) : (
              <>
                {/* Tickets */}
                <div className="space-y-3">
                  {tickets.map((t: any, i: number) => {
                    const legs = (t.confronto_indices ?? []).map((ci: number) => readyCombos[ci]).filter(Boolean);
                    return (
                      <div key={i} className="bg-gray-800 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-gray-400">Bilhete #{String((t.ticket_idx ?? i) + 1).padStart(2,"0")}</span>
                          <div className="flex items-center gap-4 text-xs">
                            <span className="text-gray-500">Stake: <span className="text-white font-mono font-semibold">R$ {t.stake_brl?.toFixed(2) ?? "—"}</span></span>
                            <span className="text-gray-500">Odd: <span className="text-green-400 font-mono font-bold">{t.ticket_odd?.toFixed(2) ?? "—"}</span></span>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {legs.map((c: any, j: number) => (
                            <div key={j} className="bg-gray-700/60 rounded-lg px-2.5 py-2 flex items-center justify-between gap-2">
                              <span className="text-xs text-gray-300 truncate">{c.legs?.[0]?.home ?? "?"} × {c.legs?.[0]?.away ?? "?"}</span>
                              <span className="text-xs font-mono text-green-400 shrink-0">{c.combo_odd?.toFixed(2) ?? "—"}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Total */}
                <div className="bg-gray-800/60 rounded-xl p-3 flex items-center justify-between">
                  <span className="text-sm text-gray-400">Total investido</span>
                  <span className="text-sm font-bold text-white font-mono">R$ {tickets.reduce((s: number, t: any) => s + (t.stake_brl ?? 0), 0).toFixed(2)}</span>
                </div>

                {/* BIBD Frequency Card (Bloco 3.3) */}
                {bibdFreq.size > 0 && (
                  <div className="bg-gray-800/40 rounded-xl p-4 space-y-3">
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
              </>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════ AGRESSIVAS */}
        {activeTab === "agressivas" && (
          <div className="bg-gray-900 rounded-xl p-6 space-y-6">
            {/* Duplas */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Agressivas EV+ — Duplas Same-Game</h2>
                <span className="text-xs text-gray-600">{duplas.length} duplas</span>
              </div>
              <p className="text-xs text-gray-600">2 mercados de famílias distintas da mesma partida, ordenados por edge médio.</p>

              {!duplas.length ? (
                <p className="text-gray-600 text-sm text-center py-8">{loading ? "Computando…" : picks.length > 0 ? "Sem partidas com ≥2 picks EV+ de famílias distintas." : "Execute o pipeline primeiro."}</p>
              ) : (
                duplas.map((d, i) => {
                  const expanded = expandedDuplas.has(i);
                  const onBoard  = inBoard(d.home, d.away);
                  return (
                    <div key={i} className="bg-gray-800 rounded-xl overflow-hidden">
                      <button className="w-full text-left p-4 flex items-start gap-3" onClick={() => {
                        const s = new Set(expandedDuplas);
                        s.has(i) ? s.delete(i) : s.add(i);
                        setExpandedDuplas(s);
                      }}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-white">{d.home} × {d.away}</span>
                            {onBoard && <span className="text-xs px-1.5 py-0.5 rounded bg-blue-900/60 border border-blue-700/40 text-blue-300">no board</span>}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">{d.liga}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xl font-bold text-green-400 font-mono">{d.combo_odd}</div>
                          <div className="text-xs text-gray-500">edge: {d.avg_edge.toFixed(1)}%</div>
                        </div>
                        <div className="self-center ml-1">
                          {expanded ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
                        </div>
                      </button>
                      {expanded && (
                        <div className="grid grid-cols-2 gap-2 px-4 pb-4">
                          {[d.leg_a, d.leg_b].map((leg, j) => (
                            <div key={j} className="bg-gray-700/50 rounded-lg p-3 space-y-1">
                              <div className="text-xs font-mono text-gray-200 break-all">{leg.key}</div>
                              <div className="text-xs text-gray-500">Família: {leg.family ?? "—"}</div>
                              <div className="flex justify-between text-xs mt-1">
                                <span className="text-green-400 font-mono font-semibold">{leg.odd.toFixed(2)}</span>
                                <span className="text-gray-400">edge: {leg.edge.toFixed(1)}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Top-7 simples (Bloco 4.2) */}
            {top7.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Top-7 Simples EV+</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-gray-600 border-b border-gray-800">
                      <th className="text-left py-2 pr-3 font-medium">Rank</th>
                      <th className="text-left py-2 pr-3 font-medium">Partida</th>
                      <th className="text-left py-2 pr-3 font-medium">Mercado</th>
                      <th className="text-right py-2 pr-3 font-medium">Odd</th>
                      <th className="text-right py-2 pr-3 font-medium">Edge%</th>
                      <th className="text-right py-2 pr-3 font-medium">Tier</th>
                      <th className="text-right py-2 font-medium">Board</th>
                    </tr></thead>
                    <tbody>
                      {top7.map((p: any, i: number) => (
                        <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                          <td className="py-1.5 pr-3 text-gray-500">#{i+1}</td>
                          <td className="py-1.5 pr-3 text-gray-200">{p.home ?? "—"} × {p.away ?? "—"}</td>
                          <td className="py-1.5 pr-3 font-mono text-gray-400">{p.market_key ?? "—"}</td>
                          <td className="py-1.5 pr-3 text-right font-mono text-white">{p.market_odd?.toFixed(2) ?? "—"}</td>
                          <td className="py-1.5 pr-3 text-right font-mono text-green-400">{fmtEdge(p.edge_pct)}</td>
                          <td className="py-1.5 pr-3 text-right">
                            <span className={`px-1.5 py-0.5 rounded font-bold text-xs ${tier(p.confidence) === "A" ? "bg-green-900 text-green-300" : tier(p.confidence) === "B" ? "bg-yellow-900 text-yellow-300" : "bg-gray-700 text-gray-400"}`}>
                              {tier(p.confidence)}
                            </span>
                          </td>
                          <td className="py-1.5 text-right">
                            {inBoard(p.home, p.away) ? <span className="text-xs text-blue-400">✓</span> : <span className="text-xs text-gray-700">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════ RESOLVER */}
        {activeTab === "resolver" && (
          <div className="bg-gray-900 rounded-xl p-6 space-y-6">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Resolver — Liquidar Run</h2>

            {!runData ? (
              <p className="text-gray-600 text-sm text-center py-10">Nenhum run ativo. Execute o pipeline ou selecione um run no histórico.</p>
            ) : (
              <>
                {/* Run info */}
                <div className="bg-gray-800 rounded-xl p-4 space-y-1.5">
                  <div className="text-xs text-gray-500">Run ativo</div>
                  <div className="font-mono text-sm text-green-400">{runData.run_id}</div>
                  <div className="text-xs text-gray-500">{runData.date_start} → {runData.date_end} · {runData.matches} partidas</div>
                </div>

                {/* KPIs dinâmicos (Bloco 5.3) */}
                {predsData && (
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      ["Predições", predsData.count,     "text-white"],
                      ["Green",     predsData.green,     "text-green-400"],
                      ["Red",       predsData.red,       "text-red-400"],
                      ["Pendentes", predsData.pending,   predsData.pending > 0 ? "text-yellow-400" : "text-gray-500"],
                      ["Cert.",     predsData.certified, "text-blue-400"],
                      ["Taxa",      predsData.green > 0 || predsData.red > 0
                        ? `${((predsData.green / Math.max(1, predsData.green + predsData.red)) * 100).toFixed(1)}%`
                        : "—",                          "text-emerald-400"],
                    ].map(([l, v, c]) => (
                      <div key={l as string} className="bg-gray-800 rounded-xl p-3 text-center">
                        <div className={`text-xl font-bold ${c}`}>{v as any}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{l as string}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Dry-run result */}
                {dryRunResult && (
                  <div className="bg-blue-950/30 border border-blue-800/40 rounded-xl p-4 space-y-1">
                    <div className="text-xs font-semibold text-blue-300">Dry-run — simulação (sem gravação)</div>
                    <div className="text-xs text-gray-400">
                      Total: {dryRunResult.total ?? 0} · Settled: {dryRunResult.settled ?? 0} · Skipped: {dryRunResult.skipped ?? 0}
                    </div>
                  </div>
                )}

                {/* Settle result */}
                {settleResult && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      {[["Green", settleResult.green ?? 0, "bg-green-950/50 border-green-800/40 text-green-400"],
                        ["Red",   settleResult.red ?? 0,   "bg-red-950/50 border-red-800/40 text-red-400"],
                        ["Total", settleResult.total ?? 0, "bg-gray-800 border-transparent text-white"]].map(([l,v,c]) => (
                        <div key={l as string} className={`rounded-xl p-4 text-center border ${c}`}>
                          <div className="text-3xl font-bold">{v as number}</div>
                          <div className="text-xs text-gray-500 mt-1">{l as string}</div>
                        </div>
                      ))}
                    </div>
                    {settleResult.settled === 0 && (
                      <div className="text-xs text-yellow-400 bg-yellow-950/30 border border-yellow-800/40 rounded-lg p-3 text-center">
                        ⚠ Nenhuma predição liquidada. Verifique se há resultados disponíveis no banco.
                      </div>
                    )}
                  </div>
                )}

                {/* Botões */}
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => settleRun(true)} disabled={dryRunLoading}
                    className="bg-blue-800 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-xl transition-colors text-sm">
                    {dryRunLoading ? "Simulando…" : "Dry-run (simular)"}
                  </button>

                  {!settleConfirm ? (
                    <button onClick={startSettleConfirm} disabled={!!settleResult}
                      className="bg-orange-700 hover:bg-orange-600 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm">
                      Liquidar Run
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={cancelSettleConfirm}
                        className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-sm py-2.5 rounded-xl transition-colors">
                        Cancelar
                      </button>
                      <button onClick={() => settleRun(false)} disabled={settleLoading}
                        className="flex-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm">
                        {settleLoading ? "…" : `Confirmar (${settleCountdown}s)`}
                      </button>
                    </div>
                  )}
                </div>

                {/* Prediction table (Bloco 5.4) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Predições do Run</h3>
                    <div className="flex items-center gap-2">
                      <button onClick={() => loadPredictions(runData.run_id)} disabled={predsLoading}
                        className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 px-3 py-1.5 rounded-lg text-gray-300 transition-colors">
                        {predsLoading ? "Carregando…" : "Carregar"}
                      </button>
                      {predsData?.rows?.length > 0 && (
                        <button onClick={exportPredsCsv}
                          className="flex items-center gap-1 text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-lg text-gray-300 transition-colors">
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
                    <div className="overflow-x-auto max-h-80 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-gray-900">
                          <tr className="text-gray-600 border-b border-gray-800">
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
                          {predsData.rows.map((r: any, i: number) => (
                            <tr key={i} className={`border-b border-gray-800/30 transition-colors ${
                              r.result === "green" ? "bg-green-950/20" :
                              r.result === "red"   ? "bg-red-950/20" : "hover:bg-gray-800/30"}`}>
                              <td className="py-1.5 pr-3 text-gray-200">{r.home ?? r.match_id?.slice(0,8) ?? "—"} × {r.away ?? "?"}</td>
                              <td className="py-1.5 pr-3 text-gray-500">{r.liga}</td>
                              <td className="py-1.5 pr-3 font-mono text-gray-400">{r.market_key}</td>
                              <td className="py-1.5 pr-3 text-right font-mono text-white">{r.market_odd?.toFixed(2) ?? "—"}</td>
                              <td className="py-1.5 pr-3 text-right font-mono text-green-400">{fmtEdge(r.edge_pct)}</td>
                              <td className="py-1.5 pr-3 text-right text-gray-400">{r.confidence?.toFixed(2) ?? "—"}</td>
                              <td className="py-1.5 text-right">
                                {r.result === "green" ? <span className="text-green-400 font-bold">GREEN</span> :
                                 r.result === "red"   ? <span className="text-red-400 font-bold">RED</span> :
                                 <span className="text-gray-600">pendente</span>}
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
          </div>
        )}

        {/* ════════════════════════════════════════════ APRENDIZADO */}
        {activeTab === "aprendizado" && (
          <div className="bg-gray-900 rounded-xl p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Aprendizado — Calibração EWMA</h2>
              <div className="flex items-center gap-2">
                {["A","B"].map((e) => (
                  <button key={e} onClick={() => loadCalib(e)} disabled={calibLoading}
                    className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 px-3 py-1.5 rounded-lg text-gray-300 transition-colors">
                    {calibLoading ? "…" : `Engine ${e}`}
                  </button>
                ))}
              </div>
            </div>

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
                  ["Famílias", calibData?.items ? new Set(calibData.items.map((r: any) => r.family)).size : "—", "text-blue-400"],
                ].map(([l,v,c]) => (
                  <div key={l as string} className="bg-gray-800 rounded-xl p-3 text-center">
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
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="text-gray-600 border-b border-gray-800">
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
                              <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/30">
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
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="text-gray-600 border-b border-gray-800">
                        <th className="text-left py-2 pr-3 font-medium">Família</th>
                        <th className="text-left py-2 pr-3 font-medium">Liga</th>
                        <th className="text-right py-2 pr-3 font-medium">Hit Rate</th>
                        <th className="text-right py-2 pr-3 font-medium">Brier</th>
                        <th className="text-right py-2 pr-3 font-medium">λ mult</th>
                        <th className="text-right py-2 font-medium">Amostras</th>
                      </tr></thead>
                      <tbody>
                        {[...(calibData.items ?? [])].sort((a: any, b: any) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "")).slice(0,10).map((r: any, i: number) => (
                          <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                            <td className="py-1.5 pr-3 font-mono text-gray-200">{r.family}</td>
                            <td className="py-1.5 pr-3 text-gray-500">{r.liga ?? "global"}</td>
                            <td className="py-1.5 pr-3 text-right font-mono text-green-400">{fmtPct(r.ewma_hr)}</td>
                            <td className="py-1.5 pr-3 text-right font-mono text-yellow-400">{r.ewma_brier?.toFixed(4) ?? "—"}</td>
                            <td className="py-1.5 pr-3 text-right font-mono text-blue-400">{r.lambda_mult?.toFixed(3) ?? "—"}</td>
                            <td className="py-1.5 text-right text-gray-500">{r.sample_size ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════ RESULTADOS */}
        {activeTab === "resultados" && (
          <div className="bg-gray-900 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Resultados — Histórico de Runs</h2>
              <div className="flex items-center gap-2">
                <button onClick={loadRuns} disabled={runsLoading}
                  className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 px-3 py-1.5 rounded-lg text-gray-300 transition-colors">
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
                    <button onClick={() => setClearConfirm(false)} className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-gray-300">Não</button>
                  </div>
                )}
              </div>
            </div>

            {!runsList.length ? (
              <p className="text-gray-600 text-sm text-center py-10">{runsLoading ? "Carregando…" : "Nenhum run. Clique em Atualizar."}</p>
            ) : (
              <div className="space-y-2">
                {runsList.map((r) => (
                  <div key={r.run_id} className={`bg-gray-800 rounded-xl p-3 flex items-center gap-3 group cursor-pointer transition-colors hover:bg-gray-750 ${runData?.run_id === r.run_id ? "ring-1 ring-green-600" : ""}`}
                    onClick={() => selectRun(r)}>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-xs text-green-400 truncate">{r.run_id}</div>
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
                        <button onClick={() => setDeleteConfirmId(null)} className="text-xs bg-gray-600 hover:bg-gray-500 px-2 py-1 rounded text-gray-300">Não</button>
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
          </div>
        )}

      </div>
    </div>
  );
}
