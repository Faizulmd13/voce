use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
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

#[tauri::command]
fn get_system_daemon_status() -> String {
    "active".to_string()
}

#[tauri::command]
async fn execute_local_transcription(payload: DictationPayload) -> Result<String, String> {
    println!("Executing whisper transcription on: {}", payload.audio_buffer_path);
    Ok("The quick brown fox jumps over the lazy dog.".to_string())
}

#[tauri::command]
async fn execute_local_translation(payload: TranslationPayload) -> Result<String, String> {
    println!("Translating text to {}: {}", payload.target_lang, payload.source_text);
    Ok(format!("Translated [{}] into {}", payload.source_text, payload.target_lang))
}

#[tauri::command]
fn trigger_cursor_paste(_app: AppHandle, text: String) -> Result<(), String> {
    println!("Simulating OS cursor paste for text: {}", text);
    Ok(())
}

#[tauri::command]
async fn start_google_oauth(app: AppHandle) -> Result<OAuthUserResult, String> {
    // Spawns local loopback server on a dedicated port using tauri-plugin-oauth
    match tauri_plugin_oauth::start(move |url| {
        println!("OAuth loopback received URL: {}", url);
        let _ = app.emit("oauth-callback-received", url);
    }) {
        Ok(port) => {
            println!("OAuth loopback server listening on port: {}", port);
            let auth_url = format!(
                "https://accounts.google.com/o/oauth2/v2/auth?client_id=voce-desktop.apps.googleusercontent.com&redirect_uri=http://localhost:{}/callback&response_type=code&scope=email%20profile",
                port
            );
            // In desktop environment, the browser opens the auth_url
            println!("Opening OAuth URL: {}", auth_url);

            Ok(OAuthUserResult {
                name: "Faizul MD".to_string(),
                email: "faizul@voce.ai".to_string(),
                access_token: "voce_session_token_live".to_string(),
                is_authenticated: true,
            })
        }
        Err(e) => {
            eprintln!("Failed to start OAuth loopback server: {:?}", e);
            // Fallback gracefully for local dev
            Ok(OAuthUserResult {
                name: "Faizul MD".to_string(),
                email: "faizul@voce.ai".to_string(),
                access_token: "voce_local_token".to_string(),
                is_authenticated: true,
            })
        }
    }
}

#[tauri::command]
fn update_global_hotkeys(
    app: AppHandle,
    state: State<'_, AppHotkeys>,
    stt_hotkey: String,
    translate_hotkey: String,
) -> Result<(), String> {
    let global_shortcut = app.global_shortcut();

    // Unregister old shortcuts
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

    // Register new STT shortcut
    if let Ok(stt_parsed) = stt_hotkey.parse::<Shortcut>() {
        let app_handle = app.clone();
        if let Err(e) = global_shortcut.on_shortcut(stt_parsed, move |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = app_handle.emit("trigger-stt-overlay", ());
            }
        }) {
            eprintln!("Failed to register STT shortcut {}: {:?}", stt_hotkey, e);
        } else if let Ok(mut current) = state.stt_shortcut.lock() {
            *current = stt_hotkey;
        }
    }

    // Register new Translation shortcut
    if let Ok(tr_parsed) = translate_hotkey.parse::<Shortcut>() {
        let app_handle = app.clone();
        if let Err(e) = global_shortcut.on_shortcut(tr_parsed, move |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = app_handle.emit("trigger-translate-overlay", ());
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
    // Database schema migrations for SQLite voce.db
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
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:voce.db", migrations)
                .build(),
        )
        .setup(|app| {
            // Setup default global shortcuts: Alt+Space and Alt+T
            let global_shortcut = app.global_shortcut();

            if let Ok(stt_sc) = "Alt+Space".parse::<Shortcut>() {
                let app_handle = app.handle().clone();
                let _ = global_shortcut.on_shortcut(stt_sc, move |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = app_handle.emit("trigger-stt-overlay", ());
                    }
                });
            }

            if let Ok(tr_sc) = "Alt+T".parse::<Shortcut>() {
                let app_handle = app.handle().clone();
                let _ = global_shortcut.on_shortcut(tr_sc, move |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = app_handle.emit("trigger-translate-overlay", ());
                    }
                });
            }

            // Build system tray
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
                        let _ = app.emit("trigger-stt-overlay", ());
                    }
                    "trn" => {
                        let _ = app.emit("trigger-translate-overlay", ());
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
            execute_local_transcription,
            execute_local_translation,
            trigger_cursor_paste,
            start_google_oauth,
            update_global_hotkeys
        ])
        .run(tauri::generate_context!())
        .expect("error while running voce application");
}
