/**
 * Reads text and colours from a PDF or PPTX the visitor uploaded.
 * If the file cannot be read, the caller marks the deck surface as skipped.
 * This does not fetch anything and does not render the file.
 */

import { inflateRawSync } from "node:zlib";
import { canonicalHex, hexFromUnitRgb, uniqueFontNames } from "./checks";

const MAX_ENTRIES = 40;
const MAX_ENTRY_BYTES = 2_000_000;
const MAX_TEXT = 8000;

export interface ParsedDeck {
  text: string;
  colours: string[];
  fonts: string[];
  slideSizes: string[];
  slideCount: number;
}

export type DeckParseResult = { ok: true; deck: ParsedDeck } | { ok: false; reason: string };

export function parseDeck(buffer: Buffer, mimeType: string, filename = ""): DeckParseResult {
  const kind = deckKind(mimeType, filename);
  if (kind === "ppt") {
    return { ok: false, reason: "Older PowerPoint .ppt files are not read. Upload a PPTX or a PDF." };
  }
  if (kind === "unknown") {
    return { ok: false, reason: "That file is not a PDF or PPTX, so the deck was not read." };
  }
  try {
    if (kind === "pptx") return parsePptx(buffer);
    return parsePdf(buffer);
  } catch {
    return { ok: false, reason: "The deck could not be read. Upload a PDF or PPTX with selectable text." };
  }
}

function deckKind(mimeType: string, filename: string): "pdf" | "pptx" | "ppt" | "unknown" {
  const mime = mimeType.toLowerCase();
  const name = filename.toLowerCase();
  if (mime.includes("presentationml") || name.endsWith(".pptx")) return "pptx";
  if (mime === "application/vnd.ms-powerpoint" || name.endsWith(".ppt")) return "ppt";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  return "unknown";
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

function readZip(buffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset + 30 <= buffer.length && entries.length < MAX_ENTRIES) {
    const sig = buffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.toString("utf8", nameStart, nameStart + nameLen);
    const dataStart = nameStart + nameLen + extraLen;
    if (name.includes("..") || name.startsWith("/") || name.startsWith("\\")) {
      throw new Error("unsafe zip name");
    }
    if (flags & 0x08 && compressedSize === 0) {
      throw new Error("zip data descriptor");
    }
    if (dataStart + compressedSize > buffer.length) break;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (method === 0) {
      data = compressed;
    } else if (method === 8) {
      if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error("zip entry too large");
      data = inflateRawSync(compressed);
      if (data.length > MAX_ENTRY_BYTES) throw new Error("zip entry too large");
    } else {
      offset = dataStart + compressedSize;
      continue;
    }
    entries.push({ name, data });
    offset = dataStart + compressedSize;
  }
  if (entries.length === 0) throw new Error("empty zip");
  return entries;
}

function parsePptx(buffer: Buffer): DeckParseResult {
  const entries = readZip(buffer);
  const slides = entries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.name));
  const interesting = entries.filter((entry) => /ppt\/(slides\/slide|presentation\.xml|theme\/)/i.test(entry.name));
  if (slides.length === 0 && interesting.length === 0) {
    return { ok: false, reason: "The PPTX did not contain slides that could be read." };
  }
  const texts: string[] = [];
  const colours: string[] = [];
  const fonts: string[] = [];
  const sizes: string[] = [];
  for (const entry of interesting) {
    const xml = entry.data.toString("utf8");
    for (const match of xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)) {
      const text = decodeXml(match[1]).trim();
      if (text) texts.push(text);
    }
    for (const match of xml.matchAll(/\bval="([0-9A-Fa-f]{6})"/g)) {
      const hex = canonicalHex(match[1]);
      if (hex) colours.push(hex);
    }
    for (const match of xml.matchAll(/\btypeface="([^"]+)"/g)) {
      fonts.push(decodeXml(match[1]));
    }
    for (const match of xml.matchAll(/<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/g)) {
      sizes.push(`${match[1]}x${match[2]}`);
    }
  }
  const text = texts.join(" ").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  if (text.length === 0 && colours.length === 0 && sizes.length === 0) {
    return { ok: false, reason: "The PPTX opened, but no text, colours, or slide size could be read." };
  }
  return {
    ok: true,
    deck: {
      text,
      colours: unique(colours),
      fonts: uniqueFontNames(fonts),
      slideSizes: unique(sizes),
      slideCount: slides.length,
    },
  };
}

function parsePdf(buffer: Buffer): DeckParseResult {
  const raw = buffer.toString("latin1");
  const chunks: string[] = [];
  const re = /<<([^>]*)>>\s*stream\r?\n([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    const dict = match[1] ?? "";
    const body = Buffer.from(match[2] ?? "", "latin1");
    if (/FlateDecode/i.test(dict)) {
      try {
        const inflated = inflateRawSync(body.length > 0 && body[body.length - 1] === 0x0a ? body.subarray(0, -1) : body);
        chunks.push(inflated.toString("latin1"));
      } catch {
        try {
          chunks.push(inflateRawSync(body).toString("latin1"));
        } catch {
          /* skip unreadable stream */
        }
      }
    } else {
      chunks.push(body.toString("latin1"));
    }
  }
  if (chunks.length === 0) chunks.push(raw);

  const texts: string[] = [];
  const colours: string[] = [];
  for (const chunk of chunks) {
    texts.push(...pdfLiteralStrings(chunk));
    for (const colour of chunk.matchAll(/([0-9]*\.?[0-9]+)\s+([0-9]*\.?[0-9]+)\s+([0-9]*\.?[0-9]+)\s+rg\b/g)) {
      const r = Number(colour[1]);
      const g = Number(colour[2]);
      const b = Number(colour[3]);
      if ([r, g, b].every((n) => n >= 0 && n <= 1)) colours.push(hexFromUnitRgb(r, g, b));
    }
  }
  const text = texts.join(" ").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  if (text.length === 0 && colours.length === 0) {
    return { ok: false, reason: "The PDF opened, but no text or colours could be read. Scanned pages are not assessed." };
  }
  return {
    ok: true,
    deck: {
      text,
      colours: unique(colours),
      fonts: [],
      slideSizes: [],
      slideCount: 0,
    },
  };
}

function pdfLiteralStrings(content: string): string[] {
  const out: string[] = [];
  const re = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    const text = unescapePdf(match[1] ?? "").trim();
    if (text) out.push(text);
  }
  const arrayRe = /\[(.*?)\]\s*TJ/gs;
  while ((match = arrayRe.exec(content))) {
    const inner = match[1] ?? "";
    const parts = inner.matchAll(/\(((?:\\.|[^\\)])*)\)/g);
    const bits: string[] = [];
    for (const part of parts) bits.push(unescapePdf(part[1] ?? ""));
    const text = bits.join("").trim();
    if (text) out.push(text);
  }
  return out;
}

function unescapePdf(value: string): string {
  return value.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_all, seq: string) => {
    if (seq === "n") return "\n";
    if (seq === "r") return "\r";
    if (seq === "t") return "\t";
    if (seq === "b") return "\b";
    if (seq === "f") return "\f";
    if (seq === "(" || seq === ")" || seq === "\\") return seq;
    return String.fromCharCode(parseInt(seq, 8));
  });
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function unique(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
