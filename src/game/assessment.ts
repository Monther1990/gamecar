// Assessment engine. Checkpoints are resolved in order; an unsafe action marks "unsafe_seen" and a later safe action earns
// the recovery rate. tests/assessment.test.mjs replays src/data/scoring-fixtures.json against it. Do not change the rules per
// game: the platform server recomputes results from the ledger with the same rules.
import { checkpoints, config, missions } from './data';

export type CheckpointState = 'unseen' | 'unsafe_seen' | 'resolved_pristine' | 'resolved_recovered';
export interface LedgerEntry { eventId: string; runId: string; checkpointId: string; actionId: string; outcome: CheckpointState; at: string }
export interface Run {
	runId: string; displayName: string; avatarId: string; variantId: string; passThresholdPercent: number; recoveryCreditRate: number;
	states: Record<string, CheckpointState>; accepted: Map<string, string>; ledger: LedgerEntry[]; completedAt: string | null;
}

const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/u;
export const isResolved = (s: CheckpointState | undefined) => s === 'resolved_pristine' || s === 'resolved_recovered';
const round1 = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10;

export function uuid(): string {
	if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
		const r = (globalThis.crypto ? globalThis.crypto.getRandomValues(new Uint8Array(1))[0] : Math.random() * 256) % 16;
		return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
	});
}

/** NFC, trimmed, 1..24 code points, no control or bidi-override characters; null when invalid. */
export function normalizeName(raw: string): string | null {
	if (typeof raw !== 'string' || FORBIDDEN.test(raw)) return null;
	const n = raw.normalize('NFC').trim();
	const len = [...n].length;
	return FORBIDDEN.test(n) || len < config.name.minCodePoints || len > config.name.maxCodePoints ? null : n;
}

export function createRun(displayName: string, avatarId: string, passThresholdPercent = config.passThresholdPercent): Run {
	const name = normalizeName(displayName);
	if (!name) throw new Error('invalid_name');
	if (!config.avatarIds.includes(avatarId)) throw new Error('invalid_avatar');
	return {
		runId: uuid(), displayName: name, avatarId, variantId: 'base', passThresholdPercent, recoveryCreditRate: config.recoveryCreditRate,
		states: Object.fromEntries(checkpoints.map(c => [c.id, 'unseen' as CheckpointState])), accepted: new Map(), ledger: [], completedAt: null
	};
}

export function activeCheckpoint(run: Run) {
	return checkpoints.find(c => !isResolved(run.states[c.id])) ?? null;
}

export type ActionReason = 'resolved' | 'unsafe_seen' | 'invalid_event' | 'wrong_run' | 'duplicate' | 'event_id_conflict' |
	'unknown_checkpoint' | 'unknown_action' | 'out_of_order';

export function applyAction(run: Run, event: { eventId: string; runId: string; checkpointId: string; actionId: string }):
	{ accepted: boolean; reason: ActionReason | 'resolved_already' } {
	const fields = ['eventId', 'runId', 'checkpointId', 'actionId'] as const;
	if (!event || fields.some(k => typeof event[k] !== 'string' || !event[k])) return { accepted: false, reason: 'invalid_event' };
	if (event.runId !== run.runId) return { accepted: false, reason: 'wrong_run' };
	const signature = JSON.stringify(fields.map(k => event[k]));
	const prior = run.accepted.get(event.eventId);
	if (prior) return { accepted: false, reason: prior === signature ? 'duplicate' : 'event_id_conflict' };
	const cp = checkpoints.find(c => c.id === event.checkpointId);
	if (!cp) return { accepted: false, reason: 'unknown_checkpoint' };
	const safe = event.actionId === cp.safeActionId;
	if (!safe && !cp.unsafeActionIds.includes(event.actionId)) return { accepted: false, reason: 'unknown_action' };
	if (isResolved(run.states[cp.id])) return { accepted: false, reason: 'resolved_already' };
	if (activeCheckpoint(run)?.id !== cp.id) return { accepted: false, reason: 'out_of_order' };
	const before = run.states[cp.id];
	run.states[cp.id] = safe ? (before === 'unsafe_seen' ? 'resolved_recovered' : 'resolved_pristine') : 'unsafe_seen';
	run.accepted.set(event.eventId, signature);
	run.ledger.push({ ...event, outcome: run.states[cp.id], at: new Date().toISOString() });
	if (checkpoints.every(c => isResolved(run.states[c.id]))) run.completedAt = new Date().toISOString();
	return { accepted: true, reason: safe ? 'resolved' : 'unsafe_seen' };
}

export function getResult(run: Run) {
	const checkpointResults = checkpoints.map(c => {
		const state = run.states[c.id];
		const earnedPoints = state === 'resolved_pristine' ? c.weight : state === 'resolved_recovered' ? c.weight * run.recoveryCreditRate : 0;
		return { checkpointId: c.id, state, earnedPoints, maximumPoints: c.weight };
	});
	const earnedPoints = checkpointResults.reduce((n, c) => n + c.earnedPoints, 0);
	const maximumPoints = checkpoints.reduce((n, c) => n + c.weight, 0);
	const resolved = checkpointResults.filter(c => isResolved(c.state)).length;
	const completed = resolved === checkpoints.length;
	const rawPercent = earnedPoints / maximumPoints * 100;
	const passed = completed && rawPercent >= run.passThresholdPercent;
	return {
		gameId: config.gameId, assessmentVersion: config.assessmentVersion, runId: run.runId, displayName: run.displayName,
		avatarId: run.avatarId, variantId: run.variantId, completedAt: run.completedAt, earnedPoints: round1(earnedPoints), maximumPoints,
		scorePercent: round1(rawPercent), completionPercent: round1(resolved / checkpoints.length * 100), completed, passed,
		status: !completed ? 'in_progress' : passed ? 'passed' : 'needs_practice', passThresholdPercent: run.passThresholdPercent,
		missionResults: missions.map(m => ({
			missionId: m.id, titleAr: m.titleAr, maximumPoints: m.maximumPoints,
			earnedPoints: round1(checkpointResults.filter(c => c.checkpointId.startsWith(`${m.id}.`)).reduce((n, c) => n + c.earnedPoints, 0))
		})),
		checkpointResults
	};
}
export type RunResult = ReturnType<typeof getResult>;

/** Stable per-run answer order so the safe answer is not always in the same place . */
export function shuffleForRun<T>(items: T[], runId: string, checkpointId: string): T[] {
	let h = 2166136261;
	for (const ch of runId + '|' + checkpointId) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
	const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
	for (let i = 0; i < 3; i++) rnd();
	const out = items.slice();
	for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
	return out;
}
