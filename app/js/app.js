(function (w) {
  var SR = w.SR;
  var store = SR.store.createStore();
  var cfg = store.load();

  var ctx = {
    root: document.getElementById('app'),
    nav: SR.nav,
    store: store,
    cfg: cfg,
    client: cfg ? SR.api.createClient(cfg) : null,
    searchState: { text: '', items: [], focusIndex: -1 }
  };
  var views = { setup: SR.viewSetup, search: SR.viewSearch, detail: SR.viewDetail };
  var current = null;

  ctx.show = function (name, arg) {
    if (current) current.destroy();
    current = views[name](ctx, arg);
  };

  ctx.exit = function () {
    try { w.tizen.application.getCurrentApplication().exit(); } catch (e) { w.close(); }
  };

  ctx.onSaved = function (newCfg) {
    ctx.cfg = newCfg;
    ctx.client = SR.api.createClient(newCfg);
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
  if (!store.isPersistent()) SR.toast('Settings cannot be saved on this device.', 'error');
  ctx.show(cfg ? 'search' : 'setup');
})(window);
