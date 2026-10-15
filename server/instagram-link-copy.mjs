// Menu "Ambil link postingan": membaca beberapa postingan terbaru sebuah channel lalu menyalin
// tautannya supaya bisa ditempel ke kolom target Auto komen.
//
// Instagram tidak memperlihatkan kode tautan sebuah postingan di mana pun selain baris
// "Salin tautan" pada lembar share, dan papan klip HP tidak bisa dibaca langsung lewat ADB
// (Android 14 Samsung tidak menyediakan perintahnya; diuji 15 Okt 2026). Jadi tautan dibaca
// kembali dengan menempelkannya ke kolom pencarian di lembar share itu sendiri - kolom milik
// Instagram, tidak mengirim apa pun, dan dibersihkan lagi setelah dibaca. Diuji di Samsung 12:
// tautan terbaca persis sebagai https://www.instagram.com/reel/Dee1i94uTmb/?vrfl=...
//
// Seluruh alur ini tidak menyukai, menyimpan, membagikan, atau mengomentari apa pun. Yang
// disentuh hanya: tombol bagikan, baris "Salin tautan", kolom pencarian, tempel, tombol bersihkan.
import { NetworkError } from './comment-errors.mjs';
import { copyLinkButton, shareButton, shareClearButton, shareSearchField, shareSheetOpen, offlineNotice } from './instagram-core.mjs';
import { instagramTarget } from '../src/instagram-target.mjs';

// Membuka lembar share pada postingan yang sedang terbuka dan menunggu isinya siap.
async function openShareSheet(manager, serial) {
  const nodes = await manager.ui(serial);
  if (offlineNotice(nodes)) throw new NetworkError('Instagram di HP sedang offline; link tidak dapat diambil.');
  const button = shareButton(nodes);
  if (!button) throw new NetworkError('Tombol bagikan tidak terbaca pada postingan ini.');
  await manager.tap(serial, button);
  let sheet = nodes;
  for (let i = 0; i < 10; i++) {
    await manager.wait(i ? 700 : 400);
    sheet = await manager.ui(serial);
    if (copyLinkButton(sheet) || shareSheetOpen(sheet)) break;
  }
  return sheet;
}

// Menyalin tautan postingan yang sedang terbuka, lalu membacanya kembali.
export async function copyOpenPostLink(manager, serial) {
  // Lembar share yang tertinggal dari percobaan sebelumnya membuat tombol bagikan tidak terbaca,
  // jadi keadaan dibersihkan lebih dulu.
  await manager.closeShareSheet(serial).catch(() => {});
  let sheet = await openShareSheet(manager, serial);
  const copy = copyLinkButton(sheet);
  if (!copy) {
    await manager.closeShareSheet(serial).catch(() => {});
    throw new NetworkError('Baris "Salin tautan" tidak ada di lembar bagikan; link postingan ini dilewati.');
  }
  await manager.tap(serial, copy);
  await manager.wait(900);
  // Lembar dibuka sekali lagi hanya untuk membaca kembali isi papan klip.
  sheet = await openShareSheet(manager, serial);
  const field = shareSearchField(sheet);
  if (!field) {
    await manager.closeShareSheet(serial).catch(() => {});
    throw new NetworkError('Kolom pencarian lembar bagikan tidak terbaca; link tidak dapat dipastikan.');
  }
  await manager.tap(serial, field);
  await manager.wait(600);
  await manager.paste(serial).catch(() => {});
  await manager.wait(900);
  const pasted = await manager.ui(serial);
  const raw = (shareSearchField(pasted)?.text || '').trim();
  const clear = shareClearButton(pasted);
  if (clear) await manager.tap(serial, clear).catch(() => {});
  await manager.closeShareSheet(serial).catch(() => {});
  let parsed = null;
  try { parsed = raw ? instagramTarget(raw) : null; } catch {}
  if (parsed?.kind !== 'post') {
    throw new NetworkError(`Isi papan klip terbaca "${raw.slice(0, 60)}", bukan link postingan; link ini dilewati.`);
  }
  return parsed;
}
