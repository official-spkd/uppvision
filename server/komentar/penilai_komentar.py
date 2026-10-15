"""Penilai kualitas komentar, dipakai bersama oleh AI dan bank lokal.

Tugasnya tiga:

1. ``periksa``: tolak komentar yang melanggar aturan keras (terlalu panjang,
   ada hashtag/mention/link, kebanyakan emoji, menyalin caption, atau memakai
   slang candaan di postingan duka).
2. ``skor``: beri nilai relevansi, yaitu seberapa banyak kata kunci caption
   yang disinggung, dengan penalti untuk komentar generik.
3. ``pilih_terbaik``: ambil N kandidat terbaik yang tidak mirip satu sama
   lain maupun mirip komentar yang pernah dikirim akun ini.
"""

from __future__ import annotations

import random
import re
from typing import Iterable

SUASANA_DUKA = frozenset({"bencana", "wafat", "insiden", "risiko"})

# Slang/candaan yang tidak pantas muncul di postingan musibah atau kabar duka.
_DILARANG_DUKA = frozenset({
    "gokil", "gila", "bestie", "cuy", "ngakak", "lol", "anjay", "anjir", "bjir",
    "mantul", "vibes", "vibesnya", "seru", "asik", "asyik", "jujurly", "gas",
    "gaskeun", "cakep", "lucu", "parah", "keren", "kocak", "santuy", "auto",
    "epic", "slay", "sabi", "mantap", "mantab",
})
_AWALAN_TAWA = ("wkwk", "haha", "hehe", "hihi", "xixi")
_EMOJI_DUKA = frozenset({"🙏", "🤲", "😢", "🥺", "💔", "😭", "🕊"})

_EMOJI = re.compile(
    "[\U0001F300-\U0001FAFF\U0001F1E6-\U0001F1FF☀-➿⭐⭕]"
)

# Frasa yang menandakan komentar generik (cocok ditempel di postingan mana saja).
_GENERIK = (
    "keren banget", "mantap", "thanks udah share", "makasih udah share",
    "semangat terus", "nice info", "good job", "sukses selalu", "top deh",
    "kontennya keren", "suka banget sama postingan",
)

MAKS_KATA = 25
MAKS_KARAKTER = 220


def kata(teks: str) -> list[str]:
    """Pecah teks jadi kata huruf kecil (angka ikut dihitung sebagai kata)."""
    return re.findall(r"[a-z0-9]+", str(teks or "").lower())


def _isi(teks: str) -> set[str]:
    return {k for k in kata(teks) if len(k) >= 3}


def kemiripan(a: str, b: str) -> float:
    """Kemiripan dua komentar (Jaccard kata isi), 0 = beda total, 1 = sama."""
    ka, kb = _isi(a), _isi(b)
    if not ka or not kb:
        return 0.0
    return len(ka & kb) / len(ka | kb)


def _shingle(token: list[str], n: int = 5) -> set[tuple[str, ...]]:
    return {tuple(token[i:i + n]) for i in range(len(token) - n + 1)}


def jumlah_emoji(teks: str) -> int:
    return len(_EMOJI.findall(teks or ""))


def periksa(teks: str, suasana: str = "", caption: str = "") -> str | None:
    """Kembalikan alasan penolakan, atau ``None`` kalau komentar lolos."""
    teks = str(teks or "").strip()
    if not teks:
        return "kosong"
    token = kata(teks)
    if len(token) < 2:
        return "terlalu pendek"
    if len(token) > MAKS_KATA or len(teks) > MAKS_KARAKTER:
        return "terlalu panjang"
    rendah = teks.lower()
    if "#" in teks:
        return "ada hashtag"
    if "@" in teks:
        return "ada mention"
    if "http" in rendah or "www." in rendah or ".com" in rendah:
        return "ada link"
    emoji = _EMOJI.findall(teks)
    if len(emoji) > 1:
        return "emoji lebih dari 1"
    if suasana in SUASANA_DUKA:
        if any(t in _DILARANG_DUKA or t.startswith(_AWALAN_TAWA) for t in token):
            return "slang candaan di postingan duka"
        if any(e not in _EMOJI_DUKA for e in emoji):
            return "emoji tidak pantas di postingan duka"
    if caption and _shingle(token) & _shingle(kata(caption)):
        return "menyalin caption"
    return None


def _relevansi(teks: str, kata_kunci: Iterable[str]) -> int:
    """Berapa kata kunci caption yang disinggung (imbuhan ditoleransi)."""
    kunci = [k for k in kata_kunci if len(k) >= 3]
    if not kunci:
        return 0
    kena = set()
    for t in _isi(teks):
        for k in kunci:
            if t == k or (len(t) >= 5 and len(k) >= 5 and t[:5] == k[:5]):
                kena.add(k)
    return len(kena)


def skor(teks: str, kata_kunci: Iterable[str] = ()) -> float:
    relevan = _relevansi(teks, kata_kunci)
    nilai = min(relevan, 3) * 2.0
    n = len(kata(teks))
    if 6 <= n <= 20:
        nilai += 1.0
    if relevan == 0 and any(g in teks.lower() for g in _GENERIK):
        nilai -= 2.0
    # Pemecah seri supaya urutan tidak selalu sama.
    return nilai + random.random() * 0.5


def pilih_terbaik(
    kandidat: Iterable[str],
    jumlah: int,
    *,
    suasana: str = "",
    caption: str = "",
    kata_kunci: Iterable[str] = (),
    hindari: Iterable[str] = (),
    batas_mirip: float = 0.55,
) -> list[str]:
    """Saring kandidat lalu ambil ``jumlah`` terbaik yang saling berbeda."""
    kata_kunci = list(kata_kunci)
    hindari = [h for h in hindari if h]
    lolos: list[str] = []
    dilihat: set[str] = set()
    for teks in kandidat:
        teks = str(teks or "").strip()
        if not teks or teks.lower() in dilihat:
            continue
        dilihat.add(teks.lower())
        if periksa(teks, suasana, caption) is None:
            lolos.append(teks)

    lolos.sort(key=lambda t: skor(t, kata_kunci), reverse=True)
    hasil: list[str] = []
    awalan: set[str] = set()
    cadangan: list[str] = []
    for teks in lolos:
        if any(kemiripan(teks, h) >= batas_mirip for h in hasil + hindari):
            continue
        pertama = (kata(teks) or [""])[0]
        # Variasi: komentar yang kata pertamanya sama ditunda dulu.
        if pertama in awalan:
            cadangan.append(teks)
            continue
        awalan.add(pertama)
        hasil.append(teks)
        if len(hasil) >= jumlah:
            return hasil
    for teks in cadangan:
        if len(hasil) >= jumlah:
            break
        if not any(kemiripan(teks, h) >= batas_mirip for h in hasil):
            hasil.append(teks)
    return hasil
