import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FiChevronLeft, FiCloud, FiDownloadCloud, FiEdit2, FiHardDrive, FiRefreshCcw, FiX } from 'react-icons/fi';
import { clearSignedOutData } from '../auth/sessionCleanup';
import { apiFetch } from '../api/backendapi';
import { useAlert } from '../alert/alert';
import './manage_account/manage.css';
import './dashboardnavbar.css';

const APP_STORAGE_BREAKDOWN = [
  { key: 'photos', label: 'Photos', color: '#ff2f92' },
  { key: 'notes', label: 'Notes', color: '#f5c542' },
  { key: 'contacts', label: 'Contacts', color: '#2f7be6' },
];
const ICLORA_APP_DOWNLOAD_URL = process.env.REACT_APP_ICLORA_APP_DOWNLOAD_URL || '#';

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

function DashboardNavbar({
  user,
  onCustomize,
  accentColor = '#46a935',
  showBack = false,
  onBack,
  disableAccountMenu = false,
  whiteBackground = false,
  appLabel = '',
  appLabelColor = '#f0b400',
  appIcon = '',
  appIconDark = '',
  darkLogoIcon = '',
  className = '',
  appSyncing = false,
  appSyncLabel = 'Syncing',
  onOpenStorageDetails,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { showAlert } = useAlert();
  const [accountOpen, setAccountOpen] = useState(false);
  const [appsOpen, setAppsOpen] = useState(false);
  const [storageAlertOpen, setStorageAlertOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const popoverRef = useRef(null);
  const displayName = (user?.name || user?.email || 'User').trim();
  const initial = displayName.charAt(0).toUpperCase();
  const totalMb = typeof user?.storage === 'number' && Number.isFinite(user.storage) ? Math.max(1, user.storage) : 1024;
  const storageBreakdown = normalizeStorageBreakdown(user?.storageBreakdown);
  const appUsedMb = storageBreakdown.reduce((total, app) => total + app.storageUsed, 0);
  const fallbackUsedMb = typeof user?.storageused === 'number' && Number.isFinite(user.storageused) ? Math.max(0, user.storageused) : 0;
  const usedMbRaw = appUsedMb > 0 ? appUsedMb : fallbackUsedMb;
  const usedMb = Math.min(usedMbRaw, totalMb);
  const usedPercent = Math.round((usedMb / totalMb) * 100);
  const storageSegments = storageBreakdown
    .filter((app) => app.storageUsed > 0)
    .map((app) => ({
      ...app,
      widthPercent: Math.max(0, Math.min(100, (Math.min(app.storageUsed, totalMb) / totalMb) * 100)),
    }));
  const showStorageAlert = usedPercent >= 70;
  const photosActive = storageBreakdown.find((app) => app.key === 'photos')?.active === true;
  const notesActive = storageBreakdown.find((app) => app.key === 'notes')?.active === true;
  const [setupPromptApp, setSetupPromptApp] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);
  const setupPromptConfig = {
    photos: {
      title: 'Setup Photos',
      description: 'You will be allotted a Photos Cloud for your account.',
      icon: '/apps/photos.webp',
      iconDark: '/apps/photos-dark.webp',
      endpoint: '/photos/setup',
      route: '/cloud/apps/photos/u',
      label: 'Photos',
    },
    notes: {
      title: 'Setup Notes',
      description: 'You will be allotted a Notes Cloud for your account.',
      icon: '/apps/notes.webp',
      iconDark: '/apps/notes-dark.webp',
      endpoint: '/notes/setup',
      route: '/cloud/apps/notes/u',
      label: 'Notes',
    },
  };
  const activeSetupPrompt = setupPromptConfig[setupPromptApp] || null;
  const canCustomize = location.pathname === '/cloud' && typeof onCustomize === 'function';

  const formatStorage = (mb) => {
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${Math.round(mb)} MB`;
  };

  useEffect(() => {
    function onDoc(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setAccountOpen(false);
        setAppsOpen(false);
        setStorageAlertOpen(false);
      }
    }

    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, []);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    const logoutRequest = apiFetch('/auth/logout', {
      method: 'POST',
      keepalive: true,
    }).catch(() => null);

    await clearSignedOutData({ maxWaitMs: 250 });
    setAccountOpen(false);
    setAppsOpen(false);
    setStorageAlertOpen(false);
    setLogoutConfirmOpen(false);
    navigate('/auth', { replace: true });
    void logoutRequest;
  }

  function openLogoutConfirm() {
    if (loggingOut) return;
    setAccountOpen(false);
    setAppsOpen(false);
    setStorageAlertOpen(false);
    setLogoutConfirmOpen(true);
  }

  function handleCustomize() {
    setAccountOpen(false);
    setAppsOpen(false);
    setStorageAlertOpen(false);
    onCustomize?.();
  }

  function handleUpgradePlan() {
    setAccountOpen(false);
    setAppsOpen(false);
    setStorageAlertOpen(false);
    navigate('/cloud/plan');
  }

  function handleOpenStorageDetails() {
    setAccountOpen(false);
    setAppsOpen(false);
    setStorageAlertOpen(false);
    if (typeof onOpenStorageDetails === 'function') {
      onOpenStorageDetails();
      return;
    }
    navigate('/cloud/plan');
  }

  function handleDownloadApp() {
    setAccountOpen(false);
    setAppsOpen(false);
    setStorageAlertOpen(false);
    window.open(ICLORA_APP_DOWNLOAD_URL, '_blank', 'noopener,noreferrer');
  }

  function openNotesApp() {
    setAppsOpen(false);
    if (notesActive) {
      navigate('/cloud/apps/notes/u');
      return;
    }
    setSetupPromptApp('notes');
  }

  function openPhotosApp() {
    setAppsOpen(false);
    if (photosActive) {
      navigate('/cloud/apps/photos/u');
      return;
    }
    setSetupPromptApp('photos');
  }

  function openContactsApp() {
    setAppsOpen(false);
    navigate('/cloud/apps/contacts/u');
  }

  async function activateSetupPrompt() {
    if (setupLoading || !activeSetupPrompt) return;
    setSetupLoading(true);
    try {
      const response = await apiFetch(activeSetupPrompt.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || `Could not activate ${activeSetupPrompt.label}`);
      setSetupPromptApp('');
      showAlert({
        title: `${activeSetupPrompt.label} activated`,
        message: `Your iClora ${activeSetupPrompt.label} Cloud is ready.`,
        type: 'success',
      });
      navigate(activeSetupPrompt.route);
    } catch (error) {
      showAlert({
        title: `${activeSetupPrompt?.label || 'App'} setup failed`,
        message: error?.message || 'Could not activate this app right now.',
        type: 'error',
      });
    } finally {
      setSetupLoading(false);
    }
  }

  return (
    <>
    <nav className={`dashboard-navbar ${whiteBackground ? 'dashboard-navbar--white' : ''} ${className}`.trim()} aria-label="Dashboard navigation" style={{ '--cloud-accent': accentColor }}>
      <div className="dashboard-navbar__container">
        {showBack && (
          <button
            type="button"
            className="dashboard-navbar__back-button"
            aria-label="Back"
            onClick={() => {
              setAccountOpen(false);
              setAppsOpen(false);
              setStorageAlertOpen(false);
              if (typeof onBack === 'function') {
                onBack();
                return;
              }
              navigate('/cloud');
            }}
          >
            <FiChevronLeft size={20} className="dashboard-navbar__back-icon-svg" />
          </button>
        )}
        <button
          type="button"
          className="dashboard-navbar__logo-button"
          aria-label="Go to dashboard"
          onClick={() => navigate('/cloud')}
        >
          <div className="dashboard-navbar__logo-panel">
            <picture className="dashboard-navbar__logo-picture">
              {appIconDark ? <source srcSet={appIconDark} media="(prefers-color-scheme: dark)" /> : (!appIcon && darkLogoIcon ? <source srcSet={darkLogoIcon} media="(prefers-color-scheme: dark)" /> : null)}
              <img src={appIcon || '/iclora-hero-cloud.webp'} alt="Logo" className="dashboard-navbar__logo" />
            </picture>
          </div>
          <span className="dashboard-navbar__brand">iClora</span>
          {appLabel ? (
            <span className="dashboard-navbar__app-label" style={{ color: appLabelColor }}>{appLabel}</span>
          ) : null}
          {appSyncing ? (
            <span
              className="dashboard-navbar__app-sync"
              role="status"
              aria-live="polite"
              aria-label={`${appSyncLabel}. Processing with server`}
              data-tooltip="Processing with server"
            >
              <img src="/arrow.png" alt="" aria-hidden="true" />
            </span>
          ) : null}
        </button>
        <div className="dashboard-navbar__actions" ref={popoverRef}>
          {showStorageAlert && (
            <button
              type="button"
              className={`dashboard-navbar__icon-button dashboard-navbar__alert-button ${storageAlertOpen ? 'is-active' : ''}`}
              aria-label="Storage almost full"
              aria-haspopup="true"
              aria-expanded={storageAlertOpen}
              onClick={() => {
                setStorageAlertOpen((open) => !open);
                setAppsOpen(false);
                setAccountOpen(false);
              }}
            >
              <span className="dashboard-navbar__alert-badge" aria-hidden="true">!</span>
            </button>
          )}
          <button
            type="button"
            className={`dashboard-navbar__icon-button dashboard-navbar__apps-button ${appsOpen ? 'is-active' : ''}`}
            aria-label="Open apps"
            aria-haspopup="true"
            aria-expanded={appsOpen}
            onClick={() => {
              setAppsOpen((open) => !open);
              setAccountOpen(false);
              setStorageAlertOpen(false);
            }}
          >
            <img src="/menu-dots.png" alt="" aria-hidden="true" className="dashboard-navbar__apps-icon" />
          </button>
          <div className="dashboard-navbar__profile">
            <button
              className="dashboard-navbar__avatar-button"
              aria-haspopup={disableAccountMenu ? undefined : 'true'}
              aria-expanded={disableAccountMenu ? false : accountOpen}
              aria-label={disableAccountMenu ? 'Account' : 'Open account menu'}
              onClick={() => {
                if (disableAccountMenu) return;
                setAccountOpen((open) => !open);
                setAppsOpen(false);
                setStorageAlertOpen(false);
              }}
            >
              {user?.profilePhotoUrl ? (
                <img src={user.profilePhotoUrl} alt={displayName} />
              ) : (
                <span className="dashboard-navbar__avatar-initial">{initial}</span>
              )}
            </button>

            {!disableAccountMenu && (
              <div
                className={`dashboard-navbar__menu dashboard-navbar__menu--account ${accountOpen ? 'is-open' : ''}`}
                role="menu"
                aria-hidden={!accountOpen}
              >
                <div className="dashboard-navbar__menu-user">
                  <div className="dashboard-navbar__menu-name">{displayName}</div>
                  <div className="dashboard-navbar__menu-email">{user?.email || ''}</div>
                </div>
                <ul>
                  {canCustomize ? (
                    <li>
                      <button type="button" className="dashboard-navbar__menu-item" onClick={handleCustomize}>
                        <span className="dashboard-navbar__menu-icon dashboard-navbar__menu-icon--settings" aria-hidden="true">
                          <FiEdit2 />
                        </span>
                        <span>Personalise iClora</span>
                      </button>
                    </li>
                  ) : null}
                  <li>
                    <button
                      type="button"
                      className="dashboard-navbar__menu-item dashboard-navbar__menu-item--blue dashboard-navbar__menu-item--pill"
                      onClick={() => {
                        setAccountOpen(false);
                        navigate('/cloud/manage-account');
                      }}
                    >
                      <span className="dashboard-navbar__menu-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="9.5" r="2.4" /><path d="M7.8 17a5 5 0 0 1 8.4 0" /></svg>
                      </span>
                      <span>Manage iClora Account</span>
                    </button>
                  </li>
                  <li className="dashboard-navbar__menu-row--danger">
                    <button type="button" className="dashboard-navbar__menu-item dashboard-navbar__menu-item--danger" onClick={openLogoutConfirm}>
                      <span className="dashboard-navbar__menu-icon" aria-hidden="true">
                        {loggingOut ? (
                          <span className="dashboard-navbar__logout-spinner" />
                        ) : (
                          <svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="8" /><path d="m9 9 6 6" /><path d="m15 9-6 6" /></svg>
                        )}
                      </span>
                      <span>{loggingOut ? 'Signing Out' : 'Sign Out'}</span>
                    </button>
                  </li>
                </ul>
              </div>
            )}
          </div>
          {showStorageAlert && (
            <div
              className={`dashboard-navbar__menu dashboard-navbar__menu--storage-alert ${storageAlertOpen ? 'is-open' : ''}`}
              role="dialog"
              aria-hidden={!storageAlertOpen}
              aria-label="Storage alert"
            >
              <div className="dashboard-navbar__storage-icon" aria-hidden="true">
                <img src="/image.png" alt="" draggable={false} />
              </div>
              <h3 className="dashboard-navbar__storage-title">Your Basic Plan is Almost Full</h3>
              <div className="dashboard-navbar__storage-meta-row">
                <span>{formatStorage(usedMb)} of {formatStorage(totalMb)} Used</span>
              </div>
              <div className="dashboard-navbar__storage-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usedPercent}>
                {storageSegments.map((segment) => (
                  <span
                    key={segment.key}
                    className="dashboard-navbar__storage-progress-fill"
                    style={{
                      width: `${segment.widthPercent}%`,
                      backgroundColor: segment.color,
                    }}
                  />
                ))}
              </div>
              <p className="dashboard-navbar__storage-copy">Upgrade your Plan to store more data.</p>
              <button type="button" className="dashboard-navbar__storage-upgrade" onClick={handleUpgradePlan}>Upgrade Plan</button>
            </div>
          )}
          <div
            className={`dashboard-navbar__menu dashboard-navbar__menu--apps ${appsOpen ? 'is-open' : ''}`}
            role="menu"
            aria-hidden={!appsOpen}
          >
            <h2>Apps</h2>
            <div className="dashboard-navbar__apps-grid dashboard-navbar__apps-grid--images">
              <button
                type="button"
                className="dashboard-navbar__app dashboard-navbar__app--image"
                aria-label="Photos"
                onClick={openPhotosApp}
              >
                <picture>
                  <source srcSet="/apps/photos-dark.webp" media="(prefers-color-scheme: dark)" />
                  <img src="/apps/photos.webp" alt="Photos" className="dashboard-navbar__app-image" draggable={false} />
                </picture>
                <span>Photos</span>
              </button>
              <button
                type="button"
                className="dashboard-navbar__app dashboard-navbar__app--image"
                aria-label="Notes"
                onClick={openNotesApp}
              >
                <picture>
                  <source srcSet="/apps/notes-dark.webp" media="(prefers-color-scheme: dark)" />
                  <img src="/apps/notes.webp" alt="Notes" className="dashboard-navbar__app-image" draggable={false} />
                </picture>
                <span>Notes</span>
              </button>
              <button
                type="button"
                className="dashboard-navbar__app dashboard-navbar__app--image"
                aria-label="Files"
                onClick={() => {
                  setAppsOpen(false);
                  showAlert({
                    title: 'Files',
                    message: 'Files will be added in the future. Stay tuned!',
                    type: 'info',
                  });
                }}
              >
                <picture>
                  <source srcSet="/apps/files-dark.webp" media="(prefers-color-scheme: dark)" />
                  <img src="/apps/files.webp" alt="Files" className="dashboard-navbar__app-image" draggable={false} />
                </picture>
                <span>Files</span>
              </button>
              <button
                type="button"
                className="dashboard-navbar__app dashboard-navbar__app--image"
                aria-label="Contacts"
                onClick={openContactsApp}
              >
                <picture>
                  <source srcSet="/apps/contacts-dark.webp" media="(prefers-color-scheme: dark)" />
                  <img src="/apps/contacts.webp" alt="Contacts" className="dashboard-navbar__app-image" draggable={false} />
                </picture>
                <span>Contacts</span>
              </button>
            </div>
            <h2>More</h2>
            <button
              type="button"
              className="dashboard-navbar__more-item"
              onClick={handleOpenStorageDetails}
            >
              <span className="dashboard-navbar__more-icon dashboard-navbar__more-icon--storage" aria-hidden="true">
                <FiHardDrive />
              </span>
              <span>Your iClora Storage</span>
            </button>
            <button
              type="button"
              className="dashboard-navbar__more-item dashboard-navbar__more-item--download"
              onClick={handleDownloadApp}
            >
              <span className="dashboard-navbar__more-icon dashboard-navbar__more-icon--download" aria-hidden="true">
                <FiDownloadCloud />
              </span>
              <span>Download iClora Photos App</span>
            </button>
            <button
              type="button"
              className="dashboard-navbar__more-item"
              onClick={() => {
                setAppsOpen(false);
                navigate('/cloud/setting');
              }}
            >
              <span className="dashboard-navbar__more-icon" aria-hidden="true">
                <FiRefreshCcw />
              </span>
              <span>Recover my data</span>
            </button>
            <button
              type="button"
              className="dashboard-navbar__more-item dashboard-navbar__more-item--blue"
              onClick={handleUpgradePlan}
            >
              <span className="dashboard-navbar__more-icon" aria-hidden="true">
                <FiCloud />
              </span>
              <span>Upgrade your plan</span>
            </button>
          </div>
        </div>
      </div>
    </nav>

    {logoutConfirmOpen && (
      <div
        className="manage-account__modal-layer dashboard-navbar__modal-layer"
        role="presentation"
        onMouseDown={() => {
          if (!loggingOut) setLogoutConfirmOpen(false);
        }}
      >
        <section
          className="manage-account__name-modal manage-account__delete-modal dashboard-navbar__logout-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dashboard-logout-confirm-title"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="manage-account__modal-close"
            aria-label="Close logout confirmation"
            onClick={() => setLogoutConfirmOpen(false)}
            disabled={loggingOut}
          >
            <FiX />
          </button>

          <div className="manage-account__modal-icon" aria-hidden="true">
            <img src="/logout.webp" alt="" className="manage-account__logout-icon-image" />
          </div>

          <h2 id="dashboard-logout-confirm-title">Sign out?</h2>
          <p className="manage-account__delete-copy">
            Are you sure you want to sign out of iClora?
          </p>

          <div className="manage-account__delete-actions">
            <button
              type="button"
              className="manage-account__delete-button manage-account__delete-button--cancel"
              onClick={() => setLogoutConfirmOpen(false)}
              disabled={loggingOut}
            >
              No
            </button>
            <button
              type="button"
              className="manage-account__delete-button manage-account__delete-button--danger manage-account__delete-button--logout"
              onClick={handleLogout}
              disabled={loggingOut}
              aria-busy={loggingOut}
            >
              {loggingOut ? (
                <span className="manage-account__button-spinner" aria-hidden="true" />
              ) : (
                <>
                  <img src="/logout.webp" alt="" aria-hidden="true" className="manage-account__logout-icon-image" />
                  <span>Yes</span>
                </>
              )}
            </button>
          </div>
        </section>
      </div>
    )}

    {activeSetupPrompt && (
      <div
        className="manage-account__modal-layer dashboard-navbar__modal-layer"
        role="presentation"
        onMouseDown={() => {
          if (!setupLoading) setSetupPromptApp('');
        }}
      >
        <section
          className={`manage-account__name-modal manage-account__setup-modal dashboard-navbar__logout-modal cloud-app-setup-modal ${setupLoading ? 'cloud-app-setup-modal--activating' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="dashboard-app-setup-title"
          aria-busy={setupLoading}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="manage-account__modal-close"
            aria-label={`Close ${activeSetupPrompt.label} setup`}
            onClick={() => setSetupPromptApp('')}
            disabled={setupLoading}
          >
            <FiX />
          </button>
          <div className="manage-account__modal-icon cloud-app-setup-modal__icon" aria-hidden="true">
            <picture>
              {activeSetupPrompt.iconDark && <source srcSet={activeSetupPrompt.iconDark} media="(prefers-color-scheme: dark)" />}
              <img src={activeSetupPrompt.icon} alt="" className="manage-account__setup-app-icon" />
            </picture>
          </div>
          <h2 id="dashboard-app-setup-title">{activeSetupPrompt.title}</h2>
          <p className="manage-account__delete-copy">{activeSetupPrompt.description}</p>
          <div className="manage-account__delete-actions">
            <button
              type="button"
              className="manage-account__delete-button manage-account__delete-button--cancel"
              onClick={() => setSetupPromptApp('')}
              disabled={setupLoading}
            >
              Cancel
            </button>
            <button
              type="button"
              className="manage-account__delete-button cloud-app-setup-modal__activate"
              onClick={activateSetupPrompt}
              disabled={setupLoading}
              aria-busy={setupLoading}
            >
              {setupLoading ? (
                <span className="manage-account__button-spinner" aria-hidden="true" />
              ) : (
                'Activate'
              )}
            </button>
          </div>
        </section>
      </div>
    )}
    </>
  );
}

export default React.memo(DashboardNavbar);
