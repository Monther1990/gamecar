// Development only (imported by main.ts when ?demo= is present on the dev server): drives the game to a given moment
// with fixed time steps so a headless browser can take a screenshot. Never part of the production build's behaviour.
export async function runDemo(g: any, params: URLSearchParams, _handle: unknown) {
	const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
	// headless Chrome windows are at least ~500 px wide: frame the game at phone width (?w=390) on the left
	const w = params.get('w');
	if (w) { const el = document.getElementById('game')!; el.style.width = w + 'px'; el.style.right = 'auto'; document.body.style.background = '#222'; }
	while (!g.track || g.mode !== 'entry') await wait(100);
	if (w) g.engine.resize();
	if (params.get('touch')) { g.hud.touch = true; g.hud.el.classList.add('touch'); g.host.classList.add('touch'); }
	const step = (n: number, dt = 1 / 30) => { for (let i = 0; i < n; i++) g.tick(dt); };
	const which = params.get('demo')!;
	const avatar = (params.get('avatar') ?? 'female') as 'male' | 'female';
	(document.querySelector('.ath-input') as HTMLInputElement).value = 'ريم';
	(document.querySelector(`.ath-avatar[data-v=${avatar}]`) as HTMLButtonElement).click();
	(document.querySelector('[data-a=start]') as HTMLButtonElement).click();
	if (params.get('color')) g.player.color = params.get('color');
	g.showGarage();
	if (which === 'garage') { step(40); freeze(g); return; }
	(document.querySelector('[data-a=go]') as HTMLButtonElement).click();
	if (which === 'intro') { const k = Number(params.get('shot') ?? 0); for (let i = 0; i < k; i++) g.nextShot(); step(80); freeze(g); return; }
	g.ui.closeModal();
	g.countdown();
	if (which === 'countdown') { step(20); freeze(g); return; }
	step(110);
	const to = Number(params.get('to') ?? 60);
	const lanes = (params.get('lanes') ?? '').split(',');                       // per gate: S = safe lane, U = an unsafe lane
	let gate = 0;
	for (let i = 0; i < 20000 && g.s < to && g.mode !== 'results'; i++) {
		if (g.ev?.kind === 'gate' && g.ev.s - g.s < 40) {
			const safeLane = g.ev.lanes.indexOf(g.ev.cp.safeActionId);
			g.lane = lanes[gate] === 'U' ? (safeLane + 1) % 3 : safeLane;
		}
		const before = g.ev;
		step(1);
		if (before?.kind === 'gate' && g.ev !== before) gate++;
		if (g.mode === 'pit') {
			if (which === 'pit') { step(10); freeze(g); return; }
			const safe = g.ev.cp.safeActionId;
			g.pitChoose(g.ev, safe); (document.querySelector('[data-a=go]') as HTMLButtonElement)?.click();
		}
		if (which === 'gate' && g.ev?.kind === 'gate' && g.ev.s - g.s < Number(params.get('ahead') ?? 55)) break;
	}
	if (which === 'results') { while (g.mode !== 'results') { step(1); if (g.mode === 'pit') { g.pitChoose(g.ev, g.ev.cp.safeActionId); (document.querySelector('[data-a=go]') as HTMLButtonElement)?.click(); } if (g.ev?.kind === 'gate') g.lane = g.ev.lanes.indexOf(g.ev.cp.safeActionId); } }
	step(Number(params.get('extra') ?? 2));
	freeze(g);
}
function freeze(g: any) { g.tick = () => {}; (window as any).__demoReady = true; document.title = 'READY'; }
