import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lex Bot Dashboard',
  description: 'Manage leads, configure your chatbot, and track client intake for your law firm.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        className="antialiased"
        style={{ fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif" }}
      >
        {children}
      </body>
    </html>
  );
}
