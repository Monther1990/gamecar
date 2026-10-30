// DOM interface (Arabic, right to left), designed for students and children: big type,
// big buttons, white cards with bright accents, few words per card, icons. All text comes from the content files.
import { ui } from '../game/data';
import type { Feedback, PanelModel } from '../game/director';
import type { RunResult } from '../game/assessment';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const nl = (s: string) => esc(s).replace(/\n/g, '<br>');
const LETTERS = ['أ', 'ب', 'ج', 'د'];
const fmt = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
const arabicDigits = (n: number) => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);

export interface PanelHandlers {
	onChoose(actionId: string): void;
	onClose(): void;
	officialSeen: boolean;
	playVoice?(names: string[]): void;
}

export class Ui {
	readonly root: HTMLElement;
	private layer: HTMLElement;          // modal layer
	private hud: HTMLElement;
	private prompt: HTMLElement;
	private toastEl: HTMLElement;
	private tutEl: HTMLElement;
	private bubble: HTMLElement;
	private toastTimer = 0;
	private last = { prompt: '', tut: '', speech: '' };
	onHint: () => void = () => {};
	onSound: (muted: boolean) => void = () => {};
	click: () => void = () => {};
	private muted = false;

	constructor(host: HTMLElement, private base: string) {
		this.root = document.createElement('div');
		this.root.className = 'ath-ui';
		this.root.dir = 'rtl';
		this.root.innerHTML = `
			<div class="ath-hud hidden">
				<div class="ath-mission"></div>
				<div class="ath-tools">
					<button class="ath-icon" data-a="hint" aria-label="${esc(ui('controls.hint'))}"><img src="${base}assets/ui/Hint.png" alt=""></button>
					<button class="ath-icon" data-a="sound" aria-label="sound"><img src="${base}assets/ui/SoundOn.png" alt=""></button>
				</div>
			</div>
			<div class="ath-prompt hidden"></div>
			<div class="ath-tut hidden"></div>
			<div class="ath-toast hidden"></div>
			<div class="ath-bubble hidden"></div>
			<div class="ath-layer"></div>`;
		host.appendChild(this.root);
		// A mission without its own icon (assets/ui/Mission_<id>.png) shows the shield instead of a broken image.
		this.root.addEventListener('error', e => {
			const img = e.target as HTMLImageElement;
			if (img?.tagName === 'IMG' && !img.dataset.fallback) { img.dataset.fallback = '1'; img.src = `${base}assets/ui/ShieldFilled.png`; }
		}, true);
		this.hud = this.root.querySelector('.ath-hud')!;
		this.prompt = this.root.querySelector('.ath-prompt')!;
		this.toastEl = this.root.querySelector('.ath-toast')!;
		this.tutEl = this.root.querySelector('.ath-tut')!;
		this.bubble = this.root.querySelector('.ath-bubble')!;
		this.layer = this.root.querySelector('.ath-layer')!;
		this.hud.querySelector('[data-a=hint]')!.addEventListener('click', () => { this.click(); this.onHint(); });
		const snd = this.hud.querySelector('[data-a=sound]') as HTMLButtonElement;
		snd.addEventListener('click', () => {
			this.muted = !this.muted;
			(snd.firstElementChild as HTMLImageElement).src = `${base}assets/ui/${this.muted ? 'SoundOff' : 'SoundOn'}.png`;
			this.onSound(this.muted);
		});
	}

	get modalOpen() { return this.layer.childElementCount > 0; }
	private modal(html: string, cls = '') {
		this.layer.innerHTML = `<div class="ath-modal ${cls}"><div class="ath-card">${html}</div></div>`;
		const card = this.layer.querySelector('.ath-card') as HTMLElement;
		requestAnimationFrame(() => this.layer.firstElementChild?.classList.add('in'));
		return card;
	}
	closeModal() { this.layer.innerHTML = ''; }

	// ---------------------------------------------------------------- loading and entry
	loading(p: number) {
		if (!this.layer.querySelector('.ath-loading')) {
			this.modal(`<div class="ath-loading"><img class="ath-mascot" src="${this.base}assets/ui/Cyber.png" alt="">
				<h1>${esc(ui('app.title'))}</h1><div class="ath-bar"><i></i></div></div>`, 'full');
		}
		(this.layer.querySelector('.ath-bar i') as HTMLElement).style.width = `${Math.round(p * 100)}%`;
	}

	entry(onStart: (name: string, avatar: 'male' | 'female') => void, validate: (s: string) => string | null) {
		// The platform passes the logged-in student's name (?playerName=); the name field is then skipped.
		const given = validate(new URLSearchParams(location.search).get('playerName') ?? '');
		const card = this.modal(`
			<img class="ath-mascot" src="${this.base}assets/ui/Cyber.png" alt="">
			<h1>${esc(ui('app.title'))}</h1>
			${given ? `<p class="ath-label">مرحبًا، ${esc(given)}</p>` : `<p class="ath-soft">${esc(ui('privacy.nickname'))}</p>`}
			<label class="ath-label${given ? ' hidden' : ''}">${esc(ui('entry.nameLabel'))}
				<input class="ath-input" maxlength="40" autocomplete="off" placeholder="${esc(ui('entry.namePlaceholder'))}" value="${esc(given ?? '')}"></label>
			<p class="ath-error hidden">${esc(ui('entry.nameError'))}</p>
			<div class="ath-label">${esc(ui('entry.avatarLabel'))}</div>
			<div class="ath-avatars">
				<button class="ath-avatar" data-v="male"><img src="${this.base}assets/ui/Portrait_Male.png" alt=""><b>${esc(ui('entry.male'))}</b></button>
				<button class="ath-avatar" data-v="female"><img src="${this.base}assets/ui/Portrait_Female.png" alt=""><b>${esc(ui('entry.female'))}</b></button>
			</div>
			<p class="ath-error hidden" data-e="avatar">${esc(ui('entry.avatarLabel'))}</p>
			<button class="ath-btn primary big" data-a="start">${esc(ui('entry.start'))}</button>`, 'full');
		let avatar: 'male' | 'female' | null = null;
		for (const b of card.querySelectorAll<HTMLButtonElement>('.ath-avatar')) {
			b.addEventListener('click', () => {
				this.click();
				avatar = b.dataset.v as 'male' | 'female';
				card.querySelectorAll('.ath-avatar').forEach(x => x.classList.toggle('on', x === b));
				card.querySelector('[data-e=avatar]')!.classList.add('hidden');
			});
		}
		const input = card.querySelector('input')!;
		card.querySelector('[data-a=start]')!.addEventListener('click', () => {
			const name = validate(input.value);
			card.querySelector('.ath-error')!.classList.toggle('hidden', !!name);
			card.querySelector('[data-e=avatar]')!.classList.toggle('hidden', !!avatar);
			if (name && avatar) { input.blur(); onStart(name, avatar); }
		});
	}

	// ---------------------------------------------------------------- HUD
	showHud(on: boolean) { this.hud.classList.toggle('hidden', !on); }
	setMission(o: { titleAr: string; locationAr: string; stepAr: string; step: number; steps: number; missionId: string } | null, done: number, total: number) {
		const el = this.hud.querySelector('.ath-mission') as HTMLElement;
		const shield = Array.from({ length: total }, (_, i) => i).map(i => `<i class="${i < done ? 'on' : ''}"></i>`).join('');
		el.innerHTML = o ? `
			<img src="${this.base}assets/ui/Mission_${o.missionId}.png" alt="">
			<div><b>${esc(o.titleAr)}</b><span>${esc(o.stepAr)}</span><em>${o.step} / ${o.steps}</em></div>
			<div class="ath-shield" title="">${shield}</div>` : `<div><b>${esc(ui('result.title'))}</b></div><div class="ath-shield">${shield}</div>`;
	}
	setPrompt(title: string | null, key: string) {
		const sig = title ? key + '|' + title : '';
		if (sig === this.last.prompt) return;
		this.last.prompt = sig;
		this.prompt.classList.toggle('hidden', !title);
		if (title) this.prompt.innerHTML = `<kbd>${esc(key)}</kbd><span>${esc(title)}</span>`;
	}
	toast(textAr: string, kind: 'good' | 'warn' | 'info' = 'info', seconds = 3.5) {
		this.toastEl.className = `ath-toast ${kind}`;
		this.toastEl.innerHTML = nl(textAr);
		clearTimeout(this.toastTimer);
		this.toastTimer = window.setTimeout(() => this.toastEl.classList.add('hidden'), seconds * 1000);
	}
	tutorial(textAr: string | null, step = 0, of = 3, onSkip?: () => void) {
		const sig = textAr ? textAr + '|' + step : '';
		if (sig === this.last.tut) return;
		this.last.tut = sig;
		this.tutEl.classList.toggle('hidden', !textAr);
		if (!textAr) return;
		const dots = Array.from({ length: of }, (_, i) => `<i class="${i < step ? 'on' : ''}"></i>`).join('');
		this.tutEl.innerHTML = `<div class="ath-dots">${dots}</div><b>${esc(textAr)}</b><button class="ath-link">${esc(ui('tutSkip'))}</button>`;
		this.tutEl.querySelector('button')!.addEventListener('click', () => { this.click(); onSkip?.(); });
	}
	speech(name: string | null, textAr = '', x = 0, y = 0) {
		this.bubble.classList.toggle('hidden', !name);
		if (!name) return;
		if (this.last.speech !== name + textAr) { this.last.speech = name + textAr; this.bubble.innerHTML = `<b>${esc(name)}</b>${nl(textAr)}`; }
		this.bubble.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(50%, -100%)`;
	}

	// ---------------------------------------------------------------- intro tour (Cyber speaks)
	intro(textAr: string, index: number, total: number, onNext: () => void, onSkip: () => void) {
		this.layer.innerHTML = `<div class="ath-intro in"><div class="ath-card">
			<img class="ath-mascot small" src="${this.base}assets/ui/Cyber.png" alt="">
			<div class="ath-intro-text"><b class="ath-name">${esc(ui('introName'))}</b><p>${nl(textAr)}</p>
			<div class="ath-row"><div class="ath-dots">${Array.from({ length: total }, (_, i) => `<i class="${i <= index ? 'on' : ''}"></i>`).join('')}</div>
			<span class="ath-grow"></span><button class="ath-btn" data-a="skip">${esc(ui('tutSkip'))}</button>
			<button class="ath-btn primary" data-a="next">${esc(ui(index === total - 1 ? 'introStart' : 'introNext'))}</button></div></div></div></div>`;
		this.layer.querySelector('[data-a=next]')!.addEventListener('click', () => { this.click(); onNext(); });
		this.layer.querySelector('[data-a=skip]')!.addEventListener('click', () => { this.click(); onSkip(); });
	}
	introMarks(marks: { x: number; y: number; n: number; icon: string }[]) {
		let box = this.root.querySelector('.ath-marks') as HTMLElement | null;
		if (!box) { box = document.createElement('div'); box.className = 'ath-marks'; this.root.insertBefore(box, this.layer); }
		box.innerHTML = marks.map(m => `<div class="ath-mark" style="transform:translate(${Math.round(m.x)}px,${Math.round(m.y)}px)">
			<b>${arabicDigits(m.n)}</b><img src="${this.base}assets/ui/${m.icon}.png" alt=""></div>`).join('');
	}

	// ---------------------------------------------------------------- props and the phone
	panel(m: PanelModel, h: PanelHandlers) {
		const choices = m.choices.length ? `<h3>${esc(ui('choose'))}</h3><div class="ath-choices">${m.choices.map((c, i) =>
			`<button class="ath-choice" data-id="${esc(c.actionId)}"><span>${LETTERS[i]}</span>${esc(c.labelAr)}</button>`).join('')}</div>` : '';
		const evidence = m.evidenceAr.length && !m.phone ? `<ul class="ath-evidence">${m.evidenceAr.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '';
		const note = m.noteAr ? `<p class="ath-note ${m.locked ? 'lock' : 'done'}">${nl(m.noteAr)}</p>` : '';
		const body = m.phone ? this.phoneHtml(m.phone) : '';
		const card = this.modal(`
			<button class="ath-close" aria-label="${esc(ui('back'))}">✕</button>
			<h2>${esc(m.titleAr)}</h2>${note}${body}${evidence}${choices}
			${m.choices.length ? '' : `<button class="ath-btn primary big" data-a="ok">${esc(ui('ok'))}</button>`}`, m.phone ? 'phone' : '');
		const close = () => { this.click(); h.onClose(); };
		card.querySelector('.ath-close')!.addEventListener('click', close);
		card.querySelector('[data-a=ok]')?.addEventListener('click', close);
		for (const b of card.querySelectorAll<HTMLButtonElement>('.ath-choice')) {
			b.addEventListener('click', () => { this.click(); card.querySelectorAll('button').forEach(x => (x as HTMLButtonElement).disabled = true); h.onChoose(b.dataset.id!); });
		}
		if (m.phone) this.wirePhone(card, m.phone, h);
	}

	private phoneHtml(p: Record<string, any>): string {
		const head = `<div class="ath-phone-top"><span>${esc(p.appAr ?? '')}</span><span>${esc(p.time ?? '')}</span></div>`;
		if (p.app === 'call') {
			return `<div class="ath-phone call">${head}
				<div class="ath-call-in"><div class="ath-avatar-circle">☎</div><b>${esc(p.fromAr)}</b><span>${esc(p.fromSubAr ?? '')}</span>
				<button class="ath-btn good big" data-a="answer">${esc(ui('phoneAnswer'))}</button></div>
				<div class="ath-call-on hidden"><div class="ath-count">${esc(p.countdownAr ?? '')} <b>4:59</b></div>
				<div class="ath-lines"></div>${(p.notesAr ?? []).map((n: string) => `<p class="ath-note">${esc(n)}</p>`).join('')}</div></div>`;
		}
		const rows = (p.rowsAr ?? []).map((r: string) => `<li>${esc(r)}</li>`).join('');
		const notes = (p.notesAr ?? []).map((n: string) => `<p class="ath-note">${esc(n)}</p>`).join('');
		const addr = p.fromAddress ? `<button class="ath-addr" data-a="inspect">${esc(p.fromAddress)} 🔍</button>` : '';
		const link = p.link ? `<button class="ath-linkbtn" data-a="link">🔗 ${esc(p.link)}</button>` : '';
		const att = p.attachment ? `<button class="ath-linkbtn" data-a="attach">📎 ${esc(p.attachment)}</button>` : '';
		return `<div class="ath-phone">${head}<div class="ath-msg">
			${p.fromAr ? `<div class="ath-from"><b>${esc(p.fromAr)}</b>${addr}</div>` : ''}
			${p.logoAr ? `<div class="ath-logo">${esc(p.logoAr)}</div>` : ''}
			<p>${nl(p.bodyAr ?? '')}</p>${rows ? `<ul>${rows}</ul>` : ''}${link}${att}</div>${notes}
			<div class="ath-inspect hidden"></div></div>`;
	}

	private wirePhone(card: HTMLElement, p: Record<string, any>, h: PanelHandlers) {
		const confirmAction = (question: string, actionId: string) => {
			const box = document.createElement('div');
			box.className = 'ath-confirm';
			box.innerHTML = `<p>${esc(question)}</p><div class="ath-row"><button class="ath-btn" data-a="no">${esc(ui('phoneCancel'))}</button>
				<button class="ath-btn warn" data-a="yes">${esc(ui('phoneOpen'))}</button></div>`;
			card.appendChild(box);
			box.querySelector('[data-a=no]')!.addEventListener('click', () => { this.click(); box.remove(); });
			box.querySelector('[data-a=yes]')!.addEventListener('click', () => { this.click(); box.remove(); h.onChoose(actionId); });
		};
		card.querySelector('[data-a=link]')?.addEventListener('click', () => p.linkActionId && confirmAction(p.linkConfirmAr ?? '', p.linkActionId));
		card.querySelector('[data-a=attach]')?.addEventListener('click', () => p.attachmentActionId && confirmAction(p.attachmentConfirmAr ?? '', p.attachmentActionId));
		const insp = p.inspect;
		card.querySelector('[data-a=inspect]')?.addEventListener('click', () => {
			this.click();
			const box = card.querySelector('.ath-inspect') as HTMLElement;
			box.classList.remove('hidden');
			if (!insp) { box.innerHTML = `<p>${esc(ui('phoneSender'))}: ${esc(p.fromAddress)}</p>`; return; }
			if (!h.officialSeen) { box.innerHTML = `<p class="ath-note lock">${esc(insp.needOfficialAr)}</p>`; return; }
			box.innerHTML = `<p>${esc(insp.promptAr)}</p>
				<div class="ath-parts" dir="ltr">${insp.parts.map((s: string, i: number) => `<button data-i="${i}">${esc(s)}</button>`).join('')}</div>
				<div class="ath-parts official" dir="ltr">${insp.officialParts.map((s: string) => `<span>${esc(s)}</span>`).join('')}</div>
				<p class="ath-inspect-out"></p>`;
			for (const b of box.querySelectorAll<HTMLButtonElement>('.ath-parts button')) {
				b.addEventListener('click', () => {
					const ok = Number(b.dataset.i) === insp.suspiciousPart;
					b.classList.add(ok ? 'good' : 'bad');
					const out = box.querySelector('.ath-inspect-out') as HTMLElement;
					out.className = 'ath-inspect-out ' + (ok ? 'good' : 'bad');
					out.textContent = ok ? insp.foundAr : insp.wrongAr;
				});
			}
		});
		if (p.app === 'call') {
			const choices = card.querySelector('.ath-choices') as HTMLElement | null;
			choices?.parentElement?.querySelector('h3')?.classList.add('hidden');
			choices?.classList.add('hidden');
			card.querySelector('[data-a=answer]')!.addEventListener('click', () => {
				this.click();
				card.querySelector('.ath-call-in')!.classList.add('hidden');
				card.querySelector('.ath-call-on')!.classList.remove('hidden');
				const lines = card.querySelector('.ath-lines') as HTMLElement;
				(p.linesAr as string[]).forEach((l, i) => setTimeout(() => {
					lines.insertAdjacentHTML('beforeend', `<p class="ath-line">${esc(l)}</p>`);
					if (i === p.linesAr.length - 1) {
						choices?.classList.remove('hidden');
						choices?.parentElement?.querySelector('h3')?.classList.remove('hidden');
					}
				}, 300 + i * 2600));
				h.playVoice?.(p.voice ?? []);
				let left = Number(p.countdownSec ?? 299);
				const count = card.querySelector('.ath-count b') as HTMLElement;
				const t = setInterval(() => {
					if (!card.isConnected) { clearInterval(t); return; }
					left = Math.max(0, left - 1);
					count.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
				}, 1000);
			});
		}
	}

	feedback(fb: Feedback, onContinue: () => void) {
		const card = this.modal(`
			<div class="ath-fb ${fb.safe ? 'good' : 'warn'}"><img src="${this.base}assets/ui/${fb.safe ? 'Check' : 'Warning'}.png" alt=""></div>
			<h2>${esc(fb.titleAr)}</h2>
			<p class="ath-body">${nl(fb.bodyAr.trim())}</p>
			${fb.worldEventAr ? `<p class="ath-world ${fb.safe ? 'good' : 'warn'}">📺 ${esc(fb.worldEventAr)}</p>` : ''}
			<button class="ath-btn primary big" data-a="go">${esc(ui('continue'))}</button>`, 'feedback');
		card.querySelector('[data-a=go]')!.addEventListener('click', () => { this.click(); onContinue(); });
	}

	hint(textAr: string) {
		const card = this.modal(`<img class="ath-mascot small" src="${this.base}assets/ui/Cyber.png" alt="">
			<h2>${esc(ui('controls.hint'))}</h2><p class="ath-body">${nl(textAr)}</p>
			<button class="ath-btn primary big" data-a="ok">${esc(ui('ok'))}</button>`);
		card.querySelector('[data-a=ok]')!.addEventListener('click', () => { this.click(); this.closeModal(); });
	}

	results(r: RunResult, onReplay: () => void) {
		const v = { earnedPoints: r.earnedPoints, maximumPoints: r.maximumPoints, scorePercent: r.scorePercent, passThresholdPercent: r.passThresholdPercent };
		const status = r.passed ? ui('result.passed') : r.completed ? ui('result.needsPractice') : ui('result.incomplete');
		const rows = r.missionResults.map(m => `<li><img src="${this.base}assets/ui/Mission_${m.missionId}.png" alt=""><span>${esc(m.titleAr)}</span>
			<b>${m.earnedPoints} / ${m.maximumPoints}</b></li>`).join('');
		const card = this.modal(`
			<img class="ath-mascot" src="${this.base}assets/ui/Cyber.png" alt="">
			<h1>${esc(ui('result.title'))}</h1>
			<div class="ath-score ${r.passed ? 'good' : 'warn'}"><b>${esc(fmt(ui('result.points'), v))}</b><span>${esc(status)}</span></div>
			<p class="ath-soft">${esc(fmt(ui('result.percent'), v))} · ${esc(fmt(ui('result.threshold'), v))}</p>
			<ul class="ath-results">${rows}</ul>
			<p class="ath-soft">${esc(ui('result.educationalNote'))}</p>
			<button class="ath-btn primary big" data-a="again">${esc(ui('result.replay'))}</button>`, 'full');
		card.querySelector('[data-a=again]')!.addEventListener('click', () => { this.click(); onReplay(); });
	}
}
