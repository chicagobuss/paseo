import { useQuery } from "@tanstack/react-query";
import { getDesktopDaemonStatus, shouldUseDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import {
  DEFAULT_DESKTOP_SETTINGS,
  DESKTOP_SETTINGS_QUERY_KEY,
  loadDesktopSettings,
  type DesktopSettings,
} from "@/desktop/settings/desktop-settings";

const DESKTOP_DAEMON_SERVER_ID_QUERY_KEY = ["desktop-daemon-server-id"] as const;
const LOCAL_DAEMON_POLL_INTERVAL_MS = 1000;

interface DesktopDaemonServerIdResult {
  serverId: string | null;
}

async function loadDesktopDaemonServerId(): Promise<DesktopDaemonServerIdResult> {
  const status = await getDesktopDaemonStatus();
  const serverId = status.serverId.trim();
  return {
    serverId: serverId.length > 0 ? serverId : null,
  };
}

// Each status probe spawns the desktop executable as a child process; on Windows that is a
// GUI-subsystem binary, so every spawn flashes the "app starting" cursor. Only keep polling
// while the app manages a built-in daemon that has not reported a server id yet. When the
// user has turned management off, nothing will start a daemon, so one probe is enough.
export function localDaemonServerIdRefetchInterval(input: {
  serverId: string | null | undefined;
  manageBuiltInDaemon: boolean;
}): number | false {
  if (input.serverId || !input.manageBuiltInDaemon) {
    return false;
  }
  return LOCAL_DAEMON_POLL_INTERVAL_MS;
}

function useManageBuiltInDaemon(enabled: boolean): boolean {
  const { data } = useQuery<DesktopSettings, Error>({
    queryKey: DESKTOP_SETTINGS_QUERY_KEY,
    queryFn: loadDesktopSettings,
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  return (data ?? DEFAULT_DESKTOP_SETTINGS).daemon.manageBuiltInDaemon;
}

function useLocalDaemonServerIdQuery() {
  const isDesktopApp = shouldUseDesktopDaemon();
  const manageBuiltInDaemon = useManageBuiltInDaemon(isDesktopApp);

  return useQuery({
    queryKey: DESKTOP_DAEMON_SERVER_ID_QUERY_KEY,
    queryFn: loadDesktopDaemonServerId,
    enabled: isDesktopApp,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchInterval: (activeQuery) =>
      localDaemonServerIdRefetchInterval({
        serverId: activeQuery.state.data?.serverId,
        manageBuiltInDaemon,
      }),
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useLocalDaemonServerId(): string | null {
  const isDesktopApp = shouldUseDesktopDaemon();
  const query = useLocalDaemonServerIdQuery();

  if (!isDesktopApp) {
    return null;
  }

  return query.data?.serverId ?? null;
}

export type LocalDaemonServerIdState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "resolved"; serverId: string | null };

export function useLocalDaemonServerIdState(): LocalDaemonServerIdState {
  const isDesktopApp = shouldUseDesktopDaemon();
  const query = useLocalDaemonServerIdQuery();

  if (!isDesktopApp) {
    return { status: "resolved", serverId: null };
  }
  if (query.isError) {
    return { status: "error" };
  }
  if (query.isSuccess) {
    return { status: "resolved", serverId: query.data.serverId };
  }
  return { status: "loading" };
}

export function useIsLocalDaemon(serverId: string): boolean {
  const normalizedServerId = serverId.trim();
  const localServerId = useLocalDaemonServerId();

  if (localServerId === null || normalizedServerId.length === 0) {
    return false;
  }

  return localServerId === normalizedServerId;
}
