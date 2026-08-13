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

test("sanitizes the project download name", () => {
  assert.equal(safeProjectFileName('Drive: 8/20 * demo'), "Drive- 8-20 - demo.simstudio");
});
