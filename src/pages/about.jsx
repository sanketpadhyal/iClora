import React from 'react';
import PageShell from './PageShell';

const values = [
  {
    title: 'Calm interface',
    copy: 'The app keeps controls and content readable so cloud storage feels simple instead of heavy.',
  },
  {
    title: 'Useful intelligence',
    copy: 'Smart search is used where it helps you find data faster, especially inside photos.',
  },
  {
    title: 'Respect for user data',
    copy: 'Security, privacy, and recovery are treated as core product work, not decoration.',
  },
  {
    title: 'Reliable access everywhere',
    copy: 'Your cloud space is designed to stay clear and dependable across desktop, tablet, and mobile use.',
  },
];

function AboutPage() {
  return (
    <PageShell
      title="About iClora"
      intro="iClora is built as a personal cloud space for the things people come back to every day: photos, notes, contacts, and important data."
      image="/iclora-hero-cloud.webp"
      accent="green"
      className="iclora-about-page"
      ctaLabel="Start with iClora"
    >
      <section className="iclora-page-section">
        <div className="iclora-page-section__head">
          <h2>A small cloud with a clear job</h2>
          <p>iClora focuses on making storage feel calm, searchable, and personal from the first screen.</p>
        </div>

        <div className="iclora-page-grid iclora-page-grid--two">
          {values.map((value) => (
            <article className="iclora-page-card" key={value.title}>
              <span className="iclora-page-card__icon" aria-hidden="true" />
              <h3>{value.title}</h3>
              <p>{value.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="iclora-page-section">
        <ul className="iclora-page-list">
          <li>1 GB free storage gives every new user a real starting point.</li>
          <li>Photos, notes, and contacts are placed where they are easy to scan and manage.</li>
          <li>Future plans can add more storage while keeping the experience familiar.</li>
        </ul>
      </section>
    </PageShell>
  );
}

export default AboutPage;
