use crate::clipboard::capture_synthetic_clipboard_selection;
use crate::models::{AppAudioState, AppHotkeys, AppSettingsState, TranslationEventData};
use crate::windows::position_window_at_cursor;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

// Handle global STT activation
pub fn trigger_stt_flow(app: &AppHandle) {
    position_window_at_cursor(app, "stt-overlay", 20);

    let state: State<'_, AppAudioState> = app.state();
    if let Ok(mut rec) = state.recorder.lock() {
        let _ = rec.start_recording();
    }

    let _ = app.emit("trigger-stt-overlay", ());
}

// Handle global Translation activation: captures highlighted text non-destructively
pub fn trigger_translate_flow(app: &AppHandle) {
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
    }

    let _ = app.emit("trigger-translate-overlay", event_data);
}

// Handle global Bookmark activation: captures highlighted text non-destructively
pub fn trigger_bookmark_flow(app: &AppHandle) {
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
    }

    let _ = app.emit("trigger-bookmark-overlay", &payload);
}

#[tauri::command]
pub fn update_global_hotkeys(
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
