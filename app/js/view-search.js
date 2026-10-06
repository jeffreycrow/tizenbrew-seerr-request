(function (w) {
  var SR = w.SR, h = SR.h;

  SR.viewSearch = function (ctx) {
    var root = ctx.root;
    var st = ctx.searchState;
    if (st.popularOnly === undefined) st.popularOnly = true;
    if (!st.raw) st.raw = [];
    if (!st.items) st.items = [];
    st.hidden = st.hidden || 0;

    var kbEl = h('div', { 'class': 'keyboard' });
    var queryEl = h('div', { 'class': 'query' });
    var toggleEl = h('div', { 'class': 'toggle' });
    var msgEl = h('div', { 'class': 'message' });
    var gridEl = h('div', { 'class': 'results' });
    var cardsGroup = ctx.nav.group();
    var uiGroup = ctx.nav.group();
    var cards = [];
    var searching = false;
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

    function paintToggle() {
      toggleEl.textContent = 'Popular only: ' + (st.popularOnly ? 'ON' : 'OFF') +
        (st.popularOnly && st.hidden ? '  (' + st.hidden + ' hidden)' : '');
      toggleEl.classList.toggle('on', st.popularOnly);
    }

    function resultsMessage() {
      var q = st.text.trim();
      if (!q) return 'Type to search.';
      if (st.items.length) return '';
      if (st.raw.length) return 'Only low-quality matches for "' + q + '". Turn off "Popular only" to see them.';
      return 'No results for "' + q + '".';
    }

    // derive what is shown from the raw Seerr results and the Popular-only switch
    function applyRanking() {
      var r = SR.api.rankResults(st.raw, { popularOnly: st.popularOnly });
      st.items = r.items;
      st.hidden = r.hidden;
    }

    function posterFor(item) {
      var missing = function () { return h('div', { 'class': 'poster poster-missing', text: item.title.charAt(0) }); };
      if (!item.posterUrl) return missing();
      var img = h('img', { 'class': 'poster', src: item.posterUrl, alt: '' });
      img.onerror = function () { if (img.parentNode) img.parentNode.replaceChild(missing(), img); };
      return img;
    }

    function ratingText(item) {
      if (!(item.rating > 0) || !(item.voteCount > 0)) return '';
      return '★ ' + item.rating.toFixed(1) + ' (' + SR.api.compactCount(item.voteCount) + ')';
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
        var rating = ratingText(item);
        var card = h('div', { 'class': 'card' }, [
          posterFor(item),
          h('div', { 'class': 'card-title', text: item.title }),
          meta,
          rating ? h('div', { 'class': 'card-rating', text: rating }) : null
        ]);
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
      if (!q) {
        searching = false;
        st.raw = [];
        applyRanking();
        renderResults();
        paintToggle();
        setMsg('Type to search.');
        return;
      }
      searching = true;
      setMsg('Searching...');
      ctx.client.search(q).then(function (items) {
        if (!isCurrent()) return;
        searching = false;
        st.raw = items;
        st.focusIndex = -1;
        applyRanking();
        renderResults();
        paintToggle();
        setMsg(resultsMessage());
      }, function (err) {
        if (!isCurrent()) return;
        searching = false;
        setMsg(err.kind === 'auth' ? 'API key rejected. Press RED to open settings.' : err.message);
      });
    }

    uiGroup.add(toggleEl, {
      onEnter: function () {
        st.popularOnly = !st.popularOnly;
        st.focusIndex = -1;
        applyRanking();
        renderResults();
        paintToggle();
        if (!searching) setMsg(resultsMessage());
      }
    });

    var kbView = SR.mountKeyboard(kbEl, kb, ctx.nav);
    root.appendChild(h('div', { 'class': 'screen search' }, [
      h('div', { 'class': 'panel-left' }, [queryEl, kbEl]),
      h('div', { 'class': 'panel-right' }, [h('div', { 'class': 'toolbar' }, [toggleEl]), msgEl, gridEl])
    ]));
    root.appendChild(h('div', { 'class': 'hint', text: 'RED: settings   BACK: exit' }));

    paintQuery();
    paintToggle();
    renderResults();
    setMsg(resultsMessage());
    if (st.focusIndex >= 0 && cards[st.focusIndex]) ctx.nav.focusEl(cards[st.focusIndex]);
    else kbView.focusFirst();

    return {
      name: 'search',
      destroy: function () {
        runSearch.cancel();
        next(); // invalidate in-flight searches
        cardsGroup.clear();
        uiGroup.clear();
        kbView.destroy();
        SR.clear(root);
      },
      onBack: function () { ctx.exit(); }
    };
  };
})(window);
