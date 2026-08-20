import React from 'react';
import {
  FiDatabase,
  FiDownloadCloud,
  FiExternalLink,
  FiInfo,
  FiLock,
  FiRefreshCw,
  FiSearch,
  FiSmartphone,
  FiTrash2,
  FiUploadCloud,
} from 'react-icons/fi';
import PageShell from './PageShell';

const APP_DOWNLOAD_URL = 'https://github.com/sanketpadhyal/iClora-Photos-App/releases/download/v2.0.0/iclora-v2.apk';

const appHighlights = [
  {
    title: 'Android photo backup',
    copy: 'Select phone photos and send them directly to your iClora Photos cloud library.',
    icon: FiSmartphone,
  },
  {
    title: 'One-by-one upload flow',
    copy: 'Uploads are paced smoothly for mobile networks and backend load, instead of pushing everything at once.',
    icon: FiUploadCloud,
  },
  {
    title: 'Signed photo access',
    copy: 'Protected media uses secure signed links for safer upload and access control.',
    icon: FiLock,
  },
  {
    title: 'Website-connected',
    copy: 'Backed-up photos are available to view and manage from your own iClora Cloud on the web.',
    icon: FiRefreshCw,
  },
];

const appNewFeatures = [
  {
    title: 'Cloud Gallery in app',
    copy: 'View your backed-up iClora Photos directly inside the Android app, connected to the real backend.',
    icon: FiDatabase,
  },
  {
    title: 'Cached gallery loading',
    copy: 'Previously loaded cloud photos stay ready when you return, while fresh updates sync quietly in the background.',
    icon: FiRefreshCw,
  },
  {
    title: 'Cleaner photo details',
    copy: 'The photo info panel now uses real cloud metadata such as size, upload status, provider, and vision sync state.',
    icon: FiInfo,
  },
  {
    title: 'Better search',
    copy: 'The Android search page is smoother, cleaner, and built for quickly finding synced cloud photos.',
    icon: FiSearch,
  },
  {
    title: 'Delete and recovery flow',
    copy: 'Photos can be moved to Recently Deleted with confirmation, with cleaner recovery and permanent delete handling.',
    icon: FiTrash2,
  },
  {
    title: 'Polished mobile experience',
    copy: 'Improved loading feedback, app icon polish, placeholder filtering, and mobile layout fixes across the gallery.',
    icon: FiSmartphone,
  },
];

function ApplicationPage() {
  return (
    <PageShell
      title="Application"
      intro="Download the iClora App for Android to back up selected phone photos directly to your private iClora Photos cloud."
      accent="teal"
      className="iclora-application-page"
      hideMedia
      hideCta
    >
      <section className="iclora-page-section">
        <div className="iclora-app-download-panel">
          <div className="iclora-app-download-panel__icon" aria-hidden="true">
            <img src="/photos%20(1)_11zon%20(1).webp" alt="" />
          </div>
          <div className="iclora-app-download-panel__copy">
            <p className="iclora-page-eyebrow">iClora Photos App</p>
            <h2>Back up phone photos to your web cloud</h2>
            <p>
              The Android app does not create a new account. Sign in with your existing iClora account,
              choose photos from your phone, and back them up to the same iClora Cloud you use on the website.
            </p>
          </div>
          <a
            className="iclora-app-download-panel__button"
            href={APP_DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
          >
            <FiDownloadCloud aria-hidden="true" />
            <span>Download APK</span>
          </a>
        </div>
      </section>

      <section className="iclora-page-section">
        <div className="iclora-page-section__head">
          <p className="iclora-page-eyebrow">Version 2.0</p>
          <h2>What&apos;s new in the Android app</h2>
          <p>
            iClora App now includes a real cloud gallery experience, faster cached loading,
            cleaner photo details, and a more reliable mobile backup workflow.
          </p>
        </div>

        <div className="iclora-page-grid">
          {appNewFeatures.map(({ title, copy, icon: Icon }) => (
            <article className="iclora-page-card iclora-app-feature-card" key={title}>
              <span className="iclora-page-card__icon iclora-app-feature-card__icon" aria-hidden="true">
                <Icon />
              </span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="iclora-page-section">
        <div className="iclora-page-section__head">
          <h2>Made for fast, secure backup</h2>
          <p>The app is focused on one clear workflow: selected Android photos go to iClora Photos, then you view them on the web.</p>
        </div>

        <div className="iclora-page-grid iclora-page-grid--two">
          {appHighlights.map(({ title, copy, icon: Icon }) => (
            <article className="iclora-page-card iclora-app-feature-card" key={title}>
              <span className="iclora-page-card__icon iclora-app-feature-card__icon" aria-hidden="true">
                <Icon />
              </span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="iclora-page-section">
        <div className="iclora-page-band iclora-app-web-band">
          <div>
            <h2>View backups on iClora web</h2>
            <p className="iclora-page-copy">
              After upload, your backed-up photos are available inside iClora Photos on the web platform.
              Open your cloud from any browser and manage your photos there.
            </p>
          </div>
          <a
            className="iclora-page-inline-link iclora-page-inline-link--ext"
            href="https://www.iclora.app"
            target="_blank"
            rel="noreferrer"
          >
            Open iClora web
            <FiExternalLink aria-hidden="true" />
          </a>
        </div>
      </section>
    </PageShell>
  );
}

export default ApplicationPage;
