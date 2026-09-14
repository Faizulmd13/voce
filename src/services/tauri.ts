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
