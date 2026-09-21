import React, { useState, useEffect } from 'react';
import { ArrowUpCircle, Sparkles, ExternalLink, RefreshCw, CheckCircle2 } from 'lucide-react';
import { checkForAppUpdate, openReleaseDownloadUrl, UpdateInfo } from '../services/updater';

interface UpdateNotificationCardProps {
  autoCheck?: boolean;
}

export const UpdateNotificationCard: React.FC<UpdateNotificationCardProps> = ({
  autoCheck = true,
}) => {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [hasManuallyChecked, setHasManuallyChecked] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const runCheck = async (isManual = false) => {
    setIsChecking(true);
    if (isManual) {
      setHasManuallyChecked(true);
      setDismissed(false);
    }
    try {
      const info = await checkForAppUpdate();
      setUpdateInfo(info);
    } catch (e) {
      console.error('Failed to check for updates:', e);
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    if (autoCheck) {
      runCheck(false);
    }
  }, [autoCheck]);

  // If dismissed or no update found on automatic background check, keep card hidden
  if (!updateInfo) return null;
  if (!updateInfo.hasUpdate && !hasManuallyChecked) return null;
  if (dismissed && updateInfo.hasUpdate) return null;

  if (updateInfo.hasUpdate) {
    return (
      <div className="relative overflow-hidden bg-gradient-to-r from-emerald-950/40 via-neutral-900 to-neutral-900 border border-emerald-500/30 rounded-xl p-4 sm:p-5 shadow-lg shadow-emerald-950/20 transition-all">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0 flex-1 w-full sm:w-auto">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0 shadow-sm mt-0.5 sm:mt-0">
              <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 animate-pulse" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2 mb-0.5">
                <span className="text-[11px] sm:text-xs font-mono font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 shrink-0">
                  Update Available
                </span>
                <span className="text-[11px] sm:text-xs font-mono text-neutral-400 font-medium truncate">
                  {updateInfo.latestVersion}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-neutral-100 font-sans leading-snug break-words">
                {updateInfo.releaseName || `Voce ${updateInfo.latestVersion}`}
              </h3>
              <p className="text-xs text-neutral-400 font-mono leading-relaxed break-words">
                Current version: <span className="text-neutral-300 font-semibold">v{updateInfo.currentVersion}</span> • A new version is ready to download.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end shrink-0 pt-2 sm:pt-0 border-t border-neutral-800/60 sm:border-0">
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="px-3 py-1.5 text-xs font-mono text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => openReleaseDownloadUrl(updateInfo.releaseUrl)}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-xs font-semibold font-sans transition-all shadow-md shadow-emerald-950/40 shrink-0"
            >
              <ArrowUpCircle className="w-4 h-4" />
              <span>Download Update</span>
              <ExternalLink className="w-3 h-3 ml-0.5 opacity-70" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Up to date feedback when manually triggered
  return (
    <div className="bg-neutral-900 border border-neutral-800/60 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3.5 transition-all">
      <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0 mt-0.5 sm:mt-0">
          <CheckCircle2 className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-xs font-mono text-neutral-300 font-medium block truncate">
            Voce is up to date
          </span>
          <span className="text-[11px] font-mono text-neutral-500 block break-words">
            Version v{updateInfo.currentVersion} is currently the latest release.
          </span>
        </div>
      </div>

      <div className="w-full sm:w-auto flex justify-end shrink-0">
        <button
          type="button"
          onClick={() => runCheck(true)}
          disabled={isChecking}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800 hover:border-neutral-700 text-neutral-300 text-xs font-mono transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${isChecking ? 'animate-spin text-emerald-400' : 'text-neutral-400'}`} />
          <span>{isChecking ? 'Checking...' : 'Check Again'}</span>
        </button>
      </div>
    </div>
  );
};
