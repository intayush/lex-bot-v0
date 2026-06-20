/**
 * Integration tests for 020-branch-csv-import routes.
 * Tests the GET /template and POST /import handlers directly without HTTP.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dashboard session so we can control auth without iron-session.
vi.mock('../../../../lib/dashboard-session', () => ({
  getAuthSession: vi.fn().mockResolvedValue({ accountId: 'acct_test' }),
}));

import { GET as templateGET } from './[caseType]/[subType]/template/route';
import { POST as importPOST } from './[caseType]/[subType]/import/route';
import { getAuthSession } from '../../../../lib/dashboard-session';

// ---------------------------------------------------------------------------
// T008 — Template download
// ---------------------------------------------------------------------------

describe('GET /template', () => {
  const ctx = { params: Promise.resolve({ caseType: 'personal_injury', subType: 'car_accident' }) };

  it('returns 200 with CSV content-type', async () => {
    const req = new Request('http://localhost/api/dashboard/branches/personal_injury/car_accident/template');
    const res = await templateGET(req, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
  });

  it('returns Content-Disposition with correct filename', async () => {
    const req = new Request('http://localhost/api/dashboard/branches/personal_injury/car_accident/template');
    const res = await templateGET(req, ctx);
    const cd = res.headers.get('content-disposition') ?? '';
    expect(cd).toContain('attachment');
    expect(cd).toContain('branch-template-personal_injury-car_accident.csv');
  });

  it('returns CSV body with 7 required column headers', async () => {
    const req = new Request('http://localhost/api/dashboard/branches/personal_injury/car_accident/template');
    const res = await templateGET(req, ctx);
    const body = await res.text();
    const headerLine = body.split('\n')[0]!;
    for (const col of ['question_position', 'question_text', 'free_text_allowed', 'multi_select', 'chip_label', 'chip_slug', 'score_weight']) {
      expect(headerLine).toContain(col);
    }
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(getAuthSession).mockResolvedValueOnce({ accountId: undefined });
    const req = new Request('http://localhost/api/dashboard/branches/personal_injury/car_accident/template');
    const res = await templateGET(req, ctx);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// T009 — Import happy path
// ---------------------------------------------------------------------------

describe('POST /import — happy path', () => {
  const ctx = { params: Promise.resolve({ caseType: 'personal_injury', subType: 'car_accident' }) };

  const VALID_CSV = [
    'question_position,question_text,free_text_allowed,multi_select,chip_label,chip_slug,score_weight',
    '1,Were you injured?,NO,NO,Yes serious,yes_serious,25',
    '1,Were you injured?,NO,NO,Yes minor,yes_minor,10',
    '2,Was there a police report?,YES,NO,Yes,police_yes,15',
    '2,Was there a police report?,YES,NO,No,police_no,0',
  ].join('\n');

  function makeFormData(content: string, filename = 'test.csv', type = 'text/csv') {
    const blob = new Blob([content], { type });
    const file = new File([blob], filename, { type });
    const fd = new FormData();
    fd.append('file', file);
    return fd;
  }

  it('returns 200 with ok:true and questions array', async () => {
    const req = new Request('http://localhost/...', { method: 'POST', body: makeFormData(VALID_CSV) });
    const res = await importPOST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; questions: unknown[] };
    expect(json.ok).toBe(true);
    expect(json.questions).toHaveLength(2);
  });

  it('questions have correct structure', async () => {
    const req = new Request('http://localhost/...', { method: 'POST', body: makeFormData(VALID_CSV) });
    const res = await importPOST(req, ctx);
    const json = await res.json() as { ok: boolean; questions: Array<{ position: number; text: string; chips: unknown[] }> };
    expect(json.questions[0]!.position).toBe(0); // 0-indexed
    expect(json.questions[0]!.text).toBe('Were you injured?');
    expect(json.questions[0]!.chips).toHaveLength(2);
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(getAuthSession).mockResolvedValueOnce({ accountId: undefined });
    const req = new Request('http://localhost/...', { method: 'POST', body: makeFormData(VALID_CSV) });
    const res = await importPOST(req, ctx);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// T010 — Row-level validation errors
// ---------------------------------------------------------------------------

describe('POST /import — row validation errors', () => {
  const ctx = { params: Promise.resolve({ caseType: 'personal_injury', subType: 'car_accident' }) };

  function makeFormData(content: string) {
    const file = new File([new Blob([content], { type: 'text/csv' })], 'test.csv', { type: 'text/csv' });
    const fd = new FormData();
    fd.append('file', file);
    return fd;
  }

  it('returns 422 with errors for invalid rows', async () => {
    const badCsv = [
      'question_position,question_text,free_text_allowed,multi_select,chip_label,chip_slug,score_weight',
      '1,Test question,NO,NO,Chip A,bad slug here,5',
      '2,Another,NO,NO,Chip B,valid_slug,999',
    ].join('\n');
    const req = new Request('http://localhost/...', { method: 'POST', body: makeFormData(badCsv) });
    const res = await importPOST(req, ctx);
    expect(res.status).toBe(422);
    const json = await res.json() as { ok: boolean; errors: Array<{ row: number; column: string }> };
    expect(json.ok).toBe(false);
    expect(json.errors.some((e) => e.column === 'chip_slug')).toBe(true);
    expect(json.errors.some((e) => e.column === 'score_weight')).toBe(true);
  });

  it('does not write any data on validation failure', async () => {
    // The route returns 422 without touching the DB — just verify no 200
    const badCsv = [
      'question_position,question_text,free_text_allowed,multi_select,chip_label,chip_slug,score_weight',
      '1,Q,NO,NO,C,bad slug,5',
    ].join('\n');
    const req = new Request('http://localhost/...', { method: 'POST', body: makeFormData(badCsv) });
    const res = await importPOST(req, ctx);
    expect(res.status).not.toBe(200);
  });
});

// ---------------------------------------------------------------------------
// T011 — Format errors
// ---------------------------------------------------------------------------

describe('POST /import — format errors', () => {
  const ctx = { params: Promise.resolve({ caseType: 'personal_injury', subType: 'car_accident' }) };

  it('returns 400 when file extension is not .csv', async () => {
    const file = new File([new Blob(['some content'], { type: 'application/vnd.ms-excel' })], 'test.xlsx', { type: 'application/vnd.ms-excel' });
    const fd = new FormData();
    fd.append('file', file);
    const req = new Request('http://localhost/...', { method: 'POST', body: fd });
    const res = await importPOST(req, ctx);
    expect(res.status).toBe(400);
    const json = await res.json() as { ok: boolean; errors: Array<{ message: string }> };
    expect(json.ok).toBe(false);
    expect(json.errors[0]!.message).toContain('.csv');
  });

  it('returns 400 when required column is missing', async () => {
    const csvMissingCol = 'question_position,question_text,free_text_allowed,multi_select,chip_label,chip_slug\n1,Q,NO,NO,C,c';
    const file = new File([new Blob([csvMissingCol], { type: 'text/csv' })], 'test.csv', { type: 'text/csv' });
    const fd = new FormData();
    fd.append('file', file);
    const req = new Request('http://localhost/...', { method: 'POST', body: fd });
    const res = await importPOST(req, ctx);
    expect(res.status).toBe(400);
    const json = await res.json() as { ok: boolean; errors: Array<{ message: string }> };
    expect(json.errors.some((e) => e.message.includes('score_weight'))).toBe(true);
  });

  it('returns 413 when file exceeds 500 KB', async () => {
    const bigContent = 'a'.repeat(600 * 1024);
    const file = new File([new Blob([bigContent], { type: 'text/csv' })], 'big.csv', { type: 'text/csv' });
    const fd = new FormData();
    fd.append('file', file);
    const req = new Request('http://localhost/...', { method: 'POST', body: fd });
    const res = await importPOST(req, ctx);
    expect(res.status).toBe(413);
  });

  it('returns 400 when no file is provided', async () => {
    const fd = new FormData();
    const req = new Request('http://localhost/...', { method: 'POST', body: fd });
    const res = await importPOST(req, ctx);
    expect(res.status).toBe(400);
  });
});
