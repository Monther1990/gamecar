// Writes src/data/scoring-fixtures.json from missions.json with plain arithmetic (independent of src/game/assessment.ts),
// so `npm test` checks the engine against the rules. Run after every change to missions.json: npm run fixtures
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = p => fileURLToPath(new URL('../' + p, import.meta.url));
const { missions, assessmentVersion } = JSON.parse(readFileSync(at('src/data/missions.json'), 'utf8'));
const config = JSON.parse(readFileSync(at('src/data/game-config.json'), 'utf8'));
const cps = missions.flatMap(m => m.checkpoints);
const all = cps.map(c => c.id);
const round1 = n => Math.round((n + Number.EPSILON) * 10) / 10;
const rate = config.recoveryCreditRate, threshold = config.passThresholdPercent;

function fixture(id, resolved, recovered) {
	const max = cps.reduce((n, c) => n + c.weight, 0);
	const earned = cps.reduce((n, c) => n + (!resolved.includes(c.id) ? 0 : recovered.includes(c.id) ? c.weight * rate : c.weight), 0);
	const completed = resolved.length === cps.length;
	const percent = earned / max * 100;
	const passed = completed && percent >= threshold;
	return { id, resolvedCheckpointIds: resolved, recoveredCheckpointIds: recovered, threshold, expected: {
		earnedPoints: round1(earned), maximumPoints: max, scorePercent: round1(percent), completionPercent: round1(resolved.length / cps.length * 100),
		completed, passed, status: !completed ? 'in_progress' : passed ? 'passed' : 'needs_practice' } };
}

const firstOfEach = missions.map(m => m.checkpoints[0].id);
const firstMission = missions[0].checkpoints.map(c => c.id);
const fixtures = [
	fixture('all-pristine', all, []),
	fixture('all-recovered', all, all),
	fixture('one-recovery-per-mission', all, firstOfEach),
	fixture('first-mission-only', firstMission, []),
	fixture('nothing-resolved', [], [])
];
writeFileSync(at('src/data/scoring-fixtures.json'), JSON.stringify({ assessmentVersion, fixtures }, null, 1) + '\n');
for (const f of fixtures) console.log(f.id.padEnd(26), f.expected.earnedPoints, '/', f.expected.maximumPoints, f.expected.status);
