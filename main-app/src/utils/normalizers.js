function normalizeCourseName(value) {
  return String(value || "")
    .trim()
    .replace(/[（）]/g, (token) => (token === "（" ? "(" : ")"))
    .replace(/\s+/g, "")
    .toLowerCase();
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function trimFloat(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "";
  }

  if (Number.isInteger(parsed)) {
    return String(parsed);
  }

  return parsed.toFixed(1).replace(/\.0$/, "");
}

function looksLikePracticeCourse(courseName) {
  return /实训|实践|实验|上机|写生|实习/i.test(String(courseName || ""));
}

module.exports = {
  normalizeCourseName,
  parseNumber,
  trimFloat,
  looksLikePracticeCourse
};
