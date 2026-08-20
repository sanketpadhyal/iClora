import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { resetPageScrollTop } from '../ScrollToTop';
import './Navbar.css';

const navItems = [
  { label: 'Home', accent: 'sky', path: '/home', icon: '/home.webp' },
  { label: 'Features', accent: 'blue', path: '/features', icon: '/features.webp' },
  { label: 'Application', accent: 'green', path: '/application', icon: '/app.webp' },
  { label: 'Support', accent: 'teal', path: '/support', icon: '/help.webp' },
];

const preventTouchPopup = (e) => {
  // Prevent long-press context menu and selection popups on mobile
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
};

function Navbar({ hidden = false }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const themedRoutes = ['/', '/home', '/auth', '/profile-photo', '/features', '/application', '/faq', '/about', '/support', '/policy', '/developer'];
  const isThemedRoute = themedRoutes.includes(location.pathname);

  useEffect(() => {
    if (hidden) setMenuOpen(false);
  }, [hidden]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow || '';

    // Lock scroll while mobile panel is open
    if (menuOpen && !hidden) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = previousOverflow;
    }

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [hidden, menuOpen]);

  const openMenu = () => setMenuOpen(true);
  const closeMenu = () => setMenuOpen(false);

  const navigateFromTop = (path) => {
    resetPageScrollTop();
    if (location.pathname === path || (path === '/home' && location.pathname === '/')) {
      window.setTimeout(resetPageScrollTop, 0);
      return;
    }
    navigate(path);
    window.setTimeout(resetPageScrollTop, 0);
  };

  const goHome = () => {
    navigateFromTop('/home');
    closeMenu();
  };

  const goAuth = () => {
    navigateFromTop('/auth');
    closeMenu();
  };

  const isActive = (item) => {
    if (item.path === '/home') return location.pathname === '/home' || location.pathname === '/';
    return item.path !== '/auth' && location.pathname === item.path;
  };

  const handleNavItem = (item) => {
    if (item.path === '/home') {
      goHome();
      return;
    }
    if (item.path) {
      navigateFromTop(item.path);
    }
    closeMenu();
  };

  return (
    <nav className={`navbar ${hidden ? 'navbar--hidden' : ''} ${isThemedRoute ? 'navbar--home' : ''}`} aria-label="Primary navigation" aria-hidden={hidden}>
      <div className="navbar-container">
        <button
          className="hamburger"
          aria-label="Open menu"
          aria-expanded={menuOpen}
          aria-controls="mobile-navigation-panel"
          onClick={openMenu}
        >
          <span />
          <span />
          <span />
        </button>
        <div className="navbar-logo" role="button" tabIndex={0} onClick={goHome} onKeyDown={(e) => (e.key === 'Enter' ? goHome() : null)}>
          <picture>
            <source srcSet="/cloud-logo-dark.webp" media="(prefers-color-scheme: dark)" />
            <img src="/pwa-icon-512.png" alt="Logo" className="logo-image" />
          </picture>
        </div>

        <div className="navbar-links">
          {navItems.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`navbar-link ${isActive(item) ? 'is-active' : ''}`}
              data-nav-accent={item.accent}
              onClick={() => handleNavItem(item)}
              onContextMenu={preventTouchPopup}
              aria-current={isActive(item) ? 'page' : undefined}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="navbar-icons">
          <button
            className="icon-button login-button"
            onClick={goAuth}
            onContextMenu={preventTouchPopup}
            onTouchStart={preventTouchPopup}
          >
            Login
          </button>
          <button
            className="icon-button signup-button"
            onClick={goAuth}
            onContextMenu={preventTouchPopup}
            onTouchStart={preventTouchPopup}
          >
            Sign Up
          </button>
        </div>

        <div className={`panel-overlay ${menuOpen ? 'open' : ''}`} onClick={closeMenu} />
        <aside
          id="mobile-navigation-panel"
          className={`mobile-panel ${menuOpen ? 'open' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-hidden={!menuOpen}
        >
          <div className="mobile-panel-header">
            <button className="panel-close" aria-label="Close menu" onClick={closeMenu}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <nav className="mobile-panel-nav">
            {navItems.map((item) => (
              <button
                key={item.label}
                type="button"
                className={`mobile-panel-link ${isActive(item) ? 'is-active' : ''}`}
                data-nav-accent={item.accent}
                onClick={() => handleNavItem(item)}
                onContextMenu={preventTouchPopup}
                aria-current={isActive(item) ? 'page' : undefined}
              >
                <span className="mobile-panel-link__icon" aria-hidden="true">
                  <img src={item.icon} alt="" loading="eager" decoding="async" />
                </span>
                <span className="mobile-panel-link__label">{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="mobile-panel-footer">
            <div className="mobile-panel-actions">
              <button className="icon-button login-button" onClick={goAuth}>Login</button>
              <button className="signup-button" onClick={goAuth}>Sign Up</button>
            </div>
          </div>
        </aside>
      </div>
    </nav>
  );
}

export default Navbar;
