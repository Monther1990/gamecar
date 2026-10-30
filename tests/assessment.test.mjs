// The scoring engine must match the rules: bundle src/game/assessment.ts with esbuild (shipped with Vite), then replay
// src/data/scoring-fixtures.json (npm run fixtures) for both avatars.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = join(here, '.build', 'assessment.mjs');
mkdirSync(join(here, '.build'), { recursive: true });
buildSync({ entryPoints: [join(here, '../src/game/assessment.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const A = await import(pathToFileURL(out).href);
const fixtures = JSON.parse(readFileSync(join(here, '../src/data/scoring-fixtures.json'), 'utf8')).fixtures;
const missions = JSON.parse(readFileSync(join(here, '../src/data/missions.json'), 'utf8')).missions;
const cps = missions.flatMap(m => m.checkpoints);

for (const fx of fixtures) {
	for (const avatar of ['male', 'female']) {
		test(`${fx.id} / ${avatar}`, () => {
			const run = A.createRun('لاعب', avatar, fx.threshold);
			for (const id of fx.resolvedCheckpointIds) {
				const cp = cps.find(c => c.id === id);
				if (fx.recoveredCheckpointIds.includes(id))
					assert.equal(A.applyAction(run, { eventId: A.uuid(), runId: run.runId, checkpointId: id, actionId: cp.unsafeActionIds[0] }).accepted, true);
				assert.equal(A.applyAction(run, { eventId: A.uuid(), runId: run.runId, checkpointId: id, actionId: cp.safeActionId }).accepted, true);
			}
			const r = A.getResult(run);
			for (const [k, v] of Object.entries(fx.expected)) assert.equal(r[k], v, k);
		});
	}
}

test('out-of-order and duplicate events are refused', () => {
	const run = A.createRun('لاعب', 'male');
	const later = cps[1];
	assert.equal(A.applyAction(run, { eventId: A.uuid(), runId: run.runId, checkpointId: later.id, actionId: later.safeActionId }).reason, 'out_of_order');
	const ev = { eventId: A.uuid(), runId: run.runId, checkpointId: cps[0].id, actionId: cps[0].safeActionId };
	assert.equal(A.applyAction(run, ev).accepted, true);
	assert.equal(A.applyAction(run, ev).reason, 'duplicate');
});
