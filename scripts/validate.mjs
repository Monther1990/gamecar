// Checks the race content: missions.json ↔ content-ar.json (every checkpoint has a fork or a pit stop, lane labels for
// exactly its actions, short enough to read at speed) and the safety rules (fictional addresses only). Part of `npm run build`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = p => fileURLToPath(new URL('../' + p, import.meta.url));
const json = p => JSON.parse(readFileSync(at(p), 'utf8'));
const errors = [], warnings = [];
const { missions } = json('src/data/missions.json');
const content = json('src/data/content-ar.json');
const cps = missions.flatMap(m => m.checkpoints);
const total = cps.reduce((n, c) => n + c.weight, 0);
if (total !== 100) errors.push(`weights add up to ${total}, not 100`);
for (const m of missions) if (m.checkpoints.reduce((n, c) => n + c.weight, 0) !== m.maximumPoints) errors.push(`${m.id}: weights ≠ maximumPoints`);
for (const c of cps) {
	const d = content.checkpoints?.[c.id];
	const actions = [c.safeActionId, ...c.unsafeActionIds];
	if (!d) { errors.push(`${c.id}: no entry in content-ar.json checkpoints`); continue; }
	if (d.kind === 'fork') {
		if (actions.length !== 3) errors.push(`${c.id}: a road fork needs exactly 3 actions (3 lanes)`);
		for (const a of actions) if (!d.lanes?.[a]) errors.push(`${c.id}: lane label for "${a}" missing`);
		for (const a of Object.keys(d.lanes ?? {})) if (!actions.includes(a)) errors.push(`${c.id}: lane "${a}" is not an action`);
		for (const [a, l] of Object.entries(d.lanes ?? {})) if ([...l].length > 26) warnings.push(`${c.id}: lane "${a}" is long to read while driving`);
		if (!d.promptAr || !d.icon || !d.fromAr) errors.push(`${c.id}: icon, fromAr and promptAr are required`);
		for (const a of c.unsafeActionIds) if (!d.consequencesAr?.[a]) warnings.push(`${c.id}: consequence for "${a}" missing`);
	} else if (d.kind === 'pit') {
		const ch = (d.panel?.choices ?? []).map(x => x.actionId);
		for (const a of actions) if (!ch.includes(a)) errors.push(`${c.id}: pit choice for "${a}" missing`);
		for (const a of ch) if (!actions.includes(a)) errors.push(`${c.id}: pit choice "${a}" is not an action`);
		const ph = d.panel?.phone;
		if (ph?.inspect && ph.inspect.parts.join('') !== ph.fromAddress) errors.push(`${c.id}: inspect.parts must join to fromAddress`);
		for (const k of ['linkActionId', 'attachmentActionId']) if (ph?.[k] && !ch.includes(ph[k])) errors.push(`${c.id}: phone.${k} is not a choice`);
	} else errors.push(`${c.id}: kind must be "fork" or "pit"`);
}
const texts = [];
const walk = (v, p) => { if (typeof v === 'string') texts.push([p, v]); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`); };
walk(content, 'content'); walk(missions, 'missions');
for (const [p, s] of texts) {
	if (/https?:\/\/|www\./i.test(s)) errors.push(`${p}: real-looking link`);
	for (const host of s.match(/\b[a-z0-9-]+(\.[a-z0-9-]+)+\b/gi) ?? [])
		if (/^[a-z]{2,}$/i.test(host.split('.').pop()) && !/\.(internal|example|test|invalid)$/i.test(host) && !/\.(png|mp3|zip|apk|pdf|exe|json|ts|md)$/i.test(host))
			errors.push(`${p}: address "${host}" is not fictional (end it with .internal)`);
}
for (const w of warnings) console.log('  warn ', w);
for (const e of errors) console.log('  ERROR', e);
console.log(`validate: ${cps.length} checkpoints, ${errors.length} errors, ${warnings.length} warnings`);
if (errors.length) process.exit(1);
