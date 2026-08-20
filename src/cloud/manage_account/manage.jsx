import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot } from 'firebase/firestore';
import { reauthenticateWithPopup, signInWithPopup } from 'firebase/auth';
import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import {
  FiCalendar,
  FiCrop,
  FiCheckCircle,
  FiGlobe,
  FiInfo,
  FiKey,
  FiMail,
  FiMonitor,
  FiShield,
  FiSmartphone,
  FiTrash2,
  FiUser,
  FiX,
} from 'react-icons/fi';
import DashboardNavbar from '../dashboardnavbar';
import { apiFetch, isStaleSessionResponse } from '../../api/backendapi';
import { readSessionExpiresAt, readSessionToken } from '../../auth/authCache';
import { clearSignedOutData } from '../../auth/sessionCleanup';
import { getFirebaseDb, getGoogleAuthDependencies } from '../../auth/firebase';
import { readUserProfileCache, writeUserProfileCache } from '../userProfileCache';
import { readDeviceActivityCache, writeDeviceActivityCache } from '../deviceActivityCache';
import { readPasskeyCache, writePasskeyCache } from '../passkeyCache';
import { readAccentColorCache } from '../themeCache';
import { useAlert } from '../../alert/alert';
import './manage.css';

const sidebarItems = [
  'Personal Information',
  'Passkeys',
  'Devices',
  'Privacy',
];

const NOT_SET = 'Not set';
const MAX_PASSKEYS = 4;
const MIN_CROP_SCALE = 0.5;
const MAX_CROP_SCALE = 2.5;
const PNG_MIME_TYPE = 'image/png';
const LOGIN_ACTIVITY_COLLECTION = 'login activity';
const SESSION_ACTIVE_COLLECTION = 'session active';
const SESSION_EXPIRED_COLLECTION = 'session expired';
const DELETE_CONFIRMATION_PHRASE = 'DELETE MY ACCOUNT';
const COOKIE_ICON_SRC = 'https://cdn-icons-png.flaticon.com/512/6595/6595757.png';
const DELETE_ACCOUNT_REASONS = [
  { value: 'app_issue', label: 'App issue', detail: 'Something did not work as expected.' },
  { value: 'app_crashing', label: 'App crashing', detail: 'iClora crashed or failed on this device.' },
  { value: 'not_optimized', label: 'Not optimized', detail: 'The web experience did not feel right on my device.' },
  { value: 'privacy_concern', label: 'Privacy concern', detail: 'I have a privacy or account safety concern.' },
  { value: 'not_useful', label: 'Not using iClora', detail: 'I no longer need this account.' },
  { value: 'switching_service', label: 'Switching service', detail: 'I am moving to another product.' },
  { value: 'other', label: 'Other reason', detail: 'Share anything else we should know.' },
];

function isPngFile(file) {
  return String(file?.type || '').toLowerCase() === PNG_MIME_TYPE;
}

async function convertImageToWebp(file, { maxSize = 1024, quality = 0.86 } = {}) {
  if (!file?.type?.startsWith('image/')) {
    throw new Error('Please select an image file.');
  }

  const srcUrl = URL.createObjectURL(file);
  try {
    const bitmap = typeof createImageBitmap === 'function'
      ? await createImageBitmap(file, { imageOrientation: 'from-image' })
      : await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not load image.'));
        img.src = srcUrl;
      });

    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const targetW = Math.max(1, Math.round(bitmap.width * scale));
    const targetH = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Could not process image.');
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);

    const blob = await new Promise((resolve) => {
      canvas.toBlob((nextBlob) => resolve(nextBlob), 'image/webp', quality);
    });
    if (!blob) throw new Error('WebP conversion failed.');

    const baseName = (file.name || 'profile-photo').replace(/\.[^/.]+$/, '');
    return new File([blob], `${baseName}.webp`, { type: 'image/webp' });
  } finally {
    URL.revokeObjectURL(srcUrl);
  }
}

async function prepareUploadFile(file) {
  if (!file?.type?.startsWith('image/')) {
    throw new Error('Please select an image file.');
  }
  if (isPngFile(file)) return file;
  return convertImageToWebp(file);
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
  const displayW = imageSize.width * metrics.baseScale * transform.scale;
  const displayH = imageSize.height * metrics.baseScale * transform.scale;
  return {
    displayW,
    displayH,
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

  const quality = outputMimeType === PNG_MIME_TYPE ? undefined : 0.92;
  const blob = await new Promise((resolve) => {
    canvas.toBlob((nextBlob) => resolve(nextBlob), outputMimeType, quality);
  });
  if (!blob) throw new Error('Crop export failed.');

  const extension = outputMimeType === PNG_MIME_TYPE ? 'png' : 'webp';
  return new File([blob], `${baseName}-cropped.${extension}`, { type: outputMimeType });
}

const monthOptions = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const countryCodes = [
  'AF', 'AX', 'AL', 'DZ', 'AS', 'AD', 'AO', 'AI', 'AQ', 'AG', 'AR', 'AM', 'AW', 'AU', 'AT', 'AZ',
  'BS', 'BH', 'BD', 'BB', 'BY', 'BE', 'BZ', 'BJ', 'BM', 'BT', 'BO', 'BQ', 'BA', 'BW', 'BV', 'BR',
  'IO', 'BN', 'BG', 'BF', 'BI', 'CV', 'KH', 'CM', 'CA', 'KY', 'CF', 'TD', 'CL', 'CN', 'CX', 'CC',
  'CO', 'KM', 'CG', 'CD', 'CK', 'CR', 'CI', 'HR', 'CU', 'CW', 'CY', 'CZ', 'DK', 'DJ', 'DM', 'DO',
  'EC', 'EG', 'SV', 'GQ', 'ER', 'EE', 'SZ', 'ET', 'FK', 'FO', 'FJ', 'FI', 'FR', 'GF', 'PF', 'TF',
  'GA', 'GM', 'GE', 'DE', 'GH', 'GI', 'GR', 'GL', 'GD', 'GP', 'GU', 'GT', 'GG', 'GN', 'GW', 'GY',
  'HT', 'HM', 'VA', 'HN', 'HK', 'HU', 'IS', 'IN', 'ID', 'IR', 'IQ', 'IE', 'IM', 'IL', 'IT', 'JM',
  'JP', 'JE', 'JO', 'KZ', 'KE', 'KI', 'KP', 'KR', 'KW', 'KG', 'LA', 'LV', 'LB', 'LS', 'LR', 'LY',
  'LI', 'LT', 'LU', 'MO', 'MG', 'MW', 'MY', 'MV', 'ML', 'MT', 'MH', 'MQ', 'MR', 'MU', 'YT', 'MX',
  'FM', 'MD', 'MC', 'MN', 'ME', 'MS', 'MA', 'MZ', 'MM', 'NA', 'NR', 'NP', 'NL', 'NC', 'NZ', 'NI',
  'NE', 'NG', 'NU', 'NF', 'MK', 'MP', 'NO', 'OM', 'PK', 'PW', 'PS', 'PA', 'PG', 'PY', 'PE', 'PH',
  'PN', 'PL', 'PT', 'PR', 'QA', 'RE', 'RO', 'RU', 'RW', 'BL', 'SH', 'KN', 'LC', 'MF', 'PM', 'VC',
  'WS', 'SM', 'ST', 'SA', 'SN', 'RS', 'SC', 'SL', 'SG', 'SX', 'SK', 'SI', 'SB', 'SO', 'ZA', 'GS',
  'SS', 'ES', 'LK', 'SD', 'SR', 'SJ', 'SE', 'CH', 'SY', 'TW', 'TJ', 'TZ', 'TH', 'TL', 'TG', 'TK',
  'TO', 'TT', 'TN', 'TR', 'TM', 'TC', 'TV', 'UG', 'UA', 'AE', 'GB', 'US', 'UM', 'UY', 'UZ', 'VU',
  'VE', 'VN', 'VG', 'VI', 'WF', 'EH', 'YE', 'ZM', 'ZW',
];

const countryOptions = (() => {
  if (typeof Intl !== 'undefined' && Intl.DisplayNames) {
    const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    return countryCodes
      .map((code) => ({ code, name: regionNames.of(code) || code }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return [
    { code: 'IN', name: 'India' },
    { code: 'US', name: 'United States' },
    { code: 'GB', name: 'United Kingdom' },
  ];
})();

function getCountryName(code) {
  if (!code) return '';
  return countryOptions.find((country) => country.code === code)?.name || '';
}

function toProviderLabel(provider) {
  const value = String(provider || '').trim();
  if (!value) return NOT_SET;
  if (value === 'google.com' || value === 'google') return 'Google';
  if (value === 'passkey') return 'Passkey';
  if (value === 'password') return 'Email/Password';
  if (value === 'phone') return 'Phone';
  return value;
}

function toDateTimeLabel(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return NOT_SET;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return normalized;
  return parsed.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function pickProfileString(nextValue, fallbackValue = '') {
  if (typeof nextValue === 'string' && nextValue.trim()) return nextValue;
  if (typeof fallbackValue === 'string') return fallbackValue;
  return '';
}

function toCreatedAtLabel(createdAt) {
  return toDateTimeLabel(createdAt);
}

function toAgeLabel(birthDate) {
  const value = String(birthDate || '').trim();
  if (!value || value === NOT_SET) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';

  const today = new Date();
  let age = today.getFullYear() - parsed.getFullYear();
  const monthDiff = today.getMonth() - parsed.getMonth();
  const dayDiff = today.getDate() - parsed.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }
  if (!Number.isFinite(age) || age < 0) return '';
  return `${age} years old`;
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

function toProfilePhotoDetails(profilePhotoUrl, profilePhotoUpdatedAt) {
  if (!profilePhotoUrl) return ['Add a profile photo'];
  const updatedAt = toDateTimeLabel(profilePhotoUpdatedAt);
  if (updatedAt === NOT_SET) return ['Change your profile photo'];
  return [`Last updated on ${updatedAt}`];
}

function toLastLoginDetails(lastLoginBy, lastLoginAt, fallbackProvider) {
  const method = toProviderLabel(lastLoginBy || fallbackProvider);
  const time = toDateTimeLabel(lastLoginAt);
  if (method === NOT_SET && time === NOT_SET) return [NOT_SET];
  if (time === NOT_SET) return [method];
  return [method, time];
}

function getPasskeyDeviceName(passkey = {}) {
  return passkey.deviceName || passkey.deviceType || 'Trusted device';
}

function getLastLoginIconSrc(lastLoginBy, fallbackProvider) {
  const method = String(lastLoginBy || fallbackProvider || '').trim().toLowerCase();
  if (method === 'google.com' || method === 'google') return '/apps/Google_Favicon_2025.svg.webp';
  if (method === 'passkey') return '/passblue.webp';
  return '';
}

function buildSectionContent({ name, birthDate, ageLabel, countryName, email, provider, createdAt, lastLoginBy, lastLoginAt, profilePhotoUrl, profilePhotoUpdatedAt, totalPasskeys = 0 }) {
  const displayName = name || NOT_SET;
  const lastLoginDetails = toLastLoginDetails(lastLoginBy, lastLoginAt, provider);
  const lastLoginIconSrc = getLastLoginIconSrc(lastLoginBy, provider);
  const createdAtLabel = toCreatedAtLabel(createdAt);
  const profilePhotoDetails = toProfilePhotoDetails(profilePhotoUrl, profilePhotoUpdatedAt);
  const passkeyCount = Number.isFinite(Number(totalPasskeys)) ? Number(totalPasskeys) : 0;
  const passkeyCountLabel = passkeyCount === 1 ? '1 passkey saved' : `${passkeyCount} passkeys saved`;

  return {
    'Personal Information': {
      title: 'Personal Information',
      description: 'Manage your personal information, including phone numbers and email addresses where you can be contacted.',
      cards: [
        {
          title: 'Profile photo',
          details: profilePhotoDetails,
          icon: FiCrop,
          iconSrc: '/photo-camera.png',
          iconClassName: 'manage-account__card-icon-image--blue',
        },
        {
          title: 'Name',
          details: [displayName],
          icon: FiUser,
        },
        {
          title: 'Date of birth',
          details: [birthDate || NOT_SET, ageLabel].filter(Boolean),
          icon: FiCalendar,
        },
        {
          title: 'Country/region',
          details: [countryName || NOT_SET],
          icon: FiGlobe,
        },
        {
          title: 'Email',
          details: [email || NOT_SET],
          icon: FiMail,
        },
        {
          title: 'Last login by',
          details: lastLoginDetails,
          icon: FiShield,
          iconSrc: lastLoginIconSrc,
          readOnly: true,
        },
        {
          title: 'Account created on',
          details: [createdAtLabel],
          icon: FiCalendar,
          readOnly: true,
        },
        {
          title: 'Total passkeys',
          details: [passkeyCountLabel],
          icon: FiShield,
          iconSrc: '/passblue.webp',
          readOnly: true,
        },
      ],
    },
    Passkeys: {
      title: 'Passkeys',
      description: 'Manage passkeys and sign-in methods for your account.',
      cards: [
        {
          title: 'Passkeys',
          details: ['No passkeys set up'],
          icon: FiShield,
        },
      ],
    },
    Devices: {
      title: 'Devices',
      description: 'Review active sessions, expired sessions, and sign out from devices you no longer use.',
      cards: [],
    },
    Privacy: {
      title: 'Privacy',
      description: 'Review privacy controls for your iClora account.',
      cards: [],
    },
  };
}

function toSessionIso(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  return '';
}

function normalizeDeviceSession(input = {}, fallbackStatus = 'active', currentSessionId = '') {
  const data = typeof input.data === 'function' ? input.data() || {} : input;
  const sessionId = data.sessionId || input.id || '';
  const clientType = String(data.clientType || '').trim().toLowerCase();
  const storedDeviceName = data.deviceName || '';
  const storedBrowserName = data.browserName || '';
  const loginAt = data.loginAtIso || toSessionIso(data.loginAt) || data.loginAt || '';
  const expiresAt = data.expiresAtIso || toSessionIso(data.expiresAt) || data.expiresAt || '';
  const loginAtMs = Date.parse(loginAt || '') || 0;
  const expiresAtMs = Number(data.expiresAtMs || 0) || Date.parse(expiresAt || '') || 0;
  const looksLikeAppLifetime = loginAtMs > 0 && expiresAtMs - loginAtMs > 8 * 60 * 60 * 1000;
  const isApplicationSession = clientType === 'application'
    || clientType === 'mobile'
    || String(storedBrowserName).toLowerCase() === 'iclora app'
    || String(storedDeviceName).toLowerCase().includes('iclora app')
    || String(storedDeviceName).toLowerCase().includes('iclora android app')
    || String(storedDeviceName).toLowerCase().includes('iclora ios app')
    || looksLikeAppLifetime;

  return {
    sessionId,
    status: data.status || fallbackStatus,
    current: Boolean(data.current || (currentSessionId && sessionId === currentSessionId)),
    provider: data.provider || '',
    clientType: isApplicationSession ? 'application' : clientType || 'web',
    deviceName: storedDeviceName || (isApplicationSession ? 'iClora App' : 'Unknown device'),
    deviceType: isApplicationSession ? 'mobile' : data.deviceType || 'desktop',
    browserName: isApplicationSession ? 'iClora App' : storedBrowserName || '',
    osName: data.osName || '',
    ip: data.ip || '',
    locationCity: data.locationCity || '',
    locationRegion: data.locationRegion || '',
    locationCountry: data.locationCountry || '',
    locationLabel: data.locationLabel || '',
    loginAt,
    lastSeenAt: data.lastSeenAtIso || toSessionIso(data.lastSeenAt) || data.lastSeenAt || '',
    logoutAt: data.logoutAtIso || toSessionIso(data.logoutAt) || data.logoutAt || '',
    expiresAt,
    reason: data.reason || '',
  };
}

function isApplicationDeviceSession(session = {}) {
  return session.clientType === 'application'
    || String(session.browserName || '').toLowerCase() === 'iclora app'
    || String(session.deviceName || '').toLowerCase().includes('iclora app');
}

function getDeviceSessionIcon(session = {}) {
  if (isApplicationDeviceSession(session)) return FiSmartphone;
  return session.deviceType === 'mobile' ? FiSmartphone : FiMonitor;
}

function sortDeviceSessions(sessions) {
  return [...sessions].sort((a, b) => {
    const aTime = Date.parse(a.lastSeenAt || a.loginAt || a.logoutAt || '') || 0;
    const bTime = Date.parse(b.lastSeenAt || b.loginAt || b.logoutAt || '') || 0;
    return bTime - aTime;
  });
}

function toSessionMethod(provider) {
  const label = toProviderLabel(provider);
  return label === NOT_SET ? 'Session' : label;
}

function toSessionStatusLabel(session) {
  if (session.status === 'active') return session.current ? 'This device' : 'Session active';
  if (session.reason === 'remote_logout') return 'Logged out remotely';
  if (session.reason === 'logout') return 'Logged out';
  return 'Session expired';
}

function splitProfileName(profileName) {
  const parts = (profileName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return {
    firstName: parts[0] || '',
    middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
    lastName: parts.length > 1 ? parts[parts.length - 1] : '',
  };
}

function parseBirthDateParts(label) {
  const fallback = { day: '1', month: 'March', year: '2007' };
  const match = String(label || '').match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return fallback;

  return {
    day: match[1],
    month: monthOptions.includes(match[2]) ? match[2] : fallback.month,
    year: match[3],
  };
}

export default function ManageAccount() {
  const navigate = useNavigate();
  const { showAlert } = useAlert();
  const [user, setUser] = useState(() => (readSessionToken() ? readUserProfileCache() : null));
  const [activeSection, setActiveSection] = useState('Personal Information');
  const [sectionMotionMode, setSectionMotionMode] = useState('');
  const [namePanelOpen, setNamePanelOpen] = useState(false);
  const [dobPanelOpen, setDobPanelOpen] = useState(false);
  const [countryPanelOpen, setCountryPanelOpen] = useState(false);
  const [emailPanelOpen, setEmailPanelOpen] = useState(false);
  const [photoPanelOpen, setPhotoPanelOpen] = useState(false);
  const [savingProfileField, setSavingProfileField] = useState('');
  const [sessionNow, setSessionNow] = useState(() => Date.now());
  const [passkeyInfo, setPasskeyInfo] = useState(() => readPasskeyCache() || { passkeys: [], lastLogin: null });
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyDeleting, setPasskeyDeleting] = useState(false);
  const [passkeySetupPanelOpen, setPasskeySetupPanelOpen] = useState(false);
  const [passkeyName, setPasskeyName] = useState('');
  const [passkeyInfoTarget, setPasskeyInfoTarget] = useState(null);
  const [passkeyDeleteTarget, setPasskeyDeleteTarget] = useState(null);
  const [deviceInfoTarget, setDeviceInfoTarget] = useState(null);
  const [deviceLogoutTarget, setDeviceLogoutTarget] = useState(null);
  const [deviceClearExpiredConfirm, setDeviceClearExpiredConfirm] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(true);
  const [deviceSessions, setDeviceSessions] = useState({ active: [], expired: [] });
  const [deviceLoading, setDeviceLoading] = useState(false);
  const [deviceDeleting, setDeviceDeleting] = useState('');
  const [deviceRemoving, setDeviceRemoving] = useState('');
  const [deviceClearingExpired, setDeviceClearingExpired] = useState(false);
  const [deviceCurrentSessionId, setDeviceCurrentSessionId] = useState('');
  const deviceSessionsRef = useRef({ active: [], expired: [] });
  const deviceCurrentSessionIdRef = useRef('');
  const [deleteAccountPanelOpen, setDeleteAccountPanelOpen] = useState(false);
  const [deleteAccountConfirmation, setDeleteAccountConfirmation] = useState('');
  const [deleteAccountProof, setDeleteAccountProof] = useState(null);
  const [deleteAccountVerifying, setDeleteAccountVerifying] = useState('');
  const [deleteAccountDeleting, setDeleteAccountDeleting] = useState(false);
  const [deleteAccountStep, setDeleteAccountStep] = useState('verify');
  const [deleteAccountReason, setDeleteAccountReason] = useState('');
  const [deleteAccountReasonDetails, setDeleteAccountReasonDetails] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [photoOriginalFile, setPhotoOriginalFile] = useState(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoDropActive, setPhotoDropActive] = useState(false);
  const [photoCropOpen, setPhotoCropOpen] = useState(false);
  const [photoCropLoaded, setPhotoCropLoaded] = useState(false);
  const [photoCropReady, setPhotoCropReady] = useState(false);
  const [photoCropMetrics, setPhotoCropMetrics] = useState({ viewportSize: 0, baseScale: 1 });
  const [photoCropTransform, setPhotoCropTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [photoCropping, setPhotoCropping] = useState(false);
  const photoInputRef = useRef(null);
  const photoCropViewportRef = useRef(null);
  const photoCropImageRef = useRef(null);
  const photoCropDragRef = useRef(null);
  const accentColor = readAccentColorCache() || '#46a935';

  useEffect(() => {
    deviceSessionsRef.current = deviceSessions;
  }, [deviceSessions]);

  useEffect(() => {
    deviceCurrentSessionIdRef.current = deviceCurrentSessionId;
  }, [deviceCurrentSessionId]);

  const photoPreviewUrl = useMemo(() => {
    if (!photoFile) return null;
    return URL.createObjectURL(photoFile);
  }, [photoFile]);

  const photoCropSourceUrl = useMemo(() => {
    const source = photoOriginalFile || photoFile;
    if (!source) return null;
    return URL.createObjectURL(source);
  }, [photoFile, photoOriginalFile]);

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
  }, [photoPreviewUrl]);

  useEffect(() => {
    return () => {
      if (photoCropSourceUrl) URL.revokeObjectURL(photoCropSourceUrl);
    };
  }, [photoCropSourceUrl]);

  useEffect(() => {
    let cancelled = false;
    if (!browserSupportsWebAuthn()) {
      setPasskeySupported(false);
      return undefined;
    }
    platformAuthenticatorIsAvailable()
      .then((available) => {
        if (!cancelled) setPasskeySupported(Boolean(available));
      })
      .catch(() => {
        if (!cancelled) setPasskeySupported(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const expiresAt = readSessionExpiresAt();
    if (!expiresAt) return undefined;
    const timer = window.setInterval(() => setSessionNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    document.body.classList.add('manage-account-page');
    return () => {
      document.body.classList.remove('manage-account-page');
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return undefined;

    const frame = window.requestAnimationFrame(() => {
      setSectionMotionMode('full');
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const cachedProfile = readUserProfileCache() || {};

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
        const nextUser = {
          uid: pickProfileString(json?.uid, cachedProfile.uid),
          name: pickProfileString(json?.name, cachedProfile.name),
          firstName: pickProfileString(json?.firstName, cachedProfile.firstName),
          middleName: pickProfileString(json?.middleName, cachedProfile.middleName),
          lastName: pickProfileString(json?.lastName, cachedProfile.lastName),
          email: pickProfileString(json?.email, cachedProfile.email),
          birthDate: pickProfileString(json?.birthDate || json?.dob, cachedProfile.birthDate || cachedProfile.dob),
          dob: pickProfileString(json?.dob || json?.birthDate, cachedProfile.dob || cachedProfile.birthDate),
          countryCode: pickProfileString(json?.countryCode, cachedProfile.countryCode),
          countryName: pickProfileString(json?.countryName, cachedProfile.countryName),
          provider: pickProfileString(json?.provider, cachedProfile.provider),
          createdAt: pickProfileString(json?.createdAt, cachedProfile.createdAt),
          lastLoginBy: pickProfileString(json?.lastLoginBy, cachedProfile.lastLoginBy),
          lastLoginAt: pickProfileString(json?.lastLoginAt, cachedProfile.lastLoginAt),
          profilePhotoUrl: pickProfileString(json?.profilePhotoUrl, cachedProfile.profilePhotoUrl),
          profilePhotoUpdatedAt: pickProfileString(json?.profilePhotoUpdatedAt, cachedProfile.profilePhotoUpdatedAt),
          plan: json?.plan || 'basic',
          storage: typeof json?.storage === 'number' ? json.storage : 1024,
          storageused: typeof json?.storageused === 'number' ? json.storageused : 0,
          storageBreakdown: Array.isArray(json?.storageBreakdown) ? json.storageBreakdown : (cachedProfile.storageBreakdown || []),
        };
        writeUserProfileCache(nextUser);
        setUser(nextUser);
      })
      .catch(async (error) => {
        if (cancelled) return;
        if (error?.code === 'STALE_SESSION_RESPONSE') return;
        if (error?.code === 'UNAUTHORIZED') {
          await clearSignedOutData();
          showAlert({
            title: 'Session expired',
            message: 'Please sign in again.',
            type: 'info',
            duration: 3200,
          });
          navigate('/auth', { replace: true, state: { sessionExpired: true } });
          return;
        }
        if (!readUserProfileCache()) navigate('/auth', { replace: true });
      });

    return () => {
      cancelled = true;
    };
  }, [navigate, showAlert]);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/passkey/me')
      .then((response) => response.json().catch(() => ({})))
      .then((json) => {
        if (cancelled || !json?.ok) return;
        const nextPasskeyInfo = {
          passkeys: Array.isArray(json.passkeys) ? json.passkeys : [],
          lastLogin: json.lastLogin || null,
        };
        writePasskeyCache(nextPasskeyInfo);
        setPasskeyInfo(nextPasskeyInfo);
      })
      .catch(() => {
        // Passkey status is helpful but should not block account management.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const uid = typeof user?.uid === 'string' ? user.uid.trim() : '';
    if (!uid) return undefined;

    let cancelled = false;
    let unsubscribeActive = null;
    let unsubscribeExpired = null;
    const cachedActivity = readDeviceActivityCache(uid);
    if (cachedActivity) {
      const cachedCurrentSessionId = cachedActivity.currentSessionId || deviceCurrentSessionIdRef.current || '';
      setDeviceCurrentSessionId(cachedCurrentSessionId);
      deviceCurrentSessionIdRef.current = cachedCurrentSessionId;
      const cachedSessions = {
        active: sortDeviceSessions(cachedActivity.active.map((session) => normalizeDeviceSession(session, 'active', cachedCurrentSessionId))),
        expired: sortDeviceSessions(cachedActivity.expired.map((session) => normalizeDeviceSession(session, 'expired', cachedCurrentSessionId))),
      };
      deviceSessionsRef.current = cachedSessions;
      setDeviceSessions(cachedSessions);
      if (activeSection === 'Devices') setDeviceLoading(false);
    } else {
      if (activeSection === 'Devices') setDeviceLoading(true);
    }

    apiFetch('/auth/activity/sessions')
      .then((response) => response.json().catch(() => ({})))
      .then((json) => {
        if (cancelled || !json?.ok) return;
        const currentSessionId = typeof json.currentSessionId === 'string' ? json.currentSessionId : '';
        const nextSessions = {
          active: sortDeviceSessions((Array.isArray(json.active) ? json.active : []).map((session) => normalizeDeviceSession(session, 'active', currentSessionId))),
          expired: sortDeviceSessions((Array.isArray(json.expired) ? json.expired : []).map((session) => normalizeDeviceSession(session, 'expired', currentSessionId))),
        };
        deviceCurrentSessionIdRef.current = currentSessionId;
        deviceSessionsRef.current = nextSessions;
        setDeviceCurrentSessionId(currentSessionId);
        setDeviceSessions(nextSessions);
        writeDeviceActivityCache(uid, { currentSessionId, ...nextSessions });
      })
      .catch(() => {
        if (!cancelled && !cachedActivity) {
          setDeviceSessions({ active: [], expired: [] });
        }
      })
      .finally(() => {
        if (!cancelled && activeSection === 'Devices') setDeviceLoading(false);
      });

    try {
      const db = getFirebaseDb();
      unsubscribeActive = onSnapshot(
        collection(db, LOGIN_ACTIVITY_COLLECTION, uid, SESSION_ACTIVE_COLLECTION),
        (snapshot) => {
          if (cancelled) return;
          const currentSessionId = deviceCurrentSessionIdRef.current;
          const activeSessions = sortDeviceSessions(snapshot.docs.map((docSnapshot) => normalizeDeviceSession(docSnapshot, 'active', currentSessionId)));
          if (currentSessionId && !activeSessions.some((session) => session.current)) {
            clearSignedOutData();
            navigate('/auth', { replace: true, state: { sessionExpired: true } });
            return;
          }
          const nextSessions = {
            ...deviceSessionsRef.current,
            active: activeSessions,
          };
          deviceSessionsRef.current = nextSessions;
          setDeviceSessions(nextSessions);
          writeDeviceActivityCache(uid, {
            currentSessionId,
            active: activeSessions,
            expired: nextSessions.expired,
          });
          if (activeSection === 'Devices') setDeviceLoading(false);
        },
        () => {
          if (!cancelled && activeSection === 'Devices') setDeviceLoading(false);
        }
      );
      unsubscribeExpired = onSnapshot(
        collection(db, LOGIN_ACTIVITY_COLLECTION, uid, SESSION_EXPIRED_COLLECTION),
        (snapshot) => {
          if (cancelled) return;
          const currentSessionId = deviceCurrentSessionIdRef.current;
          const expiredSessions = sortDeviceSessions(snapshot.docs.map((docSnapshot) => normalizeDeviceSession(docSnapshot, 'expired', currentSessionId)));
          const nextSessions = {
            ...deviceSessionsRef.current,
            expired: expiredSessions,
          };
          deviceSessionsRef.current = nextSessions;
          setDeviceSessions(nextSessions);
          writeDeviceActivityCache(uid, {
            currentSessionId,
            active: nextSessions.active,
            expired: expiredSessions,
          });
        }
      );
    } catch {
      // The API response above still provides the Devices view if realtime is unavailable.
    }

    return () => {
      cancelled = true;
      if (typeof unsubscribeActive === 'function') unsubscribeActive();
      if (typeof unsubscribeExpired === 'function') unsubscribeExpired();
    };
  }, [activeSection, navigate, user?.uid]);

  useEffect(() => {
    if ((!namePanelOpen && !dobPanelOpen && !countryPanelOpen && !emailPanelOpen && !photoPanelOpen && !photoCropOpen && !passkeySetupPanelOpen && !passkeyInfoTarget && !passkeyDeleteTarget && !deviceInfoTarget && !deviceLogoutTarget && !deviceClearExpiredConfirm && !deleteAccountPanelOpen) || typeof window === 'undefined') return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        setNamePanelOpen(false);
        setDobPanelOpen(false);
        setCountryPanelOpen(false);
        setEmailPanelOpen(false);
        if (!photoUploading) setPhotoPanelOpen(false);
        if (!photoCropping) setPhotoCropOpen(false);
        if (!passkeyLoading) setPasskeySetupPanelOpen(false);
        setPasskeyInfoTarget(null);
        if (!passkeyDeleting) setPasskeyDeleteTarget(null);
        if (!deviceDeleting) setDeviceInfoTarget(null);
        if (!deviceDeleting) setDeviceLogoutTarget(null);
        if (!deviceClearingExpired) setDeviceClearExpiredConfirm(false);
        if (!deleteAccountDeleting && !deleteAccountVerifying && deleteAccountStep !== 'success') setDeleteAccountPanelOpen(false);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [namePanelOpen, dobPanelOpen, countryPanelOpen, emailPanelOpen, photoPanelOpen, photoCropOpen, passkeySetupPanelOpen, passkeyInfoTarget, passkeyDeleteTarget, deviceInfoTarget, deviceLogoutTarget, deviceClearExpiredConfirm, deleteAccountPanelOpen, passkeyLoading, passkeyDeleting, deviceDeleting, deviceClearingExpired, deleteAccountDeleting, deleteAccountVerifying, deleteAccountStep, photoUploading, photoCropping]);

  useEffect(() => {
    if (!photoCropOpen || !photoCropSourceUrl) return undefined;
    let raf = 0;
    let observer = null;

    const syncMetrics = () => {
      const viewport = photoCropViewportRef.current;
      const image = photoCropImageRef.current;
      if (!viewport || !image || !image.naturalWidth || !image.naturalHeight) return;
      const rect = viewport.getBoundingClientRect();
      const viewportSize = Math.min(rect.width, rect.height);
      if (!viewportSize) return;
      const baseScale = Math.min(viewportSize / image.naturalWidth, viewportSize / image.naturalHeight);
      const nextMetrics = { viewportSize, baseScale };
      setPhotoCropMetrics(nextMetrics);
      setPhotoCropTransform((current) => clampCropTransform(current, nextMetrics, {
        width: image.naturalWidth,
        height: image.naturalHeight,
      }));
      setPhotoCropReady(true);
    };

    raf = window.requestAnimationFrame(syncMetrics);
    if (typeof ResizeObserver !== 'undefined' && photoCropViewportRef.current) {
      observer = new ResizeObserver(syncMetrics);
      observer.observe(photoCropViewportRef.current);
    }

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      if (observer) observer.disconnect();
    };
  }, [photoCropOpen, photoCropSourceUrl, photoCropLoaded]);

  async function saveProfileUpdate(payload, fieldName) {
    if (savingProfileField) return false;
    setSavingProfileField(fieldName);
    try {
      const response = await apiFetch('/profile/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(payload),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Could not update profile');

      const nextUser = {
        ...(user || {}),
        uid: json.uid || user?.uid || '',
        email: json.email || user?.email || '',
        name: json.name || '',
        firstName: json.firstName || '',
        middleName: json.middleName || '',
        lastName: json.lastName || '',
        birthDate: json.birthDate || '',
        dob: json.dob || json.birthDate || '',
        countryCode: json.countryCode || '',
        countryName: json.countryName || '',
      };
      setUser(nextUser);
      writeUserProfileCache(nextUser);
      showAlert({ title: 'Saved', message: 'Your profile has been updated.', type: 'success' });
      return true;
    } catch (error) {
      showAlert({
        title: 'Could not save',
        message: error?.message || 'Please try again.',
        type: 'error',
      });
      return false;
    } finally {
      setSavingProfileField('');
    }
  }

  async function handleNameSubmit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const saved = await saveProfileUpdate({
      name: {
        firstName: form.get('firstName') || '',
        middleName: form.get('middleName') || '',
        lastName: form.get('lastName') || '',
      },
    }, 'name');
    if (saved) setNamePanelOpen(false);
  }

  async function handleDobSubmit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const saved = await saveProfileUpdate({
      birthDate: {
        day: form.get('day') || '',
        month: form.get('month') || '',
        year: form.get('year') || '',
      },
    }, 'dob');
    if (saved) setDobPanelOpen(false);
  }

  async function handleCountrySubmit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const saved = await saveProfileUpdate({
      countryCode: form.get('countryCode') || '',
    }, 'country');
    if (saved) setCountryPanelOpen(false);
  }

  function selectPhotoFile(nextFile) {
    if (!nextFile) return;
    if (!nextFile.type?.startsWith('image/')) {
      showAlert({ title: 'Select a Photo', message: 'Please choose an image file.', type: 'info' });
      return;
    }
    setPhotoOriginalFile(nextFile);
    setPhotoFile(nextFile);
    setPhotoCropLoaded(false);
    setPhotoCropReady(false);
    setPhotoCropTransform({ scale: 1, x: 0, y: 0 });
    setPhotoCropOpen(true);
  }

  function handlePhotoSelect(event) {
    selectPhotoFile(event.target.files?.[0]);
  }

  function handlePhotoDragEnter(event) {
    event.preventDefault();
    event.stopPropagation();
    if (photoUploading) return;
    setPhotoDropActive(true);
  }

  function handlePhotoDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    if (photoUploading) return;
    event.dataTransfer.dropEffect = 'copy';
    setPhotoDropActive(true);
  }

  function handlePhotoDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    if (photoUploading) return;
    setPhotoDropActive(false);
  }

  function handlePhotoDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    if (photoUploading) return;
    setPhotoDropActive(false);
    selectPhotoFile(event.dataTransfer?.files?.[0]);
  }

  function handlePhotoCropPointerDown(event) {
    if (!photoCropReady || photoCropping) return;
    photoCropDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: photoCropTransform.x,
      originY: photoCropTransform.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePhotoCropPointerMove(event) {
    const drag = photoCropDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = {
      ...photoCropTransform,
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    };
    setPhotoCropTransform(clampCropTransform(next, photoCropMetrics, {
      width: photoCropImageRef.current?.naturalWidth || 1,
      height: photoCropImageRef.current?.naturalHeight || 1,
    }));
  }

  function handlePhotoCropPointerUp(event) {
    const drag = photoCropDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    photoCropDragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }

  async function handleApplyPhotoCrop() {
    if (!photoCropImageRef.current || !photoCropReady || photoCropping) return;
    setPhotoCropping(true);
    try {
      const baseName = ((photoOriginalFile || photoFile)?.name || 'profile-photo').replace(/\.[^/.]+$/, '');
      const sourceFile = photoOriginalFile || photoFile;
      const outputMimeType = isPngFile(sourceFile) ? PNG_MIME_TYPE : 'image/webp';
      const nextFile = await cropImageForUpload(
        photoCropImageRef.current,
        photoCropTransform,
        photoCropMetrics,
        baseName,
        outputMimeType
      );
      setPhotoFile(nextFile);
      setPhotoCropOpen(false);
    } catch (error) {
      showAlert({
        title: 'Crop Failed',
        message: error?.message || 'Could not crop your photo.',
        type: 'error',
        duration: 3800,
      });
    } finally {
      setPhotoCropping(false);
    }
  }

  async function handleSavePhoto() {
    if (!photoFile || photoUploading) {
      if (!photoFile) {
        showAlert({ title: 'Select a Photo', message: 'Please choose an image to continue.', type: 'info' });
      }
      return;
    }

    setPhotoUploading(true);
    try {
      const uploadFile = await prepareUploadFile(photoFile);
      const formData = new FormData();
      formData.append('photo', uploadFile);

      const response = await apiFetch('/users/me/profile-photo', {
        method: 'POST',
        body: formData,
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Upload failed');

      const nextProfilePhotoUrl = json?.profilePhotoUrl || json?.url || '';
      const nextUser = {
        ...(user || {}),
        profilePhotoUrl: nextProfilePhotoUrl,
        profilePhotoUpdatedAt: json?.profilePhotoUpdatedAt || new Date().toISOString(),
        storage: typeof json?.storage === 'number' ? json.storage : (user?.storage || 1024),
        storageused: typeof json?.storageused === 'number' ? json.storageused : (user?.storageused || 0),
        storageBreakdown: Array.isArray(json?.storageBreakdown) ? json.storageBreakdown : (user?.storageBreakdown || []),
      };
      setUser(nextUser);
      writeUserProfileCache(nextUser);
      setPhotoPanelOpen(false);
      setPhotoCropOpen(false);
      setPhotoDropActive(false);
      setPhotoFile(null);
      setPhotoOriginalFile(null);
      if (photoInputRef.current) photoInputRef.current.value = '';
      showAlert({ title: 'Saved', message: 'Your profile photo has been updated.', type: 'success' });
    } catch (error) {
      showAlert({
        title: 'Upload Failed',
        message: error?.message || 'Could not upload your profile photo.',
        type: 'error',
      });
    } finally {
      setPhotoUploading(false);
    }
  }

  async function handleLogoutDevice(session) {
    const sessionId = session?.sessionId || '';
    if (!sessionId || deviceDeleting) return;
    setDeviceDeleting(sessionId);
    try {
      const response = await apiFetch(`/auth/activity/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Could not log out device');

      showAlert({
        title: 'Device signed out',
        message: session.current ? 'This device has been signed out.' : 'That session has been moved to expired.',
        type: 'success',
      });

      if (json.currentSessionEnded) {
        await clearSignedOutData();
        navigate('/auth', { replace: true });
      } else {
        const endedSession = {
          ...session,
          status: 'expired',
          current: false,
          reason: 'remote_logout',
          logoutAt: new Date().toISOString(),
        };
        const nextSessions = {
          active: deviceSessionsRef.current.active.filter((item) => item.sessionId !== sessionId),
          expired: sortDeviceSessions([
            endedSession,
            ...deviceSessionsRef.current.expired.filter((item) => item.sessionId !== sessionId),
          ]),
        };
        deviceSessionsRef.current = nextSessions;
        setDeviceSessions(nextSessions);
        writeDeviceActivityCache(user?.uid || '', {
          currentSessionId: deviceCurrentSessionIdRef.current,
          ...nextSessions,
        });
      }
    } catch (error) {
      showAlert({
        title: 'Could not log out',
        message: error?.message || 'Please try again.',
        type: 'error',
      });
    } finally {
      setDeviceDeleting('');
    }
  }

  async function handleDeleteExpiredDevice(session) {
    const sessionId = session?.sessionId || '';
    if (!sessionId || deviceRemoving) return;
    setDeviceRemoving(sessionId);
    try {
      const response = await apiFetch(`/auth/activity/sessions/${encodeURIComponent(sessionId)}/expired`, {
        method: 'DELETE',
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Could not delete expired session');
      const nextSessions = {
        active: deviceSessionsRef.current.active,
        expired: deviceSessionsRef.current.expired.filter((item) => item.sessionId !== sessionId),
      };
      deviceSessionsRef.current = nextSessions;
      setDeviceSessions(nextSessions);
      writeDeviceActivityCache(user?.uid || '', {
        currentSessionId: deviceCurrentSessionIdRef.current,
        ...nextSessions,
      });
      setDeviceInfoTarget(null);
      showAlert({
        title: 'Removed',
        message: 'Expired session removed from list.',
        type: 'success',
      });
    } catch (error) {
      showAlert({
        title: 'Could not remove',
        message: error?.message || 'Please try again.',
        type: 'error',
      });
    } finally {
      setDeviceRemoving('');
    }
  }

  async function handleDeleteAllExpiredDevices() {
    if (deviceClearingExpired) return;
    const sessions = deviceSessionsRef.current.expired || [];
    if (!sessions.length) {
      setDeviceClearExpiredConfirm(false);
      return;
    }
    setDeviceClearingExpired(true);
    try {
      await Promise.all(sessions.map((session) => (
        apiFetch(`/auth/activity/sessions/${encodeURIComponent(session.sessionId)}/expired`, {
          method: 'DELETE',
        }).then((response) => response.json().catch(() => ({})).then((json) => {
          if (!response.ok || !json?.ok) throw new Error(json?.error || 'Could not delete expired sessions');
        }))
      )));
      const nextSessions = {
        active: deviceSessionsRef.current.active,
        expired: [],
      };
      deviceSessionsRef.current = nextSessions;
      setDeviceSessions(nextSessions);
      writeDeviceActivityCache(user?.uid || '', {
        currentSessionId: deviceCurrentSessionIdRef.current,
        ...nextSessions,
      });
      setDeviceInfoTarget(null);
      setDeviceClearExpiredConfirm(false);
      showAlert({
        title: 'Removed',
        message: 'All expired sessions removed.',
        type: 'success',
      });
    } catch (error) {
      showAlert({
        title: 'Could not remove',
        message: error?.message || 'Please try again.',
        type: 'error',
      });
    } finally {
      setDeviceClearingExpired(false);
    }
  }

  function openPasskeySetupPanel() {
    if (passkeyLoading) return;
    if (passkeyInfo.passkeys.length >= MAX_PASSKEYS) {
      showAlert({
        title: 'Passkey limit reached',
        message: `You can save up to ${MAX_PASSKEYS} passkeys for one iClora account.`,
        type: 'info',
      });
      return;
    }
    if (!passkeySupported) {
      showAlert({
        title: 'Passkeys unavailable',
        message: 'This device or browser does not currently expose a platform authenticator.',
        type: 'info',
      });
      return;
    }
    setPasskeyName(`${sidebarName}'s Passkey`);
    setPasskeySetupPanelOpen(true);
  }

  async function handlePasskeySetup(event) {
    event.preventDefault();
    if (passkeyLoading) return;
    const form = new FormData(event.currentTarget);
    const nextPasskeyName = String(form.get('passkeyName') || passkeyName || '').replace(/\s+/g, ' ').trim() || 'iClora Passkey';

    setPasskeyLoading(true);
    try {
      const optionsResponse = await apiFetch('/passkey/register/options', { method: 'POST' });
      const optionsJson = await optionsResponse.json().catch(() => ({}));
      if (!optionsResponse.ok || !optionsJson?.ok) {
        throw new Error(optionsJson?.error || 'Could not start passkey setup');
      }

      const registrationResponse = await startRegistration({ optionsJSON: optionsJson.options });
      const verifyResponse = await apiFetch('/passkey/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: registrationResponse, name: nextPasskeyName }),
      });
      const verifyJson = await verifyResponse.json().catch(() => ({}));
      if (!verifyResponse.ok || !verifyJson?.ok) {
        throw new Error(verifyJson?.error || 'Could not save passkey');
      }

      setPasskeyInfo((current) => {
        const nextPasskeyInfo = {
          ...current,
          passkeys: Array.isArray(verifyJson.passkeys) ? verifyJson.passkeys : current.passkeys,
        };
        writePasskeyCache(nextPasskeyInfo);
        return nextPasskeyInfo;
      });
      setPasskeySetupPanelOpen(false);
      showAlert({ title: 'Passkey ready', message: 'You can now sign in with this device passkey.', type: 'success' });
    } catch (error) {
      showAlert({
        title: 'Passkey setup failed',
        message: error?.message || 'Could not complete passkey setup.',
        type: 'error',
        duration: 4200,
      });
    } finally {
      setPasskeyLoading(false);
    }
  }

  async function handleConfirmDeletePasskey() {
    if (!passkeyDeleteTarget?.id || passkeyDeleting) return;

    setPasskeyDeleting(true);
    try {
      const response = await apiFetch(`/passkey/${encodeURIComponent(passkeyDeleteTarget.id)}`, {
        method: 'DELETE',
        cache: 'no-store',
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Could not delete passkey');
      }

      setPasskeyInfo((current) => {
        const nextPasskeyInfo = {
          ...current,
          passkeys: Array.isArray(json.passkeys) ? json.passkeys : current.passkeys.filter((passkey) => passkey.id !== passkeyDeleteTarget.id),
        };
        writePasskeyCache(nextPasskeyInfo);
        return nextPasskeyInfo;
      });
      setPasskeyDeleteTarget(null);
      showAlert({ title: 'Passkey deleted', message: 'That sign-in passkey has been removed.', type: 'success' });
    } catch (error) {
      showAlert({
        title: 'Could not delete passkey',
        message: error?.message || 'Please try again.',
        type: 'error',
      });
    } finally {
      setPasskeyDeleting(false);
    }
  }

  function resetDeleteAccountPanel() {
    setDeleteAccountPanelOpen(false);
    setDeleteAccountConfirmation('');
    setDeleteAccountProof(null);
    setDeleteAccountVerifying('');
    setDeleteAccountStep('verify');
    setDeleteAccountReason('');
    setDeleteAccountReasonDetails('');
  }

  function handleContinueDeleteAccount() {
    if (!deleteAccountProof) {
      showAlert({
        title: 'Verify first',
        message: 'Verify with Google or passkey before deleting this account.',
        type: 'info',
      });
      return;
    }
    if (deleteAccountConfirmation.trim() !== DELETE_CONFIRMATION_PHRASE) {
      showAlert({
        title: 'Confirm the phrase',
        message: `Type ${DELETE_CONFIRMATION_PHRASE} to continue.`,
        type: 'info',
      });
      return;
    }
    setDeleteAccountStep('feedback');
  }

  async function handleVerifyDeleteAccountWithGoogle() {
    if (deleteAccountVerifying || deleteAccountDeleting) return;
    setDeleteAccountVerifying('google');
    try {
      const { auth, provider: googleProvider } = getGoogleAuthDependencies();
      const popupResult = auth.currentUser?.uid === user?.uid
        ? await reauthenticateWithPopup(auth.currentUser, googleProvider)
        : await signInWithPopup(auth, googleProvider);
      const verifiedUid = popupResult?.user?.uid || '';
      if (user?.uid && verifiedUid && verifiedUid !== user.uid) {
        throw new Error('That Google account does not match this iClora account.');
      }
      const idToken = await popupResult.user.getIdToken(true);
      const verifyResponse = await apiFetch('/auth/delete-account/google/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      const verifyJson = await verifyResponse.json().catch(() => ({}));
      if (!verifyResponse.ok || !verifyJson?.ok || !verifyJson?.verificationToken) {
        throw new Error(verifyJson?.error || 'Google verification failed');
      }
      setDeleteAccountProof({
        method: 'google',
        verificationToken: verifyJson.verificationToken,
        label: 'Google verified',
      });
      showAlert({
        title: 'Verified',
        message: 'Google verification is ready for account deletion.',
        type: 'success',
        duration: 2600,
      });
    } catch (error) {
      showAlert({
        title: 'Google verification failed',
        message: error?.message || 'Please try again.',
        type: 'error',
        duration: 4200,
      });
    } finally {
      setDeleteAccountVerifying('');
    }
  }

  async function handleVerifyDeleteAccountWithPasskey() {
    if (deleteAccountVerifying || deleteAccountDeleting) return;
    if (!browserSupportsWebAuthn()) {
      showAlert({
        title: 'Passkeys unavailable',
        message: 'This browser does not support passkey verification.',
        type: 'info',
      });
      return;
    }

    setDeleteAccountVerifying('passkey');
    try {
      const optionsResponse = await apiFetch('/auth/delete-account/passkey/options', { method: 'POST' });
      const optionsJson = await optionsResponse.json().catch(() => ({}));
      if (!optionsResponse.ok || !optionsJson?.ok) {
        throw new Error(optionsJson?.error || 'Could not start passkey verification');
      }

      const authenticationResponse = await startAuthentication({ optionsJSON: optionsJson.options });
      const verifyResponse = await apiFetch('/auth/delete-account/passkey/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: optionsJson.challengeId,
          response: authenticationResponse,
        }),
      });
      const verifyJson = await verifyResponse.json().catch(() => ({}));
      if (!verifyResponse.ok || !verifyJson?.ok || !verifyJson?.verificationToken) {
        throw new Error(verifyJson?.error || 'Passkey verification failed');
      }

      setDeleteAccountProof({
        method: 'passkey',
        verificationToken: verifyJson.verificationToken,
        label: 'Passkey verified',
      });
      showAlert({
        title: 'Verified',
        message: 'Passkey verification is ready for account deletion.',
        type: 'success',
        duration: 2600,
      });
    } catch (error) {
      showAlert({
        title: 'Passkey verification failed',
        message: error?.message || 'Please try again.',
        type: 'error',
        duration: 4200,
      });
    } finally {
      setDeleteAccountVerifying('');
    }
  }

  async function handleDeleteAccount() {
    if (deleteAccountDeleting) return;
    if (!deleteAccountProof) {
      showAlert({
        title: 'Verify first',
        message: 'Verify with Google or passkey before deleting this account.',
        type: 'info',
      });
      return;
    }
    if (deleteAccountConfirmation.trim() !== DELETE_CONFIRMATION_PHRASE) {
      showAlert({
        title: 'Confirm the phrase',
        message: `Type ${DELETE_CONFIRMATION_PHRASE} to continue.`,
        type: 'info',
      });
      return;
    }
    if (!deleteAccountReason) {
      showAlert({
        title: 'Choose a reason',
        message: 'Please tell us why you are deleting your account.',
        type: 'info',
      });
      return;
    }
    if (deleteAccountReason === 'other' && deleteAccountReasonDetails.trim().length < 3) {
      showAlert({
        title: 'Write your reason',
        message: 'Please add a short note before deleting your account.',
        type: 'info',
      });
      return;
    }

    let deleted = false;
    setDeleteAccountDeleting(true);
    try {
      const response = await apiFetch('/auth/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmation: deleteAccountConfirmation.trim(),
          method: deleteAccountProof.method,
          verificationToken: deleteAccountProof.verificationToken || '',
          deletionFeedback: {
            reason: deleteAccountReason,
            details: deleteAccountReasonDetails.trim(),
          },
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Could not delete account');
      }

      const uid = typeof user?.uid === 'string' ? user.uid : '';
      if (uid) {
        writeDeviceActivityCache(uid, { currentSessionId: '', active: [], expired: [] });
      }
      writePasskeyCache({ passkeys: [], lastLogin: null });
      await clearSignedOutData();
      setDeleteAccountStep('success');
      showAlert({
        title: 'Account deleted successfully',
        message: 'Your iClora account data has been deleted. Only the deletion feedback you submitted is kept.',
        type: 'success',
        duration: 4300,
      });
      await new Promise((resolve) => {
        window.setTimeout(resolve, 1800);
      });
      deleted = true;
      navigate('/auth', { replace: true });
    } catch (error) {
      showAlert({
        title: 'Could not delete account',
        message: error?.message || 'Please try again.',
        type: 'error',
        duration: 4600,
      });
    } finally {
      if (!deleted) setDeleteAccountDeleting(false);
    }
  }

  const savedName = typeof user?.name === 'string' ? user.name.trim() : '';
  const sidebarName = savedName || (typeof user?.email === 'string' ? user.email.split('@')[0] : '') || 'User';
  const sidebarNameParts = useMemo(() => splitNameAndTrailingEmoji(sidebarName), [sidebarName]);
  const nameParts = useMemo(() => {
    if (user?.firstName || user?.middleName || user?.lastName) {
      return {
        firstName: user?.firstName || '',
        middleName: user?.middleName || '',
        lastName: user?.lastName || '',
      };
    }
    return splitProfileName(savedName);
  }, [savedName, user?.firstName, user?.lastName, user?.middleName]);
  const displayEmail = user?.email || '';
  const birthDateLabel = user?.birthDate || user?.dob || NOT_SET;
  const ageLabel = useMemo(() => toAgeLabel(birthDateLabel), [birthDateLabel]);
  const sessionExpiresAt = readSessionExpiresAt();
  const sessionExpiryLabel = useMemo(() => {
    if (!sessionExpiresAt) return '';
    if (!Number.isFinite(sessionExpiresAt) || sessionExpiresAt <= sessionNow) return 'Session expired';
    const expiresAt = new Date(sessionExpiresAt);
    const time = expiresAt.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return `Session expires at ${time}`;
  }, [sessionExpiresAt, sessionNow]);
  const birthDateParts = useMemo(() => parseBirthDateParts(birthDateLabel), [birthDateLabel]);
  const dayOptions = useMemo(() => Array.from({ length: 31 }, (_, index) => String(index + 1)), []);
  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 127 }, (_, index) => String(currentYear - index));
  }, []);
  const countryCode = user?.countryCode || '';
  const countryName = user?.countryName || getCountryName(countryCode);
  const sectionContent = useMemo(() => buildSectionContent({
    name: savedName,
    birthDate: user?.birthDate || user?.dob || '',
    ageLabel,
    countryName,
    email: displayEmail,
    provider: user?.provider || '',
    createdAt: user?.createdAt || '',
    lastLoginBy: user?.lastLoginBy || '',
    lastLoginAt: user?.lastLoginAt || '',
    profilePhotoUrl: user?.profilePhotoUrl || '',
    profilePhotoUpdatedAt: user?.profilePhotoUpdatedAt || '',
    totalPasskeys: passkeyInfo.passkeys.length,
  }), [ageLabel, countryName, displayEmail, passkeyInfo.passkeys.length, savedName, user?.birthDate, user?.createdAt, user?.dob, user?.lastLoginAt, user?.lastLoginBy, user?.profilePhotoUpdatedAt, user?.provider, user?.profilePhotoUrl]);
  const activeContent = sectionContent[activeSection] || sectionContent['Personal Information'];
  const cardsToRender = activeContent.cards;
  const sectionTransitionClass = sectionMotionMode ? `manage-account__section--${sectionMotionMode}` : '';
  const cachedDeviceActivity = useMemo(() => {
    const uid = typeof user?.uid === 'string' ? user.uid.trim() : '';
    if (!uid) return null;
    return readDeviceActivityCache(uid);
  }, [user?.uid]);
  const activeDeviceSessions = deviceSessions.active;
  const expiredDeviceSessions = deviceSessions.expired;
  const activeDeviceCountForNav = activeDeviceSessions.length || (cachedDeviceActivity?.active?.length || 0);
  const hasPasskeys = passkeyInfo.passkeys.length > 0;
  const passkeyLimitReached = passkeyInfo.passkeys.length >= MAX_PASSKEYS;
  const passkeyLastUsed = passkeyInfo.passkeys
    .map((passkey) => passkey.lastUsedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  const passkeyLastUsedLabel = passkeyLastUsed
    ? new Date(passkeyLastUsed).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    : '';
  const passkeyDeleteLabel = passkeyDeleteTarget
    ? toDateTimeLabel(passkeyDeleteTarget.lastUsedAt || passkeyDeleteTarget.createdAt)
    : '';
  const passkeyInfoDetails = passkeyInfoTarget
    ? [
      { label: 'Created on', value: toDateTimeLabel(passkeyInfoTarget.createdAt) },
      { label: 'Device name', value: getPasskeyDeviceName(passkeyInfoTarget) },
      { label: 'Last used', value: toDateTimeLabel(passkeyInfoTarget.lastUsedAt) },
    ]
    : [];
  const deleteAccountBusy = Boolean(deleteAccountVerifying) || deleteAccountDeleting || deleteAccountStep === 'success';
  const deleteAccountCanRequestFeedback = Boolean(deleteAccountProof) && deleteAccountConfirmation.trim() === DELETE_CONFIRMATION_PHRASE;
  const deleteAccountReasonReady = Boolean(deleteAccountReason) && (deleteAccountReason !== 'other' || deleteAccountReasonDetails.trim().length >= 3);
  const deleteAccountReady = deleteAccountCanRequestFeedback && deleteAccountReasonReady;
  const selectedDeleteReason = DELETE_ACCOUNT_REASONS.find((reason) => reason.value === deleteAccountReason);
  const deviceInfoDetails = deviceInfoTarget
    ? [
      { label: 'Status', value: toSessionStatusLabel(deviceInfoTarget) },
      { label: 'Sign in method', value: toSessionMethod(deviceInfoTarget.provider) },
      { label: 'Expires at', value: toDateTimeLabel(deviceInfoTarget.expiresAt) },
    ]
    : [];
  const photoCropImageSize = {
    width: photoCropImageRef.current?.naturalWidth || 1,
    height: photoCropImageRef.current?.naturalHeight || 1,
  };
  const photoCropLayout = getCropDisplay(photoCropMetrics, photoCropTransform, photoCropImageSize);

  return (
    <>
      <DashboardNavbar
        user={user}
        accentColor={accentColor}
        appIcon="/favicon.ico"
        appIconDark="/faviconn.ico"
        showBack
        onBack={() => navigate('/cloud')}
        disableAccountMenu
      />
      <main className="manage-account">
        <section className="manage-account__layout">
          <aside className="manage-account__sidebar" aria-label="Account sections">
            <div className="manage-account__profile">
              <div className="manage-account__avatar">
                {user?.profilePhotoUrl ? <img src={user.profilePhotoUrl} alt="" /> : <span>{sidebarName.charAt(0)}</span>}
              </div>
              <div className="manage-account__profile-body">
                <h2>
                  <span className="manage-account__profile-name-text">{sidebarNameParts.nameText || sidebarName}</span>
                  {sidebarNameParts.emojiText ? (
                    <span className="manage-account__profile-name-emoji" aria-label="emoji">{sidebarNameParts.emojiText}</span>
                  ) : null}
                </h2>
                <p>{displayEmail}</p>
                {sessionExpiryLabel ? (
                  <p className="manage-account__session-expiry">{sessionExpiryLabel}</p>
                ) : null}
              </div>
            </div>

            <nav className="manage-account__nav">
              {sidebarItems.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={item === activeSection ? 'is-active' : ''}
                  onClick={() => setActiveSection(item)}
                >
                  <span>{item}</span>
                  {item === 'Devices' ? (
                    <span className="manage-account__nav-badge" aria-label={`${activeDeviceCountForNav} active sessions`}>
                      {activeDeviceCountForNav}
                    </span>
                  ) : null}
                </button>
              ))}
            </nav>
          </aside>

          <section className="manage-account__content" aria-label={activeContent.title}>
            <div key={activeSection} className={`manage-account__section ${sectionTransitionClass}`.trim()}>
              <div className="manage-account__hero">
                <h2>
                  {activeContent.title === 'Personal Information' ? (
                    <>
                      <span className="manage-account__hero-title-primary">Personal</span>{' '}
                      <span className="manage-account__hero-title-secondary">Information</span>
                    </>
                  ) : (
                    activeContent.title
                  )}
                </h2>
                <p>{activeContent.description}</p>
              </div>

              {activeContent.title === 'Devices' ? (
                <div className="manage-account__devices-panel">
                  <div className="manage-account__devices-summary">
                    <div>
                      <strong>{activeDeviceSessions.length}</strong>
                      <span>active</span>
                    </div>
                    <div>
                      <strong>{expiredDeviceSessions.length}</strong>
                      <span>expired</span>
                    </div>
                  </div>

                  {deviceLoading && !activeDeviceSessions.length ? (
                    <div className="manage-account__devices-empty">Loading device sessions...</div>
                  ) : (
                    <>
                      <section className="manage-account__device-group" aria-label="Session active">
                        <div className="manage-account__device-group-head">
                          <h3>Session active</h3>
                        </div>
                        {activeDeviceSessions.length ? (
                          <div className="manage-account__device-list">
                            {activeDeviceSessions.map((session) => {
                              const DeviceIcon = getDeviceSessionIcon(session);
                              return (
                                <article className="manage-account__device-item" key={session.sessionId}>
                                  <span className="manage-account__device-icon" aria-hidden="true">
                                    <DeviceIcon />
                                  </span>
                                  <span className="manage-account__device-copy">
                                    <strong>{session.deviceName}</strong>
                                    <span className="manage-account__device-status">{toSessionStatusLabel(session)}</span>
                                  </span>
                                  <span className="manage-account__device-actions">
                                    <button
                                      type="button"
                                      className="manage-account__passkey-info"
                                      onClick={() => setDeviceInfoTarget(session)}
                                      disabled={Boolean(deviceDeleting)}
                                      aria-label={`View ${session.deviceName} details`}
                                    >
                                      <FiInfo aria-hidden="true" />
                                    </button>
                                  </span>
                                </article>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="manage-account__devices-empty">No active sessions.</div>
                        )}
                      </section>

                      {expiredDeviceSessions.length ? (
                        <section className="manage-account__device-group" aria-label="Session expired">
                          <div className="manage-account__device-group-head">
                            <h3>Session expired</h3>
                            <button
                              type="button"
                              className="manage-account__device-clear manage-account__device-clear--inline"
                              onClick={() => setDeviceClearExpiredConfirm(true)}
                              disabled={deviceClearingExpired}
                            >
                              Remove all
                            </button>
                          </div>
                          <div className="manage-account__device-list">
                            {expiredDeviceSessions.map((session) => {
                              const DeviceIcon = getDeviceSessionIcon(session);
                              return (
                                <article className="manage-account__device-item manage-account__device-item--expired" key={session.sessionId}>
                                  <span className="manage-account__device-icon" aria-hidden="true">
                                    <DeviceIcon />
                                  </span>
                                  <span className="manage-account__device-copy">
                                    <strong>{session.deviceName}</strong>
                                    <span className="manage-account__device-status">{toSessionStatusLabel(session)}</span>
                                  </span>
                                  <span className="manage-account__device-actions">
                                    <button
                                      type="button"
                                      className="manage-account__passkey-info"
                                      onClick={() => setDeviceInfoTarget(session)}
                                      disabled={Boolean(deviceDeleting)}
                                      aria-label={`View ${session.deviceName} details`}
                                    >
                                      <FiInfo aria-hidden="true" />
                                    </button>
                                  </span>
                                </article>
                              );
                            })}
                          </div>
                        </section>
                      ) : null}
                    </>
                  )}
                </div>
              ) : activeContent.title === 'Passkeys' ? (
                <div className="manage-account__passkey-panel">
                  <div className="manage-account__passkey-main">
                    <span className="manage-account__passkey-icon" aria-hidden="true">
                      <img src="/passblue.webp" alt="" className="manage-account__passkey-logo" />
                    </span>
                    <div>
                      <h3>{hasPasskeys ? 'Passkey is active' : 'Set up a passkey'}</h3>
                      <p>
                        {hasPasskeys
                          ? 'Use Face ID, Touch ID, fingerprint, or your device unlock to sign in to iClora.'
                          : 'Create a secure device passkey for faster passwordless sign-in.'}
                      </p>
                    </div>
                  </div>
                  <div className="manage-account__passkey-meta">
                    <span>{hasPasskeys ? `${passkeyInfo.passkeys.length} passkey${passkeyInfo.passkeys.length === 1 ? '' : 's'} saved` : 'No passkey saved'}</span>
                    <span>{passkeyLastUsedLabel ? `Last used ${passkeyLastUsedLabel}` : 'Requires device biometric or screen lock'}</span>
                  </div>
                  {hasPasskeys ? (
                    <div className="manage-account__passkey-list" aria-label="Saved passkeys">
                      {passkeyInfo.passkeys.map((passkey, index) => {
                        const createdLabel = toDateTimeLabel(passkey.createdAt);
                        const lastUsedLabel = toDateTimeLabel(passkey.lastUsedAt);
                        const passkeyName = passkey.name || `Passkey ${index + 1}`;
                        const deviceName = getPasskeyDeviceName(passkey);
                        const passkeyDetails = [
                          lastUsedLabel !== NOT_SET ? `Last used ${lastUsedLabel}` : 'Never used',
                          createdLabel !== NOT_SET ? `Created ${createdLabel}` : '',
                          `${deviceName}${passkey.backedUp ? ' · backed up' : ''}`,
                        ].filter(Boolean);
                        return (
                          <article className="manage-account__passkey-item" key={passkey.id || passkeyName}>
                            <span className="manage-account__passkey-item-icon" aria-hidden="true">
                              <img src="/passblue.webp" alt="" />
                            </span>
                            <span className="manage-account__passkey-item-copy">
                              <strong>{passkeyName}</strong>
                              {passkeyDetails.map((detail) => (
                                <span key={`${passkey.id}-${detail}`}>{detail}</span>
                              ))}
                            </span>
                            <span className="manage-account__passkey-actions">
                              <button
                                type="button"
                                className="manage-account__passkey-info"
                                onClick={() => setPasskeyInfoTarget({ ...passkey, label: passkeyName })}
                                disabled={passkeyDeleting || passkeyLoading}
                                aria-label={`View ${passkeyName} details`}
                              >
                                <FiInfo aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="manage-account__passkey-delete"
                                onClick={() => setPasskeyDeleteTarget({ ...passkey, label: passkeyName })}
                                disabled={passkeyDeleting || passkeyLoading}
                                aria-label={`Delete ${passkeyName}`}
                              >
                                <FiTrash2 aria-hidden="true" />
                                <span>Delete</span>
                              </button>
                            </span>
                          </article>
                        );
                      })}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="manage-account__passkey-button"
                    onClick={openPasskeySetupPanel}
                    disabled={passkeyLoading || passkeyLimitReached}
                    aria-busy={passkeyLoading}
                  >
                    {passkeyLoading ? (
                      <span className="manage-account__button-spinner" aria-hidden="true" />
                    ) : (
                      <FiKey aria-hidden="true" />
                    )}
                    <span>{passkeyLimitReached ? '4 passkeys saved' : hasPasskeys ? 'Add another passkey' : 'Set up passkey'}</span>
                  </button>
                </div>
              ) : activeContent.title === 'Privacy' ? (
                <div className="manage-account__privacy-panel">
                  <section className="manage-account__privacy-overview" aria-label="Privacy and cookies">
                    <div className="manage-account__privacy-header">
                      <span className="manage-account__privacy-header-icon" aria-hidden="true">
                        <img src={COOKIE_ICON_SRC} alt="" />
                      </span>
                      <div>
                        <h3>Privacy and cookies</h3>
                        <p>
                          iClora uses essential cookies for secure account access. Cookie values and tokens are never shown here.
                        </p>
                      </div>
                    </div>

                    <div className="manage-account__cookie-list" aria-label="Cookies used by iClora">
                      <article className="manage-account__cookie-row">
                        <div className="manage-account__cookie-main">
                          <strong>iClora session cookie</strong>
                          <span>iclora_session</span>
                        </div>
                        <p>
                          Keeps you signed in, validates account requests, and expires automatically.
                        </p>
                        <span className="manage-account__cookie-badge">Essential</span>
                      </article>

                      <article className="manage-account__cookie-row">
                        <div className="manage-account__cookie-main">
                          <strong>Google / Firebase sign-in cookies</strong>
                          <span>Provider-managed</span>
                        </div>
                        <p>
                          Used only during Google sign-in or re-verification before sensitive account changes.
                        </p>
                        <span className="manage-account__cookie-badge">Auth</span>
                      </article>
                    </div>

                    <div className="manage-account__privacy-note">
                      <FiInfo aria-hidden="true" />
                      <div>
                        <strong>Your account data stays protected</strong>
                        <span>Profile details, passkeys, devices, and login activity are used to run and secure iClora. Delete account requires fresh verification.</span>
                      </div>
                    </div>
                  </section>

                  <section className="manage-account__privacy-danger" aria-label="Delete account">
                    <span className="manage-account__privacy-danger-icon" aria-hidden="true">
                      <FiTrash2 />
                    </span>
                    <div className="manage-account__privacy-danger-copy">
                      <h3>Delete account</h3>
                      <p>
                        Permanently remove your profile, passkeys, login activity, profile photo, and iClora account access.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="manage-account__privacy-danger-button"
                      aria-label="Delete account"
                      title="Delete account"
                      onClick={() => {
                        setDeleteAccountConfirmation('');
                        setDeleteAccountProof(null);
                        setDeleteAccountStep('verify');
                        setDeleteAccountReason('');
                        setDeleteAccountReasonDetails('');
                        setDeleteAccountPanelOpen(true);
                      }}
                    >
                      <FiTrash2 aria-hidden="true" />
                      <span>Delete account</span>
                    </button>
                  </section>
                </div>
              ) : (
                <div className="manage-account__cards">
                {cardsToRender.map((card) => {
                  const Icon = card.icon;
                  const icon = card.iconSrc ? (
                    <img
                      src={card.iconSrc}
                      alt=""
                      className={`manage-account__card-icon-image${card.iconClassName ? ` ${card.iconClassName}` : ''}`}
                    />
                  ) : (
                    <Icon />
                  );
                  const isReadOnly = Boolean(card.readOnly);
                  const opensNamePanel = card.title === 'Name';
                  const opensPhotoPanel = card.title === 'Profile photo';
                  const opensDobPanel = card.title === 'Date of birth';
                  const opensCountryPanel = card.title === 'Country/region';
                  const opensEmailPanel = card.title === 'Email';
                  const isInteractive = !isReadOnly && (opensNamePanel || opensPhotoPanel || opensDobPanel || opensCountryPanel || opensEmailPanel);
                  return (
                    isInteractive ? (
                      <button
                        key={card.title}
                        type="button"
                        className="manage-account__card"
                        onClick={() => {
                          if (opensNamePanel) setNamePanelOpen(true);
                          if (opensPhotoPanel) setPhotoPanelOpen(true);
                          if (opensDobPanel) setDobPanelOpen(true);
                          if (opensCountryPanel) setCountryPanelOpen(true);
                          if (opensEmailPanel) setEmailPanelOpen(true);
                        }}
                        aria-haspopup="dialog"
                      >
                        <span className="manage-account__card-copy">
                          <strong>{card.title}</strong>
                          {card.details.map((detail, index) => (
                            <span
                              key={`${card.title}-${index}`}
                              className={card.title === 'Date of birth' && index > 0 ? 'manage-account__dob-age' : undefined}
                            >
                              {detail}
                            </span>
                          ))}
                        </span>
                        <span className="manage-account__card-icon" aria-hidden="true">
                          {icon}
                        </span>
                      </button>
                    ) : (
                      <div key={card.title} className="manage-account__card manage-account__card--read-only">
                        <span className="manage-account__card-copy">
                          <strong>{card.title}</strong>
                          {card.details.map((detail, index) => (
                            <span
                              key={`${card.title}-${index}`}
                              className={card.title === 'Date of birth' && index > 0 ? 'manage-account__dob-age' : undefined}
                            >
                              {detail}
                            </span>
                          ))}
                        </span>
                        <span className="manage-account__card-icon" aria-hidden="true">
                          {icon}
                        </span>
                      </div>
                    )
                  );
                })}
                </div>
              )}
            </div>
          </section>
        </section>
      </main>

      {namePanelOpen && (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={() => setNamePanelOpen(false)}>
          <section
            className="manage-account__name-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-name-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="manage-account__modal-close"
              aria-label="Close name editor"
              onClick={() => setNamePanelOpen(false)}
            >
              <FiX />
            </button>

            <div className="manage-account__modal-icon" aria-hidden="true">
              <FiUser />
            </div>

            <h2 id="manage-name-title">Name</h2>

            <form className="manage-account__name-form" onSubmit={handleNameSubmit}>
              <label className="manage-account__name-field">
                <span>First name</span>
                <input name="firstName" defaultValue={nameParts.firstName} autoComplete="given-name" />
              </label>

              <label className="manage-account__name-field manage-account__name-field--single">
                <input
                  name="middleName"
                  defaultValue={nameParts.middleName}
                  placeholder="Middle name (optional)"
                  autoComplete="additional-name"
                />
              </label>

              <label className="manage-account__name-field">
                <span>Last name</span>
                <input name="lastName" defaultValue={nameParts.lastName} autoComplete="family-name" />
              </label>

              <button
                type="submit"
                className="manage-account__name-save"
                disabled={savingProfileField === 'name'}
                aria-busy={savingProfileField === 'name'}
                aria-label={savingProfileField === 'name' ? 'Saving' : 'Save'}
              >
                {savingProfileField === 'name' ? (
                  <span className="manage-account__button-spinner" aria-hidden="true" />
                ) : (
                  'Save'
                )}
              </button>
            </form>
          </section>
        </div>
      )}

      {dobPanelOpen && (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={() => setDobPanelOpen(false)}>
          <section
            className="manage-account__name-modal manage-account__dob-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-dob-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="manage-account__modal-close"
              aria-label="Close date of birth editor"
              onClick={() => setDobPanelOpen(false)}
            >
              <FiX />
            </button>

            <div className="manage-account__modal-icon" aria-hidden="true">
              <FiCalendar />
            </div>

            <h2 id="manage-dob-title">Date of birth</h2>
            <p className="manage-account__dob-copy">Your date of birth is used to determine eligible services.</p>

            <form className="manage-account__dob-form" onSubmit={handleDobSubmit}>
              <label className="manage-account__dob-field">
                <span>Day</span>
                <select name="day" defaultValue={birthDateParts.day} aria-label="Day">
                  {dayOptions.map((day) => (
                    <option key={day} value={day}>{day}</option>
                  ))}
                </select>
              </label>

              <label className="manage-account__dob-field manage-account__dob-field--month">
                <span>Month</span>
                <select name="month" defaultValue={birthDateParts.month} aria-label="Month">
                  {monthOptions.map((month) => (
                    <option key={month} value={month}>{month}</option>
                  ))}
                </select>
              </label>

              <label className="manage-account__dob-field">
                <span>Year</span>
                <select name="year" defaultValue={birthDateParts.year} aria-label="Year">
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </label>

              <button
                type="submit"
                className="manage-account__name-save"
                disabled={savingProfileField === 'dob'}
                aria-busy={savingProfileField === 'dob'}
                aria-label={savingProfileField === 'dob' ? 'Saving' : 'Save'}
              >
                {savingProfileField === 'dob' ? (
                  <span className="manage-account__button-spinner" aria-hidden="true" />
                ) : (
                  'Save'
                )}
              </button>
            </form>
          </section>
        </div>
      )}

      {countryPanelOpen && (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={() => setCountryPanelOpen(false)}>
          <section
            className="manage-account__name-modal manage-account__country-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-country-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="manage-account__modal-close"
              aria-label="Close country or region editor"
              onClick={() => setCountryPanelOpen(false)}
            >
              <FiX />
            </button>

            <div className="manage-account__modal-icon" aria-hidden="true">
              <FiGlobe />
            </div>

            <h2 id="manage-country-title">Country / Region</h2>
            <p className="manage-account__country-current">{countryName || NOT_SET}</p>
            <p className="manage-account__country-copy">
              Your country or region determines available services and payment methods.
            </p>

            <form className="manage-account__country-form" onSubmit={handleCountrySubmit}>
              <label className="manage-account__dob-field manage-account__country-field">
                <span>Country / Region</span>
                <select name="countryCode" defaultValue={countryCode || 'IN'} aria-label="Country or region">
                  {countryOptions.map((country) => (
                    <option key={country.code} value={country.code}>{country.name}</option>
                  ))}
                </select>
              </label>

              <div className="manage-account__country-actions">
                <button
                  type="button"
                  className="manage-account__country-button manage-account__country-button--cancel"
                  onClick={() => setCountryPanelOpen(false)}
                  disabled={savingProfileField === 'country'}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="manage-account__country-button manage-account__country-button--continue"
                  disabled={savingProfileField === 'country'}
                  aria-busy={savingProfileField === 'country'}
                  aria-label={savingProfileField === 'country' ? 'Saving' : 'Continue'}
                >
                  {savingProfileField === 'country' ? (
                    <span className="manage-account__button-spinner" aria-hidden="true" />
                  ) : (
                    'Continue'
                  )}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {emailPanelOpen && (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={() => setEmailPanelOpen(false)}>
          <section
            className="manage-account__name-modal manage-account__email-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-email-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="manage-account__modal-close"
              aria-label="Close email information"
              onClick={() => setEmailPanelOpen(false)}
            >
              <FiX />
            </button>

            <div className="manage-account__modal-icon" aria-hidden="true">
              <FiMail />
            </div>

            <h2 id="manage-email-title">Email</h2>
            <p className="manage-account__email-value">{displayEmail || 'No email added'}</p>
            <p className="manage-account__email-copy">
              You can&apos;t change your email for security purposes.
            </p>

            <button type="button" className="manage-account__name-save manage-account__email-done" onClick={() => setEmailPanelOpen(false)}>
              OK
            </button>
          </section>
        </div>
      )}

      {photoPanelOpen && (
        <div
          className="manage-account__modal-layer"
          role="presentation"
          onMouseDown={() => !photoUploading && setPhotoPanelOpen(false)}
          onDragEnter={handlePhotoDragEnter}
          onDragOver={handlePhotoDragOver}
          onDragLeave={handlePhotoDragLeave}
          onDrop={handlePhotoDrop}
        >
          <section
            className="manage-account__name-modal manage-account__photo-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-photo-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="manage-account__modal-close"
              aria-label="Close profile photo editor"
              onClick={() => setPhotoPanelOpen(false)}
              disabled={photoUploading}
            >
              <FiX />
            </button>

            <div className="manage-account__modal-icon manage-account__photo-modal-icon" aria-hidden="true">
              <img src="/photo-camera.png" alt="" />
            </div>

            <h2 id="manage-photo-title">Profile photo</h2>
            <p className="manage-account__photo-copy">Upload, crop, and update your profile photo.</p>
            <p className="manage-account__photo-drop-copy">Drag and drop a photo here, or choose one.</p>

            <div
              className={`manage-account__photo-preview-shell${photoDropActive ? ' is-drop-active' : ''}`}
              onDragEnter={handlePhotoDragEnter}
              onDragOver={handlePhotoDragOver}
              onDragLeave={handlePhotoDragLeave}
              onDrop={handlePhotoDrop}
              role="presentation"
            >
              <div className="manage-account__photo-preview">
              {photoPreviewUrl || user?.profilePhotoUrl ? (
                <img src={photoPreviewUrl || user?.profilePhotoUrl} alt="Profile preview" />
              ) : (
                <span>{sidebarName.charAt(0)}</span>
              )}
              </div>
            </div>

            <input
              ref={photoInputRef}
              className="manage-account__photo-file"
              type="file"
              accept="image/*"
              onChange={handlePhotoSelect}
              disabled={photoUploading}
            />

            <div className="manage-account__photo-actions">
              <button
                type="button"
                className="manage-account__delete-button manage-account__delete-button--cancel"
                onClick={() => photoInputRef.current?.click()}
                disabled={photoUploading}
              >
                Choose photo
              </button>
              <button
                type="button"
                className="manage-account__delete-button manage-account__setup-button"
                onClick={handleSavePhoto}
                disabled={photoUploading || !photoFile}
                aria-busy={photoUploading}
              >
                {photoUploading ? (
                  <span className="manage-account__button-spinner" aria-hidden="true" />
                ) : (
                  'Save photo'
                )}
              </button>
            </div>
          </section>
        </div>
      )}

      {photoCropOpen && photoCropSourceUrl && (
        <div className="manage-account__modal-layer manage-account__crop-layer" role="presentation">
          <section
            className="manage-account__crop-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-photo-crop-title"
            aria-describedby="manage-photo-crop-copy"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="manage-account__crop-head">
              <div>
                <h2 id="manage-photo-crop-title">Crop Photo</h2>
                <p id="manage-photo-crop-copy">Drag to reposition and use zoom for the framing you want.</p>
              </div>
              <button
                type="button"
                className="manage-account__crop-close"
                aria-label="Close crop editor"
                onClick={() => setPhotoCropOpen(false)}
                disabled={photoCropping}
              >
                ×
              </button>
            </div>
            <div
              className="manage-account__crop-viewport"
              ref={photoCropViewportRef}
              onPointerDown={handlePhotoCropPointerDown}
              onPointerMove={handlePhotoCropPointerMove}
              onPointerUp={handlePhotoCropPointerUp}
              onPointerCancel={handlePhotoCropPointerUp}
              style={{ cursor: photoCropping ? 'progress' : 'grab' }}
            >
              <img
                ref={photoCropImageRef}
                className="manage-account__crop-image"
                src={photoCropSourceUrl || ''}
                alt="Crop source"
                onLoad={() => setPhotoCropLoaded(true)}
                draggable={false}
                style={{
                  width: `${photoCropLayout.displayW}px`,
                  height: `${photoCropLayout.displayH}px`,
                  left: '50%',
                  top: '50%',
                  transform: `translate(-50%, -50%) translate(${photoCropLayout.offsetX}px, ${photoCropLayout.offsetY}px)`,
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
                value={photoCropTransform.scale}
                onChange={(event) => {
                  const next = {
                    ...photoCropTransform,
                    scale: Number(event.target.value),
                  };
                  setPhotoCropTransform(clampCropTransform(next, photoCropMetrics, {
                    width: photoCropImageRef.current?.naturalWidth || 1,
                    height: photoCropImageRef.current?.naturalHeight || 1,
                  }));
                }}
                disabled={!photoCropReady || photoCropping}
                aria-label="Zoom crop"
              />
            </div>
            <div className="manage-account__crop-actions">
              <button
                type="button"
                className="manage-account__crop-button-secondary"
                onClick={() => setPhotoCropOpen(false)}
                disabled={photoCropping}
              >
                Cancel
              </button>
              <button
                type="button"
                className="manage-account__crop-button-primary"
                onClick={handleApplyPhotoCrop}
                disabled={!photoCropReady || photoCropping}
                aria-busy={photoCropping}
              >
                {photoCropping ? (
                  <span className="manage-account__button-spinner" aria-hidden="true" />
                ) : (
                  'Use Crop'
                )}
              </button>
            </div>
          </section>
        </div>
      )}

      {passkeySetupPanelOpen && (
        <div
          className="manage-account__modal-layer"
          role="presentation"
          onMouseDown={() => {
            if (!passkeyLoading) setPasskeySetupPanelOpen(false);
          }}
        >
          <section
            className="manage-account__name-modal manage-account__setup-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-passkey-setup-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="manage-account__modal-close"
              aria-label="Close passkey setup"
              onClick={() => setPasskeySetupPanelOpen(false)}
              disabled={passkeyLoading}
            >
              <FiX />
            </button>

            <div className="manage-account__delete-icon" aria-hidden="true">
              <img src="/passblue.webp" alt="" />
            </div>

            <h2 id="manage-passkey-setup-title">Name your passkey</h2>
            <p className="manage-account__delete-copy">
              Give this passkey a simple name. Setup is fast — Face ID, Touch ID, fingerprint, or device unlock will finish it.
            </p>

            <form className="manage-account__setup-form" onSubmit={handlePasskeySetup}>
              <label className="manage-account__setup-field">
                <span>Passkey name</span>
                <input
                  name="passkeyName"
                  value={passkeyName}
                  onChange={(event) => setPasskeyName(event.target.value)}
                  maxLength={40}
                  placeholder="My iPhone passkey"
                />
              </label>

              <div className="manage-account__delete-actions">
                <button
                  type="button"
                  className="manage-account__delete-button manage-account__delete-button--cancel"
                  onClick={() => setPasskeySetupPanelOpen(false)}
                  disabled={passkeyLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="manage-account__delete-button manage-account__setup-button"
                  disabled={passkeyLoading}
                  aria-busy={passkeyLoading}
                >
                  {passkeyLoading ? (
                    <span className="manage-account__button-spinner" aria-hidden="true" />
                  ) : (
                    <>
                      <img src="/passblue.webp" alt="" aria-hidden="true" />
                      <span>Set up passkey</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {passkeyInfoTarget && (
        <div
          className="manage-account__modal-layer"
          role="presentation"
          onMouseDown={() => setPasskeyInfoTarget(null)}
        >
          <section
            className="manage-account__name-modal manage-account__info-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-passkey-info-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="manage-account__modal-close"
              aria-label="Close passkey details"
              onClick={() => setPasskeyInfoTarget(null)}
            >
              <FiX />
            </button>

            <div className="manage-account__delete-icon" aria-hidden="true">
              <img src="/passblue.webp" alt="" />
            </div>

            <h2 id="manage-passkey-info-title">{passkeyInfoTarget.label || 'Passkey details'}</h2>
            <div className="manage-account__info-list">
              {passkeyInfoDetails.map((detail) => (
                <div className="manage-account__info-row" key={detail.label}>
                  <span>{detail.label}</span>
                  <strong>{detail.value || NOT_SET}</strong>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="manage-account__name-save manage-account__email-done"
              onClick={() => setPasskeyInfoTarget(null)}
            >
              OK
            </button>
          </section>
        </div>
      )}

      {passkeyDeleteTarget && (
        <div
          className="manage-account__modal-layer"
          role="presentation"
          onMouseDown={() => {
            if (!passkeyDeleting) setPasskeyDeleteTarget(null);
          }}
        >
          <section
            className="manage-account__name-modal manage-account__delete-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-passkey-delete-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="manage-account__modal-close"
              aria-label="Close delete passkey confirmation"
              onClick={() => setPasskeyDeleteTarget(null)}
              disabled={passkeyDeleting}
            >
              <FiX />
            </button>

            <div className="manage-account__delete-icon" aria-hidden="true">
              <img src="/passblue.webp" alt="" />
            </div>

            <h2 id="manage-passkey-delete-title">Delete passkey?</h2>
            <p className="manage-account__delete-copy">
              {passkeyDeleteTarget.label || 'This passkey'} will be removed from your iClora account.
              {passkeyDeleteLabel && passkeyDeleteLabel !== NOT_SET ? ` Last activity ${passkeyDeleteLabel}.` : ''}
            </p>

            <div className="manage-account__delete-actions manage-account__delete-actions--single">
              <button
                type="button"
                className="manage-account__delete-button manage-account__delete-button--cancel"
                onClick={() => setPasskeyDeleteTarget(null)}
                disabled={passkeyDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="manage-account__delete-button manage-account__delete-button--danger"
                onClick={handleConfirmDeletePasskey}
                disabled={passkeyDeleting}
                aria-busy={passkeyDeleting}
              >
                {passkeyDeleting ? (
                  <span className="manage-account__button-spinner" aria-hidden="true" />
                ) : (
                  <>
                    <FiTrash2 aria-hidden="true" />
                    <span>Delete passkey</span>
                  </>
                )}
              </button>
            </div>
          </section>
        </div>
      )}

      {deviceInfoTarget && (
        <div
          className="manage-account__modal-layer"
          role="presentation"
          onMouseDown={() => {
            if (!deviceDeleting) setDeviceInfoTarget(null);
          }}
        >
          <section
            className="manage-account__name-modal manage-account__info-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-device-info-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="manage-account__modal-close"
              aria-label="Close device details"
              onClick={() => setDeviceInfoTarget(null)}
              disabled={Boolean(deviceDeleting)}
            >
              <FiX />
            </button>

            <div className="manage-account__modal-icon" aria-hidden="true">
              {React.createElement(getDeviceSessionIcon(deviceInfoTarget))}
            </div>

            <h2 id="manage-device-info-title">{deviceInfoTarget.deviceName || 'Device details'}</h2>
            <div className="manage-account__info-list">
              {deviceInfoDetails.map((detail) => (
                <div className="manage-account__info-row" key={detail.label}>
                  <span>{detail.label}</span>
                  <strong>{detail.value || NOT_SET}</strong>
                </div>
              ))}
            </div>

            {deviceInfoTarget.status === 'active' ? (
              <div className="manage-account__delete-actions">
                <button
                  type="button"
                  className="manage-account__delete-button manage-account__delete-button--danger manage-account__delete-button--logout"
                  onClick={() => setDeviceLogoutTarget(deviceInfoTarget)}
                  disabled={Boolean(deviceDeleting)}
                >
                  <img src="/logout.webp" alt="" aria-hidden="true" className="manage-account__logout-icon-image" />
                  <span>{deviceInfoTarget.current ? 'Log out this device' : 'Log out session'}</span>
                </button>
              </div>
            ) : deviceInfoTarget.status === 'expired' ? (
              <div className="manage-account__delete-actions">
                <button
                  type="button"
                  className="manage-account__delete-button manage-account__delete-button--danger"
                  onClick={() => handleDeleteExpiredDevice(deviceInfoTarget)}
                  disabled={Boolean(deviceRemoving)}
                  aria-busy={deviceRemoving === deviceInfoTarget.sessionId}
                >
                  {deviceRemoving === deviceInfoTarget.sessionId ? (
                    <span className="manage-account__button-spinner" aria-hidden="true" />
                  ) : (
                    <>
                      <FiTrash2 aria-hidden="true" />
                      <span>Delete session</span>
                    </>
                  )}
                </button>
              </div>
            ) : null}
          </section>
        </div>
      )}

      {deviceLogoutTarget && (
        <div
          className="manage-account__modal-layer"
          role="presentation"
          onMouseDown={() => {
            if (!deviceDeleting) setDeviceLogoutTarget(null);
          }}
        >
          <section
            className="manage-account__name-modal manage-account__delete-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-device-logout-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="manage-account__modal-close"
              aria-label="Close device logout confirmation"
              onClick={() => setDeviceLogoutTarget(null)}
              disabled={Boolean(deviceDeleting)}
            >
              <FiX />
            </button>

            <div className="manage-account__modal-icon" aria-hidden="true">
              {React.createElement(getDeviceSessionIcon(deviceLogoutTarget))}
            </div>

            <h2 id="manage-device-logout-title">Expire device session?</h2>
            <p className="manage-account__delete-copy">
              Are you sure you wanna expire this device session for {deviceLogoutTarget.deviceName || 'this device'}?
            </p>

            <div className="manage-account__delete-actions">
              <button
                type="button"
                className="manage-account__delete-button manage-account__delete-button--cancel"
                onClick={() => setDeviceLogoutTarget(null)}
                disabled={Boolean(deviceDeleting)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="manage-account__delete-button manage-account__delete-button--danger manage-account__delete-button--logout"
                onClick={async () => {
                  await handleLogoutDevice(deviceLogoutTarget);
                  setDeviceLogoutTarget(null);
                  setDeviceInfoTarget(null);
                }}
                disabled={Boolean(deviceDeleting)}
                aria-busy={deviceDeleting === deviceLogoutTarget.sessionId}
              >
                {deviceDeleting === deviceLogoutTarget.sessionId ? (
                  <span className="manage-account__button-spinner" aria-hidden="true" />
                ) : (
                  <>
                    <img src="/logout.webp" alt="" aria-hidden="true" className="manage-account__logout-icon-image" />
                    <span>Expire session</span>
                  </>
                )}
              </button>
            </div>
          </section>
        </div>
      )}

      {deviceClearExpiredConfirm && (
        <div
          className="manage-account__modal-layer"
          role="presentation"
          onMouseDown={() => {
            if (!deviceClearingExpired) setDeviceClearExpiredConfirm(false);
          }}
        >
          <section
            className="manage-account__name-modal manage-account__delete-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-device-clear-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="manage-account__modal-close"
              aria-label="Close remove expired sessions confirmation"
              onClick={() => setDeviceClearExpiredConfirm(false)}
              disabled={deviceClearingExpired}
            >
              <FiX />
            </button>

            <div className="manage-account__modal-icon" aria-hidden="true">
              <FiTrash2 />
            </div>

            <h2 id="manage-device-clear-title">Remove all expired sessions?</h2>
            <p className="manage-account__delete-copy">
              This will remove all logged out sessions from the expired list.
            </p>

            <div className="manage-account__delete-actions">
              <button
                type="button"
                className="manage-account__delete-button manage-account__delete-button--cancel"
                onClick={() => setDeviceClearExpiredConfirm(false)}
                disabled={deviceClearingExpired}
              >
                No
              </button>
              <button
                type="button"
                className="manage-account__delete-button manage-account__delete-button--danger"
                onClick={handleDeleteAllExpiredDevices}
                disabled={deviceClearingExpired}
                aria-busy={deviceClearingExpired}
              >
                {deviceClearingExpired ? (
                  <span className="manage-account__button-spinner" aria-hidden="true" />
                ) : (
                  <>
                    <FiTrash2 aria-hidden="true" />
                    <span>Yes</span>
                  </>
                )}
              </button>
            </div>
          </section>
        </div>
      )}

      {deleteAccountPanelOpen && (
        <div
          className="manage-account__modal-layer"
          role="presentation"
          onMouseDown={() => {
            if (!deleteAccountBusy) resetDeleteAccountPanel();
          }}
        >
          <section
            className="manage-account__name-modal manage-account__delete-modal manage-account__account-delete-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-account-delete-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            {deleteAccountStep === 'success' ? (
              <>
                <div className="manage-account__delete-success-icon" aria-hidden="true">
                  <FiCheckCircle />
                </div>
                <h2 id="manage-account-delete-title">Account deleted</h2>
                <p className="manage-account__delete-copy manage-account__delete-copy--wide">
                  Your iClora account has been deleted and you are being logged out.
                </p>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="manage-account__modal-close"
                  aria-label="Close delete account confirmation"
                  onClick={resetDeleteAccountPanel}
                  disabled={deleteAccountBusy}
                >
                  <FiX />
                </button>

                <div className="manage-account__modal-icon manage-account__modal-icon--danger" aria-hidden="true">
                  {deleteAccountStep === 'feedback' ? <FiInfo /> : <FiTrash2 />}
                </div>

                <h2 id="manage-account-delete-title">
                  {deleteAccountStep === 'feedback' ? 'One last thing' : 'Delete iClora account?'}
                </h2>
                <p className="manage-account__delete-copy manage-account__delete-copy--wide">
                  {deleteAccountStep === 'feedback'
                    ? 'Your account is verified. Please tell us why you are deleting it before the final deletion.'
                    : `This permanently removes ${displayEmail || 'this account'} and account data from iClora.`}
                </p>

                {deleteAccountStep === 'verify' ? (
                  <>
                    <label className="manage-account__setup-field manage-account__delete-phrase">
                      <span>Type {DELETE_CONFIRMATION_PHRASE}</span>
                      <input
                        value={deleteAccountConfirmation}
                        onChange={(event) => setDeleteAccountConfirmation(event.target.value)}
                        placeholder={DELETE_CONFIRMATION_PHRASE}
                        autoComplete="off"
                        maxLength={DELETE_CONFIRMATION_PHRASE.length}
                        disabled={deleteAccountBusy}
                      />
                    </label>

                    <div className="manage-account__delete-verify-grid" aria-label="Re-verify account">
                      <button
                        type="button"
                        className={`manage-account__delete-verify${deleteAccountProof?.method === 'google' ? ' is-active' : ''}`}
                        onClick={handleVerifyDeleteAccountWithGoogle}
                        disabled={deleteAccountBusy}
                        aria-busy={deleteAccountVerifying === 'google'}
                      >
                        {deleteAccountVerifying === 'google' ? (
                          <span className="manage-account__button-spinner" aria-hidden="true" />
                        ) : deleteAccountProof?.method === 'google' ? (
                          <FiCheckCircle aria-hidden="true" />
                        ) : (
                          <img src="/apps/Google_Favicon_2025.svg.webp" alt="" aria-hidden="true" />
                        )}
                        <span>Verify Google</span>
                      </button>
                      <button
                        type="button"
                        className={`manage-account__delete-verify${deleteAccountProof?.method === 'passkey' ? ' is-active' : ''}`}
                        onClick={handleVerifyDeleteAccountWithPasskey}
                        disabled={deleteAccountBusy}
                        aria-busy={deleteAccountVerifying === 'passkey'}
                      >
                        {deleteAccountVerifying === 'passkey' ? (
                          <span className="manage-account__button-spinner" aria-hidden="true" />
                        ) : deleteAccountProof?.method === 'passkey' ? (
                          <FiCheckCircle aria-hidden="true" />
                        ) : (
                          <img src="/passblue.webp" alt="" aria-hidden="true" />
                        )}
                        <span>Verify Passkey</span>
                      </button>
                    </div>

                    <div className={`manage-account__delete-status${deleteAccountProof ? ' is-ready' : ''}`}>
                      {deleteAccountProof ? deleteAccountProof.label : 'Verification required'}
                    </div>

                    <button
                      type="button"
                      className={`manage-account__delete-button manage-account__delete-button--account ${deleteAccountProof ? 'manage-account__delete-button--verified' : 'manage-account__delete-button--danger'}`}
                      onClick={handleContinueDeleteAccount}
                      disabled={!deleteAccountCanRequestFeedback || deleteAccountBusy}
                    >
                      <FiTrash2 aria-hidden="true" />
                      <span>Delete account now</span>
                    </button>
                  </>
                ) : (
                  <>
                    <div className="manage-account__delete-feedback" aria-label="Delete account feedback">
                      <div className="manage-account__delete-feedback-head">
                        <strong>Why are you deleting your account?</strong>
                      </div>

                      <label className="manage-account__delete-reason-select">
                        <span>Reason</span>
                        <select
                          value={deleteAccountReason}
                          onChange={(event) => setDeleteAccountReason(event.target.value)}
                          disabled={deleteAccountBusy}
                        >
                          <option value="" disabled>Choose a reason</option>
                          {DELETE_ACCOUNT_REASONS.map((reason) => (
                            <option key={reason.value} value={reason.value}>
                              {reason.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <p className="manage-account__delete-reason-hint">
                        {selectedDeleteReason?.detail || 'Select the closest reason from the list.'}
                      </p>

                      <label className="manage-account__delete-feedback-note">
                        <span>More details</span>
                        <textarea
                          value={deleteAccountReasonDetails}
                          onChange={(event) => setDeleteAccountReasonDetails(event.target.value)}
                          placeholder={deleteAccountReason === 'other' ? 'Tell us your reason' : 'Optional note'}
                          maxLength={600}
                          disabled={deleteAccountBusy}
                        />
                      </label>
                    </div>

                    <button
                      type="button"
                      className="manage-account__delete-button manage-account__delete-button--danger manage-account__delete-button--account"
                      onClick={handleDeleteAccount}
                      disabled={!deleteAccountReady || deleteAccountBusy}
                      aria-busy={deleteAccountDeleting}
                    >
                      {deleteAccountDeleting ? (
                        <span className="manage-account__button-spinner" aria-hidden="true" />
                      ) : (
                        <>
                          <FiTrash2 aria-hidden="true" />
                          <span>Delete account forever</span>
                        </>
                      )}
                    </button>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
