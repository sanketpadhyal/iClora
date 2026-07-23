import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiArrowRight,
  FiClock,
  FiImage,
  FiInfo,
} from 'react-icons/fi';
import { apiFetch } from '../api/backendapi';
import DashboardNavbar from './dashboardnavbar';
import { readUserProfileCache } from './userProfileCache';
import { readAccentColorCache } from './themeCache';
import { useAlert } from '../alert/alert';
import AppleLoader from '../components/AppleLoader';
import { applyAppPageMeta } from '../components/utils/pageMeta';
import { readRecentlyDeletedPhotosCache, writeRecentlyDeletedPhotosCache } from '../photos/photoBackendProcess';
import Footer from '../components/Footer';
import './recovery.css';

const upcomingRecoveryApps = [
  {
    id: 'notes',
    title: 'Restore Notes',
    subtitle: 'Recently Deleted',
    icon: '/apps/notes.webp',
    darkIcon: '/apps/notes-dark.webp',
  },
  {
    id: 'contacts',
    title: 'Restore Contacts',
    subtitle: 'Recently Deleted',
    icon: '/apps/contacts.webp',
    darkIcon: '/apps/contacts-dark.webp',
  },
];

export default function CloudRecovery() {
  const navigate = useNavigate();
  const { showAlert } = useAlert();
  const cachedRecentlyDeleted = useMemo(() => readRecentlyDeletedPhotosCache(), []);
  const [user] = useState(() => readUserProfileCache());
  const [accentColor] = useState(() => readAccentColorCache() || '#46a935');
  const [deletedPhotos, setDeletedPhotos] = useState(() => (
    Array.isArray(cachedRecentlyDeleted?.photos) ? cachedRecentlyDeleted.photos : []
  ));
  const [loading, setLoading] = useState(() => !Array.isArray(cachedRecentlyDeleted?.photos));

  useEffect(() => applyAppPageMeta({
    title: 'iClora Data Recovery',
    lightIcon: '/favicon.ico',
    darkIcon: '/faviconn.ico',
  }), []);

  useEffect(() => {
    if (Array.isArray(cachedRecentlyDeleted?.photos)) {
      setLoading(false);
      return () => {};
    }

    let cancelled = false;

    async function loadDeletedPhotos() {
      try {
        const response = await apiFetch('/photos/recently-deleted', { cache: 'no-store' });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || json?.ok === false) {
          throw new Error(json?.error || 'Could not load recently deleted photos');
        }
        if (!cancelled) {
          const nextPhotos = Array.isArray(json?.photos) ? json.photos : [];
          setDeletedPhotos(nextPhotos);
          writeRecentlyDeletedPhotosCache(nextPhotos);
        }
      } catch (error) {
        if (!cancelled) {
          showAlert({
            title: 'Recovery unavailable',
            message: error?.message || 'Could not load recently deleted photos.',
            type: 'error',
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDeletedPhotos();
    return () => {
      cancelled = true;
    };
  }, [cachedRecentlyDeleted, showAlert]);

  return (
    <div className="iclora-recovery">
      <DashboardNavbar
        user={user}
        accentColor={accentColor}
        showBack
        onBack={() => navigate('/cloud')}
        appLabel="Data Recovery"
        appLabelColor="#ff8d32"
        appIcon="/favicon.ico"
        appIconDark="/faviconn.ico"
        whiteBackground
      />

      <main className="iclora-recovery__shell" aria-label="Data Recovery center">
        <section className="iclora-recovery__hero">
          <h1>Data Recovery</h1>
          <p>Recover deleted items from supported iClora apps before they expire.</p>
        </section>

        <section className="iclora-recovery__grid" aria-label="Recovery apps">
          <button
            type="button"
            className="iclora-recovery__card iclora-recovery__card--active"
            onClick={() => navigate('/cloud/apps/photos/u', { state: { initialView: 'deleted' } })}
          >
            <div className="iclora-recovery__card-head">
              <picture className="iclora-recovery__card-icon iclora-recovery__card-icon--photos">
                <source srcSet="/apps/photos-dark.webp" media="(prefers-color-scheme: dark)" />
                <img src="/apps/photos.webp" alt="" aria-hidden="true" />
              </picture>
              <div className="iclora-recovery__card-copy">
                <strong>Restore Photos</strong>
                <span>Recently Deleted</span>
              </div>
              <span className="iclora-recovery__card-arrow" aria-hidden="true">
                <FiArrowRight />
              </span>
            </div>

            <div className="iclora-recovery__meta">
              <span>{deletedPhotos.length} item{deletedPhotos.length === 1 ? '' : 's'}</span>
              <span className="iclora-recovery__meta-note">
                <FiClock aria-hidden="true" />
                Auto deletes in 15 days
              </span>
            </div>

            <div className="iclora-recovery__uids" aria-label="Deleted photo UIDs">
              {loading ? (
                <div className="iclora-recovery__loader" role="status" aria-live="polite">
                  <AppleLoader size={22} />
                  <span>Loading deleted photos...</span>
                </div>
              ) : deletedPhotos.length ? (
                deletedPhotos.slice(0, 18).map((photo) => (
                  <div className="iclora-recovery__uid-row" key={photo.id}>
                    <code>{photo.id}</code>
                  </div>
                ))
              ) : (
                <div className="iclora-recovery__empty">
                  <FiImage aria-hidden="true" />
                  <span>No deleted photos right now.</span>
                </div>
              )}
            </div>
          </button>

          {upcomingRecoveryApps.map(({ id, title, subtitle, icon, darkIcon }) => (
            <article
              className="iclora-recovery__card iclora-recovery__card--soon"
              key={id}
              aria-label={`${title} will be added soon`}
            >
              <div className="iclora-recovery__card-head">
                <picture className="iclora-recovery__card-icon">
                  <source srcSet={darkIcon} media="(prefers-color-scheme: dark)" />
                  <img src={icon} alt="" aria-hidden="true" />
                </picture>
                <div className="iclora-recovery__card-copy">
                  <strong>{title}</strong>
                  <span>{subtitle}</span>
                </div>
              </div>

              <div className="iclora-recovery__meta">
                <span>0 items</span>
                <span className="iclora-recovery__meta-note iclora-recovery__meta-note--muted">
                  Available soon
                </span>
              </div>

              <div className="iclora-recovery__uids" aria-label={`${title} UIDs`}>
                <div className="iclora-recovery__uid-row iclora-recovery__uid-row--placeholder">
                  <code>Will be added soon</code>
                </div>
              </div>
            </article>
          ))}
        </section>

        <section className="iclora-recovery__notes" aria-label="Recovery notes">
          <div className="iclora-recovery__info">
            <FiInfo aria-hidden="true" />
            <p>Photos in Recently Deleted are permanently removed after 15 days.</p>
          </div>
          <p className="iclora-recovery__soon">More apps support will be added soon.</p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
