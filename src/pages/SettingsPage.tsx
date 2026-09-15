import React, { useState, useEffect } from 'react';
import { Header } from '../components/Header';
import { UserSettings } from '../types';
import { 
  Keyboard, 
  Mic, 
  Languages, 
  Check, 
  Key, 
  Zap, 
  Eye, 
  EyeOff, 
  ExternalLink,
  Trash2,
  X
} from 'lucide-react';
import { getStoredApiKey, saveGroqApiKey, validateGroqApiKey, openExternalUrl, isAutostartEnabled, setAutostartEnabled } from '../services/tauri';

interface SettingsPageProps {
  settings: UserSettings;
  onUpdateSettings: (newSettings: Partial<UserSettings>) => void;
  onResetApiKey?: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  settings,
  onUpdateSettings,
  onResetApiKey,
}) => {
  const [editingHotkey, setEditingHotkey] = useState<'stt' | 'translate' | null>(null);
  const [recordedChord, setRecordedChord] = useState<string>('');
  
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [isResettingKey, setIsResettingKey] = useState(false);
  const [keySaveStatus, setKeySaveStatus] = useState<string | null>(null);
  const [autostartEnabled, setAutostartEnabledState] = useState(false);

  useEffect(() => {
    getStoredApiKey().then((k) => {
      if (k) setApiKeyInput(k);
    });
    isAutostartEnabled().then((enabled) => {
      setAutostartEnabledState(enabled);
    });
  }, []);

  const handleToggleAutostart = async () => {
    const next = !autostartEnabled;
    setAutostartEnabledState(next);
    await setAutostartEnabled(next);
  };

  const handleSaveApiKey = async () => {
    if (!apiKeyInput.trim()) return;
    setIsSavingKey(true);
    setKeySaveStatus(null);
    try {
      const isValid = await validateGroqApiKey(apiKeyInput.trim());
      if (isValid) {
        await saveGroqApiKey(apiKeyInput.trim());
        setKeySaveStatus('API key saved and verified successfully!');
        setTimeout(() => setKeySaveStatus(null), 3500);
      } else {
        setKeySaveStatus('Validation failed: Invalid Groq API key.');
      }
    } catch (err: any) {
      setKeySaveStatus(`Error saving key: ${err?.message || err}`);
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleResetApiKey = async () => {
    setIsResettingKey(true);
    setKeySaveStatus(null);
    try {
      await saveGroqApiKey('');
      setApiKeyInput('');
      setKeySaveStatus('API key removed from local store.');
      if (onResetApiKey) {
        onResetApiKey();
      }
      setTimeout(() => setKeySaveStatus(null), 3500);
    } catch (err: any) {
      setKeySaveStatus(`Error removing key: ${err?.message || err}`);
    } finally {
      setIsResettingKey(false);
    }
  };

  const startRecording = (type: 'stt' | 'translate') => {
    setEditingHotkey(type);
    setRecordedChord('');
  };

  const cancelRecording = () => {
    setEditingHotkey(null);
    setRecordedChord('');
  };

  const handleHotkeyKeyDown = (e: React.KeyboardEvent, type: 'stt' | 'translate') => {
    e.preventDefault();
    e.stopPropagation();

    // Cancel on Escape
    if (e.key === 'Escape') {
      cancelRecording();
      return;
    }

    // Commit on Enter if chord is non-empty and not just modifier
    if (e.key === 'Enter') {
      if (recordedChord && !recordedChord.endsWith('...')) {
        if (type === 'stt') {
          onUpdateSettings({ sttHotkey: recordedChord });
        } else {
          onUpdateSettings({ translateHotkey: recordedChord });
        }
        setEditingHotkey(null);
        setRecordedChord('');
      }
      return;
    }

    // Capture modifiers and primary key
    const modifiers: string[] = [];
    if (e.ctrlKey) modifiers.push('Ctrl');
    if (e.altKey) modifiers.push('Alt');
    if (e.shiftKey) modifiers.push('Shift');
    if (e.metaKey) modifiers.push('Meta');

    const rawKey = e.key;
    const isModifierOnly = ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock', 'Tab', 'Dead', 'Unidentified'].includes(rawKey);

    if (isModifierOnly) {
      if (modifiers.length > 0) {
        setRecordedChord(modifiers.join('+') + '+...');
      }
    } else {
      let formattedKey = rawKey;
      if (rawKey === ' ') {
        formattedKey = 'Space';
      } else if (rawKey.startsWith('Arrow')) {
        formattedKey = rawKey.replace('Arrow', '');
      } else if (rawKey.length === 1) {
        formattedKey = rawKey.toUpperCase();
      }

      // If user pressed a Function key without modifiers (e.g., F1-F12), that is also valid
      const fullChord = modifiers.length > 0 ? [...modifiers, formattedKey].join('+') : formattedKey;
      setRecordedChord(fullChord);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Top Header Layout Primitive */}
      <Header category="Preferences" title="Settings" />

      {/* App Preferences: Clean, inline layout rows */}
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
          <div className="flex flex-col items-end gap-1.5">
            {editingHotkey === 'stt' ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  autoFocus
                  readOnly
                  value={recordedChord || ''}
                  placeholder="Press key chord..."
                  onKeyDown={(e) => handleHotkeyKeyDown(e, 'stt')}
                  onBlur={() => {
                    // Slight delay to prevent immediate blur cancellation on accidental click
                    setTimeout(() => {
                      if (editingHotkey === 'stt' && !recordedChord) {
                        cancelRecording();
                      }
                    }, 200);
                  }}
                  className="bg-neutral-950 border border-emerald-500 text-emerald-400 px-3.5 py-1.5 rounded-lg text-xs font-mono focus:outline-none text-center animate-pulse min-w-[160px] cursor-pointer shadow-sm shadow-emerald-500/20"
                />
                <button
                  type="button"
                  onClick={cancelRecording}
                  className="p-1.5 text-neutral-400 hover:text-neutral-200 bg-neutral-950 border border-neutral-800 rounded-lg transition-colors"
                  title="Cancel (Esc)"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => startRecording('stt')}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800 hover:border-neutral-700 text-neutral-200 text-xs font-mono transition-colors group"
              >
                <Keyboard className="w-3.5 h-3.5 text-neutral-500 group-hover:text-emerald-400 transition-colors" />
                <span>{settings.sttHotkey}</span>
              </button>
            )}
            {editingHotkey === 'stt' && (
              <span className="text-[10px] font-mono text-neutral-400">
                Press <kbd className="text-emerald-400">Enter</kbd> to confirm • <kbd className="text-neutral-300">Esc</kbd> to cancel
              </span>
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
          <div className="flex flex-col items-end gap-1.5">
            {editingHotkey === 'translate' ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  autoFocus
                  readOnly
                  value={recordedChord || ''}
                  placeholder="Press key chord..."
                  onKeyDown={(e) => handleHotkeyKeyDown(e, 'translate')}
                  onBlur={() => {
                    setTimeout(() => {
                      if (editingHotkey === 'translate' && !recordedChord) {
                        cancelRecording();
                      }
                    }, 200);
                  }}
                  className="bg-neutral-950 border border-emerald-500 text-emerald-400 px-3.5 py-1.5 rounded-lg text-xs font-mono focus:outline-none text-center animate-pulse min-w-[160px] cursor-pointer shadow-sm shadow-emerald-500/20"
                />
                <button
                  type="button"
                  onClick={cancelRecording}
                  className="p-1.5 text-neutral-400 hover:text-neutral-200 bg-neutral-950 border border-neutral-800 rounded-lg transition-colors"
                  title="Cancel (Esc)"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => startRecording('translate')}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800 hover:border-neutral-700 text-neutral-200 text-xs font-mono transition-colors group"
              >
                <Keyboard className="w-3.5 h-3.5 text-neutral-500 group-hover:text-emerald-400 transition-colors" />
                <span>{settings.translateHotkey}</span>
              </button>
            )}
            {editingHotkey === 'translate' && (
              <span className="text-[10px] font-mono text-neutral-400">
                Press <kbd className="text-emerald-400">Enter</kbd> to confirm • <kbd className="text-neutral-300">Esc</kbd> to cancel
              </span>
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

        {/* Autostart on Boot Toggle */}
        <div className="p-5 flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-neutral-200 block">Launch Voce on Startup</span>
            <span className="text-xs text-neutral-500">
              Automatically start Voce in the background system tray when Windows boots
            </span>
          </div>
          <button
            onClick={handleToggleAutostart}
            className={`w-11 h-6 rounded-full transition-colors relative flex items-center p-0.5 ${
              autostartEnabled ? 'bg-emerald-500' : 'bg-neutral-800'
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full bg-neutral-100 shadow-md transform transition-transform ${
                autostartEnabled ? 'translate-x-5' : 'translate-x-0'
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
            <span className="text-xs text-neutral-500">Default audio input stream used for voice dictation recording</span>
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

      {/* Groq Cloud AI BYOK Configuration */}
      <div className="bg-neutral-900 border border-neutral-800/60 rounded-xl p-5 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-emerald-500" />
            <h2 className="text-sm font-semibold text-neutral-200 uppercase font-mono tracking-wider">
              Groq Cloud AI (BYOK)
            </h2>
          </div>
          <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 flex items-center gap-1">
            <Zap className="w-3 h-3" />
            CLOUD ACCELERATED
          </span>
        </div>

        <p className="text-xs text-neutral-400 font-sans leading-relaxed">
          Voce uses Groq's high-speed LPU infrastructure for instant Whisper STT and Llama 3.1 translation. Your key is stored securely in your local application data directory.
        </p>

        <div className="space-y-3 pt-1">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative flex-1">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={(e) => {
                  setApiKeyInput(e.target.value);
                  setKeySaveStatus(null);
                }}
                placeholder="gsk_..."
                className="w-full bg-neutral-950 border border-neutral-800 focus:border-emerald-500 rounded-lg px-3.5 py-2 text-xs font-mono text-neutral-100 pr-10 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300 p-1"
              >
                {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>

            <button
              onClick={handleSaveApiKey}
              disabled={isSavingKey || !apiKeyInput.trim()}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-neutral-950 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 shrink-0"
            >
              {isSavingKey ? (
                <>
                  <div className="w-3 h-3 border-2 border-neutral-950/30 border-t-neutral-950 rounded-full animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Update Key</span>
                </>
              )}
            </button>

            <button
              onClick={handleResetApiKey}
              disabled={isResettingKey || !apiKeyInput.trim()}
              className="px-3 py-2 bg-neutral-950 border border-neutral-800 hover:border-rose-900/60 hover:text-rose-400 text-neutral-400 text-xs font-mono rounded-lg transition-colors flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Remove API Key and reset credentials"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>

            <button
              onClick={async () => {
                try {
                  await openExternalUrl('https://console.groq.com/keys');
                } catch {
                  window.open('https://console.groq.com/keys', '_blank');
                }
              }}
              className="px-3 py-2 bg-neutral-950 border border-neutral-800 hover:border-neutral-700 text-neutral-300 text-xs font-mono rounded-lg transition-colors flex items-center justify-center gap-1.5 shrink-0"
            >
              <span>Get Free Key</span>
              <ExternalLink className="w-3 h-3 text-neutral-500" />
            </button>
          </div>

          {keySaveStatus && (
            <div className={`text-xs font-mono ${keySaveStatus.includes('successfully') || keySaveStatus.includes('removed') ? 'text-emerald-400' : 'text-rose-400'}`}>
              {keySaveStatus}
            </div>
          )}
        </div>

        {/* Model cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          <div className="p-3.5 rounded-lg bg-neutral-950/70 border border-neutral-800/50">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-mono text-neutral-400">Groq STT</span>
              <span className="text-[10px] font-mono text-emerald-400">whisper-large-v3-turbo</span>
            </div>
            <div className="text-sm font-medium text-neutral-200">Studio Speech-to-Text</div>
            <p className="text-[11px] text-neutral-500 font-mono mt-1">Sub-second transcription with anti-aliased DSP</p>
          </div>

          <div className="p-3.5 rounded-lg bg-neutral-950/70 border border-neutral-800/50">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-mono text-neutral-400">Groq LLM</span>
              <span className="text-[10px] font-mono text-emerald-400">llama-3.3-70b-versatile</span>
            </div>
            <div className="text-sm font-medium text-neutral-200">Multi-Language Translation</div>
            <p className="text-[11px] text-neutral-500 font-mono mt-1">Zero-shot high-accuracy text translation</p>
          </div>
        </div>
      </div>
    </div>
  );
};
