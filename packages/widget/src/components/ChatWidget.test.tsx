/**
 * Spec 017 hotfix — ChatWidget close-button regression.
 *
 * Clicking the X button on tablet / desktop must:
 *   1. Trigger the close path through the SAME handler that Escape /
 *      mobile-scrim use (onCloseRequest) — not just ChatPanel's local
 *      isOpen state.
 *   2. Result in the panel being unmounted from the DOM.
 *   3. NOT trigger an immediate re-mount via ChatWidget's auto-mount
 *      effect (which would happen if ChatWidget's `isOpen` boolean
 *      stays true while ChatPanel's local `isOpen` flips false —
 *      `if (isOpen && !isMounted) setIsMounted(true)` then re-mounts).
 *
 * Pre-fix, the X button was wired to a local `handleClose` that only
 * called ChatPanel's `setIsOpen(false)`. The parent ChatWidget's
 * `isOpen` stayed true → auto-mount effect fired → ChatPanel
 * re-mounted immediately. Visible symptom: header momentarily flipped
 * to the default name then back to the configured one.
 */

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @ai-sdk/react so ChatPanel doesn't try real network calls.
const chatState = {
  messages: [] as Array<{ id: string; role: 'user' | 'assistant'; content: string }>,
  isLoading: false,
  input: '',
  handleInputChange: () => {},
  handleSubmit: (e: React.FormEvent) => e.preventDefault(),
  error: null as Error | null,
  append: () => {},
};
vi.mock('@ai-sdk/react', () => ({ useChat: () => chatState }));

// SOP / preflight / motion mocks — minimal stubs.
vi.mock('../hooks/useSOPState', () => ({
  useSOPState: () => ({ sopState: null, onResponse: () => {} }),
}));
vi.mock('../hooks/usePreflightPhrase', () => ({
  usePreflightPhrase: () => ({ phrase: null, start: () => {}, clear: () => {} }),
}));
vi.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));

// usePanelLayout mocked to 'desktop' so we exercise the breakpoint
// where the bug actually manifested. (On 'mobile' the close path
// flowed through animationend and worked even with the duplicated
// state because the slide-down animation forced an unmount.)
vi.mock('../hooks/usePanelLayout', () => ({
  usePanelLayout: () => 'desktop',
}));

import { ChatWidget } from './ChatWidget';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          chatbot_name: 'Alex',
          greeting_message: 'Hi',
          practice_areas: [],
          phone: '(555) 000-0000',
          sop: null,
          case_types: [],
        }),
      headers: new Headers(),
    } as Response),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ChatWidget — close-button regression (hotfix)', () => {
  // Helper: find the close-button INSIDE the panel header (not the
  // bubble, which also has aria-label="Close chat" while the panel is
  // open).
  function getHeaderCloseButton() {
    const dialog = screen.getByRole('dialog');
    return dialog.querySelector('button[aria-label="Close chat"]') as HTMLButtonElement;
  }

  it('clicking the X button on desktop unmounts the panel and does NOT re-mount it', async () => {
    render(<ChatWidget apiKey="test" apiUrl="http://localhost/api/chat" />);

    // Open the panel via the bubble.
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();

    // Click the X button INSIDE the panel header.
    const closeBtn = getHeaderCloseButton();
    expect(closeBtn).not.toBeNull();
    act(() => {
      fireEvent.click(closeBtn);
    });

    // The panel must be gone from the DOM.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    // Wait one more tick to give any auto-mount effect a chance to fire.
    await act(async () => {
      await Promise.resolve();
    });

    // The panel MUST still be gone — i.e., the close was honored, not
    // immediately undone by an auto-mount effect.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('after closing, the bubble label is back to "Open chat" (parent state in sync)', async () => {
    render(<ChatWidget apiKey="test" apiUrl="http://localhost/api/chat" />);

    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    await screen.findByRole('dialog');

    // Click the X inside the panel header.
    fireEvent.click(getHeaderCloseButton());

    // After close, the bubble label must be back to "Open chat" — proves
    // ChatWidget's `isOpen` state actually flipped (the bug had it stuck
    // at true, so the bubble would have stayed at "Close chat" and the
    // panel would have re-mounted via the auto-mount effect).
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Open chat' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clicking X then re-opening yields a fresh panel (not stuck mid-close)', async () => {
    render(<ChatWidget apiKey="test" apiUrl="http://localhost/api/chat" />);

    // Open, close, reopen.
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    await screen.findByRole('dialog');
    fireEvent.click(getHeaderCloseButton());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    const dialog2 = await screen.findByRole('dialog');
    expect(dialog2).toBeInTheDocument();
  });
});
