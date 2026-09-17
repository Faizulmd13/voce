import React, { useState, useEffect, useCallback } from 'react';
import { NavPage, TranslationRecord, BookmarkItem, UserSettings, AppMetrics, UserProfile } from './types';
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
  clearHistoryInDb,
  deleteHistoryFromDb
} from './services/db';
import { 
  updateBackendHotkeys,
  showOverlay,
  getStoredApiKey,
  saveGroqApiKey,
  getGoogleUserProfile,
  normalizeUserProfile,
  deleteTranslationFromDrive,
  clearAllTranslationsFromDrive
} from './services/tauri';
import { reportAppInstall } from './utils/firebase';
import { useSync } from './hooks/useSync';
import { useTauriEvents } from './hooks/useTauriEvents';

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

  const { performCloudSync } = useSync();

  const handleProfileSync = useCallback(
    async (profile: UserProfile) => {
      setSettings((prev) => {
        const updated = { ...prev, userProfile: profile };
        savePreferencesToDb(updated);
        return updated;
      });

      if (profile.isAuthenticated) {
        console.log('[App] Authenticated profile detected. Initiating bidirectional cloud sync...');
        const syncRes = await performCloudSync();
        if (syncRes.translations && syncRes.translations.length > 0) {
          setHistory(syncRes.translations);
          const totalChars = syncRes.translations.reduce(
            (acc, curr) => acc + (curr.charCount || curr.sourceText.length),
            0
          );
          setMetrics((prev) => ({
            ...prev,
            totalCharsTranslated: totalChars,
            totalTranslationsCount: syncRes.translations.length,
          }));
        }
      }
    },
    [performCloudSync]
  );

  const handleTranscription = useCallback((words: number) => {
    setMetrics((prev) => ({
      ...prev,
      totalWordsDictated: prev.totalWordsDictated + words,
      totalDictationsCount: prev.totalDictationsCount + 1,
    }));
  }, []);

  const handleTranslation = useCallback((record: TranslationRecord) => {
    setHistory((prev) => {
      const isDuplicate = prev.some(
        (h) => h.id === record.id || (h.sourceText.trim() === record.sourceText.trim() && h.translatedText.trim() === record.translatedText.trim())
      );
      if (isDuplicate) {
        return prev;
      }
      return [record, ...prev];
    });
    setMetrics((prev) => ({
      ...prev,
      totalCharsTranslated: prev.totalCharsTranslated + record.charCount,
      totalTranslationsCount: prev.totalTranslationsCount + 1,
    }));
  }, []);

  const handleLoginSuccess = useCallback(
    (profile: UserProfile) => {
      handleProfileSync(profile);
    },
    [handleProfileSync]
  );

  const handleLogoutSuccess = useCallback((anon: UserProfile) => {
    setSettings((prev) => {
      const updated = { ...prev, userProfile: anon };
      savePreferencesToDb(updated);
      return updated;
    });
    setHistory([]);
    setMetrics({
      totalWordsDictated: 0,
      totalCharsTranslated: 0,
      totalDictationsCount: 0,
      totalTranslationsCount: 0,
      daemonStatus: 'active',
      lastActiveTimestamp: new Date().toISOString(),
    });
  }, []);

  const handleSyncCompleted = useCallback(async (payload?: { bookmarks?: BookmarkItem[]; translations?: TranslationRecord[] }) => {
    let reloadedHistory = payload?.translations;
    if (!reloadedHistory || reloadedHistory.length === 0) {
      reloadedHistory = await loadHistoryFromDb([]);
    }
    setHistory(reloadedHistory);
    const totalChars = reloadedHistory.reduce(
      (acc, curr) => acc + (curr.charCount || curr.sourceText.length),
      0
    );
    setMetrics((prev) => ({
      ...prev,
      totalCharsTranslated: totalChars,
      totalTranslationsCount: reloadedHistory.length,
    }));
  }, []);

  // Centralized Tauri IPC Events Hook
  useTauriEvents({
    onTranscription: handleTranscription,
    onTranslation: handleTranslation,
    onLoginSuccess: handleLoginSuccess,
    onLogoutSuccess: handleLogoutSuccess,
    onSyncCompleted: handleSyncCompleted,
  });

  useEffect(() => {
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

      // Load cached offline history first for instant UI response
      const dbHistory = await loadHistoryFromDb([]);
      setHistory(dbHistory);

      const totalChars = dbHistory.reduce((acc, curr) => acc + (curr.charCount || curr.sourceText.length), 0);
      setMetrics((prev) => ({
        ...prev,
        totalCharsTranslated: totalChars,
        totalTranslationsCount: dbHistory.length,
      }));

      // Check stored Google OAuth profile & trigger bidirectional cloud sync if logged in
      try {
        const rawProfile = await getGoogleUserProfile();
        const googleProfile = normalizeUserProfile(rawProfile);
        if (googleProfile && googleProfile.isAuthenticated) {
          dbSettings.userProfile = googleProfile;
          await handleProfileSync(googleProfile);
        }
      } catch (err) {
        console.warn('Failed to load Google profile from store:', err);
      }

      setSettings(dbSettings);

      await updateBackendHotkeys(
        dbSettings.sttHotkey, 
        dbSettings.translateHotkey, 
        dbSettings.bookmarkHotkey || 'Alt+B'
      );
    }

    initDbAndShortcuts();
  }, [handleProfileSync]);

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

  const handleDeleteHistoryEntry = async (record: TranslationRecord) => {
    setHistory((prev) => prev.filter((h) => h.id !== record.id));
    await deleteHistoryFromDb(record.id);

    setMetrics((prev) => ({
      ...prev,
      totalCharsTranslated: Math.max(0, prev.totalCharsTranslated - record.charCount),
      totalTranslationsCount: Math.max(0, prev.totalTranslationsCount - 1),
    }));

    if (settings.userProfile.isAuthenticated) {
      try {
        await deleteTranslationFromDrive({
          fileId: record.driveFileId,
          id: record.id,
          sourceText: record.sourceText,
        });
      } catch (err) {
        console.warn('Failed to delete translation from Google Drive:', err);
      }
    }
  };

  const handleClearHistory = async () => {
    setHistory([]);
    await clearHistoryInDb();
    setMetrics((prev) => ({
      ...prev,
      totalCharsTranslated: 0,
      totalTranslationsCount: 0,
    }));

    if (settings.userProfile.isAuthenticated) {
      try {
        await clearAllTranslationsFromDrive();
      } catch (err) {
        console.warn('Failed to clear translations from Google Drive:', err);
      }
    }
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
            onDeleteEntry={handleDeleteHistoryEntry}
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
