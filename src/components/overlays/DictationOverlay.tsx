import React, { useState, useEffect } from 'react';
import { Mic, Check, X, Loader2, Sparkles } from 'lucide-react';

interface DictationOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onTranscriptionComplete: (text: string) => void;
  autoPaste: boolean;
}

export const DictationOverlay: React.FC<DictationOverlayProps> = ({
  isOpen,
  onClose,
  onTranscriptionComplete,
  autoPaste,
}) => {
  const [state, setState] = useState<'listening' | 'transcribing' | 'success'>('listening');
  const [transcript, setTranscript] = useState('');
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setState('listening');
      setTranscript('');
      setRecordingSeconds(0);
      return;
    }

    // Timer for recording
    const interval = setInterval(() => {
      setRecordingSeconds((prev) => prev + 1);
    }, 1000);

    // Escape listener to close
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearInterval(interval);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const handleStopAndTranscribe = () => {
    setState('transcribing');
    // Simulate / Trigger Whisper processing
    setTimeout(() => {
      const sampleTranscripts = [
        "The quick brown fox jumps over the lazy dog.",
        "Refactoring the global hook listener for optimal latency.",
        "Voce provides local-first privacy-focused speech dictation.",
        "All AI computation runs directly on device with zero cloud latency."
      ];
      const result = sampleTranscripts[Math.floor(Math.random() * sampleTranscripts.length)];
      setTranscript(result);
      setState('success');
      onTranscriptionComplete(result);

      // Auto close after brief display
      setTimeout(() => {
        onClose();
      }, 1500);
    }, 1200);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="hud-pill rounded-2xl p-5 w-full max-w-lg border border-neutral-800/80 bg-neutral-950/90 shadow-2xl relative">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3.5 right-3.5 text-neutral-500 hover:text-neutral-300 p-1 rounded-md transition-colors"
          title="Dismiss (Esc)"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Dynamic Minimalist Audio Waveform & Status */}
        <div className="flex items-center gap-4">
          <div className="relative">
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                state === 'listening'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-lg shadow-emerald-500/10'
                  : state === 'transcribing'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                  : 'bg-emerald-500 text-neutral-950 border border-emerald-400'
              }`}
            >
              {state === 'listening' && <Mic className="w-6 h-6 animate-pulse" />}
              {state === 'transcribing' && <Loader2 className="w-6 h-6 animate-spin" />}
              {state === 'success' && <Check className="w-6 h-6 stroke-[2.5]" />}
            </div>
            {state === 'listening' && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full animate-ping opacity-75" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-mono uppercase tracking-wider text-neutral-400">
                {state === 'listening' && `[ Listening... ${recordingSeconds}s ]`}
                {state === 'transcribing' && `[ Transcribing via whisper.cpp... ]`}
                {state === 'success' && (autoPaste ? `[ Injected to Cursor ]` : `[ Transcribed ]`)}
              </span>
              <span className="text-[10px] font-mono text-neutral-500">ESC to cancel</span>
            </div>

            {/* Dynamic Waveform Bars */}
            {state === 'listening' && (
              <div className="flex items-center gap-1.5 h-6">
                <span className="w-1 bg-emerald-500/60 rounded-full animate-sound-wave-1 h-3" />
                <span className="w-1 bg-emerald-500/80 rounded-full animate-sound-wave-2 h-5" />
                <span className="w-1 bg-emerald-400 rounded-full animate-sound-wave-3 h-6" />
                <span className="w-1 bg-emerald-500/90 rounded-full animate-sound-wave-4 h-4" />
                <span className="w-1 bg-emerald-500/70 rounded-full animate-sound-wave-5 h-2" />
                <span className="w-1 bg-emerald-500/90 rounded-full animate-sound-wave-2 h-5" />
                <span className="w-1 bg-emerald-400 rounded-full animate-sound-wave-4 h-6" />
                <span className="w-1 bg-emerald-500/60 rounded-full animate-sound-wave-1 h-3" />
                <span className="text-xs font-mono text-neutral-400 ml-2">Speak clearly into microphone...</span>
              </div>
            )}

            {/* Transcribed text preview */}
            {state !== 'listening' && (
              <div className="text-sm font-sans text-neutral-100 font-medium truncate">
                {state === 'transcribing' ? 'Processing audio buffer...' : `"${transcript}"`}
              </div>
            )}
          </div>
        </div>

        {/* Action Bar */}
        {state === 'listening' && (
          <div className="mt-4 pt-3 border-t border-neutral-800/60 flex items-center justify-between">
            <span className="text-[11px] font-mono text-neutral-500 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
              Auto-paste to active window: {autoPaste ? 'ON' : 'OFF'}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg text-xs font-mono text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleStopAndTranscribe}
                className="px-4 py-1.5 rounded-lg text-xs font-mono font-medium text-neutral-950 bg-emerald-400 hover:bg-emerald-300 transition-colors shadow-sm"
              >
                Done & Transcribe
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
