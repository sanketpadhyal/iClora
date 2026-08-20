const STORAGE_PREFIX = 'iclora_device_activity_v1:';
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;

function getStorageKey(uid) {
  return `${STORAGE_PREFIX}${uid}`;
}

function normalizeSessions(value) {
  return Array.isArray(value) ? value.filter((session) => session && typeof session === 'object') : [];
}

export function readDeviceActivityCache(uid) {
  if (typeof window === 'undefined' || !uid) return null;
  try {
    const raw = window.localStorage.getItem(getStorageKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.updatedAt !== 'number' || Date.now() - parsed.updatedAt > MAX_CACHE_AGE_MS) return null;
    return {
      currentSessionId: typeof parsed.currentSessionId === 'string' ? parsed.currentSessionId : '',
      active: normalizeSessions(parsed.active),
      expired: normalizeSessions(parsed.expired),
    };
  } catch {
    return null;
  }
}

export function writeDeviceActivityCache(uid, activity) {
  if (typeof window === 'undefined' || !uid) return;
  try {
    window.localStorage.setItem(
      getStorageKey(uid),
      JSON.stringify({
        updatedAt: Date.now(),
        currentSessionId: typeof activity?.currentSessionId === 'string' ? activity.currentSessionId : '',
        active: normalizeSessions(activity?.active),
        expired: normalizeSessions(activity?.expired),
      })
    );
  } catch {
    // Cache is a speed boost only; ignore storage quota/private-mode failures.
  }
}
