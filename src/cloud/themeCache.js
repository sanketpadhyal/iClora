const STORAGE_KEY = 'iclora_cloud_accent_v1';

function normalizeHexColor(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function readAccentColorCache() {
  if (typeof window === 'undefined') return '';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return normalizeHexColor(raw) || '';
  } catch {
    return '';
  }
}

export function writeAccentColorCache(color) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeHexColor(color);
  if (!normalized) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, normalized);
  } catch {

  }
}

