import React, { useState, useEffect } from 'react';
import { Languages, Copy, Check, X, ArrowRight, CornerDownLeft, Sparkles, Loader2 } from 'lucide-react';
import { TranslationRecord } from '../../types';
import { 
  getClipboardText, 
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
  const [sourceText, setSourceText] = useState('Die Grenzen meiner Sprache bedeuten die Grenzen meiner Welt.');
  const [sourceLang, setSourceLang] = useState('German (Auto-detected)');
  const [translatedText, setTranslatedText] = useState('The limits of my language mean the limits of my world.');
  const [isTranslating, setIsTranslating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedTargetLang, setSelectedTargetLang] = useState(targetLanguage);

  const handleDismiss = async () => {
    if (isStandalone) {
      await hideOverlay('translate-overlay');
    }
    if (onClose) {
      onClose();
    }
  };

  const runTranslation = async (text: string, target: string) => {
    if (!text || !text.trim()) {
      setTranslatedText('');
      return;
    }
    setIsTranslating(true);
    try {
      const translated = await executeLocalTranslation(text, target);
      setTranslatedText(translated);
      setSourceLang('Auto-detected');
    } catch (e) {
      console.error('Translation error:', e);
    } finally {
      setIsTranslating(false);
    }
  };

  useEffect(() => {
    // Automatically read highlighted text from OS clipboard on load
    async function loadClipboard() {
      try {
        const clip = await getClipboardText();
        if (clip && clip.trim()) {
          setSourceText(clip);
          await runTranslation(clip, selectedTargetLang);
        }
      } catch (e) {
        console.warn('Failed to load clipboard text:', e);
      }
    }

    loadClipboard();

    // Listen for backend translation trigger event with payload
    const unlistenPromise = listen<TranslationEventPayload>('trigger-translate-overlay', async (event) => {
      if (event.payload) {
        setSourceText(event.payload.source_text);
        setSelectedTargetLang(event.payload.target_lang || 'English');
        await runTranslation(event.payload.source_text, event.payload.target_lang || 'English');
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const handleSourceChange = async (text: string) => {
    setSourceText(text);
    await runTranslation(text, selectedTargetLang);
  };

  const handleTargetLangChange = async (target: string) => {
    setSelectedTargetLang(target);
    await runTranslation(sourceText, target);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(translatedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleInsertAtCursor = async () => {
    const record: TranslationRecord = {
      id: `trn-${Date.now()}`,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      sourceText,
      sourceLang,
      translatedText,
      targetLang: selectedTargetLang,
      charCount: sourceText.length,
    };
    if (onSaveTranslation) {
      onSaveTranslation(record);
    }

    // 1. Inject directly into OS cursor position
    await injectTextToCursor(translatedText);

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
      <div className="backdrop-blur-md bg-neutral-900/95 border border-neutral-800/80 rounded-xl p-4 w-full max-w-[390px] shadow-2xl space-y-3 select-none">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800/60 pb-2">
          <div className="flex items-center gap-1.5">
            <Languages className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-300 font-semibold">
              Live Translation
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-[10px] font-mono">
              <span className="px-1.5 py-0.5 rounded bg-neutral-950 text-neutral-400 border border-neutral-800 text-[10px]">
                {sourceLang}
              </span>
              <ArrowRight className="w-2.5 h-2.5 text-neutral-600" />
              <select
                value={selectedTargetLang}
                onChange={(e) => handleTargetLangChange(e.target.value)}
                className="bg-neutral-950 border border-neutral-800 text-emerald-400 text-[10px] font-mono rounded px-1.5 py-0.5 focus:outline-none"
              >
                <option value="English">English</option>
                <option value="Spanish">Spanish</option>
                <option value="French">French</option>
                <option value="German">German</option>
                <option value="Japanese">Japanese</option>
                <option value="Chinese (Simplified)">Chinese (Simplified)</option>
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

        {/* Source Text Box */}
        <div className="space-y-1">
          <textarea
            value={sourceText}
            onChange={(e) => handleSourceChange(e.target.value)}
            rows={2}
            className="w-full bg-neutral-950/80 border border-neutral-800/70 rounded-lg p-2 text-xs text-neutral-300 font-sans focus:outline-none focus:border-neutral-700 resize-none leading-relaxed"
            placeholder="Selected source text..."
          />
        </div>

        {/* Translated Text Box */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-mono uppercase tracking-wider text-neutral-500">
              Output ({selectedTargetLang})
            </span>
            <span className="text-[9px] font-mono text-emerald-400 flex items-center gap-1">
              <Sparkles className="w-2.5 h-2.5" /> CTranslate2 Local
            </span>
          </div>
          <div className="bg-neutral-950/90 border border-neutral-800/80 rounded-lg p-2 text-xs text-neutral-100 font-sans leading-relaxed border-l-2 border-l-emerald-500 min-h-[46px] flex items-center">
            {isTranslating ? (
              <span className="text-neutral-500 font-mono text-[11px] flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
                Translating buffer...
              </span>
            ) : (
              translatedText
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="pt-2 border-t border-neutral-800/60 flex items-center justify-between">
          <span className="text-[9px] font-mono text-neutral-500">Esc to close</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono text-neutral-300 hover:text-neutral-100 bg-neutral-950 border border-neutral-800 transition-colors"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              onClick={handleInsertAtCursor}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-mono font-medium text-neutral-950 bg-emerald-400 hover:bg-emerald-300 transition-colors shadow-sm"
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
