/** Default number of times to re-ask an unanswered SOP step before skipping it (018-forward-only-sop). */
export const SOP_REASK_LIMIT = 3;

/** Minimum permitted value for the re-ask limit. Values below this are rejected at startup. */
export const SOP_REASK_LIMIT_MIN = 1;
