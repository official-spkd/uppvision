import { createHash } from 'node:crypto';

const flat = node => [node, ...node.children.flatMap(flat)];
const box = node => node?.bounds?.match(/\d+/g)?.map(Number) || [];
const threadsNodes = nodes => nodes.filter(node => node.package === 'com.instagram.barcelona');
export const byDescription = (nodes, description) => threadsNodes(nodes).find(node => node['content-desc'] === description);

// These identifiers were observed on the Android Threads UI. Missing evidence
// remains unknown; it must never silently become a successful account/post read.
export function profileIdentity(nodes, { own = false } = {}) {
  nodes = threadsNodes(nodes);
  const picture = nodes.find(node => node['resource-id'] === 'ProfilePicture');
  if (!picture || !nodes.some(node => node['resource-id'] === 'profile_screen_ig_app_switcher')) return null;
  if (own && !nodes.some(node => node.text === 'Edit profile')) return null;
  const texts = nodes.filter(node => node['resource-id'] === 'ig_text' && node.text);
  const bottom = box(picture)[3];
  const handle = texts.find(node => box(node)[1] >= bottom && /^[a-z0-9_.]+$/i.test(node.text));
  const title = texts.find(node => box(node)[1] >= box(picture)[1] && box(node)[1] < bottom);
  if (!handle || !title) return null;
  return { username: handle.text.toLowerCase(), displayName: title.text };
}

export function visiblePosts(nodes, target) {
  // Compose accessibility traversal can list a caption before its header.
  // Pair by observed vertical position rather than raw XML order.
  nodes = threadsNodes(nodes).filter(node => ['feed_post_header', 'feed_post_text'].includes(node['resource-id']))
    .sort((a, b) => (box(a)[1] ?? 0) - (box(b)[1] ?? 0));
  const posts = [];
  let owner = null;
  for (const node of nodes) {
    if (node['resource-id'] === 'feed_post_header') {
      const marker = threadsNodes(flat(node)).find(child => /^([a-z0-9_.]+) posted$/i.test(child['content-desc'] || ''));
      owner = marker?.['content-desc'].replace(/ posted$/, '').toLowerCase() || null;
    }
    if (node['resource-id'] !== 'feed_post_text' || owner !== target) continue;
    const caption = threadsNodes(flat(node)).filter(child => child.text).map(child => child.text).join(' ').trim();
    if (!caption) continue;
    posts.push({
      id: `threads-content:${createHash('sha256').update(JSON.stringify([owner, caption])).digest('hex').slice(0, 24)}`,
      caption, owner, url: null, pinned: null, commentsEnabled: null, existing: null, liked: null,
      identityEvidence: 'owner-and-caption-only', node,
    });
  }
  return posts;
}

export function detailControls(nodes, target) {
  nodes = threadsNodes(nodes);
  if (!nodes.some(node => node['resource-id'] === 'PermalinkScreen')) return { commentsEnabled: null, liked: null };
  const reply = byDescription(nodes, `Reply to ${target}`);
  const like = nodes.find(node => node['resource-id'] === 'feed_post_ufi_like_button');
  let liked = null;
  // Only the unliked "Like" state has been physically observed so far.
  if (like?.['content-desc'] === 'Like' && like.selected === 'false') liked = false;
  return { commentsEnabled: reply ? true : null, liked };
}

export function replyField(nodes) {
  return threadsNodes(nodes).find(node => node['resource-id'] === 'permalink_inline_composer' && node.class === 'android.widget.EditText') || null;
}

export function expandedComposer(nodes) {
  nodes = threadsNodes(nodes);
  const field = nodes.find(node => node['resource-id'] === 'new_thread_screen_composer' && node.class === 'android.widget.EditText');
  if (!field || !byDescription(nodes, 'Cancel') || !nodes.some(node => node.text === 'Reply')) return null;
  const scope = threadsNodes(flat(field.parent));
  const photo = scope.find(node => /^([a-z0-9_.]+) profile photo$/i.test(node['content-desc'] || ''));
  const username = photo?.['content-desc'].replace(/ profile photo$/, '').toLowerCase();
  const sender = scope.find(node => node.class === 'android.widget.Button' && node['content-desc'] === username);
  const placeholder = threadsNodes(flat(field)).find(node => /^Reply to [a-z0-9_.]+…$/.test(node['content-desc'] || ''));
  const target = placeholder?.['content-desc'].slice(9, -1);
  const postRoot = nodes.find(node => node['resource-id'] === 'new_thread_screen_post_button');
  const button = postRoot && threadsNodes(flat(postRoot)).find(node => node.clickable === 'true' && node.enabled === 'true');
  return { field, username: sender ? username : null, target: target || null, text: field.text || '', button: button || null };
}

// Negative evidence is fail-closed: a matching author/text row alone must not
// count while the app still presents a pending/error/retry status.
export function submissionPendingOrFailed(nodes) {
  return threadsNodes(nodes).some(node => [node.text, node['content-desc']].some(value =>
    /^(?:posting|sending|uploading|try again|retry|post failed|failed to post|couldn['’]t post|not posted|mengirim|sedang mengirim|coba lagi|gagal mengirim)(?:[.!… ]*)$/i.test(value || '')));
}
