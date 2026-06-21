import {
  Archive,
  PanelRightClose,
  PanelRightOpen,
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
import {
  backupNowWithBackend,
  checkForDesktopUpdate,
  fetchPreviewFromBackend,
  getBackupDirFromBackend,
  loadWorkspaceFromBackend,
  openPathWithBackend,
  revealPathWithBackend,
  saveWorkspaceToBackend,
  selectBackupDirWithDialog,
  setBackupDirInBackend
} from "../lib/backend";
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
  { type: "file", label: "Upload", icon: Upload }
];

const colors = ["#f0b86e", "#f26f66", "#6fc7e8", "#79c58a", "#b986e8", "#f2d76b"];
const drawColors = ["#f0b86e", "#f26f66", "#6fc7e8", "#79c58a", "#b986e8", "#f2d76b", "#e5edf7", "#151b26"];
const minZoom = 0.08;
const maxZoom = 5;
const zoomStep = 0.15;

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

interface EntityClipboard {
  mode: "copy" | "cut";
  cardIds: string[];
  sourceBoardId: string;
  anchor: { x: number; y: number };
  snapshot?: {
    cards: CanvasCard[];
    boards: Board[];
  };
}

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => loadWorkspace());
  const [draggingCard, setDraggingCard] = useState<string | null>(null);
  const [resizingCard, setResizingCard] = useState<string | null>(null);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const [activeStroke, setActiveStroke] = useState<DrawStroke | null>(null);
  const [panningCanvas, setPanningCanvas] = useState(false);
  const [collapsedMarkdownIds, setCollapsedMarkdownIds] = useState<string[]>([]);
  const [entityClipboard, setEntityClipboard] = useState<EntityClipboard | null>(null);
  const [cutCardIds, setCutCardIds] = useState<string[]>([]);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [rightPanelMode, setRightPanelMode] = useState<"unsorted" | "trash" | "settings">("unsorted");
  const [search, setSearch] = useState("");
  const [spacePressed, setSpacePressed] = useState(false);
  const [backupDir, setBackupDir] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [updateMessage, setUpdateMessage] = useState("");
  const boardRef = useRef<HTMLDivElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const lastPointerPoint = useRef({ x: 0, y: 0 });
  const lastCanvasClientPoint = useRef({ x: 360, y: 260 });
  const panStart = useRef({ clientX: 0, clientY: 0, x: 0, y: 0 });

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
    getBackupDirFromBackend()
      .then((path) => setBackupDir(path))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpacePressed(true);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "x" && !isEditableElement(document.activeElement)) {
        if (workspace.selectedCardIds.length > 0) {
          event.preventDefault();
          cutSelectedCards();
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && !isEditableElement(document.activeElement)) {
        if (workspace.selectedCardIds.length > 0) {
          event.preventDefault();
          copySelectedCards();
        }
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

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (isEditableElement(document.activeElement)) return;
      if (entityClipboard) {
        event.preventDefault();
        pasteEntityClipboard();
        return;
      }
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      const handled = pasteClipboardData(clipboard);
      if (handled) event.preventDefault();
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  });

  const currentBoard = workspace.boards.find((board) => board.id === workspace.currentBoardId) ?? workspace.boards[0];
  const columnChildIds = useMemo(() => getColumnChildIds(workspace.cards, currentBoard.id), [workspace.cards, currentBoard.id]);
  const visibleCards = workspace.cards
    .filter((card) => card.boardId === currentBoard.id && !card.trashedAt)
    .filter((card) => !cutCardIds.includes(card.id))
    .filter((card) => !workspace.unsortedCardIds.includes(card.id))
    .filter((card) => card.type === "line" || !columnChildIds.has(card.id))
    .filter((card) => matchesSearch(card, search))
    .sort((a, b) => a.zIndex - b.zIndex);
  const renderCards = visibleCards.map((card) => resolveLineCard(card, workspace.cards));
  const visibleStrokes = workspace.drawingStrokes.filter((stroke) => stroke.boardId === currentBoard.id && !stroke.trashedAt);
  const trashCount = workspace.cards.filter((card) => card.trashedAt).length;
  const unsortedCards = workspace.unsortedCardIds
    .map((id) => workspace.cards.find((card) => card.id === id && !card.trashedAt))
    .filter((card): card is CanvasCard => Boolean(card));
  const trashedCards = workspace.cards.filter((card) => card.trashedAt);
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
        unsortedCardIds: [...current.unsortedCardIds],
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
          icon: "в—†",
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
        const sourcePath = getDroppedFilePath(file);
        const assetId = createId("asset");
        draft.assets.push({
          id: assetId,
          originalName: file?.name ?? "Local file",
          mimeType: file?.type ?? "application/octet-stream",
          size: file?.size ?? 0,
          objectUrl,
          sourcePath,
          createdAt: now
        });
        const droppedType = file ? resolveDroppedFileType(file) : type;
        card = makeCard(id, droppedType, x, y, 300, droppedType === "image" ? 250 : 150, draft.cards.length + 1, {
          assetId,
          fileName: file?.name ?? "Local file",
          mimeType: file?.type ?? "application/octet-stream",
          size: file?.size ?? 0,
          thumbnailUrl: objectUrl,
          sourcePath
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

  function createLinkCard(url: string, x: number, y: number) {
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) return;
    const id = createId("card");
    update((draft) => {
      const card = makeCard(id, "link", x, y, 320, 220, draft.cards.length + 1, {
        url: normalizedUrl,
        title: titleFromUrl(normalizedUrl),
        description: "Preview metadata will be fetched by the Tauri backend in the desktop build.",
        showImage: true,
        showDescription: true
      });
      draft.cards.push(card);
      draft.selectedCardIds = [card.id];
      return draft;
    });
    fetchPreviewFromBackend(normalizedUrl)
      .then((preview) => {
        if (!preview) return;
        updateCardContent(id, {
          title: preview.title,
          description: preview.description,
          imageUrl: preview.image_url
        });
      })
      .catch(() => undefined);
  }

  function createTextNote(text: string, x: number, y: number) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const id = createId("card");
    update((draft) => {
      const card = makeCard(id, "note", x, y, 340, 240, draft.cards.length + 1, {
        text: trimmed,
        format: "normal"
      });
      draft.cards.push(card);
      draft.selectedCardIds = [card.id];
      return draft;
    });
  }

  function pasteClipboardData(clipboard: DataTransfer) {
    const point = canvasPoint(lastCanvasClientPoint.current.x, lastCanvasClientPoint.current.y);
    const files = Array.from(clipboard.files);
    if (files.length > 0) {
      files.forEach((file, index) => createCard(resolveDroppedFileType(file), point.x + index * 24, point.y + index * 24, file));
      return true;
    }

    const imageItem = Array.from(clipboard.items).find((item) => item.kind === "file" && item.type.startsWith("image/"));
    const imageFile = imageItem?.getAsFile();
    if (imageFile) {
      createCard("image", point.x, point.y, imageFile);
      return true;
    }

    const text = clipboard.getData("text/plain").trim();
    if (!text) return false;
    const pastedUrl = extractSingleUrl(text);
    if (pastedUrl) {
      createLinkCard(pastedUrl, point.x, point.y);
    } else {
      createTextNote(text, point.x, point.y);
    }
    return true;
  }

  function handleToolClick(type: CardType) {
    if (type === "file") {
      uploadInputRef.current?.click();
      return;
    }
    if (type === "line" && workspace.selectedCardIds.length >= 2) {
      createConnectorBetween(workspace.selectedCardIds[0], workspace.selectedCardIds[1]);
      return;
    }
    createCard(type, 160, 140);
  }

  function handleUploadFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    const rect = boardRef.current?.getBoundingClientRect();
    const point = rect
      ? canvasPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      : canvasPoint(lastCanvasClientPoint.current.x, lastCanvasClientPoint.current.y);
    files.forEach((file, index) => createCard(resolveDroppedFileType(file), point.x + index * 24, point.y + index * 24, file));
    event.target.value = "";
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

  function handleColumnChildDrag(cardId: string, columnId: string, event: React.DragEvent) {
    event.stopPropagation();
    event.dataTransfer.setData("application/acanvas-column-child", JSON.stringify({ cardId, columnId }));
    event.dataTransfer.effectAllowed = "move";
  }

  function handleUnsortedDrag(cardId: string, event: React.DragEvent) {
    event.dataTransfer.setData("application/acanvas-unsorted-card", JSON.stringify({ cardId }));
    event.dataTransfer.effectAllowed = "move";
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
    const columnChild = event.dataTransfer.getData("application/acanvas-column-child");
    if (columnChild) {
      const payload = JSON.parse(columnChild) as { cardId: string; columnId: string };
      moveCardOutOfColumn(payload.cardId, payload.columnId, point);
      return;
    }
    const unsortedCard = event.dataTransfer.getData("application/acanvas-unsorted-card");
    if (unsortedCard) {
      const payload = JSON.parse(unsortedCard) as { cardId: string };
      moveCardFromUnsorted(payload.cardId, point);
      return;
    }
    const files = Array.from(event.dataTransfer.files);
    files.forEach((file, index) => createCard(resolveDroppedFileType(file), point.x + index * 24, point.y + index * 24, file));
  }

  function startDrag(card: CanvasCard, event: React.PointerEvent) {
    if (spacePressed) return;
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
      if (target && target.type !== "line") target.zIndex = maxZ + 1;
      return draft;
    }, false);
  }

  function moveCard(event: React.PointerEvent) {
    lastCanvasClientPoint.current = { x: event.clientX, y: event.clientY };
    if (!draggingCard && !resizingCard && !selectionRect && !activeStroke && !panningCanvas) return;
    if (panningCanvas) {
      const dx = event.clientX - panStart.current.clientX;
      const dy = event.clientY - panStart.current.clientY;
      setWorkspace((current) => ({
        ...current,
        pan: { x: panStart.current.x + dx, y: panStart.current.y + dy }
      }));
      return;
    }
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
    if (panningCanvas) {
      setPanningCanvas(false);
      return;
    }
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
    if (spacePressed) {
      panStart.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        x: workspace.pan.x,
        y: workspace.pan.y
      };
      setPanningCanvas(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
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
        if (target.type === "board" && "boardId" in target.content && "title" in patch) {
          const boardContent = target.content as BoardContent;
          const nextTitle = String(patch.title ?? boardContent.title);
          draft.boards = draft.boards.map((board) =>
            board.id === boardContent.boardId ? { ...board, title: nextTitle, updatedAt: nowIso() } : board
          );
        }
      }
      return draft;
    });
  }

  function openFolderPath(path: string) {
    openPathWithBackend(path).catch((error) => {
      window.alert(error instanceof Error ? error.message : "Unable to open path");
    });
  }

  function revealFolderPath(path: string) {
    revealPathWithBackend(path).catch((error) => {
      window.alert(error instanceof Error ? error.message : "Unable to reveal path");
    });
  }

  function popOutFromColumn(cardId: string, columnId: string) {
    const column = workspace.cards.find((card) => card.id === columnId);
    const target = column ? { x: column.x + column.width + 28, y: column.y + 24 } : { x: 180, y: 180 };
    moveCardOutOfColumn(cardId, columnId, target);
  }

  function moveCardOutOfColumn(cardId: string, columnId: string, point: { x: number; y: number }) {
    update((draft) => {
      const column = draft.cards.find((card) => card.id === columnId);
      const child = draft.cards.find((card) => card.id === cardId);
      if (!column || !child || !("childCardIds" in column.content)) return draft;
      const content = column.content as ColumnContent;
      column.content = {
        ...content,
        childCardIds: content.childCardIds.filter((id) => id !== cardId)
      };
      child.boardId = currentBoard.id;
      child.x = Math.round(point.x);
      child.y = Math.round(point.y);
      child.zIndex = Math.max(0, ...draft.cards.map((card) => card.zIndex)) + 1;
      child.updatedAt = nowIso();
      draft.selectedCardIds = [child.id];
      return draft;
    });
  }

  function moveCardFromUnsorted(cardId: string, point: { x: number; y: number }) {
    update((draft) => {
      const card = draft.cards.find((candidate) => candidate.id === cardId);
      if (!card) return draft;
      draft.unsortedCardIds = draft.unsortedCardIds.filter((id) => id !== cardId);
      card.boardId = currentBoard.id;
      card.x = Math.round(point.x);
      card.y = Math.round(point.y);
      card.zIndex = Math.max(0, ...draft.cards.map((candidate) => candidate.zIndex)) + 1;
      card.updatedAt = nowIso();
      draft.selectedCardIds = [card.id];
      return draft;
    });
  }

  function sendSelectedToUnsorted() {
    update((draft) => {
      draft.unsortedCardIds = Array.from(new Set([...draft.unsortedCardIds, ...draft.selectedCardIds]));
      draft.selectedCardIds = [];
      return draft;
    });
    setRightPanelOpen(true);
    setRightPanelMode("unsorted");
  }

  function cutSelectedCards() {
    const cardIds = expandCutCardIds(workspace.selectedCardIds, workspace.cards);
    const cards = workspace.cards.filter((card) => cardIds.includes(card.id) && !card.trashedAt);
    if (cards.length === 0) return;
    const anchor = {
      x: Math.min(...cards.map((card) => card.x)),
      y: Math.min(...cards.map((card) => card.y))
    };
    setEntityClipboard({ mode: "cut", cardIds, sourceBoardId: currentBoard.id, anchor });
    setCutCardIds(cardIds);
    update((draft) => {
      draft.selectedCardIds = [];
      return draft;
    }, false);
    navigator.clipboard?.writeText(`ACANVAS cut: ${cards.length} ${cards.length === 1 ? "entity" : "entities"}`).catch(() => undefined);
  }

  function copySelectedCards() {
    const cardIds = expandCutCardIds(workspace.selectedCardIds, workspace.cards);
    const cards = workspace.cards.filter((card) => cardIds.includes(card.id) && !card.trashedAt);
    if (cards.length === 0) return;
    const boardIds = new Set<string>();
    cards.forEach((card) => {
      if (card.type === "board" && "boardId" in card.content) {
        collectBoardSubtreeIds((card.content as BoardContent).boardId, workspace.boards, boardIds);
      }
    });
    const anchor = {
      x: Math.min(...cards.map((card) => card.x)),
      y: Math.min(...cards.map((card) => card.y))
    };
    setEntityClipboard({
      mode: "copy",
      cardIds,
      sourceBoardId: currentBoard.id,
      anchor,
      snapshot: {
        cards: deepClone(cards),
        boards: deepClone(workspace.boards.filter((board) => boardIds.has(board.id)))
      }
    });
    setCutCardIds([]);
    navigator.clipboard?.writeText(`ACANVAS copy: ${cards.length} ${cards.length === 1 ? "entity" : "entities"}`).catch(() => undefined);
  }

  function pasteEntityClipboard() {
    if (!entityClipboard) return;
    if (entityClipboard.mode === "copy") {
      pasteCopiedCards(entityClipboard);
      return;
    }
    pasteCutCards(entityClipboard);
  }

  function pasteCutCards(clipboard: EntityClipboard) {
    const point = canvasPoint(lastCanvasClientPoint.current.x, lastCanvasClientPoint.current.y);
    update((draft) => {
      const now = nowIso();
      const existingCards = draft.cards.filter((card) => clipboard.cardIds.includes(card.id));
      if (existingCards.length === 0) return draft;
      const delta = {
        x: Math.round(point.x - clipboard.anchor.x),
        y: Math.round(point.y - clipboard.anchor.y)
      };
      const maxZ = Math.max(0, ...draft.cards.map((card) => card.zIndex));
      const movedCardIds = new Set(existingCards.map((card) => card.id));
      const movedBoardIds = new Set<string>();

      existingCards.forEach((card, index) => {
        card.boardId = currentBoard.id;
        card.x = Math.round(card.x + delta.x);
        card.y = Math.round(card.y + delta.y);
        card.zIndex = card.type === "line" ? card.zIndex : maxZ + index + 1;
        card.updatedAt = now;
        if (card.type === "board" && "boardId" in card.content) {
          movedBoardIds.add((card.content as BoardContent).boardId);
        }
      });

      draft.boards = draft.boards.map((board) =>
        movedBoardIds.has(board.id)
          ? { ...board, parentBoardId: currentBoard.id, updatedAt: now }
          : board
      );
      draft.unsortedCardIds = draft.unsortedCardIds.filter((id) => !movedCardIds.has(id));
      draft.selectedCardIds = existingCards.map((card) => card.id);
      return draft;
    });
    setEntityClipboard(null);
    setCutCardIds([]);
  }

  function pasteCopiedCards(clipboard: EntityClipboard) {
    if (!clipboard.snapshot) return;
    const point = canvasPoint(lastCanvasClientPoint.current.x, lastCanvasClientPoint.current.y);
    update((draft) => {
      const now = nowIso();
      const idMap = new Map<string, string>();
      const boardIdMap = new Map<string, string>();
      clipboard.snapshot?.boards.forEach((board) => boardIdMap.set(board.id, createId("board")));
      clipboard.snapshot?.cards.forEach((card) => idMap.set(card.id, createId("card")));
      const delta = {
        x: Math.round(point.x - clipboard.anchor.x),
        y: Math.round(point.y - clipboard.anchor.y)
      };
      const maxZ = Math.max(0, ...draft.cards.map((card) => card.zIndex));
      const copiedBoards = clipboard.snapshot?.boards.map((board) => ({
        ...board,
        id: boardIdMap.get(board.id) ?? createId("board"),
        parentBoardId: board.parentBoardId && boardIdMap.has(board.parentBoardId)
          ? boardIdMap.get(board.parentBoardId) ?? currentBoard.id
          : currentBoard.id,
        title: `${board.title} copy`,
        createdAt: now,
        updatedAt: now,
        trashedAt: null
      })) ?? [];
      const copiedCards = (clipboard.snapshot?.cards ?? []).map((card, index) => {
        const next = deepClone(card);
        next.id = idMap.get(card.id) ?? createId("card");
        next.boardId = currentBoard.id;
        next.x = Math.round(card.x + delta.x);
        next.y = Math.round(card.y + delta.y);
        next.zIndex = next.type === "line" ? card.zIndex : maxZ + index + 1;
        next.createdAt = now;
        next.updatedAt = now;
        next.trashedAt = null;
        if (next.type === "column" && "childCardIds" in next.content) {
          const content = next.content as ColumnContent;
          content.childCardIds = content.childCardIds.map((id) => idMap.get(id) ?? id);
        }
        if (next.type === "line" && "points" in next.content) {
          const content = next.content as LineContent;
          if (content.sourceCardId) content.sourceCardId = idMap.get(content.sourceCardId) ?? content.sourceCardId;
          if (content.targetCardId) content.targetCardId = idMap.get(content.targetCardId) ?? content.targetCardId;
        }
        if (next.type === "board" && "boardId" in next.content) {
          const content = next.content as BoardContent;
          const newBoardId = boardIdMap.get(content.boardId) ?? createId("board");
          content.boardId = newBoardId;
          content.title = `${content.title} copy`;
        }
        return next;
      });
      draft.boards.push(...copiedBoards);
      draft.cards.push(...copiedCards);
      draft.selectedCardIds = copiedCards.map((card) => card.id);
      return draft;
    });
  }

  function restoreCard(cardId: string) {
    update((draft) => {
      draft.cards = draft.cards.map((card) => (card.id === cardId ? { ...card, trashedAt: null } : card));
      return draft;
    });
  }

  function deleteCardPermanently(cardId: string) {
    update((draft) => {
      return purgeCardsFromDraft(draft, [cardId]);
    });
  }

  function deleteAllTrash() {
    update((draft) => {
      return purgeCardsFromDraft(draft, draft.cards.filter((card) => card.trashedAt).map((card) => card.id));
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

  function exportJson() {
    const blob = new Blob([exportWorkspaceJson(workspace)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `acanvas-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function chooseBackupFolder() {
    setSettingsMessage("");
    try {
      const selected = await selectBackupDirWithDialog();
      if (!selected) return;
      await setBackupDirInBackend(selected);
      setBackupDir(selected);
      setSettingsMessage("Backup folder saved. ACANVAS will keep the latest workspace snapshot there.");
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : "Unable to choose backup folder.");
    }
  }

  async function runBackupNow() {
    setSettingsMessage("");
    try {
      const path = await backupNowWithBackend();
      setSettingsMessage(path ? `Backup updated: ${path}` : "Choose a backup folder first.");
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : "Unable to update backup.");
    }
  }

  async function checkForUpdates() {
    setUpdateMessage("");
    try {
      const status = await checkForDesktopUpdate();
      setUpdateMessage(status === "available" ? "Update is available. Install it from the release notification." : "ACANVAS is up to date.");
    } catch (error) {
      setUpdateMessage(error instanceof Error ? error.message : "Unable to check for updates.");
    }
  }

  return (
    <div className={`app ${rightPanelOpen ? "" : "rightPanelClosed"}`}>
      <input
        ref={uploadInputRef}
        className="hiddenFileInput"
        data-testid="upload-input"
        type="file"
        multiple
        onChange={handleUploadFiles}
      />
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
          <button
            title="Settings"
            onClick={() => {
              setRightPanelOpen(true);
              setRightPanelMode("settings");
            }}
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      <aside className="toolbar">
        {toolbar.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.type}
              draggable={tool.type !== "file"}
              title={tool.label}
              onDragStart={(event) => {
                if (tool.type === "file") {
                  event.preventDefault();
                  return;
                }
                handleToolbarDrag({ kind: tool.type, label: tool.label }, event);
              }}
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
        <button
          className={`trashButton ${rightPanelMode === "trash" && rightPanelOpen ? "isActiveTool" : ""}`}
          title="Open trash"
          onClick={() => {
            setRightPanelOpen(true);
            setRightPanelMode("trash");
          }}
        >
          <Trash2 size={20} />
          <span>Trash {trashCount}</span>
        </button>
      </aside>

      <main
        ref={boardRef}
        className={`canvasHost ${spacePressed || panningCanvas ? "isPanning" : ""} ${panningCanvas ? "isPanningActive" : ""}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleCanvasDrop}
        onPointerDown={startMarquee}
        onPointerMove={moveCard}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onWheel={(event) => {
          if (!event.ctrlKey) return;
          event.preventDefault();
          const nextZoom = clampZoom(workspace.zoom - event.deltaY * 0.0015);
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
              onRevealPath={revealFolderPath}
              onPopOutFromColumn={popOutFromColumn}
              onColumnChildDrag={handleColumnChildDrag}
              onChange={(patch) => updateCardContent(card.id, patch)}
              onUpdateCardContent={updateCardContent}
              noteSourceCollapsed={collapsedMarkdownIds.includes(card.id)}
              onToggleNoteSource={() =>
                setCollapsedMarkdownIds((ids) =>
                  ids.includes(card.id) ? ids.filter((id) => id !== card.id) : [...ids, card.id]
                )
              }
            />
          ))}
        </div>
        {selectionRect && <SelectionBox rect={normalizeRect(selectionRect.start, selectionRect.current)} zoom={workspace.zoom} pan={workspace.pan} />}
        <div className="zoomDock">
          <button onClick={() => setWorkspace((state) => ({ ...state, zoom: clampZoom(state.zoom - zoomStep) }))}>-</button>
          <span>{Math.round(workspace.zoom * 100)}%</span>
          <button onClick={() => setWorkspace((state) => ({ ...state, zoom: clampZoom(state.zoom + zoomStep) }))}>+</button>
        </div>
      </main>

      <button
        className="sidePanelToggle"
        title={rightPanelOpen ? "Hide sidebar" : "Show sidebar"}
        onClick={() => setRightPanelOpen((open) => !open)}
      >
        {rightPanelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
      </button>

      <aside className="sidePanel">
        <div className="panelHeader">
          {rightPanelMode === "trash" ? <Trash2 size={18} /> : rightPanelMode === "settings" ? <Settings size={18} /> : <Archive size={18} />}
          <strong>{rightPanelMode === "trash" ? "Trash" : rightPanelMode === "settings" ? "Settings" : "Unsorted"}</strong>
        </div>
        <div className="panelTabs">
          <button className={rightPanelMode === "unsorted" ? "isSelected" : ""} onClick={() => setRightPanelMode("unsorted")}>
            Unsorted
          </button>
          <button className={rightPanelMode === "trash" ? "isSelected" : ""} onClick={() => setRightPanelMode("trash")}>
            Trash {trashCount}
          </button>
          <button className={rightPanelMode === "settings" ? "isSelected" : ""} onClick={() => setRightPanelMode("settings")}>
            Settings
          </button>
        </div>
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
        {rightPanelMode === "unsorted" && (
          <>
            <button className="secondaryAction" disabled={workspace.selectedCardIds.length === 0} onClick={sendSelectedToUnsorted}>
              <Archive size={16} />
              Send selected
            </button>
            <div className="stagingList">
              {unsortedCards.length === 0 ? (
                <span className="emptyHint">No staged entities</span>
              ) : (
                unsortedCards.map((card) => (
                  <PanelCardRow key={card.id} card={card} onDragStart={handleUnsortedDrag} />
                ))
              )}
            </div>
          </>
        )}
        {rightPanelMode === "trash" && (
          <div className="stagingList">
            {trashedCards.length === 0 ? (
              <span className="emptyHint">Trash is empty</span>
            ) : (
              trashedCards.map((card) => (
                <PanelCardRow
                  key={card.id}
                  card={card}
                  actionLabel="Restore"
                  onAction={() => restoreCard(card.id)}
                  dangerActionLabel="Delete"
                  onDangerAction={() => deleteCardPermanently(card.id)}
                />
              ))
            )}
          </div>
        )}
        {rightPanelMode === "trash" && trashedCards.length > 0 && (
          <button className="dangerAction" onClick={deleteAllTrash}>
            <Trash2 size={16} />
            Delete all
          </button>
        )}
        {rightPanelMode === "settings" && (
          <div className="settingsPanel">
            <div className="settingsGroup">
              <strong>Backup folder</strong>
              <p>{backupDir ?? "No backup folder selected"}</p>
              <button className="secondaryAction" onClick={chooseBackupFolder}>
                Choose folder
              </button>
              <button className="secondaryAction" onClick={runBackupNow}>
                Backup now
              </button>
              {settingsMessage && <span className="settingsNote">{settingsMessage}</span>}
            </div>
            <div className="settingsGroup">
              <strong>Updates</strong>
              <p>Desktop builds can check GitHub Releases and notify you when a new version is available.</p>
              <button className="secondaryAction" onClick={checkForUpdates}>
                Check updates
              </button>
              {updateMessage && <span className="settingsNote">{updateMessage}</span>}
            </div>
          </div>
        )}
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
  onRevealPath,
  onPopOutFromColumn,
  onColumnChildDrag,
  onChange,
  onUpdateCardContent,
  noteSourceCollapsed,
  onToggleNoteSource
}: {
  card: CanvasCard;
  allCards: CanvasCard[];
  selected: boolean;
  onPointerDown: (event: React.PointerEvent) => void;
  onResize: (event: React.PointerEvent) => void;
  onOpenBoard: (boardId: string) => void;
  onOpenPath: (path: string) => void;
  onRevealPath: (path: string) => void;
  onPopOutFromColumn: (cardId: string, columnId: string) => void;
  onColumnChildDrag: (cardId: string, columnId: string, event: React.DragEvent) => void;
  onChange: (patch: Partial<CanvasCard["content"]>) => void;
  onUpdateCardContent: (cardId: string, patch: Partial<CanvasCard["content"]>) => void;
  noteSourceCollapsed: boolean;
  onToggleNoteSource: () => void;
}) {
  return (
    <section
      className={`card card-${card.type} ${selected ? "isSelected" : ""}`}
      style={{
        left: card.x,
        top: card.y,
        width: card.width,
        height: card.height,
        zIndex: card.type === "line" ? 0 : card.zIndex
      }}
      onPointerDown={onPointerDown}
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
        onRevealPath={onRevealPath}
        onPopOutFromColumn={onPopOutFromColumn}
        onColumnChildDrag={onColumnChildDrag}
        onUpdateCardContent={onUpdateCardContent}
        noteSourceCollapsed={noteSourceCollapsed}
        onToggleNoteSource={onToggleNoteSource}
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
  onRevealPath,
  onPopOutFromColumn,
  onColumnChildDrag,
  onUpdateCardContent,
  noteSourceCollapsed,
  onToggleNoteSource
}: {
  card: CanvasCard;
  allCards: CanvasCard[];
  onChange: (patch: Partial<CanvasCard["content"]>) => void;
  onOpenBoard: (boardId: string) => void;
  onOpenPath: (path: string) => void;
  onRevealPath: (path: string) => void;
  onPopOutFromColumn: (cardId: string, columnId: string) => void;
  onColumnChildDrag: (cardId: string, columnId: string, event: React.DragEvent) => void;
  onUpdateCardContent: (cardId: string, patch: Partial<CanvasCard["content"]>) => void;
  noteSourceCollapsed: boolean;
  onToggleNoteSource: () => void;
}) {
  if (card.type === "note" && "text" in card.content) {
    const hasMarkdown = containsMarkdown(card.content.text);
    return (
      <div className={`noteCard ${hasMarkdown ? "hasMarkdown" : "plainNote"} ${noteSourceCollapsed ? "sourceCollapsed" : ""}`}>
        {hasMarkdown && (
          <button
            data-no-drag
            className="markdownToggle"
            onClick={onToggleNoteSource}
            title={noteSourceCollapsed ? "Show markdown source" : "Hide markdown source"}
          >
            {noteSourceCollapsed ? "Edit" : "Preview"}
          </button>
        )}
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
    const content = card.content;
    return (
      <div className="fileCard">
        {renderFilePreview(content)}
        <strong>{content.fileName}</strong>
        <small>{formatBytes(content.size)} · {content.mimeType || "file"}</small>
        <div className="fileActions" data-no-drag>
          {content.thumbnailUrl && (
            <button onClick={() => window.open(content.thumbnailUrl, "_blank", "noopener,noreferrer")}>
              Preview
            </button>
          )}
          {content.sourcePath && (
            <>
              <button onClick={() => onOpenPath(content.sourcePath ?? "")}>Open source</button>
              <button onClick={() => onRevealPath(content.sourcePath ?? "")}>Reveal</button>
            </>
          )}
        </div>
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
      <div data-no-drag className="boardCardButton">
        <span className="boardIcon" style={{ background: content.color }}>{content.icon}</span>
        <input
          value={content.title}
          onChange={(event) => onChange({ title: event.target.value })}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          aria-label="Board title"
        />
        <button onClick={() => onOpenBoard(content.boardId)}>Open board</button>
      </div>
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
                  onDragStart={onColumnChildDrag}
                  onUpdateCardContent={onUpdateCardContent}
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
        <input
          data-no-drag
          className="todoTitleInput"
          value={content.title}
          onChange={(event) => onChange({ title: event.target.value })}
          aria-label="Todo title"
        />
        <div className="todoItems">
          {content.items.map((item) => (
            <div key={item.id} className="todoItem" data-no-drag>
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
                aria-label={`Toggle ${item.text || "task"}`}
              />
              <input
                className="todoTextInput"
                value={item.text}
                onChange={(event) =>
                  onChange({
                    items: content.items.map((candidate) =>
                      candidate.id === item.id ? { ...candidate, text: event.target.value } : candidate
                    )
                  })
                }
                aria-label="Todo item"
              />
              <button
                className="todoDelete"
                onClick={() => onChange({ items: content.items.filter((candidate) => candidate.id !== item.id) })}
                aria-label="Delete todo item"
              >
                x
              </button>
            </div>
          ))}
        </div>
        <button
          data-no-drag
          className="todoAdd"
          onClick={() => onChange({ items: [...content.items, { id: createId("todo"), text: "New task", done: false }] })}
        >
          Add task
        </button>
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
  onPopOut,
  onDragStart,
  onUpdateCardContent
}: {
  card: CanvasCard;
  columnId: string;
  onOpenBoard: (boardId: string) => void;
  onOpenPath: (path: string) => void;
  onPopOut: (cardId: string, columnId: string) => void;
  onDragStart: (cardId: string, columnId: string, event: React.DragEvent) => void;
  onUpdateCardContent: (cardId: string, patch: Partial<CanvasCard["content"]>) => void;
}) {
  const label = getCardLabel(card);
  const accent = card.style.accent ?? "#6fc7e8";
  if (card.type === "board" && "boardId" in card.content) {
    const content = card.content as BoardContent;
    return (
      <button
        data-no-drag
        draggable
        className="columnChild"
        onDragStart={(event) => onDragStart(card.id, columnId, event)}
        onClick={() => onOpenBoard(content.boardId)}
        title="Open board"
      >
        <span className="columnChildAccent" style={{ background: content.color }} />
        <strong>{label}</strong>
        <small>Board</small>
        <CornerUpRight size={15} />
      </button>
    );
  }

  if (card.type === "link" && "url" in card.content) {
    const content = card.content as LinkContent;
    return (
      <button
        data-no-drag
        draggable
        className="columnChild"
        onDragStart={(event) => onDragStart(card.id, columnId, event)}
        onClick={() => window.open(content.url, "_blank", "noopener,noreferrer")}
        title="Open link"
      >
        <span className="columnChildAccent" style={{ background: accent }} />
        <strong>{label}</strong>
        <small>Link</small>
        <CornerUpRight size={15} />
      </button>
    );
  }

  if (card.type === "folder" && "path" in card.content) {
    const content = card.content as FolderContent;
    return (
      <button
        data-no-drag
        draggable
        className="columnChild"
        onDragStart={(event) => onDragStart(card.id, columnId, event)}
        onClick={() => onOpenPath(content.path)}
        title="Open folder"
      >
        <span className="columnChildAccent" style={{ background: accent }} />
        <strong>{label}</strong>
        <small>Folder</small>
        <CornerUpRight size={15} />
      </button>
    );
  }

  if (card.type === "note" && "text" in card.content) {
    return (
      <div data-no-drag draggable className="columnEmbedded columnEmbedded-note" onDragStart={(event) => onDragStart(card.id, columnId, event)}>
        <span className="columnChildAccent" style={{ background: accent }} />
        <textarea value={card.content.text} onChange={(event) => onUpdateCardContent(card.id, { text: event.target.value })} />
      </div>
    );
  }

  if (card.type === "title" && "text" in card.content) {
    return (
      <div data-no-drag draggable className="columnEmbedded columnEmbedded-title" onDragStart={(event) => onDragStart(card.id, columnId, event)}>
        <span className="columnChildAccent" style={{ background: accent }} />
        <input value={card.content.text} onChange={(event) => onUpdateCardContent(card.id, { text: event.target.value })} />
      </div>
    );
  }

  if (card.type === "comment" && "text" in card.content) {
    return (
      <div data-no-drag draggable className="columnEmbedded columnEmbedded-comment" onDragStart={(event) => onDragStart(card.id, columnId, event)}>
        <span className="columnChildAccent" style={{ background: accent }} />
        <textarea value={card.content.text} onChange={(event) => onUpdateCardContent(card.id, { text: event.target.value })} />
      </div>
    );
  }

  if (card.type === "todo" && "items" in card.content) {
    const content = card.content as TodoContent;
    return (
      <div data-no-drag draggable className="columnEmbedded columnEmbedded-todo" onDragStart={(event) => onDragStart(card.id, columnId, event)}>
        <span className="columnChildAccent" style={{ background: accent }} />
        <input
          className="todoTitleInput"
          value={content.title}
          onChange={(event) => onUpdateCardContent(card.id, { title: event.target.value })}
          aria-label="Todo title"
        />
        {content.items.map((item) => (
          <div key={item.id} className="todoItem">
            <input
              type="checkbox"
              checked={item.done}
              onChange={() =>
                onUpdateCardContent(card.id, {
                  items: content.items.map((candidate) =>
                    candidate.id === item.id ? { ...candidate, done: !candidate.done } : candidate
                  )
                })
              }
              aria-label={`Toggle ${item.text || "task"}`}
            />
            <input
              className="todoTextInput"
              value={item.text}
              onChange={(event) =>
                onUpdateCardContent(card.id, {
                  items: content.items.map((candidate) =>
                    candidate.id === item.id ? { ...candidate, text: event.target.value } : candidate
                  )
                })
              }
              aria-label="Todo item"
            />
            <button
              className="todoDelete"
              onClick={() => onUpdateCardContent(card.id, { items: content.items.filter((candidate) => candidate.id !== item.id) })}
              aria-label="Delete todo item"
            >
              x
            </button>
          </div>
        ))}
        <button
          className="todoAdd"
          onClick={() => onUpdateCardContent(card.id, { items: [...content.items, { id: createId("todo"), text: "New task", done: false }] })}
        >
          Add task
        </button>
      </div>
    );
  }

  return (
    <button
      data-no-drag
      draggable
      className="columnChild"
      onDragStart={(event) => onDragStart(card.id, columnId, event)}
      onClick={() => onPopOut(card.id, columnId)}
      title="Pop out to canvas"
    >
      <span className="columnChildAccent" style={{ background: accent }} />
      <strong>{label}</strong>
      <small>{card.type}</small>
      <CornerUpRight size={15} />
    </button>
  );
}

function PanelCardRow({
  card,
  actionLabel,
  onAction,
  dangerActionLabel,
  onDangerAction,
  onDragStart
}: {
  card: CanvasCard;
  actionLabel?: string;
  onAction?: () => void;
  dangerActionLabel?: string;
  onDangerAction?: () => void;
  onDragStart?: (cardId: string, event: React.DragEvent) => void;
}) {
  return (
    <div
      className="panelCardRow"
      draggable={Boolean(onDragStart)}
      onDragStart={(event) => onDragStart?.(card.id, event)}
    >
      <span style={{ background: card.style.accent ?? "#6fc7e8" }} />
      <strong>{getCardLabel(card)}</strong>
      {onAction ? <button onClick={onAction}>{actionLabel}</button> : <small>{card.type}</small>}
      {onDangerAction && (
        <button className="dangerInline" onClick={onDangerAction}>
          {dangerActionLabel}
        </button>
      )}
    </div>
  );
}

function clampZoom(value: number) {
  return Number(Math.min(maxZoom, Math.max(minZoom, value)).toFixed(2));
}

function purgeCardsFromDraft(draft: WorkspaceState, rootCardIds: string[]) {
  const boardIdsToDelete = new Set<string>();
  const cardIdsToDelete = new Set<string>(rootCardIds);

  rootCardIds.forEach((cardId) => {
    const rootCard = draft.cards.find((card) => card.id === cardId);
    if (rootCard?.type === "board" && "boardId" in rootCard.content) {
      collectBoardSubtreeIds(rootCard.content.boardId, draft.boards, boardIdsToDelete);
    }
  });

  draft.cards.forEach((card) => {
    if (boardIdsToDelete.has(card.boardId)) {
      cardIdsToDelete.add(card.id);
    }
  });

  draft.boards = draft.boards.filter((board) => !boardIdsToDelete.has(board.id));
  draft.cards = draft.cards.filter((card) => {
    if (cardIdsToDelete.has(card.id)) return false;
    if (card.type === "line" && "sourceCardId" in card.content) {
      const content = card.content as LineContent;
      return !(
        (content.sourceCardId && cardIdsToDelete.has(content.sourceCardId)) ||
        (content.targetCardId && cardIdsToDelete.has(content.targetCardId))
      );
    }
    return true;
  });
  draft.cards.forEach((card) => {
    if (card.type === "column" && "childCardIds" in card.content) {
      const content = card.content as ColumnContent;
      content.childCardIds = content.childCardIds.filter((id) => !cardIdsToDelete.has(id));
    }
  });
  draft.unsortedCardIds = draft.unsortedCardIds.filter((id) => !cardIdsToDelete.has(id));
  draft.selectedCardIds = draft.selectedCardIds.filter((id) => !cardIdsToDelete.has(id));
  if (boardIdsToDelete.has(draft.currentBoardId)) {
    draft.currentBoardId = "board_home";
  }
  return draft;
}

function collectBoardSubtreeIds(rootBoardId: string, boards: Board[], output: Set<string>) {
  output.add(rootBoardId);
  boards
    .filter((board) => board.parentBoardId === rootBoardId)
    .forEach((board) => collectBoardSubtreeIds(board.id, boards, output));
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

function renderFilePreview(content: { thumbnailUrl?: string; mimeType: string; fileName: string }) {
  if (content.thumbnailUrl && content.mimeType.startsWith("image/")) {
    return <img src={content.thumbnailUrl} alt="" />;
  }
  if (content.thumbnailUrl && content.mimeType.startsWith("video/")) {
    return <video src={content.thumbnailUrl} controls />;
  }
  if (content.thumbnailUrl && content.mimeType.startsWith("audio/")) {
    return (
      <div className="audioPreview">
        <FileUp size={30} />
        <audio src={content.thumbnailUrl} controls />
      </div>
    );
  }
  return <FileUp size={34} />;
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

function resolveDroppedFileType(file: File): CardType {
  if (file.type.startsWith("image/") || file.type.startsWith("video/") || file.type.startsWith("audio/")) {
    return "image";
  }
  return "file";
}

function expandCutCardIds(selectedCardIds: string[], cards: CanvasCard[]) {
  const ids = new Set(selectedCardIds);
  const visitColumn = (cardId: string) => {
    const card = cards.find((candidate) => candidate.id === cardId);
    if (!card || card.type !== "column" || !("childCardIds" in card.content)) return;
    const content = card.content as ColumnContent;
    content.childCardIds.forEach((childId) => {
      if (ids.has(childId)) return;
      ids.add(childId);
      visitColumn(childId);
    });
  };
  selectedCardIds.forEach(visitColumn);
  cards.forEach((card) => {
    if (card.type !== "line" || !("sourceCardId" in card.content)) return;
    const content = card.content as LineContent;
    if (content.sourceCardId && content.targetCardId && ids.has(content.sourceCardId) && ids.has(content.targetCardId)) {
      ids.add(card.id);
    }
  });
  return Array.from(ids);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getDroppedFilePath(file?: File) {
  if (!file) return undefined;
  const maybePath = (file as File & { path?: string }).path;
  return maybePath || undefined;
}

function isEditableElement(element: Element | null) {
  if (!element) return false;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  return element instanceof HTMLElement && element.isContentEditable;
}

function extractSingleUrl(text: string) {
  const value = text.trim();
  if (!value || /\s/.test(value)) return null;
  try {
    const url = normalizeUrl(value);
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
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
