use crate::models::UserProfile;
use crate::sync::ensure_drive_folder;
use crate::windows::open_browser_url;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub const OAUTH_REDIRECT_PORT: u16 = 14321;
pub const OAUTH_REDIRECT_URI: &str = "http://127.0.0.1:14321";

pub fn get_current_timestamp_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn get_google_client_id() -> String {
    let _ = dotenvy::dotenv();
    let _ = dotenvy::from_path("../.env");
    let _ = dotenvy::from_path(".env");
    std::env::var("GOOGLE_CLIENT_ID")
        .or_else(|_| std::env::var("VITE_GOOGLE_CLIENT_ID"))
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            option_env!("GOOGLE_CLIENT_ID")
                .map(|s| s.to_string())
                .filter(|s| !s.trim().is_empty())
        })
        .or_else(|| {
            option_env!("VITE_GOOGLE_CLIENT_ID")
                .map(|s| s.to_string())
                .filter(|s| !s.trim().is_empty())
        })
        .unwrap_or_default()
}

pub fn get_google_client_secret() -> String {
    let _ = dotenvy::dotenv();
    let _ = dotenvy::from_path("../.env");
    let _ = dotenvy::from_path(".env");
    std::env::var("GOOGLE_CLIENT_SECRET")
        .or_else(|_| std::env::var("VITE_GOOGLE_CLIENT_SECRET"))
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            option_env!("GOOGLE_CLIENT_SECRET")
                .map(|s| s.to_string())
                .filter(|s| !s.trim().is_empty())
        })
        .or_else(|| {
            option_env!("VITE_GOOGLE_CLIENT_SECRET")
                .map(|s| s.to_string())
                .filter(|s| !s.trim().is_empty())
        })
        .unwrap_or_default()
}

/// Retrieves a valid Google Access Token, refreshing it via the refresh token if expired.
pub async fn get_valid_google_access_token(app: &AppHandle) -> Result<String, String> {
    let store = app.store("store.json").map_err(|e| format!("Store error: {}", e))?;
    
    let access_token = store
        .get("google_access_token")
        .and_then(|v| v.as_str().map(|s| s.to_string()));
    let refresh_token = store
        .get("google_refresh_token")
        .and_then(|v| v.as_str().map(|s| s.to_string()));
    let expiry = store
        .get("google_token_expiry")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let now = get_current_timestamp_secs();

    if let Some(token) = access_token {
        if now + 60 < expiry {
            return Ok(token);
        }
    }

    if let Some(ref_token) = refresh_token {
        println!("[Google OAuth] Refreshing expired access token...");
        let client_id = get_google_client_id();
        let client_secret = get_google_client_secret();
        if client_id.is_empty() || client_secret.is_empty() {
            return Err("Google OAuth credentials missing for token refresh.".to_string());
        }
        let body = format!(
            "client_id={}&client_secret={}&refresh_token={}&grant_type=refresh_token",
            client_id, client_secret, ref_token
        );
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        let res = client
            .post("https://oauth2.googleapis.com/token")
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .await
            .map_err(|e| format!("Failed to refresh Google token: {}", e))?;

        if !res.status().is_success() {
            let err_text = res.text().await.unwrap_or_default();
            return Err(format!("Google token refresh failed: {}", err_text));
        }

        let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        if let Some(new_access_token) = json["access_token"].as_str() {
            let expires_in = json["expires_in"].as_u64().unwrap_or(3600);
            let new_expiry = now + expires_in;

            store.set("google_access_token", serde_json::Value::String(new_access_token.to_string()));
            store.set("google_token_expiry", serde_json::Value::Number(serde_json::Number::from(new_expiry)));
            let _ = store.save();
            return Ok(new_access_token.to_string());
        }
    }

    Err("Not authenticated with Google. Please sign in via Settings.".to_string())
}

#[tauri::command]
pub async fn start_google_oauth(app: AppHandle) -> Result<UserProfile, String> {
    println!("[Google OAuth] Starting loopback listener on port {}...", OAUTH_REDIRECT_PORT);

    // Bind temporary TCP listener to 127.0.0.1:14321
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", OAUTH_REDIRECT_PORT))
        .await
        .map_err(|e| format!("Failed to bind loopback server on port {}: {}", OAUTH_REDIRECT_PORT, e))?;

    let client_id = get_google_client_id();
    let client_secret = get_google_client_secret();

    if client_id.is_empty() || client_secret.is_empty() {
        return Err("Google OAuth credentials missing. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env".to_string());
    }

    // Strict Google Verification Compliance: ONLY drive.file + userinfo.profile + userinfo.email
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope=openid%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.profile%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.email%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.file&access_type=offline&prompt=consent",
        client_id,
        "http%3A%2F%2F127.0.0.1%3A14321"
    );

    println!("[Google OAuth] Launching browser consent flow: {}", auth_url);
    let _ = open_browser_url(&auth_url);

    // Wait for the browser redirect with timeout (120s)
    let accept_res = tokio::time::timeout(Duration::from_secs(120), listener.accept()).await;
    
    // Explicitly drop listener immediately so port 14321 is released right away
    drop(listener);

    let (mut stream, _) = accept_res
        .map_err(|_| "OAuth sign-in timed out after 2 minutes.".to_string())?
        .map_err(|e| format!("TCP accept failed: {}", e))?;

    let mut buf = [0u8; 4096];
    let bytes_read = stream
        .read(&mut buf)
        .await
        .map_err(|e| format!("Failed to read OAuth response: {}", e))?;
    let req_str = String::from_utf8_lossy(&buf[..bytes_read]);

    // Extract authorization code from GET request
    let mut auth_code = String::new();
    if let Some(pos) = req_str.find("code=") {
        let after_code = &req_str[pos + 5..];
        let end_pos = after_code.find('&').or_else(|| after_code.find(' ')).unwrap_or(after_code.len());
        let raw_code = &after_code[..end_pos];
        auth_code = raw_code.replace("%2F", "/").replace("%20", " ");
    }

    // Render HTML response back to user's browser
    let html_body = r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Voce - Authenticated</title>
</head>
<body style="background:#0a0a0a;color:#10b981;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
  <div style="text-align:center;padding:2.5rem;background:#171717;border:1px solid #262626;border-radius:16px;box-shadow:0 20px 25px -5px rgba(0,0,0,0.5);max-width:380px;">
    <div style="width:48px;height:48px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);border-radius:12px;display:flex;align-items:center;justify-content:center;margin:0 auto 1.25rem auto;color:#10b981;font-size:24px;font-weight:bold;">&#10003;</div>
    <h2 style="font-size:1.25rem;font-weight:600;color:#f5f5f5;margin:0 0 0.5rem 0;">Voce Authenticated</h2>
    <p style="color:#a3a3a3;font-size:0.875rem;line-height:1.5;margin:0;">Google Drive sync is ready. You can now close this tab and return to Voce.</p>
  </div>
</body>
</html>"#;

    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html_body.len(),
        html_body
    );

    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;
    let _ = stream.shutdown().await;
    drop(stream);

    if auth_code.is_empty() {
        return Err("Authorization code not found in browser callback.".to_string());
    }

    println!("[Google OAuth] Exchanging authorization code for tokens (with client secret)...");
    let token_body = format!(
        "client_id={}&client_secret={}&code={}&grant_type=authorization_code&redirect_uri={}",
        client_id, client_secret, auth_code, OAUTH_REDIRECT_URI
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let token_res = client
        .post("https://oauth2.googleapis.com/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(token_body)
        .send()
        .await
        .map_err(|e| format!("Token request error: {}", e))?;

    if !token_res.status().is_success() {
        let err = token_res.text().await.unwrap_or_default();
        return Err(format!("Google token exchange failed: {}", err));
    }

    let token_json: serde_json::Value = token_res.json().await.map_err(|e| e.to_string())?;
    let access_token = token_json["access_token"]
        .as_str()
        .ok_or_else(|| "Missing access_token in Google response".to_string())?
        .to_string();
    let refresh_token = token_json["refresh_token"]
        .as_str()
        .map(|s| s.to_string());
    let expires_in = token_json["expires_in"].as_u64().unwrap_or(3600);
    let expiry = get_current_timestamp_secs() + expires_in;

    // Fetch user profile from v3/userinfo
    println!("[Google OAuth] Fetching user profile from https://www.googleapis.com/oauth2/v3/userinfo...");
    let userinfo_res = client
        .get("https://www.googleapis.com/oauth2/v3/userinfo")
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("Userinfo request failed: {}", e))?;

    let userinfo_json: serde_json::Value = userinfo_res.json().await.map_err(|e| e.to_string())?;
    let name = userinfo_json["name"].as_str().unwrap_or("Voce User").to_string();
    let email = userinfo_json["email"].as_str().unwrap_or("").to_string();
    let avatar_url = userinfo_json["picture"].as_str().map(|s| s.to_string());

    println!("[Google OAuth] Logged in as: {} ({})", name, email);

    // Initialize Google Drive folders with auto-healing
    let voce_folder_id = ensure_drive_folder(&client, &access_token, "Voce", None).await.ok();
    let mut translations_folder_id = None;
    let mut bookmarks_folder_id = None;

    if let Some(ref v_id) = voce_folder_id {
        translations_folder_id = ensure_drive_folder(&client, &access_token, "translations", Some(v_id)).await.ok();
        bookmarks_folder_id = ensure_drive_folder(&client, &access_token, "bookmarks", Some(v_id)).await.ok();
    }

    // Persist credentials & profile to Tauri store
    let store = app.store("store.json").map_err(|e| format!("Store error: {}", e))?;
    store.set("google_access_token", serde_json::Value::String(access_token.clone()));
    if let Some(ref r) = refresh_token {
        store.set("google_refresh_token", serde_json::Value::String(r.clone()));
    }
    store.set("google_token_expiry", serde_json::Value::Number(serde_json::Number::from(expiry)));

    let profile = UserProfile {
        name,
        email,
        avatar_url,
        is_authenticated: true,
        google_drive_configured: bookmarks_folder_id.is_some(),
        voce_folder_id,
        bookmarks_folder_id,
        translations_folder_id,
    };

    store.set("google_user_profile", serde_json::to_value(&profile).unwrap_or_default());
    let _ = store.save();

    let _ = app.emit("profile-updated", &profile);
    let _ = app.emit("oauth-login-success", &profile);
    Ok(profile)
}

#[tauri::command]
pub fn get_google_user_profile(app: AppHandle) -> Result<UserProfile, String> {
    if let Ok(store) = app.store("store.json") {
        if let Some(val) = store.get("google_user_profile") {
            if let Ok(profile) = serde_json::from_value::<UserProfile>(val) {
                return Ok(profile);
            }
        }
    }
    Ok(UserProfile {
        name: "Anonymous User".to_string(),
        email: "Not signed in".to_string(),
        avatar_url: None,
        is_authenticated: false,
        google_drive_configured: false,
        voce_folder_id: None,
        bookmarks_folder_id: None,
        translations_folder_id: None,
    })
}

#[tauri::command]
pub fn google_logout(app: AppHandle) -> Result<UserProfile, String> {
    if let Ok(store) = app.store("store.json") {
        let _ = store.delete("google_access_token");
        let _ = store.delete("google_refresh_token");
        let _ = store.delete("google_token_expiry");
        let _ = store.delete("google_user_profile");
        let _ = store.delete("local_bookmarks");
        let _ = store.delete("local_history");
        let _ = store.save();
    }

    println!("[Google Auth] User logged out, local OAuth credentials & cached data purged.");
    let anonymous_profile = UserProfile {
        name: "Anonymous User".to_string(),
        email: "Not signed in".to_string(),
        avatar_url: None,
        is_authenticated: false,
        google_drive_configured: false,
        voce_folder_id: None,
        bookmarks_folder_id: None,
        translations_folder_id: None,
    };
    let _ = app.emit("profile-updated", &anonymous_profile);
    let _ = app.emit("oauth-logout-success", &anonymous_profile);
    Ok(anonymous_profile)
}
