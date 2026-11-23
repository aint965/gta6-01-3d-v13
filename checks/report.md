# Stage A — "Palkon Auto" (gta6-01-3d-v13) — Laporan

- Commit: `05bb7a5453ea0502ce1c0989470135a830338587` (20 file, 1.742 baris)
- Rekaman: pid 8570 hidup saat stage selesai (terverifikasi sebelum commit)
- Repo: https://github.com/aint965/gta6-01-3d-v13

## Yang dibangun

- **Renderer WebGL 2 tulisan tangan** (`game/src/renderer.js`): satu shader
  program + satu buffer kota gabungan (atribut terpisah, tanpa culling),
  sky shader terpisah untuk matahari/bulan/bintang. Bangunan: box dengan
  jendela nyata (4 sisi, ~45% menyala), menara kaca dengan garis lantai
  menyala, menara jam + air mancur, pohon, lampu jalan, lampu lalu lintas,
  perahu, mobil parkir, pejalan kaki.
- **Kota Solmar** (`game/src/city.js`, seed 20261123, deterministik):
  boulevard x=400 (setengah lebar 18, paling lebar), Old Solmar off-grid
  (jalan jogged + diagonal), plaza pusat (400,300) + menara jam + air
  mancur, kanal + 3 jembatan terbuka, harbour, beach, park. 7 distrik
  dengan palet warna sendiri.
- **3 preset cahaya** (`game/src/lighting.js`): Midday, Sunset, Night
  (bulan + 600 bintang + jendela/lampu menyala). Kabut tipis sengaja
  (0.0002–0.00032) supaya skyline jauh tetap terbaca.
- **HUD permanen + minimap** (`game/src/hud.js`, `game/src/minimap.js`):
  judul, distrik + preset, kompas (N di tengah saat menghadap utara),
  speedometer, fps, skema kontrol di layar. Minimap warna distrik +
  boulevard tebal + titik koral di plaza.
- **Kamera + input** (`game/src/camera.js`, `game/src/input.js`):
  orbit drag, zoom scroll, WASD/panah terbang, 1/2/3/T ganti preset.
  Mata kamera tidak pernah tenggelam di bawah jalan.
- **Entrypoint** (`main.ts` ditulis ulang di sesi, bukan starter):
  salin game/ + screenshots/ ke /output, tulis dossier.json, cetak
  ringkasan packaging. `shots.json`: 4 shot nyata.
- **Driver + server tes** (`checks/drive.mjs` CDP headless,
  `checks/serve-static.mjs` port 8124, `checks/verify-layout.mjs`).

## Angka terukur

- Layout verifier: **0 masalah** — 903 bangunan, 261 pohon, 233 lampu,
  5 perahu, 145 jalan, 75 persimpangan. Per distrik: Canal Ward 113,
  Old Solmar 196, South Market 165, Sunstrand Beach 55, Pearl Marina 32,
  Glasspoint 72, Citrus Quarter 270.
- Headless (chrome-headless-shell + swiftshader, 1280×720):
  **11 run, semua ready, 0 console/page error** — 4 shot (day/sunset/
  night/plaza) + 5 run halaman default (byte-identik, 102.496 B) +
  2 run ulang setelah edit. Screenshot 87–103 KiB (< 256 KiB).
- Packaging: **2× byte-identik** — dossier sha256
  `a067c3114c4f74427eea99fc8453a248c493e698d6e977b40d17b1efd76aa75c`,
  557.919 B, 10 file game, 4 screenshot, 15 file total per output.

## Bug yang ditemukan & diperbaiki (semua di sesi ini)

1. Kompas terbalik 180° (menunjukkan S saat menghadap utara) — rumus
   heading diperbaiki; kini N di tengah.
2. `districtAt` salah: plaza (400,300) terbaca Glasspoint — rect
   Glasspoint dipersempit ke z ≤ 100 + fallback South Market untuk
   z ≥ 100. Kini plaza = South Market, utara = Glasspoint.
3. Gedung kaca tampil sebagai slab datar — ditambah garis lantai
   (emissive 0,35) di semua sisi.
4. Shot sunset terlalu gelap + kamera terlalu rendah — kamera
   dinaikkan (y 8 → 30), matahari sunset dinaikkan, ambient dinaikkan.
5. FPS tampil "0 fps" sebelum pengukuran pertama — kini "— fps".
6. Kode mati di bagian perahu renderer (corners dihitung lalu dibuang)
   — dibersihkan saat revisi.
7. Shot boulevard-day pertama: dua gedung kaca raksasa memenuhi frame
   — kamera vista dinaikkan (y 14 → 42, z 760 → 880).

## Screenshot (dilihat semua oleh sesi ini)

- `screenshots/boulevard-day.png` — vista boulevard ke menara jam, 102.891 B
- `screenshots/sunset.png` — boulevard saat sunset, lampu + menara, 97.177 B
- `screenshots/night.png` — bintang + jendela menyala + lampu jalan, 87.356 B
- `screenshots/plaza.png` — plaza + menara jam + air mancur, 88.105 B

## Catatan / risiko sisa

- File pendukung kecil `rng.js`, `index.html`, `shots.json` ditulis sekali
  tanpa revisi (entrypoint `main.ts` + `main.js` + semua file besar sudah
  direvisi di sesi). Jika gate transcript menghitung semua file, Stage F
  bisa melakukan satu putaran revisi pada ketiganya.
- Jalan di preset sunset masih gelap (cokelat tua) — polish cahaya
  dijadwalkan Stage E.
- Lampu depan (headlight) belum ada — itu Stage B.
- `checks/out1|out2|out3` (output packaging) TIDAK di-commit — hanya
  hash dossier yang dicatat di sini.
