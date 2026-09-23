/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDesktopDaemonStatus, type DesktopDaemonStatus } from "@/desktop/daemon/desktop-daemon";
import {
  DEFAULT_DESKTOP_SETTINGS,
  DESKTOP_SETTINGS_QUERY_KEY,
  loadDesktopSettings,
  type DesktopSettings,
} from "@/desktop/settings/desktop-settings";
import { useLocalDaemonServerIdState } from "./use-is-local-daemon";

vi.mock("@/desktop/daemon/desktop-daemon", () => ({
  shouldUseDesktopDaemon: () => true,
  getDesktopDaemonStatus: vi.fn(),
}));
vi.mock("@/desktop/settings/desktop-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/desktop/settings/desktop-settings")>()),
  loadDesktopSettings: vi.fn(),
}));

const getDesktopDaemonStatusMock = vi.mocked(getDesktopDaemonStatus);
const loadDesktopSettingsMock = vi.mocked(loadDesktopSettings);

function settingsWith(manageBuiltInDaemon: boolean): DesktopSettings {
  return {
    ...DEFAULT_DESKTOP_SETTINGS,
    daemon: { ...DEFAULT_DESKTOP_SETTINGS.daemon, manageBuiltInDaemon },
  };
}

function stoppedDaemonStatus(): DesktopDaemonStatus {
  return {
    serverId: "",
    status: "stopped",
    listen: null,
    hostname: null,
    pid: null,
    home: "/home/user/.paseo",
    version: null,
    desktopManaged: false,
    ownedByDesktop: false,
    startedAt: null,
    error: null,
  };
}

function renderWithClient(queryClient: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useLocalDaemonServerIdState(), { wrapper });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useLocalDaemonServerIdState polling", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient();
    getDesktopDaemonStatusMock.mockReset();
    getDesktopDaemonStatusMock.mockResolvedValue(stoppedDaemonStatus());
    loadDesktopSettingsMock.mockReset();
  });

  afterEach(() => {
    queryClient.clear();
    vi.useRealTimers();
  });

  it("probes once and resolves without a server id when the built-in daemon is not managed", async () => {
    loadDesktopSettingsMock.mockResolvedValue(settingsWith(false));

    const { result } = renderWithClient(queryClient);
    await advance(10_000);

    expect(getDesktopDaemonStatusMock).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ status: "resolved", serverId: null });
  });

  it("keeps polling every second while a managed daemon has no server id", async () => {
    loadDesktopSettingsMock.mockResolvedValue(settingsWith(true));

    renderWithClient(queryClient);
    await advance(500);
    const afterMount = getDesktopDaemonStatusMock.mock.calls.length;
    await advance(5_000);

    expect(getDesktopDaemonStatusMock.mock.calls.length - afterMount).toBe(5);
  });

  it("resumes polling when management is turned on and stops once the daemon reports a server id", async () => {
    loadDesktopSettingsMock.mockResolvedValue(settingsWith(false));

    const { result } = renderWithClient(queryClient);
    await advance(5_000);
    expect(getDesktopDaemonStatusMock).toHaveBeenCalledTimes(1);

    act(() => {
      queryClient.setQueryData(DESKTOP_SETTINGS_QUERY_KEY, settingsWith(true));
    });
    await advance(2_500);
    expect(getDesktopDaemonStatusMock).toHaveBeenCalledTimes(3);

    getDesktopDaemonStatusMock.mockResolvedValue({
      ...stoppedDaemonStatus(),
      serverId: "local-server",
    });
    await advance(1_500);
    expect(result.current).toEqual({ status: "resolved", serverId: "local-server" });

    const callsAtResolution = getDesktopDaemonStatusMock.mock.calls.length;
    await advance(5_000);
    expect(getDesktopDaemonStatusMock.mock.calls.length).toBe(callsAtResolution);
  });
});
