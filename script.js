// Importa a função de exportação do boletim
// <script src="boletim.js"></script> deve estar incluído no index.html antes de script.js para garantir que a função esteja disponível

// URL base da API — em desenvolvimento local o server.js injeta window.API_BASE_URL via index.html
const API_BASE = window.API_BASE_URL || 'https://ak4ai-sigaa.duckdns.org';

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

  // Dynamic header scroll behavior with smooth ease animation
  const pageHeader = document.querySelector('.page-header');
  const animationScrollDistance = 100; // Pixels to scroll for full animation (header reaches top)
  const headerHeight = pageHeader?.offsetHeight || 70;
  
  // Easing function for smooth animation (easeInOutCubic)
  const easeInOutCubic = (t) => {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };
  
  window.addEventListener('scroll', () => {
    const scrollY = window.scrollY;
    
    // Calculate progress based on scroll distance (0 to 28px = 0% to 100%)
    let linearProgress = Math.max(0, Math.min(1, scrollY / animationScrollDistance));
    
    // Apply easing function for smooth acceleration/deceleration
    const easedProgress = easeInOutCubic(linearProgress);
    
    // Update CSS custom properties with eased progress
    pageHeader?.style.setProperty('--scroll-progress', easedProgress);
    pageHeader?.style.setProperty('--scroll-pad-y', (easedProgress * 2) + 'px');
    pageHeader?.style.setProperty('--scroll-pad-x', (easedProgress * 2) + 'px');
    pageHeader?.style.setProperty('--scroll-margin', (easedProgress * 20) + 'px');
    pageHeader?.style.setProperty('--scroll-radius', (easedProgress * 12) + 'px');
    pageHeader?.style.setProperty('--scroll-blur', (easedProgress * 2) + 'px');
    pageHeader?.style.setProperty('--scroll-shadow', (easedProgress * 0.12) + '');
    pageHeader?.style.setProperty('--scroll-bg', (easedProgress * 0.03) + '');
    
    // Smoothly transition padding-top throughout the animation
    const basePadding = 20;
    const targetPadding = headerHeight + 4;
    const paddingDiff = targetPadding - basePadding;
    const currentPadding = basePadding + (paddingDiff * easedProgress);
    document.body.style.paddingTop = currentPadding + 'px';
  }, { passive: true });
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
        const resp = await fetch(`${API_BASE}/api/login`, {
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

  let queuePollInterval = null;

  try {
    // inicia contador visível no formulário
    startScrapeCounter();
    const inicio = performance.now();

        // ID único deste cliente para rastrear posição na fila
        const clientId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

        // Usa AbortController para poder parar o fetch se necessário
        const controller = new AbortController();

        // Inicia fetch (pode ficar na fila do backend)
        const fetchPromise = fetch(`${API_BASE}/api/scraper`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, clientId }),
            signal: controller.signal
        });

        // Mostra display de fila imediatamente (o fetch pode demorar)
        updateQueueDisplay(-1, 60000); // -1 = "entrando na fila..."

        // Polling da fila a cada 2s usando clientId para posição exata
        // NUNCA esconde o display — só atualiza. O hide é feito no finally.
        console.log(`[FILA] clientId deste request: ${clientId}`);
        queuePollInterval = setInterval(async () => {
            try {
                const statusResp = await fetch(`${API_BASE}/api/queue-status?clientId=${clientId}`, { method: 'GET' });
                const statusData = await statusResp.json();
                console.log(`[FILA] poll response:`, statusData);
                if (statusData.position > 0) {
                    // position = posição exata deste cliente na fila
                    updateQueueDisplay(statusData.position, statusData.avgTimeMs);
                } else if (statusData.position === -1) {
                    // Ainda não apareceu no servidor — mostra "entrando na fila"
                    updateQueueDisplay(-1, statusData.avgTimeMs);
                } else {
                    // position = 0 — não encontrado (já terminou ou erro)
                    updateQueueDisplay(1, statusData.avgTimeMs);
                }
            } catch (e) { /* ignora erros de polling */ }
        }, 2000);

        const response = await fetchPromise;

        // Para o polling ao receber resposta
        if (queuePollInterval) { clearInterval(queuePollInterval); queuePollInterval = null; }
        hideQueueDisplay();

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

        horariosGlobais = data.horariosSimplificados || [];
        preencherTabelaSimplificada(data.horariosSimplificados);
        atualizarViewAtiva();
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
        } else {
          preencherTabelaNovidades([]);
          frequenciasGlobais = [];
          notasGlobais = [];
        }

        // Atividades (campo opcional do backend)
        // Atividades (campo opcional do backend + fallback por avisos)
        atividadesGlobais = extrairAtividades(data);
        preencherTabelaAtividades(atividadesGlobais);

        //document.getElementById('tabela-horarios').style.display = '';
        document.getElementById('tabela-horarios-detalhados').style.display = '';

  } catch (error) {
    console.error('Erro ao consultar com token:', error);
    errorDiv.textContent = error.message;
    // para contador com flag de erro
    stopScrapeCounter(false);
    if (queuePollInterval) { clearInterval(queuePollInterval); queuePollInterval = null; }
    hideQueueDisplay();
  } finally {
    const fimGeral = performance.now();
    const duracaoSegundosGeral = Math.max(1, Math.round((fimGeral - (typeof inicio !== 'undefined' ? inicio : fimGeral)) / 1000));
    stopScrapeCounter(true, duracaoSegundosGeral);
    loadingDiv.style.display = 'none';
    if (queuePollInterval) { clearInterval(queuePollInterval); queuePollInterval = null; }
    hideQueueDisplay();
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
  // Inicia toggle de visualização lista/semanal
  initViewToggle();
  // Inicia swipe para trocar de tab no mobile
  initSwipeTabs();
});

// Botão de logout/apagar informações
document.getElementById('logout-btn').addEventListener('click', () => {
  if (!confirm('Tem certeza que deseja sair?\nSeus dados salvos serão apagados.')) return;

  // 1. Remove tokens do storage
  clearStoredTokenInfo();
  stopTokenTimer();

  // 2. Remove dados salvos do localStorage
  localStorage.removeItem('sigaaUltimaConsulta');
  localStorage.removeItem('sigaa_aviso_fechado');

  // 3. Limpa variáveis globais em memória
  horariosGlobais = [];
  frequenciasGlobais = [];
  notasGlobais = [];
  atividadesGlobais = [];
  novidadesGlobais = [];

  // 4. Limpa toda a interface — dados institucionais
  const dadosDiv = document.getElementById('dados-institucionais');
  if (dadosDiv) dadosDiv.innerHTML = '';

  // 5. Limpa tabelas de horários (simplificada)
  ['tabela-horarios-hoje', 'tabela-horarios-segunda', 'tabela-horarios-terca',
   'tabela-horarios-quarta', 'tabela-horarios-quinta', 'tabela-horarios-sexta'
  ].forEach(id => {
    const tbl = document.getElementById(id);
    if (tbl) {
      const tbody = tbl.querySelector('tbody');
      if (tbody) tbody.innerHTML = '';
      tbl.style.display = 'none';
    }
  });

  // 6. Limpa tabela detalhada
  const tblDet = document.getElementById('tabela-horarios-detalhados');
  if (tblDet) {
    const tbody = tblDet.querySelector('tbody');
    if (tbody) tbody.innerHTML = '';
    tblDet.style.display = 'none';
  }

  // 7. Limpa frequências
  const tblFreq = document.getElementById('tabela-frequencias');
  if (tblFreq) {
    const tbody = tblFreq.querySelector('tbody');
    if (tbody) tbody.innerHTML = '';
    tblFreq.style.display = 'none';
  }
  const selFreq = document.getElementById('select-disciplina-frequencia');
  if (selFreq) selFreq.innerHTML = '<option value="todas">Todas</option>';
  const resumoFreq = document.getElementById('resumo-frequencia-disciplina');
  if (resumoFreq) resumoFreq.innerHTML = '';
  const barraFreq = document.getElementById('barra-progresso-faltas');
  if (barraFreq) barraFreq.innerHTML = '';

  // 8. Limpa notas
  const tblNotas = document.getElementById('tabela-notas');
  if (tblNotas) {
    const tbody = tblNotas.querySelector('tbody');
    if (tbody) tbody.innerHTML = '';
    tblNotas.style.display = 'none';
  }
  const selNotas = document.getElementById('select-disciplina-notas');
  if (selNotas) selNotas.innerHTML = '<option value="todas">Todas</option>';

  // 9. Limpa novidades e atividades
  const tblNovHome = document.getElementById('tabela-novidades-home');
  if (tblNovHome) {
    const tbody = tblNovHome.querySelector('tbody');
    if (tbody) tbody.innerHTML = '';
    tblNovHome.style.display = 'none';
  }
  const tblAtivHome = document.getElementById('tabela-atividades-home');
  if (tblAtivHome) {
    const tbody = tblAtivHome.querySelector('tbody');
    if (tbody) tbody.innerHTML = '';
    tblAtivHome.style.display = 'none';
  }
  const tblAtivTab = document.getElementById('tabela-atividades-atividades');
  if (tblAtivTab) {
    const tbody = tblAtivTab.querySelector('tbody');
    if (tbody) tbody.innerHTML = '';
    tblAtivTab.style.display = 'none';
  }

  // 10. Limpa timer/status de scrape
  const scrapeTimer = document.getElementById('scrape-timer');
  if (scrapeTimer) scrapeTimer.remove();
  const tokenStatus = document.getElementById('token-status');
  if (tokenStatus) tokenStatus.textContent = '';

  // 11. Limpa campos de login
  const userInput = document.getElementById('user');
  const passInput = document.getElementById('pass');
  if (userInput) userInput.value = '';
  if (passInput) passInput.value = '';

  // 12. Limpa erros e loading
  const errorDiv = document.getElementById('error');
  if (errorDiv) errorDiv.textContent = '';
  const loadingDiv = document.getElementById('loading');
  if (loadingDiv) loadingDiv.style.display = 'none';

  // 13. Volta para a tab Home
  document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
  const homeTab = document.querySelector('[data-tab="tab-home"]');
  const homeContent = document.getElementById('tab-home');
  if (homeTab) homeTab.classList.add('active');
  if (homeContent) homeContent.classList.add('active');

  // 14. Reaplica estilo de "sem dados" — volta à interface inicial de login
  const homeContentDiv = document.getElementById('home-content');
  const tabHomeDiv = document.getElementById('tab-home');
  if (homeContentDiv) {
    homeContentDiv.classList.add('sem-dados');
    if (!homeContentDiv.querySelector('.mensagem-sem-dados')) {
      homeContentDiv.insertAdjacentHTML('beforeend', `
        <div class="mensagem-sem-dados">
          Nenhum dado encontrado.<br>
          Faça login para visualizar suas informações.
        </div>
      `);
    }
  }
  if (tabHomeDiv) tabHomeDiv.classList.add('sem-dados');

  // 15. Esconde elementos que só aparecem com dados
  const dadosInst = document.getElementById('dados-institucionais');
  if (dadosInst) dadosInst.style.display = 'none';
  const listasContainer = document.getElementById('home-listas-container');
  if (listasContainer) listasContainer.style.display = 'none';
  const homeAviso = document.getElementById('home-aviso');
  if (homeAviso) homeAviso.style.display = 'none';

  // 16. Esconde a barra de tabs inteira e o FAB
  const tabsBar = document.querySelector('.tabs');
  if (tabsBar) tabsBar.style.display = 'none';
  const fab = document.getElementById('mobile-fab');
  if (fab) {
    fab.classList.add('minimized');
    setTimeout(() => {
      fab.style.display = 'none';
    }, 300);
  }
});

// Salva os dados para filtrar depois
let frequenciasGlobais = [];
let atividadesGlobais = [];
let novidadesGlobais = [];
let __homeHeightSyncInterval = null;

function isHomeTabActive() {
  const homeTab = document.getElementById('tab-home');
  return !!homeTab && homeTab.classList.contains('active') && document.visibilityState === 'visible';
}

function runHomeHeightSyncTick() {
  if (!isHomeTabActive()) return;
  atualizarHomePainelNovidadesAtividades();
  ajustarAlturaNovidades();
}

function startHomeHeightSyncLoop() {
  if (__homeHeightSyncInterval) return;
  __homeHeightSyncInterval = setInterval(() => {
    if (!isHomeTabActive()) {
      stopHomeHeightSyncLoop();
      return;
    }
    runHomeHeightSyncTick();
  }, 350);
}

function stopHomeHeightSyncLoop() {
  if (!__homeHeightSyncInterval) return;
  clearInterval(__homeHeightSyncInterval);
  __homeHeightSyncInterval = null;
}

function refreshHomeHeightSyncLoop() {
  if (isHomeTabActive()) {
    startHomeHeightSyncLoop();
    runHomeHeightSyncTick();
  } else {
    stopHomeHeightSyncLoop();
  }
}

function extrairAtividades(data) {
  if (!data) return [];

  // Preferir campo dedicado quando o backend disponibilizar.
  if (Array.isArray(data.atividades) && data.atividades.length > 0) {
    return data.atividades.flatMap(({ disciplina, atividades }) =>
      (atividades || []).map(({ data: dataAtiv, descricao }) => ({
        disciplina,
        data: dataAtiv || '',
        descricao: descricao || ''
      }))
    );
  }

  // Fallback: filtra avisos que parecem atividades acadêmicas.
  if (!Array.isArray(data.avisosPorDisciplina)) return [];
  const regexAtividade = /(atividade|lista|trabalho|tarefa|exercicio|exercício|projeto|seminario|seminário|avaliacao|avaliação|prova|entrega)/i;
  return data.avisosPorDisciplina.flatMap(({ disciplina, avisos }) =>
    (avisos || [])
      .filter(aviso => regexAtividade.test(aviso?.descricao || ''))
      .map(({ data: dataAviso, descricao }) => ({
        disciplina,
        data: dataAviso || '',
        descricao: descricao || ''
      }))
  );
}

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
  const cardHeader = document.querySelector('.freq-card-header');
  const isMobile = window.innerWidth <= 1040;
  tbody.innerHTML = '';
  resumoDiv.innerHTML = '';
  barraDiv.innerHTML = '';

  if (filtro === "todas") {
    // Esconde resumo e barra de progresso
    resumoDiv.style.display = "none";
    barraDiv.style.display = "none";
    if (cardHeader) cardHeader.textContent = 'Resumo de Frequências';
    thead.innerHTML = `
      <tr>
        <th>Disciplina</th>
        <th>${isMobile ? 'Aulas' : 'Nº Aulas'}</th>
        <th>${isMobile ? 'Faltas' : 'Total de Faltas'}</th>
        <th>% Presença</th>
        <th>${isMobile ? 'Rest. (h)' : 'Faltas Restantes (horários)'}</th>
        <th>${isMobile ? 'Rest. (A)' : 'Faltas Restantes (Aulas)'}</th>
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
        <td><span class="disc-name">${disciplina}</span></td>
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
    if (cardHeader) cardHeader.textContent = 'Detalhes de Frequência';
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
              <th>${isMobile ? 'Aulas' : 'Nº Aulas'}</th>
              <th>${isMobile ? 'Faltas' : 'Total de Faltas'}</th>
              <th>% Presença</th>
              <th>${isMobile ? '% Sigaa' : '% Porcentagem - Sigaa'}</th>
              <th>${isMobile ? 'Rest. (h)' : 'Faltas Restantes (horários)'}</th>
              <th>${isMobile ? 'Rest. (A)' : 'Faltas Restantes (Aulas)'}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span class="disc-name">${disciplina}</span></td>
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
// ─── Exportação Google Calendar (.ics) ────────────────────────────────────
// ─── Abrir no Google Calendar (sem importar arquivo) ─────────────────────
function abrirNoGoogleCalendar() {
    if (!horariosGlobais || horariosGlobais.length === 0) {
        alert('Nenhum horário disponível. Faça o scraping primeiro.');
        return;
    }

    const diasSemanaNum = {
        'Domingo': 0, 'Segunda-feira': 1, 'Terça-feira': 2,
        'Quarta-feira': 3, 'Quinta-feira': 4, 'Sexta-feira': 5, 'Sábado': 6
    };
    const diasIcal = {
        'Segunda-feira': 'MO', 'Terça-feira': 'TU', 'Quarta-feira': 'WE',
        'Quinta-feira': 'TH', 'Sexta-feira': 'FR', 'Sábado': 'SA'
    };

    const semestre = horariosGlobais[0]?.semestre || '';
    const anoBase = semestre.split('.')[0] || new Date().getFullYear();
    const dataFim = semestre.includes('.2') ? `${anoBase}1130T030000Z` : `${anoBase}0731T030000Z`;

    function proximaOcorrencia(diaNome) {
        const hoje = new Date();
        const alvo = diasSemanaNum[diaNome];
        let diff = alvo - hoje.getDay();
        if (diff <= 0) diff += 7;
        const d = new Date(hoje);
        d.setDate(hoje.getDate() + diff);
        return d;
    }

    // Formato UTC para URL do Google Calendar (BRT = UTC-3)
    // Usa Date.UTC() diretamente para evitar interferência do fuso local do computador
    function toGCalUTC(data, horaStr) {
        const [h, m] = horaStr.split(':').map(Number);
        const p = n => String(n).padStart(2, '0');
        // Converte BRT → UTC somando 3h usando Date.UTC (independente do fuso local)
        const dt = new Date(Date.UTC(data.getFullYear(), data.getMonth(), data.getDate(), h + 3, m, 0));
        return `${dt.getUTCFullYear()}${p(dt.getUTCMonth()+1)}${p(dt.getUTCDate())}T${p(dt.getUTCHours())}${p(dt.getUTCMinutes())}00Z`;
    }

    // Monta links e exibe modal
    const links = horariosGlobais.map(({ disciplina, turma, dia, horário }) => {
        const [inicio, fim] = horário.split('-');
        const dataBase = proximaOcorrencia(dia);
        const dtStart = toGCalUTC(dataBase, inicio);
        const dtEnd   = toGCalUTC(dataBase, fim);
        const titulo  = encodeURIComponent(disciplina);
        const detalhe = encodeURIComponent(`Turma/Sala: ${turma}\nHorario: ${horário}`);
        const local   = encodeURIComponent(`CEFET-MG - ${turma}`);
        const rrule   = encodeURIComponent(`RRULE:FREQ=WEEKLY;BYDAY=${diasIcal[dia]};UNTIL=${dataFim}`);
        // crm=AVAILABLE = sem ocupar agenda; sem parâmetro de notificação (Google não suporta via URL)
        const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${titulo}&dates=${dtStart}/${dtEnd}&details=${detalhe}&location=${local}&recur=${rrule}&crm=AVAILABLE&sf=true&output=xml`;
        return { disciplina, turma, dia, horário, url };
    });

    // Remove modal anterior se existir
    document.getElementById('gcal-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'gcal-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;max-width:640px;width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.25)">
            <div style="padding:20px 24px 12px;border-bottom:1px solid #e0e0e0;display:flex;justify-content:space-between;align-items:center">
                <strong style="font-size:16px">Adicionar ao Google Agenda</strong>
                <button onclick="document.getElementById('gcal-modal').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#555;padding:0 4px">&times;</button>
            </div>
            <div style="padding:16px 24px">
                <p style="margin:0 0 14px;color:#555;font-size:13px">Clique em cada disciplina para abrir o Google Agenda com o evento já preenchido. Basta confirmar o salvamento.</p>
                ${links.map(({ disciplina, turma, dia, horário, url }) => `
                    <a href="${url}" target="_blank" rel="noopener" style="display:flex;align-items:flex-start;gap:12px;padding:10px 12px;border:1px solid #e0e0e0;border-radius:8px;margin-bottom:8px;text-decoration:none;color:inherit;transition:background 0.15s" onmouseover="this.style.background='#f1f7ff'" onmouseout="this.style.background=''">
                        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="#1a73e8" style="flex-shrink:0;margin-top:2px"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/></svg>
                        <div>
                            <div style="font-weight:600;font-size:14px">${disciplina}</div>
                            <div style="font-size:12px;color:#666;margin-top:2px">${dia} · ${horário} · ${turma}</div>
                        </div>
                    </a>
                `).join('')}
            </div>
        </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}
// ───────────────────────────────────────────────────────────────────────────

function exportarParaGoogleCalendar() {
    if (!horariosGlobais || horariosGlobais.length === 0) {
        alert('Nenhum horário disponível. Faça o scraping primeiro.');
        return;
    }

    const diasSemanaNum = {
        'Domingo': 0, 'Segunda-feira': 1, 'Terça-feira': 2,
        'Quarta-feira': 3, 'Quinta-feira': 4, 'Sexta-feira': 5, 'Sábado': 6
    };
    const diasIcal = {
        'Segunda-feira': 'MO', 'Terça-feira': 'TU', 'Quarta-feira': 'WE',
        'Quinta-feira': 'TH', 'Sexta-feira': 'FR', 'Sábado': 'SA'
    };

    const semestre = horariosGlobais[0]?.semestre || '';
    // Fim do semestre: 1º=julho, 2º=novembro
    const anoBase = semestre.split('.')[0] || new Date().getFullYear();
    const dataFim = semestre.includes('.2') ? `${anoBase}1130` : `${anoBase}0731`;

    function proximaOcorrencia(diaNome) {
        const hoje = new Date();
        const alvo = diasSemanaNum[diaNome];
        let diff = alvo - hoje.getDay();
        if (diff <= 0) diff += 7;
        const d = new Date(hoje);
        d.setDate(hoje.getDate() + diff);
        return d;
    }

    // Formata datetime em UTC (Brasil = UTC-3)
    function toIcalUTC(data, horaStr) {
        const [h, m] = horaStr.split(':').map(Number);
        const dt = new Date(data);
        dt.setHours(h + 3, m, 0, 0);
        const p = n => String(n).padStart(2, '0');
        return `${dt.getUTCFullYear()}${p(dt.getUTCMonth()+1)}${p(dt.getUTCDate())}T${p(dt.getUTCHours())}${p(dt.getUTCMinutes())}00Z`;
    }

    const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2) + '@sigaa';

    // Formata como local time (sem Z) para usar com TZID=America/Sao_Paulo
    function toIcalLocal(data, horaStr) {
        const [h, m] = horaStr.split(':').map(Number);
        const dt = new Date(data);
        const p = n => String(n).padStart(2, '0');
        return `${dt.getFullYear()}${p(dt.getMonth()+1)}${p(dt.getDate())}T${p(h)}${p(m)}00`;
    }

    // Remove acentos e caracteres especiais — garante compatibilidade total
    function normalizar(str) {
        return (str || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')  // remove diacríticos (acentos, cedilha, til, etc)
            .replace(/[^\x00-\x7F]/g, '?');   // qualquer outro char não-ASCII vira '?'
    }

    // Escapa chars especiais conforme RFC 5545
    function escIcal(str) {
        return (str || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    }

    // Folding: quebra linhas > 75 chars com CRLF + espaço (RFC 5545 sec 3.1)
    function fold(line) {
        const bytes = new TextEncoder().encode(line);
        if (bytes.length <= 75) return line;
        let result = '';
        let cur = '';
        let curBytes = 0;
        for (const char of line) {
            const charBytes = new TextEncoder().encode(char).length;
            if (curBytes + charBytes > 75) {
                result += cur + '\r\n ';
                cur = char;
                curBytes = 1 + charBytes; // 1 = espaço de continuação
            } else {
                cur += char;
                curBytes += charBytes;
            }
        }
        return result + cur;
    }

    const blocos = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//SIGAA APP//Horarios SIGAA//PT',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        fold(`X-WR-CALNAME:Horarios SIGAA ${semestre}`),
        'X-WR-TIMEZONE:America/Sao_Paulo',
        'BEGIN:VTIMEZONE',
        'TZID:America/Sao_Paulo',
        'BEGIN:STANDARD',
        'DTSTART:19700101T000000',
        'TZOFFSETFROM:-0200',
        'TZOFFSETTO:-0300',
        'TZNAME:BRT',
        'END:STANDARD',
        'END:VTIMEZONE',
    ];

    horariosGlobais.forEach(({ disciplina, turma, dia, horário }) => {
        const [inicio, fim] = horário.split('-');
        const dataBase = proximaOcorrencia(dia);
        blocos.push(
            'BEGIN:VEVENT',
            fold(`UID:${uid()}`),
            fold(`DTSTART;TZID=America/Sao_Paulo:${toIcalLocal(dataBase, inicio)}`),
            fold(`DTEND;TZID=America/Sao_Paulo:${toIcalLocal(dataBase, fim)}`),
            fold(`RRULE:FREQ=WEEKLY;BYDAY=${diasIcal[dia]};UNTIL=${dataFim}T030000Z`),
            fold(`SUMMARY:${escIcal(normalizar(disciplina))}`),
            fold(`DESCRIPTION:Turma/Sala: ${escIcal(normalizar(turma))}\\nHorario: ${escIcal(horário)}`),
            fold(`LOCATION:CEFET-MG - ${escIcal(normalizar(turma))}`),
            'STATUS:CONFIRMED',
            'END:VEVENT'
        );
    });

    blocos.push('END:VCALENDAR');

    // SEM BOM — causa falha de parse no Google Calendar
    const conteudo = blocos.join('\r\n');
    // Todo conteúdo é ASCII puro após normalizar() — Blob direto sem risco de encoding
    const blob = new Blob([conteudo], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `horarios-sigaa-${semestre}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Abre Google Agenda na página de importação após o download
    setTimeout(() => {
        const abrir = confirm(
            'Arquivo .ics baixado!\n\n' +
            'Clique em OK para abrir o Google Agenda e importar todos os eventos de uma vez.\n\n' +
            'Na página que abrir: clique em "Importar" → selecione o arquivo baixado → clique em "Importar".'
        );
        if (abrir) {
            window.open('https://calendar.google.com/calendar/r/settings/export', '_blank');
        }
    }, 500);
}
// ───────────────────────────────────────────────────────────────────────────

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

// ===== Visualização Semanal (Google Calendar style) =====
const weeklyEventColors = [
  '#062d58', '#0277bd', '#00838f', '#00695c', '#2e7d32',
  '#558b2f', '#9e9d24', '#f9a825', '#ff8f00', '#ef6c00',
  '#d84315', '#6a1b9a', '#4527a0', '#283593', '#c62828'
];
const disciplinaColorMap = {};
let nextColorIdx = 0;

function getDisciplinaColor(disciplina) {
  if (!disciplinaColorMap[disciplina]) {
    disciplinaColorMap[disciplina] = weeklyEventColors[nextColorIdx % weeklyEventColors.length];
    nextColorIdx++;
  }
  return disciplinaColorMap[disciplina];
}

function parseHora(str) {
  const [h, m] = str.split(':').map(Number);
  return h + m / 60;
}

function preencherVisualizacaoSemanal(horarios) {
  const container = document.querySelector('.weekly-calendar');
  if (!container) return;
  container.innerHTML = '';

  if (!horarios || horarios.length === 0) {
    container.innerHTML = '<div style="padding:24px;text-align:center;color:#888;grid-column:1/-1">Nenhum horário disponível.</div>';
    return;
  }

  const dias = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira'];
  const diasCurtos = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];

  // Determine time range from data
  let minH = 24, maxH = 0;
  horarios.forEach(({ horário }) => {
    const [ini, fim] = horário.split('-');
    minH = Math.min(minH, Math.floor(parseHora(ini)));
    maxH = Math.max(maxH, Math.ceil(parseHora(fim)));
  });
  minH = Math.max(6, minH);
  maxH = Math.min(23, maxH);

  const totalHours = maxH - minH;
  const rowHeight = 48; // px per hour
  const totalHeight = totalHours * rowHeight;

  // Build structure: a simple CSS grid with time column + 5 day columns
  // Each day column is position:relative so events can be placed absolutely
  // gridTemplateColumns is set via CSS (56px desktop, 36px mobile)
  container.style.gridTemplateRows = 'auto 1fr';

  // Header row
  const thTime = document.createElement('div');
  thTime.className = 'wc-header wc-header-time';
  container.appendChild(thTime);

  diasCurtos.forEach(d => {
    const hdr = document.createElement('div');
    hdr.className = 'wc-header';
    hdr.textContent = d;
    container.appendChild(hdr);
  });

  // Time labels column (body area)
  const timeCol = document.createElement('div');
  timeCol.className = 'wc-time-col';
  timeCol.style.cssText = `position:relative;height:${totalHeight}px;border-right:1px solid #dadce0;`;
  for (let h = minH; h < maxH; h++) {
    const lbl = document.createElement('div');
    lbl.className = 'wc-time-label';
    lbl.style.cssText = `position:absolute;top:${(h - minH) * rowHeight}px;width:100%;height:${rowHeight}px;box-sizing:border-box;border-bottom:1px solid #ebebeb;`;
    const sp = document.createElement('span');
    sp.textContent = `${String(h).padStart(2, '0')}:00`;
    lbl.appendChild(sp);
    timeCol.appendChild(lbl);
  }
  container.appendChild(timeCol);

  // Group events by day
  const eventosPorDia = {};
  dias.forEach(d => eventosPorDia[d] = []);
  horarios.forEach(item => {
    if (eventosPorDia[item.dia]) eventosPorDia[item.dia].push(item);
  });

  // Day columns with grid lines + events
  dias.forEach((dia, colIdx) => {
    const dayCol = document.createElement('div');
    dayCol.className = 'wc-day-column';
    dayCol.style.cssText = `position:relative;height:${totalHeight}px;border-right:${colIdx < 4 ? '1px solid #ebebeb' : 'none'};`;

    // Hour grid lines
    for (let h = minH; h < maxH; h++) {
      const line = document.createElement('div');
      line.style.cssText = `position:absolute;top:${(h - minH) * rowHeight}px;left:0;right:0;height:${rowHeight}px;border-bottom:1px solid #ebebeb;box-sizing:border-box;`;
      dayCol.appendChild(line);
    }

    // Events
    eventosPorDia[dia].forEach(({ disciplina, turma, horário }) => {
      const [ini, fim] = horário.split('-');
      const startH = parseHora(ini);
      const endH = parseHora(fim);
      const topPx = (startH - minH) * rowHeight;
      const heightPx = (endH - startH) * rowHeight;

      const ev = document.createElement('div');
      ev.className = 'wc-event';
      ev.style.top = topPx + 'px';
      ev.style.height = Math.max(heightPx - 2, 18) + 'px';
      ev.style.backgroundColor = getDisciplinaColor(disciplina);

      const titleDiv = document.createElement('div');
      titleDiv.className = 'wc-event-title';
      titleDiv.textContent = disciplina;
      ev.appendChild(titleDiv);

      if (heightPx >= 36) {
        const timeDiv = document.createElement('div');
        timeDiv.className = 'wc-event-time';
        timeDiv.textContent = horário;
        ev.appendChild(timeDiv);
      }
      if (heightPx >= 50) {
        const roomDiv = document.createElement('div');
        roomDiv.className = 'wc-event-room';
        roomDiv.textContent = turma;
        ev.appendChild(roomDiv);
      }

      dayCol.appendChild(ev);
    });

    container.appendChild(dayCol);
  });
}

// ===== Visualização 3 Dias =====
function preencherVisualizacao3Dias(horarios) {
  const container = document.querySelector('.three-day-calendar');
  if (!container) return;
  container.innerHTML = '';

  if (!horarios || horarios.length === 0) {
    container.innerHTML = '<div style="padding:24px;text-align:center;color:#888;grid-column:1/-1">Nenhum horário disponível.</div>';
    return;
  }

  const diasSemana = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const diasCurtosMap = { 'Domingo': 'Dom', 'Segunda-feira': 'Seg', 'Terça-feira': 'Ter', 'Quarta-feira': 'Qua', 'Quinta-feira': 'Qui', 'Sexta-feira': 'Sex', 'Sábado': 'Sáb' };

  // Decide which 3 days to show: today + next 2 weekdays (skip weekends)
  const hoje = new Date();
  const hojeIdx = hoje.getDay(); // 0=dom..6=sab
  const tresDias = [];
  let d = new Date(hoje);
  while (tresDias.length < 3) {
    const idx = d.getDay();
    if (idx >= 1 && idx <= 5) tresDias.push(diasSemana[idx]);
    d.setDate(d.getDate() + 1);
  }

  const diasCurtos = tresDias.map(dia => diasCurtosMap[dia]);

  // Highlight today
  const hojeNome = diasSemana[hojeIdx];

  // Time range
  let minH = 24, maxH = 0;
  horarios.forEach(({ horário }) => {
    const [ini, fim] = horário.split('-');
    minH = Math.min(minH, Math.floor(parseHora(ini)));
    maxH = Math.max(maxH, Math.ceil(parseHora(fim)));
  });
  minH = Math.max(6, minH);
  maxH = Math.min(23, maxH);

  const totalHours = maxH - minH;
  const rowHeight = 48;
  const totalHeight = totalHours * rowHeight;

  // gridTemplateColumns is set via CSS (56px desktop, 36px mobile)
  container.style.gridTemplateRows = 'auto 1fr';

  // Header row
  const thTime = document.createElement('div');
  thTime.className = 'wc-header wc-header-time';
  container.appendChild(thTime);

  tresDias.forEach((dia, i) => {
    const hdr = document.createElement('div');
    hdr.className = 'wc-header';
    if (dia === hojeNome) hdr.classList.add('wc-header-today');
    hdr.textContent = diasCurtos[i];
    container.appendChild(hdr);
  });

  // Time labels column
  const timeCol = document.createElement('div');
  timeCol.className = 'wc-time-col';
  timeCol.style.cssText = `position:relative;height:${totalHeight}px;border-right:1px solid #dadce0;`;
  for (let h = minH; h < maxH; h++) {
    const lbl = document.createElement('div');
    lbl.className = 'wc-time-label';
    lbl.style.cssText = `position:absolute;top:${(h - minH) * rowHeight}px;width:100%;height:${rowHeight}px;box-sizing:border-box;border-bottom:1px solid #ebebeb;`;
    const sp = document.createElement('span');
    sp.textContent = `${String(h).padStart(2, '0')}:00`;
    lbl.appendChild(sp);
    timeCol.appendChild(lbl);
  }
  container.appendChild(timeCol);

  // Group events by day
  const eventosPorDia = {};
  tresDias.forEach(d => eventosPorDia[d] = []);
  horarios.forEach(item => {
    if (eventosPorDia[item.dia]) eventosPorDia[item.dia].push(item);
  });

  // Day columns
  tresDias.forEach((dia, colIdx) => {
    const dayCol = document.createElement('div');
    dayCol.className = 'wc-day-column';
    if (dia === hojeNome) dayCol.classList.add('wc-day-today');
    dayCol.style.cssText = `position:relative;height:${totalHeight}px;border-right:${colIdx < 2 ? '1px solid #ebebeb' : 'none'};`;

    for (let h = minH; h < maxH; h++) {
      const line = document.createElement('div');
      line.style.cssText = `position:absolute;top:${(h - minH) * rowHeight}px;left:0;right:0;height:${rowHeight}px;border-bottom:1px solid #ebebeb;box-sizing:border-box;`;
      dayCol.appendChild(line);
    }

    eventosPorDia[dia].forEach(({ disciplina, turma, horário }) => {
      const [ini, fim] = horário.split('-');
      const startH = parseHora(ini);
      const endH = parseHora(fim);
      const topPx = (startH - minH) * rowHeight;
      const heightPx = (endH - startH) * rowHeight;

      const ev = document.createElement('div');
      ev.className = 'wc-event';
      ev.style.top = topPx + 'px';
      ev.style.height = Math.max(heightPx - 2, 18) + 'px';
      ev.style.backgroundColor = getDisciplinaColor(disciplina);

      const titleDiv = document.createElement('div');
      titleDiv.className = 'wc-event-title';
      titleDiv.textContent = disciplina;
      ev.appendChild(titleDiv);

      if (heightPx >= 36) {
        const timeDiv = document.createElement('div');
        timeDiv.className = 'wc-event-time';
        timeDiv.textContent = horário;
        ev.appendChild(timeDiv);
      }
      if (heightPx >= 50) {
        const roomDiv = document.createElement('div');
        roomDiv.className = 'wc-event-room';
        roomDiv.textContent = turma;
        ev.appendChild(roomDiv);
      }

      dayCol.appendChild(ev);
    });

    container.appendChild(dayCol);
  });
}

// Toggle between list, 3-day, and weekly view
function initViewToggle() {
  const btns = document.querySelectorAll('.view-toggle-btn');
  const listaContainer = document.getElementById('tabela-horarios-container');
  const weeklyContainer = document.getElementById('weekly-view-container');
  const threeDayContainer = document.getElementById('three-day-view-container');

  function ativarView(view, renderData) {
    btns.forEach(b => b.classList.remove('active'));
    const target = document.querySelector(`.view-toggle-btn[data-view="${view}"]`);
    if (target) target.classList.add('active');
    listaContainer.style.display = 'none';
    weeklyContainer.style.display = 'none';
    threeDayContainer.style.display = 'none';
    if (view === 'semanal') {
      weeklyContainer.style.display = '';
      if (renderData) preencherVisualizacaoSemanal(horariosGlobais);
    } else if (view === '3dias') {
      threeDayContainer.style.display = '';
      if (renderData) preencherVisualizacao3Dias(horariosGlobais);
    } else {
      listaContainer.style.display = '';
    }
    localStorage.setItem('sigaa-horarios-view', view);
  }

  btns.forEach(btn => {
    btn.addEventListener('click', () => ativarView(btn.dataset.view, true));
  });

  // Restaura a última visualização salva (sem renderizar — dados ainda não chegaram)
  const saved = localStorage.getItem('sigaa-horarios-view');
  if (saved && saved !== 'lista') {
    ativarView(saved, false);
  }
}

// Atualiza a visualização de calendário ativa (chamado após dados carregarem)
function atualizarViewAtiva() {
  const saved = localStorage.getItem('sigaa-horarios-view');
  if (saved === 'semanal') {
    preencherVisualizacaoSemanal(horariosGlobais);
  } else if (saved === '3dias') {
    preencherVisualizacao3Dias(horariosGlobais);
  }
}

// ===== Swipe para trocar de tab no mobile =====
function initSwipeTabs() {
  const body = document.body;
  let startX = 0, startY = 0;
  let tracking = false;
  let dragging = false;
  let locked = false; // locked to vertical scroll — ignore horizontal
  let scrollableEl = null;
  let scrolledHorizontally = false;
  let initialScrollLeft = 0;

  let currentTab = null;
  let peekTab = null;
  let peekDirection = 0; // -1 = next (swipe left), +1 = prev (swipe right)
  const THRESHOLD = 0.3; // 30% of screen width to commit
  const DEAD_ZONE = 10; // px before deciding direction

  function getVisibleTabs() {
    return Array.from(document.querySelectorAll('.tab-button'))
      .filter(b => b.style.display !== 'none' && b.offsetParent !== null);
  }

  function getCurrentTabIdx(tabs) {
    return tabs.findIndex(b => b.classList.contains('active'));
  }

  function findScrollableParent(el) {
    while (el && el !== body) {
      const style = window.getComputedStyle(el);
      const ox = style.overflowX;
      if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  function clearPeekStyles(el) {
    el.style.transform = '';
    el.style.position = '';
    el.style.top = '';
    el.style.left = '';
    el.style.width = '';
    el.style.height = '';
    el.style.zIndex = '';
    el.style.background = '';
    el.style.overflowY = '';
    el.style.padding = '';
    el.style.boxSizing = '';
  }

  function cleanup() {
    if (currentTab) {
      currentTab.classList.remove('swipe-dragging', 'swipe-snap');
      currentTab.style.transform = '';
    }
    if (peekTab) {
      peekTab.classList.remove('swipe-peek', 'swipe-snap');
      clearPeekStyles(peekTab);
    }
    currentTab = null;
    peekTab = null;
    peekDirection = 0;
    dragging = false;
    tracking = false;
    locked = false;
  }

  body.addEventListener('touchstart', (e) => {
    if (window.innerWidth >= 1040) return;
    cleanup();
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    tracking = true;
    locked = false;
    scrolledHorizontally = false;
    scrollableEl = findScrollableParent(e.target);
    initialScrollLeft = scrollableEl ? scrollableEl.scrollLeft : 0;
  }, { passive: true });

  body.addEventListener('touchmove', (e) => {
    if (!tracking) return;

    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    // Detect real horizontal scroll happening in a scrollable container
    if (scrollableEl && !scrolledHorizontally && Math.abs(scrollableEl.scrollLeft - initialScrollLeft) > 2) {
      scrolledHorizontally = true;
      if (dragging) {
        // Already started dragging tabs — cancel it
        cleanup();
      } else {
        tracking = false;
      }
      return;
    }

    if (scrolledHorizontally) return;

    // Dead zone: determine if this is horizontal or vertical gesture
    if (!dragging && !locked) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > DEAD_ZONE) {
        locked = true; // vertical scroll, ignore
        return;
      }
      if (Math.abs(dx) < DEAD_ZONE) return;
    }

    if (locked) return;

    // Start dragging
    if (!dragging) {
      const tabs = getVisibleTabs();
      if (!tabs.length) return;
      const idx = getCurrentTabIdx(tabs);
      if (idx === -1) return;

      const dir = dx < 0 ? -1 : 1; // -1 = swipe left (next), +1 = swipe right (prev)
      const peekIdx = dir === -1 ? idx + 1 : idx - 1;
      if (peekIdx < 0 || peekIdx >= tabs.length) {
        tracking = false;
        return;
      }

      peekDirection = dir;
      currentTab = document.querySelector('.tab-content.active');
      const peekTabId = tabs[peekIdx].getAttribute('data-tab');
      peekTab = document.getElementById(peekTabId);

      if (!currentTab || !peekTab) {
        tracking = false;
        return;
      }

      currentTab.classList.add('swipe-dragging');
      peekTab.classList.add('swipe-peek');
      // Position peek tab to cover the full viewport below the header
      const header = document.querySelector('.page-header');
      const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
      peekTab.style.position = 'fixed';
      peekTab.style.top = `${headerBottom}px`;
      peekTab.style.left = '0';
      peekTab.style.width = '100vw';
      peekTab.style.height = `calc(100vh - ${headerBottom}px)`;
      peekTab.style.zIndex = '150';
      peekTab.style.background = '#f0f2f5';
      peekTab.style.overflowY = 'auto';
      peekTab.style.padding = '20px';
      peekTab.style.boxSizing = 'border-box';
      // Position peek tab off-screen on the correct side
      const W = window.innerWidth;
      peekTab.style.transform = `translateX(${dir === -1 ? W : -W}px)`;
      dragging = true;
    }

    // Move both tabs following the finger
    const W = window.innerWidth;
    // Clamp dx so user can't drag beyond the peek tab
    let clampedDx = peekDirection === -1
      ? Math.min(0, Math.max(-W, dx))
      : Math.max(0, Math.min(W, dx));

    currentTab.style.transform = `translateX(${clampedDx}px)`;
    // Peek tab follows: starts at ±W and ends at 0
    peekTab.style.transform = `translateX(${(peekDirection === -1 ? W : -W) + clampedDx}px)`;
  }, { passive: true });

  body.addEventListener('touchend', (e) => {
    if (!dragging) {
      cleanup();
      return;
    }

    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const W = window.innerWidth;
    const ratio = Math.abs(dx) / W;

    if (ratio >= THRESHOLD) {
      // Commit: snap to completion
      const targetCurrent = peekDirection === -1 ? -W : W;
      currentTab.classList.add('swipe-snap');
      peekTab.classList.add('swipe-snap');
      currentTab.style.transform = `translateX(${targetCurrent}px)`;
      peekTab.style.transform = 'translateX(0)';

      const oldTab = currentTab;
      const newTab = peekTab;
      const newTabId = newTab.id;

      let doneHandled = false;
      const onDone = () => {
        if (doneHandled) return;
        doneHandled = true;
        oldTab.classList.remove('active', 'swipe-dragging', 'swipe-snap');
        oldTab.style.transform = '';
        newTab.classList.remove('swipe-peek', 'swipe-snap');
        clearPeekStyles(newTab);
        newTab.classList.add('active');

        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        const btn = document.querySelector(`.tab-button[data-tab="${newTabId}"]`);
        if (btn) btn.classList.add('active');

        refreshHomeHeightSyncLoop();
      };

      newTab.addEventListener('transitionend', onDone, { once: true });
      // Fallback if transitionend doesn't fire
      setTimeout(onDone, 300);
    } else {
      // Cancel: snap back
      currentTab.classList.add('swipe-snap');
      peekTab.classList.add('swipe-snap');
      currentTab.style.transform = 'translateX(0)';
      const W2 = peekDirection === -1 ? W : -W;
      peekTab.style.transform = `translateX(${W2}px)`;

      const pt = peekTab;
      const ct = currentTab;
      let snapHandled = false;
      const onSnapBack = () => {
        if (snapHandled) return;
        snapHandled = true;
        ct.classList.remove('swipe-dragging', 'swipe-snap');
        ct.style.transform = '';
        pt.classList.remove('swipe-peek', 'swipe-snap');
        clearPeekStyles(pt);
      };
      pt.addEventListener('transitionend', onSnapBack, { once: true });
      setTimeout(onSnapBack, 300);
    }

    currentTab = null;
    peekTab = null;
    peekDirection = 0;
    dragging = false;
    tracking = false;
    locked = false;
  }, { passive: true });

  body.addEventListener('touchcancel', () => {
    cleanup();
  }, { passive: true });
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

// Função para preencher as tabelas de atividades (home + aba)
function preencherTabelaAtividades(atividades) {
  const tabelaHome = document.getElementById('tabela-atividades-home');
  const tabelaAba = document.getElementById('tabela-atividades-atividades');
  const vaziHome = document.getElementById('atividades-home-vazio');
  const vaziTab = document.getElementById('atividades-tab-vazio');

  [tabelaHome, tabelaAba].forEach(tabela => {
    if (!tabela) return;
    const tbody = tabela.querySelector('tbody');
    tbody.innerHTML = '';
    if (atividades.length > 0) {
      atividades.forEach(a => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${a.disciplina}</td><td>${a.data || ''}</td><td>${a.descricao || ''}</td>`;
        tbody.appendChild(tr);
      });
    }
  });

  // Aba Atividades
  const temDados = atividades.length > 0;
  if (tabelaAba) tabelaAba.style.display = temDados ? '' : 'none';
  if (vaziTab) vaziTab.style.display = (!temDados) ? '' : 'none';

  atualizarHomePainelNovidadesAtividades();
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
      novidades.forEach(n => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${n.disciplina}</td><td>${n.data}</td><td>${n.descricao}</td>`;
        tbody.appendChild(tr);
      });
    }
  });

  novidadesGlobais = novidades;

  const temNovidades = novidades.length > 0;
  if (tabelaNovidades) tabelaNovidades.style.display = temNovidades ? '' : 'none';

  atualizarHomePainelNovidadesAtividades();

  // Ajusta a altura do container de novidades agora que conteúdos mudaram
  setTimeout(ajustarAlturaNovidades, 30);
}

function atualizarHomePainelNovidadesAtividades() {
  const isDesktop = window.innerWidth >= 1040;

  const toggle = document.querySelector('.novidades-toggle');
  const btnAtiv = document.querySelector('.novidades-toggle-btn[data-view="atividades"]');
  const panelNov = document.getElementById('tabela-novidades-container');
  const panelAtiv = document.getElementById('tabela-atividades-container');
  const tblNov = document.getElementById('tabela-novidades-home');
  const tblAtiv = document.getElementById('tabela-atividades-home');
  const vazioNov = document.getElementById('novidades-home-vazio');
  const vazioAtiv = document.getElementById('atividades-home-vazio');

  if (!tblNov || !tblAtiv || !panelNov || !panelAtiv) return;

  const temNovidades = novidadesGlobais.length > 0;
  const temAtividades = atividadesGlobais.length > 0;

  if (toggle) toggle.style.display = isDesktop ? 'none' : 'inline-flex';

  if (isDesktop) {
    panelNov.style.display = '';
    panelAtiv.style.display = '';

    tblNov.style.display = temNovidades ? '' : 'none';
    tblAtiv.style.display = temAtividades ? '' : 'none';

    if (vazioNov) vazioNov.style.display = temNovidades ? 'none' : '';
    if (vazioAtiv) vazioAtiv.style.display = temAtividades ? 'none' : '';
    return;
  }

  // Mobile: mantém o toggle alternando entre os dois painéis.
  const view = (btnAtiv && btnAtiv.classList.contains('active')) ? 'atividades' : 'novidades';

  if (view === 'novidades') {
    panelNov.style.display = '';
    panelAtiv.style.display = 'none';
    tblNov.style.display = temNovidades ? '' : 'none';
    if (vazioNov) vazioNov.style.display = temNovidades ? 'none' : '';
  } else {
    panelNov.style.display = 'none';
    panelAtiv.style.display = '';
    tblAtiv.style.display = temAtividades ? '' : 'none';
    if (vazioAtiv) vazioAtiv.style.display = temAtividades ? 'none' : '';
  }
}

// Toggle Novidades / Atividades no container home
document.addEventListener('click', function(e) {
  const btn = e.target.closest('.novidades-toggle-btn');
  if (!btn) return;

  // Atualiza estado ativo dos botões do toggle
  document.querySelectorAll('.novidades-toggle-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  atualizarHomePainelNovidadesAtividades();
});

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
    refreshHomeHeightSyncLoop();
  });
});

// Ativa uma aba pelo id (mesmo que o botão esteja escondido)
function activateTab(tabId) {
  try {
    // Remove estado ativo de botões e conteúdos
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(tab => {
      tab.classList.remove('active', 'swipe-dragging', 'swipe-peek', 'swipe-snap');
      tab.style.transform = '';
    });

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
    refreshHomeHeightSyncLoop();
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
  // Deixa o CSS responsivo decidir (grid no desktop, oculto no mobile)
  document.getElementById('home-listas-container').style.display = '';
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

  // Mostra a barra de tabs e o FAB novamente (respeitando estado minimizado)
  const tabsBar = document.querySelector('.tabs');
  if (tabsBar) tabsBar.style.display = '';
  const fab = document.getElementById('mobile-fab');
  const fabMinimized = document.getElementById('fab-minimized');
  if (fab) {
    const fabMinimizedState = localStorage.getItem('sigaa-fab-minimized');
    if (fabMinimizedState === 'true') {
      fab.classList.add('minimized');
      fab.style.display = 'none';
      if (fabMinimized) fabMinimized.classList.add('visible');
    } else {
      fab.classList.remove('minimized');
      fab.style.display = '';
      if (fabMinimized) fabMinimized.classList.remove('visible');
    }
  }
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
    document.getElementById('home-listas-container').style.display = 'none';
    document.getElementById('home-aviso').style.display = 'none';
    // Esconde a barra de tabs inteira e o FAB
    const tabsBar = document.querySelector('.tabs');
    if (tabsBar) tabsBar.style.display = 'none';
    const fab = document.getElementById('mobile-fab');
    if (fab) fab.style.display = 'none';
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
      horariosGlobais = data.horariosSimplificados || [];
      preencherTabelaSimplificada(data.horariosSimplificados || []);
      atualizarViewAtiva();
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
      } else {
        preencherTabelaNovidades([]);
        frequenciasGlobais = [];
        notasGlobais = [];
      }

      //document.getElementById('tabela-horarios').style.display = '';
      document.getElementById('tabela-horarios-detalhados').style.display = '';
      atividadesGlobais = extrairAtividades(data);
      preencherTabelaAtividades(atividadesGlobais);
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

  let html = '<h2>Dados Institucionais do Usuário</h2><ul>';

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
  setTimeout(ajustarDadosMaxHeight, 50);

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

// Calcula quantas linhas extras cabem no espaço disponível na tela e mostra apenas essas
// No mobile (<=1040px) esta funcionalidade é desativada — todas as extras ficam ocultas
let _dadosRafPending = false;
function ajustarDadosMaxHeight() {
  try {
    const dados = document.getElementById('dados-institucionais');
    if (!dados) return;
    const extraInfo = dados.querySelector('.extra-info');
    if (!extraInfo) return;
    const extraLis = extraInfo.querySelectorAll('li');
    if (!extraLis.length) return;

    // No mobile não ajusta — mantém extras ocultas
    if (window.innerWidth < 1040) {
      extraLis.forEach(li => li.classList.remove('visible-fit'));
      return;
    }

    // Espaço disponível: do fundo do último li principal até o fim da viewport
    const dadosRect = dados.getBoundingClientRect();
    const ul = dados.querySelector('ul');
    const mainLis = ul ? ul.querySelectorAll(':scope > li') : [];
    let bottomOfMain = dadosRect.top;
    if (mainLis.length) {
      const lastMain = mainLis[mainLis.length - 1];
      bottomOfMain = lastMain.getBoundingClientRect().bottom;
    }

    const viewportBottom = window.innerHeight;
    let spaceLeft = viewportBottom - bottomOfMain - 5;

    // Mostra temporariamente cada li extra para medir sua altura
    extraLis.forEach(li => li.classList.remove('visible-fit'));
    for (const li of extraLis) {
      li.classList.add('visible-fit');
      const liHeight = li.getBoundingClientRect().height;
      spaceLeft -= liHeight;
      if (spaceLeft < 0) {
        li.classList.remove('visible-fit');
        break;
      }
    }
  } catch (e) { /* ignore */ }
}

function agendarAjusteDados() {
  if (_dadosRafPending) return;
  _dadosRafPending = true;
  requestAnimationFrame(() => {
    _dadosRafPending = false;
    ajustarDadosMaxHeight();
  });
}

window.addEventListener('resize', agendarAjusteDados);
window.addEventListener('scroll', agendarAjusteDados, { passive: true });

function ajustarAlturaNovidades() {
  try {
    const form = document.getElementById('sigaa-form');
    const dados = document.getElementById('dados-institucionais');
    const novidadesContainer = document.getElementById('tabela-novidades-container');
    const atividadesContainer = document.getElementById('tabela-atividades-container');
    if (!form || !dados || !novidadesContainer || !atividadesContainer) return;

    if (window.innerWidth < 1040) {
      novidadesContainer.style.maxHeight = '';
      atividadesContainer.style.maxHeight = '';
      novidadesContainer.style.overflow = '';
      atividadesContainer.style.overflow = '';
      return;
    }

    // Soma real do bloco esquerdo: topo externo do formulário até base externa dos dados.
    const formRect = form.getBoundingClientRect();
    const dadosRect = dados.getBoundingClientRect();
    const formStyle = window.getComputedStyle(form);
    const dadosStyle = window.getComputedStyle(dados);

    const formMarginTop = parseFloat(formStyle.marginTop || '0') || 0;
    const dadosMarginBottom = parseFloat(dadosStyle.marginBottom || '0') || 0;
    const top = formRect.top - formMarginTop;
    const bottom = dadosRect.bottom + dadosMarginBottom;
    const x = Math.max(120, Math.round(bottom - top));

    novidadesContainer.style.maxHeight = x + 'px';
    atividadesContainer.style.maxHeight = x + 'px';
    novidadesContainer.style.overflow = 'auto';
    atividadesContainer.style.overflow = 'auto';
  } catch (e) {
    console.warn('Erro ao ajustar altura de novidades:', e);
  }
}

// Ajusta ao redimensionar a janela
window.addEventListener('resize', () => {
  atualizarHomePainelNovidadesAtividades();
  ajustarAlturaNovidades();
  ajustarTabsMobileOcultar();
  refreshHomeHeightSyncLoop();
});

document.addEventListener('visibilitychange', refreshHomeHeightSyncLoop);
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(refreshHomeHeightSyncLoop, 120);
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
  // Menu rápido do desktop (separado do FAB mobile)
  const desktopToggle = document.getElementById('desktop-actions-toggle');
  const desktopMenu = document.getElementById('desktop-actions-menu');

  if (desktopToggle && desktopMenu) {
    function closeDesktopMenu() {
      desktopMenu.classList.remove('open');
      desktopMenu.setAttribute('aria-hidden', 'true');
    }

    function openDesktopMenu() {
      desktopMenu.classList.add('open');
      desktopMenu.setAttribute('aria-hidden', 'false');
    }

    desktopToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (desktopMenu.classList.contains('open')) closeDesktopMenu(); else openDesktopMenu();
    });

    desktopMenu.addEventListener('click', (e) => {
      const btn = e.target.closest('.desktop-action-item');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'abrir-horarios-completos') {
        activateTab('tab-horarios');
      } else if (action === 'abrir-novidades') {
        activateTab('tab-novidades');
      } else if (action === 'abrir-atividades') {
        activateTab('tab-atividades');
      }
      closeDesktopMenu();
    });

    document.addEventListener('click', (e) => {
      if (!desktopMenu.contains(e.target) && !desktopToggle.contains(e.target)) closeDesktopMenu();
    });
  }

  const fabToggle = document.getElementById('mobile-fab-toggle');
  const fabMenu = document.getElementById('mobile-fab-menu');
  const fab = document.getElementById('mobile-fab');
  const fabMinimizeBtn = document.getElementById('fab-minimize-btn');
  const fabExpandBtn = document.getElementById('fab-expand-btn');
  const fabMinimized = document.getElementById('fab-minimized');
  if (!fabToggle || !fabMenu || !fab) return; // nada a fazer

  // Rastreia se o FAB foi minimizado ao carregar
  const fabMinimizedState = localStorage.getItem('sigaa-fab-minimized');
  let fabWasInitiallyMinimized = fabMinimizedState === 'true';
  
  function updateExpandButtonVisibility() {
    if (fabExpandBtn) {
      fabExpandBtn.style.display = fabWasInitiallyMinimized ? 'block' : 'none';
    }
  }
  
  if (fabWasInitiallyMinimized) {
    fab.classList.add('minimized');
    fab.style.display = 'none';
    fabMinimized.classList.add('visible');
  } else {
    fab.classList.remove('minimized');
    fab.style.display = 'block';
    fabMinimized.classList.remove('visible');
  }
  
  updateExpandButtonVisibility();

  function closeFab() {
    fabMenu.classList.remove('open');
    fab.setAttribute('aria-hidden', 'true');
    fabMenu.setAttribute('aria-hidden', 'true');
    
    // Se foi originalmente minimizado, volta ao minimizado ao clicar fora
    if (fabWasInitiallyMinimized) {
      fab.classList.add('minimized');
      setTimeout(() => {
        fab.style.display = 'none';
      }, 300);
      fabMinimized.classList.add('visible');
    }
  }
  
  function openFab() {
    fabMenu.classList.add('open');
    fab.setAttribute('aria-hidden', 'false');
    fabMenu.setAttribute('aria-hidden', 'false');
  }

  function minimizeFab() {
    fab.classList.add('minimized');
    // Espera a animação terminar antes de mudar display
    setTimeout(() => {
      fab.style.display = 'none';
    }, 300);
    fabMinimized.classList.add('visible');
    localStorage.setItem('sigaa-fab-minimized', 'true');
    fabWasInitiallyMinimized = true; // Atualiza o rastreamento
    updateExpandButtonVisibility();
    closeFab();
  }

  function expandFab() {
    fab.style.display = 'block';
    // Força reflow para a animação funcionar
    fab.offsetHeight;
    fab.classList.remove('minimized');
    fabMinimized.classList.remove('visible');
    localStorage.setItem('sigaa-fab-minimized', 'false');
    fabWasInitiallyMinimized = false; // Atualiza o rastreamento
    updateExpandButtonVisibility();
  }

  // Expande temporariamente (apenas para visualizar menu)
  function expandFabTemporarily() {
    fab.style.display = 'block';
    fab.offsetHeight;
    fab.classList.remove('minimized');
    fabMinimized.classList.remove('visible'); // Oculta a barrinha
    // NÃO salva no localStorage - apenas mostra visualmente
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
      closeFab();
    } else if (action === 'abrir-novidades') {
      // ativa diretamente a aba de novidades
      activateTab('tab-novidades');
      closeFab();
    } else if (action === 'abrir-atividades') {
      // ativa diretamente a aba de atividades
      activateTab('tab-atividades');
      closeFab();
    }
  });

  // Botão de minimizar
  if (fabMinimizeBtn) {
    fabMinimizeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      minimizeFab();
    });
  }
  
  // Botão de expandir (fixar)
  if (fabExpandBtn) {
    fabExpandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      expandFab();
      closeFab();
    });
  }

  // Barrinha minimizada - clique para expandir
  if (fabMinimized) {
    fabMinimized.addEventListener('click', (e) => {
      e.stopPropagation();
      expandFabTemporarily(); // Expande temporariamente
      openFab();
    });
  }

  // Fecha se clicar fora
  document.addEventListener('click', (e) => {
    if (!fab.contains(e.target)) closeFab();
  });

  // Fecha em resize para evitar menus abertos em desktop
  window.addEventListener('resize', () => closeFab());
});

let notasGlobais = [];
let horariosGlobais = [];

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

// ── Exibição de fila de espera ────────────────────────────────────────────
function updateQueueDisplay(position, avgTimeMs) {
    let el = document.getElementById('queue-status-display');
    if (!el) {
        el = document.createElement('div');
        el.id = 'queue-status-display';
        el.style.cssText = 'margin-top:10px;padding:12px 16px;background:#fff8e1;border:1px solid #ffe082;border-radius:8px;font-size:0.95em;color:#795548;display:flex;align-items:center;gap:10px;';
        const form = document.getElementById('sigaa-form');
        if (form) form.appendChild(el);
    }
    el.style.display = 'flex';

    const avgSec = Math.round((avgTimeMs || 60000) / 1000);

    if (position === -1) {
        el.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="#ffa000" viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
            <span><b>Conectando à fila...</b></span>`;
    } else if (position <= 1) {
        el.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="#4caf50" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
            <span><b>Sua consulta está sendo processada agora...</b> <span style="color:#999">~${avgSec}s por consulta</span></span>`;
    } else {
        const waitSec = avgSec * position;
        const waitMin = Math.floor(waitSec / 60);
        const waitRemSec = waitSec % 60;
        const tempoStr = waitMin > 0 ? `~${waitMin}min ${waitRemSec}s` : `~${waitSec}s`;

        el.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="#ffa000" viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
            <span>
                <b>Posição na fila: ${position}º</b><br>
                <span style="font-size:0.88em;color:#999">Tempo estimado de espera: ${tempoStr}</span>
            </span>`;
    }
}

function hideQueueDisplay() {
    const el = document.getElementById('queue-status-display');
    if (el) el.style.display = 'none';
}
// ── Fim fila de espera ───────────────────────────────────────────────────

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
    const form = document.getElementById('sigaa-form');
    el = document.createElement('div');
    el.id = 'token-status';
    el.className = 'token-status';
    if (form) {
      form.appendChild(el);
    } else {
      document.body.appendChild(el);
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
  // Mantido por compatibilidade com gatilhos existentes.
  ajustarAlturaNovidades();
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
