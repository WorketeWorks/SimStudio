import * as THREE from "three";

const OUTLINE_FADE_MARKER = "simStudioDistanceOutlineFade";
const OUTLINE_FADE_GLSL =
  "mix(1.0, 0.08, smoothstep(22.0, 85.0, vSimStudioOutlineDepth))";

const patchVertexShader = (source: string) => {
  if (source.includes("vSimStudioOutlineDepth")) return source;
  return `varying float vSimStudioOutlineDepth;\n${source}`.replace(
    "#include <fog_vertex>",
    "#include <fog_vertex>\n vSimStudioOutlineDepth = max(0.0, -mvPosition.z);",
  );
};

const patchFragmentShader = (source: string) => {
  if (source.includes("vSimStudioOutlineDepth")) return source;
  return `varying float vSimStudioOutlineDepth;\n${source}`.replace(
    "#include <fog_fragment>",
    `gl_FragColor.a *= ${OUTLINE_FADE_GLSL};\n#include <fog_fragment>`,
  );
};

/**
 * WebGL line primitives are always at least one screen pixel wide. Fade their
 * opacity with view depth so a distant one-pixel outline does not cover a
 * LEGO part that has become only a few pixels wide. This is independent from
 * scene fog and supports both normal and conditional LDraw line materials.
 */
export const configureDistanceScaledOutlineMaterial = <T extends THREE.Material>(
  material: T,
): T => {
  if (material.userData[OUTLINE_FADE_MARKER]) return material;
  material.userData[OUTLINE_FADE_MARKER] = true;
  material.transparent = true;

  if (material instanceof THREE.ShaderMaterial) {
    material.vertexShader = patchVertexShader(material.vertexShader);
    material.fragmentShader = patchFragmentShader(material.fragmentShader);
  } else {
    const previousCompile = material.onBeforeCompile,
      previousCacheKey = material.customProgramCacheKey;
    material.onBeforeCompile = (shader, renderer) => {
      previousCompile.call(material, shader, renderer);
      shader.vertexShader = patchVertexShader(shader.vertexShader);
      shader.fragmentShader = patchFragmentShader(shader.fragmentShader);
    };
    material.customProgramCacheKey = () =>
      `${previousCacheKey.call(material)}|sim-studio-distance-outline-v1`;
  }

  material.needsUpdate = true;
  return material;
};
