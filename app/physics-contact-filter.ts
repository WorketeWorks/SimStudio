export type ContactPiece = { id: number };
export type ContactConnection<T extends ContactPiece> = { a: T; b: T };
export type ContactTraversal<T extends ContactPiece> = {
  shaft: T;
  host: T;
};

export const contactPairKey = (a: ContactPiece, b: ContactPiece) =>
  a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;

/**
 * A connection's `b` piece owns the shaft (pin/axle). Its colliders must not
 * hit any member of the rigid host island traversed by that shaft. The rule is
 * deliberately not propagated through mobile joints to other islands.
 */
export function buildConnectorContactExclusions<T extends ContactPiece>(
  connections: ContactConnection<T>[],
  rigidIslandByPiece: Map<T, T[]>,
  traversals: ContactTraversal<T>[] = [],
) {
  const excludedPairs = new Set<string>();
  const shaftHosts: ContactTraversal<T>[] = [
    ...connections.map((connection) => ({
      shaft: connection.b,
      host: connection.a,
    })),
    ...traversals,
  ];
  for (const { shaft: shaftPiece, host } of shaftHosts) {
    const hostIsland = rigidIslandByPiece.get(host) ?? [host];
    for (const hostPiece of hostIsland)
      if (hostPiece !== shaftPiece)
        excludedPairs.add(contactPairKey(shaftPiece, hostPiece));
  }
  return excludedPairs;
}
