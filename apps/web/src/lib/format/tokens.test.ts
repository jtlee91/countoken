import assert from "node:assert/strict";
import { test } from "node:test";

import { formatTokenAmount, formatTokenSharePercent } from "./tokens.ts";

test("formatTokenAmount keeps one decimal place for compact token units", () => {
  assert.equal(formatTokenAmount(7_800_000), "7.8M");
  assert.equal(formatTokenAmount(217_000_000), "217.0M");
  assert.equal(formatTokenAmount(742_000), "742.0K");
  assert.equal(formatTokenAmount(257_000), "257.0K");
});

test("formatTokenAmount keeps plain formatting below one thousand", () => {
  assert.equal(formatTokenAmount(999), "999");
});

test("formatTokenSharePercent rounds to a whole percent", () => {
  assert.equal(formatTokenSharePercent(7_800_000, 225_000_000), "3");
  assert.equal(formatTokenSharePercent(9_600_000, 264_252_400), "4");
  assert.equal(formatTokenSharePercent(0, 225_000_000), "0");
  assert.equal(formatTokenSharePercent(10, 0), "0");
});
