// front-end main
// SSE-based tree & file loading with animations, search highlighting, theme toggle, line numbers

const ownerInput = document.getElementById('owner');
const repoInput = document.getElementById('repo');
const branchSelect = document.getElementById('branchSelect');
const loadBtn = document.getElementById('loadBtn');
const treeDiv = document.getElementById('tree');
const codeEl = document.getElementById('code');
const codePre = document.getElementById('codePre');
const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const searchBox = document.getElementById('searchBox');
const clearSearch = document.getElementById('clearSearch');
const breadcrumbs = document.getElementById('breadcrumbs');
const downloadBtn = document.getElementById('downloadBtn');
const copyBtn = document.getElementById('copyBtn');
const snack = document.getElementById('snack');
const themeToggle = document.getElementById('themeToggle');
const themeIcon = document.getElementById('themeIcon');

let currentTree = [];
let displayedTree = [];
let currentFile = null;
let esTree = null;
let esFile = null;

function showProgress(percent, text){
  progressWrap.classList.remove('hidden');
  progressBar.style.width = `${percent}%`;
  progressText.textContent = text || `${percent}%`;
  if (percent >= 100){
    setTimeout(()=> progressWrap.classList.add('hidden'), 500);
  }
}

function clearTree(){ treeDiv.innerHTML = '<div class="text-slate-400">尚未載入</div>'; }

function buildHierarchy(list){
  const root = {};
  for (const it of list){
    const parts = it.path.split('/');
    let cur = root;
    for (let i=0;i<parts.length;i++){
      const p = parts[i];
      if (!cur[p]) cur[p] = { __meta: null };
      if (i === parts.length-1) cur[p].__meta = { type: it.type, size: it.size };
      cur = cur[p];
    }
  }
  return root;
}

function getIconForName(name, type){
  if (type === 'tree') return '📁';
  const ext = name.split('.').pop().toLowerCase();
  if (['js','jsx','ts','tsx','py','java','c','cpp','h','json','md','html','css','scss','go','rs','rb','php','sh'].includes(ext)) return '📄';
  if (['png','jpg','jpeg','gif','svg','ico','webp'].includes(ext)) return '🖼️';
  if (['lock','key'].includes(ext)) return '🔒';
  return '📄';
}

function renderNode(obj, parentEl, prefixPath=''){
  const ul = document.createElement('ul');
  ul.className = "space-y-1";
  for (const name of Object.keys(obj).sort((a,b)=>a.localeCompare(b))){
    if (name === '__meta') continue;
    const li = document.createElement('li');
    const meta = obj[name].__meta;
    const fullPath = prefixPath ? `${prefixPath}/${name}` : name;
    const row = document.createElement('div');
    row.className = 'tree-item flex items-center gap-2';
    const icon = getIconForName(name, meta ? (meta.type === 'tree' ? 'tree' : 'blob') : 'tree');
    if (meta && meta.type === 'blob'){
      row.innerHTML = `${icon} <span class="tree-file">${escapeHtml(name)}</span> <span class="text-xs text-slate-400 ml-auto">${meta.size || 0} bytes</span>`;
      row.addEventListener('click', async (e)=>{ e.stopPropagation(); loadFileSse(fullPath); });
    } else {
      row.innerHTML = `${icon} <span class="tree-folder">${escapeHtml(name)}</span>`;
      row.addEventListener('click', (e)=>{ e.stopPropagation(); row.nextSibling?.classList.toggle('hidden'); row.classList.toggle('open'); });
    }
    li.appendChild(row);
    const childHolder = document.createElement('div');
    childHolder.className = 'pl-4';
    renderNode(obj[name], childHolder, fullPath);
    li.appendChild(childHolder);
    ul.appendChild(li);
  }
  parentEl.appendChild(ul);
}

function renderTree(list){
  currentTree = list;
  const filtered = displayedTree.length ? displayedTree : currentTree;
  const h = buildHierarchy(filtered);
  treeDiv.innerHTML = '';
  renderNode(h, treeDiv, '');
}

function escapeHtml(s){
  return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
}

// SSE: load tree
function loadTreeSse(){
  const owner = ownerInput.value.trim();
  const repo = repoInput.value.trim();
  if (!owner || !repo) { alert('請輸入 owner 與 repo'); return; }

  if (esTree){ esTree.close(); esTree = null; }
  currentTree = [];
  displayedTree = [];
  clearTree();
  codeEl.textContent = '';
  breadcrumbs.textContent = '';

  // clear branch select (will populate if branch info returned) - for this simple demo we won't query branches via API; user can type
  branchSelect.innerHTML = '<option value="">branch (optional)</option>';

  const q = new URLSearchParams({ owner, repo });
  esTree = new EventSource(`/api/stream/tree?${q.toString()}`);

  esTree.addEventListener('progress', (e)=>{
    const data = JSON.parse(e.data);
    showProgress(data.percent, data.message + (data.count?` (${data.count}/${data.total||'?'})`:'') );
  });
  esTree.addEventListener('chunk', (e)=>{
    const data = JSON.parse(e.data);
    currentTree.push(...data.items);
    renderTree(currentTree);
  });
  esTree.addEventListener('done', (e)=>{
    const data = JSON.parse(e.data);
    currentTree = data.tree;
    renderTree(currentTree);
    showProgress(100, '載入完成');
    esTree.close(); esTree = null;
    // optionally: set some common branches in dropdown (not exact); user can type branch manually
    // branchSelect.innerHTML += '<option value=\"main\">main</option><option value=\"master\">master</option>';
  });
  esTree.addEventListener('error', (e)=>{
    try{ const d = JSON.parse(e.data); alert('Error: '+d.message); }catch(_){ alert('載入失敗'); }
    esTree.close(); esTree = null;
  });
}

// helper: highlight search match in path
function highlightInString(str, q){
  if (!q) return escapeHtml(str);
  const idx = str.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return escapeHtml(str);
  const before = escapeHtml(str.slice(0, idx));
  const match = escapeHtml(str.slice(idx, idx+q.length));
  const after = escapeHtml(str.slice(idx+q.length));
  return `${before}<span class="match">${match}</span>${after}`;
}

// search filter
function filterTree(q){
  if (!q){ displayedTree = []; renderTree(currentTree); return; }
  const low = q.toLowerCase();
  displayedTree = currentTree.filter(it => it.path.toLowerCase().includes(low));
  renderTree(displayedTree);
}

// SSE: load file
function loadFileSse(path){
  const owner = ownerInput.value.trim();
  const repo = repoInput.value.trim();
  const ref = branchSelect.value || '';
  codeEl.textContent = '載入中...';
  breadcrumbs.textContent = path;
  currentFile = null;
  if (esFile){ esFile.close(); esFile = null; }

  const q = new URLSearchParams({ owner, repo, path, ...(ref?{ref}:{}) });
  esFile = new EventSource(`/api/stream/file?${q.toString()}`);

  esFile.addEventListener('progress', (e)=>{
    const data = JSON.parse(e.data);
    showProgress(data.percent, data.message + (data.size?` (${data.size} bytes)`:'' ));
  });
  esFile.addEventListener('done', (e)=>{
    const data = JSON.parse(e.data);
    currentFile = data.file;
    renderFileWithLineNumbers(currentFile.content);
    showProgress(100, '檔案載入完成');
    esFile.close(); esFile = null;
  });
  esFile.addEventListener('error', (e)=>{
    try{ const d = JSON.parse(e.data); alert('Error: '+d.message); }catch(_){ alert('載入失敗'); }
    esFile.close(); esFile = null;
  });
}

// render file content with line numbers and apply highlight.js
function renderFileWithLineNumbers(text){
  // split into lines
  const lines = text.split(/\r\n|\n/);
  const gutter = lines.map((_,i)=>`<div class="code-line"><div class="code-gutter">${i+1}</div><div class="code-content">${escapeHtml(lines[i] || '')}</div></div>`).join('');
  codeEl.innerHTML = gutter;
  // apply highlight - highlight.js works on code blocks, but we already escaped. For better results, we can create a temporary pre to highlight full text:
  try {
    const tmp = document.createElement('pre');
    tmp.style.display = 'none';
    tmp.textContent = text;
    document.body.appendChild(tmp);
    hljs.highlightElement(tmp);
    // take highlighted HTML and split into lines, then inject into code-content spans
    const highlighted = tmp.innerHTML;
    document.body.removeChild(tmp);
    const highlightedLines = highlighted.split(/\r\n|\n/);
    // map highlightedLines into existing .code-content
    const contentEls = codeEl.querySelectorAll('.code-content');
    for (let i=0;i<contentEls.length;i++){
      if (highlightedLines[i] !== undefined) contentEls[i].innerHTML = highlightedLines[i];
    }
  } catch (err) {
    // fallback is already escaped plain text
  }
}

// download file
downloadBtn.addEventListener('click', ()=>{
  if (!currentFile) return alert('請先選擇檔案');
  const owner = ownerInput.value.trim();
  const repo = repoInput.value.trim();
  const ref = branchSelect.value || '';
  const q = new URLSearchParams({ owner, repo, path: currentFile.path, ...(ref?{ref}:{}) });
  window.open(`/api/download?${q.toString()}`, '_blank');
});

// copy file
copyBtn.addEventListener('click', ()=>{
  if (!currentFile) return alert('請先選擇檔案');
  navigator.clipboard.writeText(currentFile.content).then(()=> {
    snack.textContent = '已複製到剪貼簿';
    snack.classList.remove('hidden');
    setTimeout(()=> snack.classList.add('hidden'), 1600);
  }, ()=> {
    alert('複製失敗');
  });
});

// search bindings
searchBox.addEventListener('input', (e)=> filterTree(e.target.value));
clearSearch.addEventListener('click', ()=> { searchBox.value=''; filterTree(''); });

// Enter to load
[ownerInput, repoInput].forEach(el=>el.addEventListener('keydown', (e)=>{ if (e.key==='Enter') loadBtn.click(); }));
loadBtn.addEventListener('click', ()=> loadTreeSse());

// Theme toggle (stores in localStorage)
function applyTheme(mode){
  if (mode === 'dark') document.documentElement.classList.add('dark');
  else document.documentElement.classList.remove('dark');
  // swap icon (simple)
  if (mode === 'dark') themeIcon.innerHTML = '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" fill="currentColor"/>';
  else themeIcon.innerHTML = '<path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>';
}
const saved = localStorage.getItem('ghe:theme') || 'auto';
if (saved === 'dark') applyTheme('dark'); else if (saved === 'light') applyTheme('light'); else applyTheme('light');

themeToggle.addEventListener('click', ()=>{
  const cur = localStorage.getItem('ghe:theme') || 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  localStorage.setItem('ghe:theme', next);
  applyTheme(next);
});

// small helper: escapeHtml used above already defined

// init
clearTree();
codeEl.textContent = '';
