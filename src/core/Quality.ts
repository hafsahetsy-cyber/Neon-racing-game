export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySettings {
  label: string;
  /** Upper bound for renderer pixel ratio (multiplied against device pixel ratio). */
  maxPixelRatio: number;
  /** Fraction of device pixel ratio to render at. */
  resolutionScale: number;
  msaa: number;
  bloom: boolean;
  /** Radial blur taps. 1 disables the blur/aberration/distortion pass entirely. */
  warpSamples: number;
  grain: boolean;
  /** Multiplier for particle counts, speed lines, etc. */
  particles: number;
  /** Number of background skyline towers. */
  skyline: number;
}

export const QUALITY: Record<QualityLevel, QualitySettings> = {
  low: {
    label: 'LOW', maxPixelRatio: 1, resolutionScale: 0.7, msaa: 0, bloom: false,
    warpSamples: 1, grain: false, particles: 0.35, skyline: 90,
  },
  medium: {
    label: 'MEDIUM', maxPixelRatio: 1, resolutionScale: 1, msaa: 0, bloom: true,
    warpSamples: 6, grain: true, particles: 0.7, skyline: 180,
  },
  high: {
    label: 'HIGH', maxPixelRatio: 1.5, resolutionScale: 1, msaa: 4, bloom: true,
    warpSamples: 10, grain: true, particles: 1, skyline: 300,
  },
  ultra: {
    label: 'ULTRA', maxPixelRatio: 2, resolutionScale: 1, msaa: 4, bloom: true,
    warpSamples: 16, grain: true, particles: 1.5, skyline: 420,
  },
};

export const QUALITY_ORDER: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

const KEY = 'neoncruise.quality';

export function loadQuality(): QualityLevel {
  const saved = localStorage.getItem(KEY) as QualityLevel | null;
  if (saved && saved in QUALITY) return saved;
  // Cheap heuristic: phones and low-core machines start lower.
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  if (mobile) return 'low';
  return cores >= 8 ? 'high' : 'medium';
}

export function saveQuality(q: QualityLevel) {
  localStorage.setItem(KEY, q);
}
