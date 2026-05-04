'use client';
import { useEffect, useRef } from 'react';

// Phase → stream mapping
const PHASES = [
  { streams: [4], col: '#f59e0b' },
  { streams: [6], col: '#3b82f6' },
  { streams: [1], col: '#22c55e' },
];

// Arrival rates visual canvas — sinkron dengan useTwinEngine (veh/s)
const ARRIVALS = [0.15, 0.65, 0.20, 0.10, 0.50, 0.15, 0.35];

// Conflict matrix: stream → list of streams that conflict in the box
const CONFLICTS = { 1: [4, 6], 4: [1, 6], 6: [1, 4] };

// Yield rules: free-flow stream → list of controlled streams it must yield to
const YIELDS = { 0: [6], 2: [4], 3: [1], 5: [4] };

const VTYPES = [
  { w: 10, h: 18, cols: ['#2563eb', '#1d4ed8', '#3b82f6'] }, // car
  { w: 5, h: 11, cols: ['#7c3aed', '#8b5cf6', '#6d28d9'] }, // moto
  { w: 12, h: 23, cols: ['#b45309', '#d97706', '#92400e'] }, // angkot
  { w: 13, h: 25, cols: ['#166534', '#15803d', '#14532d'] }, // truck
];
const VW = [0.55, 0.25, 0.12, 0.08];

export default function CanvasVisual({ activePhase, isRunning, speed }) {
  const canvasRef = useRef(null);
  const propsRef = useRef({ activePhase, isRunning, speed });

  useEffect(() => {
    propsRef.current = { activePhase, isRunning, speed };
  }, [activePhase, isRunning, speed]);

  useEffect(() => {
    const cv = canvasRef.current;
    const ctx = cv.getContext('2d');
    let W, H, CX, CY, RW;
    let SC = [];           // stream configs
    let vehs = [];
    let stmr = Array(7).fill(0);
    let nid = 0;
    let rafId, lastT = null, acc = 0;
    const DT = 1 / 60;

    // ── Vehicle type picker ───────────────────────────────
    function rVT() {
      let r = Math.random(), c = 0;
      for (let i = 0; i < VW.length; i++) { c += VW[i]; if (r < c) return i; }
      return 0;
    }

    // ── Build stream configs from current geometry ────────
    function buildSC() {
      const d = window.devicePixelRatio || 1;
      const lw = RW * 0.65;   // lane half-width
      const med = RW * 0.18;   // north road median half-width
      const sd = RW * 2.5;    // stop distance from centre
      const ex = W + 100 * d; // exit off-screen X

      // Each stream: spawn point, stop point, freeFlow flag, path waypoints
      return [
        // 0: South→West (left, free-flow) — single 1-way south road, left side
        {
          sx: CX - lw * 0.8, sy: H + 60 * d, stopX: CX - lw * 0.8, stopY: CY + sd, freeFlow: true,
          path: [{ x: CX - lw * 0.8, y: CY + sd }, { x: CX - lw * 0.8, y: CY + lw * 0.4 }, { x: -80 * d, y: CY + lw * 0.4 }]
        },
        // 1: South→North (straight, controlled Fase 3) — centre of south road
        {
          sx: CX, sy: H + 60 * d, stopX: CX, stopY: CY + sd, freeFlow: false,
          path: [{ x: CX, y: CY + sd }, { x: CX - (lw * 0.5 + med), y: CY + lw * 0.5 }, { x: CX - (lw * 0.5 + med), y: -80 * d }]
        },
        // 2: South→East (right, free-flow) — right side of south road
        {
          sx: CX + lw * 0.8, sy: H + 60 * d, stopX: CX + lw * 0.8, stopY: CY + sd, freeFlow: true,
          path: [{ x: CX + lw * 0.8, y: CY + sd }, { x: CX + lw * 0.8, y: CY + lw * 0.4 }, { x: ex, y: CY + lw * 0.4 }]
        },
        // 3: West→North (left, free-flow) — top lane of west 2-way road
        {
          sx: -80 * d, sy: CY - lw * 0.45, stopX: CX - sd, stopY: CY - lw * 0.45, freeFlow: true,
          path: [{ x: CX - sd, y: CY - lw * 0.45 }, { x: CX - (lw * 0.5 + med), y: CY - lw * 0.45 }, { x: CX - (lw * 0.5 + med), y: -80 * d }]
        },
        // 4: West→East (straight, controlled Fase 1) — top lane west road
        {
          sx: -80 * d, sy: CY - lw * 0.45, stopX: CX - sd, stopY: CY - lw * 0.45, freeFlow: false,
          path: [{ x: CX - sd, y: CY - lw * 0.45 }, { x: ex, y: CY - lw * 0.45 }]
        },
        // 5: North→East (left, free-flow) — right lane of north road
        {
          sx: CX + lw * 0.5 + med, sy: -80 * d, stopX: CX + lw * 0.5 + med, stopY: CY - sd, freeFlow: true,
          path: [{ x: CX + lw * 0.5 + med, y: CY - sd }, { x: CX + lw * 0.5 + med, y: CY - lw * 0.45 }, { x: ex, y: CY - lw * 0.45 }]
        },
        // 6: North→West (right, controlled Fase 2) — right lane north road
        {
          sx: CX + lw * 0.5 + med, sy: -80 * d, stopX: CX + lw * 0.5 + med, stopY: CY - sd, freeFlow: false,
          path: [{ x: CX + lw * 0.5 + med, y: CY - sd }, { x: CX + lw * 0.5 + med, y: CY + lw * 0.45 }, { x: -80 * d, y: CY + lw * 0.45 }]
        },
      ];
    }

    // ── Spawn a vehicle on stream si ─────────────────────
    function spawn(si) {
      const c = SC[si]; if (!c) return;
      const ti = rVT();
      const vt = VTYPES[ti];
      const col = vt.cols[Math.floor(Math.random() * vt.cols.length)];
      const d = window.devicePixelRatio || 1;
      const sm = ti === 1 ? 0.55 : ti === 0 ? 0.60 : 0.65;
      vehs.push({
        id: si * 1000 + (nid++ % 1000), si, ti,
        x: c.sx, y: c.sy, state: 'approach', pi: 0,
        col, w: vt.w * d * sm, h: vt.h * d * sm,
        ang: 0, alpha: 1, rm: false,
      });
    }

    // ── Is vehicle u ahead of v approaching stop? ────────
    function ahead(u, v, c) {
      const d1 = (c.stopX - u.x) ** 2 + (c.stopY - u.y) ** 2;
      const d2 = (c.stopX - v.x) ** 2 + (c.stopY - v.y) ** 2;
      return d1 < d2;
    }

    // ── Intersection box conflict check ──────────────────
    // Hanya rem jika kendaraan konflik benar-benar berada di dalam
    // area fisik simpang (bukan yang sedang mengantri di luar).
    function isSafe(v) {
      const c = SC[v.si]; if (!c || c.freeFlow) return true;
      // Gunakan radius ketat = 1.2×RW agar hanya area pusat simpang
      const bs = RW * 1.2;
      const box = { x1: CX - bs, x2: CX + bs, y1: CY - bs, y2: CY + bs };
      for (const o of vehs) {
        if (o === v || !(CONFLICTS[v.si] || []).includes(o.si)) continue;
        // Hanya block jika kendaraan lain SEDANG bergerak di dalam kotak simpang
        if (o.state !== 'cross') continue;
        if (o.x > box.x1 && o.x < box.x2 && o.y > box.y1 && o.y < box.y2) return false;
      }
      return true;
    }

    // ── Yield check for free-flow streams ────────────────
    function mustYield(v) {
      const ys = YIELDS[v.si]; if (!ys) return false;
      const gs = PHASES[propsRef.current.activePhase].streams;
      const bs = RW * 2.5;
      for (const o of vehs) {
        if (!ys.includes(o.si) || !gs.includes(o.si)) continue;
        if (o.x > CX - bs && o.x < CX + bs && o.y > CY - bs && o.y < CY + bs &&
          (o.state === 'cross' || o.state === 'queued')) return true;
      }
      return false;
    }

    // ── Update one vehicle ────────────────────────────────
    function stepVeh(v, dt) {
      const c = SC[v.si]; if (!c) return;
      const gs = PHASES[propsRef.current.activePhase].streams;
      const controlled = !c.freeFlow && gs.includes(v.si);
      const d = window.devicePixelRatio || 1;
      const sp = 5.0 * d * propsRef.current.speed;

      if (v.state === 'approach') {
        const dx = c.stopX - v.x, dy = c.stopY - v.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const aq = vehs.filter(u => u !== v && u.si === v.si &&
          (u.state === 'queued' || (u.state === 'approach' && ahead(u, v, c)))).length;
        const gap = (v.ti === 1 ? 10 : 26) * d + aq * (v.h * 1.3);

        if (dist > gap + 2) {
          const mv = Math.min(sp * dt, dist - gap);
          v.x += dx / dist * mv; v.y += dy / dist * mv;
          v.ang = Math.atan2(dy, dx) + Math.PI / 2;
        } else {
          if (c.freeFlow) {
            if (mustYield(v)) v.state = 'queued';
            else { v.state = 'cross'; v.pi = 0; v.x = c.path[0].x; v.y = c.path[0].y; }
          } else if (!controlled) {
            v.state = 'queued';
          } else {
            if (isSafe(v)) { v.state = 'cross'; v.pi = 0; v.x = c.path[0].x; v.y = c.path[0].y; }
            else v.state = 'queued';
          }
        }
      } else if (v.state === 'queued') {
        const ah = vehs.filter(u => u !== v && u.si === v.si && u.state === 'queued' && ahead(u, v, c)).length;
        if (ah === 0) {
          if (c.freeFlow) { if (!mustYield(v)) { v.state = 'cross'; v.pi = 0; v.x = c.path[0].x; v.y = c.path[0].y; } }
          else if (controlled && isSafe(v)) { v.state = 'cross'; v.pi = 0; v.x = c.path[0].x; v.y = c.path[0].y; }
        }
      } else if (v.state === 'cross') {
        const p = c.path;
        if (v.pi >= p.length - 1) { v.state = 'exit'; return; }
        const tg = p[v.pi + 1]; const dx = tg.x - v.x; const dy = tg.y - v.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 4) v.pi++;
        else {
          const mv = Math.min(4.0 * d * propsRef.current.speed * dt, dist);
          v.x += dx / dist * mv; v.y += dy / dist * mv;
          v.ang = Math.atan2(dy, dx) + Math.PI / 2;
        }
      } else if (v.state === 'exit') {
        // Gerak maju berdasarkan arah rotasi terakhir kendaraan
        // v.ang = atan2(dy, dx) + PI/2, sehingga heading vector:
        //   vx = sin(v.ang),  vy = -cos(v.ang)
        const d2 = window.devicePixelRatio || 1;
        const spd = 5.5 * d2 * propsRef.current.speed * dt;
        v.x += Math.sin(v.ang) * spd;
        v.y -= Math.cos(v.ang) * spd;
        // Despawn begitu benar-benar keluar dari canvas
        if (v.x > W + 50 * d2 || v.x < -50 * d2 ||
          v.y > H + 50 * d2 || v.y < -50 * d2) v.rm = true;
      }
    }

    // ── Draw scene ────────────────────────────────────────
    function draw() {
      ctx.clearRect(0, 0, W, H);
      const d = window.devicePixelRatio || 1;
      const lw = RW * 0.65, med = RW * 0.18, sd = RW * 2.5;

      // Background
      ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, W, H);

      // Sidewalk blocks
      ctx.fillStyle = '#1e2433';
      ctx.fillRect(CX - RW * 2.0, CY + RW * 2.0, RW * 4, H);
      ctx.fillRect(CX - RW * 2.0, 0, RW * 4, CY - RW * 2.0);
      ctx.fillRect(0, CY - RW * 2.0, CX - RW * 2.0, RW * 4);
      ctx.fillRect(CX + RW * 2.0, CY - RW * 2.0, W, RW * 4);

      // Asphalt roads
      ctx.fillStyle = '#1c2030';
      // South road (1-way in, full width)
      ctx.fillRect(CX - lw * 1.4, CY, lw * 2.8, H - CY);
      // East road (1-way out, full width)
      ctx.fillRect(CX, CY - lw, W - CX, lw * 2);
      // West road (2-way)
      ctx.fillRect(0, CY - lw, CX, lw * 2);
      // North road (2-way with median)
      ctx.fillRect(CX - lw - med * 1.5, 0, lw * 2 + med * 3, CY);
      // Intersection box
      ctx.fillRect(CX - lw * 1.4, CY - lw, lw * 2.8, lw * 2);

      // North road median island
      ctx.fillStyle = '#2d3347';
      ctx.fillRect(CX - med, 0, med * 2, CY - RW * 1.9);

      // Road markings
      ctx.save();
      ctx.setLineDash([12 * d, 9 * d]);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1.5 * d;
      // West road centre line
      ctx.beginPath(); ctx.moveTo(0, CY); ctx.lineTo(CX - sd, CY); ctx.stroke();
      ctx.setLineDash([]);

      // Stop lines
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2.5 * d;
      ctx.beginPath(); ctx.moveTo(CX - lw * 1.3, CY + sd); ctx.lineTo(CX + lw * 1.3, CY + sd); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(CX - sd, CY - lw * 0.8); ctx.lineTo(CX - sd, CY + lw * 0.8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(CX + med, CY - sd); ctx.lineTo(CX + lw + med, CY - sd); ctx.stroke();
      ctx.restore();

      // Road labels
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.font = `${9 * d}px monospace`; ctx.textAlign = 'center';
      ctx.fillText('Jl. Nagarawangi →', CX + RW * 3.5, CY - RW * 1.4);
      ctx.fillText('Jl. HZ. Mustofa ↑', CX, H - 12 * d);
      ctx.fillText('Jl. HZ. Mustofa', CX, 16 * d);
      ctx.textAlign = 'left';
      ctx.save(); ctx.translate(13 * d, CY + 40 * d); ctx.rotate(-Math.PI / 2);
      ctx.fillText('Jl. Tentara Pelajar', 0, 0); ctx.restore();

      // Tugu / Roundabout monument (gold)
      const r = RW * 0.40;
      const rg = ctx.createRadialGradient(CX, CY, r * 0.1, CX, CY, r);
      rg.addColorStop(0, '#d4a847'); rg.addColorStop(0.6, '#8a6618'); rg.addColorStop(1, '#3a2806');
      ctx.save();
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(CX, CY, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 1.5 * d;
      ctx.beginPath(); ctx.arc(CX, CY, r * 0.78, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#d4a847'; ctx.beginPath(); ctx.arc(CX, CY, r * 0.28, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Traffic lights
      const gs = PHASES[propsRef.current.activePhase].streams;
      const tlPos = [
        { x: CX - lw * 1.5, y: CY + sd + 2 * d, r: 0, si: 1 }, // south
        { x: CX - sd - 2 * d, y: CY - lw * 0.5, r: Math.PI / 2, si: 4 }, // west
        { x: CX + lw * 0.5 + med + 2 * d, y: CY - sd, r: Math.PI, si: 6 }, // north
      ];
      for (const p of tlPos) {
        const green = gs.includes(p.si);
        const bw = 9 * d, bh = 20 * d;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = '#1a1a1a'; ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
        // Red
        ctx.fillStyle = green ? '#3d0000' : '#ff2222';
        ctx.beginPath(); ctx.arc(0, -bh * 0.27, bw * 0.3, 0, Math.PI * 2); ctx.fill();
        // Green
        ctx.fillStyle = green ? '#00ff44' : '#003300';
        ctx.beginPath(); ctx.arc(0, bh * 0.23, bw * 0.3, 0, Math.PI * 2); ctx.fill();
        if (green) {
          ctx.shadowColor = '#00ff44'; ctx.shadowBlur = 8 * d;
          ctx.beginPath(); ctx.arc(0, bh * 0.23, bw * 0.3, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
        }
        ctx.restore();
      }

      // Vehicles
      for (const v of vehs) {
        ctx.save();
        ctx.globalAlpha = v.alpha;
        ctx.translate(v.x, v.y); ctx.rotate(v.ang);
        // Body
        ctx.fillStyle = v.col;
        ctx.fillRect(-v.w / 2, -v.h / 2, v.w, v.h);
        // Windshield
        ctx.fillStyle = 'rgba(160,210,255,0.45)';
        ctx.fillRect(-v.w * 0.36, -v.h * 0.42, v.w * 0.72, v.h * 0.27);
        // Headlights
        ctx.fillStyle = '#fffbe0';
        ctx.beginPath(); ctx.arc(-v.w * 0.28, -v.h * 0.44, v.w * 0.12, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(v.w * 0.28, -v.h * 0.44, v.w * 0.12, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }

    // ── Resize handler ────────────────────────────────────
    function resize() {
      const rect = cv.parentElement.getBoundingClientRect();
      const d = window.devicePixelRatio || 1;
      cv.width = rect.width * d; cv.height = rect.height * d;
      cv.style.width = rect.width + 'px'; cv.style.height = rect.height + 'px';
      W = cv.width; H = cv.height; CX = W / 2; CY = H / 2;
      RW = Math.min(W, H) * 0.095;
      SC = buildSC();
      draw();
    }

    window.addEventListener('resize', resize); resize();

    // ── Animation loop ────────────────────────────────────
    const loop = (ts) => {
      rafId = requestAnimationFrame(loop);
      if (!propsRef.current.isRunning) { lastT = ts; draw(); return; }
      if (!lastT) lastT = ts;
      let el = Math.min((ts - lastT) / 1000, 0.1); lastT = ts; acc += el;

      while (acc >= DT) {
        for (let i = 0; i < 7; i++) {
          stmr[i] += DT;
          if (stmr[i] >= (1 / ARRIVALS[i])) { stmr[i] -= (1 / ARRIVALS[i]); spawn(i); }
        }
        for (const v of vehs) stepVeh(v, DT);
        vehs = vehs.filter(v => !v.rm);
        // Cap vehicle count for performance
        if (vehs.length > 120) vehs.splice(0, vehs.length - 120);
        acc -= DT;
      }
      draw();
    };

    rafId = requestAnimationFrame(loop);
    return () => { window.removeEventListener('resize', resize); cancelAnimationFrame(rafId); };
  }, []);

  return (
    <div className="w-full h-full min-h-[420px] rounded-2xl overflow-hidden relative" style={{ background: '#0d1117' }}>
      <canvas ref={canvasRef} className="block w-full h-full" />
      <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/60 backdrop-blur-sm text-white text-[10px] px-3 py-1.5 rounded-lg font-mono border border-white/10">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        LIVE — SIMPANG NAGARAWANGI (LHT)
      </div>
    </div>
  );
}