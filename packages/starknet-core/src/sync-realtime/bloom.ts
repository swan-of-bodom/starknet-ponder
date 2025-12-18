import type { LogFilter, SyncBlock } from "@/internal/types.js";

/**
 * Return true if `filter` is in block range.
 *
 * NOTE: Starknet doesn't have logsBloom, so this only checks block range.
 */
export function isBlockInFilterRange({
  block,
  filter,
}: {
  block: Pick<SyncBlock, "number">;
  filter: LogFilter;
}): boolean {
  if (
    block.number < (filter.fromBlock ?? 0) ||
    block.number > (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  // Starknet doesn't have logsBloom, so we can't filter by bloom
  // Return all logs (no false negatives)
  return true;
}
