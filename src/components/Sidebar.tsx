import React from 'react';
import { NavPage } from '../types';
import { Home, Bookmark, History, Settings } from 'lucide-react';

interface SidebarProps {
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activePage, onNavigate }) => {
  return (
    <aside className="w-64 bg-neutral-900 border-r border-neutral-800/60 flex flex-col justify-between p-5 select-none h-full shrink-0">
      {/* Top Section: Application Branding */}
      <div>
        <div className="flex items-center gap-3 px-2 py-3 mb-6">
          <div className="w-8 h-8 rounded-lg bg-neutral-950 border border-neutral-800 flex items-center justify-center font-mono text-emerald-500 font-bold text-base shadow-sm">
            V
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-neutral-100 tracking-tight text-lg">Voce</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-800/80 text-neutral-400 border border-neutral-700/40">v1.0</span>
            </div>
            <p className="text-[11px] font-mono text-neutral-500">AI Desktop Assistant</p>
          </div>
        </div>

        {/* Navigation Group: Home -> Bookmarks -> History */}
        <nav className="space-y-1.5">
          <button
            onClick={() => onNavigate('home')}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activePage === 'home'
                ? 'bg-neutral-800/90 text-neutral-100 border border-neutral-700/50 shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/40'
            }`}
          >
            <Home className={`w-4 h-4 ${activePage === 'home' ? 'text-emerald-500' : 'text-neutral-500'}`} />
            <span>Home</span>
          </button>

          <button
            onClick={() => onNavigate('bookmarks')}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activePage === 'bookmarks'
                ? 'bg-neutral-800/90 text-neutral-100 border border-neutral-700/50 shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/40'
            }`}
          >
            <Bookmark className={`w-4 h-4 ${activePage === 'bookmarks' ? 'text-emerald-500' : 'text-neutral-500'}`} />
            <span>Bookmarks</span>
          </button>

          <button
            onClick={() => onNavigate('history')}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activePage === 'history'
                ? 'bg-neutral-800/90 text-neutral-100 border border-neutral-700/50 shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/40'
            }`}
          >
            <History className={`w-4 h-4 ${activePage === 'history' ? 'text-emerald-500' : 'text-neutral-500'}`} />
            <span>History</span>
          </button>
        </nav>
      </div>

      {/* Footer Section: Contains ONLY the Settings link at the bottom */}
      <div className="border-t border-neutral-800/60 pt-3">
        <button
          onClick={() => onNavigate('settings')}
          className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            activePage === 'settings'
              ? 'bg-neutral-800/90 text-neutral-100 border border-neutral-700/50 shadow-sm'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/40'
          }`}
        >
          <Settings className={`w-4 h-4 ${activePage === 'settings' ? 'text-emerald-500' : 'text-neutral-500'}`} />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
};
