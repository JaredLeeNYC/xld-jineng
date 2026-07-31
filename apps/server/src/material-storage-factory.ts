import type { ServerConfig } from "@jineng/skill-matrix-config";
import {
  createCosMaterialStorage,
  createFilesystemMaterialStorage,
  type MaterialStorage,
} from "./material-storage";

export const createConfiguredMaterialStorage = (config: ServerConfig): MaterialStorage => {
  if (config.materialStorageProvider === "filesystem") {
    return createFilesystemMaterialStorage(config.materialStorageDir);
  }

  if (
    !config.cosBucket ||
    !config.cosRegion ||
    !config.cosObjectPrefix ||
    !config.cosSecretId ||
    !config.cosSecretKey
  ) {
    throw new Error("COS_STORAGE_CONFIGURATION_MISSING");
  }

  return createCosMaterialStorage({
    bucket: config.cosBucket,
    region: config.cosRegion,
    objectPrefix: config.cosObjectPrefix,
    secretId: config.cosSecretId,
    secretKey: config.cosSecretKey,
  });
};
