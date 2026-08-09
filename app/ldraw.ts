export type LDrawPlacement = {
  part: string;
  color: number;
  position: [number, number, number];
  matrix: [number, number, number, number, number, number, number, number, number];
};

export type ScenePlacement = {
  position: [number, number, number];
  matrix: LDrawPlacement["matrix"];
};

type ParsedReference = LDrawPlacement & { reference: string };

const identity: LDrawPlacement["matrix"] = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const normalizeReference = (value: string) =>
  value.trim().replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
const parseReference = (raw: string): ParsedReference | undefined => {
  const token = raw.trim().split(/\s+/);
  if (token[0] !== "1" || token.length < 15) return;
  const numbers = token.slice(1, 14).map(Number);
  if (numbers.some(Number.isNaN)) return;
  const reference = token.slice(14).join(" ").trim();
  if (!reference) return;
  return {
    color: numbers[0],
    position: [numbers[1], numbers[2], numbers[3]],
    matrix: numbers.slice(4, 13) as LDrawPlacement["matrix"],
    part: reference.replace(/\\/g, "/").split("/").pop()!.replace(/\.dat$/i, ""),
    reference,
  };
};
const multiplyMatrix = (
  left: LDrawPlacement["matrix"],
  right: LDrawPlacement["matrix"],
): LDrawPlacement["matrix"] => [
  left[0] * right[0] + left[1] * right[3] + left[2] * right[6],
  left[0] * right[1] + left[1] * right[4] + left[2] * right[7],
  left[0] * right[2] + left[1] * right[5] + left[2] * right[8],
  left[3] * right[0] + left[4] * right[3] + left[5] * right[6],
  left[3] * right[1] + left[4] * right[4] + left[5] * right[7],
  left[3] * right[2] + left[4] * right[5] + left[5] * right[8],
  left[6] * right[0] + left[7] * right[3] + left[8] * right[6],
  left[6] * right[1] + left[7] * right[4] + left[8] * right[7],
  left[6] * right[2] + left[7] * right[5] + left[8] * right[8],
];
const transformPosition = (
  parentPosition: LDrawPlacement["position"],
  parentMatrix: LDrawPlacement["matrix"],
  childPosition: LDrawPlacement["position"],
): LDrawPlacement["position"] => [
  parentPosition[0] +
    parentMatrix[0] * childPosition[0] +
    parentMatrix[1] * childPosition[1] +
    parentMatrix[2] * childPosition[2],
  parentPosition[1] +
    parentMatrix[3] * childPosition[0] +
    parentMatrix[4] * childPosition[1] +
    parentMatrix[5] * childPosition[2],
  parentPosition[2] +
    parentMatrix[6] * childPosition[0] +
    parentMatrix[7] * childPosition[1] +
    parentMatrix[8] * childPosition[2],
];

export function parseLDR(source: string): LDrawPlacement[] {
  const sections = new Map<string, ParsedReference[]>(),
    aliases = new Map<string, string>();
  let current = "__root__",
    firstSection = current,
    foundFile = false;
  sections.set(current, []);
  for (const raw of source.split(/\r?\n/)) {
    const file = raw.match(/^\s*0\s+FILE\s+(.+?)\s*$/i);
    if (file) {
      current = normalizeReference(file[1]);
      if (!foundFile) firstSection = current;
      foundFile = true;
      sections.set(current, []);
      aliases.set(current.replace(/\.(?:ldr|mpd)$/i, ""), current);
      continue;
    }
    if (/^\s*0\s+NOFILE\b/i.test(raw)) {
      current = "__outside__";
      continue;
    }
    const reference = parseReference(raw);
    if (reference && sections.has(current)) sections.get(current)!.push(reference);
  }
  if (!foundFile) firstSection = "__root__";
  const result: LDrawPlacement[] = [];
  const expand = (
    section: string,
    parentPosition: LDrawPlacement["position"],
    parentMatrix: LDrawPlacement["matrix"],
    inheritedColor: number,
    stack: Set<string>,
  ) => {
    if (stack.has(section) || stack.size > 32) return;
    const nextStack = new Set(stack).add(section);
    for (const row of sections.get(section) ?? []) {
      const position = transformPosition(parentPosition, parentMatrix, row.position),
        matrix = multiplyMatrix(parentMatrix, row.matrix),
        color = row.color === 16 ? inheritedColor : row.color,
        normalized = normalizeReference(row.reference),
        submodel = sections.has(normalized)
          ? normalized
          : aliases.get(normalized.replace(/\.(?:ldr|mpd)$/i, ""));
      if (submodel) expand(submodel, position, matrix, color, nextStack);
      else result.push({ part: row.part, color, position, matrix });
    }
  };
  expand(firstSection, [0, 0, 0], identity, 16, new Set());
  return result;
}

/**
 * LDraw uses Y down. Sim Studio uses Three.js' Y-up, right-handed space and
 * prepares each part with the equivalent of a 180 degree rotation around X.
 * Positions and parent rotations must therefore use the same basis change:
 * C = diag(1, -1, -1), Rscene = C * Rldraw * C.
 */
export function ldrawToScenePlacement(
  placement: LDrawPlacement,
  unitsPerStud = 20,
): ScenePlacement {
  const [x, y, z] = placement.position,
    [a, b, c, d, e, f, g, h, i] = placement.matrix,
    clean = (value: number) => (value === 0 ? 0 : value);
  return {
    position: [
      clean(x / unitsPerStud),
      clean(-y / unitsPerStud),
      clean(-z / unitsPerStud),
    ],
    matrix: [
      clean(a),
      clean(-b),
      clean(-c),
      clean(-d),
      clean(e),
      clean(f),
      clean(-g),
      clean(h),
      clean(i),
    ],
  };
}

export const makeLDR = (lines:string[]) => ["0 FILE sim-studio-model.ldr","0 Sim Studio Physics Build Lab","0 Name: sim-studio-model.ldr","0 !LDRAW_ORG Model",...lines,"0"].join("\r\n");
