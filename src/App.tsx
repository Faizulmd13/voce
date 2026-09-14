import React, { useState, useEffect } from 'react';
import { NavPage, OverlayMode, TranslationRecord, UserSettings, AppMetrics } from './types';
import { Sidebar } from './components/Sidebar';
import { HomePage } from './pages/HomePage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { DictationOverlay } from './components/overlays/DictationOverlay';
import { TranslationOverlay } from './components/overlays/TranslationOverlay';
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
  subscribeToOverlayTriggers 
} from './services/tauri';

const INITIAL_SETTINGS: UserSettings = {
  sttHotkey: 'Alt+Space',
  translateHotkey: 'Alt+T',
  autoPasteToCursor: true,
  anonymouslySyncMetrics: false,
  targetLanguage: 'English',
  whisperModel: 'ggml-base.en.bin',
  translationModel: 'nllb-200-distilled-600M',
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
  const [activePage, setActivePage] = useState<NavPage>('home');
  const [overlayMode, setOverlayMode] = useState<OverlayMode>('none');
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

  // Load from SQLite database on mount & subscribe to global shortcuts
  useEffect(() => {
    async function initDbAndShortcuts() {
      const dbSettings = await loadPreferencesFromDb(INITIAL_SETTINGS);
      setSettings(dbSettings);

      const dbHistory = await loadHistoryFromDb(INITIAL_HISTORY);
      setHistory(dbHistory);

      // Sync hotkeys with Tauri backend
      await updateBackendHotkeys(dbSettings.sttHotkey, dbSettings.translateHotkey);

      // Calculate initial metrics
      const totalChars = dbHistory.reduce((acc, curr) => acc + (curr.charCount || curr.sourceText.length), 0);
      setMetrics((prev) => ({
        ...prev,
        totalCharsTranslated: Math.max(prev.totalCharsTranslated, totalChars),
        totalTranslationsCount: dbHistory.length,
      }));
    }

    initDbAndShortcuts();

    // Subscribe to global hotkey triggers
    const unsubscribe = subscribeToOverlayTriggers(
      () => setOverlayMode('stt'),
      () => setOverlayMode('translate')
    );

    return () => {
      unsubscribe();
    };
  }, []);

  const handleUpdateSettings = async (newSettings: Partial<UserSettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    await savePreferencesToDb(updated);

    // If hotkeys changed, update OS listeners dynamically
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
      // Execute OAuth loopback flow
      const profile = await triggerGoogleOAuth();
      await handleUpdateSettings({ userProfile: profile });
    }
  };

  const handleSaveTranslation = async (record: TranslationRecord) => {
    setHistory((prev) => [record, ...prev]);
    await insertHistoryToDb(record);
    setMetrics((prev) => ({
      ...prev,
      totalCharsTranslated: prev.totalCharsTranslated + record.charCount,
      totalTranslationsCount: prev.totalTranslationsCount + 1,
    }));
  };

  const handleClearHistory = async () => {
    setHistory([]);
    await clearHistoryInDb();
    setMetrics((prev) => ({
      ...prev,
      totalTranslationsCount: 0,
    }));
  };

  const handleTranscriptionComplete = (text: string) => {
    const words = text.split(/\s+/).filter(Boolean).length;
    setMetrics((prev) => ({
      ...prev,
      totalWordsDictated: prev.totalWordsDictated + words,
      totalDictationsCount: prev.totalDictationsCount + 1,
    }));
  };

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
            onTriggerOverlay={(mode) => setOverlayMode(mode)}
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

      {/* Ephemeral HUD Overlays */}
      <DictationOverlay
        isOpen={overlayMode === 'stt'}
        onClose={() => setOverlayMode('none')}
        onTranscriptionComplete={handleTranscriptionComplete}
        autoPaste={settings.autoPasteToCursor}
      />

      <TranslationOverlay
        isOpen={overlayMode === 'translate'}
        onClose={() => setOverlayMode('none')}
        targetLanguage={settings.targetLanguage}
        onSaveTranslation={handleSaveTranslation}
      />
    </div>
  );
};

export default App;
