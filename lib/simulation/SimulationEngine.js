/**
 * SimulationEngine.js - Master Simulation Loop
 *
 * Orchestrates all subsystems:
 *   Vehicle physics (IDM) -> Traffic logic -> Metrics collection
 *
 * Data-driven spawning:
 *   - Takes a dataset of { time, north, south, east, west } records
 *   - Converts per-minute counts into per-second rates
 *   - Distributes spawning smoothly using Poisson-like accumulation
 *   - Interpolates rates linearly between dataset waypoints
 *
 * Game loop:  engine.step(dt)  ->  update(dt)  ->  metrics snapshot
 *
 * The engine does NOT own a requestAnimationFrame loop.
 * The host React hook drives timing and calls step() each frame.
 */

import { Vehicle, pickVehicleType } from './Vehicle.js';
import { buildLanes } from './Lane.js';
import { TrafficLight } from './TrafficLight.js';
import { IntersectionController } from './IntersectionController.js';

// ── Dataset ──────────────────────────────────────────────────────────────────────
/**
 * Default dataset — arrival counts per minute per road arm.
 * Based on Nagarawangi intersection survey data.
 * time = seconds since simulation start.
 *
 * Stream split ratios:
 *   South: stream 0 (10%), 1 (70%), 2 (20%)
 *   West:  stream 3 (54%), 4 (46%)
 *   North: stream 5 (40%), 6 (60%)
 */
export const DEFAULT_DATASET = [
  { time: 0,   south: 42, west: 26, north: 20 },
  { time: 300, south: 55, west: 32, north: 28 },
  { time: 600, south: 68, west: 38, north: 35 },
  { time: 900, south: 80, west: 45, north: 42 },
];

const SOUTH_SPLIT = [0.10, 0.70, 0.20];
const WEST_SPLIT  = [0.54, 0.46];
const NORTH_SPLIT = [0.40, 0.60];

// ── Physics constants ─────────────────────────────────────────────────────────
const APPROACH_SPEED  = 11;   // m/s — max speed on approach lane
const CROSS_SPEED     = 8;    // m/s — speed crossing the intersection
const EXIT_SPEED      = 13;   // m/s — speed after exiting intersection
const MAX_VEHICLES    = 150;  // hard cap for performance
const SPAWN_GAP       = 10;   // m — minimum clearance at spawn point
const STOP_THRESHOLD  = 3.0;  // m — distance-to-stopline that triggers state change
// Despawn when vehicle is clearly off canvas (world metres from origin)
const DESPAWN_DIST    = 95;

// ── Engine ────────────────────────────────────────────────────────────────────
export class SimulationEngine {
  /**
   * @param {object}  opts
   * @param {boolean} opts.adaptive  true -> Hybrid GC-Greedy, false -> Fixed-Time
   * @param {Array}   opts.dataset   arrival dataset (defaults to DEFAULT_DATASET)
   */
  constructor({ adaptive = false, dataset = DEFAULT_DATASET } = {}) {
    this.adaptive = adaptive;
    this.dataset  = dataset;

    this.lanes      = buildLanes();
    this.light      = new TrafficLight(adaptive);
    this.controller = new IntersectionController(this.lanes, this.light);

    /** @type {Vehicle[]} */
    this.vehicles = [];

    this.time    = 0;
    this.running = false;

    // Per-stream spawn accumulator (fractional vehicles)
    this._spawnAcc = new Float64Array(7);

    // Cumulative metrics
    this.metrics = {
      throughput:      0,   // vehicles removed from scene
      totalWait:       0,   // veh·s of red-light waiting
      totalServed:     0,   // vehicles that completed crossing
      queueSnapshot:   new Array(7).fill(0),
      densitySnapshot: new Array(7).fill(0),
    };

    this._deadlockTimer = 0;
    // Road segment lengths for density calculation (km)
    this._roadLen = [0.15, 0.20, 0.15, 0.12, 0.20, 0.12, 0.18];
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Advance the simulation by dt seconds.
   * @param {number} dt  timestep (s) — typically 1/60
   */
  step(dt) {
    if (!this.running) return;

    this.time += dt;

    // 1. Traffic light phase transition
    const queueLens = this.controller.getQueueLengths();
    this.light.step(dt, queueLens);

    // 2. Spawn vehicles from dataset
    this._spawnVehicles(dt);

    // 3. Rebuild lane vehicle lists once before physics
    this._rebuildLaneVehicles();

    // 4. Physics + state machine for all vehicles
    this._updateVehicles(dt);

    // 5. Remove exited vehicles, count throughput
    const before = this.vehicles.length;
    this.vehicles = this.vehicles.filter(v => !v.remove);
    this.metrics.throughput += before - this.vehicles.length;

    // 6. Deadlock resolution every 4 simulated seconds
    this._deadlockTimer += dt;
    if (this._deadlockTimer >= 4) {
      this._deadlockTimer = 0;
      this.controller.resolveDeadlocks(this.vehicles, this.lanes);
    }

    // 7. Snapshot metrics
    this._rebuildLaneVehicles(); // keep lanes fresh for next step
    this._snapshotMetrics();
  }

  /**
   * Serialise current state for the React UI (cheap shallow copy).
   */
  snapshot() {
    return {
      time:         this.time,
      running:      this.running,
      light:        this.light.snapshot(),
      metrics:      { ...this.metrics },
      vehicleCount: this.vehicles.length,
      queues:       this.lanes.map(l => l.queueLength),
    };
  }

  // ── Lane vehicle list rebuild ─────────────────────────────────────────────────
  _rebuildLaneVehicles() {
    // Clear first
    for (const lane of this.lanes) lane.vehicles = [];
    // Assign
    for (const v of this.vehicles) {
      if (!v.remove) this.lanes[v.streamId].vehicles.push(v);
    }
  }

  // ── Spawning ──────────────────────────────────────────────────────────────────

  /**
   * Compute per-stream arrival rates (veh/s) by linear interpolation.
   */
  _getArrivalRates(t) {
    const ds = this.dataset;
    let i = 0;
    while (i < ds.length - 1 && ds[i + 1].time <= t) i++;

    let south, west, north;
    if (i >= ds.length - 1) {
      ({ south, west, north } = ds[ds.length - 1]);
    } else {
      const a = ds[i], b = ds[i + 1];
      const f = (t - a.time) / (b.time - a.time);
      south = a.south + f * (b.south - a.south);
      west  = a.west  + f * (b.west  - a.west);
      north = a.north + f * (b.north - a.north);
    }

    const r = new Float64Array(7);
    r[0] = (south / 60) * SOUTH_SPLIT[0];
    r[1] = (south / 60) * SOUTH_SPLIT[1];
    r[2] = (south / 60) * SOUTH_SPLIT[2];
    r[3] = (west  / 60) * WEST_SPLIT[0];
    r[4] = (west  / 60) * WEST_SPLIT[1];
    r[5] = (north / 60) * NORTH_SPLIT[0];
    r[6] = (north / 60) * NORTH_SPLIT[1];
    return r;
  }

  _spawnVehicles(dt) {
    const rates = this._getArrivalRates(this.time);
    for (let si = 0; si < 7; si++) {
      // Scale spawn rate down to 35% of current value for a moderate and clear flow
      this._spawnAcc[si] += rates[si] * dt * 0.35;
      while (this._spawnAcc[si] >= 1.0) {
        this._spawnAcc[si] -= 1.0;
        this._trySpawn(si);
      }
    }
  }

  _trySpawn(si) {
    if (this.vehicles.length >= MAX_VEHICLES) return;
    const lane = this.lanes[si];

    // Ensure spawn point is clear (prevent birth overlaps)
    for (const v of this.vehicles) {
      if (v.streamId !== si) continue;
      if (Math.hypot(v.x - lane.spawn.x, v.y - lane.spawn.y) < SPAWN_GAP) return;
    }

    const veh       = new Vehicle(pickVehicleType(), si, { ...lane.spawn });
    veh.spawnTime   = this.time;
    veh.speed       = APPROACH_SPEED * 0.3; // gentle entry speed
    this.vehicles.push(veh);
    lane.vehicles.push(veh);
  }

  // ── Vehicle physics loop ──────────────────────────────────────────────────────

  _updateVehicles(dt) {
    for (const veh of this.vehicles) {
      if (veh.remove) continue;
      const lane = this.lanes[veh.streamId];
      this._stepVehicle(veh, lane, dt);
      veh.updateStall(dt);

      // Accumulate wait time for controlled streams waiting at red
      if (veh.speed < 0.3 &&
          (veh.state === 'approach' || veh.state === 'queued') &&
          !lane.freeFlow && !this.light.isGreen(lane.id)) {
        this.metrics.totalWait += dt;
      }
    }
  }

  _stepVehicle(veh, lane, dt) {
    switch (veh.state) {
      case 'approach': this._doApproach(veh, lane, dt); break;
      case 'queued':   this._doQueued(veh, lane, dt);   break;
      case 'cross':    this._doCross(veh, lane, dt);    break;
      case 'exit':     this._doExit(veh, dt);           break;
    }
  }

  // ── Approach ──────────────────────────────────────────────────────────────────

  _doApproach(veh, lane, dt) {
    const canEnter = this.controller.canEnter(veh, lane, this.vehicles);
    const stopDist = Math.hypot(lane.stopLine.x - veh.x, lane.stopLine.y - veh.y);

    // IDM: pick the tighter constraint between leader and stop line
    const { gap: lGap, speed: lSpeed } = lane.getLeader(veh);
    const stopGap = lane.getStopLineGap(veh, !canEnter);

    let effGap   = lGap;
    let effSpeed = lSpeed;
    if (stopGap && stopGap.gap < effGap) {
      effGap   = stopGap.gap;
      effSpeed = 0;
    }

    const accel = veh.computeIDM(effGap, effSpeed, APPROACH_SPEED);
    veh.speed   = Math.max(0, Math.min(veh.speed + accel * dt, APPROACH_SPEED));

    // Move toward stop line
    const dx = lane.stopLine.x - veh.x;
    const dy = lane.stopLine.y - veh.y;
    const d  = Math.hypot(dx, dy);
    if (d > 0.05) {
      const move = Math.min(veh.speed * dt, d);
      veh.x     += (dx / d) * move;
      veh.y     += (dy / d) * move;
      veh.angle  = Math.atan2(dx, -dy);
    }

    // Transition smoothly near the stop line
    if (canEnter) {
      if (stopDist < 2.5) {
        this._enterIntersection(veh, lane);
      }
    } else {
      if (veh.speed < 0.25 && stopDist < 8.0) {
        veh.state = 'queued';
        veh.speed = 0;
      }
    }
  }

  // ── Queued ────────────────────────────────────────────────────────────────────

  _doQueued(veh, lane, dt) {
    const { gap: lGap } = lane.getLeader(veh);
    const minQ = veh.type.minGap + veh.type.length * 0.5;

    // Creeping recovery: if stalled for more than 4s and has space ahead, slow creep forward.
    // Otherwise, stay perfectly stationary (no jittery backward pullbacks!).
    if (veh._stallTimer > 4 && lGap > minQ * 1.5) {
      veh.speed = 0.8; // gentle creep speed to close gaps
      const dx = lane.stopLine.x - veh.x;
      const dy = lane.stopLine.y - veh.y;
      const d  = Math.hypot(dx, dy);
      if (d > 0.05) {
        const move = Math.min(veh.speed * dt, d);
        veh.x     += (dx / d) * move;
        veh.y     += (dy / d) * move;
        veh.angle  = Math.atan2(dx, -dy);
      }
    } else {
      veh.speed = 0;
    }

    // Try to release once signal changes and we are at the front of the queue
    const canEnter = this.controller.canEnter(veh, lane, this.vehicles);
    if (canEnter && lane.queueAhead(veh) === 0) {
      this._enterIntersection(veh, lane);
    }
  }

  _enterIntersection(veh, lane) {
    veh.state   = 'cross';
    veh.pathIdx = 0;
    // Bypassed snapping of position to crossPath[0] to prevent sudden visual jumps.
    // The vehicle is already at the stop line, so it crosses smoothly from its current position.
    veh.speed   = Math.max(veh.speed, 2.0); // gradual speed-up
  }

  // ── Cross ─────────────────────────────────────────────────────────────────────

  _doCross(veh, lane, dt) {
    const path = lane.crossPath;

    // Reached end of path -> transition to exit
    if (veh.pathIdx >= path.length - 1) {
      veh.state = 'exit';
      this.metrics.totalServed++;
      return;
    }

    const target = path[veh.pathIdx + 1];
    const dx     = target.x - veh.x;
    const dy     = target.y - veh.y;
    const dist   = Math.hypot(dx, dy);

    if (dist < 0.8) { veh.pathIdx++; return; }

    // IDM against same-stream vehicle ahead on the cross path
    const { gap, speed } = this.controller.getCrossLeader(veh, lane, this.vehicles);
    const accel = veh.computeIDM(gap, speed, CROSS_SPEED);
    veh.speed   = Math.max(1.0, Math.min(veh.speed + accel * dt, CROSS_SPEED));

    const move = Math.min(veh.speed * dt, dist);
    veh.x     += (dx / dist) * move;
    veh.y     += (dy / dist) * move;
    veh.angle  = Math.atan2(dx, -dy);
  }

  // ── Exit ──────────────────────────────────────────────────────────────────────

  _doExit(veh, dt) {
    // Continue in last heading direction
    veh.x    += Math.sin(veh.angle) * EXIT_SPEED * dt;
    veh.y    -= Math.cos(veh.angle) * EXIT_SPEED * dt;
    veh.speed = EXIT_SPEED;

    // Remove once well off-canvas
    if (Math.abs(veh.x) > DESPAWN_DIST || Math.abs(veh.y) > DESPAWN_DIST) {
      veh.remove = true;
    }
  }

  // ── Metrics ───────────────────────────────────────────────────────────────────

  _snapshotMetrics() {
    for (let i = 0; i < 7; i++) {
      const q = this.lanes[i].queueLength;
      this.metrics.queueSnapshot[i]   = q;
      this.metrics.densitySnapshot[i] = q / this._roadLen[i];
    }
  }
}
