import React from 'react';
import { FiExternalLink, FiGithub, FiGlobe, FiMail } from 'react-icons/fi';
import PageShell from './PageShell';

const developerHighlights = [
  {
    title: 'Product-focused engineering',
    copy: 'Building iClora with a focus on speed, clarity, and day-to-day usability across devices.',
  },
  {
    title: 'Frontend + backend ownership',
    copy: 'Handling UI, interaction quality, account flow, and cloud app integration in one product line.',
  },
  {
    title: 'Continuous iteration',
    copy: 'Shipping practical improvements quickly based on real usage, visual polish, and performance.',
  },
  {
    title: 'Strong backend engineering',
    copy: 'Designing reliable backend flows for auth, data security, session handling, and scalable app performance.',
  },
];

function DeveloperPage() {
  return (
    <PageShell
      title="Developer"
      intro="iClora is developed by Sanket Padhyal. This page shares the official developer profile and project references."
      accent="blue"
      className="iclora-developer-page"
      hideMedia
      ctaLabel="Visit Portfolio"
      ctaHref="https://sanketpadhyal.world"
    >
      <section className="iclora-page-section">
        <div className="iclora-page-section__head">
          <h2>Sanket Padhyal</h2>
          <p>Developer of iClora and the core product experience.</p>
        </div>

        <ul className="iclora-page-list iclora-developer-links">
          <li>
            <span className="iclora-developer-links__icon" aria-hidden="true"><FiGlobe /></span>
            <div>
              <strong>Website:</strong><br />
              <a className="iclora-page-inline-link iclora-page-inline-link--ext" href="https://www.sanketpadhyal.world" target="_blank" rel="noreferrer">
                <span>www.sanketpadhyal.world</span>
                <FiExternalLink aria-hidden="true" />
              </a>
            </div>
          </li>
          <li>
            <span className="iclora-developer-links__icon" aria-hidden="true"><FiMail /></span>
            <div>
              <strong>Email:</strong><br />
              <a className="iclora-page-inline-link iclora-page-inline-link--ext" href="mailto:sanketpadhyal3@gmail.com" target="_blank" rel="noreferrer">
                <span>sanketpadhyal3@gmail.com</span>
                <FiExternalLink aria-hidden="true" />
              </a>
            </div>
          </li>
          <li>
            <span className="iclora-developer-links__icon" aria-hidden="true"><FiGithub /></span>
            <div>
              <strong>GitHub:</strong><br />
              <a className="iclora-page-inline-link iclora-page-inline-link--ext" href="https://github.com/sanketpadhyal" target="_blank" rel="noreferrer">
                <span>@sanketpadhyal</span>
                <FiExternalLink aria-hidden="true" />
              </a>
            </div>
          </li>
        </ul>
      </section>

      <section className="iclora-page-section">
        <div className="iclora-page-grid iclora-page-grid--two">
          {developerHighlights.map((item) => (
            <article className="iclora-page-card" key={item.title}>
              <span className="iclora-page-card__icon" aria-hidden="true" />
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="iclora-page-section">
        <div className="iclora-page-band">
          <h2>Project repository</h2>
          <p className="iclora-page-copy">
            Repository: <a className="iclora-page-inline-link iclora-page-inline-link--ext" href="https://github.com/sanketpadhyal/iClora" target="_blank" rel="noreferrer"><span>sanketpadhyal/iClora</span><FiExternalLink aria-hidden="true" /></a><br />
            Visibility: Not open source.
          </p>
        </div>
      </section>
    </PageShell>
  );
}

export default DeveloperPage;
