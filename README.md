# Phonefarm Panel

Panel web lokal untuk melihat dan mengontrol HP di box phonefarm dari Mac, lengkap dengan workspace Instagram. Antarmuka berbahasa Indonesia.

## Menjalankan

```sh
npm install
npm run build
npm start
```

Buka **http://127.0.0.1:5179**, atau klik dua kali `Buka Phonefarm.command` dari Finder.

Pengembangan: `npm run dev`. Pengujian: `npm test` dan `python3 -m unittest discover -s tests -p 'test_*.py'`.

Layanan hanya mendengarkan pada `127.0.0.1`; API dan WebSocket memakai cookie lokal serta pemeriksaan origin.

## Fitur

- Daftar HP terhubung yang diperbarui otomatis, lengkap dengan status, baterai, dan ukuran layar.
- Layar langsung untuk semua HP. Klik untuk tap, seret untuk swipe, scroll untuk menggeser; tombol Back, Home, Recent, bangunkan, tidurkan, volume, kirim teks, dan unduh screenshot.
- Pilih beberapa HP sekaligus dan aktifkan kontrol sinkron.
- Halaman **Koneksi** membaca status slot dari pengendali box (hanya membaca, tidak mengubah apa pun).
- Nama HP dan kapasitas farm disimpan lokal di `.phonefarm/settings.json`.

## Workspace ig

Pilih **ig** dari menu workspace atau sidebar, lalu **Auto komen**. Menu **Auto upload postingan** disiapkan untuk tahap berikutnya.

1. Klik **Pindai akun HP**. Semua HP dibaca bersamaan untuk mengambil akun Instagram yang sudah login.
2. Centang akun yang hendak dipakai. Setiap akun punya pengaturan sendiri: satu username target, jumlah postingan terbaru (1–50), target komentar per postingan (1–100), dan nada (positif, netral, negatif). Baris **Isi semua akun** menerapkan nilai yang sama ke semua akun terpilih.
3. Pilih **Cara mulai HP**: *Bertahap* (HP berikutnya mulai 10–20 detik setelah HP sebelumnya) atau *Serentak* (semua HP mulai bersamaan).
4. **Cek target tanpa mengirim** memeriksa semua akun terpilih: caption, suasana, status like, jumlah komentar akun itu, postingan pin yang dilewati, dan contoh komentar. Tidak ada like atau komentar yang dikirim.
5. **Jalankan Auto komen**. Ringkasan per akun dan log gabungan tampil di bagian Aktivitas. Tombol **Hentikan** tersedia saat memindai, memeriksa, dan menjalankan.

Per postingan: postingan yang disematkan (pin) dilewati dan diganti postingan berikutnya, postingan di-like bila belum, caption dibaca, komentar akun itu dihitung, lalu hanya kekurangannya yang dikirim. Contoh: sudah 3 komentar dan target 4, maka dikirim 1. Jeda acak 3–6 detik antar komentar dan 5–12 detik antar postingan.

Komentar dirakit dari bank komentar lokal (`server/komentar/`) berdasarkan caption dan nada: suasana postingan (berita, bencana, wafat, prestasi, dan lainnya) dideteksi dari caption, nada negatif pada kabar duka dialihkan ke netral, dan komentar yang mirip komentar yang sudah ada dihindari. Komentar tanpa emoji.

Pengaman: akun aktif diverifikasi sebelum mengirim, draft lama tidak ditimpa, kiriman yang belum pasti tidak diulang, dan akun yang dibatasi Instagram berhenti sendiri tanpa menghentikan HP lain.

Daftar akun, setelan, hitungan, dan riwayat lokal berada di `.phonefarm/instagram.json` dan tidak ikut repo.

Catatan: pembacaan caption utuh (mengetuk "selengkapnya" sebelum komentar disusun) sudah ditulis tetapi belum diuji pada HP.

## Rencana aplikasi native Mac

`src/` berisi tampilan React dan `server/` berisi layanan lokal. Keduanya dapat dibungkus menjadi aplikasi Mac (misalnya Electron) pada tahap berikutnya.
