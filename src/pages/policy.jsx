import React from 'react';
import PageShell from './PageShell';

const policies = [
  {
    title: 'Your data stays yours',
    copy: 'Content you upload belongs to you. iClora uses it to provide storage, viewing, search, and account features.',
  },
  {
    title: 'Use iClora responsibly',
    copy: 'Do not upload harmful, illegal, abusive, or rights-infringing material, and do not try to access another user account.',
  },
  {
    title: 'Security matters',
    copy: 'Keep your sign-in details protected, use recovery options carefully, and report suspicious access quickly.',
  },
  {
    title: 'Service changes',
    copy: 'Features, storage limits, and pricing can change as iClora grows. Major user-facing changes should be communicated clearly.',
  },
];

function PolicyPage() {
  return (
    <PageShell
      title="Policy"
      intro="A plain-language overview of the expectations around user data, safe use, account protection, and future service changes."
      accent="amber"
      className="iclora-policy-page"
      hideMedia
      ctaLabel="Manage account"
    >
      <section className="iclora-page-section">
        <div className="iclora-page-section__head">
          <h2>Core policy points</h2>
          <p>This page keeps the public policy readable while the product continues to grow.</p>
        </div>

        <div className="iclora-page-grid iclora-page-grid--two">
          {policies.map((policy) => (
            <article className="iclora-page-card" key={policy.title}>
              <span className="iclora-page-card__icon" aria-hidden="true" />
              <h3>{policy.title}</h3>
              <p>{policy.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="iclora-page-section">
        <ul className="iclora-page-list">
          <li>Only upload content you have the right to store and manage.</li>
          <li>Use account recovery and passkey features to protect your access.</li>
          <li>Delete or move data you no longer want stored in your account.</li>
          <li>Check this page again when iClora adds paid plans or major new features.</li>
        </ul>
      </section>
    </PageShell>
  );
}

export default PolicyPage;
