'use client';
import { useTwinEngine } from '../hooks/useTwinEngine';
import ComparisonChart from '../components/ComparisonChart';
import CanvasVisual from '../components/CanvasVisual';
import { Play, Pause, RotateCcw, Gauge, Clock, TrendingUp, TrendingDown, Activity, Layers, Info } from 'lucide-react';

const PHASES = [
  { name: 'Fase 1 — Barat Lurus' },
  { name: 'Fase 2 — Utara Kanan' },
  { name: 'Fase 3 — Selatan Lurus' },
];

// ── Metric card ─────────────────────────────────────────────
function MetricCard({ label, value, unit, icon: Icon, accent }) {
  return (
    <div className="flex-1 bg-white/5 border border-white/8 rounded-xl p-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <Icon size={12} className={accent} />
        <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`text-xl font-bold ${accent}`}>{value}</span>
        {unit && <span className="text-[10px] text-slate-500">{unit}</span>}
      </div>
    </div>
  );
}

// ── Phase timer bar ──────────────────────────────────────────
function PhaseBar({ data, isHybrid }) {
  const pct = Math.max(0, Math.min(100, (data.timer / data.totalGreen) * 100));
  const color = isHybrid ? '#10b981' : '#f59e0b';
  return (
    <div className="mt-2">
      <div className="flex justify-between text-[10px] text-slate-400 mb-1">
        <span className="font-medium">{PHASES[data.phase]?.name}</span>
        <span className="font-mono">{Math.ceil(data.timer)}s / {data.totalGreen}s</span>
      </div>
      <div className="h-1 bg-white/8 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-none"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

// ── Algorithm panel ──────────────────────────────────────────
function AlgoPanel({ title, data, isHybrid, accent, borderColor }) {
  const totalQ   = Math.round(data.queues.reduce((a, b) => a + b, 0));
  // avgDelay: totalWait (veh·s) / totalServed (veh) = s/kend  (Webster/HCM control delay)
  const avgDelay = data.totalServed > 0
    ? (data.totalWait / data.totalServed).toFixed(1)
    : '0.0';
  const thruput  = Math.round(data.throughput);
  // Rata-rata kepadatan: sum(queue_i / L_i) / 7  (veh/km)
  const ROAD_LEN = [0.15, 0.20, 0.15, 0.12, 0.20, 0.12, 0.18];
  const avgDens  = (data.queues.reduce((s, q, i) => s + q / ROAD_LEN[i], 0) / 7).toFixed(1);

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-1 border"
      style={{ background: 'rgba(255,255,255,0.03)', borderColor }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 rounded-full" style={{ background: accent }} />
        <span className="text-xs font-bold text-white">{title}</span>
        {isHybrid && (
          <span className="ml-auto text-[9px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            ❆ USULAN
          </span>
        )}
      </div>

      {/* Metrics row 1 */}
      <div className="flex gap-2">
        <MetricCard label="Antrean" value={totalQ} unit="veh" icon={Activity} accent={isHybrid ? 'text-emerald-400' : 'text-amber-400'} />
        <MetricCard label="Throughput" value={thruput} unit="veh" icon={TrendingUp} accent="text-sky-400" />
      </div>
      {/* Metrics row 2 */}
      <div className="flex gap-2 mt-1">
        <MetricCard label="Delay Rata-rata" value={avgDelay} unit="s/kend" icon={Clock} accent="text-rose-400" />
        <MetricCard label="Kepadatan Rata-rata" value={avgDens} unit="veh/km" icon={Layers} accent="text-violet-400" />
      </div>

      <PhaseBar data={data} isHybrid={isHybrid} />
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────
export default function Dashboard() {
  const engine = useTwinEngine();

  const handleSpeedChange = (e) => engine.setSpeed(Number(e.target.value));
  const speedLabels = { 1: '1×', 2: '2×', 3: '3×', 4: '4×', 5: '5×' };

  // Queue reduction % for hybrid vs fixed
  const fixedTotal  = engine.fixed.queues.reduce((a, b) => a + b, 0) || 1;
  const hybridTotal = engine.hybrid.queues.reduce((a, b) => a + b, 0);
  const reduction   = Math.max(0, ((fixedTotal - hybridTotal) / fixedTotal) * 100).toFixed(1);

  // Density reduction %
  const ROAD_LEN = [0.15, 0.20, 0.15, 0.12, 0.20, 0.12, 0.18];
  const fixedDens  = engine.fixed.queues.reduce((s, q, i)  => s + q / ROAD_LEN[i], 0) / 7 || 1;
  const hybridDens = engine.hybrid.queues.reduce((s, q, i) => s + q / ROAD_LEN[i], 0) / 7;
  const densReduction = Math.max(0, ((fixedDens - hybridDens) / fixedDens) * 100).toFixed(1);

  // Delay comparison
  const fixedDelay  = engine.fixed.totalServed  > 0 ? (engine.fixed.totalWait  / engine.fixed.totalServed).toFixed(1)  : null;
  const hybridDelay = engine.hybrid.totalServed > 0 ? (engine.hybrid.totalWait / engine.hybrid.totalServed).toFixed(1) : null;

  return (
    <div className="min-h-screen text-white font-sans" style={{ background: '#080c14' }}>
      {/* Header */}
      <header className="border-b border-white/8 px-6 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-black font-black text-sm">N</div>
          <div>
            <h1 className="text-sm font-bold text-white leading-tight">Analitik Simpang Nagarawangi</h1>
            <p className="text-[10px] text-slate-500 font-mono">
              T = {engine.time.toFixed(1)}s &nbsp;|&nbsp; Twin-Engine Digital Simulation
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Speed slider */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 bg-white/4 text-xs">
            <Gauge size={12} className="text-slate-400" />
            <input
              type="range" min={1} max={5} step={1}
              value={engine.speed}
              onChange={handleSpeedChange}
              className="w-20 accent-amber-400"
            />
            <span className="w-6 text-right font-mono text-amber-400">{speedLabels[engine.speed]}</span>
          </div>

          {/* Play/Pause */}
          <button
            onClick={engine.togglePlay}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: engine.isRunning ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)',
              border: `1px solid ${engine.isRunning ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}`,
              color: engine.isRunning ? '#f87171' : '#34d399',
            }}
          >
            {engine.isRunning ? <Pause size={13} /> : <Play size={13} />}
            {engine.isRunning ? 'Pause' : 'Mulai'}
          </button>

          {/* Reset */}
          <button
            onClick={engine.resetSim}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 border border-white/8 hover:bg-white/5 transition-all"
          >
            <RotateCcw size={12} /> Reset
          </button>
        </div>
      </header>

      {/* Efficiency banner */}
      {engine.time > 5 && (
        <div className="mx-4 mt-3 px-4 py-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/8 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <TrendingDown size={13} className="text-emerald-400 shrink-0" />
          <span className="text-slate-400">Hybrid GC-Greedy vs Fixed-Time:</span>
          <span className="text-emerald-400 font-bold">↓ {reduction}% antrian</span>
          <span className="text-slate-600">·</span>
          <span className="text-violet-400 font-bold">↓ {densReduction}% kepadatan</span>
          {fixedDelay && hybridDelay && (
            <>
              <span className="text-slate-600">·</span>
              <span className="text-rose-400 font-bold">↓ {Math.max(0, ((+fixedDelay - +hybridDelay) / +fixedDelay) * 100).toFixed(0)}% delay</span>
              <span className="text-slate-500">({fixedDelay}s → {hybridDelay}s /kend)</span>
            </>
          )}
        </div>
      )}

      {/* Main grid */}
      <main className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 h-[calc(100vh-80px)]">

        {/* LEFT — Canvas (2/3 width) */}
        <section className="lg:col-span-2 flex flex-col">
          <div className="flex-1">
            <CanvasVisual
              activePhase={engine.hybrid.phase}
              isRunning={engine.isRunning}
              speed={engine.speed}
            />
          </div>
        </section>

        {/* RIGHT — Chart + Panels (1/3 width) */}
        <section className="lg:col-span-1 flex flex-col gap-4 overflow-y-auto">

          {/* Chart */}
          <div className="rounded-xl border border-white/8 p-4" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-white">Perbandingan Total Antrean</h3>
              <div className="flex gap-3">
                <span className="flex items-center gap-1 text-[10px] text-slate-400">
                  <span className="inline-block w-2.5 h-0.5 rounded bg-amber-400" />Fixed-Time
                </span>
                <span className="flex items-center gap-1 text-[10px] text-slate-400">
                  <span className="inline-block w-2.5 h-0.5 rounded bg-emerald-400" />Hybrid GC
                </span>
              </div>
            </div>
            <div className="h-36">
              <ComparisonChart data={engine.chartData} />
            </div>
          </div>

          {/* Algorithm panels */}
          <AlgoPanel
            title="Fixed-Time Control"
            data={engine.fixed}
            isHybrid={false}
            accent="#f59e0b"
            borderColor="rgba(245,158,11,0.2)"
          />
          <AlgoPanel
            title="Hybrid GC-Greedy"
            data={engine.hybrid}
            isHybrid={true}
            accent="#10b981"
            borderColor="rgba(16,185,129,0.25)"
          />

          {/* Queue detail table */}
          <div className="rounded-xl border border-white/8 p-4 text-[10px]" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <h3 className="text-xs font-bold text-white mb-2">Detail Antrian per Stream</h3>
            <table className="w-full">
              <thead>
                <tr className="text-slate-500 text-left">
                  <th className="pb-1 font-medium">Stream</th>
                  <th className="pb-1 font-medium text-right text-amber-400">Fixed</th>
                  <th className="pb-1 font-medium text-right text-emerald-400">Hybrid</th>
                  <th className="pb-1 font-medium text-right text-violet-400">Selisih</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/4">
                {[
                  'Sel → Bar (Ki)', 'Sel → Utr (Lr)', 'Sel → Tim (Kn)',
                  'Bar → Utr (Ki)', 'Bar → Tim (Lr)', 'Utr → Tim (Ki)', 'Utr → Bar (Kn)',
                ].map((label, i) => {
                  const fv = Math.round(engine.fixed.queues[i]  ?? 0);
                  const hv = Math.round(engine.hybrid.queues[i] ?? 0);
                  const diff = fv - hv;
                  return (
                    <tr key={i} className="text-slate-300">
                      <td className="py-1 text-slate-500">{label}</td>
                      <td className="py-1 text-right text-amber-300 font-mono">{fv}</td>
                      <td className="py-1 text-right text-emerald-300 font-mono">{hv}</td>
                      <td className={`py-1 text-right font-mono font-bold ${
                        diff > 0 ? 'text-emerald-400' : diff < 0 ? 'text-rose-400' : 'text-slate-500'
                      }`}>{diff > 0 ? `-${diff}` : diff < 0 ? `+${Math.abs(diff)}` : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Penjelasan perbandingan algoritma */}
          <div className="rounded-xl border border-white/8 p-4" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="flex items-center gap-2 mb-3">
              <Info size={12} className="text-sky-400" />
              <h3 className="text-xs font-bold text-white">Penjelasan Perbandingan</h3>
            </div>
            <div className="space-y-3 text-[10px] leading-relaxed text-slate-400">
              <div className="flex gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mt-0.5 shrink-0" />
                <p><span className="text-amber-300 font-semibold">Fixed-Time Control</span> menggunakan waktu hijau <span className="text-white font-mono">30 detik</span> yang tetap untuk setiap fase, tanpa memperhitungkan kondisi antrian aktual. Akibatnya, fase dengan antrian sedikit tetap mendapat waktu yang sama dengan fase padat, sehingga kapasitas simpang tidak dimanfaatkan secara optimal.</p>
              </div>
              <div className="flex gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 mt-0.5 shrink-0" />
                <p><span className="text-emerald-300 font-semibold">Hybrid GC-Greedy</span> menghitung durasi hijau secara adaptif berdasarkan <span className="italic">rasio antrian fase terhadap total antrian</span>. Fase dengan antrian besar mendapat jatah hijau lebih panjang (maks <span className="font-mono text-white">60 s</span>), sedangkan fase sepi cukup <span className="font-mono text-white">15 s</span>, sehingga kendaraan yang menunggu lebih cepat terlayani.</p>
              </div>
              <div className="border-t border-white/6 pt-2 mt-1">
                <p className="text-slate-500"><span className="text-sky-300 font-semibold">Kepadatan (veh/km)</span> dihitung sebagai Q / L di mana Q = jumlah antrian dan L = panjang ruas referensi. Semakin kecil kepadatan, semakin bebas arus lalu lintas di ruas tersebut.</p>
              </div>
              <div className="border-t border-white/6 pt-2">
                <p className="text-slate-500"><span className="text-rose-300 font-semibold">Delay rata-rata (s/kend)</span> dihitung menggunakan pendekatan Webster/HCM: akumulasi <span className="font-mono">(antrian × Δt)</span> dibagi total kendaraan yang terlayani. Metode ini mencerminkan <em>control delay</em> — waktu tambahan yang dialami pengemudi akibat adanya lampu merah.</p>
              </div>
            </div>
          </div>

        </section>
      </main>
    </div>
  );
}