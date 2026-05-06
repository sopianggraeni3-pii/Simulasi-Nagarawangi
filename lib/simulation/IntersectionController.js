/**
 * IntersectionController.js — Decision Logic
 *
 * Determines when a vehicle is permitted to enter the intersection box.
 * Implements:
 *   1. Traffic light gating (controlled streams)
 *   2. Physical conflict checking (is the box safe to enter?)
 *   3. Yield logic for free-flow streams
 *   4. Car-following inside the intersection (cross-path following)
 *   5. Deadlock resolution (stalled vehicle nudge)
 *
 * The "intersection box" is a square zone of radius BOX_RADIUS metres
 * centred on the origin (0, 0). Only vehicles in 'cross' state occupy it.
 */

/** Radius of the conflict zone check (metres from centre) */
const BOX_RADIUS = 12;

/**
 * IntersectionController — stateless decision module.
 * All methods are pure functions taking lanes + traffic light state.
 */
export class IntersectionController {
  /**
   * @param {import('./Lane').Lane[]} lanes
   * @param {import('./TrafficLight').TrafficLight} light
   */
  constructor(lanes, light) {
    this.lanes = lanes;
    this.light = light;
  }

  // ── Per-vehicle decision ─────────────────────────────────────────────────

  /**
   * Decide whether a vehicle at the stop line may enter the intersection.
   *
   * Rules (in priority order):
   *   1. If controlled + NOT green → MUST STOP
   *   2. If controlled + yellow → MUST STOP (clearance)
   *   3. If free-flow → may proceed unless yielding
   *   4. Physical safety check — no conflicting vehicle in box
   *
   * @param {import('./Vehicle').Vehicle} veh
   * @param {import('./Lane').Lane}       lane
   * @param {import('./Vehicle').Vehicle[]} allVehicles — all active vehicles
   * @returns {boolean} true → vehicle may enter intersection
   */
  canEnter(veh, lane, allVehicles) {
    if (lane.turn === 'left' || lane.freeFlow) {
      // Free-flow / Left Turn: bypass stop signal and proceed unless yielding
      return !this._mustYield(lane, allVehicles);
    }

    // Controlled:
    if (!this.light.isGreen(lane.id)) {
      // Decision Zone: If light is yellow and vehicle is too close to comfortably stop, proceed.
      if (this.light.isYellow && this.light.greenStreams.includes(lane.id)) {
        const stopDist = Math.hypot(lane.stopLine.x - veh.x, lane.stopLine.y - veh.y);
        // Comfortable braking distance formula: v^2 / (2 * a) + small safety buffer
        const comfortableBrakingDistance = (veh.speed ** 2) / (2 * veh.type.comfortDecel) + 1.5;
        if (stopDist < comfortableBrakingDistance) {
          return this._isBoxSafe(lane, allVehicles);
        }
      }
      return false;
    }
    return this._isBoxSafe(lane, allVehicles);
  }

  // ── Physical conflict check ──────────────────────────────────────────────

  /**
   * Check if the intersection box is physically safe for a controlled stream.
   * A conflicting vehicle in 'cross' state inside the box blocks entry.
   *
   * @param {import('./Lane').Lane}       lane
   * @param {import('./Vehicle').Vehicle[]} allVehicles
   * @returns {boolean} true → box is clear
   */
  _isBoxSafe(lane, allVehicles) {
    for (const v of allVehicles) {
      if (!lane.conflicts.includes(v.streamId)) continue;
      if (v.state !== 'cross') continue;
      // Check if v is inside the conflict box
      if (v.x ** 2 + v.y ** 2 < BOX_RADIUS ** 2) return false;
    }
    return true;
  }

  /**
   * Check if a free-flow vehicle must yield to a crossing vehicle.
   *
   * @param {import('./Lane').Lane}       lane
   * @param {import('./Vehicle').Vehicle[]} allVehicles
   * @returns {boolean} true → must yield (wait)
   */
  _mustYield(lane, allVehicles) {
    if (lane.yields.length === 0) return false;
    const bs = BOX_RADIUS * 1.1; // slightly larger yield zone
    for (const v of allVehicles) {
      if (!lane.yields.includes(v.streamId)) continue;
      if (v.state !== 'cross') continue;
      if (v.x > -bs && v.x < bs && v.y > -bs && v.y < bs) return true;
    }
    return false;
  }

  // ── Cross-path following ─────────────────────────────────────────────────

  /**
   * For a vehicle in 'cross' state, find the nearest vehicle ahead on the
   * same stream's cross-path and return IDM leader info.
   *
   * @param {import('./Vehicle').Vehicle} veh
   * @param {import('./Lane').Lane}       lane
   * @param {import('./Vehicle').Vehicle[]} allVehicles
   * @returns {{ gap: number, speed: number }}
   */
  getCrossLeader(veh, lane, allVehicles) {
    let bestGap   = Infinity;
    let bestSpeed = 0;

    for (const v of allVehicles) {
      if (v === veh || v.streamId !== veh.streamId || v.state !== 'cross') continue;
      
      // Determine if v is ahead of veh on the path
      let isAhead = false;
      if (v.pathIdx > veh.pathIdx) {
        isAhead = true;
      } else if (v.pathIdx === veh.pathIdx) {
        // Same segment: the one closer to the next waypoint is ahead
        const target = lane.crossPath[veh.pathIdx + 1];
        if (target) {
          const distV = Math.hypot(target.x - v.x, target.y - v.y);
          const distVeh = Math.hypot(target.x - veh.x, target.y - veh.y);
          if (distV < distVeh) {
            isAhead = true;
          } else if (Math.abs(distV - distVeh) < 0.01) {
            isAhead = v.id < veh.id; // tie-breaker
          }
        }
      }

      if (!isAhead) continue;

      const dist    = Math.hypot(v.x - veh.x, v.y - veh.y);
      const netGap  = dist - veh.type.length / 2 - v.type.length / 2;
      if (netGap < bestGap) {
        bestGap   = netGap;
        bestSpeed = v.speed;
      }
    }
    return { gap: bestGap, speed: bestSpeed };
  }

  // ── Deadlock resolver ────────────────────────────────────────────────────

  /**
   * Scan all vehicles for stalls and forcibly release the worst offender.
   * Called once per second by the engine if stalls are detected.
   *
   * Strategy: nudge the most-stalled vehicle's state to 'cross' directly,
   * bypassing safety checks (last resort).
   *
   * @param {import('./Vehicle').Vehicle[]} allVehicles
   * @param {import('./Lane').Lane[]}       lanes
   */
  resolveDeadlocks(allVehicles, lanes) {
    let worst = null;
    let maxStall = 0;

    for (const v of allVehicles) {
      if ((v.state === 'queued' || v.state === 'approach') && v._stallTimer > maxStall) {
        maxStall = v._stallTimer;
        worst    = v;
      }
    }

    if (worst && maxStall > 15) {
      const lane = lanes[worst.streamId];
      if (!lane) return;
      // Force crossing — skip safety gate
      worst.state   = 'cross';
      worst.pathIdx = 0;
      worst.x       = lane.crossPath[0].x;
      worst.y       = lane.crossPath[0].y;
      worst._stallTimer = 0;
    }
  }

  /**
   * Return current queue lengths per stream as an array of 7 numbers.
   * @returns {number[]}
   */
  getQueueLengths() {
    return this.lanes.map(l => l.queueLength);
  }
}
