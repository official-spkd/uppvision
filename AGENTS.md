# Acuan project Phonefarm

Sebelum mengubah auto komen, baca `docs/auto-comment-guide.json`. File itu adalah sumber tunggal menu **Workspace → Panduan** dan patokan alur yang disepakati pengguna untuk Instagram, TikTok, X, Threads, Facebook, dan YouTube.

- Bedakan alur baku yang diinginkan dari status implementasi per platform. Jangan menganggap simulasi atau adapter eksperimen sebagai live yang sudah terverifikasi.
- Pemilihan postingan dilakukan otomatis saat script berjalan: buka profil, baca sejumlah postingan terbaru non-pin, lalu kunci daftar sebelum like atau komentar. Gunakan daftar awal untuk semua langkah dan retry; jangan mengganti sasaran dengan posisi grid yang bergeser.
- Pertahankan like idempotent, top-up komentar (target total dikurangi komentar yang ada), verifikasi akun/target, dan penahanan kiriman belum pasti agar tidak terkirim dua kali.
- Saat pengguna meminta uji live, batasi ke akun, perangkat, target dan jumlah yang mereka tentukan. Pantau log serta layar, hentikan bila sasaran/akun salah, dan bedakan kiriman terverifikasi dari asumsi. Tes lokal bukan bukti kiriman di HP.
- Perbarui `docs/auto-comment-guide.json` jika implementasi atau keputusan pengguna berubah. Menu merender file tersebut langsung; jangan membuat salinan panduan yang berbeda.
- Pertahankan perubahan pengguna yang sudah ada, desain panel, dan pemisahan status USB/ADB, stream layar, serta internet. Jangan membaca atau mencetak material credential, kunci ADB, atau cookie sesi.

Instruksi terbaru pengguna mengungguli panduan ini. Perbedaan implementasi terhadap panduan harus disebut secara jelas, bukan disembunyikan dengan mengubah klaim status.
