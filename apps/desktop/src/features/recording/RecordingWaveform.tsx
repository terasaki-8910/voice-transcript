// Live level meter (SPEC.md > Audio recording, added 2026-09-30,
// user-requested): a small scrolling bar meter confirming audio is
// actually being captured. Mounted only while QueueView.tsx's RecordingBar
// is showing, i.e. only while a recording is active -- no separate status
// check needed in here. Wrapped in memo with no props: RecordingBar
// re-renders every second for the elapsed-time display, and this
// component must not restart/re-subscribe on that -- it owns its own
// listen() subscription (started on mount, torn down on unmount, same
// cancelled-flag pattern as useDragDrop.ts for "unmounted before the
// listen() promise resolves") and writes into a ref-held ring buffer,
// never React state, since the underlying event fires up to 20 times a
// second -- state at that rate would mean 20 re-renders/sec for a value
// only a canvas ever reads. Draws are batched to one requestAnimationFrame
// per incoming burst rather than one per event.
import { memo, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { RECORDING_LEVEL_EVENT } from "../../lib/tauri";
import { pushLevel, drawLevels, METER_WIDTH, METER_HEIGHT } from "./levelMeter";

function RecordingWaveformImpl() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelsRef = useRef<number[]>([]);
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const canvas = canvasRef.current;
    // Backing-store resolution is set imperatively here, once, rather than
    // via JSX width/height attributes -- React re-applying those on every
    // render would clear the bitmap. Scaling the context by the device
    // pixel ratio lets drawLevels keep working in plain CSS-pixel
    // coordinates (METER_WIDTH/METER_HEIGHT) while still rendering sharp
    // on a high-DPI display; the CSS size (queue.css) is set to the same
    // logical dimensions independently of this backing-store size.
    if (canvas) {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = METER_WIDTH * dpr;
      canvas.height = METER_HEIGHT * dpr;
      canvas.getContext("2d")?.scale(dpr, dpr);
    }

    const draw = () => {
      frameRef.current = undefined;
      const el = canvasRef.current;
      const ctx = el?.getContext("2d");
      if (!el || !ctx) return;
      // Color comes from CSS (color: var(--color-danger) in queue.css),
      // read here rather than hardcoded, both to respect this repo's
      // tokens-only-colors lint (which scans raw .ts/.tsx text) and so the
      // meter follows a live theme toggle mid-recording.
      drawLevels(ctx, levelsRef.current, getComputedStyle(el).color);
    };

    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<number>(RECORDING_LEVEL_EVENT, (event) => {
      if (cancelled) return;
      pushLevel(levelsRef.current, event.payload);
      if (frameRef.current === undefined) {
        frameRef.current = requestAnimationFrame(draw);
      }
    })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {
        // jsdom/no-Tauri-bridge environments reject listen() outright --
        // nothing to subscribe to in that case, not a real failure.
      });

    return () => {
      cancelled = true;
      unlisten?.();
      if (frameRef.current !== undefined) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  return <canvas ref={canvasRef} className="recording-waveform" aria-hidden="true" />;
}

// aria-hidden matches .recording-dot's own decorative role, and a canvas
// redraw never changes any text -- the parent bar's role="status" region
// has nothing new to announce on every tick.
export const RecordingWaveform = memo(RecordingWaveformImpl);
