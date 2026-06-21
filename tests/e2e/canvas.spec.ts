import { expect, test } from "@playwright/test";

test("moves a note by its drag handle without fighting the text editor", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const note = page.locator(".card-note").first();
  const handle = note.locator(".dragHandle");
  await expect(note).toContainText("Добро пожаловать в ACANVAS");

  const before = await note.boundingBox();
  const handleBox = await handle.boundingBox();
  expect(before).not.toBeNull();
  expect(handleBox).not.toBeNull();

  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x + 130, handleBox!.y + 90, { steps: 8 });
  await page.mouse.up();

  const after = await note.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.x - before!.x)).toBeGreaterThan(40);
  expect(Math.abs(after!.y - before!.y)).toBeGreaterThan(30);
});

test("drops a note into a board and removes it from the current board", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await page.getByTitle("Note").click();
  const note = page.locator(".card-note").last();
  const noteHandle = note.locator(".dragHandle");
  const targetBoard = page.locator(".card-board").first();

  const noteHandleBox = await noteHandle.boundingBox();
  const boardBox = await targetBoard.boundingBox();
  expect(noteHandleBox).not.toBeNull();
  expect(boardBox).not.toBeNull();

  await page.mouse.move(noteHandleBox!.x + noteHandleBox!.width / 2, noteHandleBox!.y + noteHandleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(boardBox!.x + boardBox!.width / 2, boardBox!.y + boardBox!.height / 2, { steps: 12 });
  await page.mouse.up();

  await targetBoard.getByRole("button", { name: "Open board" }).click();
  await expect(page.locator(".card-note")).toHaveCount(1);
});

test("keeps a note stable when it is dragged inside a nested board", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await page.getByTitle("Note").click();
  const note = page.locator(".card-note").last();
  const noteHandle = note.locator(".dragHandle");
  const targetBoard = page.locator(".card-board").first();
  const noteHandleBox = await noteHandle.boundingBox();
  const boardBox = await targetBoard.boundingBox();

  await page.mouse.move(noteHandleBox!.x + noteHandleBox!.width / 2, noteHandleBox!.y + noteHandleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(boardBox!.x + boardBox!.width / 2, boardBox!.y + boardBox!.height / 2, { steps: 12 });
  await page.mouse.up();
  await targetBoard.getByRole("button", { name: "Open board" }).click();

  const nestedNote = page.locator(".card-note").first();
  const nestedHandle = nestedNote.locator(".dragHandle");
  const nestedHandleBox = await nestedHandle.boundingBox();
  await page.mouse.move(nestedHandleBox!.x + nestedHandleBox!.width / 2, nestedHandleBox!.y + nestedHandleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(nestedHandleBox!.x + 100, nestedHandleBox!.y + 70, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator(".card-note")).toHaveCount(1);
  await expect(page.locator(".card-note")).toHaveCount(1);
});

test("marquee-selects cards and creates a transparent connector line", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await page.mouse.move(560, 210);
  await page.mouse.down();
  await page.mouse.move(990, 430, { steps: 12 });
  await page.mouse.up();

  expect(await page.locator(".card-board.isSelected").count()).toBeGreaterThanOrEqual(2);
  await page.getByTitle("Line").click();
  await expect(page.locator(".card-line")).toHaveCount(1);
  await expect(page.locator(".card-line")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

test("creates a title card and renders markdown in notes", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await page.getByTitle("Title").click();
  await expect(page.locator(".card-title")).toHaveCount(1);
  await expect(page.locator(".card-title input")).toHaveValue("Area title");

  await page.getByTitle("Note").click();
  await expect(page.locator(".markdownPreview h1").first()).toContainText("Title");
  await expect(page.locator(".markdownPreview h2").first()).toContainText("Heading");
  await expect(page.locator(".markdownPreview li")).toHaveCount(2);
});

test("collapses markdown source while keeping the rendered preview visible", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await page.getByTitle("Note").click();
  const note = page.locator(".card-note").last();
  await note.getByRole("button", { name: "Preview" }).click();
  await expect(note.locator(".noteEditor")).toBeHidden();
  await expect(note.locator(".markdownPreview h1")).toContainText("Title");
  await note.getByRole("button", { name: "Edit" }).click();
  await expect(note.locator(".noteEditor")).toBeVisible();
});

test("renames a board from the board card", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const board = page.locator(".card-board").first();
  await board.getByLabel("Board title").fill("People Ops");
  await expect(board.getByLabel("Board title")).toHaveValue("People Ops");
  await board.getByRole("button", { name: "Open board" }).click();
  await expect(page.getByRole("heading", { name: "People Ops" })).toBeVisible();
});

test("does not open a board when double-clicking the board title", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const board = page.locator(".card-board").first();
  await board.getByLabel("Board title").dblclick();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await board.getByLabel("Board title").fill("Renamed board");
  await expect(board.getByLabel("Board title")).toHaveValue("Renamed board");
});

test("pastes a copied URL onto the canvas as a link card", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await page.mouse.move(520, 360);
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "https://example.com/storyboard");
    window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });

  await expect(page.locator(".card-link")).toHaveCount(1);
  await expect(page.locator(".card-link")).toContainText("example.com");
});

test("cuts selected cards and pastes them elsewhere on the current board", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const note = page.locator(".card-note").first();
  await note.locator(".dragHandle").click();
  await page.keyboard.press("Control+X");
  await expect(page.locator(".card-note")).toHaveCount(0);

  await page.mouse.move(880, 520);
  await page.evaluate(() => {
    const data = new DataTransfer();
    window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });

  await expect(page.locator(".card-note")).toHaveCount(1);
  const pastedBox = await page.locator(".card-note").first().boundingBox();
  expect(pastedBox).not.toBeNull();
  expect(pastedBox!.x).toBeGreaterThan(600);
});

test("cuts selected cards and pastes them into another board", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const note = page.locator(".card-note").first();
  const targetBoard = page.locator(".card-board").first();
  await note.locator(".dragHandle").click();
  await page.keyboard.press("Control+X");
  await expect(page.locator(".card-note")).toHaveCount(0);

  await targetBoard.getByRole("button", { name: "Open board" }).click();
  await page.mouse.move(620, 360);
  await page.evaluate(() => {
    const data = new DataTransfer();
    window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });

  await expect(page.locator(".card-note")).toHaveCount(1);
});

test("copies selected cards and pastes duplicates on the current board", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const note = page.locator(".card-note").first();
  await note.locator(".dragHandle").click();
  await page.keyboard.press("Control+C");
  await expect(page.locator(".card-note")).toHaveCount(1);

  await page.mouse.move(900, 520);
  await page.evaluate(() => {
    const data = new DataTransfer();
    window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });

  await expect(page.locator(".card-note")).toHaveCount(2);
});

test("copies selected cards and pastes duplicates into another board", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const note = page.locator(".card-note").first();
  const targetBoard = page.locator(".card-board").first();
  await note.locator(".dragHandle").click();
  await page.keyboard.press("Control+C");
  await targetBoard.getByRole("button", { name: "Open board" }).click();
  await page.mouse.move(620, 360);
  await page.evaluate(() => {
    const data = new DataTransfer();
    window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });

  await expect(page.locator(".card-note")).toHaveCount(1);
});

test("drops a card into a column and shows it as a column child", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const note = page.locator(".card-note").first();
  const noteHandle = note.locator(".dragHandle");
  const column = page.locator(".card-column").first();
  const handleBox = await noteHandle.boundingBox();
  const columnBox = await column.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(columnBox).not.toBeNull();

  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(columnBox!.x + columnBox!.width / 2, columnBox!.y + columnBox!.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect(page.locator(".card-note")).toHaveCount(0);
  await expect(page.locator(".card-column .columnEmbedded")).toHaveCount(1);
  const embeddedBox = await page.locator(".card-column .columnEmbedded").first().boundingBox();
  expect(embeddedBox).not.toBeNull();
  await page.mouse.move(embeddedBox!.x + 16, embeddedBox!.y + 16);
  await page.mouse.down();
  await page.mouse.move(columnBox!.x + columnBox!.width + 90, columnBox!.y + 90, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator(".card-note")).toHaveCount(1);
});

test("renders a todo correctly inside a column", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await page.getByTitle("To-do").click();
  const todo = page.locator(".card-todo").last();
  const todoHandle = todo.locator(".dragHandle");
  const column = page.locator(".card-column").first();
  const handleBox = await todoHandle.boundingBox();
  const columnBox = await column.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(columnBox).not.toBeNull();

  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(columnBox!.x + columnBox!.width / 2, columnBox!.y + columnBox!.height / 2, { steps: 12 });
  await page.mouse.up();

  const checkboxBox = await page.locator(".columnEmbedded-todo input[type='checkbox']").first().boundingBox();
  expect(checkboxBox).not.toBeNull();
  expect(checkboxBox!.width).toBeLessThanOrEqual(18);
  await expect(page.locator(".columnEmbedded-todo .todoTextInput").first()).toHaveValue("First task");
});

test("edits todo title and items", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await page.getByTitle("To-do").click();
  const todo = page.locator(".card-todo").last();
  await todo.getByLabel("Todo title").fill("Launch tasks");
  await todo.locator(".todoTextInput").first().fill("Write brief");
  await todo.getByRole("button", { name: "Add task" }).click();
  await expect(todo.locator(".todoTextInput")).toHaveCount(2);
  await todo.locator(".todoTextInput").last().fill("Collect references");
  await todo.getByLabel("Delete todo item").first().click();

  await expect(todo.getByLabel("Todo title")).toHaveValue("Launch tasks");
  await expect(todo.locator(".todoTextInput")).toHaveCount(1);
  await expect(todo.locator(".todoTextInput").first()).toHaveValue("Collect references");
});

test("keeps connector lines behind cards when selected", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await page.mouse.move(560, 210);
  await page.mouse.down();
  await page.mouse.move(990, 430, { steps: 12 });
  await page.mouse.up();
  await page.getByTitle("Line").click();

  const lineZ = await page.locator(".card-line").first().evaluate((node) => Number(getComputedStyle(node).zIndex));
  const cardZ = await page.locator(".card-board").first().evaluate((node) => Number(getComputedStyle(node).zIndex));
  expect(lineZ).toBeLessThan(cardZ);
});

test("trash opens a restore panel instead of restoring everything", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const note = page.locator(".card-note").first();
  await note.locator(".dragHandle").click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".card-note")).toHaveCount(0);

  await page.getByTitle("Open trash").click();
  await expect(page.locator(".sidePanel")).toContainText("Trash");
  await expect(page.locator(".card-note")).toHaveCount(0);
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.locator(".card-note")).toHaveCount(1);
});

test("trash can permanently delete a card", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const note = page.locator(".card-note").first();
  await note.locator(".dragHandle").click();
  await page.keyboard.press("Delete");
  await page.getByTitle("Open trash").click();

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator(".card-note")).toHaveCount(0);
  await expect(page.locator(".sidePanel")).toContainText("Trash is empty");
});

test("trash can permanently delete all cards", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await page.locator(".card-note").first().locator(".dragHandle").click();
  await page.keyboard.press("Delete");
  await page.getByTitle("Title").click();
  await page.locator(".card-title").last().locator(".dragHandle").click();
  await page.keyboard.press("Delete");
  await page.getByTitle("Open trash").click();

  await page.getByRole("button", { name: "Delete all" }).click();
  await expect(page.locator(".sidePanel")).toContainText("Trash is empty");
});

test("collapses the right sidebar", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await page.getByTitle("Hide sidebar").click();
  await expect(page.locator(".app")).toHaveClass(/rightPanelClosed/);
  await page.getByTitle("Show sidebar").click();
  await expect(page.locator(".app")).not.toHaveClass(/rightPanelClosed/);
});

test("keeps the drag handle above the note content", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const note = page.locator(".card-note").first();
  const handleBox = await note.locator(".dragHandle").boundingBox();
  const noteBox = await note.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(noteBox).not.toBeNull();
  expect(handleBox!.y + handleBox!.height).toBeLessThan(noteBox!.y + 16);
});

test("pans the canvas with space and left mouse drag", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const note = page.locator(".card-note").first();
  const before = await note.boundingBox();
  expect(before).not.toBeNull();

  await page.keyboard.down("Space");
  await page.mouse.move(760, 480);
  await page.mouse.down();
  await page.mouse.move(860, 540, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Space");

  const after = await note.boundingBox();
  expect(after).not.toBeNull();
  expect(after!.x - before!.x).toBeGreaterThan(70);
  expect(after!.y - before!.y).toBeGreaterThan(40);
});

test("draws and erases a freehand stroke", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await page.getByTitle("Draw").click();
  await page.mouse.move(420, 520);
  await page.mouse.down();
  await page.mouse.move(470, 560, { steps: 5 });
  await page.mouse.move(530, 520, { steps: 5 });
  await page.mouse.up();

  await expect(page.locator(".drawingLayer path")).toHaveCount(1);
  await page.getByText("Eraser").click();
  await page.mouse.move(470, 550);
  await page.mouse.down();
  await page.mouse.move(480, 555, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator(".drawingLayer path")).toHaveCount(0);
});

test("opens a file picker from Upload and creates a file card", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByTitle("Upload").click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "brief.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 test")
  });

  await expect(page.locator(".card-file").filter({ hasText: "brief.pdf" })).toBeVisible();
});
