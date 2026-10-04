// Throwaway: the classic 1+1+1 drawn in a quieter style, injected into every .topo.
function topo(o = {}) {
  const crashed = !!o.crashed, sel = o.sel;
  const dc = (x, y, w, h, name) => `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="#F7F9FB" stroke="#E4E9EF"/>
    <text x="${x + 14}" y="${y + 20}" font-size="11" font-weight="600" fill="#6E7F93" font-family="system-ui">${name}</text>`;
  const card = (x, y, w, name, host, role, col, fill, glyph, extra = '', isSel = false, down = false) => `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="56" rx="10" fill="${down ? '#FFF6F6' : '#fff'}"
        stroke="${isSel ? '#2563EB' : down ? '#D64545' : '#DCE2EA'}" stroke-width="${isSel ? 2 : 1}"
        ${down ? 'stroke-dasharray="4 3"' : ''} filter="url(#sh)"/>
      <circle cx="${x + 26}" cy="${y + 28}" r="14" fill="${down ? '#FADEDE' : fill}"/>
      <text x="${x + 26}" y="${y + 32.5}" text-anchor="middle" font-size="12" font-weight="700" fill="${down ? '#D64545' : col}" font-family="system-ui">${glyph}</text>
      <text x="${x + 50}" y="${y + 24}" font-size="13.5" font-weight="650" fill="#101922" font-family="system-ui">${name}</text>
      <text x="${x + 50}" y="${y + 41}" font-size="11" fill="#6E7F93" font-family="ui-monospace,monospace">${host}</text>
      <text x="${x + w - 12}" y="${y + 24}" text-anchor="end" font-size="10.5" font-weight="600" fill="${down ? '#D64545' : col}" font-family="system-ui">${down ? 'DOWN' : role}</text>
      ${extra}
    </g>`;
  const label = (x, y, t, strong) => {
    const w = t.length * 6.1 + 16;
    return `<rect x="${x - w / 2}" y="${y - 10}" width="${w}" height="20" rx="10" fill="#fff" stroke="#E4E9EF"/>
      <text x="${x}" y="${y + 4}" text-anchor="middle" font-size="11" fill="${strong || '#46566A'}" font-family="ui-monospace,monospace">${t}</text>`;
  };
  return `<svg viewBox="0 0 900 290" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="sh" x="-10%" y="-20%" width="120%" height="160%"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#101922" flood-opacity=".07"/></filter>
      <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="${crashed ? '#BFC9D6' : '#0E7C6B'}"/></marker>
    </defs>
    ${dc(20, 150, 230, 116, 'DC1')}${dc(650, 150, 230, 116, 'DC2')}${dc(335, 14, 230, 104, 'DC3')}
    <path d="M351 72 H135 V180" fill="none" stroke="#6D5AE6" stroke-width="1.3" stroke-dasharray="2 4" stroke-linecap="round" opacity="${crashed ? .35 : 1}"/>
    <path d="M549 72 H765 V180" fill="none" stroke="#6D5AE6" stroke-width="1.3" stroke-dasharray="2 4" stroke-linecap="round"/>
    <path d="M226 208 H664" fill="none" stroke="${crashed ? '#BFC9D6' : '#0E7C6B'}" stroke-width="1.8" marker-end="url(#ar)"/>
    ${label(445, 208, 'SYNC · 5 ms', crashed ? '#6E7F93' : '#0E7C6B')}
    ${label(240, 72, 'ping 5 ms')}${label(660, 72, 'ready 5 ms')}
    ${card(36, 180, 198, 'prm01', 'dc1-prm01', 'PRIMARY', '#0E7C6B', '#D5EDE8', 'P', '', sel === 'prm01', crashed)}
    ${card(666, 180, 198, 'sby01', 'dc2-sby01', 'STANDBY', '#2563EB', '#DBE6FE', 'S', '', sel === 'sby01')}
    ${card(351, 44, 198, 'obs01', 'dc3-obs01', 'MASTER', '#6D5AE6', '#E3DFFB', '◉')}
  </svg>`;
}
document.querySelectorAll('.topo').forEach(el => {
  el.innerHTML = topo({ crashed: el.dataset.crashed === '1', sel: el.dataset.sel });
});
