export type CardType =
  | "note"
  | "link"
  | "file"
  | "image"
  | "board"
  | "column"
  | "comment"
  | "line"
  | "todo"
  | "title"
  | "folder";

export interface Board {
  id: string;
  parentBoardId: string | null;
  title: string;
  icon: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  sortIndex: number;
  trashedAt: string | null;
}

export interface CanvasCard {
  id: string;
  boardId: string;
  type: CardType;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  style: CardStyle;
  content: CardContent;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
}

export interface CardStyle {
  background?: string;
  color?: string;
  accent?: string;
  icon?: string;
}

export type CardContent =
  | NoteContent
  | LinkContent
  | FileContent
  | BoardContent
  | ColumnContent
  | CommentContent
  | LineContent
  | TodoContent
  | TitleContent
  | FolderContent;

export interface NoteContent {
  text: string;
  format?: "normal" | "heading" | "small" | "code" | "quote";
}

export interface LinkContent {
  url: string;
  title: string;
  description: string;
  imageUrl?: string;
  showImage: boolean;
  showDescription: boolean;
}

export interface FileContent {
  assetId: string;
  fileName: string;
  mimeType: string;
  size: number;
  thumbnailUrl?: string;
}

export interface BoardContent {
  boardId: string;
  title: string;
  icon: string;
  color: string;
}

export interface ColumnContent {
  title: string;
  collapsed: boolean;
  childCardIds: string[];
}

export interface CommentContent {
  text: string;
  replies: Array<{ id: string; text: string; createdAt: string }>;
  attachedToCardId?: string;
}

export interface LineContent {
  points: Array<{ x: number; y: number }>;
  arrowEnd: boolean;
  sourceCardId?: string;
  targetCardId?: string;
}

export interface TodoContent {
  title: string;
  items: Array<{ id: string; text: string; done: boolean }>;
}

export interface TitleContent {
  text: string;
  level: "title" | "section" | "label";
}

export interface FolderContent {
  title: string;
  path: string;
}

export interface DrawStroke {
  id: string;
  boardId: string;
  points: Array<{ x: number; y: number }>;
  color: string;
  width: number;
  createdAt: string;
  trashedAt: string | null;
}

export interface DrawingSettings {
  enabled: boolean;
  tool: "pen" | "eraser";
  color: string;
  width: number;
}

export interface Asset {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  sha256?: string;
  relativePath?: string;
  thumbnailPath?: string;
  objectUrl?: string;
  createdAt: string;
}

export interface WorkspaceState {
  boards: Board[];
  cards: CanvasCard[];
  assets: Asset[];
  drawingStrokes: DrawStroke[];
  drawingSettings: DrawingSettings;
  currentBoardId: string;
  selectedCardIds: string[];
  zoom: number;
  pan: { x: number; y: number };
  history: CanvasSnapshot[];
  future: CanvasSnapshot[];
}

export interface CanvasSnapshot {
  boards: Board[];
  cards: CanvasCard[];
  drawingStrokes: DrawStroke[];
  currentBoardId: string;
}

export interface DropPayload {
  kind: CardType;
  label: string;
}
