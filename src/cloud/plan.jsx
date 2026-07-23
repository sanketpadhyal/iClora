import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiCheckCircle, FiCloud, FiDatabase, FiHardDrive, FiImage, FiRefreshCcw, FiUsers } from 'react-icons/fi';
import DashboardNavbar from './dashboardnavbar';
import { readAccentColorCache } from './themeCache';
import { readUserProfileCache } from './userProfileCache';
import { applyAppPageMeta } from '../components/utils/pageMeta';
import Footer from '../components/Footer';
import './plan.css';

const includedFeatures = [
  { label: '1 GB of storage', icon: FiDatabase },
  { label: 'iClora Photos', icon: FiImage },
  { label: 'iClora Notes', icon: FiCheckCircle },
  { label: 'iClora Contacts', icon: FiUsers },
  { label: 'Data Recovery', icon: FiRefreshCcw },
];

const supportingApps = [
  {
    label: 'Photos',
    copy: 'Images and memories stay protected in iClora Photos.',
    icon: '/apps/photos.webp',
    darkIcon: '/apps/photos-dark.webp',
  },
  {
    label: 'Notes',
    copy: 'Notes are kept safely with your iClora account.',
    icon: '/apps/notes.webp',
    darkIcon: '/apps/notes-dark.webp',
  },
  {
    label: 'Files',
    copy: 'Files support is planned for future storage upgrades.',
    icon: '/apps/files.webp',
    darkIcon: '/apps/files-dark.webp',
  },
  {
    label: 'Contacts',
    copy: 'Contact data is stored securely and stays available to you.',
    icon: '/apps/contacts.webp',
    darkIcon: '/apps/contacts-dark.webp',
  },
];

export default function CloudPlan() {
  const navigate = useNavigate();
  const [user] = useState(() => readUserProfileCache());
  const [accentColor] = useState(() => readAccentColorCache() || '#46a935');

  useEffect(() => applyAppPageMeta({
    title: 'iClora Plan',
    lightIcon: '/favicon.ico',
    darkIcon: '/faviconn.ico',
  }), []);

  return (
    <div className="iclora-plan">
      <DashboardNavbar
        user={user}
        accentColor={accentColor}
        whiteBackground
        showBack
        onBack={() => navigate('/cloud')}
        appLabel="Plan"
        appLabelColor="#2f7be6"
        appIcon="/favicon.ico"
        appIconDark="/faviconn.ico"
      />

      <main className="iclora-plan__shell" aria-label="iClora plan">
        <section className="iclora-plan__hero">
          <picture className="iclora-plan__logo">
            <source srcSet="/faviconn.ico" media="(prefers-color-scheme: dark)" />
            <img src="/favicon.ico" alt="iClora Logo" />
          </picture>
          <h1>Your iClora Plan</h1>
          <div className="iclora-plan__summary">
            <strong>1 GB storage</strong>
            <span>Free</span>
          </div>
        </section>

        <section className="iclora-plan__body">
          <div className="iclora-plan__includes">
            <h2>Includes</h2>
            <ul>
              {includedFeatures.map(({ label, icon: Icon }) => (
                <li key={label}>
                  <span className="iclora-plan__dot" aria-hidden="true">
                    <Icon />
                  </span>
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="iclora-plan__divider" aria-hidden="true" />

          <div className="iclora-plan__future-stack">
            <aside className="iclora-plan__future" aria-label="Future plans">
              <div className="iclora-plan__future-icon" aria-hidden="true">
                <FiCloud />
              </div>
              <div>
                <h2>More plans will be added in future</h2>
                <p>Your current plan is Free with 1 GB storage. Paid upgrades are not available yet.</p>
              </div>
            </aside>

            <aside className="iclora-plan__future" aria-label="Starting plan">
              <div className="iclora-plan__future-icon" aria-hidden="true">
                <FiHardDrive />
              </div>
              <div>
                <h2>Starting plan will be ₹50 per GB per month</h2>
                <p>Flexible storage pricing will be available when paid plans launch.</p>
              </div>
            </aside>
          </div>
        </section>

        <section className="iclora-plan__apps" aria-labelledby="iclora-plan-supporting-apps">
          <div className="iclora-plan__apps-head">
            <h2 id="iclora-plan-supporting-apps">Supporting apps</h2>
            <p>All your iClora app data is handled safely and stays protected with your account.</p>
          </div>

          <div className="iclora-plan__apps-grid">
            {supportingApps.map((app) => (
              <article className="iclora-plan__app-card" key={app.label}>
                <picture className="iclora-plan__app-icon">
                  <source srcSet={app.darkIcon} media="(prefers-color-scheme: dark)" />
                  <img src={app.icon} alt="" aria-hidden="true" />
                </picture>
                <div>
                  <h3>{app.label}</h3>
                  <p>{app.copy}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
