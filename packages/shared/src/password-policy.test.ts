import { describe, expect, test } from "bun:test";
import {
  maximumPasswordLength,
  minimumPasswordLength,
  passwordLengthIsValid,
} from "./index";

describe("password length policy", () => {
  test("rejects seven characters and accepts eight", () => {
    expect(minimumPasswordLength).toBe(8);
    expect(maximumPasswordLength).toBe(200);
    expect(passwordLengthIsValid("1234567")).toBeFalse();
    expect(passwordLengthIsValid("12345678")).toBeTrue();
    expect(passwordLengthIsValid("x".repeat(200))).toBeTrue();
    expect(passwordLengthIsValid("x".repeat(201))).toBeFalse();
  });
});
