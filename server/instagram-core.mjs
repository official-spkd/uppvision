import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
import { instagramTargets, MAX_ACCOUNTS, MAX_LINKS } from '../src/instagram-target.mjs';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: false, parseTagValue: false });
export const validUsername = value => typeof value === 'string' && /^[a-zA-Z0-9_](?:[a-zA-Z0-9_.]{0,28}[a-zA-Z0-9_])?$/.test(value);
export function username(value) {
  const name = typeof value === 'string' ? value.trim().replace(/^@/, '').toLowerCase() : '';
  if (!validUsername(name)) throw new Error('Username Instagram tidak valid. Gunakan username tanpa link.');
  return name;
}
// UI Automator keeps line breaks as numeric character references (&#13;&#10;).
const decodeRefs = value => value.replace(/&#(x[0-9a-f]+|\d+);/gi, (match, code) => { const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match; });
export function parseUi(xml) {
  if (xml.includes('<!DOCTYPE') || xml.length > 2 * 1024 * 1024) throw new Error('Data layar tidak valid.');
  const roots = parser.parse(xml)?.hierarchy?.node;
  const nodes = [];
  function walk(raw, parent = null) {
    if (!raw || typeof raw !== 'object') return;
    const node = { ...raw, parent, children: [] }; delete node.node;
    for (const key of ['text', 'content-desc']) if (typeof node[key] === 'string' && node[key].includes('&#')) node[key] = decodeRefs(node[key]);
    nodes.push(node);
    if (parent) parent.children.push(node);
    for (const child of Array.isArray(raw.node) ? raw.node : raw.node ? [raw.node] : []) walk(child, node);
  }
  for (const root of Array.isArray(roots) ? roots : roots ? [roots] : []) walk(root);
  return nodes;
}
export const byId = (nodes, id) => nodes.find(n => n['resource-id'] === `com.instagram.android:id/${id}`);
export function center(node) {
  const match = node?.bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
  if (!match || Number(match[3]) <= Number(match[1]) || Number(match[4]) <= Number(match[2])) throw new Error('Posisi tombol tidak tersedia.');
  return [Math.round((Number(match[1]) + Number(match[3])) / 2), Math.round((Number(match[2]) + Number(match[4])) / 2)];
}
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }
export function switcherAccounts(nodes) {
  const accounts = new Map();
  for (const node of nodes) {
    if (/,\s*(?:THREADS|FACEBOOK|WHATSAPP) account(?:,|$)/i.test(node['content-desc'] || '')) continue;
    const name = (node['content-desc'] || '').split(',')[0].trim();
    if (!validUsername(name) || node.clickable !== 'true') continue;
    const children = descendants(node);
    if (!children.some(child => child.text?.toLowerCase() === name.toLowerCase())) continue;
    const disabled = children.some(child => /^(deactivated|dinonaktifkan|nonaktif)$/i.test(child.text || ''));
    accounts.set(name.toLowerCase(), { username: name.toLowerCase(), disabled, node });
  }
  return [...accounts.values()];
}
export function accountSheetViewport(nodes, rows = switcherAccounts(nodes)) {
  return nodes.find(n => n.scrollable === 'true' && rows.some(row => {
    for (let p = row.node; p; p = p.parent) if (p === n) return true;
    return false;
  })) || { bounds: `[48,${Math.min(700, ...rows.map(r => Number(r.node.bounds.match(/\d+/g)[1])))}][1032,1776]` };
}
const boundsOf = node => node?.bounds?.match(/\d+/g)?.map(Number) || null;
export const pinnedBadge = node => /(?:^|[\W_])pin(?:ned)?(?:$|[\W_])|disematkan/i.test(`${node['content-desc'] || ''} ${node['resource-id'] || ''}`) || /^(?:pinned(?: to (?:your )?profile)?|disematkan|postingan yang disematkan)$/i.test((node.text || '').trim());
const isPinned = tile => descendants(tile).some(pinnedBadge);
// Grid tiles with their "Baris N, Kolom M" position, so scrolling keeps a stable order.
export function gridTiles(nodes) {
  return nodes.filter(n => n['resource-id'] === 'com.instagram.android:id/image_button' && n.clickable === 'true').flatMap(n => {
    let tile = n;
    while (tile.parent && tile.parent['resource-id'] !== 'com.instagram.android:id/media_set_row_content_identifier') tile = tile.parent;
    if (!tile.parent) return [];
    const b = boundsOf(n), desc = n['content-desc'] || '';
    const position = desc.match(/(?:row|baris)\s*(\d+),\s*(?:column|kolom)\s*(\d+)/i);
    const row = position ? Number(position[1]) : null, col = position ? Number(position[2]) : null;
    let complete = Boolean(b) && b[3] - b[1] >= 150;
    // UI Automator clips bounds at scroll-container edges. A clipped portrait
    // thumbnail may still be taller than its width, so height alone is not proof
    // that sampling it now will match the same image after scrolling.
    for (let parent = n.parent; complete && parent; parent = parent.parent) {
      const viewport = parent.scrollable === 'true' && boundsOf(parent);
      if (viewport && (b[1] <= viewport[1] || b[3] >= viewport[3])) complete = false;
    }
    return [{ node: n, row, col, key: position ? `${row}:${col}` : desc || n.bounds, pinned: isPinned(tile), complete, desc }];
  }).sort((a, b) => (a.row ?? 0) - (b.row ?? 0) || (a.col ?? 0) - (b.col ?? 0) || center(a.node)[1] - center(b.node)[1] || center(a.node)[0] - center(b.node)[0]);
}
// The description without the shifting grid position. This is only one part of
// identity: same-day posts can share it, so the locked list also keeps a thumbnail hash.
export const tileIdentity = tile => ((tile.desc || '').replace(/,?\s*(?:(?:di|in|at|on)\s+)?(?:row|baris)\s*\d+,\s*(?:column|kolom)\s*\d+\s*$/i, '').trim() || null);
export const gridPosts = nodes => gridTiles(nodes).filter(t => !t.pinned).map(t => t.node);
// The profile feed stacks several posts; the opened post owns the topmost action bar.
export function commentButton(nodes) {
  return nodes.find(n => ['com.instagram.android:id/row_feed_button_comment', 'com.instagram.android:id/clips_viewer_comment_component'].includes(n['resource-id']));
}
function sameRow(nodes, id, anchor) {
  const a = boundsOf(anchor);
  return nodes.find(n => n['resource-id'] === `com.instagram.android:id/${id}` && (!a || (b => b && b[1] < a[3] && b[3] > a[1])(boundsOf(n))));
}
export function likeState(nodes) {
  const node = sameRow(nodes, 'row_feed_button_like', commentButton(nodes)) || sameRow(nodes, 'like_button', commentButton(nodes));
  const desc = (node?.['content-desc'] || '').trim();
  if (!node) return { status: 'missing', node: null };
  if (node.selected === 'true' || /^(batal suka|tidak suka|disukai|liked|unlike)$/i.test(desc)) return { status: 'already', node };
  if (/^(suka|like)$/i.test(desc)) return { status: 'not_liked', node };
  return { status: 'unknown', node };
}
// Simpan, repost, dan share pada postingan yang sedang terbuka. Bounds baris aksi
// bergeser begitu status like berubah (repost 240-372 menjadi 257-389), jadi setiap
// pembaca menerima dump yang baru dibaca, bukan node lama yang disimpan.
const actionNode = (nodes, ids) => nodes.find(n => ids.some(id => n['resource-id'] === `com.instagram.android:id/${id}`));
export const SAVE_IDS = ['row_feed_button_save', 'clips_viewer_save_component', 'save_button'];
export const REPOST_IDS = ['reposts_ufi_icon', 'clips_viewer_repost_component'];
// Versi Instagram yang lebih baru memakai direct_share_button pada pemutar reels yang dibuka
// dari sebuah tautan (dibaca dari dump asli Samsung 12, 15 Okt 2026); tanpa id ini tombolnya
// tidak terbaca dan langkah share dilewati.
export const SHARE_IDS = ['row_feed_button_share', 'clips_viewer_share_component', 'direct_share_button'];
export const shareButton = nodes => actionNode(nodes, SHARE_IDS);
export const repostButton = nodes => actionNode(nodes, REPOST_IDS);
// Instagram menuliskan keadaan bookmark saat ini, jadi aman dibaca sebelum diketuk:
// label yang tidak dikenal berarti tidak diketuk, supaya simpanan tidak terhapus.
export function saveState(nodes) {
  const node = actionNode(nodes, SAVE_IDS);
  if (!node) return { status: 'missing', node: null };
  const desc = (node['content-desc'] || node.text || '').trim();
  if (node.selected === 'true' || /^(?:remove from saved|hapus dari simpanan|tersimpan|saved)$/i.test(desc)) return { status: 'saved', node };
  if (/^(?:add to saved|simpan ke koleksi|save|simpan)$/i.test(desc)) return { status: 'not_saved', node };
  return { status: 'unknown', node };
}
// Repost hanya dikonfirmasi lewat snackbar; baris aksi tidak menampilkan statusnya.
const SNACKBAR_ID = /(?:^|\/)snackbar_(?:message|text)$/;
export function snackbarMessage(nodes) {
  const node = nodes.find(n => SNACKBAR_ID.test(n['resource-id'] || '') && (n.text || '').trim());
  return (node?.text || '').trim();
}
export const repostedNotice = nodes => /^reposted\b/i.test(snackbarMessage(nodes));
// Repost pertama dikonfirmasi lewat dialog "You reposted …" yang MEMBLOKIR layar sampai
// ditutup (tombol Close dan Undo), atau lewat snackbar "Reposted" pada beberapa tampilan.
// Dialognya harus dikenali: tanpa ditutup, ketukan aksi berikutnya mendarat di dialog itu.
const REPOST_HEADLINE = /(?:you|anda)\s+(?:reposted|membagikan ulang)|repost(?:ed)?\s+(?:berhasil|tersimpan)/i;
export function repostDialog(nodes) {
  const headline = nodes.find(n => /(?:^|\/)igds_headline_headline$/.test(n['resource-id'] || '') && REPOST_HEADLINE.test((n.text || '').trim()));
  if (!headline) return null;
  const close = nodes.find(n => /(?:^|\/)igds_headline_primary_action_button$/.test(n['resource-id'] || '') && /^(?:close|tutup|oke|ok)$/i.test((n['content-desc'] || n.text || '').trim()));
  return { headline: (headline.text || '').trim(), close: close || null };
}
export const repostConfirmed = nodes => repostedNotice(nodes) || Boolean(repostDialog(nodes));
// Instagram kadang memutar reel dari sebuah link DI DALAM Home Feed: pemiliknya terbaca, tetapi
// baris aksi (like/komentar/share/simpan) tidak ada dan nav bar bawah terlihat. Layar itu tidak
// bisa dikomentari, jadi harus dikenali - bukan disimpulkan sebagai postingan yang gagal terbuka.
// Nav bar bawah dipakai sebagai penanda supaya layar postingan biasa tidak salah terdeteksi.
export function feedPreview(nodes) {
  const ids = new Set(nodes.map(n => (n['resource-id'] || '').split('/').pop()));
  if (ids.has('row_feed_button_comment') || ids.has('clips_viewer_comment_component')) return false;
  const nav = ['feed_tab', 'clips_tab', 'direct_tab'].filter(id => ids.has(id)).length;
  const inline = [...ids].some(id => id.startsWith('feed_preview')) || ids.has('media_group');
  return nav >= 2 && inline;
}
// Menu tekan-lama Instagram ("Reply / View Profile / Mute") pada layar postingan atau reel.
// Disalin dari dump asli Samsung 09 (1080x1920): context_menu 371,1016-950,1544 berisi dua
// context_menu_item. Selama menu ini terbuka, UI Automator HANYA memuat isi menu - bukan
// halaman di bawahnya - sehingga postingan yang sebenarnya sudah terbuka terbaca sebagai belum
// terbuka, dan menu itu tetap ada walau deep link dibuka ulang. Hanya id menu yang dipakai,
// supaya tidak ada ketukan buta untuk menutupnya.
const CONTEXT_MENU_IDS = ['context_menu', 'context_menu_options_list'];
export function contextMenu(nodes) {
  const node = actionNode(nodes, CONTEXT_MENU_IDS);
  return node || null;
}
// Setelah tombol simpan diketuk, Instagram membuka lembar koleksi yang MENUTUPI baris aksi
// (bounds 0,358-1080,1776 di Samsung 01): judul "Collect the posts you love" dengan tombol
// "Start a collection", atau baris "Saved · Private" bila koleksinya sudah ada. Selama lembar
// itu terbuka, ketukan repost/share/komentar mendarat di atasnya dan tidak terjadi apa pun.
const SHEET_IDS = ['layout_container_bottom_sheet', 'bottom_sheet_container_view'];
const SHEET_WORDS = /^(?:collect the posts you love|start a collection|save posts in collections.*|kumpulkan postingan.*|mulai koleksi|simpan postingan.*)$/i;
export function savedSheet(nodes) {
  const ids = new Set(nodes.map(n => (n['resource-id'] || '').split('/').pop()));
  if (!SHEET_IDS.some(id => ids.has(id))) return false;
  return nodes.some(n => SHEET_WORDS.test((n.text || '').trim())) ||
    (ids.has('pinned_save_row') && nodes.some(n => /^(?:saved|tersimpan)$/i.test((n.text || '').trim())));
}
// Lembar share mencantumkan kontak sebagai "<nama> Chat not selected" / "<nama> Chat selected".
const SHARE_TILE = /^(.+?)\s+chat\s+(not\s+)?selected$/i;
export function shareSheetOpen(nodes) {
  return nodes.some(n => /direct_private_share_(?:container_view|recipients_container)|direct_send_button_multi_select/.test(n['resource-id'] || ''));
}
// Baris yang terpotong tepi lembar tidak pernah dipakai: titik tengahnya bisa jatuh
// tepat di tombol Kirim yang mengambang di dasar lembar.
export function shareContacts(nodes) {
  return nodes.map(node => {
    const match = SHARE_TILE.exec((node['content-desc'] || '').trim()), box = boundsOf(node);
    if (!actionNode([node], ['direct_share_sheet_grid_view_pog']) || !match || !box || box[3] - box[1] < 200) return null;
    return { node, name: match[1].trim(), selected: !match[2], top: box[1], left: box[0] };
  }).filter(Boolean).sort((a, b) => a.top - b.top || a.left - b.left);
}
export const shareSendButton = nodes => nodes.find(n => n['resource-id'] === 'com.instagram.android:id/direct_send_button_multi_select' && n.enabled !== 'false');
// Baris "Salin tautan"/"Copy link" di lembar share. Satu-satunya tempat Instagram
// memperlihatkan kode tautan sebuah postingan; labelnya mengikuti bahasa HP.
const COPY_LINK = /^(?:salin\s+tautan|copy\s+link)$/i;
export function copyLinkButton(nodes) {
  return nodes.find(n => COPY_LINK.test((n.text || '').trim()) || COPY_LINK.test((n['content-desc'] || '').trim())) || null;
}
// Kolom pencarian di dalam lembar share sendiri. Dipakai hanya sebagai tempat menempel
// supaya isi papan klip bisa dibaca: kolom milik Instagram, tidak mengirim apa pun.
// Id Android berbentuk "paket:id/nama", jadi pemisahnya garis miring - bukan titik dua.
export function shareSearchField(nodes) {
  const named = n => /(?:^|[/:_])search_edit_text$/.test(n['resource-id'] || '');
  const matches = nodes.filter(named);
  return matches.find(n => String(n.class || '').includes('EditText')) || matches[0] || null;
}
// Tombol "Hapus/Clear" milik kolom pencarian itu; isi tempelan harus dibersihkan lagi.
const CLEAR_FIELD = /^(?:hapus|clear|bersihkan)$/i;
export const shareClearButton = nodes => nodes.find(n => CLEAR_FIELD.test((n['content-desc'] || '').trim()) || CLEAR_FIELD.test((n.text || '').trim())) || null;
// Pemutar reels yang dibuka dari sebuah LINK berjalan di activity sendiri dengan nav bawah
// tersembunyi. Di sana tombol jeda media, tab Home, dan tombol Kembali tidak berefek, tetapi
// mengetuk area videonya MENJEDA pemutaran sehingga layar bisa dibaca lagi (diuji 15 Okt 2026).
export const clipsViewerActive = activities => /ClipsUrlHandlerActivity|clips\.Clips/i.test(String(activities || ''));
// Layar "Meta Account" yang kadang dibuka Instagram saat aplikasi dijalankan (Account overview,
// What's new, Enhanced security features). Tombol Kembali TIDAK menutupnya - diuji pada Samsung 05,
// 15 Okt 2026 - sehingga tanpa mengetuk tombol "Done"-nya, pembacaan profil akun gagal berulang
// kali dan seluruh HP itu dilaporkan gagal dipindai.
const META_TITLE = /^(?:meta account|akun meta)$/i;
const META_ITEMS = /^(?:account overview|ringkasan akun|what'?s new|yang baru|enhanced security features|fitur keamanan yang ditingkatkan)$/i;
export const metaAccountScreen = nodes => {
  const texts = nodes.map(n => (n.text || '').trim()).filter(Boolean);
  return texts.some(text => META_TITLE.test(text)) && texts.some(text => META_ITEMS.test(text));
};
const DONE_LABEL = /^(?:done|selesai|oke|ok)$/i;
export const metaDoneButton = nodes => nodes.find(n => DONE_LABEL.test((n.text || '').trim()) || DONE_LABEL.test((n['content-desc'] || '').trim())) || null;
// Menu "Ambil link postingan": satu HP, satu username channel, 1-20 link.
export function validateLinkRequest(body, accountDevices) {
  const serial = String(body?.serial ?? '');
  const device = accountDevices.find(d => d.serial === serial);
  if (!device) throw new Error('HP yang dipilih belum terhubung.');
  // Pesannya harus jelas untuk dua kesalahan yang berbeda: diketik sebagai link, atau bukan
  // username yang sah. Keduanya berarti kolomnya bukan nama channel.
  const raw = String(body?.target ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!validUsername(raw) || instagramTargets(raw, { allowPostLinks: false }).kind !== 'profile') throw new Error('Isi username channel target, bukan link postingan.');
  const count = Number(body?.count);
  if (!Number.isInteger(count) || count < 1 || count > MAX_LINKS) throw new Error(`Jumlah link harus 1-${MAX_LINKS}.`);
  const account = device.current || (device.accounts || []).find(a => a.active)?.username || '';
  if (!account) throw new Error('Belum ada akun Instagram yang login di HP ini.');
  return { serial, target: raw, count, account, verify: body?.verify !== false };
}
// Caption printed under the opened post's action bar: "<target> text… selengkapnya".
export function postCaption(nodes, target) {
  const anchor = boundsOf(commentButton(nodes));
  const caption = nodes.filter(n => (n.text || '').toLowerCase().startsWith(target + ' ') && n.class?.includes('IgTextLayoutView'))
    .map(n => ({ n, top: boundsOf(n)?.[1] ?? 0 })).filter(c => !anchor || c.top >= anchor[1])
    .sort((a, b) => a.top - b.top)[0]?.n.text || '';
  return caption.slice(target.length + 1).replace(/[.…]*\s*(?:selengkapnya|lebih sedikit|more|less|lainnya)\s*$/i, '').replace(/\s+/g, ' ').trim();
}
// "… selengkapnya" link under the opened post's caption.
export function captionMore(nodes) {
  const anchor = boundsOf(commentButton(nodes));
  return nodes.filter(n => /^(selengkapnya|more)$/i.test((n['content-desc'] || n.text || '').trim()))
    .find(n => !anchor || (boundsOf(n)?.[1] ?? 0) >= anchor[1]);
}
export const threadCaption = (nodes, target) => {
  const row = nodes.find(n => new RegExp(`^${target.replace(/\./g, '\\.')}\\s+(?:mengatakan|said|says)\\s`, 'i').test(n['content-desc'] || n.text || ''));
  return row ? (row['content-desc'] || row.text).replace(/^\S+\s+(?:mengatakan|said|says)\s+/i, '').trim() : '';
};
// Comment rows read "<author> mengatakan <text>" (or "said" in English).
export function threadComments(nodes, target) {
  const found = [];
  for (const n of nodes) {
    const match = (n['content-desc'] || n.text || '').match(/^([a-zA-Z0-9._]+)\s+(?:mengatakan|said|says)\s+([\s\S]+)$/i);
    if (match && validUsername(match[1]) && match[1].toLowerCase() !== target) found.push({ author: match[1].toLowerCase(), text: match[2].trim() });
  }
  return found;
}
export const commentList = nodes => byId(nodes, 'sticky_header_list') || nodes.find(n => n.scrollable === 'true' && /comment/i.test(n['resource-id'] || ''));
export const SEND_IDS = ['layout_comment_thread_post_button_icon', 'comment_composer_post_button', 'layout_comment_thread_post_button', 'comment_composer_send_button'];
const commentId = (node, id) => node['resource-id'] === `com.instagram.android:id/${id}` ||
  (node.package === 'com.instagram.android' && node['resource-id'] === id);
const composerNode = nodes => nodes.find(n => ['layout_comment_thread_edittext_multiline', 'layout_comment_thread_edittext'].some(id => commentId(n, id)) && n.enabled !== 'false');
export function sendButton(nodes) {
  const known = nodes.find(n => SEND_IDS.some(id => commentId(n, id)) && n.enabled === 'true');
  if (known) return known;
  // New Instagram composer: an unlabeled clickable sibling contains a Post icon.
  // Never use the keyboard's Send control or a Post label elsewhere on the page.
  const field = composerNode(nodes), row = field?.parent, box = boundsOf(field);
  if (!row || !box) return undefined;
  const matches = (row.children || []).filter(n => {
    const b = boundsOf(n);
    return n !== field && n.package === 'com.instagram.android' && n.clickable === 'true' && n.enabled === 'true' && b &&
      b[0] >= box[2] && b[1] < box[3] && b[3] > box[1] &&
      descendants(n).some(child => child.package === 'com.instagram.android' && /^(?:post|send|kirim|posting)$/i.test(child['content-desc'] || child.text || ''));
  });
  return matches.length === 1 ? matches[0] : undefined;
}
export function composerAccount(nodes) {
  const raw = composerNode(nodes);
  // Some layouts expose a ScrollView with its hint in a child ig_text node.
  const childTexts = raw ? [...new Set((raw.children || []).flatMap(descendants).map(n => n.text || '').filter(Boolean))] : [];
  const field = raw ? { ...raw, text: raw.text || (childTexts.length === 1 ? childTexts[0] : childTexts.length ? '[Kolom berisi teks yang belum dapat dibaca]' : '') } : undefined;
  const match = field?.text?.match(/(?:comment(?:ing)? as|berkomentar sebagai|tambahkan komentar sebagai)\s+@?([a-zA-Z0-9_.]+)/i);
  // Instagram truncates a long owner name with an ellipsis inside the narrow composer hint
  // ("Add a comment for akun.contoh104.offi…"). Keep the visible prefix and flag that it is partial.
  const target = field?.text?.match(/^(?:add a comment for|tambahkan komentar untuk)\s+@?([a-zA-Z0-9_.]+?)(?:\.{3}|…)?$/i);
  const targetTruncated = /(?:\.{3}|…)\s*$/.test(field?.text || '');
  return { field, username: match?.[1]?.replace(/\.+$/, '').toLowerCase() || null,
    target: target?.[1]?.toLowerCase() || null, targetTruncated: Boolean(target) && targetTruncated,
    // Instagram rotates hint texts; an empty composer never shows an enabled Send button.
    genericPlaceholder: Boolean(field) && (/^(?:add a comment|tambahkan komentar|tulis komentar|mulai percakapan|gabung(?: dalam| ke)? percakapan|apa pendapat anda tentang ini|what do you think of this|(?:start|join)(?: a| the)? conversation)[.…?]*$/i.test(field.text || '') || (!field.text && !sendButton(nodes))) };
}
export function postFingerprint(nodes, target) {
  const image = byId(nodes, 'row_feed_photo_imageview');
  const description = image?.['content-desc'] || '';
  const owner = byId(nodes, 'row_feed_photo_profile_name');
  const caption = postCaption(nodes, target);
  if (!caption && (!description || (!description.toLowerCase().includes(target) && owner?.text?.toLowerCase() !== target))) throw new Error('Identitas postingan target belum dapat diverifikasi.');
  const stable = description.replace(/,?\s*\d[\d.,]*\s*(?:suka|likes?|comments?|komentar)\b/gi, '').trim();
  if (!caption && stable === target) throw new Error('Identitas postingan belum lengkap.');
  // Collapsed captions are stable when relative dates/like counts change. Identical captions
  // are deliberately treated as the same post, preferring a skipped comment over a duplicate.
  return createHash('sha256').update(target + '\n' + (caption || stable)).digest('hex');
}
export const TONES = ['positif', 'netral', 'negatif'];
export const LIMITS = { accounts: MAX_ACCOUNTS, posts: 50, comments: 100 };
// "bertahap" chains HP start times 10–20 s apart; "serentak" starts every HP at once.
export const START_MODES = ['bertahap', 'serentak'];
// Every selected account carries its own single target, post count, comment target and tone.
export function validatePlan(body, accountDevices, { allowPostLinks = true } = {}) {
  if (!Array.isArray(body?.accounts) || !body.accounts.length) throw new Error('Pilih minimal satu akun Instagram.');
  // Over-limit is a different problem from an empty selection and must say so.
  if (body.accounts.length > LIMITS.accounts) throw new Error(`Maksimal ${LIMITS.accounts} akun per pekerjaan; pilihan berisi ${body.accounts.length} akun. Kurangi pilihan lalu jalankan lagi.`);
  const selected = [];
  const ids = new Set();
  for (const entry of body.accounts) {
    if (!entry || typeof entry.serial !== 'string') throw new Error('Pilihan akun tidak valid.');
    const name = username(entry.username), device = accountDevices.find(d => d.serial === entry.serial);
    const account = device?.accounts.find(a => a.username === name);
    // Akun nonaktif adalah masalah berbeda dari akun yang belum dipindai, dan pesannya harus berbeda.
    if (account?.disabled) throw new Error(`@${name} sedang nonaktif menurut pemindaian terakhir, jadi belum bisa ikut. Pindai ulang akun HP bila akun ini sudah aktif kembali.`);
    if (!account) throw new Error(`@${name} belum tersedia. Pindai akun HP terlebih dahulu.`);
    const parsedTarget = instagramTargets(entry.target, { allowPostLinks });
    const target = parsedTarget.target;
    if (target === name) throw new Error(`Target @${name} tidak boleh akunnya sendiri.`);
    if (!Number.isInteger(entry.posts) || entry.posts < 1 || entry.posts > LIMITS.posts) throw new Error(`Jumlah postingan @${name} harus 1–${LIMITS.posts}.`);
    if (!Number.isInteger(entry.comments) || entry.comments < 1 || entry.comments > LIMITS.comments) throw new Error(`Komentar per postingan @${name} harus 1–${LIMITS.comments}.`);
    if (!TONES.includes(entry.tone)) throw new Error(`Pilih nada komentar untuk @${name}.`);
    const key = `${entry.serial}:${name}`;
    if (!ids.has(key)) { ids.add(key); selected.push({ serial: entry.serial, username: name, target, posts: parsedTarget.kind === 'posts' ? parsedTarget.targets.length : entry.posts, comments: entry.comments, tone: entry.tone }); }
  }
  if (body.startMode !== undefined && !START_MODES.includes(body.startMode)) throw new Error('Pilih cara mulai: bertahap atau serentak.');
  return { accounts: selected, startMode: body.startMode || 'bertahap' };
}
const BLOCKED = /try again later|coba lagi nanti|action blocked|tindakan (?:ini )?diblokir|we restrict certain activity|kami membatasi aktivitas/i;
export const blockedNotice = nodes => nodes.some(n => BLOCKED.test(`${n.text || ''} ${n['content-desc'] || ''}`));
const textOf = n => `${n.text || ''} ${n['content-desc'] || ''}`;
const OFFLINE = /you[’']?re offline|anda (?:sedang )?offline|no internet connection|tidak ada koneksi(?: internet)?|couldn'?t refresh feed|tidak dapat memperbarui|couldn'?t load|tidak dapat memuat|gagal memuat|check your (?:internet )?connection|periksa koneksi/i;
export const offlineNotice = nodes => nodes.some(n => OFFLINE.test(textOf(n)));
const POSTING = /^(?:posting|memposting|mengirim|sending)\s*(?:\.\.\.|…)?$/i;
export const postingNotice = nodes => nodes.some(n => POSTING.test((n.text || n['content-desc'] || '').trim()));
const POST_FAILED = /couldn'?t post|failed to post|gagal (?:memposting|mengirim)|tidak dapat (?:memposting|mengirim)|tap to retry|ketuk untuk mencoba lagi|tidak terkirim/i;
export const postFailedNotice = nodes => nodes.some(n => POST_FAILED.test(textOf(n)));
const EMPTY_THREAD = /^(?:belum ada komentar|no comments yet|jadilah yang pertama|be the first)/i;
export const emptyThread = nodes => nodes.some(n => EMPTY_THREAD.test((n.text || '').trim()));
// Number printed next to the opened post's comment button. Instagram hides it when there are no comments.
export function commentCount(nodes, { exact = false } = {}) {
  const b = boundsOf(commentButton(nodes));
  if (!b) return null;
  const label = nodes.map(n => ({ text: (n.text || '').trim(), box: boundsOf(n) }))
    .filter(x => x.box && /^\d[\d.,]*\s*(?:k|rb|jt|m)?$/i.test(x.text) && x.box[1] < b[3] && x.box[3] > b[1] && x.box[0] >= b[2] - 2 && x.box[0] - b[2] < 60)
    .sort((x, y) => x.box[0] - y.box[0])[0];
  if (exact) return label && /^\d+$/.test(label.text) ? Number(label.text) : null;
  if (!label) return 0;
  return /[a-z]/i.test(label.text) ? 1000 : Number(label.text.replace(/[.,]/g, ''));
}
