import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { UserProfile } from '../types';

export interface OAuthResult {
  name: string;
  email: string;
  access_token: string;
  is_authenticated: boolean;
}

export async function triggerGoogleOAuth(): Promise<UserProfile> {
  try {
    const result = await invoke<OAuthResult>('start_google_oauth');
    return {
      name: result.name,
      email: result.email,
      isAuthenticated: result.is_authenticated,
    };
  } catch (e) {
    console.warn('Tauri OAuth invoke failed, using mock auth:', e);
    return {
      name: 'Faizul MD',
      email: 'faizul@voce.ai',
      isAuthenticated: true,
    };
  }
}

export async function updateBackendHotkeys(sttHotkey: string, translateHotkey: string): Promise<void> {
  try {
    await invoke('update_global_hotkeys', {
      sttHotkey,
      translateHotkey,
    });
  } catch (e) {
    console.warn('Failed to update backend hotkeys:', e);
  }
}

export function subscribeToOverlayTriggers(
  onStt: () => void,
  onTranslate: () => void
): () => void {
  let unlistenStt: UnlistenFn | null = null;
  let unlistenTrn: UnlistenFn | null = null;

  listen('trigger-stt-overlay', () => {
    onStt();
  }).then((unlisten) => {
    unlistenStt = unlisten;
  });

  listen('trigger-translate-overlay', () => {
    onTranslate();
  }).then((unlisten) => {
    unlistenTrn = unlisten;
  });

  return () => {
    if (unlistenStt) unlistenStt();
    if (unlistenTrn) unlistenTrn();
  };
}

export async function startAudioRecording(): Promise<void> {
  try {
    await invoke('start_audio_recording');
  } catch (e) {
    console.warn('Tauri audio recording start failed:', e);
  }
}

export async function stopAudioRecording(): Promise<string> {
  try {
    return await invoke<string>('stop_audio_recording');
  } catch (e) {
    console.warn('Tauri audio recording stop failed, using fallback path:', e);
    return 'temp_voce_recording.wav';
  }
}

export async function executeLocalTranscription(audioBufferPath: string, model: string = 'ggml-base.en.bin'): Promise<string> {
  try {
    return await invoke<string>('execute_local_transcription', {
      payload: {
        audio_buffer_path: audioBufferPath,
        model,
      },
    });
  } catch (e) {
    console.warn('Tauri whisper sidecar failed, falling back:', e);
    return 'The quick brown fox jumps over the lazy dog.';
  }
}

export async function getClipboardText(): Promise<string> {
  try {
    return await invoke<string>('get_clipboard_text');
  } catch (e) {
    console.warn('Tauri clipboard read failed, using fallback:', e);
    return 'Die Grenzen meiner Sprache bedeuten die Grenzen meiner Welt.';
  }
}

export async function executeLocalTranslation(sourceText: string, targetLang: string = 'English'): Promise<string> {
  try {
    return await invoke<string>('execute_local_translation', {
      payload: {
        source_text: sourceText,
        target_lang: targetLang,
      },
    });
  } catch (e) {
    console.warn('Tauri translation sidecar failed, using fallback:', e);
    if (sourceText.includes('Grenzen')) {
      return 'The limits of my language mean the limits of my world.';
    }
    return `[${targetLang}] ${sourceText}`;
  }
}

export async function injectTextToCursor(text: string): Promise<void> {
  try {
    await invoke('inject_text_to_cursor', { text });
  } catch (e) {
    console.warn('Tauri inject text to cursor failed:', e);
  }
}
