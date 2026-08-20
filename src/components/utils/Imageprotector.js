/**
 * Image Protection Utility
 * Prevents:
 * - Right-click context menu on images
 * - Drag and drop of images
 * - Cursor-based movement/interaction
 * - Image copying/downloading
 */

// Hook for protecting individual images
export const useImageProtection = () => {
  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    return false;
  };

  const handleDragStart = (e) => {
    e.preventDefault();
    e.stopPropagation();
    return false;
  };

  const handleMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    return false;
  };

  const handleTouchStart = (e) => {
    e.preventDefault();
    e.stopPropagation();
    return false;
  };

  return {
    onContextMenu: handleContextMenu,
    onDragStart: handleDragStart,
    onMouseDown: handleMouseDown,
    onTouchStart: handleTouchStart,
  };
};

// Global initialization for all images on page
export const initGlobalImageProtection = () => {
  // Protect all images on the page
  const protectImage = (img) => {
    // Prevent context menu
    img.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      return false;
    });

    // Prevent drag start
    img.addEventListener('dragstart', (e) => {
      e.preventDefault();
      return false;
    });

    // Prevent mouse down selection
    img.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });

    // Prevent touch selection
    img.addEventListener('touchstart', (e) => {
      e.preventDefault();
    });

    // Add pointer-events: none to prevent cursor interaction
    img.style.pointerEvents = 'none';
    img.style.userSelect = 'none';
    img.style.WebkitUserSelect = 'none';
    img.style.WebkitTouchCallout = 'none';
    img.draggable = false;
  };

  // Get all images
  const images = document.querySelectorAll('img');
  images.forEach(protectImage);

  // Listen for new images being added to DOM
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.addedNodes.length) {
        mutation.addedNodes.forEach((node) => {
          if (node.tagName === 'IMG') {
            protectImage(node);
          } else if (node.querySelectorAll) {
            node.querySelectorAll('img').forEach(protectImage);
          }
        });
      }
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
};

export default {
  useImageProtection,
  initGlobalImageProtection,
};
