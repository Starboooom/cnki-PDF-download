// download-worker.js - Handle batch download tasks
self.onmessage = async function (e) {
  const pdfUrls = e.data;
  for (const pdfUrl of pdfUrls) {
    try {
      self.postMessage(pdfUrl);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error("Error downloading PDF:", error);
    }
  }
};
