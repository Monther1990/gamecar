// Race interface (Arabic, for children): HUD (shield pieces, golden shields, sound), the question card with the three
// lane answers laid out left to right exactly like the lanes, feedback banners, countdown, steering buttons, the garage
// and the results. Big type, few words, bright colours.
import './race.css';
import { ui } from '../game/data';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const nl = (s: string) => esc(s).replace(/\n/g, '<br>');
export const LANE_COLORS = ['#2f80ed', '#f2b632', '#9b51e0'];
export const LANE_LETTERS = ['ج', 'ب', 'أ'];            // Arabic reads from the right: the right lane is «أ»
const digits = (n: number | string) => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);

export interface ReviewRow { labelAr: string; state: string }

export class RaceUi {
	readonly el: HTMLElement;
	private hud: HTMLElement; private q: HTMLElement; private banner: HTMLElement; private toastEl: HTMLElement;
	private count: HTMLElement; private steerEl: HTMLElement; private speedEl: HTMLElement; private glitchEl: HTMLElement;
	private bottom: HTMLElement;
	private qSig = ''; private bannerT = 0; private toastT = 0;
	onSteer: (dir: -1 | 1) => void = () => {};
	onSound: (muted: boolean) => void = () => {};
	click: () => void = () => {};
	private muted = false;

	constructor(host: HTMLElement, private base: string, readonly touch: boolean) {
		this.el = document.createElement('div');
		this.el.className = 'rc-ui' + (touch ? ' touch' : '');
		this.el.dir = 'rtl';
		this.el.innerHTML = `
			<div class="rc-speed"></div><div class="rc-glitch"></div>
			<div class="rc-hud hidden" dir="ltr">
				<div class="rc-pieces"></div>
				<div class="rc-coins"><span class="rc-coin-ic">🛡️</span><b>٠</b></div>
				<button class="rc-icon" data-a="sound" aria-label="sound"><img src="${base}assets/ui/SoundOn.png" alt=""></button>
			</div>
			<div class="rc-q hidden"></div>
			<div class="rc-banner hidden"></div>
			<div class="rc-toast hidden"></div>
			<div class="rc-count hidden"></div>
			<div class="rc-steer hidden" dir="ltr">
				<button class="rc-btn" data-d="-1" aria-label="left">◀</button>
				<button class="rc-btn" data-d="1" aria-label="right">▶</button>
			</div>
			<div class="rc-rival hidden"></div>
			<div class="rc-bottom"></div>`;
		host.appendChild(this.el);
		const $ = (s: string) => this.el.querySelector(s) as HTMLElement;
		this.hud = $('.rc-hud'); this.q = $('.rc-q'); this.banner = $('.rc-banner'); this.toastEl = $('.rc-toast');
		this.count = $('.rc-count'); this.steerEl = $('.rc-steer'); this.speedEl = $('.rc-speed'); this.glitchEl = $('.rc-glitch');
		this.bottom = $('.rc-bottom');
		for (const b of this.el.querySelectorAll<HTMLButtonElement>('.rc-btn')) {
			b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); b.classList.add('on'); this.onSteer(Number(b.dataset.d) as -1 | 1); });
			for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => b.classList.remove('on'));
		}
		const snd = $('[data-a=sound]');
		snd.addEventListener('click', () => {
			this.muted = !this.muted;
			(snd.firstElementChild as HTMLImageElement).src = `${base}assets/ui/${this.muted ? 'SoundOff' : 'SoundOn'}.png`;
			this.onSound(this.muted);
		});
	}

	showHud(on: boolean) { this.hud.classList.toggle('hidden', !on); this.el.querySelector('.rc-rival')!.classList.toggle('hidden', !on); this.steerEl.classList.toggle('hidden', !on || !this.touch); }
	setPieces(done: number, total: number) {
		const el = this.hud.querySelector('.rc-pieces') as HTMLElement;
		const sig = done + '/' + total;
		if (el.dataset.sig === sig) return;
		el.dataset.sig = sig;
		el.innerHTML = `<span>${esc(ui('knowledge'))}</span>` + Array.from({ length: total }, (_, i) => `<i class="${i < done ? 'on' : ''}"></i>`).join('');
	}
	/** The race against the virus: gap > 0 means it is ahead by that many metres. */
	rival(gap: number) {
		const el = this.el.querySelector('.rc-rival') as HTMLElement;
		const m = Math.max(1, Math.round(Math.abs(gap) / 5) * 5);
		const text = gap > 2.5 ? ui('rivalAhead').replace('{m}', digits(m)) : gap < -2.5 ? ui('rivalBehind') : ui('rivalSide');
		if (el.textContent !== text) { el.textContent = text; el.classList.toggle('lead', gap < -2.5); }
	}
	setCoins(n: number) {
		const b = this.hud.querySelector('.rc-coins b') as HTMLElement;
		const t = digits(n);
		if (b.textContent !== t) { b.textContent = t; b.parentElement!.classList.remove('pop'); void b.parentElement!.offsetWidth; b.parentElement!.classList.add('pop'); }
	}

	/** The question: lanes[i] is the answer written over lane i (0 = left lane). */
	question(q: { icon: string; fromAr: string; promptAr: string; lanes: string[]; second: boolean } | null) {
		const sig = q ? q.promptAr + q.lanes.join('|') + q.second : '';
		if (sig === this.qSig) return;
		this.qSig = sig;
		this.q.classList.toggle('hidden', !q);
		if (!q) return;
		this.hideBanner();                                    // one card at a time on a small screen
		this.q.innerHTML = `
			${q.second ? `<div class="rc-second">${esc(ui('secondChance'))}</div>` : ''}
			<div class="rc-q-head"><span class="rc-q-icon">${esc(q.icon)}</span><b>${esc(q.fromAr)}</b></div>
			<p>${nl(q.promptAr)}</p>
			<div class="rc-q-title">${esc(ui('thinkTitle'))}</div>
			<div class="rc-lanes" dir="ltr">${q.lanes.map((l, i) => `<div class="rc-lane" style="--c:${LANE_COLORS[i]}"><em>${LANE_LETTERS[i]}</em><span dir="rtl">${esc(l)}</span></div>`).join('')}</div>`;
		this.q.classList.remove('in'); void this.q.offsetWidth; this.q.classList.add('in');
	}
	showBanner(kind: 'good' | 'bad', title: string, body: string, seconds = 5) {
		this.banner.className = `rc-banner ${kind}`;
		this.banner.innerHTML = `<b>${esc(title)}</b><p>${nl(body)}</p>`;
		clearTimeout(this.bannerT);
		this.bannerT = window.setTimeout(() => this.banner.classList.add('hidden'), seconds * 1000);
	}
	hideBanner() { this.banner.classList.add('hidden'); }
	toast(text: string, seconds = 2.5) {
		this.toastEl.className = 'rc-toast';
		this.toastEl.textContent = text;
		clearTimeout(this.toastT);
		this.toastT = window.setTimeout(() => this.toastEl.classList.add('hidden'), seconds * 1000);
	}
	countdown(text: string | null) {
		this.count.classList.toggle('hidden', !text);
		if (!text) return;
		this.count.textContent = text;
		this.count.classList.remove('beat'); void this.count.offsetWidth; this.count.classList.add('beat');
	}
	speed(on: boolean) { this.speedEl.classList.toggle('on', on); }
	glitch() { this.glitchEl.classList.remove('on'); void this.glitchEl.offsetWidth; this.glitchEl.classList.add('on'); }
	flashSteer(dir: -1 | 1) {
		const b = this.el.querySelector(`.rc-btn[data-d="${dir}"]`);
		b?.classList.add('on'); setTimeout(() => b?.classList.remove('on'), 140);
	}

	garage(colors: Record<string, string>, current: string, onPick: (name: string) => void, onGo: () => void) {
		this.bottom.innerHTML = `<div class="rc-garage"><h2>${esc(ui('garageTitle'))}</h2>
			<div class="rc-swatches" dir="ltr">${Object.entries(colors).map(([k, c]) => `<button class="rc-sw ${k === current ? 'on' : ''}" data-k="${k}" style="--c:${c}" aria-label="${k}"></button>`).join('')}</div>
			<button class="rc-go" data-a="go">${esc(ui('garageGo'))} 🏁</button></div>`;
		for (const b of this.bottom.querySelectorAll<HTMLButtonElement>('.rc-sw')) {
			b.addEventListener('click', () => {
				this.click();
				this.bottom.querySelectorAll('.rc-sw').forEach(x => x.classList.toggle('on', x === b));
				onPick(b.dataset.k!);
			});
		}
		this.bottom.querySelector('[data-a=go]')!.addEventListener('click', () => { this.click(); this.bottom.innerHTML = ''; onGo(); });
	}

	results(r: { earned: number; max: number; passed: boolean; stars: number; starReasons: { text: string; on: boolean }[]; coins: number; coinsTotal: number; seconds: number; review: ReviewRow[] },
		onAgain: () => void) {
		const pct = Math.round(r.earned / r.max * 100);
		const mins = Math.floor(r.seconds / 60), secs = String(Math.floor(r.seconds % 60)).padStart(2, '0');
		const rows = r.review.map(x => `<li class="${x.state}"><i>${x.state === 'resolved_pristine' ? '✓' : x.state === 'resolved_recovered' ? '↺' : '•'}</i>
			<span>${esc(x.labelAr)}</span><em>${esc(x.state === 'resolved_pristine' ? ui('safeFirst') : ui('recovered'))}</em></li>`).join('');
		this.bottom.innerHTML = `<div class="rc-results"><div class="rc-card">
			<img class="rc-mascot" src="${this.base}assets/ui/Cyber.png" alt="">
			<h1>${esc(ui('resultTitle'))}</h1>
			<div class="rc-score ${r.passed ? 'good' : 'warn'}" style="--p:${pct}">
				<div class="rc-ring"><b>${digits(Math.round(r.earned))}</b><small>/ ${digits(r.max)}</small></div>
				<div><span>${esc(ui('knowledge'))}</span><strong>${esc(r.passed ? ui('passed') : ui('practice'))}</strong></div>
			</div>
			<div class="rc-fun">
				<div><span>${esc(ui('stars'))}</span><b class="rc-stars">${[1, 2, 3].map(i => `<i class="${i <= r.stars ? 'on' : ''}">★</i>`).join('')}</b></div>
				<div><span>${esc(ui('shields'))}</span><b>${digits(r.coins)} / ${digits(r.coinsTotal)}</b></div>
				<div><span>${esc(ui('time'))}</span><b>${digits(mins)}:${digits(secs)}</b></div>
			</div>
			<ul class="rc-why">${r.starReasons.map(x => `<li class="${x.on ? 'on' : ''}"><i>★</i>${esc(x.text)}</li>`).join('')}</ul>
			<p class="rc-note">${esc(ui('starsNote'))}</p>
			<h3>${esc(ui('review'))}</h3><ul class="rc-review">${rows}</ul>
			<button class="rc-go" data-a="again">${esc(ui('again'))} 🏎️</button></div></div>`;
		this.bottom.querySelector('[data-a=again]')!.addEventListener('click', () => { this.click(); this.bottom.innerHTML = ''; onAgain(); });
	}
	clearBottom() { this.bottom.innerHTML = ''; }
}
