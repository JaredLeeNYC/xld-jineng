export const skillCategories = ["general", "professional", "core"] as const;
export type SkillCategory = (typeof skillCategories)[number];

export const skillCategoryLabels: Record<SkillCategory, string> = {
  general: "通用",
  professional: "专业",
  core: "核心",
};

export const skillLevels = [0, 1, 2, 3, 4] as const;
export type SkillLevel = (typeof skillLevels)[number];

export const skillLevelMeanings: Record<SkillLevel, string> = {
  0: "未掌握",
  1: "了解并能在指导下操作",
  2: "可独立完成标准作业",
  3: "熟练处理异常并指导他人",
  4: "专家级，可制定标准并持续改进",
};

export type SkillView = {
  id: string;
  code: string;
  name: string;
  category: SkillCategory;
  reassessmentRequired: boolean;
  validityMonths?: number;
  active: boolean;
};

export type PositionSkillRequirementView = {
  id: string;
  positionId: string;
  positionCode: string;
  positionName: string;
  skillId: string;
  skillCode: string;
  skillName: string;
  skillCategory: SkillCategory;
  requiredLevel: SkillLevel;
  required: boolean;
};

export type SkillBaselineImportRow = {
  rowNumber: number;
  employeeNumber: string;
  skillCode: string;
  level: number;
  assessedAt: string;
  sourceReference: string;
};

export type SkillImportError = {
  rowNumber: number;
  field: string;
  code:
    | "REQUIRED"
    | "DUPLICATE"
    | "INVALID_EMPLOYEE"
    | "INVALID_SKILL"
    | "INVALID_LEVEL"
    | "INVALID_DATE"
    | "ALREADY_ASSESSED";
  message: string;
};

export type SkillMatrixCell = {
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  departmentId: string;
  departmentName: string;
  positionId: string;
  positionName: string;
  skillId: string;
  skillCode: string;
  skillName: string;
  requiredLevel: SkillLevel;
  required: boolean;
  currentLevel?: SkillLevel;
  validUntil?: string;
  assessmentId?: string;
  status: "met" | "gap" | "unassessed" | "expired";
  gap: number;
};

export const calculateSkillStatus = (input: {
  requiredLevel: SkillLevel;
  currentLevel?: SkillLevel;
  validUntil?: string;
  now: Date;
}): Pick<SkillMatrixCell, "status" | "gap"> => {
  if (input.currentLevel === undefined) {
    return { status: "unassessed", gap: input.requiredLevel };
  }
  if (input.validUntil && new Date(input.validUntil) < input.now) {
    return { status: "expired", gap: input.requiredLevel };
  }
  const gap = Math.max(0, input.requiredLevel - input.currentLevel);
  return { status: gap === 0 ? "met" : "gap", gap };
};

export const isSkillLevel = (value: number): value is SkillLevel =>
  Number.isInteger(value) && value >= 0 && value <= 4;
