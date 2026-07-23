function setOrRemoveAttribute(element, name, value) {
  if (value === null || typeof value === 'undefined') {
    element.removeAttribute(name);
    return;
  }
  element.setAttribute(name, value);
}

function snapshotAttributes(element, names) {
  return names.reduce((snapshot, name) => {
    snapshot[name] = element.getAttribute(name);
    return snapshot;
  }, {});
}

function restoreAttributes(element, snapshot) {
  Object.entries(snapshot).forEach(([name, value]) => {
    setOrRemoveAttribute(element, name, value);
  });
}

function getIconType(iconPath) {
  if (typeof iconPath !== 'string') return '';
  if (iconPath.endsWith('.webp')) return 'image/webp';
  if (iconPath.endsWith('.ico')) return 'image/x-icon';
  if (iconPath.endsWith('.png')) return 'image/png';
  return '';
}

export function applyAppPageMeta({ title, lightIcon, darkIcon }) {
  if (typeof document === 'undefined') return () => {};

  const previousTitle = document.title;
  const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  const previousAppleTitle = appleTitle?.getAttribute('content') || '';
  const iconLinks = Array.from(document.querySelectorAll('link[rel~="icon"]'));
  const iconSnapshots = iconLinks.map((link) => ({
    link,
    attributes: snapshotAttributes(link, ['rel', 'href', 'media', 'type', 'sizes']),
  }));
  const createdLinks = [];

  const ensureIconLink = (media = '') => {
    const existing = iconLinks.find((link) => (link.getAttribute('media') || '') === media);
    if (existing) return existing;

    const link = document.createElement('link');
    link.setAttribute('rel', 'icon');
    if (media) link.setAttribute('media', media);
    document.head.appendChild(link);
    iconLinks.push(link);
    createdLinks.push(link);
    return link;
  };

  const lightLink = ensureIconLink('(prefers-color-scheme: light)');
  const darkLink = ensureIconLink('(prefers-color-scheme: dark)');
  const fallbackLink = ensureIconLink('');
  const darkMedia = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

  const updateFallbackIcon = () => {
    const currentIcon = darkMedia?.matches ? darkIcon : lightIcon;
    fallbackLink.setAttribute('href', currentIcon);
    const iconType = getIconType(currentIcon);
    if (iconType) fallbackLink.setAttribute('type', iconType);
  };

  document.title = title;
  if (appleTitle) appleTitle.setAttribute('content', title);

  lightLink.setAttribute('href', lightIcon);
  lightLink.setAttribute('type', getIconType(lightIcon));
  darkLink.setAttribute('href', darkIcon);
  darkLink.setAttribute('type', getIconType(darkIcon));
  updateFallbackIcon();

  if (darkMedia?.addEventListener) {
    darkMedia.addEventListener('change', updateFallbackIcon);
  } else if (darkMedia?.addListener) {
    darkMedia.addListener(updateFallbackIcon);
  }

  return () => {
    if (darkMedia?.removeEventListener) {
      darkMedia.removeEventListener('change', updateFallbackIcon);
    } else if (darkMedia?.removeListener) {
      darkMedia.removeListener(updateFallbackIcon);
    }

    document.title = previousTitle || 'iClora';
    if (appleTitle && previousAppleTitle) appleTitle.setAttribute('content', previousAppleTitle);
    iconSnapshots.forEach(({ link, attributes }) => restoreAttributes(link, attributes));
    createdLinks.forEach((link) => link.remove());
  };
}
