// Token Launch Radar: renders the pre-token board, the live-token comps view, the method page
// and one protocol's detail view, from window.RADAR (data.js, written by main.ts). No network,
// no fetch: every byte the page needs is already in the snapshot-derived data.
//
// Views are hash-addressable, so each screenshot is one URL state:
//   (no hash)            the board
//   #protocol=<slug>     one protocol's detail view
//   #filter=<category>   the board filtered to a category
//   #tab=live | #tab=method   the other tabs

(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) {
    document.getElementById('lede').textContent = 'data.js did not load: the dashboard needs its snapshot-derived data beside it.';
    return;
  }

  var state = { tab: 'board', q: '', category: 'all', chain: 'all', watchonly: false, sort: 'implied', dir: -1, selected: null };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function money(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function num(n, d) { return n === null || n === undefined ? '—' : n.toFixed(d === undefined ? 2 : d); }

  function parseHash() {
    var h = window.location.hash.slice(1);
    var parts = h ? h.split('&') : [];
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      var k = decodeURIComponent(kv[0] || '');
      var v = decodeURIComponent(kv[1] || '');
      if (k === 'protocol' && v) state.selected = v;
      if (k === 'filter' && v) state.category = v;
      if (k === 'tab' && (v === 'live' || v === 'method' || v === 'board')) state.tab = v;
      if (k === 'watchlist' && v === '1') state.watchonly = true;
    }
  }
  function writeHash() {
    var bits = [];
    if (state.selected) bits.push('protocol=' + encodeURIComponent(state.selected));
    if (state.category !== 'all') bits.push('filter=' + encodeURIComponent(state.category));
    if (state.tab !== 'board') bits.push('tab=' + state.tab);
    if (state.watchonly) bits.push('watchlist=1');
    var h = bits.length ? '#' + bits.join('&') : '';
    if (window.location.hash !== h) window.history.replaceState(null, '', h || window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchonly && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    var dir = state.dir;
    var val = function (r) {
      if (key === 'rank') return r.rank;
      if (key === 'name') return r.name.toLowerCase();
      if (key === 'category') return (r.category || 'Other').toLowerCase();
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
      if (key === 'comps') return r.comps_multiple;
      return r.implied_value_usd;
    };
    return list.slice().sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.slug < b.slug ? -1 : 1;
    });
  }

  function renderStats() {
    var top = DATA.rows[0];
    var stats = [
      [DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'Watchlist covered'],
      [String(DATA.board_size), 'Pre-token protocols ranked'],
      [num(DATA.global_comps, 2) + '×', 'Snapshot-wide median FDV / TVL'],
      [top ? money(top.implied_value_usd) : '—', 'Top implied value' + (top ? ' · ' + top.name : '')],
    ];
    var box = $('stats');
    box.innerHTML = '';
    stats.forEach(function (s) {
      var d = el('div', 'stat');
      d.appendChild(el('b', null, s[0]));
      d.appendChild(el('span', null, s[1]));
      box.appendChild(d);
    });
    $('lede').textContent =
      'Snapshot as of ' + DATA.as_of + ': ' + DATA.board_size + ' protocols that record no token, ranked by ' +
      'what a token would be worth if the record stayed as it is. The watchlist is the floor — ' +
      DATA.watchlist_size + ' protocols at or above $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL — and the early radar adds every other rankable pre-token protocol below it.';
    $('asof').textContent = DATA.as_of;
    $('formula').textContent = DATA.model_formula + '  ·  model ' + DATA.model_version +
      '. Comps: category median FDV/TVL (min 3 live comps, else the snapshot-wide median ' + num(DATA.global_comps, 3) + '×).';
  }

  function fillSelects() {
    var cats = {}, chains = {};
    DATA.rows.forEach(function (r) {
      cats[r.category || 'Other'] = true;
      r.chains.forEach(function (c) { chains[c] = true; });
    });
    var cs = $('category'), hs = $('chain');
    Object.keys(cats).sort().forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c; cs.appendChild(o);
    });
    Object.keys(chains).sort().forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c; hs.appendChild(o);
    });
    cs.value = state.category;
    hs.value = state.chain;
  }

  function renderBoard() {
    var list = sortedRows(visibleRows());
    $('count').textContent = list.length + ' of ' + DATA.rows.length + ' protocols' +
      (state.category !== 'all' ? ' · category ' + state.category : '') +
      (state.watchonly ? ' · watchlist only' : '') + '. Sorted by ' + state.sort + '.';
    var tb = $('rows');
    tb.innerHTML = '';
    if (!list.length) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = 8; td.className = 'empty'; td.textContent = 'No protocol matches that filter.';
      tr.appendChild(td); tb.appendChild(tr);
      return;
    }
    list.forEach(function (r) {
      var tr = document.createElement('tr');
      if (state.selected === r.slug) tr.className = 'sel';
      tr.addEventListener('click', function () { select(r.slug); });
      var cells = [
        { t: '#' + r.rank, c: 'num' },
        { t: null },
        { t: r.category || 'Other' },
        { t: r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') },
        { t: money(r.tvl_usd), c: 'num' },
        { t: pct(r.change_7d), c: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down') },
        { t: money(r.implied_value_usd), c: 'num' },
        { t: num(r.comps_multiple, 2) + '×', c: 'num' },
      ];
      cells.forEach(function (cell, i) {
        var td = document.createElement('td');
        if (cell.c) td.className = cell.c;
        if (i === 1) {
          td.appendChild(el('span', 'nm', r.name));
          if (r.watchlist) td.appendChild(el('span', 'wl', 'WATCHLIST'));
        } else if (cell.t !== null) {
          td.textContent = cell.t;
        }
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
  }

  function renderLive() {
    var tb = $('live-rows');
    tb.innerHTML = '';
    DATA.live.forEach(function (r) {
      var tr = document.createElement('tr');
      [r.name, r.category || 'Other', r.chains.slice(0, 2).join(', '), money(r.tvl_usd), money(r.mcap_usd), r.fdv_tvl === null ? '—' : num(r.fdv_tvl, 2) + '×'].forEach(function (t, i) {
        var td = document.createElement('td');
        if (i >= 3) td.className = 'num';
        td.textContent = t;
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
  }

  function renderComps() {
    var tb = $('comps-rows');
    tb.innerHTML = '';
    DATA.comps.forEach(function (c) {
      var tr = document.createElement('tr');
      [c.category, String(c.n), num(c.multiple, 3) + '×'].forEach(function (t, i) {
        var td = document.createElement('td');
        if (i > 0) td.className = 'num';
        td.textContent = t;
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
  }

  function bar(label, value, lo, hi) {
    var row = el('div', 'fbar');
    row.appendChild(el('span', null, label));
    var track = el('div', 'track');
    var fill = el('div', 'fill');
    fill.style.width = Math.round(100 * Math.min(1, Math.max(0, (value - lo) / (hi - lo)))) + '%';
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el('span', 'val', num(value, 2) + '×'));
    return row;
  }

  function renderDetail() {
    var box = $('detail');
    var r = null;
    if (state.selected) {
      for (var i = 0; i < DATA.rows.length; i++) {
        if (DATA.rows[i].slug === state.selected) { r = DATA.rows[i]; break; }
      }
    }
    if (!r) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '';
    var close = el('button', 'btn close', 'Close');
    close.type = 'button';
    close.addEventListener('click', function () { select(null); });
    box.appendChild(close);
    box.appendChild(el('h2', null, '#' + r.rank + ' · ' + r.name + (r.watchlist ? '  ★ watchlist' : '')));
    box.appendChild(el('p', 'sub',
      'Implied value ' + money(r.implied_value_usd) + ' · TVL ' + money(r.tvl_usd) +
      ' · 7d ' + pct(r.change_7d) + ' · ' + (r.category || 'Other') + ' · ' + r.chains.join(', ') +
      ' · tracked since ' + (r.listed_at || 'unknown') + ' (' + (r.age_days === null ? 'age unknown' : r.age_days + ' days') + ')' +
      ' · records no token.'));
    box.appendChild(el('h3', null, 'Model factors'));
    box.appendChild(bar('Comps', r.comps_multiple, 0, 2));
    box.appendChild(bar('Scale', r.scale_factor, 0.4, 0.95));
    box.appendChild(bar('Growth', r.growth_factor, 0.55, 1.45));
    box.appendChild(bar('Maturity', r.maturity_factor, 0.55, 1));
    var math = el('p', 'math',
      money(r.tvl_usd) + ' TVL × ' + num(r.scale_factor, 2) + ' scale × ' + num(r.comps_multiple, 2) +
      ' comps × ' + num(r.growth_factor, 2) + ' growth × ' + num(r.maturity_factor, 2) +
      ' maturity = ' + money(r.implied_value_usd));
    box.appendChild(math);
    box.appendChild(el('h3', null, 'Farm plan — 7 steps'));
    var ol = el('ol', 'steps');
    (r.farm_steps || []).forEach(function (s) {
      ol.appendChild(el('li', null, s));
    });
    box.appendChild(ol);
  }

  function select(slug) {
    state.selected = slug;
    writeHash();
    renderBoard();
    renderDetail();
  }

  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    $('view-board').hidden = tab !== 'board';
    $('view-live').hidden = tab !== 'live';
    $('view-method').hidden = tab !== 'method';
    writeHash();
  }

  function render() {
    renderBoard();
    renderDetail();
  }

  // Wire controls.
  document.querySelectorAll('.tab').forEach(function (b) {
    b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); });
  });
  document.querySelectorAll('th button[data-sort]').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = k === 'name' || k === 'category' ? 1 : -1; }
      renderBoard();
    });
  });
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  $('category').addEventListener('change', function (e) { state.category = e.target.value; writeHash(); renderBoard(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  $('watchonly').addEventListener('change', function (e) { state.watchonly = e.target.checked; writeHash(); renderBoard(); });
  $('clear').addEventListener('click', function () {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchonly = false; state.selected = null;
    $('q').value = ''; $('category').value = 'all'; $('chain').value = 'all'; $('watchonly').checked = false;
    writeHash(); render();
  });
  window.addEventListener('hashchange', function () {
    state.selected = null; state.category = 'all'; state.tab = 'board'; state.watchonly = false;
    parseHash();
    $('category').value = state.category;
    $('watchonly').checked = state.watchonly;
    setTab(state.tab);
    render();
  });

  parseHash();
  renderStats();
  fillSelects();
  $('watchonly').checked = state.watchonly;
  setTab(state.tab);
  renderLive();
  renderComps();
  render();
})();
