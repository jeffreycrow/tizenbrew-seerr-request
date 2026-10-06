(function (w) {
  w.SR.viewSearch = function (ctx) {
    ctx.root.appendChild(w.SR.h('div', { 'class': 'message', text: 'search view (stub)' }));
    return { name: 'search', destroy: function () { w.SR.clear(ctx.root); }, onBack: function () { ctx.exit(); } };
  };
})(window);
