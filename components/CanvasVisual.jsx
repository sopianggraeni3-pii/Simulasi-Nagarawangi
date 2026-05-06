'use client';
import { useEffect, useRef } from 'react';

// Phase → stream mapping
const PHASES = [
  { streams: [4], col: '#f59e0b' },
  { streams: [6], col: '#3b82f6' },
  { streams: [1], col: '#22c55e' },
];

// Arrival rates — synced with useTwinEngine ARRIVAL_RATES (veh/s)
// Index 1 = 0.65 to guarantee heavy South-to-North visual volume
const ARRIVALS = [0.10, 0.70, 0.20, 0.35, 0.30, 0.10, 0.15];

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
      const sd = RW * 1.5;    // stop distance from centre
      const ex = W + 100 * d; // exit off-screen X
      const northInboundX = CX - lw / 2 - med; // inbound lane X for north road

      // Each stream: spawn point, stop point, freeFlow flag, path waypoints
      return [
        // 0: South→West (left, free-flow) — single 1-way south road, left side
        {
          sx: CX - lw * 0.8, sy: H + 60 * d, stopX: CX - lw * 0.8, stopY: CY + sd, freeFlow: true,
          path: [{ x: CX - lw * 0.8, y: CY + sd }, { x: CX - lw * 0.8, y: CY + lw * 0.4 }, { x: -80 * d, y: CY + lw * 0.4 }]
        },
        // 1: South→North (straight, controlled Fase 3)
        // Curves left BEFORE crossing CY so it clears the roundabout monument
        {
          sx: CX, sy: H + 60 * d, stopX: CX, stopY: CY + sd, freeFlow: false,
          path: [{ x: CX, y: CY + sd }, { x: northInboundX, y: CY + lw }, { x: northInboundX, y: -60 * d }]
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
        // 4: West→East (straight, controlled Fase 1) — dips south through intersection to clear roundabout
        {
          sx: -60 * d, sy: CY - lw / 2, stopX: CX - sd, stopY: CY - lw / 2, freeFlow: false,
          path: [{ x: CX - sd, y: CY - lw / 2 }, { x: CX, y: CY + lw * 0.9 }, { x: ex, y: CY - lw / 2 }]
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

    // ── Is vehicle u ahead of v approaching stop-line? ──
    // Returns true if u is closer to the stop-line than v.
    // Strict tie-breaker (threshold 0.1) prevents ghost-merging at near-identical positions.
    function ahead(u, v, c) {
      const dx1 = c.stopX - u.x, dy1 = c.stopY - u.y;
      const dx2 = c.stopX - v.x, dy2 = c.stopY - v.y;
      const dist1 = dx1 * dx1 + dy1 * dy1;
      const dist2 = dx2 * dx2 + dy2 * dy2;
      // Strict tie-breaker for Ghost Merging
      if (Math.abs(dist1 - dist2) < 0.1) return u.id < v.id;
      return dist1 < dist2;
    }

    // ── Intersection centre conflict check (isSafe) ─────────
    // A controlled-stream vehicle may ONLY be blocked if a CONFLICTING vehicle
    // is PHYSICALLY inside the strict centre box (1.0×RW radius) AND in 'cross' state.
    // We check only the conflicting vehicle's centre point — no broad sweeps.
    function isSafe(v) {
      const c = SC[v.si]; if (!c || c.freeFlow) return true;
      const conflicts = CONFLICTS[v.si] || [];
      for (const other of vehs) {
        if (other === v || !conflicts.includes(other.si)) continue;
        if (other.state === 'cross') {
          const dx = other.x - CX; const dy = other.y - CY;
          // STRICTER RADIUS: Only brake if the enemy is deeply inside the center box
          if (dx * dx + dy * dy < (RW * 1.2) * (RW * 1.2)) return false;
        }
      }
      return true;
    }

    // ── Yield check for free-flow streams ──────────────────
    // A free-flow vehicle yields ONLY when a CONFLICTING vehicle (regardless
    // of phase) is physically inside the strict centre box AND in 'cross' state.
    // Traffic-light phase is intentionally ignored — free-flow means free-flow.
    function mustYield(v) {
      const ys = YIELDS[v.si]; if (!ys) return false;
      const bs = RW * 1.0;
      for (const o of vehs) {
        if (!ys.includes(o.si)) continue;
        // Yield only when the conflicting vehicle is actively inside the box
        if (o.state !== 'cross') continue;
        if (o.x > CX - bs && o.x < CX + bs && o.y > CY - bs && o.y < CY + bs) return true;
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
            // FREE-FLOW (streams 0, 2, 3, 5): traffic light phase is IGNORED.
            // Only yield if a conflicting vehicle is physically inside the box.
            if (mustYield(v)) v.state = 'queued';
            else { v.state = 'cross'; v.pi = 0; }
          } else if (!controlled) {
            // Controlled stream on red → queue up
            v.state = 'queued';
          } else {
            // Controlled stream with green → check physical safety then cross
            if (isSafe(v)) { v.state = 'cross'; v.pi = 0; }
            else v.state = 'queued';
          }
        }
      } else if (v.state === 'queued') {
        const ah = vehs.filter(u => u !== v && u.si === v.si && u.state === 'queued' && ahead(u, v, c)).length;
        if (ah === 0) {
          // FREE-FLOW re-checks every frame: proceed the moment the box is clear
          if (c.freeFlow) { if (!mustYield(v)) { v.state = 'cross'; v.pi = 0; } }
          else if (controlled && isSafe(v)) { v.state = 'cross'; v.pi = 0; }
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
      const lw = RW * 0.65, med = RW * 0.18, sd = RW * 1.5;

      ctx.fillStyle = '#141a14'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.012)';
      for (let i = 0; i < W; i += 18 * d) for (let j = 0; j < H; j += 18 * d) ctx.fillRect(i, j, 1, 1);

      const pad = 10 * d; // Thin, proportional sidewalk padding

      // Calculate the maximum boundaries for the center intersection box
      const maxL = Math.min(CX - lw * 1.5, CX - lw - med * 2);
      const maxR = Math.max(CX + lw * 1.5, CX + lw + med * 2);
      const maxT = CY - lw * 1.5;
      const maxB = CY + lw * 1.5;

      // 1. Draw Sidewalks (Trotoar) - Wraps the asphalt with 'pad' thickness
      ctx.fillStyle = '#2a2e3a';
      ctx.fillRect(CX - lw * 1.5 - pad, CY, lw * 3 + pad * 2, H - CY); // South
      ctx.fillRect(CX - lw - med * 2 - pad, 0, lw * 2 + med * 4 + pad * 2, CY); // North
      ctx.fillRect(0, CY - lw - pad, CX, lw * 2 + pad * 2); // West
      ctx.fillRect(CX, CY - lw - pad, W - CX, lw * 2 + pad * 2); // East
      ctx.fillRect(maxL - pad, maxT - pad, (maxR - maxL) + pad * 2, (maxB - maxT) + pad * 2); // Center Hub

      // 2. Draw Asphalt (Jalan Utama)
      ctx.fillStyle = '#1c2030';
      ctx.fillRect(CX - lw * 1.5, CY, lw * 3, H - CY); // South
      ctx.fillRect(CX - lw - med * 2, 0, lw * 2 + med * 4, CY); // North
      ctx.fillRect(0, CY - lw, CX, lw * 2); // West
      ctx.fillRect(CX, CY - lw, W - CX, lw * 2); // East
      ctx.fillRect(maxL, maxT, maxR - maxL, maxB - maxT); // Center Hub

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
      RW = Math.min(W, H) * 0.14; // Jalanan dan mobil akan ter-render lebih besar (Zoom In)
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