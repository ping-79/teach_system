const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get(["/", "/dashboard"], requireAuth, async (req, res) => {
  return res.render("dashboard/modules", {
    title: "首页",
    pageName: "dashboard"
  });
});

router.get("/teaching-workflow", requireAuth, async (req, res) => {
  if (req.currentUser.role === "admin") {
    const [teacherCount, semesterCount, offeringCount] = await Promise.all([
      prisma.teacherProfile.count(),
      prisma.semester.count(),
      prisma.courseOffering.count()
    ]);

    const [teachers, pendingLibraryUpdateRequests] = await Promise.all([
      prisma.teacherProfile.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { user: true }
      }),
      prisma.libraryUpdateRequest.findMany({
        where: { status: "PENDING" },
        orderBy: { requestedAt: "desc" },
        include: {
          offering: true,
          teacher: true
        }
      })
    ]);

    return res.render("dashboard/admin", {
      title: "教学进度计划表生成系统",
      pageName: "teaching-workflow",
      stats: { teacherCount, semesterCount, offeringCount },
      teachers,
      pendingLibraryUpdateRequests
    });
  }

  const teacherId = req.currentUser.teacherProfileId;
  const semesters = await prisma.semester.findMany({
    orderBy: [{ schoolYear: "desc" }, { termNumber: "desc" }]
  });
  const offeringCounts = await prisma.courseOffering.groupBy({
    by: ["semesterId"],
    where: { teacherId },
    _count: { _all: true }
  });
  const offeringCountMap = new Map(
    offeringCounts.map((item) => [item.semesterId, item._count._all])
  );

  const libraries = await prisma.courseContentLibrary.count({
    where: { teacherId }
  });

  return res.render("dashboard/teacher", {
    title: "教学进度计划表生成系统",
    pageName: "teaching-workflow",
    semesters: semesters.map((semester) => ({
      ...semester,
      offeringCount: offeringCountMap.get(semester.id) || 0
    })),
    libraries
  });
});

router.get("/lesson-plan-generator", requireAuth, (req, res) => {
  return res.render("dashboard/lesson-plan-shell", {
    title: "教案生成系统",
    pageName: "lesson-plan-generator"
  });
});

module.exports = router;
