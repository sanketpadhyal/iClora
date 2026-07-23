<p align="center">
  <img src="Screenshot%202026-05-20%20at%2011.33.22%20AM.webp" alt="iClora logo" width="96" />
</p>

<h1 align="center">iClora</h1>

<p align="center">
  A full personal cloud ecosystem for photos, notes, contacts, account security, storage tracking, Android photo backup, and AI-powered photo search.
</p>

<p align="center">
  <a href="https://www.iclora.app">Website</a>
  |
  <a href="https://github.com/sanketpadhyal/iClora-Backend.git">Backend Repository</a>
  |
  <a href="https://github.com/sanketpadhyal/Florence-BACKEND.git">Florence Backend</a>
  |
  <a href="https://github.com/sanketpadhyal/iClora-Photos-App.git">Android App</a>
</p>

<p align="center">
  <a href="https://www.iclora.app">
    <img src="https://img.shields.io/badge/Live_Website-www.iclora.app-00C853?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Live Website" />
  </a>
  <a href="https://github.com/sanketpadhyal/iClora-Backend.git">
    <img src="https://img.shields.io/badge/Backend-iClora_Backend-111827?style=for-the-badge&logo=nodedotjs&logoColor=3C873A" alt="Backend Repository" />
  </a>
  <a href="https://github.com/sanketpadhyal/Florence-BACKEND.git">
    <img src="https://img.shields.io/badge/AI-Florence_Backend-7C3AED?style=for-the-badge&logo=huggingface&logoColor=white" alt="Florence Backend" />
  </a>
  <a href="https://github.com/sanketpadhyal/iClora-Photos-App.git">
    <img src="https://img.shields.io/badge/Android-Photos_App-16A34A?style=for-the-badge&logo=android&logoColor=white" alt="Android Photos App" />
  </a>
</p>

## Overview

iClora is a complete personal cloud product built across web, backend, AI backend, and Android. It gives users a private cloud dashboard where they can manage photos, notes, contacts, account settings, storage usage, device sessions, passkeys, and photo search.

This repository contains the open-source React frontend for the iClora website and cloud dashboard. The backend, Florence AI service, and Android Photos app are maintained as separate open-source repositories so each part of the ecosystem can be explored independently.

The web platform is the main place where users create and manage their iClora account. The Android app is the mobile companion that helps users back up phone photos into the same iClora Photos cloud.

> [!IMPORTANT]
> **Open Source Notice**
> This frontend repository is open source and prepared for public review. Production Firebase values, backend secrets, service account keys, Cloudinary credentials, JWT secrets, Supabase service keys, Redis URLs, and private deployment credentials are not included.

> [!NOTE]
> **Full Ecosystem**
> iClora works as a connected system: React frontend, Node.js backend, Florence-2 vision backend, and Android Photos app.

## Product Links

| Product Surface | Link |
| --- | --- |
| Live Website | [www.iclora.app](https://www.iclora.app) |
| Frontend Repository | [sanketpadhyal/iClora.git](https://github.com/sanketpadhyal/iClora.git) |
| Backend Repository | [sanketpadhyal/iClora-Backend.git](https://github.com/sanketpadhyal/iClora-Backend.git) |
| Florence Backend Repository | [sanketpadhyal/Florence-BACKEND.git](https://github.com/sanketpadhyal/Florence-BACKEND.git) |
| Android Photos App Repository | [sanketpadhyal/iClora-Photos-App.git](https://github.com/sanketpadhyal/iClora-Photos-App.git) |

## iClora Ecosystem

| Component | Role |
| --- | --- |
| iClora Website | Public website, authentication flow, cloud dashboard, and web cloud apps |
| iClora Backend | Auth, sessions, user data, app APIs, storage, uploads, and security flows |
| Florence Backend | AI photo captioning and search metadata generation |
| iClora Photos App | Android companion for mobile photo backup and cloud gallery viewing |

## What iClora Does

1. User opens the iClora website.
2. User signs in with Google through Firebase Authentication.
3. Frontend exchanges the Firebase token with the iClora backend.
4. Backend creates a secure iClora session.
5. User enters the cloud dashboard.
6. User activates Photos, Notes, or Contacts.
7. User uploads photos, writes notes, stores contacts, and manages account security.
8. Android Photos App can back up phone photos into the same iClora Photos cloud.
9. Backend sends uploaded photos to the Florence backend for AI captions.
10. Frontend uses stored AI metadata for photo search.

## Key Features

### Public Website

- Branded iClora landing page.
- About, Features, Application, FAQ, Support, Policy, and Developer pages.
- Android app download entry points.
- Responsive navigation and footer.
- Smooth scroll behavior.
- PWA assets and app icons.
- Mobile-friendly layouts.

### Authentication

- Google sign-in through Firebase Authentication.
- Backend session exchange.
- HTTP-only cookie support for browser sessions.
- Bearer-token support for API calls.
- Local auth cache for fast dashboard entry.
- Session expiry handling.
- First-time profile photo setup.
- Logout flow with backend session updates.

### Cloud Dashboard

- Main signed-in iClora Cloud home.
- User profile display.
- Cloud app cards for Photos, Notes, and Contacts.
- Storage usage summary.
- Per-app storage breakdown.
- Dashboard previews from cached app data.
- Dashboard accent color customization.
- Desktop and mobile layouts.
- Low-latency cached loading states.

### Photos Web App

- Photo upload.
- Local optimistic previews.
- Background upload queue.
- Library, Favourites, Recents, Hidden, Recently Deleted, and iClora Links views.
- Secure photo sharing links.
- Public shared photo view.
- Hidden Photos authentication flow.
- Recently Deleted restore and permanent delete.
- ZIP download support.
- AI search using generated labels, captions, tags, and search text.
- Android app handoff for phone photo backup.

### Notes Web App

- Create, edit, pin, move, lock, and delete notes.
- Folder support.
- Search support.
- Rich text formatting controls.
- Text-like file import.
- ZIP export support.
- Local cache for faster startup.
- Dashboard preview cache.
- Mobile editor behavior tuned for touch devices.

### Contacts Web App

- Create, edit, delete, and search contacts.
- Contact profile photo support.
- Multiple phone fields.
- Email, company, birthday, notes, and address fields.
- Country-aware phone formatting.
- Contact export support.
- Local cache for faster loading.
- Dashboard preview updates.

### Account And Security

- Personal information editing.
- Profile photo crop and upload.
- Passkey registration and deletion.
- Device and session activity.
- Logout from selected sessions.
- Account recovery surfaces.
- Account deletion flow.
- Sensitive action checks.
- Settings and auth alert email support through the backend.

## Android Photos App

iClora Photos App is the Android companion for iClora Photos.

Repository:

[sanketpadhyal/iClora-Photos-App.git](https://github.com/sanketpadhyal/iClora-Photos-App.git)

The Android app is built for fast, secure photo backup from an Android phone to the user's own iClora Photos cloud.

What the app does:

- Signs in with the user's existing iClora Google account.
- Lets users select photos from their Android phone.
- Backs up selected photos to iClora Photos.
- Uploads photos in a controlled, mobile-friendly flow.
- Shows backup and sync progress.
- Shows storage usage before backup.
- Keeps backed-up photos available on the iClora website.
- Fetches real cloud gallery data from the iClora backend.
- Shows synced cloud photos inside the Android app.
- Caches cloud gallery data for faster return visits.
- Refreshes gallery data in the background.
- Supports search inside the mobile photo gallery.
- Shows real photo details and sync state.
- Moves cloud photos to Recently Deleted.
- Uses secure signed links for protected photo upload and access.

Users cannot create a new account inside the Android app. Account creation and full cloud access happen on the iClora website.

## Backend API

The iClora backend is open sourced separately.

Repository:

[sanketpadhyal/iClora-Backend.git](https://github.com/sanketpadhyal/iClora-Backend.git)

The backend handles:

- Firebase ID token verification.
- iClora session creation.
- JWT-backed web and application sessions.
- HTTP-only browser session cookies.
- Bearer-token API support.
- CORS origin allowlist.
- Origin checks for unsafe methods.
- Rate limiting for auth and sensitive actions.
- Optional Redis-backed rate limiting.
- Firebase Admin integration.
- Firestore-backed cloud data.
- Optional Supabase-backed Notes and Contacts modules.
- Cloudinary signed upload flow.
- Photos, Notes, Contacts, Profile, Storage, Passkey, and Account APIs.
- Recently Deleted photo workflow.
- Hidden Photos verification workflow.
- Device activity tracking.
- Account deletion proof flow.
- Background Florence vision processing.

## Florence Vision Backend

The Florence backend powers AI photo search for iClora Photos.

Repository:

[sanketpadhyal/Florence-BACKEND.git](https://github.com/sanketpadhyal/Florence-BACKEND.git)

The service receives an image, generates a short caption, and returns text that the backend stores as searchable photo metadata.

AI search flow:

1. User uploads a photo.
2. Main backend stores the image and photo metadata.
3. Vision cycle finds photos that still need AI processing.
4. Backend sends the image to Florence-BACKEND.
5. Florence-2 returns a short caption.
6. Backend stores `visionLabel`, `visionCaption`, `visionTags`, and `searchText`.
7. Frontend lets users search photos by people, places, objects, scenes, or visual descriptions.

Florence backend features:

- Image captioning with Florence-2.
- Express API backend.
- ONNX model support through Hugging Face Transformers.js.
- Model download endpoint.
- Model download status endpoint.
- Caption endpoint.
- Google Cloud Run compatible deployment.

## Tech Stack

| Component | Technology |
| --- | --- |
| Frontend | React 19, React Router, Firebase Client SDK, SimpleWebAuthn Browser, React Icons, JSZip |
| Frontend Build | Create React App, React Scripts |
| Styling | Feature-scoped CSS files |
| Caching | LocalStorage, IndexedDB upload queue |
| Backend | Node.js, Express, Firebase Admin, Firestore, Cloudinary, JWT, Cookie Parser, Helmet, CORS |
| Backend Optional Services | Supabase, Redis, Resend |
| AI Backend | Node.js, Express, Multer, Hugging Face Transformers.js, Florence-2 ONNX |
| Android App | React Native, Expo, Firebase auth integration, iClora API integration |

## Project Structure

| Directory | Description |
| --- | --- |
| `public/` | Static assets, icons, app images, wallpapers, PWA files, hosting redirects, headers |
| `src/alert/` | Global alert UI and alert helpers |
| `src/api/` | Backend API URL and request helper |
| `src/auth/` | Login, Firebase config, auth cache, OAuth helpers, profile setup |
| `src/cloud/` | Dashboard, navbar, account management, recovery, plan pages |
| `src/components/` | Shared website components and utilities |
| `src/contacts/` | Contacts cloud app |
| `src/notes/` | Notes cloud app |
| `src/pages/` | Public website pages |
| `src/photos/` | Photos app, public sharing, upload queue, photo API helpers |

## Main Frontend Files

| File | Purpose |
| --- | --- |
| `src/App.js` | Main route tree and app shell |
| `src/api/backendapi.js` | Backend API base URL and authenticated fetch helper |
| `src/auth/firebase.js` | Firebase client initialization from environment variables |
| `src/auth/login.jsx` | Login screen and Google sign-in flow |
| `src/cloud/dashboard.jsx` | Main iClora Cloud dashboard |
| `src/cloud/dashboardnavbar.jsx` | Cloud navigation and app entry controls |
| `src/photos/photos.jsx` | iClora Photos web app |
| `src/photos/photoBackendProcess.js` | Photo upload, queue, cache, and backend sync helpers |
| `src/photos/PublicPhotoShare.jsx` | Public shared photo route |
| `src/notes/notes.jsx` | iClora Notes web app |
| `src/contacts/contacts.jsx` | iClora Contacts web app |
| `src/cloud/manage_account/manage.jsx` | Account management and security UI |

## Environment Variables

Create a `.env` file from the example:

```bash
cp .env.example .env
```

### Frontend Configuration

```env
REACT_APP_BACKEND_API_URL=http://localhost:8080
REACT_APP_FIREBASE_API_KEY=your-firebase-web-api-key
REACT_APP_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=your-project-id
REACT_APP_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
REACT_APP_FIREBASE_APP_ID=your-web-app-id
REACT_APP_FACEBOOK_AUTH_URL=
REACT_APP_APPLE_AUTH_URL=
REACT_APP_ICLORA_APP_DOWNLOAD_URL=
```

### Backend Configuration

The backend repository has its own environment file. Typical backend variables include:

```env
PORT=8080
FRONTEND_ORIGIN=http://localhost:3000
JWT_SECRET=your-long-random-jwt-secret
FIREBASE_SERVICE_ACCOUNT_JSON=your-service-account-json
CLOUDINARY_CLOUD_NAME=your-cloudinary-cloud
CLOUDINARY_API_KEY=your-cloudinary-key
CLOUDINARY_API_SECRET=your-cloudinary-secret
VISION_API_URL=http://localhost:8081
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
REDIS_ENABLED=false
REDIS_URL=
RESEND_API=
RESEND_FROM=
```

> [!WARNING]
> Do not commit real `.env` files, Firebase Admin credentials, service account files, JWT secrets, Cloudinary secrets, Supabase service role keys, Redis URLs, or email provider keys.

## Getting Started

### Prerequisites

- Node.js 18 or newer.
- npm.
- Firebase project for authentication.
- Running iClora backend for authenticated cloud features.
- Optional Florence backend for AI photo captions.
- Optional Android app for mobile backup.

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Configure Environment

```bash
cp .env.example .env
```

Fill `.env` with your own Firebase web app values and backend URL.

### Step 3: Start The Frontend

```bash
npm start
```

The development server runs on:

```text
http://localhost:3000
```

### Step 4: Build For Production

```bash
npm run build
```

### Step 5: Run Tests

```bash
npm test
```

## Production Deployment

For production, deploy all connected services:

| Service | Deployment Need |
| --- | --- |
| Frontend | Static hosting such as Netlify, Vercel, Firebase Hosting, Cloudflare Pages, or similar |
| Backend | Node.js hosting such as Cloud Run, Railway, Render, Fly.io, or a VPS |
| Florence Backend | High-memory Node.js hosting, Cloud Run recommended for model workloads |
| Android App | APK release or app store distribution |

Frontend deployment needs:

- `REACT_APP_BACKEND_API_URL` pointing to the deployed backend, or hosting rewrites from `/api` to the backend.
- Firebase web app environment variables.
- Android app download URL if showing APK download buttons.

Backend deployment needs:

- Firebase Admin credentials.
- JWT secret.
- Frontend origin allowlist.
- Cloudinary credentials.
- Optional Redis, Supabase, Resend, and Florence API URL.

## Security Model

iClora is designed around a backend-controlled security model.

- Firebase handles initial Google authentication.
- Backend verifies Firebase ID tokens.
- Backend creates iClora sessions.
- Browser sessions use secure cookies.
- App/API requests can use bearer tokens.
- Unsafe methods are protected by origin checks.
- Sensitive routes are rate limited.
- Storage limits are enforced on the backend.
- Media uploads use signed backend-generated upload data.
- Hidden Photos requires verification before protected access.
- Account deletion and passkey actions use backend checks.

## Open Source Safety

This frontend repository does not include production credentials.

Not included:

- Firebase Admin service account files.
- Production Firebase web values.
- JWT secrets.
- Cloudinary secrets.
- Supabase service role keys.
- Redis URLs.
- Resend/API email secrets.
- Private deployment credentials.

Use `.env.example` as the public template and keep real credentials only in local or deployment environments.

## Roadmap

- Add more automated tests for cloud app routes.
- Add stronger end-to-end tests for auth and account flows.
- Add albums for Photos.
- Add richer OCR/photo search features.
- Add offline-first improvements for Notes.
- Add contact import/export improvements.
- Add richer Android background backup controls.
- Add app store release metadata when ready.

## Developed By

Developed by **Sanket Padhyal**.

Personal website: [www.sanketpadhyal.in](https://www.sanketpadhyal.in)

GitHub: [@sanketpadhyal](https://github.com/sanketpadhyal)

## License

Add a license before publishing if outside users are allowed to reuse, modify, or distribute this project.
