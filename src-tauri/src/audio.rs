use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use hound::{WavSpec, WavWriter};
use std::fs::File;
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;

pub struct AudioRecorder {
    is_recording: Arc<AtomicBool>,
    audio_buffer: Arc<Mutex<Vec<i16>>>,
    stop_sender: Option<Sender<()>>,
}

unsafe impl Send for AudioRecorder {}
unsafe impl Sync for AudioRecorder {}

impl AudioRecorder {
    pub fn new() -> Self {
        Self {
            is_recording: Arc::new(AtomicBool::new(false)),
            audio_buffer: Arc::new(Mutex::new(Vec::new())),
            stop_sender: None,
        }
    }

    pub fn start_recording(&mut self) -> Result<(), String> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| "No microphone input device found".to_string())?;

        let supported_config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get default input config: {}", e))?;

        let buffer_clone = Arc::clone(&self.audio_buffer);
        let is_recording_flag = Arc::clone(&self.is_recording);

        if let Ok(mut buf) = buffer_clone.lock() {
            buf.clear();
        }

        is_recording_flag.store(true, Ordering::SeqCst);
        let (stop_tx, stop_rx) = channel::<()>();
        self.stop_sender = Some(stop_tx);

        let channels = supported_config.channels() as usize;

        // Spawn recording stream in its own dedicated audio thread
        thread::spawn(move || {
            let err_fn = |err| eprintln!("Audio stream error: {}", err);

            let stream_res = match supported_config.sample_format() {
                cpal::SampleFormat::F32 => device.build_input_stream(
                    &supported_config.into(),
                    move |data: &[f32], _: &_| {
                        if !is_recording_flag.load(Ordering::SeqCst) {
                            return;
                        }
                        if let Ok(mut buf) = buffer_clone.lock() {
                            for chunk in data.chunks(channels) {
                                let mono_sample: f32 =
                                    chunk.iter().sum::<f32>() / (channels as f32);
                                let pcm = (mono_sample.clamp(-1.0, 1.0) * 32767.0) as i16;
                                buf.push(pcm);
                            }
                        }
                    },
                    err_fn,
                    None,
                ),
                cpal::SampleFormat::I16 => device.build_input_stream(
                    &supported_config.into(),
                    move |data: &[i16], _: &_| {
                        if !is_recording_flag.load(Ordering::SeqCst) {
                            return;
                        }
                        if let Ok(mut buf) = buffer_clone.lock() {
                            for chunk in data.chunks(channels) {
                                let sum: i32 = chunk.iter().map(|&s| s as i32).sum();
                                let mono = (sum / channels as i32) as i16;
                                buf.push(mono);
                            }
                        }
                    },
                    err_fn,
                    None,
                ),
                _ => return,
            };

            if let Ok(stream) = stream_res {
                if stream.play().is_ok() {
                    let _ = stop_rx.recv();
                    let _ = stream.pause();
                }
            }
        });

        println!("[Voce Audio] Recording stream active in background thread");
        Ok(())
    }

    pub fn stop_recording(&mut self) -> Result<PathBuf, String> {
        self.is_recording.store(false, Ordering::SeqCst);
        if let Some(tx) = self.stop_sender.take() {
            let _ = tx.send(());
        }

        let temp_dir = std::env::temp_dir();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let output_wav_path = temp_dir.join(format!("voce_recording_{}.wav", timestamp));

        let spec = WavSpec {
            channels: 1,
            sample_rate: 16000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };

        let file = File::create(&output_wav_path)
            .map_err(|e| format!("Failed to create WAV file: {}", e))?;
        let mut writer = WavWriter::new(BufWriter::new(file), spec)
            .map_err(|e| format!("Failed to init WAV writer: {}", e))?;

        if let Ok(buf) = self.audio_buffer.lock() {
            for &sample in buf.iter() {
                writer
                    .write_sample(sample)
                    .map_err(|e| format!("Error writing sample: {}", e))?;
            }
        }

        writer
            .finalize()
            .map_err(|e| format!("Error finalizing WAV: {}", e))?;

        println!(
            "[Voce Audio] Successfully saved 16kHz mono WAV to: {:?}",
            output_wav_path
        );
        Ok(output_wav_path)
    }
}
