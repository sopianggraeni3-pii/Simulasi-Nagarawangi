/**
 * Vehicle.js - Individual Vehicle Model
 *
 * Implements the Intelligent Driver Model (IDM) for car-following behavior.
 * Each vehicle maintains its own physics: position, velocity, acceleration.
 *
 * IDM formula:
 *   a = amax * [1 - pow(v/v0, 4) - pow(sstar/s, 2)]
 *   sstar = s0 + v*T + v*dv / (2*sqrt(a*b))
 *
 * References:
 *   Treiber, M., Hennecke, A., & Helbing, D. (2000). Congested traffic states
 *   in empirical observations and microscopic simulations. Physical Review E.
 */

// ── Vehicle type definitions ──────────────────────────────────────────────────
export const VEHICLE_TYPES = {
  car: {
    id: 'car',
    length: 4.5,          // metres (world units)
    width: 2.0,
    maxAccel: 2.0,        // m/s²
    comfortDecel: 3.0,    // m/s² (comfortable braking)
    maxDecel: 8.0,        // m/s² (emergency braking)
    desiredSpeed: 11.0,   // m/s ≈ 40 km/h (in-city)
    minGap: 2.0,          // s0 — minimum bumper-to-bumper gap (m)
    timeHeadway: 1.5,     // T — desired time gap (s)
    weight: 0.55,         // spawn probability weight
    colors: ['#2563eb', '#1d4ed8', '#3b82f6', '#1e40af', '#60a5fa'],
    renderH: 18, renderW: 10,  // canvas px base dimensions
  },
  motorcycle: {
    id: 'motorcycle',
    length: 2.2,
    width: 0.9,
    maxAccel: 3.0,
    comfortDecel: 4.0,
    maxDecel: 9.0,
    desiredSpeed: 13.0,
    minGap: 1.2,
    timeHeadway: 1.0,
    weight: 0.28,
    colors: ['#7c3aed', '#8b5cf6', '#6d28d9', '#a78bfa'],
    renderH: 11, renderW: 5,
  },
  angkot: {
    id: 'angkot',
    length: 6.0,
    width: 2.2,
    maxAccel: 1.5,
    comfortDecel: 2.5,
    maxDecel: 7.0,
    desiredSpeed: 9.0,
    minGap: 3.0,
    timeHeadway: 2.0,
    weight: 0.11,
    colors: ['#b45309', '#d97706', '#92400e', '#f59e0b'],
    renderH: 23, renderW: 12,
  },
  truck: {
    id: 'truck',
    length: 8.0,
    width: 2.5,
    maxAccel: 1.0,
    comfortDecel: 2.0,
    maxDecel: 6.0,
    desiredSpeed: 8.0,
    minGap: 4.0,
    timeHeadway: 2.5,
    weight: 0.06,
    colors: ['#166534', '#15803d', '#14532d', '#22c55e'],
    renderH: 25, renderW: 13,
  },
};

// Cumulative weight thresholds for O(1) type picking
const TYPE_KEYS = Object.keys(VEHICLE_TYPES);
const CUM_WEIGHTS = [];
let _cw = 0;
for (const k of TYPE_KEYS) { _cw += VEHICLE_TYPES[k].weight; CUM_WEIGHTS.push(_cw); }

/**
 * Pick a random vehicle type based on weighted probabilities.
 * @returns {string} vehicle type key
 */
export function pickVehicleType() {
  const r = Math.random();
  for (let i = 0; i < CUM_WEIGHTS.length; i++) {
    if (r <= CUM_WEIGHTS[i]) return TYPE_KEYS[i];
  }
  return 'car';
}

// ── Static ID counter ──────────────────────────────────────────────────────────
let _nextId = 1;

/**
 * Vehicle — represents a single vehicle in the simulation.
 *
 * Physics are maintained in "world" coordinates (metres).
 * The Renderer maps world coords → canvas pixels using the scale factor.
 *
 * States:
 *   'approach' — moving toward stop line
 *   'queued'   — stopped at/behind stop line
 *   'cross'    — traversing the intersection
 *   'exit'     — leaving the scene, pending removal
 */
export class Vehicle {
  /**
   * @param {string} typeKey   — one of VEHICLE_TYPES keys
   * @param {number} streamId  — index in the intersection stream array
   * @param {object} spawnPos  — { x, y } in world metres
   */
  constructor(typeKey, streamId, spawnPos) {
    this.id       = _nextId++;
    this.typeKey  = typeKey;
    this.type     = VEHICLE_TYPES[typeKey];
    this.streamId = streamId;

    // ── Position & kinematics (world units = metres) ──────────────────────
    this.x   = spawnPos.x;
    this.y   = spawnPos.y;
    this.vx  = 0;   // velocity components
    this.vy  = 0;
    this.ax  = 0;   // acceleration components
    this.ay  = 0;
    this.speed = 0; // scalar speed (m/s)
    this.angle = 0; // heading angle (radians), 0 = up

    // ── State machine ─────────────────────────────────────────────────────
    this.state   = 'approach'; // 'approach' | 'queued' | 'cross' | 'exit'
    this.pathIdx = 0;          // current waypoint index in cross-path

    // ── Appearance ───────────────────────────────────────────────────────
    const cols = this.type.colors;
    this.color  = cols[Math.floor(Math.random() * cols.length)];
    this.alpha  = 1.0;

    // ── Metrics ──────────────────────────────────────────────────────────
    this.waitTime     = 0;   // total seconds spent waiting (speed < 0.5 m/s)
    this.spawnTime    = 0;   // simulation time at spawn (set by engine)
    this.remove       = false;

    // ── Stall detection (deadlock prevention) ─────────────────────────────
    this._stallTimer  = 0;
    this._lastX       = this.x;
    this._lastY       = this.y;
  }

  // ── IDM acceleration calculation ─────────────────────────────────────────
  /**
   * Compute desired acceleration using IDM.
   *
   * @param {number} leadGap    — net gap to vehicle ahead (metres); Infinity if none
   * @param {number} leadSpeed  — speed of leading vehicle (m/s); 0 if stopped/none
   * @param {number} targetSpeed — desired speed cap for this context (m/s)
   * @returns {number} acceleration (m/s², may be negative)
   */
  computeIDM(leadGap, leadSpeed, targetSpeed) {
    const t  = this.type;
    const v  = this.speed;
    const v0 = Math.min(t.desiredSpeed, targetSpeed);
    const dv = v - leadSpeed; // approach rate (positive = closing)

    // Desired following distance s*
    const s_star = t.minGap + Math.max(0, v * t.timeHeadway + (v * dv) / (2 * Math.sqrt(t.maxAccel * t.comfortDecel)));

    // IDM formula
    const freeRoadTerm   = 1 - Math.pow(v / Math.max(v0, 0.1), 4);
    const interactionTerm = leadGap > 0 ? -Math.pow(s_star / Math.max(leadGap, 0.01), 2) : 0;

    const a = t.maxAccel * (freeRoadTerm + interactionTerm);
    return Math.max(-t.maxDecel, Math.min(t.maxAccel, a));
  }

  /**
   * Update stall timer to detect deadlocks.
   * @param {number} dt — timestep (s)
   */
  updateStall(dt) {
    const moved = Math.hypot(this.x - this._lastX, this.y - this._lastY);
    if (moved < 0.05 && this.state !== 'exit') {
      this._stallTimer += dt;
    } else {
      this._stallTimer = 0;
      this._lastX = this.x;
      this._lastY = this.y;
    }
  }

  /** @returns {boolean} true if vehicle has been stalled > threshold */
  isStalled(threshold = 12) {
    return this._stallTimer > threshold;
  }
}
