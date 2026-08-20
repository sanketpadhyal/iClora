import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDMWxB4GoE7DbvodZNLMVw8ml1s86SmFd0",
  authDomain: "icloracloud.firebaseapp.com",
  projectId: "icloracloud",
  storageBucket: "icloracloud.firebasestorage.app",
  messagingSenderId: "361341042059",
  appId: "1:361341042059:web:ab9aea3127f067230f038e"
};

function getMissingFirebaseKeys() {
  return Object.entries(firebaseConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

function assertFirebaseConfig() {
  const missing = getMissingFirebaseKeys();

  if (missing.length) {
    throw new Error(`Missing Firebase config: ${missing.join(', ')}`);
  }
}

let firebaseAuth = null;
let firebaseApp = null;
let firebaseDb = null;

function getFirebaseApp() {
  if (firebaseApp) return firebaseApp;
  assertFirebaseConfig();
  firebaseApp = initializeApp(firebaseConfig);
  return firebaseApp;
}

export function getGoogleAuthDependencies() {
  if (firebaseAuth) {
    return { auth: firebaseAuth, provider: new GoogleAuthProvider() };
  }

  const app = getFirebaseApp();
  firebaseAuth = getAuth(app);
  return { auth: firebaseAuth, provider: new GoogleAuthProvider() };
}

export function resetFirebaseAuth() {
  firebaseAuth = null;
}

export function getFirebaseAuth() {
  return getGoogleAuthDependencies().auth;
}

export function getFirebaseDb() {
  if (firebaseDb) return firebaseDb;
  const app = getFirebaseApp();
  firebaseDb = getFirestore(app);
  return firebaseDb;
}
