/**
 * OCR 文字提取（可插拔 provider，带降级）
 *
 * 流程定位：上传扫描件 → 本服务取出文本 → achievement-ai.js 结构化字段 → 老师确认。
 *
 * 文件分流：
 *   .docx / .xlsx / .txt  → 复用 content-parser.extractTextFromFile（无需 OCR）
 *   图片 / .pdf            → 调用云 OCR provider（若已配置）；未配置则 SKIPPED → 老师手填
 *
 * 隐私：扫描件可能含个人信息，外发云端前应在部署文档中告知；
 *       不想出本机者，将 OCR_PROVIDER 留空即可（始终保留原扫描件作佐证）。
 */
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const env = require("../config/env");
const { extractTextFromFile } = require("./content-parser");

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tiff", ".tif"]);
const TEXT_EXTS = new Set([".docx", ".xlsx", ".xls", ".txt"]);

function isImage(ext) {
  return IMAGE_EXTS.has(ext);
}

/**
 * 从佐证文件提取文本。
 * @returns {{ status:'SUCCESS'|'SKIPPED'|'FAILED', text:string, message?:string }}
 */
async function extractEvidenceText(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (TEXT_EXTS.has(ext)) {
    try {
      const text = await extractTextFromFile(filePath);
      return { status: "SUCCESS", text: text || "" };
    } catch (error) {
      return { status: "FAILED", text: "", message: error.message };
    }
  }

  if (isImage(ext) || ext === ".pdf") {
    if (!env.ocrProvider) {
      return {
        status: "SKIPPED",
        text: "",
        message: "未配置 OCR，扫描件请手动填写（原件已留存为佐证）。"
      };
    }
    try {
      const text = await runProviderOcr(filePath);
      return { status: text ? "SUCCESS" : "FAILED", text: text || "" };
    } catch (error) {
      return { status: "FAILED", text: "", message: error.message };
    }
  }

  return { status: "SKIPPED", text: "", message: `暂不支持的文件类型：${ext}` };
}

async function runProviderOcr(filePath) {
  const buffer = fs.readFileSync(filePath);
  const base64 = buffer.toString("base64");

  switch (env.ocrProvider) {
    case "custom":
      return ocrViaCustomEndpoint(base64);
    case "baidu":
      return ocrViaBaidu(base64);
    // tencent / ali 留待按各自签名规则补充；当前返回降级提示
    case "tencent":
    case "ali":
      throw new Error(`OCR provider "${env.ocrProvider}" 尚未在本机实现，请改用 custom 端点或手填。`);
    default:
      throw new Error(`未知 OCR provider：${env.ocrProvider}`);
  }
}

/**
 * 自建/代理端点：POST { imageBase64 } → { text }
 * 便于把内网/本地 PaddleOCR 服务包一层后接入，敏感件不出内网。
 */
async function ocrViaCustomEndpoint(base64) {
  if (!env.ocrEndpoint) {
    throw new Error("OCR_PROVIDER=custom 时需配置 OCR_ENDPOINT。");
  }
  const response = await axios.post(
    env.ocrEndpoint,
    { imageBase64: base64 },
    {
      headers: env.ocrApiKey ? { Authorization: `Bearer ${env.ocrApiKey}` } : {},
      timeout: 60000
    }
  );
  return response.data?.text || response.data?.result || "";
}

/**
 * 百度通用文字识别（高精度版）。
 * 需先用 API Key / Secret Key 换 access_token。
 */
async function ocrViaBaidu(base64) {
  if (!env.ocrApiKey || !env.ocrApiSecret) {
    throw new Error("百度 OCR 需配置 OCR_API_KEY 与 OCR_API_SECRET。");
  }
  const tokenResp = await axios.post(
    "https://aip.baidubce.com/oauth/2.0/token",
    null,
    {
      params: {
        grant_type: "client_credentials",
        client_id: env.ocrApiKey,
        client_secret: env.ocrApiSecret
      },
      timeout: 30000
    }
  );
  const accessToken = tokenResp.data?.access_token;
  if (!accessToken) {
    throw new Error("百度 OCR 获取 access_token 失败。");
  }

  const ocrResp = await axios.post(
    `https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic?access_token=${accessToken}`,
    new URLSearchParams({ image: base64 }).toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 60000
    }
  );

  const words = ocrResp.data?.words_result || [];
  return words.map((w) => w.words).join("\n");
}

function isOcrConfigured() {
  return Boolean(env.ocrProvider);
}

module.exports = {
  extractEvidenceText,
  isOcrConfigured,
  IMAGE_EXTS,
  TEXT_EXTS
};
