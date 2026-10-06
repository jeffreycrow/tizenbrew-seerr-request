(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { (root.SR = root.SR || {}).keyboard = factory(); }
})(this, function () {
  var LETTER_ROWS = ['abcdef', 'ghijkl', 'mnopqr', 'stuvwx', 'yz1234', '567890'];
  var SYMBOL_ROWS = [':/.-_@', '?#&=%+', '~!,;()', '\'"[]*$'];

  function actionRow(layer) {
    var row = [
      { action: 'space', display: 'SPACE', span: 2 },
      { action: 'delete', display: 'DEL', span: 1 },
      { action: 'clear', display: 'CLR', span: 1 }
    ];
    if (layer === 'letters') {
      row.push({ action: 'shift', display: 'Aa', span: 1 });
      row.push({ action: 'layer', display: '#+=', span: 1 });
    } else {
      row.push({ action: 'layer', display: 'ABC', span: 2 });
    }
    return row;
  }

  function createKeyboard(opts) {
    opts = opts || {};
    var text = opts.text || '';
    var layer = 'letters';
    var shift = false;

    function setTextAndNotify(t) {
      if (t === text) return;
      text = t;
      if (opts.onChange) opts.onChange(text);
    }

    function layout() {
      var charRows = (layer === 'letters' ? LETTER_ROWS : SYMBOL_ROWS).map(function (str) {
        return str.split('').map(function (c) {
          return { action: 'char', value: c, display: (layer === 'letters' && shift) ? c.toUpperCase() : c, span: 1 };
        });
      });
      var rows = charRows.concat([actionRow(layer)]);
      return rows.map(function (row, r) {
        var col = 0;
        return row.map(function (k) {
          var key = { id: 'r' + r + 'c' + col, action: k.action, display: k.display, span: k.span };
          if (k.value !== undefined) key.value = k.value;
          col += k.span;
          return key;
        });
      });
    }

    function press(key) {
      switch (key.action) {
        case 'char': {
          var wasShift = shift;
          var c = (layer === 'letters' && shift) ? key.value.toUpperCase() : key.value;
          shift = false;
          setTextAndNotify(text + c);
          return wasShift;
        }
        case 'space': setTextAndNotify(text + ' '); return false;
        case 'delete': setTextAndNotify(text.slice(0, -1)); return false;
        case 'clear': setTextAndNotify(''); return false;
        case 'shift': shift = !shift; return true;
        case 'layer': layer = layer === 'letters' ? 'symbols' : 'letters'; shift = false; return true;
        default: return false;
      }
    }

    return {
      getText: function () { return text; },
      setText: function (t) { text = t || ''; },
      getLayer: function () { return layer; },
      isShift: function () { return shift; },
      layout: layout,
      press: press
    };
  }

  return { createKeyboard: createKeyboard };
});
