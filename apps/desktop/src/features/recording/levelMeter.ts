// Live level meter (SPEC.md > Audio recording, added 2026-09-30,
// user-requested). Pure functions only -- RecordingWaveform.tsx owns the
// event subscription, the mutable ring buffer, and canvas sizing/DPR; this
// file is just the math and the actual drawing, kept separate so both can
// be pinned with plain values instead of fighting jsdom's lack of real
// canvas support (see popoverPlacement.ts from the notes feature for the
// same split).

// ~3s of history at one sample per 50ms mixer tick (recording.rs's
// MIX_TICK) -- long enough to read as a moving waveform, short enough to
// stay a compact status-bar element.
export const LEVEL_HISTORY = 60;

export const METER_WIDTH = 180;
export const METER_HEIGHT = 18;
const BAR_WIDTH = 2;
const BAR_GAP = 1;
const MIN_BAR_HEIGHT = 1;

// recording.rs sends a LINEAR peak (0..1), but normal speech only peaks
// around 0.05-0.3 linear -- a linear scale would render as barely-visible
// slivers and defeat the feature's actual purpose (confirming sound is
// picked up). Real audio meters read in dBFS for exactly this reason: a
// logarithmic mapping gives normal speech levels most of the visual range.
// -60 dBFS (near silence) maps to 0, 0 dBFS (full scale) maps to 1.
const DBFS_FLOOR = -60;

export function levelToFraction(peak: number): number {
  if (!Number.isFinite(peak) || peak <= 0) return 0;
  const dbfs = 20 * Math.log10(Math.min(peak, 1));
  return Math.max(0, Math.min(1, (dbfs - DBFS_FLOOR) / -DBFS_FLOOR));
}

// Mutates `levels` in place (append, then drop the oldest past the cap) --
// deliberately, since the caller holds this buffer in a ref and redraws up
// to 20 times a second; allocating a new array every tick would be pure
// waste for a value nothing else ever needs to see as immutable.
export function pushLevel(levels: number[], peak: number): void {
  levels.push(levelToFraction(peak));
  if (levels.length > LEVEL_HISTORY) {
    levels.splice(0, levels.length - LEVEL_HISTORY);
  }
}

// Bars mirrored around the vertical midline, oldest on the left (index 0)
// and newest on the right, matching how `pushLevel` appends -- read the
// same direction as a stock ticker or an oscilloscope. A silent tick still
// draws a MIN_BAR_HEIGHT sliver rather than nothing, so "the stream is
// alive but silent" (e.g. a denied macOS system-audio permission) reads as
// a flat line, not an empty canvas that looks broken.
export function drawLevels(ctx: CanvasRenderingContext2D, levels: number[], color: string): void {
  ctx.clearRect(0, 0, METER_WIDTH, METER_HEIGHT);
  ctx.fillStyle = color;
  const mid = METER_HEIGHT / 2;
  levels.forEach((fraction, i) => {
    const barHeight = Math.max(MIN_BAR_HEIGHT, fraction * METER_HEIGHT);
    const x = i * (BAR_WIDTH + BAR_GAP);
    ctx.fillRect(x, mid - barHeight / 2, BAR_WIDTH, barHeight);
  });
}
