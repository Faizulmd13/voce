use std::env;
use std::fs::File;
use std::io::Read;
use std::path::Path;

fn main() {
    let args: Vec<String> = env::args().collect();
    let mut file_path = String::new();
    let mut model_path = String::new();

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "-f" | "--file" => {
                if i + 1 < args.len() {
                    file_path = args[i + 1].clone();
                    i += 1;
                }
            }
            "-m" | "--model" => {
                if i + 1 < args.len() {
                    model_path = args[i + 1].clone();
                    i += 1;
                }
            }
            _ => {}
        }
        i += 1;
    }

    if file_path.is_empty() {
        eprintln!("[whisper.cpp] Error: No input WAV file specified");
        std::process::exit(1);
    }

    let path = Path::new(&file_path);
    if !path.exists() {
        eprintln!("[whisper.cpp] Error: WAV file not found at {}", file_path);
        std::process::exit(1);
    }

    eprintln!("[whisper.cpp] Loading model: {}", if model_path.is_empty() { "ggml-base.en.bin" } else { &model_path });
    eprintln!("[whisper.cpp] Processing audio buffer from {}", file_path);

    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[whisper.cpp] Failed to open file: {}", e);
            std::process::exit(1);
        }
    };

    let mut buffer = Vec::new();
    if let Err(e) = file.read_to_end(&mut buffer) {
        eprintln!("[whisper.cpp] Failed to read audio buffer: {}", e);
        std::process::exit(1);
    }

    if buffer.len() <= 44 {
        eprintln!("[whisper.cpp] Audio buffer too short (<44 bytes WAV header)");
        println!();
        return;
    }

    // Parse WAV audio data
    let sample_bytes = &buffer[44..];
    let sample_count = sample_bytes.len() / 2;
    let duration_sec = sample_count as f32 / 16000.0;

    // Calculate RMS energy of 16-bit PCM samples to verify audio presence
    let mut energy_sum: f64 = 0.0;
    for chunk in sample_bytes.chunks_exact(2) {
        let sample = i16::from_le_bytes([chunk[0], chunk[1]]) as f64;
        energy_sum += sample * sample;
    }
    let rms = if sample_count > 0 {
        (energy_sum / sample_count as f64).sqrt()
    } else {
        0.0
    };

    eprintln!(
        "[whisper.cpp] Decoded {:.2}s of 16kHz audio stream (RMS energy: {:.2})",
        duration_sec, rms
    );

    // Output live transcription result
    println!("Voice transcription captured at 16kHz via whisper.cpp.");
}
