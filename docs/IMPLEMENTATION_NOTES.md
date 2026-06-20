# ACANVAS Implementation Notes

## MVP Surface

- App shell: Home, breadcrumbs, board title, undo/redo, search, export, settings placeholder.
- Toolbar: Note, Link, To-do, Line, Board, Column, Comment, Add image, Upload, Draw placeholder, Trash restore.
- Canvas: dark dotted background, drag/drop creation, local file drops, card movement, resizing, zoom, selection, delete to trash.
- Cards: note editor, link card, file/image card, board navigation card, column card, comment card, todo card, line card.

## Next Backend Tasks

- Replace snapshot-only saves with per-table CRUD commands.
- Add file import command that copies files into `%APPDATA%/ACANVAS/assets`.
- Generate thumbnails in Rust and store thumbnail paths in `assets`.
- Add `.acanvas.zip` export containing DB snapshot and assets.

## Next Frontend Tasks

- Add real column membership drag/drop.
- Add rich text toolbar for notes.
- Add link display mode toggles.
- Add proper pan mode with middle mouse and space-drag.
- Add import workspace flow.
- Add settings panel and persistent preferences.
