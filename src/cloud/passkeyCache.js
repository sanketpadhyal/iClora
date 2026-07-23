const STORAGE_KEY = 'iclora_passkey_summary_v1';
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;

function normalizePasskeys(value) {
  return Array.isArray(value) ? value.filter((passkey) => passkey && typeof passkey === 'object') : [];
}

export function readPasskeyCache() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.updatedAt !== 'number' || Date.now() - parsed.updatedAt > MAX_CACHE_AGE_MS) return null;
    return {
      passkeys: normalizePasskeys(parsed.passkeys),
      lastLogin: parsed.lastLogin || null,
    };
  } catch {
    return null;
  }
}

export function writePasskeyCache(info) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        updatedAt: Date.now(),
        passkeys: normalizePasskeys(info?.passkeys),
        lastLogin: info?.lastLogin || null,
      })
    );
  } catch {

  }
}
