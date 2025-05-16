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
        const inicio = performance.now();

        const response = await fetch('https://sigaa-api-backend.vercel.app/api/scraper', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user, pass })
        });

        const fim = performance.now();
        const duracaoSegundos = ((fim - inicio) / 1000).toFixed(2);

        const data = await response.json();
        console.log('Resposta da API:', data);
        console.log(`⏱ Tempo de resposta da API: ${duracaoSegundos}s`);

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao buscar dados');
        }

        if (data.dadosInstitucionais) {
            const inst = data.dadosInstitucionais;
            dadosDiv.innerHTML = '<h2>Dados Institucionais</h2><ul>' +
                Object.entries(inst).map(([chave, valor]) =>
                    `<li><strong>${chave}:</strong> ${valor}</li>`).join('') +
                '</ul>';

            dadosDiv.innerHTML += `<p><strong>Tempo de resposta da API:</strong> ${duracaoSegundos}s</p>`;
        }

        preencherTabelaSimplificada(data.horariosSimplificados);
        preencherTabelaDetalhada(data.horariosDetalhados);

        if (data.avisosPorDisciplina) {
            const novidadesFormatadas = data.avisosPorDisciplina.flatMap(({ disciplina, avisos }) =>
                avisos.map(({ data, descricao }) => ({ disciplina, data, descricao }))
            );

            preencherTabelaNovidades(novidadesFormatadas);
        }

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

// Função para preencher a aba de novidades
function preencherTabelaNovidades(novidades) {
  const tbody = document.querySelector('#tabela-novidades tbody');
  tbody.innerHTML = '';
  novidades.forEach(({ disciplina, data, descricao }) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${disciplina}</td>
      <td>${data}</td>
      <td>${descricao}</td>
    `;
    tbody.appendChild(tr);
  });

  if (novidades.length > 0) {
    document.getElementById('tabela-novidades').style.display = '';
  }
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

