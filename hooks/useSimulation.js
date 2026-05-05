'use client';
/**
 * useSimulation.js — React hook wrapping the twin simulation engines.
 *
 * Runs two SimulationEngine instances in parallel:
 *   - "fixed"  → Fixed-Time control (30 s constant green)
 *   - "hybrid" → Adaptive Hybrid GC-Greedy control
 *
 * The RAF loop drives both engines at the user's chosen speed multiplier.
 * UI state is only updated once per simulated second to keep React renders cheap.
 *
 * Returns: { fixed, hybrid, isRunning, speed, time, chartData,
 *            togglePlay, setSpeed, resetSim }
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { SimulationEngine, DEFAULT_DATASET } from '../lib/simulation/SimulationEngine.js';

const UI_UPDATE_INTERVAL = 1.0; // seconds — how often to push state to React

export function useSimulation() {
  // All heavyweight state lives in a ref to avoid re-render on every frame
  const engRef = useRef(null);

  if (!engRef.current) {
    const fixed  = new SimulationEngine({ adaptive: false, dataset: DEFAULT_DATASET });
    const hybrid = new SimulationEngine({ adaptive: true,  dataset: DEFAULT_DATASET });
    fixed.running  = false;
    hybrid.running = false;

    engRef.current = {
      fixed,
      hybrid,
      isRunning:  false,
      speed:      2,            // simulation speed multiplier
      time:       0,            // wall time (s) — same for both
      lastUISync: 0,
      chartData: {
        labels:     [],
        fixedQ:     [],  // total queue (veh)
        hybridQ:    [],
        fixedDens:  [],  // mean density (veh/km)
        hybridDens: [],
      },
    };
  }

  // ── React-visible state ────────────────────────────────────────────────────
  const [ui, setUi] = useState(() => ({
    time:     0,
    isRunning: false,
    speed:     2,
    fixed:     engRef.current.fixed.snapshot(),
    hybrid:    engRef.current.hybrid.snapshot(),
    chartData: { ...engRef.current.chartData },
  }));

  // ── RAF loop ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let rafId;
    let lastWall = performance.now();

    const loop = (now) => {
      rafId = requestAnimationFrame(loop);
      const eng = engRef.current;
      if (!eng.isRunning) { lastWall = now; return; }

      // Real elapsed time (capped at 100 ms for tab-switch safety)
      const delta = Math.min((now - lastWall) / 1000, 0.1);
      lastWall = now;

      // Number of simulation steps at 60 fps equivalent × speed
      const steps = Math.max(1, Math.round(delta * 60 * eng.speed));
      const dt    = 1 / 60;

      for (let s = 0; s < steps; s++) {
        eng.fixed.step(dt);
        eng.hybrid.step(dt);
        eng.time += dt;
      }

      // Sync to React roughly once per simulated second
      if (eng.time - eng.lastUISync >= UI_UPDATE_INTERVAL) {
        eng.lastUISync = eng.time;

        const label   = `${Math.round(eng.time)}s`;
        const fSnap   = eng.fixed.snapshot();
        const hSnap   = eng.hybrid.snapshot();

        const fQ = fSnap.queues.reduce((a, b) => a + b, 0);
        const hQ = hSnap.queues.reduce((a, b) => a + b, 0);
        const ROAD_LEN = [0.15, 0.20, 0.15, 0.12, 0.20, 0.12, 0.18];
        const fD = fSnap.queues.reduce((s, q, i) => s + q / ROAD_LEN[i], 0) / 7;
        const hD = hSnap.queues.reduce((s, q, i) => s + q / ROAD_LEN[i], 0) / 7;

        const cd = eng.chartData;
        cd.labels.push(label);
        cd.fixedQ.push(Math.round(fQ));
        cd.hybridQ.push(Math.round(hQ));
        cd.fixedDens.push(parseFloat(fD.toFixed(1)));
        cd.hybridDens.push(parseFloat(hD.toFixed(1)));

        // Keep only last 60 data points
        if (cd.labels.length > 60) {
          cd.labels.shift(); cd.fixedQ.shift(); cd.hybridQ.shift();
          cd.fixedDens.shift(); cd.hybridDens.shift();
        }

        setUi({
          time:      eng.time,
          isRunning: eng.isRunning,
          speed:     eng.speed,
          fixed:     fSnap,
          hybrid:    hSnap,
          chartData: { ...cd, labels: [...cd.labels], fixedQ: [...cd.fixedQ], hybridQ: [...cd.hybridQ], fixedDens: [...cd.fixedDens], hybridDens: [...cd.hybridDens] },
        });
      }
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // ── Controls ───────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const eng = engRef.current;
    eng.isRunning          = !eng.isRunning;
    eng.fixed.running      = eng.isRunning;
    eng.hybrid.running     = eng.isRunning;
    setUi(prev => ({ ...prev, isRunning: eng.isRunning }));
  }, []);

  const setSpeed = useCallback((val) => {
    engRef.current.speed = Number(val);
    setUi(prev => ({ ...prev, speed: Number(val) }));
  }, []);

  const resetSim = useCallback(() => {
    const eng    = engRef.current;
    eng.isRunning = false;
    eng.time      = 0;
    eng.lastUISync = 0;

    eng.fixed  = new SimulationEngine({ adaptive: false, dataset: DEFAULT_DATASET });
    eng.hybrid = new SimulationEngine({ adaptive: true,  dataset: DEFAULT_DATASET });
    eng.chartData = { labels: [], fixedQ: [], hybridQ: [], fixedDens: [], hybridDens: [] };

    setUi({
      time: 0, isRunning: false, speed: eng.speed,
      fixed:  eng.fixed.snapshot(),
      hybrid: eng.hybrid.snapshot(),
      chartData: { labels: [], fixedQ: [], hybridQ: [], fixedDens: [], hybridDens: [] },
    });
  }, []);

  // Expose engine ref for canvas renderer (direct access, no React state)
  const getEngines = useCallback(() => ({
    fixed:  engRef.current.fixed,
    hybrid: engRef.current.hybrid,
  }), []);

  return { ...ui, togglePlay, setSpeed, resetSim, getEngines };
}
