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
if (currentUser && currentUser.role === 'admin') {
    const adminBtn = document.getElementById('adminBtn');
    if (adminBtn) adminBtn.classList.remove('hidden');
}

function logout() {
    localStorage.removeItem('user_token');
    window.location.href = 'login.html';
}

let currentStatusFilter = 'Todos';

// Load initial data
document.addEventListener('DOMContentLoaded', () => {
    loadClients();
    loadStats();
    loadPaymentPrefs();
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
                        <button onclick="sendWhatsapp('${client.phone}', '${client.name}', '${client.product}', ${client.value}, '${client.due_date}')"
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
                borderWidth: 1,
                borderRadius: 5,
                barThickness: 40
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

    const headers = ['Nome', 'Email', 'Telefone', 'Produto', 'Vencimento', 'Valor', 'Status', 'Pago em'];
    const csvRows = [headers.join(',')];

    allClients.forEach(client => {
        const row = [
            `"${client.name}"`,
            `"${client.email || ''}"`,
            `"${client.phone || ''}"`,
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

            tr.innerHTML = `
                <td class="p-4 font-semibold text-white" data-label="Nome">${safeName}</td>
                <td class="p-4 text-sm" data-label="Email/Tel">
                    <div class="text-white">${safeEmail}</div>
                    <div class="text-gray-500 text-xs">${safePhone}</div>
                </td>
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
                        <button onclick="sendWhatsapp('${safePhone}', '${safeName}', '${safeProduct}', ${safeValue}, '${safeDueDate}')" 
                                class="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm flex items-center gap-1" title="Cobrar no WhatsApp">
                            <i class="fas fa-comment"></i>
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

async function sendWhatsapp(phone, name, product, value, dueDate) {
    if (!phone) {
        alert('Cliente sem telefone cadastrado!');
        return;
    }
    
    // Remove non-numeric chars
    const cleanPhone = phone.replace(/\D/g, '');
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
    if (pm === 'pix' && currentPaymentPrefs?.payment_pix_key) {
        paymentLine = `\n\nChave PIX: *${currentPaymentPrefs.payment_pix_key}*`;
        if (currentPaymentPrefs?.payment_instructions) {
            paymentLine += `\n${currentPaymentPrefs.payment_instructions}`;
        }
    } else if ((pm === 'link' || pm === 'boleto') && currentPaymentPrefs?.payment_instructions) {
        paymentLine = `\n\n${currentPaymentPrefs.payment_instructions}`;
    }
    let message = `Olá ${name}, lembramos que sua fatura referente a *${product}* no valor de *${formattedValue}* venceu em *${formattedDate}*.${paymentLine}`;
    
    if (currentPaymentPrefs?.logo) {
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
                     pix_key: currentPaymentPrefs?.payment_pix_key || '',
                     instructions: currentPaymentPrefs?.payment_instructions || ''
                 })
             });
             const data = await res.json();
             if (data.url) {
                 message += `\n\nAcesse sua fatura: ${data.url}`;
             }
         } catch(e) { console.error(e); }
    }

    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/55${cleanPhone}?text=${encodedMessage}`;
    window.open(whatsappUrl, '_blank');
}

async function sendEmail(clientId) {
    if (!confirm('Deseja reenviar o e-mail de cobrança para este cliente?')) return;
    
    try {
        const response = await fetch(`${API_URL}/clients/${clientId}/email`, {
            method: 'POST',
            headers: { 'x-user-id': currentUserId }
        });
        const data = await response.json();
        
        if (response.ok) {
            alert('E-mail enviado com sucesso!');
        } else {
            alert(data.error || 'Erro ao enviar e-mail.');
        }
    } catch (error) {
        console.error('Erro:', error);
        alert('Erro de conexão ao enviar e-mail.');
    }
}

// Debounce search
let searchTimeout;
document.getElementById('searchInput').addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(loadClients, 500);
});
