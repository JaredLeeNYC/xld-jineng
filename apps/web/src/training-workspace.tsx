import { useState } from "react";
import { MaterialLibrary } from "./material-library";
import { ModuleNavigation } from "./module-navigation";
import { TrainingAnalyticsPanel } from "./training-analytics";
import { TrainingManagement } from "./training-management";

type TrainingView = "annual" | "plans" | "tasks" | "materials";
type Session = {
  role: string;
  accountId: string;
  employeeId: string;
  departmentId?: string;
  factoryRead?: boolean;
};

export function TrainingWorkspace({ session }: { session: Session }) {
  const [view, setView] = useState<TrainingView>("annual");
  const canReadFactory =
    session.role === "hr_admin" || session.role === "executive_viewer" || !!session.factoryRead;
  return (
    <div className="training-workspace">
      <ModuleNavigation<TrainingView>
        label="培训管理子模块"
        value={view}
        onChange={setView}
        items={[
          {
            id: "annual",
            label: canReadFactory ? "全厂年度培训计划汇总表" : "部门年度培训计划汇总表",
          },
          { id: "plans", label: "计划管理" },
          { id: "tasks", label: "培训任务" },
          { id: "materials", label: "培训资料" },
        ]}
      />
      {view === "annual" && (
        <>
          <p className="muted">
            年度汇总按参训部门统计；负责的跨部门计划请在计划管理中查看。{" "}
            <button type="button" onClick={() => setView("plans")}>
              前往计划管理
            </button>
          </p>
          <TrainingAnalyticsPanel
            canReadFactory={canReadFactory}
            {...(session.departmentId ? { departmentId: session.departmentId } : {})}
            showPlanDetails
            showStatistics={false}
          />
        </>
      )}
      {(view === "plans" || view === "tasks") && (
        <TrainingManagement key={view} session={session} view={view} />
      )}
      {view === "materials" && (
        <MaterialLibrary canManage={["hr_admin", "department_manager"].includes(session.role)} />
      )}
    </div>
  );
}
