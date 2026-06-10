const COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

const DEFAULT_RULES = [
  { name: 'Comms', color: 'blue', patterns: ['https?://mail\\.google\\.com', 'https?://calendar\\.google\\.com', 'https?://app\\.slack\\.com'], enabled: true },
  { name: 'Issues', color: 'yellow', patterns: ['https?://github\\.com/.+/issues'], enabled: true },
  { name: 'PRs', color: 'green', patterns: ['https?://github\\.com/.+/pull'], enabled: true },
];

let rules = [];
let dragSrcIndex = null;

async function loadRules() {
  const data = await chrome.storage.sync.get('rules');
  rules = data.rules || DEFAULT_RULES;
  render();
}

async function saveRules() {
  await chrome.storage.sync.set({ rules });
  showStatus('Saved');
}

function showStatus(msg) {
  const el = document.getElementById('status');
  el.textContent = msg;
  setTimeout(() => { el.textContent = ''; }, 2000);
}

function isValidRegex(str) {
  try { new RegExp(str); return true; } catch { return false; }
}

function render() {
  const container = document.getElementById('rules');
  container.innerHTML = '';

  rules.forEach((rule, ruleIndex) => {
    const el = document.createElement('div');
    el.className = 'rule';
    el.draggable = true;
    el.dataset.index = ruleIndex;

    el.addEventListener('dragstart', (e) => {
      dragSrcIndex = ruleIndex;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      document.querySelectorAll('.rule').forEach(r => r.classList.remove('drag-over'));
      dragSrcIndex = null;
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      if (dragSrcIndex === null || dragSrcIndex === ruleIndex) return;
      const moved = rules.splice(dragSrcIndex, 1)[0];
      rules.splice(ruleIndex, 0, moved);
      saveRules();
      render();
    });

    // Header
    const header = document.createElement('div');
    header.className = 'rule-header';

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '≡';

    const nameInput = document.createElement('input');
    nameInput.className = 'rule-name';
    nameInput.value = rule.name;
    nameInput.addEventListener('change', () => {
      rules[ruleIndex].name = nameInput.value;
      saveRules();
    });

    const colorSelect = document.createElement('select');
    colorSelect.className = 'color-select';
    COLORS.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      if (c === rule.color) opt.selected = true;
      colorSelect.appendChild(opt);
    });
    colorSelect.addEventListener('change', () => {
      rules[ruleIndex].color = colorSelect.value;
      saveRules();
    });

    const toggle = document.createElement('button');
    toggle.className = 'toggle' + (rule.enabled ? ' on' : '');
    toggle.addEventListener('click', () => {
      rules[ruleIndex].enabled = !rules[ruleIndex].enabled;
      saveRules();
      render();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-rule';
    deleteBtn.textContent = '×';
    deleteBtn.addEventListener('click', () => {
      rules.splice(ruleIndex, 1);
      saveRules();
      render();
    });

    header.append(handle, nameInput, colorSelect, toggle, deleteBtn);
    el.appendChild(header);

    // Patterns
    const patternsDiv = document.createElement('div');
    patternsDiv.className = 'patterns';

    rule.patterns.forEach((pattern, patIndex) => {
      const row = document.createElement('div');
      row.className = 'pattern-row';

      const input = document.createElement('input');
      input.className = 'pattern-input';
      input.value = pattern;
      input.placeholder = 'https?://example\\.com/.*';
      if (!isValidRegex(pattern)) input.classList.add('invalid');
      input.addEventListener('change', () => {
        rules[ruleIndex].patterns[patIndex] = input.value;
        input.classList.toggle('invalid', !isValidRegex(input.value));
        saveRules();
      });

      const removeBtn = document.createElement('button');
      removeBtn.className = 'pattern-remove';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        rules[ruleIndex].patterns.splice(patIndex, 1);
        saveRules();
        render();
      });

      row.append(input, removeBtn);
      patternsDiv.appendChild(row);
    });

    const addPatternBtn = document.createElement('button');
    addPatternBtn.className = 'add-pattern';
    addPatternBtn.textContent = '+ Add pattern';
    addPatternBtn.addEventListener('click', () => {
      rules[ruleIndex].patterns.push('');
      saveRules();
      render();
    });
    patternsDiv.appendChild(addPatternBtn);

    el.appendChild(patternsDiv);
    container.appendChild(el);
  });
}

// Add rule
document.getElementById('add-rule').addEventListener('click', () => {
  rules.push({ name: 'New Group', color: 'grey', patterns: [''], enabled: true });
  saveRules();
  render();
});

// Export
document.getElementById('export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tab-group-rules.json';
  a.click();
  URL.revokeObjectURL(url);
});

// Import
document.getElementById('import-btn').addEventListener('click', () => {
  document.getElementById('import-file').click();
});
document.getElementById('import-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const imported = JSON.parse(ev.target.result);
      if (!Array.isArray(imported)) throw new Error('not an array');
      rules = imported;
      await saveRules();
      render();
      showStatus('Imported ' + rules.length + ' rules');
    } catch {
      showStatus('Invalid file');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

loadRules();
