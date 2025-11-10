export type StarknetAbiParameter = {
  readonly name: string;
  readonly type: string;
};

// ----------------
// Cairo 0
// ----------------

/**
 * Cairo 0 event - has `inputs` array without indexed/kind markers
 *
 * At runtime:
 * - keys[0] = event selector only
 * - data[...] = ALL event parameters (nothing is indexed)
 *
 * Filtering by event args is not possible for Cairo 0 events.
 */
export type Cairo0Event = {
  readonly type: "event";
  readonly name: string;
  readonly inputs: readonly StarknetAbiParameter[];
};

// ----------------
// Cairo 1
// ----------------

export type Cairo1EventField = StarknetAbiParameter & {
  readonly kind: "key" | "data" | "nested";
};

export type Cairo1StructEvent = {
  readonly type: "event";
  readonly name: string;
  readonly kind: "struct";
  readonly members: readonly Cairo1EventField[];
};

export type Cairo1EnumEvent = {
  readonly type: "event";
  readonly name: string;
  readonly kind: "enum";
  readonly variants: readonly Cairo1EventField[];
};

export type Cairo1Event = Cairo1StructEvent | Cairo1EnumEvent;

// ----------------
// Ponder Starknet ABI
// ----------------

export type StarknetAbiEvent = Cairo0Event | Cairo1Event;

export type StarknetAbiFunction = {
  readonly type: "function" | "l1_handler" | "constructor";
  readonly name: string;
  readonly inputs: readonly { readonly name: string; readonly type: string }[];
  readonly outputs?: readonly { readonly type: string }[];
  readonly state_mutability?: "view" | "external";
};

export type StarknetAbiStruct = {
  readonly type: "struct";
  readonly name: string;
  readonly members: readonly { readonly name: string; readonly type: string }[];
};

export type StarknetAbiEnum = {
  readonly type: "enum";
  readonly name: string;
  readonly variants: readonly { readonly name: string; readonly type: string }[];
};

export type StarknetAbiInterface = {
  readonly type: "interface";
  readonly name: string;
  readonly items: readonly StarknetAbiFunction[];
};

export type StarknetAbiImpl = {
  readonly type: "impl";
  readonly name: string;
  readonly interface_name: string;
};

export type StarknetAbi = readonly (
  | StarknetAbiEvent
  | StarknetAbiFunction
  | StarknetAbiStruct
  | StarknetAbiEnum
  | StarknetAbiInterface
  | StarknetAbiImpl
)[];
