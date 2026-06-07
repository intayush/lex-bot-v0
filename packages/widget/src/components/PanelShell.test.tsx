/**
 * Spec 017 T007 — PanelShell foundational test contract.
 * See specs/017-chatbot-redesign/contracts/panel-shell.md § "Test Contract".
 *
 * This file holds the seven foundational test items. Mobile-takeover-
 * specific tests (slide animation, scroll-lock engagement, aria-modal)
 * land in T012/T013. Glass-fallback test lands in T026.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PanelShell } from './PanelShell';
import * as usePanelLayoutMod from '../hooks/usePanelLayout';
import * as useReducedMotionMod from '../hooks/useReducedMotion';

function setLayout(value: 'mobile' | 'tablet' | 'desktop' | 'desktop-clamped') {
  vi.spyOn(usePanelLayoutMod, 'usePanelLayout').mockReturnValue(value);
}

function setReducedMotion(value: boolean) {
  vi.spyOn(useReducedMotionMod, 'useReducedMotion').mockReturnValue(value);
}

describe('PanelShell — foundational contract', () => {
  beforeEach(() => {
    setLayout('desktop');
    setReducedMotion(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children inside the panel root in document order', () => {
    render(
      <PanelShell isOpen onClosed={() => {}} onCloseRequest={() => {}}>
        <header data-testid="header">H</header>
        <main data-testid="content">M</main>
        <footer data-testid="composer">C</footer>
      </PanelShell>,
    );
    const root = screen.getByRole('dialog');
    const ids = Array.from(root.children).map((c) =>
      (c as HTMLElement).getAttribute('data-testid'),
    );
    expect(ids).toEqual(['header', 'content', 'composer']);
  });

  it('phase progression with motion: entering → open after animationend', () => {
    setReducedMotion(false);
    render(
      <PanelShell isOpen onClosed={() => {}} onCloseRequest={() => {}}>
        <div>x</div>
      </PanelShell>,
    );
    const root = screen.getByRole('dialog');
    expect(root.getAttribute('data-phase')).toBe('entering');

    act(() => {
      fireEvent.animationEnd(root);
    });
    expect(root.getAttribute('data-phase')).toBe('open');
  });

  it('phase progression with reduced motion: jumps to "open" synchronously', () => {
    setReducedMotion(true);
    render(
      <PanelShell isOpen onClosed={() => {}} onCloseRequest={() => {}}>
        <div>x</div>
      </PanelShell>,
    );
    const root = screen.getByRole('dialog');
    expect(root.getAttribute('data-phase')).toBe('open');
  });

  it('Escape inside the panel calls onCloseRequest', () => {
    const onCloseRequest = vi.fn();
    render(
      <PanelShell isOpen onClosed={() => {}} onCloseRequest={onCloseRequest}>
        <div>x</div>
      </PanelShell>,
    );
    const root = screen.getByRole('dialog');
    fireEvent.keyDown(root, { key: 'Escape' });
    expect(onCloseRequest).toHaveBeenCalledTimes(1);
  });

  it('close-then-onClosed sequence: isOpen=false → exiting → onClosed on animationend', () => {
    // Animationend → onClosed is the MOBILE close path. On tablet /
    // desktop the panel has no slide-down keyframe so onClosed fires
    // synchronously the moment isOpen flips false (verified by the
    // "close on non-mobile breakpoints" describe block below).
    setLayout('mobile');
    setReducedMotion(false);
    const onClosed = vi.fn();

    const { rerender } = render(
      <PanelShell isOpen onClosed={onClosed} onCloseRequest={() => {}}>
        <div>x</div>
      </PanelShell>,
    );

    const root = screen.getByRole('dialog');
    act(() => fireEvent.animationEnd(root));
    expect(root.getAttribute('data-phase')).toBe('open');

    rerender(
      <PanelShell isOpen={false} onClosed={onClosed} onCloseRequest={() => {}}>
        <div>x</div>
      </PanelShell>,
    );

    expect(root.getAttribute('data-phase')).toBe('exiting');
    expect(onClosed).not.toHaveBeenCalled();

    act(() => fireEvent.animationEnd(root));
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('ARIA: role="dialog" + aria-label honored, aria-modal only on mobile', () => {
    setLayout('desktop');
    const { rerender } = render(
      <PanelShell
        isOpen
        onClosed={() => {}}
        onCloseRequest={() => {}}
        ariaLabel="Chat with LexBot"
      >
        <div>x</div>
      </PanelShell>,
    );
    const desktopRoot = screen.getByRole('dialog');
    expect(desktopRoot.getAttribute('aria-label')).toBe('Chat with LexBot');
    expect(desktopRoot.getAttribute('aria-modal')).toBeNull();

    setLayout('mobile');
    rerender(
      <PanelShell
        isOpen
        onClosed={() => {}}
        onCloseRequest={() => {}}
        ariaLabel="Chat with LexBot"
      >
        <div>x</div>
      </PanelShell>,
    );
    const mobileRoot = screen.getByRole('dialog');
    expect(mobileRoot.getAttribute('aria-modal')).toBe('true');
  });

  it('scroll-lock engages on mobile breakpoint when open', () => {
    setLayout('mobile');
    document.body.style.position = 'relative';

    Object.defineProperty(window, 'scrollY', {
      value: 100,
      writable: true,
      configurable: true,
    });

    const { unmount } = render(
      <PanelShell isOpen onClosed={() => {}} onCloseRequest={() => {}}>
        <div>x</div>
      </PanelShell>,
    );

    expect(document.body.style.position).toBe('fixed');

    unmount();
    expect(document.body.style.position).toBe('relative');
  });
});

describe('PanelShell — mobile takeover behavior (T012)', () => {
  beforeEach(() => {
    setLayout('mobile');
    setReducedMotion(false);
    document.body.style.cssText = '';
    Object.defineProperty(window, 'scrollY', {
      value: 0,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.style.cssText = '';
  });

  it('scroll-lock stays engaged through the "exiting" phase until onClosed fires', () => {
    document.body.style.position = 'relative';
    Object.defineProperty(window, 'scrollY', {
      value: 200,
      writable: true,
      configurable: true,
    });

    const { rerender } = render(
      <PanelShell isOpen onClosed={() => {}} onCloseRequest={() => {}}>
        <div>x</div>
      </PanelShell>,
    );
    const root = screen.getByRole('dialog');
    act(() => fireEvent.animationEnd(root));
    expect(root.getAttribute('data-phase')).toBe('open');
    expect(document.body.style.position).toBe('fixed');

    // Begin closing — phase becomes 'exiting' but lock must persist.
    rerender(
      <PanelShell isOpen={false} onClosed={() => {}} onCloseRequest={() => {}}>
        <div>x</div>
      </PanelShell>,
    );
    expect(root.getAttribute('data-phase')).toBe('exiting');
    expect(document.body.style.position).toBe('fixed');
  });

  it('aria-modal="true" is set on mobile breakpoint when open', () => {
    render(
      <PanelShell isOpen onClosed={() => {}} onCloseRequest={() => {}}>
        <div>x</div>
      </PanelShell>,
    );
    const root = screen.getByRole('dialog');
    expect(root.getAttribute('aria-modal')).toBe('true');
  });
});

describe('PanelShell — slide animation (T013)', () => {
  beforeEach(() => {
    setLayout('mobile');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('with motion: data-phase progresses entering → open → exiting → onClosed', () => {
    setReducedMotion(false);
    const onClosed = vi.fn();
    const { rerender } = render(
      <PanelShell isOpen onClosed={onClosed} onCloseRequest={() => {}}>
        <div>x</div>
      </PanelShell>,
    );
    const root = screen.getByRole('dialog');

    expect(root.getAttribute('data-phase')).toBe('entering');
    act(() => fireEvent.animationEnd(root));
    expect(root.getAttribute('data-phase')).toBe('open');

    rerender(
      <PanelShell isOpen={false} onClosed={onClosed} onCloseRequest={() => {}}>
        <div>x</div>
      </PanelShell>,
    );
    expect(root.getAttribute('data-phase')).toBe('exiting');
    expect(onClosed).not.toHaveBeenCalled();

    act(() => fireEvent.animationEnd(root));
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('with reduced-motion: jumps to open and close fires onClosed synchronously', () => {
    setReducedMotion(true);
    const onClosed = vi.fn();
    const { rerender } = render(
      <PanelShell isOpen onClosed={onClosed} onCloseRequest={() => {}}>
        <div>x</div>
      </PanelShell>,
    );
    const root = screen.getByRole('dialog');
    expect(root.getAttribute('data-phase')).toBe('open');

    rerender(
      <PanelShell isOpen={false} onClosed={onClosed} onCloseRequest={() => {}}>
        <div>x</div>
      </PanelShell>,
    );
    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});

describe('PanelShell — close on non-mobile breakpoints (regression)', () => {
  // Regression: on tablet / desktop the panel has no slide animation
  // attached, so `animationend` never fires. The close-button click
  // path therefore needs to fire onClosed synchronously on these
  // breakpoints — otherwise the panel stays mounted forever.
  // (Pre-fix: clicking the X on desktop did nothing visible.)

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('desktop: setting isOpen=false fires onClosed without waiting for animationend', () => {
    setLayout('desktop');
    setReducedMotion(false);
    const onClosed = vi.fn();
    const { rerender } = render(
      <PanelShell isOpen onClosed={onClosed} onCloseRequest={() => {}}>
        <div>x</div>
      </PanelShell>,
    );
    rerender(
      <PanelShell isOpen={false} onClosed={onClosed} onCloseRequest={() => {}}>
        <div>x</div>
      </PanelShell>,
    );
    // No animationend — desktop has no keyframe attached. onClosed
    // MUST have fired synchronously from the effect.
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('tablet: setting isOpen=false fires onClosed without waiting for animationend', () => {
    setLayout('tablet');
    setReducedMotion(false);
    const onClosed = vi.fn();
    const { rerender } = render(
      <PanelShell isOpen onClosed={onClosed} onCloseRequest={() => {}}>
        <div>x</div>
      </PanelShell>,
    );
    rerender(
      <PanelShell isOpen={false} onClosed={onClosed} onCloseRequest={() => {}}>
        <div>x</div>
      </PanelShell>,
    );
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('desktop-clamped: setting isOpen=false fires onClosed synchronously', () => {
    setLayout('desktop-clamped');
    setReducedMotion(false);
    const onClosed = vi.fn();
    const { rerender } = render(
      <PanelShell isOpen onClosed={onClosed} onCloseRequest={() => {}}>
        <div>x</div>
      </PanelShell>,
    );
    rerender(
      <PanelShell isOpen={false} onClosed={onClosed} onCloseRequest={() => {}}>
        <div>x</div>
      </PanelShell>,
    );
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('mobile (with motion): still waits for animationend before firing onClosed', () => {
    setLayout('mobile');
    setReducedMotion(false);
    const onClosed = vi.fn();
    const { rerender } = render(
      <PanelShell isOpen onClosed={onClosed} onCloseRequest={() => {}}>
        <div>x</div>
      </PanelShell>,
    );
    const root = screen.getByRole('dialog');
    act(() => fireEvent.animationEnd(root)); // entering → open
    rerender(
      <PanelShell isOpen={false} onClosed={onClosed} onCloseRequest={() => {}}>
        <div>x</div>
      </PanelShell>,
    );
    // Mobile DOES animate; onClosed must NOT fire yet.
    expect(onClosed).not.toHaveBeenCalled();
    // Slide-down completes → onClosed fires.
    act(() => fireEvent.animationEnd(root));
    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});
