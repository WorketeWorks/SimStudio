import initPhysicsWasm, {
  PhysicsEngine,
} from "./wasm/sim_studio_physics.js";
import physicsWasmUrl from "./wasm/sim_studio_physics_bg.wasm?url";
import type {
  RustGearConfig,
  RustJointConfig,
  RustPhysicsCommand,
  RustPhysicsScene,
  RustQuat,
  RustStepStats,
  RustVec3,
} from "./rust-protocol";

let wasmInitialization: Promise<unknown> | undefined;

const initializeWasm = () =>
  (wasmInitialization ??= initPhysicsWasm({
    module_or_path: physicsWasmUrl,
  }).catch((error) => {
    wasmInitialization = undefined;
    throw error;
  }));

type VectorLike = { x: number; y: number; z: number };
type QuaternionLike = VectorLike & { w: number };

export type RustBodyState = {
  position: RustVec3;
  rotation: RustQuat;
  linearVelocity: RustVec3;
  angularVelocity: RustVec3;
  sleeping: boolean;
};

const copyVector = (value: VectorLike): RustVec3 => [value.x, value.y, value.z];
const copyQuaternion = (value: QuaternionLike): RustQuat => [
  value.x,
  value.y,
  value.z,
  value.w,
];

/**
 * Numeric facade used by the editor while Rust retains sole ownership of the
 * actual Rapier body. Mutations become commands consumed by the next step.
 */
export class RustBodyProxy {
  readonly handle: number;
  private state: RustBodyState;

  constructor(
    private readonly runtime: RustPhysicsRuntime,
    id: number,
    private readonly bodyMass: number,
    initial: RustBodyState,
  ) {
    this.handle = id;
    this.state = initial;
  }

  update(state: RustBodyState) {
    this.state = state;
  }

  translation() {
    const [x, y, z] = this.state.position;
    return { x, y, z };
  }

  rotation() {
    const [x, y, z, w] = this.state.rotation;
    return { x, y, z, w };
  }

  linvel() {
    const [x, y, z] = this.state.linearVelocity;
    return { x, y, z };
  }

  angvel() {
    const [x, y, z] = this.state.angularVelocity;
    return { x, y, z };
  }

  mass() {
    return this.bodyMass;
  }

  isSleeping() {
    return this.state.sleeping;
  }

  setTranslation(value: VectorLike, _wakeUp = true) {
    void _wakeUp;
    this.runtime.enqueue({
      kind: "setTranslation",
      body: this.handle,
      position: copyVector(value),
    });
  }

  setRotation(value: QuaternionLike, _wakeUp = true) {
    void _wakeUp;
    this.runtime.enqueue({
      kind: "setRotation",
      body: this.handle,
      rotation: copyQuaternion(value),
    });
  }

  setLinvel(value: VectorLike, _wakeUp = true) {
    void _wakeUp;
    this.runtime.enqueue({
      kind: "setLinearVelocity",
      body: this.handle,
      velocity: copyVector(value),
    });
  }

  setAngvel(value: VectorLike, _wakeUp = true) {
    void _wakeUp;
    this.runtime.enqueue({
      kind: "setAngularVelocity",
      body: this.handle,
      velocity: copyVector(value),
    });
  }

  setLinearDamping(linear: number) {
    this.runtime.setDamping(this.handle, linear, undefined);
  }

  setAngularDamping(angular: number) {
    this.runtime.setDamping(this.handle, undefined, angular);
  }

  applyImpulse(value: VectorLike, _wakeUp = true) {
    void _wakeUp;
    this.runtime.enqueue({
      kind: "impulse",
      body: this.handle,
      impulse: copyVector(value),
    });
  }

  applyImpulseAtPoint(value: VectorLike, point: VectorLike, _wakeUp = true) {
    void _wakeUp;
    this.runtime.enqueue({
      kind: "impulse",
      body: this.handle,
      impulse: copyVector(value),
      worldPoint: copyVector(point),
    });
  }

  applyTorqueImpulse(value: VectorLike, _wakeUp = true) {
    void _wakeUp;
    this.runtime.enqueue({
      kind: "torqueImpulse",
      body: this.handle,
      impulse: copyVector(value),
    });
  }

  setFixed(fixed: boolean) {
    this.runtime.enqueue({ kind: "setFixed", body: this.handle, fixed });
  }

  /** Compatibility with the old editor call site without exposing Rapier's enum. */
  setBodyType(type: number | string | boolean, _wakeUp = true) {
    void _wakeUp;
    const fixed =
      typeof type === "boolean"
        ? type
        : typeof type === "string"
          ? type.toLowerCase() === "fixed"
          : type === 1;
    this.setFixed(fixed);
  }
}

export class RustJointProxy {
  constructor(
    private readonly runtime: RustPhysicsRuntime,
    readonly id: string,
  ) {}

  configureMotorVelocity(speed: number, force: number) {
    this.runtime.enqueue({ kind: "setMotor", joint: this.id, speed, force });
  }
}

/** Owns the single wasm-bindgen object and the cached numeric body states. */
export class RustPhysicsRuntime {
  readonly bodies = new Map<number, RustBodyProxy>();
  readonly joints = new Map<string, RustJointProxy>();
  timestep = 1 / 60;
  private commands: RustPhysicsCommand[] = [];
  private damping = new Map<number, { linear: number; angular: number }>();

  private constructor(
    private readonly engine: PhysicsEngine,
    readonly scene: RustPhysicsScene,
  ) {
    for (const body of scene.bodies) {
      const proxy = new RustBodyProxy(this, body.id, body.mass, {
        position: [...body.position],
        rotation: [...body.rotation],
        linearVelocity: [0, 0, 0],
        angularVelocity: [0, 0, 0],
        sleeping: body.fixed,
      });
      this.bodies.set(body.id, proxy);
      this.damping.set(body.id, {
        linear: body.linearDamping,
        angular: body.angularDamping,
      });
    }
    scene.joints.forEach((joint) =>
      this.joints.set(joint.id, new RustJointProxy(this, joint.id)),
    );
  }

  static async create(scene: RustPhysicsScene) {
    await initializeWasm();
    return new RustPhysicsRuntime(new PhysicsEngine(scene), scene);
  }

  enqueue(command: RustPhysicsCommand) {
    this.commands.push(command);
  }

  applySpring(options: {
    body: number;
    worldPoint: VectorLike;
    target: VectorLike;
    stiffness: number;
    damping: number;
    maxForce: number;
  }) {
    this.enqueue({
      kind: "spring",
      body: options.body,
      worldPoint: copyVector(options.worldPoint),
      target: copyVector(options.target),
      stiffness: options.stiffness,
      damping: options.damping,
      maxForce: options.maxForce,
    });
  }

  setDamping(body: number, linear?: number, angular?: number) {
    const current = this.damping.get(body) ?? { linear: 0, angular: 0 };
    if (linear !== undefined) current.linear = linear;
    if (angular !== undefined) current.angular = angular;
    this.damping.set(body, current);
    this.enqueue({ kind: "setDamping", body, ...current });
  }

  step(deltaSeconds = this.timestep) {
    const commands = this.commands;
    this.commands = [];
    const output = this.engine.step(deltaSeconds, commands);
    const stride = this.engine.transform_stride();
    for (let offset = 0; offset + stride <= output.length; offset += stride) {
      const id = output[offset];
      this.bodies.get(id)?.update({
        position: [output[offset + 1], output[offset + 2], output[offset + 3]],
        rotation: [
          output[offset + 4],
          output[offset + 5],
          output[offset + 6],
          output[offset + 7],
        ],
        linearVelocity: [output[offset + 8], output[offset + 9], output[offset + 10]],
        angularVelocity: [output[offset + 11], output[offset + 12], output[offset + 13]],
        sleeping: output[offset + 14] !== 0,
      });
    }
    return output;
  }

  stats() {
    return this.engine.stats() as RustStepStats;
  }

  replaceGears(gears: RustGearConfig[]) {
    this.engine.replace_gears(gears);
  }

  addJoint(joint: RustJointConfig) {
    const created = this.engine.add_joint(joint);
    if (created) this.joints.set(joint.id, new RustJointProxy(this, joint.id));
    return created;
  }

  removeJoint(id: string) {
    const removed = this.engine.remove_joint(id);
    if (removed) this.joints.delete(id);
    return removed;
  }

  setExcludedColliderPairs(pairs: [number, number][]) {
    this.engine.set_excluded_collider_pairs(pairs);
  }

  setExcludedColliderPair(left: number, right: number, excluded: boolean) {
    this.engine.set_excluded_collider_pair(left, right, excluded);
  }

  takeContactPairs() {
    return this.engine.take_contact_pairs() as [number, number][];
  }

  free() {
    this.commands = [];
    this.bodies.clear();
    this.joints.clear();
    this.engine.free();
  }
}
