// The race kit (assets/race-kit.glb, pipeline/build_race_kit.py) and the shared Omani kit (assets/kit.glb, for palms).
// Scenery is drawn with instances of one hidden source per piece; gates and the car are real copies because their
// materials change (lane colours, sign text, car paint).
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { AssetContainer } from '@babylonjs/core/assetContainer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Material } from '@babylonjs/core/Materials/material';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import '@babylonjs/loaders/glTF/2.0';

export class Prefab {
	private parts: { mesh: Mesh; local: Matrix }[] = [];
	constructor(root: TransformNode, private freeze = true) {
		root.computeWorldMatrix(true);
		const inv = root.getWorldMatrix().clone().invert();
		for (const m of [root, ...root.getChildMeshes(false)] as AbstractMesh[]) {
			if (!(m instanceof Mesh) || !m.getTotalVertices()) continue;
			m.computeWorldMatrix(true);
			this.parts.push({ mesh: m, local: m.getWorldMatrix().multiply(inv) });
			m.isPickable = false;
		}
		root.position.y -= 1000;                  // the sources stay out of sight; their instances are what is drawn
	}
	place(p: Vector3, yaw: number, scale = 1, name = 'piece'): TransformNode {
		const n = new TransformNode(name, this.parts[0]?.mesh.getScene());
		n.position.copyFrom(p);
		n.rotation.y = yaw;
		n.scaling.setAll(scale);
		for (const { mesh, local } of this.parts) {
			const inst = mesh.createInstance(name + '_' + mesh.name);
			inst.parent = n;
			const s = new Vector3(), q = new Quaternion(), t = new Vector3();
			local.decompose(s, q, t);
			inst.position = t; inst.rotationQuaternion = q; inst.scaling = s;
			inst.isPickable = false;
		}
		if (this.freeze) { n.computeWorldMatrix(true); for (const c of n.getChildMeshes()) c.freezeWorldMatrix(); }
		return n;
	}
}

export class Kit {
	private constructor(readonly scene: Scene, readonly race: AssetContainer, readonly omani: AssetContainer) {}

	static async load(scene: Scene, base: string, onProgress?: (p: number) => void) {
		const [race, omani] = await Promise.all([
			SceneLoader.LoadAssetContainerAsync(base + 'assets/', 'race-kit.glb', scene, e => e.lengthComputable && onProgress?.(e.loaded / e.total)),
			SceneLoader.LoadAssetContainerAsync(base + 'assets/', 'kit.glb', scene)
		]);
		for (const c of [race, omani]) {
			for (const m of c.materials) { scene.addMaterial(m); (m as any).maxSimultaneousLights = 2; }
			for (const t of c.textures) scene.addTexture(t);
		}
		// No environment map on phones (cheap lighting): full metals would render black, so they become bright, slightly
		// glossy paint; gold glows a little so the shields read as treasure.
		for (const m of race.materials) {
			if (!(m instanceof PBRMaterial)) continue;
			if (m.metallic !== null && m.metallic > 0.5) { m.metallic = 0.15; m.roughness = 0.35; }
			if (m.name === 'Gold') m.emissiveColor = new Color3(0.55, 0.36, 0.06);
			if (m.name === 'Chrome') m.emissiveColor = new Color3(0.25, 0.26, 0.28);
		}
		return new Kit(scene, race, omani);
	}

	/** A fresh copy of one node of a container and everything under it, at the origin, unparented. */
	copy(node: string, from: AssetContainer = this.race, newName = node): TransformNode | null {
		const inside = (e: any) => { for (let a = e; a; a = a.parent) if (a.name === node) return true; return false; };
		const inst = from.instantiateModelsToScene(n => n, false, { doNotInstantiate: true, predicate: (e: any) => e.name === '__root__' || inside(e) });
		let found: TransformNode | null = null;
		for (const r of inst.rootNodes) for (const n of [r, ...r.getDescendants(false)]) if (n.name === node && !found) found = n as TransformNode;
		if (found) { found.parent = null; found.position.setAll(0); }
		for (const r of inst.rootNodes) if (r !== found) r.dispose();
		if (!found) { console.warn('[kit] missing', node); return null; }
		found.name = newName;
		for (const n of [found, ...found.getDescendants(false)]) {
			const t = n as TransformNode;
			if (t.rotationQuaternion && n !== found) { t.rotation = t.rotationQuaternion.toEulerAngles(); t.rotationQuaternion = null; }
		}
		if (found.rotationQuaternion) { found.rotation = found.rotationQuaternion.toEulerAngles(); found.rotationQuaternion = null; }
		return found;
	}

	prefab(node: string, freeze = true) { return new Prefab(this.copy(node)!, freeze); }
	palmPrefab() {
		const p = this.copy('Palm_0', this.omani)!;
		p.rotation.setAll(0);
		return new Prefab(p);
	}
	material(name: string): Material | null { return this.scene.materials.find(m => m.name === name) ?? null; }
}
