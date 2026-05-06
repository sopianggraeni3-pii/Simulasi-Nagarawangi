# graph_coloring.py

def is_safe(node, color, adj_matrix, colors):
    """Mengecek apakah aman memberikan warna pada node (tidak ada konflik dengan tetangga)"""
    for i in range(len(adj_matrix)):
        if adj_matrix[node][i] == 1 and colors[i] == color:
            return False
    return True

def graph_coloring_util(adj_matrix, m, colors, node, num_nodes):
    """Fungsi rekursif Backtracking untuk mencari solusi pewarnaan"""
    if node == num_nodes:
        return True # Semua node berhasil diwarnai
    
    for c in range(1, m + 1):
        if is_safe(node, c, adj_matrix, colors):
            colors[node] = c
            if graph_coloring_util(adj_matrix, m, colors, node + 1, num_nodes):
                return True
            colors[node] = 0 # Backtrack (kembali ke 0 jika gagal)
            
    return False

def get_phases(nodes, adj_matrix):
    """
    Mencari pembagian fase menggunakan algoritma Backtracking.
    Akan mencari jumlah warna (Fase) paling sedikit / Chromatic Number.
    """
    num_nodes = len(nodes)
    
    # Mencari jumlah fase minimum, mulai dari coba 1 fase, 2 fase, dst.
    for m in range(1, num_nodes + 1):
        colors = [0] * num_nodes
        if graph_coloring_util(adj_matrix, m, colors, 0, num_nodes):
            # Jika berhasil, kelompokkan node ke dalam fase berdasarkan warnanya
            phases = {}
            for i, color in enumerate(colors):
                if color not in phases:
                    phases[color] = []
                phases[color].append(nodes[i])
            return phases
            
    return {}