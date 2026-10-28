import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scout, verifyEvidence, isOpen, parseJson, toBrief } from '../src/scout.mjs';

const profile = { name: 'Acme Web', entity: 'Acme LLC', location: 'MA', region: 'Massachusetts', contact: 'a@b.c',
  services: ['website redesign'], facts: ['Builds websites.'], limits: ['no construction'] };
const PAGE = 'The Town of Example invites proposals for a complete redesign of the town website with ADA accessibility. Proposals are due November 20, 2026 by 2:00 PM.';

function fakeRun(assessments) {
  const calls = [];
  let i = 0;
  const run = async (op, input) => {
    calls.push(op);
    if (op === 'tavily.search') return { results: [
      { url: 'https://town.example/rfp', title: 'RFP Website Redesign', content: 'Request for Proposals', score: 0.9 },
      { url: 'https://news.example/x', title: 'Town hires firm', content: 'news story', score: 0.99 },
      { url: 'https://old.example/rfp', title: 'RFQ website', content: 'solicitation', score: 0.5 },
    ] };
    if (op === 'tavily.extract') return { results: input.urls.map((url) => ({ url, raw_content: PAGE })) };
    if (op === 'llm.chat' && input.messages[0].content.startsWith('You screen')) return { model: 'nemotron-test', content: JSON.stringify(assessments[i++]) };
    if (op === 'llm.chat') return { model: 'nemotron-test', content: '<think>x</think>## Cover letter\n[CONFIRM: references]' };
    throw new Error(op);
  };
  return { run, calls };
}

test('filters non-solicitations, drops closed bids, verifies quotes, drafts the best', async () => {
  const { run, calls } = fakeRun([
    { is_open_solicitation: true, buyer: 'Town of Example', title: 'Website Redesign', due_date: '2026-11-20', fit_score: 88,
      why_fit: ['web redesign'], gaps: [], requirements: ['ADA'], evidence: [
        { claim: 'scope', quote: 'invites proposals for a complete redesign of the town website' },
        { claim: 'made up', quote: 'the budget is $90,000' }] },
    { is_open_solicitation: true, buyer: 'Old', title: 'Old RFQ', due_date: '2026-01-01', fit_score: 95, evidence: [] },
  ]);
  const r = await scout({ profile, today: '2026-10-28' }, run);
  assert.deepEqual(r.candidates, ['https://town.example/rfp', 'https://old.example/rfp']);
  assert.equal(r.best.title, 'Website Redesign');
  assert.equal(r.best.evidence.length, 1);
  assert.equal(r.best.dropped_quotes, 1);
  assert.equal(r.ranked.length, 1);
  assert.equal(r.draft, '## Cover letter\n[CONFIRM: references]');
  assert.deepEqual(calls, ['tavily.search', 'tavily.extract', 'llm.chat', 'llm.chat', 'llm.chat']);
  assert.match(toBrief(r), /Best bid: Website Redesign/);
});

test('a fit with no verifiable quote is capped at 30', () => {
  const a = verifyEvidence({ fit_score: 90, evidence: [{ claim: 'x', quote: 'not on the page' }] }, PAGE);
  assert.equal(a.fit_score, 30);
  assert.equal(a.evidence.length, 0);
});

test('quote match ignores case and whitespace', () => {
  const a = verifyEvidence({ fit_score: 70, evidence: [{ claim: 'x', quote: 'PROPOSALS ARE   due November 20, 2026' }] }, PAGE);
  assert.equal(a.evidence.length, 1);
  assert.equal(a.fit_score, 70);
});

test('isOpen and parseJson', () => {
  assert.equal(isOpen({ is_open_solicitation: true, due_date: null }, '2026-10-28'), true);
  assert.equal(isOpen({ is_open_solicitation: true, due_date: '2026-10-01' }, '2026-10-28'), false);
  assert.equal(isOpen({ is_open_solicitation: false }, '2026-10-28'), false);
  assert.deepEqual(parseJson('<think>{no}</think>```json\n{"a":1}\n```'), { a: 1 });
});

test('no draft when every open bid is below the fit threshold', async () => {
  const { run, calls } = fakeRun([
    { is_open_solicitation: true, title: 'HIV clinic services', due_date: '2026-11-20', fit_score: 0,
      evidence: [{ claim: 'x', quote: 'Proposals are due November 20, 2026' }] },
    { is_open_solicitation: true, title: 'Bus routes', due_date: '2026-11-20', fit_score: 10, evidence: [] },
  ]);
  const r = await scout({ profile, today: '2026-10-28' }, run);
  assert.equal(r.best, null);
  assert.equal(r.draft, null);
  assert.equal(calls.filter((c) => c === 'llm.chat').length, 2);
  assert.match(toBrief(r), /No open solicitation reached the fit threshold/);
});

test('keyword gate skips solicitations outside the trade', async () => {
  const { looksRelevant } = await import('../src/scout.mjs');
  assert.equal(looksRelevant({ title: 'RFP website redesign', content: '' }, ['website']), true);
  assert.equal(looksRelevant({ title: 'RFP transportation services', content: '' }, ['website']), false);
});
