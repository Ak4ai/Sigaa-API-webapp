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

        // Salva os dados no localStorage
        localStorage.setItem('sigaaUltimaConsulta', JSON.stringify(data));

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao buscar dados');
        }

        if (data.dadosInstitucionais) {
            const inst = { ...data.dadosInstitucionais };

            // Adiciona o semestre do primeiro horário simplificado, se existir
            if (data.horariosSimplificados && data.horariosSimplificados.length > 0) {
                inst['Semestre'] = data.horariosSimplificados[0].semestre;
            }

            renderizarDadosInstitucionais(inst, data.horariosSimplificados[0]?.semestre);

            dadosDiv.innerHTML += `<p><strong>Tempo de resposta da API:</strong> ${duracaoSegundos}s</p>`;
        }

        preencherTabelaSimplificada(data.horariosSimplificados);
        preencherTabelaDetalhada(data.horariosDetalhados);

        if (data.avisosPorDisciplina) {
            const novidadesFormatadas = data.avisosPorDisciplina.flatMap(({ disciplina, avisos }) =>
                avisos.map(({ data, descricao }) => ({ disciplina, data, descricao }))
            );

            preencherTabelaNovidades(novidadesFormatadas);
            frequenciasGlobais = data.avisosPorDisciplina;
            preencherSelectorFrequencias(frequenciasGlobais);
            preencherTabelaFrequencias(frequenciasGlobais, "todas");
        }

        document.getElementById('tabela-horarios').style.display = '';
        document.getElementById('tabela-horarios-detalhados').style.display = '';

    } catch (error) {
        errorDiv.textContent = error.message;
    } finally {
        loadingDiv.style.display = 'none';
    }
});

// ...existing code...

// Salva os dados para filtrar depois
let frequenciasGlobais = [];

function preencherSelectorFrequencias(avisosPorDisciplina) {
  const select = document.getElementById('select-disciplina-frequencia');
  select.innerHTML = '<option value="todas">Todas</option>';
  avisosPorDisciplina.forEach(disc => {
    const nome = disc.disciplina;
    if (![...select.options].some(opt => opt.value === nome)) {
      const option = document.createElement('option');
      option.value = nome;
      option.textContent = nome;
      select.appendChild(option);
    }
  });
}

function preencherTabelaFrequencias(avisosPorDisciplina, filtro = "todas") {
  const thead = document.querySelector('#tabela-frequencias thead');
  const tbody = document.querySelector('#tabela-frequencias tbody');
  const resumoDiv = document.getElementById('resumo-frequencia-disciplina');
  const barraDiv = document.getElementById('barra-progresso-faltas');
  tbody.innerHTML = '';
  resumoDiv.innerHTML = '';
  barraDiv.innerHTML = '';

  if (filtro === "todas") {
    // Esconde resumo e barra de progresso
    resumoDiv.style.display = "none";
    barraDiv.style.display = "none";
    thead.innerHTML = `
      <tr>
        <th>Disciplina</th>
        <th>Nº Aulas</th>
        <th>Total de Faltas</th>
        <th>% Presença</th>
        <th>Faltas Restantes (horários)</th>
        <th>Faltas Restantes (Aulas)</th>
      </tr>
    `;
    avisosPorDisciplina.forEach(disc => {
      const { disciplina, numeroAulasDefinidas = 0, frequencia = [] } = disc;
      let totalFaltas = 0;
      frequencia.forEach(f => {
        const match = f.status.match(/(\d+)\s*Falta/);
        if (match) totalFaltas += parseInt(match[1]);
      });
      const nAulas = Number(numeroAulasDefinidas) || 0;
      const presenca = nAulas > 0 ? (((nAulas - totalFaltas) / nAulas) * 100).toFixed(1) : '';
      const frequenciasNecessarias = Math.ceil(0.75 * nAulas);
      const faltasRestantes = nAulas - frequenciasNecessarias - totalFaltas;
      const faltasRestantesAulas = (faltasRestantes / 2).toFixed(1);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${disciplina}</td>
        <td>${nAulas}</td>
        <td>${totalFaltas}</td>
        <td>${presenca ? presenca + '%' : ''}</td>
        <td>${faltasRestantes}</td>
        <td>${faltasRestantesAulas}</td>
      `;
      tbody.appendChild(tr);
    });
    barraDiv.innerHTML = '';
  } else {
    // Mostra resumo e barra de progresso
    resumoDiv.style.display = "";
    barraDiv.style.display = "";
    const disc = avisosPorDisciplina.find(d => d.disciplina === filtro);
    if (disc) {
      const { disciplina, numeroAulasDefinidas = 0, frequencia = [], porcentagemFrequencia = '' } = disc;
      let totalFaltas = 0;
      frequencia.forEach(f => {
        const match = f.status.match(/(\d+)\s*Falta/);
        if (match) totalFaltas += parseInt(match[1]);
      });
      const nAulas = Number(numeroAulasDefinidas) || 0;
      const presenca = nAulas > 0 ? (((nAulas - totalFaltas) / nAulas) * 100).toFixed(1) : '';
      const frequenciasNecessarias = Math.ceil(0.75 * nAulas);
      const faltasRestantes = nAulas - frequenciasNecessarias - totalFaltas;
      const faltasRestantesAulas = (faltasRestantes / 2).toFixed(1);

      resumoDiv.innerHTML = `
        <table class="resumo-frequencia">
          <thead>
            <tr>
              <th>Disciplina</th>
              <th>Nº Aulas</th>
              <th>Total de Faltas</th>
              <th>% Presença</th>
              <th>% Porcentagem - Sigaa</th>
              <th>Faltas Restantes (horários)</th>
              <th>Faltas Restantes (Aulas)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${disciplina}</td>
              <td>${nAulas}</td>
              <td>${totalFaltas}</td>
              <td>${presenca ? presenca + '%' : ''}</td>
              <td>${porcentagemFrequencia ? porcentagemFrequencia + '%' : ''}</td>
              <td>${faltasRestantes}</td>
              <td>${faltasRestantesAulas}</td>
            </tr>
          </tbody>
        </table>
      `;

      const maxFaltas = Math.ceil(nAulas * 0.25); // 25% de faltas permitidas
      const maxFrequencias = Math.ceil(nAulas * 0.75); // 75% de presença obrigatória

      // Barra de progresso
      const percentual = maxFaltas > 0 ? totalFaltas / maxFaltas : 0;
      let corClasse = "custom-bar";
      if (percentual >= 0.8) {
        corClasse += " vermelho";
      } else if (percentual >= 0.5) {
        corClasse += " amarelo";
      }

      barraDiv.innerHTML = `
        <div style="margin-bottom:4px;"><strong>Progresso de faltas:</strong> ${totalFaltas} / ${maxFaltas} faltas permitidas</div>
        <progress class="${corClasse}" value="${totalFaltas}" max="${maxFaltas}" style="width:100%;"></progress>
        <div style="font-size:0.9em;color:#666;">Limite: ${maxFaltas} faltas (${nAulas} aulas, mínimo ${maxFrequencias} presenças)</div>
      `;
    } else {
      barraDiv.innerHTML = '';
    }

    thead.innerHTML = `
      <tr>
        <th>Aula</th>
        <th>Disciplina</th>
        <th>Data</th>
        <th>Status</th>
      </tr>
    `;
    avisosPorDisciplina.forEach(disc => {
      if (disc.disciplina !== filtro) return;
      const { disciplina, frequencia = [] } = disc;
      frequencia.forEach((f, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${idx + 1}</td>
          <td>${disciplina}</td>
          <td>${f.data}</td>
          <td>${f.status}</td>
        `;
        tbody.appendChild(tr);
      });
    });
  }

  document.getElementById('tabela-frequencias').style.display = avisosPorDisciplina.length > 0 ? '' : 'none';
}

// Evento de filtro
document.getElementById('select-disciplina-frequencia').addEventListener('change', function() {
  preencherTabelaFrequencias(frequenciasGlobais, this.value);
});

// ...existing code...

// Função para preencher a aba de horários simplificados
function preencherTabelaSimplificada(horarios) {
    const tbody = document.querySelector('#tabela-horarios tbody');
    tbody.innerHTML = '';
    horarios.forEach(({ semestre, disciplina, turma, dia, período, horário }) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <!-- <td>${semestre}</td> --> <!-- Remova ou comente esta linha -->
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

window.addEventListener('DOMContentLoaded', () => {
  const dadosSalvos = localStorage.getItem('sigaaUltimaConsulta');
  if (dadosSalvos) {
    try {
      const data = JSON.parse(dadosSalvos);

      // Preenche os dados institucionais
      if (data.dadosInstitucionais) {
        const dadosDiv = document.getElementById('dados-institucionais');
        const inst = { ...data.dadosInstitucionais };

        // Adiciona o semestre do primeiro horário simplificado, se existir
        if (data.horariosSimplificados && data.horariosSimplificados.length > 0) {
            inst['Semestre'] = data.horariosSimplificados[0].semestre;
        }

        renderizarDadosInstitucionais(inst, data.horariosSimplificados[0]?.semestre);
      }

      // Preenche tabelas
      preencherTabelaSimplificada(data.horariosSimplificados || []);
      preencherTabelaDetalhada(data.horariosDetalhados || []);

      if (data.avisosPorDisciplina) {
        const novidadesFormatadas = data.avisosPorDisciplina.flatMap(({ disciplina, avisos }) =>
          avisos.map(({ data, descricao }) => ({ disciplina, data, descricao }))
        );
        preencherTabelaNovidades(novidadesFormatadas);
        frequenciasGlobais = data.avisosPorDisciplina;
        preencherSelectorFrequencias(frequenciasGlobais);
        preencherTabelaFrequencias(frequenciasGlobais, "todas");
      }

      document.getElementById('tabela-horarios').style.display = '';
      document.getElementById('tabela-horarios-detalhados').style.display = '';
    } catch (e) {
      console.warn('Erro ao carregar dados salvos:', e);
    }
  }
});

function renderizarDadosInstitucionais(dados, semestre) {
  const dadosDiv = document.getElementById('dados-institucionais');
  if (!dadosDiv) return;

  // Campos principais
  const principais = ['Matrícula', 'Email', 'Curso'];
  // Garante que as chaves estejam com a primeira letra maiúscula
  const dadosFormatados = {};
  Object.entries(dados).forEach(([k, v]) => {
    const key = k.charAt(0).toUpperCase() + k.slice(1);
    dadosFormatados[key] = v;
  });
  if (semestre) dadosFormatados['Semestre'] = semestre;

  let html = '<h2 style="background:#f2f2f2;margin:0;padding:12px 16px;font-size:1.1em;border-bottom:1px solid #e0e0e0;">Dados Institucionais do Usuário  </h2><ul>';

  // Mostra só principais
  principais.forEach(chave => {
    if (dadosFormatados[chave]) {
      html += `<li><strong>${chave}:</strong> ${dadosFormatados[chave]}</li>`;
    }
  });

  // Extras
  html += `<div class="extra-info">`;
  Object.entries(dadosFormatados).forEach(([chave, valor]) => {
    if (!principais.includes(chave)) {
      html += `<li><strong>${chave}:</strong> ${valor}</li>`;
    }
  });
  html += `</div></ul>`;

  dadosDiv.innerHTML = html;

  // Mobile: toggle ao clicar
  dadosDiv.onclick = function () {
    if (window.matchMedia("(hover: none) and (pointer: coarse)").matches) {
      dadosDiv.classList.toggle('expanded');
    }
  };
}

// Exemplo de uso após obter os dados:
renderizarDadosInstitucionais(data.dadosInstitucionais, data.horariosSimplificados?.[0]?.semestre);

