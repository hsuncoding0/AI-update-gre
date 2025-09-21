// front-end app.js (improved, fixes + animations + features)

// elements
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

// utilities
function escapeHtml(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function formatBytes(n){
  if (n === 0) return '0 B';
  const units = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(n)/Math.log(1024));
  return (n/Math.pow(1024,i)).toFixed(i?2:0)+' '+units[i];
}
function debounce(fn,delay){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), delay); }; }

// UI helpers
function showProgress(percent, text){
  progressWrap.classList.remove('hidden');
  progressBar.style.width = `${percent}%`;
  progressText.textContent = text || `${percent}%`;
  if (percent >= 100) setTimeout(()=> progressWrap.classList.add('hidden'), 600);
}
function clearTree(){ treeDiv.innerHTML = '<div class="text-slate-400">尚未載入</div>'; }

// icons and small helpers
function getIconForName(name, type){
  if (type === 'tree') return '📁';
  const ext = name.split('.').pop().toLowerCase();
  const codeExt = ['js','jsx','ts','tsx','py','java','c','cpp','h','json','md','html','css','scss','go','rs','rb','php','sh'];
  const imageExt = ['png','jpg','jpeg','gif','svg','ico','webp'];
  if (codeExt.includes(ext)) return '📄';
  if (imageExt.includes(ext)) return '🖼️';
  return '📄';
}

// tree building & rendering
function buildHierarchy(list){
  const root = {};
  for (const it of list){
    const parts = it.path.split('/');
    let cur = root;
    for (let i=0;i<parts.length;i++){
      const p = parts[i];
      if (!cur[p]) cur[p] = { __meta: null };
      if (i === parts.length-1) cur[p].__meta = { type: it.type, size: it.size || 0 };
      cur = cur[p];
    }
  }
  return root;
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
      row.innerHTML = `${icon} <span class="tree-file">${escapeHtml(name)}</span> <span class="text-xs text-slate-400 ml-auto">${formatBytes(meta.size)}</span>`;
      row.addEventListener('click', (e)=>{ e.stopPropagation(); loadFileSse(fullPath); });
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

// stream tree SSE + fetch branches
async function loadTreeSse(){
  const owner = ownerInput.value.trim();
  const repo = repoInput.value.trim();
  if (!owner || !repo){ alert('請輸入 owner 與 repo'); return; }

  // close previous SSEs
  if (esTree){ esTree.close(); esTree = null; }
  if (esFile){ esFile.close(); esFile = null; }

  currentTree = []; displayedTree = [];
  clearTree();
  codeEl.textContent = '';
  breadcrumbs.textContent = '';

  // skeleton while first chunk arrives
  treeDiv.innerHTML = '';
  for (let i=0;i<6;i++){
    const s = document.createElement('div');
    s.className = 'skeleton my-2 h-4';
    treeDiv.appendChild(s);
  }

  const q = new URLSearchParams({ owner, repo });
  esTree = new EventSource(`/api/stream/tree?${q.toString()}`);

  // fetch branches in background (non-blocking)
  fetch(`/api/branches?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`)
    .then(r=>r.json())
    .then(data=>{
      if (data && data.branches && Array.isArray(data.branches)){
        branchSelect.innerHTML = '<option value=\"\">branch (optional)</option>';
        for (const b of data.branches.slice(0,50)){
          const o = document.createElement('option'); o.value = b; o.textContent = b; branchSelect.appendChild(o);
        }
      }
    }).catch(()=>{/* ignore */});

  esTree.addEventListener('progress', (e)=>{
    let data = {};
    try { data = JSON.parse(e.data); } catch (_) {}
    showProgress(data.percent || 5, data.message || '載入中');
  });

  esTree.addEventListener('chunk', (e)=>{
    let data = {};
    try { data = JSON.parse(e.data); } catch (_) {}
    if (data.items){
      currentTree.push(...data.items);
      renderTree(currentTree);
    }
  });

  esTree.addEventListener('done', (e)=>{
    let data = {};
    try { data = JSON.parse(e.data); } catch (_) {}
    currentTree = data.tree || currentTree;
    renderTree(currentTree);
    showProgress(100, '載入完成');
    if (esTree){ esTree.close(); esTree = null; }
  });

  // custom server error
  esTree.addEventListener('sse-error', (e)=>{
    let d = {};
    try { d = JSON.parse(e.data); } catch (_) {}
    alert('伺服器錯誤：' + (d.message || '載入失敗'));
    if (esTree){ esTree.close(); esTree = null; }
    showProgress(0, '錯誤');
  });

  // network error (EventSource builtin)
  esTree.addEventListener('error', (e)=>{
    // If readyState === 0 it's closed; otherwise network issue
    if (esTree && esTree.readyState === EventSource.CLOSED){
      // closed normally
    } else {
      // network error
      showProgress(0, '網路錯誤或連線中斷');
    }
  });
}

// search + debounce
const debouncedFilter = debounce((v)=> filterTree(v), 220);
function filterTree(q){
  if (!q){ displayedTree = []; renderTree(currentTree); return; }
  const low = q.toLowerCase();
  displayedTree = currentTree.filter(it => it.path.toLowerCase().includes(low));
  renderTree(displayedTree);
}

// load file via SSE
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
    let data = {};
    try { data = JSON.parse(e.data); } catch(_) {}
    showProgress(data.percent || 5, (data.message || '載入中') + (data.size? ` (${formatBytes(data.size)})` : ''));
  });

  esFile.addEventListener('done', (e)=>{
    let data = {};
    try { data = JSON.parse(e.data); } catch(_) {}
    currentFile = data.file;
    renderFileWithLineNumbers(currentFile.content);
    showProgress(100, '檔案載入完成');
    if (esFile){ esFile.close(); esFile = null; }
    // if current searchBox has text, jump to first match in file
    const qtxt = searchBox.value.trim();
    if (qtxt) highlightFirstMatchInFile(qtxt);
  });

  esFile.addEventListener('sse-error', (e)=>{
    let d = {};
    try { d = JSON.parse(e.data); } catch(_) {}
    alert('伺服器錯誤：' + (d.message || '載入失敗'));
    if (esFile){ esFile.close(); esFile = null; }
    showProgress(0, '錯誤');
  });

  esFile.addEventListener('error', (e)=>{
    showProgress(0, '檔案載入中發生網路錯誤');
  });
}

// render file with line numbers and syntax highlight
function renderFileWithLineNumbers(text){
  // highlight via highlight.js first (auto)
  let highlightedHtml = '';
  try {
    const res = hljs.highlightAuto(text);
    highlightedHtml = res && res.value ? res.value : escapeHtml(text);
  } catch (err) {
    highlightedHtml = escapeHtml(text);
  }

  const highlightedLines = highlightedHtml.split(/\r?\n/);
  const originalLines = text.split(/\r?\n/);
  // build lines markup
  const linesHtml = originalLines.map((ln, i)=>{
    const codeLineHtml = highlightedLines[i] !== undefined ? highlightedLines[i] : escapeHtml(ln);
    return `<div class="code-line" data-line="${i+1}"><div class="code-gutter">${i+1}</div><div class="code-content">${codeLineHtml}</div></div>`;
  }).join('');
  codeEl.innerHTML = linesHtml;
}

// highlight first matching line in current file (by whole-line highlight)
function highlightFirstMatchInFile(q){
  if (!currentFile || !q) return;
  const idx = currentFile.content.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return;
  const lineNo = currentFile.content.slice(0, idx).split(/\r?\n/).length;
  // remove previous
  const prev = codeEl.querySelector('.match-line');
  if (prev) prev.classList.remove('match-line');
  const target = codeEl.querySelector(`.code-line[data-line="${lineNo}"]`);
  if (target){
    target.classList.add('match-line');
    // scroll into view
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// download & copy
downloadBtn.addEventListener('click', ()=>{
  if (!currentFile) return alert('請先選擇檔案');
  const owner = ownerInput.value.trim();
  const repo = repoInput.value.trim();
  const ref = branchSelect.value || '';
  const q = new URLSearchParams({ owner, repo, path: currentFile.path, ...(ref?{ref}:{}) });
  window.open(`/api/download?${q.toString()}`, '_blank');
});
copyBtn.addEventListener('click', ()=>{
  if (!currentFile) return alert('請先選擇檔案');
  navigator.clipboard.writeText(currentFile.content).then(()=> {
    snack.textContent = '已複製到剪貼簿';
    snack.classList.remove('hidden');
    setTimeout(()=> snack.classList.add('hidden'), 1600);
  }, ()=> { alert('複製失敗'); });
});

// bindings
searchBox.addEventListener('input', (e)=> debouncedFilter(e.target.value));
clearSearch.addEventListener('click', ()=> { searchBox.value=''; filterTree(''); });
[ownerInput, repoInput].forEach(el=>el.addEventListener('keydown', (e)=>{ if (e.key==='Enter') loadBtn.click(); }));
loadBtn.addEventListener('click', ()=> loadTreeSse());

// theme toggle
function applyTheme(mode){
  if (mode === 'dark') document.documentElement.classList.add('dark');
  else document.documentElement.classList.remove('dark');
  if (mode === 'dark') themeIcon.innerHTML = '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" fill="currentColor"/>';
  else themeIcon.innerHTML = '<path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>';
}
const savedTheme = localStorage.getItem('ghe:theme') || 'light';
applyTheme(savedTheme);
themeToggle.addEventListener('click', ()=>{
  const cur = localStorage.getItem('ghe:theme') || 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  localStorage.setItem('ghe:theme', next);
  applyTheme(next);
});

// keyboard shortcut: Ctrl/Cmd+K to focus search
window.addEventListener('keydown', (e)=>{
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'){ e.preventDefault(); searchBox.focus(); }
});

// init
clearTree();
codeEl.textContent = '';
