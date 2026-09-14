export type NavPage = 'home' | 'history' | 'settings';

export type OverlayMode = 'none' | 'stt' | 'translate';

export interface TranslationRecord {
  id: string;
  timestamp: string;
  sourceText: string;
  sourceLang: string;
  translatedText: string;
  targetLang: string;
  charCount: number;
}

export interface DictationRecord {
  id: string;
  timestamp: string;
  text: string;
  wordCount: number;
  durationMs: number;
}

export interface UserProfile {
  email: string;
  name: string;
  avatarUrl?: string;
  isAuthenticated: boolean;
}

export interface UserSettings {
  sttHotkey: string;
  translateHotkey: string;
  autoPasteToCursor: boolean;
  anonymouslySyncMetrics: boolean;
  targetLanguage: string;
  whisperModel: string;
  translationModel: string;
  audioDevice: string;
  userProfile: UserProfile;
}

export interface AppMetrics {
  totalWordsDictated: number;
  totalCharsTranslated: number;
  totalDictationsCount: number;
  totalTranslationsCount: number;
  daemonStatus: 'active' | 'idle' | 'busy' | 'error';
  lastActiveTimestamp: string;
}
