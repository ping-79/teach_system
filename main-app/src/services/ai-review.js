const { createChatCompletion, extractJsonContent } = require("./deepseek");

async function reviewTeachingPlan({ offering, planDocument }) {
  const fallback = buildFallbackReview(planDocument);

  try {
    const response = await createChatCompletion({
      systemPrompt: "你是高校教学计划审查助手。请只输出 JSON，对象字段包含 summary 和 findings。findings 为字符串数组，指出潜在风险或建议；如果没有明显问题也要返回空数组。",
      userPrompt: `请审查以下教学计划是否存在明显问题。\n课程：${offering.courseName}\n班级：${offering.className}\n总学时：${planDocument.totalHours || 0}\n理论学时：${planDocument.theoryHours || 0}\n实践学时：${planDocument.practiceHours || 0}\n明细：${JSON.stringify(planDocument.rows.slice(0, 45))}`
    });

    if (!response) {
      return fallback;
    }

    const parsed = extractJsonContent(response);
    return {
      source: "deepseek",
      summary: parsed.summary || "已完成 AI 校验。",
      findings: Array.isArray(parsed.findings) ? parsed.findings : []
    };
  } catch (error) {
    return fallback;
  }
}

function buildFallbackReview(planDocument) {
  const findings = [];
  const rows = (planDocument.rows || []).filter((row) => row.weekIndex || row.topicText || row.hours);

  if (!rows.some((row) => row.topicText)) {
    findings.push("当前计划只有时间安排，尚未补充教学内容。");
  }

  const practiceRows = rows.filter((row) => Number(row.practiceHours || 0) > 0);
  const theoryRows = rows.filter((row) => Number(row.theoryHours || 0) > 0);

  if (practiceRows.length && !theoryRows.length) {
    findings.push("当前课程全部为实践行，请确认是否符合课程性质。");
  }

  if (rows.length > 0 && rows.filter((row) => !row.topicText).length > Math.ceil(rows.length / 2)) {
    findings.push("超过一半的明细行仍为空白主题，建议补充后再导出。");
  }

  return {
    source: "heuristic",
    summary: "已完成规则校验，当前未使用 DeepSeek 或模型返回异常。",
    findings
  };
}

module.exports = {
  reviewTeachingPlan
};
