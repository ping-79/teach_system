const express = require("express");
const path = require("path");
const multer = require("multer");
const prisma = require("../config/prisma");
const env = require("../config/env");
const { requireAuth } = require("../middleware/auth");
const { pushFlash } = require("../utils/flash");
const { redirectWithSession } = require("../utils/session-redirect");
const { decodeUploadedFilename } = require("../utils/filenames");
const { parseTimetable } = require("../services/timetable-parser");

const router = express.Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.uploadsDir),
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}-${sanitizeFilename(decodeUploadedFilename(file.originalname))}`)
});

const upload = multer({ storage });

router.get("/semesters/new", requireAuth, (_req, res) => {
  res.render("semesters/new", {
    title: "新建学期",
    pageName: "semester-new"
  });
});

router.post("/semesters", requireAuth, async (req, res) => {
  const schoolYear = String(req.body.schoolYear || "").trim();
  const termNumber = Number(req.body.termNumber || 0);
  const teachingStartDate = String(req.body.teachingStartDate || "").trim();

  if (!schoolYear || !termNumber || !teachingStartDate) {
    pushFlash(req, "error", "请完整填写学年、学期和正式上课第一天。");
    return redirectWithSession(req, res, "/semesters/new");
  }

  const semester = await prisma.semester.upsert({
    where: {
      schoolYear_termNumber: {
        schoolYear,
        termNumber
      }
    },
    update: {
      teachingStartDate: new Date(`${teachingStartDate}T00:00:00`)
    },
    create: {
      schoolYear,
      termNumber,
      teachingStartDate: new Date(`${teachingStartDate}T00:00:00`)
    }
  });

  pushFlash(req, "success", "学期信息已保存。");
  return redirectWithSession(req, res, `/semesters/${semester.id}`);
});

router.get("/semesters/:id", requireAuth, async (req, res) => {
  const semester = await prisma.semester.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      timetableImports: req.currentUser.role === "admin"
        ? { include: { teacher: true }, orderBy: { createdAt: "desc" } }
        : {
            where: { teacherId: req.currentUser.teacherProfileId },
            orderBy: { createdAt: "desc" }
          }
    }
  });

  if (!semester) {
    pushFlash(req, "error", "没有找到对应学期。");
    return redirectWithSession(req, res, "/dashboard");
  }

  const offerings = await prisma.courseOffering.findMany({
    where: req.currentUser.role === "admin"
      ? { semesterId: semester.id }
      : { semesterId: semester.id, teacherId: req.currentUser.teacherProfileId },
    orderBy: [{ className: "asc" }, { courseName: "asc" }]
  });

  return res.render("semesters/show", {
    title: `${semester.schoolYear} 第 ${semester.termNumber} 学期`,
    pageName: "semester-detail",
    semester: {
      ...semester,
      timetableImports: semester.timetableImports.map((record) => ({
        ...record,
        displaySourceFilename: decodeUploadedFilename(record.sourceFilename)
      }))
    },
    offerings
  });
});

router.post("/semesters/:id/timetable-imports", requireAuth, upload.single("timetableFile"), async (req, res) => {
  if (!req.file) {
    pushFlash(req, "error", "请先选择课表文件。");
    return redirectWithSession(req, res, `/semesters/${req.params.id}`);
  }

  if (!req.currentUser.teacherProfileId) {
    pushFlash(req, "error", "管理员账号不能直接导入教师课表，请使用教师账号上传。");
    return redirectWithSession(req, res, `/semesters/${req.params.id}`);
  }

  const semesterId = Number(req.params.id);
  const teacherId = req.currentUser.teacherProfileId;
  const sourceFilename = decodeUploadedFilename(req.file.originalname);
  const parsed = parseTimetable(req.file.path);

  await prisma.teacherProfile.update({
    where: { id: teacherId },
    data: {
      name: parsed.teacherName || req.currentUser.teacherProfile.name,
      college: parsed.college || req.currentUser.teacherProfile.college
    }
  });

  await prisma.$transaction(async (tx) => {
    await tx.planDocument.deleteMany({
      where: {
        offering: {
          semesterId,
          teacherId
        }
      }
    });

    await tx.courseOffering.deleteMany({
      where: { semesterId, teacherId }
    });

    await tx.timetableSession.deleteMany({
      where: { semesterId, teacherId }
    });

    await tx.timetableImport.deleteMany({
      where: { semesterId, teacherId }
    });

    const importRecord = await tx.timetableImport.create({
      data: {
        semesterId,
        teacherId,
        sourceFilename,
        storedPath: path.relative(env.rootDir, req.file.path),
        parseStatus: "SUCCESS",
        rawSummary: `共解析 ${parsed.sessions.length} 条授课片段`
      }
    });

    if (parsed.sessions.length) {
      await tx.timetableSession.createMany({
        data: parsed.sessions.map((session) => ({
          importId: importRecord.id,
          teacherId,
          semesterId,
          courseName: session.courseName,
          normalizedCourseName: session.normalizedCourseName,
          className: session.className || "未识别班级",
          weekday: session.weekday,
          weekdayLabel: session.weekdayLabel,
          periodText: session.periodText || session.periodLabel,
          weekRuleRaw: session.weekRuleRaw,
          campus: session.campus || "",
          location: session.location || "",
          studentCount: session.studentCount,
          courseTotalHours: session.courseTotalHours,
          rawCellText: session.rawCellText,
          isPracticeHint: session.isPracticeHint
        }))
      });
    }

    const offerings = dedupeOfferings(parsed.sessions);
    for (const offering of offerings) {
      await tx.courseOffering.upsert({
        where: {
          teacherId_semesterId_normalizedCourseName_className: {
            teacherId,
            semesterId,
            normalizedCourseName: offering.normalizedCourseName,
            className: offering.className
          }
        },
        update: {
          courseName: offering.courseName,
          courseTotalHours: offering.courseTotalHours,
          sourceImportId: importRecord.id
        },
        create: {
          teacherId,
          semesterId,
          courseName: offering.courseName,
          normalizedCourseName: offering.normalizedCourseName,
          className: offering.className,
          courseTotalHours: offering.courseTotalHours,
          sourceImportId: importRecord.id
        }
      });
    }
  });

  pushFlash(req, "success", `课表已导入，生成 ${dedupeOfferings(parsed.sessions).length} 张课程卡片。`);
  return redirectWithSession(req, res, `/semesters/${semesterId}`);
});

function dedupeOfferings(sessions) {
  const map = new Map();
  sessions.forEach((session) => {
    const className = session.className || "未识别班级";
    const key = `${session.normalizedCourseName}::${className}`;
    if (!map.has(key)) {
      map.set(key, {
        courseName: session.courseName,
        normalizedCourseName: session.normalizedCourseName,
        className,
        courseTotalHours: session.courseTotalHours
      });
    }
  });

  return [...map.values()];
}

function sanitizeFilename(filename) {
  return String(filename).replace(/[\\/:*?"<>|]+/g, "_");
}

module.exports = router;
