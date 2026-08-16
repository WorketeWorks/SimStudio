/**
 * Gear and differential topology detection.
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
  Piece,
  RuntimeDifferentialLink,
  RuntimeGearLink,
} from "../editor/types";

const differentialRefs = new Set(["6573", "62821"]);

export const isDifferentialPart = (p: CatalogPart) =>
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
};

const worldGearVolumes = (piece: Piece): WorldGearVolume[] => {
  piece.mesh.updateMatrixWorld(true);
  const scale = piece.mesh.getWorldScale(new THREE.Vector3()),
    scaleFactor = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
  // The regular green collision envelope determines whether two gears are
  // close enough to engage. The magenta gear collider remains a real physical
  // tooth-contact layer and is not used as the link trigger.
  return piece.colliders.flatMap((primitive) => {
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

// --- Gear and differential topology ----------------------------------------
// Detection is separate from the Rapier solver: it builds the graph that the
// per-frame velocity/phase constraints consume later.

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
    pairs: GearPair<Piece>[] = [];
  for (let left = 0; left < poses.length; left++)
    for (let right = left + 1; right < poses.length; right++) {
      const a = poses[left],
        b = poses[right];
      if (excludedPairs.has(contactPairKey(a.value, b.value))) continue;
      const overlaps = (volumes.get(a.value) ?? []).some((volumeA) =>
        (volumes.get(b.value) ?? []).some((volumeB) =>
          gearVolumesOverlap(volumeA, volumeB),
        ),
      );
      if (!overlaps) continue;
      const centerDistance = new THREE.Vector3(...a.center).distanceTo(
        new THREE.Vector3(...b.center),
      );
      pairs.push({
        a,
        b,
        ratio: -a.spec.teeth / b.spec.teeth,
        centerDistance,
        expectedDistance: a.spec.pitchRadius + b.spec.pitchRadius,
        distanceError: 0,
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
        ratio: -pair.a.spec.teeth / (signB * pair.b.spec.teeth),
        axisA,
        axisB,
        signB,
        perpendicular,
      },
    ];
  });
};

export const differentialPairKeys = (links: RuntimeDifferentialLink[]) =>
  new Set(
    links.flatMap((link) => [
      contactPairKey(link.carrier, link.left),
      contactPairKey(link.carrier, link.right),
      contactPairKey(link.left, link.right),
    ]),
  );

export const detectDifferentialLinks = (
  pieces: Piece[],
  rigidIslandByPiece?: Map<Piece, Piece[]>,
): RuntimeDifferentialLink[] => {
  const poses = pieces.flatMap((piece) => {
      const pose = gearPoseForPiece(piece);
      return pose ? [pose] : [];
    }),
    usedOutputs = new Set<Piece>(),
    links: RuntimeDifferentialLink[] = [];
  for (const carrierPose of poses.filter((pose) => isDifferentialPart(pose.value))) {
    const carrier = carrierPose.value,
      center = new THREE.Vector3(...carrierPose.center),
      carrierAxis = new THREE.Vector3(...carrierPose.axis).normalize(),
      candidates = poses
        .filter((pose) => {
          if (
            pose.value === carrier ||
            isDifferentialPart(pose.value) ||
            usedOutputs.has(pose.value) ||
            pose.spec.kind === "spur" ||
            pose.spec.teeth > 20 ||
            (rigidIslandByPiece &&
              rigidIslandByPiece.get(pose.value) === rigidIslandByPiece.get(carrier))
          )
            return false;
          const axis = new THREE.Vector3(...pose.axis).normalize(),
            delta = new THREE.Vector3(...pose.center).sub(center),
            axial = delta.dot(carrierAxis),
            radial = delta.clone().addScaledVector(carrierAxis, -axial).length();
          return (
            Math.abs(axis.dot(carrierAxis)) >= 0.96 &&
            radial <= 0.48 &&
            Math.abs(axial) <= 1.35
          );
        })
        .map((pose) => {
          const delta = new THREE.Vector3(...pose.center).sub(center),
            axial = delta.dot(carrierAxis),
            radial = delta.clone().addScaledVector(carrierAxis, -axial).length();
          return { pose, axial, radial };
        });
    let best:
      | {
          left: (typeof candidates)[number];
          right: (typeof candidates)[number];
          score: number;
        }
      | undefined;
    for (let leftIndex = 0; leftIndex < candidates.length; leftIndex++)
      for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex++) {
        const left = candidates[leftIndex],
          right = candidates[rightIndex],
          separation = Math.abs(left.axial - right.axial);
        if (separation < 0.22 || left.axial * right.axial > 0.08) continue;
        const score =
          left.radial +
          right.radial +
          Math.abs(left.axial + right.axial) -
          separation * 0.15;
        if (!best || score < best.score) best = { left, right, score };
      }
    if (!best) continue;
    const orientAxis = (pose: GearPose<Piece>) => {
      const axis = new THREE.Vector3(...pose.axis).normalize();
      if (axis.dot(carrierAxis) < 0) axis.negate();
      return axis;
    };
    links.push({
      carrier,
      left: best.left.pose.value,
      right: best.right.pose.value,
      axisCarrier: carrierAxis,
      axisLeft: orientAxis(best.left.pose),
      axisRight: orientAxis(best.right.pose),
    });
    usedOutputs.add(best.left.pose.value);
    usedOutputs.add(best.right.pose.value);
  }
  return links;
};

export const gearLinkKey = (link: RuntimeGearLink) =>
  [link.a.value.id, link.b.value.id].sort().join(":");
