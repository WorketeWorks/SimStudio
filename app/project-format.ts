import { gunzipSync, gzipSync, strFromU8, strToU8 } from "fflate";

export const PROJECT_EXTENSION = ".simstudio";
export const PROJECT_MIME = "application/x-simstudio-project";
export const PROJECT_FORMAT = "simstudio-project";
export const PROJECT_VERSION = 1;

const FILE_MAGIC = strToU8("SIMSTUDIO\u0001\n");
const DB_NAME = "sim-studio-projects";
const DB_VERSION = 1;
const META_STORE = "projects";
const DOCUMENT_STORE = "documents";
const RECOVERY_STORE = "recovery";

export type JsonObject = Record<string, unknown>;

export type SavedConnector = {
  local: [number, number, number];
  axis: [number, number, number];
  kind: "round" | "axle" | "half";
  role: "socket" | "shaft";
  diameter: number;
  length?: number;
};

export type SavedCollisionPrimitive = {
  shape: "box" | "cylinder";
  center: [number, number, number];
  size?: [number, number, number];
  radius?: number;
  halfHeight?: number;
  rotation: [number, number, number, number];
};

export type SavedPiece = {
  id: string;
  catalog: JsonObject;
  asset: string;
  position: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
  fixed: boolean;
  /** Use the rendered triangle surface instead of the compound proxy map. */
  exactCollider?: boolean;
  dynamicAxleConnections: boolean;
  rotationPivotLocal?: [number, number, number];
  rotationPivotKey?: string;
  connectors: SavedConnector[];
  colliders: SavedCollisionPrimitive[];
  gearColliders: SavedCollisionPrimitive[];
};

export type SavedConnection = {
  id: string;
  a: string;
  b: string;
  socketIndex: number;
  shaftIndex: number;
  mode: "fixed" | "rotation" | "linear" | "rotation-linear" | "motor";
  profile: "pin-round" | "axle-cross" | "axle-round";
  point: [number, number, number];
  axis: [number, number, number];
  localAxisA: [number, number, number];
  travel: number;
  motorSpeed: number;
  motorForce: number;
  userConfigured: boolean;
  forced?: boolean;
  forcedOffset?: number;
  localPointA?: [number, number, number];
  localPointB?: [number, number, number];
};

export type SavedGearLink = {
  a: string;
  b: string;
  specA: { teeth: number; kind: string; pitchRadius: number };
  specB: { teeth: number; kind: string; pitchRadius: number };
  centerA: [number, number, number];
  centerB: [number, number, number];
  poseAxisA: [number, number, number];
  poseAxisB: [number, number, number];
  axisA: [number, number, number];
  axisB: [number, number, number];
  ratio: number;
  centerDistance: number;
  expectedDistance: number;
  distanceError: number;
  signB: number;
  perpendicular: boolean;
};

export type SimStudioProjectDocument = {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  appVersion: string;
  revision?: number;
  savedRevision?: number | null;
  assets: Record<string, JsonObject>;
  pieces: SavedPiece[];
  connections: SavedConnection[];
  gearLinks: SavedGearLink[];
  importedCatalog: JsonObject[];
  camera: {
    position: [number, number, number];
    quaternion: [number, number, number, number];
    target: [number, number, number];
  };
  settings: {
    gridStep: number;
    axleSnapStep: number;
    rotationSnapStep: number;
    structuralMode: "rigid" | "flexible";
    structuralStiffness: number;
    physics: Record<string, number>;
  };
};

export type ProjectSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  pieceCount: number;
};

const concatBytes = (left: Uint8Array, right: Uint8Array) => {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
};

export function validateProjectDocument(value: unknown): SimStudioProjectDocument {
  if (!value || typeof value !== "object")
    throw new Error("The file does not contain a Sim Studio project.");
  const document = value as Partial<SimStudioProjectDocument>;
  if (document.format !== PROJECT_FORMAT)
    throw new Error("This is not a .simstudio project file.");
  if (document.version !== PROJECT_VERSION)
    throw new Error(`Unsupported project version: ${String(document.version)}.`);
  if (
    typeof document.id !== "string" ||
    typeof document.name !== "string" ||
    !Array.isArray(document.pieces) ||
    !Array.isArray(document.connections) ||
    !document.assets ||
    !document.camera ||
    !document.settings
  )
    throw new Error("The Sim Studio project is incomplete or damaged.");
  return document as SimStudioProjectDocument;
}

export function encodeProjectFile(document: SimStudioProjectDocument) {
  const validated = validateProjectDocument(document);
  return concatBytes(
    FILE_MAGIC,
    gzipSync(strToU8(JSON.stringify(validated)), { level: 6 }),
  );
}

export function decodeProjectFile(source: ArrayBuffer | Uint8Array) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const hasMagic =
    bytes.length > FILE_MAGIC.length &&
    FILE_MAGIC.every((value, index) => bytes[index] === value);
  const text = hasMagic
    ? strFromU8(gunzipSync(bytes.subarray(FILE_MAGIC.length)))
    : strFromU8(bytes);
  return validateProjectDocument(JSON.parse(text));
}

export function safeProjectFileName(name: string) {
  const base = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 100);
  return `${base || "Sim Studio project"}${PROJECT_EXTENSION}`;
}

export function projectSummary(document: SimStudioProjectDocument): ProjectSummary {
  return {
    id: document.id,
    name: document.name,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    pieceCount: document.pieces.length,
  };
}

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(META_STORE))
        database.createObjectStore(META_STORE, { keyPath: "id" });
      if (!database.objectStoreNames.contains(DOCUMENT_STORE))
        database.createObjectStore(DOCUMENT_STORE, { keyPath: "id" });
      if (!database.objectStoreNames.contains(RECOVERY_STORE))
        database.createObjectStore(RECOVERY_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const transactionDone = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

const requestValue = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export async function listBrowserProjects() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(META_STORE, "readonly");
    const projects = await requestValue(
      transaction.objectStore(META_STORE).getAll() as IDBRequest<ProjectSummary[]>,
    );
    await transactionDone(transaction);
    return projects.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  } finally {
    database.close();
  }
}

export async function saveBrowserProject(document: SimStudioProjectDocument) {
  validateProjectDocument(document);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [META_STORE, DOCUMENT_STORE],
      "readwrite",
    );
    transaction.objectStore(META_STORE).put(projectSummary(document));
    transaction.objectStore(DOCUMENT_STORE).put({ id: document.id, document });
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function loadBrowserProject(id: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(DOCUMENT_STORE, "readonly");
    const record = await requestValue(
      transaction.objectStore(DOCUMENT_STORE).get(id) as IDBRequest<
        { id: string; document: SimStudioProjectDocument } | undefined
      >,
    );
    await transactionDone(transaction);
    return record ? validateProjectDocument(record.document) : undefined;
  } finally {
    database.close();
  }
}

export async function deleteBrowserProject(id: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [META_STORE, DOCUMENT_STORE],
      "readwrite",
    );
    transaction.objectStore(META_STORE).delete(id);
    transaction.objectStore(DOCUMENT_STORE).delete(id);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function saveRecoveryProject(document: SimStudioProjectDocument) {
  validateProjectDocument(document);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(RECOVERY_STORE, "readwrite");
    transaction.objectStore(RECOVERY_STORE).put({
      key: "latest",
      updatedAt: document.updatedAt,
      document,
    });
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function loadRecoveryProject() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(RECOVERY_STORE, "readonly");
    const record = await requestValue(
      transaction.objectStore(RECOVERY_STORE).get("latest") as IDBRequest<
        { key: string; document: SimStudioProjectDocument } | undefined
      >,
    );
    await transactionDone(transaction);
    return record ? validateProjectDocument(record.document) : undefined;
  } finally {
    database.close();
  }
}
