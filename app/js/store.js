(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { (root.SR = root.SR || {}).store = factory(); }
})(this, function () {
  var KEY = 'seerr-request:config';

  function defaultStorage() {
    try {
      var s = window.localStorage;
      s.setItem('__sr_t', '1');
      s.removeItem('__sr_t');
      return s;
    } catch (e) { return null; }
  }

  function memoryStorage() {
    var d = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null; },
      setItem: function (k, v) { d[k] = String(v); },
      removeItem: function (k) { delete d[k]; }
    };
  }

  function createStore(storage) {
    var mem = memoryStorage();
    var backing = storage === undefined ? defaultStorage() : storage;
    var persistent = !!backing;

    function target() { return backing || mem; }

    return {
      isPersistent: function () { return persistent; },
      load: function () {
        try {
          var raw = target().getItem(KEY);
          if (!raw) return null;
          var c = JSON.parse(raw);
          if (c && c.baseUrl && c.apiKey) return { baseUrl: String(c.baseUrl), apiKey: String(c.apiKey) };
          return null;
        } catch (e) { return null; }
      },
      save: function (cfg) {
        var json = JSON.stringify({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey });
        try { target().setItem(KEY, json); }
        catch (e) { backing = null; persistent = false; mem.setItem(KEY, json); }
      },
      clear: function () {
        try { target().removeItem(KEY); } catch (e) { /* ignore */ }
        mem.removeItem(KEY);
      }
    };
  }

  return { createStore: createStore };
});
