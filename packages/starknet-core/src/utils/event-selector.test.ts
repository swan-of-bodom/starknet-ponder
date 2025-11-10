/**
 * Test event selector computation
 */

import { describe, test, expect } from "vitest";
import { computeEventSelector, extractEventsFromAbi } from "./event-selector.js";

describe("event-selector", () => {
  test("computes correct selector for USDC Transfer event", () => {
    const eventName = "openzeppelin::token::erc20_v070::erc20::ERC20::Transfer";
    // num.toHex64 pads to 64 hex characters
    const expectedSelector = "0x0099cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9";

    const computed = computeEventSelector(eventName);

    expect(computed).toBe(expectedSelector);
  });

  test("extracts events from USDC ABI", () => {
    const usdcAbi = [
      {
        kind: "struct",
        name: "openzeppelin::token::erc20_v070::erc20::ERC20::Transfer",
        type: "event",
        members: [
          { kind: "data", name: "from", type: "core::starknet::contract_address::ContractAddress" },
          { kind: "data", name: "to", type: "core::starknet::contract_address::ContractAddress" },
          { kind: "data", name: "value", type: "core::integer::u256" },
        ],
      },
      {
        kind: "struct",
        name: "openzeppelin::token::erc20_v070::erc20::ERC20::Approval",
        type: "event",
        members: [
          { kind: "data", name: "owner", type: "core::starknet::contract_address::ContractAddress" },
          { kind: "data", name: "spender", type: "core::starknet::contract_address::ContractAddress" },
          { kind: "data", name: "value", type: "core::integer::u256" },
        ],
      },
    ];

    const events = extractEventsFromAbi(usdcAbi);

    // num.toHex64 pads to 64 hex characters
    expect(events).toEqual({
      Transfer: "0x0099cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9",
      Approval: "0x0134692b230b9e1ffa39098904722134159652b09c5bc41d88d6698779d228ff",
    });

    expect(events.Transfer).toBe("0x0099cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9");
    expect(events.Approval).toMatch(/^0x[0-9a-f]+$/);
  });
});
