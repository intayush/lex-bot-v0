/**
 * Spec 017 T005 — usePanelLayout breakpoint matrix.
 * See specs/017-chatbot-redesign/data-model.md § "Breakpoint Matrix".
 */

import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usePanelLayout } from './usePanelLayout';

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', {
    value: width,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, 'innerHeight', {
    value: height,
    writable: true,
    configurable: true,
  });
}

describe('usePanelLayout', () => {
  let originalWidth: number;
  let originalHeight: number;

  beforeEach(() => {
    originalWidth = window.innerWidth;
    originalHeight = window.innerHeight;
  });

  afterEach(() => {
    setViewport(originalWidth, originalHeight);
  });

  it('returns "mobile" for viewport width < 768px', () => {
    setViewport(375, 812);
    const { result } = renderHook(() => usePanelLayout());
    expect(result.current).toBe('mobile');
  });

  it('returns "mobile" at width 767px (boundary, exclusive of 768)', () => {
    setViewport(767, 1024);
    const { result } = renderHook(() => usePanelLayout());
    expect(result.current).toBe('mobile');
  });

  it('returns "tablet" for viewport width 768-1023px', () => {
    setViewport(820, 1180);
    const { result } = renderHook(() => usePanelLayout());
    expect(result.current).toBe('tablet');
  });

  it('returns "tablet" at width 1023px (boundary, exclusive of 1024)', () => {
    setViewport(1023, 800);
    const { result } = renderHook(() => usePanelLayout());
    expect(result.current).toBe('tablet');
  });

  it('returns "desktop" for viewport >= 1024px wide AND >= 808px tall', () => {
    setViewport(1440, 900);
    const { result } = renderHook(() => usePanelLayout());
    expect(result.current).toBe('desktop');
  });

  it('returns "desktop" at exact boundary 1024x808', () => {
    setViewport(1024, 808);
    const { result } = renderHook(() => usePanelLayout());
    expect(result.current).toBe('desktop');
  });

  it('returns "desktop-clamped" for viewport >= 1024px wide BUT < 808px tall', () => {
    setViewport(1280, 700);
    const { result } = renderHook(() => usePanelLayout());
    expect(result.current).toBe('desktop-clamped');
  });

  it('updates when the viewport resizes across a breakpoint', () => {
    setViewport(1440, 900);
    const { result } = renderHook(() => usePanelLayout());
    expect(result.current).toBe('desktop');

    act(() => {
      setViewport(375, 812);
      window.dispatchEvent(new Event('resize'));
    });

    expect(result.current).toBe('mobile');
  });
});
