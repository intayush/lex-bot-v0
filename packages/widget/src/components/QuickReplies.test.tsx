/**
 * Spec 016 chip-list-flash fix — QuickReplies behaviour when the
 * `options` prop is undefined.
 *
 * Without the fix, the component fell back to a hard-coded 3-item
 * DEFAULT_OPTIONS list (Personal Injury / Family Law / Estate
 * Planning) plus a "Schedule a Consultation" tail. The widget ran
 * the fallback render for the ~200ms before /api/config resolved,
 * then re-rendered with the real (longer) list. Visitors saw a
 * brief 4-chip glitch swap to the 12-chip configured list.
 *
 * Fix: when `options` is undefined OR an empty array, return null
 * (render nothing). The greeting paragraph + chat input stay visible
 * so the panel doesn't look broken; the chips appear only when the
 * config has loaded.
 */

import { describe, expect, it } from 'vitest';
import { QuickReplies } from './QuickReplies';

const noopSelect = () => undefined;

describe('QuickReplies', () => {
  it('returns null when options is undefined (config still loading)', () => {
    const result = QuickReplies({ onSelect: noopSelect, options: undefined });
    expect(result).toBeNull();
  });

  it('returns null when options is an empty array (firm with no in_scope_case_types)', () => {
    const result = QuickReplies({ onSelect: noopSelect, options: [] });
    expect(result).toBeNull();
  });

  it('renders a wrapper div when options has at least one item', () => {
    const result = QuickReplies({
      onSelect: noopSelect,
      options: ['Personal Injury'],
    });
    expect(result).not.toBeNull();
    // The component returns a single <div>; assert against its tag name.
    // (React.createElement's first arg is the type — a string for native
    // tags. We don't render the tree, just verify the shape.)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).type).toBe('div');
  });

  it('appends Schedule a Consultation when not already in the list', () => {
    const result = QuickReplies({
      onSelect: noopSelect,
      options: ['Personal Injury', 'Family Law'],
    });
    // Children of the wrapper are <button> nodes per option label.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const children = (result as any).props.children as Array<{ key: string }>;
    expect(children.map((c) => c.key)).toEqual([
      'Personal Injury',
      'Family Law',
      'Schedule a Consultation',
    ]);
  });

  it('does not duplicate Schedule a Consultation when already present', () => {
    const result = QuickReplies({
      onSelect: noopSelect,
      options: ['Personal Injury', 'Schedule a Consultation'],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const children = (result as any).props.children as Array<{ key: string }>;
    expect(children.map((c) => c.key)).toEqual([
      'Personal Injury',
      'Schedule a Consultation',
    ]);
  });
});
