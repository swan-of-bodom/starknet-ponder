import type { AbiEvent } from "abitype";
import type { Hex } from "./hex.js";
import {
  events,
  CallData,
  cairo,
  shortString,
  createAbiParser,
} from "starknet";
import type { StarknetAbi } from "../types/starknetAbi.js";
import { toHex64 } from "./hex.js";

/** Strip leading zeros from hex (starknet.js expects minimal hex format) */
const stripLeadingZeros = (hex: string): string => {
  if (!hex.startsWith("0x0")) return hex;
  return `0x${hex.slice(2).replace(/^0+/, "") || "0"}`;
};

/** Check if type is an address/hash that should be converted to hex */
const isAddressType = (type: string): boolean =>
  cairo.isTypeContractAddress(type) ||
  cairo.isTypeEthAddress(type) ||
  type.includes("class_hash::ClassHash") ||
  type === "ClassHash";

/** Check if type is felt252 (might be a short string) */
const isFelt252 = (type: string): boolean =>
  type === "core::felt252" || type === "felt252" || type === "felt";

/** Try to decode bigint as Cairo short string */
const tryDecodeShortString = (value: bigint): string | undefined => {
  try {
    const decoded = shortString.decodeShortString(`0x${value.toString(16)}`);
    return decoded && shortString.isASCII(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Normalize legacy Cairo 0 event ABIs to Cairo 1 format.
 * Cairo 0: { name, type: "event", inputs: [...] }
 * Cairo 1: { kind: "struct", name, type: "event", members: [...] }
 */
function normalizeLegacyEventAbi(abi: StarknetAbi): StarknetAbi {
  const normalized: any[] = [];
  const eventStructs: any[] = [];
  const eventVariants: any[] = [];

  for (const item of abi as any[]) {
    if (item.type === "event" && item.inputs && !item.kind) {
      const structName = `legacy::${item.name}`;
      eventStructs.push({
        kind: "struct",
        name: structName,
        type: "event",
        members: item.inputs.map((input: any) => ({
          kind: "data",
          name: input.name,
          type: input.type,
        })),
      });
      eventVariants.push({ kind: "nested", name: item.name, type: structName });
    } else {
      normalized.push(item);
    }
  }

  normalized.push(...eventStructs);
  if (eventVariants.length > 0) {
    normalized.push({
      kind: "enum",
      name: "legacy::Event",
      type: "event",
      variants: eventVariants,
    });
  }
  return normalized as StarknetAbi;
}

/**
 * Convert address bigints to hex strings, keep numeric bigints as-is.
 * starknet.js parseEvents returns addresses as bigint, we need hex strings.
 */
function convertAddressesToHex(
  obj: any,
  abiMembers?: any[],
  fullAbi?: StarknetAbi,
): any {
  if (obj == null) return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => convertAddressesToHex(item, abiMembers, fullAbi));
  }
  if (typeof obj !== "object" || !abiMembers) return obj;

  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const member = abiMembers.find((m: any) => m.name === key);

    if (member && typeof value === "bigint") {
      if (isAddressType(member.type)) {
        result[key] = toHex64(value);
      } else if (isFelt252(member.type)) {
        result[key] = tryDecodeShortString(value) ?? value;
      } else {
        result[key] = value;
      }
    } else if (member && typeof value === "object") {
      // Find nested struct definition for recursive conversion
      const structDef =
        fullAbi &&
        (fullAbi as any[]).find(
          (item: any) =>
            item.type === "struct" &&
            (item.name === member.type ||
              item.name.endsWith(`::${member.type}`)),
        );
      result[key] = convertAddressesToHex(value, structDef?.members, fullAbi);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Decode a Starknet event log using starknet.js parseEvents.
 */
export function decodeEventLog({
  keys,
  data,
  fullAbi,
}: {
  abiItem: AbiEvent;
  keys: [signature: Hex, ...args: Hex[]] | [];
  data: Hex[];
  fullAbi?: StarknetAbi;
}): any {
  if (!fullAbi?.length) return;

  try {
    const normalizedAbi = normalizeLegacyEventAbi(fullAbi);
    const normalizedKeys = (keys as string[])
      .filter((k): k is string => k != null)
      .map(stripLeadingZeros);

    const abiEvents = events.getAbiEvents(normalizedAbi);
    const abiStructs = CallData.getAbiStruct(normalizedAbi);
    const abiEnums = CallData.getAbiEnum(normalizedAbi);
    const parser = createAbiParser(normalizedAbi);

    const parsedEvents = events.parseEvents(
      [
        {
          from_address: "0x0",
          keys: normalizedKeys,
          data,
          block_hash: "0x0",
          block_number: 0,
          transaction_hash: "0x0",
        },
      ],
      abiEvents,
      abiStructs,
      abiEnums,
      parser,
    );

    const parsed = parsedEvents?.[0];
    if (!parsed) return;

    // parseEvents returns { block_hash, block_number, transaction_hash, [eventName]: args }
    const {
      block_hash: _,
      block_number: __,
      transaction_hash: ___,
      ...eventData
    } = parsed;
    const eventKeys = Object.keys(eventData);
    const args = eventKeys.length === 1 ? eventData[eventKeys[0]!] : eventData;
    if (!args || Object.keys(args).length === 0) return;

    // Get event ABI for address type conversion
    const selector = normalizedKeys[0];
    const eventAbi = selector ? (abiEvents as any)[selector] : undefined;

    return eventAbi?.members
      ? convertAddressesToHex(args, eventAbi.members, normalizedAbi)
      : args;
  } catch {
    return undefined;
  }
}
