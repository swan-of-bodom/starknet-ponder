import type { StarknetAbi } from "../types/starknetAbi.js";
import type {
  SafeStarknetEventNames,
  StarknetFilterArgs,
} from "./utilityTypes.js";

/**
 * TODO: Open PR to starkweb2's `GetEventArgs` to support Cairo 1's `kind: "key"` instead of EVM's `indexed: true`.
 * Currently starkweb2 filters by `{ indexed: true }` which doesn't work with native Cairo 1 ABIs.
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
