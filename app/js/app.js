(function (w) {
  var SR = w.SR;
  var PROXY_URL = 'http://127.0.0.1:8765';
  var BUILD = w.SR_CONFIG; // set by js/config.js in a packaged .wgt build (see scripts/build-wgt.js)
  var store = SR.store.createStore();
  var stored = store.load();
  var cfg = SR.store.initialConfig(stored, BUILD);
  if (cfg && !stored) store.save(cfg);

  var ctx = {
    root: document.getElementById('app'),
    nav: SR.nav,
    store: store,
    cfg: cfg,
    proxyUrl: null,
    client: null,
    searchState: { text: '', items: [], focusIndex: -1 }
  };
  var views = { setup: SR.viewSetup, search: SR.viewSearch, detail: SR.viewDetail };
  var current = null;

  ctx.makeClient = function (c) {
    return SR.api.createClient({ baseUrl: c.baseUrl, apiKey: c.apiKey, proxyUrl: ctx.proxyUrl });
  };

  ctx.show = function (name, arg) {
    if (current) current.destroy();
    current = views[name](ctx, arg);
  };

  ctx.exit = function () {
    try { w.tizen.application.getCurrentApplication().exit(); } catch (e) { w.close(); }
  };

  ctx.onSaved = function (newCfg) {
    ctx.cfg = newCfg;
    ctx.client = ctx.makeClient(newCfg);
    store.save(newCfg);
    ctx.searchState = { text: '', items: [], focusIndex: -1 };
    ctx.show('search');
  };

  w.addEventListener('keydown', function (e) {
    // Back: Tizen 10009, Escape on desktop. Settings: red button (403), F2 on desktop.
    if (e.keyCode === 10009 || e.keyCode === 27) {
      e.preventDefault();
      if (current) current.onBack();
    } else if (e.keyCode === 403 || e.keyCode === 113) {
      e.preventDefault();
      if (current && current.name !== 'setup') ctx.show('setup');
    }
  });

  SR.nav.init();
  // Under TizenBrew the module's `keys` register the colour key; as a standalone widget we do it here.
  try { w.tizen.tvinputdevice.registerKey('ColorF0Red'); } catch (e) { /* not on a Tizen TV */ }
  if (!store.isPersistent()) SR.toast('Settings cannot be saved on this device.', 'error');

  // On a TV the TizenBrew service may still be starting, so retry; on desktop probe once.
  ctx.root.appendChild(SR.h('div', { 'class': 'message', text: 'Starting...' }));
  var probe = SR.store.proxyWanted(BUILD)
    ? SR.api.probeProxy(PROXY_URL, { attempts: w.tizen ? 8 : 1 })
    : Promise.resolve(false);
  probe.then(function (ok) {
    ctx.proxyUrl = ok ? PROXY_URL : null;
    ctx.client = cfg ? ctx.makeClient(cfg) : null;
    SR.clear(ctx.root);
    ctx.show(cfg ? 'search' : 'setup');
  });
})(window);
