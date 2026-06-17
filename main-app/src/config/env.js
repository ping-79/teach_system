const path = require("path");
const os = require("os");
const dotenv = require("dotenv");

dotenv.config();

const rootDir = path.resolve(__dirname, "..", "..");
const dataDir = path.join(rootDir, "data");
const defaultSessionsDir =
  process.platform === "win32"
    ? path.join(os.tmpdir(), "teaching-materials-sessions")
    : path.join(dataDir, "sessions");

module.exports = {
  rootDir,
  dataDir,
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || "",
  sessionSecret: process.env.SESSION_SECRET || "change-me",
  adminInitialPassword: process.env.ADMIN_INITIAL_PASSWORD || "admin123456",
  lessonPlanUrl: process.env.LESSON_PLAN_URL || "http://192.168.31.55:3100/jiaoan/",
  lessonPlanBackendUrl:
    process.env.LESSON_PLAN_BACKEND_URL ||
    process.env.LESSON_PLAN_URL?.replace(/\/jiaoan\/?$/, "") ||
    "http://192.168.31.55:3100",
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || "",
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  // OCR：可插拔云端文字识别。未配置时图片/PDF 走"手填"降级，不影响功能。
  // 支持 baidu / tencent / ali / custom；custom 走 OCR_ENDPOINT POST {imageBase64} → {text}
  ocrProvider: (process.env.OCR_PROVIDER || "").toLowerCase(),
  ocrApiKey: process.env.OCR_API_KEY || "",
  ocrApiSecret: process.env.OCR_API_SECRET || "",
  ocrEndpoint: process.env.OCR_ENDPOINT || "",
  uploadsDir: path.join(dataDir, "uploads"),
  exportsDir: path.join(dataDir, "exports"),
  sessionsDir: process.env.SESSIONS_DIR || defaultSessionsDir
};
