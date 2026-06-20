import { v4 as uuidv4 } from "uuid";

export function createId(prefix: string) {
  return `${prefix}_${uuidv4().replaceAll("-", "").slice(0, 16)}`;
}

export function nowIso() {
  return new Date().toISOString();
}
