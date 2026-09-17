pub mod ai;
pub mod audio;
pub mod auth;
pub mod clipboard;
pub mod hotkeys;
pub mod models;
pub mod sync;
pub mod windows;

use audio::AudioRecorder;
use hotkeys::{trigger_bookmark_flow, trigger_stt_flow, trigger_translate_flow};
use models::{AppAudioState, AppHotkeys, AppSettingsState};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_sql::{Migration, MigrationKind};

#[tauri::command]
fn get_system_daemon_status() -> String {
    "active".to_string()
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
        Migration {
            version: 2,
            description: "add_drive_file_id_to_history",
            sql: "ALTER TABLE history ADD COLUMN drive_file_id TEXT;",
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
            windows::show_overlay,
            windows::hide_overlay,
            windows::start_audio_recording,
            windows::stop_audio_recording,
            windows::open_external_url,
            ai::execute_local_transcription,
            ai::execute_local_translation,
            ai::get_stored_api_key,
            ai::save_groq_api_key,
            ai::validate_groq_api_key,
            clipboard::get_clipboard_text,
            clipboard::inject_text_to_cursor,
            auth::start_google_oauth,
            auth::get_google_user_profile,
            auth::google_logout,
            sync::upload_bookmark_to_drive,
            sync::update_bookmark_in_drive,
            sync::fetch_bookmarks_from_drive,
            sync::delete_bookmark_from_drive,
            sync::delete_translation_from_drive,
            sync::clear_all_translations_from_drive,
            sync::sync_from_cloud,
            sync::retroactive_sync_local_data,
            hotkeys::update_global_hotkeys
        ])
        .run(tauri::generate_context!())
        .expect("error while running voce application");
}
