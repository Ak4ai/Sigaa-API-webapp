function exportarBoletimPDF(notasGlobais, dadosInstitucionais = null) {
  if (!notasGlobais || notasGlobais.length === 0) {
    alert('Nenhuma nota encontrada.');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // Cabeçalho com dados institucionais
  let y = 15;
  doc.setFontSize(14);
  doc.text('Boletim de Notas', 105, y, { align: 'center' });
  y += 8;
  if (dadosInstitucionais) {
    doc.setFontSize(9);
    // Campos principais e nomes amigáveis
    const camposPrincipais = [
      { chave: 'Nome', label: 'Nome' },
      { chave: 'Matrícula', label: 'Matrícula' },
      { chave: 'Curso', label: 'Curso' },
      { chave: 'E-Mail', label: 'E-mail' },
      { chave: 'Entrada', label: 'Entrada' },
      { chave: 'Semestre', label: 'Semestre' },
      { chave: 'Status', label: 'Status' },
      { chave: 'Nível', label: 'Nível' },
      { chave: 'CH. Total Currículo', label: 'CH Total' },
      { chave: 'CH. Obrigatória Pendente', label: 'CH Obrigatória Pend.' },
      { chave: 'CH. Optativa Pendente', label: 'CH Optativa Pend.' },
      { chave: 'CH. Flexibilizada Pendente', label: 'CH Flexibilizada Pend.' },
      { chave: 'CH. Complementar Pendente', label: 'CH Complementar Pend.' }
    ];
    // Monta pares label:valor apenas para os campos relevantes e que existam
    const pares = camposPrincipais
      .filter(c => dadosInstitucionais[c.chave] && dadosInstitucionais[c.chave] !== '-')
      .map(c => ({ label: c.label, valor: dadosInstitucionais[c.chave] }));

    // Layout: até 2 colunas por linha, box centralizada
    const larguraBox = 180;
    const espacamentoCol = 45; // espaço horizontal entre colunas (ajustado para centralizar)
    const margemEsq = (doc.internal.pageSize.getWidth() - larguraBox) / 2;
    let col = 0;
    let x = margemEsq + 8;
    // Para desenhar a box, precisamos saber a altura ocupada
    const yBoxStart = y;
    let yBoxEnd = y;
    const larguraCol = 105; // largura máxima de texto por coluna
    pares.forEach((par, idx) => {
      const texto = `${par.label}: ${par.valor}`;
      // Quebra o texto para não ultrapassar a largura da coluna
      let linhas = doc.splitTextToSize(texto, larguraCol);
      // Limita a 2 linhas, truncando a última com '...'
      if (linhas.length > 2) {
        linhas = [linhas[0], linhas[1]];
        // Trunca a segunda linha para caber '...'
        let maxWidth = larguraCol;
        let txt = linhas[1];
        while (doc.getTextWidth(txt + '...') > maxWidth && txt.length > 0) {
          txt = txt.slice(0, -1);
        }
        linhas[1] = txt + '...';
      }
      linhas.forEach((linha, i) => {
        doc.text(linha, x, yBoxEnd);
        if (i < linhas.length - 1) yBoxEnd += 5;
      });
      col++;
      if (col === 2) {
        yBoxEnd += 6;
        x = margemEsq + 8;
        col = 0;
      } else {
        x += espacamentoCol;
      }
    });
    if (col !== 0) yBoxEnd += 6; // avança linha se terminou em coluna ímpar
    // Desenha a box ao redor dos dados institucionais, centralizada
    const alturaBox = yBoxEnd - yBoxStart + 4;
    doc.setDrawColor(41, 128, 185);
    doc.setLineWidth(0.5);
    doc.roundedRect(margemEsq, yBoxStart - 4, larguraBox, alturaBox, 3, 3, 'S');
    y = yBoxEnd + 10; // margem inferior maior para não colapsar
  } else {
    y += 8;
  }

  // Função auxiliar para limitar texto a 2 linhas e cortar com ...
  function limitarTexto(texto, maxLenPorLinha, maxLinhas) {
    if (!texto) return '';
    let linhas = [];
    let resto = texto;
    for (let i = 0; i < maxLinhas; i++) {
      if (resto.length <= maxLenPorLinha) {
        linhas.push(resto);
        resto = '';
        break;
      } else {
        linhas.push(resto.slice(0, maxLenPorLinha));
        resto = resto.slice(maxLenPorLinha);
      }
    }
    if (resto.length > 0) {
      linhas[linhas.length - 1] = linhas[linhas.length - 1].slice(0, -3) + '...';
    }
    return linhas.join('\n');
  }

  // Defina o tamanho máximo de caracteres por linha para cada coluna
  const colMaxLens = [10, 30, 10, 6, 10];
  const maxLinhas = 2;

  notasGlobais.forEach(disc => {
    if (!disc.notas || !disc.notas.avaliacoes || disc.notas.avaliacoes.length === 0) return;

    doc.setFontSize(12);
    doc.text(`${disc.disciplina}${disc.turma ? ' - ' + disc.turma : ''}`, 14, y);

    // Monta os dados da tabela
    const linhaAluno = disc.notas.valores[0];
    const tableData = disc.notas.avaliacoes.map((av, idx) => {
      let idxHeader = disc.notas.headers.findIndex(h => h === av.abrev);
      if (idxHeader === -1) idxHeader = idx;
      let suaNota = (linhaAluno && linhaAluno[idxHeader + 2]) ? linhaAluno[idxHeader + 2] : '';
      return [
        limitarTexto(av.abrev, colMaxLens[0], maxLinhas),
        limitarTexto(av.den, colMaxLens[1], maxLinhas),
        limitarTexto(av.nota, colMaxLens[2], maxLinhas),
        limitarTexto(av.peso, colMaxLens[3], maxLinhas),
        limitarTexto(suaNota, colMaxLens[4], maxLinhas)
      ];
    });


    // Largura máxima útil do PDF (A4, margem 14px cada lado)
    // jsPDF padrão: 210mm - 28mm = 182mm, 1mm = 2.8346pt => ~515pt
    // Mas jsPDF trabalha em pt, então:
    const larguraUtil = doc.internal.pageSize.getWidth() - 28; // 14px margem cada lado
    // Porcentagens: Sigla 15%, Descrição 40%, Nota Total 15%, Peso 10%, Sua Nota 20%
    const colWidths = [0.15, 0.40, 0.15, 0.10, 0.20].map(p => p * larguraUtil);

    doc.autoTable({
      head: [['Sigla', 'Descrição', 'Nota Total', 'Peso', 'Sua Nota']],
      body: tableData,
      startY: y + 4,
      theme: 'grid',
      headStyles: { fillColor: [41, 128, 185], textColor: 255, halign: 'center' },
      bodyStyles: { halign: 'center', valign: 'middle' },
      margin: { left: 14, right: 14 },
      styles: { fontSize: 10 },
      columnStyles: {
        0: { cellWidth: colWidths[0] }, // Sigla 15%
        1: { cellWidth: colWidths[1] }, // Descrição 40%
        2: { cellWidth: colWidths[2] }, // Nota Total 15%
        3: { cellWidth: colWidths[3] }, // Peso 10%
        4: { cellWidth: colWidths[4] }  // Sua Nota 20%
      },
      didParseCell: function (data) {
        // Garante que o texto não passe de 2 linhas visualmente
        if (typeof data.cell.raw === 'string' && data.cell.raw.split('\n').length > 2) {
          data.cell.text = data.cell.raw.split('\n').slice(0, 2);
        }
      }
    });

    y = doc.lastAutoTable.finalY + 10;
    if (y > 250) { doc.addPage(); y = 20; }
  });

  doc.save('boletim_sigaa.pdf');
}