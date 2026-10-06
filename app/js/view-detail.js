(function (w) {
  w.SR.viewDetail = function (ctx) {
    return { name: 'detail', destroy: function () {}, onBack: function () { ctx.show('search'); } };
  };
})(window);
