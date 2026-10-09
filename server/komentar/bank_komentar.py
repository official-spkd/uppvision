"""Bank komentar lokal: cadangan kalau DeepSeek tidak bisa dipakai.

Komentar tidak diambil dari daftar jadi, melainkan DIRAKIT dari tiga bagian:

    [pembuka]  +  inti (boleh memuat {S} = subjek caption)  +  [penutup]  + [emoji]

Setiap bagian punya daftar sendiri per tone (positif/netral/negatif) dan per
suasana postingan (bencana, wafat, berita, prestasi, edukasi, hiburan,
kuliner, wisata, acara, olahraga, umum). Pembuka dan penutup boleh kosong,
dan kombinasi yang mengulang kata yang sama ("Semoga ... Semoga ...") dibuang.
Hasilnya ratusan ribu komentar unik; ``jumlah_variasi`` menghitung angkanya.

Suasana dideteksi dari kata-kata caption dengan bobot, supaya kabar duka
("hilang kontak", "evakuasi", "meninggal") tidak salah dianggap kabar gembira
hanya karena ada kata "selamat".
"""

from __future__ import annotations

import random
import re
from collections import Counter
from typing import Iterable

import penilai_komentar as penilai

TONES = ("positif", "netral", "negatif")
SUASANA = (
    "bencana", "wafat", "berita", "prestasi", "edukasi", "hiburan",
    "kuliner", "wisata", "acara", "olahraga", "umum",
)


def _tone(value: str) -> str:
    t = str(value or "").strip().lower()
    return t if t in TONES else "positif"


# ============================================================
#  DETEKSI SUASANA
#  Kunci berakhiran * = awalan kata; kunci berspasi = frasa utuh.
# ============================================================

_KATA_SUASANA: dict[str, dict[str, int]] = {
    "wafat": {
        "meninggal": 3, "wafat": 3, "berpulang": 3, "innalillahi": 3,
        "almarhum": 3, "almarhumah": 3, "mendiang": 3, "jenazah": 3,
        "pemakaman": 3, "dimakamkan": 3, "tutup usia": 3, "berduka": 2,
        "duka cita": 2, "dukacita": 2, "rip": 2, "turut berduka": 2,
    },
    "bencana": {
        "tenggelam": 3, "gempa": 3, "banjir": 3, "longsor": 3, "tsunami": 3,
        "erupsi": 3, "kebakaran": 3, "kecelakaan": 3, "tabrakan": 3,
        "evakuasi": 3, "dievakuasi": 3, "tim sar": 3, "basarnas": 3,
        "pengungsi": 3, "mengungsi": 3, "puting beliung": 3, "musibah": 3,
        "bencana": 3, "tragedi": 3, "karam": 3, "hilang kontak": 3,
        "korban": 2, "terbakar": 2, "sar": 2, "penyelamatan": 2,
        "terdampak": 2, "badai": 2, "angin kencang": 2, "ambruk": 2,
        "runtuh": 2, "kandas": 2, "terseret": 2, "hilang": 1, "pencarian": 1,
        "darurat": 1, "gelombang": 1, "luka": 1,
    },
    "berita": {
        "pemerintah": 2, "presiden": 2, "menteri": 2, "dpr": 2,
        "kebijakan": 2, "anggaran": 2, "sidang": 2, "ekonomi": 2,
        "pemilu": 2, "partai": 2, "kementerian": 2, "kemenkeu": 2, "ruu": 2,
        "pejabat": 2, "gubernur": 2, "bupati": 2, "pilkada": 2, "demo": 2,
        "ktt": 2, "pidato": 2, "politik": 2, "triliun": 1, "miliar": 1,
        "polisi": 1, "kasus": 1, "hukum": 1, "harga": 1, "rakyat": 1,
        "warga": 1, "undang": 1, "pertemuan": 1, "kunjungan": 1,
        "klarifikasi": 1, "rp*": 1,
    },
    "prestasi": {
        "juara": 3, "medali": 3, "prestasi": 3, "wisuda": 3, "penghargaan": 3,
        "award": 3, "pencapaian": 3, "menang": 2, "lulus": 2, "rekor": 2,
        "piala": 2, "selamat atas": 2, "selamat kepada": 2, "emas": 1,
        "terbaik": 1, "bangga": 1, "lolos": 1,
    },
    "edukasi": {
        "tips": 3, "tutorial": 3, "trik": 3, "panduan": 3, "edukasi": 3,
        "cara": 2, "belajar": 2, "fakta": 2, "ilmu": 2, "langkah": 1,
        "pelajaran": 1, "penjelasan": 1, "manfaat": 1, "kesehatan": 1,
    },
    "hiburan": {
        "lagu": 3, "musik": 3, "film": 3, "lucu": 3, "ngakak": 3, "meme": 3,
        "prank": 3, "komedi": 3, "dance": 3, "nyanyi": 3, "artis": 2,
        "aktor": 2, "aktris": 2, "drama": 2, "series": 2, "penyanyi": 2,
        "trailer": 2, "selebriti": 2, "seleb": 2, "podcast": 2, "cover": 1,
        "rilis": 1,
    },
    "kuliner": {
        "makanan": 3, "kuliner": 3, "resep": 3, "masak": 3, "masakan": 3,
        "lezat": 3, "restoran": 3, "jajan": 3, "camilan": 3, "sambal": 3,
        "bakso": 3, "makan": 2, "enak": 2, "menu": 2, "warung": 2, "kafe": 2,
        "cafe": 2, "kopi": 2, "mie": 2, "minuman": 2, "nasi": 1, "rasa": 1,
    },
    "wisata": {
        "wisata": 3, "liburan": 3, "pantai": 3, "destinasi": 3, "healing": 3,
        "travel": 3, "traveling": 3, "pemandangan": 3, "air terjun": 3,
        "curug": 3, "staycation": 3, "gunung": 2, "trip": 2, "danau": 2,
        "hotel": 2, "villa": 2, "pulau": 1,
    },
    "acara": {
        "konser": 3, "festival": 3, "event": 3, "pameran": 3, "launching": 3,
        "nonton bareng": 3, "nobar": 3, "karnaval": 3, "bazar": 3, "expo": 3,
        "acara": 2, "peluncuran": 2, "siaran langsung": 2, "perayaan": 2,
        "hut": 2, "live": 1,
    },
    "olahraga": {
        "timnas": 3, "pertandingan": 3, "laga": 3, "gol": 3, "liga": 3,
        "sepak bola": 3, "sepakbola": 3, "badminton": 3, "bulutangkis": 3,
        "voli": 3, "basket": 3, "atlet": 3, "klasemen": 3, "semifinal": 3,
        "turnamen": 3, "motogp": 3, "olimpiade": 3, "sea games": 3,
        "pelatih": 2, "skor": 2, "final": 2, "f1": 2, "bola": 1, "piala": 1,
    },
}


def _skor_suasana(caption: str) -> dict[str, int]:
    token = penilai.kata(caption)
    teks = f" {' '.join(token)} "
    hitung = Counter(token)
    skor: dict[str, int] = {}
    for suasana, daftar in _KATA_SUASANA.items():
        n = 0
        for kunci, bobot in daftar.items():
            if " " in kunci:
                n += bobot * teks.count(f" {kunci} ")
            elif kunci.endswith("*"):
                awal = kunci[:-1]
                n += bobot * sum(c for t, c in hitung.items() if t.startswith(awal))
            else:
                n += bobot * hitung.get(kunci, 0)
        skor[suasana] = n
    return skor


def deteksi_suasana(caption: str) -> str:
    """Tebak suasana postingan dari caption. Kabar duka selalu didahulukan."""
    if not str(caption or "").strip():
        return "umum"
    skor = _skor_suasana(caption)
    bencana, wafat = skor["bencana"], skor["wafat"]
    if bencana >= 3 or wafat >= 3:
        return "wafat" if wafat > bencana else "bencana"
    lain = {s: n for s, n in skor.items() if s not in penilai.SUASANA_DUKA}
    terbaik = max(lain, key=lambda s: lain[s])
    return terbaik if lain[terbaik] >= 2 else "berita"


# ============================================================
#  SUBJEK & KATA KUNCI CAPTION
# ============================================================

_STOP = frozenset("""
yang di ke dari dan ini itu untuk dengan saat juga bisa lebih mau tapi semua jadi
dalam tentang akan ada sama baik serta karena oleh maka para deh ya ga gak lagi
sudah sekali aja nih si gue aku kita mereka suatu tidak dapat harus ingin supaya
agar sehingga namun tetapi sedangkan atau pada antara setiap beberapa tanpa
setelah sebelum sebagai selama ketika melalui mengenai terkait terhadap kembali
masih belum hanya cuma pula tersebut adalah secara sangat paling terus jangan
berarti menjadi merupakan seluruh banyak bagian heboh viral breaking news update
info alert cek simak tonton saksikan wow waw baru penting sumber instagram tiktok
youtube facebook repost official video caption postingan langsung hari kata hingga
kini saat sejak telah sedang masih bahkan juga lalu kemudian usai jelang tak tiap
the and for with this that from you your our are was were has have will just
minggu senin selasa rabu kamis jumat sabtu pukul wib wita wit tahun bulan
januari februari maret april mei juni juli agustus september oktober november desember
jl jln no gg ia dia beliau kami kalian anda sini sana situ begini begitu apa siapa mengapa kenapa
bagaimana dimana kapan berapa pun lah kah tuh dong sih kok kan
""".split())


def _kapital(t: str) -> bool:
    return bool(t) and t[0].isupper() and t.lower() not in _STOP


def _pecah_kalimat(teks: str) -> list[str]:
    return [k for k in re.split(r"(?<=[.!?:])\s+|\n+", teks) if k.strip()]


def _token(kalimat: str) -> list[str]:
    return re.findall(r"[A-Za-z][A-Za-z0-9'-]*", kalimat)


def _bersihkan_caption(caption: str) -> tuple[str, list[str]]:
    teks = re.sub(r"https?://\S+|www\.\S+|@[\w.]+", " ", str(caption or ""))
    tag = [h.lower() for h in re.findall(r"#(\w+)", teks)]
    tag = [h for h in tag if not (h.startswith("tv") or h in _STOP)]
    return re.sub(r"#\w+", " ", teks), tag


def ambil_subjek(caption: str, maks: int = 4) -> list[str]:
    """Ambil frasa topik dari caption, mis. 'KM Virgo', 'BRICS', 'Kemenkeu'.

    Prioritas: nama/entitas (kata berawalan kapital di tengah kalimat atau
    singkatan), apalagi yang juga jadi hashtag. Kalau kurang, ditambah kata
    kunci biasa (huruf kecil) yang paling spesifik.
    """
    teks, tag = _bersihkan_caption(caption)
    kalimat = _pecah_kalimat(teks)
    if not kalimat:
        return []

    def judul(kal: list[str]) -> bool:
        # Baris "Judul Yang Semua Katanya Kapital" tidak bisa dipercaya.
        huruf = [t for t in kal if t[0].isalpha()]
        return len(huruf) >= 3 and sum(t[0].isupper() for t in huruf) / len(huruf) > 0.7

    # Bentuk penulisan terbaik tiap kata: utamakan yang tidak ALLCAPS.
    bentuk: dict[str, str] = {}
    kapital_di_tengah: set[str] = set()
    for kal in kalimat:
        tok = _token(kal)
        is_judul = judul(tok)
        for i, t in enumerate(tok):
            low = t.lower()
            if low not in bentuk or (bentuk[low].isupper() and not t.isupper() and t[0].isupper()):
                bentuk[low] = t
            if i > 0 and not is_judul and t[0].isupper():
                kapital_di_tengah.add(low)

    def entitas(t: str, awal: bool, is_judul: bool) -> bool:
        # Angka ("Rp49", "U-23") dan huruf tunggal bukan subjek yang enak dibaca.
        if not _kapital(t) or len(t) < 2 or not re.fullmatch(r"[A-Za-z][A-Za-z'-]*", t):
            return False
        singkatan = t.isupper() and len(t) >= 2
        if singkatan or t.lower() in kapital_di_tengah:
            return True
        return not awal and not is_judul

    skor: Counter[str] = Counter()
    urutan: dict[str, int] = {}
    for no, kal in enumerate(kalimat):
        tok = _token(kal)
        is_judul = judul(tok)
        i = 0
        while i < len(tok):
            if not entitas(tok[i], i == 0, is_judul):
                i += 1
                continue
            j = i + 1
            while j < len(tok) and j - i < 3 and entitas(tok[j], False, is_judul):
                j += 1
            frasa = " ".join(bentuk.get(t.lower(), t) for t in tok[i:j])
            gabung = frasa.replace(" ", "").lower()
            nilai = 2 + (j - i - 1)
            if no == 0:
                nilai += 1
            if any(gabung == h or (len(gabung) >= 4 and gabung in h) for h in tag):
                nilai += 4
            skor[frasa] += nilai
            urutan.setdefault(frasa, len(urutan))
            i = j

    hasil: list[str] = []
    for frasa, _ in sorted(skor.items(), key=lambda x: (-x[1], urutan[x[0]])):
        rendah = frasa.lower()
        # Buang frasa yang sudah tercakup frasa lain ("Virgo" vs "KM Virgo").
        if any(rendah in h.lower() or h.lower() in rendah for h in hasil):
            continue
        hasil.append(frasa)
        if len(hasil) >= maks:
            return hasil

    # Kata biasa hanya dipakai kalau juga jadi hashtag (#bakso, #banjir):
    # kata kerja seperti "dinyatakan" bikin kalimat template jadi ngawur.
    for low in tag:
        if len(hasil) >= maks:
            break
        if low in bentuk and len(low) >= 4 and not any(low in h.lower() for h in hasil):
            hasil.append(bentuk[low] if bentuk[low][0].isupper() else low)
    return hasil


def kata_kunci(caption: str, maks: int = 15) -> list[str]:
    """Kata isi paling spesifik di caption (huruf kecil), untuk menilai relevansi."""
    teks, tag = _bersihkan_caption(caption)
    token = [t.lower() for t in _token(teks)]
    hitung = Counter(t for t in token if len(t) >= 4 and t not in _STOP)
    nilai: dict[str, float] = {}
    for t, c in hitung.items():
        n = c + (len(t) >= 6)
        if any(h == t or h.startswith(t) or t.startswith(h) for h in tag):
            n += 3
        nilai[t] = n
    return sorted(nilai, key=lambda t: -nilai[t])[:maks]


# ============================================================
#  BAHAN KOMENTAR
#  Inti ditulis berhuruf kecil di awal (kecuali diawali {S}) tanpa titik
#  akhir; pembuka diakhiri koma/tanda seru; penutup kalimat utuh.
# ============================================================

_PEMBUKA: dict[str, dict[str, list[str]]] = {
    "positif": {
        "umum": [
            "Wah,", "Wih,", "Jujur,", "Jujur ya,", "Asli,", "Serius,", "Sumpah,",
            "Beneran deh,", "Nah,", "Btw,", "Jujurly,", "Oke,", "Eh,", "Wah wah,", "Asli deh,", "Jujur aja,", "Serius deh,", "Min,", "Kak,", "Guys,", "Gaes,", "Nah ini,", "Bener-bener deh,", "Oh iya,",
        ],
        "berita": ["Noted,", "Oke noted,", "Penting nih,", "Wah penting," "Oh gitu,", "Makasih min,", "Update penting,", "Baru baca,",],
        "prestasi": ["MasyaAllah,", "Alhamdulillah,", "Keren!", "Bangga!", "Gokil,", "Merinding,", "Salut," "Ya ampun keren,", "Wow,", "Hebat,", "Proud,",],
        "edukasi": ["Noted,", "Save dulu,", "Baru tahu,", "Ilmu baru nih,", "Mantap," "Wah baru tahu,", "Oh gitu,", "Pantes,", "Makasih min,",],
        "hiburan": ["Gokil,", "Gila sih,", "Anjay,", "Asik,", "Mantap," "Wow,", "Seru,", "Ya ampun,", "Duh,",],
        "kuliner": ["Duh,", "Ya ampun,", "Ngiler,", "Aduh,", "Mantap," "Wow,", "Ya Allah,", "Laper,", "Astaga,",],
        "wisata": ["MasyaAllah,", "Cakep,", "Indah banget,", "Adem,", "Ya ampun," "Wow,", "Subhanallah,", "Ya Allah,", "Asri banget,",],
        "acara": ["Seru!", "Mantap,", "Asik,", "Gas," "Wow,", "Rame,", "Meriah,", "Keren,",],
        "olahraga": ["Gas!", "Mantap!", "Gokil,", "Merinding,", "Luar biasa," "Wow,", "Ayo,", "Hebat,", "Bangga,",],
        "bencana": [
            "Ya Allah,", "Ya Tuhan,", "Turut prihatin,", "Ikut sedih,",
            "Sedih banget bacanya,", "Nggak kebayang,", "Ikut deg-degan,", "Duh,",
            "Merinding bacanya,", "Prihatin banget,", "Astaghfirullah,", "Ya Rabb,", "Turut sedih,", "Nyesek bacanya,", "Duh sedih,", "Kasihan banget,", "Prihatin,", "Ikut berdoa,",
        ],
        "wafat": [
            "Innalillahi wa innailaihi rojiun,", "Turut berduka,", "Ya Allah,",
            "Sedih banget,", "Kaget dengarnya,", "Ikut kehilangan,", "Turut berduka cita,", "Innalillahi,", "Sedih dengarnya,", "Ya Rabb,", "Ikut sedih,", "Turut berduka sedalam-dalamnya,",
        ],
    },
    "netral": {
        "umum": [
            "Oke,", "Hmm,", "Noted,", "Sekadar catatan,", "Menarik,", "Oh begitu,",
            "Ternyata begitu,", "Baik,", "Oke noted,", "Jadi begitu,", "Oh gitu,", "Sebagai catatan,", "Kalau begitu,", "Okelah,", "Hmm oke,", "Oke juga,", "Begitu ya,", "Terima kasih,",
        ],
        "bencana": ["Turut prihatin,", "Prihatin,", "Ya Allah,", "Duh," "Semoga aman,", "Turut sedih,", "Waduh,", "Astaghfirullah,",],
        "wafat": ["Turut berduka,", "Innalillahi wa innailaihi rojiun,", "Turut berduka cita," "Turut berduka sedalam-dalamnya,", "Innalillahi,", "Ikut berduka,",],
    },
    "negatif": {
        "umum": [
            "Hmm,", "Jujur,", "Maaf ya,", "Sayang banget,", "Sebenarnya,",
            "Menurutku,", "Mohon maaf,", "Sejujurnya,", "Agak kecewa,", "Duh,", "Hmm jujur,", "Maaf nih,", "Sayangnya,", "Agak aneh,", "Kurang sreg,", "Jujur saja,", "Mohon dicek,", "Sejujurnya sih,",
        ],
        "bencana": ["Mohon maaf,", "Sayang sekali,", "Sejujurnya,", "Prihatin," "Miris,", "Sangat disayangkan,", "Maaf ya,", "Jujur,",],
    },
}

_PENUTUP: dict[str, dict[str, list[str]]] = {
    "positif": {
        "umum": [
            "Semangat terus!", "Sukses selalu ya.", "Ditunggu update selanjutnya.",
            "Makasih udah share.", "Lanjutkan!", "Respect.", "Top deh.", "Keep it up!",
            "Mantap pokoknya.", "Sehat-sehat semuanya.", "Salam dari sini.",
            "Pokoknya support.", "Makasih, min.", "Sehat selalu ya.", "Good job!", "Terus berkarya!", "Salam hangat.", "Mantul!", "Love it.", "Keren deh.", "Ditunggu kabar baiknya.", "Semoga berkah.", "Sukses terus, min!", "Gaskeun!",
        ],
        "berita": [
            "Semoga cepat ada kejelasan.", "Kita pantau terus.",
            "Semoga berimbang terus beritanya.", "Info kayak gini perlu disebar.",
            "Semoga jadi kebaikan buat semua.", "Terus kawal ya.", "Semoga tepat sasaran.", "Makasih update-nya.", "Rakyat menunggu.", "Semoga amanah.",
        ],
        "prestasi": [
            "Bangga banget!", "Terus naik level ya!", "Panutan banget.",
            "Inspirasi banget sih.", "Selamat ya!", "Mantap jiwa!", "Keren abis!", "Proud!", "Sukses terus!", "Luar biasa!",
        ],
        "edukasi": [
            "Langsung save.", "Ilmu banget ini.", "Auto share ke grup.",
            "Nambah wawasan banget.", "Bermanfaat banget.", "Thanks ilmunya.", "Jadi pinter dikit.", "Wajib dicoba.", "Penting buat semua.", "Simpan dulu.",
        ],
        "hiburan": [
            "Bikin mood naik.", "Auto replay.", "Hiburan banget ini.",
            "Ditunggu konten lainnya!", "Bikin hari makin seru.", "Bikin happy.", "Juara!", "Next dong!", "Gas terus kontennya!", "Hiburan murah meriah.",
        ],
        "kuliner": [
            "Auto laper.", "Masuk list wajib coba.", "Recook ah.",
            "Bikin pengen jajan.", "Makin pengen nyobain.", "Bikin lapar malam-malam.", "Wajib cobain.", "Enak pasti.", "Langsung ngiler.", "Weekend ke sana ah.",
        ],
        "wisata": [
            "Masuk wishlist!", "Butuh healing ke sana.", "Kapan-kapan wajib ke sana.",
            "Bikin pengen liburan.", "Cantik banget pemandangannya.", "Healing time!", "Indah banget ciptaan-Nya.", "Wajib dikunjungi.", "Ajak keluarga ah.", "Adem lihatnya.",
        ],
        "acara": [
            "Semoga lancar sampai akhir!", "Sukses acaranya!", "Ditunggu acara berikutnya.",
            "Pengen ikut meramaikan.", "Rame terus ya!", "Semoga meriah!", "Seru abis!", "Jangan lupa ajak-ajak.", "Gas datang!", "Sampai jumpa di sana!",
        ],
        "olahraga": [
            "Pertahankan!", "Terus berjuang!", "Bangga!",
            "Semangat buat laga berikutnya!", "Sehat-sehat para atlet.", "Jaga kondisi ya!", "Fokus laga berikutnya!", "Kami dukung!", "Tetap solid!", "Semangat juang!",
        ],
        "bencana": [
            "Tetap kuat ya semuanya.", "Doa terbaik dari sini.", "Semoga ada kabar baik.",
            "Kami ikut mendoakan.", "Semoga dimudahkan semuanya.", "Tetap hati-hati ya.",
            "Semangat buat tim di lapangan.", "Aamiin.", "Peluk jauh buat keluarga.",
            "Semoga cepat pulih.", "Doa terbaik buat semuanya.", "Semoga semua aman.", "Jaga diri baik-baik ya.", "Semoga segera ada titik terang.", "Kuat-kuat ya.", "Semoga lekas membaik.", "Bantu doa dari sini.", "Semoga cepat tertangani.",
        ],
        "wafat": [
            "Aamiin.", "Tenang di sana.", "Doa terbaik dari sini.",
            "Peluk jauh buat keluarga.", "Semoga keluarga diberi ketabahan.",
            "Semoga diberi tempat terbaik.", "Al-Fatihah.", "Husnul khotimah, aamiin.", "Selamat jalan.", "Tenang di sisi-Nya.", "Doa terbaik untuk beliau.",
        ],
    },
    "netral": {
        "umum": [
            "Kita lihat perkembangannya.", "Ditunggu kabar selanjutnya.",
            "Terima kasih infonya.", "Semoga ada update.", "Patut diikuti.", "Noted.",
            "Menarik untuk dipantau.", "Sekadar pendapat.", "Semoga jelas ke depannya.",
            "Kita tunggu saja.", "Semoga akurat.", "Perlu dicek lagi.", "Kita amati.", "Terima kasih.", "Semoga bermanfaat.", "Ditunggu datanya.", "Informasi yang cukup.", "Begitu saja.",
        ],
        "bencana": [
            "Semoga cepat ada kabar.", "Semoga semua aman.", "Ditunggu informasi resminya.",
            "Tetap waspada.", "Semoga tertangani dengan baik.", "Semoga lekas pulih.", "Tetap hati-hati.", "Doa untuk semua.", "Semoga cepat ditangani.",
        ],
        "wafat": ["Semoga keluarga diberi ketabahan.", "Doa terbaik.", "Aamiin." "Semoga tenang.", "Al-Fatihah.", "Turut mendoakan.",],
        "konten": [
            "Ditunggu konten berikutnya.", "Terima kasih infonya.", "Noted.",
            "Sekadar pendapat.", "Semoga ada lanjutannya.", "Menarik.", "Ditunggu.",
            "Semoga bermanfaat.", "Terima kasih.",
        ],
    },
    "negatif": {
        "umum": [
            "Semoga ke depan lebih baik.", "Mohon dievaluasi.", "Cuma masukan.",
            "Semoga jadi bahan evaluasi.", "Kritik membangun ya.", "Harap diperbaiki.",
            "Ditunggu klarifikasinya.", "Semoga didengar.", "Semoga lebih teliti lagi.",
            "Sekadar masukan.", "Tolong diperhatikan.", "Semoga ada perbaikan.", "Masukan saja.", "Mohon ditanggapi.", "Semoga lebih jelas.", "Harap ditinjau lagi.", "Semoga jadi perhatian.", "Itu saja.",
        ],
        "konten": [
            "Semoga ke depan lebih baik.", "Cuma masukan.", "Kritik membangun ya.",
            "Sekadar masukan.", "Semoga makin matang.", "Semoga didengar.", "Masukan saja.", "Semoga ada perbaikan.", "Itu saja.",
        ],
        "bencana": [
            "Semoga cepat dibenahi.", "Keselamatan harus nomor satu.",
            "Mohon dievaluasi.", "Semoga tidak terulang.", "Harus ada evaluasi.", "Semoga ada perbaikan.", "Tolong lebih sigap.", "Nyawa taruhannya.",
        ],
    },
}

_INTI: dict[str, dict[str, list[str]]] = {
    "positif": {
        "umum": [
            "kontennya keren, makasih udah share",
            "suka banget sama postingan ini",
            "selalu ditunggu konten-konten kayak gini",
            "makin seru aja kontennya",
            "semoga makin sukses akunnya",
            "postingan kayak gini bikin betah scroll",
            "keep up the good work, kontennya konsisten",
            "kualitas kontennya makin naik",
            "nggak pernah bosen lihat postingan di sini",
            "semoga makin banyak yang lihat konten ini",
            "kerja bagus, kelihatan niat bikinnya",
            "salut sama konsistensinya",
            "konten positif kayak gini yang dibutuhin",
        ],
        "bencana": [
            "semoga semua yang terdampak segera dapat bantuan dan kabar baik",
            "doa terbaik buat keluarga yang masih menunggu kabar",
            "salut buat petugas dan relawan yang turun langsung di lapangan",
            "semoga proses penanganan {S} dimudahkan dan cepat ada titik terang",
            "ikut mendoakan semua yang terlibat dalam kejadian {S}",
            "semoga keluarga korban diberi ketabahan menghadapi semua ini",
            "semoga petugas di lapangan selalu diberi keselamatan dan kekuatan",
            "kabar soal {S} bikin sesak, semoga ada keajaiban",
            "semoga bantuan cepat sampai ke semua yang membutuhkan",
            "pasti berat banget buat keluarga, semoga dikuatkan",
            "semoga kejadian {S} jadi yang terakhir dan jadi pelajaran buat keselamatan bersama",
            "terima kasih buat semua pihak yang sudah bergerak cepat membantu",
            "semoga cuaca bersahabat supaya penanganannya makin lancar",
            "nggak bisa bayangin rasanya jadi keluarga yang menunggu, semoga diberi kesabaran",
            "doa dari jauh buat semua yang sedang berjuang di lokasi",
            "semoga update soal {S} berikutnya membawa kabar baik",
            "kuat-kuat ya buat semua yang terdampak {S}",
            "ikut prihatin sama kejadian {S}, semoga semuanya cepat tertangani",
            "semoga evakuasi dan bantuannya berjalan aman",
            "semoga semua pihak kompak bantu penanganan {S}",
            "terima kasih sudah terus update kabarnya, semoga ada titik terang",
            "semoga trauma para korban cepat pulih dengan dukungan semua orang",
            "lindungi semua yang sedang bertugas di lapangan, aamiin",
            "semoga kebutuhan dasar para korban cepat terpenuhi",
            "hati ikut hancur lihat kabar {S}, semoga semuanya dikuatkan",
            "semoga ke depan keselamatan makin diperhatikan supaya tidak terulang",
            "doa terbaik buat semua yang terdampak, semoga cepat bangkit lagi",
            "semoga semua keluarga cepat dapat kepastian",
            "terima kasih buat warga sekitar yang ikut membantu",
            "semoga logistik dan tenaga medis cukup di lokasi",
            "ikut mendoakan dari jauh, semoga semuanya dilindungi",
            "semoga kabar soal {S} berikutnya lebih melegakan",
            "kebayang paniknya, semoga semua diberi ketenangan",
        ],
        "wafat": [
            "turut berduka sedalam-dalamnya untuk keluarga yang ditinggalkan",
            "semoga beliau mendapat tempat terbaik di sisi-Nya",
            "semoga keluarga yang ditinggalkan diberi ketabahan dan keikhlasan",
            "kabar duka ini bikin kaget, semoga diberi tempat terbaik",
            "semoga semua kebaikan beliau jadi amal jariyah",
            "kepergian beliau meninggalkan duka buat banyak orang",
            "doa terbaik untuk beliau dan keluarga",
            "semoga husnul khotimah dan keluarga diberi kekuatan",
            "kenangan baik tentang beliau akan selalu diingat",
            "ikut kehilangan, semoga beliau tenang di sana",
            "semoga diampuni segala khilafnya dan diterima amal baiknya",
            "terima kasih atas semua kebaikan yang sudah beliau berikan",
            "sedih banget dengar kabar ini, semoga keluarga dikuatkan",
            "semoga keluarga besar yang ditinggalkan diberi kesabaran",
            "doa dari jauh, semoga beliau beristirahat dengan damai",
            "rest in peace, semoga keluarganya diberi kekuatan",
            "semoga jalan beliau dilapangkan dan diterangi",
            "kehilangan yang berat, semoga semua yang ditinggalkan saling menguatkan",
            "semoga kebaikan beliau terus jadi inspirasi buat banyak orang",
            "turut berduka, semoga keluarga bisa melewati masa sulit ini",
            "semoga ditempatkan di tempat paling indah",
            "ikut mendoakan dari sini, semoga beliau tenang",
        ],
        "berita": [
            "makasih infonya, jadi lebih paham soal {S}",
            "semoga {S} benar-benar membawa manfaat buat masyarakat",
            "penting banget nih kabar soal {S}, semoga terus dikawal",
            "semoga kebijakan soal {S} dijalankan dengan transparan",
            "baru tahu detail soal {S}, makasih udah dirangkum",
            "semoga semua pihak bisa kerja sama soal {S} demi kebaikan bersama",
            "berita kayak gini perlu banget biar masyarakat makin melek",
            "semoga hasilnya bisa dirasakan langsung sama rakyat",
            "penyampaiannya jelas, jadi gampang ngikutin perkembangan {S}",
            "semoga langkah soal {S} ini jadi awal yang baik",
            "info soal {S} ini layak disebar biar makin banyak yang tahu",
            "suka sama rangkuman beritanya, singkat tapi padat",
            "semoga perkembangan {S} selanjutnya makin positif",
            "kita dukung yang terbaik buat negeri, semoga urusan {S} lancar",
            "akhirnya ada kabar jelas soal {S}",
            "semoga pengawasannya ketat biar tepat sasaran",
            "kabar soal {S} ini menarik buat diikuti terus",
            "terima kasih sudah update, beritanya cepat dan jelas",
            "semoga keputusan soal {S} membawa kebaikan buat semua",
            "jadi makin paham konteksnya, ditunggu update soal {S}",
            "semoga semua berjalan kondusif dan sesuai harapan",
            "harapannya {S} bisa jadi contoh yang baik",
            "semoga makin banyak kabar baik soal {S}",
            "nice info, pas banget lagi cari kabar soal {S}",
            "semoga apa yang direncanakan bisa terealisasi dengan baik",
            "apresiasi buat yang terus mengawal isu {S}",
            "beritanya informatif, semoga makin banyak yang peduli",
            "optimis {S} bisa membawa perubahan yang baik",
            "semoga semua pihak terkait bisa transparan soal {S}",
            "kabar kayak gini penting buat diketahui banyak orang",
            "semoga {S} makin dekat dengan kepentingan rakyat",
            "akhirnya ada perkembangan lagi soal {S}",
            "semoga eksekusinya secepat beritanya",
            "jadi tahu siapa saja yang terlibat soal {S}",
            "semoga pembahasan soal {S} melibatkan suara masyarakat",
            "beritanya singkat tapi langsung ke intinya",
            "semoga hasil akhirnya soal {S} memuaskan semua pihak",
            "semoga langkah ini bikin kondisi makin stabil",
            "update soal {S} selalu ditunggu",
            "semoga {S} bisa dikelola dengan bijak",
            "info kayak gini bikin kita lebih melek kebijakan",
            "semoga semua janji soal {S} ditepati",
            "senang ada media yang rajin update soal {S}",
            "semoga dampak positifnya cepat terasa sampai daerah",
            "suka sama cara beritanya disajikan, nggak bikin panik",
            "semoga urusan {S} berjalan sesuai rencana",
            "harapannya ada evaluasi berkala soal {S}",
            "bagus nih kalau {S} terus dipantau publik",
            "semoga nggak ada lagi simpang siur soal {S}",
            "penjelasan soal {S} ini bikin lebih tenang",
            "semoga keputusannya diambil dengan hati-hati",
            "senang lihat ada kemajuan soal {S}",
            "semoga {S} bisa jadi kabar baik buat banyak keluarga",
        ],
        "prestasi": [
            "selamat buat {S}, bangga banget lihatnya",
            "kerja keras memang nggak pernah bohong, selamat ya",
            "{S} keren banget, semoga makin sukses ke depannya",
            "ikut bangga sama pencapaian ini",
            "prestasi kayak gini harus banyak diangkat biar menginspirasi",
            "semoga {S} jadi motivasi buat yang lain",
            "nggak nyangka bisa sampai sejauh ini, keren parah",
            "selamat, hasilnya sepadan sama perjuangannya",
            "semoga pencapaian {S} ini jadi awal yang lebih besar",
            "bangga banget, semoga terus konsisten",
            "keren banget sih, perjuangannya kebayar lunas",
            "ini nih yang layak viral, selamat buat {S}",
            "salut sama dedikasinya, selamat ya",
            "semoga makin banyak prestasi kayak gini",
            "selamat buat semua yang terlibat di baliknya",
            "inspiratif banget, jadi semangat buat berusaha lebih keras",
            "pembuktian yang manis, selamat ya",
            "semoga {S} terus naik level",
            "proud banget sama {S}",
            "keren, ini pasti hasil kerja keras bertahun-tahun",
            "auto merinding baca kabar prestasi ini",
            "semoga jadi pemacu buat generasi selanjutnya",
            "pantas banget dapat apresiasi setinggi ini",
            "selamat, semoga berkah dan makin rendah hati",
            "terharu lihat perjuangannya akhirnya berbuah manis",
        ],
        "edukasi": [
            "makasih ilmunya, penjelasan soal {S} gampang dipahami",
            "baru tahu soal {S}, ternyata sepenting itu",
            "langsung praktik ah, tipsnya simpel banget",
            "penjelasannya runtut, cocok buat pemula",
            "info soal {S} ini harusnya diajarin dari dulu",
            "save dulu biar nggak lupa soal {S}",
            "bermanfaat banget, jadi lebih paham soal {S}",
            "suka cara jelasinnya, nggak bertele-tele",
            "konten edukasi kayak gini yang kita butuhin",
            "jadi kepikiran buat nyoba, makasih tipsnya",
            "fakta soal {S} ini baru aku tahu sekarang",
            "semoga makin banyak konten soal {S} kayak gini",
            "jelas banget, langsung kebayang praktiknya",
            "ilmu baru hari ini, makasih udah berbagi",
            "kontennya daging semua",
            "pas banget lagi butuh info soal {S}",
            "simpel tapi ngena banget penjelasannya",
            "ini sih wajib di-share ke teman-teman",
            "terima kasih, jadi nggak salah kaprah lagi soal {S}",
            "ditunggu part selanjutnya soal {S}",
            "ternyata caranya gampang, selama ini ribet sendiri",
            "materi kayak gini harusnya lebih sering muncul di beranda",
            "langsung kepake buat sehari-hari",
            "semoga makin banyak yang sadar pentingnya {S}",
        ],
        "hiburan": [
            "kontennya bikin senyum-senyum sendiri",
            "{S} selalu berhasil bikin mood naik",
            "nggak bosen nontonnya, diulang terus",
            "vibesnya dapet banget",
            "ini sih hiburan terbaik hari ini",
            "seru banget, ditunggu kelanjutan soal {S}",
            "kreatif banget idenya",
            "auto replay berkali-kali",
            "suka banget sama energinya",
            "{S} makin keren aja dari hari ke hari",
            "nontonnya bikin lupa waktu",
            "editannya rapi, enak banget ditonton",
            "konten kayak gini yang bikin betah scroll",
            "nggak nyangka bakal sebagus ini",
            "fix ini bakal rame",
            "suka banget sama konsepnya",
            "{S} emang nggak pernah gagal menghibur",
            "ditunggu konten soal {S} berikutnya",
            "pecah banget sih ini",
            "langsung jadi favorit",
            "enak banget ditonton pas lagi suntuk",
            "detailnya niat banget, salut",
            "bikin hari yang capek jadi lebih ringan",
            "auto share ke grup sebelah",
        ],
        "kuliner": [
            "kelihatan enak banget, jadi pengen nyobain",
            "ngiler lihatnya, {S} masuk list wajib coba",
            "tampilannya menggoda banget",
            "jam segini lihat ginian bahaya banget",
            "resepnya kelihatan simpel, mau coba bikin di rumah",
            "{S} emang nggak pernah salah",
            "porsinya mantap, kelihatan worth it",
            "pengen langsung meluncur ke sana",
            "dari videonya aja udah kebayang rasanya",
            "auto laper lihatnya",
            "boleh minta info lokasinya?",
            "harganya ramah kantong nggak nih?",
            "kayaknya cocok banget buat makan bareng keluarga",
            "teksturnya kelihatan juara",
            "kombinasi rasanya pasti mantap",
            "versi ini kelihatan beda dari yang lain",
            "langsung pengen recook",
            "fix weekend ini harus nyobain",
            "kelihatan fresh banget bahan-bahannya",
            "cara masaknya bikin penasaran",
            "dijamin nambah nasi ini mah",
            "aromanya kayak kecium sampai sini",
            "semoga makin laris ya",
        ],
        "wisata": [
            "pemandangannya cantik banget, {S} masuk wishlist",
            "adem banget lihatnya",
            "kayaknya cocok buat healing di {S}",
            "nggak nyangka ada tempat sebagus ini",
            "langsung pengen packing",
            "{S} emang nggak ada obat indahnya",
            "boleh minta info rute ke sana?",
            "semoga tempatnya tetap terjaga kebersihannya",
            "warna langitnya juara",
            "liburan berikutnya wajib ke {S}",
            "suasananya tenang banget",
            "berasa ikut jalan-jalan lewat videonya",
            "indah banget, semoga makin dikenal banyak orang",
            "bikin kangen liburan",
            "spot fotonya keren semua",
            "{S} makin cantik aja",
            "jadi pengen ajak keluarga ke sana",
            "pas banget buat lepas penat",
            "tiket masuknya berapa ya?",
            "alamnya masih asri banget",
            "semoga wisatanya makin maju dan warganya makin sejahtera",
            "fix ini surga tersembunyi",
        ],
        "acara": [
            "seru banget acaranya, semoga lancar sampai akhir",
            "{S} rame banget, pengen ikut",
            "semoga acara {S} sukses besar",
            "ditunggu keseruan {S} berikutnya",
            "suasananya meriah banget",
            "panitianya keren, acaranya rapi",
            "nyesel nggak dateng",
            "semoga tahun depan ada lagi",
            "{S} selalu ditunggu tiap tahun",
            "energinya kerasa sampai sini",
            "semoga semua yang datang pulang bawa kenangan seru",
            "dokumentasinya keren banget",
            "acara kayak gini perlu sering diadain",
            "sukses terus buat {S}",
            "lihat videonya aja udah seru, apalagi datang langsung",
            "semoga lancar dan aman sampai selesai",
            "kebersamaannya kerasa banget",
            "kapan diadain lagi nih?",
            "keren konsep acaranya",
            "semoga makin banyak yang ikut meramaikan {S}",
        ],
        "olahraga": [
            "semangat terus buat timnya",
            "perjuangannya luar biasa, apa pun hasilnya tetap bangga",
            "semoga makin solid di laga berikutnya",
            "merinding lihat semangat juangnya",
            "dukungan penuh dari sini",
            "semoga para pemain selalu sehat dan bebas cedera",
            "kerja samanya makin rapi",
            "nggak sabar nunggu pertandingan selanjutnya",
            "mental bertandingnya patut diacungi jempol",
            "terus berkembang, jangan cepat puas",
            "semoga hasil terbaik di laga selanjutnya",
            "atmosfer pertandingannya kerasa banget",
            "bangga lihat perjuangannya",
            "fokus dan konsisten, pasti bisa",
            "semoga pelatih dan pemain terus kompak",
            "momen kayak gini yang bikin cinta olahraga",
            "salut sama kerja kerasnya di lapangan",
            "semoga bisa jadi inspirasi atlet muda",
            "semangat buat persiapan selanjutnya",
            "apa pun hasilnya, kita tetap dukung",
            "mainnya lepas banget",
        ],
    },
    "netral": {
        "umum": [
            "jadi tahu perkembangan terbaru soal {S}",
            "info soal {S} ini cukup jelas",
            "baru tahu soal {S} dari postingan ini",
            "topik {S} memang lagi banyak dibahas belakangan ini",
            "sumber datanya dari mana ya soal {S}?",
            "menarik untuk dilihat bagaimana kelanjutan {S}",
            "ada detail lain yang belum disebut soal {S}?",
            "kalau dibandingkan tahun lalu, kondisinya bagaimana ya?",
            "perlu dilihat juga dampaknya ke masyarakat",
            "informasinya cukup ringkas",
            "kira-kira kapan ada kabar lanjutan soal {S}?",
            "masih ada beberapa hal yang perlu diperjelas",
            "sudut pandangnya cukup berimbang",
            "semoga ada penjelasan lebih lengkap soal {S}",
            "angka dan faktanya bisa dicek ulang di sumber resmi",
            "ini bisa jadi bahan diskusi yang menarik",
            "pendapat orang soal {S} pasti beragam",
            "jadi kebayang gambaran besarnya",
            "boleh dijelaskan lagi bagian {S}-nya?",
            "kita lihat saja bagaimana realisasinya",
            "semoga informasi soal {S} terus diperbarui",
            "isu {S} ini memang perlu diikuti",
            "ringkasan yang cukup membantu untuk memahami {S}",
            "ada pihak lain yang sudah memberi tanggapan soal {S}?",
            "penjelasannya cukup, walau masih umum",
            "konteksnya jadi lebih jelas setelah baca ini",
            "keputusan akhirnya soal {S} masih ditunggu",
        ],
        "bencana": [
            "semoga penanganan {S} berjalan cepat dan tepat",
            "ditunggu informasi resmi soal perkembangan {S}",
            "semoga data korban segera diperbarui secara jelas",
            "turut prihatin atas kejadian ini",
            "semoga informasi untuk keluarga disampaikan dengan cepat",
            "kondisi di lapangan kabarnya cukup sulit, semoga petugas tetap aman",
            "semoga ada evaluasi supaya kejadian serupa tidak terulang",
            "perlu informasi jalur bantuan yang bisa diakses masyarakat",
            "ada posko yang bisa dihubungi untuk informasi soal {S}?",
            "semoga cuaca membaik supaya penanganan lebih mudah",
            "kronologinya jadi lebih jelas, semoga ada update berikutnya",
            "tetap waspada untuk warga di sekitar lokasi",
            "semoga semua pihak berkoordinasi dengan baik",
            "doa untuk semua yang terdampak",
            "penyebab kejadian {S} semoga segera diketahui",
            "semoga bantuan tersalurkan merata",
        ],
        "wafat": [
            "turut berduka untuk keluarga yang ditinggalkan",
            "semoga keluarga diberi ketabahan",
            "semoga beliau beristirahat dengan tenang",
            "kabar duka ini cukup mengejutkan",
            "doa terbaik untuk beliau dan keluarga",
            "semoga amal baiknya diterima",
            "semoga keluarga besar yang ditinggalkan diberi kekuatan",
            "semoga beliau mendapat tempat terbaik",
            "turut berduka cita sedalam-dalamnya",
            "semoga keluarga bisa melewati masa sulit ini",
            "kenangan baik tentang beliau akan diingat banyak orang",
        ],
        # Postingan non-berita (kuliner, hiburan, olahraga, dst.).
        "konten": [
            "informasinya cukup membantu",
            "baru tahu soal {S} dari sini",
            "boleh tahu detail lengkapnya soal {S}?",
            "kontennya cukup jelas dan ringkas",
            "menarik juga, jadi pengen tahu lebih lanjut soal {S}",
            "lumayan, ditunggu konten berikutnya",
            "ada info tambahan soal {S}?",
            "kalau dibandingkan yang sebelumnya, ini cukup berbeda",
            "durasinya pas, isinya cukup padat",
            "penasaran pendapat yang lain soal {S}",
            "oke, jadi tahu gambarannya",
            "sumbernya dari mana ya?",
            "cukup informatif untuk yang baru tahu soal {S}",
            "lumayan buat referensi",
            "ini berlaku umum atau cuma kasus tertentu?",
            "ditunggu kelanjutannya soal {S}",
        ],
    },
    "negatif": {
        "umum": [
            "sayangnya penjelasan soal {S} masih kurang lengkap",
            "bahasan soal {S} masih terlalu dangkal",
            "harusnya soal {S} dibahas lebih detail",
            "datanya belum cukup kuat untuk menyimpulkan soal {S}",
            "masih banyak pertanyaan yang belum terjawab soal {S}",
            "judulnya menarik, tapi isinya belum menjawab",
            "kayaknya perlu sumber yang lebih jelas",
            "kurang setuju sama cara penyampaian soal {S} di sini",
            "kebijakan soal {S} perlu dikaji ulang dampaknya",
            "realisasinya yang perlu dibuktikan, bukan cuma janji",
            "transparansi soal {S} masih dipertanyakan",
            "rasanya ini belum menyentuh akar masalah",
            "berharap ada penjelasan yang lebih jujur soal {S}",
            "beritanya terkesan buru-buru, detailnya kurang",
            "masyarakat butuh kejelasan, bukan sekadar pengumuman",
            "perlu pengawasan ketat biar urusan {S} nggak melenceng",
            "kok informasinya setengah-setengah ya",
            "angka soal {S} butuh rincian yang lebih terbuka",
            "semoga bukan cuma ramai di awal lalu hilang",
            "penyampaiannya membingungkan, perlu diperjelas",
            "belum kelihatan manfaat nyatanya buat masyarakat",
            "perlu ada evaluasi serius soal {S}",
            "agak kecewa, ekspektasinya lebih dari ini",
            "konteks penting soal {S} malah nggak dibahas",
            "harusnya ada data pembanding biar lebih fair",
            "prioritasnya kurang tepat menurutku",
            "jangan sampai urusan {S} cuma jadi wacana",
            "masih jauh dari harapan banyak orang",
        ],
        "bencana": [
            "semoga ada evaluasi serius supaya kejadian {S} tidak terulang",
            "standar keselamatannya perlu diperiksa ulang",
            "informasi resmi ke keluarga harusnya lebih cepat",
            "penanganan {S} semoga lebih sigap lagi",
            "perlu kejelasan siapa yang bertanggung jawab atas pengawasan",
            "peringatan dini seharusnya bisa lebih optimal",
            "kesiapan alat dan personel perlu ditingkatkan",
            "jangan sampai pelajaran dari {S} terlupakan lagi",
            "koordinasi antarpihak kelihatannya masih perlu dibenahi",
            "keselamatan publik harus jadi prioritas utama",
            "semoga hasil investigasi {S} dibuka ke publik",
            "kejadian serupa sudah sering, kapan ada perbaikan nyata?",
            "kasihan keluarga yang menunggu kepastian, informasinya harus jelas",
            "semoga bantuan tidak lambat sampai ke lokasi",
        ],
        "konten": [
            "sayangnya kontennya terlalu singkat",
            "ekspektasinya lebih dari ini soal {S}",
            "agak kurang detail, padahal topiknya menarik",
            "penyampaiannya bisa lebih rapi lagi",
            "rasanya ada yang kurang dari pembahasan {S} ini",
            "judulnya bikin penasaran, isinya belum memuaskan",
            "kualitas videonya bisa ditingkatkan lagi",
            "kurang greget dibanding konten sebelumnya",
            "infonya kurang lengkap, jadi masih bingung",
            "harusnya bagian pentingnya dibahas lebih lama",
            "sedikit kecewa, kirain bakal lebih seru",
            "masih bisa digali lebih dalam soal {S}",
            "editannya agak terburu-buru",
            "kurang setuju sama penilaian soal {S} di sini",
            "semoga konten berikutnya lebih matang",
        ],
    },
}

# Suasana non-berita: tone netral/negatif memakai kelompok "konten".
_SUASANA_KONTEN = frozenset({
    "prestasi", "edukasi", "hiburan", "kuliner", "wisata", "acara", "olahraga",
})

_EMOJI: dict[str, tuple[list[str], float]] = {
    "positif": (["🔥", "👏", "🙌", "😍", "💯", "✨", "👍"], 0.25),
    "positif-duka": (["🙏", "🤲"], 0.35),
    "netral": ([], 0.0),
    "netral-duka": (["🙏"], 0.2),
    "negatif": ([], 0.0),
    "negatif-duka": (["🙏"], 0.15),
}


def _bahan(tone: str, suasana: str) -> tuple[str, str, list[str], list[str], list[str], str]:
    """(tone_dipakai, kunci, pembuka, inti, penutup, kunci_emoji) untuk tone+suasana.

    Tone negatif pada kabar wafat sengaja dialihkan ke netral: mengkritik
    postingan duka cita tidak pernah pantas.
    """
    tone = _tone(tone)
    if suasana not in SUASANA:
        suasana = "berita"
    duka = suasana in penilai.SUASANA_DUKA
    if tone == "negatif" and suasana == "wafat":
        tone = "netral"
    if tone == "positif":
        kunci = suasana
    elif suasana in _INTI[tone]:
        kunci = suasana
    else:
        kunci = "konten" if suasana in _SUASANA_KONTEN else "umum"
    if tone == "positif" and not duka and kunci != "umum":
        # Pembuka/penutup santai dipakai bersama, ditambah yang khas suasananya.
        pembuka = _PEMBUKA[tone]["umum"] + _PEMBUKA[tone].get(kunci, [])
        penutup = _PENUTUP[tone]["umum"] + _PENUTUP[tone].get(kunci, [])
    else:
        pembuka = list(_PEMBUKA[tone].get(kunci) or _PEMBUKA[tone]["umum"])
        penutup = list(_PENUTUP[tone].get(kunci) or _PENUTUP[tone]["umum"])
    emoji = f"{tone}-duka" if duka else tone
    return tone, kunci, pembuka, list(_INTI[tone][kunci]), penutup, emoji


def _kata_isi(teks: str) -> set[str]:
    return {k for k in penilai.kata(teks) if len(k) >= 4}


def _bentrok(a: str, b: str) -> bool:
    """True kalau dua bagian berbagi kata isi ("Semoga ... semoga ...")."""
    return bool(_kata_isi(a) & _kata_isi(b))


def _siapkan_inti(inti: list[str], ada_subjek: bool) -> list[str]:
    if ada_subjek:
        return inti
    # Tanpa subjek: "soal {S}" jadi "soal ini"; {S} lain tidak bisa dipakai.
    hasil = []
    for t in inti:
        t = t.replace("soal {S}", "soal ini")
        if "{S}" not in t:
            hasil.append(t)
    return hasil


def _rakit(inti: str, subjek: str, pembuka: str, penutup: str, emoji: str) -> str:
    isi = inti.replace("{S}", subjek)
    for pakai_pembuka, pakai_penutup in ((True, True), (False, True), (True, False), (False, False)):
        p = pembuka if pakai_pembuka else ""
        q = penutup if pakai_penutup else ""
        if p:
            badan = isi[0].upper() + isi[1:] if p.endswith(("!", ".")) else isi
            teks = f"{p} {badan}"
        else:
            teks = isi[0].upper() + isi[1:]
        if q:
            if not teks.endswith((".", "!", "?")):
                teks += "."
            teks = f"{teks} {q}"
        if emoji:
            teks = f"{teks} {emoji}"
        if len(penilai.kata(teks)) <= penilai.MAKS_KATA - 1:
            return teks
    return teks


def buat_komentar(
    caption: str,
    jumlah: int = 3,
    tone: str = "positif",
    hindari: Iterable[str] = (),
    suasana: str | None = None,
) -> list[str]:
    """Rakit ``jumlah`` komentar unik dari bank untuk caption ini."""
    try:
        jumlah = max(0, int(jumlah))
    except (TypeError, ValueError):
        jumlah = 3
    if jumlah == 0:
        return []
    suasana = suasana if suasana in SUASANA else deteksi_suasana(caption)
    _t, _k, pembuka, inti, penutup, kunci_emoji = _bahan(tone, suasana)
    pilihan_emoji, peluang_emoji = _EMOJI[kunci_emoji]
    subjek = ambil_subjek(caption)
    inti = _siapkan_inti(inti, bool(subjek))
    hindari = [h for h in hindari if h]

    def satu(idx: int) -> str:
        dasar = inti[idx]
        # Subjek utama (skor tertinggi) dipakai separuh waktu.
        s = (subjek[0] if random.random() < 0.5 else random.choice(subjek)) if subjek else ""
        isi = dasar.replace("{S}", s)
        p = random.choice(pembuka) if pembuka and random.random() < 0.55 else ""
        q = random.choice(penutup) if penutup and random.random() < 0.5 else ""
        if p and _bentrok(p, isi):
            p = ""
        if q and (_bentrok(q, isi) or (p and _bentrok(p, q))):
            q = ""
        e = random.choice(pilihan_emoji) if pilihan_emoji and random.random() < peluang_emoji else ""
        return _rakit(dasar, s, p, q, e)

    hasil: list[str] = []
    terpakai: set[int] = set()
    percobaan = 0
    while len(hasil) < jumlah and percobaan < jumlah * 80 + 200:
        percobaan += 1
        sisa = [i for i in range(len(inti)) if i not in terpakai] or list(range(len(inti)))
        idx = random.choice(sisa)
        teks = satu(idx)
        if penilai.periksa(teks, suasana, caption):
            continue
        if any(penilai.kemiripan(teks, h) >= 0.55 for h in hasil + hindari):
            continue
        hasil.append(teks)
        terpakai.add(idx)

    # Target sangat besar: longgarkan syarat kemiripan, tetap hindari kembar persis.
    sudah = {h.lower() for h in hasil}
    percobaan = 0
    while len(hasil) < jumlah and percobaan < jumlah * 50:
        percobaan += 1
        teks = satu(random.randrange(len(inti)))
        if teks.lower() not in sudah:
            sudah.add(teks.lower())
            hasil.append(teks)
    while len(hasil) < jumlah and hasil:
        hasil.append(random.choice(hasil))
    return hasil[:jumlah]


def jumlah_variasi(tone: str, suasana: str, n_subjek: int = 4) -> int:
    """Hitung berapa komentar unik yang bisa dirakit (tanpa menghitung emoji)."""
    _t, _k, pembuka, inti, penutup, _e = _bahan(tone, suasana)
    total = 0
    for dasar in inti:
        kali = n_subjek if "{S}" in dasar else 1
        p_ok = 1 + sum(1 for p in pembuka if not _bentrok(p, dasar))
        q_ok = 1 + sum(1 for q in penutup if not _bentrok(q, dasar))
        total += kali * p_ok * q_ok
    return total


def total_variasi(n_subjek: int = 4) -> int:
    """Jumlah seluruh komentar unik di semua tone dan suasana."""
    # Beberapa pasangan tone+suasana memakai bahan yang sama (mis. netral
    # kuliner & netral hiburan sama-sama "konten"), jadi dihitung sekali saja.
    wakil: dict[tuple[str, str], tuple[str, str]] = {}
    for tone in TONES:
        for suasana in SUASANA:
            t, kunci, *_ = _bahan(tone, suasana)
            wakil.setdefault((t, kunci), (tone, suasana))
    return sum(jumlah_variasi(t, s, n_subjek) for t, s in wakil.values())
