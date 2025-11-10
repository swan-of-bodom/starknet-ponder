import type {
  Abi,
  AbiEvent,
  AbiFunction,
  AbiParametersToPrimitiveTypes,
  FormatAbiItem,
} from "abitype";
import type { GetEventArgs, ParseAbiItem } from "starkweb2";
import type { StarknetAbi } from "../types/starknetAbi.js";

export type NonStrictPick<T, K> = {
  [P in Extract<keyof T, K>]: T[P];
};

export type ExtractAbiEvents<
  abi extends Abi,
  events = Extract<abi[number], { type: "event" }>,
> = [events] extends [never] ? AbiEvent : events;

export type ExtractAbiFunctions<
  abi extends Abi,
  functions = Extract<abi[number], { type: "function" }>,
> = [functions] extends [never] ? AbiFunction : functions;

/** Return the abi event given the abi and compact signature. */
export type ParseAbiEvent<
  abi extends Abi,
  signature extends string,
  ///
  abiEvents extends AbiEvent = ExtractAbiEvents<abi>,
  noOverloadEvent = Extract<abiEvents, { name: signature }>,
  overloadEvent = Extract<abiEvents, ParseAbiItem<`event ${signature}`>>,
> = [noOverloadEvent] extends [never]
  ? [overloadEvent] extends [never]
    ? AbiEvent
    : overloadEvent
  : noOverloadEvent;

/** Return the abi function given the abi and compact signature. */
export type ParseAbiFunction<
  abi extends Abi,
  signature extends string,
  ///
  abiFunctions extends AbiFunction = ExtractAbiFunctions<abi>,
  noOverloadFunction = Extract<
    abiFunctions,
    { name: signature extends `${infer _signature}()` ? _signature : never }
  >,
  overloadFunction = Extract<
    abiFunctions,
    ParseAbiItem<`function ${signature}`>
  >,
> = [overloadFunction] extends [never]
  ? [noOverloadFunction] extends [never]
    ? AbiFunction
    : noOverloadFunction
  : overloadFunction;

/** Return the compact signature given the abi and abi event. */
export type FormatAbiEvent<
  abi extends Abi,
  event extends AbiEvent,
  ///
  abiEvents extends AbiEvent = ExtractAbiEvents<abi>,
  matchingNameEvents extends AbiEvent = Extract<
    abiEvents,
    { name: event["name"] }
  >,
> = [matchingNameEvents] extends [never]
  ? Abi extends abi
    ? event["name"]
    : never
  : [Exclude<matchingNameEvents, event>] extends [never]
    ? event["name"]
    : FormatAbiItem<event> extends `event ${infer signature}`
      ? signature
      : never;

/** Return the compact signature given the abi and abi function. */
export type FormatAbiFunction<
  abi extends Abi,
  _function extends AbiFunction,
  ///
  abiFunctions extends AbiFunction = ExtractAbiFunctions<abi>,
  matchingNameFunctions extends AbiFunction = Extract<
    abiFunctions,
    { name: _function["name"] }
  >,
> = [matchingNameFunctions] extends [never]
  ? Abi extends abi
    ? `${_function["name"]}()`
    : never
  : [Exclude<matchingNameFunctions, _function>] extends [never]
    ? `${_function["name"]}()`
    : FormatAbiItem<_function> extends `function ${infer signature}`
      ? signature
      : never;

/**
 * Return an union of safe event names that handle event overriding.
 */
export type SafeEventNames<
  abi extends Abi,
  ///
  abiEvents extends AbiEvent = ExtractAbiEvents<abi>,
> = abiEvents extends abiEvents ? FormatAbiEvent<abi, abiEvents> : never;

/**
 * Return an union of safe function names that handle function overriding.
 */
export type SafeFunctionNames<
  abi extends Abi,
  ///
  abiFunctions extends AbiFunction = ExtractAbiFunctions<abi>,
> = abiFunctions extends abiFunctions
  ? FormatAbiFunction<abi, abiFunctions>
  : never;

export type FormatEventArgs<
  abi extends Abi,
  signature extends string,
> = GetEventArgs<
  abi,
  signature,
  {
    EnableUnion: false;
    IndexedOnly: false;
    Required: true;
  }
>;

export type FormatFunctionArgs<
  abi extends Abi,
  signature extends string,
  ///
  args = AbiParametersToPrimitiveTypes<
    ParseAbiFunction<abi, signature>["inputs"]
  >,
> = readonly [] extends args ? never : args;

export type FormatFunctionResult<
  abi extends Abi,
  signature extends string,
  ///
  result = AbiParametersToPrimitiveTypes<
    ParseAbiFunction<abi, signature>["outputs"]
  >,
> = readonly [] extends result
  ? never
  : result extends readonly [unknown]
    ? result[0]
    : result;

// -----------------------
// Config specific types
// -----------------------

/** Check if an ABI item is a Cairo 1 struct event (has members) */
type IsCairo1StructEvent<T> = T extends {
  type: "event";
  kind: "struct";
  members: readonly any[];
}
  ? T
  : never;

/** Check if an ABI item is a Cairo 1 struct event (has inputs, no keys) */
type IsCairo0Event<T> = T extends { type: "event"; inputs: readonly any[] }
  ? T
  : never;

/** Check is any event */
type IsStarknetEvent<T> = IsCairo1StructEvent<T> | IsCairo0Event<T>;

/** Extract all events from a Starknet ABI */
export type ExtractStarknetEvents<
  abi extends StarknetAbi | readonly unknown[],
> = abi extends readonly (infer Item)[] ? IsStarknetEvent<Item> : never;

/** Get simple event name (ie. Token::Transfer" -> "Transfer") */
type ExtractSimpleName<T extends string> = T extends `${string}::${infer Rest}`
  ? ExtractSimpleName<Rest>
  : T;

type GetEventSafeName<E> = E extends { name: infer N extends string }
  ? ExtractSimpleName<N>
  : never;

/** Get all safe event names from a Starknet ABI */
export type SafeStarknetEventNames<
  abi extends StarknetAbi | readonly unknown[],
> = abi extends readonly (infer Item)[]
  ? GetEventSafeName<IsStarknetEvent<Item>>
  : string;

/** Get indexed parameter names from Cairo 1 event (members with kind: "key") */
type Cairo1IndexedParams<E> = E extends { members: readonly (infer M)[] }
  ? M extends { name: infer N extends string; kind: "key" }
    ? N
    : never
  : never;

/**
 * Get all indexed parameter names from an event. Cairo 0 events return never.
 */
export type StarknetIndexedParams<E> = Cairo1IndexedParams<E>;

/** Find an event in the ABI by its simple name */
export type FindStarknetEvent<
  abi extends StarknetAbi | readonly unknown[],
  eventName extends string,
> = abi extends readonly (infer Item)[]
  ? Item extends { type: "event"; name: infer N extends string }
    ? ExtractSimpleName<N> extends eventName
      ? IsStarknetEvent<Item>
      : never
    : never
  : never;

/** Build filter args type for a Starknet event. Only indexed parameters (keys) can be filtered */
export type StarknetFilterArgs<
  abi extends StarknetAbi | readonly unknown[],
  eventName extends string,
  event = FindStarknetEvent<abi, eventName>,
  indexedParams extends string = StarknetIndexedParams<event>,
> = [indexedParams] extends [never]
  ? Record<string, never>
  : {
      [K in indexedParams]?:
        | `0x${string}`
        | readonly `0x${string}`[]
        | null
        | undefined;
    };

/**
 * Type for the filter option in contract config
 * Works with both Cairo 0 and Cairo 1 ABIs
 */
export type GetStarknetEventFilter<
  abi extends StarknetAbi | readonly unknown[],
  safeEventNames extends string = SafeStarknetEventNames<abi>,
> = [safeEventNames] extends [never]
  ? {}
  : {
      filter?:
        | (safeEventNames extends safeEventNames
            ? {
                event: safeEventNames;
                args?: StarknetFilterArgs<abi, safeEventNames>;
              }
            : never)
        | (safeEventNames extends safeEventNames
            ? {
                event: safeEventNames;
                args?: StarknetFilterArgs<abi, safeEventNames>;
              }
            : never)[];
    };
