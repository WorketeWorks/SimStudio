import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const source = readFileSync(new URL("../app/project-format.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(
  `(function(require,exports,module){${javascript}\n})(require,module.exports,module);`,
  { require, module, Uint8Array, ArrayBuffer, indexedDB: undefined },
);
const {
  decodeProjectFile,
  encodeProjectFile,
  safeProjectFileName,
  validateProjectDocument,
} = module.exports;

const fixture = {
  format: "simstudio-project",
  version: 1,
  id: "project-1",
  name: "Gear test",
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T00:01:00.000Z",
  appVersion: "0.4",
  assets: {},
  pieces: [],
  connections: [],
  gearLinks: [],
  importedCatalog: [],
  camera: { position: [1, 2, 3], quaternion: [0, 0, 0, 1], target: [0, 0, 0] },
  settings: {
    gridStep: 0.25,
    axleSnapStep: 0.25,
    rotationSnapStep: 22.5,
    structuralMode: "rigid",
    structuralStiffness: 85,
    physics: {},
  },
};

test("round-trips a compressed .simstudio project", () => {
  const encoded = encodeProjectFile(fixture);
  assert.ok(encoded.length > 12);
  assert.deepEqual(JSON.parse(JSON.stringify(decodeProjectFile(encoded))), fixture);
});

test("accepts plain JSON projects for forward recovery", () => {
  const bytes = new TextEncoder().encode(JSON.stringify(fixture));
  assert.equal(decodeProjectFile(bytes).name, "Gear test");
});

test("rejects unrelated and unsupported files", () => {
  assert.throws(() => validateProjectDocument({ format: "other", version: 1 }));
  assert.throws(() => validateProjectDocument({ ...fixture, version: 99 }));
});

test("repairs non-finite recovery data before it reaches physics", () => {
  const damaged = {
    ...fixture,
    pieces: [
      {
        id: "piece-1",
        catalog: {},
        asset: "asset-1",
        position: [Number.NaN, Number.POSITIVE_INFINITY, 2],
        rotation: [0, 0, 0, 0],
        scale: [0, Number.NaN, 1],
        fixed: false,
        exactCollider: true,
        dynamicAxleConnections: true,
        connectors: [
          {
            local: [0, Number.NaN, 0],
            axis: [0, 0, 0],
            kind: "round",
            role: "socket",
            diameter: Number.NaN,
          },
        ],
        colliders: [
          {
            shape: "cylinder",
            center: [0, 0, Number.NaN],
            radius: Number.NaN,
            halfHeight: -4,
            rotation: [0, 0, 0, 0],
          },
        ],
        gearColliders: [],
      },
    ],
    connections: [
      {
        id: "broken",
        a: "piece-1",
        b: "missing-piece",
        socketIndex: 0,
        shaftIndex: 999,
      },
    ],
    settings: {
      ...fixture.settings,
      structuralStiffness: Number.NaN,
      physics: { pieceFriction: Number.NaN, axleTolerance: 0.02 },
    },
  };
  const repaired = validateProjectDocument(damaged);
  assert.deepEqual(Array.from(repaired.pieces[0].position), [0, 0, 2]);
  assert.deepEqual(Array.from(repaired.pieces[0].rotation), [0, 0, 0, 1]);
  assert.deepEqual(Array.from(repaired.pieces[0].scale), [1, 1, 1]);
  assert.deepEqual(Array.from(repaired.pieces[0].connectors[0].axis), [0, 1, 0]);
  assert.equal(repaired.pieces[0].colliders[0].halfHeight, 0.01);
  assert.equal(repaired.connections.length, 0);
  assert.deepEqual(
    JSON.parse(JSON.stringify(repaired.settings.physics)),
    { axleTolerance: 0.02 },
  );
  assert.equal(repaired.settings.structuralStiffness, 85);
});

test("sanitizes the project download name", () => {
  assert.equal(safeProjectFileName('Drive: 8/20 * demo'), "Drive- 8-20 - demo.simstudio");
});
