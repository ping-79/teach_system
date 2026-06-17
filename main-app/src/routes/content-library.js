const express = require("express");
const multer = require("multer");
const prisma = require("../config/prisma");
const env = require("../config/env");
const { requireAuth } = require("../middleware/auth");
const { pushFlash } = require("../utils/flash");
const { normalizeCourseName } = require("../utils/normalizers");
const { decodeUploadedFilename } = require("../utils/filenames");
const { extractTextFromFile, parseCourseContent } = require("../services/content-parser");
const { regenerateTeachingPlansForCourse } = require("../services/plan-generator");

const router = express.Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.uploadsDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${sanitizeFilename(file.originalname)}`)
});

const upload = multer({ storage });

router.get("/content-library", requireAuth, async (req, res) => {
  const teachers = req.currentUser.role === "admin"
    ? await prisma.teacherProfile.findMany({ orderBy: { employeeNo: "asc" } })
    : [];

  const librariesRaw = await prisma.courseContentLibrary.findMany({
    where: req.currentUser.role === "admin" ? {} : { teacherId: req.currentUser.teacherProfileId },
    include: {
      teacher: true,
      items: { orderBy: { sortOrder: "asc" } }
    },
    orderBy: { updatedAt: "desc" }
  });

  const libraries = librariesRaw.map((library) => ({
    ...library,
    displaySourceFilename: decodeUploadedFilename(library.sourceFilename)
  }));

  return res.render("content-library/index", {
    title: "课程内容资料库",
    pageName: "content-library",
    libraries,
    teachers
  });
});

router.post("/content-library/import", requireAuth, upload.single("contentFile"), async (req, res) => {
  if (!req.file) {
    pushFlash(req, "error", "请先上传课程内容文件。");
    return res.redirect("/content-library");
  }

  const courseName = String(req.body.courseName || "").trim();
  if (!courseName) {
    pushFlash(req, "error", "请先填写课程名称。");
    return res.redirect("/content-library");
  }

  const teacherId = req.currentUser.role === "admin"
    ? Number(req.body.teacherId || 0)
    : req.currentUser.teacherProfileId;

  if (!teacherId) {
    pushFlash(req, "error", "请先选择教师。");
    return res.redirect("/content-library");
  }

  try {
    const extractedText = await extractTextFromFile(req.file.path);
    const parsed = await parseCourseContent({ courseName, extractedText });
    const normalizedCourseName = normalizeCourseName(courseName);
    const sourceFilename = decodeUploadedFilename(req.file.originalname);

    const library = await prisma.courseContentLibrary.upsert({
      where: {
        teacherId_normalizedCourseName: {
          teacherId,
          normalizedCourseName
        }
      },
      update: {
        courseName,
        sourceFilename,
        sourceStoredPath: req.file.path,
        extractedText,
        draftItemsJson: JSON.stringify(parsed.items || []),
        status: "DRAFT"
      },
      create: {
        teacherId,
        courseName,
        normalizedCourseName,
        sourceFilename,
        sourceStoredPath: req.file.path,
        extractedText,
        draftItemsJson: JSON.stringify(parsed.items || []),
        status: "DRAFT"
      }
    });

    await prisma.aiTaskLog.create({
      data: {
        teacherId,
        taskType: "CONTENT_PARSE",
        status: parsed.source === "deepseek" ? "SUCCESS" : "SKIPPED",
        inputSummary: `${courseName} ${sourceFilename}`,
        outputSummary: `候选条目 ${parsed.items?.length || 0} 条`
      }
    });

    pushFlash(req, "success", "课程内容已解析，请确认后保存入库。");
    return res.redirect(`/content-library/import/${library.id}/review`);
  } catch (error) {
    pushFlash(req, "error", error.message || "课程内容解析失败。");
    return res.redirect("/content-library");
  }
});

router.get("/content-library/import/:id/review", requireAuth, async (req, res) => {
  const library = await prisma.courseContentLibrary.findFirst({
    where: req.currentUser.role === "admin"
      ? { id: Number(req.params.id) }
      : { id: Number(req.params.id), teacherId: req.currentUser.teacherProfileId },
    include: { teacher: true, items: { orderBy: { sortOrder: "asc" } } }
  });

  if (!library) {
    pushFlash(req, "error", "没有找到待确认的资料记录。");
    return res.redirect("/content-library");
  }

  const draftItems = (() => {
    try {
      return JSON.parse(library.draftItemsJson || "[]");
    } catch (_error) {
      return [];
    }
  })().map((item) => toDisplayItem(item));

  return res.render("content-library/review", {
    title: "确认课程内容",
    pageName: "content-library-review",
    library: {
      ...library,
      displaySourceFilename: decodeUploadedFilename(library.sourceFilename)
    },
    draftItems
  });
});

router.post("/content-library/import/:id/confirm", requireAuth, async (req, res) => {
  const library = await prisma.courseContentLibrary.findFirst({
    where: req.currentUser.role === "admin"
      ? { id: Number(req.params.id) }
      : { id: Number(req.params.id), teacherId: req.currentUser.teacherProfileId }
  });

  if (!library) {
    pushFlash(req, "error", "没有找到待确认的资料记录。");
    return res.redirect("/content-library");
  }

  const entries = Object.values(req.body.items || {})
    .map((item, index) => {
      const topicTitle = String(item.topicTitle || "").trim();
      const theoryHours = toNullableNumber(item.theoryHours);
      const practiceHours = toNullableNumber(item.practiceHours);
      const explicitHours = theoryHours !== null || practiceHours !== null
        ? sumNumbers(theoryHours, practiceHours)
        : null;
      const suggestedHours = toNullableNumber(item.suggestedHours) ?? explicitHours;
      const resolvedTheory = theoryHours !== null || practiceHours !== null
        ? (theoryHours ?? 0)
        : suggestedHours;
      const resolvedPractice = theoryHours !== null || practiceHours !== null
        ? (practiceHours ?? 0)
        : 0;

      return {
        sortOrder: index + 1,
        topicTitle,
        suggestedHours,
        theoryHours: resolvedTheory,
        practiceHours: resolvedPractice,
        mode: inferMode(resolvedTheory, resolvedPractice),
        notes: ""
      };
    })
    .filter((item) => item.topicTitle);

  await prisma.courseContentLibrary.update({
    where: { id: library.id },
    data: {
      status: "ACTIVE",
      draftItemsJson: JSON.stringify(entries),
      items: {
        deleteMany: {},
        create: entries
      }
    }
  });

  await regenerateTeachingPlansForCourse(library.teacherId, library.normalizedCourseName);

  pushFlash(req, "success", "课程内容资料库已保存，并已同步更新对应教学计划。");
  return res.redirect("/content-library");
});

router.post("/content-library/:id/delete", requireAuth, async (req, res) => {
  const library = await prisma.courseContentLibrary.findFirst({
    where: req.currentUser.role === "admin"
      ? { id: Number(req.params.id) }
      : { id: Number(req.params.id), teacherId: req.currentUser.teacherProfileId }
  });

  if (!library) {
    pushFlash(req, "error", "没有找到要删除的课程资料。");
    return res.redirect("/content-library");
  }

  await prisma.courseContentLibrary.delete({
    where: { id: library.id }
  });

  pushFlash(req, "success", `已删除课程资料：${library.courseName}`);
  return res.redirect("/content-library");
});

function sanitizeFilename(filename) {
  return String(filename).replace(/[\\/:*?"<>|]+/g, "_");
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function sumNumbers(...values) {
  const resolved = values.filter((value) => value !== null && value !== undefined);
  if (!resolved.length) {
    return null;
  }

  return resolved.reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function inferMode(theoryHours, practiceHours) {
  const theory = Number(theoryHours || 0);
  const practice = Number(practiceHours || 0);

  if (theory > 0 && practice > 0) {
    return "mixed";
  }

  if (practice > 0) {
    return "practice";
  }

  return "theory";
}

function toDisplayItem(item = {}) {
  const suggestedHours = toNullableNumber(item.suggestedHours);
  const theoryHours = toNullableNumber(item.theoryHours);
  const practiceHours = toNullableNumber(item.practiceHours);

  return {
    ...item,
    suggestedHours: suggestedHours ?? sumNumbers(theoryHours, practiceHours),
    theoryHours: theoryHours ?? (practiceHours ? 0 : suggestedHours),
    practiceHours: practiceHours ?? 0
  };
}

module.exports = router;
