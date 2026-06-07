/**
 * Spec 017 T045–T047 — ChatPanel regression tests.
 *
 * These tests guard the integration between ChatPanel (orchestrator)
 * and the redesigned visual layer (PanelShell + MessageList + Composer).
 * They verify that all pre-spec-017 behaviors continue to flow through
 * the redesigned shell:
 *
 *   T045 — streaming user + assistant messages render in the new
 *          MessageList; the user's send-form path still calls useChat.
 *   T046 — when the SOP pending step is a contact_form step, the
 *          ContactForm is rendered (and not the input row alone).
 *   T047 — when the SOP pending step has chips, those chips appear and
 *          clicking a chip submits the chip's text as a user message.
 *
 * AI SDK's `useChat` is replaced by a controllable test double via
 * vi.mock so tests can drive `messages` / `isLoading` / `append` /
 * `handleSubmit` deterministically.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock useChat with a controllable double. The double exposes its
// internals via a module-scoped `chatState` object so tests can mutate
// it between renders.
const chatState: {
  messages: Array<{ id: string; role: 'user' | 'assistant'; content: string }>;
  isLoading: boolean;
  input: string;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSubmit: (e: React.FormEvent) => void;
  error: Error | null;
  append: (msg: { role: 'user' | 'assistant'; content: string }) => void;
} = {
  messages: [],
  isLoading: false,
  input: '',
  handleInputChange: () => {},
  handleSubmit: () => {},
  error: null,
  append: () => {},
};

vi.mock('@ai-sdk/react', () => ({
  useChat: () => chatState,
}));

// useSOPState mock: drives the SOP-step branches in ChatPanel.
type SOPState = {
  current: number;
  total: number;
  pending_step_slug: string | null;
  captured_case_type_slug: string | null;
  is_finalized: boolean;
  branch_active_chips: null;
};
const sopMockState: { current: SOPState | null } = { current: null };

vi.mock('../hooks/useSOPState', () => ({
  useSOPState: () => ({
    sopState: sopMockState.current,
    onResponse: () => {},
  }),
}));

// usePreflightPhrase mock — return a no-op so ChatPanel doesn't try to
// classify messages.
vi.mock('../hooks/usePreflightPhrase', () => ({
  usePreflightPhrase: () => ({
    phrase: null,
    start: () => {},
    clear: () => {},
  }),
}));

// useReducedMotion mock — false by default so animations work.
vi.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

// /api/config fetch — return a config with no SOP / case_types so
// ChatPanel's defaults engage.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          chatbot_name: 'LexBot',
          greeting_message: 'Hello, how can I help?',
          practice_areas: [],
          phone: '(555) 000-0000',
          sop: null,
          case_types: [],
        }),
      headers: new Headers(),
    } as Response),
  );

  // Reset chat state.
  chatState.messages = [];
  chatState.isLoading = false;
  chatState.input = '';
  chatState.error = null;
  chatState.append = vi.fn();
  chatState.handleSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
  chatState.handleInputChange = vi.fn();

  sopMockState.current = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ChatPanel — streaming regression (T045)', () => {
  it('renders user + assistant messages in the redesigned MessageList', async () => {
    chatState.messages = [
      { id: '1', role: 'user', content: 'I was in a car accident' },
      { id: '2', role: 'assistant', content: "I'm sorry to hear that." },
    ];

    const { ChatPanel } = await import('./ChatPanel');
    render(
      <ChatPanel
        apiKey="test"
        apiUrl="http://localhost/api/chat"
        onCloseRequest={() => {}}
        onClosed={() => {}}
      />,
    );

    expect(screen.getByText('I was in a car accident')).toBeInTheDocument();
    expect(screen.getByText("I'm sorry to hear that.")).toBeInTheDocument();
  });

  it('the user message has data-variant="user" and assistant has data-variant="assistant"', async () => {
    chatState.messages = [
      { id: '1', role: 'user', content: 'hello' },
      { id: '2', role: 'assistant', content: 'hi back' },
    ];

    const { ChatPanel } = await import('./ChatPanel');
    render(
      <ChatPanel
        apiKey="test"
        apiUrl="http://localhost/api/chat"
        onCloseRequest={() => {}}
        onClosed={() => {}}
      />,
    );

    expect(screen.getByText('hello').getAttribute('data-variant')).toBe('user');
    expect(screen.getByText('hi back').getAttribute('data-variant')).toBe(
      'assistant',
    );
  });

  it('submitting the input form calls useChat handleSubmit', async () => {
    chatState.input = 'help me';

    const { ChatPanel } = await import('./ChatPanel');
    render(
      <ChatPanel
        apiKey="test"
        apiUrl="http://localhost/api/chat"
        onCloseRequest={() => {}}
        onClosed={() => {}}
      />,
    );

    const form = screen.getByPlaceholderText(/type your message/i).closest('form');
    act(() => {
      fireEvent.submit(form!);
    });
    expect(chatState.handleSubmit).toHaveBeenCalled();
  });
});

describe('ChatPanel — persistent disclaimer (T051)', () => {
  it('renders the AI assistant disclaimer regardless of SOP state', async () => {
    const { ChatPanel } = await import('./ChatPanel');
    render(
      <ChatPanel
        apiKey="test"
        apiUrl="http://localhost/api/chat"
        onCloseRequest={() => {}}
        onClosed={() => {}}
      />,
    );

    expect(
      screen.getByText(/AI assistant.*not a lawyer.*legal advice/i),
    ).toBeInTheDocument();
  });
});

describe('ChatPanel — contact-form path (T046)', () => {
  it('renders the ContactForm trailing slot when SOP step is contact_form', async () => {
    // Inject a config with an SOP whose pending step is a contact form.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            chatbot_name: 'LexBot',
            greeting_message: 'Hi',
            practice_areas: [],
            phone: '(555) 000-0000',
            sop: {
              steps: [
                {
                  slug: 'contact',
                  chip_source: 'contact_form',
                  question: 'Contact info',
                },
              ],
            },
            case_types: [],
          }),
        headers: new Headers(),
      } as Response),
    );

    sopMockState.current = {
      current: 5,
      total: 6,
      pending_step_slug: 'contact',
      captured_case_type_slug: null,
      is_finalized: false,
      branch_active_chips: null,
    };

    chatState.messages = [
      { id: 'a1', role: 'assistant', content: 'Could you share your contact info?' },
    ];

    const { ChatPanel } = await import('./ChatPanel');
    render(
      <ChatPanel
        apiKey="test"
        apiUrl="http://localhost/api/chat"
        onCloseRequest={() => {}}
        onClosed={() => {}}
      />,
    );

    // Wait one tick for the async /api/config fetch + setState to settle.
    await act(async () => {
      await Promise.resolve();
    });

    // The ContactForm has an Email field (label "Email").
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/phone/i)).toBeInTheDocument();
  });
});

describe('ChatPanel — embedded mode + extraHeaders (dashboard preview parity)', () => {
  // The dashboard's Preview Chat sidebar mounts ChatPanel directly
  // inside a layout slot (no bubble, no overlay). It needs:
  //   1. mode="embedded" to render inline (no fixed positioning)
  //   2. extraHeaders to inject `x-preview: true` into both the
  //      /api/config fetch AND the /api/chat useChat call so the
  //      server returns the latest (unpublished) SOP for preview.
  //
  // These tests cover the prop wiring in ChatPanel; the embedded
  // visual contract is covered by PanelShell.test.tsx.

  it('renders the panel with role="region" when mode="embedded"', async () => {
    const { ChatPanel } = await import('./ChatPanel');
    render(
      <ChatPanel
        apiKey="test"
        apiUrl="http://localhost/api/chat"
        mode="embedded"
        onCloseRequest={() => {}}
        onClosed={() => {}}
      />,
    );
    expect(screen.getByRole('region')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('forwards extraHeaders to the /api/config fetch', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          chatbot_name: 'LexBot',
          greeting_message: 'Hi',
          practice_areas: [],
          phone: '(555) 000-0000',
          sop: null,
          case_types: [],
        }),
      headers: new Headers(),
    } as Response);
    vi.stubGlobal('fetch', fetchSpy);

    const { ChatPanel } = await import('./ChatPanel');
    render(
      <ChatPanel
        apiKey="test"
        apiUrl="http://localhost/api/chat"
        extraHeaders={{ 'x-preview': 'true' }}
        onCloseRequest={() => {}}
        onClosed={() => {}}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    // The /api/config call must include x-preview alongside x-api-key.
    const configCall = fetchSpy.mock.calls.find((c) =>
      String(c[0]).includes('/api/config'),
    );
    expect(configCall, 'expected /api/config to be fetched').toBeTruthy();
    const init = configCall![1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-preview']).toBe('true');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('test');
  });

  it('mode prop defaults to "floating" (back-compat for production widget)', async () => {
    const { ChatPanel } = await import('./ChatPanel');
    render(
      <ChatPanel
        apiKey="test"
        apiUrl="http://localhost/api/chat"
        onCloseRequest={() => {}}
        onClosed={() => {}}
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

