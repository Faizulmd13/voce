use crate::models::AppAudioState;
use tauri::{AppHandle, Manager, PhysicalPosition, State};

pub fn open_browser_url(url: &str) -> Result<(), String> {
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
pub fn open_external_url(url: String) -> Result<(), String> {
    open_browser_url(&url)
}

// Smart Screen Boundary Detection & Cursor Placement
pub fn position_window_at_cursor(app: &AppHandle, label: &str, offset_y: i32) {
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
pub fn show_overlay(app: AppHandle, label: String, offset_y: Option<i32>) -> Result<(), String> {
    crate::clipboard::record_foreground_window();
    position_window_at_cursor(&app, &label, offset_y.unwrap_or(20));
    Ok(())
}

#[tauri::command]
pub fn hide_overlay(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.hide();
    }
    Ok(())
}

#[tauri::command]
pub fn start_audio_recording(audio_state: State<'_, AppAudioState>) -> Result<(), String> {
    if let Ok(mut rec) = audio_state.recorder.lock() {
        rec.start_recording()
    } else {
        Err("Failed to acquire audio recorder lock".to_string())
    }
}

#[tauri::command]
pub fn stop_audio_recording(audio_state: State<'_, AppAudioState>) -> Result<String, String> {
    if let Ok(mut rec) = audio_state.recorder.lock() {
        let path = rec.stop_recording()?;
        Ok(path.to_string_lossy().to_string())
    } else {
        Err("Failed to acquire audio recorder lock".to_string())
    }
}
