import test from 'node:test';
import assert from 'node:assert/strict';
import { bankComments } from '../server/instagram.mjs';
test('violent incidents involving athletes use support for safety instead of sports celebration', async () => {
  const result = await bankComments({ caption: 'Ketua Umum PSSI Erick Thohir mengecam penyerangan bus rombongan pemain Elite Pro Academy Persib Bandung U-18. Tindakan kriminal ini tidak bisa ditoleransi. Para atlet dan pelatih bersiap mengikuti pertandingan sepak bola liga.', count: 8, tone: 'positif' });
  assert.equal(result.suasana, 'insiden'); assert.ok(result.comments.length >= 2);
  for (const text of result.comments) assert.doesNotMatch(text, /bangga|pertahankan|keren|mantap|kompak|juara|🔥|👏/i);
});
test('ordinary sports attacks retain sports context while disasters outrank food or sport', async () => {
  const sport = await bankComments({ caption: 'Serangan timnas menghasilkan gol dalam pertandingan sepak bola liga.', count: 2, tone: 'positif' });
  assert.equal(sport.suasana, 'olahraga');
  const disaster = await bankComments({ caption: 'Warga membawakan makanan dan nasi untuk tim pemadam kebakaran hutan. Atlet membantu evakuasi korban.', count: 2, tone: 'positif' });
  assert.equal(disaster.suasana, 'bencana');
  const crime = await bankComments({ caption: 'Dugaan pencopetan di pusat wisata saat festival konser musik.', count: 2, tone: 'positif' });
  assert.equal(crime.suasana, 'insiden');
});

test('BPA and contamination risks outrank food praise without adding medical advice', async () => {
  const result = await bankComments({ caption: 'Banyak orang mungkin belum menyadari bahwa paparan BPA (Bisphenol A), bahan kimia pada produk plastik dan kemasan makanan, menjadi perhatian serius bagi kesehatan. Makanan dan minuman dapat terpapar saat disimpan.', count: 8, tone: 'positif' });
  assert.equal(result.suasana, 'risiko'); assert.ok(result.comments.length >= 2);
  for (const text of result.comments) assert.doesNotMatch(text, /mantap|resep|ngiler|lezat|coba bikin|pasti|menyembuhkan|obat|dosis/i);
  const food = await bankComments({ caption: 'Resep masakan nasi ayam lezat di restoran, menu makanan sehat.', count: 2, tone: 'positif' });
  assert.equal(food.suasana, 'kuliner');
});

test('cross-border fire haze outranks incidental mentions of sport and outdoor activity', async () => {
  const result = await bankComments({ caption: 'Kabut asap karhutla dari Indonesia mengepung Singapura. Marina Bay Sands nyaris tidak terlihat akibat asap pekat. Indeks kualitas udara memburuk. Warga mengurangi olahraga di luar ruangan.', konteks: 'sepak bola, atlet, pertandingan', count: 5, tone: 'positif' });
  assert.equal(result.suasana, 'bencana');
  for (const text of result.comments) assert.doesNotMatch(text, /bangga|pertahankan|laga|gol|juara|mantap/i);
});

test('ordinary OCR artifacts cannot override the main caption with a different content category', async () => {
  const result = await bankComments({ caption: 'Pemerintah menyampaikan pembaruan kebijakan dan anggaran daerah.', konteks: 'F1 atlet sepak bola pertandingan gol liga', count: 2, tone: 'positif' });
  assert.equal(result.suasana, 'berita');
  const imageOnly = await bankComments({ caption: '', konteks: 'Kabut asap karhutla menyelimuti kota.', count: 2, tone: 'positif' });
  assert.equal(imageOnly.suasana, 'bencana');
});

test('a theft described indirectly is an incident even when korban is repeated', async () => {
  const result = await bankComments({ caption: 'Pengunjung dilaporkan kehilangan iPhone. Seorang perempuan diduga mengambil ponsel dari tas korban. Korban belum membuat laporan polisi. Rekaman CCTV diperiksa kepolisian.', count: 3, tone: 'positif' });
  assert.equal(result.suasana, 'insiden');
  for (const text of result.comments) assert.doesNotMatch(text, /keluarga|evakuasi|trauma|medis|makanan/i);
});
test('general disaster drafts do not invent family, trauma or evacuation details', async () => {
  const result = await bankComments({ caption: 'Kabut asap karhutla membuat kualitas udara tidak sehat.', count: 8, tone: 'positif' });
  assert.equal(result.suasana, 'bencana');
  for (const text of result.comments) assert.doesNotMatch(text, /keluarga|trauma|evakuasi|medis|obat|panik|kebutuhan dasar/i);
});

test('a blackout receives recovery wishes and generic news does not invent positive effects or policies', async () => {
  const outage = await bankComments({ caption: 'Pemadaman listrik total melanda Batam dan Bintan. Mal gelap gulita hingga malam.', count: 3, tone: 'positif' });
  assert.equal(outage.suasana, 'bencana');
  const news = await bankComments({ caption: 'Berikut kabar terbaru dari daerah hari ini.', count: 8, tone: 'positif' });
  assert.equal(news.suasana, 'berita');
  for (const text of [...outage.comments, ...news.comments]) assert.doesNotMatch(text, /dampak positif|kebijakan|keputusan|optimis|membawa manfaat|{S}/i);
});


test('fatal armed attacks receive safety support while a solidarity event stays informational', async () => {
  const attack = await bankComments({ caption: 'Houthi menyerang Arab Saudi. Bandara membara. Serangan menewaskan 12 orang. Seberapa kuat senjata dan rudal yang mereka miliki?', count: 5, tone: 'positif' });
  assert.equal(attack.suasana, 'insiden');
  for (const text of attack.comments) assert.doesNotMatch(text, /bangga|hebat|mantap|beliau|amal|juara/i);
  const solidarity = await bankComments({ caption: 'Aksi solidaritas untuk Palestina sempat berhenti untuk pengantin baru. Massa menyerukan penghentian genosida dan pasokan senjata.', count: 3, tone: 'positif' });
  assert.equal(solidarity.suasana, 'berita');
  for (const text of solidarity.comments) assert.doesNotMatch(text, /tidak terulang|beliau|janji|dampak positif/i);
});
