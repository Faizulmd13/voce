import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, Check, X, Loader2 } from 'lucide-react';
import {
  startAudioRecording,
  stopAudioRecording,
  executeCloudTranscription,
  injectTextToCursor,
  hideOverlay
} from '../../services/tauri';
import { reportSttDictation } from '../../utils/firebase';
import { listen } from '@tauri-apps/api/event';

interface DictationOverlayProps {
  isOpen?: boolean;
  onClose?: () => void;
  onTranscriptionComplete?: (text: string) => void;
  autoPaste?: boolean;
  isStandalone?: boolean;
}

export const DictationOverlay: React.FC<DictationOverlayProps> = ({
  isOpen = true,
  onClose,
  onTranscriptionComplete,
  autoPaste = true,
  isStandalone = false,
}) => {
  const [state, setState] = useState<'listening' | 'transcribing' | 'success'>('listening');
  const [transcript, setTranscript] = useState('');
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const stateRef = useRef<'listening' | 'transcribing' | 'success'>('listening');
  const isProcessingRef = useRef<boolean>(false);
  const timerRef = useRef<number | null>(null);
  const dismissTimeoutRef = useRef<number | null>(null);
  const currentSessionIdRef = useRef<number>(0);

  const clearAllTimers = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (dismissTimeoutRef.current !== null) {
      clearTimeout(dismissTimeoutRef.current);
      dismissTimeoutRef.current = null;
    }
  }, []);

  const setOverlayState = useCallback((s: 'listening' | 'transcribing' | 'success') => {
    stateRef.current = s;
    setState(s);
  }, []);

  const resetToIdle = useCallback(() => {
    clearAllTimers();
    isProcessingRef.current = false;
    setOverlayState('listening');
    setTranscript('');
    setRecordingSeconds(0);
  }, [clearAllTimers, setOverlayState]);

  const closeOverlay = useCallback(async () => {
    clearAllTimers();
    if (isStandalone) {
      try {
        await hideOverlay('stt-overlay');
      } catch (e) {
        console.error('Failed to hide stt-overlay:', e);
      }
    }
    if (onClose) {
      onClose();
    }
    // Synchronously prime the state back to 'listening' so when the window is reopened
    // by Tauri window manager, the webview immediately paints the clean listening UI.
    resetToIdle();
  }, [clearAllTimers, isStandalone, onClose, resetToIdle]);

  const startListeningSession = useCallback(async () => {
    // Increment session id to invalidate any async operations from previous sessions
    currentSessionIdRef.current += 1;

    // 1. Immediately & synchronously reset everything to clean listening state
    resetToIdle();

    // 2. Start elapsed seconds timer
    timerRef.current = window.setInterval(() => {
      setRecordingSeconds((prev) => prev + 1);
    }, 1000);

    // 3. Ensure native audio recording is active
    try {
      await startAudioRecording();
    } catch (e) {
      console.error('Failed to start audio recording:', e);
    }
  }, [resetToIdle]);

  const handleDismiss = useCallback(async () => {
    clearAllTimers();
    isProcessingRef.current = true;
    try {
      await stopAudioRecording();
    } catch {
      // ignore
    }
    await closeOverlay();
  }, [clearAllTimers, closeOverlay]);

  const handleStopAndTranscribe = useCallback(async () => {
    if (isProcessingRef.current || stateRef.current !== 'listening') return;
    isProcessingRef.current = true;
    setOverlayState('transcribing');

    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const sessionId = currentSessionIdRef.current;

    try {
      const wavPath = await stopAudioRecording();
      const result = await executeCloudTranscription(wavPath);

      // If a new session started while transcribing, drop stale result
      if (sessionId !== currentSessionIdRef.current) {
        return;
      }

      const trimmed = result ? result.trim() : '';

      if (trimmed) {
        const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
        if (wordCount > 0) {
          reportSttDictation(wordCount);
        }
        setTranscript(trimmed);

        // 1. Switch to success state immediately so UI updates without delay
        setOverlayState('success');

        // 2. Copy text and inject directly to active cursor
        try {
          await navigator.clipboard.writeText(trimmed);
        } catch {
          // ignore web clipboard fallback
        }

        if (autoPaste) {
          try {
            await injectTextToCursor(trimmed);
          } catch (err) {
            console.error('Failed to inject text to cursor:', err);
          }
        }

        if (onTranscriptionComplete) {
          onTranscriptionComplete(trimmed);
        }

        // 3. Keep HUD pill visible in success state for 2.5s for readability before auto-hiding
        dismissTimeoutRef.current = window.setTimeout(async () => {
          if (sessionId === currentSessionIdRef.current) {
            await closeOverlay();
          }
        }, 500);
      } else {
        // No transcription result: close cleanly
        await closeOverlay();
      }
    } catch (e) {
      console.error('Transcription error:', e);
      if (sessionId === currentSessionIdRef.current) {
        await closeOverlay();
      }
    }
  }, [autoPaste, closeOverlay, onTranscriptionComplete, setOverlayState]);

  useEffect(() => {
    startListeningSession();

    // Listen to global shortcut trigger event from Tauri backend
    const unlistenPromise = listen('trigger-stt-overlay', () => {
      startListeningSession();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleDismiss();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (stateRef.current === 'listening' && !isProcessingRef.current) {
          handleStopAndTranscribe();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearAllTimers();
      window.removeEventListener('keydown', handleKeyDown);
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [clearAllTimers, handleDismiss, handleStopAndTranscribe, startListeningSession]);

  if (!isOpen && !isStandalone) return null;

  return (
    <div className={`w-full h-full flex items-center justify-center ${isStandalone ? 'bg-transparent' : 'fixed inset-0 z-50 bg-black/40 backdrop-blur-sm p-4'}`}>
      <div
        data-tauri-drag-region="true"
        className="hud-pill rounded-xl px-4 py-3 w-full max-w-[340px] border border-white/10 shadow-2xl flex items-center justify-between gap-3 select-none"
        style={{
          backgroundColor: 'rgba(20, 20, 20, 0.5)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          userSelect: 'none',
          cursor: 'grab',
          WebkitAppRegion: 'drag',
        } as any}
      >
        {/* State Indicator */}
        <div className="flex items-center gap-3 min-w-0 pointer-events-none select-none">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-all ${state === 'listening'
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm shadow-emerald-500/20'
              : state === 'transcribing'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                : 'bg-emerald-500 text-neutral-950 font-bold shadow-lg shadow-emerald-500/30'
              }`}
          >
            {state === 'listening' && <Mic className="w-4 h-4 animate-pulse" />}
            {state === 'transcribing' && <Loader2 className="w-4 h-4 animate-spin" />}
            {state === 'success' && <Check className="w-4 h-4 stroke-[3]" />}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-300 font-semibold truncate">
                {state === 'listening' && `Listening (${recordingSeconds}s)`}
                {state === 'transcribing' && 'Transcribing...'}
                {state === 'success' && 'Copied to Clipboard'}
              </span>
            </div>

            {state === 'listening' ? (
              <div className="flex items-center gap-1 h-3">
                <span className="w-0.5 bg-emerald-500 rounded-full animate-sound-wave-1 h-2" />
                <span className="w-0.5 bg-emerald-400 rounded-full animate-sound-wave-2 h-3" />
                <span className="w-0.5 bg-emerald-500 rounded-full animate-sound-wave-3 h-2.5" />
                <span className="w-0.5 bg-emerald-400 rounded-full animate-sound-wave-4 h-3" />
                <span className="w-0.5 bg-emerald-500 rounded-full animate-sound-wave-5 h-2" />
                <span className="text-[10px] font-mono text-neutral-500 ml-1.5">Enter to paste</span>
              </div>
            ) : state === 'transcribing' ? (
              <p className="text-xs text-neutral-200 truncate font-sans">
                Running speech recognition...
              </p>
            ) : null}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1 shrink-0" style={{ WebkitAppRegion: 'no-drag' } as any}>
          {state === 'listening' && (
            <button
              onClick={handleStopAndTranscribe}
              style={{ WebkitAppRegion: 'no-drag' } as any}
              className="px-2.5 py-1 rounded-md text-[11px] font-mono font-medium text-neutral-950 bg-emerald-400 hover:bg-emerald-300 transition-colors shadow-sm"
            >
              Done
            </button>
          )}
          <button
            onClick={handleDismiss}
            style={{ WebkitAppRegion: 'no-drag' } as any}
            className="text-neutral-500 hover:text-neutral-300 p-1 rounded transition-colors"
            title="Dismiss (Esc)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};