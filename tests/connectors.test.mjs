import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as THREE from "three";
import {
  approximateCollisionPrimitives,
  detectConnectorHoles,
} from "../app/connectors.ts";
import { preloadedConnectionMaps } from "../app/connection-maps.ts";

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
});
