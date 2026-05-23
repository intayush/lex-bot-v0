export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key, x-session-id, x-preview',
  // x-sop-state added for 010-sop-workflow: widget reads compact SOP state
  // payload from each chat-API response to update the progress bar.
  'Access-Control-Expose-Headers': 'x-session-id, x-sop-state',
};
