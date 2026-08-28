// Minimal markdown renderer: headers, bold, italic, tables, lists, hr, paragraphs.
// Kept dependency-free so the PWA works fully offline once cached.
function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let i = 0;

  function inline(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/&lt;strong&gt;/g, '<strong>').replace(/&lt;\/strong&gt;/g, '</strong>')
      .replace(/&lt;em&gt;/g, '<em>').replace(/&lt;\/em&gt;/g, '</em>')
      .replace(/&lt;code&gt;/g, '<code>').replace(/&lt;\/code&gt;/g, '</code>');
  }

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { i++; continue; }

    if (/^---+\s*$/.test(line)) { html += '<hr>'; i++; continue; }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      html += `<h${level}>${inline(h[2])}</h${level}>`;
      i++; continue;
    }

    // Table: header row + separator row
    if (/^\s*\|/.test(line) && lines[i + 1] && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const headerCells = line.split('|').map(c => c.trim()).filter(c => c.length);
      let body = '<table><thead><tr>' +
        headerCells.map(c => `<th>${inline(c)}</th>`).join('') +
        '</tr></thead><tbody>';
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = lines[i].split('|').map(c => c.trim()).filter((c, idx, arr) => !(idx === 0 && c === '') && !(idx === arr.length - 1 && c === ''));
        body += '<tr>' + cells.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>';
        i++;
      }
      body += '</tbody></table>';
      html += body;
      continue;
    }

    // Unordered list
    if (/^\s*-\s+/.test(line)) {
      let list = '<ul>';
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        list += `<li>${inline(lines[i].replace(/^\s*-\s+/, ''))}</li>`;
        i++;
      }
      list += '</ul>';
      html += list;
      continue;
    }

    // Paragraph (collect until blank line)
    let para = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i]) && !/^\s*-\s+/.test(lines[i]) && !/^---+\s*$/.test(lines[i]) && !/^\s*\|/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    html += `<p>${inline(para.join(' '))}</p>`;
  }

  return html;
}
