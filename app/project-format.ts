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
  rotationOnly?: boolean;
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

const finiteNumber = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const finiteTuple3 = (
  value: unknown,
  fallback: [number, number, number] = [0, 0, 0],
): [number, number, number] => {
  const source = Array.isArray(value) ? value : fallback;
  return [
    finiteNumber(source[0], fallback[0]),
    finiteNumber(source[1], fallback[1]),
    finiteNumber(source[2], fallback[2]),
  ];
};

const unitTuple3 = (
  value: unknown,
  fallback: [number, number, number] = [0, 1, 0],
): [number, number, number] => {
  const tuple = finiteTuple3(value, fallback),
    length = Math.hypot(tuple[0], tuple[1], tuple[2]);
  if (!Number.isFinite(length) || length < 1e-7) return [...fallback];
  return [tuple[0] / length, tuple[1] / length, tuple[2] / length];
};

const unitQuaternion = (value: unknown): [number, number, number, number] => {
  const source = Array.isArray(value) ? value : [0, 0, 0, 1],
    tuple: [number, number, number, number] = [
      finiteNumber(source[0], 0),
      finiteNumber(source[1], 0),
      finiteNumber(source[2], 0),
      finiteNumber(source[3], 1),
    ],
    length = Math.hypot(tuple[0], tuple[1], tuple[2], tuple[3]);
  if (!Number.isFinite(length) || length < 1e-7) return [0, 0, 0, 1];
  return [
    tuple[0] / length,
    tuple[1] / length,
    tuple[2] / length,
    tuple[3] / length,
  ];
};

const positiveNumber = (value: unknown, fallback: number, minimum = 1e-4) =>
  Math.max(minimum, finiteNumber(value, fallback));

const optionalTuple3 = (value: unknown) =>
  Array.isArray(value) ? finiteTuple3(value) : undefined;

const validDate = (value: unknown, fallback: string) =>
  typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : fallback;

const sanitizeProjectDocument = (
  document: Partial<SimStudioProjectDocument>,
): SimStudioProjectDocument => {
  const now = new Date().toISOString(),
    rawPieces = Array.isArray(document.pieces) ? document.pieces : [],
    pieces: SavedPiece[] = rawPieces.map((rawPiece, pieceIndex) => {
      const piece = rawPiece as Partial<SavedPiece>,
        connectors = (Array.isArray(piece.connectors)
          ? piece.connectors
          : []
        ).map((rawConnector) => {
          const connector = rawConnector as Partial<SavedConnector>;
          return {
            local: finiteTuple3(connector.local),
            axis: unitTuple3(connector.axis),
            kind:
              connector.kind === "axle" || connector.kind === "half"
                ? connector.kind
                : "round",
            role: connector.role === "shaft" ? "shaft" : "socket",
            diameter: positiveNumber(connector.diameter, 0.48, 0.01),
            length:
              connector.length === undefined
                ? undefined
                : positiveNumber(connector.length, 0.5, 0.01),
            rotationOnly: connector.rotationOnly === true || undefined,
          } satisfies SavedConnector;
        }),
        sanitizeCollider = (
          rawCollider: SavedCollisionPrimitive,
        ): SavedCollisionPrimitive => {
          const collider = rawCollider as Partial<SavedCollisionPrimitive>,
            shape = collider.shape === "cylinder" ? "cylinder" : "box";
          return {
            shape,
            center: finiteTuple3(collider.center),
            size:
              shape === "box"
                ? finiteTuple3(collider.size, [0.5, 0.5, 0.5]).map((size) =>
                    Math.max(0.01, Math.abs(size)),
                  ) as [number, number, number]
                : undefined,
            radius:
              shape === "cylinder"
                ? positiveNumber(collider.radius, 0.25, 0.01)
                : undefined,
            halfHeight:
              shape === "cylinder"
                ? positiveNumber(collider.halfHeight, 0.25, 0.01)
                : undefined,
            rotation: unitQuaternion(collider.rotation),
          };
        },
        scale = finiteTuple3(piece.scale, [1, 1, 1]).map((component) =>
          Math.abs(component) < 1e-6 ? 1 : component,
        ) as [number, number, number];
      return {
        id:
          typeof piece.id === "string" && piece.id
            ? piece.id
            : `piece-${pieceIndex + 1}`,
        catalog:
          piece.catalog && typeof piece.catalog === "object"
            ? piece.catalog
            : {},
        asset: typeof piece.asset === "string" ? piece.asset : "",
        position: finiteTuple3(piece.position),
        rotation: unitQuaternion(piece.rotation),
        scale,
        fixed: piece.fixed === true,
        exactCollider: piece.exactCollider === true,
        dynamicAxleConnections: piece.dynamicAxleConnections === true,
        rotationPivotLocal: optionalTuple3(piece.rotationPivotLocal),
        rotationPivotKey:
          typeof piece.rotationPivotKey === "string"
            ? piece.rotationPivotKey
            : undefined,
        connectors,
        colliders: (Array.isArray(piece.colliders)
          ? piece.colliders
          : []
        ).map(sanitizeCollider),
        gearColliders: (Array.isArray(piece.gearColliders)
          ? piece.gearColliders
          : []
        ).map(sanitizeCollider),
      };
    }),
    piecesById = new Map(pieces.map((piece) => [piece.id, piece])),
    connectionModes: SavedConnection["mode"][] = [
      "fixed",
      "rotation",
      "linear",
      "rotation-linear",
      "motor",
    ],
    connectionProfiles: SavedConnection["profile"][] = [
      "pin-round",
      "axle-cross",
      "axle-round",
    ],
    connections = (Array.isArray(document.connections)
      ? document.connections
      : []
    ).flatMap((rawConnection, connectionIndex) => {
      const connection = rawConnection as Partial<SavedConnection>,
        a = typeof connection.a === "string" ? piecesById.get(connection.a) : undefined,
        b = typeof connection.b === "string" ? piecesById.get(connection.b) : undefined,
        socketIndex = Math.trunc(finiteNumber(connection.socketIndex, -1)),
        shaftIndex = Math.trunc(finiteNumber(connection.shaftIndex, -1));
      if (
        !a ||
        !b ||
        a === b ||
        socketIndex < 0 ||
        shaftIndex < 0 ||
        socketIndex >= a.connectors.length ||
        shaftIndex >= b.connectors.length ||
        a.connectors[socketIndex].role !== "socket" ||
        b.connectors[shaftIndex].role !== "shaft"
      )
        return [];
      const saved: SavedConnection = {
        id:
          typeof connection.id === "string" && connection.id
            ? connection.id
            : `connection-${connectionIndex + 1}`,
        a: a.id,
        b: b.id,
        socketIndex,
        shaftIndex,
        mode: connectionModes.includes(connection.mode as SavedConnection["mode"])
          ? (connection.mode as SavedConnection["mode"])
          : "fixed",
        profile: connectionProfiles.includes(
          connection.profile as SavedConnection["profile"],
        )
          ? (connection.profile as SavedConnection["profile"])
          : "pin-round",
        point: finiteTuple3(connection.point),
        axis: unitTuple3(connection.axis),
        localAxisA: unitTuple3(connection.localAxisA),
        travel: positiveNumber(connection.travel, 0.5, 0.01),
        motorSpeed: finiteNumber(connection.motorSpeed, 0),
        motorForce: Math.max(0, finiteNumber(connection.motorForce, 30)),
        userConfigured: connection.userConfigured === true,
        forced: connection.forced === true,
        forcedOffset:
          connection.forcedOffset === undefined
            ? undefined
            : Math.max(0, finiteNumber(connection.forcedOffset, 0)),
        localPointA: optionalTuple3(connection.localPointA),
        localPointB: optionalTuple3(connection.localPointB),
      };
      return [saved];
    }),
    gearLinks = (Array.isArray(document.gearLinks)
      ? document.gearLinks
      : []
    ).flatMap((rawLink) => {
      const link = rawLink as Partial<SavedGearLink>,
        a = typeof link.a === "string" ? piecesById.get(link.a) : undefined,
        b = typeof link.b === "string" ? piecesById.get(link.b) : undefined;
      if (!a || !b || a === b) return [];
      const sanitizeSpec = (
        spec: SavedGearLink["specA"] | undefined,
      ) => ({
        teeth: Math.max(1, Math.trunc(finiteNumber(spec?.teeth, 1))),
        kind: typeof spec?.kind === "string" ? spec.kind : "spur",
        pitchRadius: positiveNumber(spec?.pitchRadius, 0.5, 0.01),
      });
      return [
        {
          a: a.id,
          b: b.id,
          specA: sanitizeSpec(link.specA),
          specB: sanitizeSpec(link.specB),
          centerA: finiteTuple3(link.centerA),
          centerB: finiteTuple3(link.centerB),
          poseAxisA: unitTuple3(link.poseAxisA),
          poseAxisB: unitTuple3(link.poseAxisB),
          axisA: unitTuple3(link.axisA),
          axisB: unitTuple3(link.axisB),
          ratio: finiteNumber(link.ratio, -1),
          centerDistance: Math.max(0, finiteNumber(link.centerDistance, 0)),
          expectedDistance: Math.max(
            0,
            finiteNumber(link.expectedDistance, 0),
          ),
          distanceError: Math.max(0, finiteNumber(link.distanceError, 0)),
          signB: finiteNumber(link.signB, 1) < 0 ? -1 : 1,
          perpendicular: link.perpendicular === true,
        } satisfies SavedGearLink,
      ];
    }),
    physics = Object.fromEntries(
      Object.entries(
        document.settings?.physics && typeof document.settings.physics === "object"
          ? document.settings.physics
          : {},
      ).flatMap(([key, value]) =>
        typeof value === "number" && Number.isFinite(value) && value >= 0
          ? [[key, value]]
          : [],
      ),
    );
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id:
      typeof document.id === "string" && document.id
        ? document.id
        : `project-${Date.now()}`,
    name:
      typeof document.name === "string" && document.name.trim()
        ? document.name.slice(0, 100)
        : "Untitled mechanism",
    createdAt: validDate(document.createdAt, now),
    updatedAt: validDate(document.updatedAt, now),
    appVersion:
      typeof document.appVersion === "string" ? document.appVersion : "0.4",
    revision:
      document.revision === undefined
        ? undefined
        : Math.max(0, Math.trunc(finiteNumber(document.revision, 0))),
    savedRevision:
      document.savedRevision === undefined
        ? undefined
        : document.savedRevision === null
        ? null
        : Math.max(0, Math.trunc(finiteNumber(document.savedRevision, 0))),
    assets:
      document.assets && typeof document.assets === "object"
        ? document.assets
        : {},
    pieces,
    connections,
    gearLinks,
    importedCatalog: Array.isArray(document.importedCatalog)
      ? document.importedCatalog.filter(
          (catalog): catalog is JsonObject =>
            !!catalog && typeof catalog === "object" && !Array.isArray(catalog),
        )
      : [],
    camera: {
      position: finiteTuple3(document.camera?.position, [6, 5, 8]),
      quaternion: unitQuaternion(document.camera?.quaternion),
      target: finiteTuple3(document.camera?.target),
    },
    settings: {
      gridStep: [0, 0.25, 0.5, 1].includes(
        finiteNumber(document.settings?.gridStep, 0.25),
      )
        ? finiteNumber(document.settings?.gridStep, 0.25)
        : 0.25,
      axleSnapStep: [0, 0.0625, 0.125, 0.25].includes(
        finiteNumber(document.settings?.axleSnapStep, 0.25),
      )
        ? finiteNumber(document.settings?.axleSnapStep, 0.25)
        : 0.25,
      rotationSnapStep: [0, 11.25, 22.5, 45].includes(
        finiteNumber(document.settings?.rotationSnapStep, 45),
      )
        ? finiteNumber(document.settings?.rotationSnapStep, 45)
        : 45,
      structuralMode:
        document.settings?.structuralMode === "flexible" ? "flexible" : "rigid",
      structuralStiffness: Math.min(
        100,
        Math.max(1, finiteNumber(document.settings?.structuralStiffness, 85)),
      ),
      physics,
    },
  };
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
  return sanitizeProjectDocument(document);
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
  const validated = validateProjectDocument(document);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [META_STORE, DOCUMENT_STORE],
      "readwrite",
    );
    transaction.objectStore(META_STORE).put(projectSummary(validated));
    transaction.objectStore(DOCUMENT_STORE).put({
      id: validated.id,
      document: validated,
    });
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
  const validated = validateProjectDocument(document);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(RECOVERY_STORE, "readwrite");
    transaction.objectStore(RECOVERY_STORE).put({
      key: "latest",
      updatedAt: validated.updatedAt,
      document: validated,
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
