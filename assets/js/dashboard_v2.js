/* ===== AEGIS GODMODE v2.20 Extended Dashboard -- Cloudflare Pages API ===== */
const API = 'https://api-v2.staxpilot.com';
let currentTerminal = null;
let refreshInterval = null;
let autoRefresh = true;
let equityChart = null;

// Helper for CORS-safe fetch calls from Cloudflare Pages to API worker
async function apiFetch(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      ...options,
      mode: 'cors',
      credentials: 'omit',
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (e) {
    clearTimeout(timeoutId);
    console.error('Fetch error for ' + url + ':', e.name, e.message);
    throw e;
  }
}

// ==================== TABS ====================

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    
    // Trigger tab-specific loading
    if (btn.dataset.tab === 'terminals') loadMultiTerminal();
    if (btn.dataset.tab === 'chart') loadChartTerminals();
    if (btn.dataset.tab === 'logs') loadLogs();
    if (btn.dataset.tab === 'alerts') loadAlerts();
    if (btn.dataset.tab === 'calendar') loadCalendar();
    if (btn.dataset.tab === 'settings') loadConfig();
  });
});

// ==================== TERMINALS ====================

async function loadTerminals() {
  try {
    const res = await apiFetch(API + '/api/terminals');
    const data = await res.json();
    const sel = document.getElementById('terminalSelect');
    sel.innerHTML = '<option value="">-- Kies een actieve terminal --</option>';
    data.terminals.forEach((t, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.text = t.name + ' [ACTIEF - PID ' + t.pid + ']';
      sel.appendChild(opt);
    });
    document.getElementById('termCount').textContent = data.terminals.length;
    updateStatus(data.terminals.length > 0 ? 'ok' : 'warn', data.terminals.length + ' terminal(s) actief');
  } catch (e) {
    updateStatus('err', 'Kan terminals niet laden');
  }
}

async function connectTerminal() {
  const sel = document.getElementById('terminalSelect');
  const idx = sel.value;
  if (idx === '') { alert('Kies eerst een terminal'); return; }
  
  const btn = document.getElementById('connectBtn');
  btn.disabled = true;
  btn.textContent = 'Verbinden...';
  
  try {
    const res = await apiFetch(API + '/api/connect', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({index: parseInt(idx)})
    });
    const data = await res.json();
    if (data.ok) {
      currentTerminal = data.terminal;
      document.getElementById('selTerm').textContent = currentTerminal.name;
      document.getElementById('dashboard').style.display = 'block';
      document.getElementById('connectBtn').style.display = 'none';
      document.getElementById('disconnectBtn').style.display = 'inline-block';
      document.getElementById('errorArea').innerHTML = '';
      startAutoRefresh();
      showFlash('Verbonden met ' + currentTerminal.name, 'success');
    } else {
      showError(data.error || 'Connectie mislukt');
    }
  } catch (e) {
    showError('Verbindingsfout: ' + e.message);
  }
  btn.disabled = false;
  btn.textContent = 'Verbinden';
}

function disconnectTerminal() {
  currentTerminal = null;
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('connectBtn').style.display = 'inline-block';
  document.getElementById('disconnectBtn').style.display = 'none';
  document.getElementById('selTerm').textContent = '-';
  if (refreshInterval) clearInterval(refreshInterval);
  showFlash('Verbinding verbroken', 'info');
}

// ==================== REFRESH ====================

async function refreshData() {
  if (!currentTerminal) return;
  try {
    const res = await apiFetch(API + '/api/data');
    const data = await res.json();
    if (data.ok) {
      updateDashboard(data);
      document.getElementById('errorArea').innerHTML = '';
    } else {
      showError(data.error || 'Data ophalen mislukt');
    }
  } catch (e) {
    showError('Refresh mislukt: ' + e.message);
  }
}

function updateDashboard(data) {
  const a = data.account || {};
  const curr = a.currency || 'USD';
  const fmt = v => v === null || v === undefined ? '-' : v.toLocaleString('nl-NL', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' ' + curr;
  
  document.getElementById('mBalance').textContent = fmt(a.balance);
  document.getElementById('mEquity').textContent = fmt(a.equity);
  document.getElementById('mMargin').textContent = fmt(a.margin);
  document.getElementById('mFree').textContent = fmt(a.free_margin);
  document.getElementById('mProfit').textContent = fmt(a.profit);
  
  const profitEl = document.getElementById('mProfit');
  if (a.profit >= 0) { profitEl.className = 'value green'; } else { profitEl.className = 'value red'; }
  
  document.getElementById('mLogin').textContent = a.login || '-';
  document.getElementById('mServer').textContent = a.server || '-';
  document.getElementById('mCurrency').textContent = a.currency || '-';
  
  const pos = data.positions || [];
  document.getElementById('posCount').textContent = pos.length;
  
  const area = document.getElementById('positionsArea');
  if (pos.length === 0) {
    area.innerHTML = '<div class="no-pos">Geen open posities</div>';
  } else {
    let html = '<table class="positions-table"><thead><tr>';
    html += '<th>Ticket</th><th>Symbool</th><th>Type</th><th>Lots</th><th>Open</th><th>Huidig</th><th>P&L</th><th>Swap</th>';
    html += '</tr></thead><tbody>';
    pos.forEach(p => {
      const pnlClass = p.profit >= 0 ? 'pos' : 'neg';
      html += '<tr><td>' + p.ticket + '</td><td>' + p.symbol + '</td><td>' + p.type + '</td><td>' + p.volume.toFixed(2) + '</td><td>' + p.open_price.toFixed(5) + '</td><td>' + p.current_price.toFixed(5) + '</td><td class="pnl ' + pnlClass + '">' + p.profit.toFixed(2) + ' ' + curr + '</td><td>' + p.swap.toFixed(2) + '</td></tr>';
    });
    html += '</tbody></table>';
    area.innerHTML = html;
  }
  
  // Update position management tab
  updatePosManage(pos, curr);
  
  document.getElementById('lastUpdate').textContent = 'Laatste update: ' + new Date().toLocaleTimeString('nl-NL');
}

function startAutoRefresh() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshData();
  refreshInterval = setInterval(refreshData, 5000);
}

function updateStatus(type, text) {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  dot.className = 'dot ' + type;
  txt.textContent = text;
}

function showError(msg) {
  document.getElementById('errorArea').innerHTML = '<div class="error-msg">' + msg + '</div>';
}

function showFlash(msg, type) {
  const area = document.getElementById('flashArea');
  const color = type === 'success' ? 'var(--green)' : (type === 'error' ? 'var(--red)' : 'var(--accent)');
  area.innerHTML = '<div class="flash-notify" style="border-color:' + color + '">' + msg + '</div>';
  setTimeout(() => area.innerHTML = '', 3000);
}

// ==================== MULTI-TERMINAL ====================

async function loadMultiTerminal() {
  try {
    const res = await apiFetch(API + '/api/terminals/overview');
    const data = await res.json();
    
    if (data.ok) {
      const summary = data.summary;
      const profitClass = summary.total_profit >= 0 ? 'green' : 'red';
      document.getElementById('multiSummary').innerHTML = 
        'Terminals: <strong>' + summary.count + '</strong> | ' +
        'Total Balance: <strong>' + (summary.total_balance?.toFixed(2) || '0') + '</strong> | ' +
        'Total Equity: <strong>' + (summary.total_equity?.toFixed(2) || '0') + '</strong> | ' +
        'Total P&L: <strong class="' + profitClass + '">' + (summary.total_profit?.toFixed(2) || '0') + '</strong> | ' +
        'Total Positions: <strong>' + (summary.total_positions || 0) + '</strong>';
      
      document.getElementById('totalBalance').textContent = (summary.total_balance?.toFixed(2) || '0');
      document.getElementById('totalEquity').textContent = (summary.total_equity?.toFixed(2) || '0');
      document.getElementById('totalProfit').textContent = (summary.total_profit?.toFixed(2) || '0');
      
      const cards = document.getElementById('terminalCards');
      if (data.terminals.length === 0) {
        cards.innerHTML = '<div class="no-pos">Geen terminals gevonden</div>';
      } else {
        cards.innerHTML = data.terminals.map(t => {
          const profitClass = (t.profit || 0) >= 0 ? 'green' : 'red';
          const connClass = t.connected ? 'connected' : 'disconnected';
          const connText = t.connected ? 'CONNECTED' : 'OFFLINE';
          const lastSeen = t.last_seen ? new Date(t.last_seen * 1000).toLocaleTimeString('nl-NL') : '-';
          return `
            <div class="terminal-card" onclick="selectTerminalFromCard('${t.name}')">
              <div class="t-header">
                <span class="t-name">${t.name}</span>
                <span class="t-status ${connClass}">${connText}</span>
              </div>
              <div class="t-metrics">
                <div class="t-metric"><div class="label">Balance</div><div class="value">${(t.balance || 0).toFixed(2)}</div></div>
                <div class="t-metric"><div class="label">Equity</div><div class="value">${(t.equity || 0).toFixed(2)}</div></div>
                <div class="t-metric"><div class="label">P&L</div><div class="value ${profitClass}">${(t.profit || 0).toFixed(2)}</div></div>
                <div class="t-metric"><div class="label">Posities</div><div class="value">${t.positions || 0}</div></div>
              </div>
              <div style="margin-top:8px;font-size:0.75rem;color:var(--muted);">PID: ${t.pid || '-'} | Laatste update: ${lastSeen}</div>
            </div>
          `;
        }).join('');
      }
      
      document.getElementById('multiLastUpdate').textContent = 'Laatste update: ' + new Date().toLocaleTimeString('nl-NL');
    }
  } catch (e) {
    document.getElementById('terminalCards').innerHTML = '<div class="error-msg">Fout: ' + e.message + '</div>';
  }
}

function selectTerminalFromCard(name) {
  showFlash('Terminal ' + name + ' geselecteerd (verbind via Overzicht tab)', 'info');
}

// ==================== CHART ====================

async function loadChartTerminals() {
  const sel = document.getElementById('chartTerminal');
  try {
    const res = await apiFetch(API + '/api/terminals');
    const data = await res.json();
    sel.innerHTML = '<option value="">-- Selecteer terminal --</option>';
    data.terminals.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.text = t.name;
      sel.appendChild(opt);
    });
    if (currentTerminal) {
      sel.value = currentTerminal.name;
    }
  } catch (e) {}
}

async function loadChart() {
  const terminal = document.getElementById('chartTerminal').value;
  const hours = document.getElementById('chartHours').value;
  
  if (!terminal) {
    showFlash('Selecteer eerst een terminal', 'error');
    return;
  }
  
  try {
    const res = await apiFetch(API + '/api/history/equity?terminal=' + encodeURIComponent(terminal) + '&hours=' + hours);
    const data = await res.json();
    
    if (data.ok && data.history.length > 0) {
      const labels = data.history.map(h => new Date(h.timestamp * 1000).toLocaleTimeString('nl-NL', {hour:'2-digit', minute:'2-digit'}));
      const equityData = data.history.map(h => h.equity);
      const balanceData = data.history.map(h => h.balance);
      
      const ctx = document.getElementById('equityChart').getContext('2d');
      
      if (equityChart) equityChart.destroy();
      
      equityChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'Equity',
              data: equityData,
              borderColor: '#58a6ff',
              backgroundColor: 'rgba(88,166,255,0.1)',
              fill: true,
              tension: 0.3,
              pointRadius: 2
            },
            {
              label: 'Balance',
              data: balanceData,
              borderColor: '#39c5cf',
              backgroundColor: 'transparent',
              borderDash: [5, 5],
              tension: 0.3,
              pointRadius: 0
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { intersect: false, mode: 'index' },
          plugins: {
            legend: { labels: { color: '#c9d1d9' } },
            tooltip: {
              backgroundColor: '#161b22',
              titleColor: '#c9d1d9',
              bodyColor: '#c9d1d9',
              borderColor: '#30363d',
              borderWidth: 1
            }
          },
          scales: {
            x: { ticks: { color: '#8b949e', maxTicksLimit: 8 }, grid: { color: '#30363d' } },
            y: { ticks: { color: '#8b949e' }, grid: { color: '#30363d' } }
          }
        }
      });
    } else {
      document.getElementById('equityChart').style.display = 'none';
      showFlash('Geen data beschikbaar (collector moet draaien)', 'error');
    }
  } catch (e) {
    showError('Chart laden mislukt: ' + e.message);
  }
}

// ==================== POSITION MANAGEMENT ====================

function updatePosManage(positions, currency) {
  const area = document.getElementById('posManageArea');
  if (!currentTerminal) {
    area.innerHTML = '<div class="no-pos">Verbind eerst met een terminal</div>';
    return;
  }
  
  if (positions.length === 0) {
    area.innerHTML = '<div class="no-pos">Geen open posities</div>';
  } else {
    let html = '<table class="positions-table"><thead><tr>';
    html += '<th>Ticket</th><th>Symbool</th><th>Type</th><th>Lots</th><th>Open</th><th>Huidig</th><th>P&L</th><th>Actie</th>';
    html += '</tr></thead><tbody>';
    positions.forEach(p => {
      const pnlClass = p.profit >= 0 ? 'pos' : 'neg';
      html += '<tr>';
      html += '<td>' + p.ticket + '</td>';
      html += '<td>' + p.symbol + '</td>';
      html += '<td>' + p.type + '</td>';
      html += '<td>' + p.volume.toFixed(2) + '</td>';
      html += '<td>' + p.open_price.toFixed(5) + '</td>';
      html += '<td>' + p.current_price.toFixed(5) + '</td>';
      html += '<td class="pnl ' + pnlClass + '">' + p.profit.toFixed(2) + ' ' + currency + '</td>';
      html += '<td><button onclick="closePosition(' + p.ticket + ')" class="danger" style="padding:4px 8px;font-size:0.75rem;">Close</button></td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    area.innerHTML = html;
  }
  
  document.getElementById('posLastUpdate').textContent = 'Laatste update: ' + new Date().toLocaleTimeString('nl-NL');
}

async function closePosition(ticket) {
  if (!confirm('Weet je zeker dat je positie ' + ticket + ' wilt sluiten?')) return;
  
  const reason = prompt('Reden voor sluiten (optioneel):', 'Dashboard close');
  
  try {
    const res = await apiFetch(API + '/api/position/close', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ticket: ticket, reason: reason})
    });
    const data = await res.json();
    if (data.ok) {
      showFlash('Positie ' + ticket + ' gesloten', 'success');
      refreshData();
    } else {
      showError(data.error || 'Sluiten mislukt');
    }
  } catch (e) {
    showError('Fout: ' + e.message);
  }
}

async function closeAllPositions() {
  if (!confirm('WAARSCHUWING: Alle posities sluiten?\n\nDit kan niet ongedaan worden gemaakt!')) return;
  
  const reason = prompt('Reden voor sluiten alle posities:', 'Dashboard close all');
  
  try {
    const res = await apiFetch(API + '/api/position/closeall', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({reason: reason})
    });
    const data = await res.json();
    if (data.ok) {
      showFlash(data.closed + ' posities gesloten' + (data.failed > 0 ? ' (' + data.failed + ' mislukt)' : ''), 'success');
      refreshData();
    } else {
      showError(data.error || 'Sluiten mislukt');
    }
  } catch (e) {
    showError('Fout: ' + e.message);
  }
}

// ==================== LOGS ====================

async function loadLogs() {
  const level = document.getElementById('logLevel').value;
  const limit = document.getElementById('logLimit').value;
  
  try {
    const res = await apiFetch(API + '/api/logs?level=' + level + '&limit=' + limit);
    const data = await res.json();
    
    const area = document.getElementById('logsArea');
    if (data.ok && data.entries.length > 0) {
      let html = '<table class="log-table"><thead><tr><th>Tijd</th><th>Level</th><th>Bericht</th></tr></thead><tbody>';
      data.entries.forEach(e => {
        html += '<tr><td>' + e.timestamp + '</td><td><span class="log-level ' + e.level + '">' + e.level + '</span></td><td>' + e.message + '</td></tr>';
      });
      html += '</tbody></table>';
      area.innerHTML = html;
    } else {
      area.innerHTML = '<div class="no-pos">Geen logs gevonden</div>';
    }
    
    document.getElementById('logLastUpdate').textContent = 'Laatste update: ' + new Date().toLocaleTimeString('nl-NL');
  } catch (e) {
    document.getElementById('logsArea').innerHTML = '<div class="error-msg">Fout: ' + e.message + '</div>';
  }
}

function downloadLogs() {
  window.open(API + '/api/logs/download?format=csv', '_blank');
}

// ==================== ALERTS ====================

async function loadAlerts() {
  try {
    const [configRes, historyRes] = await Promise.all([
      apiFetch(API + '/api/alerts/config'),
      apiFetch(API + '/api/alerts/history')
    ]);
    
    const configData = await configRes.json();
    const historyData = await historyRes.json();
    
    // Config
    const configArea = document.getElementById('alertConfigArea');
    if (configData.ok) {
      let html = '';
      configData.config.forEach(c => {
        const label = c.type.replace('_', ' ').toUpperCase();
        html += `
          <div class="alert-config-row" data-type="${c.type}">
            <div class="label"><strong>${label}</strong></div>
            <div>Drempel: <input type="number" class="alert-threshold" value="${c.threshold}" step="0.1"></div>
            <div><input type="checkbox" class="alert-enabled" ${c.enabled ? 'checked' : ''}> Actief</div>
            <div><input type="checkbox" class="alert-telegram" ${c.telegram ? 'checked' : ''}> Telegram</div>
            <div><input type="checkbox" class="alert-sound" ${c.sound ? 'checked' : ''}> Sound</div>
            <div><input type="checkbox" class="alert-flash" ${c.flash ? 'checked' : ''}> Flash</div>
          </div>
        `;
      });
      configArea.innerHTML = html;
    }
    
    // History
    const historyArea = document.getElementById('alertHistoryArea');
    if (historyData.ok && historyData.alerts.length > 0) {
      let html = '<table class="log-table"><thead><tr><th>Tijd</th><th>Type</th><th>Bericht</th><th>Waarde</th></tr></thead><tbody>';
      historyData.alerts.forEach(a => {
        const time = new Date(a.timestamp * 1000).toLocaleString('nl-NL');
        html += '<tr><td>' + time + '</td><td><span class="log-level ERROR">' + a.type + '</span></td><td>' + a.message + '</td><td>' + (a.value || '-') + '</td></tr>';
      });
      html += '</tbody></table>';
      historyArea.innerHTML = html;
    } else {
      historyArea.innerHTML = '<div class="no-pos">Geen alerts getriggerd</div>';
    }
  } catch (e) {
    document.getElementById('alertConfigArea').innerHTML = '<div class="error-msg">Fout: ' + e.message + '</div>';
  }
}

async function saveAlertConfig() {
  const rows = document.querySelectorAll('.alert-config-row');
  const config = [];
  
  rows.forEach(row => {
    config.push({
      type: row.dataset.type,
      threshold: parseFloat(row.querySelector('.alert-threshold').value),
      enabled: row.querySelector('.alert-enabled').checked,
      telegram: row.querySelector('.alert-telegram').checked,
      sound: row.querySelector('.alert-sound').checked,
      flash: row.querySelector('.alert-flash').checked
    });
  });
  
  try {
    const res = await apiFetch(API + '/api/alerts/config', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({config: config})
    });
    const data = await res.json();
    if (data.ok) {
      showFlash('Alert configuratie opgeslagen', 'success');
    } else {
      showError('Opslaan mislukt');
    }
  } catch (e) {
    showError('Fout: ' + e.message);
  }
}

// ==================== CALENDAR ====================

async function loadCalendar() {
  try {
    const res = await apiFetch(API + '/api/calendar');
    const data = await res.json();
    
    const area = document.getElementById('calendarArea');
    if (data.ok && data.events.length > 0) {
      let html = '<table class="positions-table"><thead><tr><th>Tijd</th><th>Event</th><th>Impact</th><th>Valuta</th><th>Forecast</th><th>Previous</th></tr></thead><tbody>';
      data.events.forEach(e => {
        const impactClass = e.impact === 'high' ? 'red' : (e.impact === 'medium' ? 'yellow' : 'green');
        html += '<tr><td>' + e.time + '</td><td><strong>' + e.title + '</strong></td><td class="' + impactClass + '">' + e.impact.toUpperCase() + '</td><td>' + e.currency + '</td><td>' + e.forecast + '</td><td>' + e.previous + '</td></tr>';
      });
      html += '</tbody></table>';
      area.innerHTML = html;
    } else {
      area.innerHTML = '<div class="no-pos">Geen events (dummy data)</div>';
    }
  } catch (e) {
    document.getElementById('calendarArea').innerHTML = '<div class="error-msg">Fout: ' + e.message + '</div>';
  }
}

// ==================== SETTINGS ====================

async function loadConfig() {
  try {
    const res = await apiFetch(API + '/api/config');
    const data = await res.json();
    
    const area = document.getElementById('configArea');
    if (data.ok) {
      let html = '';
      for (const [key, value] of Object.entries(data.config)) {
        const isSecret = key.toLowerCase().includes('token') || key.toLowerCase().includes('password');
        html += `
          <div class="config-row">
            <label>${key}</label>
            <input type="${isSecret ? 'password' : 'text'}" class="config-input" data-key="${key}" value="${value || ''}">
          </div>
        `;
      }
      area.innerHTML = html;
    } else {
      area.innerHTML = '<div class="no-pos">Geen configuratie gevonden</div>';
    }
  } catch (e) {
    document.getElementById('configArea').innerHTML = '<div class="error-msg">Fout: ' + e.message + '</div>';
  }
}

async function saveConfig() {
  const inputs = document.querySelectorAll('.config-input');
  const config = {};
  inputs.forEach(input => {
    config[input.dataset.key] = input.value;
  });
  
  try {
    const res = await apiFetch(API + '/api/config', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(config)
    });
    const data = await res.json();
    if (data.ok) {
      showFlash('Instellingen opgeslagen', 'success');
    } else {
      showError('Opslaan mislukt');
    }
  } catch (e) {
    showError('Fout: ' + e.message);
  }
}

// ==================== INIT ====================

loadTerminals();
setInterval(loadTerminals, 30000);
setInterval(loadMultiTerminal, 10000);
