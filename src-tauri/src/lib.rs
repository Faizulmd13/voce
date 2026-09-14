pub mod audio;

use audio::AudioRecorder;
use enigo::{Direction, Enigo, Key, Keyboard, Settings as EnigoSettings};
use serde::{Deserialize, Serialize};
use std::process::Command;
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

#[tauri::command]
fn get_system_daemon_status() -> String {
    "active".to_string()
}

/// Helper to resolve cross-platform sidecar binary paths in dev & packaged production
fn get_sidecar_path(app: &AppHandle, binary_name: &str) -> std::path::PathBuf {
    // 1. Check bundled resource directory (Tauri production bundle)
    if let Ok(res_dir) = app.path().resource_dir() {
        let bin_res = res_dir.join("bins").join(format!("{}.exe", binary_name));
        if bin_res.exists() {
            return bin_res;
        }
        let bin_root = res_dir.join(format!("{}.exe", binary_name));
        if bin_root.exists() {
            return bin_root;
        }
    }

    // 2. Check next to running executable
    if let Ok(curr_exe) = std::env::current_exe() {
        if let Some(parent) = curr_exe.parent() {
            let p1 = parent.join(format!("{}.exe", binary_name));
            if p1.exists() {
                return p1;
            }
            let p2 = parent.join(format!("{}-x86_64-pc-windows-msvc.exe", binary_name));
            if p2.exists() {
                return p2;
            }
        }
    }

    // 3. Check dev workspace directories
    let cwd = std::env::current_dir().unwrap_or_default();
    let dev_bin1 = cwd
        .join("src-tauri")
        .join("bins")
        .join(format!("{}-x86_64-pc-windows-msvc.exe", binary_name));
    if dev_bin1.exists() {
        return dev_bin1;
    }
    let dev_bin2 = cwd
        .join("bins")
        .join(format!("{}-x86_64-pc-windows-msvc.exe", binary_name));
    if dev_bin2.exists() {
        return dev_bin2;
    }

    // 4. Check cargo target/debug directory
    let target_bin = cwd
        .join("src-tauri")
        .join("target")
        .join("debug")
        .join(format!("{}.exe", binary_name));
    if target_bin.exists() {
        return target_bin;
    }

    std::path::PathBuf::from(format!("{}.exe", binary_name))
}

/// FLORES-200 / NLLB-200 language code normalizer
pub fn map_to_nllb_lang_code(lang: &str) -> &'static str {
    let lower = lang.trim().to_lowercase();
    match lower.as_str() {
        "english" | "en" | "eng" | "eng_latn" => "eng_Latn",
        "spanish" | "es" | "spa" | "spa_latn" => "spa_Latn",
        "french" | "fr" | "fra" | "fra_latn" => "fra_Latn",
        "german" | "de" | "deu" | "deu_latn" => "deu_Latn",
        "tamil" | "ta" | "tam" | "tam_taml" => "tam_Taml",
        "hindi" | "hi" | "hin" | "hin_deva" => "hin_Deva",
        "japanese" | "ja" | "jpn" | "jpn_jpan" => "jpn_Jpan",
        "chinese" | "chinese (simplified)" | "chinese simplified" | "zh" | "zho" | "zho_hans" => "zho_Hans",
        "chinese (traditional)" | "chinese traditional" | "zho_hant" => "zho_Hant",
        "arabic" | "ar" | "ara" | "ara_arab" => "ara_Arab",
        "russian" | "ru" | "rus" | "rus_cyrl" => "rus_Cyrl",
        "italian" | "it" | "ita" | "ita_latn" => "ita_Latn",
        "portuguese" | "pt" | "por" | "por_latn" => "por_Latn",
        "dutch" | "nl" | "nld" | "nld_latn" => "nld_Latn",
        "korean" | "ko" | "kor" | "kor_hang" => "kor_Hang",
        "turkish" | "tr" | "tur" | "tur_latn" => "tur_Latn",
        "polish" | "pl" | "pol" | "pol_latn" => "pol_Latn",
        "vietnamese" | "vi" | "vie" | "vie_latn" => "vie_Latn",
        "indonesian" | "id" | "ind" | "ind_latn" => "ind_Latn",
        "bengali" | "bn" | "ben" | "ben_beng" => "ben_Beng",
        "telugu" | "te" | "tel" | "tel_telu" => "tel_Telu",
        "marathi" | "mr" | "mar" | "mar_deva" => "mar_Deva",
        "urdu" | "ur" | "urd" | "urd_arab" => "urd_Arab",
        "gujarati" | "gu" | "guj" | "guj_gujr" => "guj_Gujr",
        "ukrainian" | "uk" | "ukr" | "ukr_cyrl" => "ukr_Cyrl",
        "swedish" | "sv" | "swe" | "swe_latn" => "swe_Latn",
        _ => "eng_Latn",
    }
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
        "[Whisper STT] Executing live transcription on WAV buffer: {}",
        wav_path
    );

    let executable_path = get_sidecar_path(&app, "whisper");
    if !executable_path.exists() {
        return Err(format!(
            "Whisper sidecar binary not found at {:?}",
            executable_path
        ));
    }

    // Locate whisper model ggml-base.en.bin if present
    let mut model_path = std::path::PathBuf::new();
    if let Ok(res_dir) = app.path().resource_dir() {
        let m = res_dir.join("models").join("ggml-base.en.bin");
        if m.exists() {
            model_path = m;
        }
    }
    if !model_path.exists() {
        let m = std::env::current_dir()
            .unwrap_or_default()
            .join("src-tauri")
            .join("models")
            .join("ggml-base.en.bin");
        if m.exists() {
            model_path = m;
        }
    }

    let output = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&executable_path);
        cmd.arg("-f").arg(&wav_path);
        if model_path.exists() {
            cmd.arg("-m").arg(&model_path);
        }
        cmd.output()
    })
    .await
    .map_err(|e| format!("Task execution error: {}", e))?
    .map_err(|e| format!("Failed to execute whisper sidecar: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("Whisper sidecar error: {}", stderr));
    }

    let res = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if res.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr.is_empty() {
            return Err(format!("Whisper error: {}", stderr));
        }
        return Err("Whisper sidecar returned empty transcript".to_string());
    }

    Ok(res)
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

    let nllb_target_code = map_to_nllb_lang_code(&payload.target_lang);
    println!(
        "[Translation Engine] Translating into {} (token: {}): {}",
        payload.target_lang, nllb_target_code, text
    );

    let executable_path = get_sidecar_path(&app, "translator");
    if !executable_path.exists() {
        return Err(format!(
            "Translator sidecar binary not found at {:?}",
            executable_path
        ));
    }

    // Locate models/nllb-200 directory if present
    let mut model_dir = std::path::PathBuf::new();
    if let Ok(res_dir) = app.path().resource_dir() {
        let m = res_dir.join("models").join("nllb-200");
        if m.exists() {
            model_dir = m;
        }
    }
    if !model_dir.exists() {
        let m = std::env::current_dir()
            .unwrap_or_default()
            .join("src-tauri")
            .join("models")
            .join("nllb-200");
        if m.exists() {
            model_dir = m;
        }
    }

    let target_token = nllb_target_code.to_string();
    let output = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&executable_path);
        cmd.arg("-t").arg(&target_token);
        cmd.arg("-i").arg(&text);
        if model_dir.exists() {
            cmd.arg("-m").arg(&model_dir);
        }
        cmd.output()
    })
    .await
    .map_err(|e| format!("Task execution error: {}", e))?
    .map_err(|e| format!("Failed to execute translator sidecar: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("Translator sidecar error: {}", stderr));
    }

    let res = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if res.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr.is_empty() {
            return Err(format!("Translator error: {}", stderr));
        }
        return Err("Translator sidecar returned empty result".to_string());
    }

    Ok(res)
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
            update_global_hotkeys
        ])
        .run(tauri::generate_context!())
        .expect("error while running voce application");
}
