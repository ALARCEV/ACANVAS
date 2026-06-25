import type { WorkspaceState } from "../types";
import { nowIso } from "./ids";

const storageKey = "acanvas.workspace.v1";

type WorkspacePathIndexEntry =
  | {
      kind: "asset";
      assetId: string;
      name: string;
      mimeType: string;
      size: number;
      path: string;
    }
  | {
      kind: "card-source";
      cardId: string;
      cardType: "file" | "image";
      name: string;
      path: string;
    }
  | {
      kind: "folder";
      cardId: string;
      cardType: "folder";
      name: string;
      path: string;
    };

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
      width: 5,
      lineMode: "free",
      arrowStart: false,
      arrowEnd: true
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
  return JSON.stringify(createWorkspaceExport(state), null, 2);
}

export function createWorkspaceExport(state: WorkspaceState) {
  const workspace: WorkspaceState = {
    ...state,
    selectedCardIds: [],
    history: [],
    future: []
  };
  return {
    schema: "acanvas.workspace.v1",
    exportedAt: new Date().toISOString(),
    workspace,
    pathIndex: collectWorkspacePaths(workspace)
  };
}

function collectWorkspacePaths(state: WorkspaceState): WorkspacePathIndexEntry[] {
  const assetPaths: WorkspacePathIndexEntry[] = [];

  state.assets.forEach((asset) => {
    if (!asset.sourcePath) {
      return;
    }

    assetPaths.push({
      kind: "asset" as const,
      assetId: asset.id,
      name: asset.originalName,
      mimeType: asset.mimeType,
      size: asset.size,
      path: asset.sourcePath
    });
  });

  const cardPaths: WorkspacePathIndexEntry[] = [];

  state.cards.forEach((card) => {
    if ((card.type === "file" || card.type === "image") && "sourcePath" in card.content && card.content.sourcePath) {
      cardPaths.push({
        kind: "card-source",
        cardId: card.id,
        cardType: card.type,
        name: card.content.fileName,
        path: card.content.sourcePath
      });
    }

    if (card.type === "folder" && "path" in card.content && card.content.path) {
      cardPaths.push({
        kind: "folder",
        cardId: card.id,
        cardType: card.type,
        name: card.content.title,
        path: card.content.path
      });
    }
  });

  return [...assetPaths, ...cardPaths];
}
