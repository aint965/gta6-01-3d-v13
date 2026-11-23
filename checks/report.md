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
  **13 run, semua ready, 0 console/page error** — 1 shot awal +
  4 shot setelah perbaikan kaca/kompas + 2 retake (sunset/plaza)
  setelah perbaikan district + 5 run halaman default (byte-identik,
  102.496 B) + 1 run akhir setelah edit revisi. Screenshot 87–103 KiB
  (< 256 KiB).
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

---

# Stage B — "Palkon Auto" (gta6-01-3d-v13) — Laporan

- Rekaman: pid 8570 hidup saat stage selesai (terverifikasi sebelum commit)
- Repo: https://github.com/aint965/gta6-01-3d-v13

## Yang dibangun

- **4 profil kendaraan** (`game/src/vehicle.js`): compact 115, sedan 130,
  van 108, coupe 158 km/h (akselerasi/rem/mundur beda per profil, 1 unit
  = 1 m). Kelas Vehicle murni (tanpa DOM), setir hanya menggigit saat
  bergerak dan melemah di kecepatan tinggi.
- **Lalu lintas** (`game/src/traffic.js`): 18 mobil di 6 loop persegi
  panjang (3 mobil/loop, lajur kanan, tikungan membulat radius 6),
  patuh lampu merah, jaga jarak ikut (follow gap), prioritas
  persimpangan, tidak pernah tumpang tindih. 24 pejalan kaki di trotoar
  (boulevard ±22, promenade, plaza, jalan silang).
- **Lampu lalu lintas** (`game/src/signals.js`): siklus 26 detik (NS hijau
  11, NS kuning 2, EW hijau 11, EW kuning 2), offset fase per
  persimpangan. Mobil berhenti di garis stop 8 unit sebelum persimpangan,
  termasuk persimpangan tengah-sisi yang bukan tikungan loop (ditemukan
  karena drive test menunjukkan 3 red run yang tidak terlihat di tes Node).
- **Lampu depan** (`game/src/renderer.js`): 2 cone per mobil (kiri/kanan,
  24°, warna [1.0, 0.9, 0.7], atenuasi jarak, lantai difus 0.3 supaya jalan
  horizontal tetap menangkap cahaya), maks 8 spot di shader (mobil pemain
  + 3 mobil lalu lintas terdekat). Hook probe piksel (`requestSample` /
  `lastSample`, readPixels 40×40 sinkron di dalam render).
- **Tabrakan** (`game/src/collision.js`): SAT murni (OBB vs AABB, OBB vs
  OBB, lingkaran vs AABB). Benturan > 3 m/s: guncang kamera + debu +
  damage di HUD; gesekan pelan hanya mendorong keluar tanpa kehilangan
  kecepatan. Mobil parkir (`movable: false`) tidak pernah bergeser.
- **Mara jalan kaki + E masuk/keluar** (`game/src/player.js`): Mara jalan
  6 m/s (WASD menggerakkan Mara, bukan kamera), radius masuk 4.5,
  radius prompt 12, keluar di sisi kanan mobil 3.2 unit. Cincin koral di
  tanah menandai mobil yang bisa dikendarai (terang saat dalam jangkauan);
  mobil parkir tanpa cincin + tanpa garis koral di atap.
- **Mesh dinamis** (`game/src/dynamic.js`): mobil (parkir, lalu lintas,
  pemain, target), Mara, pejalan kaki, lensa lampu lalu lintas (menyala
  sesuai sinyal hidup), cincin E, debu — dibangun ulang tiap frame.
- **Kamera + HUD** (`game/src/camera.js`, `game/src/hud.js`,
  `game/src/minimap.js`): kamera chase di belakang mobil (kembali
  perlahan setelah 2.5 detik tanpa drag), prompt E / damage / toast,
  minimap dengan titik (lalu lintas putih, drivable cincin koral, pemain
  kuning, Mara putih). FPS kini update tiap 250 ms sehingga screenshot
  menampilkan angka nyata.
- **Hook debug** (`game/src/main.js`, hanya untuk driver verifikasi):
  `probe`, `teleportCar`, `setProfile`, `enterNearest`, `setHeadlights`,
  `placeTargetCar`, `placePedestrian`, `trafficCars`, `pedestrians`,
  `getState` (termasuk `camEye`/`camTarget`/`canvas` untuk diagnosis
  proyeksi).

## Angka terukur

- Tes murni (`node checks/test-stage-b.mjs`): **35/35 LOLOS** — top speed
  compact 115.0 / sedan 130.0 / van 108.0 / coupe 158.0 (persis);
  mundur 2.5 detik: 13.5 unit, −25.0 km/h; tabrakan gedung: berhenti
  (9.0 km/h), damage 78.8%, tanpa penetrasi; mobil vs mobil: tanpa
  overlap (0.0/51.2); siklus sinyal NS hijau 11 / kuning 2 / EW hijau 11 /
  kuning 2 detik; lalu lintas 240 detik: **0 red run, 61 stop**, jarak
  ikut min 8.0, 0 overlap, jarak pasangan min 6.0, 0 off-road; lalu lintas
  dt=0.1 (300 detik): **0 red run, 72 stop**; pemain menemukan mobil
  terdekat (4.2), masuk, keluar di samping mobil (390.2, 500.0).
- Drive test browser (`node checks/drive-test.mjs`): **14/14 LOLOS** —
  top speed compact 115 / sedan 130 / van 108 / coupe 158 km/h (persis,
  toleransi ±2); mundur −23.8 km/h, 24.9 unit; berhenti di lampu merah
  gap **77.7** (berhenti sebelum garis, 0 red run); E keluar/masuk ulang
  lolos; trafficStats stops=15, redRuns=0, minPairDist 6.06; **0 console
  error**.
- Tes lampu depan (`node checks/headlight-test.mjs`): **SEMUA LOLOS,
  kedua varian haze** — haze=on: aspal **+89.5** (100% piksel > +10),
  atap **+39.8** (100%), kontrol **+0.1**; haze=off: aspal **+89.4**
  (100%), atap **+39.8** (100%), kontrol **+0.1**; 0 console error.
  (Gain atap lebih rendah dari aspal karena mobil target digeser ke
  60 unit di depan mobil pemain — atenuasi jarak 1/(1+(d/45)²) — bukan
  karena beam lemah: saat target di 35 unit, gain atap +70.4.)
- Layout verifier: **0 masalah** — 903 bangunan, 261 pohon, 233 lampu,
  5 perahu, 145 jalan, 75 persimpangan (kota tidak berubah dari Stage A).
- Packaging: **2× byte-identik** — dossier sha256
  `56b1aff7f1559d37b8a8221789eefebf3c49e0d6eac17a4db92a2148ccdf0ce4`,
  619.984 B, 16 file game, 4 screenshot.

## Bug yang ditemukan & diperbaiki (semua di sesi ini)

1. **Mobil lalu lintas tidak pernah di-render** — `buildDynamicMesh`
   hanya menggambar mobil parkir/drivable; `traffic.cars` tidak pernah
   diteruskan. Jalan terlihat kosong di semua screenshot padahal lalu
   lintas disimulasi (bergerak, berhenti di lampu merah). Ini juga
   menjelaskan catatan Stage A "jalan/plaza terlihat kosong di level
   jalan". Perbaikan: `traffic.cars` diteruskan ke `buildDynamicMesh`
   dan digambar sebagai mobil biasa (tanpa garis koral).
2. **Tes cone spot terbalik di `CITY_FRAG`** — `L = uSpotPos - vWorld`
   adalah arah permukaan-ke-lampu, sementara `uSpotDir` adalah arah
   beam menjauhi lampu, jadi `dot(L, dir) ≈ −1` dan beam menyinari jalan
   DI BELAKANG mobil. Perbaikan: `toSurf = vWorld - uSpotPos`,
   `c = dot(toSurf, uSpotDir)`, `ndl = max(dot(n, -toSurf), 0.0)`.
3. **Tombol E mereset kamera staged** — handler E masuk/keluar memanggil
   `camera.setDist(16)/setPitch(-0.2)` tanpa syarat, menimpa kamera
   `?cam=` (dist 132) menjadi chase cam (dist 16, eye 400,3.18,785.68).
   Ditemukan lewat diagnostik `camEye` di `getState`. Perbaikan: hanya
   saat `!staged`.
4. **Lalu lintas hanya patuh sinyal di tikungan loop** — drive test
   menunjukkan 3 red run dalam 29 detik game padahal tes Node 240 detik
   0 red run. Perbaikan: `nextSignal` (persimpangan berikutnya di jalan
   yang sama) + stop-line clamp (langkah frame tidak boleh melompati
   garis merah).
5. **Overlap antar-loop** — 3 loop berbagi lajur x=797 arah selatan dan
   aturan prioritas satu sisi membuat mobil menabrak dari belakang.
   Perbaikan: 6 loop dirancang ulang agar tidak berbagi tikungan +
   follow berbasis lajur (mobil searah di lajur yang sama: samakan
   kecepatan; lalu lintas bersilangan: indeks lebih rendah didahulukan).
6. **Lampu mobil lalu lintas bocor ke titik kontrol probe** — kontrol
   +48.3 padahal di luar beam pemain. Perbaikan: di mode tes headlight,
   hanya cone mobil pemain yang menyala (isolasi yang diuji).
7. **Region probe aspal menelan atap mobil pemain** — atap mobil sendiri
   tidak kena beam-nya (gain 0), membuat 17% piksel gagal. Perbaikan:
   titik aspal digeser ke (400,770) + mobil target ke (400,740).
8. **Titik kontrol proyeksi di luar frame** (sx=2436) — penyebabnya bug
   no. 3 (kamera chase menimpa staged). Setelah no. 3 diperbaiki,
   proyeksi cocok dengan perhitungan Node (aspal 640,359; atap 640,329;
   kontrol 730,370 — semua di dalam frame).
9. **Bug sisi-tes** (bukan game): `setHeadlights` menerima string
   `'on'`/`'off'`/`'auto'`, bukan boolean; probe mengembalikan objek
   `{valid, mean, pixels}`, bukan array `[r,g,b]`; mode awal `'walk'`
   bukan `'onfoot'`; `speedKmh` di `getState().car.speedKmh`; pengukuran
   mundur harus menahan S 2.5 detik game SETELAH mencapai −20 km/h.

## Screenshot (dilihat semua oleh sesi ini)

- `checks/shots/drive-day.png` — taksi kuning 32 km/jam di boulevard
  (Pearl Marina, Midday), mobil lalu lintas jelas di depan + pejalan
  kaki terlihat di jalan di depan (diambil via `checks/drive-shot.mjs`:
  teleport 30 unit di belakang mobil lalu lintas boulevard + pejalan
  kaki ditempatkan 40 unit di depan via hook `placePedestrian`, lalu gas
  4 detik). Shot chase-cam drive test tidak dipakai: lalu lintas
  15–35 unit di depan terlalu kecil/tertutup taksi.
- `checks/shots/night-headlight.png` — beam lampu depan terlihat jelas
  sebagai kerucut terang di jalan malam (kamera staged 400,25,900).

## Catatan / risiko sisa

- `checks/shots/drive-day.png` + `night-headlight.png` adalah shot
  verifikasi Stage B (di `checks/shots/`, BUKAN `screenshots/`) — gate
  membatasi `screenshots/` ke 4 file dan 4 shot Stage A sudah mengisinya.
  Stage F memiliki 4 shot final.
- Pejalan kaki di `drive-day.png` ditempatkan via hook debug
  `placePedestrian` (40 unit di depan, di jalan) khusus untuk framing
  foto; pejalan kaki itu sendiri pejalan kaki game sungguhan (dari
  `traffic.pedestrians`) dan terus berjalan. Tanpa penempatan ini,
  pejalan kaki tersebar (24 orang di seluruh kota) dan hampir tidak
  pernah selaras dengan mobil lalu lintas dalam satu frame di 2 fps
  (waktu game berjalan ~1/5 waktu nyata).
- File pendukung kecil `rng.js`, `index.html`, `shots.json` masih ditulis
  sekali tanpa revisi (catatan Stage A) — Stage F lakukan satu putaran
  revisi ketiganya.
- `checks/out1|out2` (output packaging) TIDAK di-commit — hanya hash
  dossier yang dicatat di sini.
