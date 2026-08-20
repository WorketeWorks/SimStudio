/**
 * Shared runtime types for the editor.
 *
 * Keep behavior out of this file: it describes the data exchanged between
 * the Three.js renderer, Rust physics core, connection system and project IO.
 */
import type * as THREE from "three";
import type { CollisionPrimitive, MeshConnector } from "../connectors";
import type { GearPair } from "../gears";
import type { LDrawPlacement } from "../ldraw";
import type {
  RustBodyProxy,
  RustJointProxy,
  RustPhysicsRuntime,
} from "../physics/rust-runtime";
import type { JsonObject, SimStudioProjectDocument } from "../project-format";

export type PieceKind = "beam" | "wheel" | "motor";

export type PartOrigin = "default-palette" | "catalog-search" | "model-import";

export type PartSource = "packaged-cache" | "external-catalog" | "ldraw-network";

export type CatalogPart = {
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
  /** Uses ratio-tagged normal colliders to expose multiple gear engagements. */
  specialGear?: boolean;
  origin?: PartOrigin;
  sourceKind?: PartSource;
  requestedPart?: string;
  catalogReturnedPart?: string;
  resolvedPart?: string;
  catalogQuery?: string;
  importFile?: string;
  downloadUrl?: string;
  downloadSource?: "local" | "primary" | "legacy";
  /** Runtime-only geometry restored from a self-contained .simstudio file. */
  embeddedGeometry?: JsonObject;
  projectAssetKey?: string;
};

export type Piece = CatalogPart & {
  id: number;
  mesh: THREE.Object3D;
  connectors: MeshConnector[];
  colliders: CollisionPrimitive[];
  gearColliders: CollisionPrimitive[];
  gear: boolean;
  specialGear: boolean;
  /** Use the rendered triangle surface as the normal physics collider. */
  exactCollider: boolean;
  fixed: boolean;
  pin: boolean;
  frictionPin: boolean;
  dynamicAxleConnections: boolean;
  rotationPivotLocal?: THREE.Vector3;
  rotationPivotKey?: string;
  gearDirectionLock?: -1 | 0 | 1;
  gearMotor?: { key: string; speed: number; force: number };
  lockSprite?: THREE.Sprite;
  /** Numeric body identifier owned by the Rust/WASM physics core. */
  physicsBodyId?: number;
  /** Cached facade; the real Rapier body never crosses the WASM boundary. */
  body?: RustBodyProxy;
  physicsOffset?: THREE.Vector3;
  physicsBase?: THREE.Quaternion;
  physicsIsland?: Piece[];
  physicsIslandFixed?: boolean;
  renderBatched?: boolean;
  /** Gear-only one-way rotation restriction: -1, 0 (free), or 1. */
  gearDirectionLock?: -1 | 0 | 1;
  /** Gear-only keyboard motor, independent from shaft/joint motors. */
  gearMotor?: { key: string; speed: number; force: number };
};

export type EditorPieceSnapshot = {
  piece: Piece;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  scale: THREE.Vector3;
  color: number;
  fixed: boolean;
  exactCollider: boolean;
  dynamicAxleConnections: boolean;
  rotationPivotLocal?: THREE.Vector3;
  rotationPivotKey?: string;
  connectors: MeshConnector[];
  colliders: CollisionPrimitive[];
  gearColliders: CollisionPrimitive[];
  specialGear: boolean;
};

export type EditorSnapshot = {
  pieces: EditorPieceSnapshot[];
  connections: Connection[];
  connectionModes: AppState["connectionModes"];
  selected?: Piece;
  selectedPieces?: Piece[];
};

export type RenderBatchItem = {
  mesh: THREE.InstancedMesh;
  pieces: Piece[];
  localMatrix: THREE.Matrix4;
};

export type RenderLineBatchItem = {
  line: THREE.LineSegments;
  pieces: Piece[];
  matrixAttribute: THREE.InstancedBufferAttribute;
};

export type RenderBatchStats = {
  lineBatches: number;
  meshBatches: number;
  hiddenOriginalLines: number;
  hiddenOriginalMeshes: number;
};

export type PreparedImportPlacement = {
  catalog: CatalogPart;
  source: LDrawPlacement;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
};

export type ImportDraft = {
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

export type JointMode = "fixed" | "rotation" | "linear" | "rotation-linear" | "motor";

export type StructuralMode = "rigid" | "flexible";

export type ConnectionProfile = "pin-round" | "axle-cross" | "axle-round";

export type Connection = {
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
  forced?: boolean;
  forcedOffset?: number;
  localPointA?: THREE.Vector3;
  localPointB?: THREE.Vector3;
  axialStops?: {
    piece: Piece;
    primitive: CollisionPrimitive;
    side: 1 | -1;
    minimumDistance: number;
    lastLoggedMs?: number;
  }[];
};

export type RuntimeGearLink = GearPair<Piece> & {
  axisA: THREE.Vector3;
  axisB: THREE.Vector3;
  signB: number;
  perpendicular: boolean;
  /** Positive ratio magnitude supplied by a tagged special-gear zone. */
  ratioOverride?: number;
};

export type ManualConnectDraft = {
  piece: Piece;
  connector: MeshConnector;
  anchorLocal: THREE.Vector3;
  cursor: THREE.Vector3;
  plane: THREE.Plane;
  line: THREE.Line;
  label: HTMLDivElement;
  forced: boolean;
  connectorsWereVisible: boolean;
};

export type DebugFlags = { colliders: boolean; connectors: boolean; physics: boolean };

export type SimulationLog = {
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

export type FramePerformanceSample = {
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

export type PerformanceTrace = {
  startedAt: string;
  startedAtMs: number;
  samples: FramePerformanceSample[];
  cursor: number;
  totalFrames: number;
};

export type PhysicsSettings = {
  pieceFriction: number;
  rubberFriction: number;
  frictionlessPinRotation: number;
  axleSlidingFriction: number;
  axleRotationFriction: number;
  axleTolerance: number;
  beamClearance: number;
};

export type GridStep = 0 | 0.25 | 0.5 | 1;

export type AxleSnapStep = 0 | 0.0625 | 0.125 | 0.25;

export type RotationSnapStep = 0 | 11.25 | 22.5 | 45;

export type AppState = {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  cameraTarget: THREE.Vector3;
  floor: THREE.Mesh;
  grid: THREE.Group;
  gridStep: GridStep;
  axleSnapStep: AxleSnapStep;
  rotationSnapStep: RotationSnapStep;
  pieces: Piece[];
  selected?: Piece;
  selectedPieces: Set<Piece>;
  running: boolean;
  physicsSettings: PhysicsSettings;
  world?: RustPhysicsRuntime;
  contactFilterStats?: { tested: number; rejected: number };
  connections: Connection[];
  gearLinks: RuntimeGearLink[];
  gearAngles: Map<string, number>;
  gearBodyRotations: Map<number, THREE.Quaternion>;
  gearPhases: Map<string, number>;
  sleepingBodyHandles: Set<number>;
  physicsJoints: Map<string, RustJointProxy>;
  dynamicNoContactPairs: Set<string>;
  contactExclusions: Set<string>;
  contactCandidates: Map<string, { a: Piece; b: Piece }>;
  rigidIslandByPiece?: Map<Piece, Piece[]>;
  createPhysicsJoint?: (connection: Connection) => RustJointProxy | undefined;
  dynamicConnectionFrame: number;
  manualConnect?: ManualConnectDraft;
  snapshot?: {
    piece: Piece;
    position: THREE.Vector3;
    rotation: THREE.Quaternion;
  }[];
  snapshotConnections?: Connection[];
  connectionModes: Map<
    string,
    {
      mode: JointMode;
      motorSpeed: number;
      motorForce: number;
      userConfigured: boolean;
    }
  >;
  recordHistory: () => void;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  createProjectDocument: (identity?: {
    id?: string;
    name?: string;
    createdAt?: string;
  }) => SimStudioProjectDocument;
  restoreProjectDocument: (document: SimStudioProjectDocument) => Promise<void>;
  scheduleRecoverySave: (immediate?: boolean, markDirty?: boolean) => void;
  copySelected: () => boolean;
  pasteClipboard: () => Promise<Piece | null>;
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
  renderLineBatchItems: RenderLineBatchItem[];
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
