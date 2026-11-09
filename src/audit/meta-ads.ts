/**
 * Optional Meta Ad Library read. Official ads_archive endpoint only.
 * Covers ads shown in the EU. Skipped entirely when the token is unset.
 */

import { config } from "../config";
import { safeFetch } from "../security/url";

export interface MetaAd {
  pageName: string | null;
  body: string | null;
  title: string | null;
  snapshotUrl: string | null;
}

export type MetaAdsResult =
  | { assessed: false; reason: string }
  | { assessed: true; ads: MetaAd[] };

const EU = ["GB", "DE", "FR", "NL", "IE", "ES", "IT"];

export function findMetaPage(html: string): { pageId: string | null; pageName: string | null } {
  const idMatch = html.match(/facebook\.com\/(?:pages\/[^/"']+\/|profile\.php\?id=)(\d{5,})/i);
  const slug = html.match(/facebook\.com\/(?!sharer|share|dialog|plugins|tr)([A-Za-z0-9.\-]{3,})/i);
  return {
    pageId: idMatch?.[1] ?? null,
    pageName: slug?.[1]?.replace(/\./g, " ") ?? null,
  };
}

export async function searchMetaAds(brandName: string, html: string): Promise<MetaAdsResult> {
  const token = config.META_AD_LIBRARY_TOKEN;
  if (!token) {
    return {
      assessed: false,
      reason:
        "Not assessed. META_AD_LIBRARY_TOKEN is not set, so the Meta Ad Library was not queried. It only covers ads shown in the EU.",
    };
  }
  const page = findMetaPage(html);
  const params = new URLSearchParams({
    access_token: token,
    ad_reached_countries: JSON.stringify(EU),
    ad_type: "ALL",
    ad_active_status: "ALL",
    fields: "ad_creative_bodies,ad_creative_link_titles,ad_snapshot_url,page_name",
    limit: "3",
  });
  if (page.pageId) params.set("search_page_ids", page.pageId);
  else params.set("search_terms", (page.pageName || brandName).slice(0, 80));
  try {
    const result = await safeFetch(`https://graph.facebook.com/v21.0/ads_archive?${params}`, {
      timeoutMs: 15_000,
      maxBytes: 1_000_000,
    });
    if (result.statusCode >= 400) {
      return { assessed: false, reason: "Not assessed. The Meta Ad Library did not return ads for this name." };
    }
    const json = JSON.parse(result.body.toString("utf8")) as {
      data?: Array<{
        page_name?: string;
        ad_creative_bodies?: string[];
        ad_creative_link_titles?: string[];
        ad_snapshot_url?: string;
      }>;
    };
    const ads = (json.data || []).slice(0, 3).map((ad) => ({
      pageName: ad.page_name || null,
      body: ad.ad_creative_bodies?.[0]?.slice(0, 400) || null,
      title: ad.ad_creative_link_titles?.[0]?.slice(0, 160) || null,
      snapshotUrl: ad.ad_snapshot_url || null,
    }));
    return { assessed: true, ads };
  } catch {
    return { assessed: false, reason: "Not assessed. The Meta Ad Library could not be reached." };
  }
}
