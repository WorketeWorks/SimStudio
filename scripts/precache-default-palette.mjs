import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { LDrawLoader } from "three/addons/loaders/LDrawLoader.js";
import { LDrawConditionalLineMaterial } from "three/addons/materials/LDrawConditionalLineMaterial.js";
import {
  approximateCollisionPrimitives,
  detectConnectorHoles,
  fallbackBeamConnectors,
  hybridAxlePinConnectors,
  objectLocalBounds,
  rodConnectors,
} from "../app/connectors.ts";
import { preloadedConnectionMaps } from "../app/connection-maps.ts";
import { preloadedCollisionMaps } from "../app/collision-maps.ts";
import { paletteParts } from "../app/palette.ts";

globalThis.ProgressEvent ??= class ProgressEvent extends Event {
  constructor(type, init = {}) {
    super(type);
    this.lengthComputable = init.lengthComputable ?? false;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
};

const commandArguments = process.argv.slice(2),
  repositoryArgument = commandArguments.find((argument) => !argument.startsWith("--")),
  selectedArgument = commandArguments.find((argument) => argument.startsWith("--parts=")),
  selectedReferences = new Set(
    (selectedArgument?.slice("--parts=".length) ?? "")
      .split(",")
      .map((reference) => reference.trim().toLowerCase())
      .filter(Boolean),
  ),
  selective = selectedReferences.size > 0,
  repositoryRoot = resolve(
    repositoryArgument || fileURLToPath(new URL("..", import.meta.url)),
  ),
  publicRoot = join(repositoryRoot, "public"),
  ldrawRoot = join(publicRoot, "ldraw"),
  catalogRoot = join(publicRoot, "catalog"),
  geometryRoot = join(catalogRoot, "geometry"),
  renderRoot = join(catalogRoot, "renders"),
  sourceBase = "https://cdn.jsdelivr.net/gh/remig/ldraw_parts@master/",
  partsToProcess = selective
    ? paletteParts.filter(
        (part) =>
          selectedReferences.has(part.part.toLowerCase()) ||
          selectedReferences.has((part.modelPart ?? part.part).toLowerCase()),
      )
    : paletteParts;

await Promise.all(
  [ldrawRoot, catalogRoot, geometryRoot, renderRoot].map((directory) =>
    mkdir(directory, { recursive: true }),
  ),
);

const fileMap = {},
  resolvedFiles = new Map(),
  queuedReferences = new Set(),
  queue = [];

try {
  Object.assign(
    fileMap,
    JSON.parse(await readFile(join(ldrawRoot, "file-map.json"), "utf8")),
  );
} catch {}

const normalizedReference = (reference) =>
  reference.trim().replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
const enqueue = (reference) => {
  const key = normalizedReference(reference);
  if (!key || queuedReferences.has(key)) return;
  queuedReferences.add(key);
  queue.push(key);
};
const candidatesFor = (reference) => {
  if (/^(parts|p|models)\//.test(reference)) return [reference];
  if (reference.startsWith("s/")) return [`parts/${reference}`];
  if (/^(8|48)\//.test(reference)) return [`p/${reference}`];
  return [`parts/${reference}`, `p/${reference}`, `models/${reference}`];
};
const referencedFiles = (text) =>
  text
    .split(/\r?\n/)
    .filter((line) => /^\s*1\s+/.test(line))
    .map((line) => line.trim().split(/\s+/).slice(14).join(" "))
    .filter(Boolean);
const fetchLibraryFile = async (reference) => {
  if (resolvedFiles.has(reference)) return resolvedFiles.get(reference);
  const existingPath = fileMap[reference];
  let result = null;
  for (const candidate of candidatesFor(reference)) {
    const response = await fetch(sourceBase + candidate);
    if (!response.ok) continue;
    const text = await response.text(),
      destination = join(ldrawRoot, ...candidate.split("/"));
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, text, "utf8");
    fileMap[reference] = candidate;
    if (candidate.startsWith("parts/"))
      fileMap[candidate.slice("parts/".length)] ??= candidate;
    result = { candidate, text };
    referencedFiles(text).forEach(enqueue);
    break;
  }
  if (!result && existingPath) {
    try {
      const text = await readFile(join(ldrawRoot, ...existingPath.split("/")), "utf8");
      result = { candidate: existingPath, text };
      referencedFiles(text).forEach(enqueue);
    } catch {}
  }
  resolvedFiles.set(reference, result);
  return result;
};

const materialResponse = await fetch(sourceBase + "LDConfig.ldr");
if (!materialResponse.ok) throw new Error("No se pudo descargar LDConfig.ldr");
await writeFile(join(ldrawRoot, "LDConfig.ldr"), await materialResponse.text(), "utf8");
for (const legalFile of ["CAreadme.txt", "CAlicense.txt", "CAlicense4.txt"]) {
  const response = await fetch(sourceBase + legalFile);
  if (response.ok)
    await writeFile(join(ldrawRoot, legalFile), await response.text(), "utf8");
  else {
    try {
      await readFile(join(ldrawRoot, legalFile));
    } catch {
      throw new Error(`No se pudo obtener ${legalFile}`);
    }
  }
}

for (const part of partsToProcess) enqueue(`${part.modelPart ?? part.part}.dat`);
let cursor = 0;
while (cursor < queue.length) {
  const batch = queue.slice(cursor, cursor + 12);
  cursor += batch.length;
  await Promise.all(batch.map(fetchLibraryFile));
}
await writeFile(
  join(ldrawRoot, "file-map.json"),
  JSON.stringify(fileMap, null, 2) + "\n",
  "utf8",
);

await Promise.all(
  [...new Map(partsToProcess.map((part) => [part.modelPart ?? part.part, part])).values()].map(
    async (part) => {
      if (!part.sourceThumb?.startsWith("http")) return;
      const response = await fetch(part.sourceThumb);
      if (!response.ok) return;
      await writeFile(
        join(renderRoot, `${part.modelPart ?? part.part}.png`),
        Buffer.from(await response.arrayBuffer()),
      );
    },
  ),
);

const contentTypes = {
  ".dat": "text/plain; charset=utf-8",
  ".ldr": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
};
const server = createServer(async (request, response) => {
  try {
    const relative = decodeURIComponent(new URL(request.url, "http://localhost").pathname).replace(
        /^\/+/,
        "",
      ),
      requested = normalize(join(publicRoot, relative));
    if (!requested.startsWith(normalize(publicRoot + sep))) throw new Error("Ruta inválida");
    const data = await readFile(requested);
    response.writeHead(200, {
      "content-type": contentTypes[extname(requested).toLowerCase()] || "application/octet-stream",
    });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const address = server.address(),
  localBase = `http://127.0.0.1:${address.port}/ldraw/`,
  loader = new LDrawLoader();
loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
loader.setPartsLibraryPath(localBase);
loader.setFileMap(fileMap);
await loader.preloadMaterials(localBase + "LDConfig.ldr");

const modelText = (part) =>
    `0 FILE ${part.part}.ldr\n1 ${part.color} 0 0 0 1 0 0 0 1 0 0 0 1 ${part.modelPart ?? part.part}.dat\n0`,
  isPinPart = (part) =>
    /^Technic (Axle )?Pin/i.test(part.name) ||
    new Set(["2780", "6558", "32054", "43093"]).has(part.part),
  isAxlePart = (part) => /^Technic Axle(?! Pin)/i.test(part.name),
  vectors = (items) =>
    items.map((item) => ({
      ...item,
      local: new THREE.Vector3().fromArray(item.local),
      axis: new THREE.Vector3().fromArray(item.axis).normalize(),
    })),
  serializeConnector = (connector) => ({
    local: connector.local.toArray(),
    axis: connector.axis.toArray(),
    kind: connector.kind,
    role: connector.role,
    diameter: connector.diameter,
    ...(connector.length === undefined ? {} : { length: connector.length }),
  }),
  serializeCollider = (collider) => ({
    shape: collider.shape,
    center: collider.center.toArray(),
    ...(collider.size ? { size: collider.size.toArray() } : {}),
    ...(collider.radius === undefined ? {} : { radius: collider.radius }),
    ...(collider.halfHeight === undefined ? {} : { halfHeight: collider.halfHeight }),
    rotation: collider.rotation.toArray(),
  });

let catalog = { version: 1, parts: {}, assets: {} };
if (selective) {
  try {
    catalog = JSON.parse(
      await readFile(join(repositoryRoot, "app", "preloaded-catalog.json"), "utf8"),
    );
  } catch {}
}
try {
  for (const part of partsToProcess) {
    const assetKey = `${part.part}-${part.color}`,
      geometryFile = `catalog/geometry/${assetKey}.json`;
    let exact = await loader.loadAsync(
      `data:text/plain;charset=utf-8,${encodeURIComponent(modelText(part))}`,
    );
    await writeFile(
      join(publicRoot, geometryFile),
      JSON.stringify(exact.toJSON()),
      "utf8",
    );
    exact.rotation.x = Math.PI;
    exact.scale.setScalar(0.05);
    exact.updateMatrixWorld(true);
    const wrapper = new THREE.Group();
    wrapper.add(exact);
    wrapper.updateMatrixWorld(true);
    let connectors;
    if (preloadedConnectionMaps[part.part])
      connectors = vectors(preloadedConnectionMaps[part.part]);
    else if (isPinPart(part)) {
      const shafts = /^Technic Axle Pin/i.test(part.name)
          ? hybridAxlePinConnectors(wrapper)
          : rodConnectors(wrapper, "round"),
        sockets = detectConnectorHoles(wrapper);
      connectors = [
        ...shafts,
        ...sockets.filter(
          (socket) => !shafts.some((shaft) => shaft.local.distanceTo(socket.local) < 0.12),
        ),
      ];
    } else if (isAxlePart(part)) {
      const shafts = rodConnectors(wrapper, "axle"),
        sockets = detectConnectorHoles(wrapper);
      connectors = [
        ...shafts,
        ...sockets.filter(
          (socket) => !shafts.some((shaft) => shaft.local.distanceTo(socket.local) < 0.12),
        ),
      ];
    } else {
      connectors = detectConnectorHoles(wrapper);
      if (!connectors.length) connectors = fallbackBeamConnectors(wrapper, part.name);
    }
    if (!connectors.length && /gear|wheel|bush/i.test(part.name)) {
      const bounds = objectLocalBounds(wrapper),
        size = bounds.getSize(new THREE.Vector3()),
        dimensions = [size.x, size.y, size.z],
        axisIndex = dimensions.indexOf(Math.min(...dimensions)),
        axis = new THREE.Vector3();
      axis.setComponent(axisIndex, 1);
      connectors = [
        {
          local: bounds.getCenter(new THREE.Vector3()),
          axis,
          kind: "axle",
          role: "socket",
          diameter: 0.8,
          length: dimensions[axisIndex],
        },
      ];
    }
    const colliders = preloadedCollisionMaps[part.part]
        ? preloadedCollisionMaps[part.part].map((primitive) => ({
            ...primitive,
            center: new THREE.Vector3().fromArray(primitive.center),
            size: primitive.size
              ? new THREE.Vector3().fromArray(primitive.size)
              : undefined,
            rotation: new THREE.Quaternion().fromArray(primitive.rotation),
          }))
        : approximateCollisionPrimitives(wrapper, part.name, connectors),
      box = new THREE.Box3().setFromObject(wrapper),
      rootFile = resolvedFiles.get(`${(part.modelPart ?? part.part).toLowerCase()}.dat`);
    catalog.parts[part.part] = {
      name: part.name,
      family: part.family,
      modelPart: part.modelPart ?? part.part,
      modelFile: rootFile?.candidate ?? `parts/${part.modelPart ?? part.part}.dat`,
      connectors: connectors.map(serializeConnector),
      colliders: colliders.map(serializeCollider),
      bounds: { min: box.min.toArray(), max: box.max.toArray() },
    };
    catalog.assets[assetKey] = {
      geometry: geometryFile,
      render: `catalog/renders/${part.modelPart ?? part.part}.png`,
      color: part.color,
    };
  }
} finally {
  await new Promise((done) => server.close(done));
}

await writeFile(
  join(repositoryRoot, "app", "preloaded-catalog.json"),
  JSON.stringify(catalog, null, 2) + "\n",
  "utf8",
);
await writeFile(
  join(catalogRoot, "manifest.json"),
  JSON.stringify(catalog, null, 2) + "\n",
  "utf8",
);
console.log(
  `Catálogo generado: ${partsToProcess.length} variantes actualizadas, ${resolvedFiles.size} archivos LDraw resueltos.`,
);
