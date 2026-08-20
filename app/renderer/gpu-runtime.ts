import initRenderWasm, {
  RenderCore,
} from "./wasm/sim_studio_render.js";
import renderWasmUrl from "./wasm/sim_studio_render_bg.wasm?url";
import { Matrix4, PerspectiveCamera, Vector3 } from "three";

let initialization: Promise<unknown> | undefined;
const ORIGIN = new Vector3();
// Three.js builds an OpenGL-style projection (depth -1..1). WebGPU expects
// depth 0..1, so remap clip-space Z before uploading the camera uniform.
const WEBGPU_CLIP_SPACE = new Matrix4().set(
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

const initialize = () =>
  (initialization ??= initRenderWasm({ module_or_path: renderWasmUrl }).catch((error) => {
    initialization = undefined;
    throw error;
  }));

export class GpuRenderPrototype {
  private constructor(
    private readonly core: RenderCore,
    private readonly canvas: HTMLCanvasElement,
  ) {}

  private readonly camera = new PerspectiveCamera(48, 1, 0.1, 200);
  private readonly viewProjection = new Matrix4();

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
