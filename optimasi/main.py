# main.py
import time
import csv
from graph_coloring import get_phases
from greedy import calculate_time_and_priority

def print_header():
    print("\n" + "="*80)
    print("  OPTIMASI PENJADWALAN LALU LINTAS SIMPANG NAGARAWANGI KOTA TASIKMALAYA")
    print("             DENGAN ALGORITMA HYBRID GRAPH COLORING-GREEDY             ")
    print("="*80)
    print("  Program Studi Informatika - Universitas Siliwangi")
    print("="*80)

def main():
    print_header()

    # --- 1. SETUP TOPOLOGI SIMPANG NAGARAWANGI ---
    # Sesuai dengan batasan di laporan
    nodes = ["Lajur Barat", "Lajur Utara", "Lajur Selatan"]
    
    # Matriks Konflik (1 = Konflik/Tabrakan, 0 = Aman)
    adj_matrix = [
        [0, 1, 1], # Barat konflik dgn Utara & Selatan
        [1, 0, 1], # Utara konflik dgn Barat & Selatan
        [1, 1, 0]  # Selatan konflik dgn Barat & Utara
    ]

    # --- 2. PEMBACAAN DATA ANTREAN (DARI CSV) ---
    print("\n[1] MENGAMBIL DATA SENSOR ANTREAN")
    print("-" * 60)
    
    datasets = {}
    try:
        with open('dataset_nagarawangi.csv', mode='r') as file:
            csv_reader = csv.DictReader(file)
            for row in csv_reader:
                datasets[row['id_skenario']] = {
                    "nama": row['nama_skenario'],
                    "data": {
                        "Lajur Barat": int(row['antrean_barat']),
                        "Lajur Utara": int(row['antrean_utara']),
                        "Lajur Selatan": int(row['antrean_selatan'])
                    }
                }
    except FileNotFoundError:
        print("[!] ERROR: File dataset_nagarawangi.csv tidak ditemukan.")
        return

    print("Pilih Skenario Dataset untuk Diuji:")
    for key, val in datasets.items():
        print(f"[{key}] {val['nama']}")
    
    pilihan = input("\nMasukkan nomor skenario (1-5): ")
    if pilihan not in datasets:
        print("Input tidak valid, menggunakan Skenario 1 (Normal).")
        pilihan = "1"
        
    skenario_aktif = datasets[pilihan]
    queues = skenario_aktif["data"]

    print(f"\n>>> MENJALANKAN SKENARIO: {skenario_aktif['nama']} <<<")
    for lane, q in queues.items():
        print(f"- {lane:<20}: {q} kendaraan")
    time.sleep(1)

    # --- 3. TAHAP GRAPH COLORING (BACKTRACKING) ---
    print("\n[2] TAHAP 1: GRAPH COLORING (Pemisahan Lajur Konflik)")
    print("-" * 60)
    print("> Menjalankan Backtracking untuk memetakan Fase Aman...")
    time.sleep(1)
    
    phases = get_phases(nodes, adj_matrix)
    for phase_id, lanes in phases.items():
        print(f"  * Fase {phase_id} Aman: {', '.join(lanes)}")
    time.sleep(1)

    # --- 4. TAHAP GREEDY ---
    print("\n[3] TAHAP 2: GREEDY (Penentuan Prioritas & Waktu Dinamis)")
    print("-" * 60)
    print("> Menghitung bobot antrean untuk alokasi waktu...\n")
    time.sleep(1)
    
    optimized_schedule = calculate_time_and_priority(phases, queues)
    
    for sched in optimized_schedule:
        print(f"> Prioritas Eksekusi: Fase {sched['phase_id']} ({', '.join(sched['lanes'])})")
        print(f"  Total Antrean: {sched['total_queue']} mobil")
        print(f"  Waktu Hijau  : {sched['green_time']} detik\n")
        time.sleep(0.5)

    # --- 5. EKSEKUSI ---
    print("[4] EKSEKUSI LAMPU LALU LINTAS")
    print("-" * 60)
    for sched in optimized_schedule:
        green_time = sched['green_time']
        print(f"\n[ LAMPU HIJAU ] FASE {sched['phase_id']} MENYALA")
        print(f"Mengurai lalu lintas selama {green_time} detik...")
        
        step = green_time // 3
        for i in range(1, 4):
            current_time = step * i
            if i == 3: current_time = green_time 
            print(f"  >> Memproses arus... (Mencapai {current_time}s / {green_time}s)")
            time.sleep(0.7) 
            
        print(f"[ STATUS ] Fase {sched['phase_id']} Selesai.")

    print("\n" + "="*80)
    print(" SIKLUS SELESAI")
    print("="*80 + "\n")

if __name__ == "__main__":
    main()