import type { WorkspaceState } from "../types";
import { nowIso } from "./ids";

const storageKey = "acanvas.workspace.v1";

export function createInitialWorkspace(): WorkspaceState {
  const now = nowIso();
  return {
    boards: [
      {
        id: "board_home",
        parentBoardId: null,
        title: "Home",
        icon: "Home",
        color: "#f0b86e",
        createdAt: now,
        updatedAt: now,
        sortIndex: 0,
        trashedAt: null
      }
    ],
    cards: [],
    assets: [],
    drawingStrokes: [],
    drawingSettings: {
      enabled: false,
      tool: "pen",
      color: "#f0b86e",
      width: 5
    },
    unsortedCardIds: [],
    currentBoardId: "board_home",
    selectedCardIds: [],
    zoom: 1,
    pan: { x: 0, y: 0 },
    history: [],
    future: []
  };
}

export function loadWorkspace(): WorkspaceState {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return createInitialWorkspace();
    }
    const parsed = JSON.parse(raw) as WorkspaceState;
    return {
      ...createInitialWorkspace(),
      ...parsed,
      drawingStrokes: parsed.drawingStrokes ?? [],
      drawingSettings: parsed.drawingSettings ?? createInitialWorkspace().drawingSettings,
      unsortedCardIds: parsed.unsortedCardIds ?? [],
      selectedCardIds: [],
      history: [],
      future: []
    };
  } catch {
    return createInitialWorkspace();
  }
}

export function saveWorkspace(state: WorkspaceState) {
  const serializable = {
    ...state,
    selectedCardIds: [],
    history: [],
    future: []
  };
  localStorage.setItem(storageKey, JSON.stringify(serializable));
}

export function exportWorkspaceJson(state: WorkspaceState) {
  return JSON.stringify(
    {
      schema: "acanvas.workspace.v1",
      exportedAt: new Date().toISOString(),
      boards: state.boards,
      cards: state.cards,
      assets: state.assets,
      drawingStrokes: state.drawingStrokes
    },
    null,
    2
  );
}
