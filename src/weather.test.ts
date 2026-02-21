import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeWeatherCode } from "./weather.js";

describe("describeWeatherCode", () => {
  it("returns correct description for clear sky (0)", () => {
    assert.equal(describeWeatherCode(0), "Clear sky");
  });

  it("returns correct description for mainly clear (1)", () => {
    assert.equal(describeWeatherCode(1), "Mainly clear");
  });

  it("returns correct description for partly cloudy (2)", () => {
    assert.equal(describeWeatherCode(2), "Partly cloudy");
  });

  it("returns correct description for overcast (3)", () => {
    assert.equal(describeWeatherCode(3), "Overcast");
  });

  it("returns correct description for thunderstorm (95)", () => {
    assert.equal(describeWeatherCode(95), "Thunderstorm");
  });

  it("returns correct description for thunderstorm with slight hail (96)", () => {
    assert.equal(describeWeatherCode(96), "Thunderstorm with slight hail");
  });

  it("returns correct description for thunderstorm with heavy hail (99)", () => {
    assert.equal(describeWeatherCode(99), "Thunderstorm with heavy hail");
  });

  it("returns correct description for slight rain (61)", () => {
    assert.equal(describeWeatherCode(61), "Slight rain");
  });

  it("returns correct description for heavy snow fall (75)", () => {
    assert.equal(describeWeatherCode(75), "Heavy snow fall");
  });

  it("returns correct description for foggy (45)", () => {
    assert.equal(describeWeatherCode(45), "Foggy");
  });

  it("returns 'Unknown' for an unrecognised code", () => {
    assert.equal(describeWeatherCode(999), "Unknown");
  });

  it("returns 'Unknown' for a negative code", () => {
    assert.equal(describeWeatherCode(-1), "Unknown");
  });
});
