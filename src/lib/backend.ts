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
