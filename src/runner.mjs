// Record/replay around every external call, so judges can reproduce the demo without keys.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const fixtureKey = (op, input) =>
  `${op}-${createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 12)}.json`;

// mode: 'live' calls the APIs, 'record' calls and saves, 'replay' reads saved responses only.
export function makeRunner({ mode = 'live', fixturesDir = 'fixtures', exec, log = () => {} } = {}) {
  return async function run(op, input) {
    const file = path.join(fixturesDir, fixtureKey(op, input));
    log(op);
    if (mode === 'replay') {
      try { return JSON.parse(await readFile(file, 'utf8')); } catch {
        throw new Error(`No recorded response for ${op} (${file}). Run with --record and keys.`);
      }
    }
    const res = await exec(op, input);
    if (mode === 'record') {
      await mkdir(fixturesDir, { recursive: true });
      await writeFile(file, JSON.stringify(res, null, 2));
    }
    return res;
  };
}
