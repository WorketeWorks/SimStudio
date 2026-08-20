import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import * as THREE from "three";

const source = readFileSync(
  new URL("../app/physics/gear-topology.ts", import.meta.url),
  "utf8",
);
const js = ts.transpile(source, {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
});
const module = { exports: {} };
const gearSpecFor = (part) => {
  if (part === "6573") return { teeth: 24, kind: "bevel", pitchRadius: 1.5 };
  if (part === "94925") return { teeth: 16, kind: "spur", pitchRadius: 1 };
  if (part === "3648") return { teeth: 24, kind: "spur", pitchRadius: 1.5 };
};
const customRequire = (request) => {
  if (request === "three") return THREE;
  if (request === "../gears") return { gearSpecFor };
  if (request === "../physics-contact-filter")
    return { contactPairKey: (a, b) => [a.id, b.id].sort().join(":") };
  throw new Error(`Unexpected dependency: ${request}`);
};
vm.runInNewContext(
  `(function(exports,module,require){${js}\n})(module.exports,module,require);`,
  { module, require: customRequire },
);

const { detectGearLinks } = module.exports;
const cylinder = (center, radius, ratio) => ({
  shape: "cylinder",
  center: new THREE.Vector3(...center),
  radius,
  halfHeight: 0.25,
  rotation: new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    Math.PI / 2,
  ),
  gearRatio: ratio,
});

test("6573 large 1.5-radius zone meshes with a 24-tooth gear at 3 studs", () => {
  const carrier = piece("carrier", "6573", 0, 0, [
    cylinder([0, 0, -1.5], 1.6, 1.5),
    cylinder([0, 0, 1.5], 1.1, 1),
  ], true);
  const gear24 = piece("gear-24", "3648", 3, -1.5, [
    cylinder([0, 0, 0], 1.55),
  ]);

  const links = detectGearLinks([carrier, gear24]);
  assert.equal(links.length, 1);
  assert.equal(links[0].ratioOverride, 1);
  assert.equal(links[0].expectedDistance, 3);
});
const piece = (id, part, x, z, colliders, specialGear = false) => {
  const mesh = new THREE.Object3D();
  mesh.position.set(x, 0, z);
  mesh.updateMatrixWorld(true);
  return {
    id,
    part,
    name: part,
    gear: true,
    specialGear,
    mesh,
    body: { id },
    connectors: [{
      role: "socket",
      kind: "axle",
      local: new THREE.Vector3(),
      axis: new THREE.Vector3(0, 0, 1),
    }],
    colliders,
    gearColliders: [],
  };
};

test("6573 exposes independent 1.5 and 1.0 external gear zones", () => {
  const carrier = piece("carrier", "6573", 0, 0, [
    cylinder([0, 0, -1.5], 1.6, 1.5),
    cylinder([0, 0, 1.5], 1.1, 1),
  ], true);
  const largeSide = piece("large-side", "94925", 2.5, -1.5, [
    cylinder([0, 0, 0], 1.05),
  ]);
  const smallSide = piece("small-side", "94925", 2, 1.5, [
    cylinder([0, 0, 0], 1.05),
  ]);

  const links = detectGearLinks([carrier, largeSide, smallSide]);
  assert.equal(links.length, 2);
  assert.deepEqual(
    Array.from(links, (link) => link.ratioOverride).sort((a, b) => a - b),
    [1, 1.5],
  );
  assert.deepEqual(
    Array.from(links, (link) => link.a.center[2]).sort((a, b) => a - b),
    [-1.5, 1.5],
  );
});
