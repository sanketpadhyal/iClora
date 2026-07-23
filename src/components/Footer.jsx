import React from 'react';
import { Link } from 'react-router-dom';
import { resetPageScrollTop } from '../ScrollToTop';
import './Footer.css';

const footerLinks = [
  { label: 'FAQ', path: '/faq' },
  { label: 'About', path: '/about' },
  { label: 'Policy', path: '/policy' },
  { label: 'Developer', path: '/developer' },
];

function Footer() {
  return (
    <footer className="iclora-footer" aria-label="Site footer">
      <div className="iclora-footer__inner">
        <nav className="iclora-footer__links" aria-label="Footer navigation">
          {footerLinks.map((link, index) => (
            <React.Fragment key={link.path}>
              <Link to={link.path} onClick={resetPageScrollTop}>
                {link.label}
              </Link>
              {index < footerLinks.length - 1 && (
                <span className="iclora-footer__sep" aria-hidden="true">/</span>
              )}
            </React.Fragment>
          ))}
        </nav>
        <div className="iclora-footer__copy">
          Copyright © 2026 iClora Inc. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

export default Footer;
