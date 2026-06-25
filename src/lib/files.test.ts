import { describe, expect, it } from "vitest";
import { fileNameFromPath, formatBytes, isPreviewableMime, mimeFromPath } from "./files";

describe("file helpers", () => {
  it("normalizes Windows paths and known MIME types", () => {
    expect(fileNameFromPath("D:\\Projects\\ACANVAS\\AI UP.txt")).toBe("AI UP.txt");
    expect(mimeFromPath("D:\\Projects\\ACANVAS\\AI UP.txt")).toBe("text/plain");
    expect(mimeFromPath("D:\\Projects\\ACANVAS\\clip.mp4")).toBe("video/mp4");
    expect(mimeFromPath("D:\\Projects\\ACANVAS\\deck.unknown")).toBe("application/octet-stream");
  });

  it("detects previewable local media types", () => {
    expect(isPreviewableMime("image/png")).toBe(true);
    expect(isPreviewableMime("video/mp4")).toBe(true);
    expect(isPreviewableMime("audio/mpeg")).toBe(true);
    expect(isPreviewableMime("application/pdf")).toBe(true);
    expect(isPreviewableMime("application/msword")).toBe(false);
  });

  it("formats file sizes for card metadata", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(35)).toBe("35 B");
    expect(formatBytes(91_400_000)).toBe("87.2 MB");
  });
});
