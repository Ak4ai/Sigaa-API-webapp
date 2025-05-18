document.getElementById('sigaa-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const user = document.getElementById('user').value.trim();
    const pass = document.getElementById('pass').value.trim();
    const manterLogado = document.getElementById('manter-logado').checked;

    const errorDiv = document.getElementById('error');
    const dadosDiv = document.getElementById('dados-institucionais');
    const loadingDiv = document.getElementById('loading');
    errorDiv.textContent = '';
    loadingDiv.style.display = 'block';

    try {
        // 1. Login e salva token
        const resp = await fetch('https://sigaa-api-backend.vercel.app/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user, pass })
        });
        if (!resp.ok) throw new Error('Usuário ou senha inválidos');
        const { token } = await resp.json();

        if (manterLogado) {
            sessionStorage.removeItem('sigaa_token');
            localStorage.setItem('sigaa_token', token);
        } else {
            localStorage.removeItem('sigaa_token');
            sessionStorage.setItem('sigaa_token', token);
        }

        // 2. Usa token para buscar dados
        await consultarComToken(token);
    } catch (error) {
        console.error('Erro no login:', error);
        errorDiv.textContent = error.message;
    } finally {
        loadingDiv.style.display = 'none';
    }
});

async function consultarComToken(token) {
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
            body: JSON.stringify({ token })
        });

        const fim = performance.now();
        const duracaoSegundos = ((fim - inicio) / 1000).toFixed(2);

        const data = await response.json();
        console.log('Resposta da API:', data);
        console.log(`⏱ Tempo de resposta da API: ${duracaoSegundos}s`);
        if (!response.ok) throw new Error(data.error || 'Erro ao buscar dados');

        // Salva os dados no localStorage (opcional)
        localStorage.setItem('sigaaUltimaConsulta', JSON.stringify(data));
        removerEstiloSemDados();
        // Limpa dados anteriores
        // ...preencher tabelas e dados institucionais...
        if (data.dadosInstitucionais) {
            const inst = { ...data.dadosInstitucionais };

            // Adiciona o semestre do primeiro horário simplificado, se existir
            if (data.horariosSimplificados && data.horariosSimplificados.length > 0) {
                inst['Semestre'] = data.horariosSimplificados[0].semestre;
            }

            renderizarDadosInstitucionais(inst, data.horariosSimplificados[0]?.semestre, duracaoSegundos);
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
        
          // Adicione estas linhas para carregar as notas ao abrir a página
          notasGlobais = data.avisosPorDisciplina;
          preencherSelectorNotas(notasGlobais);
          preencherTabelaNotas(notasGlobais, "todas");
        }

        //document.getElementById('tabela-horarios').style.display = '';
        document.getElementById('tabela-horarios-detalhados').style.display = '';

    } catch (error) {
        console.error('Erro ao consultar com token:', error);
        errorDiv.textContent = error.message;
    } finally {
        loadingDiv.style.display = 'none';
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('sigaa_token') || sessionStorage.getItem('sigaa_token');
    if (token) {
        console.log('Token encontrado, realizando consulta automática...');
        consultarComToken(token);
    }
});

// Botão de logout/apagar informações
document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('sigaa_token');
    sessionStorage.removeItem('sigaa_token');
    location.reload();
});

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

document.getElementById('select-disciplina-notas').addEventListener('change', function() {
  preencherTabelaNotas(notasGlobais, this.value);
});

// Função para preencher a aba de horários simplificados
function preencherTabelaSimplificada(horarios) {
    // Mapear dias para ids das tabelas
    const diasMap = {
        'Segunda-feira': 'tabela-horarios-segunda',
        'Terça-feira': 'tabela-horarios-terca',
        'Quarta-feira': 'tabela-horarios-quarta',
        'Quinta-feira': 'tabela-horarios-quinta',
        'Sexta-feira': 'tabela-horarios-sexta'
    };

    // Limpar todos os tbodys e esconder as tabelas
    Object.values(diasMap).forEach(id => {
        const table = document.getElementById(id);
        if (table) {
            table.style.display = 'none';
            const tbody = table.querySelector('tbody');
            if (tbody) tbody.innerHTML = '';
        }
    });

    // Limpar tabela "Hoje"
    const tabelaHoje = document.getElementById('tabela-horarios-hoje');
    const tbodyHoje = tabelaHoje ? tabelaHoje.querySelector('tbody') : null;
    if (tabelaHoje && tbodyHoje) {
        tabelaHoje.style.display = 'none';
        tbodyHoje.innerHTML = '';
    }

    // Remover aviso anterior se existir
    let avisoHoje = document.getElementById('aviso-hoje-fds');
    if (avisoHoje) avisoHoje.remove();

    // Agrupar horários por dia
    const horariosPorDia = {};
    horarios.forEach(item => {
        const dia = item.dia;
        if (!horariosPorDia[dia]) horariosPorDia[dia] = [];
        horariosPorDia[dia].push(item);
    });

    // Preencher tabela "Hoje" ou mostrar aviso se sábado/domingo
    const diasSemana = [
        'Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'
    ];
    const hojeIdx = new Date().getDay();
    const hojeNome = diasSemana[hojeIdx];
    const tabelaHojeContainer = document.getElementById('tabela-hoje-container');

    if ((hojeNome === 'Sábado' || hojeNome === 'Domingo') && tabelaHojeContainer) {
        // Adiciona aviso
        const aviso = document.createElement('div');
        aviso.id = 'aviso-hoje-fds';
        aviso.style = 'background: #fff3cd; color: #856404; border: 1px solid #ffeeba; padding: 12px; border-radius: 6px; margin-bottom: 8px;';
        aviso.innerHTML = `<strong>Hoje é ${hojeNome}.</strong> Não há horários cadastrados para finais de semana.`;
        tabelaHojeContainer.insertBefore(aviso, tabelaHojeContainer.querySelector('h3').nextSibling);
        if (tabelaHoje) tabelaHoje.style.display = 'none';
    } else if (diasMap[hojeNome] && horariosPorDia[hojeNome] && horariosPorDia[hojeNome].length > 0 && tabelaHoje && tbodyHoje) {
        tabelaHoje.style.display = '';
        horariosPorDia[hojeNome].forEach(({ disciplina, turma, dia, período, horário }) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${disciplina}</td>
                <td>${turma}</td>
                <td>${dia}</td>
                <td>${período}</td>
                <td>${horário}</td>
            `;
            tbodyHoje.appendChild(tr);
        });
    }

    // Preencher cada tabela dos dias da semana
    Object.entries(diasMap).forEach(([dia, id]) => {
        const table = document.getElementById(id);
        const tbody = table.querySelector('tbody');
        const lista = horariosPorDia[dia] || [];
        if (lista.length > 0) {
            table.style.display = '';
            lista.forEach(({ disciplina, turma, dia, período, horário }) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${disciplina}</td>
                    <td>${turma}</td>
                    <td>${dia}</td>
                    <td>${período}</td>
                    <td>${horário}</td>
                `;
                tbody.appendChild(tr);
            });
        }
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
    // Mostra a tabela se houver dados
    const tabela = document.getElementById('tabela-horarios-detalhados');
    tabela.style.display = horarios.length > 0 ? '' : 'none';
}

// Função para preencher a aba de novidades
function preencherTabelaNovidades(novidades) {
  // Home
  const tabelaHome = document.getElementById('tabela-novidades-home');
  // Novidades
  const tabelaNovidades = document.getElementById('tabela-novidades-novidades');
  [tabelaHome, tabelaNovidades].forEach(tabela => {
    if (!tabela) return;
    const tbody = tabela.querySelector('tbody');
    tbody.innerHTML = '';
    if (novidades.length > 0) {
      tabela.style.display = '';
      novidades.forEach(n => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${n.disciplina}</td><td>${n.data}</td><td>${n.descricao}</td>`;
        tbody.appendChild(tr);
      });
    } else {
      tabela.style.display = 'none';
    }
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

function removerEstiloSemDados() {
  const homeContent = document.getElementById('home-content');
  const tabHome = document.getElementById('tab-home');
  homeContent.classList.remove('sem-dados');
  tabHome.classList.remove('sem-dados');
  // Remove mensagem se existir
  const msg = homeContent.querySelector('.mensagem-sem-dados');
  if (msg) msg.remove();
  document.getElementById('dados-institucionais').style.display = 'block';
  document.getElementById('tabela-novidades-container').style.display = 'block';
  document.getElementById('home-aviso').style.display = 'block';
}

window.addEventListener('DOMContentLoaded', () => {
  const homeContent = document.getElementById('home-content');
  const tabHome = document.getElementById('tab-home');
  const dadosSalvos = localStorage.getItem('sigaaUltimaConsulta');

  if (!dadosSalvos) {
    // Adapta a interface para novo usuário
    homeContent.classList.add('sem-dados');
    tabHome.classList.add('sem-dados');
    if (!homeContent.querySelector('.mensagem-sem-dados')) {
      homeContent.insertAdjacentHTML('beforeend', `
        <div class="mensagem-sem-dados">
          Nenhum dado encontrado.<br>
          Faça login para visualizar suas informações.
        </div>
      `);
    }
    // Opcional: esconder dados institucionais e novidades
    document.getElementById('dados-institucionais').style.display = 'none';
    document.getElementById('tabela-novidades-container').style.display = 'none';
    document.getElementById('home-aviso').style.display = 'none';
    return; // Não tenta preencher tabelas
  }

  const token = localStorage.getItem('sigaa_token') || sessionStorage.getItem('sigaa_token');
  if (token) {
    console.log('Token encontrado, realizando consulta automática...');
    consultarComToken(token);
  }

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
      
        // Adicione estas linhas para carregar as notas ao abrir a página
        notasGlobais = data.avisosPorDisciplina;
        preencherSelectorNotas(notasGlobais);
        preencherTabelaNotas(notasGlobais, "todas");
      }

      //document.getElementById('tabela-horarios').style.display = '';
      document.getElementById('tabela-horarios-detalhados').style.display = '';
    } catch (e) {
      console.warn('Erro ao carregar dados salvos:', e);
    }
  }
});

function renderizarDadosInstitucionais(dados, semestre, tempoResposta) {
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

  let html = '<h2 style="background:#f2f2f2;margin:0;padding:12px 16px;font-size:1.1em;border-bottom:1px solid #e0e0e0;">Dados Institucionais do Usuário</h2><ul>';

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
  // Adiciona o tempo de resposta como extra-info
  if (tempoResposta) {
    html += `<li><strong>Tempo de resposta da API:</strong> ${tempoResposta}s</li>`;
  }
  html += `</div></ul>`;

  dadosDiv.innerHTML = html;

  // Sempre permite expandir/colapsar ao toque/click
  dadosDiv.onclick = function (e) {
    // Evita toggle se clicar em link ou botão dentro do bloco
    if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') return;
    // Em mobile, sempre faz toggle; em desktop, só se não estiver com hover
    if (
      window.matchMedia("(hover: none) and (pointer: coarse)").matches ||
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    ) {
      dadosDiv.classList.toggle('expanded');
    }
  };
}

// Aviso colapsável, timer e preferências
(function () {
  const aviso = document.getElementById('home-aviso');
  const avisoContent = document.getElementById('home-aviso-content');
  const fecharBtn = document.getElementById('fechar-aviso');
  const naoMostrarBtn = document.getElementById('nao-mostrar-aviso');
  const STORAGE_KEY = 'sigaa_nao_mostrar_aviso';
  let timerId = null;

  // Não mostrar se usuário já escolheu não mostrar mais
  if (localStorage.getItem(STORAGE_KEY) === '1') {
    aviso.style.display = 'none';
    return;
  }

  // Timer para mover aviso para o fim da tab após 30 segundos
  timerId = setTimeout(() => {
    const tabHome = document.getElementById('tab-home');
    if (tabHome && aviso) {
      tabHome.appendChild(aviso); // move para o fim da tab
      aviso.style.marginTop = "24px";
    }
  }, 30000);

  // Começa collapsed por padrão
  aviso.classList.add('home-aviso-collapsed');

  // Colapsar/expandir ao clicar (exceto nos botões)
  aviso.addEventListener('click', function (e) {
    if (e.target === fecharBtn || e.target === naoMostrarBtn) return;
    aviso.classList.toggle('home-aviso-collapsed');
  });

  // Expande ao hover (desktop)
  aviso.addEventListener('mouseenter', function () {
    if (window.matchMedia("(hover: hover)").matches) {
      aviso.classList.remove('home-aviso-collapsed');
    }
  });
  aviso.addEventListener('mouseleave', function () {
    if (window.matchMedia("(hover: hover)").matches) {
      aviso.classList.add('home-aviso-collapsed');
    }
  });

  // Botão fechar: esconde só até recarregar
  fecharBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    aviso.style.display = 'none';
    clearTimeout(timerId);
  });

  // Botão não mostrar mais: nunca mais mostra
  naoMostrarBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    localStorage.setItem(STORAGE_KEY, '1');
    aviso.style.display = 'none';
    clearTimeout(timerId);
  });
})();

let notasGlobais = [];

function preencherSelectorNotas(avisosPorDisciplina) {
  const select = document.getElementById('select-disciplina-notas');
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

function preencherTabelaNotas(avisosPorDisciplina, filtro = "todas") {
  const wrapper = document.getElementById('tabela-notas-wrapper');
  wrapper.innerHTML = '';

  let disciplinas = avisosPorDisciplina;
  if (filtro !== "todas") {
    disciplinas = avisosPorDisciplina.filter(d => d.disciplina === filtro);
  }

  disciplinas.forEach(disc => {
    const { disciplina, turma, notas } = disc;
    if (!notas || (!notas.headers.length && !notas.valores.length && !notas.avaliacoes.length)) return;

    let html = `<h4>${disciplina}${turma ? ' - ' + turma : ''}</h4>`;

    // Monta tabela organizada
    if (notas.avaliacoes && notas.avaliacoes.length > 0 && notas.valores.length > 0) {
      // Procura a linha do aluno (normalmente a primeira)
      const linhaAluno = notas.valores[0];

      // Apenas a tabela dentro da div, sem o título
      html += `<div class="tabela-notas-wrapper"><table class="tabela-notas">
        <thead>
          <tr>
            <th>Disciplina</th>
            <th>Sigla</th>
            <th>Descrição</th>
            <th>Nota Total</th>
            <th>Peso</th>
            <th>Sua Nota</th>
          </tr>
        </thead>
        <tbody>`;

      notas.avaliacoes.forEach((av, idx) => {
        let idxHeader = notas.headers.findIndex(h => h === av.abrev);
        if (idxHeader === -1) idxHeader = idx;
        let suaNota = (linhaAluno && linhaAluno[idxHeader + 2]) ? linhaAluno[idxHeader + 2] : '';
        html += `<tr>
          <td>${disciplina}</td>
          <td>${av.abrev}</td>
          <td>${av.den}</td>
          <td>${av.nota}</td>
          <td>${av.peso}</td>
          <td>${suaNota}</td>
        </tr>`;
      });

      html += `</tbody></table></div>`;
    } else {
      html += `<div style="color:#888; margin-bottom:12px;">Nenhuma nota lançada.</div>`;
    }

    wrapper.innerHTML += html;
  });

  if (wrapper.innerHTML === '') {
    wrapper.innerHTML = `<div style="color:#888;">Nenhuma nota encontrada para o filtro selecionado.</div>`;
  }
}