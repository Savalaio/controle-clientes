const API_URL = '/api';

// Get User ID from token
const userToken = localStorage.getItem('user_token');
const currentUser = userToken ? JSON.parse(userToken) : null;
const currentUserId = currentUser ? currentUser.id : null;
let currentPaymentPrefs = null;

// Auth Guard
if (!currentUserId) {
    window.location.href = 'login.html';
}

// Show Admin Button if admin
if (currentUser && (currentUser.role === 'admin' || currentUser.id === 1)) {
    const adminBtn = document.getElementById('adminBtn');
    if (adminBtn) adminBtn.classList.remove('hidden');
}

// Show WhatsApp Test Button if user is PRO or PREMIUM
if (currentUser && (currentUser.plan === 'pro' || currentUser.plan === 'premium' || currentUser.role === 'admin')) {
    const waTestBtn = document.getElementById('whatsappTestBtn');
    if (waTestBtn) waTestBtn.classList.remove('hidden');
}

function logout() {
    localStorage.removeItem('user_token');
    window.location.href = 'login.html';
}

let currentStatusFilter = 'Todos';

// Load initial data
document.addEventListener('DOMContentLoaded', () => {
    try {
        // Set User Name in Header
        if (currentUser) {
            const headerUserName = document.getElementById('headerUserName');
            if (headerUserName) {
                try {
                    let displayName = 'Usuário';
                    if (currentUser.name && typeof currentUser.name === 'string') {
                        displayName = currentUser.name.split(' ')[0];
                    } else if (currentUser.email) {
                        displayName = currentUser.email.split('@')[0];
                    }
                    
                    headerUserName.textContent = `| Olá, ${displayName}`;
                    headerUserName.classList.remove('hidden');
                } catch (errName) {
                    console.error('Error setting user name:', errName);
                    headerUserName.textContent = '| Olá';
                }
            }
        }

        // Carrega dados de forma independente para que um erro não bloqueie o outro
        loadClients().catch(e => console.error("Error in loadClients:", e));
        loadStats().catch(e => console.error("Error in loadStats:", e));
        loadPaymentPrefs().catch(e => console.error("Error in loadPaymentPrefs:", e));

    } catch (mainError) {
        console.error("CRITICAL ERROR in DOMContentLoaded:", mainError);
    }
});

// Modal functions
function openModal() {
    document.getElementById('modalTitle').textContent = 'Novo Cliente';
    document.getElementById('clientId').value = '';
    document.getElementById('clientForm').reset();
    document.getElementById('modal').classList.remove('hidden');
}

function openEditModal(clientId) {
    const client = allClients.find(c => c.id === clientId);
    if (!client) return;

    document.getElementById('modalTitle').textContent = 'Editar Cliente';
    document.getElementById('clientId').value = client.id;
    
    // Preenche o formulário
    const form = document.getElementById('clientForm');
    form.name.value = client.name;
    form.email.value = client.email;
    form.phone.value = client.phone;
    form.product.value = client.product;
    form.due_date.value = client.due_date;
    form.value.value = client.value;
    if (form.cpf) {
        form.cpf.value = client.cpf || '';
    }

    document.getElementById('modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('modal').classList.add('hidden');
    document.getElementById('clientForm').reset();
}

// Batch Modal Functions
function openBatchModal() {
    const tbody = document.getElementById('batchTableBody');
    tbody.innerHTML = '<tr class="animate-pulse"><td colspan="4" class="p-4 text-center">Carregando pendentes...</td></tr>';
    document.getElementById('batchModal').classList.remove('hidden');
    
    // Fetch pending clients
    fetch(`${API_URL}/clients?status=Pendente`, {
        headers: { 'x-user-id': currentUserId }
    })
        .then(res => res.json())
        .then(({ data }) => {
            tbody.innerHTML = '';
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-500">Nenhum cliente pendente.</td></tr>';
                return;
            }

            data.forEach(client => {
                const tr = document.createElement('tr');
                tr.className = 'hover:bg-gray-800 transition border-b border-gray-800';
                tr.innerHTML = `
                    <td class="p-3">
                        <div class="font-bold text-white">${client.name}</div>
                        <div class="text-xs text-gray-500">${client.phone || 'Sem telefone'}</div>
                    </td>
                    <td class="p-3 font-mono text-gray-300">${formatCurrency(client.value)}</td>
                    <td class="p-3 text-sm text-gray-400">${formatDate(client.due_date)}</td>
                    <td class="p-3 text-right">
                        <button onclick="sendWhatsapp('${client.phone}', '${client.name}', '${client.product}', ${client.value}, '${client.due_date}', '${client.status}')"
                                class="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm inline-flex items-center gap-1 transition">
                            <i class="fas fa-paper-plane"></i> Enviar
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        })
        .catch(err => {
            console.error(err);
            tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-red-500">Erro ao carregar clientes.</td></tr>';
        });
}

function closeBatchModal() {
    document.getElementById('batchModal').classList.add('hidden');
}

// Fetch Stats
async function loadStats() {
    try {
        const response = await fetch(`${API_URL}/stats`, {
            headers: { 'x-user-id': currentUserId }
        });
        const result = await response.json();
        const data = result.data || {};
        
        document.getElementById('totalPending').textContent = formatCurrency(data.pending_value || 0);
        document.getElementById('totalOverdue').textContent = formatCurrency(data.overdue_value || 0);
        document.getElementById('countPending').textContent = data.pending_count || 0;
        document.getElementById('monthReceived').textContent = formatCurrency(data.month_received || 0);

        // Calculate projection: Max of (Recurring Subs, Generated Invoices)
        const projection = Math.max(data.recurring || 0, data.month_projected || 0);
        const projectedEl = document.getElementById('monthProjected');
        if (projectedEl) {
            projectedEl.textContent = formatCurrency(projection);
        }

        renderChart(data);
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

let financeChartInstance = null;

function renderChart(data) {
    const ctx = document.getElementById('financeChart').getContext('2d');
    
    // Destroy previous instance if exists
    if (financeChartInstance) {
        financeChartInstance.destroy();
    }

    financeChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Recebido', 'Pendente', 'Vencido'],
            datasets: [{
                label: 'Valores (R$)',
                data: [data.total_received || 0, data.pending_value || 0, data.overdue_value || 0],
                backgroundColor: [
                    'rgba(34, 197, 94, 0.7)', // Green
                    'rgba(234, 179, 8, 0.7)', // Yellow
                    'rgba(239, 68, 68, 0.7)'  // Red
                ],
                borderColor: [
                    'rgba(34, 197, 94, 1)',
                    'rgba(234, 179, 8, 1)',
                    'rgba(239, 68, 68, 1)'
                ],
                borderWidth: 0,
                borderRadius: 6,
                barPercentage: 0.8,
                categoryPercentage: 0.9
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: '#cbd5e1', font: { size: 12 } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(context.parsed.y);
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(51, 65, 85, 0.5)' },
                    ticks: { 
                        color: '#cbd5e1',
                        callback: function(value) {
                            return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumSignificantDigits: 3 }).format(value);
                        }
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#cbd5e1' }
                }
            }
        }
    });
}

function exportCSV() {
    if (!allClients || allClients.length === 0) {
        alert('Sem dados para exportar.');
        return;
    }

    const headers = ['Nome', 'Email', 'Telefone', 'CPF', 'Produto', 'Vencimento', 'Valor', 'Status', 'Pago em'];
    const csvRows = [headers.join(',')];

    allClients.forEach(client => {
        const row = [
            `"${client.name}"`,
            `"${client.email || ''}"`,
            `"${client.phone || ''}"`,
            `"${client.cpf || ''}"`,
            `"${client.product}"`,
            client.due_date,
            client.value,
            client.status,
            client.paid_at || ''
        ];
        csvRows.push(row.join(','));
    });

    const csvContent = "data:text/csv;charset=utf-8," + csvRows.join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "relatorio_clientes.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Fetch Clients
async function loadClients() {
    const search = document.getElementById('searchInput').value;
    try {
        // Use simpler URL construction to avoid issues
        let urlStr = `${API_URL}/clients?`;
        if (currentStatusFilter !== 'Todos') {
            urlStr += `status=${encodeURIComponent(currentStatusFilter)}&`;
        }
        if (search) {
            urlStr += `search=${encodeURIComponent(search)}`;
        }

        const response = await fetch(urlStr, {
            headers: { 'x-user-id': currentUserId }
        });
        
        if (!response.ok) {
             const text = await response.text();
             throw new Error(`Server Error: ${response.status} - ${text}`);
        }

        const result = await response.json();
        const data = result.data || [];
        
        renderTable(data);
    } catch (error) {
        console.error('Error loading clients:', error);
        document.getElementById('clientsTableBody').innerHTML = 
            `<tr><td colspan="8" class="p-4 text-center text-red-500">
                <i class="fas fa-exclamation-triangle"></i> Erro: ${error.message}<br>
                <small class="text-gray-500">Tente recarregar a página</small>
            </td></tr>`;
    }
}

// Render Table
function renderTable(clients) {
    allClients = clients || [];
    const tbody = document.getElementById('clientsTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';

    if (!clients || clients.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="p-4 text-center text-gray-500">Nenhum cliente encontrado.</td></tr>';
        return;
    }

    clients.forEach((client, index) => {
        try {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-800 transition border-b border-gray-800'; // Added border-b for visibility
            
            const isPaid = client.status === 'Pago';
            
            let displayStatus = client.status;
            let displayStatusClass = 'bg-gray-700 text-gray-300';
            
            const today = new Date().toISOString().split('T')[0];
            if (client.status === 'Pago') {
                displayStatusClass = 'bg-green-900/50 text-green-400 border border-green-800';
            } else if (client.due_date < today) {
                displayStatus = '⚠️ VENCIDO'; 
                displayStatusClass = 'bg-red-600 text-white border border-red-500 animate-pulse font-bold shadow-lg shadow-red-500/50';
            } else {
                displayStatusClass = 'bg-blue-900/50 text-blue-400 border border-blue-800';
            }

            // Safe Access Helpers
            const safeName = client.name || 'Sem Nome';
            const safeEmail = client.email || '-';
            const safePhone = client.phone || '-';
            const safeProduct = client.product || '-';
            const safeValue = client.value !== undefined ? client.value : 0;
            const safeDueDate = client.due_date || '';
            const safeId = client.id;

            const safePaidAt = client.paid_at || '';

            tr.innerHTML = `
                <td class="p-4 font-semibold text-white" data-label="Nome">${safeName}</td>
                <td class="p-4 text-sm" data-label="Email/Tel">
                    <div class="text-white">${safeEmail}</div>
                    <div class="text-gray-500 text-xs">${safePhone}</div>
                </td>
                <td class="p-4 text-gray-300" data-label="CPF">${client.cpf || '-'}</td>
                <td class="p-4 text-gray-300" data-label="Produto">${safeProduct}</td>
                <td class="p-4 text-gray-300" data-label="Vencimento">${formatDate(safeDueDate)}</td>
                <td class="p-4 font-mono text-white" data-label="Valor">${formatCurrency(safeValue)}</td>
                <td class="p-4" data-label="Status">
                    <span class="px-2 py-1 rounded text-xs font-bold ${displayStatusClass} inline-block">
                        ${displayStatus}
                    </span>
                </td>
                <td class="p-4 text-sm text-gray-400" data-label="Pago Em">${client.paid_at ? formatDate(client.paid_at) : '-'}</td>
                <td class="p-4 text-center" data-label="Ações">
                    <div class="flex items-center justify-center gap-2">
                        <button onclick="openWhatsappModal(${index})" 
                                class="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm flex items-center gap-1" title="Cobrar no WhatsApp">
                            <i class="fas fa-comment"></i>
                        </button>
                        <button onclick="openAiModal(${index})" 
                                class="bg-pink-600 hover:bg-pink-700 text-white px-3 py-1 rounded text-sm flex items-center gap-1" title="Gerar Mensagem IA">
                            <i class="fas fa-magic"></i>
                        </button>
                        <button onclick="sendEmail(${safeId})" 
                                class="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded text-sm flex items-center gap-1" title="Reenviar E-mail">
                            <i class="fas fa-envelope"></i>
                        </button>
                        ${!isPaid ? `
                            <button onclick="markAsPaid(${safeId})" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm flex items-center gap-1" title="Marcar como Pago">
                                <i class="fas fa-check"></i>
                            </button>
                        ` : ''}
                        <button onclick="openEditModal(${safeId})" class="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded text-sm flex items-center gap-1" title="Editar">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button onclick="deleteClient(${safeId})" class="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm" title="Excluir">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        } catch (err) {
            console.error('Error rendering row:', err, client);
        }
    });
}

// Actions
async function handleFormSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const data = Object.fromEntries(formData.entries());
    const id = data.id;

    const method = id ? 'PUT' : 'POST';
    const url = id ? `${API_URL}/clients/${id}` : `${API_URL}/clients`;

    try {
        const response = await fetch(url, {
            method: method,
            headers: { 
                'Content-Type': 'application/json',
                'x-user-id': currentUserId
            },
            body: JSON.stringify(data)
        });
        
        const resData = await response.json();

        if (response.ok) {
            closeModal();
            loadClients();
            loadStats();
        } else {
            alert(resData.error || 'Erro ao salvar cliente');
        }
    } catch (error) {
        console.error('Error saving client:', error);
        alert('Erro de conexão ao salvar cliente');
    }
}

async function markAsPaid(id) {
    if (!confirm('Confirmar pagamento?')) return;
    try {
        await fetch(`${API_URL}/clients/${id}/pay`, { 
            method: 'PATCH',
            headers: { 'x-user-id': currentUserId }
        });
        loadClients();
        loadStats();
    } catch (error) {
        console.error('Error marking as paid:', error);
    }
}

async function deleteClient(id) {
    if (!confirm('Tem certeza que deseja excluir este cliente?')) return;
    try {
        await fetch(`${API_URL}/clients/${id}`, { 
            method: 'DELETE',
            headers: { 'x-user-id': currentUserId }
        });
        loadClients();
        loadStats();
    } catch (error) {
        console.error('Error deleting client:', error);
    }
}

// Helpers
function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatDate(dateString) {
    if (!dateString) return '-';
    const [year, month, day] = dateString.split('-');
    return `${day}/${month}/${year}`;
}

function getNextMonthDate(dateString) {
    if (!dateString) return null;
    const [yearStr, monthStr, dayStr] = dateString.split('-');
    let year = parseInt(yearStr, 10);
    let month = parseInt(monthStr, 10);
    const day = parseInt(dayStr, 10);
    if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
    month += 1;
    if (month > 12) {
        month = 1;
        year += 1;
    }
    const base = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0).getDate();
    const finalDay = Math.min(day, lastDay);
    const mm = String(month).padStart(2, '0');
    const dd = String(finalDay).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
}

function filterStatus(status) {
    currentStatusFilter = status;
    
    // Update active button styles
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('bg-blue-600', 'text-white');
        btn.classList.add('bg-gray-800');
    });
    const activeBtn = document.getElementById(`btn-${status}`);
    if (activeBtn) {
        activeBtn.classList.remove('bg-gray-800');
        activeBtn.classList.add('bg-blue-600', 'text-white');
    }

    loadClients();
}

function searchClients() {
    loadClients();
}

async function loadPaymentPrefs() {
    try {
        const res = await fetch(`${API_URL}/user/payment`, {
            headers: { 'x-user-id': currentUserId }
        });
        const prefs = await res.json();
        currentPaymentPrefs = prefs;
        const methodEl = document.getElementById('paymentMethod');
        const pixEl = document.getElementById('paymentPixKey');
        const instEl = document.getElementById('paymentInstructions');
        if (methodEl) {
            methodEl.value = prefs?.payment_method || 'whatsapp';
            togglePaymentFields(methodEl.value);
        }
        if (pixEl && prefs?.payment_pix_key) pixEl.value = prefs.payment_pix_key;
        if (instEl && prefs?.payment_instructions) instEl.value = prefs.payment_instructions;
        
        // Load SMTP
        if (prefs?.smtp_user) document.getElementById('smtpUser').value = prefs.smtp_user;
        if (prefs?.smtp_pass) document.getElementById('smtpPass').value = prefs.smtp_pass;

        // Load Logo
        if (prefs?.logo) {
            const preview = document.getElementById('logoPreview');
            if (preview) {
                preview.src = prefs.logo;
                preview.classList.remove('hidden');
            }
        }

        const msg = document.getElementById('paymentSaveMsg');
        if (msg) msg.textContent = 'Preferência carregada.';
    } catch (e) {
        console.error(e);
    }
}

function togglePaymentFields(method) {
    const pixEl = document.getElementById('paymentPixKey');
    const instEl = document.getElementById('paymentInstructions');
    if (!pixEl || !instEl) return;
    pixEl.classList.add('hidden');
    instEl.classList.add('hidden');
    if (method === 'pix') {
        pixEl.classList.remove('hidden');
    } else if (method === 'link' || method === 'boleto') {
        instEl.classList.remove('hidden');
    }
}

const methodSelect = document.getElementById('paymentMethod');
if (methodSelect) {
    methodSelect.addEventListener('change', (e) => togglePaymentFields(e.target.value));
}

async function uploadLogo() {
    const fileInput = document.getElementById('logoInput');
    const file = fileInput.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('logo', file);

    try {
        const res = await fetch(`${API_URL}/upload-logo`, {
            method: 'POST',
            headers: { 'x-user-id': currentUserId },
            body: formData
        });
        const data = await res.json();
        if (res.ok) {
            const preview = document.getElementById('logoPreview');
            preview.src = data.logo;
            preview.classList.remove('hidden');
            // Update current prefs
            if (currentPaymentPrefs) {
                currentPaymentPrefs.logo = data.logo;
            } else {
                currentPaymentPrefs = { logo: data.logo };
            }
            alert('Logo atualizada com sucesso!');
        } else {
            alert(data.error || 'Erro ao enviar logo');
        }
    } catch (e) {
        console.error(e);
        alert('Erro de conexão ao enviar logo');
    }
}

async function savePaymentPrefs() {
    const methodEl = document.getElementById('paymentMethod');
    const pixEl = document.getElementById('paymentPixKey');
    const instEl = document.getElementById('paymentInstructions');
    const smtpUser = document.getElementById('smtpUser').value;
    const smtpPass = document.getElementById('smtpPass').value;

    const body = {
        payment_method: methodEl ? methodEl.value : 'whatsapp',
        payment_pix_key: pixEl ? pixEl.value : null,
        payment_instructions: instEl ? instEl.value : null
    };
    try {
        // Save SMTP first
        await fetch(`${API_URL}/user/smtp`, {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'x-user-id': currentUserId 
            },
            body: JSON.stringify({ smtp_user: smtpUser, smtp_pass: smtpPass })
        });

        const res = await fetch(`${API_URL}/user/payment`, {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'x-user-id': currentUserId 
            },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        const msg = document.getElementById('paymentSaveMsg');
        if (res.ok) {
            if (msg) msg.textContent = 'Preferência salva com sucesso.';
        } else {
            if (msg) msg.textContent = data?.error || 'Erro ao salvar.';
        }
    } catch (e) {
        console.error(e);
    }
}

async function generateWhatsappMessage(phone, name, product, value, dueDate, status, paidAt) {
    if (!phone) {
        throw new Error('Cliente sem telefone cadastrado!');
    }
    const formattedValue = formatCurrency(value);
    const formattedDate = formatDate(dueDate);
    
    if (!currentPaymentPrefs) {
        try {
            const res = await fetch(`${API_URL}/user/payment`, {
                headers: { 'x-user-id': currentUserId }
            });
            currentPaymentPrefs = await res.json();
        } catch (e) {}
    }
    let paymentLine = '';
    const pm = currentPaymentPrefs?.payment_method || 'whatsapp';
    const rawInstructions = (currentPaymentPrefs?.payment_instructions || '').trim();
    if (pm === 'pix' && currentPaymentPrefs?.payment_pix_key) {
        paymentLine = `\n\nChave PIX: *${currentPaymentPrefs.payment_pix_key}*`;
        paymentLine += `\nPagar via PIX de preferência.`;
    } else if ((pm === 'link' || pm === 'boleto') && rawInstructions) {
        paymentLine = `\n\n${rawInstructions}`;
    }
    
    const todayStr = new Date().toISOString().split('T')[0];
    let diffDays = null;
    if (dueDate) {
        const due = new Date(dueDate + 'T00:00:00');
        const todayDate = new Date(todayStr + 'T00:00:00');
        diffDays = Math.round((due - todayDate) / (1000 * 60 * 60 * 24));
    }
    const normalizedStatus = (status || '').toString().trim().toLowerCase();
    // Consider paid if status is 'pago'/'paid' OR if there is a paid_at date
    const isPaid = normalizedStatus === 'pago' || normalizedStatus === 'paid' || (paidAt && paidAt !== 'null' && paidAt !== '');
    const formattedPaidAt = paidAt ? formatDate(paidAt) : '';
    let message;

    if (isPaid) {
        message = `Olá ${name}, muito obrigado pelo seu pagamento referente a *${product}*! Tenha um excelente dia!`;
    } else {
        let statusText;
        if (diffDays !== null && diffDays < 0) {
            statusText = `que está em atraso. Ela venceu em *${formattedDate}*`;
        } else if (diffDays === 0) {
            statusText = `que vence *hoje* (${formattedDate})`;
        } else if (diffDays === 2) {
            statusText = `que vence em *${formattedDate}* (daqui a 2 dias). Não esqueça de pagar para evitar atrasos!`;
        } else if (dueDate) {
            statusText = `que vence em *${formattedDate}*`;
        } else {
            statusText = `com vencimento em *${formattedDate}*`;
        }

        message = `Olá ${name}, lembramos que sua fatura referente a *${product}* no valor de *${formattedValue}* ${statusText}.${paymentLine}`;
    }
    
    if (currentPaymentPrefs?.logo && !isPaid) {
         // Generate rich preview short link
         try {
             const res = await fetch(`${API_URL}/invoice-share`, {
                 method: 'POST',
                 headers: {
                     'Content-Type': 'application/json',
                     'x-user-id': currentUserId
                 },
                 body: JSON.stringify({
                     client_name: name,
                     value: formattedValue,
                     due_date: formattedDate,
                     logo: currentPaymentPrefs.logo,
                     status,
                     paid_at: formattedPaidAt
                 })
             });
           const data = await res.json();
           if (data.url) {
               message += `\n\nVEJA O DETALHE > ${data.url}`;
           }
         } catch(e) { console.error(e); }
    }

    return message;
}

let currentWhatsappClient = null;

async function openWhatsappModal(index) {
    currentWhatsappClient = allClients[index];
    if (!currentWhatsappClient) return;

    const modal = document.getElementById('whatsappModal');
    const loading = document.getElementById('whatsappLoading');
    const resultDiv = document.getElementById('whatsappResult');
    const textArea = document.getElementById('whatsappMessageText');
    const sendBtn = document.getElementById('whatsappSendBtn');

    modal.classList.remove('hidden');
    loading.classList.remove('hidden');
    resultDiv.classList.add('hidden');
    sendBtn.classList.add('hidden');
    textArea.value = '';

    try {
        const message = await generateWhatsappMessage(
            currentWhatsappClient.phone,
            currentWhatsappClient.name,
            currentWhatsappClient.product,
            currentWhatsappClient.value,
            currentWhatsappClient.due_date,
            currentWhatsappClient.status,
            currentWhatsappClient.paid_at
        );
        textArea.value = message;
        loading.classList.add('hidden');
        resultDiv.classList.remove('hidden');
        sendBtn.classList.remove('hidden');
        sendBtn.style.display = 'flex';
    } catch (e) {
        loading.classList.add('hidden');
        alert(e.message || 'Erro ao montar mensagem');
        closeWhatsappModal();
    }
}

function closeWhatsappModal() {
    document.getElementById('whatsappModal').classList.add('hidden');
    currentWhatsappClient = null;
}

function sendWhatsappFromModal() {
    if (!currentWhatsappClient) return;
    const phone = currentWhatsappClient.phone;
    if (!phone) {
        alert('Cliente sem telefone cadastrado!');
        return;
    }
    const cleanPhone = phone.replace(/\D/g, '');
    const message = document.getElementById('whatsappMessageText').value;
    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/55${cleanPhone}?text=${encodedMessage}`;
    window.open(whatsappUrl, '_blank');
    closeWhatsappModal();
}

async function sendEmail(clientId) {
    if (!confirm('Deseja reenviar o e-mail de cobrança para este cliente?')) return;
    
    try {
        const response = await fetch(`${API_URL}/clients/${clientId}/email`, {
            method: 'POST',
            headers: { 'x-user-id': currentUserId }
        });
        
        if (response.ok) {
            alert('E-mail enviado com sucesso!');
        } else {
            const data = await response.json();
            alert(data.error || 'Erro ao enviar e-mail');
        }
    } catch (error) {
        console.error('Error sending email:', error);
        alert('Erro ao enviar e-mail. Verifique as configurações de SMTP.');
    }
}

// AI Message Functions
let currentAiClient = null;

function openAiModal(index) {
    currentAiClient = allClients[index];
    if (!currentAiClient) return;

    document.getElementById('aiModal').classList.remove('hidden');
    document.getElementById('aiResult').classList.add('hidden');
    document.getElementById('aiSendBtn').classList.add('hidden');
    document.getElementById('aiLoading').classList.add('hidden');
    document.getElementById('aiMessageText').value = '';
}

function closeAiModal() {
    document.getElementById('aiModal').classList.add('hidden');
    currentAiClient = null;
}

async function generateAiMessage() {
    if (!currentAiClient) return;
    if (currentUser && currentUser.plan === 'free') {
        alert('Seu plano é FREE. Mensagens com IA estão disponíveis apenas para planos pagos.');
        return;
    }
    
    const tone = document.getElementById('aiTone').value;
    const loading = document.getElementById('aiLoading');
    const resultDiv = document.getElementById('aiResult');
    const textArea = document.getElementById('aiMessageText');
    const sendBtn = document.getElementById('aiSendBtn');

    loading.classList.remove('hidden');
    resultDiv.classList.add('hidden');
    sendBtn.classList.add('hidden');

    try {
        const response = await fetch(`${API_URL}/ai/generate-message`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-user-id': currentUserId 
            },
            body: JSON.stringify({
                clientName: currentAiClient.name,
                value: formatCurrency(currentAiClient.value),
                dueDate: formatDate(currentAiClient.due_date),
                product: currentAiClient.product,
                tone: tone
            })
        });

        const data = await response.json();
        
        if (response.ok) {
            textArea.value = data.message;
            resultDiv.classList.remove('hidden');
            sendBtn.classList.remove('hidden');
            sendBtn.style.display = 'flex';
        } else {
            alert(data.error || 'Erro ao gerar mensagem.');
        }
    } catch (error) {
        console.error('AI Error:', error);
        alert('Erro ao conectar com a IA.');
    } finally {
        loading.classList.add('hidden');
    }
}

function sendAiMessage() {
    if (!currentAiClient) return;
    const message = document.getElementById('aiMessageText').value;
    const phone = currentAiClient.phone;

    if (!phone) {
        alert('Cliente sem telefone cadastrado!');
        return;
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/55${cleanPhone}?text=${encodedMessage}`;
    window.open(whatsappUrl, '_blank');
    closeAiModal();
}

async function sendWhatsapp(phone, name, product, value, dueDate, status) {
    if (!phone) return alert('Cliente sem telefone!');
    
    try {
        // paidAt is not available in the current batch view call, passing null
        const message = await generateWhatsappMessage(phone, name, product, value, dueDate, status, null);
        
        // Tentativa de envio automático (Evolution API)
        let sentAuto = false;
        try {
            const res = await fetch(`${API_URL}/admin/evolution/send`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-user-id': currentUserId 
                },
                body: JSON.stringify({ phone, message })
            });
            const data = await res.json();
            
            if (res.ok && data.success) {
                alert(`✅ Mensagem enviada automaticamente para ${name}!`);
                sentAuto = true;
            }
        } catch(e) {
            console.log("Tentativa de envio automático falhou (pode não estar configurado), usando manual.");
        }

        if (sentAuto) return;

        // Fallback: Manual
        const cleanPhone = phone.replace(/\D/g, '');
        const encodedMessage = encodeURIComponent(message);
        const whatsappUrl = `https://wa.me/55${cleanPhone}?text=${encodedMessage}`;
        window.open(whatsappUrl, '_blank');
    } catch (error) {
        console.error(error);
        alert('Erro ao gerar mensagem do WhatsApp');
    }
}

// Expose functions globally
window.logout = logout;
window.openAiModal = openAiModal;
window.closeAiModal = closeAiModal;
window.generateAiMessage = generateAiMessage;
window.sendAiMessage = sendAiMessage;
window.openWhatsappModal = openWhatsappModal;
window.closeWhatsappModal = closeWhatsappModal;
window.sendWhatsappFromModal = sendWhatsappFromModal;
window.openModal = openModal;
window.closeModal = closeModal;
window.openEditModal = openEditModal;
window.openBatchModal = openBatchModal;
window.closeBatchModal = closeBatchModal;
window.handleFormSubmit = handleFormSubmit;
window.sendWhatsapp = sendWhatsapp;
window.sendEmail = sendEmail;
window.markAsPaid = markAsPaid;
window.deleteClient = deleteClient;
window.uploadLogo = uploadLogo;
window.savePaymentPrefs = savePaymentPrefs;
window.searchClients = searchClients;
window.filterStatus = filterStatus;
window.exportCSV = exportCSV;

// Debounce search
let searchTimeout;
document.getElementById('searchInput').addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(loadClients, 500);
});

// WhatsApp Test Logic
function openWhatsappTestModal() {
    document.getElementById('whatsappTestModal').classList.remove('hidden');
    document.getElementById('testResult').classList.add('hidden');
    
    // Try to fill with user phone
    try {
        const token = localStorage.getItem('user_token');
        if (token) {
            const user = JSON.parse(token);
            if (user.whatsapp) {
                document.getElementById('waTestPhone').value = user.whatsapp;
            }
        }
    } catch(e) {}
}

function closeWhatsappTestModal() {
    document.getElementById('whatsappTestModal').classList.add('hidden');
}

async function sendWhatsappTest() {
    const phone = document.getElementById('waTestPhone').value;
    const btn = document.getElementById('btnSendTest');
    const resultDiv = document.getElementById('testResult');
    
    if (!phone) return alert("Digite um número para teste");
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
    resultDiv.classList.add('hidden');
    
    try {
        const res = await fetch(`${API_URL}/admin/evolution/test`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-user-id': currentUserId 
            },
            body: JSON.stringify({ phone })
        });
        
        const data = await res.json();
        
        resultDiv.classList.remove('hidden');
        if (res.ok) {
            resultDiv.className = 'p-3 rounded-lg text-sm mt-2 bg-green-900/50 text-green-400 border border-green-800';
            resultDiv.innerHTML = '<i class="fas fa-check-circle"></i> Mensagem enviada com sucesso! Verifique seu WhatsApp.';
        } else {
            resultDiv.className = 'p-3 rounded-lg text-sm mt-2 bg-red-900/50 text-red-400 border border-red-800';
            resultDiv.innerHTML = `<i class="fas fa-exclamation-circle"></i> Erro: ${data.error || 'Falha ao enviar'}`;
        }
    } catch (e) {
        resultDiv.classList.remove('hidden');
        resultDiv.className = 'p-3 rounded-lg text-sm mt-2 bg-red-900/50 text-red-400 border border-red-800';
        resultDiv.innerHTML = `<i class="fas fa-exclamation-circle"></i> Erro de conexão: ${e.message}`;
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar Teste';
    }
}

window.openWhatsappTestModal = openWhatsappTestModal;
window.closeWhatsappTestModal = closeWhatsappTestModal;
window.sendWhatsappTest = sendWhatsappTest;
