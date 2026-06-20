/**
 * 020-branch-csv-import — POST /api/dashboard/branches/[caseType]/[subType]/import
 *
 * Accepts a multipart/form-data upload with a single `file` field (the CSV).
 * Parses and validates the CSV, returns either:
 *   200 { ok: true, questions: BranchQuestion[] }   — valid, ready for Save as Draft
 *   400 { ok: false, errors: CsvError[] }            — wrong format / missing columns
 *   413 { ok: false, errors: CsvError[] }            — file too large
 *   422 { ok: false, errors: CsvError[] }            — row-level validation failures
 *
 * Does NOT write to the database — the client calls the existing PUT
 * /api/dashboard/branches/[caseType]/[subType] with the returned questions
 * to create a new draft version.
 */
import { getAuthSession } from '../../../../../../../lib/dashboard-session';
import { parseAndValidateCsv, type CsvError } from '../../../../../../../lib/branch-csv';
import { corsHeaders } from '../../../../../chat/cors';

const MAX_FILE_SIZE_BYTES = 500 * 1024; // 500 KB

interface RouteContext {
  params: Promise<{ caseType: string; subType: string }>;
}

function errorResponse(status: number, errors: CsvError[]): Response {
  return Response.json({ ok: false, errors }, { status, headers: corsHeaders });
}

export async function POST(req: Request, _ctx: RouteContext) {
  const session = await getAuthSession();
  if (!session.accountId) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Parse multipart form data.
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return errorResponse(400, [{ row: 0, column: 'file', message: 'Request must be multipart/form-data with a file field.' }]);
  }

  const fileEntry = formData.get('file');
  if (!fileEntry || !(fileEntry instanceof File)) {
    return errorResponse(400, [{ row: 0, column: 'file', message: 'No file provided. Include a CSV file in the "file" field.' }]);
  }

  // Check file size.
  if (fileEntry.size > MAX_FILE_SIZE_BYTES) {
    return errorResponse(413, [{ row: 0, column: 'file', message: `File exceeds the 500 KB limit (uploaded: ${Math.round(fileEntry.size / 1024)} KB).` }]);
  }

  // Check file extension or content-type.
  const name = fileEntry.name ?? '';
  const contentType = fileEntry.type ?? '';
  const isCsv = name.toLowerCase().endsWith('.csv') || contentType === 'text/csv' || contentType === 'text/plain';
  if (!isCsv) {
    return errorResponse(400, [{ row: 0, column: 'file', message: 'Please upload a CSV file (.csv).' }]);
  }

  // Read file content.
  let csvText: string;
  try {
    csvText = await fileEntry.text();
  } catch {
    return errorResponse(400, [{ row: 0, column: 'file', message: 'Could not read file contents.' }]);
  }

  // Parse and validate.
  const result = parseAndValidateCsv(csvText);

  if (!result.ok) {
    // Distinguish format errors (row 0 or 1, missing columns) from row-level errors.
    const isFormatError = result.errors.every((e) => e.row <= 1);
    return errorResponse(isFormatError ? 400 : 422, result.errors);
  }

  return Response.json(
    { ok: true, questions: result.questions, warnings: [] },
    { status: 200, headers: corsHeaders },
  );
}
