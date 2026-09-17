import { invoke } from '@tauri-apps/api/core';
import { UserProfile, BookmarkItem, TranslationRecord } from '../types';

export function normalizeUserProfile(raw: any): UserProfile {
  if (!raw) {
    return {
      name: 'Anonymous User',
      email: 'Not signed in',
      isAuthenticated: false,
      googleDriveConfigured: false,
    };
  }
  return {
    name: raw.name || 'Anonymous User',
    email: raw.email || 'Not signed in',
    avatarUrl: raw.avatarUrl || raw.avatar_url || undefined,
    isAuthenticated: Boolean(raw.isAuthenticated ?? raw.is_authenticated),
    googleDriveConfigured: Boolean(raw.googleDriveConfigured ?? raw.google_drive_configured),
    voceFolderId: raw.voceFolderId || raw.voce_folder_id || undefined,
    bookmarksFolderId: raw.bookmarksFolderId || raw.bookmarks_folder_id || undefined,
    translationsFolderId: raw.translationsFolderId || raw.translations_folder_id || undefined,
  };
}

export async function triggerGoogleOAuth(): Promise<UserProfile> {
  console.log('[Cloud Auth] Triggering Google OAuth consent flow...');
  const raw = await invoke<any>('start_google_oauth');
  return normalizeUserProfile(raw);
}

export async function getGoogleUserProfile(): Promise<UserProfile> {
  const raw = await invoke<any>('get_google_user_profile');
  return normalizeUserProfile(raw);
}

export async function googleLogout(): Promise<UserProfile> {
  console.log('[Cloud Auth] Logging out of Google and purging credentials...');
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

export async function deleteTranslationFromDrive(payload: {
  fileId?: string;
  id?: string;
  sourceText?: string;
}): Promise<void> {
  await invoke('delete_translation_from_drive', {
    fileId: payload.fileId,
    id: payload.id,
    sourceText: payload.sourceText,
  });
}

export async function clearAllTranslationsFromDrive(): Promise<void> {
  await invoke('clear_all_translations_from_drive');
}

export async function syncFromCloud(
  localBookmarks?: BookmarkItem[],
  localTranslations?: TranslationRecord[]
): Promise<{ bookmarks: BookmarkItem[]; translations: TranslationRecord[] }> {
  console.log('[Cloud Sync] Invoking sync_from_cloud with local records:', {
    localBookmarksCount: localBookmarks?.length ?? 0,
    localTranslationsCount: localTranslations?.length ?? 0,
  });

  const raw = await invoke<any>('sync_from_cloud', {
    localBookmarks: localBookmarks || [],
    localTranslations: (localTranslations || []).map((t) => ({
      id: t.id,
      timestamp: t.timestamp,
      source_text: t.sourceText,
      source_lang: t.sourceLang || 'Auto-detected',
      translated_text: t.translatedText,
      target_lang: t.targetLang || 'English',
      char_count: t.charCount || t.sourceText.length,
      drive_file_id: t.driveFileId,
    })),
  });

  const parsedBookmarks: BookmarkItem[] = (raw.bookmarks || []).map((b: any) => ({
    id: b.id,
    title: b.title || undefined,
    content: b.content || '',
    source: b.source || undefined,
    created_at: b.createdAt || b.created_at || new Date().toISOString(),
    driveFileId: b.driveFileId || b.drive_file_id || undefined,
  }));

  const parsedTranslations: TranslationRecord[] = (raw.translations || []).map((t: any) => ({
    id: t.id,
    timestamp: t.timestamp || new Date().toISOString(),
    sourceText: t.sourceText || t.source_text || '',
    sourceLang: t.sourceLang || t.source_lang || 'Auto-detected',
    translatedText: t.translatedText || t.translated_text || '',
    targetLang: t.targetLang || t.target_lang || 'English',
    charCount: t.charCount || t.char_count || (t.sourceText || t.source_text || '').length,
    driveFileId: t.driveFileId || t.drive_file_id || undefined,
  }));

  console.log('[Cloud Sync] Cloud synchronization completed:', {
    mergedBookmarksCount: parsedBookmarks.length,
    mergedTranslationsCount: parsedTranslations.length,
  });

  return {
    bookmarks: parsedBookmarks,
    translations: parsedTranslations,
  };
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
