import { useEffect, useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';

export function resetPageScrollTop() {
  if (typeof window === 'undefined') return;

  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });

  [
    document.documentElement,
    document.body,
    document.getElementById('root'),
    document.querySelector('.app'),
    document.querySelector('.app__content'),
  ].forEach((element) => {
    if (element && typeof element.scrollTo === 'function') {
      element.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    } else if (element) {
      element.scrollTop = 0;
      element.scrollLeft = 0;
    }
  });
}

function ScrollToTop() {
  const location = useLocation();

  useLayoutEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }

    const activeElement = document.activeElement;
    if (activeElement instanceof Element && activeElement.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) {
      activeElement.blur();
    }

    resetPageScrollTop();
  }, [location.pathname, location.search]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(resetPageScrollTop);
    const settleTimer = window.setTimeout(resetPageScrollTop, 80);
    const lateSettleTimer = window.setTimeout(resetPageScrollTop, 260);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(settleTimer);
      window.clearTimeout(lateSettleTimer);
    };
  }, [location.pathname, location.search]);

  return null;
}

export default ScrollToTop;
