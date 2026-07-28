import type { FixedRole } from "./index";

export type DepartmentView = {
  id: string;
  code: string;
  name: string;
  active: boolean;
};

export type PositionView = {
  id: string;
  code: string;
  name: string;
  departmentId: string;
  departmentName: string;
  active: boolean;
};

export type PositionAssignmentView = {
  id: string;
  departmentId: string;
  departmentName: string;
  positionId: string;
  positionName: string;
  startedAt: string;
  endedAt?: string;
  reason: string;
};

export type EmployeeView = {
  id: string;
  employeeNumber: string;
  displayName: string;
  departmentId?: string;
  departmentName?: string;
  positionId?: string;
  positionName?: string;
  hireDate?: string;
  phone?: string;
  role: FixedRole;
  active: boolean;
};

export type EmployeeImportRow = {
  rowNumber: number;
  employeeNumber: string;
  displayName: string;
  departmentCode: string;
  positionCode: string;
  hireDate?: string;
  phone?: string;
};

export type ImportRowError = {
  rowNumber: number;
  field: string;
  code: "REQUIRED" | "DUPLICATE" | "INVALID_DEPARTMENT" | "INVALID_POSITION" | "INVALID_VALUE";
  message: string;
};

export type ImportPreview = {
  previewId: string;
  totalRows: number;
  validRows: number;
  errors: ImportRowError[];
  expiresAt: string;
};

export const normalizeBusinessCode = (value: string): string => value.trim().toUpperCase();

export const organizationRoles: readonly FixedRole[] = [
  "employee",
  "department_manager",
  "hr_admin",
  "executive_viewer",
  "system_admin",
];
