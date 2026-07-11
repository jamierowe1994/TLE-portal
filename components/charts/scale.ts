// Shared chart internals for the hand-rolled SVG charts (PRESENT+CHARTS lane).

export const CHART_COLORS = ["#E31F36", "#101014", "#6B6B76", "#41AAE1"];

export const CHART_INK = "#101014";
export const CHART_MUTED = "#6B6B76";
export const CHART_GRID = "#E7E7EC";

export interface ChartSeries {
  name: string;
  color?: string;
  values: (number | null)[];
}

export function seriesColor(s: ChartSeries, i: number): string {
  return s.color ?? CHART_COLORS[i % CHART_COLORS.length];
}

/** A "nice" max + gridline values (3–4 lines incl. zero baseline). */
export function niceTicks(maxValue: number, count = 4): number[] {
  const max = maxValue <= 0 ? 1 : maxValue;
  const rawStep = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  const step = niceNorm * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

export function maxOfSeries(series: ChartSeries[]): number {
  let max = 0;
  for (const s of series) {
    for (const v of s.values) {
      if (v != null && v > max) max = v;
    }
  }
  return max;
}

export function defaultFormat(n: number): string {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(n);
}
