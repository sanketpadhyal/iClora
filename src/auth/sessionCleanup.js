import { signOut } from 'firebase/auth';
import { clearLoginData, clearRuntimeCaches } from './authCache';
import { getFirebaseAuth, resetFirebaseAuth } from './firebase';

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function clearSignedOutData({ maxWaitMs = 450 } = {}) {
  clearLoginData();

  const cleanup = Promise.allSettled([
    clearRuntimeCaches(),
    (async () => {
      try {
        await signOut(getFirebaseAuth());
      } catch {
      }
    })(),
  ]).then(() => {
    clearLoginData();
  });

  if (maxWaitMs > 0) {
    await Promise.race([cleanup, wait(maxWaitMs)]);
  }

  clearLoginData();
  void cleanup;
}

export async function clearDataBeforeFreshLogin() {
  clearLoginData({ markSignOut: false });

  const signOutTask = (async () => {
    try {
      await signOut(getFirebaseAuth());
    } catch {
    }
  })();

  await Promise.race([signOutTask, wait(650)]);
  void signOutTask;

  // Reset the cached Firebase Auth instance so the next login starts with
  // a clean SDK state.  Without this, the stale in-memory instance can
  // cause signInWithPopup to hang or fail silently.
  resetFirebaseAuth();

  clearLoginData({ markSignOut: false });
}
