import { useState, useEffect } from 'react';
import { ChatPanel } from './ChatPanel';
import { ChatBubble } from './ChatBubble';

interface ChatWidgetProps {
  apiKey: string;
  apiUrl?: string;
}

const DEFAULT_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/chat';

export function ChatWidget({ apiKey, apiUrl = DEFAULT_API_URL }: ChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function check() {
      setIsMobile(window.innerWidth < 768);
    }
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return (
    <div className="lc-widget">
      {isOpen && (
        <ChatPanel
          apiKey={apiKey}
          apiUrl={apiUrl}
          onClose={() => setIsOpen(false)}
        />
      )}
      {/* Hide bubble on mobile when panel is open (panel is full-screen) */}
      {!(isOpen && isMobile) && (
        <ChatBubble isOpen={isOpen} onClick={() => setIsOpen(!isOpen)} />
      )}
    </div>
  );
}
