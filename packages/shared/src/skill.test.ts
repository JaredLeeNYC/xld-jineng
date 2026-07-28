import { describe, expect, test } from "bun:test";
import { calculateSkillStatus, skillLevelMeanings } from "./skill";

describe("skill matrix calculations", () => {
  test("uses the fixed 0-4 meanings", () => {
    expect(Object.keys(skillLevelMeanings)).toEqual(["0", "1", "2", "3", "4"]);
  });

  test("treats unassessed, expired, below target and target levels consistently", () => {
    const now = new Date("2026-07-28T00:00:00.000Z");
    expect(calculateSkillStatus({ requiredLevel: 2, now })).toEqual({
      status: "unassessed",
      gap: 2,
    });
    expect(
      calculateSkillStatus({
        requiredLevel: 2,
        currentLevel: 4,
        validUntil: "2026-07-27T00:00:00.000Z",
        now,
      }),
    ).toEqual({ status: "expired", gap: 2 });
    expect(calculateSkillStatus({ requiredLevel: 3, currentLevel: 2, now })).toEqual({
      status: "gap",
      gap: 1,
    });
    expect(calculateSkillStatus({ requiredLevel: 3, currentLevel: 3, now })).toEqual({
      status: "met",
      gap: 0,
    });
  });
});
