import Database from '@tauri-apps/plugin-sql';
import { TranslationRecord, UserSettings, BookmarkItem } from '../types';

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

export async function loadHistoryFromDb(fallback: TranslationRecord[]): Promise<TranslationRecord[]> {
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
    }[]>('SELECT * FROM history ORDER BY timestamp DESC');

    if (rows && rows.length > 0) {
      return rows.map((r) => ({
        id: r.id,
        timestamp: r.timestamp,
        sourceText: r.source_text,
        sourceLang: r.source_lang || 'Auto-detected',
        translatedText: r.translated_text,
        targetLang: r.target_lang || 'English',
        charCount: r.char_count || r.source_text.length,
      }));
    }
  } catch (e) {
    console.error('Failed to load history from SQLite:', e);
  }
  return fallback;
}

export async function insertHistoryToDb(record: TranslationRecord): Promise<void> {
  try {
    const db = await getDb();
    if (db) {
      await db.execute(
        'INSERT INTO history (id, type, source_text, translated_text, source_lang, target_lang, timestamp, char_count) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [
          record.id,
          'translation',
          record.sourceText,
          record.translatedText,
          record.sourceLang,
          record.targetLang,
          record.timestamp,
          record.charCount,
        ]
      );
    }
  } catch (e) {
    console.error('Failed to insert history to SQLite:', e);
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
        await db.execute(
          'INSERT INTO history (id, type, source_text, translated_text, source_lang, target_lang, timestamp, char_count) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT(id) DO UPDATE SET source_text = $3, translated_text = $4',
          [
            record.id,
            'translation',
            record.sourceText,
            record.translatedText,
            record.sourceLang || 'Auto-detected',
            record.targetLang || 'English',
            record.timestamp,
            record.charCount || record.sourceText.length,
          ]
        );
      }
    }
  } catch (e) {
    console.error('Failed to sync history to SQLite:', e);
  }
}
