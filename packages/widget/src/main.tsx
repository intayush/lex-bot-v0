import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChatWidget } from './components/ChatWidget';
import './styles/playground.css';

/**
 * Spec 017 — LexBot Playground page. The in-repo demo page renamed
 * from "Smith & Associates" to "LexBot Playground" so the page
 * identifies itself as a developer / stakeholder demo of the LexBot
 * widget rather than impersonating a customer law firm.
 *
 * Contract: specs/017-chatbot-redesign/contracts/playground-page.md
 *
 * Demo law-firm content (practice-area cards, contact CTA) is preserved
 * in structure but explicitly framed as "sample / fictional" so the
 * chatbot has realistic legal-services context to talk about during
 * conversations. The "firm" shown is anonymous (no fictional name).
 */
export function LexBotPlayground() {
  return (
    <>
      <header className="lc-pg-topbar">
        <h1 className="lc-pg-brand" aria-label="LexBot Playground">
          <span className="lc-pg-wordmark">LexBot</span>{' '}
          <span className="lc-pg-brand-suffix">Playground</span>
        </h1>
        <div className="lc-pg-pill">
          <span className="lc-pg-pill-sublabel">demo / sample content</span>
        </div>
      </header>

      <section className="lc-pg-hero">
        <div className="lc-pg-hero-inner">
          <h1 className="lc-pg-hero-title">
            Try LexBot on a sample legal-services site
          </h1>
          <p className="lc-pg-hero-sub">
            This is a developer demo of the LexBot widget. The "firm" below is
            fictional — chat with the bot in the corner to see it in action.
          </p>
        </div>
      </section>

      <main className="lc-pg-content">
        <div className="lc-pg-banner" role="note">
          Sample content for the LexBot demo — the firm shown below is
          fictional.
        </div>

        <h2 className="lc-pg-section-title">How a real firm might describe their work</h2>
        <p className="lc-pg-paragraph">
          For decades, attorneys have helped families and individuals
          navigate difficult legal moments. The cards below illustrate
          the practice areas a firm might list on a similar site, so
          the chatbot has realistic context for a sample conversation.
        </p>

        <div className="lc-pg-areas">
          <article className="lc-pg-area-card">
            <h3>Personal Injury</h3>
            <p>
              Car accidents, medical malpractice, wrongful death. Sample
              firms typically work on contingency.
            </p>
          </article>
          <article className="lc-pg-area-card">
            <h3>Family Law</h3>
            <p>
              Divorce, custody, adoption. Compassionate guidance through
              difficult transitions.
            </p>
          </article>
          <article className="lc-pg-area-card">
            <h3>Estate Planning</h3>
            <p>Wills, trusts, probate. Long-term family-asset protection.</p>
          </article>
        </div>

        <section className="lc-pg-cta">
          <h2 className="lc-pg-cta-title">Ready to Talk?</h2>
          <p className="lc-pg-cta-text">Schedule a free consultation today.</p>
          <p className="lc-pg-cta-phone">(555) 123-4567</p>
          <p className="lc-pg-cta-note">
            Sample contact info — for demo purposes only.
          </p>
        </section>
      </main>

      <footer className="lc-pg-footer">
        © LexBot — sample-content demo. The "firm" shown on this page is
        fictional.
      </footer>

      <ChatWidget apiKey="dev_test_key" />
    </>
  );
}

// Mount only when running in the browser; tests import the component
// directly and render it via React Testing Library.
const rootEl = typeof document !== 'undefined' ? document.getElementById('root') : null;
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <LexBotPlayground />
    </React.StrictMode>,
  );
}
