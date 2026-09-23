import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { UserProfile, TranslationRecord, BookmarkItem, DictationRecord } from '../types';
import { insertHistoryToDb, insertDictationToDb, wipeAllLocalDataFromDb, syncHistoryToDb, syncBookmarksToDb } from '../services/db';
import { normalizeUserProfile } from '../services/cloud';

interface UseTauriEventsProps {
  onTranscription: (words: number) => void;
  onTranslation: (record: TranslationRecord) => void;
  onLoginSuccess: (profile: UserProfile) => void;
  onLogoutSuccess: (profile: UserProfile) => void;
  onSyncCompleted: (payload?: { bookmarks?: BookmarkItem[]; translations?: TranslationRecord[] }) => void;
}

export function useTauriEvents({
  onTranscription,
  onTranslation,
  onLoginSuccess,
  onLogoutSuccess,
  onSyncCompleted,
}: UseTauriEventsProps) {
  useEffect(() => {
    // 1. Transcription completed event
    const unlistenSttPromise = listen<{ id?: string; timestamp?: string; text?: string; words?: number; word_count?: number }>('transcription-completed', async (event) => {
      if (event.payload) {
        const words = event.payload.words ?? event.payload.word_count ?? (event.payload.text ? event.payload.text.split(/\s+/).filter(Boolean).length : 0);
        if (words > 0) {
          const record: DictationRecord = {
            id: event.payload.id || `stt_${Date.now()}`,
            wordCount: words,
            timestamp: event.payload.timestamp || new Date().toISOString().replace('T', ' ').substring(0, 19),
            durationMs: 0,
          };
          await insertDictationToDb(record);
          onTranscription(words);
        }
      }
    });

    // 2. Translation completed event
    const unlistenTrnPromise = listen<{
      id?: string;
      timestamp?: string;
      source_text: string;
      translated_text: string;
      source_lang: string;
      target_lang: string;
      char_count?: number;
    }>('translation-completed', async (event) => {
      if (event.payload?.translated_text) {
        const record: TranslationRecord = {
          id: event.payload.id || `trn_${Date.now()}`,
          timestamp: event.payload.timestamp || new Date().toISOString().replace('T', ' ').substring(0, 19),
          sourceText: event.payload.source_text,
          sourceLang: event.payload.source_lang || 'Auto-detected',
          translatedText: event.payload.translated_text,
          targetLang: event.payload.target_lang || 'English',
          charCount: event.payload.char_count || event.payload.source_text.length,
        };
        await insertHistoryToDb(record);
        onTranslation(record);
      }
    });

    // 3. Google OAuth Login Success
    const unlistenOAuthLoginPromise = listen<any>('oauth-login-success', (event) => {
      if (event.payload) {
        const profile = normalizeUserProfile(event.payload);
        console.log('[useTauriEvents] OAuth login success detected:', profile.email);
        onLoginSuccess(profile);
      }
    });

    // 4. Google OAuth Profile Updated
    const unlistenProfileUpdatedPromise = listen<any>('profile-updated', (event) => {
      if (event.payload) {
        const profile = normalizeUserProfile(event.payload);
        if (profile.isAuthenticated) {
          onLoginSuccess(profile);
        }
      }
    });

    // 5. Google OAuth Logout Success: Wipe on Logout
    const unlistenOAuthLogoutPromise = listen<UserProfile>('oauth-logout-success', async (event) => {
      console.log('[useTauriEvents] OAuth logout event received, wiping local data...');
      await wipeAllLocalDataFromDb();
      const anon = normalizeUserProfile(event.payload);
      onLogoutSuccess(anon);
    });

    // 6. Cloud sync completed event
    const unlistenCloudSyncPromise = listen<any>('cloud-sync-completed', async (event) => {
      let parsedTranslations: TranslationRecord[] | undefined;
      let parsedBookmarks: BookmarkItem[] | undefined;

      if (event.payload) {
        if (event.payload.translations && Array.isArray(event.payload.translations)) {
          const translations: TranslationRecord[] = event.payload.translations.map((t: any) => ({
            id: t.id,
            timestamp: t.timestamp || new Date().toISOString(),
            sourceText: t.sourceText || t.source_text || '',
            sourceLang: t.sourceLang || t.source_lang || 'Auto-detected',
            translatedText: t.translatedText || t.translated_text || '',
            targetLang: t.targetLang || t.target_lang || 'English',
            charCount: t.charCount || t.char_count || (t.sourceText || t.source_text || '').length,
            driveFileId: t.driveFileId || t.drive_file_id || undefined,
          }));
          parsedTranslations = translations;
          await syncHistoryToDb(translations);
        }
        if (event.payload.bookmarks && Array.isArray(event.payload.bookmarks)) {
          const bookmarks: BookmarkItem[] = event.payload.bookmarks.map((b: any) => ({
            id: b.id,
            title: b.title || undefined,
            content: b.content || '',
            source: b.source || undefined,
            created_at: b.createdAt || b.created_at || new Date().toISOString(),
            driveFileId: b.driveFileId || b.drive_file_id || undefined,
          }));
          parsedBookmarks = bookmarks;
          await syncBookmarksToDb(bookmarks);
        }
      }
      onSyncCompleted({ bookmarks: parsedBookmarks, translations: parsedTranslations });
    });

    return () => {
      unlistenSttPromise.then((fn) => fn());
      unlistenTrnPromise.then((fn) => fn());
      unlistenOAuthLoginPromise.then((fn) => fn());
      unlistenProfileUpdatedPromise.then((fn) => fn());
      unlistenOAuthLogoutPromise.then((fn) => fn());
      unlistenCloudSyncPromise.then((fn) => fn());
    };
  }, [onTranscription, onTranslation, onLoginSuccess, onLogoutSuccess, onSyncCompleted]);
}
