import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import init, { PhysicsEngine } from "../app/physics/wasm/sim_studio_physics.js";

const wasm = new URL(
  "../app/physics/wasm/sim_studio_physics_bg.wasm",
  import.meta.url,
);

await init({ module_or_path: await readFile(wasm) });

const settings = {
  solverIterations: 8,
  internalPgsIterations: 2,
  allowedLinearError: 0.005,
  maxCcdSubsteps: 1,
  largeSimulation: false,
  axleSlidingFriction: 0.08,
  axleRotationFriction: 0.02,
};

test("Rust/WASM advances a non-empty Rapier scene and returns packed transforms", () => {
  const engine = new PhysicsEngine({
    gravity: [0, -9.81, 0],
    settings,
    bodies: [
      {
        id: 1,
        fixed: false,
        position: [0, 3, 0],
        rotation: [0, 0, 0, 1],
        mass: 1,
        linearDamping: 0.1,
        angularDamping: 0.1,
        additionalSolverIterations: 1,
        ccd: true,
        colliders: [
          {
            ownerId: 101,
            center: [0, 0, 0],
            rotation: [0, 0, 0, 1],
            friction: 0.2,
            density: 1,
            collisionGroup: 1,
            collisionMask: 3,
            shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] },
          },
        ],
      },
    ],
    joints: [],
    gears: [],
    differentials: [],
    excludedColliderPairs: [],
  });

  let transforms;
  transforms = engine.step(1 / 60, [
    {
      kind: "spring",
      body: 1,
      worldPoint: [0, 3, 0],
      target: [1, 3, 0],
      stiffness: 42,
      damping: 13,
      maxForce: 100,
    },
  ]);
  assert.ok(engine.stats().maxSpringForce > 0);
  for (let frame = 1; frame < 30; frame++) transforms = engine.step(1 / 60, []);
  assert.equal(engine.transform_stride(), 15);
  assert.equal(transforms.length, 15);
  assert.equal(transforms[0], 1);
  assert.ok(transforms[2] < 3, "gravity should move the body down");
  assert.equal(engine.stats().bodies, 1);
  engine.free();
});

test("gear ratios and motor joints are solved inside Rust", () => {
  const body = (id, fixed = false) => ({
    id,
    fixed,
    position: [id * 2, 3, 0],
    rotation: [0, 0, 0, 1],
    mass: 1,
    linearDamping: 0,
    angularDamping: 0,
    additionalSolverIterations: 2,
    ccd: false,
    colliders: [
      {
        ownerId: id + 200,
        center: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        friction: 0,
        density: 1,
        collisionGroup: 1,
        collisionMask: 0,
        shape: { kind: "box", halfExtents: [0.25, 0.25, 0.25] },
      },
    ],
  });
  const engine = new PhysicsEngine({
    gravity: [0, 0, 0],
    settings,
    bodies: [body(1), body(2), body(3, true), body(4)],
    joints: [
      {
        id: "motor",
        bodyA: 3,
        bodyB: 4,
        mode: "motor",
        worldAnchorA: [6, 3, 0],
        worldAnchorB: [6, 3, 0],
        worldAxis: [0, 1, 0],
        travel: 0,
        motorSpeed: 4,
        motorForce: 100,
        passiveMotorForce: 0,
        dynamicAxle: false,
      },
    ],
    gears: [
      {
        id: "1:2",
        nodeA: 1,
        nodeB: 2,
        bodyA: 1,
        bodyB: 2,
        axisA: [0, 1, 0],
        axisB: [0, 1, 0],
        centerA: [2, 3, 0],
        centerB: [4, 3, 0],
        teethA: 20,
        teethB: 10,
        signB: 1,
      },
    ],
    differentials: [],
    excludedColliderPairs: [],
  });

  let transforms = engine.step(1 / 60, [
    { kind: "setAngularVelocity", body: 1, velocity: [0, 3, 0] },
  ]);
  for (let frame = 0; frame < 20; frame++) transforms = engine.step(1 / 60, []);
  const stride = engine.transform_stride();
  const gearA = transforms[12];
  const gearB = transforms[stride + 12];
  const motor = transforms[stride * 3 + 12];
  assert.ok(Math.abs(20 * gearA + 10 * gearB) < 0.01);
  assert.ok(
    Math.abs(motor) > 0.1,
    `the native motor should rotate its body: ${JSON.stringify(Array.from(transforms))}`,
  );
  engine.free();
});
