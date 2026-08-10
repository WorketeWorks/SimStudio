export type GearKind = "spur" | "bevel" | "double-bevel";

export type GearSpec = {
  teeth: number;
  kind: GearKind;
  pitchRadius: number;
};

export type GearPose<T> = {
  value: T;
  spec: GearSpec;
  center: [number, number, number];
  axis: [number, number, number];
};

export type GearPair<T> = {
  a: GearPose<T>;
  b: GearPose<T>;
  ratio: number;
  centerDistance: number;
  expectedDistance: number;
  distanceError: number;
};

const exactSpecs: Record<string, Omit<GearSpec, "pitchRadius">> = {
  "10928": { teeth: 8, kind: "spur" },
  "6589": { teeth: 12, kind: "bevel" },
  "32270": { teeth: 12, kind: "double-bevel" },
  "94925": { teeth: 16, kind: "spur" },
  "32269": { teeth: 20, kind: "double-bevel" },
  "3648": { teeth: 24, kind: "spur" },
  "3648b": { teeth: 24, kind: "spur" },
  "46372": { teeth: 28, kind: "double-bevel" },
  "32498": { teeth: 36, kind: "double-bevel" },
};

export function gearSpecFor(part: string, name = ""): GearSpec | undefined {
  const normalized = part.toLowerCase().replace(/\.dat$/, ""),
    exact = exactSpecs[normalized],
    teethMatch = name.match(/(?:gear\s+)?(\d+)\s*(?:tooth|teeth|t)\b/i),
    teeth = exact?.teeth ?? (teethMatch ? Number(teethMatch[1]) : 0);
  if (!teeth) return undefined;
  const kind =
    exact?.kind ??
    (/double\s+bevel/i.test(name)
      ? "double-bevel"
      : /bevel/i.test(name)
        ? "bevel"
        : "spur");
  return { teeth, kind, pitchRadius: teeth / 16 };
}

export const gearRatio = (driverTeeth: number, followerTeeth: number) =>
  -driverTeeth / followerTeeth;

export const gearCenterDistance = (teethA: number, teethB: number) =>
  (teethA + teethB) / 16;

const dot = (a: number[], b: number[]) =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  length = (value: number[]) => Math.hypot(value[0], value[1], value[2]),
  normalized = (value: number[]): [number, number, number] => {
    const size = length(value) || 1;
    return [value[0] / size, value[1] / size, value[2] / size];
  };

/** Finds external, parallel-axis Technic gear meshes. */
export function findParallelGearPairs<T>(
  gears: GearPose<T>[],
  options: {
    distanceTolerance?: number;
    inwardTolerance?: number;
    axialTolerance?: number;
  } = {},
): GearPair<T>[] {
  const distanceTolerance = options.distanceTolerance ?? 0.14,
    inwardTolerance = options.inwardTolerance ?? 0.34,
    axialTolerance = options.axialTolerance ?? 0.55,
    pairs: GearPair<T>[] = [];
  for (let aIndex = 0; aIndex < gears.length; aIndex++) {
    const a = gears[aIndex],
      axisA = normalized(a.axis);
    for (let bIndex = aIndex + 1; bIndex < gears.length; bIndex++) {
      const b = gears[bIndex],
        axisB = normalized(b.axis),
        alignment = Math.abs(dot(axisA, axisB));
      if (alignment < 0.985) continue;
      const delta = [
          b.center[0] - a.center[0],
          b.center[1] - a.center[1],
          b.center[2] - a.center[2],
        ],
        axialSeparation = Math.abs(dot(delta, axisA));
      if (axialSeparation > axialTolerance) continue;
      const radial = [
          delta[0] - axisA[0] * dot(delta, axisA),
          delta[1] - axisA[1] * dot(delta, axisA),
          delta[2] - axisA[2] * dot(delta, axisA),
        ],
        centerDistance = length(radial),
        expectedDistance = gearCenterDistance(a.spec.teeth, b.spec.teeth),
        signedDistanceError = centerDistance - expectedDistance,
        distanceError = Math.abs(signedDistanceError);
      // Tooth contact tolerates a little penetration, but disengages quickly
      // when the gears move apart. Keeping separate limits avoids flicker while
      // preventing links between gears that are merely nearby.
      if (
        signedDistanceError > distanceTolerance ||
        signedDistanceError < -inwardTolerance
      )
        continue;
      pairs.push({
        a,
        b,
        ratio: gearRatio(a.spec.teeth, b.spec.teeth),
        centerDistance,
        expectedDistance,
        distanceError,
      });
    }
  }
  return pairs;
}
