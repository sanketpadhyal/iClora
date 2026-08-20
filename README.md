<p align="center">
  <img src="Screenshot%202026-05-20%20at%2011.33.22%20AM.webp" alt="iClora logo" width="96" />
</p>

<h1 align="center">iClora Frontend</h1>

<p align="center">
  A personal cloud ecosystem for photos, notes, contacts, account security, storage tracking, Android photo backup, and AI-powered photo search.
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

**iClora** is a complete personal cloud product built across web, backend, AI vision processing, and Android. It provides a clean, secure cloud dashboard where users manage photos, notes, contacts, account security, storage usage, device sessions, passkeys, and AI-assisted photo search.

This repository contains the open-source React frontend for the iClora web client.

> [!IMPORTANT]
> **Open Source Notice**
> This repository is sanitized for public open-source distribution. Real production credentials, secret tokens, private API keys, and deployment credentials are excluded. Refer to `.env.example` to configure your environment.

---

## What's New in this Version

- **Firebase Firestore Native Storage**: Replaced external database dependencies with native Firebase Firestore storage for Notes, Contacts, and user metadata.
- **Dynamic Backend API Resolution**: Automatic environment resolution connects to `http://localhost:8080` when developing locally and to your production server when deployed.
- **Enhanced Auth & Session Resilience**: Full Bearer Token header authentication, automatic session recovery, and client-side auth caching.
- **Netlify SPA Routing**: Built-in `_redirects` rules for client-side React Router navigation on static hosts.

---

## Product Surface Links

| Product Surface | Link |
| --- | --- |
| Live Website | [www.iclora.app](https://www.iclora.app) |
| Frontend Repository | [sanketpadhyal/iClora.git](https://github.com/sanketpadhyal/iClora.git) |
| Backend Repository | [sanketpadhyal/iClora-Backend.git](https://github.com/sanketpadhyal/iClora-Backend.git) |
| Florence Backend Repository | [sanketpadhyal/Florence-BACKEND.git](https://github.com/sanketpadhyal/Florence-BACKEND.git) |
| Android App Repository | [sanketpadhyal/iClora-Photos-App.git](https://github.com/sanketpadhyal/iClora-Photos-App.git) |

---

## Ecosystem Architecture

| Component | Technology | Role |
| --- | --- | --- |
| **iClora Frontend** | React 19, React Router, Firebase Client SDK | Public website, authentication flow, personal cloud dashboard, Notes, Contacts, and Photos web apps |
| **iClora Backend** | Node.js, Express, Firebase Admin, Firestore, Cloudinary | Auth validation, JWT sessions, security flows, data persistence, Cloudinary upload signatures, quota calculations |
| **Florence AI** | Node.js, Express, Transformers.js, Florence-2 | AI photo captioning, tagging, and visual search metadata generation |
| **Android App** | React Native, Expo, Firebase Auth | Mobile companion app for phone photo sync and cloud gallery browsing |

---

## Core Features

### 🌐 Public Website & Marketing Pages
- Landing page with features breakdown, developer notes, application info, FAQ, support, and legal policies.
- Mobile-responsive navigation, smooth scroll, and dark mode support.
- PWA manifest and mobile app download shortcuts.

### 🔐 Authentication & Session Management
- Google Authentication via Firebase SDK.
- Session token exchange with the backend.
- Local session caching (`localStorage` / `sessionStorage`) for instant dashboard entry.
- Auto-redirect on session expiry.

### 📊 Personal Cloud Dashboard
- Integrated user profile and quota tracking.
- Storage usage breakdown for Photos, Notes, and Contacts.
- Customizable theme accent colors.
- Quick preview widgets for recent notes, contacts, and photos.

### 📸 Photos App
- High-performance photo gallery with smooth loading.
- Cloudinary photo upload & background upload queue.
- Library, Favorites, Recents, Hidden (passkey-protected), Recently Deleted (trash bin), and Shared Links.
- AI Search across photo labels, tags, captions, and visual content descriptions generated by Florence AI.
- Multi-photo ZIP download.

### 📝 Notes App
- Create, edit, pin, lock, move, and organize notes with folder support.
- Rich text editing, file imports, and ZIP exports.
- Native Firebase Firestore persistence.

### 📇 Contacts App
- Manage personal & professional contacts with full field support (name, company, phone numbers, email, birthday, address, notes).
- Contact profile photo cropping and Cloudinary upload.
- Native Firebase Firestore persistence.

### 🛡️ Account Security & Device Management
- Edit user profile details (Name, DOB, Country).
- Passkey (WebAuthn) registration and authentication.
- Active login sessions tracking & remote session logout.
- Account deletion workflow with user feedback collection.

---

## Tech Stack

- **Framework**: React 19, React Router 6
- **Auth**: Firebase Client SDK
- **WebAuthn**: `@simplewebauthn/browser`
- **Utilities**: JSZip, React Icons
- **Build Tool**: React Scripts (Create React App)

---

## Project Structure

```text
iClora/
├── public/                # Static assets, manifests, index.html, Netlify _redirects
├── src/
│   ├── alert/            # Global toast and notification system
│   ├── api/              # API fetch helper and backend URL auto-detector
│   ├── auth/             # Authentication, Firebase init, AuthGate, ProfilePhoto setup
│   ├── cloud/            # Dashboard, Navbar, Passkey management, Recovery, User Profile
│   ├── components/       # Shared UI components, SmoothScroll, Image protection
│   ├── contacts/         # Contacts cloud application
│   ├── notes/            # Notes cloud application
│   ├── pages/            # Marketing and static content pages
│   ├── photos/           # Photos cloud application, public share, upload queue
│   ├── App.js            # Main route tree
│   └── index.js          # React entry point
├── .env.example          # Public environment variables template
├── LICENSE               # MIT License
└── README.md             # Project documentation
```

---

## Getting Started

### 1. Prerequisites
- **Node.js**: `v18.0.0` or higher
- **npm**: `v9.0.0` or higher
- **Backend Service**: Running instance of [iClora Backend](https://github.com/sanketpadhyal/iClora-Backend.git)

### 2. Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/sanketpadhyal/iClora.git
cd iClora
npm install
```

### 3. Environment Setup

Create a `.env` file from `.env.example`:

```bash
cp .env.example .env
```

Populate the `.env` file with your Firebase Client credentials:

```env
REACT_APP_BACKEND_API_URL=http://localhost:8080
REACT_APP_FIREBASE_API_KEY=your-firebase-api-key
REACT_APP_FIREBASE_AUTH_DOMAIN=your-firebase-app.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=your-firebase-project-id
REACT_APP_FIREBASE_STORAGE_BUCKET=your-firebase-app.firebasestorage.app
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
REACT_APP_FIREBASE_APP_ID=your-app-id
REACT_APP_FACEBOOK_AUTH_URL=
REACT_APP_APPLE_AUTH_URL=
REACT_APP_ICLORA_APP_DOWNLOAD_URL=
```

### 4. Running Development Server

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 5. Building for Production

```bash
npm run build
```

The static output will be generated in the `build/` directory, ready for deployment on Netlify, Vercel, Firebase Hosting, or Cloudflare Pages.

---

## Deployment (Netlify)

This repository includes a `public/_redirects` configuration for SPA client-side routing on Netlify:

```text
/*    /index.html   200
```

Simply connect this GitHub repository to Netlify, set the build command to `npm run build` and publish directory to `build/`.

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Developer

Developed by **Sanket Padhyal**  
Website: [www.sanketpadhyal.in](https://www.sanketpadhyal.in)  
GitHub: [@sanketpadhyal](https://github.com/sanketpadhyal)
