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
  updateBackendHotkeys,
  showOverlay,
  getStoredApiKey,
  saveGroqApiKey
} from './services/tauri';
import { listen } from '@tauri-apps/api/event';

const INITIAL_SETTINGS: UserSettings = {
  sttHotkey: 'Alt+Space',
  translateHotkey: 'Alt+T',
  autoPasteToCursor: true,
  anonymouslySyncMetrics: false,
  targetLanguage: 'English',
  whisperModel: 'whisper-large-v3-turbo',
  translationModel: 'llama-3.3-70b-versatile',
  audioDevice: 'Default System Microphone',
  userProfile: {
    email: 'local.user@voce.internal',
    name: 'Voce User',
    isAuthenticated: false,
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

      const dbHistory = await loadHistoryFromDb([]);
      setHistory(dbHistory);

      await updateBackendHotkeys(dbSettings.sttHotkey, dbSettings.translateHotkey);

      const totalChars = dbHistory.reduce((acc, curr) => acc + (curr.charCount || curr.sourceText.length), 0);
      setMetrics((prev) => ({
        ...prev,
        totalCharsTranslated: totalChars,
        totalTranslationsCount: dbHistory.length,
      }));
    }

    initDbAndShortcuts();

    // Listen for transcription completed events to dynamically update metrics
    const unlistenSttPromise = listen<{ text: string }>('transcription-completed', (event) => {
      if (event.payload?.text) {
        const words = event.payload.text.split(/\s+/).filter(Boolean).length;
        setMetrics((prev) => ({
          ...prev,
          totalWordsDictated: prev.totalWordsDictated + words,
          totalDictationsCount: prev.totalDictationsCount + 1,
        }));
      }
    });

    // Listen for translation completed events to dynamically update history & metrics
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
      }
    });

    return () => {
      unlistenSttPromise.then((unlisten) => unlisten());
      unlistenTrnPromise.then((unlisten) => unlisten());
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
            onResetApiKey={handleResetApiKey}
          />
        )}
      </main>
    </div>
  );
};

export default App;
