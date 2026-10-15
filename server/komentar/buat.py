"""Rakit komentar dari bank igexe untuk Auto komen phonefarm.

Masukan (stdin, JSON): {"caption": str, "count": int, "tone": str, "hindari": [str], "konteks": str}
Keluaran (stdout, JSON): {"suasana": str, "tone": str, "comments": [str]}

"konteks" adalah teks yang terbaca di layar postingan (misalnya judul berita yang
tercetak di gambar); hanya dipakai untuk mendeteksi suasana, bukan subjek komentar.

Bank dan penilai disalin apa adanya dari igexe. Emoji dimatikan di sini karena
ADB hanya dapat mengetik huruf Latin, angka, dan simbol.
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bank_komentar as bank  # noqa: E402

for kunci in bank._EMOJI:
    bank._EMOJI[kunci] = ([], 0.0)

_LATIN = re.compile(r"^[\x20-\x7e]+$")


def main() -> None:
    data = json.load(sys.stdin)
    caption = str(data.get("caption") or "")[:5000]
    count = max(1, min(int(data.get("count") or 1), 100))
    tone = bank._tone(data.get("tone"))
    hindari = [str(t) for t in data.get("hindari") or [] if t][:2000]
    konteks = str(data.get("konteks") or "")[:5000]
    # Caption owns the context. OCR can contain an adjacent post, counters or
    # short artifacts such as "F1"; it must not turn haze news into sports.
    suasana = bank.deteksi_suasana(caption)
    if not caption.strip():
        suasana = bank.deteksi_suasana(konteks)
    elif konteks and suasana not in bank.penilai.SUASANA_DUKA:
        serius = bank.deteksi_suasana(konteks)
        if serius in bank.penilai.SUASANA_DUKA:
            suasana = serius
    hasil: list[str] = []
    for _ in range(6):
        for teks in bank.buat_komentar(caption, count - len(hasil), tone, hindari=hindari + hasil, suasana=suasana):
            teks = " ".join(teks.split())
            # Subjek dari caption bisa memuat huruf non-Latin; komentar itu dibuang.
            if _LATIN.match(teks) and teks.lower() not in {h.lower() for h in hasil + hindari}:
                hasil.append(teks)
        if len(hasil) >= count:
            break
    tone_dipakai = bank._bahan(tone, suasana)[0]
    json.dump({"suasana": suasana, "tone": tone_dipakai, "comments": hasil[:count]}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
