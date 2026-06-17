const express = require("express");
const multer = require("multer");
const env = require("../config/env");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024
  }
});

function getClientHeaders(req) {
  const clientId = req.get("x-jiaoan-client-id");
  return clientId ? { "x-jiaoan-client-id": clientId } : {};
}

function buildTargetUrl(pathname, searchParams = null) {
  const base = env.lessonPlanBackendUrl.replace(/\/$/, "");
  const url = new URL(`${base}${pathname}`);
  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }
  return url;
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function copyDownloadHeaders(response, res) {
  const contentType = response.headers.get("content-type");
  const contentDisposition = response.headers.get("content-disposition");
  const chapterCount = response.headers.get("x-jiaoan-chapter-count");
  const jobId = response.headers.get("x-jiaoan-job-id");

  if (contentType) {
    res.setHeader("Content-Type", contentType);
  }
  if (contentDisposition) {
    res.setHeader("Content-Disposition", contentDisposition);
  }
  if (chapterCount) {
    res.setHeader("x-jiaoan-chapter-count", chapterCount);
  }
  if (jobId) {
    res.setHeader("x-jiaoan-job-id", jobId);
  }
}

async function sendJsonProxy(response, res) {
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "application/json; charset=utf-8";
  res.status(response.status);
  res.setHeader("Content-Type", contentType);
  return res.send(text);
}

function handleProxyError(error, res, fallbackMessage) {
  if (error?.name === "AbortError") {
    return res.status(504).json({ msg: "教案服务响应超时，请稍后重试。" });
  }

  return res.status(502).json({
    msg: fallbackMessage || "当前无法连接教案服务。"
  });
}

router.get("/api/lesson-plan/sample-docx", requireAuth, async (req, res) => {
  try {
    const response = await fetchWithTimeout(
      buildTargetUrl("/api/jiaoan/sample-docx"),
      {
        headers: getClientHeaders(req)
      },
      30000
    );

    const buffer = Buffer.from(await response.arrayBuffer());
    copyDownloadHeaders(response, res);
    res.status(response.status);
    return res.send(buffer);
  } catch (error) {
    return handleProxyError(error, res, "当前无法下载教案模板。");
  }
});

router.post("/api/lesson-plan/generate", requireAuth, upload.single("teachingFile"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ msg: "请先上传 docx 教学文稿。" });
  }

  try {
    const formData = new FormData();
    formData.append(
      "teachingFile",
      new Blob([req.file.buffer], { type: req.file.mimetype || "application/octet-stream" }),
      req.file.originalname
    );

    const response = await fetchWithTimeout(
      buildTargetUrl("/api/jiaoan/generate"),
      {
        method: "POST",
        headers: getClientHeaders(req),
        body: formData
      },
      10 * 60 * 1000
    );

    const buffer = Buffer.from(await response.arrayBuffer());
    copyDownloadHeaders(response, res);
    res.status(response.status);
    return res.send(buffer);
  } catch (error) {
    return handleProxyError(error, res, "教案生成失败，请稍后重试。");
  }
});

router.get("/api/lesson-plan/history", requireAuth, async (req, res) => {
  try {
    const response = await fetchWithTimeout(
      buildTargetUrl("/api/jiaoan/history", {
        days: req.query.days,
        limit: req.query.limit
      }),
      {
        headers: getClientHeaders(req)
      },
      30000
    );

    return sendJsonProxy(response, res);
  } catch (error) {
    return handleProxyError(error, res, "当前无法读取教案历史任务。");
  }
});

router.get("/api/lesson-plan/history/:jobId/download", requireAuth, async (req, res) => {
  try {
    const response = await fetchWithTimeout(
      buildTargetUrl(`/api/jiaoan/history/${encodeURIComponent(req.params.jobId)}/download`),
      {
        headers: getClientHeaders(req)
      },
      30000
    );

    const buffer = Buffer.from(await response.arrayBuffer());
    copyDownloadHeaders(response, res);
    res.status(response.status);
    return res.send(buffer);
  } catch (error) {
    return handleProxyError(error, res, "当前无法下载教案结果。");
  }
});

router.delete("/api/lesson-plan/history/:jobId", requireAuth, async (req, res) => {
  try {
    const response = await fetchWithTimeout(
      buildTargetUrl(`/api/jiaoan/history/${encodeURIComponent(req.params.jobId)}`),
      {
        method: "DELETE",
        headers: getClientHeaders(req)
      },
      30000
    );

    return sendJsonProxy(response, res);
  } catch (error) {
    return handleProxyError(error, res, "当前无法删除教案历史任务。");
  }
});

module.exports = router;
