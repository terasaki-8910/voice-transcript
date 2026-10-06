// Audio recording (SPEC.md > Audio recording). Owns the
// start/stop/elapsed-time state shared between the sidebar's Record control
// (Sidebar.tsx) and the persistent active-recording bar (QueueView.tsx) --
// two different places in the tree need the same state, hence a Context
// rather than local component state (same reasoning as NavContext/
// SelectionContext elsewhere in this codebase).
//
// All actual capture happens in Rust (recording.rs, cpal -> hound WAV); this
// context only calls start_recording/stop_recording, pushes source changes
// made in Settings during a recording to set_recording_source, and, on a successful
// stop, hands the finished file's path to the existing queue (addFiles,
// tagged "recording" so App.tsx's AppShell can auto-trash it once its
// transcription succeeds -- see VoiceInputSettingsContext's
// autoTrashRecordings) -- a finished recording otherwise enters the
// pipeline exactly like a picked file, no special-casing downstream. The
// elapsed-time display is a plain client-side timer, not driven by a
// Rust-pushed event -- recording.rs does now push one small derived
// number per 50ms tick (the live level meter, RecordingWaveform.tsx), but
// that's a one-way, throw-away-if-unlistened stream, not state this
// context needs to hold.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  RECORDING_AUTO_STOPPED_EVENT,
  RECORDING_SOURCE_SILENCE_EVENT,
  setRecordingSource,
  startRecording,
  stopRecording,
} from "../../lib/tauri";
import type {
  RecordingResult,
  RecordingSourceOptions,
  SourceSilenceEvent,
  StartRecordingOptions,
} from "../../lib/tauri";
import { useQueue } from "../queue/QueueContext";
import { useVoiceInputSettings } from "../preferences/VoiceInputSettingsContext";

export type RecordingStatus = "idle" | "recording" | "stopping";

interface RecordingContextValue {
  status: RecordingStatus;
  elapsedSeconds: number;
  error?: string;
  // Sources that were captured but delivered only digital silence. Kept
  // separate from `error`: the file is real and already queued, so this is a
  // "check your permissions" note, not a failure.
  silentSources?: string[];
  // System audio that has gone quiet while this recording is still running
  // (cleared when it is audible again). Lets the user catch a dropped capture
  // before the recording ends.
  liveSilentSources: string[];
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const RecordingContext = createContext<RecordingContextValue | null>(null);

// Tauri's listen() rejects outright in jsdom and other environments without
// the native bridge -- nothing to subscribe to there, not a real failure.
function subscribe<T = void>(event: string, handler: (payload: T) => void): () => void {
  let cancelled = false;
  let unlisten: (() => void) | undefined;
  listen<T>(event, (e) => handler(e.payload))
    .then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    })
    .catch(() => {
      /* no native bridge */
    });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

function sameSource(a: RecordingSourceOptions, b: RecordingSourceOptions): boolean {
  return a.source === b.source && a.deviceId === b.deviceId && a.outputDeviceId === b.outputDeviceId;
}

export interface RecordingProviderProps {
  children: ReactNode;
  // Injectable for tests -- default to the real Tauri-backed functions.
  startRecordingFn?: (options: StartRecordingOptions) => Promise<void>;
  stopRecordingFn?: () => Promise<RecordingResult>;
  setRecordingSourceFn?: (options: RecordingSourceOptions) => Promise<void>;
}

export function RecordingProvider({
  children,
  startRecordingFn = startRecording,
  stopRecordingFn = stopRecording,
  setRecordingSourceFn = setRecordingSource,
}: RecordingProviderProps) {
  const { addFiles } = useQueue();
  const { audioSource, micDeviceId, outputDeviceId, autoStopSilenceMinutes } = useVoiceInputSettings();
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string>();
  const [silentSources, setSilentSources] = useState<string[]>();
  const [liveSilentSources, setLiveSilentSources] = useState<string[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  // What the live capture is actually running on. Only updated once a start or
  // switch succeeds, so a failed switch leaves the next settings change to retry.
  const appliedSource = useRef<RecordingSourceOptions | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (status !== "recording") return;
    const wanted: RecordingSourceOptions = { source: audioSource, deviceId: micDeviceId, outputDeviceId };
    if (appliedSource.current && sameSource(appliedSource.current, wanted)) return;
    setRecordingSourceFn(wanted).then(
      () => {
        appliedSource.current = wanted;
        setError(undefined);
      },
      (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
    );
  }, [status, audioSource, micDeviceId, outputDeviceId, setRecordingSourceFn]);

  const start = async () => {
    setError(undefined);
    setSilentSources(undefined);
    setLiveSilentSources([]);
    try {
      const options: StartRecordingOptions = {
        source: audioSource,
        deviceId: micDeviceId,
        outputDeviceId,
        silenceTimeoutSeconds: autoStopSilenceMinutes > 0 ? autoStopSilenceMinutes * 60 : undefined,
      };
      await startRecordingFn(options);
      appliedSource.current = options;
      setElapsedSeconds(0);
      setStatus("recording");
      intervalRef.current = setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const stop = async () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = undefined;
    }
    setStatus("stopping");
    appliedSource.current = undefined;
    setLiveSilentSources([]);
    try {
      const result = await stopRecordingFn();
      addFiles([result.path], "recording");
      setSilentSources(result.silentSources?.length ? result.silentSources : undefined);
      setStatus("idle");
      setElapsedSeconds(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("idle");
    }
  };

  // The mixer can end a recording on its own (silence timeout); finishing it
  // goes through the same stop() as the button. The ref keeps the listener
  // calling the latest stop() without re-subscribing on every render.
  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  });

  useEffect(() => {
    if (status !== "recording") return;
    const offStopped = subscribe(RECORDING_AUTO_STOPPED_EVENT, () => void stopRef.current());
    const offSilence = subscribe<SourceSilenceEvent>(RECORDING_SOURCE_SILENCE_EVENT, ({ label, silent }) => {
      setLiveSilentSources((prev) => {
        if (!silent) return prev.filter((name) => name !== label);
        return prev.includes(label) ? prev : [...prev, label];
      });
    });
    return () => {
      offStopped();
      offSilence();
    };
  }, [status]);

  // Not wrapped in useMemo: start/stop close over micDeviceId/addFiles,
  // which change independently of status/elapsedSeconds/error -- memoizing
  // against the wrong dep list would silently hand out a stale closure
  // (e.g. a start() still using a mic the user just switched away from in
  // Settings). This context isn't a hot re-render path, so there's no real
  // cost to skipping memoization here.
  const value: RecordingContextValue = {
    status,
    elapsedSeconds,
    error,
    silentSources,
    liveSilentSources,
    start,
    stop,
  };

  return <RecordingContext.Provider value={value}>{children}</RecordingContext.Provider>;
}

export function useRecording(): RecordingContextValue {
  const ctx = useContext(RecordingContext);
  if (!ctx) {
    throw new Error("useRecording must be used within a RecordingProvider");
  }
  return ctx;
}
