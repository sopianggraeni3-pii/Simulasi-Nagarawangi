'use client';
import { useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Filler,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Filler, Legend);

export default function ComparisonChart({ data }) {
  const [mode, setMode] = useState('queue'); // 'queue' | 'density'

  const isQueue = mode === 'queue';

  const chartData = {
    labels: data.labels,
    datasets: [
      {
        label: 'Fixed-Time',
        data: isQueue ? data.fixedData : (data.fixedDens ?? []),
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245,158,11,0.12)',
        fill: true,
        tension: 0.45,
        pointRadius: 0,
        borderWidth: 2,
      },
      {
        label: 'Hybrid GC-Greedy',
        data: isQueue ? data.hybridData : (data.hybridDens ?? []),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16,185,129,0.12)',
        fill: true,
        tension: 0.45,
        pointRadius: 0,
        borderWidth: 2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(13,17,23,0.92)',
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        titleColor: '#94a3b8',
        bodyColor: '#e2e8f0',
        padding: 10,
        callbacks: {
          label: (ctx) =>
            isQueue
              ? ` ${ctx.dataset.label}: ${ctx.parsed.y} veh`
              : ` ${ctx.dataset.label}: ${ctx.parsed.y} veh/km`,
        },
      },
    },
    scales: {
      x: { display: false },
      y: {
        min: 0,
        ticks: {
          color: '#64748b',
          font: { size: 10 },
          maxTicksLimit: 5,
        },
        grid: { color: 'rgba(255,255,255,0.04)' },
        border: { display: false },
      },
    },
  };

  return (
    <div className="flex flex-col gap-2 h-full">
      {/* Toggle tabs */}
      <div className="flex gap-1 self-end">
        {[
          { key: 'queue',   label: 'Antrian (veh)' },
          { key: 'density', label: 'Kepadatan (veh/km)' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setMode(key)}
            className="text-[9px] px-2 py-0.5 rounded font-medium transition-all"
            style={{
              background: mode === key ? 'rgba(255,255,255,0.12)' : 'transparent',
              color:       mode === key ? '#e2e8f0' : '#64748b',
              border:      `1px solid ${mode === key ? 'rgba(255,255,255,0.15)' : 'transparent'}`,
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1">
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
}