import { createHash } from 'node:crypto';
import { validUsername } from './instagram-core.mjs';

// TikTok obfuscates its resource ids and changes them between versions, so screens are read
// through labels (English and Indonesian), classes and positions instead.
export const TIKTOK = 'com.ss.android.ugc.trill';
const boundsOf = node => node?.bounds?.match(/\d+/g)?.map(Number) || null;
const label = n => `${n['content-desc'] || ''}|${n.text || ''}`;
const descendants = node => [node, ...(node.children || []).flatMap(descendants)];
export const findLabel = (nodes, pattern) => nodes.find(n => pattern.test(n['content-desc'] || '') || pattern.test(n.text || ''));

export const popupButton = nodes => nodes.find(n => n.clickable !== 'false' && /^(Not now|Nanti saja|Lain kali|Skip|Lewati|Cancel|Batal|Close|Tutup|Got it|Mengerti|OK, got it)$/i.test((n.text || n['content-desc'] || '').trim()) && nodes.some(m => /update your app|perbarui aplikasi|link email|tautkan email|contacts|kontak|notifications|notifikasi|sync|sinkron|follow your friends|teman/i.test(label(m))));
export const homeTab = nodes => findLabel(nodes, /^(Home|Beranda)$/i);
export const profileTab = nodes => nodes.find(n => /^(Profile|Profil)$/i.test(n['content-desc'] || '') && n.clickable === 'true');
export const searchButton = nodes => nodes.find(n => /^(Search|Cari)$/i.test(n['content-desc'] || '') && n.clickable === 'true');
// Own profile: "@handle" button and, just above it, the display name (with the account switcher arrow).
export function ownProfile(nodes) {
  const handleNode = nodes.find(n => /^@[a-zA-Z0-9._]+$/.test((n.text || '').trim()) && boundsOf(n)?.[1] < 600);
  if (!handleNode) return null;
  const hb = boundsOf(handleNode);
  const nameNode = nodes.filter(n => n.text && n !== handleNode && n.clickable === 'true' && boundsOf(n) && boundsOf(n)[3] <= hb[1] + 5 && boundsOf(n)[1] > 150)
    .sort((a, b) => boundsOf(b)[1] - boundsOf(a)[1])[0];
  return { username: handleNode.text.trim().slice(1).toLowerCase(), nickname: nameNode?.text?.trim() || '', nameNode, handleNode };
}
// "Switch account" sheet rows carry the username as their content description.
export function switcherAccounts(nodes) {
  if (!nodes.some(n => /^(Switch account|Ganti akun|Beralih akun)$/i.test((n.text || '').trim()))) return [];
  return nodes.filter(n => n.clickable === 'true' && validUsername((n['content-desc'] || '').trim()) && !/^(add account|tambah akun|close|tutup|back|kembali)$/i.test(n['content-desc'].trim()))
    .map(n => ({ username: n['content-desc'].trim().toLowerCase(), active: n.selected === 'true' || descendants(n).some(c => /^(Checkmark|Tanda centang)$/i.test(c['content-desc'] || '')), node: n }));
}
export const searchField = nodes => nodes.find(n => n.class === 'android.widget.EditText');
// A search result row for the exact handle (the line under the display name shows the handle).
export const userResult = (nodes, target) => nodes.find(n => (n.text || '').replace(/[‎⁨⁩]/g, '').trim().toLowerCase() === target && boundsOf(n)?.[1] > 300);
// Profile grid: clickable tiles inside the scrollable GridView, in reading order.
export function gridTiles(nodes) {
  const grid = nodes.find(n => n.class === 'android.widget.GridView' && n.scrollable === 'true');
  if (!grid) return [];
  return grid.children.filter(t => t.clickable === 'true' && boundsOf(t)).map(t => {
    const b = boundsOf(t);
    return { node: t, top: b[1], left: b[0], complete: b[3] - b[1] >= 150, pinned: descendants(t).some(c => /^(Pinned|Disematkan|Sematkan)$/i.test((c.text || c['content-desc'] || '').trim())) };
  }).sort((a, b) => a.top - b.top || a.left - b.left);
}
// Not liked: "Like video. 3 likes". Liked: "Video liked" (older versions: "Unlike video…").
const LIKED = /^(video liked|video disukai|unlike video|batal suka|batalkan suka|liked|disukai)/i;
export const likeButton = nodes => nodes.find(n => /^(like video|suka video)/i.test(n['content-desc'] || '') || LIKED.test(n['content-desc'] || ''));
export function likeState(nodes) {
  const node = likeButton(nodes);
  if (!node) return { status: 'missing', node: null };
  const desc = node['content-desc'] || '';
  const icon = descendants(node).find(c => c !== node && /^(Like|Suka)$/i.test(c['content-desc'] || ''));
  if (LIKED.test(desc) || node.selected === 'true' || icon?.selected === 'true') return { status: 'already', node };
  if (/^(like video|suka video)/i.test(desc)) return { status: 'not_liked', node };
  return { status: 'unknown', node };
}
export const commentButton = nodes => nodes.find(n => /^(read or add comments|baca atau tambahkan komentar)/i.test(n['content-desc'] || ''));
// Comment count from "Read or add comments. 12 comments"; "Add 1st comments" means none.
export function commentCount(nodes) {
  const desc = commentButton(nodes)?.['content-desc'] || '';
  if (!desc) return null;
  if (/add 1st|tambahkan komentar pertama|0 comments|0 komentar/i.test(desc)) return 0;
  const m = desc.match(/([\d.,]+)\s*([KMkm]|rb|jt)?\s*(comments|komentar)/i);
  if (!m) return null;
  return m[2] ? 1000 : Number(m[1].replace(/[.,]/g, ''));
}
// The opened video: owner handle button, date ("· 09-14") and caption ("…more" stripped). A video without a
// caption has none: the right-hand button labels (Share, counts) are never taken for it.
export function videoInfo(nodes, target) {
  const owner = nodes.find(n => n.class === 'android.widget.Button' && (n.text || '').trim().toLowerCase() === target && boundsOf(n)?.[1] > 900);
  const ob = boundsOf(owner);
  const date = ob && nodes.find(n => /^·\s*\S+/.test((n.text || '').trim()) && Math.abs(boundsOf(n)[1] - ob[1]) < 30)?.text.replace(/^·\s*/, '').trim();
  const captionNode = ob && nodes.filter(n => n.text && boundsOf(n) && boundsOf(n)[1] >= ob[3] - 5 && boundsOf(n)[1] < ob[3] + 160 && n !== owner && boundsOf(n)[0] < 850
    && !/^(See translation|Lihat terjemahan|Share|Bagikan|[\d.,]+[KM]?)$/i.test(n.text.trim()))[0];
  const caption = (captionNode?.text || '').replace(/[.…]*\s*(more|lainnya|selengkapnya)\s*$/i, '').replace(/\s+/g, ' ').trim();
  return { owner, date: date || '', caption, captionNode, more: Boolean(captionNode && /(more|lainnya|selengkapnya)\s*$/i.test(captionNode.text)) };
}
export function videoFingerprint(info, target) {
  if (!info.owner) throw new Error('Pemilik video target belum dapat diverifikasi.');
  if (!info.caption && !info.date) throw new Error('Identitas video belum lengkap.');
  return createHash('sha256').update(`tiktok\n${target}\n${info.date}\n${info.caption}`).digest('hex');
}
// Open sheet: its "12 comments" header, the empty-thread hint, or (newer layout, also while the list still
// loads) the sheet's Sort button together with the comment field.
export const commentSheetOpen = nodes => nodes.some(n => /^‎?([\d.,]+[KM]?\s+)?(comments?|komentar)$/i.test((n.text || '').replace(/[‎⁨⁩]/g, '').trim()) && boundsOf(n)?.[1] > 300) || nodes.some(n => /be the first to comment|jadilah yang pertama/i.test(n.text || ''))
  || (nodes.some(n => /^(Sort|Urutkan)$/i.test(n['content-desc'] || '') && boundsOf(n)?.[1] > 300) && nodes.some(n => n.class === 'android.widget.EditText'));
export const emptyThread = nodes => nodes.some(n => /be the first to comment|jadilah yang pertama berkomentar|belum ada komentar|no comments yet/i.test(n.text || ''));
// Comment rows: nickname button + text, with a "Reply" button underneath.
export function threadComments(nodes) {
  const rows = [];
  for (const reply of nodes.filter(n => /^(Reply|Balas)$/i.test((n.text || '').trim()))) {
    const row = reply.parent?.parent;
    if (!row) continue;
    const parts = descendants(row).filter(n => n.text && n !== reply && !/^(Reply|Balas)$/i.test(n.text));
    const author = parts.find(n => n.class === 'android.widget.Button');
    const text = parts.filter(n => n !== author && n.class !== 'android.widget.Button' && !/^\d+\s*[smhdwy]$|^\d+[smhdwy]\s*ago$|^\d{2}-\d{2}$|^\d+\s*(dtk|mnt|j|h|mgg|thn)$/i.test(n.text.trim()))
      .sort((a, b) => b.text.length - a.text.length)[0];
    if (author && text) rows.push({ author: author.text.trim(), text: text.text.trim() });
  }
  return rows;
}
export const commentList = nodes => nodes.find(n => n.class === 'androidx.recyclerview.widget.RecyclerView' && n.scrollable === 'true' && descendants(n).some(c => /^(Reply|Balas)$/i.test(c.text || '')));
// Composer: the comment EditText (the focused/draft one when present).
export function composer(nodes) {
  const fields = nodes.filter(n => n.class === 'android.widget.EditText');
  const field = fields.find(n => n.focused === 'true') || fields.sort((a, b) => boundsOf(a)[1] - boundsOf(b)[1])[0] || null;
  const placeholder = /^(add comment|tambahkan komentar|add a comment|tulis komentar)[.…]*$/i.test((field?.text || '').trim());
  return { field, placeholder, draft: field && !placeholder ? field.text : '' };
}
// Send button: the right-most clickable button on the composer's tool row (the row holding the
// Stickers / Mention icons right under the draft). Never anything from the video's own buttons.
export function sendButton(nodes, field) {
  const fb = boundsOf(field);
  if (!fb) return null;
  const tools = /^(Stickers|Mention someone|Microphone|Send Gift|Stiker|Sebut seseorang|Mikrofon|Kirim hadiah)$/i;
  const anchor = nodes.filter(n => tools.test(n['content-desc'] || '') && boundsOf(n) && boundsOf(n)[1] >= fb[1])
    .sort((a, b) => boundsOf(a)[1] - boundsOf(b)[1])[0];
  if (!anchor) return null;
  const top = boundsOf(anchor)[1];
  return nodes.filter(n => n.clickable === 'true' && boundsOf(n) && Math.abs(boundsOf(n)[1] - top) <= 30 && !tools.test(n['content-desc'] || '') && boundsOf(n)[0] > boundsOf(anchor)[2])
    .sort((a, b) => boundsOf(b)[0] - boundsOf(a)[0])[0] || null;
}
const BLOCKED = /try again later|coba lagi nanti|you're commenting too fast|terlalu cepat|action blocked|tindakan diblokir|temporarily restricted|dibatasi sementara/i;
export const blockedNotice = nodes => nodes.some(n => BLOCKED.test(label(n)));
const OFFLINE = /no internet connection|tidak ada koneksi internet|connect to the internet|network error|kesalahan jaringan/i;
export const offlineNotice = nodes => nodes.some(n => OFFLINE.test(label(n)));
const POST_FAILED = /couldn't post|failed to post|gagal mengirim|gagal memposting|tap to retry|ketuk untuk mencoba lagi/i;
export const postFailedNotice = nodes => nodes.some(n => POST_FAILED.test(label(n)));

export const postingNotice = nodes => nodes.some(n => /^(posting|sending|memposting|mengirim)(?:[.\s…]|$)/i.test((n.text || n['content-desc'] || '').trim()));
