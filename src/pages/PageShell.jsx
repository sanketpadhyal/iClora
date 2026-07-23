import React, { useEffect } from 'react';
import { FiExternalLink } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { applyAppPageMeta } from '../components/utils/pageMeta';
import './PageShell.css';

function PageShell({
  title,
  eyebrow,
  intro,
  image,
  imageAlt,
  accent = 'blue',
  className = '',
  hideMedia = false,
  hideCta = false,
  ctaHref = '',
  children,
  ctaLabel = 'Start with iClora',
}) {
  const navigate = useNavigate();

  useEffect(() => applyAppPageMeta({
    title: `${title} | iClora`,
    lightIcon: '/favicon.ico',
    darkIcon: '/faviconn.ico',
  }), [title]);

  return (
    <main className={`iclora-page iclora-page--${accent} ${hideMedia ? 'iclora-page--no-media' : ''} ${className}`}>
      <section className="iclora-page-hero" aria-labelledby="iclora-page-title">
        <div className="iclora-page-hero__copy">
          <p className="iclora-page-eyebrow">{eyebrow}</p>
          <h1 id="iclora-page-title">{title}</h1>
          <p className="iclora-page-intro">{intro}</p>
          {!hideCta && (
            <button
              type="button"
              className="iclora-page-cta"
              onClick={() => {
                if (ctaHref) {
                  if (ctaHref.startsWith('http')) {
                    window.open(ctaHref, '_blank', 'noopener,noreferrer');
                    return;
                  }
                  window.location.href = ctaHref;
                  return;
                }
                navigate('/auth');
              }}
            >
              <span>{ctaLabel}</span>
              {ctaHref ? <FiExternalLink aria-hidden="true" /> : null}
            </button>
          )}
        </div>

        {!hideMedia && (
          <div className="iclora-page-hero__media" aria-hidden={imageAlt ? undefined : true}>
            <img src={image} alt={imageAlt || ''} loading="eager" decoding="async" />
          </div>
        )}
      </section>

      <div className="iclora-page-body">
        {children}
      </div>
    </main>
  );
}

export default PageShell;
