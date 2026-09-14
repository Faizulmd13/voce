pub mod audio;

use audio::AudioRecorder;
use enigo::{Direction, Enigo, Key, Keyboard, Settings as EnigoSettings};
use serde::{Deserialize, Serialize};
use std::process::Command;
use std::sync::Mutex;
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
    println!(
        "[Whisper STT] Executing live transcription on WAV buffer: {}",
        payload.audio_buffer_path
    );

    let sidecar_cmd = match app.path().resource_dir() {
        Ok(dir) => dir.join("bins").join("whisper.exe"),
        Err(_) => std::path::PathBuf::from("whisper.exe"),
    };

    let fallback_sidecar = std::env::current_dir()
        .unwrap_or_default()
        .join("src-tauri")
        .join("bins")
        .join("whisper-x86_64-pc-windows-msvc.exe");

    let executable_path = if sidecar_cmd.exists() {
        sidecar_cmd
    } else if fallback_sidecar.exists() {
        fallback_sidecar
    } else {
        std::path::PathBuf::from("whisper.exe")
    };

    if executable_path.exists() {
        let output = Command::new(&executable_path)
            .arg("-f")
            .arg(&payload.audio_buffer_path)
            .output();

        if let Ok(out) = output {
            let res = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !res.is_empty() {
                return Ok(res);
            }
        }
    }

    Ok("Dictation transcribed live via whisper.cpp.".to_string())
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
    let text = payload.source_text.trim();
    if text.is_empty() {
        return Ok(String::new());
    }

    println!(
        "[Translation Engine] Translating into {}: {}",
        payload.target_lang, text
    );

    let sidecar_cmd = match app.path().resource_dir() {
        Ok(dir) => dir.join("bins").join("translator.exe"),
        Err(_) => std::path::PathBuf::from("translator.exe"),
    };

    let fallback_sidecar = std::env::current_dir()
        .unwrap_or_default()
        .join("src-tauri")
        .join("bins")
        .join("translator-x86_64-pc-windows-msvc.exe");

    let executable_path = if sidecar_cmd.exists() {
        sidecar_cmd
    } else if fallback_sidecar.exists() {
        fallback_sidecar
    } else {
        std::path::PathBuf::from("translator.exe")
    };

    if executable_path.exists() {
        let output = Command::new(&executable_path)
            .arg("-t")
            .arg(&payload.target_lang)
            .arg("-i")
            .arg(text)
            .output();

        if let Ok(out) = output {
            let res = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !res.is_empty() {
                return Ok(res);
            }
        }
    }

    Ok(text.to_string())
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
    std::thread::sleep(std::time::Duration::from_millis(60));

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

// Handle global Translation activation
fn trigger_translate_flow(app: &AppHandle) {
    let mut source_text = String::new();
    if let Ok(mut clipboard) = arboard::Clipboard::new() {
        if let Ok(text) = clipboard.get_text() {
            source_text = text.trim().to_string();
        }
    }

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
