/**
 * TrafficLight.js — Signal Phase Control
 *
 * Models a 3-phase traffic signal cycle for the Nagarawangi intersection:
 *   Phase A (0): West → East  [stream 4] — GREEN
 *   Phase B (1): North → West [stream 6] — GREEN
 *   Phase C (2): South → North [stream 1] — GREEN
 *
 * Each phase has:
 *   - A green interval (adaptive or fixed)
 *   - A yellow interval (3 s, fixed)
 *   - Red = all other phases
 *
 * Adaptive green logic (Hybrid GC-Greedy):
 *   greenTime = clamp(ceil(phaseQueue / satFlow) + buffer, MIN_GREEN, MAX_GREEN)
 *
 * Fixed-time control simply cycles with a constant FIXED_GREEN duration.
 */

// ── Phase definitions ─────────────────────────────────────────────────────────
export const SIGNAL_PHASES = [
  { id: 0, name: 'Fase A — Barat Lurus', streams: [4], color: '#f59e0b' },
  { id: 1, name: 'Fase B — Utara Kanan', streams: [6], color: '#3b82f6' },
  { id: 2, name: 'Fase C — Selatan Lurus', streams: [1], color: '#22c55e' },
];

// ── Timing constants (seconds) ────────────────────────────────────────────────
const YELLOW_DURATION = 4;   // yellow clearance between phases
const MIN_GREEN       = 15;  // minimum green time (practical minimum)
const MAX_GREEN       = 60;  // maximum green time (prevents excessive delay on other roads)
const FIXED_GREEN     = 30;  // fixed-time control interval
const SAT_FLOW        = 1.8; // saturation flow rate (veh/s) — how fast vehicles drain at green

/**
 * TrafficLight — manages the phase cycle and duration for one intersection.
 *
 * @param {boolean} adaptive — true → adaptive Hybrid GC-Greedy, false → fixed-time
 */
export class TrafficLight {
  constructor(adaptive = false) {
    this.adaptive     = adaptive;
    this.phaseIdx     = 0;             // current phase index (0–2)
    this.signal       = 'green';       // 'green' | 'yellow' | 'red'
    // Adaptive starts at MIN_GREEN (queues are empty at T=0, no need for max)
    this.timer        = adaptive ? MIN_GREEN : FIXED_GREEN; // countdown (s)
    this.totalGreen   = adaptive ? MIN_GREEN : FIXED_GREEN; // for progress bar

    // Yellow sub-state
    this._yellowTimer = 0;

    // Metrics
    this.cycleCount   = 0;
    this.phaseDurations = [[], [], []]; // history of green durations per phase
  }

  // ── Accessors ────────────────────────────────────────────────────────────

  /** @returns {number[]} stream IDs currently receiving GREEN signal */
  get greenStreams() {
    return SIGNAL_PHASES[this.phaseIdx].streams;
  }

  /** @returns {string} name of the active phase */
  get phaseName() {
    return SIGNAL_PHASES[this.phaseIdx].name;
  }

  /** @returns {string} accent color of the active phase */
  get phaseColor() {
    return SIGNAL_PHASES[this.phaseIdx].color;
  }

  /**
   * Check if a given stream ID has a green signal right now.
   * @param {number} streamId
   * @returns {boolean}
   */
  isGreen(streamId) {
    return this.signal === 'green' && this.greenStreams.includes(streamId);
  }

  /**
   * Check if the signal is currently in yellow transition.
   * @returns {boolean}
   */
  get isYellow() {
    return this.signal === 'yellow';
  }

  // ── Update ───────────────────────────────────────────────────────────────

  /**
   * Advance the traffic light by one timestep.
   *
   * @param {number}   dt     — timestep (seconds)
   * @param {number[]} queues — current queue length per stream [0..6] (used for adaptive)
   */
  step(dt, queues) {
    if (this.signal === 'yellow') {
      // ── Yellow phase countdown ──────────────────────────────────────────
      this._yellowTimer -= dt;
      if (this._yellowTimer <= 0) {
        this._advancePhase(queues);
      }
    } else {
      // ── Green phase countdown ───────────────────────────────────────────
      this.timer -= dt;
      if (this.timer <= 0) {
        // Transition to yellow
        this.signal       = 'yellow';
        this._yellowTimer = YELLOW_DURATION;
      }
    }
  }

  /**
   * Advance to the next phase after yellow clears.
   * @private
   */
  _advancePhase(queues) {
    // Record duration history
    this.phaseDurations[this.phaseIdx].push(this.totalGreen);
    if (this.phaseDurations[this.phaseIdx].length > 20) {
      this.phaseDurations[this.phaseIdx].shift();
    }

    this.phaseIdx = (this.phaseIdx + 1) % SIGNAL_PHASES.length;
    this.signal   = 'green';
    this.cycleCount++;

    // Compute green duration for the new phase
    if (this.adaptive) {
      this.totalGreen = this._computeAdaptiveGreen(queues);
    } else {
      this.totalGreen = FIXED_GREEN;
    }
    this.timer = this.totalGreen;
  }

  /**
   * Compute adaptive green time using Hybrid GC-Greedy algorithm.
   *
   * The algorithm:
   *   1. Sum the queue for the incoming phase's streams
   *   2. Calculate clearance time: ceil(queue / satFlow)
   *   3. Add a 5-second safety buffer
   *   4. Clamp to [MIN_GREEN, MAX_GREEN]
   *
   * This ensures heavy queues get more green time while respecting
   * minimum and maximum bounds for fairness and safety.
   *
   * @param {number[]} queues — current queue length per stream
   * @returns {number} green duration in seconds
   */
  _computeAdaptiveGreen(queues) {
    const streams    = SIGNAL_PHASES[this.phaseIdx].streams;
    const phaseQueue = streams.reduce((sum, si) => sum + (queues[si] || 0), 0);
    const needed     = Math.ceil(phaseQueue / SAT_FLOW) + 5;
    return Math.max(MIN_GREEN, Math.min(MAX_GREEN, needed));
  }

  /**
   * Serialize current state for React UI consumption.
   * @returns {object}
   */
  snapshot() {
    return {
      phaseIdx:   this.phaseIdx,
      phaseName:  this.phaseName,
      phaseColor: this.phaseColor,
      greenStreams: this.greenStreams,
      signal:     this.signal,
      timer:      this.timer,
      totalGreen: this.totalGreen,
      isYellow:   this.isYellow,
    };
  }
}
