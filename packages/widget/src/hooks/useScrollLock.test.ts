/**
 * Spec 017 T006 — useScrollLock body-scroll preservation.
 * See specs/017-chatbot-redesign/data-model.md § "Scroll-Lock State".
 *
 * Engagement (snapshot then mutate):
 *   1. Capture window.scrollY → savedScrollY
 *   2. Capture six body.style.* properties into savedBodyStyle
 *   3. Apply position: fixed; top: -savedScrollY; left/right/width;
 *      overflow: hidden
 *
 * Disengagement (restore exactly):
 *   1. Restore each of the six properties (including '' for originally unset)
 *   2. window.scrollTo(0, savedScrollY)
 */

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScrollLock } from './useScrollLock';

describe('useScrollLock', () => {
  beforeEach(() => {
    document.body.style.cssText = '';
    Object.defineProperty(window, 'scrollY', {
      value: 0,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    document.body.style.cssText = '';
  });

  it('does NOT mutate body when engaged === false', () => {
    document.body.style.position = 'relative';
    renderHook(() => useScrollLock(false));
    expect(document.body.style.position).toBe('relative');
  });

  it('captures scrollY and applies fixed-positioning when engaged === true', () => {
    Object.defineProperty(window, 'scrollY', {
      value: 250,
      writable: true,
      configurable: true,
    });

    renderHook(() => useScrollLock(true));

    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.top).toBe('-250px');
    expect(document.body.style.left).toBe('0px');
    expect(document.body.style.right).toBe('0px');
    expect(document.body.style.width).toBe('100%');
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores original body styles on disengage', () => {
    document.body.style.position = 'relative';
    document.body.style.overflow = 'auto';

    Object.defineProperty(window, 'scrollY', {
      value: 100,
      writable: true,
      configurable: true,
    });

    const { rerender } = renderHook(({ engaged }) => useScrollLock(engaged), {
      initialProps: { engaged: true },
    });

    expect(document.body.style.position).toBe('fixed');

    rerender({ engaged: false });

    expect(document.body.style.position).toBe('relative');
    expect(document.body.style.overflow).toBe('auto');
    expect(document.body.style.top).toBe('');
    expect(document.body.style.left).toBe('');
    expect(document.body.style.right).toBe('');
    expect(document.body.style.width).toBe('');
  });

  it('calls window.scrollTo(0, savedScrollY) on disengage', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    Object.defineProperty(window, 'scrollY', {
      value: 543,
      writable: true,
      configurable: true,
    });

    const { rerender } = renderHook(({ engaged }) => useScrollLock(engaged), {
      initialProps: { engaged: true },
    });

    rerender({ engaged: false });

    expect(scrollTo).toHaveBeenCalledWith(0, 543);
    scrollTo.mockRestore();
  });

  it('disengages on unmount as a safety net', () => {
    document.body.style.position = 'relative';

    Object.defineProperty(window, 'scrollY', {
      value: 50,
      writable: true,
      configurable: true,
    });

    const { unmount } = renderHook(() => useScrollLock(true));
    expect(document.body.style.position).toBe('fixed');

    unmount();

    expect(document.body.style.position).toBe('relative');
  });

  it('preserves originally-unset properties as empty strings on restore', () => {
    Object.defineProperty(window, 'scrollY', {
      value: 0,
      writable: true,
      configurable: true,
    });

    const { rerender } = renderHook(({ engaged }) => useScrollLock(engaged), {
      initialProps: { engaged: true },
    });

    rerender({ engaged: false });

    expect(document.body.style.position).toBe('');
    expect(document.body.style.top).toBe('');
    expect(document.body.style.overflow).toBe('');
  });
});
