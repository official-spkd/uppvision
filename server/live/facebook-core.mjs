import { createHash } from 'node:crypto';
import { normalizeTarget } from '../platforms/facebook.mjs';

const packageName = 'com.facebook.katana';
export const label = node => node?.package === packageName ? (node['content-desc'] || node.text || '').trim() : '';
export const findLabel = (nodes, expression) => nodes.find(node => expression.test(label(node)));
const urls = nodes => [...new Set(nodes.map(label).filter(text => /^https:\/\/(?:www\.)?facebook\.com\//.test(text)))];

// Observed Facebook menu says both "Report Page" and "<name>'s Page link".
// A category or "followers" alone also appears on personal professional profiles.
export function pageIdentity(nodes, target) {
  const heading = nodes.map(label).find(text => /^.+['’]s Page link$/.test(text));
  if (!heading || !findLabel(nodes, /^Report Page$/)) throw new Error('Target belum terbukti Halaman Facebook; profil pribadi tidak didukung.');
  const canonical = normalizeTarget(target);
  const url = urls(nodes).find(value => { try { return normalizeTarget(value) === canonical; } catch { return false; } });
  if (!url) throw new Error('URL Halaman yang terbaca tidak cocok dengan target Facebook.');
  return { target: canonical, targetLabel: heading.replace(/['’]s Page link$/, ''), verified: true, targetType: 'page', evidence: ['Report Page', heading, url] };
}

export function ownIdentity(nodes) {
  if (!findLabel(nodes, /^Your profile link$/)) throw new Error('Link profil akun Facebook aktif belum terbaca.');
  const copy = nodes.map(label).find(text => /^Copy .+['’]s link$/.test(text));
  const candidates = urls(nodes);
  if (!copy || candidates.length !== 1) throw new Error('Identitas akun Facebook aktif belum lengkap.');
  const url = normalizeTarget(candidates[0]);
  const parsed = new URL(url);
  return { username: parsed.pathname === '/profile.php' ? parsed.searchParams.get('id') : parsed.pathname.slice(1), displayName: copy.replace(/^Copy /, '').replace(/['’]s link$/, ''), url, active: true };
}

export function composer(nodes) {
  const field = nodes.find(node => node.package === packageName && node.class === 'android.widget.AutoCompleteTextView');
  if (!field) return null;
  const prompt = (field['content-desc'] || field.text || '').match(/^Comment as (.+)$/);
  const text = field.text || '';
  const placeholder = !text || Boolean(prompt && text === prompt[0]);
  return { field, displayName: prompt?.[1] || null, draft: placeholder ? '' : text, placeholder };
}

export function sendButton(nodes, input = composer(nodes)) {
  const fieldBounds = input?.field?.bounds?.match(/\d+/g)?.map(Number);
  if (!fieldBounds || !input.draft) return null;
  const [left, top, right, bottom] = fieldBounds;
  const candidates = nodes.filter(node => {
    if (label(node) !== 'Send' || node.class !== 'android.widget.Button' || node.enabled !== 'true' || node.clickable !== 'true') return false;
    const bounds = node.bounds?.match(/\d+/g)?.map(Number);
    return bounds && bounds[0] >= (left + right) / 2 && bounds[1] >= top && bounds[1] <= bottom + 180 && bounds[3] > bounds[1];
  });
  return candidates.length === 1 ? candidates[0] : null;
}

export function postIdentity(nodes, page) {
  const ownerLabel = nodes.map(label).find(text => /^.+[’']s post$/.test(text));
  const owner = ownerLabel?.replace(/[’']s post$/, '');
  if (!page?.verified || page.targetType !== 'page' || owner !== page.targetLabel) throw new Error('Pemilik postingan Facebook tidak cocok dengan Halaman terverifikasi.');
  const timestampIndex = nodes.findIndex(node => /Shared with: Public$/.test(label(node)));
  if (timestampIndex < 0) throw new Error('Postingan Facebook publik belum terbaca.');
  const caption = nodes.slice(timestampIndex + 1).find(node => node.package === packageName && node.class === 'android.view.ViewGroup' && node.text?.trim().length > 30 && node.text === node['content-desc'])?.text?.trim();
  if (!caption || /(?:…|\.\.\.)?\s*See more$/.test(caption)) throw new Error('Caption lengkap postingan Facebook belum terbaca.');
  const id = `facebook-live:${createHash('sha256').update(`${page.target}\n${caption}`).digest('hex')}`;
  return { id, caption, owner, url: null, pinned: findLabel(nodes, /^(Pinned post|Pinned|Featured)$/) ? true : null, commentsEnabled: Boolean(composer(nodes)), existing: null, liked: null, identityMethod: 'page-and-caption', identityComplete: false, countsComplete: false };
}

export function verifyDraft(nodes, text) {
  const current = composer(nodes);
  if (!current || current.placeholder || current.draft !== text) throw new Error('Isi draft Facebook belum cocok dengan teks yang diminta.');
  return current;
}

const descendants = node => [node, ...(node?.children || []).flatMap(descendants)];

// Reopened reel UI exposes the full current caption on a Button, while the
// unrelated "UP NEXT" caption is a View/ViewGroup and must not match.
export function sameReel(nodes, record) {
  return Boolean(nodes.find(node => node.class === 'android.widget.Button' && label(node) === `${record.targetLabel}, Privacy setting Public`)
    && nodes.find(node => node.class === 'android.widget.Button' && label(node) === record.caption)
    && findLabel(nodes, /^Reel details$/));
}

export function renderedComment(nodes, record) {
  for (const textNode of nodes.filter(node => node.package === packageName && node.class === 'android.widget.Button' && node.text === record.text && label(node) === record.text)) {
    // Observed row: author picture/name/time + nested comment-text container.
    const row = textNode.parent?.parent;
    const author = row?.children?.find(node => node.class === 'android.widget.Button' && node.text === record.displayName && label(node) === record.displayName);
    const avatar = row?.children?.find(node => label(node) === `${record.displayName} profile picture`);
    const time = row?.children?.find(node => /^(Just now|\d+[smhdwy])$/.test(label(node)));
    const container = row?.parent;
    const content = container ? descendants(container) : [];
    if (!author || !avatar || !time || content.some(node => /^(Posting\.{0,3}|Sending\.{0,3}|Couldn't post|Failed|Retry|Try again)$/i.test(label(node)))) continue;
    const firstName = record.displayName.split(/\s+/)[0];
    if (!content.some(node => label(node).startsWith(`Reply to ${firstName}'s comment`))) continue;
    return { author: record.displayName, text: record.text, timestamp: label(time), hasReply: true };
  }
  return null;
}
