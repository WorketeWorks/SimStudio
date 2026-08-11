import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as THREE from "three";
import {
  approximateCollisionPrimitives,
  approximateGearCollisionPrimitives,
  detectConnectorHoles,
  straightAxleCollisionPrimitives,
  straightAxleConnectors,
} from "../app/connectors.ts";
import { preloadedConnectionMaps } from "../app/connection-maps.ts";
import { preloadedCollisionMaps } from "../app/collision-maps.ts";
import {
  buildConnectorContactExclusions,
  contactPairKey,
} from "../app/physics-contact-filter.ts";

const loadPart = (asset) => {
  const exact = new THREE.ObjectLoader().parse(
    JSON.parse(readFileSync(`public/catalog/geometry/${asset}.json`, "utf8")),
  );
  exact.rotation.x = Math.PI;
  exact.scale.setScalar(0.05);
  const root = new THREE.Group();
  root.add(exact);
  root.updateMatrixWorld(true);
  return root;
};

const connectorAt = (connectors, position) =>
  connectors.find(
    (connector) =>
      connector.local.distanceTo(new THREE.Vector3(...position)) < 0.05,
  );

test("detects round and cross holes on the small L beam", () => {
  const connectors = detectConnectorHoles(loadPart("32056-72"));
  for (const position of [
    [0, 0, 0],
    [2, 0, 0],
    [0, 0, -2],
  ])
    assert.equal(connectorAt(connectors, position)?.kind, "axle");
  for (const position of [
    [1, 0, 0],
    [0, 0, -1],
  ])
    assert.equal(connectorAt(connectors, position)?.kind, "round");
  assert.equal(connectors.length, 5);
});

test("does not confuse the perpendicular cross hole with a round hole", () => {
  const connectors = detectConnectorHoles(loadPart("32013-71"));
  assert.equal(connectorAt(connectors, [0, 0, 0])?.kind, "round");
  assert.equal(connectorAt(connectors, [0, 0, 1])?.kind, "axle");
  assert.equal(connectors.length, 2);
});

test("builds the small L collider from two orthogonal boxes", () => {
  const root = loadPart("32056-72"),
    connectors = preloadedConnectionMaps["32056"].map((connector) => ({
      ...connector,
      local: new THREE.Vector3().fromArray(connector.local),
      axis: new THREE.Vector3().fromArray(connector.axis),
    })),
    colliders = approximateCollisionPrimitives(
      root,
      "Technic Beam 3 x 3 x 0.5 Bent 90°",
      connectors,
    ),
    boxes = colliders.filter((collider) => collider.shape === "box");
  assert.equal(boxes.length, 2);
  assert.ok(connectorAt(
    boxes.map((box) => ({ local: box.center })),
    [1, 0, 0],
  ));
  assert.ok(connectorAt(
    boxes.map((box) => ({ local: box.center })),
    [0, 0, -1],
  ));
  boxes.forEach((box) => {
    assert.equal(box.size.y, 0.5);
    assert.equal(box.size.z, 0.9);
  });
  colliders
    .filter((collider) => collider.shape === "cylinder")
    .forEach((cylinder) => {
      assert.equal(cylinder.radius, 0.45);
      assert.equal(cylinder.halfHeight, 0.25);
    });
});

test("full beams use a 0.45 radial collision envelope", () => {
  const root = loadPart("32523-71"),
    connectors = detectConnectorHoles(root),
    colliders = approximateCollisionPrimitives(
      root,
      "Technic Beam 3",
      connectors,
    );
  colliders.filter((item) => item.shape === "box").forEach((box) => {
    assert.equal(box.size.y, 1);
    assert.equal(box.size.z, 0.9);
  });
  colliders.filter((item) => item.shape === "cylinder").forEach((cylinder) => {
    assert.equal(cylinder.radius, 0.45);
    assert.equal(cylinder.halfHeight, 0.5);
  });
  const singleRoot = loadPart("18654-71"),
    single = approximateCollisionPrimitives(
      singleRoot,
      "Technic Beam 1",
      detectConnectorHoles(singleRoot),
    );
  assert.equal(single.length, 1);
  assert.equal(single[0].radius, 0.45);
  assert.equal(single[0].halfHeight, 0.5);
});

test("scales the reviewed cross-axle template by stud length", () => {
  for (const studs of [2, 4, 12]) {
    const name = `Technic Axle ${studs}${studs === 2 ? " Notched" : ""}`,
      connectors = straightAxleConnectors(name),
      colliders = straightAxleCollisionPrimitives(name);
    assert.equal(connectors.length, 1);
    assert.equal(connectors[0].length, studs);
    assert.equal(connectors[0].diameter, 0.6);
    assert.deepEqual(connectors[0].axis.toArray(), [1, 0, 0]);
    assert.equal(colliders.length, 2);
    assert.deepEqual(colliders[0].size.toArray(), [studs, 0.2, 0.6]);
    assert.deepEqual(colliders[1].size.toArray(), [studs, 0.6, 0.2]);
  }
  assert.equal(
    straightAxleCollisionPrimitives("Technic Axle 4 with Stop"),
    undefined,
  );
});

test("gear contact colliders sit inside the normal tooth envelope", () => {
  const normal = [{
      shape: "cylinder",
      center: new THREE.Vector3(),
      radius: 2,
      halfHeight: 0.5,
      rotation: new THREE.Quaternion(),
    }],
    gear = approximateGearCollisionPrimitives(normal);
  assert.equal(gear.length, 1);
  assert.ok(gear[0].radius < normal[0].radius);
  assert.ok(gear[0].halfHeight < normal[0].halfHeight);
});

test("gears, tyres and axle connector shells use a 0.95 envelope", () => {
  for (const [asset, name] of [
    ["6589-19", "Technic Gear 12 Tooth Bevel"],
    ["4185-71", "Technic Wedge Belt Wheel"],
  ]) {
    const root = loadPart(asset),
      size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()),
      dimensions = size.toArray(),
      thicknessAxis = dimensions.indexOf(Math.min(...dimensions)),
      radialDiameter = Math.max(
        ...dimensions.filter((_, index) => index !== thicknessAxis),
      ),
      [collider] = approximateCollisionPrimitives(root, name, []);
    assert.ok(Math.abs((collider.radius * 2) / radialDiameter - 0.95) < 1e-6);
    assert.ok(
      Math.abs(
        (collider.halfHeight * 2) / dimensions[thicknessAxis] - 0.95,
      ) < 1e-6,
    );
  }
  const joiner = approximateCollisionPrimitives(
    loadPart("6538c-71"),
    "Technic Axle Joiner Inline Smooth",
    [],
  );
  assert.equal(joiner[0].radius, 0.475);
});

test("keeps every restored correction map preloaded", () => {
  for (const part of [
    "3713", "32016", "32034", "32192", "55615", "4265c", "11478",
    "32062", "99773",
  ])
    assert.ok(preloadedConnectionMaps[part]?.length, `${part} connection map`);
  for (const part of [
    "32013", "32016", "32034", "32192", "3713", "87408", "18654",
    "2825", "32062", "32184", "32271", "4265c", "45590", "55615",
    "60484", "64179", "99773",
  ])
    assert.ok(preloadedCollisionMaps[part]?.length, `${part} collision map`);
});

test("a shaft ignores the full rigid host islands but not adjacent mobile islands", () => {
  const hostA = { id: 1 },
    hostAExtension = { id: 2 },
    hostB = { id: 3 },
    adjacentMobileGroup = { id: 4 },
    shaft = { id: 5 },
    otherShaft = { id: 6 },
    islands = new Map([
      [hostA, [hostA, hostAExtension]],
      [hostAExtension, [hostA, hostAExtension]],
      [hostB, [hostB]],
      [adjacentMobileGroup, [adjacentMobileGroup]],
      [shaft, [shaft]],
      [otherShaft, [otherShaft]],
    ]),
    exclusions = buildConnectorContactExclusions(
      [
        { a: hostA, b: shaft },
        { a: hostB, b: shaft },
        { a: hostA, b: otherShaft },
      ],
      islands,
    );
  assert.ok(exclusions.has(contactPairKey(shaft, hostA)));
  assert.ok(exclusions.has(contactPairKey(shaft, hostAExtension)));
  assert.ok(exclusions.has(contactPairKey(shaft, hostB)));
  assert.ok(!exclusions.has(contactPairKey(shaft, adjacentMobileGroup)));
  assert.ok(!exclusions.has(contactPairKey(shaft, otherShaft)));
});
