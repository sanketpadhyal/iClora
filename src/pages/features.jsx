import React from 'react';
import PageShell from './PageShell';

const features = [
  {
    title: 'Photos that stay easy to find',
    copy: 'Keep memories together and search for images by describing what is inside them.',
  },
  {
    title: 'Notes, contacts, and files',
    copy: 'Store everyday information in one account so it is ready when you need it.',
  },
  {
    title: 'Private by design',
    copy: 'Your data is handled with account protection, encryption, and careful access controls.',
  },
  {
    title: 'Simple recovery',
    copy: 'Account recovery tools help you regain access without turning the dashboard into a maze.',
  },
  {
    title: 'Free storage to begin',
    copy: 'Every account starts with 1 GB so you can try iClora before future upgrades arrive.',
  },
  {
    title: 'Built for every screen',
    copy: 'The cloud dashboard is designed for quick use on phone, tablet, and desktop.',
  },
];

function FeaturesPage() {
  return (
    <PageShell
      title="Features"
      intro="A clean cloud home for photos, notes, contacts, and important data, with search and safety kept close to the surface."
      image="/apps.webp"
      accent="blue"
      className="iclora-features-page"
    >
      <section className="iclora-page-section">
        <div className="iclora-page-section__head">
          <h2>Everything is arranged around everyday use</h2>
          <p>iClora keeps the product focused: upload, organize, find, and protect the things that matter.</p>
        </div>

        <div className="iclora-page-grid">
          {features.map((feature) => (
            <article className="iclora-page-card" key={feature.title}>
              <span className="iclora-page-card__icon" aria-hidden="true" />
              <h3>{feature.title}</h3>
              <p>{feature.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="iclora-page-section">
        <div className="iclora-page-band">
          <h2>Start small, keep growing</h2>
          <p className="iclora-page-copy">
            iClora begins with a simple free plan and a compact app experience, then leaves room for future storage upgrades without changing the way your data is organized.
          </p>
        </div>
      </section>
    </PageShell>
  );
}

export default FeaturesPage;
