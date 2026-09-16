import React, { useState, useEffect } from 'react';
import { UserProfile } from '../types';
import { User, LogOut, HardDrive, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { 
  triggerGoogleOAuth, 
  googleLogout, 
  getGoogleUserProfile, 
  normalizeUserProfile 
} from '../services/tauri';
import { listen } from '@tauri-apps/api/event';

interface ProfileCardProps {
  userProfile: UserProfile;
  onProfileUpdate: (updated: UserProfile) => void;
}

export const ProfileCard: React.FC<ProfileCardProps> = ({ userProfile, onProfileUpdate }) => {
  const normalized = normalizeUserProfile(userProfile);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    // Actively fetch stored profile state on mount to render avatar, name, and email immediately
    getGoogleUserProfile()
      .then((profile) => {
        if (profile) {
          onProfileUpdate(normalizeUserProfile(profile));
        }
      })
      .catch((e) => console.warn('Failed to fetch profile on mount:', e));

    // Listen to profile-updated Tauri event
    const unlistenProfileUpdated = listen<any>('profile-updated', (event) => {
      if (event.payload) {
        onProfileUpdate(normalizeUserProfile(event.payload));
      }
    });

    const unlistenLogin = listen<any>('oauth-login-success', (event) => {
      if (event.payload) {
        onProfileUpdate(normalizeUserProfile(event.payload));
      }
    });

    const unlistenLogout = listen<any>('oauth-logout-success', (event) => {
      if (event.payload) {
        onProfileUpdate(normalizeUserProfile(event.payload));
      }
    });

    return () => {
      unlistenProfileUpdated.then((fn) => fn());
      unlistenLogin.then((fn) => fn());
      unlistenLogout.then((fn) => fn());
    };
  }, []);

  const handleSignIn = async () => {
    setIsSigningIn(true);
    setErrorMessage(null);
    try {
      const profile = await triggerGoogleOAuth();
      onProfileUpdate(profile);
    } catch (err: any) {
      console.error('Google OAuth error:', err);
      setErrorMessage(typeof err === 'string' ? err : err?.message || 'Authentication failed');
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    setErrorMessage(null);
    try {
      const anonymous = await googleLogout();
      onProfileUpdate(anonymous);
    } catch (err: any) {
      console.error('Logout error:', err);
      setErrorMessage(typeof err === 'string' ? err : err?.message || 'Logout failed');
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="bg-neutral-900 border border-neutral-800/60 rounded-xl p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        {/* User Info Avatar & Details */}
        <div className="flex items-center gap-4">
          <div className="relative">
            {normalized.isAuthenticated && normalized.avatarUrl && !avatarError ? (
              <img
                src={normalized.avatarUrl}
                alt={normalized.name}
                referrerPolicy="no-referrer"
                onError={() => setAvatarError(true)}
                className="w-14 h-14 rounded-full border-2 border-emerald-500/40 object-cover shadow-md"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-neutral-950 border border-neutral-800 flex items-center justify-center text-neutral-400 shadow-inner">
                <User className="w-7 h-7 stroke-[1.5]" />
              </div>
            )}
            {normalized.isAuthenticated && (
              <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-500 border-2 border-neutral-900 flex items-center justify-center">
                <span className="sr-only">Online</span>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-neutral-100 font-sans tracking-tight">
                {normalized.isAuthenticated ? normalized.name : 'Anonymous User'}
              </h3>
              {normalized.isAuthenticated ? (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                  <CheckCircle2 className="w-2.5 h-2.5" />
                  Synced
                </span>
              ) : (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400 border border-neutral-700/50">
                  Local Mode
                </span>
              )}
            </div>

            <p className="text-xs font-mono text-neutral-400">
              {normalized.isAuthenticated ? normalized.email : 'Not signed in'}
            </p>

            {normalized.isAuthenticated && (
              <div className="flex items-center gap-2 pt-1 text-[11px] font-mono text-neutral-400">
                <HardDrive className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Google Drive: <span className="text-neutral-300">Voce/bookmarks</span> & <span className="text-neutral-300">Voce/translations</span></span>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons: Sign In with Google OR Logout */}
        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
          {normalized.isAuthenticated ? (
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="w-full sm:w-auto px-4 py-2 rounded-lg bg-neutral-950 border border-neutral-800 hover:border-rose-900/60 hover:text-rose-400 text-neutral-300 text-xs font-mono transition-colors flex items-center justify-center gap-2 disabled:opacity-50 shadow-sm"
            >
              {isLoggingOut ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Signing out...</span>
                </>
              ) : (
                <>
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Logout</span>
                </>
              )}
            </button>
          ) : (
            <button
              onClick={handleSignIn}
              disabled={isSigningIn}
              className="w-full sm:w-auto px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-xs font-semibold font-sans transition-colors flex items-center justify-center gap-2.5 disabled:opacity-60 shadow-sm shadow-emerald-500/20"
            >
              {isSigningIn ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-neutral-950" />
                  <span>Opening browser...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="currentColor"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>Sign in with Google</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {errorMessage && (
        <div className="mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs font-mono text-rose-400 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
};
