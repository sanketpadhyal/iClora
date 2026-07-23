import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FiEdit3, FiKey, FiX } from 'react-icons/fi';
import { doc, onSnapshot } from 'firebase/firestore';
import { useLocation, useNavigate } from 'react-router-dom';
import { useImageProtection } from '../components/utils/Imageprotector';
import {
  clearLoginData,
  clearProfilePhotoCompletion,
  isProfilePhotoCompletionActive,
  readSessionToken,
  writeAuthCache,
} from '../auth/authCache';
import { clearSignedOutData } from '../auth/sessionCleanup';
import DashboardNavbar from './dashboardnavbar';
import { readUserProfileCache, writeUserProfileCache } from './userProfileCache';
import { readAccentColorCache, writeAccentColorCache } from './themeCache';
import { apiFetch, isStaleSessionResponse } from '../api/backendapi';
import { getFirebaseDb } from '../auth/firebase';
import { useAlert } from '../alert/alert';
import AppleLoader from '../components/AppleLoader';
import './dashboard.css';

const BACKGROUND_COLORS = [
  { name: 'Blue', value: '#2f7be6' },
  { name: 'Violet', value: '#a250d8' },
  { name: 'Green', value: '#46a935' },
  { name: 'Red', value: '#db2f24' },
  { name: 'Orange', value: '#f59a2f' },
  { name: 'Yellow', value: '#f5cb3d' },
];

const APP_STORAGE_BREAKDOWN = [
  { key: 'photos', label: 'Photos', color: '#ff2f92', icon: '/apps/photos.webp', iconDark: '/apps/photos-dark.webp' },
  { key: 'notes', label: 'Notes', color: '#f5c542', icon: '/apps/notes.webp', iconDark: '/apps/notes-dark.webp' },
  { key: 'contacts', label: 'Contacts', color: '#2f7be6', icon: '/apps/contacts.webp', iconDark: '/apps/contacts-dark.webp' },
];

const DASHBOARD_NOTES_CACHE_KEY = 'iclora_notes_dashboard_preview_v1';
const DASHBOARD_CONTACTS_CACHE_KEY = 'iclora_contacts_dashboard_preview_v1';
const NOTES_CACHE_KEY = 'iclora_notes_cache_v1';
const CONTACTS_CACHE_KEY = 'iclora_contacts_cache_v1';
const PHOTOS_CACHE_KEY = 'iclora_photos_cache_v1';
const DASHBOARD_NOTES_PREVIEW_LIMIT = 6;
const DASHBOARD_CONTACTS_PREVIEW_LIMIT = 5;
const DEFAULT_DASHBOARD_PHOTO = {
  id: 'iclora-default-photo',
  title: 'Welcome to iClora',
  thumbnailSrc: '/logo.webp',
  src: '/logo.webp',
  system: true,
  locked: true,
};

function shouldUseLiteDashboard() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (isIOS) return false;

  const deviceMemory = typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : undefined;
  const hardwareConcurrency = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : undefined;
  const saveData = Boolean(navigator.connection?.saveData);
  const reducedMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  return (
    reducedMotion ||
    saveData ||
    (typeof deviceMemory === 'number' && deviceMemory <= 2) ||
    (typeof hardwareConcurrency === 'number' && hardwareConcurrency <= 4)
  );
}

function previewSignature(items, fallbackKey = 'id') {
  return (Array.isArray(items) ? items : [])
    .map((item) => item?.id || item?.[fallbackKey] || item?.displayName || '')
    .join('|');
}

function areStorageBreakdownsEqual(previousBreakdown, nextBreakdown) {
  const previous = normalizeStorageBreakdown(previousBreakdown);
  const next = normalizeStorageBreakdown(nextBreakdown);
  return previous.every((item, index) => (
    item.key === next[index]?.key &&
    item.active === next[index]?.active &&
    item.storageUsed === next[index]?.storageUsed
  ));
}

function normalizeStorageBreakdown(value) {
  const input = Array.isArray(value) ? value : [];
  return APP_STORAGE_BREAKDOWN.map((app) => {
    const found = input.find((item) => item?.key === app.key) || {};
    const storageUsed = typeof found.storageUsed === 'number' && Number.isFinite(found.storageUsed)
      ? Math.max(0, found.storageUsed)
      : 0;
    return { ...app, active: found.active === true, storageUsed };
  });
}

function formatStorageValue(mb, options = {}) {
  const amount = typeof mb === 'number' && Number.isFinite(mb) ? Math.max(0, mb) : 0;
  if (amount < 1 && amount > 0) return `${Math.max(1, Math.round(amount * 1024))} KB`;
  if (amount >= 1024) {
    const gb = amount / 1024;
    const fractionDigits = options.compact ? 1 : 2;
    return `${gb.toFixed(fractionDigits).replace(/\.0+$/, '')} GB`;
  }
  return `${Math.round(amount)} MB`;
}

function readDashboardNotesPreviewCache() {
  if (typeof window === 'undefined') return [];
  try {
    const dashboardCache = JSON.parse(window.localStorage.getItem(DASHBOARD_NOTES_CACHE_KEY) || 'null');
    const notesCache = JSON.parse(window.localStorage.getItem(NOTES_CACHE_KEY) || 'null');
    const dashboardNotes = Array.isArray(dashboardCache?.notes) ? dashboardCache.notes : [];
    const liveNotes = Array.isArray(notesCache?.notes) ? notesCache.notes : [];
    const livePreview = liveNotes
      .slice()
      .sort((a, b) => {
        const bTime = Date.parse(b?.updatedAt || b?.createdAt || '') || 0;
        const aTime = Date.parse(a?.updatedAt || a?.createdAt || '') || 0;
        return bTime - aTime;
      })
      .slice(0, DASHBOARD_NOTES_PREVIEW_LIMIT)
      .map((note) => ({
        id: note.id,
        type: 'note',
        title: note.title || 'Untitled',
        folderId: note.folderId || 'all-notes',
        pinned: Boolean(note.pinned),
        locked: Boolean(note.locked),
        system: Boolean(note.system),
        createdAt: note.createdAt || '',
        updatedAt: note.updatedAt || note.createdAt || '',
      }));
    const dashboardTime = Number(dashboardCache?.cachedAt || 0);
    const liveTime = Number(notesCache?.cachedAt || 0);
    return livePreview.length && liveTime >= dashboardTime ? livePreview : dashboardNotes;
  } catch {
    return [];
  }
}

function writeDashboardNotesPreviewCache(notes) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DASHBOARD_NOTES_CACHE_KEY, JSON.stringify({
      notes: Array.isArray(notes) ? notes : [],
      cachedAt: Date.now(),
    }));
  } catch {

  }
}

function normalizeDashboardContact(contact) {
  const displayName = String(contact?.displayName || '').trim();
  const joined = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ').trim();
  return {
    id: contact?.id || '',
    displayName: displayName || joined || contact?.company || 'New Contact',
    phone: contact?.phone || '',
    email: contact?.email || '',
    photoUrl: contact?.photoUrl || '',
    updatedAt: contact?.updatedAt || contact?.createdAt || '',
    createdAt: contact?.createdAt || '',
  };
}

function readDashboardContactsPreviewCache() {
  if (typeof window === 'undefined') return [];
  try {
    const dashboardCache = JSON.parse(window.localStorage.getItem(DASHBOARD_CONTACTS_CACHE_KEY) || 'null');
    const contactsCache = JSON.parse(window.localStorage.getItem(CONTACTS_CACHE_KEY) || 'null');
    const dashboardContacts = Array.isArray(dashboardCache?.contacts) ? dashboardCache.contacts : [];
    const liveContacts = Array.isArray(contactsCache?.contacts) ? contactsCache.contacts : [];
    const dashboardPreview = dashboardContacts
      .map(normalizeDashboardContact)
      .filter((contact) => contact.id || contact.displayName)
      .slice(0, DASHBOARD_CONTACTS_PREVIEW_LIMIT);
    const livePreview = liveContacts
      .map(normalizeDashboardContact)
      .filter((contact) => contact.id || contact.displayName)
      .slice(0, DASHBOARD_CONTACTS_PREVIEW_LIMIT);
    const dashboardTime = Number(dashboardCache?.cachedAt || 0);
    const liveTime = Number(contactsCache?.cachedAt || 0);
    return livePreview.length && liveTime >= dashboardTime ? livePreview : dashboardPreview;
  } catch {
    return [];
  }
}

function writeDashboardContactsPreviewCache(contacts) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DASHBOARD_CONTACTS_CACHE_KEY, JSON.stringify({
      contacts: Array.isArray(contacts) ? contacts.slice(0, DASHBOARD_CONTACTS_PREVIEW_LIMIT) : [],
      cachedAt: Date.now(),
    }));
  } catch {

  }
}

function normalizeDashboardPhoto(photo) {
  const id = String(photo?.id || '').trim();
  const src = photo?.thumbnailSrc || photo?.src || photo?.staticSrc || photo?.originalUrl || '';
  if (!id || !src) return null;
  return {
    id,
    title: photo?.title || photo?.originalFilename || 'iClora Photo',
    thumbnailSrc: src,
    src,
    system: Boolean(photo?.system),
    locked: Boolean(photo?.locked),
    uploadedAt: photo?.uploadedAt || photo?.createdAt || '',
  };
}

function readDashboardPhotosPreviewCache() {
  if (typeof window === 'undefined') return [DEFAULT_DASHBOARD_PHOTO];
  try {
    const photosCache = JSON.parse(window.localStorage.getItem(PHOTOS_CACHE_KEY) || 'null');
    const photos = Array.isArray(photosCache?.photos) ? photosCache.photos : [];
    const normalized = photos.map(normalizeDashboardPhoto).filter(Boolean);
    return (normalized.length ? normalized : [DEFAULT_DASHBOARD_PHOTO]).slice(0, 4);
  } catch {
    return [DEFAULT_DASHBOARD_PHOTO];
  }
}

function contactInitials(contact) {
  return String(contact?.displayName || 'C')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'C';
}

function formatNoteDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(date);
}

function DashboardLoadingState() {
  return (
    <main className="cloud-shell cloud-shell--loading" aria-label="Loading dashboard">
      <section className="cloud-fetch" role="status" aria-live="polite" aria-label="Loading dashboard">
        <AppleLoader className="cloud-fetch__loader" size={34} />
      </section>
    </main>
  );
}

function AppPanelLoader({ label }) {
  return (
    <div className="cloud-app-loader" role="status" aria-live="polite">
      <AppleLoader className="cloud-app-loader__spinner" size={54} />
      <span className="cloud-app-loader__title">Syncing {label}</span>
      <span className="cloud-app-loader__copy">Checking your cloud status securely.</span>
    </div>
  );
}

function pickProfileString(nextValue, fallbackValue = '') {
  if (typeof nextValue === 'string' && nextValue.trim()) return nextValue;
  if (typeof fallbackValue === 'string') return fallbackValue;
  return '';
}

function splitNameAndTrailingEmoji(value) {
  const text = String(value || '').trim();
  if (!text) return { nameText: '', emojiText: '' };
  const match = text.match(/^(.*?)([\p{Extended_Pictographic}\uFE0F]+)$/u);
  if (!match) return { nameText: text, emojiText: '' };
  const nameText = match[1].trimEnd();
  const emojiText = match[2];
  if (!nameText) return { nameText: text, emojiText: '' };
  return { nameText, emojiText };
}

export default function CloudDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showAlert } = useAlert();
  const imgProtection = useImageProtection();
  const initialCachedProfile = readSessionToken() ? readUserProfileCache() : null;
  const routeFreshLogin = Boolean(location.state?.freshLogin);
  const routeFreshLoginId = typeof location.state?.freshLoginId === 'string' ? location.state.freshLoginId : '';
  const freshLoginStorageKey = routeFreshLoginId ? `iclora:fresh-login:${routeFreshLoginId}` : '';
  const freshLoginConsumed = freshLoginStorageKey && typeof window !== 'undefined'
    ? window.sessionStorage.getItem(freshLoginStorageKey) === '1'
    : false;
  const shouldShowFreshLoginLoader = routeFreshLogin && !freshLoginConsumed;
  const initialNotesPreview = useMemo(() => readDashboardNotesPreviewCache(), []);
  const initialContactsPreview = useMemo(() => readDashboardContactsPreviewCache(), []);
  const initialPhotosPreview = useMemo(() => readDashboardPhotosPreviewCache(), []);
  const [status, setStatus] = useState(shouldShowFreshLoginLoader || !initialCachedProfile ? 'loading' : 'ready');
  const [user, setUser] = useState(initialCachedProfile);
  const [dashboardNotes, setDashboardNotes] = useState(initialNotesPreview);
  const [dashboardNotesLoading, setDashboardNotesLoading] = useState(!initialNotesPreview.length);
  const [dashboardContacts, setDashboardContacts] = useState(initialContactsPreview);
  const [dashboardContactsLoading, setDashboardContactsLoading] = useState(!initialContactsPreview.length);
  const [dashboardPhotos, setDashboardPhotos] = useState(initialPhotosPreview);
  const [dashboardPhotosLoading, setDashboardPhotosLoading] = useState(false);
  const dashboardPhotosLengthRef = useRef(dashboardPhotos.length);
  const dashboardNotesLengthRef = useRef(dashboardNotes.length);
  const dashboardContactsLengthRef = useRef(dashboardContacts.length);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [setupApp, setSetupApp] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);
  const [storageUpdating, setStorageUpdating] = useState(false);
  const [isStorageFetching, setIsStorageFetching] = useState(true);

  useEffect(() => {
    if (!routeFreshLogin) return;
    if (freshLoginStorageKey && typeof window !== 'undefined') {
      window.sessionStorage.setItem(freshLoginStorageKey, '1');
    }
    const nextState = { ...(location.state || {}) };
    delete nextState.freshLogin;
    delete nextState.freshLoginId;
    navigate(location.pathname, { replace: true, state: nextState });
  }, [freshLoginStorageKey, location.pathname, location.state, navigate, routeFreshLogin]);
  const [storageDetailsOpen, setStorageDetailsOpen] = useState(false);
  const [storageDetailsClosing, setStorageDetailsClosing] = useState(false);
  const [storageDetailsLoading, setStorageDetailsLoading] = useState(false);
  const [storageDetailsError, setStorageDetailsError] = useState('');
  const [entranceMotionMode, setEntranceMotionMode] = useState('');
  const [liteDashboard] = useState(() => shouldUseLiteDashboard());
  const [backgroundColor, setBackgroundColor] = useState(() => readAccentColorCache() || '#46a935');
  const routeProfilePhotoCompleted = Boolean(location.state?.profilePhotoCompleted);
  const storageAnimationTimerRef = React.useRef(null);
  const storageDetailsCloseTimerRef = React.useRef(null);
  const previousStorageLabelRef = React.useRef('');

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    if (liteDashboard) return undefined;
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return undefined;

    const frame = window.requestAnimationFrame(() => {
      setEntranceMotionMode('full');
    });

    return () => window.cancelAnimationFrame(frame);
  }, [liteDashboard]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    document.body.classList.toggle('cloud-performance-lite', liteDashboard);
    return () => {
      document.body.classList.remove('cloud-performance-lite');
    };
  }, [liteDashboard]);

  useEffect(() => {
    let cancelled = false;

    const cachedAccent = readAccentColorCache();

    const cachedProfile = readUserProfileCache();
    const profilePhotoCompleted =
      routeProfilePhotoCompleted ||
      isProfilePhotoCompletionActive();
    if (cachedProfile && readSessionToken()) {
      setUser(cachedProfile);
    }

    setIsStorageFetching(true);
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
        if (cancelled) return;
        if (!json?.ok) {
          clearLoginData();
          navigate('/auth', { replace: true, state: { from: location.pathname } });
          return;
        }
        const serverAccent = typeof json?.dashboardAccentColor === 'string' ? json.dashboardAccentColor : '';
        if (serverAccent && serverAccent !== cachedAccent) {
          setBackgroundColor(serverAccent);
          writeAccentColorCache(serverAccent);
        }

        const hasProfilePhoto = Boolean(json?.profilePhotoUrl);
        const serverNeedsProfilePhoto = Boolean(json?.needsProfilePhoto) && !hasProfilePhoto;
        if (serverNeedsProfilePhoto) {
          if (profilePhotoCompleted) {
            const completedProfile = {
              uid: json?.uid || cachedProfile?.uid || '',
              name: json?.name || cachedProfile?.name || '',
              email: json?.email || cachedProfile?.email || '',
              provider: json?.provider || cachedProfile?.provider || '',
              createdAt: json?.createdAt || cachedProfile?.createdAt || '',
              lastLoginBy: json?.lastLoginBy || cachedProfile?.lastLoginBy || '',
              lastLoginAt: json?.lastLoginAt || cachedProfile?.lastLoginAt || '',
              profilePhotoUrl: json?.profilePhotoUrl || cachedProfile?.profilePhotoUrl || '',
              plan: json?.plan || 'basic',
              storage: typeof json?.storage === 'number' ? json.storage : 1024,
              storageused: typeof json?.storageused === 'number' ? json.storageused : 0,
              storageBreakdown: normalizeStorageBreakdown(json?.storageBreakdown),
            };

            writeAuthCache({ ok: true, needsProfilePhoto: false });
            writeUserProfileCache(completedProfile);
            setUser(completedProfile);
            setStatus('ready');
            return;
          }

          writeAuthCache({ ok: true, needsProfilePhoto: true });
          navigate('/profile-photo', { replace: true });
          return;
        }

        writeAuthCache({ ok: true, needsProfilePhoto: false });
        const nextUser = {
          uid: pickProfileString(json?.uid, cachedProfile?.uid),
          name: pickProfileString(json?.name, cachedProfile?.name),
          email: pickProfileString(json?.email, cachedProfile?.email),
          provider: pickProfileString(json?.provider, cachedProfile?.provider),
          createdAt: pickProfileString(json?.createdAt, cachedProfile?.createdAt),
          lastLoginBy: pickProfileString(json?.lastLoginBy, cachedProfile?.lastLoginBy),
          lastLoginAt: pickProfileString(json?.lastLoginAt, cachedProfile?.lastLoginAt),
          profilePhotoUrl: pickProfileString(json?.profilePhotoUrl, cachedProfile?.profilePhotoUrl),
          plan: json?.plan || 'basic',
          storage: typeof json?.storage === 'number' ? json.storage : 1024,
          storageused: typeof json?.storageused === 'number' ? json.storageused : 0,
          storageBreakdown: normalizeStorageBreakdown(json?.storageBreakdown),
        };
        writeUserProfileCache(nextUser);
        clearProfilePhotoCompletion();
        setUser(nextUser);
        setStatus('ready');
      })
      .catch(async (error) => {
        if (!cancelled) {
          if (error?.code === 'STALE_SESSION_RESPONSE') return;
          if (error?.code !== 'UNAUTHORIZED' && profilePhotoCompleted && cachedProfile) {
            writeAuthCache({ ok: true, needsProfilePhoto: false });
            setUser(cachedProfile);
            setStatus('ready');
            return;
          }
          if (error?.code !== 'UNAUTHORIZED' && cachedProfile && readSessionToken()) {
            setUser(cachedProfile);
            setStatus('ready');
            return;
          }
          if (error?.code === 'UNAUTHORIZED') {
            await clearSignedOutData();
            showAlert({
              title: 'Session expired',
              message: 'Please sign in again.',
              type: 'info',
              duration: 3200,
            });
          } else {
            clearLoginData();
          }
          navigate('/auth', { replace: true, state: { from: location.pathname } });
        }
      })
      .finally(() => {
        if (!cancelled) setIsStorageFetching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [location.pathname, navigate, routeProfilePhotoCompleted, showAlert]);

  useEffect(() => {
    if (status !== 'ready') return undefined;
    const uid = typeof user?.uid === 'string' ? user.uid.trim() : '';
    if (!uid) return undefined;

    let unsub = null;
    try {
      const db = getFirebaseDb();
      unsub = onSnapshot(
        doc(db, 'users', uid),
        (snapshot) => {
          if (!snapshot.exists()) return;
          const live = snapshot.data() || {};
          const profilePhotoUrl = live?.profilePhoto?.url || live?.picture || '';

          setUser((prev) => {
            const previous = prev || {};
            const next = {
              uid,
              name: typeof live?.name === 'string' ? live.name : previous.name || '',
              email: typeof live?.email === 'string' ? live.email : previous.email || '',
              profilePhotoUrl: typeof profilePhotoUrl === 'string' ? profilePhotoUrl : previous.profilePhotoUrl || '',
              plan: typeof live?.plan === 'string' && live.plan ? live.plan : previous.plan || 'basic',
              storage: typeof live?.storage === 'number' && Number.isFinite(live.storage) ? live.storage : (previous.storage || 1024),
              storageused: typeof previous.storageused === 'number' && Number.isFinite(previous.storageused) ? previous.storageused : 0,
              storageBreakdown: normalizeStorageBreakdown(previous.storageBreakdown),
            };
            if (
              previous.uid === next.uid &&
              previous.name === next.name &&
              previous.email === next.email &&
              previous.profilePhotoUrl === next.profilePhotoUrl &&
              previous.plan === next.plan &&
              previous.storage === next.storage &&
              previous.storageused === next.storageused &&
              areStorageBreakdownsEqual(previous.storageBreakdown, next.storageBreakdown)
            ) {
              return prev;
            }
            writeUserProfileCache(next);
            return next;
          });

          const liveAccent = typeof live?.ui?.dashboardAccentColor === 'string' ? live.ui.dashboardAccentColor : '';
          if (liveAccent) {
            setBackgroundColor((prev) => (prev === liveAccent ? prev : liveAccent));
            writeAccentColorCache(liveAccent);
          }
        },
        () => {

        }
      );
    } catch {

    }

    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [status, user?.uid]);

  useEffect(() => {
    if (status !== 'ready') return undefined;
    const uid = typeof user?.uid === 'string' ? user.uid.trim() : '';
    if (!uid) return undefined;

    apiFetch('/cloud-apps/normalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {

    });

    return undefined;
  }, [status, user?.uid]);

  useEffect(() => {
    writeAccentColorCache(backgroundColor);
  }, [backgroundColor]);

  const displayName = useMemo(() => (user?.name || user?.email || 'User').trim(), [user]);
  const profileName = useMemo(() => {
    const raw = (user?.name || '').trim();
    const source = raw || (user?.email || '').split('@')[0] || 'User';
    return source
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  }, [user?.email, user?.name]);
  const profileNameParts = useMemo(() => splitNameAndTrailingEmoji(profileName), [profileName]);
  const firstName = profileName.split(' ')[0] || 'User';
  const initials = firstName.charAt(0).toUpperCase();
  const storageLabel = useMemo(() => {
    const amount = typeof user?.storage === 'number' ? user.storage : 1024;
    if (amount >= 1024 && amount % 1024 === 0) return `${amount / 1024} GB`;
    return `${amount} MB`;
  }, [user]);
  const planLabel = useMemo(() => {
    const raw = (user?.plan || 'basic').toString().trim();
    if (!raw) return 'Basic';
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [user]);
  const planTierLabel = useMemo(() => {
    const plan = (user?.plan || 'basic').toString().toLowerCase();
    if (plan === 'basic' || plan === 'free') return 'Free';
    if (plan === 'standard') return 'Standard';
    if (plan === 'pro' || plan === 'premium') return 'Premium';
    return 'Free';
  }, [user]);
  const storageUsage = useMemo(() => {
    const totalMb = typeof user?.storage === 'number' && Number.isFinite(user.storage) ? Math.max(1, user.storage) : 1024;
    const breakdown = normalizeStorageBreakdown(user?.storageBreakdown);
    const usedMbRaw = typeof user?.storageused === 'number' && Number.isFinite(user.storageused) ? Math.max(0, user.storageused) : 0;
    const usedMb = Math.min(usedMbRaw, totalMb);
    const isStorageFull = Math.max(0, totalMb - usedMb) <= 0;
    const usedRatio = Math.max(0, Math.min(1, usedMb / totalMb));
    const usedPercent = Math.round(usedRatio * 100);

    return {
      totalMb,
      usedMb,
      freeMb: Math.max(0, totalMb - usedMb),
      usedPercent,
      usedLabel: isStorageFull ? 'Storage Full' : `${formatStorageValue(usedMb)} Used`,
      freeLabel: isStorageFull ? 'Storage Full' : `${formatStorageValue(Math.max(0, totalMb - usedMb))} Free`,
      percentOfTotalLabel: isStorageFull ? 'Storage Full' : `${usedPercent}% of ${formatStorageValue(totalMb)}`,
      segments: breakdown
        .filter((app) => app.storageUsed > 0)
        .map((app) => ({
          ...app,
          widthPercent: Math.max(0, Math.min(100, (Math.min(app.storageUsed, totalMb) / totalMb) * 100)),
        })),
      apps: breakdown
        .map((app) => ({
          ...app,
          storageLabel: formatStorageValue(app.storageUsed),
          percentOfTotal: totalMb > 0 ? Math.max(0, Math.min(100, (app.storageUsed / totalMb) * 100)) : 0,
        }))
        .sort((a, b) => b.storageUsed - a.storageUsed),
    };
  }, [user]);
  const appBreakdown = useMemo(() => normalizeStorageBreakdown(user?.storageBreakdown), [user?.storageBreakdown]);
  const photosStorage = appBreakdown.find((app) => app.key === 'photos') || APP_STORAGE_BREAKDOWN[0];
  const photosActive = photosStorage?.active === true;
  const notesStorage = appBreakdown.find((app) => app.key === 'notes') || APP_STORAGE_BREAKDOWN[1];
  const notesActive = notesStorage?.active === true;
  const contactsStorage = appBreakdown.find((app) => app.key === 'contacts') || APP_STORAGE_BREAKDOWN[2];
  const contactsActive = contactsStorage?.active === true;
  const notesStatusSyncing = notesActive && dashboardNotesLoading;
  const contactsStatusSyncing = contactsActive && dashboardContactsLoading;
  const photosStatusSyncing = photosActive && dashboardPhotosLoading;
  dashboardPhotosLengthRef.current = dashboardPhotos.length;
  dashboardNotesLengthRef.current = dashboardNotes.length;
  dashboardContactsLengthRef.current = dashboardContacts.length;

  useEffect(() => {
    if (status !== 'ready') return undefined;
    if (!photosActive) {
      setDashboardPhotosLoading(false);
      return undefined;
    }

    let cancelled = false;

    function syncFromLocalCache() {
      const nextPhotos = readDashboardPhotosPreviewCache();
      setDashboardPhotos((currentPhotos) => (
        previewSignature(currentPhotos) === previewSignature(nextPhotos) ? currentPhotos : nextPhotos
      ));
      setDashboardPhotosLoading(false);
    }

    async function loadPhotosPreview() {
      setDashboardPhotosLoading((current) => (dashboardPhotosLengthRef.current ? current : true));
      try {
        const response = await apiFetch('/photos', { cache: 'no-store' });
        const json = await response.json().catch(() => ({}));
        if (cancelled || !response.ok || !json?.ok) return;
        const photos = (Array.isArray(json.photos) ? json.photos : [])
          .map(normalizeDashboardPhoto)
          .filter(Boolean)
          .slice(0, 4);
        const nextPhotos = photos.length ? photos : [DEFAULT_DASHBOARD_PHOTO];
        setDashboardPhotos((currentPhotos) => (
          previewSignature(currentPhotos) === previewSignature(nextPhotos) ? currentPhotos : nextPhotos
        ));
      } catch {
        if (!cancelled) syncFromLocalCache();
      } finally {
        if (!cancelled) setDashboardPhotosLoading(false);
      }
    }

    window.addEventListener('iclora:photos-preview-updated', syncFromLocalCache);
    window.addEventListener('storage', syncFromLocalCache);
    syncFromLocalCache();
    loadPhotosPreview();

    return () => {
      cancelled = true;
      window.removeEventListener('iclora:photos-preview-updated', syncFromLocalCache);
      window.removeEventListener('storage', syncFromLocalCache);
    };
  }, [status, photosActive]);

  useEffect(() => {
    if (status !== 'ready') return undefined;
    const uid = typeof user?.uid === 'string' ? user.uid.trim() : '';
    if (!uid || !notesActive) {
      setDashboardNotesLoading(false);
      return undefined;
    }

    let cancelled = false;
    let unsub = null;
    let refreshTimer = null;

    function syncFromLocalCache() {
      const nextNotes = readDashboardNotesPreviewCache();
      setDashboardNotes((currentNotes) => (
        previewSignature(currentNotes) === previewSignature(nextNotes) ? currentNotes : nextNotes
      ));
      setDashboardNotesLoading(false);
    }

    async function loadPreview() {
      const requestStartedAt = Date.now();
      setDashboardNotesLoading((current) => (dashboardNotesLengthRef.current ? current : true));
      try {
        const response = await apiFetch(`/notes/preview?limit=${DASHBOARD_NOTES_PREVIEW_LIMIT}`);
        const json = await response.json().catch(() => ({}));
        if (cancelled || !response.ok || !json?.ok) return;
        const nextNotes = Array.isArray(json.notes) ? json.notes : [];
        const dashboardCache = JSON.parse(window.localStorage.getItem(DASHBOARD_NOTES_CACHE_KEY) || 'null');
        const notesCache = JSON.parse(window.localStorage.getItem(NOTES_CACHE_KEY) || 'null');
        const localCachedAt = Math.max(Number(dashboardCache?.cachedAt || 0), Number(notesCache?.cachedAt || 0));
        const localNotes = readDashboardNotesPreviewCache();
        const localIds = previewSignature(localNotes);
        const fetchedIds = previewSignature(nextNotes);
        if (localCachedAt > requestStartedAt || (localCachedAt && Date.now() - localCachedAt < 8000 && localIds && localIds !== fetchedIds)) {
          syncFromLocalCache();
          return;
        }
        setDashboardNotes((currentNotes) => (
          previewSignature(currentNotes) === fetchedIds ? currentNotes : nextNotes
        ));
        writeDashboardNotesPreviewCache(nextNotes);
      } finally {
        if (!cancelled) setDashboardNotesLoading(false);
      }
    }

    window.addEventListener('iclora:notes-preview-updated', syncFromLocalCache);
    window.addEventListener('storage', syncFromLocalCache);
    loadPreview();
    try {
      const db = getFirebaseDb();
      unsub = onSnapshot(doc(db, 'users', uid, 'notes', 'meta'), () => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(loadPreview, 90);
      });
    } catch {

    }

    return () => {
      cancelled = true;
      window.removeEventListener('iclora:notes-preview-updated', syncFromLocalCache);
      window.removeEventListener('storage', syncFromLocalCache);
      if (refreshTimer) clearTimeout(refreshTimer);
      if (typeof unsub === 'function') unsub();
    };
  }, [status, user?.uid, notesActive]);

  useEffect(() => {
    if (status !== 'ready') return undefined;
    if (!contactsActive) {
      setDashboardContactsLoading(false);
      return undefined;
    }

    let cancelled = false;

    function syncFromLocalCache() {
      const nextContacts = readDashboardContactsPreviewCache();
      setDashboardContacts((currentContacts) => (
        previewSignature(currentContacts, 'displayName') === previewSignature(nextContacts, 'displayName')
          ? currentContacts
          : nextContacts
      ));
      setDashboardContactsLoading(false);
    }

    async function requestContactsPreview() {
      const response = await apiFetch(`/contacts/preview?limit=${DASHBOARD_CONTACTS_PREVIEW_LIMIT}`);
      const json = await response.json().catch(() => ({}));
      if (response.ok && json?.ok) {
        const contacts = Array.isArray(json.contacts) ? json.contacts.map(normalizeDashboardContact) : [];
        if (contacts.length) return contacts.slice(0, DASHBOARD_CONTACTS_PREVIEW_LIMIT);
      }

      const fallbackResponse = await apiFetch('/contacts');
      const fallbackJson = await fallbackResponse.json().catch(() => ({}));
      if (!fallbackResponse.ok || !fallbackJson?.ok) throw new Error(fallbackJson?.error || json?.error || 'Could not load contacts');
      return (Array.isArray(fallbackJson.contacts) ? fallbackJson.contacts : [])
        .map(normalizeDashboardContact)
        .filter((contact) => contact.id || contact.displayName)
        .slice(0, DASHBOARD_CONTACTS_PREVIEW_LIMIT);
    }

    async function loadContactsPreview() {
      const requestStartedAt = Date.now();
      setDashboardContactsLoading((current) => (dashboardContactsLengthRef.current ? current : true));
      try {
        const contacts = await requestContactsPreview();
        if (cancelled) return;
        const dashboardCache = JSON.parse(window.localStorage.getItem(DASHBOARD_CONTACTS_CACHE_KEY) || 'null');
        const contactsCache = JSON.parse(window.localStorage.getItem(CONTACTS_CACHE_KEY) || 'null');
        const localCachedAt = Math.max(Number(dashboardCache?.cachedAt || 0), Number(contactsCache?.cachedAt || 0));
        const localContacts = readDashboardContactsPreviewCache();
        const localIds = previewSignature(localContacts, 'displayName');
        const fetchedIds = previewSignature(contacts, 'displayName');
        if (localCachedAt > requestStartedAt || (localCachedAt && Date.now() - localCachedAt < 8000 && localIds && localIds !== fetchedIds)) {
          syncFromLocalCache();
          return;
        }
        setDashboardContacts((currentContacts) => (
          previewSignature(currentContacts, 'displayName') === fetchedIds ? currentContacts : contacts
        ));
        writeDashboardContactsPreviewCache(contacts);
      } catch {
        if (!cancelled) syncFromLocalCache();
      } finally {
        if (!cancelled) setDashboardContactsLoading(false);
      }
    }

    window.addEventListener('iclora:contacts-preview-updated', syncFromLocalCache);
    window.addEventListener('storage', syncFromLocalCache);
    syncFromLocalCache();
    loadContactsPreview();

    return () => {
      cancelled = true;
      window.removeEventListener('iclora:contacts-preview-updated', syncFromLocalCache);
      window.removeEventListener('storage', syncFromLocalCache);
    };
  }, [status, contactsActive]);

  useEffect(() => {
    if (status !== 'ready') return undefined;
    const previous = previousStorageLabelRef.current;
    if (!previous) {
      previousStorageLabelRef.current = storageUsage.usedLabel;
      return undefined;
    }
    if (previous === storageUsage.usedLabel) return undefined;

    previousStorageLabelRef.current = storageUsage.usedLabel;
    if (liteDashboard) return undefined;
    setStorageUpdating(true);
    if (storageAnimationTimerRef.current) clearTimeout(storageAnimationTimerRef.current);
    storageAnimationTimerRef.current = setTimeout(() => {
      setStorageUpdating(false);
    }, 360);

    return () => {
      if (storageAnimationTimerRef.current) clearTimeout(storageAnimationTimerRef.current);
    };
  }, [liteDashboard, status, storageUsage.usedLabel]);
  const openCloudSettings = () => {
    navigate('/cloud/setting');
  };

  const refreshStorageDetails = async () => {
    setStorageDetailsOpen(true);
    setStorageDetailsClosing(false);
    if (storageDetailsCloseTimerRef.current) {
      clearTimeout(storageDetailsCloseTimerRef.current);
      storageDetailsCloseTimerRef.current = null;
    }
    setStorageDetailsLoading(true);
    setStorageDetailsError('');
    try {
      const response = await apiFetch('/storage/refresh');
      const json = await response.json().catch(() => ({}));
      if (response.status === 401) {
        if (isStaleSessionResponse(response)) return;
        const error = new Error('unauthorized');
        error.code = 'UNAUTHORIZED';
        throw error;
      }
      if (response.status === 429) {
        throw new Error(json?.error || 'Too many refreshes. Try again in a minute.');
      }
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Could not refresh storage');
      }

      setUser((prev) => {
        const next = {
          ...(prev || {}),
          uid: pickProfileString(json?.uid, prev?.uid),
          name: pickProfileString(json?.name, prev?.name),
          email: pickProfileString(json?.email, prev?.email),
          provider: pickProfileString(json?.provider, prev?.provider),
          createdAt: pickProfileString(json?.createdAt, prev?.createdAt),
          lastLoginBy: pickProfileString(json?.lastLoginBy, prev?.lastLoginBy),
          lastLoginAt: pickProfileString(json?.lastLoginAt, prev?.lastLoginAt),
          profilePhotoUrl: pickProfileString(json?.profilePhotoUrl, prev?.profilePhotoUrl),
          plan: json?.plan || prev?.plan || 'basic',
          storage: typeof json?.storage === 'number' ? json.storage : (prev?.storage || 1024),
          storageused: typeof json?.storageused === 'number' ? json.storageused : (prev?.storageused || 0),
          storageBreakdown: normalizeStorageBreakdown(json?.storageBreakdown),
        };
        writeUserProfileCache(next);
        return next;
      });
    } catch (error) {
      if (error?.code === 'STALE_SESSION_RESPONSE') return;
      if (error?.code === 'UNAUTHORIZED') {
        await clearSignedOutData();
        navigate('/auth', { replace: true, state: { from: location.pathname } });
        return;
      }
      setStorageDetailsError(error?.message || 'Could not refresh storage');
    } finally {
      setStorageDetailsLoading(false);
    }
  };

  const closeStorageDetails = () => {
    if (storageDetailsClosing) return;
    setStorageDetailsClosing(true);
    if (storageDetailsCloseTimerRef.current) clearTimeout(storageDetailsCloseTimerRef.current);
    storageDetailsCloseTimerRef.current = setTimeout(() => {
      setStorageDetailsOpen(false);
      setStorageDetailsClosing(false);
      setStorageDetailsError('');
      storageDetailsCloseTimerRef.current = null;
    }, liteDashboard ? 80 : 360);
  };

  useEffect(() => () => {
    if (storageDetailsCloseTimerRef.current) {
      clearTimeout(storageDetailsCloseTimerRef.current);
      storageDetailsCloseTimerRef.current = null;
    }
  }, []);

  const selectedBackground = BACKGROUND_COLORS.find((color) => color.value === backgroundColor) || BACKGROUND_COLORS[2];

  const finishCustomizing = () => {
    setColorPickerOpen(false);
    setIsCustomizing(false);

    apiFetch('/dashboard-tweaks/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dashboardAccentColor: backgroundColor }),
    }).catch(() => {

    });
  };
  const setupConfig = {
    notes: {
      title: 'Setup Notes',
      description: 'You will be allotted a Notes Cloud for your account.',
      icon: '/apps/notes.webp',
      iconDark: '/apps/notes-dark.webp',
      endpoint: '/notes/setup',
      successTitle: 'Notes activated',
      successMessage: 'Your Notes Cloud is now activated for this account.',
      readyTitle: 'Notes already active',
      readyMessage: 'Your iClora Notes Cloud is already ready.',
    },
    photos: {
      title: 'Setup Photos',
      description: 'You will be allotted a Photos Cloud for your account.',
      icon: '/apps/photos.webp',
      iconDark: '/apps/photos-dark.webp',
      endpoint: '/photos/setup',
      successTitle: 'Photos activated',
      successMessage: 'Your Photos Cloud is now activated for this account.',
      readyTitle: 'Photos already active',
      readyMessage: 'Your iClora Photos Cloud is already ready.',
    },
    contacts: {
      title: 'Setup Contacts',
      description: 'You will be allotted a Contacts Cloud for your account.',
      icon: '/apps/contacts.webp',
      iconDark: '/apps/contacts-dark.webp',
      endpoint: '/contacts/setup',
      successTitle: 'Contacts activated',
      successMessage: 'Your Contacts Cloud is now activated for this account.',
      readyTitle: 'Contacts already active',
      readyMessage: 'Your iClora Contacts Cloud is already ready.',
    },
  };
  const activeSetupConfig = setupApp ? setupConfig[setupApp] : null;
  const openSetupModal = (appKey) => {
    setSetupApp(appKey);
  };
  const closeSetupModal = () => {
    if (setupLoading) return;
    setSetupApp('');
  };
  const handleActivateSetup = async () => {
    if (setupLoading || !activeSetupConfig) return;
    const appKey = setupApp;
    setSetupLoading(true);
    try {
      const response = await apiFetch(activeSetupConfig.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || `Could not activate ${activeSetupConfig.title.replace('Setup ', '')}`);
      }
      setSetupApp('');
      showAlert({
        title: json?.alreadyActive ? activeSetupConfig.readyTitle : activeSetupConfig.successTitle,
        message: json?.alreadyActive ? activeSetupConfig.readyMessage : activeSetupConfig.successMessage,
        type: 'success',
      });
      try {
        const profileResponse = await apiFetch('/auth/me');
        const profileJson = await profileResponse.json().catch(() => ({}));
        if (profileResponse.ok && profileJson?.ok) {
          const nextUser = {
            uid: pickProfileString(profileJson?.uid, user?.uid),
            name: pickProfileString(profileJson?.name, user?.name),
            email: pickProfileString(profileJson?.email, user?.email),
            provider: pickProfileString(profileJson?.provider, user?.provider),
            createdAt: pickProfileString(profileJson?.createdAt, user?.createdAt),
            lastLoginBy: pickProfileString(profileJson?.lastLoginBy, user?.lastLoginBy),
            lastLoginAt: pickProfileString(profileJson?.lastLoginAt, user?.lastLoginAt),
            profilePhotoUrl: pickProfileString(profileJson?.profilePhotoUrl, user?.profilePhotoUrl),
            plan: profileJson?.plan || user?.plan || 'basic',
            storage: typeof profileJson?.storage === 'number' ? profileJson.storage : (user?.storage || 1024),
            storageused: typeof profileJson?.storageused === 'number' ? profileJson.storageused : (user?.storageused || 0),
            storageBreakdown: normalizeStorageBreakdown(profileJson?.storageBreakdown),
          };
          writeUserProfileCache(nextUser);
          setUser(nextUser);
        }
      } catch {

      }
      if (appKey === 'notes') {
        navigate('/cloud/apps/notes/u');
      }
      if (appKey === 'photos') {
        navigate('/cloud/apps/photos/u');
      }
    } catch (error) {
      showAlert({
        title: `${activeSetupConfig?.title || 'Setup'} failed`,
        message: error?.message || 'Could not activate this app right now.',
        type: 'error',
      });
    } finally {
      setSetupLoading(false);
    }
  };
  const entranceClass = entranceMotionMode && !isCustomizing && !liteDashboard ? `cloud-shell--enter-${entranceMotionMode}` : '';

  if (status !== 'ready') return <DashboardLoadingState />;

  return (
    <>
      {!isCustomizing && (
        <DashboardNavbar
          user={user}
          onCustomize={() => setIsCustomizing(true)}
          accentColor={backgroundColor}
          darkLogoIcon="/faviconn.ico"
          className="dashboard-navbar--dashboard"
          onOpenStorageDetails={refreshStorageDetails}
        />
      )}
      {isCustomizing && (
        <div className="cloud-customize-bar" aria-label="Personalise iClora controls" style={{ '--cloud-accent': backgroundColor }}>
          <button type="button" className="cloud-customize-bar__done" onClick={finishCustomizing}>
            Done
          </button>
          <div className="cloud-customize-bar__actions">
            <div className="cloud-customize-color">
              <button
                type="button"
                className={`cloud-customize-color__button ${colorPickerOpen ? 'is-open' : ''}`}
                aria-expanded={colorPickerOpen}
                onClick={() => setColorPickerOpen((open) => !open)}
              >
                <span>Select Background Color</span>
                <span className="cloud-customize-color__preview" style={{ backgroundColor: selectedBackground.value }} />
              </button>
              <div className={`cloud-customize-color__panel ${colorPickerOpen ? 'is-open' : ''}`}>
                <div className="cloud-customize-color__mobile-head">
                  <button type="button" aria-label="Close color picker" onClick={() => setColorPickerOpen(false)}>
                    <FiX />
                  </button>
                  <span>Select a Color</span>
                </div>
                <div className="cloud-customize-color__swatches">
                  {BACKGROUND_COLORS.map((color, index) => (
                    <button
                      key={color.value}
                      type="button"
                      className={`cloud-customize-color__swatch ${color.value === selectedBackground.value ? 'is-selected' : ''}`}
                      aria-label={`Use ${color.name} background`}
                      style={{ backgroundColor: color.value, '--swatch-index': index }}
                      onClick={() => setBackgroundColor(color.value)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <main
        className={`cloud-shell ${liteDashboard ? 'cloud-shell--lite' : ''} ${isCustomizing ? 'cloud-shell--customizing' : ''} ${entranceClass}`.trim()}
        aria-label="Cloud dashboard"
        style={{ '--cloud-accent': backgroundColor }}
      >
        <section className="cloud-grid">
          <article className="cloud-card cloud-card--profile">
            <div className="cloud-profile__orb cloud-profile__orb--one" aria-hidden="true" />
            <div className="cloud-profile__orb cloud-profile__orb--two" aria-hidden="true" />

            <button type="button" className="cloud-profile__avatar-button" aria-label={`${displayName} profile photo`}>
              <div className="cloud-profile__avatar">
                {user?.profilePhotoUrl ? (
                  <img src={user.profilePhotoUrl} alt={`${displayName} profile`} loading="eager" decoding="async" {...imgProtection} />
                ) : (
                  <span>{initials}</span>
                )}
              </div>
            </button>

            <div className="cloud-profile__meta">
              <h1 className="cloud-profile__name">
                <span className="cloud-profile__name-text">{profileNameParts.nameText || profileName}</span>
                {profileNameParts.emojiText ? (
                  <span className="cloud-profile__name-emoji" aria-label="emoji">{profileNameParts.emojiText}</span>
                ) : null}
              </h1>
              <p className="cloud-profile__email">{user?.email || ''}</p>
              <div className="cloud-profile__subscription" aria-label="Subscription details">
                <button type="button" className="cloud-profile__plan-header" aria-label="Open cloud settings" onClick={openCloudSettings}>
                  <span>Your Plan</span>
                </button>
                <button type="button" className="cloud-profile__plan-card" aria-label="Open cloud settings" onClick={openCloudSettings}>
                  <span className="cloud-profile__plan-icon" aria-hidden="true">
                    <picture>
                      <source srcSet="/faviconn.ico" media="(prefers-color-scheme: dark)" />
                      <img src="/pwa-icon-512.png" alt="" aria-hidden="true" />
                    </picture>
                  </span>
                  <div className="cloud-profile__plan-body">
                    <div className="cloud-profile__plan-name">{planLabel}</div>
                    <div className="cloud-profile__plan-storage">{storageLabel} Storage</div>
                    <div className="cloud-profile__plan-tier">{planTierLabel}</div>
                  </div>
                </button>
                <div className="cloud-profile__storage" aria-label="Storage usage">
                  <button
                    type="button"
                    className="cloud-profile__storage-header"
                    aria-label="Show storage used by app"
                    aria-busy={storageDetailsLoading}
                    onClick={refreshStorageDetails}
                  >
                    <span className="cloud-profile__storage-title">
                      Your Storage
                      {isStorageFetching ? (
                        <img
                          src="/arrow.png"
                          alt=""
                          aria-label="Updating storage"
                          className="cloud-profile__live-indicator cloud-profile__live-indicator--spinner"
                        />
                      ) : null}
                    </span>
                    <span className="cloud-profile__storage-chevron" aria-hidden="true">
                      <img src="/right-arrow.png" alt="" className="custom-arrow" />
                    </span>
                  </button>
                  <div className="cloud-profile__storage-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={storageUsage.usedPercent}>
                    {storageUsage.segments.map((segment) => (
                      <span
                        key={segment.key}
                        className="cloud-profile__storage-fill"
                        style={{
                          width: `${segment.widthPercent}%`,
                          backgroundColor: segment.color,
                        }}
                      />
                    ))}
                  </div>
                  <div className={`cloud-profile__storage-used ${storageUpdating ? 'is-updating' : ''}`}>
                    {storageUsage.usedLabel}
                  </div>
                </div>
              </div>
            </div>
          </article>

          <article
            className={`cloud-card cloud-card--photos ${photosActive ? 'cloud-card--photos-active' : ''} ${photosStatusSyncing ? 'cloud-card--app-loading' : ''}`}
            role={photosActive && !photosStatusSyncing ? 'button' : undefined}
            tabIndex={photosActive && !photosStatusSyncing ? 0 : undefined}
            onClick={photosActive && !photosStatusSyncing ? () => navigate('/cloud/apps/photos/u') : undefined}
            onKeyDown={photosActive && !photosStatusSyncing ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                navigate('/cloud/apps/photos/u');
              }
            } : undefined}
          >
            <div className="cloud-photos__header">
              <picture>
                <source srcSet="/apps/photos-dark.webp" media="(prefers-color-scheme: dark)" />
                <img src="/apps/photos.webp" alt="" aria-hidden="true" className="cloud-photos__icon" />
              </picture>
              <div>
                <h2 className="cloud-photos__title">Photos</h2>
                <p className="cloud-photos__status">{photosActive ? 'Library' : 'Cloud'}</p>
              </div>
            </div>
            <div className="cloud-photos__body">
              {photosStatusSyncing ? (
                <AppPanelLoader label="Photos" />
              ) : photosActive ? (
                <div className="cloud-photos__privacy-message" role="note">
                  <p>Can&apos;t show photos here for preview because of privacy concern.</p>
                  <span><FiKey aria-hidden="true" /> iClora uses signed keys.</span>
                </div>
              ) : (
                <>
                  <h3 className="cloud-photos__headline">Setup iClora Photos</h3>
                  <p className="cloud-photos__copy">iClora&apos;s moto is simple: upload your data here and keep it safe. Your files are stored securely and encrypted, so only you have access.</p>
                  <p className="cloud-photos__copy">You can find your images by just describing them.</p>
                  <p className="cloud-photos__copy-mobile">Store data safely, encrypted, and find images by describing them.</p>
                  <button type="button" className="cloud-photos__empty-overlay" aria-label="Setup photos" onClick={() => openSetupModal('photos')}>
                    <picture>
                      <source srcSet="/apps/photos-dark.webp" media="(prefers-color-scheme: dark)" />
                      <img src="/apps/photos.webp" alt="" aria-hidden="true" className="cloud-photos__cta-icon" />
                    </picture>
                    <span className="cloud-photos__empty-text">Setup Photos</span>
                  </button>
                </>
              )}
            </div>
          </article>

          <div className={`cloud-app-row ${notesActive ? 'cloud-app-row--notes-active' : ''}`}>
            <article
              className={`cloud-card cloud-card--notes ${notesActive ? 'cloud-card--notes-active' : ''} ${notesStatusSyncing ? 'cloud-card--app-loading' : ''}`}
              role={notesActive && !notesStatusSyncing ? 'button' : undefined}
              tabIndex={notesActive && !notesStatusSyncing ? 0 : undefined}
              onClick={notesActive && !notesStatusSyncing ? () => navigate('/cloud/apps/notes/u') : undefined}
              onKeyDown={notesActive && !notesStatusSyncing ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  navigate('/cloud/apps/notes/u');
                }
              } : undefined}
            >
              <div className="cloud-notes__header">
                <div className="cloud-notes__header-main">
                  <picture>
                    <source srcSet="/apps/notes-dark.webp" media="(prefers-color-scheme: dark)" />
                    <img src="/apps/notes.webp" alt="" aria-hidden="true" className="cloud-notes__icon" />
                  </picture>
                  <div>
                    <h2 className="cloud-notes__title">
                      <span className="cloud-notes__title-brand">iClora</span>{' '}
                      <span className="cloud-notes__title-accent">Notes</span>
                    </h2>
                    <p className="cloud-notes__status">All iClora</p>
                  </div>
                </div>
                {notesActive ? (
                  <button
                    type="button"
                    className="cloud-notes__compose"
                    aria-label="Compose note"
                    onClick={(event) => {
                      event.stopPropagation();
                      navigate('/cloud/apps/notes/u');
                    }}
                  >
                    <img src="/COMPOSE.webp" alt="" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              <div className="cloud-notes__body">
                {notesStatusSyncing ? (
                  <AppPanelLoader label="Notes" />
                ) : notesActive ? (
                  <div className="cloud-notes__preview" aria-label="Available notes">
                    {dashboardNotes.length ? (
                      <div className="cloud-notes__preview-grid">
                        {dashboardNotes.map((note) => (
                          <button
                            type="button"
                            key={note.id}
                            className="cloud-notes__preview-note"
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate(`/cloud/apps/notes/u/${note.id}`);
                            }}
                          >
                            <span className="cloud-notes__preview-title">
                              <span>{note.title || 'Untitled'}</span>
                              <FiEdit3 />
                            </span>
                            <span className="cloud-notes__preview-meta">
                              <span>{formatNoteDate(note.updatedAt || note.createdAt)}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <button type="button" className="cloud-notes__preview-empty" onClick={() => navigate('/cloud/apps/notes/u')}>
                        {dashboardNotesLoading ? 'Syncing notes...' : 'No notes here yet.'}
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <h3 className="cloud-notes__headline">Setup iClora Notes</h3>
                    <p className="cloud-notes__copy">Keep ideas, reminders, lists, and quick thoughts in one secure place.</p>
                    <p className="cloud-notes__copy">Your notes stay synced and easy to find whenever you need them.</p>
                    <p className="cloud-notes__copy-mobile">Keep notes, reminders, and ideas synced in one secure place.</p>
                    <button type="button" className="cloud-notes__empty-overlay" aria-label="Open notes" onClick={() => openSetupModal('notes')}>
                      <picture>
                        <source srcSet="/apps/notes-dark.webp" media="(prefers-color-scheme: dark)" />
                        <img src="/apps/notes.webp" alt="" aria-hidden="true" className="cloud-notes__cta-icon" />
                      </picture>
                      <span className="cloud-notes__empty-text">Setup Notes</span>
                    </button>
                  </>
                )}
              </div>
            </article>

            <article
              className={`cloud-card cloud-card--contacts ${contactsActive ? 'cloud-card--contacts-active' : ''} ${contactsStatusSyncing ? 'cloud-card--app-loading' : ''}`}
              role={contactsActive && !contactsStatusSyncing ? 'button' : undefined}
              tabIndex={contactsActive && !contactsStatusSyncing ? 0 : undefined}
              onClick={contactsActive && !contactsStatusSyncing ? () => navigate('/cloud/apps/contacts/u') : undefined}
              onKeyDown={contactsActive && !contactsStatusSyncing ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  navigate('/cloud/apps/contacts/u');
                }
              } : undefined}
            >
              <div
                className={`cloud-contacts__header ${contactsActive ? 'cloud-contacts__header--active' : ''}`}
                role={contactsActive ? 'button' : undefined}
                tabIndex={contactsActive ? 0 : undefined}
                onClick={contactsActive ? (event) => {
                  event.stopPropagation();
                  navigate('/cloud/apps/contacts/u');
                } : undefined}
                onKeyDown={contactsActive ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    navigate('/cloud/apps/contacts/u');
                  }
                } : undefined}
              >
                <picture>
                  <source srcSet="/apps/contacts-dark.webp" media="(prefers-color-scheme: dark)" />
                  <img src="/apps/contacts.webp" alt="" aria-hidden="true" className="cloud-contacts__icon" />
                </picture>
                <div>
                  <h2 className="cloud-contacts__title">Contacts</h2>
                  <p className="cloud-contacts__status">iClora</p>
                </div>
              </div>
              <div className={`cloud-contacts__body ${contactsActive && dashboardContacts.length ? 'cloud-contacts__body--preview' : ''}`}>
                {contactsStatusSyncing ? (
                  <AppPanelLoader label="Contacts" />
                ) : contactsActive && dashboardContacts.length ? (
                  <>
                    <div className="cloud-contacts__preview" aria-label="Contacts preview">
                      {dashboardContacts.map((contact) => (
                        <div className="cloud-contacts__person" key={contact.id || contact.displayName}>
                          <span className="cloud-contacts__avatar">
                            {contact.photoUrl ? (
                              <img src={contact.photoUrl} alt="" aria-hidden="true" {...imgProtection} />
                            ) : (
                              <span>{contactInitials(contact)}</span>
                            )}
                          </span>
                          <span className="cloud-contacts__person-copy">
                            <strong>{contact.displayName}</strong>
                            <small>{contact.phone || contact.email || 'iClora Contact'}</small>
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className="cloud-contacts__headline">{contactsActive ? 'iClora Contacts' : 'Setup iClora Contacts'}</h3>
                    <p className="cloud-contacts__copy">{contactsActive ? (dashboardContactsLoading ? 'Syncing your contacts...' : 'Your people are synced and ready.') : 'Keep your people synced and ready across iClora.'}</p>
                    <button
                      type="button"
                      className="cloud-contacts__empty-overlay"
                      aria-label="Open contacts"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (contactsActive) {
                          navigate('/cloud/apps/contacts/u');
                        } else {
                          openSetupModal('contacts');
                        }
                      }}
                    >
                      <picture>
                        <source srcSet="/apps/contacts-dark.webp" media="(prefers-color-scheme: dark)" />
                        <img src="/apps/contacts.webp" alt="" aria-hidden="true" className="cloud-contacts__cta-icon" />
                      </picture>
                      <span className="cloud-contacts__empty-text">{contactsActive ? 'Open Contacts' : 'Setup Contacts'}</span>
                    </button>
                  </>
                )}
              </div>
            </article>
          </div>

        </section>
        <section className="cloud-summary" aria-label="Account summary and recovery">
          <article className="cloud-summary__item">
            <button type="button" className="cloud-summary__title" onClick={openCloudSettings}>
              <span>Your Plan</span>
            </button>
            <div className="cloud-summary__plan-row">
              <picture className="cloud-summary__plan-icon">
                <source srcSet="/faviconn.ico" media="(prefers-color-scheme: dark)" />
                <img src="/pwa-icon-512.png" alt="" aria-hidden="true" />
              </picture>
              <span>{planLabel}</span>
            </div>
            <p className="cloud-summary__value">{storageLabel} Storage</p>
            <p className="cloud-summary__meta">{planTierLabel}</p>
          </article>

          <article className="cloud-summary__item">
            <button type="button" className="cloud-summary__title" onClick={refreshStorageDetails}>
              <span className="cloud-summary__title-text">
                Your Storage
                {isStorageFetching ? (
                  <img
                    src="/arrow.png"
                    alt=""
                    aria-label="Updating storage"
                    className="cloud-summary__live-indicator cloud-summary__live-indicator--spinner"
                  />
                ) : null}
              </span>
              <span
                className="cloud-summary__chevron cloud-summary__chevron-button"
                aria-label="Show storage used by app"
                aria-busy={storageDetailsLoading}
              >
                <img src="/right-arrow.png" alt="" className="custom-arrow" />
              </span>
            </button>
            <div className="cloud-summary__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={storageUsage.usedPercent}>
              {storageUsage.segments.map((segment) => (
                <span
                  key={segment.key}
                  className="cloud-summary__fill"
                  style={{
                    width: `${segment.widthPercent}%`,
                    backgroundColor: segment.color,
                  }}
                />
              ))}
            </div>
            <p className="cloud-summary__value">{storageUsage.usedLabel}</p>
            <p className="cloud-summary__meta">{storageUsage.percentOfTotalLabel}</p>
          </article>

        </section>
        <footer className="cloud-footer" aria-label="Dashboard footer links">
          <p className="cloud-footer__copy">Copyright © 2026 iClora Inc. All rights reserved.</p>
        </footer>
      </main>

      {storageDetailsOpen && (
        <div
          className={`cloud-storage-details${storageDetailsClosing ? ' is-closing' : ''}`}
          role="presentation"
          onMouseDown={closeStorageDetails}
        >
          <section
            className={`cloud-storage-details__sheet${storageDetailsClosing ? ' is-closing' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cloud-storage-details-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="cloud-storage-details__close"
              aria-label="Close storage details"
              onClick={closeStorageDetails}
            >
              <FiX />
            </button>

            <div className="cloud-storage-details__head">
              <div>
                <p className="cloud-storage-details__eyebrow">{planLabel} Plan</p>
                <h2 id="cloud-storage-details-title">Your Storage</h2>
              </div>
              <button
                type="button"
                className="cloud-storage-details__refresh"
                onClick={refreshStorageDetails}
                disabled={storageDetailsLoading}
                aria-label={storageDetailsLoading ? 'Refreshing storage' : 'Refresh storage'}
              >
                <img
                  src="/arrow.png"
                  alt=""
                  aria-hidden="true"
                  className={`cloud-storage-details__refresh-icon ${storageDetailsLoading ? 'is-spinning' : ''}`}
                />
              </button>
            </div>

            <div className="cloud-storage-details__meter">
              <div className="cloud-storage-details__total">
                <span>{storageUsage.usedLabel}</span>
                <span>{storageUsage.freeLabel}</span>
              </div>
              <div className="cloud-storage-details__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={storageUsage.usedPercent}>
                {storageUsage.segments.map((segment) => (
                  <span
                    key={segment.key}
                    className="cloud-storage-details__fill"
                    style={{
                      width: `${segment.widthPercent}%`,
                      backgroundColor: segment.color,
                    }}
                  />
                ))}
              </div>
              <p>{storageUsage.percentOfTotalLabel}</p>
            </div>

            {storageDetailsError ? (
              <div className="cloud-storage-details__error" role="status">
                {storageDetailsError}
              </div>
            ) : null}

            <div className="cloud-storage-details__apps" aria-label="Storage used by app">
              {storageUsage.apps.map((app) => (
                <div className="cloud-storage-details__app" key={app.key}>
                  <span className="cloud-storage-details__app-icon">
                    <picture>
                      {app.iconDark && <source srcSet={app.iconDark} media="(prefers-color-scheme: dark)" />}
                      <img src={app.icon} alt="" aria-hidden="true" />
                    </picture>
                  </span>
                  <span className="cloud-storage-details__app-name">{app.label}</span>
                  <span className="cloud-storage-details__app-bar" aria-hidden="true">
                    <span
                      style={{
                        width: `${Math.max(3, app.percentOfTotal)}%`,
                        backgroundColor: app.color,
                        opacity: app.storageUsed > 0 ? 1 : 0.32,
                      }}
                    />
                  </span>
                  <span className="cloud-storage-details__app-value">{app.storageLabel}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {activeSetupConfig && (
        <div
          className="manage-account__modal-layer dashboard-navbar__modal-layer"
          role="presentation"
          onMouseDown={closeSetupModal}
        >
          <section
            className={`manage-account__name-modal manage-account__delete-modal dashboard-navbar__logout-modal cloud-app-setup-modal ${setupLoading ? 'cloud-app-setup-modal--activating' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dashboard-app-setup-title"
            aria-busy={setupLoading}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="manage-account__modal-close"
              aria-label="Close app setup"
              onClick={closeSetupModal}
              disabled={setupLoading}
            >
              <FiX />
            </button>

            <div className="manage-account__modal-icon cloud-app-setup-modal__icon" aria-hidden="true">
              <picture>
                {activeSetupConfig.iconDark && <source srcSet={activeSetupConfig.iconDark} media="(prefers-color-scheme: dark)" />}
                <img src={activeSetupConfig.icon} alt="" className="manage-account__logout-icon-image" />
              </picture>
            </div>

            <h2 id="dashboard-app-setup-title">{activeSetupConfig.title}</h2>
            <p className="manage-account__delete-copy">
              {activeSetupConfig.description}
            </p>

            <div className="manage-account__delete-actions">
              <button
                type="button"
                className="manage-account__delete-button manage-account__delete-button--cancel"
                onClick={closeSetupModal}
                disabled={setupLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="manage-account__delete-button cloud-app-setup-modal__activate"
                onClick={handleActivateSetup}
                disabled={setupLoading}
                aria-busy={setupLoading}
              >
                {setupLoading ? (
                  <span className="manage-account__button-spinner" aria-hidden="true" />
                ) : (
                  <span>Activate</span>
                )}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
