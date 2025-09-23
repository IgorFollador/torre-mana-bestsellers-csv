// ==UserScript==
// @name         Torre de Maná - Exportar Bestsellers CSV (robusto)
// @namespace    https://waykey.com.br/
// @version      1.1.0
// @description  Botão para exportar CSV de bestsellers (scraping do HTML paginado) com detecção robusta de rota/SPA
// @author       IgorFollador
// @match        https://www.torredemana.com.br/*
// @match        http://www.torredemana.com.br/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      www.torredemana.com.br
// ==/UserScript==

(function () {
  'use strict';

  const VIEW_REGEX = /ecom\/admin\/stats\/bestsellers/i;
  const CSV_HEADERS = ['rank','quant_vend','card','edicao','menor_preco','preco_medio','maior_preco'];

  let injected = false; // evita duplicar botão
  let btn, statusBox;

  function log(...args){ console.log('[TM-Bestsellers]', ...args); }

  GM_addStyle(`
    .tm-export-btn {
      position: fixed;
      z-index: 999999;
      right: 16px;
      bottom: 16px;
      padding: 10px 14px;
      background: #0ea5e9;
      color: #fff !important;
      font-weight: 600;
      border-radius: 10px;
      box-shadow: 0 4px 14px rgba(0,0,0,.2);
      cursor: pointer;
      user-select: none;
    }
    .tm-export-btn:hover { filter: brightness(0.95); }
    .tm-export-status {
      position: fixed;
      z-index: 999999;
      right: 16px;
      bottom: 60px;
      padding: 8px 12px;
      background: #111827;
      color: #fff;
      font-size: 12px;
      border-radius: 8px;
      opacity: 0.9;
      max-width: 50vw;
      white-space: pre-wrap;
      line-height: 1.3;
    }
  `);

  function getViewFromLocation(loc = location.href){
    try{
      const u = new URL(loc);
      const raw = u.searchParams.get('view') || '';
      // raw pode vir já decodificado por alguns routers;
      // garantimos uma versão “normalizada”:
      const norm = decodeURIComponent(raw || '').replace(/%2F/gi,'/'); // redundante, mas seguro
      return norm || raw;
    }catch(e){
      return '';
    }
  }

  function isOnBestsellersPage(){
    const view = getViewFromLocation();
    const hrefHasEncoded = /view=ecom%2Fadmin%2Fstats%2Fbestsellers/i.test(location.search);
    const ok = VIEW_REGEX.test(view) || hrefHasEncoded;
    log('view:', view, 'encodedMatch?', hrefHasEncoded, 'isOn?', ok);
    return ok;
  }

  function ensureUI(){
    if (!document.body) return;                       // segurança
    if (!isOnBestsellersPage()) { removeUI(); return; } // não está na página alvo
    if (injected) return;

    btn = document.createElement('div');
    btn.className = 'tm-export-btn';
    btn.textContent = 'Exportar CSV (bestsellers)';
    btn.addEventListener('click', exportAllPages);

    statusBox = document.createElement('div');
    statusBox.className = 'tm-export-status';
    statusBox.style.display = 'none';

    document.body.appendChild(btn);
    document.body.appendChild(statusBox);
    injected = true;
    log('Botão injetado.');
  }

  function removeUI(){
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
    if (statusBox && statusBox.parentNode) statusBox.parentNode.removeChild(statusBox);
    btn = null; statusBox = null; injected = false;
    log('UI removida (não estamos na página alvo).');
  }

  function setStatus(msg){
    if (!statusBox) return;
    statusBox.style.display = 'block';
    statusBox.textContent = String(msg);
  }
  function hideStatus(){ if (statusBox) statusBox.style.display = 'none'; }

  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  function toCSVLine(values) {
    return values.map(v=>{
      let s = v == null ? '' : String(v);
      if (s.includes('"')) s = s.replace(/"/g,'""');
      if (s.includes(';') || s.includes('\n') || s.includes('"')) s = `"${s}"`;
      return s;
    }).join(';');
  }
  function downloadCSV(rows, filenameBase='bestsellers'){
    const header = toCSVLine(CSV_HEADERS);
    const body = rows.map(r => toCSVLine([r.rank,r.quant_vend,r.card,r.edicao,r.menor_preco,r.preco_medio,r.maior_preco]));
    const csv = [header, ...body].join('\n');
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const now = new Date(), pad = n=>String(n).padStart(2,'0');
    a.href = url;
    a.download = `${filenameBase}_${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function fetchHTML(url) {
    // tenta fetch com cookies; se der ruim (CF), tenta GM_xmlhttpRequest
    try{
      const res = await fetch(url, { credentials:'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    }catch(e){
      log('fetch falhou, tentando GM_xmlhttpRequest...', e.message);
      return new Promise((resolve,reject)=>{
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          headers: { 'Accept':'text/html' },
          onload: r => (r.status>=200 && r.status<300) ? resolve(r.responseText) : reject(new Error(`GM_xhr HTTP ${r.status}`)),
          onerror: ()=>reject(new Error('GM_xhr error')),
          ontimeout: ()=>reject(new Error('GM_xhr timeout')),
        });
      });
    }
  }

  function parseDocument(htmlString){
    const parser = new DOMParser();
    return parser.parseFromString(htmlString, 'text/html');
  }

  function extractRowsFromDoc(doc){
    const tables = Array.from(doc.querySelectorAll('table'));
    let target = null, maxTh=-1;
    for (const t of tables){
      const ths = t.querySelectorAll('thead th');
      if (ths.length > maxTh){ maxTh = ths.length; target = t; }
    }
    if (!target) return [];

    const headerCells = Array.from(target.querySelectorAll('thead th')).map(th => th.textContent.trim().toLowerCase());
    const findIdx = (...cands)=> headerCells.findIndex(h => cands.some(c => h.includes(c)));

    const idxRank = findIdx('rank', '#');
    const idxQtd  = findIdx('quant', 'qtd', 'vend');
    const idxCard = findIdx('card', 'carta', 'nome', 'produto');
    const idxEd   = findIdx('edição', 'edicao', 'set', 'coleção', 'colecao');
    const idxMin  = findIdx('menor', 'min', 'preço min', 'menor preço', 'menor preco');
    const idxAvg  = findIdx('médio', 'medio', 'média', 'preço méd', 'preco medio');
    const idxMax  = findIdx('maior', 'max', 'preço max', 'maior preço', 'maior preco');

    const rows = [];
    for (const tr of target.querySelectorAll('tbody tr')){
      const tds = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
      if (!tds.length) continue;
      const get = (i)=> (i>=0 && i<tds.length ? tds[i] : '');
      const row = {
        rank: get(idxRank),
        quant_vend: get(idxQtd),
        card: get(idxCard),
        edicao: get(idxEd),
        menor_preco: get(idxMin),
        preco_medio: get(idxAvg),
        maior_preco: get(idxMax),
      };
      if (Object.values(row).some(v => v && v.length)) rows.push(row);
    }
    return rows;
  }

  function detectTotalPages(doc){
    const links = Array.from(doc.querySelectorAll('a[href*="page="]'))
      .map(a => { try{ return new URL(a.href, location.origin); }catch{ return null; }})
      .filter(Boolean);
    let maxPage = 1;
    for (const u of links){
      const p = Number(u.searchParams.get('page') || '0');
      if (p > maxPage) maxPage = p;
    }
    return maxPage || 1;
  }

  function buildBaseURL(){
    const url = new URL(location.href);
    url.searchParams.set('page','1');
    return url;
  }

  async function exportAllPages(){
    try{
      if (!btn) return;
      btn.textContent = 'Exportando...';
      btn.style.pointerEvents = 'none';
      setStatus('Iniciando scraping...');

      const base = buildBaseURL();
      log('Base URL', base.toString());

      setStatus('Baixando página 1...');
      const firstHTML = await fetchHTML(base.toString());
      const firstDoc  = parseDocument(firstHTML);
      const firstRows = extractRowsFromDoc(firstDoc);
      if (!firstRows.length){
        setStatus('Não encontrei linhas na página 1. Verifique filtros/login.');
        return;
      }

      const totalPages = detectTotalPages(firstDoc) || 1;
      setStatus(`Páginas detectadas: ${totalPages}. Processando...`);

      let allRows = [...firstRows];
      for (let page=2; page<=3; page++){
        await delay(300);
        setStatus(`Baixando página ${page}/${totalPages}...`);
        const u = new URL(base.toString());
        u.searchParams.set('page', String(page));
        const html = await fetchHTML(u.toString());
        const doc  = parseDocument(html);
        const rows = extractRowsFromDoc(doc);
        if (!rows.length){
          setStatus(`Página ${page} sem linhas. Encerrando na ${page-1}.`);
          break;
        }
        allRows = allRows.concat(rows);
      }

      setStatus(`Gerando CSV com ${allRows.length} linhas...`);
      downloadCSV(allRows, 'bestsellers');
      setStatus('Concluído! CSV baixado.');
      await delay(1200);
      hideStatus();
    }catch(err){
      console.error(err);
      setStatus(`Erro: ${err.message || err}`);
    }finally{
      if (btn){
        btn.textContent = 'Exportar CSV (bestsellers)';
        btn.style.pointerEvents = 'auto';
      }
    }
  }

  // injeta quando o DOM estiver pronto
  function boot(){
    try{
      ensureUI();
      // Observa mudanças no body (SPA/PJAX)
      const obs = new MutationObserver(() => {
        // Em cada mudança relevante tentamos (re)injetar ou remover se saiu da página alvo
        ensureUI();
      });
      obs.observe(document.documentElement || document.body, { childList:true, subtree:true });
      log('Observer ligado.');
    }catch(e){
      log('boot error', e);
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

