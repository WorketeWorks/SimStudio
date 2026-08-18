import * as THREE from "three";

export type MeshConnector = {
  local: THREE.Vector3;
  axis: THREE.Vector3;
  kind: "round" | "axle" | "half";
  role: "socket" | "shaft";
  diameter: number;
  length?: number;
  /** Axle stud that snaps at one point and permits rotation but no travel. */
  rotationOnly?: boolean;
};
type Loop = {
  axisIndex: number;
  plane: number;
  u: number;
  v: number;
  du: number;
  dv: number;
  points: number;
  radialRatio: number;
};
const coord = (v: THREE.Vector3, i: number) =>
  i === 0 ? v.x : i === 1 ? v.y : v.z;
const vector = (axis: number, a: number, b: number, c: number) =>
  axis === 0
    ? new THREE.Vector3(a, b, c)
    : axis === 1
      ? new THREE.Vector3(b, a, c)
      : new THREE.Vector3(b, c, a);

export function objectLocalBounds(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert(),
    box = new THREE.Box3();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.computeBoundingBox();
    if (o.geometry.boundingBox)
      box.union(
        o.geometry.boundingBox
          .clone()
          .applyMatrix4(inverse.clone().multiply(o.matrixWorld)),
      );
  });
  return box;
}

export type LocalTrimesh = { vertices: Float32Array; indices: Uint32Array };

export function objectLocalTrimesh(root: THREE.Object3D): LocalTrimesh {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert(),
    vertices: number[] = [],
    indices: number[] = [];
  const point = new THREE.Vector3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute("position");
    if (!position) return;
    const matrix = inverse.clone().multiply(object.matrixWorld),
      base = vertices.length / 3;
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(matrix);
      vertices.push(point.x, point.y, point.z);
    }
    const index = object.geometry.index;
    if (index)
      for (let i = 0; i < index.count; i++) indices.push(base + index.getX(i));
    else for (let i = 0; i < position.count; i++) indices.push(base + i);
  });
  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
  };
}

export function detectConnectorHoles(root: THREE.Object3D): MeshConnector[] {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert(),
    loops: Loop[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const planes = new Map<number, { a: THREE.Vector3; b: THREE.Vector3 }[]>();
    root.traverse((object) => {
      if (!(object instanceof THREE.LineSegments)) return;
      const position = object.geometry.getAttribute("position");
      if (!position) return;
      const matrix = inverse.clone().multiply(object.matrixWorld);
      for (let i = 0; i + 1 < position.count; i += 2) {
        const a = new THREE.Vector3()
            .fromBufferAttribute(position, i)
            .applyMatrix4(matrix),
          b = new THREE.Vector3()
            .fromBufferAttribute(position, i + 1)
            .applyMatrix4(matrix);
        if (Math.abs(coord(a, axis) - coord(b, axis)) > 0.012) continue;
        const key = Math.round((coord(a, axis) + coord(b, axis)) / 2 / 0.02);
        const list = planes.get(key) ?? [];
        list.push({ a, b });
        planes.set(key, list);
      }
    });
    for (const [key, edges] of planes) {
      const parent = new Map<string, string>(),
        pointMap = new Map<string, THREE.Vector3>();
      const id = (p: THREE.Vector3) =>
        `${Math.round(p.x / 0.012)},${Math.round(p.y / 0.012)},${Math.round(p.z / 0.012)}`;
      const find = (x: string): string => {
        const p = parent.get(x) ?? x;
        if (p === x) {
          parent.set(x, x);
          return x;
        }
        const r = find(p);
        parent.set(x, r);
        return r;
      };
      const union = (a: string, b: string) => {
        const ra = find(a),
          rb = find(b);
        if (ra !== rb) parent.set(rb, ra);
      };
      for (const edge of edges) {
        const a = id(edge.a),
          b = id(edge.b);
        pointMap.set(a, edge.a);
        pointMap.set(b, edge.b);
        union(a, b);
      }
      const groups = new Map<string, THREE.Vector3[]>();
      for (const [idKey, p] of pointMap) {
        const rootKey = find(idKey),
          group = groups.get(rootKey) ?? [];
        group.push(p);
        groups.set(rootKey, group);
      }
      const other = [0, 1, 2].filter((i) => i !== axis);
      for (const points of groups.values()) {
        if (points.length < 6) continue;
        const us = points.map((p) => coord(p, other[0])),
          vs = points.map((p) => coord(p, other[1])),
          umin = Math.min(...us),
          umax = Math.max(...us),
          vmin = Math.min(...vs),
          vmax = Math.max(...vs),
          du = umax - umin,
          dv = vmax - vmin,
          centerU = (umin + umax) / 2,
          centerV = (vmin + vmax) / 2,
          radii = points.map((point) =>
            Math.hypot(
              coord(point, other[0]) - centerU,
              coord(point, other[1]) - centerV,
            ),
          ),
          maximumRadius = Math.max(...radii),
          radialRatio = maximumRadius > 0
            ? Math.min(...radii) / maximumRadius
            : 1;
        if (
          du < 0.32 ||
          dv < 0.32 ||
          du > 0.86 ||
          dv > 0.86 ||
          Math.min(du, dv) / Math.max(du, dv) < 0.68
        )
          continue;
        loops.push({
          axisIndex: axis,
          plane: key * 0.02,
          u: (umin + umax) / 2,
          v: (vmin + vmax) / 2,
          du,
          dv,
          points: points.length,
          radialRatio,
        });
      }
    }
  }
  const result: MeshConnector[] = [];
  for (let i = 0; i < loops.length; i++)
    for (let j = i + 1; j < loops.length; j++) {
      const a = loops[i],
        b = loops[j];
      if (a.axisIndex !== b.axisIndex) continue;
      const depth = Math.abs(a.plane - b.plane);
      if (
        depth < 0.15 ||
        depth > 1.25 ||
        Math.hypot(a.u - b.u, a.v - b.v) > 0.09 ||
        Math.abs(a.du - b.du) > 0.14 ||
        Math.abs(a.dv - b.dv) > 0.14
      )
        continue;
      const axis = new THREE.Vector3();
      axis.setComponent(a.axisIndex, 1);
      const center = vector(
          a.axisIndex,
          (a.plane + b.plane) / 2,
          (a.u + b.u) / 2,
          (a.v + b.v) / 2,
        ),
        diameter = (a.du + a.dv + b.du + b.dv) / 4,
        kind: MeshConnector["kind"] =
          diameter < 0.75 || Math.min(a.radialRatio, b.radialRatio) < 0.78
            ? "axle"
            : "round";
      const start = center.clone(),
        end = center.clone(),
        margin = 0.08;
      start.setComponent(
        a.axisIndex,
        Math.min(a.plane, b.plane) - margin,
      );
      end.setComponent(
        a.axisIndex,
        Math.max(a.plane, b.plane) + margin,
      );
      const worldStart = root.localToWorld(start),
        worldEnd = root.localToWorld(end),
        worldDirection = worldEnd.clone().sub(worldStart),
        rayLength = worldDirection.length(),
        raycaster = new THREE.Raycaster(
          worldStart,
          worldDirection.normalize(),
          margin * 0.25,
          rayLength - margin * 0.25,
        ),
        centerLineBlocked = raycaster
          .intersectObject(root, true)
          .some((hit) => hit.object instanceof THREE.Mesh);
      if (centerLineBlocked) continue;
      if (
        !result.some(
          (c) =>
            c.local.distanceTo(center) < 0.12 &&
            Math.abs(c.axis.dot(axis)) > 0.9,
        )
      )
        result.push({ local: center, axis, kind, role: "socket", diameter });
    }
  // Cross holes placed at the end of a beam often share edges with the outer
  // silhouette, so the line-loop pass above cannot close their contour. Probe
  // LEGO-grid positions through the thinnest side of the part: the centre must
  // be empty, material must surround it, and diagonal/cardinal samples tell a
  // round opening from a cross opening.
  const bounds = objectLocalBounds(root),
    size = bounds.getSize(new THREE.Vector3()),
    dimensions = [size.x, size.y, size.z],
    raycaster = new THREE.Raycaster(),
    probe = (
      center: THREE.Vector3,
      axisIndex: number,
      uAxis: number,
      vAxis: number,
      offsetU = 0,
      offsetV = 0,
    ) => {
      const start = center.clone(),
        end = center.clone(),
        margin = 0.06;
      start.setComponent(uAxis, coord(start, uAxis) + offsetU);
      start.setComponent(vAxis, coord(start, vAxis) + offsetV);
      end.copy(start);
      start.setComponent(axisIndex, coord(bounds.min, axisIndex) - margin);
      end.setComponent(axisIndex, coord(bounds.max, axisIndex) + margin);
      const worldStart = root.localToWorld(start),
        worldEnd = root.localToWorld(end),
        direction = worldEnd.clone().sub(worldStart),
        length = direction.length();
      raycaster.set(worldStart, direction.normalize());
      raycaster.near = margin * 0.2;
      raycaster.far = length - margin * 0.2;
      return raycaster
        .intersectObject(root, true)
        .some((hit) => hit.object instanceof THREE.Mesh);
    };
  for (let axisIndex = 0; axisIndex < 3; axisIndex++) {
    if (dimensions[axisIndex] > 1.25) continue;
    const [uAxis, vAxis] = [0, 1, 2].filter((index) => index !== axisIndex),
      minimumU = Math.ceil(coord(bounds.min, uAxis) - 0.001),
      maximumU = Math.floor(coord(bounds.max, uAxis) + 0.001),
      minimumV = Math.ceil(coord(bounds.min, vAxis) - 0.001),
      maximumV = Math.floor(coord(bounds.max, vAxis) + 0.001),
      axis = new THREE.Vector3().setComponent(axisIndex, 1);
    for (let u = minimumU; u <= maximumU; u++)
      for (let v = minimumV; v <= maximumV; v++) {
        const center = vector(
          axisIndex,
          (coord(bounds.min, axisIndex) + coord(bounds.max, axisIndex)) / 2,
          u,
          v,
        ),
          existing = result.find(
            (connector) =>
              connector.local.distanceTo(center) < 0.18 &&
              Math.abs(connector.axis.dot(axis)) > 0.9,
          );
        if (probe(center, axisIndex, uAxis, vAxis)) continue;
        let surroundingMaterial = 0,
          innerOpening = 0;
        for (let sample = 0; sample < 8; sample++) {
          const angle = (sample * Math.PI) / 4,
            cosine = Math.cos(angle),
            sine = Math.sin(angle);
          if (
            probe(
              center,
              axisIndex,
              uAxis,
              vAxis,
              cosine * 0.47,
              sine * 0.47,
            )
          )
            surroundingMaterial++;
          if (
            !probe(
              center,
              axisIndex,
              uAxis,
              vAxis,
              cosine * 0.22,
              sine * 0.22,
            )
          )
            innerOpening++;
        }
        const kind: MeshConnector["kind"] =
          innerOpening >= 7 ? "round" : "axle";
        if (
          (kind === "round" && surroundingMaterial < 3) ||
          (kind === "axle" &&
            (surroundingMaterial < 1 ||
              innerOpening < 3 ||
              innerOpening > 5))
        )
          continue;
        if (existing) {
          existing.local.copy(center);
          existing.kind = kind;
          existing.diameter = kind === "round" ? 0.8 : 0.6;
          existing.length = dimensions[axisIndex];
        } else
          result.push({
            local: center,
            axis: axis.clone(),
            kind,
            role: "socket",
            diameter: kind === "round" ? 0.8 : 0.6,
            length: dimensions[axisIndex],
          });
      }
  }
  return result;
}

export function fallbackBeamConnectors(
  root: THREE.Object3D,
  name: string,
): MeshConnector[] {
  const match = name.match(/^Technic Beam\s+(\d+)/i);
  if (!match) return [];
  const count = Math.max(1, Math.min(15, +match[1])),
    center = objectLocalBounds(root).getCenter(new THREE.Vector3());
  return Array.from({ length: count }, (_, i) => ({
    local: new THREE.Vector3(
      center.x,
      center.y,
      center.z + i - (count - 1) / 2,
    ),
    axis: new THREE.Vector3(1, 0, 0),
    kind: "round" as const,
    role: "socket" as const,
    diameter: 0.6,
  }));
}

export function rodConnectors(
  root: THREE.Object3D,
  kind: "round" | "axle",
): MeshConnector[] {
  const bounds = objectLocalBounds(root),
    size = bounds.getSize(new THREE.Vector3()),
    center = bounds.getCenter(new THREE.Vector3()),
    dimensions = [size.x, size.y, size.z],
    axisIndex = dimensions.indexOf(Math.max(...dimensions)),
    axis = new THREE.Vector3();
  axis.setComponent(axisIndex, 1);
  const length = dimensions[axisIndex] * 0.94,
    diameter = Math.max(
      ...dimensions.filter((_, index) => index !== axisIndex),
    );
  if (kind === "axle")
    return [{ local: center, axis, kind, role: "shaft", diameter, length }];
  const studs = Math.max(2, Math.round(length)),
    offset = (studs - 1) / 2;
  return [-1, 1].map((direction) => ({
    local: center.clone().addScaledVector(axis, direction * offset),
    axis: axis.clone(),
    kind,
    role: "shaft" as const,
    diameter,
    length: length / 2,
  }));
}

export function hybridAxlePinConnectors(root: THREE.Object3D): MeshConnector[] {
  const ends = rodConnectors(root, "round");
  return [
    ends[0],
    {
      ...ends[1],
      kind: "axle",
      length: ends[1].length,
      local: ends[1].local.clone(),
      axis: ends[1].axis.clone(),
    },
  ];
}

export type CollisionPrimitive = {
  shape: "box" | "cylinder";
  center: THREE.Vector3;
  size?: THREE.Vector3;
  radius?: number;
  halfHeight?: number;
  rotation: THREE.Quaternion;
};

/**
 * Returns the nominal stud length for a plain, straight Technic axle.
 * Axles with stops, bushes, pin holes or other extra geometry deliberately do
 * not use this template because they need their own compound collider.
 */
export function straightAxleStudLength(name: string) {
  const match = name.match(/^Technic Axle\s+(\d+)(?:\s+Notched)?$/i);
  if (!match) return undefined;
  const length = Number(match[1]);
  return Number.isFinite(length) && length > 0 ? length : undefined;
}

/** Reviewed cross-axle map template exported from Sim Studio. */
export function straightAxleConnectors(
  name: string,
): MeshConnector[] | undefined {
  const length = straightAxleStudLength(name);
  if (!length) return undefined;
  return [
    {
      local: new THREE.Vector3(0, 0, 0),
      axis: new THREE.Vector3(1, 0, 0),
      kind: "axle",
      role: "shaft",
      diameter: 0.6,
      length,
    },
  ];
}

/**
 * Cross-shaped compound collider. The supplied unit map is multiplied by the
 * axle length: axle 2 => X=2, axle 4 => X=4, axle 12 => X=12.
 */
export function straightAxleCollisionPrimitives(
  name: string,
): CollisionPrimitive[] | undefined {
  const length = straightAxleStudLength(name);
  if (!length) return undefined;
  return [
    {
      shape: "box",
      center: new THREE.Vector3(0, 0, 0),
      size: new THREE.Vector3(length, 0.2, 0.6),
      rotation: new THREE.Quaternion(0, 0, 0, 1),
    },
    {
      shape: "box",
      center: new THREE.Vector3(0, 0, 0),
      size: new THREE.Vector3(length, 0.6, 0.2),
      rotation: new THREE.Quaternion(0, 0, 0, 1),
    },
  ];
}

const canonicalDirection = (direction: THREE.Vector3) => {
  const result = direction.clone().normalize();
  const values = [result.x, result.y, result.z],
    first = values.find((value) => Math.abs(value) > 0.001) ?? 1;
  if (first < 0) result.negate();
  return result;
};

export function approximateCollisionPrimitives(
  root: THREE.Object3D,
  name: string,
  connectors: MeshConnector[],
): CollisionPrimitive[] {
  const bounds = objectLocalBounds(root),
    size = bounds.getSize(new THREE.Vector3()),
    center = bounds.getCenter(new THREE.Vector3()),
    dimensions = [size.x, size.y, size.z],
    axisIndex = dimensions.indexOf(Math.max(...dimensions)),
    longAxis = new THREE.Vector3(),
    beamOrPanel = /^Technic (Beam|Panel)/i.test(name),
    beamThickness = /(?:\bx\s*0\.5\b|\b0\.5\b|\bhalf\b)/i.test(name)
      ? 0.5
      : 1;
  longAxis.setComponent(axisIndex, 1);
  if (/^Technic (Axle|Pin)/i.test(name)) {
    const others = dimensions.filter((_, index) => index !== axisIndex),
      axleConnectorShell = /^Technic Axle(?: and Pin)? (?:Joiner|Connector)/i.test(
        name,
      ),
      actualRadius = Math.min(...others) / 2,
      radius = axleConnectorShell
        ? 0.475
        : Math.max(0.12, actualRadius * 0.82),
      length = dimensions[axisIndex] * (axleConnectorShell ? 0.95 : 0.94),
      rotation = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        longAxis,
      );
    return [
      {
        shape: "cylinder",
        center: center.clone(),
        radius,
        halfHeight: length / 2,
        rotation,
      },
    ];
  }
  if (/wheel|tyre|tire|gear|bush/i.test(name)) {
    const wheelAxisIndex = dimensions.indexOf(Math.min(...dimensions)),
      wheelAxis = new THREE.Vector3();
    wheelAxis.setComponent(wheelAxisIndex, 1);
    const others = dimensions.filter((_, index) => index !== wheelAxisIndex),
      envelopeScale = 0.95;
    return [
      {
        shape: "cylinder",
        center,
        radius: Math.max(...others) * envelopeScale * 0.5,
        halfHeight: dimensions[wheelAxisIndex] * envelopeScale * 0.5,
        rotation: new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          wheelAxis,
        ),
      },
    ];
  }
  const sockets = connectors.filter((connector) => connector.role === "socket"),
    points = sockets.map((connector) => connector.local);
  if (/^Technic (Beam|Panel|Pin Connector)/i.test(name) && points.length >= 2) {
    type Candidate = {
      indices: number[];
      direction: THREE.Vector3;
      origin: THREE.Vector3;
      span: number;
    };
    const candidates: Candidate[] = [];
    for (let i = 0; i < points.length; i++)
      for (let j = i + 1; j < points.length; j++) {
        const delta = points[j].clone().sub(points[i]),
          distance = delta.length();
        if (distance < 0.45) continue;
        const direction = canonicalDirection(delta),
          indices = points
            .map((point, index) => ({
              index,
              distance: point.clone().sub(points[i]).cross(direction).length(),
            }))
            .filter((item) => item.distance < 0.16)
            .map((item) => item.index);
        if (indices.length < 2) continue;
        const key = indices
          .slice()
          .sort((a, b) => a - b)
          .join(",");
        if (
          candidates.some(
            (candidate) =>
              candidate.indices
                .slice()
                .sort((a, b) => a - b)
                .join(",") === key,
          )
        )
          continue;
        const projections = indices.map((index) =>
            points[index].dot(direction),
          ),
          minimum = Math.min(...projections),
          maximum = Math.max(...projections),
          origin = direction.clone().multiplyScalar((minimum + maximum) / 2);
        const perpendicular = points[indices[0]]
          .clone()
          .addScaledVector(direction, -points[indices[0]].dot(direction));
        origin.add(perpendicular);
        candidates.push({
          indices,
          direction,
          origin,
          span: maximum - minimum,
        });
      }
    candidates.sort(
      (a, b) => b.indices.length - a.indices.length || a.span - b.span,
    );
    const chosen: Candidate[] = [],
      covered = new Set<number>();
    for (const candidate of candidates) {
      if (
        candidate.indices.some((index) => !covered.has(index)) ||
        chosen.length === 0
      ) {
        chosen.push(candidate);
        candidate.indices.forEach((index) => covered.add(index));
      }
      if (covered.size === points.length || chosen.length === 6) break;
    }
    if (chosen.length) {
      const result: CollisionPrimitive[] = [],
        keyIndices = new Set<number>();
      for (const line of chosen) {
        const projections = line.indices
            .map((index) => ({
              index,
              value: points[index].dot(line.direction),
            }))
            .sort((a, b) => a.value - b.value),
          first = projections[0],
          last = projections[projections.length - 1];
        keyIndices.add(first.index);
        keyIndices.add(last.index);
        const connector = sockets[first.index],
          xAxis = line.direction.clone().normalize(),
          yAxis = connector.axis
            .clone()
            .addScaledVector(xAxis, -connector.axis.dot(xAxis))
            .normalize(),
          zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize(),
          rotation = new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis),
          ),
          depth =
            Math.abs(connector.axis.x) * size.x +
            Math.abs(connector.axis.y) * size.y +
            Math.abs(connector.axis.z) * size.z,
          colliderDepth = beamOrPanel
            ? beamThickness
            : Math.min(0.9, Math.max(0.25, depth * 0.96)),
          colliderHeight = 0.9;
        result.push({
          shape: "box",
          center: line.origin.clone(),
          size: new THREE.Vector3(
            line.span,
            colliderDepth,
            colliderHeight,
          ),
          rotation,
        });
      }
      for (let index = 0; index < points.length; index++) {
        const memberships = chosen.filter((line) =>
          line.indices.includes(index),
        );
        if (memberships.length > 1) keyIndices.add(index);
      }
      for (const index of keyIndices) {
        const connector = sockets[index],
          rotation = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            connector.axis,
          ),
          depth =
            Math.abs(connector.axis.x) * size.x +
            Math.abs(connector.axis.y) * size.y +
            Math.abs(connector.axis.z) * size.z;
        result.push({
          shape: "cylinder",
          center: connector.local.clone(),
          radius: 0.45,
          halfHeight: beamOrPanel
            ? beamThickness / 2
            : Math.min(0.45, Math.max(0.12, depth * 0.48)),
          rotation,
        });
      }
      return result;
    }
  }
  if (points.length === 1) {
    const connector = sockets[0];
    if (beamOrPanel)
      return [
        {
          shape: "cylinder",
          center: connector.local.clone(),
          radius: 0.45,
          halfHeight: beamThickness / 2,
          rotation: new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            connector.axis,
          ),
        },
      ];
    const
      crossSection = Math.max(
        0.42,
        Math.min(0.72, [...dimensions].sort((a, b) => a - b)[1] * 0.72),
      );
    return [
      {
        shape: "box",
        center,
        size: size.clone().multiplyScalar(0.82),
        rotation: new THREE.Quaternion(),
      },
      {
        shape: "cylinder",
        center: connector.local.clone(),
        radius: crossSection * 0.58,
        halfHeight: crossSection * 0.48,
        rotation: new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          connector.axis,
        ),
      },
    ];
  }
  return [
    {
      shape: "box",
      center,
      size: size.clone().multiplyScalar(0.88),
      rotation: new THREE.Quaternion(),
    },
  ];
}

/** Secondary volume used only for gear-to-gear contacts. */
export function approximateGearCollisionPrimitives(
  colliders: CollisionPrimitive[],
): CollisionPrimitive[] {
  return colliders.map((primitive) => {
    if (primitive.shape === "cylinder")
      return {
        ...primitive,
        center: primitive.center.clone(),
        radius: Math.max(0.01, (primitive.radius ?? 0.5) * 0.88),
        halfHeight: Math.max(0.01, (primitive.halfHeight ?? 0.5) * 0.96),
        rotation: primitive.rotation.clone(),
      };
    const size = primitive.size?.clone() ?? new THREE.Vector3(1, 1, 1),
      values = size.toArray(),
      thicknessAxis = values.indexOf(Math.min(...values));
    for (let axis = 0; axis < 3; axis++)
      size.setComponent(
        axis,
        size.getComponent(axis) * (axis === thicknessAxis ? 0.96 : 0.88),
      );
    return {
      ...primitive,
      center: primitive.center.clone(),
      size,
      rotation: primitive.rotation.clone(),
    };
  });
}
