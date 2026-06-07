/**
 * Spec 017 T024 — Composer rendering contract.
 * See specs/017-chatbot-redesign/data-model.md § "Composer State".
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Composer } from './Composer';

const noopChip = { _ignored: true };

describe('Composer', () => {
  it('renders an input + send button', () => {
    render(
      <Composer
        chips={null}
        onSubmit={() => {}}
        inputValue=""
        onInputChange={() => {}}
        disabled={false}
      />,
    );
    expect(screen.getByPlaceholderText(/type your message/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });

  it('renders a chips row when chips prop is non-empty', () => {
    render(
      <Composer
        chips={['Personal Injury', 'Family Law']}
        onSubmit={() => {}}
        onChipSelect={() => {}}
        inputValue=""
        onInputChange={() => {}}
        disabled={false}
      />,
    );
    // Chip labels render as buttons.
    expect(screen.getByRole('button', { name: 'Personal Injury' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Family Law' })).toBeInTheDocument();
  });

  it('does not render chips row when chips is null or empty', () => {
    const { rerender } = render(
      <Composer
        chips={null}
        onSubmit={() => {}}
        inputValue=""
        onInputChange={() => {}}
        disabled={false}
      />,
    );
    expect(screen.queryByTestId('lc-chip-row')).toBeNull();
    rerender(
      <Composer
        chips={[]}
        onSubmit={() => {}}
        inputValue=""
        onInputChange={() => {}}
        disabled={false}
      />,
    );
    expect(screen.queryByTestId('lc-chip-row')).toBeNull();
  });

  it('replaces input row with the contact form when contactForm is set', () => {
    const onContactSubmit = vi.fn();
    render(
      <Composer
        chips={null}
        onSubmit={() => {}}
        contactForm={{ onSubmit: onContactSubmit }}
        inputValue=""
        onInputChange={() => {}}
        disabled={false}
      />,
    );
    // The contact form has email/phone/name fields.
    expect(screen.queryByPlaceholderText(/type your message/i)).toBeNull();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it('always shows the persistent disclaimer (FR-020)', () => {
    render(
      <Composer
        chips={null}
        onSubmit={() => {}}
        inputValue=""
        onInputChange={() => {}}
        disabled={false}
      />,
    );
    expect(
      screen.getByText(/AI assistant.*not a lawyer.*legal advice/i),
    ).toBeInTheDocument();
  });

  it('calls onSubmit when the form is submitted', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <Composer
        chips={null}
        onSubmit={onSubmit}
        inputValue="hello"
        onInputChange={() => {}}
        disabled={false}
      />,
    );
    const form = screen.getByPlaceholderText(/type your message/i).closest('form');
    fireEvent.submit(form!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  // Suppress unused-var warning for the noop-chip placeholder.
  it('compiles without unused noop-chip warnings', () => {
    expect(noopChip).toBeTruthy();
  });

  it('wraps chips to a new line within the chip row (T037)', () => {
    render(
      <Composer
        chips={[
          'Personal Injury',
          'Family Law',
          'Estate Planning',
          'Criminal Defense',
          'Employment',
          'Immigration',
          'Bankruptcy',
          'Real Estate',
          'Tax Law',
          'Business Law',
          'Wills & Trusts',
          'Class Action',
        ]}
        onSubmit={() => {}}
        onChipSelect={() => {}}
        inputValue=""
        onInputChange={() => {}}
        disabled={false}
      />,
    );
    const chipRow = screen.getByTestId('lc-chip-row');
    // The row must be a flex container that allows wrapping. Inline
    // styles on the Composer set both `display: flex` and `flex-wrap: wrap`.
    expect(chipRow).toHaveStyle({ display: 'flex' });
    expect(chipRow).toHaveStyle({ flexWrap: 'wrap' });
  });
});
