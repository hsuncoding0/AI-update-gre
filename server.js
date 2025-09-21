require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const cors = require('cors');
const LRU = require('lru-cache');

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_TTL = (parseInt(process.env.CACHE_TTL_SECONDS) || 300) * 1000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || null;

const ghAxios = axios.create({
  baseURL: 'https://api.github.com',
  headers: GITHUB_TOKEN
    ? { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'github-repo-explorer' }
    : { 'User-Agent': 'github-repo-explorer' },
  timeout: 20000,
});

// simple LRU cache for trees and file contents
const cache = new LRU({ max: 1000, ttl: CACHE_TTL });

function sendSse(res, event, data){
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// SSE: stream tree with progress and chunks
app.get('/api/stream/tree', async (req, res) => {
  const { owner, repo, branch } = req.query;
  if (!owner || !repo){
    res.status(400).json({ error: 'owner and repo are required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const cacheKey = `tree:${owner}/${repo}:${branch||'HEAD'}`;
  if (cache.has(cacheKey)){
    sendSse(res, 'progress', { percent: 100, message: 'cached', count: cache.get(cacheKey).length });
    sendSse(res, 'done', { tree: cache.get(cacheKey) });
    res.end();
    return;
  }

  try {
    sendSse(res, 'progress', { percent: 5, message: 'fetching tree from GitHub' });
    const ref = branch || 'HEAD';

    // Try direct tree first; might fail if ref isn't a tree
    let treeResp;
    try {
      treeResp = await ghAxios.get(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    } catch (err) {
      // fallback: resolve branch to commit sha then fetch tree
      const branchName = branch || 'main';
      const branchResp = await ghAxios.get(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branchName)}`);
      const commitSha = branchResp.data.commit.sha;
      treeResp = await ghAxios.get(`/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`);
    }

    const tree = treeResp.data.tree || [];
    const total = tree.length;
    const chunkSize = Math.max(50, Math.ceil(total / 12));
    let sent = 0;
    const staged = [];
    for (let i=0;i<total;i++){
      staged.push(tree[i]);
      if (staged.length >= chunkSize || i === total-1){
        sent += staged.length;
        const percent = Math.min(99, Math.round((sent/total) * 100));
        sendSse(res, 'progress', { percent, message: 'processing', count: sent, total });
        sendSse(res, 'chunk', { items: staged.map(it=>({ path: it.path, type: it.type, size: it.size || 0 })) });
        staged.length = 0;
        // small delay non-blocking
        await new Promise(r=>setTimeout(r, 40));
      }
    }

    const minimalTree = tree.map(it=>({ path: it.path, type: it.type, sha: it.sha, size: it.size || 0 }));
    cache.set(cacheKey, minimalTree);

    sendSse(res, 'progress', { percent: 100, message: 'done', total });
    sendSse(res, 'done', { tree: minimalTree });
    res.end();
  } catch (err) {
    const msg = err.response && err.response.data ? err.response.data.message : err.message;
    sendSse(res, 'error', { message: msg });
    res.end();
  }
});

// SSE: stream file fetch + decode
app.get('/api/stream/file', async (req, res) => {
  const { owner, repo, path: filePath, ref } = req.query;
  if (!owner || !repo || !filePath){
    res.status(400).json({ error: 'owner, repo and path are required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const cacheKey = `file:${owner}/${repo}:${ref||'HEAD'}:${filePath}`;
  if (cache.has(cacheKey)){
    const cached = cache.get(cacheKey);
    sendSse(res, 'progress', { percent: 100, message: 'cached', size: cached.size });
    sendSse(res, 'done', { file: cached });
    res.end();
    return;
  }

  try {
    sendSse(res, 'progress', { percent: 5, message: 'fetching file from GitHub' });
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const resp = await ghAxios.get(`/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}${q}`);
    const contentBase64 = resp.data.content || '';
    const encoding = resp.data.encoding || 'base64';

    sendSse(res, 'progress', { percent: 50, message: 'decoding content', size: resp.data.size });

    let content = null;
    if (encoding === 'base64'){
      content = Buffer.from(contentBase64, 'base64').toString('utf8');
    } else {
      content = contentBase64;
    }

    const fileObj = { path: resp.data.path, content, size: resp.data.size };
    cache.set(cacheKey, fileObj);

    sendSse(res, 'progress', { percent: 100, message: 'done', size: resp.data.size });
    sendSse(res, 'done', { file: fileObj });
    res.end();
  } catch (err) {
    const msg = err.response && err.response.data ? err.response.data.message : err.message;
    sendSse(res, 'error', { message: msg });
    res.end();
  }
});

// REST fallback: tree
app.get('/api/tree', async (req, res) => {
  try {
    const { owner, repo, branch } = req.query;
    if (!owner || !repo) return res.status(400).json({ error: 'owner and repo are required' });
    const cacheKey = `tree:${owner}/${repo}:${branch||'HEAD'}`;
    if (cache.has(cacheKey)) return res.json({ tree: cache.get(cacheKey) });
    const ref = branch || 'HEAD';
    let treeResp;
    try {
      treeResp = await ghAxios.get(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    } catch (err) {
      const branchName = branch || 'main';
      const branchResp = await ghAxios.get(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branchName)}`);
      const commitSha = branchResp.data.commit.sha;
      treeResp = await ghAxios.get(`/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`);
    }
    const tree = treeResp.data.tree || [];
    const minimalTree = tree.map(it=>({ path: it.path, type: it.type, sha: it.sha, size: it.size || 0 }));
    cache.set(cacheKey, minimalTree);
    res.json({ tree: minimalTree });
  } catch (err) {
    const status = err.response ? err.response.status : 500;
    const message = err.response && err.response.data ? err.response.data.message : err.message;
    res.status(status).json({ error: message });
  }
});

// REST fallback: file
app.get('/api/file', async (req, res) => {
  try {
    const { owner, repo, path: filePath, ref } = req.query;
    if (!owner || !repo || !filePath) return res.status(400).json({ error: 'owner, repo and path are required' });
    const cacheKey = `file:${owner}/${repo}:${ref||'HEAD'}:${filePath}`;
    if (cache.has(cacheKey)) return res.json(cache.get(cacheKey));
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const resp = await ghAxios.get(`/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}${q}`);
    const contentBase64 = resp.data.content || '';
    const encoding = resp.data.encoding || 'base64';
    let content = null;
    if (encoding === 'base64') content = Buffer.from(contentBase64, 'base64').toString('utf8');
    else content = contentBase64;
    const fileObj = { path: resp.data.path, content, size: resp.data.size };
    cache.set(cacheKey, fileObj);
    res.json(fileObj);
  } catch (err) {
    const status = err.response ? err.response.status : 500;
    const message = err.response && err.response.data ? err.response.data.message : err.message;
    res.status(status).json({ error: message });
  }
});

// download raw file (proxy)
app.get('/api/download', async (req, res) => {
  try {
    const { owner, repo, path: filePath, ref } = req.query;
    if (!owner || !repo || !filePath) return res.status(400).json({ error: 'owner, repo and path are required' });
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const resp = await ghAxios.get(`/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}${q}`);
    const contentBase64 = resp.data.content || '';
    const encoding = resp.data.encoding || 'base64';
    let content = null;
    if (encoding === 'base64') content = Buffer.from(contentBase64, 'base64');
    else content = Buffer.from(contentBase64);
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
    res.send(content);
  } catch (err) {
    const status = err.response ? err.response.status : 500;
    const message = err.response && err.response.data ? err.response.data.message : err.message;
    res.status(status).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
