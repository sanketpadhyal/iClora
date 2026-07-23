const SMOOTH_SCROLL_FLAG = '__icloraSmoothScroll';
const SMOOTH_SCROLL_ELEMENT_FLAG = '__icloraSmoothScrollElement';

const DEFAULT_SCROLL_SELECTORS = [
  '.cloud-shell',
  '.manage-account',
  '.iclora-photos__content',
  '.iclora-photos__sidebar',
  '.iclora-photos__filmstrip',
  '.iclora-notes__folders',
  '.iclora-notes__folders-list',
  '.iclora-notes__list-pane',
  '.iclora-notes__list-content',
  '.iclora-notes__paper',
  '.iclora-contacts__list',
  '.iclora-contacts__detail',
  '.iclora-contacts__birthday-popover',
  '.dashboard-navbar__menu',
  '.dashboard-navbar__apps-popover',
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeWheelDelta(event) {
  if (event.deltaMode === 1) return event.deltaY * 18;
  if (event.deltaMode === 2) return event.deltaY * window.innerHeight;
  return event.deltaY;
}

function easeOutQuint(progress) {
  return 1 - Math.pow(1 - progress, 5);
}

function easeOutCubic(progress) {
  return 1 - Math.pow(1 - progress, 3);
}

function isEditableTarget(target) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}

function canNestedScroll(node, deltaY, wrapper) {
  let current = node instanceof Element ? node : null;

  while (current && current !== wrapper && current !== document.body && current !== document.documentElement) {
    if (current instanceof HTMLElement) {
      const style = window.getComputedStyle(current);
      const canScroll = /(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflow}`);
      const hasRoom = current.scrollHeight > current.clientHeight + 1;

      if (canScroll && hasRoom) {
        const atTop = current.scrollTop <= 0;
        const atBottom = current.scrollTop + current.clientHeight >= current.scrollHeight - 1;
        if ((deltaY < 0 && !atTop) || (deltaY > 0 && !atBottom)) return true;
      }
    }

    current = current.parentElement;
  }

  return false;
}

export function initCustomSmoothScroll({ wrapper, keyboard = true }) {
  if (typeof window === 'undefined' || !wrapper) return null;
  if (wrapper[SMOOTH_SCROLL_ELEMENT_FLAG]) return wrapper[SMOOTH_SCROLL_ELEMENT_FLAG];

  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let targetScroll = wrapper.scrollTop;
  let animationFrame = 0;
  let programmaticAnimationFrame = 0;
  let lastFrameTime = 0;

  function maxScroll() {
    return Math.max(0, wrapper.scrollHeight - wrapper.clientHeight);
  }

  function cancelAnimation() {
    if (animationFrame) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
    if (programmaticAnimationFrame) {
      window.cancelAnimationFrame(programmaticAnimationFrame);
      programmaticAnimationFrame = 0;
    }
  }

  function animateFrame(time) {
    const deltaTime = lastFrameTime ? Math.min(34, time - lastFrameTime) : 16.7;
    lastFrameTime = time;
    targetScroll = clamp(targetScroll, 0, maxScroll());

    const currentScroll = wrapper.scrollTop;
    const distance = targetScroll - currentScroll;
    const blend = 1 - Math.pow(0.055, deltaTime / 16.7);

    if (Math.abs(distance) < 0.45) {
      wrapper.scrollTop = targetScroll;
      animationFrame = 0;
      lastFrameTime = 0;
      return;
    }

    wrapper.scrollTop = currentScroll + distance * blend;
    animationFrame = window.requestAnimationFrame(animateFrame);
  }

  function startAnimation() {
    if (animationFrame || prefersReducedMotion) {
      if (prefersReducedMotion) wrapper.scrollTop = targetScroll;
      return;
    }
    lastFrameTime = 0;
    animationFrame = window.requestAnimationFrame(animateFrame);
  }

  function scrollTo(value, options = {}) {
    const nextTarget = clamp(typeof value === 'number' ? value : 0, 0, maxScroll());
    cancelAnimation();

    if (options.immediate || prefersReducedMotion) {
      targetScroll = nextTarget;
      wrapper.scrollTop = targetScroll;
      return;
    }

    const startScroll = wrapper.scrollTop;
    const distance = nextTarget - startScroll;
    const duration = typeof options.duration === 'number' ? options.duration : 720;
    const startTime = performance.now();
    targetScroll = nextTarget;

    function step(time) {
      const progress = clamp((time - startTime) / duration, 0, 1);
      wrapper.scrollTop = startScroll + distance * easeOutQuint(progress);

      if (progress < 1) {
        programmaticAnimationFrame = window.requestAnimationFrame(step);
        return;
      }

      wrapper.scrollTop = targetScroll;
      programmaticAnimationFrame = 0;
    }

    programmaticAnimationFrame = window.requestAnimationFrame(step);
  }

  function onWheel(event) {
    if (prefersReducedMotion || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (isEditableTarget(event.target)) return;

    const deltaY = normalizeWheelDelta(event);
    if (!deltaY || Math.abs(event.deltaX) > Math.abs(deltaY) * 1.15) return;
    if (canNestedScroll(event.target, deltaY, wrapper)) return;

    if (event.cancelable) event.preventDefault();
    if (programmaticAnimationFrame) {
      window.cancelAnimationFrame(programmaticAnimationFrame);
      programmaticAnimationFrame = 0;
    }

    targetScroll = clamp(targetScroll + deltaY, 0, maxScroll());
    startAnimation();
  }

  function onKeyDown(event) {
    if (prefersReducedMotion || isEditableTarget(event.target)) return;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;

    const keyScrolls = new Map([
      ['ArrowDown', 72],
      ['ArrowUp', -72],
      ['PageDown', wrapper.clientHeight * 0.86],
      ['PageUp', wrapper.clientHeight * -0.86],
      ['Home', -Infinity],
      ['End', Infinity],
      [' ', event.shiftKey ? wrapper.clientHeight * -0.86 : wrapper.clientHeight * 0.86],
    ]);

    if (!keyScrolls.has(event.key)) return;

    const activeElement = document.activeElement;
    const activeInsideWrapper = activeElement === document.body || wrapper.contains(activeElement);
    if (!activeInsideWrapper) return;

    const deltaY = keyScrolls.get(event.key);
    if (canNestedScroll(event.target, deltaY, wrapper)) return;

    event.preventDefault();
    if (programmaticAnimationFrame) {
      window.cancelAnimationFrame(programmaticAnimationFrame);
      programmaticAnimationFrame = 0;
    }

    if (deltaY === Infinity) {
      targetScroll = maxScroll();
    } else if (deltaY === -Infinity) {
      targetScroll = 0;
    } else {
      targetScroll = clamp(targetScroll + deltaY, 0, maxScroll());
    }

    startAnimation();
  }

  function onScroll() {
    if (!animationFrame && !programmaticAnimationFrame) {
      targetScroll = wrapper.scrollTop;
    }
  }

  function onResize() {
    targetScroll = clamp(targetScroll, 0, maxScroll());
  }

  wrapper.addEventListener('wheel', onWheel, { passive: false });
  wrapper.addEventListener('scroll', onScroll, { passive: true });
  if (keyboard) document.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize, { passive: true });

  const api = {
    scrollTo,
    destroy() {
      cancelAnimation();
      wrapper.removeEventListener('wheel', onWheel);
      wrapper.removeEventListener('scroll', onScroll);
      if (keyboard) document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      if (wrapper[SMOOTH_SCROLL_ELEMENT_FLAG] === api) delete wrapper[SMOOTH_SCROLL_ELEMENT_FLAG];
      if (window[SMOOTH_SCROLL_FLAG] === api) delete window[SMOOTH_SCROLL_FLAG];
    },
  };

  wrapper[SMOOTH_SCROLL_ELEMENT_FLAG] = api;
  window[SMOOTH_SCROLL_FLAG] = api;
  return api;
}

export function initPageSmoothScroll({ primaryWrapper, root = document, selectors = DEFAULT_SCROLL_SELECTORS } = {}) {
  if (typeof window === 'undefined') return null;

  const scrollInstances = new Map();
  let primaryApi = null;
  let rafId = 0;

  function canAttach(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (window.matchMedia?.('(pointer: coarse)').matches) return false;

    const style = window.getComputedStyle(element);
    const scrollableY = /(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflow}`);
    return scrollableY && element.scrollHeight > element.clientHeight + 1;
  }

  function attach(element, { force = false, keyboard = false } = {}) {
    if (!(element instanceof HTMLElement)) return null;
    if (!force && !canAttach(element)) return null;

    const api = initCustomSmoothScroll({ wrapper: element, keyboard });
    if (!api) return null;

    scrollInstances.set(element, api);
    return api;
  }

  function scan() {
    rafId = 0;

    if (primaryWrapper) {
      primaryApi = attach(primaryWrapper, { force: true, keyboard: true });
    }

    selectors.forEach((selector) => {
      root.querySelectorAll?.(selector).forEach((element) => attach(element));
    });
  }

  function scheduleScan() {
    if (rafId) return;
    rafId = window.requestAnimationFrame(scan);
  }

  scan();

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', scheduleScan, { passive: true });

  return {
    scrollTo(value, options) {
      const target = primaryApi || scrollInstances.values().next().value;
      target?.scrollTo(value, options);
    },
    refresh: scheduleScan,
    destroy() {
      if (rafId) window.cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener('resize', scheduleScan);
      scrollInstances.forEach((instance) => instance.destroy());
      scrollInstances.clear();
      primaryApi = null;
    },
  };
}

export function initViewportSmoothing() {
  if (typeof window === 'undefined') return null;

  let rafId = 0;
  let focusTimer = 0;
  let stableViewportHeight = 0;
  let stableViewportWidth = 0;

  function hasEditableFocus() {
    const activeElement = document.activeElement;
    return activeElement instanceof Element && Boolean(activeElement.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
  }

  function setViewportVars() {
    rafId = 0;
    const viewport = window.visualViewport;
    const layoutHeight = window.innerHeight || viewport?.height || 0;
    const visualHeight = viewport?.height || layoutHeight;
    const width = viewport?.width || window.innerWidth;
    const widthChanged = stableViewportWidth ? Math.abs(width - stableViewportWidth) > 48 : false;
    const candidateHeight = Math.max(layoutHeight, visualHeight);
    const keyboardOverlap = Math.max(0, layoutHeight - visualHeight);
    const keyboardThreshold = Math.max(120, (stableViewportHeight || layoutHeight) * 0.18);
    const keyboardLikely = hasEditableFocus() && (
      keyboardOverlap > keyboardThreshold ||
      (stableViewportHeight && candidateHeight < stableViewportHeight - keyboardThreshold)
    );

    if (!stableViewportHeight || widthChanged || !keyboardLikely) {
      stableViewportHeight = candidateHeight;
      stableViewportWidth = width;
    }

    const nextHeight = `${Math.round(stableViewportHeight)}px`;
    const nextWidth = `${Math.round(width)}px`;
    const rootStyle = document.documentElement.style;

    if (rootStyle.getPropertyValue('--iclora-viewport-height') !== nextHeight) {
      rootStyle.setProperty('--iclora-viewport-height', nextHeight);
    }

    if (rootStyle.getPropertyValue('--iclora-viewport-width') !== nextWidth) {
      rootStyle.setProperty('--iclora-viewport-width', nextWidth);
    }
  }

  function schedule() {
    if (rafId) return;
    rafId = window.requestAnimationFrame(setViewportVars);
  }

  function scheduleAfterFocusSettles() {
    if (focusTimer) window.clearTimeout(focusTimer);
    focusTimer = window.setTimeout(() => {
      focusTimer = 0;
      schedule();
    }, 180);
  }

  setViewportVars();
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule, { passive: true });
  window.visualViewport?.addEventListener('resize', schedule, { passive: true });
  document.addEventListener('focusin', scheduleAfterFocusSettles, true);
  document.addEventListener('focusout', scheduleAfterFocusSettles, true);

  return {
    destroy() {
      if (rafId) window.cancelAnimationFrame(rafId);
      if (focusTimer) window.clearTimeout(focusTimer);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      document.removeEventListener('focusin', scheduleAfterFocusSettles, true);
      document.removeEventListener('focusout', scheduleAfterFocusSettles, true);
    },
  };
}

export function initScrollPerformanceMode({ idleDelay = 160 } = {}) {
  if (typeof window === 'undefined') return null;

  let idleTimer = 0;
  let ticking = false;

  function clearScrolling() {
    idleTimer = 0;
    document.body.classList.remove('iclora-is-scrolling');
  }

  function markScrolling() {
    ticking = false;
    document.body.classList.add('iclora-is-scrolling');

    if (idleTimer) window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(clearScrolling, idleDelay);
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(markScrolling);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('scroll', onScroll, { passive: true, capture: true });

  return {
    destroy() {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('scroll', onScroll, true);
      if (idleTimer) window.clearTimeout(idleTimer);
      document.body.classList.remove('iclora-is-scrolling');
    },
  };
}

export function scrollElementIntoViewSmooth(element, { block = 'start', duration = 560 } = {}) {
  if (typeof window === 'undefined' || !(element instanceof Element)) return;

  const wrapper = element.closest('.app, .cloud-shell, .manage-account, [class*="__content"], [class*="__list"], [class*="__detail"]');
  const smoothScroll = wrapper?.[SMOOTH_SCROLL_ELEMENT_FLAG];

  if (!smoothScroll) {
    element.scrollIntoView({ block, behavior: 'smooth' });
    return;
  }

  const wrapperRect = wrapper.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const offset = block === 'center'
    ? elementRect.top - wrapperRect.top - (wrapper.clientHeight / 2) + (elementRect.height / 2)
    : elementRect.top - wrapperRect.top;
  const start = wrapper.scrollTop;
  const target = clamp(start + offset, 0, Math.max(0, wrapper.scrollHeight - wrapper.clientHeight));
  const startTime = performance.now();

  function frame(time) {
    const progress = clamp((time - startTime) / duration, 0, 1);
    smoothScroll.scrollTo(start + (target - start) * easeOutCubic(progress), { immediate: true });
    if (progress < 1) window.requestAnimationFrame(frame);
  }

  window.requestAnimationFrame(frame);
}
