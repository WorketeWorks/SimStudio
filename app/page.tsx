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
import { LDrawLoader } from "three/addons/loaders/LDrawLoader.js";
import { LDrawConditionalLineMaterial } from "three/addons/materials/LDrawConditionalLineMaterial.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  ldrawToScenePlacement,
  makeLDR,
  parseLDR,
  type LDrawPlacement,
} from "./ldraw";
import { extractStudioLDraw } from "./studio-io";
import {
  approximateCollisionPrimitives,
  approximateGearCollisionPrimitives,
  detectConnectorHoles,
  fallbackBeamConnectors,
  hybridAxlePinConnectors,
  objectLocalBounds,
  rodConnectors,
  type CollisionPrimitive,
  type MeshConnector,
} from "./connectors";
import { paletteParts } from "./palette";
import { preloadedConnectionMaps } from "./connection-maps";
import {
  preloadedCollisionMaps,
  preloadedGearCollisionMaps,
} from "./collision-maps";
import {
  buildConnectorContactExclusions,
  contactPairKey,
} from "./physics-contact-filter";
import {
  findParallelGearPairs,
  gearSpecFor,
  type GearPair,
  type GearPose,
} from "./gears";
import preloadedCatalog from "./preloaded-catalog.json";

type PieceKind = "beam" | "wheel" | "motor";
type CatalogPart = {
  part: string;
  name: string;
  thumb?: string;
  kind: PieceKind;
  color: number;
  family?: string;
  modelPart?: string;
  rawThumb?: boolean;
  geometry?: string;
  sourceColor?: number;
  gear?: boolean;
};
type Piece = CatalogPart & {
  id: number;
  mesh: THREE.Object3D;
  connectors: MeshConnector[];
  colliders: CollisionPrimitive[];
  gearColliders: CollisionPrimitive[];
  gear: boolean;
  fixed: boolean;
  pin: boolean;
  frictionPin: boolean;
  dynamicAxleConnections: boolean;
  lockSprite?: THREE.Sprite;
  body?: RAPIER.RigidBody;
  physicsOffset?: THREE.Vector3;
  physicsBase?: THREE.Quaternion;
  physicsIsland?: Piece[];
  physicsIslandFixed?: boolean;
  renderBatched?: boolean;
};
type RenderBatchItem = {
  mesh: THREE.InstancedMesh;
  pieces: Piece[];
  localMatrix: THREE.Matrix4;
};
type RenderBatchStats = {
  lineBatches: number;
  meshBatches: number;
  hiddenOriginalLines: number;
  hiddenOriginalMeshes: number;
};
type PreparedImportPlacement = {
  catalog: CatalogPart;
  source: LDrawPlacement;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
};
type ImportDraft = {
  fileName: string;
  status: "reading" | "palette" | "external" | "preview" | "ready" | "error";
  progress: number;
  total: number;
  paletteCount: number;
  externalCount: number;
  placements: PreparedImportPlacement[];
  preview?: string;
  error?: string;
};
type JointMode = "fixed" | "rotation" | "linear" | "rotation-linear" | "motor";
type StructuralMode = "rigid" | "flexible";
type ConnectionProfile = "pin-round" | "axle-cross" | "axle-round";
type Connection = {
  id: string;
  a: Piece;
  b: Piece;
  socket: MeshConnector;
  shaft: MeshConnector;
  mode: JointMode;
  profile: ConnectionProfile;
  point: THREE.Vector3;
  axis: THREE.Vector3;
  localAxisA: THREE.Vector3;
  travel: number;
  motorSpeed: number;
  motorForce: number;
  userConfigured: boolean;
};
type RuntimeGearLink = GearPair<Piece> & {
  axisA: THREE.Vector3;
  axisB: THREE.Vector3;
};
type ManualConnectDraft = {
  piece: Piece;
  connector: MeshConnector;
  cursor: THREE.Vector3;
  plane: THREE.Plane;
  line: THREE.Line;
};
type DebugFlags = { colliders: boolean; connectors: boolean; physics: boolean };
type SimulationLog = {
  startedAt: string;
  endedAt?: string;
  duration?: number;
  connections: { a: string; b: string; type: string; point: number[] }[];
  samples: {
    time: number;
    bodies: {
      id: number;
      part: string;
      fixed: boolean;
      position: number[];
      rotation: number[];
      linearVelocity: number[];
      angularVelocity: number[];
    }[];
  }[];
  maxLinearSpeed: number;
  maxAngularSpeed: number;
  maxSpringForce: number;
  events: string[];
};
type FramePerformanceSample = {
  elapsedMs: number;
  frameIntervalMs: number;
  betweenFramesMs: number;
  totalMs: number;
  inputMs: number;
  forceResetMs: number;
  springMs: number;
  jointForcesMs: number;
  worldStepMs: number;
  syncMs: number;
  physicsLogMs: number;
  connectionScanMs: number;
  batchMs: number;
  debugMs: number;
  locksMs: number;
  renderMs: number;
  gpuMs: number | null;
  pieces: number;
  connections: number;
  activeBodies: number;
  sleepingBodies: number;
  drawCalls: number;
  triangles: number;
  lines: number;
  resolutionScale: number;
};
type PerformanceTrace = {
  startedAt: string;
  startedAtMs: number;
  samples: FramePerformanceSample[];
  cursor: number;
  totalFrames: number;
};
type AppState = {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  floor: THREE.Mesh;
  grid: THREE.GridHelper;
  pieces: Piece[];
  selected?: Piece;
  running: boolean;
  world?: RAPIER.World;
  physicsHooks?: RAPIER.PhysicsHooks;
  physicsEventQueue?: RAPIER.EventQueue;
  contactFilterStats?: { tested: number; rejected: number };
  connections: Connection[];
  gearLinks: RuntimeGearLink[];
  physicsJoints: Map<string, RAPIER.ImpulseJoint>;
  dynamicNoContactPairs: Set<string>;
  contactExclusions: Set<string>;
  contactCandidates: Map<string, { a: Piece; b: Piece }>;
  rigidIslandByPiece?: Map<Piece, Piece[]>;
  createPhysicsJoint?: (connection: Connection) => RAPIER.ImpulseJoint | undefined;
  dynamicConnectionFrame: number;
  manualConnect?: ManualConnectDraft;
  snapshot?: {
    piece: Piece;
    position: THREE.Vector3;
    rotation: THREE.Quaternion;
  }[];
  connectionModes: Map<
    string,
    {
      mode: JointMode;
      motorSpeed: number;
      motorForce: number;
      userConfigured: boolean;
    }
  >;
  addPart: (
    part: CatalogPart,
    position: THREE.Vector3,
    rotation?: THREE.Quaternion,
  ) => Promise<Piece | null>;
  preloadPart: (part: CatalogPart) => Promise<void>;
  recolorPart: (piece: Piece, color: number) => Promise<boolean>;
  renderImportPreview: (parts: PreparedImportPlacement[]) => Promise<string>;
  verifyConnections: () => number;
  verifyConnectionsAsync: () => Promise<number>;
  rebuildRenderBatches: (pieces?: Piece[]) => void;
  updateRenderBatches: () => void;
  disposeRenderBatches: () => void;
  renderBatchRoot?: THREE.Group;
  renderLineBatchRoot?: THREE.Group;
  renderBatchItems: RenderBatchItem[];
  renderBatchStats: RenderBatchStats;
  renderBatchesDirty: boolean;
  bulkLoading?: boolean;
  bulkConnecting?: boolean;
  largeSimulation?: boolean;
  performanceTrace: PerformanceTrace;
  pendingInputMs: number;
  pendingConnectionMs: number;
  connectionScanVersion: number;
  renderScale: number;
  gpuTimerSupported: boolean;
  gpuRenderer: string;
  gpuVendor: string;
  pendingPlacement?: {
    pieces: Piece[];
    offsets: THREE.Vector3[];
  };
  debug: DebugFlags;
  refreshDebug: () => void;
  updateDebug: () => void;
  simLog?: SimulationLog;
  nextLogSample?: number;
  simStartedMs?: number;
};

// The older pybricks mirror does not contain newer official parts such as
// 71708. Keep it as a fallback, but use the actively updated mirror first.
const LDRAW =
    "https://cdn.jsdelivr.net/gh/remig/ldraw_parts@master/",
  LEGACY_LDRAW = "https://cdn.jsdelivr.net/gh/pybricks/ldraw@master/",
  MODEL_LOAD_TIMEOUT = 20_000,
  AUTO_CONNECTIONS_ENABLED = true,
  CORRECTION_MAP_REVISION = "2026-08-10-corrections-1";
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
const colorHex: Record<number, string> = {
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
const ldrawColorNames: Record<number, { es: string; en: string }> = {
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
const ldrawColorOptions = Object.keys(colorHex)
  .map(Number)
  .sort((a, b) => a - b);
const previewFilter = (color: number) =>
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
const palettePreviewFilter = (color = 71) => {
  const shadow = " drop-shadow(0 2px 1px #05060766)";
  if (color === 0)
    return "grayscale(1) brightness(.35) contrast(1.35)" + shadow;
  if (color === 1)
    return (
      "sepia(1) saturate(6) hue-rotate(171deg) brightness(.62) contrast(1.2)" +
      shadow
    );
  if (color === 4)
    return (
      "sepia(1) saturate(7) hue-rotate(313deg) brightness(.67) contrast(1.2)" +
      shadow
    );
  if (color === 14)
    return (
      "sepia(1) saturate(6) hue-rotate(2deg) brightness(1.02) contrast(1.12)" +
      shadow
    );
  if (color === 15)
    return "grayscale(1) brightness(1.12) contrast(1.06)" + shadow;
  if (color === 19)
    return (
      "sepia(.9) saturate(1.9) hue-rotate(350deg) brightness(.96) contrast(1.12)" +
      shadow
    );
  if (color === 70)
    return (
      "sepia(1) saturate(3.2) hue-rotate(334deg) brightness(.45) contrast(1.3)" +
      shadow
    );
  if (color === 72)
    return "grayscale(1) brightness(.56) contrast(1.28)" + shadow;
  return "grayscale(1) brightness(.78) contrast(1.2)" + shadow;
};
const categories = [
  { id: "beams", icon: "━" },
  { id: "axles", icon: "╂" },
  { id: "pins", icon: "●" },
  { id: "connectors", icon: "⌘" },
  { id: "gears", icon: "⚙" },
  { id: "wheels", icon: "◉" },
  { id: "imported", icon: "↓" },
] as const;
type Language = "es" | "en";
const translations = {
  es: {
    subtitle: "LABORATORIO DE FÍSICA",
    light: "Claro",
    dark: "Oscuro",
    switchTheme: "Cambiar tema",
    project: "Proyecto",
    mechanism: "Mi mecanismo",
    import: "Importar",
    export: "Exportar",
    importTitle: "Importar modelo LDraw / Studio",
    importReading: "Analizando referencias del archivo…",
    importPalette: "Cargando piezas de la paleta local…",
    importExternal: "Consultando y cargando piezas externas…",
    importPreview: "Preparando previsualización…",
    importReady: "Modelo preparado para colocar",
    importParts: "piezas",
    importUnique: "referencias únicas",
    importFromPalette: "de la paleta",
    importExternalParts: "externas",
    discard: "Descartar",
    place: "Colocar",
    stop: "■ Detener",
    simulate: "▶ Simular",
    palette: "PALETA STUDIO",
    search: "Nombre o referencia…",
    external: "Añadir referencia externa",
    pieces: "piezas",
    noResults: "No hay piezas de la paleta que coincidan con la búsqueda.",
    dragHelp: "Catálogo predeterminado precargado localmente.",
    ready: "Catálogo local listo",
    running: "SIMULACIÓN: arrastra una pieza para aplicarle fuerza",
    cameraHelp:
      "Arrastrar: mover · Ctrl+arrastrar: Connect manual · Shift: mover Y · WASD/flechas: rotar 90° · Alt+clic: fijar · Alt/botón derecho: orbitar",
    properties: "PROPIEDADES",
    piece: "PIEZA",
    color: "COLOR",
    changingColor: "Cambiando color de la pieza…",
    colorChanged: "Color de la pieza actualizado",
    colorError: "No se pudo cargar ese color para la pieza",
    move: "DESPLAZAR",
    rotateAny: "ROTAR CUALQUIER ÁNGULO",
    pieceJoints: "UNIONES DE ESTA PIEZA",
    joint: "Unión",
    speed: "VELOCIDAD",
    torque: "FUERZA / PAR",
    noJoints: "Acerca la pieza a un conector compatible para crear una unión.",
    connectMap: "Mapa Connect",
    points: "puntos",
    closeMap: "Cerrar editor de mapa",
    editMap: "Editar mapa de conexiones",
    mapHelp:
      "Las coordenadas son locales a la pieza. Al editar se muestra el mapa y se eliminan las uniones antiguas de esta referencia.",
    addPoint: "+ Punto",
    duplicateConnector: "Duplicar conector",
    deleteConnector: "Eliminar conector",
    regenerateMap: "Regenerar automáticamente",
    exportJson: "Exportar JSON",
    importJson: "Importar JSON",
    collisionMapEditor: "Mapa de colisiones",
    editCollisionMap: "Editar mapa de colisiones",
    closeCollisionMap: "Cerrar editor de colisiones",
    collisionMapHelp:
      "Las formas usan coordenadas locales. Los cilindros están orientados sobre Y antes de aplicar su rotación.",
    normalCollision: "Colisión normal",
    gearCollision: "Colisión entre engranajes",
    gearCollisionHelp:
      "La capa especial solo choca con la capa especial de otros engranajes.",
    addBox: "+ Caja",
    addCylinder: "+ Cilindro",
    box: "Caja",
    cylinder: "Cilindro",
    size: "TAMAÑO X / Y / Z",
    rotation: "ROTACIÓN X / Y / Z (GRADOS)",
    radius: "RADIO",
    halfHeight: "SEMIALTURA",
    hole: "Hueco",
    shaft: "Saliente",
    round: "Redondo",
    axle: "Cruz / eje",
    halfRound: "Medio",
    position: "POSICIÓN X / Y / Z",
    axis: "EJE X / Y / Z",
    diameter: "DIÁMETRO",
    length: "LONGITUD",
    activeJoints: "Uniones activas",
    physicalTag: "Característica física",
    gearTag: "Engranaje",
    model: "Modelo",
    deletePiece: "Eliminar pieza",
    nothing: "Nada seleccionado",
    selectHelp: "Selecciona una pieza colocada para moverla o rotarla.",
    technical: "VISUALIZACIÓN TÉCNICA",
    collisionMeshes: "Mallas de colisión",
    connectionMap: "Mapa de conexiones",
    blue: "Azul: hueco de pin",
    orange: "Naranja: pin",
    green: "Verde: hueco de eje",
    purple: "Morado: recorrido de eje",
    cyan: "Cian: hueco medio",
    pink: "Rosa: saliente medio",
    bodies: "Cuerpos, uniones y pivotes",
    physicsLog: "REGISTRO DE FÍSICA",
    downloadLog: "Descargar último log JSON",
    stopForLog: "Detén una simulación para generar el log",
    readLog: "Leer último log",
    performanceLog: "DIAGNÓSTICO DE RENDIMIENTO",
    downloadPerformance: "Descargar perfil de fotogramas JSON",
    performanceHelp:
      "Reproduce el lag y descarga el registro: conserva los últimos 600 fotogramas.",
    physicsEngine: "MOTOR DE FÍSICA",
    physicsHelp:
      "Cada unión de pin o eje puede configurarse según sus grados de libertad compatibles.",
    structuralBehavior: "COMPORTAMIENTO ESTRUCTURAL",
    rigidStructure: "Rígido",
    flexibleStructure: "Flexible",
    structuralStiffness: "Rigidez de uniones",
    rigidStructureHelp:
      "Las conexiones fijas se fusionan. La rigidez controla las articulaciones móviles.",
    flexibleStructureHelp:
      "Cada pieza conserva su cuerpo y las conexiones fijas pueden flexionarse ligeramente.",
    grid: "Cuadrícula 0.4 u",
    cache: "caché local activa",
    ldrawCredit: "Usa The LDraw Parts Library",
    categories: {
      beams: "Vigas",
      axles: "Ejes",
      pins: "Pines",
      connectors: "Conectores",
      gears: "Engranajes",
      wheels: "Ruedas",
      imported: "Importadas",
    },
  },
  en: {
    subtitle: "PHYSICS BUILD LAB",
    light: "Light",
    dark: "Dark",
    switchTheme: "Switch theme",
    project: "Project",
    mechanism: "My mechanism",
    import: "Import",
    export: "Export",
    importTitle: "Import LDraw / Studio model",
    importReading: "Analyzing file references…",
    importPalette: "Loading local palette parts…",
    importExternal: "Looking up and loading external parts…",
    importPreview: "Preparing preview…",
    importReady: "Model ready to place",
    importParts: "parts",
    importUnique: "unique part numbers",
    importFromPalette: "from palette",
    importExternalParts: "external",
    discard: "Discard",
    place: "Place",
    stop: "■ Stop",
    simulate: "▶ Simulate",
    palette: "STUDIO PALETTE",
    search: "Name or part number…",
    external: "Add external part number",
    pieces: "parts",
    noResults: "No palette parts match the search.",
    dragHelp: "Default catalog preloaded locally.",
    ready: "Local catalog ready",
    running: "SIMULATION: drag a part to apply force",
    cameraHelp:
      "Drag: move · Ctrl+drag: manual Connect · Shift: move Y · WASD/arrows: rotate 90° · Alt+click: fix · Alt/right button: orbit",
    properties: "PROPERTIES",
    piece: "PART",
    color: "COLOR",
    changingColor: "Changing part color…",
    colorChanged: "Part color updated",
    colorError: "That color could not be loaded for this part",
    move: "MOVE",
    rotateAny: "ROTATE ANY ANGLE",
    pieceJoints: "JOINTS ON THIS PART",
    joint: "Joint",
    speed: "SPEED",
    torque: "FORCE / TORQUE",
    noJoints: "Move the part near a compatible connector to create a joint.",
    connectMap: "Connect map",
    points: "points",
    closeMap: "Close map editor",
    editMap: "Edit connection map",
    mapHelp:
      "Coordinates are local to the part. Editing displays the map and removes old joints for this part number.",
    addPoint: "+ Point",
    duplicateConnector: "Duplicate connector",
    deleteConnector: "Delete connector",
    regenerateMap: "Regenerate automatically",
    exportJson: "Export JSON",
    importJson: "Import JSON",
    collisionMapEditor: "Collision map",
    editCollisionMap: "Edit collision map",
    closeCollisionMap: "Close collision editor",
    collisionMapHelp:
      "Shapes use local coordinates. Cylinders are aligned to Y before their rotation is applied.",
    normalCollision: "Normal collision",
    gearCollision: "Gear-to-gear collision",
    gearCollisionHelp:
      "The special layer collides only with the special layer of other gears.",
    addBox: "+ Box",
    addCylinder: "+ Cylinder",
    box: "Box",
    cylinder: "Cylinder",
    size: "SIZE X / Y / Z",
    rotation: "ROTATION X / Y / Z (DEGREES)",
    radius: "RADIUS",
    halfHeight: "HALF HEIGHT",
    hole: "Socket",
    shaft: "Shaft",
    round: "Round",
    axle: "Cross / axle",
    halfRound: "Half",
    position: "POSITION X / Y / Z",
    axis: "AXIS X / Y / Z",
    diameter: "DIAMETER",
    length: "LENGTH",
    activeJoints: "Active joints",
    physicalTag: "Physics tag",
    gearTag: "Gear",
    model: "Model",
    deletePiece: "Delete part",
    nothing: "Nothing selected",
    selectHelp: "Select a placed part to move or rotate it.",
    technical: "TECHNICAL VIEW",
    collisionMeshes: "Collision meshes",
    connectionMap: "Connection map",
    blue: "Blue: pin socket",
    orange: "Orange: pin shaft",
    green: "Green: axle socket",
    purple: "Purple: axle travel",
    cyan: "Cyan: half socket",
    pink: "Pink: half shaft",
    bodies: "Bodies, joints and pivots",
    physicsLog: "PHYSICS LOG",
    downloadLog: "Download latest JSON log",
    stopForLog: "Stop a simulation to generate a log",
    readLog: "Read latest log",
    performanceLog: "PERFORMANCE DIAGNOSTICS",
    downloadPerformance: "Download frame profile JSON",
    performanceHelp:
      "Reproduce the lag, then download the log: it keeps the latest 600 frames.",
    physicsEngine: "PHYSICS ENGINE",
    physicsHelp:
      "Each pin or axle joint can be configured using its compatible degrees of freedom.",
    structuralBehavior: "STRUCTURAL BEHAVIOR",
    rigidStructure: "Rigid",
    flexibleStructure: "Flexible",
    structuralStiffness: "Joint stiffness",
    rigidStructureHelp:
      "Fixed connections are merged. Stiffness controls the moving joints.",
    flexibleStructureHelp:
      "Every part keeps its own body and fixed connections may flex slightly.",
    grid: "0.4 u grid",
    cache: "local cache active",
    ldrawCredit: "Uses The LDraw Parts Library",
    categories: {
      beams: "Beams",
      axles: "Axles",
      pins: "Pins",
      connectors: "Connectors",
      gears: "Gears",
      wheels: "Wheels",
      imported: "Imported",
    },
  },
} as const;

const kindFor = (category: string, name = ""): PieceKind =>
  category === "motors" || /motor/i.test(name)
    ? "motor"
    : category === "gears" ||
        category === "wheels" ||
        /gear|wheel|tyre|tire/i.test(name)
      ? "wheel"
      : "beam";
const modelText = (p: CatalogPart) =>
  `0 FILE ${p.part}.ldr\n1 ${p.color} 0 0 0 1 0 0 0 1 0 0 0 1 ${p.modelPart ?? p.part}.dat\n0`;
const frictionPinRefs = new Set(["2780", "6558", "32054", "43093"]);
const isPinPart = (p: CatalogPart) =>
  /^Technic (Axle )?Pin/i.test(p.name) || frictionPinRefs.has(p.part);
const isAxlePart = (p: CatalogPart) => /^Technic Axle(?! Pin)/i.test(p.name);
const isGearPart = (p: CatalogPart) =>
  p.gear === true || p.family === "gears" || /\bgear\b/i.test(p.name);
const gearPoseForPiece = (piece: Piece): GearPose<Piece> | undefined => {
  const spec = gearSpecFor(piece.modelPart ?? piece.part, piece.name);
  if (!piece.gear || !spec) return undefined;
  piece.mesh.updateMatrixWorld(true);
  // Some corrected maps contain decorative/off-centre axle holes before the
  // driving hole (32498 is one example). A gear's LDraw origin is its rotation
  // centre, so use that origin and only take the nearest axle socket for axis.
  const axleSocket = piece.connectors
      .filter(
        (connector) =>
          connector.role === "socket" && connector.kind === "axle",
      )
      .sort((a, b) => a.local.lengthSq() - b.local.lengthSq())[0],
    fallbackCylinder = [...piece.gearColliders, ...piece.colliders]
      .filter((primitive) => primitive.shape === "cylinder")
      .sort((a, b) => (b.radius ?? 0) - (a.radius ?? 0))[0],
    center = piece.mesh.localToWorld(new THREE.Vector3()),
    axis = axleSocket
      ? axleSocket.axis.clone().transformDirection(piece.mesh.matrixWorld)
      : new THREE.Vector3(0, 1, 0)
          .applyQuaternion(
            fallbackCylinder?.rotation ?? new THREE.Quaternion(),
          )
          .transformDirection(piece.mesh.matrixWorld);
  return {
    value: piece,
    spec,
    center: center.toArray(),
    axis: axis.normalize().toArray(),
  };
};
const detectGearLinks = (
  pieces: Piece[],
  rigidIslandByPiece?: Map<Piece, Piece[]>,
): RuntimeGearLink[] => {
  const poses = pieces.flatMap((piece) => {
      const pose = gearPoseForPiece(piece);
      return pose ? [pose] : [];
    }),
    pairs = findParallelGearPairs(poses);
  return pairs.flatMap((pair) => {
    if (
      rigidIslandByPiece &&
      rigidIslandByPiece.get(pair.a.value) ===
        rigidIslandByPiece.get(pair.b.value)
    )
      return [];
    if (
      pair.a.value.body &&
      pair.a.value.body === pair.b.value.body
    )
      return [];
    const axisA = new THREE.Vector3(...pair.a.axis).normalize(),
      axisB = new THREE.Vector3(...pair.b.axis).normalize();
    if (axisA.dot(axisB) < 0) axisB.negate();
    return [{ ...pair, axisA, axisB }];
  });
};
const isHalfBeamPart = (p: CatalogPart) =>
  /^Technic (Beam|Panel)/i.test(p.name) &&
  /(?:\bx\s*0\.5\b|\b0\.5\b|\bhalf\b)/i.test(p.name);
const COLLISION_GROUP_NON_GEAR = 0x0001,
  COLLISION_GROUP_GEAR_NORMAL = 0x0002,
  COLLISION_GROUP_GEAR_MESH = 0x0004,
  interactionGroups = (membership: number, filter: number) =>
    (membership << 16) | filter;
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
const connectorAxialOffsets = (
  shaft: MeshConnector,
  socket: MeshConnector,
) =>
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
      axis: connector.axis
        .clone()
        .transformDirection(piece.mesh.matrixWorld)
        .normalize(),
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
        steps = Math.max(
          1,
          Math.ceil((searchHalfLength * 2) / (cellSize * 0.5)),
        ),
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
          radial = delta
            .clone()
            .addScaledVector(shaftPose.axis, -along)
            .length(),
          radialTolerance = Math.max(
            0.18,
            Math.min(shaft.diameter, candidate.connector.diameter) * 0.22,
          );
        if (
          radial > radialTolerance ||
          Math.abs(along) > searchHalfLength
        )
          return;
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
    else if (connection.profile === "axle-round")
      connection.mode = "rotation-linear";
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
  new Set(state.connections.map((connection) => connection.b)).forEach(
    (piece) => rebalanceSmartDefaults(state, piece),
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

function DeferredNumberInput({
  value,
  min,
  step = 0.01,
  onCommit,
}: {
  value: number;
  min?: number;
  step?: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(+value.toFixed(4)));
  useEffect(() => setDraft(String(+value.toFixed(4))), [value]);
  const commit = () => {
    const parsed = Number(draft.replace(",", "."));
    if (Number.isFinite(parsed) && (min === undefined || parsed >= min))
      onCommit(parsed);
    else setDraft(String(+value.toFixed(4)));
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      data-step={step}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(String(+value.toFixed(4)));
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export default function Home() {
  const studioRef = useRef<HTMLElement>(null),
    mountRef = useRef<HTMLDivElement>(null),
    fpsRef = useRef<HTMLDivElement>(null),
    fileRef = useRef<HTMLInputElement>(null),
    connectorFileRef = useRef<HTMLInputElement>(null),
    colliderFileRef = useRef<HTMLInputElement>(null),
    importTokenRef = useRef(0),
    appRef = useRef<AppState | null>(null);
  const [running, setRunning] = useState(false),
    [count, setCount] = useState(0),
    [selectedId, setSelectedId] = useState<number | null>(null);
  const [category, setCategory] = useState("beams"),
    [search, setSearch] = useState(""),
    [reference, setReference] = useState("");
  const [results, setResults] = useState<CatalogPart[]>([]),
    [imported, setImported] = useState<CatalogPart[]>([]);
  const [catalogBusy, setCatalogBusy] = useState(false),
    [message, setMessage] = useState("catalog-ready");
  const [debugViews, setDebugViews] = useState<DebugFlags>({
      colliders: false,
      connectors: false,
      physics: false,
    }),
    [lastLog, setLastLog] = useState("");
  const [, setConnectionRevision] = useState(0);
  const [rotationAngle, setRotationAngle] = useState(15),
    [, setConnectorRevision] = useState(0),
    [, setColliderRevision] = useState(0),
    [connectionMapOpen, setConnectionMapOpen] = useState(false),
    [collisionMapOpen, setCollisionMapOpen] = useState(false),
    [collisionLayer, setCollisionLayer] = useState<"normal" | "gear">(
      "normal",
    ),
    [importDraft, setImportDraft] = useState<ImportDraft | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark"),
    [language, setLanguage] = useState<Language>("es"),
    [inspectorWidth, setInspectorWidth] = useState(270),
    [structuralMode, setStructuralMode] = useState<StructuralMode>("rigid"),
    [structuralStiffness, setStructuralStiffness] = useState(85);
  const t = translations[language],
    modeLabels: Record<JointMode, string> =
      language === "es"
        ? modeLabel
        : {
            fixed: "Fixed",
            rotation: "Free rotation",
            linear: "Free linear travel",
            "rotation-linear": "Free rotation and linear travel",
            motor: "Motor",
          },
    profileLabels: Record<ConnectionProfile, string> =
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
      setTheme(
        localStorage.getItem("sim-studio:theme") === "light" ? "light" : "dark",
      );
      setLanguage(
        localStorage.getItem("sim-studio:language") === "en" ? "en" : "es",
      );
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
      localStorage.setItem("sim-studio:structural-mode", structuralMode);
      localStorage.setItem(
        "sim-studio:structural-stiffness",
        String(structuralStiffness),
      );
    } catch {}
  }, [structuralMode, structuralStiffness]);

  useEffect(() => {
    const source =
        category === "imported"
          ? imported
          : paletteParts.filter((p) => p.family === category),
      query = search.trim().toLowerCase();
    setCatalogBusy(false);
    setResults(
      query
        ? source.filter((p) =>
            (p.part + " " + p.name).toLowerCase().includes(query),
          )
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
    );
    camera.position.set(13, 12, 17);
    camera.lookAt(0, 1.5, 0);
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
    const gl = renderer.getContext(),
      gpuTimerExtension = gl.getExtension(
        "EXT_disjoint_timer_query_webgl2",
      ) as {
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
    const grid = new THREE.GridHelper(
      40,
      40,
      darkTheme ? 0x697078 : 0x8297a5,
      darkTheme ? 0x3d4248 : 0xb3c1ca,
    );
    scene.add(grid);
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(40, 0.3, 40),
      new THREE.MeshStandardMaterial({
        color: darkTheme ? 0x2b3035 : 0xcbd6dd,
        roughness: 0.86,
      }),
    );
    floor.position.y = -0.2;
    floor.receiveShadow = true;
    floor.userData.floor = true;
    scene.add(floor);
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
      primary = makeLoader(LDRAW),
      legacy = makeLoader(LEGACY_LDRAW);
    const preloaded = new Set<string>(),
      preloading = new Map<string, Promise<void>>(),
      modelCache = new Map<string, THREE.Object3D>(),
      sourceModelCache = new Map<string, THREE.Object3D>(),
      connectorCache = new Map<string, MeshConnector[]>(),
      collisionCache = new Map<string, CollisionPrimitive[]>(),
      gearCollisionCache = new Map<string, CollisionPrimitive[]>();
    const assetUrl = (path: string) => new URL(path, document.baseURI).href;
    const loadPartModel = async (p: CatalogPart) => {
      const key = `${p.part}:${p.color}`,
        cached = modelCache.get(key);
      if (cached) return cached.clone(true);
      const sourceColor = p.sourceColor ?? p.color,
        sourceKey = p.geometry
          ? `asset:${p.geometry}`
          : `ldraw:${p.modelPart ?? p.part}`;
      let exact = sourceModelCache.get(sourceKey)?.clone(true);
      if (!exact) {
        if (p.geometry)
          try {
            exact = await new THREE.ObjectLoader().loadAsync(assetUrl(p.geometry));
          } catch {}
        if (!exact) {
          const source = `data:text/plain;charset=utf-8,${encodeURIComponent(
            modelText({ ...p, color: sourceColor }),
          )}`;
          try {
            await primary.materials;
            exact = await withTimeout(
              primary.instance.loadAsync(source),
              MODEL_LOAD_TIMEOUT,
              `La pieza ${p.part}`,
            );
          } catch (primaryError) {
            try {
              await legacy.materials;
              exact = await withTimeout(
                legacy.instance.loadAsync(source),
                MODEL_LOAD_TIMEOUT,
                `La pieza ${p.part}`,
              );
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
            if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Line))
              return;
            const replace = (material: THREE.Material) => {
              if (String(material.userData.code) !== String(sourceColor))
                return material;
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
                ? conditionalReplacement ?? edgeReplacement ?? material
                : edgeReplacement ?? material;
            };
            child.material = Array.isArray(child.material)
              ? child.material.map(replace)
              : replace(child.material);
          });
        }
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
      let connectors: MeshConnector[] | undefined,
        hasSavedConnectorMap = false;
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
          connectorCache.get(p.part) &&
          cloneConnectors(connectorCache.get(p.part)!);
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
                !shafts.some(
                  (shaft) => shaft.local.distanceTo(socket.local) < 0.12,
                ),
            ),
          ];
        } else if (isAxlePart(p)) {
          const shafts = rodConnectors(wrapper, "axle"),
            sockets = detectConnectorHoles(wrapper);
          connectors = [
            ...shafts,
            ...sockets.filter(
              (socket) =>
                !shafts.some(
                  (shaft) => shaft.local.distanceTo(socket.local) < 0.12,
                ),
            ),
          ];
        }
      }
      if (!connectors) {
        connectors = detectConnectorHoles(wrapper);
        if (!connectors.length)
          connectors = fallbackBeamConnectors(wrapper, p.name);
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
      let colliders: CollisionPrimitive[] | undefined;
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
                  (primitive.shape === "box" ||
                    primitive.shape === "cylinder") &&
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
          const saved = localStorage.getItem(
            `sim-gear-colliders-v1:${p.part}`,
          );
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
          gearColliders = preloadedGearCollisionMaps[p.part].map(
            (primitive) => ({
              ...primitive,
              center: new THREE.Vector3().fromArray(primitive.center),
              size: primitive.size
                ? new THREE.Vector3().fromArray(primitive.size)
                : undefined,
              rotation: new THREE.Quaternion().fromArray(primitive.rotation),
            }),
          );
        if (!gearColliders.length)
          gearColliders =
            gearCollisionCache.get(p.part)?.map((primitive) => ({
              ...primitive,
              center: primitive.center.clone(),
              size: primitive.size?.clone(),
              rotation: primitive.rotation.clone(),
            })) ?? [];
        if (!gearColliders.length && packagedParts[p.part]?.gearColliders)
          gearColliders = packagedParts[p.part].gearColliders!.map(
            (primitive) => ({
              ...primitive,
              center: new THREE.Vector3().fromArray(primitive.center),
              size: primitive.size
                ? new THREE.Vector3().fromArray(primitive.size)
                : undefined,
              rotation: new THREE.Quaternion().fromArray(primitive.rotation),
            }),
          );
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
      const preloadKey = `${p.part}:${p.color}`;
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
        Array.from(
          { length: Math.min(4, uniqueCatalogs.length) },
          async () => {
            while (previewCursor < uniqueCatalogs.length) {
              const [key, catalog] = uniqueCatalogs[previewCursor++];
              try {
                previewModels.set(key, await loadPartModel(catalog));
              } catch {
                // A missing part must not keep the entire preview open forever.
              }
            }
          },
        ),
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
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
      }
      if (!root.children.length)
        throw new Error("No se pudo cargar ninguna geometría para la vista previa");
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root),
        center = box.getCenter(new THREE.Vector3()),
        size = box.getSize(new THREE.Vector3()),
        radius = Math.max(size.x, size.y, size.z, 1),
        previewCamera = new THREE.PerspectiveCamera(32, 16 / 9, 0.01, radius * 20);
      previewCamera.position.copy(center).add(
        new THREE.Vector3(radius * 1.35, radius * 1.05, radius * 1.55),
      );
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
          (data.debugKind === "collider" ||
            data.debugKind === "connector-volume") &&
          piece
        ) {
          piece.mesh.updateMatrixWorld(true);
          object.position.copy(
            piece.mesh.localToWorld((data.local as THREE.Vector3).clone()),
          );
          const worldRotation = piece.mesh.getWorldQuaternion(
            new THREE.Quaternion(),
          );
          object.quaternion.copy(
            worldRotation.multiply(
              (data.localRotation as THREE.Quaternion).clone(),
            ),
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
          object.position.copy(
            piece.mesh.getWorldPosition(new THREE.Vector3()),
          );
          object.quaternion.copy(
            piece.mesh.getWorldQuaternion(new THREE.Quaternion()),
          );
        } else if (data.debugKind === "joint-point") {
          const connection = data.connection as Connection;
          object.position.copy(
            connection.a.mesh.localToWorld(
              (data.local as THREE.Vector3).clone(),
            ),
          );
        } else if (data.debugKind === "joint-axis") {
          const connection = data.connection as Connection;
          object.position.copy(
            connection.a.mesh.localToWorld(
              (data.local as THREE.Vector3).clone(),
            ),
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
        }
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
                color: gearLayer
                  ? 0xff4fa3
                  : piece.fixed
                    ? 0xffc928
                    : 0x3dff78,
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
              selectedNode =
                manual?.piece === piece && manual.connector === connector;
            if (
              manual &&
              ((piece === manual.piece && !selectedNode) ||
                (piece !== manual.piece &&
                  !pairProfile(manual.connector, connector)))
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
                    : new THREE.SphereGeometry(
                      selectedNode ? 0.16 : 0.085,
                      10,
                      8,
                    ),
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
        if (state.debug.physics) {
          const axes = new THREE.AxesHelper(0.65);
          axes.userData = { debugKind: "body-axes", piece };
          axes.renderOrder = 42;
          debugRoot.add(axes);
        }
      }
      if (state.debug.physics)
        for (const connection of state.connections) {
          connection.a.mesh.updateMatrixWorld(true);
          const local = connection.a.mesh.worldToLocal(
              connection.point.clone(),
            ),
            nearest = connection.a.connectors
              .slice()
              .sort(
                (a, b) => a.local.distanceTo(local) - b.local.distanceTo(local),
              )[0],
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
      updateDebug();
    };
    const disposeRenderBatches = () => {
      state.renderBatchItems?.forEach(({ mesh }) => {
        if (mesh.userData.ownedBatchMaterial)
          (mesh.material as THREE.Material).dispose();
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
          if (
            object.userData.ownedBatchGeometry &&
            object instanceof THREE.Line
          )
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
            (!piece.body || piece.physicsIslandFixed || piece.body.isSleeping())
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
      const materialFingerprint = (material: THREE.Material) => {
        const lineMaterial = material as THREE.Material & {
          color?: THREE.Color;
          emissive?: THREE.Color;
          roughness?: number;
          metalness?: number;
          flatShading?: boolean;
          linewidth?: number;
          dashed?: boolean;
          fog?: boolean;
          map?: THREE.Texture | null;
          normalMap?: THREE.Texture | null;
          roughnessMap?: THREE.Texture | null;
          metalnessMap?: THREE.Texture | null;
          uniforms?: Record<string, { value?: unknown }>;
        };
        return JSON.stringify({
          type: (lineMaterial as THREE.Material & {
            isLDrawConditionalLineMaterial?: boolean;
          }).isLDrawConditionalLineMaterial
            ? "LDrawConditionalLineMaterial"
            : material.type,
          color: lineMaterial.color?.getHexString() ?? null,
          emissive: lineMaterial.emissive?.getHexString() ?? null,
          roughness: lineMaterial.roughness ?? null,
          metalness: lineMaterial.metalness ?? null,
          flatShading: lineMaterial.flatShading ?? null,
          map: lineMaterial.map?.uuid ?? null,
          normalMap: lineMaterial.normalMap?.uuid ?? null,
          roughnessMap: lineMaterial.roughnessMap?.uuid ?? null,
          metalnessMap: lineMaterial.metalnessMap?.uuid ?? null,
          opacity: material.opacity,
          transparent: material.transparent,
          depthTest: material.depthTest,
          depthWrite: material.depthWrite,
          blending: material.blending,
          vertexColors: material.vertexColors,
          linewidth: lineMaterial.linewidth ?? null,
          dashed: lineMaterial.dashed ?? null,
          fog: lineMaterial.fog ?? null,
          alphaTest: material.alphaTest,
          side: material.side,
        });
      };
      const cloneGeometryRange = (
        source: THREE.BufferGeometry,
        start: number,
        count: number,
      ) => {
        const nonIndexed = source.index ? source.toNonIndexed() : source,
          result = new THREE.BufferGeometry();
        Object.entries(nonIndexed.attributes).forEach(([name, attribute]) => {
          if (attribute.isInterleavedBufferAttribute) return;
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
        const key = `${piece.geometry ?? piece.modelPart ?? piece.part}:${piece.color}`,
          group = groups.get(key) ?? [];
        group.push(piece);
        groups.set(key, group);
      });
      groups.forEach((pieces) => {
        const template = pieces[0];
        template.mesh.updateMatrixWorld(true);
        const templateMeshes: THREE.Mesh[] = [],
          meshGroups = new Map<
            string,
            { material: THREE.Material; geometries: THREE.BufferGeometry[] }
          >();
        template.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) templateMeshes.push(child);
        });
        if (!templateMeshes.length) return;
        const inverseWrapper = template.mesh.matrixWorld.clone().invert();
        templateMeshes.forEach((child) => {
          const materials = Array.isArray(child.material)
              ? child.material
              : [child.material],
            ranges = Array.isArray(child.material) && child.geometry.groups.length
              ? child.geometry.groups.map((group) => ({
                  start: group.start,
                  count: group.count,
                  material: materials[group.materialIndex ?? 0],
                }))
              : [{
                  start: 0,
                  count: child.geometry.index
                    ? child.geometry.index.count
                    : child.geometry.getAttribute("position").count,
                  material: materials[0],
                }],
            localTransform = inverseWrapper.clone().multiply(child.matrixWorld);
          ranges.forEach(({ start, count, material }) => {
            if (!material || count <= 0) return;
            const geometry = cloneGeometryRange(child.geometry, start, count);
            geometry.applyMatrix4(localTransform);
            const attributes = Object.entries(geometry.attributes)
                .map(
                  ([name, attribute]) =>
                    `${name}:${attribute.itemSize}:${attribute.normalized}:${attribute.array.constructor.name}`,
                )
                .sort()
                .join("|"),
              key = `${materialFingerprint(material)}:${attributes}`,
              group = meshGroups.get(key) ?? { material, geometries: [] };
            group.geometries.push(geometry);
            meshGroups.set(key, group);
          });
        });
        meshGroups.forEach(({ material, geometries }) => {
          const merged =
              geometries.length > 1
                ? mergeGeometries(geometries, false)
                : undefined,
            batches = merged ? [merged] : geometries;
          if (merged) geometries.forEach((geometry) => geometry.dispose());
          batches.forEach((geometry) => {
            const instance = new THREE.InstancedMesh(
                geometry,
                material,
                pieces.length,
              );
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
              localMatrix: new THREE.Matrix4(),
            });
          });
        });
        if (!meshGroups.size) return;
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
        prepareModel(exact);
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
    const addPart = async (
      p: CatalogPart,
      position: THREE.Vector3,
      rotation?: THREE.Quaternion,
    ) => {
      if (!state.bulkLoading) setMessage(`Cargando ${p.part}…`);
      try {
        const exact = await loadPartModel(p);
        preloaded.add(`${p.part}:${p.color}`);
        prepareModel(exact);
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
            fixed: false,
            pin: isPinPart(p),
            frictionPin: hasPinFriction(p),
            dynamicAxleConnections: isAxlePart(p),
        };
        wrapper.userData.piece = piece;
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
      floor,
      grid,
      pieces: [],
      connections: [],
      gearLinks: [],
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
    const socketSurfaceHalfThickness = (
      host: Piece,
      socket: MeshConnector,
    ) => {
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
      state.connections.push({
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
      });
      if (!state.bulkConnecting) rebalanceSmartDefaults(state, rod);
      return true;
    };
    const connectManual = (
      sourcePiece: Piece,
      sourceConnector: MeshConnector,
      targetPiece: Piece,
      targetConnector: MeshConnector,
    ) => {
      const profile = pairProfile(sourceConnector, targetConnector);
      if (!profile) return false;
      const sourceWorld = worldConnector(sourcePiece, sourceConnector),
        targetWorld = worldConnector(targetPiece, targetConnector);
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
        shaft =
          sourceConnector.role === "shaft" ? sourceConnector : targetConnector,
        alignedSourceWorld = worldConnector(sourcePiece, sourceConnector),
        shaftWorld =
          sourceConnector.role === "shaft" ? alignedSourceWorld : targetWorld,
        socketWorld =
          sourceConnector.role === "socket" ? alignedSourceWorld : targetWorld,
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
        sourceTarget.sub(worldConnector(sourcePiece, sourceConnector).point),
      );
      sourcePiece.mesh.updateMatrixWorld(true);
      state.renderBatchesDirty = true;
      state.connections = state.connections.filter(
        (connection) =>
          connection.a !== sourcePiece && connection.b !== sourcePiece,
      );
      rebalanceAllSmartDefaults(state);
      const socketPiece =
          sourceConnector.role === "socket" ? sourcePiece : targetPiece,
        socketConnector =
          sourceConnector.role === "socket" ? sourceConnector : targetConnector,
        shaftPiece =
          sourceConnector.role === "shaft" ? sourcePiece : targetPiece,
        shaftConnector =
          sourceConnector.role === "shaft" ? sourceConnector : targetConnector;
      return addConnection(
        socketPiece,
        shaftPiece,
        socketConnector,
        shaftConnector,
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
            if (connector.kind !== "axle")
              occupiedCells.add(connectionCell(point));
            else {
              const half =
                  (connector.length ?? 0.5) / 2 + 0.12 + axleEndCapture,
                steps = Math.max(
                  1,
                  Math.ceil((half * 2) / (connectionCellSize * 0.5)),
                );
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
        let best:
          | { candidate: IndexedShaft; score: number }
          | undefined;
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
                ...connectorAxialOffsets(shaft, candidateSocket.socket).map(
                  (offset) => Math.abs(along - offset),
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
      state.connections = [];
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
      state.connections = [];
      state.bulkConnecting = true;
      const { sockets, shaftGrid } = buildConnectionIndex();
      state.pendingConnectionMs += performance.now() - operationStarted;
      let sliceStarted = performance.now();
      for (let index = 0; index < sockets.length; index++) {
        if (scanVersion !== state.connectionScanVersion)
          return state.connections.length;
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
    const updateDynamicMechanisms = () => {
      const dynamicScanStarted = performance.now();
      const previousGearLinks = state.gearLinks.length;
      state.gearLinks = detectGearLinks(state.pieces);
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
          (connection.profile === "axle-cross" ||
            connection.profile === "axle-round") &&
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
          radial = delta
            .clone()
            .addScaledVector(shaftWorld.axis, -along)
            .length(),
          halfShaft = (connection.shaft.length ?? 0.5) / 2,
          entranceAllowance =
            connection.socket.kind === "axle"
              ? 0.12
              : socketSurfaceHalfThickness(
                  connection.a,
                  connection.socket,
                ) + 0.08,
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
        if (!stillConnected)
          state.dynamicNoContactPairs.delete(contactPairKey(a, b));
      });

      const existingIds = new Set(
        state.connections.map((connection) => connection.id),
      );
      state.bulkConnecting = true;
      for (const pair of state.contactCandidates.values())
        for (const [rod, host] of [
          [pair.a, pair.b],
          [pair.b, pair.a],
        ] as [Piece, Piece][]) {
          if (!rod.dynamicAxleConnections) continue;
          for (const shaft of rod.connectors.filter(
            (connector) =>
              connector.role === "shaft" && connector.kind === "axle",
          )) {
            const shaftWorld = worldConnector(rod, shaft),
              halfShaft = (shaft.length ?? 0.5) / 2;
            for (const socket of host.connectors.filter(
              (connector) => connector.role === "socket",
            )) {
              if (!connectorProfile(shaft, socket)) continue;
              const socketWorld = worldConnector(host, socket),
                alignment = Math.abs(
                  socketWorld.axis.dot(shaftWorld.axis),
                );
              if (alignment < 0.94) continue;
              const delta = socketWorld.point.clone().sub(shaftWorld.point),
                along = delta.dot(shaftWorld.axis),
                radial = delta
                  .clone()
                  .addScaledVector(shaftWorld.axis, -along)
                  .length(),
                surface = socketSurfaceHalfThickness(host, socket);
              if (
                radial > 0.16 ||
                Math.abs(along) > halfShaft + surface + 0.12
              )
                continue;
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
          (connection.profile === "axle-cross" ||
            connection.profile === "axle-round") &&
          connection.b.dynamicAxleConnections;
        if (!dynamicAxle) continue;
        accepted.push(connection);
        state.dynamicNoContactPairs.add(
          contactPairKey(connection.a, connection.b),
        );
        const hostBody = connection.a.body,
          axleBody = connection.b.body;
        if (hostBody && axleBody && hostBody !== axleBody) {
          const axis = worldConnector(
              connection.a,
              connection.socket,
            ).axis,
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
          axleBody.resetForces(true);
          axleBody.resetTorques(true);
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
                  radial = delta
                    .clone()
                    .addScaledVector(axis, -along)
                    .length(),
                  axialError = Math.min(
                    ...connectorAxialOffsets(shaft, socket).map((offset) =>
                      Math.abs(along - offset),
                    ),
                  );
                score = radial + axialError;
              } else {
                const delta = socketWorld.point
                    .clone()
                    .sub(shaftWorld.point),
                  along = delta.dot(axis),
                  radial = delta.clone().addScaledVector(axis, -along).length();
                score =
                  radial +
                  Math.max(0, Math.abs(along) - (shaft.length ?? 0.5) / 2);
              }
              if (score < 0.75 && (!best || score < best.score))
                best = { host, socket, shaft, score };
            }
        if (best) {
          let targetAxis = worldConnector(best.host, best.socket).axis,
            currentAxis = worldConnector(piece, best.shaft).axis;
          if (currentAxis.dot(targetAxis) < 0)
            targetAxis = targetAxis.clone().negate();
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
              targetShaftPoint = socketPoint
                .clone()
                .addScaledVector(targetAxis, offset);
            piece.mesh.position.add(
              targetShaftPoint.sub(shaftPoint),
            );
          } else {
            const shaftPoint = worldConnector(piece, best.shaft).point,
              along = shaftPoint.clone().sub(socketPoint).dot(targetAxis),
              targetShaftPoint = socketPoint
                .clone()
                .addScaledVector(targetAxis, along),
              rotated = best.shaft.local.clone().applyQuaternion(
                piece.mesh.quaternion,
              );
            piece.mesh.position.copy(targetShaftPoint).sub(rotated);
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
                radial = delta
                  .clone()
                  .addScaledVector(axis, -along)
                  .length(),
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
              score =
                radial +
                Math.max(0, Math.abs(along) - (shaft.length ?? 0.5) / 2);
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
      if (currentAxis.dot(targetAxis) < 0)
        targetAxis = targetAxis.clone().negate();
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
          targetSocketPoint = shaftPoint
            .clone()
            .addScaledVector(targetAxis, -offset);
        piece.mesh.position.add(
          targetSocketPoint.sub(socketPoint),
        );
      } else {
        const delta = worldConnector(best.rod, best.shaft).point.sub(socketPoint),
          perpendicular = delta
            .clone()
            .addScaledVector(targetAxis, -delta.dot(targetAxis));
        piece.mesh.position.add(perpendicular);
      }
      piece.mesh.updateMatrixWorld(true);
    };

    const ray = new THREE.Raycaster(),
      pointer = new THREE.Vector2();
    let orbit = false,
      moved = false,
      shiftHeld = false,
      moving: Piece | undefined,
      altCandidate: Piece | undefined,
      previous = { x: 0, y: 0 },
      orbitStart = { x: 0, y: 0 },
      moveOffset = new THREE.Vector2(),
      movingStartPosition = new THREE.Vector3(),
      movingStartPointer = new THREE.Vector2(),
      movingLinearAxis: THREE.Vector3 | undefined;
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
      return piece.connectors
        .map((connector) => {
          const projected = worldConnector(piece, connector)
              .point.clone()
              .project(camera),
            x = bounds.left + ((projected.x + 1) * bounds.width) / 2,
            y = bounds.top + ((1 - projected.y) * bounds.height) / 2;
          return {
            connector,
            distance: Math.hypot(x - e.clientX, y - e.clientY),
          };
        })
        .sort((a, b) => a.distance - b.distance)[0]?.connector;
    };
    const pieceFrom = (object: THREE.Object3D, instanceId?: number) => {
      const instancePieces = object.userData.instancePieces as Piece[] | undefined;
      if (instancePieces && instanceId !== undefined)
        return instancePieces[instanceId];
      let o: THREE.Object3D | null = object;
      while (o) {
        if (o.userData.piece) return o.userData.piece as Piece;
        o = o.parent;
      }
      return undefined;
    };
    const pickPiece = () => {
      let best:
        | { piece: Piece; point: THREE.Vector3; distance: number }
        | undefined;
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
          if (!best || distance < best.distance)
            best = { piece, point, distance };
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
        dx = target.x - anchor.x,
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
    const clampMotion = (
      piece: Piece,
      linearLimit: number,
      angularLimit: number,
    ) => {
      if (!piece.body || piece.physicsIslandFixed) return;
      const v = piece.body.linvel(),
        w = piece.body.angvel(),
        linear = Math.hypot(v.x, v.y, v.z),
        angular = Math.hypot(w.x, w.y, w.z);
      if (linear > linearLimit) {
        const scale = linearLimit / linear;
        piece.body.setLinvel(
          { x: v.x * scale, y: v.y * scale, z: v.z * scale },
          true,
        );
      }
      if (angular > angularLimit) {
        const scale = angularLimit / angular;
        piece.body.setAngvel(
          { x: w.x * scale, y: w.y * scale, z: w.z * scale },
          true,
        );
      }
    };
    const enforceGearLinks = () => {
      // A short sequential projection is substantially more stable than tooth
      // contact alone and preserves the exact external-gear speed ratio.
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
                new THREE.Quaternion(
                  rotationA.x,
                  rotationA.y,
                  rotationA.z,
                  rotationA.w,
                ),
              ),
            axisB = link.axisB
              .clone()
              .applyQuaternion(
                new THREE.Quaternion(
                  rotationB.x,
                  rotationB.y,
                  rotationB.z,
                  rotationB.w,
                ),
              ),
            angularA = bodyA.angvel(),
            angularB = bodyB.angvel(),
            velocityA =
              angularA.x * axisA.x +
              angularA.y * axisA.y +
              angularA.z * axisA.z,
            velocityB =
              angularB.x * axisB.x +
              angularB.y * axisB.y +
              angularB.z * axisB.z,
            teethA = link.a.spec.teeth,
            teethB = link.b.spec.teeth,
            error = teethA * velocityA + teethB * velocityB;
          if (Math.abs(error) < 1e-5) return;
          const fixedA = !!pieceA.physicsIslandFixed,
            fixedB = !!pieceB.physicsIslandFixed;
          if (fixedA && fixedB) return;
          let deltaA = 0,
            deltaB = 0;
          if (fixedA) deltaB = -error / teethB;
          else if (fixedB) deltaA = -error / teethA;
          else {
            const denominator = teethA * teethA + teethB * teethB;
            deltaA = (-error * teethA) / denominator;
            deltaB = (-error * teethB) / denominator;
          }
          const strength = 1;
          if (!fixedA)
            bodyA.setAngvel(
              {
                x: angularA.x + axisA.x * deltaA * strength,
                y: angularA.y + axisA.y * deltaA * strength,
                z: angularA.z + axisA.z * deltaA * strength,
              },
              true,
            );
          if (!fixedB)
            bodyB.setAngvel(
              {
                x: angularB.x + axisB.x * deltaB * strength,
                y: angularB.y + axisB.y * deltaB * strength,
                z: angularB.z + axisB.z * deltaB * strength,
              },
              true,
            );
      };
      // Symmetric Gauss-Seidel sweeps make a train transmit equally well from
      // either end instead of favouring the pair that happens to be stored first.
      for (let iteration = 0; iteration < 4; iteration++) {
        state.gearLinks.forEach(solveLink);
        for (let index = state.gearLinks.length - 1; index >= 0; index--)
          solveLink(state.gearLinks[index]);
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
        piece.fixed
          ? `${piece.part} fijada al espacio`
          : `${piece.part} liberada`,
      );
    };
    const down = (e: PointerEvent) => {
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(e.pointerId);
      previous = orbitStart = { x: e.clientX, y: e.clientY };
      moved = false;
      cast(e);
      if (!state.running && state.pendingPlacement && e.button === 0) {
        const placed = state.pendingPlacement.pieces.length;
        state.pendingPlacement = undefined;
        const connections = verifyConnections();
        setMessage(
          `${placed} piezas colocadas · ${connections} conexiones detectadas`,
        );
        return;
      }
      const hit = pickPiece(),
        hitPiece = hit?.piece;
      orbit = e.button === 2 || e.altKey;
      altCandidate = e.altKey && e.button === 0 ? hitPiece : undefined;
      if (orbit) return;
      if (!state.running && e.ctrlKey && e.button === 0 && hitPiece) {
        const connector = nearestScreenConnector(hitPiece, e);
        if (!connector) {
          setMessage(`${hitPiece.part} no tiene puntos de conexión`);
          return;
        }
        const origin = worldConnector(hitPiece, connector).point,
          line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([origin, origin]),
            new THREE.LineBasicMaterial({
              color: 0xffee38,
              depthTest: false,
              transparent: true,
              opacity: 0.95,
            }),
          );
        line.renderOrder = 60;
        scene.add(line);
        state.manualConnect = {
          piece: hitPiece,
          connector,
          cursor: origin.clone(),
          plane: new THREE.Plane().setFromNormalAndCoplanarPoint(
            camera.getWorldDirection(new THREE.Vector3()),
            origin,
          ),
          line,
        };
        state.selected = hitPiece;
        state.debug.connectors = true;
        setSelectedId(hitPiece.id);
        setDebugViews((current) => ({ ...current, connectors: true }));
        setMessage(
          `Connect manual: ${hitPiece.part} · suelta cerca de un punto compatible`,
        );
        refreshDebug();
        return;
      }
      if (state.running) {
        if (
          hit &&
          hitPiece &&
          !hitPiece.physicsIslandFixed &&
          hitPiece.body
        ) {
          state.selected = hitPiece;
          setSelectedId(hitPiece.id);
          const overlay = document.createElementNS(
              "http://www.w3.org/2000/svg",
              "svg",
            ),
            line = document.createElementNS(
              "http://www.w3.org/2000/svg",
              "polyline",
            ),
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
        state.connections = state.connections.filter(
          (c) => c.a !== moving && c.b !== moving,
        );
        rebalanceAllSmartDefaults(state);
        setConnectionRevision((value) => value + 1);
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
      if (!state.running && state.pendingPlacement) {
        cast(e);
        const ground = ray.intersectObject(floor)[0];
        if (ground) {
          const target = new THREE.Vector3(
            Math.round(ground.point.x / 0.4) * 0.4,
            0,
            Math.round(ground.point.z / 0.4) * 0.4,
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
        cast(e);
        const origin = worldConnector(
            state.manualConnect.piece,
            state.manualConnect.connector,
          ).point,
          candidate = ray.ray.at(
            camera.position.distanceTo(origin),
            new THREE.Vector3(),
          );
        state.manualConnect.cursor.copy(candidate);
        state.manualConnect.line.geometry.setFromPoints([origin, candidate]);
        state.manualConnect.line.geometry.attributes.position.needsUpdate = true;
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
      if (orbit) {
        const distance = Math.hypot(
            e.clientX - orbitStart.x,
            e.clientY - orbitStart.y,
          ),
          dx = e.clientX - previous.x,
          dy = e.clientY - previous.y;
        previous = { x: e.clientX, y: e.clientY };
        if (distance <= 5) return;
        moved = true;
        const target = new THREE.Vector3(0, 2, 0),
          s = new THREE.Spherical().setFromVector3(
            camera.position.clone().sub(target),
          );
        s.theta -= dx * 0.006;
        s.phi = THREE.MathUtils.clamp(s.phi - dy * 0.006, 0.25, 1.45);
        camera.position.copy(
          target.add(new THREE.Vector3().setFromSpherical(s)),
        );
        camera.lookAt(0, 2, 0);
        return;
      }
      if (moving) {
        moved = true;
        const shiftActive = e.shiftKey || shiftHeld;
        if (shiftActive && movingLinearAxis) {
          const bounds = canvas.getBoundingClientRect(),
            project = (point: THREE.Vector3) => {
              const projected = point.clone().project(camera);
              return new THREE.Vector2(
                bounds.left + ((projected.x + 1) * bounds.width) / 2,
                bounds.top + ((1 - projected.y) * bounds.height) / 2,
              );
            },
            screenStart = project(movingStartPosition),
            screenEnd = project(
              movingStartPosition.clone().add(movingLinearAxis),
            ),
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
            snappedDistance = Math.round(distance / 0.1) * 0.1;
          moving.mesh.position
            .copy(movingStartPosition)
            .addScaledVector(movingLinearAxis, snappedDistance);
        } else if (shiftActive)
          moving.mesh.position.y =
            Math.round(
              (movingStartPosition.y -
                (e.clientY - movingStartPointer.y) * 0.0125) /
                0.2,
            ) * 0.2;
        else {
          cast(e);
          const ground = ray.intersectObject(floor)[0];
          if (ground) {
            moving.mesh.position.x =
              Math.round((ground.point.x + moveOffset.x) / 0.4) * 0.4;
            moving.mesh.position.z =
              Math.round((ground.point.z + moveOffset.y) / 0.4) * 0.4;
          }
        }
        previous = { x: e.clientX, y: e.clientY };
        state.renderBatchesDirty = true;
      }
    };
    const up = (e: PointerEvent) => {
      if (canvas.hasPointerCapture(e.pointerId))
        canvas.releasePointerCapture(e.pointerId);
      if (state.manualConnect) {
        const draft = state.manualConnect;
        cast(e);
        let best:
          | { piece: Piece; connector: MeshConnector; distance: number }
          | undefined;
        for (const piece of state.pieces) {
          if (piece === draft.piece) continue;
          for (const connector of piece.connectors) {
            if (!pairProfile(draft.connector, connector)) continue;
            const distance = ray.ray.distanceToPoint(
              worldConnector(piece, connector).point,
            );
            if (!best || distance < best.distance)
              best = { piece, connector, distance };
          }
        }
        const connected =
          !!best &&
          best.distance <= 2 &&
          connectManual(
            draft.piece,
            draft.connector,
            best.piece,
            best.connector,
          );
        scene.remove(draft.line);
        draft.line.geometry.dispose();
        (draft.line.material as THREE.Material).dispose();
        state.manualConnect = undefined;
        if (connected && draft.piece.renderBatched)
          state.rebuildRenderBatches();
        setConnectionRevision((value) => value + 1);
        setMessage(
          connected && best
            ? `Connect manual: ${draft.piece.part} ↔ ${best.piece.part} · verificando el resto de uniones…`
            : "Connect manual cancelado: no hay un punto compatible a menos de 2 unidades",
        );
        refreshDebug();
        if (connected)
          void verifyConnectionsAsync().then((connections) => {
            setMessage(
              `Connect manual: ${draft.piece.part} ↔ ${best!.piece.part} · ${connections} uniones verificadas`,
            );
          });
        return;
      }
      if (spring) {
        const released = spring;
        const releasedBodies = new Set<RAPIER.RigidBody>();
        released.component.forEach((p) => {
          if (
            p.body &&
            !p.physicsIslandFixed &&
            !releasedBodies.has(p.body)
          ) {
            releasedBodies.add(p.body);
            p.body.resetForces(true);
            p.body.resetTorques(true);
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
      if (orbit && !moved && altCandidate) toggleFixed(altCandidate);
      orbit = false;
      altCandidate = undefined;
      const movedPiece = moving;
      if (moving && moved) {
        connect(moving);
        void verifyConnectionsAsync();
      }
      moving = undefined;
      movingLinearAxis = undefined;
      if (movedPiece?.renderBatched && moved)
        state.rebuildRenderBatches();
      setConnectionRevision((value) => value + 1);
      refreshDebug();
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
          void addPart(
            p,
            new THREE.Vector3(
              Math.round(ground.point.x / 0.4) * 0.4,
              0,
              Math.round(ground.point.z / 0.4) * 0.4,
            ),
          ).then((piece) => {
            if (!piece) return;
            connect(piece);
            void verifyConnectionsAsync();
          });
          setImported((old) =>
            old.some((x) => x.part === p.part) ? old : [p, ...old],
          );
        }
      } catch {
        setMessage("No se pudo soltar esa pieza");
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      camera.position.multiplyScalar(e.deltaY > 0 ? 1.08 : 0.92);
    };
    const resize = () => {
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      state.renderScale = renderScale;
      renderer.setPixelRatio(nativePixelRatio * renderScale);
      renderer.setSize(host.clientWidth, host.clientHeight);
    };
    const keydown = (e: KeyboardEvent) => {
      if (e.code === "ShiftLeft" || e.code === "ShiftRight")
        shiftHeld = true;
      const target = e.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]"))
        return;
      if (state.running || !state.selected) return;
      const piece = state.selected,
        code = e.code;
      if (code === "Delete") {
        e.preventDefault();
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
                : undefined;
      if (!rotation) return;
      e.preventDefault();
      if (rotation.axis === "x") piece.mesh.rotateX(rotation.angle);
      else piece.mesh.rotateY(rotation.angle);
      piece.mesh.updateMatrixWorld(true);
      if (piece.renderBatched) state.rebuildRenderBatches();
      else state.renderBatchesDirty = true;
      refreshDebug();
      setSelectedId(piece.id);
      setMessage(`${piece.part} rotada 90° · ${rotation.axis.toUpperCase()}`);
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.code === "ShiftLeft" || e.code === "ShiftRight")
        shiftHeld = false;
    };
    const clearModifiers = () => {
      shiftHeld = false;
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
            available = gl.getQueryParameter(
              pending.query,
              gl.QUERY_RESULT_AVAILABLE,
            ),
            disjoint = gl.getParameter(gpuTimerExtension.GPU_DISJOINT_EXT);
          if (disjoint) {
            pendingGpuTimers.splice(0).forEach(({ query }) =>
              gl.deleteQuery(query),
            );
            break;
          }
          if (!available) break;
          pending.sample.gpuMs =
            Number(gl.getQueryParameter(pending.query, gl.QUERY_RESULT)) /
            1_000_000;
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
        let phaseStarted = performance.now();
        const steppedBodies = new Set<RAPIER.RigidBody>();
        state.pieces.forEach((p) => {
          if (!p.body || steppedBodies.has(p.body)) return;
          steppedBodies.add(p.body);
          const sleeping = p.body.isSleeping();
          if (sleeping) sleepingBodies++;
          else activeBodies++;
          if (!p.physicsIslandFixed && !sleeping) {
            p.body.resetForces(false);
            p.body.resetTorques(false);
          }
        });
        forceResetMs = performance.now() - phaseStarted;
        phaseStarted = performance.now();
        if (spring?.piece.body && !spring.piece.physicsIslandFixed) {
          const anchor = spring.piece.mesh.localToWorld(spring.anchor.clone()),
            delta = spring.target.clone().sub(anchor);
          if (delta.length() > 3.5) delta.setLength(3.5);
          const velocity = spring.piece.body.linvel(),
            acceleration = delta
              .multiplyScalar(42)
              .addScaledVector(
                new THREE.Vector3(velocity.x, velocity.y, velocity.z),
                -1.2,
              ),
            movingMass = Math.max(0.25, spring.piece.body.mass());
          if (acceleration.length() > 90) acceleration.setLength(90);
          const force = acceleration.multiplyScalar(Math.max(0.25, movingMass)),
            totalForce = force.length();
          spring.piece.body.addForceAtPoint(
            { x: force.x, y: force.y, z: force.z },
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
            (connection.mode !== "linear" &&
              connection.mode !== "rotation-linear") ||
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
            relativeSpeed =
              (velocityB.x - velocityA.x) * axis.x +
              (velocityB.y - velocityA.y) * axis.y +
              (velocityB.z - velocityA.z) * axis.z,
            damping = connection.mode === "linear" ? 0.42 : 0.18,
            forceMagnitude = THREE.MathUtils.clamp(
              relativeSpeed * damping,
              -1.5,
              1.5,
            ),
            frictionForce = axis.multiplyScalar(forceMagnitude);
          if (!connection.b.physicsIslandFixed)
            connection.b.body.addForce(
              {
                x: -frictionForce.x,
                y: -frictionForce.y,
                z: -frictionForce.z,
              },
              true,
            );
          if (!connection.a.physicsIslandFixed)
            connection.a.body.addForce(
              {
                x: frictionForce.x,
                y: frictionForce.y,
                z: frictionForce.z,
              },
              true,
            );
        }
        jointForcesMs = performance.now() - phaseStarted;
        phaseStarted = performance.now();
        state.world.timestep = Math.min(clock.getDelta(), 1 / 60);
        state.world.step(state.physicsEventQueue, state.physicsHooks);
        enforceGearLinks();
        worldStepMs = performance.now() - phaseStarted;
        phaseStarted = performance.now();
        const startup = performance.now() - (state.simStartedMs ?? 0) < 350;
        const clampedBodies = new Set<RAPIER.RigidBody>();
        state.pieces.forEach((p) => {
          if (
            p.body &&
            !p.body.isSleeping() &&
            !clampedBodies.has(p.body)
          ) {
            clampedBodies.add(p.body);
            clampMotion(p, startup ? 2 : 12, startup ? 3 : 14);
          }
        });
        state.pieces.forEach((p) => {
          if (
            p.body &&
            (!state.largeSimulation || startup || !p.body.isSleeping())
          ) {
            const t = p.body.translation(),
              q = p.body.rotation(),
              bodyRotation = new THREE.Quaternion(q.x, q.y, q.z, q.w),
              offset = (p.physicsOffset ?? new THREE.Vector3())
                .clone()
                .applyQuaternion(bodyRotation);
            p.mesh.position.set(t.x + offset.x, t.y + offset.y, t.z + offset.z);
            p.mesh.quaternion.copy(
              bodyRotation.clone().multiply(
                p.physicsBase ?? new THREE.Quaternion(),
              ),
            );
          }
        });
        state.dynamicConnectionFrame++;
        if (state.dynamicConnectionFrame % 8 === 0)
          updateDynamicMechanisms();
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
      } else clock.getDelta();
      let phaseStarted = performance.now();
      if (state.running || state.renderBatchesDirty)
        state.updateRenderBatches();
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
      const gpuQuery =
        gpuTimerExtension &&
        state.performanceTrace.totalFrames % 4 === 0 &&
        pendingGpuTimers.length < 16
          ? gl.createQuery()
          : null;
      if (gpuQuery && gpuTimerExtension)
        gl.beginQuery(gpuTimerExtension.TIME_ELAPSED_EXT, gpuQuery);
      renderer.render(scene, camera);
      if (gpuQuery && gpuTimerExtension)
        gl.endQuery(gpuTimerExtension.TIME_ELAPSED_EXT);
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
      if (renderBatchRebuildFrame)
        cancelAnimationFrame(renderBatchRebuildFrame);
      pendingGpuTimers.forEach(({ query }) => gl.deleteQuery(query));
      window.removeEventListener("resize", resize);
      resizeObserver.disconnect();
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("keyup", keyup, true);
      window.removeEventListener("blur", clearModifiers);
      renderer.dispose();
      state.physicsEventQueue?.free();
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
    if (state.scene.fog instanceof THREE.Fog)
      state.scene.fog.color.copy(background);
    (state.floor.material as THREE.MeshStandardMaterial).color.setHex(
      dark ? 0x2b3035 : 0xcbd6dd,
    );
    state.scene.remove(state.grid);
    state.grid.geometry.dispose();
    const materials = Array.isArray(state.grid.material)
      ? state.grid.material
      : [state.grid.material];
    materials.forEach((material) => material.dispose());
    state.grid = new THREE.GridHelper(
      40,
      40,
      dark ? 0x697078 : 0x8297a5,
      dark ? 0x3d4248 : 0xb3c1ca,
    );
    state.scene.add(state.grid);
    state.renderer.setClearColor(background);
  }, [theme]);

  const visible = useMemo(
    () =>
      category === "imported" && search
        ? results.filter((p) =>
            (p.part + " " + p.name)
              .toLowerCase()
              .includes(search.toLowerCase()),
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
    let found: CatalogPart = {
      part,
      name: `Pieza LDraw ${part}`,
      kind: "beam",
      color: 71,
    };
    try {
      const d = await fetch(`/api/parts?q=${encodeURIComponent(part)}`).then(
        (r) => r.json(),
      );
      const exact = d.items?.find(
        (x: { part: string }) => x.part.toLowerCase() === part.toLowerCase(),
      );
      if (exact)
        found = {
          ...exact,
          kind: kindFor("", exact.name),
          color: exact.color ?? 71,
        };
    } catch {}
    setImported((old) =>
      old.some((x) => x.part === found.part) ? old : [found, ...old],
    );
    setCategory("imported");
    setReference("");
    setCatalogBusy(false);
    void appRef.current?.preloadPart(found);
  };
  const rotate = (axis: "x" | "y" | "z", dir = 1) => {
    const s = appRef.current,
      p = s?.selected;
    if (!s || !p || running) return;
    const radians = THREE.MathUtils.degToRad(rotationAngle * dir);
    if (axis === "x") p.mesh.rotateX(radians);
    else if (axis === "y") p.mesh.rotateY(radians);
    else p.mesh.rotateZ(radians);
    if (p.renderBatched) s.rebuildRenderBatches();
    else s.renderBatchesDirty = true;
    s.refreshDebug();
    setSelectedId(p.id);
  };
  const nudge = (axis: "x" | "y" | "z", amount: number) => {
    const s = appRef.current,
      p = s?.selected;
    if (!s || !p || running) return;
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
    setMessage(t.changingColor);
    const changed = await s.recolorPart(piece, color);
    setMessage(
      changed
        ? `${t.colorChanged} · LDraw ${color}`
        : `${t.colorError} · LDraw ${color}`,
    );
    setSelectedId(piece.id);
  };
  const remove = () => {
    const s = appRef.current,
      p = s?.selected;
    if (!s || !p || running) return;
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
    if (!s) return;
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
    s.physicsJoints.clear();
    s.dynamicNoContactPairs.clear();
    s.contactExclusions.clear();
    s.contactCandidates.clear();
    s.rigidIslandByPiece = undefined;
    s.createPhysicsJoint = undefined;
    s.connectionModes.clear();
    s.pendingPlacement = undefined;
    s.snapshot = undefined;
    s.physicsEventQueue?.free();
    s.physicsEventQueue = undefined;
    s.world = undefined;
    s.physicsHooks = undefined;
    s.contactFilterStats = undefined;
    s.selected = undefined;
    s.refreshDebug();
    setRunning(false);
    setSelectedId(null);
    setCount(0);
  };
  const physics = async () => {
    const s = appRef.current;
    if (!s) return;
    if (!s.running) {
      await RAPIER.init();
      s.snapshot = s.pieces.map((piece) => ({
        piece,
        position: piece.mesh.position.clone(),
        rotation: piece.mesh.quaternion.clone(),
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
      s.gearLinks = detectGearLinks(s.pieces, rigidIslandByPiece);
      const fixedConnectionCount = s.connections.filter(
          (connection) => connection.mode === "fixed",
        ).length,
        stiffnessRatio = structuralStiffness / 100,
        largeSimulation =
          rigidIslands.length > 250 || s.pieces.length > 800,
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
      world.integrationParameters.numInternalPgsIterations =
        internalPgsIterations;
      world.integrationParameters.maxCcdSubsteps = largeSimulation ? 1 : 2;
      world.integrationParameters.contact_natural_frequency = 18;
      world.integrationParameters.normalizedAllowedLinearError =
        THREE.MathUtils.lerp(0.025, 0.002, stiffnessRatio);
      s.simLog.events[0] =
        `Inicio con ${s.pieces.length} piezas agrupadas en ${rigidIslands.length} cuerpos rígidos y ${s.connections.length} uniones`;
      s.simLog.events.push(
        `Modo estructural ${structuralMode}; rigidez ${structuralStiffness}%`,
        `Solver: ${solverIterations} iteraciones × ${internalPgsIterations} PGS interno + ${additionalSolverIterations} adicionales`,
        structuralMode === "rigid"
          ? `${fixedConnectionCount} conexiones fijas fusionadas en islas rígidas compuestas`
          : `${fixedConnectionCount} conexiones fijas conservadas como joints entre piezas`,
        `${s.gearLinks.length} pares de engranajes compatibles enlazados por distancia y relación de dientes`,
      );
      const colliderOwners = new Map<number, Piece>(),
        traversedConnectorPairs = detectShaftTraversals(s.pieces),
        noContactPiecePairs = buildConnectorContactExclusions(
          s.connections,
          rigidIslandByPiece,
          traversedConnectorPairs,
        );
      s.rigidIslandByPiece = rigidIslandByPiece;
      s.contactExclusions.clear();
      noContactPiecePairs.forEach((key) => s.contactExclusions.add(key));
      s.simLog.events.push(
        `${traversedConnectorPairs.length} pares eje/pin ↔ pieza atravesada detectados geométricamente`,
        `${noContactPiecePairs.size} pares pin/eje ↔ grupo excluidos de colisión`,
      );
      s.physicsEventQueue?.free();
      s.physicsEventQueue = new RAPIER.EventQueue(true);
      s.contactFilterStats = { tested: 0, rejected: 0 };
      s.physicsHooks = {
        filterContactPair(colliderA, colliderB) {
          const pieceA = colliderOwners.get(colliderA),
            pieceB = colliderOwners.get(colliderB);
          if (s.contactFilterStats) s.contactFilterStats.tested++;
          const pairKey =
            pieceA && pieceB ? contactPairKey(pieceA, pieceB) : undefined;
          if (
            pieceA &&
            pieceB &&
            pairKey &&
            (s.contactExclusions.has(pairKey) ||
              s.dynamicNoContactPairs.has(pairKey))
          ) {
            if (s.contactFilterStats) s.contactFilterStats.rejected++;
            return null;
          }
          if (
            pieceA &&
            pieceB &&
            pairKey &&
            (pieceA.dynamicAxleConnections ||
              pieceB.dynamicAxleConnections)
          )
            s.contactCandidates.set(pairKey, { a: pieceA, b: pieceB });
          return RAPIER.SolverFlags.COMPUTE_IMPULSE;
        },
        filterIntersectionPair() {
          return true;
        },
      };
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(20, 0.15, 20)
          .setTranslation(0, -0.2, 0)
          .setFriction(0.9)
          .setCollisionGroups(
            interactionGroups(
              COLLISION_GROUP_NON_GEAR,
              COLLISION_GROUP_NON_GEAR | COLLISION_GROUP_GEAR_NORMAL,
            ),
          ),
      );
      rigidIslands.forEach((island) => {
        const origin = island.reduce(
            (sum, piece) => sum.add(piece.mesh.position),
            new THREE.Vector3(),
          ).multiplyScalar(1 / island.length),
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
          p.physicsOffset = p.mesh.position.clone().sub(origin);
          p.physicsBase = p.mesh.quaternion.clone();
          p.physicsIsland = island;
          p.physicsIslandFixed = islandFixed;
          p.body = rb;
          const createPieceCollider = (
            primitive: CollisionPrimitive,
            gearLayer: boolean,
          ) => {
            const collider =
              primitive.shape === "box"
                ? RAPIER.ColliderDesc.cuboid(
                    primitive.size!.x / 2,
                    primitive.size!.y / 2,
                    primitive.size!.z / 2,
                  )
                : RAPIER.ColliderDesc.cylinder(
                    primitive.halfHeight!,
                    primitive.radius!,
                  );
            const center = p.physicsOffset
                .clone()
                .add(
                  primitive.center.clone().applyQuaternion(p.physicsBase),
                ),
              rotation = p.physicsBase.clone().multiply(primitive.rotation);
            collider
              .setTranslation(center.x, center.y, center.z)
              .setRotation(rotation)
              .setFriction(gearLayer ? 1.15 : p.kind === "wheel" ? 1.6 : 0.75)
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
                        COLLISION_GROUP_NON_GEAR |
                          COLLISION_GROUP_GEAR_NORMAL,
                      ),
              )
              .setDensity(
                gearLayer
                  ? 0
                  : (p.kind === "motor" ? 1.7 : 1) /
                      Math.max(1, p.colliders.length),
              );
            const createdCollider = world.createCollider(collider, rb);
            colliderOwners.set(createdCollider.handle, p);
          };
          p.colliders.forEach((primitive) =>
            createPieceCollider(primitive, false),
          );
          p.gearColliders.forEach((primitive) =>
            createPieceCollider(primitive, true),
          );
        });
      });
      let movingJointCount = 0,
        redundantMovingJoints = 0;
      s.physicsJoints.clear();
      s.dynamicNoContactPairs.clear();
      s.contactCandidates.clear();
      const createPhysicsJoint = (c: Connection) => {
        if (!c.a.body || !c.b.body) return;
        if (
          structuralMode === "rigid" &&
          c.mode === "fixed" &&
          c.a.body === c.b.body
        )
          return;
        if (c.a.body === c.b.body) {
          redundantMovingJoints++;
          return;
        }
        const positionA = c.a.body.translation(),
          positionB = c.b.body.translation(),
          a = c.point
            .clone()
            .sub(new THREE.Vector3(positionA.x, positionA.y, positionA.z)),
          b = c.point
            .clone()
            .sub(new THREE.Vector3(positionB.x, positionB.y, positionB.z)),
          axis = c.axis.clone().normalize(),
          dynamicAxle =
            (c.profile === "axle-cross" || c.profile === "axle-round") &&
            c.b.dynamicAxleConnections;
        let joint: RAPIER.JointData;
        if (c.mode === "rotation" || c.mode === "motor")
          joint = RAPIER.JointData.revolute(a, b, axis);
        else if (c.mode === "linear")
          joint = RAPIER.JointData.prismatic(a, b, axis);
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
        else
          joint = RAPIER.JointData.fixed(
            a,
            { x: 0, y: 0, z: 0, w: 1 },
            b,
            { x: 0, y: 0, z: 0, w: 1 },
          );
        const created = world.createImpulseJoint(
          joint,
          c.a.body,
          c.b.body,
          true,
        );
        movingJointCount++;
        created.setContactsEnabled(true);
        if (c.mode === "motor")
          (created as RAPIER.RevoluteImpulseJoint).configureMotorVelocity(
            c.motorSpeed,
            c.motorForce,
          );
        else if (c.mode === "rotation" && c.b.frictionPin)
          (created as RAPIER.RevoluteImpulseJoint).configureMotorVelocity(
            0,
            3.5,
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
          largeSimulation ? "modo de rendimiento para ensamblaje grande" : "precisión completa"
        }`,
      );
    } else {
      s.running = false;
      s.gearLinks = [];
      s.physicsJoints.clear();
      s.dynamicNoContactPairs.clear();
      s.contactExclusions.clear();
      s.contactCandidates.clear();
      s.rigidIslandByPiece = undefined;
      s.createPhysicsJoint = undefined;
      if (s.simLog) {
        s.simLog.endedAt = new Date().toISOString();
        s.simLog.duration =
          (Date.parse(s.simLog.endedAt) - Date.parse(s.simLog.startedAt)) /
          1000;
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
      s.renderBatchesDirty = true;
      s.snapshot = undefined;
      s.physicsEventQueue?.free();
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
  };
  const importModel = async (file: File) => {
    const s = appRef.current;
    if (!s || running) return;
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
      const references = [
          ...new Set(rows.map((row) => row.part.toLowerCase())),
        ],
        paletteMatches = new Map<string, CatalogPart[]>();
      for (const part of paletteParts) {
        for (const reference of [part.part, part.modelPart].filter(Boolean)) {
          const key = reference!.toLowerCase(),
            matches = paletteMatches.get(key) ?? [];
          matches.push(part);
          paletteMatches.set(key, matches);
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
        [...new Map(paletteToLoad.map((part) => [`${part.part}:${part.color}`, part])).values()].map(
          async (part) => {
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
          },
        ),
      );
      if (!stillActive()) return;
      setImportDraft((draft) =>
        draft ? { ...draft, status: "external", progress: paletteReferences.length } : draft,
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
            };
          return {
            ...(external ?? {}),
            part: row.part,
            name: external?.name ?? `LDraw ${row.part}`,
            kind: kindFor("", external?.name ?? row.part),
            color: row.color,
            sourceColor: external?.color ?? 71,
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
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
      }
    } finally {
      s.bulkLoading = false;
    }
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
      const r = new THREE.Matrix4().makeRotationFromQuaternion(
        p.mesh.quaternion,
      );
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
  const selected = appRef.current?.selected;
  const selectedCollisionLayer = selected?.gear ? collisionLayer : "normal",
    selectedCollisionPrimitives = selected
      ? selectedCollisionLayer === "gear"
        ? selected.gearColliders
        : selected.colliders
      : [];
  const selectedConnections = selected
    ? (appRef.current?.connections.filter(
        (connection) => connection.b === selected,
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
    const normalized = connectors.map((connector) => ({
      ...connector,
      local: connector.local.clone(),
      axis:
        connector.axis.lengthSq() > 0.0001
          ? connector.axis.clone().normalize()
          : new THREE.Vector3(1, 0, 0),
    }));
    for (const instance of state.pieces.filter(
      (item) => item.part === piece.part,
    )) {
      instance.connectors = normalized.map((connector) => ({
        ...connector,
        local: connector.local.clone(),
        axis: connector.axis.clone(),
      }));
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
    else if (field === "diameter")
      connector.diameter = Math.max(0.01, +value || 0.01);
    else if (field === "length")
      connector.length = Math.max(0.01, +value || 0.01);
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
    commitConnectorMap(
      selected,
      next,
      `Mapa ${selected.part}: conector añadido`,
    );
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
            !shafts.some(
              (shaft) => shaft.local.distanceTo(socket.local) < 0.12,
            ),
        ),
      ];
    } else if (isAxlePart(selected)) {
      const shafts = rodConnectors(selected.mesh, "axle");
      connectors = [
        ...shafts,
        ...sockets.filter(
          (socket) =>
            !shafts.some(
              (shaft) => shaft.local.distanceTo(socket.local) < 0.12,
            ),
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
  const commitCollisionMap = (
    piece: Piece,
    colliders: CollisionPrimitive[],
    notice: string,
    layer: "normal" | "gear" = selectedCollisionLayer,
  ) => {
    const state = appRef.current;
    if (!state || running) return;
    const normalized = colliders.map(cloneCollider);
    state.pieces
      .filter((instance) => instance.part === piece.part)
      .forEach((instance) => {
        if (layer === "gear")
          instance.gearColliders = normalized.map(cloneCollider);
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
    } else if (field === "center")
      primitive.center.setComponent(component, +value || 0);
    else if (field === "size")
      primitive.size?.setComponent(component, Math.max(0.01, +value || 0.01));
    else if (field === "radius")
      primitive.radius = Math.max(0.01, +value || 0.01);
    else if (field === "halfHeight")
      primitive.halfHeight = Math.max(0.01, +value || 0.01);
    else {
      const rotation = new THREE.Euler().setFromQuaternion(
        primitive.rotation,
        "XYZ",
      );
      if (component === 0) rotation.x = THREE.MathUtils.degToRad(+value || 0);
      else if (component === 1)
        rotation.y = THREE.MathUtils.degToRad(+value || 0);
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
          ? new THREE.Vector3().fromArray(row.size!).max(
              new THREE.Vector3(0.01, 0.01, 0.01),
            )
          : undefined,
      radius:
        shape === "cylinder" ? Math.max(0.01, row.radius ?? 0.5) : undefined,
      halfHeight:
        shape === "cylinder"
          ? Math.max(0.01, row.halfHeight ?? 0.5)
          : undefined,
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
      const colliders: CollisionPrimitive[] = rows.map(
        collisionPrimitiveFromData,
      );
      commitCollisionMap(
        selected,
        colliders,
        `Mapa ${selected.part}: ${colliders.length} colliders importados`,
        "normal",
      );
      if (selected.gear && Array.isArray(payload.gearColliders)) {
        const gearColliders = payload.gearColliders.map(
          collisionPrimitiveFromData,
        );
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
    a.href = URL.createObjectURL(
      new Blob([lastLog], { type: "application/json" }),
    );
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
          framesOver16_7ms: samples.filter(
            (sample) => sample.frameIntervalMs > 16.7,
          ).length,
          framesOver33_3ms: samples.filter(
            (sample) => sample.frameIntervalMs > 33.3,
          ).length,
          framesOver50ms: samples.filter(
            (sample) => sample.frameIntervalMs > 50,
          ).length,
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
    setInspectorWidth((width) =>
      Math.min(maximum, Math.max(minimum, width + change)),
    );
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
        Math.min(
          maximum,
          Math.max(minimum, startWidth + startX - moveEvent.clientX),
        ),
      );
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.classList.remove("resizing-inspector");
      if (handle.hasPointerCapture(pointerId))
        handle.releasePointerCapture(pointerId);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

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
          onClick={() =>
            setTheme((value) => (value === "dark" ? "light" : "dark"))
          }
          aria-label={t.switchTheme}
          title={theme === "dark" ? t.light : t.dark}
        >
          <span>{theme === "dark" ? "☀" : "◐"}</span>
          {theme === "dark" ? t.light : t.dark}
        </button>
        <div className="project">
          <span>{t.project}</span>
          <b>{t.mechanism}</b>
        </div>
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
          <button className="ghost" onClick={() => fileRef.current?.click()}>
            {t.import}
          </button>
          <button className="ghost" onClick={exportModel}>
            {t.export}
          </button>
          <button className={running ? "stop" : "play"} onClick={physics}>
            {running ? t.stop : t.simulate}
          </button>
        </div>
      </header>
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
          <b>{
            t.categories[
              categories.find((c) => c.id === category)?.id ?? "beams"
            ]
          }</b>
          <span>{`${visible.length} ${t.pieces}`}</span>
        </div>
        <div className="parts-grid">
          {visible.map((p) => (
            <article
              key={`${p.part}-${p.color}`}
              draggable
              onDragStart={(e) => dragPart(e, p)}
              onClick={() => {
                setImported((old) =>
                  old.some((x) => x.part === p.part && x.color === p.color)
                    ? old
                    : [p, ...old],
                );
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
        {!visible.length && (
          <div className="no-results">
            {t.noResults}
          </div>
        )}
        <div className="drag-help">
          {t.dragHelp}
        </div>
      </aside>
      <section className="viewport" ref={mountRef}>
        <div className="fps-counter" ref={fpsRef} data-level="high">
          -- FPS
        </div>
        <div className="view-label">
          <span className={running ? "live" : ""} />
          {running
            ? t.running
            : message === "catalog-ready"
              ? t.ready
              : message}
        </div>
        <div className="camera-help">
          {t.cameraHelp}
        </div>
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
                <small>{t.piece} {selected.part}</small>
                <b>{selected.name}</b>
              </div>
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
                onChange={(event) =>
                  void changeSelectedColor(+event.target.value)
                }
              >
                {!ldrawColorOptions.includes(selected.color) && (
                  <option value={selected.color}>
                    LDraw {selected.color}
                  </option>
                )}
                {ldrawColorOptions.map((color) => (
                  <option value={color} key={color}>
                    {color} · {ldrawColorNames[color]?.[language] ?? `LDraw ${color}`}
                  </option>
                ))}
              </select>
            </div>
            <label>{t.move}</label>
            <div className="control-grid">
              <button onClick={() => nudge("x", -0.4)}>X−</button>
              <button onClick={() => nudge("y", 0.4)}>Y+</button>
              <button onClick={() => nudge("z", -0.4)}>Z−</button>
              <button onClick={() => nudge("x", 0.4)}>X+</button>
              <button onClick={() => nudge("y", -0.4)}>Y−</button>
              <button onClick={() => nudge("z", 0.4)}>Z+</button>
            </div>
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
                (connector) =>
                  connector.role === "shaft" && connector.kind === "axle",
              )) && (
              <label className="property-check dynamic-axle-check">
                <input
                  type="checkbox"
                  checked={selected.dynamicAxleConnections}
                  disabled={running}
                  onChange={(event) => {
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
                <label>
                  {language === "es" ? "Engranaje" : "Gear coupling"}
                </label>
                <div className="data-row">
                  <span>{language === "es" ? "Dientes" : "Teeth"}</span>
                  <b>{selectedGearSpec.teeth}</b>
                </div>
                <div className="data-row">
                  <span>
                    {language === "es" ? "Radio primitivo" : "Pitch radius"}
                  </span>
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
                            {selectedGearSpec.teeth}:{other.spec.teeth} · {ratio.toFixed(3)}× ·{" "}
                            {language === "es" ? "giro inverso" : "opposite rotation"}
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
            {selected.connectors.some(
              (connector) => connector.role === "shaft",
            ) && (
              <div className="connection-editor">
                <label>{t.pieceJoints}</label>
                {selectedConnections.length ? (
                  selectedConnections.map((connection, index) => {
                    const other = connection.a;
                    return (
                      <div className="connection-card" key={connection.id}>
                        <div>
                          <b>
                            {t.joint} {index + 1} · {other.part}
                          </b>
                          <span>{profileLabels[connection.profile]}</span>
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
                                  setMotorSpeed(
                                    connection.id,
                                    +event.target.value,
                                  )
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
                                  setMotorForce(
                                    connection.id,
                                    +event.target.value,
                                  )
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
                  <p className="no-connections">
                    {t.noJoints}
                  </p>
                )}
              </div>
            )}
            <div className="data-row">
              <span>{t.connectMap}</span>
              <b>{selected.connectors.length} {t.points}</b>
            </div>
            <button
              className="map-toggle"
              onClick={() => setConnectionMapOpen((value) => !value)}
            >
              {connectionMapOpen
                ? t.closeMap
                : t.editMap}
            </button>
            {connectionMapOpen && (
              <div className="map-editor">
                <p>
                  {t.mapHelp}
                </p>
                <div className="map-actions">
                  <button onClick={addConnector}>{t.addPoint}</button>
                  <button onClick={regenerateConnectorMap}>
                    {t.regenerateMap}
                  </button>
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
                      <b>#{index + 1}</b>{" "}
                      {connector.role === "socket" ? t.hole : t.shaft} ·{" "}
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
                            updateConnector(
                              index,
                              "local",
                              String(nextValue),
                              component,
                            )
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
                            updateConnector(
                              index,
                              "axis",
                              String(nextValue),
                              component,
                            )
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
                            updateConnector(
                              index,
                              "diameter",
                              String(nextValue),
                            )
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
                {selected.gear ? ` + ${selected.gearColliders.length}` : ""}{" "}
                formas
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
              {collisionMapOpen
                ? t.closeCollisionMap
                : t.editCollisionMap}
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
                  <button onClick={() => addCollider("cylinder")}>
                    {t.addCylinder}
                  </button>
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
                        {[rotation.x, rotation.y, rotation.z].map(
                          (value, component) => (
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
                          ),
                        )}
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
                                updateCollider(
                                  index,
                                  "radius",
                                  String(nextValue),
                                )
                              }
                            />
                          </label>
                          <label>
                            {t.halfHeight}
                            <DeferredNumberInput
                              min={0.01}
                              value={primitive.halfHeight ?? 0.5}
                              onCommit={(nextValue) =>
                                updateCollider(
                                  index,
                                  "halfHeight",
                                  String(nextValue),
                                )
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
            <div className="data-row">
              <span>{t.model}</span>
              <b>{selected.part}.dat</b>
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
            {lastLog
              ? t.downloadLog
              : t.stopForLog}
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
          <button onClick={downloadPerformanceLog}>
            {t.downloadPerformance}
          </button>
        </div>
        <div className="physics">
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
            {structuralMode === "rigid"
              ? t.rigidStructureHelp
              : t.flexibleStructureHelp}
          </p>
          <b>{t.physicsEngine}</b>
          <span>
            <i /> Rapier + LDraw Connect
          </span>
          <p>
            {t.physicsHelp}
          </p>
        </div>
      </aside>
      <footer>
        <span>● {t.grid}</span>
        <a href="https://www.ldraw.org/" target="_blank" rel="noreferrer">
          {t.ldrawCredit}
        </a>
        <span>Y ↑</span>
        <span>{count} {t.pieces} · {t.cache}</span>
      </footer>
    </main>
  );
}
