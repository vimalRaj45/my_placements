// Frontend State Management
const state = {
  authenticated: false,
  currentTab: 'dashboard',
  companies: [],
  notes: [],
  files: [],
  emails: [],
  activeCompanyId: null,
  
  // AI Agent States
  agentMode: 'review', // 'review' | 'mock' | 'chat' | 'prep'
  agentHistory: {
    review: [],
    mock: [],
    chat: [],
    prep: []
  },
  mockTopic: '',
  mockHistory: [], // array of {role, content}
  chatHistory: [], // array of {role, content}
  chatSelectedFileId: '',
  prepSelectedFileId: '',
  prepFocus: 'aptitude',
  prepHistory: [], // array of {role, content}
  collapsedFolders: {}
};


// SweetAlert2 Toast Notification Setup
const Toast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 3000,
  timerProgressBar: true,
  didOpen: (toast) => {
    toast.addEventListener('mouseenter', Swal.stopTimer);
    toast.addEventListener('mouseleave', Swal.resumeTimer);
  }
});

function showToast(message, type = 'success') {
  Toast.fire({
    icon: type === 'success' ? 'success' : 'error',
    title: message
  });
}

// SweetAlert2 Confirmation Dialog Helper
async function confirmAction(title, text, confirmButtonText = 'Yes, delete it!') {
  const result = await Swal.fire({
    title: title,
    text: text,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#2563eb', // blue-600
    cancelButtonColor: '#64748b',  // slate-500
    confirmButtonText: confirmButtonText,
    cancelButtonText: 'Cancel',
    background: '#ffffff',
    color: '#0f172a'
  });
  return result.isConfirmed;
}

// Loading Spinner Helpers
function showLoading(text = 'Syncing workspace...') {
  document.getElementById('global-loading-text').innerText = text;
  document.getElementById('global-loading').classList.remove('hidden');
}

function hideLoading() {
  document.getElementById('global-loading').classList.add('hidden');
}

// API Fetch Helper
async function apiFetch(url, options = {}) {
  try {
    const res = await fetch(url, options);
    
    if (res.status === 401) {
      // Unauthenticated, force sign out
      state.authenticated = false;
      toggleAuthViews();
      return null;
    }
    
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }
    
    return await res.json().catch(() => ({}));
  } catch (err) {
    showToast(err.message, 'error');
    console.error(`API Fetch Error [${url}]:`, err);
    throw err;
  }
}

// Boot Check Session
async function checkAuthSession() {
  try {
    const data = await fetch('/api/session').then(r => r.json());
    if (data.authenticated) {
      state.authenticated = true;
      toggleAuthViews();
      await loadAllData();
      switchTab('dashboard');
    } else {
      state.authenticated = false;
      toggleAuthViews();
    }
  } catch (err) {
    state.authenticated = false;
    toggleAuthViews();
  }
}

// Toggle login vs workspace view
function toggleAuthViews() {
  const loginView = document.getElementById('login-view');
  const workspaceView = document.getElementById('workspace-view');
  
  if (state.authenticated) {
    loginView.classList.add('hidden');
    workspaceView.classList.remove('hidden');
    document.body.classList.remove('bg-slate-900');
    document.body.classList.add('bg-slate-50');
  } else {
    loginView.classList.remove('hidden');
    workspaceView.classList.add('hidden');
    document.body.classList.remove('bg-slate-50');
    document.body.classList.add('bg-slate-900');
  }
}

// Load Global Application Data
async function loadAllData() {
  if (!state.authenticated) return;
  
  try {
    state.companies = await apiFetch('/api/companies') || [];
    state.notes = await apiFetch('/api/notes') || [];
    state.files = await apiFetch('/api/files') || [];
    state.emails = await apiFetch('/api/emails') || [];
    
    // Check Gmail connection based on email list success
    const statusDot = document.getElementById('gmail-status-dot');
    if (state.emails.length > 0) {
      statusDot.innerHTML = '<span class="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span> Connected';
      statusDot.className = 'flex items-center gap-1.5 text-emerald-500';
    } else {
      statusDot.innerHTML = '<span class="w-2.5 h-2.5 rounded-full bg-slate-400"></span> Synced (Empty)';
      statusDot.className = 'flex items-center gap-1.5 text-slate-400';
    }

    // Refresh inbox badge count
    const unreadCount = state.emails.filter(e => e.is_important).length;
    const badge = document.getElementById('inbox-badge');
    if (unreadCount > 0) {
      badge.innerText = unreadCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
    
    // Update active view
    renderActiveTab();
    populateSelectDropdowns();
  } catch (err) {
    console.error('Failed to load workspace data:', err);
  }
}

// Populate UI dropdown selects
function populateSelectDropdowns() {
  const companySelects = [
    'upload-file-company',
    'note-company-input',
    'filter-note-company'
  ];

  companySelects.forEach(selectId => {
    const el = document.getElementById(selectId);
    if (!el) return;
    
    // Keep first option (placeholder option)
    const firstOpt = el.options[0];
    el.innerHTML = '';
    el.appendChild(firstOpt);
    
    state.companies.forEach(company => {
      const opt = document.createElement('option');
      opt.value = company.id;
      opt.innerText = company.name + (company.role ? ` (${company.role})` : '');
      el.appendChild(opt);
    });
  });
}

// Mobile Sidebar Toggling Logic
function openMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.classList.remove('-translate-x-full');
  if (sidebarOverlay) sidebarOverlay.classList.remove('hidden');
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.classList.add('-translate-x-full');
  if (sidebarOverlay) sidebarOverlay.classList.add('hidden');
}

// Switch between SPA tabs
function switchTab(tabId) {
  state.currentTab = tabId;
  state.activeCompanyId = null; // reset company details context
  closeMobileSidebar();
  
  // Set tab active styling
  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  // Set headers
  const viewTitle = document.getElementById('view-title');
  const titleMap = {
    dashboard: 'Dashboard Overview',
    pipeline: 'Kanban tracking Board',
    notes: 'Journal Notes & Interview Prep',
    resources: 'R2 Documents Portfolio & Shared Resources',
    agent: 'AI Prep Agent (Mistral Core)',
    inbox: 'Gmail Important Communications',
  };
  viewTitle.innerText = titleMap[tabId] || 'Workspace';
  
  renderActiveTab();
}

// Render active tab panel view
function renderActiveTab() {
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.add('hidden');
  });
  
  if (state.activeCompanyId) {
    document.getElementById('company-detail-section').classList.remove('hidden');
    renderCompanyDetails(state.activeCompanyId);
    return;
  }
  
  const activePanelId = `${state.currentTab}-section`;
  const activePanel = document.getElementById(activePanelId);
  if (activePanel) {
    activePanel.classList.remove('hidden');
  }
  
  // Call specific tab rendering functions
  if (state.currentTab === 'dashboard') renderDashboard();
  else if (state.currentTab === 'pipeline') renderPipeline();
  else if (state.currentTab === 'notes') renderNotes();
  else if (state.currentTab === 'resources') renderFiles();
  else if (state.currentTab === 'inbox') renderEmails();
  else if (state.currentTab === 'agent') renderAgentView();
}

// ==================== RENDERS ====================

// 1. Dashboard View
function renderDashboard() {
  // Counts
  const counts = { applied: 0, interview: 0, offer: 0, rejected: 0 };
  state.companies.forEach(c => {
    if (counts[c.status] !== undefined) counts[c.status]++;
  });
  
  document.getElementById('stat-applied').innerText = counts.applied;
  document.getElementById('stat-interview').innerText = counts.interview;
  document.getElementById('stat-offer').innerText = counts.offer;
  document.getElementById('stat-rejected').innerText = counts.rejected;
  
  // Build upcoming rounds (next 48h)
  const upcomingList = document.getElementById('dash-upcoming-rounds');
  upcomingList.innerHTML = '';
  
  // Collect all rounds from companies and extract upcoming ones
  const allRounds = [];
  // For each company, fetch rounds locally from database or we can load on the fly
  // For simplicity, we can fetch the upcoming rounds. Wait, we should load company names and rounds
  // Let's do a request to load all rounds, or filter from notes, or fetch directly.
  // Wait, let's fetch rounds dynamically for all companies, or we can fetch them via a special route.
  // But wait! We can fetch all rounds by querying rounds for each company.
  // Let's call GET /api/companies/rounds to get upcoming rounds, or we can fetch rounds for each company in parallel
  // or fetch dynamically. Let's make a call to GET /api/notes or load from state.
  // Wait, we have the rounds. Let's fetch all rounds in one request, or load for each active company.
  // Let's load the rounds list for all companies. Since it is a personal app with low scale, doing parallel fetches is very quick.
  
  if (state.companies.length === 0) {
    upcomingList.innerHTML = `<div class="p-6 text-center text-slate-400 text-sm">Add some company applications to schedule interview rounds.</div>`;
  } else {
    // Render list of companies with status 'interview' as a dashboard quick link
    let upcomingHtml = '';
    const interviewCompanies = state.companies.filter(c => c.status === 'interview');
    
    if (interviewCompanies.length === 0) {
      upcomingHtml = `<div class="p-6 text-center text-slate-400 text-sm">No companies in "Interview" status. Drag cards to interview column in Pipeline to schedule.</div>`;
    } else {
      interviewCompanies.forEach(c => {
        upcomingHtml += `
          <div class="p-4 hover:bg-slate-50 transition flex items-center justify-between cursor-pointer" onclick="viewCompanyDetails(${c.id})">
            <div>
              <h5 class="font-bold text-slate-800">${c.name}</h5>
              <span class="text-xs text-slate-500">${c.role || 'Software Role'} • ${c.location || 'Unknown location'}</span>
            </div>
            <span class="bg-blue-50 text-blue-600 text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1">
              <i class="bi bi-calendar2-range"></i> View Process
            </span>
          </div>
        `;
      });
    }
    upcomingList.innerHTML = upcomingHtml;
  }
  
  // Render recent notes
  const notesList = document.getElementById('dash-recent-notes');
  notesList.innerHTML = '';
  
  if (state.notes.length === 0) {
    notesList.innerHTML = `<div class="p-6 text-center text-slate-400 text-sm">No notes created yet. Click Notes in sidebar to create.</div>`;
  } else {
    state.notes.slice(0, 4).forEach(note => {
      const dateStr = new Date(note.updated_at).toLocaleDateString();
      const companyTag = note.company_name ? `<span class="bg-slate-100 text-slate-600 text-[10px] px-1.5 py-0.5 rounded font-medium">${note.company_name}</span>` : '';
      notesList.innerHTML += `
        <div class="p-4 hover:bg-slate-50 transition flex flex-col gap-1.5 cursor-pointer" onclick="editNote(${note.id})">
          <div class="flex items-center justify-between">
            <h5 class="font-bold text-slate-800 text-sm truncate">${note.title || 'Untitled Note'}</h5>
            <span class="text-[10px] text-slate-400">${dateStr}</span>
          </div>
          <p class="text-xs text-slate-500 line-clamp-1">${note.content.substring(0, 100)}</p>
          <div class="flex gap-2 items-center mt-0.5">
            ${companyTag}
          </div>
        </div>
      `;
    });
  }
}

// 2. Kanban Board Pipeline View
function renderPipeline() {
  const statuses = ['applied', 'interview', 'offer', 'rejected'];
  
  // Clear columns
  statuses.forEach(status => {
    document.getElementById(`column-${status}`).innerHTML = '';
    document.getElementById(`count-${status}`).innerText = '0';
  });
  
  const counts = { applied: 0, interview: 0, offer: 0, rejected: 0 };
  
  state.companies.forEach(company => {
    if (counts[company.status] !== undefined) {
      counts[company.status]++;
    }
    
    const col = document.getElementById(`column-${company.status}`);
    if (!col) return;
    
    const card = document.createElement('div');
    card.className = 'bg-white p-4 rounded-xl border border-slate-200/60 shadow-sm kanban-card flex flex-col gap-3 select-none';
    card.setAttribute('draggable', 'true');
    card.setAttribute('data-id', company.id);
    
    // Add drag handlers
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', company.id);
      card.style.opacity = '0.5';
    });
    
    card.addEventListener('dragend', () => {
      card.style.opacity = '1';
    });
    
    const dateStr = company.applied_date ? new Date(company.applied_date).toLocaleDateString() : 'No date';
    const pkgStr = company.package ? `<span class="bg-slate-50 text-slate-600 border border-slate-200/50 rounded-lg px-2 py-0.5"><i class="bi bi-cash"></i> ${company.package}</span>` : '';
    
    card.innerHTML = `
      <div class="flex flex-col gap-1">
        <h5 class="font-bold text-slate-800 text-sm hover:text-blue-600 transition flex items-center justify-between" onclick="viewCompanyDetails(${company.id})">
          <span>${company.name}</span>
          <i class="bi bi-arrow-right-short text-slate-400"></i>
        </h5>
        <span class="text-xs text-slate-500 font-medium">${company.role || 'Software Role'}</span>
      </div>
      
      <div class="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
        <span class="bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">${dateStr}</span>
        ${company.location ? `<span class="bg-slate-100 text-slate-500 rounded px-1.5 py-0.5"><i class="bi bi-geo-alt"></i> ${company.location}</span>` : ''}
      </div>
      
      ${pkgStr ? `<div class="text-xs flex items-center font-medium">${pkgStr}</div>` : ''}
    `;
    
    col.appendChild(card);
  });
  
  // Set counts
  statuses.forEach(status => {
    document.getElementById(`count-${status}`).innerText = counts[status];
  });
  
  // Register Dragover & Drop events for columns
  document.querySelectorAll('.kanban-column').forEach(col => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('drag-over');
    });
    
    col.addEventListener('dragleave', () => {
      col.classList.remove('drag-over');
    });
    
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      
      const companyId = e.dataTransfer.getData('text/plain');
      const newStatus = col.getAttribute('data-status');
      
      if (!companyId || !newStatus) return;
      
      // Optimistic update
      const companyIndex = state.companies.findIndex(c => c.id == companyId);
      if (companyIndex !== -1 && state.companies[companyIndex].status !== newStatus) {
        const oldStatus = state.companies[companyIndex].status;
        state.companies[companyIndex].status = newStatus;
        
        // Re-render
        renderPipeline();
        
        try {
          await apiFetch(`/api/companies/${companyId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
          });
          showToast(`Moved application to ${newStatus}`);
          // Reload other views silently
          loadAllData();
        } catch (err) {
          // Revert on failure
          state.companies[companyIndex].status = oldStatus;
          renderPipeline();
        }
      }
    });
  });
}

// 3. Notes View
function renderNotes() {
  const container = document.getElementById('notes-list-container');
  container.innerHTML = '';
  
  const filterVal = document.getElementById('filter-note-company').value;
  
  // Filter notes
  let filteredNotes = state.notes;
  if (filterVal) {
    if (filterVal === 'null') {
      filteredNotes = state.notes.filter(n => !n.company_id);
    } else {
      filteredNotes = state.notes.filter(n => n.company_id == filterVal);
    }
  }
  
  if (filteredNotes.length === 0) {
    container.innerHTML = `
      <div class="col-span-full bg-white p-8 text-center rounded-2xl border border-slate-200/50 text-slate-400 text-sm flex flex-col gap-2 items-center">
        <i class="bi bi-journal-x text-3xl"></i>
        <span>No preparation notes found for this filter.</span>
      </div>
    `;
    return;
  }
  
  filteredNotes.forEach(note => {
    const card = document.createElement('div');
    card.className = 'bg-white p-6 rounded-2xl border border-slate-200/50 shadow-sm flex flex-col gap-4 relative hover:shadow-md transition';
    
    const dateStr = new Date(note.updated_at).toLocaleDateString();
    const companyTag = note.company_name ? `<span class="bg-blue-50 text-blue-600 text-xs px-2 py-0.5 rounded-lg font-semibold">${note.company_name}</span>` : '';
    const roundTag = note.round_name ? `<span class="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-lg font-semibold">${note.round_name}</span>` : '';
    
    // Marked parsing for mini preview
    const parsedText = marked.parse(note.content.substring(0, 150) + (note.content.length > 150 ? '...' : ''));
    
    card.innerHTML = `
      <div class="flex flex-col gap-1.5">
        <div class="flex items-start justify-between gap-4">
          <h4 class="font-bold text-slate-800 text-base line-clamp-1">${note.title || 'Untitled Note'}</h4>
          <span class="text-xs text-slate-400 shrink-0 font-medium">${dateStr}</span>
        </div>
        <div class="flex flex-wrap gap-1.5 mt-1">
          ${companyTag}
          ${roundTag}
        </div>
      </div>
      
      <div class="text-slate-600 text-sm overflow-hidden line-clamp-3 markdown-content select-text prose">
        ${parsedText}
      </div>
      
      <div class="flex items-center justify-between border-t border-slate-100 pt-4 mt-auto">
        <button class="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1" onclick="editNote(${note.id})">
          <i class="bi bi-pencil-square"></i> Open & Edit
        </button>
        <button class="text-xs font-semibold text-rose-500 hover:text-rose-600 flex items-center gap-1" onclick="deleteNote(${note.id})">
          <i class="bi bi-trash"></i> Delete
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

// 4. File Portfolio/Resources View
// 4. File Portfolio/Resources View
function renderFiles() {
  const body = document.getElementById('files-table-body');
  body.innerHTML = '';
  
  const showShared = document.getElementById('file-tab-shared').classList.contains('border-blue-600');
  
  // Filter state.files
  const filteredFiles = state.files.filter(f => showShared ? f.is_shared : !f.is_shared);
  
  if (filteredFiles.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="5" class="p-8 text-center text-slate-400 text-sm">
          No files found in this category. Upload one above!
        </td>
      </tr>
    `;
    return;
  }

  // Initialize collapsedFolders if not exist
  if (!state.collapsedFolders) {
    state.collapsedFolders = {};
  }
  
  // Group files by folder
  const groups = {};
  filteredFiles.forEach(file => {
    const folderName = file.folder ? file.folder.trim() : '';
    if (!groups[folderName]) {
      groups[folderName] = [];
    }
    groups[folderName].push(file);
  });

  // Sort folder names (Uncategorized/Root folder goes last or first)
  const folderNames = Object.keys(groups).sort((a, b) => {
    if (a === '') return 1;
    if (b === '') return -1;
    return a.localeCompare(b);
  });

  folderNames.forEach(folderName => {
    const filesInFolder = groups[folderName];
    const isCollapsed = state.collapsedFolders[folderName] === true;
    
    // Create folder header row
    const folderHeaderRow = document.createElement('tr');
    folderHeaderRow.className = 'bg-slate-100/70 hover:bg-slate-100 cursor-pointer border-y border-slate-200/80 select-none text-slate-700 font-semibold text-sm';
    folderHeaderRow.onclick = () => {
      state.collapsedFolders[folderName] = !isCollapsed;
      renderFiles();
    };
    
    folderHeaderRow.innerHTML = `
      <td colspan="5" class="p-3 pl-6">
        <div class="flex items-center justify-between w-full">
          <div class="flex items-center gap-2">
            <i class="bi ${isCollapsed ? 'bi-folder' : 'bi-folder2-open'} text-blue-600 text-base"></i>
            <span class="font-bold text-slate-800">${folderName || 'General (Uncategorized)'}</span>
            <span class="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-bold ml-1.5">${filesInFolder.length}</span>
          </div>
          <div class="text-slate-400 mr-2">
            <i class="bi ${isCollapsed ? 'bi-chevron-down' : 'bi-chevron-up'} text-xs"></i>
          </div>
        </div>
      </td>
    `;
    body.appendChild(folderHeaderRow);

    // If not collapsed, render the files in the folder
    if (!isCollapsed) {
      filesInFolder.forEach(file => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-slate-50/50 transition border-b border-slate-100 text-sm';
        row.id = `file-row-${file.id}`; // for highlighting during search jump
        
        const sizeKb = file.size_bytes ? `${Math.round(file.size_bytes / 1024)} KB` : 'Unknown';
        const fileIcon = file.mime_type && file.mime_type.includes('pdf') ? 'bi-file-earmark-pdf-fill text-rose-500' : 'bi-file-earmark-fill text-slate-400';
        const companyLabel = file.company_name ? file.company_name : 'General Resource';
        
        row.innerHTML = `
          <td class="p-4 pl-12 flex items-center gap-3">
            <i class="bi ${fileIcon} text-lg"></i>
            <span class="font-bold text-slate-700 max-w-[200px] truncate" title="${file.label}">${file.label}</span>
          </td>
          <td class="p-4 text-slate-500 capitalize">${file.type.replace('_', ' ')}</td>
          <td class="p-4 text-slate-600 font-medium">${companyLabel}</td>
          <td class="p-4 text-slate-400">${sizeKb}</td>
          <td class="p-4 text-right pr-6 shrink-0 flex items-center justify-end gap-3.5">
            <button class="text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1" onclick="downloadFile(${file.id})">
              <i class="bi bi-download"></i> Download
            </button>
            ${!showShared ? `
              <button class="text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1" onclick="editFile(${file.id})">
                <i class="bi bi-pencil-square"></i> Edit
              </button>
              <button class="text-slate-400 hover:text-rose-600 font-semibold text-base" onclick="deleteFile(${file.id})">
                <i class="bi bi-trash"></i>
              </button>
            ` : ''}
          </td>
        `;
        body.appendChild(row);
      });
    }
  });
}


// 5. Emails View
function renderEmails() {
  const container = document.getElementById('inbox-list');
  container.innerHTML = '';
  
  const importantEmails = state.emails.filter(e => e.is_important);
  
  if (importantEmails.length === 0) {
    container.innerHTML = `
      <div class="bg-white p-12 text-center rounded-2xl border border-slate-200/50 text-slate-400 text-sm flex flex-col gap-2 items-center">
        <i class="bi bi-envelope-open text-3xl"></i>
        <span>Your inbox is clear! No active recruitment alerts.</span>
      </div>
    `;
    return;
  }
  
  importantEmails.forEach(mail => {
    const card = document.createElement('div');
    card.className = 'bg-white p-5 rounded-2xl border border-slate-200/50 shadow-sm flex flex-col gap-3 relative hover:shadow-md transition';
    
    const dateStr = new Date(mail.received_at).toLocaleString();
    const sourceTag = mail.classified_by === 'mistral' 
      ? '<span class="bg-purple-50 text-purple-600 border border-purple-200 text-[10px] px-1.5 py-0.5 rounded font-semibold flex items-center gap-0.5"><i class="bi bi-robot"></i> Mistral AI</span>' 
      : '<span class="bg-blue-50 text-blue-600 border border-blue-200 text-[10px] px-1.5 py-0.5 rounded font-semibold">Filter Keyword</span>';
    
    card.innerHTML = `
      <div class="flex flex-col gap-1">
        <div class="flex items-start justify-between gap-6">
          <h5 class="font-bold text-slate-800 text-sm">${mail.sender}</h5>
          <span class="text-xs text-slate-400 shrink-0 font-medium">${dateStr}</span>
        </div>
        <h4 class="font-bold text-slate-700 text-base mt-0.5 leading-snug">${mail.subject}</h4>
      </div>
      
      <p class="text-slate-500 text-sm leading-relaxed whitespace-pre-line">${mail.snippet}</p>
      
      <div class="flex items-center gap-2 border-t border-slate-100 pt-3 mt-1 justify-between">
        <div class="flex items-center gap-2">
          ${sourceTag}
          <span class="text-emerald-600 text-xs font-semibold flex items-center gap-1">
            <i class="bi bi-shield-check"></i> Placement Alert
          </span>
        </div>
        <button class="text-slate-400 hover:text-rose-600 transition font-semibold text-xs flex items-center gap-1" onclick="deleteEmail(${mail.id})">
          <i class="bi bi-trash"></i> Delete
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

// 6. Company Detail View
async function renderCompanyDetails(companyId) {
  const company = state.companies.find(c => c.id == companyId);
  if (!company) {
    switchTab('pipeline');
    return;
  }

  // Head details
  document.getElementById('detail-company-name').innerText = company.name;
  document.getElementById('detail-logo-placeholder').innerText = company.name.substring(0, 1).toUpperCase();
  document.getElementById('detail-role').innerHTML = `<i class="bi bi-briefcase"></i> ${company.role || 'Software Engineer'}`;
  document.getElementById('detail-package').innerHTML = `<i class="bi bi-cash-coin"></i> ${company.package || 'Not specified'}`;
  document.getElementById('detail-location').innerHTML = `<i class="bi bi-geo-alt"></i> ${company.location || 'Not specified'}`;
  document.getElementById('detail-status').value = company.status;
  
  // Status changer bind
  const statusEl = document.getElementById('detail-status');
  statusEl.onchange = async () => {
    const updatedStatus = statusEl.value;
    try {
      await apiFetch(`/api/companies/${companyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: updatedStatus })
      });
      showToast(`Updated status to ${updatedStatus}`);
      loadAllData();
    } catch (err) {
      statusEl.value = company.status; // revert
    }
  };

  // Edit / Delete binds
  document.getElementById('edit-company-btn').onclick = () => editCompany(companyId);
  document.getElementById('delete-company-btn').onclick = () => deleteCompany(companyId);

  // Load rounds
  const roundsList = document.getElementById('detail-rounds-list');
  roundsList.innerHTML = '<div class="p-6 text-center text-slate-400 text-sm animate-pulse">Retrieving interview rounds...</div>';
  
  try {
    const rounds = await apiFetch(`/api/companies/${companyId}/rounds`);
    roundsList.innerHTML = '';
    
    if (rounds.length === 0) {
      roundsList.innerHTML = `<div class="p-6 text-center text-slate-400 text-sm">No interview rounds scheduled. Click "Add Round" to add OA, Technical, or HR round.</div>`;
    } else {
      rounds.forEach(round => {
        const dateStr = round.scheduled_date ? new Date(round.scheduled_date).toLocaleString() : 'Not scheduled';
        const resultClass = round.result === 'passed' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' 
                          : round.result === 'failed' ? 'bg-rose-50 text-rose-600 border-rose-200' 
                          : 'bg-amber-50 text-amber-600 border-amber-200';
        
        const roundCard = document.createElement('div');
        roundCard.className = 'p-6 flex flex-col gap-3';
        roundCard.innerHTML = `
          <div class="flex items-center justify-between gap-4">
            <div>
              <h5 class="font-bold text-slate-800 text-base">${round.round_name}</h5>
              <span class="text-xs text-slate-500 font-medium"><i class="bi bi-calendar-event"></i> ${dateStr}</span>
            </div>
            <div class="flex items-center gap-3">
              <span class="border rounded-lg text-xs font-semibold px-2 py-0.5 capitalize ${resultClass}">${round.result}</span>
              <button class="text-xs font-semibold text-slate-500 hover:text-blue-600" onclick="editRound(${round.id}, ${companyId})">Edit</button>
              <button class="text-xs font-semibold text-rose-500 hover:text-rose-600" onclick="deleteRound(${round.id})">Delete</button>
            </div>
          </div>
          ${round.feedback ? `<p class="bg-slate-50 p-3 rounded-xl text-slate-600 text-xs border border-slate-100 whitespace-pre-line">${round.feedback}</p>` : ''}
        `;
        roundsList.appendChild(roundCard);
      });
    }
  } catch (err) {
    roundsList.innerHTML = '<div class="p-6 text-center text-rose-500 text-sm">Failed to retrieve rounds.</div>';
  }

  // Linked Notes
  const linkedNotesList = document.getElementById('detail-notes-list');
  linkedNotesList.innerHTML = '';
  
  const linkedNotes = state.notes.filter(n => n.company_id == companyId);
  if (linkedNotes.length === 0) {
    linkedNotesList.innerHTML = `<div class="col-span-full bg-slate-50 p-6 text-center rounded-xl text-slate-400 text-xs border border-slate-100">No notes linked to this application.</div>`;
  } else {
    linkedNotes.forEach(note => {
      const el = document.createElement('div');
      el.className = 'bg-slate-50/50 p-4 border border-slate-100 rounded-xl flex flex-col gap-2 hover:bg-slate-50 transition cursor-pointer';
      el.onclick = () => editNote(note.id);
      
      el.innerHTML = `
        <h5 class="font-bold text-slate-800 text-sm truncate">${note.title || 'Untitled Note'}</h5>
        <p class="text-xs text-slate-500 line-clamp-2">${note.content.replace(/[*#`\-_]/g, '')}</p>
      `;
      linkedNotesList.appendChild(el);
    });
  }

  // Binds for Notes modals
  document.getElementById('add-linked-note-btn').onclick = () => {
    document.getElementById('note-form').reset();
    document.getElementById('note-id-input').value = '';
    document.getElementById('note-company-input').value = companyId;
    document.getElementById('note-modal-title').innerText = `Linked Note for ${company.name}`;
    document.getElementById('note-modal').classList.remove('hidden');
  };

  // Linked Files
  const linkedFilesList = document.getElementById('detail-files-list');
  linkedFilesList.innerHTML = '';
  
  const linkedFiles = state.files.filter(f => f.company_id == companyId);
  if (linkedFiles.length === 0) {
    linkedFilesList.innerHTML = `<span class="text-slate-400 text-xs text-center py-4">No documents linked to this process.</span>`;
  } else {
    linkedFiles.forEach(file => {
      const el = document.createElement('div');
      el.className = 'flex items-center justify-between border border-slate-100 rounded-xl p-3 bg-slate-50/50 text-xs hover:bg-slate-50 transition';
      el.innerHTML = `
        <div class="flex items-center gap-2 truncate">
          <i class="bi bi-file-earmark-text text-slate-400"></i>
          <span class="font-semibold text-slate-700 truncate" title="${file.label}">${file.label}</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button class="text-blue-600 hover:text-blue-800 font-semibold" onclick="downloadFile(${file.id})">Get</button>
          <button class="text-rose-500 hover:text-rose-700" onclick="deleteFile(${file.id})"><i class="bi bi-trash"></i></button>
        </div>
      `;
      linkedFilesList.appendChild(el);
    });
  }

  // Binds for file uploading
  document.getElementById('company-detail-file-upload-btn').onclick = async () => {
    const fileInput = document.getElementById('company-detail-file-input');
    const fileType = document.getElementById('company-detail-file-type').value;
    
    if (fileInput.files.length === 0) {
      showToast('Please select a file to link', 'error');
      return;
    }
    
    await performFileUpload(fileInput.files[0], fileType, companyId, false);
    fileInput.value = ''; // clear
  };

  // Bind round addition modal
  document.getElementById('add-round-btn').onclick = () => {
    document.getElementById('round-form').reset();
    document.getElementById('round-id-input').value = '';
    document.getElementById('round-company-id-input').value = companyId;
    document.getElementById('round-modal-title').innerText = 'Add Interview Round';
    document.getElementById('round-modal').classList.remove('hidden');
  };
}

// 7. AI Agent Prep View
function renderAgentView() {
  // Render tabs highlight
  const modes = ['review', 'mock', 'prep', 'chat'];
  modes.forEach(m => {
    const btn = document.getElementById(`agent-tool-${m}`);
    if (m === state.agentMode) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Set header text
  const titleMap = {
    review: 'Resume Analyzer (Mistral)',
    mock: 'Mock Interview Prep (Mistral)',
    prep: 'Aptitude & Coding Prep Tutor (Mistral)',
    chat: 'General Career Coach (Mistral)'
  };
  document.getElementById('agent-header-title').innerText = titleMap[state.agentMode];

  // Load contextual controls into Left Side Context Panel
  const contextPanel = document.getElementById('agent-context-panel');
  contextPanel.innerHTML = '';

  if (state.agentMode === 'review') {
    // Resume Review Context Controls
    const resumesList = state.files.filter(f => f.type === 'resume');
    let resumeOptions = resumesList.map(r => `<option value="${r.id}">${r.label}</option>`).join('');
    
    contextPanel.innerHTML = `
      <div class="flex flex-col gap-4">
        <h5 class="font-bold text-slate-800 text-sm">Review Configurations</h5>
        <div>
          <label for="agent-resume-select" class="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Select Resume</label>
          <select id="agent-resume-select" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
            <option value="">-- Choose Uploaded Resume --</option>
            ${resumeOptions}
          </select>
          <p class="text-[10px] text-slate-400 mt-1">Upload resumes in "File Resources" page to list them here.</p>
        </div>
        <div>
          <label for="agent-jd-input" class="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Job Description</label>
          <textarea id="agent-jd-input" rows="8" placeholder="Paste the target job description here..."
            class="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:outline-none focus:border-blue-500 font-sans resize-none"></textarea>
        </div>
        <button id="agent-run-review-btn" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl shadow-md transition flex items-center justify-center gap-1.5">
          <i class="bi bi-lightning-charge-fill"></i> Analyze Resume
        </button>
      </div>
    `;

    document.getElementById('agent-run-review-btn').onclick = triggerResumeReview;

  } else if (state.agentMode === 'mock') {
    // Mock Interview Context Controls
    contextPanel.innerHTML = `
      <div class="flex flex-col gap-4">
        <h5 class="font-bold text-slate-800 text-sm">Setup Interview Session</h5>
        <div>
          <label for="agent-topic-input" class="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Topic / Job Role</label>
          <input type="text" id="agent-topic-input" placeholder="e.g. Node.js Developer, DSA Graph" value="${state.mockTopic}"
            class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500 font-sans">
        </div>
        <button id="agent-start-mock-btn" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl shadow-md transition flex items-center justify-center gap-1.5">
          <i class="bi bi-play-circle-fill"></i> Start Mock Session
        </button>
      </div>
    `;

    document.getElementById('agent-start-mock-btn').onclick = startMockInterview;

  } else if (state.agentMode === 'prep') {
    // Aptitude & Coding Prep Context Controls
    const filesList = state.files;
    let fileOptions = filesList.map(f => `<option value="${f.id}" ${state.prepSelectedFileId == f.id ? 'selected' : ''}>${f.label}</option>`).join('');

    contextPanel.innerHTML = `
      <div class="flex flex-col gap-4">
        <h5 class="font-bold text-slate-800 text-sm">Prep Tutor Settings</h5>
        <p class="text-xs text-slate-500 leading-normal">Load a study guide or syllabus (PDF/PPT/TXT) and select your target topic area to customize the tutor.</p>
        <div>
          <label for="agent-prep-file-select" class="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Study Material / Doc</label>
          <select id="agent-prep-file-select" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
            <option value="">-- No File Linked (General Prep) --</option>
            ${fileOptions}
          </select>
        </div>
        <div>
          <label for="agent-prep-focus-select" class="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Tutor Focus Area</label>
          <select id="agent-prep-focus-select" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
            <option value="aptitude" ${state.prepFocus === 'aptitude' ? 'selected' : ''}>Quantitative & Logical Aptitude</option>
            <option value="coding" ${state.prepFocus === 'coding' ? 'selected' : ''}>Coding & Algorithms</option>
          </select>
        </div>
        <button id="agent-start-prep-btn" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl shadow-md transition flex items-center justify-center gap-1.5">
          <i class="bi bi-play-circle-fill"></i> Initialize Prep Tutor
        </button>
      </div>
    `;

    document.getElementById('agent-prep-file-select').onchange = (e) => {
      state.prepSelectedFileId = e.target.value;
    };
    document.getElementById('agent-prep-focus-select').onchange = (e) => {
      state.prepFocus = e.target.value;
    };
    document.getElementById('agent-start-prep-btn').onclick = startPrepSession;

  } else if (state.agentMode === 'chat') {
    // General Chat Context Controls
    const filesList = state.files;
    let fileOptions = filesList.map(f => `<option value="${f.id}" ${state.chatSelectedFileId == f.id ? 'selected' : ''}>${f.label}</option>`).join('');

    contextPanel.innerHTML = `
      <div class="flex flex-col gap-4">
        <h5 class="font-bold text-slate-800 text-sm">Inject File Context</h5>
        <p class="text-xs text-slate-500 leading-normal">Link an uploaded file as background reference. Perfect for asking detailed questions about your resumes or portfolios.</p>
        <div>
          <label for="agent-chat-file-select" class="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Inject Document Context</label>
          <select id="agent-chat-file-select" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
            <option value="">-- No File Linked --</option>
            ${fileOptions}
          </select>
        </div>
      </div>
    `;

    document.getElementById('agent-chat-file-select').onchange = (e) => {
      state.chatSelectedFileId = e.target.value;
    };
  }

  // Render chat history messages
  renderAgentChatHistory();
  // Render agent input section
  renderAgentInput();
}

function renderAgentChatHistory() {
  const container = document.getElementById('agent-chat-history');
  container.innerHTML = '';

  const messages = state.agentHistory[state.agentMode];

  if (messages.length === 0) {
    let welcomeMsg = '';
    if (state.agentMode === 'review') {
      welcomeMsg = `
        <div class="flex flex-col items-center justify-center text-center gap-3 p-8 border border-slate-200/50 bg-slate-50/50 rounded-2xl max-w-md mx-auto my-auto text-slate-500 text-sm">
          <i class="bi bi-file-earmark-diff text-4xl text-blue-500"></i>
          <h4 class="font-bold text-slate-700">Ready for Resume Analysis</h4>
          <p class="leading-relaxed">Select one of your uploaded resumes, paste the target job description, and click "Analyze Resume" to receive detailed reviews, match scores, strengths, and actionable fixes.</p>
        </div>
      `;
    } else if (state.agentMode === 'mock') {
      welcomeMsg = `
        <div class="flex flex-col items-center justify-center text-center gap-3 p-8 border border-slate-200/50 bg-slate-50/50 rounded-2xl max-w-md mx-auto my-auto text-slate-500 text-sm">
          <i class="bi bi-chat-left-dots text-4xl text-blue-500"></i>
          <h4 class="font-bold text-slate-700">Simulate Mock Interviews</h4>
          <p class="leading-relaxed">Enter a target interview topic or role on the left sidebar (e.g., "Fullstack React Developer"), click "Start Mock Session", and participate in dynamic, interactive Q&A rounds with constructive feedback.</p>
        </div>
      `;
    } else if (state.agentMode === 'prep') {
      welcomeMsg = `
        <div class="flex flex-col items-center justify-center text-center gap-3 p-8 border border-slate-200/50 bg-slate-50/50 rounded-2xl max-w-md mx-auto my-auto text-slate-500 text-sm">
          <i class="bi bi-journal-code text-4xl text-blue-500"></i>
          <h4 class="font-bold text-slate-700">Aptitude & Coding Prep Tutor</h4>
          <p class="leading-relaxed">Select a study material (PDF/PPT/TXT) and focus area in the left panel, and click "Initialize Prep Tutor" to start your personalized exam and test preparation!</p>
        </div>
      `;
    } else {
      welcomeMsg = `
        <div class="flex flex-col items-center justify-center text-center gap-3 p-8 border border-slate-200/50 bg-slate-50/50 rounded-2xl max-w-md mx-auto my-auto text-slate-500 text-sm">
          <i class="bi bi-robot text-4xl text-blue-500"></i>
          <h4 class="font-bold text-slate-700">Personal Career Coach</h4>
          <p class="leading-relaxed">Ask any placement or technical question, prepare coding algorithms, or reference your portfolio. Link specific files for customized insights!</p>
        </div>
      `;
    }
    container.innerHTML = welcomeMsg;
    return;
  }

  messages.forEach(msg => {
    const isBot = msg.role === 'assistant';
    const row = document.createElement('div');
    row.className = `flex ${isBot ? 'justify-start' : 'justify-end'} w-full`;
    
    const bubble = document.createElement('div');
    bubble.className = `max-w-2xl px-5 py-3.5 shadow-sm text-sm ${isBot ? 'agent-bubble-bot markdown-content prose' : 'agent-bubble-user'}`;
    bubble.innerHTML = isBot ? marked.parse(msg.content) : msg.content.replace(/</g, '&lt;');

    row.appendChild(bubble);
    container.appendChild(row);
  });

  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

function renderAgentInput() {
  const container = document.getElementById('agent-input-container');
  container.innerHTML = '';

  if (state.agentMode === 'review') {
    container.innerHTML = `
      <div class="text-center text-xs text-slate-400 font-semibold uppercase tracking-wider py-2">
        Resume reviews are configured and generated from the left parameters panel.
      </div>
    `;
  } else if (state.agentMode === 'mock') {
    if (state.mockTopic === '' || state.agentHistory.mock.length === 0) {
      container.innerHTML = `
        <div class="text-center text-xs text-slate-400 font-semibold uppercase tracking-wider py-2">
          Setup topic and launch the session from the left parameters panel to begin.
        </div>
      `;
    } else {
      container.innerHTML = `
        <form id="agent-chat-form" class="flex gap-3">
          <input type="text" id="agent-message-input" required placeholder="Type your answer here..." autocomplete="off"
            class="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
          <button type="submit"
            class="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-5 py-3 shadow-md transition flex items-center justify-center">
            <i class="bi bi-send-fill"></i>
          </button>
        </form>
      `;
      document.getElementById('agent-chat-form').onsubmit = submitMockAnswer;
    }
  } else if (state.agentMode === 'prep') {
    if (state.agentHistory.prep.length === 0) {
      container.innerHTML = `
        <div class="text-center text-xs text-slate-400 font-semibold uppercase tracking-wider py-2">
          Configure tutor settings and initialize the prep session on the left panel to start.
        </div>
      `;
    } else {
      container.innerHTML = `
        <form id="agent-chat-form" class="flex gap-3">
          <input type="text" id="agent-message-input" required placeholder="Ask the prep tutor a question..." autocomplete="off"
            class="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
          <button type="submit"
            class="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-5 py-3 shadow-md transition flex items-center justify-center">
            <i class="bi bi-send-fill"></i>
          </button>
        </form>
      `;
      document.getElementById('agent-chat-form').onsubmit = submitPrepQuestion;
    }
  } else {
    // General Chat Input
    container.innerHTML = `
      <form id="agent-chat-form" class="flex gap-3">
        <input type="text" id="agent-message-input" required placeholder="Ask the Career Coach a question..." autocomplete="off"
          class="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
        <button type="submit"
          class="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-5 py-3 shadow-md transition flex items-center justify-center">
          <i class="bi bi-send-fill"></i>
        </button>
      </form>
    `;
    document.getElementById('agent-chat-form').onsubmit = submitGeneralChat;
  }
}

// ==================== INTERACTION LOGIC ====================

// Companies & Rounds Add/Edit Trigger
function viewCompanyDetails(companyId) {
  state.activeCompanyId = companyId;
  renderActiveTab();
}

function closeCompanyDetails() {
  state.activeCompanyId = null;
  renderActiveTab();
}

// Open modals
function editCompany(companyId) {
  const company = state.companies.find(c => c.id == companyId);
  if (!company) return;

  document.getElementById('company-id-input').value = company.id;
  document.getElementById('company-name-input').value = company.name;
  document.getElementById('company-role-input').value = company.role || '';
  document.getElementById('company-status-input').value = company.status;
  document.getElementById('company-date-input').value = company.applied_date ? company.applied_date.substring(0, 10) : '';
  document.getElementById('company-package-input').value = company.package || '';
  document.getElementById('company-location-input').value = company.location || '';
  
  document.getElementById('company-modal-title').innerText = 'Edit Application';
  document.getElementById('company-modal').classList.remove('hidden');
}

async function deleteCompany(companyId) {
  if (await confirmAction('Delete Application?', 'Are you sure you want to delete this company application? All linked rounds will be deleted.')) {
    showLoading('Deleting application...');
    apiFetch(`/api/companies/${companyId}`, { method: 'DELETE' })
      .then(() => {
        showToast('Application deleted successfully');
        loadAllData().then(() => {
          if (state.activeCompanyId == companyId) {
            closeCompanyDetails();
          }
        });
      })
      .finally(hideLoading);
  }
}

function editRound(roundId, companyId) {
  // We can fetch details or since we link rounds we will fetch from company rounds
  showLoading('Retrieving round details...');
  apiFetch(`/api/companies/${companyId}/rounds`)
    .then(rounds => {
      const round = rounds.find(r => r.id == roundId);
      if (!round) return;

      document.getElementById('round-id-input').value = round.id;
      document.getElementById('round-company-id-input').value = companyId;
      document.getElementById('round-name-input').value = round.round_name;
      document.getElementById('round-date-input').value = round.scheduled_date ? round.scheduled_date.substring(0, 16) : '';
      document.getElementById('round-result-input').value = round.result;
      document.getElementById('round-feedback-input').value = round.feedback || '';
      
      document.getElementById('round-modal-title').innerText = 'Edit Interview Round';
      document.getElementById('round-modal').classList.remove('hidden');
    })
    .finally(hideLoading);
}

async function deleteRound(roundId) {
  if (await confirmAction('Delete Interview Round?', 'Are you sure you want to delete this interview round?')) {
    showLoading('Deleting round...');
    apiFetch(`/api/rounds/${roundId}`, { method: 'DELETE' })
      .then(() => {
        showToast('Round deleted successfully');
        if (state.activeCompanyId) {
          renderCompanyDetails(state.activeCompanyId);
        }
      })
      .finally(hideLoading);
  }
}

function editNote(noteId) {
  const note = state.notes.find(n => n.id == noteId);
  if (!note) return;

  document.getElementById('note-id-input').value = note.id;
  document.getElementById('note-title-input').value = note.title || '';
  document.getElementById('note-company-input').value = note.company_id || '';
  document.getElementById('note-round-input').value = note.round_id || '';
  document.getElementById('note-content-input').value = note.content;
  
  document.getElementById('note-modal-title').innerText = 'Edit Note';
  document.getElementById('note-modal').classList.remove('hidden');
}

async function deleteNote(noteId) {
  if (await confirmAction('Delete Note?', 'Are you sure you want to delete this note?')) {
    showLoading('Deleting note...');
    apiFetch(`/api/notes/${noteId}`, { method: 'DELETE' })
      .then(() => {
        showToast('Note deleted successfully');
        loadAllData();
      })
      .finally(hideLoading);
  }
}

// Close Modals Helper
function closeModal(modalId) {
  document.getElementById(modalId).classList.add('hidden');
}

// ==================== FILES PORTFOLIO LOGIC ====================

// Pre-signed direct PUT uploads to Cloudflare R2
async function performFileUpload(file, type, companyId = null, isShared = false, folder = null) {
  showLoading(`Requesting signed R2 upload path for: ${file.name}...`);
  try {
    // 1. Get signed PUT URL from Fastify
    const payload = {
      filename: file.name,
      mime_type: file.type,
      type: type,
      company_id: companyId ? parseInt(companyId, 10) : null,
      size_bytes: file.size,
      is_shared: isShared,
      folder: folder || null
    };


    const res = await apiFetch('/api/files/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res || !res.signed_put_url) {
      throw new Error('Failed to generate upload URL.');
    }

    // 2. Perform direct PUT upload to R2 bucket via signed URL
    showLoading(`Uploading direct to Cloudflare R2 (${Math.round(file.size/1024)} KB)...`);
    const s3Res = await fetch(res.signed_put_url, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'application/octet-stream'
      },
      body: file
    });

    if (!s3Res.ok) {
      throw new Error(`Cloudflare R2 rejected upload: status ${s3Res.status}`);
    }

    showToast('File successfully uploaded direct to R2');
    await loadAllData();
    if (state.activeCompanyId) {
      renderCompanyDetails(state.activeCompanyId);
    }
  } catch (err) {
    showToast(`Upload failed: ${err.message}`, 'error');
  } finally {
    hideLoading();
  }
}

// Pre-signed GET downloads from Cloudflare R2
async function downloadFile(fileId) {
  showLoading('Generating signed download path...');
  try {
    const res = await apiFetch(`/api/files/${fileId}/download-url`);
    if (res && res.signed_get_url) {
      // Direct opening/downloading in browser via pre-signed GET URL
      window.open(res.signed_get_url, '_blank');
      showToast('Redirected to R2 download link');
    }
  } catch (err) {
    showToast('Could not fetch file download link', 'error');
  } finally {
    hideLoading();
  }
}

// Delete file
async function deleteFile(fileId) {
  if (await confirmAction('Delete File?', 'Are you sure you want to delete this document from R2? This cannot be undone.')) {
    showLoading('Deleting document...');
    try {
      await apiFetch(`/api/files/${fileId}`, { method: 'DELETE' });
      showToast('Document deleted successfully');
      await loadAllData();
      if (state.activeCompanyId) {
        renderCompanyDetails(state.activeCompanyId);
      }
    } catch (err) {
      console.error(err);
    } finally {
      hideLoading();
    }
  }
}

// Edit File Metadata (Full CRUD)
function editFile(fileId) {
  const file = state.files.find(f => f.id == fileId);
  if (!file) return;

  document.getElementById('file-id-input').value = file.id;
  document.getElementById('file-label-input').value = file.label;
  document.getElementById('file-type-input').value = file.type;
  document.getElementById('file-company-input').value = file.company_id || '';
  document.getElementById('file-shared-input').checked = file.is_shared;
  document.getElementById('file-folder-input').value = file.folder || '';

  document.getElementById('file-modal').classList.remove('hidden');
}


// Delete Sync Email (Full CRUD)
async function deleteEmail(emailId) {
  if (await confirmAction('Delete Email?', 'Are you sure you want to delete this synced email record from your platform logs?')) {
    showLoading('Deleting email...');
    try {
      await apiFetch(`/api/emails/${emailId}`, { method: 'DELETE' });
      showToast('Email deleted successfully');
      await loadAllData();
    } catch (err) {
      console.error(err);
    } finally {
      hideLoading();
    }
  }
}

// ==================== MISTRAL AGENT LOGIC ====================

// 1. Resume analyzer
async function triggerResumeReview() {
  const fileId = document.getElementById('agent-resume-select').value;
  const jobDesc = document.getElementById('agent-jd-input').value;

  if (!fileId) {
    showToast('Please select a resume file', 'error');
    return;
  }
  if (!jobDesc.trim()) {
    showToast('Please enter the target job description', 'error');
    return;
  }

  showLoading('Analyzing Resume with Mistral (this may take up to 20 seconds)...');
  
  // Create virtual user message in local history
  state.agentHistory.review = [
    { role: 'user', content: `Requesting review on selected resume against job description:\n\n${jobDesc.substring(0, 150)}...` },
    { role: 'assistant', content: 'Analyzing your resume contents from R2 storage. Please wait...' }
  ];
  renderAgentChatHistory();

  try {
    const res = await apiFetch('/api/agent/resume-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId, job_description: jobDesc })
    });

    state.agentHistory.review = [
      { role: 'user', content: `Requesting review on selected resume against job description:\n\n${jobDesc.substring(0, 150)}...` },
      { role: 'assistant', content: res.review }
    ];
  } catch (err) {
    state.agentHistory.review = [];
  } finally {
    hideLoading();
    renderAgentChatHistory();
  }
}

// 2. Mock Interview
async function startMockInterview() {
  const topic = document.getElementById('agent-topic-input').value.trim();
  if (!topic) {
    showToast('Please enter an interview topic or role', 'error');
    return;
  }

  state.mockTopic = topic;
  state.mockHistory = [];
  
  showLoading('Initializing mock interview prep...');
  
  state.agentHistory.mock = [
    { role: 'assistant', content: `Starting interview on **${topic}**. Please wait while I load the first question...` }
  ];
  renderAgentChatHistory();
  renderAgentInput();

  try {
    const res = await apiFetch('/api/agent/mock-interview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: topic, history: [] })
    });

    state.agentHistory.mock = [
      { role: 'assistant', content: res.response }
    ];
    state.mockHistory.push({ role: 'assistant', content: res.response });
  } catch (err) {
    state.agentHistory.mock = [];
  } finally {
    hideLoading();
    renderAgentChatHistory();
    renderAgentInput();
  }
}

async function submitMockAnswer(e) {
  e.preventDefault();
  const inputEl = document.getElementById('agent-message-input');
  const answer = inputEl.value.trim();
  if (!answer) return;

  inputEl.value = '';
  inputEl.disabled = true;

  // Optimistic add to chat view
  state.agentHistory.mock.push({ role: 'user', content: answer });
  state.agentHistory.mock.push({ role: 'assistant', content: 'Evaluating answer...' });
  renderAgentChatHistory();

  try {
    const res = await apiFetch('/api/agent/mock-interview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: state.mockTopic,
        previous_answer: answer,
        history: state.mockHistory
      })
    });

    // Remove evaluation placeholder
    state.agentHistory.mock.pop();
    state.agentHistory.mock.push({ role: 'assistant', content: res.response });
    
    // Save to history
    state.mockHistory.push({ role: 'user', content: answer });
    state.mockHistory.push({ role: 'assistant', content: res.response });
  } catch (err) {
    state.agentHistory.mock.pop();
  } finally {
    renderAgentChatHistory();
    renderAgentInput();
  }
}

// 3. General Coach Chat
async function submitGeneralChat(e) {
  e.preventDefault();
  const inputEl = document.getElementById('agent-message-input');
  const msg = inputEl.value.trim();
  if (!msg) return;

  inputEl.value = '';
  inputEl.disabled = true;

  state.agentHistory.chat.push({ role: 'user', content: msg });
  state.agentHistory.chat.push({ role: 'assistant', content: 'Coach is typing...' });
  renderAgentChatHistory();

  try {
    const res = await apiFetch('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: msg,
        file_id: state.chatSelectedFileId || null,
        history: state.chatHistory
      })
    });

    state.agentHistory.chat.pop();
    state.agentHistory.chat.push({ role: 'assistant', content: res.response });
    
    state.chatHistory.push({ role: 'user', content: msg });
    state.chatHistory.push({ role: 'assistant', content: res.response });
  } catch (err) {
    state.agentHistory.chat.pop();
  } finally {
    renderAgentChatHistory();
    renderAgentInput();
  }
}

// 4. Aptitude & Coding Prep Tutor Chat
function startPrepSession() {
  const fileId = state.prepSelectedFileId;
  const focus = state.prepFocus;
  const fileObj = state.files.find(f => f.id == fileId);
  const fileName = fileObj ? fileObj.label : 'None';
  const focusLabel = focus === 'coding' ? 'Coding & Algorithms' : 'Quantitative & Logical Aptitude';

  state.prepHistory = [];
  state.agentHistory.prep = [
    {
      role: 'assistant',
      content: `Hello! I am your **Aptitude & Coding Tutor**. I have initialized our learning session with the following settings:
- **Tutor Focus Area**: ${focusLabel}
- **Loaded Context Document**: ${fileName}

Ask me any questions on concepts, formula derivations, percentage calculations, coding algorithms, or request sample practice questions with step-by-step solutions!`
    }
  ];

  renderAgentChatHistory();
  renderAgentInput();
}

async function submitPrepQuestion(e) {
  e.preventDefault();
  const inputEl = document.getElementById('agent-message-input');
  const msg = inputEl.value.trim();
  if (!msg) return;

  inputEl.value = '';
  inputEl.disabled = true;

  state.agentHistory.prep.push({ role: 'user', content: msg });
  state.agentHistory.prep.push({ role: 'assistant', content: 'Tutor is typing...' });
  renderAgentChatHistory();

  try {
    const res = await apiFetch('/api/agent/prep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: msg,
        file_id: state.prepSelectedFileId || null,
        focus: state.prepFocus,
        history: state.prepHistory
      })
    });

    state.agentHistory.prep.pop();
    state.agentHistory.prep.push({ role: 'assistant', content: res.response });
    
    state.prepHistory.push({ role: 'user', content: msg });
    state.prepHistory.push({ role: 'assistant', content: res.response });
  } catch (err) {
    state.agentHistory.prep.pop();
  } finally {
    renderAgentChatHistory();
    renderAgentInput();
  }
}

// ==================== MANUAL SUBMIT FORMS ====================

document.getElementById('login-form').onsubmit = async (e) => {
  e.preventDefault();
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('login-error');
  
  errorEl.classList.add('hidden');
  showLoading('Authenticating placement key...');
  
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    
    if (res.ok) {
      state.authenticated = true;
      toggleAuthViews();
      await loadAllData();
      switchTab('dashboard');
      showToast('Welcome back, Vimal Raj!');
    } else {
      const err = await res.json().catch(() => ({}));
      document.getElementById('login-error-msg').innerText = err.error || 'Authentication failed';
      errorEl.classList.remove('hidden');
    }
  } catch (err) {
    showToast('Failed to contact auth server', 'error');
  } finally {
    hideLoading();
  }
};

// Logout Button
document.getElementById('logout-btn').onclick = async () => {
  if (await confirmAction('Sign Out?', 'Are you sure you want to log out of your placement workspace?')) {
    await fetch('/api/logout', { method: 'POST' });
    state.authenticated = false;
    toggleAuthViews();
    showToast('Logged out of placement workspace');
  }
};

// Global Add Company Button
document.getElementById('global-add-company').onclick = () => {
  document.getElementById('company-form').reset();
  document.getElementById('company-id-input').value = '';
  document.getElementById('company-modal-title').innerText = 'Add Application';
  document.getElementById('company-modal').classList.remove('hidden');
};

// Company Modal Form submit
document.getElementById('company-form').onsubmit = async (e) => {
  e.preventDefault();
  
  const id = document.getElementById('company-id-input').value;
  const payload = {
    name: document.getElementById('company-name-input').value,
    role: document.getElementById('company-role-input').value,
    status: document.getElementById('company-status-input').value,
    applied_date: document.getElementById('company-date-input').value || null,
    package: document.getElementById('company-package-input').value,
    location: document.getElementById('company-location-input').value
  };

  showLoading('Saving company metadata...');
  closeModal('company-modal');

  try {
    if (id) {
      await apiFetch(`/api/companies/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      showToast('Application updated successfully');
    } else {
      await apiFetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      showToast('New application registered');
    }
    await loadAllData();
  } catch (err) {
    console.error(err);
  } finally {
    hideLoading();
  }
};

// Round Modal Form submit
document.getElementById('round-form').onsubmit = async (e) => {
  e.preventDefault();
  
  const id = document.getElementById('round-id-input').value;
  const companyId = document.getElementById('round-company-id-input').value;
  
  const payload = {
    round_name: document.getElementById('round-name-input').value,
    scheduled_date: document.getElementById('round-date-input').value || null,
    result: document.getElementById('round-result-input').value,
    feedback: document.getElementById('round-feedback-input').value
  };

  showLoading('Saving round details...');
  closeModal('round-modal');

  try {
    if (id) {
      await apiFetch(`/api/rounds/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      showToast('Interview round updated');
    } else {
      await apiFetch(`/api/companies/${companyId}/rounds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      showToast('New interview round scheduled');
    }
    if (state.activeCompanyId) {
      renderCompanyDetails(state.activeCompanyId);
    }
  } catch (err) {
    console.error(err);
  } finally {
    hideLoading();
  }
};

// Notes Modal Form submit
document.getElementById('note-form').onsubmit = async (e) => {
  e.preventDefault();
  
  const id = document.getElementById('note-id-input').value;
  const payload = {
    title: document.getElementById('note-title-input').value,
    company_id: document.getElementById('note-company-input').value || null,
    round_id: document.getElementById('note-round-input').value || null,
    content: document.getElementById('note-content-input').value
  };

  showLoading('Saving prep notes...');
  closeModal('note-modal');

  try {
    if (id) {
      await apiFetch(`/api/notes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      showToast('Preparation note updated');
    } else {
      await apiFetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      showToast('Note saved successfully');
    }
    await loadAllData();
  } catch (err) {
    console.error(err);
  } finally {
    hideLoading();
  }
};

// Global Add Note Button
document.getElementById('add-note-btn').onclick = () => {
  document.getElementById('note-form').reset();
  document.getElementById('note-id-input').value = '';
  document.getElementById('note-company-input').value = '';
  document.getElementById('note-round-input').value = '';
  document.getElementById('note-modal-title').innerText = 'New Preparation Note';
  document.getElementById('note-modal').classList.remove('hidden');
};

// Direct File Upload form submit
document.getElementById('upload-file-form').onsubmit = async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById('upload-file-input');
  const type = document.getElementById('upload-file-type').value;
  const companyId = document.getElementById('upload-file-company').value;
  const isShared = document.getElementById('upload-file-shared').checked;
  const folder = document.getElementById('upload-file-folder').value.trim() || null;

  if (fileInput.files.length === 0) {
    showToast('Please select a file', 'error');
    return;
  }

  await performFileUpload(fileInput.files[0], type, companyId, isShared, folder);
  document.getElementById('upload-file-form').reset();
};


// File Edit Modal form submit (Full CRUD)
document.getElementById('file-edit-form').onsubmit = async (e) => {
  e.preventDefault();
  const id = document.getElementById('file-id-input').value;
  const payload = {
    label: document.getElementById('file-label-input').value,
    type: document.getElementById('file-type-input').value,
    company_id: document.getElementById('file-company-input').value || null,
    is_shared: document.getElementById('file-shared-input').checked,
    folder: document.getElementById('file-folder-input').value.trim() || null
  };


  showLoading('Saving document details...');
  closeModal('file-modal');

  try {
    await apiFetch(`/api/files/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    showToast('Document details updated successfully');
    await loadAllData();
    if (state.activeCompanyId) {
      renderCompanyDetails(state.activeCompanyId);
    }
  } catch (err) {
    console.error(err);
  } finally {
    hideLoading();
  }
};

// File Hub Tabs binding
document.getElementById('file-tab-my').onclick = () => {
  document.getElementById('file-tab-my').className = 'border-b-2 border-blue-600 pb-4 text-sm font-semibold text-blue-600 select-none';
  document.getElementById('file-tab-shared').className = 'border-b-2 border-transparent pb-4 text-sm font-semibold text-slate-500 hover:text-slate-800 select-none';
  renderFiles();
};

document.getElementById('file-tab-shared').onclick = () => {
  document.getElementById('file-tab-shared').className = 'border-b-2 border-blue-600 pb-4 text-sm font-semibold text-blue-600 select-none';
  document.getElementById('file-tab-my').className = 'border-b-2 border-transparent pb-4 text-sm font-semibold text-slate-500 hover:text-slate-800 select-none';
  renderFiles();
};

// Sync Mailbox buttons (Sidebar & Inbox page)
const triggerMailSync = async () => {
  showLoading('Fetching and classifying Gmail messages via IMAP... (usually takes 5-10s)');
  try {
    const res = await apiFetch('/api/emails/sync', { method: 'POST' });
    if (res && res.success) {
      showToast(`Sync complete! Synced ${res.count} new placement emails.`);
      await loadAllData();
    }
  } catch (err) {
    console.error(err);
  } finally {
    hideLoading();
  }
};
document.getElementById('sync-emails-btn').onclick = triggerMailSync;
document.getElementById('inbox-sync-btn').onclick = triggerMailSync;

// Sidebar navigation binds
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.onclick = () => {
    switchTab(btn.getAttribute('data-tab'));
  };
});

// Company details back button
document.getElementById('detail-back-btn').onclick = () => {
  closeCompanyDetails();
};

// Filter notes dropdown binding
document.getElementById('filter-note-company').onchange = () => {
  renderNotes();
};

// AI Agent tools tabs switching
document.getElementById('agent-tool-review').onclick = () => {
  state.agentMode = 'review';
  renderAgentView();
};
document.getElementById('agent-tool-mock').onclick = () => {
  state.agentMode = 'mock';
  renderAgentView();
};
document.getElementById('agent-tool-prep').onclick = () => {
  state.agentMode = 'prep';
  renderAgentView();
};
document.getElementById('agent-tool-chat').onclick = () => {
  state.agentMode = 'chat';
  renderAgentView();
};

// Reset AI chat bubbles
document.getElementById('clear-agent-chat-btn').onclick = async () => {
  if (await confirmAction('Reset Chat?', `Are you sure you want to reset the conversation for: ${state.agentMode}?`)) {
    state.agentHistory[state.agentMode] = [];
    if (state.agentMode === 'mock') {
      state.mockTopic = '';
      state.mockHistory = [];
    } else if (state.agentMode === 'prep') {
      state.prepSelectedFileId = '';
      state.prepFocus = 'aptitude';
      state.prepHistory = [];
    } else if (state.agentMode === 'chat') {
      state.chatHistory = [];
    }
    renderAgentView();
  }
};

// App Initialization
window.onload = () => {
  checkAuthSession();
  
  // Bind mobile sidebar toggle events
  const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
  const closeSidebarBtn = document.getElementById('close-sidebar-btn');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  
  if (mobileMenuToggle) mobileMenuToggle.onclick = openMobileSidebar;
  if (closeSidebarBtn) closeSidebarBtn.onclick = closeMobileSidebar;
  if (sidebarOverlay) sidebarOverlay.onclick = closeMobileSidebar;

  // Bind Search Panel Input Events (Debounced)
  let searchTimeout = null;
  const modalSearchInput = document.getElementById('modal-search-input');
  if (modalSearchInput) {
    modalSearchInput.oninput = (e) => {
      clearTimeout(searchTimeout);
      const query = e.target.value;
      searchTimeout = setTimeout(() => {
        performSearch(query);
      }, 250);
    };
  }

  // Bind global shortcut '/' key to trigger spotlight search
  window.onkeyup = (e) => {
    // If modal is active, Esc should close it
    if (e.key === 'Escape') {
      const searchModal = document.getElementById('search-modal');
      if (searchModal && !searchModal.classList.contains('hidden')) {
        closeModal('search-modal');
      }
    }
    
    // Check if user is typing in a form input
    const tag = e.target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) {
      return;
    }
    
    if (e.key === '/') {
      e.preventDefault();
      openSearchModal();
    }
  };
};

// ==================== SMART SPOTLIGHT SEARCH LOGIC ====================

function openSearchModal() {
  document.getElementById('modal-search-input').value = '';
  document.getElementById('search-default-state').innerHTML = `
    <i class="bi bi-compass text-3xl text-slate-300 animate-pulse"></i>
    <p class="text-sm font-bold text-slate-600">Search Prep Workspace</p>
    <p class="text-xs text-slate-400">Search for files by folder, notes by content, companies by role/status, or emails by sender.</p>
  `;
  document.getElementById('search-default-state').classList.remove('hidden');
  document.getElementById('search-results-list').classList.add('hidden');
  document.getElementById('search-modal').classList.remove('hidden');
  setTimeout(() => {
    document.getElementById('modal-search-input').focus();
  }, 50);
}

async function performSearch(query) {
  if (!query || !query.trim()) {
    document.getElementById('search-default-state').classList.remove('hidden');
    document.getElementById('search-results-list').classList.add('hidden');
    return;
  }

  try {
    const res = await apiFetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
    if (!res) return;

    // Check if any results
    const hasCompanies = res.companies && res.companies.length > 0;
    const hasNotes = res.notes && res.notes.length > 0;
    const hasFiles = res.files && res.files.length > 0;
    const hasEmails = res.emails && res.emails.length > 0;

    if (!hasCompanies && !hasNotes && !hasFiles && !hasEmails) {
      document.getElementById('search-default-state').innerHTML = `
        <i class="bi bi-search-heart text-3xl text-slate-300"></i>
        <p class="text-sm font-semibold text-slate-500">No results found for "${query}"</p>
        <p class="text-xs text-slate-400">Try searching for other keywords, folders, or company names.</p>
      `;
      document.getElementById('search-default-state').classList.remove('hidden');
      document.getElementById('search-results-list').classList.add('hidden');
      return;
    }

    // Hide default state
    document.getElementById('search-default-state').classList.add('hidden');
    document.getElementById('search-results-list').classList.remove('hidden');

    // 1. Render Companies
    const compGroup = document.querySelector('#search-sec-companies .search-group');
    compGroup.innerHTML = '';
    if (hasCompanies) {
      document.getElementById('search-sec-companies').classList.remove('hidden');
      res.companies.forEach(c => {
        const item = document.createElement('button');
        item.className = 'w-full text-left px-3 py-2.5 rounded-xl text-sm hover:bg-blue-50/50 transition flex items-center justify-between text-slate-700';
        item.onclick = () => jumpToSearchResult('company', c.id);
        item.innerHTML = `
          <div class="flex items-center gap-2.5">
            <span class="w-2.5 h-2.5 rounded-full ${getStatusDotClass(c.status)}"></span>
            <span class="font-bold text-slate-800">${c.name}</span>
            <span class="text-xs text-slate-400">— ${c.role || 'Unspecified Role'}</span>
          </div>
          <span class="text-xs bg-slate-100 text-slate-500 font-bold px-2 py-0.5 rounded capitalize">${c.status}</span>
        `;
        compGroup.appendChild(item);
      });
    } else {
      document.getElementById('search-sec-companies').classList.add('hidden');
    }

    // 2. Render Notes
    const noteGroup = document.querySelector('#search-sec-notes .search-group');
    noteGroup.innerHTML = '';
    if (hasNotes) {
      document.getElementById('search-sec-notes').classList.remove('hidden');
      res.notes.forEach(n => {
        const item = document.createElement('button');
        item.className = 'w-full text-left px-3 py-2.5 rounded-xl text-sm hover:bg-blue-50/50 transition flex flex-col gap-0.5 text-slate-700';
        item.onclick = () => jumpToSearchResult('note', n.id);
        item.innerHTML = `
          <div class="flex items-center gap-1.5 font-bold text-slate-800">
            <i class="bi bi-file-earmark-text text-amber-500"></i>
            <span>${n.title || 'Untitled Note'}</span>
          </div>
          <p class="text-xs text-slate-400 truncate w-full pl-5">${n.content.replace(/[#*`_-]/g, '').substring(0, 120)}</p>
        `;
        noteGroup.appendChild(item);
      });
    } else {
      document.getElementById('search-sec-notes').classList.add('hidden');
    }

    // 3. Render Files
    const fileGroup = document.querySelector('#search-sec-files .search-group');
    fileGroup.innerHTML = '';
    if (hasFiles) {
      document.getElementById('search-sec-files').classList.remove('hidden');
      res.files.forEach(f => {
        const item = document.createElement('button');
        item.className = 'w-full text-left px-3 py-2.5 rounded-xl text-sm hover:bg-blue-50/50 transition flex items-center justify-between text-slate-700';
        item.onclick = () => jumpToSearchResult('file', f.id, f.folder);
        const icon = f.type === 'resume' ? 'bi-file-earmark-pdf-fill text-rose-500' : 'bi-file-earmark-fill text-slate-400';
        item.innerHTML = `
          <div class="flex items-center gap-2.5">
            <i class="bi ${icon}"></i>
            <span class="font-bold text-slate-800 truncate max-w-[200px]">${f.label}</span>
            <span class="text-xs text-slate-400">— ${f.folder ? 'Folder: ' + f.folder : 'General'}</span>
          </div>
          <span class="text-xs text-slate-500 capitalize bg-slate-100 px-2 py-0.5 rounded">${f.type.replace('_', ' ')}</span>
        `;
        fileGroup.appendChild(item);
      });
    } else {
      document.getElementById('search-sec-files').classList.add('hidden');
    }

    // 4. Render Emails
    const emailGroup = document.querySelector('#search-sec-emails .search-group');
    emailGroup.innerHTML = '';
    if (hasEmails) {
      document.getElementById('search-sec-emails').classList.remove('hidden');
      res.emails.forEach(e => {
        const item = document.createElement('button');
        item.className = 'w-full text-left px-3 py-2.5 rounded-xl text-sm hover:bg-blue-50/50 transition flex flex-col gap-0.5 text-slate-700';
        item.onclick = () => jumpToSearchResult('email', e.id);
        item.innerHTML = `
          <div class="flex items-center gap-2 font-bold text-slate-800">
            <i class="bi bi-envelope text-blue-500"></i>
            <span class="truncate max-w-[250px]">${e.subject || '(No Subject)'}</span>
            <span class="text-[10px] text-slate-400 font-normal ml-auto">${new Date(e.received_at).toLocaleDateString()}</span>
          </div>
          <p class="text-xs text-slate-400 truncate w-full pl-5">${e.snippet || ''}</p>
        `;
        emailGroup.appendChild(item);
      });
    } else {
      document.getElementById('search-sec-emails').classList.add('hidden');
    }

  } catch (err) {
    console.error('Search failed:', err);
  }
}

function getStatusDotClass(status) {
  switch (status) {
    case 'applied': return 'bg-slate-400';
    case 'interview': return 'bg-blue-500';
    case 'offer': return 'bg-green-500';
    case 'rejected': return 'bg-red-500';
    default: return 'bg-slate-400';
  }
}

function jumpToSearchResult(type, id, folderHint = '') {
  closeModal('search-modal');
  
  if (type === 'company') {
    switchTab('pipeline');
    // Open company details sidebar immediately
    setTimeout(() => {
      renderCompanyDetails(id);
    }, 150);
  } else if (type === 'note') {
    switchTab('notes');
    // Click edit note immediately
    setTimeout(() => {
      editNote(id);
    }, 150);
  } else if (type === 'file') {
    switchTab('resources');
    // Expand folder and highlight row
    setTimeout(() => {
      const folderName = folderHint ? folderHint.trim() : '';
      if (state.collapsedFolders) {
        state.collapsedFolders[folderName] = false; // expand
      }
      renderFiles();
      // Scroll to row and highlight briefly
      const targetRow = document.getElementById(`file-row-${id}`);
      if (targetRow) {
        targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetRow.classList.add('bg-blue-50', 'ring-2', 'ring-blue-500/20');
        setTimeout(() => {
          targetRow.classList.remove('bg-blue-50', 'ring-2', 'ring-blue-500/20');
        }, 2000);
      }
    }, 250);
  } else if (type === 'email') {
    switchTab('inbox');
    // Scroll and highlight email
    setTimeout(() => {
      const targetRow = document.getElementById(`email-row-${id}`);
      if (targetRow) {
        targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetRow.classList.add('bg-blue-50', 'ring-2', 'ring-blue-500/20');
        setTimeout(() => {
          targetRow.classList.remove('bg-blue-50', 'ring-2', 'ring-blue-500/20');
        }, 2000);
      }
    }, 250);
  }
}

