/**
 * Gear topology detection.
 *
 * This module only determines which parts participate in a mechanical graph.
 * The per-frame Rapier velocity and tooth-phase solver remains in the physics
 * runtime, consuming the links returned here.
 */
import * as THREE from "three";
import { gearSpecFor, type GearPair, type GearPose } from "../gears";
import { contactPairKey } from "../physics-contact-filter";
import type {
  CatalogPart,
  Connection,
  Piece,
  RuntimeGearLink,
} from "../editor/types";

const differentialRefs = new Set(["6573", "62821"]);

const isDifferentialCarrier = (p: CatalogPart) =>
  [p.part, p.modelPart, p.resolvedPart]
    .filter(Boolean)
    .some((reference) => differentialRefs.has(reference!.toLowerCase()));

const gearPoseForPiece = (piece: Piece): GearPose<Piece> | undefined => {
  const spec = gearSpecFor(piece.modelPart ?? piece.part, piece.name);
  if (!piece.gear || !spec) return undefined;
  piece.mesh.updateMatrixWorld(true);
  // Some corrected maps contain decorative/off-centre axle holes before the
  // driving hole (32498 is one example). A gear's LDraw origin is its rotation
  // centre, so use that origin and only take the nearest axle socket for axis.
  const axleSocket = piece.connectors
      .filter((connector) => connector.role === "socket" && connector.kind === "axle")
      .sort((a, b) => a.local.lengthSq() - b.local.lengthSq())[0],
    fallbackCylinder = [...piece.gearColliders, ...piece.colliders]
      .filter((primitive) => primitive.shape === "cylinder")
      .sort((a, b) => (b.radius ?? 0) - (a.radius ?? 0))[0],
    center = piece.mesh.localToWorld(new THREE.Vector3()),
    axis = axleSocket
      ? axleSocket.axis.clone().transformDirection(piece.mesh.matrixWorld)
      : new THREE.Vector3(0, 1, 0)
          .applyQuaternion(fallbackCylinder?.rotation ?? new THREE.Quaternion())
          .transformDirection(piece.mesh.matrixWorld);
  return {
    value: piece,
    spec,
    center: center.toArray(),
    axis: axis.normalize().toArray(),
  };
};

type WorldGearVolume = {
  piece: Piece;
  center: THREE.Vector3;
  axis: THREE.Vector3;
  radius: number;
  halfHeight: number;
  ratio?: number;
};

const worldGearVolumes = (piece: Piece): WorldGearVolume[] => {
  piece.mesh.updateMatrixWorld(true);
  const scale = piece.mesh.getWorldScale(new THREE.Vector3()),
    scaleFactor = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
  // Ordinary gears use their green collision envelope as the engagement
  // trigger. A special multi-ratio gear exposes only explicitly tagged zones;
  // its magenta layer remains the real physical tooth-contact surface.
  const primitives = piece.specialGear
    ? piece.colliders.filter(
        (primitive) =>
          Number.isFinite(primitive.gearRatio) && primitive.gearRatio! > 0,
      )
    : piece.colliders;
  return primitives.flatMap((primitive) => {
    if (primitive.shape !== "cylinder") return [];
    const localAxis = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(primitive.rotation)
      .normalize();
    return [
      {
        piece,
        center: piece.mesh.localToWorld(primitive.center.clone()),
        axis: localAxis.transformDirection(piece.mesh.matrixWorld).normalize(),
        radius: (primitive.radius ?? 0) * scaleFactor,
        halfHeight: (primitive.halfHeight ?? 0) * scaleFactor,
        ratio: primitive.gearRatio,
      },
    ];
  });
};

const gearVolumesOverlap = (a: WorldGearVolume, b: WorldGearVolume) => {
  const delta = b.center.clone().sub(a.center),
    alignment = Math.abs(a.axis.dot(b.axis)),
    tolerance = 0.025;
  if (alignment >= 0.985) {
    const axial = Math.abs(delta.dot(a.axis)),
      radial = delta.clone().addScaledVector(a.axis, -delta.dot(a.axis)).length();
    return (
      axial <= a.halfHeight + b.halfHeight + tolerance &&
      radial <= a.radius + b.radius + tolerance
    );
  }
  const cross = new THREE.Vector3().crossVectors(a.axis, b.axis),
    crossLength = cross.length();
  if (crossLength < 0.1) return false;
  cross.multiplyScalar(1 / crossLength);
  const separation = Math.abs(delta.dot(cross)),
    alongA = Math.abs(delta.dot(a.axis)),
    alongB = Math.abs(delta.dot(b.axis));
  return (
    separation <= a.radius + b.radius + tolerance &&
    alongA <= a.halfHeight + b.radius + 0.1 &&
    alongB <= b.halfHeight + a.radius + 0.1
  );
};

// --- Gear topology ----------------------------------------------------------
// Detection is separate from the Rapier solver: it builds the ordinary gear
// graph consumed later by the velocity and tooth-phase constraints.

export const detectGearLinks = (
  pieces: Piece[],
  rigidIslandByPiece?: Map<Piece, Piece[]>,
  excludedPairs = new Set<string>(),
): RuntimeGearLink[] => {
  const poses = pieces.flatMap((piece) => {
      const pose = gearPoseForPiece(piece);
      return pose ? [pose] : [];
    }),
    volumes = new Map(poses.map((pose) => [pose.value, worldGearVolumes(pose.value)])),
    pairs: (GearPair<Piece> & { ratioMagnitude?: number })[] = [];
  for (let left = 0; left < poses.length; left++)
    for (let right = left + 1; right < poses.length; right++) {
      const a = poses[left],
        b = poses[right];
      if (excludedPairs.has(contactPairKey(a.value, b.value))) continue;
      let matchingVolumes:
        | { a: WorldGearVolume; b: WorldGearVolume }
        | undefined;
      for (const volumeA of volumes.get(a.value) ?? []) {
        const volumeB = (volumes.get(b.value) ?? []).find((candidate) =>
          gearVolumesOverlap(volumeA, candidate),
        );
        if (volumeB) {
          matchingVolumes = { a: volumeA, b: volumeB };
          break;
        }
      }
      if (!matchingVolumes) continue;
      const centerA = new THREE.Vector3(...a.center);
      const centerB = new THREE.Vector3(...b.center);

      const axisA = new THREE.Vector3(...a.axis).normalize();
      const axisB = new THREE.Vector3(...b.axis).normalize();

      const delta = centerB.clone().sub(centerA);
      const axisAlignment = Math.abs(axisA.dot(axisB));

      if (axisAlignment >= 0.985) {
        // Engranajes con ejes paralelos.
        const axialDistance = Math.abs(delta.dot(axisA));

        const radialDistance = delta
          .clone()
          .addScaledVector(axisA, -delta.dot(axisA))
          .length();

        const expectedDistance =
          a.spec.pitchRadius + b.spec.pitchRadius;

        const distanceError =
          radialDistance - expectedDistance;

        // Solo crear el link cuando los círculos de paso están realmente
        // suficientemente cerca para que los dientes puedan engranar.
        if (
          axialDistance > 0.55 ||
          distanceError > 0.14 ||
          distanceError < -0.34
        ) {
          continue;
        }
      }

      const centerDistance = new THREE.Vector3(...a.center).distanceTo(
        new THREE.Vector3(...b.center),
        ),
        ratioMagnitude = a.value.specialGear
          ? matchingVolumes.a.ratio
          : b.value.specialGear && matchingVolumes.b.ratio
            ? 1 / matchingVolumes.b.ratio
            : undefined;
      pairs.push({
        a,
        b,
        ratio: -a.spec.teeth / b.spec.teeth,
        centerDistance,
        expectedDistance: a.spec.pitchRadius + b.spec.pitchRadius,
        distanceError: 0,
        ratioMagnitude,
      });
    }
  return pairs.flatMap((pair) => {
    if (
      rigidIslandByPiece &&
      rigidIslandByPiece.get(pair.a.value) === rigidIslandByPiece.get(pair.b.value)
    )
      return [];
    if (pair.a.value.body && pair.a.value.body === pair.b.value.body) return [];
    const axisA = new THREE.Vector3(...pair.a.axis).normalize(),
      axisB = new THREE.Vector3(...pair.b.axis).normalize();
    if (axisA.dot(axisB) < 0) axisB.negate();
    const centerA = new THREE.Vector3(...pair.a.center),
      centerB = new THREE.Vector3(...pair.b.center),
      radialA = centerB
        .clone()
        .sub(centerA)
        .addScaledVector(axisA, -centerB.clone().sub(centerA).dot(axisA))
        .normalize(),
      radialB = centerA
        .clone()
        .sub(centerB)
        .addScaledVector(axisB, -centerA.clone().sub(centerB).dot(axisB))
        .normalize(),
      tangentA = new THREE.Vector3().crossVectors(axisA, radialA).normalize(),
      tangentB = new THREE.Vector3().crossVectors(axisB, radialB).normalize(),
      tangentDot = tangentA.dot(tangentB),
      signB = -Math.sign(Math.abs(tangentDot) > 0.2 ? tangentDot : -1),
      perpendicular = Math.abs(axisA.dot(axisB)) < 0.2;
    return [
      {
        ...pair,
        ratio:
          pair.ratioMagnitude !== undefined
            ? -pair.ratioMagnitude / signB
            : -pair.a.spec.teeth / (signB * pair.b.spec.teeth),
        axisA,
        axisB,
        signB,
        perpendicular,
        ratioOverride: pair.ratioMagnitude,
      },
    ];
  });
};

/**
 * Gears mounted through a differential's own sockets are internal outputs,
 * not teeth meshing with the carrier ring. Excluding only carrier/output pairs
 * leaves the ordinary overlap detector free to connect the internal 6589
 * gears to one another when their real gear volumes touch.
 */
export const differentialCarrierGearExclusions = (
  pieces: Piece[],
  connections: Connection[],
): Set<string> => {
  const excluded = new Set<string>();
  for (const carrier of pieces.filter(
    (piece) => isDifferentialCarrier(piece) && !piece.specialGear,
  )) {
    const visited = new Set<Piece>([carrier]), queue = [carrier];
    while (queue.length) {
      const current = queue.shift()!;
      for (const connection of connections) {
        const next = connection.a === current
          ? connection.b
          : connection.b === current
            ? connection.a
            : undefined;
        if (!next || visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    visited.forEach((piece) => {
      if (piece !== carrier && piece.gear)
        excluded.add(contactPairKey(carrier, piece));
    });
  }
  return excluded;
};

export const gearLinkKey = (link: RuntimeGearLink) =>
  [link.a.value.id, link.b.value.id].sort().join(":");
