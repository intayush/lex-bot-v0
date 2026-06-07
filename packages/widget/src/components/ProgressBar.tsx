import type { ReactElement } from 'react';

/**
 * SOP progress bar (010-sop-workflow T049 / Phase 6 US4 +
 * 012-progressbar-refinement T015-T016).
 *
 * Visible 8px-tall horizontal progress indicator pinned to the top of
 * the chat content area (below the header bar, above the messages list).
 * Visualizes how far the visitor has progressed through the lawyer's SOP
 * relative to the configured qualified-lead threshold.
 *
 * 010-rev2 (this file) restructures the DOM so the visible label is
 * NOT clipped by the bar's overflow-hidden region (the original 010
 * implementation had this bug — the label was technically rendered but
 * cut off by the parent's overflow:hidden). The new structure:
 *   <div role="progressbar">                  (~32px tall — wraps both)
 *     <div className="lc-progress-bar-track"> (8px tall — overflow:hidden
 *                                              for the shimmer mask)
 *       <div ... fill ... />                  (scales x by ratio)
 *     </div>
 *     <span className="lc-progress-bar-label">Step - X/Y</span>
 *   </div>
 *
 * Source of truth:
 *   - specs/010-sop-workflow/contracts/progress-bar-contract.md (base)
 *   - specs/012-progressbar-refinement/contracts/progressbar-refinement-supplement.md (deltas)
 *
 * Behavior:
 *   - Hidden entirely when total === 0 (no SOP active for the account; FR-038)
 *   - Fill ratio capped at 1.0 (defensive against current > total)
 *   - Stays at 100% after completion (FR-037)
 *   - GPU-accelerated `transform: scaleX` for the fill
 *   - 300ms ease-out transition (FR-035) — disabled when reducedMotion=true
 *   - Shimmer keyframe on the filled portion only — disabled when reducedMotion=true
 *   - Label `Step - X/Y` in 11px top-right; hidden on viewports < 360px
 *   - ARIA: role=progressbar, aria-valuenow, aria-valuemin, aria-valuemax,
 *     verbose aria-label. Visible label is aria-hidden=true (decorative).
 *
 * Theming hooks (CSS custom properties, with defaults):
 *   --lc-progress-color: fill color (default #4338ca — warm indigo, spec 017)
 *   --lc-progress-bg: track background (default rgba(31,27,22,0.06))
 *   --lc-progress-label-color: label text color (default #1f1b16 — warm charcoal)
 */

export interface ProgressBarProps {
  /** Number of SOP steps captured that count toward the threshold. */
  current: number;
  /** Configured threshold (qualified_lead_threshold from the SOP). */
  total: number;
  /** From useReducedMotion(). When true, transition + shimmer are disabled. */
  reducedMotion: boolean;
}

/** Visible bar thickness (px). Bumped from 3px (010) to 8px (012) for visibility. */
const BAR_HEIGHT = 8;
/** Total wrapper height (px) — accommodates bar + label below it. */
const WRAPPER_HEIGHT = 30;
/** Label vertical offset (px) inside the wrapper. */
const LABEL_TOP = 12;

export function ProgressBar({ current, total, reducedMotion }: ProgressBarProps): ReactElement | null {
  if (total === 0) return null;

  // Cap ratio at 1.0 (defensive against current > total).
  const ratio = Math.min(1, Math.max(0, current / total));
  // The visible label always shows the actual count even past total
  // (e.g. "6/5" if a custom SOP advances past threshold). Cap defensively
  // to a sane upper bound to avoid weird UI.
  const displayCurrent = Math.min(current, 999);
  const displayTotal = Math.min(total, 999);
  const ariaCurrent = Math.min(current, total);

  return (
    <div
      role="progressbar"
      aria-valuenow={ariaCurrent}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label={`Lead qualification progress: ${displayCurrent} of ${displayTotal} questions answered`}
      style={{
        position: 'relative',
        width: '100%',
        height: `${WRAPPER_HEIGHT}px`,
        flexShrink: 0,
        // No overflow:hidden here — that lives on the inner bar so the
        // label below the bar is NOT clipped.
      }}
    >
      {/* Visible bar track (8px tall, overflow-hidden for shimmer mask) */}
      <div
        className="lc-progress-bar-track"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: `${BAR_HEIGHT}px`,
          backgroundColor: 'var(--lc-progress-bg, rgba(31, 27, 22, 0.06))',
          overflow: 'hidden',
        }}
      >
        {/* Fill */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'var(--lc-progress-color, #4338ca)',
            transformOrigin: 'left',
            transform: `scaleX(${ratio})`,
            transition: reducedMotion ? 'none' : 'transform 300ms ease-out',
            willChange: reducedMotion ? 'auto' : 'transform',
          }}
        >
          {/* Shimmer overlay (disabled under reduced motion). The pseudo
              keyframe lives in the global <style> block injected once below. */}
          {!reducedMotion && (
            <div
              className="lc-progress-shimmer"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundImage:
                  'linear-gradient(90deg, ' +
                  'rgba(255, 255, 255, 0) 0%, ' +
                  'rgba(255, 255, 255, 0.4) 50%, ' +
                  'rgba(255, 255, 255, 0) 100%)',
                backgroundSize: '200% 100%',
                animation: 'lc-progress-shimmer 2.4s ease-in-out infinite',
              }}
            />
          )}
        </div>
      </div>

      {/* Label (visible; ARIA value handled by parent's aria-label).
          Lives OUTSIDE the overflow-hidden bar track so it's never clipped. */}
      <span
        aria-hidden="true"
        className="lc-progress-bar-label"
        style={{
          position: 'absolute',
          top: `${LABEL_TOP}px`,
          right: '8px',
          fontSize: '11px',
          color: 'var(--lc-progress-label-color, #1f1b16)',
          fontFamily: 'inherit',
          fontWeight: 500,
          letterSpacing: '0.02em',
          pointerEvents: 'none',
        }}
      >
        Step - {displayCurrent}/{displayTotal}
      </span>

      {/* Inject keyframes + small-viewport label hide once. The same key
          name is reused if multiple ProgressBars are mounted (rare; the
          @keyframes definition is idempotent). */}
      <style>{`
        @keyframes lc-progress-shimmer {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
        @media (max-width: 360px) {
          .lc-progress-bar-label { display: none; }
        }
      `}</style>
    </div>
  );
}
