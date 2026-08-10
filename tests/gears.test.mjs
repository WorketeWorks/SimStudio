import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../app/gears.ts", import.meta.url), "utf8"),
  js = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }),
  module = { exports: {} };
vm.runInNewContext(`(function(exports,module){${js}\n})(module.exports,module);`, { module });
const { findParallelGearPairs, gearCenterDistance, gearRatio, gearSpecFor } = module.exports;

test("recognises palette gears and pitch radius", () => {
  assert.deepEqual({ ...gearSpecFor("32269", "Technic Gear 20 Tooth Double Bevel") }, {
    teeth: 20,
    kind: "double-bevel",
    pitchRadius: 1.25,
  });
  assert.equal(gearCenterDistance(8, 24), 2);
  assert.equal(gearRatio(8, 24), -1 / 3);
});

test("links compatible parallel gears and rejects wrong distances", () => {
  const pose = (id, teeth, x, y = 0) => ({
    value: id,
    spec: { teeth, kind: "spur", pitchRadius: teeth / 16 },
    center: [x, y, 0],
    axis: [0, 1, 0],
  });
  const result = findParallelGearPairs([
    pose("8t", 8, 0),
    pose("24t", 24, 2),
    pose("far", 8, 8),
    { ...pose("tilted", 8, 1), axis: [1, 0, 0] },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].ratio, -1 / 3);
  assert.equal(result[0].expectedDistance, 2);
});

test("accepts the reported 94925, 32270, 32498 and 32269 spacings", () => {
  const pose = (id, teeth, x) => ({
    value: id,
    spec: { teeth, kind: "double-bevel", pitchRadius: teeth / 16 },
    center: [x, 0, 0],
    axis: [0, 0, 1],
  });
  assert.equal(findParallelGearPairs([pose("94925-a", 16, 0), pose("94925-b", 16, 2)]).length, 1);
  assert.equal(findParallelGearPairs([pose("32270", 12, 0), pose("32498", 36, 3)]).length, 1);
  assert.equal(findParallelGearPairs([pose("32270", 12, 0), pose("32269", 20, 2)]).length, 1);
  assert.equal(findParallelGearPairs([pose("32498", 36, 0), pose("46372", 28, 4)]).length, 1);
});

test("allows half a stud of axial offset but disengages beyond the envelope", () => {
  const gear = (id, y) => ({
    value: id,
    spec: { teeth: 16, kind: "spur", pitchRadius: 1 },
    center: [id === "a" ? 0 : 2, y, 0],
    axis: [0, 1, 0],
  });
  assert.equal(findParallelGearPairs([gear("a", 0), gear("b", 0.5)]).length, 1);
  assert.equal(findParallelGearPairs([gear("a", 0), gear("b", 0.6)]).length, 0);
});

test("keeps slightly interpenetrating teeth engaged but disconnects when separated", () => {
  const gear = (id, x) => ({
    value: id,
    spec: { teeth: 16, kind: "spur", pitchRadius: 1 },
    center: [x, 0, 0],
    axis: [0, 1, 0],
  });
  assert.equal(findParallelGearPairs([gear("a", 0), gear("b", 1.7)]).length, 1);
  assert.equal(findParallelGearPairs([gear("a", 0), gear("b", 2.15)]).length, 0);
  assert.equal(findParallelGearPairs([gear("a", 0), gear("b", 1.6)]).length, 0);
});
