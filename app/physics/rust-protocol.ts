/**
 * Serializable boundary between the editor and the Rust physics core.
 *
 * Keep this module free of Three.js and Rapier objects. Every value crossing
 * the WASM boundary is a number, string or plain array.
 */

export type RustVec3 = [number, number, number];
export type RustQuat = [number, number, number, number];

export type RustColliderShape =
  | { kind: "box"; halfExtents: RustVec3 }
  | { kind: "cylinder"; halfHeight: number; radius: number }
  | { kind: "triMesh"; vertices: number[]; indices: number[] };

export type RustColliderConfig = {
  ownerId: number;
  center: RustVec3;
  rotation: RustQuat;
  friction: number;
  density: number;
  collisionGroup: number;
  collisionMask: number;
  shape: RustColliderShape;
};

export type RustBodyConfig = {
  id: number;
  fixed: boolean;
  position: RustVec3;
  rotation: RustQuat;
  mass: number;
  linearDamping: number;
  angularDamping: number;
  additionalSolverIterations: number;
  ccd: boolean;
  colliders: RustColliderConfig[];
};

export type RustJointConfig = {
  id: string;
  bodyA: number;
  bodyB: number;
  mode: "fixed" | "rotation" | "linear" | "rotation-linear" | "motor";
  worldAnchorA: RustVec3;
  worldAnchorB: RustVec3;
  worldAxisA: RustVec3;
  worldAxisB: RustVec3;
  travel: number;
  motorSpeed: number;
  motorForce: number;
  passiveMotorForce: number;
  dynamicAxle: boolean;
};

export type RustGearConfig = {
  id: string;
  nodeA: number;
  nodeB: number;
  bodyA: number;
  bodyB: number;
  axisA: RustVec3;
  axisB: RustVec3;
  centerA: RustVec3;
  centerB: RustVec3;
  /** World-space ray that crosses a tooth centre on gear A. */
  referenceA: RustVec3;
  /** World-space ray that crosses a tooth centre on gear B. */
  referenceB: RustVec3;
  teethA: number;
  teethB: number;
  signB: number;
  /** Enables tooth/gap phase locking for ordinary even-tooth gears. */
  phaseLock: boolean;
};

export type RustAxialStopConfig = {
  bodyA: number;
  bodyB: number;
  hostPoint: RustVec3;
  stopPoint: RustVec3;
  worldAxis: RustVec3;
  side: 1 | -1;
  minimumDistance: number;
};

export type RustPhysicsScene = {
  gravity: RustVec3;
  settings: {
    solverIterations: number;
    internalPgsIterations: number;
    allowedLinearError: number;
    maxCcdSubsteps: number;
    largeSimulation: boolean;
    axleSlidingFriction: number;
    axleRotationFriction: number;
  };
  bodies: RustBodyConfig[];
  joints: RustJointConfig[];
  gears: RustGearConfig[];
  axialStops: RustAxialStopConfig[];
  excludedColliderPairs: [number, number][];
};

export type RustPhysicsCommand =
  | {
      kind: "spring";
      body: number;
      worldPoint: RustVec3;
      target: RustVec3;
      stiffness: number;
      damping: number;
      maxForce: number;
    }
  | { kind: "impulse"; body: number; impulse: RustVec3; worldPoint?: RustVec3 }
  | { kind: "torqueImpulse"; body: number; impulse: RustVec3 }
  | { kind: "setFixed"; body: number; fixed: boolean }
  | { kind: "setTranslation"; body: number; position: RustVec3 }
  | { kind: "setRotation"; body: number; rotation: RustQuat }
  | { kind: "setLinearVelocity"; body: number; velocity: RustVec3 }
  | { kind: "setAngularVelocity"; body: number; velocity: RustVec3 }
  | { kind: "setDamping"; body: number; linear: number; angular: number }
  | { kind: "setMotor"; joint: string; speed: number; force: number };

export type RustStepStats = {
  bodies: number;
  activeBodies: number;
  sleepingBodies: number;
  joints: number;
  gears: number;
  substeps: number;
  maxSpringForce: number;
};
