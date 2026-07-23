import React from 'react';
import PageShell from './PageShell';

const supportTopics = [
  {
    title: 'Account access',
    copy: 'Get help with sign in, profile photo setup, passkeys, and account recovery.',
  },
  {
    title: 'Storage questions',
    copy: 'Understand your free storage, future plan options, and how app data uses space.',
  },
  {
    title: 'Photos and search',
    copy: 'Learn how uploads, photo viewing, sharing, and description search are meant to work.',
  },
  {
    title: 'Safety and privacy',
    copy: 'Review how iClora approaches data protection, secure sessions, and user control.',
  },
];

function SupportPage() {
  return (
    <PageShell
      title="Support"
      intro="Support starts with clear account paths, practical recovery, and focused help for the parts of iClora you use most."
      accent="teal"
      className="iclora-support-page"
      hideMedia
      ctaLabel="Mail now"
      ctaHref="mailto:icloraofficial@gmail.com"
    >
      <section className="iclora-page-section">
        <div className="iclora-page-section__head">
          <h2>Support areas</h2>
          <p>Choose the area closest to what you are trying to fix or understand.</p>
        </div>

        <div className="iclora-page-grid iclora-page-grid--two">
          {supportTopics.map((topic) => (
            <article className="iclora-page-card" key={topic.title}>
              <span className="iclora-page-card__icon" aria-hidden="true" />
              <h3>{topic.title}</h3>
              <p>{topic.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="iclora-page-section">
        <div className="iclora-support-mail">
          <div className="iclora-support-mail__icon" aria-hidden="true">
            <img src="/Gmail_icon_(2020).svg.webp" alt="" />
          </div>
          <div className="iclora-support-mail__copy">
            <h2>Mail iClora Support</h2>
            <p>If you need direct help, send us your issue and account details using this support email.</p>
            <a href="mailto:icloraofficial@gmail.com">icloraofficial@gmail.com</a>
          </div>
        </div>
      </section>

    </PageShell>
  );
}

export default SupportPage;
