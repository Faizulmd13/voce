import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

// Re-export all cloud & OAuth methods from cloud.ts
export * from './cloud';

export async function updateBackendHotkeys(
  sttHotkey: string,
  translateHotkey: string,
  bookmarkHotkey: string = 'Alt+B'
): Promise<void> {
  await invoke('update_global_hotkeys', {
    sttHotkey,
    translateHotkey,
    bookmarkHotkey,
  });
}

export function subscribeToOverlayTriggers(
  onStt: () => void,
  onTranslate: (payload?: { source_text: string; translated_text: string; target_lang: string }) => void,
  onBookmark?: (payload?: { captured_text: string }) => void
): () => void {
  let unlistenStt: UnlistenFn | null = null;
  let unlistenTrn: UnlistenFn | null = null;
  let unlistenBm: UnlistenFn | null = null;

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

  if (onBookmark) {
    listen<{ captured_text: string }>('trigger-bookmark-overlay', (event) => {
      onBookmark(event.payload);
    }).then((unlisten) => {
      unlistenBm = unlisten;
    });
  }

  return () => {
    if (unlistenStt) unlistenStt();
    if (unlistenTrn) unlistenTrn();
    if (unlistenBm) unlistenBm();
  };
}

export async function startAudioRecording(): Promise<void> {
  await invoke('start_audio_recording');
}

export async function stopAudioRecording(): Promise<string> {
  return await invoke<string>('stop_audio_recording');
}

export async function executeCloudTranscription(audioBufferPath: string, model: string = 'whisper-large-v3-turbo'): Promise<string> {
  return await invoke<string>('execute_cloud_transcription', {
    payload: {
      audio_buffer_path: audioBufferPath,
      model,
    },
  });
}

export async function getClipboardText(): Promise<string> {
  return await invoke<string>('get_clipboard_text');
}

export async function executeCloudTranslation(
  sourceText: string,
  targetLang: string = 'English',
  sourceLang: string = 'auto'
): Promise<string> {
  return await invoke<string>('execute_cloud_translation', {
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

export async function getStoredApiKey(): Promise<string | null> {
  return await invoke<string | null>('get_stored_api_key');
}

export async function saveGroqApiKey(apiKey: string): Promise<void> {
  await invoke('save_groq_api_key', { apiKey });
}

export async function validateGroqApiKey(apiKey: string): Promise<boolean> {
  return await invoke<boolean>('validate_groq_api_key', { apiKey });
}

export async function openExternalUrl(url: string): Promise<void> {
  await invoke('open_external_url', { url });
}

export async function showOverlay(
  label: 'stt-overlay' | 'translate-overlay' | 'bookmark-overlay',
  offsetY?: number
): Promise<void> {
  await invoke('show_overlay', { label, offset_y: offsetY });
}

export async function hideOverlay(
  label: 'stt-overlay' | 'translate-overlay' | 'bookmark-overlay'
): Promise<void> {
  await invoke('hide_overlay', { label });
}

export async function isAutostartEnabled(): Promise<boolean> {
  try {
    const { isEnabled } = await import('@tauri-apps/plugin-autostart');
    return await isEnabled();
  } catch (e) {
    console.warn('Autostart plugin unavailable:', e);
    return false;
  }
}

export async function setAutostartEnabled(enabled: boolean): Promise<void> {
  try {
    const { enable, disable } = await import('@tauri-apps/plugin-autostart');
    if (enabled) {
      await enable();
    } else {
      await disable();
    }
  } catch (e) {
    console.warn('Failed to toggle autostart:', e);
  }
}
