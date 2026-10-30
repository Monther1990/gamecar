// Web Audio: music, ambience and effects (assets/audio/*.mp3). Unlocked by the start button (browsers only play sound
// after a tap). Music and ambience loop; effects are one-shots. Missing files are skipped silently.
export class Audio {
	private ctx: AudioContext | null = null;
	private master!: GainNode;
	private buffers = new Map<string, Promise<AudioBuffer | null>>();
	private loops = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();
	muted = false;
	constructor(private base: string) {}

	unlock() {
		if (this.ctx) { void this.ctx.resume(); return; }
		const AC = window.AudioContext || (window as any).webkitAudioContext;
		if (!AC) return;
		this.ctx = new AC();
		this.master = this.ctx.createGain();
		this.master.connect(this.ctx.destination);
		for (const n of ['SFX_UI_Click', 'SFX_UI_Open', 'SFX_UI_Close', 'SFX_Prompt', 'SFX_Safe', 'SFX_Unsafe', 'SFX_Footstep1', 'SFX_Footstep2'])
			this.load(n);
	}
	private load(name: string) {
		if (!this.buffers.has(name)) {
			this.buffers.set(name, fetch(`${this.base}assets/audio/${name}.mp3`).then(r => r.arrayBuffer())
				.then(b => this.ctx!.decodeAudioData(b)).catch(() => null));
		}
		return this.buffers.get(name)!;
	}
	setMuted(m: boolean) { this.muted = m; if (this.ctx) this.master.gain.value = m ? 0 : 1; }

	async play(name: string, volume = 0.8): Promise<number> {
		if (!this.ctx) return 0;
		const buf = await this.load(name);
		if (!buf) return 0;
		const src = this.ctx.createBufferSource();
		const g = this.ctx.createGain();
		g.gain.value = volume;
		src.buffer = buf;
		src.connect(g).connect(this.master);
		src.start();
		return buf.duration;
	}
	async loop(name: string, volume: number, fade = 2) {
		if (!this.ctx || this.loops.has(name)) return;
		const buf = await this.load(name);
		if (!buf || this.loops.has(name)) return;
		const src = this.ctx.createBufferSource();
		const g = this.ctx.createGain();
		src.buffer = buf; src.loop = true;
		g.gain.setValueAtTime(0, this.ctx.currentTime);
		g.gain.linearRampToValueAtTime(volume, this.ctx.currentTime + fade);
		src.connect(g).connect(this.master);
		src.start();
		this.loops.set(name, { src, gain: g });
	}
	fadeTo(name: string, volume: number, seconds = 1) {
		const l = this.loops.get(name);
		if (!l || !this.ctx) return;
		l.gain.gain.cancelScheduledValues(this.ctx.currentTime);
		l.gain.gain.setValueAtTime(l.gain.gain.value, this.ctx.currentTime);
		l.gain.gain.linearRampToValueAtTime(volume, this.ctx.currentTime + seconds);
	}
	stop(name: string, fade = 1) {
		const l = this.loops.get(name);
		if (!l || !this.ctx) return;
		this.fadeTo(name, 0, fade);
		l.src.stop(this.ctx.currentTime + fade + 0.05);
		this.loops.delete(name);
	}
	stopAll() { for (const k of [...this.loops.keys()]) this.stop(k, 0.3); this.engineOff(); }

	// ---------------------------------------------------------------- synthesised sounds (no files): kart engine, beeps
	private engine: { a: OscillatorNode; b: OscillatorNode; f: BiquadFilterNode; g: GainNode } | null = null;
	/** A soft toy-kart hum whose pitch follows the speed (0..1); boost (0..1) brightens it. */
	engineSet(speed01: number, boost = 0) {
		if (!this.ctx) return;
		if (!this.engine) {
			const a = this.ctx.createOscillator(), b = this.ctx.createOscillator(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
			a.type = 'sawtooth'; b.type = 'square'; f.type = 'lowpass'; f.Q.value = 4; g.gain.value = 0;
			a.connect(f); b.connect(f); f.connect(g).connect(this.master);
			a.start(); b.start();
			this.engine = { a, b, f, g };
		}
		const t = this.ctx.currentTime, e = this.engine;
		const hz = 48 + 95 * speed01 + 30 * boost;
		e.a.frequency.setTargetAtTime(hz, t, 0.08);
		e.b.frequency.setTargetAtTime(hz * 0.5, t, 0.08);
		e.f.frequency.setTargetAtTime(300 + 900 * speed01 + 900 * boost, t, 0.1);
		e.g.gain.setTargetAtTime(0.025 + 0.035 * speed01 + 0.02 * boost, t, 0.15);
	}
	engineOff() {
		if (!this.engine || !this.ctx) return;
		const e = this.engine;
		e.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
		setTimeout(() => { e.a.stop(); e.b.stop(); }, 900);
		this.engine = null;
	}
	beep(hz: number, seconds = 0.18, volume = 0.18, type: OscillatorType = 'triangle') {
		if (!this.ctx) return;
		const o = this.ctx.createOscillator(), g = this.ctx.createGain(), t = this.ctx.currentTime;
		o.type = type; o.frequency.value = hz;
		g.gain.setValueAtTime(volume, t); g.gain.exponentialRampToValueAtTime(0.001, t + seconds);
		o.connect(g).connect(this.master); o.start(t); o.stop(t + seconds + 0.02);
	}
	/** A rising sparkle for a collected shield (pitch climbs with the streak). */
	chime(step: number) {
		const base = 660 * Math.pow(2, (step % 8) / 12);
		this.beep(base, 0.12, 0.10, 'sine');
		setTimeout(() => this.beep(base * 1.5, 0.14, 0.08, 'sine'), 60);
	}
}
