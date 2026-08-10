export type StoredCollider = {
  shape: "box" | "cylinder";
  center: [number, number, number];
  size?: [number, number, number];
  radius?: number;
  halfHeight?: number;
  rotation: [number, number, number, number];
};

// Mapas revisados exportados desde el editor de Sim Studio. Estos valores se
// conservan literalmente: son la fuente de verdad para las colisiones manuales.
export const preloadedCollisionMaps: Record<string, StoredCollider[]> = {
  "87408": [
    {
      shape: "box",
      center: [0, 0.5, -2.220446049250313e-16],
      size: [0.9, 1, 2],
      rotation: [0, 0, 0, 1],
    },
    {
      shape: "box",
      center: [0, 1.25, -1.25],
      size: [0.9, 2.5, 0.5],
      rotation: [0, 0, 0, 1],
    },
    {
      shape: "cylinder",
      center: [0, 2.5, -1.25],
      radius: 0.45,
      halfHeight: 0.25,
      rotation: [0.7071067811865475, 0, 0, 0.7071067811865476],
    },
    {
      shape: "box",
      center: [0, 1.25, 1.25],
      size: [0.9, 2.5, 0.5],
      rotation: [0, 0, 0, 1],
    },
    {
      shape: "cylinder",
      center: [0, 2.5, 1.25],
      radius: 0.45,
      halfHeight: 0.25,
      rotation: [0.7071067811865475, 0, 0, 0.7071067811865476],
    },
  ],
  "3713": [
    {
      shape: "cylinder",
      center: [0, 0, 0],
      radius: 0.46,
      halfHeight: 0.5,
      rotation: [-0.4999999999999999, 0.5, -0.5, 0.5000000000000001],
    },
  ],
  "32013": [
    {
      shape: "cylinder",
      center: [0, 0, 0],
      radius: 0.45,
      halfHeight: 0.5,
      rotation: [0, 0, -0.7071067811865475, 0.7071067811865476],
    },
    {
      shape: "cylinder",
      center: [0, 0, 0.75],
      radius: 0.45,
      halfHeight: 0.75,
      rotation: [0.7071067811865475, 0, 0, 0.7071067811865476],
    },
  ],
  "32034": [
    {
      shape: "cylinder",
      center: [0, 0, 0],
      radius: 0.45,
      halfHeight: 0.5,
      rotation: [0, 0, 0.7071067811865475, 0.7071067811865476],
    },
    {
      shape: "cylinder",
      center: [0, 0, 0],
      radius: 0.45,
      halfHeight: 1.5,
      rotation: [0.7071067811865475, 0, 0, 0.7071067811865476],
    },
  ],
  "32016": [
    {
      shape: "cylinder",
      center: [0, 0.28701, -0.69291],
      radius: 0.45,
      halfHeight: 0.75,
      rotation: [-0.5555702330196022, 0, 0, 0.8314696123025452],
    },
    {
      shape: "cylinder",
      center: [0, 0, 0],
      radius: 0.45,
      halfHeight: 0.5,
      rotation: [0, 0, 0.7071067811865475, 0.7071067811865476],
    },
    {
      shape: "cylinder",
      center: [0, 0, 0.75],
      radius: 0.45,
      halfHeight: 0.75,
      rotation: [0.7071067811865475, 0, 0, 0.7071067811865476],
    },
  ],
  "32192": [
    {
      shape: "cylinder",
      center: [0, 0, 0],
      radius: 0.5,
      halfHeight: 0.45,
      rotation: [0, 0, 0.7071067811865475, 0.7071067811865476],
    },
    {
      shape: "cylinder",
      center: [0, 0, 0.75],
      radius: 0.45,
      halfHeight: 0.75,
      rotation: [0.7071067811865475, 0, 0, 0.7071067811865476],
    },
    {
      shape: "cylinder",
      center: [0, 0.53033, -0.5303],
      radius: 0.5,
      halfHeight: 0.75,
      rotation: [-0.3826834323650898, 0, 0, 0.9238795325112867],
    },
  ],
};
