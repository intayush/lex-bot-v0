import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChatWidget } from './components/ChatWidget';

function TestSite() {
  return (
    <>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Georgia, 'Times New Roman', serif; color: #1a202c; }
        .hero { background: #1a365d; color: white; padding: 80px 40px; text-align: center; }
        .hero h1 { font-size: 2.5rem; margin-bottom: 16px; }
        .hero p { font-size: 1.2rem; opacity: 0.9; max-width: 600px; margin: 0 auto; }
        .content { max-width: 900px; margin: 0 auto; padding: 60px 40px; }
        .content h2 { font-size: 1.8rem; margin-bottom: 24px; color: #1a365d; }
        .content p { font-size: 1.1rem; line-height: 1.8; margin-bottom: 16px; color: #4a5568; }
        .areas { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 24px; margin: 40px 0; }
        .area-card { background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px; }
        .area-card h3 { color: #1a365d; margin-bottom: 8px; }
        .area-card p { font-size: 0.95rem; }
        .cta { background: #f7fafc; padding: 60px 40px; text-align: center; }
        .cta h2 { color: #1a365d; margin-bottom: 16px; }
        .cta p { font-size: 1.1rem; color: #4a5568; }
        .cta .phone { font-size: 1.4rem; color: #1a365d; font-weight: bold; margin-top: 16px; }
        footer { background: #2d3748; color: #a0aec0; padding: 40px; text-align: center; font-size: 0.9rem; }
        @keyframes typing { 0%, 60% { opacity: 0.3; } 30% { opacity: 1; } }
        .lc-typing span { animation: typing 1.4s infinite; }
      `}</style>

      <div className="hero">
        <h1>Smith & Associates</h1>
        <p>Attorneys at Law — Fighting for Your Rights Since 2006</p>
      </div>

      <div className="content">
        <h2>How We Can Help</h2>
        <p>
          For over 20 years, Smith & Associates has been helping families and individuals
          in Springfield and the surrounding communities. Our dedicated team provides
          compassionate, aggressive representation.
        </p>

        <div className="areas">
          <div className="area-card">
            <h3>Personal Injury</h3>
            <p>Car accidents, medical malpractice, wrongful death. No fee unless we win.</p>
          </div>
          <div className="area-card">
            <h3>Family Law</h3>
            <p>Divorce, custody, adoption. Compassionate guidance through difficult times.</p>
          </div>
          <div className="area-card">
            <h3>Estate Planning</h3>
            <p>Wills, trusts, probate. Protect your family's future.</p>
          </div>
        </div>
      </div>

      <div className="cta">
        <h2>Ready to Talk?</h2>
        <p>Schedule your free consultation today.</p>
        <p className="phone">(555) 123-4567</p>
      </div>

      <footer>
        <p>&copy; 2026 Smith & Associates. 123 Main Street, Suite 400, Springfield, IL 62701</p>
      </footer>

      <ChatWidget apiKey="dev_test_key" />
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TestSite />
  </React.StrictMode>
);
