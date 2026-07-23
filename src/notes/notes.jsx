import React, { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import JSZip from 'jszip';
import {
  FiAlertTriangle,
  FiBold,
  FiChevronLeft,
  FiChevronDown,
  FiEdit2,
  FiFolder,
  FiFolderPlus,
  FiItalic,
  FiLock,
  FiMapPin,
  FiMoreHorizontal,
  FiPlusCircle,
  FiRefreshCw,
  FiSearch,
  FiMinus,
  FiTrash2,
  FiUnderline,
} from 'react-icons/fi';
import { apiFetch, isStaleSessionResponse } from '../api/backendapi';
import DownloadIcon from '../components/DownloadIcon';
import { readSessionToken } from '../auth/authCache';
import { clearSignedOutData } from '../auth/sessionCleanup';
import { readUserProfileCache } from '../cloud/userProfileCache';
import { readAccentColorCache } from '../cloud/themeCache';
import { useAlert } from '../alert/alert';
import DashboardNavbar from '../cloud/dashboardnavbar';
import AppleLoader from '../components/AppleLoader';
import { applyAppPageMeta } from '../components/utils/pageMeta';
import '../cloud/manage_account/manage.css';
import './notes.css';

const CACHE_KEY = 'iclora_notes_cache_v1';
const DASHBOARD_NOTES_CACHE_KEY = 'iclora_notes_dashboard_preview_v1';
const UI_STATE_KEY = 'iclora_notes_ui_state_v1';
const DEFAULT_FOLDER_ID = 'all-notes';
const ALL_FOLDERS_ID = 'all-icloud';
const SAVE_IDLE_MS = 650;
const CACHE_IDLE_MS = 120;
const CACHE_STALE_MS = 2 * 60 * 1000;
const HARD_REFRESH_COOLDOWN_MS = 9000;
const DASHBOARD_PREVIEW_LIMIT = 6;
const MAX_FOLDERS = 50;
const TEXT_IMPORT_ACCEPT = [
  'text/*',
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.tsv',
  '.json',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.go',
  '.rs',
  '.php',
  '.rb',
  '.swift',
  '.kt',
  '.sql',
  '.yaml',
  '.yml',
  '.ini',
  '.conf',
  '.log',
  '.env',
  '.rtf',
].join(',');

function readNotesCache() {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CACHE_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      meta: parsed.meta && typeof parsed.meta === 'object' ? parsed.meta : {},
      cachedAt: Number(parsed.cachedAt || 0),
    };
  } catch {
    return null;
  }
}

function readNotesUiState() {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(UI_STATE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    return {
      activeFolderId: typeof parsed.activeFolderId === 'string' ? parsed.activeFolderId : '',
      mobilePane: ['folders', 'list', 'editor'].includes(parsed.mobilePane) ? parsed.mobilePane : '',
    };
  } catch {
    return {};
  }
}

function writeNotesUiState(next) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(UI_STATE_KEY, JSON.stringify({
      activeFolderId: next?.activeFolderId || ALL_FOLDERS_ID,
      mobilePane: ['folders', 'list', 'editor'].includes(next?.mobilePane) ? next.mobilePane : 'folders',
      updatedAt: Date.now(),
    }));
  } catch {

  }
}

function writeNotesCache(next) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({
      folders: Array.isArray(next?.folders) ? next.folders : [],
      notes: Array.isArray(next?.notes) ? next.notes : [],
      meta: next?.meta || {},
      cachedAt: Date.now(),
    }));
  } catch {

  }
}

function dashboardPreviewFromNotes(notes) {
  return (Array.isArray(notes) ? notes : [])
    .filter((note) => note?.type === 'note' || note?.id)
    .slice()
    .sort((a, b) => {
      const bTime = Date.parse(b?.updatedAt || b?.createdAt || '') || 0;
      const aTime = Date.parse(a?.updatedAt || a?.createdAt || '') || 0;
      return bTime - aTime;
    })
    .slice(0, DASHBOARD_PREVIEW_LIMIT)
    .map((note) => ({
      id: note.id,
      type: 'note',
      title: note.title || 'Untitled',
      folderId: note.folderId || DEFAULT_FOLDER_ID,
      pinned: Boolean(note.pinned),
      locked: Boolean(note.locked),
      system: Boolean(note.system),
      createdAt: note.createdAt || '',
      updatedAt: note.updatedAt || note.createdAt || '',
    }));
}

function writeDashboardNotesPreviewCache(notes) {
  if (typeof window === 'undefined') return;
  try {
    const payload = {
      notes: dashboardPreviewFromNotes(notes),
      cachedAt: Date.now(),
      source: 'notes-ui',
    };
    window.localStorage.setItem(DASHBOARD_NOTES_CACHE_KEY, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent('iclora:notes-preview-updated', { detail: payload }));
  } catch {

  }
}

function normalizePayload(payload = {}) {
  const folders = Array.isArray(payload.folders) && payload.folders.length
    ? payload.folders
    : [{ id: DEFAULT_FOLDER_ID, name: 'Notes', type: 'folder', system: true }];
  const notes = Array.isArray(payload.notes)
    ? payload.notes.map((note) => (
      note?.id === 'welcome-iclora'
        ? { ...note, folderId: DEFAULT_FOLDER_ID, pinned: true, locked: true, system: true }
        : note
    ))
    : [];
  return { folders, notes, meta: payload.meta || {} };
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(date);
}

function notePreview(note) {
  const preview = String(note?.preview || note?.content || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return preview || 'No additional text';
}

function sanitizeDownloadName(value = '', fallback = 'note') {
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

function noteContentToPlainText(content = '') {
  const raw = String(content || '');
  if (!raw) return '';
  if (typeof window !== 'undefined' && window.DOMParser) {
    const parser = new window.DOMParser();
    const doc = parser.parseFromString(raw, 'text/html');
    const body = doc.body;
    if (!body) return raw;
    body.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
    body.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, blockquote, pre').forEach((node) => {
      node.append('\n');
    });
    return (body.textContent || '').replace(/\n{3,}/g, '\n\n').trimEnd();
  }
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toEditorHtml(value = '') {
  const raw = String(value || '');
  if (/<[a-z][\s\S]*>/i.test(raw)) return raw;
  return escapeHtml(raw).replace(/\n/g, '<br>');
}

function createOptimisticNote(folderId) {
  const now = new Date().toISOString();
  return {
    id: `local-${Date.now()}`,
    title: 'New Note',
    content: '',
    preview: '',
    folderId: folderId || DEFAULT_FOLDER_ID,
    pinned: false,
    locked: false,
    system: false,
    createdAt: now,
    updatedAt: now,
  };
}

function isLocalNoteId(id = '') {
  return String(id || '').startsWith('local-');
}

function noteContentSignature(value = '') {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isServerVersionOfPendingNote(serverNote, pendingNote) {
  if (!serverNote?.id || !pendingNote?.id) return false;
  if (isLocalNoteId(serverNote.id) || !isLocalNoteId(pendingNote.id)) return false;
  const sameTitle = String(serverNote.title || 'New Note') === String(pendingNote.title || 'New Note');
  const sameFolder = (serverNote.folderId || DEFAULT_FOLDER_ID) === (pendingNote.folderId || DEFAULT_FOLDER_ID);
  const sameContent = noteContentSignature(serverNote.content) === noteContentSignature(pendingNote.content);
  return sameTitle && sameFolder && sameContent;
}

function reconcileNoteList(nextNotes = [], previousNotes = []) {
  const pendingNotes = [
    ...nextNotes.filter((note) => isLocalNoteId(note?.id)),
    ...previousNotes.filter((note) => isLocalNoteId(note?.id)),
  ];
  const replacedPendingIds = new Set();
  const seenIds = new Set();
  const deduped = [];

  nextNotes.forEach((note) => {
    if (!note?.id) return;
    if (!isLocalNoteId(note.id)) {
      const pendingMatch = pendingNotes.find((pendingNote) => (
        !replacedPendingIds.has(pendingNote.id) && isServerVersionOfPendingNote(note, pendingNote)
      ));
      if (pendingMatch) replacedPendingIds.add(pendingMatch.id);
    }
    if (seenIds.has(note.id)) return;
    seenIds.add(note.id);
    deduped.push(note);
  });

  return deduped.filter((note) => !replacedPendingIds.has(note.id));
}

function titleFromImportFile(file) {
  const rawName = String(file?.name || 'Imported Note').trim();
  const withoutExt = rawName.replace(/\.[^.]+$/, '').trim();
  return (withoutExt || rawName || 'Imported Note').slice(0, 80);
}

function detectCodeLanguage(code = '') {
  const source = String(code || '');
  const lower = source.toLowerCase();
  if (/(^|\n)\s*<!doctype html>|<html|<body|<\/\w+>/.test(lower)) return 'html';
  if (/(^|\n)\s*import\s+react|from\s+['"]react['"]|const\s+\w+\s*=\s*\(/.test(source)) return 'javascript';
  if (/(^|\n)\s*def\s+\w+\(|(^|\n)\s*class\s+\w+\s*[:(]/.test(source) && /:\s*(\n|$)/.test(source)) return 'python';
  if (/(^|\n)\s*func\s+\w+\(|(^|\n)\s*package\s+\w+/.test(source)) return 'go';
  if (/(^|\n)\s*public\s+class\s+\w+|System\.out\.println/.test(source)) return 'java';
  if (/(^|\n)\s*#include\s+<\w+>|std::\w+/.test(source)) return 'cpp';
  if (/(^|\n)\s*SELECT\s+.+\s+FROM\s+/i.test(source)) return 'sql';
  if (/(^|\n)\s*(interface|type)\s+\w+\s*=|:\s*(string|number|boolean)/.test(source)) return 'typescript';
  if (/(^|\n)\s*```/.test(source)) return 'markdown';
  return 'text';
}

function isLikelyCodeBlock(text = '') {
  const source = String(text || '').trim();
  if (!source) return false;
  const lines = source.split('\n');
  if (lines.length < 2) return false;
  const score =
    Number(/[{}();]/.test(source))
    + Number(/(^|\n)\s*(const|let|var|function|class|def|import|from|SELECT|INSERT|UPDATE|CREATE)\b/i.test(source))
    + Number(/(^|\n)\s*[#\-*]\s+\w+/.test(source) && /```/.test(source))
    + Number(/<\/?[a-z][\s\S]*>/i.test(source));
  return score >= 2;
}

function buildCodeBlockHtml(code = '', language = 'text') {
  const escapedCode = escapeHtml(code);
  const safeLanguage = escapeHtml(language || 'text');
  const encoded = encodeURIComponent(code);
  return [
    '<div class="iclora-notes__code-block" contenteditable="false">',
    '<div class="iclora-notes__code-head">',
    `<span class="iclora-notes__code-lang">${safeLanguage}</span>`,
    `<button type="button" class="iclora-notes__code-copy" data-code="${encoded}" aria-label="Copy code">Copy</button>`,
    '</div>',
    `<pre class="iclora-notes__code-pre"><code>${escapedCode}</code></pre>`,
    '</div>',
    '<p class="iclora-notes__after-code"><br></p>',
  ].join('');
}

function safeReadmeUrl(value = '', { image = false } = {}) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^(https?:|mailto:|\/|#)/i.test(url)) return url;
  if (image && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(url)) return url;
  if (/^[./][^\s<>]*$/.test(url)) return url;
  if (!url.includes(':') && /^[\w./#?=&%+~-]+$/.test(url)) return url;
  return '';
}

function renderReadmeImage(src, alt = '') {
  const safeSrc = safeReadmeUrl(src, { image: true });
  if (!safeSrc) return escapeHtml(alt || '');
  return `<img class="iclora-notes__readme-image" src="${escapeHtml(safeSrc)}" alt="${escapeHtml(alt || '')}" loading="lazy" />`;
}

function renderReadmeLink(label, href, options = {}) {
  const safeHref = safeReadmeUrl(href);
  const safeLabel = options.htmlLabel ? String(label || '') : renderReadmeInline(label || href);
  if (!safeHref) return safeLabel;
  return `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noreferrer">${safeLabel}</a>`;
}

function renderReadmeInline(value = '') {
  let source = String(value || '');
  const tokens = [];
  const stash = (html) => {
    const key = `ICLORA_README_TOKEN_${tokens.length}_END`;
    tokens.push(html);
    return key;
  };

  source = source.replace(/`([^`]+)`/g, (_match, code) => stash(`<code>${escapeHtml(code)}</code>`));
  source = source.replace(/\[!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_match, alt, src, href) => (
    stash(renderReadmeLink(renderReadmeImage(src, alt), href, { htmlLabel: true }))
  ));
  source = source.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_match, alt, src) => stash(renderReadmeImage(src, alt)));
  source = source.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_match, label, href) => stash(renderReadmeLink(label, href)));
  source = source.replace(/<img\b([^>]*)>/gi, (match) => {
    const src = match.match(/\bsrc=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    const alt = match.match(/\balt=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    return stash(renderReadmeImage(src?.[1] || src?.[2] || src?.[3] || '', alt?.[1] || alt?.[2] || alt?.[3] || ''));
  });

  let html = escapeHtml(source)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');

  return html.replace(/ICLORA_README_TOKEN_(\d+)_END/g, (_match, index) => tokens[Number(index)] || '');
}

function readmeToRichHtml(text = '') {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let inCode = false;
  let codeLines = [];
  let codeLang = 'text';
  let paragraphLines = [];
  let listType = '';

  function flushParagraph() {
    if (!paragraphLines.length) return;
    html.push(`<p>${renderReadmeInline(paragraphLines.join(' '))}</p>`);
    paragraphLines = [];
  }

  function closeList() {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = '';
  }

  function openList(type) {
    flushParagraph();
    if (listType === type) return;
    closeList();
    html.push(`<${type}>`);
    listType = type;
  }

  lines.forEach((line) => {
    const fence = line.match(/^```([\w+-]*)\s*$/);
    if (fence) {
      if (!inCode) {
        flushParagraph();
        closeList();
        inCode = true;
        codeLang = (fence[1] || 'text').toLowerCase();
        codeLines = [];
      } else {
        html.push(buildCodeBlockHtml(codeLines.join('\n'), codeLang));
        inCode = false;
        codeLines = [];
        codeLang = 'text';
      }
      return;
    }
    if (inCode) {
      codeLines.push(line);
      return;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderReadmeInline(heading[2])}</h${level}>`);
      return;
    }

    if (/^\s*[-*_]{3,}\s*$/.test(line)) {
      flushParagraph();
      closeList();
      html.push('<hr>');
      return;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      return;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    if (unordered) {
      openList('ul');
      html.push(`<li>${renderReadmeInline(unordered[1])}</li>`);
      return;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      openList('ol');
      html.push(`<li>${renderReadmeInline(ordered[1])}</li>`);
      return;
    }

    const quote = line.match(/^\s*>\s?(.+)$/);
    if (quote) {
      flushParagraph();
      closeList();
      html.push(`<blockquote>${renderReadmeInline(quote[1])}</blockquote>`);
      return;
    }

    closeList();
    paragraphLines.push(line.trim());
  });

  flushParagraph();
  closeList();

  if (inCode && codeLines.length) {
    html.push(buildCodeBlockHtml(codeLines.join('\n'), codeLang));
  }

  return html.join('');
}

export default function Notes() {
  const navigate = useNavigate();
  const { noteId = '' } = useParams();
  const { showAlert } = useAlert();
  const cached = useMemo(() => readNotesCache(), []);
  const cachedUiState = useMemo(() => readNotesUiState(), []);
  const profile = useMemo(() => readUserProfileCache(), []);
  const cacheIsStale = Boolean(cached?.cachedAt && Date.now() - cached.cachedAt > CACHE_STALE_MS);
  const [folders, setFolders] = useState(() => normalizePayload(cached || {}).folders);
  const [notes, setNotes] = useState(() => normalizePayload(cached || {}).notes);
  const [activeFolderId, setActiveFolderId] = useState(() => cachedUiState.activeFolderId || ALL_FOLDERS_ID);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(!cached || cacheIsStale);
  const [saveState, setSaveState] = useState('saved');
  const [contentDraft, setContentDraft] = useState('');
  const [folderMenu, setFolderMenu] = useState({ id: '', openUp: false });
  const [nameModal, setNameModal] = useState(null);
  const [nameDraft, setNameDraft] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [noteNameModal, setNoteNameModal] = useState(false);
  const [noteNameMode, setNoteNameMode] = useState('create');
  const [noteNameTarget, setNoteNameTarget] = useState(null);
  const [noteNameDraft, setNoteNameDraft] = useState('');
  const [noteNameSaving, setNoteNameSaving] = useState(false);
  const [noteMenu, setNoteMenu] = useState(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importFiles, setImportFiles] = useState([]);
  const [importingFiles, setImportingFiles] = useState(false);
  const [importDragActive, setImportDragActive] = useState(false);
  const [hardRefreshing, setHardRefreshing] = useState(false);
  const [hardRefreshLocked, setHardRefreshLocked] = useState(false);
  const [folderDownloadingId, setFolderDownloadingId] = useState('');
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [moveFolderId, setMoveFolderId] = useState('');
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [moveSaving, setMoveSaving] = useState(false);
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [downloadNameDraft, setDownloadNameDraft] = useState('');
  const [downloadingFile, setDownloadingFile] = useState(false);
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
    strike: false,
  });
  const [mobileEditorGuard, setMobileEditorGuard] = useState(() => (
    typeof window !== 'undefined' && (
      window.matchMedia?.('(pointer: coarse)').matches
    )
  ));
  const [mobileEditorArmed, setMobileEditorArmed] = useState(false);
  const [mobileEditorEditing, setMobileEditorEditing] = useState(false);
  const [mobilePane, setMobilePane] = useState(() => {
    if (noteId) return 'editor';
    if (cachedUiState.mobilePane === 'editor') return 'list';
    return cachedUiState.mobilePane || 'folders';
  });
  const [accentColor] = useState(() => readAccentColorCache() || '#46a935');
  const saveTimerRef = useRef(null);
  const cacheTimerRef = useRef(null);
  const hardRefreshTimerRef = useRef(null);
  const bodyInputRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressNoteIdRef = useRef('');
  const editorPointerDownRef = useRef({ x: 0, y: 0, time: 0 });
  const editorComposingRef = useRef(false);
  const editorSnapRangeRef = useRef(null);
  const editorFormatRangeRef = useRef(null);
  const pendingMobileEditorRangeRef = useRef(null);
  const editorLastTapRef = useRef({ time: 0, x: 0, y: 0 });
  const editorTapClearTimerRef = useRef(null);
  const editorSelectionDragRef = useRef(false);
  const latestCacheRef = useRef({ folders: normalizePayload(cached || {}).folders, notes: normalizePayload(cached || {}).notes });
  const deletedNoteIdsRef = useRef(new Set());
  const saveSequenceRef = useRef(0);
  const pendingSaveRef = useRef(null);
  const mutationRevisionRef = useRef(0);
  const loadedFromServerRef = useRef(false);
  const editorScrolledDuringGestureRef = useRef(false);
  const applyNotesRef = useRef(null);
  const applyFoldersRef = useRef(null);
  const placeEditorSelectionRef = useRef(null);
  const flushPendingSaveRef = useRef(null);
  const cacheIsStaleRef = useRef(cacheIsStale);
  cacheIsStaleRef.current = cacheIsStale;
  applyNotesRef.current = applyNotes;
  applyFoldersRef.current = applyFolders;
  placeEditorSelectionRef.current = placeEditorSelection;
  flushPendingSaveRef.current = flushPendingSave;

  const selectedNote = useMemo(
    () => (noteId ? notes.find((note) => note.id === noteId) || null : null),
    [noteId, notes]
  );
  const selectedNoteId = selectedNote?.id || '';
  const selectedNoteContent = selectedNote?.content || '';
  const selectedNotePending = Boolean(selectedNote?.id?.startsWith('local-'));
  const selectedNoteLoading = Boolean(noteId) && !selectedNote && loading;
  const selectedNoteReadOnly = Boolean(selectedNote?.system || selectedNote?.locked);
  const selectedNoteEditorDisabled = selectedNoteReadOnly || selectedNotePending;
  const mobileEditorGateActive = mobileEditorGuard && !selectedNoteEditorDisabled;
  const selectedNoteEditorEditable = !selectedNoteEditorDisabled && (!mobileEditorGateActive || mobileEditorEditing);
  const selectedNoteFormatDisabled = selectedNoteEditorDisabled || (mobileEditorGateActive && !mobileEditorEditing);
  const navbarSyncing = loading || selectedNotePending || saveState === 'typing' || saveState === 'saving' || nameSaving || noteNameSaving || importingFiles || deleting || setupLoading;
  const navbarSyncLabel = loading ? 'Loading notes' : saveLabel();
  const activeFolder = folders.find((folder) => folder.id === activeFolderId) || folders[0] || { id: DEFAULT_FOLDER_ID, name: 'Notes', system: true };
  const folderLimitReached = folders.length >= MAX_FOLDERS;

  const filteredNotes = useMemo(() => {
    const text = query.trim().toLowerCase();
    return notes.filter((note) => {
      const inFolder = activeFolderId === ALL_FOLDERS_ID || note.folderId === activeFolderId || (!note.folderId && activeFolderId === DEFAULT_FOLDER_ID);
      const matches = !text || `${note.title} ${note.preview} ${note.content}`.toLowerCase().includes(text);
      return inFolder && matches;
    });
  }, [activeFolderId, notes, query]);
  const pinnedNotes = filteredNotes.filter((note) => note.pinned);
  const regularNotes = filteredNotes.filter((note) => !note.pinned);
  const folderNameById = useMemo(() => {
    const entries = folders.map((folder) => [folder.id, folder.name || 'Notes']);
    return new Map(entries);
  }, [folders]);

  useEffect(() => {
    if (!readSessionToken()) navigate('/auth', { replace: true });
  }, [navigate]);

  useEffect(() => {
    return applyAppPageMeta({
      title: 'iClora Notes',
      lightIcon: '/apps/notes.webp',
      darkIcon: '/apps/notes-dark.webp',
    });
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const viewport = document.querySelector('meta[name="viewport"]');
    const previousViewport = viewport?.getAttribute('content') || '';
    const notesViewport = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content';

    if (viewport) viewport.setAttribute('content', notesViewport);

    return () => {
      if (viewport && previousViewport) viewport.setAttribute('content', previousViewport);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadNotes() {
      const requestRevision = mutationRevisionRef.current;
      try {
        const response = await apiFetch('/notes');
        const json = await response.json().catch(() => ({}));
        if (response.status === 401) {
          if (isStaleSessionResponse(response)) return;
          await clearSignedOutData();
          navigate('/auth', { replace: true });
          return;
        }
        if (response.status === 403 && json?.needsSetup) {
          setSetupRequired(true);
          return;
        }
        if (!response.ok || !json?.ok) throw new Error(json?.error || 'Could not load notes');
        if (cancelled || requestRevision !== mutationRevisionRef.current) return;
        const next = normalizePayload(json);
        const liveNotes = next.notes.filter((note) => !deletedNoteIdsRef.current.has(note.id));
        loadedFromServerRef.current = true;
        applyFoldersRef.current?.(next.folders, { notes: liveNotes, cache: true, immediate: true });
        applyNotesRef.current?.(liveNotes, { folders: next.folders, cache: true, immediate: true });
    } catch (error) {
        if (!cached || cacheIsStaleRef.current) {
          showAlert({ title: 'Notes unavailable', message: error?.message || 'Could not load notes.', type: 'error' });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadNotes();
    return () => {
      cancelled = true;
    };
  }, [cached, navigate, showAlert]);

  useEffect(() => {
    setMobilePane((currentMobilePane) => (noteId ? 'editor' : currentMobilePane === 'editor' ? 'list' : currentMobilePane));
  }, [noteId]);

  useEffect(() => {
    writeNotesUiState({ activeFolderId, mobilePane });
  }, [activeFolderId, mobilePane]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const query = window.matchMedia?.('(pointer: coarse)');
    const updateMobileEditorGuard = () => {
      setMobileEditorGuard(Boolean(query?.matches));
    };

    updateMobileEditorGuard();
    query?.addEventListener?.('change', updateMobileEditorGuard);
    return () => query?.removeEventListener?.('change', updateMobileEditorGuard);
  }, []);

  useEffect(() => {
    pendingMobileEditorRangeRef.current = null;
    editorLastTapRef.current = { time: 0, x: 0, y: 0 };
    window.clearTimeout(editorTapClearTimerRef.current);
    setMobileEditorArmed(false);
    setMobileEditorEditing(false);
  }, [selectedNoteId, mobilePane]);

  useEffect(() => {
    if (!selectedNoteEditorDisabled) return;
    pendingMobileEditorRangeRef.current = null;
    editorLastTapRef.current = { time: 0, x: 0, y: 0 };
    window.clearTimeout(editorTapClearTimerRef.current);
    setMobileEditorArmed(false);
    setMobileEditorEditing(false);
  }, [selectedNoteEditorDisabled]);

  useEffect(() => {
    if (!mobileEditorEditing) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const pendingRange = pendingMobileEditorRangeRef.current;
      pendingMobileEditorRangeRef.current = null;
      if (pendingRange) {
        placeEditorSelectionRef.current?.(pendingRange);
        return;
      }
      bodyInputRef.current?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [mobileEditorEditing]);

  useEffect(() => {
    if (!loadedFromServerRef.current) return;
    if (activeFolderId === ALL_FOLDERS_ID) return;
    if (folders.some((folder) => folder.id === activeFolderId)) return;
    setActiveFolderId(ALL_FOLDERS_ID);
  }, [activeFolderId, folders]);

  useEffect(() => {
    if (!selectedNoteId) {
      setContentDraft('');
      setSaveState('saved');
      setActiveFormats({ bold: false, italic: false, underline: false, strike: false });
      return;
    }
    setContentDraft(selectedNoteContent || '');
    setSaveState('saved');
    setActiveFormats({ bold: false, italic: false, underline: false, strike: false });
  }, [selectedNoteId, selectedNoteContent]);

  useEffect(() => {
    if (!bodyInputRef.current) return;
    bodyInputRef.current.innerHTML = toEditorHtml(selectedNoteContent || '');
  }, [selectedNoteId, selectedNoteContent]);

  useEffect(() => {
    function onSelectionChange() {
      refreshFormatState();
    }
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  useEffect(() => {
    if (!noteMenu) return undefined;
    function closeOnKey(event) {
      if (event.key === 'Escape') setNoteMenu(null);
    }
    function closeOnScroll() {
      setNoteMenu(null);
    }
    window.addEventListener('keydown', closeOnKey);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => {
      window.removeEventListener('keydown', closeOnKey);
      window.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [noteMenu]);

  useEffect(() => {
    if (!folderMenu.id) return undefined;
    function closeFolderMenuOnOutside(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.iclora-notes__folder-wrap')) return;
      setFolderMenu({ id: '', openUp: false });
    }
    window.addEventListener('pointerdown', closeFolderMenuOnOutside);
    return () => window.removeEventListener('pointerdown', closeFolderMenuOnOutside);
  }, [folderMenu.id]);

  useEffect(() => () => {
    flushPendingSaveRef.current?.({ silent: true });
  }, [selectedNoteId]);

  useEffect(() => {
    function flushOnPageExit() {
      flushPendingSaveRef.current?.({ keepalive: true, silent: true });
      writeNotesCache({ ...latestCacheRef.current, meta: {} });
      writeDashboardNotesPreviewCache(latestCacheRef.current.notes);
    }
    window.addEventListener('pagehide', flushOnPageExit);
    return () => window.removeEventListener('pagehide', flushOnPageExit);
  }, []);

  useEffect(() => () => {
    flushPendingSaveRef.current?.({ keepalive: true, silent: true });
    if (cacheTimerRef.current) clearTimeout(cacheTimerRef.current);
    if (hardRefreshTimerRef.current) clearTimeout(hardRefreshTimerRef.current);
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    writeNotesCache({ ...latestCacheRef.current, meta: {} });
    writeDashboardNotesPreviewCache(latestCacheRef.current.notes);
  }, []);

  async function hardRefreshNotesCloud(options = {}) {
    if (hardRefreshing || hardRefreshLocked) return;
    if (options.selectedOnly && (!selectedNoteId || selectedNotePending)) return;
    setHardRefreshing(true);
    setHardRefreshLocked(true);
    if (hardRefreshTimerRef.current) clearTimeout(hardRefreshTimerRef.current);
    hardRefreshTimerRef.current = setTimeout(() => {
      setHardRefreshLocked(false);
      hardRefreshTimerRef.current = null;
    }, HARD_REFRESH_COOLDOWN_MS);

    try {
      const response = await apiFetch('/notes', { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (response.status === 401) {
        if (isStaleSessionResponse(response)) return;
        await clearSignedOutData();
        navigate('/auth', { replace: true });
        return;
      }
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Could not refresh note');
      const next = normalizePayload(json);
      applyFolders(next.folders, { notes: next.notes, cache: true, immediate: true });
      applyNotes(next.notes, { folders: next.folders, cache: true, immediate: true });
      showAlert({
        title: options.selectedOnly ? 'Note refreshed' : 'Notes refreshed',
        message: 'Loaded the latest server version.',
        type: 'success',
      });
    } catch (error) {
      showAlert({ title: 'Refresh failed', message: error?.message || 'Could not refresh notes.', type: 'error' });
    } finally {
      setHardRefreshing(false);
    }
  }

  async function hardRefreshSelectedNote() {
    await hardRefreshNotesCloud({ selectedOnly: true });
  }

  function triggerRefreshTapAnimation(event) {
    const icon = event?.currentTarget?.querySelector?.('svg');
    if (!icon) return;
    icon.classList.remove('is-tap-spinning');

    void icon.offsetWidth;
    icon.classList.add('is-tap-spinning');
    window.setTimeout(() => {
      icon.classList.remove('is-tap-spinning');
    }, 420);
  }

  function openMoveModal() {
    if (!selectedNote || selectedNote.system || selectedNotePending) return;
    setMoveFolderId(selectedNote.folderId || DEFAULT_FOLDER_ID);
    setMovePickerOpen(false);
    setMoveModalOpen(true);
  }

  function closeMoveModal() {
    if (moveSaving) return;
    setMoveModalOpen(false);
    setMoveFolderId('');
    setMovePickerOpen(false);
  }

  function chooseMoveFolder(nextFolderId) {
    setMoveFolderId(nextFolderId);
    setMovePickerOpen(false);
  }

  async function moveSelectedNote() {
    if (!selectedNote || selectedNote.system || selectedNotePending || moveSaving) return;
    const targetFolderId = moveFolderId || DEFAULT_FOLDER_ID;
    if (targetFolderId === (selectedNote.folderId || DEFAULT_FOLDER_ID)) {
      closeMoveModal();
      return;
    }
    setMoveSaving(true);
    markMutation();
    const previousNotes = latestCacheRef.current.notes;
    const optimisticNotes = previousNotes.map((note) => (
      note.id === selectedNote.id
        ? { ...note, folderId: targetFolderId, updatedAt: new Date().toISOString() }
        : note
    ));
    applyNotes(optimisticNotes, { cache: true, immediate: true });
    try {
      const response = await apiFetch(`/notes/${selectedNote.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notePatchBody(selectedNote, { folderId: targetFolderId })),
      });
      const json = await response.json().catch(() => ({}));
      if (response.status === 409 && json?.note) {
        handleSaveConflict(json.note);
        closeMoveModal();
        return;
      }
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Could not move note');
      if (deletedNoteIdsRef.current.has(selectedNote.id)) return;
      const currentNotes = latestCacheRef.current.notes;
      applyNotes(currentNotes.map((note) => (note.id === selectedNote.id ? json.note : note)), { cache: true, immediate: true });
      showAlert({ title: 'Note moved', message: 'Folder updated successfully.', type: 'success' });
      closeMoveModal();
    } catch (error) {
      applyNotes(previousNotes, { cache: true, immediate: true });
      showAlert({ title: 'Move failed', message: error?.message || 'Could not move this note.', type: 'error' });
    } finally {
      setMoveSaving(false);
    }
  }

  async function downloadFolder(folder) {
    if (!folder || folder.system || folderDownloadingId) return;
    setFolderMenu({ id: '', openUp: false });
    setFolderDownloadingId(folder.id);
    try {
      showAlert({ title: 'Download initialized', message: 'Preparing your folder download...', type: 'info' });
      const folderNotes = notes
        .filter((note) => note.folderId === folder.id)
        .sort((a, b) => {
          const bTime = Date.parse(b?.updatedAt || b?.createdAt || '') || 0;
          const aTime = Date.parse(a?.updatedAt || a?.createdAt || '') || 0;
          return bTime - aTime;
        });
      if (!folderNotes.length) {
        showAlert({ title: 'Nothing to download', message: 'This folder has no notes yet.', type: 'info' });
        return;
      }

      const folderName = sanitizeDownloadName(folder.name || 'folder', 'folder');
      const zip = new JSZip();
      const usedNames = new Set();
      folderNotes.forEach((note, index) => {
        const baseName = sanitizeDownloadName(note.title || `Note ${index + 1}`, `Note ${index + 1}`);
        let candidate = baseName;
        let suffix = 2;
        while (usedNames.has(candidate.toLowerCase())) {
          candidate = `${baseName} ${suffix}`;
          suffix += 1;
        }
        usedNames.add(candidate.toLowerCase());
        const body = noteContentToPlainText(note.content || '');
        zip.file(`${candidate}.txt`, body || '(empty note)');
      });

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${folderName}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      showAlert({ title: 'Folder downloaded', message: `${folderNotes.length} ${folderNotes.length === 1 ? 'note' : 'notes'} exported as ZIP.`, type: 'success' });
    } catch (error) {
      showAlert({ title: 'Download failed', message: error?.message || 'Could not download this folder.', type: 'error' });
    } finally {
      setFolderDownloadingId('');
    }
  }

  function openDownloadModal() {
    if (!selectedNote || selectedNotePending || !selectedNoteId) return;
    setDownloadNameDraft(sanitizeDownloadName(selectedNote.title || 'note'));
    setDownloadModalOpen(true);
  }

  function closeDownloadModal() {
    if (downloadingFile) return;
    setDownloadModalOpen(false);
    setDownloadNameDraft('');
  }

  async function downloadSelectedNote() {
    if (!selectedNote || selectedNotePending || downloadingFile) return;
    const nextName = sanitizeDownloadName(downloadNameDraft, sanitizeDownloadName(selectedNote.title || 'note'));
    setDownloadingFile(true);
    try {
      showAlert({ title: 'Download initialized', message: 'Preparing your note download...', type: 'info' });
      const text = noteContentToPlainText(selectedNote.content || '');
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${nextName}.txt`;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      showAlert({ title: 'Downloaded', message: `Saved as ${nextName}.txt`, type: 'success' });
      setDownloadModalOpen(false);
      setDownloadNameDraft('');
    } catch (error) {
      showAlert({ title: 'Download failed', message: error?.message || 'Could not download this note.', type: 'error' });
    } finally {
      setDownloadingFile(false);
    }
  }

  function persistCache(nextNotes = notes, nextFolders = folders, options = {}) {
    const liveNotes = nextNotes.filter((note) => !deletedNoteIdsRef.current.has(note.id));
    const payload = { folders: nextFolders, notes: liveNotes, meta: {} };
    latestCacheRef.current = payload;
    if (cacheTimerRef.current) clearTimeout(cacheTimerRef.current);
    if (options.immediate) {
      writeNotesCache(payload);
      writeDashboardNotesPreviewCache(nextNotes);
      return;
    }
    cacheTimerRef.current = setTimeout(() => {
      writeNotesCache(latestCacheRef.current);
      writeDashboardNotesPreviewCache(latestCacheRef.current.notes);
      cacheTimerRef.current = null;
    }, CACHE_IDLE_MS);
  }

  function markMutation() {
    mutationRevisionRef.current += 1;
  }

  function cancelPendingSave() {
    saveSequenceRef.current += 1;
    pendingSaveRef.current = null;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }

  function notePatchBody(note, patch = {}) {
    return {
      title: patch.title ?? note?.title ?? 'Untitled',
      content: patch.content ?? (typeof note?.content === 'string' ? note.content : ''),
      folderId: patch.folderId ?? note?.folderId ?? DEFAULT_FOLDER_ID,
      pinned: patch.pinned ?? Boolean(note?.pinned),
      baseUpdatedAt: note?.updatedAt || '',
    };
  }

  function handleSaveConflict(latestNote) {
    pendingSaveRef.current = null;
    setSaveState('error');
    if (latestNote?.id) {
      const currentNotes = latestCacheRef.current.notes;
      applyNotes(currentNotes.map((note) => (note.id === latestNote.id ? latestNote : note)), { cache: true, immediate: true });
    }
    showAlert({
      title: 'Note changed elsewhere',
      message: 'A newer version was found. I loaded it so you do not overwrite another device.',
      type: 'info',
    });
  }

  async function sendPendingSave(payload, options = {}) {
    if (!payload?.noteId) return null;
    const response = await apiFetch(`/notes/${payload.noteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload.body || {}),
      keepalive: Boolean(options.keepalive),
    });
    const json = await response.json().catch(() => ({}));
    if (response.status === 409 && json?.note) {
      if (!options.keepalive) handleSaveConflict(json.note);
      return null;
    }
    if (!response.ok || !json?.ok) throw new Error(json?.error || 'Could not save note');
    return json.note || null;
  }

  function flushPendingSave(options = {}) {
    const pending = pendingSaveRef.current;
    if (!pending) return;
    const shouldUpdateUi = !options.keepalive;
    pendingSaveRef.current = null;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (shouldUpdateUi) setSaveState('saving');
    sendPendingSave(pending, options)
      .then((savedNote) => {
        if (!shouldUpdateUi) return;
        if (!savedNote || deletedNoteIdsRef.current.has(pending.noteId)) return;
        if (!latestCacheRef.current.notes.some((note) => note.id === pending.noteId)) return;
        const savedNotes = latestCacheRef.current.notes.map((note) => (note.id === pending.noteId ? savedNote : note));
        applyNotes(savedNotes, { cache: true, immediate: true });
        setSaveState('saved');
      })
      .catch((error) => {
        if (!shouldUpdateUi) return;
        setSaveState('error');
        if (!options.silent) {
          showAlert({ title: 'Save failed', message: error?.message || 'Could not save note.', type: 'error' });
        }
      });
  }

  function applyNotes(nextNotes, options = {}) {
    const nextFolders = options.folders || latestCacheRef.current.folders;
    const reconciledNotes = reconcileNoteList(nextNotes, latestCacheRef.current.notes);
    const liveNotes = options.allowDeleted ? reconciledNotes : reconciledNotes.filter((note) => !deletedNoteIdsRef.current.has(note.id));
    latestCacheRef.current = { folders: nextFolders, notes: liveNotes };
    setNotes(liveNotes);
    if (options.dashboard !== false) {
      writeDashboardNotesPreviewCache(liveNotes);
    }
    if (options.cache) {
      persistCache(liveNotes, nextFolders, { immediate: options.immediate });
    }
  }

  function applyFolders(nextFolders, options = {}) {
    const reconciledNotes = reconcileNoteList(options.notes || latestCacheRef.current.notes, latestCacheRef.current.notes);
    const nextNotes = reconciledNotes.filter((note) => !deletedNoteIdsRef.current.has(note.id));
    latestCacheRef.current = { folders: nextFolders, notes: nextNotes };
    setFolders(nextFolders);
    if (options.cache) {
      persistCache(nextNotes, nextFolders, { immediate: options.immediate });
    }
  }

  async function activateNotes() {
    if (setupLoading) return;
    setSetupLoading(true);
    try {
      const setupResponse = await apiFetch('/notes/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const setupJson = await setupResponse.json().catch(() => ({}));
      if (!setupResponse.ok || !setupJson?.ok) throw new Error(setupJson?.error || 'Could not activate Notes');

      const notesResponse = await apiFetch('/notes');
      const notesJson = await notesResponse.json().catch(() => ({}));
      if (!notesResponse.ok || !notesJson?.ok) throw new Error(notesJson?.error || 'Could not load Notes');
      const next = normalizePayload(notesJson);
      applyFolders(next.folders, { notes: next.notes, cache: true, immediate: true });
      applyNotes(next.notes, { folders: next.folders, cache: true, immediate: true });
      setSetupRequired(false);
      setMobilePane('folders');
    } catch (error) {
      showAlert({ title: 'Notes setup failed', message: error?.message || 'Could not activate Notes right now.', type: 'error' });
    } finally {
      setSetupLoading(false);
      setLoading(false);
    }
  }

  function selectFolder(folderId) {
    setActiveFolderId(folderId);
    setFolderMenu({ id: '', openUp: false });
    setMobilePane('list');
    navigate('/cloud/apps/notes/u', { replace: true });
  }

  function openNameModal(mode, folder = null) {
    setFolderMenu({ id: '', openUp: false });
    if (mode === 'create' && folders.length >= MAX_FOLDERS) {
      showAlert({ title: 'Folder limit reached', message: `You can keep up to ${MAX_FOLDERS} folders. Delete one before creating another.`, type: 'info' });
      return;
    }
    setNameModal({ mode, folder });
    setNameDraft(mode === 'rename' ? folder?.name || '' : 'New Folder');
  }

  function closeNameModal() {
    if (nameSaving) return;
    setNameModal(null);
    setNameDraft('');
  }

  async function submitFolderName() {
    const name = nameDraft.trim();
    if (!name || !nameModal) return;
    setNameSaving(true);
    try {
      markMutation();
      const isRename = nameModal.mode === 'rename';
      if (!isRename && latestCacheRef.current.folders.length >= MAX_FOLDERS) {
        throw new Error(`Folder limit reached. You can create up to ${MAX_FOLDERS} folders.`);
      }
      const response = await apiFetch(isRename ? `/notes/folders/${nameModal.folder.id}` : '/notes/folders', {
        method: isRename ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Could not save folder');
      const currentFolders = latestCacheRef.current.folders;
      const nextFolders = isRename
        ? currentFolders.map((folder) => (folder.id === json.folder.id ? json.folder : folder))
        : [...currentFolders, json.folder];
      applyFolders(nextFolders, { cache: true });
      setActiveFolderId(json.folder.id);
      setMobilePane('list');
      closeNameModal();
    } catch (error) {
      showAlert({ title: 'Folder failed', message: error?.message || 'Could not save folder.', type: 'error' });
    } finally {
      setNameSaving(false);
    }
  }

  function openNoteNameModal() {
    setNoteNameMode('create');
    setNoteNameTarget(null);
    setNoteNameModal(true);
    setNoteNameDraft('');
  }

  function closeNoteNameModal() {
    if (noteNameSaving) return;
    setNoteNameModal(false);
    setNoteNameMode('create');
    setNoteNameTarget(null);
    setNoteNameDraft('');
  }

  function openImportModal() {
    setImportFiles([]);
    setImportDragActive(false);
    setImportModalOpen(true);
  }

  function closeImportModal() {
    if (importingFiles) return;
    setImportModalOpen(false);
    setImportFiles([]);
    setImportDragActive(false);
  }

  function mergeImportFiles(files) {
    if (!Array.isArray(files) || !files.length) return;
    setImportFiles((prev) => {
      const next = [...prev];
      files.forEach((file) => {
        const duplicate = next.some(
          (existing) => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified
        );
        if (!duplicate) next.push(file);
      });
      return next;
    });
  }

  function handleImportFileChange(event) {
    const files = Array.from(event.target.files || []);
    mergeImportFiles(files);
    event.target.value = '';
  }

  function handleImportDragOver(event) {
    event.preventDefault();
    setImportDragActive(true);
  }

  function handleImportDragLeave(event) {
    event.preventDefault();
    const nextTarget = event.relatedTarget;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    setImportDragActive(false);
  }

  function handleImportDrop(event) {
    event.preventDefault();
    setImportDragActive(false);
    const files = Array.from(event.dataTransfer?.files || []);
    mergeImportFiles(files);
  }

  async function importTextFiles() {
    if (!importFiles.length || importingFiles) return;
    setImportingFiles(true);
    markMutation();
    const targetFolderId = activeFolder.id === ALL_FOLDERS_ID ? DEFAULT_FOLDER_ID : activeFolder.id;
    const importedNotes = [];
    const failedFiles = [];

    for (const file of importFiles) {
      try {
        const sourceText = await file.text();
        const isReadmeLike = /^readme(\.|$)/i.test(file.name || '') || /\.md$/i.test(file.name || '') || /\.markdown$/i.test(file.name || '');
        const content = isReadmeLike ? readmeToRichHtml(sourceText) : sourceText;
        const response = await apiFetch('/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: titleFromImportFile(file),
            content,
            folderId: targetFolderId,
          }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json?.ok || !json?.note) throw new Error(json?.error || 'Import failed');
        importedNotes.push(json.note);
      } catch {
        failedFiles.push(file?.name || 'Unknown file');
      }
    }

    if (importedNotes.length) {
      const nextNotes = [
        ...importedNotes,
        ...latestCacheRef.current.notes.filter((note) => !importedNotes.some((imported) => imported.id === note.id)),
      ];
      applyNotes(nextNotes, { cache: true, immediate: true });
      setMobilePane('editor');
      navigate(`/cloud/apps/notes/u/${importedNotes[0].id}`);
    }

    setImportingFiles(false);
    setImportModalOpen(false);
    setImportFiles([]);
    if (failedFiles.length) {
      showAlert({
        title: importedNotes.length ? 'Imported with issues' : 'Import failed',
        message: importedNotes.length
          ? `${importedNotes.length} imported, ${failedFiles.length} failed.`
          : 'Could not import the selected files.',
        type: importedNotes.length ? 'info' : 'error',
      });
    } else {
      showAlert({
        title: 'Import complete',
        message: `${importedNotes.length} ${importedNotes.length === 1 ? 'note' : 'notes'} imported.`,
        type: 'success',
      });
    }
  }

  function editorTextToHtml(text = '') {
    return String(text || '')
      .replace(/\r\n/g, '\n')
      .split(/\n{2,}/)
      .map((block) => {
        const lines = block.split('\n');
        return `<p>${lines.map((line) => line ? escapeHtml(line) : '<br>').join('<br>')}</p>`;
      })
      .join('');
  }

  function insertHtmlAtCursor(html) {
    const editor = bodyInputRef.current;
    if (!editor) return false;
    editor.focus({ preventScroll: true });
    const selection = window.getSelection();
    let range = null;
    if (selection && selection.rangeCount > 0 && editor.contains(selection.anchorNode)) {
      range = selection.getRangeAt(0);
    } else {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    if (!selection || !range) return false;
    range.deleteContents();
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    const fragment = document.createDocumentFragment();
    let node = wrapper.firstChild;
    let lastNode = null;
    while (node) {
      lastNode = fragment.appendChild(node);
      node = wrapper.firstChild;
    }
    range.insertNode(fragment);
    if (lastNode) {
      if (lastNode.nodeType === Node.ELEMENT_NODE && ['P', 'DIV', 'LI'].includes(lastNode.nodeName)) {
        range.selectNodeContents(lastNode);
        range.collapse(false);
      } else {
        range.setStartAfter(lastNode);
        range.collapse(true);
      }
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return true;
  }

  function handleEditorPaste(event) {
    if (!selectedNote || selectedNoteEditorDisabled) return;
    const pasted = event.clipboardData?.getData('text/plain') || '';
    event.preventDefault();
    const html = isLikelyCodeBlock(pasted)
      ? buildCodeBlockHtml(pasted, detectCodeLanguage(pasted))
      : editorTextToHtml(pasted);
    insertHtmlAtCursor(html);
    const nextContent = bodyInputRef.current?.innerHTML || '';
    setContentDraft(nextContent);
    scheduleSave(nextContent);
    window.requestAnimationFrame(refreshFormatState);
  }

  function getLineTextSegments(editor) {
    if (typeof document === 'undefined') return [];

    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const segments = [];

    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      if (!String(textNode.textContent || '').length) continue;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rects = Array.from(range.getClientRects());
      for (const rect of rects) {
        if (rect.width <= 0 || rect.height <= 0) continue;
        segments.push({ textNode, rect });
      }
      range.detach?.();
    }

    return segments;
  }

  function lineDistanceFromPoint(rect, y) {
    if (y < rect.top) return rect.top - y;
    if (y > rect.bottom) return y - rect.bottom;
    return 0;
  }

  function getNearestLineSegments(editor, y, options = {}) {
    const segments = getLineTextSegments(editor);
    if (!segments.length) return [];

    const nearestDistance = Math.min(...segments.map(({ rect }) => lineDistanceFromPoint(rect, y)));
    const nearestHeight = segments.reduce((height, { rect }) => (
      lineDistanceFromPoint(rect, y) === nearestDistance ? Math.max(height, rect.height) : height
    ), 0);
    const maxDistance = options.relaxed
      ? Math.max(34, Math.min(54, nearestHeight * 2.1))
      : Math.max(10, Math.min(30, nearestHeight * 1.25));
    if (nearestDistance > maxDistance) return [];

    return segments.filter(({ rect }) => lineDistanceFromPoint(rect, y) <= nearestDistance + 4);
  }

  function isPointerNearEditorText(editor, x, y) {
    const lineSegments = getNearestLineSegments(editor, y, { relaxed: true });
    if (!lineSegments.length) return false;

    const editorRect = editor.getBoundingClientRect();
    const minLeft = Math.min(...lineSegments.map(({ rect }) => rect.left));
    const maxRight = Math.max(...lineSegments.map(({ rect }) => rect.right));
    const leftLimit = Math.max(editorRect.left, minLeft) - 8;
    return x >= leftLimit && x <= maxRight + 8;
  }

  function getTextNodeLineEndRange(textNode, y) {
    const text = String(textNode.textContent || '');
    if (!text.length) return null;

    const probe = document.createRange();
    let bestOffset = -1;
    let bestRight = -Infinity;

    for (let offset = 0; offset < text.length; offset += 1) {
      probe.setStart(textNode, offset);
      probe.setEnd(textNode, offset + 1);
      const rects = Array.from(probe.getClientRects());
      for (const rect of rects) {
        const sameLine = y >= rect.top - 3 && y <= rect.bottom + 3;
        if (!sameLine || rect.width <= 0) continue;
        if (rect.right >= bestRight) {
          bestRight = rect.right;
          bestOffset = offset + 1;
        }
      }
    }

    probe.detach?.();
    if (bestOffset < 0) return null;

    const range = document.createRange();
    range.setStart(textNode, bestOffset);
    range.collapse(true);
    return range;
  }

  function getEditorBoundaryRange(editor, y) {
    const range = document.createRange();
    range.selectNodeContents(editor);

    const segments = getLineTextSegments(editor);
    if (!segments.length) {
      range.collapse(false);
      return range;
    }

    const firstTop = Math.min(...segments.map(({ rect }) => rect.top));
    range.collapse(y < firstTop ? true : false);
    return range;
  }

  function getLineEndRangeFromFarClick(editor, x, y) {
    const lineSegments = getNearestLineSegments(editor, y, { relaxed: true });
    if (!lineSegments.length) return null;

    const editorRect = editor.getBoundingClientRect();
    if (x < editorRect.left || x > editorRect.right || y < editorRect.top || y > editorRect.bottom) return null;

    const minLeft = Math.min(...lineSegments.map(({ rect }) => rect.left));
    const maxRight = Math.max(...lineSegments.map(({ rect }) => rect.right));
    if (x < Math.max(editorRect.left, minLeft) - 10) return null;
    if (x <= maxRight + 2) return null;

    const rightmostSegment = lineSegments.reduce((best, next) => (
      next.rect.right >= best.rect.right ? next : best
    ));
    const lineY = rightmostSegment.rect.top + (rightmostSegment.rect.height / 2);
    return getTextNodeLineEndRange(rightmostSegment.textNode, lineY);
  }

  function placeEditorSelection(range) {
    const editor = bodyInputRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || !range) return false;
    editor.focus({ preventScroll: true });
    selection.removeAllRanges();
    selection.addRange(range);
    window.requestAnimationFrame(refreshFormatState);
    return true;
  }

  function shouldIgnoreEditorSnap(target) {
    if (!target) return true;
    const editor = bodyInputRef.current;
    const blocked = target.closest('button, a, input, textarea, .iclora-notes__editor-toolbar, .iclora-notes__code-block, [contenteditable="false"]');
    if (!blocked) return false;
    return blocked !== editor;
  }

  function getEditorSnapRange(x, y) {
    const editor = bodyInputRef.current;
    if (!editor) return null;
    const lineEndRange = getLineEndRangeFromFarClick(editor, x, y);
    if (lineEndRange) return lineEndRange;
    if (!isPointerNearEditorText(editor, x, y)) return getEditorBoundaryRange(editor, y);
    return null;
  }

  function commitEditorSnap(range) {
    if (!range) return false;
    editorSnapRangeRef.current = range.cloneRange();
    placeEditorSelection(range);
    window.requestAnimationFrame(() => {
      if (editorSnapRangeRef.current) placeEditorSelection(editorSnapRangeRef.current);
    });
    window.setTimeout(() => {
      if (editorSnapRangeRef.current) placeEditorSelection(editorSnapRangeRef.current);
      editorSnapRangeRef.current = null;
    }, 0);
    window.setTimeout(() => {
      if (editorSnapRangeRef.current) {
        placeEditorSelection(editorSnapRangeRef.current);
        editorSnapRangeRef.current = null;
      }
    }, 60);
    return true;
  }

  function handleEditorPointerMove(event) {
    const editor = bodyInputRef.current;
    if (!editor || event.pointerType === 'touch') return;
    const overText = isPointerNearEditorText(editor, event.clientX, event.clientY);
    editor.classList.toggle('is-over-text-line', overText);
  }

  function handleEditorPointerLeave() {
    bodyInputRef.current?.classList.remove('is-over-text-line');
  }

  function suppressEditorNativeMenu(event) {
    const editor = bodyInputRef.current;
    const target = event.target instanceof Element ? event.target : null;
    if (!editor || !target) return;
    if (!editor.contains(target) && !target.closest('.iclora-notes__editor-toolbar')) return;
    event.preventDefault();
  }

  function holdEditorSelection(event) {
    event.preventDefault();
    const editor = bodyInputRef.current;
    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    if (!editor || !selection || selection.rangeCount === 0) return;
    if (editor.contains(selection.anchorNode) || editor.contains(selection.focusNode)) {
      editorFormatRangeRef.current = selection.getRangeAt(0).cloneRange();
    }
  }

  function handleEditorPointerDown(event) {
    if (selectedNoteEditorDisabled || (event.button !== 0 && event.pointerType !== 'touch')) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!bodyInputRef.current || !target || shouldIgnoreEditorSnap(target)) return;
    editorPointerDownRef.current = { x: event.clientX, y: event.clientY, time: Date.now() };
    editorSelectionDragRef.current = false;
    editorScrolledDuringGestureRef.current = false;
    if (mobileEditorGateActive && !mobileEditorEditing) return;
    const snapRange = getEditorSnapRange(event.clientX, event.clientY);
    if (snapRange) {
      event.preventDefault();
      event.stopPropagation();
      commitEditorSnap(snapRange);
    }
  }

  function handleEditorPointerUp(event) {
    if (!bodyInputRef.current || selectedNoteEditorDisabled) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || shouldIgnoreEditorSnap(target)) return;
    const start = editorPointerDownRef.current;
    const moved = Math.abs(event.clientX - start.x) > 6 || Math.abs(event.clientY - start.y) > 6;
    const scrolled = editorScrolledDuringGestureRef.current;
    if (moved || scrolled || Date.now() - start.time > 700) {
      editorSelectionDragRef.current = moved;
      if (moved) {
        window.setTimeout(() => {
          editorSelectionDragRef.current = false;
        }, 0);
      }
      if (mobileEditorGateActive && !mobileEditorEditing && (moved || scrolled)) {
        editorLastTapRef.current = { time: 0, x: 0, y: 0 };
        window.clearTimeout(editorTapClearTimerRef.current);
        setMobileEditorArmed(false);
      }
      return;
    }
    if (mobileEditorGateActive && !mobileEditorEditing) {
      event.preventDefault();
      event.stopPropagation();
      const now = Date.now();
      const lastTap = editorLastTapRef.current;
      const nearPreviousTap = (
        now - lastTap.time <= 420
        && Math.abs(event.clientX - lastTap.x) <= 28
        && Math.abs(event.clientY - lastTap.y) <= 28
      );
      if (nearPreviousTap) {
        const snapRange = getEditorSnapRange(event.clientX, event.clientY);
        pendingMobileEditorRangeRef.current = snapRange ? snapRange.cloneRange() : null;
        editorLastTapRef.current = { time: 0, x: 0, y: 0 };
        window.clearTimeout(editorTapClearTimerRef.current);
        flushSync(() => {
          setMobileEditorArmed(false);
          setMobileEditorEditing(true);
        });
        if (snapRange) {
          placeEditorSelection(snapRange);
        } else {
          bodyInputRef.current?.focus({ preventScroll: true });
        }
      } else {
        editorLastTapRef.current = { time: now, x: event.clientX, y: event.clientY };
        pendingMobileEditorRangeRef.current = null;
        bodyInputRef.current?.blur();
        setMobileEditorArmed(true);
        window.clearTimeout(editorTapClearTimerRef.current);
        editorTapClearTimerRef.current = window.setTimeout(() => {
          editorLastTapRef.current = { time: 0, x: 0, y: 0 };
          setMobileEditorArmed(false);
        }, 520);
      }
      return;
    }
    const snapRange = getEditorSnapRange(event.clientX, event.clientY);
    if (snapRange) {
      event.preventDefault();
      event.stopPropagation();
      commitEditorSnap(snapRange);
    }
  }

  function handleEditorSurfaceClick(event) {
    if (!bodyInputRef.current || selectedNoteEditorDisabled) return;
    if (editorScrolledDuringGestureRef.current) return;
    if (editorSelectionDragRef.current) {
      editorSelectionDragRef.current = false;
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (!target || shouldIgnoreEditorSnap(target)) return;
    if (mobileEditorGateActive && !mobileEditorEditing) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const snapRange = getEditorSnapRange(event.clientX, event.clientY);
    if (!snapRange) return;
    event.preventDefault();
    event.stopPropagation();
    commitEditorSnap(snapRange);
  }

  function handleEditorScroll() {
    bodyInputRef.current?.classList.remove('is-over-text-line');
    editorScrolledDuringGestureRef.current = true;
  }

  function handleEditorCompositionStart() {
    editorComposingRef.current = true;
  }

  function handleEditorCompositionEnd(event) {
    editorComposingRef.current = false;
    updateRichContent(event.currentTarget.innerHTML);
  }

  async function handleEditorClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const copyBtn = target?.closest('.iclora-notes__code-copy');
    if (!copyBtn) return;
    event.preventDefault();
    const encoded = copyBtn.getAttribute('data-code') || '';
    const code = decodeURIComponent(encoded);
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const temp = document.createElement('textarea');
        temp.value = code;
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
      }
      copyBtn.classList.add('is-copied');
      copyBtn.textContent = 'Copied';
      window.setTimeout(() => {
        copyBtn.classList.remove('is-copied');
        copyBtn.textContent = 'Copy';
      }, 1400);
    } catch {
      showAlert({ title: 'Copy failed', message: 'Could not copy this code block.', type: 'error' });
    }
  }

  async function createNote() {
    const targetFolderId = activeFolder.id === ALL_FOLDERS_ID ? DEFAULT_FOLDER_ID : activeFolder.id;
    const optimistic = createOptimisticNote(targetFolderId);
    setNoteNameSaving(true);
    markMutation();
    if (noteNameDraft.trim()) {
      optimistic.title = noteNameDraft.trim();
    }
    const previousNotes = latestCacheRef.current.notes;
    const nextNotes = [optimistic, ...previousNotes];
    applyNotes(nextNotes, { cache: true });
    setMobilePane('editor');
    navigate(`/cloud/apps/notes/u/${optimistic.id}`);
    setNoteNameModal(false);
    setNoteNameDraft('');
    try {
      const response = await apiFetch('/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: optimistic.title, content: '', folderId: optimistic.folderId }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Could not create note');
      if (deletedNoteIdsRef.current.has(optimistic.id)) {
        if (json.note?.id) {
          deletedNoteIdsRef.current.add(json.note.id);
          apiFetch(`/notes/${json.note.id}`, { method: 'DELETE' }).catch(() => {});
        }
        return;
      }
      const currentNotes = latestCacheRef.current.notes;
      const replaced = currentNotes.some((note) => note.id === optimistic.id)
        ? currentNotes.map((note) => (note.id === optimistic.id ? json.note : note))
        : [json.note, ...currentNotes];
      applyNotes(replaced, { cache: true });
      navigate(`/cloud/apps/notes/u/${json.note.id}`, { replace: true });
    } catch (error) {
      const withoutOptimistic = latestCacheRef.current.notes.filter((note) => note.id !== optimistic.id);
      applyNotes(withoutOptimistic, { cache: true, immediate: true });
      showAlert({ title: 'Note failed', message: error?.message || 'Could not create note.', type: 'error' });
    } finally {
      setNoteNameSaving(false);
    }
  }

  function openRenameNoteModal(menuNote) {
    if (!menuNote || menuNote.system || menuNote.id.startsWith('local-')) return;
    setNoteMenu(null);
    setNoteNameMode('rename');
    setNoteNameTarget(menuNote);
    setNoteNameDraft(menuNote.title || '');
    setNoteNameModal(true);
  }

  async function renameNote() {
    if (!noteNameTarget || noteNameTarget.system || noteNameSaving) return;
    const nextTitle = noteNameDraft.trim();
    if (!nextTitle) return;
    setNoteNameSaving(true);
    markMutation();
    const previousNotes = latestCacheRef.current.notes;
    const optimisticNotes = previousNotes.map((note) => (
      note.id === noteNameTarget.id ? { ...note, title: nextTitle, updatedAt: new Date().toISOString() } : note
    ));
    applyNotes(optimisticNotes, { cache: true });
    try {
      const response = await apiFetch(`/notes/${noteNameTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notePatchBody(noteNameTarget, { title: nextTitle })),
      });
      const json = await response.json().catch(() => ({}));
      if (response.status === 409 && json?.note) {
        handleSaveConflict(json.note);
        closeNoteNameModal();
        return;
      }
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Could not rename note');
      if (deletedNoteIdsRef.current.has(noteNameTarget.id)) return;
      const currentNotes = latestCacheRef.current.notes;
      applyNotes(currentNotes.map((note) => (note.id === noteNameTarget.id ? json.note : note)), { cache: true });
      closeNoteNameModal();
    } catch (error) {
      applyNotes(previousNotes, { cache: true, immediate: true });
      showAlert({ title: 'Rename failed', message: error?.message || 'Could not rename note.', type: 'error' });
    } finally {
      setNoteNameSaving(false);
    }
  }

  function scheduleSave(nextContent) {
    if (!selectedNote || selectedNoteReadOnly || selectedNote.id.startsWith('local-')) return;
    markMutation();
    const updatedAt = new Date().toISOString();
    const noteToSave = selectedNote;
    const stableTitle = selectedNote.title || 'Untitled';
    const nextNotes = latestCacheRef.current.notes.map((note) => (
      note.id === selectedNote.id
        ? { ...note, title: stableTitle, content: nextContent, preview: notePreview({ content: nextContent }), updatedAt }
        : note
    ));
    applyNotes(nextNotes, { cache: true });
    setSaveState('typing');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const saveId = saveSequenceRef.current + 1;
    saveSequenceRef.current = saveId;
    pendingSaveRef.current = {
      noteId: noteToSave.id,
      body: notePatchBody(noteToSave, { title: stableTitle, content: nextContent }),
      saveId,
    };
    saveTimerRef.current = setTimeout(async () => {
      setSaveState('saving');
      const pending = pendingSaveRef.current;
      if (!pending || pending.saveId !== saveId) return;
      pendingSaveRef.current = null;
      saveTimerRef.current = null;
      try {
        const savedNote = await sendPendingSave(pending);
        if (saveId !== saveSequenceRef.current) return;
        if (deletedNoteIdsRef.current.has(noteToSave.id) || !latestCacheRef.current.notes.some((note) => note.id === noteToSave.id)) return;
        if (!savedNote) return;
        const savedNotes = latestCacheRef.current.notes.map((note) => (note.id === noteToSave.id ? savedNote : note));
        applyNotes(savedNotes, { cache: true });
        setSaveState('saved');
      } catch (error) {
        if (saveId !== saveSequenceRef.current) return;
        setSaveState('error');
        showAlert({ title: 'Save failed', message: error?.message || 'Could not save note.', type: 'error' });
      }
    }, SAVE_IDLE_MS);
  }

  function openDeleteNote() {
    if (!selectedNote) return;
    if (selectedNote.system) {
      showAlert({ title: 'Main note is locked', message: 'This iClora welcome note is pinned and cannot be edited or deleted.', type: 'info' });
      return;
    }
    setDeleteTarget({ type: 'note', id: selectedNote.id, name: selectedNote.title || 'Untitled' });
  }

  function openNoteMenu(event, note) {
    if (!note || note.system || note.id.startsWith('local-')) return;
    event.preventDefault();
    event.stopPropagation();
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 768;
    const margin = 12;
    const menuWidth = 184;
    const menuHeight = 142;
    const x = Math.max(margin, Math.min(event.clientX, viewportWidth - menuWidth - margin));
    const y = Math.max(margin, Math.min(event.clientY, viewportHeight - menuHeight - margin));
    setNoteMenu({ noteId: note.id, x, y });
  }

  function deleteMenuNote(menuNote) {
    if (!menuNote) return;
    setNoteMenu(null);
    if (menuNote.system) {
      showAlert({ title: 'Main note is locked', message: 'This iClora welcome note is pinned and cannot be deleted.', type: 'info' });
      return;
    }
    setDeleteTarget({ type: 'note', id: menuNote.id, name: menuNote.title || 'Untitled' });
  }

  async function updateNoteFields(targetNote, patch, options = {}) {
    if (!targetNote || targetNote.system || targetNote.locked || targetNote.id.startsWith('local-')) return;
    markMutation();
    const previousNotes = latestCacheRef.current.notes;
    const updatedAt = new Date().toISOString();
    const optimisticNotes = previousNotes.map((note) => (
      note.id === targetNote.id ? { ...note, ...patch, updatedAt } : note
    ));
    applyNotes(optimisticNotes, { cache: true, immediate: options.immediate });
    try {
      const response = await apiFetch(`/notes/${targetNote.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notePatchBody(targetNote, patch)),
      });
      const json = await response.json().catch(() => ({}));
      if (response.status === 409 && json?.note) {
        handleSaveConflict(json.note);
        return;
      }
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Could not update note');
      if (deletedNoteIdsRef.current.has(targetNote.id)) return;
      const currentNotes = latestCacheRef.current.notes;
      applyNotes(currentNotes.map((note) => (note.id === targetNote.id ? json.note : note)), { cache: true, immediate: options.immediate });
    } catch (error) {
      applyNotes(previousNotes, { cache: true, immediate: true });
      showAlert({ title: options.errorTitle || 'Note failed', message: error?.message || 'Could not update note.', type: 'error' });
    }
  }

  function toggleMenuNotePin(menuNote) {
    if (!menuNote) return;
    setNoteMenu(null);
    updateNoteFields(menuNote, { pinned: !menuNote.pinned }, { errorTitle: 'Pin failed' });
  }

  function applySelectionFormat(kind) {
    if (!selectedNote || selectedNoteFormatDisabled) return;
    const input = bodyInputRef.current;
    if (!input) return;
    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    const selectionInsideEditor = Boolean(
      selection
      && selection.rangeCount > 0
      && (input.contains(selection.anchorNode) || input.contains(selection.focusNode))
    );
    if (!selectionInsideEditor && editorFormatRangeRef.current) {
      selection?.removeAllRanges();
      selection?.addRange(editorFormatRangeRef.current.cloneRange());
    }
    input.focus({ preventScroll: true });
    const commands = {
      bold: 'bold',
      italic: 'italic',
      underline: 'underline',
      strike: 'strikeThrough',
    };
    const command = commands[kind];
    if (!command) return;
    document.execCommand(command, false);
    const nextContent = input.innerHTML;
    setContentDraft(nextContent);
    scheduleSave(nextContent);
    window.requestAnimationFrame(refreshFormatState);
  }

  function updateRichContent(value) {
    if (selectedNotePending || editorComposingRef.current) return;
    setContentDraft(value);
    scheduleSave(value);
    window.requestAnimationFrame(refreshFormatState);
  }

  function refreshFormatState() {
    const editor = bodyInputRef.current;
    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    if (!editor || !selection || selection.rangeCount === 0) {
      setActiveFormats({ bold: false, italic: false, underline: false, strike: false });
      return;
    }
    const insideEditor = editor.contains(selection.anchorNode) || editor.contains(selection.focusNode);
    if (!insideEditor) {
      setActiveFormats({ bold: false, italic: false, underline: false, strike: false });
      return;
    }
    editorFormatRangeRef.current = selection.getRangeAt(0).cloneRange();
    setActiveFormats({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      strike: document.queryCommandState('strikeThrough'),
    });
  }

  function openDeleteFolder(folder) {
    setFolderMenu({ id: '', openUp: false });
    if (!folder || folder.system) return;
    setDeleteTarget({ type: 'folder', id: folder.id, name: folder.name || 'Folder' });
  }

  function closeDeleteModal() {
    if (deleting) return;
    setDeleteTarget(null);
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    cancelPendingSave();
    markMutation();
    setDeleting(true);
    const previousNotes = latestCacheRef.current.notes;
    const previousFolders = latestCacheRef.current.folders;
    const restoredDeletedIds = [];
    try {
      if (deleteTarget.type === 'folder') {
        const nextFolders = previousFolders.filter((folder) => folder.id !== deleteTarget.id);
        const nextNotes = previousNotes.filter((note) => note.folderId !== deleteTarget.id);
        previousNotes
          .filter((note) => note.folderId === deleteTarget.id)
          .forEach((note) => {
            deletedNoteIdsRef.current.add(note.id);
            restoredDeletedIds.push(note.id);
          });
        applyFolders(nextFolders, { notes: nextNotes });
        applyNotes(nextNotes, { folders: nextFolders, cache: true, immediate: true });
        setActiveFolderId(DEFAULT_FOLDER_ID);
        setMobilePane('folders');
        setDeleteTarget(null);
        navigate('/cloud/apps/notes/u', { replace: true });
        const response = await apiFetch(`/notes/folders/${deleteTarget.id}`, { method: 'DELETE' });
        const json = await response.json().catch(() => ({}));
        if (!response.ok && response.status !== 404) throw new Error(json?.error || 'Could not delete folder');
      } else {
        deletedNoteIdsRef.current.add(deleteTarget.id);
        restoredDeletedIds.push(deleteTarget.id);
        const nextNotes = previousNotes.filter((note) => note.id !== deleteTarget.id);
        applyNotes(nextNotes, { cache: true, immediate: true });
        setMobilePane('list');
        setDeleteTarget(null);
        navigate('/cloud/apps/notes/u', { replace: true });
        const response = await apiFetch(`/notes/${deleteTarget.id}`, { method: 'DELETE' });
        const json = await response.json().catch(() => ({}));
        if (!response.ok && response.status !== 404) throw new Error(json?.error || 'Could not delete note');
      }
    } catch (error) {
      restoredDeletedIds.forEach((id) => deletedNoteIdsRef.current.delete(id));
      latestCacheRef.current = { folders: previousFolders, notes: previousNotes };
      setNotes(previousNotes);
      setFolders(previousFolders);
      persistCache(previousNotes, previousFolders, { immediate: true });
      showAlert({ title: 'Delete failed', message: error?.message || 'Could not delete this item.', type: 'error' });
    } finally {
      setDeleting(false);
    }
  }

  function selectNote(note) {
    if (longPressNoteIdRef.current === note.id) {
      longPressNoteIdRef.current = '';
      return;
    }
    setMobilePane('editor');
    navigate(`/cloud/apps/notes/u/${note.id}`);
  }

  function clearNoteLongPress() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function openMobileNoteMenu(note, trigger = null) {
    if (!note || note.system || note.id.startsWith('local-')) return;
    clearNoteLongPress();
    longPressNoteIdRef.current = note.id;
    const visualViewport = typeof window !== 'undefined' ? window.visualViewport : null;
    const viewportWidth = Math.round(visualViewport?.width || window.innerWidth || 390);
    const viewportHeight = Math.round(visualViewport?.height || window.innerHeight || 844);
    const viewportLeft = Math.round(visualViewport?.offsetLeft || 0);
    const viewportTop = Math.round(visualViewport?.offsetTop || 0);
    const margin = 10;
    const menuWidth = Math.min(250, Math.max(192, viewportWidth - 28));
    const menuHeight = 176;
    const minX = viewportLeft + margin;
    const maxX = viewportLeft + Math.max(margin, viewportWidth - menuWidth - margin);
    const minY = viewportTop + margin;
    const maxY = viewportTop + Math.max(margin, viewportHeight - menuHeight - margin);
    const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
    let x = viewportLeft + Math.round((viewportWidth - menuWidth) * 0.5);
    let y = viewportTop + Math.round((viewportHeight - menuHeight) * 0.42);

    if (trigger?.currentTarget && typeof trigger.currentTarget.getBoundingClientRect === 'function') {
      const rect = trigger.currentTarget.getBoundingClientRect();
      x = rect.right - menuWidth + 8;
      y = rect.bottom + 8;
      if (y > maxY) y = rect.top - menuHeight - 8;
    } else if (typeof trigger?.clientX === 'number' && typeof trigger?.clientY === 'number') {
      x = trigger.clientX - menuWidth + 18;
      y = trigger.clientY + 10;
      if (y > maxY) y = trigger.clientY - menuHeight - 10;
    }

    x = clamp(Math.round(x), minX, maxX);
    y = clamp(Math.round(y), minY, maxY);

    setNoteMenu({ noteId: note.id, x, y, mobile: true });
  }

  function startNoteLongPress(event, note) {
    if (event.pointerType === 'mouse') return;
    clearNoteLongPress();
    const point = { clientX: event.clientX, clientY: event.clientY };
    longPressTimerRef.current = setTimeout(() => {
      openMobileNoteMenu(note, point);
    }, 430);
  }

  function saveLabel() {
    if (selectedNotePending) return 'Creating note...';
    if (selectedNoteReadOnly) return 'Pinned main note';
    if (saveState === 'typing') return 'Waiting to save...';
    if (saveState === 'saving') return 'Saving...';
    if (saveState === 'error') return 'Could not save';
    return 'Saved';
  }

  const menuNote = noteMenu ? notes.find((note) => note.id === noteMenu.noteId) : null;

  return (
    <main className={`iclora-notes iclora-notes--pane-${mobilePane}`} aria-label="iClora Notes">
      <DashboardNavbar
        user={profile}
        accentColor={accentColor}
        showBack={true}
        onBack={() => navigate('/cloud')}
        whiteBackground={true}
        appLabel="Notes"
        appLabelColor="#f0b400"
        appIcon="/apps/notes.webp"
        appIconDark="/apps/notes-dark.webp"
        appSyncing={navbarSyncing}
        appSyncLabel={navbarSyncLabel}
      />

      <section className="iclora-notes__layout">
        <aside className="iclora-notes__folders" aria-label="Folders">
          <div className="iclora-notes__folders-list">
            <div className="iclora-notes__folders-actions">
              <span className="iclora-notes__folders-title" aria-label="Current folder">
                <strong>Folders</strong>
              </span>
              <button
                type="button"
                className="iclora-notes__folders-refresh"
                aria-label="Hard refresh notes"
                onClick={(event) => {
                  triggerRefreshTapAnimation(event);
                  hardRefreshNotesCloud();
                }}
                disabled={hardRefreshing || hardRefreshLocked}
              >
                <FiRefreshCw className={hardRefreshing ? 'is-spinning' : ''} />
              </button>
            </div>
            <FolderRow id={ALL_FOLDERS_ID} name="All iClora" active={activeFolderId === ALL_FOLDERS_ID} onClick={() => selectFolder(ALL_FOLDERS_ID)} />
            {folders.map((folder) => (
              <FolderRow
                key={folder.id}
                id={folder.id}
                name={folder.name}
                active={activeFolderId === folder.id}
                system={folder.system}
                menuOpen={folderMenu.id === folder.id}
                menuUp={folderMenu.id === folder.id && folderMenu.openUp}
                onClick={() => selectFolder(folder.id)}
                onMenu={(event) => {
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
                  const estimatedMenuHeight = 126;
                  const margin = 12;
                  const openUp = viewportHeight - rect.bottom < estimatedMenuHeight + margin;
                  setFolderMenu((open) => (open.id === folder.id ? { id: '', openUp: false } : { id: folder.id, openUp }));
                }}
                onRename={() => openNameModal('rename', folder)}
                onNew={() => openNameModal('create')}
                onDownload={() => downloadFolder(folder)}
                onDelete={() => openDeleteFolder(folder)}
              />
            ))}
            {loading ? (
              <div className="iclora-notes__folders-loading" role="status" aria-live="polite">
                <AppleLoader className="iclora-notes__folders-spinner" size={24} />
                <span>Syncing folders</span>
              </div>
            ) : null}
          </div>
          <div className="iclora-notes__new-folder-bar">
            <button
              type="button"
              className="iclora-notes__new-folder"
              onClick={() => openNameModal('create')}
              disabled={folderLimitReached}
              title={folderLimitReached ? `Folder limit reached (${MAX_FOLDERS})` : 'New Folder'}
            >
              <FiPlusCircle />
              <span>{folderLimitReached ? 'Folder Limit Reached' : 'New Folder'}</span>
            </button>
          </div>
        </aside>

        <section className="iclora-notes__list-pane" aria-label="Notes list">
          <div className="iclora-notes__list-header">
            <div className="iclora-notes__mobile-head">
              <button type="button" aria-label="Back to folders" onClick={() => setMobilePane('folders')}><FiChevronLeft /></button>
              <strong>{activeFolderId === ALL_FOLDERS_ID ? 'All iClora' : activeFolder.name || 'Notes'}</strong>
              <span className="iclora-notes__header-actions">
                <button
                  type="button"
                  aria-label="Hard refresh notes"
                  onClick={(event) => {
                    triggerRefreshTapAnimation(event);
                    hardRefreshNotesCloud();
                  }}
                  className="iclora-notes__mobile-compose iclora-notes__mobile-refresh"
                  disabled={hardRefreshing || hardRefreshLocked}
                >
                  <FiRefreshCw className={hardRefreshing ? 'is-spinning' : ''} />
                </button>
                <button type="button" aria-label="Compose new note" onClick={openNoteNameModal} className="iclora-notes__mobile-compose">
                  <img src="/COMPOSE.webp" alt="" aria-hidden="true" />
                </button>
                <button type="button" aria-label="Import text files" onClick={openImportModal} className="iclora-notes__mobile-compose iclora-notes__mobile-import">
                  <img src="/upload.webp" alt="" aria-hidden="true" />
                </button>
              </span>
            </div>
            <label className="iclora-notes__search">
              <FiSearch />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search all notes" />
            </label>
          </div>
          <div className="iclora-notes__list-content" onScroll={clearNoteLongPress}>
            {loading ? (
              <div className="iclora-notes__state iclora-notes__state--loading">
                <AppleLoader className="iclora-notes__list-loader" size={32} hidden={false} label="Loading notes" />
              </div>
            ) : null}
            {pinnedNotes.length > 0 && (
              <div className="iclora-notes__section">
                <div className="iclora-notes__section-title">Pinned</div>
                {pinnedNotes.map((note) => (
                  <NoteRow
                    key={note.id}
                    note={note}
                    folderName={folderNameById.get(note.folderId || DEFAULT_FOLDER_ID) || 'Notes'}
                    active={selectedNote?.id === note.id}
                    onClick={() => selectNote(note)}
                    onContextMenu={(event) => openNoteMenu(event, note)}
                    onPointerDown={(event) => startNoteLongPress(event, note)}
                    onPointerUp={clearNoteLongPress}
                    onPointerCancel={clearNoteLongPress}
                  onPointerMove={clearNoteLongPress}
                  onMobileMenu={(event) => {
                    event.stopPropagation();
                    openMobileNoteMenu(note, event);
                  }}
                />
              ))}
              </div>
            )}
            <div className="iclora-notes__section">
              <div className="iclora-notes__section-title">Notes</div>
              {regularNotes.length ? regularNotes.map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  folderName={folderNameById.get(note.folderId || DEFAULT_FOLDER_ID) || 'Notes'}
                  active={selectedNote?.id === note.id}
                  onClick={() => selectNote(note)}
                  onContextMenu={(event) => openNoteMenu(event, note)}
                  onPointerDown={(event) => startNoteLongPress(event, note)}
                  onPointerUp={clearNoteLongPress}
                  onPointerCancel={clearNoteLongPress}
                  onPointerMove={clearNoteLongPress}
                  onMobileMenu={(event) => {
                    event.stopPropagation();
                    openMobileNoteMenu(note, event);
                  }}
                />
              )) : <p className="iclora-notes__state">No notes here yet.</p>}
            </div>
          </div>
        </section>

        <section
          className={`iclora-notes__editor ${selectedNote ? '' : 'is-empty'} ${mobileEditorGateActive && mobileEditorArmed ? 'is-edit-armed' : ''}`}
          aria-label="Note editor"
          onPointerDown={handleEditorPointerDown}
          onPointerUp={handleEditorPointerUp}
          onClick={handleEditorSurfaceClick}
          onContextMenu={suppressEditorNativeMenu}
        >
          {selectedNote ? (
            <>
              <div className="iclora-notes__editor-toolbar">
                <button type="button" className="iclora-notes__mobile-back" aria-label="Back to notes" onClick={() => { setMobilePane('list'); navigate('/cloud/apps/notes/u', { replace: true }); }}><FiChevronLeft /></button>
                <div className="iclora-notes__format-actions" aria-label="Text formatting">
                  <button type="button" className={activeFormats.bold ? 'is-active' : ''} aria-label="Bold selected text" disabled={selectedNoteFormatDisabled} onPointerDown={holdEditorSelection} onMouseDown={holdEditorSelection} onClick={() => applySelectionFormat('bold')}><FiBold /></button>
                  <button type="button" className={activeFormats.italic ? 'is-active' : ''} aria-label="Italic selected text" disabled={selectedNoteFormatDisabled} onPointerDown={holdEditorSelection} onMouseDown={holdEditorSelection} onClick={() => applySelectionFormat('italic')}><FiItalic /></button>
                  <button type="button" className={activeFormats.underline ? 'is-active' : ''} aria-label="Underline selected text" disabled={selectedNoteFormatDisabled} onPointerDown={holdEditorSelection} onMouseDown={holdEditorSelection} onClick={() => applySelectionFormat('underline')}><FiUnderline /></button>
                  <button type="button" className={activeFormats.strike ? 'is-active' : ''} aria-label="Strike selected text" disabled={selectedNoteFormatDisabled} onPointerDown={holdEditorSelection} onMouseDown={holdEditorSelection} onClick={() => applySelectionFormat('strike')}><FiMinus /></button>
                  <button type="button" className="iclora-notes__pc-emoji-btn" aria-label="Insert Emoji" disabled={selectedNoteFormatDisabled} onMouseDown={(event) => event.preventDefault()} onClick={() => {
                    if (selectedNoteFormatDisabled) return;
                    bodyInputRef.current?.focus();
                    const isMac = navigator.userAgent.includes('Mac');
                    showAlert({ title: 'Emoji Keyboard', message: `Press ${isMac ? 'Cmd + Ctrl + Space' : 'Win + .'} on your keyboard.`, type: 'info' });
                  }}>
                    <img src="/ICON.webp" alt="Emoji" />
                  </button>
                </div>
                <span className="iclora-notes__toolbar-spacer" />
                <button
                  type="button"
                  className="iclora-notes__refresh-btn"
                  aria-label="Hard refresh note"
                  onClick={(event) => {
                    triggerRefreshTapAnimation(event);
                    hardRefreshSelectedNote();
                  }}
                  disabled={selectedNote.system || selectedNotePending || hardRefreshing || hardRefreshLocked}
                >
                  <FiRefreshCw className={hardRefreshing ? 'is-spinning' : ''} />
                </button>
                <button
                  type="button"
                  className="iclora-notes__move-btn"
                  aria-label="Move note to folder"
                  onClick={openMoveModal}
                  disabled={selectedNote.system || selectedNotePending}
                >
                  <FiFolderPlus />
                </button>
                <button
                  type="button"
                  className="iclora-notes__download-btn"
                  aria-label="Download note"
                  onClick={openDownloadModal}
                  disabled={selectedNotePending}
                >
                  <DownloadIcon size={18} />
                </button>
                <button type="button" aria-label="Delete note" disabled={selectedNote.system || selectedNotePending} onClick={openDeleteNote} className="iclora-notes__delete-btn"><FiTrash2 /></button>
              </div>
              <div
                className={`iclora-notes__paper ${selectedNotePending ? 'is-creating' : ''} ${mobileEditorGateActive && mobileEditorArmed ? 'is-edit-armed' : ''}`}
                onScroll={handleEditorScroll}
              >
                {selectedNotePending ? (
                  <div className="iclora-notes__uid-loader" role="status" aria-live="polite">
                    <AppleLoader className="iclora-notes__uid-spinner" size={22} />
                    <span>Preparing Note...</span>
                  </div>
                ) : null}
                <div
                  ref={bodyInputRef}
                  className="iclora-notes__body-input"
                  contentEditable={selectedNoteEditorEditable}
                  suppressContentEditableWarning
                  onInput={(event) => updateRichContent(event.currentTarget.innerHTML)}
                  onPointerMove={handleEditorPointerMove}
                  onPointerLeave={handleEditorPointerLeave}
                  onCompositionStart={handleEditorCompositionStart}
                  onCompositionEnd={handleEditorCompositionEnd}
                  onPaste={handleEditorPaste}
                  onClick={handleEditorClick}
                  onContextMenu={suppressEditorNativeMenu}
                  onKeyUp={refreshFormatState}
                  onMouseUp={refreshFormatState}
                  aria-label="Note body"
                  data-placeholder=""
                  data-empty={contentDraft ? '0' : '1'}
                  dir="ltr"
                  role="textbox"
                  aria-multiline="true"
                  tabIndex={selectedNoteEditorEditable ? 0 : -1}
                  spellCheck={selectedNoteEditorEditable}
                  inputMode={selectedNoteEditorEditable ? 'text' : 'none'}
                  autoCapitalize="sentences"
                />
              </div>
            </>
          ) : selectedNoteLoading ? (
            <div className="iclora-notes__empty iclora-notes__empty--loading">
              <span className="iclora-notes__empty-icon iclora-notes__empty-icon--loading" aria-hidden="true">
                <AppleLoader className="iclora-notes__empty-spinner" size={64} />
              </span>
              <strong>Loading your note</strong>
              <span className="iclora-notes__empty-subtitle">Please wait while we sync your note from server.</span>
            </div>
          ) : (
            <div className="iclora-notes__empty">
              <span className="iclora-notes__empty-icon" aria-hidden="true">
                <span className="iclora-notes__empty-loader" />
              </span>
              <strong>Select a note</strong>
              <span className="iclora-notes__empty-subtitle">Create or choose a note to start writing.</span>
            </div>
          )}
        </section>
      </section>

      {noteMenu && menuNote ? (
        <div className="iclora-notes__context-layer" role="presentation" onMouseDown={() => setNoteMenu(null)}>
          <div
            className={`iclora-notes__context-menu ${noteMenu.mobile ? 'is-mobile' : ''}`}
            role="menu"
            style={{ left: noteMenu.x, top: noteMenu.y }}
            onMouseDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button type="button" role="menuitem" onClick={() => toggleMenuNotePin(menuNote)}>
              <FiMapPin />
              <span>{menuNote.pinned ? 'Unpin Note' : 'Pin Note'}</span>
            </button>
            <button type="button" role="menuitem" onClick={() => openRenameNoteModal(menuNote)}>
              <FiEdit2 />
              <span>Rename</span>
            </button>
            <div className="iclora-notes__context-divider" role="presentation" />
            <button type="button" role="menuitem" className="is-danger" onClick={() => deleteMenuNote(menuNote)}>
              <FiTrash2 />
              <span>Delete</span>
            </button>
          </div>
        </div>
      ) : null}

      {nameModal ? (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={closeNameModal}>
          <section className="manage-account__name-modal iclora-notes__name-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="manage-account__modal-close" aria-label="Close folder dialog" onClick={closeNameModal} disabled={nameSaving}>
              <FiChevronLeft />
            </button>
            <div className="manage-account__modal-icon iclora-notes__confirm-icon" aria-hidden="true"><FiFolder /></div>
            <h2>{nameModal.mode === 'rename' ? 'Rename Folder' : 'New Folder'}</h2>
            <input
              className="iclora-notes__modal-input"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              autoFocus
              aria-label="Folder name"
            />
            <div className="manage-account__delete-actions">
              <button type="button" className="manage-account__delete-button manage-account__delete-button--cancel" onClick={closeNameModal} disabled={nameSaving}>Cancel</button>
              <button type="button" className="manage-account__delete-button manage-account__delete-button--verified iclora-notes__modal-action-button" onClick={submitFolderName} disabled={nameSaving} aria-busy={nameSaving}>
                {nameSaving ? <span className="manage-account__button-spinner" aria-hidden="true" /> : null}
                <span>{nameSaving ? 'Saving' : 'Save'}</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {noteNameModal ? (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={closeNoteNameModal}>
          <section className="manage-account__name-modal iclora-notes__name-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="manage-account__modal-close" aria-label="Close note name dialog" onClick={closeNoteNameModal} disabled={noteNameSaving}>
              <FiChevronLeft />
            </button>
            <div className="manage-account__modal-icon iclora-notes__confirm-icon" aria-hidden="true">
              <img src="/COMPOSE.webp" alt="" />
            </div>
            <h2>{noteNameMode === 'rename' ? 'Rename Note' : 'Create New Note'}</h2>
            <input
              className="iclora-notes__modal-input"
              value={noteNameDraft}
              onChange={(event) => setNoteNameDraft(event.target.value)}
              autoFocus
              aria-label="Note name"
              placeholder="Untitled"
            />
            <div className="manage-account__delete-actions">
              <button type="button" className="manage-account__delete-button manage-account__delete-button--cancel iclora-notes__modal-button" onClick={closeNoteNameModal} disabled={noteNameSaving}>Cancel</button>
              <button type="button" className="manage-account__delete-button iclora-notes__modal-button--create iclora-notes__modal-action-button" onClick={noteNameMode === 'rename' ? renameNote : createNote} disabled={noteNameSaving} aria-busy={noteNameSaving}>
                {noteNameSaving ? <span className="manage-account__button-spinner" aria-hidden="true" /> : null}
                <span>{noteNameSaving ? (noteNameMode === 'rename' ? 'Saving' : 'Creating') : (noteNameMode === 'rename' ? 'Save' : 'Create')}</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {importModalOpen ? (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={closeImportModal}>
          <section className="manage-account__name-modal iclora-notes__name-modal iclora-notes__import-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="manage-account__modal-close" aria-label="Close import dialog" onClick={closeImportModal} disabled={importingFiles}>
              <FiChevronLeft />
            </button>
            <div className="manage-account__modal-icon iclora-notes__confirm-icon" aria-hidden="true">
              <img src="/upload.webp" alt="" />
            </div>
            <h2>Import Text Files</h2>
            <p className="manage-account__delete-copy">Choose one or more text files. Each file becomes a new note in this folder.</p>
            <label
              className={`iclora-notes__import-drop ${importDragActive ? 'is-dragging' : ''}`}
              onDragOver={handleImportDragOver}
              onDragEnter={handleImportDragOver}
              onDragLeave={handleImportDragLeave}
              onDrop={handleImportDrop}
            >
              <input
                type="file"
                accept={TEXT_IMPORT_ACCEPT}
                multiple
                onChange={handleImportFileChange}
                disabled={importingFiles}
              />
              <img src="/upload.webp" alt="" aria-hidden="true" />
              <span>{importFiles.length ? `${importFiles.length} selected` : 'Choose text files'}</span>
            </label>
            {importFiles.length ? (
              <div className="iclora-notes__import-list">
                {importFiles.map((file) => (
                  <div className="iclora-notes__import-item" key={`${file.name}-${file.size}-${file.lastModified}`}>
                    <span>{file.name}</span>
                    <small>{Math.max(1, Math.round(file.size / 1024))} KB</small>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="manage-account__delete-actions">
              <button type="button" className="manage-account__delete-button manage-account__delete-button--cancel iclora-notes__modal-button" onClick={closeImportModal} disabled={importingFiles}>Cancel</button>
              <button type="button" className="manage-account__delete-button iclora-notes__modal-button--create iclora-notes__modal-action-button" onClick={importTextFiles} disabled={importingFiles || !importFiles.length} aria-busy={importingFiles}>
                {importingFiles ? <span className="manage-account__button-spinner" aria-hidden="true" /> : null}
                <span>{importingFiles ? 'Importing' : 'Import'}</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={closeDeleteModal}>
          <section className="manage-account__name-modal manage-account__delete-modal iclora-notes__confirm-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="manage-account__modal-close" aria-label="Close delete confirmation" onClick={closeDeleteModal} disabled={deleting}>
              <FiChevronLeft />
            </button>
            <div className="manage-account__modal-icon iclora-notes__confirm-icon" aria-hidden="true"><FiAlertTriangle /></div>
            <h2>Are you sure?</h2>
            <p className="manage-account__delete-copy">
              Delete {deleteTarget.type === 'folder' ? 'folder' : 'note'} "{deleteTarget.name}"?
            </p>
            <div className="manage-account__delete-actions">
              <button type="button" className="manage-account__delete-button manage-account__delete-button--cancel" onClick={closeDeleteModal} disabled={deleting}>No</button>
              <button type="button" className="manage-account__delete-button manage-account__delete-button--danger iclora-notes__modal-action-button" onClick={confirmDelete} disabled={deleting} aria-busy={deleting}>
                {deleting ? <span className="manage-account__button-spinner" aria-hidden="true" /> : null}
                <span>{deleting ? 'Deleting' : 'Yes'}</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {moveModalOpen ? (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={closeMoveModal}>
          <section className="manage-account__name-modal iclora-notes__name-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="manage-account__modal-close" aria-label="Close move note dialog" onClick={closeMoveModal} disabled={moveSaving}>
              <FiChevronLeft />
            </button>
            <div className="manage-account__modal-icon iclora-notes__confirm-icon" aria-hidden="true"><FiFolderPlus /></div>
            <h2>Move Note</h2>
            <div className="iclora-notes__move-picker">
              <button
                type="button"
                className="iclora-notes__modal-input iclora-notes__move-picker-trigger"
                onClick={() => setMovePickerOpen((open) => !open)}
                aria-label="Choose destination folder"
                aria-expanded={movePickerOpen}
                autoFocus
              >
                <span>{folders.find((folder) => folder.id === moveFolderId)?.name || 'Notes'}</span>
                <FiChevronDown />
              </button>
              {movePickerOpen ? (
                <div className="iclora-notes__move-picker-menu" role="listbox" aria-label="Folder options">
                  {folders.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      className={`iclora-notes__move-picker-option ${folder.id === moveFolderId ? 'is-active' : ''}`}
                      onClick={() => chooseMoveFolder(folder.id)}
                      role="option"
                      aria-selected={folder.id === moveFolderId}
                    >
                      {folder.name || 'Notes'}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="manage-account__delete-actions">
              <button type="button" className="manage-account__delete-button manage-account__delete-button--cancel iclora-notes__modal-button" onClick={closeMoveModal} disabled={moveSaving}>Cancel</button>
              <button type="button" className="manage-account__delete-button iclora-notes__modal-button--create iclora-notes__modal-action-button" onClick={moveSelectedNote} disabled={moveSaving} aria-busy={moveSaving}>
                {moveSaving ? <span className="manage-account__button-spinner" aria-hidden="true" /> : null}
                <span>{moveSaving ? 'Moving' : 'Move'}</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {downloadModalOpen ? (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={closeDownloadModal}>
          <section className="manage-account__name-modal iclora-notes__name-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="manage-account__modal-close" aria-label="Close download dialog" onClick={closeDownloadModal} disabled={downloadingFile}>
              <FiChevronLeft />
            </button>
            <div className="manage-account__modal-icon iclora-notes__confirm-icon" aria-hidden="true"><DownloadIcon size={48} /></div>
            <h2>Download Note</h2>
            <input
              className="iclora-notes__modal-input"
              value={downloadNameDraft}
              onChange={(event) => setDownloadNameDraft(event.target.value)}
              autoFocus
              aria-label="Download file name"
              placeholder="note"
            />
            <div className="manage-account__delete-actions">
              <button type="button" className="manage-account__delete-button manage-account__delete-button--cancel iclora-notes__modal-button" onClick={closeDownloadModal} disabled={downloadingFile}>Cancel</button>
              <button type="button" className="manage-account__delete-button iclora-notes__modal-button--create iclora-notes__modal-action-button" onClick={downloadSelectedNote} disabled={downloadingFile} aria-busy={downloadingFile}>
                {downloadingFile ? <span className="manage-account__button-spinner" aria-hidden="true" /> : null}
                <span>{downloadingFile ? 'Downloading' : 'Download'}</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {setupRequired ? (
        <div className="manage-account__modal-layer" role="presentation" onMouseDown={() => { if (!setupLoading) navigate('/cloud'); }}>
          <section className="manage-account__name-modal manage-account__setup-modal cloud-app-setup-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="manage-account__modal-close" aria-label="Close Notes setup" onClick={() => navigate('/cloud')} disabled={setupLoading}>
              <FiChevronLeft />
            </button>
            <div className="manage-account__modal-icon cloud-app-setup-modal__icon" aria-hidden="true">
              <picture>
                <source srcSet="/apps/notes-dark.webp" media="(prefers-color-scheme: dark)" />
                <img src="/apps/notes.webp" alt="" className="manage-account__setup-app-icon" />
              </picture>
            </div>
            <h2>Setup Notes</h2>
            <p className="manage-account__delete-copy">You will be allotted a Notes Cloud for your account.</p>
            <div className="manage-account__delete-actions">
              <button type="button" className="manage-account__delete-button manage-account__delete-button--cancel" onClick={() => navigate('/cloud')} disabled={setupLoading}>Cancel</button>
              <button type="button" className="manage-account__delete-button cloud-app-setup-modal__activate iclora-notes__modal-action-button" onClick={activateNotes} disabled={setupLoading} aria-busy={setupLoading}>
                {setupLoading ? <span className="manage-account__button-spinner" aria-hidden="true" /> : null}
                <span>{setupLoading ? 'Activating' : 'Activate'}</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function FolderRow({ id, name, active, system = false, menuOpen = false, menuUp = false, onClick, onMenu, onRename, onNew, onDownload, onDelete }) {
  return (
    <div className={`iclora-notes__folder-wrap ${active ? 'is-active' : ''}`}>
      <button type="button" className="iclora-notes__folder" onClick={onClick}>
        <FiFolder />
        <span>{name}</span>
      </button>
      {!system && id !== ALL_FOLDERS_ID ? (
        <button type="button" className="iclora-notes__folder-more" aria-label={`Folder actions for ${name}`} onClick={onMenu}>
          <FiMoreHorizontal />
        </button>
      ) : null}
      {menuOpen ? (
        <div className={`iclora-notes__folder-menu ${menuUp ? 'is-up' : ''}`} role="menu">
          <button type="button" role="menuitem" onClick={onRename}><FiEdit2 /> Rename Folder</button>
          <button type="button" role="menuitem" onClick={onDownload}><DownloadIcon size={18} /> Download Folder</button>
          <button type="button" role="menuitem" className="is-danger" onClick={onDelete}><FiTrash2 /> Delete Folder</button>
        </div>
      ) : null}
    </div>
  );
}

function NoteRow({ note, folderName = 'Notes', active, onClick, onContextMenu, onPointerDown, onPointerUp, onPointerCancel, onPointerMove, onMobileMenu }) {
  return (
    <div className={`iclora-notes__note-shell ${active ? 'is-active' : ''}`}>
      <button
        type="button"
        className={`iclora-notes__note ${active ? 'is-active' : ''}`}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerMove={onPointerMove}
      >
        <span className="iclora-notes__note-title">
          {note.locked ? <FiLock /> : null}
          {note.title || 'Untitled'}
        </span>
        <span className="iclora-notes__note-meta">{formatDate(note.updatedAt || note.createdAt)} {notePreview(note)}</span>
        <span className="iclora-notes__note-folder"><FiFolder /> {folderName}</span>
      </button>
      <button type="button" className="iclora-notes__note-mobile-menu" aria-label={`Actions for ${note.title || 'Untitled'}`} onClick={onMobileMenu}>
        <FiMoreHorizontal />
      </button>
    </div>
  );
}
