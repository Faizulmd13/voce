fn main() {
    // Load .env from workspace root or current directory
    let _ = dotenvy::from_path("../.env");
    let _ = dotenvy::from_path(".env");
    let _ = dotenvy::dotenv();

    // Export Google OAuth credentials to the rustc environment at compile time
    if let Ok(val) = std::env::var("GOOGLE_CLIENT_ID").or_else(|_| std::env::var("VITE_GOOGLE_CLIENT_ID")) {
        if !val.trim().is_empty() {
            println!("cargo:rustc-env=GOOGLE_CLIENT_ID={}", val.trim());
        }
    }

    if let Ok(val) = std::env::var("GOOGLE_CLIENT_SECRET").or_else(|_| std::env::var("VITE_GOOGLE_CLIENT_SECRET")) {
        if !val.trim().is_empty() {
            println!("cargo:rustc-env=GOOGLE_CLIENT_SECRET={}", val.trim());
        }
    }

    // Tell Cargo to re-run this build script if the .env files or environment variables change
    println!("cargo:rerun-if-changed=../.env");
    println!("cargo:rerun-if-changed=.env");
    println!("cargo:rerun-if-env-changed=GOOGLE_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=GOOGLE_CLIENT_SECRET");
    println!("cargo:rerun-if-env-changed=VITE_GOOGLE_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=VITE_GOOGLE_CLIENT_SECRET");

    tauri_build::build();
}
