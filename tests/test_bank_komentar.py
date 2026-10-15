"""Bank komentar harus tetap luas untuk caption berita/darurat.

Ambang di bawah adalah 100 kali kapasitas terukur sebelum perluasan 13 Oktober 2026
(bencana 28, berita 14, risiko 8, insiden 32). Angka ini tidak boleh turun lagi tanpa
keputusan sadar, karena panel meminta sampai 100 akun x 20 link x 100 komentar.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server" / "komentar"))

import bank_komentar as bank  # noqa: E402

# Bank dipakai tanpa emoji: ADB hanya bisa mengetik huruf Latin, angka, dan simbol.
for _kunci in bank._EMOJI:
    bank._EMOJI[_kunci] = ([], 0.0)

# Kapasitas minimum yang harus tetap tersedia setelah perluasan (100x sebelumnya).
LANTAI = {"bencana": 2800, "berita": 1400, "risiko": 800, "insiden": 3200}

# Frasa yang menyatakan hal yang tidak pernah dipastikan caption. Cabang aman tidak
# boleh memakai ini; itulah alasan cabang aman ada.
TERLARANG = (
    "keluarga korban", "keluarga yang masih menunggu", "keluarga yang menunggu",
    "evakuasi", "trauma", "korban", "tenaga medis", "kebutuhan dasar",
    "logistik", "para korban", "warga sekitar", "keajaiban",
)


def kapasitas(tone: str, suasana: str) -> int:
    """Banyak kombinasi (inti, pembuka, penutup) yang lolos bentrok kata dan batas panjang."""
    _t, _k, pembuka, inti, penutup, _e = bank._bahan(tone, suasana)
    total = 0
    for dasar in inti:
        for p in pembuka:
            if p and bank._bentrok(p, dasar):
                continue
            for q in penutup:
                if q and (bank._bentrok(q, dasar) or (p and bank._bentrok(p, q))):
                    continue
                teks = bank._rakit(dasar, "", p, q, "")
                if len(bank.penilai.kata(teks)) <= bank.penilai.MAKS_KATA:
                    total += 1
    return total


class BankKomentarTest(unittest.TestCase):
    def test_capacity_floor_per_mood(self):
        for suasana, lantai in LANTAI.items():
            with self.subTest(suasana=suasana):
                tersedia = kapasitas("positif", suasana)
                self.assertGreaterEqual(
                    tersedia, lantai,
                    f"{suasana} hanya menyediakan {tersedia} komentar berbeda; minimal {lantai}",
                )

    def test_safety_branches_never_claim_unstated_facts(self):
        for suasana in ("bencana", "risiko", "insiden", "berita"):
            _t, _k, pembuka, inti, penutup, _e = bank._bahan("positif", suasana)
            teks = " ".join(inti + pembuka + penutup).lower()
            for frasa in TERLARANG:
                with self.subTest(suasana=suasana, frasa=frasa):
                    self.assertNotIn(frasa, teks)

    def test_big_mood_tables_stay_unused_by_safety_branches(self):
        # Tabel _INTI lama memuat klaim yang tidak dinyatakan caption. Cabang aman harus
        # tetap memakai daftar inti sendiri, bukan tabel besar itu.
        _t, _k, _p, inti, _q, _e = bank._bahan("positif", "bencana")
        self.assertNotIn("semoga evakuasi dan bantuannya berjalan aman", inti)
        self.assertNotIn("semoga trauma para korban cepat pulih dengan dukungan semua orang", inti)

    def test_generated_comments_pass_the_checker(self):
        caption = (
            "Kebakaran hutan dan lahan (karhutla) kembali menjadi perhatian. Sejumlah petugas "
            "berjibaku memadamkan kobaran api di area vegetasi. Asap tebal menyelimuti lokasi."
        )
        for suasana in ("bencana", "berita", "risiko", "insiden"):
            with self.subTest(suasana=suasana):
                dipakai = set()
                for _ in range(4):
                    hasil = bank.buat_komentar(caption, 50, "positif", hindari=[], suasana=suasana)
                    for teks in hasil:
                        self.assertIsNone(bank.penilai.periksa(teks, suasana, caption), teks)
                    dipakai.update(" ".join(t.split()) for t in hasil)
                self.assertGreaterEqual(len(dipakai), 40, f"{suasana} terlalu sedikit variasi unik")

    def test_negative_tone_on_death_news_is_redirected(self):
        # Mengkritik postingan duka tidak pernah pantas.
        tone, _kunci, *_rest = bank._bahan("negatif", "wafat")
        self.assertEqual(tone, "netral")


if __name__ == "__main__":
    unittest.main()
