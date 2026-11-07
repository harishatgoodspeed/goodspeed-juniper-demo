import type { BrowserContext } from "playwright";

/**
 * Allows only `file:`/`data:` requests (plus the `about:blank` Playwright
 * issues for a fresh page) through a context; aborts everything else before
 * it ever leaves the process. Brand-sourced copy and layout directives are
 * untrusted, so even though our own templates only ever reference local
 * asset paths (see templates.ts's `toLocalFileUrl`), rendering must not
 * depend on that alone — this is the independent network-layer guarantee.
 *
 * Lives in its own module (not render.ts) so logo-fidelity.ts's reference
 * renderer can use the exact same guard without a circular import between
 * the two.
 */
export function installNetworkGuard(context: BrowserContext): void {
  void context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("file:") || url.startsWith("data:") || url === "about:blank") {
      void route.continue();
    } else {
      void route.abort("blockedbyclient");
    }
  });
}
