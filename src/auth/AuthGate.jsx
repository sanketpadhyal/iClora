import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { clearLoginData, isProfilePhotoCompletionActive, readAuthCache, readSessionExpiresAt, readSessionToken, writeAuthCache } from './authCache';
import { clearSignedOutData } from './sessionCleanup';
import { apiFetch, isStaleSessionResponse } from '../api/backendapi';
import { useAlert } from '../alert/alert';
import { readUserProfileCache, writeUserProfileCache } from '../cloud/userProfileCache';

export default function AuthGate() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showAlert } = useAlert();
  const inflightRef = useRef(false);
  const expiryTimerRef = useRef(null);

  useEffect(() => {
    const path = location.pathname;
    const isOnProfilePhotoPage = path === '/profile-photo';
    const isOnCloudPage = path.startsWith('/cloud');
    const isOnSharePage = path.startsWith('/share/');
    const isOnAuthPage = path === '/auth';
    const isOnHomePage = path === '/home';
    const isOnPublicPage = path === '/' || isOnAuthPage;
    const setupJustCompleted = isProfilePhotoCompletionActive();
    const cachedAuth = readAuthCache();
    const cachedProfile = readUserProfileCache();
    const hasSessionToken = Boolean(readSessionToken());
    const hasCachedSession = Boolean(readSessionExpiresAt());
    if (isOnSharePage) return;
    if (isOnProfilePhotoPage) return;
    if ((isOnAuthPage || isOnHomePage) && !cachedAuth && !hasSessionToken) return;
    if (path === '/cloud' && cachedAuth?.ok && cachedProfile && hasCachedSession) return;
    if (inflightRef.current) return;

    inflightRef.current = true;

    apiFetch('/auth/me')
      .then((r) => {
        if (r.status === 401) {
          if (isStaleSessionResponse(r)) {
            const error = new Error('stale-session-response');
            error.code = 'STALE_SESSION_RESPONSE';
            throw error;
          }
          const error = new Error('session-expired');
          error.code = 'SESSION_EXPIRED';
          throw error;
        }
        return r.json().catch(() => ({}));
      })
      .then((json) => {
        if (!json?.ok) {
          if (setupJustCompleted) return;
          clearLoginData();
          return;
        }

        const hasProfilePhoto = Boolean(json?.profilePhotoUrl);
        const needsProfilePhoto = Boolean(json?.needsProfilePhoto) && !hasProfilePhoto && !setupJustCompleted;

        writeAuthCache({ ok: true, needsProfilePhoto });

        writeUserProfileCache({
          ...(cachedProfile || {}),
          uid: typeof json?.uid === 'string' ? json.uid : (cachedProfile?.uid || ''),
          name: typeof json?.name === 'string' ? json.name : (cachedProfile?.name || ''),
          firstName: typeof json?.firstName === 'string' ? json.firstName : (cachedProfile?.firstName || ''),
          middleName: typeof json?.middleName === 'string' ? json.middleName : (cachedProfile?.middleName || ''),
          lastName: typeof json?.lastName === 'string' ? json.lastName : (cachedProfile?.lastName || ''),
          email: typeof json?.email === 'string' ? json.email : (cachedProfile?.email || ''),
          birthDate: typeof json?.birthDate === 'string' ? json.birthDate : (cachedProfile?.birthDate || ''),
          dob: typeof json?.dob === 'string' ? json.dob : (cachedProfile?.dob || ''),
          countryCode: typeof json?.countryCode === 'string' ? json.countryCode : (cachedProfile?.countryCode || ''),
          countryName: typeof json?.countryName === 'string' ? json.countryName : (cachedProfile?.countryName || ''),
          provider: typeof json?.provider === 'string' ? json.provider : (cachedProfile?.provider || ''),
          createdAt: typeof json?.createdAt === 'string' ? json.createdAt : (cachedProfile?.createdAt || ''),
          lastLoginBy: typeof json?.lastLoginBy === 'string' ? json.lastLoginBy : (cachedProfile?.lastLoginBy || ''),
          lastLoginAt: typeof json?.lastLoginAt === 'string' ? json.lastLoginAt : (cachedProfile?.lastLoginAt || ''),
          profilePhotoUrl: typeof json?.profilePhotoUrl === 'string' ? json.profilePhotoUrl : (cachedProfile?.profilePhotoUrl || ''),
          plan: typeof json?.plan === 'string' && json.plan ? json.plan : (cachedProfile?.plan || 'basic'),
          storage:
            typeof json?.storage === 'number' && Number.isFinite(json.storage)
              ? json.storage
              : (typeof cachedProfile?.storage === 'number' ? cachedProfile.storage : 1024),
          storageused:
            typeof json?.storageused === 'number' && Number.isFinite(json.storageused)
              ? Math.max(0, json.storageused)
              : (typeof cachedProfile?.storageused === 'number' ? cachedProfile.storageused : 0),
          storageBreakdown: Array.isArray(json?.storageBreakdown) ? json.storageBreakdown : (cachedProfile?.storageBreakdown || []),
        });

        if (isOnAuthPage || isOnHomePage) {
          navigate(needsProfilePhoto ? '/profile-photo' : '/cloud', {
            replace: true,
          });
          return;
        }

        if (needsProfilePhoto) {
          if (!isOnHomePage && !isOnProfilePhotoPage) {
            navigate('/profile-photo', { replace: true });
          }
          return;
        }

        if (isOnPublicPage && !isOnCloudPage) {
          navigate('/cloud', { replace: true });
        }
      })
      .catch(async (error) => {
        if (setupJustCompleted) return;
        if (error?.code === 'STALE_SESSION_RESPONSE') return;
        if (error?.code !== 'SESSION_EXPIRED' && isOnCloudPage && cachedProfile && hasCachedSession) {
          return;
        }
        if (error?.code === 'SESSION_EXPIRED') {
          await clearSignedOutData();
        } else {
          clearLoginData();
        }
        if (isOnCloudPage) {
          showAlert({
            title: 'Session expired',
            message: 'Please sign in again.',
            type: 'info',
            duration: 3200,
          });
          navigate('/auth', { replace: true, state: { sessionExpired: true } });
        }
      })
      .finally(() => {
        inflightRef.current = false;
      });
  }, [location.pathname, navigate, showAlert]);

  useEffect(() => {
    const isOnCloudPage = location.pathname.startsWith('/cloud');
    if (!isOnCloudPage) return undefined;

    if (expiryTimerRef.current) {
      window.clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }

    const expiresAt = readSessionExpiresAt();
    if (!expiresAt) return undefined;

    const delay = expiresAt - Date.now();
    if (delay <= 0) {
      clearSignedOutData();
      showAlert({
        title: 'Session expired',
        message: 'Please sign in again.',
        type: 'info',
        duration: 3200,
      });
      navigate('/auth', { replace: true, state: { sessionExpired: true } });
      return undefined;
    }

    expiryTimerRef.current = window.setTimeout(() => {
      clearSignedOutData();
      showAlert({
        title: 'Session expired',
        message: 'Please sign in again.',
        type: 'info',
        duration: 3200,
      });
      navigate('/auth', { replace: true, state: { sessionExpired: true } });
    }, delay);

    return () => {
      if (expiryTimerRef.current) {
        window.clearTimeout(expiryTimerRef.current);
        expiryTimerRef.current = null;
      }
    };
  }, [location.pathname, navigate, showAlert]);

  return null;
}
