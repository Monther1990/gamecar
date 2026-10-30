// The game specification (missions.json, game-config.json) and its Arabic text (content-ar.json, ui-ar.json).
import missionsJson from '../data/missions.json';
import configJson from '../data/game-config.json';
import contentJson from '../data/content-ar.json';
import uiJson from '../data/ui-ar.json';

export interface CheckpointDef {
	id: string; order: number; labelAr: string; weight: number;
	safeActionId: string; unsafeActionIds: string[]; feedbackAr: string; hintAr: string;
	missionId: string;
}
export interface MissionDef {
	id: string; order: number; titleAr: string; locationAr: string; maximumPoints: number; checkpoints: CheckpointDef[];
}

export const config = configJson as { gameId: string; assessmentVersion: string; avatarIds: string[]; passThresholdPercent: number;
	recoveryCreditRate: number; name: { minCodePoints: number; maxCodePoints: number } };
type RawMission = Omit<MissionDef, 'checkpoints'> & { checkpoints: Omit<CheckpointDef, 'missionId'>[] };
export const missions: MissionDef[] = (missionsJson as unknown as { missions: RawMission[] }).missions.map(m => ({
	...m, checkpoints: m.checkpoints.map(c => ({ ...c, missionId: m.id }))
}));
export const checkpoints: CheckpointDef[] = missions.flatMap(m => m.checkpoints);
export const content = contentJson as Record<string, any>;
const uiFlat = uiJson as Record<string, string>;

/** Interface text: content-ar.json "ui" keys (tutorial, intro, phone…) first, then ui-ar.json dotted keys. */
export function ui(key: string): string {
	return (content.ui && content.ui[key]) ?? uiFlat[key] ?? key;
}

/** A dotted path into content-ar.json (e.g. "story.allDoneAr", "missionRewardsAr.M1"). */
export function text(path: string): string {
	let v: any = content;
	for (const k of path.split('.')) v = v?.[k];
	return typeof v === 'string' ? v : '';
}

export function interactable(id: string): Record<string, any> | undefined {
	return content.interactables?.[id];
}

export function missionOf(id: string): string {
	const c = interactable(id);
	return c?.missionId ?? (c?.checkpointId ? String(c.checkpointId).split('.')[0] : '');
}
