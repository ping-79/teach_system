(function lessonPlanPage() {
  const form = document.getElementById("lessonPlanForm");
  if (!form) {
    return;
  }

  const fileInput = document.getElementById("teachingFile");
  const submitBtn = document.getElementById("submitBtn");
  const statusBox = document.getElementById("status");
  const jobInfoBox = document.getElementById("jobInfo");
  const downloadArea = document.getElementById("downloadArea");
  const downloadBtn = document.getElementById("downloadBtn");
  const historyList = document.getElementById("historyList");
  const refreshHistoryBtn = document.getElementById("refreshHistoryBtn");

  const CLIENT_ID_KEY = "lesson_plan_client_id";

  let currentBlobUrl = null;
  let currentFileName = "";

  function getClientId() {
    let clientId = window.localStorage.getItem(CLIENT_ID_KEY);
    if (clientId) {
      return clientId;
    }

    clientId = typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : `client_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(CLIENT_ID_KEY, clientId);
    return clientId;
  }

  function buildClientHeaders() {
    return {
      "x-jiaoan-client-id": getClientId()
    };
  }

  function setStatus(message, type) {
    statusBox.textContent = message;
    statusBox.classList.remove("error", "ok");
    if (type) {
      statusBox.classList.add(type);
    }
  }

  function setJobInfo(message) {
    if (!message) {
      jobInfoBox.classList.add("hidden");
      jobInfoBox.textContent = "";
      return;
    }

    jobInfoBox.classList.remove("hidden");
    jobInfoBox.textContent = message;
  }

  function parseDownloadName(contentDisposition) {
    if (!contentDisposition) {
      return null;
    }

    const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      return decodeURIComponent(utf8Match[1]);
    }

    const plainMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
    return plainMatch?.[1] ?? null;
  }

  function toLocalTime(isoText) {
    if (!isoText) {
      return "-";
    }

    const date = new Date(isoText);
    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleString("zh-CN", { hour12: false });
  }

  function clearDownload() {
    downloadArea.classList.add("hidden");
    currentFileName = "";
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }
  }

  function setDownload(blob, fileName) {
    clearDownload();
    currentBlobUrl = URL.createObjectURL(blob);
    currentFileName = fileName;
    downloadArea.classList.remove("hidden");
  }

  async function parseJsonSafe(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  async function listHistory() {
    const response = await fetch("/api/lesson-plan/history?days=30&limit=100", {
      headers: buildClientHeaders()
    });
    const payload = await parseJsonSafe(response);
    if (!response.ok) {
      throw new Error(payload?.msg || `读取历史任务失败（${response.status}）`);
    }
    return payload?.data?.items || [];
  }

  async function downloadHistory(jobId) {
    const response = await fetch(`/api/lesson-plan/history/${encodeURIComponent(jobId)}/download`, {
      headers: buildClientHeaders()
    });
    if (!response.ok) {
      const payload = await parseJsonSafe(response);
      throw new Error(payload?.msg || `下载失败（${response.status}）`);
    }

    const blob = await response.blob();
    const fileName = parseDownloadName(response.headers.get("content-disposition"))
      || `教案合集_${Date.now()}.docx`;
    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(blobUrl);
  }

  async function deleteHistory(jobId) {
    const response = await fetch(`/api/lesson-plan/history/${encodeURIComponent(jobId)}`, {
      method: "DELETE",
      headers: buildClientHeaders()
    });
    const payload = await parseJsonSafe(response);
    if (!response.ok) {
      throw new Error(payload?.msg || `删除失败（${response.status}）`);
    }
  }

  function createActionButton(label, action, jobId, className = "ghost-button") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.dataset.action = action;
    button.dataset.jobId = jobId;
    button.textContent = label;
    return button;
  }

  function renderHistory(items) {
    historyList.innerHTML = "";

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = "近 30 天暂无生成记录。";
      historyList.appendChild(empty);
      return;
    }

    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "history-item";

      const main = document.createElement("div");
      main.className = "history-main";
      main.textContent = `${toLocalTime(item.createdAt)} | ${item.fileName || "-"}`;

      const meta = document.createElement("div");
      meta.className = "history-meta";
      meta.textContent = `源文档：${item.sourceName || "-"} | 教案数：${item.chapterCount || 0}`;

      const actions = document.createElement("div");
      actions.className = "history-actions";

      if (item.downloadReady) {
        actions.appendChild(createActionButton("下载", "download", item.jobId));
      } else {
        const tip = document.createElement("span");
        tip.className = "history-tip";
        tip.textContent = "文件已过期或不可下载";
        actions.appendChild(tip);
      }

      actions.appendChild(createActionButton("删除", "delete", item.jobId, "ghost-button danger-button"));

      row.appendChild(main);
      row.appendChild(meta);
      row.appendChild(actions);
      historyList.appendChild(row);
    });
  }

  async function refreshHistory() {
    try {
      const items = await listHistory();
      renderHistory(items);
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取历史任务失败";
      historyList.innerHTML = `<div class="history-empty">${message}</div>`;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearDownload();
    setJobInfo("");

    const file = fileInput.files?.[0];
    if (!file) {
      setStatus("请先选择一个 docx 文档。", "error");
      return;
    }

    if (!file.name.toLowerCase().endsWith(".docx")) {
      setStatus("当前仅支持上传 docx 文档。", "error");
      return;
    }

    submitBtn.disabled = true;
    setStatus("正在解析文稿并按表格逐行生成教案，这一步可能需要几分钟。");

    try {
      const formData = new FormData();
      formData.append("teachingFile", file);

      const response = await fetch("/api/lesson-plan/generate", {
        method: "POST",
        body: formData,
        headers: buildClientHeaders()
      });

      if (!response.ok) {
        const payload = await parseJsonSafe(response);
        throw new Error(payload?.msg || `生成失败（${response.status}）`);
      }

      const blob = await response.blob();
      const fileName = parseDownloadName(response.headers.get("content-disposition"))
        || `教案合集_${Date.now()}.docx`;
      const chapterCount = response.headers.get("x-jiaoan-chapter-count") || "";
      const jobId = response.headers.get("x-jiaoan-job-id") || "";

      setDownload(blob, fileName);
      setStatus("生成完成，请点击“下载生成结果”。", "ok");
      setJobInfo(
        [
          jobId ? `任务 ID：${jobId}` : "",
          chapterCount ? `教案数：${chapterCount}` : "",
          `结果文件：${fileName}`
        ].filter(Boolean).join(" | ")
      );
      await refreshHistory();
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成失败";
      setStatus(message, "error");
    } finally {
      submitBtn.disabled = false;
    }
  });

  downloadBtn.addEventListener("click", () => {
    if (!currentBlobUrl) {
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = currentBlobUrl;
    anchor.download = currentFileName || `教案合集_${Date.now()}.docx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  });

  historyList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    const { action, jobId } = button.dataset;
    if (!jobId) {
      return;
    }

    button.disabled = true;
    try {
      if (action === "download") {
        await downloadHistory(jobId);
      } else if (action === "delete") {
        await deleteHistory(jobId);
        await refreshHistory();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "操作失败";
      setStatus(message, "error");
    } finally {
      button.disabled = false;
    }
  });

  refreshHistoryBtn.addEventListener("click", refreshHistory);
  refreshHistory();
})();
