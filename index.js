// index.js
const readline = require('readline');
const { runScraper, viewSchedule } = require('./scraper');
const { gerarTabelaSimplificada } = require('./scheduleParser');

(async () => {
  const { browser, page } = await runScraper();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\nO que você deseja fazer?');
  console.log('1) Ver notas');
  console.log('2) Ver horários');
  console.log('3) Ver frequência');

  rl.question('Selecione uma opção (1-3): ', async (answer) => {
    if (answer.trim() === '2') {
      await viewSchedule(page);
      await gerarTabelaSimplificada();
    } else {
      console.log('Opção ainda não implementada.');
    }
    rl.close();
    await browser.close();
  });
})();
