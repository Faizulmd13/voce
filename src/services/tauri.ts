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
  const result = await invoke<OAuthResult>('start_google_oauth');
  return {
    name: result.name,
    email: result.email,
    isAuthenticated: result.is_authenticated,
  };
}

export async function updateBackendHotkeys(sttHotkey: string, translateHotkey: string): Promise<void> {
  await invoke('update_global_hotkeys', {
    sttHotkey,
    translateHotkey,
  });
}

export function subscribeToOverlayTriggers(
  onStt: () => void,
  onTranslate: (payload?: { source_text: string; translated_text: string; target_lang: string }) => void
): () => void {
  let unlistenStt: UnlistenFn | null = null;
  let unlistenTrn: UnlistenFn | null = null;

  listen('trigger-stt-overlay', () => {
    onStt();
  }).then((unlisten) => {
    unlistenStt = unlisten;
  });

  listen<{ source_text: string; translated_text: string; target_lang: string }>('trigger-translate-overlay', (event) => {
    onTranslate(event.payload);
  }).then((unlisten) => {
    unlistenTrn = unlisten;
  });

  return () => {
    if (unlistenStt) unlistenStt();
    if (unlistenTrn) unlistenTrn();
  };
}

export async function startAudioRecording(): Promise<void> {
  await invoke('start_audio_recording');
}

export async function stopAudioRecording(): Promise<string> {
  return await invoke<string>('stop_audio_recording');
}

export async function executeLocalTranscription(audioBufferPath: string, model: string = 'ggml-base.en.bin'): Promise<string> {
  return await invoke<string>('execute_local_transcription', {
    payload: {
      audio_buffer_path: audioBufferPath,
      model,
    },
  });
}

export async function getClipboardText(): Promise<string> {
  return await invoke<string>('get_clipboard_text');
}

export async function executeLocalTranslation(
  sourceText: string,
  targetLang: string = 'English',
  sourceLang: string = 'auto'
): Promise<string> {
  return await invoke<string>('execute_local_translation', {
    payload: {
      source_text: sourceText,
      target_lang: targetLang,
      source_lang: sourceLang,
    },
  });
}

export async function injectTextToCursor(text: string): Promise<void> {
  await invoke('inject_text_to_cursor', { text });
}

export async function showOverlay(label: 'stt-overlay' | 'translate-overlay', offsetY?: number): Promise<void> {
  await invoke('show_overlay', { label, offset_y: offsetY });
}

export async function hideOverlay(label: 'stt-overlay' | 'translate-overlay'): Promise<void> {
  await invoke('hide_overlay', { label });
}
