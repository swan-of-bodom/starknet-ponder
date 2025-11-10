import { selector } from "starknet";
import type { Address, Hex } from "starkweb2";
import { toHex64 } from "./hex.js";

/** Compute Starknet event selector from event name */
export function computeEventSelector(eventName: string): Hex {
  const simpleName = eventName.split("::").pop() || eventName;
  return toHex64(selector.getSelectorFromName(simpleName));
}

/** Normalize Starknet address to 66 characters */
export function normalizeAddress(address: Address): Address {
  return toHex64(address);
}

/** Extract events from a Starknet ABI and compute their selectors */
export function extractEventsFromAbi(abi: readonly unknown[]): Record<string, string> {
  const events: Record<string, string> = {};

  for (const item of abi) {
    if (typeof item !== 'object' || item === null) continue;
    const abiItem = item as any;
    // Check if this is an event
    if (abiItem.type === "event" || (abiItem.kind === "struct" && abiItem.type === "event")) {
      const fullName = abiItem.name;
      const simpleName = fullName.split("::").pop() || fullName;
      const selector = computeEventSelector(fullName);
      events[simpleName] = selector;
    }
  }

  return events;
}
