import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FiClock, FiCloud, FiImage } from 'react-icons/fi';
import { apiUrl } from '../api/backendapi';
import './publicPhotoShare.css';

async function readJson(response) {
  return response.json().catch(() => ({}));
}

function formatRemainingTime(expiresAt) {
  const expiresMs = Date.parse(expiresAt || '');
  const remainingMs = expiresMs - Date.now();
  if (!Number.isFinite(expiresMs) || remainingMs <= 0) return '';

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  if (minutes > 0) return `${minutes}m ${seconds}s left`;
  return `${seconds}s left`;
}

export default function PublicPhotoShare() {
  const { token = '' } = useParams();
  const [status, setStatus] = useState('loading');
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState('');
  const [remainingLabel, setRemainingLabel] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    function blockEvent(event) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }

    function blockProtectedKeys(event) {
      const key = String(event.key || '').toLowerCase();
      const blockedShortcut = (event.metaKey || event.ctrlKey) && ['c', 'p', 's', 'u'].includes(key);
      if (key === 'printscreen' || blockedShortcut) blockEvent(event);
    }

    document.addEventListener('contextmenu', blockEvent, true);
    document.addEventListener('dragstart', blockEvent, true);
    document.addEventListener('selectstart', blockEvent, true);
    document.addEventListener('copy', blockEvent, true);
    document.addEventListener('keydown', blockProtectedKeys, true);

    return () => {
      document.removeEventListener('contextmenu', blockEvent, true);
      document.removeEventListener('dragstart', blockEvent, true);
      document.removeEventListener('selectstart', blockEvent, true);
      document.removeEventListener('copy', blockEvent, true);
      document.removeEventListener('keydown', blockProtectedKeys, true);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError('');
	    setPayload(null);
	    setRemainingLabel('');
	    setSelectedIndex(0);
    fetch(apiUrl(`/photos/share/${encodeURIComponent(token)}`), {
      credentials: 'omit',
      cache: 'no-store',
    })
      .then(async (response) => {
        const json = await readJson(response);
        if (!response.ok || !json?.ok) throw new Error(json?.error || 'This iClora Link is unavailable');
        return json;
      })
      .then((json) => {
        if (cancelled) return;
        setPayload(json);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || 'This iClora Link is unavailable');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const photos = Array.isArray(payload?.photos) && payload.photos.length ? payload.photos : (payload?.photo ? [payload.photo] : []);
  const photo = photos[selectedIndex] || photos[0] || {};
  const link = payload?.link || {};
  const isCollection = photos.length > 1;
  const photoSrc = photo.src?.startsWith('/') ? apiUrl(photo.src) : photo.src;
  const mediaWidth = Number(photo.width || 0);
  const mediaHeight = Number(photo.height || 0);
  const mediaRatio = mediaWidth > 0 && mediaHeight > 0 ? mediaWidth / mediaHeight : 4 / 3;
  const mediaAspect = mediaWidth > 0 && mediaHeight > 0 ? `${mediaWidth} / ${mediaHeight}` : '4 / 3';
  const expiresAtLabel = link.expiresAt ? new Date(link.expiresAt).toLocaleString() : 'soon';

  useEffect(() => {
    if (status !== 'ready' || !link.expiresAt) return undefined;
    const expiresMs = Date.parse(link.expiresAt);
    if (!Number.isFinite(expiresMs)) return undefined;

    function updateExpiry() {
      if (Date.now() >= expiresMs) {
        setError('This iClora Link has expired');
        setStatus('error');
        setPayload(null);
        setRemainingLabel('');
        return;
      }
      setRemainingLabel(formatRemainingTime(link.expiresAt));
    }

    updateExpiry();
    const interval = window.setInterval(updateExpiry, 1000);
    return () => window.clearInterval(interval);
  }, [link.expiresAt, status]);

  return (
    <main className="iclora-share" aria-label="Shared iClora photo" onContextMenu={(event) => event.preventDefault()}>
      <header className="iclora-share__bar">
        <div className="iclora-share__brand">
          <img src="/logo.webp" alt="" aria-hidden="true" />
          <span>{isCollection ? 'iClora Photo Set' : 'iClora Link'}</span>
        </div>
      </header>

      {status === 'loading' ? (
        <section className="iclora-share__state" role="status" aria-live="polite">
          <span className="iclora-share__spinner" aria-hidden="true" />
          <h1>Opening iClora Link</h1>
        </section>
      ) : status === 'error' ? (
        <section className="iclora-share__state">
          <FiCloud aria-hidden="true" />
          <h1>Link unavailable</h1>
          <p>{error}</p>
        </section>
      ) : (
        <section className="iclora-share__viewer">
	          <div className={`iclora-share__media-wrap ${isCollection ? 'is-collection' : ''}`}>
	            <div
	              className="iclora-share__media"
	              style={{
	                '--share-media-aspect': mediaAspect,
	                '--share-media-ratio': mediaRatio,
	              }}
	            >
	              {photo.resourceType === 'video' ? (
	                <video
	                  src={photoSrc}
	                  controls
	                  controlsList="nodownload noplaybackrate noremoteplayback"
	                  disablePictureInPicture
	                  playsInline
	                  onContextMenu={(event) => event.preventDefault()}
	                />
	              ) : (
	                <img
	                  src={photoSrc}
	                  alt={photo.title || 'Shared iClora photo'}
	                  draggable={false}
	                  decoding="async"
	                  onContextMenu={(event) => event.preventDefault()}
	                />
	              )}
	              <span className="iclora-share__media-shield" aria-hidden="true" />
	            </div>
	            {isCollection ? (
	              <div className="iclora-share__thumbs" aria-label="Shared photos">
	                {photos.map((item, index) => {
	                  const src = item.src?.startsWith('/') ? apiUrl(item.src) : item.src;
	                  return (
	                    <button
	                      type="button"
	                      key={`${item.id || item.title || 'photo'}-${index}`}
	                      className={index === selectedIndex ? 'is-active' : ''}
	                      onClick={() => setSelectedIndex(index)}
	                      aria-label={`Open shared photo ${index + 1}`}
	                    >
	                      <img src={src} alt="" draggable={false} />
	                    </button>
	                  );
	                })}
	              </div>
	            ) : null}
	          </div>
	          <aside className="iclora-share__details">
	            <div className="iclora-share__icon" aria-hidden="true">
	              <FiImage />
	            </div>
	            <h1>{isCollection ? `${photos.length} Shared Photos` : (photo.title || 'Shared Photo')}</h1>
	            <p>{isCollection ? `${selectedIndex + 1} of ${photos.length}: ${photo.title || 'Shared Photo'}` : 'Shared with an iClora secure link.'}</p>
            <div className="iclora-share__expiry">
              <FiClock aria-hidden="true" />
              <span>Expires {expiresAtLabel}{remainingLabel ? ` · ${remainingLabel}` : ''}</span>
            </div>
          </aside>
        </section>
      )}
    </main>
  );
}
