import React, { useState, useEffect, useRef } from 'react';
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

  const setOverlayState = (s: 'listening' | 'transcribing' | 'success') => {
    stateRef.current = s;
    setState(s);
  };

  const startListeningSession = async () => {
    isProcessingRef.current = false;
    setOverlayState('listening');
    setTranscript('');
    setRecordingSeconds(0);

    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    timerRef.current = window.setInterval(() => {
      setRecordingSeconds((prev) => prev + 1);
    }, 1000);

    try {
      await startAudioRecording();
    } catch (e) {
      console.error('Failed to start audio recording:', e);
    }
  };

  const handleDismiss = async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    isProcessingRef.current = true;
    try {
      await stopAudioRecording();
    } catch {
      // ignore
    }
    if (isStandalone) {
      await hideOverlay('stt-overlay');
    }
    if (onClose) {
      onClose();
    }
    isProcessingRef.current = false;
  };

  const handleStopAndTranscribe = async () => {
    if (isProcessingRef.current || stateRef.current !== 'listening') return;
    isProcessingRef.current = true;
    setOverlayState('transcribing');

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    try {
      // 1. Stop audio recording and retrieve 16kHz WAV file path
      const wavPath = await stopAudioRecording();

      // 2. Execute cloud speech recognition
      const result = await executeCloudTranscription(wavPath);
      
      if (result && result.trim()) {
        const wordCount = result.trim().split(/\s+/).filter(Boolean).length;
        if (wordCount > 0) {
          reportSttDictation(wordCount);
        }
        setTranscript(result);
        setOverlayState('success');

        if (onTranscriptionComplete) {
          onTranscriptionComplete(result);
        }

        // 3. Inject transcribed text directly into active OS cursor position
        if (autoPaste) {
          await injectTextToCursor(result);
        }

        // Dismiss overlay after brief confirmation
        setTimeout(async () => {
          if (isStandalone) {
            await hideOverlay('stt-overlay');
          } else if (onClose) {
            onClose();
          }
          isProcessingRef.current = false;
        }, 500);
      } else {
        // No speech detected, hide overlay cleanly
        if (isStandalone) {
          await hideOverlay('stt-overlay');
        } else if (onClose) {
          onClose();
        }
        isProcessingRef.current = false;
      }
    } catch (e) {
      console.error('Transcription error:', e);
      if (isStandalone) {
        await hideOverlay('stt-overlay');
      } else if (onClose) {
        onClose();
      }
      isProcessingRef.current = false;
    }
  };

  useEffect(() => {
    // If not standalone or when mounted, start listening session
    startListeningSession();

    // Listen for backend trigger events
    const unlistenPromise = listen('trigger-stt-overlay', () => {
      startListeningSession();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      window.removeEventListener('keydown', handleKeyDown);
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

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
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-all ${
              state === 'listening'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm shadow-emerald-500/20'
                : state === 'transcribing'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                : 'bg-emerald-500 text-neutral-950 font-bold'
            }`}
          >
            {state === 'listening' && <Mic className="w-4 h-4 animate-pulse" />}
            {state === 'transcribing' && <Loader2 className="w-4 h-4 animate-spin" />}
            {state === 'success' && <Check className="w-4 h-4 stroke-[2.5]" />}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-300 font-semibold truncate">
                {state === 'listening' && `Listening (${recordingSeconds}s)`}
                {state === 'transcribing' && 'Transcribing...'}
                {state === 'success' && 'Injected'}
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
            ) : (
              <p className="text-xs text-neutral-200 truncate font-sans">
                {transcript || 'Running speech recognition...'}
              </p>
            )}
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
