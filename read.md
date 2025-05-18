# Consulta SIGAA - WebApp

Este projeto é um aplicativo web moderno para consulta rápida, segura e offline de horários, frequências, notas e novidades do SIGAA (Sistema Integrado de Gestão de Atividades Acadêmicas).

## Funcionalidades

- **Login seguro:** Seus dados nunca ficam salvos no navegador, apenas o token de acesso.
- **Consulta de horários:** Visualize horários detalhados e simplificados por dia da semana.
- **Frequências:** Veja sua presença, faltas e cálculo automático de limites.
- **Notas:** Tabelas organizadas por disciplina, com detalhes de avaliações e filtros.
- **Novidades:** Avisos e notícias recentes das disciplinas.
- **PWA:** Funciona offline, pode ser instalado no celular ou computador.
- **Modo "sem dados":** Interface adaptada para novos usuários ou sem dados salvos.
- **Atualização automática:** Sempre que abrir, tenta atualizar seus dados usando o login salvo.

## Como usar

1. **Abra o app em seu navegador** (preferencialmente Chrome ou Edge).
2. **Faça login** com seu CPF e senha do SIGAA.
3. **Escolha se deseja manter logado** (opcional).
4. **Navegue pelas abas**: Home, Tabela Simplificada, Horários, Frequências, Notas e Novidades.
5. **No mobile**, a interface é adaptada e novidades da home são ocultadas para melhor experiência.

## Instalação como PWA

- No Chrome/Edge, clique no ícone de instalação na barra de endereços ou no menu.
- O app funcionará offline após o primeiro acesso.

## Segurança

- O login é feito diretamente com a API, e apenas o token é salvo localmente.
- Nenhuma senha ou dado sensível é armazenado no navegador.
- Você pode sair a qualquer momento clicando em "Sair".

## Tecnologias

- HTML5, CSS3, JavaScript (ES6)
- Service Worker (PWA)
- API SIGAA (backend externo)

## Estrutura de Pastas

├── index.html 
├── style.css 
├── script.js 
├── manifest.json 
├── service-worker.js 
├── icon-web.png 
├── icon-192.png 
├── icon-512.png


## Bugs conhecidos

- O tamanho do bloco de dados institucionais pode diminuir após uma nova pesquisa (verificar ajuste de altura).

## Contribuição

Pull requests são bem-vindos! Sinta-se à vontade para sugerir melhorias ou reportar bugs.

---

**Desenvolvido por Henrique de Freitas Araújo**