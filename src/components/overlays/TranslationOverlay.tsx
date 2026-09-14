import React, { useState, useEffect } from 'react';
import { Languages, Copy, Check, X, ArrowRight, CornerDownLeft, Sparkles } from 'lucide-react';
import { TranslationRecord } from '../../types';
import { 
  getClipboardText, 
  executeLocalTranslation, 
  injectTextToCursor 
} from '../../services/tauri';

interface TranslationOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  targetLanguage: string;
  onSaveTranslation: (record: TranslationRecord) => void;
}

export const TranslationOverlay: React.FC<TranslationOverlayProps> = ({
  isOpen,
  onClose,
  targetLanguage,
  onSaveTranslation,
}) => {
  const [sourceText, setSourceText] = useState('Die Grenzen meiner Sprache bedeuten die Grenzen meiner Welt.');
  const [sourceLang, setSourceLang] = useState('German (Auto-detected)');
  const [translatedText, setTranslatedText] = useState('The limits of my language mean the limits of my world.');
  const [isTranslating, setIsTranslating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedTargetLang, setSelectedTargetLang] = useState(targetLanguage);

  useEffect(() => {
    setSelectedTargetLang(targetLanguage);
  }, [targetLanguage]);

  // Dynamic translation update when typing or changing language
  const handleSourceChange = async (text: string) => {
    setSourceText(text);
    if (!text.trim()) {
      setTranslatedText('');
      return;
    }
    setIsTranslating(true);
    try {
      const translated = await executeLocalTranslation(text, selectedTargetLang);
      setTranslatedText(translated);
      setSourceLang('Auto-detected');
    } catch (e) {
      console.error('Translation error:', e);
    } finally {
      setIsTranslating(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    // Automatically read highlighted text from OS clipboard upon hotkey trigger
    async function fetchClipboardAndTranslate() {
      setIsTranslating(true);
      try {
        const text = await getClipboardText();
        if (text && text.trim()) {
          setSourceText(text);
          const translated = await executeLocalTranslation(text, selectedTargetLang);
          setTranslatedText(translated);
          setSourceLang('Auto-detected');
        }
      } catch (e) {
        console.warn('Failed to auto-fetch clipboard text:', e);
      } finally {
        setIsTranslating(false);
      }
    }

    fetchClipboardAndTranslate();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, selectedTargetLang]);

  const handleCopy = () => {
    navigator.clipboard.writeText(translatedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
    onSaveTranslation(record);
    await injectTextToCursor(translatedText);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm p-4 animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="backdrop-blur-md bg-neutral-900/90 border border-neutral-800/80 rounded-2xl p-5 w-full max-w-lg shadow-2xl space-y-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800/60 pb-3">
          <div className="flex items-center gap-2">
            <Languages className="w-4 h-4 text-emerald-500" />
            <span className="text-xs font-mono uppercase tracking-wider text-neutral-300 font-semibold">
              Instant Translation
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs font-mono">
              <span className="px-2 py-0.5 rounded bg-neutral-950 text-neutral-400 border border-neutral-800 text-[11px]">
                {sourceLang}
              </span>
              <ArrowRight className="w-3 h-3 text-neutral-600" />
              <select
                value={selectedTargetLang}
                onChange={(e) => setSelectedTargetLang(e.target.value)}
                className="bg-neutral-950 border border-neutral-800 text-emerald-400 text-[11px] font-mono rounded px-2 py-0.5 focus:outline-none"
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
              onClick={onClose}
              className="text-neutral-500 hover:text-neutral-300 p-1 rounded transition-colors"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Source Text Box */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">
            Selected Source Text
          </label>
          <textarea
            value={sourceText}
            onChange={(e) => handleSourceChange(e.target.value)}
            rows={2}
            className="w-full bg-neutral-950/80 border border-neutral-800/70 rounded-lg p-3 text-xs text-neutral-300 font-sans focus:outline-none focus:border-neutral-700 resize-none"
            placeholder="Type or paste source text..."
          />
        </div>

        {/* Translated Text Box */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">
              Translation ({selectedTargetLang})
            </label>
            <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> CTranslate2 Local
            </span>
          </div>
          <div className="bg-neutral-950/90 border border-neutral-800/80 rounded-lg p-3.5 text-sm text-neutral-100 font-sans leading-relaxed border-l-2 border-l-emerald-500 min-h-[64px]">
            {isTranslating ? (
              <span className="text-neutral-500 font-mono text-xs animate-pulse">
                Translating selected buffer...
              </span>
            ) : (
              translatedText
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="pt-2 border-t border-neutral-800/60 flex items-center justify-between">
          <span className="text-[10px] font-mono text-neutral-500">Esc to dismiss</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono text-neutral-300 hover:text-neutral-100 bg-neutral-950 border border-neutral-800 hover:border-neutral-700 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              onClick={handleInsertAtCursor}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-mono font-medium text-neutral-950 bg-emerald-400 hover:bg-emerald-300 transition-colors shadow-sm"
            >
              <CornerDownLeft className="w-3.5 h-3.5" />
              <span>Insert to Cursor</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
