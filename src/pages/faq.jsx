import React from 'react';
import PageShell from './PageShell';

const faqs = [
  {
    question: 'What can I store in iClora?',
    answer: 'You can keep photos, notes, contacts, and account data in iClora. File storage and larger plan options can grow as the product expands.',
  },
  {
    question: 'How much storage do I get for free?',
    answer: 'Every account starts with 1 GB of free storage. Paid upgrades are planned for future releases.',
  },
  {
    question: 'Can I search photos by description?',
    answer: 'Yes. iClora Photos is designed so you can find images by describing what you remember from the photo.',
  },
  {
    question: 'Is iClora made for mobile?',
    answer: 'Yes. The public pages and cloud dashboard use responsive layouts for phone, tablet, and desktop screens.',
  },
  {
    question: 'How do I access my cloud dashboard?',
    answer: 'Use Sign In from the navbar, complete account setup if needed, and iClora will open your cloud dashboard.',
  },
  {
    question: 'What happens if I need account recovery?',
    answer: 'Recovery tools are available from the account area so you can manage access and regain control when needed.',
  },
  {
    question: 'Can I use iClora on more than one device?',
    answer: 'Yes. You can sign in on multiple devices and access your cloud data with the same account.',
  },
  {
    question: 'Do I need to install anything to use iClora?',
    answer: 'No extra app is required for the web experience. You can use iClora directly from your browser.',
  },
  {
    question: 'How do I contact iClora support?',
    answer: 'You can open the Support page and send a mail to icloraofficial@gmail.com for direct help.',
  },
  {
    question: 'Will iClora add paid storage plans later?',
    answer: 'Yes. iClora currently starts with a free plan, and larger paid storage plans are intended for future releases.',
  },
];

function FAQPage() {
  return (
    <PageShell
      title="FAQ"
      intro="Straight answers about storage, search, account setup, and how iClora behaves across your devices."
      accent="violet"
      className="iclora-faq-page"
      hideMedia
      ctaLabel="Open my account"
    >
      <section className="iclora-page-section">
        <div className="iclora-page-section__head">
          <h2>Common questions</h2>
          <p>Short, practical answers so you can move through the site without guessing.</p>
        </div>

        <div className="iclora-page-faq">
          {faqs.map((item) => (
            <details key={item.question} className="iclora-page-faq__item">
              <summary>
                <span className="iclora-page-faq__caret" aria-hidden="true" />
                <span>{item.question}</span>
              </summary>
              <div className="iclora-page-faq__content">
                <p>{item.answer}</p>
              </div>
            </details>
          ))}
        </div>
      </section>
    </PageShell>
  );
}

export default FAQPage;
