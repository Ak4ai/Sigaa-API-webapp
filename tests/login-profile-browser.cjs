const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const root = path.resolve(__dirname, '../../../..');
const frontend = path.resolve(__dirname, '..');
const backend = process.env.SIGAA_BACKEND_DIR || path.join(root, 'sigaa-api-backend');
const express = require(path.join(backend, 'node_modules/express'));
const puppeteer = require(path.join(backend, 'node_modules/puppeteer-core'));
const app = express();
app.use(express.json());
app.use(require(path.join(backend, 'lib/security-headers')));
let loginUser = '', scraperCalls = 0, scraperDelay = 0, scraperFailure = false;
function data(name) {
  return { dadosInstitucionais: { Nome: name, 'Matrícula': '123456', Curso: 'Engenharia da Computação', Email: 'teste@example.test' },
    horariosDetalhados: [], horariosSimplificados: [], avisosPorDisciplina: [], atividadesPortal: [] };
}
app.get('/', (req,res) => res.send(fs.readFileSync(path.join(frontend,'index.html'),'utf8')));
process.env.SECRET = 'browser-test-only-secret';
process.env.ENC_SECRET = 'a'.repeat(32);
process.env.ENC_SECRET_USER = 'b'.repeat(32);
process.env.TOKEN_REVOCATION_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sigaa-browser-revocations-'));
process.env.SESSION_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sigaa-browser-sessions-'));
require.cache[require.resolve(path.join(backend, 'lib/sigaa-login'))] = { exports: { verifySigaaLogin: async () => true } };
const browserSession = require(path.join(backend, 'lib/browser-session'));
const auth = require(path.join(backend, 'api/auth'));
app.use('/api', browserSession.middleware);
app.get('/api/session', browserSession.sessionHandler);
app.post('/api/login', require(path.join(backend, 'api/login')));
app.post('/api/scraper', async (req,res) => {
  const payload = await auth.validarTokenLogin(req.body.token);
  if (!payload) return res.status(401).json({error:'Invalid session'});
  loginUser = payload.user;
  scraperCalls++;
  if (scraperDelay) await new Promise(resolve => setTimeout(resolve, scraperDelay));
  if (scraperFailure) return res.status(503).json({error:'Falha temporária de teste'});
  res.json(data(loginUser === '222' ? 'Bruno Lima' : 'Ana Silva'));
});
app.post('/api/logout', require(path.join(backend, 'api/logout')));
app.get('/api/queue-status',(req,res)=>res.json({position:1,avgTimeMs:1000}));
app.get('/api/scraper-progress',(req,res)=>res.json({progress:100,status:'Concluído'}));
app.get('/api/calendario',(req,res)=>res.json({link:'https://example.test/calendar.pdf'}));
let examWrites = 0;
let savedExam = null;
const examClass = { id: 'verified-class', disciplina: 'Matemática', turma: '01', semestre: '2026.2', provasCadastradas: 0 };
const visualEvents = [
  {data:'2026-10-12',titulo:'Feriado institucional',tipo:'feriado'},
  {data:'2026-10-12',titulo:'Prazo para requerimentos acadêmicos e confirmação de matrícula',tipo:'outros'},
  {data:'2026-10-12',titulo:'Recesso escolar',tipo:'recesso'}
];
app.get('/api/calendario/eventos',(req,res)=>res.json({eventos:[...visualEvents,...(savedExam ? [savedExam] : [])], turmas: browserSession.cookieToken(req) ? [
  { ...examClass, provasCadastradas: examWrites },
  { ...examClass, id:'project-without-schedule', disciplina:'Projeto Integrador de Engenharia e Desenvolvimento de Sistemas Computacionais', provasCadastradas:0 },
  { ...examClass, id:'full-class', disciplina:'Estágio', provasCadastradas:6 }
] : []}));
app.post('/api/calendario/eventos',(req,res)=>{
  assert.ok(browserSession.cookieToken(req));
  if (req.body.acao === 'remover') {
    assert.equal(req.body.provaId, savedExam.id);
    savedExam = null;
    examWrites--;
    return res.json({success:true});
  }
  assert.equal(req.body.turmaId, 'verified-class');
  assert.equal(req.body.disciplina, undefined);
  examWrites++;
  savedExam = { id:'11111111-1111-4111-8111-111111111111', data:req.body.data, titulo:req.body.titulo, tipo:'prova', manual:true, porOutroUsuario:false, disciplina:examClass.disciplina };
  res.json({success:true});
});
app.use(express.static(frontend));
(async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(file=>fs.existsSync(file)),headless:true});
 try{
  const page=await browser.newPage();const errors=[];
  page.on('request', request => {
    if (request.url().includes('/api/')) {
      assert.equal(request.headers().authorization, undefined);
      if (request.postData()) assert.equal(JSON.parse(request.postData()).token, undefined);
    }
  });
  page.on('pageerror',error=>errors.push(error.message));
  await page.evaluateOnNewDocument(() => document.addEventListener('securitypolicyviolation', e => { (window.__cspViolations ||= []).push(e.violatedDirective); }));
  await page.setRequestInterception(true);
  page.on('request',request=>request.url().startsWith('http://127.0.0.1:') || process.env.SIGAA_VISUAL_NETWORK === '1' && /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(request.url()) ?request.continue():request.abort());
  await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle0'});
  await page.evaluate(()=>{navigator.credentials.store=async credential=>{window.__credentialStoreCalls=(window.__credentialStoreCalls || 0)+1;window.__storedCredential={id:credential.id,password:credential.password};return credential;};});
  await page.evaluate(()=>{localStorage.setItem('sigaa-show-desktop-profile-select','1');localStorage.setItem('sigaa_aviso_fechado','1');});
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);
  const backdrop = await page.evaluate(()=>Array.from(document.querySelectorAll('.login-backdrop span')).map(logo=>{
    const style=getComputedStyle(logo);return {size:style.width,animation:style.animationName,delay:style.animationDelay};
  }));
  assert.ok(new Set(backdrop.map(logo=>logo.size)).size>=4);
  assert.ok(new Set(backdrop.map(logo=>logo.delay)).size>=4,JSON.stringify(backdrop));
  assert.ok(backdrop.every(logo=>logo.animation==='cefet-background-breathe'));
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  assert.equal(await page.evaluate(()=>Array.from(document.querySelectorAll('.login-backdrop span')).every(logo=>getComputedStyle(logo).animationName==='none')),true);
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);
  const themes = [['graduacao','#1976d2'],['tecnico','#0f8a5f'],['responsavel','#7b3fe4']];
  for (const [width,height] of [[320,568],[360,640],[390,844],[430,932],[768,1024],[1366,900],[390,360]]) {
    await page.setViewport({width,height,isMobile:true,hasTouch:true});
    const backgrounds = new Set();
    for (const [mode,accent] of themes) {
      await page.select('#home-mode-select',mode);
      await page.evaluate(() => fitLoginCard());
      const layout = await page.evaluate(()=>{
        const card = document.getElementById('home-content').getBoundingClientRect();
        const form = document.getElementById('sigaa-form').getBoundingClientRect();
        const style = getComputedStyle(document.body);
        return {left:card.left,right:card.right,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
          formFits:form.width<=card.width,background:style.backgroundImage,
          accent:style.getPropertyValue('--app-accent').trim(),overflow:style.overflowY};
      });
      assert.ok(layout.left>=8 && layout.right<=layout.width-8 && layout.scrollWidth<=layout.width && layout.formFits,JSON.stringify(layout));
      assert.equal(layout.accent,accent);
      assert.equal(layout.overflow,'hidden');
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true);
      assert.ok(await page.$eval('#home-content', el => {
        const card = el.getBoundingClientRect();
        const panel = document.getElementById('tab-home').getBoundingClientRect();
        const shell = document.getElementById('home-consultation-shell');
        return Math.abs((card.top + card.bottom) / 2 - (panel.top + panel.bottom) / 2) <= 12 && card.top >= panel.top && card.bottom <= panel.bottom && getComputedStyle(shell).overflowY === 'visible';
      }), 'login card must be vertically centered');
      backgrounds.add(layout.background);
      if(width===390 && height===844 || width===1366) {
        await page.screenshot({path:path.join(os.tmpdir(),`sigaa-login-${mode}-${width}.png`),fullPage:true});
      }
    }
    assert.equal(backgrounds.size,3);
    if(height===360) {
      await page.$eval('#sigaa-form button[type=submit]',button=>button.scrollIntoView({block:'center'}));
      assert.equal(await page.$eval('#sigaa-form button[type=submit]',button=>{
        const rect = button.getBoundingClientRect();return rect.top>=0 && rect.bottom<=innerHeight;
      }),true);
    }
  }
  await page.select('#home-mode-select','graduacao');
  await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
  const sessionControls = ['header-refresh-btn','header-logout-btn','desktop-quick-actions','mobile-fab','fab-minimized'];
  const hiddenControls = async () => page.evaluate(ids=>ids.every(id=>getComputedStyle(document.getElementById(id)).display==='none'),sessionControls);
  assert.equal(await hiddenControls(),true);
  assert.equal(await page.$eval('#user',el=>el.autocomplete),'username');
  assert.equal(await page.$eval('#pass',el=>el.autocomplete),'current-password');
  assert.equal(await page.$eval('#home-mode-select',el=>el.closest('form').id),'sigaa-form');
  await page.screenshot({path:path.join(os.tmpdir(), 'sigaa-login-mobile.png'),fullPage:true});
  await page.type('#user','111');await page.type('#pass',' test password ');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id === 'pass'), false, 'Enter removes the input focus before showing the loading overlay');
  await page.waitForFunction(()=>document.querySelector('#home-account-select') && !document.querySelector('#sigaa-form'));
  await page.waitForSelector('#mobile-user-name.home-account-select',{visible:true});
  assert.equal(await page.$eval('#mobile-user-name', el => el.selectedOptions[0]?.textContent), 'Ana Silva');
  assert.ok(await page.evaluate(() => {
    const name = document.getElementById('mobile-user-name').getBoundingClientRect();
    const actions = document.querySelector('.mobile-user-card-actions').getBoundingClientRect();
    return name.bottom <= actions.top;
  }), 'mobile selector must sit above refresh/logout');
  let options=await page.$eval('#home-account-select',el=>Array.from(el.options).filter(o=>!o.hidden).map(o=>o.textContent));
  assert.deepEqual(options,['＋ Adicionar conta']);
  assert.equal(await page.evaluate(()=>getTokenInfo().user),'111');
  assert.deepEqual(await page.evaluate(()=>window.__storedCredential),{id:'111',password:' test password '});
  for (const width of [390,768,820,1024,1040]) {
    await page.setViewport({width,height:1100,isMobile:true,hasTouch:true});
    await page.evaluate(() => activateTab('tab-home'));
    assert.ok(await page.evaluate(() => {
      const header = document.getElementById('home-content-header').getBoundingClientRect();
      const user = document.getElementById('mobile-user-card').getBoundingClientRect();
      const institution = document.getElementById('dados-institucionais').getBoundingClientRect();
      return Math.abs(user.width-header.width)<2 && Math.abs(institution.width-header.width)<2 && header.width>=innerWidth-64 && institution.right<=innerWidth;
    }), `home cards must use the available width at ${width}`);
    if (width === 820) await page.screenshot({path:path.join(os.tmpdir(),'sigaa-home-ipad.png'),fullPage:true});
  }
  const attendance = await page.evaluate(() => {
    const items = [
      {disciplina:'Sistemas Digitais',numeroAulasDefinidas:0,frequencia:[]},
      {disciplina:'Projeto',numeroAulasDefinidas:60,frequencia:[]},
      {disciplina:'Matemática',numeroAulasDefinidas:80,frequencia:[{data:'2026-10-01',status:'2 Faltas'}]}
    ];
    preencherSelectorFrequencias(items);
    preencherTabelaFrequencias(items);
    const rows = [...document.querySelectorAll('#tabela-frequencias tbody tr')].map(row => row.textContent);
    const options = [...document.getElementById('select-disciplina-frequencia').options].map(option => option.value);
    preencherTabelaFrequencias(items,'Sistemas Digitais');
    const empty = document.getElementById('resumo-frequencia-disciplina').textContent;
    const noBar = document.getElementById('barra-progresso-faltas').style.display === 'none';
    preencherTabelaFrequencias(items,'Matemática');
    const normal = document.querySelector('#tabela-frequencias tbody').textContent;
    const noticeCleared = !document.getElementById('resumo-frequencia-disciplina').classList.contains('frequency-empty-notice');
    preencherSelectorFrequencias(frequenciasGlobais);
    preencherTabelaFrequencias(frequenciasGlobais);
    return {rows,options,empty,noBar,normal,noticeCleared};
  });
  assert.equal(attendance.rows.length,3);
  assert.ok(attendance.rows[0].includes('não registrada'));
  assert.ok(attendance.rows[1].includes('não registrada'));
  assert.ok(attendance.rows[2].includes('97.5%'));
  assert.ok(attendance.options.includes('Sistemas Digitais'));
  assert.ok(attendance.empty.includes('não registrada'));
  assert.ok(attendance.noBar && attendance.noticeCleared && attendance.normal.includes('2 Faltas'));
  await page.setViewport({width:1366,height:900,isMobile:true,hasTouch:true});
  await page.evaluate(async()=>{
    const checkbox = document.getElementById('calendar-view-checkbox');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change',{bubbles:true}));
    await renderResponsibleCalendar(getAppMode());
    ajustarAlturaCalendarioResponsavel();
  });
  const calendarFits = () => page.evaluate(()=>{
    ajustarAlturaCalendarioResponsavel();
    const reference = document.getElementById('home-content-header').getBoundingClientRect();
    const calendar = document.getElementById('responsavel-calendar-container').getBoundingClientRect();
    return calendar.height>0 && Math.abs(reference.bottom-calendar.bottom)<=2;
  });
  assert.equal(await calendarFits(),true);
  await page.select('#home-account-select','__add_account__');
  await page.waitForSelector('#sigaa-form',{visible:true});
  await page.waitForFunction(()=>{
    ajustarAlturaCalendarioResponsavel();
    return Math.abs(document.getElementById('home-content-header').getBoundingClientRect().bottom-document.getElementById('responsavel-calendar-container').getBoundingClientRect().bottom)<=2;
  });
  assert.equal(await calendarFits(),true);
  await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
  assert.equal(await page.$eval('#user',el=>el.autocomplete),'username');
  await page.$eval('#cancel-account-login', el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
  await new Promise(resolve => setTimeout(resolve, 350));
  await page.click('#cancel-account-login');
  assert.equal(await page.evaluate(()=>document.body.classList.contains('adding-account')),false);
  await page.select('#mobile-user-name','__add_account__');
  for (const width of [390,768,820,1024,1040]) {
    await page.setViewport({width,height:1100,isMobile:true,hasTouch:true});
    assert.ok(await page.$eval('#sigaa-form', form => {
      const rect = form.getBoundingClientRect();
      const header = document.getElementById('home-content-header').getBoundingClientRect();
      return Math.abs(rect.width-header.width)<2 && rect.width>=innerWidth-64 && rect.right<=innerWidth;
    }), `add-account form should use the available width at ${width}`);
  }
  await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
  await page.$eval('#user',el=>el.value='');
  await page.$eval('#pass',el=>el.value='');
  await page.type('#user','222');await page.type('#pass','another password');
  await page.click('#sigaa-form button[type=submit]');
  await page.waitForFunction(()=>getSavedProfiles().length===2 && !document.querySelector('#sigaa-form'));
  options=await page.$eval('#home-account-select',el=>Array.from(el.options).filter(o=>!o.hidden).map(o=>o.textContent));
  assert.deepEqual(options,['Ana']);
  const credentialCallsBeforeSwitch = await page.evaluate(() => window.__credentialStoreCalls);
  await page.select('#mobile-user-name','111');
  assert.equal(await page.evaluate(() => window.__credentialStoreCalls), credentialCallsBeforeSwitch, 'switching saved profiles never stores a password');
  assert.deepEqual(await page.evaluate(() => ({connected:!!document.getElementById('sigaa-form'),user:__loginFormState.form.querySelector('#user').value,pass:__loginFormState.form.querySelector('#pass').value})), {connected:false,user:'',pass:''});
  assert.equal(await page.evaluate(()=>getSelectedProfileUser()),'111');
  assert.equal(await page.$eval('#home-account-select',el=>el.selectedOptions[0].textContent),'Ana Silva');
  assert.deepEqual(await page.$eval('#home-account-select',el=>Array.from(el.options).filter(o=>!o.hidden).map(o=>o.textContent)),['Bruno']);
  const before=scraperCalls;
  await page.evaluate(()=>executarRefreshHeader());
  assert.equal(scraperCalls,before);
  assert.equal(await page.$eval('#user',el=>el.value),'111');
  await page.click('#cancel-account-login');
  await page.screenshot({path:path.join(os.tmpdir(), 'sigaa-profile-mobile.png'),fullPage:true});
  await page.setViewport({width:1366,height:900,isMobile:true,hasTouch:true});
  await page.evaluate(()=>{
    const rows = Array.from({length:40},()=>({disciplina:'Disciplina de teste',data:'09/10/2026',descricao:'Conteúdo de teste'}));
    atividadesGlobais = rows;
    preencherTabelaNovidades(rows);
    preencherTabelaAtividades(rows);
    document.getElementById('calendar-view-checkbox').checked = false;
    applyHomeModeLayout();
    ajustarAlturaNovidades();
  });
  for(const width of [1366,1100]) {
    await page.setViewport({width,height:900,isMobile:true,hasTouch:true});
    const sizes = await page.evaluate(()=>{
      ajustarAlturaNovidades();
      const header = document.getElementById('home-content-header').getBoundingClientRect();
      return ['tabela-novidades-container','tabela-atividades-container'].map(id=>{
        const panel = document.getElementById(id);
        const rect = panel.getBoundingClientRect();
        return {difference:Math.abs(header.bottom-rect.bottom),overflow:panel.scrollHeight>panel.clientHeight};
      });
    });
    assert.ok(sizes.every(size=>size.difference<=2 && size.overflow),JSON.stringify(sizes));
  }
  await page.setViewport({width:1366,height:900,isMobile:true,hasTouch:true});
  await page.screenshot({path:path.join(os.tmpdir(), 'sigaa-profile-desktop.png'),fullPage:true});
  const xss = await page.evaluate(async()=>{
    window.__xss = 0;
    const payload = '<img src="x" onerror="window.__xss=1"><svg onload="window.__xss=1"></svg>';
    renderizarDadosInstitucionais({Nome:payload,Email:payload,Curso:payload,[payload]:payload});
    preencherTabelaNovidades([{disciplina:payload,data:payload,descricao:payload}]);
    preencherTabelaAtividades([{disciplina:payload,data:payload,descricao:payload,entregaMarcada:true,concluida:false}]);
    const item={disciplina:payload,turma:payload,dia:'Segunda-feira',período:payload,slot:payload,horário:'07:00-08:40'};
    preencherTabelaDetalhada([item]);
    preencherTabelaDia(document.getElementById('tabela-horarios-hoje'),[item],[],{enabled:false});
    const disc={disciplina:payload,numeroAulasDefinidas:20,frequencia:[{data:payload,status:'1 Falta '+payload}],porcentagemFrequencia:payload};
    preencherTabelaFrequencias([disc]);
    preencherTabelaFrequencias([disc],payload);
    preencherTabelaNotas([{disciplina:payload,turma:payload,notas:{headers:[payload],valores:[[payload,payload,payload]],avaliacoes:[{abrev:payload,den:payload,nota:payload,peso:payload}]}}]);
    openDisciplinaInfoModal(item);
    const ids=['dados-institucionais','tabela-novidades-home','tabela-atividades-home','tabela-horarios-detalhados','tabela-horarios-hoje','tabela-frequencias','resumo-frequencia-disciplina','tabela-notas-wrapper','disciplina-info-modal'];
    const results=ids.map(id=>{
      const node=document.getElementById(id);
      return {id,text:node.textContent.includes(payload),unsafe:!!node.querySelector('img,svg,[onerror],[onload]')};
    });
    const unsafeUrl = safeHttpUrl('javascript:window.__xss=1');
    document.getElementById('disciplina-info-modal').remove();
    // Restaurar dados reais do fixture antes dos próximos passos de navegação.
    const profile=getProfileByUser('111');aplicarDadosConsulta(profile.data);
    await new Promise(resolve=>setTimeout(resolve,50));
    return {results,executed:window.__xss,unsafeUrl,pdf:typeof window.jspdf.jsPDF==='function' && typeof new window.jspdf.jsPDF().autoTable==='function'};
  });
  assert.ok(xss.results.every(result=>result.text && !result.unsafe),JSON.stringify(xss.results));
  assert.equal(xss.executed,0);assert.equal(xss.unsafeUrl,'');assert.equal(xss.pdf,true);
  const pdf = await page.evaluate(()=>{
    const api = window.jspdf.jsPDF.API, save = api.save;
    let length = 0;
    api.save = function() { length = this.output('arraybuffer').byteLength; return this; };
    try {
      exportarBoletimPDF([{disciplina:'Disciplina de teste',turma:'T1',notas:{headers:['Matrícula','Nome','P1'],valores:[['123','Ana','8.5']],avaliacoes:[{abrev:'P1',den:'Prova',nota:'10',peso:'1'}]}}],{Nome:'Ana Silva',Curso:'Computação'});
      return length;
    } finally { api.save = save; }
  });
  assert.ok(pdf>1000);
  await page.evaluate(()=>{localStorage.setItem('sigaa-show-desktop-profile-select','0');applyDesktopProfileSelectVisibility();});
  assert.equal(await page.$('#home-account-select'),null);
  assert.equal(await page.$eval('.dados-user-name',el=>el.textContent),'Ana Silva');
  page.on('dialog',dialog=>dialog.accept());
  await page.evaluate(()=>executarLogoutAction());
  assert.equal(await hiddenControls(),true);
  assert.equal(await page.$eval('#user',el=>el.autocomplete),'username');
  assert.equal(await page.$eval('#pass',el=>el.autocomplete),'current-password');
  await page.$eval('#user',el=>el.value='');
  await page.$eval('#pass',el=>el.value='');
  await page.type('#user','111');await page.type('#pass','retry password');
  await page.click('#sigaa-form button[type=submit]');
  await page.waitForFunction(()=>getSavedProfiles().length===1 && !document.querySelector('#sigaa-form'));
  await page.evaluate(async()=>{
    cachedCalendarEvents = null;
    await fetchCalendarEvents(obterCursoDoPerfil());
    populateExamSubjects();
  });
  assert.ok((await page.$eval('#exam-subject', el => el.textContent)).includes('(0/6)'));
  const sources = await page.evaluate(()=>[false,true].map(other => {
    const card = createAgendaCard({type:'prova',title:'Prova',manual:true,other});
    return card.querySelector('.exam-source-label').textContent;
  }));
  assert.ok(sources[0].includes('você'));
  assert.ok(sources[1].includes('⚠'));
  await page.evaluate(()=>{
    document.getElementById('exam-subject').value = 'verified-class';
    document.getElementById('exam-title').value = 'Prova de teste';
    document.getElementById('exam-date').value = '2026-11-10';
    document.getElementById('add-exam-form').dispatchEvent(new Event('submit', {bubbles:true,cancelable:true}));
  });
  await page.waitForFunction(()=>document.getElementById('add-exam-status').textContent.includes('sucesso'));
  assert.equal(examWrites, 1);
  await page.waitForFunction(() => cachedCalendarEvents?.some(event => event.manual));
  await page.evaluate(() => {
    tabCalendarSelectedDate = new Date(2026, 10, 10);
    tabCalendarCurrentDate = new Date(2026, 10, 1);
    activateTab('tab-calendario');
    renderTabCalendar();
  });
  assert.equal(await page.$eval('#exam-subject', el => el.options.length), 4, 'all authorized subjects appear, including classes without schedules');
  assert.equal(await page.$eval('#exam-subject', el => el.querySelector('option[value="full-class"]').disabled), true, 'a full class remains visible');
  await page.select('#exam-subject', 'verified-class');
  await page.evaluate(() => populateExamSubjects());
  assert.equal(await page.$eval('#exam-subject', el => el.value), 'verified-class', 'render preserves selected class');
  assert.equal(await page.evaluate(() => !!createAgendaCard({id:'other',manual:true,other:true,title:'Outra prova',type:'prova'}).querySelector('.exam-remove-btn')), false);
  for (const width of [320,390,768,1040,1041,1366,1600]) {
    await page.setViewport({width,height:900});
    await new Promise(resolve => setTimeout(resolve,100));
    await page.evaluate(() => activateTab('tab-calendario'));
    await page.evaluate(() => {
      tabCalendarCurrentDate = new Date(2026, 9, 1);
      tabCalendarSelectedDate = new Date(2026, 9, 12);
      renderTabCalendar();
    });
    await page.screenshot({path:path.join(os.tmpdir(),`sigaa-calendar-${width}.png`),fullPage:true});
    assert.ok(await page.$eval('.tab-calendar-container', el => el.getBoundingClientRect().width > 0 && el.scrollWidth <= el.clientWidth + 1), `calendar overflows at ${width}`);
    assert.equal(await page.$$eval('#tab-calendar-grid .tab-calendar-day', cells => cells.length), 35);
    if (width <= 1040) assert.ok(await page.evaluate(() => {
      const main = document.querySelector('.tab-calendar-main-panel').getBoundingClientRect();
      const grid = document.querySelector('.tab-calendar-layout-grid').getBoundingClientRect();
      return Math.abs(main.width - grid.width) <= 1;
    }), 'mobile and tablet panels should use the full available width');
    if (width > 1040) assert.equal(await page.$$eval('#tab-calendar-grid .tab-calendar-day', cells => new Set(cells.map(cell => Math.round(cell.getBoundingClientRect().height))).size), 1);
    {
      await page.click('#mobile-add-exam-btn');
      const modalFits = await page.$eval('.tab-calendar-form-card', el => {
        const rect = el.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && el.scrollWidth <= el.clientWidth;
      });
      assert.ok(modalFits, `exam dialog overflows at ${width}`);
      await page.screenshot({path:path.join(os.tmpdir(),`sigaa-calendar-dialog-${width}.png`),fullPage:true});
      await page.click('#close-exam-modal-btn');
      assert.equal(await page.evaluate(() => document.body.classList.contains('calendar-dialog-open')), false);
    }
  }
  await page.setViewport({width:390,height:360});
  await page.evaluate(() => activateTab('tab-calendario'));
  await page.click('#mobile-add-exam-btn');
  assert.ok(await page.$eval('.tab-calendar-form-card', el => {
    const rect = el.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight && el.scrollHeight >= el.clientHeight;
  }), 'short-screen dialog stays inside the viewport');
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => !!document.activeElement.closest('.tab-calendar-form-card')));
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.body.classList.contains('calendar-dialog-open')), false);
  await page.setViewport({width:1600,height:900});
  await page.evaluate(() => {
    activateTab('tab-calendario');
    tabCalendarCurrentDate = new Date(2026, 7, 31);
    renderTabCalendar();
  });
  assert.equal(await page.$$eval('#tab-calendar-grid .tab-calendar-day', cells => cells.length), 42, 'six-week months retain their last days');
  await page.click('#tab-calendar-next');
  assert.ok((await page.$eval('#tab-calendar-title', el => el.textContent)).toLowerCase().includes('setembro'), 'navigation on day 31 does not skip a month');
  await page.waitForSelector('.exam-remove-btn', {visible:true});
  await page.click('.exam-remove-btn');
  await page.waitForFunction(() => !cachedCalendarEvents?.some(event => event.manual));
  assert.equal(examWrites, 0);
  const cookieCheck = await page.evaluate(() => ({
    accessible: document.cookie,
    session: JSON.parse(localStorage.getItem('sigaa_session_info')),
    localToken: localStorage.getItem('sigaa_token'),
    sessionToken: sessionStorage.getItem('sigaa_token')
  }));
  assert.ok(!cookieCheck.accessible.includes('sigaa_session'));
  assert.ok(cookieCheck.session.cookie);
  assert.equal(cookieCheck.session.token, undefined);
  assert.equal(cookieCheck.localToken, null);
  assert.equal(cookieCheck.sessionToken, null);
  const beforeReload = scraperCalls;
  await page.evaluate(() => localStorage.removeItem('sigaa_session_info'));
  await page.reload({waitUntil:'networkidle0'});
  assert.ok(await page.evaluate(() => getTokenInfo()?.cookie));
  assert.ok(scraperCalls > beforeReload, 'cookie restores the session without browser storage credentials');
  // A slow refresh must preserve both columns, even if the request fails.
  await page.waitForFunction(() => !__consultaInProgress);
  await page.waitForFunction(() => !document.getElementById('loading-overlay') || getComputedStyle(document.getElementById('loading-overlay')).display === 'none');
  for (const width of [390, 1366]) {
    await page.setViewport({width,height:900});
    await page.evaluate(() => activateTab('tab-home'));
    await new Promise(resolve => setTimeout(resolve, 250));
    const before = await page.$eval('#dados-institucionais', el => ({html:el.innerHTML,height:el.getBoundingClientRect().height}));
    scraperDelay = 1000;
    scraperFailure = width === 1366;
    const calls = scraperCalls;
    await page.evaluate(() => { executarRefreshHeader(); executarRefreshHeader(); });
    await page.waitForFunction(() => document.getElementById('home-content').getAttribute('aria-busy') === 'true');
    const during = await page.$eval('#dados-institucionais', el => ({html:el.innerHTML,height:el.getBoundingClientRect().height}));
    assert.deepEqual(during, before, 'institutional data must not collapse while refreshing');
    assert.equal(await page.$eval('#loading-overlay', el => el.parentElement.id), 'home-content');
    await page.waitForFunction(() => !__consultaInProgress);
    assert.equal(scraperCalls, calls + 1, 'duplicate refresh is ignored');
    if (scraperFailure) assert.equal(await page.$eval('#dados-institucionais', el => el.innerHTML), before.html);
    assert.equal(await page.$eval('#home-content', el => el.hasAttribute('aria-busy')), false);
    assert.equal(await page.evaluate(() => __loginFormState?.form.querySelector('#loading-overlay')?.parentElement.id), 'sigaa-form');
    assert.equal(await page.$('#sigaa-form'), null, 'refresh must not restore password-manager credential fields');
  }
  scraperDelay = 0;
  scraperFailure = false;
  const calendarChecks = await page.evaluate(async () => {
    const original = fetchApi;
    let calls = 0;
    const holiday = { data: '2026-10-12', titulo: 'Feriado de teste', tipo: 'feriado' };
    try {
      cachedCalendarEvents = null;
      fetchApi = async () => {
        calls++;
        await new Promise(resolve => setTimeout(resolve, 50));
        return { ok: true, json: async () => ({ eventos: [holiday], turmas: [] }) };
      };
      const both = await Promise.all([fetchCalendarEvents('computacao'), fetchCalendarEvents('computacao')]);
      const shared = calls === 1 && both.every(events => events?.[0]?.tipo === 'feriado');
      cachedCalendarEvents = null;
      calls = 0;
      fetchApi = async () => { calls++; throw new Error('Temporary test outage'); };
      await fetchCalendarEvents('computacao');
      const retryable = cachedCalendarEvents === null && calls === 3;
      calls = 0;
      fetchApi = async (endpoint, options) => {
        calls++;
        if (options.credentials !== 'omit') return { ok: false, status: 409 };
        return { ok: true, json: async () => ({ eventos: [holiday, {...holiday, manual: true}], turmas: [{ id: 'private' }] }) };
      };
      const publicEvents = await fetchCalendarEvents('computacao');
      const publicOnly = calls === 2 && publicEvents.length === 1 && verifiedExamClasses.length === 0;
      invalidateCalendarEvents();
      let releaseOld;
      fetchApi = async () => {
        await new Promise(resolve => { releaseOld = resolve; });
        return {ok:true,json:async()=>({eventos:[],turmas:[]})};
      };
      const oldRequest = fetchCalendarEvents('computacao');
      invalidateCalendarEvents();
      fetchApi = async () => ({ok:true,json:async()=>({eventos:[holiday],turmas:[{id:'new-class',disciplina:'Nova matéria',turma:'01',semestre:'2026.2',provasCadastradas:0}]})});
      await fetchCalendarEvents('computacao');
      releaseOld();
      await oldRequest;
      const staleSafe = verifiedExamClasses.length === 1 && verifiedExamClasses[0].id === 'new-class' && cachedCalendarEvents.length === 1;
      return {shared, retryable, publicOnly, staleSafe};
    } finally { fetchApi = original; cachedCalendarEvents = null; }
  });
  assert.deepEqual(calendarChecks, {shared:true,retryable:true,publicOnly:true,staleSafe:true});
  assert.deepEqual(await page.evaluate(()=>window.__cspViolations || []),[]);
  const blocked = await page.evaluate(async () => {
    window.__injectedScript = 0;
    const script = document.createElement('script');
    script.textContent = 'window.__injectedScript = 1';
    document.head.appendChild(script);
    const button = document.createElement('button');
    button.setAttribute('onclick', 'window.__injectedScript = 2');
    document.body.appendChild(button); button.click();
    await new Promise(resolve => setTimeout(resolve, 50));
    script.remove(); button.remove();
    return { executed: window.__injectedScript, violations: window.__cspViolations || [] };
  });
  assert.equal(blocked.executed, 0);
  assert.ok(blocked.violations.some(value => value.startsWith('script-src')));
  assert.deepEqual(errors,[]);
  console.log('PASS: login hints, success signal, one/two profiles, add/cancel, swap, token ownership, mobile/desktop, preference off; no JS errors.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exit(1)});
