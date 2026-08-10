import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [correctionsArg, outputArg] = process.argv.slice(2);
if (!correctionsArg || !outputArg)
  throw new Error("Usage: node import-correction-maps.mjs <corrections> <output>");

const correctionsDir = resolve(correctionsArg),
  outputDir = resolve(outputArg),
  files = (await readdir(correctionsDir)).sort(),
  connectionMaps = {},
  collisionMaps = {};

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
  }
}

const connectionSource = `export type StoredConnector = {
  local: [number, number, number];
  axis: [number, number, number];
  kind: "round" | "axle";
  role: "socket" | "shaft";
  diameter: number;
  length?: number;
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
};

// Generated from the reviewed maps exported by Sim Studio's collider editor.
export const preloadedCollisionMaps: Record<string, StoredCollisionPrimitive[]> = ${JSON.stringify(collisionMaps, null, 2)};
`;

await Promise.all([
  writeFile(resolve(outputDir, "connection-maps.ts"), connectionSource),
  writeFile(resolve(outputDir, "collision-maps.ts"), collisionSource),
]);

console.log(
  `Imported ${Object.keys(connectionMaps).length} connection maps and ${Object.keys(collisionMaps).length} collision maps.`,
);
