import fs from "node:fs";
import path from "node:path";
import { buildZip, type ZipEntry } from "../zip-safe";
import type { PostAssetRow, PostRow } from "./store";

function imageName(post: PostRow, asset: PostAssetRow, imageCount: number): string | null {
  if (asset.kind === "x_png") return null;
  if (asset.kind === "pdf") return post.format_family === "carousel" ? "carousel.pdf" : null;
  if (post.format_family === "explainer" && imageCount === 1) return "checklist.png";
  return `page-${String((asset.page_index ?? 0) + 1).padStart(2, "0")}.png`;
}

export function postPackageEntries(post: PostRow, assets: PostAssetRow[], ledger: { id: string; sourceUrl: string }[]): ZipEntry[] {
  const hook = post.format_family === "hook";
  const entries: ZipEntry[] = [{ name: "caption.txt", data: post.caption }];
  if (hook) {
    entries.push({ name: "hook.txt", data: post.hook });
  } else {
    entries.push({ name: "alt.txt", data: post.alt_text });
  }
  entries.push(
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
    }
  );
  if (hook) return entries;

  const ordered = [...assets]
    .filter((asset) => asset.kind !== "x_png")
    .sort((a, b) => (a.page_index ?? 0) - (b.page_index ?? 0));
  const imageCount = ordered.filter((asset) => asset.kind !== "pdf").length;
  for (const asset of ordered) {
    if (!asset.file_path || !fs.existsSync(asset.file_path)) continue;
    const name = imageName(post, asset, imageCount);
    if (!name) continue;
    entries.push({ name, data: fs.readFileSync(asset.file_path) });
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
