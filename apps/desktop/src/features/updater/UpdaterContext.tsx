// In-app updates (SPEC.md > In-app updates). Checks this repo's latest
// GitHub release once at launch and again whenever the user asks from
// Settings > General. The launch check stays silent when nothing is new,
// when the check itself fails (offline, GitHub unreachable -- the next
// launch or a manual check retries), and for the one version the user chose
// to skip; a manual check always reports what it found.
//
// checkFn/relaunchFn/getVersionFn are injectable so tests never reach the
// real Tauri bridge, same pattern as QueueProvider's transcribeFn.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { checkForUpdate, getAppVersion, relaunchApp } from "../../lib/tauri";
import type { AvailableUpdate } from "../../lib/tauri";
import { readSkippedVersion, shouldPromptOnLaunch, writeSkippedVersion } from "./skippedVersion";

export type CheckStatus = "idle" | "checking" | "upToDate" | "failed";
export type InstallStatus = "idle" | "installing" | "failed";

interface UpdaterContextValue {
  currentVersion: string | null;
  update: AvailableUpdate | null;
  dialogOpen: boolean;
  checkStatus: CheckStatus;
  checkError?: string;
  installStatus: InstallStatus;
  installError?: string;
  // Whole-number download percentage; null while the size is unknown.
  percent: number | null;
  checkNow: () => Promise<void>;
  openDialog: () => void;
  later: () => void;
  skipVersion: () => void;
  installNow: () => Promise<void>;
}

const UpdaterContext = createContext<UpdaterContextValue | null>(null);

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function UpdaterProvider({
  children,
  checkFn = checkForUpdate,
  relaunchFn = relaunchApp,
  getVersionFn = getAppVersion,
  checkOnLaunch = true,
}: {
  children: ReactNode;
  checkFn?: () => Promise<AvailableUpdate | null>;
  relaunchFn?: () => Promise<void>;
  getVersionFn?: () => Promise<string>;
  checkOnLaunch?: boolean;
}) {
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [checkStatus, setCheckStatus] = useState<CheckStatus>("idle");
  const [checkError, setCheckError] = useState<string>();
  const [installStatus, setInstallStatus] = useState<InstallStatus>("idle");
  const [installError, setInstallError] = useState<string>();
  const [percent, setPercent] = useState<number | null>(null);

  useEffect(() => {
    getVersionFn()
      .then(setCurrentVersion)
      .catch(() => {});
  }, [getVersionFn]);

  // StrictMode runs mount effects twice in development; the ref keeps that
  // to one request.
  const launchCheckedRef = useRef(false);
  useEffect(() => {
    if (!checkOnLaunch || launchCheckedRef.current) return;
    launchCheckedRef.current = true;
    checkFn()
      .then((found) => {
        if (!found) return;
        setUpdate(found);
        if (shouldPromptOnLaunch(found.version, readSkippedVersion())) setDialogOpen(true);
      })
      .catch(() => {});
  }, [checkFn, checkOnLaunch]);

  const checkNow = useCallback(async () => {
    setCheckStatus("checking");
    setCheckError(undefined);
    try {
      const found = await checkFn();
      setUpdate(found);
      if (found) {
        setCheckStatus("idle");
        setDialogOpen(true);
      } else {
        setCheckStatus("upToDate");
      }
    } catch (err) {
      setCheckStatus("failed");
      setCheckError(errorMessage(err));
    }
  }, [checkFn]);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setInstallStatus("idle");
    setInstallError(undefined);
  }, []);

  const skipVersion = useCallback(() => {
    if (update) writeSkippedVersion(update.version);
    closeDialog();
  }, [update, closeDialog]);

  const installNow = useCallback(async () => {
    if (!update) return;
    setInstallStatus("installing");
    setInstallError(undefined);
    setPercent(null);
    try {
      await update.install((downloaded, total) => {
        // Per-chunk callbacks; a whole-number percent keeps re-renders to
        // ~100 for the whole download.
        setPercent(total ? Math.min(100, Math.floor((downloaded / total) * 100)) : null);
      });
      await relaunchFn();
    } catch (err) {
      setInstallStatus("failed");
      setInstallError(errorMessage(err));
    }
  }, [update, relaunchFn]);

  const openDialog = useCallback(() => setDialogOpen(true), []);

  const value = useMemo<UpdaterContextValue>(
    () => ({
      currentVersion,
      update,
      dialogOpen,
      checkStatus,
      checkError,
      installStatus,
      installError,
      percent,
      checkNow,
      openDialog,
      later: closeDialog,
      skipVersion,
      installNow,
    }),
    [
      currentVersion,
      update,
      dialogOpen,
      checkStatus,
      checkError,
      installStatus,
      installError,
      percent,
      checkNow,
      openDialog,
      closeDialog,
      skipVersion,
      installNow,
    ],
  );

  return <UpdaterContext.Provider value={value}>{children}</UpdaterContext.Provider>;
}

export function useUpdater(): UpdaterContextValue {
  const ctx = useContext(UpdaterContext);
  if (!ctx) {
    throw new Error("useUpdater must be used within an UpdaterProvider");
  }
  return ctx;
}
