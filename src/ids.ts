import crypto from "node:crypto";

/** Short, URL-safe, cryptographically random ID with a type prefix, e.g. "brand_8f2a...". */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}
