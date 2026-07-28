export const trainingPlanStatuses = [
  "draft",
  "published",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type TrainingPlanStatus = (typeof trainingPlanStatuses)[number];

export const trainingTaskStatuses = [
  "assigned",
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
  status: TrainingPlanStatus;
  materialId: string;
  materialTitle: string;
  ownerEmployeeId: string;
  ownerName: string;
  startAt: string;
  dueAt: string;
  location: string;
  scopeType: TrainingScopeType;
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
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  materialId: string;
  materialTitle: string;
  ownerEmployeeId: string;
  ownerName: string;
  startAt: string;
  dueAt: string;
  location: string;
  status: TrainingTaskStatus;
  overdue: boolean;
  submittedAt?: string;
  confirmedAt?: string;
  returnReason?: string;
  evidenceCount: number;
  evidence: Array<{ id: string; filename: string }>;
};
