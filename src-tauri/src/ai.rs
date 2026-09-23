use crate::models::{DictationMetrics, DictationPayload, TranslationPayload, UserProfile};
use sqlx::{sqlite::SqliteConnectOptions, Connection, Row, SqliteConnection};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;

async fn get_voce_sqlite_conn(app: &AppHandle) -> Result<SqliteConnection, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app_data_dir: {}", e))?;
    let _ = std::fs::create_dir_all(&app_data_dir);
    let db_path = app_data_dir.join("voce.db");
    let opts = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true);

    let mut conn = SqliteConnection::connect_with(&opts)
        .await
        .map_err(|e| format!("Failed to connect to SQLite: {}", e))?;

    // Ensure dictations table exists
    let _ = sqlx::query(
        "CREATE TABLE IF NOT EXISTS dictations (
            id TEXT PRIMARY KEY,
            word_count INTEGER NOT NULL,
            timestamp TEXT NOT NULL,
            duration_ms INTEGER DEFAULT 0
        );"
    )
    .execute(&mut conn)
    .await;

    Ok(conn)
}

#[tauri::command]
pub async fn get_accumulated_word_count(app: AppHandle) -> Result<DictationMetrics, String> {
    let mut conn = get_voce_sqlite_conn(&app).await?;
    let row = sqlx::query("SELECT COALESCE(SUM(word_count), 0) as total_words, COUNT(*) as total_dictations FROM dictations")
        .fetch_one(&mut conn)
        .await;

    match row {
        Ok(r) => {
            let total_words: i64 = r.try_get("total_words").unwrap_or(0);
            let total_dictations: i64 = r.try_get("total_dictations").unwrap_or(0);
            Ok(DictationMetrics {
                total_words,
                total_dictations,
            })
        }
        Err(_) => Ok(DictationMetrics {
            total_words: 0,
            total_dictations: 0,
        }),
    }
}

#[tauri::command]
pub async fn record_dictation(
    app: AppHandle,
    id: Option<String>,
    word_count: i64,
    duration_ms: Option<i64>,
) -> Result<DictationMetrics, String> {
    let mut conn = get_voce_sqlite_conn(&app).await?;
    let rec_id = id.unwrap_or_else(|| format!("stt_{}", chrono::Local::now().timestamp_millis()));
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let duration = duration_ms.unwrap_or(0);

    let _ = sqlx::query(
        "INSERT INTO dictations (id, word_count, timestamp, duration_ms)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET word_count = ?2, timestamp = ?3, duration_ms = ?4"
    )
    .bind(&rec_id)
    .bind(word_count)
    .bind(&timestamp)
    .bind(duration)
    .execute(&mut conn)
    .await
    .map_err(|e| format!("Failed to insert dictation: {}", e))?;

    get_accumulated_word_count(app).await
}

/// Helper to fetch the user's Groq API key securely from the local store or env override
pub fn get_groq_api_key(app: &AppHandle) -> Result<String, String> {
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
pub fn get_stored_api_key(app: AppHandle) -> Result<Option<String>, String> {
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
pub fn save_groq_api_key(app: AppHandle, api_key: String) -> Result<(), String> {
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
pub async fn validate_groq_api_key(api_key: String) -> Result<bool, String> {
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
pub async fn execute_cloud_transcription(
    app: AppHandle,
    payload: DictationPayload,
) -> Result<String, String> {
    let wav_path = payload.audio_buffer_path.clone();
    println!(
        "[Groq STT] Executing cloud transcription on WAV buffer: {}",
        wav_path
    );

    let groq_key = get_groq_api_key(&app)?;

    let file_bytes = std::fs::read(&wav_path).map_err(|e| {
        let _ = std::fs::remove_file(&wav_path);
        format!("Failed to read WAV file at {}: {}", wav_path, e)
    })?;

    // Purge temporary recording WAV file from OS temp directory immediately
    let _ = std::fs::remove_file(&wav_path);

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
    let word_count = transcript.split_whitespace().count() as i64;

    println!(
        "[Groq STT] Transcription result: \"{}\" (words: {})",
        transcript, word_count
    );

    let stt_id = format!("stt_{}", chrono::Local::now().timestamp_millis());
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    if word_count > 0 {
        if let Ok(mut conn) = get_voce_sqlite_conn(&app).await {
            let _ = sqlx::query(
                "INSERT INTO dictations (id, word_count, timestamp, duration_ms) VALUES (?1, ?2, ?3, ?4)"
            )
            .bind(&stt_id)
            .bind(word_count)
            .bind(&timestamp)
            .bind(0i64)
            .execute(&mut conn)
            .await;
            println!("[Groq STT] Persisted dictation {} words into SQLite.", word_count);
        }
    }

    let _ = app.emit(
        "transcription-completed",
        serde_json::json!({
            "id": &stt_id,
            "timestamp": &timestamp,
            "text": &transcript,
            "words": word_count,
            "word_count": word_count,
        }),
    );
    Ok(transcript)
}

#[tauri::command]
pub async fn execute_cloud_translation(
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

    let candidate_models = [
    "openai/gpt-oss-20b",    // Fastest default for translations
    "openai/gpt-oss-120b",   // Heavy reasoning fallback
    "qwen/qwen3.8-27b",      // Solid multi-lingual fallback
    "groq/compound",         // Groq's agentic system fallback
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
                            let trn_id = format!("trn_{}", chrono::Local::now().timestamp_millis());
                            let trn_timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
                            println!("[Groq Translation] Success using model '{}': \"{}\" (id: {})", model_name, translated_text, trn_id);
                            
                            let _ = app.emit("translation-completed", serde_json::json!({
                                "id": &trn_id,
                                "timestamp": &trn_timestamp,
                                "source_text": &text,
                                "translated_text": &translated_text,
                                "source_lang": source_lang_hint,
                                "target_lang": target_lang,
                                "char_count": text.len(),
                            }));

                            // Live background upload to Google Drive if authenticated
                            let app_clone = app.clone();
                            let trn_id_clone = trn_id.clone();
                            let text_clone = text.clone();
                            let translated_clone = translated_text.clone();
                            tokio::spawn(async move {
                                if let Ok(access_token) = crate::auth::get_valid_google_access_token(&app_clone).await {
                                    let store = app_clone.store("store.json").ok();
                                    let mut translations_folder_id = None;
                                    if let Some(ref st) = store {
                                        if let Some(val) = st.get("google_user_profile") {
                                            if let Ok(p) = serde_json::from_value::<UserProfile>(val) {
                                                translations_folder_id = p.translations_folder_id;
                                            }
                                        }
                                    }
                                    let client = reqwest::Client::new();
                                    let folder_id = match translations_folder_id {
                                        Some(id) => id,
                                        None => {
                                            if let Ok(voce_id) = crate::sync::ensure_drive_folder(&client, &access_token, "Voce", None).await {
                                                crate::sync::ensure_drive_folder(&client, &access_token, "translations", Some(&voce_id)).await.unwrap_or_default()
                                            } else {
                                                String::new()
                                            }
                                        }
                                    };
                                    if !folder_id.is_empty() {
                                        let _ = crate::sync::upload_translation_txt_to_drive(&client, &access_token, &folder_id, &trn_id_clone, &text_clone, &translated_clone).await;
                                        println!("[Google Drive Live] Live translation '{}' uploaded to Drive.", trn_id_clone);
                                    }
                                }
                            });

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
