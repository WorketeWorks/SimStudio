"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { LDrawLoader } from "./vendor/LDrawLoader.js";
import { LDrawConditionalLineMaterial } from "three/addons/materials/LDrawConditionalLineMaterial.js";
import { ldrawToScenePlacement, makeLDR, parseLDR, type LDrawPlacement } from "./ldraw";
import { flattenLDrawRenderables } from "./ldraw-geometry";
import { extractStudioLDraw } from "./studio-io";
import {
  approximateCollisionPrimitives,
  approximateGearCollisionPrimitives,
  detectConnectorHoles,
  fallbackBeamConnectors,
  hybridAxlePinConnectors,
  rodConnectors,
  straightAxleCollisionPrimitives,
  straightAxleConnectors,
  type CollisionPrimitive,
  type MeshConnector,
} from "./connectors";
import { paletteParts, paletteRequestAliases } from "./palette";
import { preloadedConnectionMaps } from "./connection-maps";
import { preloadedCollisionMaps, preloadedGearCollisionMaps } from "./collision-maps";
import {
  buildConnectorContactExclusions,
  contactPairKey,
} from "./physics-contact-filter";
import { gearSpecFor, type GearPose } from "./gears";
import preloadedCatalog from "./preloaded-catalog.json";
import {
  PROJECT_EXTENSION,
  PROJECT_MIME,
  decodeProjectFile,
  deleteBrowserProject,
  encodeProjectFile,
  listBrowserProjects,
  loadBrowserProject,
  loadRecoveryProject,
  safeProjectFileName,
  saveBrowserProject,
  saveRecoveryProject,
  type JsonObject,
  type ProjectSummary,
  type SavedCollisionPrimitive,
  type SavedConnector,
  type SimStudioProjectDocument,
} from "./project-format";
import { createStudioGrid, GRID_RECENTER_STEP, GRID_SIZE } from "./renderer/studio-grid";
import { exactTriangleMeshForPiece } from "./physics/exact-collider";
import {
  detectDifferentialLinks,
  detectGearLinks,
  differentialPairKeys,
  gearLinkKey,
  isDifferentialPart,
} from "./physics/gear-topology";
import {
  COLLISION_GROUP_GEAR_MESH,
  COLLISION_GROUP_GEAR_NORMAL,
  COLLISION_GROUP_NON_GEAR,
  CONTACT_FRICTION,
  DEFAULT_PHYSICS_SETTINGS,
  interactionGroups,
} from "./physics/settings";
import { createProjectId, uniqueProjectName } from "./projects/naming";
import { DeferredNumberInput } from "./components/DeferredNumberInput";
import {
  colorHex,
  ldrawColorNames,
  ldrawColorOptions,
  palettePreviewFilter,
  previewFilter,
} from "./catalog/colors";
import { translations, type Language } from "./i18n";
import type {
  AppState,
  AxleSnapStep,
  CatalogPart,
  Connection,
  ConnectionProfile,
  DebugFlags,
  EditorSnapshot,
  FramePerformanceSample,
  GridStep,
  ImportDraft,
  JointMode,
  PhysicsSettings,
  Piece,
  PieceKind,
  PreparedImportPlacement,
  RotationSnapStep,
  RuntimeDifferentialLink,
  RuntimeGearLink,
  StructuralMode,
} from "./editor/types";

// --- Catalog sources and packaged metadata ---------------------------------
// The older pybricks mirror does not contain newer official parts such as
// 71708. Keep it as a fallback, but use the actively updated mirror first.

const LDRAW = "https://cdn.jsdelivr.net/gh/remig/ldraw_parts@master/";

const LEGACY_LDRAW = "https://cdn.jsdelivr.net/gh/pybricks/ldraw@master/";

const MODEL_LOAD_TIMEOUT = 20_000;

const AUTO_CONNECTIONS_ENABLED = true;

const CORRECTION_MAP_REVISION = "2026-08-10-corrections-1";

const invalidPackagedGeometry = new Set<string>();

const packagedParts = preloadedCatalog.parts as Record<
  string,
  {
    connectors: {
      local: number[];
      axis: number[];
      kind: "round" | "axle" | "half";
      role: "socket" | "shaft";
      diameter: number;
      length?: number;
    }[];
    colliders: {
      shape: "box" | "cylinder";
      center: number[];
      size?: number[];
      radius?: number;
      halfHeight?: number;
      rotation: number[];
    }[];
    gearColliders?: {
      shape: "box" | "cylinder";
      center: number[];
      size?: number[];
      radius?: number;
      halfHeight?: number;
      rotation: number[];
    }[];
  }
>;
// Palette tabs are deliberately presentation-only; part data lives in
// palette.ts and imported catalog entries live in the runtime state.

const categories = [
  { id: "beams", icon: "━" },
  { id: "axles", icon: "╂" },
  { id: "pins", icon: "●" },
  { id: "connectors", icon: "⌘" },
  { id: "gears", icon: "⚙" },
  { id: "wheels", icon: "◉" },
  { id: "imported", icon: "↓" },
] as const;

// --- Catalog classification and physics defaults ---------------------------

const kindFor = (category: string, name = ""): PieceKind =>
  category === "motors" || /motor/i.test(name)
    ? "motor"
    : category === "gears" || category === "wheels" || /gear|wheel|tyre|tire/i.test(name)
      ? "wheel"
      : "beam";

const modelText = (p: CatalogPart) =>
  `0 FILE ${p.part}.ldr\n1 ${p.color} 0 0 0 1 0 0 0 1 0 0 0 1 ${p.modelPart ?? p.part}.dat\n0`;

const frictionPinRefs = new Set(["2780", "6558", "32054", "43093"]);

const frictionlessPinRefs = new Set(["3749", "3673", "32556"]);

const isPinPart = (p: CatalogPart) =>
  /^Technic (Axle )?Pin/i.test(p.name) || frictionPinRefs.has(p.part);

const isAxlePart = (p: CatalogPart) => /^Technic Axle(?! Pin)/i.test(p.name);

const paletteReferenceSet = new Set([
  ...paletteParts.flatMap((part) =>
    [part.part, part.modelPart].filter(Boolean).map((value) => value!.toLowerCase()),
  ),
  ...Object.keys(paletteRequestAliases),
]);

const resolvePaletteRequest = (reference: string) =>
  paletteRequestAliases[reference.toLowerCase()] ?? reference.toLowerCase();

const belongsToDefaultPalette = (part: CatalogPart) =>
  [part.part, part.modelPart, part.resolvedPart]
    .filter(Boolean)
    .some((value) => paletteReferenceSet.has(value!.toLowerCase()));

const isGearPart = (p: CatalogPart) =>
  p.gear === true || p.family === "gears" || /\bgear\b/i.test(p.name);

const isHalfBeamPart = (p: CatalogPart) =>
  /^Technic (Beam|Panel)/i.test(p.name) &&
  /(?:\bx\s*0\.5\b|\b0\.5\b|\bhalf\b)/i.test(p.name);

const hasPinFriction = (p: CatalogPart) =>
  isPinPart(p) &&
  !/without friction|frictionless/i.test(p.name) &&
  (/friction/i.test(p.name) || p.color === 0 || frictionPinRefs.has(p.part));

const connectorProfile = (
  shaft: MeshConnector,
  socket: MeshConnector,
): ConnectionProfile | undefined =>
  shaft.role !== "shaft" || socket.role !== "socket"
    ? undefined
    : shaft.kind !== "axle" && socket.kind !== "axle"
      ? "pin-round"
      : shaft.kind === "axle" && socket.kind === "axle"
        ? "axle-cross"
        : shaft.kind === "axle" && socket.kind !== "axle"
          ? "axle-round"
          : undefined;

const connectorAxialOffsets = (shaft: MeshConnector, socket: MeshConnector) =>
  shaft.kind !== "axle" &&
  socket.kind !== "axle" &&
  (shaft.kind === "half") !== (socket.kind === "half")
    ? [-0.25, 0.25]
    : [0];

const closestConnectorOffset = (
  shaft: MeshConnector,
  socket: MeshConnector,
  shaftPoint: THREE.Vector3,
  socketPoint: THREE.Vector3,
  axis: THREE.Vector3,
) => {
  const along = shaftPoint.clone().sub(socketPoint).dot(axis);
  return connectorAxialOffsets(shaft, socket).reduce((best, candidate) =>
    Math.abs(along - candidate) < Math.abs(along - best) ? candidate : best,
  );
};

type AxleSnapPoint = { local: THREE.Vector3; important: boolean };

const axleSnapPoints = (
  connector: MeshConnector,
  includeSecondary = true,
): AxleSnapPoint[] => {
  if (connector.role !== "shaft" || connector.kind !== "axle") return [];
  const sections = Math.max(1, Math.ceil(connector.length ?? 0.5)),
    half = sections / 2,
    axis = connector.axis.clone().normalize(),
    points: AxleSnapPoint[] = [];
  for (let section = 0; section < sections; section++)
    points.push({
      local: connector.local.clone().addScaledVector(axis, -half + section + 0.5),
      important: true,
    });
  if (includeSecondary)
    for (let gap = 1; gap < sections; gap++)
      points.push({
        local: connector.local.clone().addScaledVector(axis, -half + gap),
        important: false,
      });
  return points;
};

const connectorMapReach = (connectors: MeshConnector[]) =>
  Math.max(
    1,
    ...connectors.map(
      (connector) => connector.local.length() + (connector.length ?? 0.5) / 2,
    ),
  );

const jointPivotKey = (connection: Connection) => `joint:${connection.id}`;

const connectionPivotLocal = (piece: Piece, connection: Connection) => {
  connection.a.mesh.updateMatrixWorld(true);
  piece.mesh.updateMatrixWorld(true);
  return piece.mesh.worldToLocal(
    connection.a.mesh.localToWorld(connection.socket.local.clone()),
  );
};

const ensurePieceRotationPivot = (piece: Piece, connections: Connection[]) => {
  if (piece.rotationPivotKey === "center") {
    piece.rotationPivotLocal = undefined;
    return;
  }
  const pieceConnections = connections.filter(
      (connection) => connection.a === piece || connection.b === piece,
    ),
    selectedConnection =
      pieceConnections.find(
        (connection) => jointPivotKey(connection) === piece.rotationPivotKey,
      ) ?? pieceConnections[0];
  if (!selectedConnection) {
    piece.rotationPivotKey = undefined;
    piece.rotationPivotLocal = undefined;
    return;
  }
  piece.rotationPivotKey = jointPivotKey(selectedConnection);
  piece.rotationPivotLocal = connectionPivotLocal(piece, selectedConnection);
};

const absoluteRotationAroundLocalAxis = (piece: Piece, localAxis: THREE.Vector3) => {
  piece.mesh.updateMatrixWorld(true);
  const normalizedLocalAxis = localAxis.clone().normalize(),
    worldAxis = normalizedLocalAxis
      .clone()
      .transformDirection(piece.mesh.matrixWorld)
      .normalize(),
    bases = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
    ],
    localBase = bases
      .map((base) => ({ base, alignment: Math.abs(base.dot(normalizedLocalAxis)) }))
      .sort((left, right) => left.alignment - right.alignment)[0].base,
    localReference = localBase
      .clone()
      .addScaledVector(normalizedLocalAxis, -localBase.dot(normalizedLocalAxis))
      .normalize(),
    pieceReference = localReference
      .clone()
      .transformDirection(piece.mesh.matrixWorld)
      .normalize(),
    globalBase = bases
      .map((base) => ({ base, alignment: Math.abs(base.dot(worldAxis)) }))
      .sort((left, right) => left.alignment - right.alignment)[0].base,
    globalReference = globalBase
      .clone()
      .addScaledVector(worldAxis, -globalBase.dot(worldAxis))
      .normalize();
  return Math.atan2(
    worldAxis.dot(globalReference.clone().cross(pieceReference)),
    globalReference.dot(pieceReference),
  );
};

const rotatePieceAroundLocalAxis = (
  piece: Piece,
  localAxis: THREE.Vector3,
  radians: number,
) => {
  const pivotLocal = piece.rotationPivotLocal,
    pivotBefore = pivotLocal ? piece.mesh.localToWorld(pivotLocal.clone()) : undefined;
  piece.mesh.quaternion
    .multiply(
      new THREE.Quaternion().setFromAxisAngle(localAxis.clone().normalize(), radians),
    )
    .normalize();
  piece.mesh.updateMatrixWorld(true);
  if (pivotLocal && pivotBefore) {
    const pivotAfter = piece.mesh.localToWorld(pivotLocal.clone());
    piece.mesh.position.add(pivotBefore.sub(pivotAfter));
    piece.mesh.updateMatrixWorld(true);
  }
};

const rotatePieceAroundPivotWithGlobalSnap = (
  piece: Piece,
  axis: "x" | "y" | "z",
  radians: number,
  snapDegrees: RotationSnapStep,
) => {
  const localAxis =
      axis === "x"
        ? new THREE.Vector3(1, 0, 0)
        : axis === "y"
          ? new THREE.Vector3(0, 1, 0)
          : new THREE.Vector3(0, 0, 1),
    step = THREE.MathUtils.degToRad(snapDegrees),
    current = absoluteRotationAroundLocalAxis(piece, localAxis),
    appliedRadians = step
      ? Math.round((current + radians) / step) * step - current
      : radians;
  rotatePieceAroundLocalAxis(piece, localAxis, appliedRadians);
};

const forcedConnectionAxesAligned = (connection: Connection) => {
  connection.a.mesh.updateMatrixWorld(true);
  connection.b.mesh.updateMatrixWorld(true);
  const socketAxis = connection.socket.axis
      .clone()
      .transformDirection(connection.a.mesh.matrixWorld)
      .normalize(),
    shaftAxis = connection.shaft.axis
      .clone()
      .transformDirection(connection.b.mesh.matrixWorld)
      .normalize();
  return Math.abs(socketAxis.dot(shaftAxis)) >= 0.985;
};

const removeMisalignedForcedConnections = (state: AppState, movedPiece: Piece) => {
  const removed = state.connections.filter(
    (connection) =>
      connection.forced &&
      (connection.a === movedPiece || connection.b === movedPiece) &&
      !forcedConnectionAxesAligned(connection),
  );
  if (!removed.length) return 0;
  const affected = new Set<Piece>([movedPiece]);
  removed.forEach((connection) => {
    affected.add(connection.a);
    affected.add(connection.b);
  });
  const removedIds = new Set(removed.map((connection) => connection.id));
  state.connections = state.connections.filter(
    (connection) => !removedIds.has(connection.id),
  );
  affected.forEach((piece) => ensurePieceRotationPivot(piece, state.connections));
  rebalanceAllSmartDefaults(state);
  return removed.length;
};

const detectShaftTraversals = (pieces: Piece[]) => {
  type SocketEntry = {
    host: Piece;
    connector: MeshConnector;
    point: THREE.Vector3;
    axis: THREE.Vector3;
  };

  const cellSize = 0.45,
    cellKey = (point: THREE.Vector3) =>
      `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}:${Math.floor(point.z / cellSize)}`,
    socketGrid = new Map<string, SocketEntry[]>(),
    worldPose = (piece: Piece, connector: MeshConnector) => ({
      point: connector.local.clone().applyMatrix4(piece.mesh.matrixWorld),
      axis: connector.axis.clone().transformDirection(piece.mesh.matrixWorld).normalize(),
    });
  pieces.forEach((piece) => {
    piece.mesh.updateMatrixWorld(true);
    piece.connectors.forEach((connector) => {
      if (connector.role !== "socket") return;
      const pose = worldPose(piece, connector),
        entry = { host: piece, connector, ...pose },
        key = cellKey(pose.point),
        entries = socketGrid.get(key) ?? [];
      entries.push(entry);
      socketGrid.set(key, entries);
    });
  });
  const traversals: { shaft: Piece; host: Piece }[] = [],
    traversedPairs = new Set<string>();
  pieces.forEach((shaftPiece) => {
    shaftPiece.mesh.updateMatrixWorld(true);
    shaftPiece.connectors.forEach((shaft) => {
      if (shaft.role !== "shaft") return;
      const shaftPose = worldPose(shaftPiece, shaft),
        halfLength = Math.max(0.08, (shaft.length ?? 0.5) / 2),
        searchHalfLength = halfLength + 0.18,
        steps = Math.max(1, Math.ceil((searchHalfLength * 2) / (cellSize * 0.5))),
        candidates = new Set<SocketEntry>();
      for (let step = 0; step <= steps; step++) {
        const sample = shaftPose.point
            .clone()
            .addScaledVector(
              shaftPose.axis,
              -searchHalfLength + (step / steps) * searchHalfLength * 2,
            ),
          x = Math.floor(sample.x / cellSize),
          y = Math.floor(sample.y / cellSize),
          z = Math.floor(sample.z / cellSize);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dz = -1; dz <= 1; dz++)
              socketGrid
                .get(`${x + dx}:${y + dy}:${z + dz}`)
                ?.forEach((entry) => candidates.add(entry));
      }
      candidates.forEach((candidate) => {
        if (
          candidate.host === shaftPiece ||
          !connectorProfile(shaft, candidate.connector) ||
          Math.abs(candidate.axis.dot(shaftPose.axis)) < 0.94
        )
          return;
        const delta = candidate.point.clone().sub(shaftPose.point),
          along = delta.dot(shaftPose.axis),
          radial = delta.clone().addScaledVector(shaftPose.axis, -along).length(),
          radialTolerance = Math.max(
            0.18,
            Math.min(shaft.diameter, candidate.connector.diameter) * 0.22,
          );
        if (radial > radialTolerance || Math.abs(along) > searchHalfLength) return;
        const pair = `${shaftPiece.id}:${candidate.host.id}`;
        if (traversedPairs.has(pair)) return;
        traversedPairs.add(pair);
        traversals.push({ shaft: shaftPiece, host: candidate.host });
      });
    });
  });
  return traversals;
};

const pairProfile = (a: MeshConnector, b: MeshConnector) =>
  a.role === "shaft" && b.role === "socket"
    ? connectorProfile(a, b)
    : b.role === "shaft" && a.role === "socket"
      ? connectorProfile(b, a)
      : undefined;

const allowedModes = (profile: ConnectionProfile): JointMode[] =>
  profile === "pin-round"
    ? ["fixed", "rotation", "motor"]
    : profile === "axle-cross"
      ? ["fixed", "linear"]
      : ["rotation", "linear", "rotation-linear", "motor"];

const defaultMode = (profile: ConnectionProfile): JointMode =>
  profile === "pin-round"
    ? "fixed"
    : profile === "axle-cross"
      ? "linear"
      : "rotation-linear";

const freestAutomaticMode = (profile: ConnectionProfile): JointMode =>
  profile === "pin-round"
    ? "rotation"
    : profile === "axle-round"
      ? "rotation-linear"
      : "fixed";

const rebalanceSmartDefaults = (state: AppState, shaftPiece: Piece) => {
  const connections = state.connections.filter(
    (connection) => connection.b === shaftPiece,
  );
  if (!connections.length) return;
  connections.forEach((connection) => {
    if (!allowedModes(connection.profile).includes(connection.mode)) {
      connection.mode = defaultMode(connection.profile);
      connection.userConfigured = false;
      state.connectionModes.delete(connection.id);
    }
  });
  connections.forEach((connection) => {
    if (connection.userConfigured) return;
    if (connection.profile === "axle-cross") connection.mode = "fixed";
    else if (connection.profile === "axle-round") connection.mode = "rotation-linear";
    else if (shaftPiece.frictionPin) connection.mode = "fixed";
  });
  let anchored = connections.some(
    (connection) =>
      connection.mode === "fixed" &&
      (connection.userConfigured || connection.profile === "axle-cross"),
  );
  connections.forEach((connection) => {
    if (
      connection.userConfigured ||
      connection.profile === "axle-cross" ||
      connection.profile === "axle-round" ||
      shaftPiece.frictionPin
    )
      return;
    if (!anchored) {
      connection.mode = "fixed";
      anchored = true;
    } else connection.mode = freestAutomaticMode(connection.profile);
  });
};

const rebalanceAllSmartDefaults = (state: AppState) => {
  new Set(state.connections.map((connection) => connection.b)).forEach((piece) =>
    rebalanceSmartDefaults(state, piece),
  );
};

const modeLabel: Record<JointMode, string> = {
  fixed: "Fija",
  rotation: "Rotación libre",
  linear: "Lineal libre",
  "rotation-linear": "Rotación y lineal libres",
  motor: "Motor",
};

const profileLabel: Record<ConnectionProfile, string> = {
  "pin-round": "Naranja ↔ azul",
  "axle-cross": "Morado ↔ verde",
  "axle-round": "Morado ↔ azul",
};

// --- React application shell ------------------------------------------------
// Home coordinates the extracted subsystems and owns browser/UI state. The
// Three.js/Rapier runtime is created once inside its main effect below.
export default function Home() {
  // Three.js host elements and mutable runtime handles. These values should not
  // trigger React renders, so they deliberately live in refs rather than state.
  const studioRef = useRef<HTMLElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<AppState | null>(null);

  // Hidden file inputs used by the import and map editors.
  const fileRef = useRef<HTMLInputElement>(null);
  const projectFileRef = useRef<HTMLInputElement>(null);
  const connectorFileRef = useRef<HTMLInputElement>(null);
  const colliderFileRef = useRef<HTMLInputElement>(null);
  const projectNameInputRef = useRef<HTMLInputElement>(null);

  // Mutable guards shared with asynchronous loaders and the simulation loop.
  const importTokenRef = useRef(0);
  const suppressProjectNameDirtyRef = useRef(false);
  const projectRestoringRef = useRef(false);
  const physicsTransitionRef = useRef(false);
  const saveShortcutRef = useRef<() => void>(() => undefined);

  // Project identity and revision bookkeeping are kept outside React state so
  // recovery saves can read the latest values without recreating callbacks.
  const activeProjectIdRef = useRef(createProjectId());
  const projectNameRef = useRef("Untitled mechanism");
  const projectCreatedAtRef = useRef(new Date().toISOString());
  const projectRevisionRef = useRef(0);
  const savedProjectRevisionRef = useRef<number | null>(null);

  // Physics preferences are mirrored in refs for the requestAnimationFrame loop.
  const structuralModeRef = useRef<StructuralMode>("rigid");
  const structuralStiffnessRef = useRef(85);

  // Simulation and selection state.
  const [running, setRunning] = useState(false);
  const [physicsBusy, setPhysicsBusy] = useState(false);
  const [count, setCount] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Palette and external catalog state.
  const [category, setCategory] = useState("beams");
  const [search, setSearch] = useState("");
  const [reference, setReference] = useState("");
  const [results, setResults] = useState<CatalogPart[]>([]);
  const [imported, setImported] = useState<CatalogPart[]>([]);
  const [, setCatalogBusy] = useState(false);
  const [message, setMessage] = useState("catalog-ready");

  // Technical overlays and map editors.
  const [debugViews, setDebugViews] = useState<DebugFlags>({
    colliders: false,
    connectors: false,
    physics: false,
  });
  const [lastLog, setLastLog] = useState("");
  const [, setConnectionRevision] = useState(0);
  const [, setConnectorRevision] = useState(0);
  const [, setColliderRevision] = useState(0);
  const [connectionMapOpen, setConnectionMapOpen] = useState(false);
  const [collisionMapOpen, setCollisionMapOpen] = useState(false);
  const [collisionLayer, setCollisionLayer] = useState<"normal" | "gear">("normal");

  // Placement, snapping and pending import controls.
  const [rotationAngle, setRotationAngle] = useState(15);
  const [gridStep, setGridStep] = useState<GridStep>(0.25);
  const [axleSnapStep, setAxleSnapStep] = useState<AxleSnapStep>(0.25);
  const [rotationSnapStep, setRotationSnapStep] = useState<RotationSnapStep>(22.5);
  const [importDraft, setImportDraft] = useState<ImportDraft | null>(null);

  // User interface preferences.
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [language, setLanguage] = useState<Language>("en");
  const [controlsHelpVisible, setControlsHelpVisible] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState(270);

  // Global physics controls.
  const [structuralMode, setStructuralMode] = useState<StructuralMode>("rigid");
  const [structuralStiffness, setStructuralStiffness] = useState(85);
  const [physicsSettings, setPhysicsSettings] = useState<PhysicsSettings>({
    ...DEFAULT_PHYSICS_SETTINGS,
  });

  // Project manager and recovery-save state.
  const [projectName, setProjectName] = useState("Untitled mechanism");
  const [projectNameEditing, setProjectNameEditing] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [duplicateProjectDocument, setDuplicateProjectDocument] =
    useState<SimStudioProjectDocument | null>(null);
  const [duplicateProjectName, setDuplicateProjectName] = useState("");
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectPage, setProjectPage] = useState(0);
  const [projectBusy, setProjectBusy] = useState(false);
  const [currentProjectSaved, setCurrentProjectSaved] = useState(false);
  const [projectDirty, setProjectDirty] = useState(false);
  const [saveNamePrompt, setSaveNamePrompt] = useState(false);
  const [projectConfirmation, setProjectConfirmation] = useState<
    | { kind: "new" }
    | { kind: "open" | "delete"; project: ProjectSummary }
    | { kind: "import"; document: SimStudioProjectDocument }
    | null
  >(null);
  const [recoveryStatus, setRecoveryStatus] = useState<"idle" | "saving" | "saved">(
    "idle",
  );

  // Translated labels are computed once per render and shared by the inspector.
  const t = translations[language];
  const modeLabels: Record<JointMode, string> =
    language === "es"
      ? modeLabel
      : {
          fixed: "Fixed",
          rotation: "Free rotation",
          linear: "Free linear travel",
          "rotation-linear": "Free rotation and linear travel",
          motor: "Motor",
        };
  const profileLabels: Record<ConnectionProfile, string> =
    language === "es"
      ? profileLabel
      : {
          "pin-round": "Orange ↔ blue",
          "axle-cross": "Purple ↔ green",
          "axle-round": "Purple ↔ blue",
        };

  useEffect(() => {
    try {
      setLastLog(localStorage.getItem("sim-studio:physics-log") ?? "");
      setTheme(localStorage.getItem("sim-studio:theme") === "dark" ? "dark" : "light");
      setLanguage(localStorage.getItem("sim-studio:language") === "es" ? "es" : "en");
      setControlsHelpVisible(
        localStorage.getItem("sim-studio:controls-help-hidden") !== "1",
      );
      const savedGridStepText = localStorage.getItem("sim-studio:grid-step"),
        savedGridStep = savedGridStepText === null ? NaN : Number(savedGridStepText);
      if (
        savedGridStep === 0 ||
        savedGridStep === 0.25 ||
        savedGridStep === 0.5 ||
        savedGridStep === 1
      )
        setGridStep(savedGridStep);
      const savedAxleSnapText = localStorage.getItem("sim-studio:axle-snap"),
        savedAxleSnap = savedAxleSnapText === null ? NaN : Number(savedAxleSnapText);
      if (
        savedAxleSnap === 0 ||
        savedAxleSnap === 0.0625 ||
        savedAxleSnap === 0.125 ||
        savedAxleSnap === 0.25
      )
        setAxleSnapStep(savedAxleSnap);
      const savedRotationSnapText = localStorage.getItem("sim-studio:rotation-snap"),
        savedRotationSnap =
          savedRotationSnapText === null ? NaN : Number(savedRotationSnapText);
      if (
        savedRotationSnap === 0 ||
        savedRotationSnap === 11.25 ||
        savedRotationSnap === 22.5 ||
        savedRotationSnap === 45
      )
        setRotationSnapStep(savedRotationSnap);
      setStructuralMode(
        localStorage.getItem("sim-studio:structural-mode") === "flexible"
          ? "flexible"
          : "rigid",
      );
      const savedStiffness = Number(
        localStorage.getItem("sim-studio:structural-stiffness"),
      );
      if (Number.isFinite(savedStiffness) && savedStiffness >= 1)
        setStructuralStiffness(THREE.MathUtils.clamp(savedStiffness, 1, 100));
      const savedPhysics = JSON.parse(
        localStorage.getItem("sim-studio:physics-settings") ?? "null",
      ) as Partial<PhysicsSettings> | null;
      if (savedPhysics) {
        const restored = { ...DEFAULT_PHYSICS_SETTINGS };
        (Object.keys(restored) as (keyof PhysicsSettings)[]).forEach((key) => {
          const value = Number(savedPhysics[key]);
          if (Number.isFinite(value) && value >= 0) restored[key] = value;
        });
        setPhysicsSettings(restored);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("sim-studio:theme", theme);
    } catch {}
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem("sim-studio:language", language);
    } catch {}
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    try {
      localStorage.setItem("sim-studio:grid-step", String(gridStep));
    } catch {}
    if (appRef.current) appRef.current.gridStep = gridStep;
    appRef.current?.scheduleRecoverySave();
  }, [gridStep]);

  useEffect(() => {
    try {
      localStorage.setItem("sim-studio:axle-snap", String(axleSnapStep));
    } catch {}
    if (appRef.current) appRef.current.axleSnapStep = axleSnapStep;
    appRef.current?.scheduleRecoverySave();
  }, [axleSnapStep]);

  useEffect(() => {
    try {
      localStorage.setItem("sim-studio:rotation-snap", String(rotationSnapStep));
    } catch {}
    if (appRef.current) appRef.current.rotationSnapStep = rotationSnapStep;
    appRef.current?.scheduleRecoverySave();
  }, [rotationSnapStep]);

  useEffect(() => {
    try {
      localStorage.setItem("sim-studio:structural-mode", structuralMode);
      localStorage.setItem(
        "sim-studio:structural-stiffness",
        String(structuralStiffness),
      );
    } catch {}
    structuralModeRef.current = structuralMode;
    structuralStiffnessRef.current = structuralStiffness;
    appRef.current?.scheduleRecoverySave();
  }, [structuralMode, structuralStiffness]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "sim-studio:physics-settings",
        JSON.stringify(physicsSettings),
      );
    } catch {}
    if (appRef.current) appRef.current.physicsSettings = physicsSettings;
    appRef.current?.scheduleRecoverySave();
  }, [physicsSettings]);

  useEffect(() => {
    projectNameRef.current = projectName.trim() || "Untitled mechanism";
    const markDirty = !suppressProjectNameDirtyRef.current;
    suppressProjectNameDirtyRef.current = false;
    appRef.current?.scheduleRecoverySave(false, markDirty);
  }, [projectName]);

  useEffect(() => {
    const source =
        category === "imported"
          ? imported
          : paletteParts.filter((p) => p.family === category),
      query = search.trim().toLowerCase();
    setCatalogBusy(false);
    setResults(
      query
        ? source.filter((p) => (p.part + " " + p.name).toLowerCase().includes(query))
        : source,
    );
  }, [category, search, imported]);

  useEffect(() => {
    results.slice(0, 4).forEach((p) => void appRef.current?.preloadPart(p));
  }, [results]);

  useEffect(() => {
    const host = mountRef.current;
    if (!host) return;
    const darkTheme = theme === "dark",
      sceneColor = darkTheme ? 0x202328 : 0xdfe7ed;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(sceneColor);
    scene.fog = new THREE.Fog(sceneColor, 30, 75);
    const camera = new THREE.PerspectiveCamera(
        43,
        host.clientWidth / host.clientHeight,
        0.1,
        160,
      ),
      defaultCameraPosition = new THREE.Vector3(13, 12, 17),
      defaultCameraTarget = new THREE.Vector3(0, 2, 0),
      cameraTarget = defaultCameraTarget.clone();
    camera.position.copy(defaultCameraPosition);
    camera.lookAt(cameraTarget);
    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "high-performance",
      }),
      nativePixelRatio = Math.min(devicePixelRatio, 2);
    let renderScale = 1,
      healthyFpsWindows = 0,
      lowFpsWindows = 0;
    renderer.setPixelRatio(nativePixelRatio * renderScale);
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const gl = renderer.getContext() as WebGL2RenderingContext,
      gpuTimerExtension = gl.getExtension("EXT_disjoint_timer_query_webgl2") as {
        TIME_ELAPSED_EXT: number;
        GPU_DISJOINT_EXT: number;
      } | null,
      rendererInfoExtension = gl.getExtension("WEBGL_debug_renderer_info") as {
        UNMASKED_RENDERER_WEBGL: number;
        UNMASKED_VENDOR_WEBGL: number;
      } | null,
      gpuRenderer = rendererInfoExtension
        ? String(gl.getParameter(rendererInfoExtension.UNMASKED_RENDERER_WEBGL))
        : String(gl.getParameter(gl.RENDERER)),
      gpuVendor = rendererInfoExtension
        ? String(gl.getParameter(rendererInfoExtension.UNMASKED_VENDOR_WEBGL))
        : String(gl.getParameter(gl.VENDOR));
    host.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x718090, 2.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.3);
    sun.position.set(8, 16, 10);
    sun.castShadow = true;
    scene.add(sun);
    const grid = createStudioGrid(darkTheme);
    scene.add(grid);
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(GRID_SIZE, 0.3, GRID_SIZE),
      new THREE.MeshStandardMaterial({
        color: darkTheme ? 0x2b3035 : 0xcbd6dd,
        roughness: 0.86,
        transparent: true,
        opacity: 1,
      }),
    );
    floor.position.y = -0.2;
    floor.receiveShadow = true;
    floor.userData.floor = true;
    scene.add(floor);
    let floorViewedFromBelow = false;
    const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string) =>
        new Promise<T>((resolve, reject) => {
          const timer = window.setTimeout(
            () => reject(new Error(`${label} superó ${Math.round(ms / 1000)} s`)),
            ms,
          );
          promise.then(
            (value) => {
              window.clearTimeout(timer);
              resolve(value);
            },
            (error) => {
              window.clearTimeout(timer);
              reject(error);
            },
          );
        }),
      makeLoader = (base: string) => {
        const instance = new LDrawLoader();
        instance.setConditionalLineMaterial(LDrawConditionalLineMaterial);
        instance.setPartsLibraryPath(base);
        const materials = withTimeout(
          instance.preloadMaterials(base + "LDConfig.ldr"),
          10_000,
          "La paleta de materiales LDraw",
        ).catch(() => undefined);
        return { instance, materials };
      },
      makeLoaderPool = (base: string, size: number) => {
        const lanes = Array.from({ length: size }, () => ({
          loader: makeLoader(base),
          tail: Promise.resolve() as Promise<unknown>,
        }));
        let cursor = 0;
        return {
          primary: lanes[0].loader,
          load(source: string, label: string) {
            const lane = lanes[cursor++ % lanes.length],
              result = lane.tail.then(async () => {
                await lane.loader.materials;
                return withTimeout(
                  lane.loader.instance.loadAsync(source),
                  MODEL_LOAD_TIMEOUT,
                  label,
                );
              });
            lane.tail = result.then(
              () => undefined,
              () => undefined,
            );
            return result;
          },
        };
      },
      primaryPool = makeLoaderPool(LDRAW, 3),
      legacyPool = makeLoaderPool(LEGACY_LDRAW, 2),
      primary = primaryPool.primary,
      legacy = legacyPool.primary;
    const preloaded = new Set<string>(),
      preloading = new Map<string, Promise<void>>(),
      modelCache = new Map<string, THREE.Object3D>(),
      sourceModelCache = new Map<string, THREE.Object3D>(),
      modelSourceCache = new Map<
        string,
        { downloadUrl: string; downloadSource: "local" | "primary" | "legacy" }
      >(),
      connectorCache = new Map<string, MeshConnector[]>(),
      collisionCache = new Map<string, CollisionPrimitive[]>(),
      gearCollisionCache = new Map<string, CollisionPrimitive[]>();
    const assetUrl = (path: string) => new URL(path, document.baseURI).href;
    const modelSourceIdentity = (p: CatalogPart) =>
      p.embeddedGeometry
        ? `project:${p.projectAssetKey ?? p.part}`
        : p.geometry
          ? `asset:${p.geometry}`
          : `ldraw:${p.modelPart ?? p.resolvedPart ?? p.part}`;
    const modelRenderKey = (p: CatalogPart) =>
      `${modelSourceIdentity(p)}:source-color:${p.sourceColor ?? p.color}:display-color:${p.color}`;
    // --- Model loading and catalog analysis --------------------------------
    const loadPartModel = async (p: CatalogPart) => {
      if (p.geometry && invalidPackagedGeometry.has(p.part)) {
        p.geometry = undefined;
        p.sourceKind = "ldraw-network";
      }
      const sourceColor = p.sourceColor ?? p.color,
        sourceIdentity = modelSourceIdentity(p),
        sourceKey = `${sourceIdentity}:source-color:${sourceColor}`,
        key = `${sourceKey}:display-color:${p.color}`,
        cachedSource = modelSourceCache.get(sourceKey),
        resolvedFile = `${p.modelPart ?? p.part}.dat`;
      Object.assign(
        p,
        cachedSource ??
          (p.embeddedGeometry
            ? {}
            : p.geometry
              ? {
                  downloadUrl: assetUrl(p.geometry),
                  downloadSource: "local" as const,
                }
              : {
                  downloadUrl: `${LDRAW}parts/${resolvedFile}`,
                  downloadSource: "primary" as const,
                }),
      );
      const cached = modelCache.get(key);
      if (cached) return cached.clone(true);
      let exact = sourceModelCache.get(sourceKey)?.clone(true);
      if (!exact) {
        if (p.embeddedGeometry)
          try {
            exact = new THREE.ObjectLoader().parse(p.embeddedGeometry);
          } catch {}
        if (!exact && p.geometry)
          try {
            exact = await new THREE.ObjectLoader().loadAsync(assetUrl(p.geometry));
            const source = {
              downloadUrl: assetUrl(p.geometry),
              downloadSource: "local" as const,
            };
            Object.assign(p, source);
            modelSourceCache.set(sourceKey, source);
          } catch {}
        if (!exact) {
          const source = `data:text/plain;charset=utf-8,${encodeURIComponent(
            modelText({ ...p, color: sourceColor }),
          )}`;
          try {
            exact = flattenLDrawRenderables(
              await primaryPool.load(source, `La pieza ${p.part}`),
            );
            const loadedSource = {
              downloadUrl: `${LDRAW}parts/${resolvedFile}`,
              downloadSource: "primary" as const,
            };
            Object.assign(p, loadedSource);
            modelSourceCache.set(sourceKey, loadedSource);
          } catch (primaryError) {
            try {
              exact = flattenLDrawRenderables(
                await legacyPool.load(source, `La pieza ${p.part}`),
              );
              const loadedSource = {
                downloadUrl: `${LEGACY_LDRAW}parts/${resolvedFile}`,
                downloadSource: "legacy" as const,
              };
              Object.assign(p, loadedSource);
              modelSourceCache.set(sourceKey, loadedSource);
            } catch {
              throw primaryError;
            }
          }
        }
        sourceModelCache.set(sourceKey, exact.clone(true));
      }
      if (sourceColor !== p.color) {
        await primary.materials;
        const primaryReplacement = primary.instance.getMaterial(String(p.color)),
          replacement =
            primaryReplacement ?? legacy.instance.getMaterial(String(p.color)),
          materialLoader = primaryReplacement ? primary.instance : legacy.instance,
          materialCaches = materialLoader as LDrawLoader & {
            edgeMaterialCache: WeakMap<THREE.Material, THREE.Material>;
            conditionalEdgeMaterialCache: WeakMap<THREE.Material, THREE.Material>;
          },
          edgeReplacement = replacement
            ? materialCaches.edgeMaterialCache.get(replacement)
            : undefined,
          conditionalReplacement = edgeReplacement
            ? materialCaches.conditionalEdgeMaterialCache.get(edgeReplacement)
            : undefined;
        if (replacement) {
          exact.traverse((child) => {
            if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Line)) return;
            const replace = (material: THREE.Material) => {
              if (String(material.userData.code) !== String(sourceColor)) return material;
              if (child instanceof THREE.Mesh) return replacement;
              // ObjectLoader serializes LDrawConditionalLineMaterial as a plain
              // ShaderMaterial. Detect it by its required geometry attributes too,
              // otherwise recoloring turns every conditional edge into a normal
              // line and exposes the polygon facets of cylinders and curved parts.
              const conditional =
                !!(
                  material as THREE.Material & {
                    isLDrawConditionalLineMaterial?: boolean;
                  }
                ).isLDrawConditionalLineMaterial ||
                (child.geometry.hasAttribute("control0") &&
                  child.geometry.hasAttribute("control1") &&
                  child.geometry.hasAttribute("direction"));
              return conditional
                ? (conditionalReplacement ?? edgeReplacement ?? material)
                : (edgeReplacement ?? material);
            };
            child.material = Array.isArray(child.material)
              ? child.material.map(replace)
              : replace(child.material);
          });
        }
      }
      if (p.color === 0) {
        const blackOutline = new THREE.Color(0x505860);
        exact.traverse((child) => {
          if (!(child instanceof THREE.Line)) return;
          const recolorLine = (source: THREE.Material) => {
            const material = source.clone() as THREE.Material & {
              color?: THREE.Color;
              uniforms?: Record<string, { value?: unknown }>;
            };
            material.color?.copy(blackOutline);
            for (const uniformName of ["diffuse", "color"])
              if (material.uniforms?.[uniformName]?.value instanceof THREE.Color)
                material.uniforms[uniformName].value.copy(blackOutline);
            material.needsUpdate = true;
            return material;
          };
          child.material = Array.isArray(child.material)
            ? child.material.map(recolorLine)
            : recolorLine(child.material);
        });
      }
      modelCache.set(key, exact.clone(true));
      return exact;
    };

    const prepareModel = (exact: THREE.Object3D) => {
      exact.rotation.x = Math.PI;
      exact.scale.setScalar(0.05);
      exact.updateMatrixWorld(true);
    };

    const cloneConnectors = (connectors: MeshConnector[]) =>
      connectors.map((connector) => ({
        ...connector,
        local: connector.local.clone(),
        axis: connector.axis.clone(),
      }));
    const analyzePart = (wrapper: THREE.Object3D, p: CatalogPart) => {
      let connectors: MeshConnector[] | undefined = straightAxleConnectors(p.name),
        hasSavedConnectorMap = false;
      if (!connectors)
        try {
          const saved = localStorage.getItem(`sim-connectors-v4:${p.part}`),
            savedIsCurrent =
              localStorage.getItem(`sim-connectors-revision:${p.part}`) ===
              CORRECTION_MAP_REVISION;
          if (saved && (!preloadedConnectionMaps[p.part] || savedIsCurrent)) {
            hasSavedConnectorMap = true;
            connectors = (
              JSON.parse(saved) as {
                local: number[];
                axis: number[];
                kind: "round" | "axle" | "half";
                role?: "socket" | "shaft";
                diameter: number;
                length?: number;
              }[]
            ).map((connector) => ({
              ...connector,
              role: connector.role ?? "socket",
              local: new THREE.Vector3().fromArray(connector.local),
              axis: new THREE.Vector3().fromArray(connector.axis).normalize(),
            }));
          }
        } catch {}
      if (!connectors && preloadedConnectionMaps[p.part])
        connectors = preloadedConnectionMaps[p.part].map((connector) => ({
          ...connector,
          local: new THREE.Vector3().fromArray(connector.local),
          axis: new THREE.Vector3().fromArray(connector.axis).normalize(),
        }));
      if (!connectors && packagedParts[p.part])
        connectors = packagedParts[p.part].connectors.map((connector) => ({
          ...connector,
          local: new THREE.Vector3().fromArray(connector.local),
          axis: new THREE.Vector3().fromArray(connector.axis).normalize(),
        }));
      if (!connectors)
        connectors =
          connectorCache.get(p.part) && cloneConnectors(connectorCache.get(p.part)!);
      if (!connectors) {
        if (isPinPart(p)) {
          const shafts = /^Technic Axle Pin/i.test(p.name)
              ? hybridAxlePinConnectors(wrapper)
              : rodConnectors(wrapper, "round"),
            sockets = detectConnectorHoles(wrapper);
          connectors = [
            ...shafts,
            ...sockets.filter(
              (socket) =>
                !shafts.some((shaft) => shaft.local.distanceTo(socket.local) < 0.12),
            ),
          ];
        } else if (isAxlePart(p)) {
          const shafts = rodConnectors(wrapper, "axle"),
            sockets = detectConnectorHoles(wrapper);
          connectors = [
            ...shafts,
            ...sockets.filter(
              (socket) =>
                !shafts.some((shaft) => shaft.local.distanceTo(socket.local) < 0.12),
            ),
          ];
        }
      }
      if (!connectors) {
        connectors = detectConnectorHoles(wrapper);
        if (!connectors.length) connectors = fallbackBeamConnectors(wrapper, p.name);
        try {
          localStorage.setItem(
            `sim-connectors-v4:${p.part}`,
            JSON.stringify(
              connectors.map((connector) => ({
                ...connector,
                local: connector.local.toArray(),
                axis: connector.axis.toArray(),
              })),
            ),
          );
        } catch {}
      }
      if (isHalfBeamPart(p))
        connectors = connectors.map((connector) => ({
          ...connector,
          kind:
            connector.role === "socket" && connector.kind === "round"
              ? "half"
              : connector.kind,
        }));
      connectorCache.set(p.part, cloneConnectors(connectors));
      let colliders: CollisionPrimitive[] | undefined = straightAxleCollisionPrimitives(
        p.name,
      );
      if (!colliders)
        try {
          const saved = localStorage.getItem(`sim-colliders-v1:${p.part}`),
            savedIsCurrent =
              localStorage.getItem(`sim-colliders-revision:${p.part}`) ===
              CORRECTION_MAP_REVISION;
          if (saved && (!preloadedCollisionMaps[p.part] || savedIsCurrent)) {
            const stored = JSON.parse(saved) as {
              shape: "box" | "cylinder";
              center: number[];
              size?: number[];
              radius?: number;
              halfHeight?: number;
              rotation: number[];
            }[];
            if (Array.isArray(stored))
              colliders = stored
                .filter(
                  (primitive) =>
                    (primitive.shape === "box" || primitive.shape === "cylinder") &&
                    primitive.center?.length >= 3 &&
                    primitive.rotation?.length >= 4,
                )
                .map((primitive) => ({
                  shape: primitive.shape,
                  center: new THREE.Vector3().fromArray(primitive.center),
                  size:
                    primitive.shape === "box" && primitive.size?.length === 3
                      ? new THREE.Vector3().fromArray(primitive.size)
                      : undefined,
                  radius:
                    primitive.shape === "cylinder"
                      ? Math.max(0.01, primitive.radius ?? 0.5)
                      : undefined,
                  halfHeight:
                    primitive.shape === "cylinder"
                      ? Math.max(0.01, primitive.halfHeight ?? 0.5)
                      : undefined,
                  rotation: new THREE.Quaternion().fromArray(primitive.rotation),
                }));
          }
        } catch {}
      if (!colliders && preloadedCollisionMaps[p.part])
        colliders = preloadedCollisionMaps[p.part].map((primitive) => ({
          ...primitive,
          center: new THREE.Vector3().fromArray(primitive.center),
          size: primitive.size
            ? new THREE.Vector3().fromArray(primitive.size)
            : undefined,
          rotation: new THREE.Quaternion().fromArray(primitive.rotation),
        }));
      if (!colliders)
        colliders = collisionCache.get(p.part)?.map((primitive) => ({
          ...primitive,
          center: primitive.center.clone(),
          size: primitive.size?.clone(),
          rotation: primitive.rotation.clone(),
        }));
      // Corrected connection maps can change the topology used by the compound
      // collider generator (notably small L beams). Do not reuse a collider that
      // was packaged before that corrected map existed.
      if (
        !colliders &&
        packagedParts[p.part] &&
        !/^Technic (Beam|Panel)/i.test(p.name) &&
        !/wheel|tyre|tire|gear|bush/i.test(p.name) &&
        !/^Technic Axle(?: and Pin)? (?:Joiner|Connector)/i.test(p.name) &&
        !preloadedConnectionMaps[p.part] &&
        !hasSavedConnectorMap
      )
        colliders = packagedParts[p.part].colliders.map((primitive) => ({
          ...primitive,
          center: new THREE.Vector3().fromArray(primitive.center),
          size: primitive.size
            ? new THREE.Vector3().fromArray(primitive.size)
            : undefined,
          rotation: new THREE.Quaternion().fromArray(primitive.rotation),
        }));
      if (!colliders) {
        colliders = approximateCollisionPrimitives(wrapper, p.name, connectors);
        collisionCache.set(
          p.part,
          colliders.map((primitive) => ({
            ...primitive,
            center: primitive.center.clone(),
            size: primitive.size?.clone(),
            rotation: primitive.rotation.clone(),
          })),
        );
      }
      let gearColliders: CollisionPrimitive[] = [];
      if (isGearPart(p)) {
        try {
          const saved = localStorage.getItem(`sim-gear-colliders-v1:${p.part}`);
          if (saved) {
            const rows = JSON.parse(saved) as {
              shape: "box" | "cylinder";
              center: number[];
              size?: number[];
              radius?: number;
              halfHeight?: number;
              rotation: number[];
            }[];
            if (Array.isArray(rows))
              gearColliders = rows.map((primitive) => ({
                ...primitive,
                center: new THREE.Vector3().fromArray(primitive.center),
                size: primitive.size
                  ? new THREE.Vector3().fromArray(primitive.size)
                  : undefined,
                rotation: new THREE.Quaternion().fromArray(primitive.rotation),
              }));
          }
        } catch {}
        if (!gearColliders.length && preloadedGearCollisionMaps[p.part])
          gearColliders = preloadedGearCollisionMaps[p.part].map((primitive) => ({
            ...primitive,
            center: new THREE.Vector3().fromArray(primitive.center),
            size: primitive.size
              ? new THREE.Vector3().fromArray(primitive.size)
              : undefined,
            rotation: new THREE.Quaternion().fromArray(primitive.rotation),
          }));
        if (!gearColliders.length)
          gearColliders =
            gearCollisionCache.get(p.part)?.map((primitive) => ({
              ...primitive,
              center: primitive.center.clone(),
              size: primitive.size?.clone(),
              rotation: primitive.rotation.clone(),
            })) ?? [];
        if (!gearColliders.length && packagedParts[p.part]?.gearColliders)
          gearColliders = packagedParts[p.part].gearColliders!.map((primitive) => ({
            ...primitive,
            center: new THREE.Vector3().fromArray(primitive.center),
            size: primitive.size
              ? new THREE.Vector3().fromArray(primitive.size)
              : undefined,
            rotation: new THREE.Quaternion().fromArray(primitive.rotation),
          }));
        if (!gearColliders.length) {
          gearColliders = approximateGearCollisionPrimitives(colliders);
          gearCollisionCache.set(
            p.part,
            gearColliders.map((primitive) => ({
              ...primitive,
              center: primitive.center.clone(),
              size: primitive.size?.clone(),
              rotation: primitive.rotation.clone(),
            })),
          );
        }
      }
      return { connectors, colliders, gearColliders };
    };

    const preloadPart = async (p: CatalogPart) => {
      const preloadKey = modelRenderKey(p);
      if (preloaded.has(preloadKey)) return;
      if (preloading.has(preloadKey)) return preloading.get(preloadKey);
      const task = loadPartModel(p)
        .then((exact) => {
          prepareModel(exact);
          const wrapper = new THREE.Group();
          wrapper.add(exact);
          wrapper.updateMatrixWorld(true);
          analyzePart(wrapper, p);
          preloaded.add(preloadKey);
        })
        .catch(() => {})
        .finally(() => preloading.delete(preloadKey));
      preloading.set(preloadKey, task);
      return task;
    };

    const renderImportPreview = async (parts: PreparedImportPlacement[]) => {
      const previewScene = new THREE.Scene();
      previewScene.background = new THREE.Color(darkTheme ? 0x202328 : 0xe8edf0);
      previewScene.add(new THREE.HemisphereLight(0xffffff, 0x36404a, 2.4));
      const light = new THREE.DirectionalLight(0xffffff, 3.2);
      light.position.set(7, 10, 9);
      previewScene.add(light);
      const root = new THREE.Group();
      previewScene.add(root);
      const uniqueCatalogs = [
          ...new Map(
            parts.map((placement) => [
              `${placement.catalog.part}:${placement.catalog.color}`,
              placement.catalog,
            ]),
          ).entries(),
        ],
        previewModels = new Map<string, THREE.Object3D>();
      let previewCursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, uniqueCatalogs.length) }, async () => {
          while (previewCursor < uniqueCatalogs.length) {
            const [key, catalog] = uniqueCatalogs[previewCursor++];
            try {
              previewModels.set(key, await loadPartModel(catalog));
            } catch {
              // A missing part must not keep the entire preview open forever.
            }
          }
        }),
      );
      const detailedPreview = parts.length <= 180,
        proxyTemplates = new Map<
          string,
          {
            geometry: THREE.BoxGeometry;
            material: THREE.MeshStandardMaterial;
            center: THREE.Vector3;
          }
        >();
      if (!detailedPreview)
        for (const [key, catalog] of uniqueCatalogs) {
          const source = previewModels.get(key);
          if (!source) continue;
          const measured = source.clone(true);
          prepareModel(measured);
          const bounds = new THREE.Box3().setFromObject(measured),
            size = bounds.getSize(new THREE.Vector3()),
            center = bounds.getCenter(new THREE.Vector3());
          size.set(
            Math.max(size.x, 0.08),
            Math.max(size.y, 0.08),
            Math.max(size.z, 0.08),
          );
          proxyTemplates.set(key, {
            geometry: new THREE.BoxGeometry(size.x, size.y, size.z),
            material: new THREE.MeshStandardMaterial({
              color: colorHex[catalog.color] ?? colorHex[71],
              roughness: 0.78,
              metalness: 0,
            }),
            center,
          });
        }
      for (let index = 0; index < parts.length; index++) {
        const placement = parts[index],
          key = `${placement.catalog.part}:${placement.catalog.color}`,
          source = previewModels.get(key);
        if (!source) continue;
        const wrapper = new THREE.Group();
        if (detailedPreview) {
          const exact = source.clone(true);
          prepareModel(exact);
          wrapper.add(exact);
        } else {
          const template = proxyTemplates.get(key);
          if (!template) continue;
          const proxy = new THREE.Mesh(template.geometry, template.material);
          proxy.position.copy(template.center);
          wrapper.add(proxy);
        }
        wrapper.position.copy(placement.position);
        wrapper.quaternion.copy(placement.rotation);
        root.add(wrapper);
        if (index % 80 === 79)
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      if (!root.children.length)
        throw new Error("No se pudo cargar ninguna geometría para la vista previa");
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root),
        center = box.getCenter(new THREE.Vector3()),
        size = box.getSize(new THREE.Vector3()),
        radius = Math.max(size.x, size.y, size.z, 1),
        previewCamera = new THREE.PerspectiveCamera(32, 16 / 9, 0.01, radius * 20);
      previewCamera.position
        .copy(center)
        .add(new THREE.Vector3(radius * 1.35, radius * 1.05, radius * 1.55));
      previewCamera.lookAt(center);
      const previewRenderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
      });
      previewRenderer.setPixelRatio(1);
      previewRenderer.setSize(640, 360, false);
      previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
      previewRenderer.render(previewScene, previewCamera);
      const image = previewRenderer.domElement.toDataURL("image/png");
      previewRenderer.dispose();
      proxyTemplates.forEach((template) => {
        template.geometry.dispose();
        template.material.dispose();
      });
      return image;
    };

    const state = {} as AppState,
      debugRoot = new THREE.Group();
    let showRotationPivot = false;
    debugRoot.name = "Sim Studio diagnostics";
    scene.add(debugRoot);
    const disposeDebug = () => {
      while (debugRoot.children.length) {
        const object = debugRoot.children.pop()!;
        object.traverse((child) => {
          if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
            child.geometry.dispose();
            const materials = Array.isArray(child.material)
              ? child.material
              : [child.material];
            materials.forEach((m) => m.dispose());
          }
        });
      }
    };

    const updateDebug = () => {
      debugRoot.children.forEach((object) => {
        const data = object.userData,
          piece = data.piece as Piece | undefined;
        if (
          (data.debugKind === "collider" || data.debugKind === "connector-volume") &&
          piece
        ) {
          piece.mesh.updateMatrixWorld(true);
          object.position.copy(
            piece.mesh.localToWorld((data.local as THREE.Vector3).clone()),
          );
          const worldRotation = piece.mesh.getWorldQuaternion(new THREE.Quaternion());
          object.quaternion.copy(
            worldRotation.multiply((data.localRotation as THREE.Quaternion).clone()),
          );
        } else if (data.debugKind === "connector-point" && piece)
          object.position.copy(
            piece.mesh.localToWorld((data.local as THREE.Vector3).clone()),
          );
        else if (data.debugKind === "connector-axis" && piece) {
          object.position.copy(
            piece.mesh.localToWorld((data.local as THREE.Vector3).clone()),
          );
          (object as THREE.ArrowHelper).setDirection(
            (data.axis as THREE.Vector3)
              .clone()
              .transformDirection(piece.mesh.matrixWorld)
              .normalize(),
          );
        } else if (data.debugKind === "body-axes" && piece) {
          object.position.copy(piece.mesh.getWorldPosition(new THREE.Vector3()));
          object.quaternion.copy(piece.mesh.getWorldQuaternion(new THREE.Quaternion()));
        } else if (data.debugKind === "joint-point") {
          const connection = data.connection as Connection;
          object.position.copy(
            connection.a.mesh.localToWorld((data.local as THREE.Vector3).clone()),
          );
        } else if (data.debugKind === "joint-axis") {
          const connection = data.connection as Connection;
          object.position.copy(
            connection.a.mesh.localToWorld((data.local as THREE.Vector3).clone()),
          );
          (object as THREE.ArrowHelper).setDirection(
            (data.axis as THREE.Vector3)
              .clone()
              .transformDirection(connection.a.mesh.matrixWorld)
              .normalize(),
          );
        } else if (data.debugKind === "joint-link") {
          const connection = data.connection as Connection,
            a = connection.a.mesh.getWorldPosition(new THREE.Vector3()),
            b = connection.b.mesh.getWorldPosition(new THREE.Vector3());
          (object as THREE.Line).geometry.setFromPoints([a, b]);
        } else if (data.debugKind === "forced-joint-link") {
          const connection = data.connection as Connection;
          if (!connection.localPointA || !connection.localPointB) return;
          const a = connection.a.mesh.localToWorld(connection.localPointA.clone()),
            b = connection.b.mesh.localToWorld(connection.localPointB.clone());
          (object as THREE.Line).geometry.setFromPoints([a, b]);
        }
      });
    };

    const configureDebugOverlay = () => {
      debugRoot.children.forEach((rootObject) => {
        const kind = rootObject.userData.debugKind as string | undefined,
          order =
            kind === "connector-point"
              ? 90
              : kind === "connector-axis" || kind === "joint-axis"
                ? 80
                : kind === "forced-joint-link" || kind === "joint-link"
                  ? 75
                  : kind === "connector-volume"
                    ? 70
                    : 60;
        rootObject.traverse((object) => {
          object.renderOrder = order;
          object.frustumCulled = false;
          if (
            !(object instanceof THREE.Mesh) &&
            !(object instanceof THREE.Line) &&
            !(object instanceof THREE.Points)
          )
            return;
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((material) => {
            material.depthTest = false;
            material.depthWrite = false;
            material.transparent = true;
            material.needsUpdate = true;
          });
        });
      });
    };

    const refreshDebug = () => {
      disposeDebug();
      for (const piece of state.pieces) {
        piece.mesh.updateMatrixWorld(true);
        if (state.debug.colliders) {
          const debugColliders = [
            ...piece.colliders.map((primitive) => ({
              primitive,
              gearLayer: false,
            })),
            ...piece.gearColliders.map((primitive) => ({
              primitive,
              gearLayer: true,
            })),
          ];
          for (const { primitive, gearLayer } of debugColliders) {
            const geometry =
              primitive.shape === "box"
                ? new THREE.BoxGeometry(
                    primitive.size!.x,
                    primitive.size!.y,
                    primitive.size!.z,
                  )
                : new THREE.CylinderGeometry(
                    primitive.radius!,
                    primitive.radius!,
                    primitive.halfHeight! * 2,
                    12,
                  );
            const helper = new THREE.Mesh(
              geometry,
              new THREE.MeshBasicMaterial({
                color: gearLayer ? 0xff4fa3 : piece.fixed ? 0xffc928 : 0x3dff78,
                wireframe: true,
                transparent: true,
                opacity: 0.72,
                depthTest: false,
              }),
            );
            helper.renderOrder = 40;
            helper.userData = {
              debugKind: "collider",
              piece,
              gearLayer,
              local: primitive.center.clone(),
              localRotation: primitive.rotation.clone(),
            };
            debugRoot.add(helper);
          }
        }
        if (state.debug.connectors)
          for (const connector of piece.connectors) {
            const manual = state.manualConnect,
              selectedNode = manual?.piece === piece && manual.connector === connector;
            if (
              manual &&
              ((piece === manual.piece && !selectedNode) ||
                (piece !== manual.piece && !pairProfile(manual.connector, connector)))
            )
              continue;
            const color = selectedNode
              ? 0xffee38
              : connector.kind === "half"
                ? connector.role === "shaft"
                  ? 0xff4fa3
                  : 0x16dbe5
                : connector.role === "shaft"
                  ? connector.kind === "axle"
                    ? 0xa855f7
                    : 0xff8a1f
                  : connector.kind === "axle"
                    ? 0x35d36f
                    : 0x26a7ff;
            if (connector.role === "shaft" && connector.kind === "axle") {
              const localRotation = new THREE.Quaternion().setFromUnitVectors(
                  new THREE.Vector3(0, 1, 0),
                  connector.axis,
                ),
                volume = new THREE.Mesh(
                  new THREE.CylinderGeometry(
                    selectedNode ? 0.13 : 0.065,
                    selectedNode ? 0.13 : 0.065,
                    connector.length ?? 0.5,
                    10,
                  ),
                  new THREE.MeshBasicMaterial({
                    color,
                    wireframe: true,
                    depthTest: false,
                    transparent: true,
                    opacity: 0.9,
                  }),
                );
              volume.renderOrder = 41;
              volume.userData = {
                debugKind: "connector-volume",
                piece,
                local: connector.local.clone(),
                localRotation,
              };
              debugRoot.add(volume);
              for (const snapPoint of axleSnapPoints(connector)) {
                const highlighted =
                    manual?.piece === piece &&
                    manual.connector === connector &&
                    manual.anchorLocal.distanceTo(snapPoint.local) < 1e-4,
                  marker = new THREE.Mesh(
                    new THREE.SphereGeometry(
                      highlighted ? 0.14 : snapPoint.important ? 0.09 : 0.052,
                      10,
                      8,
                    ),
                    new THREE.MeshBasicMaterial({
                      color: highlighted
                        ? 0xffee38
                        : snapPoint.important
                          ? 0xc084fc
                          : 0x7e22ce,
                      depthTest: false,
                      transparent: true,
                      opacity: snapPoint.important ? 1 : 0.7,
                    }),
                  );
                marker.renderOrder = 43;
                marker.userData = {
                  debugKind: "connector-point",
                  piece,
                  local: snapPoint.local.clone(),
                };
                debugRoot.add(marker);
              }
            } else {
              const point = new THREE.Mesh(
                connector.kind === "axle"
                  ? new THREE.OctahedronGeometry(selectedNode ? 0.19 : 0.105)
                  : connector.kind === "half" && connector.role === "socket"
                    ? new THREE.TorusGeometry(
                        selectedNode ? 0.13 : 0.075,
                        selectedNode ? 0.035 : 0.022,
                        7,
                        14,
                      )
                    : new THREE.SphereGeometry(selectedNode ? 0.16 : 0.085, 10, 8),
                new THREE.MeshBasicMaterial({ color, depthTest: false }),
              );
              point.renderOrder = 41;
              point.userData = {
                debugKind: "connector-point",
                piece,
                local: connector.local.clone(),
              };
              debugRoot.add(point);
            }
            const arrow = new THREE.ArrowHelper(
              connector.axis,
              new THREE.Vector3(),
              selectedNode ? 0.7 : 0.35,
              color,
              0.11,
              0.07,
            );
            arrow.userData = {
              debugKind: "connector-axis",
              piece,
              local: connector.local.clone(),
              axis: connector.axis.clone(),
            };
            debugRoot.add(arrow);
          }
        if (showRotationPivot && piece === state.selected && piece.rotationPivotLocal) {
          const pivotMarker = new THREE.Mesh(
            new THREE.TorusGeometry(0.14, 0.035, 8, 20),
            new THREE.MeshBasicMaterial({
              color: 0xffc928,
              depthTest: false,
              transparent: true,
              opacity: 0.95,
            }),
          );
          pivotMarker.renderOrder = 48;
          pivotMarker.userData = {
            debugKind: "connector-point",
            piece,
            local: piece.rotationPivotLocal.clone(),
          };
          debugRoot.add(pivotMarker);
        }
        if (state.debug.physics) {
          const axes = new THREE.AxesHelper(0.65);
          axes.userData = { debugKind: "body-axes", piece };
          axes.renderOrder = 42;
          debugRoot.add(axes);
        }
      }
      for (const connection of state.connections.filter(
        (candidate) => candidate.forced,
      )) {
        if (!connection.localPointA || !connection.localPointB) continue;
        const addForcedPoint = (piece: Piece, local: THREE.Vector3) => {
          const point = new THREE.Mesh(
            new THREE.SphereGeometry(0.13, 12, 8),
            new THREE.MeshBasicMaterial({
              color: 0xff2d2d,
              depthTest: false,
            }),
          );
          point.renderOrder = 55;
          point.userData = {
            debugKind: "connector-point",
            piece,
            local: local.clone(),
          };
          debugRoot.add(point);
        };
        addForcedPoint(connection.a, connection.localPointA);
        addForcedPoint(connection.b, connection.localPointB);
        const line = new THREE.Line(
          new THREE.BufferGeometry(),
          new THREE.LineBasicMaterial({
            color: 0xff2d2d,
            depthTest: false,
            transparent: true,
            opacity: 0.9,
          }),
        );
        line.renderOrder = 54;
        line.userData = { debugKind: "forced-joint-link", connection };
        debugRoot.add(line);
      }
      if (state.debug.physics)
        for (const connection of state.connections) {
          connection.a.mesh.updateMatrixWorld(true);
          const local = connection.a.mesh.worldToLocal(connection.point.clone()),
            nearest = connection.a.connectors
              .slice()
              .sort((a, b) => a.local.distanceTo(local) - b.local.distanceTo(local))[0],
            axis = nearest?.axis.clone() ?? new THREE.Vector3(1, 0, 0);
          const point = new THREE.Mesh(
            new THREE.SphereGeometry(0.11, 12, 8),
            new THREE.MeshBasicMaterial({ color: 0xff9d20, depthTest: false }),
          );
          point.userData = {
            debugKind: "joint-point",
            connection,
            local: local.clone(),
          };
          debugRoot.add(point);
          const arrow = new THREE.ArrowHelper(
            axis,
            new THREE.Vector3(),
            0.75,
            0xff9d20,
            0.16,
            0.1,
          );
          arrow.userData = {
            debugKind: "joint-axis",
            connection,
            local: local.clone(),
            axis,
          };
          debugRoot.add(arrow);
          const link = new THREE.Line(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial({
              color: 0xff572d,
              depthTest: false,
              transparent: true,
              opacity: 0.8,
            }),
          );
          link.userData = { debugKind: "joint-link", connection };
          debugRoot.add(link);
        }
      configureDebugOverlay();
      updateDebug();
    };

    const disposeRenderBatches = () => {
      state.renderBatchItems?.forEach(({ mesh }) => {
        if (mesh.userData.ownedBatchMaterial) (mesh.material as THREE.Material).dispose();
        if (mesh.userData.ownedBatchGeometry) mesh.geometry.dispose();
        mesh.dispose();
      });
      const outlineGeometries = new Set<THREE.BufferGeometry>();
      state.pieces?.forEach((piece) => {
        const outlines: THREE.Line[] = [];
        piece.mesh.traverse((object) => {
          if (object instanceof THREE.Line && object.userData.dynamicOutlineBatch)
            outlines.push(object);
        });
        outlines.forEach((outline) => {
          outlineGeometries.add(outline.geometry);
          outline.removeFromParent();
        });
      });
      outlineGeometries.forEach((geometry) => geometry.dispose());
      if (state.renderBatchRoot) {
        state.renderBatchRoot.traverse((object) => {
          if (object.userData.ownedBatchGeometry && object instanceof THREE.Line)
            object.geometry.dispose();
        });
        scene.remove(state.renderBatchRoot);
        state.renderBatchRoot.clear();
        state.renderBatchRoot = undefined;
        state.renderLineBatchRoot = undefined;
      }
      state.renderBatchItems = [];
      state.renderBatchStats = {
        lineBatches: 0,
        meshBatches: 0,
        hiddenOriginalLines: 0,
        hiddenOriginalMeshes: 0,
      };
      state.renderBatchesDirty = false;
      state.pieces?.forEach((piece) => {
        piece.renderBatched = false;
        piece.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh || child instanceof THREE.Line)
            child.visible = true;
          if (child instanceof THREE.Mesh) child.castShadow = true;
        });
      });
    };

    const updateRenderBatches = () => {
      const matrix = new THREE.Matrix4();
      const pieceMatrices = new Map<Piece, THREE.Matrix4>();
      state.pieces.forEach((piece) => {
        piece.mesh.updateMatrix();
        pieceMatrices.set(piece, piece.mesh.matrix);
      });
      for (const batch of state.renderBatchItems ?? []) {
        let changed = false;
        batch.pieces.forEach((piece, index) => {
          if (
            state.running &&
            (!piece.body ||
              piece.physicsIslandFixed ||
              state.sleepingBodyHandles.has(piece.body.handle))
          )
            return;
          matrix.multiplyMatrices(
            pieceMatrices.get(piece) ?? piece.mesh.matrix,
            batch.localMatrix,
          );
          batch.mesh.setMatrixAt(index, matrix);
          changed = true;
        });
        if (changed) batch.mesh.instanceMatrix.needsUpdate = true;
      }
      state.renderBatchesDirty = false;
    };

    const rebuildRenderBatches = (batchPieces = state.pieces) => {
      disposeRenderBatches();
      if (!batchPieces.length) return;
      const root = new THREE.Group();
      root.name = "Sim Studio instanced LDraw batches";
      state.renderBatchRoot = root;
      state.renderBatchItems = [];
      state.renderBatchesDirty = true;
      scene.add(root);
      const hiddenOriginalLines = 0,
        outlineBatchCount = 0;
      let hiddenOriginalMeshes = 0;
      state.renderLineBatchRoot = undefined;
      const cloneGeometryRange = (
        source: THREE.BufferGeometry,
        start: number,
        count: number,
      ) => {
        const nonIndexed = source.index ? source.toNonIndexed() : source,
          result = new THREE.BufferGeometry();
        Object.entries(nonIndexed.attributes).forEach(([name, attribute]) => {
          if (attribute instanceof THREE.InterleavedBufferAttribute) return;
          const sourceArray = attribute.array as ArrayLike<number> & {
              slice?: (from: number, to: number) => ArrayLike<number>;
            },
            from = start * attribute.itemSize,
            to = (start + count) * attribute.itemSize,
            sliced = sourceArray.slice
              ? sourceArray.slice(from, to)
              : Array.from(sourceArray).slice(from, to),
            ArrayType = attribute.array.constructor as new (
              values: ArrayLike<number>,
            ) => THREE.TypedArray;
          result.setAttribute(
            name,
            new THREE.BufferAttribute(
              new ArrayType(sliced),
              attribute.itemSize,
              attribute.normalized,
            ),
          );
        });
        if (source.index) nonIndexed.dispose();
        return result;
      };
      const groups = new Map<string, Piece[]>();
      batchPieces.forEach((piece) => {
        piece.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) child.castShadow = false;
        });
        const key = modelRenderKey(piece),
          group = groups.get(key) ?? [];
        group.push(piece);
        groups.set(key, group);
      });
      groups.forEach((pieces) => {
        // Instancing a single part cannot save a draw call and makes its
        // direct LDraw hierarchy unnecessarily diverge from the import
        // preview. Keep unique parts untouched; only repeated references are
        // worth batching.
        if (pieces.length < 2) return;
        // Network LDraw parts can come from different library revisions and
        // retain a deeper BFC/subpart hierarchy than the packaged geometry.
        // Keep that hierarchy direct; instancing is reserved for the uniform,
        // locally precached assets.
        if (
          pieces.some((piece) => piece.sourceKind !== "packaged-cache" || !piece.geometry)
        )
          return;
        const template = pieces[0];
        template.mesh.updateMatrixWorld(true);
        const templateMeshes: THREE.Mesh[] = [];
        template.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) templateMeshes.push(child);
        });
        if (!templateMeshes.length) return;
        const inverseWrapper = template.mesh.matrixWorld.clone().invert();
        let createdBatches = 0;
        templateMeshes.forEach((child) => {
          const materials = Array.isArray(child.material)
              ? child.material
              : [child.material],
            ranges =
              Array.isArray(child.material) && child.geometry.groups.length
                ? child.geometry.groups.map((group) => ({
                    start: group.start,
                    count: group.count,
                    material: materials[group.materialIndex ?? 0],
                  }))
                : [
                    {
                      start: 0,
                      count: child.geometry.index
                        ? child.geometry.index.count
                        : child.geometry.getAttribute("position").count,
                      material: materials[0],
                    },
                  ],
            localTransform = inverseWrapper.clone().multiply(child.matrixWorld);
          ranges.forEach(({ start, count, material }) => {
            if (!material || count <= 0) return;
            const geometry = cloneGeometryRange(child.geometry, start, count),
              instance = new THREE.InstancedMesh(geometry, material, pieces.length);
            instance.name = `${template.part} × ${pieces.length}`;
            instance.castShadow = false;
            instance.receiveShadow = true;
            instance.frustumCulled = false;
            instance.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            instance.userData.instancePieces = pieces;
            instance.userData.ownedBatchGeometry = true;
            instance.userData.ownedBatchMaterial = false;
            root.add(instance);
            state.renderBatchItems.push({
              mesh: instance,
              pieces,
              // Preserve the exact hierarchy transform used by the direct
              // preview. Baking and merging differently transformed LDraw
              // children can displace primitives in complex parts.
              localMatrix: localTransform.clone(),
            });
            createdBatches++;
          });
        });
        if (!createdBatches) return;
        pieces.forEach((piece) => {
          piece.mesh.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.visible = false;
              hiddenOriginalMeshes++;
            }
          });
          piece.renderBatched = true;
        });
      });
      state.renderBatchStats = {
        lineBatches: outlineBatchCount,
        meshBatches: state.renderBatchItems.length,
        hiddenOriginalLines,
        hiddenOriginalMeshes,
      };
      updateRenderBatches();
    };

    let renderBatchRebuildFrame = 0;
    const scheduleRenderBatchRebuild = () => {
      if (state.bulkLoading || state.running || renderBatchRebuildFrame) return;
      renderBatchRebuildFrame = requestAnimationFrame(() => {
        renderBatchRebuildFrame = 0;
        if (!state.bulkLoading && !state.running) state.rebuildRenderBatches();
      });
    };

    const recolorPart = async (piece: Piece, color: number) => {
      if (piece.color === color) return true;
      const sourceColor = piece.sourceColor ?? piece.color;
      try {
        const exact = await loadPartModel({
          ...piece,
          color,
          sourceColor,
        });
        if (!piece.embeddedGeometry) prepareModel(exact);
        exact.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.castShadow = true;
            object.receiveShadow = true;
          }
        });
        state.disposeRenderBatches();
        piece.mesh.clear();
        piece.mesh.add(exact);
        piece.color = color;
        piece.sourceColor = sourceColor;
        piece.mesh.updateMatrixWorld(true);
        state.rebuildRenderBatches();
        state.refreshDebug();
        return true;
      } catch {
        state.rebuildRenderBatches();
        return false;
      }
    };

    // --- Scene editing and connections -------------------------------------
    const addPart = async (
      p: CatalogPart,
      position: THREE.Vector3,
      rotation?: THREE.Quaternion,
    ) => {
      if (!state.bulkLoading) setMessage(`Cargando ${p.part}…`);
      try {
        const exact = await loadPartModel(p);
        preloaded.add(modelRenderKey(p));
        if (!p.embeddedGeometry) prepareModel(exact);
        exact.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.castShadow = true;
            object.receiveShadow = true;
          }
        });
        const wrapper = new THREE.Group();
        wrapper.add(exact);
        wrapper.position.copy(position);
        if (rotation) wrapper.quaternion.copy(rotation);
        wrapper.updateMatrixWorld(true);
        const { connectors, colliders, gearColliders } = analyzePart(wrapper, p),
          piece: Piece = {
            ...p,
            id: Date.now() + Math.random(),
            mesh: wrapper,
            connectors,
            colliders,
            gearColliders,
            gear: isGearPart(p),
            exactCollider: isDifferentialPart(p),
            fixed: false,
            pin: isPinPart(p),
            frictionPin: hasPinFriction(p),
            dynamicAxleConnections: isAxlePart(p),
          };
        wrapper.userData.piece = piece;
        wrapper.userData.connectorReach = connectorMapReach(connectors);
        wrapper.visible = !state.bulkLoading;
        state.pieces.push(piece);
        scene.add(wrapper);
        if (!rotation) {
          const box = new THREE.Box3().setFromObject(wrapper);
          wrapper.position.y -= box.min.y;
        }
        if (!state.bulkLoading) {
          setCount(state.pieces.length);
          setMessage(
            `${p.part} · ${connectors.length} conectores · ${colliders.length + gearColliders.length} formas físicas`,
          );
          refreshDebug();
          scheduleRenderBatchRebuild();
        }
        return piece;
      } catch {
        if (!state.bulkLoading) setMessage(`No se encontró ${p.part}.dat`);
        return null;
      }
    };
    Object.assign(state, {
      scene,
      renderer,
      camera,
      cameraTarget,
      floor,
      grid,
      gridStep,
      axleSnapStep,
      rotationSnapStep,
      pieces: [],
      connections: [],
      gearLinks: [],
      differentialLinks: [],
      gearAngles: new Map(),
      gearBodyRotations: new Map(),
      gearPhases: new Map(),
      sleepingBodyHandles: new Set(),
      physicsJoints: new Map(),
      dynamicNoContactPairs: new Set(),
      contactExclusions: new Set(),
      contactCandidates: new Map(),
      dynamicConnectionFrame: 0,
      connectionModes: new Map<
        string,
        {
          mode: JointMode;
          motorSpeed: number;
          motorForce: number;
          userConfigured: boolean;
        }
      >(),
      running: false,
      physicsSettings: { ...physicsSettings },
      performanceTrace: {
        startedAt: new Date().toISOString(),
        startedAtMs: performance.now(),
        samples: [],
        cursor: 0,
        totalFrames: 0,
      },
      pendingInputMs: 0,
      pendingConnectionMs: 0,
      connectionScanVersion: 0,
      renderScale,
      gpuTimerSupported: !!gpuTimerExtension,
      gpuRenderer,
      gpuVendor,
      renderBatchItems: [],
      renderBatchStats: {
        lineBatches: 0,
        meshBatches: 0,
        hiddenOriginalLines: 0,
        hiddenOriginalMeshes: 0,
      },
      renderBatchesDirty: false,
      addPart,
      preloadPart,
      recolorPart,
      renderImportPreview,
      rebuildRenderBatches,
      updateRenderBatches,
      disposeRenderBatches,
      debug: { colliders: false, connectors: false, physics: false },
      refreshDebug,
      updateDebug,
    });
    appRef.current = state;

    const isRod = (piece: Piece) =>
      isPinPart(piece) ||
      isAxlePart(piece) ||
      piece.connectors.some((connector) => connector.role === "shaft");
    const worldConnector = (host: Piece, connector: MeshConnector) => {
      host.mesh.updateMatrixWorld(true);
      return {
        point: host.mesh.localToWorld(connector.local.clone()),
        axis: connector.axis
          .clone()
          .transformDirection(host.mesh.matrixWorld)
          .normalize(),
      };
    };

    const nearestAxleSnapWorld = (
      host: Piece,
      connector: MeshConnector,
      target: THREE.Vector3,
      includeSecondary = true,
    ) => {
      host.mesh.updateMatrixWorld(true);
      return axleSnapPoints(connector, includeSecondary)
        .map((snap) => ({
          ...snap,
          world: host.mesh.localToWorld(snap.local.clone()),
        }))
        .sort(
          (left, right) =>
            left.world.distanceToSquared(target) - right.world.distanceToSquared(target),
        )[0];
    };

    const forceConnectorAxesCompatible = (
      sourcePiece: Piece,
      sourceConnector: MeshConnector,
      targetPiece: Piece,
      targetConnector: MeshConnector,
    ) => {
      const sourceAxis = worldConnector(sourcePiece, sourceConnector).axis,
        targetAxis = worldConnector(targetPiece, targetConnector).axis;
      // Both directions on the same line are valid. Crossing or oblique axes
      // cannot describe a physical pin/axle joint and must be rejected.
      return Math.abs(sourceAxis.dot(targetAxis)) >= 0.985;
    };

    const socketSurfaceHalfThickness = (host: Piece, socket: MeshConnector) => {
      const mapped = (socket.length ?? 0) / 2,
        nominal = isHalfBeamPart(host) ? 0.25 : 0.5;
      // Connection-map lengths win when present; otherwise LEGO's full/half
      // beam thickness gives the collider surface without traversing the mesh.
      return THREE.MathUtils.clamp(Math.max(mapped, nominal), 0.12, 0.6);
    };

    const addConnection = (
      host: Piece,
      rod: Piece,
      socket: MeshConnector,
      shaft: MeshConnector,
      preparedSocket?: {
        point: THREE.Vector3;
        axis: THREE.Vector3;
        localAxisA: THREE.Vector3;
      },
      forcedAnchors?: {
        pointA: THREE.Vector3;
        pointB: THREE.Vector3;
      },
    ) => {
      const profile = connectorProfile(shaft, socket);
      if (
        !profile ||
        state.connections.some(
          (connection) =>
            connection.a === host &&
            connection.b === rod &&
            connection.socket === socket &&
            connection.shaft === shaft,
        )
      )
        return false;
      const world = preparedSocket ?? worldConnector(host, socket),
        socketIndex = host.connectors.indexOf(socket),
        shaftIndex = rod.connectors.indexOf(shaft),
        id = `${host.id}:${socketIndex}:${rod.id}:${shaftIndex}:${profile}`,
        saved = state.connectionModes.get(id),
        mode =
          saved && allowedModes(profile).includes(saved.mode)
            ? saved.mode
            : defaultMode(profile),
        motorSpeed = saved?.motorSpeed ?? 3,
        motorForce = saved?.motorForce ?? 80,
        userConfigured = saved?.userConfigured ?? false;
      const addedConnection: Connection = {
        id,
        a: host,
        b: rod,
        socket,
        shaft,
        mode,
        profile,
        point: world.point.clone(),
        axis: world.axis.clone(),
        localAxisA:
          preparedSocket?.localAxisA.clone() ??
          world.axis
            .clone()
            .applyQuaternion(
              host.mesh.getWorldQuaternion(new THREE.Quaternion()).invert(),
            )
            .normalize(),
        travel: shaft.length ?? 0.5,
        motorSpeed,
        motorForce,
        userConfigured,
        forced: !!forcedAnchors,
        forcedOffset: forcedAnchors?.pointA.distanceTo(forcedAnchors.pointB),
        localPointA: forcedAnchors
          ? host.mesh.worldToLocal(forcedAnchors.pointA.clone())
          : undefined,
        localPointB: forcedAnchors
          ? rod.mesh.worldToLocal(forcedAnchors.pointB.clone())
          : undefined,
      };
      state.connections.push(addedConnection);
      ensurePieceRotationPivot(host, state.connections);
      ensurePieceRotationPivot(rod, state.connections);
      if (!state.bulkConnecting) rebalanceSmartDefaults(state, rod);
      return true;
    };

    const connectManual = (
      sourcePiece: Piece,
      sourceConnector: MeshConnector,
      sourceAnchorLocal: THREE.Vector3,
      targetPiece: Piece,
      targetConnector: MeshConnector,
      targetAnchorLocal: THREE.Vector3,
    ) => {
      const profile = pairProfile(sourceConnector, targetConnector);
      if (!profile) return false;
      const sourceWorld = worldConnector(sourcePiece, sourceConnector),
        targetConnectorWorld = worldConnector(targetPiece, targetConnector),
        targetWorld = {
          ...targetConnectorWorld,
          point: targetPiece.mesh.localToWorld(targetAnchorLocal.clone()),
        };
      let targetAxis = targetWorld.axis.clone();
      if (sourceWorld.axis.dot(targetAxis) < 0) targetAxis.negate();
      const alignment = new THREE.Quaternion().setFromUnitVectors(
        sourceWorld.axis,
        targetAxis,
      );
      sourcePiece.mesh.quaternion.premultiply(alignment).normalize();
      sourcePiece.mesh.updateMatrixWorld(true);
      const socket =
          sourceConnector.role === "socket" ? sourceConnector : targetConnector,
        shaft = sourceConnector.role === "shaft" ? sourceConnector : targetConnector,
        alignedSourceWorld = worldConnector(sourcePiece, sourceConnector),
        alignedSourcePoint = sourcePiece.mesh.localToWorld(sourceAnchorLocal.clone()),
        shaftWorld =
          sourceConnector.role === "shaft"
            ? { ...alignedSourceWorld, point: alignedSourcePoint }
            : targetWorld,
        socketWorld =
          sourceConnector.role === "socket"
            ? { ...alignedSourceWorld, point: alignedSourcePoint }
            : targetWorld,
        offset = closestConnectorOffset(
          shaft,
          socket,
          shaftWorld.point,
          socketWorld.point,
          targetAxis,
        ),
        sourceTarget = targetWorld.point
          .clone()
          .addScaledVector(
            targetAxis,
            sourceConnector.role === "shaft" ? offset : -offset,
          );
      sourcePiece.mesh.position.add(
        sourceTarget.sub(sourcePiece.mesh.localToWorld(sourceAnchorLocal.clone())),
      );
      sourcePiece.mesh.updateMatrixWorld(true);
      state.renderBatchesDirty = true;
      state.connections = state.connections.filter(
        (connection) => connection.a !== sourcePiece && connection.b !== sourcePiece,
      );
      rebalanceAllSmartDefaults(state);
      const socketPiece = sourceConnector.role === "socket" ? sourcePiece : targetPiece,
        socketConnector =
          sourceConnector.role === "socket" ? sourceConnector : targetConnector,
        shaftPiece = sourceConnector.role === "shaft" ? sourcePiece : targetPiece,
        shaftConnector =
          sourceConnector.role === "shaft" ? sourceConnector : targetConnector;
      return addConnection(socketPiece, shaftPiece, socketConnector, shaftConnector);
    };

    const connectForced = (
      sourcePiece: Piece,
      sourceConnector: MeshConnector,
      sourceAnchorLocal: THREE.Vector3,
      targetPiece: Piece,
      targetConnector: MeshConnector,
      targetAnchorLocal: THREE.Vector3,
    ) => {
      if (
        !pairProfile(sourceConnector, targetConnector) ||
        !forceConnectorAxesCompatible(
          sourcePiece,
          sourceConnector,
          targetPiece,
          targetConnector,
        )
      )
        return false;
      const sourcePoint = sourcePiece.mesh.localToWorld(sourceAnchorLocal.clone()),
        targetPoint = targetPiece.mesh.localToWorld(targetAnchorLocal.clone());
      if (sourcePoint.distanceTo(targetPoint) > 5) return false;
      const socketPiece = sourceConnector.role === "socket" ? sourcePiece : targetPiece,
        socketConnector =
          sourceConnector.role === "socket" ? sourceConnector : targetConnector,
        shaftPiece = sourceConnector.role === "shaft" ? sourcePiece : targetPiece,
        shaftConnector =
          sourceConnector.role === "shaft" ? sourceConnector : targetConnector,
        pointA = sourceConnector.role === "socket" ? sourcePoint : targetPoint,
        pointB = sourceConnector.role === "shaft" ? sourcePoint : targetPoint,
        socketWorld = worldConnector(socketPiece, socketConnector);
      return addConnection(
        socketPiece,
        shaftPiece,
        socketConnector,
        shaftConnector,
        {
          point: pointA.clone(),
          axis: socketWorld.axis.clone(),
          localAxisA: socketConnector.axis.clone().normalize(),
        },
        { pointA, pointB },
      );
    };

    type IndexedSocket = {
      host: Piece;
      socket: MeshConnector;
      point: THREE.Vector3;
      axis: THREE.Vector3;
      localAxisA: THREE.Vector3;
    };

    type IndexedShaft = {
      rod: Piece;
      shaft: MeshConnector;
      point: THREE.Vector3;
      axis: THREE.Vector3;
    };

    const connectionCellSize = 0.45,
      connectionCell = (point: THREE.Vector3) =>
        `${Math.floor(point.x / connectionCellSize)}:${Math.floor(point.y / connectionCellSize)}:${Math.floor(point.z / connectionCellSize)}`,
      buildConnectionIndex = (axleEndCapture = 0) => {
        const sockets: IndexedSocket[] = [],
          shaftGrid = new Map<string, IndexedShaft[]>(),
          addShaftCell = (key: string, entry: IndexedShaft) => {
            const entries = shaftGrid.get(key) ?? [];
            entries.push(entry);
            shaftGrid.set(key, entries);
          };
        state.pieces.forEach((piece) => {
          piece.mesh.updateMatrixWorld(true);
          piece.connectors.forEach((connector) => {
            const point = connector.local.clone().applyMatrix4(piece.mesh.matrixWorld),
              axis = connector.axis
                .clone()
                .transformDirection(piece.mesh.matrixWorld)
                .normalize();
            if (connector.role === "socket") {
              sockets.push({
                host: piece,
                socket: connector,
                point,
                axis,
                localAxisA: connector.axis.clone().normalize(),
              });
              return;
            }
            const entry: IndexedShaft = {
                rod: piece,
                shaft: connector,
                point,
                axis,
              },
              occupiedCells = new Set<string>();
            if (connector.kind !== "axle") occupiedCells.add(connectionCell(point));
            else {
              const half = (connector.length ?? 0.5) / 2 + 0.12 + axleEndCapture,
                steps = Math.max(1, Math.ceil((half * 2) / (connectionCellSize * 0.5)));
              for (let step = 0; step <= steps; step++)
                occupiedCells.add(
                  connectionCell(
                    point
                      .clone()
                      .addScaledVector(axis, -half + (step / steps) * half * 2),
                  ),
                );
            }
            occupiedCells.forEach((key) => addShaftCell(key, entry));
          });
        });
        return { sockets, shaftGrid };
      },
      nearbyShafts = (
        grid: Map<string, IndexedShaft[]>,
        point: THREE.Vector3,
        found: Set<IndexedShaft>,
      ) => {
        const x = Math.floor(point.x / connectionCellSize),
          y = Math.floor(point.y / connectionCellSize),
          z = Math.floor(point.z / connectionCellSize);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dz = -1; dz <= 1; dz++)
              grid
                .get(`${x + dx}:${y + dy}:${z + dz}`)
                ?.forEach((entry) => found.add(entry));
      },
      scanSocketOnce = (
        candidateSocket: IndexedSocket,
        grid: Map<string, IndexedShaft[]>,
        axleEndCapture = 0,
      ) => {
        const candidates = new Set<IndexedShaft>();
        nearbyShafts(grid, candidateSocket.point, candidates);
        let best: { candidate: IndexedShaft; score: number } | undefined;
        candidates.forEach((candidate) => {
          const { rod, shaft, point, axis } = candidate,
            profile = connectorProfile(shaft, candidateSocket.socket);
          if (!profile || rod === candidateSocket.host) return;
          if (Math.abs(candidateSocket.axis.dot(axis)) < 0.965) return;
          let score: number;
          if (shaft.kind !== "axle") {
            const delta = point.clone().sub(candidateSocket.point),
              along = delta.dot(axis),
              radial = delta.clone().addScaledVector(axis, -along).length(),
              axialError = Math.min(
                ...connectorAxialOffsets(shaft, candidateSocket.socket).map((offset) =>
                  Math.abs(along - offset),
                ),
              );
            if (radial > 0.16 || axialError > 0.1) return;
            score = radial + axialError;
          } else {
            const half = (shaft.length ?? 0.5) / 2,
              delta = candidateSocket.point.clone().sub(point),
              along = delta.dot(axis),
              radial = delta.clone().addScaledVector(axis, -along).length(),
              // Round and half-round sockets may capture an axle just before
              // its tip enters from either side. Cross holes remain strict.
              entranceCapture =
                candidateSocket.socket.kind === "axle" || !axleEndCapture
                  ? 0
                  : socketSurfaceHalfThickness(
                      candidateSocket.host,
                      candidateSocket.socket,
                    ) + 0.06;
            if (
              radial > (entranceCapture ? 0.13 : 0.16) ||
              Math.abs(along) > half + 0.1 + entranceCapture
            )
              return;
            score = radial + Math.abs(along) * 0.0001;
          }
          if (!best || score < best.score) best = { candidate, score };
        });
        if (!best) return;
        addConnection(
          candidateSocket.host,
          best.candidate.rod,
          candidateSocket.socket,
          best.candidate.shaft,
          {
            point: candidateSocket.point,
            axis: candidateSocket.axis,
            localAxisA: candidateSocket.localAxisA,
          },
        );
      },
      finishConnectionScan = () => {
        state.bulkConnecting = false;
        rebalanceAllSmartDefaults(state);
        state.pieces.forEach((piece) =>
          ensurePieceRotationPivot(piece, state.connections),
        );
        setConnectionRevision((value) => value + 1);
        refreshDebug();
        return state.connections.length;
      };
    const verifyConnections = () => {
      if (!AUTO_CONNECTIONS_ENABLED) {
        state.connectionScanVersion++;
        state.bulkConnecting = false;
        setConnectionRevision((value) => value + 1);
        refreshDebug();
        return state.connections.length;
      }
      const started = performance.now();
      state.connectionScanVersion++;
      state.connections = state.connections.filter((connection) => connection.forced);
      state.bulkConnecting = true;
      const { sockets, shaftGrid } = buildConnectionIndex();
      sockets.forEach((socket) => scanSocketOnce(socket, shaftGrid));
      const result = finishConnectionScan();
      state.pendingConnectionMs += performance.now() - started;
      return result;
    };

    const verifyConnectionsAsync = async () => {
      if (!AUTO_CONNECTIONS_ENABLED) return state.connections.length;
      const scanVersion = ++state.connectionScanVersion;
      let operationStarted = performance.now();
      state.connections = state.connections.filter((connection) => connection.forced);
      state.bulkConnecting = true;
      const { sockets, shaftGrid } = buildConnectionIndex();
      state.pendingConnectionMs += performance.now() - operationStarted;
      let sliceStarted = performance.now();
      for (let index = 0; index < sockets.length; index++) {
        if (scanVersion !== state.connectionScanVersion) return state.connections.length;
        operationStarted = performance.now();
        scanSocketOnce(sockets[index], shaftGrid);
        state.pendingConnectionMs += performance.now() - operationStarted;
        if (performance.now() - sliceStarted >= 6) {
          setMessage(
            language === "es"
              ? `Conectando nodos ${index + 1}/${sockets.length}…`
              : `Connecting nodes ${index + 1}/${sockets.length}…`,
          );
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          sliceStarted = performance.now();
        }
      }
      operationStarted = performance.now();
      const result = finishConnectionScan();
      state.pendingConnectionMs += performance.now() - operationStarted;
      return result;
    };
    state.verifyConnections = verifyConnections;
    state.verifyConnectionsAsync = verifyConnectionsAsync;
    const verifyPieceConnections = (movedPiece: Piece) => {
      const started = performance.now(),
        previousPartners = state.connections
          .filter(
            (connection) => connection.a === movedPiece || connection.b === movedPiece,
          )
          .map((connection) =>
            connection.a === movedPiece ? connection.b : connection.a,
          );
      state.connections = state.connections.filter(
        (connection) => connection.a !== movedPiece && connection.b !== movedPiece,
      );
      state.bulkConnecting = true;
      const tryPair = (
        socketPiece: Piece,
        socket: MeshConnector,
        shaftPiece: Piece,
        shaft: MeshConnector,
      ) => {
        if (!connectorProfile(shaft, socket)) return;
        const socketWorld = worldConnector(socketPiece, socket),
          shaftWorld = worldConnector(shaftPiece, shaft);
        if (Math.abs(socketWorld.axis.dot(shaftWorld.axis)) < 0.965) return;
        const delta = socketWorld.point.clone().sub(shaftWorld.point),
          along = delta.dot(shaftWorld.axis),
          radial = delta.clone().addScaledVector(shaftWorld.axis, -along).length();
        if (shaft.kind === "axle") {
          if (radial > 0.16 || Math.abs(along) > (shaft.length ?? 0.5) / 2 + 0.1) return;
        } else {
          const axialError = Math.min(
            ...connectorAxialOffsets(shaft, socket).map((offset) =>
              Math.abs(along - offset),
            ),
          );
          if (radial > 0.16 || axialError > 0.1) return;
        }
        addConnection(socketPiece, shaftPiece, socket, shaft, {
          point: socketWorld.point,
          axis: socketWorld.axis,
          localAxisA: socket.axis.clone().normalize(),
        });
      };
      const movedReach =
        (movedPiece.mesh.userData.connectorReach as number | undefined) ??
        connectorMapReach(movedPiece.connectors);
      for (const other of state.pieces) {
        if (other === movedPiece) continue;
        // A cheap piece-level rejection prevents connector work for nearly all
        // distant parts in a large imported assembly.
        const centerDistance = movedPiece.mesh.position.distanceTo(other.mesh.position);
        const otherReach =
            (other.mesh.userData.connectorReach as number | undefined) ??
            connectorMapReach(other.connectors),
          maximumReach = movedReach + otherReach + 0.35;
        if (centerDistance > maximumReach) continue;
        for (const movedConnector of movedPiece.connectors)
          for (const otherConnector of other.connectors) {
            if (movedConnector.role === "socket" && otherConnector.role === "shaft")
              tryPair(movedPiece, movedConnector, other, otherConnector);
            else if (movedConnector.role === "shaft" && otherConnector.role === "socket")
              tryPair(other, otherConnector, movedPiece, movedConnector);
          }
      }
      state.bulkConnecting = false;
      rebalanceAllSmartDefaults(state);
      ensurePieceRotationPivot(movedPiece, state.connections);
      previousPartners.forEach((piece) =>
        ensurePieceRotationPivot(piece, state.connections),
      );
      state.pendingConnectionMs += performance.now() - started;
      setConnectionRevision((value) => value + 1);
      refreshDebug();
      return state.connections.length;
    };

    const updateDynamicMechanisms = () => {
      const dynamicScanStarted = performance.now();
      state.differentialLinks = detectDifferentialLinks(
        state.pieces,
        state.rigidIslandByPiece,
      );
      // Dynamic detection observes the meshes in their current world pose.
      // Store the axes in the body's reference frame, matching gear links,
      // otherwise the body's rotation would be applied twice on the next step.
      state.differentialLinks.forEach((link) => {
        for (const [piece, axis] of [
          [link.carrier, link.axisCarrier],
          [link.left, link.axisLeft],
          [link.right, link.axisRight],
        ] as [Piece, THREE.Vector3][]) {
          const rotation = piece.body?.rotation();
          if (!rotation) continue;
          axis
            .applyQuaternion(
              new THREE.Quaternion(
                rotation.x,
                rotation.y,
                rotation.z,
                rotation.w,
              ).invert(),
            )
            .normalize();
        }
      });
      const differentialExclusions = differentialPairKeys(state.differentialLinks),
        previousGearLinks = state.gearLinks.length,
        previousLinksByKey = new Map(
          state.gearLinks.map((link) => [gearLinkKey(link), link]),
        ),
        detectedGearLinks = detectGearLinks(
          state.pieces,
          state.rigidIslandByPiece,
          differentialExclusions,
        );
      // Dynamic overlap scans must not redefine the reference axes or the
      // transmission direction of a pair that is already engaged. On bevel
      // gears a numerically ambiguous tangent can otherwise flip sign between
      // scans; the phase solver then sees a 240-unit error and injects a
      // 20-rad/s kick into a 12-tooth gear.
      detectedGearLinks.forEach((link) => {
        const previous = previousLinksByKey.get(gearLinkKey(link));
        if (!previous) {
          for (const [piece, axis] of [
            [link.a.value, link.axisA],
            [link.b.value, link.axisB],
          ] as [Piece, THREE.Vector3][]) {
            const rotation = piece.body?.rotation();
            if (!rotation) continue;
            axis
              .applyQuaternion(
                new THREE.Quaternion(
                  rotation.x,
                  rotation.y,
                  rotation.z,
                  rotation.w,
                ).invert(),
              )
              .normalize();
          }
          return;
        }
        const sameOrder = previous.a.value === link.a.value;
        link.axisA.copy(sameOrder ? previous.axisA : previous.axisB);
        link.axisB.copy(sameOrder ? previous.axisB : previous.axisA);
        link.signB = previous.signB;
        link.perpendicular = previous.perpendicular;
        link.ratio = -link.a.spec.teeth / (link.signB * link.b.spec.teeth);
      });
      state.gearLinks = detectedGearLinks;
      const activeGearKeys = new Set(state.gearLinks.map(gearLinkKey));
      for (const key of state.gearPhases.keys())
        if (!activeGearKeys.has(key)) state.gearPhases.delete(key);
      if (state.simLog && previousGearLinks !== state.gearLinks.length)
        state.simLog.events.push(
          `Engranajes dinámicos: ${previousGearLinks} → ${state.gearLinks.length} enlaces`,
        );
      if (!state.world || !state.createPhysicsJoint) {
        state.pendingConnectionMs += performance.now() - dynamicScanStarted;
        return;
      }

      let changed = previousGearLinks !== state.gearLinks.length;
      const retained: Connection[] = [],
        removedPairs: { a: Piece; b: Piece }[] = [];
      for (const connection of state.connections) {
        const dynamicAxle =
          !connection.forced &&
          (connection.profile === "axle-cross" || connection.profile === "axle-round") &&
          connection.b.dynamicAxleConnections;
        if (!dynamicAxle) {
          retained.push(connection);
          continue;
        }
        const socketWorld = worldConnector(connection.a, connection.socket),
          shaftWorld = worldConnector(connection.b, connection.shaft),
          alignment = Math.abs(socketWorld.axis.dot(shaftWorld.axis)),
          delta = socketWorld.point.clone().sub(shaftWorld.point),
          along = delta.dot(shaftWorld.axis),
          radial = delta.clone().addScaledVector(shaftWorld.axis, -along).length(),
          halfShaft = (connection.shaft.length ?? 0.5) / 2,
          entranceAllowance =
            connection.socket.kind === "axle"
              ? 0.12
              : socketSurfaceHalfThickness(connection.a, connection.socket) + 0.08,
          engaged =
            alignment >= 0.94 &&
            radial <= 0.2 &&
            Math.abs(along) <= halfShaft + entranceAllowance;
        if (engaged) {
          retained.push(connection);
          continue;
        }
        const joint = state.physicsJoints.get(connection.id);
        if (joint) {
          state.world.removeImpulseJoint(joint, true);
          state.physicsJoints.delete(connection.id);
        }
        state.connectionModes.set(connection.id, {
          mode: connection.mode,
          motorSpeed: connection.motorSpeed,
          motorForce: connection.motorForce,
          userConfigured: connection.userConfigured,
        });
        changed = true;
        removedPairs.push({ a: connection.a, b: connection.b });
        state.simLog?.events.push(
          `Eje desconectado dinámicamente: ${connection.b.part} ↔ ${connection.a.part}`,
        );
      }
      state.connections = retained;
      removedPairs.forEach(({ a, b }) => {
        const stillConnected = retained.some(
          (connection) =>
            (connection.a === a && connection.b === b) ||
            (connection.a === b && connection.b === a),
        );
        if (!stillConnected) state.dynamicNoContactPairs.delete(contactPairKey(a, b));
      });

      const existingIds = new Set(state.connections.map((connection) => connection.id));
      state.bulkConnecting = true;
      for (const pair of state.contactCandidates.values())
        for (const [rod, host] of [
          [pair.a, pair.b],
          [pair.b, pair.a],
        ] as [Piece, Piece][]) {
          if (!rod.dynamicAxleConnections) continue;
          for (const shaft of rod.connectors.filter(
            (connector) => connector.role === "shaft" && connector.kind === "axle",
          )) {
            const shaftWorld = worldConnector(rod, shaft),
              halfShaft = (shaft.length ?? 0.5) / 2;
            for (const socket of host.connectors.filter(
              (connector) => connector.role === "socket",
            )) {
              if (!connectorProfile(shaft, socket)) continue;
              const socketWorld = worldConnector(host, socket),
                alignment = Math.abs(socketWorld.axis.dot(shaftWorld.axis));
              if (alignment < 0.94) continue;
              const delta = socketWorld.point.clone().sub(shaftWorld.point),
                along = delta.dot(shaftWorld.axis),
                radial = delta.clone().addScaledVector(shaftWorld.axis, -along).length(),
                surface = socketSurfaceHalfThickness(host, socket);
              if (radial > 0.16 || Math.abs(along) > halfShaft + surface + 0.12) continue;
              addConnection(host, rod, socket, shaft, {
                point: socketWorld.point,
                axis: socketWorld.axis,
                localAxisA: socket.axis.clone().normalize(),
              });
            }
          }
        }
      state.contactCandidates.clear();
      state.bulkConnecting = false;
      const hasNewConnections = state.connections.some(
        (connection) => !existingIds.has(connection.id),
      );
      if (hasNewConnections) rebalanceAllSmartDefaults(state);
      const accepted: Connection[] = [];
      for (const connection of state.connections) {
        if (existingIds.has(connection.id)) {
          accepted.push(connection);
          continue;
        }
        const dynamicAxle =
          (connection.profile === "axle-cross" || connection.profile === "axle-round") &&
          connection.b.dynamicAxleConnections;
        if (!dynamicAxle) continue;
        accepted.push(connection);
        state.dynamicNoContactPairs.add(contactPairKey(connection.a, connection.b));
        const hostBody = connection.a.body,
          axleBody = connection.b.body;
        if (hostBody && axleBody && hostBody !== axleBody) {
          const axis = worldConnector(connection.a, connection.socket).axis,
            hostVelocity = hostBody.linvel(),
            axleVelocity = axleBody.linvel(),
            relativeAxial = THREE.MathUtils.clamp(
              (axleVelocity.x - hostVelocity.x) * axis.x +
                (axleVelocity.y - hostVelocity.y) * axis.y +
                (axleVelocity.z - hostVelocity.z) * axis.z,
              -3,
              3,
            ),
            hostAngular = hostBody.angvel(),
            axleAngular = axleBody.angvel(),
            relativeSpin = THREE.MathUtils.clamp(
              (axleAngular.x - hostAngular.x) * axis.x +
                (axleAngular.y - hostAngular.y) * axis.y +
                (axleAngular.z - hostAngular.z) * axis.z,
              -14,
              14,
            );
          axleBody.setLinvel(
            {
              x: hostVelocity.x + axis.x * relativeAxial,
              y: hostVelocity.y + axis.y * relativeAxial,
              z: hostVelocity.z + axis.z * relativeAxial,
            },
            true,
          );
          axleBody.setAngvel(
            {
              x: hostAngular.x + axis.x * relativeSpin,
              y: hostAngular.y + axis.y * relativeSpin,
              z: hostAngular.z + axis.z * relativeSpin,
            },
            true,
          );
        }
        state.createPhysicsJoint(connection);
        changed = true;
        state.simLog?.events.push(
          `Eje conectado dinámicamente: ${connection.b.part} ↔ ${connection.a.part}`,
        );
      }
      state.connections = accepted;
      if (changed && state.rigidIslandByPiece) {
        const refreshed = buildConnectorContactExclusions(
          state.connections,
          state.rigidIslandByPiece,
          detectShaftTraversals(state.pieces),
        );
        state.contactExclusions.clear();
        refreshed.forEach((key) => state.contactExclusions.add(key));
        differentialExclusions.forEach((key) => state.contactExclusions.add(key));
      }
      if (changed) {
        setConnectionRevision((value) => value + 1);
        refreshDebug();
      }
      state.pendingConnectionMs += performance.now() - dynamicScanStarted;
    };

    const connect = (piece: Piece) => {
      if (!AUTO_CONNECTIONS_ENABLED) return;
      if (isRod(piece)) {
        type Match = {
          host: Piece;
          socket: MeshConnector;
          shaft: MeshConnector;
          score: number;
        };
        let best: Match | undefined;
        for (const host of state.pieces.filter((part) => part !== piece))
          for (const socket of host.connectors.filter(
            (connector) => connector.role === "socket",
          ))
            for (const shaft of piece.connectors.filter(
              (connector) => connector.role === "shaft",
            )) {
              if (!connectorProfile(shaft, socket)) continue;
              const socketWorld = worldConnector(host, socket),
                shaftWorld = worldConnector(piece, shaft),
                axis = shaftWorld.axis;
              let score: number;
              if (shaft.kind !== "axle") {
                const delta = shaftWorld.point.clone().sub(socketWorld.point),
                  along = delta.dot(axis),
                  radial = delta.clone().addScaledVector(axis, -along).length(),
                  axialError = Math.min(
                    ...connectorAxialOffsets(shaft, socket).map((offset) =>
                      Math.abs(along - offset),
                    ),
                  );
                score = radial + axialError;
              } else {
                const delta = socketWorld.point.clone().sub(shaftWorld.point),
                  along = delta.dot(axis),
                  radial = delta.clone().addScaledVector(axis, -along).length();
                score = radial + Math.max(0, Math.abs(along) - (shaft.length ?? 0.5) / 2);
              }
              if (score < 0.75 && (!best || score < best.score))
                best = { host, socket, shaft, score };
            }
        if (best) {
          let targetAxis = worldConnector(best.host, best.socket).axis,
            currentAxis = worldConnector(piece, best.shaft).axis;
          if (currentAxis.dot(targetAxis) < 0) targetAxis = targetAxis.clone().negate();
          const alignment = new THREE.Quaternion().setFromUnitVectors(
            currentAxis,
            targetAxis,
          );
          piece.mesh.quaternion.premultiply(alignment).normalize();
          piece.mesh.updateMatrixWorld(true);
          const socketPoint = worldConnector(best.host, best.socket).point;
          if (best.shaft.kind !== "axle") {
            const shaftPoint = worldConnector(piece, best.shaft).point,
              offset = closestConnectorOffset(
                best.shaft,
                best.socket,
                shaftPoint,
                socketPoint,
                targetAxis,
              ),
              targetShaftPoint = socketPoint.clone().addScaledVector(targetAxis, offset);
            piece.mesh.position.add(targetShaftPoint.sub(shaftPoint));
          } else {
            const snap = nearestAxleSnapWorld(piece, best.shaft, socketPoint);
            if (snap) piece.mesh.position.add(socketPoint.clone().sub(snap.world));
          }
          piece.mesh.updateMatrixWorld(true);
          return;
        }
      }
      type HostMatch = {
        rod: Piece;
        socket: MeshConnector;
        shaft: MeshConnector;
        score: number;
      };
      let best: HostMatch | undefined;
      for (const rod of state.pieces.filter(
        (candidate) => candidate !== piece && isRod(candidate),
      ))
        for (const socket of piece.connectors.filter(
          (connector) => connector.role === "socket",
        ))
          for (const shaft of rod.connectors.filter(
            (connector) => connector.role === "shaft",
          )) {
            if (!connectorProfile(shaft, socket)) continue;
            const socketWorld = worldConnector(piece, socket),
              shaftWorld = worldConnector(rod, shaft),
              axis = shaftWorld.axis;
            let score: number;
            if (shaft.kind !== "axle") {
              const delta = shaftWorld.point.clone().sub(socketWorld.point),
                along = delta.dot(axis),
                radial = delta.clone().addScaledVector(axis, -along).length(),
                axialError = Math.min(
                  ...connectorAxialOffsets(shaft, socket).map((offset) =>
                    Math.abs(along - offset),
                  ),
                );
              score = radial + axialError;
            } else {
              const delta = socketWorld.point.clone().sub(shaftWorld.point),
                along = delta.dot(axis),
                radial = delta.clone().addScaledVector(axis, -along).length();
              score = radial + Math.max(0, Math.abs(along) - (shaft.length ?? 0.5) / 2);
            }
            if (score < 0.75 && (!best || score < best.score))
              best = { rod, socket, shaft, score };
          }
      if (!best) return;
      let targetAxis = worldConnector(best.rod, best.shaft).axis,
        currentAxis = best.socket.axis
          .clone()
          .transformDirection(piece.mesh.matrixWorld)
          .normalize();
      if (currentAxis.dot(targetAxis) < 0) targetAxis = targetAxis.clone().negate();
      const alignment = new THREE.Quaternion().setFromUnitVectors(
        currentAxis,
        targetAxis,
      );
      piece.mesh.quaternion.premultiply(alignment).normalize();
      piece.mesh.updateMatrixWorld(true);
      const socketPoint = worldConnector(piece, best.socket).point;
      if (best.shaft.kind !== "axle") {
        const shaftPoint = worldConnector(best.rod, best.shaft).point,
          offset = closestConnectorOffset(
            best.shaft,
            best.socket,
            shaftPoint,
            socketPoint,
            targetAxis,
          ),
          targetSocketPoint = shaftPoint.clone().addScaledVector(targetAxis, -offset);
        piece.mesh.position.add(targetSocketPoint.sub(socketPoint));
      } else {
        const snap = nearestAxleSnapWorld(best.rod, best.shaft, socketPoint);
        if (snap) piece.mesh.position.add(snap.world.clone().sub(socketPoint));
      }
      piece.mesh.updateMatrixWorld(true);
    };

    const ray = new THREE.Raycaster(),
      pointer = new THREE.Vector2();
    let orbit = false,
      pan = false,
      moved = false,
      shiftHeld = false,
      rotationPivotHeld = false,
      moving: Piece | undefined,
      movingPrepared = false,
      altCandidate: Piece | undefined,
      previous = { x: 0, y: 0 },
      orbitStart = { x: 0, y: 0 },
      moveOffset = new THREE.Vector2(),
      movingStartPosition = new THREE.Vector3(),
      movingStartPointer = new THREE.Vector2(),
      movingLinearAxis: THREE.Vector3 | undefined,
      movedAxially = false;
    let pivotRotate:
      | {
          piece: Piece;
          local: THREE.Vector3;
          axis: THREE.Vector3;
          connector: MeshConnector;
          connection: Connection;
          startX: number;
          startAbsoluteAngle: number;
          startPosition: THREE.Vector3;
          startQuaternion: THREE.Quaternion;
          lastAppliedAngle: number;
          prepared: boolean;
        }
      | undefined;
    let lastMiddleDown = { time: 0, x: 0, y: 0 };
    let spring:
      | {
          piece: Piece;
          component: Piece[];
          anchor: THREE.Vector3;
          target: THREE.Vector3;
          plane: THREE.Plane;
          overlay: SVGSVGElement;
          line: SVGPolylineElement;
          label: HTMLDivElement;
          cursorScreen: { x: number; y: number };
          force: number;
        }
      | undefined;
    const cast = (e: { clientX: number; clientY: number }) => {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      ray.setFromCamera(pointer, camera);
    };

    const nearestScreenConnector = (
      piece: Piece,
      e: { clientX: number; clientY: number },
    ) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      piece.mesh.updateMatrixWorld(true);
      return piece.connectors
        .flatMap((connector) => {
          const anchors =
            connector.role === "shaft" && connector.kind === "axle"
              ? axleSnapPoints(connector)
              : [{ local: connector.local, important: true }];
          return anchors.map((anchor) => {
            const projected = piece.mesh
                .localToWorld(anchor.local.clone())
                .project(camera),
              x = bounds.left + ((projected.x + 1) * bounds.width) / 2,
              y = bounds.top + ((1 - projected.y) * bounds.height) / 2;
            return {
              connector,
              anchorLocal: anchor.local.clone(),
              distance: Math.hypot(x - e.clientX, y - e.clientY),
            };
          });
        })
        .sort((a, b) => a.distance - b.distance)[0];
    };

    const nearestConnectedPivot = (
      piece: Piece,
      e: { clientX: number; clientY: number },
    ) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      piece.mesh.updateMatrixWorld(true);
      return state.connections
        .filter((connection) => connection.a === piece || connection.b === piece)
        .map((connection) => {
          const connector = connection.a === piece ? connection.socket : connection.shaft,
            socketPoint = worldConnector(connection.a, connection.socket).point,
            anchorLocal = piece.mesh.worldToLocal(socketPoint.clone()),
            projected = socketPoint.clone().project(camera),
            x = bounds.left + ((projected.x + 1) * bounds.width) / 2,
            y = bounds.top + ((1 - projected.y) * bounds.height) / 2;
          return {
            connection,
            connector,
            anchorLocal,
            distance: Math.hypot(x - e.clientX, y - e.clientY),
          };
        })
        .sort((a, b) => a.distance - b.distance)[0];
    };

    const nearbyPivotConnectionCorrection = (draft: {
      piece: Piece;
      local: THREE.Vector3;
      axis: THREE.Vector3;
      connector: MeshConnector;
      connection: Connection;
    }) => {
      draft.piece.mesh.updateMatrixWorld(true);
      const pivotSupport =
          draft.connection.a === draft.piece ? draft.connection.b : draft.connection.a,
        pivotTargetConnector =
          draft.connection.a === draft.piece
            ? draft.connection.shaft
            : draft.connection.socket,
        supportPieces = new Set<Piece>([pivotSupport]),
        supportQueue = [pivotSupport];
      while (supportQueue.length) {
        const current = supportQueue.shift()!;
        for (const connection of state.connections) {
          const next =
            connection.a === current
              ? connection.b
              : connection.b === current
                ? connection.a
                : undefined;
          if (next && next !== draft.piece && !supportPieces.has(next)) {
            supportPieces.add(next);
            supportQueue.push(next);
          }
        }
      }
      const candidatePieces = [...state.pieces].sort(
          (left, right) =>
            Number(supportPieces.has(right)) - Number(supportPieces.has(left)),
        ),
        pivotWorld = draft.piece.mesh.localToWorld(draft.local.clone()),
        pivotAxisWorld = draft.axis
          .clone()
          .transformDirection(draft.piece.mesh.matrixWorld)
          .normalize(),
        maximumCorrection = THREE.MathUtils.degToRad(12);
      let best: { angle: number; other: Piece; score: number } | undefined;
      for (const sourceConnector of draft.piece.connectors) {
        if (sourceConnector === draft.connector) continue;
        const sourceAnchors =
          sourceConnector.role === "shaft" && sourceConnector.kind === "axle"
            ? axleSnapPoints(sourceConnector).map((point) => point.local)
            : [sourceConnector.local];
        for (const other of candidatePieces) {
          if (other === draft.piece) continue;
          other.mesh.updateMatrixWorld(true);
          for (const targetConnector of other.connectors) {
            if (other === pivotSupport && targetConnector === pivotTargetConnector)
              continue;
            const profile = pairProfile(sourceConnector, targetConnector);
            if (!profile) continue;
            const targetAnchors =
              targetConnector.role === "shaft" && targetConnector.kind === "axle"
                ? axleSnapPoints(targetConnector).map((point) => point.local)
                : [targetConnector.local];
            for (const sourceLocal of sourceAnchors)
              for (const targetLocal of targetAnchors) {
                const sourcePoint = draft.piece.mesh.localToWorld(sourceLocal.clone()),
                  targetPoint = other.mesh.localToWorld(targetLocal.clone()),
                  sourceRadius = sourcePoint
                    .clone()
                    .sub(pivotWorld)
                    .addScaledVector(
                      pivotAxisWorld,
                      -sourcePoint.clone().sub(pivotWorld).dot(pivotAxisWorld),
                    ),
                  targetRadius = targetPoint
                    .clone()
                    .sub(pivotWorld)
                    .addScaledVector(
                      pivotAxisWorld,
                      -targetPoint.clone().sub(pivotWorld).dot(pivotAxisWorld),
                    );
                if (
                  sourceRadius.lengthSq() < 1e-5 ||
                  targetRadius.lengthSq() < 1e-5 ||
                  Math.abs(sourceRadius.length() - targetRadius.length()) > 0.22
                )
                  continue;
                const angle = Math.atan2(
                  pivotAxisWorld.dot(sourceRadius.clone().cross(targetRadius)),
                  sourceRadius.dot(targetRadius),
                );
                if (Math.abs(angle) > maximumCorrection) continue;
                const correction = new THREE.Quaternion().setFromAxisAngle(
                    pivotAxisWorld,
                    angle,
                  ),
                  predictedSourcePoint = sourcePoint
                    .clone()
                    .sub(pivotWorld)
                    .applyQuaternion(correction)
                    .add(pivotWorld),
                  predictedSourceAxis = worldConnector(
                    draft.piece,
                    sourceConnector,
                  ).axis.applyQuaternion(correction),
                  targetAxis = worldConnector(other, targetConnector).axis;
                if (Math.abs(predictedSourceAxis.dot(targetAxis)) < 0.965) continue;
                const shaft =
                    sourceConnector.role === "shaft" ? sourceConnector : targetConnector,
                  socket =
                    sourceConnector.role === "socket" ? sourceConnector : targetConnector,
                  shaftPoint =
                    sourceConnector.role === "shaft" ? predictedSourcePoint : targetPoint,
                  socketPoint =
                    sourceConnector.role === "socket"
                      ? predictedSourcePoint
                      : targetPoint,
                  shaftAxis =
                    sourceConnector.role === "shaft" ? predictedSourceAxis : targetAxis,
                  delta = socketPoint.clone().sub(shaftPoint),
                  along = delta.dot(shaftAxis),
                  radial = delta.clone().addScaledVector(shaftAxis, -along).length(),
                  axialError =
                    shaft.kind === "axle"
                      ? Math.max(0, Math.abs(along) - (shaft.length ?? 0.5) / 2)
                      : Math.min(
                          ...connectorAxialOffsets(shaft, socket).map((offset) =>
                            Math.abs(along - offset),
                          ),
                        );
                if (radial > 0.18 || axialError > 0.14) continue;
                const score =
                  radial +
                  axialError +
                  Math.abs(angle) * 0.04 +
                  (supportPieces.has(other) ? 0 : 0.025);
                if (!best || score < best.score) best = { angle, other, score };
              }
          }
        }
      }
      return best;
    };

    const updateManualForceMode = (forced: boolean) => {
      const draft = state.manualConnect;
      if (!draft || draft.forced === forced) return;
      draft.forced = forced;
      (draft.line.material as THREE.LineBasicMaterial).color.setHex(
        forced ? 0xff2d2d : 0xffee38,
      );
      draft.label.textContent = forced ? t.forceConnect : "CONNECT";
      draft.label.classList.toggle("forced", forced);
      setMessage(
        forced
          ? language === "es"
            ? "Force Connect: las piezas no se moverán"
            : "Force Connect: parts will not be moved"
          : language === "es"
            ? "Connect manual normal"
            : "Normal manual Connect",
      );
    };

    const pieceFrom = (object: THREE.Object3D, instanceId?: number) => {
      const instancePieces = object.userData.instancePieces as Piece[] | undefined;
      if (instancePieces && instanceId !== undefined) return instancePieces[instanceId];
      let o: THREE.Object3D | null = object;
      while (o) {
        if (o.userData.piece) return o.userData.piece as Piece;
        o = o.parent;
      }
      return undefined;
    };

    const pickPiece = () => {
      let best: { piece: Piece; point: THREE.Vector3; distance: number } | undefined;
      const visualHits = ray.intersectObjects(
        [
          ...state.pieces
            .filter((piece) => !piece.renderBatched)
            .map((piece) => piece.mesh),
          ...(state.renderBatchRoot ? [state.renderBatchRoot] : []),
        ],
        true,
      );
      for (const candidate of visualHits) {
        const piece = pieceFrom(
          candidate.object,
          candidate.instanceId ??
            (candidate as THREE.Intersection & { batchId?: number }).batchId,
        );
        if (piece) {
          best = {
            piece,
            point: candidate.point.clone(),
            distance: candidate.distance,
          };
          break;
        }
      }
      if (best) return best;
      const unitScale = new THREE.Vector3(1, 1, 1);
      for (const piece of state.pieces) {
        piece.mesh.updateMatrixWorld(true);
        for (const primitive of piece.colliders) {
          const primitiveMatrix = piece.mesh.matrixWorld
              .clone()
              .multiply(
                new THREE.Matrix4().compose(
                  primitive.center,
                  primitive.rotation,
                  unitScale,
                ),
              ),
            inverse = primitiveMatrix.clone().invert(),
            localRay = new THREE.Ray(
              ray.ray.origin.clone().applyMatrix4(inverse),
              ray.ray.direction.clone().transformDirection(inverse),
            ),
            halfSize =
              primitive.shape === "box"
                ? primitive.size!.clone().multiplyScalar(0.5)
                : new THREE.Vector3(
                    primitive.radius!,
                    primitive.halfHeight!,
                    primitive.radius!,
                  ),
            localHit = localRay.intersectBox(
              new THREE.Box3(halfSize.clone().negate(), halfSize),
              new THREE.Vector3(),
            );
          if (!localHit) continue;
          const point = localHit.applyMatrix4(primitiveMatrix),
            distance = ray.ray.origin.distanceTo(point);
          if (!best || distance < best.distance) best = { piece, point, distance };
        }
      }
      return best;
    };

    const paintForceLabel = (label: HTMLDivElement, force: number) => {
      const text = `${force.toFixed(1)} N`;
      if (label.textContent !== text) label.textContent = text;
    };

    const updateSpring = () => {
      if (!spring) return;
      const projected = spring.piece.mesh
          .localToWorld(spring.anchor.clone())
          .project(camera),
        anchor = {
          x: ((projected.x + 1) * canvas.clientWidth) / 2,
          y: ((1 - projected.y) * canvas.clientHeight) / 2,
        },
        target = spring.cursorScreen,
        validProjection =
          Number.isFinite(anchor.x) &&
          Number.isFinite(anchor.y) &&
          Number.isFinite(target.x) &&
          Number.isFinite(target.y);
      if (!validProjection) {
        spring.line.removeAttribute("points");
        spring.label.style.display = "none";
        return;
      }
      spring.label.style.display = "";
      const dx = target.x - anchor.x,
        dy = target.y - anchor.y,
        length = Math.hypot(dx, dy),
        nx = length > 0 ? -dy / length : 0,
        ny = length > 0 ? dx / length : 0,
        points = Array.from({ length: 25 }, (_, index) => {
          const t = index / 24,
            offset =
              index === 0 || index === 24
                ? 0
                : (index % 2 ? 1 : -1) * Math.min(8, length * 0.04);
          return `${anchor.x + dx * t + nx * offset},${anchor.y + dy * t + ny * offset}`;
        });
      spring.line.setAttribute("points", points.join(" "));
      spring.label.style.left = `${(anchor.x + target.x) / 2}px`;
      spring.label.style.top = `${(anchor.y + target.y) / 2}px`;
      paintForceLabel(spring.label, spring.force);
    };

    const connectedPieces = (start: Piece) => {
      const found = new Set<Piece>([start]),
        queue = [start];
      while (queue.length) {
        const current = queue.shift()!;
        for (const connection of state.connections) {
          const next =
            connection.a === current
              ? connection.b
              : connection.b === current
                ? connection.a
                : undefined;
          if (next && !found.has(next)) {
            found.add(next);
            queue.push(next);
          }
        }
      }
      return [...found];
    };

    const clampMotion = (piece: Piece, linearLimit: number, angularLimit: number) => {
      if (!piece.body || piece.physicsIslandFixed) return;
      const v = piece.body.linvel(),
        w = piece.body.angvel(),
        linear = Math.hypot(v.x, v.y, v.z),
        angular = Math.hypot(w.x, w.y, w.z);
      if (linear > linearLimit) {
        const scale = linearLimit / linear;
        piece.body.setLinvel({ x: v.x * scale, y: v.y * scale, z: v.z * scale }, true);
      }
      if (angular > angularLimit) {
        const scale = angularLimit / angular;
        piece.body.setAngvel({ x: w.x * scale, y: w.y * scale, z: w.z * scale }, true);
      }
    };

    const colliderExtentAlongWorldAxis = (
      piece: Piece,
      primitive: CollisionPrimitive,
      axis: THREE.Vector3,
    ) => {
      if (primitive.shape === "cylinder") {
        const cylinderAxis = new THREE.Vector3(0, 1, 0)
            .applyQuaternion(primitive.rotation)
            .transformDirection(piece.mesh.matrixWorld)
            .normalize(),
          alignment = Math.abs(cylinderAxis.dot(axis));
        return (
          alignment * (primitive.halfHeight ?? 0) +
          Math.sqrt(Math.max(0, 1 - alignment * alignment)) * (primitive.radius ?? 0)
        );
      }
      const rotation = piece.mesh
          .getWorldQuaternion(new THREE.Quaternion())
          .multiply(primitive.rotation),
        size = primitive.size!,
        x = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation),
        y = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation),
        z = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
      return (
        Math.abs(axis.dot(x)) * size.x * 0.5 +
        Math.abs(axis.dot(y)) * size.y * 0.5 +
        Math.abs(axis.dot(z)) * size.z * 0.5
      );
    };

    const enforceAxialStops = () => {
      for (const connection of state.connections) {
        if (
          connection.mode !== "rotation-linear" ||
          !connection.a.body ||
          !connection.b.body ||
          connection.a.body === connection.b.body
        )
          continue;
        const socketWorld = worldConnector(connection.a, connection.socket),
          axis = socketWorld.axis.normalize();
        if (!connection.axialStops) {
          const surface = socketSurfaceHalfThickness(connection.a, connection.socket);
          connection.axialStops = [];
          for (const piece of connection.b.physicsIsland ?? [connection.b]) {
            if (!/bush|nut/i.test(piece.name)) continue;
            piece.mesh.updateMatrixWorld(true);
            for (const primitive of piece.colliders) {
              const center = piece.mesh.localToWorld(primitive.center.clone()),
                delta = center.clone().sub(socketWorld.point),
                distance = delta.dot(axis),
                radial = delta.clone().addScaledVector(axis, -distance).length(),
                radialReach =
                  primitive.shape === "cylinder"
                    ? (primitive.radius ?? 0)
                    : Math.max(
                        primitive.size?.x ?? 0,
                        primitive.size?.y ?? 0,
                        primitive.size?.z ?? 0,
                      ) * 0.5,
                extent = colliderExtentAlongWorldAxis(piece, primitive, axis),
                minimumDistance =
                  surface +
                  Math.max(0.01, extent - state.physicsSettings.axleTolerance * 0.5);
              if (
                radial <= radialReach + 0.12 &&
                Math.abs(Math.abs(distance) - minimumDistance) <= 0.2
              )
                connection.axialStops.push({
                  piece,
                  primitive,
                  side: distance >= 0 ? 1 : -1,
                  minimumDistance,
                });
            }
          }
        }
        for (const stop of connection.axialStops) {
          stop.piece.mesh.updateMatrixWorld(true);
          const center = stop.piece.mesh.localToWorld(stop.primitive.center.clone()),
            signedDistance = center.clone().sub(socketWorld.point).dot(axis) * stop.side;
          if (signedDistance >= stop.minimumDistance) continue;
          const correctionDistance = stop.minimumDistance - signedDistance,
            correction = axis.clone().multiplyScalar(stop.side * correctionDistance),
            body = connection.b.body,
            translation = body.translation();
          body.setTranslation(
            {
              x: translation.x + correction.x,
              y: translation.y + correction.y,
              z: translation.z + correction.z,
            },
            true,
          );
          for (const piece of connection.b.physicsIsland ?? [connection.b])
            piece.mesh.position.add(correction);
          const velocityA = connection.a.body.linvel(),
            velocityB = body.linvel(),
            relativeAxial =
              (velocityB.x - velocityA.x) * axis.x +
              (velocityB.y - velocityA.y) * axis.y +
              (velocityB.z - velocityA.z) * axis.z;
          if (relativeAxial * stop.side < 0)
            body.setLinvel(
              {
                x: velocityB.x - axis.x * relativeAxial,
                y: velocityB.y - axis.y * relativeAxial,
                z: velocityB.z - axis.z * relativeAxial,
              },
              true,
            );
          const now = performance.now();
          if (
            state.simLog &&
            correctionDistance > 0.02 &&
            now - (stop.lastLoggedMs ?? -Infinity) > 250
          ) {
            stop.lastLoggedMs = now;
            state.simLog.events.push(
              `Tope axial ${stop.piece.part} ↔ ${connection.a.part}: corrección ${correctionDistance.toFixed(3)} studs`,
            );
          }
        }
      }
    };

    const enforceGearLinks = () => {
      const gearNodes = new Map<number, { piece: Piece; localAxis: THREE.Vector3 }>(),
        bodyRotations = new Map<number, THREE.Quaternion>(),
        bodyRotationVectors = new Map<number, THREE.Vector3>(),
        stepGearDeltas = new Map<number, number>();
      for (const link of state.gearLinks)
        for (const [pose, localAxis] of [
          [link.a, link.axisA],
          [link.b, link.axisB],
        ] as [GearPose<Piece>, THREE.Vector3][]) {
          const piece = pose.value,
            body = piece.body;
          if (!body) continue;
          gearNodes.set(piece.id, { piece, localAxis });
          if (bodyRotations.has(body.handle)) continue;
          const rotation = body.rotation(),
            current = new THREE.Quaternion(
              rotation.x,
              rotation.y,
              rotation.z,
              rotation.w,
            ).normalize(),
            previous = state.gearBodyRotations.get(body.handle) ?? current,
            delta = current.clone().multiply(previous.clone().invert());
          if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
          const vectorLength = Math.hypot(delta.x, delta.y, delta.z),
            angle = 2 * Math.atan2(vectorLength, Math.max(0, delta.w)),
            rotationVector =
              vectorLength > 1e-9
                ? new THREE.Vector3(delta.x, delta.y, delta.z).multiplyScalar(
                    angle / vectorLength,
                  )
                : new THREE.Vector3();
          bodyRotations.set(body.handle, current);
          bodyRotationVectors.set(body.handle, rotationVector);
          state.gearBodyRotations.set(body.handle, current.clone());
        }
      // Accumulate the rotation Rapier actually produced, not the velocity we
      // requested in the previous frame. This makes physical tooth phase
      // measurable and prevents invisible drift under load.
      for (const { piece, localAxis } of gearNodes.values()) {
        const body = piece.body,
          rotation = bodyRotations.get(body!.handle);
        if (!body || !rotation) continue;
        const worldAxis = localAxis.clone().applyQuaternion(rotation).normalize(),
          deltaAngle = bodyRotationVectors.get(body.handle)?.dot(worldAxis) ?? 0,
          angleKey = `piece:${piece.id}`;
        stepGearDeltas.set(piece.id, deltaAngle);
        state.gearAngles.set(
          angleKey,
          (state.gearAngles.get(angleKey) ?? 0) + deltaAngle,
        );
      }
      const gearCenter = (piece: Piece) => {
          const body = piece.body!,
            translation = body.translation(),
            rotation = body.rotation();
          return new THREE.Vector3(translation.x, translation.y, translation.z).add(
            (piece.physicsOffset ?? new THREE.Vector3())
              .clone()
              .applyQuaternion(
                new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
              ),
          );
        },
        rotateBodyAtGear = (piece: Piece, localAxis: THREE.Vector3, angle: number) => {
          const body = piece.body;
          if (!body || piece.physicsIslandFixed || Math.abs(angle) < 1e-8) return;
          const rotation = body.rotation(),
            current = new THREE.Quaternion(
              rotation.x,
              rotation.y,
              rotation.z,
              rotation.w,
            ).normalize(),
            worldAxis = localAxis.clone().applyQuaternion(current).normalize(),
            delta = new THREE.Quaternion().setFromAxisAngle(worldAxis, angle),
            next = delta.clone().multiply(current).normalize(),
            pivot = gearCenter(piece),
            translation = body.translation(),
            nextPosition = new THREE.Vector3(translation.x, translation.y, translation.z)
              .sub(pivot)
              .applyQuaternion(delta)
              .add(pivot);
          body.setTranslation(nextPosition, true);
          body.setRotation(next, true);
          state.gearBodyRotations.set(body.handle, next.clone());
          // One rigid island may carry several fixed gears. Apply this exact
          // body rotation to every phase coordinate on that island.
          for (const node of gearNodes.values()) {
            if (node.piece.body !== body) continue;
            const nodeAxis = node.localAxis.clone().applyQuaternion(current).normalize();
            const key = `piece:${node.piece.id}`;
            state.gearAngles.set(
              key,
              (state.gearAngles.get(key) ?? 0) + angle * worldAxis.dot(nodeAxis),
            );
          }
        },
        solvePhase = (link: RuntimeGearLink) => {
          const pieceA = link.a.value,
            pieceB = link.b.value,
            bodyA = pieceA.body,
            bodyB = pieceB.body;
          if (!bodyA || !bodyB || bodyA === bodyB) return;
          const teethA = link.a.spec.teeth,
            signedTeethB = link.signB * link.b.spec.teeth,
            angleA = state.gearAngles.get(`piece:${pieceA.id}`) ?? 0,
            angleB = state.gearAngles.get(`piece:${pieceB.id}`) ?? 0,
            phase = teethA * angleA + signedTeethB * angleB,
            key = gearLinkKey(link),
            target = state.gearPhases.get(key) ?? phase,
            error = phase - target;
          if (!state.gearPhases.has(key)) state.gearPhases.set(key, target);
          if (Math.abs(error) < 1e-6) return;
          const fixedA = !!pieceA.physicsIslandFixed,
            fixedB = !!pieceB.physicsIslandFixed;
          if (fixedA && fixedB) return;
          const phaseMotionA = Math.abs(teethA * (stepGearDeltas.get(pieceA.id) ?? 0)),
            phaseMotionB = Math.abs(signedTeethB * (stepGearDeltas.get(pieceB.id) ?? 0));
          let correctionA = 0,
            correctionB = 0;
          if (fixedA) correctionB = -error / signedTeethB;
          else if (fixedB) correctionA = -error / teethA;
          else if (phaseMotionA > phaseMotionB * 1.1 + 1e-7)
            correctionA = -error / teethA;
          else if (phaseMotionB > phaseMotionA * 1.1 + 1e-7)
            correctionB = -error / signedTeethB;
          else {
            const denominator = teethA * teethA + signedTeethB * signedTeethB;
            correctionA = (-error * teethA) / denominator;
            correctionB = (-error * signedTeethB) / denominator;
          }
          rotateBodyAtGear(pieceA, link.axisA, correctionA);
          rotateBodyAtGear(pieceB, link.axisB, correctionB);
        };
      // Position projection is deliberately hard: a blocked output rotates the
      // driving side back instead of allowing even one tooth of phase loss.
      for (let iteration = 0; iteration < 6; iteration++) {
        state.gearLinks.forEach(solvePhase);
        for (let index = state.gearLinks.length - 1; index >= 0; index--)
          solvePhase(state.gearLinks[index]);
      }
      // A symmetric sequential projection transmits in either direction. The
      // phase correction is intentionally much stronger than a normal motor;
      // it behaves like engaged teeth instead of a soft friction drive.
      const solveLink = (link: RuntimeGearLink) => {
        const pieceA = link.a.value,
          pieceB = link.b.value,
          bodyA = pieceA.body,
          bodyB = pieceB.body;
        if (!bodyA || !bodyB || bodyA === bodyB) return;
        const rotationA = bodyA.rotation(),
          rotationB = bodyB.rotation(),
          axisA = link.axisA
            .clone()
            .applyQuaternion(
              new THREE.Quaternion(rotationA.x, rotationA.y, rotationA.z, rotationA.w),
            ),
          axisB = link.axisB
            .clone()
            .applyQuaternion(
              new THREE.Quaternion(rotationB.x, rotationB.y, rotationB.z, rotationB.w),
            ),
          angularA = bodyA.angvel(),
          angularB = bodyB.angvel(),
          velocityA = angularA.x * axisA.x + angularA.y * axisA.y + angularA.z * axisA.z,
          velocityB = angularB.x * axisB.x + angularB.y * axisB.y + angularB.z * axisB.z,
          teethA = link.a.spec.teeth,
          teethB = link.b.spec.teeth,
          signedTeethB = link.signB * teethB;
        // Tooth position is already projected rigidly above. Mixing its old
        // phase-velocity correction into this equation deformed the actual
        // ratio under load (e.g. 20:28 became roughly 20:6). Velocity now has
        // one exact invariant only: teethA*wA + signedTeethB*wB = 0.
        const error = teethA * velocityA + signedTeethB * velocityB;
        if (Math.abs(error) < 1e-5) return;
        const fixedA = !!pieceA.physicsIslandFixed,
          fixedB = !!pieceB.physicsIslandFixed;
        if (fixedA && fixedB) return;
        let deltaA = 0,
          deltaB = 0;
        if (fixedA) deltaB = -error / signedTeethB;
        else if (fixedB) deltaA = -error / teethA;
        else {
          const denominator = teethA * teethA + signedTeethB * signedTeethB;
          deltaA = (-error * teethA) / denominator;
          deltaB = (-error * signedTeethB) / denominator;
        }
        if (!fixedA)
          bodyA.setAngvel(
            {
              x: angularA.x + axisA.x * deltaA,
              y: angularA.y + axisA.y * deltaA,
              z: angularA.z + axisA.z * deltaA,
            },
            true,
          );
        if (!fixedB)
          bodyB.setAngvel(
            {
              x: angularB.x + axisB.x * deltaB,
              y: angularB.y + axisB.y * deltaB,
              z: angularB.z + axisB.z * deltaB,
            },
            true,
          );
      };
      // Symmetric Gauss-Seidel sweeps make a train transmit equally well from
      // either end instead of favouring the pair that happens to be stored first.
      for (let iteration = 0; iteration < 8; iteration++) {
        state.gearLinks.forEach(solveLink);
        for (let index = state.gearLinks.length - 1; index >= 0; index--)
          solveLink(state.gearLinks[index]);
      }
    };
    // Non-positional gear constraint. It never writes a quaternion or an
    // absolute angle: only the angular velocities that physically exist are
    // projected onto the exact tooth ratio. Running this around small Rapier
    // substeps lets contacts and motor torque participate without teleporting
    // either gear when the applied force changes direction.
    const projectGearVelocities = () => {
      const solve = (link: RuntimeGearLink) => {
          const pieceA = link.a.value,
            pieceB = link.b.value,
            bodyA = pieceA.body,
            bodyB = pieceB.body;
          if (!bodyA || !bodyB || bodyA === bodyB) return;
          const rotationA = bodyA.rotation(),
            rotationB = bodyB.rotation(),
            axisA = link.axisA
              .clone()
              .applyQuaternion(
                new THREE.Quaternion(rotationA.x, rotationA.y, rotationA.z, rotationA.w),
              )
              .normalize(),
            axisB = link.axisB
              .clone()
              .applyQuaternion(
                new THREE.Quaternion(rotationB.x, rotationB.y, rotationB.z, rotationB.w),
              )
              .normalize(),
            angularA = bodyA.angvel(),
            angularB = bodyB.angvel(),
            velocityA =
              angularA.x * axisA.x + angularA.y * axisA.y + angularA.z * axisA.z,
            velocityB =
              angularB.x * axisB.x + angularB.y * axisB.y + angularB.z * axisB.z,
            teethA = link.a.spec.teeth,
            signedTeethB = link.signB * link.b.spec.teeth,
            error = teethA * velocityA + signedTeethB * velocityB;
          if (Math.abs(error) < 1e-6) return;
          const fixedA = !!pieceA.physicsIslandFixed,
            fixedB = !!pieceB.physicsIslandFixed;
          if (fixedA && fixedB) return;
          let deltaA = 0,
            deltaB = 0;
          if (fixedA) deltaB = -error / signedTeethB;
          else if (fixedB) deltaA = -error / teethA;
          else {
            const denominator = teethA * teethA + signedTeethB * signedTeethB;
            deltaA = (-error * teethA) / denominator;
            deltaB = (-error * signedTeethB) / denominator;
          }
          if (!fixedA)
            bodyA.setAngvel(
              {
                x: angularA.x + axisA.x * deltaA,
                y: angularA.y + axisA.y * deltaA,
                z: angularA.z + axisA.z * deltaA,
              },
              true,
            );
          if (!fixedB)
            bodyB.setAngvel(
              {
                x: angularB.x + axisB.x * deltaB,
                y: angularB.y + axisB.y * deltaB,
                z: angularB.z + axisB.z * deltaB,
              },
              true,
            );
        },
        solveDifferential = (link: RuntimeDifferentialLink) => {
          const entries = [
            {
              piece: link.carrier,
              axis: link.axisCarrier,
              gradient: -2,
            },
            { piece: link.left, axis: link.axisLeft, gradient: 1 },
            { piece: link.right, axis: link.axisRight, gradient: 1 },
          ];
          const bodies = entries.map(({ piece }) => piece.body);
          if (
            bodies.some((body) => !body) ||
            new Set(bodies.map((body) => body!.handle)).size !== 3
          )
            return;
          const samples = entries.map(({ piece, axis, gradient }) => {
              const body = piece.body!,
                rotation = body.rotation(),
                worldAxis = axis
                  .clone()
                  .applyQuaternion(
                    new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
                  )
                  .normalize(),
                angular = body.angvel(),
                speed =
                  angular.x * worldAxis.x +
                  angular.y * worldAxis.y +
                  angular.z * worldAxis.z;
              return {
                piece,
                body,
                worldAxis,
                angular,
                speed,
                gradient,
              };
            }),
            // Ideal open differential: outputLeft + outputRight = 2*carrier.
            error = samples.reduce(
              (sum, sample) => sum + sample.gradient * sample.speed,
              0,
            ),
            denominator = samples.reduce(
              (sum, sample) =>
                sum +
                (sample.piece.physicsIslandFixed ? 0 : sample.gradient * sample.gradient),
              0,
            );
          if (Math.abs(error) < 1e-6 || denominator < 1e-9) return;
          samples.forEach((sample) => {
            if (sample.piece.physicsIslandFixed) return;
            const correction = (-error * sample.gradient) / denominator;
            sample.body.setAngvel(
              {
                x: sample.angular.x + sample.worldAxis.x * correction,
                y: sample.angular.y + sample.worldAxis.y * correction,
                z: sample.angular.z + sample.worldAxis.z * correction,
              },
              true,
            );
          });
        };
      // More sweeps than the former position solver are cheap for the usual
      // small gear trains and make long chains direction-independent.
      for (let iteration = 0; iteration < 16; iteration++) {
        state.gearLinks.forEach(solve);
        for (let index = state.gearLinks.length - 1; index >= 0; index--)
          solve(state.gearLinks[index]);
        state.differentialLinks.forEach(solveDifferential);
      }
    };

    const makeLock = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 96;
      const x = c.getContext("2d")!;
      x.fillStyle = "#fff";
      x.beginPath();
      x.arc(48, 48, 42, 0, Math.PI * 2);
      x.fill();
      x.strokeStyle = "#f1b900";
      x.lineWidth = 7;
      x.stroke();
      x.font = "48px 'Segoe UI Emoji'";
      x.textAlign = "center";
      x.textBaseline = "middle";
      x.fillText("🔒", 48, 50);
      const texture = new THREE.CanvasTexture(c),
        sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: texture,
            depthTest: false,
            transparent: true,
          }),
        );
      sprite.scale.set(0.72, 0.72, 1);
      sprite.renderOrder = 20;
      return sprite;
    };

    const toggleFixed = (piece: Piece) => {
      piece.fixed = !piece.fixed;
      if (piece.fixed) {
        piece.lockSprite = makeLock();
        scene.add(piece.lockSprite);
      } else if (piece.lockSprite) {
        scene.remove(piece.lockSprite);
        piece.lockSprite.material.map?.dispose();
        piece.lockSprite.material.dispose();
        piece.lockSprite = undefined;
      }
      if (piece.body)
        (piece.physicsIsland ?? [piece]).forEach((member) => {
          member.physicsIslandFixed = (member.physicsIsland ?? [member]).some(
            (candidate) => candidate.fixed,
          );
        });
      if (piece.body)
        piece.body.setBodyType(
          piece.physicsIslandFixed
            ? RAPIER.RigidBodyType.Fixed
            : RAPIER.RigidBodyType.Dynamic,
          true,
        );
      setMessage(
        piece.fixed ? `${piece.part} fijada al espacio` : `${piece.part} liberada`,
      );
    };

    const cloneConnection = (connection: Connection): Connection => ({
        ...connection,
        point: connection.point.clone(),
        axis: connection.axis.clone(),
        localAxisA: connection.localAxisA.clone(),
        localPointA: connection.localPointA?.clone(),
        localPointB: connection.localPointB?.clone(),
      }),
      cloneConnector = (connector: MeshConnector): MeshConnector => ({
        ...connector,
        local: connector.local.clone(),
        axis: connector.axis.clone(),
      }),
      cloneCollider = (collider: CollisionPrimitive): CollisionPrimitive => ({
        ...collider,
        center: collider.center.clone(),
        size: collider.size?.clone(),
        rotation: collider.rotation.clone(),
      });
    const captureEditorSnapshot = (): EditorSnapshot => ({
      pieces: state.pieces.map((piece) => ({
        piece,
        position: piece.mesh.position.clone(),
        rotation: piece.mesh.quaternion.clone(),
        scale: piece.mesh.scale.clone(),
        color: piece.color,
        fixed: piece.fixed,
        exactCollider: piece.exactCollider,
        dynamicAxleConnections: piece.dynamicAxleConnections,
        rotationPivotLocal: piece.rotationPivotLocal?.clone(),
        rotationPivotKey: piece.rotationPivotKey,
        connectors: piece.connectors.map(cloneConnector),
        colliders: piece.colliders.map(cloneCollider),
        gearColliders: piece.gearColliders.map(cloneCollider),
      })),
      connections: state.connections.map(cloneConnection),
      connectionModes: new Map(
        [...state.connectionModes].map(([id, mode]) => [id, { ...mode }]),
      ),
      selected: state.selected,
    });
    const undoStack: EditorSnapshot[] = [],
      redoStack: EditorSnapshot[] = [];
    let restoringHistory = false,
      historyBusy = false,
      clipboard:
        | {
            catalog: CatalogPart;
            position: THREE.Vector3;
            rotation: THREE.Quaternion;
            scale: THREE.Vector3;
            connectors: MeshConnector[];
            colliders: CollisionPrimitive[];
            gearColliders: CollisionPrimitive[];
            fixed: boolean;
            exactCollider: boolean;
            dynamicAxleConnections: boolean;
            rotationPivotLocal?: THREE.Vector3;
            rotationPivotKey?: string;
          }
        | undefined,
      pasteIndex = 0;
    const disposeLock = (piece: Piece) => {
      if (!piece.lockSprite) return;
      scene.remove(piece.lockSprite);
      piece.lockSprite.material.map?.dispose();
      piece.lockSprite.material.dispose();
      piece.lockSprite = undefined;
    };

    const restoreEditorSnapshot = async (snapshot: EditorSnapshot) => {
      restoringHistory = true;
      try {
        state.disposeRenderBatches();
        const restoredPieces = new Set(snapshot.pieces.map((item) => item.piece));
        state.pieces.forEach((piece) => {
          if (restoredPieces.has(piece)) return;
          scene.remove(piece.mesh);
          disposeLock(piece);
        });
        state.pieces = snapshot.pieces.map((item) => item.piece);
        for (const item of snapshot.pieces) {
          const piece = item.piece;
          if (piece.mesh.parent !== scene) scene.add(piece.mesh);
          if (piece.color !== item.color) await state.recolorPart(piece, item.color);
          piece.mesh.position.copy(item.position);
          piece.mesh.quaternion.copy(item.rotation);
          piece.mesh.scale.copy(item.scale);
          piece.mesh.visible = true;
          piece.mesh.updateMatrixWorld(true);
          piece.fixed = item.fixed;
          piece.exactCollider = item.exactCollider;
          piece.dynamicAxleConnections = item.dynamicAxleConnections;
          piece.rotationPivotLocal = item.rotationPivotLocal?.clone();
          piece.rotationPivotKey = item.rotationPivotKey;
          piece.connectors = item.connectors.map(cloneConnector);
          piece.colliders = item.colliders.map(cloneCollider);
          piece.gearColliders = item.gearColliders.map(cloneCollider);
          if (piece.fixed && !piece.lockSprite) {
            piece.lockSprite = makeLock();
            scene.add(piece.lockSprite);
          } else if (!piece.fixed) disposeLock(piece);
        }
        state.connections = snapshot.connections.map(cloneConnection);
        state.connectionModes = new Map(
          [...snapshot.connectionModes].map(([id, mode]) => [id, { ...mode }]),
        );
        state.differentialLinks = detectDifferentialLinks(state.pieces);
        state.gearLinks = detectGearLinks(
          state.pieces,
          undefined,
          differentialPairKeys(state.differentialLinks),
        );
        state.selected =
          snapshot.selected && restoredPieces.has(snapshot.selected)
            ? snapshot.selected
            : undefined;
        state.rebuildRenderBatches();
        state.refreshDebug();
        setSelectedId(state.selected?.id ?? null);
        setCount(state.pieces.length);
        setConnectionRevision((value) => value + 1);
      } finally {
        restoringHistory = false;
      }
    };

    const recordHistory = () => {
      if (restoringHistory || historyBusy || state.running) return;
      undoStack.push(captureEditorSnapshot());
      if (undoStack.length > 80) undoStack.shift();
      redoStack.length = 0;
      scheduleRecoverySave();
    };

    const undo = async () => {
      if (historyBusy || state.running) return false;
      if (!undoStack.length) {
        setMessage("No hay acciones que deshacer");
        return false;
      }
      historyBusy = true;
      try {
        redoStack.push(captureEditorSnapshot());
        await restoreEditorSnapshot(undoStack.pop()!);
        setMessage("Deshacer");
        return true;
      } finally {
        historyBusy = false;
      }
    };

    const redo = async () => {
      if (historyBusy || state.running) return false;
      if (!redoStack.length) {
        setMessage("No hay acciones que rehacer");
        return false;
      }
      historyBusy = true;
      try {
        undoStack.push(captureEditorSnapshot());
        await restoreEditorSnapshot(redoStack.pop()!);
        setMessage("Rehacer");
        return true;
      } finally {
        historyBusy = false;
      }
    };

    const catalogFromPiece = (piece: Piece): CatalogPart => ({
      part: piece.part,
      name: piece.name,
      thumb: piece.thumb,
      kind: piece.kind,
      color: piece.color,
      family: piece.family,
      modelPart: piece.modelPart,
      rawThumb: piece.rawThumb,
      geometry: piece.geometry,
      sourceColor: piece.sourceColor,
      gear: piece.gear,
      origin: piece.origin,
      sourceKind: piece.sourceKind,
      requestedPart: piece.requestedPart,
      catalogReturnedPart: piece.catalogReturnedPart,
      resolvedPart: piece.resolvedPart,
      catalogQuery: piece.catalogQuery,
      importFile: piece.importFile,
      downloadUrl: piece.downloadUrl,
      downloadSource: piece.downloadSource,
    });
    const tuple3 = (vector: THREE.Vector3) =>
        vector.toArray() as [number, number, number],
      tuple4 = (quaternion: THREE.Quaternion) =>
        quaternion.toArray() as [number, number, number, number],
      saveConnector = (connector: MeshConnector): SavedConnector => ({
        local: tuple3(connector.local),
        axis: tuple3(connector.axis),
        kind: connector.kind,
        role: connector.role,
        diameter: connector.diameter,
        length: connector.length,
      }),
      saveCollider = (collider: CollisionPrimitive): SavedCollisionPrimitive => ({
        shape: collider.shape,
        center: tuple3(collider.center),
        size: collider.size ? tuple3(collider.size) : undefined,
        radius: collider.radius,
        halfHeight: collider.halfHeight,
        rotation: tuple4(collider.rotation),
      }),
      loadConnector = (connector: SavedConnector): MeshConnector => ({
        ...connector,
        local: new THREE.Vector3().fromArray(connector.local),
        axis: new THREE.Vector3().fromArray(connector.axis),
      }),
      loadCollider = (collider: SavedCollisionPrimitive): CollisionPrimitive => ({
        ...collider,
        center: new THREE.Vector3().fromArray(collider.center),
        size: collider.size ? new THREE.Vector3().fromArray(collider.size) : undefined,
        rotation: new THREE.Quaternion().fromArray(collider.rotation),
      });
    let recoveryTimer = 0,
      recoveryGeneration = 0,
      restoringProject = false;
    const createProjectDocument = (identity?: {
      id?: string;
      name?: string;
      createdAt?: string;
    }): SimStudioProjectDocument => {
      const now = new Date().toISOString(),
        id = identity?.id ?? activeProjectIdRef.current,
        name = identity?.name ?? projectNameRef.current,
        createdAt = identity?.createdAt ?? projectCreatedAtRef.current,
        assets: Record<string, JsonObject> = {},
        pieceIds = new Map(
          state.pieces.map((piece, index) => [piece, `piece-${index + 1}`]),
        ),
        connectorIndex = (piece: Piece, connector: MeshConnector) => {
          const direct = piece.connectors.indexOf(connector);
          if (direct >= 0) return direct;
          return Math.max(
            0,
            piece.connectors.findIndex(
              (candidate) =>
                candidate.kind === connector.kind &&
                candidate.role === connector.role &&
                candidate.local.distanceToSquared(connector.local) < 1e-8,
            ),
          );
        };
      const pieces = state.pieces.map((piece) => {
          const asset = modelRenderKey(piece);
          if (!assets[asset]) {
            const visual = (piece.mesh.children[0] ?? piece.mesh).clone(true);
            visual.traverse((object) => {
              object.visible = true;
            });
            assets[asset] = visual.toJSON() as unknown as JsonObject;
          }
          const catalog = catalogFromPiece(piece);
          delete catalog.embeddedGeometry;
          delete catalog.projectAssetKey;
          return {
            id: pieceIds.get(piece)!,
            catalog: catalog as unknown as JsonObject,
            asset,
            position: tuple3(piece.mesh.position),
            rotation: tuple4(piece.mesh.quaternion),
            scale: tuple3(piece.mesh.scale),
            fixed: piece.fixed,
            exactCollider: piece.exactCollider,
            dynamicAxleConnections: piece.dynamicAxleConnections,
            rotationPivotLocal: piece.rotationPivotLocal
              ? tuple3(piece.rotationPivotLocal)
              : undefined,
            rotationPivotKey: piece.rotationPivotKey,
            connectors: piece.connectors.map(saveConnector),
            colliders: piece.colliders.map(saveCollider),
            gearColliders: piece.gearColliders.map(saveCollider),
          };
        }),
        connections = state.connections.map((connection) => ({
          id: connection.id,
          a: pieceIds.get(connection.a)!,
          b: pieceIds.get(connection.b)!,
          socketIndex: connectorIndex(connection.a, connection.socket),
          shaftIndex: connectorIndex(connection.b, connection.shaft),
          mode: connection.mode,
          profile: connection.profile,
          point: tuple3(connection.point),
          axis: tuple3(connection.axis),
          localAxisA: tuple3(connection.localAxisA),
          travel: connection.travel,
          motorSpeed: connection.motorSpeed,
          motorForce: connection.motorForce,
          userConfigured: connection.userConfigured,
          forced: connection.forced,
          forcedOffset: connection.forcedOffset,
          localPointA: connection.localPointA
            ? tuple3(connection.localPointA)
            : undefined,
          localPointB: connection.localPointB
            ? tuple3(connection.localPointB)
            : undefined,
        })),
        gearLinks = state.gearLinks.flatMap((link) => {
          const a = pieceIds.get(link.a.value),
            b = pieceIds.get(link.b.value);
          return !a || !b
            ? []
            : [
                {
                  a,
                  b,
                  specA: link.a.spec,
                  specB: link.b.spec,
                  centerA: link.a.center,
                  centerB: link.b.center,
                  poseAxisA: link.a.axis,
                  poseAxisB: link.b.axis,
                  axisA: tuple3(link.axisA),
                  axisB: tuple3(link.axisB),
                  ratio: link.ratio,
                  centerDistance: link.centerDistance,
                  expectedDistance: link.expectedDistance,
                  distanceError: link.distanceError,
                  signB: link.signB,
                  perpendicular: link.perpendicular,
                },
              ];
        }),
        importedCatalog = [
          ...new Map(
            state.pieces
              .filter((piece) => !belongsToDefaultPalette(piece))
              .map((piece) => {
                const catalog = catalogFromPiece(piece);
                return [
                  `${catalog.part}:${catalog.color}`,
                  catalog as unknown as JsonObject,
                ];
              }),
          ).values(),
        ];
      return {
        format: "simstudio-project",
        version: 1,
        id,
        name,
        createdAt,
        updatedAt: now,
        appVersion: "0.4",
        revision: projectRevisionRef.current,
        savedRevision: savedProjectRevisionRef.current,
        assets,
        pieces,
        connections,
        gearLinks,
        importedCatalog,
        camera: {
          position: tuple3(camera.position),
          quaternion: tuple4(camera.quaternion),
          target: tuple3(cameraTarget),
        },
        settings: {
          gridStep: state.gridStep,
          axleSnapStep: state.axleSnapStep,
          rotationSnapStep: state.rotationSnapStep,
          structuralMode: structuralModeRef.current,
          structuralStiffness: structuralStiffnessRef.current,
          physics: { ...state.physicsSettings },
        },
      };
    };

    const scheduleRecoverySave = (immediate = false, markDirty = true) => {
      if (restoringProject || projectRestoringRef.current || state.running) return;
      if (markDirty) {
        projectRevisionRef.current++;
        setProjectDirty(true);
      }
      const generation = ++recoveryGeneration;
      if (recoveryTimer) window.clearTimeout(recoveryTimer);
      setRecoveryStatus("saving");
      recoveryTimer = window.setTimeout(
        () => {
          if (generation !== recoveryGeneration || restoringProject) return;
          void saveRecoveryProject(createProjectDocument())
            .then(() => setRecoveryStatus("saved"))
            .catch(() => setRecoveryStatus("idle"));
        },
        immediate ? 0 : 450,
      );
    };

    const restoreProjectDocument = async (document: SimStudioProjectDocument) => {
      if (state.running) return;
      restoringProject = true;
      projectRestoringRef.current = true;
      recoveryGeneration++;
      if (recoveryTimer) window.clearTimeout(recoveryTimer);
      state.bulkLoading = true;
      state.disposeRenderBatches();
      state.pieces.forEach((piece) => {
        scene.remove(piece.mesh);
        disposeLock(piece);
      });
      state.pieces = [];
      state.connections = [];
      state.connectionModes.clear();
      state.gearLinks = [];
      state.differentialLinks = [];
      state.selected = undefined;
      const piecesById = new Map<string, Piece>();
      try {
        for (const saved of document.pieces) {
          const asset = document.assets[saved.asset];
          if (!asset) throw new Error(`Missing embedded asset ${saved.asset}`);
          const catalog = {
              ...(saved.catalog as unknown as CatalogPart),
              embeddedGeometry: asset,
              projectAssetKey: saved.asset,
              sourceKind: "packaged-cache" as const,
            },
            piece = await addPart(
              catalog,
              new THREE.Vector3().fromArray(saved.position),
              new THREE.Quaternion().fromArray(saved.rotation),
            );
          if (!piece) throw new Error(`Could not restore ${catalog.part}`);
          piece.mesh.scale.fromArray(saved.scale);
          piece.connectors = saved.connectors.map(loadConnector);
          piece.colliders = saved.colliders.map(loadCollider);
          piece.gearColliders = saved.gearColliders.map(loadCollider);
          piece.fixed = saved.fixed;
          piece.exactCollider = saved.exactCollider ?? isDifferentialPart(piece);
          piece.dynamicAxleConnections = saved.dynamicAxleConnections;
          piece.rotationPivotLocal = saved.rotationPivotLocal
            ? new THREE.Vector3().fromArray(saved.rotationPivotLocal)
            : undefined;
          piece.rotationPivotKey = saved.rotationPivotKey;
          piece.mesh.visible = true;
          piece.mesh.updateMatrixWorld(true);
          if (piece.fixed) {
            piece.lockSprite = makeLock();
            scene.add(piece.lockSprite);
          }
          piecesById.set(saved.id, piece);
        }
        state.connections = document.connections.flatMap((saved) => {
          const a = piecesById.get(saved.a),
            b = piecesById.get(saved.b);
          if (!a || !b) return [];
          const socket = a.connectors[saved.socketIndex],
            shaft = b.connectors[saved.shaftIndex];
          if (!socket || !shaft) return [];
          const connection: Connection = {
            id: saved.id,
            a,
            b,
            socket,
            shaft,
            mode: saved.mode,
            profile: saved.profile,
            point: new THREE.Vector3().fromArray(saved.point),
            axis: new THREE.Vector3().fromArray(saved.axis),
            localAxisA: new THREE.Vector3().fromArray(saved.localAxisA),
            travel: saved.travel,
            motorSpeed: saved.motorSpeed,
            motorForce: saved.motorForce,
            userConfigured: saved.userConfigured,
            forced: saved.forced,
            forcedOffset: saved.forcedOffset,
            localPointA: saved.localPointA
              ? new THREE.Vector3().fromArray(saved.localPointA)
              : undefined,
            localPointB: saved.localPointB
              ? new THREE.Vector3().fromArray(saved.localPointB)
              : undefined,
          };
          state.connectionModes.set(connection.id, {
            mode: connection.mode,
            motorSpeed: connection.motorSpeed,
            motorForce: connection.motorForce,
            userConfigured: connection.userConfigured,
          });
          return [connection];
        });
        state.gearLinks = document.gearLinks.flatMap((saved) => {
          const a = piecesById.get(saved.a),
            b = piecesById.get(saved.b);
          return !a || !b
            ? []
            : [
                {
                  a: {
                    value: a,
                    spec: saved.specA as GearPose<Piece>["spec"],
                    center: saved.centerA,
                    axis: saved.poseAxisA,
                  },
                  b: {
                    value: b,
                    spec: saved.specB as GearPose<Piece>["spec"],
                    center: saved.centerB,
                    axis: saved.poseAxisB,
                  },
                  ratio: saved.ratio,
                  centerDistance: saved.centerDistance,
                  expectedDistance: saved.expectedDistance,
                  distanceError: saved.distanceError,
                  axisA: new THREE.Vector3().fromArray(saved.axisA),
                  axisB: new THREE.Vector3().fromArray(saved.axisB),
                  signB: saved.signB,
                  perpendicular: saved.perpendicular,
                },
              ];
        });
        camera.position.fromArray(document.camera.position);
        camera.quaternion.fromArray(document.camera.quaternion);
        cameraTarget.fromArray(document.camera.target);
        camera.lookAt(cameraTarget);
        activeProjectIdRef.current = document.id;
        projectCreatedAtRef.current = document.createdAt;
        projectRevisionRef.current = document.revision ?? 0;
        savedProjectRevisionRef.current = document.savedRevision ?? null;
        setProjectDirty(savedProjectRevisionRef.current !== projectRevisionRef.current);
        projectNameRef.current = document.name.slice(0, 20);
        suppressProjectNameDirtyRef.current = true;
        setProjectName(document.name.slice(0, 20));
        setGridStep(document.settings.gridStep as GridStep);
        setAxleSnapStep(document.settings.axleSnapStep as AxleSnapStep);
        setRotationSnapStep(document.settings.rotationSnapStep as RotationSnapStep);
        setStructuralMode(document.settings.structuralMode);
        setStructuralStiffness(document.settings.structuralStiffness);
        setPhysicsSettings({
          ...DEFAULT_PHYSICS_SETTINGS,
          ...(document.settings.physics as Partial<PhysicsSettings>),
        });
        setImported(
          document.importedCatalog.map((catalog) => catalog as unknown as CatalogPart),
        );
        state.rebuildRenderBatches();
        state.refreshDebug();
        setSelectedId(null);
        setCount(state.pieces.length);
        setConnectionRevision((value) => value + 1);
        undoStack.length = 0;
        redoStack.length = 0;
      } finally {
        state.bulkLoading = false;
        restoringProject = false;
        window.setTimeout(() => {
          projectRestoringRef.current = false;
          scheduleRecoverySave(true, false);
        }, 50);
      }
    };

    const copySelected = () => {
      const piece = state.selected;
      if (!piece || state.running) return false;
      clipboard = {
        catalog: catalogFromPiece(piece),
        position: piece.mesh.position.clone(),
        rotation: piece.mesh.quaternion.clone(),
        scale: piece.mesh.scale.clone(),
        connectors: piece.connectors.map(cloneConnector),
        colliders: piece.colliders.map(cloneCollider),
        gearColliders: piece.gearColliders.map(cloneCollider),
        fixed: piece.fixed,
        exactCollider: piece.exactCollider,
        dynamicAxleConnections: piece.dynamicAxleConnections,
        rotationPivotLocal: piece.rotationPivotLocal?.clone(),
        rotationPivotKey: piece.rotationPivotKey,
      };
      pasteIndex = 0;
      setMessage(`${piece.part} copiada`);
      return true;
    };

    const pasteClipboard = async () => {
      if (state.running || historyBusy) return null;
      if (!clipboard) {
        setMessage("Copia una pieza antes de pegar");
        return null;
      }
      const historyLength = undoStack.length;
      recordHistory();
      pasteIndex++;
      const offset = new THREE.Vector3(0.4 * pasteIndex, 0, 0.4 * pasteIndex),
        piece = await addPart(
          { ...clipboard.catalog },
          clipboard.position.clone().add(offset),
          clipboard.rotation,
        );
      if (!piece) {
        undoStack.length = historyLength;
        return null;
      }
      piece.mesh.scale.copy(clipboard.scale);
      piece.connectors = clipboard.connectors.map(cloneConnector);
      piece.colliders = clipboard.colliders.map(cloneCollider);
      piece.gearColliders = clipboard.gearColliders.map(cloneCollider);
      piece.fixed = clipboard.fixed;
      piece.exactCollider = clipboard.exactCollider;
      piece.dynamicAxleConnections = clipboard.dynamicAxleConnections;
      piece.rotationPivotLocal = clipboard.rotationPivotLocal?.clone();
      piece.rotationPivotKey = clipboard.rotationPivotKey;
      if (piece.fixed) {
        piece.lockSprite = makeLock();
        scene.add(piece.lockSprite);
      }
      piece.mesh.updateMatrixWorld(true);
      connect(piece);
      void verifyConnectionsAsync();
      state.selected = piece;
      state.rebuildRenderBatches();
      state.refreshDebug();
      setSelectedId(piece.id);
      setCount(state.pieces.length);
      setConnectionRevision((value) => value + 1);
      setMessage(`${piece.part} pegada`);
      return piece;
    };
    Object.assign(state, {
      recordHistory,
      undo,
      redo,
      copySelected,
      pasteClipboard,
      createProjectDocument,
      restoreProjectDocument,
      scheduleRecoverySave,
    });
    const flushRecovery = () => {
      if (document.visibilityState === "hidden") scheduleRecoverySave(true);
    };
    document.addEventListener("visibilitychange", flushRecovery);
    void Promise.all([listBrowserProjects(), loadRecoveryProject()])
      .then(async ([savedProjects, recovery]) => {
        setProjects(savedProjects);
        if (recovery) {
          await restoreProjectDocument(recovery);
          const existsInProjectManager = savedProjects.some(
            (project) => project.id === recovery.id,
          );
          setCurrentProjectSaved(existsInProjectManager);
          if (existsInProjectManager && recovery.savedRevision === undefined) {
            savedProjectRevisionRef.current = projectRevisionRef.current;
            setProjectDirty(false);
          }
          setMessage(
            language === "es"
              ? "Sesión anterior recuperada automáticamente"
              : "Previous session recovered automatically",
          );
        } else {
          setCurrentProjectSaved(false);
          setProjectDirty(false);
          scheduleRecoverySave(true, false);
        }
      })
      .catch(() => setRecoveryStatus("idle"));
    const down = (e: PointerEvent) => {
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(e.pointerId);
      previous = orbitStart = { x: e.clientX, y: e.clientY };
      moved = false;
      cast(e);
      if (e.button === 1) {
        e.preventDefault();
        const now = performance.now(),
          isDoubleMiddle =
            now - lastMiddleDown.time < 380 &&
            Math.hypot(e.clientX - lastMiddleDown.x, e.clientY - lastMiddleDown.y) < 8;
        lastMiddleDown = isDoubleMiddle
          ? { time: 0, x: 0, y: 0 }
          : { time: now, x: e.clientX, y: e.clientY };
        if (isDoubleMiddle) {
          pan = false;
          const hit = pickPiece();
          if (hit) {
            const bounds = new THREE.Box3().setFromObject(hit.piece.mesh),
              center = bounds.isEmpty()
                ? hit.point.clone()
                : bounds.getCenter(new THREE.Vector3()),
              sphere = bounds.isEmpty()
                ? new THREE.Sphere(center, 0.5)
                : bounds.getBoundingSphere(new THREE.Sphere()),
              verticalFov = THREE.MathUtils.degToRad(camera.fov),
              horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect),
              limitingFov = Math.min(verticalFov, horizontalFov),
              focusDistance = Math.max(
                1.6,
                (sphere.radius / Math.sin(limitingFov / 2)) * 1.18,
              ),
              viewDirection = camera.position.clone().sub(cameraTarget).normalize();
            if (viewDirection.lengthSq() < 0.5)
              viewDirection.set(0.55, 0.45, 0.7).normalize();
            cameraTarget.copy(center);
            camera.position.copy(center).addScaledVector(viewDirection, focusDistance);
            camera.lookAt(cameraTarget);
            setMessage(
              language === "es"
                ? `Cámara centrada en ${hit.piece.part}`
                : `Camera focused on ${hit.piece.part}`,
            );
          } else if (ray.intersectObject(floor)[0]) {
            cameraTarget.copy(defaultCameraTarget);
            camera.position.copy(defaultCameraPosition);
            camera.lookAt(cameraTarget);
            setMessage(
              language === "es"
                ? "Cámara restaurada a la vista original"
                : "Camera restored to the original view",
            );
          }
          return;
        }
        pan = true;
        return;
      }
      if (!state.running && state.pendingPlacement && e.button === 0) {
        const placed = state.pendingPlacement.pieces.length;
        state.pendingPlacement = undefined;
        const connections = verifyConnections();
        setMessage(`${placed} piezas colocadas · ${connections} conexiones detectadas`);
        if (placed > 0) scheduleRecoverySave();
        return;
      }
      const hit = pickPiece(),
        hitPiece = hit?.piece;
      orbit = e.button === 2 || e.altKey;
      altCandidate = e.altKey && e.button === 0 ? hitPiece : undefined;
      if (orbit) return;
      if (!state.running && rotationPivotHeld && e.button === 0 && hitPiece) {
        const selectedConnector = nearestConnectedPivot(hitPiece, e);
        if (!selectedConnector) {
          setMessage(
            language === "es"
              ? `${hitPiece.part} no tiene ninguna unión conectada que pueda usarse como pivote`
              : `${hitPiece.part} has no connected joint that can be used as a pivot`,
          );
          return;
        }
        const { connector, connection, anchorLocal } = selectedConnector;
        state.recordHistory();
        hitPiece.rotationPivotLocal = anchorLocal.clone();
        hitPiece.rotationPivotKey = jointPivotKey(connection);
        state.selected = hitPiece;
        pivotRotate = {
          piece: hitPiece,
          local: anchorLocal.clone(),
          axis: connector.axis.clone().normalize(),
          connector,
          connection,
          startX: e.clientX,
          startAbsoluteAngle: absoluteRotationAroundLocalAxis(hitPiece, connector.axis),
          startPosition: hitPiece.mesh.position.clone(),
          startQuaternion: hitPiece.mesh.quaternion.clone(),
          lastAppliedAngle: 0,
          prepared: false,
        };
        showRotationPivot = true;
        setSelectedId(hitPiece.id);
        setMessage(
          language === "es"
            ? `Pivote seleccionado en ${hitPiece.part} · arrastra para girar`
            : `Pivot selected on ${hitPiece.part} · drag to rotate`,
        );
        refreshDebug();
        scheduleRecoverySave();
        return;
      }
      if (!state.running && e.ctrlKey && e.button === 0 && hitPiece) {
        const selectedConnector = nearestScreenConnector(hitPiece, e);
        if (!selectedConnector) {
          setMessage(`${hitPiece.part} no tiene puntos de conexión`);
          return;
        }
        const { connector, anchorLocal } = selectedConnector,
          origin = hitPiece.mesh.localToWorld(anchorLocal.clone()),
          forced = e.shiftKey,
          line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([origin, origin]),
            new THREE.LineBasicMaterial({
              color: forced ? 0xff2d2d : 0xffee38,
              depthTest: false,
              depthWrite: false,
              transparent: true,
              opacity: 0.95,
            }),
          );
        const forceLabel = document.createElement("div"),
          hostBounds = host.getBoundingClientRect();
        forceLabel.className = `manual-connect-label${forced ? " forced" : ""}`;
        forceLabel.textContent = forced ? t.forceConnect : "CONNECT";
        forceLabel.style.left = `${e.clientX - hostBounds.left + 14}px`;
        forceLabel.style.top = `${e.clientY - hostBounds.top + 14}px`;
        host.appendChild(forceLabel);
        line.renderOrder = 60;
        scene.add(line);
        state.manualConnect = {
          piece: hitPiece,
          connector,
          anchorLocal,
          cursor: origin.clone(),
          plane: new THREE.Plane().setFromNormalAndCoplanarPoint(
            camera.getWorldDirection(new THREE.Vector3()),
            origin,
          ),
          line,
          label: forceLabel,
          forced,
          connectorsWereVisible: state.debug.connectors,
        };
        state.selected = hitPiece;
        state.debug.connectors = true;
        setSelectedId(hitPiece.id);
        setDebugViews((current) => ({ ...current, connectors: true }));
        setMessage(
          forced
            ? `${t.forceConnect}: ${hitPiece.part} · máximo 5 u`
            : `Connect manual: ${hitPiece.part} · suelta cerca de un punto compatible`,
        );
        refreshDebug();
        return;
      }
      if (state.running) {
        if (hit && hitPiece && !hitPiece.physicsIslandFixed && hitPiece.body) {
          state.selected = hitPiece;
          setSelectedId(hitPiece.id);
          const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
            line = document.createElementNS("http://www.w3.org/2000/svg", "polyline"),
            component = connectedPieces(hitPiece),
            label = document.createElement("div"),
            canvasBounds = canvas.getBoundingClientRect();
          overlay.classList.add("spring-overlay");
          overlay.setAttribute(
            "viewBox",
            `0 0 ${canvas.clientWidth} ${canvas.clientHeight}`,
          );
          line.setAttribute("fill", "none");
          line.setAttribute("stroke", "#ffb327");
          line.setAttribute("stroke-width", "3");
          line.setAttribute("stroke-linejoin", "round");
          line.setAttribute("stroke-linecap", "round");
          overlay.appendChild(line);
          label.className = "spring-force-label";
          host.appendChild(overlay);
          host.appendChild(label);
          spring = {
            piece: hitPiece,
            component,
            anchor: hitPiece.mesh.worldToLocal(hit.point.clone()),
            target: hit.point.clone(),
            plane: new THREE.Plane().setFromNormalAndCoplanarPoint(
              camera.getWorldDirection(new THREE.Vector3()),
              hit.point,
            ),
            overlay,
            line,
            label,
            cursorScreen: {
              x: e.clientX - canvasBounds.left,
              y: e.clientY - canvasBounds.top,
            },
            force: 0,
          };
          if (state.simLog)
            state.simLog.events.push(
              `[${((Date.now() - Date.parse(state.simLog.startedAt)) / 1000).toFixed(3)}s] drag-start ${hitPiece.part}; componente ${component.map((p) => p.part).join(",")}`,
            );
          updateSpring();
        }
        return;
      }
      if (hit && hitPiece) {
        moving = hitPiece;
        movedAxially = false;
        movingPrepared = false;
        state.selected = moving;
        setSelectedId(moving.id);
        movingStartPosition.copy(moving.mesh.position);
        movingStartPointer.set(e.clientX, e.clientY);
        const linearGuide = state.connections.find(
          (connection) =>
            (connection.a === moving || connection.b === moving) &&
            (connection.mode === "linear" ||
              connection.mode === "rotation-linear" ||
              connection.profile === "axle-cross" ||
              connection.profile === "axle-round"),
        );
        movingLinearAxis = linearGuide
          ? linearGuide.localAxisA
              .clone()
              .transformDirection(linearGuide.a.mesh.matrixWorld)
              .normalize()
          : undefined;
        const ground = ray.intersectObject(floor)[0];
        if (ground)
          moveOffset.set(
            moving.mesh.position.x - ground.point.x,
            moving.mesh.position.z - ground.point.z,
          );
      } else {
        state.selected = undefined;
        setSelectedId(null);
      }
    };

    const move = (e: PointerEvent) => {
      if (pivotRotate) {
        const rawAngle = (e.clientX - pivotRotate.startX) * 0.012,
          angleStep = THREE.MathUtils.degToRad(state.rotationSnapStep),
          requestedAngle = angleStep
            ? Math.round((pivotRotate.startAbsoluteAngle + rawAngle) / angleStep) *
                angleStep -
              pivotRotate.startAbsoluteAngle
            : rawAngle,
          angle =
            angleStep &&
            Math.abs(requestedAngle - pivotRotate.lastAppliedAngle) > angleStep + 1e-6
              ? pivotRotate.lastAppliedAngle +
                Math.sign(requestedAngle - pivotRotate.lastAppliedAngle) * angleStep
              : requestedAngle;
        pivotRotate.lastAppliedAngle = angle;
        if (Math.abs(angle) < 0.01) return;
        if (!pivotRotate.prepared) {
          pivotRotate.prepared = true;
          state.connections = state.connections.filter(
            (connection) =>
              connection === pivotRotate!.connection ||
              (connection.a !== pivotRotate!.piece &&
                connection.b !== pivotRotate!.piece),
          );
          rebalanceAllSmartDefaults(state);
        }
        pivotRotate.piece.mesh.position.copy(pivotRotate.startPosition);
        pivotRotate.piece.mesh.quaternion.copy(pivotRotate.startQuaternion);
        pivotRotate.piece.mesh.updateMatrixWorld(true);
        rotatePieceAroundLocalAxis(pivotRotate.piece, pivotRotate.axis, angle);
        moved = true;
        state.renderBatchesDirty = true;
        refreshDebug();
        return;
      }
      if (!state.running && state.pendingPlacement) {
        cast(e);
        const ground = ray.intersectObject(floor)[0];
        if (ground) {
          const target = new THREE.Vector3(
            state.gridStep
              ? Math.round(ground.point.x / state.gridStep) * state.gridStep
              : ground.point.x,
            0,
            state.gridStep
              ? Math.round(ground.point.z / state.gridStep) * state.gridStep
              : ground.point.z,
          );
          state.pendingPlacement.pieces.forEach((piece, index) => {
            piece.mesh.position.copy(target).add(state.pendingPlacement!.offsets[index]);
            piece.mesh.updateMatrixWorld(true);
          });
          state.renderBatchesDirty = true;
          refreshDebug();
        }
        return;
      }
      if (state.manualConnect) {
        moved = true;
        updateManualForceMode(e.shiftKey);
        cast(e);
        const selectedOrigin = state.manualConnect.piece.mesh.localToWorld(
            state.manualConnect.anchorLocal.clone(),
          ),
          candidate = ray.ray.at(
            camera.position.distanceTo(selectedOrigin),
            new THREE.Vector3(),
          );
        state.manualConnect.cursor.copy(candidate);
        state.manualConnect.line.geometry.setFromPoints([selectedOrigin, candidate]);
        state.manualConnect.line.geometry.attributes.position.needsUpdate = true;
        const hostBounds = host.getBoundingClientRect();
        state.manualConnect.label.style.left = `${e.clientX - hostBounds.left + 14}px`;
        state.manualConnect.label.style.top = `${e.clientY - hostBounds.top + 14}px`;
        return;
      }
      if (spring) {
        moved = true;
        cast(e);
        const anchor = spring.piece.mesh.localToWorld(spring.anchor.clone()),
          canvasBounds = canvas.getBoundingClientRect();
        spring.cursorScreen = {
          x: e.clientX - canvasBounds.left,
          y: e.clientY - canvasBounds.top,
        };
        spring.target.copy(
          ray.ray.at(camera.position.distanceTo(anchor), new THREE.Vector3()),
        );
        updateSpring();
        return;
      }
      if (pan) {
        camera.updateMatrixWorld(true);
        const dx = e.clientX - previous.x,
          dy = e.clientY - previous.y,
          distance = camera.position.distanceTo(cameraTarget),
          worldPerPixel =
            (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) /
            Math.max(1, canvas.clientHeight),
          right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0),
          up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1),
          translation = right
            .multiplyScalar(-dx * worldPerPixel)
            .add(up.multiplyScalar(dy * worldPerPixel));
        previous = { x: e.clientX, y: e.clientY };
        if (Math.hypot(dx, dy) > 0) moved = true;
        camera.position.add(translation);
        cameraTarget.add(translation);
        camera.lookAt(cameraTarget);
        return;
      }
      if (orbit) {
        const distance = Math.hypot(e.clientX - orbitStart.x, e.clientY - orbitStart.y),
          dx = e.clientX - previous.x,
          dy = e.clientY - previous.y;
        previous = { x: e.clientX, y: e.clientY };
        if (distance <= 5) return;
        moved = true;
        const s = new THREE.Spherical().setFromVector3(
          camera.position.clone().sub(cameraTarget),
        );
        s.theta -= dx * 0.006;
        s.phi = THREE.MathUtils.clamp(s.phi - dy * 0.006, 0.03, Math.PI - 0.03);
        const nextPosition = cameraTarget
          .clone()
          .add(new THREE.Vector3().setFromSpherical(s));
        camera.position.copy(nextPosition);
        camera.lookAt(cameraTarget);
        return;
      }
      if (moving) {
        if (!movingPrepared) {
          const pointerDistance = Math.hypot(
            e.clientX - movingStartPointer.x,
            e.clientY - movingStartPointer.y,
          );
          // A click only selects the piece. Connections are detached only
          // after an intentional drag passes this screen-space threshold.
          if (pointerDistance <= 5) return;
          state.recordHistory();
          movingPrepared = true;
          moved = true;
          state.connections = state.connections.filter(
            (connection) => connection.a !== moving && connection.b !== moving,
          );
          rebalanceAllSmartDefaults(state);
          setConnectionRevision((value) => value + 1);
        } else moved = true;
        const shiftActive = e.shiftKey || shiftHeld;
        if (shiftActive && movingLinearAxis) {
          movedAxially = true;
          const bounds = canvas.getBoundingClientRect(),
            project = (point: THREE.Vector3) => {
              const projected = point.clone().project(camera);
              return new THREE.Vector2(
                bounds.left + ((projected.x + 1) * bounds.width) / 2,
                bounds.top + ((1 - projected.y) * bounds.height) / 2,
              );
            },
            screenStart = project(movingStartPosition),
            screenEnd = project(movingStartPosition.clone().add(movingLinearAxis)),
            screenAxis = screenEnd.sub(screenStart),
            pixelsPerUnit = screenAxis.length(),
            pointerDelta = new THREE.Vector2(
              e.clientX - movingStartPointer.x,
              e.clientY - movingStartPointer.y,
            ),
            distance =
              pixelsPerUnit > 3
                ? pointerDelta.dot(screenAxis.normalize()) / pixelsPerUnit
                : -(e.clientY - movingStartPointer.y) * 0.015,
            snappedDistance = state.axleSnapStep
              ? Math.round(distance / state.axleSnapStep) * state.axleSnapStep
              : distance;
          moving.mesh.position
            .copy(movingStartPosition)
            .addScaledVector(movingLinearAxis, snappedDistance);
        } else if (shiftActive)
          moving.mesh.position.y = state.gridStep
            ? Math.round(
                (movingStartPosition.y - (e.clientY - movingStartPointer.y) * 0.0125) /
                  state.gridStep,
              ) * state.gridStep
            : movingStartPosition.y - (e.clientY - movingStartPointer.y) * 0.0125;
        else {
          cast(e);
          const ground = ray.intersectObject(floor)[0];
          if (ground) {
            moving.mesh.position.x = state.gridStep
              ? Math.round((ground.point.x + moveOffset.x) / state.gridStep) *
                state.gridStep
              : ground.point.x + moveOffset.x;
            moving.mesh.position.z = state.gridStep
              ? Math.round((ground.point.z + moveOffset.y) / state.gridStep) *
                state.gridStep
              : ground.point.z + moveOffset.y;
          }
        }
        previous = { x: e.clientX, y: e.clientY };
        state.renderBatchesDirty = true;
      }
    };

    const up = (e: PointerEvent) => {
      if (canvas.hasPointerCapture(e.pointerId))
        canvas.releasePointerCapture(e.pointerId);
      if (pivotRotate) {
        const rotated = pivotRotate;
        pivotRotate = undefined;
        showRotationPivot = false;
        if (rotated.prepared) {
          const correction = nearbyPivotConnectionCorrection(rotated);
          if (correction && Math.abs(correction.angle) > 1e-5)
            rotatePieceAroundLocalAxis(rotated.piece, rotated.axis, correction.angle);
          verifyPieceConnections(rotated.piece);
          if (rotated.piece.renderBatched) state.rebuildRenderBatches();
          else state.renderBatchesDirty = true;
          setMessage(
            language === "es"
              ? correction
                ? `${rotated.piece.part} ajustada y conectada con ${correction.other.part}`
                : `${rotated.piece.part} girada desde su conexión`
              : correction
                ? `${rotated.piece.part} snapped and connected to ${correction.other.part}`
                : `${rotated.piece.part} rotated around its connection`,
          );
        }
        refreshDebug();
        scheduleRecoverySave();
        return;
      }
      if (state.manualConnect) {
        const draft = state.manualConnect;
        cast(e);
        const canvasBounds = canvas.getBoundingClientRect(),
          maximumScreenDistance = 42;
        let best:
          | {
              piece: Piece;
              connector: MeshConnector;
              anchorLocal: THREE.Vector3;
              screenDistance: number;
              rayDistance: number;
            }
          | undefined;
        let rejectedByOrientation = false;
        for (const piece of state.pieces) {
          if (piece === draft.piece) continue;
          piece.mesh.updateMatrixWorld(true);
          for (const connector of piece.connectors) {
            if (!pairProfile(draft.connector, connector)) continue;
            const anchors =
              connector.role === "shaft" && connector.kind === "axle"
                ? axleSnapPoints(connector)
                : [{ local: connector.local, important: true }];
            for (const anchor of anchors) {
              const worldPoint = piece.mesh.localToWorld(anchor.local.clone()),
                projected = worldPoint.clone().project(camera);
              if (projected.z < -1 || projected.z > 1) continue;
              const screenX =
                  canvasBounds.left + ((projected.x + 1) * canvasBounds.width) / 2,
                screenY =
                  canvasBounds.top + ((1 - projected.y) * canvasBounds.height) / 2,
                screenDistance = Math.hypot(screenX - e.clientX, screenY - e.clientY),
                rayDistance = ray.ray.distanceToPoint(worldPoint);
              if (
                draft.forced &&
                screenDistance <= maximumScreenDistance &&
                !forceConnectorAxesCompatible(
                  draft.piece,
                  draft.connector,
                  piece,
                  connector,
                )
              ) {
                rejectedByOrientation = true;
                continue;
              }
              if (
                screenDistance <= maximumScreenDistance &&
                (!best ||
                  screenDistance < best.screenDistance - 0.5 ||
                  (Math.abs(screenDistance - best.screenDistance) <= 0.5 &&
                    rayDistance < best.rayDistance))
              )
                best = {
                  piece,
                  connector,
                  anchorLocal: anchor.local.clone(),
                  screenDistance,
                  rayDistance,
                };
            }
          }
        }
        let connected = false;
        if (best) {
          state.recordHistory();
          connected = draft.forced
            ? connectForced(
                draft.piece,
                draft.connector,
                draft.anchorLocal,
                best.piece,
                best.connector,
                best.anchorLocal,
              )
            : connectManual(
                draft.piece,
                draft.connector,
                draft.anchorLocal,
                best.piece,
                best.connector,
                best.anchorLocal,
              );
        }
        scene.remove(draft.line);
        draft.label.remove();
        draft.line.geometry.dispose();
        (draft.line.material as THREE.Material).dispose();
        state.manualConnect = undefined;
        state.debug.connectors = draft.connectorsWereVisible;
        setDebugViews((current) => ({
          ...current,
          connectors: draft.connectorsWereVisible,
        }));
        if (connected && draft.piece.renderBatched) state.rebuildRenderBatches();
        setConnectionRevision((value) => value + 1);
        setMessage(
          connected && best
            ? draft.forced
              ? `${t.forceConnect}: ${draft.piece.part} ↔ ${best.piece.part} · ${draft.piece.mesh.localToWorld(draft.anchorLocal.clone()).distanceTo(best.piece.mesh.localToWorld(best.anchorLocal.clone())).toFixed(2)} u`
              : `Connect manual: ${draft.piece.part} ↔ ${best.piece.part} · verificando el resto de uniones…`
            : draft.forced && best
              ? language === "es"
                ? "Force Connect cancelado: la separación supera 5 u"
                : "Force Connect cancelled: separation exceeds 5 u"
              : draft.forced && rejectedByOrientation
                ? language === "es"
                  ? "Force Connect rechazado: los ejes de los conectores no están alineados"
                  : "Force Connect rejected: connector axes are not aligned"
                : "Connect manual cancelado: no hay un punto compatible bajo el cursor",
        );
        refreshDebug();
        if (connected && !draft.forced) {
          const connections = verifyPieceConnections(draft.piece);
          setMessage(
            `Connect manual: ${draft.piece.part} ↔ ${best!.piece.part} · ${connections} uniones verificadas`,
          );
        }
        scheduleRecoverySave();
        return;
      }
      if (spring) {
        const released = spring;
        const releasedBodies = new Set<RAPIER.RigidBody>();
        released.component.forEach((p) => {
          if (p.body && !p.physicsIslandFixed && !releasedBodies.has(p.body)) {
            releasedBodies.add(p.body);
            clampMotion(p, 3.5, 4.5);
            p.body.setLinearDamping(0.35);
            p.body.setAngularDamping(0.65);
          }
        });
        if (state.simLog)
          state.simLog.events.push(
            `[${((Date.now() - Date.parse(state.simLog.startedAt)) / 1000).toFixed(3)}s] drag-end ${released.piece.part}; fuerza y par eliminados, velocidades limitadas`,
          );
        released.overlay.remove();
        released.label.remove();
        spring = undefined;
      }
      const toggledFixed = Boolean(orbit && !moved && altCandidate);
      if (toggledFixed && altCandidate) {
        state.recordHistory();
        toggleFixed(altCandidate);
      }
      orbit = false;
      pan = false;
      altCandidate = undefined;
      const movedPiece = moving;
      if (moving && moved) {
        if (!movedAxially) connect(moving);
        verifyPieceConnections(moving);
      }
      moving = undefined;
      movingPrepared = false;
      movingLinearAxis = undefined;
      movedAxially = false;
      if (movedPiece?.renderBatched && moved) state.rebuildRenderBatches();
      setConnectionRevision((value) => value + 1);
      refreshDebug();
      if (toggledFixed || (movedPiece && moved)) scheduleRecoverySave();
    };

    const drop = (e: DragEvent) => {
      e.preventDefault();
      if (state.running) return;
      try {
        const p = JSON.parse(
          e.dataTransfer?.getData("application/x-ldraw-part") || "",
        ) as CatalogPart;
        cast(e);
        const ground = ray.intersectObject(floor)[0];
        if (ground) {
          state.recordHistory();
          void addPart(
            p,
            new THREE.Vector3(
              state.gridStep
                ? Math.round(ground.point.x / state.gridStep) * state.gridStep
                : ground.point.x,
              0,
              state.gridStep
                ? Math.round(ground.point.z / state.gridStep) * state.gridStep
                : ground.point.z,
            ),
          ).then((piece) => {
            if (!piece) return;
            connect(piece);
            verifyPieceConnections(piece);
            scheduleRecoverySave();
          });
          if (
            (p.origin === "catalog-search" || p.origin === "model-import") &&
            !belongsToDefaultPalette(p)
          )
            setImported((old) =>
              old.some((x) => x.part === p.part && x.color === p.color)
                ? old
                : [p, ...old],
            );
        }
      } catch {
        setMessage("No se pudo soltar esa pieza");
      }
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const offset = camera.position.clone().sub(cameraTarget),
        nextDistance = THREE.MathUtils.clamp(
          offset.length() * (e.deltaY > 0 ? 1.08 : 0.92),
          0.5,
          120,
        );
      camera.position.copy(cameraTarget.clone().add(offset.setLength(nextDistance)));
      camera.lookAt(cameraTarget);
    };

    const resize = () => {
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      state.renderScale = renderScale;
      renderer.setPixelRatio(nativePixelRatio * renderScale);
      renderer.setSize(host.clientWidth, host.clientHeight);
    };

    const keydown = (e: KeyboardEvent) => {
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
        shiftHeld = true;
        updateManualForceMode(true);
      }
      const target = e.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
      if (e.code === "KeyR") {
        rotationPivotHeld = true;
        e.preventDefault();
        return;
      }
      const command = e.ctrlKey || e.metaKey;
      if (command && !e.altKey) {
        if (e.code === "KeyS") {
          e.preventDefault();
          if (!e.repeat) saveShortcutRef.current();
          return;
        }
        const redoShortcut = e.code === "KeyY" || (e.code === "KeyZ" && e.shiftKey);
        if (e.code === "KeyZ" || redoShortcut) {
          e.preventDefault();
          if (!e.repeat) void (redoShortcut ? state.redo() : state.undo());
          return;
        }
        if (e.code === "KeyC") {
          e.preventDefault();
          if (!e.repeat) state.copySelected();
          return;
        }
        if (e.code === "KeyV") {
          e.preventDefault();
          if (!e.repeat) void state.pasteClipboard();
          return;
        }
      }
      if (state.running || !state.selected) return;
      const piece = state.selected,
        code = e.code;
      if (code === "Delete") {
        e.preventDefault();
        state.recordHistory();
        scene.remove(piece.mesh);
        if (piece.lockSprite) scene.remove(piece.lockSprite);
        state.pieces = state.pieces.filter((item) => item !== piece);
        state.rebuildRenderBatches();
        state.connections = state.connections.filter(
          (connection) => connection.a !== piece && connection.b !== piece,
        );
        rebalanceAllSmartDefaults(state);
        state.selected = undefined;
        refreshDebug();
        setSelectedId(null);
        setCount(state.pieces.length);
        setConnectionRevision((value) => value + 1);
        setMessage(`${piece.part} eliminada`);
        return;
      }
      if (e.repeat) return;
      const rotation =
        code === "KeyW" || code === "ArrowUp"
          ? { axis: "x" as const, angle: -Math.PI / 2 }
          : code === "KeyS" || code === "ArrowDown"
            ? { axis: "x" as const, angle: Math.PI / 2 }
            : code === "KeyA" || code === "ArrowLeft"
              ? { axis: "y" as const, angle: -Math.PI / 2 }
              : code === "KeyD" || code === "ArrowRight"
                ? { axis: "y" as const, angle: Math.PI / 2 }
                : code === "KeyQ"
                  ? { axis: "z" as const, angle: -Math.PI / 2 }
                  : code === "KeyE"
                    ? { axis: "z" as const, angle: Math.PI / 2 }
                    : undefined;
      if (!rotation) return;
      e.preventDefault();
      state.recordHistory();
      rotatePieceAroundPivotWithGlobalSnap(
        piece,
        rotation.axis,
        rotation.angle,
        state.rotationSnapStep,
      );
      const disconnected = removeMisalignedForcedConnections(state, piece);
      piece.mesh.updateMatrixWorld(true);
      if (piece.renderBatched) state.rebuildRenderBatches();
      else state.renderBatchesDirty = true;
      refreshDebug();
      if (disconnected) setConnectionRevision((value) => value + 1);
      setSelectedId(piece.id);
      setMessage(
        disconnected
          ? language === "es"
            ? `${piece.part} rotada · ${disconnected} unión forzada desconectada por desalineación`
            : `${piece.part} rotated · ${disconnected} forced joint disconnected after misalignment`
          : `${piece.part} rotada 90° · ${rotation.axis.toUpperCase()}`,
      );
    };

    const keyup = (e: KeyboardEvent) => {
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
        shiftHeld = false;
        updateManualForceMode(false);
      }
      if (e.code === "KeyR") rotationPivotHeld = false;
    };

    const clearModifiers = () => {
      shiftHeld = false;
      rotationPivotHeld = false;
      updateManualForceMode(false);
    };

    const canvas = renderer.domElement;
    let pointerMoveStarted = 0;
    const beginMeasuredMove = () => {
      pointerMoveStarted = performance.now();
    };

    const measuredMove = (event: PointerEvent) => {
      const started = pointerMoveStarted || performance.now();
      try {
        move(event);
      } finally {
        state.pendingInputMs = Math.max(
          state.pendingInputMs,
          performance.now() - started,
        );
      }
    };
    canvas.tabIndex = 0;
    canvas.style.outline = "none";
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", beginMeasuredMove, true);
    canvas.addEventListener("pointermove", measuredMove);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("dragover", (e) => e.preventDefault());
    canvas.addEventListener("drop", drop);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("auxclick", (e) => e.preventDefault());
    window.addEventListener("resize", resize);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("keyup", keyup, true);
    window.addEventListener("blur", clearModifiers);
    const maximumFps = 60,
      minimumFrameIntervalMs = 1000 / maximumFps;
    let frame = 0,
      lastFrameStarted = performance.now(),
      lastAnimationFrame = lastFrameStarted,
      fpsWindowStarted = lastFrameStarted,
      fpsFrames = 0,
      previousFrameWorkMs = 0;
    const pendingGpuTimers: {
      query: WebGLQuery;
      sample: FramePerformanceSample;
    }[] = [];
    const clock = new THREE.Clock();
    // --- Render and simulation frame loop ----------------------------------
    // Rapier advances only while state.running; rendering and input overlays
    // continue in edit mode using the same requestAnimationFrame loop.
    const animate = (animationFrameTime: number) => {
      frame = requestAnimationFrame(animate);
      const animationInterval = animationFrameTime - lastAnimationFrame;
      if (animationInterval < minimumFrameIntervalMs) return;
      lastAnimationFrame =
        animationFrameTime - (animationInterval % minimumFrameIntervalMs);
      const frameStarted = performance.now(),
        frameIntervalMs = frameStarted - lastFrameStarted;
      lastFrameStarted = frameStarted;
      if (gpuTimerExtension) {
        while (pendingGpuTimers.length) {
          const pending = pendingGpuTimers[0],
            available = gl.getQueryParameter(pending.query, gl.QUERY_RESULT_AVAILABLE),
            disjoint = gl.getParameter(gpuTimerExtension.GPU_DISJOINT_EXT);
          if (disjoint) {
            pendingGpuTimers.splice(0).forEach(({ query }) => gl.deleteQuery(query));
            break;
          }
          if (!available) break;
          pending.sample.gpuMs =
            Number(gl.getQueryParameter(pending.query, gl.QUERY_RESULT)) / 1_000_000;
          gl.deleteQuery(pending.query);
          pendingGpuTimers.shift();
        }
      }
      fpsFrames++;
      if (frameStarted - fpsWindowStarted >= 500) {
        const fps = (fpsFrames * 1000) / (frameStarted - fpsWindowStarted),
          counter = fpsRef.current;
        let nextScale = renderScale;
        if (fps < 15) {
          healthyFpsWindows = 0;
          lowFpsWindows++;
          if (lowFpsWindows >= 2) {
            nextScale = Math.max(0.5, renderScale - 0.1);
            lowFpsWindows = 0;
          }
        } else if (fps > 30) {
          lowFpsWindows = 0;
          healthyFpsWindows++;
          if (healthyFpsWindows >= 4) {
            nextScale = Math.min(1, renderScale + 0.05);
            healthyFpsWindows = 0;
          }
        } else {
          healthyFpsWindows = 0;
          lowFpsWindows = 0;
        }
        if (Math.abs(nextScale - renderScale) > 0.001) {
          renderScale = nextScale;
          state.renderScale = renderScale;
          renderer.setPixelRatio(nativePixelRatio * renderScale);
          renderer.setSize(host.clientWidth, host.clientHeight, false);
        }
        if (counter) {
          counter.textContent = `${Math.round(fps)} FPS · ${(1000 / Math.max(fps, 0.1)).toFixed(1)} ms · ${Math.round(renderScale * 100)}%`;
          counter.dataset.level = fps < 15 ? "low" : fps < 40 ? "medium" : "high";
        }
        fpsWindowStarted = frameStarted;
        fpsFrames = 0;
      }
      let forceResetMs = 0,
        springMs = 0,
        jointForcesMs = 0,
        worldStepMs = 0,
        syncMs = 0,
        physicsLogMs = 0,
        batchMs = 0,
        activeBodies = 0,
        sleepingBodies = 0;
      if (state.running && state.world) {
        try {
          let phaseStarted = performance.now();
          const forceStepSeconds = Math.min(
            1 / 60,
            Math.max(1 / 240, frameIntervalMs / 1000),
          );
          // Do not call RigidBody.isSleeping() here. Rapier's WASM bindings can
          // still have the rigid-body set borrowed after a world rebuild (most
          // visibly after placing a freshly downloaded catalog part). Querying
          // isSleeping in that state triggers wasm-bindgen's "recursive use of
          // an object" guard and the render loop then reports the same error on
          // every frame. Handles are plain numbers, so they are also a safer way
          // to deduplicate all pieces that share one rigid-island body.
          const steppedBodyHandles = new Set<number>();
          state.sleepingBodyHandles.clear();
          state.pieces.forEach((p) => {
            if (!p.body || steppedBodyHandles.has(p.body.handle)) return;
            steppedBodyHandles.add(p.body.handle);
            if (p.physicsIslandFixed) {
              sleepingBodies++;
            } else {
              activeBodies++;
            }
          });
          forceResetMs = performance.now() - phaseStarted;
          phaseStarted = performance.now();
          if (spring?.piece.body && !spring.piece.physicsIslandFixed) {
            const anchor = spring.piece.mesh.localToWorld(spring.anchor.clone()),
              delta = spring.target.clone().sub(anchor);
            if (delta.length() > 3.5) delta.setLength(3.5);
            const velocity = spring.piece.body.linvel(),
              acceleration = delta.multiplyScalar(42).addScaledVector(
                new THREE.Vector3(velocity.x, velocity.y, velocity.z),
                // Critical damping for k=42 (2 * sqrt(42) ≈ 13).
                // This prevents the mouse spring from storing energy against
                // a collider and launching the dragged assembly past it.
                -13,
              ),
              movingMass = Math.max(0.25, spring.piece.body.mass());
            if (acceleration.length() > 90) acceleration.setLength(90);
            const force = acceleration.multiplyScalar(Math.max(0.25, movingMass)),
              totalForce = force.length();
            spring.piece.body.applyImpulseAtPoint(
              {
                x: force.x * forceStepSeconds,
                y: force.y * forceStepSeconds,
                z: force.z * forceStepSeconds,
              },
              { x: anchor.x, y: anchor.y, z: anchor.z },
              true,
            );
            spring.force = totalForce;
            if (state.simLog)
              state.simLog.maxSpringForce = Math.max(
                state.simLog.maxSpringForce,
                totalForce,
              );
            updateSpring();
          }
          springMs = performance.now() - phaseStarted;
          phaseStarted = performance.now();
          for (const connection of state.connections) {
            if (
              (connection.mode !== "linear" && connection.mode !== "rotation-linear") ||
              !connection.a.body ||
              !connection.b.body ||
              connection.a.body === connection.b.body
            )
              continue;
            const axis = connection.localAxisA
                .clone()
                .transformDirection(connection.a.mesh.matrixWorld)
                .normalize(),
              velocityA = connection.a.body.linvel(),
              velocityB = connection.b.body.linvel(),
              relativeVelocity = new THREE.Vector3(
                velocityB.x - velocityA.x,
                velocityB.y - velocityA.y,
                velocityB.z - velocityA.z,
              ),
              relativeSpeed = relativeVelocity.dot(axis),
              // A free connector should only have a slight guide resistance.
              // Contact friction already accounts for surfaces rubbing together.
              damping =
                state.physicsSettings.axleSlidingFriction *
                (connection.mode === "linear" ? 1 : 0.375),
              forceMagnitude = THREE.MathUtils.clamp(
                relativeSpeed * damping,
                -0.35,
                0.35,
              ),
              frictionForce = axis.clone().multiplyScalar(forceMagnitude);
            // The generic rotation+linear guide can keep the bodies visually
            // aligned while a perpendicular velocity from gravity/contact keeps
            // accumulating. When a bush reaches its physical stop, Rapier may
            // convert that hidden velocity into a large axial depenetration.
            // Project only the relative velocity onto the permitted axle axis;
            // common motion, axial sliding and axial rotation remain untouched.
            const perpendicularVelocity = relativeVelocity.addScaledVector(
              axis,
              -relativeSpeed,
            );
            if (perpendicularVelocity.lengthSq() > 1e-10) {
              if (connection.a.physicsIslandFixed) {
                connection.b.body.setLinvel(
                  {
                    x: velocityB.x - perpendicularVelocity.x,
                    y: velocityB.y - perpendicularVelocity.y,
                    z: velocityB.z - perpendicularVelocity.z,
                  },
                  true,
                );
              } else if (connection.b.physicsIslandFixed) {
                connection.a.body.setLinvel(
                  {
                    x: velocityA.x + perpendicularVelocity.x,
                    y: velocityA.y + perpendicularVelocity.y,
                    z: velocityA.z + perpendicularVelocity.z,
                  },
                  true,
                );
              } else {
                connection.a.body.setLinvel(
                  {
                    x: velocityA.x + perpendicularVelocity.x * 0.5,
                    y: velocityA.y + perpendicularVelocity.y * 0.5,
                    z: velocityA.z + perpendicularVelocity.z * 0.5,
                  },
                  true,
                );
                connection.b.body.setLinvel(
                  {
                    x: velocityB.x - perpendicularVelocity.x * 0.5,
                    y: velocityB.y - perpendicularVelocity.y * 0.5,
                    z: velocityB.z - perpendicularVelocity.z * 0.5,
                  },
                  true,
                );
              }
            }
            if (!connection.b.physicsIslandFixed)
              connection.b.body.applyImpulse(
                {
                  x: -frictionForce.x * forceStepSeconds,
                  y: -frictionForce.y * forceStepSeconds,
                  z: -frictionForce.z * forceStepSeconds,
                },
                true,
              );
            if (!connection.a.physicsIslandFixed)
              connection.a.body.applyImpulse(
                {
                  x: frictionForce.x * forceStepSeconds,
                  y: frictionForce.y * forceStepSeconds,
                  z: frictionForce.z * forceStepSeconds,
                },
                true,
              );
            if (
              connection.mode === "rotation-linear" &&
              (connection.profile === "axle-cross" ||
                connection.profile === "axle-round") &&
              state.physicsSettings.axleRotationFriction > 0
            ) {
              const angularA = connection.a.body.angvel(),
                angularB = connection.b.body.angvel(),
                relativeAngularSpeed =
                  (angularB.x - angularA.x) * axis.x +
                  (angularB.y - angularA.y) * axis.y +
                  (angularB.z - angularA.z) * axis.z,
                torqueMagnitude = THREE.MathUtils.clamp(
                  relativeAngularSpeed * state.physicsSettings.axleRotationFriction,
                  -1,
                  1,
                ),
                torque = axis.clone().multiplyScalar(torqueMagnitude);
              if (!connection.b.physicsIslandFixed)
                connection.b.body.applyTorqueImpulse(
                  {
                    x: -torque.x * forceStepSeconds,
                    y: -torque.y * forceStepSeconds,
                    z: -torque.z * forceStepSeconds,
                  },
                  true,
                );
              if (!connection.a.physicsIslandFixed)
                connection.a.body.applyTorqueImpulse(
                  {
                    x: torque.x * forceStepSeconds,
                    y: torque.y * forceStepSeconds,
                    z: torque.z * forceStepSeconds,
                  },
                  true,
                );
            }
          }
          jointForcesMs = performance.now() - phaseStarted;
          phaseStarted = performance.now();
          const frameTimestep = Math.min(clock.getDelta(), 1 / 60),
            gearSubsteps = state.gearLinks.length ? 4 : 1;
          state.world.timestep = frameTimestep / gearSubsteps;
          for (let substep = 0; substep < gearSubsteps; substep++) {
            projectGearVelocities();
            state.world.step(state.physicsEventQueue, state.physicsHooks);
            projectGearVelocities();
          }
          // Mutating a rigid body's pose between two world.step calls can keep
          // Rapier's internal body set borrowed and trigger wasm-bindgen's unsafe
          // aliasing guard. Apply the hard tooth-phase projection only after all
          // physics substeps have completed.
          enforceGearLinks();
          worldStepMs = performance.now() - phaseStarted;
          phaseStarted = performance.now();
          const startup = performance.now() - (state.simStartedMs ?? 0) < 350;
          const gearedBodies = new Set<RAPIER.RigidBody>();
          state.gearLinks.forEach((link) => {
            if (link.a.value.body) gearedBodies.add(link.a.value.body);
            if (link.b.value.body) gearedBodies.add(link.b.value.body);
          });
          const clampedBodies = new Set<RAPIER.RigidBody>();
          state.pieces.forEach((p) => {
            if (
              p.body &&
              !state.sleepingBodyHandles.has(p.body.handle) &&
              !clampedBodies.has(p.body)
            ) {
              clampedBodies.add(p.body);
              clampMotion(
                p,
                startup ? 2 : 12,
                gearedBodies.has(p.body) ? (startup ? 20 : 80) : startup ? 3 : 14,
              );
            }
          });
          state.pieces.forEach((p) => {
            if (
              p.body &&
              (!state.largeSimulation ||
                startup ||
                !state.sleepingBodyHandles.has(p.body.handle))
            ) {
              const t = p.body.translation(),
                q = p.body.rotation(),
                bodyRotation = new THREE.Quaternion(q.x, q.y, q.z, q.w),
                offset = (p.physicsOffset ?? new THREE.Vector3())
                  .clone()
                  .applyQuaternion(bodyRotation);
              p.mesh.position.set(t.x + offset.x, t.y + offset.y, t.z + offset.z);
              p.mesh.quaternion.copy(
                bodyRotation.clone().multiply(p.physicsBase ?? new THREE.Quaternion()),
              );
            }
          });
          enforceAxialStops();
          state.dynamicConnectionFrame++;
          if (state.dynamicConnectionFrame % 8 === 0) updateDynamicMechanisms();
          syncMs = performance.now() - phaseStarted;
          phaseStarted = performance.now();
          if (state.simLog) {
            const time = (Date.now() - Date.parse(state.simLog.startedAt)) / 1000;
            if (time >= (state.nextLogSample ?? 0)) {
              const bodies = state.pieces.flatMap((p) => {
                if (!p.body) return [];
                const v = p.body.linvel(),
                  w = p.body.angvel(),
                  linear = Math.hypot(v.x, v.y, v.z),
                  angular = Math.hypot(w.x, w.y, w.z);
                state.simLog!.maxLinearSpeed = Math.max(
                  state.simLog!.maxLinearSpeed,
                  linear,
                );
                state.simLog!.maxAngularSpeed = Math.max(
                  state.simLog!.maxAngularSpeed,
                  angular,
                );
                return [
                  {
                    id: p.id,
                    part: p.part,
                    fixed: p.physicsIslandFixed ?? p.fixed,
                    position: p.mesh.position.toArray(),
                    rotation: p.mesh.quaternion.toArray(),
                    linearVelocity: [v.x, v.y, v.z],
                    angularVelocity: [w.x, w.y, w.z],
                  },
                ];
              });
              state.simLog.samples.push({ time, bodies });
              state.nextLogSample = time + (state.largeSimulation ? 0.75 : 0.2);
            }
          }
          physicsLogMs = performance.now() - phaseStarted;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          console.error("Sim Studio physics frame stopped safely:", error);
          state.simLog?.events.push(`Error físico recuperado: ${detail}`);
          state.running = false;
          state.world = undefined;
          state.physicsHooks = undefined;
          state.physicsEventQueue = undefined;
          state.physicsJoints.clear();
          if (spring) {
            spring.overlay.remove();
            spring.label.remove();
            spring = undefined;
          }
          state.snapshot?.forEach((snapshot) => {
            snapshot.piece.mesh.position.copy(snapshot.position);
            snapshot.piece.mesh.quaternion.copy(snapshot.rotation);
          });
          state.pieces.forEach((piece) => {
            piece.body = undefined;
            piece.physicsOffset = undefined;
            piece.physicsBase = undefined;
            piece.physicsIsland = undefined;
            piece.physicsIslandFixed = undefined;
          });
          state.snapshot = undefined;
          state.snapshotConnections = undefined;
          state.renderBatchesDirty = true;
          setRunning(false);
          setMessage(
            language === "es"
              ? `Simulación detenida de forma segura: ${detail}`
              : `Simulation stopped safely: ${detail}`,
          );
        }
      } else clock.getDelta();
      let phaseStarted = performance.now();
      if (state.running || state.renderBatchesDirty) state.updateRenderBatches();
      batchMs = performance.now() - phaseStarted;
      phaseStarted = performance.now();
      state.updateDebug();
      const debugMs = performance.now() - phaseStarted;
      phaseStarted = performance.now();
      state.pieces.forEach((p) => {
        if (p.fixed && p.lockSprite) {
          const box = new THREE.Box3().setFromObject(p.mesh),
            center = box.getCenter(new THREE.Vector3());
          p.lockSprite.position.set(center.x, box.max.y + 0.55, center.z);
        }
      });
      const locksMs = performance.now() - phaseStarted;
      phaseStarted = performance.now();
      const gridX =
          Math.round(camera.position.x / GRID_RECENTER_STEP) * GRID_RECENTER_STEP,
        gridZ = Math.round(camera.position.z / GRID_RECENTER_STEP) * GRID_RECENTER_STEP;
      if (state.grid.position.x !== gridX || state.grid.position.z !== gridZ) {
        state.grid.position.x = gridX;
        state.grid.position.z = gridZ;
        const axisX = state.grid.getObjectByName("grid-axis-x"),
          axisZ = state.grid.getObjectByName("grid-axis-z");
        if (axisX) axisX.position.z = -gridZ;
        if (axisZ) axisZ.position.x = -gridX;
        floor.position.x = gridX;
        floor.position.z = gridZ;
        state.grid.updateMatrixWorld();
        floor.updateMatrixWorld();
      }
      const viewingFloorFromBelow = camera.position.y < 0;
      if (viewingFloorFromBelow !== floorViewedFromBelow) {
        floorViewedFromBelow = viewingFloorFromBelow;
        const floorMaterial = floor.material as THREE.MeshStandardMaterial;
        floorMaterial.opacity = viewingFloorFromBelow ? 0.06 : 1;
        floorMaterial.depthWrite = !viewingFloorFromBelow;
        floor.receiveShadow = !viewingFloorFromBelow;
        floorMaterial.needsUpdate = true;
      }
      const gpuQuery =
        gpuTimerExtension &&
        state.performanceTrace.totalFrames % 4 === 0 &&
        pendingGpuTimers.length < 16
          ? gl.createQuery()
          : null;
      if (gpuQuery && gpuTimerExtension)
        gl.beginQuery(gpuTimerExtension.TIME_ELAPSED_EXT, gpuQuery);
      renderer.render(scene, camera);
      if (gpuQuery && gpuTimerExtension) gl.endQuery(gpuTimerExtension.TIME_ELAPSED_EXT);
      const renderMs = performance.now() - phaseStarted,
        trace = state.performanceTrace,
        sample: FramePerformanceSample = {
          elapsedMs: performance.now() - trace.startedAtMs,
          frameIntervalMs,
          betweenFramesMs: Math.max(0, frameIntervalMs - previousFrameWorkMs),
          totalMs: performance.now() - frameStarted,
          inputMs: state.pendingInputMs,
          forceResetMs,
          springMs,
          jointForcesMs,
          worldStepMs,
          syncMs,
          physicsLogMs,
          connectionScanMs: state.pendingConnectionMs,
          batchMs,
          debugMs,
          locksMs,
          renderMs,
          gpuMs: null,
          pieces: state.pieces.length,
          connections: state.connections.length,
          activeBodies,
          sleepingBodies,
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          lines: renderer.info.render.lines,
          resolutionScale: state.renderScale,
        };
      previousFrameWorkMs = sample.totalMs;
      if (gpuQuery) pendingGpuTimers.push({ query: gpuQuery, sample });
      state.pendingInputMs = 0;
      state.pendingConnectionMs = 0;
      trace.totalFrames++;
      if (trace.samples.length < 600) trace.samples.push(sample);
      else {
        trace.samples[trace.cursor] = sample;
        trace.cursor = (trace.cursor + 1) % trace.samples.length;
      }
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame);
      if (renderBatchRebuildFrame) cancelAnimationFrame(renderBatchRebuildFrame);
      pendingGpuTimers.forEach(({ query }) => gl.deleteQuery(query));
      window.removeEventListener("resize", resize);
      resizeObserver.disconnect();
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("keyup", keyup, true);
      window.removeEventListener("blur", clearModifiers);
      renderer.dispose();
      document.removeEventListener("visibilitychange", flushRecovery);
      state.physicsEventQueue = undefined;
      host.removeChild(canvas);
      appRef.current = null;
    };
  }, []);

  useEffect(() => {
    const state = appRef.current;
    if (!state) return;
    const dark = theme === "dark",
      background = new THREE.Color(dark ? 0x202328 : 0xdfe7ed);
    state.scene.background = background;
    if (state.scene.fog instanceof THREE.Fog) state.scene.fog.color.copy(background);
    (state.floor.material as THREE.MeshStandardMaterial).color.setHex(
      dark ? 0x2b3035 : 0xcbd6dd,
    );
    state.scene.remove(state.grid);
    state.grid.traverse((object) => {
      const renderable = object as THREE.Object3D & {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
      };
      renderable.geometry?.dispose();
      const materials = renderable.material
        ? Array.isArray(renderable.material)
          ? renderable.material
          : [renderable.material]
        : [];
      materials.forEach((material) => material.dispose());
    });
    state.grid = createStudioGrid(dark);
    state.scene.add(state.grid);
    state.renderer.setClearColor(background);
  }, [theme]);

  const visible = useMemo(
    () =>
      category === "imported" && search
        ? results.filter((p) =>
            (p.part + " " + p.name).toLowerCase().includes(search.toLowerCase()),
          )
        : results,
    [category, results, search],
  );

  const dragPart = (e: React.DragEvent, p: CatalogPart) => {
    e.dataTransfer.setData("application/x-ldraw-part", JSON.stringify(p));
    e.dataTransfer.effectAllowed = "copy";
  };

  const addReference = async () => {
    const part = reference.trim().replace(/\.dat$/i, "");
    if (!part) return;
    setCatalogBusy(true);
    const normalizedPart = part.toLowerCase(),
      palettePart = resolvePaletteRequest(normalizedPart),
      packaged = paletteParts.find(
        (candidate) =>
          candidate.part.toLowerCase() === palettePart ||
          candidate.modelPart?.toLowerCase() === palettePart,
      );
    let found: CatalogPart = packaged
      ? {
          ...packaged,
          origin: "catalog-search",
          sourceKind: packaged.geometry ? "packaged-cache" : "ldraw-network",
          requestedPart: part,
          catalogReturnedPart: packaged.part,
          resolvedPart: packaged.modelPart ?? packaged.part,
          catalogQuery: part,
        }
      : {
          part,
          name: `Pieza LDraw ${part}`,
          kind: "beam",
          color: 71,
          origin: "catalog-search",
          sourceKind: "ldraw-network",
          requestedPart: part,
          resolvedPart: part,
          catalogQuery: part,
        };
    if (!packaged)
      try {
        const d = (await fetch(`/api/parts?q=${encodeURIComponent(part)}`).then((r) =>
          r.json(),
        )) as { items?: CatalogPart[] };
        const exact = d.items?.find(
          (x: { part: string }) => x.part.toLowerCase() === normalizedPart,
        );
        if (exact)
          found = {
            ...exact,
            kind: kindFor("", exact.name),
            color: exact.color ?? 71,
            origin: "catalog-search",
            sourceKind: exact.geometry ? "packaged-cache" : "external-catalog",
            requestedPart: part,
            catalogReturnedPart: exact.part,
            resolvedPart: exact.modelPart ?? exact.part,
            catalogQuery: part,
          };
      } catch {}
    if (!belongsToDefaultPalette(found)) {
      setImported((old) =>
        old.some((x) => x.part === found.part) ? old : [found, ...old],
      );
      setCategory("imported");
    } else if (packaged?.family) setCategory(packaged.family);
    setReference("");
    setCatalogBusy(false);
    void appRef.current?.preloadPart(found);
  };

  const rotate = (axis: "x" | "y" | "z", dir = 1) => {
    const s = appRef.current,
      p = s?.selected;
    if (!s || !p || running) return;
    s.recordHistory();
    const radians = THREE.MathUtils.degToRad(rotationAngle * dir);
    rotatePieceAroundPivotWithGlobalSnap(p, axis, radians, s.rotationSnapStep);
    const disconnected = removeMisalignedForcedConnections(s, p);
    if (p.renderBatched) s.rebuildRenderBatches();
    else s.renderBatchesDirty = true;
    s.refreshDebug();
    if (disconnected) setConnectionRevision((value) => value + 1);
    setSelectedId(p.id);
    if (disconnected)
      setMessage(
        language === "es"
          ? `${disconnected} unión forzada desconectada por desalineación`
          : `${disconnected} forced joint disconnected after misalignment`,
      );
  };

  const nudge = (axis: "x" | "y" | "z", amount: number) => {
    const s = appRef.current,
      p = s?.selected;
    if (!s || !p || running) return;
    s.recordHistory();
    p.mesh.position[axis] += amount;
    if (p.renderBatched) s.rebuildRenderBatches();
    else s.renderBatchesDirty = true;
    s.refreshDebug();
    setSelectedId(p.id);
  };

  const changeSelectedColor = async (color: number) => {
    const s = appRef.current,
      piece = s?.selected;
    if (!s || !piece || running || piece.color === color) return;
    s.recordHistory();
    setMessage(t.changingColor);
    const changed = await s.recolorPart(piece, color);
    setMessage(
      changed ? `${t.colorChanged} · LDraw ${color}` : `${t.colorError} · LDraw ${color}`,
    );
    setSelectedId(piece.id);
    s.scheduleRecoverySave();
  };

  const remove = () => {
    const s = appRef.current,
      p = s?.selected;
    if (!s || !p || running) return;
    s.recordHistory();
    s.scene.remove(p.mesh);
    if (p.lockSprite) s.scene.remove(p.lockSprite);
    s.pieces = s.pieces.filter((x) => x !== p);
    s.rebuildRenderBatches();
    s.connections = s.connections.filter((c) => c.a !== p && c.b !== p);
    rebalanceAllSmartDefaults(s);
    s.selected = undefined;
    s.refreshDebug();
    setSelectedId(null);
    setCount(s.pieces.length);
  };

  const reset = () => {
    const s = appRef.current;
    if (!s || physicsTransitionRef.current) return;
    if (!s.running) s.recordHistory();
    s.running = false;
    s.connectionScanVersion++;
    s.bulkConnecting = false;
    s.disposeRenderBatches();
    s.pieces.forEach((p) => {
      s.scene.remove(p.mesh);
      if (p.lockSprite) s.scene.remove(p.lockSprite);
    });
    s.pieces = [];
    s.connections = [];
    s.gearLinks = [];
    s.differentialLinks = [];
    s.gearAngles.clear();
    s.gearBodyRotations.clear();
    s.gearPhases.clear();
    s.physicsJoints.clear();
    s.dynamicNoContactPairs.clear();
    s.contactExclusions.clear();
    s.contactCandidates.clear();
    s.rigidIslandByPiece = undefined;
    s.createPhysicsJoint = undefined;
    s.connectionModes.clear();
    s.pendingPlacement = undefined;
    s.snapshot = undefined;
    s.snapshotConnections = undefined;
    s.physicsEventQueue = undefined;
    s.world = undefined;
    s.physicsHooks = undefined;
    s.contactFilterStats = undefined;
    s.selected = undefined;
    s.refreshDebug();
    setRunning(false);
    setSelectedId(null);
    setCount(0);
    s.scheduleRecoverySave();
  };

  // --- Physics world lifecycle ---------------------------------------------
  // Starting builds rigid islands, colliders and joints. Stopping restores the
  // exact pre-simulation editor snapshot instead of keeping simulated poses.

  const physics = async () => {
    const s = appRef.current;
    if (!s || physicsTransitionRef.current) return;
    if (projectRestoringRef.current || s.bulkLoading) {
      setMessage(
        language === "es"
          ? "Espera a que termine la carga antes de simular"
          : "Wait for loading to finish before starting the simulation",
      );
      return;
    }
    physicsTransitionRef.current = true;
    setPhysicsBusy(true);
    try {
      if (!s.running) {
        await RAPIER.init();
        if (appRef.current !== s) return;
        s.snapshot = s.pieces.map((piece) => ({
          piece,
          position: piece.mesh.position.clone(),
          rotation: piece.mesh.quaternion.clone(),
        }));
        s.snapshotConnections = s.connections.map((connection) => ({
          ...connection,
          point: connection.point.clone(),
          axis: connection.axis.clone(),
          localAxisA: connection.localAxisA.clone(),
          localPointA: connection.localPointA?.clone(),
          localPointB: connection.localPointB?.clone(),
        }));
        s.simLog = {
          startedAt: new Date().toISOString(),
          connections: s.connections.map((c) => ({
            a: c.a.part,
            b: c.b.part,
            type: `${c.profile}:${c.mode}`,
            point: c.point.toArray(),
          })),
          samples: [],
          maxLinearSpeed: 0,
          maxAngularSpeed: 0,
          maxSpringForce: 0,
          events: [
            `Inicio con ${s.pieces.length} cuerpos y ${s.connections.length} uniones`,
            `Estabilización inicial activa durante 0.35 s`,
          ],
        };
        s.nextLogSample = 0;
        s.simStartedMs = performance.now();
        const parent = new Map<Piece, Piece>();
        s.pieces.forEach((piece) => parent.set(piece, piece));
        const findRoot = (piece: Piece) => {
            let root = piece;
            while (parent.get(root) !== root) root = parent.get(root)!;
            let current = piece;
            while (parent.get(current) !== root) {
              const next = parent.get(current)!;
              parent.set(current, root);
              current = next;
            }
            return root;
          },
          mergeRigidPieces = (a: Piece, b: Piece) => {
            const rootA = findRoot(a),
              rootB = findRoot(b);
            if (rootA !== rootB) parent.set(rootB, rootA);
          };
        s.connections.forEach((connection) => {
          if (structuralMode === "rigid" && connection.mode === "fixed")
            mergeRigidPieces(connection.a, connection.b);
        });
        const rigidIslandMap = new Map<Piece, Piece[]>();
        s.pieces.forEach((piece) => {
          const root = findRoot(piece),
            island = rigidIslandMap.get(root) ?? [];
          island.push(piece);
          rigidIslandMap.set(root, island);
        });
        const rigidIslands = [...rigidIslandMap.values()],
          rigidIslandByPiece = new Map<Piece, Piece[]>();
        rigidIslands.forEach((island) =>
          island.forEach((piece) => rigidIslandByPiece.set(piece, island)),
        );
        s.gearAngles.clear();
        s.gearBodyRotations.clear();
        s.gearPhases.clear();
        s.differentialLinks = detectDifferentialLinks(s.pieces, rigidIslandByPiece);
        const differentialExclusions = differentialPairKeys(s.differentialLinks);
        s.gearLinks = detectGearLinks(
          s.pieces,
          rigidIslandByPiece,
          differentialExclusions,
        );
        const fixedConnectionCount = s.connections.filter(
            (connection) => connection.mode === "fixed",
          ).length,
          stiffnessRatio = structuralStiffness / 100,
          largeSimulation = rigidIslands.length > 250 || s.pieces.length > 800,
          solverIterations = largeSimulation
            ? 5 + Math.round(stiffnessRatio * 5)
            : 4 + Math.round(stiffnessRatio * 12),
          internalPgsIterations = 1 + Math.round(stiffnessRatio * 3),
          additionalSolverIterations = largeSimulation
            ? Math.round(stiffnessRatio * 2)
            : Math.round(stiffnessRatio * 4),
          world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
        s.largeSimulation = largeSimulation;
        world.integrationParameters.numSolverIterations = solverIterations;
        world.integrationParameters.numInternalPgsIterations = internalPgsIterations;
        world.integrationParameters.maxCcdSubsteps = largeSimulation ? 1 : 2;
        world.integrationParameters.contact_natural_frequency = 18;
        world.integrationParameters.normalizedAllowedLinearError = THREE.MathUtils.lerp(
          0.025,
          0.002,
          stiffnessRatio,
        );
        s.simLog.events[0] = `Inicio con ${s.pieces.length} piezas agrupadas en ${rigidIslands.length} cuerpos rígidos y ${s.connections.length} uniones`;
        s.simLog.events.push(
          `Modo estructural ${structuralMode}; rigidez ${structuralStiffness}%`,
          `Fricción: piezas ${s.physicsSettings.pieceFriction}, goma ${s.physicsSettings.rubberFriction}, pines libres ${s.physicsSettings.frictionlessPinRotation}, ejes lineal ${s.physicsSettings.axleSlidingFriction}, ejes rotación ${s.physicsSettings.axleRotationFriction}; holgura ${s.physicsSettings.axleTolerance} studs`,
          `Solver: ${solverIterations} iteraciones × ${internalPgsIterations} PGS interno + ${additionalSolverIterations} adicionales`,
          `Engranajes: relación rígida de velocidad y bloqueo de fase dental en 4 subpasos`,
          structuralMode === "rigid"
            ? `${fixedConnectionCount} conexiones fijas fusionadas en islas rígidas compuestas`
            : `${fixedConnectionCount} conexiones fijas conservadas como joints entre piezas`,
          `${s.gearLinks.length} pares de engranajes enlazados por solapamiento de malla verde y relación de dientes`,
          `${s.differentialLinks.length} diferenciales activos (salida izquierda + salida derecha = 2 × carcasa)`,
        );
        const colliderOwners = new Map<number, Piece>(),
          traversedConnectorPairs = detectShaftTraversals(s.pieces),
          noContactPiecePairs = buildConnectorContactExclusions(
            s.connections,
            rigidIslandByPiece,
            traversedConnectorPairs,
          );
        differentialExclusions.forEach((key) => noContactPiecePairs.add(key));
        s.rigidIslandByPiece = rigidIslandByPiece;
        s.contactExclusions.clear();
        noContactPiecePairs.forEach((key) => s.contactExclusions.add(key));
        s.simLog.events.push(
          `${traversedConnectorPairs.length} pares eje/pin ↔ pieza atravesada detectados geométricamente`,
          `${noContactPiecePairs.size} pares pin/eje ↔ grupo excluidos de colisión`,
        );
        s.physicsEventQueue = new RAPIER.EventQueue(true);
        s.contactFilterStats = { tested: 0, rejected: 0 };
        s.physicsHooks = {
          filterContactPair(colliderA, colliderB) {
            const pieceA = colliderOwners.get(colliderA),
              pieceB = colliderOwners.get(colliderB);
            if (s.contactFilterStats) s.contactFilterStats.tested++;
            const pairKey = pieceA && pieceB ? contactPairKey(pieceA, pieceB) : undefined;
            if (
              pieceA &&
              pieceB &&
              pairKey &&
              (s.contactExclusions.has(pairKey) || s.dynamicNoContactPairs.has(pairKey))
            ) {
              if (s.contactFilterStats) s.contactFilterStats.rejected++;
              return null;
            }
            if (
              pieceA &&
              pieceB &&
              pairKey &&
              (pieceA.dynamicAxleConnections || pieceB.dynamicAxleConnections)
            )
              s.contactCandidates.set(pairKey, { a: pieceA, b: pieceB });
            return RAPIER.SolverFlags.COMPUTE_IMPULSE;
          },
          filterIntersectionPair() {
            return true;
          },
        };
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(5000, 0.15, 5000)
            .setTranslation(0, -0.2, 0)
            .setFriction(CONTACT_FRICTION.floor)
            .setCollisionGroups(
              interactionGroups(
                COLLISION_GROUP_NON_GEAR,
                COLLISION_GROUP_NON_GEAR | COLLISION_GROUP_GEAR_NORMAL,
              ),
            ),
        );
        rigidIslands.forEach((island) => {
          const origin = island
              .reduce((sum, piece) => sum.add(piece.mesh.position), new THREE.Vector3())
              .multiplyScalar(1 / island.length),
            islandFixed = island.some((piece) => piece.fixed),
            additionalMass = island.reduce(
              (sum, piece) => sum + (piece.kind === "motor" ? 2 : 0.65),
              0,
            ),
            desc = islandFixed
              ? RAPIER.RigidBodyDesc.fixed()
              : RAPIER.RigidBodyDesc.dynamic()
                  .setLinearDamping(0.55)
                  .setAngularDamping(0.95)
                  .setCcdEnabled(!largeSimulation)
                  .setSoftCcdPrediction(largeSimulation ? 0 : 0.1)
                  .setAdditionalSolverIterations(additionalSolverIterations)
                  .setAdditionalMass(additionalMass);
          desc.setTranslation(origin.x, origin.y, origin.z);
          const rb = world.createRigidBody(desc);
          island.forEach((p) => {
            const physicsOffset = p.mesh.position.clone().sub(origin),
              physicsBase = p.mesh.quaternion.clone();
            p.physicsOffset = physicsOffset;
            p.physicsBase = physicsBase;
            p.physicsIsland = island;
            p.physicsIslandFixed = islandFixed;
            p.body = rb;
            const finishPieceCollider = (
              collider: RAPIER.ColliderDesc,
              gearLayer: boolean,
              density: number,
            ) => {
              if (gearLayer)
                collider.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
              collider
                .setFriction(
                  gearLayer
                    ? CONTACT_FRICTION.gearMesh
                    : p.kind === "wheel" && !p.gear
                      ? s.physicsSettings.rubberFriction
                      : s.physicsSettings.pieceFriction,
                )
                .setRestitution(0)
                .setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS)
                .setCollisionGroups(
                  gearLayer
                    ? interactionGroups(
                        COLLISION_GROUP_GEAR_MESH,
                        COLLISION_GROUP_GEAR_MESH,
                      )
                    : p.gear
                      ? interactionGroups(
                          COLLISION_GROUP_GEAR_NORMAL,
                          COLLISION_GROUP_NON_GEAR,
                        )
                      : interactionGroups(
                          COLLISION_GROUP_NON_GEAR,
                          COLLISION_GROUP_NON_GEAR | COLLISION_GROUP_GEAR_NORMAL,
                        ),
                )
                .setDensity(density);
              const createdCollider = world.createCollider(collider, rb);
              colliderOwners.set(createdCollider.handle, p);
            };
            const createPieceCollider = (
              primitive: CollisionPrimitive,
              gearLayer: boolean,
            ) => {
              // Bushes, axle joiners and gears often sit in an exactly sized
              // axial gap. Keep the authored/debug maps unchanged, but apply the
              // configured clearance only to the normal collider. The magenta
              // layer is exclusively gear-to-gear contact and keeps its authored
              // thickness unchanged.
              const axleClearance =
                !gearLayer && (p.gear || /bush|axle joiner/i.test(p.name))
                  ? s.physicsSettings.axleTolerance
                  : 0;
              const collider =
                primitive.shape === "box"
                  ? RAPIER.ColliderDesc.cuboid(
                      primitive.size!.x / 2,
                      primitive.size!.y / 2,
                      primitive.size!.z / 2,
                    )
                  : RAPIER.ColliderDesc.cylinder(
                      Math.max(0.01, primitive.halfHeight! - axleClearance / 2),
                      primitive.radius!,
                    );
              const center = physicsOffset
                  .clone()
                  .add(primitive.center.clone().applyQuaternion(physicsBase)),
                rotation = physicsBase.clone().multiply(primitive.rotation);
              collider.setTranslation(center.x, center.y, center.z).setRotation(rotation);
              finishPieceCollider(
                collider,
                gearLayer,
                gearLayer
                  ? 0
                  : (p.kind === "motor" ? 1.7 : 1) / Math.max(1, p.colliders.length),
              );
            };
            const exactMesh = p.exactCollider
              ? exactTriangleMeshForPiece(p, physicsOffset, physicsBase)
              : undefined;
            if (exactMesh)
              finishPieceCollider(
                RAPIER.ColliderDesc.trimesh(
                  exactMesh.vertices,
                  exactMesh.indices,
                  RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES |
                    RAPIER.TriMeshFlags.MERGE_DUPLICATE_VERTICES |
                    RAPIER.TriMeshFlags.DELETE_DEGENERATE_TRIANGLES |
                    RAPIER.TriMeshFlags.DELETE_DUPLICATE_TRIANGLES,
                ),
                false,
                // The rigid body already receives an explicit LEGO-like mass.
                // LDraw surfaces are not always watertight, so deriving mass
                // from their enclosed volume would be unstable.
                0,
              );
            else
              p.colliders.forEach((primitive) => createPieceCollider(primitive, false));
            p.gearColliders.forEach((primitive) => createPieceCollider(primitive, true));
          });
        });
        // Establish the reference orientation before the first physics step.
        // Otherwise the first movement becomes the target phase and is never
        // corrected, which creates a small slip every time simulation starts.
        s.gearLinks.forEach((link) => {
          s.gearPhases.set(gearLinkKey(link), 0);
          for (const piece of [link.a.value, link.b.value]) {
            const body = piece.body;
            if (!body || s.gearBodyRotations.has(body.handle)) continue;
            const rotation = body.rotation();
            s.gearBodyRotations.set(
              body.handle,
              new THREE.Quaternion(
                rotation.x,
                rotation.y,
                rotation.z,
                rotation.w,
              ).normalize(),
            );
          }
        });
        let movingJointCount = 0,
          redundantMovingJoints = 0;
        const movingGuideJoints = new Map<string, string>();
        s.physicsJoints.clear();
        s.dynamicNoContactPairs.clear();
        s.contactCandidates.clear();
        const createPhysicsJoint = (c: Connection) => {
          if (!c.a.body || !c.b.body) return;
          if (structuralMode === "rigid" && c.mode === "fixed" && c.a.body === c.b.body)
            return;
          if (c.a.body === c.b.body) {
            redundantMovingJoints++;
            return;
          }
          const positionA = c.a.body.translation(),
            positionB = c.b.body.translation(),
            rotationA = c.a.body.rotation(),
            rotationB = c.b.body.rotation(),
            inverseRotationA = new THREE.Quaternion(
              rotationA.x,
              rotationA.y,
              rotationA.z,
              rotationA.w,
            ).invert(),
            inverseRotationB = new THREE.Quaternion(
              rotationB.x,
              rotationB.y,
              rotationB.z,
              rotationB.w,
            ).invert(),
            forcedPivot =
              c.forced && c.localPointB
                ? c.b.mesh.localToWorld(c.localPointB.clone())
                : undefined,
            // A forced joint represents a virtual extension between the two red
            // points. Rapier still needs one common pivot; using the shaft point
            // for both local anchors preserves the current visual offset instead
            // of pulling or teleporting the pieces together at simulation start.
            worldAnchorA = forcedPivot ?? c.point,
            worldAnchorB = forcedPivot ?? c.point,
            a = worldAnchorA
              .clone()
              .sub(new THREE.Vector3(positionA.x, positionA.y, positionA.z))
              .applyQuaternion(inverseRotationA),
            b = worldAnchorB
              .clone()
              .sub(new THREE.Vector3(positionB.x, positionB.y, positionB.z))
              .applyQuaternion(inverseRotationB),
            worldAxis = c.axis.clone().normalize(),
            axis = worldAxis.clone().applyQuaternion(inverseRotationA),
            worldFrame = new THREE.Quaternion().setFromUnitVectors(
              new THREE.Vector3(1, 0, 0),
              worldAxis,
            ),
            frameA = inverseRotationA.clone().multiply(worldFrame),
            frameB = inverseRotationB.clone().multiply(worldFrame),
            dynamicAxle =
              (c.profile === "axle-cross" || c.profile === "axle-round") &&
              c.b.dynamicAxleConnections;
          if (c.mode === "linear" || c.mode === "rotation-linear") {
            const axisKey = worldAxis.clone();
            if (
              axisKey.x < -1e-6 ||
              (Math.abs(axisKey.x) <= 1e-6 && axisKey.y < -1e-6) ||
              (Math.abs(axisKey.x) <= 1e-6 &&
                Math.abs(axisKey.y) <= 1e-6 &&
                axisKey.z < 0)
            )
              axisKey.multiplyScalar(-1);
            const handles = [c.a.body.handle, c.b.body.handle].sort(
                (left, right) => left - right,
              ),
              guideKey = `${handles[0]}:${handles[1]}:${c.mode}:${axisKey.x.toFixed(3)}:${axisKey.y.toFixed(3)}:${axisKey.z.toFixed(3)}`,
              existingConnectionId = movingGuideJoints.get(guideKey);
            if (existingConnectionId && s.physicsJoints.has(existingConnectionId)) {
              redundantMovingJoints++;
              return;
            }
            movingGuideJoints.set(guideKey, c.id);
          }
          let joint: RAPIER.JointData;
          if (c.mode === "rotation" || c.mode === "motor")
            joint = RAPIER.JointData.revolute(a, b, axis);
          else if (c.mode === "linear") joint = RAPIER.JointData.prismatic(a, b, axis);
          else if (c.mode === "rotation-linear")
            joint = RAPIER.JointData.generic(
              a,
              b,
              axis,
              RAPIER.JointAxesMask.LinY |
                RAPIER.JointAxesMask.LinZ |
                RAPIER.JointAxesMask.AngY |
                RAPIER.JointAxesMask.AngZ,
            );
          else joint = RAPIER.JointData.fixed(a, frameA, b, frameB);
          joint.frame1 = frameA;
          joint.frame2 = frameB;
          const created = world.createImpulseJoint(joint, c.a.body, c.b.body, true);
          movingJointCount++;
          created.setContactsEnabled(true);
          if (c.mode === "motor")
            (created as RAPIER.RevoluteImpulseJoint).configureMotorVelocity(
              c.motorSpeed,
              c.motorForce,
            );
          else if (c.mode === "rotation" && c.b.frictionPin)
            (created as RAPIER.RevoluteImpulseJoint).configureMotorVelocity(0, 3.5);
          else if (
            c.mode === "rotation" &&
            frictionlessPinRefs.has(c.b.part) &&
            s.physicsSettings.frictionlessPinRotation > 0
          )
            (created as RAPIER.RevoluteImpulseJoint).configureMotorVelocity(
              0,
              s.physicsSettings.frictionlessPinRotation,
            );
          if (c.mode === "linear" && !dynamicAxle) {
            const limit = Math.max(0.15, c.travel / 2);
            (created as RAPIER.PrismaticImpulseJoint).setLimits(-limit, limit);
          }
          s.physicsJoints.set(c.id, created);
          return created;
        };
        s.createPhysicsJoint = createPhysicsJoint;
        s.connections.forEach(createPhysicsJoint);
        if (redundantMovingJoints)
          s.simLog.events.push(
            `${redundantMovingJoints} uniones móviles internas redundantes omitidas`,
          );
        s.world = world;
        s.running = true;
        setRunning(true);
        setMessage(
          `${rigidIslands.length} cuerpos rígidos · ${movingJointCount} articulaciones móviles · ${
            largeSimulation
              ? "modo de rendimiento para ensamblaje grande"
              : "precisión completa"
          }`,
        );
      } else {
        s.running = false;
        s.gearLinks = [];
        s.differentialLinks = [];
        s.gearAngles.clear();
        s.gearBodyRotations.clear();
        s.gearPhases.clear();
        s.physicsJoints.clear();
        s.dynamicNoContactPairs.clear();
        s.contactExclusions.clear();
        s.contactCandidates.clear();
        s.rigidIslandByPiece = undefined;
        s.createPhysicsJoint = undefined;
        if (s.simLog) {
          s.simLog.endedAt = new Date().toISOString();
          s.simLog.duration =
            (Date.parse(s.simLog.endedAt) - Date.parse(s.simLog.startedAt)) / 1000;
          s.simLog.events.push(
            `Fin: velocidad lineal máxima ${s.simLog.maxLinearSpeed.toFixed(3)}, angular ${s.simLog.maxAngularSpeed.toFixed(3)}, fuerza de resorte ${s.simLog.maxSpringForce.toFixed(3)}`,
          );
          if (s.contactFilterStats)
            s.simLog.events.push(
              `Filtro de contactos: ${s.contactFilterStats.tested} pares comprobados; ${s.contactFilterStats.rejected} contactos eje/pin ↔ pieza anulados`,
            );
          const encoded = JSON.stringify(s.simLog, null, 2);
          try {
            localStorage.setItem("sim-studio:physics-log", encoded);
          } catch {}
          setLastLog(encoded);
        }
        s.snapshot?.forEach((x) => {
          x.piece.mesh.position.copy(x.position);
          x.piece.mesh.quaternion.copy(x.rotation);
          x.piece.body = undefined;
          x.piece.physicsOffset = undefined;
          x.piece.physicsBase = undefined;
          x.piece.physicsIsland = undefined;
          x.piece.physicsIslandFixed = undefined;
        });
        if (s.snapshotConnections) {
          s.connections = s.snapshotConnections.map((connection) => {
            const configured = s.connectionModes.get(connection.id);
            return {
              ...connection,
              point: connection.point.clone(),
              axis: connection.axis.clone(),
              localAxisA: connection.localAxisA.clone(),
              localPointA: connection.localPointA?.clone(),
              localPointB: connection.localPointB?.clone(),
              mode: configured?.mode ?? connection.mode,
              motorSpeed: configured?.motorSpeed ?? connection.motorSpeed,
              motorForce: configured?.motorForce ?? connection.motorForce,
              userConfigured: configured?.userConfigured ?? connection.userConfigured,
            };
          });
          setConnectionRevision((value) => value + 1);
        }
        s.renderBatchesDirty = true;
        s.snapshot = undefined;
        s.snapshotConnections = undefined;
        s.physicsEventQueue = undefined;
        s.world = undefined;
        s.physicsHooks = undefined;
        s.contactFilterStats = undefined;
        s.largeSimulation = undefined;
        s.simStartedMs = undefined;
        s.refreshDebug();
        setRunning(false);
        setMessage("Simulación detenida · estado restaurado · log actualizado");
      }
    } finally {
      physicsTransitionRef.current = false;
      setPhysicsBusy(false);
    }
  };

  // --- LDraw / Studio import and export ------------------------------------

  const importModel = async (file: File) => {
    const s = appRef.current;
    if (!s || s.running || physicsTransitionRef.current) return;
    const empty: ImportDraft = {
        fileName: file.name,
        status: "reading",
        progress: 0,
        total: 0,
        paletteCount: 0,
        externalCount: 0,
        placements: [],
      },
      token = ++importTokenRef.current,
      stillActive = () => importTokenRef.current === token;
    setImportDraft(empty);
    try {
      const source = file.name.toLowerCase().endsWith(".io")
          ? extractStudioLDraw(await file.arrayBuffer())
          : await file.text(),
        rows = parseLDR(source);
      if (!stillActive()) return;
      if (!rows.length) throw new Error("El archivo no contiene piezas LDraw");
      const references = [...new Set(rows.map((row) => row.part.toLowerCase()))],
        paletteMatches = new Map<string, CatalogPart[]>();
      for (const part of paletteParts) {
        for (const reference of [part.part, part.modelPart].filter(Boolean)) {
          const key = reference!.toLowerCase(),
            matches = paletteMatches.get(key) ?? [];
          matches.push(part);
          paletteMatches.set(key, matches);
        }
        for (const [alias, target] of Object.entries(paletteRequestAliases)) {
          if (
            target === part.part.toLowerCase() ||
            target === part.modelPart?.toLowerCase()
          ) {
            const matches = paletteMatches.get(alias) ?? [];
            matches.push(part);
            paletteMatches.set(alias, matches);
          }
        }
      }
      const paletteReferences = references.filter((reference) =>
          paletteMatches.has(reference),
        ),
        externalReferences = references.filter(
          (reference) => !paletteMatches.has(reference),
        );
      setImportDraft({
        ...empty,
        status: "palette",
        total: references.length,
        paletteCount: paletteReferences.length,
        externalCount: externalReferences.length,
      });
      let paletteLoaded = 0;
      const paletteToLoad = paletteReferences.flatMap(
        (reference) => paletteMatches.get(reference) ?? [],
      );
      await Promise.all(
        [
          ...new Map(
            paletteToLoad.map((part) => [`${part.part}:${part.color}`, part]),
          ).values(),
        ].map(async (part) => {
          await s.preloadPart(part);
          if (!stillActive()) return;
          paletteLoaded++;
          setImportDraft((draft) =>
            draft
              ? {
                  ...draft,
                  progress: Math.min(paletteLoaded, paletteReferences.length),
                }
              : draft,
          );
        }),
      );
      if (!stillActive()) return;
      setImportDraft((draft) =>
        draft
          ? { ...draft, status: "external", progress: paletteReferences.length }
          : draft,
      );
      let externalItems: CatalogPart[] = [];
      if (externalReferences.length)
        try {
          const response = await fetch(
            `/api/parts?refs=${encodeURIComponent(externalReferences.join(","))}`,
            { signal: AbortSignal.timeout(15_000) },
          );
          if (response.ok) {
            const data = (await response.json()) as { items?: CatalogPart[] };
            externalItems = data.items ?? [];
          }
        } catch {}
      if (!stillActive()) return;
      let externalLoaded = 0;
      const externalMap = new Map(
          externalItems.map((part) => [part.part.toLowerCase(), part]),
        ),
        catalogFor = (row: LDrawPlacement): CatalogPart => {
          const reference = row.part.toLowerCase(),
            paletteOptions = paletteMatches.get(reference),
            exactPalette = paletteOptions?.find((part) => part.color === row.color),
            palette = exactPalette ?? paletteOptions?.[0],
            external = externalMap.get(reference);
          if (palette)
            return {
              ...palette,
              color: row.color,
              geometry: exactPalette?.geometry ?? palette.geometry,
              sourceColor: exactPalette?.color ?? palette.color,
              origin: "model-import",
              sourceKind: palette.geometry ? "packaged-cache" : "ldraw-network",
              requestedPart: row.part,
              catalogReturnedPart: palette.part,
              resolvedPart: palette.modelPart ?? palette.part,
              importFile: file.name,
            };
          return {
            ...(external ?? {}),
            part: row.part,
            name: external?.name ?? `LDraw ${row.part}`,
            kind: kindFor("", external?.name ?? row.part),
            color: row.color,
            sourceColor: external?.color ?? 71,
            origin: "model-import",
            sourceKind: external?.geometry
              ? "packaged-cache"
              : external
                ? "external-catalog"
                : "ldraw-network",
            requestedPart: row.part,
            catalogReturnedPart: external?.part,
            resolvedPart: external?.modelPart ?? external?.part ?? row.part,
            catalogQuery: row.part,
            importFile: file.name,
          };
        },
        externalToLoad = externalReferences.map((reference) => {
          const item = externalMap.get(reference);
          return {
            ...(item ?? {}),
            part: item?.part ?? reference,
            name: item?.name ?? `LDraw ${reference}`,
            kind: kindFor("", item?.name ?? reference),
            color: item?.color ?? 71,
            sourceColor: item?.color ?? 71,
            origin: "model-import",
            sourceKind: item?.geometry
              ? "packaged-cache"
              : item
                ? "external-catalog"
                : "ldraw-network",
            requestedPart: reference,
            catalogReturnedPart: item?.part,
            resolvedPart: item?.modelPart ?? item?.part ?? reference,
            catalogQuery: reference,
            importFile: file.name,
          } as CatalogPart;
        });
      await Promise.all(
        externalToLoad.map(async (part) => {
          await s.preloadPart(part);
          if (!stillActive()) return;
          externalLoaded++;
          setImportDraft((draft) =>
            draft
              ? {
                  ...draft,
                  progress: Math.min(
                    paletteReferences.length + externalLoaded,
                    draft.total,
                  ),
                }
              : draft,
          );
        }),
      );
      if (!stillActive()) return;
      const placements = rows.map((row) => {
        const converted = ldrawToScenePlacement(row),
          [a, b, c, d, e, f, g, h, i] = converted.matrix,
          matrix = new THREE.Matrix4().set(
            a,
            b,
            c,
            0,
            d,
            e,
            f,
            0,
            g,
            h,
            i,
            0,
            0,
            0,
            0,
            1,
          );
        return {
          catalog: catalogFor(row),
          source: row,
          position: new THREE.Vector3().fromArray(converted.position),
          rotation: new THREE.Quaternion().setFromRotationMatrix(matrix),
        };
      });
      setImportDraft((draft) =>
        draft
          ? { ...draft, status: "preview", progress: draft.total, placements }
          : draft,
      );
      const preview = await s.renderImportPreview(placements);
      if (!stillActive()) return;
      setImportDraft((draft) =>
        draft ? { ...draft, status: "ready", placements, preview } : draft,
      );
    } catch (error) {
      if (!stillActive()) return;
      setImportDraft((draft) => ({
        ...(draft ?? empty),
        status: "error",
        error: error instanceof Error ? error.message : "No se pudo importar el modelo",
      }));
    }
  };

  const placeImportedModel = async () => {
    const draft = importDraft,
      s = appRef.current;
    if (!draft || draft.status !== "ready" || !s) return;
    importTokenRef.current++;
    setImportDraft(null);
    reset();
    const pieces: Piece[] = [];
    s.bulkLoading = true;
    try {
      for (let index = 0; index < draft.placements.length; index++) {
        const placement = draft.placements[index],
          piece = await s.addPart(
            placement.catalog,
            placement.position,
            placement.rotation,
          );
        if (piece) pieces.push(piece);
        if (index % 40 === 39)
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    } finally {
      s.bulkLoading = false;
    }
    const importedCatalog = [
      ...new Map(
        draft.placements.map((placement) => [
          `${placement.catalog.part}:${placement.catalog.color}`,
          placement.catalog,
        ]),
      ).values(),
    ].filter((part) => !belongsToDefaultPalette(part));
    setImported((old) => {
      const merged = new Map(old.map((part) => [`${part.part}:${part.color}`, part]));
      importedCatalog.forEach((part) => merged.set(`${part.part}:${part.color}`, part));
      return [...merged.values()];
    });
    setCount(s.pieces.length);
    if (!pieces.length) {
      setMessage(
        language === "es"
          ? "No se pudo colocar ninguna pieza del modelo"
          : "No model parts could be placed",
      );
      return;
    }
    // Temporary performance mode: imported models keep their LDraw position
    // and are finalized immediately instead of following the pointer.
    s.pendingPlacement = undefined;
    pieces.forEach((piece) => {
      piece.mesh.visible = true;
      piece.mesh.updateMatrixWorld(true);
    });
    const modelBounds = new THREE.Box3();
    pieces.forEach((piece) => modelBounds.expandByObject(piece.mesh));
    const groundY = s.grid.position.y;
    if (!modelBounds.isEmpty() && modelBounds.min.y < groundY) {
      const lift = groundY - modelBounds.min.y;
      pieces.forEach((piece) => {
        piece.mesh.position.y += lift;
        piece.mesh.updateMatrixWorld(true);
      });
    }
    s.rebuildRenderBatches();
    let connections = s.connections.length;
    if (AUTO_CONNECTIONS_ENABLED) {
      setMessage(
        language === "es"
          ? "Optimizando conexiones por lotes…"
          : "Optimizing connections in batches…",
      );
      connections = await s.verifyConnectionsAsync();
    }
    s.refreshDebug();
    s.scheduleRecoverySave();
    setMessage(
      language === "es"
        ? AUTO_CONNECTIONS_ENABLED
          ? `${pieces.length} piezas importadas directamente · ${connections} conexiones detectadas`
          : `${pieces.length} piezas importadas · conexiones automáticas desactivadas`
        : AUTO_CONNECTIONS_ENABLED
          ? `${pieces.length} parts imported directly · ${connections} connections detected`
          : `${pieces.length} parts imported · automatic connections disabled`,
    );
  };

  const discardImport = () => {
    importTokenRef.current++;
    setImportDraft(null);
  };

  const exportModel = () => {
    const s = appRef.current;
    if (!s) return;
    const ldrawBasis = new THREE.Matrix4().makeScale(1, -1, -1);
    const lines = s.pieces.map((p) => {
      const r = new THREE.Matrix4().makeRotationFromQuaternion(p.mesh.quaternion);
      r.premultiply(ldrawBasis).multiply(ldrawBasis);
      const e = r.elements,
        n = (v: number) => (Math.abs(v) < 1e-8 ? 0 : +v.toFixed(5));
      return `1 ${p.color} ${n(p.mesh.position.x * 20)} ${n(-p.mesh.position.y * 20)} ${n(-p.mesh.position.z * 20)} ${n(e[0])} ${n(e[4])} ${n(e[8])} ${n(e[1])} ${n(e[5])} ${n(e[9])} ${n(e[2])} ${n(e[6])} ${n(e[10])} ${p.modelPart ?? p.part}.dat`;
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([makeLDR(lines)]));
    a.download = "sim-studio-model.ldr";
    a.click();
  };

  const refreshProjectList = async () => {
    try {
      const nextProjects = await listBrowserProjects();
      setProjects(nextProjects);
      setProjectPage((page) =>
        Math.min(page, Math.max(0, Math.ceil(nextProjects.length / 9) - 1)),
      );
    } catch {}
  };

  const downloadProjectDocument = (document: SimStudioProjectDocument) => {
    const url = URL.createObjectURL(
        new Blob([encodeProjectFile(document)], { type: PROJECT_MIME }),
      ),
      anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = safeProjectFileName(document.name);
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // --- Project manager actions ---------------------------------------------

  const saveCurrentProject = async () => {
    const state = appRef.current;
    if (!state || running || projectBusy) return;
    setProjectBusy(true);
    const previousSavedRevision = savedProjectRevisionRef.current;
    try {
      projectNameRef.current =
        projectName.trim() ||
        (language === "es" ? "Mecanismo sin título" : "Untitled mechanism");
      savedProjectRevisionRef.current = projectRevisionRef.current;
      const document = state.createProjectDocument();
      await saveBrowserProject(document);
      await saveRecoveryProject(document);
      await refreshProjectList();
      setRecoveryStatus("saved");
      setCurrentProjectSaved(true);
      setProjectDirty(false);
      setSaveNamePrompt(false);
      setProjectNameEditing(false);
      setMessage(
        language === "es"
          ? `Proyecto «${document.name}» guardado en el navegador`
          : `Project “${document.name}” saved in this browser`,
      );
    } catch (error) {
      savedProjectRevisionRef.current = previousSavedRevision;
      setMessage(
        `${language === "es" ? "No se pudo guardar" : "Could not save"}: ${error instanceof Error ? error.message : "IndexedDB"}`,
      );
    } finally {
      setProjectBusy(false);
    }
  };

  const requestProjectSave = () => {
    if (running || projectBusy) return;
    if (currentProjectSaved) {
      void saveCurrentProject();
      return;
    }
    setProjectMenuOpen(true);
    setSaveNamePrompt(true);
    setMessage(t.nameBeforeSave);
    window.setTimeout(() => {
      projectNameInputRef.current?.focus();
      projectNameInputRef.current?.select();
    }, 0);
  };
  saveShortcutRef.current = requestProjectSave;

  const performOpenSavedProject = async (id: string) => {
    const state = appRef.current;
    if (!state || running || projectBusy) return;
    setProjectBusy(true);
    try {
      const document = await loadBrowserProject(id);
      if (!document) throw new Error("Project not found");
      await state.restoreProjectDocument(document);
      savedProjectRevisionRef.current = projectRevisionRef.current;
      setCurrentProjectSaved(true);
      setProjectDirty(false);
      setProjectNameEditing(false);
      setProjectMenuOpen(false);
      setMessage(
        language === "es"
          ? `Proyecto «${document.name}» cargado sin recalcular conexiones`
          : `Project “${document.name}” loaded without rescanning connections`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open project");
    } finally {
      setProjectBusy(false);
    }
  };

  const performCreateNewProject = () => {
    if (running || projectBusy) return;
    reset();
    const id = createProjectId(),
      createdAt = new Date().toISOString(),
      name = language === "es" ? "Mecanismo sin título" : "Untitled mechanism";
    activeProjectIdRef.current = id;
    projectCreatedAtRef.current = createdAt;
    projectRevisionRef.current = 0;
    savedProjectRevisionRef.current = null;
    projectNameRef.current = name;
    suppressProjectNameDirtyRef.current = true;
    setProjectName(name);
    setImported([]);
    setCurrentProjectSaved(false);
    setProjectDirty(false);
    setSaveNamePrompt(false);
    setProjectNameEditing(false);
    appRef.current?.scheduleRecoverySave(true, false);
    setProjectMenuOpen(false);
    setMessage(language === "es" ? "Proyecto nuevo" : "New project");
  };

  const requestCreateNewProject = () => {
    if (projectDirty) setProjectConfirmation({ kind: "new" });
    else performCreateNewProject();
  };

  const requestOpenSavedProject = (project: ProjectSummary) => {
    if (projectDirty) setProjectConfirmation({ kind: "open", project });
    else void performOpenSavedProject(project.id);
  };

  const exportCurrentProject = () => {
    const state = appRef.current;
    if (!state || running) return;
    projectNameRef.current = projectName.trim() || "Untitled mechanism";
    downloadProjectDocument(state.createProjectDocument());
  };

  const performImportProject = async (document: SimStudioProjectDocument) => {
    const state = appRef.current;
    if (!state || running || projectBusy) return;
    setProjectBusy(true);
    try {
      const existingProjects = await listBrowserProjects(),
        now = new Date().toISOString(),
        importedDocument: SimStudioProjectDocument = {
          ...document,
          id: createProjectId(),
          name: uniqueProjectName(
            document.name,
            existingProjects,
            language === "es" ? "Proyecto importado" : "Imported project",
          ),
          createdAt: now,
          updatedAt: now,
        };
      savedProjectRevisionRef.current = importedDocument.revision ?? 0;
      importedDocument.savedRevision = savedProjectRevisionRef.current;
      await saveBrowserProject(importedDocument);
      await state.restoreProjectDocument(importedDocument);
      setCurrentProjectSaved(true);
      setProjectDirty(false);
      setProjectNameEditing(false);
      await refreshProjectList();
      setProjectMenuOpen(false);
      setMessage(
        language === "es"
          ? `Proyecto «${importedDocument.name}» importado como proyecto nuevo`
          : `Project “${importedDocument.name}” imported as a new project`,
      );
    } catch (error) {
      setMessage(
        `${language === "es" ? "Archivo de proyecto no válido" : "Invalid project file"}: ${error instanceof Error ? error.message : "error"}`,
      );
    } finally {
      setProjectBusy(false);
    }
  };

  const importProjectFile = async (file: File) => {
    try {
      const document = decodeProjectFile(await file.arrayBuffer());
      if (projectDirty) setProjectConfirmation({ kind: "import", document });
      else void performImportProject(document);
    } catch (error) {
      setMessage(
        `${language === "es" ? "Archivo de proyecto no válido" : "Invalid project file"}: ${error instanceof Error ? error.message : "error"}`,
      );
    }
  };

  const performRemoveSavedProject = async (id: string) => {
    if (projectBusy) return;
    setProjectBusy(true);
    try {
      await deleteBrowserProject(id);
      await refreshProjectList();
      if (id === activeProjectIdRef.current) {
        savedProjectRevisionRef.current = null;
        setCurrentProjectSaved(false);
        setProjectDirty(true);
        appRef.current?.scheduleRecoverySave(true, false);
      }
    } finally {
      setProjectBusy(false);
    }
  };

  const resolveProjectConfirmation = () => {
    const confirmation = projectConfirmation;
    setProjectConfirmation(null);
    if (!confirmation) return;
    if (confirmation.kind === "new") performCreateNewProject();
    else if (confirmation.kind === "open")
      void performOpenSavedProject(confirmation.project.id);
    else if (confirmation.kind === "delete")
      void performRemoveSavedProject(confirmation.project.id);
    else if (confirmation.kind === "import")
      void performImportProject(confirmation.document);
  };

  const beginProjectRename = () => {
    if (!currentProjectSaved || projectBusy || running) return;
    setProjectNameDraft(projectName);
    setProjectNameEditing(true);
    window.setTimeout(() => {
      projectNameInputRef.current?.focus();
      projectNameInputRef.current?.select();
    }, 0);
  };

  const cancelProjectRename = () => {
    setProjectNameDraft("");
    setProjectNameEditing(false);
  };

  const confirmProjectRename = async () => {
    const name = projectNameDraft.trim().slice(0, 20);
    if (!name || !currentProjectSaved || projectBusy || running) return;
    if (name === projectName) {
      cancelProjectRename();
      return;
    }
    setProjectBusy(true);
    try {
      const document = await loadBrowserProject(activeProjectIdRef.current);
      if (!document) throw new Error("Project not found");
      document.name = name;
      document.updatedAt = new Date().toISOString();
      await saveBrowserProject(document);
      suppressProjectNameDirtyRef.current = true;
      projectNameRef.current = name;
      setProjectName(name);
      setProjectNameDraft("");
      setProjectNameEditing(false);
      appRef.current?.scheduleRecoverySave(true, false);
      await refreshProjectList();
      setMessage(
        language === "es"
          ? `Proyecto renombrado como «${name}»`
          : `Project renamed to “${name}”`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not rename project");
    } finally {
      setProjectBusy(false);
    }
  };

  const beginDuplicateProject = async () => {
    if (!currentProjectSaved || projectBusy || running) return;
    setProjectBusy(true);
    try {
      const document = await loadBrowserProject(activeProjectIdRef.current);
      if (!document) throw new Error("Project not found");
      const suffix = language === "es" ? " copia" : " copy";
      setDuplicateProjectDocument(document);
      setDuplicateProjectName(
        `${document.name.slice(0, Math.max(1, 20 - suffix.length))}${suffix}`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not duplicate project");
    } finally {
      setProjectBusy(false);
    }
  };

  const confirmDuplicateProject = async () => {
    const name = duplicateProjectName.trim().slice(0, 20),
      source = duplicateProjectDocument;
    if (!name || !source || projectBusy) return;
    setProjectBusy(true);
    try {
      const existingProjects = await listBrowserProjects(),
        uniqueName = uniqueProjectName(
          name,
          existingProjects,
          language === "es" ? "Copia" : "Copy",
        ),
        now = new Date().toISOString(),
        copy: SimStudioProjectDocument = {
          ...source,
          id: createProjectId(),
          name: uniqueName,
          createdAt: now,
          updatedAt: now,
        };
      await saveBrowserProject(copy);
      setDuplicateProjectDocument(null);
      setDuplicateProjectName("");
      await refreshProjectList();
      setMessage(
        language === "es"
          ? `Copia «${uniqueName}» creada`
          : `Copy “${uniqueName}” created`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not duplicate project");
    } finally {
      setProjectBusy(false);
    }
  };

  const selected = appRef.current?.selected;
  const selectedCollisionLayer = selected?.gear ? collisionLayer : "normal",
    selectedCollisionPrimitives = selected
      ? selectedCollisionLayer === "gear"
        ? selected.gearColliders
        : selected.colliders
      : [];
  const selectedConnections = selected
    ? (appRef.current?.connections.filter(
        (connection) => connection.a === selected || connection.b === selected,
      ) ?? [])
    : [];
  const selectedGearSpec = selected
      ? gearSpecFor(selected.modelPart ?? selected.part, selected.name)
      : undefined,
    selectedGearLinks = selected
      ? (appRef.current?.gearLinks.filter(
          (link) => link.a.value === selected || link.b.value === selected,
        ) ?? [])
      : [];
  const selectedPivotOptions = selected
    ? [
        ...new Map(
          (appRef.current?.connections ?? [])
            .filter(
              (connection) => connection.a === selected || connection.b === selected,
            )
            .map((connection) => {
              const connector =
                  connection.a === selected ? connection.socket : connection.shaft,
                connectorIndex = selected.connectors.indexOf(connector),
                other = connection.a === selected ? connection.b : connection.a,
                local = selected.mesh.worldToLocal(
                  connection.a.mesh.localToWorld(connection.socket.local.clone()),
                );
              const typeName =
                connector.kind === "axle"
                  ? connector.role === "shaft"
                    ? language === "es"
                      ? "eje morado"
                      : "purple axle"
                    : language === "es"
                      ? "hueco verde"
                      : "green socket"
                  : connector.role === "shaft"
                    ? language === "es"
                      ? "pin naranja"
                      : "orange pin"
                    : language === "es"
                      ? "hueco azul"
                      : "blue socket";
              const key = jointPivotKey(connection);
              return [
                key,
                {
                  key,
                  local: local.clone(),
                  label: `${t.connectionPivot} ${connectorIndex + 1} · ${typeName} ↔ ${other.part}`,
                },
              ] as const;
            }),
        ).values(),
      ]
    : [];
  const selectedPivotValue = selectedPivotOptions.some(
    (option) => option.key === selected?.rotationPivotKey,
  )
    ? selected!.rotationPivotKey!
    : "center";

  const toggleDebug = (key: keyof DebugFlags) =>
    setDebugViews((current) => {
      const next = { ...current, [key]: !current[key] },
        s = appRef.current;
      if (s) {
        s.debug = next;
        s.refreshDebug();
      }
      return next;
    });

  const setConnectionMode = (id: string, mode: JointMode) => {
    const state = appRef.current,
      connection = state?.connections.find((item) => item.id === id);
    if (
      !state ||
      !connection ||
      running ||
      !allowedModes(connection.profile).includes(mode)
    )
      return;
    state.recordHistory();
    connection.mode = mode;
    connection.userConfigured = true;
    state.connectionModes.set(id, {
      mode,
      motorSpeed: connection.motorSpeed,
      motorForce: connection.motorForce,
      userConfigured: true,
    });
    rebalanceSmartDefaults(state, connection.b);
    state.refreshDebug();
    setConnectionRevision((value) => value + 1);
    setMessage(`${profileLabels[connection.profile]} · ${modeLabels[mode]}`);
  };

  const setMotorSpeed = (id: string, motorSpeed: number) => {
    const state = appRef.current,
      connection = state?.connections.find((item) => item.id === id);
    if (!state || !connection) return;
    if (!running) state.recordHistory();
    connection.motorSpeed = motorSpeed;
    state.connectionModes.set(id, {
      mode: connection.mode,
      motorSpeed,
      motorForce: connection.motorForce,
      userConfigured: connection.userConfigured,
    });
    const activeJoint = state.physicsJoints.get(id);
    if (running && activeJoint)
      (activeJoint as RAPIER.RevoluteImpulseJoint).configureMotorVelocity(
        motorSpeed,
        connection.motorForce,
      );
    setConnectionRevision((value) => value + 1);
    setMessage(`Motor ${motorSpeed.toFixed(1)} rad/s`);
  };

  const setMotorForce = (id: string, motorForce: number) => {
    const state = appRef.current,
      connection = state?.connections.find((item) => item.id === id);
    if (!state || !connection) return;
    if (!running) state.recordHistory();
    connection.motorForce = motorForce;
    state.connectionModes.set(id, {
      mode: connection.mode,
      motorSpeed: connection.motorSpeed,
      motorForce,
      userConfigured: connection.userConfigured,
    });
    const activeJoint = state.physicsJoints.get(id);
    if (running && activeJoint)
      (activeJoint as RAPIER.RevoluteImpulseJoint).configureMotorVelocity(
        connection.motorSpeed,
        motorForce,
      );
    setConnectionRevision((value) => value + 1);
    setMessage(`Fuerza del motor ${motorForce.toFixed(0)}`);
  };

  // --- Connection-map editor -----------------------------------------------

  const connectorData = (piece: Piece) =>
    piece.connectors.map((connector) => ({
      local: connector.local.toArray(),
      axis: connector.axis.toArray(),
      kind: connector.kind,
      role: connector.role,
      diameter: connector.diameter,
      length: connector.length,
    }));

  const commitConnectorMap = (
    piece: Piece,
    connectors: MeshConnector[],
    notice: string,
  ) => {
    const state = appRef.current;
    if (!state || running) return;
    state.recordHistory();
    const normalized = connectors.map((connector) => ({
      ...connector,
      local: connector.local.clone(),
      axis:
        connector.axis.lengthSq() > 0.0001
          ? connector.axis.clone().normalize()
          : new THREE.Vector3(1, 0, 0),
    }));
    for (const instance of state.pieces.filter((item) => item.part === piece.part)) {
      instance.connectors = normalized.map((connector) => ({
        ...connector,
        local: connector.local.clone(),
        axis: connector.axis.clone(),
      }));
      instance.mesh.userData.connectorReach = connectorMapReach(instance.connectors);
      instance.colliders = approximateCollisionPrimitives(
        instance.mesh,
        instance.name,
        instance.connectors,
      );
      instance.gearColliders = instance.gear
        ? approximateGearCollisionPrimitives(instance.colliders)
        : [];
    }
    state.connections = state.connections.filter(
      (connection) =>
        connection.a.part !== piece.part && connection.b.part !== piece.part,
    );
    rebalanceAllSmartDefaults(state);
    try {
      localStorage.setItem(
        `sim-connectors-v4:${piece.part}`,
        JSON.stringify(connectorData({ ...piece, connectors: normalized })),
      );
      localStorage.setItem(
        `sim-connectors-revision:${piece.part}`,
        CORRECTION_MAP_REVISION,
      );
    } catch {}
    state.debug.connectors = true;
    setDebugViews((current) => ({ ...current, connectors: true }));
    state.refreshDebug();
    setConnectorRevision((value) => value + 1);
    setConnectionRevision((value) => value + 1);
    setMessage(notice);
  };

  const updateConnector = (
    index: number,
    field: "kind" | "role" | "diameter" | "length" | "local" | "axis",
    value: string,
    component = 0,
  ) => {
    if (!selected || running) return;
    const next = selected.connectors.map((connector) => ({
        ...connector,
        local: connector.local.clone(),
        axis: connector.axis.clone(),
      })),
      connector = next[index];
    if (field === "kind") connector.kind = value as MeshConnector["kind"];
    else if (field === "role") connector.role = value as MeshConnector["role"];
    else if (field === "diameter") connector.diameter = Math.max(0.01, +value || 0.01);
    else if (field === "length") connector.length = Math.max(0.01, +value || 0.01);
    else connector[field].setComponent(component, +value || 0);
    commitConnectorMap(
      selected,
      next,
      `Mapa ${selected.part}: punto ${index + 1} actualizado`,
    );
  };

  const addConnector = () => {
    if (!selected || running) return;
    const next = selected.connectors.map((connector) => ({
      ...connector,
      local: connector.local.clone(),
      axis: connector.axis.clone(),
    }));
    next.push({
      local: new THREE.Vector3(),
      axis: new THREE.Vector3(0, 1, 0),
      kind: "round",
      role: "socket",
      diameter: 0.8,
      length: 1,
    });
    commitConnectorMap(selected, next, `Mapa ${selected.part}: conector añadido`);
  };

  const regenerateConnectorMap = () => {
    if (!selected || running) return;
    const sockets = detectConnectorHoles(selected.mesh);
    let connectors: MeshConnector[];
    if (isPinPart(selected)) {
      const shafts = /^Technic Axle Pin/i.test(selected.name)
        ? hybridAxlePinConnectors(selected.mesh)
        : rodConnectors(selected.mesh, "round");
      connectors = [
        ...shafts,
        ...sockets.filter(
          (socket) =>
            !shafts.some((shaft) => shaft.local.distanceTo(socket.local) < 0.12),
        ),
      ];
    } else if (isAxlePart(selected)) {
      const shafts = rodConnectors(selected.mesh, "axle");
      connectors = [
        ...shafts,
        ...sockets.filter(
          (socket) =>
            !shafts.some((shaft) => shaft.local.distanceTo(socket.local) < 0.12),
        ),
      ];
    } else
      connectors = sockets.length
        ? sockets
        : fallbackBeamConnectors(selected.mesh, selected.name);
    commitConnectorMap(
      selected,
      connectors,
      `Mapa ${selected.part}: ${connectors.length} conectores regenerados`,
    );
  };

  const removeConnector = (index: number) => {
    if (!selected || running) return;
    commitConnectorMap(
      selected,
      selected.connectors.filter((_, item) => item !== index),
      `Mapa ${selected.part}: conector eliminado`,
    );
  };

  const duplicateConnector = (index: number) => {
    if (!selected || running) return;
    const next = selected.connectors.map((connector) => ({
        ...connector,
        local: connector.local.clone(),
        axis: connector.axis.clone(),
      })),
      source = next[index];
    if (!source) return;
    next.splice(index + 1, 0, {
      ...source,
      local: source.local.clone(),
      axis: source.axis.clone(),
    });
    commitConnectorMap(
      selected,
      next,
      `Mapa ${selected.part}: conector ${index + 1} duplicado`,
    );
  };

  const exportConnectorMap = () => {
    if (!selected) return;
    const payload = {
        format: "sim-studio-connect-map",
        version: 1,
        part: selected.part,
        name: selected.name,
        connectors: connectorData(selected),
      },
      a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
    a.download = `${selected.part}-connections.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importConnectorMap = async (file: File) => {
    if (!selected || running) return;
    try {
      const payload = JSON.parse(await file.text()),
        rows = Array.isArray(payload) ? payload : payload.connectors;
      if (!Array.isArray(rows)) throw new Error("Formato incorrecto");
      const connectors: MeshConnector[] = rows.map(
        (row: {
          local: number[];
          axis: number[];
          kind: string;
          role: string;
          diameter?: number;
          length?: number;
        }) => {
          if (
            !Array.isArray(row.local) ||
            !Array.isArray(row.axis) ||
            !["round", "axle", "half"].includes(row.kind) ||
            !["socket", "shaft"].includes(row.role)
          )
            throw new Error("Conector incorrecto");
          return {
            local: new THREE.Vector3().fromArray(row.local),
            axis: new THREE.Vector3().fromArray(row.axis),
            kind: row.kind as MeshConnector["kind"],
            role: row.role as MeshConnector["role"],
            diameter: row.diameter ?? 0.24,
            length: row.length,
          };
        },
      );
      commitConnectorMap(
        selected,
        connectors,
        `Mapa ${selected.part}: ${connectors.length} conectores importados`,
      );
    } catch (error) {
      setMessage(
        `No se pudo importar el mapa: ${error instanceof Error ? error.message : "JSON inválido"}`,
      );
    } finally {
      if (connectorFileRef.current) connectorFileRef.current.value = "";
    }
  };

  const cloneCollider = (primitive: CollisionPrimitive): CollisionPrimitive => ({
      ...primitive,
      center: primitive.center.clone(),
      size: primitive.size?.clone(),
      rotation: primitive.rotation.clone(),
    }),
    colliderData = (colliders: CollisionPrimitive[]) =>
      colliders.map((primitive) => ({
        shape: primitive.shape,
        center: primitive.center.toArray(),
        size: primitive.size?.toArray(),
        radius: primitive.radius,
        halfHeight: primitive.halfHeight,
        rotation: primitive.rotation.toArray(),
      }));
  // --- Collision-map editor ------------------------------------------------

  const commitCollisionMap = (
    piece: Piece,
    colliders: CollisionPrimitive[],
    notice: string,
    layer: "normal" | "gear" = selectedCollisionLayer,
  ) => {
    const state = appRef.current;
    if (!state || running) return;
    state.recordHistory();
    const normalized = colliders.map(cloneCollider);
    state.pieces
      .filter((instance) => instance.part === piece.part)
      .forEach((instance) => {
        if (layer === "gear") instance.gearColliders = normalized.map(cloneCollider);
        else instance.colliders = normalized.map(cloneCollider);
      });
    try {
      localStorage.setItem(
        layer === "gear"
          ? `sim-gear-colliders-v1:${piece.part}`
          : `sim-colliders-v1:${piece.part}`,
        JSON.stringify(colliderData(normalized)),
      );
      if (layer === "normal")
        localStorage.setItem(
          `sim-colliders-revision:${piece.part}`,
          CORRECTION_MAP_REVISION,
        );
    } catch {}
    state.debug.colliders = true;
    setDebugViews((current) => ({ ...current, colliders: true }));
    state.refreshDebug();
    setColliderRevision((value) => value + 1);
    setMessage(notice);
  };

  const addCollider = (shape: CollisionPrimitive["shape"]) => {
    if (!selected || running) return;
    const next = selectedCollisionPrimitives.map(cloneCollider);
    next.push(
      shape === "box"
        ? {
            shape,
            center: new THREE.Vector3(),
            size: new THREE.Vector3(1, 1, 1),
            rotation: new THREE.Quaternion(),
          }
        : {
            shape,
            center: new THREE.Vector3(),
            radius: 0.5,
            halfHeight: 0.5,
            rotation: new THREE.Quaternion(),
          },
    );
    commitCollisionMap(
      selected,
      next,
      `Mapa ${selected.part}: ${shape === "box" ? "caja" : "cilindro"} añadido`,
    );
  };

  const updateCollider = (
    index: number,
    field: "shape" | "center" | "size" | "rotation" | "radius" | "halfHeight",
    value: string,
    component = 0,
  ) => {
    if (!selected || running) return;
    const next = selectedCollisionPrimitives.map(cloneCollider),
      primitive = next[index];
    if (!primitive) return;
    if (field === "shape") {
      primitive.shape = value as CollisionPrimitive["shape"];
      if (primitive.shape === "box") {
        primitive.size ??= new THREE.Vector3(1, 1, 1);
        primitive.radius = undefined;
        primitive.halfHeight = undefined;
      } else {
        primitive.size = undefined;
        primitive.radius ??= 0.5;
        primitive.halfHeight ??= 0.5;
      }
    } else if (field === "center") primitive.center.setComponent(component, +value || 0);
    else if (field === "size")
      primitive.size?.setComponent(component, Math.max(0.01, +value || 0.01));
    else if (field === "radius") primitive.radius = Math.max(0.01, +value || 0.01);
    else if (field === "halfHeight")
      primitive.halfHeight = Math.max(0.01, +value || 0.01);
    else {
      const rotation = new THREE.Euler().setFromQuaternion(primitive.rotation, "XYZ");
      if (component === 0) rotation.x = THREE.MathUtils.degToRad(+value || 0);
      else if (component === 1) rotation.y = THREE.MathUtils.degToRad(+value || 0);
      else rotation.z = THREE.MathUtils.degToRad(+value || 0);
      primitive.rotation.setFromEuler(rotation).normalize();
    }
    commitCollisionMap(
      selected,
      next,
      `Mapa ${selected.part}: collider ${index + 1} actualizado`,
    );
  };

  const removeCollider = (index: number) => {
    if (!selected || running) return;
    commitCollisionMap(
      selected,
      selectedCollisionPrimitives.filter((_, item) => item !== index),
      `Mapa ${selected.part}: collider eliminado`,
    );
  };

  const exportCollisionMap = () => {
    if (!selected) return;
    const payload = {
        format: "sim-studio-collision-map",
        version: 1,
        part: selected.part,
        name: selected.name,
        colliders: colliderData(selected.colliders),
        gear: selected.gear,
        gearColliders: colliderData(selected.gearColliders),
      },
      a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
    a.download = `${selected.part}-collisions.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const collisionPrimitiveFromData = (row: {
    shape: string;
    center: number[];
    size?: number[];
    radius?: number;
    halfHeight?: number;
    rotation?: number[];
  }): CollisionPrimitive => {
    if (
      !["box", "cylinder"].includes(row.shape) ||
      !Array.isArray(row.center) ||
      row.center.length < 3
    )
      throw new Error("Collider incorrecto");
    const shape = row.shape as CollisionPrimitive["shape"];
    if (shape === "box" && (!Array.isArray(row.size) || row.size.length < 3))
      throw new Error("Tamaño de caja incorrecto");
    return {
      shape,
      center: new THREE.Vector3().fromArray(row.center),
      size:
        shape === "box"
          ? new THREE.Vector3()
              .fromArray(row.size!)
              .max(new THREE.Vector3(0.01, 0.01, 0.01))
          : undefined,
      radius: shape === "cylinder" ? Math.max(0.01, row.radius ?? 0.5) : undefined,
      halfHeight:
        shape === "cylinder" ? Math.max(0.01, row.halfHeight ?? 0.5) : undefined,
      rotation:
        Array.isArray(row.rotation) && row.rotation.length >= 4
          ? new THREE.Quaternion().fromArray(row.rotation).normalize()
          : new THREE.Quaternion(),
    };
  };

  const importCollisionMap = async (file: File) => {
    if (!selected || running) return;
    try {
      const payload = JSON.parse(await file.text()),
        rows = Array.isArray(payload) ? payload : payload.colliders;
      if (!Array.isArray(rows)) throw new Error("Formato incorrecto");
      const colliders: CollisionPrimitive[] = rows.map(collisionPrimitiveFromData);
      commitCollisionMap(
        selected,
        colliders,
        `Mapa ${selected.part}: ${colliders.length} colliders importados`,
        "normal",
      );
      if (selected.gear && Array.isArray(payload.gearColliders)) {
        const gearColliders = payload.gearColliders.map(collisionPrimitiveFromData);
        commitCollisionMap(
          selected,
          gearColliders,
          `Mapa ${selected.part}: ${colliders.length} normales y ${gearColliders.length} de engranaje importados`,
          "gear",
        );
      }
    } catch (error) {
      setMessage(
        `No se pudo importar el mapa de colisiones: ${error instanceof Error ? error.message : "JSON inválido"}`,
      );
    } finally {
      if (colliderFileRef.current) colliderFileRef.current.value = "";
    }
  };

  const downloadPhysicsLog = () => {
    if (!lastLog) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lastLog], { type: "application/json" }));
    a.download = "sim-studio-physics-log.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadPerformanceLog = () => {
    const state = appRef.current;
    if (!state?.performanceTrace.samples.length) return;
    const trace = state.performanceTrace,
      samples =
        trace.totalFrames > trace.samples.length
          ? [
              ...trace.samples.slice(trace.cursor),
              ...trace.samples.slice(0, trace.cursor),
            ]
          : trace.samples.slice(),
      metrics: (keyof FramePerformanceSample)[] = [
        "frameIntervalMs",
        "betweenFramesMs",
        "totalMs",
        "inputMs",
        "forceResetMs",
        "springMs",
        "jointForcesMs",
        "worldStepMs",
        "syncMs",
        "physicsLogMs",
        "connectionScanMs",
        "batchMs",
        "debugMs",
        "locksMs",
        "renderMs",
        "gpuMs",
      ],
      percentile = (values: number[], amount: number) =>
        values[Math.min(values.length - 1, Math.floor(values.length * amount))] ?? 0,
      summary = Object.fromEntries(
        metrics.map((metric) => {
          const values = samples
              .map((sample) => sample[metric])
              .filter(
                (value): value is number =>
                  typeof value === "number" && Number.isFinite(value),
              )
              .sort((a, b) => a - b),
            average = values.length
              ? values.reduce((total, value) => total + value, 0) / values.length
              : 0;
          return [
            metric,
            {
              average: +average.toFixed(3),
              p50: +percentile(values, 0.5).toFixed(3),
              p95: +percentile(values, 0.95).toFixed(3),
              maximum: +(values.at(-1) ?? 0).toFixed(3),
            },
          ];
        }),
      ),
      phaseNames = [
        "betweenFramesMs",
        "inputMs",
        "forceResetMs",
        "springMs",
        "jointForcesMs",
        "worldStepMs",
        "syncMs",
        "physicsLogMs",
        "connectionScanMs",
        "batchMs",
        "debugMs",
        "locksMs",
        "renderMs",
        "gpuMs",
      ],
      dominantPhase = phaseNames
        .map((name) => ({
          name,
          p95: (summary[name] as { p95: number }).p95,
        }))
        .sort((a, b) => b.p95 - a.p95)[0],
      payload = {
        format: "sim-studio-frame-profile",
        version: 2,
        generatedAt: new Date().toISOString(),
        recordingStartedAt: trace.startedAt,
        retainedFrames: samples.length,
        totalFramesObserved: trace.totalFrames,
        scene: {
          pieces: state.pieces.length,
          connections: state.connections.length,
          simulationRunning: state.running,
          largeSimulation: !!state.largeSimulation,
          diagnostics: state.debug,
          renderBatches: state.renderBatchStats,
        },
        environment: {
          userAgent: navigator.userAgent,
          hardwareConcurrency: navigator.hardwareConcurrency,
          deviceMemory:
            (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
          devicePixelRatio,
          renderScale: state.renderScale,
          gpuTimerSupported: state.gpuTimerSupported,
          gpuRenderer: state.gpuRenderer,
          gpuVendor: state.gpuVendor,
          viewport: {
            cssWidth: state.renderer.domElement.clientWidth,
            cssHeight: state.renderer.domElement.clientHeight,
            drawingBufferWidth: state.renderer.domElement.width,
            drawingBufferHeight: state.renderer.domElement.height,
          },
        },
        diagnosis: {
          dominantPhaseByP95: dominantPhase,
          framesOver16_7ms: samples.filter((sample) => sample.frameIntervalMs > 16.7)
            .length,
          framesOver33_3ms: samples.filter((sample) => sample.frameIntervalMs > 33.3)
            .length,
          framesOver50ms: samples.filter((sample) => sample.frameIntervalMs > 50).length,
        },
        summary,
        slowestFrames: samples
          .slice()
          .sort((a, b) => b.frameIntervalMs - a.frameIntervalMs)
          .slice(0, 100),
        samples,
      },
      anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    );
    anchor.download = "sim-studio-performance-log.json";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };

  const importStatusText = importDraft
      ? {
          reading: t.importReading,
          palette: t.importPalette,
          external: t.importExternal,
          preview: t.importPreview,
          ready: t.importReady,
          error: importDraft.error ?? "Error",
        }[importDraft.status]
      : "",
    importProgress = importDraft
      ? importDraft.status === "ready"
        ? 100
        : importDraft.total
          ? Math.round((importDraft.progress / importDraft.total) * 100)
          : 4
      : 0;

  const inspectorWidthBounds = () => {
    const studioWidth =
      studioRef.current?.clientWidth ??
      (typeof window === "undefined" ? 1200 : window.innerWidth);
    return {
      minimum: 270,
      maximum: Math.max(270, Math.min(680, studioWidth - 300 - 360)),
    };
  };

  const resizeInspectorBy = (change: number) => {
    const { minimum, maximum } = inspectorWidthBounds();
    setInspectorWidth((width) => Math.min(maximum, Math.max(minimum, width + change)));
  };

  const beginInspectorResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.innerWidth <= 950) return;
    event.preventDefault();
    const handle = event.currentTarget,
      pointerId = event.pointerId,
      startX = event.clientX,
      startWidth = inspectorWidth;
    handle.setPointerCapture(pointerId);
    document.body.classList.add("resizing-inspector");
    const move = (moveEvent: PointerEvent) => {
      const { minimum, maximum } = inspectorWidthBounds();
      setInspectorWidth(
        Math.min(maximum, Math.max(minimum, startWidth + startX - moveEvent.clientX)),
      );
    };

    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.classList.remove("resizing-inspector");
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const projectSaveState =
      recoveryStatus === "saving"
        ? "saving"
        : currentProjectSaved && !projectDirty
          ? "clean"
          : "dirty",
    projectSaveLabel =
      projectSaveState === "saving"
        ? t.autosaving
        : projectSaveState === "clean"
          ? t.projectUpToDate
          : t.changesPending;

  return (
    <main
      ref={studioRef}
      className={`studio ${theme}`}
      style={{ "--inspector-width": `${inspectorWidth}px` } as CSSProperties}
    >
      <header>
        <div className="brand">
          <span className="mark">S</span>
          <div>
            <strong>SIM STUDIO</strong>
            <small>{t.subtitle}</small>
          </div>
        </div>
        <div className="language-toggle" role="group" aria-label="Language / Idioma">
          <button
            className={language === "es" ? "active" : ""}
            onClick={() => setLanguage("es")}
            aria-label="Español"
            title="Español"
          >
            🇪🇸
          </button>
          <button
            className={language === "en" ? "active" : ""}
            onClick={() => setLanguage("en")}
            aria-label="English"
            title="English"
          >
            🇬🇧
          </button>
        </div>
        <button
          className="theme-toggle"
          onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
          aria-label={t.switchTheme}
          title={theme === "dark" ? t.light : t.dark}
        >
          <span>{theme === "dark" ? "☀" : "◐"}</span>
          {theme === "dark" ? t.light : t.dark}
        </button>
        <button
          className="project project-button"
          onClick={() => setProjectMenuOpen(true)}
          title={t.manageProjects}
        >
          <span>{t.project}</span>
          <b>{projectName.slice(0, 20)}</b>
          <small className={`recovery-dot ${projectSaveState}`} title={projectSaveLabel}>
            {projectSaveState === "clean"
              ? "✓"
              : projectSaveState === "saving"
                ? "…"
                : "!"}
          </small>
        </button>
        <div className="header-actions">
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".ldr,.mpd,.io"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.currentTarget.value = "";
              if (file) void importModel(file);
            }}
          />
          <button
            className="ghost project-manager-trigger"
            onClick={() => setProjectMenuOpen(true)}
            title={`${t.manageProjects} · Ctrl+S`}
          >
            ▣ {t.projectsButton}
          </button>
          <input
            ref={projectFileRef}
            type="file"
            hidden
            accept={PROJECT_EXTENSION}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              if (file) void importProjectFile(file);
            }}
          />
          <button
            className="ghost"
            style={{ minWidth: 34, padding: "10px 8px", fontSize: 16, lineHeight: 1 }}
            disabled={running}
            onClick={() => void appRef.current?.undo()}
            aria-label={language === "es" ? "Deshacer" : "Undo"}
            title={`${language === "es" ? "Deshacer" : "Undo"} · Ctrl+Z`}
          >
            ↶
          </button>
          <button
            className="ghost"
            style={{ minWidth: 34, padding: "10px 8px", fontSize: 16, lineHeight: 1 }}
            disabled={running}
            onClick={() => void appRef.current?.redo()}
            aria-label={language === "es" ? "Rehacer" : "Redo"}
            title={`${language === "es" ? "Rehacer" : "Redo"} · Ctrl+Y`}
          >
            ↷
          </button>
          <button
            className="ghost"
            style={{ minWidth: 34, padding: "10px 8px", fontSize: 16, lineHeight: 1 }}
            disabled={running || !selected}
            onClick={() => appRef.current?.copySelected()}
            aria-label={language === "es" ? "Copiar pieza" : "Copy part"}
            title={`${language === "es" ? "Copiar pieza" : "Copy part"} · Ctrl+C`}
          >
            ⧉
          </button>
          <button
            className="ghost"
            style={{ minWidth: 34, padding: "10px 8px", fontSize: 16, lineHeight: 1 }}
            disabled={running}
            onClick={() => void appRef.current?.pasteClipboard()}
            aria-label={language === "es" ? "Pegar pieza" : "Paste part"}
            title={`${language === "es" ? "Pegar pieza" : "Paste part"} · Ctrl+V`}
          >
            ⎘
          </button>
          <button className="ghost" onClick={() => fileRef.current?.click()}>
            {t.import}
          </button>
          <button className="ghost" onClick={exportModel}>
            {t.export}
          </button>
          <button
            className={running ? "stop" : "play"}
            onClick={physics}
            disabled={physicsBusy}
          >
            {physicsBusy ? "…" : running ? t.stop : t.simulate}
          </button>
        </div>
      </header>
      {projectMenuOpen && (
        <div className="project-backdrop" role="presentation">
          <section
            className="project-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="projects-title"
          >
            <div className="project-dialog-head">
              <div>
                <small>SIM STUDIO {PROJECT_EXTENSION}</small>
                <h2 id="projects-title">{t.projects}</h2>
              </div>
              <button
                className="project-close"
                onClick={() => setProjectMenuOpen(false)}
                aria-label={t.close}
              >
                ×
              </button>
            </div>
            <div className="current-project-card">
              <label>{t.currentProject}</label>
              <div className="project-name-row">
                <input
                  ref={projectNameInputRef}
                  value={
                    currentProjectSaved
                      ? projectNameEditing
                        ? projectNameDraft
                        : projectName
                      : projectName
                  }
                  onChange={(event) => {
                    const name = event.target.value.slice(0, 20);
                    if (currentProjectSaved) setProjectNameDraft(name);
                    else setProjectName(name);
                  }}
                  onKeyDown={(event) => {
                    if (!projectNameEditing) return;
                    if (event.key === "Enter") void confirmProjectRename();
                    if (event.key === "Escape") cancelProjectRename();
                  }}
                  aria-label={t.projectName}
                  readOnly={currentProjectSaved && !projectNameEditing}
                  className={currentProjectSaved && !projectNameEditing ? "locked" : ""}
                  maxLength={20}
                />
                {currentProjectSaved && (
                  <div className="project-name-actions">
                    {projectNameEditing ? (
                      <>
                        <button
                          className="confirm-name"
                          onClick={() => void confirmProjectRename()}
                          disabled={!projectNameDraft.trim() || projectBusy}
                          title={t.confirmProjectName}
                          aria-label={t.confirmProjectName}
                        >
                          ✓
                        </button>
                        <button
                          onClick={cancelProjectRename}
                          disabled={projectBusy}
                          title={t.cancel}
                          aria-label={t.cancel}
                        >
                          ×
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={beginProjectRename}
                          disabled={projectBusy || running}
                          title={t.editProjectName}
                          aria-label={t.editProjectName}
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => void beginDuplicateProject()}
                          disabled={projectBusy || running}
                          title={t.duplicateProject}
                          aria-label={t.duplicateProject}
                        >
                          ⧉
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              {saveNamePrompt && <p className="save-name-prompt">{t.nameBeforeSave}</p>}
              <p>
                <span className={`recovery-dot ${projectSaveState}`}>
                  {projectSaveState === "clean"
                    ? "✓"
                    : projectSaveState === "saving"
                      ? "…"
                      : "!"}
                </span>
                {projectSaveLabel}
              </p>
              <div className="project-primary-actions">
                <button
                  onClick={requestCreateNewProject}
                  disabled={projectBusy || running}
                >
                  ＋ {t.newProject}
                </button>
                <button
                  className="primary"
                  onClick={() => void saveCurrentProject()}
                  disabled={projectBusy || running}
                >
                  {projectBusy ? "…" : "✓"} {t.saveProject}
                </button>
                <small className="save-shortcut-hint">{t.saveShortcut}</small>
              </div>
              <div className="project-file-actions">
                <button onClick={exportCurrentProject} disabled={running}>
                  ↓ {t.exportProject}
                </button>
                <button
                  onClick={() => projectFileRef.current?.click()}
                  disabled={projectBusy || running}
                >
                  ↑ {t.importProject}
                </button>
              </div>
            </div>
            <div className="project-list-head">
              <b>{t.localProjects}</b>
              <span>{projects.length}</span>
            </div>
            <div className="project-list">
              {projects.length ? (
                projects.slice(projectPage * 9, projectPage * 9 + 9).map((project) => (
                  <article
                    key={project.id}
                    className={project.id === activeProjectIdRef.current ? "active" : ""}
                  >
                    <button
                      className="project-open"
                      onClick={() => requestOpenSavedProject(project)}
                      disabled={projectBusy || running}
                    >
                      <span className="project-file-icon">S</span>
                      <span>
                        <b>{project.name}</b>
                        <small>
                          {project.pieceCount} {t.pieces} ·{" "}
                          {new Date(project.updatedAt).toLocaleString(language)}
                        </small>
                      </span>
                    </button>
                    <button
                      className="project-delete"
                      title={t.deleteProject}
                      aria-label={`${t.deleteProject}: ${project.name}`}
                      onClick={() => setProjectConfirmation({ kind: "delete", project })}
                      disabled={projectBusy}
                    >
                      ×
                    </button>
                  </article>
                ))
              ) : (
                <p className="empty-projects">{t.noProjects}</p>
              )}
            </div>
            {projects.length > 9 && (
              <nav className="project-pagination" aria-label={t.localProjects}>
                <button
                  onClick={() => setProjectPage((page) => Math.max(0, page - 1))}
                  disabled={projectPage === 0}
                  title={t.previousPage}
                  aria-label={t.previousPage}
                >
                  ‹
                </button>
                <span>
                  {projectPage + 1} / {Math.ceil(projects.length / 9)}
                </span>
                <button
                  onClick={() =>
                    setProjectPage((page) =>
                      Math.min(Math.ceil(projects.length / 9) - 1, page + 1),
                    )
                  }
                  disabled={projectPage >= Math.ceil(projects.length / 9) - 1}
                  title={t.nextPage}
                  aria-label={t.nextPage}
                >
                  ›
                </button>
              </nav>
            )}
          </section>
        </div>
      )}
      {duplicateProjectDocument && (
        <div className="project-confirm-backdrop" role="presentation">
          <form
            className="project-confirm-dialog duplicate-project-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="duplicate-project-title"
            onSubmit={(event) => {
              event.preventDefault();
              void confirmDuplicateProject();
            }}
          >
            <span className="duplicate-project-icon">⧉</span>
            <h2 id="duplicate-project-title">{t.duplicateTitle}</h2>
            <p>{t.duplicateHelp}</p>
            <label htmlFor="duplicate-project-name">{t.duplicateName}</label>
            <input
              id="duplicate-project-name"
              autoFocus
              value={duplicateProjectName}
              onChange={(event) =>
                setDuplicateProjectName(event.target.value.slice(0, 20))
              }
              maxLength={20}
              onFocus={(event) => event.currentTarget.select()}
            />
            <div>
              <button
                type="button"
                onClick={() => {
                  setDuplicateProjectDocument(null);
                  setDuplicateProjectName("");
                }}
                disabled={projectBusy}
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                className="duplicate-confirm"
                disabled={!duplicateProjectName.trim() || projectBusy}
              >
                {projectBusy ? "…" : "⧉"} {t.createCopy}
              </button>
            </div>
          </form>
        </div>
      )}
      {projectConfirmation && (
        <div className="project-confirm-backdrop" role="presentation">
          <section
            className="project-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="project-confirm-title"
          >
            <span className="project-confirm-icon">!</span>
            <h2 id="project-confirm-title">
              {projectConfirmation.kind === "delete" ? t.deleteTitle : t.unsavedTitle}
            </h2>
            <p>
              {projectConfirmation.kind === "delete"
                ? `${t.deleteWarning} «${projectConfirmation.project.name}»`
                : t.unsavedWarning}
            </p>
            <div>
              <button className="ghost" onClick={() => setProjectConfirmation(null)}>
                {t.cancel}
              </button>
              <button className="danger-confirm" onClick={resolveProjectConfirmation}>
                {projectConfirmation.kind === "delete"
                  ? t.deleteProject
                  : projectConfirmation.kind === "open" ||
                      projectConfirmation.kind === "import"
                    ? t.openAnyway
                    : t.createAnyway}
              </button>
            </div>
          </section>
        </div>
      )}
      {importDraft && (
        <div className="import-backdrop" role="presentation">
          <section
            className="import-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-title"
          >
            <div className="import-dialog-head">
              <div>
                <small>LDR / MPD / IO</small>
                <h2 id="import-title">{t.importTitle}</h2>
              </div>
              <b>{importDraft.fileName}</b>
            </div>
            <div className="import-preview">
              {importDraft.preview ? (
                <img src={importDraft.preview} alt={t.importTitle} />
              ) : (
                <div className="import-loader">
                  <span />
                  <b>{importProgress}%</b>
                </div>
              )}
            </div>
            <div className="import-status">
              <b>{importStatusText}</b>
              <div>
                <i style={{ width: `${importProgress}%` }} />
              </div>
              <p>
                {importDraft.placements.length || "—"} {t.importParts} ·{" "}
                {importDraft.total || "—"} {t.importUnique}
              </p>
              <small>
                {importDraft.paletteCount} {t.importFromPalette}
                {" · "}
                {importDraft.externalCount} {t.importExternalParts}
              </small>
            </div>
            <div className="import-actions">
              <button className="ghost" onClick={discardImport}>
                {t.discard}
              </button>
              <button
                className="play"
                disabled={importDraft.status !== "ready"}
                onClick={() => void placeImportedModel()}
              >
                {t.place}
              </button>
            </div>
          </section>
        </div>
      )}
      <aside className="library">
        <div className="panel-title">
          <span>{t.palette}</span>
          <b>{count}</b>
        </div>
        <div className="part-search">
          <span>⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.search}
          />
        </div>
        <div className="category-tabs">
          {categories.map((c) => (
            <button
              key={c.id}
              className={category === c.id ? "active" : ""}
              onClick={() => {
                setCategory(c.id);
                setSearch("");
              }}
            >
              <i>{c.icon}</i>
              {t.categories[c.id]}
            </button>
          ))}
        </div>
        <div className="reference-box">
          <b>{t.external}</b>
          <div>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void addReference()}
              placeholder="Ej. 32524"
            />
            <button onClick={() => void addReference()}>+</button>
          </div>
        </div>
        <div className="catalog-head">
          <b>{t.categories[categories.find((c) => c.id === category)?.id ?? "beams"]}</b>
          <span>{`${visible.length} ${t.pieces}`}</span>
        </div>
        <div className="parts-grid">
          {visible.map((p) => (
            <article
              key={`${p.part}-${p.color}`}
              draggable
              onDragStart={(e) => dragPart(e, p)}
              onClick={() => {
                setMessage(
                  language === "es"
                    ? `Arrastra ${p.part} a la mesa`
                    : `Drag ${p.part} onto the workspace`,
                );
              }}
            >
              <div className="thumb">
                {p.thumb ? (
                  <img
                    src={p.thumb}
                    alt={p.name}
                    style={{
                      filter: p.rawThumb
                        ? palettePreviewFilter(p.color)
                        : previewFilter(p.color),
                    }}
                  />
                ) : (
                  <span>⚙</span>
                )}
                <i
                  className="color-dot"
                  style={{ background: colorHex[p.color] ?? colorHex[71] }}
                  title={`Color LDraw ${p.color}`}
                />
              </div>
              <b>{p.part}</b>
              <small title={p.name}>{p.name}</small>
              <em>⋮</em>
            </article>
          ))}
        </div>
        {!visible.length && <div className="no-results">{t.noResults}</div>}
        <div className="drag-help">{t.dragHelp}</div>
      </aside>
      <section className="viewport" ref={mountRef}>
        <div className="fps-counter" ref={fpsRef} data-level="high">
          -- FPS
        </div>
        <div className="view-label">
          <span className={running ? "live" : ""} />
          {running ? t.running : message === "catalog-ready" ? t.ready : message}
        </div>
        {controlsHelpVisible ? (
          <div className="camera-help">
            <span>{t.cameraHelp}</span>
            <button
              onClick={() => {
                setControlsHelpVisible(false);
                localStorage.setItem("sim-studio:controls-help-hidden", "1");
              }}
              title={t.hideControls}
              aria-label={t.hideControls}
            >
              ×
            </button>
          </div>
        ) : (
          <button
            className="controls-help-open"
            onClick={() => {
              setControlsHelpVisible(true);
              localStorage.removeItem("sim-studio:controls-help-hidden");
            }}
            title={t.showControls}
            aria-label={t.showControls}
          >
            ?
          </button>
        )}
      </section>
      <div
        className="inspector-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={
          language === "es"
            ? "Cambiar el ancho del panel de propiedades"
            : "Resize the properties panel"
        }
        aria-valuemin={270}
        aria-valuemax={inspectorWidthBounds().maximum}
        aria-valuenow={Math.round(inspectorWidth)}
        tabIndex={0}
        title={
          language === "es"
            ? "Arrastra para cambiar el ancho · doble clic para restablecer"
            : "Drag to resize · double-click to reset"
        }
        onPointerDown={beginInspectorResize}
        onDoubleClick={() => setInspectorWidth(270)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            resizeInspectorBy(20);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            resizeInspectorBy(-20);
          } else if (event.key === "Home") {
            event.preventDefault();
            setInspectorWidth(270);
          }
        }}
      />
      <aside className="inspector">
        <div className="panel-title">
          <span>{t.properties}</span>
        </div>
        {selectedId && selected ? (
          <>
            <div className="selected-card">
              <div className="cube">◆</div>
              <div>
                <small>
                  {t.piece} {selected.part}
                </small>
                <b>{selected.name}</b>
              </div>
            </div>
            <label>
              {language === "es" ? "Información del modelo" : "Model information"}
            </label>
            <div className="model-provenance">
              <div className="data-row">
                <span>{language === "es" ? "Procedencia" : "Origin"}</span>
                <b>
                  {selected.origin === "model-import"
                    ? language === "es"
                      ? "Modelo importado"
                      : "Imported model"
                    : selected.origin === "catalog-search"
                      ? language === "es"
                        ? "Catálogo / referencia"
                        : "Catalog / reference"
                      : language === "es"
                        ? "Paleta predeterminada"
                        : "Default palette"}
                </b>
              </div>
              {selected.importFile && (
                <div className="data-row">
                  <span>{language === "es" ? "Archivo de origen" : "Source file"}</span>
                  <b title={selected.importFile}>{selected.importFile}</b>
                </div>
              )}
              <div className="data-row">
                <span>
                  {selected.origin === "model-import"
                    ? language === "es"
                      ? "Referencia en el archivo"
                      : "Reference in file"
                    : language === "es"
                      ? "Referencia solicitada"
                      : "Requested reference"}
                </span>
                <b>{selected.requestedPart ?? selected.part}</b>
              </div>
              <div className="data-row">
                <span>
                  {language === "es" ? "Devuelto por catálogo" : "Catalog result"}
                </span>
                <b>
                  {selected.catalogReturnedPart ??
                    (selected.origin === "default-palette" ? selected.part : "—")}
                </b>
              </div>
              <div className="data-row">
                <span>{language === "es" ? "Modelo cargado" : "Loaded model"}</span>
                <b>{selected.resolvedPart ?? selected.modelPart ?? selected.part}.dat</b>
              </div>
              <div className="data-row">
                <span>
                  {language === "es" ? "Fuente de geometría" : "Geometry source"}
                </span>
                <b>
                  {selected.sourceKind === "packaged-cache" || selected.geometry
                    ? language === "es"
                      ? "Precargada localmente"
                      : "Local preloaded cache"
                    : selected.sourceKind === "external-catalog"
                      ? language === "es"
                        ? "Catálogo externo"
                        : "External catalog"
                      : "LDraw"}
                </b>
              </div>
              {selected.catalogQuery && (
                <div className="data-row">
                  <span>
                    {selected.origin === "model-import"
                      ? language === "es"
                        ? "Referencia pedida al catálogo"
                        : "Reference requested from catalog"
                      : language === "es"
                        ? "Consulta enviada"
                        : "Catalog query"}
                  </span>
                  <b>{selected.catalogQuery}</b>
                </div>
              )}
              <div className="data-row">
                <span>
                  {language === "es"
                    ? "Color solicitado / fuente"
                    : "Requested / source color"}
                </span>
                <b>
                  {selected.color} / {selected.sourceColor ?? selected.color}
                </b>
              </div>
              {selected.geometry && (
                <div className="data-row">
                  <span>{language === "es" ? "Recurso local" : "Local resource"}</span>
                  <b title={selected.geometry}>{selected.geometry}</b>
                </div>
              )}
              {selected.downloadUrl && (
                <div className="data-row">
                  <span>
                    {language === "es" ? "Enlace de carga usado" : "Download source used"}
                  </span>
                  <a
                    className="model-source-link"
                    href={selected.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={selected.downloadUrl}
                  >
                    {selected.downloadSource === "local"
                      ? language === "es"
                        ? "Recurso local ↗"
                        : "Local asset ↗"
                      : selected.downloadSource === "legacy"
                        ? language === "es"
                          ? "CDN de respaldo ↗"
                          : "Fallback CDN ↗"
                        : language === "es"
                          ? "CDN principal ↗"
                          : "Primary CDN ↗"}
                  </a>
                </div>
              )}
            </div>
            <label>{t.color}</label>
            <div className="piece-color-control">
              <i
                style={{
                  background: colorHex[selected.color] ?? colorHex[71],
                }}
              />
              <select
                aria-label={t.color}
                value={selected.color}
                disabled={running}
                onChange={(event) => void changeSelectedColor(+event.target.value)}
              >
                {!ldrawColorOptions.includes(selected.color) && (
                  <option value={selected.color}>LDraw {selected.color}</option>
                )}
                {ldrawColorOptions.map((color) => (
                  <option value={color} key={color}>
                    {color} · {ldrawColorNames[color]?.[language] ?? `LDraw ${color}`}
                  </option>
                ))}
              </select>
            </div>
            <label className="property-check exact-collider-check">
              <input
                type="checkbox"
                checked={selected.exactCollider}
                disabled={running}
                onChange={(event) => {
                  const state = appRef.current;
                  if (!state) return;
                  state.recordHistory();
                  selected.exactCollider = event.target.checked;
                  setConnectorRevision((value) => value + 1);
                  state.scheduleRecoverySave();
                  setMessage(
                    event.target.checked
                      ? language === "es"
                        ? "Colisión exacta activada para esta pieza (mayor coste físico)"
                        : "Exact collision enabled for this part (higher physics cost)"
                      : language === "es"
                        ? "La pieza vuelve a usar su colisión compuesta simplificada"
                        : "The part now uses its simplified compound collision",
                  );
                }}
              />
              <span>
                {language === "es"
                  ? "Usar la malla del modelo como colisión"
                  : "Use the model mesh as collision"}
                <small>
                  {language === "es"
                    ? "Más precisa, pero consume más recursos"
                    : "More accurate, but more expensive"}
                </small>
              </span>
            </label>
            <label>{t.move}</label>
            <div className="control-grid">
              <button onClick={() => nudge("x", -(gridStep || 0.25))}>X−</button>
              <button onClick={() => nudge("y", gridStep || 0.25)}>Y+</button>
              <button onClick={() => nudge("z", -(gridStep || 0.25))}>Z−</button>
              <button onClick={() => nudge("x", gridStep || 0.25)}>X+</button>
              <button onClick={() => nudge("y", -(gridStep || 0.25))}>Y−</button>
              <button onClick={() => nudge("z", gridStep || 0.25)}>Z+</button>
            </div>
            <label>{t.rotationPivot}</label>
            <select
              className="pivot-select"
              value={selectedPivotValue}
              disabled={running}
              onChange={(event) => {
                const state = appRef.current;
                if (!state) return;
                state.recordHistory();
                const option = selectedPivotOptions.find(
                  (candidate) => candidate.key === event.target.value,
                );
                selected.rotationPivotKey = option?.key ?? "center";
                selected.rotationPivotLocal = option?.local.clone();
                state.refreshDebug();
                setConnectorRevision((value) => value + 1);
              }}
            >
              <option value="center">{t.pieceCenter}</option>
              {selectedPivotOptions.map((option) => (
                <option value={option.key} key={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="angle-head">
              <label>{t.rotateAny}</label>
              <input
                type="number"
                min=".1"
                max="360"
                step=".1"
                value={rotationAngle}
                disabled={running}
                onChange={(event) =>
                  setRotationAngle(
                    Math.max(0.1, Math.min(360, +event.target.value || 0.1)),
                  )
                }
              />
              <span>°</span>
            </div>
            <div className="control-grid rotate">
              <button onClick={() => rotate("x")}>↻ X</button>
              <button onClick={() => rotate("y")}>↻ Y</button>
              <button onClick={() => rotate("z")}>↻ Z</button>
              <button onClick={() => rotate("x", -1)}>↺ X</button>
              <button onClick={() => rotate("y", -1)}>↺ Y</button>
              <button onClick={() => rotate("z", -1)}>↺ Z</button>
            </div>
            {(isAxlePart(selected) ||
              selected.connectors.some(
                (connector) => connector.role === "shaft" && connector.kind === "axle",
              )) && (
              <label className="property-check dynamic-axle-check">
                <input
                  type="checkbox"
                  checked={selected.dynamicAxleConnections}
                  disabled={running}
                  onChange={(event) => {
                    appRef.current?.recordHistory();
                    selected.dynamicAxleConnections = event.target.checked;
                    setConnectionRevision((value) => value + 1);
                    setMessage(
                      event.target.checked
                        ? language === "es"
                          ? "El eje podrá conectarse y desconectarse durante la simulación"
                          : "The axle may connect and disconnect during simulation"
                        : language === "es"
                          ? "Conexiones dinámicas del eje desactivadas"
                          : "Dynamic axle connections disabled",
                    );
                  }}
                />
                <span>
                  {language === "es"
                    ? "Conectar/desconectar el eje durante la simulación"
                    : "Connect/disconnect axle during simulation"}
                </span>
              </label>
            )}
            {selected.gear && selectedGearSpec && (
              <div className="connection-editor gear-link-editor">
                <label>{language === "es" ? "Engranaje" : "Gear coupling"}</label>
                <div className="data-row">
                  <span>{language === "es" ? "Dientes" : "Teeth"}</span>
                  <b>{selectedGearSpec.teeth}</b>
                </div>
                <div className="data-row">
                  <span>{language === "es" ? "Radio primitivo" : "Pitch radius"}</span>
                  <b>{selectedGearSpec.pitchRadius.toFixed(3)} studs</b>
                </div>
                {selectedGearLinks.length ? (
                  selectedGearLinks.map((link) => {
                    const selectedIsA = link.a.value === selected,
                      other = selectedIsA ? link.b : link.a,
                      ratio = selectedIsA ? link.ratio : 1 / link.ratio;
                    return (
                      <div
                        className="connection-card gear-link-card"
                        key={`${link.a.value.id}:${link.b.value.id}`}
                      >
                        <div>
                          <b>
                            {language === "es" ? "Enlazado con" : "Meshed with"}{" "}
                            {other.value.part}
                          </b>
                          <span>
                            {selectedGearSpec.teeth}:{other.spec.teeth} ·{" "}
                            {ratio.toFixed(3)}× ·{" "}
                            {link.perpendicular
                              ? language === "es"
                                ? "engrane cónico a 90°"
                                : "90° bevel mesh"
                              : language === "es"
                                ? "giro inverso"
                                : "opposite rotation"}
                          </span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="no-connections">
                    {running
                      ? language === "es"
                        ? "No hay otro engranaje compatible a la distancia correcta."
                        : "No compatible gear is at the required distance."
                      : language === "es"
                        ? "Los enlaces se detectan al iniciar la simulación."
                        : "Gear meshes are detected when simulation starts."}
                  </p>
                )}
              </div>
            )}
            {selectedConnections.length > 0 && (
              <div className="connection-editor">
                <label>{t.pieceJoints}</label>
                {selectedConnections.length ? (
                  selectedConnections.map((connection, index) => {
                    const other = connection.a === selected ? connection.b : connection.a;
                    return (
                      <div className="connection-card" key={connection.id}>
                        <div>
                          <b>
                            {t.joint} {index + 1} · {other.part}
                          </b>
                          <span>
                            {profileLabels[connection.profile]} ·{" "}
                            {modeLabels[connection.mode]}
                            {connection.forced
                              ? ` (${t.forcedJoint} ${(connection.forcedOffset ?? 0).toFixed(2)} u)`
                              : ""}
                          </span>
                        </div>
                        <select
                          value={connection.mode}
                          disabled={running}
                          onChange={(event) =>
                            setConnectionMode(
                              connection.id,
                              event.target.value as JointMode,
                            )
                          }
                        >
                          {allowedModes(connection.profile).map((mode) => (
                            <option value={mode} key={mode}>
                              {modeLabels[mode]}
                            </option>
                          ))}
                        </select>
                        {connection.mode === "motor" && (
                          <>
                            <label className="motor-label">{t.speed}</label>
                            <div className="motor-control">
                              <input
                                aria-label="Velocidad del motor"
                                type="range"
                                min="-30"
                                max="30"
                                step=".5"
                                value={connection.motorSpeed}
                                onChange={(event) =>
                                  setMotorSpeed(connection.id, +event.target.value)
                                }
                              />
                              <b>{connection.motorSpeed.toFixed(1)} rad/s</b>
                            </div>
                            <label className="motor-label">{t.torque}</label>
                            <div className="motor-control">
                              <input
                                aria-label="Fuerza del motor"
                                type="range"
                                min="5"
                                max="400"
                                step="5"
                                value={connection.motorForce}
                                onChange={(event) =>
                                  setMotorForce(connection.id, +event.target.value)
                                }
                              />
                              <b>{connection.motorForce.toFixed(0)}</b>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="no-connections">{t.noJoints}</p>
                )}
              </div>
            )}
            <div className="data-row">
              <span>{t.connectMap}</span>
              <b>
                {selected.connectors.length} {t.points}
              </b>
            </div>
            <button
              className="map-toggle"
              onClick={() => setConnectionMapOpen((value) => !value)}
            >
              {connectionMapOpen ? t.closeMap : t.editMap}
            </button>
            {connectionMapOpen && (
              <div className="map-editor">
                <p>{t.mapHelp}</p>
                <div className="map-actions">
                  <button onClick={addConnector}>{t.addPoint}</button>
                  <button onClick={regenerateConnectorMap}>{t.regenerateMap}</button>
                  <button onClick={exportConnectorMap}>{t.exportJson}</button>
                  <button onClick={() => connectorFileRef.current?.click()}>
                    {t.importJson}
                  </button>
                  <input
                    ref={connectorFileRef}
                    hidden
                    type="file"
                    accept=".json,application/json"
                    onChange={(event) =>
                      event.target.files?.[0] &&
                      void importConnectorMap(event.target.files[0])
                    }
                  />
                </div>
                {selected.connectors.map((connector, index) => (
                  <details
                    className="connector-row"
                    key={`${index}-${connector.role}-${connector.kind}`}
                  >
                    <summary>
                      <b>#{index + 1}</b> {connector.role === "socket" ? t.hole : t.shaft}{" "}
                      ·{" "}
                      {connector.kind === "round"
                        ? t.round
                        : connector.kind === "axle"
                          ? t.axle
                          : t.halfRound}
                      <span className="connector-row-actions">
                        <button
                          className="duplicate-connector"
                          aria-label={t.duplicateConnector}
                          title={t.duplicateConnector}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            duplicateConnector(index);
                          }}
                        >
                          ⧉
                        </button>
                        <button
                          aria-label={t.deleteConnector}
                          title={t.deleteConnector}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            removeConnector(index);
                          }}
                        >
                          ×
                        </button>
                      </span>
                    </summary>
                    <div className="connector-types">
                      <select
                        value={connector.role}
                        onChange={(event) =>
                          updateConnector(index, "role", event.target.value)
                        }
                      >
                        <option value="socket">{t.hole}</option>
                        <option value="shaft">{t.shaft}</option>
                      </select>
                      <select
                        value={connector.kind}
                        onChange={(event) =>
                          updateConnector(index, "kind", event.target.value)
                        }
                      >
                        <option value="round">{t.round}</option>
                        <option value="axle">{t.axle}</option>
                        <option value="half">{t.halfRound}</option>
                      </select>
                    </div>
                    <label>{t.position}</label>
                    <div className="vector-fields">
                      {connector.local.toArray().map((value, component) => (
                        <DeferredNumberInput
                          key={component}
                          value={+value.toFixed(4)}
                          onCommit={(nextValue) =>
                            updateConnector(index, "local", String(nextValue), component)
                          }
                        />
                      ))}
                    </div>
                    <label>{t.axis}</label>
                    <div className="vector-fields">
                      {connector.axis.toArray().map((value, component) => (
                        <DeferredNumberInput
                          key={component}
                          value={+value.toFixed(4)}
                          onCommit={(nextValue) =>
                            updateConnector(index, "axis", String(nextValue), component)
                          }
                        />
                      ))}
                    </div>
                    <div className="measure-fields">
                      <label>
                        {t.diameter}
                        <DeferredNumberInput
                          min={0.01}
                          value={connector.diameter}
                          onCommit={(nextValue) =>
                            updateConnector(index, "diameter", String(nextValue))
                          }
                        />
                      </label>
                      <label>
                        {t.length}
                        <DeferredNumberInput
                          min={0.01}
                          value={connector.length ?? 0.5}
                          onCommit={(nextValue) =>
                            updateConnector(index, "length", String(nextValue))
                          }
                        />
                      </label>
                    </div>
                  </details>
                ))}
              </div>
            )}
            <div className="data-row">
              <span>{t.collisionMapEditor}</span>
              <b>
                {selected.colliders.length}
                {selected.gear ? ` + ${selected.gearColliders.length}` : ""} formas
              </b>
            </div>
            <button
              className="map-toggle collision-map-toggle"
              onClick={() => {
                const next = !collisionMapOpen;
                setCollisionMapOpen(next);
                if (next) {
                  const state = appRef.current;
                  if (state) {
                    state.debug.colliders = true;
                    state.refreshDebug();
                  }
                  setDebugViews((current) => ({
                    ...current,
                    colliders: true,
                  }));
                }
              }}
            >
              {collisionMapOpen ? t.closeCollisionMap : t.editCollisionMap}
            </button>
            {collisionMapOpen && (
              <div className="map-editor collision-map-editor">
                <p>{t.collisionMapHelp}</p>
                {selected.gear && (
                  <>
                    <div className="collision-layer-tabs">
                      <button
                        className={collisionLayer === "normal" ? "active" : ""}
                        onClick={() => setCollisionLayer("normal")}
                      >
                        {t.normalCollision}
                      </button>
                      <button
                        className={collisionLayer === "gear" ? "active" : ""}
                        onClick={() => setCollisionLayer("gear")}
                      >
                        {t.gearCollision}
                      </button>
                    </div>
                    <p className="gear-collision-help">{t.gearCollisionHelp}</p>
                  </>
                )}
                <div className="map-actions collision-map-actions">
                  <button onClick={() => addCollider("box")}>{t.addBox}</button>
                  <button onClick={() => addCollider("cylinder")}>{t.addCylinder}</button>
                  <button onClick={exportCollisionMap}>{t.exportJson}</button>
                  <button onClick={() => colliderFileRef.current?.click()}>
                    {t.importJson}
                  </button>
                  <input
                    ref={colliderFileRef}
                    hidden
                    type="file"
                    accept=".json,application/json"
                    onChange={(event) =>
                      event.target.files?.[0] &&
                      void importCollisionMap(event.target.files[0])
                    }
                  />
                </div>
                {selectedCollisionPrimitives.map((primitive, index) => {
                  const rotation = new THREE.Euler().setFromQuaternion(
                    primitive.rotation,
                    "XYZ",
                  );
                  return (
                    <details
                      className="connector-row collision-row"
                      key={`${index}-${primitive.shape}`}
                    >
                      <summary>
                        <b>#{index + 1}</b>{" "}
                        {primitive.shape === "box" ? t.box : t.cylinder}
                        <button
                          onClick={(event) => {
                            event.preventDefault();
                            removeCollider(index);
                          }}
                        >
                          ×
                        </button>
                      </summary>
                      <div className="connector-types">
                        <select
                          value={primitive.shape}
                          onChange={(event) =>
                            updateCollider(index, "shape", event.target.value)
                          }
                        >
                          <option value="box">{t.box}</option>
                          <option value="cylinder">{t.cylinder}</option>
                        </select>
                      </div>
                      <label>{t.position}</label>
                      <div className="vector-fields">
                        {primitive.center.toArray().map((value, component) => (
                          <DeferredNumberInput
                            key={component}
                            value={value}
                            onCommit={(nextValue) =>
                              updateCollider(
                                index,
                                "center",
                                String(nextValue),
                                component,
                              )
                            }
                          />
                        ))}
                      </div>
                      <label>{t.rotation}</label>
                      <div className="vector-fields">
                        {[rotation.x, rotation.y, rotation.z].map((value, component) => (
                          <DeferredNumberInput
                            key={component}
                            step={1}
                            value={THREE.MathUtils.radToDeg(value)}
                            onCommit={(nextValue) =>
                              updateCollider(
                                index,
                                "rotation",
                                String(nextValue),
                                component,
                              )
                            }
                          />
                        ))}
                      </div>
                      {primitive.shape === "box" ? (
                        <>
                          <label>{t.size}</label>
                          <div className="vector-fields">
                            {(primitive.size ?? new THREE.Vector3(1, 1, 1))
                              .toArray()
                              .map((value, component) => (
                                <DeferredNumberInput
                                  key={component}
                                  min={0.01}
                                  value={value}
                                  onCommit={(nextValue) =>
                                    updateCollider(
                                      index,
                                      "size",
                                      String(nextValue),
                                      component,
                                    )
                                  }
                                />
                              ))}
                          </div>
                        </>
                      ) : (
                        <div className="measure-fields">
                          <label>
                            {t.radius}
                            <DeferredNumberInput
                              min={0.01}
                              value={primitive.radius ?? 0.5}
                              onCommit={(nextValue) =>
                                updateCollider(index, "radius", String(nextValue))
                              }
                            />
                          </label>
                          <label>
                            {t.halfHeight}
                            <DeferredNumberInput
                              min={0.01}
                              value={primitive.halfHeight ?? 0.5}
                              onCommit={(nextValue) =>
                                updateCollider(index, "halfHeight", String(nextValue))
                              }
                            />
                          </label>
                        </div>
                      )}
                    </details>
                  );
                })}
              </div>
            )}
            <div className="data-row">
              <span>{t.activeJoints}</span>
              <b>{selectedConnections.length}</b>
            </div>
            {selected.gear && (
              <div className="data-row">
                <span>{t.physicalTag}</span>
                <b>⚙ {t.gearTag}</b>
              </div>
            )}
            <button className="danger" onClick={remove}>
              {t.deletePiece}
            </button>
          </>
        ) : (
          <div className="empty">
            <span>◇</span>
            <b>{t.nothing}</b>
            <p>{t.selectHelp}</p>
          </div>
        )}
        <div className="debug-tools">
          <label>{t.technical}</label>
          <button
            className={debugViews.colliders ? "active" : ""}
            aria-pressed={debugViews.colliders}
            onClick={() => toggleDebug("colliders")}
          >
            <i className="green" />
            {t.collisionMeshes}
          </button>
          <button
            className={debugViews.connectors ? "active" : ""}
            aria-pressed={debugViews.connectors}
            onClick={() => toggleDebug("connectors")}
          >
            <i className="cyan" />
            {t.connectionMap}
          </button>
          <div className="connect-legend">
            <span>
              <i className="socket-round" />
              {t.blue}
            </span>
            <span>
              <i className="shaft-round" />
              {t.orange}
            </span>
            <span>
              <i className="socket-axle" />
              {t.green}
            </span>
            <span>
              <i className="shaft-axle" />
              {t.purple}
            </span>
            <span>
              <i className="socket-half" />
              {t.cyan}
            </span>
            <span>
              <i className="shaft-half" />
              {t.pink}
            </span>
          </div>
          <button
            className={debugViews.physics ? "active" : ""}
            aria-pressed={debugViews.physics}
            onClick={() => toggleDebug("physics")}
          >
            <i className="orange" />
            {t.bodies}
          </button>
        </div>
        <div className="log-tools">
          <label>{t.physicsLog}</label>
          <button disabled={!lastLog} onClick={downloadPhysicsLog}>
            {lastLog ? t.downloadLog : t.stopForLog}
          </button>
          {lastLog && (
            <details>
              <summary>{t.readLog}</summary>
              <pre>{lastLog}</pre>
            </details>
          )}
        </div>
        <div className="log-tools">
          <label>{t.performanceLog}</label>
          <p>{t.performanceHelp}</p>
          <button onClick={downloadPerformanceLog}>{t.downloadPerformance}</button>
        </div>
        <div className="physics">
          <label className="grid-setting-title">{t.gridSize}</label>
          <div className="grid-setting" role="group" aria-label={t.gridSize}>
            {([0.25, 0.5, 1, 0] as GridStep[]).map((step) => (
              <button
                key={step}
                className={gridStep === step ? "active" : ""}
                disabled={running}
                onClick={() => setGridStep(step)}
              >
                {step === 0 ? t.noGridSnap : `${step} u`}
              </button>
            ))}
          </div>
          <label className="grid-setting-title">{t.axleSnap}</label>
          <div className="grid-setting" role="group" aria-label={t.axleSnap}>
            {([0.25, 0.125, 0.0625, 0] as AxleSnapStep[]).map((step) => (
              <button
                key={step}
                className={axleSnapStep === step ? "active" : ""}
                disabled={running}
                onClick={() => setAxleSnapStep(step)}
              >
                {step === 0 ? t.noGridSnap : `${step} u`}
              </button>
            ))}
          </div>
          <label className="grid-setting-title">{t.rotationSnap}</label>
          <div className="grid-setting" role="group" aria-label={t.rotationSnap}>
            {([45, 22.5, 11.25, 0] as RotationSnapStep[]).map((step) => (
              <button
                key={step}
                className={rotationSnapStep === step ? "active" : ""}
                disabled={running}
                onClick={() => setRotationSnapStep(step)}
              >
                {step === 0 ? t.noGridSnap : `${step}°`}
              </button>
            ))}
          </div>
          <label className="structural-title">{t.structuralBehavior}</label>
          <div className="structural-mode" role="group" aria-label={t.structuralBehavior}>
            <button
              className={structuralMode === "rigid" ? "active" : ""}
              disabled={running}
              onClick={() => setStructuralMode("rigid")}
            >
              {t.rigidStructure}
            </button>
            <button
              className={structuralMode === "flexible" ? "active" : ""}
              disabled={running}
              onClick={() => setStructuralMode("flexible")}
            >
              {t.flexibleStructure}
            </button>
          </div>
          <div className="stiffness-head">
            <span>{t.structuralStiffness}</span>
            <output>{structuralStiffness}%</output>
          </div>
          <input
            className="stiffness-range"
            type="range"
            min="1"
            max="100"
            step="1"
            value={structuralStiffness}
            disabled={running}
            onChange={(event) => setStructuralStiffness(+event.target.value)}
          />
          <p className="structural-help">
            {structuralMode === "rigid" ? t.rigidStructureHelp : t.flexibleStructureHelp}
          </p>
          <label className="physics-parameters-title">{t.globalPhysicsParameters}</label>
          {(
            [
              ["pieceFriction", t.pieceFriction, 0, 2, 0.01, ""],
              ["rubberFriction", t.rubberFriction, 0, 3, 0.05, ""],
              ["frictionlessPinRotation", t.frictionlessPinRotation, 0, 5, 0.05, ""],
              ["axleSlidingFriction", t.axleSlidingFriction, 0, 1, 0.01, ""],
              ["axleRotationFriction", t.axleRotationFriction, 0, 1, 0.01, ""],
              ["axleTolerance", t.axleTolerance, 0, 0.1, 0.005, " studs"],
            ] as [keyof PhysicsSettings, string, number, number, number, string][]
          ).map(([key, label, min, max, step, unit]) => (
            <div className="physics-parameter" key={key}>
              <div>
                <span>{label}</span>
                <output>
                  {physicsSettings[key].toFixed(step < 0.01 ? 3 : 2)}
                  {unit}
                </output>
              </div>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={physicsSettings[key]}
                disabled={running}
                onChange={(event) =>
                  setPhysicsSettings((current) => ({
                    ...current,
                    [key]: Number(event.target.value),
                  }))
                }
              />
            </div>
          ))}
          <p className="physics-parameters-help">{t.globalPhysicsHelp}</p>
          <button
            className="physics-reset"
            disabled={running}
            onClick={() => {
              setStructuralMode("rigid");
              setStructuralStiffness(85);
              setPhysicsSettings({ ...DEFAULT_PHYSICS_SETTINGS });
            }}
          >
            ↺ {t.resetPhysicsParameters}
          </button>
          <b>{t.physicsEngine}</b>
          <span>
            <i /> Rapier + LDraw Connect
          </span>
          <p>{t.physicsHelp}</p>
        </div>
      </aside>
      <footer>
        <span>
          ● {t.grid}: {gridStep ? `${gridStep} u` : t.noGridSnap}
        </span>
        <a href="https://www.ldraw.org/" target="_blank" rel="noreferrer">
          {t.ldrawCredit}
        </a>
        <span>Y ↑</span>
        <span>
          {count} {t.pieces} · {t.cache}
        </span>
      </footer>
    </main>
  );
}
