use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use hound::{SampleFormat, WavSpec, WavWriter};
use std::fs::File;
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

pub struct AudioRecorder {
    is_recording: Arc<AtomicBool>,
    audio_buffer: Arc<Mutex<Vec<f32>>>,
    sample_rate: Arc<Mutex<u32>>,
    stop_sender: Option<Sender<()>>,
}

unsafe impl Send for AudioRecorder {}
unsafe impl Sync for AudioRecorder {}

impl AudioRecorder {
    pub fn new() -> Self {
        Self {
            is_recording: Arc::new(AtomicBool::new(false)),
            audio_buffer: Arc::new(Mutex::new(Vec::new())),
            sample_rate: Arc::new(Mutex::new(16000)),
            stop_sender: None,
        }
    }

    pub fn start_recording(&mut self) -> Result<(), String> {
        // Cleanly terminate any running stream first to prevent duplicate recording threads
        if self.is_recording.load(Ordering::SeqCst) {
            if let Some(tx) = self.stop_sender.take() {
                let _ = tx.send(());
            }
            self.is_recording.store(false, Ordering::SeqCst);
            thread::sleep(Duration::from_millis(25));
        }

        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| "No microphone input device found".to_string())?;

        let supported_config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get default input config: {}", e))?;

        let input_sample_rate = supported_config.sample_rate().0;
        if let Ok(mut sr) = self.sample_rate.lock() {
            *sr = input_sample_rate;
        }

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
                                // Average multi-channel (e.g. stereo) audio to single mono float sample
                                let mono_sample: f32 =
                                    chunk.iter().sum::<f32>() / (channels as f32);
                                buf.push(mono_sample);
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
                                let sum: f32 = chunk.iter().map(|&s| (s as f32) / 32768.0).sum();
                                let mono_sample = sum / (channels as f32);
                                buf.push(mono_sample);
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

        println!(
            "[Voce Audio] Recording stream active in background thread (Hardware sample rate: {}Hz, Channels: {})",
            input_sample_rate, channels
        );
        Ok(())
    }

    pub fn stop_recording(&mut self) -> Result<PathBuf, String> {
        self.is_recording.store(false, Ordering::SeqCst);
        if let Some(tx) = self.stop_sender.take() {
            let _ = tx.send(());
        }

        let input_rate = self.sample_rate.lock().map(|r| *r).unwrap_or(16000);
        let raw_samples = self
            .audio_buffer
            .lock()
            .map(|b| b.clone())
            .unwrap_or_default();

        if raw_samples.is_empty() {
            return Err("No audio samples captured".to_string());
        }

        // 1. High-Quality Audio Resampling via Rubato FFT band-limited anti-aliasing filter
        let resampled_floats = resample_to_16k(&raw_samples, input_rate)?;

        // 2. Trim leading and trailing dead silence / background static
        let trimmed_floats = trim_silence(&resampled_floats, 16000);

        // 3. Audio Normalization: dynamic gain multiplier to hit ~ -3dB peak (approx 0.7071 for floats)
        let normalized_pcm_i16 = normalize_and_convert_i16(trimmed_floats);

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
            sample_format: SampleFormat::Int,
        };

        let file = File::create(&output_wav_path)
            .map_err(|e| format!("Failed to create WAV file: {}", e))?;
        let mut writer = WavWriter::new(BufWriter::new(file), spec)
            .map_err(|e| format!("Failed to init WAV writer: {}", e))?;

        for &sample in normalized_pcm_i16.iter() {
            writer
                .write_sample(sample)
                .map_err(|e| format!("Error writing sample: {}", e))?;
        }

        writer
            .finalize()
            .map_err(|e| format!("Error finalizing WAV: {}", e))?;

        let duration_secs = normalized_pcm_i16.len() as f64 / 16000.0;
        println!(
            "[Voce Audio] Successfully saved 16kHz mono WAV ({} samples, {:.2}s) to: \"{}\"",
            normalized_pcm_i16.len(),
            duration_secs,
            output_wav_path.to_string_lossy()
        );
        Ok(output_wav_path)
    }
}

use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Resampler};

/// Studio-quality audio resampling to 16000Hz using Rubato FFT band-limited anti-aliased interpolation
fn resample_to_16k(input_samples: &[f32], from_rate: u32) -> Result<Vec<f32>, String> {
    if from_rate == 16000 || from_rate == 0 || input_samples.is_empty() {
        return Ok(input_samples.to_vec());
    }

    let chunk_size = 1024;
    let mut resampler = Fft::<f32>::new(
        from_rate as usize,
        16000,
        chunk_size,
        1,
        FixedSync::Both,
    )
    .map_err(|e| format!("Failed to initialize rubato resampler: {}", e))?;

    let input_adapter = InterleavedSlice::new(input_samples, 1, input_samples.len())
        .map_err(|e| format!("Failed to create input audio adapter: {}", e))?;

    let output = resampler
        .process_all(&input_adapter, input_samples.len(), None)
        .map_err(|e| format!("Rubato audio resampling error: {}", e))?;

    Ok(output.take_data())
}

/// Trims leading and trailing dead silence/background static while preserving natural voice attack and decay.
fn trim_silence(samples: &[f32], sample_rate: usize) -> &[f32] {
    if samples.is_empty() {
        return samples;
    }

    // 20ms analysis window (320 samples at 16kHz)
    let window_size = (sample_rate * 20) / 1000;
    let window_size = window_size.max(1);

    // RMS/Peak threshold for active human speech vs ambient room noise
    let silence_threshold = 0.015f32; // -36.5 dB

    // 80ms padding so initial consonants (p, t, k, s) and tail decay are never clipped
    let padding_frames = (sample_rate * 80) / 1000;

    let mut start_idx = 0;
    let mut found_start = false;
    for (i, chunk) in samples.chunks(window_size).enumerate() {
        let max_amp = chunk.iter().fold(0.0f32, |acc, &s| acc.max(s.abs()));
        if max_amp > silence_threshold {
            start_idx = (i * window_size).saturating_sub(padding_frames);
            found_start = true;
            break;
        }
    }

    if !found_start {
        // If entirely silent/below threshold, retain full buffer to allow Whisper or silence handler to process gracefully
        return samples;
    }

    let mut end_idx = samples.len();
    let total_chunks = (samples.len() + window_size - 1) / window_size;
    for i in (0..total_chunks).rev() {
        let chunk_start = i * window_size;
        let chunk_end = (chunk_start + window_size).min(samples.len());
        if chunk_start >= samples.len() {
            continue;
        }
        let chunk = &samples[chunk_start..chunk_end];
        let max_amp = chunk.iter().fold(0.0f32, |acc, &s| acc.max(s.abs()));
        if max_amp > silence_threshold {
            end_idx = (chunk_end + padding_frames).min(samples.len());
            break;
        }
    }

    if start_idx < end_idx {
        &samples[start_idx..end_idx]
    } else {
        samples
    }
}

/// Dynamic peak normalization to approx -3dB (0.7071f32) and conversion to 16-bit signed PCM (i16)
fn normalize_and_convert_i16(samples: &[f32]) -> Vec<i16> {
    if samples.is_empty() {
        return Vec::new();
    }

    let peak = samples.iter().fold(0.0f32, |max, &s| max.max(s.abs()));

    // Target peak amplitude: -3dB FS (approx 0.7071)
    let target_peak = 0.7071f32;

    let gain = if peak > 0.0001 {
        // Compute multiplier and cap max gain at 25x (+28dB) to prevent extreme boosting of pure noise
        (target_peak / peak).min(25.0)
    } else {
        1.0
    };

    samples
        .iter()
        .map(|&s| {
            let normalized = s * gain;
            let clamped = normalized.clamp(-1.0, 1.0);
            (clamped * 32767.0).round() as i16
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resample_48k_to_16k() {
        let sample_rate_in = 48000;
        let num_samples = 48000; // 1 second of audio
        let mut input = Vec::with_capacity(num_samples);
        for i in 0..num_samples {
            let t = i as f32 / sample_rate_in as f32;
            input.push((2.0 * std::f32::consts::PI * 440.0 * t).sin() * 0.5);
        }

        let resampled = resample_to_16k(&input, sample_rate_in).expect("Resampling failed");
        // Output duration should be ~16000 samples (1 second at 16kHz)
        assert!(
            (resampled.len() as i32 - 16000).abs() < 100,
            "Resampled len {} not close to 16000",
            resampled.len()
        );
    }

    #[test]
    fn test_resample_44k1_to_16k() {
        let sample_rate_in = 44100;
        let num_samples = 44100; // 1 second
        let mut input = Vec::with_capacity(num_samples);
        for i in 0..num_samples {
            let t = i as f32 / sample_rate_in as f32;
            input.push((2.0 * std::f32::consts::PI * 440.0 * t).sin() * 0.5);
        }

        let resampled = resample_to_16k(&input, sample_rate_in).expect("Resampling failed");
        assert!(
            (resampled.len() as i32 - 16000).abs() < 100,
            "Resampled len {} not close to 16000",
            resampled.len()
        );
    }

    #[test]
    fn test_silence_trimming() {
        let sample_rate = 16000;
        // 1 sec silence + 1 sec tone + 1 sec silence
        let mut audio = vec![0.0001f32; 16000];
        for i in 0..16000 {
            let t = i as f32 / 16000.0;
            audio.push((2.0 * std::f32::consts::PI * 440.0 * t).sin() * 0.6);
        }
        audio.extend(vec![0.0001f32; 16000]);

        let trimmed = trim_silence(&audio, sample_rate);
        assert!(
            trimmed.len() < audio.len(),
            "Trimmed length {} should be less than original {}",
            trimmed.len(),
            audio.len()
        );
        assert!(
            trimmed.len() >= 16000,
            "Trimmed length {} should preserve active speech",
            trimmed.len()
        );
    }

    #[test]
    fn test_normalization_and_i16_conversion() {
        // Quiet signal with peak 0.05
        let quiet_signal = vec![0.01f32, 0.05f32, -0.04f32, 0.02f32];
        let pcm = normalize_and_convert_i16(&quiet_signal);
        let max_pcm = pcm.iter().fold(0i16, |m, &s| m.max(s.abs()));
        // Target peak is ~0.7071 * 32767 ≈ 23170
        let expected_peak = (0.7071 * 32767.0) as i16;
        assert!(
            (max_pcm - expected_peak).abs() < 50,
            "Max PCM {} should be close to expected {}",
            max_pcm,
            expected_peak
        );
    }
}
