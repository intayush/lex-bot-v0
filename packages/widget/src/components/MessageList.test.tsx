/**
 * Spec 017 T023 — MessageList rendering contract.
 * See specs/017-chatbot-redesign/data-model.md § "Message Card Variants".
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MessageList } from './MessageList';

interface TestMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

describe('MessageList', () => {
  it('renders messages in document order', () => {
    const msgs: TestMessage[] = [
      { id: '1', role: 'user', content: 'first' },
      { id: '2', role: 'assistant', content: 'second' },
      { id: '3', role: 'user', content: 'third' },
    ];
    const { container } = render(
      <MessageList messages={msgs} preflightPhrase={null} isStreaming={false} />,
    );
    const cards = container.querySelectorAll('.lc-message');
    expect(Array.from(cards).map((c) => c.textContent)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('marks assistant messages with data-variant="assistant"', () => {
    const msgs: TestMessage[] = [{ id: '1', role: 'assistant', content: 'hi' }];
    render(<MessageList messages={msgs} preflightPhrase={null} isStreaming={false} />);
    const card = screen.getByText('hi');
    expect(card.getAttribute('data-variant')).toBe('assistant');
  });

  it('marks user messages with data-variant="user"', () => {
    const msgs: TestMessage[] = [{ id: '1', role: 'user', content: 'hi' }];
    render(<MessageList messages={msgs} preflightPhrase={null} isStreaming={false} />);
    const card = screen.getByText('hi');
    expect(card.getAttribute('data-variant')).toBe('user');
  });

  it('renders the typing indicator as an assistant-variant card while streaming', () => {
    render(
      <MessageList
        messages={[{ id: '1', role: 'user', content: 'hello' }]}
        preflightPhrase={null}
        isStreaming
      />,
    );
    // The typing indicator has role="status" for live-region a11y.
    const indicator = screen.getByRole('status');
    expect(indicator.getAttribute('data-variant')).toBe('assistant');
  });

  it('shows the preflight phrase in the typing indicator when provided', () => {
    render(
      <MessageList
        messages={[{ id: '1', role: 'user', content: 'hi' }]}
        preflightPhrase="Looking into your matter"
        isStreaming
      />,
    );
    const indicator = screen.getByRole('status');
    expect(indicator.textContent).toContain('Looking into your matter');
  });
});
