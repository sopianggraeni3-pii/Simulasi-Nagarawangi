'use client';
/**
 * page.jsx — Main Dashboard: Analitik Simpang Nagarawangi
 *
 * Layout:
 *   Left (2/3)  — Canvas simulation (TrafficSimulation)
 *   Right (1/3) — Controls, metrics, chart, queue table, legend
 */

import { useSimulation } from '../hooks/useSimulation';
import TrafficSimulation from '../components/TrafficSimulation';
import ComparisonChart from '../components/ComparisonChart';
import {
  Play, Pause, RotateCcw, Gauge, Clock, TrendingUp,
  TrendingDown, Activity, Layers, Info, Database, Zap,
} from 'lucide-react';
import { DEFAULT_DATASET } from '../lib/simulation/SimulationEngine';

// Stream labels for the queue table
const STREAM_LABELS = [
  'Sel → Bar (Ki)', 'Sel → Utr (Lr)', 'Sel → Tim (Kn)',
  'Bar → Utr (Ki)', 'Bar → Tim (Lr)', 'Utr → Tim (Ki)', 'Utr → Bar (Kn)',
];

// ── Tiny components ──────────────────────────────────────────────────────────

function MetricCard({ label, value, unit, icon: Icon, accent }) {
  return (
    <div className="flex-1 bg-white/5 border border-white/8 rounded-xl p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Icon size={11} className={accent} />
        <span className="text-[9px] font-medium text-slate-400 uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`text-lg font-bold leading-none ${accent}`}>{value}</span>
        {unit && <span className="text-[9px] text-slate-500">{unit}</span>}
      </div>
    </div>
  );
}

function PhaseBar({ snap, isHybrid }) {
  const pct   = Math.max(0, Math.min(100, (snap.timer / snap.totalGreen) * 100));
  const color = snap.isYellow ? '#f59e0b' : isHybrid ? '#10b981' : '#f59e0b';
  return (
    <div className="mt-2">
      <div className="flex justify-between text-[9px] text-slate-400 mb-1">
        <span className="font-medium truncate mr-2">{snap.isYellow ? '🟡 YELLOW' : snap.phaseName}</span>
        <span className="font-mono shrink-0">{Math.ceil(snap.timer)}s / {snap.totalGreen}s</span>
      </div>
      <div className="h-1.5 bg-white/8 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-none"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

function AlgoPanel({ title, snap, isHybrid, accent, borderColor }) {
  const ROAD_LEN = [0.15, 0.20, 0.15, 0.12, 0.20, 0.12, 0.18];
  const totalQ   = snap.queues.reduce((a, b) => a + b, 0).toFixed(0);
  const avgDelay = snap.metrics.totalServed > 0
    ? (snap.metrics.totalWait / snap.metrics.totalServed).toFixed(1) : '—';
  const avgDens  = (snap.queues.reduce((s, q, i) => s + q / ROAD_LEN[i], 0) / 7).toFixed(1);
  const thruput  = snap.metrics.throughput;

  return (
    <div className="rounded-xl p-3 flex flex-col gap-1 border" style={{ background: 'rgba(255,255,255,0.025)', borderColor }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: accent }} />
        <span className="text-xs font-bold text-white truncate">{title}</span>
        {isHybrid && (
          <span className="ml-auto text-[8px] px-1.5 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
            ❆ USULAN
          </span>
        )}
      </div>
      <div className="flex gap-1.5">
        <MetricCard label="Antrean" value={totalQ} unit="veh" icon={Activity}   accent={isHybrid ? 'text-emerald-400' : 'text-amber-400'} />
        <MetricCard label="Keluar"  value={thruput} unit="veh" icon={TrendingUp} accent="text-sky-400" />
      </div>
      <div className="flex gap-1.5 mt-1">
        <MetricCard label="Delay"     value={avgDelay} unit="s/kend" icon={Clock}   accent="text-rose-400" />
        <MetricCard label="Kepadatan" value={avgDens}  unit="veh/km" icon={Layers}  accent="text-violet-400" />
      </div>
      <PhaseBar snap={snap.light} isHybrid={isHybrid} />
    </div>
  );
}

// ── Dataset badge ────────────────────────────────────────────────────────────
function DatasetBadge() {
  return (
    <div className="rounded-xl border border-white/8 p-3 text-[9px] text-slate-400"
         style={{ background: 'rgba(255,255,255,0.025)' }}>
      <div className="flex items-center gap-1.5 mb-2">
        <Database size={10} className="text-sky-400" />
        <span className="text-[10px] font-bold text-white">Dataset Kedatangan (veh/menit)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[220px]">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left pb-1 font-medium">T (s)</th>
              <th className="text-right pb-1 font-medium text-amber-300">Selatan</th>
              <th className="text-right pb-1 font-medium text-sky-300">Barat</th>
              <th className="text-right pb-1 font-medium text-emerald-300">Utara</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/4">
            {DEFAULT_DATASET.map((row, i) => (
              <tr key={i} className="text-slate-300">
                <td className="py-0.5 text-slate-500 font-mono">{row.time}</td>
                <td className="py-0.5 text-right font-mono text-amber-300">{row.south}</td>
                <td className="py-0.5 text-right font-mono text-sky-300">{row.west}</td>
                <td className="py-0.5 text-right font-mono text-emerald-300">{row.north}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-slate-600">
        Spawning: Poisson-like accumulation · IDM car-following · Adaptive GC-Greedy
      </p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const sim = useSimulation();
  const speedLabels = { 1: '1×', 2: '2×', 3: '3×', 4: '4×', 5: '5×' };

  const fixedTotal  = (sim.fixed?.queues?.reduce((a, b) => a + b, 0) || 1);
  const hybridTotal = (sim.hybrid?.queues?.reduce((a, b) => a + b, 0) || 0);
  const reduction   = Math.max(0, ((fixedTotal - hybridTotal) / fixedTotal) * 100).toFixed(1);

  const ROAD_LEN    = [0.15, 0.20, 0.15, 0.12, 0.20, 0.12, 0.18];
  const fixedDens   = (sim.fixed?.queues?.reduce((s, q, i) => s + q / ROAD_LEN[i], 0) / 7) || 1;
  const hybridDens  = (sim.hybrid?.queues?.reduce((s, q, i) => s + q / ROAD_LEN[i], 0) / 7) || 0;
  const densRed     = Math.max(0, ((fixedDens - hybridDens) / fixedDens) * 100).toFixed(1);

  const fDelay = sim.fixed?.metrics?.totalServed  > 0
    ? (sim.fixed.metrics.totalWait  / sim.fixed.metrics.totalServed).toFixed(1)  : null;
  const hDelay = sim.hybrid?.metrics?.totalServed > 0
    ? (sim.hybrid.metrics.totalWait / sim.hybrid.metrics.totalServed).toFixed(1) : null;

  return (
    <div id="dashboard-root" className="min-h-screen text-white font-sans overflow-hidden" style={{ background: '#080c14' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-white/8 px-5 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-black font-black text-xs shrink-0">N</div>
          <div>
            <h1 className="text-sm font-bold text-white leading-tight">Simulasi Simpang Nagarawangi</h1>
            <p className="text-[10px] text-slate-500 font-mono">
              T = {sim.time.toFixed(1)}s &nbsp;·&nbsp; IDM Car-Following &nbsp;·&nbsp; Adaptive GC-Greedy
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Speed slider */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 bg-white/4 text-xs">
            <Gauge size={11} className="text-slate-400" />
            <input
              id="speed-slider"
              type="range" min={1} max={5} step={1}
              value={sim.speed}
              onChange={e => sim.setSpeed(e.target.value)}
              className="w-16 accent-amber-400"
            />
            <span className="w-6 text-right font-mono text-amber-400">{speedLabels[sim.speed]}</span>
          </div>

          {/* Play / Pause */}
          <button
            id="btn-toggle-play"
            onClick={sim.togglePlay}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: sim.isRunning ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)',
              border: `1px solid ${sim.isRunning ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}`,
              color: sim.isRunning ? '#f87171' : '#34d399',
            }}
          >
            {sim.isRunning ? <Pause size={12} /> : <Play size={12} />}
            {sim.isRunning ? 'Pause' : 'Mulai'}
          </button>

          {/* Reset */}
          <button
            id="btn-reset"
            onClick={sim.resetSim}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 border border-white/8 hover:bg-white/5 transition-all"
          >
            <RotateCcw size={11} /> Reset
          </button>
        </div>
      </header>

      {/* ── Efficiency banner ───────────────────────────────────────────────── */}
      {sim.time > 5 && (
        <div className="mx-4 mt-2.5 px-4 py-2 rounded-lg border border-emerald-500/20 bg-emerald-500/6 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
          <Zap size={11} className="text-emerald-400 shrink-0" />
          <span className="text-slate-400">Hybrid GC-Greedy vs Fixed-Time:</span>
          <span className="text-emerald-400 font-bold">↓ {reduction}% antrian</span>
          <span className="text-slate-600">·</span>
          <span className="text-violet-400 font-bold">↓ {densRed}% kepadatan</span>
          {fDelay && hDelay && (
            <>
              <span className="text-slate-600">·</span>
              <span className="text-rose-400 font-bold">
                ↓ {Math.max(0, ((+fDelay - +hDelay) / +fDelay) * 100).toFixed(0)}% delay
              </span>
              <span className="text-slate-500">({fDelay}s → {hDelay}s /kend)</span>
            </>
          )}
        </div>
      )}

      {/* ── Main grid ───────────────────────────────────────────────────────── */}
      <main className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-4"
            style={{ height: 'calc(100vh - 88px)', overflowY: 'hidden' }}>

        {/* LEFT — Canvas */}
        <section id="sim-section" className="lg:col-span-2 flex flex-col">
          <div className="flex-1 min-h-[360px]">
            <TrafficSimulation
              getEngines={sim.getEngines}
              isRunning={sim.isRunning}
              speed={sim.speed}
            />
          </div>
        </section>

        {/* RIGHT — Panels */}
        <section id="panel-section" className="lg:col-span-1 flex flex-col gap-3 overflow-y-auto">

          {/* Chart */}
          <div className="rounded-xl border border-white/8 p-3" style={{ background: 'rgba(255,255,255,0.025)' }}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-white">Total Antrean (veh)</h3>
              <div className="flex gap-3">
                <span className="flex items-center gap-1 text-[9px] text-slate-400">
                  <span className="inline-block w-2.5 h-0.5 rounded bg-amber-400" />Fixed
                </span>
                <span className="flex items-center gap-1 text-[9px] text-slate-400">
                  <span className="inline-block w-2.5 h-0.5 rounded bg-emerald-400" />Hybrid
                </span>
              </div>
            </div>
            <div className="h-32">
              <ComparisonChart data={{
                labels: sim.chartData.labels,
                fixedQ: sim.chartData.fixedQ,
                hybridQ: sim.chartData.hybridQ,
              }} />
            </div>
          </div>

          {/* Algorithm panels */}
          {sim.fixed && (
            <AlgoPanel
              title="Fixed-Time Control"
              snap={sim.fixed}
              isHybrid={false}
              accent="#f59e0b"
              borderColor="rgba(245,158,11,0.2)"
            />
          )}
          {sim.hybrid && (
            <AlgoPanel
              title="Hybrid GC-Greedy"
              snap={sim.hybrid}
              isHybrid={true}
              accent="#10b981"
              borderColor="rgba(16,185,129,0.25)"
            />
          )}

          {/* Queue detail table */}
          <div className="rounded-xl border border-white/8 p-3 text-[9px]" style={{ background: 'rgba(255,255,255,0.025)' }}>
            <h3 className="text-xs font-bold text-white mb-2">Antrian per Stream</h3>
            <table className="w-full">
              <thead>
                <tr className="text-slate-500 text-left">
                  <th className="pb-1 font-medium">Stream</th>
                  <th className="pb-1 font-medium text-right text-amber-400">Fixed</th>
                  <th className="pb-1 font-medium text-right text-emerald-400">Hybrid</th>
                  <th className="pb-1 font-medium text-right text-violet-400">Δ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/4">
                {STREAM_LABELS.map((lbl, i) => {
                  const fv   = Math.round(sim.fixed?.queues?.[i]  ?? 0);
                  const hv   = Math.round(sim.hybrid?.queues?.[i] ?? 0);
                  const diff = fv - hv;
                  return (
                    <tr key={i} className="text-slate-300">
                      <td className="py-0.5 text-slate-500">{lbl}</td>
                      <td className="py-0.5 text-right text-amber-300 font-mono">{fv}</td>
                      <td className="py-0.5 text-right text-emerald-300 font-mono">{hv}</td>
                      <td className={`py-0.5 text-right font-mono font-bold ${
                        diff > 0 ? 'text-emerald-400' : diff < 0 ? 'text-rose-400' : 'text-slate-500'
                      }`}>{diff > 0 ? `-${diff}` : diff < 0 ? `+${Math.abs(diff)}` : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Dataset badge */}
          <DatasetBadge />

        </section>
      </main>
    </div>
  );
}