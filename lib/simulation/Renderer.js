/**
 * Renderer.js - Canvas Drawing Module
 *
 * Converts world-coordinate simulation state into a richly rendered canvas.
 *
 * Coordinate system:
 *   World:  origin (0,0) = intersection centre, units = metres
 *   Canvas: origin (0,0) = top-left, units = pixels
 *   Transform: cx = CX + wx * ppm,  cy = CY + wy * ppm
 *
 * Drawing order (painters algorithm):
 *   1. Background + grid
 *   2. Sidewalks / kerbs
 *   3. Asphalt roads
 *   4. Road markings (centre lines, lane dividers, stop lines, crosswalks)
 *   5. Tugu roundabout monument
 *   6. Traffic lights
 *   7. Vehicles (with shadows and lights)
 *   8. HUD overlay
 */

// World geometry constants — must match Lane.js
const W_h  = 8;    // road half-width (m)
const W_n  = 10;   // north road half-width (wider, with median)
const MED  = 2;    // north road median half-width
const S_LN = 15;   // stop line distance from centre

// Camera: how many world metres to show from centre to edge
const HALF_SCENE = 52;

export class Renderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.W = this.H = this.CX = this.CY = this.ppm = 0;
    this.dpr = 1;
  }

  // ── Resize ─────────────────────────────────────────────────────────────────
  resize() {
    const el   = this.canvas.parentElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dpr  = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr   = dpr;

    this.canvas.width  = rect.width  * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width  = rect.width  + 'px';
    this.canvas.style.height = rect.height + 'px';

    this.W  = this.canvas.width;
    this.H  = this.canvas.height;
    this.CX = this.W * 0.5;
    this.CY = this.H * 0.52;
    // pixels-per-metre: fit HALF_SCENE metres into the shorter half-dimension
    this.ppm = Math.min(this.W, this.H) / (HALF_SCENE * 2);
  }

  // ── Coordinate helpers ────────────────────────────────────────────────────
  wx(x)  { return this.CX + x * this.ppm; }
  wy(y)  { return this.CY + y * this.ppm; }
  wp(d)  { return d * this.ppm; }

  // ── Main render ───────────────────────────────────────────────────────────
  /**
   * @param {import('./Vehicle').Vehicle[]} vehicles
   * @param {object}  lightSnap  — from TrafficLight.snapshot()
   * @param {object}  metrics
   * @param {boolean} debug      — whether to render diagnostic overlays
   */
  draw(vehicles, lightSnap, metrics, debug = false) {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.W, this.H);

    this._drawBackground();
    this._drawSidewalks();
    this._drawAsphalt();
    this._drawMarkings(lightSnap);
    this._drawMonument();
    this._drawTrafficLights(lightSnap);
    this._drawVehicles(vehicles);
    if (debug) {
      this._drawDebug(vehicles);
    }
    this._drawHUD(lightSnap, metrics, vehicles.length, debug);
  }

  _drawDebug(vehicles) {
    const { ctx } = this;
    ctx.save();

    // 1. Draw Intersection Conflict Area
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
    ctx.lineWidth = this.wp(0.15);
    ctx.setLineDash([this.wp(0.5), this.wp(0.5)]);
    ctx.beginPath();
    ctx.arc(this.wx(0), this.wy(0), this.wp(12), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(239, 68, 68, 0.05)';
    ctx.fill();

    // Label for Conflict Zone
    ctx.fillStyle = 'rgba(239, 68, 68, 0.8)';
    ctx.font = `bold ${this.wp(1.1)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CONFLICT ZONE (R=12m)', this.wx(0), this.wy(-12.8));

    // 2. Draw vehicles bounding boxes, heading vectors, and sensor lines
    ctx.setLineDash([]);
    for (const v of vehicles) {
      if (v.remove) continue;

      const cx = this.wx(v.x);
      const cy = this.wy(v.y);
      const w  = this.wp(v.type.width);
      const h  = this.wp(v.type.length);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(v.angle);

      // Cyan Bounding Box matching physical dimensions
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.7)';
      ctx.lineWidth   = this.wp(0.12);
      ctx.strokeRect(-w / 2, -h / 2, w, h);

      // Front sensor point (red dot)
      ctx.fillStyle = '#ff3333';
      ctx.beginPath();
      ctx.arc(0, -h / 2, this.wp(0.25), 0, Math.PI * 2);
      ctx.fill();

      // Heading vector line
      ctx.strokeStyle = '#00ff66';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -h * 0.9);
      ctx.stroke();

      ctx.restore();

      // Diagnostics text: ID, State, Speed
      ctx.fillStyle = '#00ffff';
      ctx.font      = `bold ${this.wp(1.0)}px monospace`;
      ctx.textAlign = 'center';
      const speedKmh = (v.speed * 3.6).toFixed(0);
      ctx.fillText(`${v.id}:${v.state.substring(0,3).toUpperCase()}:${speedKmh}k/h`, cx, cy - h / 2 - this.wp(0.6));
    }

    ctx.restore();
  }

  // ── 1. Background ─────────────────────────────────────────────────────────
  _drawBackground() {
    const { ctx, W, H, dpr } = this;

    // Deep dark base
    ctx.fillStyle = '#0a0f1a';
    ctx.fillRect(0, 0, W, H);

    // Subtle noise/grid — urban feel
    ctx.fillStyle = 'rgba(255,255,255,0.012)';
    const step = 22 * dpr;
    for (let x = 0; x < W; x += step)
      for (let y = 0; y < H; y += step)
        ctx.fillRect(x, y, 1, 1);
  }

  // ── 2. Sidewalks (kerb) ────────────────────────────────────────────────────
  _drawSidewalks() {
    const { ctx } = this;
    const p = 1.6; // kerb width in world metres

    ctx.fillStyle = '#1a2035';

    // South road
    this._fr(-(W_h * 1.5 + p), 0, W_h * 3 + p * 2, 80);
    // North road
    this._fr(-(W_n + p), -80, W_n * 2 + p * 2, 80);
    // West road
    this._fr(-80, -(W_h + p), 80, W_h * 2 + p * 2);
    // East road
    this._fr(0, -(W_h + p), 80, W_h * 2 + p * 2);
    // Centre hub (encloses all roads)
    this._fr(-(W_n + p), -(W_h + p), (W_n + p) * 2, (W_h + p) * 2);
  }

  // ── 3. Asphalt ────────────────────────────────────────────────────────────
  _drawAsphalt() {
    const { ctx } = this;

    // Base asphalt colour
    ctx.fillStyle = '#151c2e';

    this._fr(-W_h * 1.5, 0, W_h * 3, 80);        // South
    this._fr(-W_n, -80, W_n * 2, 80);             // North
    this._fr(-80, -W_h, 80, W_h * 2);             // West
    this._fr(0, -W_h, 80, W_h * 2);               // East
    this._fr(-W_n, -W_h, W_n * 2, W_h * 2);       // Centre hub

    // Slight worn texture variation on the hub
    ctx.fillStyle = 'rgba(255,255,255,0.015)';
    this._fr(-W_n, -W_h, W_n * 2, W_h * 2);

    // North road median island
    ctx.fillStyle = '#1d2538';
    this._fr(-MED, -80, MED * 2, 80 - W_h * 2.6);

    // Kerb line between asphalt and sidewalk (slightly lighter strip)
    ctx.strokeStyle = '#2a3248';
    ctx.lineWidth   = this.wp(0.4);
    ctx.setLineDash([]);
    // South road kerbs
    this._sl(-W_h * 1.5, 0, -W_h * 1.5, 80);
    this._sl( W_h * 1.5, 0,  W_h * 1.5, 80);
    // West road kerbs
    this._sl(-80, -W_h, -S_LN, -W_h);
    this._sl(-80,  W_h, -S_LN,  W_h);
    // East road kerbs
    this._sl(S_LN, -W_h, 80, -W_h);
    this._sl(S_LN,  W_h, 80,  W_h);
  }

  // ── 4. Road markings ──────────────────────────────────────────────────────
  _drawMarkings(lightSnap) {
    const { ctx } = this;
    const yellow = lightSnap.isYellow;

    ctx.save();

    // -- Centre dashed lines (lane dividers on approach roads)
    ctx.setLineDash([this.wp(3), this.wp(2.2)]);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth   = this.wp(0.2);

    this._sl(-80, 0, -S_LN, 0);         // West road centre
    this._sl( S_LN, 0, 80, 0);          // East road centre (exit)
    this._sl( 0, S_LN, 0, 80);          // South road centre

    // Lane dividers within south road (3 lanes)
    this._sl(-W_h * 0.5, S_LN + 2, -W_h * 0.5, 80);
    this._sl( W_h * 0.5, S_LN + 2,  W_h * 0.5, 80);

    ctx.setLineDash([]);

    // -- Stop lines
    ctx.strokeStyle = yellow ? 'rgba(255,190,0,0.9)' : 'rgba(255,255,255,0.82)';
    ctx.lineWidth   = this.wp(0.5);
    this._sl(-W_h * 1.4, S_LN,  W_h * 1.4, S_LN);           // South
    this._sl(-S_LN, -W_h * 0.85, -S_LN, W_h * 0.85);         // West
    this._sl(MED,   -S_LN, W_h + MED,   -S_LN);               // North

    // -- Crosswalk zebra stripes (south road only, for visual richness)
    this._drawCrosswalk(-W_h * 1.4, S_LN + 1.5, W_h * 1.4, S_LN + 1.5, 0.8, 8);

    ctx.restore();

    this._drawRoadLabels();
  }

  /**
   * Draw a zebra crosswalk between two world points.
   * @param {number} x1 @param {number} y1 world start
   * @param {number} x2 @param {number} y2 world end
   * @param {number} w  stripe width (world m)
   * @param {number} n  number of stripes
   */
  _drawCrosswalk(x1, y1, x2, y2, w, n) {
    const { ctx } = this;
    const totalLen = Math.hypot(x2 - x1, y2 - y1);
    const gap      = totalLen / (n * 2 - 1);

    ctx.save();
    ctx.fillStyle   = 'rgba(255,255,255,0.14)';
    ctx.strokeStyle = 'none';

    const ang = Math.atan2(y2 - y1, x2 - x1);
    ctx.translate(this.wx(x1), this.wy(y1));
    ctx.rotate(ang);

    for (let i = 0; i < n; i++) {
      const ox = i * gap * 2;
      ctx.fillRect(ox, -this.wp(w) / 2, this.wp(gap), this.wp(w));
    }
    ctx.restore();
  }

  _drawRoadLabels() {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle    = 'rgba(255,255,255,0.09)';
    ctx.font         = `${this.wp(1.6)}px monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillText('Jl. HZ. Mustofa', this.wx(0), this.wy(72));

    ctx.save();
    ctx.translate(this.wx(-72), this.wy(0));
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Jl. Tentara Pelajar', 0, 0);
    ctx.restore();

    ctx.fillText('Jl. Nagarawangi →', this.wx(58), this.wy(-W_h * 1.8));
    ctx.restore();
  }

  // ── 5. Monument ───────────────────────────────────────────────────────────
  _drawMonument() {
    const { ctx } = this;
    const cx = this.wx(0), cy = this.wy(0);
    const r  = this.wp(4.8);

    // Outer ambient glow
    ctx.save();
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.2);
    glow.addColorStop(0,   'rgba(212,170,64,0.18)');
    glow.addColorStop(0.5, 'rgba(212,170,64,0.06)');
    glow.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Main body gradient
    const body = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, r * 0.1, cx, cy, r);
    body.addColorStop(0,   '#e8c860');
    body.addColorStop(0.45, '#b88c28');
    body.addColorStop(0.85, '#7a5810');
    body.addColorStop(1,   '#3a2806');

    ctx.shadowColor = 'rgba(212,170,64,0.5)';
    ctx.shadowBlur  = this.wp(5);
    ctx.fillStyle   = body;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Inner decorative ring
    ctx.shadowBlur  = 0;
    ctx.strokeStyle = 'rgba(230,200,80,0.6)';
    ctx.lineWidth   = this.wp(0.25);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2);
    ctx.stroke();

    // Centre highlight
    const hl = ctx.createRadialGradient(cx - r * 0.1, cy - r * 0.1, 0, cx, cy, r * 0.32);
    hl.addColorStop(0, '#fff4c0');
    hl.addColorStop(1, '#d4aa40');
    ctx.fillStyle = hl;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ── 6. Traffic lights ─────────────────────────────────────────────────────
  _drawTrafficLights(ls) {
    const green  = ls.greenStreams;
    const yellow = ls.isYellow;

    // { worldX, worldY, rotation, streamId }
    const positions = [
      { x: -W_h * 1.5 - 1,  y: S_LN + 1.5,    rot: 0,            si: 1 }, // south
      { x: -S_LN - 1.5,     y: -W_h * 0.5,     rot: Math.PI / 2,  si: 4 }, // west
      { x:  W_h + MED + 1.5, y: -S_LN,          rot: Math.PI,      si: 6 }, // north
    ];

    for (const p of positions) {
      const isGreen = !yellow && green.includes(p.si);
      this._drawOneLight(this.wx(p.x), this.wy(p.y), p.rot, isGreen, yellow);
    }
  }

  _drawOneLight(cx, cy, rotation, green, yellow) {
    const { ctx } = this;
    const bw = this.wp(2.0), bh = this.wp(4.2);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);

    // Housing
    ctx.fillStyle   = '#0f1520';
    ctx.strokeStyle = '#2d3a52';
    ctx.lineWidth   = this.wp(0.12);
    this._rrect(-bw / 2, -bh / 2, bw, bh, this.wp(0.3));
    ctx.fill();
    ctx.stroke();

    const r = bw * 0.31;
    const positions = [-bh * 0.28, 0, bh * 0.28]; // red, yellow, green Y offsets
    const colors = {
      red:    { on: '#ff3333', off: '#3d0000', glow: '#ff0000' },
      yellow: { on: '#ffcc00', off: '#3a2800', glow: '#ffaa00' },
      green:  { on: '#00ff55', off: '#003d15', glow: '#00dd44' },
    };

    // Red
    ctx.fillStyle = (!green && !yellow) ? colors.red.on : colors.red.off;
    ctx.beginPath(); ctx.arc(0, positions[0], r, 0, Math.PI * 2); ctx.fill();
    if (!green && !yellow) {
      ctx.shadowColor = colors.red.glow; ctx.shadowBlur = bw;
      ctx.beginPath(); ctx.arc(0, positions[0], r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Yellow
    ctx.fillStyle = yellow ? colors.yellow.on : colors.yellow.off;
    ctx.beginPath(); ctx.arc(0, positions[1], r, 0, Math.PI * 2); ctx.fill();
    if (yellow) {
      ctx.shadowColor = colors.yellow.glow; ctx.shadowBlur = bw * 1.5;
      ctx.beginPath(); ctx.arc(0, positions[1], r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Green
    ctx.fillStyle = green ? colors.green.on : colors.green.off;
    ctx.beginPath(); ctx.arc(0, positions[2], r, 0, Math.PI * 2); ctx.fill();
    if (green) {
      ctx.shadowColor = colors.green.glow; ctx.shadowBlur = bw * 1.8;
      ctx.beginPath(); ctx.arc(0, positions[2], r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  // ── 7. Vehicles ───────────────────────────────────────────────────────────
  _drawVehicles(vehicles) {
    const { ctx } = this;

    for (const v of vehicles) {
      if (v.remove) continue;

      const cx = this.wx(v.x);
      const cy = this.wy(v.y);
      const w  = this.wp(v.type.width);
      const h  = this.wp(v.type.length);

      ctx.save();
      ctx.globalAlpha = v.alpha ?? 1;
      ctx.translate(cx, cy);
      ctx.rotate(v.angle);

      // Drop shadow
      ctx.shadowColor   = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur    = this.wp(0.6);
      ctx.shadowOffsetX = this.wp(0.15);
      ctx.shadowOffsetY = this.wp(0.3);

      // Body (rounded rect)
      ctx.fillStyle = v.color;
      this._rrect(-w / 2, -h / 2, w, h, this.wp(0.35));
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = ctx.shadowOffsetY = 0;

      // Body highlight stripe (top)
      const hg = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, -h / 2);
      hg.addColorStop(0,   'rgba(255,255,255,0.0)');
      hg.addColorStop(0.4, 'rgba(255,255,255,0.18)');
      hg.addColorStop(1,   'rgba(255,255,255,0.0)');
      ctx.fillStyle = hg;
      this._rrect(-w / 2, -h / 2, w, h * 0.5, this.wp(0.35));
      ctx.fill();

      // Windshield
      ctx.fillStyle = 'rgba(160,215,255,0.48)';
      ctx.fillRect(-w * 0.36, -h * 0.43, w * 0.72, h * 0.25);

      // Headlights (front)
      ctx.fillStyle = '#fff8d8';
      ctx.beginPath(); ctx.arc(-w * 0.3,  -h * 0.45, w * 0.13, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc( w * 0.3,  -h * 0.45, w * 0.13, 0, Math.PI * 2); ctx.fill();

      // Tail lights (rear)
      ctx.fillStyle = v.speed < 0.5 ? '#ff5555' : '#cc1111';
      ctx.beginPath(); ctx.arc(-w * 0.3, h * 0.45, w * 0.11, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc( w * 0.3, h * 0.45, w * 0.11, 0, Math.PI * 2); ctx.fill();

      ctx.restore();
    }
  }

  // ── 8. HUD ────────────────────────────────────────────────────────────────
  _drawHUD(ls, metrics, vCount, debug = false) {
    const { ctx, W, H } = this;
    const pad = this.wp(1);

    // -- Phase indicator (top right) ---
    const phaseLabel = ls.isYellow
      ? '🟡 KUNING — Transisi'
      : `🟢 ${ls.phaseName}`;
    const signalColor = ls.isYellow ? '#ffcc00' : '#22c55e';
    const timerText   = `${Math.ceil(ls.timer)}s / ${ls.totalGreen}s` + (debug ? ' [DEBUG ACTIVE]' : '');

    const fw = this.wp(28), fh = this.wp(5);
    const fx = W - fw - pad, fy = pad;

    ctx.save();
    // Panel background
    ctx.fillStyle = 'rgba(8,14,28,0.72)';
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth   = 1;
    this._rrect(fx, fy, fw, fh, this.wp(0.5));
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle    = signalColor;
    ctx.font         = `bold ${this.wp(1.6)}px system-ui`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(phaseLabel, fx + pad, fy + this.wp(0.6));

    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font      = `${this.wp(1.2)}px monospace`;
    ctx.fillText(timerText, fx + pad, fy + this.wp(2.6));

    // Progress bar inside panel
    const bx = fx + pad, by = fy + fh - this.wp(0.9), bw = fw - pad * 2, bh = this.wp(0.5);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    this._rrect(bx, by, bw, bh, this.wp(0.25)); ctx.fill();
    const pct = Math.max(0, Math.min(1, ls.timer / ls.totalGreen));
    ctx.fillStyle = signalColor;
    this._rrect(bx, by, bw * pct, bh, this.wp(0.25)); ctx.fill();

    ctx.restore();

    // -- Bottom stats bar ---
    const statH = this.wp(3.5);
    ctx.save();
    ctx.fillStyle = 'rgba(8,14,28,0.68)';
    ctx.fillRect(0, H - statH, this.wp(52), statH);

    const stats = [
      { icon: '🚗', val: `${vCount}`, label: 'vehs aktif' },
      { icon: '📤', val: `${metrics.throughput}`, label: 'keluar' },
      { icon: '⏱', val: metrics.totalServed > 0
          ? `${(metrics.totalWait / metrics.totalServed).toFixed(1)}s`
          : '—',
        label: 'avg delay' },
    ];

    ctx.textBaseline = 'middle';
    const my = H - statH / 2;
    let sx = this.wp(1.2);
    for (const s of stats) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font      = `${this.wp(1.3)}px system-ui`;
      ctx.textAlign = 'left';
      ctx.fillText(`${s.icon} `, sx, my);
      ctx.fillStyle = '#e2e8f0';
      ctx.font      = `bold ${this.wp(1.4)}px system-ui`;
      ctx.fillText(s.val, sx + this.wp(2.2), my);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font      = `${this.wp(1.1)}px system-ui`;
      ctx.fillText(s.label, sx + this.wp(2.2) + ctx.measureText(s.val).width + this.wp(0.4), my);
      sx += this.wp(13);
    }
    ctx.restore();
  }

  // ── Geometry helpers ──────────────────────────────────────────────────────

  /** Fill a rect given world-space coordinates */
  _fr(wx, wy, ww, wh) {
    this.ctx.fillRect(this.wx(wx), this.wy(wy), this.wp(ww), this.wp(wh));
  }

  /** Stroke a line between two world-space points */
  _sl(x1, y1, x2, y2) {
    this.ctx.beginPath();
    this.ctx.moveTo(this.wx(x1), this.wy(y1));
    this.ctx.lineTo(this.wx(x2), this.wy(y2));
    this.ctx.stroke();
  }

  /** Create a rounded-rect path (no fill/stroke — caller decides) */
  _rrect(x, y, w, h, r) {
    const { ctx } = this;
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
