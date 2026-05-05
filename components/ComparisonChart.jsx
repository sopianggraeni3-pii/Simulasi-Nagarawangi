'use client';
/**
 * ComparisonChart.jsx — Animated queue/density chart using Chart.js
 */
import { useEffect, useRef } from 'react';

export default function ComparisonChart({ data }) {
  const canvasRef = useRef(null);
  const chartRef  = useRef(null);

  useEffect(() => {
    // Dynamically import Chart.js (no SSR issues)
    import('chart.js/auto').then(({ default: Chart }) => {
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;

      if (chartRef.current) chartRef.current.destroy();

      chartRef.current = new Chart(ctx, {
        type: 'line',
        data: {
          labels: data.labels,
          datasets: [
            {
              label: 'Fixed-Time',
              data: data.fixedQ,
              borderColor: '#f59e0b',
              backgroundColor: 'rgba(245,158,11,0.08)',
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.4,
              fill: true,
            },
            {
              label: 'Hybrid GC',
              data: data.hybridQ,
              borderColor: '#10b981',
              backgroundColor: 'rgba(16,185,129,0.08)',
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.4,
              fill: true,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 0 },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(15,20,30,0.92)',
              titleColor: '#94a3b8',
              bodyColor: '#e2e8f0',
              borderColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1,
              padding: 8,
            },
          },
          scales: {
            x: {
              ticks: { color: '#475569', font: { size: 9 }, maxTicksLimit: 8 },
              grid: { color: 'rgba(255,255,255,0.04)' },
            },
            y: {
              ticks: { color: '#475569', font: { size: 9 } },
              grid: { color: 'rgba(255,255,255,0.06)' },
              min: 0,
            },
          },
        },
      });
    });
    return () => chartRef.current?.destroy();
  }, []); // mount once

  // Update data without re-creating chart
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.data.labels                 = data.labels;
    chart.data.datasets[0].data       = data.fixedQ;
    chart.data.datasets[1].data       = data.hybridQ;
    chart.update('none');
  }, [data]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}