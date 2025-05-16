document.getElementById('sigaa-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const user = document.getElementById('user').value.trim();
    const pass = document.getElementById('pass').value.trim();

    const errorDiv = document.getElementById('error');
    const dadosDiv = document.getElementById('dados-institucionais');
    const loadingDiv = document.getElementById('loading');

    errorDiv.textContent = '';
    dadosDiv.innerHTML = '';
    loadingDiv.style.display = 'block';

    try {
        const response = await fetch('https://sigaa-api-backend.vercel.app/api/scraper', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user, pass })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao buscar dados');
        }

        if (data.dadosInstitucionais) {
            const inst = data.dadosInstitucionais;
            dadosDiv.innerHTML = '<h2>Dados Institucionais</h2><ul>' +
                Object.entries(inst).map(([chave, valor]) =>
                    `<li><strong>${chave}:</strong> ${valor}</li>`).join('') +
                '</ul>';
        }

        preencherTabelaSimplificada(data.horariosSimplificados);
        preencherTabelaDetalhada(data.horariosDetalhados);

        document.getElementById('tabela-horarios').style.display = '';
        document.getElementById('tabela-horarios-detalhados').style.display = '';

    } catch (error) {
        errorDiv.textContent = error.message;
    } finally {
        loadingDiv.style.display = 'none';
    }
});



// Função para preencher a aba de horários simplificados
function preencherTabelaSimplificada(horarios) {
    const tbody = document.querySelector('#tabela-horarios tbody');
    tbody.innerHTML = '';
    horarios.forEach(({ semestre, disciplina, turma, dia, período, horário }) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${semestre}</td>
            <td>${disciplina}</td>
            <td>${turma}</td>
            <td>${dia}</td>
            <td>${período}</td>
            <td>${horário}</td>
        `;
        tbody.appendChild(tr);
    });
}

// Função para preencher a aba de horários detalhados
function preencherTabelaDetalhada(horarios) {
    const tbody = document.querySelector('#tabela-horarios-detalhados tbody');
    tbody.innerHTML = '';
    horarios.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${item.disciplina}</td>
            <td>${item.turma}</td>
            <td>${item.dia}</td>
            <td>${item.período}</td>
            <td>${item.slot}</td>
            <td>${item.horário}</td>
        `;
        tbody.appendChild(tr);
    });
}

// Controle de abas
document.querySelectorAll('.tab-button').forEach(button => {
  button.addEventListener('click', () => {
    // Remove 'active' de todos os botões e conteúdos
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));

    // Adiciona 'active' ao botão clicado e à aba correspondente
    button.classList.add('active');
    const tabId = button.getAttribute('data-tab');
    document.getElementById(tabId).classList.add('active');
  });
});

