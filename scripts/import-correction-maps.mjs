import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [correctionsArg, outputArg] = process.argv.slice(2);
if (!correctionsArg || !outputArg)
  throw new Error("Usage: node import-correction-maps.mjs <corrections> <output>");

const correctionsDir = resolve(correctionsArg),
  outputDir = resolve(outputArg),
  files = (await readdir(correctionsDir)).sort(),
  connectionMaps = {},
  collisionMaps = {},
  gearCollisionMaps = {},
  specialGearParts = new Set();

const readExport = async (file, name, fallback) => {
  try {
    const module = await import(`${pathToFileURL(resolve(outputDir, file)).href}?v=${Date.now()}`);
    return module[name] ?? fallback;
  } catch {
    return fallback;
  }
};

Object.assign(connectionMaps, await readExport("connection-maps.ts", "preloadedConnectionMaps", {}));
Object.assign(collisionMaps, await readExport("collision-maps.ts", "preloadedCollisionMaps", {}));
Object.assign(gearCollisionMaps, await readExport("collision-maps.ts", "preloadedGearCollisionMaps", {}));
try {
  const existing = await readExport("collision-maps.ts", "preloadedSpecialGearParts", new Set());
  existing.forEach((part) => specialGearParts.add(part));
} catch {}

for (const file of files) {
  const connectionMatch = file.match(/^(.+)-connections\.json$/i),
    collisionMatch = file.match(/^(.+)-collisions\.json$/i);
  if (!connectionMatch && !collisionMatch) continue;
  const payload = JSON.parse(
      await readFile(resolve(correctionsDir, file), "utf8"),
    ),
    part = String(payload.part ?? connectionMatch?.[1] ?? collisionMatch?.[1]);
  if (connectionMatch) {
    if (!Array.isArray(payload.connectors))
      throw new Error(`${file} does not contain a connectors array`);
    connectionMaps[part] = payload.connectors;
  } else {
    if (!Array.isArray(payload.colliders))
      throw new Error(`${file} does not contain a colliders array`);
    collisionMaps[part] = payload.colliders;
    if (Array.isArray(payload.gearColliders))
      gearCollisionMaps[part] = payload.gearColliders;
    if (payload.specialGear === true) specialGearParts.add(part);
  }
}

const connectionSource = `export type StoredConnector = {
  local: [number, number, number];
  axis: [number, number, number];
  kind: "round" | "axle" | "half";
  role: "socket" | "shaft";
  diameter: number;
  length?: number;
  rotationOnly?: boolean;
};

// Generated from the reviewed maps exported by Sim Studio's map editor.
export const preloadedConnectionMaps: Record<string, StoredConnector[]> = ${JSON.stringify(connectionMaps, null, 2)};
`;

const collisionSource = `export type StoredCollisionPrimitive = {
  shape: "box" | "cylinder";
  center: [number, number, number];
  size?: [number, number, number];
  radius?: number;
  halfHeight?: number;
  rotation: [number, number, number, number];
  gearCollision?: boolean;
  gearRatio?: number;
};

// Generated from the reviewed maps exported by Sim Studio's collider editor.
export const preloadedCollisionMaps: Record<string, StoredCollisionPrimitive[]> = ${JSON.stringify(collisionMaps, null, 2)};

// Optional second layer used exclusively for gear-to-gear contacts.
export const preloadedGearCollisionMaps: Record<string, StoredCollisionPrimitive[]> = ${JSON.stringify(gearCollisionMaps, null, 2)};

export const preloadedSpecialGearParts = new Set(${JSON.stringify([...specialGearParts])});
`;

await Promise.all([
  writeFile(resolve(outputDir, "connection-maps.ts"), connectionSource),
  writeFile(resolve(outputDir, "collision-maps.ts"), collisionSource),
]);

console.log(
  `Imported ${Object.keys(connectionMaps).length} connection maps, ${Object.keys(collisionMaps).length} collision maps and ${Object.keys(gearCollisionMaps).length} gear collision maps.`,
);
