import React, { useEffect, useState } from 'react';

const DISMISS_KEY = 'pwa-install-dismissed';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function PwaInstallBanner() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (isStandalone() || localStorage.getItem(DISMISS_KEY) === '1') {
      return;
    }
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setHidden(false);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    if (isIos()) {
      setShowIosHint(true);
      setHidden(false);
    }
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setHidden(true);
    setDeferred(null);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    dismiss();
  };

  if (hidden) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[1400] flex justify-center p-3 sm:p-4">
      <div className="pointer-events-auto flex w-full max-w-lg items-start gap-3 rounded-2xl border border-ide-border bg-ide-panel px-4 py-3 shadow-ide-md">
        <div className="min-w-0 flex-1 text-sm text-ide-text">
          {deferred ? (
            <p>Install AI Calendar on this device for quicker voice capture.</p>
          ) : showIosHint ? (
            <p>On iPhone: Share → Add to Home Screen to install the app.</p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          {deferred ? (
            <button type="button" className="ui-btn-primary min-h-[40px] px-3 py-1.5" onClick={() => void install()}>
              Install
            </button>
          ) : null}
          <button type="button" className="ui-btn-ghost min-h-[40px] px-3 py-1.5" onClick={dismiss}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
