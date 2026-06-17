const express = require("express");
const multer = require("multer");
const path = require("path");
const prisma = require("../config/prisma");
const env = require("../config/env");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { pushFlash } = require("../utils/flash");
const { decodeUploadedFilename } = require("../utils/filenames");
const { extractEvidenceText, isOcrConfigured } = require("../services/ocr");
const { structureAchievement } = require("../services/achievement-ai");
const { scoreAchievement, effectiveScore } = require("../services/scoring");
const constants = require("../services/achievement-constants");

const router = express.Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.uploadsDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${sanitizeFilename(file.originalname)}`)
});
const upload = multer({ storage });

function sanitizeFilename(filename) {
  return String(filename).replace(/[\\/:*?"<>|]+/g, "_");
}

function nullableStr(value) {
  const raw = String(value ?? "").trim();
  return raw === "" ? null : raw;
}

function parseDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeCategory(value) {
  return constants.CATEGORY_ORDER.includes(value) ? value : "RESEARCH";
}
function normalizeLevel(value) {
  return constants.LEVEL_ORDER.includes(value) ? value : "NONE";
}
function normalizeRank(value) {
  return constants.RANK_ORDER.includes(value) ? value : "NONE";
}

function resolveTeacherId(req) {
  if (req.currentUser.role === "admin") {
    const id = Number(req.query.teacherId || req.body.teacherId || 0);
    return Number.isInteger(id) && id > 0 ? id : null;
  }
  return req.currentUser.teacherProfileId || null;
}

function canTouch(req, achievement) {
  if (!achievement) return false;
  if (req.currentUser.role === "admin") return true;
  return achievement.teacherId === req.currentUser.teacherProfileId;
}

// —— 业绩列表 + 量化总分概览 ——
router.get("/achievements", requireAuth, async (req, res) => {
  // 管理员未指定教师时，给出教师选择列表
  if (req.currentUser.role === "admin" && !req.query.teacherId) {
    const teachers = await prisma.teacherProfile.findMany({
      orderBy: { employeeNo: "asc" },
      include: { _count: { select: { achievements: true } } }
    });
    return res.render("achievements/admin-list", {
      title: "教师业绩",
      pageName: "achievements",
      teachers
    });
  }

  const teacherId = resolveTeacherId(req);
  if (!teacherId) {
    pushFlash(req, "error", "未找到对应的教师。");
    return res.redirect("/dashboard");
  }

  const teacher = await prisma.teacherProfile.findUnique({ where: { id: teacherId } });
  const achievements = await prisma.achievement.findMany({
    where: { teacherId },
    orderBy: [{ year: "desc" }, { updatedAt: "desc" }],
    include: { attachments: true }
  });

  // 按大类分组 + 小计（取有效得分）
  const grouped = { RESUME: [], TEACHING: [], RESEARCH: [] };
  const subtotals = { RESUME: 0, TEACHING: 0, RESEARCH: 0 };
  achievements.forEach((a) => {
    grouped[a.category]?.push(a);
    const s = effectiveScore(a);
    if (Number.isFinite(Number(s))) {
      subtotals[a.category] += Number(s);
    }
  });
  const total = Math.round((subtotals.RESUME + subtotals.TEACHING + subtotals.RESEARCH) * 100) / 100;

  return res.render("achievements/index", {
    title: "教师业绩",
    pageName: "achievements",
    teacher,
    grouped,
    subtotals,
    total,
    constants,
    isAdminView: req.currentUser.role === "admin",
    teacherIdParam: req.currentUser.role === "admin" ? `?teacherId=${teacherId}` : ""
  });
});

// —— 录入表单（空白）——
router.get("/achievements/new", requireAuth, async (req, res) => {
  const teacherId = resolveTeacherId(req);
  if (!teacherId) {
    pushFlash(req, "error", "未找到对应的教师。");
    return res.redirect("/achievements");
  }
  return res.render("achievements/form", {
    title: "录入业绩",
    pageName: "achievements",
    constants,
    achievement: null,
    prefill: null,
    attachment: null,
    ocrConfigured: isOcrConfigured(),
    teacherIdParam: req.currentUser.role === "admin" ? `?teacherId=${teacherId}` : "",
    teacherId
  });
});

// —— OCR / AI 预填：上传扫描件 → 识别结构化 → 渲染已填表单 ——
router.post("/achievements/ocr-prefill", requireAuth, upload.single("evidence"), async (req, res) => {
  const teacherId = resolveTeacherId(req);
  if (!teacherId) {
    pushFlash(req, "error", "未找到对应的教师。");
    return res.redirect("/achievements");
  }
  const teacherParam = req.currentUser.role === "admin" ? `?teacherId=${teacherId}` : "";

  if (!req.file) {
    pushFlash(req, "error", "请先选择佐证扫描件。");
    return res.redirect(`/achievements/new${teacherParam}`);
  }

  const category = normalizeCategory(req.body.category);
  const subType = nullableStr(req.body.subType) || "";

  const ocr = await extractEvidenceText(req.file.path);
  let prefill = null;
  let ocrStatus = ocr.status;
  let ocrText = ocr.text || "";

  if (ocr.status === "SUCCESS" && ocr.text) {
    const structured = await structureAchievement({ ocrText: ocr.text, category, subType });
    prefill = structured.fields;
    await prisma.aiTaskLog.create({
      data: {
        teacherId,
        taskType: "ACHIEVEMENT_PARSE",
        status: structured.source === "deepseek" ? "SUCCESS" : "SKIPPED",
        inputSummary: `${category}/${subType} ${decodeUploadedFilename(req.file.originalname)}`,
        outputSummary: prefill?.title ? `预填：${prefill.title}` : "已尝试结构化"
      }
    });
  } else {
    await prisma.aiTaskLog.create({
      data: {
        teacherId,
        taskType: "ACHIEVEMENT_OCR",
        status: ocr.status === "FAILED" ? "FAILED" : "SKIPPED",
        inputSummary: decodeUploadedFilename(req.file.originalname),
        outputSummary: ocr.message || ocr.status
      }
    });
    if (ocr.message) {
      pushFlash(req, "warning", ocr.message);
    }
  }

  return res.render("achievements/form", {
    title: "确认业绩信息",
    pageName: "achievements",
    constants,
    achievement: null,
    prefill,
    attachment: {
      fileName: decodeUploadedFilename(req.file.originalname),
      storedPath: req.file.path,
      ocrStatus,
      ocrText
    },
    category,
    subType,
    ocrConfigured: isOcrConfigured(),
    teacherIdParam: teacherParam,
    teacherId
  });
});

// —— 创建业绩 ——
router.post("/achievements", requireAuth, async (req, res) => {
  const teacherId = resolveTeacherId(req);
  if (!teacherId) {
    pushFlash(req, "error", "未找到对应的教师。");
    return res.redirect("/achievements");
  }
  const teacherParam = req.currentUser.role === "admin" ? `?teacherId=${teacherId}` : "";

  const title = nullableStr(req.body.title);
  if (!title) {
    pushFlash(req, "error", "请填写业绩名称。");
    return res.redirect(`/achievements/new${teacherParam}`);
  }

  const category = normalizeCategory(req.body.category);
  const level = normalizeLevel(req.body.level);
  const rank = normalizeRank(req.body.rank);
  const authorOrder = toNum(req.body.authorOrder);
  const year = toNum(req.body.year) || new Date().getFullYear();

  const detail = parseDetailJson(req.body.detailJson);

  // 系统建议分（启发式）
  const scored = scoreAchievement({ level, rank, authorOrder, detailJson: JSON.stringify(detail) }, null);
  const selfScore = toNum(req.body.selfScore);

  const created = await prisma.achievement.create({
    data: {
      teacherId,
      year,
      category,
      subType: nullableStr(req.body.subType) || "其他",
      title,
      level,
      rank,
      rankLabel: nullableStr(req.body.rankLabel),
      authorOrder,
      authorRole: nullableStr(req.body.authorRole),
      happenedOn: parseDate(req.body.happenedOn),
      selfDescription: nullableStr(req.body.selfDescription),
      detailJson: Object.keys(detail).length ? JSON.stringify(detail) : null,
      computedScore: scored.score,
      selfScore: selfScore ?? scored.score,
      reviewDept: constants.REVIEW_DEPT_BY_CATEGORY[category] || null,
      reviewStatus: "DRAFT"
    }
  });

  // 若来自 OCR 预填，附带佐证扫描件
  const storedPath = nullableStr(req.body.attachmentStoredPath);
  if (storedPath) {
    await prisma.achievementAttachment.create({
      data: {
        achievementId: created.id,
        fileName: nullableStr(req.body.attachmentFileName) || path.basename(storedPath),
        storedPath,
        ocrStatus: nullableStr(req.body.attachmentOcrStatus) || "PENDING",
        ocrText: nullableStr(req.body.attachmentOcrText)
      }
    });
  }

  pushFlash(req, "success", "业绩已保存。");
  return res.redirect(`/achievements${teacherParam}`);
});

// —— 编辑表单 ——
router.get("/achievements/:id/edit", requireAuth, async (req, res) => {
  const achievement = await prisma.achievement.findUnique({
    where: { id: Number(req.params.id) },
    include: { attachments: true }
  });
  if (!canTouch(req, achievement)) {
    pushFlash(req, "error", "未找到该业绩或无权访问。");
    return res.redirect("/achievements");
  }

  const teacherParam = req.currentUser.role === "admin" ? `?teacherId=${achievement.teacherId}` : "";
  return res.render("achievements/form", {
    title: "编辑业绩",
    pageName: "achievements",
    constants,
    achievement: {
      ...achievement,
      detail: parseDetailJson(achievement.detailJson)
    },
    prefill: null,
    attachment: null,
    ocrConfigured: isOcrConfigured(),
    teacherIdParam: teacherParam,
    teacherId: achievement.teacherId
  });
});

// —— 更新业绩 ——
router.post("/achievements/:id", requireAuth, async (req, res) => {
  const achievement = await prisma.achievement.findUnique({ where: { id: Number(req.params.id) } });
  if (!canTouch(req, achievement)) {
    pushFlash(req, "error", "未找到该业绩或无权访问。");
    return res.redirect("/achievements");
  }
  const teacherParam = req.currentUser.role === "admin" ? `?teacherId=${achievement.teacherId}` : "";

  const level = normalizeLevel(req.body.level);
  const rank = normalizeRank(req.body.rank);
  const authorOrder = toNum(req.body.authorOrder);
  const detail = parseDetailJson(req.body.detailJson);
  const scored = scoreAchievement({ level, rank, authorOrder, detailJson: JSON.stringify(detail) }, null);
  const selfScore = toNum(req.body.selfScore);

  await prisma.achievement.update({
    where: { id: achievement.id },
    data: {
      year: toNum(req.body.year) || achievement.year,
      category: normalizeCategory(req.body.category),
      subType: nullableStr(req.body.subType) || achievement.subType,
      title: nullableStr(req.body.title) || achievement.title,
      level,
      rank,
      rankLabel: nullableStr(req.body.rankLabel),
      authorOrder,
      authorRole: nullableStr(req.body.authorRole),
      happenedOn: parseDate(req.body.happenedOn),
      selfDescription: nullableStr(req.body.selfDescription),
      detailJson: Object.keys(detail).length ? JSON.stringify(detail) : null,
      computedScore: scored.score,
      selfScore: selfScore ?? scored.score
    }
  });

  pushFlash(req, "success", "业绩已更新。");
  return res.redirect(`/achievements${teacherParam}`);
});

// —— 删除业绩 ——
router.post("/achievements/:id/delete", requireAuth, async (req, res) => {
  const achievement = await prisma.achievement.findUnique({ where: { id: Number(req.params.id) } });
  if (!canTouch(req, achievement)) {
    pushFlash(req, "error", "未找到该业绩或无权访问。");
    return res.redirect("/achievements");
  }
  const teacherParam = req.currentUser.role === "admin" ? `?teacherId=${achievement.teacherId}` : "";
  await prisma.achievement.delete({ where: { id: achievement.id } });
  pushFlash(req, "success", "业绩已删除。");
  return res.redirect(`/achievements${teacherParam}`);
});

// —— 提交复核 ——
router.post("/achievements/:id/submit", requireAuth, async (req, res) => {
  const achievement = await prisma.achievement.findUnique({ where: { id: Number(req.params.id) } });
  if (!canTouch(req, achievement)) {
    pushFlash(req, "error", "未找到该业绩或无权访问。");
    return res.redirect("/achievements");
  }
  const teacherParam = req.currentUser.role === "admin" ? `?teacherId=${achievement.teacherId}` : "";
  await prisma.achievement.update({
    where: { id: achievement.id },
    data: { reviewStatus: "SUBMITTED" }
  });
  pushFlash(req, "success", "业绩已提交复核。");
  return res.redirect(`/achievements${teacherParam}`);
});

// —— 管理员复核队列 ——
router.get("/admin/achievement-review", requireAuth, requireAdmin, async (req, res) => {
  const statusFilter = nullableStr(req.query.status);
  const where = statusFilter ? { reviewStatus: statusFilter } : { reviewStatus: { in: ["SUBMITTED", "PRELIM_REVIEWED"] } };
  const achievements = await prisma.achievement.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    include: { teacher: true, attachments: true }
  });
  return res.render("achievements/review", {
    title: "业绩复核",
    pageName: "achievement-review",
    achievements,
    constants,
    statusFilter: statusFilter || ""
  });
});

// —— 管理员保存复核 ——
router.post("/admin/achievement-review/:id", requireAuth, requireAdmin, async (req, res) => {
  const achievement = await prisma.achievement.findUnique({ where: { id: Number(req.params.id) } });
  if (!achievement) {
    pushFlash(req, "error", "未找到该业绩。");
    return res.redirect("/admin/achievement-review");
  }

  const action = nullableStr(req.body.action); // prelim | final | reject
  const data = { reviewNote: nullableStr(req.body.reviewNote) };

  if (action === "prelim") {
    data.prelimScore = toNum(req.body.score);
    data.reviewStatus = "PRELIM_REVIEWED";
  } else if (action === "final") {
    data.finalScore = toNum(req.body.score);
    data.reviewStatus = "FINAL_REVIEWED";
    data.verified = true;
  } else if (action === "reject") {
    data.reviewStatus = "REJECTED";
    data.verified = false;
  }

  await prisma.achievement.update({ where: { id: achievement.id }, data });
  pushFlash(req, "success", "复核已保存。");
  return res.redirect("/admin/achievement-review");
});

// —— 数据统计看板 ——
router.get("/achievements/stats", requireAuth, async (req, res) => {
  const isAdmin = req.currentUser.role === "admin";
  const where = isAdmin ? {} : { teacherId: req.currentUser.teacherProfileId };

  const achievements = await prisma.achievement.findMany({
    where,
    include: isAdmin ? { teacher: true } : undefined
  });

  // 分类统计
  const byCategory = { RESUME: 0, TEACHING: 0, RESEARCH: 0 };
  const byLevel = { NATIONAL: 0, PROVINCIAL: 0, MUNICIPAL: 0, SCHOOL: 0, NONE: 0 };
  const byYear = {};
  const scoreByCategory = { RESUME: 0, TEACHING: 0, RESEARCH: 0 };
  let verifiedCount = 0;

  achievements.forEach((a) => {
    byCategory[a.category] = (byCategory[a.category] || 0) + 1;
    byLevel[a.level] = (byLevel[a.level] || 0) + 1;
    byYear[a.year] = (byYear[a.year] || 0) + 1;
    const s = effectiveScore(a);
    if (Number.isFinite(Number(s))) {
      scoreByCategory[a.category] += Number(s);
    }
    if (a.verified) verifiedCount += 1;
  });

  // 管理员：教师维度排行（按有效总分）
  let teacherRanking = [];
  if (isAdmin) {
    const map = new Map();
    achievements.forEach((a) => {
      const key = a.teacherId;
      const cur = map.get(key) || { name: a.teacher?.name || "未知", employeeNo: a.teacher?.employeeNo || "", count: 0, score: 0 };
      cur.count += 1;
      const s = effectiveScore(a);
      if (Number.isFinite(Number(s))) cur.score += Number(s);
      map.set(key, cur);
    });
    teacherRanking = Array.from(map.values())
      .map((t) => ({ ...t, score: Math.round(t.score * 100) / 100 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  }

  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);

  return res.render("achievements/stats", {
    title: "数据统计看板",
    pageName: "achievement-stats",
    isAdmin,
    constants,
    totalCount: achievements.length,
    verifiedCount,
    byCategory,
    byLevel,
    byYear,
    years,
    scoreByCategory: {
      RESUME: Math.round(scoreByCategory.RESUME * 100) / 100,
      TEACHING: Math.round(scoreByCategory.TEACHING * 100) / 100,
      RESEARCH: Math.round(scoreByCategory.RESEARCH * 100) / 100
    },
    teacherRanking
  });
});

function parseDetailJson(raw) {
  if (!raw) return {};
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

module.exports = router;
