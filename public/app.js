const tabs = document.querySelectorAll('.tab-btn');
const contents = document.querySelectorAll('.tab-content');
tabs.forEach(btn=>{
  btn.addEventListener('click',()=>{
    tabs.forEach(b=>b.classList.remove('bg-blue-500','text-white'));
    tabs.forEach(b=>b.classList.add('bg-gray-200','text-gray-700'));
    btn.classList.add('bg-blue-500','text-white');
    btn.classList.remove('bg-gray-200','text-gray-700');
    contents.forEach(c=>c.classList.add('hidden'));
    const target = document.getElementById(btn.dataset.tab);
    target.classList.remove('hidden');
  });
});

// Tree Fetch
document.getElementById('fetchTree').addEventListener('click',()=>{
  const val = document.getElementById('repoInput').value.trim();
  if(!val.includes('/')) return alert('格式: owner/repo');
  const [owner,repo] = val.split('/');
  const container = document.getElementById('treeContainer');
  container.innerHTML='載入中...';
  const evtSource = new EventSource(`/api/stream/tree?owner=${owner}&repo=${repo}`);
  let html='';
  evtSource.onmessage = e=>{
    const data = JSON.parse(e.data);
    if(e.lastEventId==='chunk'){
      data.items.forEach(it=>{
        html+=`<div>${it.type==='tree'?'📁':'📄'} ${it.path}</div>`;
      });
      container.innerHTML=html;
    }
  }
  evtSource.onerror = ()=>{ evtSource.close(); }
});

// API Docs
fetch('/api/docs').then(r=>r.json()).then(docs=>{
  const apiDiv = document.getElementById('apiDocs');
  docs.endpoints.forEach(ep=>{
    const card = document.createElement('div');
    card.className='border p-4 bg-white rounded shadow hover:shadow-lg transition';
    card.innerHTML=`
      <h3 class="font-semibold">${ep.method} ${ep.path}</h3>
      <p>${ep.description||''}</p>
      ${ep.query?`<p>Query: ${ep.query}</p>`:''}
      <p>Example: <code>${ep.example||''}</code></p>
      <button class="bg-blue-500 text-white px-3 py-1 rounded mt-2 testBtn">測試</button>
      <pre class="mt-2 hidden resultBox bg-gray-100 p-2 rounded"></pre>
    `;
    apiDiv.appendChild(card);
    card.querySelector('.testBtn').addEventListener('click',()=>{
      const pre = card.querySelector('.resultBox');
      pre.classList.remove('hidden');
      pre.textContent='載入中...';
      fetch(ep.example||ep.path).then(r=>r.json()).then(j=>pre.textContent=JSON.stringify(j,null,2)).catch(e=>pre.textContent=e.message);
    });
  });
});

// Status test
document.getElementById('checkStatus').addEventListener('click',()=>{
  const pre = document.getElementById('statusResult');
  pre.textContent='檢查中...';
  fetch('/api/status').then(r=>r.json()).then(j=>pre.textContent=JSON.stringify(j,null,2)).catch(e=>pre.textContent=e.message);
});
