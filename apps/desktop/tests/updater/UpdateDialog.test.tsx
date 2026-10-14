// In-app updates (SPEC.md > In-app updates, ACCEPTANCE U1-U6). The real
// updater plugin is never reached: UpdaterProvider takes injectable
// checkFn/relaunchFn/getVersionFn, and each fake AvailableUpdate's install()
// is a vi.fn() the test drives. Unmounting and rendering a fresh provider
// stands in for quitting and relaunching the app -- the only state that
// survives is localStorage, same as in the real app.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { DisplayPreferencesProvider } from "../../src/features/preferences/DisplayPreferencesContext";
import { VoiceInputSettingsProvider } from "../../src/features/preferences/VoiceInputSettingsContext";
import { QueueProvider, useQueue } from "../../src/features/queue/QueueContext";
import { RecordingProvider } from "../../src/features/recording/RecordingContext";
import { PreferencesView } from "../../src/features/preferences/PreferencesView";
import { UpdaterProvider, useUpdater } from "../../src/features/updater/UpdaterContext";
import { UpdateDialog } from "../../src/features/updater/UpdateDialog";
import type { AvailableUpdate, TranscribeResponse } from "../../src/lib/tauri";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => []),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

type InstallFn = AvailableUpdate["install"];

function fakeUpdate(version: string, install: InstallFn = vi.fn(async () => {})): AvailableUpdate {
  return { version, currentVersion: "0.6.0", install };
}

function DialogHost() {
  const { dialogOpen } = useUpdater();
  return dialogOpen ? <UpdateDialog /> : null;
}

function AddFileButton() {
  const { addFiles } = useQueue();
  return (
    <button type="button" onClick={() => addFiles(["/audio/a.m4a"])}>
      add
    </button>
  );
}

function renderApp({
  checkFn,
  relaunchFn = vi.fn(async () => {}),
  transcribeFn = () => Promise.resolve<TranscribeResponse>({ text: "", rendered: "" }),
  withPreferences = false,
  onClosePreferences = vi.fn(),
}: {
  checkFn: () => Promise<AvailableUpdate | null>;
  relaunchFn?: () => Promise<void>;
  transcribeFn?: () => Promise<TranscribeResponse>;
  withPreferences?: boolean;
  onClosePreferences?: () => void;
}) {
  return render(
    <I18nProvider>
      <DisplayPreferencesProvider>
        <VoiceInputSettingsProvider>
          <QueueProvider transcribeFn={transcribeFn} subscribeProgressFn={async () => () => {}}>
            <RecordingProvider>
              <UpdaterProvider checkFn={checkFn} relaunchFn={relaunchFn} getVersionFn={async () => "0.6.0"}>
                <AddFileButton />
                {withPreferences && <PreferencesView onClose={onClosePreferences} />}
                <DialogHost />
              </UpdaterProvider>
            </RecordingProvider>
          </QueueProvider>
        </VoiceInputSettingsProvider>
      </DisplayPreferencesProvider>
    </I18nProvider>,
  );
}

async function openGeneralSettings() {
  fireEvent.click(await screen.findByRole("button", { name: "General" }));
}

beforeEach(() => {
  localStorage.clear();
});

describe("U1 - launch check prompts for a newer version", () => {
  it("shows the dialog with both versions when a newer release exists", async () => {
    renderApp({ checkFn: async () => fakeUpdate("0.6.1") });
    expect(await screen.findByRole("dialog", { name: "Update available" })).toBeDefined();
    expect(screen.getByText("Voice Transcript 0.6.1 is available. You have 0.6.0.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Update now" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Later" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Skip this version" })).toBeDefined();
  });

  it("stays silent when already up to date", async () => {
    const checkFn = vi.fn(async () => null);
    renderApp({ checkFn });
    await waitFor(() => expect(checkFn).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays silent when the check itself fails (offline)", async () => {
    const checkFn = vi.fn(async () => {
      throw new Error("error sending request");
    });
    renderApp({ checkFn });
    await waitFor(() => expect(checkFn).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/error sending request/)).toBeNull();
  });
});

describe("U2 - Later asks again on the next launch", () => {
  it("closes on Later, and a relaunch prompts for the same version again", async () => {
    const { unmount } = renderApp({ checkFn: async () => fakeUpdate("0.6.1") });
    fireEvent.click(await screen.findByRole("button", { name: "Later" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();

    renderApp({ checkFn: async () => fakeUpdate("0.6.1") });
    expect(await screen.findByRole("dialog", { name: "Update available" })).toBeDefined();
  });

  it("closes on Escape", async () => {
    renderApp({ checkFn: async () => fakeUpdate("0.6.1") });
    await screen.findByRole("dialog");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on a backdrop click, but not on a click inside the panel", async () => {
    renderApp({ checkFn: async () => fakeUpdate("0.6.1") });
    const overlay = await screen.findByRole("dialog");
    fireEvent.click(screen.getByText("Update available"));
    expect(screen.getByRole("dialog")).toBeDefined();
    fireEvent.click(overlay);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("U3 - Skip this version", () => {
  it("never prompts at launch for the skipped version, but does for a newer one", async () => {
    const first = renderApp({ checkFn: async () => fakeUpdate("0.6.1") });
    fireEvent.click(await screen.findByRole("button", { name: "Skip this version" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    first.unmount();

    const checkSame = vi.fn(async () => fakeUpdate("0.6.1"));
    const second = renderApp({ checkFn: checkSame });
    await waitFor(() => expect(checkSame).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    second.unmount();

    renderApp({ checkFn: async () => fakeUpdate("0.6.2") });
    expect(await screen.findByText("Voice Transcript 0.6.2 is available. You have 0.6.0.")).toBeDefined();
  });
});

describe("U4 - Update now installs, then relaunches", () => {
  it("reports download progress and relaunches once the install finishes", async () => {
    let finish: () => void = () => {};
    let report: (downloaded: number, total: number | undefined) => void = () => {};
    const install = vi.fn<InstallFn>(
      (onProgress) =>
        new Promise<void>((resolve) => {
          report = onProgress;
          finish = resolve;
        }),
    );
    const relaunchFn = vi.fn(async () => {});
    renderApp({ checkFn: async () => fakeUpdate("0.6.1", install), relaunchFn });

    fireEvent.click(await screen.findByRole("button", { name: "Update now" }));
    expect(install).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Downloading...")).toBeDefined();

    act(() => report(250, 1000));
    expect(screen.getByText("Downloading... 25%")).toBeDefined();
    act(() => report(1000, 1000));
    expect(screen.getByText("Installing...")).toBeDefined();
    expect(relaunchFn).not.toHaveBeenCalled();

    await act(async () => finish());
    expect(relaunchFn).toHaveBeenCalledTimes(1);
  });

  it("can't be dismissed while the update is downloading", async () => {
    const install = vi.fn<InstallFn>(() => new Promise<void>(() => {}));
    renderApp({ checkFn: async () => fakeUpdate("0.6.1", install) });
    fireEvent.click(await screen.findByRole("button", { name: "Update now" }));

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeDefined();
    expect((screen.getByRole("button", { name: "Later" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Skip this version" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows why an install failed and offers a retry, without relaunching", async () => {
    const install = vi
      .fn<InstallFn>()
      .mockRejectedValueOnce(new Error("signature verification failed"))
      .mockResolvedValueOnce(undefined);
    const relaunchFn = vi.fn(async () => {});
    renderApp({ checkFn: async () => fakeUpdate("0.6.1", install), relaunchFn });

    fireEvent.click(await screen.findByRole("button", { name: "Update now" }));
    expect(await screen.findByText("Couldn't install the update: signature verification failed")).toBeDefined();
    expect(relaunchFn).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(relaunchFn).toHaveBeenCalledTimes(1));
  });
});

describe("U5 - no restart while work is in progress", () => {
  it("disables Update now while a file is transcribing", async () => {
    renderApp({
      checkFn: async () => fakeUpdate("0.6.1"),
      transcribeFn: () => new Promise<TranscribeResponse>(() => {}),
    });
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByText("add"));

    await waitFor(() => expect((screen.getByRole("button", { name: "Update now" }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText("Finish the current transcription or recording first -- updating restarts the app.")).toBeDefined();
  });
});

describe("U6 - manual check from Settings > General", () => {
  it("shows the running version and reports when already up to date", async () => {
    const checkFn = vi.fn(async () => null);
    renderApp({ checkFn, withPreferences: true });
    await openGeneralSettings();
    expect(await screen.findByText("Version 0.6.0")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("You're on the latest version.")).toBeDefined();
    expect(checkFn).toHaveBeenCalledTimes(2); // launch + manual
  });

  it("reports a failed check instead of staying silent", async () => {
    const checkFn = vi
      .fn<() => Promise<AvailableUpdate | null>>()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("404 Not Found"));
    renderApp({ checkFn, withPreferences: true });
    await openGeneralSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("Couldn't check for updates: 404 Not Found")).toBeDefined();
  });

  it("shows a skipped version when asked, and Escape closes only the update dialog", async () => {
    localStorage.setItem("voice-transcript-skipped-update-version", "0.6.1");
    const onClosePreferences = vi.fn();
    renderApp({ checkFn: async () => fakeUpdate("0.6.1"), withPreferences: true, onClosePreferences });
    await openGeneralSettings();

    expect(await screen.findByText("Version 0.6.1 is available.")).toBeDefined();
    expect(screen.queryByRole("dialog", { name: "Update available" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show update" }));
    expect(await screen.findByRole("dialog", { name: "Update available" })).toBeDefined();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Update available" })).toBeNull();
    expect(onClosePreferences).not.toHaveBeenCalled();
  });
});
