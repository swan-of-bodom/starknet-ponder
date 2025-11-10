import type { Event } from "@/internal/types.js";
import { orderObject } from "@/utils/order.js";
import type { Abi } from "starkweb2";
import type { ProfilePattern, Request } from "./client.js";

export const getProfilePatternKey = (pattern: ProfilePattern): string => {
  return JSON.stringify(
    orderObject({
      address: pattern.address,
      functionName: pattern.functionName,
      args: pattern.args,
    }),
    (_, value) => {
      if (typeof value === "bigint") {
        return value.toString();
      }
      return value;
    },
  );
};

const eq = (target: bigint | string | number | boolean, value: any) => {
  if (target === value) return true;
  if (target && value && target.toString() === value.toString()) return true;
  return false;
};

/** Base type for readContract parameters used in profile recording */
type ReadContractArgs = {
  address: string;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[] | Record<string, unknown>;
  cache?: "immutable";
};

export const recordProfilePattern = ({
  event,
  args,
  hints,
}: {
  event: Event;
  args: ReadContractArgs;
  hints: { pattern: ProfilePattern; hasConstant: boolean }[];
}): { pattern: ProfilePattern; hasConstant: boolean } | undefined => {
  globalThis.DISABLE_EVENT_PROXY = true;

  for (const hint of hints) {
    const request = recoverProfilePattern(hint.pattern, event);
    if (
      request.functionName === args.functionName &&
      request.address === args.address
    ) {
      if (request.args === undefined && args.args === undefined) {
        globalThis.DISABLE_EVENT_PROXY = false;
        return hint;
      }
      if (request.args === undefined || args.args === undefined) continue;
      // Normalize args to array format - starkweb2 supports both object { param: value } and array [value] syntax
      const rawArgsToCompare = (args as any).args;
      const argsToCompare = Array.isArray(rawArgsToCompare)
        ? rawArgsToCompare
        : (Object.values(rawArgsToCompare) as any[]);
      for (let i = 0; i < request.args.length; i++) {
        if (eq(request.args[i] as any, argsToCompare[i]) === false) continue;
      }
      if ((request.blockNumber === "latest") !== (args.cache === "immutable")) {
        continue;
      }

      globalThis.DISABLE_EVENT_PROXY = false;
      return hint;
    }
  }

  let resultAddress: ProfilePattern["address"] | undefined;
  let hasConstant = false;

  // address

  switch (event.type) {
    case "block": {
      // Starknet uses sequencerAddress instead of miner
      if (
        event.event.block.sequencerAddress &&
        eq(event.event.block.sequencerAddress, args.address)
      ) {
        resultAddress = {
          type: "derived",
          value: ["block", "sequencerAddress"],
        };
        break;
      }

      break;
    }

    case "transaction": {
      // Starknet uses sequencerAddress instead of miner
      if (
        event.event.block.sequencerAddress &&
        eq(event.event.block.sequencerAddress, args.address)
      ) {
        resultAddress = {
          type: "derived",
          value: ["block", "sequencerAddress"],
        };
        break;
      }

      // Starknet uses senderAddress instead of from
      if (
        event.event.transaction.senderAddress &&
        eq(event.event.transaction.senderAddress, args.address)
      ) {
        resultAddress = {
          type: "derived",
          value: ["transaction", "senderAddress"],
        };
        break;
      }

      // Starknet doesn't have 'to' field on transactions

      if (
        event.event.transactionReceipt?.contractAddress &&
        eq(event.event.transactionReceipt.contractAddress, args.address)
      ) {
        resultAddress = {
          type: "derived",
          value: ["transactionReceipt", "contractAddress"],
        };
        break;
      }

      break;
    }

    case "log": {
      // Note: explicitly skip profiling args if they are an array
      if (
        event.event.args !== undefined &&
        Array.isArray(event.event.args) === false
      ) {
        let hasMatch = false;

        for (const argKey of Object.keys(event.event.args)) {
          const argValue = (event.event.args as { [key: string]: unknown })[
            argKey
          ] as string | bigint | number | boolean;

          if (typeof argValue !== "object" && eq(argValue, args.address)) {
            resultAddress = { type: "derived", value: ["args", argKey] };
            hasMatch = true;
            break;
          }
        }

        if (hasMatch) break;
      }

      if (eq(event.event.log.address, args.address)) {
        resultAddress = { type: "derived", value: ["log", "address"] };
        break;
      }

      // Starknet uses sequencerAddress instead of miner
      if (
        event.event.block.sequencerAddress &&
        eq(event.event.block.sequencerAddress, args.address)
      ) {
        resultAddress = {
          type: "derived",
          value: ["block", "sequencerAddress"],
        };
        break;
      }

      // Starknet uses senderAddress instead of from
      if (
        event.event.transaction.senderAddress &&
        eq(event.event.transaction.senderAddress, args.address)
      ) {
        resultAddress = {
          type: "derived",
          value: ["transaction", "senderAddress"],
        };
        break;
      }

      // Starknet doesn't have 'to' field on transactions

      if (
        event.event.transactionReceipt?.contractAddress &&
        eq(event.event.transactionReceipt.contractAddress, args.address)
      ) {
        resultAddress = {
          type: "derived",
          value: ["transactionReceipt", "contractAddress"],
        };
        break;
      }

      break;
    }

    case "trace": {
      let hasMatch = false;

      // Note: explicitly skip profiling args if they are an array
      if (
        event.event.args !== undefined &&
        Array.isArray(event.event.args) === false
      ) {
        for (const argKey of Object.keys(event.event.args)) {
          const argValue = (event.event.args as { [key: string]: unknown })[
            argKey
          ] as string | bigint | number | boolean;

          if (typeof argValue !== "object" && eq(argValue, args.address)) {
            resultAddress = { type: "derived", value: ["args", argKey] };
            hasMatch = true;
            break;
          }
        }
      }

      // Note: explicitly skip profiling result if it is an array
      if (
        event.event.result !== undefined &&
        Array.isArray(event.event.result) === false
      ) {
        for (const argKey of Object.keys(event.event.result)) {
          const argValue = (event.event.result as { [key: string]: unknown })[
            argKey
          ] as string | bigint | number | boolean;

          if (typeof argValue !== "object" && eq(argValue, args.address)) {
            resultAddress = { type: "derived", value: ["result", argKey] };
            hasMatch = true;
            break;
          }
        }
      }

      if (hasMatch) break;

      if (eq(event.event.trace.from, args.address)) {
        resultAddress = { type: "derived", value: ["trace", "from"] };
        break;
      }

      if (event.event.trace.to && eq(event.event.trace.to, args.address)) {
        resultAddress = { type: "derived", value: ["trace", "to"] };
        break;
      }

      // Starknet uses sequencerAddress instead of miner
      if (
        event.event.block.sequencerAddress &&
        eq(event.event.block.sequencerAddress, args.address)
      ) {
        resultAddress = {
          type: "derived",
          value: ["block", "sequencerAddress"],
        };
        break;
      }

      // Starknet uses senderAddress instead of from
      if (
        event.event.transaction.senderAddress &&
        eq(event.event.transaction.senderAddress, args.address)
      ) {
        resultAddress = {
          type: "derived",
          value: ["transaction", "senderAddress"],
        };
        break;
      }

      // Starknet doesn't have 'to' field on transactions

      if (
        event.event.transactionReceipt?.contractAddress &&
        eq(event.event.transactionReceipt.contractAddress, args.address)
      ) {
        resultAddress = {
          type: "derived",
          value: ["transactionReceipt", "contractAddress"],
        };
        break;
      }

      break;
    }

    case "transfer": {
      if (eq(event.event.transfer.from, args.address)) {
        resultAddress = { type: "derived", value: ["transfer", "from"] };
        break;
      }

      if (eq(event.event.transfer.to, args.address)) {
        resultAddress = { type: "derived", value: ["transfer", "to"] };
        break;
      }

      if (eq(event.event.trace.from, args.address)) {
        resultAddress = { type: "derived", value: ["trace", "from"] };
        break;
      }

      if (event.event.trace.to && eq(event.event.trace.to, args.address)) {
        resultAddress = { type: "derived", value: ["trace", "to"] };
        break;
      }

      // Starknet uses sequencerAddress instead of miner
      if (
        event.event.block.sequencerAddress &&
        eq(event.event.block.sequencerAddress, args.address)
      ) {
        resultAddress = {
          type: "derived",
          value: ["block", "sequencerAddress"],
        };
        break;
      }

      // Starknet uses senderAddress instead of from
      if (
        event.event.transaction.senderAddress &&
        eq(event.event.transaction.senderAddress, args.address)
      ) {
        resultAddress = {
          type: "derived",
          value: ["transaction", "senderAddress"],
        };
        break;
      }

      // Starknet doesn't have 'to' field on transactions

      if (
        event.event.transactionReceipt?.contractAddress &&
        eq(event.event.transactionReceipt.contractAddress, args.address)
      ) {
        resultAddress = {
          type: "derived",
          value: ["transactionReceipt", "contractAddress"],
        };
        break;
      }

      break;
    }
  }

  if (resultAddress === undefined) {
    resultAddress = { type: "constant", value: args.address };
    hasConstant = true;
  }

  // Normalize args to array format - starkweb2 supports both object { param: value } and array [value] syntax
  const rawArgs = (args as any).args;
  const argsArray =
    rawArgs === undefined
      ? undefined
      : Array.isArray(rawArgs)
        ? rawArgs
        : (Object.values(rawArgs) as any[]);

  if (argsArray === undefined || argsArray.length === 0) {
    globalThis.DISABLE_EVENT_PROXY = false;
    return {
      pattern: {
        address: resultAddress,
        abi: args.abi as Abi,
        functionName: args.functionName,
        args: undefined,
        cache: args.cache,
      },
      hasConstant,
    };
  }

  const resultArgs: NonNullable<ProfilePattern["args"]> = [];

  // args

  for (const arg of argsArray) {
    if (typeof arg === "object") {
      globalThis.DISABLE_EVENT_PROXY = false;
      return undefined;
    }

    switch (event.type) {
      case "block": {
        if (eq(event.event.block.hash, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "hash"] });
          continue;
        }

        if (eq(event.event.block.number, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "number"] });
          continue;
        }

        if (eq(event.event.block.timestamp, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "timestamp"] });
          continue;
        }

        // Starknet uses sequencerAddress instead of miner
        if (
          event.event.block.sequencerAddress &&
          eq(event.event.block.sequencerAddress, arg)
        ) {
          resultArgs.push({
            type: "derived",
            value: ["block", "sequencerAddress"],
          });
          continue;
        }

        break;
      }

      case "transaction": {
        if (eq(event.event.block.hash, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "hash"] });
          continue;
        }

        if (eq(event.event.block.number, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "number"] });
          continue;
        }

        if (eq(event.event.block.timestamp, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "timestamp"] });
          continue;
        }

        // Starknet uses sequencerAddress instead of miner
        if (
          event.event.block.sequencerAddress &&
          eq(event.event.block.sequencerAddress, arg)
        ) {
          resultArgs.push({
            type: "derived",
            value: ["block", "sequencerAddress"],
          });
          continue;
        }

        if (eq(event.event.transaction.hash, arg)) {
          resultArgs.push({ type: "derived", value: ["transaction", "hash"] });
          continue;
        }

        // Starknet uses senderAddress instead of from
        if (
          event.event.transaction.senderAddress &&
          eq(event.event.transaction.senderAddress, arg)
        ) {
          resultArgs.push({
            type: "derived",
            value: ["transaction", "senderAddress"],
          });
          continue;
        }

        // Starknet doesn't have 'to' field on transactions

        if (eq(event.event.transaction.transactionIndex, arg)) {
          resultArgs.push({
            type: "derived",
            value: ["transaction", "transactionIndex"],
          });
          continue;
        }

        if (
          event.event.transactionReceipt?.contractAddress &&
          eq(event.event.transactionReceipt.contractAddress, arg)
        ) {
          resultArgs.push({
            type: "derived",
            value: ["transactionReceipt", "contractAddress"],
          });
          continue;
        }

        break;
      }

      case "log": {
        // Note: explicitly skip profiling args if they are an array
        if (
          event.event.args !== undefined &&
          Array.isArray(event.event.args) === false
        ) {
          let hasMatch = false;

          for (const argKey of Object.keys(event.event.args)) {
            const argValue = (event.event.args as { [key: string]: unknown })[
              argKey
            ] as string | bigint | number | boolean;

            if (typeof argValue !== "object" && eq(argValue, arg)) {
              resultArgs.push({ type: "derived", value: ["args", argKey] });
              hasMatch = true;
              break;
            }
          }

          if (hasMatch) continue;
        }

        if (eq(event.event.log.address, arg)) {
          resultArgs.push({ type: "derived", value: ["log", "address"] });
          continue;
        }

        if (eq(event.event.log.logIndex, arg)) {
          resultArgs.push({ type: "derived", value: ["log", "logIndex"] });
          continue;
        }

        if (eq(event.event.block.hash, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "hash"] });
          continue;
        }

        if (eq(event.event.block.number, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "number"] });
          continue;
        }

        if (eq(event.event.block.timestamp, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "timestamp"] });
          continue;
        }

        // Starknet uses sequencerAddress instead of miner
        if (
          event.event.block.sequencerAddress &&
          eq(event.event.block.sequencerAddress, arg)
        ) {
          resultArgs.push({
            type: "derived",
            value: ["block", "sequencerAddress"],
          });
          continue;
        }

        if (eq(event.event.transaction.hash, arg)) {
          resultArgs.push({ type: "derived", value: ["transaction", "hash"] });
          continue;
        }

        // Starknet uses senderAddress instead of from
        if (
          event.event.transaction.senderAddress &&
          eq(event.event.transaction.senderAddress, arg)
        ) {
          resultArgs.push({
            type: "derived",
            value: ["transaction", "senderAddress"],
          });
          continue;
        }

        // Starknet doesn't have 'to' field on transactions

        if (eq(event.event.transaction.transactionIndex, arg)) {
          resultArgs.push({
            type: "derived",
            value: ["transaction", "transactionIndex"],
          });
          continue;
        }

        if (
          event.event.transactionReceipt?.contractAddress &&
          eq(event.event.transactionReceipt.contractAddress, arg)
        ) {
          resultArgs.push({
            type: "derived",
            value: ["transactionReceipt", "contractAddress"],
          });
          continue;
        }

        break;
      }

      case "trace": {
        let hasMatch = false;

        // Note: explicitly skip profiling args if they are an array
        if (
          event.event.args !== undefined &&
          Array.isArray(event.event.args) === false
        ) {
          for (const argKey of Object.keys(event.event.args)) {
            const argValue = (event.event.args as { [key: string]: unknown })[
              argKey
            ] as string | bigint | number | boolean;

            if (typeof argValue !== "object" && eq(argValue, arg)) {
              resultArgs.push({ type: "derived", value: ["args", argKey] });
              hasMatch = true;
              break;
            }
          }
        }

        // Note: explicitly skip profiling result if it is an array
        if (
          event.event.result !== undefined &&
          Array.isArray(event.event.result) === false
        ) {
          for (const argKey of Object.keys(event.event.result)) {
            const argValue = (event.event.result as { [key: string]: unknown })[
              argKey
            ] as string | bigint | number | boolean;

            if (typeof argValue !== "object" && eq(argValue, arg)) {
              resultArgs.push({ type: "derived", value: ["result", argKey] });
              hasMatch = true;
              break;
            }
          }
        }

        if (hasMatch) continue;

        if (eq(event.event.trace.from, arg)) {
          resultArgs.push({ type: "derived", value: ["trace", "from"] });
          continue;
        }

        if (event.event.trace.to && eq(event.event.trace.to, arg)) {
          resultArgs.push({ type: "derived", value: ["trace", "to"] });
          continue;
        }

        if (eq(event.event.block.hash, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "hash"] });
          continue;
        }

        if (eq(event.event.block.number, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "number"] });
          continue;
        }

        if (eq(event.event.block.timestamp, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "timestamp"] });
          continue;
        }

        // Starknet uses sequencerAddress instead of miner
        if (
          event.event.block.sequencerAddress &&
          eq(event.event.block.sequencerAddress, arg)
        ) {
          resultArgs.push({
            type: "derived",
            value: ["block", "sequencerAddress"],
          });
          continue;
        }

        if (eq(event.event.transaction.hash, arg)) {
          resultArgs.push({ type: "derived", value: ["transaction", "hash"] });
          continue;
        }

        // Starknet uses senderAddress instead of from
        if (
          event.event.transaction.senderAddress &&
          eq(event.event.transaction.senderAddress, arg)
        ) {
          resultArgs.push({
            type: "derived",
            value: ["transaction", "senderAddress"],
          });
          continue;
        }

        // Starknet doesn't have 'to' field on transactions

        if (eq(event.event.transaction.transactionIndex, arg)) {
          resultArgs.push({
            type: "derived",
            value: ["transaction", "transactionIndex"],
          });
          continue;
        }

        if (
          event.event.transactionReceipt?.contractAddress &&
          eq(event.event.transactionReceipt.contractAddress, arg)
        ) {
          resultArgs.push({
            type: "derived",
            value: ["transactionReceipt", "contractAddress"],
          });
          continue;
        }

        break;
      }

      case "transfer": {
        if (eq(event.event.transfer.from, arg)) {
          resultArgs.push({ type: "derived", value: ["transfer", "from"] });
          continue;
        }

        if (eq(event.event.transfer.to, arg)) {
          resultArgs.push({ type: "derived", value: ["transfer", "to"] });
          continue;
        }

        if (eq(event.event.trace.from, arg)) {
          resultArgs.push({ type: "derived", value: ["trace", "from"] });
          continue;
        }

        if (event.event.trace.to && eq(event.event.trace.to, arg)) {
          resultArgs.push({ type: "derived", value: ["trace", "to"] });
          continue;
        }

        if (eq(event.event.block.hash, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "hash"] });
          continue;
        }

        if (eq(event.event.block.number, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "number"] });
          continue;
        }

        if (eq(event.event.block.timestamp, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "timestamp"] });
          continue;
        }

        // Starknet uses sequencerAddress instead of miner
        if (
          event.event.block.sequencerAddress &&
          eq(event.event.block.sequencerAddress, arg)
        ) {
          resultArgs.push({
            type: "derived",
            value: ["block", "sequencerAddress"],
          });
          continue;
        }

        if (eq(event.event.transaction.hash, arg)) {
          resultArgs.push({ type: "derived", value: ["transaction", "hash"] });
          continue;
        }

        // Starknet uses senderAddress instead of from
        if (
          event.event.transaction.senderAddress &&
          eq(event.event.transaction.senderAddress, arg)
        ) {
          resultArgs.push({
            type: "derived",
            value: ["transaction", "senderAddress"],
          });
          continue;
        }

        // Starknet doesn't have 'to' field on transactions

        if (eq(event.event.transaction.transactionIndex, arg)) {
          resultArgs.push({
            type: "derived",
            value: ["transaction", "transactionIndex"],
          });
          continue;
        }

        if (
          event.event.transactionReceipt?.contractAddress &&
          eq(event.event.transactionReceipt.contractAddress, arg)
        ) {
          resultArgs.push({
            type: "derived",
            value: ["transactionReceipt", "contractAddress"],
          });
          continue;
        }

        break;
      }
    }

    resultArgs.push({ type: "constant", value: arg });
    hasConstant = true;
  }

  globalThis.DISABLE_EVENT_PROXY = false;
  return {
    pattern: {
      address: resultAddress!,
      abi: args.abi as Abi,
      functionName: args.functionName,
      args: resultArgs,
      cache: args.cache,
    },
    hasConstant,
  };
};

export const recoverProfilePattern = (
  pattern: ProfilePattern,
  event: Event,
): Request => {
  let address: `0x${string}`;

  if (pattern.address.type === "constant") {
    address = pattern.address.value as `0x${string}`;
  } else {
    let _result: unknown = event.event;
    for (const prop of pattern.address.value) {
      // @ts-ignore
      _result = _result[prop];
    }
    address = _result as `0x${string}`;
  }

  let args: unknown[] | undefined;
  if (pattern.args) {
    args = [];
    for (const arg of pattern.args) {
      if (arg.type === "constant") {
        args.push(arg.value);
      } else {
        let _result: unknown = event.event;
        for (const prop of arg.value) {
          // @ts-ignore
          _result = _result[prop];
        }
        args.push(_result);
      }
    }
  }

  return {
    address,
    abi: pattern.abi,
    functionName: pattern.functionName,
    args,
    blockNumber:
      pattern.cache === "immutable" ? "latest" : event.event.block.number,
    chainId: event.chainId,
  };
};
