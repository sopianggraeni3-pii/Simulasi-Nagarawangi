# greedy.py

def calculate_time_and_priority(phases, queues):
    """
    Algoritma Greedy untuk Penjadwalan Waktu.
    Prioritas: Mengambil jalur dengan total antrean terbanyak duluan.
    """
    phase_stats = []
    
    for phase_id, lanes in phases.items():
        total_queue = 0
        for lane in lanes:
            # Mengambil data antrean, default 0 jika lajur tidak ada di dataset
            total_queue += queues.get(lane, 0) 
            
        # Perhitungan waktu: 1.5 detik per kendaraan
        calculated_time = int(total_queue * 1.5)
        # Batasan constraint sesuai laporan (Min 20s, Max 60s)
        green_time = max(20, min(60, calculated_time))
        
        phase_stats.append({
            "phase_id": phase_id,
            "lanes": lanes,
            "total_queue": total_queue,
            "green_time": green_time
        })
        
    # Greedy Choice: Urutkan berdasarkan total antrean tertinggi
    phase_stats.sort(key=lambda x: x["total_queue"], reverse=True)
    return phase_stats