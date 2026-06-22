import type { WorkspaceState } from "../types";

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

async function getInvoke(): Promise<Invoke | null> {
  if (!("__TAURI_INTERNALS__" in window)) {
    return null;
  }
  try {
    const api = await import("@tauri-apps/api/core");
    return api.invoke;
  } catch {
    return null;
  }
}

export async function loadWorkspaceFromBackend(): Promise<Partial<WorkspaceState> | null> {
  const invoke = await getInvoke();
  if (!invoke) return null;
  const payload = await invoke<Partial<WorkspaceState>>("load_workspace");
  return Object.keys(payload).length > 0 ? payload : null;
}

export async function saveWorkspaceToBackend(state: WorkspaceState) {
  const invoke = await getInvoke();
  if (!invoke) return;
  await invoke("save_workspace", {
    workspace: {
      ...state,
      selectedCardIds: [],
      history: [],
      future: []
    }
  });
}

export async function fetchPreviewFromBackend(url: string) {
  const invoke = await getInvoke();
  if (!invoke) return null;
  return invoke<{ url: string; title: string; description: string; image_url?: string }>("fetch_link_preview", { url });
}

export async function openPathWithBackend(path: string) {
  const invoke = await getInvoke();
  if (!invoke) {
    throw new Error("Opening Windows paths is available in the ACANVAS desktop app.");
  }
  await invoke("open_path", { path });
}

export async function revealPathWithBackend(path: string) {
  const invoke = await getInvoke();
  if (!invoke) {
    throw new Error("Revealing Windows paths is available in the ACANVAS desktop app.");
  }
  await invoke("reveal_path", { path });
}

export async function getPathMetadata(path: string): Promise<{ size: number; isDir: boolean } | null> {
  const invoke = await getInvoke();
  if (!invoke) return null;
  const metadata = await invoke<{ size: number; is_dir: boolean }>("path_metadata", { path });
  return {
    size: Number(metadata.size),
    isDir: metadata.is_dir
  };
}

export async function getBackupDirFromBackend(): Promise<string | null> {
  const invoke = await getInvoke();
  if (!invoke) return null;
  return invoke<string | null>("get_backup_dir");
}

export async function setBackupDirInBackend(path: string) {
  const invoke = await getInvoke();
  if (!invoke) {
    throw new Error("Backup folder selection is available in the ACANVAS desktop app.");
  }
  await invoke("set_backup_dir", { path });
}

export async function selectFilesWithDialog(): Promise<string[] | null> {
  if (!("__TAURI_INTERNALS__" in window)) {
    return null;
  }
  const dialog = await import("@tauri-apps/plugin-dialog");
  const selected = await dialog.open({
    directory: false,
    multiple: true,
    title: "Choose files for ACANVAS"
  });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

export async function toAssetUrl(path: string): Promise<string | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  const api = await import("@tauri-apps/api/core");
  return api.convertFileSrc(path);
}

export async function backupNowWithBackend(): Promise<string | null> {
  const invoke = await getInvoke();
  if (!invoke) {
    throw new Error("Desktop backup is available in the ACANVAS desktop app.");
  }
  return invoke<string | null>("backup_now");
}

export async function selectBackupDirWithDialog(): Promise<string | null> {
  if (!("__TAURI_INTERNALS__" in window)) {
    throw new Error("Windows folder picker is available in the ACANVAS desktop app.");
  }
  const dialog = await import("@tauri-apps/plugin-dialog");
  const selected = await dialog.open({
    directory: true,
    multiple: false,
    title: "Choose ACANVAS backup folder"
  });
  return typeof selected === "string" ? selected : null;
}

export async function checkForDesktopUpdate(): Promise<"available" | "not-available"> {
  if (!("__TAURI_INTERNALS__" in window)) {
    throw new Error("Update checks are available in the ACANVAS desktop app.");
  }
  const updater = await import("@tauri-apps/plugin-updater");
  const update = await updater.check();
  return update ? "available" : "not-available";
}
