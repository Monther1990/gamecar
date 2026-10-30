// Entry point. Two ways to use the game on the platform:
//  1) iframe (recommended): host the built folder and point an <iframe> at index.html?parentOrigin=<platform origin>.
//     Progress and the finished result are posted to that exact origin only (never "*").
//  2) direct: import { mountGame } and mount it into an element of the React page.
import './ui/style.css';
import { RaceGame, RaceOptions } from './race/race';
import { config } from './game/data';

export interface MountOptions extends Partial<RaceOptions> {}

export function mountGame(container: HTMLElement, options: MountOptions = {}) {
	const base = options.base ?? new URL('./', document.baseURI).href;
	const game = new RaceGame(container, { base, onComplete: options.onComplete, onEvent: options.onEvent });
	void game.start();
	if (import.meta.env.DEV) (window as any).__race = game;   // dev-server inspection only
	return { destroy: () => game.dispose() };
}

// Standalone page (index.html): mount into #game and report to the embedding page when one is configured.
const el = document.getElementById('game');
if (el) {
	const params = new URLSearchParams(location.search);
	const parentOrigin = params.get('parentOrigin');
	const toParent = (type: string, data: unknown) => {
		if (parentOrigin && window.parent !== window) window.parent.postMessage({ type, protocolVersion: 1, gameId: config.gameId, data }, parentOrigin);
	};
	const handle = mountGame(el, {
		onComplete: payload => toParent('game.completed', payload),
		onEvent: (type, data) => toParent(type, data)
	});
	// Development only: ?demo=<garage|intro|race|gate|pit|results>&to=<metres> jumps to a moment for screenshots.
	if (import.meta.env.DEV && params.has('demo')) void import('./race/demo').then(m => m.runDemo((window as any).__race, params, handle));
}
