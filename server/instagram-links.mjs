import { ManualActionError, NetworkError } from './comment-errors.mjs';
import { byId, commentButton, composerAccount, contextMenu, feedPreview, postFingerprint, validUsername } from './instagram-core.mjs';
import { instagramTarget } from '../src/instagram-target.mjs';

const nodeText = node => (node.text || node['content-desc'] || '').trim();
export function linkedPostOwner(nodes) {
  const owner = nodeText(byId(nodes, 'row_feed_photo_profile_name') || {}).toLowerCase();
  return validUsername(owner) ? owner : null;
}
// Menu tekan-lama pada layar postingan/reel membuat UI Automator hanya memuat isi menu, jadi
// halaman yang sudah terbuka terbaca seperti belum terbuka. Menu itu ditutup dari layar yang
// sudah dibaca (tanpa ketukan buta) dan layarnya dibaca ulang oleh pemanggil.
async function closeLongPressMenu(manager, serial, nodes) {
  if (!contextMenu(nodes)) return nodes;
  return await manager.dismissContextMenu(serial, nodes);
}
export async function openLinkedPost(manager, serial, account, ref) {
  const expected = instagramTarget(ref.url);
  if (expected.kind !== 'post' || expected.shortcode !== ref.shortcode) throw new Error('Referensi link postingan tidak valid.');
  // The /p route asks Instagram to show a feed post even for a Reel shortcode.
  await manager.openPostUrl(serial, `https://www.instagram.com/p/${expected.shortcode}/`);
  let nodes, owner, inline = false, menus = 0;
  // A slow phone connection needs longer here than a retry outside would: re-opening the URL
  // costs a full navigation, while waiting in place costs a UI dump. Running out of this window
  // is what produced most "belum terbuka" retries, so give the page time before giving up.
  for (let i = 0; i < 12; i++) {
    nodes = await manager.ui(serial);
    if (contextMenu(nodes) && menus < 3) { menus++; nodes = await closeLongPressMenu(manager, serial, nodes); i--; }
    owner = linkedPostOwner(nodes);
    if (owner && commentButton(nodes) && !composerAccount(nodes).field) break;
    // Sebagian HP memutar reel dari link DI DALAM Home Feed: pemiliknya terbaca tetapi baris aksi
    // tidak ada dan nav bar bawah terlihat, sehingga postingan tidak bisa dikomentari dari sini.
    if (owner && feedPreview(nodes)) { inline = true; break; }
    await manager.wait(700);
  }
  // Menu "More actions for this post" menyediakan entri "Go to post" untuk membuka postingan
  // penuh. Hanya entri berlabel itu yang dipakai; kalau tidak ada, layarnya ditutup lagi.
  if (inline && !commentButton(nodes) && await manager.openFullPostFromFeed(serial, nodes)) {
    for (let i = 0; i < 10; i++) {
      nodes = await manager.ui(serial);
      if (contextMenu(nodes) && menus < 4) { menus++; nodes = await closeLongPressMenu(manager, serial, nodes); i--; }
      owner = linkedPostOwner(nodes);
      if (owner && commentButton(nodes) && !composerAccount(nodes).field) break;
      await manager.wait(700);
    }
  }
  if (!owner || !commentButton(nodes) || composerAccount(nodes).field) {
    // Keadaan reel-di-feed ini stabil: diuji 3 kali pada Samsung 05/06/10 (14 Okt 2026) dan tidak
    // berubah walau tautan dibuka ulang, sementara empat percobaan ulang hanya membuang ~7 menit
    // per akun. Jadi akun ditandai perlu tindakan manual, bukan dicoba ulang berulang kali.
    if (inline) throw new ManualActionError('Instagram membuka tautan sebagai reel di dalam feed dan baris aksinya tidak terbaca; postingan ini perlu dikerjakan manual di HP.');
    throw new NetworkError('Postingan dari link belum terbuka dengan identitas pemilik yang jelas; proses dihentikan.');
  }
  if (owner === account) throw new Error('Link mengarah ke postingan akun sendiri; proses dihentikan.');
  if (ref.owner && ref.owner !== owner) throw new Error('Pemilik postingan berubah dari daftar terkunci; proses dihentikan.');
  // Link mode intentionally trusts Instagram's deep-link routing: no Share menu
  // or independent permalink check. Reveal the caption of tall videos in place.
  for (let i = 0; i < 3; i++) {
    const bounds = commentButton(nodes)?.bounds?.match(/\d+/g)?.map(Number);
    try {
      postFingerprint(nodes, owner);
      if (bounds && bounds[3] - bounds[1] >= 45) break;
    } catch {}
    await manager.nudge(serial, bounds?.[1] || 1500); nodes = await manager.ui(serial);
  }
  if (linkedPostOwner(nodes) && linkedPostOwner(nodes) !== owner) throw new Error('Pemilik postingan berubah saat membaca caption; proses dihentikan.');
  if (!commentButton(nodes) || composerAccount(nodes).field) throw new NetworkError('Layar postingan belum siap; proses dihentikan.');
  // Reuse the profile flow's key so an earlier profile run and this URL run share
  // legacy uncertain-send history. The shortcode separately fixes the target.
  const fingerprint = postFingerprint(nodes, owner);
  const expanded = await manager.expandCaption(serial, nodes, owner);
  return { ...expanded, fingerprint, owner, shortcode: expected.shortcode };
}
