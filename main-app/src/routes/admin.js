const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../config/prisma");
const { requireAdmin } = require("../middleware/auth");
const { pushFlash } = require("../utils/flash");
const { redirectWithSession } = require("../utils/session-redirect");
const { updateLibraryFromSnapshot } = require("../services/plan-generator");

const router = express.Router();

router.get("/admin/teachers", requireAdmin, async (_req, res) => {
  const teachers = await prisma.teacherProfile.findMany({
    include: { user: true },
    orderBy: { createdAt: "desc" }
  });

  return res.render("admin/teachers", {
    title: "教师账号管理",
    pageName: "admin-teachers",
    teachers
  });
});

router.post("/admin/teachers", requireAdmin, async (req, res) => {
  const employeeNo = String(req.body.employeeNo || "").trim();
  const name = String(req.body.name || "").trim();
  const college = String(req.body.college || "").trim();
  const password = String(req.body.password || "").trim();

  if (!employeeNo || !name || !college || !password) {
    pushFlash(req, "error", "请完整填写教师工号、姓名、学院和初始密码。");
    return redirectWithSession(req, res, "/admin/teachers");
  }

  try {
    const teacher = await prisma.teacherProfile.create({
      data: {
        employeeNo,
        name,
        college
      }
    });

    await prisma.user.create({
      data: {
        username: employeeNo,
        passwordHash: await bcrypt.hash(password, 10),
        role: "teacher",
        mustChangePassword: true,
        teacherProfileId: teacher.id
      }
    });

    pushFlash(req, "success", `已创建教师账号：${name}（${employeeNo}）。`);
  } catch (error) {
    pushFlash(req, "error", `创建失败：${error.message}`);
  }

  return redirectWithSession(req, res, "/admin/teachers");
});

router.get("/admin/teachers/:id/password", requireAdmin, async (req, res) => {
  const teacherId = Number(req.params.id);
  const teacher = await prisma.teacherProfile.findUnique({
    where: { id: teacherId },
    include: { user: true }
  });

  if (!teacher || !teacher.user) {
    pushFlash(req, "error", "未找到对应教师账号。");
    return redirectWithSession(req, res, "/admin/teachers");
  }

  return res.render("admin/teacher-password", {
    title: "修改教师密码",
    pageName: "admin-teachers",
    teacher
  });
});

router.post("/admin/teachers/:id/password", requireAdmin, async (req, res) => {
  const teacherId = Number(req.params.id);
  const password = String(req.body.password || "").trim();

  if (password.length < 8) {
    pushFlash(req, "error", "新密码至少需要 8 位。");
    return redirectWithSession(req, res, `/admin/teachers/${teacherId}/password`);
  }

  const teacher = await prisma.teacherProfile.findUnique({
    where: { id: teacherId },
    include: { user: true }
  });

  if (!teacher || !teacher.user) {
    pushFlash(req, "error", "未找到对应教师账号。");
    return redirectWithSession(req, res, "/admin/teachers");
  }

  await prisma.user.update({
    where: { id: teacher.user.id },
    data: {
      passwordHash: await bcrypt.hash(password, 10),
      mustChangePassword: false
    }
  });

  pushFlash(req, "success", `已更新 ${teacher.name}（${teacher.employeeNo}）的密码。`);
  return redirectWithSession(req, res, "/admin/teachers");
});

router.post("/admin/teachers/:id/delete", requireAdmin, async (req, res) => {
  const teacherId = Number(req.params.id);

  const teacher = await prisma.teacherProfile.findUnique({
    where: { id: teacherId },
    include: {
      user: true,
      libraries: { select: { id: true } },
      offerings: { select: { id: true } },
      timetableImports: { select: { id: true } }
    }
  });

  if (!teacher) {
    pushFlash(req, "error", "未找到对应教师账号。");
    return redirectWithSession(req, res, "/admin/teachers");
  }

  const libraryIds = teacher.libraries.map((item) => item.id);
  const offeringIds = teacher.offerings.map((item) => item.id);
  const importIds = teacher.timetableImports.map((item) => item.id);

  await prisma.$transaction(async (tx) => {
    if (offeringIds.length) {
      await tx.planRow.deleteMany({
        where: { document: { offeringId: { in: offeringIds } } }
      });
      await tx.planDocument.deleteMany({
        where: { offeringId: { in: offeringIds } }
      });
      await tx.libraryUpdateRequest.deleteMany({
        where: { offeringId: { in: offeringIds } }
      });
      await tx.courseOffering.deleteMany({
        where: { id: { in: offeringIds } }
      });
    }

    if (libraryIds.length) {
      await tx.courseContentItem.deleteMany({
        where: { libraryId: { in: libraryIds } }
      });
      await tx.courseContentLibrary.deleteMany({
        where: { id: { in: libraryIds } }
      });
    }

    if (importIds.length) {
      await tx.timetableSession.deleteMany({
        where: {
          OR: [
            { importId: { in: importIds } },
            { teacherId }
          ]
        }
      });
      await tx.timetableImport.deleteMany({
        where: { id: { in: importIds } }
      });
    } else {
      await tx.timetableSession.deleteMany({
        where: { teacherId }
      });
    }

    await tx.aiTaskLog.deleteMany({
      where: { teacherId }
    });

    await tx.libraryUpdateRequest.deleteMany({
      where: { teacherId }
    });

    if (teacher.user) {
      await tx.user.delete({
        where: { id: teacher.user.id }
      });
    }

    await tx.teacherProfile.delete({
      where: { id: teacherId }
    });
  });

  pushFlash(req, "success", `已删除教师账号：${teacher.name}（${teacher.employeeNo}）。`);
  return redirectWithSession(req, res, "/admin/teachers");
});

router.post("/admin/library-update-requests/:id/approve", requireAdmin, async (req, res) => {
  const requestId = Number(req.params.id);
  const updateRequest = await prisma.libraryUpdateRequest.findUnique({
    where: { id: requestId },
    include: {
      offering: true,
      teacher: true
    }
  });

  if (!updateRequest || updateRequest.status !== "PENDING") {
    pushFlash(req, "error", "未找到待审批的资料库更新申请。");
    return redirectWithSession(req, res, "/teaching-workflow");
  }

  const snapshot = safeParseJson(updateRequest.snapshotJson);

  await updateLibraryFromSnapshot({
    teacherId: updateRequest.teacherId,
    courseName: updateRequest.offering.courseName,
    normalizedCourseName: updateRequest.offering.normalizedCourseName,
    sourceFilename: updateRequest.sourceFilename || "teaching-plan-request",
    snapshotRows: snapshot.rows || []
  });

  await prisma.libraryUpdateRequest.update({
    where: { id: requestId },
    data: {
      status: "APPROVED",
      reviewedByUserId: req.currentUser.id,
      reviewedAt: new Date(),
      note: "管理员已同意。"
    }
  });

  pushFlash(req, "success", `已同意 ${updateRequest.offering.courseName} 的资料库更新申请。`);
  return redirectWithSession(req, res, "/teaching-workflow");
});

router.post("/admin/library-update-requests/:id/reject", requireAdmin, async (req, res) => {
  const requestId = Number(req.params.id);
  const updateRequest = await prisma.libraryUpdateRequest.findUnique({
    where: { id: requestId },
    include: {
      offering: true
    }
  });

  if (!updateRequest || updateRequest.status !== "PENDING") {
    pushFlash(req, "error", "未找到待审批的资料库更新申请。");
    return redirectWithSession(req, res, "/teaching-workflow");
  }

  await prisma.libraryUpdateRequest.update({
    where: { id: requestId },
    data: {
      status: "REJECTED",
      reviewedByUserId: req.currentUser.id,
      reviewedAt: new Date(),
      note: "管理员已拒绝。"
    }
  });

  pushFlash(req, "success", `已拒绝 ${updateRequest.offering.courseName} 的资料库更新申请。`);
  return redirectWithSession(req, res, "/teaching-workflow");
});

function safeParseJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch (_error) {
    return {};
  }
}

module.exports = router;
