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
        worldAxisA: [0, 1, 0],
        worldAxisB: [0, 1, 0],
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
        referenceA: [0, 0, 1],
        referenceB: [0, 0, 1],
        teethA: 20,
        teethB: 10,
        signB: 1,
        phaseLock: false,
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
  const contactVelocityA = transforms[10] - gearA * (4 / 3);
  const contactVelocityB = transforms[stride + 10] + gearB * (2 / 3);
  const motor = transforms[stride * 3 + 12];
  assert.ok(
    Math.abs(contactVelocityA - contactVelocityB) < 0.01,
    `the two pitch surfaces must have zero relative velocity: ${contactVelocityA} vs ${contactVelocityB}; ${JSON.stringify(Array.from(transforms))}`,
  );
  assert.ok(
    Math.abs(motor) > 0.1,
    `the native motor should rotate its body: ${JSON.stringify(Array.from(transforms))}`,
  );
  engine.free();
});

test("a seven-gear train remains bounded and transmits through the whole chain", () => {
  const gearBody = (id) => ({
    id,
    fixed: false,
    position: [(id - 1) * 2, 0, 0],
    rotation: [0, 0, 0, 1],
    mass: 1,
    linearDamping: 0,
    angularDamping: 0,
    additionalSolverIterations: 2,
    ccd: false,
    colliders: [{
      ownerId: 700 + id,
      center: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      friction: 0,
      density: 1,
      collisionGroup: 1,
      collisionMask: 0,
      shape: { kind: "box", halfExtents: [0.4, 0.2, 0.4] },
    }],
  });
  const support = {
    ...gearBody(100),
    fixed: true,
    position: [0, 0, 0],
  };
  const gears = Array.from({ length: 6 }, (_, index) => ({
    id: `${index + 1}:${index + 2}`,
    nodeA: index + 1,
    nodeB: index + 2,
    bodyA: index + 1,
    bodyB: index + 2,
    axisA: [0, 1, 0],
    axisB: [0, 1, 0],
    centerA: [index * 2, 0, 0],
    centerB: [(index + 1) * 2, 0, 0],
    referenceA: [0, 0, 1],
    referenceB: [0, 0, 1],
    teethA: 16,
    teethB: 16,
    signB: 1,
    phaseLock: false,
  }));
  const joints = Array.from({ length: 7 }, (_, index) => ({
    id: `axle-${index + 1}`,
    bodyA: 100,
    bodyB: index + 1,
    mode: "rotation",
    worldAnchorA: [index * 2, 0, 0],
    worldAnchorB: [index * 2, 0, 0],
    worldAxisA: [0, 1, 0],
    worldAxisB: [0, 1, 0],
    travel: 0,
    motorSpeed: 0,
    motorForce: 0,
    passiveMotorForce: 0,
    dynamicAxle: false,
  }));
  const engine = new PhysicsEngine({
    gravity: [0, 0, 0],
    settings,
    bodies: [...Array.from({ length: 7 }, (_, index) => gearBody(index + 1)), support],
    joints,
    gears,
    differentials: [],
    excludedColliderPairs: [],
  });
  let transforms = engine.step(1 / 60, [
    { kind: "setAngularVelocity", body: 1, velocity: [0, 4, 0] },
  ]);
  for (let frame = 0; frame < 60; frame++) transforms = engine.step(1 / 60, []);
  const stride = engine.transform_stride();
  const angular = Array.from({ length: 7 }, (_, index) => transforms[index * stride + 12]);
  for (let index = 0; index < angular.length - 1; index++)
    assert.ok(
      Math.abs(angular[index] + angular[index + 1]) < 0.05,
      `neighbouring gears must remain inverse: ${angular.join(", ")}`,
    );
  assert.ok(
    angular.every((speed) => Number.isFinite(speed) && Math.abs(speed) <= 80),
    `gear train velocity must stay bounded: ${angular.join(", ")}`,
  );
  engine.free();
});

test("three-body differential routes motion through every free member", () => {
  const body = (id, fixed = false) => ({
    id,
    fixed,
    position: [id * 2, 0, 0],
    rotation: [0, 0, 0, 1],
    mass: 1,
    linearDamping: 0,
    angularDamping: 0,
    additionalSolverIterations: 2,
    ccd: false,
    colliders: [{
      ownerId: 500 + id,
      center: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      friction: 0,
      density: 1,
      collisionGroup: 1,
      collisionMask: 0,
      shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] },
    }],
  });
  const run = (fixedLeft, fixedRight, fixedCarrier, drivenBody) => {
    const engine = new PhysicsEngine({
      gravity: [0, 0, 0],
      settings,
      bodies: [body(1, fixedLeft), body(2, fixedRight), body(3, fixedCarrier)],
      joints: [],
      gears: [],
      differentials: [{
        id: "diff",
        leftBody: 1,
        rightBody: 2,
        carrierBody: 3,
        axis: [0, 0, 1],
      }],
      excludedColliderPairs: [],
    });
    const transforms = engine.step(1 / 60, [
      { kind: "setAngularVelocity", body: drivenBody, velocity: [0, 0, 6] },
    ]);
    const stride = engine.transform_stride();
    const result = [transforms[13], transforms[stride + 13], transforms[stride * 2 + 13]];
    engine.free();
    return result;
  };

  const [left, right, fixedCarrier] = run(false, false, true, 1);
  assert.ok(left * right < 0, `fixed carrier must invert the outputs: ${left}, ${right}`);
  assert.ok(Math.abs(left + right) < 1e-4);

  const [driven, fixedRight, carrier] = run(false, true, false, 1);
  assert.ok(Math.abs(fixedRight) < 1e-6);
  assert.ok(carrier > 0, `a blocked output must route motion to the carrier: ${carrier}`);
  assert.ok(Math.abs(driven - 2 * carrier) < 1e-4);

  const [freeInput, restingSide, routedCarrier] = run(false, false, false, 1);
  assert.ok(Math.abs(freeInput - 6) < 1e-4, `active side input must not be damped: ${freeInput}`);
  assert.ok(Math.abs(restingSide) < 1e-4);
  assert.ok(Math.abs(routedCarrier - 3) < 1e-4);

  const [carrierLeft, carrierRight, drivenCarrier] = run(false, false, false, 3);
  assert.ok(Math.abs(drivenCarrier - 6) < 1e-4, `carrier input must remain easy to turn: ${drivenCarrier}`);
  assert.ok(Math.abs(carrierLeft - 6) < 1e-4 && Math.abs(carrierRight - 6) < 1e-4);

  const [, , blockedCarrier] = run(true, true, false, 3);
  assert.ok(Math.abs(blockedCarrier) < 1e-5, `two blocked outputs must lock the carrier: ${blockedCarrier}`);
});

test("tooth phase captures an initially tooth-on-tooth gear into a valid gap", () => {
  const body = (id, fixed, position) => ({
    id,
    fixed,
    position,
    rotation: [0, 0, 0, 1],
    mass: 1,
    linearDamping: 0.15,
    angularDamping: 0.15,
    additionalSolverIterations: 4,
    ccd: false,
    colliders: [{
      ownerId: id + 500,
      center: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      friction: 0,
      density: 1,
      collisionGroup: 1,
      collisionMask: 0,
      shape: { kind: "box", halfExtents: [0.25, 0.25, 0.25] },
    }],
  });
  const gearConfig = {
    id: "phase-1:2",
    nodeA: 1,
    nodeB: 2,
    bodyA: 1,
    bodyB: 2,
    axisA: [0, 1, 0],
    axisB: [0, 1, 0],
    centerA: [0, 0, 0],
    centerB: [2, 0, 0],
    referenceA: [1, 0, 0],
    referenceB: [1, 0, 0],
    teethA: 16,
    teethB: 16,
    signB: 1,
    phaseLock: true,
  };
  const engine = new PhysicsEngine({
    gravity: [0, 0, 0],
    settings,
    bodies: [body(1, true, [0, 0, 0]), body(2, false, [2, 0, 0]), body(3, true, [2, 0, 0])],
    joints: [{
      id: "gear-b-axle",
      bodyA: 3,
      bodyB: 2,
      mode: "rotation",
      worldAnchorA: [2, 0, 0],
      worldAnchorB: [2, 0, 0],
      worldAxisA: [0, 1, 0],
      worldAxisB: [0, 1, 0],
      travel: 0,
      motorSpeed: 0,
      motorForce: 0,
      passiveMotorForce: 0,
      dynamicAxle: false,
    }],
    gears: [gearConfig],
    excludedColliderPairs: [],
  });

  let transforms;
  for (let frame = 0; frame < 30; frame++) transforms = engine.step(1 / 60, []);
  const stride = engine.transform_stride();
  const y = transforms[stride + 5];
  const w = transforms[stride + 7];
  const angle = 2 * Math.atan2(y, w);
  const halfToothPitch = Math.PI / 16;
  assert.ok(
    Math.abs(Math.abs(angle) - halfToothPitch) < 0.04,
    `expected half-tooth capture (${halfToothPitch}), got ${angle}`,
  );

  // A dynamic topology refresh must retain the same engaged tooth. Simulate
  // an external one-tooth overwrite immediately before replace_gears().
  const toothPitch = Math.PI / 8;
  transforms = engine.step(1 / 60, [{
    kind: "setRotation",
    body: 2,
    rotation: [0, Math.sin((angle + toothPitch) / 2), 0, Math.cos((angle + toothPitch) / 2)],
  }]);
  const overwrittenAngle = 2 * Math.atan2(
    transforms[stride + 5],
    transforms[stride + 7],
  );
  engine.replace_gears([{
    ...gearConfig,
    referenceB: [Math.cos(overwrittenAngle), 0, -Math.sin(overwrittenAngle)],
  }]);
  for (let frame = 0; frame < 120; frame++) transforms = engine.step(1 / 60, []);
  const finalAngle = 2 * Math.atan2(transforms[stride + 5], transforms[stride + 7]);
  const retainedError = Math.atan2(Math.sin(finalAngle - angle), Math.cos(finalAngle - angle));
  assert.ok(
    Math.abs(retainedError) < 0.05,
    `dynamic refresh changed the engaged tooth: ${angle} -> ${finalAngle}`,
  );
  engine.free();
});

test("dynamic axle joints correct radial and angular capture error", () => {
  const axleTilt = Math.PI / 10;
  const body = (id, fixed, position) => ({
    id,
    fixed,
    position,
    rotation: [0, 0, 0, 1],
    mass: 1,
    linearDamping: 0.05,
    angularDamping: 0.05,
    additionalSolverIterations: 4,
    ccd: false,
    colliders: [
      {
        ownerId: id + 300,
        center: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        friction: 0,
        density: 1,
        collisionGroup: 1,
        collisionMask: 0,
        shape: { kind: "box", halfExtents: [0.1, 0.4, 0.1] },
      },
    ],
  });
  const engine = new PhysicsEngine({
    gravity: [0, 0, 0],
    settings,
    bodies: [body(1, true, [0, 0, 0]), body(2, false, [0.15, 0, 0])],
    joints: [
      {
        id: "dynamic-axle",
        bodyA: 1,
        bodyB: 2,
        mode: "rotation-linear",
        worldAnchorA: [0, 0, 0],
        worldAnchorB: [0.15, 0, 0],
        worldAxisA: [0, 1, 0],
        worldAxisB: [Math.sin(axleTilt), Math.cos(axleTilt), 0],
        travel: 2,
        motorSpeed: 0,
        motorForce: 0,
        passiveMotorForce: 0,
        dynamicAxle: true,
      },
    ],
    gears: [],
    differentials: [],
    excludedColliderPairs: [],
  });

  let transforms;
  for (let frame = 0; frame < 90; frame++) transforms = engine.step(1 / 60, []);
  const stride = engine.transform_stride();
  const bodyB = Array.from(transforms.slice(stride, stride * 2));
  assert.ok(Math.abs(bodyB[1]) < 0.025, `axle should be centred radially: ${bodyB[1]}`);
  assert.ok(
    Math.abs(bodyB[6]) > 0.05,
    `axle body should rotate to remove its captured tilt: ${JSON.stringify(bodyB)}`,
  );
  engine.free();
});

test("spring dragging scales to Rapier's real compound-body mass", () => {
  const engine = new PhysicsEngine({
    gravity: [0, 0, 0],
    settings,
    bodies: [
      {
        id: 1,
        fixed: false,
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        mass: 1,
        linearDamping: 0,
        angularDamping: 0,
        additionalSolverIterations: 1,
        ccd: false,
        colliders: [
          {
            ownerId: 401,
            center: [0, 0, 0],
            rotation: [0, 0, 0, 1],
            friction: 0,
            density: 100,
            collisionGroup: 1,
            collisionMask: 0,
            shape: { kind: "box", halfExtents: [1, 1, 1] },
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
  for (let frame = 0; frame < 12; frame++) {
    const x = transforms?.[1] ?? 0;
    transforms = engine.step(1 / 60, [
      {
        kind: "spring",
        body: 1,
        worldPoint: [x, 0, 0],
        target: [1, 0, 0],
        stiffness: 72,
        damping: 9,
        // Deliberately tiny: Rust must raise this using the body's real mass.
        maxForce: 1,
      },
    ]);
  }
  assert.ok(transforms[1] > 0.2, `heavy body should remain draggable: ${transforms[1]}`);
  engine.free();
});
