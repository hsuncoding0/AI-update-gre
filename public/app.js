const ownerInput = document.getElementById("owner");
const repoInput = document.getElementById("repo");
const branchInput = document.getElementById("branch");
const loadBtn = document.getElementById("loadBtn");
const treeDiv = document.getElementById("tree");
const codeEl = document.getElementById("code");
const progressBar = document.getElementById("progressBar");

function buildTree(nodes) {
  const root = {};
  for (const n of nodes) {
    const parts = n.path.split("/");
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!cur[p]) cur[p] = { __meta: null };
      if (i === parts.length - 1)
        cur[p].__meta = { type: n.type, sha: n.sha, size: n.size || 0 };
      cur = cur[p];
    }
  }
  return root;
}

function renderNode(obj, parentEl, prefixPath = "") {
  const ul = document.createElement("ul");
  for (const name of Object.keys(obj).sort()) {
    if (name === "__meta") continue;
    const li = document.createElement("li");
    li.className = "cursor-pointer hover:bg-gray-200 rounded px-1 transition";
    const meta = obj[name].__meta;
    const fullPath = prefixPath ? `${prefixPath}/${name}` : name;
    if (meta && meta.type === "blob") {
      li.innerHTML = `📄 <span class="font-mono">${name}</span>`;
      li.onclick = () => loadFile(fullPath);
    } else {
      li.innerHTML = `📁 <span class="font-bold">${name}</span>`;
      renderNode(obj[name], li, fullPath);
    }
    ul.appendChild(li);
  }
  parentEl.appendChild(ul);
}

async function loadTree() {
  const owner = ownerInput.value.trim();
  const repo = repoInput.value.trim();
  const branch = branchInput.value.trim();
  if (!owner || !repo) {
    alert("請輸入 owner 與 repo");
    return;
  }

  progressBar.classList.remove("hidden");
  treeDiv.innerHTML = "Loading tree...";
  codeEl.textContent = "";

  try {
    const q = new URLSearchParams({ owner, repo, ...(branch ? { branch } : {}) });
    const r = await fetch(`/api/tree?${q.toString()}`);
    if (!r.ok) throw new Error("Failed to load tree");
    const data = await r.json();
    const root = buildTree(data.tree || []);
    treeDiv.innerHTML = "";
    renderNode(root, treeDiv);
  } catch (err) {
    treeDiv.innerHTML = `<div class="text-red-500">${err.message}</div>`;
  } finally {
    progressBar.classList.add("hidden");
  }
}

async function loadFile(path) {
  codeEl.textContent = "Loading...";
  const owner = ownerInput.value.trim();
  const repo = repoInput.value.trim();
  const branch = branchInput.value.trim();
  try {
    const q = new URLSearchParams({ owner, repo, path, ...(branch ? { ref: branch } : {}) });
    const r = await fetch(`/api/file?${q.toString()}`);
    if (!r.ok) throw new Error("Failed to load file");
    const data = await r.json();
    codeEl.textContent = data.content;
    const ext = path.split(".").pop().toLowerCase();
    codeEl.className = `hljs language-${ext}`;
    hljs.highlightElement(codeEl);
  } catch (err) {
    codeEl.textContent = `Error: ${err.message}`;
  }
}

loadBtn.onclick = loadTree;
