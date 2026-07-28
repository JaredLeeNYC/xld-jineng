export type MesV1Envelope<T> = {
  version: "mes.v1";
  eventId: string;
  occurredAt: string;
  payload: T;
};

export type MesV1Employee = {
  employeeNumber: string;
  displayName: string;
  departmentCode: string;
  positionCode: string;
  active: boolean;
};

export type MesV1IngestionResult = {
  eventId: string;
  status: "applied" | "duplicate" | "rejected";
  message?: string;
};

export interface MesV1Port {
  ingestEmployee(event: MesV1Envelope<MesV1Employee>): Promise<MesV1IngestionResult>;
}
