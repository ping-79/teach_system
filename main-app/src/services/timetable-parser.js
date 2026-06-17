const XLSX = require("xlsx");
const { normalizeCourseName, looksLikePracticeCourse } = require("../utils/normalizers");

const WEEKDAY_MAP = {
  "星期一": 1,
  "星期二": 2,
  "星期三": 3,
  "星期四": 4,
  "星期五": 5,
  "星期六": 6,
  "星期日": 7
};

function parseTimetable(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: false,
    defval: ""
  });

  const semesterLabel = rows[0]?.[0] || "";
  const teacherCell = rows[0]?.[3] || "";
  const collegeCell = rows[0]?.[7] || "";
  const teacherName = String(teacherCell).replace(/老师的课表/, "").trim();
  const employeeNoMatch = String(collegeCell).match(/教工号[:：]\s*([A-Za-z0-9]+)/);
  const employeeNo = employeeNoMatch ? employeeNoMatch[1] : "";
  const college = String(collegeCell).replace(/教工号[:：].+$/, "").trim();
  const weekdayRow = rows[1] || [];
  const sessions = [];

  for (let rowIndex = 2; rowIndex <= 7; rowIndex += 1) {
    const currentRow = rows[rowIndex] || [];
    const periodLabel = currentRow[1] || currentRow[0] || "";

    for (let colIndex = 2; colIndex <= 8; colIndex += 1) {
      const cellText = String(currentRow[colIndex] || "").trim();
      const weekdayLabel = weekdayRow[colIndex] || "";
      if (!cellText || !weekdayLabel) {
        continue;
      }

      cellText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((entryText) => {
          const parsed = parseEntry(entryText);
          sessions.push({
            weekday: WEEKDAY_MAP[weekdayLabel] || colIndex - 1,
            weekdayLabel,
            periodLabel,
            rawCellText: entryText,
            ...parsed
          });
        });
    }
  }

  return {
    sheetName,
    semesterLabel,
    teacherName,
    employeeNo,
    college,
    sessions
  };
}

function parseEntry(entryText) {
  const match = entryText.match(
    /^(.*?)\/\(([^)]+)\)([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/
  );

  if (!match) {
    return {
      courseName: entryText,
      normalizedCourseName: normalizeCourseName(entryText),
      periodText: "",
      weekRuleRaw: "",
      campus: "",
      location: "",
      className: "",
      studentCount: null,
      courseTotalHours: null,
      isPracticeHint: looksLikePracticeCourse(entryText)
    };
  }

  const campusLocation = match[4].trim();
  const campusParts = campusLocation.split(/\s+/);
  const location = campusParts.length > 1 ? campusParts.pop() : "";
  const campus = campusParts.join(" ");
  const courseName = match[1].trim();

  return {
    courseName,
    normalizedCourseName: normalizeCourseName(courseName),
    periodText: match[2].trim(),
    weekRuleRaw: match[3].trim(),
    campus,
    location,
    className: match[5].trim(),
    studentCount: Number(match[6]) || null,
    courseTotalHours: Number(match[7]) || null,
    isPracticeHint: looksLikePracticeCourse(courseName)
  };
}

module.exports = {
  parseTimetable
};
