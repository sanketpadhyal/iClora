import React, { useEffect, useRef } from 'react';
import './WhatWeGive.css';

function useScrollReveal(containerRef) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      container.querySelectorAll('.iclora-feature-card').forEach((el) => {
        el.classList.add('is-visible');
      });
      return;
    }

    const cards = container.querySelectorAll('.iclora-feature-card');

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.12,
        rootMargin: '0px 0px -40px 0px',
      }
    );

    cards.forEach((card) => observer.observe(card));

    return () => observer.disconnect();
  }, [containerRef]);
}

function WhatWeGive() {
  const sectionRef = useRef(null);
  useScrollReveal(sectionRef);

  return (
    <section
      ref={sectionRef}
      className="iclora-what-we-give"
      aria-label="What we give"
    >
      <div className="iclora-what-we-give__inner">
        <article className="iclora-feature-card">
          <div className="iclora-feature-card__media iclora-feature-card__media--first" aria-hidden="true">
            <img src="/apps.webp" alt="" loading="lazy" />
          </div>
          <h2 className="iclora-feature-card__title">
            Here you can store your data safely
          </h2>
          <p className="iclora-feature-card__body">
            iClora's moto is simple: upload your data here and keep it safe. Your files
            are stored securely and encrypted, so only you have access.
            <span className="iclora-feature-card__highlight">
              You can find your images by just describing them.
            </span>
          </p>
        </article>

        <article className="iclora-feature-card">
          <div className="iclora-feature-card__media" aria-hidden="true">
            <img src="/gb.webp" alt="" loading="lazy" />
          </div>
          <h2 className="iclora-feature-card__title">
            1&nbsp;GB free plan to get started
          </h2>
          <p className="iclora-feature-card__body">
            Every account comes with 1&nbsp;GB of free storage so you can try iClora,
            upload important files, and see how fast and simple it feels.
          </p>
        </article>
      </div>
    </section>
  );
}

export default WhatWeGive;
