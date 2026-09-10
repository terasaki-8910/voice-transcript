// Audio recording (SPEC.md > Audio recording). Owns the
// start/stop/elapsed-time state shared between the sidebar's Record control
// (Sidebar.tsx) and the persistent active-recording bar (QueueView.tsx) --
// two different places in the tree need the same state, hence a Context
// rather than local component state (same reasoning as NavContext/
// SelectionContext elsewhere in this codebase).
//
// All actual capture happens in Rust (recording.rs, cpal -> hound WAV); this
// context only calls start_recording/stop_recording and, on a successful
// stop, hands the finished file's path to the existing queue (addFiles) --
// a finished recording enters the pipeline exactly like a picked file, no
// special-casing downstream. The elapsed-time display is a plain
// client-side timer, not driven by a Rust-pushed event -- see recording.rs's
// doc comment on why no bytes/events cross that boundary during capture.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { startRecording, stopRecording } from "../../lib/tauri";
import type { RecordingResult, StartRecordingOptions } from "../../lib/tauri";
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
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const RecordingContext = createContext<RecordingContextValue | null>(null);

export interface RecordingProviderProps {
  children: ReactNode;
  // Injectable for tests -- default to the real Tauri-backed functions.
  startRecordingFn?: (options: StartRecordingOptions) => Promise<void>;
  stopRecordingFn?: () => Promise<RecordingResult>;
}

export function RecordingProvider({
  children,
  startRecordingFn = startRecording,
  stopRecordingFn = stopRecording,
}: RecordingProviderProps) {
  const { addFiles } = useQueue();
  const { audioSource, micDeviceId, outputDeviceId } = useVoiceInputSettings();
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string>();
  const [silentSources, setSilentSources] = useState<string[]>();
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const start = async () => {
    setError(undefined);
    setSilentSources(undefined);
    try {
      await startRecordingFn({ source: audioSource, deviceId: micDeviceId, outputDeviceId });
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
    try {
      const result = await stopRecordingFn();
      addFiles([result.path]);
      setSilentSources(result.silentSources?.length ? result.silentSources : undefined);
      setStatus("idle");
      setElapsedSeconds(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("idle");
    }
  };

  // Not wrapped in useMemo: start/stop close over micDeviceId/addFiles,
  // which change independently of status/elapsedSeconds/error -- memoizing
  // against the wrong dep list would silently hand out a stale closure
  // (e.g. a start() still using a mic the user just switched away from in
  // Settings). This context isn't a hot re-render path, so there's no real
  // cost to skipping memoization here.
  const value: RecordingContextValue = { status, elapsedSeconds, error, silentSources, start, stop };

  return <RecordingContext.Provider value={value}>{children}</RecordingContext.Provider>;
}

export function useRecording(): RecordingContextValue {
  const ctx = useContext(RecordingContext);
  if (!ctx) {
    throw new Error("useRecording must be used within a RecordingProvider");
  }
  return ctx;
}
