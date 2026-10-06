(function (w) {
  var SR = w.SR, h = SR.h;

  SR.viewDetail = function (ctx, item) {
    var root = ctx.root;
    var group = ctx.nav.group();
    var screen = h('div', { 'class': 'screen detail' }, [h('div', { 'class': 'message', text: 'Loading...' })]);
    root.appendChild(screen);
    var alive = true;
    var busy = false;

    var load = item.mediaType === 'tv'
      ? ctx.client.getDetail('tv', item.id)
      : Promise.resolve(item);

    load.then(function (d) {
      if (!alive) return;
      if (d !== item) {
        item.overview = d.overview || item.overview;
        item.seasons = d.seasons || [];
        item.status = d.status;
      }
      render();
    }, function (err) {
      if (!alive) return;
      SR.toast(err.message, 'error');
      ctx.show('search');
    });

    function render() {
      SR.clear(screen);
      var sel = SR.seasons.createSelection((item.seasons || []).map(function (s) { return s.number; }));
      var chipEls = [];
      var badgeEl = h('span', { 'class': 'badge' });
      var reqEl = h('div', { 'class': 'button primary' });
      var backEl = h('div', { 'class': 'button', text: 'Back' });

      function reqState() {
        if (!SR.api.canRequest(item.status)) return { label: SR.api.statusLabel(item.status), enabled: false };
        if (item.mediaType === 'tv' && !(item.seasons || []).length) return { label: 'No seasons available', enabled: false };
        if (item.mediaType === 'tv' && sel.count() === 0) return { label: 'Select a season', enabled: false };
        return { label: 'Request', enabled: true };
      }

      function paint() {
        var label = SR.api.statusLabel(item.status);
        badgeEl.textContent = label;
        badgeEl.className = label ? 'badge badge-' + item.status : '';
        chipEls.forEach(function (c) { c.el.classList.toggle('on', c.isOn()); });
        var st = reqState();
        reqEl.textContent = st.label;
        reqEl.classList.toggle('disabled', !st.enabled);
      }

      function doRequest() {
        var st = reqState();
        if (!st.enabled) { SR.toast(st.label, 'error'); return; }
        if (busy) return;
        busy = true;
        ctx.client.requestMedia(item.mediaType, item.id, item.mediaType === 'tv' ? sel.selected() : undefined)
          .then(function () {
            item.status = SR.api.STATUS.PENDING;
            SR.toast('Requested: ' + item.title);
          }, function (err) {
            if (err.kind === 'conflict') item.status = SR.api.STATUS.PENDING;
            SR.toast(err.message, 'error');
          })
          .then(function () { busy = false; if (alive) paint(); });
      }

      var poster = item.posterUrl
        ? h('img', { 'class': 'poster', src: item.posterUrl, alt: '' })
        : h('div', { 'class': 'poster poster-missing', text: item.title.charAt(0) });

      var info = h('div', { 'class': 'info' }, [
        h('h1', { text: item.title + (item.year ? ' (' + item.year + ')' : '') }),
        h('div', {}, [
          (item.mediaType === 'tv' ? 'TV' : 'Movie') + (item.rating ? '  ★ ' + item.rating.toFixed(1) : '') + '  ',
          badgeEl
        ]),
        h('div', { 'class': 'overview', text: item.overview })
      ]);

      if (item.mediaType === 'tv' && (item.seasons || []).length) {
        var chips = h('div', { 'class': 'chips' });
        var allEl = h('div', { 'class': 'chip', text: 'All' });
        chipEls.push({ el: allEl, isOn: function () { return sel.allSelected(); } });
        group.add(allEl, { onEnter: function () { sel.toggleAll(); paint(); } });
        chips.appendChild(allEl);
        item.seasons.forEach(function (s) {
          var el = h('div', { 'class': 'chip', text: 'S' + s.number });
          chipEls.push({ el: el, isOn: function () { return sel.isSelected(s.number); } });
          group.add(el, { onEnter: function () { sel.toggle(s.number); paint(); } });
          chips.appendChild(el);
        });
        info.appendChild(chips);
      }

      group.add(reqEl, { onEnter: doRequest });
      group.add(backEl, { onEnter: function () { ctx.show('search'); } });
      info.appendChild(h('div', {}, [reqEl, backEl]));

      screen.appendChild(h('div', { 'class': 'poster-wrap' }, [poster]));
      screen.appendChild(info);
      paint();
      ctx.nav.focusEl(reqEl);
    }

    return {
      name: 'detail',
      destroy: function () { alive = false; group.clear(); SR.clear(root); },
      onBack: function () { ctx.show('search'); }
    };
  };
})(window);
