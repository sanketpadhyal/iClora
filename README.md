<p align="center">
  <img src="Screenshot 2026-05-20 at 11.33.22 AM.webp" alt="iClora logo" width="96" />
</p>

<h1 align="center">iClora ☁️</h1>

<p align="center">
  A private full-stack personal cloud platform for photos, notes, contacts, account security, storage tracking, and AI-powered photo search.
</p>

<p align="center">
  <a href="https://www.iclora.app">Live Website</a>
</p>

## Overview

iClora is a polished cloud workspace built with React, Express, Firebase, Cloudinary, Supabase-ready data modules, passkey authentication, and a local Florence-2 vision backend. The project is designed as a complete product experience rather than a small demo. It includes a public marketing site, secure login, a cloud dashboard, media management, notes, contacts, account settings, device activity, storage usage, and background AI indexing for uploaded photos.

This repository is private and is not intended for public distribution. This README is written as a professional project summary for internship applications, portfolio review, and technical discussion.

## Project Status

The web version is feature complete.

Current state:

- Public website and cloud dashboard are complete.
- Authentication and session handling are implemented.
- Photos, notes, and contacts apps are implemented.
- Profile, passkeys, device activity, and account deletion flows are implemented.
- Storage tracking and app-level usage breakdowns are implemented.
- AI photo captioning/search pipeline is integrated through a separate vision backend.
- Responsive layouts and iOS/mobile performance tuning are included.

## Why I Built This

iClora was built to practice and demonstrate real product engineering across frontend, backend, authentication, database design, media storage, performance, security, and AI integration.

The goal was not only to build screens, but to build a usable cloud product with flows that feel complete:

- A user can sign in.
- A new user can finish profile setup.
- A user can activate cloud apps.
- A user can upload and manage photos.
- A user can write and organize notes.
- A user can store and edit contacts.
- A user can manage account security.
- A user can see storage usage.
- A user can search photos using AI-generated visual labels.

## Main Features

### Public Website

- Landing page for iClora.
- About, features, FAQ, support, policy, and developer pages.
- Responsive navigation.
- Smooth scrolling and viewport fixes.
- Mobile and iOS interaction improvements.
- Protected image interaction behavior.
- Production-ready visual assets and app icons.

### Authentication

- Google sign-in through Firebase Authentication.
- Backend session exchange using JWT.
- HTTP-only cookie support for browser sessions.
- Local auth cache for faster dashboard entry.
- First-time profile photo completion flow.
- Passkey sign-in support using WebAuthn.
- Session expiry handling.
- Logout flow with server-side session activity updates.

### Cloud Dashboard

- Main authenticated dashboard.
- App cards for Photos, Notes, and Contacts.
- Dashboard previews from cached app data.
- Storage usage summary.
- Per-app storage breakdown.
- Dashboard accent color customization.
- Fresh-login loading state.
- Responsive dashboard layout.
- Performance-lite mode for lower-capability devices, while keeping iOS on full GPU mode.

### Photos App

- Photo upload support for JPEG, PNG, WebP, GIF, HEIC, and HEIF.
- Cloudinary-backed upload flow.
- Local optimistic photo previews.
- IndexedDB upload queue for better reliability.
- Library, favourites, recents, hidden, recently deleted, and shared links sections.
- Secure photo sharing links.
- Public shared photo view.
- Hidden photo authentication flow.
- Recently deleted restore and permanent delete.
- ZIP/download support through JSZip.
- AI search mode using stored vision labels and captions.
- Background sync states for uploaded photos.

### AI Photo Search

iClora uses a separate vision backend powered by Florence-2.

Flow:

1. A user uploads a photo.
2. The backend stores the image through Cloudinary.
3. A background vision cycle finds photos that still need processing.
4. The vision worker sends the image to the Florence-2 backend.
5. Florence returns a short caption.
6. The backend stores `visionLabel`, `visionCaption`, `visionTags`, and `searchText`.
7. The frontend photo search can match user queries against this AI metadata.

This allows searches such as people, objects, places, or visual descriptions without the user manually tagging photos.

### Notes App

- Notes dashboard and full notes workspace.
- Folder support.
- Create, edit, move, pin, lock, and delete notes.
- Rich text controls such as bold, italic, underline, and formatting actions.
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
- Device/session activity.
- Logout from individual devices.
- Privacy and sensitive account actions.
- Account deletion flow with re-authentication checks.
- Storage and profile data refresh.

### Security Work

The project includes several security-focused decisions:

- JWT-backed backend sessions.
- HTTP-only cookie support.
- CORS origin allowlist.
- CSRF-style origin checks for unsafe methods.
- Helmet middleware for secure HTTP headers.
- Rate limits for authentication and sensitive actions.
- Optional Redis-backed rate limiting.
- Firebase Admin verification.
- Passkey/WebAuthn authentication.
- Session activity tracking.
- Re-authentication before sensitive actions.
- Cloudinary authenticated/private media flows for protected images.

## Tech Stack

### Frontend

- React 19
- React Router
- Firebase client SDK
- SimpleWebAuthn browser SDK
- React Icons
- JSZip
- CSS modules by feature area
- LocalStorage and IndexedDB caching
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
```

## Important Product Flows

### New User Flow

1. User opens iClora.
2. User signs in with Google.
3. Firebase ID token is exchanged for a backend session.
4. Backend creates a secure session token.
5. New user completes profile photo setup.
6. User lands on the cloud dashboard.
7. User can activate Photos, Notes, or Contacts.

### Photo Upload Flow

1. User selects supported image files.
2. Frontend creates local previews immediately.
3. Upload request asks backend for a signed Cloudinary upload.
4. File uploads to Cloudinary.
5. Backend stores photo metadata.
6. Background vision cycle generates AI metadata.
7. Photo becomes searchable through normal and AI search.

### Storage Flow

1. Backend reads active app metadata.
2. Photos, deleted photos, notes, contacts, and profile photo storage are counted.
3. Supabase-backed notes/contacts are counted when Supabase is configured.
4. Backend returns total usage and per-app breakdown.
5. Dashboard renders storage bars and app-level details.

## Live Product

Production website: [www.iclora.app](https://www.iclora.app)

iClora is maintained as a private product-style repository. The codebase is not distributed as a public starter template, so installation steps, private service keys, and deployment credentials are intentionally excluded from this README.

## Private Infrastructure

The project uses private configuration for:

- Firebase authentication and Firestore data.
- Backend JWT session signing.
- Cloudinary media storage.
- Optional Supabase-backed app data modules.
- Redis-backed rate limiting in supported environments.
- Florence-2 vision backend deployment.
- Production domain and hosting configuration.

These services are connected through environment-specific configuration and are not documented with public credentials.

## Performance Work

iClora includes frontend performance work across mobile and desktop:

- GPU-composited animations using transform and opacity.
- Device capability hints.
- iOS-specific full GPU mode.
- Reduced-motion handling.
- Smooth scroll helpers.
- Viewport height stabilization for mobile browsers.
- Local caching for dashboard, notes, contacts, and photos.
- IndexedDB queue for photo uploads.
- Optimistic UI updates for faster perceived performance.
- Smaller upload batches on mobile.
- WebP conversion for profile images where useful.

## Design Details

The UI was built to feel like a real cloud product:

- Large visual hero for the public website.
- App-like dashboard cards.
- Custom cloud navbar.
- Polished login experience.
- Modal and popup animation tuning.
- Responsive app layouts for mobile and desktop.
- Dark-mode-aware assets in several areas.
- iOS and touch-device interaction fixes.
- Clean storage visualization.
- Strong visual identity around iClora branding.

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
- Responsive frontend engineering.
- Performance tuning for mobile browsers.
- Product-level polish and UX completion.

## Key Engineering Decisions

### Separate Vision Backend

The Florence model is kept in a separate server so the main backend can stay focused on auth, app data, storage, and media workflows. This also makes the AI service easier to deploy, pause, replace, or scale independently.

### Cached Dashboard Previews

Notes, contacts, and photos write lightweight cache payloads for the dashboard. This keeps the dashboard feeling fast, even before fresh network data arrives.

### Cloudinary Direct Upload Flow

The photo app uses signed upload data from the backend and uploads media to Cloudinary. This avoids sending large files through the main backend process and keeps upload handling cleaner.

### Optional Supabase Modules

Notes and contacts can use Supabase when Supabase credentials are available. Otherwise, Firebase-backed modules are used. This gives the backend flexibility without changing the frontend routes.

### Storage Quota as a Backend Rule

Storage limits are checked on the backend, not only in the UI. This keeps account limits consistent across photos, profile images, notes, contacts, and deleted photos.

## Private Repository Note

This repository is used as a private portfolio and product engineering project. It is not prepared for public cloning, public deployment, or outside contribution.

For internship and technical review purposes, the repository shows:

- Product-level frontend implementation.
- Backend route and service architecture.
- Authentication and account security work.
- Real media upload and storage workflows.
- AI-assisted photo search integration.
- Mobile-focused performance work.
- Complete feature ownership across multiple app surfaces.

## Future Improvements

Planned or possible future improvements:

- Add more automated tests for backend routes.
- Add end-to-end tests for auth and cloud app flows.
- Add image/video deduplication.
- Add advanced album support.
- Add richer OCR-based photo search.
- Add offline-first improvements for notes.
- Add contact import/export using vCard.
- Add deeper admin tools for account and storage management.
- Add mobile app packaging after the web version.

## Author

Built by Sanket Padhyal.

This project was created as a serious full-stack portfolio project for internship applications, product engineering practice, and real-world web development experience.
