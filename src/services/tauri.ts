import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { UserProfile, BookmarkItem } from '../types';

export interface CloudSyncResult {
  bookmarks: BookmarkItem[];
  translations: Array<{
    id: string;
    timestamp: string;
    sourceText: string;
    sourceLang: string;
    translatedText: string;
    targetLang: string;
    charCount: number;
  }>;
}

export function normalizeUserProfile(raw: any): UserProfile {
  if (!raw) {
    return {
      name: 'Anonymous User',
      email: 'Not signed in',
      isAuthenticated: false,
      googleDriveConfigured: false,
    };
  }
  const isAuth = Boolean(
    raw.isAuthenticated ??
    raw.is_authenticated ??
    (raw.email && raw.email !== 'Not signed in' && raw.email.includes('@'))
  );
  return {
    name: raw.name || 'Anonymous User',
    email: raw.email || 'Not signed in',
    avatarUrl: raw.avatarUrl || raw.avatar_url || undefined,
    isAuthenticated: isAuth,
    googleDriveConfigured: Boolean(raw.googleDriveConfigured ?? raw.google_drive_configured ?? false),
    voceFolderId: raw.voceFolderId || raw.voce_folder_id || undefined,
    bookmarksFolderId: raw.bookmarksFolderId || raw.bookmarks_folder_id || undefined,
    translationsFolderId: raw.translationsFolderId || raw.translations_folder_id || undefined,
  };
}

export async function syncFromCloud(
  localBookmarks?: BookmarkItem[],
  localTranslations?: any[]
): Promise<CloudSyncResult> {
  const bms = localBookmarks ? localBookmarks.map((b) => ({
    id: b.id,
    title: b.title || null,
    content: b.content,
    source: b.source || null,
    created_at: b.created_at || (b as any).createdAt || new Date().toISOString(),
    createdAt: b.created_at || (b as any).createdAt || new Date().toISOString(),
    driveFileId: b.driveFileId || (b as any).drive_file_id || null,
    drive_file_id: b.driveFileId || (b as any).drive_file_id || null,
  })) : null;

  const trns = localTranslations ? localTranslations.map((t) => ({
    id: t.id,
    timestamp: t.timestamp || new Date().toISOString(),
    sourceText: t.sourceText || t.source_text || '',
    source_text: t.sourceText || t.source_text || '',
    sourceLang: t.sourceLang || t.source_lang || 'Auto-detected',
    source_lang: t.sourceLang || t.source_lang || 'Auto-detected',
    translatedText: t.translatedText || t.translated_text || '',
    translated_text: t.translatedText || t.translated_text || '',
    targetLang: t.targetLang || t.target_lang || 'English',
    target_lang: t.targetLang || t.target_lang || 'English',
    charCount: t.charCount || t.char_count || (t.sourceText || t.source_text || '').length,
    char_count: t.charCount || t.char_count || (t.sourceText || t.source_text || '').length,
  })) : null;

  const raw = await invoke<any>('sync_from_cloud', {
    localBookmarks: bms,
    localTranslations: trns,
  });

  const parsedBookmarks: BookmarkItem[] = (raw.bookmarks || []).map((b: any) => ({
    id: b.id,
    title: b.title || undefined,
    content: b.content,
    source: b.source || undefined,
    created_at: b.createdAt || b.created_at || new Date().toISOString(),
    driveFileId: b.driveFileId || b.drive_file_id || undefined,
  }));

  const parsedTranslations = (raw.translations || []).map((t: any) => ({
    id: t.id,
    timestamp: t.timestamp,
    sourceText: t.sourceText || t.source_text || '',
    sourceLang: t.sourceLang || t.source_lang || 'Auto-detected',
    translatedText: t.translatedText || t.translated_text || '',
    targetLang: t.targetLang || t.target_lang || 'English',
    charCount: t.charCount || t.char_count || 0,
  }));

  return {
    bookmarks: parsedBookmarks,
    translations: parsedTranslations,
  };
}

export async function triggerGoogleOAuth(): Promise<UserProfile> {
  const raw = await invoke<any>('start_google_oauth');
  return normalizeUserProfile(raw);
}

export async function getGoogleUserProfile(): Promise<UserProfile> {
  const raw = await invoke<any>('get_google_user_profile');
  return normalizeUserProfile(raw);
}

export async function googleLogout(): Promise<UserProfile> {
  const raw = await invoke<any>('google_logout');
  return normalizeUserProfile(raw);
}

export async function uploadBookmarkToDrive(payload: {
  id: string;
  title?: string;
  content: string;
  source?: string;
  created_at: string;
}): Promise<BookmarkItem> {
  return await invoke<BookmarkItem>('upload_bookmark_to_drive', { payload });
}

export async function updateBookmarkInDrive(
  payload: {
    id: string;
    title?: string;
    content: string;
    source?: string;
    created_at: string;
  },
  driveFileId: string
): Promise<BookmarkItem> {
  return await invoke<BookmarkItem>('update_bookmark_in_drive', { payload, driveFileId });
}

export async function fetchBookmarksFromDrive(): Promise<BookmarkItem[]> {
  return await invoke<BookmarkItem[]>('fetch_bookmarks_from_drive');
}

export async function deleteBookmarkFromDrive(fileId: string): Promise<void> {
  await invoke('delete_bookmark_from_drive', { fileId });
}

export async function retroactiveSyncLocalData(
  bookmarks: Array<{
    id: string;
    title?: string;
    content: string;
    source?: string;
    created_at: string;
  }>,
  translations: Array<{
    id: string;
    source_text: string;
    translated_text: string;
  }>
): Promise<void> {
  await invoke('retroactive_sync_local_data', { bookmarks, translations });
}

export async function updateBackendHotkeys(
  sttHotkey: string,
  translateHotkey: string,
  bookmarkHotkey: string = 'Alt+B'
): Promise<void> {
  await invoke('update_global_hotkeys', {
    sttHotkey,
    translateHotkey,
    bookmarkHotkey,
  });
}

export function subscribeToOverlayTriggers(
  onStt: () => void,
  onTranslate: (payload?: { source_text: string; translated_text: string; target_lang: string }) => void,
  onBookmark?: (payload?: { captured_text: string }) => void
): () => void {
  let unlistenStt: UnlistenFn | null = null;
  let unlistenTrn: UnlistenFn | null = null;
  let unlistenBm: UnlistenFn | null = null;

  listen('trigger-stt-overlay', () => {
    onStt();
  }).then((unlisten) => {
    unlistenStt = unlisten;
  });

  listen<{ source_text: string; translated_text: string; target_lang: string }>('trigger-translate-overlay', (event) => {
    onTranslate(event.payload);
  }).then((unlisten) => {
    unlistenTrn = unlisten;
  });

  if (onBookmark) {
    listen<{ captured_text: string }>('trigger-bookmark-overlay', (event) => {
      onBookmark(event.payload);
    }).then((unlisten) => {
      unlistenBm = unlisten;
    });
  }

  return () => {
    if (unlistenStt) unlistenStt();
    if (unlistenTrn) unlistenTrn();
    if (unlistenBm) unlistenBm();
  };
}

export async function startAudioRecording(): Promise<void> {
  await invoke('start_audio_recording');
}

export async function stopAudioRecording(): Promise<string> {
  return await invoke<string>('stop_audio_recording');
}

export async function executeLocalTranscription(audioBufferPath: string, model: string = 'whisper-large-v3-turbo'): Promise<string> {
  return await invoke<string>('execute_local_transcription', {
    payload: {
      audio_buffer_path: audioBufferPath,
      model,
    },
  });
}

export async function getClipboardText(): Promise<string> {
  return await invoke<string>('get_clipboard_text');
}

export async function executeLocalTranslation(
  sourceText: string,
  targetLang: string = 'English',
  sourceLang: string = 'auto'
): Promise<string> {
  return await invoke<string>('execute_local_translation', {
    payload: {
      source_text: sourceText,
      target_lang: targetLang,
      source_lang: sourceLang,
    },
  });
}

export async function injectTextToCursor(text: string): Promise<void> {
  await invoke('inject_text_to_cursor', { text });
}

export async function getStoredApiKey(): Promise<string | null> {
  return await invoke<string | null>('get_stored_api_key');
}

export async function saveGroqApiKey(apiKey: string): Promise<void> {
  await invoke('save_groq_api_key', { apiKey });
}

export async function validateGroqApiKey(apiKey: string): Promise<boolean> {
  return await invoke<boolean>('validate_groq_api_key', { apiKey });
}

export async function openExternalUrl(url: string): Promise<void> {
  await invoke('open_external_url', { url });
}

export async function showOverlay(
  label: 'stt-overlay' | 'translate-overlay' | 'bookmark-overlay',
  offsetY?: number
): Promise<void> {
  await invoke('show_overlay', { label, offset_y: offsetY });
}

export async function hideOverlay(
  label: 'stt-overlay' | 'translate-overlay' | 'bookmark-overlay'
): Promise<void> {
  await invoke('hide_overlay', { label });
}

export async function isAutostartEnabled(): Promise<boolean> {
  try {
    const { isEnabled } = await import('@tauri-apps/plugin-autostart');
    return await isEnabled();
  } catch (e) {
    console.warn('Autostart plugin unavailable:', e);
    return false;
  }
}

export async function setAutostartEnabled(enabled: boolean): Promise<void> {
  try {
    const { enable, disable } = await import('@tauri-apps/plugin-autostart');
    if (enabled) {
      await enable();
    } else {
      await disable();
    }
  } catch (e) {
    console.warn('Failed to toggle autostart:', e);
  }
}
