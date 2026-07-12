// cnki-PDF-download
// Features: PDF Download | Abstract Hover | Batch Download

const SELECTORS = {
  articleLinks: [
    "#gridTable > div > div > div > table > tbody > tr > td.name > a.fz14",
    "#gridTable > div > div > div > table > tbody > tr > td.name > div > a.fz14",
    ".result-table-list tbody tr td.name a",
  ],
  pagesDiv: "#briefBox > div:nth-child(2) > div > div.pages",
};

// ========== Utility Functions ==========

// Get all visible article links
function getArticleLinks() {
  return document.querySelectorAll(SELECTORS.articleLinks);
}

// ========== Single PDF Download ==========

async function addPdfDownloadButtons() {
  const articleLinks = getArticleLinks();

  for (const link of articleLinks) {
    const row = link.closest("tr");
    if (!row || row.querySelector(".pdf-download-btn")) continue;

    const downloadBtn = document.createElement("button");
    downloadBtn.className = "pdf-download-btn";
    downloadBtn.textContent = "下载";

    const nameCell = row.querySelector("td.name");
    if (!nameCell) continue;

    const container = document.createElement("div");
    Object.assign(container.style, {
      display: "flex",
      alignItems: "center",
      flexWrap: "wrap",
    });

    const titleLink = nameCell.querySelector("a");
    if (titleLink) {
      Object.assign(titleLink.style, {
        textAlign: "left",
        whiteSpace: "normal",
        wordBreak: "break-word",
        display: "inline",
        flex: "1",
        minWidth: "0",
        fontSize: "14px",
        lineHeight: "1.2",
      });
    }

    nameCell.innerHTML = "";
    container.appendChild(downloadBtn);
    if (titleLink) {
      container.appendChild(titleLink);
    }
    nameCell.appendChild(container);

    downloadBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      downloadBtn.textContent = "获取中";
      downloadBtn.disabled = true;

      try {
        const pdfUrl = await fetchPdfUrl(link.href, row);
        if (pdfUrl) {
          downloadBtn.textContent = "下载中";
          const result = await downloadPdf(pdfUrl);

          if (result?.downloadId) {
            await monitorDownload(result.downloadId, downloadBtn);
          } else if (result?.skipped) {
            downloadBtn.textContent = "已下载";
            downloadBtn.style.backgroundColor = "#28a745";
          } else {
            downloadBtn.textContent = "已下载";
            downloadBtn.style.backgroundColor = "#28a745";
          }
        } else {
          downloadBtn.textContent = "失败";
          downloadBtn.style.backgroundColor = "#dc3545";
        }
      } catch (error) {
        console.error("[cnki-PDF-download] Failed to fetch PDF URL:", error);
        downloadBtn.textContent = "失败";
        downloadBtn.style.backgroundColor = "#dc3545";
      }
    });
  }
}

// Download PDF via background.js
function downloadPdf(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: "download", url, filename },
      (response) => {
        if (chrome.runtime.lastError) {
          const link = document.createElement("a");
          link.href = url;
          link.download = filename || "";
          link.style.display = "none";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          resolve({ fallback: true });
          return;
        }
        if (response?.error) {
          const link = document.createElement("a");
          link.href = url;
          link.download = filename || "";
          link.style.display = "none";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          resolve({ fallback: true });
        } else if (response?.skipped) {
          resolve({ skipped: true });
        } else {
          resolve({ downloadId: response.downloadId });
        }
      },
    );
  });
}

// Monitor download progress
function monitorDownload(downloadId, buttonElement) {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      chrome.downloads.search({ id: downloadId }, (downloads) => {
        if (downloads.length === 0) {
          clearInterval(interval);
          resolve();
          return;
        }

        const download = downloads[0];
        if (download.state === "complete") {
          buttonElement.textContent = "已下载";
          buttonElement.style.backgroundColor = "#28a745";
          clearInterval(interval);
          resolve();
        } else if (download.state === "interrupted") {
          buttonElement.textContent = "失败";
          buttonElement.style.backgroundColor = "#dc3545";
          clearInterval(interval);
          resolve();
        } else if (download.totalBytes > 0) {
          const percent = Math.round(
            (download.bytesReceived / download.totalBytes) * 100,
          );
          buttonElement.textContent = `${percent}%`;
        }
      });
    }, 200);
  });
}

// Fetch PDF/DOI/source URL from article page
async function fetchPdfUrl(articleUrl, row) {
  try {
    const response = await fetch(articleUrl, { credentials: "include" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const text = await response.text();
    const doc = new DOMParser().parseFromString(text, "text/html");

    const doiLink = doc.querySelector(
      'a[href*="doi.org"], a[href*="dx.doi.org"]',
    );
    if (doiLink?.href) {
      try {
        const url = new URL(doiLink.href);
        if (url.protocol === "http:" || url.protocol === "https:")
          return url.href;
      } catch {}
    }

    const sourceLinks = doc.querySelectorAll(
      ".detail_doc-database-content__3nYOl .detail_doc-database-link__7ovGD a",
    );
    for (const sl of sourceLinks) {
      if (!sl?.href) continue;
      try {
        const url = new URL(sl.href.trim().replace(/^`|`$/g, ""), articleUrl);
        if (url.protocol === "http:" || url.protocol === "https:")
          return url.href;
      } catch {}
    }

    const isThesis =
      row?.querySelector('img[src*="thesis"]') || articleUrl.includes("CDMD");

    if (isThesis) {
      const thesisLink = doc.querySelector(".btn-dlcaj, .btn-dlpdf");
      if (thesisLink?.href) {
        try {
          const url = new URL(thesisLink.href, articleUrl);
          if (url.protocol === "http:" || url.protocol === "https:")
            return url.href;
        } catch {}
      }
    } else {
      const downloadBtns = doc.querySelectorAll("#pdfDown, #cajDown");
      let pdfLink = null,
        cajLink = null;
      for (const btn of downloadBtns) {
        if (!btn?.href) continue;
        try {
          const url = new URL(btn.href, articleUrl);
          if (url.protocol !== "http:" && url.protocol !== "https:") continue;
          const text = (btn.textContent || "").trim().toLowerCase();
          if (text.includes("pdf") && !pdfLink) pdfLink = url.href;
          else if (text.includes("caj") && !cajLink) cajLink = url.href;
        } catch {}
      }
      if (pdfLink) return pdfLink;
      if (cajLink) return cajLink;
    }

    return null;
  } catch (error) {
    console.error(
      `[cnki-PDF-download] fetchPdfUrl failed (${articleUrl}):`,
      error,
    );
    return null;
  }
}

// ========== Abstract Hover Preview ==========

async function addHoverForAbstracts() {
  const articleLinks = getArticleLinks();

  for (const link of articleLinks) {
    if (link.dataset.abstractAdded) continue;
    link.dataset.abstractAdded = true;

    const tooltip = document.createElement("div");
    tooltip.className = "cnki-abstract-tooltip";
    document.body.appendChild(tooltip);

    link.addEventListener("mouseenter", async () => {
      tooltip.style.display = "block";
      tooltip.textContent = "正在加载摘要...";
      positionTooltip(tooltip, link);

      try {
        const abstract = await fetchAbstract(link.href);

        if (!abstract) {
          tooltip.innerHTML = '<span style="color:#999">暂无摘要</span>';
          positionTooltip(tooltip, link);
          return;
        }

        const keywords = await fetchKeywords(link.href);
        let content = abstract;
        if (keywords) {
          content += `<br><strong>关键词：</strong>${keywords.replace(/^关键词[\uff1a:]*/, "")}`;
        }

        tooltip.innerHTML = content;
        positionTooltip(tooltip, link);
      } catch {
        tooltip.innerHTML = '<span style="color:red">加载摘要失败</span>';
      }
    });

    link.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
    });

    tooltip.addEventListener("mouseenter", () => {
      tooltip.dataset.hovering = "true";
    });
    tooltip.addEventListener("mouseleave", () => {
      tooltip.dataset.hovering = "false";
      tooltip.style.display = "none";
    });
  }
}

function positionTooltip(tooltip, anchor) {
  const rect = anchor.getBoundingClientRect();
  const vw = window.innerWidth,
    vh = window.innerHeight;
  const tr = tooltip.getBoundingClientRect();

  let left = rect.right + 10;
  if (left + tr.width > vw - 20) {
    left = rect.left - tr.width - 10;
    if (left < 20) left = Math.max(20, (vw - tr.width) / 2);
  }

  let top = rect.top;
  if (top + tr.height > vh - 20) top = Math.max(20, vh - tr.height - 20);

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

async function fetchAbstract(articleUrl) {
  const response = await fetch(articleUrl, { credentials: "include" });
  if (!response.ok) throw new Error("Network error");
  const doc = new DOMParser().parseFromString(
    await response.text(),
    "text/html",
  );
  const el = doc.querySelector("#ChDivSummary");
  return el ? el.textContent.trim() : null;
}

async function fetchKeywords(articleUrl) {
  const response = await fetch(articleUrl, { credentials: "include" });
  if (!response.ok) throw new Error("Network error");
  const doc = new DOMParser().parseFromString(
    await response.text(),
    "text/html",
  );
  const el = doc.querySelector(".keywords");
  if (el) {
    return el.textContent.trim();
  }
  const kwSpan = doc.querySelector("span:contains('关键词')");
  if (kwSpan) {
    return kwSpan.textContent.trim();
  }
  return null;
}

// ========== Batch Download ==========

// Batch Download Manager: checkbox selection / pause/resume / cancel / status tracking / captcha detection / adjustable delay
class BatchDownloadManager {
  constructor() {
    this.panel = null;
    this.itemList = null;
    this.statsEl = null;
    this.progressFill = null;
    this.startBtn = null;
    this.pauseBtn = null;
    this.cancelBtn = null;
    this.selectAllCb = null;
    this.countEl = null;
    this.delayInput = null;

    this.tasks = [];
    this.running = false;
    this.paused = false;
    this.cancelled = false;
    this.currentAbort = null;

    this._initPanel();
    this._bindEvents();
  }

  // Initialize panel UI
  _initPanel() {
    this.backdrop = document.createElement("div");
    this.backdrop.className = "batch-backdrop hidden";
    document.body.appendChild(this.backdrop);

    this.panel = document.createElement("div");
    this.panel.className = "batch-panel hidden";
    this.panel.innerHTML = `
      <div class="batch-panel-header">
        <span>📥 批量下载</span>
        <button class="batch-panel-close" title="关闭">&times;</button>
      </div>
      <div class="batch-panel-controls">
        <label><input type="checkbox" class="cnki-row-checkbox batch-select-all" checked /> 全选</label>
        <span class="batch-count">已选 0 项</span>
        <button class="batch-btn batch-btn-primary batch-start-btn">开始下载</button>
        <button class="batch-btn batch-btn-warning batch-pause-btn" style="display:none">暂停</button>
        <button class="batch-btn batch-btn-danger batch-cancel-btn" style="display:none">取消</button>
        <div class="batch-delay-control">
          延迟 <input type="number" class="batch-delay-input" value="8" min="3" max="30" /> 秒
        </div>
      </div>
      <div class="batch-progress-bar"><div class="batch-progress-fill" style="width:0%"></div></div>
      <div class="batch-panel-stats">
        <span class="batch-stats-text">等待开始</span>
        <span class="batch-stats-detail"></span>
      </div>
      <div class="batch-item-list"></div>
    `;
    document.body.appendChild(this.panel);

    this.selectAllCb = this.panel.querySelector(".batch-select-all");
    this.countEl = this.panel.querySelector(".batch-count");
    this.startBtn = this.panel.querySelector(".batch-start-btn");
    this.pauseBtn = this.panel.querySelector(".batch-pause-btn");
    this.cancelBtn = this.panel.querySelector(".batch-cancel-btn");
    this.delayInput = this.panel.querySelector(".batch-delay-input");
    this.progressFill = this.panel.querySelector(".batch-progress-fill");
    this.statsEl = this.panel.querySelector(".batch-stats-text");
    this.statsDetail = this.panel.querySelector(".batch-stats-detail");
    this.itemList = this.panel.querySelector(".batch-item-list");

    this.panel
      .querySelector(".batch-panel-close")
      .addEventListener("click", () => this.hide());
  }

  // Bind events
  _bindEvents() {
    this.selectAllCb.addEventListener("change", () => {
      const checked = this.selectAllCb.checked;
      this.tasks.forEach((t) => {
        t.checkbox.checked = checked;
      });
      this._updateCount();
    });

    this.startBtn.addEventListener("click", () => this._startDownload());
    this.pauseBtn.addEventListener("click", () => this._togglePause());
    this.cancelBtn.addEventListener("click", () => this._cancel());

    this.backdrop.addEventListener("click", () => this.hide());
    this.panel
      .querySelector(".batch-panel-close")
      .addEventListener("click", () => this.hide());
  }

  // Show panel and scan articles
  show() {
    this._scanArticles();
    this.backdrop.classList.remove("hidden");
    this.panel.classList.remove("hidden");
  }

  hide() {
    if (this.running) {
      if (!confirm("正在下载中，确定要关闭吗？")) return;
      this._cancel();
    }
    this.backdrop.classList.add("hidden");
    this.panel.classList.add("hidden");
    this._removeCheckboxes();
  }

  // Scan current page articles
  _scanArticles() {
    this.tasks = [];
    this.itemList.innerHTML = "";

    const links = getArticleLinks();
    links.forEach((link, index) => {
      const row = link.closest("tr");
      if (!row) return;

      const title = link.textContent.trim().substring(0, 50);
      const num = index + 1;

      const itemEl = document.createElement("div");
      itemEl.className = "batch-item";
      itemEl.innerHTML = `
        <input type="checkbox" class="cnki-row-checkbox batch-item-checkbox" checked />
        <span class="batch-item-num">${num}</span>
        <span class="batch-item-title" title="${title}">${title}</span>
        <span class="batch-item-status pending">等待</span>
      `;

      const cbEl = itemEl.querySelector(".batch-item-checkbox");
      cbEl.addEventListener("change", () => this._updateCount());

      const task = {
        link,
        row,
        title,
        checkbox: cbEl,
        status: "pending",
        statusEl: itemEl.querySelector(".batch-item-status"),
        itemEl: itemEl,
      };

      this.itemList.appendChild(itemEl);
      this.tasks.push(task);
    });

    this._updateCount();
  }

  // Remove checkboxes from webpage (keep panel checkboxes)
  _removeCheckboxes() {
    document
      .querySelectorAll(".cnki-row-checkbox:not(.batch-item-checkbox)")
      .forEach((cb) => {
        if (!cb.classList.contains("batch-select-all")) cb.remove();
      });
  }

  // Update selected count
  _updateCount() {
    const selected = this.tasks.filter((t) => t.checkbox.checked).length;
    this.countEl.textContent = `已选 ${selected}/${this.tasks.length} 项`;
    this.startBtn.disabled = selected === 0;
  }

  // Get selected tasks
  _getSelected() {
    return this.tasks.filter(
      (t) => t.checkbox.checked && t.status === "pending",
    );
  }

  // Update single task status
  _setTaskStatus(task, status, detail) {
    task.status = status;
    const icons = {
      pending: "⬜",
      downloading: "⏳",
      success: "✅",
      failed: "❌",
      captcha: "🚫",
    };
    const labels = {
      pending: "Pending",
      downloading: "Downloading",
      success: "Success",
      failed: "Failed",
      captcha: "Captcha",
    };
    task.iconEl.textContent = icons[status] || "⬜";
    task.statusEl.textContent = detail || labels[status];
    task.statusEl.className = `batch-item-status ${status}`;
    this._updateProgress();
  }

  // Update progress bar and statistics
  _updateProgress() {
    const total = this.tasks.filter((t) => t.checkbox.checked).length;
    if (total === 0) return;

    const done = this.tasks.filter(
      (t) =>
        t.checkbox.checked &&
        ["success", "failed", "captcha"].includes(t.status),
    ).length;
    const success = this.tasks.filter((t) => t.status === "success").length;
    const failed = this.tasks.filter((t) => t.status === "failed").length;
    const captcha = this.tasks.filter((t) => t.status === "captcha").length;

    const pct = Math.round((done / total) * 100);
    this.progressFill.style.width = `${pct}%`;
    this.progressFill.className =
      "batch-progress-fill" +
      (this.paused ? " paused" : "") +
      (failed > success && done > 0 ? " error" : "");

    this.statsEl.textContent = this.paused
      ? "⏸ 已暂停"
      : this.cancelled
        ? "⏹ 已取消"
        : `${pct}% 完成`;
    let detail = `✅${success}`;
    if (failed > 0) detail += ` ❌${failed}`;
    if (captcha > 0) detail += ` 🚫${captcha}`;
    this.statsDetail.textContent = detail;
  }

  // Start download
  async _startDownload() {
    const selected = this._getSelected();
    if (selected.length === 0) return;

    this.running = true;
    this.paused = false;
    this.cancelled = false;
    this.currentAbort = null;

    this.startBtn.style.display = "none";
    this.pauseBtn.style.display = "";
    this.cancelBtn.style.display = "";
    this.selectAllCb.disabled = true;
    this.delayInput.disabled = true;
    this.tasks.forEach((t) => {
      t.checkbox.disabled = true;
    });

    const baseDelay = parseInt(this.delayInput.value) || 8;
    let successCount = 0;
    let failCount = 0;

    for (const task of selected) {
      if (this.cancelled) break;

      while (this.paused && !this.cancelled) {
        await new Promise((r) => setTimeout(r, 500));
      }
      if (this.cancelled) break;

      this._setTaskStatus(task, "downloading");
      task.itemEl.scrollIntoView({ behavior: "smooth", block: "nearest" });

      try {
        const pdfUrl = await fetchPdfUrl(task.link.href, task.row);

        if (this.cancelled) break;

        if (pdfUrl) {
          if (pdfUrl.toLowerCase().includes("checkcode")) {
            this._setTaskStatus(task, "captcha", "Requires verification");
            this.paused = true;
            this.pauseBtn.textContent = "Resume";
            this._updateProgress();
            alert(
              '⚠️ Captcha detected, please complete verification manually and click "Resume"',
            );
            while (this.paused && !this.cancelled) {
              await new Promise((r) => setTimeout(r, 500));
            }
            if (this.cancelled) break;
            continue;
          }

          const result = await downloadPdf(pdfUrl);
          if (result?.skipped) {
            this._setTaskStatus(task, "success", "Already exists");
          } else {
            this._setTaskStatus(task, "success");
          }
          successCount++;
        } else {
          this._setTaskStatus(task, "failed", "无下载链接");
          failCount++;
        }
      } catch (error) {
        if (this.cancelled) break;
        this._setTaskStatus(task, "failed", error.message.substring(0, 20));
        failCount++;
      }

      if (failCount >= 3 && successCount === 0) {
        this.paused = true;
        this.pauseBtn.textContent = "继续";
        this._updateProgress();
        alert('⚠️ 检测到连续失败，请稍后重试并点击"继续"');
        failCount = 0;
        while (this.paused && !this.cancelled) {
          await new Promise((r) => setTimeout(r, 500));
        }
        if (this.cancelled) break;
      }

      if (!this.cancelled) {
        const delay = baseDelay * 1000 * (0.7 + Math.random() * 0.6);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    this.running = false;
    this.startBtn.style.display = "";
    this.pauseBtn.style.display = "none";
    this.cancelBtn.style.display = "none";
    this.selectAllCb.disabled = false;
    this.delayInput.disabled = false;
    this.tasks.forEach((t) => {
      t.checkbox.disabled = false;
    });

    if (!this.cancelled) {
      this.startBtn.textContent = "重新下载";
      this.statsEl.textContent = "✅ 全部完成";
    }
  }

  // 暂停/继续
  _togglePause() {
    this.paused = !this.paused;
    this.pauseBtn.textContent = this.paused ? "继续" : "暂停";
    this._updateProgress();
  }

  // 取消
  _cancel() {
    this.cancelled = true;
    this.paused = false;
    this.running = false;

    this.startBtn.style.display = "";
    this.pauseBtn.style.display = "none";
    this.cancelBtn.style.display = "none";
    this.selectAllCb.disabled = false;
    this.delayInput.disabled = false;
    this.tasks.forEach((t) => {
      t.checkbox.disabled = false;
      if (t.status === "downloading")
        this._setTaskStatus(t, "failed", "已取消");
    });
    this.startBtn.textContent = "重新下载";
    this._updateProgress();
  }
}

let batchManager = null;

function addDownloadAllButton() {
  const pagesDiv = document.querySelector(SELECTORS.pagesDiv);
  if (!pagesDiv || pagesDiv.querySelector(".download-all-btn")) return;

  const btn = document.createElement("button");
  btn.className = "download-all-btn";
  btn.textContent = "📥 批量下载";
  pagesDiv.appendChild(btn);

  btn.addEventListener("click", () => {
    if (!batchManager) batchManager = new BatchDownloadManager();
    batchManager.show();
  });
}

// ========== Initialization ==========

document.addEventListener("DOMContentLoaded", () => {
  if (!window.location.hostname.includes("cnki.net")) return;

  const style = document.createElement("style");
  style.textContent = `
    #gridTable table, #gridTable th, #gridTable td,
    .result-table-list table, .result-table-list th, .result-table-list td {
      text-align: left !important;
    }
  `;
  document.head.appendChild(style);

  addPdfDownloadButtons();
  addHoverForAbstracts();
  addDownloadAllButton();
});

let processing = false;
const observer = new MutationObserver((mutations) => {
  if (processing) return;
  processing = true;
  setTimeout(() => {
    if (mutations.some((m) => m.addedNodes.length > 0)) {
      addPdfDownloadButtons();
      addHoverForAbstracts();
      addDownloadAllButton();
    }
    processing = false;
  }, 500);
});

observer.observe(document.body, { childList: true, subtree: true });

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "downloadStateChanged") {
    console.log(
      `[cnki-PDF-download] Download ${msg.downloadId} state: ${msg.state}`,
    );
  }
});
