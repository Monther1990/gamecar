// The three shared characters (assets/characters.glb): the Omani boy, the girl and Cyber the shield assistant. Rigid parts
// on joint pivots animated in code (stride, lean, bounce, gestures, phone, expressions). Do not edit the models per game:
// every game in the series uses the same three characters.
// Axes: right-handed, Y up; the character faces +X, its left is -Z. Pivots in metres.
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { AssetContainer } from '@babylonjs/core/assetContainer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Material } from '@babylonjs/core/Materials/material';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Scene } from '@babylonjs/core/scene';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/loaders/glTF/2.0';

export type Expr = 'Neutral' | 'Happy' | 'Sad' | 'Surprised' | 'Blink';
export type Gesture = 'happy' | 'sad' | 'celebrate' | 'relieved' | 'inspect' | 'recoil';
const EXPRS: Expr[] = ['Neutral', 'Happy', 'Sad', 'Surprised', 'Blink'];
const D = Math.PI / 180;

export class CharacterKit {
	faces: Record<string, Record<Expr, Texture>> = {};
	private constructor(readonly scene: Scene, readonly container: AssetContainer) {}

	static async load(scene: Scene, base: string) {
		const container = await SceneLoader.LoadAssetContainerAsync(base + 'assets/', 'characters.glb', scene);
		const kit = new CharacterKit(scene, container);
		for (const who of ['FaceBoy', 'FaceGirl', 'CyberEyes']) {
			kit.faces[who] = {} as Record<Expr, Texture>;
			for (const e of EXPRS) {
				const t = new Texture(`${base}assets/faces/${who}_${e}.png`, scene, false, false);
				t.hasAlpha = true;
				kit.faces[who][e] = t;
			}
		}
		return kit;
	}

	/** Fresh copies of the named parts (with their own materials), keyed by part name. */
	spawn(tag: string, parts: string[]): Map<string, TransformNode> {
		const keep = (n: string) => parts.some(p => n === p || n.startsWith(p + '_'));
		const inst = this.container.instantiateModelsToScene(n => `${tag}:${n}`, true, {
			doNotInstantiate: true, predicate: e => e.name === '__root__' || keep(e.name)
		});
		const out = new Map<string, TransformNode>();
		for (const r of inst.rootNodes) {
			for (const n of [r, ...r.getDescendants(false)]) {
				const name = n.name.split(':').pop()!;
				if (parts.includes(name)) out.set(name, n as TransformNode);
			}
		}
		return out;
	}
}

function decal(meshes: AbstractMesh[], tex: Texture, glow: number) {
	for (const m of meshes) {
		const mat = m.material as PBRMaterial | null;
		if (!mat) continue;
		mat.albedoTexture = tex;
		mat.useAlphaFromAlbedoTexture = true;
		mat.transparencyMode = Material.MATERIAL_ALPHATEST;
		mat.alphaCutOff = 0.35;
		mat.emissiveTexture = tex;
		mat.emissiveColor = new Color3(glow, glow, glow);
		m.isPickable = false;
	}
}
const meshesOf = (n: TransformNode | undefined) => n ? [n as AbstractMesh, ...n.getChildMeshes(false)].filter(m => m.getTotalVertices?.() > 0) : [];

export class Avatar {
	readonly root: TransformNode;
	readonly body: TransformNode; readonly head: TransformNode;
	readonly armL: TransformNode; readonly armR: TransformNode; readonly legL: TransformNode; readonly legR: TransformNode;
	phone: TransformNode | null = null;
	private faceMeshes: AbstractMesh[] = [];
	private faceSet: Record<Expr, Texture>;
	private stride = 0; private lean = 0; private squash = 0; private t = 0;
	private expr: Expr = 'Neutral'; private exprHold = 0; private blinkIn = 3; private blinkLeft = 0; private shown: Expr | '' = '';
	private gesture: Gesture | null = null; private gestureT = 0; private gestureLen = 1.2;
	phoneOut = false; private phoneAlpha = 0;
	heading = 0;
	/** Driving pose (Cyber Rally): set seated, and steer -1 (left) .. 1 (right) every frame. */
	seated = false; steer = 0;

	constructor(kit: CharacterKit, readonly gender: 'male' | 'female', tag: string) {
		const s = kit.scene;
		const who = gender === 'male' ? 'Boy' : 'Girl';
		this.root = new TransformNode(tag + ':root', s);
		const pivot = (name: string, parent: TransformNode, p: Vector3) => { const n = new TransformNode(`${tag}:${name}`, s); n.parent = parent; n.position = p; return n; };
		this.body = pivot('body', this.root, new Vector3(0, 0.18, 0));
		this.head = pivot('head', this.body, new Vector3(0, 0.54, 0));
		this.armL = pivot('armL', this.body, new Vector3(0, 0.485, -0.145));
		this.armR = pivot('armR', this.body, new Vector3(0, 0.485, 0.145));
		this.legL = pivot('legL', this.root, new Vector3(0, 0.20, -0.065));
		this.legR = pivot('legR', this.root, new Vector3(0, 0.20, 0.065));
		const names = ['Body', 'Head', 'Face', 'ArmL', 'ArmR', 'LegL', 'LegR'].map(p => `SM_${who}_${p}`);
		const parts = kit.spawn(tag, [...names, 'SM_Avatar_Phone']);
		const attach: Record<string, TransformNode> = { Body: this.body, Head: this.head, Face: this.head, ArmL: this.armL, ArmR: this.armR, LegL: this.legL, LegR: this.legR };
		for (const [key, parent] of Object.entries(attach)) {
			const n = parts.get(`SM_${who}_${key}`);
			if (!n) continue;
			n.parent = parent; n.position = Vector3.Zero(); n.rotationQuaternion = null; n.rotation = Vector3.Zero(); n.scaling = Vector3.One();
		}
		this.faceSet = kit.faces[gender === 'male' ? 'FaceBoy' : 'FaceGirl'];
		this.faceMeshes = meshesOf(parts.get(`SM_${who}_Face`));
		decal(this.faceMeshes, this.faceSet.Neutral, 0.25);
		const phone = parts.get('SM_Avatar_Phone');
		if (phone) {
			this.phone = new TransformNode(tag + ':phoneHold', s);
			this.phone.parent = this.root;
			phone.parent = this.phone; phone.position = Vector3.Zero(); phone.rotationQuaternion = null; phone.rotation = Vector3.Zero();
			phone.scaling = new Vector3(1.15, 1.15, 1.15);
			this.phone.setEnabled(false);
		}
		for (const m of this.root.getChildMeshes(false)) { m.isPickable = false; m.checkCollisions = false; }
	}

	setExpression(e: Expr, hold: number) { this.expr = e; this.exprHold = hold; }
	play(g: Gesture) {
		this.gesture = g; this.gestureT = 0;
		this.gestureLen = g === 'sad' ? 2.2 : g === 'inspect' || g === 'recoil' ? 1.2 : 1.6;
		if (g === 'happy' || g === 'celebrate' || g === 'relieved') this.setExpression('Happy', 2.2);
		if (g === 'sad') this.setExpression('Sad', 2.8);
		if (g === 'inspect') this.setExpression('Surprised', 1.0);
	}
	landed() { this.squash = 1; }

	/** speed01: 0..1 of walking speed; airborne while falling; dt seconds. */
	update(dt: number, speed01: number, airborne: boolean) {
		this.t += dt;
		const n = Math.min(1, Math.max(0, speed01));
		if (n > 0.03 && !airborne) this.stride += dt * (7 + 7 * n);
		const swing = Math.sin(this.stride) * 38 * D * n;
		this.lean += ((airborne ? 4 : n * 9) * D - this.lean) * Math.min(1, dt * 8);
		this.squash += (0 - this.squash) * Math.min(1, dt * 9);
		let armL = -swing * 0.8, armR = swing * 0.8, rollL = 0, rollR = 0, legL = swing, legR = -swing;
		let headPitch = 0, headYaw = 0, headRoll = 0, hop = 0;
		if (airborne) { rollL = 55 * D; rollR = -55 * D; legL = 18 * D; legR = -8 * D; }
		else if (n < 0.03) { const b = Math.sin(this.t * 2.2); rollL = (4 + 2 * b) * D; rollR = -(4 + 2 * b) * D; }

		if (this.gesture) {
			this.gestureT += dt;
			const T = this.gestureT, L = this.gestureLen;
			const G = Math.sin(Math.min(1, T / L) * Math.PI);
			const hold = Math.min(1, T / 0.22) * Math.min(1, Math.max(0, (L - T) / 0.4));
			switch (this.gesture) {
				case 'inspect': headRoll = 16 * D * G; headPitch = -8 * D * G; break;
				case 'recoil': headPitch = 10 * D * G; armL = 30 * D * G; armR = 30 * D * G; break;
				case 'happy':
					hop = T < 1.1 ? 0.11 * Math.abs(Math.sin(T * Math.PI / 0.55)) : 0;
					rollL = 35 * D * hold; rollR = -(120 + 30 * Math.sin(T * 14)) * D * hold;
					headRoll = 10 * D * Math.sin(T * 9) * hold; break;
				case 'relieved': rollL = 45 * D * hold; rollR = -45 * D * hold; headRoll = 9 * D * hold; break;
				case 'sad': headPitch = -7 * D * hold; headYaw = 16 * D * Math.sin(T * 5) * hold; hop = -0.04 * hold; break;
				case 'celebrate':
					rollL = 150 * D * hold; rollR = -150 * D * hold;
					hop = T < 1 ? 0.14 * Math.abs(Math.sin(T * Math.PI / 0.5)) : 0; headRoll = 8 * D * Math.sin(T * 10) * hold; break;
			}
			if (T > L) this.gesture = null;
		}
		// Phone: the right hand brings it up in front of the face, eyes down on the screen.
		this.phoneAlpha += ((this.phoneOut ? 1 : 0) - this.phoneAlpha) * Math.min(1, dt * 6);
		const P = this.phoneAlpha;
		if (P > 0.01) {
			armR = armR * (1 - P) + 100 * D * P; rollR = rollR * (1 - P) + 22 * D * P;
			headPitch = headPitch * (1 - P) - 14 * D * P;
		}
		if (this.phone) {
			this.phone.setEnabled(P > 0.2);
			this.phone.position.set(0.30, 0.92 + 0.04 * Math.sin(this.t * 2) * P, 0.07);
			this.phone.rotation.set(0, Math.PI, -18 * D);
			const s = Math.min(1, P * 1.4);
			this.phone.scaling.set(s, s, s);
		}
		// In the kart: hands on the wheel (turning with it), legs hidden in the footwell, head leaning into the bend.
		if (this.seated) {
			const S = this.steer;
			if (this.gesture !== 'happy' && this.gesture !== 'celebrate') { armL = (64 + 12 * S) * D; armR = (64 - 12 * S) * D; rollL = -10 * D; rollR = 10 * D; }
			headRoll -= S * 9 * D;
			if (this.legL.isEnabled()) { this.legL.setEnabled(false); this.legR.setEnabled(false); }
		}
		const bounce = Math.abs(Math.sin(this.stride)) * 0.03 * n + Math.sin(this.t * 2.2) * 0.005 * (1 - n);
		this.body.position.y = 0.18 + bounce + hop - this.squash * 0.04;
		this.body.rotation.z = -this.lean;
		this.body.rotation.x = this.seated ? -this.steer * 6 * D : Math.sin(this.stride) * 3 * D * n;
		this.body.scaling.set(1 + 0.1 * this.squash, 1 - 0.14 * this.squash, 1 + 0.1 * this.squash);
		this.head.rotation.set(headRoll, headYaw, headPitch - this.lean * 0.4);
		this.armL.rotation.set(rollL, 0, armL);
		this.armR.rotation.set(rollR, 0, armR);
		this.legL.rotation.z = legL;
		this.legR.rotation.z = legR;
		this.root.rotation.y = this.heading;

		// Face: expression hold, then the resting face with blinks.
		if (this.exprHold > 0) { this.exprHold -= dt; if (this.exprHold <= 0) this.expr = 'Neutral'; }
		this.blinkIn -= dt; this.blinkLeft -= dt;
		if (this.blinkIn <= 0) { this.blinkLeft = 0.13; this.blinkIn = 2.4 + Math.random() * 2.6; }
		const shown: Expr = this.blinkLeft > 0 && this.expr === 'Neutral' ? 'Blink' : this.expr;
		if (shown !== this.shown) { decal(this.faceMeshes, this.faceSet[shown], 0.25); this.shown = shown; }
	}

	get shownExpression(): Expr { return this.expr; }
	dispose() { this.root.dispose(false, true); }
}

/** Cyber, the shield assistant: a companion beside the player, or the big statue on the courtyard pedestal. */
export class Cyber {
	readonly root: TransformNode;
	private eyes: AbstractMesh[];
	private set: Record<Expr, Texture>;
	private shown: Expr | '' = '';
	constructor(kit: CharacterKit, tag: string, scale: number) {
		this.root = new TransformNode(tag + ':cyber', kit.scene);
		const parts = kit.spawn(tag, ['SM_Cyber', 'SM_Cyber_Eyes']);
		for (const n of parts.values()) { n.parent = this.root; n.position = Vector3.Zero(); n.rotationQuaternion = null; n.rotation = Vector3.Zero(); }
		this.root.scaling = new Vector3(scale, scale, scale);
		this.set = kit.faces.CyberEyes;
		this.eyes = meshesOf(parts.get('SM_Cyber_Eyes'));
		for (const m of this.root.getChildMeshes(false)) { m.isPickable = false; m.checkCollisions = false; }
		this.setExpression('Neutral', 2.6);
	}
	setExpression(e: Expr, glow = 2.2) {
		if (e === this.shown) return;
		decal(this.eyes, this.set[e], glow);
		for (const m of this.eyes) { const mat = m.material as PBRMaterial; if (mat) { mat.unlit = true; } }
		this.shown = e;
	}
}
