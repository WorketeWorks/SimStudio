import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
    process.argv[2] || fileURLToPath(new URL("..", import.meta.url)),
  ),
  catalogPaths = [
    resolve(repositoryRoot, "app", "preloaded-catalog.json"),
    resolve(repositoryRoot, "public", "catalog", "manifest.json"),
  ];

const axleLength = (name) => {
  const match = String(name).match(/^Technic Axle\s+(\d+)(?:\s+Notched)?$/i);
  return match ? Number(match[1]) : undefined;
};
const axleConnectors = (length) => [
  {
    local: [0, 0, 0],
    axis: [1, 0, 0],
    kind: "axle",
    role: "shaft",
    diameter: 0.6,
    length,
  },
];
const axleColliders = (length) => [
  {
    shape: "box",
    center: [0, 0, 0],
    size: [length, 0.2, 0.6],
    rotation: [0, 0, 0, 1],
  },
  {
    shape: "box",
    center: [0, 0, 0],
    size: [length, 0.6, 0.2],
    rotation: [0, 0, 0, 1],
  },
];

for (const catalogPath of catalogPaths) {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  for (const part of Object.values(catalog.parts)) {
    const length = axleLength(part.name);
    if (!length) continue;
    part.connectors = axleConnectors(length);
    part.colliders = axleColliders(length);
  }
  catalog.parts["3708"] = {
    name: "Technic Axle 12",
    family: "axles",
    modelPart: "3708",
    modelFile: "parts/3708.dat",
    connectors: axleConnectors(12),
    colliders: axleColliders(12),
    gear: false,
    gearColliders: [],
    bounds: { min: [-6, -0.3, -0.3], max: [6, 0.3, 0.3] },
  };
  catalog.assets["3708-0"] = {
    geometry: "catalog/geometry/3708-0.json",
    render: "catalog/renders/3708.png",
    color: 0,
  };
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}

console.log("Updated straight axle maps and added preloaded axle 3708.");
