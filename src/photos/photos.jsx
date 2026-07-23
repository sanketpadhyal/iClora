import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import JSZip from 'jszip';
import { reauthenticateWithPopup, signInWithPopup } from 'firebase/auth';
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import {
  FiChevronLeft,
  FiChevronRight,
  FiCheck,
  FiClock,
  FiCloud,
  FiEye,
  FiEyeOff,
  FiFolder,
  FiGrid,
  FiHeart,
  FiImage,
  FiInfo,
  FiLink,
  FiMenu,
  FiMinus,
  FiMoreHorizontal,
  FiPlus,
  FiPlusCircle,
  FiRefreshCcw,
  FiSearch,
  FiSidebar,
  FiTrash2,
  FiX,
} from 'react-icons/fi';
import { FaHeart } from 'react-icons/fa';
import { IoCloudUploadOutline, IoShareOutline } from 'react-icons/io5';
import { apiFetch, isStaleSessionResponse } from '../api/backendapi';
import { readSessionToken } from '../auth/authCache';
import { getGoogleAuthDependencies } from '../auth/firebase';
import { clearSignedOutData } from '../auth/sessionCleanup';
import { readAccentColorCache } from '../cloud/themeCache';
import { readUserProfileCache, writeUserProfileCache } from '../cloud/userProfileCache';
import { useAlert } from '../alert/alert';
import AppleLoader from '../components/AppleLoader';
import DownloadIcon from '../components/DownloadIcon';
import { applyAppPageMeta } from '../components/utils/pageMeta';
import DashboardNavbar from '../cloud/dashboardnavbar';
import {
  ACCEPTED_PHOTO_UPLOAD_TYPES,
  MAX_PHOTO_UPLOAD_BATCH,
  apiJson,
  createSecurePhotoLink,
  deleteQueuedPhotoUpload,
  deleteSecurePhotoLink,
  isAcceptedPhotoUpload,
  loadSecurePhotoLinks,
  makeLocalPhoto,
  photoUploadFingerprint,
  readJson,
  readPhotoLinks,
  readPhotosCache,
  readRecentlyDeletedPhotosCache,
  readQueuedPhotoUploads,
  saveQueuedPhotoUploads,
  uploadPhotoInBackground,
  writePhotoLinks,
  writePhotosCache,
  writeRecentlyDeletedPhotosCache,
} from './photoBackendProcess';
import '../cloud/manage_account/manage.css';
import './photos.css';

const ICLORA_PHOTOS_APP_DOWNLOAD_URL = process.env.REACT_APP_ICLORA_APP_DOWNLOAD_URL || '#';

const SIDEBAR_SECTIONS = [
  {
    title: 'Photos',
    items: [
      { id: 'library', label: 'Library', icon: <FiImage /> },
      { id: 'favourites', label: 'Favourites', icon: <FiHeart /> },
      { id: 'recents', label: 'Recents', icon: <FiClock /> },
    ],
  },
  {
    title: 'Collections',
    items: [
      { id: 'hidden', label: 'Hidden', icon: <FiEyeOff /> },
      { id: 'deleted', label: 'Recently Deleted', icon: <FiTrash2 /> },
    ],
  },
  {
    title: 'Sharing',
    items: [
      { id: 'links', label: 'iClora Links', icon: <FiCloud /> },
      { id: 'download-app', label: 'Download Photos App', icon: <DownloadIcon size={18} />, externalUrl: ICLORA_PHOTOS_APP_DOWNLOAD_URL },
    ],
  },
];

const GRID_SIZES = [84, 108, 132];
const MOBILE_GRID_SIZES = [72, 90, 114];
const VIEWER_CLOSE_TRANSITION_MS = 360;
const VIEWER_INFO_CLOSE_MS = 220;
const VIEWER_DIRECT_OPEN_BYTES = 6 * 1024 * 1024;
const MOBILE_UPLOAD_MAX = 2;
const AI_SEARCH_VIEW = 'ai-search';
const PHOTO_PENDING_ACTIONS_KEY = 'iclora_photos_pending_actions_v1';
const PHOTO_PATCH_KEYS = ['favourite', 'hidden'];
const PHOTO_PAGE_SIZE = 60;
const PHOTO_SKELETON_TILE_COUNT = 24;

function ShareIcon() {
  return <IoShareOutline className="iclora-share-action-icon" aria-hidden="true" focusable="false" />;
}

function getUploadBatchLimit() {
  if (typeof window === 'undefined') return MAX_PHOTO_UPLOAD_BATCH;
  return window.innerWidth <= 900 ? MOBILE_UPLOAD_MAX : MAX_PHOTO_UPLOAD_BATCH;
}

function normalizePhoto(photo = {}) {
  const id = String(photo.id || '').trim();
  if (!id) return null;
  const resourceType = photo.resourceType || (photo.type === 'video' ? 'video' : 'image');
  const type = resourceType === 'video' || photo.type === 'video' ? 'video' : 'photo';
  const fallbackSrc = photo.originalUrl || photo.src || photo.thumbnailSrc || '';
  const isDefaultPhoto = id === 'iclora-default-photo';
  const src = isDefaultPhoto ? '/logo.webp' : fallbackSrc;
  const thumbnailSrc = isDefaultPhoto ? '/logo.webp' : (photo.thumbnailSrc || photo.src || src);
  return {
    ...photo,
    id,
    type,
    resourceType,
    src,
    thumbnailSrc,
    title: photo.title || photo.originalFilename || 'iClora Photo',
    date: photo.date || 'Today',
    shortDate: photo.shortDate || (photo.date ? String(photo.date).split(' at ')[0] : 'Today'),
    location: photo.location || '',
    favourite: Boolean(photo.favourite),
    hidden: Boolean(photo.hidden),
    deleted: Boolean(photo.deleted),
    duration: photo.duration || '',
  };
}

function searchableText(photo = {}) {
  return [
    photo.title,
    photo.originalFilename,
    photo.date,
    photo.shortDate,
    photo.location,
    photo.visionLabel,
    photo.visionCaption,
    photo.searchText,
    ...(Array.isArray(photo.visionTags) ? photo.visionTags : []),
  ].filter(Boolean).join(' ').toLowerCase();
}

const AI_SEARCH_STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'it', 'in', 'on', 'of', 'at', 'to', 'for',
  'and', 'or', 'but', 'not', 'no', 'by', 'as', 'if', 'so', 'up',
  'with', 'from', 'into', 'that', 'this', 'has', 'was', 'are', 'be',
  'my', 'me', 'i', 'we', 'he', 'she', 'they', 'you', 'do', 'did',
]);

function searchTokens(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
}

function aiSearchFilterTokens(value = '') {
  const tokens = searchTokens(value);
  const meaningful = tokens.filter((t) => !AI_SEARCH_STOP_WORDS.has(t));
  return meaningful.length > 0 ? meaningful : tokens;
}

function photoTimeDesc(a = {}, b = {}) {
  const bTime = Date.parse(b.uploadedAt || b.createdAt || b.updatedAt || '') || 0;
  const aTime = Date.parse(a.uploadedAt || a.createdAt || a.updatedAt || '') || 0;
  return bTime - aTime;
}

function normalizePhotos(items = []) {
  return items.map(normalizePhoto).filter(Boolean);
}

function normalizePendingPhotoActions(value = {}) {
  const deletes = Array.from(new Set(Array.isArray(value.deletes) ? value.deletes : []))
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  const patches = {};
  Object.entries(value.patches || {}).forEach(([id, patch]) => {
    const cleanId = String(id || '').trim();
    if (!cleanId || !patch || typeof patch !== 'object') return;
    const cleanPatch = {};
    PHOTO_PATCH_KEYS.forEach((key) => {
      if (typeof patch[key] === 'boolean') cleanPatch[key] = patch[key];
    });
    if (Object.keys(cleanPatch).length) patches[cleanId] = cleanPatch;
  });
  return { deletes, patches };
}

function readPendingPhotoActions() {
  if (typeof window === 'undefined') return { deletes: [], patches: {} };
  try {
    return normalizePendingPhotoActions(JSON.parse(window.localStorage.getItem(PHOTO_PENDING_ACTIONS_KEY) || '{}'));
  } catch {
    return { deletes: [], patches: {} };
  }
}

function writePendingPhotoActions(nextPending) {
  if (typeof window === 'undefined') return;
  const cleanPending = normalizePendingPhotoActions(nextPending);
  const hasActions = cleanPending.deletes.length || Object.keys(cleanPending.patches).length;
  try {
    if (hasActions) {
      window.localStorage.setItem(PHOTO_PENDING_ACTIONS_KEY, JSON.stringify(cleanPending));
    } else {
      window.localStorage.removeItem(PHOTO_PENDING_ACTIONS_KEY);
    }
  } catch {
  }
}

function addPendingPhotoPatch(id, patch) {
  if (!id) return;
  const pending = readPendingPhotoActions();
  const cleanPatch = {};
  PHOTO_PATCH_KEYS.forEach((key) => {
    if (typeof patch?.[key] === 'boolean') cleanPatch[key] = patch[key];
  });
  if (!Object.keys(cleanPatch).length) return;
  pending.patches[id] = { ...(pending.patches[id] || {}), ...cleanPatch };
  writePendingPhotoActions(pending);
}

function clearPendingPhotoPatch(id, patch, options = {}) {
  if (!id) return {};
  const pending = readPendingPhotoActions();
  const currentPatch = { ...(pending.patches[id] || {}) };
  const keys = PHOTO_PATCH_KEYS.filter((key) => typeof patch?.[key] === 'boolean');
  keys.forEach((key) => {
    if (!options.onlyMatching || currentPatch[key] === patch[key]) delete currentPatch[key];
  });
  if (Object.keys(currentPatch).length) {
    pending.patches[id] = currentPatch;
  } else {
    delete pending.patches[id];
  }
  writePendingPhotoActions(pending);
  return currentPatch;
}

function pendingPatchStillMatches(id, patch) {
  const currentPatch = readPendingPhotoActions().patches[id] || {};
  return PHOTO_PATCH_KEYS
    .filter((key) => typeof patch?.[key] === 'boolean')
    .every((key) => currentPatch[key] === patch[key]);
}

function addPendingPhotoDelete(ids = []) {
  const pending = readPendingPhotoActions();
  const deleteIds = Array.from(new Set(ids)).filter(Boolean);
  if (!deleteIds.length) return;
  const deleteSet = new Set([...pending.deletes, ...deleteIds]);
  deleteIds.forEach((id) => delete pending.patches[id]);
  pending.deletes = Array.from(deleteSet);
  writePendingPhotoActions(pending);
}

function clearPendingPhotoDelete(ids = []) {
  const pending = readPendingPhotoActions();
  const clearSet = new Set(ids.filter(Boolean));
  if (!clearSet.size) return;
  pending.deletes = pending.deletes.filter((id) => !clearSet.has(id));
  writePendingPhotoActions(pending);
}

function applyPendingPhotoActions(items = []) {
  const pending = readPendingPhotoActions();
  const deleteSet = new Set(pending.deletes);
  return normalizePhotos(items)
    .filter((photo) => !deleteSet.has(photo.id))
    .map((photo) => normalizePhoto({ ...photo, ...(pending.patches[photo.id] || {}) }))
    .filter(Boolean);
}

function removeCachedLocalUploadPhotos(items = []) {
  return normalizePhotos(items).filter((photo) => !photo.localOnly);
}

function dedupePhotos(items = []) {
  const seenIds = new Set();
  const seenLocalUploads = new Set();
  const uniquePhotos = [];
  for (const photo of normalizePhotos(items)) {
    if (seenIds.has(photo.id)) continue;
    if (photo.localOnly) {
      const uploadKey = photo.uploadFingerprint || [
        String(photo.originalFilename || photo.title || '').trim().toLowerCase(),
        Number(photo.bytes || 0),
        String(photo.mimeType || '').trim().toLowerCase(),
      ].join(':');
      if (seenLocalUploads.has(uploadKey)) continue;
      seenLocalUploads.add(uploadKey);
    }
    seenIds.add(photo.id);
    uniquePhotos.push(photo);
  }
  return uniquePhotos;
}

async function ensurePhotosSetup() {
  return apiJson('/photos/setup', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

function getElementRect(element) {
  const rect = element?.getBoundingClientRect?.();
  if (!rect) return null;
  const image = element?.querySelector?.('img');
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    naturalWidth: image?.naturalWidth || 0,
    naturalHeight: image?.naturalHeight || 0,
  };
}

function getPhotosNavbarHeight() {
  if (typeof document === 'undefined') return 0;
  const root = document.querySelector('.iclora-photos');
  if (!root) return 0;
  const probe = document.createElement('div');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.height = 'var(--photos-navbar-height)';
  root.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(height) ? height : 0;
}

function getClosingElementRect(element) {
  if (!element) return null;
  const rect = getElementRect(element);
  if (!rect) return null;
  return {
    ...rect,
    top: rect.top + getPhotosNavbarHeight(),
  };
}

function findPhotoTileById(photoId) {
  if (typeof document === 'undefined' || !photoId) return null;
  return Array.from(document.querySelectorAll('[data-photo-id]'))
    .find((element) => element.dataset.photoId === photoId) || null;
}

function transitionStyle(rect) {
  if (!rect || typeof window === 'undefined') return {};
  const isMobile = window.innerWidth <= 900;
  const maxWidth = Math.max(1, window.innerWidth);
  const maxHeight = isMobile ? Math.max(1, window.innerHeight - 152) : Math.max(1, window.innerHeight - 196);
  const ratio = rect.naturalWidth > 0 && rect.naturalHeight > 0 ? rect.naturalWidth / rect.naturalHeight : maxWidth / maxHeight;
  const finalWidth = ratio >= maxWidth / maxHeight ? maxWidth : maxHeight * ratio;
  const finalHeight = ratio >= maxWidth / maxHeight ? maxWidth / ratio : maxHeight;
  const startCenterX = rect.left + (rect.width / 2);
  const startCenterY = rect.top + (rect.height / 2);
  const finalCenterX = window.innerWidth / 2;
  const finalCenterY = window.innerHeight / 2;
  return {
    '--photo-start-left': `${rect.left}px`,
    '--photo-start-top': `${rect.top}px`,
    '--photo-start-width': `${rect.width}px`,
    '--photo-start-height': `${rect.height}px`,
    '--photo-final-width': `${finalWidth}px`,
    '--photo-final-height': `${finalHeight}px`,
    '--photo-start-translate-x': `${startCenterX - finalCenterX}px`,
    '--photo-start-translate-y': `${startCenterY - finalCenterY}px`,
    '--photo-start-scale-x': Math.max(0.04, rect.width / finalWidth),
    '--photo-start-scale-y': Math.max(0.04, rect.height / finalHeight),
  };
}

function photoCountLabel(photos) {
  const photoCount = photos.filter((photo) => photo.type !== 'video').length;
  return `${photoCount} Photo${photoCount === 1 ? '' : 's'}`;
}

function filesStorageMb(files = []) {
  const bytes = files.reduce((total, file) => total + Number(file?.size || 0), 0);
  return Number((bytes / (1024 * 1024)).toFixed(4));
}

function splitPhotoDate(value = '') {
  const [date = '', time = ''] = value.split(' at ');
  return { date, time };
}

function formatPhotoBytes(bytes) {
  const amount = Number(bytes || 0);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  if (amount < 1024 * 1024) return `${Math.max(1, Math.round(amount / 1024))} KB`;
  return `${(amount / (1024 * 1024)).toFixed(amount >= 10 * 1024 * 1024 ? 1 : 2)} MB`;
}

function formatPhotoDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function normalizeDownloadBaseName(value = '') {
  return String(value || '')
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim();
}

function resolvePhotoDownloadExtension(photo = {}) {
  const format = String(photo.format || '').trim().toLowerCase();
  if (format) return format === 'jpeg' ? 'jpg' : format;
  const mime = String(photo.mimeType || '').trim().toLowerCase();
  if (mime.startsWith('image/')) {
    const subtype = mime.replace('image/', '').split(';')[0].trim();
    if (subtype) return subtype === 'jpeg' ? 'jpg' : subtype;
  }
  const src = String(photo.src || photo.originalUrl || '');
  const cleanSrc = src.split('?')[0].split('#')[0];
  const ext = cleanSrc.match(/\.([a-z0-9]+)$/i)?.[1] || '';
  return ext ? ext.toLowerCase() : 'jpg';
}

function isVisionCyclePending(photo = {}) {
  if (!photo || photo.localOnly) return false;
  if (photo.cycle === 'yes' || photo.visionLabel || photo.visionCaption || photo.searchText) return false;
  return photo.cycle === 'no'
    || photo.cycle === 'processing'
    || ['queued', 'processing', 'failed'].includes(photo.visionCycleStatus);
}

function visionCycleLabel(photo = {}) {
  return isVisionCyclePending(photo) ? 'Not synced' : 'Synced';
}

function visionCycleSourceLabel(photo = {}) {
  const source = String(photo.visionCycleSource || '').trim().toLowerCase();
  if (source === 'cycle-1' || source === 'cycle1' || source === 'primary') return 'Cycle 1';
  if (source === 'fallback') return 'Fallback';
  return '';
}

function visionCycleNotice(photo = {}) {
  if (!isVisionCyclePending(photo)) return '';
  if (photo.visionCycleStatus === 'processing' || photo.cycle === 'processing') return 'Vision syncing now';
  if (photo.visionCycleStatus === 'failed') return 'Waiting for next vision syncing cycle';
  return 'This photo is about to enter vision syncing cycle';
}

function getPhotoInfoRows(photo, selectedPhotoDate = {}) {
  if (!photo) return [];
  const typeLabel = photo.resourceType === 'video' || photo.type === 'video' ? 'Video' : 'Image';
  const dimensions = Number(photo.width) > 0 && Number(photo.height) > 0 ? `${photo.width} x ${photo.height}` : '';
  const status = photo.syncStatus === 'processing'
    ? 'Processing'
    : photo.syncStatus === 'failed'
      ? 'Upload failed'
      : photo.localOnly
        ? 'Pending upload'
        : 'Synced';
  return [
    ['Kind', typeLabel],
    ['Date', selectedPhotoDate.date || photo.shortDate || ''],
    ['Time', selectedPhotoDate.time || ''],
    ['Size', formatPhotoBytes(photo.bytes)],
    ['Dimensions', dimensions],
    ['Format', String(photo.format || photo.mimeType || '').replace(/^image\//, '').replace(/^video\//, '').toUpperCase()],
    ['Location', photo.location],
    ['Uploaded', formatPhotoDateTime(photo.uploadedAt || photo.createdAt)],
    ['Modified', formatPhotoDateTime(photo.updatedAt)],
    ['Status', status],
    ['Synced by', photo.syncedBy || photo.syncedByEmail],
    ['Device Name', photo.syncedDeviceName || photo.deviceName],
    ['Vision', visionCycleLabel(photo)],
    ['Vision Cycle', visionCycleSourceLabel(photo)],
    ['Favourite', photo.favourite ? 'Yes' : 'No'],
    ['Visibility', photo.hidden ? 'Hidden' : 'Visible'],
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim());
}

function skipsViewerOpenAnimation(photo = {}) {
  return Number(photo?.bytes || 0) > VIEWER_DIRECT_OPEN_BYTES;
}

export default function Photos() {
  const location = useLocation();
  const navigate = useNavigate();
  const { photoId: routePhotoId } = useParams();
  const { showAlert } = useAlert();
  const cachedPhotos = useMemo(() => readPhotosCache(), []);
  const cachedRecentlyDeleted = useMemo(() => readRecentlyDeletedPhotosCache(), []);
  const hasCachedPhotos = Boolean(cachedPhotos?.photos?.length);
  const [profile, setProfile] = useState(() => readUserProfileCache() || {});
  const [photos, setPhotos] = useState(() => applyPendingPhotoActions(cachedPhotos?.photos || []).filter((photo) => !photo.hidden));
  const [photosMeta, setPhotosMeta] = useState(() => cachedPhotos?.meta || {});
  const [photosLoading, setPhotosLoading] = useState(!hasCachedPhotos);
  const [photosPageLoading, setPhotosPageLoading] = useState(false);
  const [photosPagination, setPhotosPagination] = useState({ cursor: '', hasMore: false });
  const [photosFirstLoadDone, setPhotosFirstLoadDone] = useState(hasCachedPhotos);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadDraftFiles, setUploadDraftFiles] = useState([]);
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const [uploadPreviewModalFile, setUploadPreviewModalFile] = useState(null);
  const [shareModalPhoto, setShareModalPhoto] = useState(null);
  const [shareDurationModalPhoto, setShareDurationModalPhoto] = useState(null);
  const [shareLinkResult, setShareLinkResult] = useState(null);
  const [downloadModalPhoto, setDownloadModalPhoto] = useState(null);
  const [downloadFileName, setDownloadFileName] = useState('');
  const [downloadPending, setDownloadPending] = useState(false);
  const [photoDeleteTarget, setPhotoDeleteTarget] = useState(null);
  const [photoPermanentDeleteTarget, setPhotoPermanentDeleteTarget] = useState(null);
  const [photoRestoreTarget, setPhotoRestoreTarget] = useState(null);
  const [photoUnhideTarget, setPhotoUnhideTarget] = useState(null);
  const [hiddenAuthModal, setHiddenAuthModal] = useState(null);
  const [hiddenAuthPreparing, setHiddenAuthPreparing] = useState(false);
  const [hiddenAuthBusy, setHiddenAuthBusy] = useState(false);
  const [hiddenProviderBusy, setHiddenProviderBusy] = useState('');
  const [hiddenViewUnlocked, setHiddenViewUnlocked] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const [linkDeleteTarget, setLinkDeleteTarget] = useState(null);
  const [linkDeleting, setLinkDeleting] = useState(false);
  const [secureLinks, setSecureLinks] = useState(() => readPhotoLinks());
  const [activeView, setActiveView] = useState('library');
  const query = '';
  const [aiSearchQuery, setAiSearchQuery] = useState('');
  const [aiSubmittedQuery, setAiSubmittedQuery] = useState('');
  const [aiSearchFocused, setAiSearchFocused] = useState(false);
  const [gridZoom, setGridZoom] = useState(() => (typeof window !== 'undefined' && window.innerWidth <= 900 ? 1 : 0));
  const [viewerZoom, setViewerZoom] = useState(1.25);
  const [selectedId, setSelectedId] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState([]);
  const [selectedDownloadPending, setSelectedDownloadPending] = useState(false);
  const [viewerPhase, setViewerPhase] = useState('closed');
  const [transitionRect, setTransitionRect] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tileMenu, setTileMenu] = useState(null);
  const [viewerActionsOpen, setViewerActionsOpen] = useState(false);
  const [viewerInfoOpen, setViewerInfoOpen] = useState(false);
  const [viewerInfoClosing, setViewerInfoClosing] = useState(false);
  const [viewerChromeHidden, setViewerChromeHidden] = useState(false);
  const [viewerImageLoading, setViewerImageLoading] = useState(false);
  const [viewerSlideDirection, setViewerSlideDirection] = useState('');
  const [pageEntered, setPageEntered] = useState(false);
  const [favouritePopKey, setFavouritePopKey] = useState(0);
  const viewerTimerRef = useRef(null);
  const viewerCloseFrameRef = useRef(null);
  const viewerInfoTimerRef = useRef(null);
  const viewerCloseInProgressRef = useRef(false);
  const viewerSwipeRef = useRef({ active: false, startX: 0, startY: 0, lastX: 0, lastY: 0, startTime: 0, swiped: false });
  const longPressTimerRef = useRef(null);
  const pendingHiddenAuthActionRef = useRef(null);
  const longPressTriggeredRef = useRef(false);
  const suppressContextMenuUntilRef = useRef(0);
  const fileInputRef = useRef(null);
  const backgroundUploadRef = useRef(false);
  const uploadDrainRequestedRef = useRef(false);
  const uploadRetryTimerRef = useRef(null);
  const uploadRetryCountsRef = useRef(new Map());
  const cancelledLocalUploadIdsRef = useRef(new Set());
  const uploadPreviewUrlsRef = useRef(new Map());
  const uploadFilesRef = useRef(new Map());
  const photosRef = useRef(applyPendingPhotoActions(cachedPhotos?.photos || []).filter((photo) => !photo.hidden));
  const photoPageSentinelRef = useRef(null);
  const photosPageLoadingRef = useRef(false);
  const deletingPhotoIdsRef = useRef(new Set(readPendingPhotoActions().deletes));
  const hiddenAccessTokenRef = useRef('');
  const loadRecentlyDeletedRef = useRef(null);
  const restoreQueuedUploadEntriesRef = useRef(null);
  const processPhotoUploadQueueRef = useRef(null);
  const loadPhotosRef = useRef(null);
  const syncPendingPhotoActionsRef = useRef(null);
  const loadMorePhotosRef = useRef(null);
  const recentlyDeletedLoadedRef = useRef(Boolean(cachedRecentlyDeleted));
  const accentColor = readAccentColorCache() || '#2f7be6';

  const [recentlyDeletedPhotos, setRecentlyDeletedPhotos] = useState(() => cachedRecentlyDeleted?.photos || []);
  const [recentlyDeletedLoading, setRecentlyDeletedLoading] = useState(false);
  const [recentlyDeletedLoaded, setRecentlyDeletedLoaded] = useState(Boolean(cachedRecentlyDeleted));
  loadRecentlyDeletedRef.current = loadRecentlyDeleted;
  restoreQueuedUploadEntriesRef.current = restoreQueuedUploadEntries;
  processPhotoUploadQueueRef.current = processPhotoUploadQueue;
  loadPhotosRef.current = loadPhotos;
  syncPendingPhotoActionsRef.current = syncPendingPhotoActions;
  loadMorePhotosRef.current = loadMorePhotos;
  recentlyDeletedLoadedRef.current = recentlyDeletedLoaded;

  useEffect(() => {
    if (location.state?.initialView !== 'deleted') return;
    setActiveView('deleted');
    if (!recentlyDeletedLoaded) {
      loadRecentlyDeletedRef.current?.({ silent: false });
    }
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate, recentlyDeletedLoaded]);

  function revokeUploadPreviewUrls() {
    const map = uploadPreviewUrlsRef.current;
    for (const url of map.values()) URL.revokeObjectURL(url);
    map.clear();
  }

  function closeUploadModal() {
    setUploadModalOpen(false);
    setUploadDragActive(false);
    setUploadDraftFiles([]);
    revokeUploadPreviewUrls();
  }

  function getUploadPreviewUrl(file) {
    const map = uploadPreviewUrlsRef.current;
    const cached = map.get(file);
    if (cached) return cached;
    const nextUrl = URL.createObjectURL(file);
    map.set(file, nextUrl);
    return nextUrl;
  }

  useEffect(() => {
    const map = uploadPreviewUrlsRef.current;
    const currentFiles = new Set(uploadDraftFiles);
    for (const [file, url] of map.entries()) {
      if (!currentFiles.has(file)) {
        URL.revokeObjectURL(url);
        map.delete(file);
      }
    }
  }, [uploadDraftFiles]);

  const filteredPhotos = useMemo(() => {
    if (activeView === 'deleted') return recentlyDeletedPhotos;
    const text = query.trim().toLowerCase();
    let nextPhotos = photos.filter((photo) => !photo.deleted && !photo.hidden);
    if (activeView === 'favourites') nextPhotos = nextPhotos.filter((photo) => photo.favourite);
    if (activeView === 'recents') nextPhotos = [...nextPhotos].reverse();
    if (activeView === 'hidden') nextPhotos = hiddenViewUnlocked ? photos.filter((photo) => photo.hidden && !photo.deleted) : [];
    if (text) {
      nextPhotos = nextPhotos.filter((photo) => (
        `${photo.title} ${photo.date} ${photo.location}`.toLowerCase().includes(text)
      ));
    }
    return nextPhotos;
  }, [activeView, hiddenViewUnlocked, photos, query, recentlyDeletedPhotos]);
  const aiSearchTokens = useMemo(() => searchTokens(aiSubmittedQuery), [aiSubmittedQuery]);
  const aiSearchPhotos = useMemo(() => photos.filter((photo) => !photo.deleted && !photo.hidden && !photo.localOnly), [photos]);
  const aiSearchResults = useMemo(() => {
    if (!aiSearchTokens.length) return [];
    const meaningfulTokens = aiSearchFilterTokens(aiSubmittedQuery);
    if (!meaningfulTokens.length) return [];

    const tokenMatches = (token, text) => {
      if (text.includes(token)) return true;

      if (token.endsWith('s') && token.length > 3 && text.includes(token.slice(0, -1))) return true;

      if (text.split(/\s+/).some((word) => word.startsWith(token) || token.startsWith(word))) return true;
      return false;
    };
    return aiSearchPhotos
      .map((photo) => {
        const text = searchableText(photo);
        const matchedTokens = meaningfulTokens.filter((token) => tokenMatches(token, text));

        if (matchedTokens.length === 0) return null;
        const exactBoost = String(photo.visionLabel || photo.title || '').toLowerCase().includes(aiSubmittedQuery.trim().toLowerCase()) ? 2 : 0;

        const allMatchBonus = matchedTokens.length === meaningfulTokens.length ? 1 : 0;
        return {
          photo,
          score: matchedTokens.length + allMatchBonus + exactBoost,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || photoTimeDesc(a.photo, b.photo))
      .slice(0, 60);
  }, [aiSearchPhotos, aiSubmittedQuery, aiSearchTokens]);
  const aiSearchResultPhotos = useMemo(() => aiSearchResults.map(({ photo }) => photo), [aiSearchResults]);
  const viewerPhotos = useMemo(() => {
    if (activeView === AI_SEARCH_VIEW) return aiSearchTokens.length ? aiSearchResultPhotos : aiSearchPhotos;
    if (activeView === 'links') return [];
    return filteredPhotos;
  }, [activeView, aiSearchPhotos, aiSearchResultPhotos, aiSearchTokens.length, filteredPhotos]);

  const selectedPhoto = useMemo(
    () => viewerPhotos.find((photo) => photo.id === selectedId) || viewerPhotos[0] || null,
    [selectedId, viewerPhotos]
  );
  const viewerDisplaySrc = selectedPhoto?.displaySrc || selectedPhoto?.src || selectedPhoto?.thumbnailSrc || '';
  const menuPhoto = useMemo(
    () => (tileMenu ? (activeView === 'deleted' ? recentlyDeletedPhotos : photos).find((photo) => photo.id === tileMenu.photoId) || null : null),
    [activeView, photos, recentlyDeletedPhotos, tileMenu]
  );
  const selectedPhotoIdSet = useMemo(() => new Set(selectedPhotoIds), [selectedPhotoIds]);
  const selectedIndex = selectedPhoto ? viewerPhotos.findIndex((photo) => photo.id === selectedPhoto.id) : -1;
  const selectedPhotoDate = useMemo(() => splitPhotoDate(selectedPhoto?.date), [selectedPhoto?.date]);
  const selectedPhotoInfoRows = useMemo(
    () => getPhotoInfoRows(selectedPhoto, selectedPhotoDate),
    [selectedPhoto, selectedPhotoDate]
  );
  const selectedPhotoVisionNotice = useMemo(
    () => visionCycleNotice(selectedPhoto),
    [selectedPhoto]
  );
  const selectedPhotoProtected = Boolean(selectedPhoto?.system || selectedPhoto?.locked || selectedPhoto?.id === 'iclora-default-photo');
  const selectedPhotoDirectOpen = skipsViewerOpenAnimation(selectedPhoto);
  const menuPhotoProtected = Boolean(menuPhoto?.system || menuPhoto?.locked || menuPhoto?.id === 'iclora-default-photo');
  const filteredPhotoIds = useMemo(() => filteredPhotos.map((photo) => photo.id), [filteredPhotos]);
  const allFilteredSelected = filteredPhotoIds.length > 0 && filteredPhotoIds.every((id) => selectedPhotoIdSet.has(id));
  const selectedPhotoCount = selectedPhotoIds.length;
  const viewerInfoMounted = viewerInfoOpen || viewerInfoClosing;
  const syncedPhotoCount = photos.filter((photo) => !photo.localOnly && !photo.deleted && !photo.hidden).length;
  const gridSize = GRID_SIZES[gridZoom] || GRID_SIZES[1];
  const mobileGridSize = MOBILE_GRID_SIZES[gridZoom] || MOBILE_GRID_SIZES[1];
  const gridZoomFill = `${(gridZoom / (GRID_SIZES.length - 1)) * 100}%`;
  const pageTitle = activeView === 'library' ? 'All Photos' : activeView === AI_SEARCH_VIEW ? 'Search Photos' : SIDEBAR_SECTIONS.flatMap((section) => section.items).find((item) => item.id === activeView)?.label || 'All Photos';
  const navbarSyncing = photosLoading || photosPageLoading || uploadingPhotos || recentlyDeletedLoading;
  const showInitialPhotosLoader = !setupRequired && activeView !== 'links' && !photosFirstLoadDone && photosLoading && !filteredPhotos.length;
  const canLoadMorePhotos = (
    activeView !== 'deleted'
    && activeView !== 'hidden'
    && activeView !== 'links'
    && activeView !== AI_SEARCH_VIEW
    && photosPagination.hasMore
    && !setupRequired
  );
  const showHiddenAuthPage = activeView === 'hidden' && !hiddenViewUnlocked;
  const displayName = (profile?.name || profile?.email || 'User').trim();
  const profileInitial = displayName.charAt(0).toUpperCase() || 'U';
  const photosBasePath = '/cloud/apps/photos/u';

  useEffect(() => {
    if (!readSessionToken()) navigate('/auth', { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (!viewerPhotos.length) return;
    if (!routePhotoId) {
      if (viewerCloseInProgressRef.current) return;
      if (viewerPhase !== 'closed') {
        setViewerPhase('closed');
        setViewerZoom(1);
        setViewerInfoOpen(false);
        setViewerInfoClosing(false);
      }
      return;
    }
    const decodedRoutePhotoId = decodeURIComponent(routePhotoId);
    const routePhoto = viewerPhotos.find((photo) => photo.id === decodedRoutePhotoId);
    if (!routePhoto) return;
    if (selectedId !== routePhoto.id) setSelectedId(routePhoto.id);
    if (viewerPhase === 'closed') {
      setTransitionRect(null);
      setViewerZoom(1);
      setViewerChromeHidden(false);
      setViewerActionsOpen(false);
      setViewerInfoOpen(false);
      setViewerInfoClosing(false);
      setViewerPhase('open');
    }
  }, [routePhotoId, selectedId, viewerPhase, viewerPhotos]);

  function restoreQueuedUploadEntries(queuedEntries = []) {
    if (!queuedEntries.length) return;
    const queuedIds = new Set(queuedEntries.map((entry) => entry.localPhoto.id));
    queuedEntries.forEach((entry) => uploadFilesRef.current.set(entry.localPhoto.id, entry.file));
    const localPhotos = queuedEntries.map((entry) => entry.localPhoto);
    setPhotos((currentPhotos) => {
      const nextPhotos = applyPendingPhotoActions(dedupePhotos([
        ...localPhotos,
        ...currentPhotos.filter((photo) => !photo.localOnly || queuedIds.has(photo.id)),
      ]));
      photosRef.current = nextPhotos;
      writePhotosCache({ photos: nextPhotos.filter((photo) => !photo.hidden), meta: photosMeta || {} });
      return nextPhotos;
    });
  }

  useEffect(() => {
    let cancelled = false;
    async function restoreQueuedUploads() {
      try {
        const queuedEntries = await readQueuedPhotoUploads();
        if (cancelled) return;
        if (!queuedEntries.length) {
          const cached = readPhotosCache();
          if (cached?.photos?.some((photo) => photo?.localOnly)) {
            const pausedPhotos = applyPendingPhotoActions(cached.photos.map((photo) => (
              photo?.localOnly ? { ...photo, syncStatus: 'failed', date: 'Upload paused' } : photo
            )));
            writePhotosCache({
              photos: pausedPhotos.filter((photo) => !photo.hidden),
              meta: cached.meta || {},
            });
            photosRef.current = pausedPhotos;
            setPhotos(pausedPhotos);
          }
          return;
        }

        restoreQueuedUploadEntriesRef.current?.(queuedEntries);
        processPhotoUploadQueueRef.current?.(queuedEntries);
      } catch {
        const cached = readPhotosCache();
        if (cached?.photos?.some((photo) => photo?.localOnly)) {
          const pausedPhotos = applyPendingPhotoActions(cached.photos.map((photo) => (
            photo?.localOnly ? { ...photo, syncStatus: 'failed', date: 'Upload paused' } : photo
          )));
          writePhotosCache({
            photos: pausedPhotos.filter((photo) => !photo.hidden),
            meta: cached.meta || {},
          });
          photosRef.current = pausedPhotos;
          setPhotos(pausedPhotos);
        }
      }
    }

    restoreQueuedUploads();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    async function resumeQueuedUploads() {
      if (backgroundUploadRef.current) return;
      const queuedEntries = await readQueuedPhotoUploads().catch(() => []);
      if (!queuedEntries.length) return;
      restoreQueuedUploadEntriesRef.current?.(queuedEntries);
      processPhotoUploadQueueRef.current?.(queuedEntries);
    }

    function onResume() {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      resumeQueuedUploads();
    }

    window.addEventListener('focus', onResume);
    document.addEventListener('visibilitychange', onResume);
    return () => {
      window.removeEventListener('focus', onResume);
      document.removeEventListener('visibilitychange', onResume);
    };
  }, []);

  async function loadPhotos(options = {}) {
    if (!readSessionToken()) return false;
    const append = Boolean(options.append);
    if (append && (!photosPagination.hasMore || photosPageLoadingRef.current)) return false;
    if (append) {
      photosPageLoadingRef.current = true;
      setPhotosPageLoading(true);
    } else if (!options.silent) {
      setPhotosLoading(true);
    }
    try {
      const params = new URLSearchParams({ limit: String(PHOTO_PAGE_SIZE) });
      if (append && photosPagination.cursor) params.set('cursor', photosPagination.cursor);
      const response = await apiFetch(`/photos?${params.toString()}`, {
        cache: 'no-store',
      });
      const json = await readJson(response);

      if (response.status === 401) {
        if (isStaleSessionResponse(response)) return false;
        await clearSignedOutData();
        navigate('/auth', { replace: true });
        return false;
      }
      if (response.status === 403 && json?.needsSetup) {
        setSetupRequired(true);
        setPhotos([]);
        photosRef.current = [];
        setPhotosPagination({ cursor: '', hasMore: false });
        writePhotosCache({ photos: [], meta: {} });
        setPhotosFirstLoadDone(true);
        return false;
      }
      if (!response.ok || json?.ok === false) {
        throw new Error(json?.error || 'Failed to load photos');
      }

      const livePhotos = filterPendingDeletePhotos(applyPendingPhotoActions(json.photos || []));
      const cachedPhotos = filterPendingDeletePhotos(applyPendingPhotoActions(removeCachedLocalUploadPhotos(readPhotosCache()?.photos || [])))
        .filter((photo) => !photo.hidden);
      const localSource = append ? photosRef.current : [...photosRef.current, ...cachedPhotos];
      const visibleLocalSource = normalizePhotos(localSource).filter((photo) => !photo.hidden && !photo.deleted);
      const mergedPhotos = append
        ? dedupePhotos([...visibleLocalSource, ...livePhotos])
        : dedupePhotos([...livePhotos, ...cachedPhotos]);
      const nextPhotos = keepPendingLocalPhotos(mergedPhotos, localSource);
      const nextMeta = json.meta || {};
      setSetupRequired(false);
      setPhotosPagination({
        cursor: json.pagination?.nextCursor || '',
        hasMore: Boolean(json.pagination?.hasMore),
      });
      commitPhotos(nextPhotos, nextMeta);
      return true;
    } catch (error) {
      if (options.silent) return false;
      showAlert({
        title: 'Photos sync paused',
        message: error?.message || 'Could not load live photos. Cached photos are still available.',
        type: 'warning',
      });
      return false;
    } finally {
      if (append) {
        photosPageLoadingRef.current = false;
        setPhotosPageLoading(false);
      } else if (!options.silent) {
        setPhotosLoading(false);
      }
      setPhotosFirstLoadDone(true);
    }
  }

  function loadMorePhotos() {
    if (!canLoadMorePhotos || photosPageLoading) return;
    loadPhotos({ append: true, silent: true });
  }

  async function loadHiddenPhotos(hiddenAccessToken, options = {}) {
    if (!readSessionToken()) return false;
    const token = hiddenAccessToken || hiddenAccessTokenRef.current || '';
    if (!token) return false;
    if (!options.silent) setPhotosLoading(true);
    try {
      const response = await apiFetch('/photos/hidden', {
        cache: 'no-store',
        headers: { 'x-iclora-hidden-photos-token': token },
      });
      const json = await readJson(response);

      if (response.status === 401) {
        if (isStaleSessionResponse(response)) return false;
        await clearSignedOutData();
        navigate('/auth', { replace: true });
        return false;
      }
      if (response.status === 403 && json?.needsSetup) {
        setSetupRequired(true);
        setPhotos([]);
        photosRef.current = [];
        setPhotosPagination({ cursor: '', hasMore: false });
        writePhotosCache({ photos: [], meta: {} });
        setPhotosFirstLoadDone(true);
        return false;
      }
      if (response.status === 403 && json?.needsHiddenAuth) {
        hiddenAccessTokenRef.current = '';
        setHiddenViewUnlocked(false);
        throw new Error(json?.error || 'Verify Hidden Photos to continue.');
      }
      if (!response.ok || json?.ok === false) {
        throw new Error(json?.error || 'Failed to load Hidden Photos');
      }

      const hiddenPhotos = filterPendingDeletePhotos(applyPendingPhotoActions(json.photos || []));
      const nextMeta = json.meta || photosMeta || {};
      setSetupRequired(false);
      commitPhotos((currentPhotos) => {
        const visiblePhotos = normalizePhotos(currentPhotos).filter((photo) => !photo.hidden);
        return dedupePhotos([...hiddenPhotos, ...visiblePhotos]);
      }, nextMeta);
      return true;
    } catch (error) {
      if (options.silent) return false;
      showAlert({
        title: 'Hidden Photos locked',
        message: error?.message || 'Could not load Hidden Photos.',
        type: 'warning',
      });
      return false;
    } finally {
      if (!options.silent) setPhotosLoading(false);
      setPhotosFirstLoadDone(true);
    }
  }

  async function loadRecentlyDeleted({ silent = false } = {}) {
    if (!silent) setRecentlyDeletedLoading(true);
    try {
      const response = await apiFetch('/photos/recently-deleted', { cache: 'no-store' });
      const json = await readJson(response);
      if (!response.ok || json?.ok === false) throw new Error(json?.error || 'Failed to load Recently Deleted');
      commitRecentlyDeletedPhotos(json.photos || []);
      setRecentlyDeletedLoaded(true);
    } catch (error) {
      if (!silent) showAlert({ title: 'Load failed', message: error?.message || 'Could not load Recently Deleted.', type: 'error' });
    } finally {
      if (!silent) setRecentlyDeletedLoading(false);
    }
  }

  function restoredPhotoFromRecentlyDeleted(photo = {}) {
    const original = photo._original || {};
    return normalizePhoto({
      ...photo,
      ...original,
      id: photo.id,
      deleted: false,
      deletedAt: '',
      daysRemaining: undefined,
      src: original.src || original.originalUrl || photo.src,
      thumbnailSrc: original.thumbnailSrc || original.src || original.originalUrl || photo.thumbnailSrc,
    });
  }

  function restoreDeletedPhotos(ids = []) {
    const restoreIds = Array.from(new Set(ids.filter(Boolean)));
    if (!restoreIds.length) return;
    const restoreIdSet = new Set(restoreIds);
    const restorePhotos = recentlyDeletedPhotos.filter((photo) => restoreIdSet.has(photo.id));
    const restoredPhotos = restorePhotos
      .map(restoredPhotoFromRecentlyDeleted)
      .filter(Boolean)
      .filter((photo) => !photo.hidden);

    commitRecentlyDeletedPhotos((prev) => prev.filter((p) => !restoreIdSet.has(p.id)));
    if (restoredPhotos.length) {
      commitPhotos((prev) => dedupePhotos([
        ...restoredPhotos,
        ...normalizePhotos(prev).filter((photo) => !restoreIdSet.has(photo.id)),
      ]));
    }
    setSelectedPhotoIds((selectedIds) => selectedIds.filter((id) => !restoreIdSet.has(id)));
    if (selectedPhoto && restoreIdSet.has(selectedPhoto.id)) closeViewer();

    showAlert({
      title: 'Restored',
      message: `${restoreIds.length} photo${restoreIds.length === 1 ? '' : 's'} restored to Library. Syncing in background.`,
      type: 'success',
    });

    apiFetch('/photos/recently-deleted/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: restoreIds }),
      })
      .then(async (response) => {
      const json = await readJson(response);
      if (!response.ok || json?.ok === false) throw new Error(json?.error || 'Failed to restore');
      loadPhotos({ silent: true });
    })
      .catch((error) => {
        if (restorePhotos.length) commitRecentlyDeletedPhotos((prev) => dedupePhotos([...restorePhotos, ...prev]));
        if (restoredPhotos.length) commitPhotos((prev) => normalizePhotos(prev).filter((photo) => !restoreIdSet.has(photo.id)));
        showAlert({ title: 'Restore failed', message: error?.message || 'Could not restore photos.', type: 'error' });
        loadRecentlyDeleted({ silent: true });
      });
  }

  async function permanentDeletePhotos(ids = [], options = {}) {
    const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
    if (!uniqueIds.length) return;
    if (!options.confirmed) {
      openPhotoPermanentDeleteConfirm(uniqueIds);
      return;
    }
    commitRecentlyDeletedPhotos((prev) => prev.filter((p) => !uniqueIds.includes(p.id)));
    try {
      await Promise.all(uniqueIds.map(id => apiFetch(`/photos/recently-deleted/${encodeURIComponent(id)}`, { method: 'DELETE' })));
      showAlert({ title: 'Deleted forever', message: `${uniqueIds.length} photo${uniqueIds.length === 1 ? '' : 's'} permanently deleted.`, type: 'success' });
    } catch (error) {
      showAlert({ title: 'Delete failed', message: 'Could not permanently delete photos.', type: 'error' });
      loadRecentlyDeleted();
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setPageEntered(true);
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => setPageEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/auth/me')
      .then((response) => {
        if (response.status === 401) {
          if (isStaleSessionResponse(response)) {
            const error = new Error('stale-session-response');
            error.code = 'STALE_SESSION_RESPONSE';
            throw error;
          }
          const error = new Error('unauthorized');
          error.code = 'UNAUTHORIZED';
          throw error;
        }
        return response.json().catch(() => ({}));
      })
      .then((json) => {
        if (cancelled || !json?.ok) return;
        const nextProfile = {
          ...readUserProfileCache(),
          uid: json.uid || '',
          name: json.name || '',
          email: json.email || '',
          profilePhotoUrl: json.profilePhotoUrl || '',
          provider: json.provider || '',
          plan: json.plan || 'basic',
          storage: typeof json.storage === 'number' ? json.storage : 1024,
          storageused: typeof json.storageused === 'number' ? json.storageused : 0,
          storageBreakdown: Array.isArray(json.storageBreakdown) ? json.storageBreakdown : [],
        };
        writeUserProfileCache(nextProfile);
        setProfile(nextProfile);
      })
      .catch(async (error) => {
        if (error?.code === 'STALE_SESSION_RESPONSE') return;
        if (cancelled || error?.code !== 'UNAUTHORIZED') return;
        await clearSignedOutData();
        navigate('/auth', { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    loadPhotosRef.current?.();
    syncPendingPhotoActionsRef.current?.();
  }, []);

  useEffect(() => {
    if (activeView === 'deleted') {
      loadRecentlyDeletedRef.current?.({ silent: recentlyDeletedLoadedRef.current });
    }
  }, [activeView]);

  useEffect(() => {
    const sentinel = photoPageSentinelRef.current;
    if (!sentinel || !canLoadMorePhotos || photosPageLoading) return undefined;
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        loadMorePhotosRef.current?.();
      }
    }, { rootMargin: '700px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canLoadMorePhotos, photosPageLoading, photosPagination.cursor, activeView]);

  useEffect(() => {
    if (setupRequired || !photos.some(isVisionCyclePending)) return undefined;
    const timer = window.setInterval(() => {
      loadPhotosRef.current?.({ silent: true });
    }, 15000);
    return () => window.clearInterval(timer);
  }, [photos, setupRequired]);

  useEffect(() => {
    if (viewerPhase === 'closed' || !viewerDisplaySrc) {
      setViewerImageLoading(false);
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.src = viewerDisplaySrc;
    if (image.complete && image.naturalWidth > 0) {
      setViewerImageLoading(false);
      return;
    }

    setViewerImageLoading(false);
    const loaderTimer = window.setTimeout(() => {
      if (!cancelled) setViewerImageLoading(true);
    }, 140);

    image.onload = () => {
      cancelled = true;
      window.clearTimeout(loaderTimer);
      setViewerImageLoading(false);
    };
    image.onerror = () => {
      cancelled = true;
      window.clearTimeout(loaderTimer);
      setViewerImageLoading(false);
    };

    return () => {
      cancelled = true;
      window.clearTimeout(loaderTimer);
      image.onload = null;
      image.onerror = null;
    };
  }, [selectedPhoto?.id, viewerDisplaySrc, viewerPhase]);

  useEffect(() => {
    if (viewerPhase === 'closed' || typeof document === 'undefined') return;
    const activeThumbnail = document.querySelector('.iclora-photos__filmstrip button.is-active');
    activeThumbnail?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [selectedPhoto?.id, viewerPhase]);

  useEffect(() => {
    let cancelled = false;
    if (!readSessionToken() || setupRequired) return undefined;
    loadSecurePhotoLinks()
      .then((links) => {
        if (!cancelled) setSecureLinks(links);
      })
      .catch(() => {
      });
    return () => {
      cancelled = true;
    };
  }, [setupRequired]);

  useEffect(() => {
    return applyAppPageMeta({
      title: 'iClora Photos',
      lightIcon: '/apps/photos.webp',
      darkIcon: '/apps/photos-dark.webp',
    });
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const viewport = document.querySelector('meta[name="viewport"]');
    const previousViewport = viewport?.getAttribute('content') || '';
    const photosViewport = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content';
    if (viewport) viewport.setAttribute('content', photosViewport);
    return () => {
      if (viewport && previousViewport) viewport.setAttribute('content', previousViewport);
    };
  }, []);

  useEffect(() => () => {
    if (viewerTimerRef.current) clearTimeout(viewerTimerRef.current);
    if (viewerCloseFrameRef.current) cancelAnimationFrame(viewerCloseFrameRef.current);
    if (viewerInfoTimerRef.current) clearTimeout(viewerInfoTimerRef.current);
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    if (uploadRetryTimerRef.current) clearTimeout(uploadRetryTimerRef.current);
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') setTileMenu(null);
      if (viewerPhase === 'closed') return;
      if (event.key === 'Escape' && viewerInfoMounted) {
        closeViewerInfo();
        return;
      }
      if (event.key === 'Escape') closeViewer();
      if (event.key === 'ArrowLeft') showPreviousPhoto();
      if (event.key === 'ArrowRight') showNextPhoto();
      if (event.key === '+' || event.key === '=') setViewerZoom((value) => Math.min(3, Number((value + 0.25).toFixed(2))));
      if (event.key === '-') setViewerZoom((value) => Math.max(0.75, Number((value - 0.25).toFixed(2))));
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  useEffect(() => {
    if (!tileMenu || typeof document === 'undefined') return undefined;

    function closeOnOutsidePress(event) {
      const target = event.target;
      if (target?.closest?.('.iclora-photos__tile-menu') || target?.closest?.('.iclora-photos__tile-more')) return;
      setTileMenu(null);
    }

    function closeOnViewportChange() {
      setTileMenu(null);
    }

    document.addEventListener('pointerdown', closeOnOutsidePress);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('orientationchange', closeOnViewportChange);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('orientationchange', closeOnViewportChange);
    };
  }, [tileMenu]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    function suppressMobileBrowserLongPressMenu(event) {
      const target = event.target;
      if (!target?.closest?.('.iclora-photos__tile') && !target?.closest?.('.iclora-photos__touch-preview')) return;
      event.preventDefault();
    }

    document.addEventListener('contextmenu', suppressMobileBrowserLongPressMenu, { capture: true });
    return () => {
      document.removeEventListener('contextmenu', suppressMobileBrowserLongPressMenu, { capture: true });
    };
  }, []);

  function closeHiddenAuthModal() {
    setHiddenAuthModal(null);
    setHiddenAuthPreparing(false);
    setHiddenAuthBusy(false);
    setHiddenProviderBusy('');
    pendingHiddenAuthActionRef.current = null;
  }

  async function finishHiddenProviderUnlock(result) {
    const token = result?.hiddenAccessToken || '';
    if (!token) throw new Error('Hidden Photos verification token missing.');
    hiddenAccessTokenRef.current = token;
    setSidebarOpen(false);
    setSelectedId('');
    setSelectMode(false);
    setSelectedPhotoIds([]);
    const loaded = await loadHiddenPhotos(token);
    if (!loaded) throw new Error('Could not load Hidden Photos after verification.');
    setHiddenViewUnlocked(true);
    closeHiddenAuthModal();
  }

  async function requestHiddenPhotosVerification(intent, action) {
    pendingHiddenAuthActionRef.current = action;
    if (intent === 'view') setHiddenViewUnlocked(false);
    setHiddenAuthModal(null);
    setHiddenAuthBusy(false);
    setHiddenProviderBusy('');
    setHiddenAuthPreparing(true);
    try {
      const status = await apiJson('/photos/hidden-auth');
      if (status?.verified && intent !== 'view') {
        closeHiddenAuthModal();
        action?.();
        return;
      }
      setPhotosMeta((current) => ({ ...(current || {}), hiddenAuthEnabled: Boolean(status?.enabled) }));
      setHiddenAuthModal({
        mode: status?.enabled ? 'verify' : 'setup',
        intent,
        passcode: '',
        confirmPasscode: '',
        error: '',
      });
    } catch (error) {
      showAlert({
        title: 'Verification unavailable',
        message: error?.message || 'Could not prepare Hidden Photos verification.',
        type: 'error',
      });
      if (intent !== 'view') closeHiddenAuthModal();
    } finally {
      setHiddenAuthPreparing(false);
    }
  }

  async function submitHiddenPhotosVerification(event) {
    event?.preventDefault?.();
    if (!hiddenAuthModal || hiddenAuthBusy) return;
    const passcode = String(hiddenAuthModal.passcode || '').trim();
    const confirmPasscode = String(hiddenAuthModal.confirmPasscode || '').trim();
    if (passcode.length < 4) {
      setHiddenAuthModal((current) => ({ ...current, error: 'Use at least 4 digits.' }));
      return;
    }

    setHiddenAuthBusy(true);
    try {
      if (hiddenAuthModal.mode === 'setup') {
        if (passcode !== confirmPasscode) {
          setHiddenAuthModal((current) => ({ ...current, error: 'Passcodes do not match.' }));
          return;
        }
        const result = await apiJson('/photos/hidden-auth/setup', {
          method: 'POST',
          body: JSON.stringify({ passcode }),
        });
        hiddenAccessTokenRef.current = result?.hiddenAccessToken || '';
        setPhotosMeta((current) => ({ ...(current || {}), hiddenAuthEnabled: true }));
      } else {
        const result = await apiJson('/photos/hidden-auth/verify', {
          method: 'POST',
          body: JSON.stringify({ passcode }),
        });
        hiddenAccessTokenRef.current = result?.hiddenAccessToken || '';
      }

      const action = pendingHiddenAuthActionRef.current;
      closeHiddenAuthModal();
      await action?.(hiddenAccessTokenRef.current);
    } catch (error) {
      setHiddenAuthModal((current) => ({
        ...current,
        error: error?.message || (current?.mode === 'setup' ? 'Could not set up verification.' : 'That passcode did not match.'),
      }));
    } finally {
      setHiddenAuthBusy(false);
    }
  }

  function selectSidebarItem(id) {
    navigate(photosBasePath, { replace: true });
    viewerCloseInProgressRef.current = false;
    setViewerPhase('closed');
    setViewerZoom(1);
    setViewerActionsOpen(false);
    setViewerInfoOpen(false);
    setViewerInfoClosing(false);
    setViewerChromeHidden(false);
    if (id === 'hidden') {
      setActiveView(id);
      setSidebarOpen(false);
      setSelectedId('');
      setSelectMode(false);
      setSelectedPhotoIds([]);
      requestHiddenPhotosVerification('view', async (hiddenAccessToken) => {
        const loaded = await loadHiddenPhotos(hiddenAccessToken);
        if (loaded) setHiddenViewUnlocked(true);
      });
      return;
    }
    setHiddenViewUnlocked(false);
    hiddenAccessTokenRef.current = '';
    if (activeView === 'hidden') closeHiddenAuthModal();

    if (activeView === AI_SEARCH_VIEW && id !== AI_SEARCH_VIEW) {
      setAiSearchQuery('');
      setAiSubmittedQuery('');
    }
    setActiveView(id);
    setSidebarOpen(false);
    setSelectedId('');
    setSelectMode(false);
    setSelectedPhotoIds([]);
  }

  function openSidebarExternalLink(url) {
    setSidebarOpen(false);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function resetAiSearch() {
    setAiSearchQuery('');
    setAiSubmittedQuery('');
  }

  function runAiPhotoSearch(event) {
    event?.preventDefault?.();
    setAiSubmittedQuery(aiSearchQuery.trim());
  }

  function focusAiSearchInput() {
    window.setTimeout(() => {
      const input = document.querySelector('.iclora-photos__ai-search-shell input');
      input?.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    }, 80);
  }

  function setGridZoomLevel(value) {
    const nextValue = Number(value);
    if (Number.isNaN(nextValue)) return;
    setGridZoom(Math.min(GRID_SIZES.length - 1, Math.max(0, nextValue)));
  }

  function rememberPendingDeletePhotos(ids = []) {
    addPendingPhotoDelete(ids);
    ids.forEach((id) => {
      if (id) deletingPhotoIdsRef.current.add(id);
    });
  }

  function forgetPendingDeletePhotos(ids = []) {
    clearPendingPhotoDelete(ids);
    ids.forEach((id) => {
      if (id) deletingPhotoIdsRef.current.delete(id);
    });
  }

  function filterPendingDeletePhotos(items = []) {
    const deletingIds = deletingPhotoIdsRef.current;
    if (!deletingIds.size) return items;
    return items.filter((photo) => !deletingIds.has(photo?.id));
  }

  function commitPhotos(nextPhotos, nextMeta = photosMeta) {
    const savePhotos = (items) => {
      const normalized = dedupePhotos(filterPendingDeletePhotos(applyPendingPhotoActions(items)));
      const cacheablePhotos = normalized.filter((photo) => !photo.hidden);
      writePhotosCache({ photos: cacheablePhotos, meta: nextMeta || {} });
      return normalized;
    };
    if (typeof nextPhotos === 'function') {
      setPhotos((currentPhotos) => {
        const savedPhotos = savePhotos(nextPhotos(currentPhotos));
        photosRef.current = savedPhotos;
        return savedPhotos;
      });
    } else {
      const savedPhotos = savePhotos(nextPhotos);
      photosRef.current = savedPhotos;
      setPhotos(savedPhotos);
    }
    setPhotosMeta(nextMeta || {});
  }

  function commitRecentlyDeletedPhotos(nextPhotos) {
    const savePhotos = (items) => {
      const normalized = normalizePhotos(items).sort((a, b) => {
        const bTime = Date.parse(b.deletedAt || b.updatedAt || b.createdAt || '') || 0;
        const aTime = Date.parse(a.deletedAt || a.updatedAt || a.createdAt || '') || 0;
        return bTime - aTime;
      });
      writeRecentlyDeletedPhotosCache(normalized);
      return normalized;
    };
    if (typeof nextPhotos === 'function') {
      setRecentlyDeletedPhotos((currentPhotos) => savePhotos(nextPhotos(currentPhotos)));
    } else {
      setRecentlyDeletedPhotos(savePhotos(nextPhotos));
    }
    setRecentlyDeletedLoaded(true);
  }

  function keepPendingLocalPhotos(livePhotos, localSource = photos) {
    const cleanLivePhotos = filterPendingDeletePhotos(livePhotos);
    const liveIds = new Set(cleanLivePhotos.map((photo) => photo.id));
    const pendingLocalPhotos = filterPendingDeletePhotos(normalizePhotos(localSource))
      .filter((photo) => (
        photo.localOnly
        && !liveIds.has(photo.id)
        && !liveIds.has(photo.uploadPhotoId)
        && (photo.syncStatus === 'processing' || photo.syncStatus === 'failed')
      ));
    return dedupePhotos([...pendingLocalPhotos, ...cleanLivePhotos]);
  }

  async function syncPendingPhotoActions() {
    const pending = readPendingPhotoActions();
    if (!pending.deletes.length && !Object.keys(pending.patches).length) return;

    if (pending.deletes.length) {
      try {
        await apiJson('/photos/delete', {
          method: 'POST',
          body: JSON.stringify({ ids: pending.deletes }),
        });
        forgetPendingDeletePhotos(pending.deletes);
      } catch (error) {
        if (error?.status === 404) {
          forgetPendingDeletePhotos(pending.deletes);
        } else {
          forgetPendingDeletePhotos(pending.deletes);
          showAlert({
            title: 'Delete failed',
            message: error?.message || 'Could not delete pending photos. Restoring the latest server state.',
            type: 'error',
          });
          await loadPhotos({ silent: true });
        }
      }
    }

    const patchEntries = Object.entries(readPendingPhotoActions().patches || {});
    for (const [id, patch] of patchEntries) {
      try {
        const result = await apiJson(`/photos/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        });
        const remainingPatch = clearPendingPhotoPatch(id, patch, { onlyMatching: true });
        commitPhotos((currentPhotos) => currentPhotos.map((item) => (
          item.id === id ? normalizePhoto({ ...(result.photo || item), ...remainingPatch }) : item
        )), result.meta || photosMeta);
      } catch (error) {
        clearPendingPhotoPatch(id, patch);
        showAlert({
          title: 'Photo update failed',
          message: error?.message || 'A pending photo change could not be saved. Restoring the latest server state.',
          type: 'error',
        });
        await loadPhotos({ silent: true });
      }
    }
  }

  function replacePhotoInList(list, photo) {
    const normalized = normalizePhoto(photo);
    if (!normalized) return list;
    const withoutPhoto = list.filter((item) => item.id !== normalized.id);
    return [normalized, ...withoutPhoto].sort((a, b) => {
      const bTime = Date.parse(b.uploadedAt || b.createdAt || b.date || '') || 0;
      const aTime = Date.parse(a.uploadedAt || a.createdAt || a.date || '') || 0;
      return bTime - aTime;
    });
  }

  async function activatePhotos() {
    if (setupLoading) return;
    setSetupLoading(true);
    try {
      const result = await ensurePhotosSetup();
      setSetupRequired(false);
      showAlert({
        title: result?.alreadyActive ? 'Photos already active' : 'Photos activated',
        message: result?.alreadyActive
          ? 'Your iClora Photos Cloud is already ready.'
          : 'Your account was activated and your starter photo was added.',
        type: 'success',
      });
      await loadPhotos({ silent: true });
    } catch (error) {
      showAlert({
        title: 'Photos setup failed',
        message: error?.message || 'Could not activate Photos right now.',
        type: 'error',
      });
    } finally {
      setSetupLoading(false);
    }
  }

  function filterUploadFiles(fileList) {
    return Array.from(fileList || []).filter(isAcceptedPhotoUpload);
  }

  function normalizeUploadQueueEntries(entries = []) {
    return entries
      .filter((entry) => entry?.file && entry?.localPhoto)
      .map((entry, index) => ({
        ...entry,
        uploadBatchId: `${entry.uploadBatchId || 'photos'}-${Math.floor(index / MAX_PHOTO_UPLOAD_BATCH)}`,
      }));
  }

  function stageUploadFiles(fileList) {
    const uploadBatchLimit = getUploadBatchLimit();
    const selectedFiles = Array.from(fileList || []);
    const validFiles = filterUploadFiles(fileList);
    const activeUploadFingerprints = new Set([
      ...uploadDraftFiles.map(photoUploadFingerprint),
      ...Array.from(uploadFilesRef.current.values()).map(photoUploadFingerprint),
    ]);
    const files = validFiles.filter((file) => !activeUploadFingerprints.has(photoUploadFingerprint(file)));
    if (!files.length) {
      showAlert({ title: 'No new photos selected', message: 'Choose a JPEG, PNG, WebP, GIF, HEIC, or HEIF image that is not already queued.', type: 'warning' });
      return;
    }
    if (validFiles.length < selectedFiles.length) {
      showAlert({ title: 'Some files skipped', message: 'Videos and unsupported image formats are not allowed in Photos.', type: 'warning' });
    } else if (files.length < validFiles.length) {
      showAlert({ title: 'Duplicates skipped', message: 'Photos already queued for upload were not added again.', type: 'info' });
    }
    const room = uploadBatchLimit - uploadDraftFiles.length;
    if (room <= 0) {
      showAlert({ title: 'Upload limit reached', message: `You can upload ${uploadBatchLimit} photos at a time.`, type: 'warning' });
      return;
    }
    const accepted = files.slice(0, room);
    const storageLimit = Number(profile?.storage || 0);
    const storageUsed = Number(profile?.storageused || 0);
    if (storageLimit > 0 && storageUsed + filesStorageMb([...uploadDraftFiles, ...accepted]) > storageLimit) {
      showAlert({ title: 'Storage limit reached', message: 'Your iClora storage is full. Free up space before uploading more photos.', type: 'warning' });
      return;
    }
    setUploadDraftFiles((current) => [...current, ...accepted]);
    if (files.length > accepted.length) {
      showAlert({ title: `Only ${uploadBatchLimit} at a time`, message: `Added ${accepted.length}; upload the rest after this batch.`, type: 'info' });
    }
  }

  function handlePhotoFilesSelected(event) {
    stageUploadFiles(event.target.files);
    event.target.value = '';
  }

  function scheduleQueuedUploadDrain(delay = 900) {
    uploadDrainRequestedRef.current = true;
    if (uploadRetryTimerRef.current) return;
    uploadRetryTimerRef.current = window.setTimeout(async () => {
      uploadRetryTimerRef.current = null;
      if (backgroundUploadRef.current) {
        scheduleQueuedUploadDrain(1200);
        return;
      }
      const queuedEntries = await readQueuedPhotoUploads().catch(() => []);
      if (!queuedEntries.length) {
        uploadDrainRequestedRef.current = false;
        return;
      }
      restoreQueuedUploadEntries(queuedEntries);
      processPhotoUploadQueue(queuedEntries);
    }, delay);
  }

  async function processPhotoUploadQueue(entries) {
    if (backgroundUploadRef.current) {
      scheduleQueuedUploadDrain(1200);
      return;
    }
    backgroundUploadRef.current = true;
    uploadDrainRequestedRef.current = false;
    setUploadingPhotos(true);
    let uploadedCount = 0;
    let failedCount = 0;
    let firstUploadError = '';
    let retryableFailedCount = 0;

    const queueEntries = normalizeUploadQueueEntries(entries);
    const uploadLocalIds = new Set(queueEntries.map((entry) => entry.localPhoto.id));
    let nextPhotos = [...queueEntries.map((entry) => entry.localPhoto), ...photos.filter((photo) => !uploadLocalIds.has(photo.id))];
    let nextMeta = photosMeta;

    for (const entry of queueEntries) {
      if (cancelledLocalUploadIdsRef.current.has(entry.localPhoto.id)) {
        uploadFilesRef.current.delete(entry.localPhoto.id);
        uploadRetryCountsRef.current.delete(entry.localPhoto.id);
        await deleteQueuedPhotoUpload(entry.localPhoto.id).catch(() => {});
        nextPhotos = nextPhotos.filter((item) => item.id !== entry.localPhoto.id);
        commitPhotos(nextPhotos, nextMeta);
        continue;
      }
      try {
        const attemptNumber = Number(uploadRetryCountsRef.current.get(entry.localPhoto.id) || 0);
        const result = await uploadPhotoInBackground(entry.file, {
          uploadBatchId: `${entry.uploadBatchId}-try${attemptNumber}`,
          photoId: entry.localPhoto.uploadPhotoId,
        });
        if (cancelledLocalUploadIdsRef.current.has(entry.localPhoto.id)) {
          uploadFilesRef.current.delete(entry.localPhoto.id);
          uploadRetryCountsRef.current.delete(entry.localPhoto.id);
          await deleteQueuedPhotoUpload(entry.localPhoto.id).catch(() => {});
          nextPhotos = nextPhotos.filter((item) => item.id !== entry.localPhoto.id);
          commitPhotos(nextPhotos, nextMeta);
          continue;
        }
        if (result?.photo) {
          nextPhotos = replacePhotoInList(nextPhotos.filter((item) => item.id !== entry.localPhoto.id), result.photo);
          uploadFilesRef.current.delete(entry.localPhoto.id);
          uploadRetryCountsRef.current.delete(entry.localPhoto.id);
          await deleteQueuedPhotoUpload(entry.localPhoto.id);
          nextMeta = result.meta || nextMeta;
          uploadedCount += 1;
          const addedStorage = Number(result.photo.storageUsed || 0);
          if (Number.isFinite(addedStorage) && addedStorage > 0) {
            setProfile((currentProfile) => {
              const nextProfile = {
                ...currentProfile,
                storageused: Number((Number(currentProfile?.storageused || 0) + addedStorage).toFixed(4)),
              };
              writeUserProfileCache(nextProfile);
              return nextProfile;
            });
          }
          commitPhotos(nextPhotos, nextMeta);
        }
      } catch (error) {
        if (cancelledLocalUploadIdsRef.current.has(entry.localPhoto.id)) {
          uploadFilesRef.current.delete(entry.localPhoto.id);
          uploadRetryCountsRef.current.delete(entry.localPhoto.id);
          await deleteQueuedPhotoUpload(entry.localPhoto.id).catch(() => {});
          nextPhotos = nextPhotos.filter((item) => item.id !== entry.localPhoto.id);
          commitPhotos(nextPhotos, nextMeta);
          continue;
        }
        failedCount += 1;
        const previousAttempts = Number(uploadRetryCountsRef.current.get(entry.localPhoto.id) || 0);
        const nextAttempts = previousAttempts + 1;
        uploadRetryCountsRef.current.set(entry.localPhoto.id, nextAttempts);
        if (nextAttempts < 4) retryableFailedCount += 1;
        firstUploadError ||= error?.message || '';
        nextPhotos = nextPhotos.map((item) => (
          item.id === entry.localPhoto.id
            ? { ...item, syncStatus: nextAttempts < 4 ? 'processing' : 'failed', date: nextAttempts < 4 ? 'Retrying upload' : 'Upload failed' }
            : item
        ));
        commitPhotos(nextPhotos, nextMeta);
      }
    }

    backgroundUploadRef.current = false;
    const queuedAfterRun = await readQueuedPhotoUploads().catch(() => []);
    const retryableQueuedEntries = queuedAfterRun.filter((entry) => Number(uploadRetryCountsRef.current.get(entry.localPhoto.id) || 0) < 4);
    if (retryableQueuedEntries.length || uploadDrainRequestedRef.current) {
      scheduleQueuedUploadDrain(failedCount ? 3500 : 600);
    } else {
      setUploadingPhotos(false);
    }
    if (uploadedCount) {
      showAlert({
        title: failedCount ? 'Photos syncing' : 'Photos uploaded',
        message: failedCount
          ? `${uploadedCount} uploaded. ${retryableFailedCount || failedCount} item${(retryableFailedCount || failedCount) === 1 ? '' : 's'} will retry automatically.`
          : `${uploadedCount} item${uploadedCount === 1 ? '' : 's'} synced with iClora Photos.`,
        type: 'success',
      });
    } else if (failedCount) {
      showAlert({
        title: retryableFailedCount ? 'Retrying upload' : 'Upload failed',
        message: retryableFailedCount
          ? 'Some photos hit a temporary upload issue. iClora will retry them automatically.'
          : firstUploadError || 'Could not sync these cached photos with the server.',
        type: retryableFailedCount ? 'info' : 'error',
      });
    }
  }

  async function startCachedUpload() {
    const uploadBatchLimit = getUploadBatchLimit();
    if (!uploadDraftFiles.length) {
      showAlert({ title: 'No photos selected', message: `Choose up to ${uploadBatchLimit} photos.`, type: 'warning' });
      return;
    }

    const uploadBatchId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const selectedFiles = uploadDraftFiles.slice(0, uploadBatchLimit);
    const entries = selectedFiles.map((file) => ({ file, localPhoto: makeLocalPhoto(file), uploadBatchId }));
    try {
      await saveQueuedPhotoUploads(entries);
    } catch {
      showAlert({
        title: 'Refresh protection unavailable',
        message: 'Photos will upload now, but this browser could not cache the upload queue.',
        type: 'warning',
      });
    }
    entries.forEach((entry) => uploadFilesRef.current.set(entry.localPhoto.id, entry.file));
    const localPhotos = entries.map((entry) => entry.localPhoto);
    const nextPhotos = [...localPhotos, ...photos];
    commitPhotos(nextPhotos, photosMeta);
    setUploadModalOpen(false);
    setUploadDraftFiles([]);
    revokeUploadPreviewUrls();
    showAlert({
      title: 'Upload cached',
      message: 'Photos are visible now. Keep this page open until upload finishes for the fastest sync.',
      type: 'info',
    });
    processPhotoUploadQueue(entries);
  }

  function retryFailedUpload(photo) {
    if (backgroundUploadRef.current) {
      showAlert({
        title: 'Upload still running',
        message: 'Retry after the current upload finishes.',
        type: 'info',
      });
      return;
    }
    const file = uploadFilesRef.current.get(photo.id);
    if (!file) {
      commitPhotos(photos.filter((item) => item.id !== photo.id), photosMeta);
      showAlert({
        title: 'Choose this photo again',
        message: 'The retry file is no longer available after refresh.',
        type: 'warning',
      });
      return;
    }
    const uploadBatchId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const retryPhoto = { ...photo, syncStatus: 'processing', date: 'Processing now' };
    uploadRetryCountsRef.current.delete(photo.id);
    commitPhotos(photos.map((item) => (item.id === photo.id ? retryPhoto : item)), photosMeta);
    processPhotoUploadQueue([{ file, localPhoto: retryPhoto, uploadBatchId }]);
  }

  async function patchPhoto(photo, patch) {
    if (!photo?.id) return null;
    const previousValues = {};
    PHOTO_PATCH_KEYS.forEach((key) => {
      if (typeof patch?.[key] === 'boolean') previousValues[key] = Boolean(photo[key]);
    });
    addPendingPhotoPatch(photo.id, patch);
    commitPhotos((currentPhotos) => currentPhotos.map((item) => (
      item.id === photo.id ? normalizePhoto({ ...item, ...patch }) : item
    )), photosMeta);

    try {
      const result = await apiJson(`/photos/${encodeURIComponent(photo.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      const remainingPatch = clearPendingPhotoPatch(photo.id, patch, { onlyMatching: true });
      commitPhotos((currentPhotos) => currentPhotos.map((item) => (
        item.id === photo.id ? normalizePhoto({ ...(result.photo || item), ...remainingPatch }) : item
      )), result.meta || photosMeta);
      return result.photo;
    } catch (error) {
      if (pendingPatchStillMatches(photo.id, patch)) {
        clearPendingPhotoPatch(photo.id, patch);
        commitPhotos((currentPhotos) => currentPhotos.map((item) => (
          item.id === photo.id ? normalizePhoto({ ...item, ...previousValues }) : item
        )), photosMeta);
      }
      showAlert({
        title: 'Photo update failed',
        message: error?.message || 'Could not update this photo.',
        type: 'error',
      });
      return null;
    }
  }

  async function patchPhotosByIds(ids = [], patch = {}, options = {}) {
    const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
    if (!uniqueIds.length) return [];
    const previousPhotos = photos;
    const previousMeta = photosMeta;
    const previousSelectedPhotoIds = selectedPhotoIds;
    uniqueIds.forEach((id) => addPendingPhotoPatch(id, patch));
    commitPhotos((currentPhotos) => currentPhotos.map((item) => (
      uniqueIds.includes(item.id) ? normalizePhoto({ ...item, ...patch }) : item
    )), photosMeta);
    if (options.clearSelection) {
      setSelectedPhotoIds((current) => current.filter((id) => !uniqueIds.includes(id)));
    }

    try {
      const results = [];
      for (const id of uniqueIds) {
        const result = await apiJson(`/photos/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        });
        results.push(result);
        const remainingPatch = clearPendingPhotoPatch(id, patch, { onlyMatching: true });
        commitPhotos((currentPhotos) => currentPhotos.map((item) => (
          item.id === id ? normalizePhoto({ ...(result.photo || item), ...remainingPatch }) : item
        )), result.meta || photosMeta);
      }
      if (options.successTitle) {
        showAlert({
          title: options.successTitle,
          message: options.successMessage || `${uniqueIds.length} photo${uniqueIds.length === 1 ? '' : 's'} updated.`,
          type: 'success',
        });
      }
      return results;
    } catch (error) {
      uniqueIds.forEach((id) => clearPendingPhotoPatch(id, patch));
      commitPhotos(previousPhotos, previousMeta);
      setSelectedPhotoIds(previousSelectedPhotoIds);
      showAlert({
        title: options.errorTitle || 'Photo update failed',
        message: error?.message || options.errorMessage || 'Could not update selected photos.',
        type: 'error',
      });
      return [];
    }
  }

  function openPhotoDeleteConfirm(ids = []) {
    const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
    if (!uniqueIds.length) {
      showAlert({ title: 'No photos selected', message: 'Select photos first.', type: 'warning' });
      return;
    }
    const lockedIds = uniqueIds.filter((id) => {
      const photo = photos.find((item) => item.id === id);
      return photo?.system || photo?.locked;
    });
    if (lockedIds.length) {
      showAlert({
        title: 'Photo protected',
        message: 'The default iClora activation photo cannot be deleted.',
        type: 'info',
      });
      if (lockedIds.length === uniqueIds.length) return;
    }
    const deleteIds = uniqueIds.filter((id) => !lockedIds.includes(id));
    const firstPhoto = photos.find((photo) => photo.id === deleteIds[0]);
    const deleteTitle = String(firstPhoto?.title || 'this photo').trim();
    const shortDeleteTitle = deleteTitle.length > 6 ? `${deleteTitle.slice(0, 6)}...` : deleteTitle;
    setPhotoDeleteTarget({
      ids: deleteIds,
      count: deleteIds.length,
      title: shortDeleteTitle || 'this photo',
    });
    setTileMenu(null);
    setViewerActionsOpen(false);
  }

  function openPhotoRestoreConfirm(ids = []) {
    const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
    if (!uniqueIds.length) {
      showAlert({ title: 'No photos selected', message: 'Select photos first.', type: 'warning' });
      return;
    }
    const restorableIds = uniqueIds.filter((id) => recentlyDeletedPhotos.some((photo) => photo.id === id));
    if (!restorableIds.length) {
      showAlert({ title: 'Nothing to restore', message: 'Selected photos are not in Recently Deleted.', type: 'info' });
      return;
    }
    const firstPhoto = recentlyDeletedPhotos.find((photo) => photo.id === restorableIds[0]);
    const restoreTitle = String(firstPhoto?.title || 'this photo').trim();
    const shortRestoreTitle = restoreTitle.length > 18 ? `${restoreTitle.slice(0, 18)}...` : restoreTitle;
    setPhotoRestoreTarget({
      ids: restorableIds,
      count: restorableIds.length,
      title: shortRestoreTitle || 'this photo',
    });
    setTileMenu(null);
    setViewerActionsOpen(false);
  }

  function openPhotoPermanentDeleteConfirm(ids = []) {
    const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
    if (!uniqueIds.length) {
      showAlert({ title: 'No photos selected', message: 'Select photos first.', type: 'warning' });
      return;
    }
    const deletableIds = uniqueIds.filter((id) => recentlyDeletedPhotos.some((photo) => photo.id === id));
    if (!deletableIds.length) {
      showAlert({ title: 'Nothing to delete', message: 'Selected photos are not in Recently Deleted.', type: 'info' });
      return;
    }
    const firstPhoto = recentlyDeletedPhotos.find((photo) => photo.id === deletableIds[0]);
    const deleteTitle = String(firstPhoto?.title || 'this photo').trim();
    const shortDeleteTitle = deleteTitle.length > 18 ? `${deleteTitle.slice(0, 18)}...` : deleteTitle;
    setPhotoPermanentDeleteTarget({
      ids: deletableIds,
      count: deletableIds.length,
      title: shortDeleteTitle || 'this photo',
    });
    setTileMenu(null);
    setViewerActionsOpen(false);
  }

  function openPhotoUnhideConfirm(ids = []) {
    const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
    if (!uniqueIds.length) {
      showAlert({ title: 'No photos selected', message: 'Select hidden photos first.', type: 'warning' });
      return;
    }
    const hiddenIds = uniqueIds.filter((id) => {
      const photo = photos.find((item) => item.id === id);
      return photo?.hidden && !photo?.deleted;
    });
    if (!hiddenIds.length) {
      showAlert({ title: 'Nothing to unhide', message: 'Selected photos are already visible.', type: 'info' });
      return;
    }
    const firstPhoto = photos.find((photo) => photo.id === hiddenIds[0]);
    const unhideTitle = String(firstPhoto?.title || 'this photo').trim();
    const shortUnhideTitle = unhideTitle.length > 6 ? `${unhideTitle.slice(0, 6)}...` : unhideTitle;
    setPhotoUnhideTarget({
      ids: hiddenIds,
      count: hiddenIds.length,
      title: shortUnhideTitle || 'this photo',
    });
    setTileMenu(null);
    setViewerActionsOpen(false);
  }

  async function deletePhotosByIds(ids = []) {
    const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
    if (!uniqueIds.length) return;
    const localDeleteIds = uniqueIds.filter((id) => photos.some((photo) => photo.id === id && photo.localOnly));
    const remoteDeleteIds = uniqueIds.filter((id) => !localDeleteIds.includes(id));
    const localDeleteIdSet = new Set(localDeleteIds);
    if (localDeleteIds.length) {
      localDeleteIds.forEach((id) => {
        cancelledLocalUploadIdsRef.current.add(id);
        uploadFilesRef.current.delete(id);
        uploadRetryCountsRef.current.delete(id);
        deleteQueuedPhotoUpload(id).catch(() => {});
      });
      commitPhotos((currentPhotos) => currentPhotos.filter((photo) => !localDeleteIdSet.has(photo.id)), photosMeta);
      setSelectedPhotoIds((current) => current.filter((id) => !localDeleteIdSet.has(id)));
      if (localDeleteIdSet.has(selectedId)) setSelectedId('');
      if (viewerPhase !== 'closed' && selectedPhoto?.localOnly && localDeleteIdSet.has(selectedPhoto.id)) closeViewer();
      showAlert({
        title: 'Upload removed',
        message: `${localDeleteIds.length} retry item${localDeleteIds.length === 1 ? '' : 's'} removed from Photos.`,
        type: 'success',
      });
    }
    if (!remoteDeleteIds.length) return;

    const previousPhotos = photos.filter((photo) => !localDeleteIdSet.has(photo.id));
    const previousMeta = photosMeta;
    const previousSelectedPhotoIds = selectedPhotoIds;
    const deletedPhotosToMove = photos
      .filter((photo) => remoteDeleteIds.includes(photo.id))
      .map((photo) => ({
        ...photo,
        daysRemaining: 15,
        deletedAt: new Date().toISOString(),
      }));
    const nextPhotos = previousPhotos.filter((photo) => !remoteDeleteIds.includes(photo.id));

    rememberPendingDeletePhotos(remoteDeleteIds);
    commitPhotos(nextPhotos, photosMeta);
    commitRecentlyDeletedPhotos((prev) => [...deletedPhotosToMove, ...prev]);
    setSelectedPhotoIds((current) => current.filter((id) => !remoteDeleteIds.includes(id)));
    if (remoteDeleteIds.includes(selectedId)) {
      setSelectedId('');
      navigate(photosBasePath, { replace: true });
    }
    if (viewerPhase !== 'closed' && remoteDeleteIds.includes(selectedPhoto?.id)) {
      viewerCloseInProgressRef.current = false;
      setViewerActionsOpen(false);
      setViewerInfoOpen(false);
      setViewerInfoClosing(false);
      setViewerChromeHidden(false);
      setViewerPhase('closed');
      setViewerZoom(1);
    }

    try {
      const result = remoteDeleteIds.length === 1
        ? await apiFetch(`/photos/${encodeURIComponent(remoteDeleteIds[0])}`, { method: 'DELETE' }).then(async (response) => {
          const json = await readJson(response);
          if (!response.ok || json?.ok === false) throw new Error(json?.error || 'Failed to delete photo');
          return json;
        })
        : await apiJson('/photos/delete', {
          method: 'POST',
          body: JSON.stringify({ ids: remoteDeleteIds }),
        });

      const deletedIds = Array.isArray(result.deletedIds) && result.deletedIds.length
        ? result.deletedIds
        : remoteDeleteIds;
      const deletedIdSet = new Set(deletedIds);
      commitPhotos(previousPhotos.filter((photo) => !deletedIdSet.has(photo.id)), result.meta || photosMeta);
      window.setTimeout(() => loadPhotos({ silent: true }), 4000);
      window.setTimeout(() => loadPhotos({ silent: true }), 15000);
      showAlert({
        title: 'Photos deleted',
        message: `${deletedIds.length} item${deletedIds.length === 1 ? '' : 's'} removed.`,
        type: 'success',
      });
    } catch (error) {
      forgetPendingDeletePhotos(remoteDeleteIds);
      commitPhotos(previousPhotos, previousMeta);
      commitRecentlyDeletedPhotos((prev) => prev.filter((p) => !remoteDeleteIds.includes(p.id)));
      setSelectedPhotoIds(previousSelectedPhotoIds);
      showAlert({
        title: 'Delete failed',
        message: error?.message || 'Could not delete selected photos.',
        type: 'error',
      });
    }
  }

  function confirmPhotoDelete() {
    if (!photoDeleteTarget?.ids?.length) return;
    const deleteIds = photoDeleteTarget.ids;
    setPhotoDeleteTarget(null);
    deletePhotosByIds(deleteIds);
  }

  function confirmPhotoRestore() {
    if (!photoRestoreTarget?.ids?.length) return;
    const restoreIds = photoRestoreTarget.ids;
    setPhotoRestoreTarget(null);
    restoreDeletedPhotos(restoreIds);
  }

  function confirmPhotoPermanentDelete() {
    if (!photoPermanentDeleteTarget?.ids?.length) return;
    const deleteIds = photoPermanentDeleteTarget.ids;
    setPhotoPermanentDeleteTarget(null);
    exitSelectMode();
    permanentDeletePhotos(deleteIds, { confirmed: true });
  }

  function confirmPhotoUnhide() {
    if (!photoUnhideTarget?.ids?.length) return;
    const unhideIds = photoUnhideTarget.ids;
    setPhotoUnhideTarget(null);
    patchPhotosByIds(unhideIds, { hidden: false }, {
      clearSelection: true,
      successTitle: 'Photos unhidden',
      successMessage: `${unhideIds.length} photo${unhideIds.length === 1 ? '' : 's'} moved back to Library.`,
      errorTitle: 'Unhide failed',
      errorMessage: 'Could not unhide selected photos.',
    });
  }

  function enterSelectMode(initialPhoto = null) {
    setSelectMode(true);
    setTileMenu(null);
    setViewerActionsOpen(false);
    if (initialPhoto) {
      setSelectedId(initialPhoto.id);
      setSelectedPhotoIds((ids) => (ids.includes(initialPhoto.id) ? ids : [...ids, initialPhoto.id]));
    }
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedPhotoIds([]);
    setTileMenu(null);
  }

  function toggleSelectAll() {
    setSelectedPhotoIds(allFilteredSelected ? [] : filteredPhotoIds);
  }

  function togglePhotoSelection(photo) {
    setSelectedId(photo.id);
    setSelectedPhotoIds((ids) => (
      ids.includes(photo.id) ? ids.filter((id) => id !== photo.id) : [...ids, photo.id]
    ));
  }

  function runSelectionAction(title) {
    if (!selectedPhotoCount) {
      showAlert({ title, message: 'Select photos first.', type: 'warning' });
      return;
    }
    if (activeView === 'deleted') {
      if (title === 'Restore') {
        openPhotoRestoreConfirm(selectedPhotoIds);
        exitSelectMode();
        return;
      }
      if (title === 'Permanent Delete') {
        openPhotoPermanentDeleteConfirm(selectedPhotoIds);
        return;
      }
    }
    if (title === 'Delete') {
      openPhotoDeleteConfirm(selectedPhotoIds);
      return;
    }
    if (title === 'Unhide') {
      openPhotoUnhideConfirm(selectedPhotoIds);
      return;
    }
    if (title === 'Share') {
      shareSelectedPhotos();
      return;
    }
    showAlert({
      title,
      message: `${selectedPhotoCount} selected photo${selectedPhotoCount === 1 ? '' : 's'}.`,
      type: 'info',
    });
  }

  function openViewer(photo, event) {
    viewerCloseInProgressRef.current = false;
    setTileMenu(null);
    longPressTriggeredRef.current = false;
    const rect = getElementRect(event?.currentTarget);
    if (rect && photo.width > 0 && photo.height > 0) {
      rect.naturalWidth = photo.width;
      rect.naturalHeight = photo.height;
    }
    setTransitionRect(rect);
    setSelectedId(photo.id);
    setViewerZoom(1);
    setViewerChromeHidden(false);
    setViewerActionsOpen(false);
    setViewerInfoOpen(false);
    setViewerInfoClosing(false);
    setViewerPhase('opening');
    navigate(`${photosBasePath}/${encodeURIComponent(photo.id)}`);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setViewerPhase('open'));
    });
  }

  function toggleViewerChrome() {
    if (viewerInfoOpen && !viewerInfoClosing) {
      closeViewerInfo();
      return;
    }
    setViewerActionsOpen(false);
    setViewerChromeHidden((hidden) => !hidden);
  }

  function openViewerInfo() {
    if (viewerInfoTimerRef.current) clearTimeout(viewerInfoTimerRef.current);
    setViewerActionsOpen(false);
    setViewerChromeHidden(false);
    setViewerInfoClosing(false);
    setViewerInfoOpen(true);
  }

  function closeViewerInfo({ immediate = false } = {}) {
    if (viewerInfoTimerRef.current) clearTimeout(viewerInfoTimerRef.current);
    if (immediate) {
      setViewerInfoClosing(false);
      setViewerInfoOpen(false);
      return;
    }
    if (!viewerInfoOpen || viewerInfoClosing) return;
    setViewerInfoClosing(true);
    viewerInfoTimerRef.current = window.setTimeout(() => {
      setViewerInfoOpen(false);
      setViewerInfoClosing(false);
    }, VIEWER_INFO_CLOSE_MS);
  }

  function closeViewer() {
    if (viewerPhase === 'closed' || viewerPhase === 'closing') return;
    viewerCloseInProgressRef.current = true;
    if (skipsViewerOpenAnimation(selectedPhoto)) {
      setViewerActionsOpen(false);
      closeViewerInfo({ immediate: true });
      setViewerChromeHidden(false);
      navigate(photosBasePath);
      setViewerPhase('closed');
      setViewerZoom(1);
      setViewerSlideDirection('');
      viewerCloseInProgressRef.current = false;
      return;
    }
    const target = findPhotoTileById(selectedPhoto?.id);
    const closingRect = getClosingElementRect(target) || transitionRect;
    setViewerActionsOpen(false);
    closeViewerInfo();
    setViewerChromeHidden(false);
    setTransitionRect(closingRect);
    setViewerPhase('open');
    navigate(photosBasePath);
    if (viewerTimerRef.current) clearTimeout(viewerTimerRef.current);
    if (viewerCloseFrameRef.current) cancelAnimationFrame(viewerCloseFrameRef.current);
    viewerCloseFrameRef.current = window.requestAnimationFrame(() => {
      viewerCloseFrameRef.current = window.requestAnimationFrame(() => {
        setViewerPhase('closing');
        viewerTimerRef.current = window.setTimeout(() => {
          viewerCloseInProgressRef.current = false;
          setViewerPhase('closed');
          setViewerZoom(1);
          setViewerSlideDirection('');
        }, VIEWER_CLOSE_TRANSITION_MS);
      });
    });
  }

  function showPhotoAt(index, direction = '') {
    if (!viewerPhotos.length) return;
    const nextIndex = (index + viewerPhotos.length) % viewerPhotos.length;
    const nextPhoto = viewerPhotos[nextIndex];

    const targetElement = typeof document !== 'undefined' ? document.querySelector(`.iclora-photos__tile[data-photo-id="${nextPhoto.id}"]`) : null;
    let nextRect = targetElement ? getElementRect(targetElement) : { ...transitionRect };
    if (nextRect && nextPhoto.width > 0 && nextPhoto.height > 0) {
      nextRect.naturalWidth = nextPhoto.width;
      nextRect.naturalHeight = nextPhoto.height;
    } else if (!targetElement && nextRect && nextPhoto.width > 0) {

      nextRect.naturalWidth = nextPhoto.width;
      nextRect.naturalHeight = nextPhoto.height;
    }
    if (nextRect) setTransitionRect(nextRect);

    setViewerSlideDirection(direction);
    setSelectedId(nextPhoto.id);
    navigate(`${photosBasePath}/${encodeURIComponent(nextPhoto.id)}`);
    setViewerZoom(1);
    setViewerActionsOpen(false);
    setViewerChromeHidden(false);
  }

  function showPreviousPhoto() {
    if (selectedIndex < 0) return;
    showPhotoAt(selectedIndex - 1, 'previous');
  }

  function showNextPhoto() {
    if (selectedIndex < 0) return;
    showPhotoAt(selectedIndex + 1, 'next');
  }

  function beginViewerSwipe(event) {
    if (viewerPhase !== 'open' || viewerZoom > 1.02) return;
    viewerSwipeRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startTime: Date.now(),
      swiped: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function updateViewerSwipe(event) {
    const swipe = viewerSwipeRef.current;
    if (!swipe.active) return;
    swipe.lastX = event.clientX;
    swipe.lastY = event.clientY;
  }

  function endViewerSwipe(event) {
    const swipe = viewerSwipeRef.current;
    if (!swipe.active) return;
    swipe.active = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const deltaX = swipe.lastX - swipe.startX;
    const deltaY = swipe.lastY - swipe.startY;
    const elapsed = Math.max(1, Date.now() - swipe.startTime);
    const velocity = Math.abs(deltaX) / elapsed;
    const isHorizontalSwipe = Math.abs(deltaX) > 42 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2;
    const isFastSwipe = Math.abs(deltaX) > 24 && velocity > 0.45 && Math.abs(deltaX) > Math.abs(deltaY);
    if (!isHorizontalSwipe && !isFastSwipe) return;
    swipe.swiped = true;
    setViewerActionsOpen(false);
    setViewerChromeHidden(false);
    if (deltaX < 0) showNextPhoto();
    else showPreviousPhoto();
  }

  function handleViewerStageClick() {
    if (viewerSwipeRef.current.swiped) {
      viewerSwipeRef.current.swiped = false;
      return;
    }
    toggleViewerChrome();
  }

  function openTileMenuAt(photo, rect, mode = 'button') {
    const menuWidth = mode === 'touch' ? 222 : 232;
    const menuHeight = mode === 'touch' ? 242 : 250;
    const margin = 10;
    const topBoundary = mode === 'touch' ? 74 : margin;
    const bottomBoundary = margin;
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const viewportWidth = window.visualViewport?.width || window.innerWidth;
    const spaceBelow = viewportHeight - rect.bottom - bottomBoundary;
    const spaceAbove = rect.top - topBoundary;
    const openAbove = spaceBelow < menuHeight + 10 && spaceAbove > spaceBelow;

    let preferredTop;
    let preferredLeft;
    let transformOriginX = 'center';
    let transformOriginY = openAbove ? 'bottom' : 'top';

    if (mode === 'touch') {
      preferredTop = openAbove ? rect.top - menuHeight - 10 : rect.bottom + 8;
      preferredLeft = rect.left + (rect.width / 2) - (menuWidth / 2);
    } else {
      preferredTop = openAbove ? rect.top - menuHeight + 10 : rect.top + 36;
      preferredLeft = rect.right - menuWidth + 8;

      if (preferredLeft < rect.left) {
        preferredLeft = rect.left;
        transformOriginX = '32px';
      } else {
        transformOriginX = 'calc(100% - 24px)';
      }
    }

    const left = Math.min(Math.max(margin, preferredLeft), viewportWidth - menuWidth - margin);
    const maxTop = Math.max(topBoundary, viewportHeight - menuHeight - bottomBoundary);
    const top = Math.min(Math.max(topBoundary, preferredTop), maxTop);

    if (mode !== 'touch') setSelectedId(photo.id);
    setTileMenu({
      photoId: photo.id,
      left,
      top,
      mode,
      transformOrigin: `${transformOriginX} ${transformOriginY}`,
      previewRect: mode === 'touch'
        ? {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }
        : null,
    });
  }

  function openTileMenu(photo, event) {
    event.preventDefault();
    event.stopPropagation();
    openTileMenuAt(photo, event.currentTarget.getBoundingClientRect());
  }

  function closeTileMenu() {
    setTileMenu(null);
    longPressTriggeredRef.current = false;
  }

  function runTileMenuAction(action) {
    closeTileMenu();
    action();
  }

  function toggleFavourite(photo = selectedPhoto) {
    if (!photo) return;
    patchPhoto(photo, { favourite: !photo.favourite });
  }

  function hidePhotoWithVerification(photo = selectedPhoto) {
    if (!photo) return;
    patchPhoto(photo, { hidden: true });
  }

  async function handleHiddenAuthProvider(method) {
    if (hiddenProviderBusy || hiddenAuthBusy) return;
    setHiddenProviderBusy(method);
    try {
      if (method === 'google') {
        const { auth, provider: googleProvider } = getGoogleAuthDependencies();
        const popupResult = auth.currentUser
          ? await reauthenticateWithPopup(auth.currentUser, googleProvider)
          : await signInWithPopup(auth, googleProvider);
        const idToken = await popupResult.user.getIdToken(true);
        const result = await apiJson('/photos/hidden-auth/google/verify', {
          method: 'POST',
          body: JSON.stringify({ idToken }),
        });
        await finishHiddenProviderUnlock(result);
        return;
      }

      if (!browserSupportsWebAuthn()) {
        showAlert({
          title: 'Passkeys unavailable',
          message: 'This browser does not support passkey verification.',
          type: 'info',
        });
        return;
      }

      const options = await apiJson('/photos/hidden-auth/passkey/options', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const authenticationResponse = await startAuthentication({ optionsJSON: options.options });
      const result = await apiJson('/photos/hidden-auth/passkey/verify', {
        method: 'POST',
        body: JSON.stringify({
          challengeId: options.challengeId,
          response: authenticationResponse,
        }),
      });
      await finishHiddenProviderUnlock(result);
    } catch (error) {
      showAlert({
        title: method === 'google' ? 'Google unlock failed' : 'Passkey unlock failed',
        message: error?.message || 'Could not unlock Hidden Photos.',
        type: 'error',
      });
    } finally {
      setHiddenProviderBusy('');
    }
  }

  function handleViewerFavouriteClick() {
    setFavouritePopKey((key) => key + 1);
    toggleFavourite();
  }

  async function sharePhoto(photo = selectedPhoto) {
    if (!photo) return;
    if (photo.system || photo.locked || photo.id === 'iclora-default-photo') {
      showAlert({
        title: 'iClora photo',
        message: 'The default activation photo is private to your account and cannot be shared.',
        type: 'info',
      });
      return;
    }
    setShareModalPhoto(photo);
    setViewerActionsOpen(false);
  }

  function shareSelectedPhotos() {
    if (!selectedPhotoCount) {
      showAlert({ title: 'Share', message: 'Select photos first.', type: 'warning' });
      return;
    }
    const selectedPhotos = selectedPhotoIds
      .map((id) => photos.find((photo) => photo.id === id))
      .filter(Boolean);
    if (!selectedPhotos.length) return;
    const protectedPhoto = selectedPhotos.find((photo) => photo.system || photo.locked || photo.id === 'iclora-default-photo');
    if (protectedPhoto) {
      showAlert({
        title: 'iClora photo',
        message: 'Protected activation photos cannot be shared.',
        type: 'info',
      });
      return;
    }
    setShareDurationModalPhoto(selectedPhotos);
  }

  function openSecureLinkDuration(photo = shareModalPhoto) {
    if (!photo) return;
    setShareModalPhoto(null);
    setShareDurationModalPhoto(photo);
  }

  async function copySecureLink(link = shareLinkResult) {
    if (!link?.url) return;
    try {
      await navigator.clipboard?.writeText(link.url);
      showAlert({ title: 'iClora Link copied', message: 'Secure link copied to clipboard.', type: 'success' });
    } catch {
      showAlert({ title: 'Copy failed', message: 'Could not copy this link.', type: 'error' });
    }
  }

  async function nativeShareSecureLink(link = shareLinkResult) {
    if (!link?.url) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: link.photoTitle, text: 'Shared with an iClora secure link.', url: link.url });
        return;
      }
      await copySecureLink(link);
    } catch (error) {
      if (error?.name !== 'AbortError') {
        showAlert({ title: 'Share failed', message: 'Could not share this iClora Link right now.', type: 'error' });
      }
    }
  }

  async function generateSecureLink(durationHours) {
    if (!shareDurationModalPhoto) return;
    try {
      const link = await createSecurePhotoLink(shareDurationModalPhoto, durationHours);
      const nextLinks = [link, ...secureLinks.filter((item) => item.id !== link.id)].slice(0, 40);
      setSecureLinks(nextLinks);
      writePhotoLinks(nextLinks);
      setShareDurationModalPhoto(null);
      setShareLinkResult(link);
      setActiveView('links');
      showAlert({ title: 'iClora Link ready', message: 'Secure sharing link generated.', type: 'success' });
    } catch (error) {
      showAlert({
        title: 'Link failed',
        message: error?.message || 'Could not create this iClora Link.',
        type: 'error',
      });
    }
  }

  async function confirmDeleteSecureLink() {
    if (!linkDeleteTarget || linkDeleting) return;
    setLinkDeleting(true);
    try {
      const nextLinks = await deleteSecurePhotoLink(linkDeleteTarget.id);
      setSecureLinks(nextLinks);
      setLinkDeleteTarget(null);
      showAlert({ title: 'iClora Link deleted', message: 'This secure link is no longer available.', type: 'success' });
    } catch (error) {
      showAlert({
        title: 'Delete failed',
        message: error?.message || 'Could not delete this iClora Link.',
        type: 'error',
      });
    } finally {
      setLinkDeleting(false);
    }
  }

  function openDownloadModal(photo = selectedPhoto) {
    if (!photo) return;
    setDownloadModalPhoto(photo);
    setDownloadFileName(normalizeDownloadBaseName(photo.title) || 'iclora-photo');
    setTileMenu(null);
    setViewerActionsOpen(false);
  }

  async function confirmPhotoDownload() {
    if (!downloadModalPhoto || downloadPending) return;
    const baseName = normalizeDownloadBaseName(downloadFileName) || 'iclora-photo';
    const extension = resolvePhotoDownloadExtension(downloadModalPhoto);
    const fileName = baseName.toLowerCase().endsWith(`.${extension}`) ? baseName : `${baseName}.${extension}`;
    setDownloadPending(true);
    try {
      const response = await fetch(downloadModalPhoto.originalUrl || downloadModalPhoto.src, { mode: 'cors' });
      if (!response.ok) throw new Error('Could not prepare this photo for download.');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setDownloadModalPhoto(null);
      showAlert({
        title: 'Download started',
        message: `${fileName} is downloading now.`,
        type: 'success',
      });
    } catch (error) {
      showAlert({
        title: 'Download failed',
        message: error?.message || 'Could not download this photo right now.',
        type: 'error',
      });
    } finally {
      setDownloadPending(false);
    }
  }

  async function downloadSelectedPhotosZip() {
    if (!selectedPhotoCount || selectedDownloadPending) {
      if (!selectedPhotoCount) showAlert({ title: 'Download', message: 'Select photos first.', type: 'warning' });
      return;
    }
    const selectedPhotos = selectedPhotoIds
      .map((id) => photos.find((photo) => photo.id === id))
      .filter(Boolean);
    if (!selectedPhotos.length) return;

    setSelectedDownloadPending(true);
    showAlert({
      title: 'Download initialized',
      message: `Preparing ${selectedPhotos.length} photo${selectedPhotos.length === 1 ? '' : 's'} as ZIP...`,
      type: 'info',
    });

    try {
      const zip = new JSZip();
      const usedNames = new Set();

      for (let index = 0; index < selectedPhotos.length; index += 1) {
        const photo = selectedPhotos[index];
        const response = await fetch(photo.originalUrl || photo.src, { mode: 'cors' });
        if (!response.ok) throw new Error(`Could not prepare ${photo.title || 'a photo'} for download.`);
        const blob = await response.blob();
        const extension = resolvePhotoDownloadExtension(photo);
        const baseName = normalizeDownloadBaseName(photo.title || `Photo ${index + 1}`) || `Photo ${index + 1}`;
        let candidate = baseName;
        let suffix = 2;
        while (usedNames.has(`${candidate}.${extension}`.toLowerCase())) {
          candidate = `${baseName} ${suffix}`;
          suffix += 1;
        }
        usedNames.add(`${candidate}.${extension}`.toLowerCase());
        zip.file(`${candidate}.${extension}`, blob);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const objectUrl = URL.createObjectURL(zipBlob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `iClora Photos ${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      showAlert({
        title: 'Photos downloaded',
        message: `${selectedPhotos.length} photo${selectedPhotos.length === 1 ? '' : 's'} exported as ZIP.`,
        type: 'success',
      });
    } catch (error) {
      showAlert({
        title: 'Download failed',
        message: error?.message || 'Could not download selected photos.',
        type: 'error',
      });
    } finally {
      setSelectedDownloadPending(false);
    }
  }

  function showDemoAction(title) {
    showAlert({
      title,
      message: 'This Photos action is coming next.',
      type: 'info',
    });
  }

  function startTileLongPress(photo, event) {
    if (event.pointerType === 'mouse') return;
    if (selectMode) return;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTriggeredRef.current = false;
    const target = event.currentTarget;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      suppressContextMenuUntilRef.current = Date.now() + 900;
      openTileMenuAt(photo, target.getBoundingClientRect(), 'touch');
    }, 430);
  }

  function clearTileLongPressTimer() {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }

  function handleTileClick(photo, event) {
    if (selectMode) {
      event.preventDefault();
      event.stopPropagation();
      togglePhotoSelection(photo);
      return;
    }
    if (longPressTriggeredRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    openViewer(photo, event);
  }

  const uploadBatchLimit = getUploadBatchLimit();

  return (
    <main className={`iclora-photos ${viewerPhase !== 'closed' && viewerPhase !== 'closing' ? 'is-viewer-open' : ''} ${viewerPhase === 'closing' ? 'is-viewer-closing' : ''} ${selectMode ? 'is-select-mode' : ''} ${desktopSidebarCollapsed ? 'is-sidebar-collapsed' : ''} ${activeView === AI_SEARCH_VIEW && aiSearchFocused ? 'is-ai-search-keyboard' : ''}`} aria-label="iClora Photos">
      {viewerPhase === 'closed' || viewerPhase === 'closing' ? (
        <DashboardNavbar
          user={profile}
          accentColor={accentColor}
          showBack={true}
          onBack={() => navigate('/cloud')}
          whiteBackground={true}
          appLabel="Photos"
          appLabelColor="#ff2f92"
          appIcon="/apps/photos.webp"
          appIconDark="/apps/photos-dark.webp"
          appSyncing={navbarSyncing}
          appSyncLabel="Syncing photos"
        />
      ) : null}

        <section className={`iclora-photos__shell ${pageEntered ? 'is-entered' : ''}`} style={{ '--photo-grid-size': `${gridSize}px`, '--photo-mobile-grid-size': `${mobileGridSize}px` }}>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_PHOTO_UPLOAD_TYPES}
          multiple
          className="iclora-photos__file-input"
          onChange={handlePhotoFilesSelected}
        />
        <aside className={`iclora-photos__sidebar ${sidebarOpen ? 'is-open' : ''}`} aria-label="Photos navigation">
          <div className="iclora-photos__sidebar-mobilebar" aria-hidden={!sidebarOpen}>
            <span className="iclora-photos__sidebar-mobiletitle">
              <picture>
                <source srcSet="/apps/photos-dark.webp" media="(prefers-color-scheme: dark)" />
                <img src="/apps/photos.webp" alt="Photos" className="iclora-photos__sidebar-mobiletitle-icon" />
              </picture>
              <span>iClora <span className="iclora-photos__sidebar-mobiletitle-photos">Photos</span></span>
            </span>
            <button type="button" className="iclora-photos__sidebar-close" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)}>
              <FiX />
            </button>
          </div>
          <button
            type="button"
            className={`iclora-photos__nav-item iclora-photos__ai-search-button is-gold ${activeView === AI_SEARCH_VIEW ? 'is-active' : ''}`}
            onClick={() => selectSidebarItem(AI_SEARCH_VIEW)}
          >
            <span className="iclora-photos__nav-chevron" />
            <span className="iclora-photos__nav-icon">
              <div className="iclora-photos__sidebar-brand-icon">
                <picture>
                  <source srcSet="/apps/photos-dark.webp" media="(prefers-color-scheme: dark)" />
                  <img src="/apps/photos.webp" alt="" aria-hidden="true" draggable={false} />
                </picture>
              </div>
            </span>
            <span>Search Photos</span>
          </button>
          {SIDEBAR_SECTIONS.map((section) => (
            <div className="iclora-photos__sidebar-section" key={section.title}>
              <h2>{section.title}</h2>
              {section.items.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`iclora-photos__nav-item ${item.accent === 'gold' ? 'is-gold' : ''} ${!item.externalUrl && activeView === item.id ? 'is-active' : ''}`}
                  onClick={() => (item.externalUrl ? openSidebarExternalLink(item.externalUrl) : selectSidebarItem(item.id))}
                >
                  {item.chevron ? <FiChevronRight className="iclora-photos__nav-chevron" /> : <span className="iclora-photos__nav-chevron" />}
                  <span className="iclora-photos__nav-icon">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </aside>

        {sidebarOpen ? <button type="button" className="iclora-photos__sidebar-scrim" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} /> : null}

        <section className={`iclora-photos__main ${activeView === AI_SEARCH_VIEW ? 'is-ai-search' : ''}`}>
          {activeView === AI_SEARCH_VIEW ? <button type="button" className="iclora-photos__mobile-menu-toggle" aria-label="Open sidebar" onClick={() => setSidebarOpen(true)}><FiMenu /></button> : null}
          {activeView === AI_SEARCH_VIEW ? null : (
          <div className="iclora-photos__toolbar" aria-label="Photos controls">
            <div className="iclora-photos__toolbar-left">
              {selectMode ? (
                <button type="button" className="iclora-photos__selection-command" onClick={toggleSelectAll}>
                  {allFilteredSelected ? 'Deselect All' : 'Select All'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="iclora-photos__tool iclora-photos__desktop-sidebar-toggle"
                    aria-label={desktopSidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
                    aria-pressed={desktopSidebarCollapsed}
                    title={desktopSidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
                    onClick={() => setDesktopSidebarCollapsed((collapsed) => !collapsed)}
                  >
                    <FiSidebar />
                  </button>
                  <button type="button" className="iclora-photos__tool iclora-photos__sidebar-toggle" aria-label="Open sidebar" onClick={() => setSidebarOpen(true)}><FiMenu /></button>
                  <div className="iclora-photos__zoom-control" aria-label="Grid zoom">
                    <button type="button" aria-label="Smaller thumbnails" onClick={() => setGridZoomLevel(gridZoom - 1)}><FiMinus /></button>
                    <input
                      type="range"
                      min="0"
                      max={GRID_SIZES.length - 1}
                      step="1"
                      value={gridZoom}
                      style={{ '--zoom-fill': gridZoomFill }}
                      onInput={(event) => setGridZoomLevel(event.currentTarget.value)}
                      onChange={(event) => setGridZoomLevel(event.currentTarget.value)}
                      aria-label="Thumbnail size"
                    />
                    <button type="button" aria-label="Larger thumbnails" onClick={() => setGridZoomLevel(gridZoom + 1)}><FiPlus /></button>
                  </div>
                </>
              )}
            </div>
            <div className="iclora-photos__toolbar-actions">
              {selectMode ? (
                <button type="button" className="iclora-photos__selection-command" onClick={exitSelectMode}>Cancel</button>
              ) : (
                <>
                  <button type="button" aria-label="Upload photos" disabled={uploadingPhotos || setupRequired} onClick={() => setUploadModalOpen(true)}><IoCloudUploadOutline /></button>
                  <button type="button" className="iclora-photos__select-button" onClick={() => enterSelectMode()}>Select</button>
                </>
              )}
            </div>
          </div>
          )}

          <section className="iclora-photos__content" onScroll={closeTileMenu}>
            {activeView !== AI_SEARCH_VIEW ? (
            <div className={`iclora-photos__heading`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                  <h1>{pageTitle}</h1>
                  {activeView === 'library'
                    ? <p className="iclora-photos__heading-meta">{syncedPhotoCount} synced</p>
                    : activeView === 'deleted'
                    ? <p className="iclora-photos__heading-meta">Photos are kept for 15 days, then permanently removed. {filteredPhotos.length ? photoCountLabel(filteredPhotos) : ''}</p>
                    : activeView === 'hidden' && !hiddenViewUnlocked
                    ? <p className="iclora-photos__heading-meta">Passcode required</p>
                    : activeView === 'links'
                    ? null
                    : <p>{filteredPhotos.length ? photoCountLabel(filteredPhotos) : 'No Photos'}</p>}
                </div>
              </div>
            </div>
            ) : null}

            {setupRequired ? (
              <div className="iclora-photos__setup">
                <div className="iclora-photos__library-empty-icon" aria-hidden="true">
                  <picture>
                    <source srcSet="/apps/photos-dark.webp" media="(prefers-color-scheme: dark)" />
                    <img src="/apps/photos.webp" alt="" aria-hidden="true" />
                  </picture>
                </div>
                <h2>Setup iClora Photos</h2>
                <p>Your Photos Cloud needs activation before your private library can open.</p>
                <button type="button" onClick={activatePhotos} disabled={setupLoading}>
                  {setupLoading ? 'Activating...' : 'Activate Photos'}
                </button>
              </div>
            ) : showHiddenAuthPage ? (
              <section className="iclora-photos__hidden-page" aria-labelledby="photos-hidden-page-title">
                <div className="iclora-photos__hidden-page-card">
                  <h2 id="photos-hidden-page-title">
                    {hiddenAuthModal?.mode === 'setup' ? 'Set up Hidden Photos' : 'Unlock Hidden Photos'}
                  </h2>
                  {hiddenAuthPreparing || !hiddenAuthModal ? (
                    <div className="iclora-photos__syncing" role="status" aria-live="polite">
                      <span className="iclora-photos__sync-loader" aria-hidden="true" />
                      <strong>Checking Hidden Photos</strong>
                    </div>
                  ) : (
                    <form className="iclora-photos__hidden-auth-form iclora-photos__hidden-page-form" onSubmit={submitHiddenPhotosVerification}>
                      {hiddenAuthModal.mode !== 'setup' ? (
                        <>
                          <button
                            type="button"
                            className="iclora-photos__hidden-provider"
                            onClick={() => handleHiddenAuthProvider('google')}
                            disabled={Boolean(hiddenProviderBusy || hiddenAuthBusy)}
                            aria-busy={hiddenProviderBusy === 'google'}
                          >
                            <img src="/apps/Google_Favicon_2025.svg.webp" alt="" aria-hidden="true" />
                            <span>{hiddenProviderBusy === 'google' ? 'Waiting for Google...' : 'Continue with Google'}</span>
                          </button>
                          <button
                            type="button"
                            className="iclora-photos__hidden-provider"
                            onClick={() => handleHiddenAuthProvider('passkey')}
                            disabled={Boolean(hiddenProviderBusy || hiddenAuthBusy)}
                            aria-busy={hiddenProviderBusy === 'passkey'}
                          >
                            <img src="/passkey.webp" alt="" aria-hidden="true" />
                            <span>{hiddenProviderBusy === 'passkey' ? 'Waiting for passkey...' : 'Continue with Passkey'}</span>
                          </button>
                          <div className="iclora-photos__hidden-divider" aria-hidden="true">
                            <span />
                            <em>OR</em>
                            <span />
                          </div>
                        </>
                      ) : null}
                      <label className="iclora-photos__hidden-field">
                        <input
                          type="text"
                          inputMode="numeric"
                          autoFocus
                          autoComplete="off"
                          name="hidden-photos-passcode"
                          aria-label="Hidden Photos passcode"
                          data-lpignore="true"
                          data-1p-ignore="true"
                          value={hiddenAuthModal.passcode}
                          onChange={(event) => setHiddenAuthModal((current) => ({ ...current, passcode: event.target.value.replace(/\D/g, '').slice(0, 12), error: '' }))}
                          placeholder={hiddenAuthModal.mode === 'setup' ? 'Create passcode' : 'Enter passcode'}
                        />
                      </label>
                      {hiddenAuthModal.mode === 'setup' ? (
                        <label className="iclora-photos__hidden-field">
                          <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            name="hidden-photos-passcode-confirm"
                            aria-label="Confirm Hidden Photos passcode"
                            data-lpignore="true"
                            data-1p-ignore="true"
                            value={hiddenAuthModal.confirmPasscode}
                            onChange={(event) => setHiddenAuthModal((current) => ({ ...current, confirmPasscode: event.target.value.replace(/\D/g, '').slice(0, 12), error: '' }))}
                            placeholder="Confirm passcode"
                          />
                        </label>
                      ) : null}
                      {hiddenAuthModal.error ? <p className="iclora-photos__hidden-auth-error">{hiddenAuthModal.error}</p> : null}
                      <button type="submit" className="iclora-photos__hidden-page-submit" disabled={Boolean(hiddenAuthBusy || hiddenProviderBusy)}>
                        {hiddenAuthBusy ? 'Checking...' : hiddenAuthModal.mode === 'setup' ? 'Continue' : 'Continue'}
                      </button>
                    </form>
                  )}
                </div>
              </section>
            ) : activeView === AI_SEARCH_VIEW ? (
              <div className={`iclora-photos__ai-search-page ${aiSearchTokens.length > 0 && aiSearchResults.length > 0 ? 'has-results' : ''}`} aria-label="Search Photos">
                <div className="iclora-photos__ai-search-hero">
                  <button type="button" className="iclora-photos__ai-search-logo-btn" onClick={resetAiSearch} aria-label="Reset search">
                    {[0,1,2,3,4,5,6,7].map((i) => (
                      <span key={i} className="iclora-photos__ai-spark" style={{'--spark-i': i}} aria-hidden="true" />
                    ))}
                    <img src="/photos%20(1)_11zon%20(1).webp" alt="" aria-hidden="true" draggable={false} className="iclora-photos__ai-search-logo" />
                    <span className="iclora-photos__ai-logo-tip" aria-hidden="true">Hey! Click on me to refresh ✨</span>
                  </button>
                  <form className="iclora-photos__ai-search-shell" onSubmit={runAiPhotoSearch}>
                    <FiSearch aria-hidden="true" />
                    <input
                      type="search"
	                      value={aiSearchQuery}
	                      onChange={(event) => setAiSearchQuery(event.target.value)}
	                      onFocus={() => {
	                        setAiSearchFocused(true);
	                        focusAiSearchInput();
	                      }}
	                      onBlur={() => window.setTimeout(() => setAiSearchFocused(false), 120)}
	                      placeholder="Search your photos..."
	                      aria-label="Search photos by keyword"
	                      autoComplete="off"
	                      autoCapitalize="none"
	                      enterKeyHint="search"
	                      spellCheck={false}
                    />
                    {aiSearchQuery.trim() ? (
                      <>
                        <button type="button" className="iclora-photos__ai-search-clear" onClick={resetAiSearch} aria-label="Clear"><FiX /></button>
                        <button type="submit" className="iclora-photos__ai-search-submit" aria-label="Search"><FiSearch /></button>
                      </>
                    ) : null}
                  </form>
                  {aiSearchTokens.length > 0 && aiSearchResults.length > 0 ? (
                    <p className="iclora-photos__ai-search-count">{aiSearchResults.length} result{aiSearchResults.length === 1 ? '' : 's'}</p>
                  ) : !aiSearchQuery.trim() ? (
                    <div className="iclora-photos__ai-suggestions" aria-label="Search suggestions">
                      {['People', 'Sunset', 'Food', 'Nature', 'Travel', 'Family', 'Selfie', 'Night'].map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          className="iclora-photos__ai-chip"
	                          onClick={() => {
	                            setAiSearchQuery(chip);
	                            setAiSearchFocused(true);
	                            setTimeout(() => {
	                              document.querySelector('.iclora-photos__ai-search-shell input')?.focus?.({ preventScroll: true });
	                              const event = new Event('submit', { bubbles: true, cancelable: true });
	                              document.querySelector('.iclora-photos__ai-search-shell')?.dispatchEvent(event);
	                            }, 0);
                          }}
                        >
                          {chip}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                {showInitialPhotosLoader ? (
                  <div className="iclora-photos__ai-results" aria-label="Loading">
                    {Array.from({ length: 12 }).map((_, index) => (
                      <div className="iclora-photos__ai-photo is-skeleton" key={`skel-${index}`} />
                    ))}
                  </div>
                ) : aiSearchTokens.length > 0 && aiSearchResults.length > 0 ? (
                  <div className="iclora-photos__ai-results" aria-label="Search results">
                    {aiSearchResults.map(({ photo }) => (
                      <button
                        type="button"
                        className={`iclora-photos__ai-photo ${viewerPhase === 'closing' && selectedId === photo.id ? 'is-return-target' : ''}`}
                        key={photo.id}
                        data-photo-id={photo.id}
                        onClick={(event) => openViewer(photo, event)}
                        aria-label={photo.title}
                      >
                        <img src={photo.thumbnailSrc || photo.src} alt="" draggable={false} loading="lazy" />
                      </button>
                    ))}
                  </div>
                ) : aiSearchTokens.length > 0 && aiSearchResults.length === 0 ? (
                  <div className="iclora-photos__ai-empty">
                    <FiSearch aria-hidden="true" />
                    <p>No photos found for &ldquo;{aiSubmittedQuery}&rdquo;</p>
                  </div>
                ) : null}
              </div>
            ) : activeView === 'links' ? (
              <div className="iclora-photos__links-panel" aria-label="iClora Links">
                {secureLinks.length ? (
                  <div className="iclora-photos__links-list">
                    {secureLinks.map((link) => (
	                      <article className="iclora-photos__link-card" key={link.id}>
	                        <div>
	                          <strong>{link.photoTitle}</strong>
	                          <span>{Number(link.photoCount || 1)} photo{Number(link.photoCount || 1) === 1 ? '' : 's'} · Expires {new Date(link.expiresAt).toLocaleString()}</span>
	                        </div>
                        <div className="iclora-photos__link-actions">
                          <button type="button" aria-label={`Copy ${link.photoTitle} iClora Link`} onClick={() => copySecureLink(link)}>
                            <FiLink />
                            <span>Copy</span>
                          </button>
                          <button type="button" className="is-danger" aria-label={`Delete ${link.photoTitle} iClora Link`} onClick={() => setLinkDeleteTarget(link)}>
                            <FiTrash2 />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="iclora-photos__empty">
                    <FiCloud aria-hidden="true" />
                    <h2>No iClora Links yet</h2>
                    <p>Share a photo with an iClora secure link to see it here.</p>
                  </div>
                )}
              </div>
            ) : filteredPhotos.length || showInitialPhotosLoader || canLoadMorePhotos ? (
              <div className="iclora-photos__grid" aria-label="Photo library">
                {filteredPhotos.map((photo) => (
                  <div
                    role="button"
                    tabIndex={0}
                    key={photo.id}
                    className={`iclora-photos__tile ${!selectMode && selectedId === photo.id ? 'is-selected' : ''} ${viewerPhase === 'closing' && selectedId === photo.id ? 'is-return-target' : ''} ${selectMode ? 'is-selecting' : ''} ${selectedPhotoIdSet.has(photo.id) ? 'is-photo-selected' : ''} ${tileMenu?.mode === 'touch' && tileMenu.photoId === photo.id ? 'is-touch-preview' : ''}`}
                    onPointerDown={(event) => startTileLongPress(photo, event)}
                    onPointerUp={clearTileLongPressTimer}
                    onPointerCancel={clearTileLongPressTimer}
                    onPointerLeave={clearTileLongPressTimer}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (selectMode) return;
                      if (Date.now() < suppressContextMenuUntilRef.current || longPressTriggeredRef.current) return;
                      openTileMenuAt(photo, event.currentTarget.getBoundingClientRect(), 'touch');
                    }}
                    onClick={(event) => handleTileClick(photo, event)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      if (selectMode) {
                        togglePhotoSelection(photo);
                        return;
                      }
                      openViewer(photo, event);
                    }}
                    data-photo-id={photo.id}
                    aria-label={`${selectMode ? 'Select' : 'Open'} ${photo.title}`}
                    aria-pressed={selectMode ? selectedPhotoIdSet.has(photo.id) : undefined}
                  >
                    <img
                      src={photo.thumbnailSrc || photo.src || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? '/apps/photos-dark.webp' : '/apps/photos.webp')}
                      alt={photo.title}
                      draggable={false}
                      loading="lazy"
                      onError={(event) => {
                        if (photo.localOnly && !event.currentTarget.src.endsWith('/apps/photos.webp') && !event.currentTarget.src.endsWith('/apps/photos-dark.webp')) {
                          const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                          event.currentTarget.src = isDark ? '/apps/photos-dark.webp' : '/apps/photos.webp';
                        }
                      }}
                    />
                    {photo.syncStatus === 'processing' ? (
                      <span className="iclora-photos__tile-status">Processing</span>
                    ) : null}
                    {photo.syncStatus === 'failed' ? (
                      <button
                        type="button"
                        className="iclora-photos__tile-status is-failed"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          retryFailedUpload(photo);
                        }}
                      >
                        Retry
                      </button>
                    ) : null}
                    {selectMode ? (
                      <span className="iclora-photos__selection-check" aria-hidden="true"><FiCheck /></span>
                    ) : (
                      <button
                        type="button"
                        className="iclora-photos__tile-more"
                        aria-label={`More actions for ${photo.title}`}
                        aria-haspopup="menu"
                        aria-expanded={tileMenu?.photoId === photo.id}
                        onClick={(event) => openTileMenu(photo, event)}
                      >
                        <FiMoreHorizontal />
                      </button>
                    )}
                  </div>
                ))}
                {(showInitialPhotosLoader || photosPageLoading) ? Array.from({ length: showInitialPhotosLoader ? PHOTO_SKELETON_TILE_COUNT : 12 }).map((_, index) => (
                  <div
                    className="iclora-photos__tile iclora-photos__tile--skeleton"
                    key={`photos-skeleton-${showInitialPhotosLoader ? 'initial' : 'page'}-${index}`}
                    aria-hidden="true"
                  />
                )) : null}
                {canLoadMorePhotos ? (
                  <div className="iclora-photos__pagination" ref={photoPageSentinelRef}>
                    <button type="button" onClick={loadMorePhotos} disabled={photosPageLoading}>
                      {photosPageLoading ? 'Loading more...' : 'Load more'}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : activeView === 'deleted' && !recentlyDeletedLoaded ? (
              <div className="iclora-photos__syncing" role="status" aria-live="polite">
                <span className="iclora-photos__sync-loader" aria-hidden="true" />
                <strong>Syncing now</strong>
              </div>
            ) : (
              <div className="iclora-photos__empty">
                {activeView === 'deleted' ? (
                  <div className="iclora-photos__rd-empty" style={{ paddingTop: '10vh' }}>
                    <FiTrash2 aria-hidden="true" />
                    <p>No Recently Deleted Photos</p>
                    <span>Photos you delete will appear here for 15 days.</span>
                  </div>
                ) : (
                  <>
                    <div className="iclora-photos__library-empty-icon" aria-hidden="true">
                      <picture>
                        <source srcSet="/apps/photos-dark.webp" media="(prefers-color-scheme: dark)" />
                        <img src="/apps/photos.webp" alt="" aria-hidden="true" />
                      </picture>
                    </div>
                    <h2>No photos here yet</h2>
                    <p>Upload photos to start your private iClora library.</p>
                  </>
                )}
              </div>
            )}

            {activeView === 'library' ? (
              <footer className="iclora-photos__summary">
                <strong>{photoCountLabel(photos)}</strong>
                <span>{photosLoading ? 'Syncing now' : photosMeta?.updatedAt ? 'Synced recently' : 'Ready to upload'}</span>
              </footer>
            ) : null}
          </section>
        </section>
      </section>

      {selectMode ? (
        <div className="iclora-photos__selection-bar" aria-live="polite">
          {activeView !== 'deleted' ? (
            <button type="button" aria-label="Share selected photos" disabled={!selectedPhotoCount} onClick={() => runSelectionAction('Share')}>
              <ShareIcon />
            </button>
          ) : (
            <button type="button" aria-label="Restore selected photos" disabled={!selectedPhotoCount} onClick={() => runSelectionAction('Restore')} style={{ color: 'var(--photos-blue)', fontSize: '0.9rem', fontWeight: 600 }}>
              Restore
            </button>
          )}
          <strong>{selectedPhotoCount} selected</strong>
          <div className="iclora-photos__selection-actions">
            {activeView === 'hidden' ? (
              <button type="button" aria-label="Unhide selected photos" disabled={!selectedPhotoCount} onClick={() => runSelectionAction('Unhide')}>
                <FiEye />
              </button>
            ) : null}
            <button type="button" aria-label="Delete selected photos" disabled={!selectedPhotoCount} onClick={() => runSelectionAction(activeView === 'deleted' ? 'Permanent Delete' : 'Delete')} style={activeView === 'deleted' ? { color: '#ff3b30' } : {}}>
              <FiTrash2 />
            </button>
            {activeView !== 'deleted' ? (
              <button
                type="button"
                aria-label="Download selected photos as ZIP"
                disabled={!selectedPhotoCount || selectedDownloadPending}
                onClick={downloadSelectedPhotosZip}
                aria-busy={selectedDownloadPending}
              >
                <DownloadIcon size={22} />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {tileMenu?.mode === 'touch' ? (
        <button type="button" className="iclora-photos__touch-backdrop" aria-label="Close photo actions" onClick={closeTileMenu} />
      ) : null}

      {tileMenu?.mode === 'touch' && menuPhoto && tileMenu.previewRect ? (
        <div
          className="iclora-photos__touch-preview"
          style={{
            left: `${tileMenu.previewRect.left}px`,
            top: `${tileMenu.previewRect.top}px`,
            width: `${tileMenu.previewRect.width}px`,
            height: `${tileMenu.previewRect.height}px`,
          }}
          aria-hidden="true"
        >
          <img src={menuPhoto.thumbnailSrc || menuPhoto.src} alt="" draggable={false} />
        </div>
      ) : null}

      {tileMenu && menuPhoto ? (
        <div
          className={`iclora-photos__tile-menu ${tileMenu.mode === 'touch' ? 'is-touch' : ''}`}
          style={{ left: `${tileMenu.left}px`, top: `${tileMenu.top}px`, transformOrigin: tileMenu.transformOrigin || '32px 0' }}
          role="menu"
          aria-label={`${menuPhoto.title} actions`}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => runTileMenuAction(() => enterSelectMode(menuPhoto))}>
            <FiCheck />
            <span>Select</span>
          </button>

          {activeView === 'deleted' ? (
            <>
              <button type="button" role="menuitem" style={{ color: 'var(--photos-blue)' }} onClick={() => runTileMenuAction(() => openPhotoRestoreConfirm([menuPhoto.id]))}>
                <FiRefreshCcw />
                <span>Restore</span>
              </button>
              <button type="button" role="menuitem" className="is-danger has-divider" onClick={() => runTileMenuAction(() => openPhotoPermanentDeleteConfirm([menuPhoto.id]))}>
                <FiTrash2 />
                <span>Delete Permanently</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                className={menuPhoto.favourite ? 'is-favourite' : ''}
                onClick={() => runTileMenuAction(() => toggleFavourite(menuPhoto))}
              >
                {menuPhoto.favourite ? <FaHeart /> : <FiHeart />}
                <span>Favourite</span>
              </button>
              <button type="button" role="menuitem" onClick={() => runTileMenuAction(() => openDownloadModal(menuPhoto))}>
                <DownloadIcon size={18} />
                <span>Download</span>
              </button>
              {!menuPhotoProtected ? (
                <button type="button" role="menuitem" className="has-divider" onClick={() => runTileMenuAction(() => sharePhoto(menuPhoto))}>
                  <ShareIcon />
                  <span>Share...</span>
                </button>
              ) : null}
              <button type="button" role="menuitem" className="has-divider" onClick={() => runTileMenuAction(() => (menuPhoto.hidden ? openPhotoUnhideConfirm([menuPhoto.id]) : hidePhotoWithVerification(menuPhoto)))}>
                {menuPhoto.hidden ? <FiEye /> : <FiEyeOff />}
                <span>{menuPhoto.hidden ? 'Unhide' : 'Hide'}</span>
              </button>
              <button type="button" role="menuitem" className="is-danger" onClick={() => runTileMenuAction(() => openPhotoDeleteConfirm([menuPhoto.id]))}>
                <FiTrash2 />
                <span>Delete</span>
              </button>
            </>
          )}
        </div>
      ) : null}

      {hiddenAuthModal && activeView !== 'hidden' ? (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={closeHiddenAuthModal}>
          <section
            className="manage-account__name-modal iclora-photos__modal iclora-photos__hidden-auth"
            role="dialog"
            aria-modal="true"
            aria-labelledby="photos-hidden-auth-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button type="button" className="manage-account__modal-close" aria-label="Close hidden photos verification" onClick={closeHiddenAuthModal}>
              <FiX />
            </button>
            <div className="manage-account__modal-icon iclora-photos__modal-icon iclora-photos__hidden-auth-icon" aria-hidden="true">
              <FiEyeOff />
            </div>
            <h2 id="photos-hidden-auth-title">
              {hiddenAuthModal.mode === 'setup' ? 'Setup Hidden Photos' : 'Verify Hidden Photos'}
            </h2>
            <p className="manage-account__delete-copy iclora-photos__hidden-auth-copy">
              {hiddenAuthModal.mode === 'setup'
                ? 'Create a passcode before Hidden Photos can open.'
                : 'Enter your passcode to open Hidden Photos.'}
            </p>
            <form className="iclora-photos__hidden-auth-form" onSubmit={submitHiddenPhotosVerification}>
              <label>
                <span>Passcode</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  autoComplete="off"
                  name="hidden-photos-modal-passcode"
                  aria-label="Hidden Photos passcode"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  value={hiddenAuthModal.passcode}
                  onChange={(event) => setHiddenAuthModal((current) => ({ ...current, passcode: event.target.value.replace(/\D/g, '').slice(0, 12), error: '' }))}
                  placeholder="4+ digits"
                />
              </label>
              {hiddenAuthModal.mode === 'setup' ? (
                <label>
                  <span>Confirm</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    name="hidden-photos-modal-passcode-confirm"
                    aria-label="Confirm Hidden Photos passcode"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    value={hiddenAuthModal.confirmPasscode}
                    onChange={(event) => setHiddenAuthModal((current) => ({ ...current, confirmPasscode: event.target.value.replace(/\D/g, '').slice(0, 12), error: '' }))}
                    placeholder="Repeat passcode"
                  />
                </label>
              ) : null}
              {hiddenAuthModal.error ? <p className="iclora-photos__hidden-auth-error">{hiddenAuthModal.error}</p> : null}
              <div className="manage-account__delete-actions manage-account__delete-actions--single">
                <button type="button" className="manage-account__delete-button manage-account__delete-button--cancel" onClick={closeHiddenAuthModal}>
                  Cancel
                </button>
                <button type="submit" className="manage-account__delete-button cloud-app-setup-modal__activate" disabled={hiddenAuthBusy}>
                  {hiddenAuthBusy ? 'Checking...' : hiddenAuthModal.mode === 'setup' ? 'Set Up' : 'Verify'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {viewerPhase !== 'closed' && selectedPhoto ? (
        <section
          className={`iclora-photos__viewer is-${viewerPhase} ${selectedPhotoDirectOpen ? 'is-direct-open' : ''} ${viewerChromeHidden ? 'is-chrome-hidden' : ''}`}
          style={transitionStyle(transitionRect)}
          aria-label="Photo viewer"
          aria-modal="true"
          role="dialog"
        >
          <div className="iclora-photos__viewer-bg" onClick={toggleViewerChrome} role="presentation" />
          <header className="iclora-photos__viewer-globalbar">
            <div className="iclora-photos__viewer-brand" aria-label="iClora Photos">
              <div className="iclora-photos__library-empty-icon" aria-hidden="true">
                <picture>
                  <source srcSet="/apps/photos-dark.webp" media="(prefers-color-scheme: dark)" />
                  <img src="/apps/photos.webp" alt="" aria-hidden="true" />
                </picture>
              </div>
              <strong>iClora <span>Photos</span></strong>
            </div>
            <div className="iclora-photos__viewer-global-actions">
              <button type="button" aria-label="Create album"><FiPlusCircle /></button>
              <button type="button" aria-label="Open apps"><FiGrid /></button>
              <span className="iclora-photos__viewer-avatar" aria-hidden="true">
                {profile?.profilePhotoUrl ? <img src={profile.profilePhotoUrl} alt="" /> : profileInitial}
              </span>
            </div>
          </header>
          <header className="iclora-photos__viewer-bar">
            <div className="iclora-photos__viewer-left">
              <button type="button" className="iclora-photos__viewer-back" aria-label="Back to library" onClick={closeViewer}><FiChevronLeft /><span>Back</span></button>
              <button type="button" aria-label="Reset zoom" onClick={() => setViewerZoom(1)}><FiRefreshCcw /></button>
              <div className="iclora-photos__viewer-zoom">
                <FiMinus />
                <input min="0.75" max="3" step="0.25" type="range" value={viewerZoom} onChange={(event) => setViewerZoom(Number(event.target.value))} aria-label="Photo zoom" />
                <FiPlus />
              </div>
            </div>
            <div className="iclora-photos__viewer-title">
              {selectedPhotoProtected ? (
                <small>Your account was activated and iClora Photos is ready.</small>
              ) : null}
              <strong>{selectedPhotoDate.date || selectedPhoto.date}</strong>
              {selectedPhotoDate.time ? <em>{selectedPhotoDate.time}</em> : null}
              <span>{selectedIndex + 1} of {viewerPhotos.length}</span>
            </div>
            <div className="iclora-photos__viewer-actions">
              <button
                type="button"
                className="iclora-photos__viewer-info-button"
                aria-label="Photo info"
                aria-expanded={viewerInfoOpen && !viewerInfoClosing}
                onClick={openViewerInfo}
              >
                <FiInfo />
              </button>
              <button type="button" aria-label="Download photo" onClick={() => openDownloadModal()}><DownloadIcon size={22} /></button>
              {activeView === 'deleted' ? (
                <>
                  <button type="button" aria-label="Restore photo" className="iclora-photos__viewer-restore-button" onClick={() => openPhotoRestoreConfirm([selectedPhoto.id])}>
                    <FiRefreshCcw />
                    <span>Restore</span>
                  </button>
                  <button type="button" aria-label="Delete photo permanently" onClick={() => openPhotoPermanentDeleteConfirm([selectedPhoto.id])}>
                    <FiTrash2 />
                  </button>
                </>
              ) : (
                <>
                  {!selectedPhotoProtected ? (
                    <button type="button" aria-label="Share photo" onClick={() => sharePhoto()}><ShareIcon /></button>
                  ) : null}
                  <button
                    type="button"
                    aria-label="Favourite photo"
                    onClick={handleViewerFavouriteClick}
                    className={`iclora-photos__favourite-button ${selectedPhoto.favourite ? 'is-favourite' : ''}`}
                  >
                    {selectedPhoto.favourite ? <FaHeart /> : <FiHeart />}
                    {favouritePopKey > 0 ? (
                      <span key={favouritePopKey} className="iclora-photos__favourite-pop" aria-hidden="true">
                        <FaHeart />
                      </span>
                    ) : null}
                  </button>
                  <button type="button" aria-label="Delete photo" onClick={() => openPhotoDeleteConfirm([selectedPhoto.id])}><FiTrash2 /></button>
                  <button type="button" aria-label="More" aria-expanded={viewerActionsOpen} onClick={() => setViewerActionsOpen((open) => !open)}><FiMoreHorizontal /></button>
                </>
              )}
            </div>
          </header>

          {viewerActionsOpen && activeView !== 'deleted' ? (
            <div className="iclora-photos__viewer-menu" role="menu" aria-label={`${selectedPhoto.title} actions`}>
              <button type="button" role="menuitem" onClick={openViewerInfo}><FiInfo /><span>Info</span></button>
              <button
                type="button"
                role="menuitem"
                className={selectedPhoto.favourite ? 'is-favourite' : ''}
                onClick={() => { setViewerActionsOpen(false); toggleFavourite(); }}
              >
                {selectedPhoto.favourite ? <FaHeart /> : <FiHeart />}
                <span>Favourite</span>
              </button>
              <button type="button" role="menuitem" onClick={async () => { setViewerActionsOpen(false); await navigator.clipboard?.writeText(selectedPhoto.src); showAlert({ title: 'Photo copied', message: 'Private photo link copied.', type: 'success' }); }}><FiImage /><span>Copy Image</span></button>
              <button type="button" role="menuitem" onClick={() => { setViewerActionsOpen(false); openDownloadModal(); }}><DownloadIcon size={18} /><span>Download</span></button>
              <button type="button" role="menuitem" onClick={() => { setViewerActionsOpen(false); showDemoAction('More Download Options'); }}><DownloadIcon size={18} /><span>More Download Options...</span></button>
              {!selectedPhotoProtected ? (
                <button type="button" role="menuitem" onClick={() => { setViewerActionsOpen(false); sharePhoto(); }}><ShareIcon /><span>Share...</span></button>
              ) : null}
              <button type="button" role="menuitem" onClick={() => { setViewerActionsOpen(false); showDemoAction('Add to Album'); }}><FiFolder /><span>Add to Album...</span></button>
              <button type="button" role="menuitem" onClick={() => { setViewerActionsOpen(false); selectedPhoto.hidden ? openPhotoUnhideConfirm([selectedPhoto.id]) : hidePhotoWithVerification(selectedPhoto); }}>{selectedPhoto.hidden ? <FiEye /> : <FiEyeOff />}<span>{selectedPhoto.hidden ? 'Unhide' : 'Hide'}</span></button>
              <button type="button" role="menuitem" className="is-danger" onClick={() => { setViewerActionsOpen(false); openPhotoDeleteConfirm([selectedPhoto.id]); }}><FiTrash2 /><span>Delete</span></button>
            </div>
          ) : null}

          {viewerInfoMounted ? (
            <aside
              className={`iclora-photos__viewer-info-panel ${viewerInfoClosing ? 'is-closing' : 'is-open'}`}
              aria-label="Photo information"
              onClick={(event) => event.stopPropagation()}
            >
              <header>
                <span><FiInfo aria-hidden="true" /></span>
                <strong>Photo Info</strong>
                <button type="button" aria-label="Close photo info" onClick={() => closeViewerInfo()}><FiX /></button>
              </header>
              {selectedPhotoInfoRows.length ? (
                <dl>
                  {selectedPhotoInfoRows.map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p>No extra image info available.</p>
              )}
            </aside>
          ) : null}

          <button type="button" className="iclora-photos__viewer-arrow iclora-photos__viewer-arrow--left" aria-label="Previous photo" onClick={showPreviousPhoto}>
            <FiChevronLeft />
          </button>
          <button type="button" className="iclora-photos__viewer-arrow iclora-photos__viewer-arrow--right" aria-label="Next photo" onClick={showNextPhoto}>
            <FiChevronRight />
          </button>

          <div
            className="iclora-photos__stage"
            onClick={handleViewerStageClick}
            onPointerDown={beginViewerSwipe}
            onPointerMove={updateViewerSwipe}
            onPointerUp={endViewerSwipe}
            onPointerCancel={endViewerSwipe}
            role="presentation"
          >
            {viewerImageLoading ? <AppleLoader className="iclora-photos__photo-loader" size={44} /> : null}
            <img
              key={selectedPhoto.id}
              src={viewerDisplaySrc}
              alt={selectedPhoto.title}
              draggable={false}
              className={`${viewerImageLoading ? 'is-loading' : ''} ${viewerSlideDirection ? `is-slide-${viewerSlideDirection}` : ''}`}
              onLoad={() => setViewerImageLoading(false)}
              onError={() => setViewerImageLoading(false)}
              style={{ transform: `scale(${viewerZoom})` }}
            />
            {selectedPhotoVisionNotice ? (
              <div className="iclora-photos__vision-cycle-notice" role="status" aria-live="polite">
                {selectedPhotoVisionNotice}.
              </div>
            ) : null}
          </div>

          <div className="iclora-photos__filmstrip" aria-label="Photo thumbnails">
            {viewerPhotos.slice(0, 32).map((photo) => (
              <button
                type="button"
                key={photo.id}
                className={selectedPhoto.id === photo.id ? 'is-active' : ''}
                onClick={() => {
                  const nextIndex = viewerPhotos.findIndex((item) => item.id === photo.id);
                  const direction = nextIndex > selectedIndex ? 'next' : nextIndex < selectedIndex ? 'previous' : '';
                  showPhotoAt(nextIndex, direction);
                }}
                aria-label={`Show ${photo.title}`}
              >
                <img src={photo.thumbnailSrc || photo.src} alt="" draggable={false} />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {uploadModalOpen ? (
        <div className="manage-account__modal-layer" role="presentation">
          <section
            className="manage-account__name-modal iclora-photos__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="photos-upload-title"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" className="manage-account__modal-close" aria-label="Close upload" onClick={closeUploadModal}>
              <FiX />
            </button>
            <div className="manage-account__modal-icon iclora-photos__modal-icon" aria-hidden="true">
              <IoCloudUploadOutline />
            </div>
            <h2 id="photos-upload-title">Upload Photos</h2>
            <p className="manage-account__delete-copy">Choose up to {uploadBatchLimit} photos. JPEG, PNG, WebP, GIF, HEIC, and HEIF are supported.</p>
            <button
              type="button"
              className={`iclora-photos__upload-drop ${uploadDragActive ? 'is-dragging' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setUploadDragActive(true);
              }}
              onDragLeave={() => setUploadDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setUploadDragActive(false);
                stageUploadFiles(event.dataTransfer.files);
              }}
            >
              <div className="iclora-photos__upload-visual" aria-hidden="true">
                <picture>
                  <source srcSet="/apps/photos-dark.webp" media="(prefers-color-scheme: dark)" />
                  <img src="/apps/photos.webp" alt="" aria-hidden="true" className="iclora-photos__upload-logo iclora-photos__upload-logo--small" draggable={false} />
                </picture>
              </div>
              <span>{uploadDraftFiles.length ? `${uploadDraftFiles.length} selected` : 'Choose photos'}</span>
            </button>
            {uploadDraftFiles.length ? (
              <div className="iclora-photos__upload-selected" aria-label="Selected uploads">
                {uploadDraftFiles.map((file, index) => (
                  <div className="iclora-photos__upload-card" key={`${file.name}-${file.size}-${index}`}>
                    <img className="iclora-photos__upload-preview" src={getUploadPreviewUrl(file)} alt="" draggable={false} onClick={() => setUploadPreviewModalFile(file)} />
                    <button
                      type="button"
                      className="iclora-photos__upload-remove"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => setUploadDraftFiles((files) => files.filter((_, fileIndex) => fileIndex !== index))}
                    >
                      <FiX />
                    </button>
                    <span className="iclora-photos__upload-filename" title={file.name}>{file.name}</span>
                  </div>
                ))}
                {uploadDraftFiles.length < uploadBatchLimit ? (
                  <button type="button" className="iclora-photos__upload-add" onClick={() => fileInputRef.current?.click()} aria-label="Add more photos">
                    <FiPlus />
                    <span>Add</span>
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="manage-account__delete-actions">
              <button type="button" className="manage-account__delete-button manage-account__delete-button--cancel" onClick={closeUploadModal}>Cancel</button>
              <button type="button" className="manage-account__delete-button cloud-app-setup-modal__activate" onClick={startCachedUpload} disabled={!uploadDraftFiles.length}>
                Upload
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {uploadPreviewModalFile ? (
        <div className="manage-account__modal-layer" style={{ zIndex: 30000, background: 'rgba(0, 0, 0, 0.85)', backdropFilter: 'blur(8px)' }} role="presentation" onClick={() => setUploadPreviewModalFile(null)}>
          <img src={getUploadPreviewUrl(uploadPreviewModalFile)} alt="" style={{ maxWidth: '94%', maxHeight: '94%', objectFit: 'contain', borderRadius: '8px', boxShadow: '0 12px 42px rgba(0,0,0,0.4)' }} onClick={(e) => e.stopPropagation()} />
          <button type="button" className="iclora-photos__viewer-back" aria-label="Close preview" style={{ position: 'absolute', top: '24px', left: '24px', background: 'rgba(255,255,255,0.18)', color: '#fff', border: 'none', borderRadius: '50%', width: '42px', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backdropFilter: 'blur(10px)' }} onClick={() => setUploadPreviewModalFile(null)}>
            <FiX size={24} />
          </button>
        </div>
      ) : null}

      {shareModalPhoto ? (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={() => setShareModalPhoto(null)}>
          <section className="manage-account__name-modal iclora-photos__modal iclora-photos__share-sheet" role="dialog" aria-modal="true" aria-labelledby="photos-share-title" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="manage-account__modal-close" aria-label="Close share" onClick={() => setShareModalPhoto(null)}>
              <FiX />
            </button>
            <h2 id="photos-share-title">Share iClora Link</h2>
            <div className="iclora-photos__share-sheet-preview" aria-hidden="true">
              <img src={shareModalPhoto.src || shareModalPhoto.thumbnailSrc} alt="" draggable={false} />
              <strong>1 Item</strong>
            </div>
            <div className="iclora-photos__share-sheet-identity">
              <h3>Share As</h3>
              <p>
                <span>{displayName}</span>
                {profile?.email ? ` (${profile.email})` : ''}
              </p>
            </div>
            <p className="iclora-photos__share-sheet-note">
              Anyone with access to the link will be able to view your photos
            </p>
            <div className="manage-account__delete-actions">
              <button type="button" className="manage-account__delete-button cloud-app-setup-modal__activate" onClick={() => openSecureLinkDuration()}>
                Create Link
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {shareDurationModalPhoto ? (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={() => setShareDurationModalPhoto(null)}>
          <section className="manage-account__name-modal iclora-photos__modal" role="dialog" aria-modal="true" aria-labelledby="photos-duration-title" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="manage-account__modal-close" aria-label="Close secure link duration" onClick={() => setShareDurationModalPhoto(null)}>
              <FiX />
            </button>
            <div className="manage-account__modal-icon iclora-photos__modal-icon" aria-hidden="true">
              <FiClock />
            </div>
            <h2 id="photos-duration-title">Link Duration</h2>
            <p className="manage-account__delete-copy">
              Choose how long this iClora secure link should stay active for {Array.isArray(shareDurationModalPhoto) ? `${shareDurationModalPhoto.length} photos` : 'this photo'}.
            </p>
            <div className="iclora-photos__duration-grid">
              {[1, 6, 24, 72].map((hours) => (
                <button type="button" key={hours} onClick={() => generateSecureLink(hours)}>
                  {hours === 1 ? '1 hour' : `${hours} hours`}
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {shareLinkResult ? (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={() => setShareLinkResult(null)}>
          <section className="manage-account__name-modal iclora-photos__modal iclora-photos__link-result" role="dialog" aria-modal="true" aria-labelledby="photos-link-ready-title" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="manage-account__modal-close" aria-label="Close generated link" onClick={() => setShareLinkResult(null)}>
              <FiX />
            </button>
            <div className="manage-account__modal-icon iclora-photos__modal-icon" aria-hidden="true">
              <FiCloud />
            </div>
            <h2 id="photos-link-ready-title">iClora Link Ready</h2>
            <p className="manage-account__delete-copy">This link expires {new Date(shareLinkResult.expiresAt).toLocaleString()}.</p>
            <div className="iclora-photos__generated-link">{shareLinkResult.url}</div>
            <div className="manage-account__delete-actions">
              <button type="button" className="manage-account__delete-button manage-account__delete-button--cancel" onClick={() => copySecureLink()}>Copy</button>
              <button type="button" className="manage-account__delete-button cloud-app-setup-modal__activate" onClick={() => nativeShareSecureLink()}>
                <ShareIcon />
                <span>Share</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {downloadModalPhoto ? (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={() => { if (!downloadPending) setDownloadModalPhoto(null); }}>
          <section
            className="manage-account__name-modal iclora-photos__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="photos-download-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="manage-account__modal-close"
              aria-label="Close download panel"
              onClick={() => setDownloadModalPhoto(null)}
              disabled={downloadPending}
            >
              <FiX />
            </button>
            <div className="manage-account__modal-icon iclora-photos__modal-icon" aria-hidden="true">
              <DownloadIcon size={34} />
            </div>
            <h2 id="photos-download-title">Download Photo</h2>
            <p className="manage-account__delete-copy">Choose what to name this image before it downloads.</p>
            <label className="manage-account__name-field manage-account__name-field--single">
              <input
                type="text"
                value={downloadFileName}
                maxLength={80}
                placeholder="iclora-photo"
                autoFocus
                onChange={(event) => setDownloadFileName(event.target.value)}
              />
            </label>
            <div className="manage-account__delete-actions">
              <button
                type="button"
                className="manage-account__delete-button manage-account__delete-button--cancel"
                onClick={() => setDownloadModalPhoto(null)}
                disabled={downloadPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="manage-account__delete-button cloud-app-setup-modal__activate"
                onClick={confirmPhotoDownload}
                disabled={downloadPending}
              >
                {downloadPending ? 'Preparing...' : 'Download'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {photoDeleteTarget ? (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={() => setPhotoDeleteTarget(null)}>
          <section
            className="manage-account__name-modal manage-account__delete-modal iclora-photos__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="photos-delete-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button type="button" className="manage-account__modal-close" aria-label="Close delete photo confirmation" onClick={() => setPhotoDeleteTarget(null)}>
              <FiX />
            </button>
            <div className="manage-account__delete-icon iclora-photos__delete-icon" aria-hidden="true">
              <FiTrash2 />
            </div>
            <h2 id="photos-delete-title">{photoDeleteTarget.count === 1 ? 'Delete photo?' : 'Delete photos?'}</h2>
            <p className="manage-account__delete-copy">
              {photoDeleteTarget.count === 1
                ? `${photoDeleteTarget.title} will be removed from this library.`
                : `${photoDeleteTarget.count} photos will be removed from this library.`}
            </p>
            <div className="manage-account__delete-actions manage-account__delete-actions--single">
              <button type="button" className="manage-account__delete-button manage-account__delete-button--cancel" onClick={() => setPhotoDeleteTarget(null)}>
                Cancel
              </button>
              <button type="button" className="manage-account__delete-button manage-account__delete-button--danger" onClick={confirmPhotoDelete}>
                <FiTrash2 aria-hidden="true" />
                <span>Delete</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {photoPermanentDeleteTarget ? (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={() => setPhotoPermanentDeleteTarget(null)}>
          <section
            className="manage-account__name-modal manage-account__delete-modal iclora-photos__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="photos-permanent-delete-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button type="button" className="manage-account__modal-close" aria-label="Close permanently delete photo confirmation" onClick={() => setPhotoPermanentDeleteTarget(null)}>
              <FiX />
            </button>
            <div className="manage-account__delete-icon iclora-photos__delete-icon" aria-hidden="true">
              <FiTrash2 />
            </div>
            <h2 id="photos-permanent-delete-title">Are you sure?</h2>
            <p className="manage-account__delete-copy">
              {photoPermanentDeleteTarget.count === 1
                ? `${photoPermanentDeleteTarget.title} will be permanently removed and cannot be restored.`
                : `${photoPermanentDeleteTarget.count} photos will be permanently removed and cannot be restored.`}
            </p>
            <div className="manage-account__delete-actions manage-account__delete-actions--single">
              <button type="button" className="manage-account__delete-button manage-account__delete-button--cancel" onClick={() => setPhotoPermanentDeleteTarget(null)}>
                Cancel
              </button>
              <button type="button" className="manage-account__delete-button manage-account__delete-button--danger" onClick={confirmPhotoPermanentDelete}>
                <FiTrash2 aria-hidden="true" />
                <span>Yes, Delete Permanently</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {photoRestoreTarget ? (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={() => setPhotoRestoreTarget(null)}>
          <section
            className="manage-account__name-modal iclora-photos__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="photos-restore-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button type="button" className="manage-account__modal-close" aria-label="Close restore photo confirmation" onClick={() => setPhotoRestoreTarget(null)}>
              <FiX />
            </button>
            <div className="manage-account__modal-icon iclora-photos__modal-icon" aria-hidden="true">
              <FiRefreshCcw />
            </div>
            <h2 id="photos-restore-title">{photoRestoreTarget.count === 1 ? 'Restore photo?' : 'Restore photos?'}</h2>
            <p className="manage-account__delete-copy">
              {photoRestoreTarget.count === 1
                ? `${photoRestoreTarget.title} will return to your Library immediately.`
                : `${photoRestoreTarget.count} photos will return to your Library immediately.`}
            </p>
            <div className="manage-account__delete-actions manage-account__delete-actions--single">
              <button type="button" className="manage-account__delete-button manage-account__delete-button--cancel" onClick={() => setPhotoRestoreTarget(null)}>
                Cancel
              </button>
              <button type="button" className="manage-account__delete-button cloud-app-setup-modal__activate" onClick={confirmPhotoRestore}>
                <FiRefreshCcw aria-hidden="true" />
                <span>Restore</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {photoUnhideTarget ? (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={() => setPhotoUnhideTarget(null)}>
          <section
            className="manage-account__name-modal iclora-photos__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="photos-unhide-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button type="button" className="manage-account__modal-close" aria-label="Close unhide photo confirmation" onClick={() => setPhotoUnhideTarget(null)}>
              <FiX />
            </button>
            <div className="manage-account__modal-icon iclora-photos__modal-icon" aria-hidden="true">
              <FiEye />
            </div>
            <h2 id="photos-unhide-title">{photoUnhideTarget.count === 1 ? 'Unhide photo?' : 'Unhide photos?'}</h2>
            <p className="manage-account__delete-copy">
              {photoUnhideTarget.count === 1
                ? `${photoUnhideTarget.title} will appear in your Library again.`
                : `${photoUnhideTarget.count} photos will appear in your Library again.`}
            </p>
            <div className="manage-account__delete-actions manage-account__delete-actions--single">
              <button type="button" className="manage-account__delete-button manage-account__delete-button--cancel" onClick={() => setPhotoUnhideTarget(null)}>
                Cancel
              </button>
              <button type="button" className="manage-account__delete-button cloud-app-setup-modal__activate" onClick={confirmPhotoUnhide}>
                <FiEye aria-hidden="true" />
                <span>Unhide</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {linkDeleteTarget ? (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={() => { if (!linkDeleting) setLinkDeleteTarget(null); }}>
          <section className="manage-account__name-modal iclora-photos__modal" role="dialog" aria-modal="true" aria-labelledby="photos-delete-link-title" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="manage-account__modal-close" aria-label="Close delete link confirmation" onClick={() => setLinkDeleteTarget(null)} disabled={linkDeleting}>
              <FiX />
            </button>
            <div className="manage-account__modal-icon iclora-photos__modal-icon iclora-photos__modal-icon--danger" aria-hidden="true">
              <FiTrash2 />
            </div>
            <h2 id="photos-delete-link-title">Delete iClora Link?</h2>
            <p className="manage-account__delete-copy">Anyone with this link will lose access to {linkDeleteTarget.photoTitle}.</p>
            <div className="manage-account__delete-actions">
              <button type="button" className="manage-account__delete-button manage-account__delete-button--cancel" onClick={() => setLinkDeleteTarget(null)} disabled={linkDeleting}>Cancel</button>
              <button type="button" className="manage-account__delete-button manage-account__delete-button--danger" onClick={confirmDeleteSecureLink} disabled={linkDeleting}>
                {linkDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
