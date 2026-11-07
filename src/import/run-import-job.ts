import type Database from "better-sqlite3";
import type { JobRow } from "../jobs";
import { getBrand, setBrandContext, setBrandStatus, addSourceAsset } from "../brands";
import { fetchBrandSource } from "./fetch";
import { extractBrandContext } from "./extract";
import { downloadAndValidateAsset, saveAssetFile, saveTextFile } from "./assets";
import { newId } from "../ids";

const MAX_LOGO_DOWNLOADS = 5;

export async function runImportJob(db: Database.Database, job: JobRow): Promise<void> {
  if (!job.brand_id) throw new Error("Import job has no brand_id");
  const brand = getBrand(db, job.brand_id);
  if (!brand) throw new Error(`Brand ${job.brand_id} not found`);

  setBrandStatus(db, brand.id, "importing");

  try {
    await runImport(db, brand.id, brand.source_url);
  } catch (err) {
    setBrandStatus(db, brand.id, "failed", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

async function runImport(db: Database.Database, brandId: string, sourceUrl: string): Promise<void> {
  const brand = { id: brandId, source_url: sourceUrl };
  const source = await fetchBrandSource(brand.source_url);
  const context = extractBrandContext({
    sourceUrl: brand.source_url,
    html: source.html,
    stylesheets: source.stylesheets,
    stylesheetsSkipped: source.stylesheetsSkipped,
  });

  // Provenance: keep the raw fetched HTML and stylesheets on disk, recorded
  // as source_assets. Never exposed on the public share page — see server.ts.
  const htmlPath = saveTextFile(brand.id, "page.html", source.html);
  addSourceAsset(db, brand.id, {
    origin_url: brand.source_url,
    kind: "html",
    mime_type: "text/html",
    local_path: htmlPath,
    byte_size: Buffer.byteLength(source.html),
    sha256: null,
    confidence: null,
    extraction_method: "fetched page HTML",
  });

  source.stylesheets.forEach((sheet, i) => {
    const p = saveTextFile(brand.id, `stylesheet-${i}.css`, sheet.text);
    addSourceAsset(db, brand.id, {
      origin_url: sheet.url,
      kind: "stylesheet",
      mime_type: "text/css",
      local_path: p,
      byte_size: Buffer.byteLength(sheet.text),
      sha256: null,
      confidence: null,
      extraction_method: "linked stylesheet",
    });
  });

  // context.logoCandidates keeps the fine-grained kind (header_img, header_svg,
  // favicon, og_image) for display; source_assets.kind is the coarser storage
  // category the DB schema models (logo | favicon | og_image | ...).
  const storageKind: Record<string, "logo" | "favicon" | "og_image"> = {
    header_img: "logo",
    header_svg: "logo",
    favicon: "favicon",
    og_image: "og_image",
  };

  const downloadable = context.logoCandidates.filter((c) => c.kind !== "header_svg").slice(0, MAX_LOGO_DOWNLOADS);
  for (const candidate of downloadable) {
    try {
      const asset = await downloadAndValidateAsset(candidate.url);
      const assetId = newId("asset");
      const localPath = saveAssetFile(brand.id, assetId, asset);
      addSourceAsset(db, brand.id, {
        origin_url: candidate.url,
        kind: storageKind[candidate.kind] ?? "logo",
        mime_type: asset.mimeType,
        local_path: localPath,
        byte_size: asset.buffer.length,
        sha256: asset.sha256,
        confidence: candidate.confidence,
        extraction_method: asset.sanitized ? `${candidate.method}; SVG sanitised before storage` : candidate.method,
      });
    } catch (err) {
      context.unknowns.push(
        `Could not download candidate ${candidate.kind} from ${candidate.url}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  setBrandContext(db, brand.id, context);
}
