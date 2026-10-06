(function (w) {
  var SR = w.SR, h = SR.h;

  SR.mountKeyboard = function (container, kb, nav) {
    var group = nav.group();
    var firstEl = null;

    function render(match) {
      group.clear();
      SR.clear(container);
      var focusEl = null;
      firstEl = null;
      kb.layout().forEach(function (row) {
        row.forEach(function (key) {
          var el = h('div', { 'class': 'key key-' + key.action, text: key.display, style: 'grid-column: span ' + key.span });
          group.add(el, {
            onEnter: function () {
              var relayout = kb.press(key);
              if (relayout) {
                render(key.action === 'char'
                  ? function (k) { return k.id === key.id; }
                  : function (k) { return k.action === key.action; });
              }
            }
          });
          if (!firstEl) firstEl = el;
          if (match && match(key)) focusEl = el;
          container.appendChild(el);
        });
      });
      if (focusEl) nav.focusEl(focusEl);
    }

    render();
    return {
      focusFirst: function () { nav.focusEl(firstEl); },
      destroy: function () { group.clear(); SR.clear(container); }
    };
  };
})(window);
