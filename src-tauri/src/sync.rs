use crate::auth::get_valid_google_access_token;
use crate::models::{
    BookmarkItem, BookmarkPayload, CloudSyncResult, TranslationRecordPayload, TranslationSyncItem,
    UserProfile,
};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;

pub fn url_encode(input: &str) -> String {
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

/// Query or create a specific folder in Google Drive (compliant with drive.file scope)
pub async fn ensure_drive_folder(
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

    if let Ok(search_res) = client
        .get(&search_url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
    {
        if search_res.status().is_success() {
            if let Ok(json) = search_res.json::<serde_json::Value>().await {
                if let Some(files) = json["files"].as_array() {
                    if let Some(first) = files.first() {
                        if let Some(id) = first["id"].as_str() {
                            println!("[Google Drive] Found existing folder '{}': {}", folder_name, id);
                            return Ok(id.to_string());
                        }
                    }
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
        // If parent ID is invalid or not found (e.g. lost permissions under drive.file), attempt creating Voce root first
        if parent_id.is_some() && (err.contains("notFound") || err.contains("File not found") || err.contains("404")) {
            println!("[Google Drive] Parent folder lost visibility. Re-creating Voce root folder...");
            let new_root = Box::pin(ensure_drive_folder(client, access_token, "Voce", None)).await?;
            return Box::pin(ensure_drive_folder(client, access_token, folder_name, Some(&new_root))).await;
        }
        return Err(format!("Google Drive folder creation error: {}", err));
    }

    let json: serde_json::Value = create_res.json().await.map_err(|e| e.to_string())?;
    if let Some(id) = json["id"].as_str() {
        println!("[Google Drive] Successfully created folder '{}': {}", folder_name, id);
        return Ok(id.to_string());
    }

    Err(format!("Failed to retrieve created folder ID for '{}'", folder_name))
}

pub fn generate_timestamp_filename() -> String {
    chrono::Local::now().format("%Y-%m-%d_%H-%M-%S.txt").to_string()
}

pub fn parse_timestamp_from_filename(filename: &str, fallback_created_time: &str) -> String {
    if let Some(stripped) = filename.strip_suffix(".txt").or_else(|| filename.strip_suffix(".json")) {
        let clean = stripped
            .strip_prefix("bookmark_")
            .or_else(|| stripped.strip_prefix("translation_"))
            .unwrap_or(stripped);
        if clean.len() >= 19
            && clean.chars().nth(4) == Some('-')
            && clean.chars().nth(7) == Some('-')
            && clean.chars().nth(10) == Some('_')
        {
            let date_part = &clean[..10];
            let time_part = clean[11..19].replace("-", ":");
            return format!("{} {}", date_part, time_part);
        }
    }
    if !fallback_created_time.is_empty() {
        return fallback_created_time
            .replace("T", " ")
            .split('.')
            .next()
            .unwrap_or(fallback_created_time)
            .to_string();
    }
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn format_bookmark_plain_text(id: &str, title: Option<&str>, source: Option<&str>, content: &str) -> String {
    let t = title.unwrap_or("");
    let s = source.unwrap_or("");
    format!("ID: {}\nTitle: {}\nSource: {}\n\n{}", id, t, s, content.trim())
}

pub fn parse_bookmark_text(raw_text: &str) -> (Option<String>, Option<String>, Option<String>, String) {
    let normalized = raw_text.replace("\r\n", "\n");
    if let Some((headers, body)) = normalized.split_once("\n\n") {
        let mut id = None;
        let mut title = None;
        let mut source = None;
        for line in headers.lines() {
            if let Some(i) = line.strip_prefix("ID: ") {
                let trimmed = i.trim();
                if !trimmed.is_empty() {
                    id = Some(trimmed.to_string());
                }
            } else if let Some(t) = line.strip_prefix("Title: ") {
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
        (id, title, source, body.trim().to_string())
    } else {
        (None, None, None, normalized.trim().to_string())
    }
}

pub fn format_translation_plain_text(id: &str, source_text: &str, translated_text: &str) -> String {
    format!("ID: {}\nOriginal: {}\n\nTranslated: {}", id, source_text.trim(), translated_text.trim())
}

pub fn parse_translation_text(raw_text: &str) -> (Option<String>, String, String) {
    let normalized = raw_text.replace("\r\n", "\n");
    let mut id = None;

    // 1. Check if raw text starts with JSON
    if normalized.trim().starts_with('{') {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&normalized) {
            let j_id = json["id"].as_str().map(|s| s.to_string());
            let src = json["source_text"]
                .as_str()
                .or_else(|| json["sourceText"].as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let trn = json["translated_text"]
                .as_str()
                .or_else(|| json["translatedText"].as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            return (j_id, src, trn);
        }
    }

    // 2. Extract ID if present in header lines
    for line in normalized.lines() {
        if let Some(stripped) = line.strip_prefix("ID: ") {
            let trimmed = stripped.trim();
            if !trimmed.is_empty() {
                id = Some(trimmed.to_string());
            }
            break;
        }
    }

    // 3. Extract Original & Translated text
    let text_without_id = if normalized.starts_with("ID: ") {
        if let Some(pos) = normalized.find('\n') {
            &normalized[pos + 1..]
        } else {
            &normalized[..]
        }
    } else {
        &normalized[..]
    };

    if let Some((before_trans, after_trans)) = text_without_id.split_once("Translated:") {
        let mut src = before_trans.trim();
        if let Some(stripped_orig) = src.strip_prefix("Original:") {
            src = stripped_orig.trim();
        }
        let trn = after_trans.trim();
        return (id, src.to_string(), trn.to_string());
    }

    if let Some((before_split, after_split)) = text_without_id.split_once("\n\n") {
        let mut src = before_split.trim();
        if let Some(stripped_orig) = src.strip_prefix("Original:") {
            src = stripped_orig.trim();
        }
        let trn = after_split.trim();
        return (id, src.to_string(), trn.to_string());
    }

    (id, text_without_id.trim().to_string(), String::new())
}

pub async fn upload_bookmark_txt_to_drive(
    client: &reqwest::Client,
    access_token: &str,
    folder_id: &str,
    id: &str,
    title: Option<&str>,
    source: Option<&str>,
    content: &str,
) -> Result<String, String> {
    let filename = generate_timestamp_filename();
    let plain_content = format_bookmark_plain_text(id, title, source, content);

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

pub async fn upload_translation_txt_to_drive(
    client: &reqwest::Client,
    access_token: &str,
    folder_id: &str,
    id: &str,
    source_text: &str,
    translated_text: &str,
) -> Result<String, String> {
    let filename = generate_timestamp_filename();
    let plain_content = format_translation_plain_text(id, source_text, translated_text);

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
pub async fn upload_bookmark_to_drive(
    app: AppHandle,
    payload: BookmarkPayload,
) -> Result<BookmarkItem, String> {
    println!("[Google Drive] Uploading single bookmark '{}'...", payload.id);
    let access_token = get_valid_google_access_token(&app).await?;
    let store = app.store("store.json").map_err(|e| format!("Store error: {}", e))?;

    let mut bookmarks_folder_id = None;
    if let Some(val) = store.get("google_user_profile") {
        if let Ok(p) = serde_json::from_value::<UserProfile>(val) {
            bookmarks_folder_id = p.bookmarks_folder_id;
        }
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let folder_id = match bookmarks_folder_id {
        Some(id) => id,
        None => {
            let voce_id = ensure_drive_folder(&client, &access_token, "Voce", None).await?;
            let bm_id = ensure_drive_folder(&client, &access_token, "bookmarks", Some(&voce_id)).await?;
            if let Some(val) = store.get("google_user_profile") {
                if let Ok(mut p) = serde_json::from_value::<UserProfile>(val) {
                    p.voce_folder_id = Some(voce_id);
                    p.bookmarks_folder_id = Some(bm_id.clone());
                    p.google_drive_configured = true;
                    store.set("google_user_profile", serde_json::to_value(&p).unwrap_or_default());
                    let _ = store.save();
                }
            }
            bm_id
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
pub async fn update_bookmark_in_drive(
    app: AppHandle,
    payload: BookmarkPayload,
    drive_file_id: String,
) -> Result<BookmarkItem, String> {
    println!("[Google Drive] Overwriting bookmark '{}' ({}) on Drive...", payload.id, drive_file_id);
    let access_token = get_valid_google_access_token(&app).await?;
    let plain_content = format_bookmark_plain_text(
        &payload.id,
        payload.title.as_deref(),
        payload.source.as_deref(),
        &payload.content,
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
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
pub async fn fetch_bookmarks_from_drive(app: AppHandle) -> Result<Vec<BookmarkItem>, String> {
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

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let folder_id = match bookmarks_folder_id {
        Some(id) => id,
        None => {
            let voce_id = ensure_drive_folder(&client, &access_token, "Voce", None).await?;
            let bm_id = ensure_drive_folder(&client, &access_token, "bookmarks", Some(&voce_id)).await?;
            if let Some(val) = store.get("google_user_profile") {
                if let Ok(mut p) = serde_json::from_value::<UserProfile>(val) {
                    p.voce_folder_id = Some(voce_id);
                    p.bookmarks_folder_id = Some(bm_id.clone());
                    p.google_drive_configured = true;
                    store.set("google_user_profile", serde_json::to_value(&p).unwrap_or_default());
                    let _ = store.save();
                }
            }
            bm_id
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
                                let (parsed_id, title, source, content) = parse_bookmark_text(&text_data);
                                let final_id = parsed_id.unwrap_or_else(|| format!("bm_{}", file_id));
                                results.push(BookmarkItem {
                                    id: final_id,
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

static SYNC_MUTEX: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[tauri::command]
pub async fn delete_bookmark_from_drive(app: AppHandle, file_id: String) -> Result<(), String> {
    let access_token = get_valid_google_access_token(&app).await?;
    let client = reqwest::Client::new();
    let res = client
        .delete(format!("https://www.googleapis.com/drive/v3/files/{}", file_id))
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("Failed to delete bookmark file from Google Drive: {}", e))?;

    if !res.status().is_success() {
        let err = res.text().await.unwrap_or_default();
        return Err(format!("Drive delete error: {}", err));
    }

    println!("[Google Drive] Deleted bookmark file: {}", file_id);
    Ok(())
}

#[tauri::command]
pub async fn delete_translation_from_drive(
    app: AppHandle,
    file_id: Option<String>,
    id: Option<String>,
    source_text: Option<String>,
) -> Result<(), String> {
    let access_token = match get_valid_google_access_token(&app).await {
        Ok(t) => t,
        Err(e) => {
            println!("[Google Drive] Cannot delete translation (not logged in): {}", e);
            return Ok(());
        }
    };
    let client = reqwest::Client::new();

    // 1. Direct deletion if drive file_id is known
    if let Some(fid) = file_id.filter(|s| !s.trim().is_empty()) {
        let res = client
            .delete(format!("https://www.googleapis.com/drive/v3/files/{}", fid))
            .header("Authorization", format!("Bearer {}", access_token))
            .send()
            .await;
        if let Ok(r) = res {
            if r.status().is_success() {
                println!("[Google Drive] Deleted cloud translation by file_id: {}", fid);
                return Ok(());
            }
        }
    }

    // 2. Query translations folder to locate file by ID or matching source text
    let store = match app.store("store.json") {
        Ok(s) => s,
        Err(_) => return Ok(()),
    };
    let mut translations_folder_id = None;
    if let Some(val) = store.get("google_user_profile") {
        if let Ok(p) = serde_json::from_value::<UserProfile>(val) {
            translations_folder_id = p.translations_folder_id;
        }
    }

    if let Some(folder_id) = translations_folder_id {
        let t_query = format!("'{}' in parents and trashed = false", folder_id);
        let t_url = format!(
            "https://www.googleapis.com/drive/v3/files?q={}&fields=files(id,name)&pageSize=1000",
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
                            if let Some(f_id) = file["id"].as_str() {
                                if let Ok(c_res) = client
                                    .get(format!("https://www.googleapis.com/drive/v3/files/{}?alt=media", f_id))
                                    .header("Authorization", format!("Bearer {}", access_token))
                                    .send()
                                    .await
                                {
                                    if c_res.status().is_success() {
                                        let text_data = c_res.text().await.unwrap_or_default();
                                        let (parsed_id, src, _) = parse_translation_text(&text_data);
                                        let matches_id = id.as_ref().map(|target_id| parsed_id.as_deref() == Some(target_id)).unwrap_or(false);
                                        let matches_src = source_text.as_ref().map(|target_src| src.trim() == target_src.trim()).unwrap_or(false);

                                        if matches_id || matches_src {
                                            let _ = client
                                                .delete(format!("https://www.googleapis.com/drive/v3/files/{}", f_id))
                                                .header("Authorization", format!("Bearer {}", access_token))
                                                .send()
                                                .await;
                                            println!("[Google Drive] Deleted matching cloud translation file '{}' (Drive ID: {})", id.as_deref().unwrap_or(""), f_id);
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

    Ok(())
}

#[tauri::command]
pub async fn clear_all_translations_from_drive(app: AppHandle) -> Result<(), String> {
    let access_token = match get_valid_google_access_token(&app).await {
        Ok(t) => t,
        Err(e) => {
            println!("[Google Drive] Cannot clear cloud translations (not logged in): {}", e);
            return Ok(());
        }
    };
    let client = reqwest::Client::new();
    let store = match app.store("store.json") {
        Ok(s) => s,
        Err(_) => return Ok(()),
    };
    let mut translations_folder_id = None;
    if let Some(val) = store.get("google_user_profile") {
        if let Ok(p) = serde_json::from_value::<UserProfile>(val) {
            translations_folder_id = p.translations_folder_id;
        }
    }

    if let Some(folder_id) = translations_folder_id {
        let t_query = format!("'{}' in parents and trashed = false", folder_id);
        let t_url = format!(
            "https://www.googleapis.com/drive/v3/files?q={}&fields=files(id)&pageSize=1000",
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
                            if let Some(f_id) = file["id"].as_str() {
                                let _ = client
                                    .delete(format!("https://www.googleapis.com/drive/v3/files/{}", f_id))
                                    .header("Authorization", format!("Bearer {}", access_token))
                                    .send()
                                    .await;
                            }
                        }
                        println!("[Google Drive] Cleared {} translation files from Google Drive.", files.len());
                    }
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn sync_from_cloud(
    app: AppHandle,
    local_bookmarks: Option<Vec<BookmarkItem>>,
    local_translations: Option<Vec<TranslationRecordPayload>>,
) -> Result<CloudSyncResult, String> {
    let _sync_guard = SYNC_MUTEX.lock().await;
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

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

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

    // 2. Fetch & Auto-Heal Cloud Bookmarks (Purge duplicate clones in Drive)
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
                                        let (parsed_id, title, source, content) = if text_data.trim().starts_with('{') {
                                            if let Ok(item_json) = serde_json::from_str::<serde_json::Value>(&text_data) {
                                                let id = item_json["id"].as_str().unwrap_or(file_id).to_string();
                                                let title = item_json["title"].as_str().map(|s| s.to_string());
                                                let content = item_json["content"].as_str().unwrap_or("").trim().to_string();
                                                let source = item_json["source"].as_str().map(|s| s.to_string());
                                                (Some(id), title, source, content)
                                            } else {
                                                (None, None, None, String::new())
                                            }
                                        } else {
                                            parse_bookmark_text(&text_data)
                                        };

                                        if content.trim().is_empty() {
                                            continue;
                                        }

                                        let final_id = parsed_id.unwrap_or_else(|| format!("bm_{}", file_id));
                                        let content_trimmed = content.trim().to_string();

                                        // Auto-Heal: Check if a duplicate already exists in cloud_bookmarks
                                        let is_duplicate = cloud_bookmarks.iter().any(|existing| {
                                            existing.id == final_id || existing.content.trim() == content_trimmed
                                        });

                                        if is_duplicate {
                                            println!("[Google Drive Auto-Heal] Deleting duplicate cloud bookmark file clone: {}", file_id);
                                            let _ = client
                                                .delete(format!("https://www.googleapis.com/drive/v3/files/{}", file_id))
                                                .header("Authorization", format!("Bearer {}", access_token))
                                                .send()
                                                .await;
                                        } else {
                                            cloud_bookmarks.push(BookmarkItem {
                                                id: final_id,
                                                title,
                                                content: content_trimmed,
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
        } else {
            let err = res.text().await.unwrap_or_default();
            eprintln!("[Google Drive Sync] Failed to query cloud bookmarks: {}", err);
        }
    }

    // 3. Fetch & Auto-Heal Cloud Translations (Purge duplicate clones in Drive)
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
                                        let (parsed_id, source_text, translated_text) = parse_translation_text(&text_data);
                                        let src_trimmed = source_text.trim().to_string();
                                        let trn_trimmed = translated_text.trim().to_string();

                                        if src_trimmed.is_empty() || trn_trimmed.is_empty() {
                                            continue;
                                        }

                                        let final_id = parsed_id.unwrap_or_else(|| format!("trn_{}", file_id));

                                        // Auto-Heal: Check if duplicate translation exists in cloud_translations
                                        let is_duplicate = cloud_translations.iter().any(|existing| {
                                            existing.id == final_id
                                                || (existing.source_text.trim() == src_trimmed && existing.translated_text.trim() == trn_trimmed)
                                        });

                                        if is_duplicate {
                                            println!("[Google Drive Auto-Heal] Deleting duplicate cloud translation file clone: {}", file_id);
                                            let _ = client
                                                .delete(format!("https://www.googleapis.com/drive/v3/files/{}", file_id))
                                                .header("Authorization", format!("Bearer {}", access_token))
                                                .send()
                                                .await;
                                        } else {
                                            let char_count = src_trimmed.len();
                                            cloud_translations.push(TranslationRecordPayload {
                                                id: final_id,
                                                timestamp,
                                                source_text: src_trimmed,
                                                source_lang: "Auto-detected".to_string(),
                                                translated_text: trn_trimmed,
                                                target_lang: "English".to_string(),
                                                char_count,
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
        } else {
            let err = res.text().await.unwrap_or_default();
            eprintln!("[Google Drive Sync] Failed to query cloud translations: {}", err);
        }
    }

    // 4. Strict Deduplication for Bookmarks: Match by ID, Drive File ID, or Content
    let mut merged_bookmarks: Vec<BookmarkItem> = cloud_bookmarks.clone();
    let in_local_bms = local_bookmarks.unwrap_or_default();

    for loc in in_local_bms {
        let loc_content = loc.content.trim();
        if loc_content.is_empty() {
            continue;
        }

        let existing_match = cloud_bookmarks.iter().find(|cb| {
            cb.id == loc.id
                || (loc.drive_file_id.is_some() && cb.drive_file_id == loc.drive_file_id)
                || cb.content.trim() == loc_content
        });

        match existing_match {
            Some(matched) => {
                // If matched, ensure local representation retains the drive_file_id without re-uploading
                if let Some(pos) = merged_bookmarks.iter().position(|b| b.id == matched.id || b.drive_file_id == matched.drive_file_id) {
                    if merged_bookmarks[pos].title.is_none() && loc.title.is_some() {
                        merged_bookmarks[pos].title = loc.title;
                    }
                }
            }
            None => {
                // Unique local bookmark, upload once to Drive
                println!("[Google Drive Sync] Uploading unique local bookmark '{}' to Drive...", loc.id);
                match upload_bookmark_txt_to_drive(
                    &client,
                    &access_token,
                    &bookmarks_folder_id,
                    &loc.id,
                    loc.title.as_deref(),
                    loc.source.as_deref(),
                    &loc.content,
                ).await {
                    Ok(new_file_id) => {
                        let mut uploaded_bm = loc.clone();
                        uploaded_bm.drive_file_id = Some(new_file_id);
                        merged_bookmarks.push(uploaded_bm);
                    }
                    Err(e) => {
                        eprintln!("[Google Drive Sync] Failed to upload bookmark '{}': {}", loc.id, e);
                        merged_bookmarks.push(loc);
                    }
                }
            }
        }
    }

    // 5. Strict Deduplication for Translations: Match by ID or Source+Translation content
    let mut merged_translations: Vec<TranslationRecordPayload> = cloud_translations.clone();
    let in_local_trns = local_translations.unwrap_or_default();

    for loc in in_local_trns {
        let loc_src = loc.source_text.trim();
        let loc_trn = loc.translated_text.trim();
        if loc_src.is_empty() || loc_trn.is_empty() {
            continue;
        }

        let exists_in_cloud = cloud_translations.iter().any(|ct| {
            ct.id == loc.id
                || (loc.drive_file_id.is_some() && ct.drive_file_id == loc.drive_file_id)
                || (ct.source_text.trim() == loc_src && ct.translated_text.trim() == loc_trn)
        });

        if !exists_in_cloud {
            println!("[Google Drive Sync] Uploading unique local translation '{}' to Drive...", loc.id);
            match upload_translation_txt_to_drive(
                &client,
                &access_token,
                &translations_folder_id,
                &loc.id,
                &loc.source_text,
                &loc.translated_text,
            ).await {
                Ok(new_file_id) => {
                    let mut uploaded_trn = loc.clone();
                    uploaded_trn.drive_file_id = Some(new_file_id);
                    merged_translations.push(uploaded_trn);
                }
                Err(e) => {
                    eprintln!("[Google Drive Sync] Failed to upload translation '{}': {}", loc.id, e);
                    merged_translations.push(loc);
                }
            }
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

#[tauri::command]
pub async fn retroactive_sync_local_data(
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
