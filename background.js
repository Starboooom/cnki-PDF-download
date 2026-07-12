// cnki-PDF-download background script - Handle cross-domain requests and file downloads
chrome.runtime.onInstalled.addListener(() => {
  console.log("[cnki-PDF-download] Extension installed/updated");
});

// Download history to avoid duplicate downloads
const downloadHistory = new Set();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.url) {
    const maxRetries = request.retry || 3;
    let attempts = 0;

    function attemptFetch() {
      attempts++;
      console.log(`[cnki-PDF-download] Attempt ${attempts}: ${request.url}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      fetch(request.url, { signal: controller.signal })
        .then((response) => {
          clearTimeout(timeoutId);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          return response.json();
        })
        .then((data) => {
          console.log(
            `[cnki-PDF-download] Data fetched successfully, ${data.length} items`,
          );
          sendResponse({ data });
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          console.error(
            `[cnki-PDF-download] Attempt ${attempts} failed:`,
            error.message,
          );
          if (attempts < maxRetries) {
            setTimeout(attemptFetch, 1000);
          } else {
            sendResponse({
              error: `${attempts} attempts failed: ${error.message}`,
            });
          }
        });
    }

    attemptFetch();
    return true;
  }

  if (request.action === "download") {
    const { url, filename } = request;

    if (downloadHistory.has(url)) {
      sendResponse({ skipped: true, reason: "Already downloaded" });
      return true;
    }

    chrome.downloads.download(
      {
        url: url,
        filename: filename || undefined,
        conflictAction: "uniquify",
        saveAs: false,
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error(
            "[cnki-PDF-download] Download failed:",
            chrome.runtime.lastError.message,
          );
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          downloadHistory.add(url);
          console.log("[cnki-PDF-download] Download started, ID:", downloadId);
          sendResponse({ downloadId });
        }
      },
    );
    return true;
  }

  if (request.action === "clearDownloadHistory") {
    downloadHistory.clear();
    sendResponse({ ok: true });
    return true;
  }
});

// Listen for download state changes and notify content script
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state) {
    chrome.tabs.query({ url: "*://*.cnki.net/*" }, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs
          .sendMessage(tab.id, {
            action: "downloadStateChanged",
            downloadId: delta.id,
            state: delta.state.current,
          })
          .catch(() => {});
      });
    });
  }
});
