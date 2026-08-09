import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import {
  ldrawToScenePlacement,
  parseLDR,
} from "../app/ldraw.ts";
import { extractStudioLDraw } from "../app/studio-io.ts";

test("expands MPD submodels with composed position and rotation", () => {
  const source = [
    "0 FILE main.ldr",
    "1 16 10 20 30 0 -1 0 1 0 0 0 0 1 arm.ldr",
    "0 FILE arm.ldr",
    "1 4 5 0 0 1 0 0 0 0 -1 0 1 0 32523.dat",
  ].join("\n");

  assert.deepEqual(parseLDR(source), [
    {
      part: "32523",
      color: 4,
      position: [10, 25, 30],
      matrix: [0, 0, 1, 1, 0, 0, 0, 1, 0],
    },
  ]);
});

test("uses the same right-handed basis change for position and rotation", () => {
  const converted = ldrawToScenePlacement({
    part: "32523",
    color: 71,
    position: [40, -60, 80],
    matrix: [0, -1, 0, 1, 0, 0, 0, 0, 1],
  });

  assert.deepEqual(converted.position, [2, 3, -4]);
  assert.deepEqual(converted.matrix, [0, 1, 0, -1, 0, 0, 0, 0, 1]);
});

test("extracts BrickLink Studio's canonical model.ldr from an .io archive", () => {
  const source = "0 FILE sample.io\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 2780.dat\n0";
  const archive = zipSync({
    "thumbnail.png": new Uint8Array([137, 80, 78, 71]),
    "modelv2.ldr": strToU8("11 internal Studio data"),
    "model.ldr": strToU8(source),
  });

  assert.equal(extractStudioLDraw(archive), source);
  assert.equal(parseLDR(extractStudioLDraw(archive)).length, 1);
});
