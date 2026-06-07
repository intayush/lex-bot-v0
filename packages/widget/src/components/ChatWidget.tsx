import { useState, useRef, useEffect } from 'react';
import { ChatPanel } from './ChatPanel';
import { ChatBubble } from './ChatBubble';

interface ChatWidgetProps {
  apiKey: string;
  apiUrl?: string;
}

// Read VITE_API_URL only when running under Vite (the playground demo).
// Other consumers (e.g., the dashboard preview compiled by Next.js'
// SWC) don't expose `import.meta.env`; accessing it unconditionally
// would crash the build. We probe via `as any` so both type contexts
// (widget's vite types + api's Next.js types) accept the call.
function readDefaultApiUrl(): string {
  try {
    const meta = import.meta as { env?: { VITE_API_URL?: string } };
    const value = meta.env?.VITE_API_URL;
    if (typeof value === 'string' && value.length > 0) return value;
  } catch {
    // import.meta.env access threw — fall through to the default.
  }
  return 'http://localhost:3000/api/chat';
}

const DEFAULT_API_URL = readDefaultApiUrl();

/**
 * Spec 017 — top-level widget container. Owns:
 *   - the bubble open/close state
 *   - the bubble's DOM ref so focus can return to it after the panel closes
 *   - mount lifecycle for ChatPanel: mounts on open, stays mounted while
 *     exiting (so the close animation can run), unmounts on `onClosed`
 */
export function ChatWidget({ apiKey, apiUrl = DEFAULT_API_URL }: ChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    function check() {
      setIsMobile(window.innerWidth < 768);
    }
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Keep the panel mounted during the exit animation by tracking
  // `isMounted` separately from `isOpen`. Open → mount immediately;
  // close → keep mounted until `onClosed` fires (PanelShell's
  // animationend handler), then unmount.
  useEffect(() => {
    if (isOpen && !isMounted) {
      setIsMounted(true);
    }
  }, [isOpen, isMounted]);

  // Restore focus to the bubble when the panel finishes closing — but
  // only if it was actually open (we don't steal focus on mount).
  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true;
    }
  }, [isOpen]);

  return (
    <div className="lc-widget">
      {isMounted && (
        <ChatPanel
          apiKey={apiKey}
          apiUrl={apiUrl}
          onCloseRequest={() => setIsOpen(false)}
          onClosed={() => {
            setIsMounted(false);
            // Return focus to the bubble for keyboard / SR users.
            if (wasOpenRef.current) {
              bubbleRef.current?.focus();
              wasOpenRef.current = false;
            }
          }}
        />
      )}
      {/* On mobile, hide the bubble while the panel is mounted (it covers
          the full viewport); on tablet/desktop, the bubble is hidden when
          the panel is open via existing UX. */}
      {!(isMounted && isMobile) && (
        <ChatBubble
          ref={bubbleRef}
          isOpen={isOpen}
          onClick={() => setIsOpen((v) => !v)}
        />
      )}
    </div>
  );
}
