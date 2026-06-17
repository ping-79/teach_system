/**
 * 业绩结构化：把 OCR / 文本 → 业绩表单字段（草稿，供老师确认）
 *
 * 优先 DeepSeek 出 JSON；无 key 或失败时退回启发式（正则）抽取。
 * 始终是"草稿确认流"——绝不盲信识别结果，原扫描件留存为佐证。
 */
const { createChatCompletion, extractJsonContent } = require("./deepseek");

const LEVEL_KEYWORDS = [
  { level: "NATIONAL", re: /国家级|国家|全国|教育部/ },
  { level: "PROVINCIAL", re: /省级|全省|省教育厅|省厅/ },
  { level: "MUNICIPAL", re: /市级|市厅|地市|厅级/ },
  { level: "SCHOOL", re: /校级|院级|学校|学院/ }
];

const RANK_KEYWORDS = [
  { rank: "SPECIAL", re: /特等奖?/ },
  { rank: "FIRST", re: /一等奖?|金奖|第一名/ },
  { rank: "SECOND", re: /二等奖?|银奖|第二名/ },
  { rank: "THIRD", re: /三等奖?|铜奖|第三名/ }
];

function heuristicExtract(text = "") {
  const source = String(text || "");
  const result = {
    title: "",
    level: "NONE",
    rank: "NONE",
    rankLabel: "",
    authorOrder: null,
    authorRole: "",
    happenedOn: null
  };

  // 级别
  for (const { level, re } of LEVEL_KEYWORDS) {
    if (re.test(source)) {
      result.level = level;
      break;
    }
  }
  // 等次
  for (const { rank, re } of RANK_KEYWORDS) {
    const m = source.match(re);
    if (m) {
      result.rank = rank;
      result.rankLabel = m[0];
      break;
    }
  }
  // 日期：YYYY-MM 或 YYYY年MM月
  const dateMatch = source.match(/(20\d{2})\s*[-年.\/]\s*(\d{1,2})?/);
  if (dateMatch) {
    const y = dateMatch[1];
    const mo = (dateMatch[2] || "1").padStart(2, "0");
    result.happenedOn = `${y}-${mo}-01`;
  }
  // 本人排序：第X / 排名X
  const orderMatch = source.match(/第\s*([0-9一二三四五六七八九十]+)\s*(完成人|作者|名|位)/);
  if (orderMatch) {
    result.authorOrder = cnNumToInt(orderMatch[1]);
    result.authorRole = orderMatch[0];
  } else if (/主持|负责人|第一完成人|通讯作者/.test(source)) {
    result.authorOrder = 1;
    result.authorRole = (source.match(/主持|负责人|第一完成人|通讯作者/) || [])[0] || "";
  }
  // 标题：取首个较长非空行
  const titleLine = source
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length >= 4 && l.length <= 60);
  if (titleLine) {
    result.title = titleLine;
  }

  return { source: "heuristic", fields: result };
}

function cnNumToInt(token) {
  const direct = Number(token);
  if (Number.isFinite(direct)) {
    return direct;
  }
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  return map[token] || null;
}

/**
 * 用 DeepSeek 把文本结构化为业绩字段；失败回退启发式。
 * @returns {{ source:'deepseek'|'heuristic', fields:object }}
 */
async function structureAchievement({ ocrText, category, subType }) {
  const text = String(ocrText || "").trim();
  if (!text) {
    return { source: "heuristic", fields: heuristicExtract("") };
  }

  const systemPrompt = [
    "你是高校教师业绩材料结构化助手。",
    "从给定的佐证材料文本中抽取业绩信息，只输出 JSON，字段如下：",
    "title(业绩名称/题目), level(国NATIONAL/省PROVINCIAL/市厅MUNICIPAL/校SCHOOL/无NONE),",
    "rank(特SPECIAL/一FIRST/二SECOND/三THIRD/无NONE), rankLabel(原始等次文字如'一等奖'),",
    "authorOrder(本人完成排序的整数，不确定填null), authorRole(主持/第几完成人/通讯作者等),",
    "happenedOn(取得日期 YYYY-MM-DD，不确定填null), detail(其余关键信息的对象，如期刊/课题来源/专利号/经费等)。",
    "无法判断的字段填 null 或 NONE，不要编造。"
  ].join("\n");

  const userPrompt = [
    `业绩大类：${category || "未知"}；子类：${subType || "未知"}。`,
    "佐证材料文本：",
    text.slice(0, 4000)
  ].join("\n");

  try {
    const response = await createChatCompletion({ systemPrompt, userPrompt, temperature: 0.1 });
    if (!response) {
      return heuristicExtract(text);
    }
    const parsed = extractJsonContent(response);
    return {
      source: "deepseek",
      fields: {
        title: parsed.title || "",
        level: normalizeEnum(parsed.level, ["NATIONAL", "PROVINCIAL", "MUNICIPAL", "SCHOOL", "NONE"], "NONE"),
        rank: normalizeEnum(parsed.rank, ["SPECIAL", "FIRST", "SECOND", "THIRD", "NONE"], "NONE"),
        rankLabel: parsed.rankLabel || "",
        authorOrder: Number.isFinite(Number(parsed.authorOrder)) ? Number(parsed.authorOrder) : null,
        authorRole: parsed.authorRole || "",
        happenedOn: parsed.happenedOn || null,
        detail: parsed.detail || {}
      }
    };
  } catch (_error) {
    return heuristicExtract(text);
  }
}

function normalizeEnum(value, allowed, fallback) {
  const upper = String(value || "").toUpperCase();
  return allowed.includes(upper) ? upper : fallback;
}

module.exports = {
  structureAchievement,
  heuristicExtract
};
