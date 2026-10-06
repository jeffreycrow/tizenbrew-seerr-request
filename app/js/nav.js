(function (w) {
  var SR = (w.SR = w.SR || {});
  var N = w.NoriginNav;
  var seq = 0;
  function noop() {}

  function init() {
    N.init({ distanceCalculationMethod: 'center' });
  }

  function group() {
    var keys = [];
    return {
      add: function (el, handlers) {
        var h = handlers || {};
        var key = 'sr-' + (++seq);
        el._srKey = key;
        N.SpatialNavigation.addFocusable({
          focusKey: key,
          node: el,
          parentFocusKey: N.ROOT_FOCUS_KEY,
          onEnterPress: h.onEnter || noop,
          onEnterRelease: noop,
          onArrowPress: function () { return true; },
          onArrowRelease: noop,
          onFocus: function () {
            el.classList.add('focused');
            if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
            if (h.onFocus) h.onFocus();
          },
          onBlur: function () { el.classList.remove('focused'); },
          onUpdateFocus: noop,
          onUpdateHasFocusedChild: noop,
          saveLastFocusedChild: false,
          trackChildren: false,
          preferredChildFocusKey: undefined,
          focusable: true,
          isFocusBoundary: false,
          autoRestoreFocus: true,
          forceFocus: false
        });
        keys.push(key);
        return key;
      },
      clear: function () {
        keys.forEach(function (k) { N.SpatialNavigation.removeFocusable({ focusKey: k }); });
        keys = [];
      }
    };
  }

  function focusEl(el) {
    if (el && el._srKey) return N.setFocus(el._srKey);
  }

  SR.nav = { init: init, group: group, focusEl: focusEl };
})(window);
