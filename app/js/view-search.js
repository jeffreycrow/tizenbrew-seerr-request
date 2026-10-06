(function (w) {
  var SR = w.SR, h = SR.h;

  SR.viewSearch = function (ctx) {
    var root = ctx.root;
    var st = ctx.searchState;
    var kbEl = h('div', { 'class': 'keyboard' });
    var queryEl = h('div', { 'class': 'query' });
    var msgEl = h('div', { 'class': 'message' });
    var gridEl = h('div', { 'class': 'results' });
    var cardsGroup = ctx.nav.group();
    var cards = [];
    var next = SR.util.latestOnly();

    var kb = SR.keyboard.createKeyboard({
      text: st.text,
      onChange: function (t) { st.text = t; paintQuery(); next(); runSearch(); }
    });
    var runSearch = SR.util.debounce(search, 400);

    function setMsg(t) { msgEl.textContent = t; }

    function paintQuery() {
      queryEl.textContent = st.text || 'Search movies & TV';
      queryEl.className = 'query' + (st.text ? '' : ' placeholder');
    }

    function posterFor(item) {
      var missing = function () { return h('div', { 'class': 'poster poster-missing', text: item.title.charAt(0) }); };
      if (!item.posterUrl) return missing();
      var img = h('img', { 'class': 'poster', src: item.posterUrl, alt: '' });
      img.onerror = function () { if (img.parentNode) img.parentNode.replaceChild(missing(), img); };
      return img;
    }

    function renderResults() {
      var hadFocus = cardsGroup.clear();
      SR.clear(gridEl);
      cards = [];
      st.items.forEach(function (item, i) {
        var label = SR.api.statusLabel(item.status);
        var meta = h('div', { 'class': 'card-meta' }, [
          (item.year ? item.year + ' · ' : '') + (item.mediaType === 'tv' ? 'TV' : 'Movie'),
          label ? h('span', { 'class': 'badge badge-' + item.status, text: label }) : null
        ]);
        var card = h('div', { 'class': 'card' }, [posterFor(item), h('div', { 'class': 'card-title', text: item.title }), meta]);
        cardsGroup.add(card, { onEnter: function () { st.focusIndex = i; ctx.show('detail', item); } });
        cards.push(card);
        gridEl.appendChild(card);
      });
      if (hadFocus && kbView) {
        // the focused card was just removed: land on the first new card, else the keyboard
        if (cards.length) ctx.nav.focusEl(cards[0]); else kbView.focusFirst();
      }
    }

    function search() {
      var q = st.text.trim();
      var isCurrent = next();
      if (!q) { st.items = []; renderResults(); setMsg('Type to search.'); return; }
      setMsg('Searching...');
      ctx.client.search(q).then(function (items) {
        if (!isCurrent()) return;
        st.items = items;
        st.focusIndex = -1;
        renderResults();
        setMsg(items.length ? '' : 'No results for "' + q + '".');
      }, function (err) {
        if (!isCurrent()) return;
        setMsg(err.kind === 'auth' ? 'API key rejected. Press RED to open settings.' : err.message);
      });
    }

    var kbView = SR.mountKeyboard(kbEl, kb, ctx.nav);
    root.appendChild(h('div', { 'class': 'screen search' }, [
      h('div', { 'class': 'panel-left' }, [queryEl, kbEl]),
      h('div', { 'class': 'panel-right' }, [msgEl, gridEl])
    ]));
    root.appendChild(h('div', { 'class': 'hint', text: 'RED: settings   BACK: exit' }));

    paintQuery();
    renderResults();
    setMsg(st.items.length || st.text.trim() ? '' : 'Type to search.');
    if (st.focusIndex >= 0 && cards[st.focusIndex]) ctx.nav.focusEl(cards[st.focusIndex]);
    else kbView.focusFirst();

    return {
      name: 'search',
      destroy: function () {
        runSearch.cancel();
        next(); // invalidate in-flight searches
        cardsGroup.clear();
        kbView.destroy();
        SR.clear(root);
      },
      onBack: function () { ctx.exit(); }
    };
  };
})(window);
