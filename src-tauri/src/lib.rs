use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

#[derive(Debug, Serialize, Deserialize)]
pub struct TranslationPayload {
    pub source_text: String,
    pub target_lang: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DictationPayload {
    pub audio_buffer_path: String,
    pub model: String,
}

#[tauri::command]
fn get_system_daemon_status() -> String {
    "active".to_string()
}

#[tauri::command]
async fn execute_local_transcription(payload: DictationPayload) -> Result<String, String> {
    // In Phase 4, executes whisper.cpp sidecar binary on WAV file
    println!("Executing whisper transcription on: {}", payload.audio_buffer_path);
    Ok("The quick brown fox jumps over the lazy dog.".to_string())
}

#[tauri::command]
async fn execute_local_translation(payload: TranslationPayload) -> Result<String, String> {
    // In Phase 4, executes CTranslate2 / llama.cpp local model
    println!("Translating text to {}: {}", payload.target_lang, payload.source_text);
    Ok(format!("Translated [{}] into {}", payload.source_text, payload.target_lang))
}

#[tauri::command]
fn trigger_cursor_paste(_app: AppHandle, text: String) -> Result<(), String> {
    println!("Simulating OS cursor paste for text: {}", text);
    // OS hook will be hooked up via enigo / SendInput in Phase 4
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
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
                        let _ = app.emit("tray-trigger-stt", ());
                    }
                    "trn" => {
                        let _ = app.emit("tray-trigger-trn", ());
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
            trigger_cursor_paste
        ])
        .run(tauri::generate_context!())
        .expect("error while running voce application");
}
