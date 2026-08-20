/* tslint:disable */
/* eslint-disable */

export class RenderCore {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    addLines(positions: Float32Array, first_instance: number, instance_count: number): void;
    addMesh(positions: Float32Array, normals: Float32Array, indices: Uint32Array, first_instance: number, instance_count: number): void;
    clearGeometry(): void;
    static create(canvas: HTMLCanvasElement): Promise<RenderCore>;
    prepareFrame(): void;
    render(): boolean;
    resize(width: number, height: number): void;
    setClearColor(red: number, green: number, blue: number, alpha: number): void;
    uploadCamera(matrix: Float32Array): void;
    /**
     * Uploads mat4 + RGBA/flags (20 floats per instance) in one boundary call.
     */
    uploadInstances(values: Float32Array): void;
    readonly adapterName: string;
    readonly drawCalls: number;
    readonly instanceCount: number;
    readonly lineCount: number;
    readonly triangleCount: number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_rendercore_free: (a: number, b: number) => void;
    readonly rendercore_adapterName: (a: number, b: number) => void;
    readonly rendercore_addLines: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly rendercore_addMesh: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly rendercore_clearGeometry: (a: number) => void;
    readonly rendercore_create: (a: number) => number;
    readonly rendercore_drawCalls: (a: number) => number;
    readonly rendercore_instanceCount: (a: number) => number;
    readonly rendercore_lineCount: (a: number) => number;
    readonly rendercore_prepareFrame: (a: number) => void;
    readonly rendercore_render: (a: number, b: number) => void;
    readonly rendercore_resize: (a: number, b: number, c: number) => void;
    readonly rendercore_setClearColor: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly rendercore_triangleCount: (a: number) => number;
    readonly rendercore_uploadCamera: (a: number, b: number, c: number, d: number) => void;
    readonly rendercore_uploadInstances: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_1278: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_1293: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_341: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export5: (a: number, b: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
