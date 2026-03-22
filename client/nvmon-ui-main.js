/* Copyright (c) 2018-2021 Gyeonghwan Hong. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

// 서버 이름 → ServerCard (O(1) 조회)
const serverCards = new Map();

window.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('grid');
  for (const s of NvmonConfig.serverList) {
    const card = new ServerCard(s.name, s.ip, s.port);
    serverCards.set(s.name, card);
    card.mount(grid);
  }
  refreshAll();
  scheduleRefresh();

  // 백그라운드 탭에서 복귀하면 즉시 갱신
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshAll();
  });
});

function refreshAll() {
  document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
  const dot = document.getElementById('dot');
  dot.classList.add('busy');
  setTimeout(() => dot.classList.remove('busy'), 600);
  for (const card of serverCards.values()) card.refresh();
}

function scheduleRefresh() {
  setTimeout(() => { refreshAll(); scheduleRefresh(); }, 3000);
}

function refreshServer(name) {
  serverCards.get(name)?.refresh();
}

/* ── Helpers ──────────────────────────────────────────────── */

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 서버 이름을 HTML ID로 안전하게 변환
function toId(name) {
  return name.replace(/[^a-zA-Z0-9-_]/g, '_');
}

// "NVIDIA GeForce RTX 3090" → "RTX 3090"
function shortModel(name) {
  return name.replace(/nvidia\s*/i, '').replace(/geforce\s*/i, '').trim();
}

function parsePct(str) {
  return Math.min(100, Math.max(0, parseInt(str) || 0));
}

function parseMiB(str) {
  const m = /(\d+)/.exec(str);
  return m ? parseInt(m[1]) : 0;
}

function mibToStr(mib) {
  return mib >= 1024 ? (mib / 1024).toFixed(1) + 'G' : mib + 'M';
}

// 라이트 테마 CSS 변수와 일치하는 색상
function tempColor(t) {
  if (t >= 80) return '#cf222e';  // --red
  if (t >= 65) return '#bc4c00';  // --orange
  if (t >= 50) return '#9a6700';  // --yellow
  return '#0969da';               // --blue
}

function pctColor(p) {
  if (p >= 85) return '#cf222e';  // --red
  if (p >= 60) return '#9a6700';  // --yellow
  return '#1a7f37';               // --green
}

// 사용자명 → 고정 색상 (같은 사용자는 항상 같은 색)
const USER_COLORS = ['#0969da', '#1a7f37', '#9a6700', '#bc4c00', '#8250df', '#1b7c83', '#cf222e', '#0550ae'];
function userColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return USER_COLORS[h % USER_COLORS.length];
}

// 대소문자 무시, 중복 없이
const BLACKLIST = ['xorg', 'gnome-shell', 'gnome'];
function blacklisted(name) {
  const lower = name.toLowerCase();
  return BLACKLIST.some(b => lower.includes(b));
}

/* ── Render helpers (모듈 레벨 — 매 render마다 재생성 안 함) ── */

function bar(pct, color) {
  return `<div class="m-bar"><div class="m-fill" style="width:${pct}%;background:${color};"></div></div>`;
}

function metric(label, value, color, pct) {
  return `<div class="metric">
    <div class="m-head">
      <span class="m-label">${label}</span>
      <span class="m-value" style="color:${color}">${value}</span>
    </div>
    ${bar(pct, color)}
  </div>`;
}

/* ── ServerCard ───────────────────────────────────────────── */

class ServerCard {
  constructor(name, ip, port) {
    this.name = name;
    this.ip   = ip;
    this.port = port || 8110;
    this.bodyEl     = null;
    this.dotEl      = null;
    this.refreshing = false;
    this.lastHtml   = null;
  }

  mount(container) {
    const id = toId(this.name);
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <div class="card-header">
        <div class="card-title">
          <span class="status-dot" id="dot-${id}"></span>
          <span class="srv-name">${esc(this.name)}</span>
          <span class="srv-ip">${esc(this.ip)}</span>
        </div>
        <button class="btn-refresh" onclick="refreshServer('${esc(this.name)}')">↻ Refresh</button>
      </div>
      <div id="body-${id}"><div class="state-msg">Loading…</div></div>`;
    container.appendChild(el);
    this.bodyEl = document.getElementById('body-' + id);
    this.dotEl  = document.getElementById('dot-' + id);
  }

  setStatus(s) {
    this.dotEl.className = 'status-dot ' + s;
  }

  refresh() {
    if (!this.bodyEl || this.refreshing) return;
    this.refreshing = true;

    const xhr = new XMLHttpRequest();
    xhr.timeout = 5000;

    const fail = () => {
      this.setStatus('offline');
      this.bodyEl.innerHTML = this.lastHtml
        ? this.lastHtml + '<div class="offline-notice">⚠ 오프라인 — 마지막 데이터 표시 중</div>'
        : '<div class="state-msg">연결 실패</div>';
      this.refreshing = false;
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      if (xhr.status !== 200) { fail(); return; }
      let data;
      try { data = JSON.parse(xhr.responseText); } catch(e) { fail(); return; }
      if (data.error) { fail(); return; }

      this.setStatus('online');
      const html = renderGpus(data);
      this.lastHtml = html;
      this.bodyEl.innerHTML = html;
      this.refreshing = false;
    };

    xhr.ontimeout = xhr.onerror = fail;
    xhr.open('GET', `http://${this.ip}:${this.port}`, true);
    xhr.send();
  }
}

/* ── Render ───────────────────────────────────────────────── */

function renderGpus(data) {
  const gpus = Array.isArray(data.nvidia_smi_log.gpu)
    ? data.nvidia_smi_log.gpu : [data.nvidia_smi_log.gpu];
  return gpus.map(renderGpuRow).join('');
}

function renderGpuRow(gpu) {
  const no     = gpu.minor_number;
  const model  = shortModel(gpu.product_name);
  const full   = gpu.product_name;
  const temp   = parseInt(gpu.temperature.gpu_temp) || 0;
  const gpuPct = parsePct(gpu.utilization.gpu_util);
  const usedM  = parseMiB(gpu.fb_memory_usage.used);
  const totalM = parseMiB(gpu.fb_memory_usage.total);
  const memPct = totalM > 0 ? Math.round(usedM / totalM * 100) : 0;

  const tc = tempColor(temp);
  const gc = pctColor(gpuPct);
  const mc = pctColor(memPct);

  // Processes
  let procHtml = '';
  let hasProcs = false;
  if (typeof gpu.processes === 'object' && typeof gpu.processes.process_info === 'object') {
    const list = Array.isArray(gpu.processes.process_info)
      ? gpu.processes.process_info : [gpu.processes.process_info];
    for (const p of list) {
      if (blacklisted(p.process_name)) continue;
      hasProcs = true;
      const user  = p.username || 'unknown';
      const pname = p.process_name.split('/').pop();
      const uc    = userColor(user);
      procHtml += `<span class="proc-chip" style="border-color:${uc}">
        <span class="proc-user" style="color:${uc}">${esc(user)}</span>
        <span class="proc-name">${esc(pname)}</span>
        <span class="proc-mem">${esc(p.used_memory)}</span>
      </span>`;
    }
  }

  // 사용 상태에 따른 row 클래스
  const rowClass = hasProcs && gpuPct > 0 ? 'active'
                 : hasProcs               ? 'reserved'
                 :                          '';

  return `<div class="gpu-row ${rowClass}">
    <div class="gpu-top">
      <span class="gpu-id">${esc(String(no))}</span>
      <span class="gpu-model" title="${esc(full)}">${esc(model)}</span>
      <div class="metrics">
        ${metric('Temp', temp + '°C',                               tc, Math.min(temp, 100))}
        ${metric('Util', gpuPct + '%',                              gc, gpuPct)}
        ${metric('Mem',  mibToStr(usedM) + '/' + mibToStr(totalM), mc, memPct)}
      </div>
    </div>
    ${procHtml
      ? `<div class="proc-list">${procHtml}</div>`
      : `<div class="no-proc">no processes</div>`}
  </div>`;
}
