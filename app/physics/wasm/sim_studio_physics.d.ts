/* tslint:disable */
/* eslint-disable */

/**
 * The only object exported to JavaScript. Rapier bodies, colliders and joints
 * never cross this boundary, preventing wasm-bindgen aliasing/ownership errors.
 */
export class PhysicsEngine {
    free(): void;
    [Symbol.dispose](): void;
    add_joint(joint: any): boolean;
    constructor(scene: any);
    remove_joint(id: string): boolean;
    replace_gears(gears: any): void;
    set_excluded_collider_pairs(pairs: any): void;
    stats(): any;
    /**
     * Advances motors, forces, constraints and Rapier as one Rust operation.
     * The returned flat array contains 15 floats per body:
     * id, position(3), quaternion(4), linear velocity(3), angular velocity(3), sleeping.
     */
    step(delta_seconds: number, commands: any): Float32Array;
    /**
     * Returns and clears collider-owner pairs observed since the last call.
     * TypeScript uses this topology-only information to discover axle entries;
     * all contact solving remains in Rust.
     */
    take_contact_pairs(): any;
    transform_stride(): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_physicsengine_free: (a: number, b: number) => void;
    readonly physicsengine_add_joint: (a: number, b: number, c: number) => void;
    readonly physicsengine_new: (a: number, b: number) => void;
    readonly physicsengine_remove_joint: (a: number, b: number, c: number) => number;
    readonly physicsengine_replace_gears: (a: number, b: number, c: number) => void;
    readonly physicsengine_set_excluded_collider_pairs: (a: number, b: number, c: number) => void;
    readonly physicsengine_stats: (a: number, b: number) => void;
    readonly physicsengine_step: (a: number, b: number, c: number, d: number) => void;
    readonly physicsengine_take_contact_pairs: (a: number, b: number) => void;
    readonly physicsengine_transform_stride: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
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
