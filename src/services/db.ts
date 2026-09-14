import Database from '@tauri-apps/plugin-sql';
import { TranslationRecord, UserSettings } from '../types';

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
