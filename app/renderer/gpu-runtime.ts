import initRenderWasm, {
  RenderCore,
} from "./wasm/sim_studio_render.js";
import renderWasmUrl from "./wasm/sim_studio_render_bg.wasm?url";
import * as THREE from "three";

let initialization: Promise<unknown> | undefined;
const ORIGIN = new THREE.Vector3();
// Three.js builds an OpenGL-style projection (depth -1..1). WebGPU expects
// depth 0..1, so remap clip-space Z before uploading the camera uniform.
const WEBGPU_CLIP_SPACE = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 0.5, 0.5,
  0, 0, 0, 1,
);

export type GpuPrototypeResult = {
  adapter: string;
  instances: number;
  frames: number;
  uploadMs: number;
  submitMs: number;
  averageSubmitMs: number;
};

export type GpuScenePiece = {
  id: number;
  part: string;
  color: number;
  mesh: THREE.Object3D;
};

export type GpuSceneStats = {
  adapter: string;
  drawCalls: number;
  triangles: number;
  lines: number;
  instances: number;
};

type GpuInstanceSource = {
  object: THREE.Object3D;
  material: THREE.Material;
  piece?: GpuScenePiece;
};

type MeshUploadGroup = {
  positions: number[];
  normals: number[];
  indices: number[];
  sources: GpuInstanceSource[];
};

type LineUploadGroup = {
  positions: number[];
  sources: GpuInstanceSource[];
};

const initialize = () =>
  (initialization ??= fetch(renderWasmUrl, { cache: "no-cache" })
    .then((response) => {
      if (!response.ok)
        throw new Error(`No se pudo cargar render-core (${response.status})`);
      return initRenderWasm({ module_or_path: response });
    })
    .catch((error) => {
      initialization = undefined;
      throw error;
    }));

export class GpuRenderPrototype {
  private constructor(
    private readonly core: RenderCore,
    private readonly canvas: HTMLCanvasElement,
  ) {}

  private readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
  private readonly viewProjection = new THREE.Matrix4();

  static supported() {
    return typeof navigator !== "undefined" && "gpu" in navigator;
  }

  static async create(canvas: HTMLCanvasElement) {
    if (!GpuRenderPrototype.supported())
      throw new Error("WebGPU no está disponible en este navegador");
    await initialize();
    return new GpuRenderPrototype(await RenderCore.create(canvas), canvas);
  }

  get adapterName() {
    return this.core.adapterName || "WebGPU";
  }

  /** Exercises the real Rust/WASM -> wgpu storage-buffer and render path. */
  benchmark(instances = 714, frames = 240): GpuPrototypeResult {
    const values = new Float32Array(instances * 20);
    for (let index = 0; index < instances; index++) {
      const offset = index * 20;
      const columns = Math.ceil(Math.sqrt(instances)),
        row = Math.floor(index / columns),
        column = index % columns;
      values[offset] = 0.72;
      values[offset + 5] = 0.72;
      values[offset + 10] = 0.72;
      values[offset + 15] = 1;
      values[offset + 12] = (column - columns / 2) * 0.92;
      values[offset + 13] = ((index * 13) % 7) * 0.11;
      values[offset + 14] = (row - columns / 2) * 0.92;
      values[offset + 16] = ((index * 37) % 255) / 255;
      values[offset + 17] = ((index * 73) % 255) / 255;
      values[offset + 18] = ((index * 109) % 255) / 255;
      values[offset + 19] = 1;
    }
    const uploadStarted = performance.now();
    this.core.uploadInstances(values);
    const uploadMs = performance.now() - uploadStarted,
      submitStarted = performance.now();
    for (let frame = 0; frame < frames; frame++) this.core.prepareFrame();
    const submitMs = performance.now() - submitStarted;
    return {
      adapter: this.adapterName,
      instances,
      frames,
      uploadMs,
      submitMs,
      averageSubmitMs: submitMs / frames,
    };
  }

  render(timeMs: number) {
    const width = Math.max(1, Math.round(this.canvas.clientWidth * devicePixelRatio)),
      height = Math.max(1, Math.round(this.canvas.clientHeight * devicePixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.core.resize(width, height);
    }
    const camera = this.camera,
      radius = 31,
      angle = timeMs * 0.00016;
    camera.aspect = width / height;
    camera.position.set(Math.cos(angle) * radius, 19, Math.sin(angle) * radius);
    camera.lookAt(ORIGIN);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    this.viewProjection
      .multiplyMatrices(WEBGPU_CLIP_SPACE, camera.projectionMatrix)
      .multiply(camera.matrixWorldInverse);
    this.core.uploadCamera(new Float32Array(this.viewProjection.elements));
    this.core.prepareFrame();
    return this.core.render();
  }

  dispose() {
    this.core.free();
  }
}

const materialColor = (material: THREE.Material, target: THREE.Color) => {
  const color = (material as THREE.Material & { color?: THREE.Color }).color;
  if (color instanceof THREE.Color) return target.copy(color);
  const uniformColor = (
    material as THREE.ShaderMaterial & {
      uniforms?: { diffuse?: { value?: unknown }; color?: { value?: unknown } };
    }
  ).uniforms?.diffuse?.value;
  if (uniformColor instanceof THREE.Color) return target.copy(uniformColor);
  return target.setHex(0x8fa4b2);
};

/**
 * Main viewport renderer. Three.js remains the scene graph and picking model,
 * while Rust/wgpu owns the visible canvas, geometry buffers and draw calls.
 */
export class GpuSceneRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly adapterName: string;
  private readonly viewProjection = new THREE.Matrix4();
  private readonly color = new THREE.Color();
  private readonly backgroundColor = new THREE.Color();
  private readonly cameraValues = new Float32Array(24);
  private instanceSources: GpuInstanceSource[] = [];
  private sceneSignature = -1;
  private instanceValues = new Float32Array(0);

  private constructor(
    private readonly core: RenderCore,
    canvas: HTMLCanvasElement,
  ) {
    this.canvas = canvas;
    this.adapterName = core.adapterName || "WebGPU";
  }

  static supported() {
    return GpuRenderPrototype.supported();
  }

  static async create(canvas: HTMLCanvasElement) {
    if (!GpuSceneRenderer.supported())
      throw new Error("WebGPU no está disponible en este navegador");
    await initialize();
    return new GpuSceneRenderer(await RenderCore.create(canvas), canvas);
  }

  private signature(pieces: readonly GpuScenePiece[], extras: readonly THREE.Object3D[]) {
    let hash = 0x811c9dc5;
    for (const piece of pieces) {
      hash = Math.imul(hash ^ piece.id, 0x01000193);
      hash = Math.imul(hash ^ piece.color, 0x01000193);
      hash = Math.imul(hash ^ piece.mesh.id, 0x01000193);
    }
    for (const extra of extras) hash = Math.imul(hash ^ extra.id, 0x01000193);
    return hash >>> 0;
  }

  private rebuild(pieces: readonly GpuScenePiece[], extras: readonly THREE.Object3D[]) {
    const meshes = new Map<string, MeshUploadGroup>(),
      lines = new Map<string, LineUploadGroup>(),
      point = new THREE.Vector3(),
      normalVector = new THREE.Vector3(),
      localMatrix = new THREE.Matrix4(),
      inverseRoot = new THREE.Matrix4(),
      normalMatrix = new THREE.Matrix3();
    const collectTemplate = (
      keyPrefix: string,
      root: THREE.Object3D,
      ignoreVisibility: boolean,
      sourcesForMaterial: (material: THREE.Material) => GpuInstanceSource[],
    ) => {
      root.updateMatrixWorld(true);
      inverseRoot.copy(root.matrixWorld).invert();
      root.traverse((object) => {
        if (!ignoreVisibility && !object.visible) return;
        if (object instanceof THREE.Mesh) {
          const geometry = object.geometry,
            position = geometry.getAttribute("position");
          if (!position?.count) return;
          localMatrix.multiplyMatrices(inverseRoot, object.matrixWorld);
          normalMatrix.getNormalMatrix(localMatrix);
          const materials = Array.isArray(object.material)
              ? object.material
              : [object.material],
            total = geometry.index?.count ?? position.count,
            ranges = geometry.groups.length
              ? geometry.groups
              : [{ start: 0, count: total, materialIndex: 0 }];
          for (const range of ranges) {
            const count = Math.min(range.count, total - range.start),
              material = materials[range.materialIndex ?? 0] ?? materials[0];
            if (!material || count < 3) continue;
            const key = `${keyPrefix}:mesh:${material.uuid}`,
              group = meshes.get(key) ?? {
                positions: [],
                normals: [],
                indices: [],
                sources: sourcesForMaterial(material),
              };
            const completeCount = count - (count % 3),
              geometryNormal = geometry.getAttribute("normal");
            for (let offset = 0; offset < completeCount; offset++) {
              const sourceIndex = geometry.index
                ? geometry.index.getX(range.start + offset)
                : range.start + offset,
                vertexIndex = group.positions.length / 3;
              point.fromBufferAttribute(position, sourceIndex).applyMatrix4(localMatrix);
              group.positions.push(point.x, point.y, point.z);
              if (geometryNormal)
                normalVector
                  .fromBufferAttribute(geometryNormal, sourceIndex)
                  .applyMatrix3(normalMatrix)
                  .normalize();
              else normalVector.set(0, 1, 0);
              group.normals.push(normalVector.x, normalVector.y, normalVector.z);
              group.indices.push(vertexIndex);
            }
            meshes.set(key, group);
          }
        } else if (object instanceof THREE.LineSegments) {
          const geometry = object.geometry;
          if (
            geometry.hasAttribute("control0") &&
            geometry.hasAttribute("control1") &&
            geometry.hasAttribute("direction")
          )
            return;
          const position = geometry.getAttribute("position");
          if (!position?.count) return;
          localMatrix.multiplyMatrices(inverseRoot, object.matrixWorld);
          const materials = Array.isArray(object.material)
              ? object.material
              : [object.material],
            total = geometry.index?.count ?? position.count,
            ranges = geometry.groups.length
              ? geometry.groups
              : [{ start: 0, count: total, materialIndex: 0 }];
          for (const range of ranges) {
            const count = Math.min(range.count, total - range.start),
              material = materials[range.materialIndex ?? 0] ?? materials[0];
            if (!material || count < 2) continue;
            const key = `${keyPrefix}:line:${material.uuid}`,
              group = lines.get(key) ?? {
                positions: [],
                sources: sourcesForMaterial(material),
              };
            const completeCount = count - (count % 2);
            for (let offset = 0; offset < completeCount; offset++) {
              const sourceIndex = geometry.index
                ? geometry.index.getX(range.start + offset)
                : range.start + offset;
              point.fromBufferAttribute(position, sourceIndex).applyMatrix4(localMatrix);
              group.positions.push(point.x, point.y, point.z);
            }
            lines.set(key, group);
          }
        }
      });
    };
    const pieceGroups = new Map<string, GpuScenePiece[]>();
    for (const piece of pieces) {
      const key = `${piece.part}:${piece.color}`,
        group = pieceGroups.get(key) ?? [];
      group.push(piece);
      pieceGroups.set(key, group);
    }
    for (const [key, groupedPieces] of pieceGroups) {
      const template = groupedPieces[0];
      collectTemplate(key, template.mesh, true, (material) =>
        groupedPieces.map((piece) => ({ object: piece.mesh, material, piece })),
      );
    }
    extras.forEach((object) =>
      collectTemplate(`extra:${object.id}`, object, false, (material) => [
        { object, material },
      ]),
    );
    this.core.clearGeometry();
    this.instanceSources = [];
    for (const group of meshes.values()) {
      const firstInstance = this.instanceSources.length;
      this.instanceSources.push(...group.sources);
      this.core.addMesh(
        new Float32Array(group.positions),
        new Float32Array(group.normals),
        new Uint32Array(group.indices),
        firstInstance,
        group.sources.length,
      );
    }
    for (const group of lines.values()) {
      const firstInstance = this.instanceSources.length;
      this.instanceSources.push(...group.sources);
      this.core.addLines(
        new Float32Array(group.positions),
        firstInstance,
        group.sources.length,
      );
    }
    this.instanceValues = new Float32Array(this.instanceSources.length * 20);
  }

  resize(cssWidth: number, cssHeight: number, requestedPixelRatio: number) {
    // Never render below one physical pixel per CSS pixel: sub-native canvas
    // sizes made the WebGPU viewport visibly blocky even at a healthy FPS.
    // DPR 2 remains a practical ceiling for high-density/mobile displays.
    const pixelRatio = Math.min(2, Math.max(1, requestedPixelRatio)),
      width = Math.max(1, Math.round(cssWidth * pixelRatio)),
      height = Math.max(1, Math.round(cssHeight * pixelRatio));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.core.resize(width, height);
  }

  render(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    pieces: readonly GpuScenePiece[],
    selected: ReadonlySet<object>,
    extras: readonly THREE.Object3D[],
  ): GpuSceneStats {
    const visiblePieces = pieces.filter((piece) => piece.mesh.visible),
      signature = this.signature(visiblePieces, extras);
    if (signature !== this.sceneSignature) {
      this.rebuild(visiblePieces, extras);
      this.sceneSignature = signature;
    }
    visiblePieces.forEach((piece) => piece.mesh.updateMatrixWorld(true));
    extras.forEach((object) => object.updateMatrixWorld(true));
    for (let index = 0; index < this.instanceSources.length; index++) {
      const source = this.instanceSources[index],
        offset = index * 20;
      source.object.matrixWorld.toArray(this.instanceValues, offset);
      materialColor(source.material, this.color);
      this.instanceValues[offset + 16] = this.color.r;
      this.instanceValues[offset + 17] = this.color.g;
      this.instanceValues[offset + 18] = this.color.b;
      this.instanceValues[offset + 19] =
        source.piece && selected.has(source.piece) ? 1 : 0;
    }
    this.core.uploadInstances(this.instanceValues);
    camera.updateMatrixWorld(true);
    this.viewProjection
      .multiplyMatrices(WEBGPU_CLIP_SPACE, camera.projectionMatrix)
      .multiply(camera.matrixWorldInverse);
    this.viewProjection.toArray(this.cameraValues, 0);
    this.cameraValues[16] = camera.position.x;
    this.cameraValues[17] = camera.position.y;
    this.cameraValues[18] = camera.position.z;
    const fog = scene.fog;
    if (fog instanceof THREE.Fog) {
      this.cameraValues[19] = fog.near;
      this.cameraValues[20] = fog.color.r;
      this.cameraValues[21] = fog.color.g;
      this.cameraValues[22] = fog.color.b;
      this.cameraValues[23] = fog.far;
    } else {
      this.cameraValues.fill(0, 19, 24);
      this.cameraValues[19] = 1;
    }
    this.core.uploadCamera(this.cameraValues);
    const background = scene.background;
    if (background instanceof THREE.Color) {
      this.backgroundColor.copy(background).convertLinearToSRGB();
      this.core.setClearColor(
        this.backgroundColor.r,
        this.backgroundColor.g,
        this.backgroundColor.b,
        1,
      );
      this.canvas.dataset.clearColor = this.backgroundColor.getHexString();
    }
    const presented = this.core.render();
    this.canvas.dataset.drawCalls = String(this.core.drawCalls);
    this.canvas.dataset.triangles = String(this.core.triangleCount);
    this.canvas.dataset.lines = String(this.core.lineCount);
    this.canvas.dataset.instances = String(this.instanceSources.length);
    this.canvas.dataset.presented = String(presented);
    return {
      adapter: this.adapterName,
      drawCalls: this.core.drawCalls,
      triangles: this.core.triangleCount,
      lines: this.core.lineCount,
      instances: this.instanceSources.length,
    };
  }

  invalidate() {
    this.sceneSignature = -1;
  }

  dispose() {
    this.core.free();
  }
}
