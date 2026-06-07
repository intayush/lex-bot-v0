'use client';

import { useState } from 'react';
import { ChatPanel } from '@legal-chatbot/widget';

/**
 * Spec 017 + dashboard-preview parity.
 *
 * The Preview Chat sidebar in /dashboard/sop and /dashboard/config
 * mounts the production ChatPanel inline (mode="embedded") so the
 * lawyer testing a draft SOP sees EXACTLY the experience an end-user
 * gets — same redesigned glass surface, same SOP chips, same
 * contact form, same preflight phrasing, same progress bar, same
 * streaming. Pre-spec-017 the preview was a 100-LOC reimplementation
 * that diverged from the real widget; bumping ChatPanel up to a
 * shared component eliminates that drift.
 *
 * `extraHeaders={{ 'x-preview': 'true' }}` tells the API to load the
 * latest SOP / config (including unpublished drafts) instead of the
 * published version — see packages/api/src/app/api/chat/route.ts.
 *
 * Reset behavior: bumping `sessionKey` remounts ChatPanel with a
 * fresh useChat instance. We also clear the session-id from
 * sessionStorage so the server treats the next turn as a brand-new
 * conversation rather than resuming the previous one.
 *
 * Theme picker: a row of preset gradient swatches above the chat
 * lets the lawyer try out brand colors for their widget. The picker
 * is PREVIEW-ONLY — selection lives only in this component's state
 * and is NOT persisted to /api/config or the firm's configuration
 * row. To make a chosen theme stick on the deployed widget the
 * embedding host must set --lc-primary-bg + --lc-primary-color CSS
 * variables on a parent of the panel; persistence in the
 * configuration is a future enhancement.
 *
 * Implementation: each swatch maps to (a) a paintable
 * `--lc-primary-bg` value (solid color or CSS gradient) and (b) a
 * representative `--lc-primary-color` for borders/text/outlines
 * (CSS borders cannot use gradients without background-clip
 * trickery, so a solid representative color is necessary). When
 * the lawyer picks a theme we set both CSS variables as inline
 * style on the wrapper, and the embedded panel's component tree
 * inherits them via the cascade.
 */

interface ThemeSwatch {
  id: string;
  label: string;
  /** Paintable background — may be a solid color OR a CSS gradient. */
  primaryBg: string;
  /** Representative solid color for borders/foreground. */
  primaryColor: string;
}

const THEMES: ThemeSwatch[] = [
  {
    id: 'default',
    label: 'Indigo (default)',
    primaryBg: '#4338ca',
    primaryColor: '#4338ca',
  },
  {
    id: 'sunset',
    label: 'Sunset',
    primaryBg: 'linear-gradient(135deg, #ff8a00 0%, #e52e71 100%)',
    primaryColor: '#e52e71',
  },
  {
    id: 'ocean',
    label: 'Ocean',
    primaryBg: 'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)',
    primaryColor: '#2193b0',
  },
  {
    id: 'forest',
    label: 'Forest',
    primaryBg: 'linear-gradient(135deg, #134e5e 0%, #71b280 100%)',
    primaryColor: '#134e5e',
  },
  {
    id: 'plum',
    label: 'Plum',
    primaryBg: 'linear-gradient(135deg, #6a3093 0%, #a044ff 100%)',
    primaryColor: '#6a3093',
  },
  {
    id: 'slate',
    label: 'Slate',
    primaryBg: 'linear-gradient(135deg, #232526 0%, #414345 100%)',
    primaryColor: '#414345',
  },
];

export function PreviewChat() {
  const [sessionKey, setSessionKey] = useState(0);
  const [activeThemeId, setActiveThemeId] = useState<string>('default');

  function reset() {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('lc_session_id');
    }
    setSessionKey((k) => k + 1);
  }

  const activeTheme = THEMES.find((t) => t.id === activeThemeId) ?? THEMES[0];

  // Inline style applied to the wrapper around the embedded panel.
  // Setting these two CSS variables here lets them cascade into
  // every widget component (see packages/widget/src/styles/panel.css).
  // Cast through React.CSSProperties because TS doesn't know about
  // arbitrary --custom-property declarations on the style object.
  const themeStyle = {
    '--lc-primary-bg': activeTheme.primaryBg,
    '--lc-primary-color': activeTheme.primaryColor,
  } as React.CSSProperties;

  return (
    <div className="bg-white rounded-xl border border-[#E5E5E5] sticky top-8 overflow-hidden flex flex-col" style={{ height: '600px' }}>
      {/* Sidebar header — sits ABOVE the embedded panel. The embedded
          panel hides its own close X (it has nowhere to go) but keeps
          the chatbot-name title strip. We add a "Reset" affordance
          here so the lawyer can wipe the conversation. */}
      <div className="px-5 py-3.5 border-b border-[#E5E5E5] flex items-center justify-between flex-shrink-0">
        <h3 className="text-sm font-semibold text-[#171717]">Preview Chat</h3>
        <button
          onClick={reset}
          className="text-xs text-[#2563EB] hover:text-[#1D4ED8] font-medium transition"
        >
          Reset
        </button>
      </div>

      {/* Theme swatches. Preview-only — no persistence. */}
      <div className="px-5 py-3 border-b border-[#E5E5E5] flex-shrink-0">
        <div className="text-xs font-medium text-[#6B7280] mb-2">
          Color theme
        </div>
        <div
          className="flex flex-wrap gap-2"
          role="radiogroup"
          aria-label="Chatbot color theme"
        >
          {THEMES.map((theme) => {
            const isActive = theme.id === activeThemeId;
            return (
              <button
                key={theme.id}
                type="button"
                role="radio"
                aria-checked={isActive}
                aria-label={theme.label}
                title={theme.label}
                onClick={() => setActiveThemeId(theme.id)}
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: theme.primaryBg,
                  cursor: 'pointer',
                  // Active swatch gets a darker ring; inactive a thin
                  // muted border so light-colored gradients stay visible
                  // against the white panel.
                  border: isActive
                    ? `2px solid ${theme.primaryColor}`
                    : '1px solid #E5E5E5',
                  outline: isActive ? '2px solid white' : 'none',
                  outlineOffset: '-4px',
                  padding: 0,
                }}
              />
            );
          })}
        </div>
      </div>

      {/* The embedded ChatPanel fills the remaining height. The `key`
          forces a fresh mount on reset (new useChat instance, cleared
          messages, new session id from /api/chat's first response).
          A small inner padding on this wrapper keeps the embedded
          panel's rounded corners + border visually separated from the
          PreviewChat container's own border (otherwise the two
          borders sit flush against each other and read as a doubled
          line). The `themeStyle` inline style cascades the picked
          theme's CSS variables into the embedded widget. */}
      <div className="flex-1 min-h-0 p-3" style={themeStyle}>
        <ChatPanel
          key={sessionKey}
          apiKey="dev_test_key"
          apiUrl="/api/chat"
          mode="embedded"
          extraHeaders={{ 'x-preview': 'true' }}
          onCloseRequest={() => {
            /* Embedded mode has no close path — host controls visibility. */
          }}
          onClosed={() => {
            /* Embedded mode never fires onClosed (host owns mount). */
          }}
        />
      </div>
    </div>
  );
}
