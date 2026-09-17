use enigo::{Direction, Enigo, Key, Keyboard, Settings as EnigoSettings};
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn get_clipboard_text() -> Result<String, String> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Clipboard error: {}", e))?;
    clipboard
        .get_text()
        .map_err(|e| format!("Failed to read clipboard text: {}", e))
}

/// Performs non-destructive synthetic clipboard copy and returns the selected text.
pub fn capture_synthetic_clipboard_selection() -> String {
    // 0. Strategic sleep before synthetic macros to ensure active OS window (e.g. web browser) focus has settled
    std::thread::sleep(Duration::from_millis(160));

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

    // 3. Force release modifier keys and shortcut keys, then synthesize Ctrl+C
    #[cfg(target_os = "windows")]
    {
        extern "system" {
            fn keybd_event(bVk: u8, bScan: u8, dwFlags: u32, dwExtraInfo: usize);
        }
        const KEYEVENTF_KEYUP: u32 = 0x0002;

        // Force hardware key release on Windows for Alt, Ctrl, Shift, Win, and hotkey trigger keys
        unsafe {
            keybd_event(0xA4, 0, KEYEVENTF_KEYUP, 0); // VK_LMENU (Left Alt)
            keybd_event(0xA5, 0, KEYEVENTF_KEYUP, 0); // VK_RMENU (Right Alt)
            keybd_event(0x12, 0, KEYEVENTF_KEYUP, 0); // VK_MENU (Alt)
            keybd_event(0xA2, 0, KEYEVENTF_KEYUP, 0); // VK_LCONTROL
            keybd_event(0xA3, 0, KEYEVENTF_KEYUP, 0); // VK_RCONTROL
            keybd_event(0x11, 0, KEYEVENTF_KEYUP, 0); // VK_CONTROL
            keybd_event(0x10, 0, KEYEVENTF_KEYUP, 0); // VK_SHIFT
            keybd_event(0x5B, 0, KEYEVENTF_KEYUP, 0); // VK_LWIN
            keybd_event(0x5C, 0, KEYEVENTF_KEYUP, 0); // VK_RWIN
            keybd_event(0x42, 0, KEYEVENTF_KEYUP, 0); // VK_B
            keybd_event(0x54, 0, KEYEVENTF_KEYUP, 0); // VK_T
        }

        if let Ok(mut enigo) = Enigo::new(&EnigoSettings::default()) {
            let _ = enigo.key(Key::Other(0x12), Direction::Release);
            let _ = enigo.key(Key::Alt, Direction::Release);
            let _ = enigo.key(Key::Control, Direction::Release);
            let _ = enigo.key(Key::Shift, Direction::Release);
            let _ = enigo.key(Key::Meta, Direction::Release);
            let _ = enigo.key(Key::Other(0x42), Direction::Release);
            let _ = enigo.key(Key::Other(0x54), Direction::Release);
        }

        // Sleep 40ms so Windows input queue clears all modifier states
        std::thread::sleep(Duration::from_millis(40));

        // Send discrete Ctrl+C sequence
        unsafe {
            keybd_event(0x11, 0, 0, 0); // VK_CONTROL DOWN
            std::thread::sleep(Duration::from_millis(25));
            keybd_event(0x43, 0, 0, 0); // VK_C DOWN
            std::thread::sleep(Duration::from_millis(30));
            keybd_event(0x43, 0, KEYEVENTF_KEYUP, 0); // VK_C UP
            std::thread::sleep(Duration::from_millis(25));
            keybd_event(0x11, 0, KEYEVENTF_KEYUP, 0); // VK_CONTROL UP
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(mut enigo) = Enigo::new(&EnigoSettings::default()) {
            let _ = enigo.key(Key::Alt, Direction::Release);
            let _ = enigo.key(Key::Control, Direction::Release);
            let _ = enigo.key(Key::Shift, Direction::Release);
            let _ = enigo.key(Key::Meta, Direction::Release);
            std::thread::sleep(Duration::from_millis(40));

            let _ = enigo.key(Key::Meta, Direction::Press);
            std::thread::sleep(Duration::from_millis(30));
            let _ = enigo.key(Key::Unicode('c'), Direction::Click);
            std::thread::sleep(Duration::from_millis(20));
            let _ = enigo.key(Key::Meta, Direction::Release);
        }
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        if let Ok(mut enigo) = Enigo::new(&EnigoSettings::default()) {
            let _ = enigo.key(Key::Alt, Direction::Release);
            let _ = enigo.key(Key::Control, Direction::Release);
            let _ = enigo.key(Key::Shift, Direction::Release);
            let _ = enigo.key(Key::Meta, Direction::Release);
            std::thread::sleep(Duration::from_millis(40));

            let _ = enigo.key(Key::Control, Direction::Press);
            std::thread::sleep(Duration::from_millis(30));
            let _ = enigo.key(Key::Unicode('c'), Direction::Click);
            std::thread::sleep(Duration::from_millis(20));
            let _ = enigo.key(Key::Control, Direction::Release);
        }
    }

    // 4. Poll clipboard for newly copied text (up to 400ms with 40ms intervals = 10 iterations)
    let mut captured_text = String::new();
    for _ in 0..10 {
        std::thread::sleep(Duration::from_millis(40));
        if let Ok(mut clipboard) = arboard::Clipboard::new() {
            if let Ok(text) = clipboard.get_text() {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    captured_text = trimmed.to_string();
                    break;
                }
            }
        }
    }

    // 5. If text was captured, return it; otherwise restore original clipboard
    if !captured_text.is_empty() {
        println!("[Synthetic Clipboard] Captured {} characters of selected text.", captured_text.len());
        captured_text
    } else {
        if !original_clipboard.is_empty() {
            if let Ok(mut clipboard) = arboard::Clipboard::new() {
                let _ = clipboard.set_text(&original_clipboard);
            }
        }
        String::new()
    }
}

#[tauri::command]
pub fn inject_text_to_cursor(app: AppHandle, text: String) -> Result<(), String> {
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
