/**
 * LDraw color palette and CSS filters used by catalog thumbnails.
 * The renderer uses the same hexadecimal table when recoloring real meshes.
 */

export const colorHex: Record<number, string> = {
  0: "#05131d",
  1: "#0055bf",
  2: "#257a3e",
  3: "#00838f",
  4: "#c91a09",
  5: "#c870a0",
  6: "#583927",
  7: "#9ba19d",
  8: "#6d6e5c",
  9: "#b4d2e3",
  10: "#4b9f4a",
  11: "#55a5af",
  12: "#f2705e",
  13: "#fc97ac",
  14: "#f2cd37",
  15: "#ffffff",
  17: "#c2dab8",
  18: "#fbe696",
  19: "#e4cd9e",
  20: "#c9cae2",
  22: "#81007b",
  23: "#2032b0",
  25: "#fe8a18",
  26: "#923978",
  27: "#bbe90b",
  28: "#958a73",
  29: "#e4adc8",
  68: "#f3cf9b",
  70: "#582a12",
  71: "#a0a5a9",
  72: "#6c6e68",
  73: "#5a93db",
  74: "#73dca1",
  77: "#fecccf",
  78: "#f6d7b3",
  84: "#cc702a",
  85: "#3f3691",
  86: "#7c503a",
  89: "#4c61db",
  92: "#d09168",
  110: "#4354a3",
  118: "#b3d7d1",
  191: "#f8bb3d",
  212: "#86c1e1",
  216: "#b31004",
  226: "#fff03a",
  272: "#0a3463",
  288: "#184632",
  308: "#352100",
  320: "#720e0f",
  321: "#1498d7",
  322: "#3ec2dd",
  323: "#bddcd8",
  326: "#d9e4a7",
  330: "#9b9a5a",
  353: "#ff6d77",
  379: "#6074a1",
};

export const ldrawColorNames: Record<number, { es: string; en: string }> = {
  0: { es: "Negro", en: "Black" },
  1: { es: "Azul", en: "Blue" },
  2: { es: "Verde", en: "Green" },
  3: { es: "Turquesa oscuro", en: "Dark turquoise" },
  4: { es: "Rojo", en: "Red" },
  5: { es: "Rosa oscuro", en: "Dark pink" },
  6: { es: "Marrón", en: "Brown" },
  7: { es: "Gris claro", en: "Light gray" },
  8: { es: "Gris oscuro", en: "Dark gray" },
  9: { es: "Azul claro", en: "Light blue" },
  10: { es: "Verde brillante", en: "Bright green" },
  11: { es: "Turquesa claro", en: "Light turquoise" },
  12: { es: "Salmón", en: "Salmon" },
  13: { es: "Rosa", en: "Pink" },
  14: { es: "Amarillo", en: "Yellow" },
  15: { es: "Blanco", en: "White" },
  17: { es: "Verde claro", en: "Light green" },
  18: { es: "Amarillo claro", en: "Light yellow" },
  19: { es: "Arena", en: "Tan" },
  20: { es: "Violeta claro", en: "Light violet" },
  22: { es: "Púrpura", en: "Purple" },
  23: { es: "Azul violeta", en: "Blue violet" },
  25: { es: "Naranja", en: "Orange" },
  26: { es: "Magenta", en: "Magenta" },
  27: { es: "Lima", en: "Lime" },
  28: { es: "Arena oscuro", en: "Dark tan" },
  29: { es: "Rosa brillante", en: "Bright pink" },
  68: { es: "Naranja muy claro", en: "Very light orange" },
  70: { es: "Marrón rojizo", en: "Reddish brown" },
  71: { es: "Gris azulado claro", en: "Light bluish gray" },
  72: { es: "Gris azulado oscuro", en: "Dark bluish gray" },
  73: { es: "Azul medio", en: "Medium blue" },
  74: { es: "Verde medio", en: "Medium green" },
  77: { es: "Rosa claro", en: "Light pink" },
  78: { es: "Carne claro", en: "Light flesh" },
  84: { es: "Carne medio oscuro", en: "Medium dark flesh" },
  85: { es: "Púrpura oscuro", en: "Dark purple" },
  86: { es: "Carne oscuro", en: "Dark flesh" },
  89: { es: "Azul violeta", en: "Blue violet" },
  92: { es: "Carne", en: "Flesh" },
  110: { es: "Violeta", en: "Violet" },
  118: { es: "Aguamarina", en: "Aqua" },
  191: { es: "Naranja claro brillante", en: "Bright light orange" },
  212: { es: "Azul claro brillante", en: "Bright light blue" },
  216: { es: "Óxido", en: "Rust" },
  226: { es: "Amarillo claro brillante", en: "Bright light yellow" },
  272: { es: "Azul oscuro", en: "Dark blue" },
  288: { es: "Verde oscuro", en: "Dark green" },
  308: { es: "Marrón oscuro", en: "Dark brown" },
  320: { es: "Rojo oscuro", en: "Dark red" },
  321: { es: "Azul celeste oscuro", en: "Dark azure" },
  322: { es: "Azul celeste medio", en: "Medium azure" },
  323: { es: "Aguamarina claro", en: "Light aqua" },
  326: { es: "Verde amarillento", en: "Yellowish green" },
  330: { es: "Verde oliva", en: "Olive green" },
  353: { es: "Coral", en: "Coral" },
  379: { es: "Azul arena", en: "Sand blue" },
};

export const ldrawColorOptions = Object.keys(colorHex)
  .map(Number)
  .sort((a, b) => a - b);

export const previewFilter = (color: number) =>
  color === 0
    ? "brightness(.24) contrast(1.25)"
    : color === 1
      ? "sepia(1) saturate(7) hue-rotate(170deg) brightness(.72)"
      : color === 4
        ? "sepia(1) saturate(8) hue-rotate(315deg) brightness(.72)"
        : color === 14
          ? "sepia(1) saturate(7) hue-rotate(2deg) brightness(1.08)"
          : color === 19
            ? "sepia(.8) saturate(2) hue-rotate(350deg) brightness(1.05)"
            : color === 72
              ? "grayscale(1) brightness(.68)"
              : "grayscale(1)";

export const palettePreviewFilter = (color = 71) => {
  const shadow = " drop-shadow(0 2px 1px #05060766)";
  if (color === 0) return "grayscale(1) brightness(.35) contrast(1.35)" + shadow;
  if (color === 1)
    return (
      "sepia(1) saturate(6) hue-rotate(171deg) brightness(.62) contrast(1.2)" + shadow
    );
  if (color === 4)
    return (
      "sepia(1) saturate(7) hue-rotate(313deg) brightness(.67) contrast(1.2)" + shadow
    );
  if (color === 14)
    return (
      "sepia(1) saturate(6) hue-rotate(2deg) brightness(1.02) contrast(1.12)" + shadow
    );
  if (color === 15) return "grayscale(1) brightness(1.12) contrast(1.06)" + shadow;
  if (color === 19)
    return (
      "sepia(.9) saturate(1.9) hue-rotate(350deg) brightness(.96) contrast(1.12)" + shadow
    );
  if (color === 70)
    return (
      "sepia(1) saturate(3.2) hue-rotate(334deg) brightness(.45) contrast(1.3)" + shadow
    );
  if (color === 72) return "grayscale(1) brightness(.56) contrast(1.28)" + shadow;
  return "grayscale(1) brightness(.78) contrast(1.2)" + shadow;
};
