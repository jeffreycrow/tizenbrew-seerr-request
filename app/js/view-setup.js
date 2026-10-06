(function (w) {
  var SR = w.SR, h = SR.h;

  SR.viewSetup = function (ctx) {
    var root = ctx.root;
    var fields = { url: ctx.cfg ? ctx.cfg.baseUrl : 'http://', key: ctx.cfg ? ctx.cfg.apiKey : '' };
    var active = 'url';
    var busy = false;
    var pairing = false;
    var group = ctx.nav.group();

    var kbEl = h('div', { 'class': 'keyboard' });
    var urlVal = h('div', { 'class': 'field-value' });
    var keyVal = h('div', { 'class': 'field-value' });
    var urlEl = h('div', { 'class': 'field' }, [h('div', { 'class': 'field-label', text: 'Seerr URL' }), urlVal]);
    var keyEl = h('div', { 'class': 'field' }, [h('div', { 'class': 'field-label', text: 'API key (Seerr > Settings > General)' }), keyVal]);
    var saveEl = h('div', { 'class': 'button primary', text: 'Save & connect' });
    var phoneEl = ctx.proxyUrl ? h('div', { 'class': 'button', text: 'Set up from phone' }) : null;
    var pairEl = h('div', { 'class': 'pair' });
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

    function stopPairing() {
      var was = pairing;
      pairing = false;
      SR.clear(pairEl);
      if (was && ctx.proxyUrl) SR.api.cancelPairing(ctx.proxyUrl).then(null, function () {});
      return was;
    }

    function startPhone() {
      if (pairing || busy) return;
      pairing = true;
      msgEl.textContent = 'Opening phone setup...';
      SR.api.startPairing(ctx.proxyUrl).then(function (info) {
        if (!pairing) {
          // cancelled while the start request was in flight: make sure the server is closed
          SR.api.cancelPairing(ctx.proxyUrl).then(null, function () {});
          return null;
        }
        SR.clear(pairEl);
        pairEl.appendChild(h('div', { 'class': 'pair-title', text: 'On your phone, open:' }));
        var addrs = info.addresses && info.addresses.length ? info.addresses : ['http://<TV address>:' + info.port];
        addrs.forEach(function (a) { pairEl.appendChild(h('div', { 'class': 'pair-url', text: a })); });
        pairEl.appendChild(h('div', { 'class': 'pair-pin', text: 'PIN ' + info.pin }));
        msgEl.textContent = 'Waiting for your phone... (Back to cancel)';
        return SR.api.waitForPairing(ctx.proxyUrl, { shouldStop: function () { return !pairing; } });
      }).then(function (cfg) {
        if (!pairing) return;
        pairing = false;
        SR.clear(pairEl);
        if (!cfg) { msgEl.textContent = 'Phone setup expired. Try again.'; return; }
        fields.url = cfg.baseUrl;
        fields.key = cfg.apiKey;
        paint();
        connect();
      }, function (err) {
        if (!pairing) return;
        pairing = false;
        SR.clear(pairEl);
        msgEl.textContent = err.message;
      });
    }

    group.add(urlEl, { onEnter: function () { select('url'); } });
    group.add(keyEl, { onEnter: function () { select('key'); } });
    group.add(saveEl, { onEnter: connect });
    if (phoneEl) group.add(phoneEl, { onEnter: startPhone });

    var kbView = SR.mountKeyboard(kbEl, kb, ctx.nav);
    root.appendChild(h('div', { 'class': 'screen setup' }, [
      h('div', { 'class': 'panel-left' }, [kbEl]),
      h('div', { 'class': 'panel-right' }, [
        h('h1', { text: 'Connect to Seerr' }),
        urlEl, keyEl, h('div', {}, [saveEl, phoneEl]), pairEl, msgEl
      ])
    ]));
    paint();
    if (phoneEl && !ctx.cfg) ctx.nav.focusEl(phoneEl); else kbView.focusFirst();

    return {
      name: 'setup',
      destroy: function () { stopPairing(); group.clear(); kbView.destroy(); SR.clear(root); },
      onBack: function () {
        if (stopPairing()) { msgEl.textContent = ''; return; }
        if (ctx.cfg) ctx.show('search'); else ctx.exit();
      }
    };
  };
})(window);
