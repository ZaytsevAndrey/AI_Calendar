/**
 * Completeness comes from a trusted search, never from the interpreter.
 * A missing receipt is not a complete result.
 */
export type SearchReceipt = {
  complete: boolean;
  truncated?: boolean;
  failed?: boolean;
  duplicate?: boolean;
  ids?: string[];
};

export type SearchPage = {
  ids: string[];
  nextPage: string | null;
  failed?: boolean;
};

export const MATCH_PAGE_CAP = 8;

/** Fold provider pages. The last page is complete only when it has no next token and no page failed. */
export function receiptFromPages(pages: SearchPage[]): SearchReceipt {
  const ids: string[] = [];
  for (const page of pages) {
    if (page.failed) return { complete: false, failed: true, ids };
    ids.push(...page.ids);
  }
  const truncated = pages.length > 0 && pages[pages.length - 1].nextPage != null;
  const duplicate = new Set(ids).size !== ids.length;
  return {
    complete: pages.length > 0 && !truncated && !duplicate,
    truncated,
    duplicate,
    ids: [...new Set(ids)],
  };
}

/** `match_task` stops at 8 and does not say whether more rows exist. A full page is truncated. */
export function receiptFromMatches(ids: string[], cap = MATCH_PAGE_CAP): SearchReceipt {
  if (ids.length >= cap) return { complete: false, truncated: true, ids: ids.slice(0, cap) };
  return receiptFromPages([{ ids, nextPage: null }]);
}

export type BulkBlock =
  | 'completeness_unknown'
  | 'search_incomplete'
  | 'search_truncated'
  | 'search_failed'
  | 'duplicate_targets';

export function bulkBlock(receipt: SearchReceipt | undefined): BulkBlock | null {
  if (!receipt) return 'completeness_unknown';
  if (receipt.failed) return 'search_failed';
  if (receipt.duplicate) return 'duplicate_targets';
  if (receipt.truncated) return 'search_truncated';
  if (receipt.complete !== true) return 'search_incomplete';
  return null;
}
