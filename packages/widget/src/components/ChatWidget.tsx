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
//
// IMPORTANT: Vite only statically replaces *direct* property accesses
// of `import.meta.env.VAR_NAME`. Indirect access (`meta.env[name]`,
// `meta.env?.VAR`, destructuring) is NOT replaced and reads as
// `undefined` at runtime in production bundles. So we must use the
// direct-access pattern below — guarded with try/catch for the Next
// SWC compile path that doesn't know about import.meta.env.
//
// Production guardrail: if Vite is building for production AND no
// VITE_API_URL is set, we still also fail at vite.config.ts level so
// the build never produces a localhost-defaulted bundle.
function readDefaultApiUrl(): string {
  try {
    // Direct access — Vite's static replacement requires this exact
    // shape. Wrapped in IIFE so the typecast is local; the cast
    // satisfies both Vite's ImportMeta and Next's (which lacks env).
    const value = (import.meta as unknown as { env: { VITE_API_URL?: string } }).env.VITE_API_URL;
    if (typeof value === 'string' && value.length > 0) return value;
    const isProd = (import.meta as unknown as { env: { PROD?: boolean } }).env.PROD === true;
    if (isProd) {
      throw new Error(
        'VITE_API_URL is required for production widget builds. ' +
          'Set it in your Netlify (or other host) environment variables, ' +
          'e.g. VITE_API_URL=https://<api-site>.netlify.app/api/chat. ' +
          'See packages/widget/README.md.',
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('VITE_API_URL is required')) {
      throw err;
    }
    // import.meta.env access threw — fall through to the localhost default
    // (Next.js SWC compile path; never reaches a browser via Vite).
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
 *   - the firm-configured theme (an inline CSS-variable override applied
 *     on the `.lc-widget` wrapper so it cascades into BOTH the bubble
 *     and the panel)
 */
export function ChatWidget({ apiKey, apiUrl = DEFAULT_API_URL }: ChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  // Theme cascading style. Null when /api/config hasn't returned yet
  // OR when the firm hasn't customised colors — both cases fall back
  // to the indigo defaults declared in panel.css.
  const [themeStyle, setThemeStyle] = useState<React.CSSProperties | null>(null);
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);

  // Fetch the firm's theme once on mount. The full /api/config payload
  // is also fetched by ChatPanel when the panel opens; this lightweight
  // fetch lets the bubble carry the theme even before the panel mounts.
  // Both calls hit the same cache-friendly endpoint.
  useEffect(() => {
    const baseUrl = apiUrl.replace(/\/api\/chat\/?$/, '');
    fetch(`${baseUrl}/api/config`, {
      headers: { 'x-api-key': apiKey },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const theme = data?.theme as
          | { primary_bg?: string; primary_color?: string }
          | null
          | undefined;
        if (theme && theme.primary_bg && theme.primary_color) {
          setThemeStyle({
            // Cast through CSSProperties because TypeScript doesn't
            // know about arbitrary --custom-property keys.
            ['--lc-primary-bg' as keyof React.CSSProperties]: theme.primary_bg,
            ['--lc-primary-color' as keyof React.CSSProperties]: theme.primary_color,
          } as React.CSSProperties);
        }
      })
      .catch(() => {
        // Silently fall back to defaults; bubble still renders with
        // indigo. Same failure semantics as ChatPanel's own fetch.
      });
  }, [apiKey, apiUrl]);

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
    <div className="lc-widget" style={themeStyle ?? undefined}>
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
