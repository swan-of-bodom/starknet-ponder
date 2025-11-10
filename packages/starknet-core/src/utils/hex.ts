import { num } from "starknet";
import type { Hex } from "starkweb2";

export function toHex64(value: string | number | bigint): Hex {
  if (typeof value === "string" && !value.startsWith("0x")) {
    throw new Error(`Invalid hex string: ${value}`);
  }
  return num.toHex64(value) as Hex;
}
