const HOLD_FEEDBACK_STYLE_ID = 'iclora-no-hold-feedback-style';

function initDevicePerformanceHints() {
  const userAgent = navigator.userAgent || '';
  const isTouchDevice = navigator.maxTouchPoints > 0 || /Android|iPhone|iPad|iPod/i.test(userAgent);
  const isAndroid = /Android/i.test(userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const deviceMemory = typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : undefined;
  const hardwareConcurrency = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : undefined;
  const saveData = Boolean(navigator.connection?.saveData);
  const reducedMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const lite = !isIOS && (
    reducedMotion ||
    saveData ||
    isAndroid ||
    (isTouchDevice && typeof deviceMemory === 'number' && deviceMemory <= 4) ||
    (isTouchDevice && typeof hardwareConcurrency === 'number' && hardwareConcurrency <= 4)
  );

  document.body.classList.toggle('iclora-touch-device', isTouchDevice);
  document.body.classList.toggle('iclora-ios-device', isIOS);
  document.body.classList.toggle('iclora-android-device', isAndroid);
  document.body.classList.toggle('iclora-standalone', isStandalone);
  document.documentElement.classList.toggle('iclora-standalone', isStandalone);
  document.body.classList.toggle('iclora-gpu-full', isIOS && !lite);
  document.body.classList.toggle('iclora-performance-lite', lite);
}

export function initBrowserInteractionFixes() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  initDevicePerformanceHints();

  if (!document.getElementById(HOLD_FEEDBACK_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = HOLD_FEEDBACK_STYLE_ID;
    style.textContent = `
      html, body {
        -webkit-tap-highlight-color: transparent;
        -webkit-touch-callout: none;
      }

      a, button, [role="button"], input, textarea, select, label, summary {
        -webkit-tap-highlight-color: transparent;
        -webkit-touch-callout: none;
      }

      a:active, button:active, [role="button"]:active, input:active, label:active, summary:active {
        opacity: 1 !important;
        filter: none !important;
      }
    `;

    document.head.appendChild(style);
  }
}
