(function (w) {
  var SR = w.SR, h = SR.h;

  SR.viewSetup = function (ctx) {
    var root = ctx.root;
    var fields = { url: ctx.cfg ? ctx.cfg.baseUrl : 'http://', key: ctx.cfg ? ctx.cfg.apiKey : '' };
    var active = 'url';
    var busy = false;
    var group = ctx.nav.group();

    var kbEl = h('div', { 'class': 'keyboard' });
    var urlVal = h('div', { 'class': 'field-value' });
    var keyVal = h('div', { 'class': 'field-value' });
    var urlEl = h('div', { 'class': 'field' }, [h('div', { 'class': 'field-label', text: 'Seerr URL' }), urlVal]);
    var keyEl = h('div', { 'class': 'field' }, [h('div', { 'class': 'field-label', text: 'API key (Seerr > Settings > General)' }), keyVal]);
    var saveEl = h('div', { 'class': 'button primary', text: 'Save & connect' });
    var msgEl = h('div', { 'class': 'message' });

    var kb = SR.keyboard.createKeyboard({
      text: fields.url,
      onChange: function (t) { fields[active] = t; paint(); }
    });

    function paint() {
      urlVal.textContent = fields.url;
      keyVal.textContent = fields.key;
      urlEl.classList.toggle('active', active === 'url');
      keyEl.classList.toggle('active', active === 'key');
    }

    function select(name) {
      active = name;
      kb.setText(fields[name]);
      paint();
    }

    function connect() {
      if (busy) return;
      var url = SR.api.normalizeBase(fields.url);
      var apiKey = fields.key.trim();
      if (!apiKey) { msgEl.textContent = 'Enter your API key.'; return; }
      busy = true;
      msgEl.textContent = 'Connecting...';
      ctx.makeClient({ baseUrl: url, apiKey: apiKey }).getMe().then(function () {
        busy = false;
        ctx.onSaved({ baseUrl: url, apiKey: apiKey });
      }, function (err) {
        busy = false;
        msgEl.textContent = err.message;
      });
    }

    group.add(urlEl, { onEnter: function () { select('url'); } });
    group.add(keyEl, { onEnter: function () { select('key'); } });
    group.add(saveEl, { onEnter: connect });

    var kbView = SR.mountKeyboard(kbEl, kb, ctx.nav);
    root.appendChild(h('div', { 'class': 'screen setup' }, [
      h('div', { 'class': 'panel-left' }, [kbEl]),
      h('div', { 'class': 'panel-right' }, [
        h('h1', { text: 'Connect to Seerr' }),
        urlEl, keyEl, h('div', {}, [saveEl]), msgEl
      ])
    ]));
    paint();
    kbView.focusFirst();

    return {
      name: 'setup',
      destroy: function () { group.clear(); kbView.destroy(); SR.clear(root); },
      onBack: function () { if (ctx.cfg) ctx.show('search'); else ctx.exit(); }
    };
  };
})(window);
