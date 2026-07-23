import { apiFetch } from '../api/backendapi';

export const PHOTOS_CACHE_KEY = 'iclora_photos_cache_v1';
export const RECENTLY_DELETED_PHOTOS_CACHE_KEY = 'iclora_recently_deleted_photos_cache_v1';
export const PHOTO_LINKS_CACHE_KEY = 'iclora_photos_secure_links_v1';
export const MAX_PHOTO_UPLOAD_BATCH = 3;
export const ACCEPTED_PHOTO_UPLOAD_TYPES = 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif';
const PHOTO_UPLOAD_QUEUE_DB = 'iclora_photo_upload_queue_v1';
const PHOTO_UPLOAD_QUEUE_STORE = 'uploads';
const ALLOWED_PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']);
const ALLOWED_PHOTO_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif']);

export function isAcceptedPhotoUpload(file) {
  if (!file) return false;
  const mimeType = String(file.type || '').toLowerCase();
  const extension = String(file.name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  return ALLOWED_PHOTO_MIME_TYPES.has(mimeType) || ALLOWED_PHOTO_EXTENSIONS.has(extension);
}

export function photoUploadFingerprint(file = {}) {
  return [
    String(file.name || '').trim().toLowerCase(),
    Number(file.size || 0),
    Number(file.lastModified || 0),
    String(file.type || '').trim().toLowerCase(),
  ].join(':');
}

function createLocalObjectUrl(file) {
  return typeof URL !== 'undefined' && file ? URL.createObjectURL(file) : '';
}

function makeId(prefix) {
  return `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function openPhotoUploadQueueDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PHOTO_UPLOAD_QUEUE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PHOTO_UPLOAD_QUEUE_STORE)) {
        db.createObjectStore(PHOTO_UPLOAD_QUEUE_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function queuedLocalPhoto(localPhoto = {}) {
  const { src, thumbnailSrc, originalUrl, ...rest } = localPhoto;
  return rest;
}

export async function saveQueuedPhotoUploads(entries = []) {
  const db = await openPhotoUploadQueueDb();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_UPLOAD_QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(PHOTO_UPLOAD_QUEUE_STORE);
    entries.forEach((entry) => {
      store.put({
        id: entry.localPhoto.id,
        file: entry.file,
        localPhoto: queuedLocalPhoto(entry.localPhoto),
        uploadBatchId: entry.uploadBatchId || '',
        queuedAt: new Date().toISOString(),
      });
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function readQueuedPhotoUploads() {
  const db = await openPhotoUploadQueueDb();
  if (!db) return [];
  const records = await new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_UPLOAD_QUEUE_STORE, 'readonly');
    const request = tx.objectStore(PHOTO_UPLOAD_QUEUE_STORE).getAll();
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return records
    .filter((record) => record?.id && record?.file)
    .map((record) => {
      const objectUrl = createLocalObjectUrl(record.file);
      return {
        file: record.file,
        uploadBatchId: record.uploadBatchId || '',
        localPhoto: {
          ...(record.localPhoto || {}),
          id: record.id,
          src: objectUrl,
          thumbnailSrc: objectUrl,
          originalUrl: objectUrl,
          syncStatus: 'processing',
          date: 'Processing now',
          localOnly: true,
        },
      };
    });
}

export async function deleteQueuedPhotoUpload(id) {
  const db = await openPhotoUploadQueueDb();
  if (!db || !id) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_UPLOAD_QUEUE_STORE, 'readwrite');
    tx.objectStore(PHOTO_UPLOAD_QUEUE_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export function readPhotosCache() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PHOTOS_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writePhotosCache(payload) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PHOTOS_CACHE_KEY, JSON.stringify({
      ...payload,
      cachedAt: new Date().toISOString(),
    }));
    window.dispatchEvent(new CustomEvent('iclora:photos-preview-updated'));
  } catch {
  }
}

export function readRecentlyDeletedPhotosCache() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(RECENTLY_DELETED_PHOTOS_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeRecentlyDeletedPhotosCache(photos = []) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECENTLY_DELETED_PHOTOS_CACHE_KEY, JSON.stringify({
      photos: Array.isArray(photos) ? photos : [],
      cachedAt: new Date().toISOString(),
    }));
  } catch {
  }
}

export async function readJson(response) {
  return response.json().catch(() => ({}));
}

export async function apiJson(path, options = {}) {
  const response = await apiFetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const json = await readJson(response);
  if (!response.ok || json?.ok === false) {
    const error = new Error(json?.error || 'Request failed');
    error.status = response.status;
    error.body = json;
    throw error;
  }
  return json;
}

export function makeLocalPhoto(file) {
  const createdAt = new Date().toISOString();
  const objectUrl = createLocalObjectUrl(file);
  const title = file.name.replace(/\.[^.]+$/, '') || 'iClora Photo';
  const uploadFingerprint = photoUploadFingerprint(file);

  return {
    id: makeId('local'),
    uploadPhotoId: makeId('photo'),
    type: 'photo',
    resourceType: 'image',
    title,
    src: objectUrl,
    thumbnailSrc: objectUrl,
    originalUrl: objectUrl,
    mimeType: file.type,
    bytes: file.size,
    storageUsed: Number((file.size / (1024 * 1024)).toFixed(4)),
    originalFilename: file.name,
    uploadFingerprint,
    date: 'Processing now',
    shortDate: 'Today',
    uploadedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
    syncStatus: 'processing',
    localOnly: true,
  };
}

export async function uploadPhotoInBackground(file, options = {}) {
  const signature = await apiJson('/photos/upload-signature', {
    method: 'POST',
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type,
      bytes: file.size,
      uploadBatchId: options.uploadBatchId || '',
      photoId: options.photoId || '',
    }),
  });

  const formData = new FormData();
  Object.entries(signature.params || {}).forEach(([key, value]) => {
    formData.append(key, value);
  });
  formData.append('file', file);

  const uploadResponse = await fetch(signature.uploadUrl, {
    method: 'POST',
    body: formData,
  });
  const uploadJson = await readJson(uploadResponse);
  if (!uploadResponse.ok) {
    throw new Error(uploadJson?.error?.message || 'Cloudinary upload failed');
  }

  return apiJson('/photos', {
    method: 'POST',
    body: JSON.stringify({
      photoId: signature.photoId,
      title: file.name.replace(/\.[^.]+$/, ''),
      mimeType: file.type,
      publicId: uploadJson.public_id,
      assetId: uploadJson.asset_id,
      secureUrl: uploadJson.secure_url,
      resourceType: uploadJson.resource_type,
      format: uploadJson.format,
      bytes: uploadJson.bytes || file.size,
      width: uploadJson.width,
      height: uploadJson.height,
      originalFilename: uploadJson.original_filename || file.name,
      createdAt: uploadJson.created_at,
      cycle: 'no',
    }),
  });
}

function withAbsoluteShareUrl(link) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const path = link?.urlPath || (link?.token ? `/share/photos/${link.token}` : '');
  return {
    ...link,
    url: link?.url || (origin && path ? `${origin}${path}` : path),
  };
}

export function readPhotoLinks() {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PHOTO_LINKS_CACHE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map(withAbsoluteShareUrl) : [];
  } catch {
    return [];
  }
}

export function writePhotoLinks(links) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PHOTO_LINKS_CACHE_KEY, JSON.stringify(Array.isArray(links) ? links.map(withAbsoluteShareUrl) : []));
  } catch {
  }
}

export async function loadSecurePhotoLinks() {
  const json = await apiJson('/photos/share-links');
  const links = Array.isArray(json.links) ? json.links.map(withAbsoluteShareUrl) : [];
  writePhotoLinks(links);
  return links;
}

export async function createSecurePhotoLink(photo, durationHours) {
  const photos = Array.isArray(photo) ? photo : [photo].filter(Boolean);
  const json = await apiJson('/photos/share-links', {
    method: 'POST',
    body: JSON.stringify({
      photoId: photos[0]?.id,
      photoIds: photos.map((item) => item.id).filter(Boolean),
      durationHours,
    }),
  });
  const link = withAbsoluteShareUrl(json.link || {});
  const nextLinks = [link, ...readPhotoLinks().filter((item) => item.id !== link.id)].slice(0, 40);
  writePhotoLinks(nextLinks);
  return link;
}

export async function deleteSecurePhotoLink(linkId) {
  await apiJson(`/photos/share-links/${encodeURIComponent(linkId)}`, {
    method: 'DELETE',
  });
  const nextLinks = readPhotoLinks().filter((link) => link.id !== linkId);
  writePhotoLinks(nextLinks);
  return nextLinks;
}
