import { useState, useCallback } from 'react';
import { BookmarkItem, TranslationRecord } from '../types';
import { syncFromCloud } from '../services/cloud';
import {
  loadBookmarksFromDb,
  loadHistoryFromDb,
  syncBookmarksToDb,
  syncHistoryToDb,
} from '../services/db';

let inFlightSyncPromise: Promise<{ bookmarks: BookmarkItem[]; translations: TranslationRecord[] }> | null = null;

export function useSync() {
  const [isSyncing, setIsSyncing] = useState(false);

  const performCloudSync = useCallback(
    async (
      overrideBookmarks?: BookmarkItem[],
      overrideHistory?: TranslationRecord[]
    ): Promise<{ bookmarks: BookmarkItem[]; translations: TranslationRecord[] }> => {
      if (inFlightSyncPromise) {
        console.log('[useSync] Sync already in-flight, returning existing promise...');
        return inFlightSyncPromise;
      }

      setIsSyncing(true);
      inFlightSyncPromise = (async () => {
        try {
          console.log('[useSync] Starting bidirectional synchronization with Google Drive...');
          const localBookmarks = overrideBookmarks ?? (await loadBookmarksFromDb());
          const localHistory = overrideHistory ?? (await loadHistoryFromDb([]));

          console.log('[useSync] Local SQLite data retrieved before sync:', {
            bookmarksCount: localBookmarks.length,
            translationsCount: localHistory.length,
          });

          const syncResult = await syncFromCloud(localBookmarks, localHistory);

          if (syncResult.bookmarks && syncResult.bookmarks.length > 0) {
            await syncBookmarksToDb(syncResult.bookmarks);
          }

          if (syncResult.translations && syncResult.translations.length > 0) {
            await syncHistoryToDb(syncResult.translations);
          }

          console.log('[useSync] SQLite successfully updated with synced data:', {
            syncedBookmarks: syncResult.bookmarks.length,
            syncedTranslations: syncResult.translations.length,
          });

          return syncResult;
        } catch (err) {
          console.error('[useSync] Bidirectional sync failed:', err);
          return { bookmarks: [], translations: [] };
        } finally {
          setIsSyncing(false);
          inFlightSyncPromise = null;
        }
      })();

      return inFlightSyncPromise;
    },
    []
  );

  return {
    isSyncing,
    performCloudSync,
  };
}
