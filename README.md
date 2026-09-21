<div align="center">

# Voce

**Secure, offline-first dictation and translation with native Google Drive cloud sync.**

[![Build Status](https://github.com/Faizulmd13/voce/actions/workflows/release.yml/badge.svg)](https://github.com/Faizulmd13/voce/actions/workflows/release.yml)
[![Windows](https://img.shields.io/badge/Windows-v1.0.1-0078D6?style=flat-square&logo=windows&logoColor=white)](https://github.com/Faizulmd13/voce/releases/latest)
[![macOS](https://img.shields.io/badge/macOS-v1.0.1-000000?style=flat-square&logo=apple&logoColor=white)](https://github.com/Faizulmd13/voce/releases/latest)
[![Linux](https://img.shields.io/badge/Linux-v1.0.1-FCC624?style=flat-square&logo=linux&logoColor=black)](https://github.com/Faizulmd13/voce/releases/latest)
<br>
[![Tauri](https://img.shields.io/badge/Tauri-v2-24C8DB?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Rust](https://img.shields.io/badge/Rust-Backend-000000?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![License](https://img.shields.io/badge/License-MIT-22C55E?style=flat-square)](LICENSE)

</div>
---

## ⚡ Highlights & Key Features

*   **Offline-First Architecture** — Local translation history, bookmarks, and text data are securely managed via a local SQLite database, allowing full offline usability.
*   **Google Drive Sync** — Seamless cross-device synchronization using an officially verified Google Cloud OAuth production integration (only requests access to app-specific files).
*   **Native Performance** — Built on the lightweight **Tauri** framework, utilizing native OS webviews to minimize RAM usage and executable size.
*   **Instant Copy & Dictation** — Streamlined UI with auto-copy toast notifications and one-click dictation tools.

---

## 📱 Platform Availability

| Platform | Distribution | Requirements |
|----------|--------------|--------------|
| **Windows** | [voce_1.0.1.exe](https://github.com/Faizulmd13/voce/releases/latest) | Windows 10+ |
| **Linux** | [voce_1.0.1.deb](https://github.com/Faizulmd13/voce/releases/latest) | Debian / Ubuntu |
| **macOS** | [voce_1.0.1.app](https://github.com/Faizulmd13/voce/releases/latest) | macOS 10.15+ |

*Note: If Windows SmartScreen blocks the installation of the `.exe`, click **More info** -> **Run anyway**. This is standard for indie-developed binaries pending an enterprise code signing certificate.*

---

## 📚 User Guide

### 1. Installation & Login
Download the latest installer from the [Releases](https://github.com/Faizulmd13/voce/releases) page. Run the installer and sign in with your Google Account to enable cloud backups.

### 2. Dictation & Translation
Speak directly into your microphone or type text to translate. Once transcription is complete, the text is automatically injected to your cursor and copied to your system clipboard for instant use.

### 3. Bookmarks & Offline History
All translations are saved locally via SQLite. You can browse your history or bookmark specific phrases even when disconnected from the internet.

---

## ⚙️ System Architecture

Voce is structured around an offline-first desktop paradigm. A lightweight React UI runs inside Tauri's native webview, interfacing directly with a Rust core process for system APIs, local SQLite storage, and cloud synchronization.

```mermaid
flowchart TD
    subgraph Client ["Client Layer (React Frontend)"]
        UI["React Dashboard UI"]
        HUD["Dictation HUD Overlay"]
        Trans["Translation Interface"]
    end

    subgraph Core ["Native Runtime (Tauri / Rust Engine)"]
        IPC["Tauri IPC Command Bridge"]
        Audio["Native Audio Recorder (16kHz WAV)"]
        Inject["OS Cursor Text Injector"]
        Tray["System Tray & Global Hotkeys"]
    end

    subgraph Storage ["Local Persistence & OS Layer"]
        SQLite[("Local SQLite DB (History & Bookmarks)")]
        Clipboard["OS Clipboard"]
    end

    subgraph Cloud ["Cloud Infrastructure & APIs"]
        STT["Cloud Speech-to-Text API"]
        OAuth["Google OAuth 2.0 Identity Server"]
        GDrive[("Google Drive App Folder (drive.file)")]
        Analytics["Firebase Telemetry Engine"]
    end

    UI & HUD <-->|Bidirectional IPC| IPC
    HUD -->|Capture Stream| Audio
    Audio -->|16kHz WAV Path| IPC
    IPC <-->|Query / Write| SQLite
    IPC -->|Transcribe Request| STT
    STT -->|Transcribed Text| IPC
    IPC -->|Auto-Paste| Inject
    Inject -->|Synthesize Keystrokes| Clipboard
    HUD -->|Copy Event| Clipboard
    UI -->|Authenticate| OAuth
    IPC <-->|Sync State| GDrive
    HUD -->|Report Usage| Analytics
```

---

## 🛠️ Local Development Setup

Follow these steps to spin up the local development loop:

### 1. Clone the repository
```bash
git clone [https://github.com/Faizulmd13/voce.git](https://github.com/Faizulmd13/voce.git)
cd voce
```

### 2. Install dependencies
Ensure you have Node.js and the Rust toolchain installed on your machine.
```bash
npm install
```

### 3. Start development server
Runs the React frontend and compiles the Tauri Rust backend concurrently with hot-reloading:
```bash
npm run tauri dev
```

### 4. Build for Production
To manually generate the final executable installer:
```bash
npm run tauri build
```
*Note: Automated multi-platform builds are managed via GitHub Actions upon tagging a new release.*