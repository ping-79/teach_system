const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");
const XLSX = require("xlsx");
const { createChatCompletion, extractJsonContent } = require("./deepseek");

async function extractTextFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".txt") {
    return fs.readFileSync(filePath, "utf8");
  }

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  if (ext === ".doc") {
    throw new Error("暂不支持直接解析 .doc 文件，请先转换为 .docx 后再上传。");
  }

  if (ext === ".xlsx" || ext === ".xls") {
    const workbook = XLSX.readFile(filePath, { cellDates: false });
    return workbook.SheetNames.map((sheetName) => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        raw: false,
        defval: ""
      });
      return rows.map((row) => row.filter(Boolean).join(" | ")).join("\n");
    }).join("\n\n");
  }

  return fs.readFileSync(filePath, "utf8");
}

async function parseCourseContent({ courseName, extractedText }) {
  const structuredItems = parseTeachingContentTable(extractedText);
  if (structuredItems.length) {
    return {
      source: "structured",
      items: structuredItems
    };
  }

  const aiResult = await parseWithDeepSeek({ courseName, extractedText }).catch(() => null);
  if (aiResult?.items?.length) {
    return aiResult;
  }

  return {
    source: "heuristic",
    items: heuristicParse(extractedText)
  };
}

function parseTeachingContentTable(extractedText) {
  const rawLines = String(extractedText || "").split(/\r?\n/);
  const practiceHeaderIndex = rawLines.findIndex((line) => line.includes("实践"));
  const topicHeaderIndex = rawLines.findIndex((line) => line.includes("教学内容"));

  if (topicHeaderIndex === -1 || practiceHeaderIndex === -1 || practiceHeaderIndex <= topicHeaderIndex) {
    return [];
  }

  let startIndex = practiceHeaderIndex + 1;
  while (startIndex < rawLines.length && !rawLines[startIndex].trim()) {
    startIndex += 1;
  }

  const items = [];
  for (let index = startIndex; index < rawLines.length; index += 8) {
    const topicTitle = String(rawLines[index] || "").trim();
    if (!topicTitle) {
      continue;
    }

    const hours = toNumber(rawLines[index + 2]);
    const theoryHours = toNumber(rawLines[index + 4]);
    const practiceHours = toNumber(rawLines[index + 6]);
    const suggestedHours = hours ?? sumNumbers(theoryHours, practiceHours) ?? null;

    items.push(normalizeParsedItem({
      sortOrder: items.length + 1,
      topicTitle,
      suggestedHours,
      theoryHours,
      practiceHours
    }));
  }

  return items;
}

async function parseWithDeepSeek({ courseName, extractedText }) {
  const response = await createChatCompletion({
    systemPrompt: "你是高校教学资料结构化助手。你必须只输出 JSON 对象，字段为 items，items 为数组。每个条目包含 topicTitle、suggestedHours、theoryHours、practiceHours。所有学时字段都只保留数字，可以为空。",
    userPrompt: `课程名称：${courseName}\n请从下面的授课内容文本中提取结构化教学条目。\n要求：\n1. 按原文顺序整理。\n2. 每个条目都输出 topicTitle、suggestedHours、theoryHours、practiceHours。\n3. 如果文本本身是表格，优先按“教学内容 / 学时 / 理论 / 实践”列理解。\n4. 如果只判断为理论课，practiceHours 填 0 或留空；如果只判断为实践课，theoryHours 填 0 或留空。\n\n原文：\n${extractedText.slice(0, 12000)}`
  });

  if (!response) {
    return null;
  }

  const parsed = extractJsonContent(response);
  return {
    source: "deepseek",
    items: Array.isArray(parsed.items) ? normalizeAiItems(parsed.items) : []
  };
}

function normalizeAiItems(items) {
  return items
    .map((item, index) => normalizeParsedItem({
      sortOrder: index + 1,
      topicTitle: item.topicTitle,
      suggestedHours: item.suggestedHours,
      theoryHours: item.theoryHours,
      practiceHours: item.practiceHours
    }))
    .filter((item) => item.topicTitle);
}

function heuristicParse(extractedText) {
  const lines = String(extractedText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line.length <= 120);

  const filtered = lines.filter((line) => /章|节|项目|任务|模块|单元|主题|案例|实训|实验|实践|绪论|课程/.test(line));
  const selected = (filtered.length ? filtered : lines).slice(0, 20);

  return selected.map((line, index) => {
    const hourMatch = line.match(/(\d+(?:\.\d+)?)\s*学时/);
    const suggestedHours = hourMatch ? Number(hourMatch[1]) : null;
    const isPractice = /实训|实验|实践|上机/.test(line);

    return normalizeParsedItem({
      sortOrder: index + 1,
      topicTitle: line.replace(/^\d+[\.、\s]*/, ""),
      suggestedHours,
      theoryHours: isPractice ? 0 : suggestedHours,
      practiceHours: isPractice ? suggestedHours : 0
    });
  });
}

function normalizeParsedItem(item) {
  const topicTitle = String(item.topicTitle || "").trim();
  const suggestedHours = normalizeNumber(item.suggestedHours);
  let theoryHours = normalizeNumber(item.theoryHours);
  let practiceHours = normalizeNumber(item.practiceHours);

  if (theoryHours === null && practiceHours === null && suggestedHours !== null) {
    theoryHours = suggestedHours;
    practiceHours = 0;
  }

  if (theoryHours === null && practiceHours !== null) {
    theoryHours = 0;
  }

  if (practiceHours === null && theoryHours !== null) {
    practiceHours = 0;
  }

  const totalHours = suggestedHours ?? sumNumbers(theoryHours, practiceHours);

  return {
    sortOrder: item.sortOrder,
    topicTitle,
    suggestedHours: totalHours,
    theoryHours,
    practiceHours,
    mode: inferMode(theoryHours, practiceHours),
    notes: ""
  };
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

function normalizeNumber(value) {
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

function toNumber(value) {
  const matched = String(value || "").trim().match(/^\d+(?:\.\d+)?$/);
  return matched ? Number(matched[0]) : null;
}

module.exports = {
  extractTextFromFile,
  parseCourseContent,
  parseTeachingContentTable
};
