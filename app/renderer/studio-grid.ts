/**
 * Creates the layered Studio-style grid.
 * The render loop recenters this finite mesh in large steps, which makes it
 * appear infinite without allocating an infinite number of lines.
 */
import * as THREE from "three";

export const GRID_SIZE = 240;

const GRID_DIVISIONS = 240;

export const GRID_RECENTER_STEP = 20;

export const createStudioGrid = (dark: boolean) => {
  const group = new THREE.Group(),
    minor = new THREE.GridHelper(
      GRID_SIZE,
      GRID_DIVISIONS,
      dark ? 0x41484f : 0xb3c1ca,
      dark ? 0x41484f : 0xb3c1ca,
    ),
    major = new THREE.GridHelper(
      GRID_SIZE,
      GRID_DIVISIONS / 10,
      dark ? 0x78838d : 0x8297a5,
      dark ? 0x78838d : 0x8297a5,
    ),
    axisMaterial = new THREE.LineBasicMaterial({
      color: dark ? 0xd5dbe0 : 0x4e6574,
      linewidth: 3,
      depthTest: true,
      depthWrite: false,
    }),
    axisX = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-GRID_SIZE / 2, 0, 0),
        new THREE.Vector3(GRID_SIZE / 2, 0, 0),
      ]),
      axisMaterial,
    ),
    axisZ = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, -GRID_SIZE / 2),
        new THREE.Vector3(0, 0, GRID_SIZE / 2),
      ]),
      axisMaterial.clone(),
    );

  const configure = (helper: THREE.GridHelper, y: number, order: number) => {
    helper.position.y = y;
    helper.renderOrder = order;
    const materials = Array.isArray(helper.material)
      ? helper.material
      : [helper.material];
    materials.forEach((material) => {
      material.transparent = true;
      material.opacity = order === 1 ? 0.72 : 0.95;
      material.depthWrite = false;
    });
  };
  configure(minor, 0.002, 1);
  configure(major, 0.007, 2);
  axisX.name = "grid-axis-x";
  axisZ.name = "grid-axis-z";
  axisX.position.y = axisZ.position.y = 0.014;
  axisX.renderOrder = axisZ.renderOrder = 3;
  group.add(minor, major, axisX, axisZ);
  return group;
};
