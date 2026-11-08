import type Database from "better-sqlite3";
import { GOODSPEED_CONTACT_URL } from "../contact";
import { unsupportedNumericTokens, verifyCitedClaims, type LedgerEntry } from "../ledger";
import { getRun } from "../runs";
import { getPost, listPostsForRun, snapshotPost, updatePostFields, type PostRow } from "./store";
import { rerenderPost, type PostsJobDeps } from "../jobs/run-posts-job";
import type { PostDraft } from "./types";

function ledgerFor(runLedger: string | null): LedgerEntry[] {
  return runLedger ? (JSON.parse(runLedger) as LedgerEntry[]) : [];
}

export class RegenerateCapError extends Error {
  readonly code = "regenerate_cap";
  readonly contactUrl = GOODSPEED_CONTACT_URL;

  constructor() {
    super("This post has already been regenerated once. Talk to Goodspeed to go further.");
    this.name = "RegenerateCapError";
  }
}

export function claimRegenerate(db: Database.Database, postId: string): PostRow {
  const post = getPost(db, postId);
  if (!post) throw new Error("Post not found");
  const claim = db
    .prepare(
      `UPDATE posts
       SET regenerate_count = regenerate_count + 1,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ? AND regenerate_count < 1`
    )
    .run(postId);
  if (claim.changes !== 1) throw new RegenerateCapError();
  return getPost(db, postId)!;
}

export function releaseRegenerateClaim(db: Database.Database, postId: string): void {
  db.prepare(
    `UPDATE posts
     SET regenerate_count = CASE WHEN regenerate_count > 0 THEN regenerate_count - 1 ELSE 0 END,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`
  ).run(postId);
}

export function editPostCopy(
  db: Database.Database,
  postId: string,
  patch: { caption?: string; altText?: string; hook?: string }
): PostRow {
  const post = getPost(db, postId);
  if (!post) throw new Error("Post not found");
  const beforeCount = post.regenerate_count ?? 0;
  const siblings = listPostsForRun(db, post.run_id).filter((row) => row.id !== post.id);
  snapshotPost(db, post);
  const caption = patch.caption ?? post.caption;
  const hooks = JSON.parse(post.hook_alternatives_json) as string[];
  const hook = patch.hook ?? post.hook;
  if (patch.hook && !hooks.includes(patch.hook) && patch.hook !== post.hook) {
    hooks.unshift(patch.hook);
  }
  updatePostFields(
    db,
    post.id,
    {
      caption,
      alt_text: patch.altText ?? post.alt_text,
      hook,
      hook_alternatives_json: JSON.stringify(hooks.slice(0, 3)),
      review_passed: 0,
      review_json: null,
      review_revision: null,
      review_brand_version: null,
    },
    true
  );
  const updated = getPost(db, post.id)!;
  if ((updated.regenerate_count ?? 0) !== beforeCount) {
    throw new Error("A copy edit must not count as a regenerate.");
  }
  const run = getRun(db, post.run_id);
  const ledger = ledgerFor(run?.ledger_json ?? null);
  const blob = ledger.map((entry) => entry.excerpt).join("\n");
  const visible = `${updated.caption}\n${updated.hook}`;
  const missing = unsupportedNumericTokens(visible, blob);
  const claims = JSON.parse(updated.claims_json);
  const cited = verifyCitedClaims(claims, ledger);
  const problems = [...missing.map((token) => `Uses ${token}, which is not in the source ledger.`)];
  if (!cited.ok) problems.push(cited.reason);
  const passed = problems.length === 0;
  updatePostFields(
    db,
    post.id,
    {
      review_json: JSON.stringify([
        {
          kind: "copy",
          status: passed ? "not_verified" : "fail",
          observed: visible,
          approved: "source ledger",
          explanation: passed
            ? "Figures on the edited copy are in the source ledger. Voice was not rechecked, so this stays a draft."
            : problems.join(" "),
        },
      ]),
      review_revision: updated.revision,
      review_brand_version: updated.brand_version,
      review_passed: 0,
    },
    false
  );
  for (const sibling of siblings) {
    const fresh = getPost(db, sibling.id)!;
    if (fresh.revision !== sibling.revision || fresh.caption !== sibling.caption) {
      throw new Error("Editing one post changed another.");
    }
  }
  return getPost(db, post.id)!;
}

export async function changePostLayout(
  db: Database.Database,
  postId: string,
  compositionId: string,
  deps: PostsJobDeps = {}
): Promise<PostRow> {
  const post = getPost(db, postId);
  if (!post) throw new Error("Post not found");
  const allowed: Record<string, string[]> = {
    carousel: ["carousel-steps", "carousel-checklist"],
    explainer: ["explainer-framework"],
    hook: [],
  };
  if (!allowed[post.format_family]?.includes(compositionId)) {
    throw new Error("That layout is not available for this post.");
  }
  snapshotPost(db, post);
  updatePostFields(
    db,
    post.id,
    { composition_id: compositionId, review_passed: 0, review_json: null, status: "pending" },
    true
  );
  const fresh = getPost(db, post.id)!;
  await rerenderPost(db, fresh.id, deps);
  return getPost(db, post.id)!;
}

export async function regenerateOnePost(
  db: Database.Database,
  postId: string,
  replacement: PostDraft,
  deps: PostsJobDeps = {},
  options: { alreadyClaimed?: boolean } = {}
): Promise<PostRow> {
  const existing = getPost(db, postId);
  if (!existing) throw new Error("Post not found");
  if (replacement.formatFamily !== existing.format_family) {
    throw new Error("Regeneration must keep this post's format. It does not replace the other posts.");
  }
  const post = options.alreadyClaimed ? existing : claimRegenerate(db, postId);
  const before = listPostsForRun(db, post.run_id);
  snapshotPost(db, post);
  updatePostFields(
    db,
    post.id,
    {
      title: replacement.title,
      hook: replacement.hook,
      hook_alternatives_json: JSON.stringify(replacement.hookAlternatives),
      caption: replacement.caption,
      alt_text: replacement.altText,
      composition_id: replacement.compositionId,
      pages_json: JSON.stringify(replacement.formatFamily === "hook" ? [] : replacement.pages),
      claims_json: JSON.stringify(replacement.claims),
      rationale: replacement.rationale,
      status: "pending",
      review_passed: 0,
      review_json: null,
    },
    true
  );
  await rerenderPost(db, post.id, deps);
  const after = listPostsForRun(db, post.run_id);
  for (const sibling of before) {
    if (sibling.id === post.id) continue;
    const next = after.find((row) => row.id === sibling.id);
    if (!next || next.revision !== sibling.revision || next.caption !== sibling.caption) {
      throw new Error("Regeneration changed a post that was not selected.");
    }
  }
  return getPost(db, post.id)!;
}

export function undoPost(db: Database.Database, postId: string): PostRow {
  const post = getPost(db, postId);
  if (!post) throw new Error("Post not found");
  const previous = db
    .prepare(`SELECT snapshot_json FROM post_revisions WHERE post_id = ? ORDER BY revision DESC LIMIT 1`)
    .get(postId) as { snapshot_json: string } | undefined;
  if (!previous) throw new Error("Nothing to undo.");
  const snap = JSON.parse(previous.snapshot_json) as PostRow;
  db.prepare(
    `UPDATE posts SET
      title = ?, hook = ?, hook_alternatives_json = ?, caption = ?, x_caption = ?, alt_text = ?,
      composition_id = ?, pages_json = ?, claims_json = ?, rationale = ?, status = ?,
      review_json = ?, review_revision = ?, review_brand_version = ?, review_passed = ?, error = ?,
      revision = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`
  ).run(
    snap.title,
    snap.hook,
    snap.hook_alternatives_json,
    snap.caption,
    snap.x_caption ?? "",
    snap.alt_text,
    snap.composition_id,
    snap.pages_json,
    snap.claims_json,
    snap.rationale,
    snap.status,
    snap.review_json,
    snap.review_revision,
    snap.review_brand_version,
    snap.review_passed,
    snap.error,
    snap.revision,
    post.id
  );
  db.prepare(`DELETE FROM post_revisions WHERE post_id = ? AND revision = (SELECT MAX(revision) FROM post_revisions WHERE post_id = ?)`).run(
    postId,
    postId
  );
  return getPost(db, post.id)!;
}
