// Mission director: panel models, gating, feedback, world screens and carried items. Pure logic, no rendering; the world
// and the UI read from it. All behaviour is driven by src/data/missions.json and content-ar.json.
import { activeCheckpoint, applyAction, isResolved, Run, shuffleForRun, uuid } from './assessment';
import { checkpoints, interactable, missionOf, missions, text, ui } from './data';

export type PropState = 'idle' | 'active' | 'incident' | 'resolved';
export interface Choice { actionId: string; labelAr: string }
export interface PanelModel {
	id: string; titleAr: string; evidenceAr: string[]; checkpointId: string; locked: boolean; resolved: boolean; noteAr: string;
	phone: Record<string, any> | null; choices: Choice[];
}
export interface Feedback {
	accepted: boolean; safe: boolean; recovered: boolean; missionComplete: boolean; missionId: string;
	titleAr: string; bodyAr: string; hintAr: string; worldEventAr: string; screenId: string;
}
export interface ScreenEvent { textAr: string; good: boolean }

export class Director {
	readonly inspected = new Set<string>();
	readonly inserted = new Set<string>();
	readonly screenEvents = new Map<string, ScreenEvent[]>();
	constructor(readonly run: Run, readonly propIds: string[]) {}

	private fill(s: string): string { return s.replaceAll('{displayName}', this.run.displayName); }
	private fillDeep(v: any): any {
		if (typeof v === 'string') return this.fill(v);
		if (Array.isArray(v)) return v.map(x => this.fillDeep(x));
		if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.fillDeep(x)]));
		return v;
	}
	checkpointOf(id: string): string { return interactable(id)?.checkpointId ?? ''; }

	panel(id: string): PanelModel {
		const c = interactable(id) ?? {};
		const m: PanelModel = { id, titleAr: c.titleAr ?? '', evidenceAr: (c.evidenceAr ?? []).map((l: string) => this.fill(l)),
			checkpointId: this.checkpointOf(id), locked: false, resolved: false, noteAr: '', phone: null, choices: [] };
		if (!m.checkpointId) return m;                                  // evidence-only prop, free to inspect any time
		m.resolved = isResolved(this.run.states[m.checkpointId]);
		if (m.resolved) { m.noteAr = c.resolvedAr ?? ''; return m; }
		if (activeCheckpoint(this.run)?.id !== m.checkpointId) {
			m.locked = true; m.evidenceAr = []; m.noteAr = c.lockedAr ?? ui('locked'); return m;   // later steps stay hidden
		}
		m.phone = c.phone ? this.fillDeep(c.phone) : null;
		m.choices = shuffleForRun((c.choices ?? []).map((x: Choice) => ({ actionId: x.actionId, labelAr: this.fill(x.labelAr) })),
			this.run.runId, m.checkpointId);
		return m;
	}

	choose(id: string, actionId: string): Feedback {
		const fb: Feedback = { accepted: false, safe: false, recovered: false, missionComplete: false, missionId: '', titleAr: '', bodyAr: '',
			hintAr: '', worldEventAr: '', screenId: '' };
		const p = this.panel(id);
		if (p.locked || p.resolved || !p.choices.some(c => c.actionId === actionId)) return fb;
		const cp = checkpoints.find(x => x.id === p.checkpointId)!;
		const r = applyAction(this.run, { eventId: uuid(), runId: this.run.runId, checkpointId: cp.id, actionId });
		if (!r.accepted) return fb;
		const c = interactable(id) ?? {};
		fb.accepted = true; fb.missionId = cp.missionId; fb.hintAr = cp.hintAr;
		if (r.reason === 'resolved') {
			fb.safe = true;
			fb.recovered = this.run.states[cp.id] === 'resolved_recovered';
			fb.titleAr = ui('feedback.correct');
			fb.bodyAr = (fb.recovered ? ui('feedback.recovered') + '\n' : '') + cp.feedbackAr;
			fb.missionComplete = this.missionComplete(cp.missionId);
			if (fb.missionComplete) fb.bodyAr += '\n' + text(`missionRewardsAr.${cp.missionId}`);
		} else {
			fb.titleAr = text('story.unsafeTitleAr');
			fb.bodyAr = this.fill(c.consequencesAr?.[actionId] ?? '') + '\n' + cp.feedbackAr;
		}
		const ev = c.worldEvents;
		if (ev?.screen && ev.eventsAr?.[actionId]) {
			fb.worldEventAr = ev.eventsAr[actionId];
			fb.screenId = ev.screen;
			const log = this.screenEvents.get(ev.screen) ?? [];
			log.unshift({ textAr: fb.worldEventAr, good: fb.safe });
			this.screenEvents.set(ev.screen, log.slice(0, 3));
		}
		return fb;
	}

	activeTarget(): string | null {
		const a = activeCheckpoint(this.run);
		return a ? this.propIds.find(id => this.checkpointOf(id) === a.id) ?? null : null;
	}
	missionComplete(missionId: string): boolean {
		const m = missions.find(x => x.id === missionId);
		return !!m && m.checkpoints.every(c => isResolved(this.run.states[c.id]));
	}
	completedMissions(): number { return missions.filter(m => this.missionComplete(m.id)).length; }

	propState(id: string): PropState {
		const cp = this.checkpointOf(id);
		const a = activeCheckpoint(this.run);
		if (cp) {
			const s = this.run.states[cp];
			return isResolved(s) ? 'resolved' : a?.id === cp ? (s === 'unsafe_seen' ? 'incident' : 'active') : 'idle';
		}
		const c = interactable(id);
		if (!c?.showsIncident) return 'idle';
		const mission = missionOf(id);
		if (this.missionComplete(mission)) return 'resolved';
		return !a || a.missionId === mission ? 'incident' : 'idle';
	}

	/** Carried items: a prop with "carryFrom" shows its InsertedMesh once that checkpoint is resolved (pick up, then deliver). */
	carryTarget(): string | null {
		for (const id of this.propIds) {
			const from = interactable(id)?.carryFrom;
			if (from && !this.inserted.has(id) && isResolved(this.run.states[from]) && !isResolved(this.run.states[this.checkpointOf(id)])) return id;
		}
		return null;
	}
	insertedVisible(id: string): boolean {
		return !!interactable(id)?.carryFrom && (this.inserted.has(id) || isResolved(this.run.states[this.checkpointOf(id)]));
	}

	hint(): string {
		const a = activeCheckpoint(this.run);
		if (!a) return '';
		const specific = text(`hintsAr.${a.id.replace('.', '_')}`);
		return specific ? specific + '\n' + a.hintAr : a.hintAr;
	}
	objective(): { titleAr: string; locationAr: string; stepAr: string; step: number; steps: number; missionId: string } | null {
		const a = activeCheckpoint(this.run);
		if (!a) return null;
		const m = missions.find(x => x.id === a.missionId)!;
		return { titleAr: m.titleAr, locationAr: m.locationAr, stepAr: a.labelAr, step: m.checkpoints.findIndex(c => c.id === a.id) + 1,
			steps: m.checkpoints.length, missionId: m.id };
	}
}
