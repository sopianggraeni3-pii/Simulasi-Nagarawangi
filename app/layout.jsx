import { Geist } from 'next/font/google';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });

export const metadata = {
  title: 'Analitik Simpang Nagarawangi',
  description: 'Dashboard perbandingan algoritma Fixed-Time vs Hybrid Graph Coloring-Greedy untuk optimasi lampu lalu lintas Simpang Nagarawangi.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="id" className={`${geist.variable} h-full`}>
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
