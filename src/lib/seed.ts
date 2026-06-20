import type { Board, CanvasCard } from "../types";
import { createId, nowIso } from "./ids";

const rootBoardId = "board_home";

export function createInitialBoards(): Board[] {
  const now = nowIso();
  return [
    {
      id: rootBoardId,
      parentBoardId: null,
      title: "Home",
      icon: "⌂",
      color: "#f0b86e",
      createdAt: now,
      updatedAt: now,
      sortIndex: 0,
      trashedAt: null
    },
    makeBoard("Marketing", "board_home", 1, "◆", "#f4b64f"),
    makeBoard("Ideas", "board_home", 2, "✦", "#ec6db0"),
    makeBoard("People", "board_home", 3, "☻", "#64c7d2")
  ];
}

function makeBoard(title: string, parentBoardId: string, sortIndex: number, icon: string, color: string): Board {
  const now = nowIso();
  return {
    id: createId("board"),
    parentBoardId,
    title,
    icon,
    color,
    createdAt: now,
    updatedAt: now,
    sortIndex,
    trashedAt: null
  };
}

export function createInitialCards(boards: Board[]): CanvasCard[] {
  const now = nowIso();
  const children = boards.filter((board) => board.parentBoardId === rootBoardId);
  return [
    {
      id: createId("card"),
      boardId: rootBoardId,
      type: "note",
      x: 120,
      y: 120,
      width: 300,
      height: 180,
      zIndex: 1,
      style: { background: "#f8f0ca", color: "#1f2937", accent: "#f0b86e" },
      content: {
        text: "Добро пожаловать в ACANVAS.\n\nПеретаскивайте инструменты слева или файлы прямо на холст."
      },
      createdAt: now,
      updatedAt: now,
      trashedAt: null
    },
    ...children.map((board, index) => ({
      id: createId("card"),
      boardId: rootBoardId,
      type: "board" as const,
      x: 520 + index * 180,
      y: 180,
      width: 170,
      height: 150,
      zIndex: 2 + index,
      style: { background: "#151b26", color: "#e5edf7", accent: board.color, icon: board.icon },
      content: {
        boardId: board.id,
        title: board.title,
        icon: board.icon,
        color: board.color
      },
      createdAt: now,
      updatedAt: now,
      trashedAt: null
    })),
    {
      id: createId("card"),
      boardId: rootBoardId,
      type: "column",
      x: 160,
      y: 380,
      width: 320,
      height: 300,
      zIndex: 6,
      style: { background: "#111723", color: "#dbe7f5", accent: "#6fc7e8" },
      content: { title: "Backlog", collapsed: false, childCardIds: [] },
      createdAt: now,
      updatedAt: now,
      trashedAt: null
    }
  ];
}
