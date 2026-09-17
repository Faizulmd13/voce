use crate::audio::AudioRecorder;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranslationPayload {
    pub source_text: String,
    pub target_lang: String,
    pub source_lang: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DictationPayload {
    pub audio_buffer_path: String,
    pub model: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranslationEventData {
    pub source_text: String,
    pub translated_text: String,
    pub source_lang: String,
    pub target_lang: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub name: String,
    pub email: String,
    #[serde(alias = "avatar_url")]
    pub avatar_url: Option<String>,
    #[serde(alias = "is_authenticated")]
    pub is_authenticated: bool,
    #[serde(alias = "google_drive_configured")]
    pub google_drive_configured: bool,
    #[serde(alias = "voce_folder_id")]
    pub voce_folder_id: Option<String>,
    #[serde(alias = "bookmarks_folder_id")]
    pub bookmarks_folder_id: Option<String>,
    #[serde(alias = "translations_folder_id")]
    pub translations_folder_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkItem {
    pub id: String,
    pub title: Option<String>,
    pub content: String,
    pub source: Option<String>,
    #[serde(alias = "created_at", alias = "createdAt")]
    pub created_at: String,
    #[serde(alias = "drive_file_id", alias = "driveFileId")]
    pub drive_file_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkPayload {
    pub id: String,
    pub title: Option<String>,
    pub content: String,
    pub source: Option<String>,
    #[serde(alias = "created_at", alias = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranslationRecordPayload {
    pub id: String,
    pub timestamp: String,
    #[serde(alias = "source_text", alias = "sourceText")]
    pub source_text: String,
    #[serde(alias = "source_lang", alias = "sourceLang")]
    pub source_lang: String,
    #[serde(alias = "translated_text", alias = "translatedText")]
    pub translated_text: String,
    #[serde(alias = "target_lang", alias = "targetLang")]
    pub target_lang: String,
    #[serde(alias = "char_count", alias = "charCount")]
    pub char_count: usize,
    #[serde(alias = "drive_file_id", alias = "driveFileId")]
    pub drive_file_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranslationSyncItem {
    pub id: String,
    pub source_text: String,
    pub translated_text: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CloudSyncResult {
    pub bookmarks: Vec<BookmarkItem>,
    pub translations: Vec<TranslationRecordPayload>,
}

pub struct AppHotkeys {
    pub stt_shortcut: Mutex<String>,
    pub translate_shortcut: Mutex<String>,
    pub bookmark_shortcut: Mutex<String>,
}

pub struct AppAudioState {
    pub recorder: Mutex<AudioRecorder>,
}

pub struct AppSettingsState {
    pub target_language: Mutex<String>,
    pub auto_paste: Mutex<bool>,
}
