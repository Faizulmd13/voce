# Voce AI Desktop

> **Ultra-Low Latency, Hotkey-Driven AI Desktop Assistant for Windows**

Voce is an intelligent, ultra-fast AI desktop assistant engineered with **Tauri v2 (Rust)** and **React 19 (TypeScript)**. It provides frictionless, system-wide access to high-performance cloud AI inference powered by **Groq LPU**, seamless **Google Drive cloud synchronization**, instant voice-to-text dictation, and contextual selection translation with local SQLite offline persistence.

---

## Key Features

- 🎙️ **Global Voice Dictation (<kbd>Alt</kbd> + <kbd>Space</kbd>)**:
  - High-accuracy voice transcription using `whisper-large-v3-turbo` via Groq LPU.
  - Live animated waveform visualizer with glassmorphism overlay.
  - Automated cursor paste injection (`Ctrl+V` emulation).

- 🌐 **Instant Selection Translation (<kbd>Alt</kbd> + <kbd>T</kbd>)**:
  - Non-destructive synthetic clipboard capture of highlighted text across any application.
  - Multi-language translation powered by LLaMA 3.1 8B Instant and versatile LLM models via Groq.
  - One-click copy, translation history logging, and live Google Drive backups.

- 📑 **Knowledge Vault & Bookmarks (<kbd>Alt</kbd> + <kbd>B</kbd>)**:
  - Fast selection bookmarking overlay with automatic snippet capture.
  - **Google Keep-Style Masonry Grid UI**: Read, edit, search, copy, and manage snippets.
  - Bidirectional, deduplicated cloud synchronization directly to `Voce/bookmarks` on Google Drive as `.txt` files.

- ☁️ **Google Drive Cloud Sync & OAuth 2.0**:
  - Seamless local loopback OAuth 2.0 flow with strict `drive.file` scope.
  - Automatic synchronization on login and startup (`Voce/bookmarks` and `Voce/translations`).
  - Offline-first resilience with local SQLite database (`history` and `bookmarks` tables) and multi-tier caching.

- 📊 **Offline Metrics & Anonymous Telemetry**:
  - Offline metrics dashboard tracking total dictated words and translated characters.
  - Zero personal data collection with anonymous Firebase usage counters.

---

## Tech Stack

- **Desktop Runtime**: [Tauri v2](https://tauri.app/) (Rust)
- **Frontend Framework**: [React 19](https://react.dev/) + [Vite](https://vitejs.dev/)
- **Language**: TypeScript + Rust
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) + [Lucide Icons](https://lucide.dev/)
- **Audio Processing**: `cpal` + `hound` + `rubato` (48kHz stereo to 16kHz mono WAV conversion)
- **AI Inference**: [Groq Cloud API](https://groq.com/)
- **Cloud Storage**: Google Drive API v3 (Plain Text `.txt` Vault)
- **Local Storage**: SQLite (`tauri-plugin-sql`) & Local JSON Store (`tauri-plugin-store`)

---

## Global Hotkeys & Shortcuts

| Shortcut | Feature | Description |
| :--- | :--- | :--- |
| <kbd>Alt</kbd> + <kbd>Space</kbd> | **Voice Dictation** | Opens mic recording overlay, transcribes, and auto-pastes to cursor |
| <kbd>Alt</kbd> + <kbd>T</kbd> | **Quick Translate** | Captures highlighted text and translates into your target language |
| <kbd>Alt</kbd> + <kbd>B</kbd> | **Capture Bookmark** | Captures highlighted text and saves to your Google Drive vault |
| <kbd>Ctrl</kbd> + <kbd>Enter</kbd> | **Save / Action** | Confirms and saves bookmark or overlay forms |
| <kbd>Esc</kbd> | **Dismiss** | Closes and hides active overlay modal |

---

## Getting Started

### Prerequisites

1. **Node.js**: `v18+` or `v20+` ([Download Node.js](https://nodejs.org/))
2. **Rust & Cargo**: Latest stable Rust toolchain ([Install Rust](https://rustup.rs/))
3. **C++ Build Tools**: Visual Studio C++ Build Tools on Windows (required by Tauri).
4. **Groq API Key**: Obtain a free API key from the [Groq Console](https://console.groq.com/keys).

### Environment Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/Faizulmd13/voce.git
   cd voce
   ```

2. Copy the environment variables template:
   ```bash
   cp .env.example .env
   ```

3. Populate `.env` with your API credentials:
   ```env
   # Groq Cloud API
   GROQ_API_KEY=gsk_your_groq_api_key_here

   # Google OAuth 2.0 Credentials (for Google Drive Cloud Sync)
   GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   VITE_GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
   VITE_GOOGLE_CLIENT_SECRET=your_google_client_secret
   ```

---

## Development

1. Install frontend dependencies:
   ```bash
   npm install
   ```

2. Start the local development server and Tauri desktop app:
   ```bash
   npm run tauri dev
   ```

3. Build production standalone executable:
   ```bash
   npm run tauri build
   ```

---

## Architecture Overview

```
voce/
├── src/
│   ├── components/
│   │   ├── Bookmarks.tsx         # Google Keep-style masonry note grid
│   │   ├── ProfileCard.tsx       # Google OAuth profile & sync card
│   │   ├── Sidebar.tsx           # Navigation sidebar
│   │   └── overlays/
│   │       ├── BookmarkOverlay.tsx   # Floating snippet capture modal
│   │       ├── DictationOverlay.tsx  # Floating audio recording visualizer
│   │       └── TranslationOverlay.tsx# Floating selection translator
│   ├── hooks/
│   │   ├── useSync.ts            # Google Drive bidirectional synchronization hook
│   │   └── useTauriEvents.ts     # Centralized Tauri IPC event listeners
│   ├── pages/
│   │   ├── HomePage.tsx          # System metrics and status dashboard
│   │   ├── HistoryPage.tsx       # Searchable translation archive
│   │   └── SettingsPage.tsx      # Hotkey, model, and API configuration
│   ├── services/
│   │   ├── cloud.ts              # Google Drive API & OAuth consent flow
│   │   ├── db.ts                 # Local SQLite database operations
│   │   └── tauri.ts              # Tauri IPC bridge invoke wrappers
│   └── utils/
│       └── firebase.ts           # Privacy-preserving anonymous telemetry
├── src-tauri/
│   ├── src/
│   │   ├── ai.rs                 # Groq cloud STT (Whisper) & translation engine
│   │   ├── audio.rs              # High-performance CPAL audio engine
│   │   ├── auth.rs               # Google OAuth 2.0 loopback server & token refresh
│   │   ├── clipboard.rs          # Synthetic clipboard capture & auto-paste (arboard/enigo)
│   │   ├── hotkeys.rs            # Global system shortcuts registration
│   │   ├── models.rs             # Shared Rust data structures
│   │   ├── sync.rs               # Google Drive sync & auto-healing deduplication
│   │   ├── windows.rs            # Native multi-window overlay management
│   │   ├── lib.rs                # Tauri backend setup & command router
│   │   └── main.rs               # Desktop application entry point
│   ├── tauri.conf.json           # Multi-window overlay configuration
│   └── Cargo.toml                # Rust dependencies & build settings
└── .env.example                  # Environment configuration template
```

---

## License

This project is licensed under the MIT License.
