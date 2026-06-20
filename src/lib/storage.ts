import type { WorkspaceState } from "../types";
import { createInitialBoards, createInitialCards } from "./seed";

const storageKey = "acanvas.workspace.v1";

export function createInitialWorkspace(): WorkspaceState {
  const boards = createInitialBoards();
  return {
    boards,
    cards: createInitialCards(boards),
    assets: [],
    drawingStrokes: [],
    drawingSettings: {
      enabled: false,
      tool: "pen",
      color: "#f0b86e",
      width: 5
    },
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
