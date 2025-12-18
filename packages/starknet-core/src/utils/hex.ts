import { num } from "starknet";
import type { Hex, Address, Hash } from "viem";

/** Pad hex value to 64 characters if necessary */
export function toHex64(value: string | number | bigint): Hex {
  if (typeof value === "string" && !value.startsWith("0x")) {
    throw new Error(`Invalid hex string: ${value}`);
  }
  return num.toHex64(value) as Hex;
}

/** Starknet zero address */
export const zeroAddress =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as Address;

/** Starknet zero hash */
export const zeroHash =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

/** Convert hex string to bigint */
export function hexToBigInt(hex: string): bigint {
  return num.toBigInt(hex);
}

/** Convert hex string to number */
export function hexToNumber(hex: string): number {
  return Number(num.toBigInt(hex));
}

/** Check if value is a hex string */
export function isHex(value: unknown): value is Hex {
  return typeof value === "string" && num.isHex(value);
}

/** Convert value to hex string */
export function toHex(value: string | number | bigint): Hex {
  return num.toHex(value) as Hex;
}

// Re-export viem types for convenience
export type { Hex, Address, Hash };
