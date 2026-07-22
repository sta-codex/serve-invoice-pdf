import test from "node:test";
import assert from "node:assert/strict";
import { buildMeasure, normalizeThicknessInMeasure } from "../src/domain/format.js";

test("formats thickness with exactly two decimals", () => {
  assert.equal(buildMeasure({ thickness: 2, width: 1000 }), "2,00 x 1000");
  assert.equal(buildMeasure({ thickness: 2.1, width: 1250 }), "2,10 x 1250");
  assert.equal(buildMeasure({ thickness: 0.57, width: 1250 }), "0,57 x 1250");
});

test("formats thickness from Airtable measure and description text", () => {
  assert.equal(buildMeasure({ fallback: "2 x 1000" }), "2,00 x 1000");
  assert.equal(buildMeasure({ fallback: "1.4 x 1500" }), "1,40 x 1500");
  assert.equal(normalizeThicknessInMeasure("HRC 3.5 x 1250 DC01"), "HRC 3,50 x 1250 DC01");
});
