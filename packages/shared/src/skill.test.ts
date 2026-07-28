import { describe, expect, test } from "bun:test";
import { calculateSkillStatus, skillLevelMeanings } from "./skill";
import { calculateCurrentSkillValidity } from "./assessment";

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

describe("current skill validity", () => {
  const now = new Date("2026-07-01T00:00:00.000Z");
  test("uses exact 30-day expiry boundaries and keeps void separate", () => {
    expect(calculateCurrentSkillValidity({ now })).toBe("effective");
    expect(calculateCurrentSkillValidity({ validUntil: "2026-07-31T00:00:00.000Z", now })).toBe(
      "expiring_soon",
    );
    expect(calculateCurrentSkillValidity({ validUntil: "2026-08-01T00:00:00.000Z", now })).toBe(
      "effective",
    );
    expect(calculateCurrentSkillValidity({ validUntil: "2026-06-30T23:59:59.000Z", now })).toBe(
      "expired",
    );
    expect(calculateCurrentSkillValidity({ now, voidedAt: "2026-06-01T00:00:00.000Z" })).toBe(
      "voided",
    );
  });
});
