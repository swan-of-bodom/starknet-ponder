import type { LogFilter, SyncBlock } from "@/internal/types.js";
import { type Hex, hexToBytes, keccak256 } from "starkweb2";

export const zeroLogsBloom =
  "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

const BLOOM_SIZE_BYTES = 256;

export const isInBloom = (_bloom: Hex, input: Hex): boolean => {
  const bloom = hexToBytes(_bloom);
  const hash = hexToBytes(keccak256(input));

  for (const i of [0, 2, 4]) {
    const bit = (hash[i + 1]! + (hash[i]! << 8)) & 0x7ff;
    if (
      (bloom[BLOOM_SIZE_BYTES - 1 - Math.floor(bit / 8)]! &
        (1 << (bit % 8))) ===
      0
    )
      return false;
  }

  return true;
};

/**
 * Return true if `filter` is in block range.
 *
 * NOTE: Starknet doesn't have logsBloom, so this only checks block range.
 * All filters pass the bloom check (no false negatives, but also no optimization).
 */
export function isFilterInBloom({
  block,
  filter,
}: {
  block: Pick<SyncBlock, "number">;
  filter: LogFilter;
}): boolean {
  // Return `false` for out of range blocks
  // block.number is now a plain number, not hex
  if (
    block.number < (filter.fromBlock ?? 0) ||
    block.number > (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  // Starknet doesn't have logsBloom, so we can't filter by bloom
  // Return true to allow all logs (no false negatives)
  return true;
}
