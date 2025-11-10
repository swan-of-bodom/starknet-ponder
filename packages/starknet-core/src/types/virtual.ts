// TODO: Improve:
//       - Transactions/Traces not yet implemented

import type { SafeEventNames, GetEventArgs } from "./utility-types.js";
import type { Db } from "./db.js";
import type { ReadonlyClient } from "../indexing/client.js";
import type { Config } from "@/config/index.js";
import type { Prettify } from "./utils.js";
import type { Block, Log, TransactionReceipt } from "./starknet.js";
import type { UserTransaction } from "@/internal/types.js";

export namespace Virtual {
  type Setup = "setup";

  type _FormatEventNames<
    contract extends Config["contracts"][string],
    ///
    safeEventNames = SafeEventNames<contract["abi"]>,
  > = string extends safeEventNames ? never : safeEventNames;

  export type FormatEventNames<
    contracts extends Config["contracts"],
    accounts extends Config["accounts"],
    blocks extends Config["blocks"],
  > =
    | {
        [name in keyof contracts]: `${name & string}:${_FormatEventNames<contracts[name]> | Setup}`;
      }[keyof contracts]
    | {
        [name in keyof accounts]: `${name & string}:${"transaction" | "transfer"}:${"from" | "to"}`;
      }[keyof accounts]
    | {
        [name in keyof blocks]: `${name & string}:block`;
      }[keyof blocks];

  export type ExtractEventName<name extends string> =
    name extends `${string}:${infer EventName extends string}`
      ? EventName
      : name extends `${string}.${infer EventName extends string}`
        ? EventName
        : never;

  export type ExtractSourceName<name extends string> =
    name extends `${infer SourceName extends string}:${string}`
      ? SourceName
      : name extends `${infer SourceName extends string}.${string}`
        ? SourceName
        : never;

  export type EventNames<TConfig extends Config> = FormatEventNames<
    TConfig["contracts"],
    TConfig["accounts"],
    TConfig["blocks"]
  >;

  type ContextContractProperty = Exclude<
    keyof Config["contracts"][string],
    "abi" | "chain" | "filter" | "factory"
  >;

  type ExtractOverridenProperty<
    contract extends Config["contracts" | "accounts"][string],
    property extends ContextContractProperty,
    ///
    base = Extract<contract, { [p in property]: unknown }>[property],
    override = Extract<
      contract["chain"][keyof contract["chain"]],
      { [p in property]: unknown }
    >[property],
  > = ([base] extends [never] ? undefined : base) | override;

  type FormatTransactionReceipts<
    source extends Config["contracts" | "accounts"][string],
    ///
    includeTxr = ExtractOverridenProperty<source, "includeTransactionReceipts">,
  > = includeTxr extends includeTxr
    ? includeTxr extends true
      ? {
          transactionReceipt: Prettify<TransactionReceipt>;
        }
      : {
          transactionReceipt?: never;
        }
    : never;

  /**
   * Virtual Event type - fully typed based on config and event name
   */
  export type Event<
    config extends Config,
    name extends EventNames<config>,
    ///
    sourceName extends ExtractSourceName<name> = ExtractSourceName<name>,
    eventName extends ExtractEventName<name> = ExtractEventName<name>,
  > = name extends `${string}:block`
    ? // 1. block event
      {
        id: string;
        block: Prettify<Block>;
      }
    : name extends `${string}:transaction:${"from" | "to"}`
      ? // 2. transaction event
        {
          id: string;
          block: Prettify<Block>;
          transaction: Prettify<UserTransaction>;
          transactionReceipt: Prettify<TransactionReceipt>;
        }
      : name extends `${string}:transfer:${"from" | "to"}`
        ? // 3. transfer event
          {
            id: string;
            block: Prettify<Block>;
            transaction: Prettify<UserTransaction>;
          } & FormatTransactionReceipts<config["accounts"][sourceName]>
        : eventName extends Setup
          ? // 4. setup event
            never
          : // 5. log event
            Prettify<
              {
                id: string;
                name: eventName;
                args: GetEventArgs<
                  config["contracts"][sourceName]["abi"],
                  eventName
                >;
                log: Prettify<Log>;
                block: Prettify<Block>;
                transaction: Prettify<UserTransaction>;
              } & FormatTransactionReceipts<config["contracts"][sourceName]>
            >;

  /**
   * Virtual Context type - matches Ponder EVM API structure
   * Provides db, contracts (all registered), chain, and starkweb client
   */
  export type Context<
    config extends Config,
    schema extends Record<string, any>,
    name extends EventNames<config>,
    ///
    sourceName extends ExtractSourceName<name> = ExtractSourceName<name>,
    sourceChain = sourceName extends sourceName
      ?
          | (unknown extends config["contracts"][sourceName]["chain"]
              ? never
              : config["contracts"][sourceName]["chain"])
          | (unknown extends config["blocks"][sourceName]["chain"]
              ? never
              : config["blocks"][sourceName]["chain"])
      : never,
  > = {
    /** Access to all registered contracts with their ABIs and addresses */
    contracts: {
      [_contractName in keyof config["contracts"]]: {
        abi: config["contracts"][_contractName]["abi"];
        address: ExtractOverridenProperty<
          config["contracts"][_contractName],
          "address"
        >;
        startBlock: ExtractOverridenProperty<
          config["contracts"][_contractName],
          "startBlock"
        >;
        endBlock: ExtractOverridenProperty<
          config["contracts"][_contractName],
          "endBlock"
        >;
      };
    };
    /** Chain information for the current event's source */
    chain: sourceChain extends string
      ? // 1. No chain overriding
        {
          name: sourceChain;
          id: config["chains"][sourceChain]["id"];
        }
      : // 2. Chain overrides
        {
          [key in keyof sourceChain]: {
            name: key;
            id: config["chains"][key & keyof config["chains"]]["id"];
          };
        }[keyof sourceChain];
    /** Starkweb client for making contract calls (readonly) */
    client: Prettify<ReadonlyClient>;
    /** Ponder database instance with find, insert, update, delete methods */
    db: Db<schema>;
  };

  export type IndexingFunctionArgs<
    config extends Config,
    schema extends Record<string, any>,
    name extends EventNames<config>,
  > = {
    event: Event<config, name>;
    context: Context<config, schema, name>;
  };

  export type Registry<
    config extends Config,
    schema extends Record<string, any>,
  > = {
    on: <name extends EventNames<config>>(
      _name: name,
      indexingFunction: (
        args: { event: Event<config, name> } & {
          context: Prettify<Context<config, schema, name>>;
        },
      ) => Promise<void> | void,
    ) => void;
  };
}
