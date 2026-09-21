import Database from '@tauri-apps/plugin-sql';
import { TranslationRecord, UserSettings, BookmarkItem, DictationRecord } from '../types';

let dbInstance: Database | null = null;

export async function getDb(): Promise<Database | null> {
  if (dbInstance) return dbInstance;
  try {
    // Connect to SQLite voce.db
    dbInstance = await Database.load('sqlite:voce.db');
    return dbInstance;
  } catch (e) {
    console.warn('Tauri SQL plugin not available in browser mode, falling back to local storage:', e);
    return null;
  }
}

export async function loadPreferencesFromDb(fallback: UserSettings): Promise<UserSettings> {
  try {
    const db = await getDb();
    if (!db) {
      const local = localStorage.getItem('voce_preferences');
      return local ? JSON.parse(local) : fallback;
    }

    const rows = await db.select<{ key: string; value: string }[]>('SELECT key, value FROM preferences');
    if (rows && rows.length > 0) {
      const prefs: Record<string, string> = {};
      rows.forEach((r) => {
        prefs[r.key] = r.value;
      });
      return {
        sttHotkey: prefs.sttHotkey || fallback.sttHotkey,
        translateHotkey: prefs.translateHotkey || fallback.translateHotkey,
        bookmarkHotkey: prefs.bookmarkHotkey || fallback.bookmarkHotkey || 'Alt+B',
        autoPasteToCursor: prefs.autoPasteToCursor === 'true',
        anonymouslySyncMetrics: prefs.anonymouslySyncMetrics === 'true',
        targetLanguage: prefs.targetLanguage || fallback.targetLanguage,
        whisperModel: prefs.whisperModel || fallback.whisperModel,
        translationModel: prefs.translationModel || fallback.translationModel,
        audioDevice: prefs.audioDevice || fallback.audioDevice,
        userProfile: prefs.userProfile ? JSON.parse(prefs.userProfile) : fallback.userProfile,
      };
    }
  } catch (e) {
    console.error('Failed to load preferences from SQLite:', e);
  }
  return fallback;
}

export async function savePreferencesToDb(settings: UserSettings): Promise<void> {
  try {
    localStorage.setItem('voce_preferences', JSON.stringify(settings));
    const db = await getDb();
    if (!db) return;

    const entries = [
      ['sttHotkey', settings.sttHotkey],
      ['translateHotkey', settings.translateHotkey],
      ['bookmarkHotkey', settings.bookmarkHotkey],
      ['autoPasteToCursor', String(settings.autoPasteToCursor)],
      ['anonymouslySyncMetrics', String(settings.anonymouslySyncMetrics)],
      ['targetLanguage', settings.targetLanguage],
      ['whisperModel', settings.whisperModel],
      ['translationModel', settings.translationModel],
      ['audioDevice', settings.audioDevice],
      ['userProfile', JSON.stringify(settings.userProfile)],
    ];

    for (const [key, value] of entries) {
      await db.execute(
        'INSERT INTO preferences (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2',
        [key, value]
      );
    }
  } catch (e) {
    console.error('Failed to save preferences to SQLite:', e);
  }
}

export async function loadHistoryFromDb(fallback: TranslationRecord[] = []): Promise<TranslationRecord[]> {
  try {
    const db = await getDb();
    if (!db) {
      const local = localStorage.getItem('voce_history');
      return local ? JSON.parse(local) : fallback;
    }

    const rows = await db.select<{
      id: string;
      type: string;
      source_text: string;
      translated_text: string;
      source_lang: string;
      target_lang: string;
      timestamp: string;
      char_count: number;
      drive_file_id: string | null;
    }[]>('SELECT * FROM history ORDER BY timestamp DESC');

    if (rows && rows.length > 0) {
      const mapped = rows.map((r) => ({
        id: r.id,
        timestamp: r.timestamp,
        sourceText: r.source_text,
        sourceLang: r.source_lang || 'Auto-detected',
        translatedText: r.translated_text,
        targetLang: r.target_lang || 'English',
        charCount: r.char_count || r.source_text.length,
        driveFileId: r.drive_file_id || undefined,
      }));
      localStorage.setItem('voce_history', JSON.stringify(mapped));
      return mapped;
    }

    const local = localStorage.getItem('voce_history');
    if (local) {
      const parsed = JSON.parse(local);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Failed to load history from SQLite:', e);
    const local = localStorage.getItem('voce_history');
    if (local) return JSON.parse(local);
  }
  return fallback;
}

export async function insertHistoryToDb(record: TranslationRecord): Promise<void> {
  try {
    // 1. Update localStorage cache for instant reactivity
    const local = await loadHistoryFromDb([]);
    const isDup = local.some(
      (h) => h.id === record.id || (h.sourceText.trim() === record.sourceText.trim() && h.translatedText.trim() === record.translatedText.trim())
    );
    const updated = isDup
      ? local.map((h) =>
          h.id === record.id || (h.sourceText.trim() === record.sourceText.trim() && h.translatedText.trim() === record.translatedText.trim())
            ? { ...h, ...record, driveFileId: record.driveFileId || h.driveFileId }
            : h
        )
      : [record, ...local];
    localStorage.setItem('voce_history', JSON.stringify(updated));

    // 2. Persist to SQLite
    const db = await getDb();
    if (db) {
      // Check if duplicate entry exists with identical ID or identical source and translated text
      const existing: any[] = await db.select(
        'SELECT id, drive_file_id FROM history WHERE id = $1 OR (source_text = $2 AND translated_text = $3)',
        [record.id, record.sourceText.trim(), record.translatedText.trim()]
      );
      if (existing && existing.length > 0) {
        const existingRow = existing[0];
        const driveIdToKeep = record.driveFileId || existingRow.drive_file_id;
        await db.execute(
          'UPDATE history SET timestamp = $1, drive_file_id = $2 WHERE id = $3',
          [record.timestamp, driveIdToKeep, existingRow.id]
        );
        return;
      }
      await db.execute(
        'INSERT INTO history (id, type, source_text, translated_text, source_lang, target_lang, timestamp, char_count, drive_file_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT(id) DO UPDATE SET source_text = $3, translated_text = $4, timestamp = $7, drive_file_id = $9',
        [
          record.id,
          'translation',
          record.sourceText,
          record.translatedText,
          record.sourceLang || 'Auto-detected',
          record.targetLang || 'English',
          record.timestamp,
          record.charCount || record.sourceText.length,
          record.driveFileId || null,
        ]
      );
    }
  } catch (e) {
    console.error('Failed to insert history to SQLite:', e);
  }
}

export async function deleteHistoryFromDb(id: string): Promise<void> {
  try {
    const local = await loadHistoryFromDb([]);
    const filtered = local.filter((h) => h.id !== id && h.driveFileId !== id);
    localStorage.setItem('voce_history', JSON.stringify(filtered));

    const db = await getDb();
    if (db) {
      await db.execute('DELETE FROM history WHERE id = $1 OR drive_file_id = $1', [id]);
    }
  } catch (e) {
    console.error('Failed to delete history item in SQLite:', e);
  }
}

export async function clearHistoryInDb(): Promise<void> {
  try {
    localStorage.removeItem('voce_history');
    const db = await getDb();
    if (db) {
      await db.execute('DELETE FROM history');
    }
  } catch (e) {
    console.error('Failed to clear history in SQLite:', e);
  }
}

// ----------------------------------------------------------------------------
// BOOKMARKS LOCAL OFFLINE CACHE
// ----------------------------------------------------------------------------

export async function loadBookmarksFromDb(fallback: BookmarkItem[] = []): Promise<BookmarkItem[]> {
  try {
    const db = await getDb();
    if (!db) {
      const local = localStorage.getItem('voce_bookmarks');
      return local ? JSON.parse(local) : fallback;
    }

    const rows = await db.select<{
      id: string;
      title: string | null;
      content: string;
      source: string | null;
      created_at: string;
      drive_file_id: string | null;
    }[]>('SELECT * FROM bookmarks ORDER BY created_at DESC');

    if (rows && rows.length > 0) {
      return rows.map((r) => ({
        id: r.id,
        title: r.title || undefined,
        content: r.content,
        source: r.source || undefined,
        created_at: r.created_at,
        driveFileId: r.drive_file_id || undefined,
      }));
    }
  } catch (e) {
    console.error('Failed to load bookmarks from SQLite:', e);
    const local = localStorage.getItem('voce_bookmarks');
    if (local) return JSON.parse(local);
  }
  return fallback;
}

export async function insertBookmarkToDb(item: BookmarkItem): Promise<void> {
  try {
    const local = await loadBookmarksFromDb();
    const updated = [item, ...local.filter((b) => b.id !== item.id)];
    localStorage.setItem('voce_bookmarks', JSON.stringify(updated));

    const db = await getDb();
    if (db) {
      await db.execute(
        'INSERT INTO bookmarks (id, title, content, source, created_at, drive_file_id) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT(id) DO UPDATE SET title = $2, content = $3, source = $4, created_at = $5, drive_file_id = $6',
        [
          item.id,
          item.title || null,
          item.content,
          item.source || null,
          item.created_at,
          item.driveFileId || null,
        ]
      );
    }
  } catch (e) {
    console.error('Failed to insert bookmark to SQLite:', e);
  }
}

export async function deleteBookmarkFromDb(id: string): Promise<void> {
  try {
    const local = await loadBookmarksFromDb();
    const filtered = local.filter((b) => b.id !== id && b.driveFileId !== id);
    localStorage.setItem('voce_bookmarks', JSON.stringify(filtered));

    const db = await getDb();
    if (db) {
      await db.execute('DELETE FROM bookmarks WHERE id = $1 OR drive_file_id = $1', [id]);
    }
  } catch (e) {
    console.error('Failed to delete bookmark in SQLite:', e);
  }
}

export async function syncBookmarksToDb(items: BookmarkItem[]): Promise<void> {
  try {
    localStorage.setItem('voce_bookmarks', JSON.stringify(items));
    const db = await getDb();
    if (db) {
      for (const item of items) {
        await db.execute(
          'INSERT INTO bookmarks (id, title, content, source, created_at, drive_file_id) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT(id) DO UPDATE SET title = $2, content = $3, source = $4, created_at = $5, drive_file_id = $6',
          [
            item.id,
            item.title || null,
            item.content,
            item.source || null,
            item.created_at,
            item.driveFileId || null,
          ]
        );
      }
    }
  } catch (e) {
    console.error('Failed to sync bookmarks to SQLite:', e);
  }
}

export async function syncHistoryToDb(records: TranslationRecord[]): Promise<void> {
  try {
    localStorage.setItem('voce_history', JSON.stringify(records));
    const db = await getDb();
    if (db) {
      for (const record of records) {
        const existing: any[] = await db.select(
          'SELECT id, drive_file_id FROM history WHERE id = $1 OR (source_text = $2 AND translated_text = $3)',
          [record.id, record.sourceText.trim(), record.translatedText.trim()]
        );
        if (existing && existing.length > 0) {
          const existingRow = existing[0];
          const driveIdToKeep = record.driveFileId || existingRow.drive_file_id;
          await db.execute(
            'UPDATE history SET timestamp = $1, drive_file_id = $2 WHERE id = $3',
            [record.timestamp, driveIdToKeep, existingRow.id]
          );
        } else {
          await db.execute(
            'INSERT INTO history (id, type, source_text, translated_text, source_lang, target_lang, timestamp, char_count, drive_file_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT(id) DO UPDATE SET source_text = $3, translated_text = $4, timestamp = $7, drive_file_id = $9',
            [
              record.id,
              'translation',
              record.sourceText,
              record.translatedText,
              record.sourceLang || 'Auto-detected',
              record.targetLang || 'English',
              record.timestamp,
              record.charCount || record.sourceText.length,
              record.driveFileId || null,
            ]
          );
        }
      }
    }
  } catch (e) {
    console.error('Failed to sync history to SQLite:', e);
  }
}

export async function clearBookmarksInDb(): Promise<void> {
  try {
    localStorage.removeItem('voce_bookmarks');
    const db = await getDb();
    if (db) {
      await db.execute('DELETE FROM bookmarks');
    }
  } catch (e) {
    console.error('Failed to clear bookmarks in SQLite:', e);
  }
}

// ----------------------------------------------------------------------------
// DICTATIONS LOCAL OFFLINE STATS & CACHE
// ----------------------------------------------------------------------------

export async function loadDictationMetricsFromDb(): Promise<{ totalWords: number; totalDictations: number }> {
  try {
    const db = await getDb();
    if (db) {
      const rows = await db.select<{ total_words: number; total_dictations: number }[]>(
        'SELECT COALESCE(SUM(word_count), 0) AS total_words, COUNT(*) AS total_dictations FROM dictations'
      );
      if (rows && rows.length > 0) {
        const res = {
          totalWords: Number(rows[0].total_words || 0),
          totalDictations: Number(rows[0].total_dictations || 0),
        };
        localStorage.setItem('voce_dictation_metrics', JSON.stringify(res));
        return res;
      }
    }
    const local = localStorage.getItem('voce_dictation_metrics');
    if (local) return JSON.parse(local);
  } catch (e) {
    console.error('Failed to load dictation metrics from SQLite:', e);
    const local = localStorage.getItem('voce_dictation_metrics');
    if (local) return JSON.parse(local);
  }
  return { totalWords: 0, totalDictations: 0 };
}

export async function insertDictationToDb(record: DictationRecord): Promise<void> {
  try {
    const db = await getDb();
    if (db) {
      await db.execute(
        'INSERT INTO dictations (id, word_count, timestamp, duration_ms) VALUES ($1, $2, $3, $4) ON CONFLICT(id) DO UPDATE SET word_count = $2, timestamp = $3, duration_ms = $4',
        [
          record.id,
          record.wordCount,
          record.timestamp,
          record.durationMs || 0,
        ]
      );
    }
    // Update local cache
    const current = await loadDictationMetricsFromDb();
    localStorage.setItem(
      'voce_dictation_metrics',
      JSON.stringify({
        totalWords: current.totalWords + record.wordCount,
        totalDictations: current.totalDictations + 1,
      })
    );
  } catch (e) {
    console.error('Failed to insert dictation into SQLite:', e);
  }
}

export async function clearDictationsInDb(): Promise<void> {
  try {
    localStorage.removeItem('voce_dictation_metrics');
    const db = await getDb();
    if (db) {
      await db.execute('DELETE FROM dictations');
    }
  } catch (e) {
    console.error('Failed to clear dictations in SQLite:', e);
  }
}

export async function wipeAllLocalDataFromDb(): Promise<void> {
  try {
    localStorage.removeItem('voce_bookmarks');
    localStorage.removeItem('voce_history');
    localStorage.removeItem('voce_dictation_metrics');
    const db = await getDb();
    if (db) {
      await db.execute('DELETE FROM bookmarks');
      await db.execute('DELETE FROM history');
      await db.execute('DELETE FROM dictations');
    }
    console.log('[Voce Privacy] All local SQLite bookmarks, history, and dictations successfully wiped.');
  } catch (e) {
    console.error('Failed to wipe all local data from SQLite:', e);
  }
}

