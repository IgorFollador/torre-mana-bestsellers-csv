// ==UserScript==
// @name         Torre de Maná - Exporter Bestsellers Magic: The Gathering Cards
// @namespace    https://waykey.com.br/
// @version      1.2.2
// @description  Exporta CSV de bestsellers
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

  let injected = false;
  let btn, statusBox, pagesWrap, pagesInput;

  function log(...args){ console.log('[TM-Bestsellers]', ...args); }

  GM_addStyle(`
    .tm-export-btn {
      position: fixed; z-index: 999999; right: 16px; bottom: 16px; padding: 10px 14px;
      background: #0ea5e9; color: #fff !important; font-weight: 600; border-radius: 10px;
      box-shadow: 0 4px 14px rgba(0,0,0,.2); cursor: pointer; user-select: none;
    }
    .tm-export-btn:hover { filter: brightness(0.95); }
    .tm-export-status {
      position: fixed; z-index: 999999; right: 16px; bottom: 60px; padding: 8px 12px;
      background: #111827; color: #fff; font-size: 12px; border-radius: 8px; opacity: 0.9;
      max-width: 50vw; white-space: pre-wrap; line-height: 1.3;
    }
    .tm-pages-wrap {
      position: fixed; z-index: 999999; right: 16px; bottom: 66px; display: flex; gap: 8px; align-items: center;
      background: #0b1220; color: #e5e7eb; padding: 6px 10px; border-radius: 10px; box-shadow: 0 4px 14px rgba(0,0,0,.2);
    }
    .tm-pages-wrap label { font-size: 12px; opacity: .9; }
    .tm-pages-input {
      width: 90px; padding: 6px 8px; border-radius: 8px; border: 1px solid #374151; background:#111827; color:#e5e7eb; outline: none;
    }
  `);

  function getViewFromLocation(loc = location.href){
    try{
      const u = new URL(loc);
      const raw = u.searchParams.get('view') || '';
      const norm = decodeURIComponent(raw || '').replace(/%2F/gi,'/');
      return norm || raw;
    }catch(e){ return ''; }
  }

  function looksLikeBestsellersDOM() {
    const ths = Array.from(document.querySelectorAll('table thead th')).map(th => th.textContent.trim().toLowerCase());
    const probe = ['rank','#','quant','vend','edição','edicao','menor','maior'];
    return probe.some(p => ths.some(h => h.includes(p)));
  }

  function isOnBestsellersPage(){
    const view = getViewFromLocation();
    const hrefHasEncoded = /view=ecom%2Fadmin%2Fstats%2Fbestsellers/i.test(location.search);
    const hrefLoose = /bestsellers/i.test(location.href);
    const domHeuristic = looksLikeBestsellersDOM();
    const ok = VIEW_REGEX.test(view) || hrefHasEncoded || hrefLoose || domHeuristic || window.__TM_FORCE === true;
    log('view:', view, 'encoded?', hrefHasEncoded, 'hrefLoose?', hrefLoose, 'dom?', domHeuristic, 'isOn?', ok);
    return ok;
  }

  function ensureUI(){
    if (!document.body) return;
    if (!isOnBestsellersPage()) { removeUI(); return; }
    if (injected) return;

    btn = document.createElement('div');
    btn.className = 'tm-export-btn';
    btn.textContent = 'Exportar CSV (bestsellers)';
    btn.addEventListener('click', exportAllPages);

    statusBox = document.createElement('div');
    statusBox.className = 'tm-export-status';
    statusBox.style.display = 'none';

    pagesWrap = document.createElement('div');
    pagesWrap.className = 'tm-pages-wrap';
    const pagesLabel = document.createElement('label');
    pagesLabel.textContent = 'Páginas a exportar';
    pagesInput = document.createElement('input');
    pagesInput.type = 'number';
    pagesInput.min = '0';
    pagesInput.step = '1';
    pagesInput.placeholder = '0 = todas';
    pagesInput.className = 'tm-pages-input';
    const saved = localStorage.getItem('tm_bests_pages') || '';
    if (saved) pagesInput.value = saved;
    pagesInput.addEventListener('change', () => {
      localStorage.setItem('tm_bests_pages', (pagesInput.value || '').trim());
    });
    pagesWrap.appendChild(pagesLabel);
    pagesWrap.appendChild(pagesInput);

    document.body.appendChild(btn);
    document.body.appendChild(pagesWrap);
    document.body.appendChild(statusBox);
    injected = true;
    log('UI pronta.');
  }

  function removeUI(){
    for (const el of [btn,statusBox,pagesWrap]) if (el && el.parentNode) el.parentNode.removeChild(el);
    btn = null; statusBox = null; pagesWrap = null; pagesInput = null; injected = false;
    log('UI removida.');
  }

  function setStatus(msg){
    if (!statusBox) return;
    statusBox.style.display = 'block';
    statusBox.textContent = String(msg);
  }
  function hideStatus(){ if (statusBox) statusBox.style.display = 'none'; }

  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  function toCSVLine(values) {
    return values.map(v => {
      let s = v == null ? '' : String(v);
      if (s.includes('"')) s = s.replace(/"/g, '""');
      if (/[,\n;"]/.test(s)) s = `"${s}"`;
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

  function normalizePrice(s) {
    if (!s) return '';
    let t = String(s).trim();

    if (/^[-–—]+$/.test(t)) return '';

    t = t.replace(/[Rr]\$|\s|\u00A0/gi, '');
    t = t.replace(/\.(?=\d{3}\b)/g, '');
    if (!t.includes(',')) t = t.replace(/\./g, '');
    t = t.replace(/,/g, '.');

    const match = t.match(/^-?\d+(?:\.\d+)?$/);
    if (match) return match[0];

    const num = t.match(/-?\d+(?:\.\d+)?/);
    return num ? num[0] : '';
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

      const menor = normalizePrice(get(idxMin));
      const medio = normalizePrice(get(idxAvg));
      const maior = normalizePrice(get(idxMax));

      const row = {
        rank: get(idxRank),
        quant_vend: get(idxQtd),
        card: get(idxCard),
        edicao: get(idxEd),
        menor_preco: menor,
        preco_medio: medio,
        maior_preco: maior,
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

  function getUserMaxPages(total){
    const raw = (pagesInput && pagesInput.value || '').trim();
    if (!raw) return total;
    const n = Math.max(0, parseInt(raw, 10) || 0);
    if (n === 0) return total;
    return Math.min(n, total);
  }

  async function exportAllPages(){
    try{
      if (!btn) return;
      btn.textContent = 'Exportando...';
      btn.style.pointerEvents = 'none';
      setStatus('Iniciando scraping...');

      const base = buildBaseURL();
      setStatus('Baixando página 1...');
      const firstHTML = await fetchHTML(base.toString());
      const firstDoc  = parseDocument(firstHTML);
      const firstRows = extractRowsFromDoc(firstDoc);
      if (!firstRows.length){ setStatus('Não encontrei linhas na página 1. Verifique filtros/login.'); return; }

      const totalPages = detectTotalPages(firstDoc) || 1;
      const maxToFetch = getUserMaxPages(totalPages);
      setStatus(`Páginas detectadas: ${totalPages}. Exportando até ${maxToFetch}.`);

      let allRows = [...firstRows];
      for (let page=2; page<=maxToFetch; page++){
        await delay(300);
        setStatus(`Baixando página ${page}/${maxToFetch}...`);
        const u = new URL(base.toString());
        u.searchParams.set('page', String(page));
        const html = await fetchHTML(u.toString());
        const doc  = parseDocument(html);
        const rows = extractRowsFromDoc(doc);
        if (!rows.length){ setStatus(`Página ${page} sem linhas. Encerrando na ${page-1}.`); break; }
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

  function boot(){
    try{
      ensureUI();
      const obs = new MutationObserver(() => { ensureUI(); });
      obs.observe(document.documentElement || document.body, { childList:true, subtree:true });
      log('Observer ligado.');
    }catch(e){ log('boot error', e); }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
