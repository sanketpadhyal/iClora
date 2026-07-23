import { readSessionToken } from '../auth/authCache';

const RAW_BACKEND_URL = process.env.REACT_APP_BACKEND_API_URL || '/api';
const RESPONSE_SESSION_TOKEN_KEY = '__icloraRequestSessionToken';

export const BACKEND_API_URL = RAW_BACKEND_URL.replace(/\/+$/, '');

export function apiUrl(path) {
  if (!path) return BACKEND_API_URL;
  if (/^https?:\/\//i.test(path)) return path;
  return `${BACKEND_API_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export function getSessionToken() {
  return readSessionToken();
}

function tagResponseSession(response, token) {
  try {
    Object.defineProperty(response, RESPONSE_SESSION_TOKEN_KEY, {
      value: token || '',
      enumerable: false,
    });
  } catch {
  }
  return response;
}

export function isStaleSessionResponse(response) {
  if (!response || response.status !== 401) return false;
  const requestToken = response[RESPONSE_SESSION_TOKEN_KEY];
  if (!requestToken) return false;
  const currentToken = readSessionToken();
  return Boolean(currentToken) && currentToken !== requestToken;
}

export async function apiFetch(path, options = {}) {
  const { skipAuth = false, timeoutMs = 0, signal, ...fetchOptions } = options;
  const token = getSessionToken();
  const headers = new Headers(fetchOptions.headers || {});
  const normalizedPath = typeof path === 'string' ? path : '';
  const isAuthOrUserEndpoint = /^\/(auth|users)\//.test(normalizedPath);
  if (!skipAuth && token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const controller = timeoutMs > 0 ? new AbortController() : null;
  let timeoutId = 0;

  if (controller && signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    }
  }

  if (controller) {
    timeoutId = window.setTimeout(() => {
      const reason = new DOMException('Request timed out', 'TimeoutError');
      controller.abort(reason);
    }, timeoutMs);
  }

  try {
    const response = await fetch(apiUrl(path), {
      ...fetchOptions,
      headers,
      signal: controller ? controller.signal : signal,
      credentials: fetchOptions.credentials || 'include',
      cache: fetchOptions.cache || (isAuthOrUserEndpoint ? 'no-store' : undefined),
    });
    return tagResponseSession(response, token);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
}
