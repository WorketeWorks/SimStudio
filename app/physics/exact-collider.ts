/**
 * Builds a validated Rapier triangle mesh from the visible Three.js model.
 * Invalid submeshes are skipped atomically so their indices cannot reference
 * partial vertex buffers and crash the WebAssembly physics engine.
 */
import * as THREE from "three";

type ExactColliderPiece = { mesh: THREE.Object3D };

export const exactTriangleMeshForPiece = (
  piece: ExactColliderPiece,
  physicsOffset: THREE.Vector3,
  physicsBase: THREE.Quaternion,
) => {
  piece.mesh.updateMatrixWorld(true);
  const rootInverse = piece.mesh.matrixWorld.clone().invert(),
    bodyFromPiece = new THREE.Matrix4().compose(
      physicsOffset,
      physicsBase,
      piece.mesh.scale,
    ),
    vertices: number[] = [],
    indices: number[] = [],
    maximumCoordinate = 10000;
  piece.mesh.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
    const position = object.geometry.getAttribute("position");
    if (!position || position.itemSize < 3 || position.count < 3) return;
    const transform = bodyFromPiece
        .clone()
        .multiply(rootInverse.clone().multiply(object.matrixWorld)),
      localVertices: number[] = [],
      localIndices: number[] = [],
      point = new THREE.Vector3(),
      a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3(),
      edgeA = new THREE.Vector3(),
      edgeB = new THREE.Vector3();
    for (let index = 0; index < position.count; index++) {
      point
        .fromBufferAttribute(position as THREE.BufferAttribute, index)
        .applyMatrix4(transform);
      if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        !Number.isFinite(point.z) ||
        Math.abs(point.x) > maximumCoordinate ||
        Math.abs(point.y) > maximumCoordinate ||
        Math.abs(point.z) > maximumCoordinate
      )
        return;
      localVertices.push(point.x, point.y, point.z);
    }
    const sourceIndices = object.geometry.index;
    const triangleCount = sourceIndices
      ? Math.floor(sourceIndices.count / 3)
      : Math.floor(position.count / 3);
    for (let triangle = 0; triangle < triangleCount; triangle++) {
      const indexOffset = triangle * 3,
        indexA = sourceIndices ? sourceIndices.getX(indexOffset) : indexOffset,
        indexB = sourceIndices ? sourceIndices.getX(indexOffset + 1) : indexOffset + 1,
        indexC = sourceIndices ? sourceIndices.getX(indexOffset + 2) : indexOffset + 2;
      if (
        !Number.isInteger(indexA) ||
        !Number.isInteger(indexB) ||
        !Number.isInteger(indexC) ||
        indexA < 0 ||
        indexB < 0 ||
        indexC < 0 ||
        indexA >= position.count ||
        indexB >= position.count ||
        indexC >= position.count ||
        indexA === indexB ||
        indexB === indexC ||
        indexC === indexA
      )
        continue;
      a.fromArray(localVertices, indexA * 3);
      b.fromArray(localVertices, indexB * 3);
      c.fromArray(localVertices, indexC * 3);
      edgeA.subVectors(b, a);
      edgeB.subVectors(c, a);
      if (edgeA.cross(edgeB).lengthSq() <= 1e-12) continue;
      localIndices.push(indexA, indexB, indexC);
    }
    if (localIndices.length < 3) return;
    const vertexOffset = vertices.length / 3;
    vertices.push(...localVertices);
    for (const index of localIndices) indices.push(vertexOffset + index);
  });
  return vertices.length >= 9 && indices.length >= 3
    ? {
        vertices: new Float32Array(vertices),
        indices: new Uint32Array(indices),
      }
    : undefined;
};
