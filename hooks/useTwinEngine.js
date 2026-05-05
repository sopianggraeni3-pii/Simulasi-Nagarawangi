'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

// ─────────────────────────────────────────────────────────────
// KONFIGURASI SIMPANG NAGARAWANGI
// ─────────────────────────────────────────────────────────────
const PHASES = [
  { name: 'Fase 1 — Barat Lurus', streams: [4] }, // Index 0
  { name: 'Fase 2 — Utara Kanan', streams: [6] }, // Index 1
  { name: 'Fase 3 — Selatan Lurus', streams: [1] }, // Index 2
];

/**
 * Arus kedatangan (veh/s) — dikonversi dari data CSV Nagarawangi.
 * Panjang array harus 7, sesuai jumlah stream.
 *
 * Index | Deskripsi                    | Jenis
 * ------+------------------------------+-------------
 *   0   | Selatan → Barat (belok kiri) | Free-flow
 *   1   | Selatan → Utara (lurus)      | Controlled (Fase 3)
 *   2   | Selatan → Timur (belok kanan)| Free-flow
 *   3   | Barat   → Utara (belok kiri) | Free-flow
 *   4   | Barat   → Timur (lurus)      | Controlled (Fase 1)
 *   5   | Utara   → Timur (belok kiri) | Free-flow
 *   6   | Utara   → Barat (belok kanan)| Controlled (Fase 2)
 */
// Laju kedatangan realistis (veh/s) — dari data CSV Nagarawangi
// Data kepadatan dikurangi agar visual jalanan tidak terlalu sesak
// Namun tetap proporsional sesuai data CSV
// SKENARIO 3: Distribusi Tidak Merata (Diambil dari CSV)
// Format dikonversi dari (kendaraan / menit) menjadi (kendaraan / detik)

// Arus kedatangan (veh/s) — diperbarui untuk memprioritsakan arah Utara.
// Index 1 (Selatan→Utara) = 0.70 (volume sangat tinggi, stream dominan)
// Index 3 (Barat→Utara)   = 0.35 (volume tinggi, kontribusi ke Utara)
const ARRIVAL_RATES = [0.10, 0.70, 0.20, 0.35, 0.30, 0.10, 0.15];


const SAT_FLOW = 2.0; // Kapasitas jalan (2 mobil keluar per detik saat hijau)


const FREE_FLOW_STREAMS = new Set([0, 2, 3, 5]);
const CONTROLLED_STREAMS = new Set([1, 4, 6]);


const FREE_FACTOR = 0.8;          // faktor kapasitas free-flow
const FIXED_GREEN = 30;           // detik — durasi hijau tetap
const MIN_GREEN = 20;             // detik — batas bawah hybrid (realistis)
const MAX_GREEN = 60;             // detik — batas atas hybrid
const DT = 1 / 60;       // interval satu frame (60 FPS)

/**
 * Panjang ruas jalan referensi per stream (km).
 * Digunakan untuk menghitung kepadatan: D = Q / L (veh/km).
 * Nilai estimasi berdasarkan panjang antrean maksimum di lapangan.
 */
const ROAD_LENGTH_KM = [0.15, 0.20, 0.15, 0.12, 0.20, 0.12, 0.18]; // km per stream

// Antrian awal realistis — kecil agar tidak langsung gridlock
const INITIAL_QUEUES = [2, 10, 1, 1, 8, 2, 5];

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function mkState() {
  return {
    queues: [25, 5, 30, 2, 40, 8, 8], // (Atau antrean berapapun yang sedang kamu pakai)
    densities: [0, 0, 0, 0, 0, 0, 0], // <--- TAMBAHKAN BARIS INI
    phase: 0,
    timer: FIXED_GREEN,
    totalGreen: FIXED_GREEN,
    throughput: 0,
    totalWait: 0,
    totalServed: 0
  };
}

/**
 * Algoritma Hybrid GC-Greedy — Pure Greedy:
 * Hitung clearance time murni berdasarkan antrian fase aktif,
 * tambahkan buffer 5 detik, lalu clamp KETAT ke [MIN_GREEN, MAX_GREEN].
 *
 * Formula:
 *   neededTime = ceil(phaseQueue / SAT_FLOW) + 5 (buffer keamanan)
 *   result     = clamp(neededTime, MIN_GREEN=20, MAX_GREEN=60)
 *
 * Fixed-Time tetap 30 detik — tidak disentuh.
 * Hybrid lebih efisien karena:
 *  - Fase antrian kecil → hijau minimum 20 s (tidak terlalu singkat)
 *  - Fase antrian besar → hijau proporsional, maksimum 60 s
 *  - Tidak ada waktu hijau yang terbuang atau terlalu cepat berganti
 */
function computeHybridGreen(state, phaseIdx) {
  const phaseStreams = PHASES[phaseIdx].streams;
  // Total antrian di semua stream yang aktif pada fase ini
  const phaseQueue = phaseStreams.reduce((s, i) => s + (state.queues[i] || 0), 0);
  // Clearance time murni + 5 detik buffer keamanan
  const neededTime = Math.ceil(phaseQueue / SAT_FLOW) + 5;
  // Clamp KETAT: minimum 20 s (realistis), maksimum 60 s (tidak memacetkan)
  return Math.max(MIN_GREEN, Math.min(MAX_GREEN, neededTime));
}

/**
 * Satu langkah simulasi antrean (dipanggil 60× per detik simulasi).
 * @param {object}  st       – state engine (mutasi langsung agar cepat)
 * @param {boolean} isHybrid – true → pakai algoritma hybrid; false → fixed-time
 */
function stepSystem(st, isHybrid) {
  const greenStreams = PHASES[st.phase].streams;

  // 1. Tambah antrian (kedatangan kendaraan)
  for (let i = 0; i < 7; i++) {
    st.queues[i] += ARRIVAL_RATES[i] * DT;
  }

  // 2. Kurangi antrian (kendaraan dilayani)
  for (let i = 0; i < 7; i++) {
    let served = 0;

    if (greenStreams.includes(i)) {
      // Lampu hijau aktif → kapasitas penuh (saturated flow)
      served = Math.min(st.queues[i], SAT_FLOW * DT);
    } else if (FREE_FLOW_STREAMS.has(i)) {
      // Free-flow → kapasitas tereduksi (belok bebas hambatan)
      served = Math.min(st.queues[i], SAT_FLOW * FREE_FACTOR * DT);
    }
    // Controlled stream yang tidak mendapat hijau → tidak dilayani (merah penuh)

    st.queues[i] = Math.max(0, st.queues[i] - served);
    st.throughput += served;
    st.totalServed += served;

    /**
     * Akumulasi waktu tunggu (delay) hanya untuk controlled stream yang merah.
     * Formula: totalWait += queue × DT  →  satuan veh·s
     * Rata-rata delay = totalWait / totalServed  (s/veh)
     *
     * Catatan: ini adalah pendekatan Webster/HCM untuk average control delay,
     * di mana kendaraan dalam antrian diasumsikan menunggu selama 1 langkah DT.
     */
    if (CONTROLLED_STREAMS.has(i) && !greenStreams.includes(i)) {
      st.totalWait += st.queues[i] * DT;
    }
  }

  // 3. Update kepadatan per stream (snapshot real-time)
  for (let i = 0; i < 7; i++) {
    st.densities[i] = st.queues[i] / ROAD_LENGTH_KM[i];
  }

  // 4. Countdown timer fase
  st.timer -= DT;

  // 5. Pergantian fase
  if (st.timer <= 0) {
    st.phase = (st.phase + 1) % 3;
    st.totalGreen = isHybrid
      ? computeHybridGreen(st, st.phase)
      : FIXED_GREEN;
    st.timer = st.totalGreen;
  }
}

// ─────────────────────────────────────────────────────────────
// HOOK UTAMA
// ─────────────────────────────────────────────────────────────
export function useTwinEngine() {
  // Semua state engine disimpan di ref agar tidak memicu re-render tiap frame
  const engineRef = useRef(null);

  if (!engineRef.current) {
    const fixedInit = mkState();
    const hybridInit = mkState();
    const initGreen = computeHybridGreen(hybridInit, 0);
    hybridInit.timer = initGreen;
    hybridInit.totalGreen = initGreen;

    engineRef.current = {
      isRunning: false,
      speed: 2,            // multiplier kecepatan simulasi
      time: 0,            // waktu simulasi (detik)
      lastUpdate: 0,            // kapan terakhir chart diperbarui
      fixed: fixedInit,
      hybrid: hybridInit,
      chartData: {
        labels: [],
        fixedData: [],   // total queue fixed (veh)
        hybridData: [],   // total queue hybrid (veh)
        fixedDens: [],   // rata-rata kepadatan fixed (veh/km)
        hybridDens: [],   // rata-rata kepadatan hybrid (veh/km)
      },
    };
  }

  // State React — diperbarui setiap ~1 detik simulasi agar performa tetap ringan
  const [uiState, setUiState] = useState(() => ({
    time: 0,
    fixed: engineRef.current.fixed,
    hybrid: engineRef.current.hybrid,
    chartData: engineRef.current.chartData,
  }));

  // ── RAF Loop ──────────────────────────────────────────────
  useEffect(() => {
    let rafId;
    let lastWallTime = performance.now();

    const loop = (wallNow) => {
      rafId = requestAnimationFrame(loop);

      const eng = engineRef.current;
      if (!eng.isRunning) {
        lastWallTime = wallNow;
        return;
      }

      // Delta waktu dinding (dibatasi 100 ms agar tidak loncat saat tab background)
      let delta = (wallNow - lastWallTime) / 1000;
      delta = Math.min(delta, 0.1);
      lastWallTime = wallNow;

      // Jumlah langkah simulasi per frame (speed multiplier)
      const steps = Math.max(1, Math.round(delta * 60 * eng.speed));

      for (let s = 0; s < steps; s++) {
        eng.time += DT;
        stepSystem(eng.fixed, false);
        stepSystem(eng.hybrid, true);
      }

      // Perbarui data chart setiap 1 detik simulasi
      if (eng.time - eng.lastUpdate >= 1) {
        eng.lastUpdate = eng.time;

        const label = `${Math.round(eng.time)}s`;
        const fq = Math.round(eng.fixed.queues.reduce((a, b) => a + b, 0));
        const hq = Math.round(eng.hybrid.queues.reduce((a, b) => a + b, 0));

        // Rata-rata kepadatan: mean(density_i) untuk semua 7 stream
        const fd = parseFloat((eng.fixed.densities.reduce((a, b) => a + b, 0) / 7).toFixed(1));
        const hd = parseFloat((eng.hybrid.densities.reduce((a, b) => a + b, 0) / 7).toFixed(1));

        eng.chartData.labels.push(label);
        eng.chartData.fixedData.push(fq);
        eng.chartData.hybridData.push(hq);
        eng.chartData.fixedDens.push(fd);
        eng.chartData.hybridDens.push(hd);

        // Batasi riwayat chart ke 60 titik
        if (eng.chartData.labels.length > 60) {
          eng.chartData.labels.shift();
          eng.chartData.fixedData.shift();
          eng.chartData.hybridData.shift();
          eng.chartData.fixedDens.shift();
          eng.chartData.hybridDens.shift();
        }

        // Sinkronisasi ke React (deep-copy cepat via JSON)
        setUiState({
          time: eng.time,
          fixed: JSON.parse(JSON.stringify(eng.fixed)),
          hybrid: JSON.parse(JSON.stringify(eng.hybrid)),
          chartData: {
            labels: [...eng.chartData.labels],
            fixedData: [...eng.chartData.fixedData],
            hybridData: [...eng.chartData.hybridData],
            fixedDens: [...eng.chartData.fixedDens],
            hybridDens: [...eng.chartData.hybridDens],
          },
        });
      }
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // ── Kontrol ───────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    engineRef.current.isRunning = !engineRef.current.isRunning;
    // Paksa re-render untuk memperbarui tombol Play/Pause
    setUiState(prev => ({ ...prev }));
  }, []);

  const setSpeed = useCallback((val) => {
    engineRef.current.speed = Number(val);
    setUiState(prev => ({ ...prev }));
  }, []);

  const resetSim = useCallback(() => {
    const eng = engineRef.current;
    eng.isRunning = false;
    eng.time = 0;
    eng.lastUpdate = 0;
    eng.fixed = mkState();

    const hybridFresh = mkState();
    const initGreen = computeHybridGreen(hybridFresh, 0);
    hybridFresh.timer = initGreen;
    hybridFresh.totalGreen = initGreen;
    eng.hybrid = hybridFresh;
    eng.chartData = { labels: [], fixedData: [], hybridData: [], fixedDens: [], hybridDens: [] };

    setUiState({
      time: 0,
      fixed: JSON.parse(JSON.stringify(eng.fixed)),
      hybrid: JSON.parse(JSON.stringify(eng.hybrid)),
      chartData: { labels: [], fixedData: [], hybridData: [], fixedDens: [], hybridDens: [] },
    });
  }, []);

  return {
    ...uiState,
    isRunning: engineRef.current.isRunning,
    speed: engineRef.current.speed,
    togglePlay,
    setSpeed,
    resetSim,
  };
}