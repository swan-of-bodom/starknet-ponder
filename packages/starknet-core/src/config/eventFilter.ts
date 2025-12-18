import type { StarknetAbi } from "../types/starknetAbi.js";
import type {
  SafeStarknetEventNames,
  StarknetFilterArgs,
} from "./utilityTypes.js";

/**
 * Note: Cairo 1 uses `kind: "key"` for indexed event parameters, which differs from EVM's `indexed: true`.
 * This implementation handles both Cairo 1 native ABIs and ABI structures that use `indexed`.
 */
export type GetEventFilter<
  abi extends StarknetAbi | readonly unknown[],
  starknetEventNames extends string = SafeStarknetEventNames<abi>,
> = [starknetEventNames] extends [never]
  ? {
      filter?:
        | {
            event: string;
            args: Record<
              string,
              `0x${string}` | readonly `0x${string}`[] | null | undefined
            >;
          }
        | {
            event: string;
            args: Record<
              string,
              `0x${string}` | readonly `0x${string}`[] | null | undefined
            >;
          }[];
    }
  : {
      filter?:
        | (starknetEventNames extends starknetEventNames
            ? {
                event: starknetEventNames;
                args: StarknetFilterArgs<abi, starknetEventNames>;
              }
            : never)
        | (starknetEventNames extends starknetEventNames
            ? {
                event: starknetEventNames;
                args: StarknetFilterArgs<abi, starknetEventNames>;
              }
            : never)[];
    };
