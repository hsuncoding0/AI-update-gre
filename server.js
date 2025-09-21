require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || null;

const ghAxios = axios.create({
  baseURL: 'https://api.github.com',
  headers: GITHUB_TOKEN
    ? { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'github-repo-explorer' }
    : { 'User-Agent': 'github-repo-explorer' },
  timeout: 15000,
});

// Helper: fetch recursive tree
app.get('/api/tree', async (req, res) => {
  try {
    const { owner, repo, branch } = req.query;
    if (!owner || !repo) return res.status(400).json({ error: 'owner and repo are required' });
    const ref = branch || 'HEAD';

    // First get the branch/commitish: get the ref from repo to find the tree sha
    // Easiest: call the /git/trees/{branch}?recursive=1 where branch can be a branch name or sha
    const treeResp = await ghAxios.get(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);

    // treeResp.data.tree is an array of objects with path, mode, type (blob/tree), sha, size
    const tree = treeResp.data.tree;

    res.json({ tree });
  } catch (err) {
    // handle when ref isn't a tree directly (some repos require using branch's commit)
    if (err.response && err.response.status === 422) {
      // try to resolve branch to commit sha then get tree
      try {
        const { owner, repo, branch } = req.query;
        const branchName = branch || 'main';
        const branchResp = await ghAxios.get(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branchName)}`);
        const commitSha = branchResp.data.commit.sha;
        const treeResp = await ghAxios.get(`/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`);
        return res.json({ tree: treeResp.data.tree });
      } catch (e2) {
        return res.status(500).json({ error: 'failed to fetch tree', details: e2.message });
      }
    }

    const status = err.response ? err.response.status : 500;
    const message = err.response && err.response.data ? err.response.data.message : err.message;
    res.status(status).json({ error: message });
  }
});

// Fetch file contents (base64 from GitHub contents API)
app.get('/api/file', async (req, res) => {
  try {
    const { owner, repo, path: filePath, ref } = req.query;
    if (!owner || !repo || !filePath) return res.status(400).json({ error: 'owner, repo and path are required' });

    const q = [];
    if (ref) q.push(`ref=${encodeURIComponent(ref)}`);
    const qstr = q.length ? `?${q.join('&')}` : '';

    const resp = await ghAxios.get(`/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}${qstr}`);
    // resp.data.content is base64 (may be chunked), encoding indicates base64
    const contentBase64 = resp.data.content || '';
    const encoding = resp.data.encoding || 'base64';
    let content = null;
    if (encoding === 'base64') {
      content = Buffer.from(contentBase64, 'base64').toString('utf8');
    } else {
      content = contentBase64;
    }

    res.json({ path: resp.data.path, content, size: resp.data.size });
  } catch (err) {
    const status = err.response ? err.response.status : 500;
    const message = err.response && err.response.data ? err.response.data.message : err.message;
    res.status(status).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
