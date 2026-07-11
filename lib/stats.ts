// Stat resolution — precedence: live → manual → snapshot.
// Every figure shown in the UI is a StatValue so the SourceBadge can tag it.
// Pure, client-safe.

import type { StatSource, StatValue } from "@/lib/types";

export interface ManualOverride {
  value: number;
  note?: string;
}

/**
 * First non-null wins, in order live → manual → snapshot, carrying the right
 * source + note. `liveSource` defaults to "live-rex"; pass "live-meta" for
 * Meta-fed figures.
 */
export function resolveStat(
  live: number | null | undefined,
  manual: ManualOverride | null | undefined,
  snapshot: StatValue | null | undefined,
  liveSource: StatSource = "live-rex"
): StatValue {
  if (live != null && !Number.isNaN(live)) {
    return {
      value: live,
      source: liveSource,
      asOf: new Date().toISOString().slice(0, 10),
    };
  }
  if (manual != null && manual.value != null && !Number.isNaN(manual.value)) {
    return {
      value: manual.value,
      source: "manual",
      note: manual.note,
    };
  }
  if (snapshot != null) {
    // Snapshot StatValues arrive pre-tagged (source/note/asOf) — pass through.
    return snapshot;
  }
  return { value: null, source: "snapshot" };
}

/** Percentage 0..100 (not clamped) — null when it can't be computed. */
export function pct(
  numerator: number | null | undefined,
  denominator: number | null | undefined
): number | null {
  if (numerator == null || denominator == null) return null;
  if (Number.isNaN(numerator) || Number.isNaN(denominator)) return null;
  if (denominator === 0) return null;
  return (numerator / denominator) * 100;
}
