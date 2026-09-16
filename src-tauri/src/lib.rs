pub mod audio;

use audio::AudioRecorder;
use enigo::{Direction, Enigo, Key, Keyboard, Settings as EnigoSettings};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, State,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_sql::{Migration, MigrationKind};
use tauri_plugin_store::StoreExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const OAUTH_REDIRECT_PORT: u16 = 14321;
const OAUTH_REDIRECT_URI: &str = "http://127.0.0.1:14321";

fn get_google_client_id() -> String {
    let _ = dotenvy::dotenv();
    let _ = dotenvy::from_path("../.env");
    let _ = dotenvy::from_path(".env");
    std::env::var("GOOGLE_CLIENT_ID")
        .or_else(|_| std::env::var("VITE_GOOGLE_CLIENT_ID"))
        .unwrap_or_else(|_| option_env!("GOOGLE_CLIENT_ID").unwrap_or("").to_string())
}

fn get_google_client_secret() -> String {
    let _ = dotenvy::dotenv();
    let _ = dotenvy::from_path("../.env");
    let _ = dotenvy::from_path(".env");
    std::env::var("GOOGLE_CLIENT_SECRET")
        .or_else(|_| std::env::var("VITE_GOOGLE_CLIENT_SECRET"))
        .unwrap_or_else(|_| option_env!("GOOGLE_CLIENT_SECRET").unwrap_or("").to_string())
}

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

#[tauri::command]
fn get_system_daemon_status() -> String {
    "active".to_string()
}

/// Helper to fetch the user's Groq API key securely from the local store or env override
fn get_groq_api_key(app: &AppHandle) -> Result<String, String> {
    if let Ok(store) = app.store("store.json") {
        if let Some(val) = store.get("groq_api_key") {
            if let Some(s) = val.as_str() {
                let trimmed = s.trim();
                if !trimmed.is_empty() {
                    return Ok(trimmed.to_string());
                }
            }
        }
    }
    if let Ok(env_key) = std::env::var("GROQ_API_KEY") {
        let trimmed = env_key.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    Err("No Groq API key configured. Please enter your API key on the welcome screen or in Settings.".to_string())
}

#[tauri::command]
fn get_stored_api_key(app: AppHandle) -> Result<Option<String>, String> {
    if let Ok(store) = app.store("store.json") {
        if let Some(val) = store.get("groq_api_key") {
            if let Some(s) = val.as_str() {
                let trimmed = s.trim();
                if !trimmed.is_empty() {
                    return Ok(Some(trimmed.to_string()));
                }
            }
        }
    }
    if let Ok(env_key) = std::env::var("GROQ_API_KEY") {
        let trimmed = env_key.trim();
        if !trimmed.is_empty() {
            return Ok(Some(trimmed.to_string()));
        }
    }
    Ok(None)
}

#[tauri::command]
fn save_groq_api_key(app: AppHandle, api_key: String) -> Result<(), String> {
    let store = app.store("store.json").map_err(|e| format!("Store error: {}", e))?;
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        let _ = store.delete("groq_api_key");
        println!("[Voce Auth] Groq API key removed from local store.");
    } else {
        store.set("groq_api_key", serde_json::Value::String(trimmed.to_string()));
        println!("[Voce Auth] Groq API key securely saved to local store.");
    }
    store.save().map_err(|e| format!("Failed to persist store: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn validate_groq_api_key(api_key: String) -> Result<bool, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Ok(false);
    }
    let client = reqwest::Client::new();
    let res = client
        .get("https://api.groq.com/openai/v1/models")
        .header("Authorization", format!("Bearer {}", key))
        .send()
        .await
        .map_err(|e| format!("Network request failed: {}", e))?;

    Ok(res.status().is_success())
}

fn open_browser_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", url])
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    open_browser_url(&url)
}

// Smart Screen Boundary Detection & Cursor Placement
fn position_window_at_cursor(app: &AppHandle, label: &str, offset_y: i32) {
    if let Some(window) = app.get_webview_window(label) {
        let (cursor_x, cursor_y) = match app.cursor_position() {
            Ok(pos) => (pos.x as i32, pos.y as i32),
            Err(_) => (100, 100),
        };

        let window_size = window
            .outer_size()
            .unwrap_or(tauri::PhysicalSize { width: 400, height: 220 });
        let win_w = window_size.width as i32;
        let win_h = window_size.height as i32;

        // Fetch active monitor bounds
        let (mon_x, mon_y, mon_w, mon_h) = if let Ok(Some(mon)) = window.current_monitor() {
            let pos = mon.position();
            let size = mon.size();
            (pos.x, pos.y, size.width as i32, size.height as i32)
        } else {
            (0, 0, 1920, 1080)
        };

        // Base positioning: centered under cursor horizontally, offset vertically
        let mut target_x = cursor_x - (win_w / 2);
        let mut target_y = cursor_y + offset_y;

        // Boundary Check 1: If cursor_y + window_height + 20px exceeds monitor bottom, position ABOVE cursor
        if target_y + win_h + 20 > mon_y + mon_h {
            target_y = cursor_y - win_h - offset_y;
        }

        // Boundary Check 2: If target_y overflows monitor top, clamp
        if target_y < mon_y + 10 {
            target_y = mon_y + 10;
        } else if target_y + win_h > mon_y + mon_h - 10 {
            target_y = mon_y + mon_h - win_h - 10;
        }

        // Boundary Check 3: If cursor_x + window_width exceeds monitor right edge, shift left
        if target_x + win_w > mon_x + mon_w - 10 {
            target_x = mon_x + mon_w - win_w - 10;
        }

        // Boundary Check 4: If target_x overflows monitor left edge, clamp
        if target_x < mon_x + 10 {
            target_x = mon_x + 10;
        }

        let _ = window.set_position(PhysicalPosition::new(target_x, target_y));
        let _ = window.set_always_on_top(true);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn show_overlay(app: AppHandle, label: String, offset_y: Option<i32>) -> Result<(), String> {
    position_window_at_cursor(&app, &label, offset_y.unwrap_or(20));
    Ok(())
}

#[tauri::command]
fn hide_overlay(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.hide();
    }
    Ok(())
}

#[tauri::command]
fn start_audio_recording(audio_state: State<'_, AppAudioState>) -> Result<(), String> {
    if let Ok(mut rec) = audio_state.recorder.lock() {
        rec.start_recording()
    } else {
        Err("Failed to acquire audio recorder lock".to_string())
    }
}

#[tauri::command]
fn stop_audio_recording(audio_state: State<'_, AppAudioState>) -> Result<String, String> {
    if let Ok(mut rec) = audio_state.recorder.lock() {
        let path = rec.stop_recording()?;
        Ok(path.to_string_lossy().to_string())
    } else {
        Err("Failed to acquire audio recorder lock".to_string())
    }
}

#[tauri::command]
async fn execute_local_transcription(
    app: AppHandle,
    payload: DictationPayload,
) -> Result<String, String> {
    let wav_path = payload.audio_buffer_path.clone();
    println!(
        "[Groq STT] Executing cloud transcription on WAV buffer: {}",
        wav_path
    );

    let groq_key = get_groq_api_key(&app)?;

    let file_bytes = std::fs::read(&wav_path)
        .map_err(|e| format!("Failed to read WAV file at {}: {}", wav_path, e))?;

    let part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name("dictation.wav")
        .mime_str("audio/wav")
        .map_err(|e| format!("Failed to create multipart audio part: {}", e))?;

    let form = reqwest::multipart::Form::new()
        .text("model", "whisper-large-v3-turbo")
        .part("file", part);

    let client = reqwest::Client::new();
    let res = client
        .post("https://api.groq.com/openai/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {}", groq_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Groq STT network request failed: {}", e))?;

    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        eprintln!("[Groq STT] API error response: {}", err_text);
        return Err(format!("Groq STT error: {}", err_text));
    }

    let json: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse Groq STT response: {}", e))?;

    let transcript = json["text"].as_str().unwrap_or("").trim().to_string();

    println!("[Groq STT] Transcription result: \"{}\"", transcript);
    let _ = app.emit("transcription-completed", serde_json::json!({ "text": &transcript }));
    Ok(transcript)
}

#[tauri::command]
fn get_clipboard_text() -> Result<String, String> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Clipboard error: {}", e))?;
    clipboard
        .get_text()
        .map_err(|e| format!("Failed to read clipboard text: {}", e))
}

#[tauri::command]
async fn execute_local_translation(
    app: AppHandle,
    payload: TranslationPayload,
) -> Result<String, String> {
    let text = payload.source_text.trim().to_string();
    if text.is_empty() {
        return Ok(String::new());
    }

    let target_lang = payload.target_lang.trim();
    let source_lang_hint = payload.source_lang.as_deref().unwrap_or("auto");

    println!(
        "[Groq Translation] Translating from [{}] into [{}]: {}",
        source_lang_hint, target_lang, text
    );

    let groq_key = get_groq_api_key(&app)?;

    let system_prompt = "You are a professional translator. Translate the user's text into the requested target language. Output ONLY the translated text, no conversational filler.";

    let user_prompt = if source_lang_hint.eq_ignore_ascii_case("auto") || source_lang_hint.is_empty() {
        format!("Target Language: {}\n\nText:\n{}", target_lang, text)
    } else {
        format!("Source Language: {}\nTarget Language: {}\n\nText:\n{}", source_lang_hint, target_lang, text)
    };

    let candidate_models = [
        "llama-3.1-8b-instant",
        "openai/gpt-oss-120b",
        "llama-3.3-70b-versatile",
        "llama-3.1-70b-versatile",
        "gemma2-9b-it",
        "mixtral-8x7b-32768",
    ];

    let client = reqwest::Client::new();
    let mut last_err = String::new();

    for model_name in candidate_models {
        let request_body = serde_json::json!({
            "model": model_name,
            "messages": [
                {
                    "role": "system",
                    "content": system_prompt
                },
                {
                    "role": "user",
                    "content": user_prompt
                }
            ],
            "temperature": 0.2,
            "max_tokens": 2048
        });

        let res = client
            .post("https://api.groq.com/openai/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", groq_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await;

        match res {
            Ok(response) => {
                let status = response.status();
                if status.is_success() {
                    if let Ok(json) = response.json::<serde_json::Value>().await {
                        if let Some(content) = json["choices"][0]["message"]["content"].as_str() {
                            let translated_text = content.trim().to_string();
                            println!("[Groq Translation] Success using model '{}': \"{}\"", model_name, translated_text);
                            let _ = app.emit("translation-completed", serde_json::json!({
                                "source_text": &text,
                                "translated_text": &translated_text,
                                "source_lang": source_lang_hint,
                                "target_lang": target_lang,
                            }));

                            // Live background upload to Google Drive if authenticated
                            let app_clone = app.clone();
                            let text_clone = text.clone();
                            let translated_clone = translated_text.clone();
                            tokio::spawn(async move {
                                if let Ok(access_token) = get_valid_google_access_token(&app_clone).await {
                                    let store = app_clone.store("store.json").ok();
                                    let mut translations_folder_id = None;
                                    if let Some(ref st) = store {
                                        if let Some(val) = st.get("google_user_profile") {
                                            if let Ok(p) = serde_json::from_value::<UserProfile>(val) {
                                                translations_folder_id = p.translations_folder_id;
                                            }
                                        }
                                    }
                                    let client = reqwest::Client::new();
                                    let folder_id = match translations_folder_id {
                                        Some(id) => id,
                                        None => {
                                            if let Ok(voce_id) = ensure_drive_folder(&client, &access_token, "Voce", None).await {
                                                ensure_drive_folder(&client, &access_token, "translations", Some(&voce_id)).await.unwrap_or_default()
                                            } else {
                                                String::new()
                                            }
                                        }
                                    };
                                    if !folder_id.is_empty() {
                                        let id = format!("trn-{}", chrono::Local::now().timestamp_millis());
                                        let _ = upload_translation_txt_to_drive(&client, &access_token, &folder_id, &id, &text_clone, &translated_clone).await;
                                        println!("[Google Drive Live] Live translation '{}' uploaded to Drive.", id);
                                    }
                                }
                            });

                            return Ok(translated_text);
                        }
                    }
                } else {
                    let err_text = response.text().await.unwrap_or_default();
                    eprintln!("[Groq Translation] Model '{}' returned {}: {}", model_name, status, err_text);
                    if err_text.contains("model_not_found") || err_text.contains("does not exist") || err_text.contains("model_decommissioned") {
                        last_err = format!("Model '{}' not available: {}", model_name, err_text);
                        continue;
                    } else {
                        return Err(format!("Groq API error ({}): {}", status, err_text));
                    }
                }
            }
            Err(e) => {
                last_err = format!("Network error connecting to Groq: {}", e);
            }
        }
    }

    Err(format!("Groq Translation failed across all candidate models. Last error: {}", last_err))
}

#[tauri::command]
fn inject_text_to_cursor(app: AppHandle, text: String) -> Result<(), String> {
    println!("[OS Hook] Injecting text to active cursor: {}", text);

    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Clipboard error: {}", e))?;
    clipboard
        .set_text(&text)
        .map_err(|e| format!("Failed to set clipboard text: {}", e))?;

    if let Some(stt_win) = app.get_webview_window("stt-overlay") {
        let _ = stt_win.hide();
    }
    if let Some(trn_win) = app.get_webview_window("translate-overlay") {
        let _ = trn_win.hide();
    }
    if let Some(bm_win) = app.get_webview_window("bookmark-overlay") {
        let _ = bm_win.hide();
    }

    // Yield OS window focus back to the active underlying app
    std::thread::sleep(Duration::from_millis(60));

    let mut enigo =
        Enigo::new(&EnigoSettings::default()).map_err(|e| format!("Enigo error: {:?}", e))?;

    #[cfg(target_os = "windows")]
    {
        let _ = enigo.key(Key::Control, Direction::Press);
        std::thread::sleep(Duration::from_millis(40));  
        let _ = enigo.key(Key::Unicode('v'), Direction::Click); 
        std::thread::sleep(Duration::from_millis(20)); 
        let _ = enigo.key(Key::Control, Direction::Release);
    }

    #[cfg(target_os = "macos")]
    {
        let _ = enigo.key(Key::Meta, Direction::Press);
        let _ = enigo.key(Key::Unicode('v'), Direction::Click);
        let _ = enigo.key(Key::Meta, Direction::Release);
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let _ = enigo.key(Key::Control, Direction::Press);
        let _ = enigo.key(Key::Unicode('v'), Direction::Click);
        let _ = enigo.key(Key::Control, Direction::Release);
    }

    Ok(())
}

// ----------------------------------------------------------------------------
// GOOGLE OAUTH & GOOGLE DRIVE INTEGRATION
// ----------------------------------------------------------------------------

fn get_current_timestamp_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Retrieves a valid Google Access Token, refreshing it via the refresh token if expired.
async fn get_valid_google_access_token(app: &AppHandle) -> Result<String, String> {
    let store = app.store("store.json").map_err(|e| format!("Store error: {}", e))?;
    
    let access_token = store
        .get("google_access_token")
        .and_then(|v| v.as_str().map(|s| s.to_string()));
    let refresh_token = store
        .get("google_refresh_token")
        .and_then(|v| v.as_str().map(|s| s.to_string()));
    let expiry = store
        .get("google_token_expiry")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let now = get_current_timestamp_secs();

    if let Some(token) = access_token {
        if now + 60 < expiry {
            return Ok(token);
        }
    }

    if let Some(ref_token) = refresh_token {
        println!("[Google OAuth] Refreshing expired access token...");
        let client_id = get_google_client_id();
        let client_secret = get_google_client_secret();
        let body = format!(
            "client_id={}&client_secret={}&refresh_token={}&grant_type=refresh_token",
            client_id, client_secret, ref_token
        );
        let client = reqwest::Client::new();
        let res = client
            .post("https://oauth2.googleapis.com/token")
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .await
            .map_err(|e| format!("Failed to refresh Google token: {}", e))?;

        if !res.status().is_success() {
            let err_text = res.text().await.unwrap_or_default();
            return Err(format!("Google token refresh failed: {}", err_text));
        }

        let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        if let Some(new_access_token) = json["access_token"].as_str() {
            let expires_in = json["expires_in"].as_u64().unwrap_or(3600);
            let new_expiry = now + expires_in;

            store.set("google_access_token", serde_json::Value::String(new_access_token.to_string()));
            store.set("google_token_expiry", serde_json::Value::Number(serde_json::Number::from(new_expiry)));
            let _ = store.save();
            return Ok(new_access_token.to_string());
        }
    }

    Err("Not authenticated with Google. Please sign in via Settings.".to_string())
}

fn url_encode(input: &str) -> String {
    let mut encoded = String::new();
    for byte in input.bytes() {
        match byte {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            b' ' => encoded.push_str("%20"),
            _ => {
                encoded.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    encoded
}

/// Query or create a specific folder in Google Drive
async fn ensure_drive_folder(
    client: &reqwest::Client,
    access_token: &str,
    folder_name: &str,
    parent_id: Option<&str>,
) -> Result<String, String> {
    let query_param = match parent_id {
        Some(pid) => format!(
            "name = '{}' and '{}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
            folder_name, pid
        ),
        None => format!(
            "name = '{}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
            folder_name
        ),
    };

    let search_url = format!(
        "https://www.googleapis.com/drive/v3/files?q={}&fields=files(id,name,trashed)&spaces=drive",
        url_encode(&query_param)
    );

    let search_res = client
        .get(&search_url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("Drive folder search failed: {}", e))?;

    if search_res.status().is_success() {
        let json: serde_json::Value = search_res.json().await.unwrap_or_default();
        if let Some(files) = json["files"].as_array() {
            if let Some(first) = files.first() {
                if let Some(id) = first["id"].as_str() {
                    println!("[Google Drive] Found existing folder '{}': {}", folder_name, id);
                    return Ok(id.to_string());
                }
            }
        }
    }

    // Folder doesn't exist, create it
    println!("[Google Drive] Creating folder '{}'...", folder_name);
    let mut body = serde_json::json!({
        "name": folder_name,
        "mimeType": "application/vnd.google-apps.folder"
    });

    if let Some(pid) = parent_id {
        body["parents"] = serde_json::json!([pid]);
    }

    let create_res = client
        .post("https://www.googleapis.com/drive/v3/files")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to create Drive folder: {}", e))?;

    if !create_res.status().is_success() {
        let err = create_res.text().await.unwrap_or_default();
        return Err(format!("Google Drive folder creation error: {}", err));
    }

    let json: serde_json::Value = create_res.json().await.map_err(|e| e.to_string())?;
    if let Some(id) = json["id"].as_str() {
        println!("[Google Drive] Successfully created folder '{}': {}", folder_name, id);
        return Ok(id.to_string());
    }

    Err(format!("Failed to retrieve created folder ID for '{}'", folder_name))
}

#[tauri::command]
async fn start_google_oauth(app: AppHandle) -> Result<UserProfile, String> {
    println!("[Google OAuth] Starting loopback listener on port {}...", OAUTH_REDIRECT_PORT);

    // Bind temporary TCP listener to 127.0.0.1:14321
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", OAUTH_REDIRECT_PORT))
        .await
        .map_err(|e| format!("Failed to bind loopback server on port {}: {}", OAUTH_REDIRECT_PORT, e))?;

    let client_id = get_google_client_id();
    let client_secret = get_google_client_secret();

    if client_id.is_empty() || client_secret.is_empty() {
        return Err("Google OAuth credentials missing. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env".to_string());
    }

    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope=openid%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.profile%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.email%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.file&access_type=offline&prompt=consent",
        client_id,
        "http%3A%2F%2F127.0.0.1%3A14321"
    );

    println!("[Google OAuth] Launching browser consent flow: {}", auth_url);
    let _ = open_browser_url(&auth_url);

    // Wait for the browser redirect with timeout (120s)
    let (mut stream, _) = tokio::time::timeout(Duration::from_secs(120), listener.accept())
        .await
        .map_err(|_| "OAuth sign-in timed out after 2 minutes.".to_string())?
        .map_err(|e| format!("TCP accept failed: {}", e))?;

    let mut buf = [0u8; 4096];
    let bytes_read = stream
        .read(&mut buf)
        .await
        .map_err(|e| format!("Failed to read OAuth response: {}", e))?;
    let req_str = String::from_utf8_lossy(&buf[..bytes_read]);

    // Extract authorization code from GET request
    // Example: GET /?code=4/0A...&scope=... HTTP/1.1
    let mut auth_code = String::new();
    if let Some(pos) = req_str.find("code=") {
        let after_code = &req_str[pos + 5..];
        let end_pos = after_code.find('&').or_else(|| after_code.find(' ')).unwrap_or(after_code.len());
        let raw_code = &after_code[..end_pos];
        auth_code = raw_code.replace("%2F", "/").replace("%20", " ");
    }

    // Render HTML response back to user's browser
    let html_body = r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Voce - Authenticated</title>
</head>
<body style="background:#0a0a0a;color:#10b981;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
  <div style="text-align:center;padding:2.5rem;background:#171717;border:1px solid #262626;border-radius:16px;box-shadow:0 20px 25px -5px rgba(0,0,0,0.5);max-width:380px;">
    <div style="width:48px;height:48px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);border-radius:12px;display:flex;align-items:center;justify-content:center;margin:0 auto 1.25rem auto;color:#10b981;font-size:24px;font-weight:bold;">&#10003;</div>
    <h2 style="font-size:1.25rem;font-weight:600;color:#f5f5f5;margin:0 0 0.5rem 0;">Voce Authenticated</h2>
    <p style="color:#a3a3a3;font-size:0.875rem;line-height:1.5;margin:0;">Google Drive sync is ready. You can now close this tab and return to Voce.</p>
  </div>
</body>
</html>"#;

    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html_body.len(),
        html_body
    );

    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;

    if auth_code.is_empty() {
        return Err("Authorization code not found in browser callback.".to_string());
    }

    println!("[Google OAuth] Exchanging authorization code for tokens (with client secret)...");
    let token_body = format!(
        "client_id={}&client_secret={}&code={}&grant_type=authorization_code&redirect_uri={}",
        client_id, client_secret, auth_code, OAUTH_REDIRECT_URI
    );

    let client = reqwest::Client::new();
    let token_res = client
        .post("https://oauth2.googleapis.com/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(token_body)
        .send()
        .await
        .map_err(|e| format!("Token request error: {}", e))?;

    if !token_res.status().is_success() {
        let err = token_res.text().await.unwrap_or_default();
        return Err(format!("Google token exchange failed: {}", err));
    }

    let token_json: serde_json::Value = token_res.json().await.map_err(|e| e.to_string())?;
    let access_token = token_json["access_token"]
        .as_str()
        .ok_or_else(|| "Missing access_token in Google response".to_string())?
        .to_string();
    let refresh_token = token_json["refresh_token"]
        .as_str()
        .map(|s| s.to_string());
    let expires_in = token_json["expires_in"].as_u64().unwrap_or(3600);
    let expiry = get_current_timestamp_secs() + expires_in;

    // Fetch user profile from v3/userinfo
    println!("[Google OAuth] Fetching user profile from https://www.googleapis.com/oauth2/v3/userinfo...");
    let userinfo_res = client
        .get("https://www.googleapis.com/oauth2/v3/userinfo")
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("Userinfo request failed: {}", e))?;

    let userinfo_json: serde_json::Value = userinfo_res.json().await.map_err(|e| e.to_string())?;
    let name = userinfo_json["name"].as_str().unwrap_or("Voce User").to_string();
    let email = userinfo_json["email"].as_str().unwrap_or("").to_string();
    let avatar_url = userinfo_json["picture"].as_str().map(|s| s.to_string());

    println!("[Google OAuth] Logged in as: {} ({})", name, email);

    // Initialize Google Drive folders
    let voce_folder_id = ensure_drive_folder(&client, &access_token, "Voce", None).await.ok();
    let mut translations_folder_id = None;
    let mut bookmarks_folder_id = None;

    if let Some(ref v_id) = voce_folder_id {
        translations_folder_id = ensure_drive_folder(&client, &access_token, "translations", Some(v_id)).await.ok();
        bookmarks_folder_id = ensure_drive_folder(&client, &access_token, "bookmarks", Some(v_id)).await.ok();
    }

    // RETROACTIVE LOCAL SYNC: Read local store for existing anonymous bookmarks & translations
    println!("[Google Drive] Performing retroactive sync of local offline records...");
    if let Ok(store) = app.store("store.json") {
        if let Some(ref b_folder) = bookmarks_folder_id {
            if let Some(bms_val) = store.get("local_bookmarks") {
                if let Ok(bms) = serde_json::from_value::<Vec<BookmarkPayload>>(bms_val) {
                    for bm in bms {
                        println!("[Google Drive Sync] Retroactive upload for bookmark '{}'...", bm.id);
                        let _ = upload_bookmark_txt_to_drive(
                            &client,
                            &access_token,
                            b_folder,
                            &bm.id,
                            bm.title.as_deref(),
                            bm.source.as_deref(),
                            &bm.content,
                        )
                        .await;
                    }
                }
            }
        }

        if let Some(ref t_folder) = translations_folder_id {
            if let Some(trns_val) = store.get("local_history") {
                if let Ok(trns) = serde_json::from_value::<Vec<serde_json::Value>>(trns_val) {
                    for trn in trns {
                        let id = trn["id"].as_str().unwrap_or("trn");
                        let src = trn["source_text"].as_str().or_else(|| trn["sourceText"].as_str()).unwrap_or("");
                        let res = trn["translated_text"].as_str().or_else(|| trn["translatedText"].as_str()).unwrap_or("");
                        if !src.is_empty() && !res.is_empty() {
                            println!("[Google Drive Sync] Retroactive upload for translation '{}'...", id);
                            let _ = upload_translation_txt_to_drive(
                                &client,
                                &access_token,
                                t_folder,
                                id,
                                src,
                                res,
                            )
                            .await;
                        }
                    }
                }
            }
        }
    }

    // Persist credentials & profile to Tauri store
    let store = app.store("store.json").map_err(|e| format!("Store error: {}", e))?;
    store.set("google_access_token", serde_json::Value::String(access_token.clone()));
    if let Some(ref r) = refresh_token {
        store.set("google_refresh_token", serde_json::Value::String(r.clone()));
    }
    store.set("google_token_expiry", serde_json::Value::Number(serde_json::Number::from(expiry)));

    let profile = UserProfile {
        name,
        email,
        avatar_url,
        is_authenticated: true,
        google_drive_configured: bookmarks_folder_id.is_some(),
        voce_folder_id,
        bookmarks_folder_id,
        translations_folder_id,
    };

    store.set("google_user_profile", serde_json::to_value(&profile).unwrap_or_default());
    let _ = store.save();

    let _ = app.emit("profile-updated", &profile);
    let _ = app.emit("oauth-login-success", &profile);
    Ok(profile)
}

#[tauri::command]
fn get_google_user_profile(app: AppHandle) -> Result<UserProfile, String> {
    if let Ok(store) = app.store("store.json") {
        if let Some(val) = store.get("google_user_profile") {
            if let Ok(profile) = serde_json::from_value::<UserProfile>(val) {
                return Ok(profile);
            }
        }
    }
    Ok(UserProfile {
        name: "Anonymous User".to_string(),
        email: "Not signed in".to_string(),
        avatar_url: None,
        is_authenticated: false,
        google_drive_configured: false,
        voce_folder_id: None,
        bookmarks_folder_id: None,
        translations_folder_id: None,
    })
}

#[tauri::command]
fn google_logout(app: AppHandle) -> Result<UserProfile, String> {
    if let Ok(store) = app.store("store.json") {
        let _ = store.delete("google_access_token");
        let _ = store.delete("google_refresh_token");
        let _ = store.delete("google_token_expiry");
        let _ = store.delete("google_user_profile");
        let _ = store.save();
    }

    println!("[Google Auth] User logged out, local OAuth credentials purged.");
    let anonymous_profile = UserProfile {
        name: "Anonymous User".to_string(),
        email: "Not signed in".to_string(),
        avatar_url: None,
        is_authenticated: false,
        google_drive_configured: false,
        voce_folder_id: None,
        bookmarks_folder_id: None,
        translations_folder_id: None,
    };
    let _ = app.emit("profile-updated", &anonymous_profile);
    let _ = app.emit("oauth-logout-success", &anonymous_profile);
    Ok(anonymous_profile)
}

fn generate_timestamp_filename() -> String {
    chrono::Local::now().format("%Y-%m-%d_%H-%M-%S.txt").to_string()
}

fn parse_timestamp_from_filename(filename: &str, fallback_created_time: &str) -> String {
    if let Some(stripped) = filename.strip_suffix(".txt").or_else(|| filename.strip_suffix(".json")) {
        let clean = stripped
            .strip_prefix("bookmark_")
            .or_else(|| stripped.strip_prefix("translation_"))
            .unwrap_or(stripped);
        if clean.len() >= 19 && clean.chars().nth(4) == Some('-') && clean.chars().nth(7) == Some('-') && clean.chars().nth(10) == Some('_') {
            let date_part = &clean[..10];
            let time_part = clean[11..19].replace("-", ":");
            return format!("{} {}", date_part, time_part);
        }
    }
    if !fallback_created_time.is_empty() {
        return fallback_created_time.replace("T", " ").split('.').next().unwrap_or(fallback_created_time).to_string();
    }
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn parse_translation_text(raw_text: &str) -> (String, String) {
    if let Some((orig_part, trans_part)) = raw_text.split_once("\n\nTranslated: ") {
        let src = orig_part.strip_prefix("Original: ").unwrap_or(orig_part).trim().to_string();
        let trn = trans_part.trim().to_string();
        (src, trn)
    } else if let Some((orig_part, trans_part)) = raw_text.split_once("\n\n") {
        let src = orig_part.strip_prefix("Original: ").unwrap_or(orig_part).trim().to_string();
        let trn = trans_part.strip_prefix("Translated: ").unwrap_or(trans_part).trim().to_string();
        (src, trn)
    } else {
        (raw_text.to_string(), String::new())
    }
}

fn format_bookmark_plain_text(title: Option<&str>, source: Option<&str>, content: &str) -> String {
    let t = title.unwrap_or("Untitled");
    let s = source.unwrap_or("");
    format!("Title: {}\nSource: {}\n\n{}", t, s, content)
}

fn parse_bookmark_text(raw_text: &str) -> (Option<String>, Option<String>, String) {
    if let Some((headers, body)) = raw_text.split_once("\n\n") {
        let mut title = None;
        let mut source = None;
        for line in headers.lines() {
            if let Some(t) = line.strip_prefix("Title: ") {
                let trimmed = t.trim();
                if !trimmed.is_empty() && trimmed != "Untitled" {
                    title = Some(trimmed.to_string());
                }
            } else if let Some(s) = line.strip_prefix("Source: ") {
                let trimmed = s.trim();
                if !trimmed.is_empty() {
                    source = Some(trimmed.to_string());
                }
            }
        }
        (title, source, body.to_string())
    } else {
        (None, None, raw_text.to_string())
    }
}

async fn upload_bookmark_txt_to_drive(
    client: &reqwest::Client,
    access_token: &str,
    folder_id: &str,
    _id: &str,
    title: Option<&str>,
    source: Option<&str>,
    content: &str,
) -> Result<String, String> {
    let filename = generate_timestamp_filename();
    let plain_content = format_bookmark_plain_text(title, source, content);

    let metadata = serde_json::json!({
        "name": filename,
        "parents": [folder_id],
        "mimeType": "text/plain"
    });

    let boundary = "voce_boundary_txt";
    let multipart_body = format!(
        "--{}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n--{}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n{}\r\n--{}--",
        boundary,
        metadata,
        boundary,
        plain_content,
        boundary
    );

    let res = client
        .post("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", format!("multipart/related; boundary={}", boundary))
        .body(multipart_body)
        .send()
        .await
        .map_err(|e| format!("Failed to upload bookmark text to Drive: {}", e))?;

    if !res.status().is_success() {
        let err = res.text().await.unwrap_or_default();
        return Err(format!("Drive upload error: {}", err));
    }

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let drive_file_id = json["id"].as_str().ok_or_else(|| "Missing file id".to_string())?;
    Ok(drive_file_id.to_string())
}

async fn upload_translation_txt_to_drive(
    client: &reqwest::Client,
    access_token: &str,
    folder_id: &str,
    _id: &str,
    source_text: &str,
    translated_text: &str,
) -> Result<String, String> {
    let filename = generate_timestamp_filename();
    let plain_content = format!("Original: {}\n\nTranslated: {}", source_text, translated_text);

    let metadata = serde_json::json!({
        "name": filename,
        "parents": [folder_id],
        "mimeType": "text/plain"
    });

    let boundary = "voce_boundary_txt";
    let multipart_body = format!(
        "--{}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n--{}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n{}\r\n--{}--",
        boundary,
        metadata,
        boundary,
        plain_content,
        boundary
    );

    let res = client
        .post("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", format!("multipart/related; boundary={}", boundary))
        .body(multipart_body)
        .send()
        .await
        .map_err(|e| format!("Failed to upload translation text to Drive: {}", e))?;

    if !res.status().is_success() {
        let err = res.text().await.unwrap_or_default();
        return Err(format!("Drive translation upload error: {}", err));
    }

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let drive_file_id = json["id"].as_str().ok_or_else(|| "Missing file id".to_string())?;
    Ok(drive_file_id.to_string())
}

#[tauri::command]
async fn upload_bookmark_to_drive(app: AppHandle, payload: BookmarkPayload) -> Result<BookmarkItem, String> {
    println!("[Google Drive] Uploading bookmark '{}' with timestamp filename...", payload.id);
    let access_token = get_valid_google_access_token(&app).await?;

    let store = app.store("store.json").map_err(|e| format!("Store error: {}", e))?;
    let mut bookmarks_folder_id = None;

    if let Some(val) = store.get("google_user_profile") {
        if let Ok(p) = serde_json::from_value::<UserProfile>(val) {
            bookmarks_folder_id = p.bookmarks_folder_id;
        }
    }

    let client = reqwest::Client::new();
    let folder_id = match bookmarks_folder_id {
        Some(id) => id,
        None => {
            let voce_id = ensure_drive_folder(&client, &access_token, "Voce", None).await?;
            ensure_drive_folder(&client, &access_token, "bookmarks", Some(&voce_id)).await?
        }
    };

    let drive_file_id = upload_bookmark_txt_to_drive(
        &client,
        &access_token,
        &folder_id,
        &payload.id,
        payload.title.as_deref(),
        payload.source.as_deref(),
        &payload.content,
    ).await?;

    let item = BookmarkItem {
        id: payload.id,
        title: payload.title,
        content: payload.content,
        source: payload.source,
        created_at: payload.created_at,
        drive_file_id: Some(drive_file_id),
    };

    println!("[Google Drive] Bookmark uploaded as timestamped .txt successfully: {:?}", item.drive_file_id);
    let _ = app.emit("bookmark-saved", &item);
    Ok(item)
}

#[tauri::command]
async fn update_bookmark_in_drive(
    app: AppHandle,
    payload: BookmarkPayload,
    drive_file_id: String,
) -> Result<BookmarkItem, String> {
    println!("[Google Drive] Overwriting bookmark '{}' ({}) on Drive...", payload.id, drive_file_id);
    let access_token = get_valid_google_access_token(&app).await?;
    let plain_content = format_bookmark_plain_text(
        payload.title.as_deref(),
        payload.source.as_deref(),
        &payload.content,
    );

    let client = reqwest::Client::new();
    let res = client
        .patch(format!("https://www.googleapis.com/upload/drive/v3/files/{}?uploadType=media", drive_file_id))
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "text/plain; charset=UTF-8")
        .body(plain_content)
        .send()
        .await
        .map_err(|e| format!("Failed to update file in Google Drive: {}", e))?;

    if !res.status().is_success() {
        let err = res.text().await.unwrap_or_default();
        return Err(format!("Drive update error: {}", err));
    }

    let item = BookmarkItem {
        id: payload.id,
        title: payload.title,
        content: payload.content,
        source: payload.source,
        created_at: payload.created_at,
        drive_file_id: Some(drive_file_id),
    };

    println!("[Google Drive] Bookmark overwritten successfully on Drive.");
    let _ = app.emit("bookmark-saved", &item);
    Ok(item)
}

#[tauri::command]
async fn fetch_bookmarks_from_drive(app: AppHandle) -> Result<Vec<BookmarkItem>, String> {
    let access_token = match get_valid_google_access_token(&app).await {
        Ok(t) => t,
        Err(e) => {
            println!("[Google Drive] Cannot fetch bookmarks: {}", e);
            return Ok(Vec::new());
        }
    };

    let store = app.store("store.json").map_err(|e| format!("Store error: {}", e))?;
    let mut bookmarks_folder_id = None;

    if let Some(val) = store.get("google_user_profile") {
        if let Ok(p) = serde_json::from_value::<UserProfile>(val) {
            bookmarks_folder_id = p.bookmarks_folder_id;
        }
    }

    let client = reqwest::Client::new();
    let folder_id = match bookmarks_folder_id {
        Some(id) => id,
        None => {
            let voce_id = ensure_drive_folder(&client, &access_token, "Voce", None).await?;
            ensure_drive_folder(&client, &access_token, "bookmarks", Some(&voce_id)).await?
        }
    };

    let list_url = format!(
        "https://www.googleapis.com/drive/v3/files?q='{}'%20in%20parents%20and%20trashed%3Dfalse&fields=files(id,name,createdTime)&pageSize=100",
        folder_id
    );

    let list_res = client
        .get(&list_url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("Failed to list Drive bookmark files: {}", e))?;

    if !list_res.status().is_success() {
        let err = list_res.text().await.unwrap_or_default();
        return Err(format!("Google Drive file list error: {}", err));
    }

    let list_json: serde_json::Value = list_res.json().await.map_err(|e| e.to_string())?;
    let mut results: Vec<BookmarkItem> = Vec::new();

    if let Some(files) = list_json["files"].as_array() {
        for file in files {
            if let Some(file_id) = file["id"].as_str() {
                let name = file["name"].as_str().unwrap_or("");
                let created_time = file["createdTime"].as_str().unwrap_or("");
                let timestamp = parse_timestamp_from_filename(name, created_time);

                if name.ends_with(".txt") || name.ends_with(".json") {
                    let content_res = client
                        .get(format!("https://www.googleapis.com/drive/v3/files/{}?alt=media", file_id))
                        .header("Authorization", format!("Bearer {}", access_token))
                        .send()
                        .await;

                    if let Ok(res) = content_res {
                        if res.status().is_success() {
                            let text_data = res.text().await.unwrap_or_default();
                            
                            let mut id = file_id.to_string();
                            if let Some(stripped) = name.strip_prefix("bookmark_") {
                                if let Some(pure_id) = stripped.strip_suffix(".txt").or_else(|| stripped.strip_suffix(".json")) {
                                    id = pure_id.to_string();
                                }
                            }

                            if text_data.trim().starts_with('{') {
                                if let Ok(item_json) = serde_json::from_str::<serde_json::Value>(&text_data) {
                                    let json_id = item_json["id"].as_str().unwrap_or(&id).to_string();
                                    let title = item_json["title"].as_str().map(|s| s.to_string());
                                    let content = item_json["content"].as_str().unwrap_or("").to_string();
                                    let source = item_json["source"].as_str().map(|s| s.to_string());
                                    let created_at = item_json["created_at"]
                                        .as_str()
                                        .unwrap_or(&timestamp)
                                        .to_string();

                                    results.push(BookmarkItem {
                                        id: json_id,
                                        title,
                                        content,
                                        source,
                                        created_at,
                                        drive_file_id: Some(file_id.to_string()),
                                    });
                                }
                            } else {
                                let (title, source, content) = parse_bookmark_text(&text_data);
                                results.push(BookmarkItem {
                                    id: format!("bm_{}", file_id),
                                    title,
                                    content,
                                    source,
                                    created_at: timestamp,
                                    drive_file_id: Some(file_id.to_string()),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    println!("[Google Drive] Fetched {} bookmarks from Drive.", results.len());
    Ok(results)
}

#[tauri::command]
async fn delete_bookmark_from_drive(app: AppHandle, file_id: String) -> Result<(), String> {
    let access_token = get_valid_google_access_token(&app).await?;
    let client = reqwest::Client::new();
    let res = client
        .delete(format!("https://www.googleapis.com/drive/v3/files/{}", file_id))
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("Failed to delete file from Google Drive: {}", e))?;

    if !res.status().is_success() {
        let err = res.text().await.unwrap_or_default();
        return Err(format!("Drive delete error: {}", err));
    }

    println!("[Google Drive] Deleted bookmark file: {}", file_id);
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CloudSyncResult {
    pub bookmarks: Vec<BookmarkItem>,
    pub translations: Vec<TranslationRecordPayload>,
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
}

#[tauri::command]
async fn sync_from_cloud(
    app: AppHandle,
    local_bookmarks: Option<Vec<BookmarkItem>>,
    local_translations: Option<Vec<TranslationRecordPayload>>,
) -> Result<CloudSyncResult, String> {
    println!("[Google Drive] Starting bidirectional deduplicated sync...");
    let access_token = match get_valid_google_access_token(&app).await {
        Ok(t) => t,
        Err(e) => {
            println!("[Google Drive] Cannot sync from cloud (not logged in): {}", e);
            return Ok(CloudSyncResult {
                bookmarks: local_bookmarks.unwrap_or_default(),
                translations: local_translations.unwrap_or_default(),
            });
        }
    };

    let client = reqwest::Client::new();

    // 1. Ensure Voce folder and subfolders exist in Google Drive
    let voce_id = ensure_drive_folder(&client, &access_token, "Voce", None).await?;
    let bookmarks_folder_id = ensure_drive_folder(&client, &access_token, "bookmarks", Some(&voce_id)).await?;
    let translations_folder_id = ensure_drive_folder(&client, &access_token, "translations", Some(&voce_id)).await?;

    // Update store with discovered/created folder IDs
    if let Ok(store) = app.store("store.json") {
        if let Some(val) = store.get("google_user_profile") {
            if let Ok(mut profile) = serde_json::from_value::<UserProfile>(val) {
                profile.voce_folder_id = Some(voce_id.clone());
                profile.bookmarks_folder_id = Some(bookmarks_folder_id.clone());
                profile.translations_folder_id = Some(translations_folder_id.clone());
                profile.google_drive_configured = true;
                store.set("google_user_profile", serde_json::to_value(&profile).unwrap_or_default());
                let _ = store.save();
            }
        }
    }

    // 2. Fetch existing Cloud Bookmarks
    let mut cloud_bookmarks: Vec<BookmarkItem> = Vec::new();
    let b_query = format!("'{}' in parents and trashed = false", bookmarks_folder_id);
    let b_url = format!(
        "https://www.googleapis.com/drive/v3/files?q={}&fields=files(id,name,createdTime)&pageSize=1000",
        url_encode(&b_query)
    );
    if let Ok(res) = client
        .get(&b_url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
    {
        if res.status().is_success() {
            if let Ok(list_json) = res.json::<serde_json::Value>().await {
                if let Some(files) = list_json["files"].as_array() {
                    for file in files {
                        if let Some(file_id) = file["id"].as_str() {
                            let name = file["name"].as_str().unwrap_or("");
                            let created_time = file["createdTime"].as_str().unwrap_or("");
                            let timestamp = parse_timestamp_from_filename(name, created_time);

                            if name.ends_with(".txt") || name.ends_with(".json") {
                                if let Ok(content_res) = client
                                    .get(format!("https://www.googleapis.com/drive/v3/files/{}?alt=media", file_id))
                                    .header("Authorization", format!("Bearer {}", access_token))
                                    .send()
                                    .await
                                {
                                    if content_res.status().is_success() {
                                        let text_data = content_res.text().await.unwrap_or_default();
                                        if text_data.trim().starts_with('{') {
                                            if let Ok(item_json) = serde_json::from_str::<serde_json::Value>(&text_data) {
                                                let id = item_json["id"].as_str().unwrap_or(file_id).to_string();
                                                let title = item_json["title"].as_str().map(|s| s.to_string());
                                                let content = item_json["content"].as_str().unwrap_or("").to_string();
                                                let source = item_json["source"].as_str().map(|s| s.to_string());
                                                let created_at = item_json["created_at"].as_str().unwrap_or(&timestamp).to_string();
                                                cloud_bookmarks.push(BookmarkItem {
                                                    id,
                                                    title,
                                                    content,
                                                    source,
                                                    created_at,
                                                    drive_file_id: Some(file_id.to_string()),
                                                });
                                            }
                                        } else {
                                            let (title, source, content) = parse_bookmark_text(&text_data);
                                            cloud_bookmarks.push(BookmarkItem {
                                                id: format!("bm_{}", file_id),
                                                title,
                                                content,
                                                source,
                                                created_at: timestamp,
                                                drive_file_id: Some(file_id.to_string()),
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 3. Fetch existing Cloud Translations
    let mut cloud_translations: Vec<TranslationRecordPayload> = Vec::new();
    let t_query = format!("'{}' in parents and trashed = false", translations_folder_id);
    let t_url = format!(
        "https://www.googleapis.com/drive/v3/files?q={}&fields=files(id,name,createdTime)&pageSize=1000",
        url_encode(&t_query)
    );
    if let Ok(res) = client
        .get(&t_url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
    {
        if res.status().is_success() {
            if let Ok(list_json) = res.json::<serde_json::Value>().await {
                if let Some(files) = list_json["files"].as_array() {
                    for file in files {
                        if let Some(file_id) = file["id"].as_str() {
                            let name = file["name"].as_str().unwrap_or("");
                            let created_time = file["createdTime"].as_str().unwrap_or("");
                            let timestamp = parse_timestamp_from_filename(name, created_time);

                            if name.ends_with(".txt") || name.ends_with(".json") {
                                if let Ok(content_res) = client
                                    .get(format!("https://www.googleapis.com/drive/v3/files/{}?alt=media", file_id))
                                    .header("Authorization", format!("Bearer {}", access_token))
                                    .send()
                                    .await
                                {
                                    if content_res.status().is_success() {
                                        let text_data = content_res.text().await.unwrap_or_default();
                                        let (source_text, translated_text) = parse_translation_text(&text_data);
                                        let char_count = source_text.len();
                                        cloud_translations.push(TranslationRecordPayload {
                                            id: format!("trn_{}", file_id),
                                            timestamp,
                                            source_text,
                                            source_lang: "Auto-detected".to_string(),
                                            translated_text,
                                            target_lang: "English".to_string(),
                                            char_count,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 4. Bidirectional Deduplication for Bookmarks
    let mut merged_bookmarks: Vec<BookmarkItem> = cloud_bookmarks.clone();
    let in_local_bms = local_bookmarks.unwrap_or_default();

    for loc in in_local_bms {
        let loc_content = loc.content.trim();
        let exists_in_cloud = cloud_bookmarks.iter().any(|cb| {
            cb.content.trim() == loc_content
                || (loc.drive_file_id.is_some() && cb.drive_file_id == loc.drive_file_id)
        });

        if !exists_in_cloud && !loc_content.is_empty() {
            println!("[Google Drive Sync] Uploading unique local bookmark '{}' to Drive...", loc.id);
            if let Ok(new_file_id) = upload_bookmark_txt_to_drive(
                &client,
                &access_token,
                &bookmarks_folder_id,
                &loc.id,
                loc.title.as_deref(),
                loc.source.as_deref(),
                &loc.content,
            ).await {
                let mut uploaded_bm = loc.clone();
                uploaded_bm.drive_file_id = Some(new_file_id);
                merged_bookmarks.push(uploaded_bm);
            } else {
                merged_bookmarks.push(loc);
            }
        }
    }

    // 5. Bidirectional Deduplication for Translations
    let mut merged_translations: Vec<TranslationRecordPayload> = cloud_translations.clone();
    let in_local_trns = local_translations.unwrap_or_default();

    for loc in in_local_trns {
        let loc_src = loc.source_text.trim();
        let loc_trn = loc.translated_text.trim();
        let exists_in_cloud = cloud_translations.iter().any(|ct| {
            ct.source_text.trim() == loc_src && ct.translated_text.trim() == loc_trn
        });

        if !exists_in_cloud && !loc_src.is_empty() && !loc_trn.is_empty() {
            println!("[Google Drive Sync] Uploading unique local translation '{}' to Drive...", loc.id);
            let _ = upload_translation_txt_to_drive(
                &client,
                &access_token,
                &translations_folder_id,
                &loc.id,
                &loc.source_text,
                &loc.translated_text,
            ).await;
            merged_translations.push(loc);
        }
    }

    // Sort by timestamp DESC
    merged_bookmarks.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    merged_translations.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    let result = CloudSyncResult {
        bookmarks: merged_bookmarks,
        translations: merged_translations,
    };

    let _ = app.emit("cloud-sync-completed", &result);
    println!(
        "[Google Drive] Sync completed: {} unique bookmarks, {} unique translations.",
        result.bookmarks.len(),
        result.translations.len()
    );
    Ok(result)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranslationSyncItem {
    pub id: String,
    pub source_text: String,
    pub translated_text: String,
}

#[tauri::command]
async fn retroactive_sync_local_data(
    app: AppHandle,
    bookmarks: Vec<BookmarkPayload>,
    translations: Vec<TranslationSyncItem>,
) -> Result<(), String> {
    println!(
        "[Google Drive] Retroactively syncing {} bookmarks and {} translations to Drive...",
        bookmarks.len(),
        translations.len()
    );
    let access_token = get_valid_google_access_token(&app).await?;
    let client = reqwest::Client::new();

    let voce_id = ensure_drive_folder(&client, &access_token, "Voce", None).await?;
    let bookmarks_folder_id = ensure_drive_folder(&client, &access_token, "bookmarks", Some(&voce_id)).await?;
    let translations_folder_id = ensure_drive_folder(&client, &access_token, "translations", Some(&voce_id)).await?;

    for bm in bookmarks {
        println!("[Google Drive Sync] Uploading bookmark '{}' to Drive...", bm.id);
        let _ = upload_bookmark_txt_to_drive(
            &client,
            &access_token,
            &bookmarks_folder_id,
            &bm.id,
            bm.title.as_deref(),
            bm.source.as_deref(),
            &bm.content,
        )
        .await;
    }

    for trn in translations {
        println!("[Google Drive Sync] Uploading translation '{}' to Drive...", trn.id);
        let _ = upload_translation_txt_to_drive(
            &client,
            &access_token,
            &translations_folder_id,
            &trn.id,
            &trn.source_text,
            &trn.translated_text,
        )
        .await;
    }

    Ok(())
}

// ----------------------------------------------------------------------------
// GLOBAL HOTKEYS & BULLETPROOF SYNTHETIC CLIPBOARD CAPTURE
// ----------------------------------------------------------------------------

/// Performs non-destructive synthetic clipboard copy and returns the selected text.
fn capture_synthetic_clipboard_selection() -> String {
    // 1. Read and preserve existing clipboard in memory as backup
    let original_clipboard = if let Ok(mut clipboard) = arboard::Clipboard::new() {
        clipboard.get_text().unwrap_or_default()
    } else {
        String::new()
    };

    // 2. Clear clipboard completely so we can detect newly copied text
    if let Ok(mut clipboard) = arboard::Clipboard::new() {
        let _ = clipboard.clear();
    }

    // 3. Instantiate Enigo & force release modifier keys and shortcut keys
    if let Ok(mut enigo) = Enigo::new(&EnigoSettings::default()) {
        #[cfg(target_os = "windows")]
        {
            // Release Alt (VK_MENU = 0x12), Ctrl, Shift, Win, and shortcut trigger keys (B=0x42, T=0x54)
            let _ = enigo.key(Key::Other(0x12), Direction::Release); // VK_MENU (Alt)
            let _ = enigo.key(Key::Alt, Direction::Release);
            let _ = enigo.key(Key::Control, Direction::Release);
            let _ = enigo.key(Key::Shift, Direction::Release);
            let _ = enigo.key(Key::Meta, Direction::Release);
            let _ = enigo.key(Key::Other(0x42), Direction::Release); // VK_B
            let _ = enigo.key(Key::Other(0x54), Direction::Release); // VK_T

            // Sleep 80ms so Windows processes modifier releases
            std::thread::sleep(Duration::from_millis(80));

            // Press Ctrl+C (VK_CONTROL + VK_C = 0x43)
            let _ = enigo.key(Key::Control, Direction::Press);
            std::thread::sleep(Duration::from_millis(25));
            let _ = enigo.key(Key::Other(0x43), Direction::Press);
            std::thread::sleep(Duration::from_millis(25));
            let _ = enigo.key(Key::Other(0x43), Direction::Release);
            std::thread::sleep(Duration::from_millis(25));
            let _ = enigo.key(Key::Unicode('c'), Direction::Click); // Unicode fallback
            let _ = enigo.key(Key::Control, Direction::Release);
        }

        #[cfg(target_os = "macos")]
        {
            let _ = enigo.key(Key::Alt, Direction::Release);
            let _ = enigo.key(Key::Control, Direction::Release);
            let _ = enigo.key(Key::Shift, Direction::Release);
            let _ = enigo.key(Key::Meta, Direction::Release);
            std::thread::sleep(Duration::from_millis(80));

            let _ = enigo.key(Key::Meta, Direction::Press);
            let _ = enigo.key(Key::Unicode('c'), Direction::Click);
            let _ = enigo.key(Key::Meta, Direction::Release);
        }

        #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
        {
            let _ = enigo.key(Key::Alt, Direction::Release);
            let _ = enigo.key(Key::Control, Direction::Release);
            let _ = enigo.key(Key::Shift, Direction::Release);
            let _ = enigo.key(Key::Meta, Direction::Release);
            std::thread::sleep(Duration::from_millis(80));

            let _ = enigo.key(Key::Control, Direction::Press);
            let _ = enigo.key(Key::Unicode('c'), Direction::Click);
            let _ = enigo.key(Key::Control, Direction::Release);
        }
    }

    // 4. Sleep 250ms (Crucial: OS clipboard needs time to receive data from active app)
    std::thread::sleep(Duration::from_millis(250));

    // 5. Read clipboard: if empty, restore original_clipboard and return ""; if text exists, return new text.
    let new_clipboard = if let Ok(mut clipboard) = arboard::Clipboard::new() {
        clipboard.get_text().unwrap_or_default()
    } else {
        String::new()
    };

    if !new_clipboard.trim().is_empty() {
        println!("[Synthetic Clipboard] Captured {} characters of selected text.", new_clipboard.trim().len());
        new_clipboard.trim().to_string()
    } else {
        if !original_clipboard.is_empty() {
            if let Ok(mut clipboard) = arboard::Clipboard::new() {
                let _ = clipboard.set_text(&original_clipboard);
            }
        }
        String::new()
    }
}

// Handle global STT activation
fn trigger_stt_flow(app: &AppHandle) {
    position_window_at_cursor(app, "stt-overlay", 20);

    let state: State<'_, AppAudioState> = app.state();
    if let Ok(mut rec) = state.recorder.lock() {
        let _ = rec.start_recording();
    }

    let _ = app.emit("trigger-stt-overlay", ());
}

// Handle global Translation activation: captures highlighted text non-destructively
fn trigger_translate_flow(app: &AppHandle) {
    let source_text = capture_synthetic_clipboard_selection();

    position_window_at_cursor(app, "translate-overlay", 20);

    let target_lang = {
        let settings: State<'_, AppSettingsState> = app.state();
        settings
            .target_language
            .lock()
            .map(|l| l.clone())
            .unwrap_or_else(|_| "English".to_string())
    };

    let event_data = TranslationEventData {
        source_text: source_text.clone(),
        translated_text: String::new(),
        source_lang: "Auto-detected".to_string(),
        target_lang,
    };

    if let Some(win) = app.get_webview_window("translate-overlay") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.emit("trigger-translate-overlay", &event_data);
    }

    let _ = app.emit("trigger-translate-overlay", event_data);
}

// Handle global Bookmark activation: captures highlighted text non-destructively
fn trigger_bookmark_flow(app: &AppHandle) {
    let captured_text = capture_synthetic_clipboard_selection();
    println!("[Bookmark Hotkey] Triggering bookmark flow with captured text length: {}", captured_text.len());

    position_window_at_cursor(app, "bookmark-overlay", 20);

    let payload = serde_json::json!({
        "captured_text": &captured_text,
        "capturedText": &captured_text,
    });

    if let Some(win) = app.get_webview_window("bookmark-overlay") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.emit("trigger-bookmark-overlay", &payload);
    }

    let _ = app.emit("trigger-bookmark-overlay", &payload);
}

#[tauri::command]
fn update_global_hotkeys(
    app: AppHandle,
    state: State<'_, AppHotkeys>,
    stt_hotkey: String,
    translate_hotkey: String,
    bookmark_hotkey: String,
) -> Result<(), String> {
    let global_shortcut = app.global_shortcut();

    if let Ok(old_stt) = state.stt_shortcut.lock() {
        if let Ok(shortcut) = old_stt.parse::<Shortcut>() {
            let _ = global_shortcut.unregister(shortcut);
        }
    }
    if let Ok(old_tr) = state.translate_shortcut.lock() {
        if let Ok(shortcut) = old_tr.parse::<Shortcut>() {
            let _ = global_shortcut.unregister(shortcut);
        }
    }
    if let Ok(old_bm) = state.bookmark_shortcut.lock() {
        if let Ok(shortcut) = old_bm.parse::<Shortcut>() {
            let _ = global_shortcut.unregister(shortcut);
        }
    }

    if let Ok(stt_parsed) = stt_hotkey.parse::<Shortcut>() {
        let app_handle = app.clone();
        if let Err(e) = global_shortcut.on_shortcut(stt_parsed, move |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                trigger_stt_flow(&app_handle);
            }
        }) {
            eprintln!("Failed to register STT shortcut {}: {:?}", stt_hotkey, e);
        } else if let Ok(mut current) = state.stt_shortcut.lock() {
            *current = stt_hotkey;
        }
    }

    if let Ok(tr_parsed) = translate_hotkey.parse::<Shortcut>() {
        let app_handle = app.clone();
        if let Err(e) = global_shortcut.on_shortcut(tr_parsed, move |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                trigger_translate_flow(&app_handle);
            }
        }) {
            eprintln!("Failed to register Translation shortcut {}: {:?}", translate_hotkey, e);
        } else if let Ok(mut current) = state.translate_shortcut.lock() {
            *current = translate_hotkey;
        }
    }

    if let Ok(bm_parsed) = bookmark_hotkey.parse::<Shortcut>() {
        let app_handle = app.clone();
        if let Err(e) = global_shortcut.on_shortcut(bm_parsed, move |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                trigger_bookmark_flow(&app_handle);
            }
        }) {
            eprintln!("Failed to register Bookmark shortcut {}: {:?}", bookmark_hotkey, e);
        } else if let Ok(mut current) = state.bookmark_shortcut.lock() {
            *current = bookmark_hotkey;
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv();
    let _ = dotenvy::from_path("../.env");
    let _ = dotenvy::from_path(".env");

    let migrations = vec![
        Migration {
            version: 1,
            description: "create_preferences_and_history_tables",
            sql: "
                CREATE TABLE IF NOT EXISTS preferences (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS history (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    source_text TEXT NOT NULL,
                    translated_text TEXT,
                    source_lang TEXT,
                    target_lang TEXT,
                    timestamp TEXT NOT NULL,
                    char_count INTEGER DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS bookmarks (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    content TEXT NOT NULL,
                    source TEXT,
                    created_at TEXT NOT NULL,
                    drive_file_id TEXT
                );
            ",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .manage(AppHotkeys {
            stt_shortcut: Mutex::new("Alt+Space".to_string()),
            translate_shortcut: Mutex::new("Alt+T".to_string()),
            bookmark_shortcut: Mutex::new("Alt+B".to_string()),
        })
        .manage(AppAudioState {
            recorder: Mutex::new(AudioRecorder::new()),
        })
        .manage(AppSettingsState {
            target_language: Mutex::new("English".to_string()),
            auto_paste: Mutex::new(true),
        })
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:voce.db", migrations)
                .build(),
        )
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .setup(|app| {
            let global_shortcut = app.global_shortcut();

            if let Ok(stt_sc) = "Alt+Space".parse::<Shortcut>() {
                let app_handle = app.handle().clone();
                let _ = global_shortcut.on_shortcut(stt_sc, move |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        trigger_stt_flow(&app_handle);
                    }
                });
            }

            if let Ok(tr_sc) = "Alt+T".parse::<Shortcut>() {
                let app_handle = app.handle().clone();
                let _ = global_shortcut.on_shortcut(tr_sc, move |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        trigger_translate_flow(&app_handle);
                    }
                });
            }

            if let Ok(bm_sc) = "Alt+B".parse::<Shortcut>() {
                let app_handle = app.handle().clone();
                let _ = global_shortcut.on_shortcut(bm_sc, move |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        trigger_bookmark_flow(&app_handle);
                    }
                });
            }

            let show_i = MenuItem::with_id(app, "show", "Open Settings", true, None::<&str>)?;
            let stt_i = MenuItem::with_id(app, "stt", "Voice Dictation (Alt+Space)", true, None::<&str>)?;
            let trn_i = MenuItem::with_id(app, "trn", "Translate Selection (Alt+T)", true, None::<&str>)?;
            let bm_i = MenuItem::with_id(app, "bm", "Capture Bookmark (Alt+B)", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit Voce", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &stt_i, &trn_i, &bm_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Voce - AI Desktop Assistant")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "stt" => {
                        trigger_stt_flow(app);
                    }
                    "trn" => {
                        trigger_translate_flow(app);
                    }
                    "bm" => {
                        trigger_bookmark_flow(app);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_system_daemon_status,
            show_overlay,
            hide_overlay,
            start_audio_recording,
            stop_audio_recording,
            execute_local_transcription,
            get_clipboard_text,
            execute_local_translation,
            inject_text_to_cursor,
            start_google_oauth,
            get_google_user_profile,
            google_logout,
            upload_bookmark_to_drive,
            update_bookmark_in_drive,
            fetch_bookmarks_from_drive,
            delete_bookmark_from_drive,
            sync_from_cloud,
            retroactive_sync_local_data,
            update_global_hotkeys,
            get_stored_api_key,
            save_groq_api_key,
            validate_groq_api_key,
            open_external_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running voce application");
}
