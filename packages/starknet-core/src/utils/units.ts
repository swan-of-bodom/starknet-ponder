/**
 * Token unit formatting utilities
 * Compatible API with viem/ethers formatUnits/parseUnits
 */

/**
 * Formats a bigint value to a decimal string with the specified number of decimals.
 *
 * @example
 * formatUnits(1000000000000000000n, 18) // "1"
 * formatUnits(1500000000000000000n, 18) // "1.5"
 * formatUnits(1000000n, 6) // "1"
 *
 * @param value - The value to format (in smallest unit)
 * @param decimals - Number of decimal places
 * @returns Formatted decimal string
 */
export function formatUnits(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();

  const isNegative = value < 0n;
  const absValue = isNegative ? -value : value;

  const str = absValue.toString().padStart(decimals + 1, "0");
  const intPart = str.slice(0, -decimals) || "0";
  const decPart = str.slice(-decimals).replace(/0+$/, "");

  const result = decPart ? `${intPart}.${decPart}` : intPart;
  return isNegative ? `-${result}` : result;
}

/**
 * Parses a decimal string to a bigint value with the specified number of decimals.
 *
 * @example
 * parseUnits("1", 18) // 1000000000000000000n
 * parseUnits("1.5", 18) // 1500000000000000000n
 * parseUnits("1", 6) // 1000000n
 *
 * @param value - The decimal string to parse
 * @param decimals - Number of decimal places
 * @returns Parsed bigint value (in smallest unit)
 */
export function parseUnits(value: string, decimals: number): bigint {
  if (decimals === 0) return BigInt(value);

  const isNegative = value.startsWith("-");
  const absValue = isNegative ? value.slice(1) : value;

  const [intPart = "0", decPart = ""] = absValue.split(".");

  // Truncate or pad decimal part to match decimals
  const paddedDec = decPart.slice(0, decimals).padEnd(decimals, "0");

  // Remove leading zeros from int part (but keep at least one digit)
  const cleanInt = intPart.replace(/^0+/, "") || "0";

  const result = BigInt(cleanInt + paddedDec);
  return isNegative ? -result : result;
}

/**
 * Formats ether (18 decimals) - convenience wrapper
 */
export function formatEther(value: bigint): string {
  return formatUnits(value, 18);
}

/**
 * Parses ether (18 decimals) - convenience wrapper
 */
export function parseEther(value: string): bigint {
  return parseUnits(value, 18);
}
