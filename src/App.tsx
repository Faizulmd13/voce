import React, { useState, useEffect } from 'react';
import { NavPage, TranslationRecord, UserSettings, AppMetrics, UserProfile } from './types';
import { Sidebar } from './components/Sidebar';
import { HomePage } from './pages/HomePage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { Bookmarks } from './components/Bookmarks';
import { DictationOverlay } from './components/overlays/DictationOverlay';
import { TranslationOverlay } from './components/overlays/TranslationOverlay';
import { BookmarkOverlay } from './components/overlays/BookmarkOverlay';
import { WelcomeScreen } from './components/WelcomeScreen';
import { 
  loadPreferencesFromDb, 
  savePreferencesToDb, 
  loadHistoryFromDb, 
  insertHistoryToDb, 
  clearHistoryInDb,
  loadBookmarksFromDb,
  syncBookmarksToDb,
  syncHistoryToDb
} from './services/db';
import { 
  updateBackendHotkeys,
  showOverlay,
  getStoredApiKey,
  saveGroqApiKey,
  getGoogleUserProfile,
  syncFromCloud,
  normalizeUserProfile
} from './services/tauri';
import { 
  reportAppInstall, 
  reportSttDictation, 
  reportTranslation 
} from './utils/firebase';
import { listen } from '@tauri-apps/api/event';

const INITIAL_SETTINGS: UserSettings = {
  sttHotkey: 'Alt+Space',
  translateHotkey: 'Alt+T',
  bookmarkHotkey: 'Alt+B',
  autoPasteToCursor: true,
  anonymouslySyncMetrics: false,
  targetLanguage: 'English',
  whisperModel: 'whisper-large-v3-turbo',
  translationModel: 'llama-3.1-8b-instant',
  audioDevice: 'Default System Microphone',
  userProfile: {
    email: 'Not signed in',
    name: 'Anonymous User',
    isAuthenticated: false,
    googleDriveConfigured: false,
  },
};

const INITIAL_HISTORY: TranslationRecord[] = [];

export const App: React.FC = () => {
  const pathname = window.location.pathname;

  // Native Window Route 1: Dictation Overlay (/dictation)
  if (pathname === '/dictation') {
    return <DictationOverlay isStandalone={true} autoPaste={true} />;
  }

  // Native Window Route 2: Translation Overlay (/translation)
  if (pathname === '/translation') {
    return <TranslationOverlay isStandalone={true} targetLanguage="English" />;
  }

  // Native Window Route 3: Bookmark Overlay (/bookmark)
  if (pathname === '/bookmark') {
    return <BookmarkOverlay isStandalone={true} />;
  }

  // Main Dashboard Window Route (/)
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [activePage, setActivePage] = useState<NavPage>('home');
  const [settings, setSettings] = useState<UserSettings>(INITIAL_SETTINGS);
  const [history, setHistory] = useState<TranslationRecord[]>(INITIAL_HISTORY);
  const [metrics, setMetrics] = useState<AppMetrics>({
    totalWordsDictated: 0,
    totalCharsTranslated: 0,
    totalDictationsCount: 0,
    totalTranslationsCount: 0,
    daemonStatus: 'active',
    lastActiveTimestamp: new Date().toISOString(),
  });

  useEffect(() => {
    // 1. Trigger anonymous Firebase install metric (only reported once per device)
    reportAppInstall();

    async function initDbAndShortcuts() {
      // Check for saved Groq API Key
      try {
        const storedKey = await getStoredApiKey();
        setHasApiKey(Boolean(storedKey && storedKey.trim().length > 0));
      } catch {
        setHasApiKey(false);
      }

      const dbSettings = await loadPreferencesFromDb(INITIAL_SETTINGS);

      // Check stored Google OAuth profile
      try {
        const rawProfile = await getGoogleUserProfile();
        const googleProfile = normalizeUserProfile(rawProfile);
        if (googleProfile && googleProfile.isAuthenticated) {
          dbSettings.userProfile = googleProfile;
          // Automatically trigger cloud sync in background on app start
          handleProfileSync(googleProfile);
        }
      } catch (err) {
        console.warn('Failed to load Google profile from store:', err);
      }

      setSettings(dbSettings);

      const dbHistory = await loadHistoryFromDb([]);
      setHistory(dbHistory);

      await updateBackendHotkeys(
        dbSettings.sttHotkey, 
        dbSettings.translateHotkey, 
        dbSettings.bookmarkHotkey || 'Alt+B'
      );

      const totalChars = dbHistory.reduce((acc, curr) => acc + (curr.charCount || curr.sourceText.length), 0);
      setMetrics((prev) => ({
        ...prev,
        totalCharsTranslated: totalChars,
        totalTranslationsCount: dbHistory.length,
      }));
    }

    // Define handleProfileSync before calling initDbAndShortcuts
    const handleProfileSync = async (rawProfile: any) => {
      const profile = normalizeUserProfile(rawProfile);
      setSettings((prev) => {
        const updated = { ...prev, userProfile: profile };
        savePreferencesToDb(updated);
        return updated;
      });

      if (profile.isAuthenticated) {
        // Trigger bidirectional deduplicated sync automatically
        try {
          const localBookmarks = await loadBookmarksFromDb();
          const localHistory = await loadHistoryFromDb([]);
          const res = await syncFromCloud(localBookmarks, localHistory);
          if (res.bookmarks && res.bookmarks.length > 0) {
            await syncBookmarksToDb(res.bookmarks);
          }
          if (res.translations && res.translations.length > 0) {
            await syncHistoryToDb(res.translations as any);
            const reloadedHistory = await loadHistoryFromDb([]);
            setHistory(reloadedHistory);
            const totalChars = reloadedHistory.reduce((acc, curr) => acc + (curr.charCount || curr.sourceText.length), 0);
            setMetrics((prev) => ({
              ...prev,
              totalCharsTranslated: totalChars,
              totalTranslationsCount: reloadedHistory.length,
            }));
          }
        } catch (cloudErr) {
          console.warn('Bidirectional cloud sync warning:', cloudErr);
        }
      }
    };

    initDbAndShortcuts();

    // Listen for transcription completed events to dynamically update metrics and anonymous Firebase telemetry
    const unlistenSttPromise = listen<{ text: string }>('transcription-completed', (event) => {
      if (event.payload?.text) {
        const words = event.payload.text.split(/\s+/).filter(Boolean).length;
        setMetrics((prev) => ({
          ...prev,
          totalWordsDictated: prev.totalWordsDictated + words,
          totalDictationsCount: prev.totalDictationsCount + 1,
        }));
        // Anonymous Firebase telemetry
        reportSttDictation(words);
      }
    });

    // Listen for translation completed events to dynamically update history, metrics, and anonymous telemetry
    const unlistenTrnPromise = listen<{
      source_text: string;
      translated_text: string;
      source_lang: string;
      target_lang: string;
    }>('translation-completed', async (event) => {
      if (event.payload?.translated_text) {
        const record: TranslationRecord = {
          id: `trn-${Date.now()}`,
          timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
          sourceText: event.payload.source_text,
          sourceLang: event.payload.source_lang || 'Auto-detected',
          translatedText: event.payload.translated_text,
          targetLang: event.payload.target_lang || 'English',
          charCount: event.payload.source_text.length,
        };
        setHistory((prev) => [record, ...prev]);
        await insertHistoryToDb(record);
        setMetrics((prev) => ({
          ...prev,
          totalCharsTranslated: prev.totalCharsTranslated + record.charCount,
          totalTranslationsCount: prev.totalTranslationsCount + 1,
        }));
        // Anonymous Firebase telemetry
        reportTranslation(record.charCount);
      }
    });

    // Listen for OAuth profile state updates
    const unlistenOAuthLoginPromise = listen<any>('oauth-login-success', (event) => {
      if (event.payload) {
        handleProfileSync(event.payload);
      }
    });

    const unlistenProfileUpdatedPromise = listen<any>('profile-updated', (event) => {
      if (event.payload) {
        handleProfileSync(event.payload);
      }
    });

    const unlistenOAuthLogoutPromise = listen<UserProfile>('oauth-logout-success', (event) => {
      if (event.payload) {
        setSettings((prev) => {
          const updated = { ...prev, userProfile: event.payload };
          savePreferencesToDb(updated);
          return updated;
        });
      }
    });

    // Listen for cloud sync completed event from anywhere in the app
    const unlistenCloudSyncPromise = listen<{ bookmarks_count: number; translations_count: number }>(
      'cloud-sync-completed',
      async () => {
        const reloadedHistory = await loadHistoryFromDb([]);
        setHistory(reloadedHistory);
        const totalChars = reloadedHistory.reduce((acc, curr) => acc + (curr.charCount || curr.sourceText.length), 0);
        setMetrics((prev) => ({
          ...prev,
          totalCharsTranslated: totalChars,
          totalTranslationsCount: reloadedHistory.length,
        }));
      }
    );

    return () => {
      unlistenSttPromise.then((unlisten) => unlisten());
      unlistenTrnPromise.then((unlisten) => unlisten());
      unlistenOAuthLoginPromise.then((unlisten) => unlisten());
      unlistenProfileUpdatedPromise.then((unlisten) => unlisten());
      unlistenOAuthLogoutPromise.then((unlisten) => unlisten());
      unlistenCloudSyncPromise.then((unlisten) => unlisten());
    };
  }, []);

  const handleUpdateSettings = async (newSettings: Partial<UserSettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    await savePreferencesToDb(updated);

    if (newSettings.sttHotkey || newSettings.translateHotkey || newSettings.bookmarkHotkey) {
      await updateBackendHotkeys(
        updated.sttHotkey, 
        updated.translateHotkey, 
        updated.bookmarkHotkey || 'Alt+B'
      );
    }
  };

  const handleResetApiKey = async () => {
    await saveGroqApiKey('');
    setHasApiKey(false);
  };

  const handleClearHistory = async () => {
    setHistory([]);
    await clearHistoryInDb();
    setMetrics((prev) => ({
      ...prev,
      totalCharsTranslated: 0,
      totalTranslationsCount: 0,
    }));
  };

  const handleTriggerNativeOverlay = async (mode: 'stt' | 'translate' | 'bookmark') => {
    if (mode === 'stt') {
      await showOverlay('stt-overlay', 20);
    } else if (mode === 'translate') {
      await showOverlay('translate-overlay', 20);
    } else if (mode === 'bookmark') {
      await showOverlay('bookmark-overlay', 20);
    }
  };

  if (hasApiKey === null) {
    return (
      <div className="flex h-screen w-screen bg-neutral-950 items-center justify-center">
        <div className="w-6 h-6 border-2 border-emerald-500/20 border-t-emerald-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (!hasApiKey) {
    return <WelcomeScreen onComplete={() => setHasApiKey(true)} />;
  }

  return (
    <div className="flex h-screen w-screen bg-neutral-950 text-neutral-100 overflow-hidden font-sans">
      {/* Global Left Sidebar */}
      <Sidebar activePage={activePage} onNavigate={(p) => setActivePage(p)} />

      {/* Main Content Area */}
      <main className="flex-1 h-full overflow-y-auto p-8 bg-neutral-950">
        {activePage === 'home' && (
          <HomePage
            metrics={metrics}
            settings={settings}
            onTriggerOverlay={(mode) => {
              if (mode === 'stt' || mode === 'translate' || mode === 'bookmark') {
                handleTriggerNativeOverlay(mode);
              }
            }}
          />
        )}
        {activePage === 'bookmarks' && (
          <Bookmarks
            userProfile={settings.userProfile}
            onOpenOverlay={() => handleTriggerNativeOverlay('bookmark')}
          />
        )}
        {activePage === 'history' && (
          <HistoryPage
            history={history}
            onClearHistory={handleClearHistory}
          />
        )}
        {activePage === 'settings' && (
          <SettingsPage
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onResetApiKey={handleResetApiKey}
          />
        )}
      </main>
    </div>
  );
};

export default App;
