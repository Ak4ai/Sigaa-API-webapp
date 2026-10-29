# Consulta SIGAA – Web app

Aplicativo web (**PWA**) para consultar de forma rápida e offline os horários, frequências, notas, calendário e novidades do SIGAA do CEFET-MG. É o front-end do projeto de extensão **SAFE – Sistema de Acompanhamento Familiar do Estudante**.

🌐 **Demo:** [ak4ai.github.io/Sigaa-API-webapp](https://ak4ai.github.io/Sigaa-API-webapp/)  
⚙️ **Back-end:** [sigaa-api-backend](https://github.com/Ak4ai/sigaa-api-backend)

> Projeto acadêmico e não oficial. O login usa as credenciais do próprio SIGAA, que são enviadas apenas ao back-end do projeto.

## Funcionalidades

- **Horários** detalhados e em tabela simplificada, por dia da semana.
- **Frequências** com faltas e cálculo automático dos limites.
- **Notas** organizadas por disciplina, com detalhes de avaliações e filtros, e **exportação do boletim em PDF**.
- **Calendário** acadêmico e agenda de eventos.
- **Novidades** e avisos das disciplinas.
- **Modo offline:** funciona sem internet depois do primeiro acesso e pode ser instalado no celular ou no computador.
- **Cache inteligente:** dados institucionais (24 h), horários (6 h) e novidades e frequências (30 a 60 min), com consulta progressiva e uso do cache se a rede falhar (veja [`PERFORMANCE_OPTIMIZATIONS.md`](PERFORMANCE_OPTIMIZATIONS.md)).

## Segurança

- **Sessão no servidor:** o navegador guarda só um cookie `HttpOnly`. Senha e usuário **não ficam salvos** no navegador.
- **CSRF:** toda requisição que altera estado envia um token `X-CSRF-Token`.
- **Conteúdo do SIGAA** é exibido com `textContent` (ou escapado) para evitar injeção de HTML.
- Bibliotecas de PDF distribuídas junto do app (`vendor/`), com versões e licenças registradas.

## Como usar

1. Abra o app (Chrome ou Edge, de preferência).
2. Entre com seu CPF e senha do SIGAA e escolha se quer manter a sessão.
3. Navegue pelas abas: Home, Tabela simplificada, Horários, Frequências, Notas, Calendário e Novidades.
4. Para instalar, use o ícone de instalação na barra de endereços (ou o menu do navegador).

## Rodando localmente

Não tem etapa de build. Sirva a pasta com um servidor estático e aponte para um back-end em execução:

```bash
python -m http.server 3000
```

## Testes

```bash
node --test tests/session-security.test.js     # segurança da sessão
node tests/login-profile-browser.cjs           # fluxo de login e perfil no navegador
```

## Tecnologias

HTML5, CSS3 e JavaScript (ES6), Service Worker e manifesto PWA, jsPDF para o PDF do boletim.

## Estrutura

```
index.html · style.css · script.js     Interface e lógica
boletim.js                             Exportação do boletim em PDF
service-worker.js · pwa.js · manifest.json   PWA e offline
vendor/                                jsPDF e jsPDF-AutoTable (com licenças)
tests/                                 Testes de sessão e de login
```

---

Feito por [Henrique de Freitas Araújo](https://github.com/Ak4ai) no CEFET-MG, Campus Divinópolis.
