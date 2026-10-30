// The corniche circuit: a closed Catmull-Rom loop sampled every metre (position, tangent, right), a three-lane road with
// glowing lane lines, Omani red-white-green curbs, the promenade and the sea on the south side, the town inside the loop
// and the Hajar mountains on the horizon. Everything static is merged or instanced so phones stay smooth.
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Kit } from './kit';

export const LANE = 2.6;
const HALF = 4.7;                       // road half width (three lanes + shoulders)
const SEA_Z = -30;                      // the sea starts south of this line

export interface TrackDef { points: [number, number][] }

export class Track {
	readonly length: number;
	private P: Vector3[] = [];            // every metre
	private T: Vector3[] = [];
	private R: Vector3[] = [];
	private time = 0;
	private seaTex!: DynamicTexture;
	dhows: TransformNode[] = [];

	constructor(readonly scene: Scene, def: TrackDef) {
		const pts = def.points.map(([x, z]) => new Vector3(x, 0, z));
		const dense: Vector3[] = [];
		const n = pts.length;
		for (let i = 0; i < n; i++) {
			const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
			for (let k = 0; k < 60; k++) dense.push(Vector3.CatmullRom(p0, p1, p2, p3, k / 60));
		}
		const cum = [0];
		for (let i = 1; i <= dense.length; i++) cum.push(cum[i - 1] + Vector3.Distance(dense[i - 1], dense[i % dense.length]));
		this.length = Math.floor(cum[cum.length - 1]);
		let j = 0;
		for (let s = 0; s < this.length; s++) {
			while (cum[j + 1] < s) j++;
			const f = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
			this.P.push(Vector3.Lerp(dense[j], dense[(j + 1) % dense.length], f));
		}
		const L = this.length;
		for (let s = 0; s < L; s++) {
			const t = this.P[(s + 2) % L].subtract(this.P[(s - 2 + L) % L]).normalize();
			this.T.push(t);
			this.R.push(new Vector3(-t.z, 0, t.x));    // right of the direction of travel (left is -Z when facing +X)
		}
	}

	private idx(s: number) { const L = this.length; return ((Math.floor(s) % L) + L) % L; }
	/** Point on the track at distance s, moved `lateral` metres to the right (lanes are -LANE, 0, +LANE). */
	at(s: number, lateral = 0): Vector3 {
		const i = this.idx(s), k = (i + 1) % this.length, f = s - Math.floor(s);
		const p = Vector3.Lerp(this.P[i], this.P[k], f);
		return lateral ? p.add(Vector3.Lerp(this.R[i], this.R[k], f).scale(lateral)) : p;
	}
	tangent(s: number): Vector3 { const i = this.idx(s), k = (i + 1) % this.length; return Vector3.Lerp(this.T[i], this.T[k], s - Math.floor(s)).normalize(); }
	right(s: number): Vector3 { const t = this.tangent(s); return new Vector3(-t.z, 0, t.x); }
	heading(s: number): number { const t = this.tangent(s); return Math.atan2(-t.z, t.x); }
	/** How sharply the road bends here (radians per metre, sign = direction). */
	curvature(s: number): number {
		const a = this.heading(s - 6), b = this.heading(s + 6);
		return Math.atan2(Math.sin(b - a), Math.cos(b - a)) / 12;
	}

	// ---------------------------------------------------------------- building the scenery
	build(kit: Kit) {
		const scene = this.scene;
		this.sky();
		this.groundAndSea();
		this.road();
		this.curbs();
		this.promenade();
		this.scenery(kit);
		scene.fogMode = Scene.FOGMODE_LINEAR;
		scene.fogStart = 140; scene.fogEnd = 520;
		scene.fogColor = new Color3(0.80, 0.88, 0.95);
		scene.clearColor = new Color4(0.80, 0.88, 0.95, 1);
	}

	private tex(name: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, alpha = false) {
		const t = new DynamicTexture(name, { width: w, height: h }, this.scene, true);
		draw(t.getContext() as CanvasRenderingContext2D);
		t.update(true);
		t.hasAlpha = alpha;
		t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
		t.anisotropicFilteringLevel = 4;
		return t;
	}
	private flatMat(name: string, tex: DynamicTexture | null, color = new Color3(1, 1, 1), emissive = 0.35) {
		const m = new StandardMaterial(name, this.scene);
		if (tex) m.diffuseTexture = tex;
		m.diffuseColor = color;
		m.specularColor = new Color3(0.05, 0.05, 0.05);
		m.emissiveColor = color.scale(emissive);
		return m;
	}

	/** A ribbon following the track between two lateral offsets; v runs along the road (vScale metres per texture repeat). */
	private ribbon(name: string, from: number, to: number, y: number, vScale: number, step = 2, raise = 0) {
		const pos: number[] = [], uv: number[] = [], idx: number[] = [];
		const N = Math.ceil(this.length / step);
		for (let i = 0; i <= N; i++) {
			const s = Math.min(i * step, this.length);
			for (const [k, o] of [[0, from], [1, to]] as const) {
				const p = this.at(s % this.length, o);
				pos.push(p.x, y + (raise && k === 1 ? raise : 0), p.z);
				uv.push(k, s / vScale);
			}
			if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
		}
		const m = new Mesh(name, this.scene);
		const vd = new VertexData();
		vd.positions = pos; vd.indices = idx; vd.uvs = uv;
		const normals: number[] = [];
		VertexData.ComputeNormals(pos, idx, normals);
		vd.normals = normals;
		vd.applyToMesh(m);
		m.isPickable = false;
		m.freezeWorldMatrix();
		return m;
	}

	private road() {
		const t = this.tex('roadTex', 512, 512, c => {
			const g = c.createLinearGradient(0, 0, 512, 0);
			g.addColorStop(0, '#2c3346'); g.addColorStop(0.5, '#343c52'); g.addColorStop(1, '#2c3346');
			c.fillStyle = g; c.fillRect(0, 0, 512, 512);
			for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; c.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
			const lane = (x: number) => { c.fillStyle = '#7fe8ff'; c.shadowColor = '#5fdcff'; c.shadowBlur = 14; for (let y = 0; y < 512; y += 128) c.fillRect(x - 6, y, 12, 70); c.shadowBlur = 0; };
			const u = (o: number) => (o + HALF) / (2 * HALF) * 512;
			lane(u(-LANE / 2)); lane(u(LANE / 2));
			c.fillStyle = '#ffffff'; c.fillRect(u(-HALF + 0.35) - 5, 0, 10, 512); c.fillRect(u(HALF - 0.35) - 5, 0, 10, 512);
		});
		const m = this.ribbon('road', -HALF, HALF, 0.02, 14);
		m.material = this.flatMat('roadMat', t, new Color3(1, 1, 1), 0.25);
	}

	private curbs() {
		const t = this.tex('curbTex', 64, 256, c => {
			const cols = ['#d72631', '#ffffff', '#1f9d55', '#ffffff'];
			for (let i = 0; i < 4; i++) { c.fillStyle = cols[i]; c.fillRect(0, i * 64, 64, 64); }
		});
		const mat = this.flatMat('curbMat', t, new Color3(1, 1, 1), 0.3);
		for (const [a, b] of [[-HALF - 0.7, -HALF], [HALF, HALF + 0.7]]) {
			const m = this.ribbon('curb', a, b, 0.07, 4);
			m.material = mat;
		}
	}

	private promenade() {
		// The corniche walk: pale tiles beside the road wherever the sea is close.
		const t = this.tex('tileTex', 256, 256, c => {
			c.fillStyle = '#efe4cf'; c.fillRect(0, 0, 256, 256);
			c.strokeStyle = '#d8c8aa'; c.lineWidth = 4;
			for (let i = 0; i <= 256; i += 64) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 256); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(256, i); c.stroke(); }
		});
		const mat = this.flatMat('tileMat', t, new Color3(1, 1, 1), 0.3);
		for (const [a, b] of [[-HALF - 6.5, -HALF - 0.7], [HALF + 0.7, HALF + 6.5]]) {
			const m = this.ribbon('walk', a, b, 0.05, 6);
			m.material = mat;
		}
	}

	private groundAndSea() {
		const scene = this.scene;
		const sand = this.tex('sandTex', 256, 256, c => {
			c.fillStyle = '#e3cfa6'; c.fillRect(0, 0, 256, 256);
			for (let i = 0; i < 1600; i++) { c.fillStyle = `rgba(${150 + Math.random() * 60},${120 + Math.random() * 50},80,${Math.random() * 0.12})`; c.fillRect(Math.random() * 256, Math.random() * 256, 3, 3); }
		});
		sand.uScale = sand.vScale = 90;
		const ground = MeshBuilder.CreateGround('ground', { width: 1400, height: 900 }, scene);
		ground.position.set(90, -0.02, SEA_Z + 450);
		ground.material = this.flatMat('groundMat', sand, new Color3(1, 1, 1), 0.3);
		ground.isPickable = false; ground.freezeWorldMatrix();
		const beach = MeshBuilder.CreateGround('beach', { width: 1400, height: 14 }, scene);
		beach.position.set(90, -0.05, SEA_Z - 6);
		beach.material = this.flatMat('beachMat', null, new Color3(0.93, 0.84, 0.66), 0.35);
		this.seaTex = this.tex('seaTex', 256, 256, c => {
			c.fillStyle = '#1f8fb8'; c.fillRect(0, 0, 256, 256);
			for (let i = 0; i < 60; i++) {
				c.strokeStyle = `rgba(255,255,255,${0.10 + Math.random() * 0.18})`; c.lineWidth = 2 + Math.random() * 2;
				const x = Math.random() * 256, y = Math.random() * 256, w = 20 + Math.random() * 40;
				c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + w / 2, y - 6, x + w, y); c.stroke();
			}
		});
		this.seaTex.uScale = 60; this.seaTex.vScale = 30;
		const sea = MeshBuilder.CreateGround('sea', { width: 2400, height: 1200 }, scene);
		sea.position.set(90, -0.25, SEA_Z - 612);
		const sm = this.flatMat('seaMat', this.seaTex, new Color3(1, 1, 1), 0.45);
		sm.specularColor = new Color3(0.5, 0.5, 0.5); sm.specularPower = 64;
		sea.material = sm;
		sea.isPickable = false; sea.freezeWorldMatrix();
	}

	private sky() {
		const t = this.tex('skyTex', 16, 512, c => {
			const g = c.createLinearGradient(0, 0, 0, 512);
			g.addColorStop(0, '#3d8fe0'); g.addColorStop(0.45, '#8cc4f0'); g.addColorStop(0.5, '#cfe4f5'); g.addColorStop(1, '#cfe4f5');
			c.fillStyle = g; c.fillRect(0, 0, 16, 512);
		});
		const sky = MeshBuilder.CreateSphere('sky', { diameter: 1600, segments: 16, sideOrientation: Mesh.BACKSIDE }, this.scene);
		const m = new StandardMaterial('skyMat', this.scene);
		m.emissiveTexture = t; m.disableLighting = true; m.fogEnabled = false; m.backFaceCulling = false;
		sky.material = m; sky.infiniteDistance = true; sky.isPickable = false;
		// the Hajar mountains on the northern horizon (low-poly, one merged mesh)
		const mats = new StandardMaterial('mountMat', this.scene);
		mats.diffuseColor = new Color3(0.62, 0.50, 0.42); mats.specularColor = Color3.Black(); mats.emissiveColor = new Color3(0.22, 0.17, 0.15);
		const parts: Mesh[] = [];
		let seed = 7;
		const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
		for (let i = 0; i < 26; i++) {
			const h = 50 + rnd() * 90, r = 60 + rnd() * 70;
			const c = MeshBuilder.CreateCylinder('mnt', { diameterTop: 0, diameterBottom: r * 2, height: h, tessellation: 6 + Math.floor(rnd() * 3) }, this.scene);
			c.position.set(-650 + i * 55 + rnd() * 30, h / 2 - 2, 430 + rnd() * 140);
			c.rotation.y = rnd() * 3;
			parts.push(c);
		}
		const mountains = Mesh.MergeMeshes(parts, true)!;
		mountains.material = mats; mountains.isPickable = false; mountains.freezeWorldMatrix();
	}

	/** Lamps along the road, palms, houses and forts inside the loop, dhows on the sea. */
	private scenery(kit: Kit) {
		let seed = 11;
		const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
		const lamp = kit.prefab('Lamp_Post'), palm = kit.palmPrefab(), house = kit.prefab('House_Block'), fort = kit.prefab('Fort_Tower'),
			watch = kit.prefab('Watch_Tower'), dhow = kit.prefab('Dhow', false);
		const clear = (p: Vector3, r: number) => {
			// keep scenery off the road: no track point within r metres
			for (let s = 0; s < this.length; s += 4) if (Vector3.DistanceSquared(this.P[s], p) < r * r) return false;
			return true;
		};
		for (let s = 0; s < this.length; s += 28) {
			for (const side of [-1, 1]) {
				const p = this.at(s, side * (HALF + 7.2));
				if (!clear(p, HALF + 6.5)) continue;
				lamp.place(p, this.heading(s) + (side > 0 ? Math.PI / 2 : -Math.PI / 2), 1);
			}
		}
		for (let s = 10; s < this.length; s += 17) {
			const side = rnd() < 0.5 ? -1 : 1;
			const p = this.at(s, side * (HALF + 11 + rnd() * 8));
			if (p.z < SEA_Z + 4 || !clear(p, HALF + 9)) continue;
			palm.place(p, rnd() * 6.28, 0.55 + rnd() * 0.25);
		}
		// the town inside the loop and along the inland side
		for (let i = 0; i < 70; i++) {
			const p = new Vector3(-210 + rnd() * 600, 0, 20 + rnd() * 240);
			if (!clear(p, 22)) continue;
			house.place(p, Math.round(rnd() * 4) * Math.PI / 2, 0.8 + rnd() * 0.7);
		}
		for (const [x, z, k] of [[150, 95, 'fort'], [-60, 110, 'fort'], [300, 230, 'watch'], [-160, 230, 'watch'], [40, 250, 'fort']] as const) {
			const p = new Vector3(x, 0, z);
			if (clear(p, 20)) (k === 'fort' ? fort : watch).place(p, rnd() * 6.28, 1.6);
		}
		for (let i = 0; i < 7; i++) {
			const n = dhow.place(new Vector3(-150 + i * 70 + rnd() * 30, -0.2, SEA_Z - 35 - rnd() * 90), rnd() * 6.28, 1);
			this.dhows.push(n);
		}
	}

	update(dt: number) {
		this.time += dt;
		this.seaTex.uOffset = this.time * 0.004;
		this.seaTex.vOffset = Math.sin(this.time * 0.3) * 0.01;
		for (const [i, d] of this.dhows.entries()) {
			d.position.y = -0.2 + Math.sin(this.time * 0.9 + i) * 0.12;
			d.rotation.z = Math.sin(this.time * 0.7 + i * 2) * 0.03;
			d.position.x += Math.cos(d.rotation.y) * dt * 0.6;
			d.position.z -= Math.sin(d.rotation.y) * dt * 0.6;
		}
	}
}
