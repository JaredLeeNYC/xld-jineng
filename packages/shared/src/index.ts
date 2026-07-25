export type ApiSuccess<T> = {
  ok: true;
  data: T;
};

export type ApiError = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export type ReadinessResult =
  | { ok: true }
  | {
      ok: false;
      reason: "database-unavailable" | "migration-mismatch";
      message: string;
    };

export type ReadinessProbe = () => Promise<ReadinessResult>;

export const success = <T>(data: T): ApiSuccess<T> => ({
  ok: true,
  data,
});

export const failure = (code: string, message: string): ApiError => ({
  ok: false,
  error: {
    code,
    message,
  },
});
