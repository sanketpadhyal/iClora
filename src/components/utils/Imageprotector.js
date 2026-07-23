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

export const initGlobalImageProtection = () => {

  const protectImage = (img) => {

    img.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      return false;
    });

    img.addEventListener('dragstart', (e) => {
      e.preventDefault();
      return false;
    });

    img.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });

    img.addEventListener('touchstart', (e) => {
      e.preventDefault();
    });

    img.style.pointerEvents = 'none';
    img.style.userSelect = 'none';
    img.style.WebkitUserSelect = 'none';
    img.style.WebkitTouchCallout = 'none';
    img.draggable = false;
  };

  const images = document.querySelectorAll('img');
  images.forEach(protectImage);

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

const imageProtection = {
  useImageProtection,
  initGlobalImageProtection,
};

export default imageProtection;
