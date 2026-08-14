import * as THREE from "three";

/**
 * LDrawLoader keeps many type-1 subfile transforms in matrixWorld while the
 * corresponding local Object3D matrices remain identity. Object3D.toJSON()
 * only serializes local transforms, and cloning that hierarchy can therefore
 * collapse repeated teeth/subparts onto one another.
 *
 * Flatten renderable objects into the root coordinate system while preserving
 * the exact affine matrix (including reflections and shear). Keeping the
 * matrix instead of decomposing it is important for BFC mirrored subfiles:
 * Three.js uses the matrix determinant to select the correct front face.
 */
export function flattenLDrawRenderables(source: THREE.Object3D) {
  source.updateMatrixWorld(true);
  const flattened = new THREE.Group(),
    inverseRoot = source.matrixWorld.clone().invert();
  flattened.name = source.name;
  flattened.userData = structuredClone(source.userData);

  source.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line))
      return;
    const renderable = object.clone(false),
      relativeMatrix = inverseRoot.clone().multiply(object.matrixWorld);
    renderable.matrixAutoUpdate = false;
    renderable.matrix.copy(relativeMatrix);
    renderable.matrixWorld.copy(relativeMatrix);
    flattened.add(renderable);
  });
  flattened.updateMatrixWorld(true);
  return flattened;
}
