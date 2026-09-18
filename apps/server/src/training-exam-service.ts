import {
  trainingExamMethods,
  type TrainingExamInput,
} from "../../../packages/shared/src/training-exam";
import type { TrainingExamRepository } from "../../../packages/db/src/training-exam-repository";
import type { AssessmentActor } from "../../../packages/db/src/assessment-repository";
import type { SessionView } from "./auth-contract";
const fail = (code: string, message: string, status: 400 | 403 | 409) => ({
  ok: false as const,
  error: { code, message, status },
});
const scope = (actor: SessionView, read = false): AssessmentActor => ({
  accountId: actor.accountId,
  employeeId: actor.employeeId,
  ...(actor.departmentId ? { departmentId: actor.departmentId } : {}),
  role:
    read && "factoryRead" in actor && actor.factoryRead
      ? "executive_viewer"
      : (actor.role as AssessmentActor["role"]),
});
export const createTrainingExamService = ({
  repository,
  now,
}: {
  repository: TrainingExamRepository;
  now: () => Date;
}) => ({
  async list(actor: SessionView) {
    if (!["employee", "department_manager", "hr_admin", "executive_viewer"].includes(actor.role))
      return fail("FORBIDDEN", "无权查看培训考核档案", 403);
    return { ok: true as const, data: await repository.list(scope(actor, true)) };
  },
  async create(actor: SessionView, input: TrainingExamInput) {
    if (!["department_manager", "hr_admin"].includes(actor.role))
      return fail("FORBIDDEN", "仅主管和 HR 可录入培训考核", 403);
    const completedAt = new Date(input.completedAt);
    if (
      !trainingExamMethods.includes(input.method) ||
      !Number.isFinite(input.score) ||
      input.score < 0 ||
      input.score > 100 ||
      typeof input.passed !== "boolean" ||
      Number.isNaN(completedAt.getTime()) ||
      completedAt > now() ||
      (input.remarks?.length ?? 0) > 500
    )
      return fail(
        "INVALID_TRAINING_EXAM",
        "考核信息无效，成绩应为 0—100，完成时间不得晚于当前时间",
        400,
      );
    const id = await repository.create(scope(actor), {
      ...input,
      completedAt: completedAt.toISOString(),
      ...(input.remarks ? { remarks: input.remarks.trim() } : {}),
    });
    return id
      ? { ok: true as const, data: { id } }
      : fail(
          "TRAINING_EXAM_TARGET_INVALID",
          "员工、技能与已开始培训计划不匹配，或超出权限范围",
          409,
        );
  },
});
export type TrainingExamService = ReturnType<typeof createTrainingExamService>;
