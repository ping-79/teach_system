const dayjs = require("dayjs");

function parseWeekRule(weekRuleRaw) {
  const raw = String(weekRuleRaw || "").replace(/\s+/g, "");
  const result = new Set();

  raw.split(/[，,]/).forEach((part) => {
    if (!part) {
      return;
    }

    const singleMatch = part.match(/^(\d+)周$/);
    if (singleMatch) {
      result.add(Number(singleMatch[1]));
      return;
    }

    const rangeMatch = part.match(/^(\d+)-(\d+)周$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      for (let week = start; week <= end; week += 1) {
        result.add(week);
      }
    }
  });

  return [...result].sort((left, right) => left - right);
}

function weekdayIndexToOffset(weekday) {
  return Math.max(0, Number(weekday || 1) - 1);
}

function buildDateText(startDate, weekIndex, weekday) {
  if (!startDate || !weekIndex || !weekday) {
    return "";
  }

  const date = dayjs(startDate)
    .add((Number(weekIndex) - 1) * 7 + weekdayIndexToOffset(weekday), "day");

  return date.format("MM/DD");
}

function countHoursFromPeriodText(periodText) {
  const match = String(periodText || "").match(/(\d+)\s*-\s*(\d+)/);
  if (!match) {
    return 2;
  }

  const start = Number(match[1]);
  const end = Number(match[2]);
  return Math.max(1, end - start + 1);
}

module.exports = {
  parseWeekRule,
  buildDateText,
  countHoursFromPeriodText
};
