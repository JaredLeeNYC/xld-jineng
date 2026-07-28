export const materialKinds = ["file", "link"] as const;
export type MaterialKind = (typeof materialKinds)[number];

export type TrainingMaterialView = {
  id: string;
  title: string;
  category: string;
  description?: string;
  kind: MaterialKind;
  externalUrl?: string;
  originalFilename?: string;
  mimeType?: string;
  sizeBytes?: number;
  checksum?: string;
  active: boolean;
  skillIds: string[];
  skills: Array<{ id: string; code: string; name: string }>;
  createdAt: string;
};

export const allowedMaterialMimeTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const maximumMaterialBytes = 25 * 1024 * 1024;
