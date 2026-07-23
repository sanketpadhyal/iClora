import React, { useCallback, useState } from 'react';
import './login.css';
import { signInWithPopup } from 'firebase/auth';
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import { useNavigate } from 'react-router-dom';
import { getAuthUrlForProvider } from './oauth';
import { getGoogleAuthDependencies, resetFirebaseAuth } from './firebase';
import { useAlert } from '../alert/alert';
import { writeAuthCache } from './authCache';
import { clearDataBeforeFreshLogin } from './sessionCleanup';
import { writeUserProfileCache } from '../cloud/userProfileCache';
import { apiFetch } from '../api/backendapi';

const AUTH_API_TIMEOUT_MS = 22000;
const GOOGLE_POPUP_TIMEOUT_MS = 90000;
const PASSKEY_PROMPT_TIMEOUT_MS = 90000;

function createTimeoutError(message) {
  const error = new Error(message);
  error.code = 'auth/operation-timeout';
  return error;
}

function withTimeout(promise, timeoutMs, message, onTimeout) {
  let timeoutId = 0;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      onTimeout?.();
      reject(createTimeoutError(message));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) window.clearTimeout(timeoutId);
  });
}

function isUserCancelledAuth(error) {
  return (
    error?.code === 'auth/popup-closed-by-user'
    || error?.code === 'auth/cancelled-popup-request'
    || error?.name === 'NotAllowedError'
    || error?.name === 'AbortError'
  );
}

function getAuthFailureMessage(error, fallback) {
  if (error?.code === 'auth/operation-timeout' || error?.name === 'TimeoutError') {
    return error.message || 'Sign-in timed out. Please try again.';
  }

  if (error?.name === 'NotAllowedError' || error?.name === 'AbortError') {
    return 'The sign-in prompt was cancelled or timed out. Please try again.';
  }

  return error?.message || fallback;
}

function Login({ onBack }) {
  const { showAlert } = useAlert();
  const [googleLoading, setGoogleLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [heroImageLoaded, setHeroImageLoaded] = useState(false);
  const navigate = useNavigate();
  const loginBusy = googleLoading || passkeyLoading;

  const finishGoogleLogin = useCallback(async (firebaseResult) => {
    if (!firebaseResult?.user) return null;
    const firebaseUser = firebaseResult.user;
    const idToken = await withTimeout(
      firebaseResult.user.getIdToken(),
      AUTH_API_TIMEOUT_MS,
      'Google session took too long. Please try again.',
      resetFirebaseAuth,
    );
    const response = await apiFetch('/auth/session', {
      method: 'POST',
      skipAuth: true,
      timeoutMs: AUTH_API_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });

    if (!response.ok) {
      throw new Error('Backend session exchange failed');
    }

    const json = await response.json().catch(() => ({}));
    if (typeof json?.sessionToken !== 'string' || !json.sessionToken) {
      throw new Error('Backend session token missing');
    }
    const hasProfilePhoto = Boolean(json?.profilePhotoUrl);
    return {
      uid: typeof json?.uid === 'string' ? json.uid : (firebaseUser.uid || ''),
      name: typeof json?.name === 'string' ? json.name : (firebaseUser.displayName || ''),
      email: typeof json?.email === 'string' ? json.email : (firebaseUser.email || ''),
      provider: typeof json?.provider === 'string' ? json.provider : 'firebase',
      profilePhotoUrl: typeof json?.profilePhotoUrl === 'string' ? json.profilePhotoUrl : '',
      plan: typeof json?.plan === 'string' && json.plan ? json.plan : 'basic',
      storage: typeof json?.storage === 'number' && Number.isFinite(json.storage) ? json.storage : 1024,
      storageused: typeof json?.storageused === 'number' && Number.isFinite(json.storageused) ? json.storageused : 0,
      storageBreakdown: Array.isArray(json?.storageBreakdown) ? json.storageBreakdown : [],
      isNewUser: Boolean(json?.isNewUser),
      hasProfilePhoto,
      needsProfilePhoto: Boolean(json?.needsProfilePhoto) && !hasProfilePhoto,
      sessionToken: typeof json?.sessionToken === 'string' && json.sessionToken ? json.sessionToken : '',
      sessionExpiresAt: typeof json?.sessionExpiresAt === 'number' ? json.sessionExpiresAt : 0,
    };
  }, []);

  const completeLogin = useCallback((result) => {
    if (!result) return;

    const profileSeed = {
      plan: result.plan || 'basic',
      storage: typeof result.storage === 'number' && Number.isFinite(result.storage) ? result.storage : 1024,
    };
    if (result.uid) profileSeed.uid = result.uid;
    if (result.email) profileSeed.email = result.email;
    if (result.name || result.email) profileSeed.name = result.name || result.email.split('@')[0];
    if (result.provider) profileSeed.provider = result.provider;
    if (result.profilePhotoUrl) profileSeed.profilePhotoUrl = result.profilePhotoUrl;
    if (Array.isArray(result.storageBreakdown) && result.storageBreakdown.length) {
      profileSeed.storageBreakdown = result.storageBreakdown;
      if (typeof result.storageused === 'number' && Number.isFinite(result.storageused)) {
        profileSeed.storageused = result.storageused;
      }
    }

    writeUserProfileCache(profileSeed);

    if (!result.hasProfilePhoto && (result.isNewUser || result.needsProfilePhoto)) {
      writeAuthCache({ ok: true, needsProfilePhoto: true, sessionToken: result.sessionToken, sessionExpiresAt: result.sessionExpiresAt });
      navigate('/profile-photo', { replace: true });
      return;
    }

    writeAuthCache({ ok: true, needsProfilePhoto: false, sessionToken: result.sessionToken, sessionExpiresAt: result.sessionExpiresAt });
    navigate('/cloud', {
      replace: true,
      state: {
        freshLogin: true,
        freshLoginId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
  }, [navigate]);

  const handleProvider = async (provider) => {
    if (provider === 'passkey') {
      if (loginBusy) return;
      if (!browserSupportsWebAuthn()) {
        showAlert({
          title: 'Passkeys unavailable',
          message: 'This browser does not support passkey sign-in.',
          type: 'info',
        });
        return;
      }

      setPasskeyLoading(true);
      try {
        await clearDataBeforeFreshLogin();

        const optionsResponse = await apiFetch('/auth/passkey/options', {
          method: 'POST',
          skipAuth: true,
          timeoutMs: AUTH_API_TIMEOUT_MS,
        });
        const optionsJson = await optionsResponse.json().catch(() => ({}));
        if (!optionsResponse.ok || !optionsJson?.ok) {
          throw new Error(optionsJson?.error || 'Could not start passkey sign-in');
        }

        const authenticationResponse = await withTimeout(
          startAuthentication({ optionsJSON: optionsJson.options }),
          PASSKEY_PROMPT_TIMEOUT_MS,
          'Passkey sign-in timed out. Please try again.',
        );
        const verifyResponse = await apiFetch('/auth/passkey/verify', {
          method: 'POST',
          skipAuth: true,
          timeoutMs: AUTH_API_TIMEOUT_MS,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            challengeId: optionsJson.challengeId,
            response: authenticationResponse,
          }),
        });
        const verifyJson = await verifyResponse.json().catch(() => ({}));
        if (!verifyResponse.ok || !verifyJson?.ok || !verifyJson?.sessionToken) {
          throw new Error(verifyJson?.error || 'Passkey sign-in failed');
        }

        completeLogin({
          uid: typeof verifyJson.uid === 'string' ? verifyJson.uid : '',
          name: typeof verifyJson.name === 'string' ? verifyJson.name : '',
          email: typeof verifyJson.email === 'string' ? verifyJson.email : '',
          provider: 'passkey',
          profilePhotoUrl: typeof verifyJson.profilePhotoUrl === 'string' ? verifyJson.profilePhotoUrl : '',
          plan: typeof verifyJson.plan === 'string' && verifyJson.plan ? verifyJson.plan : 'basic',
          storage: typeof verifyJson.storage === 'number' && Number.isFinite(verifyJson.storage) ? verifyJson.storage : 1024,
          storageused: typeof verifyJson.storageused === 'number' && Number.isFinite(verifyJson.storageused) ? verifyJson.storageused : 0,
          storageBreakdown: Array.isArray(verifyJson.storageBreakdown) ? verifyJson.storageBreakdown : [],
          isNewUser: false,
          hasProfilePhoto: true,
          needsProfilePhoto: false,
          sessionToken: verifyJson.sessionToken,
          sessionExpiresAt: typeof verifyJson.sessionExpiresAt === 'number' ? verifyJson.sessionExpiresAt : 0,
        });
        showAlert({
          title: 'Signed In',
          message: 'Passkey login completed successfully.',
          type: 'success',
        });
      } catch (error) {
        if (!isUserCancelledAuth(error)) {
          showAlert({
            title: 'Passkey Failed',
            message: getAuthFailureMessage(error, 'Passkey sign-in failed.'),
            type: 'error',
            duration: 4200,
          });
        }
      } finally {
        setPasskeyLoading(false);
      }
      return;
    }

    if (provider === 'google') {
      if (loginBusy) return;
      setGoogleLoading(true);
      try {
        await clearDataBeforeFreshLogin();

        let popupResult;
        try {
          const deps = getGoogleAuthDependencies();
          popupResult = await withTimeout(
            signInWithPopup(deps.auth, deps.provider),
            GOOGLE_POPUP_TIMEOUT_MS,
            'Google sign-in timed out. Please try again.',
            resetFirebaseAuth,
          );
        } catch (firstError) {

          if (isUserCancelledAuth(firstError) || firstError?.code === 'auth/operation-timeout') {
            throw firstError;
          }

          resetFirebaseAuth();
          const retryDeps = getGoogleAuthDependencies();
          popupResult = await withTimeout(
            signInWithPopup(retryDeps.auth, retryDeps.provider),
            GOOGLE_POPUP_TIMEOUT_MS,
            'Google sign-in timed out. Please try again.',
            resetFirebaseAuth,
          );
        }
        const result = await finishGoogleLogin(popupResult);
        completeLogin(result);
        showAlert({
          title: 'Signed In',
          message: 'Google login completed successfully.',
          type: 'success',
        });
      } catch (error) {
        if (isUserCancelledAuth(error)) {

        } else {
          showAlert({
            title: 'Sign-in Failed',
            message: getAuthFailureMessage(error, 'Google sign-in failed.'),
            type: 'error',
            duration: 4200,
          });
        }
      } finally {
        setGoogleLoading(false);
      }
      return;
    }

    const url = getAuthUrlForProvider(provider);
    if (!url) {
      showAlert({
        title: 'Not Configured Yet',
        message: `${provider.charAt(0).toUpperCase()}${provider.slice(1)} login is not configured yet.`,
        type: 'info',
      });
      return;
    }
    await clearDataBeforeFreshLogin();
    window.location.assign(url);
  };

  return (
    <main className="iclora-login" aria-label="Login page">
      <section className="iclora-login__card" aria-label="Login form">
        <div className={`iclora-login__image ${heroImageLoaded ? 'is-loaded' : 'is-loading'}`} aria-hidden="true">
          <span className="iclora-login__image-skeleton" aria-hidden="true" />
          <img
            src="/login.webp"
            alt=""
            loading="eager"
            decoding="async"
            onLoad={() => setHeroImageLoaded(true)}
            onError={() => setHeroImageLoaded(true)}
          />
        </div>

        <h1 className="iclora-login__title">
          Sign in to <span className="iclora-gradient">iClora</span>
        </h1>

        <div className="iclora-login__actions">
          <button
            type="button"
            className="iclora-login__provider iclora-login__provider--google"
            onClick={() => handleProvider('google')}
            disabled={loginBusy}
            aria-busy={googleLoading}
          >
            {googleLoading ? (
              <>
                <span className="iclora-login__provider-spinner" aria-hidden="true" />
                <span className="iclora-login__provider-text">Waiting for Google login...</span>
              </>
            ) : (
              <>
                <span className="iclora-login__provider-icon" aria-hidden="true">
                  <svg viewBox="0 0 48 48" focusable="false">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.72 1.22 9.23 3.62l6.9-6.9C35.93 2.37 30.39 0 24 0 14.62 0 6.51 5.38 2.56 13.22l8.04 6.24C12.46 13.1 17.77 9.5 24 9.5z"/>
                    <path fill="#4285F4" d="M46.5 24.5c0-1.64-.15-3.21-.43-4.73H24v9.01h12.6c-.54 2.92-2.18 5.4-4.64 7.06l7.1 5.5c4.14-3.82 6.44-9.44 6.44-16.84z"/>
                    <path fill="#FBBC05" d="M10.6 28.54c-.48-1.43-.75-2.95-.75-4.54s.27-3.11.75-4.54l-8.04-6.24C.92 16.46 0 20.1 0 24c0 3.9.92 7.54 2.56 10.78l8.04-6.24z"/>
                    <path fill="#34A853" d="M24 48c6.39 0 11.77-2.11 15.69-5.72l-7.1-5.5c-1.97 1.32-4.49 2.1-8.59 2.1-6.23 0-11.54-3.6-13.4-8.96l-8.04 6.24C6.51 42.62 14.62 48 24 48z"/>
                    <path fill="none" d="M0 0h48v48H0z"/>
                  </svg>
                </span>
                <span className="iclora-login__provider-text">Continue with Google</span>
              </>
            )}
          </button>

          <button
            type="button"
            className="iclora-login__provider iclora-login__provider--passkey"
            onClick={() => handleProvider('passkey')}
            disabled={loginBusy}
            aria-busy={passkeyLoading}
          >
            {passkeyLoading ? (
              <>
                <span className="iclora-login__provider-spinner iclora-login__provider-spinner--light" aria-hidden="true" />
                <span className="iclora-login__provider-text">Waiting for passkey...</span>
              </>
            ) : (
              <>
                <span className="iclora-login__provider-icon" aria-hidden="true">
                  <img src="/passkey.webp" alt="" className="iclora-login__passkey-icon" />
                </span>
                <span className="iclora-login__provider-text">Sign in with Passkey</span>
              </>
            )}
          </button>

          <button
            type="button"
            className="iclora-login__provider iclora-login__provider--facebook"
            onClick={() => handleProvider('facebook')}
            disabled={loginBusy}
          >
            <span className="iclora-login__provider-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path fill="currentColor" d="M13.5 22v-8h2.7l.4-3H13.5V9.2c0-.9.3-1.6 1.7-1.6h1.4V5c-.2 0-1.3-.1-2.5-.1-2.5 0-4.1 1.5-4.1 4.2V11H7.5v3H10v8h3.5z"/>
              </svg>
            </span>
            <span className="iclora-login__provider-text">Continue with Facebook</span>
          </button>

          <button
            type="button"
            className="iclora-login__provider iclora-login__provider--apple"
            onClick={() => handleProvider('apple')}
            disabled={loginBusy}
          >
            <span className="iclora-login__provider-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path fill="currentColor" d="M16.8 13.3c0-2 1.6-3 1.7-3.1-1-.9-2.5-1-3-1-1.3-.1-2.5.7-3.2.7-.7 0-1.7-.7-2.8-.7-1.4 0-2.7.8-3.5 2-1.5 2.6-.4 6.5 1.1 8.6.7 1 1.5 2.2 2.6 2.1 1-.1 1.4-.6 2.7-.6s1.6.6 2.7.6c1.1 0 1.8-1 2.5-2 .8-1.2 1.1-2.3 1.1-2.4-.1 0-1.9-.7-1.9-3.2zM14.9 6.8c.6-.8 1-1.8.9-2.9-1 .1-2.1.7-2.8 1.5-.6.7-1.1 1.7-.9 2.7 1.1.1 2.2-.5 2.8-1.3z"/>
              </svg>
            </span>
            <span className="iclora-login__provider-text">Continue with Apple</span>
          </button>
        </div>

        <p className="iclora-login__note">
          We use passwordless sign-in to keep your account secure and your data safer.
        </p>
      </section>
    </main>
  );
}

export default Login;
