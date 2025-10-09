// Importa a função de exportação do boletim
// <script src="boletim.js"></script> deve estar incluído no index.html antes de script.js para garantir que a função esteja disponível

document.addEventListener('DOMContentLoaded', function () {
  var btnExportar = document.getElementById('exportar-pdf-btn');
  if (btnExportar) {
    btnExportar.addEventListener('click', function () {
      // notasGlobais deve estar disponível no escopo global
      if (typeof exportarBoletimPDF === 'function' && typeof notasGlobais !== 'undefined') {
        // Busca dados institucionais do DOM, se possível, senão pega do localStorage
        let dadosInstitucionais = null;
        try {
          const dadosDiv = document.getElementById('dados-institucionais');
          if (dadosDiv && dadosDiv.innerText) {
            // Extrai os dados exibidos no DOM
            const linhas = Array.from(dadosDiv.querySelectorAll('li'));
            dadosInstitucionais = {};
            linhas.forEach(li => {
              const txt = li.innerText;
              const idx = txt.indexOf(':');
              if (idx > 0) {
                const chave = txt.slice(0, idx).trim();
                const valor = txt.slice(idx + 1).trim();
                dadosInstitucionais[chave] = valor;
              }
            });
          }
        } catch (e) { dadosInstitucionais = null; }
        // Se não encontrou ou encontrou poucos campos, tenta pegar do localStorage
        if (!dadosInstitucionais || Object.keys(dadosInstitucionais).length < 4) {
          try {
            const dadosSalvos = localStorage.getItem('sigaaUltimaConsulta');
            if (dadosSalvos) {
              const data = JSON.parse(dadosSalvos);
              if (data && data.dadosInstitucionais) {
                dadosInstitucionais = { ...data.dadosInstitucionais };
                // Adiciona o semestre do primeiro horário simplificado, se existir
                if (data.horariosSimplificados && data.horariosSimplificados.length > 0) {
                  dadosInstitucionais['Semestre'] = data.horariosSimplificados[0].semestre;
                }
              }
            }
          } catch (e) { /* ignora erro */ }
        }
        exportarBoletimPDF(notasGlobais, dadosInstitucionais);
      } else {
        alert('Notas não encontradas ou função de exportação não disponível.');
      }
    });
  }
});
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

    // Salva token junto com informação de expiry (se disponível)
    const storageType = manterLogado ? 'local' : 'session';
    saveTokenWithExpiry(token, storageType);

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
    // inicia contador visível no formulário
    startScrapeCounter();
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
    // para contador com flag de erro
    stopScrapeCounter(false);
  } finally {
    const fimGeral = performance.now();
    const duracaoSegundosGeral = Math.max(1, Math.round((fimGeral - (typeof inicio !== 'undefined' ? inicio : fimGeral)) / 1000));
    stopScrapeCounter(true, duracaoSegundosGeral);
    loadingDiv.style.display = 'none';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  // Inicia display do status do token e tenta usar token salvo
  startTokenTimer();

  // Marca a checkbox 'manter-logado' por padrão
  try {
    const manterCheckbox = document.getElementById('manter-logado');
    if (manterCheckbox) manterCheckbox.checked = true;
  } catch (e) {
    console.warn('Checkbox manter-logado não encontrada');
  }

  const info = getTokenInfo();
  const token = info ? info.token : (localStorage.getItem('sigaa_token') || sessionStorage.getItem('sigaa_token'));
  if (token) {
    const now = Date.now();
    const expiresAt = info && info.expiresAt ? info.expiresAt : null;
    if (expiresAt && expiresAt <= now) {
      console.log('Token expirado, removendo.');
      clearStoredTokenInfo();
      stopTokenTimer();
      return;
    }
    console.log('Token encontrado, realizando consulta automática...');
    consultarComToken(token);
  }
  // Ajusta o layout inicial (altura do container de novidades)
  setTimeout(ajustarAlturaNovidades, 60);
  // Ajusta visibilidade das tabs em mobile (esconde Horários/Novidades se necessário)
  setTimeout(ajustarTabsMobileOcultar, 120);
});

// Botão de logout/apagar informações
document.getElementById('logout-btn').addEventListener('click', () => {
  clearStoredTokenInfo();
  stopTokenTimer();
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
  // Ajusta a altura do container de novidades agora que conteúdos mudaram
  setTimeout(ajustarAlturaNovidades, 30);
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

// Ativa uma aba pelo id (mesmo que o botão esteja escondido)
function activateTab(tabId) {
  try {
    // Remove estado ativo de botões e conteúdos
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));

    // Marca botão correspondente como ativo se existir
    const btn = document.querySelector(`.tab-button[data-tab="${tabId}"]`);
    if (btn) btn.classList.add('active');

    // Mostra o conteúdo da aba
    const content = document.getElementById(tabId);
    if (content) {
      content.classList.add('active');
      // rola suavemente até o conteúdo se estiver fora da view
      try { content.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { }
    }
  } catch (e) {
    console.warn('Erro ao ativar aba', tabId, e);
  }
}

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
  // Só mostra o aviso se o usuário não escolheu 'não mostrar mais'
  try {
    const STORAGE_KEY = 'sigaa_nao_mostrar_aviso';
    const aviso = document.getElementById('home-aviso');
    if (aviso && localStorage.getItem(STORAGE_KEY) !== '1') {
      aviso.style.display = 'block';
    }
  } catch (e) {
    // silenciar erros de acesso ao localStorage
    const aviso = document.getElementById('home-aviso');
    if (aviso) aviso.style.display = 'block';
  }
  // Ajusta altura quando removemos o estilo sem-dados
  setTimeout(ajustarAlturaNovidades, 40);
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
  // Ajusta altura de novidades sempre que dados institucionais são renderizados
  setTimeout(ajustarAlturaNovidades, 50);

  // --- Ensure hover/size/content changes trigger ajustarAlturaNovidades ---
  try {
    if (!dadosDiv.dataset.__syncSetup) {
      // mouseenter/mouseleave para atualizar imediatamente ao hover
      dadosDiv.addEventListener('mouseenter', () => {
        // pequeno atraso para dar tempo ao CSS de mostrar .extra-info
        setTimeout(ajustarAlturaNovidades, 12);
      });
      dadosDiv.addEventListener('mouseleave', () => {
        setTimeout(ajustarAlturaNovidades, 12);
      });

      // ResizeObserver para mudanças de layout/altura
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
          try { ajustarAlturaNovidades(); } catch (e) { /* ignore */ }
        });
        ro.observe(dadosDiv);
        // guarda referência para possível limpeza futura
        dadosDiv.__resizeObserver = ro;
      }

      // MutationObserver para mudanças de conteúdo/class (ex: toggle .expanded)
      const mo = new MutationObserver(muts => {
        for (const m of muts) {
          if (m.type === 'attributes' || m.type === 'childList' || m.type === 'subtree') {
            // delay curto para permitir reflow
            setTimeout(ajustarAlturaNovidades, 8);
            break;
          }
        }
      });
      mo.observe(dadosDiv, { attributes: true, childList: true, subtree: true });
      dadosDiv.__mutationObserver = mo;

      dadosDiv.dataset.__syncSetup = '1';
    }
  } catch (e) {
    console.warn('Não foi possível configurar observers para dados-institucionais:', e);
  }
}

// Ajusta a altura máxima do container de novidades com base na altura do formulário e dos dados institucionais
function ajustarAlturaNovidades() {
  try {
    const form = document.getElementById('sigaa-form');
    const dados = document.getElementById('dados-institucionais');
    const container = document.getElementById('tabela-novidades-container');
    if (!form || !dados || !container) return;
    const formH = form.getBoundingClientRect().height || 0;
    const dadosH = dados.getBoundingClientRect().height || 0;
    const x = Math.round(formH + 22 + dadosH);
    container.style.maxHeight = x + 'px';
    container.style.overflow = 'auto';
  } catch (e) {
    console.warn('Erro ao ajustar altura de novidades:', e);
  }
}

// Ajusta ao redimensionar a janela
window.addEventListener('resize', () => {
  ajustarAlturaNovidades();
  ajustarLabelsTabsPorEmoji();
  ajustarTabsMobileOcultar();
});

// Em mobile, se as tabs ocuparem mais de 2 linhas, esconder o botão 'Horários'.
// Se ainda exceder 2 linhas, esconder também 'Novidades'.
function ajustarTabsMobileOcultar() {
  try {
    const MOBILE_MAX = 1040;
    const tabs = document.querySelector('.tabs');
    if (!tabs) return;

    // Em desktop, garante visibilidade padrão
    if (window.innerWidth > MOBILE_MAX) {
      const btnH = document.querySelector('.tab-button[data-tab="tab-horarios"]');
      const btnN = document.querySelector('.tab-button[data-tab="tab-novidades"]');
      if (btnH) btnH.style.display = '';
      if (btnN) btnN.style.display = '';
      // restaura label original da 'Tabela Simplificada' se foi alterada
      const btnSimplificada = document.querySelector('.tab-button[data-tab="tab-simplificada"]');
      if (btnSimplificada && btnSimplificada.dataset.origLabel) {
        btnSimplificada.textContent = btnSimplificada.dataset.origLabel;
      }
      return;
    }

    // Mostra todos antes de medir
    const allButtons = Array.from(tabs.querySelectorAll('.tab-button'));
    allButtons.forEach(b => b.style.display = '');

    // Conta linhas via posição Y
    const lines = [];
    allButtons.forEach(btn => {
      const r = btn.getBoundingClientRect();
      const y = Math.round(r.top);
      if (!lines.includes(y)) lines.push(y);
    });

    if (lines.length <= 2) return;

    // Esconde Horários primeiro
    const btnHorarios = document.querySelector('.tab-button[data-tab="tab-horarios"]');
    if (btnHorarios) btnHorarios.style.display = 'none';

    // Se escondemos 'Horários', renomeia a 'Tabela Simplificada' para 'Horários' para preservar acesso
    const btnSimplificada = document.querySelector('.tab-button[data-tab="tab-simplificada"]');
    if (btnSimplificada) {
      if (!btnSimplificada.dataset.origLabel) btnSimplificada.dataset.origLabel = btnSimplificada.textContent.trim();
      btnSimplificada.textContent = 'Horários';
    }

    // Reconta linhas
    const remaining = Array.from(tabs.querySelectorAll('.tab-button')).filter(b => b.style.display !== 'none');
    const lines2 = [];
    remaining.forEach(btn => {
      const r = btn.getBoundingClientRect();
      const y = Math.round(r.top);
      if (!lines2.includes(y)) lines2.push(y);
    });

    if (lines2.length <= 2) return;

    // Se ainda passar, esconde Novidades
    const btnNovidades = document.querySelector('.tab-button[data-tab="tab-novidades"]');
    if (btnNovidades) btnNovidades.style.display = 'none';

  } catch (e) {
    console.warn('Erro ao ajustar visibilidade das tabs mobile:', e);
  }
}

// Aviso colapsável, timer e preferências
// Aviso colapsável, timer e preferências (executa após DOMContentLoaded)
window.addEventListener('DOMContentLoaded', () => {
  const aviso = document.getElementById('home-aviso');
  if (!aviso) return; // nada a fazer se não existe

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
      aviso.style.marginTop = '24px';
    }
  }, 30000);

  // Começa collapsed por padrão (só se suportado)
  try { aviso.classList.add('home-aviso-collapsed'); } catch (e) { /* ignore */ }

  // Colapsar/expandir ao clicar (exceto nos botões)
  aviso.addEventListener('click', function (e) {
    if (e.target === fecharBtn || e.target === naoMostrarBtn) return;
    try { aviso.classList.toggle('home-aviso-collapsed'); } catch (e) { /* ignore */ }
  });

  // Expande ao hover (desktop)
  aviso.addEventListener('mouseenter', function () {
    if (window.matchMedia('(hover: hover)').matches) {
      try { aviso.classList.remove('home-aviso-collapsed'); } catch (e) { }
    }
  });
  aviso.addEventListener('mouseleave', function () {
    if (window.matchMedia('(hover: hover)').matches) {
      try { aviso.classList.add('home-aviso-collapsed'); } catch (e) { }
    }
  });

  // Botão fechar: esconde só até recarregar
  if (fecharBtn) {
    fecharBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      aviso.style.display = 'none';
      clearTimeout(timerId);
    });
  }

  // Botão não mostrar mais: nunca mais mostra
  if (naoMostrarBtn) {
    naoMostrarBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      try { localStorage.setItem(STORAGE_KEY, '1'); } catch (err) { console.warn('Erro ao salvar preferência:', err); }
      aviso.style.display = 'none';
      clearTimeout(timerId);
    });
  }
});

// --- Mobile FAB (floating action button) behavior ---
document.addEventListener('DOMContentLoaded', () => {
  const fabToggle = document.getElementById('mobile-fab-toggle');
  const fabMenu = document.getElementById('mobile-fab-menu');
  const fab = document.getElementById('mobile-fab');
  if (!fabToggle || !fabMenu || !fab) return; // nada a fazer

  function closeFab() {
    fabMenu.classList.remove('open');
    fab.setAttribute('aria-hidden', 'true');
    fabMenu.setAttribute('aria-hidden', 'true');
  }
  function openFab() {
    fabMenu.classList.add('open');
    fab.setAttribute('aria-hidden', 'false');
    fabMenu.setAttribute('aria-hidden', 'false');
  }

  fabToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (fabMenu.classList.contains('open')) closeFab(); else openFab();
  });

  // Ações dos itens
  fabMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('.fab-item');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'abrir-horarios-completos') {
      // ativa diretamente a aba completa de horários
      activateTab('tab-horarios');
    } else if (action === 'abrir-novidades') {
      // ativa diretamente a aba de novidades
      activateTab('tab-novidades');
    }
    closeFab();
  });

  // Fecha se clicar fora
  document.addEventListener('click', (e) => {
    if (!fab.contains(e.target)) closeFab();
  });

  // Fecha em resize para evitar menus abertos em desktop
  window.addEventListener('resize', () => closeFab());
});

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

      // Variáveis para calcular totais
      let notaTotalSomada = 0;
      let somaNotasAluno = 0;
      let somaPesos = 0;

      notas.avaliacoes.forEach((av, idx) => {
        let idxHeader = notas.headers.findIndex(h => h === av.abrev);
        if (idxHeader === -1) idxHeader = idx;
        let suaNota = (linhaAluno && linhaAluno[idxHeader + 2]) ? linhaAluno[idxHeader + 2] : '';
        
        // Calcula totais para o rodapé
        const notaTotal = parseFloat(av.nota) || 0;
        let peso = parseFloat(av.peso) || 1;
        const notaAluno = parseFloat(suaNota.replace(',', '.')) || 0; // Converte vírgula para ponto
        
        // Lógica inteligente para pesos
        let notaCalculada = 0;
        if (peso === 1) {
          // Peso igual a 1: mantém o valor original da nota
          notaCalculada = notaAluno;
        } else if (peso > 1) {
          // Peso maior que 1: trata como porcentagem
          notaCalculada = (notaAluno * peso) / 100;
        } else {
          // Peso menor que 1: multiplica diretamente (fração)
          notaCalculada = notaAluno * peso;
        }
        
        notaTotalSomada += notaTotal;
        somaPesos += peso;
        
        // Só conta no cálculo se o aluno tem nota lançada
        if (suaNota && suaNota.trim() !== '' && !isNaN(notaAluno)) {
          somaNotasAluno += notaCalculada;
        }
        
        html += `<tr>
          <td>${disciplina}</td>
          <td>${av.abrev}</td>
          <td>${av.den}</td>
          <td>${av.nota}</td>
          <td>${av.peso}</td>
          <td>${suaNota}</td>
        </tr>`;
      });

      // Adiciona linha de rodapé com totais
      html += `<tr class="tabela-notas-rodape">
        <td><strong>${disciplina}</strong></td>
        <td colspan="2"><strong>Totais</strong></td>
        <td><strong>${notaTotalSomada.toFixed(2)}</strong></td>
        <td><strong>${somaPesos.toFixed(2)}</strong></td>
        <td><strong>${somaNotasAluno.toFixed(2)}</strong></td>
      </tr>`;

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

// ---------------------- Token helpers & UI timer ----------------------
let __tokenTimerId = null;

// ---------------------- Scrape counter ----------------------
let __scrapeCounterInterval = null;
let __scrapeCounterStartTime = null;
let __elapsedSinceInterval = null;

function formatTimeSince(ms) {
  if (ms < 1000) return 'agora';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `há ${days}d ${hours}h`;
  if (hours > 0) return `há ${hours}h ${minutes}m`;
  if (minutes > 0) return `há ${minutes}m ${seconds}s`;
  return `há ${seconds}s`;
}

function stopElapsedSinceUpdate() {
  if (__elapsedSinceInterval) {
    clearInterval(__elapsedSinceInterval);
    __elapsedSinceInterval = null;
  }
}

function startElapsedSinceUpdate(timestamp) {
  stopElapsedSinceUpdate();
  const el = document.getElementById('scrape-timer');
  if (!el) return;
  el.dataset.lastUpdated = String(timestamp);
  // Atualiza imediatamente
  el.textContent = `Atualizado ${formatTimeSince(Date.now() - timestamp)}`;
  __elapsedSinceInterval = setInterval(() => {
    const last = parseInt(el.dataset.lastUpdated || '0', 10) || 0;
    el.textContent = `Atualizado ${formatTimeSince(Date.now() - last)}`;
  }, 1000);
}

function startScrapeCounter() {
  if (__scrapeCounterInterval) return; // já rodando
  // se havia um contador de tempo desde a última atualização, pare-o
  stopElapsedSinceUpdate();
  __scrapeCounterStartTime = Date.now();
  const form = document.getElementById('sigaa-form');
  if (!form) return;
  let el = document.getElementById('scrape-timer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'scrape-timer';
    el.style.cssText = 'margin-top:8px;color:#555;font-size:0.95em;';
    form.appendChild(el);
  }
  el.style.opacity = '1';
  el.textContent = 'Consultando... 0s';
  __scrapeCounterInterval = setInterval(() => {
    const seconds = Math.floor((Date.now() - __scrapeCounterStartTime) / 1000) + 1;
    el.textContent = `Consultando... ${seconds}s`;
  }, 1000);
}

function stopScrapeCounter(success = true, durationSec = null) {
  if (__scrapeCounterInterval) {
    clearInterval(__scrapeCounterInterval);
    __scrapeCounterInterval = null;
  }
  const el = document.getElementById('scrape-timer');
  if (!el) return;
  if (success) {
    const duration = durationSec || Math.max(1, Math.floor((Date.now() - (__scrapeCounterStartTime || Date.now())) / 1000));
    // Em vez de mostrar duração fixa, guarda o timestamp de atualização e inicia contador "há X"
    const updatedAt = Date.now();
    el.classList.remove('scrape-error');
    el.classList.add('scrape-success');
    // Registra o momento da atualização e inicia contador que mostra 'Atualizado há X'
    startElapsedSinceUpdate(updatedAt);
    // adicionar atributo title com duração da operação
    el.title = `Atualizado (duração do scraping: ${duration}s)`;
  } else {
    el.textContent = 'Erro ao atualizar informações';
    el.classList.add('scrape-error');
    // Remove mensagem de erro após alguns segundos
    setTimeout(() => { try { if (el && el.parentNode) el.parentNode.removeChild(el); } catch (e) {} }, 4000);
  }
}


function parseJwtExpiry(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload && payload.exp) {
      // exp em segundos desde epoch
      return payload.exp * 1000;
    }
  } catch (e) {
    return null;
  }
  return null;
}

function saveTokenWithExpiry(token, storageType = 'local') {
  // Tenta extrair expiry do JWT
  let expiresAt = parseJwtExpiry(token);

  // Se backend retornar expiresIn (não presente atualmente), você pode
  // adaptar para usar esse valor. Aqui assume expiry embutido no JWT.

  const info = { token, expiresAt };
  if (storageType === 'session') {
    sessionStorage.setItem('sigaa_token', token);
    sessionStorage.setItem('sigaa_token_info', JSON.stringify(info));
    localStorage.removeItem('sigaa_token');
    localStorage.removeItem('sigaa_token_info');
  } else {
    localStorage.setItem('sigaa_token', token);
    localStorage.setItem('sigaa_token_info', JSON.stringify(info));
    sessionStorage.removeItem('sigaa_token');
    sessionStorage.removeItem('sigaa_token_info');
  }

  // Inicia/atualiza timer de exibição do token
  startTokenTimer();
}

function getTokenInfo() {
  const infoLocal = localStorage.getItem('sigaa_token_info');
  if (infoLocal) {
    try { return JSON.parse(infoLocal); } catch (e) { /* fallthrough */ }
  }
  const infoSession = sessionStorage.getItem('sigaa_token_info');
  if (infoSession) {
    try { return JSON.parse(infoSession); } catch (e) { /* fallthrough */ }
  }
  return null;
}

function clearStoredTokenInfo() {
  localStorage.removeItem('sigaa_token');
  localStorage.removeItem('sigaa_token_info');
  sessionStorage.removeItem('sigaa_token');
  sessionStorage.removeItem('sigaa_token_info');
}

function ensureTokenStatusElement() {
  let el = document.getElementById('token-status');
  if (!el) {
    // tenta inserir após o header do conteúdo da home (abaixo do formulário)
    const homeHeader = document.getElementById('home-content-header');
    const homeContent = document.getElementById('home-content');
    const container = homeHeader || homeContent || document.body;
    el = document.createElement('div');
    el.id = 'token-status';
    // mantemos estilo inline mínimo para evitar regressões; prefer class if needed
    el.style.cssText = 'font-size:0.9em;color:#444;margin:8px 0;padding:6px 10px;border-radius:6px;background:#f7f7f7;display:inline-block;';
    if (homeHeader && homeHeader.parentNode) {
      // inserir logo após o header dentro de home-content
      if (homeHeader.nextSibling) {
        homeHeader.parentNode.insertBefore(el, homeHeader.nextSibling);
      } else {
        homeHeader.parentNode.appendChild(el);
      }
    } else if (homeContent) {
      // anexa ao final do home-content
      homeContent.appendChild(el);
    } else {
      container.insertBefore(el, container.firstChild);
    }
  }
  return el;
}

function formatTimeRemaining(ms) {
  if (ms <= 0) return 'expirado';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function updateTokenStatusUI() {
  const info = getTokenInfo();
  const el = ensureTokenStatusElement();
  if (!info || !info.token) {
    el.textContent = 'Sem token salvo';
    return;
  }

  if (!info.expiresAt) {
    el.textContent = 'Token presente (expiração desconhecida)';
    return;
  }

  const now = Date.now();
  const remaining = info.expiresAt - now;
  if (remaining <= 0) {
    el.textContent = 'Token expirado';
    // opcional: remover token expirado automaticamente
    // clearStoredTokenInfo();
    // stopTokenTimer();
    return;
  }

  el.textContent = `Token válido por: ${formatTimeRemaining(remaining)}`;
}

function startTokenTimer() {
  stopTokenTimer();
  updateTokenStatusUI();
  // Atualiza a cada 1s para contagem regressiva; pode ser aumentado
  __tokenTimerId = setInterval(() => {
    const info = getTokenInfo();
    if (!info || !info.expiresAt) {
      updateTokenStatusUI();
      return;
    }
    const remaining = info.expiresAt - Date.now();
    if (remaining <= 0) {
      updateTokenStatusUI();
      stopTokenTimer();
      // notifica o usuário visualmente
      const el = ensureTokenStatusElement();
      el.textContent = 'Token expirado — faça login novamente';
      return;
    }
    updateTokenStatusUI();
  }, 1000);
}

function stopTokenTimer() {
  if (__tokenTimerId) {
    clearInterval(__tokenTimerId);
    __tokenTimerId = null;
  }
}

// ---------------------- End token helpers ----------------------
// ...existing code...
function ajustarMaxHeightNovidades() {
  const loading = document.getElementById('loading');
  const novidades = document.getElementById('tabela-novidades-container');
  if (!novidades) return;
  if (window.innerWidth < 1040) return; // só aplica em desktop

  let maxHeight = 486;
  let maxHeightExpanded = 871;

  const dados = document.getElementById('dados-institucionais');
  const expanded = dados && dados.classList.contains('expanded');
  const hovered = dados && dados.matches(':hover');

  if (expanded || hovered) {
    maxHeight = maxHeightExpanded;
  }

  // Se loading está escondido, diminui 19px; se visível, soma 19px
  if (loading && loading.style.display === 'none') {
    novidades.style.maxHeight = (maxHeight - 19) + 'px';
  } else {
    novidades.style.maxHeight = maxHeight + 'px';
  }
}

// Atualiza novidades ao passar mouse em dados institucionais
const dadosDiv = document.getElementById('dados-institucionais');
if (dadosDiv) {
  dadosDiv.addEventListener('mouseenter', ajustarMaxHeightNovidades);
  dadosDiv.addEventListener('mouseleave', ajustarMaxHeightNovidades);
}
// ...existing code...

// Sempre que mostrar/esconder o loading, chame ajustarMaxHeightNovidades()
function showLoading() {
  document.getElementById('loading').style.display = '';
  ajustarMaxHeightNovidades();
}
function hideLoading() {
  document.getElementById('loading').style.display = 'none';
  ajustarMaxHeightNovidades();
}

// Garante ajuste automático mesmo se display mudar por outros meios
const loading = document.getElementById('loading');
if (loading) {
  const observer = new MutationObserver(ajustarMaxHeightNovidades);
  observer.observe(loading, { attributes: true, attributeFilter: ['style'] });
}

// Também ajusta ao redimensionar ou carregar a página
window.addEventListener('resize', ajustarMaxHeightNovidades);
window.addEventListener('DOMContentLoaded', ajustarMaxHeightNovidades);
