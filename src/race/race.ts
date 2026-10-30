// Cyber Rally: the race loop. The kart runs by itself along the corniche; the child only changes lanes. Decision gates
// span the three lanes (each lane is an answer); the safe lane gives a speed boost, an unsafe lane slows the kart in
// "virus mud" and the same question comes back as a second chance. One checkpoint is a pit stop with a phone message.
// Knowledge points come only from decisions (src/game/assessment.ts, the same rules the platform server re-scores);
// golden shields and stars are for fun and never change the knowledge score.
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Engine } from '@babylonjs/core/Engines/engine';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Loading/loadingScreen';
import '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Materials/PBR/pbrMaterial';
import '@babylonjs/core/Meshes/Builders/boxBuilder';
import '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import '@babylonjs/core/Meshes/Builders/planeBuilder';
import '@babylonjs/core/Meshes/Builders/discBuilder';
import '@babylonjs/core/Meshes/Builders/sphereBuilder';
import '@babylonjs/core/Meshes/Builders/groundBuilder';
import '@babylonjs/core/Meshes/instancedMesh';
import '@babylonjs/loaders/glTF/2.0';
import { activeCheckpoint, applyAction, createRun, getResult, isResolved, normalizeName, Run, RunResult, shuffleForRun, uuid } from '../game/assessment';
import { Audio } from '../game/audio';
import { CharacterKit } from '../game/avatar';
import { CheckpointDef, checkpoints, config, content, ui } from '../game/data';
import type { Feedback, PanelModel } from '../game/director';
import { Ui } from '../ui/ui';
import { LANE_COLORS, LANE_LETTERS, RaceUi } from '../ui/raceUi';
import { Car, CAR_COLORS } from './car';
import { Kit, Prefab } from './kit';
import { LANE, Track } from './track';
import trackDef from '../data/track-corniche.json';

export interface RaceOptions {
	base: string;
	onComplete?: (payload: { result: RunResult; ledger: Run['ledger']; fun: { stars: number; coins: number; coinsTotal: number; seconds: number; beatVirus: boolean } }) => void;
	onEvent?: (type: string, data: unknown) => void;
}
type Mode = 'loading' | 'entry' | 'garage' | 'intro' | 'countdown' | 'race' | 'pit' | 'finish' | 'results';
interface Item { kind: 'coin' | 'boost' | 'popup'; s: number; lat: number; node: TransformNode; taken: boolean; t: number; counted: boolean }
interface GateEv { kind: 'gate'; s: number; cp: CheckpointDef; lanes: string[]; second: boolean; nodes: TransformNode[] }
interface PitEv { kind: 'pit'; s: number; cp: CheckpointDef; nodes: TransformNode[]; stopped: boolean }
interface FinishEv { kind: 'finish'; s: number; nodes: TransformNode[] }
type Ev = GateEv | PitEv | FinishEv;

const D = Math.PI / 180;
const BASE = 15, THINK = 8, BOOST = 25, MUD = 6;
const RIVAL_SPEED = 13.0, RIVAL_HEAD = 14;           // tuned so a child who chooses safely (boosts) can overtake
const cpDef = (id: string) => content.checkpoints?.[id] ?? {};

export class RaceGame {
	readonly canvas: HTMLCanvasElement;
	readonly engine: Engine;
	readonly scene: Scene;
	private cam: FreeCamera;
	private track!: Track;
	private kit!: Kit;
	private car!: Car;
	// the rival «الفيروس»: a purple kart ahead of the child; overtaking it is the goal (fun only, never part of the score)
	private rival!: Car; private rs = 0; private rlat = 0; private rlane = 1; private rv = 0; private rLaneT = 0; private ahead = false; private beatVirus = false; private rSlowT = 0; private rFastT = 0;
	private ui: Ui;
	private hud: RaceUi;
	private audio: Audio;
	private mode: Mode = 'loading';
	private run: Run | null = null;
	private player = { name: '', avatar: 'male' as 'male' | 'female', color: 'white' };
	// motion
	private s = 0; private lat = 0; private lane = 1; private v = 0; private boostT = 0; private mudT = 0; private wobble = 0;
	private raceTime = 0; private modeT = 0;
	// course
	private ev: Ev | null = null; private nextAt = 45; private attempts = new Map<string, number>();
	private old: { s: number; nodes: TransformNode[] }[] = [];
	private items: Item[] = []; private genTo = 26; private chunk = 0; private seed = 1;
	private coins = 0; private coinsTotal = 0; private streak = 0;
	private prefabs!: Record<'coin' | 'boost' | 'popup', Prefab>;
	private pools: Record<string, TransformNode[]> = { coin: [], boost: [], popup: [] };
	private laneMats: StandardMaterial[] = [];
	private startArch: TransformNode | null = null;
	private sparks!: ParticleSystem; private confetti!: ParticleSystem; private virus!: ParticleSystem;
	private intro = { i: -1, t: 0, shots: [] as { cam: Vector3; look: Vector3; text: string }[], from: new Vector3(), fromLook: new Vector3(), look: new Vector3() };
	private garageA = 0;
	private tutorialShown = false;

	constructor(readonly host: HTMLElement, readonly opts: RaceOptions) {
		host.classList.add('ath-host');
		this.canvas = document.createElement('canvas');
		this.canvas.setAttribute('aria-label', ui('app.title'));
		host.appendChild(this.canvas);
		this.engine = new Engine(this.canvas, true, { stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }, false);
		this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
		this.scene = new Scene(this.engine);
		this.scene.useRightHandedSystem = true;
		this.scene.skipPointerMovePicking = true;
		this.scene.clearColor = new Color4(0.8, 0.88, 0.95, 1);
		this.cam = new FreeCamera('cam', new Vector3(-8, 4, 0), this.scene);
		this.cam.minZ = 0.1; this.cam.maxZ = 1400;
		const touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
		this.ui = new Ui(host, opts.base);
		this.hud = new RaceUi(host, opts.base, touch);
		if (touch) host.classList.add('touch');
		this.audio = new Audio(opts.base);
		this.ui.click = this.hud.click = () => void this.audio.play('SFX_UI_Click', 0.5);
		this.hud.onSound = m => this.audio.setMuted(m);
		this.hud.onSteer = d => this.steer(d);
		addEventListener('keydown', e => {
			if ((e.target as HTMLElement)?.closest?.('input,textarea')) return;
			if (e.code === 'ArrowLeft' || e.code === 'KeyA') { this.steer(-1); this.hud.flashSteer(-1); }
			if (e.code === 'ArrowRight' || e.code === 'KeyD') { this.steer(1); this.hud.flashSteer(1); }
		});
		// Touch anywhere: left half steers left, right half steers right (the buttons are the visible hint).
		this.canvas.addEventListener('pointerdown', e => { if (this.mode === 'race') this.steer(e.clientX < this.canvas.clientWidth / 2 ? -1 : 1); });
		addEventListener('resize', () => this.engine.resize());
		this.engine.runRenderLoop(() => this.scene.render());
		this.scene.onBeforeRenderObservable.add(() => this.tick(Math.min(this.engine.getDeltaTime() / 1000, 0.05)));
	}

	async start() {
		this.ui.loading(0.03);
		await Promise.all([document.fonts.load('700 64px "Readex Pro"'), document.fonts.load('400 40px "Readex Pro"')]).catch(() => {});
		const hemi = new HemisphericLight('fill', new Vector3(0.2, 1, -0.3), this.scene);
		hemi.intensity = 1.0; hemi.diffuse = new Color3(1, 0.95, 0.86); hemi.groundColor = new Color3(0.45, 0.40, 0.34);
		const sun = new DirectionalLight('sun', new Vector3(-0.4, -1, 0.35), this.scene);
		sun.intensity = 1.0; sun.diffuse = new Color3(1, 0.9, 0.74);
		this.kit = await Kit.load(this.scene, this.opts.base, p => this.ui.loading(0.05 + p * 0.5));
		this.ui.loading(0.6);
		const chars = await CharacterKit.load(this.scene, this.opts.base);
		this.ui.loading(0.8);
		this.track = new Track(this.scene, trackDef as any);
		this.track.build(this.kit);
		this.car = new Car(this.kit, chars);
		this.car.setDriver('male');
		this.rival = new Car(this.kit, chars, true);
		this.rival.root.setEnabled(false);
		this.prefabs = { coin: this.kit.prefab('Pickup_Shield', false), boost: this.kit.prefab('Boost_Pad', false), popup: this.kit.prefab('Popup_Block', false) };
		this.laneMats = LANE_COLORS.map((c, i) => {
			const m = new StandardMaterial('lane' + i, this.scene);
			m.diffuseColor = Color3.FromHexString(c); m.emissiveColor = Color3.FromHexString(c).scale(0.55); m.specularColor = new Color3(0.2, 0.2, 0.2);
			return m;
		});
		for (const m of this.scene.materials) if (m instanceof PBRMaterial) m.maxSimultaneousLights = 2;
		this.makeParticles();
		this.startArch = this.spawnArch('Finish_Arch', 4, ui('startSign'));
		this.placeCar();
		this.ui.loading(1);
		this.showEntry();
	}

	// ---------------------------------------------------------------- screens: entry, garage, intro, countdown
	private showEntry() {
		this.mode = 'entry';
		this.hud.showHud(false);
		this.ui.entry((name, avatar) => {
			this.audio.unlock();
			this.player.name = name; this.player.avatar = avatar;
			this.car.setDriver(avatar);
			this.ui.closeModal();
			this.showGarage();
		}, normalizeName);
	}
	private showGarage() {
		this.mode = 'garage';
		this.car.setColor(CAR_COLORS[this.player.color]);
		this.hud.garage(CAR_COLORS, this.player.color, k => { this.player.color = k; this.car.setColor(CAR_COLORS[k]); this.car.driver?.play('happy'); },
			() => this.firstRace ? this.startIntro() : this.countdown());
	}
	private firstRace = true;
	private startIntro() {
		this.firstRace = false;
		const T = this.track, p0 = T.at(0), f = T.tangent(0), r = T.right(0), up = new Vector3(0, 1, 0);
		this.intro.shots = [
			{ cam: p0.add(r.scale(-2.6)).add(f.scale(3.2)).add(up.scale(1.5)), look: p0.add(up.scale(0.9)), text: ui('intro1') },
			{ cam: T.at(60, 34).add(up.scale(11)), look: T.at(150, -34), text: ui('intro2') },   // from the town: road, beach, sea, dhows
			{ cam: T.at(-10, 0).add(up.scale(4.2)), look: T.at(40, 0).add(up.scale(1.2)), text: ui('intro3') }
		];
		this.intro.i = -1;
		this.intro.look = p0.clone();
		this.mode = 'intro';
		this.nextShot();
	}
	private nextShot() {
		const I = this.intro;
		if (I.i + 1 >= I.shots.length) { this.ui.closeModal(); this.countdown(); return; }
		I.from.copyFrom(this.cam.position); I.fromLook.copyFrom(I.look);
		I.i++; I.t = 0;
		this.ui.intro(I.shots[I.i].text, I.i, I.shots.length, () => this.nextShot(), () => { this.ui.closeModal(); this.countdown(); });
	}
	private countdown() {
		this.resetRace();
		this.mode = 'countdown'; this.modeT = 0;
		this.hud.showHud(true);
		this.hud.setPieces(0, checkpoints.length);
		this.hud.setCoins(0);
		void this.audio.loop('MUS_Explore_Loop', 0.22);
		void this.audio.loop('AMB_Courtyard', 0.25);
		this.opts.onEvent?.('game.started', { gameId: config.gameId, runId: this.run!.runId });
	}

	private resetRace() {
		this.run = createRun(this.player.name, this.player.avatar);
		this.s = 0; this.lat = 0; this.lane = 1; this.v = 0; this.boostT = 0; this.mudT = 0; this.raceTime = 0;
		this.coins = 0; this.coinsTotal = 0; this.streak = 0;
		this.attempts.clear();
		for (const o of this.old) o.nodes.forEach(n => n.dispose());
		this.old = [];
		if (this.ev) this.ev.nodes.forEach(n => n.dispose());
		this.ev = null; this.nextAt = 45;
		for (const it of this.items) this.recycle(it);
		this.items = []; this.genTo = 26; this.chunk = 0; this.seed = 1;
		this.tutorialShown = false;
		this.startArch?.setEnabled(true);
		this.hud.question(null); this.hud.hideBanner(); this.hud.clearBottom();
		this.rs = RIVAL_HEAD; this.rlane = 1; this.rlat = 0; this.rv = 0; this.rLaneT = 3; this.ahead = false; this.beatVirus = false; this.rSlowT = 0; this.rFastT = 0;
		this.rival.root.setEnabled(true);
		this.placeRival(0);
		this.placeCar();
	}

	// ---------------------------------------------------------------- input
	private steer(d: -1 | 1) {
		if (this.mode !== 'race') return;
		if (this.ev?.kind === 'pit' && this.ev.s - this.s < 70) return;     // the kart pulls into the pit by itself
		const n = Math.max(0, Math.min(2, this.lane + d));
		if (n !== this.lane) { this.lane = n; this.audio.beep(520 + n * 60, 0.06, 0.05, 'sine'); }
	}

	// ---------------------------------------------------------------- per frame
	private tick(dt: number) {
		if (!this.track) return;
		this.track.update(dt);
		this.modeT += dt;
		switch (this.mode) {
			case 'entry': case 'garage': this.garageCam(dt); break;
			case 'intro': this.introCam(dt); break;
			case 'countdown': this.tickCountdown(); this.chaseCam(dt); break;
			case 'race': this.tickRace(dt); this.chaseCam(dt); break;
			case 'pit': this.chaseCam(dt); break;
			case 'finish': this.tickFinish(dt); this.chaseCam(dt); break;
			case 'results': this.garageCam(dt); break;
		}
		this.animateItems(dt);
		const boost = Math.min(1, this.boostT / 0.6);
		this.car.update(dt, this.v, Math.max(-1, Math.min(1, ((this.lane - 1) * LANE - this.lat) / 2.2)), boost, true);   // Cyber always looks at the child
		this.audio.engineSet(this.mode === 'race' || this.mode === 'finish' ? this.v / BOOST : this.mode === 'countdown' ? 0.15 : 0, boost);
		this.hud.speed(this.mode === 'race' && this.boostT > 0.2);
	}

	private placeCar() {
		const yawWobble = Math.sin(this.wobble * 30) * this.wobble * 0.25;
		this.car.setPosition(this.track.at(this.s, this.lat), this.track.heading(this.s) + yawWobble + this.latVel * 0.04);
	}
	private latVel = 0;

	private tickCountdown() {
		const steps = ['٣', '٢', '١', ui('go')];
		const k = Math.floor(this.modeT / 0.85);
		const label = steps[Math.min(k, 3)];
		if ((this as any)._lastCount !== k) {
			(this as any)._lastCount = k;
			if (k < 3) this.audio.beep(440, 0.22, 0.2); else if (k === 3) { this.audio.beep(880, 0.5, 0.22); this.boostT = 1.2; }
			this.hud.countdown(k <= 3 ? label : null);
		}
		if (k >= 4 || this.modeT > 3.4) {
			(this as any)._lastCount = -1;
			this.hud.countdown(null);
			this.mode = 'race'; this.modeT = 0;
		}
	}

	private tickRace(dt: number) {
		this.raceTime += dt;
		if (!this.tutorialShown && this.raceTime > 0.6) {
			this.tutorialShown = true;
			this.hud.toast('🏎️ ' + ui(this.hud.touch ? 'tutSteer' : 'tutSteerKeys'), 5.5);
		}
		// target speed: think zone before a gate, pit approach, boost, virus mud
		const ev = this.ev;
		let target = BASE;
		if (ev?.kind === 'gate' && ev.s - this.s < 78 && ev.s > this.s) target = THINK;
		if (ev?.kind === 'pit') {
			const left = ev.s - this.s;
			if (left < 75) { this.lane = 2; target = Math.max(0, Math.min(BASE, left * 0.42)); }
			if (left < 0.6 || (left < 10 && this.v < 0.4)) { this.v = 0; this.openPit(ev); return; }
		}
		if (this.boostT > 0) { this.boostT -= dt; target = Math.max(target, BOOST); }
		if (this.mudT > 0) { this.mudT -= dt; target = Math.min(target, MUD); }
		this.v += (target - this.v) * Math.min(1, dt * (target > this.v ? 1.6 : 2.6));
		this.s += this.v * dt;
		const laneLat = ev?.kind === 'pit' && ev.s - this.s < 45 ? 6.4 : (this.lane - 1) * LANE;
		const before = this.lat;
		this.lat += (laneLat - this.lat) * Math.min(1, dt * 7.5);
		this.latVel = (this.lat - before) / Math.max(dt, 1e-4);
		this.wobble = Math.max(0, this.wobble - dt);
		this.placeCar();
		if (this.s > 30) this.startArch?.setEnabled(false);
		this.spawnEvents();
		this.generateItems();
		this.collide();
		this.passEvents();
		for (const o of this.old) if (this.s > o.s + 35) { o.nodes.forEach(n => n.dispose()); o.nodes = []; }
		this.old = this.old.filter(o => o.nodes.length);
		this.hud.setPieces(checkpoints.filter(c => isResolved(this.run!.states[c.id])).length, checkpoints.length);
		this.hud.setCoins(this.coins);
		this.tickRival(dt);
	}

	// ---------------------------------------------------------------- the rival «الفيروس»
	/** It drives at a steady pace and changes lane now and then, never into the child's kart; it waits while the child is
	 * in the pit stop (the pit is for thinking, not a race penalty). */
	private tickRival(dt: number) {
		// a safe decision jams the virus for a moment, an unsafe one speeds it up: knowledge is what wins the race
		this.rSlowT -= dt; this.rFastT -= dt;
		const want = this.rSlowT > 0 ? 3.5 : this.rFastT > 0 ? 16 : RIVAL_SPEED;
		this.rv += (want - this.rv) * Math.min(1, dt * 2.2);
		this.rs += this.rv * dt;
		this.rLaneT -= dt;
		const near = Math.abs(this.rs - this.s) < 5;
		if (this.rLaneT <= 0 || (near && Math.abs(this.rlane - this.lane) < 1)) {
			const options = [0, 1, 2].filter(l => l !== this.rlane && !(near && l === this.lane));
			this.rlane = options[Math.floor(this.rnd() * options.length)] ?? this.rlane;
			this.rLaneT = 5 + this.rnd() * 5;
		}
		this.placeRival(dt);
		const gap = this.rs - this.s;
		if (!this.ahead && gap < -2.5) { this.ahead = true; this.hud.toast(ui('overtook'), 2.4); this.audio.chime(8); this.car.driver?.play('happy'); }
		else if (this.ahead && gap > 2.5) { this.ahead = false; this.hud.toast(ui('overtaken'), 2.4); }
		this.hud.rival(gap);
	}
	private placeRival(dt: number) {
		const before = this.rlat;
		this.rlat += ((this.rlane - 1) * LANE - this.rlat) * Math.min(1, dt * 3);
		const latVel = dt > 0 ? (this.rlat - before) / dt : 0;
		this.rival.setPosition(this.track.at(this.rs, this.rlat), this.track.heading(this.rs) + latVel * 0.04);
		this.rival.update(dt, this.rv, Math.max(-1, Math.min(1, ((this.rlane - 1) * LANE - this.rlat) / 2.2)), 0, false);
	}

	// ---------------------------------------------------------------- events on the road
	private spawnEvents() {
		if (this.ev || this.s < this.nextAt || !this.run) return;
		const cp = activeCheckpoint(this.run);
		if (!cp) { this.spawnFinish(this.s + 115); return; }
		if (cpDef(cp.id).kind === 'pit') this.spawnPit(cp, this.s + 175);
		else this.spawnGate(cp, this.s + 135);
	}
	private clearItems(from: number, to: number) {
		for (const it of this.items) if (!it.taken && it.s > from && it.s < to) { this.recycle(it); it.taken = true; it.counted = true; }
	}

	private signTexture(lines: { text: string; size: number; color: string }[], w: number, h: number, bg: string, letter?: { t: string; c: string }) {
		const tex = new DynamicTexture('signTex', { width: w, height: h }, this.scene, true);
		const c = tex.getContext() as CanvasRenderingContext2D;
		// The sign planes are seen from their back side in this right-handed scene: draw mirrored so the Arabic reads right.
		c.setTransform(-1, 0, 0, 1, w, 0);
		c.fillStyle = bg; c.beginPath(); c.roundRect(4, 4, w - 8, h - 8, 36); c.fill();
		c.lineWidth = 10; c.strokeStyle = 'rgba(255,255,255,0.9)'; c.stroke();
		c.textAlign = 'center'; c.textBaseline = 'middle'; c.direction = 'rtl';
		let x = w / 2;
		if (letter) {
			c.fillStyle = '#fff'; c.beginPath(); c.arc(w - 74, h / 2, 46, 0, Math.PI * 2); c.fill();
			c.fillStyle = letter.c; c.font = 'bold 60px "Readex Pro", sans-serif'; c.fillText(letter.t, w - 74, h / 2 + 4);
			x = (w - 140) / 2 + 10;
		}
		const total = lines.reduce((n, l) => n + l.size * 1.2, 0);
		let y = h / 2 - total / 2;
		for (const l of lines) {
			c.fillStyle = l.color; c.font = `bold ${l.size}px "Readex Pro", sans-serif`;
			let fs = l.size;
			while (c.measureText(l.text).width > (letter ? w - 180 : w - 60) && fs > 20) { fs -= 2; c.font = `bold ${fs}px "Readex Pro", sans-serif`; }
			c.fillText(l.text, x, y + l.size * 0.6);
			y += l.size * 1.2;
		}
		tex.update(true);
		return tex;
	}
	private signPlane(parent: TransformNode, local: Vector3, w: number, h: number, tex: DynamicTexture, faceBack = false) {
		const p = MeshBuilder.CreatePlane('sign', { width: w, height: h }, this.scene);
		const m = new StandardMaterial('signMat', this.scene);
		m.diffuseTexture = tex; m.emissiveTexture = tex; m.disableLighting = true; m.useAlphaFromDiffuseTexture = false;
		tex.hasAlpha = true; m.diffuseTexture.hasAlpha = true;
		p.material = m; p.parent = parent; p.position = local; p.rotation.y = faceBack ? -Math.PI / 2 : Math.PI / 2; p.isPickable = false;
		return p;
	}
	private hideChild(n: TransformNode, name: string) {
		for (const c of n.getChildren(undefined, false)) if (c.name.startsWith(name)) (c as TransformNode).setEnabled(false);
	}

	private spawnGate(cp: CheckpointDef, s: number) {
		const def = cpDef(cp.id);
		const tries = (this.attempts.get(cp.id) ?? 0);
		const actions = shuffleForRun([cp.safeActionId, ...cp.unsafeActionIds], this.run!.runId + ':' + tries, cp.id);
		const nodes: TransformNode[] = [];
		actions.forEach((a, i) => {
			const arch = this.kit.copy('Gate_Arch', undefined, `gate_${cp.id}_${i}`)!;
			this.hideChild(arch, 'Gate_Sign');
			for (const m of arch.getChildMeshes(false)) if (m.material?.name === 'Lane') m.material = this.laneMats[i];
			arch.position = this.track.at(s, (i - 1) * LANE);
			arch.rotation.y = this.track.heading(s);
			const tex = this.signTexture([{ text: def.lanes?.[a] ?? a, size: 54, color: '#ffffff' }], 640, 230, LANE_COLORS[i], { t: LANE_LETTERS[i], c: LANE_COLORS[i] });
			this.signPlane(arch, new Vector3(0.16, 5.05, 0), 2.9, 1.04, tex);
			nodes.push(arch);
		});
		// a banner across the road 18 m before the gate with the message itself
		const banner = new TransformNode('banner', this.scene);
		banner.position = this.track.at(s - 18, 0); banner.rotation.y = this.track.heading(s - 18);
		for (const side of [-1, 1]) {
			const post = MeshBuilder.CreateCylinder('post', { diameter: 0.25, height: 5.6 }, this.scene);
			post.parent = banner; post.position.set(0, 2.8, side * 4.9); post.material = this.kit.material('Gold');
		}
		const bt = this.signTexture([{ text: `${def.icon ?? ''} ${def.fromAr ?? ''}`, size: 46, color: '#9fe6ff' }, { text: def.promptAr ?? '', size: 50, color: '#ffffff' }],
			1400, 260, 'rgba(15,32,64,0.94)');
		this.signPlane(banner, new Vector3(0, 5.0, 0), 9.6, 1.8, bt);
		nodes.push(banner);
		this.clearItems(s - 34, s + 20);
		this.ev = { kind: 'gate', s, cp, lanes: actions, second: tries > 0, nodes };
	}

	private spawnPit(cp: CheckpointDef, s: number) {
		const node = this.kit.copy('Pit_Station', undefined, 'pit')!;
		this.hideChild(node, 'Pit_Sign');
		node.position = this.track.at(s, 6.6);
		node.rotation.y = this.track.heading(s) + Math.PI;
		const tex = this.signTexture([{ text: '🛡️ ' + ui('pitSign'), size: 70, color: '#ffffff' }], 900, 240, '#0b7fa0');
		this.signPlane(node, new Vector3(3.3, 4.4, 0), 4.4, 1.17, tex, true);
		// an arrow on the road guiding into the pit
		this.clearItems(s - 90, s + 25);
		this.hud.toast('🛡️ ' + ui('pitAhead'), 3.5);
		this.ev = { kind: 'pit', s, cp, nodes: [node], stopped: false };
	}

	private spawnFinish(s: number) {
		const n = this.spawnArch('Finish_Arch', s, '🏁 ' + ui('finishSign'));
		this.clearItems(s - 20, s + 40);
		this.hud.toast('🏁 ' + ui('finishAhead'), 3);
		this.ev = { kind: 'finish', s, nodes: [n] };
	}
	private spawnArch(name: string, s: number, text: string) {
		const n = this.kit.copy(name, undefined, name + '_' + Math.round(s))!;
		n.position = this.track.at(s, 0); n.rotation.y = this.track.heading(s);
		const tex = this.signTexture([{ text, size: 72, color: '#ffffff' }], 1100, 200, '#d72631');
		this.signPlane(n, new Vector3(0.3, 5.75, 0), 6.6, 1.2, tex);
		return n;
	}

	private passEvents() {
		const ev = this.ev;
		if (!ev) { this.hud.question(null); return; }
		if (ev.kind === 'gate') {
			const left = ev.s - this.s;
			const def = cpDef(ev.cp.id);
			if (left < 92 && left > 0) this.hud.question({ icon: def.icon ?? '', fromAr: def.fromAr ?? '', promptAr: def.promptAr ?? '',
				lanes: ev.lanes.map(a => def.lanes?.[a] ?? a), second: ev.second });
			if (left <= 0) {
				const lane = Math.max(0, Math.min(2, Math.round(this.lat / LANE) + 1));
				this.hud.question(null);
				this.decide(ev.cp, ev.lanes[lane]);
				this.old.push({ s: ev.s, nodes: ev.nodes });
				this.ev = null; this.nextAt = this.s + 20;
			}
		} else if (ev.kind === 'finish' && this.s >= ev.s) {
			this.old.push({ s: ev.s + 1e9, nodes: ev.nodes });
			this.ev = null;
			this.finish();
		}
	}

	/** One decision: scored by the assessment engine; the lane's outcome is shown on the road. */
	private decide(cp: CheckpointDef, actionId: string): boolean {
		const run = this.run!;
		const r = applyAction(run, { eventId: uuid(), runId: run.runId, checkpointId: cp.id, actionId });
		if (!r.accepted) return false;
		const safe = r.reason === 'resolved';
		this.attempts.set(cp.id, (this.attempts.get(cp.id) ?? 0) + 1);
		this.opts.onEvent?.('game.decision', { gameId: config.gameId, checkpointId: cp.id, actionId, safe });
		const def = cpDef(cp.id);
		const kartPos = this.car.root.position.add(new Vector3(0, 1, 0));
		if (safe) {
			const recovered = run.states[cp.id] === 'resolved_recovered';
			const pts = recovered ? Math.round(cp.weight * config.recoveryCreditRate * 10) / 10 : cp.weight;
			this.boostT = 2.6;
			void this.audio.play('SFX_Safe', 0.8);
			setTimeout(() => void this.audio.play('SFX_ShieldRestore', 0.6), 250);
			this.burst(this.sparks, kartPos, 60);
			this.car.driver?.play('happy');
			this.rSlowT = 3.2; this.rFastT = 0;
			this.burst(this.virus, this.rival.root.position.add(new Vector3(0, 1.4, 0)), 40);
			this.hud.showBanner('good', `${ui('safeTitle')}  +${pts}`, `${cp.feedbackAr}
${ui('virusSlowed')}`, 5.5);
		} else {
			this.mudT = 2.8; this.wobble = 1.2; this.rFastT = 1.6; this.rSlowT = 0;
			void this.audio.play('SFX_Unsafe', 0.8);
			this.burst(this.virus, kartPos, 70);
			this.hud.glitch();
			this.car.driver?.play('sad');
			const said = def.consequencesAr?.[actionId] ?? def.panel?.consequencesAr?.[actionId] ?? '';
			this.hud.showBanner('bad', ui('unsafeTitle'), `${said}\n${cp.feedbackAr}\n${ui('secondComing')}`, 7);
		}
		return safe;
	}

	// ---------------------------------------------------------------- the pit stop (a phone message, like the walking games)
	private openPit(ev: PitEv) {
		if (ev.stopped) return;
		ev.stopped = true;
		this.mode = 'pit';
		this.hud.question(null); this.hud.hideBanner();
		this.car.driver && (this.car.driver.phoneOut = true);
		void this.audio.play('SFX_PhoneRing', 0.5);
		this.showPitPanel(ev);
	}
	private showPitPanel(ev: PitEv) {
		const p = cpDef(ev.cp.id).panel ?? {};
		const fill = (v: any): any => typeof v === 'string' ? v.replaceAll('{displayName}', this.run!.displayName)
			: Array.isArray(v) ? v.map(fill) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v;
		const tries = this.attempts.get(ev.cp.id) ?? 0;
		const model: PanelModel = { id: 'pit', titleAr: p.titleAr ?? '', evidenceAr: fill(p.evidenceAr ?? []), checkpointId: ev.cp.id, locked: false, resolved: false,
			noteAr: tries ? ui('secondChance') : '', phone: p.phone ? fill(p.phone) : null,
			choices: shuffleForRun((p.choices ?? []).map((c: any) => ({ actionId: c.actionId, labelAr: fill(c.labelAr) })), this.run!.runId + ':' + tries, ev.cp.id) };
		void this.audio.play('SFX_UI_Open', 0.5);
		this.ui.panel(model, {
			officialSeen: true,
			onChoose: a => this.pitChoose(ev, a),
			onClose: () => { this.ui.closeModal(); setTimeout(() => this.showPitPanel(ev), 200); }
		});
	}
	private pitChoose(ev: PitEv, actionId: string) {
		const cp = ev.cp;
		const safe = this.decide(cp, actionId);
		this.hud.hideBanner();
		const def = cpDef(cp.id).panel ?? {};
		const recovered = this.run!.states[cp.id] === 'resolved_recovered';
		const fb: Feedback = { accepted: true, safe, recovered, missionComplete: false, missionId: cp.missionId,
			titleAr: safe ? ui('safeTitle') : ui('unsafeTitle'),
			bodyAr: safe ? (recovered ? ui('recovered') + '\n' : '') + cp.feedbackAr : `${def.consequencesAr?.[actionId] ?? ''}\n${cp.feedbackAr}`,
			hintAr: cp.hintAr, worldEventAr: '', screenId: '' };
		this.ui.feedback(fb, () => {
			this.ui.closeModal();
			if (!safe) { this.showPitPanel(ev); return; }
			if (this.car.driver) this.car.driver.phoneOut = false;
			this.old.push({ s: ev.s, nodes: ev.nodes });
			this.ev = null; this.nextAt = this.s + 28;
			this.lane = 2; this.boostT = 2.8;
			this.mode = 'race'; this.modeT = 0;
		});
	}

	// ---------------------------------------------------------------- shields, boost pads and pop-up windows
	private rnd() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }
	private take(kind: Item['kind']): TransformNode {
		const n = this.pools[kind].pop() ?? this.prefabs[kind].place(Vector3.Zero(), 0, 1, kind);
		n.setEnabled(true);
		return n;
	}
	private recycle(it: Item) { it.node.setEnabled(false); this.pools[it.kind].push(it.node); }
	private add(kind: Item['kind'], s: number, lat: number) {
		const node = this.take(kind);
		node.position = this.track.at(s, lat).add(new Vector3(0, kind === 'coin' ? 0.35 : 0, 0));
		node.rotation.y = this.track.heading(s) + (kind === 'popup' ? Math.PI : 0);
		node.scaling.setAll(1);
		this.items.push({ kind, s, lat, node, taken: false, t: 0, counted: false });
	}
	private blocked(a: number, b: number) {
		const e = this.ev;
		return !!e && ((e.kind === 'gate' && a < e.s + 20 && b > e.s - 34) || (e.kind === 'pit' && a < e.s + 25 && b > e.s - 90) || (e.kind === 'finish' && b > e.s - 20));
	}
	private generateItems() {
		while (this.genTo < this.s + 210) {
			const a = this.genTo, b = a + 36;
			this.genTo = b; this.chunk++;
			if (this.blocked(a, b)) continue;
			const L = Math.floor(this.rnd() * 3), r = this.rnd();
			const lat = (l: number) => (l - 1) * LANE;
			if (this.chunk <= 2 || r < 0.32) {                                  // a sweep across lanes teaches steering
				const L2 = L === 1 ? (this.rnd() < 0.5 ? 0 : 2) : 1;
				for (let k = 0; k < 6; k++) this.add('coin', a + 4 + k * 4.5, lat(L) + (lat(L2) - lat(L)) * Math.min(1, Math.max(0, (k - 1) / 3)));
			} else if (r < 0.7) {
				for (let k = 0; k < 5; k++) this.add('coin', a + 4 + k * 4.5, lat(L));
			} else if (r < 0.88) {
				this.add('boost', a + 8, lat(L));
				for (let k = 0; k < 3; k++) this.add('coin', a + 14 + k * 4.5, lat(L));
			}
			if (this.chunk > 2 && this.rnd() < 0.42) {
				const P = (L + 1 + Math.floor(this.rnd() * 2)) % 3;
				this.add('popup', a + 18 + this.rnd() * 10, lat(P));
			}
		}
	}
	private collide() {
		for (const it of this.items) {
			if (it.taken) continue;
			const ds = it.s - this.s, dl = Math.abs(it.lat - this.lat);
			if (it.kind === 'coin' && !it.counted && ds < -2) { it.counted = true; this.streak = 0; this.coinsTotal++; }   // stars count only shields the kart really passed
			if (Math.abs(ds) > 1.6) continue;
			if (it.kind === 'coin' && dl < 1.2) {
				it.taken = true; it.counted = true; it.t = 0;
				this.coins++; this.coinsTotal++; this.streak++;
				this.audio.chime(this.streak);
				this.burst(this.sparks, it.node.position.add(new Vector3(0, 0.4, 0)), 10);
			} else if (it.kind === 'boost' && dl < 1.3) {
				it.taken = true; this.boostT = 2.2;
				void this.audio.play('SFX_Recovered', 0.5);
				this.hud.toast('⚡ ' + ui('boost'), 1.4);
			} else if (it.kind === 'popup' && dl < 1.35) {
				it.taken = true; it.t = 0;
				this.v *= 0.5; this.wobble = 0.8; this.boostT = 0;
				void this.audio.play('SFX_Unsafe', 0.5);
				this.hud.toast('🪟 ' + ui('popupHit'), 2.2);
				this.burst(this.virus, it.node.position.add(new Vector3(0, 1, 0)), 25);
			}
		}
		const keep: Item[] = [];
		for (const it of this.items) { if (it.s < this.s - 25) this.recycle(it); else keep.push(it); }
		this.items = keep;
	}
	private animateItems(dt: number) {
		for (const it of this.items) {
			const n = it.node;
			if (!n.isEnabled()) continue;
			if (it.kind === 'coin') {
				n.rotation.y += dt * 3.2;
				if (it.taken) { it.t += dt; n.position.y += dt * 4; n.scaling.setAll(Math.max(0, 1 - it.t * 3)); if (it.t > 0.34) n.setEnabled(false); }
				else n.position.y = 0.35 + 0.12 * Math.sin(performance.now() / 300 + it.s);
			} else if (it.kind === 'popup' && it.taken) {
				it.t += dt; n.position.y += dt * 6; n.rotation.z += dt * 6; n.scaling.setAll(Math.max(0, 1 - it.t * 1.5));
				if (it.t > 0.7) n.setEnabled(false);
			}
		}
	}

	// ---------------------------------------------------------------- finish and results
	private finish() {
		this.mode = 'finish'; this.modeT = 0;
		this.hud.question(null);
		this.beatVirus = this.s > this.rs;
		this.car.driver?.play('celebrate');
		void this.audio.play('SFX_MissionComplete', 0.8);
		this.burst(this.confetti, this.car.root.position.add(new Vector3(0, 3, 0)), 400);
	}
	private tickFinish(dt: number) {
		this.v += (0 - this.v) * Math.min(1, dt * 1.2);
		this.s += this.v * dt;
		this.lat += (0 - this.lat) * Math.min(1, dt * 2);
		this.placeCar();
		this.rs += this.rv * dt; this.placeRival(dt);
		if (this.modeT > 1.2 && this.modeT < 1.25) this.car.driver?.play('celebrate');
		if (this.modeT > 3.0) this.showResults();
	}
	private showResults() {
		this.mode = 'results'; this.modeT = 0;
		this.hud.showHud(false); this.hud.hideBanner();
		const run = this.run!;
		const result = getResult(run);
		// Stars (fun only): one for finishing, one for collecting 40 % of the shields passed, one for beating the virus.
		const ratio = this.coinsTotal ? this.coins / this.coinsTotal : 0;
		const starReasons = [{ text: ui('starFinish'), on: true }, { text: ui('starShields'), on: ratio >= 0.4 }, { text: ui('starVirus'), on: this.beatVirus }];
		const stars = starReasons.filter(x => x.on).length;
		this.audio.stop('MUS_Explore_Loop', 1.2);
		void this.audio.play(result.passed ? 'MUS_ResultPass' : 'MUS_ResultPractice', 0.8);
		const fun = { stars, coins: this.coins, coinsTotal: this.coinsTotal, seconds: Math.round(this.raceTime), beatVirus: this.beatVirus };
		this.opts.onComplete?.({ result, ledger: run.ledger, fun });
		this.hud.results({ earned: result.earnedPoints, max: result.maximumPoints, passed: result.passed, stars, starReasons, coins: this.coins,
			coinsTotal: this.coinsTotal, seconds: this.raceTime, review: checkpoints.map(c => ({ labelAr: c.labelAr, state: run.states[c.id] })) },
			() => { this.audio.stopAll(); this.showGarage(); });
	}

	// ---------------------------------------------------------------- cameras
	private applyFov(extra = 0) {
		const tall = this.engine.getRenderHeight() > this.engine.getRenderWidth();
		this.cam.fovMode = tall ? Camera.FOVMODE_VERTICAL_FIXED : Camera.FOVMODE_HORIZONTAL_FIXED;
		this.cam.fov = ((tall ? 66 : 78) + extra) * D;
	}
	private chaseCam(dt: number) {
		const s = this.s, f = this.track.tangent(s + 3), car = this.car.root.position;
		const tall = this.engine.getRenderHeight() > this.engine.getRenderWidth();
		const back = (tall ? 7.2 : 6.0) + this.v * 0.06, up = tall ? 3.3 : 2.6;
		const goal = car.subtract(f.scale(back)).add(new Vector3(0, up, 0)).add(this.track.right(s).scale(-this.lat * 0.25));
		if (this.wobble > 0) goal.addInPlace(new Vector3((Math.random() - 0.5) * 0.25 * this.wobble, (Math.random() - 0.5) * 0.2 * this.wobble, 0));
		this.cam.position = Vector3.Lerp(this.cam.position, goal, dt > 0 ? Math.min(1, dt * 6) : 1);
		this.cam.setTarget(car.add(f.scale(tall ? 6 : 7)).add(new Vector3(0, tall ? 0.9 : 1.1, 0)));
		this.applyFov(Math.min(1, this.boostT / 0.6) * 10);
	}
	private garageCam(dt: number) {
		this.garageA += dt * 0.35;
		const car = this.car.root.position, r = 5.4;
		const goal = car.add(new Vector3(Math.cos(this.garageA) * r, 2.0, Math.sin(this.garageA) * r));
		this.cam.position = Vector3.Lerp(this.cam.position, goal, Math.min(1, dt * 3));
		this.cam.setTarget(car.add(new Vector3(0, 0.75, 0)));
		this.applyFov(this.engine.getRenderHeight() > this.engine.getRenderWidth() ? 4 : -8);
	}
	private introCam(dt: number) {
		const I = this.intro, shot = I.shots[I.i];
		if (!shot) return;
		I.t += dt;
		const a = Math.min(1, I.t / 1.7), e = a * a * (3 - 2 * a);
		I.look = Vector3.Lerp(I.fromLook, shot.look, e);
		const drift = shot.look.subtract(shot.cam).normalize().scale(0.25 * Math.max(0, I.t - 1.7));
		this.cam.position = Vector3.Lerp(I.from, shot.cam, e).add(drift);
		// On a tall phone Cyber's card covers the lower half: aim lower so the scene sits in the upper half.
		const tall = this.engine.getRenderHeight() > this.engine.getRenderWidth();
		this.cam.setTarget(tall ? I.look.subtract(new Vector3(0, Vector3.Distance(this.cam.position, I.look) * 0.32, 0)) : I.look);
		this.applyFov(4);
		if (I.t > 9) this.nextShot();
	}

	// ---------------------------------------------------------------- particles
	private makeParticles() {
		const dot = new DynamicTexture('dot', { width: 64, height: 64 }, this.scene, false);
		const c = dot.getContext() as CanvasRenderingContext2D;
		const g = c.createRadialGradient(32, 32, 2, 32, 32, 30);
		g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
		c.fillStyle = g; c.fillRect(0, 0, 64, 64); dot.update(); dot.hasAlpha = true;
		const make = (name: string, c1: Color4, c2: Color4, size: [number, number], speed: [number, number], gravity: number, life: [number, number]) => {
			const p = new ParticleSystem(name, 500, this.scene);
			p.particleTexture = dot;
			p.color1 = c1; p.color2 = c2; p.colorDead = new Color4(c2.r, c2.g, c2.b, 0);
			p.minSize = size[0]; p.maxSize = size[1];
			p.minEmitPower = speed[0]; p.maxEmitPower = speed[1];
			p.minLifeTime = life[0]; p.maxLifeTime = life[1];
			p.gravity = new Vector3(0, gravity, 0);
			p.direction1 = new Vector3(-1, 1, -1); p.direction2 = new Vector3(1, 2, 1);
			p.emitRate = 0; p.blendMode = ParticleSystem.BLENDMODE_ADD;
			p.emitter = Vector3.Zero();
			p.start();
			return p;
		};
		this.sparks = make('sparks', new Color4(1, 0.85, 0.3, 1), new Color4(0.4, 0.9, 1, 1), [0.12, 0.35], [3, 7], -6, [0.4, 0.9]);
		this.virus = make('virus', new Color4(0.65, 0.3, 0.95, 1), new Color4(1, 0.3, 0.35, 1), [0.2, 0.5], [2, 5], -2, [0.5, 1.1]);
		this.confetti = make('confetti', new Color4(1, 0.3, 0.3, 1), new Color4(0.3, 0.8, 0.4, 1), [0.15, 0.4], [6, 12], -7, [1.5, 3]);
		this.confetti.blendMode = ParticleSystem.BLENDMODE_STANDARD;
		this.confetti.direction1 = new Vector3(-2, 4, -2); this.confetti.direction2 = new Vector3(2, 6, 2);
	}
	private burst(p: ParticleSystem, at: Vector3, n: number) { p.emitter = at.clone(); p.manualEmitCount = n; }

	dispose() { this.audio.stopAll(); this.engine.dispose(); this.host.innerHTML = ''; }
}


