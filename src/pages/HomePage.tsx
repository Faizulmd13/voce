import React from 'react';
import { Header } from '../components/Header';
import { AppMetrics, UserSettings, OverlayMode } from '../types';
import { Activity, Mic, Languages, Bookmark, Play, User } from 'lucide-react';

interface HomePageProps {
  metrics: AppMetrics;
  settings: UserSettings;
  onTriggerOverlay: (mode: OverlayMode) => void;
}

export const HomePage: React.FC<HomePageProps> = ({ metrics, settings, onTriggerOverlay }) => {
  return (
    <div className="max-w-5xl mx-auto">
      {/* Top Header Layout Primitive with Authenticated User State */}
      <Header
        category="Overview"
        title="Home"
        action={
          settings.userProfile.isAuthenticated ? (
            <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 shadow-sm">
              {settings.userProfile.avatarUrl ? (
                <img
                  src={settings.userProfile.avatarUrl}
                  alt={settings.userProfile.name}
                  referrerPolicy="no-referrer"
                  className="w-5 h-5 rounded-full object-cover border border-emerald-500/40"
                />
              ) : (
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
              )}
              <div className="text-right">
                <span className="text-xs font-medium text-neutral-200 block leading-tight">
                  {settings.userProfile.name}
                </span>
                <span className="text-[10px] font-mono text-neutral-500 block leading-tight">
                  {settings.userProfile.email}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800">
              <User className="w-3.5 h-3.5 text-neutral-500" />
              <span className="text-xs font-mono text-neutral-400">Local Anonymous Mode</span>
            </div>
          )
        }
      />

      <div className="space-y-6">
        {/* Metric Analytics Display: Unified layout rows showing high-contrast, beautiful typography */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Total Words Dictated */}
          <div className="bg-neutral-900 border border-neutral-800/60 rounded-xl p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono uppercase tracking-widest text-neutral-500">
                Total Words Dictated
              </span>
              <Mic className="w-4 h-4 text-neutral-500" />
            </div>
            <div className="my-3">
              <div className="text-4xl font-mono font-bold tracking-tight text-neutral-100">
                {metrics.totalWordsDictated.toLocaleString()}
              </div>
              <p className="text-xs text-neutral-500 font-mono mt-1">
                Across {metrics.totalDictationsCount} dictation sessions
              </p>
            </div>
            <div className="pt-3 border-t border-neutral-800/40 flex items-center justify-between text-xs">
              <span className="text-neutral-500 font-mono">Hotkey: <code className="text-emerald-400 bg-neutral-950 px-1.5 py-0.5 rounded border border-neutral-800">{settings.sttHotkey}</code></span>
              <button
                onClick={() => onTriggerOverlay('stt')}
                className="inline-flex items-center gap-1.5 text-neutral-300 hover:text-emerald-400 font-medium transition-colors"
              >
                <Play className="w-3 h-3" />
                Test Overlay
              </button>
            </div>
          </div>

          {/* Total Characters Translated */}
          <div className="bg-neutral-900 border border-neutral-800/60 rounded-xl p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono uppercase tracking-widest text-neutral-500">
                Total Characters Translated
              </span>
              <Languages className="w-4 h-4 text-neutral-500" />
            </div>
            <div className="my-3">
              <div className="text-4xl font-mono font-bold tracking-tight text-neutral-100">
                {metrics.totalCharsTranslated.toLocaleString()}
              </div>
              <p className="text-xs text-neutral-500 font-mono mt-1">
                Across {metrics.totalTranslationsCount} translation events
              </p>
            </div>
            <div className="pt-3 border-t border-neutral-800/40 flex items-center justify-between text-xs">
              <span className="text-neutral-500 font-mono">Hotkey: <code className="text-emerald-400 bg-neutral-950 px-1.5 py-0.5 rounded border border-neutral-800">{settings.translateHotkey}</code></span>
              <button
                onClick={() => onTriggerOverlay('translate')}
                className="inline-flex items-center gap-1.5 text-neutral-300 hover:text-emerald-400 font-medium transition-colors"
              >
                <Play className="w-3 h-3" />
                Test Overlay
              </button>
            </div>
          </div>
        </div>

        {/* Global Hotkey Listeners Status Card */}
        <div className="bg-neutral-900 border border-neutral-800/60 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-neutral-200 uppercase font-mono tracking-wider">
              System Interop & Hotkey Hooks
            </h2>
            <Activity className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-neutral-950/60 border border-neutral-800/40">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded bg-neutral-900 border border-neutral-800 flex items-center justify-center text-emerald-400 font-mono text-xs">
                  STT
                </div>
                <div>
                  <span className="text-sm font-medium text-neutral-200 block">Voice Dictation Trigger</span>
                  <span className="text-xs text-neutral-500">Record mic, transcribe via Groq Whisper, auto-paste to cursor</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <kbd className="px-2.5 py-1 rounded bg-neutral-900 border border-neutral-700 text-neutral-200 font-mono text-xs shadow-inner">
                  {settings.sttHotkey}
                </kbd>
                <span className="text-[11px] font-mono text-emerald-400">HOOKED</span>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-neutral-950/60 border border-neutral-800/40">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded bg-neutral-900 border border-neutral-800 flex items-center justify-center text-emerald-400 font-mono text-xs">
                  TRN
                </div>
                <div>
                  <span className="text-sm font-medium text-neutral-200 block">Selection Translation Trigger</span>
                  <span className="text-xs text-neutral-500">Capture clipboard selection, translate via Groq Llama, instant paste</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <kbd className="px-2.5 py-1 rounded bg-neutral-900 border border-neutral-700 text-neutral-200 font-mono text-xs shadow-inner">
                  {settings.translateHotkey}
                </kbd>
                <span className="text-[11px] font-mono text-emerald-400">HOOKED</span>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-neutral-950/60 border border-neutral-800/40">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded bg-neutral-900 border border-neutral-800 flex items-center justify-center text-emerald-400">
                  <Bookmark className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-sm font-medium text-neutral-200 block">Bookmark Capture Trigger</span>
                  <span className="text-xs text-neutral-500">Capture selection, save snippet to Google Drive vault (Voce/bookmarks)</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <kbd className="px-2.5 py-1 rounded bg-neutral-900 border border-neutral-700 text-neutral-200 font-mono text-xs shadow-inner">
                  {settings.bookmarkHotkey || 'Alt+B'}
                </kbd>
                <span className="text-[11px] font-mono text-emerald-400">HOOKED</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
