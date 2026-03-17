// Importa a função de exportação do boletim
// <script src="boletim.js"></script> deve estar incluído no index.html antes de script.js para garantir que a função esteja disponível

// URL base da API — em desenvolvimento local o server.js injeta window.API_BASE_URL via index.html
const API_BASE = window.API_BASE_URL || 'https://ak4ai-sigaa.duckdns.org';
const STORAGE_LAST_CONSULTA = 'sigaaUltimaConsulta';
const STORAGE_SAVED_PROFILES = 'sigaaPerfisSalvos';
const STORAGE_SELECTED_PROFILE = 'sigaaPerfilSelecionado';
const STORAGE_COMPARISON_MODE = 'sigaaComparisonMode';
const MAX_SAVED_PROFILES = 2;

function isComparisonModeEnabled() {
  return localStorage.getItem(STORAGE_COMPARISON_MODE) === '1';
}

function setComparisonModeEnabled(enabled) {
  localStorage.setItem(STORAGE_COMPARISON_MODE, enabled ? '1' : '0');
}

function getComparisonProfilesContext() {
  const profiles = getSavedProfiles();
  const selectedUser = getSelectedProfileUser() || (profiles[0]?.user || '');
  const compareProfile = profiles.find(profile => profile.user !== selectedUser) || null;
  const compareHorarios = compareProfile?.data?.horariosSimplificados || [];
  const canCompare = profiles.length >= 2;
  const enabled = canCompare && isComparisonModeEnabled() && compareHorarios.length > 0;

  return {
    enabled,
    canCompare,
    mainUser: selectedUser,
    compareUser: compareProfile?.user || '',
    compareHorarios
  };
}

function updateComparisonToggleState() {
  const toggle = document.getElementById('comparison-mode-toggle');
  if (!toggle) return;

  const ctx = getComparisonProfilesContext();
  if (!ctx.canCompare) {
    toggle.checked = false;
    toggle.disabled = true;
    toggle.title = 'Salve 2 perfis para ativar a comparação';
    setComparisonModeEnabled(false);
    return;
  }

  toggle.disabled = false;
  toggle.checked = isComparisonModeEnabled();
  toggle.title = '';
}

function initComparisonModeToggle() {
  const toggle = document.getElementById('comparison-mode-toggle');
  if (!toggle || toggle.dataset.bound === '1') return;

  toggle.dataset.bound = '1';
  toggle.addEventListener('change', () => {
    setComparisonModeEnabled(toggle.checked);
    preencherTabelaSimplificada(horariosGlobais || []);
    atualizarViewAtiva();
  });

  updateComparisonToggleState();
}

function getSavedProfiles() {
  const raw = localStorage.getItem(STORAGE_SAVED_PROFILES);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => item && typeof item.user === 'string' && item.user.trim() && item.data)
      .map(item => ({
        user: item.user.trim(),
        data: item.data,
        updatedAt: Number(item.updatedAt) || Date.now()
      }));
  } catch (e) {
    console.warn('Falha ao ler perfis salvos:', e);
    return [];
  }
}

function setSavedProfiles(profiles) {
  localStorage.setItem(STORAGE_SAVED_PROFILES, JSON.stringify(profiles.slice(0, MAX_SAVED_PROFILES)));
}

function getSelectedProfileUser() {
  const selected = localStorage.getItem(STORAGE_SELECTED_PROFILE);
  return selected ? selected.trim() : '';
}

function setSelectedProfileUser(user) {
  if (!user) {
    localStorage.removeItem(STORAGE_SELECTED_PROFILE);
    return;
  }
  localStorage.setItem(STORAGE_SELECTED_PROFILE, user);
}

function saveConsultaForUser(user, data) {
  const normalizedUser = (user || '').trim();
  localStorage.setItem(STORAGE_LAST_CONSULTA, JSON.stringify(data));
  if (!normalizedUser) return;

  const currentProfiles = getSavedProfiles().filter(item => item.user !== normalizedUser);
  currentProfiles.unshift({
    user: normalizedUser,
    data,
    updatedAt: Date.now()
  });

  setSavedProfiles(currentProfiles);
  setSelectedProfileUser(normalizedUser);
  atualizarSelectPerfisSalvos();
}

function getProfileByUser(user) {
  const normalizedUser = (user || '').trim();
  if (!normalizedUser) return null;
  return getSavedProfiles().find(profile => profile.user === normalizedUser) || null;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeTextForMatch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function extractSiglaFromCodigoPrefix(disciplina) {
  const text = String(disciplina || '').trim();
  // Ex.: G05FOFT0.01 - FUNDAMENTOS ...  => FOFT
  const match = text.match(/^[A-Z]\d{2}([A-Z]{2,6})\d(?:\.\d+)?\s*-/i);
  return match ? match[1].toUpperCase() : '';
}

function buildSiglaFromWords(text) {
  const stopWords = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'COM', 'EM', 'PARA']);
  const tokens = normalizeTextForMatch(text)
    .replace(/^[A-Z]\d{2}[A-Z]{2,6}\d(?:\.\d+)?\s*-\s*/i, '')
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(token => !stopWords.has(token));

  if (tokens.length === 0) return '';
  if (tokens.length === 1) return tokens[0].slice(0, 4);
  return tokens.slice(0, 4).map(token => token[0]).join('');
}

function generateDisciplinaSigla(disciplina) {
  const raw = String(disciplina || '').trim();
  if (!raw || raw === '-') return '-';

  const normalized = normalizeTextForMatch(raw)
    .replace(/^[A-Z]\d{2}[A-Z]{2,6}\d(?:\.\d+)?\s*-\s*/i, '')
    .trim();

  // Se já vier sigla entre parênteses no final, prioriza ela (ex.: ... (OFT))
  const parenthesisSigla = raw.match(/\(([A-Z]{2,10})\)\s*$/i);
  if (parenthesisSigla) {
    return parenthesisSigla[1].toUpperCase();
  }

  const directMap = {
    'EQUACAO DIFERENCIAL ORDINARIA': 'EDO',
    'CALCULO COM FUNCOES DE VARIAS VARIAVEIS II': 'CFVV II',
    'MECANICA DOS SOLIDOS II': 'MEC SOL',
    'PESQUISA OPERACIONAL': 'PO'
  };
  if (directMap[normalized]) {
    return directMap[normalized];
  }

  // LABORATORIO DE ... => LAB - <sigla base>
  if (normalized.startsWith('LABORATORIO')) {
    const baseName = normalized.replace(/^LABORATORIO\s*(DE\s*)?/, '').trim();
    const codeSigla = extractSiglaFromCodigoPrefix(raw);
    const baseSigla = codeSigla || buildSiglaFromWords(baseName) || 'LAB';
    return `LAB - ${baseSigla}`;
  }

  // Disciplinas de mecânica sem regra específica
  if (normalized.includes('MECANICA')) {
    return 'MEC';
  }

  // Base principal: sigla do código da disciplina
  const codeSigla = extractSiglaFromCodigoPrefix(raw);
  if (codeSigla) {
    return codeSigla;
  }

  // Fallback: gera pelas palavras do nome
  return buildSiglaFromWords(normalized) || raw;
}

function getDisciplinaLabelForComparisonMobile(disciplina) {
  if (!window.matchMedia('(max-width: 1040px)').matches) {
    return disciplina || '-';
  }
  return generateDisciplinaSigla(disciplina);
}

function openDisciplinaInfoModal(info) {
  document.getElementById('disciplina-info-modal')?.remove();

  const perfil = escapeHtml(info?.perfil || '-');
  const disciplina = escapeHtml(info?.disciplina || '-');
  const turma = escapeHtml(info?.turma || '-');
  const periodo = escapeHtml(info?.periodo || '-');
  const horario = escapeHtml(info?.horario || '-');
  const dia = escapeHtml(info?.dia || '-');
  const sala = escapeHtml(info?.sala || '-');

  const modal = document.createElement('div');
  modal.id = 'disciplina-info-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:560px;width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.25)">
      <div style="padding:20px 24px 12px;border-bottom:1px solid #e0e0e0;display:flex;justify-content:space-between;align-items:center">
        <strong style="font-size:16px">Detalhes da Disciplina</strong>
        <button aria-label="Fechar" style="background:none;border:none;font-size:22px;cursor:pointer;color:#555;padding:0 4px">&times;</button>
      </div>
      <div style="padding:16px 24px 22px">
        <div style="display:inline-block;background:#e8f0fe;color:#1a73e8;border:1px solid #d2e3fc;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:600;margin-bottom:12px">${perfil}</div>
        <h4 style="margin:0 0 14px;font-size:16px;line-height:1.35;color:#1f1f1f">${disciplina}</h4>
        <div style="display:grid;grid-template-columns:120px 1fr;gap:8px 10px;font-size:14px;color:#2b2b2b">
          <div style="color:#666">Turma</div><div><strong>${turma}</strong></div>
          <div style="color:#666">Dia</div><div><strong>${dia}</strong></div>
          <div style="color:#666">Período</div><div><strong>${periodo}</strong></div>
          <div style="color:#666">Horário</div><div><strong>${horario}</strong></div>
          <div style="color:#666">Sala</div><div><strong>${sala}</strong></div>
        </div>
      </div>
    </div>`;

  const closeBtn = modal.querySelector('button');
  closeBtn?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
  document.body.appendChild(modal);
}

function getFirstNameFromDadosInstitucionais(dados, fallback = '') {
  if (!dados || typeof dados !== 'object') {
    return (fallback || '').trim();
  }

  const prioritizedKeys = ['Nome do Usuario', 'Nome do Aluno', 'Nome'];
  let nomeCompleto = '';

  for (const key of prioritizedKeys) {
    if (dados[key]) {
      nomeCompleto = String(dados[key]).trim();
      if (nomeCompleto) break;
    }
  }

  if (!nomeCompleto) {
    const dynamicKey = Object.keys(dados).find((key) => key.toLowerCase().includes('nome'));
    if (dynamicKey) {
      nomeCompleto = String(dados[dynamicKey] || '').trim();
    }
  }

  if (!nomeCompleto) {
    return (fallback || '').trim();
  }

  return nomeCompleto.split(/\s+/)[0] || (fallback || '').trim();
}

function getFirstNameFromUser(user) {
  const profile = getProfileByUser(user);
  const dados = profile?.data?.dadosInstitucionais || {};
  return getFirstNameFromDadosInstitucionais(dados, (user || '').trim() || 'Perfil');
}

function obterConsultaInicialSalva() {
  const profiles = getSavedProfiles();
  if (profiles.length > 0) {
    const selectedUser = getSelectedProfileUser();
    const selectedProfile = profiles.find(profile => profile.user === selectedUser) || profiles[0];
    setSelectedProfileUser(selectedProfile.user);
    localStorage.setItem(STORAGE_LAST_CONSULTA, JSON.stringify(selectedProfile.data));
    return selectedProfile.data;
  }

  const dadosLegados = localStorage.getItem(STORAGE_LAST_CONSULTA);
  if (!dadosLegados) return null;
  try {
    return JSON.parse(dadosLegados);
  } catch (e) {
    console.warn('Erro ao ler consulta salva:', e);
    return null;
  }
}

function getProfileSelectBindings() {
  return [
    {
      container: document.getElementById('saved-profiles-container'),
      select: document.getElementById('saved-profile-select')
    },
    {
      container: document.getElementById('desktop-saved-profiles-container'),
      select: document.getElementById('desktop-saved-profile-select')
    }
  ];
}

function atualizarSelectPerfisSalvos() {
  const profiles = getSavedProfiles();
  const bindings = getProfileSelectBindings();

  bindings.forEach(({ container, select }) => {
    if (!container || !select) return;

    select.innerHTML = '<option value="">Selecione um usuário salvo</option>';

    profiles.forEach(profile => {
      const option = document.createElement('option');
      option.value = profile.user;
      const primeiroNome = getFirstNameFromDadosInstitucionais(profile?.data?.dadosInstitucionais, profile.user);
      option.textContent = primeiroNome || profile.user;
      select.appendChild(option);
    });

    container.style.display = profiles.length > 0 ? '' : 'none';
  });

  const selectedUser = getSelectedProfileUser();
  let targetValue = '';
  if (selectedUser && profiles.some(profile => profile.user === selectedUser)) {
    targetValue = selectedUser;
  } else if (profiles.length > 0) {
    targetValue = profiles[0].user;
  }

  bindings.forEach(({ select }) => {
    if (!select) return;
    select.value = targetValue;
  });

  updateComparisonToggleState();
}

function initSelectPerfisSalvos() {
  const bindings = getProfileSelectBindings();

  bindings.forEach(({ select }) => {
    if (!select || select.dataset.bound === '1') return;

    select.dataset.bound = '1';
    select.addEventListener('change', () => {
      const selectedUser = select.value;
      if (!selectedUser) return;

      const profile = getProfileByUser(selectedUser);
      if (!profile || !profile.data) return;

      setSelectedProfileUser(selectedUser);
      localStorage.setItem(STORAGE_LAST_CONSULTA, JSON.stringify(profile.data));
      aplicarDadosConsulta(profile.data);

      const userInput = document.getElementById('user');
      if (userInput) userInput.value = selectedUser;

      bindings.forEach(({ select: otherSelect }) => {
        if (!otherSelect) return;
        otherSelect.value = selectedUser;
      });
    });
  });
}

function aplicarDadosConsulta(data, tempoResposta) {
  if (!data) return;

  removerEstiloSemDados();

  if (data.dadosInstitucionais) {
    const inst = { ...data.dadosInstitucionais };
    if (data.horariosSimplificados && data.horariosSimplificados.length > 0) {
      inst['Semestre'] = data.horariosSimplificados[0].semestre;
    }
    renderizarDadosInstitucionais(inst, data.horariosSimplificados?.[0]?.semestre, tempoResposta);
  }

  horariosGlobais = data.horariosSimplificados || [];
  preencherTabelaSimplificada(data.horariosSimplificados || []);
  startClassProgressBarUpdates(data.horariosSimplificados || []);
  atualizarViewAtiva();
  preencherTabelaDetalhada(data.horariosDetalhados || []);

  if (data.avisosPorDisciplina) {
    const novidadesFormatadas = data.avisosPorDisciplina.flatMap(({ disciplina, avisos }) =>
      avisos.map(({ data: dataAviso, descricao }) => ({ disciplina, data: dataAviso, descricao }))
    );
    preencherTabelaNovidades(novidadesFormatadas);
    frequenciasGlobais = data.avisosPorDisciplina;
    preencherSelectorFrequencias(frequenciasGlobais);
    preencherTabelaFrequencias(frequenciasGlobais, 'todas');

    notasGlobais = data.avisosPorDisciplina;
    preencherSelectorNotas(notasGlobais);
    preencherTabelaNotas(notasGlobais, 'todas');
  } else {
    preencherTabelaNovidades([]);
    frequenciasGlobais = [];
    notasGlobais = [];
  }

  atividadesGlobais = extrairAtividades(data);
  preencherTabelaAtividades(atividadesGlobais);

  document.getElementById('tabela-horarios-detalhados').style.display = '';
}

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
        await consultarComToken(token, user);
    } catch (error) {
        console.error('Erro no login:', error);
        errorDiv.textContent = error.message;
    } finally {
        loadingDiv.style.display = 'none';
    }
});

async function consultarComToken(token, userFromLogin = '') {
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

        const selectedUser = (userFromLogin || document.getElementById('user')?.value || getSelectedProfileUser() || '').trim();
        saveConsultaForUser(selectedUser, data);
        aplicarDadosConsulta(data, duracaoSegundos);

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
    consultarComToken(token, getSelectedProfileUser());
  }
  initSelectPerfisSalvos();
  atualizarSelectPerfisSalvos();
  // Ajusta o layout inicial (altura do container de novidades)
  setTimeout(ajustarAlturaNovidades, 60);
  // Ajusta visibilidade das tabs em mobile (esconde Horários/Novidades se necessário)
  setTimeout(ajustarTabsMobileOcultar, 120);
  // Inicia toggle de visualização lista/semanal
  initViewToggle();
  // Inicia switch de comparação de horários entre os 2 perfis salvos
  initComparisonModeToggle();
  // Inicia toggle de troca automática Hoje -> Amanhã
  initAutoTomorrowToggle();
  // Inicia swipe para trocar de tab no mobile
  initSwipeTabs();
});

const AUTO_TOMORROW_KEY = 'sigaa-auto-tomorrow-after-classes';

function isAutoTomorrowEnabled() {
  return localStorage.getItem(AUTO_TOMORROW_KEY) === '1';
}

function getTodayPanelTargetDay(horarios) {
  const diasSemana = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const now = new Date();
  const hojeIdx = now.getDay();
  const hojeNome = diasSemana[hojeIdx];

  if (!isAutoTomorrowEnabled()) {
    return { targetDay: hojeNome, switchedToTomorrow: false, todayName: hojeNome, tomorrowName: diasSemana[(hojeIdx + 1) % 7] };
  }

  const todayClasses = (horarios || []).filter(item => item.dia === hojeNome);
  if (todayClasses.length === 0) {
    return { targetDay: hojeNome, switchedToTomorrow: false, todayName: hojeNome, tomorrowName: diasSemana[(hojeIdx + 1) % 7] };
  }

  let latestEndHour = -1;
  todayClasses.forEach(({ horário }) => {
    const parts = String(horário || '').split('-');
    if (parts.length === 2) {
      latestEndHour = Math.max(latestEndHour, parseHora(parts[1]));
    }
  });

  const currentHour = now.getHours() + now.getMinutes() / 60;
  const shouldSwitch = latestEndHour >= 0 && currentHour >= latestEndHour;
  const tomorrowName = diasSemana[(hojeIdx + 1) % 7];

  return {
    targetDay: shouldSwitch ? tomorrowName : hojeNome,
    switchedToTomorrow: shouldSwitch,
    todayName: hojeNome,
    tomorrowName
  };
}

// ===== Barra de Progresso de Aula =====
let classProgressBarInterval = null;

function getNextClass(horarios) {
  const diasSemana = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const now = new Date();
  const hojeIdx = now.getDay();
  const hojeNome = diasSemana[hojeIdx];
  const currentHour = now.getHours() + now.getMinutes() / 60;

  const todayClasses = (horarios || []).filter(item => item.dia === hojeNome).sort((a, b) => {
    return parseHora(a.horário.split('-')[0]) - parseHora(b.horário.split('-')[0]);
  });

  for (const cls of todayClasses) {
    const [startStr] = cls.horário.split('-');
    const startHour = parseHora(startStr);
    if (startHour > currentHour) {
      return cls;
    }
  }

  return null;
}

function getCurrentClass(horarios) {
  const diasSemana = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const now = new Date();
  const hojeIdx = now.getDay();
  const hojeNome = diasSemana[hojeIdx];
  const currentHour = now.getHours() + now.getMinutes() / 60;
  const DELAY_MINUTES = 5 / 60; // 5 minutos em horas

  const todayClasses = (horarios || []).filter(item => item.dia === hojeNome).sort((a, b) => {
    return parseHora(a.horário.split('-')[0]) - parseHora(b.horário.split('-')[0]);
  });

  for (const cls of todayClasses) {
    const [startStr, endStr] = cls.horário.split('-');
    const startHour = parseHora(startStr);
    const endHour = parseHora(endStr);
    
    // Aula em progresso se: (currentHour >= startHour + 5min) E (currentHour < endHour)
    if (currentHour >= startHour + DELAY_MINUTES && currentHour < endHour) {
      return cls;
    }
  }

  return null;
}

function updateClassProgressBar(horarios) {
  const container = document.getElementById('class-progress-bar-container');
  const nextClassInfo = document.getElementById('next-class-info');
  const activeClassInfo = document.getElementById('active-class-info');
  
  if (!container || !nextClassInfo || !activeClassInfo) return;

  const currentClass = getCurrentClass(horarios);
  const nextClass = getNextClass(horarios);

  if (currentClass) {
    // Mostra aula em progresso
    nextClassInfo.style.display = 'none';
    activeClassInfo.style.display = 'block';
    
    const [startStr, endStr] = currentClass.horário.split('-');
    const startHour = parseHora(startStr);
    const endHour = parseHora(endStr);
    const now = new Date();
    const currentHour = now.getHours() + now.getMinutes() / 60;
    
    const totalDuration = endHour - startHour;
    const progressHours = Math.max(0, currentHour - startHour);
    const progressPercent = Math.min(100, (progressHours / totalDuration) * 100);
    
    // Calcula o tempo faltante em minutos e segundos
    const remainingHours = Math.max(0, endHour - currentHour);
    const remainingMinutes = Math.floor(remainingHours * 60);
    const remainingSeconds = Math.floor((remainingHours * 60 - remainingMinutes) * 60);
    
    const nameEl = document.getElementById('active-class-name');
    const timeEl = document.getElementById('active-class-time');
    const countdownEl = document.getElementById('active-class-countdown');
    const roomTextEl = document.getElementById('active-class-room-text');
    const fillEl = document.getElementById('progress-bar-fill');
    const percentEl = document.getElementById('progress-percentage');
    
    if (nameEl) nameEl.textContent = currentClass.disciplina || '-';
    if (timeEl) timeEl.textContent = `${startStr} - ${endStr}`;
    if (countdownEl) {
      const countdownStr = `${String(remainingMinutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
      countdownEl.textContent = countdownStr;
    }
    
    // Usa turma que já vem nos dados da aula
    const turma = currentClass.turma || '-';
    if (roomTextEl) {
      roomTextEl.textContent = turma;
    }
    
    if (fillEl) fillEl.style.width = `${progressPercent}%`;
    if (percentEl) percentEl.textContent = `${Math.round(progressPercent)}%`;
    
    container.style.display = 'block';
  } else if (nextClass) {
    // Mostra próxima aula
    activeClassInfo.style.display = 'none';
    nextClassInfo.style.display = 'block';
    
    const nameEl = document.getElementById('next-class-name');
    const roomEl = document.getElementById('next-class-room');
    
    if (nameEl) nameEl.textContent = nextClass.disciplina || '-';
    if (roomEl) {
      const strongEl = roomEl.querySelector('strong');
      if (strongEl) {
        strongEl.textContent = nextClass.turma || '-';
      }
    }
    
    container.style.display = 'block';
  } else {
    // Nenhuma próxima aula
    container.style.display = 'none';
  }
}

function startClassProgressBarUpdates(horarios) {
  if (classProgressBarInterval) clearInterval(classProgressBarInterval);
  
  updateClassProgressBar(horarios);
  classProgressBarInterval = setInterval(() => {
    updateClassProgressBar(horarios);
  }, 1000); // Atualiza a cada 1 segundo para contador regressivo em tempo real
}

function stopClassProgressBarUpdates() {
  if (classProgressBarInterval) {
    clearInterval(classProgressBarInterval);
    classProgressBarInterval = null;
  }
}

function initAutoTomorrowToggle() {
  const toggle = document.getElementById('auto-tomorrow-toggle');
  if (!toggle) return;

  toggle.checked = isAutoTomorrowEnabled();
  toggle.addEventListener('change', () => {
    localStorage.setItem(AUTO_TOMORROW_KEY, toggle.checked ? '1' : '0');
    if (horariosGlobais && horariosGlobais.length > 0) {
      preencherTabelaSimplificada(horariosGlobais);
      atualizarViewAtiva();
    }
  });
}

// Botão de logout/apagar informações
document.getElementById('logout-btn').addEventListener('click', () => {
  if (!confirm('Tem certeza que deseja sair?\nSeus dados salvos serão apagados.')) return;

  // 0. Para atualizações da barra de progresso
  stopClassProgressBarUpdates();

  // 1. Remove tokens do storage
  clearStoredTokenInfo();
  stopTokenTimer();

  // 2. Remove dados salvos do localStorage
  localStorage.removeItem('sigaaUltimaConsulta');
  localStorage.removeItem(STORAGE_SAVED_PROFILES);
  localStorage.removeItem(STORAGE_SELECTED_PROFILE);
  localStorage.removeItem(STORAGE_COMPARISON_MODE);
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

  atualizarSelectPerfisSalvos();
  updateComparisonToggleState();

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

  // 17. Limpa o guia interativo de horários
  if (scheduleInterval) clearInterval(scheduleInterval);
  const interactiveGuide = document.getElementById('interactive-schedule-guide');
  if (interactiveGuide) interactiveGuide.style.display = 'none';
});

// Salva os dados para filtrar depois
let frequenciasGlobais = [];
let atividadesGlobais = [];
let novidadesGlobais = [];
let scheduleInterval = null;
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

function ordenarHorarios(lista) {
  return [...(lista || [])].sort((a, b) => {
    const horaA = parseHora(String(a?.horário || '00:00-00:00').split('-')[0]);
    const horaB = parseHora(String(b?.horário || '00:00-00:00').split('-')[0]);
    return horaA - horaB;
  });
}

function getHorarioComparisonKey(item) {
  return `${item?.período || ''}|${item?.horário || ''}`;
}

function construirLinhasComparacao(mainList, compareList) {
  const orderedMain = ordenarHorarios(mainList);
  const orderedCompare = ordenarHorarios(compareList);
  const mainBuckets = {};
  const compareBuckets = {};

  orderedMain.forEach(item => {
    const key = getHorarioComparisonKey(item);
    if (!mainBuckets[key]) mainBuckets[key] = [];
    mainBuckets[key].push(item);
  });

  orderedCompare.forEach(item => {
    const key = getHorarioComparisonKey(item);
    if (!compareBuckets[key]) compareBuckets[key] = [];
    compareBuckets[key].push(item);
  });

  const orderedKeys = [];
  orderedMain.forEach(item => {
    const key = getHorarioComparisonKey(item);
    if (!orderedKeys.includes(key)) orderedKeys.push(key);
  });
  orderedCompare.forEach(item => {
    const key = getHorarioComparisonKey(item);
    if (!orderedKeys.includes(key)) orderedKeys.push(key);
  });

  return orderedKeys.flatMap(key => {
    const m = mainBuckets[key] || [];
    const c = compareBuckets[key] || [];
    const total = Math.max(m.length, c.length, 1);
    const result = [];
    for (let i = 0; i < total; i++) {
      result.push({ main: m[i] || null, compare: c[i] || null });
    }
    return result;
  });
}

function atualizarCabecalhoTabelaHorario(table, comparisonEnabled, mainUser, compareUser) {
  const thead = table?.querySelector('thead');
  if (!thead) return;

  if (!comparisonEnabled) {
    thead.innerHTML = `
      <tr>
        <th>Disciplina</th>
        <th>Turma</th>
        <th>Dia</th>
        <th>Período</th>
        <th>Horário</th>
      </tr>
    `;
    table.classList.remove('comparison-mode');
    return;
  }

  const mainName = escapeHtml(getFirstNameFromUser(mainUser));
  const compareName = escapeHtml(getFirstNameFromUser(compareUser));
  const mainUserTitle = escapeHtml(mainUser || 'Principal');
  const compareUserTitle = escapeHtml(compareUser || 'Comparação');

  thead.innerHTML = `
    <tr>
      <th colspan="2">Disciplina</th>
      <th colspan="2">Turma</th>
      <th rowspan="2">Período</th>
      <th rowspan="2">Horário</th>
    </tr>
    <tr>
      <th title="${mainUserTitle}">${mainName}</th>
      <th class="compare-col" title="${compareUserTitle}">${compareName}</th>
      <th title="${mainUserTitle}">${mainName}</th>
      <th class="compare-col" title="${compareUserTitle}">${compareName}</th>
    </tr>
  `;
  table.classList.add('comparison-mode');
}

function preencherTabelaDia(table, mainList, compareList, comparisonCtx) {
  if (!table) return;
  const tbody = table.querySelector('tbody');
  if (!tbody) return;

  const comparisonEnabled = comparisonCtx.enabled;
  atualizarCabecalhoTabelaHorario(table, comparisonEnabled, comparisonCtx.mainUser, comparisonCtx.compareUser);
  tbody.innerHTML = '';

  if (!comparisonEnabled) {
    const orderedMain = ordenarHorarios(mainList);
    orderedMain.forEach(({ disciplina, turma, dia, período, horário }) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${disciplina || ''}</td>
        <td>${turma || ''}</td>
        <td>${dia || ''}</td>
        <td>${período || ''}</td>
        <td>${horário || ''}</td>
      `;
      tbody.appendChild(tr);
    });
    table.style.display = orderedMain.length > 0 ? '' : 'none';
    return;
  }

  const rows = construirLinhasComparacao(mainList, compareList);
  rows.forEach(({ main, compare }) => {
    const periodoCompartilhado = main?.período || compare?.período || '-';
    const horarioCompartilhado = main?.horário || compare?.horário || '-';
    const disciplinaMain = main?.disciplina || '-';
    const disciplinaCompare = compare?.disciplina || '-';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="comparison-cell-text comparison-discipline-link comparison-discipline-main" role="button" tabindex="0" title="${escapeHtml(disciplinaMain)}">${escapeHtml(getDisciplinaLabelForComparisonMobile(disciplinaMain))}</span></td>
      <td class="compare-col"><span class="comparison-cell-text comparison-discipline-link comparison-discipline-compare" role="button" tabindex="0" title="${escapeHtml(disciplinaCompare)}">${escapeHtml(getDisciplinaLabelForComparisonMobile(disciplinaCompare))}</span></td>
      <td><span class="comparison-cell-text">${main?.turma || '-'}</span></td>
      <td class="compare-col"><span class="comparison-cell-text">${compare?.turma || '-'}</span></td>
      <td><span class="comparison-cell-text">${periodoCompartilhado}</span></td>
      <td><span class="comparison-cell-text">${horarioCompartilhado}</span></td>
    `;

    const bindOpenModal = (element, info) => {
      if (!element || !info?.disciplina || info.disciplina === '-') return;
      const open = () => openDisciplinaInfoModal(info);
      element.addEventListener('click', open);
      element.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          open();
        }
      });
    };

    bindOpenModal(tr.querySelector('.comparison-discipline-main'), {
      perfil: getFirstNameFromUser(comparisonCtx.mainUser),
      disciplina: disciplinaMain,
      turma: main?.turma || '-',
      dia: main?.dia || compare?.dia || '-',
      periodo: periodoCompartilhado,
      horario: horarioCompartilhado,
      sala: main?.sala || '-'
    });

    bindOpenModal(tr.querySelector('.comparison-discipline-compare'), {
      perfil: getFirstNameFromUser(comparisonCtx.compareUser),
      disciplina: disciplinaCompare,
      turma: compare?.turma || '-',
      dia: compare?.dia || main?.dia || '-',
      periodo: periodoCompartilhado,
      horario: horarioCompartilhado,
      sala: compare?.sala || '-'
    });

    tbody.appendChild(tr);
  });

  table.style.display = rows.length > 0 ? '' : 'none';
}

function preencherTabelaSimplificada(horarios) {
    const diasMap = {
        'Segunda-feira': 'tabela-horarios-segunda',
        'Terça-feira': 'tabela-horarios-terca',
        'Quarta-feira': 'tabela-horarios-quarta',
        'Quinta-feira': 'tabela-horarios-quinta',
        'Sexta-feira': 'tabela-horarios-sexta'
    };

    const comparisonCtx = getComparisonProfilesContext();
    const horariosComparacao = comparisonCtx.enabled ? comparisonCtx.compareHorarios : [];

    Object.values(diasMap).forEach(id => {
        const table = document.getElementById(id);
        if (table) {
            table.style.display = 'none';
            const tbody = table.querySelector('tbody');
            if (tbody) tbody.innerHTML = '';
            table.classList.remove('comparison-mode');
        }
    });

    const tabelaHoje = document.getElementById('tabela-horarios-hoje');
    const tbodyHoje = tabelaHoje ? tabelaHoje.querySelector('tbody') : null;
    if (tabelaHoje && tbodyHoje) {
        tabelaHoje.style.display = 'none';
        tabelaHoje.classList.remove('comparison-mode');
        tbodyHoje.innerHTML = '';
    }

    let avisoHoje = document.getElementById('aviso-hoje-fds');
    if (avisoHoje) avisoHoje.remove();

    const horariosPorDia = {};
    (horarios || []).forEach(item => {
        const dia = item.dia;
        if (!horariosPorDia[dia]) horariosPorDia[dia] = [];
        horariosPorDia[dia].push(item);
    });

    const horariosComparacaoPorDia = {};
    (horariosComparacao || []).forEach(item => {
        const dia = item.dia;
        if (!horariosComparacaoPorDia[dia]) horariosComparacaoPorDia[dia] = [];
        horariosComparacaoPorDia[dia].push(item);
    });

    const { targetDay, switchedToTomorrow, todayName, tomorrowName } = getTodayPanelTargetDay(horarios);
    const hojeNome = todayName;
    const tabelaHojeContainer = document.getElementById('tabela-hoje-container');
    const tituloHoje = tabelaHojeContainer ? tabelaHojeContainer.querySelector('h3') : null;
    if (tituloHoje) {
      if (switchedToTomorrow) {
        tituloHoje.textContent = 'Amanhã';
      } else if (isAutoTomorrowEnabled()) {
        tituloHoje.textContent = 'Hoje (Amanhã automático)';
      } else {
        tituloHoje.textContent = 'Hoje';
      }
    }

    if ((hojeNome === 'Sábado' || hojeNome === 'Domingo') && tabelaHojeContainer) {
        const aviso = document.createElement('div');
        aviso.id = 'aviso-hoje-fds';
        aviso.style = 'background: #fff3cd; color: #856404; border: 1px solid #ffeeba; padding: 12px; border-radius: 6px; margin-bottom: 8px;';
        aviso.innerHTML = `<strong>Hoje é ${hojeNome}.</strong> Não há horários cadastrados para finais de semana.`;
        tabelaHojeContainer.insertBefore(aviso, tabelaHojeContainer.querySelector('h3').nextSibling);
        if (tabelaHoje) tabelaHoje.style.display = 'none';
      } else if (diasMap[targetDay] && tabelaHoje && tbodyHoje) {
        const mainHoje = horariosPorDia[targetDay] || [];
        const compareHoje = horariosComparacaoPorDia[targetDay] || [];
        if (mainHoje.length > 0 || compareHoje.length > 0) {
          preencherTabelaDia(tabelaHoje, mainHoje, compareHoje, comparisonCtx);
          tabelaHoje.style.display = '';
        }
      } else if (switchedToTomorrow && tabelaHojeContainer) {
          const aviso = document.createElement('div');
          aviso.id = 'aviso-hoje-fds';
          aviso.style = 'background: #e8f2ff; color: #24527a; border: 1px solid #bbdefb; padding: 12px; border-radius: 6px; margin-bottom: 8px;';
          aviso.innerHTML = `<strong>Aulas de ${todayName} encerradas.</strong> Não há horários cadastrados para amanhã (${tomorrowName}).`;
          tabelaHojeContainer.insertBefore(aviso, tabelaHojeContainer.querySelector('h3').nextSibling);
          if (tabelaHoje) tabelaHoje.style.display = 'none';
    }

    Object.entries(diasMap).forEach(([dia, id]) => {
        const table = document.getElementById(id);
        const listaMain = horariosPorDia[dia] || [];
        const listaCompare = horariosComparacaoPorDia[dia] || [];
        if (!table) return;

        if (listaMain.length > 0 || listaCompare.length > 0) {
          preencherTabelaDia(table, listaMain, listaCompare, comparisonCtx);
          table.style.display = '';
        }
    });

    renderInteractiveGuide(horarios, horariosComparacao, comparisonCtx);
}

// ===== Interactive Schedule Guide =====
function renderInteractiveGuide(horarios, horariosComparacao = [], comparisonCtx = null) {
  const guideContainer = document.getElementById('interactive-schedule-guide');
  const labelsContainer = document.querySelector('.schedule-timeline-labels');
  const hoursContainer = document.querySelector('.schedule-timeline-hours');
  const eventsContainer = document.querySelector('.schedule-timeline-events');
  const trackContainer = document.querySelector('.schedule-timeline-track');
  const needle = document.querySelector('.schedule-timeline-needle');

  if (!guideContainer || !labelsContainer || !hoursContainer || !eventsContainer || !trackContainer || !needle) return;

  // Limpa o conteúdo anterior
  labelsContainer.innerHTML = '';
  hoursContainer.innerHTML = '';
  eventsContainer.innerHTML = '';
  trackContainer.querySelectorAll('.schedule-timeline-selection-layer').forEach(el => el.remove());
  trackContainer.querySelectorAll('.schedule-timeline-range-marker').forEach(el => el.remove());
  trackContainer.querySelectorAll('.schedule-timeline-needle-compare').forEach(el => el.remove());

  if (scheduleInterval) clearInterval(scheduleInterval);

  const { targetDay } = getTodayPanelTargetDay(horarios);

  const todayClasses = (horarios || []).filter(h => h.dia === targetDay).sort((a, b) => {
    return parseHora(a.horário.split('-')[0]) - parseHora(b.horário.split('-')[0]);
  });

  const compareClasses = (horariosComparacao || []).filter(h => h.dia === targetDay).sort((a, b) => {
    return parseHora(a.horário.split('-')[0]) - parseHora(b.horário.split('-')[0]);
  });

  const hasCompare = !!(comparisonCtx?.enabled && compareClasses.length > 0);

  if (todayClasses.length === 0 && compareClasses.length === 0) {
    guideContainer.style.display = 'none';
    return;
  }

  guideContainer.style.display = 'block';
  eventsContainer.classList.toggle('has-compare', hasCompare);

  let minH = 24, maxH = 0;
  [...todayClasses, ...compareClasses].forEach(({ horário }) => {
    const [ini, fim] = horário.split('-');
    minH = Math.min(minH, Math.floor(parseHora(ini)));
    maxH = Math.max(maxH, Math.ceil(parseHora(fim)));
  });

  // Adiciona uma margem de uma hora antes e depois, se possível
  minH = Math.max(6, minH - 1);
  maxH = Math.min(23, maxH + 1);
  
  const totalHours = maxH - minH;
  let pinnedEventEl = null;

  const selectionLayer = document.createElement('div');
  selectionLayer.className = 'schedule-timeline-selection-layer';
  trackContainer.appendChild(selectionLayer);

  function clearRangePreview() {
    selectionLayer.innerHTML = '';
    trackContainer.querySelectorAll('.schedule-timeline-range-marker').forEach(marker => marker.remove());
    eventsContainer.querySelectorAll('.schedule-timeline-event.is-active').forEach(eventEl => {
      if (eventEl !== pinnedEventEl) eventEl.classList.remove('is-active');
    });
  }

  function createRangeChip(position, label, edgeClass = '', isCompare = false) {
    const chip = document.createElement('div');
    chip.className = `schedule-timeline-range-chip${edgeClass ? ` ${edgeClass}` : ''}${isCompare ? ' is-compare' : ''}`;
    chip.style.left = `${position}%`;
    chip.textContent = label;
    selectionLayer.appendChild(chip);
  }

  function createRangeMarker(position, isCompare = false) {
    const marker = document.createElement('div');
    marker.className = `schedule-timeline-range-marker${isCompare ? ' is-compare' : ''}`;
    marker.style.left = `${position}%`;
    trackContainer.appendChild(marker);
  }

  function showRangePreview(eventEl, startPosition, endPosition, startLabel, endLabel, persist = false, isCompare = false) {
    clearRangePreview();
    if (pinnedEventEl && pinnedEventEl !== eventEl) {
      pinnedEventEl.classList.remove('is-active');
    }

    if (persist) {
      pinnedEventEl = pinnedEventEl === eventEl ? null : eventEl;
    }

    const activeEventEl = persist ? pinnedEventEl : eventEl;
    if (!activeEventEl) return;

    activeEventEl.classList.add('is-active');
    createRangeMarker(startPosition, isCompare);
    createRangeMarker(endPosition, isCompare);
    createRangeChip(startPosition, startLabel, startPosition <= 3 ? 'is-edge-start' : '', isCompare);
    createRangeChip(endPosition, endLabel, endPosition >= 97 ? 'is-edge-end' : '', isCompare);
  }

  function restorePinnedPreview() {
    if (!pinnedEventEl) {
      clearRangePreview();
      return;
    }

    showRangePreview(
      pinnedEventEl,
      Number(pinnedEventEl.dataset.startPosition),
      Number(pinnedEventEl.dataset.endPosition),
      pinnedEventEl.dataset.startLabel,
      pinnedEventEl.dataset.endLabel,
      false,
      pinnedEventEl.dataset.compare === '1'
    );
    pinnedEventEl.classList.add('is-active');
  }

  // Renderiza a régua em intervalos de 15 minutos com diferentes níveis visuais.
  for (let minute = minH * 60; minute <= maxH * 60; minute += 15) {
    const minuteOffset = minute - minH * 60;
    const position = (minuteOffset / (totalHours * 60)) * 100;
    const hour = Math.floor(minute / 60);
    const minuteInHour = minute % 60;

    const labelEl = document.createElement('div');
    labelEl.className = 'schedule-timeline-label';
    labelEl.style.left = `${position}%`;

    if (minuteInHour === 0) {
      labelEl.textContent = `${String(hour).padStart(2, '0')}:00`;
    } else if (minuteInHour === 30) {
      labelEl.textContent = ':30';
      labelEl.classList.add('is-half');
    } else {
      labelEl.textContent = String(minuteInHour).padStart(2, '0');
      labelEl.classList.add('is-quarter');
    }

    if (minute === minH * 60) labelEl.classList.add('is-edge-start');
    if (minute === maxH * 60) labelEl.classList.add('is-edge-end');
    labelsContainer.appendChild(labelEl);

    const hourEl = document.createElement('div');
    hourEl.className = 'schedule-timeline-hour';
    hourEl.style.left = `${position}%`;

    if (minuteInHour === 30) {
      hourEl.classList.add('is-half');
    } else if (minuteInHour !== 0) {
      hourEl.classList.add('is-quarter');
    }

    hoursContainer.appendChild(hourEl);
  }

  const mainRow = document.createElement('div');
  mainRow.className = 'schedule-timeline-events-row schedule-timeline-events-row-main';
  eventsContainer.appendChild(mainRow);

  let compareRow = null;
  if (hasCompare) {
    compareRow = document.createElement('div');
    compareRow.className = 'schedule-timeline-events-row schedule-timeline-events-row-compare';
    eventsContainer.appendChild(compareRow);
  }

  function appendTimelineEvent(c, targetRow, isCompare = false) {
    const { disciplina, horário } = c;
    const [startStr, endStr] = horário.split('-');
    const startHour = parseHora(startStr);
    const endHour = parseHora(endStr);
    const durationMinutes = Math.max(1, Math.round((endHour - startHour) * 60));

    const left = ((startHour - minH) / totalHours) * 100;
    const width = ((endHour - startHour) / totalHours) * 100;

    const eventEl = document.createElement('div');
    eventEl.className = `schedule-timeline-event${isCompare ? ' is-compare' : ''}`;
    if (durationMinutes <= 45) {
      eventEl.classList.add('is-tight');
    } else if (durationMinutes <= 75) {
      eventEl.classList.add('is-compact');
    }
    eventEl.style.left = `${left}%`;
    eventEl.style.width = `${width}%`;
    eventEl.dataset.startPosition = String(left);
    eventEl.dataset.endPosition = String(left + width);
    eventEl.dataset.startLabel = startStr;
    eventEl.dataset.endLabel = endStr;
    eventEl.dataset.compare = isCompare ? '1' : '0';
    const labelEl = document.createElement('span');
    labelEl.className = 'schedule-timeline-event-label';
    labelEl.textContent = disciplina;
    eventEl.appendChild(labelEl);
    eventEl.title = `${disciplina} (${horário})`;
    eventEl.style.backgroundColor = isCompare ? getDisciplinaWarmColor(disciplina) : getDisciplinaColor(disciplina);
    eventEl.tabIndex = 0;
    eventEl.addEventListener('mouseenter', () => showRangePreview(eventEl, left, left + width, startStr, endStr, false, isCompare));
    eventEl.addEventListener('mouseleave', restorePinnedPreview);
    eventEl.addEventListener('focus', () => showRangePreview(eventEl, left, left + width, startStr, endStr, false, isCompare));
    eventEl.addEventListener('blur', restorePinnedPreview);
    eventEl.addEventListener('click', () => {
      if (pinnedEventEl === eventEl) {
        pinnedEventEl.classList.remove('is-active');
        pinnedEventEl = null;
        clearRangePreview();
        return;
      }

      showRangePreview(eventEl, left, left + width, startStr, endStr, true, isCompare);
    });
    targetRow.appendChild(eventEl);
  }

  todayClasses.forEach(c => appendTimelineEvent(c, mainRow, false));
  if (hasCompare && compareRow) {
    compareClasses.forEach(c => appendTimelineEvent(c, compareRow, true));
  }
  
  updateNeedlePosition(minH, totalHours);
  scheduleInterval = setInterval(() => updateNeedlePosition(minH, totalHours), 60000);
}

function updateNeedlePosition(minH, totalHours) {
  const needleMain = document.querySelector('.schedule-timeline-needle');
  if (!needleMain) return;

  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;
  const formattedTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  if (currentHour >= minH && currentHour <= minH + totalHours) {
    const position = ((currentHour - minH) / totalHours) * 100;
    needleMain.style.left = `${position}%`;
    needleMain.setAttribute('data-time', formattedTime);
    needleMain.style.display = 'block';
  } else {
    needleMain.removeAttribute('data-time');
    needleMain.style.display = 'none';
  }
}


// ===== Visualização Semanal (Google Calendar style) =====
const weeklyEventColors = [
  '#062d58', '#0277bd', '#00838f', '#00695c', '#2e7d32',
  '#558b2f', '#9e9d24', '#f9a825', '#ff8f00', '#ef6c00',
  '#d84315', '#6a1b9a', '#4527a0', '#283593', '#c62828'
];
const warmComparisonColors = [
  '#ff8f00', '#ef6c00', '#f4511e', '#ff7043', '#fb8c00',
  '#e65100', '#ff6f00', '#f57c00', '#e64a19', '#ff5722'
];
const disciplinaColorMap = {};
const disciplinaWarmColorMap = {};
let nextColorIdx = 0;
let nextWarmColorIdx = 0;

function getDisciplinaColor(disciplina) {
  if (!disciplinaColorMap[disciplina]) {
    disciplinaColorMap[disciplina] = weeklyEventColors[nextColorIdx % weeklyEventColors.length];
    nextColorIdx++;
  }
  return disciplinaColorMap[disciplina];
}

function getDisciplinaWarmColor(disciplina) {
  if (!disciplinaWarmColorMap[disciplina]) {
    disciplinaWarmColorMap[disciplina] = warmComparisonColors[nextWarmColorIdx % warmComparisonColors.length];
    nextWarmColorIdx++;
  }
  return disciplinaWarmColorMap[disciplina];
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
  const interactiveGuide = document.getElementById('interactive-schedule-guide');

  function ativarView(view, renderData) {
    btns.forEach(b => b.classList.remove('active'));
    const target = document.querySelector(`.view-toggle-btn[data-view="${view}"]`);
    if (target) target.classList.add('active');
    
    listaContainer.style.display = 'none';
    weeklyContainer.style.display = 'none';
    threeDayContainer.style.display = 'none';
    interactiveGuide.style.display = 'none';
    if(scheduleInterval) clearInterval(scheduleInterval);

    if (view === 'semanal') {
      weeklyContainer.style.display = '';
      if (renderData) preencherVisualizacaoSemanal(horariosGlobais);
    } else if (view === '3dias') {
      threeDayContainer.style.display = '';
      if (renderData) preencherVisualizacao3Dias(horariosGlobais);
    } else {
      listaContainer.style.display = '';
      interactiveGuide.style.display = 'block';
      if (renderData) {
        const comparisonCtx = getComparisonProfilesContext();
        renderInteractiveGuide(horariosGlobais, comparisonCtx.enabled ? comparisonCtx.compareHorarios : [], comparisonCtx);
      }
    }
    localStorage.setItem('sigaa-horarios-view', view);
  }

  btns.forEach(btn => {
    btn.addEventListener('click', () => ativarView(btn.dataset.view, true));
  });

  // Restaura a última visualização salva (sem renderizar — dados ainda não chegaram)
  const saved = localStorage.getItem('sigaa-horarios-view') || 'lista';
  ativarView(saved, false);
}

// Atualiza a visualização de calendário ativa (chamado após dados carregarem)
function atualizarViewAtiva() {
  const saved = localStorage.getItem('sigaa-horarios-view');
  if (saved === 'semanal') {
    preencherVisualizacaoSemanal(horariosGlobais);
  } else if (saved === '3dias') {
    preencherVisualizacao3Dias(horariosGlobais);
  } else {
    const comparisonCtx = getComparisonProfilesContext();
    renderInteractiveGuide(horariosGlobais, comparisonCtx.enabled ? comparisonCtx.compareHorarios : [], comparisonCtx);
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
  let savedScrollY = 0;
  const THRESHOLD = 0.03; // 3% of screen width to commit
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
    el.style.transition = '';
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
      clearPeekStyles(currentTab);
    }
    if (peekTab) {
      peekTab.classList.remove('swipe-peek', 'swipe-snap');
      clearPeekStyles(peekTab);
    }
    document.body.style.overflow = '';
    const hdr = document.querySelector('.page-header');
    if (hdr) hdr.classList.remove('swipe-fixed');
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
      // Position both tabs fixed below the header
      const header = document.querySelector('.page-header');
      const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
      savedScrollY = window.scrollY;
      document.body.style.overflow = 'hidden';
      // Fix the header above everything during swipe
      if (header) header.classList.add('swipe-fixed');

      // Fix-position the current tab
      currentTab.style.position = 'fixed';
      currentTab.style.top = `${headerBottom}px`;
      currentTab.style.left = '0';
      currentTab.style.width = '100vw';
      currentTab.style.height = `calc(100vh - ${headerBottom}px)`;
      currentTab.style.zIndex = '200';
      currentTab.style.background = '#f0f2f5';
      currentTab.style.overflowY = 'auto';
      currentTab.style.padding = '20px';
      currentTab.style.boxSizing = 'border-box';
      currentTab.scrollTop = savedScrollY;

      // Fix-position the peek tab
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
      const remainingRatio = 1 - ratio;
      const snapDuration = Math.max(0.18, Math.min(0.45, remainingRatio * 0.55));
      const easing = 'cubic-bezier(0.2, 0, 0, 1)';
      currentTab.classList.add('swipe-snap');
      peekTab.classList.add('swipe-snap');
      currentTab.style.transition = `transform ${snapDuration}s ${easing}`;
      peekTab.style.transition = `transform ${snapDuration}s ${easing}`;
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
        clearPeekStyles(oldTab);
        newTab.classList.remove('swipe-peek', 'swipe-snap');
        clearPeekStyles(newTab);
        document.body.style.overflow = '';
        const hdr = document.querySelector('.page-header');
        if (hdr) hdr.classList.remove('swipe-fixed');
        window.scrollTo(0, 0);
        newTab.classList.add('active');

        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        const btn = document.querySelector(`.tab-button[data-tab="${newTabId}"]`);
        if (btn) btn.classList.add('active');

        refreshHomeHeightSyncLoop();
      };

      newTab.addEventListener('transitionend', onDone, { once: true });
      // Fallback if transitionend doesn't fire
      setTimeout(onDone, snapDuration * 1000 + 50);
    } else {
      // Cancel: snap back
      const snapBackDuration = Math.max(0.18, Math.min(0.4, ratio * 0.5));
      const easeBack = 'cubic-bezier(0.2, 0, 0, 1)';
      currentTab.classList.add('swipe-snap');
      peekTab.classList.add('swipe-snap');
      currentTab.style.transition = `transform ${snapBackDuration}s ${easeBack}`;
      peekTab.style.transition = `transform ${snapBackDuration}s ${easeBack}`;
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
        clearPeekStyles(ct);
        pt.classList.remove('swipe-peek', 'swipe-snap');
        clearPeekStyles(pt);
        document.body.style.overflow = '';
        const hdr = document.querySelector('.page-header');
        if (hdr) hdr.classList.remove('swipe-fixed');
        window.scrollTo(0, savedScrollY);
      };
      pt.addEventListener('transitionend', onSnapBack, { once: true });
      setTimeout(onSnapBack, snapBackDuration * 1000 + 50);
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
  initSelectPerfisSalvos();
  atualizarSelectPerfisSalvos();
  const dadosSalvos = obterConsultaInicialSalva();

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

  aplicarDadosConsulta(dadosSalvos);

  const selectedUser = getSelectedProfileUser();
  if (selectedUser) {
    const userInput = document.getElementById('user');
    if (userInput) userInput.value = selectedUser;
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
      } else if (action === 'abrir-configuracoes') {
        activateTab('tab-configuracoes');
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
    } else if (action === 'abrir-configuracoes') {
      activateTab('tab-configuracoes');
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
