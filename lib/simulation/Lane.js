/**
 * Lane.js — Lane & Stream Management
 *
 * Each Lane models one directional traffic stream at the intersection.
 * It maintains: spawn point, stop line, cross-path waypoints, and a
 * sorted queue of vehicles approaching the stop line.
 *
 * "World coordinates" here are in abstract metres — the Renderer scales
 * them to canvas pixels using a pixels-per-metre (ppm) factor computed
 * from canvas dimensions and the intersection geometry.
 *
 * Nagarawangi Intersection streams (7 total):
 *   0 — South → West  (left,    free-flow)
 *   1 — South → North (straight, controlled — Phase C)
 *   2 — South → East  (right,   free-flow)
 *   3 — West  → North (left,    free-flow)
 *   4 — West  → East  (straight, controlled — Phase A)
 *   5 — North → East  (left,    free-flow)
 *   6 — North → West  (right,   controlled — Phase B)
 */

/**
 * @typedef {Object} Waypoint
 * @property {number} x
 * @property {number} y
 */

/**
 * @typedef {Object} LaneConfig
 * @property {number}     id           — stream index (0–6)
 * @property {string}     label        — human-readable label
 * @property {string}     direction    — 'N'|'S'|'E'|'W' (inbound direction)
 * @property {string}     turn         — 'straight'|'left'|'right'
 * @property {boolean}    freeFlow     — true → not controlled by a traffic light
 * @property {number}     controlPhase — phase index that grants green (-1 if free-flow)
 * @property {Waypoint}   spawn        — vehicle spawn point (off-screen)
 * @property {Waypoint}   stopLine     — where vehicles queue before stop line
 * @property {Waypoint[]} crossPath    — waypoints to traverse the intersection
 * @property {number[]}   conflicts    — stream IDs that physically conflict in box
 * @property {number[]}   yields       — for free-flow: stream IDs to yield to
 */

export class Lane {
  /**
   * @param {LaneConfig} config
   */
  constructor(config) {
    this.id           = config.id;
    this.label        = config.label;
    this.direction    = config.direction;
    this.turn         = config.turn;
    this.freeFlow     = config.freeFlow;
    this.controlPhase = config.controlPhase;
    this.spawn        = config.spawn;         // { x, y }
    this.stopLine     = config.stopLine;      // { x, y }
    this.crossPath    = config.crossPath;     // [{ x, y }, ...]
    this.conflicts    = config.conflicts ?? [];
    this.yields       = config.yields ?? [];

    /** @type {import('./Vehicle').Vehicle[]} vehicles on this stream */
    this.vehicles     = [];

    // ── Runtime metrics ──────────────────────────────────────────────────
    this.totalPassed  = 0;    // cumulative vehicles that completed crossing
    this.totalWait    = 0;    // accumulated wait time (veh·s)
  }

  // ── Queue helpers ────────────────────────────────────────────────────────

  /**
   * Count vehicles ahead of `veh` in the approach queue.
   * "Ahead" means closer to the stop line.
   * @param {import('./Vehicle').Vehicle} veh
   * @returns {number}
   */
  queueAhead(veh) {
    const { x: sx, y: sy } = this.stopLine;
    const dist2 = (v) => (sx - v.x) ** 2 + (sy - v.y) ** 2;
    const myD   = dist2(veh);
    let count = 0;
    for (const v of this.vehicles) {
      if (v === veh) continue;
      if (v.state !== 'approach' && v.state !== 'queued') continue;
      const d = dist2(v);
      // Strict tie-break by ID prevents ghost-merging
      if (d < myD || (Math.abs(d - myD) < 0.001 && v.id < veh.id)) count++;
    }
    return count;
  }

  /**
   * Find the nearest vehicle ahead of `veh` that is also on this lane
   * and in approach/queued state (for IDM following).
   *
   * @param {import('./Vehicle').Vehicle} veh
   * @returns {{ gap: number, speed: number }} net gap (m) and leader speed (m/s)
   */
  getLeader(veh) {
    const { x: sx, y: sy } = this.stopLine;
    const dist2 = (v) => (sx - v.x) ** 2 + (sy - v.y) ** 2;
    const myD   = dist2(veh);

    let bestGap   = Infinity;
    let bestSpeed = 0;

    for (const v of this.vehicles) {
      if (v === veh) continue;
      // Allow vehicles in 'cross' state on the same stream as valid leaders
      if (v.state !== 'approach' && v.state !== 'queued' && v.state !== 'cross') continue;

      const d = dist2(v);
      // If the leader is crossing, it is already past the stop line (ahead of us)
      if (v.state !== 'cross' && d >= myD) continue; // v is behind veh (farther from stop line)

      // Euclidean distance between veh and v centres
      const centreDist = Math.hypot(v.x - veh.x, v.y - veh.y);
      // Net gap = centre-to-centre minus half-lengths of both vehicles
      const gap = centreDist - veh.type.length / 2 - v.type.length / 2;

      if (gap < bestGap) {
        bestGap   = gap;
        bestSpeed = v.speed;
      }
    }
    return { gap: bestGap, speed: bestSpeed };
  }

  /**
   * Compute the "virtual stop-line vehicle" gap — treat the stop line as a
   * stationary obstacle at distance `distToStop` ahead of veh.
   * Returns null if the stop line is not a constraint (green / free-flow).
   *
   * @param {import('./Vehicle').Vehicle} veh
   * @param {boolean} mustStop — true → treat stop line as obstacle
   * @returns {{ gap: number, speed: number } | null}
   */
  getStopLineGap(veh, mustStop) {
    if (!mustStop) return null;
    const distToStop = Math.hypot(this.stopLine.x - veh.x, this.stopLine.y - veh.y);
    const gap = distToStop - veh.type.length / 2; // net gap (m)
    return { gap: Math.max(0, gap), speed: 0 };
  }

  /**
   * Current vehicle count in queue (approach + queued).
   * @returns {number}
   */
  get queueLength() {
    return this.vehicles.filter(v => v.state === 'approach' || v.state === 'queued').length;
  }

  /**
   * Number of vehicles actively crossing the intersection on this stream.
   * @returns {number}
   */
  get crossingCount() {
    return this.vehicles.filter(v => v.state === 'cross').length;
  }
}

// ── Geometry builder ──────────────────────────────────────────────────────────

/**
 * Build the canonical array of 7 Lane objects for the Nagarawangi intersection.
 *
 * Coordinates are in "world metres" with the intersection centre at (0, 0).
 * The canvas renderer maps (0,0) → (CX, CY) and applies a pixels-per-metre scale.
 *
 * Road layout (distances from centre, approximate):
 *   Road half-width  W_h  = 8 m  (double lane)
 *   North road width W_n  = 10 m (wider, with median)
 *   Stop distance    S    = 15 m (stop line from centre)
 *   Spawn distance   Sp   = 70 m (off-screen spawn)
 *   Exit distance    Ex   = 80 m (despawn threshold)
 *
 * @returns {Lane[]}
 */
export function buildLanes() {
  const W_h = 8;    // road half-width (m) — east/west/south roads
  const W_n = 10;   // north road half-width (wider due to median)
  const MED = 2;    // north road median half-width
  const S   = 15;   // stop line distance from centre
  const Sp  = 70;   // spawn distance (off-screen)
  const Ex  = 80;   // exit/despawn distance

  const LANES = [
    // ── Stream 0: South → West (left turn, free-flow) ──────────────────────
    {
      id: 0, label: 'Sel → Bar (Ki)', direction: 'S', turn: 'left',
      freeFlow: true, controlPhase: -1,
      spawn:    { x: -W_h * 0.6, y: Sp },
      stopLine: { x: -W_h * 0.6, y: S },
      crossPath: [
        { x: -W_h * 0.6, y: S },
        { x: -W_h * 0.6, y: W_h * 0.5 },
        { x: -Ex, y: W_h * 0.5 },
      ],
      conflicts: [4, 6],
      yields:    [6],
    },

    // ── Stream 1: South → North (straight, controlled Phase C) ─────────────
    {
      id: 1, label: 'Sel → Utr (Lr)', direction: 'S', turn: 'straight',
      freeFlow: false, controlPhase: 2,
      spawn:    { x: 0, y: Sp },
      stopLine: { x: 0, y: S },
      crossPath: [
        { x: 0,         y: S },
        { x: -(W_h + MED), y: W_h * 0.5 },
        { x: -(W_h + MED), y: -Ex },
      ],
      conflicts: [4, 6],
      yields:    [],
    },

    // ── Stream 2: South → East (right turn, free-flow) ──────────────────────
    {
      id: 2, label: 'Sel → Tim (Kn)', direction: 'S', turn: 'right',
      freeFlow: true, controlPhase: -1,
      spawn:    { x: W_h * 0.6, y: Sp },
      stopLine: { x: W_h * 0.6, y: S },
      crossPath: [
        { x: W_h * 0.6, y: S },
        { x: W_h * 0.6, y: W_h * 0.5 },
        { x: Ex,         y: W_h * 0.5 },
      ],
      conflicts: [4, 6],
      yields:    [4],
    },

    // ── Stream 3: West → North (left turn, free-flow) ───────────────────────
    {
      id: 3, label: 'Bar → Utr (Ki)', direction: 'W', turn: 'left',
      freeFlow: true, controlPhase: -1,
      spawn:    { x: -Sp, y: -W_h * 0.45 },
      stopLine: { x: -S,  y: -W_h * 0.45 },
      crossPath: [
        { x: -S,           y: -W_h * 0.45 },
        { x: -(W_h + MED), y: -W_h * 0.45 },
        { x: -(W_h + MED), y: -Ex },
      ],
      conflicts: [1, 6],
      yields:    [1],
    },

    // ── Stream 4: West → East (straight, controlled Phase A) ─────────────────
    {
      id: 4, label: 'Bar → Tim (Lr)', direction: 'W', turn: 'straight',
      freeFlow: false, controlPhase: 0,
      spawn:    { x: -Sp, y: -W_h * 0.5 },
      stopLine: { x: -S,  y: -W_h * 0.5 },
      crossPath: [
        { x: -S,  y: -W_h * 0.5 },
        { x:  0,  y:  W_h * 0.6 }, // dip south to clear roundabout
        { x: Ex,  y: -W_h * 0.5 },
      ],
      conflicts: [1, 6],
      yields:    [],
    },

    // ── Stream 5: North → East (left turn, free-flow) ────────────────────────
    {
      id: 5, label: 'Utr → Tim (Ki)', direction: 'N', turn: 'left',
      freeFlow: true, controlPhase: -1,
      spawn:    { x: W_h + MED, y: -Sp },
      stopLine: { x: W_h + MED, y: -S  },
      crossPath: [
        { x: W_h + MED, y: -S  },
        { x: W_h + MED, y: -W_h * 0.45 },
        { x: Ex,         y: -W_h * 0.45 },
      ],
      conflicts: [1, 4],
      yields:    [4],
    },

    // ── Stream 6: North → West (right turn, controlled Phase B) ─────────────
    {
      id: 6, label: 'Utr → Bar (Kn)', direction: 'N', turn: 'right',
      freeFlow: false, controlPhase: 1,
      spawn:    { x: W_h + MED, y: -Sp },
      stopLine: { x: W_h + MED, y: -S  },
      crossPath: [
        { x: W_h + MED, y: -S  },
        { x: W_h + MED, y:  W_h * 0.45 },
        { x: -Ex,        y:  W_h * 0.45 },
      ],
      conflicts: [1, 4],
      yields:    [],
    },
  ];

  return LANES.map(cfg => new Lane(cfg));
}
