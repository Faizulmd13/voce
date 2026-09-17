import React, { useState, useEffect, useRef } from 'react';
import { Bookmark, Check, X, Loader2, Link2, Sparkles, Cloud } from 'lucide-react';
import { 
  uploadBookmarkToDrive, 
  hideOverlay 
} from '../../services/tauri';
import { insertBookmarkToDb } from '../../services/db';
import { listen } from '@tauri-apps/api/event';

interface BookmarkOverlayProps {
  isOpen?: boolean;
  onClose?: () => void;
  isStandalone?: boolean;
  initialText?: string;
}

interface BookmarkEventPayload {
  captured_text?: string;
  capturedText?: string;
}

export const BookmarkOverlay: React.FC<BookmarkOverlayProps> = ({
  isOpen = true,
  onClose,
  isStandalone = false,
  initialText = '',
}) => {
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [content, setContent] = useState(initialText);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const contentRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const handleDismiss = async () => {
    if (isStandalone) {
      await hideOverlay('bookmark-overlay');
    }
    if (onClose) {
      onClose();
    }
  };

  useEffect(() => {
    // Listen for backend trigger event with captured selection
    const unlistenPromise = listen<BookmarkEventPayload>('trigger-bookmark-overlay', (event) => {
      const text = event.payload?.captured_text ?? event.payload?.capturedText ?? '';
      setContent(text);
      setTitle('');
      setSource('');
      setIsSaved(false);

      setTimeout(() => {
        if (text.trim().length > 0) {
          titleRef.current?.focus();
        } else {
          contentRef.current?.focus();
        }
      }, 60);
    });

    if (initialText) {
      setContent(initialText);
    }

    setTimeout(() => {
      if (initialText.trim().length > 0) {
        titleRef.current?.focus();
      } else {
        contentRef.current?.focus();
      }
    }, 60);

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
  }, [initialText]);

  const handleSave = async () => {
    if (!content.trim() || isSaving) return;
    setIsSaving(true);

    const bookmarkPayload = {
      id: `bm_${Date.now()}`,
      title: title.trim() || undefined,
      content: content.trim(),
      source: source.trim() || undefined,
      created_at: new Date().toISOString(),
    };

    try {
      // 1. Save to local SQLite/Store for offline resilience
      await insertBookmarkToDb({
        ...bookmarkPayload,
      });

      // 2. Upload directly to Google Drive
      try {
        const driveItem = await uploadBookmarkToDrive(bookmarkPayload);
        if (driveItem.driveFileId) {
          await insertBookmarkToDb({
            ...bookmarkPayload,
            driveFileId: driveItem.driveFileId,
          });
        }
      } catch (driveErr) {
        console.warn('Google Drive sync fallback (saved locally):', driveErr);
      }

      setIsSaved(true);
      setTimeout(async () => {
        await handleDismiss();
        setIsSaving(false);
        setIsSaved(false);
      }, 500);
    } catch (err) {
      console.error('Failed to save bookmark:', err);
      setIsSaving(false);
    }
  };

  const handleKeyDownForm = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  };

  if (!isOpen && !isStandalone) return null;

  return (
    <div className={`w-full h-full flex items-center justify-center ${isStandalone ? 'bg-transparent' : 'fixed inset-0 z-50 bg-black/45 backdrop-blur-sm p-4'}`}>
      {/* Root Modal Container */}
      <div 
        onKeyDown={handleKeyDownForm}
        className="w-full h-full bg-neutral-950 border border-neutral-800 rounded-xl overflow-hidden p-4 shadow-2xl flex flex-col justify-between select-none"
      >
        {/* Draggable Header (Fixed) */}
        <div 
          data-tauri-drag-region="true" 
          className="flex-shrink-0 flex items-center justify-between border-b border-neutral-800 pb-2.5 select-none"
          style={{ WebkitAppRegion: 'drag', userSelect: 'none', cursor: 'grab' } as any}
        >
          <div data-tauri-drag-region="true" className="flex items-center gap-2 pointer-events-none select-none">
            <div className="w-6 h-6 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Bookmark className="w-3.5 h-3.5 stroke-[2.5]" />
            </div>
            <span className="text-xs font-mono uppercase tracking-wider text-neutral-200 font-semibold select-none">
              Save Bookmark
            </span>
          </div>

          <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
            <span className="text-[10px] font-mono text-neutral-500 flex items-center gap-1">
              <Cloud className="w-3 h-3 text-emerald-400" />
              Voce/bookmarks
            </span>
            <button
              onClick={handleDismiss}
              className="text-neutral-500 hover:text-neutral-300 p-1 rounded transition-colors"
              title="Close (Esc)"
              style={{ WebkitAppRegion: 'no-drag' } as any}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Scrollable Middle Container */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 py-1.5 pr-1 flex flex-col">
          {/* Title Input */}
          <div className="flex-shrink-0">
            <input
              ref={titleRef}
              type="text"
              placeholder="Title (optional)..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 focus:border-emerald-500/80 rounded-lg px-3 py-1.5 text-xs text-neutral-100 font-sans font-medium placeholder:text-neutral-600 focus:outline-none transition-colors"
            />
          </div>

          {/* Content Textarea */}
          <div className="flex-1 min-h-[75px] max-h-48 flex flex-col">
            <textarea
              ref={contentRef}
              required
              rows={4}
              placeholder="Snippet or note content (required)..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full flex-1 min-h-[75px] max-h-48 overflow-y-auto bg-neutral-900 border border-neutral-800 focus:border-emerald-500/80 rounded-lg p-2.5 text-xs text-neutral-200 font-sans leading-relaxed placeholder:text-neutral-600 focus:outline-none resize-none transition-colors"
            />
          </div>

          {/* Source Link Input */}
          <div className="flex-shrink-0 relative">
            <Link2 className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Source link or reference (optional)..."
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 focus:border-emerald-500/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-neutral-300 font-mono placeholder:text-neutral-600 focus:outline-none transition-colors"
            />
          </div>
        </div>

        {/* Footer Actions (Fixed) */}
        <div className="flex-shrink-0 pt-2 border-t border-neutral-800 flex items-center justify-between">
          <span className="text-[10px] font-mono text-neutral-500">
            Press <kbd className="text-neutral-300 bg-neutral-900 px-1 py-0.5 rounded border border-neutral-800">Ctrl+Enter</kbd> to save
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDismiss}
              className="px-2.5 py-1 text-xs font-mono text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !content.trim()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold font-sans bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-neutral-950 transition-all shadow-sm shadow-emerald-950/40"
            >
              {isSaved ? (
                <>
                  <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Saved!</span>
                </>
              ) : isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Syncing...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Save Bookmark</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookmarkOverlay;
