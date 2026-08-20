const STORAGE_KEY = 'iclora_auth_cache_v1';
const SESSION_TOKEN_KEY = 'iclora_session_token_v1';
const SESSION_EXPIRES_KEY = 'iclora_session_expires_at_v1';
const PROFILE_STORAGE_KEYS = ['iclora_cloud_profile_v1', 'iclora_cloud_profile_v2'];
const PROFILE_COMPLETED_KEY = 'iclora_profile_photo_completed';
const RECENT_SIGN_OUT_KEY = 'iclora_recent_sign_out_v1';
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const PROFILE_COMPLETED_GRACE_MS = 45 * 1000;
const RECENT_SIGN_OUT_BLOCK_MS = 15 * 1000;
const ICLORA_STORAGE_PREFIXES = ['iclora_', 'iclora:'];
const FIREBASE_STORAGE_PREFIXES = ['firebase:', 'firebaseLocalStorage'];
const INDEXED_DB_NAMES = [
  'firebaseLocalStorageDb',
  'firebase-installations-database',
  'firebase-heartbeat-database',
];

function shouldClearStorageKey(key) {
  if (!key || typeof key !== 'string') return false;
  if (ICLORA_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) return true;
  return FIREBASE_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function clearStorageNamespace(storage) {
  if (!storage) return;
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (shouldClearStorageKey(key)) storage.removeItem(key);
  }
}

function readRecentSignOutAt() {
  if (typeof window === 'undefined') return 0;
  try {
    const value = Number(window.localStorage.getItem(RECENT_SIGN_OUT_KEY) || 0);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function isRecentSignOutActive() {
  const signedOutAt = readRecentSignOutAt();
  return signedOutAt > 0 && Date.now() - signedOutAt < RECENT_SIGN_OUT_BLOCK_MS;
}

function markRecentSignOut() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECENT_SIGN_OUT_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

function clearRecentSignOut() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(RECENT_SIGN_OUT_KEY);
  } catch {
    // ignore
  }
}

function deleteIndexedDb(name) {
  if (typeof window === 'undefined' || !window.indexedDB || !name) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function clearIndexedDbCaches() {
  if (typeof window === 'undefined' || !window.indexedDB) return;
  const names = new Set(INDEXED_DB_NAMES);
  try {
    if (typeof window.indexedDB.databases === 'function') {
      const databases = await window.indexedDB.databases();
      databases.forEach((database) => {
        const name = database?.name || '';
        if (shouldClearStorageKey(name) || name.toLowerCase().includes('firebase')) {
          names.add(name);
        }
      });
    }
  } catch {
    // Some browsers do not allow listing IndexedDB databases.
  }
  await Promise.all(Array.from(names).map((name) => deleteIndexedDb(name)));
}

export function readAuthCache({ ttlMs = DEFAULT_TTL_MS } = {}) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > ttlMs) return null;
    if (typeof parsed.ok !== 'boolean') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeAuthCache(next) {
  if (typeof window === 'undefined') return;
  try {
    if (typeof next?.sessionToken === 'string' && next.sessionToken) {
      clearRecentSignOut();
      const expiresAt = Number.isFinite(Number(next?.sessionExpiresAt))
        ? Number(next.sessionExpiresAt)
        : Date.now() + DEFAULT_SESSION_TTL_MS;
      // Persist session across browser restarts (important on mobile/PWA).
      window.localStorage.setItem(SESSION_TOKEN_KEY, next.sessionToken);
      window.localStorage.setItem(SESSION_EXPIRES_KEY, String(expiresAt));
      // Remove old session-scoped copies if present from previous versions.
      window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
      window.sessionStorage.removeItem(SESSION_EXPIRES_KEY);
    } else if (next?.ok && isRecentSignOutActive()) {
      return;
    }
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ts: Date.now(),
        ok: Boolean(next?.ok),
        needsProfilePhoto: Boolean(next?.needsProfilePhoto),
      }),
    );
  } catch {
    // ignore
  }
}

export function readSessionToken() {
  if (typeof window === 'undefined') return '';
  try {
    const expiresAt = Number(
      window.localStorage.getItem(SESSION_EXPIRES_KEY)
      || window.sessionStorage.getItem(SESSION_EXPIRES_KEY)
      || 0
    );
    if (Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() >= expiresAt) {
      clearLoginData();
      void clearRuntimeCaches();
      return '';
    }
    return (
      window.localStorage.getItem(SESSION_TOKEN_KEY)
      || window.sessionStorage.getItem(SESSION_TOKEN_KEY)
      || ''
    );
  } catch {
    return '';
  }
}

export function readSessionExpiresAt() {
  if (typeof window === 'undefined') return 0;
  try {
    const expiresAt = Number(
      window.localStorage.getItem(SESSION_EXPIRES_KEY)
      || window.sessionStorage.getItem(SESSION_EXPIRES_KEY)
      || 0
    );
    return Number.isFinite(expiresAt) ? expiresAt : 0;
  } catch {
    return 0;
  }
}

export function clearAuthCache() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(SESSION_TOKEN_KEY);
    window.localStorage.removeItem(SESSION_EXPIRES_KEY);
    window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
    window.sessionStorage.removeItem(SESSION_EXPIRES_KEY);
  } catch {
    // ignore
  }
}

export function markProfilePhotoCompleted() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PROFILE_COMPLETED_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

export function isProfilePhotoCompletionActive() {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.sessionStorage.getItem(PROFILE_COMPLETED_KEY);
    if (!raw) return false;
    if (raw === '1') return true;
    const completedAt = Number(raw);
    return Number.isFinite(completedAt) && Date.now() - completedAt < PROFILE_COMPLETED_GRACE_MS;
  } catch {
    return false;
  }
}

export function clearProfilePhotoCompletion() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(PROFILE_COMPLETED_KEY);
  } catch {
    // ignore
  }
}

export function clearLoginData({ markSignOut = true } = {}) {
  if (typeof window === 'undefined') return;
  clearAuthCache();
  try {
    clearStorageNamespace(window.localStorage);
    clearStorageNamespace(window.sessionStorage);
    PROFILE_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
    clearProfilePhotoCompletion();
    if (markSignOut) {
      markRecentSignOut();
    } else {
      clearRecentSignOut();
    }
  } catch {
    // ignore
  }
}

export async function clearRuntimeCaches() {
  if (typeof window === 'undefined') return;

  await Promise.all([
    (async () => {
      if (!('caches' in window)) return;
      try {
        const keys = await window.caches.keys();
        await Promise.all(keys.map((key) => window.caches.delete(key)));
      } catch {
        // ignore
      }
    })(),
    clearIndexedDbCaches(),
  ]);
}
