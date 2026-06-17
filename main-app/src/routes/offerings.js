const express = require("express");
const multer = require("multer");
const prisma = require("../config/prisma");
const env = require("../config/env");
const { requireAuth } = require("../middleware/auth");
const { pushFlash } = require("../utils/flash");
const { redirectWithSession } = require("../utils/session-redirect");
const { decodeUploadedFilename } = require("../utils/filenames");
const {
  ensureTeachingPlan,
  applyContentItemsToTeachingPlan,
  saveTeachingPlan,
  syncPracticePlan,
  updateLibraryFromSnapshot,
  findMatchingLibrary,
  MIN_ROWS
} = require("../services/plan-generator");
const { reviewTeachingPlan } = require("../services/ai-review");
const { exportPlanAsWord } = require("../services/word-export");
const { extractTextFromFile, parseCourseContent } = require("../services/content-parser");

const router = express.Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.uploadsDir),
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}-${sanitizeFilename(decodeUploadedFilename(file.originalname))}`)
});

const upload = multer({ storage });

router.get("/offerings/:id/teaching-plan", requireAuth, async (req, res) => {
  const offering = await getOffering(req, Number(req.params.id));
  if (!offering) {
    pushFlash(req, "error", "没有找到对应课程。");
    return redirectWithSession(req, res, "/dashboard");
  }

  const document = await ensureTeachingPlan(offering.id);
  const matchingLibrary = await findMatchingLibrary(offering.teacherId, offering.courseName);
  const aiReview = req.session.aiReview || null;
  req.session.aiReview = null;

  return res.render("offerings/teaching-plan", {
    title: `${offering.courseName} 教学进度计划表`,
    pageName: "teaching-plan",
    offering,
    document,
    aiReview,
    matchingLibrary,
    maxRows: Math.max(MIN_ROWS, document.rows.length || 0)
  });
});

router.post("/offerings/:id/import-library-content", requireAuth, async (req, res) => {
  const offering = await getOffering(req, Number(req.params.id));
  if (!offering) {
    pushFlash(req, "error", "没有找到对应课程。");
    return redirectWithSession(req, res, "/dashboard");
  }

  const library = await findMatchingLibrary(offering.teacherId, offering.courseName);
  if (!library || !library.items.length) {
    pushFlash(req, "error", "当前课程资料库中还没有可导入的授课内容。");
    return redirectWithSession(req, res, `/offerings/${offering.id}/teaching-plan`);
  }

  await applyContentItemsToTeachingPlan(offering.id, library.items, {
    source: "library-import"
  });

  pushFlash(req, "success", `已从资料库导入 ${library.items.length} 条授课内容。`);
  return redirectWithSession(req, res, `/offerings/${offering.id}/teaching-plan`);
});

router.post("/offerings/:id/upload-content", requireAuth, upload.single("contentFile"), async (req, res) => {
  const offering = await getOffering(req, Number(req.params.id));
  if (!offering) {
    pushFlash(req, "error", "没有找到对应课程。");
    return redirectWithSession(req, res, "/dashboard");
  }

  if (!req.file) {
    pushFlash(req, "error", "请先上传授课内容文档。");
    return redirectWithSession(req, res, `/offerings/${offering.id}/teaching-plan`);
  }

  try {
    const extractedText = await extractTextFromFile(req.file.path);
    const parsed = await parseCourseContent({
      courseName: offering.courseName,
      extractedText
    });

    await applyContentItemsToTeachingPlan(offering.id, parsed.items || [], {
      source: parsed.source || "content-upload"
    });

    await prisma.aiTaskLog.create({
      data: {
        teacherId: offering.teacherId,
        taskType: "CONTENT_PARSE",
        status: parsed.source === "deepseek" ? "SUCCESS" : "SKIPPED",
        inputSummary: `${offering.courseName} ${decodeUploadedFilename(req.file.originalname)}`,
        outputSummary: `教学计划页解析出 ${parsed.items?.length || 0} 条授课内容`
      }
    });

    pushFlash(req, "success", `已解析并填入 ${parsed.items?.length || 0} 条授课内容。`);
  } catch (error) {
    pushFlash(req, "error", error.message || "授课内容文档解析失败。");
  }

  return redirectWithSession(req, res, `/offerings/${offering.id}/teaching-plan`);
});

router.post("/offerings/:id/request-library-update", requireAuth, async (req, res) => {
  const offering = await getOffering(req, Number(req.params.id));
  if (!offering) {
    pushFlash(req, "error", "没有找到对应课程。");
    return redirectWithSession(req, res, "/dashboard");
  }

  const document = await ensureTeachingPlan(offering.id);
  const rows = collectRowsFromRequest(req.body.rows);

  const savedDocument = await saveTeachingPlan(document.id, {
    totalHours: req.body.totalHours,
    theoryHours: req.body.theoryHours,
    practiceHours: req.body.practiceHours,
    weeklyHours: req.body.weeklyHours,
    rows
  });

  await prisma.libraryUpdateRequest.updateMany({
    where: {
      offeringId: offering.id,
      status: "PENDING"
    },
    data: {
      status: "REJECTED",
      note: "已被新的更新申请覆盖。"
    }
  });

  const activeRows = savedDocument.rows.filter(
    (row) => row.weekIndex || row.topicText || row.hours || row.periodText || row.theoryHours || row.practiceHours
  );

  await prisma.libraryUpdateRequest.create({
    data: {
      offeringId: offering.id,
      teacherId: offering.teacherId,
      requestedByUserId: req.currentUser.id,
      sourceFilename: "teaching-plan-request",
      snapshotJson: JSON.stringify({
        totalHours: savedDocument.totalHours,
        theoryHours: savedDocument.theoryHours,
        practiceHours: savedDocument.practiceHours,
        weeklyHours: savedDocument.weeklyHours,
        rows: activeRows
      })
    }
  });

  pushFlash(req, "success", "已提交“申请更新资料库授课内容”，等待管理员审批。");
  return redirectWithSession(req, res, `/offerings/${offering.id}/teaching-plan`);
});

router.post("/plans/:id/save", requireAuth, async (req, res) => {
  const document = await prisma.planDocument.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      offering: true
    }
  });

  if (!document) {
    pushFlash(req, "error", "计划表不存在。");
    return redirectWithSession(req, res, "/dashboard");
  }

  const offering = await getOffering(req, document.offeringId);
  if (!offering) {
    pushFlash(req, "error", "没有权限保存这份计划表。");
    return redirectWithSession(req, res, "/dashboard");
  }

  await saveTeachingPlan(document.id, {
    totalHours: req.body.totalHours,
    theoryHours: req.body.theoryHours,
    practiceHours: req.body.practiceHours,
    weeklyHours: req.body.weeklyHours,
    rows: collectRowsFromRequest(req.body.rows)
  });

  pushFlash(req, "success", "教学进度计划表已保存。");
  return redirectWithSession(req, res, `/offerings/${document.offeringId}/teaching-plan`);
});

router.post("/plans/:id/ai-review", requireAuth, async (req, res) => {
  const document = await prisma.planDocument.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      rows: { orderBy: { sortOrder: "asc" } },
      offering: {
        include: {
          teacher: true,
          semester: true
        }
      }
    }
  });

  if (!document) {
    pushFlash(req, "error", "计划表不存在。");
    return redirectWithSession(req, res, "/dashboard");
  }

  const offering = await getOffering(req, document.offeringId);
  if (!offering) {
    pushFlash(req, "error", "没有权限查看这份计划表。");
    return redirectWithSession(req, res, "/dashboard");
  }

  const review = await reviewTeachingPlan({
    offering: document.offering,
    planDocument: document
  });

  await prisma.aiTaskLog.create({
    data: {
      teacherId: document.offering.teacherId,
      taskType: "PLAN_REVIEW",
      status: review.source === "deepseek" ? "SUCCESS" : "SKIPPED",
      inputSummary: `${document.offering.courseName} ${document.offering.className}`,
      outputSummary: [review.summary, ...(review.findings || [])].join("\n").slice(0, 2000)
    }
  });

  req.session.aiReview = review;
  pushFlash(req, "success", "DeepSeek 智能校验已完成。");
  return redirectWithSession(req, res, `/offerings/${document.offeringId}/teaching-plan`);
});

router.get("/plans/:id/export/word", requireAuth, async (req, res) => {
  const document = await prisma.planDocument.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      rows: { orderBy: { sortOrder: "asc" } },
      offering: {
        include: {
          teacher: true,
          semester: true
        }
      }
    }
  });

  if (!document) {
    pushFlash(req, "error", "计划表不存在。");
    return redirectWithSession(req, res, "/dashboard");
  }

  const offering = await getOffering(req, document.offeringId);
  if (!offering) {
    pushFlash(req, "error", "没有权限导出这份计划表。");
    return redirectWithSession(req, res, "/dashboard");
  }

  const exported = await exportPlanAsWord({
    planDocument: document,
    offering: document.offering
  });

  return res.download(exported.filePath, exported.fileName);
});

router.get("/offerings/:id/practice-plan", requireAuth, async (req, res) => {
  const offering = await getOffering(req, Number(req.params.id));
  if (!offering) {
    pushFlash(req, "error", "没有找到对应课程。");
    return redirectWithSession(req, res, "/dashboard");
  }

  await ensureTeachingPlan(offering.id);
  await syncPracticePlan(offering.id);
  const practiceDocument = await prisma.planDocument.findUnique({
    where: { offeringId_type: { offeringId: offering.id, type: "practice" } },
    include: {
      rows: { orderBy: { sortOrder: "asc" } }
    }
  });

  return res.render("offerings/practice-plan", {
    title: `${offering.courseName} 实践进度计划`,
    pageName: "practice-plan",
    offering,
    document: practiceDocument
  });
});

async function getOffering(req, offeringId) {
  const where = req.currentUser.role === "admin"
    ? { id: offeringId }
    : { id: offeringId, teacherId: req.currentUser.teacherProfileId };

  return prisma.courseOffering.findFirst({
    where,
    include: {
      teacher: true,
      semester: true
    }
  });
}

function collectRowsFromRequest(bodyRows = {}) {
  return Object.keys(bodyRows)
    .sort((left, right) => Number(left) - Number(right))
    .map((key) => bodyRows[key]);
}

function sanitizeFilename(filename) {
  return String(filename).replace(/[\\/:*?"<>|]+/g, "_");
}

module.exports = router;
