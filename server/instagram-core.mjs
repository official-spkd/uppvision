import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'node:crypto';

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
    const name = (node['content-desc'] || '').split(',')[0].trim();
    if (!validUsername(name) || node.clickable !== 'true') continue;
    const children = descendants(node);
    if (!children.some(child => child.text?.toLowerCase() === name.toLowerCase())) continue;
    const disabled = children.some(child => /^(deactivated|dinonaktifkan|nonaktif)$/i.test(child.text || ''));
    accounts.set(name.toLowerCase(), { username: name.toLowerCase(), disabled, node });
  }
  return [...accounts.values()];
}
const boundsOf = node => node?.bounds?.match(/\d+/g)?.map(Number) || null;
const isPinned = tile => descendants(tile).some(child => /pinned|disematkan/i.test(`${child['content-desc'] || ''} ${child['resource-id'] || ''}`));
// Grid tiles with their "Baris N, Kolom M" position, so scrolling keeps a stable order.
export function gridTiles(nodes) {
  return nodes.filter(n => n['resource-id'] === 'com.instagram.android:id/image_button' && n.clickable === 'true').flatMap(n => {
    let tile = n;
    while (tile.parent && tile.parent['resource-id'] !== 'com.instagram.android:id/media_set_row_content_identifier') tile = tile.parent;
    if (!tile.parent) return [];
    const b = boundsOf(n), desc = n['content-desc'] || '';
    const position = desc.match(/(?:row|baris)\s*(\d+),\s*(?:column|kolom)\s*(\d+)/i);
    const row = position ? Number(position[1]) : null, col = position ? Number(position[2]) : null;
    return [{ node: n, row, col, key: position ? `${row}:${col}` : desc || n.bounds, pinned: isPinned(tile), complete: Boolean(b) && b[3] - b[1] >= 150 }];
  }).sort((a, b) => (a.row ?? 0) - (b.row ?? 0) || (a.col ?? 0) - (b.col ?? 0) || center(a.node)[1] - center(b.node)[1] || center(a.node)[0] - center(b.node)[0]);
}
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
export const sendButton = nodes => SEND_IDS.map(id => byId(nodes, id)).find(n => n?.enabled === 'true');
export function composerAccount(nodes) {
  const field = byId(nodes, 'layout_comment_thread_edittext_multiline') || byId(nodes, 'layout_comment_thread_edittext');
  const match = field?.text?.match(/(?:comment(?:ing)? as|berkomentar sebagai|tambahkan komentar sebagai)\s+@?([a-zA-Z0-9_.]+)/i);
  const target = field?.text?.match(/^(?:add a comment for|tambahkan komentar untuk)\s+@?([a-zA-Z0-9_.]+)[.…]*$/i);
  return { field, username: match?.[1]?.replace(/\.+$/, '').toLowerCase() || null,
    target: target?.[1]?.replace(/\.+$/, '').toLowerCase() || null,
    // Instagram rotates hint texts; an empty composer never shows an enabled Send button.
    genericPlaceholder: Boolean(field) && (/^(?:add a comment|tambahkan komentar|tulis komentar|mulai percakapan|gabung(?: dalam| ke)? percakapan|apa pendapat anda tentang ini|what do you think of this|(?:start|join)(?: a| the)? conversation)[.…?]*$/i.test(field.text || '') || !sendButton(nodes)) };
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
export const LIMITS = { posts: 50, comments: 100 };
// "bertahap" chains HP start times 10–20 s apart; "serentak" starts every HP at once.
export const START_MODES = ['bertahap', 'serentak'];
// Every selected account carries its own single target, post count, comment target and tone.
export function validatePlan(body, accountDevices) {
  if (!Array.isArray(body?.accounts) || !body.accounts.length || body.accounts.length > 100) throw new Error('Pilih minimal satu akun Instagram.');
  const selected = [];
  const ids = new Set();
  for (const entry of body.accounts) {
    if (!entry || typeof entry.serial !== 'string') throw new Error('Pilihan akun tidak valid.');
    const name = username(entry.username), device = accountDevices.find(d => d.serial === entry.serial);
    const account = device?.accounts.find(a => a.username === name);
    if (!account || account.disabled) throw new Error(`@${name} belum tersedia. Pindai akun HP terlebih dahulu.`);
    let target;
    try { target = username(entry.target); } catch { throw new Error(`Isi satu username target yang valid untuk @${name}.`); }
    if (target === name) throw new Error(`Target @${name} tidak boleh akunnya sendiri.`);
    if (!Number.isInteger(entry.posts) || entry.posts < 1 || entry.posts > LIMITS.posts) throw new Error(`Jumlah postingan @${name} harus 1–${LIMITS.posts}.`);
    if (!Number.isInteger(entry.comments) || entry.comments < 1 || entry.comments > LIMITS.comments) throw new Error(`Komentar per postingan @${name} harus 1–${LIMITS.comments}.`);
    if (!TONES.includes(entry.tone)) throw new Error(`Pilih nada komentar untuk @${name}.`);
    const key = `${entry.serial}:${name}`;
    if (!ids.has(key)) { ids.add(key); selected.push({ serial: entry.serial, username: name, target, posts: entry.posts, comments: entry.comments, tone: entry.tone }); }
  }
  if (body.startMode !== undefined && !START_MODES.includes(body.startMode)) throw new Error('Pilih cara mulai: bertahap atau serentak.');
  return { accounts: selected, startMode: body.startMode || 'bertahap' };
}
const BLOCKED = /try again later|coba lagi nanti|action blocked|tindakan (?:ini )?diblokir|we restrict certain activity|kami membatasi aktivitas/i;
export const blockedNotice = nodes => nodes.some(n => BLOCKED.test(`${n.text || ''} ${n['content-desc'] || ''}`));
