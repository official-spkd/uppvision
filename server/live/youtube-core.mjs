export const youtubePackage = 'com.google.android.youtube';

// These selectors were observed on Samsung 13. They identify blocking screens,
// not a successful login or a verified channel/video.
export function screenBlocker(nodes) {
  const own = nodes.filter(node => node.package === youtubePackage);
  const modal = own.find(node => node['resource-id'] === 'android:id/message' && node.text === 'There was a problem signing in to your account');
  const title = own.find(node => node['resource-id'] === `${youtubePackage}:id/error_title` && node.text === "We couldn't sign you in");
  const advice = own.find(node => node['resource-id'] === `${youtubePackage}:id/error_message_text` && node.text === 'Try updating the app');
  const offline = own.find(node => node['resource-id'] === `${youtubePackage}:id/text` && node.text === 'No connection');
  const channelRequired = own.find(node => node['content-desc'] === 'Create a channel');
  const accountPage = own.some(node => node['content-desc'] === 'Accounts');
  if (modal || title) return {
    code: 'YOUTUBE_SIGNIN_BLOCKED',
    message: 'YouTube tidak dapat masuk ke akun pada HP ini. Akun aktif dan channel tujuan belum dapat diverifikasi.',
    evidence: [modal, title, advice, offline].filter(Boolean).map(node => ({ text: node.text, resourceId: node['resource-id'] })),
  };
  if (channelRequired && accountPage) return {
    code: 'YOUTUBE_CHANNEL_REQUIRED',
    message: 'Halaman akun YouTube menampilkan Create a channel; channel aktif untuk berkomentar belum tersedia atau belum terverifikasi.',
    evidence: [{ text: channelRequired['content-desc'], resourceId: channelRequired['resource-id'] }, ...(offline ? [{ text: offline.text, resourceId: offline['resource-id'] }] : [])],
  };
  if (offline) return {
    code: 'YOUTUBE_OFFLINE',
    message: 'YouTube menampilkan No connection. Channel tujuan dan status kiriman belum dapat diverifikasi.',
    evidence: [{ text: offline.text, resourceId: offline['resource-id'] }],
  };
  return null;
}

export function verificationError(nodes) {
  const blocker = screenBlocker(nodes);
  const error = new Error(blocker?.message || 'Layar akun, channel, video, dan pengiriman YouTube belum terverifikasi pada perangkat ini.');
  error.code = blocker?.code || 'YOUTUBE_UI_UNVERIFIED';
  error.evidence = blocker?.evidence || [];
  return error;
}
