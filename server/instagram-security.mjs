// Only the currently focused/resumed activity is evidence. A historical
// ChallengeActivity elsewhere in the task stack must not block the device.
export function instagramChallengeActive(activities) {
  return String(activities).split('\n').some(line => /^\s*(?:topResumedActivity|mResumedActivity|mFocusedApp)=/.test(line) && /\bcom\.instagram\.android\/com\.instagram\.challenge\.activity\.ChallengeActivity(?:\s|\})/.test(line));
}
export function instagramChallengeError() {
  const error = new Error('Instagram membuka pemeriksaan keamanan (layar challenge). Selesaikan pemeriksaan di HP, lalu pindai akun lagi. Logout tidak diulang otomatis.');
  error.code = 'IG_AUTH_CHALLENGE';
  return error;
}
