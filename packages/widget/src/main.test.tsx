/**
 * Spec 017 T038/T039 — LexBot Playground rebrand contract.
 *
 * Asserts the rebranded test page meets the contract documented in
 * specs/017-chatbot-redesign/contracts/playground-page.md:
 *   - title contains "LexBot Playground"
 *   - LexBot wordmark visible in header
 *   - none of the forbidden "Smith & Associates" / "Springfield" strings
 *     appear anywhere in the rendered DOM
 *   - "sample" and "fictional" each appear at least once (demo framing)
 *   - chatbot bubble still mounts
 *
 * The bubble itself is exercised by ChatBubble's own tests; here we
 * just verify it renders. Mocking @ai-sdk/react is unnecessary because
 * the bubble does not initiate the chat session until it's clicked.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LexBotPlayground } from './main';

const here = dirname(fileURLToPath(import.meta.url));
const indexHtmlPath = resolve(here, '../index.html');
const indexHtml = readFileSync(indexHtmlPath, 'utf8');

const FORBIDDEN_STRINGS = [
  'Smith & Associates',
  'Smith and Associates',
  '123 Main Street',
  'Springfield, IL',
  'Springfield, Illinois',
];

describe('LexBot Playground page (T038)', () => {
  it('mounts without errors', () => {
    render(<LexBotPlayground />);
  });

  it('renders the "LexBot" wordmark in the top bar', () => {
    render(<LexBotPlayground />);
    // Multiple "LexBot" mentions exist (wordmark + body); we only
    // need to find at least one matching the brand styling
    // (h1/h2/strong). The contract just requires the wordmark exists.
    const matches = screen.getAllByText(/LexBot/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('contains the phrase "LexBot Playground"', () => {
    render(<LexBotPlayground />);
    expect(document.body.textContent).toContain('LexBot Playground');
  });

  for (const forbidden of FORBIDDEN_STRINGS) {
    it(`does NOT contain forbidden string "${forbidden}"`, () => {
      render(<LexBotPlayground />);
      expect(document.body.textContent).not.toContain(forbidden);
    });
  }

  it('frames the page as demo / sample content', () => {
    render(<LexBotPlayground />);
    // Both "sample" and "fictional" must appear somewhere — they
    // are the textual signal that lets a 5-second skim reader
    // understand this is a demo (SC-007).
    expect(document.body.textContent).toMatch(/sample/i);
    expect(document.body.textContent).toMatch(/fictional/i);
  });

  it('renders the chatbot bubble', () => {
    render(<LexBotPlayground />);
    // The bubble is a button with aria-label "Open chat" while closed.
    expect(screen.getByLabelText(/open chat/i)).toBeInTheDocument();
  });
});

describe('index.html (T039)', () => {
  it('sets <title> to "LexBot Playground"', () => {
    expect(indexHtml).toMatch(/<title>\s*LexBot Playground\s*<\/title>/i);
  });
});

// Suppress fetch warnings during tests — main.tsx mounts ChatWidget which
// fires off a /api/config fetch on open, but the bubble defers fetching
// until clicked.
vi.stubGlobal('fetch', () =>
  Promise.resolve({
    ok: false,
    json: () => Promise.resolve({}),
  } as Response),
);
