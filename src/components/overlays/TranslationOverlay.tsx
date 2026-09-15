import React, { useState, useEffect, useRef } from 'react';
import { Languages, Copy, Check, X, ArrowRight, CornerDownLeft, Sparkles, Loader2, Send } from 'lucide-react';
import { TranslationRecord } from '../../types';
import { 
  executeLocalTranslation, 
  injectTextToCursor, 
  hideOverlay 
} from '../../services/tauri';
import { listen } from '@tauri-apps/api/event';

interface TranslationOverlayProps {
  isOpen?: boolean;
  onClose?: () => void;
  targetLanguage?: string;
  onSaveTranslation?: (record: TranslationRecord) => void;
  isStandalone?: boolean;
}

interface TranslationEventPayload {
  source_text: string;
  translated_text: string;
  source_lang: string;
  target_lang: string;
}

export const TranslationOverlay: React.FC<TranslationOverlayProps> = ({
  isOpen = true,
  onClose,
  targetLanguage = 'English',
  onSaveTranslation,
  isStandalone = false,
}) => {
  const [sourceText, setSourceText] = useState('');
  const [selectedSourceLang, setSelectedSourceLang] = useState('auto');
  const [translatedText, setTranslatedText] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedTargetLang, setSelectedTargetLang] = useState(targetLanguage);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleDismiss = async () => {
    if (isStandalone) {
      await hideOverlay('translate-overlay');
    }
    if (onClose) {
      onClose();
    }
  };

  const runTranslation = async (text: string, target: string = selectedTargetLang, source: string = selectedSourceLang) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setTranslatedText('');
      return;
    }
    setIsTranslating(true);
    try {
      const translated = await executeLocalTranslation(trimmed, target, source);
      setTranslatedText(translated);
    } catch (e) {
      console.error('Translation error:', e);
      setTranslatedText('');
    } finally {
      setIsTranslating(false);
    }
  };

  useEffect(() => {
    // Focus textarea on initial load
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 60);

    // Listen for backend translation trigger event with payload
    const unlistenPromise = listen<TranslationEventPayload>('trigger-translate-overlay', async (event) => {
      if (event.payload) {
        const incomingText = (event.payload.source_text || '').trim();
        const trg = event.payload.target_lang || 'English';
        setSelectedTargetLang(trg);

        if (incomingText) {
          setSourceText(incomingText);
          // Automatically run translation for highlighted text captured from cursor
          await runTranslation(incomingText, trg, selectedSourceLang);
        } else {
          // Stale-clipboard protected: blank input received
          setSourceText('');
          setTranslatedText('');
          setTimeout(() => {
            textareaRef.current?.focus();
          }, 60);
        }
      }
    });

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleDismiss();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);

    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Trigger manual translation on Enter (without Shift) or Ctrl+Enter
    if ((e.ctrlKey && e.key === 'Enter') || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      runTranslation(sourceText, selectedTargetLang, selectedSourceLang);
    }
  };

  const handleCopy = () => {
    if (!translatedText) return;
    navigator.clipboard.writeText(translatedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleInsertAtCursor = async () => {
    const record: TranslationRecord = {
      id: `trn-${Date.now()}`,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      sourceText,
      sourceLang: selectedSourceLang === 'auto' ? 'Auto-detected' : selectedSourceLang,
      translatedText,
      targetLang: selectedTargetLang,
      charCount: sourceText.length,
    };
    if (onSaveTranslation) {
      onSaveTranslation(record);
    }

    // 1. Inject directly into OS cursor position
    if (translatedText) {
      await injectTextToCursor(translatedText);
    }

    // 2. Hide overlay
    if (isStandalone) {
      await hideOverlay('translate-overlay');
    } else if (onClose) {
      onClose();
    }
  };

  if (!isOpen && !isStandalone) return null;

  return (
    <div className={`w-full h-full flex items-center justify-center ${isStandalone ? 'bg-transparent' : 'fixed inset-0 z-50 bg-black/45 backdrop-blur-sm p-4'}`}>
      {/* Root Modal Container */}
      <div className="w-full h-full bg-neutral-950 border border-neutral-800 rounded-xl overflow-hidden p-3.5 shadow-2xl flex flex-col justify-between space-y-2.5 select-none">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
          <div className="flex items-center gap-1.5">
            <Languages className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-300 font-semibold">
              Live Translation
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 text-[10px] font-mono">
              {/* Interactive Source Language Dropdown */}
              <select
                value={selectedSourceLang}
                onChange={(e) => setSelectedSourceLang(e.target.value)}
                className="bg-neutral-900 border border-neutral-800 text-neutral-300 text-[10px] font-mono rounded px-1.5 py-0.5 focus:outline-none focus:border-neutral-700"
                title="Source Language"
              >
                <option value="auto">Auto-detect</option>
                <option value="English">English (eng_Latn)</option>
                <option value="Spanish">Spanish (spa_Latn)</option>
                <option value="French">French (fra_Latn)</option>
                <option value="German">German (deu_Latn)</option>
                <option value="Tamil">Tamil (tam_Taml)</option>
                <option value="Hindi">Hindi (hin_Deva)</option>
                <option value="Japanese">Japanese (jpn_Jpan)</option>
                <option value="Chinese (Simplified)">Chinese (zho_Hans)</option>
                <option value="Arabic">Arabic (ara_Arab)</option>
                <option value="Russian">Russian (rus_Cyrl)</option>
                <option value="Italian">Italian (ita_Latn)</option>
                <option value="Portuguese">Portuguese (por_Latn)</option>
              </select>

              <ArrowRight className="w-2.5 h-2.5 text-neutral-600" />

              {/* Target Language Dropdown */}
              <select
                value={selectedTargetLang}
                onChange={(e) => setSelectedTargetLang(e.target.value)}
                className="bg-neutral-900 border border-neutral-800 text-emerald-400 text-[10px] font-mono rounded px-1.5 py-0.5 focus:outline-none focus:border-neutral-700"
                title="Target Language"
              >
                <option value="English">English (eng_Latn)</option>
                <option value="Spanish">Spanish (spa_Latn)</option>
                <option value="French">French (fra_Latn)</option>
                <option value="German">German (deu_Latn)</option>
                <option value="Tamil">Tamil (tam_Taml)</option>
                <option value="Hindi">Hindi (hin_Deva)</option>
                <option value="Japanese">Japanese (jpn_Jpan)</option>
                <option value="Chinese (Simplified)">Chinese (zho_Hans)</option>
                <option value="Arabic">Arabic (ara_Arab)</option>
                <option value="Russian">Russian (rus_Cyrl)</option>
                <option value="Italian">Italian (ita_Latn)</option>
                <option value="Portuguese">Portuguese (por_Latn)</option>
              </select>
            </div>

            <button
              onClick={handleDismiss}
              className="text-neutral-500 hover:text-neutral-300 p-0.5 rounded transition-colors"
              title="Close (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Source Text Input Box */}
        <div className="space-y-1.5">
          <div className="relative">
            <textarea
              ref={textareaRef}
              autoFocus
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              rows={2}
              className="w-full bg-neutral-900/90 border border-neutral-800 focus:border-emerald-500/80 rounded-lg p-2 text-xs text-neutral-200 font-sans focus:outline-none resize-none leading-relaxed transition-colors placeholder:text-neutral-600"
              placeholder="Type or paste text to translate... (Press Enter to translate)"
            />
          </div>

          {/* Manual Translate Action Button Row */}
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-mono text-neutral-500">
              Press <kbd className="text-neutral-300 bg-neutral-900 px-1 py-0.5 rounded border border-neutral-800">Enter</kbd> or <kbd className="text-neutral-300 bg-neutral-900 px-1 py-0.5 rounded border border-neutral-800">Ctrl+Enter</kbd> to translate
            </span>
            <button
              type="button"
              onClick={() => runTranslation(sourceText, selectedTargetLang, selectedSourceLang)}
              disabled={isTranslating || !sourceText.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold font-mono bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-neutral-950 transition-all shadow-sm shadow-emerald-950/40"
            >
              {isTranslating ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Translating...</span>
                </>
              ) : (
                <>
                  <Send className="w-3 h-3" />
                  <span>Translate</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Translated Text Box */}
        <div className="space-y-1 flex-1 flex flex-col justify-center">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-mono uppercase tracking-wider text-neutral-500">
              Output ({selectedTargetLang})
            </span>
            <span className="text-[9px] font-mono text-emerald-400 flex items-center gap-1">
              <Sparkles className="w-2.5 h-2.5" /> Groq Cloud AI
            </span>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-2 text-xs text-neutral-100 font-sans leading-relaxed min-h-[42px] flex items-center">
            {isTranslating ? (
              <span className="text-neutral-400 font-mono text-[11px] flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
                Translating via Groq...
              </span>
            ) : (
              translatedText || (
                <span className="text-neutral-500 font-sans text-xs italic">
                  {sourceText.trim() ? 'Click Translate or press Enter to translate' : 'Waiting for input...'}
                </span>
              )
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="pt-2 border-t border-neutral-800 flex items-center justify-between">
          <span className="text-[9px] font-mono text-neutral-500">Esc to close</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopy}
              disabled={!translatedText}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono text-neutral-300 hover:text-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed bg-neutral-900 border border-neutral-800 transition-colors"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              type="button"
              onClick={handleInsertAtCursor}
              disabled={!translatedText}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-mono font-medium text-neutral-950 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <CornerDownLeft className="w-3 h-3" />
              <span>Insert to Cursor</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
