import type { ScreeningRecord } from "./types";

/**
 * Union-find "Ring" clustering — groups candidates connected by any of the
 * three same-signal match edges (duplicateMatchId, historyAlertMatchId,
 * nameMatchId). A single candidate can be pairwise-matched to several
 * others across these three independent features; without clustering, a
 * recruiter only ever sees "this candidate matches THAT one," never the
 * full ring of everyone who's actually the same person/content across a
 * chain of pairwise matches. Only clusters with 2+ members are surfaced —
 * a lone candidate with no matches isn't a "ring" of one.
 *
 * Labels are stable across renders for the same input set: "Ring N" is
 * assigned by sorting clusters by their lowest member id ascending, so the
 * same group of candidates always gets the same number regardless of
 * fetch/array order. Colors cycle through an 8-color palette by that same
 * ordering.
 */

export interface MatchCluster {
  /** 1-based, assigned by ascending lowest-member-id — stable across renders. */
  index: number;
  label: string;
  color: string;
  memberIds: number[];
  size: number;
}

const CLUSTER_COLORS = [
  "#f43f5e", // rose
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
];

class UnionFind {
  private parent = new Map<number, number>();

  find(x: number): number {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // Path compression
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: number, b: number) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }
}

/**
 * Builds match clusters from a set of screening records and returns a map
 * from screeningId -> its cluster, for every screening whose cluster has
 * 2+ members. Only unions candidates that are BOTH present in `records` —
 * a match pointing at a screening id outside the current list (e.g. a
 * cross-team edge case, or the list is a filtered subset) is silently
 * ignored rather than producing a dangling one-sided edge.
 */
export function computeMatchClusters(records: ScreeningRecord[]): Map<number, MatchCluster> {
  const idsInSet = new Set(records.map((r) => r.id));
  const uf = new UnionFind();

  for (const r of records) {
    uf.find(r.id); // ensure every candidate has a root, even with no matches
    const edges = [r.duplicateMatchId, r.historyAlertMatchId, r.nameMatchId];
    for (const otherId of edges) {
      if (otherId != null && idsInSet.has(otherId)) {
        uf.union(r.id, otherId);
      }
    }
  }

  // Group by root
  const groups = new Map<number, number[]>();
  for (const r of records) {
    const root = uf.find(r.id);
    const list = groups.get(root);
    if (list) list.push(r.id);
    else groups.set(root, [r.id]);
  }

  // Only clusters with 2+ members count as a "ring"
  const clusters = Array.from(groups.values())
    .filter((members) => members.length >= 2)
    .map((members) => members.slice().sort((a, b) => a - b));

  // Stable ordering: by lowest member id ascending
  clusters.sort((a, b) => a[0] - b[0]);

  const result = new Map<number, MatchCluster>();
  clusters.forEach((members, i) => {
    const cluster: MatchCluster = {
      index: i + 1,
      label: `Ring ${i + 1}`,
      color: CLUSTER_COLORS[i % CLUSTER_COLORS.length],
      memberIds: members,
      size: members.length,
    };
    for (const id of members) result.set(id, cluster);
  });

  return result;
}
