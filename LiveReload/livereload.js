(function() {
var __customevents = {}, __protocol = {}, __connector = {}, __timer = {}, __options = {}, __reloader = {}, __livereload = {}, __startup = {};

// customevents
var CustomEvents;
CustomEvents = {
  bind: function(element, eventName, handler) {
    if (element.addEventListener) {
      return element.addEventListener(eventName, handler, false);
    } else if (element.attachEvent) {
      element[eventName] = 1;
      return element.attachEvent('onpropertychange', function(event) {
        if (event.propertyName === eventName) {
          return handler();
        }
      });
    } else {
      throw new Error("Attempt to attach custom event " + eventName + " to something which isn't a DOMElement");
    }
  },
  fire: function(element, eventName) {
    var event;
    if (element.addEventListener) {
      event = document.createEvent('HTMLEvents');
      event.initEvent(eventName, true, true);
      return document.dispatchEvent(event);
    } else if (element.attachEvent) {
      if (element[eventName]) {
        return element[eventName]++;
      }
    } else {
      throw new Error("Attempt to fire custom event " + eventName + " on something which isn't a DOMElement");
    }
  }
};
__customevents.bind = CustomEvents.bind;
__customevents.fire = CustomEvents.fire;

// protocol
var PROTOCOL_6, PROTOCOL_7, Parser, ProtocolError;
var __indexOf = Array.prototype.indexOf || function(item) {
  for (var i = 0, l = this.length; i < l; i++) {
    if (this[i] === item) return i;
  }
  return -1;
};
__protocol.PROTOCOL_6 = PROTOCOL_6 = 'http://livereload.com/protocols/official-6';
__protocol.PROTOCOL_7 = PROTOCOL_7 = 'http://livereload.com/protocols/official-7';
__protocol.ProtocolError = ProtocolError = (function() {
  function ProtocolError(reason, data) {
    this.message = "LiveReload protocol error (" + reason + ") after receiving data: \"" + data + "\".";
  }
  return ProtocolError;
})();
__protocol.Parser = Parser = (function() {
  function Parser(handlers) {
    this.handlers = handlers;
    this.reset();
  }
  Parser.prototype.reset = function() {
    return this.protocol = null;
  };
  Parser.prototype.process = function(data) {
    var command, message, options, _ref;
    try {
      if (!(this.protocol != null)) {
        if (data.match(/^!!ver:([\d.]+)$/)) {
          this.protocol = 6;
        } else if (message = this._parseMessage(data, ['hello'])) {
          if (!message.protocols.length) {
            throw new ProtocolError("no protocols specified in handshake message");
          } else if (__indexOf.call(message.protocols, PROTOCOL_7) >= 0) {
            this.protocol = 7;
          } else if (__indexOf.call(message.protocols, PROTOCOL_6) >= 0) {
            this.protocol = 6;
          } else {
            throw new ProtocolError("no supported protocols found");
          }
        }
        return this.handlers.connected(this.protocol);
      } else if (this.protocol === 6) {
        message = JSON.parse(data);
        if (!message.length) {
          throw new ProtocolError("protocol 6 messages must be arrays");
        }
        command = message[0], options = message[1];
        if (command !== 'refresh') {
          throw new ProtocolError("unknown protocol 6 command");
        }
        return this.handlers.message({
          command: 'reload',
          path: options.path,
          liveCSS: (_ref = options.apply_css_live) != null ? _ref : true
        });
      } else {
        message = this._parseMessage(data, ['reload', 'alert']);
        return this.handlers.message(message);
      }
    } catch (e) {
      if (e instanceof ProtocolError) {
        return this.handlers.error(e);
      } else {
        throw e;
      }
    }
  };
  Parser.prototype._parseMessage = function(data, validCommands) {
    var message, _ref;
    try {
      message = JSON.parse(data);
    } catch (e) {
      throw new ProtocolError('unparsable JSON', data);
    }
    if (!message.command) {
      throw new ProtocolError('missing "command" key', data);
    }
    if (_ref = message.command, __indexOf.call(validCommands, _ref) < 0) {
      throw new ProtocolError("invalid command '" + message.command + "', only valid commands are: " + (validCommands.join(', ')) + ")", data);
    }
    return message;
  };
  return Parser;
})();

// connector
var Connector, PROTOCOL_6, PROTOCOL_7, Parser, Version, _ref;
var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; };
_ref = __protocol, Parser = _ref.Parser, PROTOCOL_6 = _ref.PROTOCOL_6, PROTOCOL_7 = _ref.PROTOCOL_7;
Version = '2.0.1';
__connector.Connector = Connector = (function() {
  function Connector(options, WebSocket, Timer, handlers) {
    this.options = options;
    this.WebSocket = WebSocket;
    this.Timer = Timer;
    this.handlers = handlers;
    this._uri = "ws://" + this.options.host + ":" + this.options.port + "/livereload";
    this._nextDelay = this.options.mindelay;
    this._connectionDesired = false;
    this.protocolParser = new Parser({
      connected: __bind(function(protocol) {
        this._handshakeTimeout.stop();
        this._nextDelay = this.options.mindelay;
        this._disconnectionReason = 'broken';
        return this.handlers.connected(protocol);
      }, this),
      error: __bind(function(e) {
        this.handlers.error(e);
        return this._closeOnError();
      }, this),
      message: __bind(function(message) {
        return this.handlers.message(message);
      }, this)
    });
    this._handshakeTimeout = new Timer(__bind(function() {
      if (!this._isSocketConnected()) {
        return;
      }
      this._disconnectionReason = 'handshake-timeout';
      return this.socket.close();
    }, this));
    this._reconnectTimer = new Timer(__bind(function() {
      if (!this._connectionDesired) {
        return;
      }
      return this.connect();
    }, this));
    this.connect();
  }
  Connector.prototype._isSocketConnected = function() {
    return this.socket && this.socket.readyState === this.WebSocket.OPEN;
  };
  Connector.prototype.connect = function() {
    this._connectionDesired = true;
    if (this._isSocketConnected()) {
      return;
    }
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
    }
    this._disconnectionReason = 'cannot-connect';
    this.protocolParser.reset();
    this.handlers.connecting();
    this.socket = new this.WebSocket(this._uri);
    this.socket.onopen = __bind(function(e) {
      return this._onopen(e);
    }, this);
    this.socket.onclose = __bind(function(e) {
      return this._onclose(e);
    }, this);
    this.socket.onmessage = __bind(function(e) {
      return this._onmessage(e);
    }, this);
    return this.socket.onerror = __bind(function(e) {
      return this._onerror(e);
    }, this);
  };
  Connector.prototype.disconnect = function() {
    this._connectionDesired = false;
    this._reconnectTimer.stop();
    if (!this._isSocketConnected()) {
      return;
    }
    this._disconnectionReason = 'manual';
    return this.socket.close();
  };
  Connector.prototype._scheduleReconnection = function() {
    if (!this._connectionDesired) {
      return;
    }
    if (!this._reconnectTimer.running) {
      this._reconnectTimer.start(this._nextDelay);
      return this._nextDelay = Math.min(this.options.maxdelay, this._nextDelay * 2);
    }
  };
  Connector.prototype.sendCommand = function(command) {
    if (this.protocol == null) {
      return;
    }
    return this._sendCommand(command);
  };
  Connector.prototype._sendCommand = function(command) {
    return this.socket.send(JSON.stringify(command));
  };
  Connector.prototype._closeOnError = function() {
    this._handshakeTimeout.stop();
    this._disconnectionReason = 'error';
    return this.socket.close();
  };
  Connector.prototype._onopen = function(e) {
    var hello;
    this.handlers.socketConnected();
    this._disconnectionReason = 'handshake-failed';
    hello = {
      command: 'hello',
      protocols: [PROTOCOL_6, PROTOCOL_7]
    };
    hello.ver = Version;
    if (this.options.ext) {
      hello.ext = this.options.ext;
    }
    if (this.options.extver) {
      hello.extver = this.options.extver;
    }
    if (this.options.snipver) {
      hello.snipver = this.options.snipver;
    }
    this._sendCommand(hello);
    return this._handshakeTimeout.start(this.options.handshake_timeout);
  };
  Connector.prototype._onclose = function(e) {
    this.handlers.disconnected(this._disconnectionReason, this._nextDelay);
    return this._scheduleReconnection();
  };
  Connector.prototype._onerror = function(e) {};
  Connector.prototype._onmessage = function(e) {
    return this.protocolParser.process(e.data);
  };
  return Connector;
})();

// timer
var Timer;
var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; };
__timer.Timer = Timer = (function() {
  function Timer(func) {
    this.func = func;
    this.running = false;
    this.id = null;
    this._handler = __bind(function() {
      this.running = false;
      this.id = null;
      return this.func();
    }, this);
  }
  Timer.prototype.start = function(timeout) {
    if (this.running) {
      clearTimeout(this.id);
    }
    this.id = setTimeout(this._handler, timeout);
    return this.running = true;
  };
  Timer.prototype.stop = function() {
    if (this.running) {
      clearTimeout(this.id);
      this.running = false;
      return this.id = null;
    }
  };
  return Timer;
})();
Timer.start = function(timeout, func) {
  return setTimeout(func, timeout);
};

// options
var Options;
__options.Options = Options = (function() {
  function Options() {
    this.host = null;
    this.port = 35729;
    this.snipver = null;
    this.ext = null;
    this.extver = null;
    this.mindelay = 1000;
    this.maxdelay = 60000;
    this.handshake_timeout = 5000;
  }
  Options.prototype.set = function(name, value) {
    switch (typeof this[name]) {
      case 'undefined':
        break;
      case 'number':
        return this[name] = +value;
      default:
        return this[name] = value;
    }
  };
  return Options;
})();
Options.extract = function(document) {
  var element, keyAndValue, m, mm, options, pair, src, _i, _j, _len, _len2, _ref, _ref2;
  _ref = document.getElementsByTagName('script');
  for (_i = 0, _len = _ref.length; _i < _len; _i++) {
    element = _ref[_i];
    if ((src = element.src) && (m = src.match(/^[^:]+:\/\/(.*)\/z?livereload\.js(?:\?(.*))?$/))) {
      options = new Options();
      if (mm = m[1].match(/^([^\/:]+)(?::(\d+))?$/)) {
        options.host = mm[1];
        if (mm[2]) {
          options.port = parseInt(mm[2], 10);
        }
      }
      if (m[2]) {
        _ref2 = m[2].split('&');
        for (_j = 0, _len2 = _ref2.length; _j < _len2; _j++) {
          pair = _ref2[_j];
          if ((keyAndValue = pair.split('=')).length > 1) {
            options.set(keyAndValue[0].replace(/-/g, '_'), keyAndValue.slice(1).join('='));
          }
        }
      }
      return options;
    }
  }
  return null;
};

// reloader
var IMAGE_STYLES, Reloader, numberOfMatchingSegments, pathFromUrl, pathsMatch, pickBestMatch, splitUrl;
var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; };
splitUrl = function(url) {
  var hash, index, params;
  if ((index = url.indexOf('#')) >= 0) {
    hash = url.slice(index);
    url = url.slice(0, index);
  } else {
    hash = '';
  }
  if ((index = url.indexOf('?')) >= 0) {
    params = url.slice(index);
    url = url.slice(0, index);
  } else {
    params = '';
  }
  return {
    url: url,
    params: params,
    hash: hash
  };
};
pathFromUrl = function(url) {
  var path;
  url = splitUrl(url).url;
  if (url.indexOf('file://') === 0) {
    path = url.replace(/^file:\/\/(localhost)?/, '');
  } else {
    path = url.replace(/^([^:]+:)?\/\/([^:\/]+)(:\d*)?\//, '/');
  }
  return decodeURIComponent(path);
};
pickBestMatch = function(path, objects, pathFunc) {
  var bestMatch, object, score, _i, _len;
  bestMatch = {
    score: 0
  };
  for (_i = 0, _len = objects.length; _i < _len; _i++) {
    object = objects[_i];
    score = numberOfMatchingSegments(path, pathFunc(object));
    if (score > bestMatch.score) {
      bestMatch = {
        object: object,
        score: score
      };
    }
  }
  if (bestMatch.score > 0) {
    return bestMatch;
  } else {
    return null;
  }
};
numberOfMatchingSegments = function(path1, path2) {
  var comps1, comps2, eqCount, len;
  path1 = path1.replace(/^\/+/, '').toLowerCase();
  path2 = path2.replace(/^\/+/, '').toLowerCase();
  if (path1 === path2) {
    return 10000;
  }
  comps1 = path1.split('/').reverse();
  comps2 = path2.split('/').reverse();
  len = Math.min(comps1.length, comps2.length);
  eqCount = 0;
  while (eqCount < len && comps1[eqCount] === comps2[eqCount]) {
    ++eqCount;
  }
  return eqCount;
};
pathsMatch = function(path1, path2) {
  return numberOfMatchingSegments(path1, path2) > 0;
};
IMAGE_STYLES = [
  {
    selector: 'background',
    styleNames: ['backgroundImage']
  }, {
    selector: 'border',
    styleNames: ['borderImage', 'webkitBorderImage', 'MozBorderImage']
  }
];
__reloader.Reloader = Reloader = (function() {
  function Reloader(window, console, Timer) {
    this.window = window;
    this.console = console;
    this.Timer = Timer;
    this.document = this.window.document;
    this.stylesheetGracePeriod = 200;
    this.importCacheWaitPeriod = 200;
  }
  Reloader.prototype.reload = function(path, options) {
    if (options.liveCSS) {
      if (path.match(/\.css$/i)) {
        if (this.reloadStylesheet(path)) {
          return;
        }
      }
      if (path.match(/\.less$/i) && this.window.less && this.window.less.refresh) {
        this.window.less.refresh(true);
        return;
      }
    }
    if (options.liveImg) {
      if (path.match(/\.(jpe?g|png|gif)$/i)) {
        this.reloadImages(path);
        return;
      }
    }
    return this.reloadPage();
  };
  Reloader.prototype.reloadPage = function() {
    return this.window.document.location.reload();
  };
  Reloader.prototype.reloadImages = function(path) {
    var expando, img, selector, styleNames, styleSheet, _i, _j, _k, _l, _len, _len2, _len3, _len4, _ref, _ref2, _ref3, _ref4, _results;
    expando = this.generateUniqueString();
    _ref = this.document.images;
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      img = _ref[_i];
      if (pathsMatch(path, pathFromUrl(img.src))) {
        img.src = this.generateCacheBustUrl(img.src, expando);
      }
    }
    if (this.document.querySelectorAll) {
      for (_j = 0, _len2 = IMAGE_STYLES.length; _j < _len2; _j++) {
        _ref2 = IMAGE_STYLES[_j], selector = _ref2.selector, styleNames = _ref2.styleNames;
        _ref3 = this.document.querySelectorAll("[style*=" + selector + "]");
        for (_k = 0, _len3 = _ref3.length; _k < _len3; _k++) {
          img = _ref3[_k];
          this.reloadStyleImages(img.style, styleNames, path, expando);
        }
      }
    }
    if (this.document.styleSheets) {
      _ref4 = this.document.styleSheets;
      _results = [];
      for (_l = 0, _len4 = _ref4.length; _l < _len4; _l++) {
        styleSheet = _ref4[_l];
        _results.push(this.reloadStylesheetImages(styleSheet, path, expando));
      }
      return _results;
    }
  };
  Reloader.prototype.reloadStylesheetImages = function(styleSheet, path, expando) {
    var rule, rules, styleNames, _i, _j, _len, _len2;
    try {
      rules = styleSheet != null ? styleSheet.cssRules : void 0;
    } catch (e) {

    }
    if (!rules) {
      return;
    }
    for (_i = 0, _len = rules.length; _i < _len; _i++) {
      rule = rules[_i];
      switch (rule.type) {
        case CSSRule.IMPORT_RULE:
          this.reloadStylesheetImages(rule.styleSheet, path, expando);
          break;
        case CSSRule.STYLE_RULE:
          for (_j = 0, _len2 = IMAGE_STYLES.length; _j < _len2; _j++) {
            styleNames = IMAGE_STYLES[_j].styleNames;
            this.reloadStyleImages(rule.style, styleNames, path, expando);
          }
          break;
        case CSSRule.MEDIA_RULE:
          this.reloadStylesheetImages(rule, path, expando);
      }
    }
  };
  Reloader.prototype.reloadStyleImages = function(style, styleNames, path, expando) {
    var newValue, styleName, value, _i, _len;
    for (_i = 0, _len = styleNames.length; _i < _len; _i++) {
      styleName = styleNames[_i];
      value = style[styleName];
      if (typeof value === 'string') {
        newValue = value.replace(/\burl\s*\(([^)]*)\)/, __bind(function(match, src) {
          if (pathsMatch(path, pathFromUrl(src))) {
            return "url(" + (this.generateCacheBustUrl(src, expando)) + ")";
          } else {
            return match;
          }
        }, this));
        if (newValue !== value) {
          style[styleName] = newValue;
        }
      }
    }
  };
  Reloader.prototype.reloadStylesheet = function(path) {
    var imported, link, links, match, _i, _j, _len, _len2;
    links = (function() {
      var _i, _len, _ref, _results;
      _ref = this.document.getElementsByTagName('link');
      _results = [];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        link = _ref[_i];
        if (link.rel === 'stylesheet' && !link.__LiveReload_pendingRemoval) {
          _results.push(link);
        }
      }
      return _results;
    }).call(this);
    imported = [];
    for (_i = 0, _len = links.length; _i < _len; _i++) {
      link = links[_i];
      this.collectImportedStylesheets(link, link.sheet, imported);
    }
    this.console.log("LiveReload found " + links.length + " LINKed stylesheets, " + imported.length + " @imported stylesheets");
    match = pickBestMatch(path, links.concat(imported), function(l) {
      return pathFromUrl(l.href);
    });
    if (match) {
      if (match.object.rule) {
        this.console.log("LiveReload is reloading imported stylesheet: " + match.object.href);
        this.reattachImportedRule(match.object);
      } else {
        this.console.log("LiveReload is reloading stylesheet: " + match.object.href);
        this.reattachStylesheetLink(match.object);
      }
    } else {
      this.console.log("LiveReload will reload all stylesheets because path '" + path + "' did not match any specific one");
      for (_j = 0, _len2 = links.length; _j < _len2; _j++) {
        link = links[_j];
        this.reattachStylesheetLink(link);
      }
    }
    return true;
  };
  Reloader.prototype.collectImportedStylesheets = function(link, styleSheet, result) {
    var index, rule, rules, _len;
    try {
      rules = styleSheet != null ? styleSheet.cssRules : void 0;
    } catch (e) {

    }
    if (rules && rules.length) {
      for (index = 0, _len = rules.length; index < _len; index++) {
        rule = rules[index];
        switch (rule.type) {
          case CSSRule.CHARSET_RULE:
            continue;
          case CSSRule.IMPORT_RULE:
            result.push({
              link: link,
              rule: rule,
              index: index,
              href: rule.href
            });
            this.collectImportedStylesheets(link, rule.styleSheet, result);
            break;
          default:
            break;
        }
      }
    }
  };
  Reloader.prototype.reattachStylesheetLink = function(link) {
    var clone, parent, timer;
    if (link.__LiveReload_pendingRemoval) {
      return;
    }
    link.__LiveReload_pendingRemoval = true;
    clone = link.cloneNode(false);
    clone.href = this.generateCacheBustUrl(link.href);
    parent = link.parentNode;
    if (parent.lastChild === link) {
      parent.appendChild(clone);
    } else {
      parent.insertBefore(clone, link.nextSibling);
    }
    timer = new this.Timer(function() {
      if (link.parentNode) {
        return link.parentNode.removeChild(link);
      }
    });
    return timer.start(this.stylesheetGracePeriod);
  };
  Reloader.prototype.reattachImportedRule = function(_arg) {
    var href, index, link, media, newRule, parent, rule, tempLink;
    rule = _arg.rule, index = _arg.index, link = _arg.link;
    parent = rule.parentStyleSheet;
    href = this.generateCacheBustUrl(rule.href);
    media = rule.media.length ? [].join.call(rule.media, ', ') : '';
    newRule = "@import url(\"" + href + "\") " + media + ";";
    rule.__LiveReload_newHref = href;
    tempLink = this.document.createElement("link");
    tempLink.rel = 'stylesheet';
    tempLink.href = href;
    tempLink.__LiveReload_pendingRemoval = true;
    if (link.parentNode) {
      link.parentNode.insertBefore(tempLink, link);
    }
    return this.Timer.start(this.importCacheWaitPeriod, __bind(function() {
      if (tempLink.parentNode) {
        tempLink.parentNode.removeChild(tempLink);
      }
      if (rule.__LiveReload_newHref !== href) {
        return;
      }
      parent.insertRule(newRule, index);
      parent.deleteRule(index + 1);
      rule = parent.cssRules[index];
      rule.__LiveReload_newHref = href;
      return this.Timer.start(this.importCacheWaitPeriod, __bind(function() {
        if (rule.__LiveReload_newHref !== href) {
          return;
        }
        parent.insertRule(newRule, index);
        return parent.deleteRule(index + 1);
      }, this));
    }, this));
  };
  Reloader.prototype.generateUniqueString = function() {
    return 'livereload=' + Date.now();
  };
  Reloader.prototype.generateCacheBustUrl = function(url, expando) {
    var hash, oldParams, params, _ref;
    if (expando == null) {
      expando = this.generateUniqueString();
    }
    _ref = splitUrl(url), url = _ref.url, hash = _ref.hash, oldParams = _ref.params;
    params = oldParams.replace(/(\?|&)livereload=(\d+)/, function(match, sep) {
      return "" + sep + expando;
    });
    if (params === oldParams) {
      if (oldParams.length === 0) {
        params = "?" + expando;
      } else {
        params = "" + oldParams + "&" + expando;
      }
    }
    return url + params + hash;
  };
  return Reloader;
})();

// livereload
var Connector, LiveReload, Options, Reloader, Timer;
var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; };
Connector = __connector.Connector;
Timer = __timer.Timer;
Options = __options.Options;
Reloader = __reloader.Reloader;
__livereload.LiveReload = LiveReload = (function() {
  function LiveReload(window) {
    this.window = window;
    this.listeners = {};
    this.console = this.window.console && this.window.console.log && this.window.console.error ? this.window.console : {
      log: function() {},
      error: function() {}
    };
    if (!(this.WebSocket = this.window.WebSocket || this.window.MozWebSocket)) {
      console.error("LiveReload disabled because the browser does not seem to support web sockets");
      return;
    }
    if (!(this.options = Options.extract(this.window.document))) {
      console.error("LiveReload disabled because it could not find its own <SCRIPT> tag");
      return;
    }
    this.reloader = new Reloader(this.window, this.console, Timer);
    this.connector = new Connector(this.options, this.WebSocket, Timer, {
      connecting: __bind(function() {}, this),
      socketConnected: __bind(function() {}, this),
      connected: __bind(function(protocol) {
        var _base;
        if (typeof (_base = this.listeners).connect === "function") {
          _base.connect();
        }
        return this.log("LiveReload is connected to " + this.options.host + ":" + this.options.port + " (protocol v" + protocol + ").");
      }, this),
      error: __bind(function(e) {
        if (e instanceof ProtocolError) {
          return console.log("" + e.message + ".");
        } else {
          return console.log("LiveReload internal error: " + e.message);
        }
      }, this),
      disconnected: __bind(function(reason, nextDelay) {
        var _base;
        if (typeof (_base = this.listeners).disconnect === "function") {
          _base.disconnect();
        }
        switch (reason) {
          case 'cannot-connect':
            return this.log("LiveReload cannot connect to " + this.options.host + ":" + this.options.port + ", will retry in " + nextDelay + " sec.");
          case 'broken':
            return this.log("LiveReload disconnected from " + this.options.host + ":" + this.options.port + ", reconnecting in " + nextDelay + " sec.");
          case 'handshake-timeout':
            return this.log("LiveReload cannot connect to " + this.options.host + ":" + this.options.port + " (handshake timeout), will retry in " + nextDelay + " sec.");
          case 'handshake-failed':
            return this.log("LiveReload cannot connect to " + this.options.host + ":" + this.options.port + " (handshake failed), will retry in " + nextDelay + " sec.");
          case 'manual':
            break;
          case 'error':
            break;
          default:
            return this.log("LiveReload disconnected from " + this.options.host + ":" + this.options.port + " (" + reason + "), reconnecting in " + nextDelay + " sec.");
        }
      }, this),
      message: __bind(function(message) {
        switch (message.command) {
          case 'reload':
            return this.performReload(message);
          case 'alert':
            return this.performAlert(message);
        }
      }, this)
    });
  }
  LiveReload.prototype.on = function(eventName, handler) {
    return this.listeners[eventName] = handler;
  };
  LiveReload.prototype.log = function(message) {
    return this.console.log("" + message);
  };
  LiveReload.prototype.performReload = function(message) {
    var _ref, _ref2;
    this.log("LiveReload received reload request for " + message.path + ".");
    return this.reloader.reload(message.path, {
      liveCSS: (_ref = message.liveCSS) != null ? _ref : true,
      liveImg: (_ref2 = message.liveImg) != null ? _ref2 : true
    });
  };
  LiveReload.prototype.performAlert = function(message) {
    return alert(message.message);
  };
  LiveReload.prototype.shutDown = function() {
    var _base;
    this.connector.disconnect();
    this.log("LiveReload disconnected.");
    return typeof (_base = this.listeners).shutdown === "function" ? _base.shutdown() : void 0;
  };
  return LiveReload;
})();

// startup
var CustomEvents, LiveReload;
CustomEvents = __customevents;
LiveReload = window.LiveReload = new (__livereload.LiveReload)(window);
LiveReload.on('shutdown', function() {
  return delete window.LiveReload;
});
LiveReload.on('connect', function() {
  return CustomEvents.fire(document, 'LiveReloadConnect');
});
LiveReload.on('disconnect', function() {
  return CustomEvents.fire(document, 'LiveReloadDisconnect');
});
CustomEvents.bind(document, 'LiveReloadShutDown', function() {
  return LiveReload.shutDown();
});
})();