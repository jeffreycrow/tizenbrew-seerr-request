(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { (root.SR = root.SR || {}).api = factory(); }
})(this, function () {
  var STATUS = { UNKNOWN: 1, PENDING: 2, PROCESSING: 3, PARTIAL: 4, AVAILABLE: 5 };
  var IMG = 'https://image.tmdb.org/t/p/w342';

  function ApiError(kind, message, status) {
    this.name = 'ApiError';
    this.kind = kind;
    this.message = message;
    this.status = status || 0;
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  function httpError(status, detail) {
    if (status === 401 || status === 403) return new ApiError('auth', 'Seerr rejected the API key.', status);
    if (status === 404) return new ApiError('notfound', 'Not found on Seerr.', status);
    if (status === 409) return new ApiError('conflict', 'Already requested.', status);
    if (status === 502 || status === 504) return new ApiError('network', detail || 'Cannot reach Seerr. Check the URL and network.', status);
    return new ApiError('http', 'Seerr returned an error (' + status + ').', status);
  }

  function normalizeBase(url) {
    var u = String(url || '').trim();
    if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
    u = u.replace(/\/+$/, '');
    u = u.replace(/\/api\/v1$/, '');
    return u.replace(/\/+$/, '');
  }

  function statusLabel(code) {
    if (code === STATUS.PENDING) return 'Requested';
    if (code === STATUS.PROCESSING) return 'Processing';
    if (code === STATUS.PARTIAL) return 'Partially available';
    if (code === STATUS.AVAILABLE) return 'Available';
    return '';
  }

  function canRequest(code) {
    return code !== STATUS.PENDING && code !== STATUS.PROCESSING && code !== STATUS.AVAILABLE;
  }

  function toItem(r) {
    var date = r.releaseDate || r.firstAirDate || '';
    return {
      id: r.id,
      mediaType: r.mediaType,
      title: r.title || r.name || '',
      year: String(date).slice(0, 4),
      posterUrl: r.posterPath ? IMG + r.posterPath : null,
      overview: r.overview || '',
      rating: r.voteAverage || 0,
      status: (r.mediaInfo && r.mediaInfo.status) || 0
    };
  }

  function createClient(cfg) {
    var seerrBase = normalizeBase(cfg.baseUrl);
    var proxy = cfg.proxyUrl ? String(cfg.proxyUrl).replace(/\/+$/, '') : null;
    var base = proxy ? proxy + '/proxy/api/v1' : seerrBase + '/api/v1';
    var key = String(cfg.apiKey || '').trim();
    var timeoutMs = cfg.timeoutMs || 30000;
    var doFetch = cfg.fetch || function (u, o) { return fetch(u, o); };

    function request(method, path, body) {
      var init = { method: method, headers: { 'X-Api-Key': key, 'Accept': 'application/json' } };
      if (proxy) init.headers['X-Seerr-Url'] = seerrBase;
      if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      var timer;
      var timeout = new Promise(function (resolve, reject) {
        timer = setTimeout(function () { reject(new ApiError('timeout', 'Seerr did not respond in time.')); }, timeoutMs);
      });
      var call = doFetch(base + path, init).then(function (res) {
        if (!res.ok) {
          // the local proxy explains 502/504 in a JSON {message}; show it
          if (res.status === 502 || res.status === 504) {
            return res.json().then(function (b) { throw httpError(res.status, b && b.message); },
              function () { throw httpError(res.status); });
          }
          throw httpError(res.status);
        }
        if (res.status === 204) return null;
        return res.json().catch(function () {
          throw new ApiError('parse', 'Unexpected response. Is this a Seerr URL?');
        });
      }, function () {
        throw new ApiError('network', 'Cannot reach Seerr. Check the URL and network.');
      });
      return Promise.race([call, timeout]).then(
        function (v) { clearTimeout(timer); return v; },
        function (e) { clearTimeout(timer); throw e; }
      );
    }

    function checkType(mediaType) {
      if (mediaType !== 'movie' && mediaType !== 'tv') {
        return Promise.reject(new ApiError('http', 'Unsupported media type.'));
      }
      return null;
    }

    return {
      getMe: function () { return request('GET', '/auth/me'); },

      search: function (query, page) {
        var q = String(query || '').trim();
        if (!q) return Promise.resolve([]);
        return request('GET', '/search?query=' + encodeURIComponent(q) + '&page=' + (page || 1)).then(function (data) {
          return ((data && data.results) || [])
            .filter(function (r) { return r.mediaType === 'movie' || r.mediaType === 'tv'; })
            .map(toItem);
        });
      },

      getDetail: function (mediaType, id) {
        var bad = checkType(mediaType);
        if (bad) return bad;
        return request('GET', '/' + mediaType + '/' + encodeURIComponent(id)).then(function (data) {
          var item = toItem({
            id: data.id, mediaType: mediaType, title: data.title, name: data.name,
            releaseDate: data.releaseDate, firstAirDate: data.firstAirDate, posterPath: data.posterPath,
            overview: data.overview, voteAverage: data.voteAverage, mediaInfo: data.mediaInfo
          });
          if (mediaType === 'tv') {
            item.seasons = (data.seasons || [])
              .filter(function (s) { return s.seasonNumber > 0; })
              .map(function (s) {
                return { number: s.seasonNumber, name: s.name || ('Season ' + s.seasonNumber), episodeCount: s.episodeCount || 0 };
              });
          }
          return item;
        });
      },

      requestMedia: function (mediaType, id, seasons) {
        var bad = checkType(mediaType);
        if (bad) return bad;
        var body = { mediaType: mediaType, mediaId: id };
        if (mediaType === 'tv') {
          if (!seasons || !seasons.length) {
            return Promise.reject(new ApiError('http', 'Select at least one season.'));
          }
          body.seasons = seasons;
        }
        return request('POST', '/request', body);
      }
    };
  }

  function probeProxy(proxyUrl, opts) {
    opts = opts || {};
    var attempts = opts.attempts || 6;
    var delayMs = opts.delayMs === undefined ? 500 : opts.delayMs;
    var perTry = opts.timeoutMs || 1500;
    var doFetch = opts.fetch || function (u, o) { return fetch(u, o); };
    var url = String(proxyUrl).replace(/\/+$/, '') + '/health';

    function once() {
      var timer;
      var timeout = new Promise(function (resolve) { timer = setTimeout(function () { resolve(false); }, perTry); });
      var call = Promise.resolve().then(function () { return doFetch(url); }).then(function (res) {
        if (!res.ok) return false;
        return res.json().then(function (j) { return !!(j && j.ok === true); });
      }).catch(function () { return false; });
      return Promise.race([call, timeout]).then(function (v) { clearTimeout(timer); return v; });
    }

    function attempt(n) {
      return once().then(function (ok) {
        if (ok || n >= attempts) return ok;
        return new Promise(function (r) { setTimeout(r, delayMs); }).then(function () { return attempt(n + 1); });
      });
    }
    return attempt(1);
  }

  // ---- phone pairing (talks to the loopback setup API of the local service) ----

  function pairingCall(proxyUrl, method, path, opts) {
    var doFetch = (opts && opts.fetch) || function (u, o) { return fetch(u, o); };
    // no custom headers: keeps these simple CORS requests (no preflight)
    return doFetch(String(proxyUrl).replace(/\/+$/, '') + path, { method: method }).then(function (res) {
      if (!res.ok) throw new ApiError('http', 'Phone setup is not available (' + res.status + ').', res.status);
      return res.json();
    }, function () {
      throw new ApiError('network', 'Cannot reach the TV service.');
    });
  }

  function startPairing(proxyUrl, opts) { return pairingCall(proxyUrl, 'POST', '/setup/start', opts); }
  function pollPairing(proxyUrl, opts) { return pairingCall(proxyUrl, 'GET', '/setup/poll', opts); }
  function cancelPairing(proxyUrl, opts) { return pairingCall(proxyUrl, 'POST', '/setup/cancel', opts); }

  // Resolves {baseUrl, apiKey} when the phone submits, or null on expiry/cancel/stop/timeout.
  function waitForPairing(proxyUrl, opts) {
    opts = opts || {};
    var interval = opts.intervalMs === undefined ? 1500 : opts.intervalMs;
    var deadline = Date.now() + (opts.timeoutMs || 600000);

    function later() {
      return new Promise(function (r) { setTimeout(r, interval); }).then(step);
    }
    function step() {
      if ((opts.shouldStop && opts.shouldStop()) || Date.now() > deadline) return Promise.resolve(null);
      return pollPairing(proxyUrl, opts).then(function (r) {
        if (r && r.status === 'done') return { baseUrl: r.baseUrl, apiKey: r.apiKey };
        if (r && r.status === 'idle') return null;
        return later();
      }, later);
    }
    return step();
  }

  return {
    STATUS: STATUS, ApiError: ApiError, normalizeBase: normalizeBase,
    createClient: createClient, probeProxy: probeProxy, statusLabel: statusLabel, canRequest: canRequest,
    startPairing: startPairing, pollPairing: pollPairing, cancelPairing: cancelPairing, waitForPairing: waitForPairing
  };
});
