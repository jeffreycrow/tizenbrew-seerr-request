(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { (root.SR = root.SR || {}).seasons = factory(); }
})(this, function () {
  function createSelection(numbers) {
    var all = numbers.slice().sort(function (a, b) { return a - b; });
    var on = {};
    all.forEach(function (n) { on[n] = true; });

    function selected() { return all.filter(function (n) { return on[n]; }); }
    function allSelected() { return all.length > 0 && selected().length === all.length; }

    return {
      toggle: function (n) { if (all.indexOf(n) !== -1) on[n] = !on[n]; },
      toggleAll: function () {
        var target = !allSelected();
        all.forEach(function (n) { on[n] = target; });
      },
      isSelected: function (n) { return !!on[n]; },
      allSelected: allSelected,
      selected: selected,
      count: function () { return selected().length; }
    };
  }
  return { createSelection: createSelection };
});
