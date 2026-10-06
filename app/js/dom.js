(function (w) {
  var SR = (w.SR = w.SR || {});

  SR.h = function (tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else el.setAttribute(k, v);
      });
    }
    (children || []).forEach(function (c) {
      if (!c) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  };

  SR.clear = function (el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  };

  var toastTimer;
  SR.toast = function (msg, kind) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'show' + (kind === 'error' ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = ''; }, 4000);
  };
})(window);
