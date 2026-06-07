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
 */
export function PreviewChat() {
  const [sessionKey, setSessionKey] = useState(0);

  function reset() {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('lc_session_id');
    }
    setSessionKey((k) => k + 1);
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

      {/* The embedded ChatPanel fills the remaining height. The `key`
          forces a fresh mount on reset (new useChat instance, cleared
          messages, new session id from /api/chat's first response). */}
      <div className="flex-1 min-h-0">
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
