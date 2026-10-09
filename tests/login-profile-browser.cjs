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
let loginUser = '', scraperCalls = 0;
function data(name) {
  return { dadosInstitucionais: { Nome: name, 'Matrícula': '123456', Curso: 'Engenharia da Computação', Email: 'teste@example.test' },
    horariosDetalhados: [], horariosSimplificados: [], avisosPorDisciplina: [], atividadesPortal: [] };
}
app.get('/', (req,res) => res.send(fs.readFileSync(path.join(frontend,'index.html'),'utf8')));
process.env.SECRET = 'browser-test-only-secret';
process.env.ENC_SECRET = 'a'.repeat(32);
process.env.ENC_SECRET_USER = 'b'.repeat(32);
process.env.TOKEN_REVOCATION_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sigaa-browser-revocations-'));
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
  res.json(data(loginUser === '222' ? 'Bruno Lima' : 'Ana Silva'));
});
app.post('/api/logout', require(path.join(backend, 'api/logout')));
app.get('/api/queue-status',(req,res)=>res.json({position:1,avgTimeMs:1000}));
app.get('/api/scraper-progress',(req,res)=>res.json({progress:100,status:'Concluído'}));
app.get('/api/calendario',(req,res)=>res.json({link:'https://example.test/calendar.pdf'}));
let examWrites = 0;
const examClass = { id: 'verified-class', disciplina: 'Matemática', turma: '01', semestre: '2026.2', provasCadastradas: 0 };
app.get('/api/calendario/eventos',(req,res)=>res.json({eventos:[], turmas: browserSession.cookieToken(req) ? [{ ...examClass, provasCadastradas: examWrites }] : []}));
app.post('/api/calendario/eventos',(req,res)=>{
  assert.ok(browserSession.cookieToken(req));
  assert.equal(req.body.turmaId, 'verified-class');
  assert.equal(req.body.disciplina, undefined);
  examWrites++;
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
  page.on('request',request=>request.url().startsWith('http://127.0.0.1:')?request.continue():request.abort());
  await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle0'});
  await page.evaluate(()=>{navigator.credentials.store=async credential=>{window.__storedCredential={id:credential.id,password:credential.password};return credential;};});
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
      assert.equal(layout.overflow,'auto');
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
  await page.click('#sigaa-form button[type=submit]');
  await page.waitForFunction(()=>document.querySelector('#home-account-select') && !document.querySelector('#sigaa-form'));
  await page.waitForSelector('#home-account-select',{visible:true});
  let options=await page.$eval('#home-account-select',el=>Array.from(el.options).filter(o=>!o.hidden).map(o=>o.textContent));
  assert.deepEqual(options,['Adicionar conta']);
  assert.equal(await page.evaluate(()=>getTokenInfo().user),'111');
  assert.deepEqual(await page.evaluate(()=>window.__storedCredential),{id:'111',password:' test password '});
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
  await page.click('#cancel-account-login');
  assert.equal(await page.evaluate(()=>document.body.classList.contains('adding-account')),false);
  await page.select('#home-account-select','__add_account__');
  await page.$eval('#user',el=>el.value='');
  await page.$eval('#pass',el=>el.value='');
  await page.type('#user','222');await page.type('#pass','another password');
  await page.click('#sigaa-form button[type=submit]');
  await page.waitForFunction(()=>getSavedProfiles().length===2 && !document.querySelector('#sigaa-form'));
  options=await page.$eval('#home-account-select',el=>Array.from(el.options).filter(o=>!o.hidden).map(o=>o.textContent));
  assert.deepEqual(options,['Ana']);
  await page.select('#home-account-select','111');
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
