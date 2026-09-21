export const trainingTypes = ["professional", "general", "safety", "other"] as const;

export type TrainingType = (typeof trainingTypes)[number];

export const trainingTypeLabels: Record<TrainingType, string> = {
  professional: "技能培训",
  general: "内部培训",
  safety: "安全培训",
  other: "其他培训",
};

export const trainingPlanStatuses = [
  "draft",
  "pending_approval",

  "published",

  "in_progress",

  "completed",

  "cancelled",
] as const;

export type TrainingPlanStatus = (typeof trainingPlanStatuses)[number];

export const trainingTaskStatuses = [
  "assigned",
  "in_progress",

  "submitted",

  "returned",

  "confirmed",

  "cancelled",
] as const;

export type TrainingTaskStatus = (typeof trainingTaskStatuses)[number];

export const trainingScopeTypes = ["department", "position", "employees"] as const;

export type TrainingScopeType = (typeof trainingScopeTypes)[number];

export type TrainingPlanView = {
  id: string;

  title: string;

  trainingType: TrainingType;

  departments: Array<{ id: string; name: string }>;

  positions: Array<{ id: string; name: string }>;

  scopeEmployeeNames: string[];

  status: TrainingPlanStatus;

  materialIds?: string[];
  materials?: Array<{ id: string; title: string; skillIds?: string[] }>;
  ownerEmployeeIds?: string[];
  ownerNames?: string[];
  materialId: string;

  materialTitle: string;

  ownerEmployeeId: string;

  ownerName: string;

  startAt: string;

  dueAt: string;

  location: string;

  scopeType: TrainingScopeType;

  createdByAccountId?: string;
  historicalCompleted?: boolean;
  submittedByAccountId?: string;
  approvalComment?: string;
  scopeDepartmentIds?: string[];
  scopePositionIds?: string[];
  scopeDepartmentId?: string;

  scopePositionId?: string;

  scopeEmployeeIds: string[];

  taskCount: number;

  confirmedCount: number;

  createdAt: string;
};

export type TrainingTaskView = {
  id: string;

  planId: string;

  planTitle: string;

  trainingType: TrainingType;

  departmentId: string;

  departmentName: string;

  positionId?: string;

  positionName?: string;

  employeeId: string;

  employeeName: string;

  employeeNumber: string;

  materialIds?: string[];
  materials?: Array<{ id: string; title: string; skillIds?: string[] }>;
  ownerEmployeeIds?: string[];
  ownerNames?: string[];
  materialId: string;

  materialTitle: string;

  ownerEmployeeId: string;

  ownerName: string;

  startAt: string;

  dueAt: string;

  location: string;

  status: TrainingTaskStatus;

  overdue: boolean;

  actualStartAt?: string;
  actualCompletedAt?: string;
  submittedAt?: string;

  confirmedAt?: string;

  returnReason?: string;

  evidenceCount: number;

  evidence: Array<{ id: string; filename: string }>;
};
