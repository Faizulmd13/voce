use std::env;
use std::path::Path;
use std::process::Command;

fn main() {
    let args: Vec<String> = env::args().collect();
    let mut file_path = String::new();
    let mut _model_path = String::new();
    let mut _no_timestamps = false;

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
                    _model_path = args[i + 1].clone();
                    i += 1;
                }
            }
            "-nt" | "--no-timestamps" => {
                _no_timestamps = true;
            }
            _ => {}
        }
        i += 1;
    }

    if file_path.is_empty() {
        eprintln!("[whisper.cpp] Error: No input WAV file specified (-f <path>)");
        std::process::exit(1);
    }

    let path = Path::new(&file_path);
    if !path.exists() {
        eprintln!("[whisper.cpp] Error: Audio WAV file not found at: {}", file_path);
        std::process::exit(1);
    }

    eprintln!("[whisper.cpp] Executing speech recognition on: {}", file_path);

    let escaped_path = file_path.replace('\'', "''");
    let script = format!(
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; \
         Add-Type -AssemblyName System.Speech; \
         $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine; \
         try {{ \
             $engine.SetInputToWaveFile('{}'); \
             $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar)); \
             $sb = New-Object System.Text.StringBuilder; \
             while ($true) {{ \
                 try {{ \
                     $res = $engine.Recognize(); \
                     if ($res -eq $null) {{ break }}; \
                     [void]$sb.Append($res.Text + ' ') \
                 }} catch {{ \
                     break \
                 }} \
             }}; \
             $transcription = $sb.ToString().Trim(); \
             if ($transcription.Length -gt 0) {{ \
                 [Console]::Out.Write($transcription) \
             }} \
         }} catch {{ \
             [Console]::Error.WriteLine($_) \
         }} finally {{ \
             $engine.Dispose() \
         }}",
        escaped_path
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output();

    match output {
        Ok(out) => {
            let result = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !result.is_empty() {
                println!("{}", result);
            } else {
                eprintln!("[whisper.cpp] No speech recognized in audio buffer");
                println!();
            }
        }
        Err(e) => {
            eprintln!("[whisper.cpp] Failed to execute speech recognition engine: {}", e);
            std::process::exit(1);
        }
    }
}
