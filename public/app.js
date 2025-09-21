// Simple client JS: fetch tree then render nested list; click file -> fetch content

const ownerInput = document.getElementById('owner');
const repoInput = document.getElementById('repo');
const branchInput = document.getElementById('branch');
const loadBtn = document.getElementById('loadBtn');
const treeDiv = document.getElementById('tree');
const codeEl = document.getElementById('code');

function showError(msg){ treeDiv.innerHTML = `<div style="color:crimson">${msg}</div>`; }

function buildTree(nodes){
  // nodes: array from GitHub tree with {path, type}
  const root = {};
  for (const n of nodes){
    const parts = n.path.split('/');
    let cur = root;
    for (let i=0;i<parts.length;i++){
      const p = parts[i];
      if (!cur[p]) cur[p] = { __meta: null };
      if (i === parts.length-1) cur[p].__meta = { type: n.type, sha: n.sha, size: n.size || 0 };
      cur = cur[p];
    }
  }
  return root;
}

function renderNode(obj, parentEl, prefixPath=''){
  const ul = document.createElement('ul');
  for (const name of Object.keys(obj).sort((a,b)=>a.localeCompare(b))){
    if (name === '__meta') continue;
    const li = document.createElement('li');
    const meta = obj[name].__meta;
    const fullPath = prefixPath ? `${prefixPath}/${name}` : name;
    if (meta && meta.type === 'blob'){
      li.innerHTML = `📄 <span class="file">${name}</span>`;
      li.addEventListener('click', async (e)=>{
        e.stopPropagation();
        await loadFile(fullPath);
      });
    } else {
      li.innerHTML = `📁 <span class="folder">${name}</span>`;
      li.addEventListener('click', (e)=>{ e.stopPropagation(); li.classList.toggle('collapsed'); });
      // render children
      renderNode(obj[name], li, fullPath);
    }
    ul.appendChild(li);
  }
  parentEl.appendChild(ul);
}

async function loadFile(path){
  codeEl.textContent = 'Loading...';
  const owner = ownerInput.value.trim();
  const repo = repoInput.value.trim();
  const branch = branchInput.value.trim();
  try {
    const q = new URLSearchParams({ owner, repo, path, ...(branch?{ref:branch}:{}) });
    const r = await fetch(`/api/file?${q.toString()}`);
    if (!r.ok){
      const e = await r.json();
      codeEl.textContent = `Error: ${e.error || r.statusText}`;
      return;
    }
    const data = await r.json();
    codeEl.textContent = data.content;
    // try setting language class based on extension (very simple)
    const ext = path.split('.').pop().toLowerCase();
    codeEl.className = `hljs language-${ext}`;
    hljs.highlightElement(codeEl);
  } catch (err){
    codeEl.textContent = `Fetch error: ${err.message}`;
  }
}

loadBtn.addEventListener('click', async ()=>{
  const owner = ownerInput.value.trim();
  const repo = repoInput.value.trim();
  const branch = branchInput.value.trim();
  if (!owner || !repo) return showError('請輸入 owner 與 repo');
  treeDiv.innerHTML = 'Loading tree...';
  codeEl.textContent = '';
  try {
    const q = new URLSearchParams({ owner, repo, ...(branch?{branch}:{} ) });
    const r = await fetch(`/api/tree?${q.toString()}`);
    if (!r.ok){
      const e = await r.json();
      return showError(`Error: ${e.error || r.statusText}`);
    }
    const data = await r.json();
    const root = buildTree(data.tree || []);
    treeDiv.innerHTML = '';
    renderNode(root, treeDiv, '');
  } catch (err){
    showError(err.message);
  }
});

// usability: allow pressing Enter in inputs
[ownerInput, repoInput, branchInput].forEach(el=>el.addEventListener('keydown', (e)=>{ if (e.key==='Enter') loadBtn.click(); }));
