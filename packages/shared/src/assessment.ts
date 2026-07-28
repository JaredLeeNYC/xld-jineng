import type { SkillLevel } from "./skill";

export const assessmentMethods = ["written", "practical", "comprehensive"] as const;
export type AssessmentMethod = (typeof assessmentMethods)[number];

export const assessmentMethodLabels: Record<AssessmentMethod, string> = {
  written: "线下笔试",
  practical: "实操",
  comprehensive: "综合评审",
};

export const assessmentStatuses = [
  "draft",
  "pending_manager",
  "pending_hr",
  "archived",
  "returned",
  "voided",
] as const;
export type AssessmentStatus = (typeof assessmentStatuses)[number];

export const assessmentStatusLabels: Record<AssessmentStatus, string> = {
  draft: "草稿",
  pending_manager: "待主管确认",
  pending_hr: "待 HR 归档",
  archived: "已归档",
  returned: "已退回",
  voided: "已作废",
};

export type SkillAssessmentView = {
  id: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  departmentId: string;
  departmentName: string;
  skillId: string;
  skillCode: string;
  skillName: string;
  assessorEmployeeId?: string;
  assessorName?: string;
  method?: AssessmentMethod;
  level: SkillLevel;
  passed: boolean;
  reason?: string;
  remediation?: string;
  assessedAt: string;
  validUntil?: string;
  status: AssessmentStatus;
  returnReason?: string;
  voidReason?: string;
  evidence?: { filename: string; mimeType: string; sizeBytes: number };
  replacesAssessmentId?: string;
  archivedAt?: string;
  createdAt: string;
};
