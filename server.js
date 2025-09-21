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

const cache = new LRU({ max: 1000, ttl: CACHE_TTL });

// SSE helper
function sendSse(res, event, data){
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch(e){}
}

// rate limit message
function rateLimitMessage(err){
  if (err.response && err.response.status === 403){
    const h = err.response.headers || {};
    const remain = h['x-ratelimit-remaining'];
    const reset = h['x-ratelimit-reset'];
    if (remain === '0' && reset){
      const resetDate = new Date(parseInt(reset,10)*1000);
      return `GitHub API rate limit exceeded. Reset at ${resetDate.toLocaleString()}.`;
    }
    return err.response.data && err.response.data.message ? err.response.data.message : 'Forbidden (403)';
  }
  return null;
}

// API: branches
app.get('/api/branches', async (req,res)=>{
  const { owner, repo } = req.query;
  if(!owner||!repo) return res.status(400).json({error:'owner and repo required'});
  try {
    const resp = await ghAxios.get(`/repos/${owner}/${repo}/branches?per_page=100`);
    res.json({branches: resp.data.map(b=>b.name)});
  } catch(err){
    const msg = rateLimitMessage(err) || (err.response?.data?.message)||err.message;
    res.status(err.response? err.response.status:500).json({error:msg});
  }
});

// API: tree (SSE)
app.get('/api/stream/tree', async (req,res)=>{
  const { owner, repo, branch } = req.query;
  if(!owner||!repo){ res.status(400).json({error:'owner and repo required'}); return; }
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.flushHeaders();

  const cacheKey = `tree:${owner}/${repo}:${branch||'HEAD'}`;
  if(cache.has(cacheKey)){
    sendSse(res,'progress',{percent:100,message:'cached',count:cache.get(cacheKey).length});
    sendSse(res,'done',{tree:cache.get(cacheKey)});
    res.end(); return;
  }

  try{
    sendSse(res,'progress',{percent:5,message:'fetching tree from GitHub'});
    let ref = branch||'HEAD';
    let treeResp;
    try{
      treeResp = await ghAxios.get(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    }catch{
      const branchName = branch || 'main';
      const branchResp = await ghAxios.get(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branchName)}`);
      const commitSha = branchResp.data.commit.sha;
      treeResp = await ghAxios.get(`/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`);
    }

    const tree = treeResp.data.tree || [];
    const total = tree.length;
    const chunkSize = Math.max(50, Math.ceil(total/12));
    let sent=0;
    const staged=[];
    for(let i=0;i<total;i++){
      staged.push(tree[i]);
      if(staged.length>=chunkSize || i===total-1){
        sent+=staged.length;
        const percent = Math.min(99,Math.round((sent/total)*100));
        sendSse(res,'progress',{percent,message:'processing',count:sent,total});
        sendSse(res,'chunk',{items:staged.map(it=>({path:it.path,type:it.type,size:it.size||0}))});
        staged.length=0;
        await new Promise(r=>setTimeout(r,30));
      }
    }
    const minimalTree = tree.map(it=>({path:it.path,type:it.type,sha:it.sha,size:it.size||0}));
    cache.set(cacheKey,minimalTree);
    sendSse(res,'progress',{percent:100,message:'done',total});
    sendSse(res,'done',{tree:minimalTree});
    res.end();
  }catch(err){
    const rlMsg = rateLimitMessage(err);
    sendSse(res,'sse-error',{message: rlMsg || err.message});
    res.end();
  }
});

// API: file SSE
app.get('/api/stream/file', async (req,res)=>{
  const { owner, repo, path:filePath, ref } = req.query;
  if(!owner||!repo||!filePath){ res.status(400).json({error:'owner,repo,path required'}); return; }
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.flushHeaders();

  const cacheKey = `file:${owner}/${repo}:${ref||'HEAD'}:${filePath}`;
  if(cache.has(cacheKey)){
    sendSse(res,'progress',{percent:100,message:'cached',size:cache.get(cacheKey).size});
    sendSse(res,'done',{file:cache.get(cacheKey)});
    res.end(); return;
  }

  try{
    sendSse(res,'progress',{percent:5,message:'fetching file from GitHub'});
    const q = ref?`?ref=${encodeURIComponent(ref)}`:'';
    const resp = await ghAxios.get(`/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}${q}`);
    const contentBase64 = resp.data.content||'';
    const encoding = resp.data.encoding||'base64';
    let content = encoding==='base64'? Buffer.from(contentBase64,'base64').toString('utf8'):contentBase64;
    const fileObj = {path:resp.data.path,content,size:resp.data.size};
    cache.set(cacheKey,fileObj);
    sendSse(res,'progress',{percent:100,message:'done',size:fileObj.size});
    sendSse(res,'done',{file:fileObj});
    res.end();
  }catch(err){
    sendSse(res,'sse-error',{message:rateLimitMessage(err)||err.message});
    res.end();
  }
});

// API: status
app.get('/api/status',(req,res)=>{
  res.json({status:'ok',time:new Date().toISOString(),cacheSize:cache.size});
});

// API: docs
app.get('/api/docs',(req,res)=>{
  const docs = {
    description: "GitHub Repo Explorer API - with SSE and status",
    endpoints:[
      {
        path:"/api/branches",
        method:"GET",
        query:"owner,repo",
        example:"/api/branches?owner=facebook&repo=react",
        returns:"{branches: [...]}"
      },
      {
        path:"/api/stream/tree",
        method:"GET",
        query:"owner,repo,branch",
        description:"SSE stream of repo file tree",
        returns:"events: progress, chunk, done, sse-error"
      },
      {
        path:"/api/stream/file",
        method:"GET",
        query:"owner,repo,path,ref",
        description:"SSE stream of file content",
        returns:"events: progress, done, sse-error"
      },
      {
        path:"/api/status",
        method:"GET",
        description:"Check API status",
        returns:"{status:'ok',time:'...',cacheSize:...}"
      }
    ]
  };
  res.json(docs);
});

app.listen(PORT,()=>console.log(`Server running at http://localhost:${PORT}`));
