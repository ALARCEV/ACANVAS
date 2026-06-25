import { describe, expect, it } from "vitest";
import type { WorkspaceState } from "../types";
import { createWorkspaceExport } from "./storage";

describe("workspace export", () => {
  it("keeps local file and folder paths in the export path index", () => {
    const state: WorkspaceState = {
      boards: [],
      cards: [
        {
          id: "card_file",
          boardId: "board_home",
          type: "file",
          x: 0,
          y: 0,
          width: 200,
          height: 120,
          zIndex: 1,
          style: { background: "#070707", color: "#dddddd", accent: "#f0b86e" },
          content: {
            assetId: "asset_1",
            fileName: "brief.pdf",
            mimeType: "application/pdf",
            size: 42,
            sourcePath: "D:\\Projects\\brief.pdf"
          },
          createdAt: "2026-06-22T00:00:00.000Z",
          updatedAt: "2026-06-22T00:00:00.000Z",
          trashedAt: null
        },
        {
          id: "card_folder",
          boardId: "board_home",
          type: "folder",
          x: 0,
          y: 0,
          width: 200,
          height: 120,
          zIndex: 2,
          style: { background: "#070707", color: "#dddddd", accent: "#79c58a" },
          content: {
            title: "Project files",
            path: "D:\\Projects"
          },
          createdAt: "2026-06-22T00:00:00.000Z",
          updatedAt: "2026-06-22T00:00:00.000Z",
          trashedAt: null
        }
      ],
      assets: [
        {
          id: "asset_1",
          originalName: "brief.pdf",
          mimeType: "application/pdf",
          size: 42,
          sourcePath: "D:\\Projects\\brief.pdf",
          createdAt: "2026-06-22T00:00:00.000Z"
        }
      ],
      drawingStrokes: [],
      drawingSettings: { enabled: false, tool: "pen", color: "#f0b86e", width: 5 },
      unsortedCardIds: [],
      currentBoardId: "board_home",
      selectedCardIds: ["card_file"],
      zoom: 1,
      pan: { x: 0, y: 0 },
      history: [{ boards: [], cards: [], drawingStrokes: [], currentBoardId: "board_home" }],
      future: []
    };

    const exported = createWorkspaceExport(state);

    expect(exported.workspace.selectedCardIds).toEqual([]);
    expect(exported.workspace.history).toEqual([]);
    expect(exported.pathIndex).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "asset", path: "D:\\Projects\\brief.pdf" }),
      expect.objectContaining({ kind: "card-source", path: "D:\\Projects\\brief.pdf" }),
      expect.objectContaining({ kind: "folder", path: "D:\\Projects" })
    ]));
  });
});
