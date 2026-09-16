import React, { useState, useEffect } from 'react';
import { Header } from './Header';
import { BookmarkItem, UserProfile } from '../types';
import { 
  Bookmark, 
  Search, 
  Plus, 
  ExternalLink, 
  Copy, 
  Check, 
  Trash2, 
  RefreshCw, 
  Cloud, 
  CloudOff, 
  Calendar,
  X,
  Sparkles,
  Edit3,
  Loader2
} from 'lucide-react';
import { 
  deleteBookmarkFromDrive, 
  uploadBookmarkToDrive, 
  updateBookmarkInDrive,
  syncFromCloud,
  openExternalUrl 
} from '../services/tauri';
import { 
  loadBookmarksFromDb, 
  insertBookmarkToDb, 
  deleteBookmarkFromDb, 
  syncBookmarksToDb, 
  syncHistoryToDb,
  loadHistoryFromDb 
} from '../services/db';

interface BookmarksProps {
  userProfile: UserProfile;
  onOpenOverlay?: () => void;
}

export const Bookmarks: React.FC<BookmarksProps> = ({ userProfile, onOpenOverlay }) => {
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Quick manual add modal state
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSource, setNewSource] = useState('');
  const [newContent, setNewContent] = useState('');
  const [isSavingNew, setIsSavingNew] = useState(false);

  // Google Keep Read & Edit Modal state
  const [editingBookmark, setEditingBookmark] = useState<BookmarkItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editSource, setEditSource] = useState('');
  const [editContent, setEditContent] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isModalCopied, setIsModalCopied] = useState(false);

  const loadInitialData = async () => {
    setIsLoading(true);
    // 1. Load local offline cache first for instantaneous rendering
    const cached = await loadBookmarksFromDb();
    setBookmarks(cached);
    setIsLoading(false);

    // 2. If authenticated with Google Drive, sync from cloud in background
    if (userProfile.isAuthenticated) {
      handleSyncFromCloud();
    }
  };

  const handleSyncFromCloud = async () => {
    if (!userProfile.isAuthenticated) return;
    setIsSyncing(true);
    try {
      const localBookmarks = await loadBookmarksFromDb();
      const localHistory = await loadHistoryFromDb([]);
      const res = await syncFromCloud(localBookmarks, localHistory);
      if (res.bookmarks && res.bookmarks.length > 0) {
        setBookmarks(res.bookmarks);
        await syncBookmarksToDb(res.bookmarks);
      }
      if (res.translations && res.translations.length > 0) {
        await syncHistoryToDb(res.translations as any);
      }
    } catch (e) {
      console.warn('Failed to sync bookmarks from Google Drive:', e);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, [userProfile.isAuthenticated]);

  const handleCopy = (id: string, text: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId(null);
    }, 2000);
  };

  const handleModalCopy = () => {
    if (!editContent) return;
    navigator.clipboard.writeText(editContent);
    setIsModalCopied(true);
    setTimeout(() => {
      setIsModalCopied(false);
    }, 2000);
  };

  const handleDelete = async (item: BookmarkItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (deletingId) return;
    setDeletingId(item.id);
    try {
      // Delete locally
      await deleteBookmarkFromDb(item.id);
      setBookmarks((prev) => prev.filter((b) => b.id !== item.id));

      if (editingBookmark?.id === item.id) {
        setEditingBookmark(null);
      }

      // Delete from Google Drive if synced
      if (item.driveFileId && userProfile.isAuthenticated) {
        await deleteBookmarkFromDrive(item.driveFileId);
      }
    } catch (err) {
      console.error('Failed to delete bookmark:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreateBookmark = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) return;

    setIsSavingNew(true);
    const item: BookmarkItem = {
      id: `bm_${Date.now()}`,
      title: newTitle.trim() || undefined,
      source: newSource.trim() || undefined,
      content: newContent.trim(),
      created_at: new Date().toISOString(),
    };

    try {
      // Save locally
      await insertBookmarkToDb(item);
      setBookmarks((prev) => [item, ...prev]);

      // Upload to Google Drive if authenticated
      if (userProfile.isAuthenticated) {
        try {
          const uploaded = await uploadBookmarkToDrive({
            id: item.id,
            title: item.title,
            content: item.content,
            source: item.source,
            created_at: item.created_at,
          });
          if (uploaded.driveFileId) {
            item.driveFileId = uploaded.driveFileId;
            await insertBookmarkToDb(item);
            setBookmarks((prev) => [item, ...prev.filter((b) => b.id !== item.id)]);
          }
        } catch (driveErr) {
          console.warn('Could not immediately upload new bookmark to Drive:', driveErr);
        }
      }

      // Reset form
      setNewTitle('');
      setNewSource('');
      setNewContent('');
      setIsCreating(false);
    } catch (err) {
      console.error('Error saving bookmark:', err);
    } finally {
      setIsSavingNew(false);
    }
  };

  // Open Edit Modal
  const handleOpenEditModal = (item: BookmarkItem) => {
    setEditingBookmark(item);
    setEditTitle(item.title || '');
    setEditSource(item.source || '');
    setEditContent(item.content || '');
    setIsModalCopied(false);
  };

  // Save Edit Modal
  const handleSaveEdit = async () => {
    if (!editingBookmark || !editContent.trim()) return;

    setIsSavingEdit(true);
    const updated: BookmarkItem = {
      ...editingBookmark,
      title: editTitle.trim() || undefined,
      source: editSource.trim() || undefined,
      content: editContent.trim(),
    };

    try {
      // 1. Update local SQLite DB
      await insertBookmarkToDb(updated);
      setBookmarks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));

      // 2. Overwrite in Google Drive if authenticated
      if (userProfile.isAuthenticated) {
        try {
          if (editingBookmark.driveFileId) {
            await updateBookmarkInDrive(
              {
                id: updated.id,
                title: updated.title,
                source: updated.source,
                content: updated.content,
                created_at: updated.created_at,
              },
              editingBookmark.driveFileId
            );
          } else {
            const uploaded = await uploadBookmarkToDrive({
              id: updated.id,
              title: updated.title,
              content: updated.content,
              source: updated.source,
              created_at: updated.created_at,
            });
            if (uploaded.driveFileId) {
              updated.driveFileId = uploaded.driveFileId;
              await insertBookmarkToDb(updated);
              setBookmarks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
            }
          }
        } catch (driveErr) {
          console.warn('Failed to overwrite bookmark in Google Drive:', driveErr);
        }
      }

      setEditingBookmark(null);
    } catch (err) {
      console.error('Error saving bookmark edits:', err);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleOpenSource = async (url: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!url) return;
    try {
      let formattedUrl = url.trim();
      if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://') && formattedUrl.includes('.')) {
        formattedUrl = `https://${formattedUrl}`;
      }
      if (formattedUrl.startsWith('http://') || formattedUrl.startsWith('https://')) {
        await openExternalUrl(formattedUrl);
      }
    } catch {
      window.open(url, '_blank');
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
      });
    } catch {
      return dateStr;
    }
  };

  const filteredBookmarks = bookmarks.filter((b) => {
    const q = searchQuery.toLowerCase();
    return (
      (b.title && b.title.toLowerCase().includes(q)) ||
      b.content.toLowerCase().includes(q) ||
      (b.source && b.source.toLowerCase().includes(q))
    );
  });

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* Top Header Layout Primitive */}
      <Header
        category="Knowledge Vault"
        title="Bookmarks"
        action={
          <div className="flex items-center gap-2.5">
            {userProfile.isAuthenticated ? (
              <button
                onClick={handleSyncFromCloud}
                disabled={isSyncing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono text-neutral-300 hover:text-emerald-400 bg-neutral-900 border border-neutral-800 transition-colors disabled:opacity-50"
                title="Synchronize bookmarks with Google Drive"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-emerald-400' : ''}`} />
                <span>{isSyncing ? 'Syncing...' : 'Drive Sync'}</span>
              </button>
            ) : (
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-[11px] font-mono text-neutral-500">
                <CloudOff className="w-3.5 h-3.5 text-neutral-600" />
                <span>Offline Cache</span>
              </div>
            )}

            <button
              onClick={() => {
                if (onOpenOverlay) {
                  onOpenOverlay();
                } else {
                  setIsCreating(true);
                }
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-xs font-semibold font-sans transition-colors shadow-sm shadow-emerald-500/20"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>New Bookmark</span>
            </button>
          </div>
        }
      />

      {/* Search & Statistics Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search bookmarks by title, text, or source link..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-800/60 rounded-xl pl-10 pr-4 py-2.5 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-emerald-500/60 transition-colors font-mono"
          />
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-neutral-500 px-1">
          <span>{filteredBookmarks.length} {filteredBookmarks.length === 1 ? 'bookmark' : 'bookmarks'}</span>
          {userProfile.isAuthenticated && (
            <>
              <span>•</span>
              <span className="text-emerald-400 flex items-center gap-1">
                <Cloud className="w-3 h-3" />
                Voce/bookmarks
              </span>
            </>
          )}
        </div>
      </div>

      {/* Manual Quick Add Form */}
      {isCreating && (
        <div className="bg-neutral-900 border border-emerald-500/30 rounded-xl p-5 shadow-xl relative animate-in fade-in zoom-in-95 duration-150">
          <button
            onClick={() => setIsCreating(false)}
            className="absolute top-4 right-4 text-neutral-500 hover:text-neutral-300 p-1"
          >
            <X className="w-4 h-4" />
          </button>

          <form onSubmit={handleCreateBookmark} className="space-y-3.5">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-semibold text-neutral-200">Create Bookmark</h3>
            </div>

            <input
              type="text"
              placeholder="Title (optional)..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-800 focus:border-emerald-500 rounded-lg px-3.5 py-2 text-xs font-sans font-medium text-neutral-100 placeholder-neutral-600 focus:outline-none"
            />

            <textarea
              required
              rows={4}
              placeholder="Bookmark content or snippet (required)..."
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-800 focus:border-emerald-500 rounded-lg p-3.5 text-xs font-sans text-neutral-200 placeholder-neutral-600 focus:outline-none resize-y leading-relaxed"
            />

            <input
              type="text"
              placeholder="Source link or reference (optional e.g. https://...)..."
              value={newSource}
              onChange={(e) => setNewSource(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-800 focus:border-emerald-500 rounded-lg px-3.5 py-2 text-xs font-mono text-neutral-300 placeholder-neutral-600 focus:outline-none"
            />

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-mono text-neutral-400 hover:text-neutral-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSavingNew || !newContent.trim()}
                className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-neutral-950 text-xs font-semibold transition-colors"
              >
                {isSavingNew ? 'Saving...' : 'Save to Vault'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Google Keep Style Masonry Grid */}
      {isLoading && bookmarks.length === 0 ? (
        <div className="bg-neutral-900 border border-neutral-800/60 rounded-xl p-14 text-center">
          <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-neutral-300">Loading your bookmarks...</h3>
        </div>
      ) : filteredBookmarks.length === 0 ? (
        <div className="bg-neutral-900 border border-neutral-800/60 rounded-xl p-14 text-center">
          <Bookmark className="w-9 h-9 text-neutral-600 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-neutral-300">No bookmarks found</h3>
          <p className="text-xs text-neutral-500 font-mono mt-1 max-w-md mx-auto leading-relaxed">
            Highlight text anywhere and press <kbd className="text-emerald-400 bg-neutral-950 px-1.5 py-0.5 rounded border border-neutral-800">Alt+B</kbd> to quickly capture snippets into your Google Drive vault.
          </p>
        </div>
      ) : (
        <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 [column-fill:_balance]">
          {filteredBookmarks.map((item) => {
            const hasTitle = Boolean(item.title && item.title.trim().length > 0);
            const hasSource = Boolean(item.source && item.source.trim().length > 0);
            const isDeleting = deletingId === item.id;

            return (
              <div
                key={item.id}
                onClick={() => handleOpenEditModal(item)}
                className="break-inside-avoid mb-4 group bg-neutral-900 hover:bg-neutral-900/90 border border-neutral-800 hover:border-neutral-700/80 rounded-xl p-4 transition-all duration-200 shadow-sm hover:shadow-lg cursor-pointer flex flex-col justify-between relative overflow-hidden"
              >
                {/* Card Header & Title */}
                {hasTitle && (
                  <div className="mb-2">
                    <h4 className="text-sm font-bold text-neutral-100 font-sans tracking-tight leading-snug">
                      {item.title}
                    </h4>
                  </div>
                )}

                {/* Content Body Clamped to Max Height with Gradient Fade */}
                <div className="relative max-h-[220px] overflow-hidden">
                  <div className="text-xs text-neutral-300 font-sans leading-relaxed whitespace-pre-wrap break-words selection:bg-emerald-500/30">
                    {item.content}
                  </div>
                  {/* Subtle Gradient Fade at the Bottom */}
                  <div className="pointer-events-none absolute bottom-0 inset-x-0 h-10 bg-gradient-to-t from-neutral-900 via-neutral-900/80 to-transparent" />
                </div>

                {/* Bottom Metadata & Actions */}
                <div className="mt-3 pt-2.5 border-t border-neutral-800/60 flex items-center justify-between gap-2">
                  {/* Source link badge or date */}
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {hasSource ? (
                      <button
                        onClick={(e) => handleOpenSource(item.source!, e)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-neutral-950 hover:bg-neutral-800 text-emerald-400 hover:text-emerald-300 border border-neutral-800 hover:border-emerald-500/30 text-[10px] font-mono truncate transition-colors max-w-[170px]"
                        title={`Open source: ${item.source}`}
                      >
                        <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                        <span className="truncate">{item.source?.replace(/^https?:\/\//, '')}</span>
                      </button>
                    ) : item.created_at ? (
                      <span className="text-[10px] font-mono text-neutral-500 flex items-center gap-1">
                        <Calendar className="w-2.5 h-2.5" />
                        {formatDate(item.created_at)}
                      </span>
                    ) : null}
                  </div>

                  {/* Quick Card Action Buttons */}
                  <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => handleCopy(item.id, item.content, e)}
                      className="p-1 rounded text-neutral-400 hover:text-emerald-400 hover:bg-neutral-950 transition-colors"
                      title="Copy content"
                    >
                      {copiedId === item.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>

                    <button
                      onClick={(e) => handleDelete(item, e)}
                      disabled={isDeleting}
                      className="p-1 rounded text-neutral-500 hover:text-rose-400 hover:bg-neutral-950 transition-colors disabled:opacity-40"
                      title="Delete bookmark"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Google Keep Clone: Full-size Read & Edit Modal */}
      {editingBookmark && (
        <div 
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setEditingBookmark(null)}
        >
          <div 
            className="w-full max-w-2xl bg-neutral-950 border border-neutral-800 rounded-2xl p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col justify-between animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <Edit3 className="w-4 h-4 stroke-[2]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-neutral-100 font-sans">
                    Read & Edit Bookmark
                  </h3>
                  <p className="text-[11px] font-mono text-neutral-500">
                    {editingBookmark.created_at ? formatDate(editingBookmark.created_at) : 'Saved snippet'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {userProfile.isAuthenticated && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                    <Cloud className="w-3 h-3" />
                    Synced (.txt)
                  </span>
                )}
                <button
                  onClick={() => setEditingBookmark(null)}
                  className="text-neutral-500 hover:text-neutral-200 p-1 rounded-lg transition-colors"
                  title="Close (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Editable Fields */}
            <div className="space-y-3 flex-1 overflow-y-auto pr-1">
              {/* Title Field */}
              <div>
                <label className="block text-[11px] font-mono text-neutral-400 uppercase tracking-wider mb-1">
                  Title
                </label>
                <input
                  type="text"
                  placeholder="Title (optional)..."
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full bg-neutral-900 border border-neutral-800 focus:border-emerald-500/80 rounded-xl px-3.5 py-2.5 text-sm font-sans font-semibold text-neutral-100 placeholder-neutral-600 focus:outline-none transition-colors"
                />
              </div>

              {/* Content Textarea Field */}
              <div>
                <label className="block text-[11px] font-mono text-neutral-400 uppercase tracking-wider mb-1">
                  Content / Snippet
                </label>
                <textarea
                  rows={9}
                  required
                  placeholder="Note content..."
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full bg-neutral-900 border border-neutral-800 focus:border-emerald-500/80 rounded-xl p-3.5 text-xs font-sans text-neutral-200 placeholder-neutral-600 focus:outline-none resize-y leading-relaxed font-normal selection:bg-emerald-500/30 transition-colors"
                />
              </div>

              {/* Source Field */}
              <div>
                <label className="block text-[11px] font-mono text-neutral-400 uppercase tracking-wider mb-1">
                  Source Reference / URL
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="https://... or source citation"
                    value={editSource}
                    onChange={(e) => setEditSource(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 focus:border-emerald-500/80 rounded-xl px-3.5 py-2 text-xs font-mono text-neutral-300 placeholder-neutral-600 focus:outline-none transition-colors"
                  />
                  {editSource && (
                    <button
                      type="button"
                      onClick={() => handleOpenSource(editSource)}
                      className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-emerald-400 text-xs font-mono transition-colors shrink-0 flex items-center gap-1.5"
                      title="Open source link in default browser"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Open</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Actions Footer */}
            <div className="pt-3 border-t border-neutral-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleModalCopy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-emerald-400 border border-neutral-800 transition-colors"
                >
                  {isModalCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleDelete(editingBookmark)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-neutral-900 hover:bg-rose-950/40 text-neutral-400 hover:text-rose-400 border border-neutral-800 hover:border-rose-900/50 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingBookmark(null)}
                  className="px-4 py-2 rounded-lg text-xs font-mono text-neutral-400 hover:text-neutral-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={isSavingEdit || !editContent.trim()}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-neutral-950 text-xs font-semibold font-sans transition-colors shadow-sm shadow-emerald-500/20"
                >
                  {isSavingEdit ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Save Changes</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Bookmarks;
