import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './components/Home';
import Footer from './components/Footer';
import AppleLoader from './components/AppleLoader';
import Login from './auth/login';
import AuthGate from './auth/AuthGate';
import ProfilePhoto from './auth/profile-photo/ProfilePhoto';
import CloudDashboard from './cloud/dashboard';
import ManageAccount from './cloud/manage_account/manage';
import CloudRecovery from './cloud/recovery';
import CloudPlan from './cloud/plan';
import Notes from './notes/notes';
import Contacts from './contacts/contacts';
import Photos from './photos/photos';
import PublicPhotoShare from './photos/PublicPhotoShare';
import FeaturesPage from './pages/features';
import ApplicationPage from './pages/application';
import FAQPage from './pages/faq';
import AboutPage from './pages/about';
import SupportPage from './pages/support';
import PolicyPage from './pages/policy';
import DeveloperPage from './pages/developer';
import { isProfilePhotoCompletionActive, readAuthCache, readSessionToken, writeAuthCache } from './auth/authCache';
import { apiFetch } from './api/backendapi';
import { initGlobalImageProtection } from './components/utils/Imageprotector';
import { initBrowserInteractionFixes } from './components/utils/Browser';
import { initScrollPerformanceMode, initViewportSmoothing } from './components/utils/SmoothScroll';
import ScrollToTop from './ScrollToTop';
import { AlertProvider } from './alert/alert';
import './App.css';
import './popupPerformance.css';

function ProfilePhotoGate() {
  const navigate = useNavigate();
  const location = useLocation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (isProfilePhotoCompletionActive()) {
      navigate('/cloud', { replace: true, state: { profilePhotoCompleted: true } });
      return () => {
        cancelled = true;
      };
    }

    apiFetch('/auth/me')
      .then((response) => response.json().catch(() => ({})))
      .then((json) => {
        if (cancelled) return;

        if (!json?.ok) {
          navigate('/auth', { replace: true, state: { from: location.pathname } });
          return;
        }

        const hasProfilePhoto = Boolean(json?.profilePhotoUrl);
        const needsProfilePhoto = Boolean(json?.needsProfilePhoto) && !hasProfilePhoto;

        if (!needsProfilePhoto) {
          navigate('/cloud', { replace: true });
          return;
        }

        setReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          navigate('/auth', { replace: true, state: { from: location.pathname } });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [location.pathname, navigate]);

  // Render the profile photo UI immediately. The gate will still redirect
  // if the user is unauthorized or does not need a profile photo, but we
  // avoid showing a skeleton placeholder and instead let the page render
  // with a subtle gate-loading state handled by `ProfilePhoto`.
  return <ProfilePhoto gateLoading={!ready} />;
}

function CloudDashboardGate() {
  return <CloudDashboard />;
}

function AuthRouteGate({ children }) {
  const navigate = useNavigate();
  const cached = readAuthCache();
  const hasSessionToken = Boolean(readSessionToken());

  useEffect(() => {
    if (cached?.ok || hasSessionToken) {
      navigate('/cloud', { replace: true });
    }
  }, [cached?.ok, hasSessionToken, navigate]);

  return children;
}

function HomeRouteGate({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [checkingSession, setCheckingSession] = useState(true);
  const cached = readAuthCache();
  const hasSessionToken = Boolean(readSessionToken());
  const setupJustCompleted = isProfilePhotoCompletionActive();

  useEffect(() => {
    let cancelled = false;

    if (cached?.ok || hasSessionToken) {
      setCheckingSession(false);
      return () => {
        cancelled = true;
      };
    }

    setCheckingSession(true);
    apiFetch('/auth/me')
      .then((response) => {
        if (!response.ok) return null;
        return response.json().catch(() => null);
      })
      .then((json) => {
        if (cancelled) return;
        if (json?.ok) {
          const hasProfilePhoto = Boolean(json?.profilePhotoUrl);
          const needsProfilePhoto = Boolean(json?.needsProfilePhoto) && !hasProfilePhoto && !setupJustCompleted;
          writeAuthCache({ ok: true, needsProfilePhoto });
          navigate(needsProfilePhoto ? '/profile-photo' : '/cloud', { replace: true });
          return;
        }
        setCheckingSession(false);
      })
      .catch(() => {
        if (!cancelled) setCheckingSession(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cached?.ok, hasSessionToken, location.pathname, navigate, setupJustCompleted]);

  if (cached?.ok) {
    return <Navigate to={cached?.needsProfilePhoto && !setupJustCompleted ? '/profile-photo' : '/cloud'} replace />;
  }

  if (hasSessionToken) {
    return <Navigate to="/cloud" replace />;
  }

  if (checkingSession) {
    return (
      <main className="iclora-home iclora-home--checking" aria-label="Loading home page">
        <section className="iclora-home__loading" role="status" aria-live="polite" aria-label="Checking your session">
          <AppleLoader className="iclora-home__loading-spinner" size={42} hidden={false} label="Checking your session" />
        </section>
      </main>
    );
  }

  return children;
}

function App() {
  const location = useLocation();
  const isCloudRoute = location.pathname.startsWith('/cloud');
  const isShareRoute = location.pathname.startsWith('/share/');
  const isAuthRoute = location.pathname === '/auth';
  const isHomeRoute = location.pathname === '/home' || location.pathname === '/';
  const isPublicPageRoute = ['/features', '/application', '/faq', '/about', '/support', '/policy', '/developer'].includes(location.pathname);
  const hideSiteNavbar = isCloudRoute || isShareRoute;
  const cachedAuth = isAuthRoute ? readAuthCache() : null;
  const hasSessionToken = isAuthRoute ? Boolean(readSessionToken()) : false;

  useEffect(() => {
    // Initialize global image protection
    initGlobalImageProtection();
    initBrowserInteractionFixes();

    const viewportSmoothing = initViewportSmoothing();
    const scrollPerformanceMode = initScrollPerformanceMode();
    return () => {
      viewportSmoothing?.destroy();
      scrollPerformanceMode?.destroy();
    };
  }, []);

  return (
    <AlertProvider>
      <Navbar hidden={hideSiteNavbar} />
      <div className={`app ${isCloudRoute ? 'app--cloud' : ''} ${(isHomeRoute || isPublicPageRoute) ? 'app--home' : ''}`}>
        <ScrollToTop />
        <AuthGate />
        <div className="app__content">
          <Routes>
            <Route
              path="/"
              element={(
                <HomeRouteGate>
                  <Home />
                </HomeRouteGate>
              )}
            />
            <Route
              path="/home"
              element={(
                <HomeRouteGate>
                  <Home />
                </HomeRouteGate>
              )}
            />
            <Route
              path="/auth"
              element={(
                cachedAuth?.ok ? (
                  <Navigate to="/cloud" replace />
                ) : hasSessionToken ? (
                  <Navigate to="/cloud" replace />
                ) : (
                  <AuthRouteGate>
                    <Login />
                  </AuthRouteGate>
                )
              )}
            />
            <Route path="/profile-photo" element={<ProfilePhotoGate />} />
            <Route path="/features" element={<FeaturesPage />} />
            <Route path="/application" element={<ApplicationPage />} />
            <Route path="/faq" element={<FAQPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/support" element={<SupportPage />} />
            <Route path="/policy" element={<PolicyPage />} />
            <Route path="/developer" element={<DeveloperPage />} />
            <Route path="/cloud" element={<CloudDashboardGate />} />
            <Route path="/cloud/setting" element={<CloudRecovery />} />
            <Route path="/cloud/plan" element={<CloudPlan />} />
            <Route path="/cloud/manage-account" element={<ManageAccount />} />
            <Route path="/cloud/apps/notes/u" element={<Notes />} />
            <Route path="/cloud/apps/notes/u/:noteId" element={<Notes />} />
            <Route path="/cloud/apps/photos/u" element={<Photos />} />
            <Route path="/cloud/apps/photos/u/:photoId" element={<Photos />} />
            <Route path="/share/photos/:token" element={<PublicPhotoShare />} />
            <Route path="/cloud/apps/contacts/u" element={<Contacts />} />
            <Route path="/cloud/apps/contacts/u/:contactId" element={<Contacts />} />
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Routes>
          {!isCloudRoute && !isShareRoute && <Footer />}
        </div>
      </div>
    </AlertProvider>
  );
}

export default App;
