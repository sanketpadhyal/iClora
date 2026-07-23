import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import JSZip from 'jszip';
import {
  FiAlertTriangle,
  FiCalendar,
  FiCamera,
  FiChevronLeft,
  FiChevronRight,
  FiMail,
  FiMapPin,
  FiMenu,
  FiPlus,
  FiRefreshCw,
  FiSearch,
  FiTrash2,
  FiX,
} from 'react-icons/fi';
import { IoCall } from 'react-icons/io5';
import { apiFetch, isStaleSessionResponse } from '../api/backendapi';
import { readSessionToken } from '../auth/authCache';
import { clearSignedOutData } from '../auth/sessionCleanup';
import DownloadIcon from '../components/DownloadIcon';
import DashboardNavbar from '../cloud/dashboardnavbar';
import { readUserProfileCache, writeUserProfileCache } from '../cloud/userProfileCache';
import { readAccentColorCache } from '../cloud/themeCache';
import { useAlert } from '../alert/alert';
import AppleLoader from '../components/AppleLoader';
import { applyAppPageMeta } from '../components/utils/pageMeta';
import '../cloud/manage_account/manage.css';
import './contacts.css';

const SHARE_ICON_SRC = '/ChatGPT Image May 17, 2026, 04_28_37 AM (1) (1)_11zon.webp';

function ShareIcon() {
  return <img className="iclora-share-action-icon" src={SHARE_ICON_SRC} alt="" aria-hidden="true" draggable={false} />;
}

const CACHE_KEY = 'iclora_contacts_cache_v1';
const EMPTY_DRAFT = {
  displayName: '',
  firstName: '',
  lastName: '',
  company: '',
  phone: '',
  extraPhones: [],
  email: '',
  birthday: '',
  address: '',
  note: '',
  photoUrl: '',
  photoPublicId: '',
};

const CONTACT_FIELD_LIMITS = {
  displayName: 140,
  firstName: 80,
  lastName: 80,
  company: 120,
  phone: 24,
  email: 160,
  birthday: 10,
  address: 240,
  note: 1200,
};

const MIN_CROP_SCALE = 0.5;
const MAX_CROP_SCALE = 2.5;
const PNG_MIME_TYPE = 'image/png';
const HARD_REFRESH_COOLDOWN_MS = 9000;
const COUNTRY_DIAL_CODES = {
  US: '+1',
  CA: '+1',
  IN: '+91',
  IR: '+98',
  GB: '+44',
  GY: '+592',
  AE: '+971',
  AU: '+61',
  DE: '+49',
  FR: '+33',
  SG: '+65',
};
function readContactsCache() {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CACHE_KEY) || 'null');
    return parsed && Array.isArray(parsed.contacts) ? parsed : null;
  } catch {
    return null;
  }
}

function writeContactsCache(payload) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({
      contacts: Array.isArray(payload?.contacts) ? payload.contacts : [],
      meta: payload?.meta || {},
      cachedAt: Date.now(),
    }));
    window.dispatchEvent(new CustomEvent('iclora:contacts-preview-updated'));
  } catch {

  }
}

function normalizeContact(contact = {}) {
  const displayName = String(contact.displayName || '').trim();
  const joined = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
  return {
    id: contact.id || '',
    clientKey: contact.clientKey || contact.id || '',
    displayName: displayName || joined || contact.company || 'New Contact',
    firstName: contact.firstName || '',
    lastName: contact.lastName || '',
    company: contact.company || '',
    phone: contact.phone || '',
    extraPhones: normalizeExtraPhones(contact.extraPhones),
    email: contact.email || '',
    birthday: contact.birthday || '',
    address: contact.address || '',
    note: contact.note || '',
    photoUrl: contact.photoUrl || '',
    photoPublicId: contact.photoPublicId || '',
    photoUploadPending: Boolean(contact.photoUploadPending),
    system: Boolean(contact.system),
    createdAt: contact.createdAt || '',
    updatedAt: contact.updatedAt || contact.createdAt || '',
  };
}

function sortContacts(contacts) {
  return [...contacts].map(normalizeContact).sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
  );
}

function contactUiKey(contact) {
  return contact?.clientKey || contact?.id || '';
}

function isLocalContact(contact) {
  return String(contact?.id || '').startsWith('local-contact-');
}

function initialLetter(contact) {
  const char = String(contact?.displayName || '#').trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(char) ? char : '#';
}

function initials(contact) {
  const parts = [contact?.firstName, contact?.lastName].filter(Boolean);
  const source = parts.length ? parts : String(contact?.displayName || 'C').split(/\s+/);
  return source.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || 'C';
}

function displayFromDraft(draft) {
  const display = String(draft.displayName || '').trim();
  const joined = [draft.firstName, draft.lastName].map((part) => String(part || '').trim()).filter(Boolean).join(' ');
  return display || joined || String(draft.company || '').trim() || 'New Contact';
}

function draftFromContact(contact) {
  return {
    displayName: contact?.displayName || '',
    firstName: contact?.firstName || '',
    lastName: contact?.lastName || '',
    company: contact?.company || '',
    phone: contact?.phone || '',
    extraPhones: normalizeExtraPhones(contact?.extraPhones),
    email: contact?.email || '',
    birthday: contact?.birthday || '',
    address: contact?.address || '',
    note: contact?.note || '',
    photoUrl: contact?.photoUrl || '',
    photoPublicId: contact?.photoPublicId || '',
  };
}

function normalizePhoneForCountry(value, countryCode) {
  const text = sanitizePhoneInput(value).trim();
  if (!text || text.startsWith('+')) return text;
  const digits = text.replace(/[^\d]/g, '');
  if (digits.length < 4) return text;
  const dialCode = COUNTRY_DIAL_CODES[countryCode] || '+91';
  return `${dialCode} ${digits}`;
}

function normalizeExtraPhones(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((phone) => sanitizePhoneInput(phone).trim())
    .filter(Boolean)
    .slice(0, 4);
}

function normalizeBirthday(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) return '';
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function formatBirthdayForDisplay(value = '') {
  const normalized = normalizeBirthday(value);
  if (!normalized) return '';
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function birthdayDateFromValue(value = '') {
  const normalized = normalizeBirthday(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatBirthdayValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monthLabel(date) {
  return new Intl.DateTimeFormat('en-US', { month: 'long' }).format(date);
}

function sanitizePhoneInput(value = '') {
  const source = String(value || '');
  let hasLeadingPlus = false;
  let out = '';
  for (const char of source) {
    if (char >= '0' && char <= '9') {
      out += char;
      continue;
    }
    if (!hasLeadingPlus && char === '+' && out.length === 0) {
      out += char;
      hasLeadingPlus = true;
      continue;
    }
    if (char === ' ' || char === '-' || char === '(' || char === ')') {
      out += char;
    }
  }
  return out.replace(/\s{2,}/g, ' ').slice(0, CONTACT_FIELD_LIMITS.phone);
}

function sanitizeExportName(value = '', fallback = 'Contact') {
  const cleaned = Array.from(String(value || fallback))
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code >= 0 && code <= 31) return ' ';
      if ('<>:"/\\|?*'.includes(char)) return ' ';
      return char;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  return cleaned || fallback;
}

function vcfEscape(value = '') {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function contactToVcf(contact = {}) {
  const firstName = String(contact.firstName || '').trim();
  const lastName = String(contact.lastName || '').trim();
  const displayName = String(contact.displayName || '').trim() || `${firstName} ${lastName}`.trim() || 'Contact';
  const company = String(contact.company || '').trim();
  const phone = String(contact.phone || '').trim();
  const extraPhones = normalizeExtraPhones(contact.extraPhones);
  const email = String(contact.email || '').trim();
  const note = String(contact.note || '').trim();
  const birthday = normalizeBirthday(contact.birthday || '');
  const address = String(contact.address || '').trim();

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${vcfEscape(displayName)}`,
    `N:${vcfEscape(lastName)};${vcfEscape(firstName)};;;`,
  ];
  if (company) lines.push(`ORG:${vcfEscape(company)}`);
  if (phone) lines.push(`TEL;TYPE=CELL:${vcfEscape(phone)}`);
  extraPhones.forEach((extraPhone) => lines.push(`TEL;TYPE=CELL:${vcfEscape(extraPhone)}`));
  if (email) lines.push(`EMAIL;TYPE=INTERNET:${vcfEscape(email)}`);
  if (birthday) lines.push(`BDAY:${birthday.replace(/-/g, '')}`);
  if (address) lines.push(`ADR;TYPE=HOME:;;${vcfEscape(address)};;;;`);
  if (note) lines.push(`NOTE:${vcfEscape(note)}`);
  lines.push('END:VCARD');
  return `${lines.join('\r\n')}\r\n`;
}

function isOnlyDialCode(value) {
  const text = String(value || '').trim();
  return Object.values(COUNTRY_DIAL_CODES).includes(text);
}

function isPngFile(file) {
  return String(file?.type || '').toLowerCase() === PNG_MIME_TYPE;
}

function clampCropTransform(next, metrics, imageSize) {
  const scale = Math.max(MIN_CROP_SCALE, Math.min(MAX_CROP_SCALE, next.scale));
  const displayW = imageSize.width * metrics.baseScale * scale;
  const displayH = imageSize.height * metrics.baseScale * scale;
  const maxX = Math.max(0, (displayW - metrics.viewportSize) / 2);
  const maxY = Math.max(0, (displayH - metrics.viewportSize) / 2);
  return {
    scale,
    x: Math.min(maxX, Math.max(-maxX, next.x)),
    y: Math.min(maxY, Math.max(-maxY, next.y)),
  };
}

function getCropDisplay(metrics, transform, imageSize) {
  return {
    displayW: imageSize.width * metrics.baseScale * transform.scale,
    displayH: imageSize.height * metrics.baseScale * transform.scale,
    offsetX: transform.x,
    offsetY: transform.y,
  };
}

async function cropImageForUpload(imageEl, transform, metrics, baseName, outputMimeType = 'image/webp') {
  const outputSize = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not crop image.');

  const naturalW = imageEl.naturalWidth || imageEl.width;
  const naturalH = imageEl.naturalHeight || imageEl.height;
  const exportScale = outputSize / metrics.viewportSize;
  const displayW = naturalW * metrics.baseScale * transform.scale * exportScale;
  const displayH = naturalH * metrics.baseScale * transform.scale * exportScale;
  const left = (outputSize - displayW) / 2 + (transform.x * exportScale);
  const top = (outputSize - displayH) / 2 + (transform.y * exportScale);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outputSize, outputSize);
  ctx.drawImage(imageEl, left, top, displayW, displayH);

  const blob = await new Promise((resolve) => {
    canvas.toBlob((nextBlob) => resolve(nextBlob), outputMimeType, outputMimeType === PNG_MIME_TYPE ? undefined : 0.92);
  });
  if (!blob) throw new Error('Crop export failed.');

  const extension = outputMimeType === PNG_MIME_TYPE ? 'png' : 'webp';
  return new File([blob], `${baseName}-cropped.${extension}`, { type: outputMimeType });
}

export default function Contacts() {
  const navigate = useNavigate();
  const { contactId } = useParams();
  const { showAlert } = useAlert();
  const cached = readContactsCache();
  const [contacts, setContacts] = useState(() => sortContacts(cached?.contacts || []));
  const [meta, setMeta] = useState(cached?.meta || {});
  const [loading, setLoading] = useState(!cached);
  const [setupRequired, setSetupRequired] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(contactId || '');
  const [mobilePane, setMobilePane] = useState(contactId ? 'detail' : 'list');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createNameDraft, setCreateNameDraft] = useState('');
  const [createPhoneDraft, setCreatePhoneDraft] = useState('');
  const [createPhotoFile, setCreatePhotoFile] = useState(null);
  const [createPhotoPreviewUrl, setCreatePhotoPreviewUrl] = useState('');
  const [creatingContact, setCreatingContact] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [backendSyncing, setBackendSyncing] = useState(!cached);
  const [cropOpen, setCropOpen] = useState(false);
  const [cropTarget, setCropTarget] = useState('create');
  const [cropSourcePreviewUrl, setCropSourcePreviewUrl] = useState('');
  const [cropLoaded, setCropLoaded] = useState(false);
  const [cropReady, setCropReady] = useState(false);
  const [cropMetrics, setCropMetrics] = useState({ viewportSize: 0, baseScale: 1 });
  const [cropTransform, setCropTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [cropping, setCropping] = useState(false);
  const [hardRefreshing, setHardRefreshing] = useState(false);
  const [hardRefreshLocked, setHardRefreshLocked] = useState(false);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [downloadNameDraft, setDownloadNameDraft] = useState('');
  const [downloadingContacts, setDownloadingContacts] = useState(false);
  const [user, setUser] = useState(() => readUserProfileCache());
  const userCountryCode = 'IN';
  const accentColor = readAccentColorCache() || '#2f7be6';
  const latestContactsRef = useRef(contacts);
  const selectedIdRef = useRef(selectedId);
  const photoPreviewObjectRef = useRef('');
  const createPhotoObjectRef = useRef('');
  const cropViewportRef = useRef(null);
  const cropImageRef = useRef(null);
  const cropDragRef = useRef(null);
  const syncJobsRef = useRef(0);
  const deletedContactIdsRef = useRef(new Set());
  const hardRefreshTimerRef = useRef(null);
  const loadContactsRef = useRef(null);
  const initialContactsCacheRef = useRef(cached);

  useEffect(() => {
    if (!readSessionToken()) navigate('/auth', { replace: true });
  }, [navigate]);

  async function refreshUserProfileFromBackend() {
    const cachedProfile = readUserProfileCache() || {};
    const response = await apiFetch('/auth/me', { cache: 'no-store' });
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
    const json = await response.json().catch(() => ({}));
    if (!json?.ok) return cachedProfile;
    const nextUser = {
      ...cachedProfile,
      uid: typeof json.uid === 'string' ? json.uid : (cachedProfile.uid || ''),
      name: typeof json.name === 'string' ? json.name : (cachedProfile.name || ''),
      email: typeof json.email === 'string' ? json.email : (cachedProfile.email || ''),
      firstName: typeof json.firstName === 'string' ? json.firstName : (cachedProfile.firstName || ''),
      middleName: typeof json.middleName === 'string' ? json.middleName : (cachedProfile.middleName || ''),
      lastName: typeof json.lastName === 'string' ? json.lastName : (cachedProfile.lastName || ''),
      countryCode: typeof json.countryCode === 'string' ? json.countryCode : (cachedProfile.countryCode || ''),
      countryName: typeof json.countryName === 'string' ? json.countryName : (cachedProfile.countryName || ''),
      profilePhotoUrl: typeof json.profilePhotoUrl === 'string' ? json.profilePhotoUrl : (cachedProfile.profilePhotoUrl || ''),
      provider: typeof json.provider === 'string' ? json.provider : (cachedProfile.provider || ''),
      createdAt: typeof json.createdAt === 'string' ? json.createdAt : (cachedProfile.createdAt || ''),
      lastLoginBy: typeof json.lastLoginBy === 'string' ? json.lastLoginBy : (cachedProfile.lastLoginBy || ''),
      lastLoginAt: typeof json.lastLoginAt === 'string' ? json.lastLoginAt : (cachedProfile.lastLoginAt || ''),
      plan: typeof json.plan === 'string' ? json.plan : (cachedProfile.plan || 'basic'),
      storage: typeof json.storage === 'number' ? json.storage : (cachedProfile.storage || 1024),
      storageused: typeof json.storageused === 'number' ? json.storageused : (cachedProfile.storageused || 0),
      storageBreakdown: Array.isArray(json.storageBreakdown) ? json.storageBreakdown : (cachedProfile.storageBreakdown || []),
    };
    writeUserProfileCache(nextUser);
    setUser(nextUser);
    return nextUser;
  }

  async function syncUserProfileAfterStorageChange() {
    try {
      await refreshUserProfileFromBackend();
    } catch (error) {
      if (error?.code === 'STALE_SESSION_RESPONSE') return;
      if (error?.code !== 'UNAUTHORIZED') return;
      await clearSignedOutData();
      navigate('/auth', { replace: true });
    }
  }

  useEffect(() => {
    let cancelled = false;
    refreshUserProfileFromBackend()
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

  useEffect(() => () => {
    if (photoPreviewObjectRef.current) URL.revokeObjectURL(photoPreviewObjectRef.current);
    if (createPhotoObjectRef.current) URL.revokeObjectURL(createPhotoObjectRef.current);
    if (hardRefreshTimerRef.current) clearTimeout(hardRefreshTimerRef.current);
  }, []);

  useEffect(() => {
    if (!cropOpen || !cropSourcePreviewUrl) return undefined;
    function updateCropMetrics() {
      const viewport = cropViewportRef.current;
      const image = cropImageRef.current;
      if (!viewport || !image?.naturalWidth || !image?.naturalHeight) return;
      const viewportSize = viewport.clientWidth || 1;
      const baseScale = Math.max(viewportSize / image.naturalWidth, viewportSize / image.naturalHeight);
      const nextMetrics = { viewportSize, baseScale };
      setCropMetrics(nextMetrics);
      setCropTransform((current) => clampCropTransform(current, nextMetrics, {
        width: image.naturalWidth,
        height: image.naturalHeight,
      }));
      setCropReady(true);
    }
    updateCropMetrics();
    const observer = typeof ResizeObserver !== 'undefined' && cropViewportRef.current ? new ResizeObserver(updateCropMetrics) : null;
    if (observer && cropViewportRef.current) observer.observe(cropViewportRef.current);
    window.addEventListener('resize', updateCropMetrics);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateCropMetrics);
    };
  }, [cropOpen, cropSourcePreviewUrl, cropLoaded]);

  useEffect(() => {
    return applyAppPageMeta({
      title: 'iClora Contacts',
      lightIcon: '/apps/contacts.webp',
      darkIcon: '/apps/contacts-dark.webp',
    });
  }, []);

  useEffect(() => {
    latestContactsRef.current = contacts;
    writeContactsCache({ contacts, meta });
  }, [contacts, meta]);

  useEffect(() => {
    setSelectedId(contactId || '');
    selectedIdRef.current = contactId || '';
    if (contactId) setMobilePane('detail');
  }, [contactId]);

  function composeContactsForUi(nextContacts, options = {}) {
    const dropIds = new Set([...(options.dropIds || []), ...deletedContactIdsRef.current]);
    const pinId = options.pinId || '';
    const currentContacts = latestContactsRef.current || [];
    const currentById = new Map(currentContacts.map((contact) => [contact.id, contact]));
    const previousOrder = new Map(currentContacts.map((contact, index) => [contactUiKey(contact), index]));
    const incoming = sortContacts(nextContacts).filter((contact) => !dropIds.has(contact.id));
    const incomingIds = new Set(incoming.map((contact) => contact.id));
    const merged = incoming.map((contact) => {
      const localContact = currentById.get(contact.id);
      if (!localContact) return contact;
      const keepLocalPhoto = localContact.photoUploadPending && localContact.photoUrl && !contact.photoUrl;
      return normalizeContact({
        ...contact,
        clientKey: contactUiKey(localContact) || contactUiKey(contact),
        photoUrl: keepLocalPhoto ? localContact.photoUrl : contact.photoUrl,
        photoPublicId: contact.photoPublicId || localContact.photoPublicId,
        photoUploadPending: keepLocalPhoto ? true : contact.photoUploadPending,
      });
    });

    currentContacts.forEach((contact) => {
      if (dropIds.has(contact.id)) return;
      if (isLocalContact(contact) && !incomingIds.has(contact.id)) merged.push(contact);
    });

    return merged.sort((a, b) => {
      const aPinned = pinId && (a.id === pinId || contactUiKey(a) === pinId);
      const bPinned = pinId && (b.id === pinId || contactUiKey(b) === pinId);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      const aOrder = previousOrder.has(contactUiKey(a)) ? previousOrder.get(contactUiKey(a)) : Number.MAX_SAFE_INTEGER;
      const bOrder = previousOrder.has(contactUiKey(b)) ? previousOrder.get(contactUiKey(b)) : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
    });
  }

  function applyContacts(nextContacts, options = {}) {
    const composed = composeContactsForUi(nextContacts, options);
    latestContactsRef.current = composed;
    setContacts(composed);
    writeContactsCache({ contacts: composed, meta });
    if (options.selectedId !== undefined) {
      selectedIdRef.current = options.selectedId;
      setSelectedId(options.selectedId);
    }
  }

  function beginBackendSync() {
    syncJobsRef.current += 1;
    setBackendSyncing(true);
  }

  function endBackendSync() {
    syncJobsRef.current = Math.max(0, syncJobsRef.current - 1);
    if (syncJobsRef.current === 0) setBackendSyncing(false);
  }

  const selectedContact = useMemo(
    () => contacts.find((contact) => contact.id === selectedId) || null,
    [contacts, selectedId]
  );

  const filteredContacts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return contacts;
    return contacts.filter((contact) => (
      `${contact.displayName} ${contact.phone} ${(contact.extraPhones || []).join(' ')} ${contact.email} ${contact.company}`.toLowerCase().includes(needle)
    ));
  }, [contacts, query]);

  const pinnedContacts = useMemo(() => filteredContacts.filter((contact) => contact.system), [filteredContacts]);
  const regularContacts = useMemo(() => filteredContacts.filter((contact) => !contact.system), [filteredContacts]);

  const groupedContacts = useMemo(() => {
    const groups = [];
    regularContacts.forEach((contact) => {
      const letter = initialLetter(contact);
      const current = groups[groups.length - 1];
      if (!current || current.letter !== letter) {
        groups.push({ letter, contacts: [contact] });
      } else {
        current.contacts.push(contact);
      }
    });
    return groups;
  }, [regularContacts]);

  async function loadContacts(options = {}) {
    if (!options.silent) setLoading(true);
    beginBackendSync();
    try {
      const response = await apiFetch('/contacts', options.hard ? { cache: 'no-store' } : undefined);
      const json = await response.json().catch(() => ({}));
      if (response.status === 401) {
        if (isStaleSessionResponse(response)) return;
        await clearSignedOutData();
        navigate('/auth', { replace: true });
        return;
      }
      if (response.status === 403 && json?.needsSetup) {
        setSetupRequired(true);
        setContacts([]);
        return;
      }
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Could not load contacts');
      setMeta(json.meta || {});
      applyContacts(json.contacts || []);
      setSetupRequired(false);
    } catch (error) {
      if (!cached) showAlert({ title: 'Contacts unavailable', message: error?.message || 'Could not load contacts.', type: 'error' });
    } finally {
      setLoading(false);
      endBackendSync();
    }
  }

  loadContactsRef.current = loadContacts;

  async function hardRefreshContacts() {
    if (hardRefreshing || hardRefreshLocked || setupRequired) return;
    setHardRefreshing(true);
    setHardRefreshLocked(true);
    if (hardRefreshTimerRef.current) clearTimeout(hardRefreshTimerRef.current);
    hardRefreshTimerRef.current = setTimeout(() => {
      setHardRefreshLocked(false);
      hardRefreshTimerRef.current = null;
    }, HARD_REFRESH_COOLDOWN_MS);
    try {
      await loadContacts({ silent: true, hard: true });
      showAlert({ title: 'Contacts refreshed', message: 'Loaded latest contacts from server.', type: 'success' });
    } finally {
      setHardRefreshing(false);
    }
  }

  function openDownloadContactsModal() {
    if (!contacts.length) {
      showAlert({ title: 'Nothing to download', message: 'No contacts available yet.', type: 'info' });
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    setDownloadNameDraft(`iClora-Contacts-${stamp}`);
    setDownloadModalOpen(true);
  }

  function closeDownloadContactsModal() {
    if (downloadingContacts) return;
    setDownloadModalOpen(false);
    setDownloadNameDraft('');
  }

  async function downloadAllContacts() {
    if (!contacts.length) {
      showAlert({ title: 'Nothing to download', message: 'No contacts available yet.', type: 'info' });
      return;
    }
    const zipName = sanitizeExportName(downloadNameDraft || 'iClora-Contacts', 'iClora-Contacts');
    setDownloadingContacts(true);
    showAlert({ title: 'Download initialized', message: 'Preparing contacts ZIP...', type: 'info' });
    try {
      const zip = new JSZip();
      const used = new Set();
      contacts.forEach((contact, index) => {
        const base = sanitizeExportName(contact.displayName || `Contact ${index + 1}`, `Contact ${index + 1}`);
        let name = base;
        let suffix = 2;
        while (used.has(name.toLowerCase())) {
          name = `${base} ${suffix}`;
          suffix += 1;
        }
        used.add(name.toLowerCase());
        zip.file(`${name}.vcf`, contactToVcf(contact));
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${zipName}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      showAlert({ title: 'Contacts downloaded', message: `${contacts.length} contacts exported as ZIP.`, type: 'success' });
      setDownloadModalOpen(false);
      setDownloadNameDraft('');
    } catch (error) {
      showAlert({ title: 'Download failed', message: error?.message || 'Could not export contacts.', type: 'error' });
    } finally {
      setDownloadingContacts(false);
    }
  }

  useEffect(() => {
    loadContactsRef.current?.({ silent: Boolean(initialContactsCacheRef.current) });

  }, []);

  function selectContact(contact) {
    setEditing(false);
    setDraft(EMPTY_DRAFT);
    resetDraftPhoto();
    setSelectedId(contact.id);
    selectedIdRef.current = contact.id;
    setMobilePane('detail');
    navigate(`/cloud/apps/contacts/u/${contact.id}`);
  }

  function startCreate() {
    const defaultDialCode = COUNTRY_DIAL_CODES[userCountryCode] || '+91';
    setCreateNameDraft('');
    setCreatePhoneDraft(`${defaultDialCode} `);
    resetCreatePhoto();
    setCreateModalOpen(true);
  }

  function closeCreateModal() {
    if (creatingContact) return;
    setCreateModalOpen(false);
    setCreateNameDraft('');
    setCreatePhoneDraft('');
    resetCreatePhoto();
  }

  useEffect(() => {
    if (!createModalOpen || !isOnlyDialCode(createPhoneDraft)) return;
    const defaultDialCode = COUNTRY_DIAL_CODES[userCountryCode] || '+91';
    if (createPhoneDraft.trim() !== defaultDialCode) setCreatePhoneDraft(`${defaultDialCode} `);
  }, [createModalOpen, createPhoneDraft, userCountryCode]);

  async function confirmCreateContact() {
    if (creatingContact) return;
    const displayName = createNameDraft.trim() || 'New Contact';
    const defaultDialCode = COUNTRY_DIAL_CODES[userCountryCode] || '+91';
    const phoneDraftTrimmed = sanitizePhoneInput(createPhoneDraft).trim();
    const phone = phoneDraftTrimmed === defaultDialCode ? '' : normalizePhoneForCountry(phoneDraftTrimmed, userCountryCode);
    const selectedPhotoFile = createPhotoFile;
    const selectedPhotoPreviewUrl = createPhotoPreviewUrl;
    const localId = `local-contact-${Date.now()}`;
    const now = new Date().toISOString();
    const optimisticContact = normalizeContact({
      id: localId,
      clientKey: localId,
      displayName,
      phone,
      photoUrl: selectedPhotoPreviewUrl,
      photoUploadPending: Boolean(selectedPhotoFile),
      createdAt: now,
      updatedAt: now,
    });
    const previousContacts = latestContactsRef.current;
    setCreatingContact(true);
    beginBackendSync();
    applyContacts([optimisticContact, ...previousContacts], { selectedId: localId, pinId: localId });
    setEditing(false);
    setDraft(EMPTY_DRAFT);
    resetDraftPhoto();
    setMobilePane('detail');
    setCreateModalOpen(false);
    setCreateNameDraft('');
    setCreatePhoneDraft('');
    resetCreatePhoto({ revoke: !selectedPhotoPreviewUrl });

    try {
      const response = await apiFetch('/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, phone }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok || !json?.contact) throw new Error(json?.error || 'Could not create contact');
      const savedContact = normalizeContact({
        ...json.contact,
        clientKey: localId,
        photoUrl: selectedPhotoPreviewUrl || json.contact.photoUrl || '',
        photoUploadPending: Boolean(selectedPhotoFile),
      });
      const currentContacts = latestContactsRef.current;
      const replacedContacts = currentContacts.some((contact) => contact.id === localId)
        ? currentContacts.map((contact) => (contact.id === localId ? savedContact : contact))
        : [savedContact, ...currentContacts];
      applyContacts(replacedContacts, {
        selectedId: selectedIdRef.current === localId ? savedContact.id : selectedIdRef.current,
        pinId: savedContact.id,
        dropIds: [localId],
      });
      if (selectedIdRef.current === savedContact.id) {
        navigate(`/cloud/apps/contacts/u/${savedContact.id}`, { replace: true });
      }
      syncUserProfileAfterStorageChange();
      if (selectedPhotoFile) {
        uploadContactPhotoInBackground(savedContact.id, selectedPhotoFile, {
          clientKey: localId,
          fallbackPreviewUrl: selectedPhotoPreviewUrl,
        });
      }
    } catch (error) {
      if (selectedPhotoPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(selectedPhotoPreviewUrl);
      const withoutOptimistic = latestContactsRef.current.filter((contact) => contact.id !== localId);
      applyContacts(withoutOptimistic, {
        selectedId: selectedIdRef.current === localId ? (withoutOptimistic[0]?.id || '') : selectedIdRef.current,
        dropIds: [localId],
      });
      navigate(withoutOptimistic[0] ? `/cloud/apps/contacts/u/${withoutOptimistic[0].id}` : '/cloud/apps/contacts/u', { replace: true });
      showAlert({ title: 'Contact failed', message: error?.message || 'Could not create contact.', type: 'error' });
    } finally {
      setCreatingContact(false);
      endBackendSync();
    }
  }

  function startEdit() {
    if (!selectedContact || selectedContact.system) return;
    setDraft(draftFromContact(selectedContact));
    resetDraftPhoto(selectedContact.photoUrl || '');
    setEditing(true);
    setMobilePane('detail');
  }

  async function shareContact() {
    if (!selectedContact) return;
    const lines = [
      selectedContact.displayName,
      selectedContact.company,
      selectedContact.phone ? `Phone: ${selectedContact.phone}` : '',
      ...normalizeExtraPhones(selectedContact.extraPhones).map((phone, index) => `Phone ${index + 2}: ${phone}`),
      selectedContact.email ? `Email: ${selectedContact.email}` : '',
      selectedContact.birthday ? `Birthday: ${formatBirthdayForDisplay(selectedContact.birthday) || selectedContact.birthday}` : '',
      selectedContact.address ? `Address: ${selectedContact.address}` : '',
      selectedContact.note ? `Notes: ${selectedContact.note}` : '',
    ].filter(Boolean);
    const text = lines.join('\n');
    try {
      if (navigator.share) {
        await navigator.share({ title: selectedContact.displayName, text });
        return;
      }
      await navigator.clipboard?.writeText(text);
      showAlert({ title: 'Contact copied', message: 'Contact details copied to clipboard.', type: 'success' });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      showAlert({ title: 'Share failed', message: 'Could not share this contact right now.', type: 'error' });
    }
  }

  function updateDraft(key, value) {
    setDraft((current) => ({ ...current, [key]: key === 'phone' ? sanitizePhoneInput(value) : value }));
  }

  function resetDraftPhoto(previewUrl = '') {
    if (photoPreviewObjectRef.current) {
      URL.revokeObjectURL(photoPreviewObjectRef.current);
      photoPreviewObjectRef.current = '';
    }
    setPhotoFile(null);
    setPhotoPreviewUrl(previewUrl);
  }

  function resetCreatePhoto(options = {}) {
    const shouldRevoke = options.revoke !== false;
    if (shouldRevoke && createPhotoObjectRef.current) {
      URL.revokeObjectURL(createPhotoObjectRef.current);
    }
    createPhotoObjectRef.current = '';
    setCreatePhotoFile(null);
    setCreatePhotoPreviewUrl('');
    setCropOpen(false);
    setCropLoaded(false);
    setCropReady(false);
    setCropTransform({ scale: 1, x: 0, y: 0 });
    setCropSourcePreviewUrl('');
  }

  function handlePhotoSelect(file) {
    if (!file) return;
    if (!file.type?.startsWith('image/')) {
      showAlert({ title: 'Photo failed', message: 'Please choose an image file.', type: 'error' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showAlert({ title: 'Photo too large', message: 'Please choose an image under 5 MB.', type: 'error' });
      return;
    }
    if (photoPreviewObjectRef.current) URL.revokeObjectURL(photoPreviewObjectRef.current);
    const nextPreview = URL.createObjectURL(file);
    photoPreviewObjectRef.current = nextPreview;
    setPhotoFile(file);
    setCropTarget('edit');
    setCropSourcePreviewUrl(nextPreview);
    setCropLoaded(false);
    setCropReady(false);
    setCropTransform({ scale: 1, x: 0, y: 0 });
    setCropOpen(true);
  }

  function handleCreatePhotoSelect(file) {
    if (!file) return;
    if (!file.type?.startsWith('image/')) {
      showAlert({ title: 'Photo failed', message: 'Please choose an image file.', type: 'error' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showAlert({ title: 'Photo too large', message: 'Please choose an image under 5 MB.', type: 'error' });
      return;
    }
    if (createPhotoObjectRef.current) URL.revokeObjectURL(createPhotoObjectRef.current);
    const nextPreview = URL.createObjectURL(file);
    createPhotoObjectRef.current = nextPreview;
    setCreatePhotoFile(file);
    setCropTarget('create');
    setCropSourcePreviewUrl(nextPreview);
    setCropLoaded(false);
    setCropReady(false);
    setCropTransform({ scale: 1, x: 0, y: 0 });
    setCropOpen(true);
  }

  function handleCropPointerDown(event) {
    if (!cropReady || cropping) return;
    cropDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: cropTransform.x,
      originY: cropTransform.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCropPointerMove(event) {
    const drag = cropDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = {
      ...cropTransform,
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    };
    setCropTransform(clampCropTransform(next, cropMetrics, {
      width: cropImageRef.current?.naturalWidth || 1,
      height: cropImageRef.current?.naturalHeight || 1,
    }));
  }

  function handleCropPointerUp(event) {
    const drag = cropDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    cropDragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {

    }
  }

  async function handleApplyCreatePhotoCrop() {
    if (!cropImageRef.current || !cropReady || cropping) return;
    setCropping(true);
    try {
      const sourceFile = cropTarget === 'create' ? createPhotoFile : photoFile;
      const baseName = (sourceFile?.name || 'contact-photo').replace(/\.[^/.]+$/, '');
      const outputMimeType = isPngFile(sourceFile) ? PNG_MIME_TYPE : 'image/webp';
      const nextFile = await cropImageForUpload(cropImageRef.current, cropTransform, cropMetrics, baseName, outputMimeType);
      const nextPreview = URL.createObjectURL(nextFile);
      if (cropTarget === 'create') {
        if (createPhotoObjectRef.current) URL.revokeObjectURL(createPhotoObjectRef.current);
        createPhotoObjectRef.current = nextPreview;
        setCreatePhotoFile(nextFile);
        setCreatePhotoPreviewUrl(nextPreview);
      } else {
        if (photoPreviewObjectRef.current) URL.revokeObjectURL(photoPreviewObjectRef.current);
        photoPreviewObjectRef.current = nextPreview;
        setPhotoFile(nextFile);
        setPhotoPreviewUrl(nextPreview);
      }
      setCropOpen(false);
      setCropSourcePreviewUrl('');
      setCropLoaded(false);
      setCropReady(false);
    } catch (error) {
      showAlert({ title: 'Crop failed', message: error?.message || 'Could not crop your photo.', type: 'error' });
    } finally {
      setCropping(false);
    }
  }

  async function uploadContactPhoto(contactId, file = photoFile) {
    if (!file || !contactId) return null;
    const formData = new FormData();
    formData.append('photo', file);
    const response = await apiFetch(`/contacts/${contactId}/photo`, {
      method: 'POST',
      body: formData,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json?.ok || !json?.contact) throw new Error(json?.error || 'Could not upload contact photo');
    return normalizeContact(json.contact);
  }

  function uploadContactPhotoInBackground(contactId, file, options = {}) {
    if (!contactId || !file) return;
    const { clientKey = contactId, fallbackPreviewUrl = '' } = options;
    let uploaded = false;
    beginBackendSync();
    uploadContactPhoto(contactId, file)
      .then((photoContact) => {
        if (!photoContact) return;
        uploaded = true;
        const nextContact = normalizeContact({
          ...photoContact,
          clientKey,
          photoUploadPending: false,
        });
        const nextContacts = latestContactsRef.current.map((contact) => (
          contact.id === contactId ? nextContact : contact
        ));
        applyContacts(nextContacts, {
          selectedId: selectedIdRef.current === contactId ? contactId : selectedIdRef.current,
        });
        syncUserProfileAfterStorageChange();
      })
      .catch((error) => {
        const nextContacts = latestContactsRef.current.map((contact) => (
          contact.id === contactId
            ? normalizeContact({
              ...contact,
              clientKey,
              photoUrl: fallbackPreviewUrl || contact.photoUrl,
              photoUploadPending: false,
            })
            : contact
        ));
        applyContacts(nextContacts, {
          selectedId: selectedIdRef.current === contactId ? contactId : selectedIdRef.current,
        });
        showAlert({
          title: 'Photo upload failed',
          message: error?.message || 'The contact was saved, but the photo could not upload. Try Edit > photo again.',
          type: 'error',
        });
      })
      .finally(() => {
        if (uploaded && fallbackPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(fallbackPreviewUrl);
        endBackendSync();
      });
  }

  async function saveContact() {
    if (saving) return;
    const payload = {
      ...draft,
      phone: normalizePhoneForCountry(sanitizePhoneInput(draft.phone), userCountryCode),
      extraPhones: normalizeExtraPhones(draft.extraPhones).map((phone) => normalizePhoneForCountry(phone, userCountryCode)),
      birthday: normalizeBirthday(draft.birthday),
      displayName: displayFromDraft(draft),
    };
    const isEdit = Boolean(selectedContact?.id);
    const optimisticId = selectedContact?.id || `local-contact-${Date.now()}`;
    const optimisticPhotoUrl = photoPreviewUrl || selectedContact?.photoUrl || '';
    const optimisticContact = normalizeContact({
      ...(selectedContact || {}),
      ...payload,
      id: optimisticId,
      clientKey: contactUiKey(selectedContact) || optimisticId,
      photoUrl: optimisticPhotoUrl,
      photoPublicId: selectedContact?.photoPublicId || '',
      photoUploadPending: Boolean(photoFile),
      system: Boolean(selectedContact?.system),
      createdAt: selectedContact?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const selectedPhotoFile = photoFile;
    const selectedPhotoPreviewUrl = optimisticPhotoUrl;
    const selectedClientKey = contactUiKey(optimisticContact);
    const previousPhotoObjectUrl = photoPreviewObjectRef.current;

    setSaving(true);
    beginBackendSync();
    const currentContacts = latestContactsRef.current;
    const optimisticContacts = isEdit
      ? currentContacts.map((contact) => (contact.id === optimisticId ? optimisticContact : contact))
      : [optimisticContact, ...currentContacts];
    applyContacts(optimisticContacts, { selectedId: optimisticId, pinId: optimisticId });
    setEditing(false);
    setDraft(EMPTY_DRAFT);
    setPhotoFile(null);
    setPhotoPreviewUrl('');
    photoPreviewObjectRef.current = '';
    setSaveConfirmOpen(false);
    navigate(`/cloud/apps/contacts/u/${optimisticId}`, { replace: true });

    try {
      const endpoint = isEdit ? `/contacts/${optimisticId}` : '/contacts';
      const response = await apiFetch(endpoint, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok || !json?.contact) throw new Error(json?.error || 'Could not save contact');
      let nextContact = normalizeContact({
        ...json.contact,
        clientKey: selectedClientKey,
        photoUrl: selectedPhotoPreviewUrl || json.contact.photoUrl || '',
        photoUploadPending: Boolean(selectedPhotoFile),
      });
      const photoContact = selectedPhotoFile ? await uploadContactPhoto(nextContact.id, selectedPhotoFile) : null;
      if (photoContact) nextContact = photoContact;
      const nextContacts = latestContactsRef.current.map((contact) => (
        contact.id === optimisticId || contactUiKey(contact) === selectedClientKey ? nextContact : contact
      ));
      applyContacts(nextContacts, {
        selectedId: selectedIdRef.current === optimisticId ? nextContact.id : selectedIdRef.current,
        dropIds: optimisticId !== nextContact.id ? [optimisticId] : [],
      });
      navigate(`/cloud/apps/contacts/u/${nextContact.id}`, { replace: true });
      syncUserProfileAfterStorageChange();
      if (previousPhotoObjectUrl?.startsWith('blob:') && photoContact) URL.revokeObjectURL(previousPhotoObjectUrl);
    } catch (error) {
      showAlert({
        title: 'Sync failed',
        message: error?.message || 'Your change is kept locally, but could not sync to server yet.',
        type: 'error',
      });
    } finally {
      setSaving(false);
      endBackendSync();
    }
  }

  async function deleteContact() {
    if (!selectedContact || selectedContact.system) return;
    setDeleteTarget({ id: selectedContact.id, name: selectedContact.displayName || 'Contact' });
  }

  function closeDeleteModal() {
    if (deleting) return;
    setDeleteTarget(null);
  }

  async function confirmDeleteContact() {
    if (!deleteTarget || deleting) return;
    const targetId = deleteTarget.id;
    const previousContacts = latestContactsRef.current;
    const nextContacts = previousContacts.filter((contact) => contact.id !== targetId);
    const nextSelected = nextContacts[0] || null;
    deletedContactIdsRef.current.add(targetId);
    setDeleting(true);
    beginBackendSync();
    applyContacts(nextContacts, { selectedId: nextSelected?.id || '', dropIds: [targetId] });
    setEditing(false);
    setDeleteTarget(null);
    navigate(nextSelected ? `/cloud/apps/contacts/u/${nextSelected.id}` : '/cloud/apps/contacts/u', { replace: true });

    try {
      if (targetId.startsWith('local-contact-')) return;
      const response = await apiFetch(`/contacts/${targetId}`, { method: 'DELETE' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 404) throw new Error(json?.error || 'Could not delete contact');
      syncUserProfileAfterStorageChange();
    } catch (error) {
      deletedContactIdsRef.current.delete(targetId);
      applyContacts(previousContacts, { selectedId: targetId });
      navigate(`/cloud/apps/contacts/u/${targetId}`, { replace: true });
      showAlert({ title: 'Delete failed', message: error?.message || 'Could not delete contact.', type: 'error' });
    } finally {
      setDeleting(false);
      endBackendSync();
    }
  }

  async function activateContacts() {
    if (setupLoading) return;
    setSetupLoading(true);
    beginBackendSync();
    try {
      const response = await apiFetch('/contacts/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Could not activate Contacts');
      setSetupRequired(false);
      await loadContacts({ silent: true });
      syncUserProfileAfterStorageChange();
    } catch (error) {
      showAlert({ title: 'Contacts setup failed', message: error?.message || 'Could not activate Contacts right now.', type: 'error' });
    } finally {
      setSetupLoading(false);
      setLoading(false);
      endBackendSync();
    }
  }

  const detailContact = editing ? { ...selectedContact, ...draft, displayName: displayFromDraft(draft) } : selectedContact;
  const cropImageSize = {
    width: cropImageRef.current?.naturalWidth || 1,
    height: cropImageRef.current?.naturalHeight || 1,
  };
  const cropLayout = getCropDisplay(cropMetrics, cropTransform, cropImageSize);
  const navbarSyncing = backendSyncing || loading || saving || creatingContact || deleting || setupLoading || cropping;

  return (
    <main className={`iclora-contacts iclora-contacts--pane-${mobilePane}`} aria-label="iClora Contacts">
      <DashboardNavbar
        user={user}
        accentColor={accentColor}
        showBack={true}
        onBack={() => navigate('/cloud')}
        whiteBackground={true}
        appLabel="Contacts"
        appLabelColor="#3478e5"
        appIcon="/apps/contacts.webp"
        appIconDark="/apps/contacts-dark.webp"
        appSyncing={navbarSyncing}
        appSyncLabel={loading ? 'Loading contacts' : 'Syncing contacts'}
      />

      <section className="iclora-contacts__shell">
        <section className={`iclora-contacts__list-pane ${mobilePane === 'list' ? 'is-mobile-active' : ''}`}>
          <div className="iclora-contacts__list-toolbar">
            <strong className="iclora-contacts__list-title">
              <picture>
                <source srcSet="/apps/contacts-dark.webp" media="(prefers-color-scheme: dark)" />
                <img src="/apps/contacts.webp" alt="" aria-hidden="true" className="iclora-contacts__list-title-icon" />
              </picture>
              <span>Contacts</span>
            </strong>
            <span className="iclora-contacts__list-toolbar-actions">
              <button
                type="button"
                className="iclora-contacts__icon-button"
                aria-label="Download all contacts"
                onClick={openDownloadContactsModal}
                title="Download Contacts ZIP"
              >
                <DownloadIcon size={18} />
              </button>
              <button
                type="button"
                className="iclora-contacts__icon-button iclora-contacts__list-add-mobile is-mobile-only"
                aria-label="New contact"
                onClick={startCreate}
              >
                <FiPlus />
              </button>
            </span>
          </div>

          <label className="iclora-contacts__search">
            <FiSearch />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search All Contacts" />
          </label>

          <div className="iclora-contacts__list">
            {loading ? (
              <div className="iclora-contacts__empty-list iclora-contacts__empty-list--loading">
                <AppleLoader className="iclora-contacts__list-loader" size={32} hidden={false} label="Loading contacts" />
              </div>
            ) : pinnedContacts.length || groupedContacts.length ? (
              <>
                {pinnedContacts.length ? (
                  <div className="iclora-contacts__pinned">
                    <div className="iclora-contacts__section-title">Pinned</div>
                    {pinnedContacts.map((contact) => (
                      <button
                        type="button"
                        key={contact.clientKey || contact.id}
                        className={`iclora-contacts__row iclora-contacts__row--pinned ${contact.id === selectedId ? 'is-active' : ''}`}
                        onClick={() => selectContact(contact)}
                      >
                        <span>{contact.displayName}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {groupedContacts.map((group) => (
                  <div className="iclora-contacts__group-block" key={group.letter}>
                    <div className="iclora-contacts__letter">{group.letter}</div>
                    {group.contacts.map((contact) => (
                      <button
                        type="button"
                        key={contact.clientKey || contact.id}
                        className={`iclora-contacts__row ${contact.id === selectedId ? 'is-active' : ''}`}
                        onClick={() => selectContact(contact)}
                      >
                        <span>{contact.displayName}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </>
            ) : (
              <div className="iclora-contacts__empty-list">{setupRequired ? 'Contacts Cloud needs setup.' : 'No contacts yet.'}</div>
            )}
          </div>
        </section>

        <section className={`iclora-contacts__detail ${mobilePane === 'detail' ? 'is-mobile-active' : ''}`}>
          <div className="iclora-contacts__detail-toolbar">
            <div className="iclora-contacts__detail-actions iclora-contacts__detail-actions--left">
              <button type="button" className="iclora-contacts__link is-mobile-only" onClick={() => setMobilePane('list')}>
                <FiChevronLeft />
                Contacts
              </button>
              {!setupRequired && editing ? (
                <button type="button" className="iclora-contacts__link iclora-contacts__cancel-link" onClick={() => { setEditing(false); setDraft(EMPTY_DRAFT); }} disabled={saving}>
                  <FiX />
                  <span className="iclora-contacts__cancel-label">Cancel</span>
                </button>
              ) : (
                <button type="button" className="iclora-contacts__link" onClick={startEdit} disabled={!selectedContact || selectedContact.system}>
                  Edit
                </button>
              )}
            </div>
            {!setupRequired && !editing ? (
              <div className="iclora-contacts__detail-actions iclora-contacts__detail-actions--right">
                <button
                  type="button"
                  className="iclora-contacts__icon-button iclora-contacts__refresh-btn"
                  aria-label="Hard refresh contacts"
                  onClick={hardRefreshContacts}
                  disabled={hardRefreshing || hardRefreshLocked}
                >
                  <FiRefreshCw className={hardRefreshing ? 'is-spinning' : ''} />
                </button>
                <button type="button" className="iclora-contacts__icon-button" aria-label="Share contact" onClick={shareContact} disabled={!selectedContact}>
                  <ShareIcon />
                </button>
                <button
                  type="button"
                  className="iclora-contacts__icon-button iclora-contacts__delete-top-btn"
                  aria-label="Delete contact"
                  onClick={deleteContact}
                  disabled={!selectedContact || selectedContact.system || deleting}
                >
                  <FiTrash2 />
                </button>
                <button type="button" className="iclora-contacts__icon-button" aria-label="New contact" onClick={startCreate}>
                  <FiPlus />
                </button>
              </div>
            ) : <span />}
          </div>

          {setupRequired ? (
            <div className="iclora-contacts__setup">
              <picture>
                <source srcSet="/apps/contacts-dark.webp" media="(prefers-color-scheme: dark)" />
                <img src="/apps/contacts.webp" alt="" aria-hidden="true" />
              </picture>
              <h1>Setup iClora Contacts</h1>
              <p>Your contacts cloud will be ready for names, phone numbers, emails, and quick notes.</p>
              <button type="button" onClick={activateContacts} disabled={setupLoading}>
                {setupLoading ? 'Activating...' : 'Activate Contacts'}
              </button>
            </div>
          ) : editing ? (
            <ContactEditor
              draft={draft}
              photoPreviewUrl={photoPreviewUrl}
              saving={saving}
              countryCode={userCountryCode}
              onChange={updateDraft}
              onPhotoSelect={handlePhotoSelect}
              onSave={() => setSaveConfirmOpen(true)}
            />
          ) : detailContact ? (
            <ContactDetail key={detailContact.id || 'contact-detail'} contact={detailContact} />
          ) : (
            <div className="iclora-contacts__blank">
              <div className="iclora-contacts__blank-loader" aria-hidden="true" />
              <p>Select a contact or create a new one.</p>
              <button type="button" onClick={startCreate}>New Contact</button>
            </div>
          )}
        </section>
      </section>

      {createModalOpen ? (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={closeCreateModal}>
          <section className="manage-account__name-modal iclora-contacts__name-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="manage-account__modal-close" aria-label="Close contact dialog" onClick={closeCreateModal} disabled={creatingContact}>
              <FiChevronLeft />
            </button>
            <div className="manage-account__modal-icon iclora-contacts__confirm-icon" aria-hidden="true">
              <picture>
                <source srcSet="/apps/contacts-dark.webp" media="(prefers-color-scheme: dark)" />
                <img src="/apps/contacts.webp" alt="" />
              </picture>
            </div>
            <h2>Create New Contact</h2>
            <div className="iclora-contacts__create-fields">
              <label className="iclora-contacts__create-photo">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => handleCreatePhotoSelect(event.target.files?.[0])}
                  disabled={creatingContact}
                />
                <span className="iclora-contacts__create-photo-preview" aria-hidden="true">
                  {createPhotoPreviewUrl ? <img src={createPhotoPreviewUrl} alt="" /> : <FiCamera />}
                </span>
                <span>
                  <strong>{createPhotoPreviewUrl ? 'Change photo' : 'Add profile photo'}</strong>
                  <small>Crop before saving to Server.</small>
                </span>
              </label>
              <label className="iclora-contacts__modal-field">
                <span>Name</span>
                <input
                  className="iclora-contacts__modal-input"
                  value={createNameDraft}
                  onChange={(event) => setCreateNameDraft(event.target.value)}
                  autoFocus
                  maxLength={CONTACT_FIELD_LIMITS.displayName}
                  aria-label="Contact name"
                  placeholder="New Contact"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      confirmCreateContact();
                    }
                  }}
                />
              </label>
              <label className="iclora-contacts__modal-field">
                <span>Phone</span>
                <input
                  className="iclora-contacts__modal-input"
                  value={createPhoneDraft}
                  onChange={(event) => setCreatePhoneDraft(sanitizePhoneInput(event.target.value))}
                  onBlur={() => setCreatePhoneDraft((value) => normalizePhoneForCountry(value, userCountryCode))}
                  maxLength={CONTACT_FIELD_LIMITS.phone}
                  aria-label="Contact phone number"
                  placeholder={`${COUNTRY_DIAL_CODES[userCountryCode] || '+91'} phone number`}
                  inputMode="tel"
                />
              </label>
            </div>
            <div className="manage-account__delete-actions">
              <button type="button" className="manage-account__delete-button manage-account__delete-button--cancel iclora-contacts__modal-button" onClick={closeCreateModal} disabled={creatingContact}>Cancel</button>
              <button type="button" className="manage-account__delete-button iclora-contacts__modal-button--create" onClick={confirmCreateContact} disabled={creatingContact}>
                {creatingContact ? 'Creating...' : 'Create'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {downloadModalOpen ? (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={closeDownloadContactsModal}>
          <section className="manage-account__name-modal iclora-contacts__name-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="manage-account__modal-close" aria-label="Close download dialog" onClick={closeDownloadContactsModal} disabled={downloadingContacts}>
              <FiChevronLeft />
            </button>
            <div className="manage-account__modal-icon iclora-contacts__confirm-icon" aria-hidden="true"><DownloadIcon size={46} /></div>
            <h2>Download Contacts</h2>
            <label className="iclora-contacts__modal-field">
              <span>ZIP Name</span>
              <input
                className="iclora-contacts__modal-input"
                value={downloadNameDraft}
                onChange={(event) => setDownloadNameDraft(event.target.value)}
                maxLength={90}
                autoFocus
                aria-label="Contacts zip name"
                placeholder="iClora-Contacts"
              />
            </label>
            <div className="manage-account__delete-actions">
              <button type="button" className="manage-account__delete-button manage-account__delete-button--cancel iclora-contacts__modal-button" onClick={closeDownloadContactsModal} disabled={downloadingContacts}>Cancel</button>
              <button type="button" className="manage-account__delete-button iclora-contacts__modal-button--create" onClick={downloadAllContacts} disabled={downloadingContacts} aria-busy={downloadingContacts}>
                {downloadingContacts ? 'Downloading...' : 'Download'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {saveConfirmOpen ? (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={() => { if (!saving) setSaveConfirmOpen(false); }}>
          <section className="manage-account__name-modal manage-account__delete-modal iclora-contacts__confirm-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="manage-account__modal-close" aria-label="Close save confirmation" onClick={() => setSaveConfirmOpen(false)} disabled={saving}>
              <FiChevronLeft />
            </button>
            <div className="manage-account__modal-icon iclora-contacts__confirm-icon" aria-hidden="true"><FiAlertTriangle /></div>
            <h2>Save Contact?</h2>
            <p className="manage-account__delete-copy">Do you want to save these contact changes now?</p>
            <div className="manage-account__delete-actions">
              <button type="button" className="manage-account__delete-button manage-account__delete-button--cancel" onClick={() => setSaveConfirmOpen(false)} disabled={saving}>No</button>
              <button type="button" className="manage-account__delete-button manage-account__delete-button--verified" onClick={saveContact} disabled={saving} aria-busy={saving}>
                {saving ? <span className="manage-account__button-spinner" aria-hidden="true" /> : 'Yes'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {cropOpen && cropSourcePreviewUrl ? (
        <div className="manage-account__modal-layer manage-account__crop-layer" role="presentation">
          <section
            className="manage-account__crop-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="contacts-photo-crop-title"
            aria-describedby="contacts-photo-crop-copy"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="manage-account__crop-head">
              <div>
                <h2 id="contacts-photo-crop-title">Crop Photo</h2>
                <p id="contacts-photo-crop-copy">Drag to reposition and use zoom for a clean contact photo.</p>
              </div>
              <button
                type="button"
                className="manage-account__crop-close"
                aria-label="Close crop editor"
                onClick={() => { setCropOpen(false); setCropSourcePreviewUrl(''); }}
                disabled={cropping}
              >
                ×
              </button>
            </div>
            <div
              ref={cropViewportRef}
              className="manage-account__crop-viewport"
              onPointerDown={handleCropPointerDown}
              onPointerMove={handleCropPointerMove}
              onPointerUp={handleCropPointerUp}
              onPointerCancel={handleCropPointerUp}
              style={{ cursor: cropping ? 'progress' : 'grab' }}
            >
              <img
                ref={cropImageRef}
                className="manage-account__crop-image"
                src={cropSourcePreviewUrl}
                alt="Crop source"
                onLoad={() => setCropLoaded(true)}
                draggable={false}
                style={{
                  width: `${cropLayout.displayW}px`,
                  height: `${cropLayout.displayH}px`,
                  left: '50%',
                  top: '50%',
                  transform: `translate(-50%, -50%) translate(${cropLayout.offsetX}px, ${cropLayout.offsetY}px)`,
                }}
              />
              <div className="manage-account__crop-frame" aria-hidden="true" />
            </div>
            <div className="manage-account__crop-zoom-row">
              <span>Zoom</span>
              <input
                type="range"
                min={MIN_CROP_SCALE}
                max={MAX_CROP_SCALE}
                step="0.01"
                value={cropTransform.scale}
                onChange={(event) => {
                  const next = { ...cropTransform, scale: Number(event.target.value) };
                  setCropTransform(clampCropTransform(next, cropMetrics, {
                    width: cropImageRef.current?.naturalWidth || 1,
                    height: cropImageRef.current?.naturalHeight || 1,
                  }));
                }}
                disabled={!cropReady || cropping}
                aria-label="Zoom crop"
              />
            </div>
            <div className="manage-account__crop-actions">
              <button
                type="button"
                className="manage-account__crop-button-secondary"
                onClick={() => { setCropOpen(false); setCropSourcePreviewUrl(''); }}
                disabled={cropping}
              >
                Cancel
              </button>
              <button
                type="button"
                className="manage-account__crop-button-primary"
                onClick={handleApplyCreatePhotoCrop}
                disabled={!cropReady || cropping}
                aria-busy={cropping}
              >
                {cropping ? <span className="manage-account__button-spinner" aria-hidden="true" /> : 'Use Crop'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={closeDeleteModal}>
          <section className="manage-account__name-modal manage-account__delete-modal iclora-contacts__confirm-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="manage-account__modal-close" aria-label="Close delete confirmation" onClick={closeDeleteModal} disabled={deleting}>
              <FiChevronLeft />
            </button>
            <div className="manage-account__modal-icon iclora-contacts__confirm-icon" aria-hidden="true"><FiAlertTriangle /></div>
            <h2>Are you sure?</h2>
            <p className="manage-account__delete-copy">
              Delete contact "{deleteTarget.name}"?
            </p>
            <div className="manage-account__delete-actions">
              <button type="button" className="manage-account__delete-button manage-account__delete-button--cancel" onClick={closeDeleteModal} disabled={deleting}>No</button>
              <button type="button" className="manage-account__delete-button manage-account__delete-button--danger" onClick={confirmDeleteContact} disabled={deleting}>{deleting ? 'Deleting...' : 'Yes'}</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function ContactDetail({ contact }) {
  const showCloudAvatar = !contact.photoUrl && (contact.system || /iclora/i.test(contact.displayName || ''));
  return (
    <div className="iclora-contacts__contact-card">
      <div className="iclora-contacts__identity">
        <div className="iclora-contacts__avatar" aria-hidden="true">
          {contact.photoUrl
            ? <img key={contact.id || contact.photoUrl} src={contact.photoUrl} alt="" decoding="async" />
            : (showCloudAvatar ? <img src="/pwa-icon-512.webp" alt="" decoding="async" /> : initials(contact))}
        </div>
        <div>
          <h1>{contact.displayName}</h1>
          {contact.photoUploadPending ? <p className="iclora-contacts__sync-copy">Saving photo in background...</p> : null}
          {contact.company ? <p>{contact.company}</p> : null}
        </div>
      </div>

      <div className="iclora-contacts__fields">
        {contact.phone ? <ContactField icon={<IoCall />} label="Phone" value={contact.phone} href={`tel:${contact.phone}`} /> : null}
        {normalizeExtraPhones(contact.extraPhones).map((phone, index) => (
          <ContactField key={`${phone}-${index}`} icon={<IoCall />} label={`Phone ${index + 2}`} value={phone} href={`tel:${phone}`} />
        ))}
        {contact.email ? <ContactField icon={<FiMail />} label="Email" value={contact.email} href={`mailto:${contact.email}`} /> : null}
        {contact.birthday ? <ContactField icon={<FiCalendar />} label="Birthday" value={formatBirthdayForDisplay(contact.birthday) || contact.birthday} /> : null}
        {contact.address ? <ContactField icon={<FiMapPin />} label="Address" value={contact.address} /> : null}
        {contact.note ? <ContactField icon={<FiMenu />} label="Notes" value={contact.note} /> : null}
      </div>

    </div>
  );
}

function ContactField({ icon, label, value, href }) {
  const content = href ? <a href={href}>{value}</a> : <span>{value}</span>;
  return (
    <div className="iclora-contacts__field">
      <div className="iclora-contacts__field-icon">{icon}</div>
      <div>
        <span>{label}</span>
        {content}
      </div>
    </div>
  );
}

function ContactEditor({ draft, photoPreviewUrl, saving, countryCode, onChange, onPhotoSelect, onSave }) {
  const extraPhones = Array.isArray(draft.extraPhones) ? draft.extraPhones : [];
  function updateExtraPhone(index, value) {
    const next = [...extraPhones];
    next[index] = sanitizePhoneInput(value);
    onChange('extraPhones', next);
  }
  function blurExtraPhone(index) {
    const next = [...extraPhones];
    next[index] = normalizePhoneForCountry(next[index], countryCode);
    onChange('extraPhones', next);
  }
  function addExtraPhone() {
    if (extraPhones.length >= 4) return;
    onChange('extraPhones', [...extraPhones, '']);
  }
  function removeExtraPhone(index) {
    onChange('extraPhones', extraPhones.filter((_phone, phoneIndex) => phoneIndex !== index));
  }

  return (
    <form className="iclora-contacts__editor" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <div className="iclora-contacts__editor-head">
        <label className="iclora-contacts__photo-picker">
          <input type="file" accept="image/*" onChange={(event) => onPhotoSelect(event.target.files?.[0])} disabled={saving} />
          <span className="iclora-contacts__photo-preview" aria-hidden="true">
            {photoPreviewUrl ? <img src={photoPreviewUrl} alt="" /> : <FiCamera />}
          </span>
        </label>
        <h1>{displayFromDraft(draft)}</h1>
      </div>
      <div className="iclora-contacts__editor-grid">
        <ContactInput label="Display name" value={draft.displayName} maxLength={CONTACT_FIELD_LIMITS.displayName} onChange={(value) => onChange('displayName', value)} autoFocus />
        <ContactInput label="First name" value={draft.firstName} maxLength={CONTACT_FIELD_LIMITS.firstName} onChange={(value) => onChange('firstName', value)} />
        <ContactInput label="Last name" value={draft.lastName} maxLength={CONTACT_FIELD_LIMITS.lastName} onChange={(value) => onChange('lastName', value)} />
        <ContactInput label="Company" value={draft.company} maxLength={CONTACT_FIELD_LIMITS.company} onChange={(value) => onChange('company', value)} />
        <ContactInput
          label="Phone"
          value={draft.phone}
          maxLength={CONTACT_FIELD_LIMITS.phone}
          onChange={(value) => onChange('phone', value)}
          onBlur={() => onChange('phone', normalizePhoneForCountry(draft.phone, countryCode))}
          inputMode="tel"
        />
        {extraPhones.map((phone, index) => (
          <label className="iclora-contacts__input iclora-contacts__extra-phone" key={`extra-phone-${index}`}>
            <span>{`Phone ${index + 2}`}</span>
            <span className="iclora-contacts__extra-phone-row">
              <input
                value={phone}
                maxLength={CONTACT_FIELD_LIMITS.phone}
                onChange={(event) => updateExtraPhone(index, event.target.value)}
                onBlur={() => blurExtraPhone(index)}
                inputMode="tel"
              />
              <button type="button" aria-label={`Remove phone ${index + 2}`} onClick={() => removeExtraPhone(index)}>
                <FiX />
              </button>
            </span>
          </label>
        ))}
        <button
          type="button"
          className="iclora-contacts__add-phone"
          onClick={addExtraPhone}
          disabled={extraPhones.length >= 4}
        >
          <FiPlus />
          <span>{extraPhones.length >= 4 ? 'Phone limit reached' : 'Add phone'}</span>
        </button>
        <ContactInput label="Email" value={draft.email} maxLength={CONTACT_FIELD_LIMITS.email} onChange={(value) => onChange('email', value)} inputMode="email" />
        <BirthdayPicker value={draft.birthday} onChange={(value) => onChange('birthday', value)} />
        <ContactInput label="Address" value={draft.address} maxLength={CONTACT_FIELD_LIMITS.address} onChange={(value) => onChange('address', value)} />
        <label className="iclora-contacts__input iclora-contacts__input--wide">
          <span>Notes</span>
          <textarea value={draft.note} maxLength={CONTACT_FIELD_LIMITS.note} onChange={(event) => onChange('note', event.target.value)} rows={4} />
        </label>
      </div>
      <button type="submit" className="iclora-contacts__save" disabled={saving}>
        {saving ? 'Saving...' : 'Save Contact'}
      </button>
    </form>
  );
}

function BirthdayPicker({ value, onChange }) {
  const selectedDate = useMemo(() => birthdayDateFromValue(value), [value]);
  const today = new Date();
  const currentYear = today.getFullYear();
  const years = useMemo(() => {
    const list = [];
    for (let year = currentYear; year >= currentYear - 120; year -= 1) list.push(year);
    return list;
  }, [currentYear]);
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => selectedDate || today);
  const pickerRef = useRef(null);

  useEffect(() => {
    if (selectedDate) setViewDate(selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    if (!open) return undefined;
    function closeOnOutside(event) {
      const target = event.target;
      if (target instanceof Node && pickerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('pointerdown', closeOnOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const monthStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());
  const days = Array.from({ length: 42 }, (_item, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });

  function setMonth(delta) {
    setViewDate((date) => new Date(date.getFullYear(), date.getMonth() + delta, 1));
  }

  function setMonthNumber(month) {
    setViewDate((date) => new Date(date.getFullYear(), Number(month), 1));
  }

  function setYearNumber(year) {
    setViewDate((date) => new Date(Number(year), date.getMonth(), 1));
  }

  function selectDate(date) {
    onChange(formatBirthdayValue(date));
    setViewDate(date);
    setOpen(false);
  }

  return (
    <label className="iclora-contacts__input iclora-contacts__birthday-field" ref={pickerRef}>
      <span>Birthday</span>
      <button
        type="button"
        className={`iclora-contacts__birthday-trigger ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((next) => !next)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span>{formatBirthdayForDisplay(value) || 'Add birthday'}</span>
        <FiCalendar />
      </button>
      {open ? (
        <div className="iclora-contacts__birthday-popover" role="dialog" aria-label="Choose birthday">
          <div className="iclora-contacts__birthday-head">
            <button type="button" aria-label="Previous month" onClick={() => setMonth(-1)}>
              <FiChevronLeft />
            </button>
            <div className="iclora-contacts__birthday-selectors">
              <select value={viewDate.getMonth()} onChange={(event) => setMonthNumber(event.target.value)} aria-label="Birthday month">
                {Array.from({ length: 12 }, (_item, month) => (
                  <option value={month} key={month}>{monthLabel(new Date(2026, month, 1))}</option>
                ))}
              </select>
              <select value={viewDate.getFullYear()} onChange={(event) => setYearNumber(event.target.value)} aria-label="Birthday year">
                {years.map((year) => <option value={year} key={year}>{year}</option>)}
              </select>
            </div>
            <button type="button" aria-label="Next month" onClick={() => setMonth(1)}>
              <FiChevronRight />
            </button>
          </div>
          <div className="iclora-contacts__birthday-weekdays" aria-hidden="true">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
          </div>
          <div className="iclora-contacts__birthday-grid">
            {days.map((date) => {
              const iso = formatBirthdayValue(date);
              const active = value === iso;
              const muted = date.getMonth() !== viewDate.getMonth();
              const isToday = formatBirthdayValue(today) === iso;
              return (
                <button
                  type="button"
                  key={iso}
                  className={`${active ? 'is-active' : ''} ${muted ? 'is-muted' : ''} ${isToday ? 'is-today' : ''}`}
                  onClick={() => selectDate(date)}
                  aria-label={formatBirthdayForDisplay(iso) || iso}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div className="iclora-contacts__birthday-actions">
            <button type="button" onClick={() => { onChange(''); setOpen(false); }}>Clear</button>
            <button type="button" onClick={() => selectDate(today)}>Today</button>
          </div>
        </div>
      ) : null}
    </label>
  );
}

function ContactInput({ label, value, onChange, onBlur, maxLength, autoFocus = false, inputMode = 'text', placeholder = '', type = 'text' }) {
  return (
    <label className="iclora-contacts__input">
      <span>{label}</span>
      <input
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        autoFocus={autoFocus}
        inputMode={inputMode}
        placeholder={placeholder}
        type={type}
      />
    </label>
  );
}
