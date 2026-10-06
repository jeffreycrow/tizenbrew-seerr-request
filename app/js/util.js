(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { (root.SR = root.SR || {}).util = factory(); }
})(this, function () {
  function debounce(fn, ms) {
    var timer;
    function debounced() {
      var self = this, args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, ms);
    }
    debounced.cancel = function () { clearTimeout(timer); };
    return debounced;
  }

  function latestOnly() {
    var n = 0;
    return function next() {
      var id = ++n;
      return function isCurrent() { return id === n; };
    };
  }

  return { debounce: debounce, latestOnly: latestOnly };
});
