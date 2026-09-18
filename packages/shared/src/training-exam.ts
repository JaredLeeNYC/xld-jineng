export const trainingExamMethods = ["written", "practical", "written_practical"] as const;
export type TrainingExamMethod = (typeof trainingExamMethods)[number];
export const trainingExamMethodLabels: Record<TrainingExamMethod, string> = {
  written: "笔试",
  practical: "实操",
  written_practical: "笔试+实操",
};
export type TrainingExamInput = {
  planId: string;
  employeeId: string;
  skillId: string;
  method: TrainingExamMethod;
  score: number;
  passed: boolean;
  completedAt: string;
  remarks?: string;
};
export type TrainingExamView = TrainingExamInput & {
  id: string;
  planTitle: string;
  employeeNumber: string;
  employeeName: string;
  departmentId: string;
  departmentName: string;
  skillName: string;
  createdAt: string;
};
