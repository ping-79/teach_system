const express = require("express");
const multer = require("multer");
const path = require("path");
const prisma = require("../config/prisma");
const env = require("../config/env");
const { requireAuth } = require("../middleware/auth");
const { pushFlash } = require("../utils/flash");
const { decodeUploadedFilename } = require("../utils/filenames");
const { CREDENTIAL_TYPES } = require("../services/achievement-constants");

const router = express.Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.uploadsDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${sanitizeFilename(file.originalname)}`)
});
const upload = multer({ storage });

function sanitizeFilename(filename) {
  return String(filename).replace(/[\\/:*?"<>|]+/g, "_");
}

function parseDate(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function nullableStr(value) {
  const raw = String(value ?? "").trim();
  return raw === "" ? null : raw;
}

// 计算工龄/校龄（整年）
function yearsSince(date) {
  if (!date) {
    return null;
  }
  const start = new Date(date);
  if (Number.isNaN(start.getTime())) {
    return null;
  }
  const now = new Date();
  let years = now.getFullYear() - start.getFullYear();
  const m = now.getMonth() - start.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < start.getDate())) {
    years -= 1;
  }
  return years >= 0 ? years : null;
}

// 解析当前请求要操作哪位教师：教师=本人；管理员=显式 teacherId
function resolveTeacherId(req) {
  if (req.currentUser.role === "admin") {
    const id = Number(req.query.teacherId || req.body.teacherId || 0);
    return Number.isInteger(id) && id > 0 ? id : null;
  }
  return req.currentUser.teacherProfileId || null;
}

router.get("/teacher-profile", requireAuth, async (req, res) => {
  // 管理员未指定教师时，展示教师列表入口
  if (req.currentUser.role === "admin" && !req.query.teacherId) {
    const teachers = await prisma.teacherProfile.findMany({
      orderBy: { employeeNo: "asc" },
      include: { _count: { select: { achievements: true, credentials: true } } }
    });
    return res.render("teacher-profile/admin-list", {
      title: "教师档案",
      pageName: "teacher-profile",
      teachers
    });
  }

  const teacherId = resolveTeacherId(req);
  if (!teacherId) {
    pushFlash(req, "error", "未找到对应的教师档案。");
    return res.redirect("/dashboard");
  }

  const teacher = await prisma.teacherProfile.findUnique({
    where: { id: teacherId },
    include: { credentials: { orderBy: { issuedOn: "desc" } } }
  });

  if (!teacher) {
    pushFlash(req, "error", "未找到对应的教师档案。");
    return res.redirect("/dashboard");
  }

  return res.render("teacher-profile/index", {
    title: "教师档案",
    pageName: "teacher-profile",
    teacher,
    credentials: teacher.credentials.map((c) => ({
      ...c,
      displayStoredName: c.storedPath ? decodeUploadedFilename(path.basename(c.storedPath)) : ""
    })),
    credentialTypes: CREDENTIAL_TYPES,
    workYears: yearsSince(teacher.workStartDate),
    schoolYears: yearsSince(teacher.joinSchoolDate),
    isAdminView: req.currentUser.role === "admin"
  });
});

router.post("/teacher-profile", requireAuth, upload.single("photo"), async (req, res) => {
  const teacherId = resolveTeacherId(req);
  if (!teacherId) {
    pushFlash(req, "error", "未找到对应的教师档案。");
    return res.redirect("/dashboard");
  }

  const b = req.body;
  const data = {
    gender: nullableStr(b.gender),
    birthDate: parseDate(b.birthDate),
    politicalStatus: nullableStr(b.politicalStatus),
    department: nullableStr(b.department),
    major: nullableStr(b.major),
    highestEducation: nullableStr(b.highestEducation),
    highestDegree: nullableStr(b.highestDegree),
    titleName: nullableStr(b.titleName),
    postLevel: nullableStr(b.postLevel),
    titleDate: parseDate(b.titleDate),
    duty: nullableStr(b.duty),
    workStartDate: parseDate(b.workStartDate),
    joinSchoolDate: parseDate(b.joinSchoolDate),
    doubleQualLevel: nullableStr(b.doubleQualLevel),
    phone: nullableStr(b.phone),
    email: nullableStr(b.email),
    employmentStatus: nullableStr(b.employmentStatus)
  };

  if (req.file) {
    data.photoPath = req.file.path;
  }

  await prisma.teacherProfile.update({ where: { id: teacherId }, data });

  pushFlash(req, "success", "教师档案已保存。");
  const suffix = req.currentUser.role === "admin" ? `?teacherId=${teacherId}` : "";
  return res.redirect(`/teacher-profile${suffix}`);
});

router.post("/teacher-profile/credentials", requireAuth, upload.single("certFile"), async (req, res) => {
  const teacherId = resolveTeacherId(req);
  if (!teacherId) {
    pushFlash(req, "error", "未找到对应的教师档案。");
    return res.redirect("/dashboard");
  }

  const type = nullableStr(req.body.type);
  if (!type) {
    pushFlash(req, "error", "请选择证书类型。");
    const suffix = req.currentUser.role === "admin" ? `?teacherId=${teacherId}` : "";
    return res.redirect(`/teacher-profile${suffix}`);
  }

  await prisma.credential.create({
    data: {
      teacherId,
      type,
      name: nullableStr(req.body.name),
      certNo: nullableStr(req.body.certNo),
      issuer: nullableStr(req.body.issuer),
      issuedOn: parseDate(req.body.issuedOn),
      level: nullableStr(req.body.level),
      storedPath: req.file ? req.file.path : null
    }
  });

  pushFlash(req, "success", "证书已添加。");
  const suffix = req.currentUser.role === "admin" ? `?teacherId=${teacherId}` : "";
  return res.redirect(`/teacher-profile${suffix}`);
});

router.post("/teacher-profile/credentials/:id/delete", requireAuth, async (req, res) => {
  const credential = await prisma.credential.findUnique({ where: { id: Number(req.params.id) } });
  if (!credential) {
    pushFlash(req, "error", "未找到该证书。");
    return res.redirect("/teacher-profile");
  }
  // 权限：教师仅能删自己的
  if (req.currentUser.role !== "admin" && credential.teacherId !== req.currentUser.teacherProfileId) {
    pushFlash(req, "error", "无权操作该证书。");
    return res.redirect("/teacher-profile");
  }

  await prisma.credential.delete({ where: { id: credential.id } });
  pushFlash(req, "success", "证书已删除。");
  const suffix = req.currentUser.role === "admin" ? `?teacherId=${credential.teacherId}` : "";
  return res.redirect(`/teacher-profile${suffix}`);
});

module.exports = router;
