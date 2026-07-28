import { parseServerConfig } from "@jineng/skill-matrix-config";
import { createDatabase } from "@jineng/skill-matrix-db";
import { randomUUID } from "node:crypto";
import { createMaterialService } from "./material-service";
import { createFilesystemMaterialStorage } from "./material-storage";

const config = parseServerConfig(process.env);
const database = createDatabase(config);
try {
  const service = createMaterialService({
    repository: database.materialRepository,
    storage: createFilesystemMaterialStorage(config.materialStorageDir),
    idSource: () => randomUUID(),
  });
  const orphaned = await service.cleanupOrphans();
  console.log(`培训资料存储清理完成：删除 ${orphaned.length} 个孤儿对象`);
} finally {
  await database.close();
}
