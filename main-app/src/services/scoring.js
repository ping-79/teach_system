/**
 * 量化算分引擎（配置驱动）
 *
 * 设计原则：规则全部来自 ScoringItem.configJson，代码只做通用计算：
 *   查表（级别×等次→分值） × 排序系数 → 取最高（就高不就低） → 分项/分组封顶。
 *
 * 分期：
 *   v1  —— 无评分方案配置时，按内置启发式给"建议分"，老师可在自评分里改。
 *   v1.5 —— 配置 ScoringScheme/ScoringItem 后开启按表全自动算分。
 *
 * 降级：任何环节出错都返回 null（不阻断录入），由前端提示"暂未自动算分，请手填自评分"。
 */

// 内置启发式建议分：级别 × 等次 → 基础分（仅在未配置评分细则时使用）
const HEURISTIC_LEVEL_RANK = {
  NATIONAL: { SPECIAL: 15, FIRST: 12, SECOND: 10, THIRD: 8, NONE: 6 },
  PROVINCIAL: { SPECIAL: 10, FIRST: 9, SECOND: 7, THIRD: 5, NONE: 4 },
  MUNICIPAL: { SPECIAL: 6, FIRST: 5, SECOND: 4, THIRD: 3, NONE: 2 },
  SCHOOL: { SPECIAL: 3, FIRST: 2.5, SECOND: 2, THIRD: 1.5, NONE: 1 },
  NONE: { SPECIAL: 0, FIRST: 0, SECOND: 0, THIRD: 0, NONE: 0 }
};

// 默认排序系数：第1完成人=1，其后递减；超出部分取 orderCoefRest
const DEFAULT_ORDER_COEF = [1, 0.75, 0.5, 0.375, 0.3];
const DEFAULT_ORDER_COEF_REST = 0.2;

function round2(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return null;
  }
  return Math.round(Number(value) * 100) / 100;
}

function parseConfig(scoringItem) {
  if (!scoringItem || !scoringItem.configJson) {
    return {};
  }
  try {
    return JSON.parse(scoringItem.configJson) || {};
  } catch (_error) {
    return {};
  }
}

function orderCoefficient(authorOrder, config = {}) {
  const order = Number(authorOrder);
  if (!Number.isInteger(order) || order < 1) {
    return 1; // 排序未知按主完成人计
  }
  const table = Array.isArray(config.orderCoef) ? config.orderCoef : DEFAULT_ORDER_COEF;
  const rest = config.orderCoefRest ?? DEFAULT_ORDER_COEF_REST;
  return order <= table.length ? table[order - 1] : rest;
}

function parseDetail(achievement) {
  if (!achievement || !achievement.detailJson) {
    return {};
  }
  try {
    return JSON.parse(achievement.detailJson) || {};
  } catch (_error) {
    return {};
  }
}

/**
 * 计算单条业绩得分。
 * @param {object} achievement —— 含 level / rank / authorOrder / detailJson
 * @param {object|null} scoringItem —— 命中的评分细则；为空则走启发式建议分
 * @returns {{ score:number|null, source:string }} source: 'scheme' | 'heuristic' | 'none'
 */
function scoreAchievement(achievement, scoringItem = null) {
  if (!achievement) {
    return { score: null, source: "none" };
  }

  const level = achievement.level || "NONE";
  const rank = achievement.rank || "NONE";
  const coef = orderCoefficient(achievement.authorOrder, parseConfig(scoringItem));

  // —— 按配置的评分细则算 ——
  if (scoringItem) {
    const config = parseConfig(scoringItem);
    let base = null;

    switch (scoringItem.scoreType) {
      case "FIXED":
        base = Number(config.fixed ?? config.score ?? 0);
        break;
      case "PER_UNIT": {
        const detail = parseDetail(achievement);
        const unitField = config.unitField || "quantity";
        const quantity = Number(detail[unitField] ?? config.quantity ?? 0);
        base = Number(config.perUnit ?? 0) * quantity;
        break;
      }
      case "LOOKUP":
      default: {
        const table = config.levelRank || {};
        base = Number(table?.[level]?.[rank] ?? 0);
        break;
      }
    }

    let score = base * coef;
    if (scoringItem.maxScore != null) {
      score = Math.min(score, Number(scoringItem.maxScore));
    }
    return { score: round2(score), source: "scheme" };
  }

  // —— 启发式建议分（未配置方案时）——
  const base = HEURISTIC_LEVEL_RANK?.[level]?.[rank];
  if (base === undefined) {
    return { score: null, source: "none" };
  }
  return { score: round2(base * coef), source: "heuristic" };
}

/**
 * 汇总一批业绩为申报批次总分。
 * 规则：
 *   1. 同一"限分组(capGroupCode)"内的同名细项，就高不就低 —— 仅取最高一条计入（当 pickMaxOnly）。
 *   2. 各细项可有 maxScore 封顶（单条已在 scoreAchievement 截断）。
 *   3. 限分组有 groupCaps 上限时，组内总和封顶。
 * @param {Array} achievements —— 每条需带 effectiveScore（finalScore ?? prelimScore ?? selfScore ?? computedScore）
 * @param {object} options —— { groupCaps: { 'TEACHING':50, 'RESUME':20 }, pickMaxGroups: ['xxx'] }
 * @returns {{ total:number, byCategory:object, byGroup:object }}
 */
function scoreApplication(achievements = [], options = {}) {
  const groupCaps = options.groupCaps || {};
  const pickMaxGroups = new Set(options.pickMaxGroups || []);

  const byCategory = { RESUME: 0, TEACHING: 0, RESEARCH: 0 };
  const byGroup = {};
  const pickMaxBuckets = {}; // groupCode -> 最高分

  achievements.forEach((item) => {
    const score = Number(
      item.effectiveScore ??
        item.finalScore ??
        item.prelimScore ??
        item.selfScore ??
        item.computedScore ??
        0
    );
    if (!Number.isFinite(score) || score <= 0) {
      return;
    }

    const group = item.capGroupCode || item.category || "OTHER";

    if (pickMaxGroups.has(group)) {
      // 就高不就低：组内只保留最高一条
      pickMaxBuckets[group] = Math.max(pickMaxBuckets[group] || 0, score);
    } else {
      byGroup[group] = (byGroup[group] || 0) + score;
      if (item.category && byCategory[item.category] !== undefined) {
        byCategory[item.category] += score;
      }
    }
  });

  // 合入"就高"组
  Object.entries(pickMaxBuckets).forEach(([group, score]) => {
    byGroup[group] = (byGroup[group] || 0) + score;
  });

  // 分组封顶
  Object.keys(byGroup).forEach((group) => {
    if (groupCaps[group] != null) {
      byGroup[group] = Math.min(byGroup[group], Number(groupCaps[group]));
    }
  });

  // 分类封顶（按 category 维度）
  Object.keys(byCategory).forEach((cat) => {
    if (groupCaps[cat] != null) {
      byCategory[cat] = Math.min(byCategory[cat], Number(groupCaps[cat]));
    }
  });

  const total = Object.values(byCategory).reduce((sum, v) => sum + v, 0);

  return {
    total: round2(total),
    byCategory: {
      RESUME: round2(byCategory.RESUME),
      TEACHING: round2(byCategory.TEACHING),
      RESEARCH: round2(byCategory.RESEARCH)
    },
    byGroup
  };
}

/**
 * 取一条业绩的"有效得分"：终复 > 初复 > 自评 > 系统建议。
 */
function effectiveScore(achievement) {
  if (!achievement) {
    return null;
  }
  return (
    achievement.finalScore ??
    achievement.prelimScore ??
    achievement.selfScore ??
    achievement.computedScore ??
    null
  );
}

module.exports = {
  scoreAchievement,
  scoreApplication,
  effectiveScore,
  HEURISTIC_LEVEL_RANK,
  DEFAULT_ORDER_COEF,
  DEFAULT_ORDER_COEF_REST
};
