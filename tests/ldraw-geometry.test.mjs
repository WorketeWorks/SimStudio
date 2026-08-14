import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { flattenLDrawRenderables } from "../app/ldraw-geometry.ts";

const worldPositions = (root) => {
  root.updateMatrixWorld(true);
  const result = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line)) return;
    const position = object.geometry.getAttribute("position");
    for (let index = 0; index < position.count; index++)
      result.push(
        new THREE.Vector3()
          .fromBufferAttribute(position, index)
          .applyMatrix4(object.matrixWorld)
          .toArray(),
      );
  });
  return result;
};

test("flattening preserves LDraw world transforms through JSON serialization", () => {
  const source = new THREE.Group(), parent = new THREE.Group();
  // LDraw matrices may contain a reflection and non-uniform affine scale.
  parent.matrixAutoUpdate = false;
  parent.matrix.set(-2, 0.25, 0, 7, 0, 1, 0, -3, 0, 0, 0.5, 11, 0, 0, 0, 1);
  source.add(parent);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4), new THREE.MeshBasicMaterial());
  parent.add(mesh);
  const expected = worldPositions(source);

  const flattened = flattenLDrawRenderables(source),
    restored = new THREE.ObjectLoader().parse(flattened.toJSON());
  assert.deepEqual(worldPositions(restored), expected);
  const restoredMesh = restored.children[0];
  assert.equal(restoredMesh.matrixAutoUpdate, false);
  assert.ok(restoredMesh.matrix.determinant() < 0, "the BFC reflection must survive");
});

test("separate repeated subparts keep their individual placements", () => {
  const source = new THREE.Group(), geometry = new THREE.BoxGeometry(1, 1, 1);
  for (const x of [-4, 6]) {
    const group = new THREE.Group(), mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    group.position.x = x;
    group.rotation.z = x < 0 ? Math.PI / 4 : -Math.PI / 3;
    group.add(mesh);
    source.add(group);
  }
  const flattened = flattenLDrawRenderables(source);
  assert.equal(flattened.children.length, 2);
  assert.notDeepEqual(flattened.children[0].matrix.elements, flattened.children[1].matrix.elements);
});

test("the corrected packaged parts retain their complete catalog bounds", async () => {
  const catalog = JSON.parse(
      await readFile(new URL("../app/preloaded-catalog.json", import.meta.url), "utf8"),
    ),
    cases = [
      ["3649", 72],
      ["32198", 19],
      ["63869", 71],
      ["14720", 71],
    ];
  for (const [part, color] of cases) {
    const asset = JSON.parse(
        await readFile(
          new URL(`../public/catalog/geometry/${part}-${color}.json`, import.meta.url),
          "utf8",
        ),
      ),
      model = new THREE.ObjectLoader().parse(asset);
    model.rotation.x = Math.PI;
    model.scale.setScalar(0.05);
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model),
      expected = catalog.parts[part].bounds;
    bounds.min.toArray().forEach((value, index) =>
      assert.ok(Math.abs(value - expected.min[index]) < 1e-6, `${part} min ${index}`),
    );
    bounds.max.toArray().forEach((value, index) =>
      assert.ok(Math.abs(value - expected.max[index]) < 1e-6, `${part} max ${index}`),
    );
  }
});

test("nested gear teeth remain distributed around the complete gear", async () => {
  for (const [assetName, vertexCount, expectedInstances] of [
    ["3649-72", 60, 40],
    ["32198-19", 48, 20],
  ]) {
    const asset = JSON.parse(
        await readFile(
          new URL(`../public/catalog/geometry/${assetName}.json`, import.meta.url),
          "utf8",
        ),
      ),
      model = new THREE.ObjectLoader().parse(asset),
      centers = new Set();
    model.updateMatrixWorld(true);
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.geometry.getAttribute("position").count !== vertexCount) return;
      const center = new THREE.Box3()
        .setFromObject(object)
        .getCenter(new THREE.Vector3())
        .toArray()
        .map((value) => value.toFixed(3))
        .join(":");
      centers.add(center);
    });
    assert.equal(centers.size, expectedInstances, `${assetName} tooth placements`);
  }
});
