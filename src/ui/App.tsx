import {
  Archive,
  Brush,
  ChevronRight,
  Columns3,
  Download,
  Eraser,
  FileUp,
  Folder,
  FolderOpen,
  Heading1,
  Home,
  Image,
  Link,
  ListTodo,
  MessageSquare,
  Minus,
  MousePointer2,
  Palette,
  PenLine,
  Plus,
  Redo2,
  Search,
  Settings,
  StickyNote,
  Trash2,
  Undo2,
  Upload,
  CornerUpRight
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { Board, CanvasCard, CardType, DrawStroke, DropPayload, LineContent, WorkspaceState } from "../types";
import type { BoardContent, ColumnContent, FolderContent, LinkContent, TodoContent } from "../types";
import { fetchPreviewFromBackend, loadWorkspaceFromBackend, openPathWithBackend, saveWorkspaceToBackend } from "../lib/backend";
import { createId, nowIso } from "../lib/ids";
import { exportWorkspaceJson, loadWorkspace, saveWorkspace } from "../lib/storage";
import { normalizeUrl, titleFromUrl } from "../lib/url";

const toolbar: Array<{ type: CardType; label: string; icon: typeof StickyNote }> = [
  { type: "note", label: "Note", icon: StickyNote },
  { type: "link", label: "Link", icon: Link },
  { type: "todo", label: "To-do", icon: ListTodo },
  { type: "line", label: "Line", icon: Minus },
  { type: "title", label: "Title", icon: Heading1 },
  { type: "board", label: "Board", icon: Folder },
  { type: "folder", label: "Folder", icon: FolderOpen },
  { type: "column", label: "Column", icon: Columns3 },
  { type: "comment", label: "Comment", icon: MessageSquare },
  { type: "image", label: "Add image", icon: Image },
  { type: "file", label: "Upload", icon: Upload }
];

const colors = ["#f0b86e", "#f26f66", "#6fc7e8", "#79c58a", "#b986e8", "#f2d76b"];
const drawColors = ["#f0b86e", "#f26f66", "#6fc7e8", "#79c58a", "#b986e8", "#f2d76b", "#e5edf7", "#151b26"];

interface SelectionRect {
  start: { x: number; y: number };
  current: { x: number; y: number };
}

interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => loadWorkspace());
  const [draggingCard, setDraggingCard] = useState<string | null>(null);
  const [resizingCard, setResizingCard] = useState<string | null>(null);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const [activeStroke, setActiveStroke] = useState<DrawStroke | null>(null);
  const [search, setSearch] = useState("");
  const [spacePressed, setSpacePressed] = useState(false);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const lastPointerPoint = useRef({ x: 0, y: 0 });

  useEffect(() => {
    saveWorkspace(workspace);
    saveWorkspaceToBackend(workspace).catch(() => undefined);
  }, [workspace]);

  useEffect(() => {
    loadWorkspaceFromBackend()
      .then((backendWorkspace) => {
        if (backendWorkspace?.boards?.length) {
          setWorkspace((current) => ({
            ...current,
            ...backendWorkspace,
            selectedCardIds: [],
            history: [],
            future: []
          }));
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpacePressed(true);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (workspace.selectedCardIds.length > 0) {
          event.preventDefault();
          softDeleteSelected();
        }
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpacePressed(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });

  const currentBoard = workspace.boards.find((board) => board.id === workspace.currentBoardId) ?? workspace.boards[0];
  const columnChildIds = useMemo(() => getColumnChildIds(workspace.cards, currentBoard.id), [workspace.cards, currentBoard.id]);
  const visibleCards = workspace.cards
    .filter((card) => card.boardId === currentBoard.id && !card.trashedAt)
    .filter((card) => card.type === "line" || !columnChildIds.has(card.id))
    .filter((card) => matchesSearch(card, search))
    .sort((a, b) => a.zIndex - b.zIndex);
  const renderCards = visibleCards.map((card) => resolveLineCard(card, workspace.cards));
  const visibleStrokes = workspace.drawingStrokes.filter((stroke) => stroke.boardId === currentBoard.id && !stroke.trashedAt);
  const trashCount = workspace.cards.filter((card) => card.trashedAt).length;
  const boardPath = useMemo(() => getBoardPath(workspace.boards, currentBoard.id), [workspace.boards, currentBoard.id]);

  function update(mutator: (draft: WorkspaceState) => WorkspaceState, saveHistory = true) {
    setWorkspace((current) => {
      const next = mutator({
        ...current,
        boards: [...current.boards],
        cards: current.cards.map((card) => ({ ...card, content: { ...card.content }, style: { ...card.style } })),
        assets: [...current.assets],
        drawingStrokes: current.drawingStrokes.map((stroke) => ({ ...stroke, points: [...stroke.points] })),
        drawingSettings: { ...current.drawingSettings },
        selectedCardIds: [...current.selectedCardIds]
      });
      if (!saveHistory) return next;
      return {
        ...next,
        history: [
          ...current.history,
          { boards: current.boards, cards: current.cards, drawingStrokes: current.drawingStrokes, currentBoardId: current.currentBoardId }
        ].slice(-50),
        future: []
      };
    });
  }

  function undo() {
    setWorkspace((current) => {
      const snapshot = current.history.at(-1);
      if (!snapshot) return current;
      return {
        ...current,
        boards: snapshot.boards,
        cards: snapshot.cards,
        drawingStrokes: snapshot.drawingStrokes,
        currentBoardId: snapshot.currentBoardId,
        selectedCardIds: [],
        history: current.history.slice(0, -1),
        future: [{ boards: current.boards, cards: current.cards, drawingStrokes: current.drawingStrokes, currentBoardId: current.currentBoardId }, ...current.future]
      };
    });
  }

  function redo() {
    setWorkspace((current) => {
      const snapshot = current.future[0];
      if (!snapshot) return current;
      return {
        ...current,
        boards: snapshot.boards,
        cards: snapshot.cards,
        drawingStrokes: snapshot.drawingStrokes,
        currentBoardId: snapshot.currentBoardId,
        selectedCardIds: [],
        history: [...current.history, { boards: current.boards, cards: current.cards, drawingStrokes: current.drawingStrokes, currentBoardId: current.currentBoardId }],
        future: current.future.slice(1)
      };
    });
  }

  function createCard(type: CardType, x: number, y: number, file?: File) {
    const now = nowIso();
    const id = createId("card");
    update((draft) => {
      let card: CanvasCard;
      if (type === "board") {
        const color = colors[Math.floor(Math.random() * colors.length)];
        const board: Board = {
          id: createId("board"),
          parentBoardId: currentBoard.id,
          title: "New board",
          icon: "◆",
          color,
          createdAt: now,
          updatedAt: now,
          sortIndex: draft.boards.length,
          trashedAt: null
        };
        draft.boards.push(board);
        card = makeCard(id, type, x, y, 180, 150, draft.cards.length + 1, {
          boardId: board.id,
          title: board.title,
          icon: board.icon,
          color
        });
        card.style = { background: "#151b26", color: "#e5edf7", accent: color, icon: board.icon };
      } else if (type === "link") {
        const raw = window.prompt("Paste URL");
        const url = normalizeUrl(raw ?? "");
        card = makeCard(id, type, x, y, 320, 220, draft.cards.length + 1, {
          url,
          title: titleFromUrl(url),
          description: "Preview metadata will be fetched by the Tauri backend in the desktop build.",
          showImage: true,
          showDescription: true
        });
        const cardId = card.id;
        if (url) {
          fetchPreviewFromBackend(url)
            .then((preview) => {
              if (!preview) return;
              updateCardContent(cardId, {
                title: preview.title,
                description: preview.description,
                imageUrl: preview.image_url
              });
            })
            .catch(() => undefined);
        }
      } else if (type === "file" || type === "image") {
        const objectUrl = file ? URL.createObjectURL(file) : undefined;
        const assetId = createId("asset");
        draft.assets.push({
          id: assetId,
          originalName: file?.name ?? "Local file",
          mimeType: file?.type ?? "application/octet-stream",
          size: file?.size ?? 0,
          objectUrl,
          createdAt: now
        });
        card = makeCard(id, file?.type.startsWith("image/") ? "image" : type, x, y, 300, type === "image" ? 250 : 150, draft.cards.length + 1, {
          assetId,
          fileName: file?.name ?? "Local file",
          mimeType: file?.type ?? "application/octet-stream",
          size: file?.size ?? 0,
          thumbnailUrl: objectUrl
        });
      } else if (type === "folder") {
        const path = window.prompt("Windows folder or shortcut path", "C:\\\\");
        const title = window.prompt("Folder title", path?.split(/[\\/]/).filter(Boolean).at(-1) ?? "Folder");
        card = makeCard(id, type, x, y, 280, 140, draft.cards.length + 1, {
          title: title || "Folder",
          path: path || ""
        });
        card.style = { background: "#111723", color: "#e5edf7", accent: "#79c58a" };
      } else {
        card = makeDefaultCard(id, type, x, y, draft.cards.length + 1);
      }
      draft.cards.push(card);
      draft.selectedCardIds = [card.id];
      return draft;
    });
  }

  function handleToolClick(type: CardType) {
    if (type === "line" && workspace.selectedCardIds.length >= 2) {
      createConnectorBetween(workspace.selectedCardIds[0], workspace.selectedCardIds[1]);
      return;
    }
    createCard(type, 160, 140);
  }

  function toggleDraw() {
    update((draft) => {
      draft.drawingSettings.enabled = !draft.drawingSettings.enabled;
      draft.selectedCardIds = [];
      return draft;
    }, false);
  }

  function updateDrawSettings(patch: Partial<WorkspaceState["drawingSettings"]>) {
    update((draft) => {
      draft.drawingSettings = { ...draft.drawingSettings, ...patch };
      return draft;
    }, false);
  }

  function startDrawing(event: React.PointerEvent<HTMLElement>) {
    if (!workspace.drawingSettings.enabled || event.button !== 0) return false;
    if ((event.target as HTMLElement).closest("button, input, textarea, a")) return false;
    const point = canvasPoint(event.clientX, event.clientY);
    lastPointerPoint.current = point;
    if (workspace.drawingSettings.tool === "eraser") {
      eraseStrokeAt(point);
      return true;
    }
    const stroke: DrawStroke = {
      id: createId("stroke"),
      boardId: currentBoard.id,
      points: [point],
      color: workspace.drawingSettings.color,
      width: workspace.drawingSettings.width,
      createdAt: nowIso(),
      trashedAt: null
    };
    setActiveStroke(stroke);
    event.currentTarget.setPointerCapture(event.pointerId);
    return true;
  }

  function continueDrawing(point: { x: number; y: number }) {
    if (workspace.drawingSettings.tool === "eraser") {
      eraseStrokeAt(point);
      return;
    }
    setActiveStroke((stroke) => (stroke ? { ...stroke, points: [...stroke.points, point] } : null));
  }

  function finishDrawing() {
    if (!activeStroke || activeStroke.points.length < 2) {
      setActiveStroke(null);
      return;
    }
    update((draft) => {
      draft.drawingStrokes.push(activeStroke);
      return draft;
    });
    setActiveStroke(null);
  }

  function eraseStrokeAt(point: { x: number; y: number }) {
    const threshold = Math.max(8, workspace.drawingSettings.width * 2);
    update((draft) => {
      draft.drawingStrokes = draft.drawingStrokes.map((stroke) => {
        if (stroke.boardId !== currentBoard.id || stroke.trashedAt) return stroke;
        return stroke.points.some((candidate) => distance(candidate, point) <= threshold)
          ? { ...stroke, trashedAt: nowIso() }
          : stroke;
      });
      return draft;
    }, false);
  }

  function createConnectorBetween(sourceCardId: string, targetCardId: string) {
    const source = workspace.cards.find((card) => card.id === sourceCardId);
    const target = workspace.cards.find((card) => card.id === targetCardId);
    if (!source || !target || source.boardId !== target.boardId) return;

    const sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
    const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    const x = Math.min(sourceCenter.x, targetCenter.x);
    const y = Math.min(sourceCenter.y, targetCenter.y);
    const width = Math.max(120, Math.abs(targetCenter.x - sourceCenter.x));
    const height = Math.max(80, Math.abs(targetCenter.y - sourceCenter.y));
    const content: LineContent = {
      points: [
        { x: sourceCenter.x - x, y: sourceCenter.y - y },
        { x: targetCenter.x - x, y: targetCenter.y - y }
      ],
      sourceCardId,
      targetCardId,
      arrowEnd: true
    };

    update((draft) => {
      const now = nowIso();
      const card: CanvasCard = {
        id: createId("card"),
        boardId: source.boardId,
        type: "line",
        x,
        y,
        width,
        height,
        zIndex: Math.max(1, Math.min(source.zIndex, target.zIndex) - 1),
        style: { background: "transparent", color: "#e5edf7", accent: "#f0b86e" },
        content,
        createdAt: now,
        updatedAt: now,
        trashedAt: null
      };
      draft.cards.push(card);
      draft.selectedCardIds = [card.id];
      return draft;
    });
  }

  function makeDefaultCard(id: string, type: CardType, x: number, y: number, zIndex: number): CanvasCard {
    if (type === "column") {
      return makeCard(id, type, x, y, 320, 320, zIndex, { title: "Column", collapsed: false, childCardIds: [] });
    }
    if (type === "comment") {
      return makeCard(id, type, x, y, 260, 140, zIndex, { text: "New comment", replies: [] });
    }
    if (type === "line") {
      const card = makeCard(id, type, x, y, 260, 120, zIndex, { points: [{ x: 12, y: 90 }, { x: 238, y: 28 }], arrowEnd: true });
      card.style = { background: "transparent", color: "#e5edf7", accent: "#f0b86e" };
      return card;
    }
    if (type === "todo") {
      return makeCard(id, type, x, y, 280, 220, zIndex, {
        title: "To-do",
        items: [{ id: createId("todo"), text: "First task", done: false }]
      });
    }
    if (type === "title") {
      const card = makeCard(id, type, x, y, 280, 96, zIndex, { text: "Area title", level: "title" });
      card.style = { background: "#f0b86e", color: "#101722", accent: "#f0b86e" };
      return card;
    }
    return makeCard(id, "note", x, y, 340, 260, zIndex, {
      text: "# Title\n\n## Heading\n\nShort note with **bold text**.\n\n- First point\n- Second point",
      format: "normal"
    });
  }

  function makeCard(
    id: string,
    type: CardType,
    x: number,
    y: number,
    width: number,
    height: number,
    zIndex: number,
    content: CanvasCard["content"]
  ): CanvasCard {
    const now = nowIso();
    return {
      id,
      boardId: currentBoard.id,
      type,
      x,
      y,
      width,
      height,
      zIndex,
      style: { background: "#151b26", color: "#e5edf7", accent: colors[zIndex % colors.length] },
      content,
      createdAt: now,
      updatedAt: now,
      trashedAt: null
    };
  }

  function canvasPoint(clientX: number, clientY: number) {
    const rect = boardRef.current?.getBoundingClientRect();
    return {
      x: (clientX - (rect?.left ?? 0) - workspace.pan.x) / workspace.zoom,
      y: (clientY - (rect?.top ?? 0) - workspace.pan.y) / workspace.zoom
    };
  }

  function handleToolbarDrag(payload: DropPayload, event: React.DragEvent) {
    event.dataTransfer.setData("application/acanvas-tool", JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "copy";
  }

  function handleCanvasDrop(event: React.DragEvent) {
    event.preventDefault();
    const point = canvasPoint(event.clientX, event.clientY);
    const tool = event.dataTransfer.getData("application/acanvas-tool");
    if (tool) {
      const payload = JSON.parse(tool) as DropPayload;
      createCard(payload.kind, point.x, point.y);
      return;
    }
    const files = Array.from(event.dataTransfer.files);
    files.forEach((file, index) => createCard(file.type.startsWith("image/") ? "image" : "file", point.x + index * 24, point.y + index * 24, file));
  }

  function startDrag(card: CanvasCard, event: React.PointerEvent) {
    if ((event.target as HTMLElement).closest("[data-no-drag]")) return;
    const point = canvasPoint(event.clientX, event.clientY);
    dragOffset.current = { x: point.x - card.x, y: point.y - card.y };
    setDraggingCard(card.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    update((draft) => {
      draft.selectedCardIds = event.shiftKey
        ? Array.from(new Set([...draft.selectedCardIds, card.id]))
        : [card.id];
      const maxZ = Math.max(0, ...draft.cards.map((item) => item.zIndex));
      const target = draft.cards.find((item) => item.id === card.id);
      if (target) target.zIndex = maxZ + 1;
      return draft;
    }, false);
  }

  function moveCard(event: React.PointerEvent) {
    if (!draggingCard && !resizingCard && !selectionRect && !activeStroke) return;
    const point = canvasPoint(event.clientX, event.clientY);
    lastPointerPoint.current = point;
    if (activeStroke || (workspace.drawingSettings.enabled && workspace.drawingSettings.tool === "eraser" && event.buttons === 1)) {
      continueDrawing(point);
      return;
    }
    if (selectionRect) {
      setSelectionRect((current) => (current ? { ...current, current: point } : null));
      update((draft) => {
        const rect = normalizeRect(selectionRect.start, point);
        draft.selectedCardIds = draft.cards
          .filter((card) => card.boardId === currentBoard.id && !card.trashedAt && card.type !== "line")
          .filter((card) => intersectsRect(rect, { x: card.x, y: card.y, width: card.width, height: card.height }))
          .map((card) => card.id);
        return draft;
      }, false);
      return;
    }
    update((draft) => {
      const target = draft.cards.find((card) => card.id === (draggingCard ?? resizingCard));
      if (!target) return draft;
      if (draggingCard) {
        target.x = Math.round(point.x - dragOffset.current.x);
        target.y = Math.round(point.y - dragOffset.current.y);
      }
      if (resizingCard) {
        target.width = Math.max(140, Math.round(point.x - target.x));
        target.height = Math.max(90, Math.round(point.y - target.y));
      }
      target.updatedAt = nowIso();
      return draft;
    }, false);
  }

  function endPointer() {
    if (activeStroke) {
      finishDrawing();
      return;
    }
    if (selectionRect) {
      setSelectionRect(null);
      return;
    }
    if (!draggingCard && !resizingCard) return;
    const droppedCardId = draggingCard;
    setDraggingCard(null);
    setResizingCard(null);
    setWorkspace((current) => {
      let cards = current.cards;
      let boards = current.boards;
      if (droppedCardId) {
        const dragged = cards.find((card) => card.id === droppedCardId);
        const targetColumnCard = dragged ? findColumnDropTarget(cards, dragged, lastPointerPoint.current) : undefined;
        if (dragged && targetColumnCard && "childCardIds" in targetColumnCard.content) {
          cards = cards.map((card) => {
            if (card.id === targetColumnCard.id) {
              const content = card.content as ColumnContent;
              return {
                ...card,
                content: {
                  ...content,
                  childCardIds: Array.from(new Set([...content.childCardIds, dragged.id]))
                },
                updatedAt: nowIso()
              };
            }
            if (card.id === dragged.id) {
              return { ...card, x: targetColumnCard.x + 24, y: targetColumnCard.y + 80, updatedAt: nowIso() };
            }
            return card;
          });
        }
        const targetBoardCard = dragged ? findBoardDropTarget(cards, dragged, lastPointerPoint.current) : undefined;
        if (dragged && !targetColumnCard && targetBoardCard && "boardId" in targetBoardCard.content) {
          const targetBoardContent = targetBoardCard.content as BoardContent;
          const draggedBoardContent = dragged.type === "board" && "boardId" in dragged.content ? (dragged.content as BoardContent) : null;
          const wouldNestIntoSelf = draggedBoardContent?.boardId === targetBoardContent.boardId;
          const wouldNestIntoDescendant = draggedBoardContent
            ? isBoardDescendant(boards, targetBoardContent.boardId, draggedBoardContent.boardId)
            : false;
          if (wouldNestIntoSelf || wouldNestIntoDescendant) {
            return current;
          }
          cards = cards.map((card) => {
            if (card.id !== dragged.id) return card;
            return { ...card, boardId: targetBoardContent.boardId, x: 90, y: 90, updatedAt: nowIso() };
          });
          if (draggedBoardContent) {
            boards = boards.map((board) =>
              board.id === draggedBoardContent.boardId
                ? { ...board, parentBoardId: targetBoardContent.boardId, updatedAt: nowIso() }
                : board
            );
          }
        }
      }
      return {
        ...current,
        boards,
        cards,
        selectedCardIds: droppedCardId && cards.some((card) => card.id === droppedCardId && card.boardId === current.currentBoardId)
          ? [droppedCardId]
          : [],
        history: [...current.history, { boards: current.boards, cards: current.cards, drawingStrokes: current.drawingStrokes, currentBoardId: current.currentBoardId }].slice(-50),
        future: []
      };
    });
  }

  function startMarquee(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    if (startDrawing(event)) return;
    if ((event.target as HTMLElement).closest(".card, button, input, textarea, a")) return;
    const point = canvasPoint(event.clientX, event.clientY);
    lastPointerPoint.current = point;
    setSelectionRect({ start: point, current: point });
    update((draft) => {
      draft.selectedCardIds = [];
      return draft;
    }, false);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateCardContent(cardId: string, patch: Partial<CanvasCard["content"]>) {
    update((draft) => {
      const target = draft.cards.find((card) => card.id === cardId);
      if (target) {
        target.content = { ...target.content, ...patch } as CanvasCard["content"];
        target.updatedAt = nowIso();
      }
      return draft;
    });
  }

  function openFolderPath(path: string) {
    openPathWithBackend(path).catch((error) => {
      window.alert(error instanceof Error ? error.message : "Unable to open path");
    });
  }

  function popOutFromColumn(cardId: string, columnId: string) {
    update((draft) => {
      const column = draft.cards.find((card) => card.id === columnId);
      const child = draft.cards.find((card) => card.id === cardId);
      if (!column || !child || !("childCardIds" in column.content)) return draft;
      const content = column.content as ColumnContent;
      column.content = {
        ...content,
        childCardIds: content.childCardIds.filter((id) => id !== cardId)
      };
      child.x = column.x + column.width + 28;
      child.y = column.y + 24 + content.childCardIds.indexOf(cardId) * 26;
      child.zIndex = Math.max(0, ...draft.cards.map((card) => card.zIndex)) + 1;
      child.updatedAt = nowIso();
      draft.selectedCardIds = [child.id];
      return draft;
    });
  }

  function softDeleteSelected() {
    update((draft) => {
      const now = nowIso();
      draft.cards = draft.cards.map((card) => (draft.selectedCardIds.includes(card.id) ? { ...card, trashedAt: now } : card));
      draft.selectedCardIds = [];
      return draft;
    });
  }

  function restoreTrash() {
    update((draft) => {
      draft.cards = draft.cards.map((card) => ({ ...card, trashedAt: null }));
      return draft;
    });
  }

  function exportJson() {
    const blob = new Blob([exportWorkspaceJson(workspace)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `acanvas-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="brandButton" onClick={() => setWorkspace((state) => ({ ...state, currentBoardId: "board_home" }))}>
          <Home size={17} />
          <span>Home</span>
        </button>
        <nav className="breadcrumbs">
          {boardPath.map((board, index) => (
            <button key={board.id} onClick={() => setWorkspace((state) => ({ ...state, currentBoardId: board.id, selectedCardIds: [] }))}>
              {index > 0 && <ChevronRight size={14} />}
              <span className="crumbColor" style={{ background: board.color }} />
              <span>{board.title}</span>
            </button>
          ))}
        </nav>
        <h1>{currentBoard.title}</h1>
        <div className="topActions">
          <button title="Undo" onClick={undo}><Undo2 size={18} /></button>
          <button title="Redo" onClick={redo}><Redo2 size={18} /></button>
          <label className="searchBox">
            <Search size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" />
          </label>
          <button title="Export JSON" onClick={exportJson}><Download size={18} /></button>
          <button title="Settings"><Settings size={18} /></button>
        </div>
      </header>

      <aside className="toolbar">
        {toolbar.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.type}
              draggable
              title={tool.label}
              onDragStart={(event) => handleToolbarDrag({ kind: tool.type, label: tool.label }, event)}
              onClick={() => handleToolClick(tool.type)}
            >
              <Icon size={20} />
              <span>{tool.label}</span>
            </button>
          );
        })}
        <button
          className={`toolSpacer ${workspace.drawingSettings.enabled ? "isActiveTool" : ""}`}
          title="Draw"
          onClick={toggleDraw}
        >
          <PenLine size={20} />
          <span>Draw</span>
        </button>
        <button className="trashButton" title="Restore trash" onClick={restoreTrash}>
          <Trash2 size={20} />
          <span>Trash {trashCount}</span>
        </button>
      </aside>

      <main
        ref={boardRef}
        className={`canvasHost ${spacePressed ? "isPanning" : ""}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleCanvasDrop}
        onPointerDown={startMarquee}
        onPointerMove={moveCard}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onWheel={(event) => {
          if (!event.ctrlKey) return;
          event.preventDefault();
          const nextZoom = Math.min(1.8, Math.max(0.45, workspace.zoom - event.deltaY * 0.001));
          setWorkspace((state) => ({ ...state, zoom: Number(nextZoom.toFixed(2)) }));
        }}
      >
        <div className="canvasGrid" style={{ transform: `translate(${workspace.pan.x}px, ${workspace.pan.y}px) scale(${workspace.zoom})` }}>
          <DrawingLayer strokes={activeStroke ? [...visibleStrokes, activeStroke] : visibleStrokes} />
          {renderCards.map((card) => (
            <CardView
              key={card.id}
              card={card}
              allCards={workspace.cards}
              selected={workspace.selectedCardIds.includes(card.id)}
              onPointerDown={(event) => startDrag(card, event)}
              onResize={(event) => {
                event.stopPropagation();
                setResizingCard(card.id);
              }}
              onOpenBoard={(boardId) => setWorkspace((state) => ({ ...state, currentBoardId: boardId, selectedCardIds: [] }))}
              onOpenPath={openFolderPath}
              onPopOutFromColumn={popOutFromColumn}
              onChange={(patch) => updateCardContent(card.id, patch)}
            />
          ))}
        </div>
        {selectionRect && <SelectionBox rect={normalizeRect(selectionRect.start, selectionRect.current)} zoom={workspace.zoom} pan={workspace.pan} />}
        <div className="zoomDock">
          <button onClick={() => setWorkspace((state) => ({ ...state, zoom: Math.max(0.45, state.zoom - 0.1) }))}>-</button>
          <span>{Math.round(workspace.zoom * 100)}%</span>
          <button onClick={() => setWorkspace((state) => ({ ...state, zoom: Math.min(1.8, state.zoom + 0.1) }))}>+</button>
        </div>
      </main>

      <aside className="sidePanel">
        <div className="panelHeader">
          <Archive size={18} />
          <strong>Unsorted</strong>
        </div>
        <p>Drop files or toolbar items anywhere on the canvas. Selected cards can be moved, resized, deleted, or opened.</p>
        {workspace.drawingSettings.enabled && (
          <div className="drawPanel">
            <div className="segmented">
              <button
                className={workspace.drawingSettings.tool === "pen" ? "isSelected" : ""}
                onClick={() => updateDrawSettings({ tool: "pen" })}
              >
                <Brush size={16} />
                Pen
              </button>
              <button
                className={workspace.drawingSettings.tool === "eraser" ? "isSelected" : ""}
                onClick={() => updateDrawSettings({ tool: "eraser" })}
              >
                <Eraser size={16} />
                Eraser
              </button>
            </div>
            <div className="swatches">
              {drawColors.map((color) => (
                <button
                  key={color}
                  className={workspace.drawingSettings.color === color ? "isSelected" : ""}
                  style={{ background: color }}
                  aria-label={`Draw color ${color}`}
                  onClick={() => updateDrawSettings({ color, tool: "pen" })}
                />
              ))}
            </div>
            <label className="rangeControl">
              <span>Width {workspace.drawingSettings.width}px</span>
              <input
                type="range"
                min="2"
                max="18"
                value={workspace.drawingSettings.width}
                onChange={(event) => updateDrawSettings({ width: Number(event.target.value) })}
              />
            </label>
          </div>
        )}
        <div className="stats">
          <span>{visibleCards.length} visible</span>
          <span>{workspace.boards.filter((board) => board.parentBoardId === currentBoard.id).length} boards</span>
          <span>{workspace.assets.length} assets</span>
        </div>
        <button className="primaryAction" onClick={() => createCard("note", 220, 220)}>
          <Plus size={16} />
          New note
        </button>
        <button className="secondaryAction" onClick={exportJson}>
          <FileUp size={16} />
          Export workspace
        </button>
      </aside>
    </div>
  );
}

function CardView({
  card,
  allCards,
  selected,
  onPointerDown,
  onResize,
  onOpenBoard,
  onOpenPath,
  onPopOutFromColumn,
  onChange
}: {
  card: CanvasCard;
  allCards: CanvasCard[];
  selected: boolean;
  onPointerDown: (event: React.PointerEvent) => void;
  onResize: (event: React.PointerEvent) => void;
  onOpenBoard: (boardId: string) => void;
  onOpenPath: (path: string) => void;
  onPopOutFromColumn: (cardId: string, columnId: string) => void;
  onChange: (patch: Partial<CanvasCard["content"]>) => void;
}) {
  return (
    <section
      className={`card card-${card.type} ${selected ? "isSelected" : ""}`}
      style={{
        left: card.x,
        top: card.y,
        width: card.width,
        height: card.height,
        zIndex: card.zIndex,
        background: card.style.background,
        color: card.style.color,
        borderColor: selected ? card.style.accent : undefined
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={() => {
        if (card.type === "board" && "boardId" in card.content) onOpenBoard(card.content.boardId);
      }}
    >
      <button className="dragHandle" title="Move card" aria-label="Move card">
        <MousePointer2 size={13} />
      </button>
      <CardContent
        card={card}
        allCards={allCards}
        onChange={onChange}
        onOpenBoard={onOpenBoard}
        onOpenPath={onOpenPath}
        onPopOutFromColumn={onPopOutFromColumn}
      />
      <button className="resizeHandle" data-no-drag onPointerDown={onResize} aria-label="Resize" />
    </section>
  );
}

function CardContent({
  card,
  allCards,
  onChange,
  onOpenBoard,
  onOpenPath,
  onPopOutFromColumn
}: {
  card: CanvasCard;
  allCards: CanvasCard[];
  onChange: (patch: Partial<CanvasCard["content"]>) => void;
  onOpenBoard: (boardId: string) => void;
  onOpenPath: (path: string) => void;
  onPopOutFromColumn: (cardId: string, columnId: string) => void;
}) {
  if (card.type === "note" && "text" in card.content) {
    const hasMarkdown = containsMarkdown(card.content.text);
    return (
      <div className={`noteCard ${hasMarkdown ? "hasMarkdown" : "plainNote"}`}>
        <textarea
          data-no-drag
          className="noteEditor"
          value={card.content.text}
          onChange={(event) => onChange({ text: event.target.value })}
        />
        {hasMarkdown && <div className="markdownPreview">{renderMarkdown(card.content.text)}</div>}
      </div>
    );
  }

  if (card.type === "title" && "level" in card.content) {
    return (
      <div className={`titleCard titleCard-${card.content.level}`}>
        <input
          data-no-drag
          value={card.content.text}
          onChange={(event) => onChange({ text: event.target.value })}
        />
      </div>
    );
  }

  if (card.type === "link" && "url" in card.content) {
    return (
      <div className="linkCard">
        <div className="cardAccent" style={{ background: card.style.accent }} />
        <a data-no-drag href={card.content.url} target="_blank" rel="noreferrer">{card.content.title}</a>
        {card.content.showDescription && <p>{card.content.description}</p>}
        <small>{card.content.url}</small>
      </div>
    );
  }

  if ((card.type === "file" || card.type === "image") && "fileName" in card.content) {
    return (
      <div className="fileCard">
        {card.content.thumbnailUrl ? <img src={card.content.thumbnailUrl} alt="" /> : <FileUp size={34} />}
        <strong>{card.content.fileName}</strong>
        <small>{formatBytes(card.content.size)} · {card.content.mimeType || "file"}</small>
      </div>
    );
  }

  if (card.type === "folder" && "path" in card.content) {
    const content = card.content as FolderContent;
    return (
      <button data-no-drag className="folderCard" onClick={() => onOpenPath(content.path)}>
        <FolderOpen size={34} />
        <strong>{content.title}</strong>
        <small>{content.path || "No path set"}</small>
      </button>
    );
  }

  if (card.type === "board" && "boardId" in card.content) {
    const content = card.content as BoardContent;
    return (
      <button data-no-drag className="boardCardButton" onClick={() => onOpenBoard(content.boardId)}>
        <span className="boardIcon" style={{ background: content.color }}>{content.icon}</span>
        <strong>{content.title}</strong>
        <small>Open board</small>
      </button>
    );
  }

  if (card.type === "column" && "title" in card.content) {
    const content = card.content as ColumnContent;
    return (
      <div className="columnCard">
        <input
          data-no-drag
          value={content.title}
          onChange={(event) => onChange({ title: event.target.value })}
        />
        <span>{content.childCardIds.length} cards</span>
        <div className="columnDrop">
          {content.childCardIds.length === 0 ? (
            <span>Drop cards here</span>
          ) : (
            content.childCardIds
              .map((id) => allCards.find((candidate) => candidate.id === id && !candidate.trashedAt))
              .filter((candidate): candidate is CanvasCard => Boolean(candidate))
              .map((child) => (
                <ColumnChild
                  key={child.id}
                  card={child}
                  columnId={card.id}
                  onOpenBoard={onOpenBoard}
                  onOpenPath={onOpenPath}
                  onPopOut={onPopOutFromColumn}
                />
              ))
          )}
        </div>
      </div>
    );
  }

  if (card.type === "comment" && "replies" in card.content) {
    return (
      <div className="commentCard">
        <MessageSquare size={18} />
        <textarea data-no-drag value={card.content.text} onChange={(event) => onChange({ text: event.target.value })} />
        <small>{card.content.replies.length} replies</small>
      </div>
    );
  }

  if (card.type === "todo" && "items" in card.content) {
    const content = card.content as TodoContent;
    return (
      <div className="todoCard">
        <strong>{content.title}</strong>
        {content.items.map((item) => (
          <label key={item.id} data-no-drag>
            <input
              type="checkbox"
              checked={item.done}
              onChange={() =>
                onChange({
                  items: content.items.map((candidate) =>
                    candidate.id === item.id ? { ...candidate, done: !candidate.done } : candidate
                  )
                })
              }
            />
            <span>{item.text}</span>
          </label>
        ))}
      </div>
    );
  }

  if (card.type === "line" && "points" in card.content) {
    return (
      <svg className="lineCard" viewBox={`0 0 ${card.width} ${card.height}`}>
        <defs>
          <marker id={`arrow-${card.id}`} markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
            <path d="M0,0 L0,6 L9,3 z" fill={card.style.accent} />
          </marker>
        </defs>
        <path
          d={`M ${card.content.points[0]?.x ?? 0} ${card.content.points[0]?.y ?? 0} C ${card.width / 2} 0 ${card.width / 2} ${card.height} ${card.content.points[1]?.x ?? card.width} ${card.content.points[1]?.y ?? card.height}`}
          fill="none"
          stroke={card.style.accent}
          strokeWidth="3"
          markerEnd={card.content.arrowEnd ? `url(#arrow-${card.id})` : undefined}
        />
      </svg>
    );
  }

  return null;
}

function DrawingLayer({ strokes }: { strokes: DrawStroke[] }) {
  return (
    <svg className="drawingLayer" viewBox="0 0 3000 2200">
      {strokes.map((stroke) => (
        <path
          key={stroke.id}
          d={strokePath(stroke.points)}
          fill="none"
          stroke={stroke.color}
          strokeWidth={stroke.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

function ColumnChild({
  card,
  columnId,
  onOpenBoard,
  onOpenPath,
  onPopOut
}: {
  card: CanvasCard;
  columnId: string;
  onOpenBoard: (boardId: string) => void;
  onOpenPath: (path: string) => void;
  onPopOut: (cardId: string, columnId: string) => void;
}) {
  const label = getCardLabel(card);
  const accent = card.style.accent ?? "#6fc7e8";
  if (card.type === "board" && "boardId" in card.content) {
    const content = card.content as BoardContent;
    return (
      <button data-no-drag className="columnChild" onClick={() => onOpenBoard(content.boardId)} title="Open board">
        <span style={{ background: content.color }} />
        <strong>{label}</strong>
        <small>Board</small>
        <CornerUpRight size={15} />
      </button>
    );
  }

  if (card.type === "link" && "url" in card.content) {
    const content = card.content as LinkContent;
    return (
      <button data-no-drag className="columnChild" onClick={() => window.open(content.url, "_blank", "noopener,noreferrer")} title="Open link">
        <span style={{ background: accent }} />
        <strong>{label}</strong>
        <small>Link</small>
        <CornerUpRight size={15} />
      </button>
    );
  }

  if (card.type === "folder" && "path" in card.content) {
    const content = card.content as FolderContent;
    return (
      <button data-no-drag className="columnChild" onClick={() => onOpenPath(content.path)} title="Open folder">
        <span style={{ background: accent }} />
        <strong>{label}</strong>
        <small>Folder</small>
        <CornerUpRight size={15} />
      </button>
    );
  }

  return (
    <button data-no-drag className="columnChild" onClick={() => onPopOut(card.id, columnId)} title="Pop out to canvas">
      <span style={{ background: accent }} />
      <strong>{label}</strong>
      <small>{card.type}</small>
      <CornerUpRight size={15} />
    </button>
  );
}

function getCardLabel(card: CanvasCard) {
  if (card.type === "note" && "text" in card.content) {
    return firstMeaningfulLine(card.content.text).replace(/^#{1,6}\s*/, "") || "Note";
  }
  if (card.type === "title" && "text" in card.content) return card.content.text || "Title";
  if (card.type === "folder" && "title" in card.content) {
    const content = card.content as FolderContent;
    return content.title || content.path;
  }
  if (card.type === "link" && "title" in card.content) {
    const content = card.content as LinkContent;
    return content.title || content.url;
  }
  if ((card.type === "file" || card.type === "image") && "fileName" in card.content) return card.content.fileName;
  if (card.type === "board" && "title" in card.content) return card.content.title;
  if (card.type === "todo" && "title" in card.content) return card.content.title;
  if (card.type === "comment" && "text" in card.content) return card.content.text || "Comment";
  return card.type;
}

function renderMarkdown(text: string) {
  const lines = text.split(/\r?\n/);
  const nodes: ReactElement[] = [];
  let listItems: string[] = [];
  const flushList = () => {
    if (listItems.length === 0) return;
    const key = `list-${nodes.length}`;
    nodes.push(
      <ul key={key}>
        {listItems.map((item, index) => (
          <li key={`${key}-${index}`}>{renderInlineMarkdown(item)}</li>
        ))}
      </ul>
    );
    listItems = [];
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const bullet = trimmed.match(/^[-*]\s+(.+)/);
    const ordered = trimmed.match(/^\d+\.\s+(.+)/);
    if (bullet || ordered) {
      listItems.push((bullet?.[1] ?? ordered?.[1] ?? "").trim());
      return;
    }
    flushList();
    if (!trimmed) {
      nodes.push(<br key={`br-${index}`} />);
    } else if (trimmed.startsWith("### ")) {
      nodes.push(<h3 key={index}>{renderInlineMarkdown(trimmed.slice(4))}</h3>);
    } else if (trimmed.startsWith("## ")) {
      nodes.push(<h2 key={index}>{renderInlineMarkdown(trimmed.slice(3))}</h2>);
    } else if (trimmed.startsWith("# ")) {
      nodes.push(<h1 key={index}>{renderInlineMarkdown(trimmed.slice(2))}</h1>);
    } else if (trimmed.startsWith("> ")) {
      nodes.push(<blockquote key={index}>{renderInlineMarkdown(trimmed.slice(2))}</blockquote>);
    } else {
      nodes.push(<p key={index}>{renderInlineMarkdown(trimmed)}</p>);
    }
  });
  flushList();
  return nodes;
}

function containsMarkdown(text: string) {
  return /(^|\n)\s{0,3}#{1,3}\s+\S/.test(text)
    || /(^|\n)\s*[-*]\s+\S/.test(text)
    || /(^|\n)\s*\d+\.\s+\S/.test(text)
    || /\*\*[^*]+\*\*/.test(text)
    || /(^|\n)\s*>\s+\S/.test(text)
    || /`[^`]+`/.test(text);
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return <span key={index}>{part}</span>;
  });
}

function getBoardPath(boards: Board[], boardId: string) {
  const result: Board[] = [];
  let current = boards.find((board) => board.id === boardId);
  while (current) {
    result.unshift(current);
    current = current.parentBoardId ? boards.find((board) => board.id === current?.parentBoardId) : undefined;
  }
  return result;
}

function matchesSearch(card: CanvasCard, search: string) {
  if (!search.trim()) return true;
  return JSON.stringify(card.content).toLowerCase().includes(search.toLowerCase());
}

function findBoardDropTarget(cards: CanvasCard[], dragged: CanvasCard, point: { x: number; y: number }) {
  return cards
    .filter((card) => card.id !== dragged.id && card.boardId === dragged.boardId && card.type === "board" && !card.trashedAt)
    .filter((card) => point.x >= card.x && point.x <= card.x + card.width && point.y >= card.y && point.y <= card.y + card.height)
    .sort((a, b) => b.zIndex - a.zIndex)[0];
}

function findColumnDropTarget(cards: CanvasCard[], dragged: CanvasCard, point: { x: number; y: number }) {
  if (dragged.type === "column" || dragged.type === "line") return undefined;
  return cards
    .filter((card) => card.id !== dragged.id && card.boardId === dragged.boardId && card.type === "column" && !card.trashedAt)
    .filter((card) => point.x >= card.x && point.x <= card.x + card.width && point.y >= card.y && point.y <= card.y + card.height)
    .sort((a, b) => b.zIndex - a.zIndex)[0];
}

function getColumnChildIds(cards: CanvasCard[], boardId: string) {
  const ids = new Set<string>();
  cards
    .filter((card) => card.boardId === boardId && card.type === "column" && !card.trashedAt && "childCardIds" in card.content)
    .forEach((card) => {
      const content = card.content as ColumnContent;
      content.childCardIds.forEach((id) => ids.add(id));
    });
  return ids;
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function firstMeaningfulLine(text: string) {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

function strokePath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function SelectionBox({ rect, zoom, pan }: { rect: NormalizedRect; zoom: number; pan: { x: number; y: number } }) {
  return (
    <div
      className="selectionBox"
      style={{
        left: rect.x * zoom + pan.x,
        top: rect.y * zoom + pan.y,
        width: rect.width * zoom,
        height: rect.height * zoom
      }}
    />
  );
}

function normalizeRect(start: { x: number; y: number }, current: { x: number; y: number }): NormalizedRect {
  return {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y)
  };
}

function intersectsRect(a: NormalizedRect, b: NormalizedRect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function resolveLineCard(card: CanvasCard, cards: CanvasCard[]): CanvasCard {
  if (card.type !== "line" || !("points" in card.content)) return card;
  const content = card.content as LineContent;
  if (!content.sourceCardId || !content.targetCardId) return card;

  const source = cards.find((item) => item.id === content.sourceCardId && !item.trashedAt);
  const target = cards.find((item) => item.id === content.targetCardId && !item.trashedAt);
  if (!source || !target || source.boardId !== card.boardId || target.boardId !== card.boardId) return card;

  const sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const padding = 26;
  const x = Math.min(sourceCenter.x, targetCenter.x) - padding;
  const y = Math.min(sourceCenter.y, targetCenter.y) - padding;
  const width = Math.max(80, Math.abs(targetCenter.x - sourceCenter.x) + padding * 2);
  const height = Math.max(80, Math.abs(targetCenter.y - sourceCenter.y) + padding * 2);

  return {
    ...card,
    x,
    y,
    width,
    height,
    content: {
      ...content,
      points: [
        { x: sourceCenter.x - x, y: sourceCenter.y - y },
        { x: targetCenter.x - x, y: targetCenter.y - y }
      ]
    }
  };
}

function isBoardDescendant(boards: Board[], boardId: string, ancestorId: string) {
  let current = boards.find((board) => board.id === boardId);
  while (current?.parentBoardId) {
    if (current.parentBoardId === ancestorId) return true;
    current = boards.find((board) => board.id === current?.parentBoardId);
  }
  return false;
}
