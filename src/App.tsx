import React, { useState, useEffect } from 'react';
import { NavPage, TranslationRecord, UserSettings, AppMetrics } from './types';
import { Sidebar } from './components/Sidebar';
import { HomePage } from './pages/HomePage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { DictationOverlay } from './components/overlays/DictationOverlay';
import { TranslationOverlay } from './components/overlays/TranslationOverlay';
import { WelcomeScreen } from './components/WelcomeScreen';
import { 
  loadPreferencesFromDb, 
  savePreferencesToDb, 
  loadHistoryFromDb, 
  insertHistoryToDb, 
  clearHistoryInDb 
} from './services/db';
import { 
  triggerGoogleOAuth, 
  updateBackendHotkeys,
  showOverlay,
  getStoredApiKey
} from './services/tauri';
import { listen } from '@tauri-apps/api/event';

const INITIAL_SETTINGS: UserSettings = {
  sttHotkey: 'Alt+Space',
  translateHotkey: 'Alt+T',
  autoPasteToCursor: true,
  anonymouslySyncMetrics: false,
  targetLanguage: 'English',
  whisperModel: 'whisper-large-v3-turbo',
  translationModel: 'llama-3.1-8b-instant',
  audioDevice: 'Default System Microphone',
  userProfile: {
    email: 'local.user@voce.internal',
    name: 'Faizul',
    isAuthenticated: false,
  },
};

const INITIAL_HISTORY: TranslationRecord[] = [
  {
    id: 'trn-1',
    timestamp: '2026-09-14 10:42:15',
    sourceText: 'Die Grenzen meiner Sprache bedeuten die Grenzen meiner Welt.',
    sourceLang: 'German',
    translatedText: 'The limits of my language mean the limits of my world.',
    targetLang: 'English',
    charCount: 62,
  },
  {
    id: 'trn-2',
    timestamp: '2026-09-14 09:18:30',
    sourceText: 'Le silence est le plus grand luxe de la vie moderne.',
    sourceLang: 'French',
    translatedText: 'Silence is the greatest luxury of modern life.',
    targetLang: 'English',
    charCount: 52,
  },
  {
    id: 'trn-3',
    timestamp: '2026-09-14 08:05:12',
    sourceText: '千里之行，始于足下。',
    sourceLang: 'Chinese (Simplified)',
    translatedText: 'A journey of a thousand miles begins with a single step.',
    targetLang: 'English',
    charCount: 10,
  },
];

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

  // Main Dashboard Window Route (/)
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [activePage, setActivePage] = useState<NavPage>('home');
  const [settings, setSettings] = useState<UserSettings>(INITIAL_SETTINGS);
  const [history, setHistory] = useState<TranslationRecord[]>(INITIAL_HISTORY);
  const [metrics, setMetrics] = useState<AppMetrics>({
    totalWordsDictated: 4820,
    totalCharsTranslated: 14280,
    totalDictationsCount: 142,
    totalTranslationsCount: INITIAL_HISTORY.length,
    daemonStatus: 'active',
    lastActiveTimestamp: new Date().toISOString(),
  });

  useEffect(() => {
    async function initDbAndShortcuts() {
      // Check for saved Groq API Key
      try {
        const storedKey = await getStoredApiKey();
        setHasApiKey(Boolean(storedKey && storedKey.trim().length > 0));
      } catch {
        setHasApiKey(false);
      }

      const dbSettings = await loadPreferencesFromDb(INITIAL_SETTINGS);
      setSettings(dbSettings);

      const dbHistory = await loadHistoryFromDb(INITIAL_HISTORY);
      setHistory(dbHistory);

      await updateBackendHotkeys(dbSettings.sttHotkey, dbSettings.translateHotkey);

      const totalChars = dbHistory.reduce((acc, curr) => acc + (curr.charCount || curr.sourceText.length), 0);
      setMetrics((prev) => ({
        ...prev,
        totalCharsTranslated: Math.max(prev.totalCharsTranslated, totalChars),
        totalTranslationsCount: dbHistory.length,
      }));
    }

    initDbAndShortcuts();

    // Listen for transcription completed events to update metrics & history
    const unlistenPromise = listen<{ text: string }>('transcription-completed', (event) => {
      if (event.payload?.text) {
        const words = event.payload.text.split(/\s+/).filter(Boolean).length;
        setMetrics((prev) => ({
          ...prev,
          totalWordsDictated: prev.totalWordsDictated + words,
          totalDictationsCount: prev.totalDictationsCount + 1,
        }));
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const handleUpdateSettings = async (newSettings: Partial<UserSettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    await savePreferencesToDb(updated);

    if (newSettings.sttHotkey || newSettings.translateHotkey) {
      await updateBackendHotkeys(updated.sttHotkey, updated.translateHotkey);
    }
  };

  const handleExportData = () => {
    const exportObject = {
      settings,
      history,
      metrics,
      exportedAt: new Date().toISOString(),
      appVersion: '1.0.0',
    };
    const blob = new Blob([JSON.stringify(exportObject, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `voce-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportData = async (jsonData: string) => {
    try {
      const parsed = JSON.parse(jsonData);
      if (parsed.settings) {
        setSettings(parsed.settings);
        await savePreferencesToDb(parsed.settings);
        await updateBackendHotkeys(parsed.settings.sttHotkey, parsed.settings.translateHotkey);
      }
      if (parsed.history && Array.isArray(parsed.history)) {
        setHistory(parsed.history);
        for (const item of parsed.history) {
          await insertHistoryToDb(item);
        }
      }
      if (parsed.metrics) {
        setMetrics(parsed.metrics);
      }
    } catch (e) {
      console.error('Failed to import JSON data:', e);
      throw e;
    }
  };

  const handleGoogleAuth = async () => {
    if (settings.userProfile.isAuthenticated) {
      const updatedProfile = {
        ...settings.userProfile,
        isAuthenticated: false,
      };
      await handleUpdateSettings({ userProfile: updatedProfile });
    } else {
      const profile = await triggerGoogleOAuth();
      await handleUpdateSettings({ userProfile: profile });
    }
  };

  const handleClearHistory = async () => {
    setHistory([]);
    await clearHistoryInDb();
    setMetrics((prev) => ({
      ...prev,
      totalTranslationsCount: 0,
    }));
  };

  const handleTriggerNativeOverlay = async (mode: 'stt' | 'translate') => {
    if (mode === 'stt') {
      await showOverlay('stt-overlay', 20);
    } else {
      await showOverlay('translate-overlay', 20);
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
              if (mode === 'stt' || mode === 'translate') {
                handleTriggerNativeOverlay(mode);
              }
            }}
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
            onExportData={handleExportData}
            onImportData={handleImportData}
            onGoogleAuth={handleGoogleAuth}
          />
        )}
      </main>
    </div>
  );
};

export default App;

