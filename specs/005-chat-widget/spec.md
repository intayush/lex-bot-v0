# Feature Specification: Chat Widget

**Feature Branch**: `005-chat-widget`

**Created**: 2026-05-23

**Status**: Draft

**Input**: User description: "Extract the functional requirements for Chat Widget from 'product-spec-legal-chatbot.md'. Generate the isolated feature specification file. Do not invent new requirements; stick strictly to what is outlined in the document."

**Source of Truth**: All requirements in this document are extracted verbatim or paraphrased without addition from `product-spec-legal-chatbot.md` (v0.2, 2026-05-16). Primary sources: §6.1–§6.13 (the full Chat Widget component). Supporting sources: §2.4 (API key flow header `x-api-key`), §2.10 (stateless widget, stateful server), §6.5 quick-reply chips → `/api/config`, §11.4 (legal disclaimer), §11.5 (consent banner), §12.9 (Phase 4 deliverable + done-when). Each functional requirement cites its source section. No requirements have been invented.

## Overview

The Chat Widget is the only user-facing piece of the system (§6.1). It is a lightweight, embeddable component that renders the chat interface on the lawyer's website. It is a pure UI layer — it holds no sensitive state, calls the Chat API for everything, and consumes the streaming response from `POST /api/chat` (§2.10, §6.6).

Distribution is through two channels (§6.2): an NPM package for React/Next.js sites, and a CDN script-tag drop-in for static and non-React sites that internally bundles Preact so React is not a host dependency. Both channels render the same widget surface.

This is Phase 4 per §12.5. It depends on the Chat API (`004-chat-api-agent`) being reachable and consumes its streaming response. It does not implement business logic; it implements a polished, accessible, mobile-first chat surface around the API contract.

## User Scenarios & Testing *(mandatory)*

The "users" of the Chat Widget are:

1. **A potential client visiting a lawyer's website** — sees the chat bubble, opens it, asks a question, reads the streamed response, possibly provides contact info.
2. **A lawyer (or their developer) embedding the widget** — installs it via NPM or CDN script tag, configures branding via CSS custom properties or a `theme` prop, wires analytics callbacks.
3. **A Lex Bot engineer** — runs the widget against the local test app per §12.9 deliverable to verify rendering, streaming, and responsive behavior.

### User Story 1 — Visitor Opens the Widget and Has a Streaming Conversation (Priority: P1)

A visitor on a lawyer's website sees a floating chat bubble in the bottom-right corner of the page. Clicking the bubble expands the chat panel, which displays a welcome screen with the firm's configured greeting message and quick-start options. The visitor types a question; the widget posts it to the Chat API; the response appears token-by-token in a bot message bubble while a typing indicator is shown. The conversation continues turn-by-turn.

**Why this priority**: §12.9 names this exact flow as the deliverable: "Open `http://localhost:5173` in a browser → click chat bubble → type a question → see streamed response." §6.1 names the widget as "the only user-facing piece of the system." Without this flow, no end user can reach the chatbot at all.

**Independent Test**: Open the seeded test app at `localhost:5173`, click the chat bubble, type "Do you handle car accident cases?", and verify (a) the panel expands, (b) a typing indicator appears while waiting, (c) the response streams in token-by-token, (d) the conversation history shows both messages with appropriate styling.

**Acceptance Scenarios**:

1. **Given** the widget script has loaded on a page, **When** the page renders, **Then** a chat bubble trigger is shown with minimal DOM footprint and the chat panel is not yet rendered (§6.11 step 1–2, §6.11 closing line).
2. **Given** the chat bubble is visible, **When** the visitor clicks it, **Then** the chat panel expands and is lazy-loaded on this first interaction (§6.11 closing line, §12.9 done-when).
3. **Given** the panel has opened for the first time, **When** initialization completes, **Then** the welcome screen displays the firm's configured greeting message and quick-start options (§6.5 Welcome screen, §6.11 step 5–6).
4. **Given** the panel is open and a message has been typed, **When** the visitor sends it, **Then** an animated typing indicator (animated dots) appears while the LLM is generating a response (§6.5 Typing indicator).
5. **Given** the API begins streaming, **When** tokens arrive, **Then** they appear in the bot message bubble token-by-token, reducing perceived latency (§6.6).
6. **Given** the visitor types another message while the bot is still streaming, **When** the new message is sent, **Then** the in-flight stream is interrupted and the new turn begins (§6.6 "Streaming can be interrupted if the user sends a follow-up message").

---

### User Story 2 — Visitor Returns Mid-Session and Sees Conversation History (Priority: P1)

A visitor opens the chat, exchanges a few messages, navigates to another page on the same site, and re-opens the chat. The widget restores the prior conversation by re-fetching the session's history from the server (using the session ID stored in the same browser tab's `sessionStorage`). The visitor continues where they left off.

**Why this priority**: §6.8 mandates this behavior: "Session persists across page navigations via a session ID stored in `sessionStorage`. Returning to the site in the same tab continues the conversation." §12.9 done-when includes "Conversation persists across page navigations (same tab)." This is the difference between a useful intake assistant and a forgetful toy.

**Independent Test**: Open the test app, exchange two messages, navigate to another path on the same dev server, re-open the chat, and verify the prior messages are visible and a new message continues the conversation.

**Acceptance Scenarios**:

1. **Given** an active session in the current tab, **When** the visitor navigates to another page on the same site, **Then** the session ID stored in `sessionStorage` survives the navigation (§6.8).
2. **Given** the visitor returns to a page with the widget after navigation, **When** the widget loads, **Then** it re-fetches the conversation history from the server and displays it before accepting new input (§6.8 "Full conversation history for the session is maintained server-side; the widget re-fetches on page load").
3. **Given** the visitor closes the tab or browser, **When** they revisit the site later, **Then** a fresh conversation begins (§6.8 "Closing the tab or browser ends the session (fresh conversation on next visit)").

---

### User Story 3 — Visitor Sees Practice-Area Quick-Replies (Priority: P2)

When the chat panel opens, the welcome screen shows quick-reply chips loaded from the firm's configured practice areas (e.g., "Criminal Defense", "DUI Defense"). Tapping a chip sends a pre-filled message to the chatbot.

**Why this priority**: §6.5 mandates the quick-reply chip UI fed by the firm's configured practice areas via the `/api/config` endpoint. §12.9 done-when explicitly lists "Quick-reply chips appear based on practice areas." It is part of the canonical first-impression of the widget.

**Independent Test**: With the seeded dev configuration in place, open the chat panel and verify quick-reply chips appear matching the firm's practice areas; tap one and verify the resulting message uses the chip's text.

**Acceptance Scenarios**:

1. **Given** the firm's published configuration includes practice areas, **When** the chat panel first opens, **Then** quick-reply chips are populated from the `/api/config` endpoint matching those practice areas (§6.5 Quick-reply chips).
2. **Given** quick-reply chips are visible, **When** the visitor taps one, **Then** the chip's text is sent as a user message to the chat (§6.5).

---

### User Story 4 — Visitor on Mobile Has a Full-Screen Chat Experience (Priority: P1)

A visitor on a phone (viewport width <768px) sees the chat bubble in the bottom-right corner. Tapping it slides up a full-screen chat sheet from the bottom of the viewport. The sheet has a sticky header (showing chatbot name and close button) and a sticky input area; the message list scrolls between them.

**Why this priority**: §6.4 mandates mobile as "the primary experience" with full-screen behavior under 768px. §12.9 done-when includes "Mobile view (Chrome DevTools responsive mode) shows full-screen chat." Mobile is where most leads originate (§1.5 implies the widget must work on whatever device the prospective client uses).

**Independent Test**: Open the test app in Chrome DevTools responsive mode at 375×667 (iPhone SE), tap the chat bubble, and verify the chat occupies the full viewport with sticky header and input.

**Acceptance Scenarios**:

1. **Given** a viewport width below 768px, **When** the chat panel opens, **Then** it occupies the full screen as a sheet sliding up from the bottom (§6.4 Mobile).
2. **Given** a viewport width between 768px and 1024px, **When** the chat panel opens, **Then** it appears as a side panel anchored to the right edge approximately 380px wide (§6.4 Tablet).
3. **Given** a viewport width above 1024px, **When** the chat panel opens, **Then** it appears as a floating panel in the bottom-right corner sized 400px wide × 600px tall, expandable to a larger view (§6.4 Desktop).
4. **Given** the mobile chat is open, **When** the message list scrolls, **Then** the header and input area remain sticky (§6.4 Mobile).

---

### User Story 5 — Visitor Loses Network Connectivity Mid-Conversation (Priority: P2)

The visitor's network connection drops while a conversation is active. The widget shows a "Reconnecting..." indicator and queues outbound messages. When the network is restored, the queued messages are sent and streaming resumes.

**Why this priority**: §6.12 enumerates this and four other error/offline scenarios with specific behaviors. The widget must remain usable in real-world network conditions — a chat that breaks on flaky Wi-Fi loses leads.

**Independent Test**: With the chat open, disable the network in DevTools, attempt to send a message, then re-enable the network. Verify the "Reconnecting..." indicator appears, the queued message is sent on reconnect, and streaming resumes.

**Acceptance Scenarios**:

1. **Given** the network is temporarily lost, **When** the visitor attempts to send a message, **Then** a "Reconnecting..." indicator is shown and outbound messages are queued (§6.12 row 1).
2. **Given** the network is restored, **When** the queued messages exist, **Then** they are sent and streaming resumes (§6.12 row 2).
3. **Given** the API is unreachable for more than 10 seconds, **When** the widget detects this, **Then** it shows: "I'm having trouble connecting. Please try again in a moment or call us at [phone]." (§6.12 row 3).
4. **Given** the API returns an error response, **When** the widget receives it, **Then** it displays a generic error message with the firm's contact information as fallback (§6.12 row 4).
5. **Given** the API responds with HTTP 429 (rate limited), **When** the widget receives it, **Then** it displays: "Please wait a moment before sending another message" (§6.12 row 5).

---

### User Story 6 — Lawyer Embeds the Widget on a Static Website (Priority: P1)

A lawyer (or their developer) adds a single `<script>` tag with their API key as a data attribute to the layout of a static HTML site. After the page loads, the chat bubble appears with no further configuration. The widget self-bundles Preact internally so the host site does not need React.

**Why this priority**: §6.2 / §6.3 mandate the one-line CDN integration as the entry point for "static/non-React sites" — the largest segment of small-to-mid-size law-firm websites (§1.3). §12.9 deliverable is React-embedded, but the §6.2 contract is a sibling distribution that must work for the most-likely-to-adopt segment.

**Independent Test**: Add the CDN script tag with a valid API key to a plain HTML page, open it, and verify the chat bubble appears and a conversation works without any React runtime present.

**Acceptance Scenarios**:

1. **Given** a static HTML page with no React runtime, **When** the CDN script tag with `data-api-key` is loaded, **Then** the chat bubble renders and the widget functions identically to the React-embedded variant (§6.2 CDN, §6.3 minimal integration).
2. **Given** an NPM-installed React app, **When** `<LegalChatbot apiKey="..." />` is rendered, **Then** the widget functions correctly using the host's React (§6.2 NPM Package).

---

### User Story 7 — Lawyer Customizes Branding (Priority: P2)

A lawyer overrides the widget's CSS custom properties in their site's CSS — or passes a `theme` prop in React — to match their firm's branding (primary color, font family, border radius, bubble colors, position). The widget reflects the new branding without code changes.

**Why this priority**: §6.7 explicitly says "Lawyers can match their firm's branding by overriding these variables in their site's CSS or passing a `theme` prop." The system addresses small/mid law firms that have existing brand identities (§1.3), so themability is a real adoption blocker.

**Independent Test**: Override `--lc-primary-color` and `--lc-font-family` in the host page's CSS; reload the widget; verify message bubbles, the bubble trigger, and the typography reflect the overrides.

**Acceptance Scenarios**:

1. **Given** the host page sets `--lc-primary-color`, **When** the widget renders, **Then** primary-color elements (e.g., the user message bubble background per `--lc-bubble-user`, the bubble trigger) reflect that value (§6.7).
2. **Given** the host page sets `--lc-font-family`, **When** the widget renders, **Then** all widget text uses that font family (§6.7).
3. **Given** the host page sets `--lc-position` to `bottom-left`, **When** the widget renders, **Then** the bubble trigger and panel are anchored to the bottom-left corner (§6.7).
4. **Given** a React host passes a `theme` prop with `primaryColor` and `fontFamily`, **When** the widget renders, **Then** the same overrides are applied as if set via CSS variables (§6.3 Full configuration, §6.7).

---

### Edge Cases

- **Conversation persists across navigations but the API session has expired (>30 min inactivity per §12.8)**: §6.8 says the widget re-fetches history on page load; §12.8 says expired sessions are not resumable on the API side. The widget therefore must handle the case where the server reports the session is unknown — falling back to creating a fresh session is consistent with the §6.8 + §12.8 combination.
- **Reduced motion**: §6.9 mandates respect for `prefers-reduced-motion`. The typing indicator's animated dots and any panel slide animation must respect the user's preference.
- **High contrast**: §6.9 mandates respect for `prefers-contrast`. Color choices in the default theme must adapt accordingly.
- **Touch target size on mobile**: §6.9 mandates a minimum touch target size of 44×44px on mobile. The bubble trigger, send button, close/minimize, quick-reply chips, etc., must all meet this minimum.
- **Focus trap when chat is open**: §6.9 mandates focus trapping. Tabbing while the panel is open must cycle within the panel and not escape to the host page.
- **Escape closes the chat**: §6.9 names "Tab, Enter, Escape to close" as required keyboard interactions.
- **Quick-reply config endpoint fails**: §6.5 / §6.11 step 5 say the API "responds with greeting message and quick-reply options." If the config fetch fails, the widget should still render the greeting (a constant from configuration) and gracefully omit chips. The spec does not enumerate explicit fallback wording for this; this is captured in Assumptions.
- **Message timestamp grouping**: §6.5 names "Relative timestamps ('2 min ago') on message groups" — meaning timestamps are group-level, not per-message.
- **Streaming-mid-flight followup**: §6.6 says "Streaming can be interrupted if the user sends a follow-up message." The widget must support interruption cleanly, ending the in-flight stream and starting a new turn.

## Requirements *(mandatory)*

Each requirement cites the spec section it derives from. No requirement appears here that is not present in `product-spec-legal-chatbot.md`.

### Functional Requirements

#### FR Group A — Distribution Channels (§6.2, §6.3)

- **FR-001**: The widget MUST be distributed as an NPM package suitable for React/Next.js sites and importable as a named export `LegalChatbot` accepting an `apiKey` prop. Source: §6.2 NPM Package, §6.3.
- **FR-002**: The widget MUST also be distributed as a single CDN-hostable script that can be added to any HTML page via a `<script>` tag carrying a `data-api-key` attribute. Source: §6.2 CDN Script Tag.
- **FR-003**: The CDN script MUST internally bundle Preact so the host site is not required to provide React. Source: §6.2 ("The CDN version bundles Preact internally to avoid requiring React as a host dependency").
- **FR-004**: The CDN integration MUST function with a single line on a static page: `<script src="…/legal-chatbot.js" data-api-key="…"></script>`. Source: §6.3 minimal integration.

#### FR Group B — Integration API (React) (§6.3, §6.13)

- **FR-005**: The React component MUST accept the following props: `apiKey` (string, required), `position` (string), `theme` (object), `onLeadSubmitted`, `onChatOpen`, `onMessageSent`. Source: §6.3 full configuration example, §6.13 props example.
- **FR-006**: The React component MUST invoke `onChatOpen` when the chat panel is opened, `onMessageSent` when the user sends a message, and `onLeadSubmitted` when qualifying information has been collected. Source: §6.13 events list.

#### FR Group C — Mobile-First Responsive Layout (§6.4)

- **FR-007**: At viewport widths below 768px, the chat panel MUST present as a full-screen sheet sliding up from the bottom of the viewport, with a sticky header and sticky input area, and the chat bubble trigger sitting in the bottom-right corner. Source: §6.4 Mobile.
- **FR-008**: At viewport widths between 768px and 1024px, the chat panel MUST present as a side panel anchored to the right edge of the viewport, approximately 380px wide. Source: §6.4 Tablet.
- **FR-009**: At viewport widths above 1024px, the chat panel MUST present as a floating panel in the bottom-right corner, 400px wide × 600px tall, expandable to a larger view. Source: §6.4 Desktop.

#### FR Group D — Chat UI Components (§6.5)

- **FR-010**: The widget MUST render message bubbles with distinct styling for user (right-aligned) vs. bot (left-aligned) messages. Source: §6.5 Message bubbles.
- **FR-011**: The widget MUST display an animated-dots typing indicator while the LLM is generating a response. Source: §6.5 Typing indicator.
- **FR-012**: The widget MUST display relative timestamps (e.g., "2 min ago") on message groups, not per-message. Source: §6.5 Timestamps.
- **FR-013**: The widget MUST display quick-reply chips populated from the firm's configured practice areas, fetched via the `/api/config` endpoint. Source: §6.5 Quick-reply chips.
- **FR-014**: The widget MUST display a chat header containing the chatbot name, online status, and minimize and close buttons. Source: §6.5 Chat header.
- **FR-015**: The widget MUST provide a text input area with a send button; the input MUST auto-grow vertically for multi-line messages. Source: §6.5 Input area.
- **FR-016**: The widget MUST display a welcome screen showing the firm's configured greeting message and quick-start options before the first user message is sent. Source: §6.5 Welcome screen.

#### FR Group E — Streaming Responses (§6.6, §2.4)

- **FR-017**: The widget MUST consume the streaming response from the Chat API via the Vercel AI SDK `useChat` hook (the SDK protocol is the interface the API exposes per §12.8). Source: §6.6.
- **FR-018**: The widget MUST send the API key in the `x-api-key` request header on every request to the Chat API. Source: §6.6 (`headers: { 'x-api-key': apiKey }`) and §2.4 step 3.
- **FR-019**: The widget MUST render the response token-by-token as it streams. Source: §6.6.
- **FR-020**: The widget MUST allow streaming to be interrupted when the user sends a follow-up message before the current response completes. Source: §6.6.

#### FR Group F — Theming & Customization (§6.3, §6.7)

- **FR-021**: The widget MUST be themable via CSS custom properties without code changes. The supported variables MUST include: `--lc-primary-color`, `--lc-primary-text`, `--lc-background`, `--lc-font-family`, `--lc-border-radius`, `--lc-bubble-user`, `--lc-bubble-bot`, `--lc-position` (with allowed values `bottom-right` and `bottom-left`). Source: §6.7.
- **FR-022**: The React component MUST accept a `theme` prop whose values are applied equivalently to overriding the corresponding CSS custom properties. Source: §6.3 (`theme={{ primaryColor: ..., fontFamily: ... }}`), §6.7.

#### FR Group G — Conversation State & Persistence (§6.8, §2.10)

- **FR-023**: The widget MUST persist its session ID in `sessionStorage` so that navigations within the same browser tab continue the conversation. Source: §6.8.
- **FR-024**: On page load, if a session ID exists in `sessionStorage`, the widget MUST re-fetch the conversation history from the server and display it before accepting new input. Source: §6.8.
- **FR-025**: Closing the tab or browser MUST end the session (the next visit starts fresh). Source: §6.8.
- **FR-026**: The widget MUST NOT hold any sensitive state beyond what is currently visible in the conversation; all session state, conversation history, and lead data live server-side. Source: §2.10, §6.1.

#### FR Group H — Accessibility (WCAG 2.1 AA) (§6.9)

- **FR-027**: The widget MUST support full keyboard navigation: Tab to traverse interactive elements, Enter to send a message, Escape to close the chat panel. Source: §6.9.
- **FR-028**: All interactive elements MUST have ARIA labels. Source: §6.9.
- **FR-029**: The widget MUST announce new messages to screen readers. Source: §6.9.
- **FR-030**: When the chat panel is open, focus MUST be trapped within the panel. Source: §6.9.
- **FR-031**: The widget MUST respect `prefers-contrast` for high-contrast mode support. Source: §6.9.
- **FR-032**: The widget MUST respect `prefers-reduced-motion` for reduced-motion support. Source: §6.9.
- **FR-033**: All touch targets on mobile MUST be at least 44×44px. Source: §6.9.

#### FR Group I — Bundle Size & Asset Strategy (§6.10)

- **FR-034**: The NPM package (which expects React as a peer dependency) MUST be under 35KB gzipped. Source: §6.10.
- **FR-035**: The CDN standalone bundle (which includes Preact) MUST be under 50KB gzipped. Source: §6.10.
- **FR-036**: The widget MUST NOT ship external CSS files; styles MUST be scoped and bundled inline (using shadow DOM or CSS modules). Source: §6.10.
- **FR-037**: The widget MUST be tree-shakeable so that unused components are eliminated in bundled builds. Source: §6.10.

#### FR Group J — Initialization Flow (§6.11)

- **FR-038**: On script load, the widget MUST render only the chat bubble trigger with minimal DOM footprint; the chat panel MUST NOT yet be rendered. Source: §6.11 step 1–2.
- **FR-039**: When the user clicks the bubble for the first time, the chat panel MUST expand and the panel content MUST be lazy-loaded on this first interaction so that page load is not affected. Source: §6.11 step 3, §6.11 closing line.
- **FR-040**: After expansion, the widget MUST send an initialization request to the API including the session ID (if any) and API key. Source: §6.11 step 4.
- **FR-041**: When the API responds with the greeting message and quick-reply options, the widget MUST display the greeting and wait for user input. Source: §6.11 step 5–6.

#### FR Group K — Offline & Error Handling (§6.12)

- **FR-042**: When the network is temporarily lost, the widget MUST show a "Reconnecting..." indicator and queue outbound messages. Source: §6.12 row 1.
- **FR-043**: When the network is restored, the widget MUST send queued messages and resume streaming. Source: §6.12 row 2.
- **FR-044**: When the API has been unreachable for more than 10 seconds, the widget MUST display: "I'm having trouble connecting. Please try again in a moment or call us at [phone]." with the firm's configured phone substituted. Source: §6.12 row 3.
- **FR-045**: When the API returns an error response, the widget MUST display a generic error message that includes the firm's contact info as fallback. Source: §6.12 row 4.
- **FR-046**: When the API returns rate-limited (HTTP 429), the widget MUST display: "Please wait a moment before sending another message". Source: §6.12 row 5.

#### FR Group L — Analytics Hooks (§6.13)

- **FR-047**: The React variant MUST emit analytics events via prop callbacks: `onChatOpen`, `onMessageSent`, `onLeadSubmitted`. Source: §6.13 React props.
- **FR-048**: The CDN variant MUST dispatch DOM events on `document` named `legalchatbot:open`, `legalchatbot:message`, and `legalchatbot:lead`. Source: §6.13 CDN DOM events.
- **FR-049**: The widget MUST emit the following events at the appropriate points: `chat_opened` (panel opens), `message_sent` (user sends a message), `lead_submitted` (qualifying information has been collected), `escalation_triggered` (chat escalated to human contact), `chat_closed` (panel closes). Source: §6.13 events list.

#### FR Group M — Compliance & Disclaimer Surface (§11.4, §11.5)

- **FR-050**: The widget MUST display a clear, persistent disclaimer: "I am an AI assistant, not a lawyer. Nothing I say constitutes legal advice." Source: §11.4.
- **FR-051**: Before the widget collects any personal data (name, email, phone), it MUST display a consent banner. Source: §11.5.
- **FR-052**: A privacy policy link MUST be linkable from the widget so lawyers can connect their privacy policy to it. Source: §11.5 ("Draft a privacy policy template that lawyers can customize and link from the widget").

### Key Entities

The Chat Widget is a UI component; it does not own persistent server-side entities. It interacts with these client-side and ephemeral surfaces:

- **Session ID (client-side)**: Stored in `sessionStorage`; persists across same-tab navigations; cleared when the tab/browser closes. The widget sends it to the Chat API in the `x-session-id` header (per the Chat API contract). Source: §6.8.
- **Configuration data (read from `/api/config`)**: Greeting message, quick-reply options derived from the firm's published practice areas. Used by the Welcome screen and the quick-reply chips. Source: §6.5, §6.11.
- **Conversation messages (rendered)**: User and bot messages; held in memory during the session; the authoritative copy lives server-side. Source: §6.8, §2.10.
- **Theme tokens (CSS custom properties)**: `--lc-primary-color`, `--lc-primary-text`, `--lc-background`, `--lc-font-family`, `--lc-border-radius`, `--lc-bubble-user`, `--lc-bubble-bot`, `--lc-position`. Source: §6.7.
- **Analytics events (emitted)**: `chat_opened`, `message_sent`, `lead_submitted`, `escalation_triggered`, `chat_closed`. Source: §6.13.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After running `pnpm dev`, opening the test app at `localhost:5173`, clicking the chat bubble, typing a question, and sending — the visitor sees a streamed response. Source: §12.9 deliverable.
- **SC-002**: The widget renders as a floating bubble on the test app on first page load. Source: §12.9 done-when.
- **SC-003**: Clicking the bubble opens the chat panel. Source: §12.9 done-when.
- **SC-004**: Typing a question and sending shows the streaming response. Source: §12.9 done-when.
- **SC-005**: A conversation persists across page navigations within the same tab. Source: §12.9 done-when, §6.8.
- **SC-006**: At a viewport width below 768px, the chat panel renders as full-screen. Source: §12.9 done-when, §6.4.
- **SC-007**: At a viewport width above 1024px, the chat panel renders as a floating corner panel. Source: §12.9 done-when, §6.4.
- **SC-008**: Quick-reply chips appear matching the firm's configured practice areas. Source: §12.9 done-when, §6.5.
- **SC-009**: The NPM package built bundle measures less than or equal to 35KB gzipped. Source: §6.10.
- **SC-010**: The CDN standalone built bundle measures less than or equal to 50KB gzipped. Source: §6.10.
- **SC-011**: 100% of interactive elements in the widget have ARIA labels. Source: §6.9.
- **SC-012**: Tab, Enter, and Escape keys all produce the documented behavior in 100% of test runs. Source: §6.9.
- **SC-013**: With `prefers-reduced-motion` set, the typing indicator and panel animations are reduced or removed. Source: §6.9.
- **SC-014**: With `prefers-contrast: more` set, the widget's color choices adapt accordingly. Source: §6.9.
- **SC-015**: Every touch target on the mobile layout measures at least 44×44 CSS pixels. Source: §6.9.
- **SC-016**: When the network is offline, the widget shows "Reconnecting..." and queues messages; when it returns, queued messages are sent. Source: §6.12.
- **SC-017**: When the API is unreachable for more than 10 seconds, the widget displays the §6.12 connectivity message with the firm's configured phone number substituted. Source: §6.12.
- **SC-018**: The widget never reads or writes any browser storage other than `sessionStorage` for the session ID and the `prefers-*` user preferences exposed by the OS / browser. Source: §6.8 + §2.10 + (no other storage mentioned in the spec).
- **SC-019**: The widget's persistent disclaimer "I am an AI assistant, not a lawyer. Nothing I say constitutes legal advice." is visible whenever the chat panel is open. Source: §11.4.
- **SC-020**: A consent banner is displayed before any personal data (name/email/phone) is collected. Source: §11.5.

## Assumptions

These are reasonable defaults adopted where the spec does not explicitly prescribe a detail. Each is consistent with — and never contradicts — the spec.

- **Quick-reply config endpoint failure**: §6.5 / §6.11 say config is fetched. The spec does not enumerate fallback wording when the config fetch fails. The default is to render the welcome screen with whatever default greeting is available and to gracefully omit chips; the conversation remains usable.
- **Storage of consent timestamp**: §11.5 says "Store a consent timestamp and method per session in the database." The widget sends consent acknowledgment to the API; the database write is the API's responsibility (Phase 5/Foundation database layer). The widget's responsibility is the banner UI and submitting consent.
- **Default theme palette**: §6.7 enumerates which CSS custom properties exist but does not prescribe default values. Any neutral, accessible default palette is acceptable as long as it satisfies the WCAG 2.1 AA contrast requirements implied by §6.9.
- **Default greeting text**: §6.5 Welcome screen and §6.11 step 5–6 say the greeting comes from the firm's configuration. When no firm configuration is available (e.g., before the first config fetch), a neutral generic greeting is acceptable as a transient fallback.
- **Position prop / `bottom-left` enum**: §6.3 props show `position="bottom-right"`. §6.7 names `--lc-position` allowed values as `bottom-right` and `bottom-left`. The React `position` prop is therefore restricted to these two values.
- **Re-fetch-on-load implementation**: §6.8 says the widget re-fetches conversation history on page load. The spec does not enumerate the endpoint shape; this is a Chat API responsibility and the widget consumes whatever shape the API provides.
- **Iframe vs. shadow DOM scoping**: §6.10 says styles MUST be scoped (shadow DOM or CSS modules) and there MUST be no external CSS file. Either mechanism is acceptable.
- **Streaming-interruption mechanism**: §6.6 says streaming "can be interrupted." The spec does not enumerate the exact UX (immediate stop, soft cancel, etc.). Any clean interruption that ends the in-flight stream and accepts the new turn is acceptable.

## Out of Scope (for this feature)

The following are explicitly **not** part of the Chat Widget feature.

- The Chat API endpoint itself, system prompt composition, agent runtime, tool wiring, rate limiting, prompt-injection sanitation, token logging — owned by feature `004-chat-api-agent` (§12.8).
- The `/api/config` endpoint that supplies the welcome greeting and quick-reply options — owned by the API package (§6.5 source).
- Lead capture, classification, partial-lead heuristic, urgent-lead notification — owned by feature `005-lead-classification` (§7.4, §12.10). The widget only emits an `lead_submitted` analytics event when this happens server-side.
- Dashboard UI for managing API keys, configuration, and viewing leads — owned by Phase 6 / dashboard features (§8).
- Live agent handoff / WebSocket-based human takeover — explicitly post-MVP per §10.
- Visual theme builder in the dashboard — explicitly post-MVP per §10. Theming is via CSS custom properties only for MVP (§6.7).
- A/B testing of widget configurations — explicitly post-MVP per §10.
- Multi-language auto-detection / real-time translation — explicitly post-MVP per §10.
- Webhook / email / SMS notification channels for lead events — explicitly post-MVP per §10.
- The persistence of consent timestamps in the database — owned by the API/database layer; the widget submits, the API persists.

## Dependencies

- **External (runtime)**: Reachable Chat API at the URL the widget is built/configured to call. (CDN host for the standalone bundle, where applicable.)
- **Internal — Upstream**: Chat API + Agent (`004-chat-api-agent`) for the streaming protocol the widget consumes; an `/api/config` endpoint that supplies greeting + quick-reply options (per §6.5, §6.11).
- **Internal — Downstream**: The Lawyer Configuration Form (Phase 6 / §4) populates the firm's persona, greeting, practice areas, contact info, and disclaimer, all of which the widget surfaces. The dashboard's API-key management surface (§8.8) is the upstream of the API key the lawyer pastes into the embed.

## Notes on Non-Invention

This specification deliberately omits any requirement not present in `product-spec-legal-chatbot.md`. In particular:

- No specific React, Preact, or build-tooling version is mandated; §6.2 names the libraries only at the distribution-channel level.
- No specific CDN provider is mandated; §6.2 shows `cdn.legalchatbot.com` as an illustrative URL.
- No specific analytics provider is required; §6.13 shows `gtag` only as an example of how a host page might wire the events.
- No specific consent-banner copy is mandated; §11.5 mandates that a consent banner exists before personal-data collection.
- No specific privacy-policy text is mandated; §11.5 says lawyers customize and link a privacy policy from the widget.
- No specific keyboard shortcuts beyond Tab, Enter, and Escape are mandated by §6.9.
- No specific notification or alert when the visitor minimizes the chat is mandated; §6.5 mentions a minimize button only.
- No specific behavior for very long messages, file uploads, or attachments is mandated — the spec describes only text input.
- No specific behavior for opening multiple widget instances on a single page is mandated.
- No specific browser support matrix is mandated beyond the modern features the spec implies (CSS custom properties, Vercel AI SDK streaming, `sessionStorage`, `prefers-*` media queries).

If any of these are wanted, they belong in a separate feature, not in Chat Widget.
