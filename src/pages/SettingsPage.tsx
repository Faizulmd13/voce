import React, { useState } from 'react';
import { Header } from '../components/Header';
import { UserSettings } from '../types';
import { 
  Keyboard, 
  Mic, 
  Languages, 
  Download, 
  Upload, 
  User, 
  Check, 
  Sparkles,
  Layers,
  LogOut,
  LogIn
} from 'lucide-react';

interface SettingsPageProps {
  settings: UserSettings;
  onUpdateSettings: (newSettings: Partial<UserSettings>) => void;
  onExportData: () => void;
  onImportData: (jsonData: string) => void;
  onGoogleAuth: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  settings,
  onUpdateSettings,
  onExportData,
  onImportData,
  onGoogleAuth
}) => {
  const [editingHotkey, setEditingHotkey] = useState<'stt' | 'translate' | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const handleKeyDown = (e: React.KeyboardEvent, type: 'stt' | 'translate') => {
    e.preventDefault();
    const keys: string[] = [];
    if (e.ctrlKey) keys.push('Ctrl');
    if (e.altKey) keys.push('Alt');
    if (e.shiftKey) keys.push('Shift');
    if (e.metaKey) keys.push('Meta');

    const key = e.key;
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
      keys.push(key.length === 1 ? key.toUpperCase() : key);
    }

    if (keys.length > 0) {
      const combo = keys.join('+');
      if (type === 'stt') {
        onUpdateSettings({ sttHotkey: combo });
      } else {
        onUpdateSettings({ translateHotkey: combo });
      }
      setEditingHotkey(null);
    }
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const content = event.target?.result as string;
          onImportData(content);
          setImportStatus('Data imported successfully');
          setTimeout(() => setImportStatus(null), 3000);
        } catch {
          setImportStatus('Failed to parse JSON file');
          setTimeout(() => setImportStatus(null), 3000);
        }
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Top Header Layout Primitive */}
      <Header category="Preferences" title="Settings" />

      {/* App Preferences: Clean, inline layout rows replacing old isolated profile cards */}
      <div className="bg-neutral-900 border border-neutral-800/60 rounded-xl divide-y divide-neutral-800/50 shadow-sm">
        <div className="p-5">
          <h2 className="text-sm font-semibold text-neutral-200 uppercase font-mono tracking-wider mb-1">
            System & Hotkey Preferences
          </h2>
          <p className="text-xs text-neutral-500 font-mono">
            Global OS shortcuts listen in the background even when Voce is minimized.
          </p>
        </div>

        {/* STT Hotkey Row */}
        <div className="p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-neutral-950 border border-neutral-800 flex items-center justify-center text-emerald-400">
              <Mic className="w-4 h-4" />
            </div>
            <div>
              <span className="text-sm font-medium text-neutral-200 block">Dictation Hotkey</span>
              <span className="text-xs text-neutral-500">Hold or press to activate voice recording overlay</span>
            </div>
          </div>
          <div>
            {editingHotkey === 'stt' ? (
              <input
                type="text"
                autoFocus
                placeholder="Press key combo..."
                onKeyDown={(e) => handleKeyDown(e, 'stt')}
                onBlur={() => setEditingHotkey(null)}
                className="bg-neutral-950 border border-emerald-500 text-emerald-400 px-3 py-1.5 rounded-lg text-xs font-mono focus:outline-none text-center animate-pulse"
              />
            ) : (
              <button
                onClick={() => setEditingHotkey('stt')}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800 hover:border-neutral-700 text-neutral-200 text-xs font-mono transition-colors"
              >
                <Keyboard className="w-3.5 h-3.5 text-neutral-500" />
                <span>{settings.sttHotkey}</span>
              </button>
            )}
          </div>
        </div>

        {/* Translation Hotkey Row */}
        <div className="p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-neutral-950 border border-neutral-800 flex items-center justify-center text-emerald-400">
              <Languages className="w-4 h-4" />
            </div>
            <div>
              <span className="text-sm font-medium text-neutral-200 block">Translation Hotkey</span>
              <span className="text-xs text-neutral-500">Reads highlighted text and opens translation overlay</span>
            </div>
          </div>
          <div>
            {editingHotkey === 'translate' ? (
              <input
                type="text"
                autoFocus
                placeholder="Press key combo..."
                onKeyDown={(e) => handleKeyDown(e, 'translate')}
                onBlur={() => setEditingHotkey(null)}
                className="bg-neutral-950 border border-emerald-500 text-emerald-400 px-3 py-1.5 rounded-lg text-xs font-mono focus:outline-none text-center animate-pulse"
              />
            ) : (
              <button
                onClick={() => setEditingHotkey('translate')}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800 hover:border-neutral-700 text-neutral-200 text-xs font-mono transition-colors"
              >
                <Keyboard className="w-3.5 h-3.5 text-neutral-500" />
                <span>{settings.translateHotkey}</span>
              </button>
            )}
          </div>
        </div>

        {/* Auto-Paste to Cursor Toggle */}
        <div className="p-5 flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-neutral-200 block">Simulate Direct Cursor Paste</span>
            <span className="text-xs text-neutral-500">
              Automatically pastes transcribed text directly into the active OS window upon dictation completion
            </span>
          </div>
          <button
            onClick={() => onUpdateSettings({ autoPasteToCursor: !settings.autoPasteToCursor })}
            className={`w-11 h-6 rounded-full transition-colors relative flex items-center p-0.5 ${
              settings.autoPasteToCursor ? 'bg-emerald-500' : 'bg-neutral-800'
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full bg-neutral-100 shadow-md transform transition-transform ${
                settings.autoPasteToCursor ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Target Translation Language */}
        <div className="p-5 flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-neutral-200 block">Default Target Translation Language</span>
            <span className="text-xs text-neutral-500">Destination language for text translation hotkey</span>
          </div>
          <select
            value={settings.targetLanguage}
            onChange={(e) => onUpdateSettings({ targetLanguage: e.target.value })}
            className="bg-neutral-950 border border-neutral-800 text-neutral-200 text-xs font-mono rounded-lg px-3 py-1.5 focus:outline-none focus:border-neutral-700"
          >
            <option value="English">English (eng_Latn)</option>
            <option value="Spanish">Spanish (spa_Latn)</option>
            <option value="French">French (fra_Latn)</option>
            <option value="German">German (deu_Latn)</option>
            <option value="Tamil">Tamil (tam_Taml)</option>
            <option value="Hindi">Hindi (hin_Deva)</option>
            <option value="Japanese">Japanese (jpn_Jpan)</option>
            <option value="Chinese (Simplified)">Chinese Simplified (zho_Hans)</option>
            <option value="Arabic">Arabic (ara_Arab)</option>
            <option value="Russian">Russian (rus_Cyrl)</option>
            <option value="Italian">Italian (ita_Latn)</option>
            <option value="Portuguese">Portuguese (por_Latn)</option>
          </select>
        </div>

        {/* Audio Input Selector */}
        <div className="p-5 flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-neutral-200 block">Microphone Device</span>
            <span className="text-xs text-neutral-500">Default audio input stream used for whisper.cpp recording</span>
          </div>
          <select
            value={settings.audioDevice}
            onChange={(e) => onUpdateSettings({ audioDevice: e.target.value })}
            className="bg-neutral-950 border border-neutral-800 text-neutral-200 text-xs font-mono rounded-lg px-3 py-1.5 focus:outline-none focus:border-neutral-700"
          >
            <option value="Default System Microphone">Default System Microphone</option>
            <option value="Realtek High Definition Audio">Realtek High Definition Audio</option>
            <option value="Virtual Audio Cable">Virtual Audio Cable</option>
          </select>
        </div>
      </div>

      {/* Usage Statistics Section (Exact text from DESIGN.md Section 2.D) */}
      <div className="bg-neutral-900 border border-neutral-800/60 rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-emerald-500" />
              <span className="text-sm font-semibold text-neutral-200 uppercase font-mono tracking-wider">
                Usage Statistics
              </span>
            </div>
            <p className="text-xs text-neutral-400 font-sans leading-relaxed">
              Anonymously sync total usage metrics (word counts and translation volumes) to update the public product landing page milestone statistics.
            </p>
          </div>
          <button
            onClick={() => onUpdateSettings({ anonymouslySyncMetrics: !settings.anonymouslySyncMetrics })}
            className={`w-11 h-6 rounded-full transition-colors relative flex items-center p-0.5 shrink-0 ml-4 ${
              settings.anonymouslySyncMetrics ? 'bg-emerald-500' : 'bg-neutral-800'
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full bg-neutral-100 shadow-md transform transition-transform ${
                settings.anonymouslySyncMetrics ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Local AI Models & Sidecar Engine Status */}
      <div className="bg-neutral-900 border border-neutral-800/60 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-500" />
            <h2 className="text-sm font-semibold text-neutral-200 uppercase font-mono tracking-wider">
              Local AI Engine Bundles
            </h2>
          </div>
          <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
            OFFLINE READY
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-3.5 rounded-lg bg-neutral-950/70 border border-neutral-800/50">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-mono text-neutral-400">whisper.cpp</span>
              <span className="text-[10px] font-mono text-emerald-400">142 MB</span>
            </div>
            <div className="text-sm font-medium text-neutral-200">ggml-base.en.bin</div>
            <p className="text-[11px] text-neutral-500 font-mono mt-1">High-speed English STT model</p>
          </div>

          <div className="p-3.5 rounded-lg bg-neutral-950/70 border border-neutral-800/50">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-mono text-neutral-400">CTranslate2</span>
              <span className="text-[10px] font-mono text-emerald-400">320 MB</span>
            </div>
            <div className="text-sm font-medium text-neutral-200">nllb-200-distilled-600M</div>
            <p className="text-[11px] text-neutral-500 font-mono mt-1">Quantized 200-language translation</p>
          </div>
        </div>
      </div>

      {/* Account / OAuth & Local Database Management */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Google OAuth Status */}
        <div className="bg-neutral-900 border border-neutral-800/60 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <User className="w-4 h-4 text-emerald-500" />
              <span className="text-sm font-semibold text-neutral-200 uppercase font-mono tracking-wider">
                Account & Sync
              </span>
            </div>
            <p className="text-xs text-neutral-500 font-mono mb-4">
              Local desktop authentication with optional cloud profile sync.
            </p>

            {settings.userProfile.isAuthenticated ? (
              <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800 flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-neutral-200 block">{settings.userProfile.name}</span>
                  <span className="text-xs text-neutral-500 font-mono">{settings.userProfile.email}</span>
                </div>
                <button
                  onClick={onGoogleAuth}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-mono text-neutral-400 hover:text-red-400 bg-neutral-900 border border-neutral-800 transition-colors"
                >
                  <LogOut className="w-3 h-3" />
                  Sign Out
                </button>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800 flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-neutral-300 block">Local Anonymous Profile</span>
                  <span className="text-xs text-neutral-500 font-mono">100% stored on device</span>
                </div>
                <button
                  onClick={onGoogleAuth}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-100 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 transition-colors"
                >
                  <LogIn className="w-3.5 h-3.5 text-emerald-400" />
                  Sign in with Google
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Database Export & Import */}
        <div className="bg-neutral-900 border border-neutral-800/60 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-neutral-200 uppercase font-mono tracking-wider">
                Local Data Store (SQLite/JSON)
              </span>
              {importStatus && (
                <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  {importStatus}
                </span>
              )}
            </div>
            <p className="text-xs text-neutral-500 font-mono mb-4">
              Backup your local history logs and preferences or restore from a previous JSON export.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={onExportData}
                className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-neutral-950 border border-neutral-800 hover:border-neutral-700 text-neutral-200 text-xs font-mono transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                Export JSON
              </button>

              <label className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-neutral-950 border border-neutral-800 hover:border-neutral-700 text-neutral-200 text-xs font-mono transition-colors cursor-pointer">
                <Upload className="w-3.5 h-3.5 text-emerald-400" />
                Import JSON
                <input
                  type="file"
                  accept=".json"
                  onChange={handleFileImport}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
