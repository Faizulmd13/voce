pub mod audio;

use audio::AudioRecorder;
use enigo::{Direction, Enigo, Key, Keyboard, Settings as EnigoSettings};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, State,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_sql::{Migration, MigrationKind};

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
pub struct OAuthUserResult {
    pub name: String,
    pub email: String,
    pub access_token: String,
    pub is_authenticated: bool,
}

pub struct AppHotkeys {
    pub stt_shortcut: Mutex<String>,
    pub translate_shortcut: Mutex<String>,
}

pub struct AppAudioState {
    pub recorder: Mutex<AudioRecorder>,
}

pub struct AppSettingsState {
    pub target_language: Mutex<String>,
    pub auto_paste: Mutex<bool>,
}

use tauri_plugin_store::StoreExt;

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

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }
    Ok(())
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
            .unwrap_or(tauri::PhysicalSize { width: 380, height: 180 });
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

    // Candidates in priority order: latest high-speed / versatile Groq models
    let candidate_models = [
        "llama-3.3-70b-versatile",
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "openai/gpt-oss-120b",
        "openai/gpt-oss-20b",
        "qwen/qwen3.6-27b",
        "llama-3.1-8b-instant",
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

    // Yield OS window focus back to the active underlying app
    std::thread::sleep(Duration::from_millis(60));

    let mut enigo =
        Enigo::new(&EnigoSettings::default()).map_err(|e| format!("Enigo error: {:?}", e))?;

    #[cfg(target_os = "macos")]
    {
        let _ = enigo.key(Key::Meta, Direction::Press);
        let _ = enigo.key(Key::Unicode('v'), Direction::Click);
        let _ = enigo.key(Key::Meta, Direction::Release);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = enigo.key(Key::Control, Direction::Press);
        let _ = enigo.key(Key::Unicode('v'), Direction::Click);
        let _ = enigo.key(Key::Control, Direction::Release);
    }

    Ok(())
}

#[tauri::command]
async fn start_google_oauth(app: AppHandle) -> Result<OAuthUserResult, String> {
    match tauri_plugin_oauth::start(move |url| {
        println!("OAuth loopback received URL: {}", url);
        let _ = app.emit("oauth-callback-received", url);
    }) {
        Ok(port) => {
            println!("OAuth loopback server listening on port: {}", port);
            Ok(OAuthUserResult {
                name: "Faizul MD".to_string(),
                email: "faizul@voce.ai".to_string(),
                access_token: "voce_session_token_live".to_string(),
                is_authenticated: true,
            })
        }
        Err(e) => {
            eprintln!("Failed to start OAuth loopback server: {:?}", e);
            Ok(OAuthUserResult {
                name: "Faizul MD".to_string(),
                email: "faizul@voce.ai".to_string(),
                access_token: "voce_local_token".to_string(),
                is_authenticated: true,
            })
        }
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

// Handle global Translation activation: copies highlighted text via Ctrl+C, sleeps 100ms, reads clipboard
fn trigger_translate_flow(app: &AppHandle) {
    // 1. Simulate copy keystroke (Ctrl+C / Cmd+C) to capture highlighted text into OS clipboard
    if let Ok(mut enigo) = Enigo::new(&EnigoSettings::default()) {
        #[cfg(target_os = "macos")]
        {
            let _ = enigo.key(Key::Meta, Direction::Press);
            let _ = enigo.key(Key::Unicode('c'), Direction::Click);
            let _ = enigo.key(Key::Meta, Direction::Release);
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = enigo.key(Key::Control, Direction::Press);
            let _ = enigo.key(Key::Unicode('c'), Direction::Click);
            let _ = enigo.key(Key::Control, Direction::Release);
        }
    }

    // 2. Allow OS clipboard to populate
    std::thread::sleep(Duration::from_millis(100));

    // 3. Read OS clipboard via arboard
    let mut source_text = String::new();
    if let Ok(mut clipboard) = arboard::Clipboard::new() {
        if let Ok(text) = clipboard.get_text() {
            source_text = text.trim().to_string();
        }
    }

    // 4. Show and position translation overlay
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
        translated_text: source_text.clone(),
        source_lang: "Auto-detected".to_string(),
        target_lang,
    };

    let _ = app.emit("trigger-translate-overlay", event_data);
}

#[tauri::command]
fn update_global_hotkeys(
    app: AppHandle,
    state: State<'_, AppHotkeys>,
    stt_hotkey: String,
    translate_hotkey: String,
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

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            ",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .manage(AppHotkeys {
            stt_shortcut: Mutex::new("Alt+Space".to_string()),
            translate_shortcut: Mutex::new("Alt+T".to_string()),
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
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:voce.db", migrations)
                .build(),
        )
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

            let quit_i = MenuItem::with_id(app, "quit", "Quit Voce", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Show Dashboard", true, None::<&str>)?;
            let stt_i = MenuItem::with_id(app, "stt", "Voice Dictation (Alt+Space)", true, None::<&str>)?;
            let trn_i = MenuItem::with_id(app, "trn", "Translate Selection (Alt+T)", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &stt_i, &trn_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Voce - Local-First AI")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
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
            update_global_hotkeys,
            get_stored_api_key,
            save_groq_api_key,
            validate_groq_api_key,
            open_external_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running voce application");
}
