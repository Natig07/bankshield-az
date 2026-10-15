import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_BANDS, riskBand, riskScore } from "./risk";

describe("riskScore", () => {
  it("multiplies likelihood by impact", () => {
    assert.equal(riskScore(3, 4), 12);
    assert.equal(riskScore(1, 1), 1);
    assert.equal(riskScore(5, 5), 25);
  });

  it("rejects values outside the scale or non-integers", () => {
    assert.throws(() => riskScore(0, 3), RangeError);
    assert.throws(() => riskScore(6, 3), RangeError);
    assert.throws(() => riskScore(2.5, 3), RangeError);
    assert.throws(() => riskScore(Number.NaN, 3), RangeError);
  });

  it("supports a configurable scale", () => {
    assert.equal(riskScore(10, 10, { min: 1, max: 10 }), 100);
    assert.throws(() => riskScore(11, 1, { min: 1, max: 10 }), RangeError);
  });
});

describe("riskBand", () => {
  it("maps scores to severity bands at the documented thresholds", () => {
    assert.equal(riskBand(1), "LOW");
    assert.equal(riskBand(DEFAULT_BANDS.low), "LOW");
    assert.equal(riskBand(DEFAULT_BANDS.low + 1), "MEDIUM");
    assert.equal(riskBand(DEFAULT_BANDS.medium), "MEDIUM");
    assert.equal(riskBand(DEFAULT_BANDS.medium + 1), "HIGH");
    assert.equal(riskBand(DEFAULT_BANDS.high), "HIGH");
    assert.equal(riskBand(DEFAULT_BANDS.high + 1), "CRITICAL");
    assert.equal(riskBand(25), "CRITICAL");
  });

  it("supports configurable thresholds", () => {
    assert.equal(riskBand(10, { low: 2, medium: 5, high: 8 }), "CRITICAL");
  });

  it("rejects invalid scores", () => {
    assert.throws(() => riskBand(-1), RangeError);
    assert.throws(() => riskBand(Number.NaN), RangeError);
  });
});
