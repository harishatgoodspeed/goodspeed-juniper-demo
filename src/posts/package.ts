import fs from "node:fs";
import path from "node:path";
import { buildZip, type ZipEntry } from "../zip-safe";
import type { PostAssetRow, PostRow } from "./store";

function sharedNotes(post: PostRow, ledger: { id: string; sourceUrl: string }[]): ZipEntry[] {
  return [
    { name: "brand-version.txt", data: String(post.brand_version) },
    { name: "revision.txt", data: String(post.revision) },
    {
      name: "sources.json",
      data: JSON.stringify(
        {
          format: post.format_note,
          composition: post.composition_id,
          ledger: ledger.map((entry) => ({ id: entry.id, sourceUrl: entry.sourceUrl })),
          automatedChecksPassed: post.review_passed === 1,
          humanSignOff: false,
          truthGuaranteed: false,
        },
        null,
        2
      ),
    },
  ];
}

export function postPackageEntries(post: PostRow, assets: PostAssetRow[], ledger: { id: string; sourceUrl: string }[]): ZipEntry[] {
  if (post.format_family === "hook") {
    return [{ name: "caption.txt", data: post.caption }, { name: "hook.txt", data: post.hook }, ...sharedNotes(post, ledger)];
  }

  const entries: ZipEntry[] = [
    { name: "caption.txt", data: post.caption },
    { name: "alt.txt", data: post.alt_text },
    ...sharedNotes(post, ledger),
  ];
  const ordered = [...assets].sort((a, b) => (a.page_index ?? 0) - (b.page_index ?? 0));
  for (const asset of ordered) {
    if (asset.kind === "x_png") continue;
    if (!asset.file_path || !fs.existsSync(asset.file_path)) continue;
    const base =
      asset.kind === "pdf"
        ? "carousel.pdf"
        : post.format_family === "explainer"
          ? "checklist.png"
          : `page-${String((asset.page_index ?? 0) + 1).padStart(2, "0")}.png`;
    entries.push({ name: base, data: fs.readFileSync(asset.file_path) });
  }
  return entries;
}

export function buildPostZip(post: PostRow, assets: PostAssetRow[], ledger: { id: string; sourceUrl: string }[]): Buffer {
  return buildZip(postPackageEntries(post, assets, ledger));
}

export function buildRunZip(
  groups: Array<{ post: PostRow; assets: PostAssetRow[]; ledger: { id: string; sourceUrl: string }[] }>
): Buffer {
  const entries: ZipEntry[] = [];
  for (const group of groups) {
    const folder = `post-${String(group.post.position + 1).padStart(2, "0")}-${group.post.format_family}`;
    for (const entry of postPackageEntries(group.post, group.assets, group.ledger)) {
      const name = path.posix.join(folder, entry.name);
      entries.push({ name, data: entry.data });
    }
  }
  return buildZip(entries);
}
