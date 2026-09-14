# Voce Design Specification (Version 1 UI)
## 1. Visual & Aesthetic Architecture
- **Theme:** Ultra-minimalist, clean, light-weight.
- **Color Palette:** 
  - Background: Neutral Deep Black (`#0a0a0a` / `bg-neutral-950`)
  - Panels/Cards/Sidebar: Dark Muted Gray (`#171717` / `bg-neutral-900`)
  - Borders: Muted Subtle Edge (`border-neutral-800/60`)
  - Text Primary: High-contrast Crisp White (`#f5f5f5` / `text-neutral-100`)
  - Text Secondary: Muted Slate (`#737373` / `text-neutral-500`)
  - Accent/Indicators: Minimal Clean Green or Electric Blue for active states.
- **Typography:** Clean sans-serif or crisp monospaced fonts for a precise engineering feel.
- **Layout:** Rigidly consistent structural layout across all pages. Zero unnecessary visual noise.
## 2. Main Dashboard Window Layout (Consistent 3-Page Architecture)
The window uses a fixed left sidebar layout. The main content area on the right uses an identical layout primitive on every page: a clean top header layout (`text-xs font-mono uppercase tracking-widest text-neutral-500` above a `text-2xl font-semibold text-neutral-100` page title), followed by structured row/card components (`bg-neutral-900 border border-neutral-800/60 rounded-xl p-5`).
### A. Global Left Sidebar
- **Top Section:** Application Branding ("Voce").
- **Navigation Group (Center):** Vertical list containing links to "Home" and "History".
- **Footer Section:** Contains only the "Settings" link at the absolute bottom. No status toggles or active audio indicators are permitted in the sidebar footer.
### B. Home Page
- **Header:** Clean page title matching the application baseline.
- **Metric Analytics Display:** Unified layout rows showing high-contrast, beautiful typography for "Total Words Dictated" and "Total Characters Translated".
- **Status Indicator Area:** A clean, explicit in-body container showcasing the active system listening/daemon state. 
### C. History Page
- **Log Feed:** A chronologically ordered list focusing entirely on past text translation events. 
- **Card Layout:** Each log item explicitly displays a mock timestamp, a "Selected Text (Unidentified Language)" source container, and a "Translated English Text" refined output container with a quick "Copy to Clipboard" action. Voice-to-text dictation logs are excluded from this feed.
### D. Settings Page
- **App Preferences:** Clean, inline layout rows replacing the old isolated profile cards. Contains mockup input toggles.
- **Usage Statistics Section:** A clean feature toggle with descriptive text stating: *"Anonymously sync total usage metrics (word counts and translation volumes) to update the public product landing page milestone statistics."*
## 3. Ephemeral Overlay Windows
Sleek, transparent, borderless HUD layers that appear on system hotkey activation.
- **Dictation Overlay (Audio-to-Text):** Centered or bottom-anchored horizontal compact bar showing dynamic, minimalist wave pulse animations or structural text states: `[ Listening... ]` -> `[ Transcribing... ]`.
- **Selection Translation Overlay:** Floating minimalist card container utilizing backdrop-blur mechanics (`backdrop-blur-md bg-neutral-900/80`). Disappears seamlessly when clicking away or pressing Escape.