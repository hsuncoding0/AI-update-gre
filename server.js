require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");
const marked = require("marked");

const app = express();
const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || null;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const ghAxios = axios.create({
  baseURL: "https://api.github.com",
  headers: GITHUB_TOKEN
    ? { Authorization: `token ${GITHUB_TOKEN}`, "User-Agent": "repo-explorer" }
    : { "User-Agent": "repo-explorer" },
  timeout: 20000,
});

// --- API 狀態測試 ---
app.get("/api/status", (req, res) => {
  res.json({
    status: "ok",
    message: "API is running",
    time: new Date().toISOString(),
  });
});

// --- Repo Tree ---
app.get("/api/tree", async (req, res) => {
  try {
    const { owner, repo, branch } = req.query;
    if (!owner || !repo) {
      return res.status(400).json({ error: "owner and repo required" });
    }
    const ref = branch || "HEAD";
    const treeResp = await ghAxios.get(
      `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`
    );
    res.json({ tree: treeResp.data.tree });
  } catch (err) {
    res
      .status(err.response?.status || 500)
      .json({ error: err.response?.data?.message || err.message });
  }
});

// --- File Viewer ---
app.get("/api/file", async (req, res) => {
  try {
    const { owner, repo, path: filePath, ref } = req.query;
    if (!owner || !repo || !filePath) {
      return res
        .status(400)
        .json({ error: "owner, repo, and file path required" });
    }
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const resp = await ghAxios.get(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}${q}`
    );
    let content =
      resp.data.encoding === "base64"
        ? Buffer.from(resp.data.content, "base64").toString("utf8")
        : resp.data.content;
    res.json({ path: resp.data.path, content });
  } catch (err) {
    res
      .status(err.response?.status || 500)
      .json({ error: err.response?.data?.message || err.message });
  }
});

// --- Download File ---
app.get("/api/download", async (req, res) => {
  try {
    const { owner, repo, path: filePath, ref } = req.query;
    if (!owner || !repo || !filePath) {
      return res
        .status(400)
        .json({ error: "owner, repo, and file path required" });
    }
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const resp = await ghAxios.get(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}${q}`
    );
    const content =
      resp.data.encoding === "base64"
        ? Buffer.from(resp.data.content, "base64")
        : Buffer.from(resp.data.content);

    res.setHeader("Content-Disposition", `attachment; filename=${filePath}`);
    res.send(content);
  } catch (err) {
    res
      .status(err.response?.status || 500)
      .json({ error: err.response?.data?.message || err.message });
  }
});

// --- API Docs (Markdown 渲染) ---
app.get("/api/docs", (req, res) => {
  const docs = `
# GitHub Repo Explorer API Docs

## 狀態檢查
\`GET /api/status\`

回傳 API 運行狀態。

---

## 取得 Repo Tree
\`GET /api/tree?owner={owner}&repo={repo}&branch={branch}\`

範例：
\`\`\`bash
curl "http://localhost:${PORT}/api/tree?owner=torvalds&repo=linux"
\`\`\`

---

## 取得 File 內容
\`GET /api/file?owner={owner}&repo={repo}&path={path}&ref={branch}\`

範例：
\`\`\`bash
curl "http://localhost:${PORT}/api/file?owner=octocat&repo=Hello-World&path=README.md"
\`\`\`

---

## 下載 File
\`GET /api/download?owner={owner}&repo={repo}&path={path}&ref={branch}\`

會回傳檔案下載。

  `;
  res.send(`
    <html>
    <head>
      <title>API Docs</title>
      <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet" />
    </head>
    <body class="p-6 bg-gray-50 text-gray-900">
      <div class="max-w-3xl mx-auto bg-white p-6 shadow-md rounded-lg">
        ${marked(docs)}
      </div>
    </body>
    </html>
  `);
});

// --- 啟動 ---
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
