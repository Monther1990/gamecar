// The kart: body, four spinning wheels, a steering wheel, the chosen character in the seat and Cyber riding on the rear
// wing. Visual only; the race moves `root` along the track. Axes: the kart faces +X, its left is -Z.
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Avatar, CharacterKit, Cyber } from '../game/avatar';
import type { Kit } from './kit';

export const CAR_COLORS: Record<string, string> = { white: '#f4f1ea', red: '#e63946', blue: '#2f80ed', green: '#27ae60', gold: '#f2b632', purple: '#9b51e0' };

export class Car {
	readonly root: TransformNode;
	readonly chassis: TransformNode;
	private wheels: { n: TransformNode; front: boolean; r: number }[] = [];
	private steerWheel: TransformNode | null = null;
	private flames: Mesh[] = [];
	driver: Avatar | null = null;
	readonly cyber: Cyber | null = null;
	private virus: TransformNode | null = null;
	private t = 0;

	/** rival: the purple «الفيروس» kart the child races against (no character, a spiky virus in the seat). */
	constructor(private kit: Kit, private chars: CharacterKit, rival = false) {
		const s = kit.scene;
		this.root = new TransformNode('car', s);
		this.chassis = new TransformNode('chassis', s);
		this.chassis.parent = this.root;
		const body = kit.copy('Car_Body');
		if (body) body.parent = this.chassis;
		const steer = kit.copy('Car_Steer');
		if (steer) { steer.parent = this.chassis; steer.position.set(0.05, 0.72, 0); this.steerWheel = steer; }
		for (const [name, x, z, r] of [['Car_Wheel_FL', 0.82, -0.69, 0.36], ['Car_Wheel_FR', 0.82, 0.69, 0.36],
			['Car_Wheel_RL', -0.80, -0.69, 0.38], ['Car_Wheel_RR', -0.80, 0.69, 0.38]] as const) {
			const w = kit.copy(name);
			if (!w) continue;
			const hub = new TransformNode(name + '_hub', s);
			hub.parent = this.root; hub.position.set(x, r, z);
			w.parent = hub; w.position.setAll(0);
			this.wheels.push({ n: hub, front: x > 0, r });
		}
		// soft shadow under the kart
		const sh = MeshBuilder.CreateDisc('carShadow', { radius: 1, tessellation: 24 }, s);
		const sm = new StandardMaterial('carShadowMat', s);
		sm.diffuseColor = Color3.Black(); sm.specularColor = Color3.Black(); sm.alpha = 0.35; sm.disableLighting = true;
		sh.material = sm; sh.rotation.x = Math.PI / 2; sh.scaling.set(1.5, 0.9, 1); sh.position.y = 0.04; sh.parent = this.root; sh.isPickable = false;
		// boost flames from the two exhausts
		const fm = new StandardMaterial('flameMat', s);
		fm.emissiveColor = new Color3(0.35, 0.9, 1); fm.disableLighting = true; fm.alpha = 0.85;
		for (const z of [-0.19, 0.19]) {
			const f = MeshBuilder.CreateCylinder('flame', { diameterTop: 0, diameterBottom: 0.16, height: 0.6, tessellation: 10 }, s);
			f.material = fm; f.rotation.z = Math.PI / 2; f.position.set(-1.62, 0.30, z); f.parent = this.chassis; f.isPickable = false;
			f.setEnabled(false);
			this.flames.push(f);
		}
		if (rival) this.makeVirus(body);
		else { this.cyber = new Cyber(chars, 'rider', 0.95); this.cyber.root.parent = this.chassis; }
		for (const m of this.root.getChildMeshes(false)) { m.isPickable = false; }
	}

	private makeVirus(body: TransformNode | null) {
		const s = this.kit.scene;
		const paint = new StandardMaterial('rivalPaint', s);
		paint.diffuseColor = Color3.FromHexString('#5b2a86'); paint.emissiveColor = new Color3(0.12, 0.03, 0.2); paint.specularColor = new Color3(0.4, 0.4, 0.4);
		for (const m of body?.getChildMeshes(false) ?? []) if (m.material?.name === 'Paint') m.material = paint;
		const glow = new StandardMaterial('virusMat', s);
		glow.diffuseColor = Color3.FromHexString('#9b51e0'); glow.emissiveColor = new Color3(0.45, 0.1, 0.55); glow.specularColor = Color3.Black();
		const eye = new StandardMaterial('virusEye', s);
		eye.emissiveColor = new Color3(1, 0.95, 0.4); eye.disableLighting = true;
		const v = new TransformNode('virus', s);
		v.parent = this.chassis; v.position.set(-0.36, 0.95, 0);
		const ball = MeshBuilder.CreateSphere('virusBall', { diameter: 0.62, segments: 10 }, s);
		ball.material = glow; ball.parent = v;
		for (let i = 0; i < 14; i++) {                                   // spikes
			const a = i * 2.399, y = 1 - (i + 0.5) / 7;
			const r = Math.sqrt(Math.max(0, 1 - y * y));
			const dir = new Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
			const sp = MeshBuilder.CreateCylinder('spike', { diameterTop: 0, diameterBottom: 0.12, height: 0.2, tessellation: 6 }, s);
			sp.material = glow; sp.parent = v; sp.position = dir.scale(0.36);
			sp.rotationQuaternion = Quaternion.FromUnitVectorsToRef(Vector3.Up(), dir.normalize(), new Quaternion());
		}
		for (const z of [-0.1, 0.1]) {                                   // angry glowing eyes, looking back at the child
			const e = MeshBuilder.CreateSphere('virusEye', { diameter: 0.11, segments: 6 }, s);
			e.material = eye; e.parent = v; e.position.set(-0.27, 0.06, z); e.scaling.y = 0.6;
		}
		this.virus = v;
	}

	setDriver(gender: 'male' | 'female') {
		this.driver?.dispose();
		this.driver = new Avatar(this.chars, gender, 'driver');
		this.driver.root.parent = this.chassis;
		this.driver.root.position.set(-0.36, 0.30, 0);
		this.driver.seated = true;
	}

	setColor(hex: string) {
		const paint = this.kit.material('Paint') as PBRMaterial | null;
		if (paint) paint.albedoColor = Color3.FromHexString(hex).toLinearSpace();
	}

	/** speed m/s, steer -1..1 (visual), boost 0..1, dt seconds. */
	update(dt: number, speed: number, steer: number, boost: number, faceCamera: boolean) {
		this.t += dt;
		for (const w of this.wheels) {
			const wheel = w.n.getChildren()[0] as TransformNode;
			wheel.rotation.z -= speed / w.r * dt;
			if (w.front) w.n.rotation.y = -steer * 0.38;
		}
		if (this.steerWheel) this.steerWheel.rotation.x = steer * 0.9;
		this.chassis.rotation.x = -steer * 0.045 * Math.min(1, speed / 10);         // lean out of the bend
		this.chassis.rotation.z = -boost * 0.03;                                   // nose up when boosting
		this.chassis.position.y = 0.012 * Math.sin(this.t * 23) * Math.min(1, speed / 8);
		for (const f of this.flames) {
			f.setEnabled(boost > 0.05);
			const k = boost * (0.8 + 0.4 * Math.sin(this.t * 40 + f.position.z * 9));
			f.scaling.set(1, k, 1);
			f.position.x = -1.45 - 0.3 * k;
		}
		if (this.driver) { this.driver.steer = steer; this.driver.update(dt, 0, false); }
		if (this.virus) { this.virus.rotation.y = Math.sin(this.t * 2) * 0.3; this.virus.position.y = 0.95 + 0.05 * Math.sin(this.t * 6); }
		if (!this.cyber) return;
		const c = this.cyber.root;
		c.position.set(-0.85, 1.42 + 0.07 * Math.sin(this.t * 2.6), -0.95);   // beside the driver's left shoulder, visible from the chase camera
		c.rotation.set(0.06 * Math.sin(this.t * 1.7), faceCamera ? Math.PI : 0, 0);
		if (this.driver) this.cyber.setExpression(this.driver.shownExpression);
	}
	setPosition(p: Vector3, heading: number) { this.root.position.copyFrom(p); this.root.rotation.y = heading; }
}
