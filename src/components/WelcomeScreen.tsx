import React, { useState } from 'react';
import { 
  Key, 
  ExternalLink, 
  Sparkles, 
  ShieldCheck, 
  Eye, 
  EyeOff, 
  ArrowRight, 
  CheckCircle2, 
  AlertCircle,
  ClipboardPaste
} from 'lucide-react';
import { openExternalUrl, saveGroqApiKey, validateGroqApiKey } from '../services/tauri';

interface WelcomeScreenProps {
  onComplete: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onComplete }) => {
  const [apiKey, setApiKey] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleOpenGroqConsole = async () => {
    try {
      await openExternalUrl('https://console.groq.com/keys');
    } catch (e) {
      window.open('https://console.groq.com/keys', '_blank');
    }
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setApiKey(text.trim());
        setError(null);
      }
    } catch {
      // Fallback
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKey = apiKey.trim();
    if (!cleanKey) {
      setError('Please paste your Groq API key to continue.');
      return;
    }

    if (!cleanKey.startsWith('gsk_')) {
      setError('Groq API keys typically start with "gsk_". Please verify your key.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const isValid = await validateGroqApiKey(cleanKey);
      if (!isValid) {
        setError('Invalid Groq API key or network error. Please check the key and try again.');
        setIsLoading(false);
        return;
      }

      await saveGroqApiKey(cleanKey);
      setSuccess(true);
      setTimeout(() => {
        onComplete();
      }, 700);
    } catch (err) {
      setError(`Failed to save key: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-neutral-950 flex flex-col items-center justify-center p-6 text-neutral-100 selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* Background ambient glow effect */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden flex items-center justify-center">
        <div className="w-[600px] h-[600px] bg-emerald-500/10 rounded-full blur-[140px] -translate-y-20 animate-pulse" />
        <div className="w-[450px] h-[450px] bg-teal-500/5 rounded-full blur-[120px] translate-x-32 translate-y-32" />
      </div>

      <div className="w-full max-w-xl relative z-10 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Brand Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 p-0.5 shadow-xl shadow-emerald-950/50 mb-2">
            <div className="w-full h-full bg-neutral-950 rounded-[14px] flex items-center justify-center">
              <Sparkles className="w-7 h-7 text-emerald-400" />
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white font-sans">
            Welcome to <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">Voce</span>
          </h1>
          <p className="text-sm text-neutral-400 max-w-md mx-auto leading-relaxed">
            Ultra-fast voice dictation and instant text translation with zero local disk bloat, powered by Groq's high-speed cloud AI.
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-neutral-900/80 border border-neutral-800/80 rounded-2xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl space-y-6">
          {/* Step 1: Link to get key */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-emerald-400 font-semibold flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-[10px] font-bold">1</span>
                Get Your API Key
              </span>
              <span className="text-[11px] text-neutral-500 font-mono">100% Free Tier</span>
            </div>
            
            <button
              type="button"
              onClick={handleOpenGroqConsole}
              className="w-full group py-3 px-4 rounded-xl bg-neutral-950 border border-neutral-800 hover:border-emerald-500/50 hover:bg-neutral-900/90 transition-all flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
                  <Key className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-medium text-neutral-200 group-hover:text-emerald-400 transition-colors">
                    1. Get your free Groq API key
                  </div>
                  <div className="text-xs text-neutral-500">
                    Opens console.groq.com/keys in your browser
                  </div>
                </div>
              </div>
              <ExternalLink className="w-4 h-4 text-neutral-500 group-hover:text-emerald-400 transition-colors" />
            </button>
          </div>

          <div className="h-px bg-neutral-800/60" />

          {/* Step 2: Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="groq-key-input" className="text-xs font-mono uppercase tracking-wider text-emerald-400 font-semibold flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-[10px] font-bold">2</span>
                  Paste API Key
                </label>
                <button
                  type="button"
                  onClick={handlePasteClipboard}
                  className="text-xs text-neutral-400 hover:text-emerald-400 flex items-center gap-1 transition-colors font-mono"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  Paste
                </button>
              </div>

              <div className="relative">
                <input
                  id="groq-key-input"
                  type={showPassword ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="gsk_..."
                  autoComplete="off"
                  spellCheck="false"
                  className={`w-full bg-neutral-950 border ${
                    error ? 'border-rose-500/70 focus:border-rose-500' : 'border-neutral-800 focus:border-emerald-500'
                  } rounded-xl px-4 py-3 text-sm text-neutral-100 font-mono pr-12 focus:outline-none focus:ring-1 ${
                    error ? 'focus:ring-rose-500' : 'focus:ring-emerald-500'
                  } transition-all placeholder:text-neutral-600`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300 p-1"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {error && (
                <div className="flex items-center gap-1.5 text-xs text-rose-400 font-sans pt-1">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading || !apiKey.trim()}
              className={`w-full py-3.5 px-5 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all ${
                success
                  ? 'bg-emerald-500 text-neutral-950 font-semibold shadow-lg shadow-emerald-500/20'
                  : 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-neutral-950 font-semibold shadow-lg shadow-emerald-950/50 disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-emerald-500/20'
              }`}
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-neutral-950/30 border-t-neutral-950 rounded-full animate-spin" />
                  <span>Verifying API Key...</span>
                </>
              ) : success ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Ready! Launching Voce...</span>
                </>
              ) : (
                <>
                  <span>Save & Start</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Privacy & Security guarantee footer */}
          <div className="pt-2 flex items-start gap-2.5 text-xs text-neutral-500 border-t border-neutral-800/40">
            <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <p className="leading-relaxed font-sans">
              <strong className="text-neutral-400 font-medium">Privacy Guaranteed:</strong> Your API key is stored securely in your local system app data. It is never logged or sent to any third-party server other than Groq's official API.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
