import {
  Archive,
  PanelRightClose,
  PanelRightOpen,
  Brush,
  ChevronRight,
  Code2,
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
  Maximize2,
  MessageSquare,
  Minimize2,
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
  CornerUpRight,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { Board, CanvasCard, CardType, DrawStroke, DropPayload, DrawingContent, LineContent, WorkspaceState } from "../types";
import type { BoardContent, ColumnContent, FolderContent, LinkContent, TodoContent, WidgetContent } from "../types";
import {
  backupNowWithBackend,
  checkForDesktopUpdate,
  fetchPreviewFromBackend,
  getBackupDirFromBackend,
  getPathMetadata,
  isDesktopRuntime,
  loadWorkspaceFromBackend,
  openPathWithBackend,
  revealPathWithBackend,
  saveWorkspaceExportWithDialog,
  saveWorkspaceToBackend,
  saveClipboardAsset,
  selectBackupDirWithDialog,
  selectFilesWithDialog,
  setBackupDirInBackend,
  toAssetUrl,
  writeWorkspaceExportToBackend
} from "../lib/backend";
import { createId, nowIso } from "../lib/ids";
import { fileNameFromPath, formatBytes, getDroppedFilePath, isPreviewableMime, mimeFromPath, resolveDroppedFileType } from "../lib/files";
import { createWorkspaceExport, exportWorkspaceJson, loadWorkspace, saveWorkspace } from "../lib/storage";
import { normalizeUrl, titleFromUrl } from "../lib/url";

const toolbar: Array<{ type: CardType; label: string; icon: typeof StickyNote }> = [
  { type: "note", label: "Note", icon: StickyNote },
  { type: "link", label: "Link", icon: Link },
  { type: "todo", label: "To-do", icon: ListTodo },
  { type: "line", label: "Line", icon: Minus },
  { type: "title", label: "Title", icon: Heading1 },
  { type: "board", label: "Board", icon: Folder },
  { type: "folder", label: "Folder", icon: FolderOpen },
  { type: "widget", label: "Widget", icon: Code2 },
  { type: "column", label: "Column", icon: Columns3 },
  { type: "comment", label: "Comment", icon: MessageSquare },
  { type: "file", label: "Upload", icon: Upload }
];

const colors = ["#f0b86e", "#f26f66", "#6fc7e8", "#79c58a", "#b986e8", "#f2d76b"];
const drawColors = ["#f0b86e", "#f26f66", "#6fc7e8", "#79c58a", "#b986e8", "#f2d76b", "#e5edf7", "#151b26"];
const boardEmojis = ["📁", "🧭", "💡", "🎬", "📌", "🧠", "🧩", "🚀", "🎨", "📦", "🔖", "⭐"];
const minZoom = 0.08;
const maxZoom = 5;
const zoomStep = 0.15;
const pastedAssetCopyLimitBytes = 20 * 1024 * 1024;
const autoBackupIntervalKey = "acanvas.autoBackupIntervalMinutes";
const hotkeysStorageKey = "acanvas.entityHotkeys.v1";
const backupIntervals = [
  { label: "Every minute", value: 1 },
  { label: "Every 5 minutes", value: 5 },
  { label: "Every 30 minutes", value: 30 },
  { label: "Off", value: 0 }
];
const defaultEntityHotkeys: Partial<Record<CardType, string>> = {
  note: "N",
  link: "K",
  todo: "T",
  line: "I",
  title: "H",
  board: "B",
  folder: "F",
  widget: "W",
  column: "C",
  comment: "M",
  file: "U"
};

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

interface ToolbarPointerDrag {
  type: CardType;
  label: string;
  startX: number;
  startY: number;
  active: boolean;
}

interface BoardTab {
  id: string;
  boardId: string;
}

interface BoardContextMenuState {
  boardId: string;
  x: number;
  y: number;
}

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => loadWorkspace());
  const [draggingCard, setDraggingCard] = useState<string | null>(null);
  const [resizingCard, setResizingCard] = useState<string | null>(null);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const [activeStroke, setActiveStroke] = useState<DrawStroke | null>(null);
  const [activeLine, setActiveLine] = useState<CanvasCard | null>(null);
  const [panningCanvas, setPanningCanvas] = useState(false);
  const [collapsedMarkdownIds, setCollapsedMarkdownIds] = useState<string[]>([]);
  const [entityClipboard, setEntityClipboard] = useState<EntityClipboard | null>(null);
  const [cutCardIds, setCutCardIds] = useState<string[]>([]);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [rightPanelMode, setRightPanelMode] = useState<"unsorted" | "trash" | "settings">("unsorted");
  const [search, setSearch] = useState("");
  const [spacePressed, setSpacePressed] = useState(false);
  const [backupDir, setBackupDir] = useState<string | null>(null);
  const [autoBackupInterval, setAutoBackupInterval] = useState(() => readAutoBackupInterval());
  const [entityHotkeys, setEntityHotkeys] = useState<Partial<Record<CardType, string>>>(() => readEntityHotkeys());
  const [lastAutoBackupAt, setLastAutoBackupAt] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [updateMessage, setUpdateMessage] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [toolbarGhost, setToolbarGhost] = useState<{ label: string; x: number; y: number } | null>(null);
  const [boardTabs, setBoardTabs] = useState<BoardTab[]>([{ id: "tab_home", boardId: "board_home" }]);
  const [activeTabId, setActiveTabId] = useState("tab_home");
  const [boardContextMenu, setBoardContextMenu] = useState<BoardContextMenuState | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceRef = useRef(workspace);
  const transientUpdateRef = useRef(false);
  const pendingPersistRef = useRef(false);
  const persistTimerRef = useRef<number | null>(null);
  const autoBackupInFlightRef = useRef(false);
  const dragStartPoint = useRef({ x: 0, y: 0 });
  const dragStartCards = useRef<Array<{ id: string; x: number; y: number }>>([]);
  const toolbarPointerDragRef = useRef<ToolbarPointerDrag | null>(null);
  const suppressToolClickRef = useRef(false);
  const pointerFrameRef = useRef<number | null>(null);
  const latestPointerRef = useRef({ clientX: 0, clientY: 0, buttons: 0 });
  const lastPointerPoint = useRef({ x: 0, y: 0 });
  const lastCanvasClientPoint = useRef({ x: 360, y: 260 });
  const panStart = useRef({ clientX: 0, clientY: 0, x: 0, y: 0 });

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    if (transientUpdateRef.current) {
      pendingPersistRef.current = true;
      return;
    }
    if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      saveWorkspace(workspaceRef.current);
      saveWorkspaceToBackend(workspaceRef.current).catch(() => undefined);
    }, 120);
    return () => {
      if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
    };
  }, [workspace]);

  useEffect(() => () => {
    if (pointerFrameRef.current) cancelAnimationFrame(pointerFrameRef.current);
    if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
  }, []);

  useEffect(() => {
    localStorage.setItem(autoBackupIntervalKey, String(autoBackupInterval));
    if (!backupDir || autoBackupInterval <= 0) return;
    const intervalMs = autoBackupInterval * 60 * 1000;
    const timer = window.setInterval(() => {
      if (autoBackupInFlightRef.current) return;
      autoBackupInFlightRef.current = true;
      saveWorkspaceToBackend(workspaceRef.current)
        .then(() => backupNowWithBackend())
        .then((path) => {
          if (path) setLastAutoBackupAt(new Date().toLocaleTimeString());
        })
        .catch(() => undefined)
        .finally(() => {
          autoBackupInFlightRef.current = false;
        });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [backupDir, autoBackupInterval]);

  useEffect(() => {
    localStorage.setItem(hotkeysStorageKey, JSON.stringify(entityHotkeys));
  }, [entityHotkeys]);

  useEffect(() => {
    const closeMenu = () => setBoardContextMenu(null);
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeMenu);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeMenu);
    };
  }, []);

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    syncFullscreen();
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

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
    const cards = workspace.cards.filter((card) =>
      (card.type === "file" || card.type === "image") &&
      "sourcePath" in card.content &&
      card.content.sourcePath &&
      !card.content.thumbnailUrl
    );
    if (cards.length === 0) return;
    let cancelled = false;
    Promise.all(cards.map(async (card) => {
      if (!("sourcePath" in card.content) || !card.content.sourcePath) return null;
      const thumbnailUrl = await toAssetUrl(card.content.sourcePath).catch(() => null);
      return thumbnailUrl ? { id: card.id, thumbnailUrl } : null;
    })).then((updates) => {
      if (cancelled) return;
      const patches = updates.filter((item): item is { id: string; thumbnailUrl: string } => Boolean(item));
      if (patches.length === 0) return;
      update((draft) => {
        patches.forEach((patch) => {
          const target = draft.cards.find((card) => card.id === patch.id);
          if (target && (target.type === "file" || target.type === "image") && "thumbnailUrl" in target.content) {
            target.content = { ...target.content, thumbnailUrl: patch.thumbnailUrl };
          }
        });
        return draft;
      }, false);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workspace.cards]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type !== "drop" || event.payload.paths.length === 0) return;
          const point = canvasPoint(event.payload.position.x, event.payload.position.y, workspaceRef.current);
          createCardsFromPaths(event.payload.paths, point.x, point.y).catch(() => undefined);
        })
      )
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
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
      const hotkeyType = resolveEntityHotkey(event, entityHotkeys);
      if (hotkeyType && shouldHandleCanvasShortcut(boardRef.current)) {
        event.preventDefault();
        createToolAtHotkey(hotkeyType);
        return;
      }
      if (event.key === "Delete" && shouldHandleCanvasShortcut(boardRef.current)) {
        if (workspaceRef.current.selectedCardIds.length > 0) {
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
      const clipboard = event.clipboardData;
      if (entityClipboard && shouldPasteEntityClipboard(clipboard)) {
        event.preventDefault();
        pasteEntityClipboard();
        return;
      }
      if (!clipboard) return;
      const handled = pasteClipboardData(clipboard);
      if (handled) {
        if (entityClipboard) {
          setEntityClipboard(null);
          setCutCardIds([]);
        }
        event.preventDefault();
      }
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
  const renderCards = [
    ...visibleCards.map((card) => resolveLineCard(card, workspace.cards)),
    ...(activeLine ? [activeLine] : [])
  ];
  const visibleStrokes = workspace.drawingStrokes.filter((stroke) => stroke.boardId === currentBoard.id && !stroke.trashedAt);
  const trashCount = workspace.cards.filter((card) => card.trashedAt).length;
  const unsortedCards = workspace.unsortedCardIds
    .map((id) => workspace.cards.find((card) => card.id === id && !card.trashedAt))
    .filter((card): card is CanvasCard => Boolean(card));
  const trashedCards = workspace.cards.filter((card) => card.trashedAt);
  const boardPath = useMemo(() => getBoardPath(workspace.boards, currentBoard.id), [workspace.boards, currentBoard.id]);
  const visibleTabs = boardTabs
    .map((tab) => ({ ...tab, board: workspace.boards.find((board) => board.id === tab.boardId && !board.trashedAt) }))
    .filter((tab): tab is BoardTab & { board: Board } => Boolean(tab.board));

  useEffect(() => {
    const boardExists = workspace.boards.some((board) => board.id === workspace.currentBoardId && !board.trashedAt);
    const nextBoardId = boardExists ? workspace.currentBoardId : "board_home";
    setBoardTabs((tabs) => {
      const cleanedTabs = tabs.filter((tab) => workspace.boards.some((board) => board.id === tab.boardId && !board.trashedAt));
      const safeTabs = cleanedTabs.length > 0 ? cleanedTabs : [{ id: "tab_home", boardId: "board_home" }];
      const activeExists = safeTabs.some((tab) => tab.id === activeTabId);
      const nextActiveTabId = activeExists ? activeTabId : safeTabs[0].id;
      if (!activeExists) setActiveTabId(nextActiveTabId);
      return safeTabs.map((tab) => (tab.id === nextActiveTabId ? { ...tab, boardId: nextBoardId } : tab));
    });
  }, [workspace.currentBoardId, workspace.boards, activeTabId]);

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

  function openBoard(boardId: string) {
    setBoardContextMenu(null);
    setBoardTabs((tabs) => {
      if (tabs.some((tab) => tab.id === activeTabId)) {
        return tabs.map((tab) => (tab.id === activeTabId ? { ...tab, boardId } : tab));
      }
      return [...tabs, { id: createId("tab"), boardId }];
    });
    setWorkspace((state) => ({ ...state, currentBoardId: boardId, selectedCardIds: [] }));
  }

  function openBoardInNewTab(boardId: string) {
    setBoardContextMenu(null);
    const tabId = createId("tab");
    setBoardTabs((tabs) => [...tabs, { id: tabId, boardId }]);
    setActiveTabId(tabId);
    setWorkspace((state) => ({ ...state, currentBoardId: boardId, selectedCardIds: [] }));
  }

  function switchBoardTab(tabId: string) {
    const tab = boardTabs.find((candidate) => candidate.id === tabId);
    if (!tab) return;
    setBoardContextMenu(null);
    setActiveTabId(tabId);
    setWorkspace((state) => ({ ...state, currentBoardId: tab.boardId, selectedCardIds: [] }));
  }

  function closeBoardTab(tabId: string, event?: React.MouseEvent) {
    event?.stopPropagation();
    if (boardTabs.length <= 1) {
      openBoard("board_home");
      return;
    }
    const closedIndex = boardTabs.findIndex((tab) => tab.id === tabId);
    const nextTabs = boardTabs.filter((tab) => tab.id !== tabId);
    const nextTab = tabId === activeTabId
      ? nextTabs[Math.max(0, closedIndex - 1)] ?? nextTabs[0]
      : boardTabs.find((tab) => tab.id === activeTabId);
    setBoardTabs(nextTabs);
    if (nextTab) {
      setActiveTabId(nextTab.id);
      setWorkspace((state) => ({ ...state, currentBoardId: nextTab.boardId, selectedCardIds: [] }));
    }
  }

  function openBoardContextMenu(boardId: string, event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setBoardContextMenu({ boardId, x: event.clientX, y: event.clientY });
  }

  function flushDeferredPersist() {
    if (!pendingPersistRef.current) return;
    pendingPersistRef.current = false;
    saveWorkspace(workspaceRef.current);
    saveWorkspaceToBackend(workspaceRef.current).catch(() => undefined);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
      return;
    }
    document.documentElement.requestFullscreen().catch(() => undefined);
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
      const zIndex = nextZIndex(draft.cards);
      if (type === "board") {
        const color = colors[Math.floor(Math.random() * colors.length)];
        const icon = boardEmojis[draft.boards.length % boardEmojis.length];
        const board: Board = {
          id: createId("board"),
          parentBoardId: currentBoard.id,
          title: "New board",
          icon,
          color,
          createdAt: now,
          updatedAt: now,
          sortIndex: draft.boards.length,
          trashedAt: null
        };
        draft.boards.push(board);
        card = makeCard(id, type, x, y, 180, 150, zIndex, {
          boardId: board.id,
          title: board.title,
          icon,
          color
        });
        card.style = { background: "#151b26", color: "#e5edf7", accent: color, icon };
      } else if (type === "link") {
        const raw = window.prompt("Paste URL");
        const url = normalizeUrl(raw ?? "");
        card = makeCard(id, type, x, y, 320, 220, zIndex, {
          url,
          label: "",
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
        card = makeCard(id, droppedType, x, y, 300, droppedType === "image" ? 250 : 150, zIndex, {
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
        card = makeCard(id, type, x, y, 280, 140, zIndex, {
          title: title || "Folder",
          path: path || ""
        });
        card.style = { background: "#111723", color: "#e5edf7", accent: "#79c58a" };
      } else {
        card = makeDefaultCard(id, type, x, y, zIndex);
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
      const card = makeCard(id, "link", x, y, 320, 220, nextZIndex(draft.cards), {
        url: normalizedUrl,
        label: "",
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
      const card = makeCard(id, "note", x, y, 340, 240, nextZIndex(draft.cards), {
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
      createCardsFromClipboardFiles(files, point.x, point.y).catch(() => {
        files.forEach((file, index) => createCard(resolveDroppedFileType(file), point.x + index * 24, point.y + index * 24, file));
      });
      return true;
    }

    const imageItem = Array.from(clipboard.items).find((item) => item.kind === "file" && item.type.startsWith("image/"));
    const imageFile = imageItem?.getAsFile();
    if (imageFile) {
      createCardsFromClipboardFiles([imageFile], point.x, point.y).catch(() => createCard("image", point.x, point.y, imageFile));
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

  async function createCardsFromClipboardFiles(files: File[], x: number, y: number) {
    for (const [index, file] of files.entries()) {
      const asset = await materializeClipboardFile(file);
      createFileCardFromAsset({
        file,
        type: resolveDroppedFileType(file),
        x: x + index * 24,
        y: y + index * 24,
        sourcePath: asset.sourcePath,
        thumbnailUrl: asset.thumbnailUrl,
        size: asset.size
      });
    }
  }

  async function materializeClipboardFile(file: File) {
    const sourcePath = getDroppedFilePath(file);
    if (sourcePath) {
      const thumbnailUrl = await toAssetUrl(sourcePath).catch(() => null);
      return { sourcePath, thumbnailUrl: thumbnailUrl ?? undefined, size: file.size };
    }
    if (file.type.startsWith("image/") && file.size <= pastedAssetCopyLimitBytes && isDesktopRuntime()) {
      const buffer = await file.arrayBuffer();
      const stored = await saveClipboardAsset(
        file.name || defaultClipboardImageName(file.type),
        file.type || "image/png",
        Array.from(new Uint8Array(buffer))
      ).catch(() => null);
      if (stored?.sourcePath) {
        const thumbnailUrl = await toAssetUrl(stored.sourcePath).catch(() => null);
        return { sourcePath: stored.sourcePath, thumbnailUrl: thumbnailUrl ?? undefined, size: stored.size };
      }
    }
    return { sourcePath: undefined, thumbnailUrl: URL.createObjectURL(file), size: file.size };
  }

  function createFileCardFromAsset({
    file,
    type,
    x,
    y,
    sourcePath,
    thumbnailUrl,
    size
  }: {
    file: File;
    type: CardType;
    x: number;
    y: number;
    sourcePath?: string;
    thumbnailUrl?: string;
    size: number;
  }) {
    const id = createId("card");
    const assetId = createId("asset");
    const now = nowIso();
    update((draft) => {
      draft.assets.push({
        id: assetId,
        originalName: file.name || defaultClipboardImageName(file.type),
        mimeType: file.type || "application/octet-stream",
        size,
        objectUrl: sourcePath ? undefined : thumbnailUrl,
        sourcePath,
        createdAt: now
      });
      draft.cards.push({
        id,
        boardId: draft.currentBoardId,
        type,
        x,
        y,
        width: 300,
        height: type === "image" ? 250 : 150,
        zIndex: nextZIndex(draft.cards),
        style: { background: "#151b26", color: "#e5edf7", accent: colors[nextZIndex(draft.cards) % colors.length] },
        content: {
          assetId,
          fileName: file.name || defaultClipboardImageName(file.type),
          mimeType: file.type || "application/octet-stream",
          size,
          thumbnailUrl,
          sourcePath
        },
        createdAt: now,
        updatedAt: now,
        trashedAt: null
      });
      draft.selectedCardIds = [id];
      return draft;
    });
  }

  async function createCardsFromPaths(paths: string[], x: number, y: number) {
    const files = paths.filter(Boolean);
    for (const [index, path] of files.entries()) {
      const metadata = await getPathMetadata(path).catch(() => null);
      if (metadata?.isDir) {
        const id = createId("card");
        const now = nowIso();
        update((draft) => {
          draft.cards.push({
            id,
            boardId: draft.currentBoardId,
            type: "folder",
            x: x + index * 24,
            y: y + index * 24,
            width: 280,
            height: 140,
            zIndex: nextZIndex(draft.cards),
            style: { background: "#111723", color: "#e5edf7", accent: "#79c58a" },
            content: {
              title: fileNameFromPath(path),
              path
            },
            createdAt: now,
            updatedAt: now,
            trashedAt: null
          });
          draft.selectedCardIds = [id];
          return draft;
        });
        continue;
      }
      const mimeType = mimeFromPath(path);
      const fileName = fileNameFromPath(path);
      const thumbnailUrl = await toAssetUrl(path).catch(() => null);
      const size = metadata?.size ?? 0;
      const type: CardType = mimeType.startsWith("image/") || mimeType.startsWith("video/") || mimeType.startsWith("audio/") ? "image" : "file";
      const id = createId("card");
      const assetId = createId("asset");
      const now = nowIso();
      update((draft) => {
        draft.assets.push({
          id: assetId,
          originalName: fileName,
          mimeType,
          size,
          sourcePath: path,
          createdAt: now
        });
        draft.cards.push({
          id,
          boardId: draft.currentBoardId,
          type,
          x: x + index * 24,
          y: y + index * 24,
          width: 300,
          height: type === "image" ? 250 : 150,
          zIndex: nextZIndex(draft.cards),
          style: { background: "#151b26", color: "#e5edf7", accent: colors[nextZIndex(draft.cards) % colors.length] },
          content: {
          assetId,
          fileName,
          mimeType,
          size,
          thumbnailUrl: thumbnailUrl ?? undefined,
          sourcePath: path
          },
          createdAt: now,
          updatedAt: now,
          trashedAt: null
        });
        draft.selectedCardIds = [id];
        return draft;
      });
    }
  }

  async function handleToolClick(type: CardType) {
    if (suppressToolClickRef.current) {
      suppressToolClickRef.current = false;
      return;
    }
    if (type === "file") {
      const selectedPaths = await selectFilesWithDialog().catch(() => null);
      if (selectedPaths && selectedPaths.length > 0) {
        const rect = boardRef.current?.getBoundingClientRect();
        const point = rect
          ? canvasPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          : canvasPoint(lastCanvasClientPoint.current.x, lastCanvasClientPoint.current.y);
        await createCardsFromPaths(selectedPaths, point.x, point.y);
        return;
      }
      if (isDesktopRuntime()) return;
      uploadInputRef.current?.click();
      return;
    }
    if (type === "line" && workspace.selectedCardIds.length >= 2) {
      createConnectorBetween(workspace.selectedCardIds[0], workspace.selectedCardIds[1]);
      return;
    }
    createCard(type, 160, 140);
  }

  async function createToolAtHotkey(type: CardType) {
    const point = canvasPoint(lastCanvasClientPoint.current.x, lastCanvasClientPoint.current.y);
    if (type === "file") {
      const selectedPaths = await selectFilesWithDialog().catch(() => null);
      if (selectedPaths && selectedPaths.length > 0) {
        await createCardsFromPaths(selectedPaths, point.x, point.y);
      } else if (!isDesktopRuntime()) {
        uploadInputRef.current?.click();
      }
      return;
    }
    if (type === "line" && workspaceRef.current.selectedCardIds.length >= 2) {
      createConnectorBetween(workspaceRef.current.selectedCardIds[0], workspaceRef.current.selectedCardIds[1]);
      return;
    }
    createCard(type, point.x, point.y);
  }

  function assignEntityHotkey(type: CardType, key: string) {
    setEntityHotkeys((current) => {
      const next = { ...current };
      Object.keys(next).forEach((candidate) => {
        if (next[candidate as CardType] === key) {
          delete next[candidate as CardType];
        }
      });
      next[type] = key;
      return next;
    });
  }

  function clearEntityHotkey(type: CardType) {
    setEntityHotkeys((current) => {
      const next = { ...current };
      delete next[type];
      return next;
    });
  }

  function resetEntityHotkeys() {
    setEntityHotkeys({ ...defaultEntityHotkeys });
  }

  function handleHotkeyInput(type: CardType, event: React.KeyboardEvent<HTMLInputElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      clearEntityHotkey(type);
      return;
    }
    const normalized = normalizeHotkeyKey(event);
    if (normalized) assignEntityHotkey(type, normalized);
  }

  function startToolbarPointerDrag(tool: DropPayload, event: React.PointerEvent<HTMLButtonElement>) {
    if (tool.kind === "file" || event.button !== 0) return;
    toolbarPointerDragRef.current = {
      type: tool.kind,
      label: tool.label,
      startX: event.clientX,
      startY: event.clientY,
      active: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveToolbarPointerDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = toolbarPointerDragRef.current;
    if (!drag) return;
    const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.active && moved < 6) return;
    drag.active = true;
    suppressToolClickRef.current = true;
    setToolbarGhost({ label: drag.label, x: event.clientX, y: event.clientY });
  }

  function endToolbarPointerDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = toolbarPointerDragRef.current;
    toolbarPointerDragRef.current = null;
    setToolbarGhost(null);
    if (!drag?.active) return;
    suppressToolClickRef.current = true;
    const rect = boardRef.current?.getBoundingClientRect();
    const overCanvas = rect &&
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!overCanvas) return;
    const point = canvasPoint(event.clientX, event.clientY);
    createCard(drag.type, point.x, point.y);
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
    setActiveStroke(null);
    setActiveLine(null);
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
    if ((event.target as HTMLElement).closest(".card, button, input, textarea, a")) return false;
    event.preventDefault();
    event.stopPropagation();
    const point = canvasPoint(event.clientX, event.clientY);
    lastPointerPoint.current = point;
    if (workspace.drawingSettings.tool === "eraser") {
      eraseStrokeAt(point);
      event.currentTarget.setPointerCapture(event.pointerId);
      return true;
    }
    if (workspace.drawingSettings.tool === "line") {
      setActiveLine(makeLineCardFromPoints(point, point, {
        mode: workspace.drawingSettings.lineMode ?? "free",
        color: workspace.drawingSettings.color,
        width: workspace.drawingSettings.width,
        arrowStart: Boolean(workspace.drawingSettings.arrowStart),
        arrowEnd: workspace.drawingSettings.arrowEnd ?? true,
        preview: true
      }));
      event.currentTarget.setPointerCapture(event.pointerId);
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
    if (workspace.drawingSettings.tool === "line") {
      setActiveLine((line) => {
        if (!line || !("points" in line.content)) return line;
        const content = line.content as LineContent;
        const start = content.points[0] ?? { x: 0, y: 0 };
        return makeLineCardFromPoints(
          { x: line.x + start.x, y: line.y + start.y },
          point,
          {
            mode: workspace.drawingSettings.lineMode ?? content.mode ?? "free",
            color: workspace.drawingSettings.color,
            width: workspace.drawingSettings.width,
            arrowStart: Boolean(workspace.drawingSettings.arrowStart),
            arrowEnd: workspace.drawingSettings.arrowEnd ?? true,
            preview: true
          }
        );
      });
      return;
    }
    setActiveStroke((stroke) => {
      if (!stroke) return null;
      const previous = stroke.points.at(-1);
      if (previous && distance(previous, point) < 2) return stroke;
      return { ...stroke, points: [...stroke.points, point] };
    });
  }

  function finishDrawing() {
    if (activeLine) {
      const line = activeLine;
      setActiveLine(null);
      if (!("points" in line.content) || distance(line.content.points[0] ?? { x: 0, y: 0 }, line.content.points[1] ?? { x: 0, y: 0 }) < 6) {
        return;
      }
      update((draft) => {
        const card = { ...line, id: createId("card"), zIndex: 0, updatedAt: nowIso() };
        draft.cards.push(card);
        draft.selectedCardIds = [card.id];
        return draft;
      });
      return;
    }
    const firstPoint = activeStroke?.points[0];
    const lastPoint = activeStroke?.points.at(-1);
    if (!activeStroke || activeStroke.points.length < 3 || !firstPoint || !lastPoint || distance(firstPoint, lastPoint) < 4) {
      setActiveStroke(null);
      return;
    }
    update((draft) => {
      const card = makeDrawingCard(activeStroke, draft.cards);
      if (card) {
        draft.cards.push(card);
        draft.selectedCardIds = [card.id];
      }
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
      draft.cards = draft.cards.map((card) => {
        if (card.boardId !== currentBoard.id || card.trashedAt || card.type !== "drawing" || !("points" in card.content)) return card;
        const content = card.content as DrawingContent;
        const hit = content.points.some((candidate) => distance({ x: card.x + candidate.x, y: card.y + candidate.y }, point) <= threshold);
        return hit ? { ...card, trashedAt: nowIso(), updatedAt: nowIso() } : card;
      });
      return draft;
    }, false);
  }

  function makeDrawingCard(stroke: DrawStroke, cards: CanvasCard[]) {
    const bounds = boundsFromPoints(stroke.points, Math.max(8, stroke.width));
    if (!bounds) return null;
    const localPoints = stroke.points.map((point) => ({ x: point.x - bounds.x, y: point.y - bounds.y }));
    const now = nowIso();
    return {
      id: createId("card"),
      boardId: stroke.boardId,
      type: "drawing" as const,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      zIndex: nextZIndex(cards),
      style: { background: "transparent", color: stroke.color, accent: stroke.color },
      content: {
        points: localPoints,
        color: stroke.color,
        width: stroke.width
      },
      createdAt: now,
      updatedAt: now,
      trashedAt: null
    } satisfies CanvasCard;
  }

  function makeLineCardFromPoints(
    rawStart: { x: number; y: number },
    rawEnd: { x: number; y: number },
    options: {
      mode: NonNullable<LineContent["mode"]>;
      color: string;
      width: number;
      arrowStart: boolean;
      arrowEnd: boolean;
      preview?: boolean;
    }
  ): CanvasCard {
    const end = constrainLineEnd(rawStart, rawEnd, options.mode);
    const pad = Math.max(14, options.width * 3);
    const x = Math.min(rawStart.x, end.x) - pad;
    const y = Math.min(rawStart.y, end.y) - pad;
    const width = Math.max(44, Math.abs(end.x - rawStart.x) + pad * 2);
    const height = Math.max(44, Math.abs(end.y - rawStart.y) + pad * 2);
    const now = nowIso();
    return {
      id: options.preview ? "active-line-preview" : createId("card"),
      boardId: currentBoard.id,
      type: "line",
      x,
      y,
      width,
      height,
      zIndex: 0,
      style: { background: "transparent", color: "#e5edf7", accent: options.color },
      content: {
        points: [
          { x: rawStart.x - x, y: rawStart.y - y },
          { x: end.x - x, y: end.y - y }
        ],
        mode: options.mode,
        width: options.width,
        arrowStart: options.arrowStart,
        arrowEnd: options.arrowEnd
      },
      createdAt: now,
      updatedAt: now,
      trashedAt: null
    };
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
      mode: "free",
      width: workspace.drawingSettings.width,
      arrowStart: Boolean(workspace.drawingSettings.arrowStart),
      sourceCardId,
      targetCardId,
      arrowEnd: workspace.drawingSettings.arrowEnd ?? true
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
        style: { background: "transparent", color: "#e5edf7", accent: workspace.drawingSettings.color },
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
      const card = makeCard(id, type, x, y, 260, 120, 0, {
        points: [{ x: 16, y: 60 }, { x: 244, y: 60 }],
        mode: workspace.drawingSettings.lineMode ?? "horizontal",
        width: workspace.drawingSettings.width,
        arrowStart: Boolean(workspace.drawingSettings.arrowStart),
        arrowEnd: workspace.drawingSettings.arrowEnd ?? true
      });
      card.style = { background: "transparent", color: "#e5edf7", accent: workspace.drawingSettings.color };
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
    if (type === "widget") {
      return makeCard(id, type, x, y, 420, 280, zIndex, {
        title: "Widget",
        sourceType: "html",
        source: defaultClockWidgetHtml(),
        refreshSeconds: 0
      });
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

  function canvasPoint(clientX: number, clientY: number, state = workspace) {
    const rect = boardRef.current?.getBoundingClientRect();
    return {
      x: (clientX - (rect?.left ?? 0) - state.pan.x) / state.zoom,
      y: (clientY - (rect?.top ?? 0) - state.pan.y) / state.zoom
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

  function handleColumnChildPointerExtract(cardId: string, columnId: string, event: React.PointerEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const finish = (upEvent: PointerEvent) => {
      target.releasePointerCapture(event.pointerId);
      target.removeEventListener("pointerup", finish);
      target.removeEventListener("pointercancel", cancel);
      const point = canvasPoint(upEvent.clientX, upEvent.clientY);
      moveCardOutOfColumn(cardId, columnId, point);
    };
    const cancel = () => {
      target.removeEventListener("pointerup", finish);
      target.removeEventListener("pointercancel", cancel);
    };
    target.addEventListener("pointerup", finish);
    target.addEventListener("pointercancel", cancel);
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
    if ("__TAURI_INTERNALS__" in window && files.length > 0) {
      return;
    }
    files.forEach((file, index) => createCard(resolveDroppedFileType(file), point.x + index * 24, point.y + index * 24, file));
  }

  function startDrag(card: CanvasCard, event: React.PointerEvent) {
    if (spacePressed) return;
    if ((event.target as HTMLElement).closest("[data-no-drag]")) return;
    const point = canvasPoint(event.clientX, event.clientY);
    dragStartPoint.current = point;
    const alreadySelected = workspace.selectedCardIds.includes(card.id);
    const nextSelectedIds = event.shiftKey
      ? Array.from(new Set([...workspace.selectedCardIds, card.id]))
      : alreadySelected
        ? workspace.selectedCardIds
        : [card.id];
    if (event.altKey) {
      const clonedCards = cloneCardsForAltDrag(nextSelectedIds);
      if (clonedCards.length === 0) return;
      dragStartCards.current = clonedCards
        .map((item) => ({ id: item.id, x: item.x, y: item.y }));
      setDraggingCard(clonedCards[0].id);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    dragStartCards.current = workspace.cards
      .filter((item) => nextSelectedIds.includes(item.id))
      .map((item) => ({ id: item.id, x: item.x, y: item.y }));
    setDraggingCard(card.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    update((draft) => {
      draft.selectedCardIds = nextSelectedIds;
      const maxZ = Math.max(0, ...draft.cards.map((item) => item.zIndex));
      let zOffset = 1;
      draft.cards.forEach((item) => {
          if (nextSelectedIds.includes(item.id) && item.type !== "line") {
            item.zIndex = maxZ + zOffset;
            zOffset += 1;
          }
      });
      return draft;
    }, false);
  }

  function moveCard(event: React.PointerEvent) {
    latestPointerRef.current = { clientX: event.clientX, clientY: event.clientY, buttons: event.buttons };
    lastCanvasClientPoint.current = { x: event.clientX, y: event.clientY };
    if (pointerFrameRef.current) return;
    pointerFrameRef.current = requestAnimationFrame(() => {
      pointerFrameRef.current = null;
      applyPointerMove(latestPointerRef.current);
    });
  }

  function applyPointerMove(event: { clientX: number; clientY: number; buttons: number }) {
    if (!draggingCard && !resizingCard && !selectionRect && !activeStroke && !activeLine && !panningCanvas) return;
    if (panningCanvas) {
      const dx = event.clientX - panStart.current.clientX;
      const dy = event.clientY - panStart.current.clientY;
      transientUpdateRef.current = true;
      setWorkspace((current) => ({
        ...current,
        pan: { x: panStart.current.x + dx, y: panStart.current.y + dy }
      }));
      return;
    }
    const point = canvasPoint(event.clientX, event.clientY);
    lastPointerPoint.current = point;
    if (activeStroke || activeLine || (workspace.drawingSettings.enabled && workspace.drawingSettings.tool === "eraser" && event.buttons === 1)) {
      continueDrawing(point);
      return;
    }
    if (selectionRect) {
      setSelectionRect((current) => (current ? { ...current, current: point } : null));
      update((draft) => {
        const rect = normalizeRect(selectionRect.start, point);
        draft.selectedCardIds = draft.cards
          .filter((card) => card.boardId === currentBoard.id && !card.trashedAt)
          .filter((card) => intersectsRect(rect, { x: card.x, y: card.y, width: card.width, height: card.height }))
          .map((card) => card.id);
        return draft;
      }, false);
      return;
    }
    update((draft) => {
      transientUpdateRef.current = true;
      const target = draft.cards.find((card) => card.id === (draggingCard ?? resizingCard));
      if (!target) return draft;
      if (draggingCard) {
        const dx = Math.round(point.x - dragStartPoint.current.x);
        const dy = Math.round(point.y - dragStartPoint.current.y);
        const dragIds = new Set(dragStartCards.current.map((item) => item.id));
        draft.cards.forEach((card) => {
          if (!dragIds.has(card.id)) return;
          const start = dragStartCards.current.find((item) => item.id === card.id);
          if (!start) return;
          card.x = start.x + dx;
          card.y = start.y + dy;
          card.updatedAt = nowIso();
        });
      }
      if (resizingCard) {
        const minWidth = target.type === "line" || target.type === "drawing" ? 36 : 140;
        const minHeight = target.type === "line" || target.type === "drawing" ? 36 : 90;
        target.width = Math.max(minWidth, Math.round(point.x - target.x));
        target.height = Math.max(minHeight, Math.round(point.y - target.y));
        target.updatedAt = nowIso();
      }
      return draft;
    }, false);
  }

  function endPointer() {
    if (pointerFrameRef.current) {
      cancelAnimationFrame(pointerFrameRef.current);
      pointerFrameRef.current = null;
      applyPointerMove(latestPointerRef.current);
    }
    if (panningCanvas) {
      setPanningCanvas(false);
      transientUpdateRef.current = false;
      flushDeferredPersist();
      return;
    }
    if (activeStroke || activeLine) {
      finishDrawing();
      return;
    }
    if (selectionRect) {
      setSelectionRect(null);
      return;
    }
    if (!draggingCard && !resizingCard) return;
    const droppedCardId = draggingCard;
    const wasGroupDrag = dragStartCards.current.length > 1;
    dragStartCards.current = [];
    transientUpdateRef.current = false;
    setDraggingCard(null);
    setResizingCard(null);
    setWorkspace((current) => {
      let cards = current.cards;
      let boards = current.boards;
      if (droppedCardId && !wasGroupDrag) {
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
    window.setTimeout(flushDeferredPersist, 0);
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

  function cloneCardsForAltDrag(selectedCardIds: string[]) {
    const cardIds = expandCutCardIds(selectedCardIds, workspaceRef.current.cards);
    const cards = workspaceRef.current.cards.filter((card) => cardIds.includes(card.id) && !card.trashedAt);
    if (cards.length === 0) return [] as CanvasCard[];
    const boardIds = new Set<string>();
    cards.forEach((card) => {
      if (card.type === "board" && "boardId" in card.content) {
        collectBoardSubtreeIds((card.content as BoardContent).boardId, workspaceRef.current.boards, boardIds);
      }
    });

    const now = nowIso();
    const idMap = new Map<string, string>();
    const boardIdMap = new Map<string, string>();
    const boardSnapshot = deepClone(workspaceRef.current.boards.filter((board) => boardIds.has(board.id)));
    const cardSnapshot = deepClone(cards);
    boardSnapshot.forEach((board) => boardIdMap.set(board.id, createId("board")));
    cardSnapshot.forEach((card) => idMap.set(card.id, createId("card")));
    const maxZ = Math.max(0, ...workspaceRef.current.cards.map((card) => card.zIndex));
    const copiedBoards = boardSnapshot.map((board) => ({
      ...board,
      id: boardIdMap.get(board.id) ?? createId("board"),
      parentBoardId: board.parentBoardId && boardIdMap.has(board.parentBoardId)
        ? boardIdMap.get(board.parentBoardId) ?? currentBoard.id
        : currentBoard.id,
      title: `${board.title} copy`,
      createdAt: now,
      updatedAt: now,
      trashedAt: null
    }));
    const copiedCards = cardSnapshot.map((card, index) => {
      const next = deepClone(card);
      next.id = idMap.get(card.id) ?? createId("card");
      next.boardId = currentBoard.id;
      next.x = Math.round(card.x);
      next.y = Math.round(card.y);
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

    update((draft) => {
      draft.boards.push(...copiedBoards);
      draft.cards.push(...copiedCards);
      draft.selectedCardIds = copiedCards.map((card) => card.id);
      return draft;
    });
    return copiedCards;
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

  function pasteCopiedCards(clipboard: EntityClipboard, targetPoint?: { x: number; y: number }, onPasted?: (cardIds: string[]) => void) {
    if (!clipboard.snapshot) return;
    const point = targetPoint ?? canvasPoint(lastCanvasClientPoint.current.x, lastCanvasClientPoint.current.y);
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
      onPasted?.(draft.selectedCardIds);
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
    const selectedCards = workspaceRef.current.cards.filter((card) => workspaceRef.current.selectedCardIds.includes(card.id) && !card.trashedAt);
    const hasBoardCards = selectedCards.some((card) => card.type === "board");
    if (hasBoardCards && !window.confirm("Move selected board card(s) to Trash? Nested boards will be hidden until restored.")) {
      return;
    }
    update((draft) => {
      const now = nowIso();
      draft.cards = draft.cards.map((card) => (draft.selectedCardIds.includes(card.id) ? { ...card, trashedAt: now } : card));
      draft.selectedCardIds = [];
      return draft;
    });
  }

  async function exportJson() {
    setExportMessage("");
    const exportPayload = createWorkspaceExport(workspace);
    const fileName = `acanvas-${new Date().toISOString().slice(0, 10)}.acanvas.json`;
    try {
      const selectedPath = await saveWorkspaceExportWithDialog(fileName);
      if (selectedPath) {
        const exportedPath = await writeWorkspaceExportToBackend(selectedPath, exportPayload);
        setExportMessage(`Exported: ${exportedPath}`);
        return;
      }
      if (isDesktopRuntime()) {
        setExportMessage("Export cancelled.");
        return;
      }
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : "Unable to export workspace.");
      return;
    }

    const blob = new Blob([exportWorkspaceJson(workspace)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    setExportMessage("Export started in the browser.");
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

  function changeAutoBackupInterval(value: number) {
    setAutoBackupInterval(value);
    setSettingsMessage(value > 0 ? `Auto backup interval set to ${value} minute${value === 1 ? "" : "s"}.` : "Auto backup is off.");
  }

  async function checkForUpdates() {
    setUpdateMessage("");
    try {
      const status = await checkForDesktopUpdate();
      setUpdateMessage(status === "available" ? "Update is available. Install it from the release notification." : "ACANVAS is up to date.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const lowerMessage = message.toLowerCase();
      const releaseUnavailable =
        message.includes("404") ||
        lowerMessage.includes("not found") ||
        lowerMessage.includes("unable to get update") ||
        lowerMessage.includes("failed to fetch") ||
        lowerMessage.includes("network");
      setUpdateMessage(releaseUnavailable
        ? "Updater cannot reach the GitHub Release metadata yet. Publish latest.json and the installer in a public v0.1.0 release, then try again."
        : message || "Unable to check for updates.");
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
        <button className="brandButton" onClick={() => openBoard("board_home")}>
          <Home size={17} />
          <span>Home</span>
        </button>
        <nav className="breadcrumbs">
          {boardPath.slice(1).map((board) => (
            <button key={board.id} onClick={() => openBoard(board.id)}>
              <ChevronRight size={14} />
              <span className="crumbColor" style={{ background: board.color }} />
              <span>{board.title}</span>
            </button>
          ))}
        </nav>
        <div className="boardTabs" role="tablist" aria-label="Open boards">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              className={`boardTab ${tab.id === activeTabId ? "isActive" : ""}`}
              role="tab"
              aria-selected={tab.id === activeTabId}
              onClick={() => switchBoardTab(tab.id)}
              title={tab.board.title}
            >
              <span className="boardTabColor" style={{ background: tab.board.color }} />
              <span className="boardTabTitle">{tab.board.title}</span>
              <span
                className="boardTabClose"
                role="button"
                tabIndex={-1}
                aria-label={`Close ${tab.board.title}`}
                onClick={(event) => closeBoardTab(tab.id, event)}
              >
                <X size={13} />
              </span>
            </button>
          ))}
        </div>
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
      {boardContextMenu && (
        <div
          className="contextMenu"
          style={{ left: boardContextMenu.x, top: boardContextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button onClick={() => openBoardInNewTab(boardContextMenu.boardId)}>
            Открыть в новой вкладке
          </button>
        </div>
      )}

      <aside className="toolbar">
        {toolbar.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.type}
              draggable={false}
              title={tool.label}
              onDragStart={(event) => {
                if (tool.type === "file") {
                  event.preventDefault();
                  return;
                }
                handleToolbarDrag({ kind: tool.type, label: tool.label }, event);
              }}
              onPointerDown={(event) => startToolbarPointerDrag({ kind: tool.type, label: tool.label }, event)}
              onPointerMove={moveToolbarPointerDrag}
              onPointerUp={endToolbarPointerDrag}
              onPointerCancel={endToolbarPointerDrag}
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
      {toolbarGhost && (
        <div className="toolbarGhost" style={{ left: toolbarGhost.x, top: toolbarGhost.y }}>
          {toolbarGhost.label}
        </div>
      )}

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
              onOpenBoard={openBoard}
              onOpenBoardInNewTab={openBoardContextMenu}
              onOpenPath={openFolderPath}
              onRevealPath={revealFolderPath}
              onPopOutFromColumn={popOutFromColumn}
              onColumnChildDrag={handleColumnChildDrag}
              onColumnChildPointerExtract={handleColumnChildPointerExtract}
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
          <button
            className="zoomDockIcon"
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            onClick={toggleFullscreen}
          >
            {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
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
              <button
                className={workspace.drawingSettings.tool === "line" ? "isSelected" : ""}
                onClick={() => updateDrawSettings({ tool: "line" })}
              >
                <Minus size={16} />
                Line
              </button>
            </div>
            <div className="segmented segmentedCompact">
              {(["free", "horizontal", "vertical"] as const).map((mode) => (
                <button
                  key={mode}
                  className={(workspace.drawingSettings.lineMode ?? "free") === mode ? "isSelected" : ""}
                  onClick={() => updateDrawSettings({ tool: "line", lineMode: mode })}
                >
                  {mode === "free" ? "Free" : mode === "horizontal" ? "H" : "V"}
                </button>
              ))}
            </div>
            <div className="segmented segmentedCompact">
              <button
                className={workspace.drawingSettings.arrowStart ? "isSelected" : ""}
                onClick={() => updateDrawSettings({ tool: "line", arrowStart: !workspace.drawingSettings.arrowStart })}
              >
                Start arrow
              </button>
              <button
                className={(workspace.drawingSettings.arrowEnd ?? true) ? "isSelected" : ""}
                onClick={() => updateDrawSettings({ tool: "line", arrowEnd: !(workspace.drawingSettings.arrowEnd ?? true) })}
              >
                End arrow
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
              <label className="settingsField">
                <span>Auto backup</span>
                <select value={autoBackupInterval} onChange={(event) => changeAutoBackupInterval(Number(event.target.value))}>
                  {backupIntervals.map((interval) => (
                    <option key={interval.value} value={interval.value}>
                      {interval.label}
                    </option>
                  ))}
                </select>
              </label>
              {lastAutoBackupAt && <span className="settingsNote">Last auto backup: {lastAutoBackupAt}</span>}
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
            <div className="settingsGroup">
              <div className="settingsGroupHeader">
                <strong>Entity hotkeys</strong>
                <button type="button" onClick={resetEntityHotkeys}>Reset</button>
              </div>
              <div className="hotkeyList">
                {toolbar.map((tool) => (
                  <label key={tool.type} className="hotkeyRow">
                    <span>{tool.label}</span>
                    <input
                      value={entityHotkeys[tool.type] ?? ""}
                      placeholder="-"
                      readOnly
                      onKeyDown={(event) => handleHotkeyInput(tool.type, event)}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </label>
                ))}
              </div>
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
        {exportMessage && <span className="settingsNote">{exportMessage}</span>}
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
  onOpenBoardInNewTab,
  onOpenPath,
  onRevealPath,
  onPopOutFromColumn,
  onColumnChildDrag,
  onColumnChildPointerExtract,
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
  onOpenBoardInNewTab: (boardId: string, event: React.MouseEvent) => void;
  onOpenPath: (path: string) => void;
  onRevealPath: (path: string) => void;
  onPopOutFromColumn: (cardId: string, columnId: string) => void;
  onColumnChildDrag: (cardId: string, columnId: string, event: React.DragEvent) => void;
  onColumnChildPointerExtract: (cardId: string, columnId: string, event: React.PointerEvent<HTMLElement>) => void;
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
        onOpenBoardInNewTab={onOpenBoardInNewTab}
        onOpenPath={onOpenPath}
        onRevealPath={onRevealPath}
        onPopOutFromColumn={onPopOutFromColumn}
        onColumnChildDrag={onColumnChildDrag}
        onColumnChildPointerExtract={onColumnChildPointerExtract}
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
  onOpenBoardInNewTab,
  onOpenPath,
  onRevealPath,
  onPopOutFromColumn,
  onColumnChildDrag,
  onColumnChildPointerExtract,
  onUpdateCardContent,
  noteSourceCollapsed,
  onToggleNoteSource
}: {
  card: CanvasCard;
  allCards: CanvasCard[];
  onChange: (patch: Partial<CanvasCard["content"]>) => void;
  onOpenBoard: (boardId: string) => void;
  onOpenBoardInNewTab: (boardId: string, event: React.MouseEvent) => void;
  onOpenPath: (path: string) => void;
  onRevealPath: (path: string) => void;
  onPopOutFromColumn: (cardId: string, columnId: string) => void;
  onColumnChildDrag: (cardId: string, columnId: string, event: React.DragEvent) => void;
  onColumnChildPointerExtract: (cardId: string, columnId: string, event: React.PointerEvent<HTMLElement>) => void;
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
        <textarea
          data-no-drag
          rows={1}
          value={card.content.text}
          onChange={(event) => onChange({ text: event.target.value })}
        />
      </div>
    );
  }

  if (card.type === "link" && "url" in card.content) {
    const content = card.content as LinkContent;
    return (
      <div className="linkCard">
        <div className="cardAccent" style={{ background: card.style.accent }} />
        <textarea
          data-no-drag
          className="linkLabelInput"
          value={content.label ?? ""}
          onChange={(event) => onChange({ label: event.target.value })}
          placeholder="Link frame title"
        />
        <div className="linkPreviewContent">
          <a data-no-drag href={content.url} target="_blank" rel="noreferrer" title={content.title}>{content.title}</a>
          {content.showDescription && content.description && <p>{content.description}</p>}
          <small title={content.url}>{content.url}</small>
        </div>
      </div>
    );
  }

  if (card.type === "widget" && "source" in card.content) {
    return <WidgetCard content={card.content as WidgetContent} onChange={onChange} />;
  }

  if ((card.type === "file" || card.type === "image") && "fileName" in card.content) {
    const content = card.content;
    const hasSourcePath = Boolean(content.sourcePath);
    const canPreview = Boolean(content.thumbnailUrl && isPreviewableMime(content.mimeType));
    return (
      <div
        className="fileCard"
        data-no-drag
        onClick={() => {
          if (content.sourcePath) onOpenPath(content.sourcePath);
          else if (canPreview && content.thumbnailUrl) window.open(content.thumbnailUrl, "_blank", "noopener,noreferrer");
        }}
      >
        {renderFilePreview(content)}
        <strong>{content.fileName}</strong>
        <small>{formatBytes(content.size)} · {content.mimeType || "file"}</small>
        <div className="fileActions">
          {canPreview && (
            <button
              onClick={(event) => {
                event.stopPropagation();
                window.open(content.thumbnailUrl ?? "", "_blank", "noopener,noreferrer");
              }}
            >
              Preview
            </button>
          )}
          {hasSourcePath ? (
            <>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenPath(content.sourcePath ?? "");
                }}
              >
                Open
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onRevealPath(content.sourcePath ?? "");
                }}
              >
                Show in folder
              </button>
            </>
          ) : (
            <span className="filePathHint">Use Upload again to keep a Windows path.</span>
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
      <div data-no-drag className="boardCardButton" onContextMenu={(event) => onOpenBoardInNewTab(content.boardId, event)}>
        <span className="boardIcon" style={{ background: content.color }}>{content.icon}</span>
        <textarea
          value={content.title}
          onChange={(event) => onChange({ title: event.target.value })}
          onDoubleClick={(event) => event.stopPropagation()}
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
        <textarea
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
                  onOpenBoardInNewTab={onOpenBoardInNewTab}
                  onOpenPath={onOpenPath}
                  onPopOut={onPopOutFromColumn}
                  onDragStart={onColumnChildDrag}
                  onPointerExtract={onColumnChildPointerExtract}
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
        <textarea
          data-no-drag
          rows={1}
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
              <textarea
                rows={1}
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
    const content = card.content as LineContent;
    const start = content.points[0] ?? { x: 0, y: card.height / 2 };
    const end = content.points[1] ?? { x: card.width, y: card.height / 2 };
    const strokeWidth = content.width ?? 3;
    return (
      <svg className="lineCard" viewBox={`0 0 ${card.width} ${card.height}`}>
        <defs>
          <marker id={`arrow-end-${card.id}`} markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
            <path d="M0,0 L0,6 L9,3 z" fill={card.style.accent} />
          </marker>
          <marker id={`arrow-start-${card.id}`} markerWidth="10" markerHeight="10" refX="1" refY="3" orient="auto">
            <path d="M0,0 L0,6 L9,3 z" fill={card.style.accent} />
          </marker>
        </defs>
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke={card.style.accent}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          markerStart={content.arrowStart ? `url(#arrow-start-${card.id})` : undefined}
          markerEnd={content.arrowEnd ? `url(#arrow-end-${card.id})` : undefined}
        />
      </svg>
    );
  }

  if (card.type === "drawing" && "points" in card.content) {
    const content = card.content as DrawingContent;
    return (
      <svg className="drawingCard" viewBox={`0 0 ${card.width} ${card.height}`}>
        <path
          d={strokePath(content.points)}
          fill="none"
          stroke={content.color}
          strokeWidth={content.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
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

function WidgetCard({
  content,
  onChange
}: {
  content: WidgetContent;
  onChange: (patch: Partial<CanvasCard["content"]>) => void;
}) {
  const sourceType = content.sourceType ?? "html";
  const source = content.source ?? "";
  const refreshSeconds = Number.isFinite(content.refreshSeconds) ? Math.max(0, content.refreshSeconds) : 0;
  const [reloadKey, setReloadKey] = useState(0);
  const [pathUrl, setPathUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    setPathUrl("");
    if (sourceType !== "path" || !source.trim()) return;
    toAssetUrl(source.trim())
      .then((url) => {
        if (!cancelled) setPathUrl(url ?? "");
      })
      .catch(() => {
        if (!cancelled) setPathUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [source, sourceType]);

  useEffect(() => {
    if (refreshSeconds <= 0) return;
    const timer = window.setInterval(() => setReloadKey((value) => value + 1), refreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [refreshSeconds]);

  const frameKey = `${reloadKey}-${sourceType}-${source}-${pathUrl}`;
  const sourcePlaceholder =
    sourceType === "url"
      ? "https://example.com/widget"
      : sourceType === "path"
        ? "D:\\Widgets\\clock.html"
        : "<div>Embed HTML here</div>";
  const urlPreview = sourceType === "url" ? resolveWidgetUrlPreview(source) : null;
  const canRender = sourceType === "html" ? Boolean(source.trim()) : Boolean((sourceType === "path" ? pathUrl : source).trim());

  return (
    <div className="widgetCard">
      <div className="widgetHeader" data-no-drag>
        <textarea
          value={content.title}
          onChange={(event) => onChange({ title: event.target.value })}
          placeholder="Widget title"
          aria-label="Widget title"
        />
        <select
          value={sourceType}
          onChange={(event) => onChange({ sourceType: event.target.value as WidgetContent["sourceType"] })}
          aria-label="Widget source type"
        >
          <option value="html">HTML</option>
          <option value="url">URL</option>
          <option value="path">Path</option>
        </select>
        <input
          className="widgetRefreshInput"
          type="number"
          min="0"
          step="5"
          value={refreshSeconds}
          onChange={(event) => onChange({ refreshSeconds: Number(event.target.value) || 0 })}
          title="Reload interval in seconds. 0 keeps the widget live without forced reload."
          aria-label="Refresh seconds"
        />
      </div>
      <details className="widgetEditor" data-no-drag>
        <summary>Edit source</summary>
        <textarea
          value={source}
          onChange={(event) => onChange({ source: event.target.value })}
          placeholder={sourcePlaceholder}
          spellCheck={false}
        />
      </details>
      <div className="widgetFrame">
        {canRender ? (
          <WidgetPreviewFrame
            key={frameKey}
            title={content.title || "Widget"}
            sourceType={sourceType}
            source={source}
            pathUrl={pathUrl}
            urlPreview={urlPreview}
          />
        ) : (
          <span className="emptyHint">Add HTML, URL, or a local HTML path.</span>
        )}
      </div>
    </div>
  );
}

function WidgetPreviewFrame({
  title,
  sourceType,
  source,
  pathUrl,
  urlPreview
}: {
  title: string;
  sourceType: WidgetContent["sourceType"];
  source: string;
  pathUrl: string;
  urlPreview: WidgetUrlPreview | null;
}) {
  if (urlPreview?.kind === "image") {
    return <img className="widgetMedia" src={urlPreview.src} alt={title} />;
  }
  if (urlPreview?.kind === "video") {
    return <video className="widgetMedia" src={urlPreview.src} controls playsInline />;
  }
  if (urlPreview?.kind === "audio") {
    return (
      <div className="widgetAudio">
        <FileUp size={34} />
        <audio src={urlPreview.src} controls />
      </div>
    );
  }
  return (
    <iframe
      title={title}
      src={sourceType === "html" || urlPreview?.kind === "embed" ? undefined : sourceType === "path" ? pathUrl : source}
      srcDoc={sourceType === "html" ? source : urlPreview?.kind === "embed" ? urlPreview.html : undefined}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-downloads"
      referrerPolicy="no-referrer"
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      allowFullScreen
    />
  );
}

function ColumnChild({
  card,
  columnId,
  onOpenBoard,
  onOpenBoardInNewTab,
  onOpenPath,
  onPopOut,
  onDragStart,
  onPointerExtract,
  onUpdateCardContent
}: {
  card: CanvasCard;
  columnId: string;
  onOpenBoard: (boardId: string) => void;
  onOpenBoardInNewTab: (boardId: string, event: React.MouseEvent) => void;
  onOpenPath: (path: string) => void;
  onPopOut: (cardId: string, columnId: string) => void;
  onDragStart: (cardId: string, columnId: string, event: React.DragEvent) => void;
  onPointerExtract: (cardId: string, columnId: string, event: React.PointerEvent<HTMLElement>) => void;
  onUpdateCardContent: (cardId: string, patch: Partial<CanvasCard["content"]>) => void;
}) {
  const label = getCardLabel(card);
  const accent = card.style.accent ?? "#6fc7e8";
  const extractButton = (
    <ColumnExtractButton
      cardId={card.id}
      columnId={columnId}
      onDragStart={onDragStart}
      onPointerExtract={onPointerExtract}
    />
  );
  if (card.type === "board" && "boardId" in card.content) {
    const content = card.content as BoardContent;
    return (
      <div
        data-no-drag
        draggable
        className="columnChild"
        onClick={() => onOpenBoard(content.boardId)}
        onContextMenu={(event) => onOpenBoardInNewTab(content.boardId, event)}
        onDragStart={(event) => onDragStart(card.id, columnId, event)}
        title="Open board"
      >
        <span className="columnChildAccent" style={{ background: content.color }} />
        <strong>{label}</strong>
        <small>Board</small>
        {extractButton}
      </div>
    );
  }

  if (card.type === "link" && "url" in card.content) {
    const content = card.content as LinkContent;
    return (
      <div
        data-no-drag
        draggable
        className="columnChild"
        onClick={() => window.open(content.url, "_blank", "noopener,noreferrer")}
        onDragStart={(event) => onDragStart(card.id, columnId, event)}
        title="Open link"
      >
        <span className="columnChildAccent" style={{ background: accent }} />
        <strong>{label}</strong>
        <small>Link</small>
        {extractButton}
      </div>
    );
  }

  if (card.type === "folder" && "path" in card.content) {
    const content = card.content as FolderContent;
    return (
      <div
        data-no-drag
        draggable
        className="columnChild"
        onClick={() => onOpenPath(content.path)}
        onDragStart={(event) => onDragStart(card.id, columnId, event)}
        title="Open folder"
      >
        <span className="columnChildAccent" style={{ background: accent }} />
        <strong>{label}</strong>
        <small>Folder</small>
        {extractButton}
      </div>
    );
  }

  if (card.type === "widget" && "title" in card.content) {
    return (
      <div
        data-no-drag
        draggable
        className="columnChild"
        onClick={() => onPopOut(card.id, columnId)}
        onDragStart={(event) => onDragStart(card.id, columnId, event)}
        title="Pop out widget"
      >
        <span className="columnChildAccent" style={{ background: accent }} />
        <strong>{label}</strong>
        <small>Widget</small>
        {extractButton}
      </div>
    );
  }

  if (card.type === "note" && "text" in card.content) {
    return (
      <div data-no-drag draggable className="columnEmbedded columnEmbedded-note" onDragStart={(event) => onDragStart(card.id, columnId, event)}>
        <span className="columnChildAccent" style={{ background: accent }} />
        {extractButton}
        <textarea rows={1} value={card.content.text} onChange={(event) => onUpdateCardContent(card.id, { text: event.target.value })} />
      </div>
    );
  }

  if (card.type === "title" && "text" in card.content) {
    return (
      <div data-no-drag draggable className="columnEmbedded columnEmbedded-title" onDragStart={(event) => onDragStart(card.id, columnId, event)}>
        <span className="columnChildAccent" style={{ background: accent }} />
        {extractButton}
        <textarea value={card.content.text} onChange={(event) => onUpdateCardContent(card.id, { text: event.target.value })} />
      </div>
    );
  }

  if (card.type === "comment" && "text" in card.content) {
    return (
      <div data-no-drag draggable className="columnEmbedded columnEmbedded-comment" onDragStart={(event) => onDragStart(card.id, columnId, event)}>
        <span className="columnChildAccent" style={{ background: accent }} />
        {extractButton}
        <textarea value={card.content.text} onChange={(event) => onUpdateCardContent(card.id, { text: event.target.value })} />
      </div>
    );
  }

  if (card.type === "todo" && "items" in card.content) {
    const content = card.content as TodoContent;
    return (
      <div data-no-drag draggable className="columnEmbedded columnEmbedded-todo" onDragStart={(event) => onDragStart(card.id, columnId, event)}>
        <span className="columnChildAccent" style={{ background: accent }} />
        {extractButton}
        <textarea
          rows={1}
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
            <textarea
              rows={1}
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
    <div
      data-no-drag
      draggable
      className="columnChild"
      onClick={() => onPopOut(card.id, columnId)}
      onDragStart={(event) => onDragStart(card.id, columnId, event)}
      title="Pop out to canvas"
    >
      <span className="columnChildAccent" style={{ background: accent }} />
      <strong>{label}</strong>
      <small>{card.type}</small>
      {extractButton}
    </div>
  );
}

function ColumnExtractButton({
  cardId,
  columnId,
  onDragStart,
  onPointerExtract
}: {
  cardId: string;
  columnId: string;
  onDragStart: (cardId: string, columnId: string, event: React.DragEvent) => void;
  onPointerExtract: (cardId: string, columnId: string, event: React.PointerEvent<HTMLElement>) => void;
}) {
  return (
    <button
      className="columnChildDrag"
      draggable
      onPointerDown={(event) => onPointerExtract(cardId, columnId, event)}
      onClick={(event) => event.stopPropagation()}
      onDragStart={(event) => onDragStart(cardId, columnId, event)}
    >
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
  if (card.type === "widget" && "title" in card.content) {
    const content = card.content as WidgetContent;
    return content.title || content.source || "Widget";
  }
  if ((card.type === "file" || card.type === "image") && "fileName" in card.content) return card.content.fileName;
  if (card.type === "board" && "title" in card.content) return card.content.title;
  if (card.type === "todo" && "title" in card.content) return card.content.title;
  if (card.type === "comment" && "text" in card.content) return card.content.text || "Comment";
  return card.type;
}

function defaultClockWidgetHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      background: #070707;
      color: #dddddd;
      font-family: system-ui, sans-serif;
    }
    body {
      display: grid;
      place-items: center;
    }
    main {
      width: calc(100% - 32px);
      display: grid;
      gap: 10px;
      text-align: center;
    }
    #time {
      font-size: clamp(34px, 13vw, 82px);
      font-weight: 800;
      line-height: 1;
    }
    #date {
      color: #b8b8b8;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <main>
    <div id="time"></div>
    <div id="date"></div>
  </main>
  <script>
    function tick() {
      const now = new Date();
      document.getElementById("time").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      document.getElementById("date").textContent = now.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    }
    tick();
    setInterval(tick, 1000);
  </script>
</body>
</html>`;
}

type WidgetUrlPreview =
  | { kind: "image"; src: string }
  | { kind: "video"; src: string }
  | { kind: "audio"; src: string }
  | { kind: "embed"; html: string };

function resolveWidgetUrlPreview(source: string): WidgetUrlPreview | null {
  const url = source.trim();
  if (!url) return null;
  const directKind = directMediaKind(url);
  if (directKind) return { kind: directKind, src: url };
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com") {
      const videoId = youtubeVideoId(parsed);
      return videoId ? { kind: "embed", html: responsiveIframe(`https://www.youtube.com/embed/${videoId}`) } : null;
    }
    if (host === "vimeo.com" || host === "player.vimeo.com") {
      const videoId = parsed.pathname.split("/").filter(Boolean).pop();
      return videoId ? { kind: "embed", html: responsiveIframe(`https://player.vimeo.com/video/${videoId}`) } : null;
    }
    if (host === "instagram.com" || host === "threads.net") {
      return { kind: "embed", html: instagramEmbedHtml(url) };
    }
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
      return { kind: "embed", html: tiktokEmbedHtml(url) };
    }
  } catch {
    return null;
  }
  return null;
}

function directMediaKind(url: string): "image" | "video" | "audio" | null {
  const cleanUrl = url.split(/[?#]/)[0].toLowerCase();
  if (/\.(png|jpe?g|webp|gif|bmp|svg)$/.test(cleanUrl)) return "image";
  if (/\.(mp4|webm|mov|m4v|ogg)$/.test(cleanUrl)) return "video";
  if (/\.(mp3|wav|m4a|aac|flac|oga)$/.test(cleanUrl)) return "audio";
  return null;
}

function youtubeVideoId(url: URL) {
  if (url.hostname.replace(/^www\./, "").toLowerCase() === "youtu.be") {
    return url.pathname.split("/").filter(Boolean)[0] ?? "";
  }
  if (url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/embed/")) {
    return url.pathname.split("/").filter(Boolean)[1] ?? "";
  }
  return url.searchParams.get("v") ?? "";
}

function responsiveIframe(src: string) {
  return `<!doctype html><html><head><meta charset="utf-8" /><style>${widgetEmbedBaseCss()}</style></head><body><iframe src="${escapeHtml(src)}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe></body></html>`;
}

function instagramEmbedHtml(url: string) {
  const permalink = url.endsWith("/") ? url : `${url}/`;
  return `<!doctype html><html><head><meta charset="utf-8" /><style>${widgetEmbedBaseCss()} body{display:grid;place-items:center;overflow:auto;padding:10px;} .instagram-media{min-width:0!important;width:100%!important;max-width:540px!important;}</style></head><body><blockquote class="instagram-media" data-instgrm-permalink="${escapeHtml(permalink)}" data-instgrm-version="14"></blockquote><script async src="https://www.instagram.com/embed.js"></script></body></html>`;
}

function tiktokEmbedHtml(url: string) {
  return `<!doctype html><html><head><meta charset="utf-8" /><style>${widgetEmbedBaseCss()} body{display:grid;place-items:center;overflow:auto;padding:10px;} blockquote{max-width:100%;min-width:0;}</style></head><body><blockquote class="tiktok-embed" cite="${escapeHtml(url)}" data-video-id=""><section><a target="_blank" href="${escapeHtml(url)}">Open TikTok</a></section></blockquote><script async src="https://www.tiktok.com/embed.js"></script></body></html>`;
}

function widgetEmbedBaseCss() {
  return "html,body{margin:0;width:100%;height:100%;background:#070707;color:#dddddd;font-family:system-ui,sans-serif;}iframe{width:100%;height:100%;border:0;background:#070707;}a{color:#f0b86e;}";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function defaultClipboardImageName(mimeType: string) {
  if (mimeType === "image/jpeg") return "image.jpg";
  if (mimeType === "image/webp") return "image.webp";
  if (mimeType === "image/gif") return "image.gif";
  if (mimeType === "image/bmp") return "image.bmp";
  if (mimeType === "image/svg+xml") return "image.svg";
  return "image.png";
}

function renderFilePreview(content: { thumbnailUrl?: string; mimeType: string; fileName: string }) {
  if (content.thumbnailUrl && content.mimeType.startsWith("image/")) {
    return <img src={content.thumbnailUrl} alt="" />;
  }
  if (content.thumbnailUrl && content.mimeType.startsWith("video/")) {
    return <video src={content.thumbnailUrl} controls />;
  }
  if (content.thumbnailUrl && content.mimeType === "application/pdf") {
    return <iframe className="documentPreview" src={content.thumbnailUrl} title={content.fileName} />;
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

function nextZIndex(cards: CanvasCard[]) {
  return Math.max(0, ...cards.map((card) => card.zIndex)) + 1;
}

function isEditableElement(element: Element | null) {
  if (!element) return false;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  return element instanceof HTMLElement && element.isContentEditable;
}

function shouldPasteEntityClipboard(clipboard: DataTransfer | null) {
  if (!clipboard) return true;
  if (clipboard.files.length > 0) return false;
  if (Array.from(clipboard.items).some((item) => item.kind === "file")) return false;

  const text = clipboard.getData("text/plain").trim();
  if (isAcanvasClipboardMarker(text)) return true;
  if (text.length > 0) return false;
  if (clipboard.types.includes("text/html") || clipboard.types.includes("text/uri-list")) return false;

  return true;
}

function isAcanvasClipboardMarker(value: string) {
  return /^ACANVAS (copy|cut):\s+\d+\s+entit(?:y|ies)$/i.test(value);
}

function shouldHandleCanvasShortcut(canvas: HTMLElement | null) {
  const active = document.activeElement;
  if (!active || active === document.body) return true;
  if (isEditableElement(active)) return false;
  if (active instanceof HTMLButtonElement) return false;
  return Boolean(canvas?.contains(active));
}

function readAutoBackupInterval() {
  const value = Number(localStorage.getItem(autoBackupIntervalKey));
  return backupIntervals.some((interval) => interval.value === value) ? value : 1;
}

function readEntityHotkeys(): Partial<Record<CardType, string>> {
  try {
    const parsed = JSON.parse(localStorage.getItem(hotkeysStorageKey) ?? "{}") as Partial<Record<CardType, string>>;
    return {
      ...defaultEntityHotkeys,
      ...Object.fromEntries(
        Object.entries(parsed)
          .map(([type, key]) => [type, normalizeStoredHotkey(key)])
          .filter((entry): entry is [string, string] => Boolean(entry[1]))
      )
    };
  } catch {
    return { ...defaultEntityHotkeys };
  }
}

function resolveEntityHotkey(event: KeyboardEvent, hotkeys: Partial<Record<CardType, string>>) {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.repeat) return null;
  const normalized = normalizeHotkeyKey(event);
  if (!normalized) return null;
  const match = toolbar.find((tool) => hotkeys[tool.type] === normalized);
  return match?.type ?? null;
}

function normalizeHotkeyKey(event: Pick<KeyboardEvent, "key">) {
  if (event.key.length === 1) return event.key.toUpperCase();
  const allowed: Record<string, string> = {
    Insert: "Insert",
    F1: "F1",
    F2: "F2",
    F3: "F3",
    F4: "F4",
    F5: "F5",
    F6: "F6",
    F7: "F7",
    F8: "F8",
    F9: "F9",
    F10: "F10",
    F11: "F11",
    F12: "F12"
  };
  return allowed[event.key] ?? "";
}

function normalizeStoredHotkey(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed.length === 1) return trimmed.toUpperCase();
  return /^F(?:[1-9]|1[0-2])$/.test(trimmed) || trimmed === "Insert" ? trimmed : "";
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

function boundsFromPoints(points: Array<{ x: number; y: number }>, padding: number) {
  if (points.length === 0) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;
  const maxX = Math.max(...xs) + padding;
  const maxY = Math.max(...ys) + padding;
  return {
    x: minX,
    y: minY,
    width: Math.max(44, maxX - minX),
    height: Math.max(44, maxY - minY)
  };
}

function constrainLineEnd(
  start: { x: number; y: number },
  end: { x: number; y: number },
  mode: NonNullable<LineContent["mode"]>
) {
  if (mode === "horizontal") return { x: end.x, y: start.y };
  if (mode === "vertical") return { x: start.x, y: end.y };
  return end;
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
