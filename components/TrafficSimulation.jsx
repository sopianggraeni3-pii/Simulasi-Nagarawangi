'use client';
/**
 * TrafficSimulation.jsx — Canvas Simulation Component (Hybrid engine view)
 *
 * Owns the canvas element and drives the Renderer directly from the
 * hybrid SimulationEngine ref — bypassing React state entirely for
 * maximum 60-fps rendering performance.
 *
 * The component only re-mounts its RAF when the canvas ref changes.
 * Props changes (isRunning, speed) are communicated via propsRef
 * to avoid unnecessary useEffect re-runs.
 */

import { useEffect, useRef } from 'react';
import { Renderer } from '../lib/simulation/Renderer.js';

export default function TrafficSimulation({ getEngines, isRunning, speed }) {
  const canvasRef  = useRef(null);
  const propsRef   = useRef({ isRunning, speed, getEngines });

  // Keep propsRef fresh every render without re-triggering the effect
  useEffect(() => {
    propsRef.current = { isRunning, speed, getEngines };
  }, [isRunning, speed, getEngines]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new Renderer(canvas);
    let rafId;
    let lastTs = null;

    // ── Resize handler ────────────────────────────────────────────────────
    function onResize() {
      renderer.resize();
      // Draw static frame while paused
      const { getEngines: ge } = propsRef.current;
      const { hybrid } = ge();
      renderer.draw(hybrid.vehicles, hybrid.light.snapshot(), hybrid.metrics);
    }

    window.addEventListener('resize', onResize);
    onResize(); // initial size

    // ── Animation loop ────────────────────────────────────────────────────
    const loop = (ts) => {
      rafId = requestAnimationFrame(loop);
      if (!lastTs) lastTs = ts;
      lastTs = ts;

      const { getEngines: ge, isRunning: ir } = propsRef.current;
      if (!ge) return;

      const { hybrid } = ge();
      if (!hybrid) return;

      // Always render (even when paused — vehicles may be mid-frame)
      renderer.draw(hybrid.vehicles, hybrid.light.snapshot(), hybrid.metrics);
    };

    rafId = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(rafId);
    };
  }, []); // Intentionally empty — renderer owns its own loop

  return (
    <div
      id="sim-canvas-wrapper"
      className="w-full h-full rounded-2xl overflow-hidden relative"
      style={{ background: '#0d1117', minHeight: '420px' }}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />

      {/* Live badge */}
      <div
        id="sim-live-badge"
        className="absolute top-3 left-3 flex items-center gap-2 bg-black/60 backdrop-blur-sm
                   text-white text-[10px] px-3 py-1.5 rounded-lg font-mono border border-white/10"
      >
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        LIVE — SIMPANG NAGARAWANGI
      </div>

      {/* Paused overlay */}
      {!isRunning && (
        <div
          id="sim-paused-overlay"
          className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm"
        >
          <div className="text-white/70 text-sm font-mono flex flex-col items-center gap-2">
            <svg className="w-10 h-10 opacity-50" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
            <span>Tekan Mulai untuk memulai simulasi</span>
          </div>
        </div>
      )}
    </div>
  );
}
