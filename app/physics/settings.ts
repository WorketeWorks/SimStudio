import type { PhysicsSettings } from "../editor/types";

/** Default material and connector resistance values shown in Properties. */

export const DEFAULT_PHYSICS_SETTINGS: PhysicsSettings = {
  pieceFriction: 0.18,
  rubberFriction: 1.35,
  frictionlessPinRotation: 0.05,
  axleSlidingFriction: 0.08,
  axleRotationFriction: 0.02,
  axleTolerance: 0.02,
};

/**
 * Rapier combines the friction coefficients of both colliders. The special
 * gear envelope is frictionless because tooth torque is imposed by the gear
 * constraint; its collider only prevents impossible overlap.
 */

export const CONTACT_FRICTION = {
  gearMesh: 0,
  floor: 0.9,
} as const;

export const COLLISION_GROUP_NON_GEAR = 0x0001;

export const COLLISION_GROUP_GEAR_NORMAL = 0x0002;

export const COLLISION_GROUP_GEAR_MESH = 0x0004;

/** Packs Rapier's 16-bit membership and filter masks into one value. */

export const interactionGroups = (membership: number, filter: number) =>
  (membership << 16) | filter;
