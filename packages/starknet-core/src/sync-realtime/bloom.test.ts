import { EMPTY_LOG_FILTER } from "@/_test/constants.js";
import type { LogFactory, LogFilter } from "@/internal/types.js";
import { expect, test } from "vitest";
import { isBlockInFilterRange } from "./bloom.js";

test("isBlockInFilterRange returns false for out of range blocks", () => {
  const block = {
    number: 5,
  } as const;

  const filter = {
    ...EMPTY_LOG_FILTER,
    fromBlock: 10,
    toBlock: 20,
  } satisfies LogFilter;

  expect(isBlockInFilterRange({ block, filter })).toBe(false);
});

test("isBlockInFilterRange returns true for in-range blocks", () => {
  const block = {
    number: 15,
  } as const;

  const filter = {
    ...EMPTY_LOG_FILTER,
    fromBlock: 10,
    toBlock: 20,
  } satisfies LogFilter;

  expect(isBlockInFilterRange({ block, filter })).toBe(true);
});

test("isBlockInFilterRange returns true for undefined address", () => {
  const block = {
    number: 5,
  } as const;

  const filter = EMPTY_LOG_FILTER;

  expect(isBlockInFilterRange({ block, filter })).toBe(true);
});

test("isBlockInFilterRange returns true for factory address", () => {
  const block = {
    number: 5,
  } as const;

  const filter = {
    ...EMPTY_LOG_FILTER,
    address: {
      id: `log_${"0xef2d6d194084c2de36e0dabfce45d046b37d1106"}_${1}_topic${1}_${"0x02c69be41d0b7e40352fc85be1cd65eb03d40ef8427a0ca4596b1ead9a00e9fc"}_${"undefined"}_${"undefined"}`,
      type: "log",
      chainId: 1,
      address: "0xef2d6d194084c2de36e0dabfce45d046b37d1106",
      eventSelector:
        "0x02c69be41d0b7e40352fc85be1cd65eb03d40ef8427a0ca4596b1ead9a00e9fc",
      childAddressLocation: "topic1",
      fromBlock: undefined,
      toBlock: undefined,
    } satisfies LogFactory,
  } satisfies LogFilter;

  expect(isBlockInFilterRange({ block, filter })).toBe(true);
});

test("isBlockInFilterRange returns true for array of addresses", () => {
  const block = {
    number: 5,
  } as const;

  const filter = {
    ...EMPTY_LOG_FILTER,
    address: ["0xef2d6d194084c2de36e0dabfce45d046b37d1106"],
  } satisfies LogFilter;

  expect(isBlockInFilterRange({ block, filter })).toBe(true);
});
