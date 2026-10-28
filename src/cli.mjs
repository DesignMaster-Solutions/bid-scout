#!/usr/bin/env node
// Usage: node src/cli.mjs --profile profiles/design-master-solutions.json [--max 6] [--today YYYY-MM-DD] [--json] [--record|--replay]
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { makeRunner } from './runner.mjs';
import { liveExec } from './clients.mjs';
import { scout, toBrief } from './scout.mjs';

const { values: a } = parseArgs({
  options: {
    profile: { type: 'string' }, max: { type: 'string', default: '6' }, today: { type: 'string' },
    record: { type: 'boolean' }, replay: { type: 'boolean' }, json: { type: 'boolean' }, fixtures: { type: 'string', default: 'fixtures' },
  },
});
if (!a.profile) {
  console.error('Required: --profile <file.json>');
  process.exit(2);
}
try {
  const profile = JSON.parse(await readFile(a.profile, 'utf8'));
  const run = makeRunner({
    mode: a.replay ? 'replay' : a.record ? 'record' : 'live', fixturesDir: a.fixtures, exec: liveExec(),
    log: (op) => process.stderr.write(`· ${op}\n`),
  });
  // Replay pins the date of the recording so the same bids stay "open".
  const today = a.today ?? (a.replay ? profile.recorded_on : undefined);
  const r = await scout({ profile, today, maxRead: Number(a.max) }, run);
  console.log(a.json ? JSON.stringify(r, null, 2) : toBrief(r));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
