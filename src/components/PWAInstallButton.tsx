import React, { useState, useEffect, useCallback } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

  const handleInstallClick = useCallback(async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuideModal(true);
    }
  }, [isInstallable, install]);

  useEffect(() => {
    const handleMenuTrigger = () => {
      handleInstallClick();
    };
    window.addEventListener('vs:open-pwa-install', handleMenuTrigger);
    return () => window.removeEventListener('vs:open-pwa-install', handleMenuTrigger);
  }, [handleInstallClick]);

  return (
    <>
      {!isInstalled && (
        <button
          type="button"
          onClick={handleInstallClick}
          className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/80 hover:bg-white dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-black dark:text-white text-xs font-semibold transition active:scale-[0.98]"
          title="Install Vs Tests App on Home Screen"
        >
          <Download className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
          <span>Install App</span>
        </button>
      )}

      {showGuideModal && (
        <div
          onClick={() => setShowGuideModal(false)}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-sm w-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-300 dark:border-slate-700 p-6 shadow-2xl space-y-4 text-black dark:text-white"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <img
                  src="/assets/aistudio/Screenshot_2026-11-11-14-19-47-09_40deb401b9ffe8e1df2f1cc5ba480b12_d6e28b87.jpg?v=3"
                  alt="Vs Tests"
                  className="w-10 h-10 rounded-xl object-cover border border-slate-300 dark:border-slate-700"
                />
                <div>
                  <h3 className="text-base font-bold text-black dark:text-white">Install Vs Tests</h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400">Add to Home Screen</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <div className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 space-y-2 leading-relaxed">
                <p>
                  1. Tap the <strong>Share</strong> icon at the bottom of Safari.
                </p>
                <p>
                  2. Scroll down and tap <strong>Add to Home Screen</strong>.
                </p>
                <p>
                  3. Tap <strong>Add</strong> to install the <strong>Vs Tests</strong> app with its official icon.
                </p>
              </div>
            ) : (
              <div className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 space-y-2 leading-relaxed">
                <p className="flex items-start gap-2">
                  <Smartphone className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                  <span>
                    Open the <strong>Chrome menu (⋮)</strong> at the top-right corner of your browser.
                  </span>
                </p>
                <p>
                  Tap <strong>&ldquo;Add to Home screen&rdquo;</strong> or <strong>&ldquo;Install app&rdquo;</strong> to install <strong>Vs Tests</strong> directly on your phone.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuideModal(false)}
              className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-xs sm:text-sm font-bold hover:bg-blue-500"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
};
