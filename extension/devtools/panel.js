// DevTools Panel JavaScript
// Handles displaying ActionMap candidates and executing commands

let currentTabId = chrome.devtools.inspectedWindow.tabId;
let candidates = [];
let logs = [];
let currentTab = 'candidates';
let filterText = '';
let filterRole = '';

// DOM elements
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const content = document.getElementById('content');
const commandInput = document.getElementById('commandInput');
const executeBtn = document.getElementById('executeBtn');

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentTab = tab.dataset.tab;
        render();
    });
});

// Execute command
executeBtn.addEventListener('click', executeCommand);
commandInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') executeCommand();
});

function executeCommand() {
    const input = commandInput.value.trim();
    if (!input) return;

    const command = parseCommand(input);
    if (!command) {
        addLog('error', 'Invalid command format');
        return;
    }

    addLog('cmd', `Executing: ${command.type} ${command.id || ''}`);

    chrome.runtime.sendMessage({
        type: 'execute_command',
        tabId: currentTabId,
        command: command,
    }, (response) => {
        if (response.ok) {
            addLog('ok', 'Command sent');
        } else {
            addLog('fail', response.error || 'Failed to send command');
        }
    });

    commandInput.value = '';
}

function parseCommand(input) {
    // click <id>
    let match = input.match(/^click\s+(\S+)$/i);
    if (match) {
        return {
            type: 'click',
            commandId: `cmd_${Date.now()}`,
            id: match[1],
        };
    }

    // type <id> "text" or type <id> 'text'
    match = input.match(/^type\s+(\S+)\s+['"](.*)['"]$/i);
    if (match) {
        return {
            type: 'type',
            commandId: `cmd_${Date.now()}`,
            id: match[1],
            text: match[2],
            clearFirst: true,
        };
    }

    // hover <id>
    match = input.match(/^hover\s+(\S+)$/i);
    if (match) {
        return {
            type: 'hover',
            commandId: `cmd_${Date.now()}`,
            id: match[1],
        };
    }

    // scroll <dx> <dy>
    match = input.match(/^scroll\s+(-?\d+)\s+(-?\d+)$/i);
    if (match) {
        return {
            type: 'scroll',
            commandId: `cmd_${Date.now()}`,
            dx: parseInt(match[1]),
            dy: parseInt(match[2]),
        };
    }

    // focus <id>
    match = input.match(/^focus\s+(\S+)$/i);
    if (match) {
        return {
            type: 'focus',
            commandId: `cmd_${Date.now()}`,
            id: match[1],
        };
    }

    // select <id> "value"
    match = input.match(/^select\s+(\S+)\s+['"](.*)['"]$/i);
    if (match) {
        return {
            type: 'select',
            commandId: `cmd_${Date.now()}`,
            id: match[1],
            value: match[2],
        };
    }

    return null;
}

function addLog(type, message) {
    const time = new Date().toLocaleTimeString();
    logs.unshift({ time, type, message });
    if (logs.length > 100) logs.pop();
    if (currentTab === 'log') render();
}

// Update status
function updateStatus() {
    chrome.runtime.sendMessage({ type: 'get_connection_status' }, (response) => {
        if (response) {
            if (response.connected) {
                statusDot.classList.add('connected');
                statusDot.classList.remove('disconnected');
                statusText.textContent = `Connected (${response.tabCount} tabs)`;
            } else {
                statusDot.classList.remove('connected');
                statusDot.classList.add('disconnected');
                statusText.textContent = `Disconnected (retry ${response.reconnectAttempts})`;
            }
        }
    });
}

// Get tab state
function fetchTabState() {
    chrome.runtime.sendMessage({ type: 'get_tab_state', tabId: currentTabId }, (response) => {
        if (response && response.lastSnapshot) {
            candidates = response.lastSnapshot.candidates || [];
            render();
        }
    });
}

// Render content
function render() {
    switch (currentTab) {
        case 'candidates':
            renderCandidates();
            break;
        case 'log':
            renderLog();
            break;
        case 'settings':
            renderSettings();
            break;
    }
}

function renderCandidates() {
    const filtered = candidates.filter(c => {
        if (filterText && !c.name.toLowerCase().includes(filterText.toLowerCase()) &&
            !c.id.toLowerCase().includes(filterText.toLowerCase())) {
            return false;
        }
        if (filterRole && c.role !== filterRole) {
            return false;
        }
        return true;
    });

    const roles = [...new Set(candidates.map(c => c.role))].sort();

    content.innerHTML = `
    <div class="filter-bar">
      <input type="text" class="filter-input" id="filterInput" placeholder="Filter by name or ID..." value="${filterText}">
      <select class="filter-select" id="filterRole">
        <option value="">All roles</option>
        ${roles.map(r => `<option value="${r}" ${filterRole === r ? 'selected' : ''}>${r}</option>`).join('')}
      </select>
    </div>
    <div class="section">
      <div class="section-title">
        Action Candidates
        <span class="badge">${filtered.length} / ${candidates.length}</span>
      </div>
      <div class="candidate-list">
        ${filtered.map(c => `
          <div class="candidate ${c.occluded ? 'occluded' : ''} ${c.state.disabled ? 'disabled' : ''}" data-id="${c.id}">
            <div class="candidate-header">
              <span class="candidate-role">${c.role}</span>
              <span class="candidate-name">${escapeHtml(c.name || c.aria || c.placeholder || '(no name)')}</span>
              <span class="candidate-id">${c.id}</span>
            </div>
            <div class="candidate-meta">
              <span class="meta-item">📍 ${c.rect.x}, ${c.rect.y}</span>
              <span class="meta-item">📐 ${c.rect.w}×${c.rect.h}</span>
              ${c.state.focused ? '<span class="meta-item">🎯 focused</span>' : ''}
              ${c.occluded ? '<span class="meta-item">👁️ occluded</span>' : ''}
              ${c.ctx.inModal ? '<span class="meta-item">📦 modal</span>' : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

    // Event listeners
    document.getElementById('filterInput').addEventListener('input', (e) => {
        filterText = e.target.value;
        render();
    });

    document.getElementById('filterRole').addEventListener('change', (e) => {
        filterRole = e.target.value;
        render();
    });

    // Click to copy ID
    document.querySelectorAll('.candidate').forEach(el => {
        el.addEventListener('click', () => {
            const id = el.dataset.id;
            commandInput.value = `click ${id}`;
            commandInput.focus();
        });
    });
}

function renderLog() {
    content.innerHTML = `
    <div class="section">
      <div class="section-title">
        Command Log
        <span class="badge">${logs.length}</span>
      </div>
      <div class="log">
        ${logs.length === 0 ? '<div class="log-entry" style="color: #666">No commands yet</div>' : ''}
        ${logs.map(l => `
          <div class="log-entry">
            <span class="log-time">[${l.time}]</span>
            <span class="log-type ${l.type === 'ok' ? 'log-ok' : ''} ${l.type === 'fail' || l.type === 'error' ? 'log-fail' : ''}">[${l.type}]</span>
            ${escapeHtml(l.message)}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderSettings() {
    content.innerHTML = `
    <div class="section">
      <div class="section-title">Connection Settings</div>
      <div style="display: flex; flex-direction: column; gap: 8px; max-width: 400px;">
        <label style="color: #888">WebSocket URL</label>
        <input type="text" class="filter-input" id="wsUrl" value="ws://localhost:9333">
        <button class="command-btn" id="saveSettings" style="align-self: flex-start; margin-top: 8px;">Save & Reconnect</button>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Debug Actions</div>
      <div style="display: flex; gap: 8px;">
        <button class="command-btn" id="refreshSnapshot">Refresh Snapshot</button>
        <button class="command-btn" id="clearLogs" style="background: #666;">Clear Logs</button>
      </div>
    </div>
  `;

    document.getElementById('saveSettings').addEventListener('click', () => {
        const wsUrl = document.getElementById('wsUrl').value;
        chrome.runtime.sendMessage({
            type: 'update_config',
            config: { wsUrl }
        }, () => {
            addLog('ok', 'Settings saved, reconnecting...');
        });
    });

    document.getElementById('refreshSnapshot').addEventListener('click', () => {
        fetchTabState();
        addLog('ok', 'Requested snapshot refresh');
    });

    document.getElementById('clearLogs').addEventListener('click', () => {
        logs = [];
        addLog('ok', 'Logs cleared');
        render();
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initial load
updateStatus();
fetchTabState();
render();

// Periodic refresh
setInterval(() => {
    updateStatus();
    fetchTabState();
}, 2000);
