import type { LogFactory } from "@/internal/types.js";
import type { StarknetAbiEvent } from "@/types/starknetAbi.js";
import { dedupe } from "@/utils/dedupe.js";
import { toHex64 } from "@/utils/hex.js";
import type { Address } from "@/utils/hex.js";
import {
  type TupleAbiParameter,
  getBytesConsumedByParam,
  getNestedParamOffset,
} from "@/utils/offset.js";
import { computeEventSelector } from "@/utils/event-selector.js";

const isKey = (member: { kind?: string; indexed?: boolean }): boolean => {
  if ("kind" in member && member.kind === "key") return true;
  if ("indexed" in member && member.indexed) return true;
  return false;
};

const getEventMembers = (
  event: StarknetAbiEvent | { inputs?: any[] },
): any[] => {
  if ("members" in event && event.members) return event.members as any[];
  if ("inputs" in event && event.inputs) return event.inputs as any[];
  return [];
};

export function buildLogFactory({
  address: _address,
  event,
  parameter,
  chainId,
  fromBlock,
  toBlock,
}: {
  address: Address | readonly Address[];
  event:
    | StarknetAbiEvent
    | { type: "event"; name: string; inputs: readonly any[] };
  parameter: string;
  chainId: number;
  fromBlock: number | undefined;
  toBlock: number | undefined;
}): LogFactory {
  const address = Array.isArray(_address)
    ? dedupe(_address)
        .map(toHex64)
        .sort((a, b) => (a < b ? -1 : 1))
    : toHex64(_address);
  const eventSelector = computeEventSelector(event.name);

  const params = parameter.split(".");
  const members = getEventMembers(event);

  if (params.length === 1) {
    // Check if the provided parameter is present in the list of key (indexed) members
    const keyMemberPosition = members
      .filter(isKey)
      .findIndex((member: any) => member.name === params[0]);

    if (keyMemberPosition > -1) {
      return {
        id: `log_${Array.isArray(address) ? address.join("_") : address}_${chainId}_topic${(keyMemberPosition + 1) as 1 | 2 | 3}_${eventSelector}_${fromBlock ?? "undefined"}_${toBlock ?? "undefined"}`,
        type: "log",
        chainId,
        address,
        eventSelector,
        // Add 1 because members will not contain an element for topic0 (the selector)
        childAddressLocation: `topic${(keyMemberPosition + 1) as 1 | 2 | 3}`,
        fromBlock,
        toBlock,
      };
    }
  }

  const dataMembersList = members.filter((x: any) => !isKey(x));
  const dataMemberPosition = dataMembersList.findIndex(
    (member: any) => member.name === params[0],
  );

  if (dataMemberPosition === -1) {
    throw new Error(
      `Factory event parameter not found in factory event signature. Got '${parameter}', expected one of [${members
        .map((i: any) => `'${i.name}'`)
        .join(", ")}].`,
    );
  }

  const dataMember = dataMembersList[dataMemberPosition]!;

  // Check for valid Cairo address types
  const isAddressType =
    dataMember.type === "core::starknet::contract_address::ContractAddress" ||
    dataMember.type === "ContractAddress" ||
    dataMember.type === "felt252" ||
    dataMember.type === "felt" ||
    dataMember.type === "address";

  if (!isAddressType && params.length === 1) {
    throw new Error(
      `Factory event parameter type is not valid. Got '${dataMember.type}', expected 'ContractAddress' or 'felt252'.`,
    );
  }

  if (params.length > 1 && dataMember.type !== "tuple") {
    throw new Error(
      `Factory event parameter type is not valid. Got '${dataMember.type}', expected 'tuple'.`,
    );
  }

  let offset = 0;
  for (let i = 0; i < dataMemberPosition; i++) {
    offset += getBytesConsumedByParam(dataMembersList[i]!);
  }

  if (params.length > 1) {
    const nestedOffset = getNestedParamOffset(
      dataMembersList[dataMemberPosition]! as TupleAbiParameter,
      params.slice(1),
    );

    offset += nestedOffset;
  }

  return {
    id: `log_${Array.isArray(address) ? address.join("_") : address}_${chainId}_offset${offset}_${eventSelector}_${fromBlock ?? "undefined"}_${toBlock ?? "undefined"}`,
    type: "log",
    chainId,
    address,
    eventSelector,
    childAddressLocation: `offset${offset}`,
    fromBlock,
    toBlock,
  };
}
