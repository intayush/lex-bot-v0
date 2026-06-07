'use client';

import { useState } from 'react';
import { ChatPanel } from '@legal-chatbot/widget';
import type { Theme } from '@legal-chatbot/shared';

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
 * Theme picker + Save Theme: a row of preset gradient swatches
 * above the chat lets the lawyer try out brand colors. The picker
 * is now persistent — clicking "Save theme" POSTs the chosen swatch
 * to /api/dashboard/config (action='save_theme'), which inserts a
 * new published configuration row carrying the theme and
 * invalidates the config cache so live conversations pick up the
 * change immediately.
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

/**
 * Resolve the swatch id matching a persisted theme. Falls back to
 * `'default'` when no match is found (e.g. a previously-saved custom
 * theme that the picker doesn't ship as a preset). Comparison uses
 * the `id` field, which we persist verbatim from the swatch
 * registry, so the round-trip is exact.
 */
function swatchIdFromTheme(theme: Theme | null | undefined): string {
  if (!theme) return 'default';
  return THEMES.some((t) => t.id === theme.id) ? theme.id : 'default';
}

export interface PreviewChatProps {
  /**
   * The currently-saved theme on the firm's published configuration,
   * passed in by the page-level server component. Used to seed the
   * picker's active swatch on initial render so the lawyer sees
   * "what's currently live" rather than the indigo default. `null`
   * when the firm hasn't customised colors yet.
   */
  initialTheme?: Theme | null;
}

export function PreviewChat({ initialTheme }: PreviewChatProps = {}) {
  const [sessionKey, setSessionKey] = useState(0);
  const [activeThemeId, setActiveThemeId] = useState<string>(() =>
    swatchIdFromTheme(initialTheme),
  );
  // Track the saved theme so we know whether the picker is dirty
  // (active selection differs from what's persisted). On a fresh
  // page load these match; clicking a different swatch flips it
  // dirty until Save is pressed.
  const [savedThemeId, setSavedThemeId] = useState<string>(() =>
    swatchIdFromTheme(initialTheme),
  );
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<
    | { type: 'success'; message: string }
    | { type: 'error'; message: string }
    | null
  >(null);

  function reset() {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('lc_session_id');
    }
    setSessionKey((k) => k + 1);
  }

  const activeTheme = THEMES.find((t) => t.id === activeThemeId) ?? THEMES[0];
  const isDirty = activeThemeId !== savedThemeId;

  // Inline style applied to the wrapper around the embedded panel.
  // Setting these two CSS variables here lets them cascade into
  // every widget component (see packages/widget/src/styles/panel.css).
  // Cast through React.CSSProperties because TS doesn't know about
  // arbitrary --custom-property declarations on the style object.
  const themeStyle = {
    '--lc-primary-bg': activeTheme.primaryBg,
    '--lc-primary-color': activeTheme.primaryColor,
  } as React.CSSProperties;

  async function handleSaveTheme() {
    if (saving) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      const payload =
        activeTheme.id === 'default'
          ? null // null clears the override → revert to indigo defaults
          : {
              id: activeTheme.id,
              primary_bg: activeTheme.primaryBg,
              primary_color: activeTheme.primaryColor,
            };
      const res = await fetch('/api/dashboard/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_theme', theme: payload }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        setSaveStatus({
          type: 'error',
          message: data.error ?? 'Save failed',
        });
        return;
      }
      // Successfully saved — the picker is no longer dirty. Bump the
      // session key so the embedded ChatPanel re-fetches /api/config
      // and picks up the new theme without a full page reload.
      setSavedThemeId(activeTheme.id);
      setSaveStatus({ type: 'success', message: 'Theme saved & published' });
      reset();
    } catch (err) {
      setSaveStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Network error',
      });
    } finally {
      setSaving(false);
    }
  }

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

      {/* Theme swatches + Save action. Save is hidden until the
          picker is dirty (active selection differs from the saved
          theme) so the user only sees it when there's something to
          save. */}
      <div className="px-5 py-3 border-b border-[#E5E5E5] flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-medium text-[#6B7280]">
            Color theme
          </div>
          {saveStatus && (
            <div
              className={`text-xs font-medium ${
                saveStatus.type === 'success'
                  ? 'text-[#059669]'
                  : 'text-[#DC2626]'
              }`}
              role="status"
              aria-live="polite"
            >
              {saveStatus.message}
            </div>
          )}
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
                onClick={() => {
                  setActiveThemeId(theme.id);
                  // Clear stale "saved" status when the user picks
                  // a different swatch — the message wouldn't match
                  // the current selection any more.
                  if (saveStatus) setSaveStatus(null);
                }}
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
        {isDirty && (
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-xs text-[#6B7280]">
              Click Save to apply this color to the live widget.
            </span>
            <button
              type="button"
              onClick={handleSaveTheme}
              disabled={saving}
              className="bg-[#171717] hover:bg-[#262626] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg px-3 py-1.5 text-xs font-medium transition"
            >
              {saving ? 'Saving…' : 'Save theme'}
            </button>
          </div>
        )}
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
