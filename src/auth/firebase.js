import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || '',
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.REACT_APP_FIREBASE_APP_ID || '',
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
