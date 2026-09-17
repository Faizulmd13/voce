import React, { useState } from 'react';
import { Header } from '../components/Header';
import { TranslationRecord } from '../types';
import { Copy, Check, Search, Languages, Trash2, ArrowRight } from 'lucide-react';

interface HistoryPageProps {
  history: TranslationRecord[];
  onClearHistory: () => void;
  onDeleteEntry?: (record: TranslationRecord) => void;
}

export const HistoryPage: React.FC<HistoryPageProps> = ({ history, onClearHistory, onDeleteEntry }) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId(null);
    }, 2000);
  };

  const handleDelete = (item: TranslationRecord) => {
    if (deletingId) return;
    setDeletingId(item.id);
    if (onDeleteEntry) {
      onDeleteEntry(item);
    }
    setTimeout(() => setDeletingId(null), 300);
  };

  const filteredHistory = history.filter(
    (item) =>
      item.sourceText.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.translatedText.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.sourceLang.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.timestamp.includes(searchQuery)
  );

  return (
    <div className="max-w-5xl mx-auto">
      {/* Top Header Layout Primitive */}
      <Header
        category="Records"
        title="History"
        action={
          history.length > 0 ? (
            <button
              onClick={onClearHistory}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono text-neutral-400 hover:text-rose-400 hover:bg-neutral-900 border border-neutral-800 transition-colors"
              title="Clear all local history and cloud translations"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear Log
            </button>
          ) : null
        }
      />

      {/* Search Filter Bar */}
      <div className="mb-6">
        <div className="relative">
          <Search className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search translation logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-800/60 rounded-xl pl-10 pr-4 py-2.5 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-neutral-700 transition-colors font-mono"
          />
        </div>
      </div>

      {/* Log Feed: Chronologically ordered list focusing entirely on past text translation events */}
      {filteredHistory.length === 0 ? (
        <div className="bg-neutral-900 border border-neutral-800/60 rounded-xl p-12 text-center">
          <Languages className="w-8 h-8 text-neutral-600 mx-auto mb-3" />
          <p className="text-sm font-medium text-neutral-300">No translation records found</p>
          <p className="text-xs text-neutral-500 font-mono mt-1">
            Highlight text in any application and press your translation hotkey to capture and translate.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredHistory.map((item) => (
            <div
              key={item.id}
              className="bg-neutral-900 border border-neutral-800/60 rounded-xl p-5 space-y-4 hover:border-neutral-700/60 transition-colors shadow-sm"
            >
              {/* Card Header: Timestamp & Metadata & Actions */}
              <div className="flex items-center justify-between border-b border-neutral-800/40 pb-3 flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-neutral-500">{item.timestamp}</span>
                  <span className="text-neutral-700">•</span>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-neutral-950 text-emerald-400 border border-neutral-800">
                    {item.sourceLang} <ArrowRight className="w-2.5 h-2.5 inline mx-0.5" /> {item.targetLang}
                  </span>
                  <span className="text-neutral-700">•</span>
                  <span className="text-[11px] font-mono text-neutral-500">{item.charCount} chars</span>
                </div>

                <div className="flex items-center gap-2">
                  {onDeleteEntry && (
                    <button
                      onClick={() => handleDelete(item)}
                      disabled={deletingId === item.id}
                      className="p-1 text-neutral-500 hover:text-rose-400 hover:bg-neutral-950 rounded transition-colors disabled:opacity-50"
                      title="Clear entry from local history and Google Drive"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Source & Translated Output Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Selected Text (Unidentified / Source Language) */}
                <div className="space-y-1.5">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-neutral-500">
                    Selected Text ({item.sourceLang})
                  </div>
                  <div className="bg-neutral-950/80 border border-neutral-800/50 rounded-lg p-3.5 text-sm text-neutral-300 font-sans leading-relaxed min-h-[72px] break-words">
                    {item.sourceText}
                  </div>
                </div>

                {/* Translated English Text */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-500">
                      Translated English Text
                    </span>
                    <button
                      onClick={() => handleCopy(item.id, item.translatedText)}
                      className="inline-flex items-center gap-1 text-[11px] font-mono text-neutral-400 hover:text-emerald-400 transition-colors"
                      title="Copy to clipboard"
                    >
                      {copiedId === item.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                  <div className="bg-neutral-950/80 border border-neutral-800/50 rounded-lg p-3.5 text-sm text-neutral-100 font-sans leading-relaxed min-h-[72px] break-words border-l-2 border-l-emerald-500/80">
                    {item.translatedText}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
