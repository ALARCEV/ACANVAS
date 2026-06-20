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

  const note = page.locator(".card-note").first();
  const noteHandle = note.locator(".dragHandle");
  const marketingBoard = page.locator(".card-board", { hasText: "Marketing" });

  const noteHandleBox = await noteHandle.boundingBox();
  const boardBox = await marketingBoard.boundingBox();
  expect(noteHandleBox).not.toBeNull();
  expect(boardBox).not.toBeNull();

  await page.mouse.move(noteHandleBox!.x + noteHandleBox!.width / 2, noteHandleBox!.y + noteHandleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(boardBox!.x + boardBox!.width / 2, boardBox!.y + boardBox!.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect(page.locator(".card-note")).toHaveCount(0);
  await marketingBoard.dblclick();
  await expect(page.locator(".card-note")).toContainText("Добро пожаловать в ACANVAS");
});

test("keeps a note stable when it is dragged inside a nested board", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const note = page.locator(".card-note").first();
  const noteHandle = note.locator(".dragHandle");
  const marketingBoard = page.locator(".card-board", { hasText: "Marketing" });
  const noteHandleBox = await noteHandle.boundingBox();
  const boardBox = await marketingBoard.boundingBox();

  await page.mouse.move(noteHandleBox!.x + noteHandleBox!.width / 2, noteHandleBox!.y + noteHandleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(boardBox!.x + boardBox!.width / 2, boardBox!.y + boardBox!.height / 2, { steps: 12 });
  await page.mouse.up();
  await marketingBoard.dblclick();

  const nestedNote = page.locator(".card-note").first();
  const nestedHandle = nestedNote.locator(".dragHandle");
  const nestedHandleBox = await nestedHandle.boundingBox();
  await page.mouse.move(nestedHandleBox!.x + nestedHandleBox!.width / 2, nestedHandleBox!.y + nestedHandleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(nestedHandleBox!.x + 100, nestedHandleBox!.y + 70, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator(".card-note")).toHaveCount(1);
  await expect(page.locator(".card-note")).toContainText("Добро пожаловать в ACANVAS");
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
  await expect(page.locator(".card-column .columnChild")).toHaveCount(1);
  await page.locator(".card-column .columnChild").first().click();
  await expect(page.locator(".card-note")).toHaveCount(1);
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
