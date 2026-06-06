'use client';

/**
 * Spec 016 US4 — Branches dashboard tab (T053).
 *
 * Lists every (case_type, sub_type) pair with branch status.
 * Clicking "Edit branch" / "Add branch" opens the per-pair editor
 * inline below the row (T054).
 *
 * Data source: GET /api/dashboard/branches. The page-level server
 * component preloads the list, but we re-fetch on mount + after each
 * save/publish/delete so admins see fresh status without a full page
 * reload.
 *
 * Per FR-020 the list shows for each pair:
 *   - Status pill: Configured · Active / Configured · Inactive / Not configured.
 *   - Action: Edit / Add / Delete.
 *
 * No drag-and-drop reorder at the pair level — pairs are presented in
 * their case_type + sub_type position order from the seed.
 */

import { useCallback, useEffect, useState } from 'react';
import type { BranchPairSummary } from '@legal-chatbot/shared';
import { BranchEditor } from './branch-editor';

interface BranchesTabProps {
  initialPairs: BranchPairSummary[];
}

export function BranchesTab({ initialPairs }: BranchesTabProps) {
  const [pairs, setPairs] = useState<BranchPairSummary[]>(initialPairs);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingPair, setEditingPair] = useState<{
    caseTypeSlug: string;
    subTypeSlug: string;
    caseTypeLabel: string;
    subTypeLabel: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboard/branches', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as { pairs: BranchPairSummary[] };
      setPairs(data.pairs);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      setError(`Failed to load branches: ${message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // Group pairs by case_type for visual separation.
  const grouped = pairs.reduce<Record<string, BranchPairSummary[]>>((acc, p) => {
    const key = p.case_type_slug;
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {});

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between">
        <p className="text-sm text-[#737373]">
          Configure per-(case type, sub-type) scoring branches. Branches fire
          AFTER the contact step in the default SOP. Pairs without a configured
          branch use the default-only flow.
        </p>
        <button
          type="button"
          className="text-xs text-[#737373] hover:text-[#171717] transition"
          onClick={refresh}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {Object.entries(grouped).map(([caseTypeSlug, groupPairs]) => (
          <section key={caseTypeSlug}>
            <h3 className="text-sm font-semibold text-[#171717] mb-2">
              {groupPairs[0].case_type_label}
            </h3>
            <div className="space-y-1.5">
              {groupPairs.map((pair) => (
                <BranchRow
                  key={`${pair.case_type_slug}::${pair.sub_type_slug}`}
                  pair={pair}
                  isEditing={
                    editingPair?.caseTypeSlug === pair.case_type_slug &&
                    editingPair?.subTypeSlug === pair.sub_type_slug
                  }
                  onEdit={() =>
                    setEditingPair({
                      caseTypeSlug: pair.case_type_slug,
                      subTypeSlug: pair.sub_type_slug,
                      caseTypeLabel: pair.case_type_label,
                      subTypeLabel: pair.sub_type_label,
                    })
                  }
                  onClose={() => setEditingPair(null)}
                  onAfterMutation={refresh}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {pairs.length === 0 && !loading && (
        <p className="text-sm text-[#737373] italic mt-4">
          No case types configured yet. Add some in the Case Types tab first.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface BranchRowProps {
  pair: BranchPairSummary;
  isEditing: boolean;
  onEdit: () => void;
  onClose: () => void;
  onAfterMutation: () => void | Promise<void>;
}

function BranchRow({ pair, isEditing, onEdit, onClose, onAfterMutation }: BranchRowProps) {
  const status = pair.branch
    ? pair.branch.is_active
      ? { label: 'Configured · Active', tone: 'green' as const }
      : { label: 'Configured · Inactive', tone: 'gray' as const }
    : { label: 'Not configured', tone: 'amber' as const };

  const tones = {
    green: { bg: 'bg-[#ECFDF5]', text: 'text-[#059669]', dot: 'bg-[#059669]' },
    gray: { bg: 'bg-[#F5F5F5]', text: 'text-[#737373]', dot: 'bg-[#A3A3A3]' },
    amber: { bg: 'bg-[#FEF3C7]', text: 'text-[#92400E]', dot: 'bg-[#92400E]' },
  } as const;
  const t = tones[status.tone];

  return (
    <div
      className={`rounded-lg border ${
        isEditing ? 'border-[#171717]' : 'border-[#E5E5E5]'
      } bg-white px-4 py-3 transition`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-medium text-[#171717] truncate">
            {pair.sub_type_label}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${t.bg} ${t.text} flex-shrink-0`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />
            {status.label}
          </span>
          {pair.branch?.questions_count !== undefined && pair.branch.questions_count > 0 && (
            <span className="text-xs text-[#737373] flex-shrink-0">
              {pair.branch.questions_count} question
              {pair.branch.questions_count === 1 ? '' : 's'} · v
              {pair.branch.version_number ?? '—'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {!isEditing ? (
            <button
              type="button"
              onClick={onEdit}
              className="text-xs font-medium text-[#171717] hover:underline"
            >
              {pair.branch ? 'Edit branch' : 'Add branch'}
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-medium text-[#737373] hover:text-[#171717]"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {isEditing && (
        <div className="mt-4 pt-4 border-t border-[#E5E5E5]">
          <BranchEditor
            caseTypeSlug={pair.case_type_slug}
            subTypeSlug={pair.sub_type_slug}
            caseTypeLabel={pair.case_type_label}
            subTypeLabel={pair.sub_type_label}
            existingBranchId={pair.branch?.id ?? null}
            onAfterMutation={async () => {
              await onAfterMutation();
            }}
            onClose={onClose}
          />
        </div>
      )}
    </div>
  );
}
