const prisma = require("../config/prisma");
const { normalizeCourseName, trimFloat } = require("../utils/normalizers");
const { parseWeekRule, buildDateText, countHoursFromPeriodText } = require("../utils/week-utils");

const MIN_ROWS = 1;

async function ensureTeachingPlan(offeringId, options = {}) {
  const forceRegenerate = Boolean(options.forceRegenerate);

  let document = await prisma.planDocument.findUnique({
    where: { offeringId_type: { offeringId, type: "teaching" } },
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

  if (document && document.rows.length && !forceRegenerate) {
    return document;
  }

  const offering = document?.offering || await getOfferingWithContext(offeringId);
  const library = await prisma.courseContentLibrary.findUnique({
    where: {
      teacherId_normalizedCourseName: {
        teacherId: offering.teacherId,
        normalizedCourseName: offering.normalizedCourseName
      }
    },
    include: {
      items: { orderBy: { sortOrder: "asc" } }
    }
  });

  return applyContentItemsToTeachingPlan(offeringId, library?.items || [], {
    preserveCourseTotalHours: !library?.items?.length,
    source: library?.items?.length ? "library" : "schedule-only"
  });
}

async function applyContentItemsToTeachingPlan(offeringId, contentItems = [], options = {}) {
  const offering = await getOfferingWithContext(offeringId);
  const sessions = await getSessionsForOffering(offering);
  const generated = buildRows({
    sessions,
    teachingStartDate: offering.semester.teachingStartDate,
    contentItems,
    courseTotalHours: options.preserveCourseTotalHours ? offering.courseTotalHours : null
  });

  const document = await upsertTeachingDocument(offeringId, generated, {
    source: options.source || "manual"
  });

  await syncPracticePlan(offeringId);
  return document;
}

async function saveTeachingPlan(documentId, payload) {
  const rawRows = (payload.rows || []).map((row, index) => {
    const hours = row.hours ? Number(row.hours) : null;
    const theoryHours = row.theoryHours ? Number(row.theoryHours) : null;
    const practiceHours = row.practiceHours ? Number(row.practiceHours) : null;

    return {
      sortOrder: index + 1,
      weekIndex: row.weekIndex ? Number(row.weekIndex) : null,
      dateText: row.dateText || "",
      periodText: row.periodText || "",
      topicText: row.topicText || "",
      hours,
      mode: inferMode(theoryHours, practiceHours),
      theoryHours,
      practiceHours
    };
  });

  const rows = normalizeRows(rawRows);
  const activeRows = rows.filter(isActiveRow);
  const totalHours = sumBy(activeRows, "hours");
  const theoryHours = sumBy(activeRows, "theoryHours");
  const practiceHours = sumBy(activeRows, "practiceHours");

  const document = await prisma.planDocument.update({
    where: { id: documentId },
    data: {
      totalHours: payload.totalHours ? Number(payload.totalHours) : totalHours,
      theoryHours: payload.theoryHours ? Number(payload.theoryHours) : theoryHours,
      practiceHours: payload.practiceHours ? Number(payload.practiceHours) : practiceHours,
      weeklyHours: payload.weeklyHours ? Number(payload.weeklyHours) : null,
      status: "READY",
      metadataJson: JSON.stringify({
        generatedRowCount: activeRows.length,
        visibleRowCount: activeRows.length,
        source: "edited"
      }),
      rows: {
        deleteMany: {},
        create: rows
      }
    },
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

  await syncPracticePlan(document.offeringId);
  return document;
}

async function syncPracticePlan(offeringId) {
  const teachingPlan = await prisma.planDocument.findUnique({
    where: { offeringId_type: { offeringId, type: "teaching" } },
    include: { rows: { orderBy: { sortOrder: "asc" } } }
  });

  if (!teachingPlan) {
    return null;
  }

  const practiceRows = teachingPlan.rows
    .filter((row) => Number(row.practiceHours || 0) > 0)
    .map((row, index) => ({
      sortOrder: index + 1,
      weekIndex: row.weekIndex,
      dateText: row.dateText,
      periodText: row.periodText,
      topicText: row.topicText,
      hours: row.practiceHours || row.hours,
      mode: "practice",
      theoryHours: 0,
      practiceHours: row.practiceHours || row.hours
    }));

  await prisma.planDocument.upsert({
    where: { offeringId_type: { offeringId, type: "practice" } },
    update: {
      totalHours: sumBy(practiceRows, "hours"),
      theoryHours: 0,
      practiceHours: sumBy(practiceRows, "practiceHours"),
      weeklyHours: practiceRows[0]?.hours || null,
      metadataJson: JSON.stringify({
        generatedRowCount: practiceRows.length,
        visibleRowCount: practiceRows.length,
        source: "practice-sync"
      }),
      rows: {
        deleteMany: {},
        create: normalizeRows(practiceRows)
      }
    },
    create: {
      offeringId,
      type: "practice",
      totalHours: sumBy(practiceRows, "hours"),
      theoryHours: 0,
      practiceHours: sumBy(practiceRows, "practiceHours"),
      weeklyHours: practiceRows[0]?.hours || null,
      metadataJson: JSON.stringify({
        generatedRowCount: practiceRows.length,
        visibleRowCount: practiceRows.length,
        source: "practice-sync"
      }),
      rows: {
        create: normalizeRows(practiceRows)
      }
    }
  });

  return practiceRows;
}

async function regenerateTeachingPlansForCourse(teacherId, normalizedCourseName) {
  const offerings = await prisma.courseOffering.findMany({
    where: { teacherId, normalizedCourseName }
  });

  for (const offering of offerings) {
    await ensureTeachingPlan(offering.id, { forceRegenerate: true });
  }
}

async function findMatchingLibrary(teacherId, courseName) {
  return prisma.courseContentLibrary.findUnique({
    where: {
      teacherId_normalizedCourseName: {
        teacherId,
        normalizedCourseName: normalizeCourseName(courseName)
      }
    },
    include: {
      items: { orderBy: { sortOrder: "asc" } }
    }
  });
}

async function updateLibraryFromTeachingPlan(offeringId, options = {}) {
  const document = await prisma.planDocument.findUnique({
    where: { offeringId_type: { offeringId, type: "teaching" } },
    include: {
      rows: { orderBy: { sortOrder: "asc" } },
      offering: true
    }
  });

  if (!document) {
    throw new Error("未找到需要回写的教学进度计划表。");
  }

  const items = extractLibraryItemsFromRows(document.rows);
  const library = await upsertLibraryFromItems({
    teacherId: document.offering.teacherId,
    courseName: document.offering.courseName,
    normalizedCourseName: document.offering.normalizedCourseName,
    sourceFilename: options.sourceFilename || "teaching-plan-update",
    items
  });

  return { library, itemCount: items.length };
}

async function updateLibraryFromSnapshot({
  teacherId,
  courseName,
  normalizedCourseName,
  sourceFilename,
  snapshotRows
}) {
  const items = extractLibraryItemsFromRows(snapshotRows || []);
  const library = await upsertLibraryFromItems({
    teacherId,
    courseName,
    normalizedCourseName,
    sourceFilename: sourceFilename || "teaching-plan-request",
    items
  });

  return { library, itemCount: items.length };
}

function buildRows({ sessions, teachingStartDate, contentItems, courseTotalHours }) {
  const scheduleRows = buildScheduleRows(sessions, teachingStartDate);
  const rowCount = Math.max(scheduleRows.length, contentItems.length, 0);
  const mergedRows = [];

  for (let index = 0; index < rowCount; index += 1) {
    const scheduleRow = scheduleRows[index] || createEmptyRow();
    const content = contentItems[index];
    const row = {
      ...scheduleRow
    };

    if (content) {
      const theoryHours = normalizeNumber(content.theoryHours);
      const practiceHours = normalizeNumber(content.practiceHours);
      const explicitHours = theoryHours !== null || practiceHours !== null
        ? sumNumbers(theoryHours, practiceHours)
        : null;
      const hours = normalizeNumber(content.suggestedHours) ?? explicitHours ?? normalizeNumber(scheduleRow.hours);

      row.topicText = content.topicTitle || "";
      row.hours = hours;
      row.mode = normalizeMode(content.mode || inferMode(theoryHours, practiceHours));

      if (theoryHours !== null || practiceHours !== null) {
        row.theoryHours = theoryHours ?? 0;
        row.practiceHours = practiceHours ?? 0;
      } else if (row.mode === "practice") {
        row.theoryHours = 0;
        row.practiceHours = hours;
      } else if (row.mode === "mixed") {
        const half = hours ? Number((hours / 2).toFixed(1)) : null;
        row.theoryHours = half;
        row.practiceHours = hours !== null && half !== null ? Number((hours - half).toFixed(1)) : null;
      } else {
        row.theoryHours = hours;
        row.practiceHours = 0;
      }
    } else {
      row.mode = inferMode(row.theoryHours, row.practiceHours);
    }

    mergedRows.push(row);
  }

  const normalizedRows = normalizeRows(mergedRows);
  const activeRows = normalizedRows.filter(isActiveRow);
  const summedTotalHours = sumBy(activeRows, "hours");
  const summedTheoryHours = sumBy(activeRows, "theoryHours");
  const summedPracticeHours = sumBy(activeRows, "practiceHours");
  const totalHours = normalizeNumber(courseTotalHours) ?? summedTotalHours;

  return {
    rows: normalizedRows,
    totals: {
      totalHours,
      theoryHours: summedTheoryHours,
      practiceHours: summedPracticeHours,
      weeklyHours: normalizeWeeklyHours(activeRows)
    },
    metadata: {
      generatedRowCount: mergedRows.length,
      visibleRowCount: activeRows.length
    }
  };
}

function buildScheduleRows(sessions, teachingStartDate) {
  const expanded = [];

  sessions.forEach((session) => {
    const weeks = parseWeekRule(session.weekRuleRaw);
    const baseHours = countHoursFromPeriodText(session.periodText);

    weeks.forEach((weekIndex) => {
      expanded.push({
        weekIndex,
        dateText: buildDateText(teachingStartDate, weekIndex, session.weekday),
        periodText: session.periodText || "",
        topicText: "",
        hours: baseHours,
        theoryHours: session.isPracticeHint ? 0 : baseHours,
        practiceHours: session.isPracticeHint ? baseHours : 0,
        mode: session.isPracticeHint ? "practice" : "theory",
        _sortWeekday: session.weekday,
        _sortOrder: expanded.length + 1
      });
    });
  });

  expanded.sort((left, right) => {
    if (left.weekIndex !== right.weekIndex) {
      return left.weekIndex - right.weekIndex;
    }

    if (left._sortWeekday !== right._sortWeekday) {
      return left._sortWeekday - right._sortWeekday;
    }

    return left._sortOrder - right._sortOrder;
  });

  return expanded.map((row) => ({
    weekIndex: row.weekIndex,
    dateText: row.dateText,
    periodText: row.periodText,
    topicText: row.topicText,
    hours: row.hours,
    theoryHours: row.theoryHours,
    practiceHours: row.practiceHours,
    mode: row.mode
  }));
}

function normalizeRows(rows) {
  const normalizedRows = rows.map((row, index) => ({
    sortOrder: index + 1,
    weekIndex: row.weekIndex ?? null,
    dateText: row.dateText || "",
    periodText: row.periodText || "",
    topicText: row.topicText || "",
    hours: normalizeNumber(row.hours),
    mode: inferMode(row.theoryHours, row.practiceHours),
    theoryHours: normalizeNumber(row.theoryHours),
    practiceHours: normalizeNumber(row.practiceHours)
  }));

  while (normalizedRows.length < MIN_ROWS) {
    normalizedRows.push({
      sortOrder: normalizedRows.length + 1,
      weekIndex: null,
      dateText: "",
      periodText: "",
      topicText: "",
      hours: null,
      mode: "theory",
      theoryHours: null,
      practiceHours: null
    });
  }

  return normalizedRows;
}

function extractLibraryItemsFromRows(rows = []) {
  return rows
    .filter((row) => row.topicText || row.hours || row.theoryHours || row.practiceHours)
    .map((row, index) => ({
      sortOrder: index + 1,
      topicTitle: String(row.topicText || "").trim(),
      suggestedHours: normalizeNumber(row.hours) ?? sumNumbers(row.theoryHours, row.practiceHours),
      theoryHours: normalizeNumber(row.theoryHours),
      practiceHours: normalizeNumber(row.practiceHours),
      mode: inferMode(row.theoryHours, row.practiceHours),
      notes: ""
    }))
    .filter((item) => item.topicTitle);
}

async function upsertLibraryFromItems({
  teacherId,
  courseName,
  normalizedCourseName,
  sourceFilename,
  items
}) {
  const existing = await prisma.courseContentLibrary.findUnique({
    where: {
      teacherId_normalizedCourseName: {
        teacherId,
        normalizedCourseName
      }
    }
  });

  return prisma.courseContentLibrary.upsert({
    where: {
      teacherId_normalizedCourseName: {
        teacherId,
        normalizedCourseName
      }
    },
    update: {
      courseName,
      sourceFilename: sourceFilename || existing?.sourceFilename || "teaching-plan-update",
      draftItemsJson: JSON.stringify(items),
      status: "ACTIVE",
      items: {
        deleteMany: {},
        create: items
      }
    },
    create: {
      teacherId,
      courseName,
      normalizedCourseName,
      sourceFilename: sourceFilename || "teaching-plan-update",
      draftItemsJson: JSON.stringify(items),
      status: "ACTIVE",
      items: {
        create: items
      }
    }
  });
}

function buildPlanValidation(planDocument) {
  const issues = [];
  const rows = planDocument.rows || [];
  const activeRows = rows.filter(isActiveRow);
  const totalHours = sumBy(activeRows, "hours");
  const theoryHours = sumBy(activeRows, "theoryHours");
  const practiceHours = sumBy(activeRows, "practiceHours");
  const metadata = parseMetadata(planDocument.metadataJson);

  if (metadata.generatedRowCount > rows.length) {
    issues.push(`系统识别到 ${metadata.generatedRowCount} 条授课记录，但当前仅显示 ${rows.length} 行。`);
  }

  if ((planDocument.totalHours || 0) !== totalHours) {
    issues.push(`明细学时合计 ${trimFloat(totalHours)} 与表头总学时不一致。`);
  }

  if ((planDocument.theoryHours || 0) !== theoryHours) {
    issues.push(`明细理论学时合计 ${trimFloat(theoryHours)} 与表头不一致。`);
  }

  if ((planDocument.practiceHours || 0) !== practiceHours) {
    issues.push(`明细实践学时合计 ${trimFloat(practiceHours)} 与表头不一致。`);
  }

  activeRows.forEach((row) => {
    const rowTotal = sumNumbers(row.theoryHours, row.practiceHours);
    if (Number(row.hours || 0) !== rowTotal) {
      issues.push(`第 ${row.sortOrder} 行学时与理论/实践拆分不一致。`);
    }
  });

  return issues;
}

function parseMetadata(metadataJson) {
  try {
    return JSON.parse(metadataJson || "{}");
  } catch (_error) {
    return {};
  }
}

async function getOfferingWithContext(offeringId) {
  return prisma.courseOffering.findUnique({
    where: { id: offeringId },
    include: {
      teacher: true,
      semester: true
    }
  });
}

async function getSessionsForOffering(offering) {
  return prisma.timetableSession.findMany({
    where: {
      teacherId: offering.teacherId,
      semesterId: offering.semesterId,
      normalizedCourseName: offering.normalizedCourseName,
      className: offering.className
    },
    orderBy: [{ weekday: "asc" }, { id: "asc" }]
  });
}

async function upsertTeachingDocument(offeringId, generated, metadata = {}) {
  return prisma.planDocument.upsert({
    where: { offeringId_type: { offeringId, type: "teaching" } },
    update: {
      totalHours: generated.totals.totalHours,
      theoryHours: generated.totals.theoryHours,
      practiceHours: generated.totals.practiceHours,
      weeklyHours: generated.totals.weeklyHours,
      status: "READY",
      metadataJson: JSON.stringify({
        ...generated.metadata,
        ...metadata
      }),
      rows: {
        deleteMany: {},
        create: generated.rows
      }
    },
    create: {
      offeringId,
      type: "teaching",
      totalHours: generated.totals.totalHours,
      theoryHours: generated.totals.theoryHours,
      practiceHours: generated.totals.practiceHours,
      weeklyHours: generated.totals.weeklyHours,
      status: "READY",
      metadataJson: JSON.stringify({
        ...generated.metadata,
        ...metadata
      }),
      rows: {
        create: generated.rows
      }
    },
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
}

function createEmptyRow() {
  return {
    weekIndex: null,
    dateText: "",
    periodText: "",
    topicText: "",
    hours: null,
    theoryHours: null,
    practiceHours: null,
    mode: "theory"
  };
}

function normalizeWeeklyHours(rows) {
  const firstFilled = rows.find((row) => normalizeNumber(row.hours) !== null);
  return firstFilled ? normalizeNumber(firstFilled.hours) : null;
}

function normalizeMode(mode) {
  if (mode === "practice") {
    return "practice";
  }

  if (mode === "mixed") {
    return "mixed";
  }

  return "theory";
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function sumBy(rows, key) {
  return rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
}

function sumNumbers(...values) {
  const resolved = values.filter((value) => value !== null && value !== undefined);
  if (!resolved.length) {
    return 0;
  }

  return resolved.reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function isActiveRow(row) {
  return Boolean(row.weekIndex || row.topicText || row.hours || row.periodText);
}

function inferMode(theoryHours, practiceHours) {
  const theory = Number(theoryHours || 0);
  const practice = Number(practiceHours || 0);

  if (practice > 0 && theory > 0) {
    return "mixed";
  }

  if (practice > 0) {
    return "practice";
  }

  return "theory";
}

module.exports = {
  ensureTeachingPlan,
  applyContentItemsToTeachingPlan,
  buildPlanValidation,
  saveTeachingPlan,
  syncPracticePlan,
  regenerateTeachingPlansForCourse,
  updateLibraryFromTeachingPlan,
  updateLibraryFromSnapshot,
  findMatchingLibrary,
  MIN_ROWS
};
