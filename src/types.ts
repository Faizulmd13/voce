export type NavPage = 'home' | 'bookmarks' | 'history' | 'settings';

export type OverlayMode = 'none' | 'stt' | 'translate' | 'bookmark';

export interface TranslationRecord {
  id: string;
  timestamp: string;
  sourceText: string;
  sourceLang: string;
  translatedText: string;
  targetLang: string;
  charCount: number;
}

export interface TranslationPayload {
  source_text: string;
  target_lang: string;
  source_lang?: string;
}

export interface DictationRecord {
  id: string;
  timestamp: string;
  text: string;
  wordCount: number;
  durationMs: number;
}

export interface BookmarkItem {
  id: string;
  title?: string;
  content: string;
  source?: string;
  created_at: string;
  driveFileId?: string;
}

export interface UserProfile {
  email: string;
  name: string;
  avatarUrl?: string;
  isAuthenticated: boolean;
  googleDriveConfigured?: boolean;
  voceFolderId?: string;
  bookmarksFolderId?: string;
  translationsFolderId?: string;
}

export interface UserSettings {
  sttHotkey: string;
  translateHotkey: string;
  bookmarkHotkey: string;
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
