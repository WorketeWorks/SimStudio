import * as THREE from "three";

import { exactTriangleMeshForPiece } from "./exact-collider";
import {
  COLLISION_GROUP_GEAR_MESH,
  COLLISION_GROUP_GEAR_NORMAL,
  COLLISION_GROUP_NON_GEAR,
  COLLISION_GROUP_SPECIAL_GEAR_CONTACT,
  CONTACT_FRICTION,
} from "./settings";
import type {
  Connection,
  PhysicsSettings,
  Piece,
  RuntimeGearLink,
  StructuralMode,
} from "../editor/types";
import type {
  RustBodyConfig,
  RustAxialStopConfig,
  RustColliderConfig,
  RustDifferentialConfig,
  RustGearConfig,
  RustJointConfig,
  RustPhysicsScene,
  RustQuat,
  RustVec3,
} from "./rust-protocol";

const frictionlessPinRefs = new Set(["3749", "3673", "32556"]);

const vec3 = (value: THREE.Vector3): RustVec3 => [value.x, value.y, value.z];
const quat = (value: THREE.Quaternion): RustQuat => [
  value.x,
  value.y,
  value.z,
  value.w,
];

const colliderExtentAlongAxis = (
  piece: Piece,
  primitive: Piece["colliders"][number],
  axis: THREE.Vector3,
) => {
  if (primitive.shape === "cylinder") {
    const cylinderAxis = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(primitive.rotation)
      .transformDirection(piece.mesh.matrixWorld)
      .normalize();
    const alignment = Math.abs(cylinderAxis.dot(axis));
    return (
      alignment * (primitive.halfHeight ?? 0) +
      Math.sqrt(Math.max(0, 1 - alignment * alignment)) *
        (primitive.radius ?? 0)
    );
  }
  const rotation = piece.mesh
    .getWorldQuaternion(new THREE.Quaternion())
    .multiply(primitive.rotation);
  const size = primitive.size!;
  return (
    Math.abs(axis.dot(new THREE.Vector3(1, 0, 0).applyQuaternion(rotation))) *
      size.x *
      0.5 +
    Math.abs(axis.dot(new THREE.Vector3(0, 1, 0).applyQuaternion(rotation))) *
      size.y *
      0.5 +
    Math.abs(axis.dot(new THREE.Vector3(0, 0, 1).applyQuaternion(rotation))) *
      size.z *
      0.5
  );
};

export type RustSceneBuild = {
  scene: RustPhysicsScene;
  rigidIslands: Piece[][];
  rigidIslandByPiece: Map<Piece, Piece[]>;
  bodyIdByPiece: Map<Piece, number>;
  movingJointCount: number;
  redundantMovingJoints: number;
  largeSimulation: boolean;
};

type RustSceneBuildOptions = {
  pieces: Piece[];
  connections: Connection[];
  gearLinks: RuntimeGearLink[];
  structuralMode: StructuralMode;
  structuralStiffness: number;
  physicsSettings: PhysicsSettings;
  excludedPairs: Set<string>;
};

/** Builds one runtime joint for a connection created while simulation runs. */
export function buildRustJointConfig(
  connection: Connection,
  bodyIdByPiece: Map<Piece, number>,
  physicsSettings: PhysicsSettings,
): RustJointConfig | undefined {
  const bodyA = bodyIdByPiece.get(connection.a);
  const bodyB = bodyIdByPiece.get(connection.b);
  if (!bodyA || !bodyB || bodyA === bodyB) return undefined;

  const dynamicAxle =
    (connection.profile === "axle-cross" ||
      connection.profile === "axle-round") &&
    connection.b.dynamicAxleConnections;
  const worldAxisA = dynamicAxle
    ? connection.socket.axis
        .clone()
        .transformDirection(connection.a.mesh.matrixWorld)
        .normalize()
    : connection.axis.clone().normalize();
  const worldAxisB = dynamicAxle
    ? connection.shaft.axis
        .clone()
        .transformDirection(connection.b.mesh.matrixWorld)
        .normalize()
    : worldAxisA.clone();
  // Connector maps may describe the same axle line in opposite directions.
  // Rapier needs matching frame directions so it corrects only the real tilt.
  if (worldAxisA.dot(worldAxisB) < 0) worldAxisB.negate();
  const forcedPivot =
    connection.forced && connection.localPointB
      ? connection.b.mesh.localToWorld(connection.localPointB.clone())
      : undefined;
  const anchor = forcedPivot ?? connection.point;
  // A dynamically captured axle must use the actual socket and shaft frames.
  // Using one already-coincident artificial frame records the current radial
  // and angular error as valid, leaving a visibly crooked axle forever.
  let anchorA = anchor;
  let anchorB = anchor;

  if (dynamicAxle) {
    anchorA = connection.a.mesh.localToWorld(
      connection.socket.local.clone(),
    );

    const shaftCenter = connection.b.mesh.localToWorld(
      connection.shaft.local.clone(),
    );

    const along = anchorA
      .clone()
      .sub(shaftCenter)
      .dot(worldAxisB);

    anchorB = shaftCenter
      .clone()
      .addScaledVector(worldAxisB, along);
  }
  const passiveMotorForce =
    connection.mode === "rotation" && connection.b.frictionPin
      ? 3.5
      : connection.mode === "rotation" &&
          frictionlessPinRefs.has(connection.b.part)
        ? physicsSettings.frictionlessPinRotation
        : 0;

  return {
    id: connection.id,
    bodyA,
    bodyB,
    mode: connection.mode,
    worldAnchorA: vec3(anchorA),
    worldAnchorB: vec3(anchorB),
    worldAxisA: vec3(worldAxisA),
    worldAxisB: vec3(worldAxisB),
    travel: connection.travel,
    motorSpeed: connection.motorSpeed,
    motorForce: connection.motorForce,
    passiveMotorForce,
    dynamicAxle,
  };
}

/** Converts the editor's detected gear graph to the compact Rust protocol. */
export function buildRustGearConfigs(
  gearLinks: RuntimeGearLink[],
  bodyIdByPiece: Map<Piece, number>,
  connections: Connection[] = [],
): RustGearConfig[] {
  const connectedPieces = [...new Set(
    connections.flatMap((connection) => [connection.a, connection.b]),
  )];
  const differentialSidePairs = new Set(
    buildRustDifferentialConfigs(connectedPieces, connections, bodyIdByPiece)
      .map(({ leftBody, rightBody }) =>
        [leftBody, rightBody].sort((a, b) => a - b).join(":"),
      ),
  );
  const differentialInternalPairs = new Set(differentialSidePairs);
  const differentialRefs = new Set(["6573", "62821"]);
  const isCarrier = (piece: Piece) =>
    [piece.part, piece.modelPart, piece.resolvedPart]
      .filter(Boolean)
      .some((ref) => differentialRefs.has(ref!.toLowerCase()));
  for (const carrier of connectedPieces.filter(isCarrier)) {
    const carrierBody = bodyIdByPiece.get(carrier);
    if (!carrierBody) continue;
    const differential = buildRustDifferentialConfigs(
      connectedPieces,
      connections,
      bodyIdByPiece,
    ).find((candidate) => candidate.carrierBody === carrierBody);
    if (!differential) continue;
    const satelliteBodies = connections.flatMap((connection) => {
      if (connection.mode !== "rotation" || connection.profile !== "axle-cross") return [];
      const satellite = connection.a === carrier
        ? connection.b
        : connection.b === carrier
          ? connection.a
          : undefined;
      const body = satellite && bodyIdByPiece.get(satellite);
      return body && body !== carrierBody ? [body] : [];
    });
    for (const satelliteBody of satelliteBodies) {
      for (const sideBody of [differential.leftBody, differential.rightBody]) {
        differentialInternalPairs.add(
          [satelliteBody, sideBody].sort((a, b) => a - b).join(":"),
        );
      }
    }
  }
  return gearLinks.flatMap((link) => {
    const bodyA = bodyIdByPiece.get(link.a.value);
    const bodyB = bodyIdByPiece.get(link.b.value);
    if (!bodyA || !bodyB || bodyA === bodyB) return [];
    if (differentialInternalPairs.has(
      [bodyA, bodyB].sort((a, b) => a - b).join(":"),
    )) return [];

    const referenceFor = (piece: Piece, axis: THREE.Vector3): RustVec3 => {
      piece.mesh.updateMatrixWorld(true);
      const center = piece.mesh.localToWorld(new THREE.Vector3());

      for (const local of [
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, 0, 1),
      ]) {
        const reference = piece.mesh.localToWorld(local).sub(center);
        reference.addScaledVector(axis, -reference.dot(axis));
        if (reference.lengthSq() > 1.0e-8)
          return vec3(reference.normalize());
      }

      const fallback =
        Math.abs(axis.x) < 0.8
          ? new THREE.Vector3(1, 0, 0)
          : new THREE.Vector3(0, 0, 1);
      fallback.addScaledVector(axis, -fallback.dot(axis)).normalize();
      return vec3(fallback);
    };

    const phaseLock =
      !link.perpendicular &&
      link.ratioOverride === undefined &&
      Number.isInteger(link.a.spec.teeth) &&
      Number.isInteger(link.b.spec.teeth) &&
      link.a.spec.teeth % 2 === 0 &&
      link.b.spec.teeth % 2 === 0;

    return [
      {
        id: [link.a.value.id, link.b.value.id].sort().join(":"),
        nodeA: link.a.value.id,
        nodeB: link.b.value.id,
        bodyA,
        bodyB,
        axisA: vec3(link.axisA),
        axisB: vec3(link.axisB),
        centerA: [...link.a.center] as RustVec3,
        centerB: [...link.b.center] as RustVec3,
        referenceA: referenceFor(link.a.value, link.axisA),
        referenceB: referenceFor(link.b.value, link.axisB),
        teethA: link.ratioOverride ?? link.a.spec.teeth,
        teethB: link.ratioOverride ? 1 : link.b.spec.teeth,
        signB: link.signB,
        phaseLock,
      },
    ];
  });
}

/** Builds a real three-body differential from its two lateral axle sockets. */
export function buildRustDifferentialConfigs(
  pieces: Piece[],
  connections: Connection[],
  bodyIdByPiece: Map<Piece, number>,
): RustDifferentialConfig[] {
  const differentialRefs = new Set(["6573", "62821"]);
  const isCarrier = (piece: Piece) =>
    [piece.part, piece.modelPart, piece.resolvedPart]
      .filter(Boolean)
      .some((ref) => differentialRefs.has(ref!.toLowerCase()));

  return pieces.filter(isCarrier).flatMap((carrier) => {
    const carrierBody = bodyIdByPiece.get(carrier);
    if (!carrierBody) return [];
    carrier.mesh.updateMatrixWorld(true);
    const center = carrier.mesh.localToWorld(new THREE.Vector3());
    const sides = connections.flatMap((connection) => {
      if (connection.profile !== "axle-round") return [];
      const other = connection.a === carrier
        ? connection.b
        : connection.b === carrier
          ? connection.a
          : undefined;
      const body = other && bodyIdByPiece.get(other);
      if (!body || body === carrierBody) return [];
      const axis = connection.axis.clone().normalize();
      return [{ body, axis, offset: connection.point.clone().sub(center).dot(axis) }];
    });

    const unique = new Map<number, (typeof sides)[number]>();
    for (const side of sides) unique.set(side.body, side);
    const outputs = [...unique.values()].sort((a, b) => a.offset - b.offset);
    if (outputs.length !== 2) return [];

    const axis = outputs[0].axis.clone();
    if (axis.dot(outputs[1].axis) < 0) outputs[1].axis.negate();
    return [{
      id: `differential:${carrier.id}`,
      leftBody: outputs[0].body,
      rightBody: outputs[1].body,
      carrierBody,
      axis: vec3(axis),
    }];
  });
}

/**
 * Converts editor objects into the immutable numeric scene consumed by Rust.
 * This is the only place that knows about both Three.js pieces and the WASM
 * protocol; simulation code never reaches back into the editor graph.
 */
export function buildRustPhysicsScene(options: RustSceneBuildOptions): RustSceneBuild {
  const {
    pieces,
    connections,
    gearLinks,
    structuralMode,
    structuralStiffness,
    physicsSettings,
    excludedPairs,
  } = options;

  const parent = new Map(pieces.map((piece) => [piece, piece]));
  const findRoot = (piece: Piece) => {
    let root = piece;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let current = piece;
    while (parent.get(current) !== root) {
      const next = parent.get(current)!;
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  const merge = (left: Piece, right: Piece) => {
    const leftRoot = findRoot(left);
    const rightRoot = findRoot(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };

  if (structuralMode === "rigid")
    connections.forEach((connection) => {
      if (connection.mode === "fixed") merge(connection.a, connection.b);
    });

  const islandMap = new Map<Piece, Piece[]>();
  pieces.forEach((piece) => {
    const root = findRoot(piece);
    const island = islandMap.get(root) ?? [];
    island.push(piece);
    islandMap.set(root, island);
  });
  const rigidIslands = [...islandMap.values()];
  const rigidIslandByPiece = new Map<Piece, Piece[]>();
  const bodyIdByPiece = new Map<Piece, number>();
  rigidIslands.forEach((island, index) => {
    const bodyId = index + 1;
    island.forEach((piece) => {
      rigidIslandByPiece.set(piece, island);
      bodyIdByPiece.set(piece, bodyId);
    });
  });

  // Keep collision enabled between articulated rigid groups, but give their
  // beam envelopes the same small axial clearance used by axle parts. This
  // lets adjacent liftarms rotate past one another without making the whole
  // pair non-colliding (remote parts of both groups can still make contact).
  const articulatedBodyIds = new Set<number>();
  connections.forEach((connection) => {
    const bodyA = bodyIdByPiece.get(connection.a);
    const bodyB = bodyIdByPiece.get(connection.b);
    if (!bodyA || !bodyB || bodyA === bodyB) return;
    articulatedBodyIds.add(bodyA);
    articulatedBodyIds.add(bodyB);
  });

  const stiffnessRatio = structuralStiffness / 100;
  // 700-piece scenes were still taking the expensive normal solver path even
  // though the frame profile already shows 40+ ms world steps. Use the tuned
  // large-scene budget before that cliff; it lowers solver iterations and
  // enables the sleeping/batching shortcuts without changing small scenes.
  const largeSimulation = rigidIslands.length > 250 || pieces.length > 600;
  const solverIterations = largeSimulation
    ? 5 + Math.round(stiffnessRatio * 5)
    : 4 + Math.round(stiffnessRatio * 12);
  const internalPgsIterations = 1 + Math.round(stiffnessRatio * 3);
  const additionalSolverIterations = largeSimulation
    ? Math.round(stiffnessRatio * 2)
    : Math.round(stiffnessRatio * 4);

  const bodies: RustBodyConfig[] = rigidIslands.map((island, index) => {
    const bodyId = index + 1;
    const origin = island
      .reduce((sum, piece) => sum.add(piece.mesh.position), new THREE.Vector3())
      .multiplyScalar(1 / island.length);
    const fixed = island.some((piece) => piece.fixed);
    const mass = island.reduce(
      (sum, piece) => sum + (piece.kind === "motor" ? 2 : 0.65),
      0,
    );
    const colliders: RustColliderConfig[] = [];

    island.forEach((piece) => {
      const physicsOffset = piece.mesh.position.clone().sub(origin);
      const physicsBase = piece.mesh.quaternion.clone();
      piece.physicsBodyId = bodyId;
      piece.physicsOffset = physicsOffset;
      piece.physicsBase = physicsBase;
      piece.physicsIsland = island;
      piece.physicsIslandFixed = fixed;

      const finishCollider = (
        shape: RustColliderConfig["shape"],
        center: THREE.Vector3,
        rotation: THREE.Quaternion,
        gearLayer: boolean,
        density: number,
        gearCollision = false,
      ) => {
        const specialGearContact =
          !gearLayer && piece.specialGear && gearCollision;
        colliders.push({
          ownerId: piece.id,
          center: vec3(center),
          rotation: quat(rotation),
          friction: gearLayer
            ? CONTACT_FRICTION.gearMesh
            : piece.kind === "wheel" && !piece.gear
              ? physicsSettings.rubberFriction
              : physicsSettings.pieceFriction,
          density,
          collisionGroup: gearLayer
            ? COLLISION_GROUP_GEAR_MESH
            : specialGearContact
              ? COLLISION_GROUP_SPECIAL_GEAR_CONTACT
            : piece.gear
              ? COLLISION_GROUP_GEAR_NORMAL
              : COLLISION_GROUP_NON_GEAR,
          collisionMask: gearLayer
            ? COLLISION_GROUP_GEAR_MESH
            : specialGearContact
              ? COLLISION_GROUP_NON_GEAR | COLLISION_GROUP_GEAR_NORMAL
            : piece.gear
              ? COLLISION_GROUP_NON_GEAR | COLLISION_GROUP_SPECIAL_GEAR_CONTACT
              : COLLISION_GROUP_NON_GEAR |
                COLLISION_GROUP_GEAR_NORMAL |
                COLLISION_GROUP_SPECIAL_GEAR_CONTACT,
          shape,
        });
      };

      const exactMesh = piece.exactCollider
        ? exactTriangleMeshForPiece(piece, physicsOffset, physicsBase)
        : undefined;
      if (exactMesh) {
        finishCollider(
          {
            kind: "triMesh",
            vertices: Array.from(exactMesh.vertices),
            indices: Array.from(exactMesh.indices),
          },
          new THREE.Vector3(),
          new THREE.Quaternion(),
          false,
          0,
        );
      } else {
        piece.colliders.forEach((primitive) => {
          const axialClearance =
            piece.gear || /bush|axle joiner/i.test(piece.name)
              ? physicsSettings.axleTolerance
              : 0;
          const beamClearance =
            articulatedBodyIds.has(bodyId) &&
            /^Technic (Beam|Panel)/i.test(piece.name)
              ? physicsSettings.beamClearance
              : 0;
          const shape: RustColliderConfig["shape"] =
            primitive.shape === "box"
              ? {
                  kind: "box",
                  halfExtents: [
                    primitive.size!.x / 2,
                    Math.max(
                      0.01,
                      primitive.size!.y / 2 - beamClearance / 2,
                    ),
                    primitive.size!.z / 2,
                  ],
                }
              : {
                  kind: "cylinder",
                  halfHeight: Math.max(
                    0.01,
                    primitive.halfHeight! -
                      Math.max(axialClearance, beamClearance) / 2,
                  ),
                  radius: primitive.radius!,
                };
          finishCollider(
            shape,
            physicsOffset
              .clone()
              .add(primitive.center.clone().applyQuaternion(physicsBase)),
            physicsBase.clone().multiply(primitive.rotation),
            false,
            (piece.kind === "motor" ? 1.7 : 1) /
              Math.max(1, piece.colliders.length),
            primitive.gearCollision === true,
          );
        });
      }

      piece.gearColliders.forEach((primitive) => {
        const shape: RustColliderConfig["shape"] =
          primitive.shape === "box"
            ? {
                kind: "box",
                halfExtents: [
                  primitive.size!.x / 2,
                  primitive.size!.y / 2,
                  primitive.size!.z / 2,
                ],
              }
            : {
                kind: "cylinder",
                halfHeight: primitive.halfHeight!,
                radius: primitive.radius!,
              };
        finishCollider(
          shape,
          physicsOffset
            .clone()
            .add(primitive.center.clone().applyQuaternion(physicsBase)),
          physicsBase.clone().multiply(primitive.rotation),
          true,
          0,
        );
      });
    });

    return {
      id: bodyId,
      fixed,
      position: vec3(origin),
      rotation: [0, 0, 0, 1],
      mass,
      linearDamping: 0.55,
      angularDamping: 0.95,
      additionalSolverIterations,
      ccd: !largeSimulation,
      colliders,
    };
  });

  let redundantMovingJoints = 0;
  const guideKeys = new Set<string>();
  const joints = connections.flatMap((connection): RustJointConfig[] => {
    const bodyA = bodyIdByPiece.get(connection.a)!;
    const bodyB = bodyIdByPiece.get(connection.b)!;
    if (bodyA === bodyB) {
      if (!(structuralMode === "rigid" && connection.mode === "fixed"))
        redundantMovingJoints++;
      return [];
    }

    const worldAxis = connection.axis.clone().normalize();
    if (connection.mode === "linear" || connection.mode === "rotation-linear") {
      const axisKey = worldAxis.clone();
      if (
        axisKey.x < -1e-6 ||
        (Math.abs(axisKey.x) <= 1e-6 && axisKey.y < -1e-6) ||
        (Math.abs(axisKey.x) <= 1e-6 &&
          Math.abs(axisKey.y) <= 1e-6 &&
          axisKey.z < 0)
      )
        axisKey.multiplyScalar(-1);
      const handles = [bodyA, bodyB].sort((left, right) => left - right);
      const key = `${handles[0]}:${handles[1]}:${connection.mode}:${axisKey.x.toFixed(3)}:${axisKey.y.toFixed(3)}:${axisKey.z.toFixed(3)}`;
      if (guideKeys.has(key)) {
        redundantMovingJoints++;
        return [];
      }
      guideKeys.add(key);
    }

    const joint = buildRustJointConfig(
      connection,
      bodyIdByPiece,
      physicsSettings,
    );
    return joint ? [joint] : [];
  });

  const differentials = buildRustDifferentialConfigs(
    pieces,
    connections,
    bodyIdByPiece,
  );
  // The explicit three-body constraint replaces the internal bevel contact;
  // buildRustGearConfigs applies the same exclusion during dynamic rescans.
  const gears = buildRustGearConfigs(gearLinks, bodyIdByPiece, connections);

  // Bushes/nuts touching a socket act as axial hard stops. Their correction
  // is encoded once here and enforced every frame by Rust, avoiding a second
  // TypeScript pose solver after Rapier.
  const axialStops: RustAxialStopConfig[] = [];
  for (const connection of connections) {
    if (connection.mode !== "rotation-linear") continue;
    const bodyA = bodyIdByPiece.get(connection.a);
    const bodyB = bodyIdByPiece.get(connection.b);
    if (!bodyA || !bodyB || bodyA === bodyB) continue;
    connection.a.mesh.updateMatrixWorld(true);
    const hostPoint = connection.a.mesh.localToWorld(connection.socket.local.clone());
    const axis = connection.socket.axis
      .clone()
      .transformDirection(connection.a.mesh.matrixWorld)
      .normalize();
    const halfBeam =
      /^Technic (Beam|Panel)/i.test(connection.a.name) &&
      /(?:\bx\s*0\.5\b|\b0\.5\b|\bhalf\b)/i.test(connection.a.name);
    const surface = THREE.MathUtils.clamp(
      Math.max((connection.socket.length ?? 0) / 2, halfBeam ? 0.25 : 0.5),
      0.12,
      0.6,
    );
    for (const piece of connection.b.physicsIsland ?? [connection.b]) {
      if (!/bush|nut/i.test(piece.name)) continue;
      piece.mesh.updateMatrixWorld(true);
      for (const primitive of piece.colliders) {
        const stopPoint = piece.mesh.localToWorld(primitive.center.clone());
        const delta = stopPoint.clone().sub(hostPoint);
        const distance = delta.dot(axis);
        const radial = delta.clone().addScaledVector(axis, -distance).length();
        const radialReach =
          primitive.shape === "cylinder"
            ? (primitive.radius ?? 0)
            : Math.max(
                primitive.size?.x ?? 0,
                primitive.size?.y ?? 0,
                primitive.size?.z ?? 0,
              ) * 0.5;
        const minimumDistance =
          surface +
          Math.max(
            0.01,
            colliderExtentAlongAxis(piece, primitive, axis) -
              physicsSettings.axleTolerance * 0.5,
          );
        if (
          radial <= radialReach + 0.12 &&
          Math.abs(Math.abs(distance) - minimumDistance) <= 0.2
        )
          axialStops.push({
            bodyA,
            bodyB,
            hostPoint: vec3(hostPoint),
            stopPoint: vec3(stopPoint),
            worldAxis: vec3(axis),
            side: distance >= 0 ? 1 : -1,
            minimumDistance,
          });
      }
    }
  }

  const excludedColliderPairs = [...excludedPairs].flatMap((key) => {
    const [left, right] = key.split(":").map(Number);
    return Number.isFinite(left) && Number.isFinite(right)
      ? ([[left, right]] as [number, number][])
      : [];
  });

  return {
    scene: {
      gravity: [0, -9.81, 0],
      settings: {
        solverIterations,
        internalPgsIterations,
        allowedLinearError: THREE.MathUtils.lerp(0.025, 0.002, stiffnessRatio),
        maxCcdSubsteps: largeSimulation ? 1 : 2,
        largeSimulation,
        axleSlidingFriction: physicsSettings.axleSlidingFriction,
        axleRotationFriction: physicsSettings.axleRotationFriction,
      },
      bodies,
      joints,
      gears,
      differentials,
      axialStops,
      excludedColliderPairs,
    },
    rigidIslands,
    rigidIslandByPiece,
    bodyIdByPiece,
    movingJointCount: joints.length,
    redundantMovingJoints,
    largeSimulation,
  };
}
