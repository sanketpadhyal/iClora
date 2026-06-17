<p align="center">
  <img src="Screenshot 2026-05-20 at 11.33.22 AM.webp" alt="iClora logo" width="96" />
</p>

<h1 align="center">iClora</h1>

<p align="center">
  A private full-stack personal cloud platform for photos, notes, contacts, account security, storage tracking, AI-powered photo search, and Android photo backup.
</p>

>> NOTE : planning to change vision model

<p align="center">
  <a href="https://www.iclora.app">Live Website</a>
  |
  <a href="https://github.com/sanketpadhyal/iClora-Photos-App">Android Photos App Repo</a>
</p>

## Overview

iClora is a full-stack personal cloud product built with React, Express, Firebase, Cloudinary, Supabase-ready modules, passkey authentication, a Florence-2 vision backend, and a companion Android Photos app.

The project is designed as a complete product experience rather than a small demo. It includes a public website, secure authentication, a cloud dashboard, photos, notes, contacts, account management, device activity, storage usage, AI-powered photo search, and mobile photo backup through the Android app.

This repository is maintained as a private product-style portfolio project. The README is written for internship applications, portfolio review, and technical discussion.

## Project Status

iClora is feature complete across the web platform, backend, vision pipeline, and Android Photos app.

Current state:

- Public website is complete.
- Authenticated cloud dashboard is complete.
- Photos, Notes, and Contacts web apps are complete.
- Profile setup, passkeys, device activity, account settings, and account deletion are implemented.
- Storage tracking and per-app usage breakdowns are implemented.
- AI photo captioning and search are integrated through a separate vision backend.
- Android Photos app is complete as a mobile backup companion.
- APK download links are wired into the website and Photos app navigation.
- Browser session handling is tuned for logged-in users, with 5-hour web sessions and longer Android app sessions.
- Responsive layouts, mobile behavior, and iOS performance handling are included.

## Why I Built This

iClora was built to practice and demonstrate real product engineering across frontend, backend, authentication, database design, media storage, performance, security, and AI integration.

The goal was to build flows that feel complete:

- A user can sign in securely.
- A new user can complete profile setup.
- A user can activate cloud apps.
- A user can upload, view, search, share, hide, restore, and delete photos.
- A user can write and organize notes.
- A user can store and manage contacts.
- A user can manage account security and active sessions.
- A user can track storage usage across apps.
- A user can search photos using AI-generated captions and metadata.
- A user can install the Android app and back up phone photos to the same cloud account.

## Product Surfaces

### Public Website

- Landing page for iClora.
- About, features, application, FAQ, support, policy, and developer pages.
- Download page for the Android Photos app.
- Responsive navigation and footer.
- Smooth scrolling and mobile viewport fixes.
- Protected image interaction behavior.
- Production visual assets, app icons, wallpapers, and PWA files.

### Authentication

- Google sign-in through Firebase Authentication.
- Backend session exchange using JWT.
- HTTP-only cookie support for browser sessions.
- Bearer-token support for app and web API calls.
- Local auth cache for fast dashboard entry.
- First-time profile photo completion flow.
- Passkey sign-in support using WebAuthn.
- Session expiry handling.
- Logout flow with server-side session activity updates.
- Web session lifetime configured for 5 hours.
- Android application sessions configured separately for longer mobile continuity.

### Cloud Dashboard

- Main authenticated dashboard.
- App cards for Photos, Notes, and Contacts.
- Dashboard previews from cached app data.
- Storage usage summary.
- Per-app storage breakdown.
- Dashboard accent color customization.
- Fresh-login loading state.
- Responsive desktop and mobile layouts.
- Performance-lite handling for lower-capability devices, while keeping iOS on full GPU mode.

### Photos Web App

- Photo upload support for JPEG, PNG, WebP, GIF, HEIC, and HEIF.
- Cloudinary-backed upload flow.
- Signed upload requests from the backend.
- Local optimistic photo previews.
- IndexedDB upload queue for reliability.
- Library, Favourites, Recents, Hidden, Recently Deleted, and iClora Links sections.
- Secure photo sharing links.
- Public shared photo view.
- Hidden Photos authentication flow.
- Recently Deleted restore and permanent delete.
- ZIP/download support through JSZip.
- AI search mode using stored vision labels and captions.
- Background sync states for uploaded photos.
- Sidebar link to download the Android Photos app.

### Android Photos App

The Android app is the mobile photo backup companion for iClora Photos.

Repository: [sanketpadhyal/iClora-Photos-App](https://github.com/sanketpadhyal/iClora-Photos-App)

Key capabilities:

- Sign in with an existing iClora account.
- Select Android photos from the phone.
- Back up selected photos to iClora Photos cloud.
- View synced cloud photos inside the app.
- Fetch real cloud gallery data from the iClora backend.
- Cache cloud photos for faster return visits.
- Refresh gallery data in the background.
- Search photos with a mobile-focused search UI.
- View real photo information and sync status.
- Move cloud photos to Recently Deleted.
- Handle cleaner recovery and delete states.
- Hide default placeholder photos from real user counts.
- Use the same private cloud account as the website.

APK download:

```text
https://github.com/sanketpadhyal/iClora-Photos-App/releases/download/v2.0.0/iclorav2.apk
```

### AI Photo Search

iClora uses a separate vision backend powered by Florence-2.

Flow:

1. A user uploads a photo.
2. The backend stores the image through Cloudinary.
3. A background vision cycle finds photos that still need processing.
4. The vision worker sends the image to the Florence-2 backend.
5. Florence returns a short caption.
6. The backend stores `visionLabel`, `visionCaption`, `visionTags`, and `searchText`.
7. The frontend photo search matches user queries against this AI metadata.

This allows searches for people, objects, places, scenes, or visual descriptions without requiring manual tagging.

### Notes App

- Notes dashboard and full notes workspace.
- Folder support.
- Create, edit, move, pin, lock, and delete notes.
- Formatting actions such as bold, italic, underline, and text controls.
- Search support.
- Import support for text-like files.
- Export/download support using JSZip.
- Local cache for faster startup.
- Dashboard preview cache for recent notes.
- Firebase or Supabase-backed implementation depending on environment configuration.

### Contacts App

- Contacts list and detail view.
- Create, edit, delete, and search contacts.
- Contact profile photo support.
- Contact photo upload through Cloudinary.
- Birthday, address, company, email, notes, and multiple phone fields.
- Country-aware phone formatting.
- Local cache for faster loading.
- Dashboard preview updates.
- Firebase or Supabase-backed implementation depending on environment configuration.

### Account Management

- Personal information editing.
- Profile photo crop and upload.
- Passkey registration and deletion.
- Device and session activity.
- Logout from individual devices.
- Expired session management.
- Privacy and sensitive account actions.
- Account deletion flow with re-authentication checks.
- Storage and profile data refresh.

## Security Work

iClora includes several security-focused engineering decisions:

- JWT-backed backend sessions.
- HTTP-only browser session cookies.
- Authorization bearer tokens for API requests.
- CORS origin allowlist.
- Origin checks for unsafe methods.
- Helmet middleware for secure HTTP headers.
- Rate limits for authentication and sensitive actions.
- Optional Redis-backed rate limiting.
- Firebase Admin token verification.
- Passkey/WebAuthn authentication.
- Server-side session activity tracking.
- Re-authentication before sensitive actions.
- Account deletion proof tokens.
- Hidden Photos verification tokens.
- Cloudinary authenticated/private media flows for protected images.

## Tech Stack

### Frontend

- React 19
- React Router
- Firebase client SDK
- SimpleWebAuthn browser SDK
- React Icons
- JSZip
- Feature-scoped CSS files
- LocalStorage caching
- IndexedDB upload queue
- Create React App build pipeline

### Backend

- Node.js
- Express
- Firebase Admin
- Firestore
- Supabase client support
- Cloudinary
- JSON Web Tokens
- Cookie Parser
- Helmet
- CORS
- Express Rate Limit
- Optional Redis and Redis rate-limit store
- Multer for uploads
- WebAuthn server support

### Vision Backend

- Node.js
- Express
- Multer
- Hugging Face Transformers.js
- Florence-2 base ONNX model
- Local model download/status endpoints
- Server-sent events for model download progress

### Android App

- React Native
- Expo
- Firebase authentication integration
- iClora backend API integration
- Native photo selection and mobile gallery flows
- Android APK release build

## Repository Structure

```text
iClora/
  frontend/
    public/
      App icons, wallpapers, images, PWA files, redirects, headers
    src/
      alert/                 Global alert UI
      api/                   Backend API helper
      auth/                  Login, Firebase, passkeys, auth cache
      cloud/                 Dashboard, navbar, account, plan, recovery
      components/            Home, footer, navbar, utility components
      contacts/              Contacts app UI
      notes/                 Notes app UI
      pages/                 Public website pages
      photos/                Photos app, sharing, upload queue logic
      App.js                 Main routes

  backend/
    auth/                    Sessions, passkeys, activity, account deletion
    contacts/                Contacts API and setup modules
    dashboard_tweeks/        Dashboard personalization API
    notes/                   Notes API and setup modules
    photos/                  Photos, sharing, hidden auth, recently deleted
    profile/                 Profile update API
    storage/                 Storage quota calculation
    supabase/                Supabase client and migration helpers
    vision process/          Background Florence photo caption cycle
    index.js                 Main Express server

  vision-backend/
    server/
      index.js               Florence-2 caption API and model manager
      models/                Local ONNX model files

  android app/
    android/                 Native Android project output
    assets/                  App images and icons
    src/
      screens/               App screens, cloud gallery, about, auth flows
    app.json                 Expo app configuration
```

The Android app also has its own repository:

```text
https://github.com/sanketpadhyal/iClora-Photos-App
```

## Architecture

```text
React Web App
   |
   | API requests with session token/cookies
   v
Express Backend
   |
   | Firebase Admin / Firestore
   | Supabase optional modules
   | Cloudinary media storage
   v
User Data + Media Metadata
   |
   | Background photo vision cycle
   v
Florence-2 Vision Backend
   |
   | Captions and tags
   v
Searchable photo metadata

Android Photos App
   |
   | Authenticated API requests
   v
Express Backend
   |
   | User photo metadata and Cloudinary media
   v
iClora Photos Cloud
```

## Important Product Flows

### New User Flow

1. User opens iClora.
2. User signs in with Google.
3. Firebase ID token is exchanged for a backend session.
4. Backend creates a secure JWT session.
5. New user completes profile photo setup.
6. User lands on the cloud dashboard.
7. User can activate Photos, Notes, or Contacts.

### Returning User Flow

1. User opens iClora again.
2. Frontend checks cached auth and the stored session token.
3. If the session is still valid, the user is sent directly to the cloud dashboard.
4. Backend validates the session in the background.
5. If the session has expired, the user is redirected to sign in again.

### Photo Upload Flow

1. User selects supported image files.
2. Frontend creates local previews immediately.
3. Upload request asks the backend for signed Cloudinary upload data.
4. File uploads to Cloudinary.
5. Backend stores photo metadata.
6. Background vision cycle generates AI metadata.
7. Photo becomes searchable through normal and AI search.

### Android Backup Flow

1. User installs the iClora Photos Android app.
2. User signs in with an existing iClora account.
3. User selects phone photos.
4. The app uploads selected photos to the iClora backend and Cloudinary-backed storage flow.
5. Synced photos appear in the Android app cloud gallery and on the website.
6. Gallery data is cached and refreshed for smoother return visits.

### Storage Flow

1. Backend reads active app metadata.
2. Photos, deleted photos, notes, contacts, and profile photo storage are counted.
3. Supabase-backed notes and contacts are counted when Supabase is configured.
4. Backend returns total usage and per-app breakdown.
5. Dashboard renders storage bars and app-level details.

## Live Product

Production website: [www.iclora.app](https://www.iclora.app)

Android app repository: [sanketpadhyal/iClora-Photos-App](https://github.com/sanketpadhyal/iClora-Photos-App)

APK release:

```text
https://github.com/sanketpadhyal/iClora-Photos-App/releases/download/v2.0.0/iclorav2.apk
```

iClora is maintained as a private product-style repository. The codebase is not distributed as a public starter template, so installation steps, private service keys, and deployment credentials are intentionally excluded from this README.

## Private Infrastructure

The project uses private configuration for:

- Firebase authentication and Firestore data.
- Backend JWT session signing.
- Cloudinary media storage.
- Optional Supabase-backed app data modules.
- Redis-backed rate limiting in supported environments.
- Florence-2 vision backend deployment.
- Android app release builds.
- Production domain and hosting configuration.

These services are connected through environment-specific configuration and are not documented with public credentials.

## Performance Work

iClora includes frontend and app performance work across mobile and desktop:

- GPU-composited animations using transform and opacity.
- Device capability hints.
- iOS-specific full GPU mode.
- Reduced-motion handling.
- Smooth scroll helpers.
- Mobile viewport height stabilization.
- Local caching for dashboard, notes, contacts, and photos.
- IndexedDB queue for photo uploads.
- Optimistic UI updates for faster perceived performance.
- Smaller upload batches on mobile.
- WebP conversion for profile images where useful.
- Cached cloud gallery data in the Android app.
- Background refresh patterns for photo sync.

## Design Details

The UI was built to feel like a real cloud product:

- Strong iClora visual identity.
- Public website with branded pages.
- App-like cloud dashboard cards.
- Custom cloud navbar.
- Polished login and profile setup experience.
- Modal and popup animation tuning.
- Responsive app layouts for mobile and desktop.
- Dark-mode-aware assets in several areas.
- iOS and touch-device interaction fixes.
- Clean storage visualization.
- Photos interface inspired by familiar gallery navigation patterns.
- Android app screens matched to the iClora Photos workflow.

## What This Project Demonstrates

This project demonstrates:

- Full-stack product thinking.
- React application architecture.
- Express API design.
- Auth and session management.
- Firebase Admin integration.
- Firestore data modeling.
- Supabase-compatible module design.
- Media upload and storage through Cloudinary.
- WebAuthn/passkey implementation.
- Secure account management flows.
- Background worker design.
- AI model integration with Florence-2.
- Android companion app development.
- Responsive frontend engineering.
- Performance tuning for mobile browsers.
- Product-level polish and UX completion.

## Key Engineering Decisions

### Separate Vision Backend

The Florence model is kept in a separate server so the main backend can stay focused on auth, app data, storage, and media workflows. This also makes the AI service easier to deploy, pause, replace, or scale independently.

### Companion Android App

The Android app is intentionally focused on mobile photo backup. It does not replace the full web cloud platform. Instead, it gives users a direct way to send phone photos into their existing iClora Photos cloud and view synced cloud gallery data from mobile.

### Cached Dashboard Previews

Notes, contacts, and photos write lightweight cache payloads for the dashboard. This keeps the dashboard feeling fast, even before fresh network data arrives.

### Cloudinary Direct Upload Flow

The photo app uses signed upload data from the backend and uploads media to Cloudinary. This avoids sending large files through the main backend process and keeps upload handling cleaner.

### Optional Supabase Modules

Notes and contacts can use Supabase when Supabase credentials are available. Otherwise, Firebase-backed modules are used. This gives the backend flexibility without changing the frontend routes.

### Storage Quota as a Backend Rule

Storage limits are checked on the backend, not only in the UI. This keeps account limits consistent across photos, profile images, notes, contacts, and deleted photos.

### Session Activity Tracking

Browser and app sessions are tracked on the backend so users can review devices, expire sessions, and keep account access understandable. Web sessions are shorter, while Android app sessions are tuned for mobile continuity.

## Private Repository Note

This repository is used as a private portfolio and product engineering project. It is not prepared for public cloning, public deployment, or outside contribution.

For internship and technical review purposes, the repository shows:

- Product-level frontend implementation.
- Backend route and service architecture.
- Authentication and account security work.
- Real media upload and storage workflows.
- AI-assisted photo search integration.
- Mobile-focused performance work.
- Android companion app integration.
- Complete feature ownership across multiple app surfaces.

## Future Improvements

Possible future improvements:

- Add more automated tests for backend routes.
- Add end-to-end tests for auth and cloud app flows.
- Add image/video deduplication.
- Add advanced album support.
- Add richer OCR-based photo search.
- Add offline-first improvements for notes.
- Add contact import/export using vCard.
- Add deeper admin tools for account and storage management.
- Add richer Android background upload controls.
- Add Play Store packaging after private APK distribution.

## Author

Built by Sanket Padhyal.

iClora was created as a serious full-stack portfolio project for internship applications, product engineering practice, and real-world web, backend, AI, and mobile development experience.
