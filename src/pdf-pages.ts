/** Counts PDF pages by their page objects. A `/Type /Pages` tree node is not a page. */
export function countPdfPages(buffer: Buffer): number {
  const text = buffer.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page(?!s)/g);
  return matches?.length ?? 0;
}
