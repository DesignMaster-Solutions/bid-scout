// Bid Scout: live web (Tavily) -> read each solicitation (Tavily extract) -> Nemotron scores fit with
// quoted evidence -> quotes are checked against the page text -> best open bid gets a drafted response.
const SOLICITATION = /\b(rfp|rfq|rfi|request for (proposals?|quotes?|qualifications|information)|invitation (to|for) bid|solicitation|bid opportunit)/i;

export function buildQueries(profile) {
  return profile.services.map((s) => `"request for proposals" ${s} ${profile.region} 2026`);
}

// Cheap gate before spending an extract + model call: it must look like a solicitation AND mention our trade.
export function looksRelevant(hit, keywords = []) {
  const t = `${hit.title} ${hit.content}`;
  return SOLICITATION.test(t) && (!keywords.length || keywords.some((k) => t.toLowerCase().includes(k.toLowerCase())));
}

export function parseJson(text) {
  const clean = String(text).replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`model did not return JSON: ${clean.slice(0, 200)}`);
  return JSON.parse(clean.slice(start, end + 1));
}

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

// A claim only counts if its quote really is on the page; unproven fits are capped.
export function verifyEvidence(assessment, pageText) {
  const page = norm(pageText);
  const evidence = (assessment.evidence ?? []).filter((e) => e?.quote && page.includes(norm(e.quote)));
  const dropped = (assessment.evidence ?? []).length - evidence.length;
  const fit = Math.max(0, Math.min(100, Number(assessment.fit_score) || 0));
  return { ...assessment, evidence, dropped_quotes: dropped, fit_score: evidence.length ? fit : Math.min(fit, 30) };
}

export function isOpen(a, today) {
  if (!a.is_open_solicitation) return false;
  if (!a.due_date) return true;
  const d = new Date(a.due_date);
  return Number.isNaN(d.getTime()) || d >= new Date(today);
}

function profileBlock(p) {
  return [
    `Company: ${p.name} (${p.entity}), ${p.location}. Contact: ${p.contact}.`,
    `Services: ${p.services.join('; ')}.`,
    `Facts (only these may be claimed): ${p.facts.join(' ')}`,
    `Cannot do: ${p.limits.join('; ')}.`,
  ].join('\n');
}

const ASSESS_SYSTEM = `You screen public solicitations (RFP/RFQ/bids) for one small company.
Return ONLY a JSON object with keys:
is_open_solicitation (boolean: the page is an actual solicitation accepting responses, not news or a list of awards),
buyer (string), title (string), due_date (YYYY-MM-DD or null), fit_score (0-100 for this company winning it),
why_fit (array of short strings), gaps (array: requirements the company may not meet, e.g. bonding, certifications, local presence),
requirements (array: submission requirements), evidence (array of {"claim","quote"} where quote is copied VERBATIM from the page, 8-30 words).
Never invent facts. If the page is not a solicitation, set is_open_solicitation false and fit_score 0.`;

const DRAFT_SYSTEM = `You write first drafts of proposal responses for a small company.
Use ONLY the company facts given. Where the solicitation asks for something not in the facts (references, insurance certificates, pricing, staff resumes), write [CONFIRM: what is needed] instead of inventing it.
Plain English, no hype. Output Markdown: a cover letter (under 180 words), then a section per submission requirement with the response or the [CONFIRM] placeholder, then a go/no-go checklist.`;

export async function scout({ profile, today = new Date().toISOString().slice(0, 10), maxRead = 6, minFit = 40 }, run) {
  const queries = buildQueries(profile);
  const seen = new Map();
  for (const query of queries) {
    const r = await run('tavily.search', { query, search_depth: 'advanced', max_results: 8, time_range: 'month', include_answer: false });
    for (const hit of r.results ?? []) {
      if (!seen.has(hit.url) && looksRelevant(hit, profile.keywords)) seen.set(hit.url, { ...hit, query });
    }
  }
  const candidates = [...seen.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, maxRead);
  if (!candidates.length) return { profile: profile.name, today, queries, candidates: [], assessed: [], best: null, draft: null };

  const ex = await run('tavily.extract', { urls: candidates.map((c) => c.url), extract_depth: 'advanced' });
  const pages = new Map((ex.results ?? []).map((p) => [p.url, p.raw_content ?? '']));

  const assessed = [];
  let model = null;
  for (const c of candidates) {
    const text = (pages.get(c.url) || c.content || '').slice(0, 24_000);
    const out = await run('llm.chat', {
      temperature: 0.1, max_tokens: 4000,
      messages: [
        { role: 'system', content: ASSESS_SYSTEM },
        { role: 'user', content: `${profileBlock(profile)}\n\nToday: ${today}\nURL: ${c.url}\n\nPAGE TEXT:\n${text}` },
      ],
    });
    model = out.model;
    let a;
    try { a = parseJson(out.content); } catch (e) { assessed.push({ url: c.url, error: e.message, fit_score: 0, is_open_solicitation: false }); continue; }
    assessed.push({ url: c.url, ...verifyEvidence(a, text) });
  }

  // Below minFit nothing is worth a draft: saying "no match today" beats a proposal for the wrong job.
  const ranked = assessed.filter((a) => !a.error && isOpen(a, today) && a.fit_score >= minFit).sort((a, b) => b.fit_score - a.fit_score);
  const best = ranked[0] ?? null;
  let draft = null;
  if (best) {
    const out = await run('llm.chat', {
      temperature: 0.3, max_tokens: 6000,
      messages: [
        { role: 'system', content: DRAFT_SYSTEM },
        { role: 'user', content: `${profileBlock(profile)}\n\nSOLICITATION: ${best.title} (${best.buyer}), due ${best.due_date ?? 'see page'}\nURL: ${best.url}\nRequirements: ${JSON.stringify(best.requirements ?? [])}\nKnown gaps: ${JSON.stringify(best.gaps ?? [])}` },
      ],
    });
    draft = String(out.content).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }
  return { profile: profile.name, today, model, queries, candidates: candidates.map((c) => c.url), assessed, ranked, best, draft };
}

export function toBrief(r) {
  const lines = [`# Bid Scout: ${r.profile} (${r.today})`, '', `Model: ${r.model ?? 'n/a'} · searched ${r.queries.length} queries · read ${r.candidates.length} solicitations`, ''];
  if (!r.best) {
    lines.push('No open solicitation reached the fit threshold today. Screened:', '');
    for (const a of r.assessed ?? []) lines.push(`- ${a.fit_score} · ${a.is_open_solicitation ? 'open' : 'not a solicitation'} · ${a.title ?? a.url}`);
    return lines.join('\n');
  }
  lines.push('| Fit | Due | Buyer | Solicitation | Quotes verified |', '|---|---|---|---|---|');
  for (const a of r.ranked) {
    lines.push(`| ${a.fit_score} | ${a.due_date ?? '?'} | ${a.buyer ?? ''} | [${a.title ?? a.url}](${a.url}) | ${a.evidence.length} (${a.dropped_quotes} dropped) |`);
  }
  const b = r.best;
  lines.push('', `## Best bid: ${b.title}`, `${b.buyer} · due ${b.due_date ?? 'see page'} · ${b.url}`, '');
  lines.push('**Why it fits**', ...(b.why_fit ?? []).map((w) => `- ${w}`), '', '**Gaps to close before bidding**', ...(b.gaps ?? []).map((g) => `- ${g}`), '');
  lines.push('**Evidence (verbatim from the solicitation)**', ...b.evidence.map((e) => `- ${e.claim}: "${e.quote}"`), '');
  lines.push('## Draft response', '', r.draft ?? '');
  return lines.join('\n');
}
