"format global";
(function(global) {

  var defined = {};

  // indexOf polyfill for IE8
  var indexOf = Array.prototype.indexOf || function(item) {
    for (var i = 0, l = this.length; i < l; i++)
      if (this[i] === item)
        return i;
    return -1;
  }

  var getOwnPropertyDescriptor = true;
  try {
    Object.getOwnPropertyDescriptor({ a: 0 }, 'a');
  }
  catch(e) {
    getOwnPropertyDescriptor = false;
  }

  var defineProperty;
  (function () {
    try {
      if (!!Object.defineProperty({}, 'a', {}))
        defineProperty = Object.defineProperty;
    }
    catch (e) {
      defineProperty = function(obj, prop, opt) {
        try {
          obj[prop] = opt.value || opt.get.call(obj);
        }
        catch(e) {}
      }
    }
  })();

  function register(name, deps, declare) {
    if (arguments.length === 4)
      return registerDynamic.apply(this, arguments);
    doRegister(name, {
      declarative: true,
      deps: deps,
      declare: declare
    });
  }

  function registerDynamic(name, deps, executingRequire, execute) {
    doRegister(name, {
      declarative: false,
      deps: deps,
      executingRequire: executingRequire,
      execute: execute
    });
  }

  function doRegister(name, entry) {
    entry.name = name;

    // we never overwrite an existing define
    if (!(name in defined))
      defined[name] = entry;

    // we have to normalize dependencies
    // (assume dependencies are normalized for now)
    // entry.normalizedDeps = entry.deps.map(normalize);
    entry.normalizedDeps = entry.deps;
  }


  function buildGroups(entry, groups) {
    groups[entry.groupIndex] = groups[entry.groupIndex] || [];

    if (indexOf.call(groups[entry.groupIndex], entry) != -1)
      return;

    groups[entry.groupIndex].push(entry);

    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      var depEntry = defined[depName];

      // not in the registry means already linked / ES6
      if (!depEntry || depEntry.evaluated)
        continue;

      // now we know the entry is in our unlinked linkage group
      var depGroupIndex = entry.groupIndex + (depEntry.declarative != entry.declarative);

      // the group index of an entry is always the maximum
      if (depEntry.groupIndex === undefined || depEntry.groupIndex < depGroupIndex) {

        // if already in a group, remove from the old group
        if (depEntry.groupIndex !== undefined) {
          groups[depEntry.groupIndex].splice(indexOf.call(groups[depEntry.groupIndex], depEntry), 1);

          // if the old group is empty, then we have a mixed depndency cycle
          if (groups[depEntry.groupIndex].length == 0)
            throw new TypeError("Mixed dependency cycle detected");
        }

        depEntry.groupIndex = depGroupIndex;
      }

      buildGroups(depEntry, groups);
    }
  }

  function link(name) {
    var startEntry = defined[name];

    startEntry.groupIndex = 0;

    var groups = [];

    buildGroups(startEntry, groups);

    var curGroupDeclarative = !!startEntry.declarative == groups.length % 2;
    for (var i = groups.length - 1; i >= 0; i--) {
      var group = groups[i];
      for (var j = 0; j < group.length; j++) {
        var entry = group[j];

        // link each group
        if (curGroupDeclarative)
          linkDeclarativeModule(entry);
        else
          linkDynamicModule(entry);
      }
      curGroupDeclarative = !curGroupDeclarative; 
    }
  }

  // module binding records
  var moduleRecords = {};
  function getOrCreateModuleRecord(name) {
    return moduleRecords[name] || (moduleRecords[name] = {
      name: name,
      dependencies: [],
      exports: {}, // start from an empty module and extend
      importers: []
    })
  }

  function linkDeclarativeModule(entry) {
    // only link if already not already started linking (stops at circular)
    if (entry.module)
      return;

    var module = entry.module = getOrCreateModuleRecord(entry.name);
    var exports = entry.module.exports;

    var declaration = entry.declare.call(global, function(name, value) {
      module.locked = true;

      if (typeof name == 'object') {
        for (var p in name)
          exports[p] = name[p];
      }
      else {
        exports[name] = value;
      }

      for (var i = 0, l = module.importers.length; i < l; i++) {
        var importerModule = module.importers[i];
        if (!importerModule.locked) {
          for (var j = 0; j < importerModule.dependencies.length; ++j) {
            if (importerModule.dependencies[j] === module) {
              importerModule.setters[j](exports);
            }
          }
        }
      }

      module.locked = false;
      return value;
    });

    module.setters = declaration.setters;
    module.execute = declaration.execute;

    // now link all the module dependencies
    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      var depEntry = defined[depName];
      var depModule = moduleRecords[depName];

      // work out how to set depExports based on scenarios...
      var depExports;

      if (depModule) {
        depExports = depModule.exports;
      }
      else if (depEntry && !depEntry.declarative) {
        depExports = depEntry.esModule;
      }
      // in the module registry
      else if (!depEntry) {
        depExports = load(depName);
      }
      // we have an entry -> link
      else {
        linkDeclarativeModule(depEntry);
        depModule = depEntry.module;
        depExports = depModule.exports;
      }

      // only declarative modules have dynamic bindings
      if (depModule && depModule.importers) {
        depModule.importers.push(module);
        module.dependencies.push(depModule);
      }
      else
        module.dependencies.push(null);

      // run the setter for this dependency
      if (module.setters[i])
        module.setters[i](depExports);
    }
  }

  // An analog to loader.get covering execution of all three layers (real declarative, simulated declarative, simulated dynamic)
  function getModule(name) {
    var exports;
    var entry = defined[name];

    if (!entry) {
      exports = load(name);
      if (!exports)
        throw new Error("Unable to load dependency " + name + ".");
    }

    else {
      if (entry.declarative)
        ensureEvaluated(name, []);

      else if (!entry.evaluated)
        linkDynamicModule(entry);

      exports = entry.module.exports;
    }

    if ((!entry || entry.declarative) && exports && exports.__useDefault)
      return exports['default'];

    return exports;
  }

  function linkDynamicModule(entry) {
    if (entry.module)
      return;

    var exports = {};

    var module = entry.module = { exports: exports, id: entry.name };

    // AMD requires execute the tree first
    if (!entry.executingRequire) {
      for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
        var depName = entry.normalizedDeps[i];
        var depEntry = defined[depName];
        if (depEntry)
          linkDynamicModule(depEntry);
      }
    }

    // now execute
    entry.evaluated = true;
    var output = entry.execute.call(global, function(name) {
      for (var i = 0, l = entry.deps.length; i < l; i++) {
        if (entry.deps[i] != name)
          continue;
        return getModule(entry.normalizedDeps[i]);
      }
      throw new TypeError('Module ' + name + ' not declared as a dependency.');
    }, exports, module);

    if (output)
      module.exports = output;

    // create the esModule object, which allows ES6 named imports of dynamics
    exports = module.exports;
 
    if (exports && exports.__esModule) {
      entry.esModule = exports;
    }
    else {
      entry.esModule = {};
      
      // don't trigger getters/setters in environments that support them
      if (typeof exports == 'object' || typeof exports == 'function') {
        if (getOwnPropertyDescriptor) {
          var d;
          for (var p in exports)
            if (d = Object.getOwnPropertyDescriptor(exports, p))
              defineProperty(entry.esModule, p, d);
        }
        else {
          var hasOwnProperty = exports && exports.hasOwnProperty;
          for (var p in exports) {
            if (!hasOwnProperty || exports.hasOwnProperty(p))
              entry.esModule[p] = exports[p];
          }
         }
       }
      entry.esModule['default'] = exports;
      defineProperty(entry.esModule, '__useDefault', {
        value: true
      });
    }
  }

  /*
   * Given a module, and the list of modules for this current branch,
   *  ensure that each of the dependencies of this module is evaluated
   *  (unless one is a circular dependency already in the list of seen
   *  modules, in which case we execute it)
   *
   * Then we evaluate the module itself depth-first left to right 
   * execution to match ES6 modules
   */
  function ensureEvaluated(moduleName, seen) {
    var entry = defined[moduleName];

    // if already seen, that means it's an already-evaluated non circular dependency
    if (!entry || entry.evaluated || !entry.declarative)
      return;

    // this only applies to declarative modules which late-execute

    seen.push(moduleName);

    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      if (indexOf.call(seen, depName) == -1) {
        if (!defined[depName])
          load(depName);
        else
          ensureEvaluated(depName, seen);
      }
    }

    if (entry.evaluated)
      return;

    entry.evaluated = true;
    entry.module.execute.call(global);
  }

  // magical execution function
  var modules = {};
  function load(name) {
    if (modules[name])
      return modules[name];

    // node core modules
    if (name.substr(0, 6) == '@node/')
      return require(name.substr(6));

    var entry = defined[name];

    // first we check if this module has already been defined in the registry
    if (!entry)
      throw "Module " + name + " not present.";

    // recursively ensure that the module and all its 
    // dependencies are linked (with dependency group handling)
    link(name);

    // now handle dependency execution in correct order
    ensureEvaluated(name, []);

    // remove from the registry
    defined[name] = undefined;

    // exported modules get __esModule defined for interop
    if (entry.declarative)
      defineProperty(entry.module.exports, '__esModule', { value: true });

    // return the defined module object
    return modules[name] = entry.declarative ? entry.module.exports : entry.esModule;
  };

  return function(mains, depNames, declare) {
    return function(formatDetect) {
      formatDetect(function(deps) {
        var System = {
          _nodeRequire: typeof require != 'undefined' && require.resolve && typeof process != 'undefined' && require,
          register: register,
          registerDynamic: registerDynamic,
          get: load, 
          set: function(name, module) {
            modules[name] = module; 
          },
          newModule: function(module) {
            return module;
          }
        };
        System.set('@empty', {});

        // register external dependencies
        for (var i = 0; i < depNames.length; i++) (function(depName, dep) {
          if (dep && dep.__esModule)
            System.register(depName, [], function(_export) {
              return {
                setters: [],
                execute: function() {
                  for (var p in dep)
                    if (p != '__esModule' && !(typeof p == 'object' && p + '' == 'Module'))
                      _export(p, dep[p]);
                }
              };
            });
          else
            System.registerDynamic(depName, [], false, function() {
              return dep;
            });
        })(depNames[i], arguments[i]);

        // register modules in this bundle
        declare(System);

        // load mains
        var firstLoad = load(mains[0]);
        if (mains.length > 1)
          for (var i = 1; i < mains.length; i++)
            load(mains[i]);

        if (firstLoad.__useDefault)
          return firstLoad['default'];
        else
          return firstLoad;
      });
    };
  };

})(typeof self != 'undefined' ? self : global)
/* (['mainModule'], ['external-dep'], function($__System) {
  System.register(...);
})
(function(factory) {
  if (typeof define && define.amd)
    define(['external-dep'], factory);
  // etc UMD / module pattern
})*/

(['1'], [], function($__System) {

$__System.registerDynamic("2", [], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var process = module.exports = {};
  var queue = [];
  var draining = false;
  function drainQueue() {
    if (draining) {
      return;
    }
    draining = true;
    var currentQueue;
    var len = queue.length;
    while (len) {
      currentQueue = queue;
      queue = [];
      var i = -1;
      while (++i < len) {
        currentQueue[i]();
      }
      len = queue.length;
    }
    draining = false;
  }
  process.nextTick = function(fun) {
    queue.push(fun);
    if (!draining) {
      setTimeout(drainQueue, 0);
    }
  };
  process.title = 'browser';
  process.browser = true;
  process.env = {};
  process.argv = [];
  process.version = '';
  process.versions = {};
  function noop() {}
  process.on = noop;
  process.addListener = noop;
  process.once = noop;
  process.off = noop;
  process.removeListener = noop;
  process.removeAllListeners = noop;
  process.emit = noop;
  process.binding = function(name) {
    throw new Error('process.binding is not supported');
  };
  process.cwd = function() {
    return '/';
  };
  process.chdir = function(dir) {
    throw new Error('process.chdir is not supported');
  };
  process.umask = function() {
    return 0;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3", ["2"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = require("2");
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4", ["3"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__System._nodeRequire ? process : require("3");
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("5", ["4"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = require("4");
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("6", ["5"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    (function(window, document, undefined) {
      'use strict';
      function minErr(module, ErrorConstructor) {
        ErrorConstructor = ErrorConstructor || Error;
        return function() {
          var SKIP_INDEXES = 2;
          var templateArgs = arguments,
              code = templateArgs[0],
              message = '[' + (module ? module + ':' : '') + code + '] ',
              template = templateArgs[1],
              paramPrefix,
              i;
          message += template.replace(/\{\d+\}/g, function(match) {
            var index = +match.slice(1, -1),
                shiftedIndex = index + SKIP_INDEXES;
            if (shiftedIndex < templateArgs.length) {
              return toDebugString(templateArgs[shiftedIndex]);
            }
            return match;
          });
          message += '\nhttp://errors.angularjs.org/1.5.0-beta.0/' + (module ? module + '/' : '') + code;
          for (i = SKIP_INDEXES, paramPrefix = '?'; i < templateArgs.length; i++, paramPrefix = '&') {
            message += paramPrefix + 'p' + (i - SKIP_INDEXES) + '=' + encodeURIComponent(toDebugString(templateArgs[i]));
          }
          return new ErrorConstructor(message);
        };
      }
      var REGEX_STRING_REGEXP = /^\/(.+)\/([a-z]*)$/;
      var VALIDITY_STATE_PROPERTY = 'validity';
      var lowercase = function(string) {
        return isString(string) ? string.toLowerCase() : string;
      };
      var hasOwnProperty = Object.prototype.hasOwnProperty;
      var uppercase = function(string) {
        return isString(string) ? string.toUpperCase() : string;
      };
      var manualLowercase = function(s) {
        return isString(s) ? s.replace(/[A-Z]/g, function(ch) {
          return String.fromCharCode(ch.charCodeAt(0) | 32);
        }) : s;
      };
      var manualUppercase = function(s) {
        return isString(s) ? s.replace(/[a-z]/g, function(ch) {
          return String.fromCharCode(ch.charCodeAt(0) & ~32);
        }) : s;
      };
      if ('i' !== 'I'.toLowerCase()) {
        lowercase = manualLowercase;
        uppercase = manualUppercase;
      }
      var msie,
          jqLite,
          jQuery,
          slice = [].slice,
          splice = [].splice,
          push = [].push,
          toString = Object.prototype.toString,
          getPrototypeOf = Object.getPrototypeOf,
          ngMinErr = minErr('ng'),
          angular = window.angular || (window.angular = {}),
          angularModule,
          uid = 0;
      msie = document.documentMode;
      function isArrayLike(obj) {
        if (obj == null || isWindow(obj)) {
          return false;
        }
        var length = "length" in Object(obj) && obj.length;
        if (obj.nodeType === NODE_TYPE_ELEMENT && length) {
          return true;
        }
        return isString(obj) || isArray(obj) || length === 0 || typeof length === 'number' && length > 0 && (length - 1) in obj;
      }
      function forEach(obj, iterator, context) {
        var key,
            length;
        if (obj) {
          if (isFunction(obj)) {
            for (key in obj) {
              if (key != 'prototype' && key != 'length' && key != 'name' && (!obj.hasOwnProperty || obj.hasOwnProperty(key))) {
                iterator.call(context, obj[key], key, obj);
              }
            }
          } else if (isArray(obj) || isArrayLike(obj)) {
            var isPrimitive = typeof obj !== 'object';
            for (key = 0, length = obj.length; key < length; key++) {
              if (isPrimitive || key in obj) {
                iterator.call(context, obj[key], key, obj);
              }
            }
          } else if (obj.forEach && obj.forEach !== forEach) {
            obj.forEach(iterator, context, obj);
          } else if (isBlankObject(obj)) {
            for (key in obj) {
              iterator.call(context, obj[key], key, obj);
            }
          } else if (typeof obj.hasOwnProperty === 'function') {
            for (key in obj) {
              if (obj.hasOwnProperty(key)) {
                iterator.call(context, obj[key], key, obj);
              }
            }
          } else {
            for (key in obj) {
              if (hasOwnProperty.call(obj, key)) {
                iterator.call(context, obj[key], key, obj);
              }
            }
          }
        }
        return obj;
      }
      function forEachSorted(obj, iterator, context) {
        var keys = Object.keys(obj).sort();
        for (var i = 0; i < keys.length; i++) {
          iterator.call(context, obj[keys[i]], keys[i]);
        }
        return keys;
      }
      function reverseParams(iteratorFn) {
        return function(value, key) {
          iteratorFn(key, value);
        };
      }
      function nextUid() {
        return ++uid;
      }
      function setHashKey(obj, h) {
        if (h) {
          obj.$$hashKey = h;
        } else {
          delete obj.$$hashKey;
        }
      }
      function baseExtend(dst, objs, deep) {
        var h = dst.$$hashKey;
        for (var i = 0,
            ii = objs.length; i < ii; ++i) {
          var obj = objs[i];
          if (!isObject(obj) && !isFunction(obj))
            continue;
          var keys = Object.keys(obj);
          for (var j = 0,
              jj = keys.length; j < jj; j++) {
            var key = keys[j];
            var src = obj[key];
            if (deep && isObject(src)) {
              if (isDate(src)) {
                dst[key] = new Date(src.valueOf());
              } else if (isRegExp(src)) {
                dst[key] = new RegExp(src);
              } else {
                if (!isObject(dst[key]))
                  dst[key] = isArray(src) ? [] : {};
                baseExtend(dst[key], [src], true);
              }
            } else {
              dst[key] = src;
            }
          }
        }
        setHashKey(dst, h);
        return dst;
      }
      function extend(dst) {
        return baseExtend(dst, slice.call(arguments, 1), false);
      }
      function merge(dst) {
        return baseExtend(dst, slice.call(arguments, 1), true);
      }
      function toInt(str) {
        return parseInt(str, 10);
      }
      function inherit(parent, extra) {
        return extend(Object.create(parent), extra);
      }
      function noop() {}
      noop.$inject = [];
      function identity($) {
        return $;
      }
      identity.$inject = [];
      function valueFn(value) {
        return function() {
          return value;
        };
      }
      function hasCustomToString(obj) {
        return isFunction(obj.toString) && obj.toString !== Object.prototype.toString;
      }
      function isUndefined(value) {
        return typeof value === 'undefined';
      }
      function isDefined(value) {
        return typeof value !== 'undefined';
      }
      function isObject(value) {
        return value !== null && typeof value === 'object';
      }
      function isBlankObject(value) {
        return value !== null && typeof value === 'object' && !getPrototypeOf(value);
      }
      function isString(value) {
        return typeof value === 'string';
      }
      function isNumber(value) {
        return typeof value === 'number';
      }
      function isDate(value) {
        return toString.call(value) === '[object Date]';
      }
      var isArray = Array.isArray;
      function isFunction(value) {
        return typeof value === 'function';
      }
      function isRegExp(value) {
        return toString.call(value) === '[object RegExp]';
      }
      function isWindow(obj) {
        return obj && obj.window === obj;
      }
      function isScope(obj) {
        return obj && obj.$evalAsync && obj.$watch;
      }
      function isFile(obj) {
        return toString.call(obj) === '[object File]';
      }
      function isFormData(obj) {
        return toString.call(obj) === '[object FormData]';
      }
      function isBlob(obj) {
        return toString.call(obj) === '[object Blob]';
      }
      function isBoolean(value) {
        return typeof value === 'boolean';
      }
      function isPromiseLike(obj) {
        return obj && isFunction(obj.then);
      }
      var TYPED_ARRAY_REGEXP = /^\[object (Uint8(Clamped)?)|(Uint16)|(Uint32)|(Int8)|(Int16)|(Int32)|(Float(32)|(64))Array\]$/;
      function isTypedArray(value) {
        return TYPED_ARRAY_REGEXP.test(toString.call(value));
      }
      var trim = function(value) {
        return isString(value) ? value.trim() : value;
      };
      var escapeForRegexp = function(s) {
        return s.replace(/([-()\[\]{}+?*.$\^|,:#<!\\])/g, '\\$1').replace(/\x08/g, '\\x08');
      };
      function isElement(node) {
        return !!(node && (node.nodeName || (node.prop && node.attr && node.find)));
      }
      function makeMap(str) {
        var obj = {},
            items = str.split(","),
            i;
        for (i = 0; i < items.length; i++) {
          obj[items[i]] = true;
        }
        return obj;
      }
      function nodeName_(element) {
        return lowercase(element.nodeName || (element[0] && element[0].nodeName));
      }
      function includes(array, obj) {
        return Array.prototype.indexOf.call(array, obj) != -1;
      }
      function arrayRemove(array, value) {
        var index = array.indexOf(value);
        if (index >= 0) {
          array.splice(index, 1);
        }
        return index;
      }
      function copy(source, destination, stackSource, stackDest) {
        if (isWindow(source) || isScope(source)) {
          throw ngMinErr('cpws', "Can't copy! Making copies of Window or Scope instances is not supported.");
        }
        if (isTypedArray(destination)) {
          throw ngMinErr('cpta', "Can't copy! TypedArray destination cannot be mutated.");
        }
        if (!destination) {
          destination = source;
          if (isObject(source)) {
            var index;
            if (stackSource && (index = stackSource.indexOf(source)) !== -1) {
              return stackDest[index];
            }
            if (isArray(source)) {
              return copy(source, [], stackSource, stackDest);
            } else if (isTypedArray(source)) {
              destination = new source.constructor(source);
            } else if (isDate(source)) {
              destination = new Date(source.getTime());
            } else if (isRegExp(source)) {
              destination = new RegExp(source.source, source.toString().match(/[^\/]*$/)[0]);
              destination.lastIndex = source.lastIndex;
            } else if (isFunction(source.cloneNode)) {
              destination = source.cloneNode(true);
            } else {
              var emptyObject = Object.create(getPrototypeOf(source));
              return copy(source, emptyObject, stackSource, stackDest);
            }
            if (stackDest) {
              stackSource.push(source);
              stackDest.push(destination);
            }
          }
        } else {
          if (source === destination)
            throw ngMinErr('cpi', "Can't copy! Source and destination are identical.");
          stackSource = stackSource || [];
          stackDest = stackDest || [];
          if (isObject(source)) {
            stackSource.push(source);
            stackDest.push(destination);
          }
          var result,
              key;
          if (isArray(source)) {
            destination.length = 0;
            for (var i = 0; i < source.length; i++) {
              destination.push(copy(source[i], null, stackSource, stackDest));
            }
          } else {
            var h = destination.$$hashKey;
            if (isArray(destination)) {
              destination.length = 0;
            } else {
              forEach(destination, function(value, key) {
                delete destination[key];
              });
            }
            if (isBlankObject(source)) {
              for (key in source) {
                destination[key] = copy(source[key], null, stackSource, stackDest);
              }
            } else if (source && typeof source.hasOwnProperty === 'function') {
              for (key in source) {
                if (source.hasOwnProperty(key)) {
                  destination[key] = copy(source[key], null, stackSource, stackDest);
                }
              }
            } else {
              for (key in source) {
                if (hasOwnProperty.call(source, key)) {
                  destination[key] = copy(source[key], null, stackSource, stackDest);
                }
              }
            }
            setHashKey(destination, h);
          }
        }
        return destination;
      }
      function shallowCopy(src, dst) {
        if (isArray(src)) {
          dst = dst || [];
          for (var i = 0,
              ii = src.length; i < ii; i++) {
            dst[i] = src[i];
          }
        } else if (isObject(src)) {
          dst = dst || {};
          for (var key in src) {
            if (!(key.charAt(0) === '$' && key.charAt(1) === '$')) {
              dst[key] = src[key];
            }
          }
        }
        return dst || src;
      }
      function equals(o1, o2) {
        if (o1 === o2)
          return true;
        if (o1 === null || o2 === null)
          return false;
        if (o1 !== o1 && o2 !== o2)
          return true;
        var t1 = typeof o1,
            t2 = typeof o2,
            length,
            key,
            keySet;
        if (t1 == t2) {
          if (t1 == 'object') {
            if (isArray(o1)) {
              if (!isArray(o2))
                return false;
              if ((length = o1.length) == o2.length) {
                for (key = 0; key < length; key++) {
                  if (!equals(o1[key], o2[key]))
                    return false;
                }
                return true;
              }
            } else if (isDate(o1)) {
              if (!isDate(o2))
                return false;
              return equals(o1.getTime(), o2.getTime());
            } else if (isRegExp(o1)) {
              return isRegExp(o2) ? o1.toString() == o2.toString() : false;
            } else {
              if (isScope(o1) || isScope(o2) || isWindow(o1) || isWindow(o2) || isArray(o2) || isDate(o2) || isRegExp(o2))
                return false;
              keySet = createMap();
              for (key in o1) {
                if (key.charAt(0) === '$' || isFunction(o1[key]))
                  continue;
                if (!equals(o1[key], o2[key]))
                  return false;
                keySet[key] = true;
              }
              for (key in o2) {
                if (!(key in keySet) && key.charAt(0) !== '$' && isDefined(o2[key]) && !isFunction(o2[key]))
                  return false;
              }
              return true;
            }
          }
        }
        return false;
      }
      var csp = function() {
        if (!isDefined(csp.rules)) {
          var ngCspElement = (document.querySelector('[ng-csp]') || document.querySelector('[data-ng-csp]'));
          if (ngCspElement) {
            var ngCspAttribute = ngCspElement.getAttribute('ng-csp') || ngCspElement.getAttribute('data-ng-csp');
            csp.rules = {
              noUnsafeEval: !ngCspAttribute || (ngCspAttribute.indexOf('no-unsafe-eval') !== -1),
              noInlineStyle: !ngCspAttribute || (ngCspAttribute.indexOf('no-inline-style') !== -1)
            };
          } else {
            csp.rules = {
              noUnsafeEval: noUnsafeEval(),
              noInlineStyle: false
            };
          }
        }
        return csp.rules;
        function noUnsafeEval() {
          try {
            new Function('');
            return false;
          } catch (e) {
            return true;
          }
        }
      };
      var jq = function() {
        if (isDefined(jq.name_))
          return jq.name_;
        var el;
        var i,
            ii = ngAttrPrefixes.length,
            prefix,
            name;
        for (i = 0; i < ii; ++i) {
          prefix = ngAttrPrefixes[i];
          if (el = document.querySelector('[' + prefix.replace(':', '\\:') + 'jq]')) {
            name = el.getAttribute(prefix + 'jq');
            break;
          }
        }
        return (jq.name_ = name);
      };
      function concat(array1, array2, index) {
        return array1.concat(slice.call(array2, index));
      }
      function sliceArgs(args, startIndex) {
        return slice.call(args, startIndex || 0);
      }
      function bind(self, fn) {
        var curryArgs = arguments.length > 2 ? sliceArgs(arguments, 2) : [];
        if (isFunction(fn) && !(fn instanceof RegExp)) {
          return curryArgs.length ? function() {
            return arguments.length ? fn.apply(self, concat(curryArgs, arguments, 0)) : fn.apply(self, curryArgs);
          } : function() {
            return arguments.length ? fn.apply(self, arguments) : fn.call(self);
          };
        } else {
          return fn;
        }
      }
      function toJsonReplacer(key, value) {
        var val = value;
        if (typeof key === 'string' && key.charAt(0) === '$' && key.charAt(1) === '$') {
          val = undefined;
        } else if (isWindow(value)) {
          val = '$WINDOW';
        } else if (value && document === value) {
          val = '$DOCUMENT';
        } else if (isScope(value)) {
          val = '$SCOPE';
        }
        return val;
      }
      function toJson(obj, pretty) {
        if (typeof obj === 'undefined')
          return undefined;
        if (!isNumber(pretty)) {
          pretty = pretty ? 2 : null;
        }
        return JSON.stringify(obj, toJsonReplacer, pretty);
      }
      function fromJson(json) {
        return isString(json) ? JSON.parse(json) : json;
      }
      function timezoneToOffset(timezone, fallback) {
        var requestedTimezoneOffset = Date.parse('Jan 01, 1970 00:00:00 ' + timezone) / 60000;
        return isNaN(requestedTimezoneOffset) ? fallback : requestedTimezoneOffset;
      }
      function addDateMinutes(date, minutes) {
        date = new Date(date.getTime());
        date.setMinutes(date.getMinutes() + minutes);
        return date;
      }
      function convertTimezoneToLocal(date, timezone, reverse) {
        reverse = reverse ? -1 : 1;
        var timezoneOffset = timezoneToOffset(timezone, date.getTimezoneOffset());
        return addDateMinutes(date, reverse * (timezoneOffset - date.getTimezoneOffset()));
      }
      function startingTag(element) {
        element = jqLite(element).clone();
        try {
          element.empty();
        } catch (e) {}
        var elemHtml = jqLite('<div>').append(element).html();
        try {
          return element[0].nodeType === NODE_TYPE_TEXT ? lowercase(elemHtml) : elemHtml.match(/^(<[^>]+>)/)[1].replace(/^<([\w\-]+)/, function(match, nodeName) {
            return '<' + lowercase(nodeName);
          });
        } catch (e) {
          return lowercase(elemHtml);
        }
      }
      function tryDecodeURIComponent(value) {
        try {
          return decodeURIComponent(value);
        } catch (e) {}
      }
      function parseKeyValue(keyValue) {
        var obj = {};
        forEach((keyValue || "").split('&'), function(keyValue) {
          var splitPoint,
              key,
              val;
          if (keyValue) {
            key = keyValue = keyValue.replace(/\+/g, '%20');
            splitPoint = keyValue.indexOf('=');
            if (splitPoint !== -1) {
              key = keyValue.substring(0, splitPoint);
              val = keyValue.substring(splitPoint + 1);
            }
            key = tryDecodeURIComponent(key);
            if (isDefined(key)) {
              val = isDefined(val) ? tryDecodeURIComponent(val) : true;
              if (!hasOwnProperty.call(obj, key)) {
                obj[key] = val;
              } else if (isArray(obj[key])) {
                obj[key].push(val);
              } else {
                obj[key] = [obj[key], val];
              }
            }
          }
        });
        return obj;
      }
      function toKeyValue(obj) {
        var parts = [];
        forEach(obj, function(value, key) {
          if (isArray(value)) {
            forEach(value, function(arrayValue) {
              parts.push(encodeUriQuery(key, true) + (arrayValue === true ? '' : '=' + encodeUriQuery(arrayValue, true)));
            });
          } else {
            parts.push(encodeUriQuery(key, true) + (value === true ? '' : '=' + encodeUriQuery(value, true)));
          }
        });
        return parts.length ? parts.join('&') : '';
      }
      function encodeUriSegment(val) {
        return encodeUriQuery(val, true).replace(/%26/gi, '&').replace(/%3D/gi, '=').replace(/%2B/gi, '+');
      }
      function encodeUriQuery(val, pctEncodeSpaces) {
        return encodeURIComponent(val).replace(/%40/gi, '@').replace(/%3A/gi, ':').replace(/%24/g, '$').replace(/%2C/gi, ',').replace(/%3B/gi, ';').replace(/%20/g, (pctEncodeSpaces ? '%20' : '+'));
      }
      var ngAttrPrefixes = ['ng-', 'data-ng-', 'ng:', 'x-ng-'];
      function getNgAttribute(element, ngAttr) {
        var attr,
            i,
            ii = ngAttrPrefixes.length;
        for (i = 0; i < ii; ++i) {
          attr = ngAttrPrefixes[i] + ngAttr;
          if (isString(attr = element.getAttribute(attr))) {
            return attr;
          }
        }
        return null;
      }
      function angularInit(element, bootstrap) {
        var appElement,
            module,
            config = {};
        forEach(ngAttrPrefixes, function(prefix) {
          var name = prefix + 'app';
          if (!appElement && element.hasAttribute && element.hasAttribute(name)) {
            appElement = element;
            module = element.getAttribute(name);
          }
        });
        forEach(ngAttrPrefixes, function(prefix) {
          var name = prefix + 'app';
          var candidate;
          if (!appElement && (candidate = element.querySelector('[' + name.replace(':', '\\:') + ']'))) {
            appElement = candidate;
            module = candidate.getAttribute(name);
          }
        });
        if (appElement) {
          config.strictDi = getNgAttribute(appElement, "strict-di") !== null;
          bootstrap(appElement, module ? [module] : [], config);
        }
      }
      function bootstrap(element, modules, config) {
        if (!isObject(config))
          config = {};
        var defaultConfig = {strictDi: false};
        config = extend(defaultConfig, config);
        var doBootstrap = function() {
          element = jqLite(element);
          if (element.injector()) {
            var tag = (element[0] === document) ? 'document' : startingTag(element);
            throw ngMinErr('btstrpd', "App Already Bootstrapped with this Element '{0}'", tag.replace(/</, '&lt;').replace(/>/, '&gt;'));
          }
          modules = modules || [];
          modules.unshift(['$provide', function($provide) {
            $provide.value('$rootElement', element);
          }]);
          if (config.debugInfoEnabled) {
            modules.push(['$compileProvider', function($compileProvider) {
              $compileProvider.debugInfoEnabled(true);
            }]);
          }
          modules.unshift('ng');
          var injector = createInjector(modules, config.strictDi);
          injector.invoke(['$rootScope', '$rootElement', '$compile', '$injector', function bootstrapApply(scope, element, compile, injector) {
            scope.$apply(function() {
              element.data('$injector', injector);
              compile(element)(scope);
            });
          }]);
          return injector;
        };
        var NG_ENABLE_DEBUG_INFO = /^NG_ENABLE_DEBUG_INFO!/;
        var NG_DEFER_BOOTSTRAP = /^NG_DEFER_BOOTSTRAP!/;
        if (window && NG_ENABLE_DEBUG_INFO.test(window.name)) {
          config.debugInfoEnabled = true;
          window.name = window.name.replace(NG_ENABLE_DEBUG_INFO, '');
        }
        if (window && !NG_DEFER_BOOTSTRAP.test(window.name)) {
          return doBootstrap();
        }
        window.name = window.name.replace(NG_DEFER_BOOTSTRAP, '');
        angular.resumeBootstrap = function(extraModules) {
          forEach(extraModules, function(module) {
            modules.push(module);
          });
          return doBootstrap();
        };
        if (isFunction(angular.resumeDeferredBootstrap)) {
          angular.resumeDeferredBootstrap();
        }
      }
      function reloadWithDebugInfo() {
        window.name = 'NG_ENABLE_DEBUG_INFO!' + window.name;
        window.location.reload();
      }
      function getTestability(rootElement) {
        var injector = angular.element(rootElement).injector();
        if (!injector) {
          throw ngMinErr('test', 'no injector found for element argument to getTestability');
        }
        return injector.get('$$testability');
      }
      var SNAKE_CASE_REGEXP = /[A-Z]/g;
      function snake_case(name, separator) {
        separator = separator || '_';
        return name.replace(SNAKE_CASE_REGEXP, function(letter, pos) {
          return (pos ? separator : '') + letter.toLowerCase();
        });
      }
      var bindJQueryFired = false;
      var skipDestroyOnNextJQueryCleanData;
      function bindJQuery() {
        var originalCleanData;
        if (bindJQueryFired) {
          return;
        }
        var jqName = jq();
        jQuery = isUndefined(jqName) ? window.jQuery : !jqName ? undefined : window[jqName];
        if (jQuery && jQuery.fn.on) {
          jqLite = jQuery;
          extend(jQuery.fn, {
            scope: JQLitePrototype.scope,
            isolateScope: JQLitePrototype.isolateScope,
            controller: JQLitePrototype.controller,
            injector: JQLitePrototype.injector,
            inheritedData: JQLitePrototype.inheritedData
          });
          originalCleanData = jQuery.cleanData;
          jQuery.cleanData = function(elems) {
            var events;
            if (!skipDestroyOnNextJQueryCleanData) {
              for (var i = 0,
                  elem; (elem = elems[i]) != null; i++) {
                events = jQuery._data(elem, "events");
                if (events && events.$destroy) {
                  jQuery(elem).triggerHandler('$destroy');
                }
              }
            } else {
              skipDestroyOnNextJQueryCleanData = false;
            }
            originalCleanData(elems);
          };
        } else {
          jqLite = JQLite;
        }
        angular.element = jqLite;
        bindJQueryFired = true;
      }
      function assertArg(arg, name, reason) {
        if (!arg) {
          throw ngMinErr('areq', "Argument '{0}' is {1}", (name || '?'), (reason || "required"));
        }
        return arg;
      }
      function assertArgFn(arg, name, acceptArrayAnnotation) {
        if (acceptArrayAnnotation && isArray(arg)) {
          arg = arg[arg.length - 1];
        }
        assertArg(isFunction(arg), name, 'not a function, got ' + (arg && typeof arg === 'object' ? arg.constructor.name || 'Object' : typeof arg));
        return arg;
      }
      function assertNotHasOwnProperty(name, context) {
        if (name === 'hasOwnProperty') {
          throw ngMinErr('badname', "hasOwnProperty is not a valid {0} name", context);
        }
      }
      function getter(obj, path, bindFnToScope) {
        if (!path)
          return obj;
        var keys = path.split('.');
        var key;
        var lastInstance = obj;
        var len = keys.length;
        for (var i = 0; i < len; i++) {
          key = keys[i];
          if (obj) {
            obj = (lastInstance = obj)[key];
          }
        }
        if (!bindFnToScope && isFunction(obj)) {
          return bind(lastInstance, obj);
        }
        return obj;
      }
      function getBlockNodes(nodes) {
        var node = nodes[0];
        var endNode = nodes[nodes.length - 1];
        var blockNodes;
        for (var i = 1; node !== endNode && (node = node.nextSibling); i++) {
          if (blockNodes || nodes[i] !== node) {
            if (!blockNodes) {
              blockNodes = jqLite(slice.call(nodes, 0, i));
            }
            blockNodes.push(node);
          }
        }
        return blockNodes || nodes;
      }
      function createMap() {
        return Object.create(null);
      }
      var NODE_TYPE_ELEMENT = 1;
      var NODE_TYPE_ATTRIBUTE = 2;
      var NODE_TYPE_TEXT = 3;
      var NODE_TYPE_COMMENT = 8;
      var NODE_TYPE_DOCUMENT = 9;
      var NODE_TYPE_DOCUMENT_FRAGMENT = 11;
      function setupModuleLoader(window) {
        var $injectorMinErr = minErr('$injector');
        var ngMinErr = minErr('ng');
        function ensure(obj, name, factory) {
          return obj[name] || (obj[name] = factory());
        }
        var angular = ensure(window, 'angular', Object);
        angular.$$minErr = angular.$$minErr || minErr;
        return ensure(angular, 'module', function() {
          var modules = {};
          return function module(name, requires, configFn) {
            var assertNotHasOwnProperty = function(name, context) {
              if (name === 'hasOwnProperty') {
                throw ngMinErr('badname', 'hasOwnProperty is not a valid {0} name', context);
              }
            };
            assertNotHasOwnProperty(name, 'module');
            if (requires && modules.hasOwnProperty(name)) {
              modules[name] = null;
            }
            return ensure(modules, name, function() {
              if (!requires) {
                throw $injectorMinErr('nomod', "Module '{0}' is not available! You either misspelled " + "the module name or forgot to load it. If registering a module ensure that you " + "specify the dependencies as the second argument.", name);
              }
              var invokeQueue = [];
              var configBlocks = [];
              var runBlocks = [];
              var config = invokeLater('$injector', 'invoke', 'push', configBlocks);
              var moduleInstance = {
                _invokeQueue: invokeQueue,
                _configBlocks: configBlocks,
                _runBlocks: runBlocks,
                requires: requires,
                name: name,
                provider: invokeLaterAndSetModuleName('$provide', 'provider'),
                factory: invokeLaterAndSetModuleName('$provide', 'factory'),
                service: invokeLaterAndSetModuleName('$provide', 'service'),
                value: invokeLater('$provide', 'value'),
                constant: invokeLater('$provide', 'constant', 'unshift'),
                decorator: invokeLaterAndSetModuleName('$provide', 'decorator'),
                animation: invokeLaterAndSetModuleName('$animateProvider', 'register'),
                filter: invokeLaterAndSetModuleName('$filterProvider', 'register'),
                controller: invokeLaterAndSetModuleName('$controllerProvider', 'register'),
                directive: invokeLaterAndSetModuleName('$compileProvider', 'directive'),
                config: config,
                run: function(block) {
                  runBlocks.push(block);
                  return this;
                }
              };
              if (configFn) {
                config(configFn);
              }
              return moduleInstance;
              function invokeLater(provider, method, insertMethod, queue) {
                if (!queue)
                  queue = invokeQueue;
                return function() {
                  queue[insertMethod || 'push']([provider, method, arguments]);
                  return moduleInstance;
                };
              }
              function invokeLaterAndSetModuleName(provider, method) {
                return function(recipeName, factoryFunction) {
                  if (factoryFunction && isFunction(factoryFunction))
                    factoryFunction.$$moduleName = name;
                  invokeQueue.push([provider, method, arguments]);
                  return moduleInstance;
                };
              }
            });
          };
        });
      }
      function serializeObject(obj) {
        var seen = [];
        return JSON.stringify(obj, function(key, val) {
          val = toJsonReplacer(key, val);
          if (isObject(val)) {
            if (seen.indexOf(val) >= 0)
              return '...';
            seen.push(val);
          }
          return val;
        });
      }
      function toDebugString(obj) {
        if (typeof obj === 'function') {
          return obj.toString().replace(/ \{[\s\S]*$/, '');
        } else if (isUndefined(obj)) {
          return 'undefined';
        } else if (typeof obj !== 'string') {
          return serializeObject(obj);
        }
        return obj;
      }
      var version = {
        full: '1.5.0-beta.0',
        major: 1,
        minor: 5,
        dot: 0,
        codeName: 'intialization-processation'
      };
      function publishExternalAPI(angular) {
        extend(angular, {
          'bootstrap': bootstrap,
          'copy': copy,
          'extend': extend,
          'merge': merge,
          'equals': equals,
          'element': jqLite,
          'forEach': forEach,
          'injector': createInjector,
          'noop': noop,
          'bind': bind,
          'toJson': toJson,
          'fromJson': fromJson,
          'identity': identity,
          'isUndefined': isUndefined,
          'isDefined': isDefined,
          'isString': isString,
          'isFunction': isFunction,
          'isObject': isObject,
          'isNumber': isNumber,
          'isElement': isElement,
          'isArray': isArray,
          'version': version,
          'isDate': isDate,
          'lowercase': lowercase,
          'uppercase': uppercase,
          'callbacks': {counter: 0},
          'getTestability': getTestability,
          '$$minErr': minErr,
          '$$csp': csp,
          'reloadWithDebugInfo': reloadWithDebugInfo
        });
        angularModule = setupModuleLoader(window);
        angularModule('ng', ['ngLocale'], ['$provide', function ngModule($provide) {
          $provide.provider({$$sanitizeUri: $$SanitizeUriProvider});
          $provide.provider('$compile', $CompileProvider).directive({
            a: htmlAnchorDirective,
            input: inputDirective,
            textarea: inputDirective,
            form: formDirective,
            script: scriptDirective,
            select: selectDirective,
            style: styleDirective,
            option: optionDirective,
            ngBind: ngBindDirective,
            ngBindHtml: ngBindHtmlDirective,
            ngBindTemplate: ngBindTemplateDirective,
            ngClass: ngClassDirective,
            ngClassEven: ngClassEvenDirective,
            ngClassOdd: ngClassOddDirective,
            ngCloak: ngCloakDirective,
            ngController: ngControllerDirective,
            ngForm: ngFormDirective,
            ngHide: ngHideDirective,
            ngIf: ngIfDirective,
            ngInclude: ngIncludeDirective,
            ngInit: ngInitDirective,
            ngNonBindable: ngNonBindableDirective,
            ngPluralize: ngPluralizeDirective,
            ngRepeat: ngRepeatDirective,
            ngShow: ngShowDirective,
            ngStyle: ngStyleDirective,
            ngSwitch: ngSwitchDirective,
            ngSwitchWhen: ngSwitchWhenDirective,
            ngSwitchDefault: ngSwitchDefaultDirective,
            ngOptions: ngOptionsDirective,
            ngTransclude: ngTranscludeDirective,
            ngModel: ngModelDirective,
            ngList: ngListDirective,
            ngChange: ngChangeDirective,
            pattern: patternDirective,
            ngPattern: patternDirective,
            required: requiredDirective,
            ngRequired: requiredDirective,
            minlength: minlengthDirective,
            ngMinlength: minlengthDirective,
            maxlength: maxlengthDirective,
            ngMaxlength: maxlengthDirective,
            ngValue: ngValueDirective,
            ngModelOptions: ngModelOptionsDirective
          }).directive({ngInclude: ngIncludeFillContentDirective}).directive(ngAttributeAliasDirectives).directive(ngEventDirectives);
          $provide.provider({
            $anchorScroll: $AnchorScrollProvider,
            $animate: $AnimateProvider,
            $animateCss: $CoreAnimateCssProvider,
            $$animateQueue: $$CoreAnimateQueueProvider,
            $$AnimateRunner: $$CoreAnimateRunnerProvider,
            $browser: $BrowserProvider,
            $cacheFactory: $CacheFactoryProvider,
            $controller: $ControllerProvider,
            $document: $DocumentProvider,
            $exceptionHandler: $ExceptionHandlerProvider,
            $filter: $FilterProvider,
            $$forceReflow: $$ForceReflowProvider,
            $interpolate: $InterpolateProvider,
            $interval: $IntervalProvider,
            $http: $HttpProvider,
            $httpParamSerializer: $HttpParamSerializerProvider,
            $httpParamSerializerJQLike: $HttpParamSerializerJQLikeProvider,
            $httpBackend: $HttpBackendProvider,
            $location: $LocationProvider,
            $log: $LogProvider,
            $parse: $ParseProvider,
            $rootScope: $RootScopeProvider,
            $q: $QProvider,
            $$q: $$QProvider,
            $sce: $SceProvider,
            $sceDelegate: $SceDelegateProvider,
            $sniffer: $SnifferProvider,
            $templateCache: $TemplateCacheProvider,
            $templateRequest: $TemplateRequestProvider,
            $$testability: $$TestabilityProvider,
            $timeout: $TimeoutProvider,
            $window: $WindowProvider,
            $$rAF: $$RAFProvider,
            $$jqLite: $$jqLiteProvider,
            $$HashMap: $$HashMapProvider,
            $$cookieReader: $$CookieReaderProvider
          });
        }]);
      }
      JQLite.expando = 'ng339';
      var jqCache = JQLite.cache = {},
          jqId = 1,
          addEventListenerFn = function(element, type, fn) {
            element.addEventListener(type, fn, false);
          },
          removeEventListenerFn = function(element, type, fn) {
            element.removeEventListener(type, fn, false);
          };
      JQLite._data = function(node) {
        return this.cache[node[this.expando]] || {};
      };
      function jqNextId() {
        return ++jqId;
      }
      var SPECIAL_CHARS_REGEXP = /([\:\-\_]+(.))/g;
      var MOZ_HACK_REGEXP = /^moz([A-Z])/;
      var MOUSE_EVENT_MAP = {
        mouseleave: "mouseout",
        mouseenter: "mouseover"
      };
      var jqLiteMinErr = minErr('jqLite');
      function camelCase(name) {
        return name.replace(SPECIAL_CHARS_REGEXP, function(_, separator, letter, offset) {
          return offset ? letter.toUpperCase() : letter;
        }).replace(MOZ_HACK_REGEXP, 'Moz$1');
      }
      var SINGLE_TAG_REGEXP = /^<([\w-]+)\s*\/?>(?:<\/\1>|)$/;
      var HTML_REGEXP = /<|&#?\w+;/;
      var TAG_NAME_REGEXP = /<([\w:-]+)/;
      var XHTML_TAG_REGEXP = /<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:-]+)[^>]*)\/>/gi;
      var wrapMap = {
        'option': [1, '<select multiple="multiple">', '</select>'],
        'thead': [1, '<table>', '</table>'],
        'col': [2, '<table><colgroup>', '</colgroup></table>'],
        'tr': [2, '<table><tbody>', '</tbody></table>'],
        'td': [3, '<table><tbody><tr>', '</tr></tbody></table>'],
        '_default': [0, "", ""]
      };
      wrapMap.optgroup = wrapMap.option;
      wrapMap.tbody = wrapMap.tfoot = wrapMap.colgroup = wrapMap.caption = wrapMap.thead;
      wrapMap.th = wrapMap.td;
      function jqLiteIsTextNode(html) {
        return !HTML_REGEXP.test(html);
      }
      function jqLiteAcceptsData(node) {
        var nodeType = node.nodeType;
        return nodeType === NODE_TYPE_ELEMENT || !nodeType || nodeType === NODE_TYPE_DOCUMENT;
      }
      function jqLiteHasData(node) {
        for (var key in jqCache[node.ng339]) {
          return true;
        }
        return false;
      }
      function jqLiteBuildFragment(html, context) {
        var tmp,
            tag,
            wrap,
            fragment = context.createDocumentFragment(),
            nodes = [],
            i;
        if (jqLiteIsTextNode(html)) {
          nodes.push(context.createTextNode(html));
        } else {
          tmp = tmp || fragment.appendChild(context.createElement("div"));
          tag = (TAG_NAME_REGEXP.exec(html) || ["", ""])[1].toLowerCase();
          wrap = wrapMap[tag] || wrapMap._default;
          tmp.innerHTML = wrap[1] + html.replace(XHTML_TAG_REGEXP, "<$1></$2>") + wrap[2];
          i = wrap[0];
          while (i--) {
            tmp = tmp.lastChild;
          }
          nodes = concat(nodes, tmp.childNodes);
          tmp = fragment.firstChild;
          tmp.textContent = "";
        }
        fragment.textContent = "";
        fragment.innerHTML = "";
        forEach(nodes, function(node) {
          fragment.appendChild(node);
        });
        return fragment;
      }
      function jqLiteParseHTML(html, context) {
        context = context || document;
        var parsed;
        if ((parsed = SINGLE_TAG_REGEXP.exec(html))) {
          return [context.createElement(parsed[1])];
        }
        if ((parsed = jqLiteBuildFragment(html, context))) {
          return parsed.childNodes;
        }
        return [];
      }
      function JQLite(element) {
        if (element instanceof JQLite) {
          return element;
        }
        var argIsString;
        if (isString(element)) {
          element = trim(element);
          argIsString = true;
        }
        if (!(this instanceof JQLite)) {
          if (argIsString && element.charAt(0) != '<') {
            throw jqLiteMinErr('nosel', 'Looking up elements via selectors is not supported by jqLite! See: http://docs.angularjs.org/api/angular.element');
          }
          return new JQLite(element);
        }
        if (argIsString) {
          jqLiteAddNodes(this, jqLiteParseHTML(element));
        } else {
          jqLiteAddNodes(this, element);
        }
      }
      function jqLiteClone(element) {
        return element.cloneNode(true);
      }
      function jqLiteDealoc(element, onlyDescendants) {
        if (!onlyDescendants)
          jqLiteRemoveData(element);
        if (element.querySelectorAll) {
          var descendants = element.querySelectorAll('*');
          for (var i = 0,
              l = descendants.length; i < l; i++) {
            jqLiteRemoveData(descendants[i]);
          }
        }
      }
      function jqLiteOff(element, type, fn, unsupported) {
        if (isDefined(unsupported))
          throw jqLiteMinErr('offargs', 'jqLite#off() does not support the `selector` argument');
        var expandoStore = jqLiteExpandoStore(element);
        var events = expandoStore && expandoStore.events;
        var handle = expandoStore && expandoStore.handle;
        if (!handle)
          return;
        if (!type) {
          for (type in events) {
            if (type !== '$destroy') {
              removeEventListenerFn(element, type, handle);
            }
            delete events[type];
          }
        } else {
          forEach(type.split(' '), function(type) {
            if (isDefined(fn)) {
              var listenerFns = events[type];
              arrayRemove(listenerFns || [], fn);
              if (listenerFns && listenerFns.length > 0) {
                return;
              }
            }
            removeEventListenerFn(element, type, handle);
            delete events[type];
          });
        }
      }
      function jqLiteRemoveData(element, name) {
        var expandoId = element.ng339;
        var expandoStore = expandoId && jqCache[expandoId];
        if (expandoStore) {
          if (name) {
            delete expandoStore.data[name];
            return;
          }
          if (expandoStore.handle) {
            if (expandoStore.events.$destroy) {
              expandoStore.handle({}, '$destroy');
            }
            jqLiteOff(element);
          }
          delete jqCache[expandoId];
          element.ng339 = undefined;
        }
      }
      function jqLiteExpandoStore(element, createIfNecessary) {
        var expandoId = element.ng339,
            expandoStore = expandoId && jqCache[expandoId];
        if (createIfNecessary && !expandoStore) {
          element.ng339 = expandoId = jqNextId();
          expandoStore = jqCache[expandoId] = {
            events: {},
            data: {},
            handle: undefined
          };
        }
        return expandoStore;
      }
      function jqLiteData(element, key, value) {
        if (jqLiteAcceptsData(element)) {
          var isSimpleSetter = isDefined(value);
          var isSimpleGetter = !isSimpleSetter && key && !isObject(key);
          var massGetter = !key;
          var expandoStore = jqLiteExpandoStore(element, !isSimpleGetter);
          var data = expandoStore && expandoStore.data;
          if (isSimpleSetter) {
            data[key] = value;
          } else {
            if (massGetter) {
              return data;
            } else {
              if (isSimpleGetter) {
                return data && data[key];
              } else {
                extend(data, key);
              }
            }
          }
        }
      }
      function jqLiteHasClass(element, selector) {
        if (!element.getAttribute)
          return false;
        return ((" " + (element.getAttribute('class') || '') + " ").replace(/[\n\t]/g, " ").indexOf(" " + selector + " ") > -1);
      }
      function jqLiteRemoveClass(element, cssClasses) {
        if (cssClasses && element.setAttribute) {
          forEach(cssClasses.split(' '), function(cssClass) {
            element.setAttribute('class', trim((" " + (element.getAttribute('class') || '') + " ").replace(/[\n\t]/g, " ").replace(" " + trim(cssClass) + " ", " ")));
          });
        }
      }
      function jqLiteAddClass(element, cssClasses) {
        if (cssClasses && element.setAttribute) {
          var existingClasses = (' ' + (element.getAttribute('class') || '') + ' ').replace(/[\n\t]/g, " ");
          forEach(cssClasses.split(' '), function(cssClass) {
            cssClass = trim(cssClass);
            if (existingClasses.indexOf(' ' + cssClass + ' ') === -1) {
              existingClasses += cssClass + ' ';
            }
          });
          element.setAttribute('class', trim(existingClasses));
        }
      }
      function jqLiteAddNodes(root, elements) {
        if (elements) {
          if (elements.nodeType) {
            root[root.length++] = elements;
          } else {
            var length = elements.length;
            if (typeof length === 'number' && elements.window !== elements) {
              if (length) {
                for (var i = 0; i < length; i++) {
                  root[root.length++] = elements[i];
                }
              }
            } else {
              root[root.length++] = elements;
            }
          }
        }
      }
      function jqLiteController(element, name) {
        return jqLiteInheritedData(element, '$' + (name || 'ngController') + 'Controller');
      }
      function jqLiteInheritedData(element, name, value) {
        if (element.nodeType == NODE_TYPE_DOCUMENT) {
          element = element.documentElement;
        }
        var names = isArray(name) ? name : [name];
        while (element) {
          for (var i = 0,
              ii = names.length; i < ii; i++) {
            if (isDefined(value = jqLite.data(element, names[i])))
              return value;
          }
          element = element.parentNode || (element.nodeType === NODE_TYPE_DOCUMENT_FRAGMENT && element.host);
        }
      }
      function jqLiteEmpty(element) {
        jqLiteDealoc(element, true);
        while (element.firstChild) {
          element.removeChild(element.firstChild);
        }
      }
      function jqLiteRemove(element, keepData) {
        if (!keepData)
          jqLiteDealoc(element);
        var parent = element.parentNode;
        if (parent)
          parent.removeChild(element);
      }
      function jqLiteDocumentLoaded(action, win) {
        win = win || window;
        if (win.document.readyState === 'complete') {
          win.setTimeout(action);
        } else {
          jqLite(win).on('load', action);
        }
      }
      var JQLitePrototype = JQLite.prototype = {
        ready: function(fn) {
          var fired = false;
          function trigger() {
            if (fired)
              return;
            fired = true;
            fn();
          }
          if (document.readyState === 'complete') {
            setTimeout(trigger);
          } else {
            this.on('DOMContentLoaded', trigger);
            JQLite(window).on('load', trigger);
          }
        },
        toString: function() {
          var value = [];
          forEach(this, function(e) {
            value.push('' + e);
          });
          return '[' + value.join(', ') + ']';
        },
        eq: function(index) {
          return (index >= 0) ? jqLite(this[index]) : jqLite(this[this.length + index]);
        },
        length: 0,
        push: push,
        sort: [].sort,
        splice: [].splice
      };
      var BOOLEAN_ATTR = {};
      forEach('multiple,selected,checked,disabled,readOnly,required,open'.split(','), function(value) {
        BOOLEAN_ATTR[lowercase(value)] = value;
      });
      var BOOLEAN_ELEMENTS = {};
      forEach('input,select,option,textarea,button,form,details'.split(','), function(value) {
        BOOLEAN_ELEMENTS[value] = true;
      });
      var ALIASED_ATTR = {
        'ngMinlength': 'minlength',
        'ngMaxlength': 'maxlength',
        'ngMin': 'min',
        'ngMax': 'max',
        'ngPattern': 'pattern'
      };
      function getBooleanAttrName(element, name) {
        var booleanAttr = BOOLEAN_ATTR[name.toLowerCase()];
        return booleanAttr && BOOLEAN_ELEMENTS[nodeName_(element)] && booleanAttr;
      }
      function getAliasedAttrName(name) {
        return ALIASED_ATTR[name];
      }
      forEach({
        data: jqLiteData,
        removeData: jqLiteRemoveData,
        hasData: jqLiteHasData
      }, function(fn, name) {
        JQLite[name] = fn;
      });
      forEach({
        data: jqLiteData,
        inheritedData: jqLiteInheritedData,
        scope: function(element) {
          return jqLite.data(element, '$scope') || jqLiteInheritedData(element.parentNode || element, ['$isolateScope', '$scope']);
        },
        isolateScope: function(element) {
          return jqLite.data(element, '$isolateScope') || jqLite.data(element, '$isolateScopeNoTemplate');
        },
        controller: jqLiteController,
        injector: function(element) {
          return jqLiteInheritedData(element, '$injector');
        },
        removeAttr: function(element, name) {
          element.removeAttribute(name);
        },
        hasClass: jqLiteHasClass,
        css: function(element, name, value) {
          name = camelCase(name);
          if (isDefined(value)) {
            element.style[name] = value;
          } else {
            return element.style[name];
          }
        },
        attr: function(element, name, value) {
          var nodeType = element.nodeType;
          if (nodeType === NODE_TYPE_TEXT || nodeType === NODE_TYPE_ATTRIBUTE || nodeType === NODE_TYPE_COMMENT) {
            return;
          }
          var lowercasedName = lowercase(name);
          if (BOOLEAN_ATTR[lowercasedName]) {
            if (isDefined(value)) {
              if (!!value) {
                element[name] = true;
                element.setAttribute(name, lowercasedName);
              } else {
                element[name] = false;
                element.removeAttribute(lowercasedName);
              }
            } else {
              return (element[name] || (element.attributes.getNamedItem(name) || noop).specified) ? lowercasedName : undefined;
            }
          } else if (isDefined(value)) {
            element.setAttribute(name, value);
          } else if (element.getAttribute) {
            var ret = element.getAttribute(name, 2);
            return ret === null ? undefined : ret;
          }
        },
        prop: function(element, name, value) {
          if (isDefined(value)) {
            element[name] = value;
          } else {
            return element[name];
          }
        },
        text: (function() {
          getText.$dv = '';
          return getText;
          function getText(element, value) {
            if (isUndefined(value)) {
              var nodeType = element.nodeType;
              return (nodeType === NODE_TYPE_ELEMENT || nodeType === NODE_TYPE_TEXT) ? element.textContent : '';
            }
            element.textContent = value;
          }
        })(),
        val: function(element, value) {
          if (isUndefined(value)) {
            if (element.multiple && nodeName_(element) === 'select') {
              var result = [];
              forEach(element.options, function(option) {
                if (option.selected) {
                  result.push(option.value || option.text);
                }
              });
              return result.length === 0 ? null : result;
            }
            return element.value;
          }
          element.value = value;
        },
        html: function(element, value) {
          if (isUndefined(value)) {
            return element.innerHTML;
          }
          jqLiteDealoc(element, true);
          element.innerHTML = value;
        },
        empty: jqLiteEmpty
      }, function(fn, name) {
        JQLite.prototype[name] = function(arg1, arg2) {
          var i,
              key;
          var nodeCount = this.length;
          if (fn !== jqLiteEmpty && (isUndefined((fn.length == 2 && (fn !== jqLiteHasClass && fn !== jqLiteController)) ? arg1 : arg2))) {
            if (isObject(arg1)) {
              for (i = 0; i < nodeCount; i++) {
                if (fn === jqLiteData) {
                  fn(this[i], arg1);
                } else {
                  for (key in arg1) {
                    fn(this[i], key, arg1[key]);
                  }
                }
              }
              return this;
            } else {
              var value = fn.$dv;
              var jj = (isUndefined(value)) ? Math.min(nodeCount, 1) : nodeCount;
              for (var j = 0; j < jj; j++) {
                var nodeValue = fn(this[j], arg1, arg2);
                value = value ? value + nodeValue : nodeValue;
              }
              return value;
            }
          } else {
            for (i = 0; i < nodeCount; i++) {
              fn(this[i], arg1, arg2);
            }
            return this;
          }
        };
      });
      function createEventHandler(element, events) {
        var eventHandler = function(event, type) {
          event.isDefaultPrevented = function() {
            return event.defaultPrevented;
          };
          var eventFns = events[type || event.type];
          var eventFnsLength = eventFns ? eventFns.length : 0;
          if (!eventFnsLength)
            return;
          if (isUndefined(event.immediatePropagationStopped)) {
            var originalStopImmediatePropagation = event.stopImmediatePropagation;
            event.stopImmediatePropagation = function() {
              event.immediatePropagationStopped = true;
              if (event.stopPropagation) {
                event.stopPropagation();
              }
              if (originalStopImmediatePropagation) {
                originalStopImmediatePropagation.call(event);
              }
            };
          }
          event.isImmediatePropagationStopped = function() {
            return event.immediatePropagationStopped === true;
          };
          if ((eventFnsLength > 1)) {
            eventFns = shallowCopy(eventFns);
          }
          for (var i = 0; i < eventFnsLength; i++) {
            if (!event.isImmediatePropagationStopped()) {
              eventFns[i].call(element, event);
            }
          }
        };
        eventHandler.elem = element;
        return eventHandler;
      }
      forEach({
        removeData: jqLiteRemoveData,
        on: function jqLiteOn(element, type, fn, unsupported) {
          if (isDefined(unsupported))
            throw jqLiteMinErr('onargs', 'jqLite#on() does not support the `selector` or `eventData` parameters');
          if (!jqLiteAcceptsData(element)) {
            return;
          }
          var expandoStore = jqLiteExpandoStore(element, true);
          var events = expandoStore.events;
          var handle = expandoStore.handle;
          if (!handle) {
            handle = expandoStore.handle = createEventHandler(element, events);
          }
          var types = type.indexOf(' ') >= 0 ? type.split(' ') : [type];
          var i = types.length;
          while (i--) {
            type = types[i];
            var eventFns = events[type];
            if (!eventFns) {
              events[type] = [];
              if (type === 'mouseenter' || type === 'mouseleave') {
                jqLiteOn(element, MOUSE_EVENT_MAP[type], function(event) {
                  var target = this,
                      related = event.relatedTarget;
                  if (!related || (related !== target && !target.contains(related))) {
                    handle(event, type);
                  }
                });
              } else {
                if (type !== '$destroy') {
                  addEventListenerFn(element, type, handle);
                }
              }
              eventFns = events[type];
            }
            eventFns.push(fn);
          }
        },
        off: jqLiteOff,
        one: function(element, type, fn) {
          element = jqLite(element);
          element.on(type, function onFn() {
            element.off(type, fn);
            element.off(type, onFn);
          });
          element.on(type, fn);
        },
        replaceWith: function(element, replaceNode) {
          var index,
              parent = element.parentNode;
          jqLiteDealoc(element);
          forEach(new JQLite(replaceNode), function(node) {
            if (index) {
              parent.insertBefore(node, index.nextSibling);
            } else {
              parent.replaceChild(node, element);
            }
            index = node;
          });
        },
        children: function(element) {
          var children = [];
          forEach(element.childNodes, function(element) {
            if (element.nodeType === NODE_TYPE_ELEMENT) {
              children.push(element);
            }
          });
          return children;
        },
        contents: function(element) {
          return element.contentDocument || element.childNodes || [];
        },
        append: function(element, node) {
          var nodeType = element.nodeType;
          if (nodeType !== NODE_TYPE_ELEMENT && nodeType !== NODE_TYPE_DOCUMENT_FRAGMENT)
            return;
          node = new JQLite(node);
          for (var i = 0,
              ii = node.length; i < ii; i++) {
            var child = node[i];
            element.appendChild(child);
          }
        },
        prepend: function(element, node) {
          if (element.nodeType === NODE_TYPE_ELEMENT) {
            var index = element.firstChild;
            forEach(new JQLite(node), function(child) {
              element.insertBefore(child, index);
            });
          }
        },
        wrap: function(element, wrapNode) {
          wrapNode = jqLite(wrapNode).eq(0).clone()[0];
          var parent = element.parentNode;
          if (parent) {
            parent.replaceChild(wrapNode, element);
          }
          wrapNode.appendChild(element);
        },
        remove: jqLiteRemove,
        detach: function(element) {
          jqLiteRemove(element, true);
        },
        after: function(element, newElement) {
          var index = element,
              parent = element.parentNode;
          newElement = new JQLite(newElement);
          for (var i = 0,
              ii = newElement.length; i < ii; i++) {
            var node = newElement[i];
            parent.insertBefore(node, index.nextSibling);
            index = node;
          }
        },
        addClass: jqLiteAddClass,
        removeClass: jqLiteRemoveClass,
        toggleClass: function(element, selector, condition) {
          if (selector) {
            forEach(selector.split(' '), function(className) {
              var classCondition = condition;
              if (isUndefined(classCondition)) {
                classCondition = !jqLiteHasClass(element, className);
              }
              (classCondition ? jqLiteAddClass : jqLiteRemoveClass)(element, className);
            });
          }
        },
        parent: function(element) {
          var parent = element.parentNode;
          return parent && parent.nodeType !== NODE_TYPE_DOCUMENT_FRAGMENT ? parent : null;
        },
        next: function(element) {
          return element.nextElementSibling;
        },
        find: function(element, selector) {
          if (element.getElementsByTagName) {
            return element.getElementsByTagName(selector);
          } else {
            return [];
          }
        },
        clone: jqLiteClone,
        triggerHandler: function(element, event, extraParameters) {
          var dummyEvent,
              eventFnsCopy,
              handlerArgs;
          var eventName = event.type || event;
          var expandoStore = jqLiteExpandoStore(element);
          var events = expandoStore && expandoStore.events;
          var eventFns = events && events[eventName];
          if (eventFns) {
            dummyEvent = {
              preventDefault: function() {
                this.defaultPrevented = true;
              },
              isDefaultPrevented: function() {
                return this.defaultPrevented === true;
              },
              stopImmediatePropagation: function() {
                this.immediatePropagationStopped = true;
              },
              isImmediatePropagationStopped: function() {
                return this.immediatePropagationStopped === true;
              },
              stopPropagation: noop,
              type: eventName,
              target: element
            };
            if (event.type) {
              dummyEvent = extend(dummyEvent, event);
            }
            eventFnsCopy = shallowCopy(eventFns);
            handlerArgs = extraParameters ? [dummyEvent].concat(extraParameters) : [dummyEvent];
            forEach(eventFnsCopy, function(fn) {
              if (!dummyEvent.isImmediatePropagationStopped()) {
                fn.apply(element, handlerArgs);
              }
            });
          }
        }
      }, function(fn, name) {
        JQLite.prototype[name] = function(arg1, arg2, arg3) {
          var value;
          for (var i = 0,
              ii = this.length; i < ii; i++) {
            if (isUndefined(value)) {
              value = fn(this[i], arg1, arg2, arg3);
              if (isDefined(value)) {
                value = jqLite(value);
              }
            } else {
              jqLiteAddNodes(value, fn(this[i], arg1, arg2, arg3));
            }
          }
          return isDefined(value) ? value : this;
        };
        JQLite.prototype.bind = JQLite.prototype.on;
        JQLite.prototype.unbind = JQLite.prototype.off;
      });
      function $$jqLiteProvider() {
        this.$get = function $$jqLite() {
          return extend(JQLite, {
            hasClass: function(node, classes) {
              if (node.attr)
                node = node[0];
              return jqLiteHasClass(node, classes);
            },
            addClass: function(node, classes) {
              if (node.attr)
                node = node[0];
              return jqLiteAddClass(node, classes);
            },
            removeClass: function(node, classes) {
              if (node.attr)
                node = node[0];
              return jqLiteRemoveClass(node, classes);
            }
          });
        };
      }
      function hashKey(obj, nextUidFn) {
        var key = obj && obj.$$hashKey;
        if (key) {
          if (typeof key === 'function') {
            key = obj.$$hashKey();
          }
          return key;
        }
        var objType = typeof obj;
        if (objType == 'function' || (objType == 'object' && obj !== null)) {
          key = obj.$$hashKey = objType + ':' + (nextUidFn || nextUid)();
        } else {
          key = objType + ':' + obj;
        }
        return key;
      }
      function HashMap(array, isolatedUid) {
        if (isolatedUid) {
          var uid = 0;
          this.nextUid = function() {
            return ++uid;
          };
        }
        forEach(array, this.put, this);
      }
      HashMap.prototype = {
        put: function(key, value) {
          this[hashKey(key, this.nextUid)] = value;
        },
        get: function(key) {
          return this[hashKey(key, this.nextUid)];
        },
        remove: function(key) {
          var value = this[key = hashKey(key, this.nextUid)];
          delete this[key];
          return value;
        }
      };
      var $$HashMapProvider = [function() {
        this.$get = [function() {
          return HashMap;
        }];
      }];
      var FN_ARGS = /^[^\(]*\(\s*([^\)]*)\)/m;
      var FN_ARG_SPLIT = /,/;
      var FN_ARG = /^\s*(_?)(\S+?)\1\s*$/;
      var STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;
      var $injectorMinErr = minErr('$injector');
      function anonFn(fn) {
        var fnText = fn.toString().replace(STRIP_COMMENTS, ''),
            args = fnText.match(FN_ARGS);
        if (args) {
          return 'function(' + (args[1] || '').replace(/[\s\r\n]+/, ' ') + ')';
        }
        return 'fn';
      }
      function annotate(fn, strictDi, name) {
        var $inject,
            fnText,
            argDecl,
            last;
        if (typeof fn === 'function') {
          if (!($inject = fn.$inject)) {
            $inject = [];
            if (fn.length) {
              if (strictDi) {
                if (!isString(name) || !name) {
                  name = fn.name || anonFn(fn);
                }
                throw $injectorMinErr('strictdi', '{0} is not using explicit annotation and cannot be invoked in strict mode', name);
              }
              fnText = fn.toString().replace(STRIP_COMMENTS, '');
              argDecl = fnText.match(FN_ARGS);
              forEach(argDecl[1].split(FN_ARG_SPLIT), function(arg) {
                arg.replace(FN_ARG, function(all, underscore, name) {
                  $inject.push(name);
                });
              });
            }
            fn.$inject = $inject;
          }
        } else if (isArray(fn)) {
          last = fn.length - 1;
          assertArgFn(fn[last], 'fn');
          $inject = fn.slice(0, last);
        } else {
          assertArgFn(fn, 'fn', true);
        }
        return $inject;
      }
      function createInjector(modulesToLoad, strictDi) {
        strictDi = (strictDi === true);
        var INSTANTIATING = {},
            providerSuffix = 'Provider',
            path = [],
            loadedModules = new HashMap([], true),
            providerCache = {$provide: {
                provider: supportObject(provider),
                factory: supportObject(factory),
                service: supportObject(service),
                value: supportObject(value),
                constant: supportObject(constant),
                decorator: decorator
              }},
            providerInjector = (providerCache.$injector = createInternalInjector(providerCache, function(serviceName, caller) {
              if (angular.isString(caller)) {
                path.push(caller);
              }
              throw $injectorMinErr('unpr', "Unknown provider: {0}", path.join(' <- '));
            })),
            instanceCache = {},
            instanceInjector = (instanceCache.$injector = createInternalInjector(instanceCache, function(serviceName, caller) {
              var provider = providerInjector.get(serviceName + providerSuffix, caller);
              return instanceInjector.invoke(provider.$get, provider, undefined, serviceName);
            }));
        forEach(loadModules(modulesToLoad), function(fn) {
          if (fn)
            instanceInjector.invoke(fn);
        });
        return instanceInjector;
        function supportObject(delegate) {
          return function(key, value) {
            if (isObject(key)) {
              forEach(key, reverseParams(delegate));
            } else {
              return delegate(key, value);
            }
          };
        }
        function provider(name, provider_) {
          assertNotHasOwnProperty(name, 'service');
          if (isFunction(provider_) || isArray(provider_)) {
            provider_ = providerInjector.instantiate(provider_);
          }
          if (!provider_.$get) {
            throw $injectorMinErr('pget', "Provider '{0}' must define $get factory method.", name);
          }
          return providerCache[name + providerSuffix] = provider_;
        }
        function enforceReturnValue(name, factory) {
          return function enforcedReturnValue() {
            var result = instanceInjector.invoke(factory, this);
            if (isUndefined(result)) {
              throw $injectorMinErr('undef', "Provider '{0}' must return a value from $get factory method.", name);
            }
            return result;
          };
        }
        function factory(name, factoryFn, enforce) {
          return provider(name, {$get: enforce !== false ? enforceReturnValue(name, factoryFn) : factoryFn});
        }
        function service(name, constructor) {
          return factory(name, ['$injector', function($injector) {
            return $injector.instantiate(constructor);
          }]);
        }
        function value(name, val) {
          return factory(name, valueFn(val), false);
        }
        function constant(name, value) {
          assertNotHasOwnProperty(name, 'constant');
          providerCache[name] = value;
          instanceCache[name] = value;
        }
        function decorator(serviceName, decorFn) {
          var origProvider = providerInjector.get(serviceName + providerSuffix),
              orig$get = origProvider.$get;
          origProvider.$get = function() {
            var origInstance = instanceInjector.invoke(orig$get, origProvider);
            return instanceInjector.invoke(decorFn, null, {$delegate: origInstance});
          };
        }
        function loadModules(modulesToLoad) {
          assertArg(isUndefined(modulesToLoad) || isArray(modulesToLoad), 'modulesToLoad', 'not an array');
          var runBlocks = [],
              moduleFn;
          forEach(modulesToLoad, function(module) {
            if (loadedModules.get(module))
              return;
            loadedModules.put(module, true);
            function runInvokeQueue(queue) {
              var i,
                  ii;
              for (i = 0, ii = queue.length; i < ii; i++) {
                var invokeArgs = queue[i],
                    provider = providerInjector.get(invokeArgs[0]);
                provider[invokeArgs[1]].apply(provider, invokeArgs[2]);
              }
            }
            try {
              if (isString(module)) {
                moduleFn = angularModule(module);
                runBlocks = runBlocks.concat(loadModules(moduleFn.requires)).concat(moduleFn._runBlocks);
                runInvokeQueue(moduleFn._invokeQueue);
                runInvokeQueue(moduleFn._configBlocks);
              } else if (isFunction(module)) {
                runBlocks.push(providerInjector.invoke(module));
              } else if (isArray(module)) {
                runBlocks.push(providerInjector.invoke(module));
              } else {
                assertArgFn(module, 'module');
              }
            } catch (e) {
              if (isArray(module)) {
                module = module[module.length - 1];
              }
              if (e.message && e.stack && e.stack.indexOf(e.message) == -1) {
                e = e.message + '\n' + e.stack;
              }
              throw $injectorMinErr('modulerr', "Failed to instantiate module {0} due to:\n{1}", module, e.stack || e.message || e);
            }
          });
          return runBlocks;
        }
        function createInternalInjector(cache, factory) {
          function getService(serviceName, caller) {
            if (cache.hasOwnProperty(serviceName)) {
              if (cache[serviceName] === INSTANTIATING) {
                throw $injectorMinErr('cdep', 'Circular dependency found: {0}', serviceName + ' <- ' + path.join(' <- '));
              }
              return cache[serviceName];
            } else {
              try {
                path.unshift(serviceName);
                cache[serviceName] = INSTANTIATING;
                return cache[serviceName] = factory(serviceName, caller);
              } catch (err) {
                if (cache[serviceName] === INSTANTIATING) {
                  delete cache[serviceName];
                }
                throw err;
              } finally {
                path.shift();
              }
            }
          }
          function invoke(fn, self, locals, serviceName) {
            if (typeof locals === 'string') {
              serviceName = locals;
              locals = null;
            }
            var args = [],
                $inject = createInjector.$$annotate(fn, strictDi, serviceName),
                length,
                i,
                key;
            for (i = 0, length = $inject.length; i < length; i++) {
              key = $inject[i];
              if (typeof key !== 'string') {
                throw $injectorMinErr('itkn', 'Incorrect injection token! Expected service name as string, got {0}', key);
              }
              args.push(locals && locals.hasOwnProperty(key) ? locals[key] : getService(key, serviceName));
            }
            if (isArray(fn)) {
              fn = fn[length];
            }
            return fn.apply(self, args);
          }
          function instantiate(Type, locals, serviceName) {
            var instance = Object.create((isArray(Type) ? Type[Type.length - 1] : Type).prototype || null);
            var returnedValue = invoke(Type, instance, locals, serviceName);
            return isObject(returnedValue) || isFunction(returnedValue) ? returnedValue : instance;
          }
          return {
            invoke: invoke,
            instantiate: instantiate,
            get: getService,
            annotate: createInjector.$$annotate,
            has: function(name) {
              return providerCache.hasOwnProperty(name + providerSuffix) || cache.hasOwnProperty(name);
            }
          };
        }
      }
      createInjector.$$annotate = annotate;
      function $AnchorScrollProvider() {
        var autoScrollingEnabled = true;
        this.disableAutoScrolling = function() {
          autoScrollingEnabled = false;
        };
        this.$get = ['$window', '$location', '$rootScope', function($window, $location, $rootScope) {
          var document = $window.document;
          function getFirstAnchor(list) {
            var result = null;
            Array.prototype.some.call(list, function(element) {
              if (nodeName_(element) === 'a') {
                result = element;
                return true;
              }
            });
            return result;
          }
          function getYOffset() {
            var offset = scroll.yOffset;
            if (isFunction(offset)) {
              offset = offset();
            } else if (isElement(offset)) {
              var elem = offset[0];
              var style = $window.getComputedStyle(elem);
              if (style.position !== 'fixed') {
                offset = 0;
              } else {
                offset = elem.getBoundingClientRect().bottom;
              }
            } else if (!isNumber(offset)) {
              offset = 0;
            }
            return offset;
          }
          function scrollTo(elem) {
            if (elem) {
              elem.scrollIntoView();
              var offset = getYOffset();
              if (offset) {
                var elemTop = elem.getBoundingClientRect().top;
                $window.scrollBy(0, elemTop - offset);
              }
            } else {
              $window.scrollTo(0, 0);
            }
          }
          function scroll(hash) {
            hash = isString(hash) ? hash : $location.hash();
            var elm;
            if (!hash)
              scrollTo(null);
            else if ((elm = document.getElementById(hash)))
              scrollTo(elm);
            else if ((elm = getFirstAnchor(document.getElementsByName(hash))))
              scrollTo(elm);
            else if (hash === 'top')
              scrollTo(null);
          }
          if (autoScrollingEnabled) {
            $rootScope.$watch(function autoScrollWatch() {
              return $location.hash();
            }, function autoScrollWatchAction(newVal, oldVal) {
              if (newVal === oldVal && newVal === '')
                return;
              jqLiteDocumentLoaded(function() {
                $rootScope.$evalAsync(scroll);
              });
            });
          }
          return scroll;
        }];
      }
      var $animateMinErr = minErr('$animate');
      var ELEMENT_NODE = 1;
      var NG_ANIMATE_CLASSNAME = 'ng-animate';
      function mergeClasses(a, b) {
        if (!a && !b)
          return '';
        if (!a)
          return b;
        if (!b)
          return a;
        if (isArray(a))
          a = a.join(' ');
        if (isArray(b))
          b = b.join(' ');
        return a + ' ' + b;
      }
      function extractElementNode(element) {
        for (var i = 0; i < element.length; i++) {
          var elm = element[i];
          if (elm.nodeType === ELEMENT_NODE) {
            return elm;
          }
        }
      }
      function splitClasses(classes) {
        if (isString(classes)) {
          classes = classes.split(' ');
        }
        var obj = createMap();
        forEach(classes, function(klass) {
          if (klass.length) {
            obj[klass] = true;
          }
        });
        return obj;
      }
      function prepareAnimateOptions(options) {
        return isObject(options) ? options : {};
      }
      var $$CoreAnimateRunnerProvider = function() {
        this.$get = ['$q', '$$rAF', function($q, $$rAF) {
          function AnimateRunner() {}
          AnimateRunner.all = noop;
          AnimateRunner.chain = noop;
          AnimateRunner.prototype = {
            end: noop,
            cancel: noop,
            resume: noop,
            pause: noop,
            complete: noop,
            then: function(pass, fail) {
              return $q(function(resolve) {
                $$rAF(function() {
                  resolve();
                });
              }).then(pass, fail);
            }
          };
          return AnimateRunner;
        }];
      };
      var $$CoreAnimateQueueProvider = function() {
        var postDigestQueue = new HashMap();
        var postDigestElements = [];
        this.$get = ['$$AnimateRunner', '$rootScope', function($$AnimateRunner, $rootScope) {
          return {
            enabled: noop,
            on: noop,
            off: noop,
            pin: noop,
            push: function(element, event, options, domOperation) {
              domOperation && domOperation();
              options = options || {};
              options.from && element.css(options.from);
              options.to && element.css(options.to);
              if (options.addClass || options.removeClass) {
                addRemoveClassesPostDigest(element, options.addClass, options.removeClass);
              }
              return new $$AnimateRunner();
            }
          };
          function updateData(data, classes, value) {
            var changed = false;
            if (classes) {
              classes = isString(classes) ? classes.split(' ') : isArray(classes) ? classes : [];
              forEach(classes, function(className) {
                if (className) {
                  changed = true;
                  data[className] = value;
                }
              });
            }
            return changed;
          }
          function handleCSSClassChanges() {
            forEach(postDigestElements, function(element) {
              var data = postDigestQueue.get(element);
              if (data) {
                var existing = splitClasses(element.attr('class'));
                var toAdd = '';
                var toRemove = '';
                forEach(data, function(status, className) {
                  var hasClass = !!existing[className];
                  if (status !== hasClass) {
                    if (status) {
                      toAdd += (toAdd.length ? ' ' : '') + className;
                    } else {
                      toRemove += (toRemove.length ? ' ' : '') + className;
                    }
                  }
                });
                forEach(element, function(elm) {
                  toAdd && jqLiteAddClass(elm, toAdd);
                  toRemove && jqLiteRemoveClass(elm, toRemove);
                });
                postDigestQueue.remove(element);
              }
            });
            postDigestElements.length = 0;
          }
          function addRemoveClassesPostDigest(element, add, remove) {
            var data = postDigestQueue.get(element) || {};
            var classesAdded = updateData(data, add, true);
            var classesRemoved = updateData(data, remove, false);
            if (classesAdded || classesRemoved) {
              postDigestQueue.put(element, data);
              postDigestElements.push(element);
              if (postDigestElements.length === 1) {
                $rootScope.$$postDigest(handleCSSClassChanges);
              }
            }
          }
        }];
      };
      var $AnimateProvider = ['$provide', function($provide) {
        var provider = this;
        this.$$registeredAnimations = Object.create(null);
        this.register = function(name, factory) {
          if (name && name.charAt(0) !== '.') {
            throw $animateMinErr('notcsel', "Expecting class selector starting with '.' got '{0}'.", name);
          }
          var key = name + '-animation';
          provider.$$registeredAnimations[name.substr(1)] = key;
          $provide.factory(key, factory);
        };
        this.classNameFilter = function(expression) {
          if (arguments.length === 1) {
            this.$$classNameFilter = (expression instanceof RegExp) ? expression : null;
            if (this.$$classNameFilter) {
              var reservedRegex = new RegExp("(\\s+|\\/)" + NG_ANIMATE_CLASSNAME + "(\\s+|\\/)");
              if (reservedRegex.test(this.$$classNameFilter.toString())) {
                throw $animateMinErr('nongcls', '$animateProvider.classNameFilter(regex) prohibits accepting a regex value which matches/contains the "{0}" CSS class.', NG_ANIMATE_CLASSNAME);
              }
            }
          }
          return this.$$classNameFilter;
        };
        this.$get = ['$$animateQueue', function($$animateQueue) {
          function domInsert(element, parentElement, afterElement) {
            if (afterElement) {
              var afterNode = extractElementNode(afterElement);
              if (afterNode && !afterNode.parentNode && !afterNode.previousElementSibling) {
                afterElement = null;
              }
            }
            afterElement ? afterElement.after(element) : parentElement.prepend(element);
          }
          return {
            on: $$animateQueue.on,
            off: $$animateQueue.off,
            pin: $$animateQueue.pin,
            enabled: $$animateQueue.enabled,
            cancel: function(runner) {
              runner.end && runner.end();
            },
            enter: function(element, parent, after, options) {
              parent = parent && jqLite(parent);
              after = after && jqLite(after);
              parent = parent || after.parent();
              domInsert(element, parent, after);
              return $$animateQueue.push(element, 'enter', prepareAnimateOptions(options));
            },
            move: function(element, parent, after, options) {
              parent = parent && jqLite(parent);
              after = after && jqLite(after);
              parent = parent || after.parent();
              domInsert(element, parent, after);
              return $$animateQueue.push(element, 'move', prepareAnimateOptions(options));
            },
            leave: function(element, options) {
              return $$animateQueue.push(element, 'leave', prepareAnimateOptions(options), function() {
                element.remove();
              });
            },
            addClass: function(element, className, options) {
              options = prepareAnimateOptions(options);
              options.addClass = mergeClasses(options.addclass, className);
              return $$animateQueue.push(element, 'addClass', options);
            },
            removeClass: function(element, className, options) {
              options = prepareAnimateOptions(options);
              options.removeClass = mergeClasses(options.removeClass, className);
              return $$animateQueue.push(element, 'removeClass', options);
            },
            setClass: function(element, add, remove, options) {
              options = prepareAnimateOptions(options);
              options.addClass = mergeClasses(options.addClass, add);
              options.removeClass = mergeClasses(options.removeClass, remove);
              return $$animateQueue.push(element, 'setClass', options);
            },
            animate: function(element, from, to, className, options) {
              options = prepareAnimateOptions(options);
              options.from = options.from ? extend(options.from, from) : from;
              options.to = options.to ? extend(options.to, to) : to;
              className = className || 'ng-inline-animate';
              options.tempClasses = mergeClasses(options.tempClasses, className);
              return $$animateQueue.push(element, 'animate', options);
            }
          };
        }];
      }];
      var $CoreAnimateCssProvider = function() {
        this.$get = ['$$rAF', '$q', function($$rAF, $q) {
          var RAFPromise = function() {};
          RAFPromise.prototype = {
            done: function(cancel) {
              this.defer && this.defer[cancel === true ? 'reject' : 'resolve']();
            },
            end: function() {
              this.done();
            },
            cancel: function() {
              this.done(true);
            },
            getPromise: function() {
              if (!this.defer) {
                this.defer = $q.defer();
              }
              return this.defer.promise;
            },
            then: function(f1, f2) {
              return this.getPromise().then(f1, f2);
            },
            'catch': function(f1) {
              return this.getPromise()['catch'](f1);
            },
            'finally': function(f1) {
              return this.getPromise()['finally'](f1);
            }
          };
          return function(element, options) {
            if (options.from) {
              element.css(options.from);
              options.from = null;
            }
            var closed,
                runner = new RAFPromise();
            return {
              start: run,
              end: run
            };
            function run() {
              $$rAF(function() {
                close();
                if (!closed) {
                  runner.done();
                }
                closed = true;
              });
              return runner;
            }
            function close() {
              if (options.addClass) {
                element.addClass(options.addClass);
                options.addClass = null;
              }
              if (options.removeClass) {
                element.removeClass(options.removeClass);
                options.removeClass = null;
              }
              if (options.to) {
                element.css(options.to);
                options.to = null;
              }
            }
          };
        }];
      };
      function Browser(window, document, $log, $sniffer) {
        var self = this,
            rawDocument = document[0],
            location = window.location,
            history = window.history,
            setTimeout = window.setTimeout,
            clearTimeout = window.clearTimeout,
            pendingDeferIds = {};
        self.isMock = false;
        var outstandingRequestCount = 0;
        var outstandingRequestCallbacks = [];
        self.$$completeOutstandingRequest = completeOutstandingRequest;
        self.$$incOutstandingRequestCount = function() {
          outstandingRequestCount++;
        };
        function completeOutstandingRequest(fn) {
          try {
            fn.apply(null, sliceArgs(arguments, 1));
          } finally {
            outstandingRequestCount--;
            if (outstandingRequestCount === 0) {
              while (outstandingRequestCallbacks.length) {
                try {
                  outstandingRequestCallbacks.pop()();
                } catch (e) {
                  $log.error(e);
                }
              }
            }
          }
        }
        function getHash(url) {
          var index = url.indexOf('#');
          return index === -1 ? '' : url.substr(index);
        }
        self.notifyWhenNoOutstandingRequests = function(callback) {
          if (outstandingRequestCount === 0) {
            callback();
          } else {
            outstandingRequestCallbacks.push(callback);
          }
        };
        var cachedState,
            lastHistoryState,
            lastBrowserUrl = location.href,
            baseElement = document.find('base'),
            pendingLocation = null;
        cacheState();
        lastHistoryState = cachedState;
        self.url = function(url, replace, state) {
          if (isUndefined(state)) {
            state = null;
          }
          if (location !== window.location)
            location = window.location;
          if (history !== window.history)
            history = window.history;
          if (url) {
            var sameState = lastHistoryState === state;
            if (lastBrowserUrl === url && (!$sniffer.history || sameState)) {
              return self;
            }
            var sameBase = lastBrowserUrl && stripHash(lastBrowserUrl) === stripHash(url);
            lastBrowserUrl = url;
            lastHistoryState = state;
            if ($sniffer.history && (!sameBase || !sameState)) {
              history[replace ? 'replaceState' : 'pushState'](state, '', url);
              cacheState();
              lastHistoryState = cachedState;
            } else {
              if (!sameBase || pendingLocation) {
                pendingLocation = url;
              }
              if (replace) {
                location.replace(url);
              } else if (!sameBase) {
                location.href = url;
              } else {
                location.hash = getHash(url);
              }
              if (location.href !== url) {
                pendingLocation = url;
              }
            }
            return self;
          } else {
            return pendingLocation || location.href.replace(/%27/g, "'");
          }
        };
        self.state = function() {
          return cachedState;
        };
        var urlChangeListeners = [],
            urlChangeInit = false;
        function cacheStateAndFireUrlChange() {
          pendingLocation = null;
          cacheState();
          fireUrlChange();
        }
        function getCurrentState() {
          try {
            return history.state;
          } catch (e) {}
        }
        var lastCachedState = null;
        function cacheState() {
          cachedState = getCurrentState();
          cachedState = isUndefined(cachedState) ? null : cachedState;
          if (equals(cachedState, lastCachedState)) {
            cachedState = lastCachedState;
          }
          lastCachedState = cachedState;
        }
        function fireUrlChange() {
          if (lastBrowserUrl === self.url() && lastHistoryState === cachedState) {
            return;
          }
          lastBrowserUrl = self.url();
          lastHistoryState = cachedState;
          forEach(urlChangeListeners, function(listener) {
            listener(self.url(), cachedState);
          });
        }
        self.onUrlChange = function(callback) {
          if (!urlChangeInit) {
            if ($sniffer.history)
              jqLite(window).on('popstate', cacheStateAndFireUrlChange);
            jqLite(window).on('hashchange', cacheStateAndFireUrlChange);
            urlChangeInit = true;
          }
          urlChangeListeners.push(callback);
          return callback;
        };
        self.$$applicationDestroyed = function() {
          jqLite(window).off('hashchange popstate', cacheStateAndFireUrlChange);
        };
        self.$$checkUrlChange = fireUrlChange;
        self.baseHref = function() {
          var href = baseElement.attr('href');
          return href ? href.replace(/^(https?\:)?\/\/[^\/]*/, '') : '';
        };
        self.defer = function(fn, delay) {
          var timeoutId;
          outstandingRequestCount++;
          timeoutId = setTimeout(function() {
            delete pendingDeferIds[timeoutId];
            completeOutstandingRequest(fn);
          }, delay || 0);
          pendingDeferIds[timeoutId] = true;
          return timeoutId;
        };
        self.defer.cancel = function(deferId) {
          if (pendingDeferIds[deferId]) {
            delete pendingDeferIds[deferId];
            clearTimeout(deferId);
            completeOutstandingRequest(noop);
            return true;
          }
          return false;
        };
      }
      function $BrowserProvider() {
        this.$get = ['$window', '$log', '$sniffer', '$document', function($window, $log, $sniffer, $document) {
          return new Browser($window, $document, $log, $sniffer);
        }];
      }
      function $CacheFactoryProvider() {
        this.$get = function() {
          var caches = {};
          function cacheFactory(cacheId, options) {
            if (cacheId in caches) {
              throw minErr('$cacheFactory')('iid', "CacheId '{0}' is already taken!", cacheId);
            }
            var size = 0,
                stats = extend({}, options, {id: cacheId}),
                data = {},
                capacity = (options && options.capacity) || Number.MAX_VALUE,
                lruHash = {},
                freshEnd = null,
                staleEnd = null;
            return caches[cacheId] = {
              put: function(key, value) {
                if (isUndefined(value))
                  return;
                if (capacity < Number.MAX_VALUE) {
                  var lruEntry = lruHash[key] || (lruHash[key] = {key: key});
                  refresh(lruEntry);
                }
                if (!(key in data))
                  size++;
                data[key] = value;
                if (size > capacity) {
                  this.remove(staleEnd.key);
                }
                return value;
              },
              get: function(key) {
                if (capacity < Number.MAX_VALUE) {
                  var lruEntry = lruHash[key];
                  if (!lruEntry)
                    return;
                  refresh(lruEntry);
                }
                return data[key];
              },
              remove: function(key) {
                if (capacity < Number.MAX_VALUE) {
                  var lruEntry = lruHash[key];
                  if (!lruEntry)
                    return;
                  if (lruEntry == freshEnd)
                    freshEnd = lruEntry.p;
                  if (lruEntry == staleEnd)
                    staleEnd = lruEntry.n;
                  link(lruEntry.n, lruEntry.p);
                  delete lruHash[key];
                }
                delete data[key];
                size--;
              },
              removeAll: function() {
                data = {};
                size = 0;
                lruHash = {};
                freshEnd = staleEnd = null;
              },
              destroy: function() {
                data = null;
                stats = null;
                lruHash = null;
                delete caches[cacheId];
              },
              info: function() {
                return extend({}, stats, {size: size});
              }
            };
            function refresh(entry) {
              if (entry != freshEnd) {
                if (!staleEnd) {
                  staleEnd = entry;
                } else if (staleEnd == entry) {
                  staleEnd = entry.n;
                }
                link(entry.n, entry.p);
                link(entry, freshEnd);
                freshEnd = entry;
                freshEnd.n = null;
              }
            }
            function link(nextEntry, prevEntry) {
              if (nextEntry != prevEntry) {
                if (nextEntry)
                  nextEntry.p = prevEntry;
                if (prevEntry)
                  prevEntry.n = nextEntry;
              }
            }
          }
          cacheFactory.info = function() {
            var info = {};
            forEach(caches, function(cache, cacheId) {
              info[cacheId] = cache.info();
            });
            return info;
          };
          cacheFactory.get = function(cacheId) {
            return caches[cacheId];
          };
          return cacheFactory;
        };
      }
      function $TemplateCacheProvider() {
        this.$get = ['$cacheFactory', function($cacheFactory) {
          return $cacheFactory('templates');
        }];
      }
      var $compileMinErr = minErr('$compile');
      $CompileProvider.$inject = ['$provide', '$$sanitizeUriProvider'];
      function $CompileProvider($provide, $$sanitizeUriProvider) {
        var hasDirectives = {},
            Suffix = 'Directive',
            COMMENT_DIRECTIVE_REGEXP = /^\s*directive\:\s*([\w\-]+)\s+(.*)$/,
            CLASS_DIRECTIVE_REGEXP = /(([\w\-]+)(?:\:([^;]+))?;?)/,
            ALL_OR_NOTHING_ATTRS = makeMap('ngSrc,ngSrcset,src,srcset'),
            REQUIRE_PREFIX_REGEXP = /^(?:(\^\^?)?(\?)?(\^\^?)?)?/;
        var EVENT_HANDLER_ATTR_REGEXP = /^(on[a-z]+|formaction)$/;
        function parseIsolateBindings(scope, directiveName, isController) {
          var LOCAL_REGEXP = /^\s*([@&]|=(\*?))(\??)\s*(\w*)\s*$/;
          var bindings = {};
          forEach(scope, function(definition, scopeName) {
            var match = definition.match(LOCAL_REGEXP);
            if (!match) {
              throw $compileMinErr('iscp', "Invalid {3} for directive '{0}'." + " Definition: {... {1}: '{2}' ...}", directiveName, scopeName, definition, (isController ? "controller bindings definition" : "isolate scope definition"));
            }
            bindings[scopeName] = {
              mode: match[1][0],
              collection: match[2] === '*',
              optional: match[3] === '?',
              attrName: match[4] || scopeName
            };
          });
          return bindings;
        }
        function parseDirectiveBindings(directive, directiveName) {
          var bindings = {
            isolateScope: null,
            bindToController: null
          };
          if (isObject(directive.scope)) {
            if (directive.bindToController === true) {
              bindings.bindToController = parseIsolateBindings(directive.scope, directiveName, true);
              bindings.isolateScope = {};
            } else {
              bindings.isolateScope = parseIsolateBindings(directive.scope, directiveName, false);
            }
          }
          if (isObject(directive.bindToController)) {
            bindings.bindToController = parseIsolateBindings(directive.bindToController, directiveName, true);
          }
          if (isObject(bindings.bindToController)) {
            var controller = directive.controller;
            var controllerAs = directive.controllerAs;
            if (!controller) {
              throw $compileMinErr('noctrl', "Cannot bind to controller without directive '{0}'s controller.", directiveName);
            } else if (!identifierForController(controller, controllerAs)) {
              throw $compileMinErr('noident', "Cannot bind to controller without identifier for directive '{0}'.", directiveName);
            }
          }
          return bindings;
        }
        function assertValidDirectiveName(name) {
          var letter = name.charAt(0);
          if (!letter || letter !== lowercase(letter)) {
            throw $compileMinErr('baddir', "Directive name '{0}' is invalid. The first character must be a lowercase letter", name);
          }
          if (name !== name.trim()) {
            throw $compileMinErr('baddir', "Directive name '{0}' is invalid. The name should not contain leading or trailing whitespaces", name);
          }
        }
        this.directive = function registerDirective(name, directiveFactory) {
          assertNotHasOwnProperty(name, 'directive');
          if (isString(name)) {
            assertValidDirectiveName(name);
            assertArg(directiveFactory, 'directiveFactory');
            if (!hasDirectives.hasOwnProperty(name)) {
              hasDirectives[name] = [];
              $provide.factory(name + Suffix, ['$injector', '$exceptionHandler', function($injector, $exceptionHandler) {
                var directives = [];
                forEach(hasDirectives[name], function(directiveFactory, index) {
                  try {
                    var directive = $injector.invoke(directiveFactory);
                    if (isFunction(directive)) {
                      directive = {compile: valueFn(directive)};
                    } else if (!directive.compile && directive.link) {
                      directive.compile = valueFn(directive.link);
                    }
                    directive.priority = directive.priority || 0;
                    directive.index = index;
                    directive.name = directive.name || name;
                    directive.require = directive.require || (directive.controller && directive.name);
                    directive.restrict = directive.restrict || 'EA';
                    var bindings = directive.$$bindings = parseDirectiveBindings(directive, directive.name);
                    if (isObject(bindings.isolateScope)) {
                      directive.$$isolateBindings = bindings.isolateScope;
                    }
                    directive.$$moduleName = directiveFactory.$$moduleName;
                    directives.push(directive);
                  } catch (e) {
                    $exceptionHandler(e);
                  }
                });
                return directives;
              }]);
            }
            hasDirectives[name].push(directiveFactory);
          } else {
            forEach(name, reverseParams(registerDirective));
          }
          return this;
        };
        this.aHrefSanitizationWhitelist = function(regexp) {
          if (isDefined(regexp)) {
            $$sanitizeUriProvider.aHrefSanitizationWhitelist(regexp);
            return this;
          } else {
            return $$sanitizeUriProvider.aHrefSanitizationWhitelist();
          }
        };
        this.imgSrcSanitizationWhitelist = function(regexp) {
          if (isDefined(regexp)) {
            $$sanitizeUriProvider.imgSrcSanitizationWhitelist(regexp);
            return this;
          } else {
            return $$sanitizeUriProvider.imgSrcSanitizationWhitelist();
          }
        };
        var debugInfoEnabled = true;
        this.debugInfoEnabled = function(enabled) {
          if (isDefined(enabled)) {
            debugInfoEnabled = enabled;
            return this;
          }
          return debugInfoEnabled;
        };
        this.$get = ['$injector', '$interpolate', '$exceptionHandler', '$templateRequest', '$parse', '$controller', '$rootScope', '$document', '$sce', '$animate', '$$sanitizeUri', function($injector, $interpolate, $exceptionHandler, $templateRequest, $parse, $controller, $rootScope, $document, $sce, $animate, $$sanitizeUri) {
          var Attributes = function(element, attributesToCopy) {
            if (attributesToCopy) {
              var keys = Object.keys(attributesToCopy);
              var i,
                  l,
                  key;
              for (i = 0, l = keys.length; i < l; i++) {
                key = keys[i];
                this[key] = attributesToCopy[key];
              }
            } else {
              this.$attr = {};
            }
            this.$$element = element;
          };
          Attributes.prototype = {
            $normalize: directiveNormalize,
            $addClass: function(classVal) {
              if (classVal && classVal.length > 0) {
                $animate.addClass(this.$$element, classVal);
              }
            },
            $removeClass: function(classVal) {
              if (classVal && classVal.length > 0) {
                $animate.removeClass(this.$$element, classVal);
              }
            },
            $updateClass: function(newClasses, oldClasses) {
              var toAdd = tokenDifference(newClasses, oldClasses);
              if (toAdd && toAdd.length) {
                $animate.addClass(this.$$element, toAdd);
              }
              var toRemove = tokenDifference(oldClasses, newClasses);
              if (toRemove && toRemove.length) {
                $animate.removeClass(this.$$element, toRemove);
              }
            },
            $set: function(key, value, writeAttr, attrName) {
              var node = this.$$element[0],
                  booleanKey = getBooleanAttrName(node, key),
                  aliasedKey = getAliasedAttrName(key),
                  observer = key,
                  nodeName;
              if (booleanKey) {
                this.$$element.prop(key, value);
                attrName = booleanKey;
              } else if (aliasedKey) {
                this[aliasedKey] = value;
                observer = aliasedKey;
              }
              this[key] = value;
              if (attrName) {
                this.$attr[key] = attrName;
              } else {
                attrName = this.$attr[key];
                if (!attrName) {
                  this.$attr[key] = attrName = snake_case(key, '-');
                }
              }
              nodeName = nodeName_(this.$$element);
              if ((nodeName === 'a' && key === 'href') || (nodeName === 'img' && key === 'src')) {
                this[key] = value = $$sanitizeUri(value, key === 'src');
              } else if (nodeName === 'img' && key === 'srcset') {
                var result = "";
                var trimmedSrcset = trim(value);
                var srcPattern = /(\s+\d+x\s*,|\s+\d+w\s*,|\s+,|,\s+)/;
                var pattern = /\s/.test(trimmedSrcset) ? srcPattern : /(,)/;
                var rawUris = trimmedSrcset.split(pattern);
                var nbrUrisWith2parts = Math.floor(rawUris.length / 2);
                for (var i = 0; i < nbrUrisWith2parts; i++) {
                  var innerIdx = i * 2;
                  result += $$sanitizeUri(trim(rawUris[innerIdx]), true);
                  result += (" " + trim(rawUris[innerIdx + 1]));
                }
                var lastTuple = trim(rawUris[i * 2]).split(/\s/);
                result += $$sanitizeUri(trim(lastTuple[0]), true);
                if (lastTuple.length === 2) {
                  result += (" " + trim(lastTuple[1]));
                }
                this[key] = value = result;
              }
              if (writeAttr !== false) {
                if (value === null || isUndefined(value)) {
                  this.$$element.removeAttr(attrName);
                } else {
                  this.$$element.attr(attrName, value);
                }
              }
              var $$observers = this.$$observers;
              $$observers && forEach($$observers[observer], function(fn) {
                try {
                  fn(value);
                } catch (e) {
                  $exceptionHandler(e);
                }
              });
            },
            $observe: function(key, fn) {
              var attrs = this,
                  $$observers = (attrs.$$observers || (attrs.$$observers = createMap())),
                  listeners = ($$observers[key] || ($$observers[key] = []));
              listeners.push(fn);
              $rootScope.$evalAsync(function() {
                if (!listeners.$$inter && attrs.hasOwnProperty(key) && !isUndefined(attrs[key])) {
                  fn(attrs[key]);
                }
              });
              return function() {
                arrayRemove(listeners, fn);
              };
            }
          };
          function safeAddClass($element, className) {
            try {
              $element.addClass(className);
            } catch (e) {}
          }
          var startSymbol = $interpolate.startSymbol(),
              endSymbol = $interpolate.endSymbol(),
              denormalizeTemplate = (startSymbol == '{{' || endSymbol == '}}') ? identity : function denormalizeTemplate(template) {
                return template.replace(/\{\{/g, startSymbol).replace(/}}/g, endSymbol);
              },
              NG_ATTR_BINDING = /^ngAttr[A-Z]/;
          compile.$$addBindingInfo = debugInfoEnabled ? function $$addBindingInfo($element, binding) {
            var bindings = $element.data('$binding') || [];
            if (isArray(binding)) {
              bindings = bindings.concat(binding);
            } else {
              bindings.push(binding);
            }
            $element.data('$binding', bindings);
          } : noop;
          compile.$$addBindingClass = debugInfoEnabled ? function $$addBindingClass($element) {
            safeAddClass($element, 'ng-binding');
          } : noop;
          compile.$$addScopeInfo = debugInfoEnabled ? function $$addScopeInfo($element, scope, isolated, noTemplate) {
            var dataName = isolated ? (noTemplate ? '$isolateScopeNoTemplate' : '$isolateScope') : '$scope';
            $element.data(dataName, scope);
          } : noop;
          compile.$$addScopeClass = debugInfoEnabled ? function $$addScopeClass($element, isolated) {
            safeAddClass($element, isolated ? 'ng-isolate-scope' : 'ng-scope');
          } : noop;
          return compile;
          function compile($compileNodes, transcludeFn, maxPriority, ignoreDirective, previousCompileContext) {
            if (!($compileNodes instanceof jqLite)) {
              $compileNodes = jqLite($compileNodes);
            }
            forEach($compileNodes, function(node, index) {
              if (node.nodeType == NODE_TYPE_TEXT && node.nodeValue.match(/\S+/)) {
                $compileNodes[index] = jqLite(node).wrap('<span></span>').parent()[0];
              }
            });
            var compositeLinkFn = compileNodes($compileNodes, transcludeFn, $compileNodes, maxPriority, ignoreDirective, previousCompileContext);
            compile.$$addScopeClass($compileNodes);
            var namespace = null;
            return function publicLinkFn(scope, cloneConnectFn, options) {
              assertArg(scope, 'scope');
              options = options || {};
              var parentBoundTranscludeFn = options.parentBoundTranscludeFn,
                  transcludeControllers = options.transcludeControllers,
                  futureParentElement = options.futureParentElement;
              if (parentBoundTranscludeFn && parentBoundTranscludeFn.$$boundTransclude) {
                parentBoundTranscludeFn = parentBoundTranscludeFn.$$boundTransclude;
              }
              if (!namespace) {
                namespace = detectNamespaceForChildElements(futureParentElement);
              }
              var $linkNode;
              if (namespace !== 'html') {
                $linkNode = jqLite(wrapTemplate(namespace, jqLite('<div>').append($compileNodes).html()));
              } else if (cloneConnectFn) {
                $linkNode = JQLitePrototype.clone.call($compileNodes);
              } else {
                $linkNode = $compileNodes;
              }
              if (transcludeControllers) {
                for (var controllerName in transcludeControllers) {
                  $linkNode.data('$' + controllerName + 'Controller', transcludeControllers[controllerName].instance);
                }
              }
              compile.$$addScopeInfo($linkNode, scope);
              if (cloneConnectFn)
                cloneConnectFn($linkNode, scope);
              if (compositeLinkFn)
                compositeLinkFn(scope, $linkNode, $linkNode, parentBoundTranscludeFn);
              return $linkNode;
            };
          }
          function detectNamespaceForChildElements(parentElement) {
            var node = parentElement && parentElement[0];
            if (!node) {
              return 'html';
            } else {
              return nodeName_(node) !== 'foreignobject' && node.toString().match(/SVG/) ? 'svg' : 'html';
            }
          }
          function compileNodes(nodeList, transcludeFn, $rootElement, maxPriority, ignoreDirective, previousCompileContext) {
            var linkFns = [],
                attrs,
                directives,
                nodeLinkFn,
                childNodes,
                childLinkFn,
                linkFnFound,
                nodeLinkFnFound;
            for (var i = 0; i < nodeList.length; i++) {
              attrs = new Attributes();
              directives = collectDirectives(nodeList[i], [], attrs, i === 0 ? maxPriority : undefined, ignoreDirective);
              nodeLinkFn = (directives.length) ? applyDirectivesToNode(directives, nodeList[i], attrs, transcludeFn, $rootElement, null, [], [], previousCompileContext) : null;
              if (nodeLinkFn && nodeLinkFn.scope) {
                compile.$$addScopeClass(attrs.$$element);
              }
              childLinkFn = (nodeLinkFn && nodeLinkFn.terminal || !(childNodes = nodeList[i].childNodes) || !childNodes.length) ? null : compileNodes(childNodes, nodeLinkFn ? ((nodeLinkFn.transcludeOnThisElement || !nodeLinkFn.templateOnThisElement) && nodeLinkFn.transclude) : transcludeFn);
              if (nodeLinkFn || childLinkFn) {
                linkFns.push(i, nodeLinkFn, childLinkFn);
                linkFnFound = true;
                nodeLinkFnFound = nodeLinkFnFound || nodeLinkFn;
              }
              previousCompileContext = null;
            }
            return linkFnFound ? compositeLinkFn : null;
            function compositeLinkFn(scope, nodeList, $rootElement, parentBoundTranscludeFn) {
              var nodeLinkFn,
                  childLinkFn,
                  node,
                  childScope,
                  i,
                  ii,
                  idx,
                  childBoundTranscludeFn;
              var stableNodeList;
              if (nodeLinkFnFound) {
                var nodeListLength = nodeList.length;
                stableNodeList = new Array(nodeListLength);
                for (i = 0; i < linkFns.length; i += 3) {
                  idx = linkFns[i];
                  stableNodeList[idx] = nodeList[idx];
                }
              } else {
                stableNodeList = nodeList;
              }
              for (i = 0, ii = linkFns.length; i < ii; ) {
                node = stableNodeList[linkFns[i++]];
                nodeLinkFn = linkFns[i++];
                childLinkFn = linkFns[i++];
                if (nodeLinkFn) {
                  if (nodeLinkFn.scope) {
                    childScope = scope.$new();
                    compile.$$addScopeInfo(jqLite(node), childScope);
                    var destroyBindings = nodeLinkFn.$$destroyBindings;
                    if (destroyBindings) {
                      nodeLinkFn.$$destroyBindings = null;
                      childScope.$on('$destroyed', destroyBindings);
                    }
                  } else {
                    childScope = scope;
                  }
                  if (nodeLinkFn.transcludeOnThisElement) {
                    childBoundTranscludeFn = createBoundTranscludeFn(scope, nodeLinkFn.transclude, parentBoundTranscludeFn);
                  } else if (!nodeLinkFn.templateOnThisElement && parentBoundTranscludeFn) {
                    childBoundTranscludeFn = parentBoundTranscludeFn;
                  } else if (!parentBoundTranscludeFn && transcludeFn) {
                    childBoundTranscludeFn = createBoundTranscludeFn(scope, transcludeFn);
                  } else {
                    childBoundTranscludeFn = null;
                  }
                  nodeLinkFn(childLinkFn, childScope, node, $rootElement, childBoundTranscludeFn, nodeLinkFn);
                } else if (childLinkFn) {
                  childLinkFn(scope, node.childNodes, undefined, parentBoundTranscludeFn);
                }
              }
            }
          }
          function createBoundTranscludeFn(scope, transcludeFn, previousBoundTranscludeFn) {
            var boundTranscludeFn = function(transcludedScope, cloneFn, controllers, futureParentElement, containingScope) {
              if (!transcludedScope) {
                transcludedScope = scope.$new(false, containingScope);
                transcludedScope.$$transcluded = true;
              }
              return transcludeFn(transcludedScope, cloneFn, {
                parentBoundTranscludeFn: previousBoundTranscludeFn,
                transcludeControllers: controllers,
                futureParentElement: futureParentElement
              });
            };
            return boundTranscludeFn;
          }
          function collectDirectives(node, directives, attrs, maxPriority, ignoreDirective) {
            var nodeType = node.nodeType,
                attrsMap = attrs.$attr,
                match,
                className;
            switch (nodeType) {
              case NODE_TYPE_ELEMENT:
                addDirective(directives, directiveNormalize(nodeName_(node)), 'E', maxPriority, ignoreDirective);
                for (var attr,
                    name,
                    nName,
                    ngAttrName,
                    value,
                    isNgAttr,
                    nAttrs = node.attributes,
                    j = 0,
                    jj = nAttrs && nAttrs.length; j < jj; j++) {
                  var attrStartName = false;
                  var attrEndName = false;
                  attr = nAttrs[j];
                  name = attr.name;
                  value = trim(attr.value);
                  ngAttrName = directiveNormalize(name);
                  if (isNgAttr = NG_ATTR_BINDING.test(ngAttrName)) {
                    name = name.replace(PREFIX_REGEXP, '').substr(8).replace(/_(.)/g, function(match, letter) {
                      return letter.toUpperCase();
                    });
                  }
                  var directiveNName = ngAttrName.replace(/(Start|End)$/, '');
                  if (directiveIsMultiElement(directiveNName)) {
                    if (ngAttrName === directiveNName + 'Start') {
                      attrStartName = name;
                      attrEndName = name.substr(0, name.length - 5) + 'end';
                      name = name.substr(0, name.length - 6);
                    }
                  }
                  nName = directiveNormalize(name.toLowerCase());
                  attrsMap[nName] = name;
                  if (isNgAttr || !attrs.hasOwnProperty(nName)) {
                    attrs[nName] = value;
                    if (getBooleanAttrName(node, nName)) {
                      attrs[nName] = true;
                    }
                  }
                  addAttrInterpolateDirective(node, directives, value, nName, isNgAttr);
                  addDirective(directives, nName, 'A', maxPriority, ignoreDirective, attrStartName, attrEndName);
                }
                className = node.className;
                if (isObject(className)) {
                  className = className.animVal;
                }
                if (isString(className) && className !== '') {
                  while (match = CLASS_DIRECTIVE_REGEXP.exec(className)) {
                    nName = directiveNormalize(match[2]);
                    if (addDirective(directives, nName, 'C', maxPriority, ignoreDirective)) {
                      attrs[nName] = trim(match[3]);
                    }
                    className = className.substr(match.index + match[0].length);
                  }
                }
                break;
              case NODE_TYPE_TEXT:
                if (msie === 11) {
                  while (node.parentNode && node.nextSibling && node.nextSibling.nodeType === NODE_TYPE_TEXT) {
                    node.nodeValue = node.nodeValue + node.nextSibling.nodeValue;
                    node.parentNode.removeChild(node.nextSibling);
                  }
                }
                addTextInterpolateDirective(directives, node.nodeValue);
                break;
              case NODE_TYPE_COMMENT:
                try {
                  match = COMMENT_DIRECTIVE_REGEXP.exec(node.nodeValue);
                  if (match) {
                    nName = directiveNormalize(match[1]);
                    if (addDirective(directives, nName, 'M', maxPriority, ignoreDirective)) {
                      attrs[nName] = trim(match[2]);
                    }
                  }
                } catch (e) {}
                break;
            }
            directives.sort(byPriority);
            return directives;
          }
          function groupScan(node, attrStart, attrEnd) {
            var nodes = [];
            var depth = 0;
            if (attrStart && node.hasAttribute && node.hasAttribute(attrStart)) {
              do {
                if (!node) {
                  throw $compileMinErr('uterdir', "Unterminated attribute, found '{0}' but no matching '{1}' found.", attrStart, attrEnd);
                }
                if (node.nodeType == NODE_TYPE_ELEMENT) {
                  if (node.hasAttribute(attrStart))
                    depth++;
                  if (node.hasAttribute(attrEnd))
                    depth--;
                }
                nodes.push(node);
                node = node.nextSibling;
              } while (depth > 0);
            } else {
              nodes.push(node);
            }
            return jqLite(nodes);
          }
          function groupElementsLinkFnWrapper(linkFn, attrStart, attrEnd) {
            return function(scope, element, attrs, controllers, transcludeFn) {
              element = groupScan(element[0], attrStart, attrEnd);
              return linkFn(scope, element, attrs, controllers, transcludeFn);
            };
          }
          function applyDirectivesToNode(directives, compileNode, templateAttrs, transcludeFn, jqCollection, originalReplaceDirective, preLinkFns, postLinkFns, previousCompileContext) {
            previousCompileContext = previousCompileContext || {};
            var terminalPriority = -Number.MAX_VALUE,
                newScopeDirective = previousCompileContext.newScopeDirective,
                controllerDirectives = previousCompileContext.controllerDirectives,
                newIsolateScopeDirective = previousCompileContext.newIsolateScopeDirective,
                templateDirective = previousCompileContext.templateDirective,
                nonTlbTranscludeDirective = previousCompileContext.nonTlbTranscludeDirective,
                hasTranscludeDirective = false,
                hasTemplate = false,
                hasElementTranscludeDirective = previousCompileContext.hasElementTranscludeDirective,
                $compileNode = templateAttrs.$$element = jqLite(compileNode),
                directive,
                directiveName,
                $template,
                replaceDirective = originalReplaceDirective,
                childTranscludeFn = transcludeFn,
                linkFn,
                directiveValue;
            for (var i = 0,
                ii = directives.length; i < ii; i++) {
              directive = directives[i];
              var attrStart = directive.$$start;
              var attrEnd = directive.$$end;
              if (attrStart) {
                $compileNode = groupScan(compileNode, attrStart, attrEnd);
              }
              $template = undefined;
              if (terminalPriority > directive.priority) {
                break;
              }
              if (directiveValue = directive.scope) {
                if (!directive.templateUrl) {
                  if (isObject(directiveValue)) {
                    assertNoDuplicate('new/isolated scope', newIsolateScopeDirective || newScopeDirective, directive, $compileNode);
                    newIsolateScopeDirective = directive;
                  } else {
                    assertNoDuplicate('new/isolated scope', newIsolateScopeDirective, directive, $compileNode);
                  }
                }
                newScopeDirective = newScopeDirective || directive;
              }
              directiveName = directive.name;
              if (!directive.templateUrl && directive.controller) {
                directiveValue = directive.controller;
                controllerDirectives = controllerDirectives || createMap();
                assertNoDuplicate("'" + directiveName + "' controller", controllerDirectives[directiveName], directive, $compileNode);
                controllerDirectives[directiveName] = directive;
              }
              if (directiveValue = directive.transclude) {
                hasTranscludeDirective = true;
                if (!directive.$$tlb) {
                  assertNoDuplicate('transclusion', nonTlbTranscludeDirective, directive, $compileNode);
                  nonTlbTranscludeDirective = directive;
                }
                if (directiveValue == 'element') {
                  hasElementTranscludeDirective = true;
                  terminalPriority = directive.priority;
                  $template = $compileNode;
                  $compileNode = templateAttrs.$$element = jqLite(document.createComment(' ' + directiveName + ': ' + templateAttrs[directiveName] + ' '));
                  compileNode = $compileNode[0];
                  replaceWith(jqCollection, sliceArgs($template), compileNode);
                  childTranscludeFn = compile($template, transcludeFn, terminalPriority, replaceDirective && replaceDirective.name, {nonTlbTranscludeDirective: nonTlbTranscludeDirective});
                } else {
                  $template = jqLite(jqLiteClone(compileNode)).contents();
                  $compileNode.empty();
                  childTranscludeFn = compile($template, transcludeFn);
                }
              }
              if (directive.template) {
                hasTemplate = true;
                assertNoDuplicate('template', templateDirective, directive, $compileNode);
                templateDirective = directive;
                directiveValue = (isFunction(directive.template)) ? directive.template($compileNode, templateAttrs) : directive.template;
                directiveValue = denormalizeTemplate(directiveValue);
                if (directive.replace) {
                  replaceDirective = directive;
                  if (jqLiteIsTextNode(directiveValue)) {
                    $template = [];
                  } else {
                    $template = removeComments(wrapTemplate(directive.templateNamespace, trim(directiveValue)));
                  }
                  compileNode = $template[0];
                  if ($template.length != 1 || compileNode.nodeType !== NODE_TYPE_ELEMENT) {
                    throw $compileMinErr('tplrt', "Template for directive '{0}' must have exactly one root element. {1}", directiveName, '');
                  }
                  replaceWith(jqCollection, $compileNode, compileNode);
                  var newTemplateAttrs = {$attr: {}};
                  var templateDirectives = collectDirectives(compileNode, [], newTemplateAttrs);
                  var unprocessedDirectives = directives.splice(i + 1, directives.length - (i + 1));
                  if (newIsolateScopeDirective) {
                    markDirectivesAsIsolate(templateDirectives);
                  }
                  directives = directives.concat(templateDirectives).concat(unprocessedDirectives);
                  mergeTemplateAttributes(templateAttrs, newTemplateAttrs);
                  ii = directives.length;
                } else {
                  $compileNode.html(directiveValue);
                }
              }
              if (directive.templateUrl) {
                hasTemplate = true;
                assertNoDuplicate('template', templateDirective, directive, $compileNode);
                templateDirective = directive;
                if (directive.replace) {
                  replaceDirective = directive;
                }
                nodeLinkFn = compileTemplateUrl(directives.splice(i, directives.length - i), $compileNode, templateAttrs, jqCollection, hasTranscludeDirective && childTranscludeFn, preLinkFns, postLinkFns, {
                  controllerDirectives: controllerDirectives,
                  newScopeDirective: (newScopeDirective !== directive) && newScopeDirective,
                  newIsolateScopeDirective: newIsolateScopeDirective,
                  templateDirective: templateDirective,
                  nonTlbTranscludeDirective: nonTlbTranscludeDirective
                });
                ii = directives.length;
              } else if (directive.compile) {
                try {
                  linkFn = directive.compile($compileNode, templateAttrs, childTranscludeFn);
                  if (isFunction(linkFn)) {
                    addLinkFns(null, linkFn, attrStart, attrEnd);
                  } else if (linkFn) {
                    addLinkFns(linkFn.pre, linkFn.post, attrStart, attrEnd);
                  }
                } catch (e) {
                  $exceptionHandler(e, startingTag($compileNode));
                }
              }
              if (directive.terminal) {
                nodeLinkFn.terminal = true;
                terminalPriority = Math.max(terminalPriority, directive.priority);
              }
            }
            nodeLinkFn.scope = newScopeDirective && newScopeDirective.scope === true;
            nodeLinkFn.transcludeOnThisElement = hasTranscludeDirective;
            nodeLinkFn.templateOnThisElement = hasTemplate;
            nodeLinkFn.transclude = childTranscludeFn;
            previousCompileContext.hasElementTranscludeDirective = hasElementTranscludeDirective;
            return nodeLinkFn;
            function addLinkFns(pre, post, attrStart, attrEnd) {
              if (pre) {
                if (attrStart)
                  pre = groupElementsLinkFnWrapper(pre, attrStart, attrEnd);
                pre.require = directive.require;
                pre.directiveName = directiveName;
                if (newIsolateScopeDirective === directive || directive.$$isolateScope) {
                  pre = cloneAndAnnotateFn(pre, {isolateScope: true});
                }
                preLinkFns.push(pre);
              }
              if (post) {
                if (attrStart)
                  post = groupElementsLinkFnWrapper(post, attrStart, attrEnd);
                post.require = directive.require;
                post.directiveName = directiveName;
                if (newIsolateScopeDirective === directive || directive.$$isolateScope) {
                  post = cloneAndAnnotateFn(post, {isolateScope: true});
                }
                postLinkFns.push(post);
              }
            }
            function getControllers(directiveName, require, $element, elementControllers) {
              var value;
              if (isString(require)) {
                var match = require.match(REQUIRE_PREFIX_REGEXP);
                var name = require.substring(match[0].length);
                var inheritType = match[1] || match[3];
                var optional = match[2] === '?';
                if (inheritType === '^^') {
                  $element = $element.parent();
                } else {
                  value = elementControllers && elementControllers[name];
                  value = value && value.instance;
                }
                if (!value) {
                  var dataName = '$' + name + 'Controller';
                  value = inheritType ? $element.inheritedData(dataName) : $element.data(dataName);
                }
                if (!value && !optional) {
                  throw $compileMinErr('ctreq', "Controller '{0}', required by directive '{1}', can't be found!", name, directiveName);
                }
              } else if (isArray(require)) {
                value = [];
                for (var i = 0,
                    ii = require.length; i < ii; i++) {
                  value[i] = getControllers(directiveName, require[i], $element, elementControllers);
                }
              }
              return value || null;
            }
            function setupControllers($element, attrs, transcludeFn, controllerDirectives, isolateScope, scope) {
              var elementControllers = createMap();
              for (var controllerKey in controllerDirectives) {
                var directive = controllerDirectives[controllerKey];
                var locals = {
                  $scope: directive === newIsolateScopeDirective || directive.$$isolateScope ? isolateScope : scope,
                  $element: $element,
                  $attrs: attrs,
                  $transclude: transcludeFn
                };
                var controller = directive.controller;
                if (controller == '@') {
                  controller = attrs[directive.name];
                }
                var controllerInstance = $controller(controller, locals, true, directive.controllerAs);
                elementControllers[directive.name] = controllerInstance;
                if (!hasElementTranscludeDirective) {
                  $element.data('$' + directive.name + 'Controller', controllerInstance.instance);
                }
              }
              return elementControllers;
            }
            function nodeLinkFn(childLinkFn, scope, linkNode, $rootElement, boundTranscludeFn, thisLinkFn) {
              var i,
                  ii,
                  linkFn,
                  controller,
                  isolateScope,
                  elementControllers,
                  transcludeFn,
                  $element,
                  attrs;
              if (compileNode === linkNode) {
                attrs = templateAttrs;
                $element = templateAttrs.$$element;
              } else {
                $element = jqLite(linkNode);
                attrs = new Attributes($element, templateAttrs);
              }
              if (newIsolateScopeDirective) {
                isolateScope = scope.$new(true);
              }
              if (boundTranscludeFn) {
                transcludeFn = controllersBoundTransclude;
                transcludeFn.$$boundTransclude = boundTranscludeFn;
              }
              if (controllerDirectives) {
                elementControllers = setupControllers($element, attrs, transcludeFn, controllerDirectives, isolateScope, scope);
              }
              if (newIsolateScopeDirective) {
                compile.$$addScopeInfo($element, isolateScope, true, !(templateDirective && (templateDirective === newIsolateScopeDirective || templateDirective === newIsolateScopeDirective.$$originalDirective)));
                compile.$$addScopeClass($element, true);
                isolateScope.$$isolateBindings = newIsolateScopeDirective.$$isolateBindings;
                initializeDirectiveBindings(scope, attrs, isolateScope, isolateScope.$$isolateBindings, newIsolateScopeDirective, isolateScope);
              }
              if (elementControllers) {
                var scopeDirective = newIsolateScopeDirective || newScopeDirective;
                var bindings;
                var controllerForBindings;
                if (scopeDirective && elementControllers[scopeDirective.name]) {
                  bindings = scopeDirective.$$bindings.bindToController;
                  controller = elementControllers[scopeDirective.name];
                  if (controller && controller.identifier && bindings) {
                    controllerForBindings = controller;
                    thisLinkFn.$$destroyBindings = initializeDirectiveBindings(scope, attrs, controller.instance, bindings, scopeDirective);
                  }
                }
                for (i in elementControllers) {
                  controller = elementControllers[i];
                  var controllerResult = controller();
                  if (controllerResult !== controller.instance) {
                    controller.instance = controllerResult;
                    $element.data('$' + i + 'Controller', controllerResult);
                    if (controller === controllerForBindings) {
                      thisLinkFn.$$destroyBindings();
                      thisLinkFn.$$destroyBindings = initializeDirectiveBindings(scope, attrs, controllerResult, bindings, scopeDirective);
                    }
                  }
                }
              }
              for (i = 0, ii = preLinkFns.length; i < ii; i++) {
                linkFn = preLinkFns[i];
                invokeLinkFn(linkFn, linkFn.isolateScope ? isolateScope : scope, $element, attrs, linkFn.require && getControllers(linkFn.directiveName, linkFn.require, $element, elementControllers), transcludeFn);
              }
              var scopeToChild = scope;
              if (newIsolateScopeDirective && (newIsolateScopeDirective.template || newIsolateScopeDirective.templateUrl === null)) {
                scopeToChild = isolateScope;
              }
              childLinkFn && childLinkFn(scopeToChild, linkNode.childNodes, undefined, boundTranscludeFn);
              for (i = postLinkFns.length - 1; i >= 0; i--) {
                linkFn = postLinkFns[i];
                invokeLinkFn(linkFn, linkFn.isolateScope ? isolateScope : scope, $element, attrs, linkFn.require && getControllers(linkFn.directiveName, linkFn.require, $element, elementControllers), transcludeFn);
              }
              function controllersBoundTransclude(scope, cloneAttachFn, futureParentElement) {
                var transcludeControllers;
                if (!isScope(scope)) {
                  futureParentElement = cloneAttachFn;
                  cloneAttachFn = scope;
                  scope = undefined;
                }
                if (hasElementTranscludeDirective) {
                  transcludeControllers = elementControllers;
                }
                if (!futureParentElement) {
                  futureParentElement = hasElementTranscludeDirective ? $element.parent() : $element;
                }
                return boundTranscludeFn(scope, cloneAttachFn, transcludeControllers, futureParentElement, scopeToChild);
              }
            }
          }
          function markDirectivesAsIsolate(directives) {
            for (var j = 0,
                jj = directives.length; j < jj; j++) {
              directives[j] = inherit(directives[j], {$$isolateScope: true});
            }
          }
          function addDirective(tDirectives, name, location, maxPriority, ignoreDirective, startAttrName, endAttrName) {
            if (name === ignoreDirective)
              return null;
            var match = null;
            if (hasDirectives.hasOwnProperty(name)) {
              for (var directive,
                  directives = $injector.get(name + Suffix),
                  i = 0,
                  ii = directives.length; i < ii; i++) {
                try {
                  directive = directives[i];
                  if ((isUndefined(maxPriority) || maxPriority > directive.priority) && directive.restrict.indexOf(location) != -1) {
                    if (startAttrName) {
                      directive = inherit(directive, {
                        $$start: startAttrName,
                        $$end: endAttrName
                      });
                    }
                    tDirectives.push(directive);
                    match = directive;
                  }
                } catch (e) {
                  $exceptionHandler(e);
                }
              }
            }
            return match;
          }
          function directiveIsMultiElement(name) {
            if (hasDirectives.hasOwnProperty(name)) {
              for (var directive,
                  directives = $injector.get(name + Suffix),
                  i = 0,
                  ii = directives.length; i < ii; i++) {
                directive = directives[i];
                if (directive.multiElement) {
                  return true;
                }
              }
            }
            return false;
          }
          function mergeTemplateAttributes(dst, src) {
            var srcAttr = src.$attr,
                dstAttr = dst.$attr,
                $element = dst.$$element;
            forEach(dst, function(value, key) {
              if (key.charAt(0) != '$') {
                if (src[key] && src[key] !== value) {
                  value += (key === 'style' ? ';' : ' ') + src[key];
                }
                dst.$set(key, value, true, srcAttr[key]);
              }
            });
            forEach(src, function(value, key) {
              if (key == 'class') {
                safeAddClass($element, value);
                dst['class'] = (dst['class'] ? dst['class'] + ' ' : '') + value;
              } else if (key == 'style') {
                $element.attr('style', $element.attr('style') + ';' + value);
                dst['style'] = (dst['style'] ? dst['style'] + ';' : '') + value;
              } else if (key.charAt(0) != '$' && !dst.hasOwnProperty(key)) {
                dst[key] = value;
                dstAttr[key] = srcAttr[key];
              }
            });
          }
          function compileTemplateUrl(directives, $compileNode, tAttrs, $rootElement, childTranscludeFn, preLinkFns, postLinkFns, previousCompileContext) {
            var linkQueue = [],
                afterTemplateNodeLinkFn,
                afterTemplateChildLinkFn,
                beforeTemplateCompileNode = $compileNode[0],
                origAsyncDirective = directives.shift(),
                derivedSyncDirective = inherit(origAsyncDirective, {
                  templateUrl: null,
                  transclude: null,
                  replace: null,
                  $$originalDirective: origAsyncDirective
                }),
                templateUrl = (isFunction(origAsyncDirective.templateUrl)) ? origAsyncDirective.templateUrl($compileNode, tAttrs) : origAsyncDirective.templateUrl,
                templateNamespace = origAsyncDirective.templateNamespace;
            $compileNode.empty();
            $templateRequest(templateUrl).then(function(content) {
              var compileNode,
                  tempTemplateAttrs,
                  $template,
                  childBoundTranscludeFn;
              content = denormalizeTemplate(content);
              if (origAsyncDirective.replace) {
                if (jqLiteIsTextNode(content)) {
                  $template = [];
                } else {
                  $template = removeComments(wrapTemplate(templateNamespace, trim(content)));
                }
                compileNode = $template[0];
                if ($template.length != 1 || compileNode.nodeType !== NODE_TYPE_ELEMENT) {
                  throw $compileMinErr('tplrt', "Template for directive '{0}' must have exactly one root element. {1}", origAsyncDirective.name, templateUrl);
                }
                tempTemplateAttrs = {$attr: {}};
                replaceWith($rootElement, $compileNode, compileNode);
                var templateDirectives = collectDirectives(compileNode, [], tempTemplateAttrs);
                if (isObject(origAsyncDirective.scope)) {
                  markDirectivesAsIsolate(templateDirectives);
                }
                directives = templateDirectives.concat(directives);
                mergeTemplateAttributes(tAttrs, tempTemplateAttrs);
              } else {
                compileNode = beforeTemplateCompileNode;
                $compileNode.html(content);
              }
              directives.unshift(derivedSyncDirective);
              afterTemplateNodeLinkFn = applyDirectivesToNode(directives, compileNode, tAttrs, childTranscludeFn, $compileNode, origAsyncDirective, preLinkFns, postLinkFns, previousCompileContext);
              forEach($rootElement, function(node, i) {
                if (node == compileNode) {
                  $rootElement[i] = $compileNode[0];
                }
              });
              afterTemplateChildLinkFn = compileNodes($compileNode[0].childNodes, childTranscludeFn);
              while (linkQueue.length) {
                var scope = linkQueue.shift(),
                    beforeTemplateLinkNode = linkQueue.shift(),
                    linkRootElement = linkQueue.shift(),
                    boundTranscludeFn = linkQueue.shift(),
                    linkNode = $compileNode[0];
                if (scope.$$destroyed)
                  continue;
                if (beforeTemplateLinkNode !== beforeTemplateCompileNode) {
                  var oldClasses = beforeTemplateLinkNode.className;
                  if (!(previousCompileContext.hasElementTranscludeDirective && origAsyncDirective.replace)) {
                    linkNode = jqLiteClone(compileNode);
                  }
                  replaceWith(linkRootElement, jqLite(beforeTemplateLinkNode), linkNode);
                  safeAddClass(jqLite(linkNode), oldClasses);
                }
                if (afterTemplateNodeLinkFn.transcludeOnThisElement) {
                  childBoundTranscludeFn = createBoundTranscludeFn(scope, afterTemplateNodeLinkFn.transclude, boundTranscludeFn);
                } else {
                  childBoundTranscludeFn = boundTranscludeFn;
                }
                afterTemplateNodeLinkFn(afterTemplateChildLinkFn, scope, linkNode, $rootElement, childBoundTranscludeFn, afterTemplateNodeLinkFn);
              }
              linkQueue = null;
            });
            return function delayedNodeLinkFn(ignoreChildLinkFn, scope, node, rootElement, boundTranscludeFn) {
              var childBoundTranscludeFn = boundTranscludeFn;
              if (scope.$$destroyed)
                return;
              if (linkQueue) {
                linkQueue.push(scope, node, rootElement, childBoundTranscludeFn);
              } else {
                if (afterTemplateNodeLinkFn.transcludeOnThisElement) {
                  childBoundTranscludeFn = createBoundTranscludeFn(scope, afterTemplateNodeLinkFn.transclude, boundTranscludeFn);
                }
                afterTemplateNodeLinkFn(afterTemplateChildLinkFn, scope, node, rootElement, childBoundTranscludeFn, afterTemplateNodeLinkFn);
              }
            };
          }
          function byPriority(a, b) {
            var diff = b.priority - a.priority;
            if (diff !== 0)
              return diff;
            if (a.name !== b.name)
              return (a.name < b.name) ? -1 : 1;
            return a.index - b.index;
          }
          function assertNoDuplicate(what, previousDirective, directive, element) {
            function wrapModuleNameIfDefined(moduleName) {
              return moduleName ? (' (module: ' + moduleName + ')') : '';
            }
            if (previousDirective) {
              throw $compileMinErr('multidir', 'Multiple directives [{0}{1}, {2}{3}] asking for {4} on: {5}', previousDirective.name, wrapModuleNameIfDefined(previousDirective.$$moduleName), directive.name, wrapModuleNameIfDefined(directive.$$moduleName), what, startingTag(element));
            }
          }
          function addTextInterpolateDirective(directives, text) {
            var interpolateFn = $interpolate(text, true);
            if (interpolateFn) {
              directives.push({
                priority: 0,
                compile: function textInterpolateCompileFn(templateNode) {
                  var templateNodeParent = templateNode.parent(),
                      hasCompileParent = !!templateNodeParent.length;
                  if (hasCompileParent)
                    compile.$$addBindingClass(templateNodeParent);
                  return function textInterpolateLinkFn(scope, node) {
                    var parent = node.parent();
                    if (!hasCompileParent)
                      compile.$$addBindingClass(parent);
                    compile.$$addBindingInfo(parent, interpolateFn.expressions);
                    scope.$watch(interpolateFn, function interpolateFnWatchAction(value) {
                      node[0].nodeValue = value;
                    });
                  };
                }
              });
            }
          }
          function wrapTemplate(type, template) {
            type = lowercase(type || 'html');
            switch (type) {
              case 'svg':
              case 'math':
                var wrapper = document.createElement('div');
                wrapper.innerHTML = '<' + type + '>' + template + '</' + type + '>';
                return wrapper.childNodes[0].childNodes;
              default:
                return template;
            }
          }
          function getTrustedContext(node, attrNormalizedName) {
            if (attrNormalizedName == "srcdoc") {
              return $sce.HTML;
            }
            var tag = nodeName_(node);
            if (attrNormalizedName == "xlinkHref" || (tag == "form" && attrNormalizedName == "action") || (tag != "img" && (attrNormalizedName == "src" || attrNormalizedName == "ngSrc"))) {
              return $sce.RESOURCE_URL;
            }
          }
          function addAttrInterpolateDirective(node, directives, value, name, allOrNothing) {
            var trustedContext = getTrustedContext(node, name);
            allOrNothing = ALL_OR_NOTHING_ATTRS[name] || allOrNothing;
            var interpolateFn = $interpolate(value, true, trustedContext, allOrNothing);
            if (!interpolateFn)
              return;
            if (name === "multiple" && nodeName_(node) === "select") {
              throw $compileMinErr("selmulti", "Binding to the 'multiple' attribute is not supported. Element: {0}", startingTag(node));
            }
            directives.push({
              priority: 100,
              compile: function() {
                return {pre: function attrInterpolatePreLinkFn(scope, element, attr) {
                    var $$observers = (attr.$$observers || (attr.$$observers = {}));
                    if (EVENT_HANDLER_ATTR_REGEXP.test(name)) {
                      throw $compileMinErr('nodomevents', "Interpolations for HTML DOM event attributes are disallowed.  Please use the " + "ng- versions (such as ng-click instead of onclick) instead.");
                    }
                    var newValue = attr[name];
                    if (newValue !== value) {
                      interpolateFn = newValue && $interpolate(newValue, true, trustedContext, allOrNothing);
                      value = newValue;
                    }
                    if (!interpolateFn)
                      return;
                    attr[name] = interpolateFn(scope);
                    ($$observers[name] || ($$observers[name] = [])).$$inter = true;
                    (attr.$$observers && attr.$$observers[name].$$scope || scope).$watch(interpolateFn, function interpolateFnWatchAction(newValue, oldValue) {
                      if (name === 'class' && newValue != oldValue) {
                        attr.$updateClass(newValue, oldValue);
                      } else {
                        attr.$set(name, newValue);
                      }
                    });
                  }};
              }
            });
          }
          function replaceWith($rootElement, elementsToRemove, newNode) {
            var firstElementToRemove = elementsToRemove[0],
                removeCount = elementsToRemove.length,
                parent = firstElementToRemove.parentNode,
                i,
                ii;
            if ($rootElement) {
              for (i = 0, ii = $rootElement.length; i < ii; i++) {
                if ($rootElement[i] == firstElementToRemove) {
                  $rootElement[i++] = newNode;
                  for (var j = i,
                      j2 = j + removeCount - 1,
                      jj = $rootElement.length; j < jj; j++, j2++) {
                    if (j2 < jj) {
                      $rootElement[j] = $rootElement[j2];
                    } else {
                      delete $rootElement[j];
                    }
                  }
                  $rootElement.length -= removeCount - 1;
                  if ($rootElement.context === firstElementToRemove) {
                    $rootElement.context = newNode;
                  }
                  break;
                }
              }
            }
            if (parent) {
              parent.replaceChild(newNode, firstElementToRemove);
            }
            var fragment = document.createDocumentFragment();
            fragment.appendChild(firstElementToRemove);
            if (jqLite.hasData(firstElementToRemove)) {
              jqLite(newNode).data(jqLite(firstElementToRemove).data());
              if (!jQuery) {
                delete jqLite.cache[firstElementToRemove[jqLite.expando]];
              } else {
                skipDestroyOnNextJQueryCleanData = true;
                jQuery.cleanData([firstElementToRemove]);
              }
            }
            for (var k = 1,
                kk = elementsToRemove.length; k < kk; k++) {
              var element = elementsToRemove[k];
              jqLite(element).remove();
              fragment.appendChild(element);
              delete elementsToRemove[k];
            }
            elementsToRemove[0] = newNode;
            elementsToRemove.length = 1;
          }
          function cloneAndAnnotateFn(fn, annotation) {
            return extend(function() {
              return fn.apply(null, arguments);
            }, fn, annotation);
          }
          function invokeLinkFn(linkFn, scope, $element, attrs, controllers, transcludeFn) {
            try {
              linkFn(scope, $element, attrs, controllers, transcludeFn);
            } catch (e) {
              $exceptionHandler(e, startingTag($element));
            }
          }
          function initializeDirectiveBindings(scope, attrs, destination, bindings, directive, newScope) {
            var onNewScopeDestroyed;
            forEach(bindings, function(definition, scopeName) {
              var attrName = definition.attrName,
                  optional = definition.optional,
                  mode = definition.mode,
                  lastValue,
                  parentGet,
                  parentSet,
                  compare;
              switch (mode) {
                case '@':
                  if (!optional && !hasOwnProperty.call(attrs, attrName)) {
                    destination[scopeName] = attrs[attrName] = void 0;
                  }
                  attrs.$observe(attrName, function(value) {
                    if (isString(value)) {
                      destination[scopeName] = value;
                    }
                  });
                  attrs.$$observers[attrName].$$scope = scope;
                  if (isString(attrs[attrName])) {
                    destination[scopeName] = $interpolate(attrs[attrName])(scope);
                  }
                  break;
                case '=':
                  if (!hasOwnProperty.call(attrs, attrName)) {
                    if (optional)
                      break;
                    attrs[attrName] = void 0;
                  }
                  if (optional && !attrs[attrName])
                    break;
                  parentGet = $parse(attrs[attrName]);
                  if (parentGet.literal) {
                    compare = equals;
                  } else {
                    compare = function(a, b) {
                      return a === b || (a !== a && b !== b);
                    };
                  }
                  parentSet = parentGet.assign || function() {
                    lastValue = destination[scopeName] = parentGet(scope);
                    throw $compileMinErr('nonassign', "Expression '{0}' used with directive '{1}' is non-assignable!", attrs[attrName], directive.name);
                  };
                  lastValue = destination[scopeName] = parentGet(scope);
                  var parentValueWatch = function parentValueWatch(parentValue) {
                    if (!compare(parentValue, destination[scopeName])) {
                      if (!compare(parentValue, lastValue)) {
                        destination[scopeName] = parentValue;
                      } else {
                        parentSet(scope, parentValue = destination[scopeName]);
                      }
                    }
                    return lastValue = parentValue;
                  };
                  parentValueWatch.$stateful = true;
                  var unwatch;
                  if (definition.collection) {
                    unwatch = scope.$watchCollection(attrs[attrName], parentValueWatch);
                  } else {
                    unwatch = scope.$watch($parse(attrs[attrName], parentValueWatch), null, parentGet.literal);
                  }
                  onNewScopeDestroyed = (onNewScopeDestroyed || []);
                  onNewScopeDestroyed.push(unwatch);
                  break;
                case '&':
                  parentGet = attrs.hasOwnProperty(attrName) ? $parse(attrs[attrName]) : noop;
                  if (parentGet === noop && optional)
                    break;
                  destination[scopeName] = function(locals) {
                    return parentGet(scope, locals);
                  };
                  break;
              }
            });
            var destroyBindings = onNewScopeDestroyed ? function destroyBindings() {
              for (var i = 0,
                  ii = onNewScopeDestroyed.length; i < ii; ++i) {
                onNewScopeDestroyed[i]();
              }
            } : noop;
            if (newScope && destroyBindings !== noop) {
              newScope.$on('$destroy', destroyBindings);
              return noop;
            }
            return destroyBindings;
          }
        }];
      }
      var PREFIX_REGEXP = /^((?:x|data)[\:\-_])/i;
      function directiveNormalize(name) {
        return camelCase(name.replace(PREFIX_REGEXP, ''));
      }
      function nodesetLinkingFn(scope, nodeList, rootElement, boundTranscludeFn) {}
      function directiveLinkingFn(nodesetLinkingFn, scope, node, rootElement, boundTranscludeFn) {}
      function tokenDifference(str1, str2) {
        var values = '',
            tokens1 = str1.split(/\s+/),
            tokens2 = str2.split(/\s+/);
        outer: for (var i = 0; i < tokens1.length; i++) {
          var token = tokens1[i];
          for (var j = 0; j < tokens2.length; j++) {
            if (token == tokens2[j])
              continue outer;
          }
          values += (values.length > 0 ? ' ' : '') + token;
        }
        return values;
      }
      function removeComments(jqNodes) {
        jqNodes = jqLite(jqNodes);
        var i = jqNodes.length;
        if (i <= 1) {
          return jqNodes;
        }
        while (i--) {
          var node = jqNodes[i];
          if (node.nodeType === NODE_TYPE_COMMENT) {
            splice.call(jqNodes, i, 1);
          }
        }
        return jqNodes;
      }
      var $controllerMinErr = minErr('$controller');
      var CNTRL_REG = /^(\S+)(\s+as\s+(\w+))?$/;
      function identifierForController(controller, ident) {
        if (ident && isString(ident))
          return ident;
        if (isString(controller)) {
          var match = CNTRL_REG.exec(controller);
          if (match)
            return match[3];
        }
      }
      function $ControllerProvider() {
        var controllers = {},
            globals = false;
        this.register = function(name, constructor) {
          assertNotHasOwnProperty(name, 'controller');
          if (isObject(name)) {
            extend(controllers, name);
          } else {
            controllers[name] = constructor;
          }
        };
        this.allowGlobals = function() {
          globals = true;
        };
        this.$get = ['$injector', '$window', function($injector, $window) {
          return function(expression, locals, later, ident) {
            var instance,
                match,
                constructor,
                identifier;
            later = later === true;
            if (ident && isString(ident)) {
              identifier = ident;
            }
            if (isString(expression)) {
              match = expression.match(CNTRL_REG);
              if (!match) {
                throw $controllerMinErr('ctrlfmt', "Badly formed controller string '{0}'. " + "Must match `__name__ as __id__` or `__name__`.", expression);
              }
              constructor = match[1], identifier = identifier || match[3];
              expression = controllers.hasOwnProperty(constructor) ? controllers[constructor] : getter(locals.$scope, constructor, true) || (globals ? getter($window, constructor, true) : undefined);
              assertArgFn(expression, constructor, true);
            }
            if (later) {
              var controllerPrototype = (isArray(expression) ? expression[expression.length - 1] : expression).prototype;
              instance = Object.create(controllerPrototype || null);
              if (identifier) {
                addIdentifier(locals, identifier, instance, constructor || expression.name);
              }
              var instantiate;
              return instantiate = extend(function() {
                var result = $injector.invoke(expression, instance, locals, constructor);
                if (result !== instance && (isObject(result) || isFunction(result))) {
                  instance = result;
                  if (identifier) {
                    addIdentifier(locals, identifier, instance, constructor || expression.name);
                  }
                }
                return instance;
              }, {
                instance: instance,
                identifier: identifier
              });
            }
            instance = $injector.instantiate(expression, locals, constructor);
            if (identifier) {
              addIdentifier(locals, identifier, instance, constructor || expression.name);
            }
            return instance;
          };
          function addIdentifier(locals, identifier, instance, name) {
            if (!(locals && isObject(locals.$scope))) {
              throw minErr('$controller')('noscp', "Cannot export controller '{0}' as '{1}'! No $scope object provided via `locals`.", name, identifier);
            }
            locals.$scope[identifier] = instance;
          }
        }];
      }
      function $DocumentProvider() {
        this.$get = ['$window', function(window) {
          return jqLite(window.document);
        }];
      }
      function $ExceptionHandlerProvider() {
        this.$get = ['$log', function($log) {
          return function(exception, cause) {
            $log.error.apply($log, arguments);
          };
        }];
      }
      var $$ForceReflowProvider = function() {
        this.$get = ['$document', function($document) {
          return function(domNode) {
            if (domNode) {
              if (!domNode.nodeType && domNode instanceof jqLite) {
                domNode = domNode[0];
              }
            } else {
              domNode = $document[0].body;
            }
            return domNode.offsetWidth + 1;
          };
        }];
      };
      var APPLICATION_JSON = 'application/json';
      var CONTENT_TYPE_APPLICATION_JSON = {'Content-Type': APPLICATION_JSON + ';charset=utf-8'};
      var JSON_START = /^\[|^\{(?!\{)/;
      var JSON_ENDS = {
        '[': /]$/,
        '{': /}$/
      };
      var JSON_PROTECTION_PREFIX = /^\)\]\}',?\n/;
      var $httpMinErr = minErr('$http');
      var $httpMinErrLegacyFn = function(method) {
        return function() {
          throw $httpMinErr('legacy', 'The method `{0}` on the promise returned from `$http` has been disabled.', method);
        };
      };
      function serializeValue(v) {
        if (isObject(v)) {
          return isDate(v) ? v.toISOString() : toJson(v);
        }
        return v;
      }
      function $HttpParamSerializerProvider() {
        this.$get = function() {
          return function ngParamSerializer(params) {
            if (!params)
              return '';
            var parts = [];
            forEachSorted(params, function(value, key) {
              if (value === null || isUndefined(value))
                return;
              if (isArray(value)) {
                forEach(value, function(v, k) {
                  parts.push(encodeUriQuery(key) + '=' + encodeUriQuery(serializeValue(v)));
                });
              } else {
                parts.push(encodeUriQuery(key) + '=' + encodeUriQuery(serializeValue(value)));
              }
            });
            return parts.join('&');
          };
        };
      }
      function $HttpParamSerializerJQLikeProvider() {
        this.$get = function() {
          return function jQueryLikeParamSerializer(params) {
            if (!params)
              return '';
            var parts = [];
            serialize(params, '', true);
            return parts.join('&');
            function serialize(toSerialize, prefix, topLevel) {
              if (toSerialize === null || isUndefined(toSerialize))
                return;
              if (isArray(toSerialize)) {
                forEach(toSerialize, function(value, index) {
                  serialize(value, prefix + '[' + (isObject(value) ? index : '') + ']');
                });
              } else if (isObject(toSerialize) && !isDate(toSerialize)) {
                forEachSorted(toSerialize, function(value, key) {
                  serialize(value, prefix + (topLevel ? '' : '[') + key + (topLevel ? '' : ']'));
                });
              } else {
                parts.push(encodeUriQuery(prefix) + '=' + encodeUriQuery(serializeValue(toSerialize)));
              }
            }
          };
        };
      }
      function defaultHttpResponseTransform(data, headers) {
        if (isString(data)) {
          var tempData = data.replace(JSON_PROTECTION_PREFIX, '').trim();
          if (tempData) {
            var contentType = headers('Content-Type');
            if ((contentType && (contentType.indexOf(APPLICATION_JSON) === 0)) || isJsonLike(tempData)) {
              data = fromJson(tempData);
            }
          }
        }
        return data;
      }
      function isJsonLike(str) {
        var jsonStart = str.match(JSON_START);
        return jsonStart && JSON_ENDS[jsonStart[0]].test(str);
      }
      function parseHeaders(headers) {
        var parsed = createMap(),
            i;
        function fillInParsed(key, val) {
          if (key) {
            parsed[key] = parsed[key] ? parsed[key] + ', ' + val : val;
          }
        }
        if (isString(headers)) {
          forEach(headers.split('\n'), function(line) {
            i = line.indexOf(':');
            fillInParsed(lowercase(trim(line.substr(0, i))), trim(line.substr(i + 1)));
          });
        } else if (isObject(headers)) {
          forEach(headers, function(headerVal, headerKey) {
            fillInParsed(lowercase(headerKey), trim(headerVal));
          });
        }
        return parsed;
      }
      function headersGetter(headers) {
        var headersObj;
        return function(name) {
          if (!headersObj)
            headersObj = parseHeaders(headers);
          if (name) {
            var value = headersObj[lowercase(name)];
            if (value === void 0) {
              value = null;
            }
            return value;
          }
          return headersObj;
        };
      }
      function transformData(data, headers, status, fns) {
        if (isFunction(fns)) {
          return fns(data, headers, status);
        }
        forEach(fns, function(fn) {
          data = fn(data, headers, status);
        });
        return data;
      }
      function isSuccess(status) {
        return 200 <= status && status < 300;
      }
      function $HttpProvider() {
        var defaults = this.defaults = {
          transformResponse: [defaultHttpResponseTransform],
          transformRequest: [function(d) {
            return isObject(d) && !isFile(d) && !isBlob(d) && !isFormData(d) ? toJson(d) : d;
          }],
          headers: {
            common: {'Accept': 'application/json, text/plain, */*'},
            post: shallowCopy(CONTENT_TYPE_APPLICATION_JSON),
            put: shallowCopy(CONTENT_TYPE_APPLICATION_JSON),
            patch: shallowCopy(CONTENT_TYPE_APPLICATION_JSON)
          },
          xsrfCookieName: 'XSRF-TOKEN',
          xsrfHeaderName: 'X-XSRF-TOKEN',
          paramSerializer: '$httpParamSerializer'
        };
        var useApplyAsync = false;
        this.useApplyAsync = function(value) {
          if (isDefined(value)) {
            useApplyAsync = !!value;
            return this;
          }
          return useApplyAsync;
        };
        var useLegacyPromise = true;
        this.useLegacyPromiseExtensions = function(value) {
          if (isDefined(value)) {
            useLegacyPromise = !!value;
            return this;
          }
          return useLegacyPromise;
        };
        var interceptorFactories = this.interceptors = [];
        this.$get = ['$httpBackend', '$$cookieReader', '$cacheFactory', '$rootScope', '$q', '$injector', function($httpBackend, $$cookieReader, $cacheFactory, $rootScope, $q, $injector) {
          var defaultCache = $cacheFactory('$http');
          defaults.paramSerializer = isString(defaults.paramSerializer) ? $injector.get(defaults.paramSerializer) : defaults.paramSerializer;
          var reversedInterceptors = [];
          forEach(interceptorFactories, function(interceptorFactory) {
            reversedInterceptors.unshift(isString(interceptorFactory) ? $injector.get(interceptorFactory) : $injector.invoke(interceptorFactory));
          });
          function $http(requestConfig) {
            if (!angular.isObject(requestConfig)) {
              throw minErr('$http')('badreq', 'Http request configuration must be an object.  Received: {0}', requestConfig);
            }
            var config = extend({
              method: 'get',
              transformRequest: defaults.transformRequest,
              transformResponse: defaults.transformResponse,
              paramSerializer: defaults.paramSerializer
            }, requestConfig);
            config.headers = mergeHeaders(requestConfig);
            config.method = uppercase(config.method);
            config.paramSerializer = isString(config.paramSerializer) ? $injector.get(config.paramSerializer) : config.paramSerializer;
            var serverRequest = function(config) {
              var headers = config.headers;
              var reqData = transformData(config.data, headersGetter(headers), undefined, config.transformRequest);
              if (isUndefined(reqData)) {
                forEach(headers, function(value, header) {
                  if (lowercase(header) === 'content-type') {
                    delete headers[header];
                  }
                });
              }
              if (isUndefined(config.withCredentials) && !isUndefined(defaults.withCredentials)) {
                config.withCredentials = defaults.withCredentials;
              }
              return sendReq(config, reqData).then(transformResponse, transformResponse);
            };
            var chain = [serverRequest, undefined];
            var promise = $q.when(config);
            forEach(reversedInterceptors, function(interceptor) {
              if (interceptor.request || interceptor.requestError) {
                chain.unshift(interceptor.request, interceptor.requestError);
              }
              if (interceptor.response || interceptor.responseError) {
                chain.push(interceptor.response, interceptor.responseError);
              }
            });
            while (chain.length) {
              var thenFn = chain.shift();
              var rejectFn = chain.shift();
              promise = promise.then(thenFn, rejectFn);
            }
            if (useLegacyPromise) {
              promise.success = function(fn) {
                assertArgFn(fn, 'fn');
                promise.then(function(response) {
                  fn(response.data, response.status, response.headers, config);
                });
                return promise;
              };
              promise.error = function(fn) {
                assertArgFn(fn, 'fn');
                promise.then(null, function(response) {
                  fn(response.data, response.status, response.headers, config);
                });
                return promise;
              };
            } else {
              promise.success = $httpMinErrLegacyFn('success');
              promise.error = $httpMinErrLegacyFn('error');
            }
            return promise;
            function transformResponse(response) {
              var resp = extend({}, response);
              if (!response.data) {
                resp.data = response.data;
              } else {
                resp.data = transformData(response.data, response.headers, response.status, config.transformResponse);
              }
              return (isSuccess(response.status)) ? resp : $q.reject(resp);
            }
            function executeHeaderFns(headers, config) {
              var headerContent,
                  processedHeaders = {};
              forEach(headers, function(headerFn, header) {
                if (isFunction(headerFn)) {
                  headerContent = headerFn(config);
                  if (headerContent != null) {
                    processedHeaders[header] = headerContent;
                  }
                } else {
                  processedHeaders[header] = headerFn;
                }
              });
              return processedHeaders;
            }
            function mergeHeaders(config) {
              var defHeaders = defaults.headers,
                  reqHeaders = extend({}, config.headers),
                  defHeaderName,
                  lowercaseDefHeaderName,
                  reqHeaderName;
              defHeaders = extend({}, defHeaders.common, defHeaders[lowercase(config.method)]);
              defaultHeadersIteration: for (defHeaderName in defHeaders) {
                lowercaseDefHeaderName = lowercase(defHeaderName);
                for (reqHeaderName in reqHeaders) {
                  if (lowercase(reqHeaderName) === lowercaseDefHeaderName) {
                    continue defaultHeadersIteration;
                  }
                }
                reqHeaders[defHeaderName] = defHeaders[defHeaderName];
              }
              return executeHeaderFns(reqHeaders, shallowCopy(config));
            }
          }
          $http.pendingRequests = [];
          createShortMethods('get', 'delete', 'head', 'jsonp');
          createShortMethodsWithData('post', 'put', 'patch');
          $http.defaults = defaults;
          return $http;
          function createShortMethods(names) {
            forEach(arguments, function(name) {
              $http[name] = function(url, config) {
                return $http(extend({}, config || {}, {
                  method: name,
                  url: url
                }));
              };
            });
          }
          function createShortMethodsWithData(name) {
            forEach(arguments, function(name) {
              $http[name] = function(url, data, config) {
                return $http(extend({}, config || {}, {
                  method: name,
                  url: url,
                  data: data
                }));
              };
            });
          }
          function sendReq(config, reqData) {
            var deferred = $q.defer(),
                promise = deferred.promise,
                cache,
                cachedResp,
                reqHeaders = config.headers,
                url = buildUrl(config.url, config.paramSerializer(config.params));
            $http.pendingRequests.push(config);
            promise.then(removePendingReq, removePendingReq);
            if ((config.cache || defaults.cache) && config.cache !== false && (config.method === 'GET' || config.method === 'JSONP')) {
              cache = isObject(config.cache) ? config.cache : isObject(defaults.cache) ? defaults.cache : defaultCache;
            }
            if (cache) {
              cachedResp = cache.get(url);
              if (isDefined(cachedResp)) {
                if (isPromiseLike(cachedResp)) {
                  cachedResp.then(resolvePromiseWithResult, resolvePromiseWithResult);
                } else {
                  if (isArray(cachedResp)) {
                    resolvePromise(cachedResp[1], cachedResp[0], shallowCopy(cachedResp[2]), cachedResp[3]);
                  } else {
                    resolvePromise(cachedResp, 200, {}, 'OK');
                  }
                }
              } else {
                cache.put(url, promise);
              }
            }
            if (isUndefined(cachedResp)) {
              var xsrfValue = urlIsSameOrigin(config.url) ? $$cookieReader()[config.xsrfCookieName || defaults.xsrfCookieName] : undefined;
              if (xsrfValue) {
                reqHeaders[(config.xsrfHeaderName || defaults.xsrfHeaderName)] = xsrfValue;
              }
              $httpBackend(config.method, url, reqData, done, reqHeaders, config.timeout, config.withCredentials, config.responseType);
            }
            return promise;
            function done(status, response, headersString, statusText) {
              if (cache) {
                if (isSuccess(status)) {
                  cache.put(url, [status, response, parseHeaders(headersString), statusText]);
                } else {
                  cache.remove(url);
                }
              }
              function resolveHttpPromise() {
                resolvePromise(response, status, headersString, statusText);
              }
              if (useApplyAsync) {
                $rootScope.$applyAsync(resolveHttpPromise);
              } else {
                resolveHttpPromise();
                if (!$rootScope.$$phase)
                  $rootScope.$apply();
              }
            }
            function resolvePromise(response, status, headers, statusText) {
              status = status >= -1 ? status : 0;
              (isSuccess(status) ? deferred.resolve : deferred.reject)({
                data: response,
                status: status,
                headers: headersGetter(headers),
                config: config,
                statusText: statusText
              });
            }
            function resolvePromiseWithResult(result) {
              resolvePromise(result.data, result.status, shallowCopy(result.headers()), result.statusText);
            }
            function removePendingReq() {
              var idx = $http.pendingRequests.indexOf(config);
              if (idx !== -1)
                $http.pendingRequests.splice(idx, 1);
            }
          }
          function buildUrl(url, serializedParams) {
            if (serializedParams.length > 0) {
              url += ((url.indexOf('?') == -1) ? '?' : '&') + serializedParams;
            }
            return url;
          }
        }];
      }
      function createXhr() {
        return new window.XMLHttpRequest();
      }
      function $HttpBackendProvider() {
        this.$get = ['$browser', '$window', '$document', function($browser, $window, $document) {
          return createHttpBackend($browser, createXhr, $browser.defer, $window.angular.callbacks, $document[0]);
        }];
      }
      function createHttpBackend($browser, createXhr, $browserDefer, callbacks, rawDocument) {
        return function(method, url, post, callback, headers, timeout, withCredentials, responseType) {
          $browser.$$incOutstandingRequestCount();
          url = url || $browser.url();
          if (lowercase(method) == 'jsonp') {
            var callbackId = '_' + (callbacks.counter++).toString(36);
            callbacks[callbackId] = function(data) {
              callbacks[callbackId].data = data;
              callbacks[callbackId].called = true;
            };
            var jsonpDone = jsonpReq(url.replace('JSON_CALLBACK', 'angular.callbacks.' + callbackId), callbackId, function(status, text) {
              completeRequest(callback, status, callbacks[callbackId].data, "", text);
              callbacks[callbackId] = noop;
            });
          } else {
            var xhr = createXhr();
            xhr.open(method, url, true);
            forEach(headers, function(value, key) {
              if (isDefined(value)) {
                xhr.setRequestHeader(key, value);
              }
            });
            xhr.onload = function requestLoaded() {
              var statusText = xhr.statusText || '';
              var response = ('response' in xhr) ? xhr.response : xhr.responseText;
              var status = xhr.status === 1223 ? 204 : xhr.status;
              if (status === 0) {
                status = response ? 200 : urlResolve(url).protocol == 'file' ? 404 : 0;
              }
              completeRequest(callback, status, response, xhr.getAllResponseHeaders(), statusText);
            };
            var requestError = function() {
              completeRequest(callback, -1, null, null, '');
            };
            xhr.onerror = requestError;
            xhr.onabort = requestError;
            if (withCredentials) {
              xhr.withCredentials = true;
            }
            if (responseType) {
              try {
                xhr.responseType = responseType;
              } catch (e) {
                if (responseType !== 'json') {
                  throw e;
                }
              }
            }
            xhr.send(isUndefined(post) ? null : post);
          }
          if (timeout > 0) {
            var timeoutId = $browserDefer(timeoutRequest, timeout);
          } else if (isPromiseLike(timeout)) {
            timeout.then(timeoutRequest);
          }
          function timeoutRequest() {
            jsonpDone && jsonpDone();
            xhr && xhr.abort();
          }
          function completeRequest(callback, status, response, headersString, statusText) {
            if (isDefined(timeoutId)) {
              $browserDefer.cancel(timeoutId);
            }
            jsonpDone = xhr = null;
            callback(status, response, headersString, statusText);
            $browser.$$completeOutstandingRequest(noop);
          }
        };
        function jsonpReq(url, callbackId, done) {
          var script = rawDocument.createElement('script'),
              callback = null;
          script.type = "text/javascript";
          script.src = url;
          script.async = true;
          callback = function(event) {
            removeEventListenerFn(script, "load", callback);
            removeEventListenerFn(script, "error", callback);
            rawDocument.body.removeChild(script);
            script = null;
            var status = -1;
            var text = "unknown";
            if (event) {
              if (event.type === "load" && !callbacks[callbackId].called) {
                event = {type: "error"};
              }
              text = event.type;
              status = event.type === "error" ? 404 : 200;
            }
            if (done) {
              done(status, text);
            }
          };
          addEventListenerFn(script, "load", callback);
          addEventListenerFn(script, "error", callback);
          rawDocument.body.appendChild(script);
          return callback;
        }
      }
      var $interpolateMinErr = angular.$interpolateMinErr = minErr('$interpolate');
      $interpolateMinErr.throwNoconcat = function(text) {
        throw $interpolateMinErr('noconcat', "Error while interpolating: {0}\nStrict Contextual Escaping disallows " + "interpolations that concatenate multiple expressions when a trusted value is " + "required.  See http://docs.angularjs.org/api/ng.$sce", text);
      };
      $interpolateMinErr.interr = function(text, err) {
        return $interpolateMinErr('interr', "Can't interpolate: {0}\n{1}", text, err.toString());
      };
      function $InterpolateProvider() {
        var startSymbol = '{{';
        var endSymbol = '}}';
        this.startSymbol = function(value) {
          if (value) {
            startSymbol = value;
            return this;
          } else {
            return startSymbol;
          }
        };
        this.endSymbol = function(value) {
          if (value) {
            endSymbol = value;
            return this;
          } else {
            return endSymbol;
          }
        };
        this.$get = ['$parse', '$exceptionHandler', '$sce', function($parse, $exceptionHandler, $sce) {
          var startSymbolLength = startSymbol.length,
              endSymbolLength = endSymbol.length,
              escapedStartRegexp = new RegExp(startSymbol.replace(/./g, escape), 'g'),
              escapedEndRegexp = new RegExp(endSymbol.replace(/./g, escape), 'g');
          function escape(ch) {
            return '\\\\\\' + ch;
          }
          function unescapeText(text) {
            return text.replace(escapedStartRegexp, startSymbol).replace(escapedEndRegexp, endSymbol);
          }
          function stringify(value) {
            if (value == null) {
              return '';
            }
            switch (typeof value) {
              case 'string':
                break;
              case 'number':
                value = '' + value;
                break;
              default:
                value = toJson(value);
            }
            return value;
          }
          function $interpolate(text, mustHaveExpression, trustedContext, allOrNothing) {
            allOrNothing = !!allOrNothing;
            var startIndex,
                endIndex,
                index = 0,
                expressions = [],
                parseFns = [],
                textLength = text.length,
                exp,
                concat = [],
                expressionPositions = [];
            while (index < textLength) {
              if (((startIndex = text.indexOf(startSymbol, index)) != -1) && ((endIndex = text.indexOf(endSymbol, startIndex + startSymbolLength)) != -1)) {
                if (index !== startIndex) {
                  concat.push(unescapeText(text.substring(index, startIndex)));
                }
                exp = text.substring(startIndex + startSymbolLength, endIndex);
                expressions.push(exp);
                parseFns.push($parse(exp, parseStringifyInterceptor));
                index = endIndex + endSymbolLength;
                expressionPositions.push(concat.length);
                concat.push('');
              } else {
                if (index !== textLength) {
                  concat.push(unescapeText(text.substring(index)));
                }
                break;
              }
            }
            if (trustedContext && concat.length > 1) {
              $interpolateMinErr.throwNoconcat(text);
            }
            if (!mustHaveExpression || expressions.length) {
              var compute = function(values) {
                for (var i = 0,
                    ii = expressions.length; i < ii; i++) {
                  if (allOrNothing && isUndefined(values[i]))
                    return;
                  concat[expressionPositions[i]] = values[i];
                }
                return concat.join('');
              };
              var getValue = function(value) {
                return trustedContext ? $sce.getTrusted(trustedContext, value) : $sce.valueOf(value);
              };
              return extend(function interpolationFn(context) {
                var i = 0;
                var ii = expressions.length;
                var values = new Array(ii);
                try {
                  for (; i < ii; i++) {
                    values[i] = parseFns[i](context);
                  }
                  return compute(values);
                } catch (err) {
                  $exceptionHandler($interpolateMinErr.interr(text, err));
                }
              }, {
                exp: text,
                expressions: expressions,
                $$watchDelegate: function(scope, listener) {
                  var lastValue;
                  return scope.$watchGroup(parseFns, function interpolateFnWatcher(values, oldValues) {
                    var currValue = compute(values);
                    if (isFunction(listener)) {
                      listener.call(this, currValue, values !== oldValues ? lastValue : currValue, scope);
                    }
                    lastValue = currValue;
                  });
                }
              });
            }
            function parseStringifyInterceptor(value) {
              try {
                value = getValue(value);
                return allOrNothing && !isDefined(value) ? value : stringify(value);
              } catch (err) {
                $exceptionHandler($interpolateMinErr.interr(text, err));
              }
            }
          }
          $interpolate.startSymbol = function() {
            return startSymbol;
          };
          $interpolate.endSymbol = function() {
            return endSymbol;
          };
          return $interpolate;
        }];
      }
      function $IntervalProvider() {
        this.$get = ['$rootScope', '$window', '$q', '$$q', function($rootScope, $window, $q, $$q) {
          var intervals = {};
          function interval(fn, delay, count, invokeApply) {
            var hasParams = arguments.length > 4,
                args = hasParams ? sliceArgs(arguments, 4) : [],
                setInterval = $window.setInterval,
                clearInterval = $window.clearInterval,
                iteration = 0,
                skipApply = (isDefined(invokeApply) && !invokeApply),
                deferred = (skipApply ? $$q : $q).defer(),
                promise = deferred.promise;
            count = isDefined(count) ? count : 0;
            promise.then(null, null, (!hasParams) ? fn : function() {
              fn.apply(null, args);
            });
            promise.$$intervalId = setInterval(function tick() {
              deferred.notify(iteration++);
              if (count > 0 && iteration >= count) {
                deferred.resolve(iteration);
                clearInterval(promise.$$intervalId);
                delete intervals[promise.$$intervalId];
              }
              if (!skipApply)
                $rootScope.$apply();
            }, delay);
            intervals[promise.$$intervalId] = deferred;
            return promise;
          }
          interval.cancel = function(promise) {
            if (promise && promise.$$intervalId in intervals) {
              intervals[promise.$$intervalId].reject('canceled');
              $window.clearInterval(promise.$$intervalId);
              delete intervals[promise.$$intervalId];
              return true;
            }
            return false;
          };
          return interval;
        }];
      }
      var PATH_MATCH = /^([^\?#]*)(\?([^#]*))?(#(.*))?$/,
          DEFAULT_PORTS = {
            'http': 80,
            'https': 443,
            'ftp': 21
          };
      var $locationMinErr = minErr('$location');
      function encodePath(path) {
        var segments = path.split('/'),
            i = segments.length;
        while (i--) {
          segments[i] = encodeUriSegment(segments[i]);
        }
        return segments.join('/');
      }
      function parseAbsoluteUrl(absoluteUrl, locationObj) {
        var parsedUrl = urlResolve(absoluteUrl);
        locationObj.$$protocol = parsedUrl.protocol;
        locationObj.$$host = parsedUrl.hostname;
        locationObj.$$port = toInt(parsedUrl.port) || DEFAULT_PORTS[parsedUrl.protocol] || null;
      }
      function parseAppUrl(relativeUrl, locationObj) {
        var prefixed = (relativeUrl.charAt(0) !== '/');
        if (prefixed) {
          relativeUrl = '/' + relativeUrl;
        }
        var match = urlResolve(relativeUrl);
        locationObj.$$path = decodeURIComponent(prefixed && match.pathname.charAt(0) === '/' ? match.pathname.substring(1) : match.pathname);
        locationObj.$$search = parseKeyValue(match.search);
        locationObj.$$hash = decodeURIComponent(match.hash);
        if (locationObj.$$path && locationObj.$$path.charAt(0) != '/') {
          locationObj.$$path = '/' + locationObj.$$path;
        }
      }
      function beginsWith(begin, whole) {
        if (whole.indexOf(begin) === 0) {
          return whole.substr(begin.length);
        }
      }
      function stripHash(url) {
        var index = url.indexOf('#');
        return index == -1 ? url : url.substr(0, index);
      }
      function trimEmptyHash(url) {
        return url.replace(/(#.+)|#$/, '$1');
      }
      function stripFile(url) {
        return url.substr(0, stripHash(url).lastIndexOf('/') + 1);
      }
      function serverBase(url) {
        return url.substring(0, url.indexOf('/', url.indexOf('//') + 2));
      }
      function LocationHtml5Url(appBase, appBaseNoFile, basePrefix) {
        this.$$html5 = true;
        basePrefix = basePrefix || '';
        parseAbsoluteUrl(appBase, this);
        this.$$parse = function(url) {
          var pathUrl = beginsWith(appBaseNoFile, url);
          if (!isString(pathUrl)) {
            throw $locationMinErr('ipthprfx', 'Invalid url "{0}", missing path prefix "{1}".', url, appBaseNoFile);
          }
          parseAppUrl(pathUrl, this);
          if (!this.$$path) {
            this.$$path = '/';
          }
          this.$$compose();
        };
        this.$$compose = function() {
          var search = toKeyValue(this.$$search),
              hash = this.$$hash ? '#' + encodeUriSegment(this.$$hash) : '';
          this.$$url = encodePath(this.$$path) + (search ? '?' + search : '') + hash;
          this.$$absUrl = appBaseNoFile + this.$$url.substr(1);
        };
        this.$$parseLinkUrl = function(url, relHref) {
          if (relHref && relHref[0] === '#') {
            this.hash(relHref.slice(1));
            return true;
          }
          var appUrl,
              prevAppUrl;
          var rewrittenUrl;
          if (isDefined(appUrl = beginsWith(appBase, url))) {
            prevAppUrl = appUrl;
            if (isDefined(appUrl = beginsWith(basePrefix, appUrl))) {
              rewrittenUrl = appBaseNoFile + (beginsWith('/', appUrl) || appUrl);
            } else {
              rewrittenUrl = appBase + prevAppUrl;
            }
          } else if (isDefined(appUrl = beginsWith(appBaseNoFile, url))) {
            rewrittenUrl = appBaseNoFile + appUrl;
          } else if (appBaseNoFile == url + '/') {
            rewrittenUrl = appBaseNoFile;
          }
          if (rewrittenUrl) {
            this.$$parse(rewrittenUrl);
          }
          return !!rewrittenUrl;
        };
      }
      function LocationHashbangUrl(appBase, appBaseNoFile, hashPrefix) {
        parseAbsoluteUrl(appBase, this);
        this.$$parse = function(url) {
          var withoutBaseUrl = beginsWith(appBase, url) || beginsWith(appBaseNoFile, url);
          var withoutHashUrl;
          if (!isUndefined(withoutBaseUrl) && withoutBaseUrl.charAt(0) === '#') {
            withoutHashUrl = beginsWith(hashPrefix, withoutBaseUrl);
            if (isUndefined(withoutHashUrl)) {
              withoutHashUrl = withoutBaseUrl;
            }
          } else {
            if (this.$$html5) {
              withoutHashUrl = withoutBaseUrl;
            } else {
              withoutHashUrl = '';
              if (isUndefined(withoutBaseUrl)) {
                appBase = url;
                this.replace();
              }
            }
          }
          parseAppUrl(withoutHashUrl, this);
          this.$$path = removeWindowsDriveName(this.$$path, withoutHashUrl, appBase);
          this.$$compose();
          function removeWindowsDriveName(path, url, base) {
            var windowsFilePathExp = /^\/[A-Z]:(\/.*)/;
            var firstPathSegmentMatch;
            if (url.indexOf(base) === 0) {
              url = url.replace(base, '');
            }
            if (windowsFilePathExp.exec(url)) {
              return path;
            }
            firstPathSegmentMatch = windowsFilePathExp.exec(path);
            return firstPathSegmentMatch ? firstPathSegmentMatch[1] : path;
          }
        };
        this.$$compose = function() {
          var search = toKeyValue(this.$$search),
              hash = this.$$hash ? '#' + encodeUriSegment(this.$$hash) : '';
          this.$$url = encodePath(this.$$path) + (search ? '?' + search : '') + hash;
          this.$$absUrl = appBase + (this.$$url ? hashPrefix + this.$$url : '');
        };
        this.$$parseLinkUrl = function(url, relHref) {
          if (stripHash(appBase) == stripHash(url)) {
            this.$$parse(url);
            return true;
          }
          return false;
        };
      }
      function LocationHashbangInHtml5Url(appBase, appBaseNoFile, hashPrefix) {
        this.$$html5 = true;
        LocationHashbangUrl.apply(this, arguments);
        this.$$parseLinkUrl = function(url, relHref) {
          if (relHref && relHref[0] === '#') {
            this.hash(relHref.slice(1));
            return true;
          }
          var rewrittenUrl;
          var appUrl;
          if (appBase == stripHash(url)) {
            rewrittenUrl = url;
          } else if ((appUrl = beginsWith(appBaseNoFile, url))) {
            rewrittenUrl = appBase + hashPrefix + appUrl;
          } else if (appBaseNoFile === url + '/') {
            rewrittenUrl = appBaseNoFile;
          }
          if (rewrittenUrl) {
            this.$$parse(rewrittenUrl);
          }
          return !!rewrittenUrl;
        };
        this.$$compose = function() {
          var search = toKeyValue(this.$$search),
              hash = this.$$hash ? '#' + encodeUriSegment(this.$$hash) : '';
          this.$$url = encodePath(this.$$path) + (search ? '?' + search : '') + hash;
          this.$$absUrl = appBase + hashPrefix + this.$$url;
        };
      }
      var locationPrototype = {
        $$html5: false,
        $$replace: false,
        absUrl: locationGetter('$$absUrl'),
        url: function(url) {
          if (isUndefined(url)) {
            return this.$$url;
          }
          var match = PATH_MATCH.exec(url);
          if (match[1] || url === '')
            this.path(decodeURIComponent(match[1]));
          if (match[2] || match[1] || url === '')
            this.search(match[3] || '');
          this.hash(match[5] || '');
          return this;
        },
        protocol: locationGetter('$$protocol'),
        host: locationGetter('$$host'),
        port: locationGetter('$$port'),
        path: locationGetterSetter('$$path', function(path) {
          path = path !== null ? path.toString() : '';
          return path.charAt(0) == '/' ? path : '/' + path;
        }),
        search: function(search, paramValue) {
          switch (arguments.length) {
            case 0:
              return this.$$search;
            case 1:
              if (isString(search) || isNumber(search)) {
                search = search.toString();
                this.$$search = parseKeyValue(search);
              } else if (isObject(search)) {
                search = copy(search, {});
                forEach(search, function(value, key) {
                  if (value == null)
                    delete search[key];
                });
                this.$$search = search;
              } else {
                throw $locationMinErr('isrcharg', 'The first argument of the `$location#search()` call must be a string or an object.');
              }
              break;
            default:
              if (isUndefined(paramValue) || paramValue === null) {
                delete this.$$search[search];
              } else {
                this.$$search[search] = paramValue;
              }
          }
          this.$$compose();
          return this;
        },
        hash: locationGetterSetter('$$hash', function(hash) {
          return hash !== null ? hash.toString() : '';
        }),
        replace: function() {
          this.$$replace = true;
          return this;
        }
      };
      forEach([LocationHashbangInHtml5Url, LocationHashbangUrl, LocationHtml5Url], function(Location) {
        Location.prototype = Object.create(locationPrototype);
        Location.prototype.state = function(state) {
          if (!arguments.length) {
            return this.$$state;
          }
          if (Location !== LocationHtml5Url || !this.$$html5) {
            throw $locationMinErr('nostate', 'History API state support is available only ' + 'in HTML5 mode and only in browsers supporting HTML5 History API');
          }
          this.$$state = isUndefined(state) ? null : state;
          return this;
        };
      });
      function locationGetter(property) {
        return function() {
          return this[property];
        };
      }
      function locationGetterSetter(property, preprocess) {
        return function(value) {
          if (isUndefined(value)) {
            return this[property];
          }
          this[property] = preprocess(value);
          this.$$compose();
          return this;
        };
      }
      function $LocationProvider() {
        var hashPrefix = '',
            html5Mode = {
              enabled: false,
              requireBase: true,
              rewriteLinks: true
            };
        this.hashPrefix = function(prefix) {
          if (isDefined(prefix)) {
            hashPrefix = prefix;
            return this;
          } else {
            return hashPrefix;
          }
        };
        this.html5Mode = function(mode) {
          if (isBoolean(mode)) {
            html5Mode.enabled = mode;
            return this;
          } else if (isObject(mode)) {
            if (isBoolean(mode.enabled)) {
              html5Mode.enabled = mode.enabled;
            }
            if (isBoolean(mode.requireBase)) {
              html5Mode.requireBase = mode.requireBase;
            }
            if (isBoolean(mode.rewriteLinks)) {
              html5Mode.rewriteLinks = mode.rewriteLinks;
            }
            return this;
          } else {
            return html5Mode;
          }
        };
        this.$get = ['$rootScope', '$browser', '$sniffer', '$rootElement', '$window', function($rootScope, $browser, $sniffer, $rootElement, $window) {
          var $location,
              LocationMode,
              baseHref = $browser.baseHref(),
              initialUrl = $browser.url(),
              appBase;
          if (html5Mode.enabled) {
            if (!baseHref && html5Mode.requireBase) {
              throw $locationMinErr('nobase', "$location in HTML5 mode requires a <base> tag to be present!");
            }
            appBase = serverBase(initialUrl) + (baseHref || '/');
            LocationMode = $sniffer.history ? LocationHtml5Url : LocationHashbangInHtml5Url;
          } else {
            appBase = stripHash(initialUrl);
            LocationMode = LocationHashbangUrl;
          }
          var appBaseNoFile = stripFile(appBase);
          $location = new LocationMode(appBase, appBaseNoFile, '#' + hashPrefix);
          $location.$$parseLinkUrl(initialUrl, initialUrl);
          $location.$$state = $browser.state();
          var IGNORE_URI_REGEXP = /^\s*(javascript|mailto):/i;
          function setBrowserUrlWithFallback(url, replace, state) {
            var oldUrl = $location.url();
            var oldState = $location.$$state;
            try {
              $browser.url(url, replace, state);
              $location.$$state = $browser.state();
            } catch (e) {
              $location.url(oldUrl);
              $location.$$state = oldState;
              throw e;
            }
          }
          $rootElement.on('click', function(event) {
            if (!html5Mode.rewriteLinks || event.ctrlKey || event.metaKey || event.shiftKey || event.which == 2 || event.button == 2)
              return;
            var elm = jqLite(event.target);
            while (nodeName_(elm[0]) !== 'a') {
              if (elm[0] === $rootElement[0] || !(elm = elm.parent())[0])
                return;
            }
            var absHref = elm.prop('href');
            var relHref = elm.attr('href') || elm.attr('xlink:href');
            if (isObject(absHref) && absHref.toString() === '[object SVGAnimatedString]') {
              absHref = urlResolve(absHref.animVal).href;
            }
            if (IGNORE_URI_REGEXP.test(absHref))
              return;
            if (absHref && !elm.attr('target') && !event.isDefaultPrevented()) {
              if ($location.$$parseLinkUrl(absHref, relHref)) {
                event.preventDefault();
                if ($location.absUrl() != $browser.url()) {
                  $rootScope.$apply();
                  $window.angular['ff-684208-preventDefault'] = true;
                }
              }
            }
          });
          if (trimEmptyHash($location.absUrl()) != trimEmptyHash(initialUrl)) {
            $browser.url($location.absUrl(), true);
          }
          var initializing = true;
          $browser.onUrlChange(function(newUrl, newState) {
            if (isUndefined(beginsWith(appBaseNoFile, newUrl))) {
              $window.location.href = newUrl;
              return;
            }
            $rootScope.$evalAsync(function() {
              var oldUrl = $location.absUrl();
              var oldState = $location.$$state;
              var defaultPrevented;
              $location.$$parse(newUrl);
              $location.$$state = newState;
              defaultPrevented = $rootScope.$broadcast('$locationChangeStart', newUrl, oldUrl, newState, oldState).defaultPrevented;
              if ($location.absUrl() !== newUrl)
                return;
              if (defaultPrevented) {
                $location.$$parse(oldUrl);
                $location.$$state = oldState;
                setBrowserUrlWithFallback(oldUrl, false, oldState);
              } else {
                initializing = false;
                afterLocationChange(oldUrl, oldState);
              }
            });
            if (!$rootScope.$$phase)
              $rootScope.$digest();
          });
          $rootScope.$watch(function $locationWatch() {
            var oldUrl = trimEmptyHash($browser.url());
            var newUrl = trimEmptyHash($location.absUrl());
            var oldState = $browser.state();
            var currentReplace = $location.$$replace;
            var urlOrStateChanged = oldUrl !== newUrl || ($location.$$html5 && $sniffer.history && oldState !== $location.$$state);
            if (initializing || urlOrStateChanged) {
              initializing = false;
              $rootScope.$evalAsync(function() {
                var newUrl = $location.absUrl();
                var defaultPrevented = $rootScope.$broadcast('$locationChangeStart', newUrl, oldUrl, $location.$$state, oldState).defaultPrevented;
                if ($location.absUrl() !== newUrl)
                  return;
                if (defaultPrevented) {
                  $location.$$parse(oldUrl);
                  $location.$$state = oldState;
                } else {
                  if (urlOrStateChanged) {
                    setBrowserUrlWithFallback(newUrl, currentReplace, oldState === $location.$$state ? null : $location.$$state);
                  }
                  afterLocationChange(oldUrl, oldState);
                }
              });
            }
            $location.$$replace = false;
          });
          return $location;
          function afterLocationChange(oldUrl, oldState) {
            $rootScope.$broadcast('$locationChangeSuccess', $location.absUrl(), oldUrl, $location.$$state, oldState);
          }
        }];
      }
      function $LogProvider() {
        var debug = true,
            self = this;
        this.debugEnabled = function(flag) {
          if (isDefined(flag)) {
            debug = flag;
            return this;
          } else {
            return debug;
          }
        };
        this.$get = ['$window', function($window) {
          return {
            log: consoleLog('log'),
            info: consoleLog('info'),
            warn: consoleLog('warn'),
            error: consoleLog('error'),
            debug: (function() {
              var fn = consoleLog('debug');
              return function() {
                if (debug) {
                  fn.apply(self, arguments);
                }
              };
            }())
          };
          function formatError(arg) {
            if (arg instanceof Error) {
              if (arg.stack) {
                arg = (arg.message && arg.stack.indexOf(arg.message) === -1) ? 'Error: ' + arg.message + '\n' + arg.stack : arg.stack;
              } else if (arg.sourceURL) {
                arg = arg.message + '\n' + arg.sourceURL + ':' + arg.line;
              }
            }
            return arg;
          }
          function consoleLog(type) {
            var console = $window.console || {},
                logFn = console[type] || console.log || noop,
                hasApply = false;
            try {
              hasApply = !!logFn.apply;
            } catch (e) {}
            if (hasApply) {
              return function() {
                var args = [];
                forEach(arguments, function(arg) {
                  args.push(formatError(arg));
                });
                return logFn.apply(console, args);
              };
            }
            return function(arg1, arg2) {
              logFn(arg1, arg2 == null ? '' : arg2);
            };
          }
        }];
      }
      var $parseMinErr = minErr('$parse');
      function ensureSafeMemberName(name, fullExpression) {
        name = (isObject(name) && name.toString) ? name.toString() : name;
        if (name === "__defineGetter__" || name === "__defineSetter__" || name === "__lookupGetter__" || name === "__lookupSetter__" || name === "__proto__") {
          throw $parseMinErr('isecfld', 'Attempting to access a disallowed field in Angular expressions! ' + 'Expression: {0}', fullExpression);
        }
        return name;
      }
      function ensureSafeObject(obj, fullExpression) {
        if (obj) {
          if (obj.constructor === obj) {
            throw $parseMinErr('isecfn', 'Referencing Function in Angular expressions is disallowed! Expression: {0}', fullExpression);
          } else if (obj.window === obj) {
            throw $parseMinErr('isecwindow', 'Referencing the Window in Angular expressions is disallowed! Expression: {0}', fullExpression);
          } else if (obj.children && (obj.nodeName || (obj.prop && obj.attr && obj.find))) {
            throw $parseMinErr('isecdom', 'Referencing DOM nodes in Angular expressions is disallowed! Expression: {0}', fullExpression);
          } else if (obj === Object) {
            throw $parseMinErr('isecobj', 'Referencing Object in Angular expressions is disallowed! Expression: {0}', fullExpression);
          }
        }
        return obj;
      }
      var CALL = Function.prototype.call;
      var APPLY = Function.prototype.apply;
      var BIND = Function.prototype.bind;
      function ensureSafeFunction(obj, fullExpression) {
        if (obj) {
          if (obj.constructor === obj) {
            throw $parseMinErr('isecfn', 'Referencing Function in Angular expressions is disallowed! Expression: {0}', fullExpression);
          } else if (obj === CALL || obj === APPLY || obj === BIND) {
            throw $parseMinErr('isecff', 'Referencing call, apply or bind in Angular expressions is disallowed! Expression: {0}', fullExpression);
          }
        }
      }
      var OPERATORS = createMap();
      forEach('+ - * / % === !== == != < > <= >= && || ! = |'.split(' '), function(operator) {
        OPERATORS[operator] = true;
      });
      var ESCAPE = {
        "n": "\n",
        "f": "\f",
        "r": "\r",
        "t": "\t",
        "v": "\v",
        "'": "'",
        '"': '"'
      };
      var Lexer = function(options) {
        this.options = options;
      };
      Lexer.prototype = {
        constructor: Lexer,
        lex: function(text) {
          this.text = text;
          this.index = 0;
          this.tokens = [];
          while (this.index < this.text.length) {
            var ch = this.text.charAt(this.index);
            if (ch === '"' || ch === "'") {
              this.readString(ch);
            } else if (this.isNumber(ch) || ch === '.' && this.isNumber(this.peek())) {
              this.readNumber();
            } else if (this.isIdent(ch)) {
              this.readIdent();
            } else if (this.is(ch, '(){}[].,;:?')) {
              this.tokens.push({
                index: this.index,
                text: ch
              });
              this.index++;
            } else if (this.isWhitespace(ch)) {
              this.index++;
            } else {
              var ch2 = ch + this.peek();
              var ch3 = ch2 + this.peek(2);
              var op1 = OPERATORS[ch];
              var op2 = OPERATORS[ch2];
              var op3 = OPERATORS[ch3];
              if (op1 || op2 || op3) {
                var token = op3 ? ch3 : (op2 ? ch2 : ch);
                this.tokens.push({
                  index: this.index,
                  text: token,
                  operator: true
                });
                this.index += token.length;
              } else {
                this.throwError('Unexpected next character ', this.index, this.index + 1);
              }
            }
          }
          return this.tokens;
        },
        is: function(ch, chars) {
          return chars.indexOf(ch) !== -1;
        },
        peek: function(i) {
          var num = i || 1;
          return (this.index + num < this.text.length) ? this.text.charAt(this.index + num) : false;
        },
        isNumber: function(ch) {
          return ('0' <= ch && ch <= '9') && typeof ch === "string";
        },
        isWhitespace: function(ch) {
          return (ch === ' ' || ch === '\r' || ch === '\t' || ch === '\n' || ch === '\v' || ch === '\u00A0');
        },
        isIdent: function(ch) {
          return ('a' <= ch && ch <= 'z' || 'A' <= ch && ch <= 'Z' || '_' === ch || ch === '$');
        },
        isExpOperator: function(ch) {
          return (ch === '-' || ch === '+' || this.isNumber(ch));
        },
        throwError: function(error, start, end) {
          end = end || this.index;
          var colStr = (isDefined(start) ? 's ' + start + '-' + this.index + ' [' + this.text.substring(start, end) + ']' : ' ' + end);
          throw $parseMinErr('lexerr', 'Lexer Error: {0} at column{1} in expression [{2}].', error, colStr, this.text);
        },
        readNumber: function() {
          var number = '';
          var start = this.index;
          while (this.index < this.text.length) {
            var ch = lowercase(this.text.charAt(this.index));
            if (ch == '.' || this.isNumber(ch)) {
              number += ch;
            } else {
              var peekCh = this.peek();
              if (ch == 'e' && this.isExpOperator(peekCh)) {
                number += ch;
              } else if (this.isExpOperator(ch) && peekCh && this.isNumber(peekCh) && number.charAt(number.length - 1) == 'e') {
                number += ch;
              } else if (this.isExpOperator(ch) && (!peekCh || !this.isNumber(peekCh)) && number.charAt(number.length - 1) == 'e') {
                this.throwError('Invalid exponent');
              } else {
                break;
              }
            }
            this.index++;
          }
          this.tokens.push({
            index: start,
            text: number,
            constant: true,
            value: Number(number)
          });
        },
        readIdent: function() {
          var start = this.index;
          while (this.index < this.text.length) {
            var ch = this.text.charAt(this.index);
            if (!(this.isIdent(ch) || this.isNumber(ch))) {
              break;
            }
            this.index++;
          }
          this.tokens.push({
            index: start,
            text: this.text.slice(start, this.index),
            identifier: true
          });
        },
        readString: function(quote) {
          var start = this.index;
          this.index++;
          var string = '';
          var rawString = quote;
          var escape = false;
          while (this.index < this.text.length) {
            var ch = this.text.charAt(this.index);
            rawString += ch;
            if (escape) {
              if (ch === 'u') {
                var hex = this.text.substring(this.index + 1, this.index + 5);
                if (!hex.match(/[\da-f]{4}/i)) {
                  this.throwError('Invalid unicode escape [\\u' + hex + ']');
                }
                this.index += 4;
                string += String.fromCharCode(parseInt(hex, 16));
              } else {
                var rep = ESCAPE[ch];
                string = string + (rep || ch);
              }
              escape = false;
            } else if (ch === '\\') {
              escape = true;
            } else if (ch === quote) {
              this.index++;
              this.tokens.push({
                index: start,
                text: rawString,
                constant: true,
                value: string
              });
              return;
            } else {
              string += ch;
            }
            this.index++;
          }
          this.throwError('Unterminated quote', start);
        }
      };
      var AST = function(lexer, options) {
        this.lexer = lexer;
        this.options = options;
      };
      AST.Program = 'Program';
      AST.ExpressionStatement = 'ExpressionStatement';
      AST.AssignmentExpression = 'AssignmentExpression';
      AST.ConditionalExpression = 'ConditionalExpression';
      AST.LogicalExpression = 'LogicalExpression';
      AST.BinaryExpression = 'BinaryExpression';
      AST.UnaryExpression = 'UnaryExpression';
      AST.CallExpression = 'CallExpression';
      AST.MemberExpression = 'MemberExpression';
      AST.Identifier = 'Identifier';
      AST.Literal = 'Literal';
      AST.ArrayExpression = 'ArrayExpression';
      AST.Property = 'Property';
      AST.ObjectExpression = 'ObjectExpression';
      AST.ThisExpression = 'ThisExpression';
      AST.NGValueParameter = 'NGValueParameter';
      AST.prototype = {
        ast: function(text) {
          this.text = text;
          this.tokens = this.lexer.lex(text);
          var value = this.program();
          if (this.tokens.length !== 0) {
            this.throwError('is an unexpected token', this.tokens[0]);
          }
          return value;
        },
        program: function() {
          var body = [];
          while (true) {
            if (this.tokens.length > 0 && !this.peek('}', ')', ';', ']'))
              body.push(this.expressionStatement());
            if (!this.expect(';')) {
              return {
                type: AST.Program,
                body: body
              };
            }
          }
        },
        expressionStatement: function() {
          return {
            type: AST.ExpressionStatement,
            expression: this.filterChain()
          };
        },
        filterChain: function() {
          var left = this.expression();
          var token;
          while ((token = this.expect('|'))) {
            left = this.filter(left);
          }
          return left;
        },
        expression: function() {
          return this.assignment();
        },
        assignment: function() {
          var result = this.ternary();
          if (this.expect('=')) {
            result = {
              type: AST.AssignmentExpression,
              left: result,
              right: this.assignment(),
              operator: '='
            };
          }
          return result;
        },
        ternary: function() {
          var test = this.logicalOR();
          var alternate;
          var consequent;
          if (this.expect('?')) {
            alternate = this.expression();
            if (this.consume(':')) {
              consequent = this.expression();
              return {
                type: AST.ConditionalExpression,
                test: test,
                alternate: alternate,
                consequent: consequent
              };
            }
          }
          return test;
        },
        logicalOR: function() {
          var left = this.logicalAND();
          while (this.expect('||')) {
            left = {
              type: AST.LogicalExpression,
              operator: '||',
              left: left,
              right: this.logicalAND()
            };
          }
          return left;
        },
        logicalAND: function() {
          var left = this.equality();
          while (this.expect('&&')) {
            left = {
              type: AST.LogicalExpression,
              operator: '&&',
              left: left,
              right: this.equality()
            };
          }
          return left;
        },
        equality: function() {
          var left = this.relational();
          var token;
          while ((token = this.expect('==', '!=', '===', '!=='))) {
            left = {
              type: AST.BinaryExpression,
              operator: token.text,
              left: left,
              right: this.relational()
            };
          }
          return left;
        },
        relational: function() {
          var left = this.additive();
          var token;
          while ((token = this.expect('<', '>', '<=', '>='))) {
            left = {
              type: AST.BinaryExpression,
              operator: token.text,
              left: left,
              right: this.additive()
            };
          }
          return left;
        },
        additive: function() {
          var left = this.multiplicative();
          var token;
          while ((token = this.expect('+', '-'))) {
            left = {
              type: AST.BinaryExpression,
              operator: token.text,
              left: left,
              right: this.multiplicative()
            };
          }
          return left;
        },
        multiplicative: function() {
          var left = this.unary();
          var token;
          while ((token = this.expect('*', '/', '%'))) {
            left = {
              type: AST.BinaryExpression,
              operator: token.text,
              left: left,
              right: this.unary()
            };
          }
          return left;
        },
        unary: function() {
          var token;
          if ((token = this.expect('+', '-', '!'))) {
            return {
              type: AST.UnaryExpression,
              operator: token.text,
              prefix: true,
              argument: this.unary()
            };
          } else {
            return this.primary();
          }
        },
        primary: function() {
          var primary;
          if (this.expect('(')) {
            primary = this.filterChain();
            this.consume(')');
          } else if (this.expect('[')) {
            primary = this.arrayDeclaration();
          } else if (this.expect('{')) {
            primary = this.object();
          } else if (this.constants.hasOwnProperty(this.peek().text)) {
            primary = copy(this.constants[this.consume().text]);
          } else if (this.peek().identifier) {
            primary = this.identifier();
          } else if (this.peek().constant) {
            primary = this.constant();
          } else {
            this.throwError('not a primary expression', this.peek());
          }
          var next;
          while ((next = this.expect('(', '[', '.'))) {
            if (next.text === '(') {
              primary = {
                type: AST.CallExpression,
                callee: primary,
                arguments: this.parseArguments()
              };
              this.consume(')');
            } else if (next.text === '[') {
              primary = {
                type: AST.MemberExpression,
                object: primary,
                property: this.expression(),
                computed: true
              };
              this.consume(']');
            } else if (next.text === '.') {
              primary = {
                type: AST.MemberExpression,
                object: primary,
                property: this.identifier(),
                computed: false
              };
            } else {
              this.throwError('IMPOSSIBLE');
            }
          }
          return primary;
        },
        filter: function(baseExpression) {
          var args = [baseExpression];
          var result = {
            type: AST.CallExpression,
            callee: this.identifier(),
            arguments: args,
            filter: true
          };
          while (this.expect(':')) {
            args.push(this.expression());
          }
          return result;
        },
        parseArguments: function() {
          var args = [];
          if (this.peekToken().text !== ')') {
            do {
              args.push(this.expression());
            } while (this.expect(','));
          }
          return args;
        },
        identifier: function() {
          var token = this.consume();
          if (!token.identifier) {
            this.throwError('is not a valid identifier', token);
          }
          return {
            type: AST.Identifier,
            name: token.text
          };
        },
        constant: function() {
          return {
            type: AST.Literal,
            value: this.consume().value
          };
        },
        arrayDeclaration: function() {
          var elements = [];
          if (this.peekToken().text !== ']') {
            do {
              if (this.peek(']')) {
                break;
              }
              elements.push(this.expression());
            } while (this.expect(','));
          }
          this.consume(']');
          return {
            type: AST.ArrayExpression,
            elements: elements
          };
        },
        object: function() {
          var properties = [],
              property;
          if (this.peekToken().text !== '}') {
            do {
              if (this.peek('}')) {
                break;
              }
              property = {
                type: AST.Property,
                kind: 'init'
              };
              if (this.peek().constant) {
                property.key = this.constant();
              } else if (this.peek().identifier) {
                property.key = this.identifier();
              } else {
                this.throwError("invalid key", this.peek());
              }
              this.consume(':');
              property.value = this.expression();
              properties.push(property);
            } while (this.expect(','));
          }
          this.consume('}');
          return {
            type: AST.ObjectExpression,
            properties: properties
          };
        },
        throwError: function(msg, token) {
          throw $parseMinErr('syntax', 'Syntax Error: Token \'{0}\' {1} at column {2} of the expression [{3}] starting at [{4}].', token.text, msg, (token.index + 1), this.text, this.text.substring(token.index));
        },
        consume: function(e1) {
          if (this.tokens.length === 0) {
            throw $parseMinErr('ueoe', 'Unexpected end of expression: {0}', this.text);
          }
          var token = this.expect(e1);
          if (!token) {
            this.throwError('is unexpected, expecting [' + e1 + ']', this.peek());
          }
          return token;
        },
        peekToken: function() {
          if (this.tokens.length === 0) {
            throw $parseMinErr('ueoe', 'Unexpected end of expression: {0}', this.text);
          }
          return this.tokens[0];
        },
        peek: function(e1, e2, e3, e4) {
          return this.peekAhead(0, e1, e2, e3, e4);
        },
        peekAhead: function(i, e1, e2, e3, e4) {
          if (this.tokens.length > i) {
            var token = this.tokens[i];
            var t = token.text;
            if (t === e1 || t === e2 || t === e3 || t === e4 || (!e1 && !e2 && !e3 && !e4)) {
              return token;
            }
          }
          return false;
        },
        expect: function(e1, e2, e3, e4) {
          var token = this.peek(e1, e2, e3, e4);
          if (token) {
            this.tokens.shift();
            return token;
          }
          return false;
        },
        constants: {
          'true': {
            type: AST.Literal,
            value: true
          },
          'false': {
            type: AST.Literal,
            value: false
          },
          'null': {
            type: AST.Literal,
            value: null
          },
          'undefined': {
            type: AST.Literal,
            value: undefined
          },
          'this': {type: AST.ThisExpression}
        }
      };
      function ifDefined(v, d) {
        return typeof v !== 'undefined' ? v : d;
      }
      function plusFn(l, r) {
        if (typeof l === 'undefined')
          return r;
        if (typeof r === 'undefined')
          return l;
        return l + r;
      }
      function isStateless($filter, filterName) {
        var fn = $filter(filterName);
        return !fn.$stateful;
      }
      function findConstantAndWatchExpressions(ast, $filter) {
        var allConstants;
        var argsToWatch;
        switch (ast.type) {
          case AST.Program:
            allConstants = true;
            forEach(ast.body, function(expr) {
              findConstantAndWatchExpressions(expr.expression, $filter);
              allConstants = allConstants && expr.expression.constant;
            });
            ast.constant = allConstants;
            break;
          case AST.Literal:
            ast.constant = true;
            ast.toWatch = [];
            break;
          case AST.UnaryExpression:
            findConstantAndWatchExpressions(ast.argument, $filter);
            ast.constant = ast.argument.constant;
            ast.toWatch = ast.argument.toWatch;
            break;
          case AST.BinaryExpression:
            findConstantAndWatchExpressions(ast.left, $filter);
            findConstantAndWatchExpressions(ast.right, $filter);
            ast.constant = ast.left.constant && ast.right.constant;
            ast.toWatch = ast.left.toWatch.concat(ast.right.toWatch);
            break;
          case AST.LogicalExpression:
            findConstantAndWatchExpressions(ast.left, $filter);
            findConstantAndWatchExpressions(ast.right, $filter);
            ast.constant = ast.left.constant && ast.right.constant;
            ast.toWatch = ast.constant ? [] : [ast];
            break;
          case AST.ConditionalExpression:
            findConstantAndWatchExpressions(ast.test, $filter);
            findConstantAndWatchExpressions(ast.alternate, $filter);
            findConstantAndWatchExpressions(ast.consequent, $filter);
            ast.constant = ast.test.constant && ast.alternate.constant && ast.consequent.constant;
            ast.toWatch = ast.constant ? [] : [ast];
            break;
          case AST.Identifier:
            ast.constant = false;
            ast.toWatch = [ast];
            break;
          case AST.MemberExpression:
            findConstantAndWatchExpressions(ast.object, $filter);
            if (ast.computed) {
              findConstantAndWatchExpressions(ast.property, $filter);
            }
            ast.constant = ast.object.constant && (!ast.computed || ast.property.constant);
            ast.toWatch = [ast];
            break;
          case AST.CallExpression:
            allConstants = ast.filter ? isStateless($filter, ast.callee.name) : false;
            argsToWatch = [];
            forEach(ast.arguments, function(expr) {
              findConstantAndWatchExpressions(expr, $filter);
              allConstants = allConstants && expr.constant;
              if (!expr.constant) {
                argsToWatch.push.apply(argsToWatch, expr.toWatch);
              }
            });
            ast.constant = allConstants;
            ast.toWatch = ast.filter && isStateless($filter, ast.callee.name) ? argsToWatch : [ast];
            break;
          case AST.AssignmentExpression:
            findConstantAndWatchExpressions(ast.left, $filter);
            findConstantAndWatchExpressions(ast.right, $filter);
            ast.constant = ast.left.constant && ast.right.constant;
            ast.toWatch = [ast];
            break;
          case AST.ArrayExpression:
            allConstants = true;
            argsToWatch = [];
            forEach(ast.elements, function(expr) {
              findConstantAndWatchExpressions(expr, $filter);
              allConstants = allConstants && expr.constant;
              if (!expr.constant) {
                argsToWatch.push.apply(argsToWatch, expr.toWatch);
              }
            });
            ast.constant = allConstants;
            ast.toWatch = argsToWatch;
            break;
          case AST.ObjectExpression:
            allConstants = true;
            argsToWatch = [];
            forEach(ast.properties, function(property) {
              findConstantAndWatchExpressions(property.value, $filter);
              allConstants = allConstants && property.value.constant;
              if (!property.value.constant) {
                argsToWatch.push.apply(argsToWatch, property.value.toWatch);
              }
            });
            ast.constant = allConstants;
            ast.toWatch = argsToWatch;
            break;
          case AST.ThisExpression:
            ast.constant = false;
            ast.toWatch = [];
            break;
        }
      }
      function getInputs(body) {
        if (body.length != 1)
          return;
        var lastExpression = body[0].expression;
        var candidate = lastExpression.toWatch;
        if (candidate.length !== 1)
          return candidate;
        return candidate[0] !== lastExpression ? candidate : undefined;
      }
      function isAssignable(ast) {
        return ast.type === AST.Identifier || ast.type === AST.MemberExpression;
      }
      function assignableAST(ast) {
        if (ast.body.length === 1 && isAssignable(ast.body[0].expression)) {
          return {
            type: AST.AssignmentExpression,
            left: ast.body[0].expression,
            right: {type: AST.NGValueParameter},
            operator: '='
          };
        }
      }
      function isLiteral(ast) {
        return ast.body.length === 0 || ast.body.length === 1 && (ast.body[0].expression.type === AST.Literal || ast.body[0].expression.type === AST.ArrayExpression || ast.body[0].expression.type === AST.ObjectExpression);
      }
      function isConstant(ast) {
        return ast.constant;
      }
      function ASTCompiler(astBuilder, $filter) {
        this.astBuilder = astBuilder;
        this.$filter = $filter;
      }
      ASTCompiler.prototype = {
        compile: function(expression, expensiveChecks) {
          var self = this;
          var ast = this.astBuilder.ast(expression);
          this.state = {
            nextId: 0,
            filters: {},
            expensiveChecks: expensiveChecks,
            fn: {
              vars: [],
              body: [],
              own: {}
            },
            assign: {
              vars: [],
              body: [],
              own: {}
            },
            inputs: []
          };
          findConstantAndWatchExpressions(ast, self.$filter);
          var extra = '';
          var assignable;
          this.stage = 'assign';
          if ((assignable = assignableAST(ast))) {
            this.state.computing = 'assign';
            var result = this.nextId();
            this.recurse(assignable, result);
            this.return_(result);
            extra = 'fn.assign=' + this.generateFunction('assign', 's,v,l');
          }
          var toWatch = getInputs(ast.body);
          self.stage = 'inputs';
          forEach(toWatch, function(watch, key) {
            var fnKey = 'fn' + key;
            self.state[fnKey] = {
              vars: [],
              body: [],
              own: {}
            };
            self.state.computing = fnKey;
            var intoId = self.nextId();
            self.recurse(watch, intoId);
            self.return_(intoId);
            self.state.inputs.push(fnKey);
            watch.watchId = key;
          });
          this.state.computing = 'fn';
          this.stage = 'main';
          this.recurse(ast);
          var fnString = '"' + this.USE + ' ' + this.STRICT + '";\n' + this.filterPrefix() + 'var fn=' + this.generateFunction('fn', 's,l,a,i') + extra + this.watchFns() + 'return fn;';
          var fn = (new Function('$filter', 'ensureSafeMemberName', 'ensureSafeObject', 'ensureSafeFunction', 'ifDefined', 'plus', 'text', fnString))(this.$filter, ensureSafeMemberName, ensureSafeObject, ensureSafeFunction, ifDefined, plusFn, expression);
          this.state = this.stage = undefined;
          fn.literal = isLiteral(ast);
          fn.constant = isConstant(ast);
          return fn;
        },
        USE: 'use',
        STRICT: 'strict',
        watchFns: function() {
          var result = [];
          var fns = this.state.inputs;
          var self = this;
          forEach(fns, function(name) {
            result.push('var ' + name + '=' + self.generateFunction(name, 's'));
          });
          if (fns.length) {
            result.push('fn.inputs=[' + fns.join(',') + '];');
          }
          return result.join('');
        },
        generateFunction: function(name, params) {
          return 'function(' + params + '){' + this.varsPrefix(name) + this.body(name) + '};';
        },
        filterPrefix: function() {
          var parts = [];
          var self = this;
          forEach(this.state.filters, function(id, filter) {
            parts.push(id + '=$filter(' + self.escape(filter) + ')');
          });
          if (parts.length)
            return 'var ' + parts.join(',') + ';';
          return '';
        },
        varsPrefix: function(section) {
          return this.state[section].vars.length ? 'var ' + this.state[section].vars.join(',') + ';' : '';
        },
        body: function(section) {
          return this.state[section].body.join('');
        },
        recurse: function(ast, intoId, nameId, recursionFn, create, skipWatchIdCheck) {
          var left,
              right,
              self = this,
              args,
              expression;
          recursionFn = recursionFn || noop;
          if (!skipWatchIdCheck && isDefined(ast.watchId)) {
            intoId = intoId || this.nextId();
            this.if_('i', this.lazyAssign(intoId, this.computedMember('i', ast.watchId)), this.lazyRecurse(ast, intoId, nameId, recursionFn, create, true));
            return;
          }
          switch (ast.type) {
            case AST.Program:
              forEach(ast.body, function(expression, pos) {
                self.recurse(expression.expression, undefined, undefined, function(expr) {
                  right = expr;
                });
                if (pos !== ast.body.length - 1) {
                  self.current().body.push(right, ';');
                } else {
                  self.return_(right);
                }
              });
              break;
            case AST.Literal:
              expression = this.escape(ast.value);
              this.assign(intoId, expression);
              recursionFn(expression);
              break;
            case AST.UnaryExpression:
              this.recurse(ast.argument, undefined, undefined, function(expr) {
                right = expr;
              });
              expression = ast.operator + '(' + this.ifDefined(right, 0) + ')';
              this.assign(intoId, expression);
              recursionFn(expression);
              break;
            case AST.BinaryExpression:
              this.recurse(ast.left, undefined, undefined, function(expr) {
                left = expr;
              });
              this.recurse(ast.right, undefined, undefined, function(expr) {
                right = expr;
              });
              if (ast.operator === '+') {
                expression = this.plus(left, right);
              } else if (ast.operator === '-') {
                expression = this.ifDefined(left, 0) + ast.operator + this.ifDefined(right, 0);
              } else {
                expression = '(' + left + ')' + ast.operator + '(' + right + ')';
              }
              this.assign(intoId, expression);
              recursionFn(expression);
              break;
            case AST.LogicalExpression:
              intoId = intoId || this.nextId();
              self.recurse(ast.left, intoId);
              self.if_(ast.operator === '&&' ? intoId : self.not(intoId), self.lazyRecurse(ast.right, intoId));
              recursionFn(intoId);
              break;
            case AST.ConditionalExpression:
              intoId = intoId || this.nextId();
              self.recurse(ast.test, intoId);
              self.if_(intoId, self.lazyRecurse(ast.alternate, intoId), self.lazyRecurse(ast.consequent, intoId));
              recursionFn(intoId);
              break;
            case AST.Identifier:
              intoId = intoId || this.nextId();
              if (nameId) {
                nameId.context = self.stage === 'inputs' ? 's' : this.assign(this.nextId(), this.getHasOwnProperty('l', ast.name) + '?l:s');
                nameId.computed = false;
                nameId.name = ast.name;
              }
              ensureSafeMemberName(ast.name);
              self.if_(self.stage === 'inputs' || self.not(self.getHasOwnProperty('l', ast.name)), function() {
                self.if_(self.stage === 'inputs' || 's', function() {
                  if (create && create !== 1) {
                    self.if_(self.not(self.nonComputedMember('s', ast.name)), self.lazyAssign(self.nonComputedMember('s', ast.name), '{}'));
                  }
                  self.assign(intoId, self.nonComputedMember('s', ast.name));
                });
              }, intoId && self.lazyAssign(intoId, self.nonComputedMember('l', ast.name)));
              if (self.state.expensiveChecks || isPossiblyDangerousMemberName(ast.name)) {
                self.addEnsureSafeObject(intoId);
              }
              recursionFn(intoId);
              break;
            case AST.MemberExpression:
              left = nameId && (nameId.context = this.nextId()) || this.nextId();
              intoId = intoId || this.nextId();
              self.recurse(ast.object, left, undefined, function() {
                self.if_(self.notNull(left), function() {
                  if (ast.computed) {
                    right = self.nextId();
                    self.recurse(ast.property, right);
                    self.addEnsureSafeMemberName(right);
                    if (create && create !== 1) {
                      self.if_(self.not(self.computedMember(left, right)), self.lazyAssign(self.computedMember(left, right), '{}'));
                    }
                    expression = self.ensureSafeObject(self.computedMember(left, right));
                    self.assign(intoId, expression);
                    if (nameId) {
                      nameId.computed = true;
                      nameId.name = right;
                    }
                  } else {
                    ensureSafeMemberName(ast.property.name);
                    if (create && create !== 1) {
                      self.if_(self.not(self.nonComputedMember(left, ast.property.name)), self.lazyAssign(self.nonComputedMember(left, ast.property.name), '{}'));
                    }
                    expression = self.nonComputedMember(left, ast.property.name);
                    if (self.state.expensiveChecks || isPossiblyDangerousMemberName(ast.property.name)) {
                      expression = self.ensureSafeObject(expression);
                    }
                    self.assign(intoId, expression);
                    if (nameId) {
                      nameId.computed = false;
                      nameId.name = ast.property.name;
                    }
                  }
                }, function() {
                  self.assign(intoId, 'undefined');
                });
                recursionFn(intoId);
              }, !!create);
              break;
            case AST.CallExpression:
              intoId = intoId || this.nextId();
              if (ast.filter) {
                right = self.filter(ast.callee.name);
                args = [];
                forEach(ast.arguments, function(expr) {
                  var argument = self.nextId();
                  self.recurse(expr, argument);
                  args.push(argument);
                });
                expression = right + '(' + args.join(',') + ')';
                self.assign(intoId, expression);
                recursionFn(intoId);
              } else {
                right = self.nextId();
                left = {};
                args = [];
                self.recurse(ast.callee, right, left, function() {
                  self.if_(self.notNull(right), function() {
                    self.addEnsureSafeFunction(right);
                    forEach(ast.arguments, function(expr) {
                      self.recurse(expr, self.nextId(), undefined, function(argument) {
                        args.push(self.ensureSafeObject(argument));
                      });
                    });
                    if (left.name) {
                      if (!self.state.expensiveChecks) {
                        self.addEnsureSafeObject(left.context);
                      }
                      expression = self.member(left.context, left.name, left.computed) + '(' + args.join(',') + ')';
                    } else {
                      expression = right + '(' + args.join(',') + ')';
                    }
                    expression = self.ensureSafeObject(expression);
                    self.assign(intoId, expression);
                  }, function() {
                    self.assign(intoId, 'undefined');
                  });
                  recursionFn(intoId);
                });
              }
              break;
            case AST.AssignmentExpression:
              right = this.nextId();
              left = {};
              if (!isAssignable(ast.left)) {
                throw $parseMinErr('lval', 'Trying to assing a value to a non l-value');
              }
              this.recurse(ast.left, undefined, left, function() {
                self.if_(self.notNull(left.context), function() {
                  self.recurse(ast.right, right);
                  self.addEnsureSafeObject(self.member(left.context, left.name, left.computed));
                  expression = self.member(left.context, left.name, left.computed) + ast.operator + right;
                  self.assign(intoId, expression);
                  recursionFn(intoId || expression);
                });
              }, 1);
              break;
            case AST.ArrayExpression:
              args = [];
              forEach(ast.elements, function(expr) {
                self.recurse(expr, self.nextId(), undefined, function(argument) {
                  args.push(argument);
                });
              });
              expression = '[' + args.join(',') + ']';
              this.assign(intoId, expression);
              recursionFn(expression);
              break;
            case AST.ObjectExpression:
              args = [];
              forEach(ast.properties, function(property) {
                self.recurse(property.value, self.nextId(), undefined, function(expr) {
                  args.push(self.escape(property.key.type === AST.Identifier ? property.key.name : ('' + property.key.value)) + ':' + expr);
                });
              });
              expression = '{' + args.join(',') + '}';
              this.assign(intoId, expression);
              recursionFn(expression);
              break;
            case AST.ThisExpression:
              this.assign(intoId, 's');
              recursionFn('s');
              break;
            case AST.NGValueParameter:
              this.assign(intoId, 'v');
              recursionFn('v');
              break;
          }
        },
        getHasOwnProperty: function(element, property) {
          var key = element + '.' + property;
          var own = this.current().own;
          if (!own.hasOwnProperty(key)) {
            own[key] = this.nextId(false, element + '&&(' + this.escape(property) + ' in ' + element + ')');
          }
          return own[key];
        },
        assign: function(id, value) {
          if (!id)
            return;
          this.current().body.push(id, '=', value, ';');
          return id;
        },
        filter: function(filterName) {
          if (!this.state.filters.hasOwnProperty(filterName)) {
            this.state.filters[filterName] = this.nextId(true);
          }
          return this.state.filters[filterName];
        },
        ifDefined: function(id, defaultValue) {
          return 'ifDefined(' + id + ',' + this.escape(defaultValue) + ')';
        },
        plus: function(left, right) {
          return 'plus(' + left + ',' + right + ')';
        },
        return_: function(id) {
          this.current().body.push('return ', id, ';');
        },
        if_: function(test, alternate, consequent) {
          if (test === true) {
            alternate();
          } else {
            var body = this.current().body;
            body.push('if(', test, '){');
            alternate();
            body.push('}');
            if (consequent) {
              body.push('else{');
              consequent();
              body.push('}');
            }
          }
        },
        not: function(expression) {
          return '!(' + expression + ')';
        },
        notNull: function(expression) {
          return expression + '!=null';
        },
        nonComputedMember: function(left, right) {
          return left + '.' + right;
        },
        computedMember: function(left, right) {
          return left + '[' + right + ']';
        },
        member: function(left, right, computed) {
          if (computed)
            return this.computedMember(left, right);
          return this.nonComputedMember(left, right);
        },
        addEnsureSafeObject: function(item) {
          this.current().body.push(this.ensureSafeObject(item), ';');
        },
        addEnsureSafeMemberName: function(item) {
          this.current().body.push(this.ensureSafeMemberName(item), ';');
        },
        addEnsureSafeFunction: function(item) {
          this.current().body.push(this.ensureSafeFunction(item), ';');
        },
        ensureSafeObject: function(item) {
          return 'ensureSafeObject(' + item + ',text)';
        },
        ensureSafeMemberName: function(item) {
          return 'ensureSafeMemberName(' + item + ',text)';
        },
        ensureSafeFunction: function(item) {
          return 'ensureSafeFunction(' + item + ',text)';
        },
        lazyRecurse: function(ast, intoId, nameId, recursionFn, create, skipWatchIdCheck) {
          var self = this;
          return function() {
            self.recurse(ast, intoId, nameId, recursionFn, create, skipWatchIdCheck);
          };
        },
        lazyAssign: function(id, value) {
          var self = this;
          return function() {
            self.assign(id, value);
          };
        },
        stringEscapeRegex: /[^ a-zA-Z0-9]/g,
        stringEscapeFn: function(c) {
          return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
        },
        escape: function(value) {
          if (isString(value))
            return "'" + value.replace(this.stringEscapeRegex, this.stringEscapeFn) + "'";
          if (isNumber(value))
            return value.toString();
          if (value === true)
            return 'true';
          if (value === false)
            return 'false';
          if (value === null)
            return 'null';
          if (typeof value === 'undefined')
            return 'undefined';
          throw $parseMinErr('esc', 'IMPOSSIBLE');
        },
        nextId: function(skip, init) {
          var id = 'v' + (this.state.nextId++);
          if (!skip) {
            this.current().vars.push(id + (init ? '=' + init : ''));
          }
          return id;
        },
        current: function() {
          return this.state[this.state.computing];
        }
      };
      function ASTInterpreter(astBuilder, $filter) {
        this.astBuilder = astBuilder;
        this.$filter = $filter;
      }
      ASTInterpreter.prototype = {
        compile: function(expression, expensiveChecks) {
          var self = this;
          var ast = this.astBuilder.ast(expression);
          this.expression = expression;
          this.expensiveChecks = expensiveChecks;
          findConstantAndWatchExpressions(ast, self.$filter);
          var assignable;
          var assign;
          if ((assignable = assignableAST(ast))) {
            assign = this.recurse(assignable);
          }
          var toWatch = getInputs(ast.body);
          var inputs;
          if (toWatch) {
            inputs = [];
            forEach(toWatch, function(watch, key) {
              var input = self.recurse(watch);
              watch.input = input;
              inputs.push(input);
              watch.watchId = key;
            });
          }
          var expressions = [];
          forEach(ast.body, function(expression) {
            expressions.push(self.recurse(expression.expression));
          });
          var fn = ast.body.length === 0 ? function() {} : ast.body.length === 1 ? expressions[0] : function(scope, locals) {
            var lastValue;
            forEach(expressions, function(exp) {
              lastValue = exp(scope, locals);
            });
            return lastValue;
          };
          if (assign) {
            fn.assign = function(scope, value, locals) {
              return assign(scope, locals, value);
            };
          }
          if (inputs) {
            fn.inputs = inputs;
          }
          fn.literal = isLiteral(ast);
          fn.constant = isConstant(ast);
          return fn;
        },
        recurse: function(ast, context, create) {
          var left,
              right,
              self = this,
              args,
              expression;
          if (ast.input) {
            return this.inputs(ast.input, ast.watchId);
          }
          switch (ast.type) {
            case AST.Literal:
              return this.value(ast.value, context);
            case AST.UnaryExpression:
              right = this.recurse(ast.argument);
              return this['unary' + ast.operator](right, context);
            case AST.BinaryExpression:
              left = this.recurse(ast.left);
              right = this.recurse(ast.right);
              return this['binary' + ast.operator](left, right, context);
            case AST.LogicalExpression:
              left = this.recurse(ast.left);
              right = this.recurse(ast.right);
              return this['binary' + ast.operator](left, right, context);
            case AST.ConditionalExpression:
              return this['ternary?:'](this.recurse(ast.test), this.recurse(ast.alternate), this.recurse(ast.consequent), context);
            case AST.Identifier:
              ensureSafeMemberName(ast.name, self.expression);
              return self.identifier(ast.name, self.expensiveChecks || isPossiblyDangerousMemberName(ast.name), context, create, self.expression);
            case AST.MemberExpression:
              left = this.recurse(ast.object, false, !!create);
              if (!ast.computed) {
                ensureSafeMemberName(ast.property.name, self.expression);
                right = ast.property.name;
              }
              if (ast.computed)
                right = this.recurse(ast.property);
              return ast.computed ? this.computedMember(left, right, context, create, self.expression) : this.nonComputedMember(left, right, self.expensiveChecks, context, create, self.expression);
            case AST.CallExpression:
              args = [];
              forEach(ast.arguments, function(expr) {
                args.push(self.recurse(expr));
              });
              if (ast.filter)
                right = this.$filter(ast.callee.name);
              if (!ast.filter)
                right = this.recurse(ast.callee, true);
              return ast.filter ? function(scope, locals, assign, inputs) {
                var values = [];
                for (var i = 0; i < args.length; ++i) {
                  values.push(args[i](scope, locals, assign, inputs));
                }
                var value = right.apply(undefined, values, inputs);
                return context ? {
                  context: undefined,
                  name: undefined,
                  value: value
                } : value;
              } : function(scope, locals, assign, inputs) {
                var rhs = right(scope, locals, assign, inputs);
                var value;
                if (rhs.value != null) {
                  ensureSafeObject(rhs.context, self.expression);
                  ensureSafeFunction(rhs.value, self.expression);
                  var values = [];
                  for (var i = 0; i < args.length; ++i) {
                    values.push(ensureSafeObject(args[i](scope, locals, assign, inputs), self.expression));
                  }
                  value = ensureSafeObject(rhs.value.apply(rhs.context, values), self.expression);
                }
                return context ? {value: value} : value;
              };
            case AST.AssignmentExpression:
              left = this.recurse(ast.left, true, 1);
              right = this.recurse(ast.right);
              return function(scope, locals, assign, inputs) {
                var lhs = left(scope, locals, assign, inputs);
                var rhs = right(scope, locals, assign, inputs);
                ensureSafeObject(lhs.value, self.expression);
                lhs.context[lhs.name] = rhs;
                return context ? {value: rhs} : rhs;
              };
            case AST.ArrayExpression:
              args = [];
              forEach(ast.elements, function(expr) {
                args.push(self.recurse(expr));
              });
              return function(scope, locals, assign, inputs) {
                var value = [];
                for (var i = 0; i < args.length; ++i) {
                  value.push(args[i](scope, locals, assign, inputs));
                }
                return context ? {value: value} : value;
              };
            case AST.ObjectExpression:
              args = [];
              forEach(ast.properties, function(property) {
                args.push({
                  key: property.key.type === AST.Identifier ? property.key.name : ('' + property.key.value),
                  value: self.recurse(property.value)
                });
              });
              return function(scope, locals, assign, inputs) {
                var value = {};
                for (var i = 0; i < args.length; ++i) {
                  value[args[i].key] = args[i].value(scope, locals, assign, inputs);
                }
                return context ? {value: value} : value;
              };
            case AST.ThisExpression:
              return function(scope) {
                return context ? {value: scope} : scope;
              };
            case AST.NGValueParameter:
              return function(scope, locals, assign, inputs) {
                return context ? {value: assign} : assign;
              };
          }
        },
        'unary+': function(argument, context) {
          return function(scope, locals, assign, inputs) {
            var arg = argument(scope, locals, assign, inputs);
            if (isDefined(arg)) {
              arg = +arg;
            } else {
              arg = 0;
            }
            return context ? {value: arg} : arg;
          };
        },
        'unary-': function(argument, context) {
          return function(scope, locals, assign, inputs) {
            var arg = argument(scope, locals, assign, inputs);
            if (isDefined(arg)) {
              arg = -arg;
            } else {
              arg = 0;
            }
            return context ? {value: arg} : arg;
          };
        },
        'unary!': function(argument, context) {
          return function(scope, locals, assign, inputs) {
            var arg = !argument(scope, locals, assign, inputs);
            return context ? {value: arg} : arg;
          };
        },
        'binary+': function(left, right, context) {
          return function(scope, locals, assign, inputs) {
            var lhs = left(scope, locals, assign, inputs);
            var rhs = right(scope, locals, assign, inputs);
            var arg = plusFn(lhs, rhs);
            return context ? {value: arg} : arg;
          };
        },
        'binary-': function(left, right, context) {
          return function(scope, locals, assign, inputs) {
            var lhs = left(scope, locals, assign, inputs);
            var rhs = right(scope, locals, assign, inputs);
            var arg = (isDefined(lhs) ? lhs : 0) - (isDefined(rhs) ? rhs : 0);
            return context ? {value: arg} : arg;
          };
        },
        'binary*': function(left, right, context) {
          return function(scope, locals, assign, inputs) {
            var arg = left(scope, locals, assign, inputs) * right(scope, locals, assign, inputs);
            return context ? {value: arg} : arg;
          };
        },
        'binary/': function(left, right, context) {
          return function(scope, locals, assign, inputs) {
            var arg = left(scope, locals, assign, inputs) / right(scope, locals, assign, inputs);
            return context ? {value: arg} : arg;
          };
        },
        'binary%': function(left, right, context) {
          return function(scope, locals, assign, inputs) {
            var arg = left(scope, locals, assign, inputs) % right(scope, locals, assign, inputs);
            return context ? {value: arg} : arg;
          };
        },
        'binary===': function(left, right, context) {
          return function(scope, locals, assign, inputs) {
            var arg = left(scope, locals, assign, inputs) === right(scope, locals, assign, inputs);
            return context ? {value: arg} : arg;
          };
        },
        'binary!==': function(left, right, context) {
          return function(scope, locals, assign, inputs) {
            var arg = left(scope, locals, assign, inputs) !== right(scope, locals, assign, inputs);
            return context ? {value: arg} : arg;
          };
        },
        'binary==': function(left, right, context) {
          return function(scope, locals, assign, inputs) {
            var arg = left(scope, locals, assign, inputs) == right(scope, locals, assign, inputs);
            return context ? {value: arg} : arg;
          };
        },
        'binary!=': function(left, right, context) {
          return function(scope, locals, assign, inputs) {
            var arg = left(scope, locals, assign, inputs) != right(scope, locals, assign, inputs);
            return context ? {value: arg} : arg;
          };
        },
        'binary<': function(left, right, context) {
          return function(scope, locals, assign, inputs) {
            var arg = left(scope, locals, assign, inputs) < right(scope, locals, assign, inputs);
            return context ? {value: arg} : arg;
          };
        },
        'binary>': function(left, right, context) {
          return function(scope, locals, assign, inputs) {
            var arg = left(scope, locals, assign, inputs) > right(scope, locals, assign, inputs);
            return context ? {value: arg} : arg;
          };
        },
        'binary<=': function(left, right, context) {
          return function(scope, locals, assign, inputs) {
            var arg = left(scope, locals, assign, inputs) <= right(scope, locals, assign, inputs);
            return context ? {value: arg} : arg;
          };
        },
        'binary>=': function(left, right, context) {
          return function(scope, locals, assign, inputs) {
            var arg = left(scope, locals, assign, inputs) >= right(scope, locals, assign, inputs);
            return context ? {value: arg} : arg;
          };
        },
        'binary&&': function(left, right, context) {
          return function(scope, locals, assign, inputs) {
            var arg = left(scope, locals, assign, inputs) && right(scope, locals, assign, inputs);
            return context ? {value: arg} : arg;
          };
        },
        'binary||': function(left, right, context) {
          return function(scope, locals, assign, inputs) {
            var arg = left(scope, locals, assign, inputs) || right(scope, locals, assign, inputs);
            return context ? {value: arg} : arg;
          };
        },
        'ternary?:': function(test, alternate, consequent, context) {
          return function(scope, locals, assign, inputs) {
            var arg = test(scope, locals, assign, inputs) ? alternate(scope, locals, assign, inputs) : consequent(scope, locals, assign, inputs);
            return context ? {value: arg} : arg;
          };
        },
        value: function(value, context) {
          return function() {
            return context ? {
              context: undefined,
              name: undefined,
              value: value
            } : value;
          };
        },
        identifier: function(name, expensiveChecks, context, create, expression) {
          return function(scope, locals, assign, inputs) {
            var base = locals && (name in locals) ? locals : scope;
            if (create && create !== 1 && base && !(base[name])) {
              base[name] = {};
            }
            var value = base ? base[name] : undefined;
            if (expensiveChecks) {
              ensureSafeObject(value, expression);
            }
            if (context) {
              return {
                context: base,
                name: name,
                value: value
              };
            } else {
              return value;
            }
          };
        },
        computedMember: function(left, right, context, create, expression) {
          return function(scope, locals, assign, inputs) {
            var lhs = left(scope, locals, assign, inputs);
            var rhs;
            var value;
            if (lhs != null) {
              rhs = right(scope, locals, assign, inputs);
              ensureSafeMemberName(rhs, expression);
              if (create && create !== 1 && lhs && !(lhs[rhs])) {
                lhs[rhs] = {};
              }
              value = lhs[rhs];
              ensureSafeObject(value, expression);
            }
            if (context) {
              return {
                context: lhs,
                name: rhs,
                value: value
              };
            } else {
              return value;
            }
          };
        },
        nonComputedMember: function(left, right, expensiveChecks, context, create, expression) {
          return function(scope, locals, assign, inputs) {
            var lhs = left(scope, locals, assign, inputs);
            if (create && create !== 1 && lhs && !(lhs[right])) {
              lhs[right] = {};
            }
            var value = lhs != null ? lhs[right] : undefined;
            if (expensiveChecks || isPossiblyDangerousMemberName(right)) {
              ensureSafeObject(value, expression);
            }
            if (context) {
              return {
                context: lhs,
                name: right,
                value: value
              };
            } else {
              return value;
            }
          };
        },
        inputs: function(input, watchId) {
          return function(scope, value, locals, inputs) {
            if (inputs)
              return inputs[watchId];
            return input(scope, value, locals);
          };
        }
      };
      var Parser = function(lexer, $filter, options) {
        this.lexer = lexer;
        this.$filter = $filter;
        this.options = options;
        this.ast = new AST(this.lexer);
        this.astCompiler = options.csp ? new ASTInterpreter(this.ast, $filter) : new ASTCompiler(this.ast, $filter);
      };
      Parser.prototype = {
        constructor: Parser,
        parse: function(text) {
          return this.astCompiler.compile(text, this.options.expensiveChecks);
        }
      };
      var getterFnCacheDefault = createMap();
      var getterFnCacheExpensive = createMap();
      function isPossiblyDangerousMemberName(name) {
        return name == 'constructor';
      }
      var objectValueOf = Object.prototype.valueOf;
      function getValueOf(value) {
        return isFunction(value.valueOf) ? value.valueOf() : objectValueOf.call(value);
      }
      function $ParseProvider() {
        var cacheDefault = createMap();
        var cacheExpensive = createMap();
        this.$get = ['$filter', function($filter) {
          var noUnsafeEval = csp().noUnsafeEval;
          var $parseOptions = {
            csp: noUnsafeEval,
            expensiveChecks: false
          },
              $parseOptionsExpensive = {
                csp: noUnsafeEval,
                expensiveChecks: true
              };
          return function $parse(exp, interceptorFn, expensiveChecks) {
            var parsedExpression,
                oneTime,
                cacheKey;
            switch (typeof exp) {
              case 'string':
                exp = exp.trim();
                cacheKey = exp;
                var cache = (expensiveChecks ? cacheExpensive : cacheDefault);
                parsedExpression = cache[cacheKey];
                if (!parsedExpression) {
                  if (exp.charAt(0) === ':' && exp.charAt(1) === ':') {
                    oneTime = true;
                    exp = exp.substring(2);
                  }
                  var parseOptions = expensiveChecks ? $parseOptionsExpensive : $parseOptions;
                  var lexer = new Lexer(parseOptions);
                  var parser = new Parser(lexer, $filter, parseOptions);
                  parsedExpression = parser.parse(exp);
                  if (parsedExpression.constant) {
                    parsedExpression.$$watchDelegate = constantWatchDelegate;
                  } else if (oneTime) {
                    parsedExpression.$$watchDelegate = parsedExpression.literal ? oneTimeLiteralWatchDelegate : oneTimeWatchDelegate;
                  } else if (parsedExpression.inputs) {
                    parsedExpression.$$watchDelegate = inputsWatchDelegate;
                  }
                  cache[cacheKey] = parsedExpression;
                }
                return addInterceptor(parsedExpression, interceptorFn);
              case 'function':
                return addInterceptor(exp, interceptorFn);
              default:
                return noop;
            }
          };
          function expressionInputDirtyCheck(newValue, oldValueOfValue) {
            if (newValue == null || oldValueOfValue == null) {
              return newValue === oldValueOfValue;
            }
            if (typeof newValue === 'object') {
              newValue = getValueOf(newValue);
              if (typeof newValue === 'object') {
                return false;
              }
            }
            return newValue === oldValueOfValue || (newValue !== newValue && oldValueOfValue !== oldValueOfValue);
          }
          function inputsWatchDelegate(scope, listener, objectEquality, parsedExpression, prettyPrintExpression) {
            var inputExpressions = parsedExpression.inputs;
            var lastResult;
            if (inputExpressions.length === 1) {
              var oldInputValueOf = expressionInputDirtyCheck;
              inputExpressions = inputExpressions[0];
              return scope.$watch(function expressionInputWatch(scope) {
                var newInputValue = inputExpressions(scope);
                if (!expressionInputDirtyCheck(newInputValue, oldInputValueOf)) {
                  lastResult = parsedExpression(scope, undefined, undefined, [newInputValue]);
                  oldInputValueOf = newInputValue && getValueOf(newInputValue);
                }
                return lastResult;
              }, listener, objectEquality, prettyPrintExpression);
            }
            var oldInputValueOfValues = [];
            var oldInputValues = [];
            for (var i = 0,
                ii = inputExpressions.length; i < ii; i++) {
              oldInputValueOfValues[i] = expressionInputDirtyCheck;
              oldInputValues[i] = null;
            }
            return scope.$watch(function expressionInputsWatch(scope) {
              var changed = false;
              for (var i = 0,
                  ii = inputExpressions.length; i < ii; i++) {
                var newInputValue = inputExpressions[i](scope);
                if (changed || (changed = !expressionInputDirtyCheck(newInputValue, oldInputValueOfValues[i]))) {
                  oldInputValues[i] = newInputValue;
                  oldInputValueOfValues[i] = newInputValue && getValueOf(newInputValue);
                }
              }
              if (changed) {
                lastResult = parsedExpression(scope, undefined, undefined, oldInputValues);
              }
              return lastResult;
            }, listener, objectEquality, prettyPrintExpression);
          }
          function oneTimeWatchDelegate(scope, listener, objectEquality, parsedExpression) {
            var unwatch,
                lastValue;
            return unwatch = scope.$watch(function oneTimeWatch(scope) {
              return parsedExpression(scope);
            }, function oneTimeListener(value, old, scope) {
              lastValue = value;
              if (isFunction(listener)) {
                listener.apply(this, arguments);
              }
              if (isDefined(value)) {
                scope.$$postDigest(function() {
                  if (isDefined(lastValue)) {
                    unwatch();
                  }
                });
              }
            }, objectEquality);
          }
          function oneTimeLiteralWatchDelegate(scope, listener, objectEquality, parsedExpression) {
            var unwatch,
                lastValue;
            return unwatch = scope.$watch(function oneTimeWatch(scope) {
              return parsedExpression(scope);
            }, function oneTimeListener(value, old, scope) {
              lastValue = value;
              if (isFunction(listener)) {
                listener.call(this, value, old, scope);
              }
              if (isAllDefined(value)) {
                scope.$$postDigest(function() {
                  if (isAllDefined(lastValue))
                    unwatch();
                });
              }
            }, objectEquality);
            function isAllDefined(value) {
              var allDefined = true;
              forEach(value, function(val) {
                if (!isDefined(val))
                  allDefined = false;
              });
              return allDefined;
            }
          }
          function constantWatchDelegate(scope, listener, objectEquality, parsedExpression) {
            var unwatch;
            return unwatch = scope.$watch(function constantWatch(scope) {
              return parsedExpression(scope);
            }, function constantListener(value, old, scope) {
              if (isFunction(listener)) {
                listener.apply(this, arguments);
              }
              unwatch();
            }, objectEquality);
          }
          function addInterceptor(parsedExpression, interceptorFn) {
            if (!interceptorFn)
              return parsedExpression;
            var watchDelegate = parsedExpression.$$watchDelegate;
            var regularWatch = watchDelegate !== oneTimeLiteralWatchDelegate && watchDelegate !== oneTimeWatchDelegate;
            var fn = regularWatch ? function regularInterceptedExpression(scope, locals, assign, inputs) {
              var value = parsedExpression(scope, locals, assign, inputs);
              return interceptorFn(value, scope, locals);
            } : function oneTimeInterceptedExpression(scope, locals, assign, inputs) {
              var value = parsedExpression(scope, locals, assign, inputs);
              var result = interceptorFn(value, scope, locals);
              return isDefined(value) ? result : value;
            };
            if (parsedExpression.$$watchDelegate && parsedExpression.$$watchDelegate !== inputsWatchDelegate) {
              fn.$$watchDelegate = parsedExpression.$$watchDelegate;
            } else if (!interceptorFn.$stateful) {
              fn.$$watchDelegate = inputsWatchDelegate;
              fn.inputs = parsedExpression.inputs ? parsedExpression.inputs : [parsedExpression];
            }
            return fn;
          }
        }];
      }
      function $QProvider() {
        this.$get = ['$rootScope', '$exceptionHandler', function($rootScope, $exceptionHandler) {
          return qFactory(function(callback) {
            $rootScope.$evalAsync(callback);
          }, $exceptionHandler);
        }];
      }
      function $$QProvider() {
        this.$get = ['$browser', '$exceptionHandler', function($browser, $exceptionHandler) {
          return qFactory(function(callback) {
            $browser.defer(callback);
          }, $exceptionHandler);
        }];
      }
      function qFactory(nextTick, exceptionHandler) {
        var $qMinErr = minErr('$q', TypeError);
        function callOnce(self, resolveFn, rejectFn) {
          var called = false;
          function wrap(fn) {
            return function(value) {
              if (called)
                return;
              called = true;
              fn.call(self, value);
            };
          }
          return [wrap(resolveFn), wrap(rejectFn)];
        }
        var defer = function() {
          return new Deferred();
        };
        function Promise() {
          this.$$state = {status: 0};
        }
        extend(Promise.prototype, {
          then: function(onFulfilled, onRejected, progressBack) {
            if (isUndefined(onFulfilled) && isUndefined(onRejected) && isUndefined(progressBack)) {
              return this;
            }
            var result = new Deferred();
            this.$$state.pending = this.$$state.pending || [];
            this.$$state.pending.push([result, onFulfilled, onRejected, progressBack]);
            if (this.$$state.status > 0)
              scheduleProcessQueue(this.$$state);
            return result.promise;
          },
          "catch": function(callback) {
            return this.then(null, callback);
          },
          "finally": function(callback, progressBack) {
            return this.then(function(value) {
              return handleCallback(value, true, callback);
            }, function(error) {
              return handleCallback(error, false, callback);
            }, progressBack);
          }
        });
        function simpleBind(context, fn) {
          return function(value) {
            fn.call(context, value);
          };
        }
        function processQueue(state) {
          var fn,
              deferred,
              pending;
          pending = state.pending;
          state.processScheduled = false;
          state.pending = undefined;
          for (var i = 0,
              ii = pending.length; i < ii; ++i) {
            deferred = pending[i][0];
            fn = pending[i][state.status];
            try {
              if (isFunction(fn)) {
                deferred.resolve(fn(state.value));
              } else if (state.status === 1) {
                deferred.resolve(state.value);
              } else {
                deferred.reject(state.value);
              }
            } catch (e) {
              deferred.reject(e);
              exceptionHandler(e);
            }
          }
        }
        function scheduleProcessQueue(state) {
          if (state.processScheduled || !state.pending)
            return;
          state.processScheduled = true;
          nextTick(function() {
            processQueue(state);
          });
        }
        function Deferred() {
          this.promise = new Promise();
          this.resolve = simpleBind(this, this.resolve);
          this.reject = simpleBind(this, this.reject);
          this.notify = simpleBind(this, this.notify);
        }
        extend(Deferred.prototype, {
          resolve: function(val) {
            if (this.promise.$$state.status)
              return;
            if (val === this.promise) {
              this.$$reject($qMinErr('qcycle', "Expected promise to be resolved with value other than itself '{0}'", val));
            } else {
              this.$$resolve(val);
            }
          },
          $$resolve: function(val) {
            var then,
                fns;
            fns = callOnce(this, this.$$resolve, this.$$reject);
            try {
              if ((isObject(val) || isFunction(val)))
                then = val && val.then;
              if (isFunction(then)) {
                this.promise.$$state.status = -1;
                then.call(val, fns[0], fns[1], this.notify);
              } else {
                this.promise.$$state.value = val;
                this.promise.$$state.status = 1;
                scheduleProcessQueue(this.promise.$$state);
              }
            } catch (e) {
              fns[1](e);
              exceptionHandler(e);
            }
          },
          reject: function(reason) {
            if (this.promise.$$state.status)
              return;
            this.$$reject(reason);
          },
          $$reject: function(reason) {
            this.promise.$$state.value = reason;
            this.promise.$$state.status = 2;
            scheduleProcessQueue(this.promise.$$state);
          },
          notify: function(progress) {
            var callbacks = this.promise.$$state.pending;
            if ((this.promise.$$state.status <= 0) && callbacks && callbacks.length) {
              nextTick(function() {
                var callback,
                    result;
                for (var i = 0,
                    ii = callbacks.length; i < ii; i++) {
                  result = callbacks[i][0];
                  callback = callbacks[i][3];
                  try {
                    result.notify(isFunction(callback) ? callback(progress) : progress);
                  } catch (e) {
                    exceptionHandler(e);
                  }
                }
              });
            }
          }
        });
        var reject = function(reason) {
          var result = new Deferred();
          result.reject(reason);
          return result.promise;
        };
        var makePromise = function makePromise(value, resolved) {
          var result = new Deferred();
          if (resolved) {
            result.resolve(value);
          } else {
            result.reject(value);
          }
          return result.promise;
        };
        var handleCallback = function handleCallback(value, isResolved, callback) {
          var callbackOutput = null;
          try {
            if (isFunction(callback))
              callbackOutput = callback();
          } catch (e) {
            return makePromise(e, false);
          }
          if (isPromiseLike(callbackOutput)) {
            return callbackOutput.then(function() {
              return makePromise(value, isResolved);
            }, function(error) {
              return makePromise(error, false);
            });
          } else {
            return makePromise(value, isResolved);
          }
        };
        var when = function(value, callback, errback, progressBack) {
          var result = new Deferred();
          result.resolve(value);
          return result.promise.then(callback, errback, progressBack);
        };
        var resolve = when;
        function all(promises) {
          var deferred = new Deferred(),
              counter = 0,
              results = isArray(promises) ? [] : {};
          forEach(promises, function(promise, key) {
            counter++;
            when(promise).then(function(value) {
              if (results.hasOwnProperty(key))
                return;
              results[key] = value;
              if (!(--counter))
                deferred.resolve(results);
            }, function(reason) {
              if (results.hasOwnProperty(key))
                return;
              deferred.reject(reason);
            });
          });
          if (counter === 0) {
            deferred.resolve(results);
          }
          return deferred.promise;
        }
        var $Q = function Q(resolver) {
          if (!isFunction(resolver)) {
            throw $qMinErr('norslvr', "Expected resolverFn, got '{0}'", resolver);
          }
          if (!(this instanceof Q)) {
            return new Q(resolver);
          }
          var deferred = new Deferred();
          function resolveFn(value) {
            deferred.resolve(value);
          }
          function rejectFn(reason) {
            deferred.reject(reason);
          }
          resolver(resolveFn, rejectFn);
          return deferred.promise;
        };
        $Q.defer = defer;
        $Q.reject = reject;
        $Q.when = when;
        $Q.resolve = resolve;
        $Q.all = all;
        return $Q;
      }
      function $$RAFProvider() {
        this.$get = ['$window', '$timeout', function($window, $timeout) {
          var requestAnimationFrame = $window.requestAnimationFrame || $window.webkitRequestAnimationFrame;
          var cancelAnimationFrame = $window.cancelAnimationFrame || $window.webkitCancelAnimationFrame || $window.webkitCancelRequestAnimationFrame;
          var rafSupported = !!requestAnimationFrame;
          var raf = rafSupported ? function(fn) {
            var id = requestAnimationFrame(fn);
            return function() {
              cancelAnimationFrame(id);
            };
          } : function(fn) {
            var timer = $timeout(fn, 16.66, false);
            return function() {
              $timeout.cancel(timer);
            };
          };
          raf.supported = rafSupported;
          return raf;
        }];
      }
      function $RootScopeProvider() {
        var TTL = 10;
        var $rootScopeMinErr = minErr('$rootScope');
        var lastDirtyWatch = null;
        var applyAsyncId = null;
        this.digestTtl = function(value) {
          if (arguments.length) {
            TTL = value;
          }
          return TTL;
        };
        function createChildScopeClass(parent) {
          function ChildScope() {
            this.$$watchers = this.$$nextSibling = this.$$childHead = this.$$childTail = null;
            this.$$listeners = {};
            this.$$listenerCount = {};
            this.$$watchersCount = 0;
            this.$id = nextUid();
            this.$$ChildScope = null;
          }
          ChildScope.prototype = parent;
          return ChildScope;
        }
        this.$get = ['$injector', '$exceptionHandler', '$parse', '$browser', function($injector, $exceptionHandler, $parse, $browser) {
          function destroyChildScope($event) {
            $event.currentScope.$$destroyed = true;
          }
          function Scope() {
            this.$id = nextUid();
            this.$$phase = this.$parent = this.$$watchers = this.$$nextSibling = this.$$prevSibling = this.$$childHead = this.$$childTail = null;
            this.$root = this;
            this.$$destroyed = false;
            this.$$listeners = {};
            this.$$listenerCount = {};
            this.$$watchersCount = 0;
            this.$$isolateBindings = null;
          }
          Scope.prototype = {
            constructor: Scope,
            $new: function(isolate, parent) {
              var child;
              parent = parent || this;
              if (isolate) {
                child = new Scope();
                child.$root = this.$root;
              } else {
                if (!this.$$ChildScope) {
                  this.$$ChildScope = createChildScopeClass(this);
                }
                child = new this.$$ChildScope();
              }
              child.$parent = parent;
              child.$$prevSibling = parent.$$childTail;
              if (parent.$$childHead) {
                parent.$$childTail.$$nextSibling = child;
                parent.$$childTail = child;
              } else {
                parent.$$childHead = parent.$$childTail = child;
              }
              if (isolate || parent != this)
                child.$on('$destroy', destroyChildScope);
              return child;
            },
            $watch: function(watchExp, listener, objectEquality, prettyPrintExpression) {
              var get = $parse(watchExp);
              if (get.$$watchDelegate) {
                return get.$$watchDelegate(this, listener, objectEquality, get, watchExp);
              }
              var scope = this,
                  array = scope.$$watchers,
                  watcher = {
                    fn: listener,
                    last: initWatchVal,
                    get: get,
                    exp: prettyPrintExpression || watchExp,
                    eq: !!objectEquality
                  };
              lastDirtyWatch = null;
              if (!isFunction(listener)) {
                watcher.fn = noop;
              }
              if (!array) {
                array = scope.$$watchers = [];
              }
              array.unshift(watcher);
              incrementWatchersCount(this, 1);
              return function deregisterWatch() {
                if (arrayRemove(array, watcher) >= 0) {
                  incrementWatchersCount(scope, -1);
                }
                lastDirtyWatch = null;
              };
            },
            $watchGroup: function(watchExpressions, listener) {
              var oldValues = new Array(watchExpressions.length);
              var newValues = new Array(watchExpressions.length);
              var deregisterFns = [];
              var self = this;
              var changeReactionScheduled = false;
              var firstRun = true;
              if (!watchExpressions.length) {
                var shouldCall = true;
                self.$evalAsync(function() {
                  if (shouldCall)
                    listener(newValues, newValues, self);
                });
                return function deregisterWatchGroup() {
                  shouldCall = false;
                };
              }
              if (watchExpressions.length === 1) {
                return this.$watch(watchExpressions[0], function watchGroupAction(value, oldValue, scope) {
                  newValues[0] = value;
                  oldValues[0] = oldValue;
                  listener(newValues, (value === oldValue) ? newValues : oldValues, scope);
                });
              }
              forEach(watchExpressions, function(expr, i) {
                var unwatchFn = self.$watch(expr, function watchGroupSubAction(value, oldValue) {
                  newValues[i] = value;
                  oldValues[i] = oldValue;
                  if (!changeReactionScheduled) {
                    changeReactionScheduled = true;
                    self.$evalAsync(watchGroupAction);
                  }
                });
                deregisterFns.push(unwatchFn);
              });
              function watchGroupAction() {
                changeReactionScheduled = false;
                if (firstRun) {
                  firstRun = false;
                  listener(newValues, newValues, self);
                } else {
                  listener(newValues, oldValues, self);
                }
              }
              return function deregisterWatchGroup() {
                while (deregisterFns.length) {
                  deregisterFns.shift()();
                }
              };
            },
            $watchCollection: function(obj, listener) {
              $watchCollectionInterceptor.$stateful = true;
              var self = this;
              var newValue;
              var oldValue;
              var veryOldValue;
              var trackVeryOldValue = (listener.length > 1);
              var changeDetected = 0;
              var changeDetector = $parse(obj, $watchCollectionInterceptor);
              var internalArray = [];
              var internalObject = {};
              var initRun = true;
              var oldLength = 0;
              function $watchCollectionInterceptor(_value) {
                newValue = _value;
                var newLength,
                    key,
                    bothNaN,
                    newItem,
                    oldItem;
                if (isUndefined(newValue))
                  return;
                if (!isObject(newValue)) {
                  if (oldValue !== newValue) {
                    oldValue = newValue;
                    changeDetected++;
                  }
                } else if (isArrayLike(newValue)) {
                  if (oldValue !== internalArray) {
                    oldValue = internalArray;
                    oldLength = oldValue.length = 0;
                    changeDetected++;
                  }
                  newLength = newValue.length;
                  if (oldLength !== newLength) {
                    changeDetected++;
                    oldValue.length = oldLength = newLength;
                  }
                  for (var i = 0; i < newLength; i++) {
                    oldItem = oldValue[i];
                    newItem = newValue[i];
                    bothNaN = (oldItem !== oldItem) && (newItem !== newItem);
                    if (!bothNaN && (oldItem !== newItem)) {
                      changeDetected++;
                      oldValue[i] = newItem;
                    }
                  }
                } else {
                  if (oldValue !== internalObject) {
                    oldValue = internalObject = {};
                    oldLength = 0;
                    changeDetected++;
                  }
                  newLength = 0;
                  for (key in newValue) {
                    if (hasOwnProperty.call(newValue, key)) {
                      newLength++;
                      newItem = newValue[key];
                      oldItem = oldValue[key];
                      if (key in oldValue) {
                        bothNaN = (oldItem !== oldItem) && (newItem !== newItem);
                        if (!bothNaN && (oldItem !== newItem)) {
                          changeDetected++;
                          oldValue[key] = newItem;
                        }
                      } else {
                        oldLength++;
                        oldValue[key] = newItem;
                        changeDetected++;
                      }
                    }
                  }
                  if (oldLength > newLength) {
                    changeDetected++;
                    for (key in oldValue) {
                      if (!hasOwnProperty.call(newValue, key)) {
                        oldLength--;
                        delete oldValue[key];
                      }
                    }
                  }
                }
                return changeDetected;
              }
              function $watchCollectionAction() {
                if (initRun) {
                  initRun = false;
                  listener(newValue, newValue, self);
                } else {
                  listener(newValue, veryOldValue, self);
                }
                if (trackVeryOldValue) {
                  if (!isObject(newValue)) {
                    veryOldValue = newValue;
                  } else if (isArrayLike(newValue)) {
                    veryOldValue = new Array(newValue.length);
                    for (var i = 0; i < newValue.length; i++) {
                      veryOldValue[i] = newValue[i];
                    }
                  } else {
                    veryOldValue = {};
                    for (var key in newValue) {
                      if (hasOwnProperty.call(newValue, key)) {
                        veryOldValue[key] = newValue[key];
                      }
                    }
                  }
                }
              }
              return this.$watch(changeDetector, $watchCollectionAction);
            },
            $digest: function() {
              var watch,
                  value,
                  last,
                  watchers,
                  length,
                  dirty,
                  ttl = TTL,
                  next,
                  current,
                  target = this,
                  watchLog = [],
                  logIdx,
                  logMsg,
                  asyncTask;
              beginPhase('$digest');
              $browser.$$checkUrlChange();
              if (this === $rootScope && applyAsyncId !== null) {
                $browser.defer.cancel(applyAsyncId);
                flushApplyAsync();
              }
              lastDirtyWatch = null;
              do {
                dirty = false;
                current = target;
                while (asyncQueue.length) {
                  try {
                    asyncTask = asyncQueue.shift();
                    asyncTask.scope.$eval(asyncTask.expression, asyncTask.locals);
                  } catch (e) {
                    $exceptionHandler(e);
                  }
                  lastDirtyWatch = null;
                }
                traverseScopesLoop: do {
                  if ((watchers = current.$$watchers)) {
                    length = watchers.length;
                    while (length--) {
                      try {
                        watch = watchers[length];
                        if (watch) {
                          if ((value = watch.get(current)) !== (last = watch.last) && !(watch.eq ? equals(value, last) : (typeof value === 'number' && typeof last === 'number' && isNaN(value) && isNaN(last)))) {
                            dirty = true;
                            lastDirtyWatch = watch;
                            watch.last = watch.eq ? copy(value, null) : value;
                            watch.fn(value, ((last === initWatchVal) ? value : last), current);
                            if (ttl < 5) {
                              logIdx = 4 - ttl;
                              if (!watchLog[logIdx])
                                watchLog[logIdx] = [];
                              watchLog[logIdx].push({
                                msg: isFunction(watch.exp) ? 'fn: ' + (watch.exp.name || watch.exp.toString()) : watch.exp,
                                newVal: value,
                                oldVal: last
                              });
                            }
                          } else if (watch === lastDirtyWatch) {
                            dirty = false;
                            break traverseScopesLoop;
                          }
                        }
                      } catch (e) {
                        $exceptionHandler(e);
                      }
                    }
                  }
                  if (!(next = ((current.$$watchersCount && current.$$childHead) || (current !== target && current.$$nextSibling)))) {
                    while (current !== target && !(next = current.$$nextSibling)) {
                      current = current.$parent;
                    }
                  }
                } while ((current = next));
                if ((dirty || asyncQueue.length) && !(ttl--)) {
                  clearPhase();
                  throw $rootScopeMinErr('infdig', '{0} $digest() iterations reached. Aborting!\n' + 'Watchers fired in the last 5 iterations: {1}', TTL, watchLog);
                }
              } while (dirty || asyncQueue.length);
              clearPhase();
              while (postDigestQueue.length) {
                try {
                  postDigestQueue.shift()();
                } catch (e) {
                  $exceptionHandler(e);
                }
              }
            },
            $destroy: function() {
              if (this.$$destroyed)
                return;
              var parent = this.$parent;
              this.$broadcast('$destroy');
              this.$$destroyed = true;
              if (this === $rootScope) {
                $browser.$$applicationDestroyed();
              }
              incrementWatchersCount(this, -this.$$watchersCount);
              for (var eventName in this.$$listenerCount) {
                decrementListenerCount(this, this.$$listenerCount[eventName], eventName);
              }
              if (parent && parent.$$childHead == this)
                parent.$$childHead = this.$$nextSibling;
              if (parent && parent.$$childTail == this)
                parent.$$childTail = this.$$prevSibling;
              if (this.$$prevSibling)
                this.$$prevSibling.$$nextSibling = this.$$nextSibling;
              if (this.$$nextSibling)
                this.$$nextSibling.$$prevSibling = this.$$prevSibling;
              this.$destroy = this.$digest = this.$apply = this.$evalAsync = this.$applyAsync = noop;
              this.$on = this.$watch = this.$watchGroup = function() {
                return noop;
              };
              this.$$listeners = {};
              this.$parent = this.$$nextSibling = this.$$prevSibling = this.$$childHead = this.$$childTail = this.$root = this.$$watchers = null;
            },
            $eval: function(expr, locals) {
              return $parse(expr)(this, locals);
            },
            $evalAsync: function(expr, locals) {
              if (!$rootScope.$$phase && !asyncQueue.length) {
                $browser.defer(function() {
                  if (asyncQueue.length) {
                    $rootScope.$digest();
                  }
                });
              }
              asyncQueue.push({
                scope: this,
                expression: expr,
                locals: locals
              });
            },
            $$postDigest: function(fn) {
              postDigestQueue.push(fn);
            },
            $apply: function(expr) {
              try {
                beginPhase('$apply');
                try {
                  return this.$eval(expr);
                } finally {
                  clearPhase();
                }
              } catch (e) {
                $exceptionHandler(e);
              } finally {
                try {
                  $rootScope.$digest();
                } catch (e) {
                  $exceptionHandler(e);
                  throw e;
                }
              }
            },
            $applyAsync: function(expr) {
              var scope = this;
              expr && applyAsyncQueue.push($applyAsyncExpression);
              scheduleApplyAsync();
              function $applyAsyncExpression() {
                scope.$eval(expr);
              }
            },
            $on: function(name, listener) {
              var namedListeners = this.$$listeners[name];
              if (!namedListeners) {
                this.$$listeners[name] = namedListeners = [];
              }
              namedListeners.push(listener);
              var current = this;
              do {
                if (!current.$$listenerCount[name]) {
                  current.$$listenerCount[name] = 0;
                }
                current.$$listenerCount[name]++;
              } while ((current = current.$parent));
              var self = this;
              return function() {
                var indexOfListener = namedListeners.indexOf(listener);
                if (indexOfListener !== -1) {
                  namedListeners[indexOfListener] = null;
                  decrementListenerCount(self, 1, name);
                }
              };
            },
            $emit: function(name, args) {
              var empty = [],
                  namedListeners,
                  scope = this,
                  stopPropagation = false,
                  event = {
                    name: name,
                    targetScope: scope,
                    stopPropagation: function() {
                      stopPropagation = true;
                    },
                    preventDefault: function() {
                      event.defaultPrevented = true;
                    },
                    defaultPrevented: false
                  },
                  listenerArgs = concat([event], arguments, 1),
                  i,
                  length;
              do {
                namedListeners = scope.$$listeners[name] || empty;
                event.currentScope = scope;
                for (i = 0, length = namedListeners.length; i < length; i++) {
                  if (!namedListeners[i]) {
                    namedListeners.splice(i, 1);
                    i--;
                    length--;
                    continue;
                  }
                  try {
                    namedListeners[i].apply(null, listenerArgs);
                  } catch (e) {
                    $exceptionHandler(e);
                  }
                }
                if (stopPropagation) {
                  event.currentScope = null;
                  return event;
                }
                scope = scope.$parent;
              } while (scope);
              event.currentScope = null;
              return event;
            },
            $broadcast: function(name, args) {
              var target = this,
                  current = target,
                  next = target,
                  event = {
                    name: name,
                    targetScope: target,
                    preventDefault: function() {
                      event.defaultPrevented = true;
                    },
                    defaultPrevented: false
                  };
              if (!target.$$listenerCount[name])
                return event;
              var listenerArgs = concat([event], arguments, 1),
                  listeners,
                  i,
                  length;
              while ((current = next)) {
                event.currentScope = current;
                listeners = current.$$listeners[name] || [];
                for (i = 0, length = listeners.length; i < length; i++) {
                  if (!listeners[i]) {
                    listeners.splice(i, 1);
                    i--;
                    length--;
                    continue;
                  }
                  try {
                    listeners[i].apply(null, listenerArgs);
                  } catch (e) {
                    $exceptionHandler(e);
                  }
                }
                if (!(next = ((current.$$listenerCount[name] && current.$$childHead) || (current !== target && current.$$nextSibling)))) {
                  while (current !== target && !(next = current.$$nextSibling)) {
                    current = current.$parent;
                  }
                }
              }
              event.currentScope = null;
              return event;
            }
          };
          var $rootScope = new Scope();
          var asyncQueue = $rootScope.$$asyncQueue = [];
          var postDigestQueue = $rootScope.$$postDigestQueue = [];
          var applyAsyncQueue = $rootScope.$$applyAsyncQueue = [];
          return $rootScope;
          function beginPhase(phase) {
            if ($rootScope.$$phase) {
              throw $rootScopeMinErr('inprog', '{0} already in progress', $rootScope.$$phase);
            }
            $rootScope.$$phase = phase;
          }
          function clearPhase() {
            $rootScope.$$phase = null;
          }
          function incrementWatchersCount(current, count) {
            do {
              current.$$watchersCount += count;
            } while ((current = current.$parent));
          }
          function decrementListenerCount(current, count, name) {
            do {
              current.$$listenerCount[name] -= count;
              if (current.$$listenerCount[name] === 0) {
                delete current.$$listenerCount[name];
              }
            } while ((current = current.$parent));
          }
          function initWatchVal() {}
          function flushApplyAsync() {
            while (applyAsyncQueue.length) {
              try {
                applyAsyncQueue.shift()();
              } catch (e) {
                $exceptionHandler(e);
              }
            }
            applyAsyncId = null;
          }
          function scheduleApplyAsync() {
            if (applyAsyncId === null) {
              applyAsyncId = $browser.defer(function() {
                $rootScope.$apply(flushApplyAsync);
              });
            }
          }
        }];
      }
      function $$SanitizeUriProvider() {
        var aHrefSanitizationWhitelist = /^\s*(https?|ftp|mailto|tel|file):/,
            imgSrcSanitizationWhitelist = /^\s*((https?|ftp|file|blob):|data:image\/)/;
        this.aHrefSanitizationWhitelist = function(regexp) {
          if (isDefined(regexp)) {
            aHrefSanitizationWhitelist = regexp;
            return this;
          }
          return aHrefSanitizationWhitelist;
        };
        this.imgSrcSanitizationWhitelist = function(regexp) {
          if (isDefined(regexp)) {
            imgSrcSanitizationWhitelist = regexp;
            return this;
          }
          return imgSrcSanitizationWhitelist;
        };
        this.$get = function() {
          return function sanitizeUri(uri, isImage) {
            var regex = isImage ? imgSrcSanitizationWhitelist : aHrefSanitizationWhitelist;
            var normalizedVal;
            normalizedVal = urlResolve(uri).href;
            if (normalizedVal !== '' && !normalizedVal.match(regex)) {
              return 'unsafe:' + normalizedVal;
            }
            return uri;
          };
        };
      }
      var $sceMinErr = minErr('$sce');
      var SCE_CONTEXTS = {
        HTML: 'html',
        CSS: 'css',
        URL: 'url',
        RESOURCE_URL: 'resourceUrl',
        JS: 'js'
      };
      function adjustMatcher(matcher) {
        if (matcher === 'self') {
          return matcher;
        } else if (isString(matcher)) {
          if (matcher.indexOf('***') > -1) {
            throw $sceMinErr('iwcard', 'Illegal sequence *** in string matcher.  String: {0}', matcher);
          }
          matcher = escapeForRegexp(matcher).replace('\\*\\*', '.*').replace('\\*', '[^:/.?&;]*');
          return new RegExp('^' + matcher + '$');
        } else if (isRegExp(matcher)) {
          return new RegExp('^' + matcher.source + '$');
        } else {
          throw $sceMinErr('imatcher', 'Matchers may only be "self", string patterns or RegExp objects');
        }
      }
      function adjustMatchers(matchers) {
        var adjustedMatchers = [];
        if (isDefined(matchers)) {
          forEach(matchers, function(matcher) {
            adjustedMatchers.push(adjustMatcher(matcher));
          });
        }
        return adjustedMatchers;
      }
      function $SceDelegateProvider() {
        this.SCE_CONTEXTS = SCE_CONTEXTS;
        var resourceUrlWhitelist = ['self'],
            resourceUrlBlacklist = [];
        this.resourceUrlWhitelist = function(value) {
          if (arguments.length) {
            resourceUrlWhitelist = adjustMatchers(value);
          }
          return resourceUrlWhitelist;
        };
        this.resourceUrlBlacklist = function(value) {
          if (arguments.length) {
            resourceUrlBlacklist = adjustMatchers(value);
          }
          return resourceUrlBlacklist;
        };
        this.$get = ['$injector', function($injector) {
          var htmlSanitizer = function htmlSanitizer(html) {
            throw $sceMinErr('unsafe', 'Attempting to use an unsafe value in a safe context.');
          };
          if ($injector.has('$sanitize')) {
            htmlSanitizer = $injector.get('$sanitize');
          }
          function matchUrl(matcher, parsedUrl) {
            if (matcher === 'self') {
              return urlIsSameOrigin(parsedUrl);
            } else {
              return !!matcher.exec(parsedUrl.href);
            }
          }
          function isResourceUrlAllowedByPolicy(url) {
            var parsedUrl = urlResolve(url.toString());
            var i,
                n,
                allowed = false;
            for (i = 0, n = resourceUrlWhitelist.length; i < n; i++) {
              if (matchUrl(resourceUrlWhitelist[i], parsedUrl)) {
                allowed = true;
                break;
              }
            }
            if (allowed) {
              for (i = 0, n = resourceUrlBlacklist.length; i < n; i++) {
                if (matchUrl(resourceUrlBlacklist[i], parsedUrl)) {
                  allowed = false;
                  break;
                }
              }
            }
            return allowed;
          }
          function generateHolderType(Base) {
            var holderType = function TrustedValueHolderType(trustedValue) {
              this.$$unwrapTrustedValue = function() {
                return trustedValue;
              };
            };
            if (Base) {
              holderType.prototype = new Base();
            }
            holderType.prototype.valueOf = function sceValueOf() {
              return this.$$unwrapTrustedValue();
            };
            holderType.prototype.toString = function sceToString() {
              return this.$$unwrapTrustedValue().toString();
            };
            return holderType;
          }
          var trustedValueHolderBase = generateHolderType(),
              byType = {};
          byType[SCE_CONTEXTS.HTML] = generateHolderType(trustedValueHolderBase);
          byType[SCE_CONTEXTS.CSS] = generateHolderType(trustedValueHolderBase);
          byType[SCE_CONTEXTS.URL] = generateHolderType(trustedValueHolderBase);
          byType[SCE_CONTEXTS.JS] = generateHolderType(trustedValueHolderBase);
          byType[SCE_CONTEXTS.RESOURCE_URL] = generateHolderType(byType[SCE_CONTEXTS.URL]);
          function trustAs(type, trustedValue) {
            var Constructor = (byType.hasOwnProperty(type) ? byType[type] : null);
            if (!Constructor) {
              throw $sceMinErr('icontext', 'Attempted to trust a value in invalid context. Context: {0}; Value: {1}', type, trustedValue);
            }
            if (trustedValue === null || isUndefined(trustedValue) || trustedValue === '') {
              return trustedValue;
            }
            if (typeof trustedValue !== 'string') {
              throw $sceMinErr('itype', 'Attempted to trust a non-string value in a content requiring a string: Context: {0}', type);
            }
            return new Constructor(trustedValue);
          }
          function valueOf(maybeTrusted) {
            if (maybeTrusted instanceof trustedValueHolderBase) {
              return maybeTrusted.$$unwrapTrustedValue();
            } else {
              return maybeTrusted;
            }
          }
          function getTrusted(type, maybeTrusted) {
            if (maybeTrusted === null || isUndefined(maybeTrusted) || maybeTrusted === '') {
              return maybeTrusted;
            }
            var constructor = (byType.hasOwnProperty(type) ? byType[type] : null);
            if (constructor && maybeTrusted instanceof constructor) {
              return maybeTrusted.$$unwrapTrustedValue();
            }
            if (type === SCE_CONTEXTS.RESOURCE_URL) {
              if (isResourceUrlAllowedByPolicy(maybeTrusted)) {
                return maybeTrusted;
              } else {
                throw $sceMinErr('insecurl', 'Blocked loading resource from url not allowed by $sceDelegate policy.  URL: {0}', maybeTrusted.toString());
              }
            } else if (type === SCE_CONTEXTS.HTML) {
              return htmlSanitizer(maybeTrusted);
            }
            throw $sceMinErr('unsafe', 'Attempting to use an unsafe value in a safe context.');
          }
          return {
            trustAs: trustAs,
            getTrusted: getTrusted,
            valueOf: valueOf
          };
        }];
      }
      function $SceProvider() {
        var enabled = true;
        this.enabled = function(value) {
          if (arguments.length) {
            enabled = !!value;
          }
          return enabled;
        };
        this.$get = ['$parse', '$sceDelegate', function($parse, $sceDelegate) {
          if (enabled && msie < 8) {
            throw $sceMinErr('iequirks', 'Strict Contextual Escaping does not support Internet Explorer version < 11 in quirks ' + 'mode.  You can fix this by adding the text <!doctype html> to the top of your HTML ' + 'document.  See http://docs.angularjs.org/api/ng.$sce for more information.');
          }
          var sce = shallowCopy(SCE_CONTEXTS);
          sce.isEnabled = function() {
            return enabled;
          };
          sce.trustAs = $sceDelegate.trustAs;
          sce.getTrusted = $sceDelegate.getTrusted;
          sce.valueOf = $sceDelegate.valueOf;
          if (!enabled) {
            sce.trustAs = sce.getTrusted = function(type, value) {
              return value;
            };
            sce.valueOf = identity;
          }
          sce.parseAs = function sceParseAs(type, expr) {
            var parsed = $parse(expr);
            if (parsed.literal && parsed.constant) {
              return parsed;
            } else {
              return $parse(expr, function(value) {
                return sce.getTrusted(type, value);
              });
            }
          };
          var parse = sce.parseAs,
              getTrusted = sce.getTrusted,
              trustAs = sce.trustAs;
          forEach(SCE_CONTEXTS, function(enumValue, name) {
            var lName = lowercase(name);
            sce[camelCase("parse_as_" + lName)] = function(expr) {
              return parse(enumValue, expr);
            };
            sce[camelCase("get_trusted_" + lName)] = function(value) {
              return getTrusted(enumValue, value);
            };
            sce[camelCase("trust_as_" + lName)] = function(value) {
              return trustAs(enumValue, value);
            };
          });
          return sce;
        }];
      }
      function $SnifferProvider() {
        this.$get = ['$window', '$document', function($window, $document) {
          var eventSupport = {},
              android = toInt((/android (\d+)/.exec(lowercase(($window.navigator || {}).userAgent)) || [])[1]),
              boxee = /Boxee/i.test(($window.navigator || {}).userAgent),
              document = $document[0] || {},
              vendorPrefix,
              vendorRegex = /^(Moz|webkit|ms)(?=[A-Z])/,
              bodyStyle = document.body && document.body.style,
              transitions = false,
              animations = false,
              match;
          if (bodyStyle) {
            for (var prop in bodyStyle) {
              if (match = vendorRegex.exec(prop)) {
                vendorPrefix = match[0];
                vendorPrefix = vendorPrefix.substr(0, 1).toUpperCase() + vendorPrefix.substr(1);
                break;
              }
            }
            if (!vendorPrefix) {
              vendorPrefix = ('WebkitOpacity' in bodyStyle) && 'webkit';
            }
            transitions = !!(('transition' in bodyStyle) || (vendorPrefix + 'Transition' in bodyStyle));
            animations = !!(('animation' in bodyStyle) || (vendorPrefix + 'Animation' in bodyStyle));
            if (android && (!transitions || !animations)) {
              transitions = isString(bodyStyle.webkitTransition);
              animations = isString(bodyStyle.webkitAnimation);
            }
          }
          return {
            history: !!($window.history && $window.history.pushState && !(android < 4) && !boxee),
            hasEvent: function(event) {
              if (event === 'input' && msie <= 11)
                return false;
              if (isUndefined(eventSupport[event])) {
                var divElm = document.createElement('div');
                eventSupport[event] = 'on' + event in divElm;
              }
              return eventSupport[event];
            },
            csp: csp(),
            vendorPrefix: vendorPrefix,
            transitions: transitions,
            animations: animations,
            android: android
          };
        }];
      }
      var $compileMinErr = minErr('$compile');
      function $TemplateRequestProvider() {
        this.$get = ['$templateCache', '$http', '$q', '$sce', function($templateCache, $http, $q, $sce) {
          function handleRequestFn(tpl, ignoreRequestError) {
            handleRequestFn.totalPendingRequests++;
            if (!isString(tpl) || !$templateCache.get(tpl)) {
              tpl = $sce.getTrustedResourceUrl(tpl);
            }
            var transformResponse = $http.defaults && $http.defaults.transformResponse;
            if (isArray(transformResponse)) {
              transformResponse = transformResponse.filter(function(transformer) {
                return transformer !== defaultHttpResponseTransform;
              });
            } else if (transformResponse === defaultHttpResponseTransform) {
              transformResponse = null;
            }
            var httpOptions = {
              cache: $templateCache,
              transformResponse: transformResponse
            };
            return $http.get(tpl, httpOptions)['finally'](function() {
              handleRequestFn.totalPendingRequests--;
            }).then(function(response) {
              $templateCache.put(tpl, response.data);
              return response.data;
            }, handleError);
            function handleError(resp) {
              if (!ignoreRequestError) {
                throw $compileMinErr('tpload', 'Failed to load template: {0} (HTTP status: {1} {2})', tpl, resp.status, resp.statusText);
              }
              return $q.reject(resp);
            }
          }
          handleRequestFn.totalPendingRequests = 0;
          return handleRequestFn;
        }];
      }
      function $$TestabilityProvider() {
        this.$get = ['$rootScope', '$browser', '$location', function($rootScope, $browser, $location) {
          var testability = {};
          testability.findBindings = function(element, expression, opt_exactMatch) {
            var bindings = element.getElementsByClassName('ng-binding');
            var matches = [];
            forEach(bindings, function(binding) {
              var dataBinding = angular.element(binding).data('$binding');
              if (dataBinding) {
                forEach(dataBinding, function(bindingName) {
                  if (opt_exactMatch) {
                    var matcher = new RegExp('(^|\\s)' + escapeForRegexp(expression) + '(\\s|\\||$)');
                    if (matcher.test(bindingName)) {
                      matches.push(binding);
                    }
                  } else {
                    if (bindingName.indexOf(expression) != -1) {
                      matches.push(binding);
                    }
                  }
                });
              }
            });
            return matches;
          };
          testability.findModels = function(element, expression, opt_exactMatch) {
            var prefixes = ['ng-', 'data-ng-', 'ng\\:'];
            for (var p = 0; p < prefixes.length; ++p) {
              var attributeEquals = opt_exactMatch ? '=' : '*=';
              var selector = '[' + prefixes[p] + 'model' + attributeEquals + '"' + expression + '"]';
              var elements = element.querySelectorAll(selector);
              if (elements.length) {
                return elements;
              }
            }
          };
          testability.getLocation = function() {
            return $location.url();
          };
          testability.setLocation = function(url) {
            if (url !== $location.url()) {
              $location.url(url);
              $rootScope.$digest();
            }
          };
          testability.whenStable = function(callback) {
            $browser.notifyWhenNoOutstandingRequests(callback);
          };
          return testability;
        }];
      }
      function $TimeoutProvider() {
        this.$get = ['$rootScope', '$browser', '$q', '$$q', '$exceptionHandler', function($rootScope, $browser, $q, $$q, $exceptionHandler) {
          var deferreds = {};
          function timeout(fn, delay, invokeApply) {
            if (!isFunction(fn)) {
              invokeApply = delay;
              delay = fn;
              fn = noop;
            }
            var args = sliceArgs(arguments, 3),
                skipApply = (isDefined(invokeApply) && !invokeApply),
                deferred = (skipApply ? $$q : $q).defer(),
                promise = deferred.promise,
                timeoutId;
            timeoutId = $browser.defer(function() {
              try {
                deferred.resolve(fn.apply(null, args));
              } catch (e) {
                deferred.reject(e);
                $exceptionHandler(e);
              } finally {
                delete deferreds[promise.$$timeoutId];
              }
              if (!skipApply)
                $rootScope.$apply();
            }, delay);
            promise.$$timeoutId = timeoutId;
            deferreds[timeoutId] = deferred;
            return promise;
          }
          timeout.cancel = function(promise) {
            if (promise && promise.$$timeoutId in deferreds) {
              deferreds[promise.$$timeoutId].reject('canceled');
              delete deferreds[promise.$$timeoutId];
              return $browser.defer.cancel(promise.$$timeoutId);
            }
            return false;
          };
          return timeout;
        }];
      }
      var urlParsingNode = document.createElement("a");
      var originUrl = urlResolve(window.location.href);
      function urlResolve(url) {
        var href = url;
        if (msie) {
          urlParsingNode.setAttribute("href", href);
          href = urlParsingNode.href;
        }
        urlParsingNode.setAttribute('href', href);
        return {
          href: urlParsingNode.href,
          protocol: urlParsingNode.protocol ? urlParsingNode.protocol.replace(/:$/, '') : '',
          host: urlParsingNode.host,
          search: urlParsingNode.search ? urlParsingNode.search.replace(/^\?/, '') : '',
          hash: urlParsingNode.hash ? urlParsingNode.hash.replace(/^#/, '') : '',
          hostname: urlParsingNode.hostname,
          port: urlParsingNode.port,
          pathname: (urlParsingNode.pathname.charAt(0) === '/') ? urlParsingNode.pathname : '/' + urlParsingNode.pathname
        };
      }
      function urlIsSameOrigin(requestUrl) {
        var parsed = (isString(requestUrl)) ? urlResolve(requestUrl) : requestUrl;
        return (parsed.protocol === originUrl.protocol && parsed.host === originUrl.host);
      }
      function $WindowProvider() {
        this.$get = valueFn(window);
      }
      function $$CookieReader($document) {
        var rawDocument = $document[0] || {};
        var lastCookies = {};
        var lastCookieString = '';
        function safeDecodeURIComponent(str) {
          try {
            return decodeURIComponent(str);
          } catch (e) {
            return str;
          }
        }
        return function() {
          var cookieArray,
              cookie,
              i,
              index,
              name;
          var currentCookieString = rawDocument.cookie || '';
          if (currentCookieString !== lastCookieString) {
            lastCookieString = currentCookieString;
            cookieArray = lastCookieString.split('; ');
            lastCookies = {};
            for (i = 0; i < cookieArray.length; i++) {
              cookie = cookieArray[i];
              index = cookie.indexOf('=');
              if (index > 0) {
                name = safeDecodeURIComponent(cookie.substring(0, index));
                if (isUndefined(lastCookies[name])) {
                  lastCookies[name] = safeDecodeURIComponent(cookie.substring(index + 1));
                }
              }
            }
          }
          return lastCookies;
        };
      }
      $$CookieReader.$inject = ['$document'];
      function $$CookieReaderProvider() {
        this.$get = $$CookieReader;
      }
      $FilterProvider.$inject = ['$provide'];
      function $FilterProvider($provide) {
        var suffix = 'Filter';
        function register(name, factory) {
          if (isObject(name)) {
            var filters = {};
            forEach(name, function(filter, key) {
              filters[key] = register(key, filter);
            });
            return filters;
          } else {
            return $provide.factory(name + suffix, factory);
          }
        }
        this.register = register;
        this.$get = ['$injector', function($injector) {
          return function(name) {
            return $injector.get(name + suffix);
          };
        }];
        register('currency', currencyFilter);
        register('date', dateFilter);
        register('filter', filterFilter);
        register('json', jsonFilter);
        register('limitTo', limitToFilter);
        register('lowercase', lowercaseFilter);
        register('number', numberFilter);
        register('orderBy', orderByFilter);
        register('uppercase', uppercaseFilter);
      }
      function filterFilter() {
        return function(array, expression, comparator) {
          if (!isArrayLike(array)) {
            if (array == null) {
              return array;
            } else {
              throw minErr('filter')('notarray', 'Expected array but received: {0}', array);
            }
          }
          var expressionType = getTypeForFilter(expression);
          var predicateFn;
          var matchAgainstAnyProp;
          switch (expressionType) {
            case 'function':
              predicateFn = expression;
              break;
            case 'boolean':
            case 'null':
            case 'number':
            case 'string':
              matchAgainstAnyProp = true;
            case 'object':
              predicateFn = createPredicateFn(expression, comparator, matchAgainstAnyProp);
              break;
            default:
              return array;
          }
          return Array.prototype.filter.call(array, predicateFn);
        };
      }
      function createPredicateFn(expression, comparator, matchAgainstAnyProp) {
        var shouldMatchPrimitives = isObject(expression) && ('$' in expression);
        var predicateFn;
        if (comparator === true) {
          comparator = equals;
        } else if (!isFunction(comparator)) {
          comparator = function(actual, expected) {
            if (isUndefined(actual)) {
              return false;
            }
            if ((actual === null) || (expected === null)) {
              return actual === expected;
            }
            if (isObject(expected) || (isObject(actual) && !hasCustomToString(actual))) {
              return false;
            }
            actual = lowercase('' + actual);
            expected = lowercase('' + expected);
            return actual.indexOf(expected) !== -1;
          };
        }
        predicateFn = function(item) {
          if (shouldMatchPrimitives && !isObject(item)) {
            return deepCompare(item, expression.$, comparator, false);
          }
          return deepCompare(item, expression, comparator, matchAgainstAnyProp);
        };
        return predicateFn;
      }
      function deepCompare(actual, expected, comparator, matchAgainstAnyProp, dontMatchWholeObject) {
        var actualType = getTypeForFilter(actual);
        var expectedType = getTypeForFilter(expected);
        if ((expectedType === 'string') && (expected.charAt(0) === '!')) {
          return !deepCompare(actual, expected.substring(1), comparator, matchAgainstAnyProp);
        } else if (isArray(actual)) {
          return actual.some(function(item) {
            return deepCompare(item, expected, comparator, matchAgainstAnyProp);
          });
        }
        switch (actualType) {
          case 'object':
            var key;
            if (matchAgainstAnyProp) {
              for (key in actual) {
                if ((key.charAt(0) !== '$') && deepCompare(actual[key], expected, comparator, true)) {
                  return true;
                }
              }
              return dontMatchWholeObject ? false : deepCompare(actual, expected, comparator, false);
            } else if (expectedType === 'object') {
              for (key in expected) {
                var expectedVal = expected[key];
                if (isFunction(expectedVal) || isUndefined(expectedVal)) {
                  continue;
                }
                var matchAnyProperty = key === '$';
                var actualVal = matchAnyProperty ? actual : actual[key];
                if (!deepCompare(actualVal, expectedVal, comparator, matchAnyProperty, matchAnyProperty)) {
                  return false;
                }
              }
              return true;
            } else {
              return comparator(actual, expected);
            }
            break;
          case 'function':
            return false;
          default:
            return comparator(actual, expected);
        }
      }
      function getTypeForFilter(val) {
        return (val === null) ? 'null' : typeof val;
      }
      currencyFilter.$inject = ['$locale'];
      function currencyFilter($locale) {
        var formats = $locale.NUMBER_FORMATS;
        return function(amount, currencySymbol, fractionSize) {
          if (isUndefined(currencySymbol)) {
            currencySymbol = formats.CURRENCY_SYM;
          }
          if (isUndefined(fractionSize)) {
            fractionSize = formats.PATTERNS[1].maxFrac;
          }
          return (amount == null) ? amount : formatNumber(amount, formats.PATTERNS[1], formats.GROUP_SEP, formats.DECIMAL_SEP, fractionSize).replace(/\u00A4/g, currencySymbol);
        };
      }
      numberFilter.$inject = ['$locale'];
      function numberFilter($locale) {
        var formats = $locale.NUMBER_FORMATS;
        return function(number, fractionSize) {
          return (number == null) ? number : formatNumber(number, formats.PATTERNS[0], formats.GROUP_SEP, formats.DECIMAL_SEP, fractionSize);
        };
      }
      var DECIMAL_SEP = '.';
      function formatNumber(number, pattern, groupSep, decimalSep, fractionSize) {
        if (isObject(number))
          return '';
        var isNegative = number < 0;
        number = Math.abs(number);
        var isInfinity = number === Infinity;
        if (!isInfinity && !isFinite(number))
          return '';
        var numStr = number + '',
            formatedText = '',
            hasExponent = false,
            parts = [];
        if (isInfinity)
          formatedText = '\u221e';
        if (!isInfinity && numStr.indexOf('e') !== -1) {
          var match = numStr.match(/([\d\.]+)e(-?)(\d+)/);
          if (match && match[2] == '-' && match[3] > fractionSize + 1) {
            number = 0;
          } else {
            formatedText = numStr;
            hasExponent = true;
          }
        }
        if (!isInfinity && !hasExponent) {
          var fractionLen = (numStr.split(DECIMAL_SEP)[1] || '').length;
          if (isUndefined(fractionSize)) {
            fractionSize = Math.min(Math.max(pattern.minFrac, fractionLen), pattern.maxFrac);
          }
          number = +(Math.round(+(number.toString() + 'e' + fractionSize)).toString() + 'e' + -fractionSize);
          var fraction = ('' + number).split(DECIMAL_SEP);
          var whole = fraction[0];
          fraction = fraction[1] || '';
          var i,
              pos = 0,
              lgroup = pattern.lgSize,
              group = pattern.gSize;
          if (whole.length >= (lgroup + group)) {
            pos = whole.length - lgroup;
            for (i = 0; i < pos; i++) {
              if ((pos - i) % group === 0 && i !== 0) {
                formatedText += groupSep;
              }
              formatedText += whole.charAt(i);
            }
          }
          for (i = pos; i < whole.length; i++) {
            if ((whole.length - i) % lgroup === 0 && i !== 0) {
              formatedText += groupSep;
            }
            formatedText += whole.charAt(i);
          }
          while (fraction.length < fractionSize) {
            fraction += '0';
          }
          if (fractionSize && fractionSize !== "0")
            formatedText += decimalSep + fraction.substr(0, fractionSize);
        } else {
          if (fractionSize > 0 && number < 1) {
            formatedText = number.toFixed(fractionSize);
            number = parseFloat(formatedText);
          }
        }
        if (number === 0) {
          isNegative = false;
        }
        parts.push(isNegative ? pattern.negPre : pattern.posPre, formatedText, isNegative ? pattern.negSuf : pattern.posSuf);
        return parts.join('');
      }
      function padNumber(num, digits, trim) {
        var neg = '';
        if (num < 0) {
          neg = '-';
          num = -num;
        }
        num = '' + num;
        while (num.length < digits)
          num = '0' + num;
        if (trim) {
          num = num.substr(num.length - digits);
        }
        return neg + num;
      }
      function dateGetter(name, size, offset, trim) {
        offset = offset || 0;
        return function(date) {
          var value = date['get' + name]();
          if (offset > 0 || value > -offset) {
            value += offset;
          }
          if (value === 0 && offset == -12)
            value = 12;
          return padNumber(value, size, trim);
        };
      }
      function dateStrGetter(name, shortForm) {
        return function(date, formats) {
          var value = date['get' + name]();
          var get = uppercase(shortForm ? ('SHORT' + name) : name);
          return formats[get][value];
        };
      }
      function timeZoneGetter(date, formats, offset) {
        var zone = -1 * offset;
        var paddedZone = (zone >= 0) ? "+" : "";
        paddedZone += padNumber(Math[zone > 0 ? 'floor' : 'ceil'](zone / 60), 2) + padNumber(Math.abs(zone % 60), 2);
        return paddedZone;
      }
      function getFirstThursdayOfYear(year) {
        var dayOfWeekOnFirst = (new Date(year, 0, 1)).getDay();
        return new Date(year, 0, ((dayOfWeekOnFirst <= 4) ? 5 : 12) - dayOfWeekOnFirst);
      }
      function getThursdayThisWeek(datetime) {
        return new Date(datetime.getFullYear(), datetime.getMonth(), datetime.getDate() + (4 - datetime.getDay()));
      }
      function weekGetter(size) {
        return function(date) {
          var firstThurs = getFirstThursdayOfYear(date.getFullYear()),
              thisThurs = getThursdayThisWeek(date);
          var diff = +thisThurs - +firstThurs,
              result = 1 + Math.round(diff / 6.048e8);
          return padNumber(result, size);
        };
      }
      function ampmGetter(date, formats) {
        return date.getHours() < 12 ? formats.AMPMS[0] : formats.AMPMS[1];
      }
      function eraGetter(date, formats) {
        return date.getFullYear() <= 0 ? formats.ERAS[0] : formats.ERAS[1];
      }
      function longEraGetter(date, formats) {
        return date.getFullYear() <= 0 ? formats.ERANAMES[0] : formats.ERANAMES[1];
      }
      var DATE_FORMATS = {
        yyyy: dateGetter('FullYear', 4),
        yy: dateGetter('FullYear', 2, 0, true),
        y: dateGetter('FullYear', 1),
        MMMM: dateStrGetter('Month'),
        MMM: dateStrGetter('Month', true),
        MM: dateGetter('Month', 2, 1),
        M: dateGetter('Month', 1, 1),
        dd: dateGetter('Date', 2),
        d: dateGetter('Date', 1),
        HH: dateGetter('Hours', 2),
        H: dateGetter('Hours', 1),
        hh: dateGetter('Hours', 2, -12),
        h: dateGetter('Hours', 1, -12),
        mm: dateGetter('Minutes', 2),
        m: dateGetter('Minutes', 1),
        ss: dateGetter('Seconds', 2),
        s: dateGetter('Seconds', 1),
        sss: dateGetter('Milliseconds', 3),
        EEEE: dateStrGetter('Day'),
        EEE: dateStrGetter('Day', true),
        a: ampmGetter,
        Z: timeZoneGetter,
        ww: weekGetter(2),
        w: weekGetter(1),
        G: eraGetter,
        GG: eraGetter,
        GGG: eraGetter,
        GGGG: longEraGetter
      };
      var DATE_FORMATS_SPLIT = /((?:[^yMdHhmsaZEwG']+)|(?:'(?:[^']|'')*')|(?:E+|y+|M+|d+|H+|h+|m+|s+|a|Z|G+|w+))(.*)/,
          NUMBER_STRING = /^\-?\d+$/;
      dateFilter.$inject = ['$locale'];
      function dateFilter($locale) {
        var R_ISO8601_STR = /^(\d{4})-?(\d\d)-?(\d\d)(?:T(\d\d)(?::?(\d\d)(?::?(\d\d)(?:\.(\d+))?)?)?(Z|([+-])(\d\d):?(\d\d))?)?$/;
        function jsonStringToDate(string) {
          var match;
          if (match = string.match(R_ISO8601_STR)) {
            var date = new Date(0),
                tzHour = 0,
                tzMin = 0,
                dateSetter = match[8] ? date.setUTCFullYear : date.setFullYear,
                timeSetter = match[8] ? date.setUTCHours : date.setHours;
            if (match[9]) {
              tzHour = toInt(match[9] + match[10]);
              tzMin = toInt(match[9] + match[11]);
            }
            dateSetter.call(date, toInt(match[1]), toInt(match[2]) - 1, toInt(match[3]));
            var h = toInt(match[4] || 0) - tzHour;
            var m = toInt(match[5] || 0) - tzMin;
            var s = toInt(match[6] || 0);
            var ms = Math.round(parseFloat('0.' + (match[7] || 0)) * 1000);
            timeSetter.call(date, h, m, s, ms);
            return date;
          }
          return string;
        }
        return function(date, format, timezone) {
          var text = '',
              parts = [],
              fn,
              match;
          format = format || 'mediumDate';
          format = $locale.DATETIME_FORMATS[format] || format;
          if (isString(date)) {
            date = NUMBER_STRING.test(date) ? toInt(date) : jsonStringToDate(date);
          }
          if (isNumber(date)) {
            date = new Date(date);
          }
          if (!isDate(date) || !isFinite(date.getTime())) {
            return date;
          }
          while (format) {
            match = DATE_FORMATS_SPLIT.exec(format);
            if (match) {
              parts = concat(parts, match, 1);
              format = parts.pop();
            } else {
              parts.push(format);
              format = null;
            }
          }
          var dateTimezoneOffset = date.getTimezoneOffset();
          if (timezone) {
            dateTimezoneOffset = timezoneToOffset(timezone, date.getTimezoneOffset());
            date = convertTimezoneToLocal(date, timezone, true);
          }
          forEach(parts, function(value) {
            fn = DATE_FORMATS[value];
            text += fn ? fn(date, $locale.DATETIME_FORMATS, dateTimezoneOffset) : value.replace(/(^'|'$)/g, '').replace(/''/g, "'");
          });
          return text;
        };
      }
      function jsonFilter() {
        return function(object, spacing) {
          if (isUndefined(spacing)) {
            spacing = 2;
          }
          return toJson(object, spacing);
        };
      }
      var lowercaseFilter = valueFn(lowercase);
      var uppercaseFilter = valueFn(uppercase);
      function limitToFilter() {
        return function(input, limit, begin) {
          if (Math.abs(Number(limit)) === Infinity) {
            limit = Number(limit);
          } else {
            limit = toInt(limit);
          }
          if (isNaN(limit))
            return input;
          if (isNumber(input))
            input = input.toString();
          if (!isArray(input) && !isString(input))
            return input;
          begin = (!begin || isNaN(begin)) ? 0 : toInt(begin);
          begin = (begin < 0 && begin >= -input.length) ? input.length + begin : begin;
          if (limit >= 0) {
            return input.slice(begin, begin + limit);
          } else {
            if (begin === 0) {
              return input.slice(limit, input.length);
            } else {
              return input.slice(Math.max(0, begin + limit), begin);
            }
          }
        };
      }
      orderByFilter.$inject = ['$parse'];
      function orderByFilter($parse) {
        return function(array, sortPredicate, reverseOrder) {
          if (!(isArrayLike(array)))
            return array;
          if (!isArray(sortPredicate)) {
            sortPredicate = [sortPredicate];
          }
          if (sortPredicate.length === 0) {
            sortPredicate = ['+'];
          }
          var predicates = processPredicates(sortPredicate, reverseOrder);
          predicates.push({
            get: function() {
              return {};
            },
            descending: reverseOrder ? -1 : 1
          });
          var compareValues = Array.prototype.map.call(array, getComparisonObject);
          compareValues.sort(doComparison);
          array = compareValues.map(function(item) {
            return item.value;
          });
          return array;
          function getComparisonObject(value, index) {
            return {
              value: value,
              predicateValues: predicates.map(function(predicate) {
                return getPredicateValue(predicate.get(value), index);
              })
            };
          }
          function doComparison(v1, v2) {
            var result = 0;
            for (var index = 0,
                length = predicates.length; index < length; ++index) {
              result = compare(v1.predicateValues[index], v2.predicateValues[index]) * predicates[index].descending;
              if (result)
                break;
            }
            return result;
          }
        };
        function processPredicates(sortPredicate, reverseOrder) {
          reverseOrder = reverseOrder ? -1 : 1;
          return sortPredicate.map(function(predicate) {
            var descending = 1,
                get = identity;
            if (isFunction(predicate)) {
              get = predicate;
            } else if (isString(predicate)) {
              if ((predicate.charAt(0) == '+' || predicate.charAt(0) == '-')) {
                descending = predicate.charAt(0) == '-' ? -1 : 1;
                predicate = predicate.substring(1);
              }
              if (predicate !== '') {
                get = $parse(predicate);
                if (get.constant) {
                  var key = get();
                  get = function(value) {
                    return value[key];
                  };
                }
              }
            }
            return {
              get: get,
              descending: descending * reverseOrder
            };
          });
        }
        function isPrimitive(value) {
          switch (typeof value) {
            case 'number':
            case 'boolean':
            case 'string':
              return true;
            default:
              return false;
          }
        }
        function objectValue(value, index) {
          if (typeof value.valueOf === 'function') {
            value = value.valueOf();
            if (isPrimitive(value))
              return value;
          }
          if (hasCustomToString(value)) {
            value = value.toString();
            if (isPrimitive(value))
              return value;
          }
          return index;
        }
        function getPredicateValue(value, index) {
          var type = typeof value;
          if (value === null) {
            type = 'string';
            value = 'null';
          } else if (type === 'string') {
            value = value.toLowerCase();
          } else if (type === 'object') {
            value = objectValue(value, index);
          }
          return {
            value: value,
            type: type
          };
        }
        function compare(v1, v2) {
          var result = 0;
          if (v1.type === v2.type) {
            if (v1.value !== v2.value) {
              result = v1.value < v2.value ? -1 : 1;
            }
          } else {
            result = v1.type < v2.type ? -1 : 1;
          }
          return result;
        }
      }
      function ngDirective(directive) {
        if (isFunction(directive)) {
          directive = {link: directive};
        }
        directive.restrict = directive.restrict || 'AC';
        return valueFn(directive);
      }
      var htmlAnchorDirective = valueFn({
        restrict: 'E',
        compile: function(element, attr) {
          if (!attr.href && !attr.xlinkHref) {
            return function(scope, element) {
              if (element[0].nodeName.toLowerCase() !== 'a')
                return;
              var href = toString.call(element.prop('href')) === '[object SVGAnimatedString]' ? 'xlink:href' : 'href';
              element.on('click', function(event) {
                if (!element.attr(href)) {
                  event.preventDefault();
                }
              });
            };
          }
        }
      });
      var ngAttributeAliasDirectives = {};
      forEach(BOOLEAN_ATTR, function(propName, attrName) {
        if (propName == "multiple")
          return;
        function defaultLinkFn(scope, element, attr) {
          scope.$watch(attr[normalized], function ngBooleanAttrWatchAction(value) {
            attr.$set(attrName, !!value);
          });
        }
        var normalized = directiveNormalize('ng-' + attrName);
        var linkFn = defaultLinkFn;
        if (propName === 'checked') {
          linkFn = function(scope, element, attr) {
            if (attr.ngModel !== attr[normalized]) {
              defaultLinkFn(scope, element, attr);
            }
          };
        }
        ngAttributeAliasDirectives[normalized] = function() {
          return {
            restrict: 'A',
            priority: 100,
            link: linkFn
          };
        };
      });
      forEach(ALIASED_ATTR, function(htmlAttr, ngAttr) {
        ngAttributeAliasDirectives[ngAttr] = function() {
          return {
            priority: 100,
            link: function(scope, element, attr) {
              if (ngAttr === "ngPattern" && attr.ngPattern.charAt(0) == "/") {
                var match = attr.ngPattern.match(REGEX_STRING_REGEXP);
                if (match) {
                  attr.$set("ngPattern", new RegExp(match[1], match[2]));
                  return;
                }
              }
              scope.$watch(attr[ngAttr], function ngAttrAliasWatchAction(value) {
                attr.$set(ngAttr, value);
              });
            }
          };
        };
      });
      forEach(['src', 'srcset', 'href'], function(attrName) {
        var normalized = directiveNormalize('ng-' + attrName);
        ngAttributeAliasDirectives[normalized] = function() {
          return {
            priority: 99,
            link: function(scope, element, attr) {
              var propName = attrName,
                  name = attrName;
              if (attrName === 'href' && toString.call(element.prop('href')) === '[object SVGAnimatedString]') {
                name = 'xlinkHref';
                attr.$attr[name] = 'xlink:href';
                propName = null;
              }
              attr.$observe(normalized, function(value) {
                if (!value) {
                  if (attrName === 'href') {
                    attr.$set(name, null);
                  }
                  return;
                }
                attr.$set(name, value);
                if (msie && propName)
                  element.prop(propName, attr[name]);
              });
            }
          };
        };
      });
      var nullFormCtrl = {
        $addControl: noop,
        $$renameControl: nullFormRenameControl,
        $removeControl: noop,
        $setValidity: noop,
        $setDirty: noop,
        $setPristine: noop,
        $setSubmitted: noop
      },
          SUBMITTED_CLASS = 'ng-submitted';
      function nullFormRenameControl(control, name) {
        control.$name = name;
      }
      FormController.$inject = ['$element', '$attrs', '$scope', '$animate', '$interpolate'];
      function FormController(element, attrs, $scope, $animate, $interpolate) {
        var form = this,
            controls = [];
        form.$error = {};
        form.$$success = {};
        form.$pending = undefined;
        form.$name = $interpolate(attrs.name || attrs.ngForm || '')($scope);
        form.$dirty = false;
        form.$pristine = true;
        form.$valid = true;
        form.$invalid = false;
        form.$submitted = false;
        form.$$parentForm = nullFormCtrl;
        form.$rollbackViewValue = function() {
          forEach(controls, function(control) {
            control.$rollbackViewValue();
          });
        };
        form.$commitViewValue = function() {
          forEach(controls, function(control) {
            control.$commitViewValue();
          });
        };
        form.$addControl = function(control) {
          assertNotHasOwnProperty(control.$name, 'input');
          controls.push(control);
          if (control.$name) {
            form[control.$name] = control;
          }
          control.$$parentForm = form;
        };
        form.$$renameControl = function(control, newName) {
          var oldName = control.$name;
          if (form[oldName] === control) {
            delete form[oldName];
          }
          form[newName] = control;
          control.$name = newName;
        };
        form.$removeControl = function(control) {
          if (control.$name && form[control.$name] === control) {
            delete form[control.$name];
          }
          forEach(form.$pending, function(value, name) {
            form.$setValidity(name, null, control);
          });
          forEach(form.$error, function(value, name) {
            form.$setValidity(name, null, control);
          });
          forEach(form.$$success, function(value, name) {
            form.$setValidity(name, null, control);
          });
          arrayRemove(controls, control);
          control.$$parentForm = nullFormCtrl;
        };
        addSetValidityMethod({
          ctrl: this,
          $element: element,
          set: function(object, property, controller) {
            var list = object[property];
            if (!list) {
              object[property] = [controller];
            } else {
              var index = list.indexOf(controller);
              if (index === -1) {
                list.push(controller);
              }
            }
          },
          unset: function(object, property, controller) {
            var list = object[property];
            if (!list) {
              return;
            }
            arrayRemove(list, controller);
            if (list.length === 0) {
              delete object[property];
            }
          },
          $animate: $animate
        });
        form.$setDirty = function() {
          $animate.removeClass(element, PRISTINE_CLASS);
          $animate.addClass(element, DIRTY_CLASS);
          form.$dirty = true;
          form.$pristine = false;
          form.$$parentForm.$setDirty();
        };
        form.$setPristine = function() {
          $animate.setClass(element, PRISTINE_CLASS, DIRTY_CLASS + ' ' + SUBMITTED_CLASS);
          form.$dirty = false;
          form.$pristine = true;
          form.$submitted = false;
          forEach(controls, function(control) {
            control.$setPristine();
          });
        };
        form.$setUntouched = function() {
          forEach(controls, function(control) {
            control.$setUntouched();
          });
        };
        form.$setSubmitted = function() {
          $animate.addClass(element, SUBMITTED_CLASS);
          form.$submitted = true;
          form.$$parentForm.$setSubmitted();
        };
      }
      var formDirectiveFactory = function(isNgForm) {
        return ['$timeout', '$parse', function($timeout, $parse) {
          var formDirective = {
            name: 'form',
            restrict: isNgForm ? 'EAC' : 'E',
            require: ['form', '^^?form'],
            controller: FormController,
            compile: function ngFormCompile(formElement, attr) {
              formElement.addClass(PRISTINE_CLASS).addClass(VALID_CLASS);
              var nameAttr = attr.name ? 'name' : (isNgForm && attr.ngForm ? 'ngForm' : false);
              return {pre: function ngFormPreLink(scope, formElement, attr, ctrls) {
                  var controller = ctrls[0];
                  if (!('action' in attr)) {
                    var handleFormSubmission = function(event) {
                      scope.$apply(function() {
                        controller.$commitViewValue();
                        controller.$setSubmitted();
                      });
                      event.preventDefault();
                    };
                    addEventListenerFn(formElement[0], 'submit', handleFormSubmission);
                    formElement.on('$destroy', function() {
                      $timeout(function() {
                        removeEventListenerFn(formElement[0], 'submit', handleFormSubmission);
                      }, 0, false);
                    });
                  }
                  var parentFormCtrl = ctrls[1] || controller.$$parentForm;
                  parentFormCtrl.$addControl(controller);
                  var setter = nameAttr ? getSetter(controller.$name) : noop;
                  if (nameAttr) {
                    setter(scope, controller);
                    attr.$observe(nameAttr, function(newValue) {
                      if (controller.$name === newValue)
                        return;
                      setter(scope, undefined);
                      controller.$$parentForm.$$renameControl(controller, newValue);
                      setter = getSetter(controller.$name);
                      setter(scope, controller);
                    });
                  }
                  formElement.on('$destroy', function() {
                    controller.$$parentForm.$removeControl(controller);
                    setter(scope, undefined);
                    extend(controller, nullFormCtrl);
                  });
                }};
            }
          };
          return formDirective;
          function getSetter(expression) {
            if (expression === '') {
              return $parse('this[""]').assign;
            }
            return $parse(expression).assign || noop;
          }
        }];
      };
      var formDirective = formDirectiveFactory();
      var ngFormDirective = formDirectiveFactory(true);
      var ISO_DATE_REGEXP = /\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z)/;
      var URL_REGEXP = /^(ftp|http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?$/;
      var EMAIL_REGEXP = /^[a-z0-9!#$%&'*+\/=?^_`{|}~.-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
      var NUMBER_REGEXP = /^\s*(\-|\+)?(\d+|(\d*(\.\d*)))([eE][+-]?\d+)?\s*$/;
      var DATE_REGEXP = /^(\d{4})-(\d{2})-(\d{2})$/;
      var DATETIMELOCAL_REGEXP = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(\.\d{1,3})?)?$/;
      var WEEK_REGEXP = /^(\d{4})-W(\d\d)$/;
      var MONTH_REGEXP = /^(\d{4})-(\d\d)$/;
      var TIME_REGEXP = /^(\d\d):(\d\d)(?::(\d\d)(\.\d{1,3})?)?$/;
      var inputType = {
        'text': textInputType,
        'date': createDateInputType('date', DATE_REGEXP, createDateParser(DATE_REGEXP, ['yyyy', 'MM', 'dd']), 'yyyy-MM-dd'),
        'datetime-local': createDateInputType('datetimelocal', DATETIMELOCAL_REGEXP, createDateParser(DATETIMELOCAL_REGEXP, ['yyyy', 'MM', 'dd', 'HH', 'mm', 'ss', 'sss']), 'yyyy-MM-ddTHH:mm:ss.sss'),
        'time': createDateInputType('time', TIME_REGEXP, createDateParser(TIME_REGEXP, ['HH', 'mm', 'ss', 'sss']), 'HH:mm:ss.sss'),
        'week': createDateInputType('week', WEEK_REGEXP, weekParser, 'yyyy-Www'),
        'month': createDateInputType('month', MONTH_REGEXP, createDateParser(MONTH_REGEXP, ['yyyy', 'MM']), 'yyyy-MM'),
        'number': numberInputType,
        'url': urlInputType,
        'email': emailInputType,
        'radio': radioInputType,
        'checkbox': checkboxInputType,
        'hidden': noop,
        'button': noop,
        'submit': noop,
        'reset': noop,
        'file': noop
      };
      function stringBasedInputType(ctrl) {
        ctrl.$formatters.push(function(value) {
          return ctrl.$isEmpty(value) ? value : value.toString();
        });
      }
      function textInputType(scope, element, attr, ctrl, $sniffer, $browser) {
        baseInputType(scope, element, attr, ctrl, $sniffer, $browser);
        stringBasedInputType(ctrl);
      }
      function baseInputType(scope, element, attr, ctrl, $sniffer, $browser) {
        var type = lowercase(element[0].type);
        if (!$sniffer.android) {
          var composing = false;
          element.on('compositionstart', function(data) {
            composing = true;
          });
          element.on('compositionend', function() {
            composing = false;
            listener();
          });
        }
        var listener = function(ev) {
          if (timeout) {
            $browser.defer.cancel(timeout);
            timeout = null;
          }
          if (composing)
            return;
          var value = element.val(),
              event = ev && ev.type;
          if (type !== 'password' && (!attr.ngTrim || attr.ngTrim !== 'false')) {
            value = trim(value);
          }
          if (ctrl.$viewValue !== value || (value === '' && ctrl.$$hasNativeValidators)) {
            ctrl.$setViewValue(value, event);
          }
        };
        if ($sniffer.hasEvent('input')) {
          element.on('input', listener);
        } else {
          var timeout;
          var deferListener = function(ev, input, origValue) {
            if (!timeout) {
              timeout = $browser.defer(function() {
                timeout = null;
                if (!input || input.value !== origValue) {
                  listener(ev);
                }
              });
            }
          };
          element.on('keydown', function(event) {
            var key = event.keyCode;
            if (key === 91 || (15 < key && key < 19) || (37 <= key && key <= 40))
              return;
            deferListener(event, this, this.value);
          });
          if ($sniffer.hasEvent('paste')) {
            element.on('paste cut', deferListener);
          }
        }
        element.on('change', listener);
        ctrl.$render = function() {
          var value = ctrl.$isEmpty(ctrl.$viewValue) ? '' : ctrl.$viewValue;
          if (element.val() !== value) {
            element.val(value);
          }
        };
      }
      function weekParser(isoWeek, existingDate) {
        if (isDate(isoWeek)) {
          return isoWeek;
        }
        if (isString(isoWeek)) {
          WEEK_REGEXP.lastIndex = 0;
          var parts = WEEK_REGEXP.exec(isoWeek);
          if (parts) {
            var year = +parts[1],
                week = +parts[2],
                hours = 0,
                minutes = 0,
                seconds = 0,
                milliseconds = 0,
                firstThurs = getFirstThursdayOfYear(year),
                addDays = (week - 1) * 7;
            if (existingDate) {
              hours = existingDate.getHours();
              minutes = existingDate.getMinutes();
              seconds = existingDate.getSeconds();
              milliseconds = existingDate.getMilliseconds();
            }
            return new Date(year, 0, firstThurs.getDate() + addDays, hours, minutes, seconds, milliseconds);
          }
        }
        return NaN;
      }
      function createDateParser(regexp, mapping) {
        return function(iso, date) {
          var parts,
              map;
          if (isDate(iso)) {
            return iso;
          }
          if (isString(iso)) {
            if (iso.charAt(0) == '"' && iso.charAt(iso.length - 1) == '"') {
              iso = iso.substring(1, iso.length - 1);
            }
            if (ISO_DATE_REGEXP.test(iso)) {
              return new Date(iso);
            }
            regexp.lastIndex = 0;
            parts = regexp.exec(iso);
            if (parts) {
              parts.shift();
              if (date) {
                map = {
                  yyyy: date.getFullYear(),
                  MM: date.getMonth() + 1,
                  dd: date.getDate(),
                  HH: date.getHours(),
                  mm: date.getMinutes(),
                  ss: date.getSeconds(),
                  sss: date.getMilliseconds() / 1000
                };
              } else {
                map = {
                  yyyy: 1970,
                  MM: 1,
                  dd: 1,
                  HH: 0,
                  mm: 0,
                  ss: 0,
                  sss: 0
                };
              }
              forEach(parts, function(part, index) {
                if (index < mapping.length) {
                  map[mapping[index]] = +part;
                }
              });
              return new Date(map.yyyy, map.MM - 1, map.dd, map.HH, map.mm, map.ss || 0, map.sss * 1000 || 0);
            }
          }
          return NaN;
        };
      }
      function createDateInputType(type, regexp, parseDate, format) {
        return function dynamicDateInputType(scope, element, attr, ctrl, $sniffer, $browser, $filter) {
          badInputChecker(scope, element, attr, ctrl);
          baseInputType(scope, element, attr, ctrl, $sniffer, $browser);
          var timezone = ctrl && ctrl.$options && ctrl.$options.timezone;
          var previousDate;
          ctrl.$$parserName = type;
          ctrl.$parsers.push(function(value) {
            if (ctrl.$isEmpty(value))
              return null;
            if (regexp.test(value)) {
              var parsedDate = parseDate(value, previousDate);
              if (timezone) {
                parsedDate = convertTimezoneToLocal(parsedDate, timezone);
              }
              return parsedDate;
            }
            return undefined;
          });
          ctrl.$formatters.push(function(value) {
            if (value && !isDate(value)) {
              throw ngModelMinErr('datefmt', 'Expected `{0}` to be a date', value);
            }
            if (isValidDate(value)) {
              previousDate = value;
              if (previousDate && timezone) {
                previousDate = convertTimezoneToLocal(previousDate, timezone, true);
              }
              return $filter('date')(value, format, timezone);
            } else {
              previousDate = null;
              return '';
            }
          });
          if (isDefined(attr.min) || attr.ngMin) {
            var minVal;
            ctrl.$validators.min = function(value) {
              return !isValidDate(value) || isUndefined(minVal) || parseDate(value) >= minVal;
            };
            attr.$observe('min', function(val) {
              minVal = parseObservedDateValue(val);
              ctrl.$validate();
            });
          }
          if (isDefined(attr.max) || attr.ngMax) {
            var maxVal;
            ctrl.$validators.max = function(value) {
              return !isValidDate(value) || isUndefined(maxVal) || parseDate(value) <= maxVal;
            };
            attr.$observe('max', function(val) {
              maxVal = parseObservedDateValue(val);
              ctrl.$validate();
            });
          }
          function isValidDate(value) {
            return value && !(value.getTime && value.getTime() !== value.getTime());
          }
          function parseObservedDateValue(val) {
            return isDefined(val) && !isDate(val) ? parseDate(val) || undefined : val;
          }
        };
      }
      function badInputChecker(scope, element, attr, ctrl) {
        var node = element[0];
        var nativeValidation = ctrl.$$hasNativeValidators = isObject(node.validity);
        if (nativeValidation) {
          ctrl.$parsers.push(function(value) {
            var validity = element.prop(VALIDITY_STATE_PROPERTY) || {};
            return validity.badInput && !validity.typeMismatch ? undefined : value;
          });
        }
      }
      function numberInputType(scope, element, attr, ctrl, $sniffer, $browser) {
        badInputChecker(scope, element, attr, ctrl);
        baseInputType(scope, element, attr, ctrl, $sniffer, $browser);
        ctrl.$$parserName = 'number';
        ctrl.$parsers.push(function(value) {
          if (ctrl.$isEmpty(value))
            return null;
          if (NUMBER_REGEXP.test(value))
            return parseFloat(value);
          return undefined;
        });
        ctrl.$formatters.push(function(value) {
          if (!ctrl.$isEmpty(value)) {
            if (!isNumber(value)) {
              throw ngModelMinErr('numfmt', 'Expected `{0}` to be a number', value);
            }
            value = value.toString();
          }
          return value;
        });
        if (isDefined(attr.min) || attr.ngMin) {
          var minVal;
          ctrl.$validators.min = function(value) {
            return ctrl.$isEmpty(value) || isUndefined(minVal) || value >= minVal;
          };
          attr.$observe('min', function(val) {
            if (isDefined(val) && !isNumber(val)) {
              val = parseFloat(val, 10);
            }
            minVal = isNumber(val) && !isNaN(val) ? val : undefined;
            ctrl.$validate();
          });
        }
        if (isDefined(attr.max) || attr.ngMax) {
          var maxVal;
          ctrl.$validators.max = function(value) {
            return ctrl.$isEmpty(value) || isUndefined(maxVal) || value <= maxVal;
          };
          attr.$observe('max', function(val) {
            if (isDefined(val) && !isNumber(val)) {
              val = parseFloat(val, 10);
            }
            maxVal = isNumber(val) && !isNaN(val) ? val : undefined;
            ctrl.$validate();
          });
        }
      }
      function urlInputType(scope, element, attr, ctrl, $sniffer, $browser) {
        baseInputType(scope, element, attr, ctrl, $sniffer, $browser);
        stringBasedInputType(ctrl);
        ctrl.$$parserName = 'url';
        ctrl.$validators.url = function(modelValue, viewValue) {
          var value = modelValue || viewValue;
          return ctrl.$isEmpty(value) || URL_REGEXP.test(value);
        };
      }
      function emailInputType(scope, element, attr, ctrl, $sniffer, $browser) {
        baseInputType(scope, element, attr, ctrl, $sniffer, $browser);
        stringBasedInputType(ctrl);
        ctrl.$$parserName = 'email';
        ctrl.$validators.email = function(modelValue, viewValue) {
          var value = modelValue || viewValue;
          return ctrl.$isEmpty(value) || EMAIL_REGEXP.test(value);
        };
      }
      function radioInputType(scope, element, attr, ctrl) {
        if (isUndefined(attr.name)) {
          element.attr('name', nextUid());
        }
        var listener = function(ev) {
          if (element[0].checked) {
            ctrl.$setViewValue(attr.value, ev && ev.type);
          }
        };
        element.on('click', listener);
        ctrl.$render = function() {
          var value = attr.value;
          element[0].checked = (value == ctrl.$viewValue);
        };
        attr.$observe('value', ctrl.$render);
      }
      function parseConstantExpr($parse, context, name, expression, fallback) {
        var parseFn;
        if (isDefined(expression)) {
          parseFn = $parse(expression);
          if (!parseFn.constant) {
            throw ngModelMinErr('constexpr', 'Expected constant expression for `{0}`, but saw ' + '`{1}`.', name, expression);
          }
          return parseFn(context);
        }
        return fallback;
      }
      function checkboxInputType(scope, element, attr, ctrl, $sniffer, $browser, $filter, $parse) {
        var trueValue = parseConstantExpr($parse, scope, 'ngTrueValue', attr.ngTrueValue, true);
        var falseValue = parseConstantExpr($parse, scope, 'ngFalseValue', attr.ngFalseValue, false);
        var listener = function(ev) {
          ctrl.$setViewValue(element[0].checked, ev && ev.type);
        };
        element.on('click', listener);
        ctrl.$render = function() {
          element[0].checked = ctrl.$viewValue;
        };
        ctrl.$isEmpty = function(value) {
          return value === false;
        };
        ctrl.$formatters.push(function(value) {
          return equals(value, trueValue);
        });
        ctrl.$parsers.push(function(value) {
          return value ? trueValue : falseValue;
        });
      }
      var inputDirective = ['$browser', '$sniffer', '$filter', '$parse', function($browser, $sniffer, $filter, $parse) {
        return {
          restrict: 'E',
          require: ['?ngModel'],
          link: {pre: function(scope, element, attr, ctrls) {
              if (ctrls[0]) {
                (inputType[lowercase(attr.type)] || inputType.text)(scope, element, attr, ctrls[0], $sniffer, $browser, $filter, $parse);
              }
            }}
        };
      }];
      var CONSTANT_VALUE_REGEXP = /^(true|false|\d+)$/;
      var ngValueDirective = function() {
        return {
          restrict: 'A',
          priority: 100,
          compile: function(tpl, tplAttr) {
            if (CONSTANT_VALUE_REGEXP.test(tplAttr.ngValue)) {
              return function ngValueConstantLink(scope, elm, attr) {
                attr.$set('value', scope.$eval(attr.ngValue));
              };
            } else {
              return function ngValueLink(scope, elm, attr) {
                scope.$watch(attr.ngValue, function valueWatchAction(value) {
                  attr.$set('value', value);
                });
              };
            }
          }
        };
      };
      var ngBindDirective = ['$compile', function($compile) {
        return {
          restrict: 'AC',
          compile: function ngBindCompile(templateElement) {
            $compile.$$addBindingClass(templateElement);
            return function ngBindLink(scope, element, attr) {
              $compile.$$addBindingInfo(element, attr.ngBind);
              element = element[0];
              scope.$watch(attr.ngBind, function ngBindWatchAction(value) {
                element.textContent = isUndefined(value) ? '' : value;
              });
            };
          }
        };
      }];
      var ngBindTemplateDirective = ['$interpolate', '$compile', function($interpolate, $compile) {
        return {compile: function ngBindTemplateCompile(templateElement) {
            $compile.$$addBindingClass(templateElement);
            return function ngBindTemplateLink(scope, element, attr) {
              var interpolateFn = $interpolate(element.attr(attr.$attr.ngBindTemplate));
              $compile.$$addBindingInfo(element, interpolateFn.expressions);
              element = element[0];
              attr.$observe('ngBindTemplate', function(value) {
                element.textContent = isUndefined(value) ? '' : value;
              });
            };
          }};
      }];
      var ngBindHtmlDirective = ['$sce', '$parse', '$compile', function($sce, $parse, $compile) {
        return {
          restrict: 'A',
          compile: function ngBindHtmlCompile(tElement, tAttrs) {
            var ngBindHtmlGetter = $parse(tAttrs.ngBindHtml);
            var ngBindHtmlWatch = $parse(tAttrs.ngBindHtml, function getStringValue(value) {
              return (value || '').toString();
            });
            $compile.$$addBindingClass(tElement);
            return function ngBindHtmlLink(scope, element, attr) {
              $compile.$$addBindingInfo(element, attr.ngBindHtml);
              scope.$watch(ngBindHtmlWatch, function ngBindHtmlWatchAction() {
                element.html($sce.getTrustedHtml(ngBindHtmlGetter(scope)) || '');
              });
            };
          }
        };
      }];
      var ngChangeDirective = valueFn({
        restrict: 'A',
        require: 'ngModel',
        link: function(scope, element, attr, ctrl) {
          ctrl.$viewChangeListeners.push(function() {
            scope.$eval(attr.ngChange);
          });
        }
      });
      function classDirective(name, selector) {
        name = 'ngClass' + name;
        return ['$animate', function($animate) {
          return {
            restrict: 'AC',
            link: function(scope, element, attr) {
              var oldVal;
              scope.$watch(attr[name], ngClassWatchAction, true);
              attr.$observe('class', function(value) {
                ngClassWatchAction(scope.$eval(attr[name]));
              });
              if (name !== 'ngClass') {
                scope.$watch('$index', function($index, old$index) {
                  var mod = $index & 1;
                  if (mod !== (old$index & 1)) {
                    var classes = arrayClasses(scope.$eval(attr[name]));
                    mod === selector ? addClasses(classes) : removeClasses(classes);
                  }
                });
              }
              function addClasses(classes) {
                var newClasses = digestClassCounts(classes, 1);
                attr.$addClass(newClasses);
              }
              function removeClasses(classes) {
                var newClasses = digestClassCounts(classes, -1);
                attr.$removeClass(newClasses);
              }
              function digestClassCounts(classes, count) {
                var classCounts = element.data('$classCounts') || createMap();
                var classesToUpdate = [];
                forEach(classes, function(className) {
                  if (count > 0 || classCounts[className]) {
                    classCounts[className] = (classCounts[className] || 0) + count;
                    if (classCounts[className] === +(count > 0)) {
                      classesToUpdate.push(className);
                    }
                  }
                });
                element.data('$classCounts', classCounts);
                return classesToUpdate.join(' ');
              }
              function updateClasses(oldClasses, newClasses) {
                var toAdd = arrayDifference(newClasses, oldClasses);
                var toRemove = arrayDifference(oldClasses, newClasses);
                toAdd = digestClassCounts(toAdd, 1);
                toRemove = digestClassCounts(toRemove, -1);
                if (toAdd && toAdd.length) {
                  $animate.addClass(element, toAdd);
                }
                if (toRemove && toRemove.length) {
                  $animate.removeClass(element, toRemove);
                }
              }
              function ngClassWatchAction(newVal) {
                if (selector === true || scope.$index % 2 === selector) {
                  var newClasses = arrayClasses(newVal || []);
                  if (!oldVal) {
                    addClasses(newClasses);
                  } else if (!equals(newVal, oldVal)) {
                    var oldClasses = arrayClasses(oldVal);
                    updateClasses(oldClasses, newClasses);
                  }
                }
                oldVal = shallowCopy(newVal);
              }
            }
          };
          function arrayDifference(tokens1, tokens2) {
            var values = [];
            outer: for (var i = 0; i < tokens1.length; i++) {
              var token = tokens1[i];
              for (var j = 0; j < tokens2.length; j++) {
                if (token == tokens2[j])
                  continue outer;
              }
              values.push(token);
            }
            return values;
          }
          function arrayClasses(classVal) {
            var classes = [];
            if (isArray(classVal)) {
              forEach(classVal, function(v) {
                classes = classes.concat(arrayClasses(v));
              });
              return classes;
            } else if (isString(classVal)) {
              return classVal.split(' ');
            } else if (isObject(classVal)) {
              forEach(classVal, function(v, k) {
                if (v) {
                  classes = classes.concat(k.split(' '));
                }
              });
              return classes;
            }
            return classVal;
          }
        }];
      }
      var ngClassDirective = classDirective('', true);
      var ngClassOddDirective = classDirective('Odd', 0);
      var ngClassEvenDirective = classDirective('Even', 1);
      var ngCloakDirective = ngDirective({compile: function(element, attr) {
          attr.$set('ngCloak', undefined);
          element.removeClass('ng-cloak');
        }});
      var ngControllerDirective = [function() {
        return {
          restrict: 'A',
          scope: true,
          controller: '@',
          priority: 500
        };
      }];
      var ngEventDirectives = {};
      var forceAsyncEvents = {
        'blur': true,
        'focus': true
      };
      forEach('click dblclick mousedown mouseup mouseover mouseout mousemove mouseenter mouseleave keydown keyup keypress submit focus blur copy cut paste'.split(' '), function(eventName) {
        var directiveName = directiveNormalize('ng-' + eventName);
        ngEventDirectives[directiveName] = ['$parse', '$rootScope', function($parse, $rootScope) {
          return {
            restrict: 'A',
            compile: function($element, attr) {
              var fn = $parse(attr[directiveName], null, true);
              return function ngEventHandler(scope, element) {
                element.on(eventName, function(event) {
                  var callback = function() {
                    fn(scope, {$event: event});
                  };
                  if (forceAsyncEvents[eventName] && $rootScope.$$phase) {
                    scope.$evalAsync(callback);
                  } else {
                    scope.$apply(callback);
                  }
                });
              };
            }
          };
        }];
      });
      var ngIfDirective = ['$animate', function($animate) {
        return {
          multiElement: true,
          transclude: 'element',
          priority: 600,
          terminal: true,
          restrict: 'A',
          $$tlb: true,
          link: function($scope, $element, $attr, ctrl, $transclude) {
            var block,
                childScope,
                previousElements;
            $scope.$watch($attr.ngIf, function ngIfWatchAction(value) {
              if (value) {
                if (!childScope) {
                  $transclude(function(clone, newScope) {
                    childScope = newScope;
                    clone[clone.length++] = document.createComment(' end ngIf: ' + $attr.ngIf + ' ');
                    block = {clone: clone};
                    $animate.enter(clone, $element.parent(), $element);
                  });
                }
              } else {
                if (previousElements) {
                  previousElements.remove();
                  previousElements = null;
                }
                if (childScope) {
                  childScope.$destroy();
                  childScope = null;
                }
                if (block) {
                  previousElements = getBlockNodes(block.clone);
                  $animate.leave(previousElements).then(function() {
                    previousElements = null;
                  });
                  block = null;
                }
              }
            });
          }
        };
      }];
      var ngIncludeDirective = ['$templateRequest', '$anchorScroll', '$animate', function($templateRequest, $anchorScroll, $animate) {
        return {
          restrict: 'ECA',
          priority: 400,
          terminal: true,
          transclude: 'element',
          controller: angular.noop,
          compile: function(element, attr) {
            var srcExp = attr.ngInclude || attr.src,
                onloadExp = attr.onload || '',
                autoScrollExp = attr.autoscroll;
            return function(scope, $element, $attr, ctrl, $transclude) {
              var changeCounter = 0,
                  currentScope,
                  previousElement,
                  currentElement;
              var cleanupLastIncludeContent = function() {
                if (previousElement) {
                  previousElement.remove();
                  previousElement = null;
                }
                if (currentScope) {
                  currentScope.$destroy();
                  currentScope = null;
                }
                if (currentElement) {
                  $animate.leave(currentElement).then(function() {
                    previousElement = null;
                  });
                  previousElement = currentElement;
                  currentElement = null;
                }
              };
              scope.$watch(srcExp, function ngIncludeWatchAction(src) {
                var afterAnimation = function() {
                  if (isDefined(autoScrollExp) && (!autoScrollExp || scope.$eval(autoScrollExp))) {
                    $anchorScroll();
                  }
                };
                var thisChangeId = ++changeCounter;
                if (src) {
                  $templateRequest(src, true).then(function(response) {
                    if (thisChangeId !== changeCounter)
                      return;
                    var newScope = scope.$new();
                    ctrl.template = response;
                    var clone = $transclude(newScope, function(clone) {
                      cleanupLastIncludeContent();
                      $animate.enter(clone, null, $element).then(afterAnimation);
                    });
                    currentScope = newScope;
                    currentElement = clone;
                    currentScope.$emit('$includeContentLoaded', src);
                    scope.$eval(onloadExp);
                  }, function() {
                    if (thisChangeId === changeCounter) {
                      cleanupLastIncludeContent();
                      scope.$emit('$includeContentError', src);
                    }
                  });
                  scope.$emit('$includeContentRequested', src);
                } else {
                  cleanupLastIncludeContent();
                  ctrl.template = null;
                }
              });
            };
          }
        };
      }];
      var ngIncludeFillContentDirective = ['$compile', function($compile) {
        return {
          restrict: 'ECA',
          priority: -400,
          require: 'ngInclude',
          link: function(scope, $element, $attr, ctrl) {
            if (/SVG/.test($element[0].toString())) {
              $element.empty();
              $compile(jqLiteBuildFragment(ctrl.template, document).childNodes)(scope, function namespaceAdaptedClone(clone) {
                $element.append(clone);
              }, {futureParentElement: $element});
              return;
            }
            $element.html(ctrl.template);
            $compile($element.contents())(scope);
          }
        };
      }];
      var ngInitDirective = ngDirective({
        priority: 450,
        compile: function() {
          return {pre: function(scope, element, attrs) {
              scope.$eval(attrs.ngInit);
            }};
        }
      });
      var ngListDirective = function() {
        return {
          restrict: 'A',
          priority: 100,
          require: 'ngModel',
          link: function(scope, element, attr, ctrl) {
            var ngList = element.attr(attr.$attr.ngList) || ', ';
            var trimValues = attr.ngTrim !== 'false';
            var separator = trimValues ? trim(ngList) : ngList;
            var parse = function(viewValue) {
              if (isUndefined(viewValue))
                return;
              var list = [];
              if (viewValue) {
                forEach(viewValue.split(separator), function(value) {
                  if (value)
                    list.push(trimValues ? trim(value) : value);
                });
              }
              return list;
            };
            ctrl.$parsers.push(parse);
            ctrl.$formatters.push(function(value) {
              if (isArray(value)) {
                return value.join(ngList);
              }
              return undefined;
            });
            ctrl.$isEmpty = function(value) {
              return !value || !value.length;
            };
          }
        };
      };
      var VALID_CLASS = 'ng-valid',
          INVALID_CLASS = 'ng-invalid',
          PRISTINE_CLASS = 'ng-pristine',
          DIRTY_CLASS = 'ng-dirty',
          UNTOUCHED_CLASS = 'ng-untouched',
          TOUCHED_CLASS = 'ng-touched',
          PENDING_CLASS = 'ng-pending';
      var ngModelMinErr = minErr('ngModel');
      var NgModelController = ['$scope', '$exceptionHandler', '$attrs', '$element', '$parse', '$animate', '$timeout', '$rootScope', '$q', '$interpolate', function($scope, $exceptionHandler, $attr, $element, $parse, $animate, $timeout, $rootScope, $q, $interpolate) {
        this.$viewValue = Number.NaN;
        this.$modelValue = Number.NaN;
        this.$$rawModelValue = undefined;
        this.$validators = {};
        this.$asyncValidators = {};
        this.$parsers = [];
        this.$formatters = [];
        this.$viewChangeListeners = [];
        this.$untouched = true;
        this.$touched = false;
        this.$pristine = true;
        this.$dirty = false;
        this.$valid = true;
        this.$invalid = false;
        this.$error = {};
        this.$$success = {};
        this.$pending = undefined;
        this.$name = $interpolate($attr.name || '', false)($scope);
        this.$$parentForm = nullFormCtrl;
        var parsedNgModel = $parse($attr.ngModel),
            parsedNgModelAssign = parsedNgModel.assign,
            ngModelGet = parsedNgModel,
            ngModelSet = parsedNgModelAssign,
            pendingDebounce = null,
            parserValid,
            ctrl = this;
        this.$$setOptions = function(options) {
          ctrl.$options = options;
          if (options && options.getterSetter) {
            var invokeModelGetter = $parse($attr.ngModel + '()'),
                invokeModelSetter = $parse($attr.ngModel + '($$$p)');
            ngModelGet = function($scope) {
              var modelValue = parsedNgModel($scope);
              if (isFunction(modelValue)) {
                modelValue = invokeModelGetter($scope);
              }
              return modelValue;
            };
            ngModelSet = function($scope, newValue) {
              if (isFunction(parsedNgModel($scope))) {
                invokeModelSetter($scope, {$$$p: ctrl.$modelValue});
              } else {
                parsedNgModelAssign($scope, ctrl.$modelValue);
              }
            };
          } else if (!parsedNgModel.assign) {
            throw ngModelMinErr('nonassign', "Expression '{0}' is non-assignable. Element: {1}", $attr.ngModel, startingTag($element));
          }
        };
        this.$render = noop;
        this.$isEmpty = function(value) {
          return isUndefined(value) || value === '' || value === null || value !== value;
        };
        var currentValidationRunId = 0;
        addSetValidityMethod({
          ctrl: this,
          $element: $element,
          set: function(object, property) {
            object[property] = true;
          },
          unset: function(object, property) {
            delete object[property];
          },
          $animate: $animate
        });
        this.$setPristine = function() {
          ctrl.$dirty = false;
          ctrl.$pristine = true;
          $animate.removeClass($element, DIRTY_CLASS);
          $animate.addClass($element, PRISTINE_CLASS);
        };
        this.$setDirty = function() {
          ctrl.$dirty = true;
          ctrl.$pristine = false;
          $animate.removeClass($element, PRISTINE_CLASS);
          $animate.addClass($element, DIRTY_CLASS);
          ctrl.$$parentForm.$setDirty();
        };
        this.$setUntouched = function() {
          ctrl.$touched = false;
          ctrl.$untouched = true;
          $animate.setClass($element, UNTOUCHED_CLASS, TOUCHED_CLASS);
        };
        this.$setTouched = function() {
          ctrl.$touched = true;
          ctrl.$untouched = false;
          $animate.setClass($element, TOUCHED_CLASS, UNTOUCHED_CLASS);
        };
        this.$rollbackViewValue = function() {
          $timeout.cancel(pendingDebounce);
          ctrl.$viewValue = ctrl.$$lastCommittedViewValue;
          ctrl.$render();
        };
        this.$validate = function() {
          if (isNumber(ctrl.$modelValue) && isNaN(ctrl.$modelValue)) {
            return;
          }
          var viewValue = ctrl.$$lastCommittedViewValue;
          var modelValue = ctrl.$$rawModelValue;
          var prevValid = ctrl.$valid;
          var prevModelValue = ctrl.$modelValue;
          var allowInvalid = ctrl.$options && ctrl.$options.allowInvalid;
          ctrl.$$runValidators(modelValue, viewValue, function(allValid) {
            if (!allowInvalid && prevValid !== allValid) {
              ctrl.$modelValue = allValid ? modelValue : undefined;
              if (ctrl.$modelValue !== prevModelValue) {
                ctrl.$$writeModelToScope();
              }
            }
          });
        };
        this.$$runValidators = function(modelValue, viewValue, doneCallback) {
          currentValidationRunId++;
          var localValidationRunId = currentValidationRunId;
          if (!processParseErrors()) {
            validationDone(false);
            return;
          }
          if (!processSyncValidators()) {
            validationDone(false);
            return;
          }
          processAsyncValidators();
          function processParseErrors() {
            var errorKey = ctrl.$$parserName || 'parse';
            if (isUndefined(parserValid)) {
              setValidity(errorKey, null);
            } else {
              if (!parserValid) {
                forEach(ctrl.$validators, function(v, name) {
                  setValidity(name, null);
                });
                forEach(ctrl.$asyncValidators, function(v, name) {
                  setValidity(name, null);
                });
              }
              setValidity(errorKey, parserValid);
              return parserValid;
            }
            return true;
          }
          function processSyncValidators() {
            var syncValidatorsValid = true;
            forEach(ctrl.$validators, function(validator, name) {
              var result = validator(modelValue, viewValue);
              syncValidatorsValid = syncValidatorsValid && result;
              setValidity(name, result);
            });
            if (!syncValidatorsValid) {
              forEach(ctrl.$asyncValidators, function(v, name) {
                setValidity(name, null);
              });
              return false;
            }
            return true;
          }
          function processAsyncValidators() {
            var validatorPromises = [];
            var allValid = true;
            forEach(ctrl.$asyncValidators, function(validator, name) {
              var promise = validator(modelValue, viewValue);
              if (!isPromiseLike(promise)) {
                throw ngModelMinErr("$asyncValidators", "Expected asynchronous validator to return a promise but got '{0}' instead.", promise);
              }
              setValidity(name, undefined);
              validatorPromises.push(promise.then(function() {
                setValidity(name, true);
              }, function(error) {
                allValid = false;
                setValidity(name, false);
              }));
            });
            if (!validatorPromises.length) {
              validationDone(true);
            } else {
              $q.all(validatorPromises).then(function() {
                validationDone(allValid);
              }, noop);
            }
          }
          function setValidity(name, isValid) {
            if (localValidationRunId === currentValidationRunId) {
              ctrl.$setValidity(name, isValid);
            }
          }
          function validationDone(allValid) {
            if (localValidationRunId === currentValidationRunId) {
              doneCallback(allValid);
            }
          }
        };
        this.$commitViewValue = function() {
          var viewValue = ctrl.$viewValue;
          $timeout.cancel(pendingDebounce);
          if (ctrl.$$lastCommittedViewValue === viewValue && (viewValue !== '' || !ctrl.$$hasNativeValidators)) {
            return;
          }
          ctrl.$$lastCommittedViewValue = viewValue;
          if (ctrl.$pristine) {
            this.$setDirty();
          }
          this.$$parseAndValidate();
        };
        this.$$parseAndValidate = function() {
          var viewValue = ctrl.$$lastCommittedViewValue;
          var modelValue = viewValue;
          parserValid = isUndefined(modelValue) ? undefined : true;
          if (parserValid) {
            for (var i = 0; i < ctrl.$parsers.length; i++) {
              modelValue = ctrl.$parsers[i](modelValue);
              if (isUndefined(modelValue)) {
                parserValid = false;
                break;
              }
            }
          }
          if (isNumber(ctrl.$modelValue) && isNaN(ctrl.$modelValue)) {
            ctrl.$modelValue = ngModelGet($scope);
          }
          var prevModelValue = ctrl.$modelValue;
          var allowInvalid = ctrl.$options && ctrl.$options.allowInvalid;
          ctrl.$$rawModelValue = modelValue;
          if (allowInvalid) {
            ctrl.$modelValue = modelValue;
            writeToModelIfNeeded();
          }
          ctrl.$$runValidators(modelValue, ctrl.$$lastCommittedViewValue, function(allValid) {
            if (!allowInvalid) {
              ctrl.$modelValue = allValid ? modelValue : undefined;
              writeToModelIfNeeded();
            }
          });
          function writeToModelIfNeeded() {
            if (ctrl.$modelValue !== prevModelValue) {
              ctrl.$$writeModelToScope();
            }
          }
        };
        this.$$writeModelToScope = function() {
          ngModelSet($scope, ctrl.$modelValue);
          forEach(ctrl.$viewChangeListeners, function(listener) {
            try {
              listener();
            } catch (e) {
              $exceptionHandler(e);
            }
          });
        };
        this.$setViewValue = function(value, trigger) {
          ctrl.$viewValue = value;
          if (!ctrl.$options || ctrl.$options.updateOnDefault) {
            ctrl.$$debounceViewValueCommit(trigger);
          }
        };
        this.$$debounceViewValueCommit = function(trigger) {
          var debounceDelay = 0,
              options = ctrl.$options,
              debounce;
          if (options && isDefined(options.debounce)) {
            debounce = options.debounce;
            if (isNumber(debounce)) {
              debounceDelay = debounce;
            } else if (isNumber(debounce[trigger])) {
              debounceDelay = debounce[trigger];
            } else if (isNumber(debounce['default'])) {
              debounceDelay = debounce['default'];
            }
          }
          $timeout.cancel(pendingDebounce);
          if (debounceDelay) {
            pendingDebounce = $timeout(function() {
              ctrl.$commitViewValue();
            }, debounceDelay);
          } else if ($rootScope.$$phase) {
            ctrl.$commitViewValue();
          } else {
            $scope.$apply(function() {
              ctrl.$commitViewValue();
            });
          }
        };
        $scope.$watch(function ngModelWatch() {
          var modelValue = ngModelGet($scope);
          if (modelValue !== ctrl.$modelValue && (ctrl.$modelValue === ctrl.$modelValue || modelValue === modelValue)) {
            ctrl.$modelValue = ctrl.$$rawModelValue = modelValue;
            parserValid = undefined;
            var formatters = ctrl.$formatters,
                idx = formatters.length;
            var viewValue = modelValue;
            while (idx--) {
              viewValue = formatters[idx](viewValue);
            }
            if (ctrl.$viewValue !== viewValue) {
              ctrl.$viewValue = ctrl.$$lastCommittedViewValue = viewValue;
              ctrl.$render();
              ctrl.$$runValidators(modelValue, viewValue, noop);
            }
          }
          return modelValue;
        });
      }];
      var ngModelDirective = ['$rootScope', function($rootScope) {
        return {
          restrict: 'A',
          require: ['ngModel', '^?form', '^?ngModelOptions'],
          controller: NgModelController,
          priority: 1,
          compile: function ngModelCompile(element) {
            element.addClass(PRISTINE_CLASS).addClass(UNTOUCHED_CLASS).addClass(VALID_CLASS);
            return {
              pre: function ngModelPreLink(scope, element, attr, ctrls) {
                var modelCtrl = ctrls[0],
                    formCtrl = ctrls[1] || modelCtrl.$$parentForm;
                modelCtrl.$$setOptions(ctrls[2] && ctrls[2].$options);
                formCtrl.$addControl(modelCtrl);
                attr.$observe('name', function(newValue) {
                  if (modelCtrl.$name !== newValue) {
                    modelCtrl.$$parentForm.$$renameControl(modelCtrl, newValue);
                  }
                });
                scope.$on('$destroy', function() {
                  modelCtrl.$$parentForm.$removeControl(modelCtrl);
                });
              },
              post: function ngModelPostLink(scope, element, attr, ctrls) {
                var modelCtrl = ctrls[0];
                if (modelCtrl.$options && modelCtrl.$options.updateOn) {
                  element.on(modelCtrl.$options.updateOn, function(ev) {
                    modelCtrl.$$debounceViewValueCommit(ev && ev.type);
                  });
                }
                element.on('blur', function(ev) {
                  if (modelCtrl.$touched)
                    return;
                  if ($rootScope.$$phase) {
                    scope.$evalAsync(modelCtrl.$setTouched);
                  } else {
                    scope.$apply(modelCtrl.$setTouched);
                  }
                });
              }
            };
          }
        };
      }];
      var DEFAULT_REGEXP = /(\s+|^)default(\s+|$)/;
      var ngModelOptionsDirective = function() {
        return {
          restrict: 'A',
          controller: ['$scope', '$attrs', function($scope, $attrs) {
            var that = this;
            this.$options = copy($scope.$eval($attrs.ngModelOptions));
            if (isDefined(this.$options.updateOn)) {
              this.$options.updateOnDefault = false;
              this.$options.updateOn = trim(this.$options.updateOn.replace(DEFAULT_REGEXP, function() {
                that.$options.updateOnDefault = true;
                return ' ';
              }));
            } else {
              this.$options.updateOnDefault = true;
            }
          }]
        };
      };
      function addSetValidityMethod(context) {
        var ctrl = context.ctrl,
            $element = context.$element,
            classCache = {},
            set = context.set,
            unset = context.unset,
            $animate = context.$animate;
        classCache[INVALID_CLASS] = !(classCache[VALID_CLASS] = $element.hasClass(VALID_CLASS));
        ctrl.$setValidity = setValidity;
        function setValidity(validationErrorKey, state, controller) {
          if (isUndefined(state)) {
            createAndSet('$pending', validationErrorKey, controller);
          } else {
            unsetAndCleanup('$pending', validationErrorKey, controller);
          }
          if (!isBoolean(state)) {
            unset(ctrl.$error, validationErrorKey, controller);
            unset(ctrl.$$success, validationErrorKey, controller);
          } else {
            if (state) {
              unset(ctrl.$error, validationErrorKey, controller);
              set(ctrl.$$success, validationErrorKey, controller);
            } else {
              set(ctrl.$error, validationErrorKey, controller);
              unset(ctrl.$$success, validationErrorKey, controller);
            }
          }
          if (ctrl.$pending) {
            cachedToggleClass(PENDING_CLASS, true);
            ctrl.$valid = ctrl.$invalid = undefined;
            toggleValidationCss('', null);
          } else {
            cachedToggleClass(PENDING_CLASS, false);
            ctrl.$valid = isObjectEmpty(ctrl.$error);
            ctrl.$invalid = !ctrl.$valid;
            toggleValidationCss('', ctrl.$valid);
          }
          var combinedState;
          if (ctrl.$pending && ctrl.$pending[validationErrorKey]) {
            combinedState = undefined;
          } else if (ctrl.$error[validationErrorKey]) {
            combinedState = false;
          } else if (ctrl.$$success[validationErrorKey]) {
            combinedState = true;
          } else {
            combinedState = null;
          }
          toggleValidationCss(validationErrorKey, combinedState);
          ctrl.$$parentForm.$setValidity(validationErrorKey, combinedState, ctrl);
        }
        function createAndSet(name, value, controller) {
          if (!ctrl[name]) {
            ctrl[name] = {};
          }
          set(ctrl[name], value, controller);
        }
        function unsetAndCleanup(name, value, controller) {
          if (ctrl[name]) {
            unset(ctrl[name], value, controller);
          }
          if (isObjectEmpty(ctrl[name])) {
            ctrl[name] = undefined;
          }
        }
        function cachedToggleClass(className, switchValue) {
          if (switchValue && !classCache[className]) {
            $animate.addClass($element, className);
            classCache[className] = true;
          } else if (!switchValue && classCache[className]) {
            $animate.removeClass($element, className);
            classCache[className] = false;
          }
        }
        function toggleValidationCss(validationErrorKey, isValid) {
          validationErrorKey = validationErrorKey ? '-' + snake_case(validationErrorKey, '-') : '';
          cachedToggleClass(VALID_CLASS + validationErrorKey, isValid === true);
          cachedToggleClass(INVALID_CLASS + validationErrorKey, isValid === false);
        }
      }
      function isObjectEmpty(obj) {
        if (obj) {
          for (var prop in obj) {
            if (obj.hasOwnProperty(prop)) {
              return false;
            }
          }
        }
        return true;
      }
      var ngNonBindableDirective = ngDirective({
        terminal: true,
        priority: 1000
      });
      var ngOptionsMinErr = minErr('ngOptions');
      var NG_OPTIONS_REGEXP = /^\s*([\s\S]+?)(?:\s+as\s+([\s\S]+?))?(?:\s+group\s+by\s+([\s\S]+?))?(?:\s+disable\s+when\s+([\s\S]+?))?\s+for\s+(?:([\$\w][\$\w]*)|(?:\(\s*([\$\w][\$\w]*)\s*,\s*([\$\w][\$\w]*)\s*\)))\s+in\s+([\s\S]+?)(?:\s+track\s+by\s+([\s\S]+?))?$/;
      var ngOptionsDirective = ['$compile', '$parse', function($compile, $parse) {
        function parseOptionsExpression(optionsExp, selectElement, scope) {
          var match = optionsExp.match(NG_OPTIONS_REGEXP);
          if (!(match)) {
            throw ngOptionsMinErr('iexp', "Expected expression in form of " + "'_select_ (as _label_)? for (_key_,)?_value_ in _collection_'" + " but got '{0}'. Element: {1}", optionsExp, startingTag(selectElement));
          }
          var valueName = match[5] || match[7];
          var keyName = match[6];
          var selectAs = / as /.test(match[0]) && match[1];
          var trackBy = match[9];
          var valueFn = $parse(match[2] ? match[1] : valueName);
          var selectAsFn = selectAs && $parse(selectAs);
          var viewValueFn = selectAsFn || valueFn;
          var trackByFn = trackBy && $parse(trackBy);
          var getTrackByValueFn = trackBy ? function(value, locals) {
            return trackByFn(scope, locals);
          } : function getHashOfValue(value) {
            return hashKey(value);
          };
          var getTrackByValue = function(value, key) {
            return getTrackByValueFn(value, getLocals(value, key));
          };
          var displayFn = $parse(match[2] || match[1]);
          var groupByFn = $parse(match[3] || '');
          var disableWhenFn = $parse(match[4] || '');
          var valuesFn = $parse(match[8]);
          var locals = {};
          var getLocals = keyName ? function(value, key) {
            locals[keyName] = key;
            locals[valueName] = value;
            return locals;
          } : function(value) {
            locals[valueName] = value;
            return locals;
          };
          function Option(selectValue, viewValue, label, group, disabled) {
            this.selectValue = selectValue;
            this.viewValue = viewValue;
            this.label = label;
            this.group = group;
            this.disabled = disabled;
          }
          function getOptionValuesKeys(optionValues) {
            var optionValuesKeys;
            if (!keyName && isArrayLike(optionValues)) {
              optionValuesKeys = optionValues;
            } else {
              optionValuesKeys = [];
              for (var itemKey in optionValues) {
                if (optionValues.hasOwnProperty(itemKey) && itemKey.charAt(0) !== '$') {
                  optionValuesKeys.push(itemKey);
                }
              }
            }
            return optionValuesKeys;
          }
          return {
            trackBy: trackBy,
            getTrackByValue: getTrackByValue,
            getWatchables: $parse(valuesFn, function(optionValues) {
              var watchedArray = [];
              optionValues = optionValues || [];
              var optionValuesKeys = getOptionValuesKeys(optionValues);
              var optionValuesLength = optionValuesKeys.length;
              for (var index = 0; index < optionValuesLength; index++) {
                var key = (optionValues === optionValuesKeys) ? index : optionValuesKeys[index];
                var value = optionValues[key];
                var locals = getLocals(optionValues[key], key);
                var selectValue = getTrackByValueFn(optionValues[key], locals);
                watchedArray.push(selectValue);
                if (match[2] || match[1]) {
                  var label = displayFn(scope, locals);
                  watchedArray.push(label);
                }
                if (match[4]) {
                  var disableWhen = disableWhenFn(scope, locals);
                  watchedArray.push(disableWhen);
                }
              }
              return watchedArray;
            }),
            getOptions: function() {
              var optionItems = [];
              var selectValueMap = {};
              var optionValues = valuesFn(scope) || [];
              var optionValuesKeys = getOptionValuesKeys(optionValues);
              var optionValuesLength = optionValuesKeys.length;
              for (var index = 0; index < optionValuesLength; index++) {
                var key = (optionValues === optionValuesKeys) ? index : optionValuesKeys[index];
                var value = optionValues[key];
                var locals = getLocals(value, key);
                var viewValue = viewValueFn(scope, locals);
                var selectValue = getTrackByValueFn(viewValue, locals);
                var label = displayFn(scope, locals);
                var group = groupByFn(scope, locals);
                var disabled = disableWhenFn(scope, locals);
                var optionItem = new Option(selectValue, viewValue, label, group, disabled);
                optionItems.push(optionItem);
                selectValueMap[selectValue] = optionItem;
              }
              return {
                items: optionItems,
                selectValueMap: selectValueMap,
                getOptionFromViewValue: function(value) {
                  return selectValueMap[getTrackByValue(value)];
                },
                getViewValueFromOption: function(option) {
                  return trackBy ? angular.copy(option.viewValue) : option.viewValue;
                }
              };
            }
          };
        }
        var optionTemplate = document.createElement('option'),
            optGroupTemplate = document.createElement('optgroup');
        return {
          restrict: 'A',
          terminal: true,
          require: ['select', '?ngModel'],
          link: function(scope, selectElement, attr, ctrls) {
            var ngModelCtrl = ctrls[1];
            if (!ngModelCtrl)
              return;
            var selectCtrl = ctrls[0];
            var multiple = attr.multiple;
            var emptyOption;
            for (var i = 0,
                children = selectElement.children(),
                ii = children.length; i < ii; i++) {
              if (children[i].value === '') {
                emptyOption = children.eq(i);
                break;
              }
            }
            var providedEmptyOption = !!emptyOption;
            var unknownOption = jqLite(optionTemplate.cloneNode(false));
            unknownOption.val('?');
            var options;
            var ngOptions = parseOptionsExpression(attr.ngOptions, selectElement, scope);
            var renderEmptyOption = function() {
              if (!providedEmptyOption) {
                selectElement.prepend(emptyOption);
              }
              selectElement.val('');
              emptyOption.prop('selected', true);
              emptyOption.attr('selected', true);
            };
            var removeEmptyOption = function() {
              if (!providedEmptyOption) {
                emptyOption.remove();
              }
            };
            var renderUnknownOption = function() {
              selectElement.prepend(unknownOption);
              selectElement.val('?');
              unknownOption.prop('selected', true);
              unknownOption.attr('selected', true);
            };
            var removeUnknownOption = function() {
              unknownOption.remove();
            };
            if (!multiple) {
              selectCtrl.writeValue = function writeNgOptionsValue(value) {
                var option = options.getOptionFromViewValue(value);
                if (option && !option.disabled) {
                  if (selectElement[0].value !== option.selectValue) {
                    removeUnknownOption();
                    removeEmptyOption();
                    selectElement[0].value = option.selectValue;
                    option.element.selected = true;
                    option.element.setAttribute('selected', 'selected');
                  }
                } else {
                  if (value === null || providedEmptyOption) {
                    removeUnknownOption();
                    renderEmptyOption();
                  } else {
                    removeEmptyOption();
                    renderUnknownOption();
                  }
                }
              };
              selectCtrl.readValue = function readNgOptionsValue() {
                var selectedOption = options.selectValueMap[selectElement.val()];
                if (selectedOption && !selectedOption.disabled) {
                  removeEmptyOption();
                  removeUnknownOption();
                  return options.getViewValueFromOption(selectedOption);
                }
                return null;
              };
              if (ngOptions.trackBy) {
                scope.$watch(function() {
                  return ngOptions.getTrackByValue(ngModelCtrl.$viewValue);
                }, function() {
                  ngModelCtrl.$render();
                });
              }
            } else {
              ngModelCtrl.$isEmpty = function(value) {
                return !value || value.length === 0;
              };
              selectCtrl.writeValue = function writeNgOptionsMultiple(value) {
                options.items.forEach(function(option) {
                  option.element.selected = false;
                });
                if (value) {
                  value.forEach(function(item) {
                    var option = options.getOptionFromViewValue(item);
                    if (option && !option.disabled)
                      option.element.selected = true;
                  });
                }
              };
              selectCtrl.readValue = function readNgOptionsMultiple() {
                var selectedValues = selectElement.val() || [],
                    selections = [];
                forEach(selectedValues, function(value) {
                  var option = options.selectValueMap[value];
                  if (option && !option.disabled)
                    selections.push(options.getViewValueFromOption(option));
                });
                return selections;
              };
              if (ngOptions.trackBy) {
                scope.$watchCollection(function() {
                  if (isArray(ngModelCtrl.$viewValue)) {
                    return ngModelCtrl.$viewValue.map(function(value) {
                      return ngOptions.getTrackByValue(value);
                    });
                  }
                }, function() {
                  ngModelCtrl.$render();
                });
              }
            }
            if (providedEmptyOption) {
              emptyOption.remove();
              $compile(emptyOption)(scope);
              emptyOption.removeClass('ng-scope');
            } else {
              emptyOption = jqLite(optionTemplate.cloneNode(false));
            }
            updateOptions();
            scope.$watchCollection(ngOptions.getWatchables, updateOptions);
            function updateOptionElement(option, element) {
              option.element = element;
              element.disabled = option.disabled;
              if (option.value !== element.value)
                element.value = option.selectValue;
              if (option.label !== element.label) {
                element.label = option.label;
                element.textContent = option.label;
              }
            }
            function addOrReuseElement(parent, current, type, templateElement) {
              var element;
              if (current && lowercase(current.nodeName) === type) {
                element = current;
              } else {
                element = templateElement.cloneNode(false);
                if (!current) {
                  parent.appendChild(element);
                } else {
                  parent.insertBefore(element, current);
                }
              }
              return element;
            }
            function removeExcessElements(current) {
              var next;
              while (current) {
                next = current.nextSibling;
                jqLiteRemove(current);
                current = next;
              }
            }
            function skipEmptyAndUnknownOptions(current) {
              var emptyOption_ = emptyOption && emptyOption[0];
              var unknownOption_ = unknownOption && unknownOption[0];
              if (emptyOption_ || unknownOption_) {
                while (current && (current === emptyOption_ || current === unknownOption_)) {
                  current = current.nextSibling;
                }
              }
              return current;
            }
            function updateOptions() {
              var previousValue = options && selectCtrl.readValue();
              options = ngOptions.getOptions();
              var groupMap = {};
              var currentElement = selectElement[0].firstChild;
              if (providedEmptyOption) {
                selectElement.prepend(emptyOption);
              }
              currentElement = skipEmptyAndUnknownOptions(currentElement);
              options.items.forEach(function updateOption(option) {
                var group;
                var groupElement;
                var optionElement;
                if (option.group) {
                  group = groupMap[option.group];
                  if (!group) {
                    groupElement = addOrReuseElement(selectElement[0], currentElement, 'optgroup', optGroupTemplate);
                    currentElement = groupElement.nextSibling;
                    groupElement.label = option.group;
                    group = groupMap[option.group] = {
                      groupElement: groupElement,
                      currentOptionElement: groupElement.firstChild
                    };
                  }
                  optionElement = addOrReuseElement(group.groupElement, group.currentOptionElement, 'option', optionTemplate);
                  updateOptionElement(option, optionElement);
                  group.currentOptionElement = optionElement.nextSibling;
                } else {
                  optionElement = addOrReuseElement(selectElement[0], currentElement, 'option', optionTemplate);
                  updateOptionElement(option, optionElement);
                  currentElement = optionElement.nextSibling;
                }
              });
              Object.keys(groupMap).forEach(function(key) {
                removeExcessElements(groupMap[key].currentOptionElement);
              });
              removeExcessElements(currentElement);
              ngModelCtrl.$render();
              if (!ngModelCtrl.$isEmpty(previousValue)) {
                var nextValue = selectCtrl.readValue();
                if (ngOptions.trackBy ? !equals(previousValue, nextValue) : previousValue !== nextValue) {
                  ngModelCtrl.$setViewValue(nextValue);
                  ngModelCtrl.$render();
                }
              }
            }
          }
        };
      }];
      var ngPluralizeDirective = ['$locale', '$interpolate', '$log', function($locale, $interpolate, $log) {
        var BRACE = /{}/g,
            IS_WHEN = /^when(Minus)?(.+)$/;
        return {link: function(scope, element, attr) {
            var numberExp = attr.count,
                whenExp = attr.$attr.when && element.attr(attr.$attr.when),
                offset = attr.offset || 0,
                whens = scope.$eval(whenExp) || {},
                whensExpFns = {},
                startSymbol = $interpolate.startSymbol(),
                endSymbol = $interpolate.endSymbol(),
                braceReplacement = startSymbol + numberExp + '-' + offset + endSymbol,
                watchRemover = angular.noop,
                lastCount;
            forEach(attr, function(expression, attributeName) {
              var tmpMatch = IS_WHEN.exec(attributeName);
              if (tmpMatch) {
                var whenKey = (tmpMatch[1] ? '-' : '') + lowercase(tmpMatch[2]);
                whens[whenKey] = element.attr(attr.$attr[attributeName]);
              }
            });
            forEach(whens, function(expression, key) {
              whensExpFns[key] = $interpolate(expression.replace(BRACE, braceReplacement));
            });
            scope.$watch(numberExp, function ngPluralizeWatchAction(newVal) {
              var count = parseFloat(newVal);
              var countIsNaN = isNaN(count);
              if (!countIsNaN && !(count in whens)) {
                count = $locale.pluralCat(count - offset);
              }
              if ((count !== lastCount) && !(countIsNaN && isNumber(lastCount) && isNaN(lastCount))) {
                watchRemover();
                var whenExpFn = whensExpFns[count];
                if (isUndefined(whenExpFn)) {
                  if (newVal != null) {
                    $log.debug("ngPluralize: no rule defined for '" + count + "' in " + whenExp);
                  }
                  watchRemover = noop;
                  updateElementText();
                } else {
                  watchRemover = scope.$watch(whenExpFn, updateElementText);
                }
                lastCount = count;
              }
            });
            function updateElementText(newText) {
              element.text(newText || '');
            }
          }};
      }];
      var ngRepeatDirective = ['$parse', '$animate', function($parse, $animate) {
        var NG_REMOVED = '$$NG_REMOVED';
        var ngRepeatMinErr = minErr('ngRepeat');
        var updateScope = function(scope, index, valueIdentifier, value, keyIdentifier, key, arrayLength) {
          scope[valueIdentifier] = value;
          if (keyIdentifier)
            scope[keyIdentifier] = key;
          scope.$index = index;
          scope.$first = (index === 0);
          scope.$last = (index === (arrayLength - 1));
          scope.$middle = !(scope.$first || scope.$last);
          scope.$odd = !(scope.$even = (index & 1) === 0);
        };
        var getBlockStart = function(block) {
          return block.clone[0];
        };
        var getBlockEnd = function(block) {
          return block.clone[block.clone.length - 1];
        };
        return {
          restrict: 'A',
          multiElement: true,
          transclude: 'element',
          priority: 1000,
          terminal: true,
          $$tlb: true,
          compile: function ngRepeatCompile($element, $attr) {
            var expression = $attr.ngRepeat;
            var ngRepeatEndComment = document.createComment(' end ngRepeat: ' + expression + ' ');
            var match = expression.match(/^\s*([\s\S]+?)\s+in\s+([\s\S]+?)(?:\s+as\s+([\s\S]+?))?(?:\s+track\s+by\s+([\s\S]+?))?\s*$/);
            if (!match) {
              throw ngRepeatMinErr('iexp', "Expected expression in form of '_item_ in _collection_[ track by _id_]' but got '{0}'.", expression);
            }
            var lhs = match[1];
            var rhs = match[2];
            var aliasAs = match[3];
            var trackByExp = match[4];
            match = lhs.match(/^(?:(\s*[\$\w]+)|\(\s*([\$\w]+)\s*,\s*([\$\w]+)\s*\))$/);
            if (!match) {
              throw ngRepeatMinErr('iidexp', "'_item_' in '_item_ in _collection_' should be an identifier or '(_key_, _value_)' expression, but got '{0}'.", lhs);
            }
            var valueIdentifier = match[3] || match[1];
            var keyIdentifier = match[2];
            if (aliasAs && (!/^[$a-zA-Z_][$a-zA-Z0-9_]*$/.test(aliasAs) || /^(null|undefined|this|\$index|\$first|\$middle|\$last|\$even|\$odd|\$parent|\$root|\$id)$/.test(aliasAs))) {
              throw ngRepeatMinErr('badident', "alias '{0}' is invalid --- must be a valid JS identifier which is not a reserved name.", aliasAs);
            }
            var trackByExpGetter,
                trackByIdExpFn,
                trackByIdArrayFn,
                trackByIdObjFn;
            var hashFnLocals = {$id: hashKey};
            if (trackByExp) {
              trackByExpGetter = $parse(trackByExp);
            } else {
              trackByIdArrayFn = function(key, value) {
                return hashKey(value);
              };
              trackByIdObjFn = function(key) {
                return key;
              };
            }
            return function ngRepeatLink($scope, $element, $attr, ctrl, $transclude) {
              if (trackByExpGetter) {
                trackByIdExpFn = function(key, value, index) {
                  if (keyIdentifier)
                    hashFnLocals[keyIdentifier] = key;
                  hashFnLocals[valueIdentifier] = value;
                  hashFnLocals.$index = index;
                  return trackByExpGetter($scope, hashFnLocals);
                };
              }
              var lastBlockMap = createMap();
              $scope.$watchCollection(rhs, function ngRepeatAction(collection) {
                var index,
                    length,
                    previousNode = $element[0],
                    nextNode,
                    nextBlockMap = createMap(),
                    collectionLength,
                    key,
                    value,
                    trackById,
                    trackByIdFn,
                    collectionKeys,
                    block,
                    nextBlockOrder,
                    elementsToRemove;
                if (aliasAs) {
                  $scope[aliasAs] = collection;
                }
                if (isArrayLike(collection)) {
                  collectionKeys = collection;
                  trackByIdFn = trackByIdExpFn || trackByIdArrayFn;
                } else {
                  trackByIdFn = trackByIdExpFn || trackByIdObjFn;
                  collectionKeys = [];
                  for (var itemKey in collection) {
                    if (hasOwnProperty.call(collection, itemKey) && itemKey.charAt(0) !== '$') {
                      collectionKeys.push(itemKey);
                    }
                  }
                }
                collectionLength = collectionKeys.length;
                nextBlockOrder = new Array(collectionLength);
                for (index = 0; index < collectionLength; index++) {
                  key = (collection === collectionKeys) ? index : collectionKeys[index];
                  value = collection[key];
                  trackById = trackByIdFn(key, value, index);
                  if (lastBlockMap[trackById]) {
                    block = lastBlockMap[trackById];
                    delete lastBlockMap[trackById];
                    nextBlockMap[trackById] = block;
                    nextBlockOrder[index] = block;
                  } else if (nextBlockMap[trackById]) {
                    forEach(nextBlockOrder, function(block) {
                      if (block && block.scope)
                        lastBlockMap[block.id] = block;
                    });
                    throw ngRepeatMinErr('dupes', "Duplicates in a repeater are not allowed. Use 'track by' expression to specify unique keys. Repeater: {0}, Duplicate key: {1}, Duplicate value: {2}", expression, trackById, value);
                  } else {
                    nextBlockOrder[index] = {
                      id: trackById,
                      scope: undefined,
                      clone: undefined
                    };
                    nextBlockMap[trackById] = true;
                  }
                }
                for (var blockKey in lastBlockMap) {
                  block = lastBlockMap[blockKey];
                  elementsToRemove = getBlockNodes(block.clone);
                  $animate.leave(elementsToRemove);
                  if (elementsToRemove[0].parentNode) {
                    for (index = 0, length = elementsToRemove.length; index < length; index++) {
                      elementsToRemove[index][NG_REMOVED] = true;
                    }
                  }
                  block.scope.$destroy();
                }
                for (index = 0; index < collectionLength; index++) {
                  key = (collection === collectionKeys) ? index : collectionKeys[index];
                  value = collection[key];
                  block = nextBlockOrder[index];
                  if (block.scope) {
                    nextNode = previousNode;
                    do {
                      nextNode = nextNode.nextSibling;
                    } while (nextNode && nextNode[NG_REMOVED]);
                    if (getBlockStart(block) != nextNode) {
                      $animate.move(getBlockNodes(block.clone), null, jqLite(previousNode));
                    }
                    previousNode = getBlockEnd(block);
                    updateScope(block.scope, index, valueIdentifier, value, keyIdentifier, key, collectionLength);
                  } else {
                    $transclude(function ngRepeatTransclude(clone, scope) {
                      block.scope = scope;
                      var endNode = ngRepeatEndComment.cloneNode(false);
                      clone[clone.length++] = endNode;
                      $animate.enter(clone, null, jqLite(previousNode));
                      previousNode = endNode;
                      block.clone = clone;
                      nextBlockMap[block.id] = block;
                      updateScope(block.scope, index, valueIdentifier, value, keyIdentifier, key, collectionLength);
                    });
                  }
                }
                lastBlockMap = nextBlockMap;
              });
            };
          }
        };
      }];
      var NG_HIDE_CLASS = 'ng-hide';
      var NG_HIDE_IN_PROGRESS_CLASS = 'ng-hide-animate';
      var ngShowDirective = ['$animate', function($animate) {
        return {
          restrict: 'A',
          multiElement: true,
          link: function(scope, element, attr) {
            scope.$watch(attr.ngShow, function ngShowWatchAction(value) {
              $animate[value ? 'removeClass' : 'addClass'](element, NG_HIDE_CLASS, {tempClasses: NG_HIDE_IN_PROGRESS_CLASS});
            });
          }
        };
      }];
      var ngHideDirective = ['$animate', function($animate) {
        return {
          restrict: 'A',
          multiElement: true,
          link: function(scope, element, attr) {
            scope.$watch(attr.ngHide, function ngHideWatchAction(value) {
              $animate[value ? 'addClass' : 'removeClass'](element, NG_HIDE_CLASS, {tempClasses: NG_HIDE_IN_PROGRESS_CLASS});
            });
          }
        };
      }];
      var ngStyleDirective = ngDirective(function(scope, element, attr) {
        scope.$watch(attr.ngStyle, function ngStyleWatchAction(newStyles, oldStyles) {
          if (oldStyles && (newStyles !== oldStyles)) {
            forEach(oldStyles, function(val, style) {
              element.css(style, '');
            });
          }
          if (newStyles)
            element.css(newStyles);
        }, true);
      });
      var ngSwitchDirective = ['$animate', function($animate) {
        return {
          require: 'ngSwitch',
          controller: ['$scope', function ngSwitchController() {
            this.cases = {};
          }],
          link: function(scope, element, attr, ngSwitchController) {
            var watchExpr = attr.ngSwitch || attr.on,
                selectedTranscludes = [],
                selectedElements = [],
                previousLeaveAnimations = [],
                selectedScopes = [];
            var spliceFactory = function(array, index) {
              return function() {
                array.splice(index, 1);
              };
            };
            scope.$watch(watchExpr, function ngSwitchWatchAction(value) {
              var i,
                  ii;
              for (i = 0, ii = previousLeaveAnimations.length; i < ii; ++i) {
                $animate.cancel(previousLeaveAnimations[i]);
              }
              previousLeaveAnimations.length = 0;
              for (i = 0, ii = selectedScopes.length; i < ii; ++i) {
                var selected = getBlockNodes(selectedElements[i].clone);
                selectedScopes[i].$destroy();
                var promise = previousLeaveAnimations[i] = $animate.leave(selected);
                promise.then(spliceFactory(previousLeaveAnimations, i));
              }
              selectedElements.length = 0;
              selectedScopes.length = 0;
              if ((selectedTranscludes = ngSwitchController.cases['!' + value] || ngSwitchController.cases['?'])) {
                forEach(selectedTranscludes, function(selectedTransclude) {
                  selectedTransclude.transclude(function(caseElement, selectedScope) {
                    selectedScopes.push(selectedScope);
                    var anchor = selectedTransclude.element;
                    caseElement[caseElement.length++] = document.createComment(' end ngSwitchWhen: ');
                    var block = {clone: caseElement};
                    selectedElements.push(block);
                    $animate.enter(caseElement, anchor.parent(), anchor);
                  });
                });
              }
            });
          }
        };
      }];
      var ngSwitchWhenDirective = ngDirective({
        transclude: 'element',
        priority: 1200,
        require: '^ngSwitch',
        multiElement: true,
        link: function(scope, element, attrs, ctrl, $transclude) {
          ctrl.cases['!' + attrs.ngSwitchWhen] = (ctrl.cases['!' + attrs.ngSwitchWhen] || []);
          ctrl.cases['!' + attrs.ngSwitchWhen].push({
            transclude: $transclude,
            element: element
          });
        }
      });
      var ngSwitchDefaultDirective = ngDirective({
        transclude: 'element',
        priority: 1200,
        require: '^ngSwitch',
        multiElement: true,
        link: function(scope, element, attr, ctrl, $transclude) {
          ctrl.cases['?'] = (ctrl.cases['?'] || []);
          ctrl.cases['?'].push({
            transclude: $transclude,
            element: element
          });
        }
      });
      var ngTranscludeDirective = ngDirective({
        restrict: 'EAC',
        link: function($scope, $element, $attrs, controller, $transclude) {
          if (!$transclude) {
            throw minErr('ngTransclude')('orphan', 'Illegal use of ngTransclude directive in the template! ' + 'No parent directive that requires a transclusion found. ' + 'Element: {0}', startingTag($element));
          }
          $transclude(function(clone) {
            $element.empty();
            $element.append(clone);
          });
        }
      });
      var scriptDirective = ['$templateCache', function($templateCache) {
        return {
          restrict: 'E',
          terminal: true,
          compile: function(element, attr) {
            if (attr.type == 'text/ng-template') {
              var templateUrl = attr.id,
                  text = element[0].text;
              $templateCache.put(templateUrl, text);
            }
          }
        };
      }];
      var noopNgModelController = {
        $setViewValue: noop,
        $render: noop
      };
      var SelectController = ['$element', '$scope', '$attrs', function($element, $scope, $attrs) {
        var self = this,
            optionsMap = new HashMap();
        self.ngModelCtrl = noopNgModelController;
        self.unknownOption = jqLite(document.createElement('option'));
        self.renderUnknownOption = function(val) {
          var unknownVal = '? ' + hashKey(val) + ' ?';
          self.unknownOption.val(unknownVal);
          $element.prepend(self.unknownOption);
          $element.val(unknownVal);
        };
        $scope.$on('$destroy', function() {
          self.renderUnknownOption = noop;
        });
        self.removeUnknownOption = function() {
          if (self.unknownOption.parent())
            self.unknownOption.remove();
        };
        self.readValue = function readSingleValue() {
          self.removeUnknownOption();
          return $element.val();
        };
        self.writeValue = function writeSingleValue(value) {
          if (self.hasOption(value)) {
            self.removeUnknownOption();
            $element.val(value);
            if (value === '')
              self.emptyOption.prop('selected', true);
          } else {
            if (value == null && self.emptyOption) {
              self.removeUnknownOption();
              $element.val('');
            } else {
              self.renderUnknownOption(value);
            }
          }
        };
        self.addOption = function(value, element) {
          assertNotHasOwnProperty(value, '"option value"');
          if (value === '') {
            self.emptyOption = element;
          }
          var count = optionsMap.get(value) || 0;
          optionsMap.put(value, count + 1);
        };
        self.removeOption = function(value) {
          var count = optionsMap.get(value);
          if (count) {
            if (count === 1) {
              optionsMap.remove(value);
              if (value === '') {
                self.emptyOption = undefined;
              }
            } else {
              optionsMap.put(value, count - 1);
            }
          }
        };
        self.hasOption = function(value) {
          return !!optionsMap.get(value);
        };
      }];
      var selectDirective = function() {
        return {
          restrict: 'E',
          require: ['select', '?ngModel'],
          controller: SelectController,
          link: function(scope, element, attr, ctrls) {
            var ngModelCtrl = ctrls[1];
            if (!ngModelCtrl)
              return;
            var selectCtrl = ctrls[0];
            selectCtrl.ngModelCtrl = ngModelCtrl;
            ngModelCtrl.$render = function() {
              selectCtrl.writeValue(ngModelCtrl.$viewValue);
            };
            element.on('change', function() {
              scope.$apply(function() {
                ngModelCtrl.$setViewValue(selectCtrl.readValue());
              });
            });
            if (attr.multiple) {
              selectCtrl.readValue = function readMultipleValue() {
                var array = [];
                forEach(element.find('option'), function(option) {
                  if (option.selected) {
                    array.push(option.value);
                  }
                });
                return array;
              };
              selectCtrl.writeValue = function writeMultipleValue(value) {
                var items = new HashMap(value);
                forEach(element.find('option'), function(option) {
                  option.selected = isDefined(items.get(option.value));
                });
              };
              var lastView,
                  lastViewRef = NaN;
              scope.$watch(function selectMultipleWatch() {
                if (lastViewRef === ngModelCtrl.$viewValue && !equals(lastView, ngModelCtrl.$viewValue)) {
                  lastView = shallowCopy(ngModelCtrl.$viewValue);
                  ngModelCtrl.$render();
                }
                lastViewRef = ngModelCtrl.$viewValue;
              });
              ngModelCtrl.$isEmpty = function(value) {
                return !value || value.length === 0;
              };
            }
          }
        };
      };
      var optionDirective = ['$interpolate', function($interpolate) {
        function chromeHack(optionElement) {
          if (optionElement[0].hasAttribute('selected')) {
            optionElement[0].selected = true;
          }
        }
        return {
          restrict: 'E',
          priority: 100,
          compile: function(element, attr) {
            if (isDefined(attr.value)) {
              var valueInterpolated = $interpolate(attr.value, true);
            } else {
              var interpolateFn = $interpolate(element.text(), true);
              if (!interpolateFn) {
                attr.$set('value', element.text());
              }
            }
            return function(scope, element, attr) {
              var selectCtrlName = '$selectController',
                  parent = element.parent(),
                  selectCtrl = parent.data(selectCtrlName) || parent.parent().data(selectCtrlName);
              function addOption(optionValue) {
                selectCtrl.addOption(optionValue, element);
                selectCtrl.ngModelCtrl.$render();
                chromeHack(element);
              }
              if (selectCtrl && selectCtrl.ngModelCtrl) {
                if (valueInterpolated) {
                  var oldVal;
                  attr.$observe('value', function valueAttributeObserveAction(newVal) {
                    if (isDefined(oldVal)) {
                      selectCtrl.removeOption(oldVal);
                    }
                    oldVal = newVal;
                    addOption(newVal);
                  });
                } else if (interpolateFn) {
                  scope.$watch(interpolateFn, function interpolateWatchAction(newVal, oldVal) {
                    attr.$set('value', newVal);
                    if (oldVal !== newVal) {
                      selectCtrl.removeOption(oldVal);
                    }
                    addOption(newVal);
                  });
                } else {
                  addOption(attr.value);
                }
                element.on('$destroy', function() {
                  selectCtrl.removeOption(attr.value);
                  selectCtrl.ngModelCtrl.$render();
                });
              }
            };
          }
        };
      }];
      var styleDirective = valueFn({
        restrict: 'E',
        terminal: false
      });
      var requiredDirective = function() {
        return {
          restrict: 'A',
          require: '?ngModel',
          link: function(scope, elm, attr, ctrl) {
            if (!ctrl)
              return;
            attr.required = true;
            ctrl.$validators.required = function(modelValue, viewValue) {
              return !attr.required || !ctrl.$isEmpty(viewValue);
            };
            attr.$observe('required', function() {
              ctrl.$validate();
            });
          }
        };
      };
      var patternDirective = function() {
        return {
          restrict: 'A',
          require: '?ngModel',
          link: function(scope, elm, attr, ctrl) {
            if (!ctrl)
              return;
            var regexp,
                patternExp = attr.ngPattern || attr.pattern;
            attr.$observe('pattern', function(regex) {
              if (isString(regex) && regex.length > 0) {
                regex = new RegExp('^' + regex + '$');
              }
              if (regex && !regex.test) {
                throw minErr('ngPattern')('noregexp', 'Expected {0} to be a RegExp but was {1}. Element: {2}', patternExp, regex, startingTag(elm));
              }
              regexp = regex || undefined;
              ctrl.$validate();
            });
            ctrl.$validators.pattern = function(modelValue, viewValue) {
              return ctrl.$isEmpty(viewValue) || isUndefined(regexp) || regexp.test(viewValue);
            };
          }
        };
      };
      var maxlengthDirective = function() {
        return {
          restrict: 'A',
          require: '?ngModel',
          link: function(scope, elm, attr, ctrl) {
            if (!ctrl)
              return;
            var maxlength = -1;
            attr.$observe('maxlength', function(value) {
              var intVal = toInt(value);
              maxlength = isNaN(intVal) ? -1 : intVal;
              ctrl.$validate();
            });
            ctrl.$validators.maxlength = function(modelValue, viewValue) {
              return (maxlength < 0) || ctrl.$isEmpty(viewValue) || (viewValue.length <= maxlength);
            };
          }
        };
      };
      var minlengthDirective = function() {
        return {
          restrict: 'A',
          require: '?ngModel',
          link: function(scope, elm, attr, ctrl) {
            if (!ctrl)
              return;
            var minlength = 0;
            attr.$observe('minlength', function(value) {
              minlength = toInt(value) || 0;
              ctrl.$validate();
            });
            ctrl.$validators.minlength = function(modelValue, viewValue) {
              return ctrl.$isEmpty(viewValue) || viewValue.length >= minlength;
            };
          }
        };
      };
      if (window.angular.bootstrap) {
        console.log('WARNING: Tried to load angular more than once.');
        return;
      }
      bindJQuery();
      publishExternalAPI(angular);
      angular.module("ngLocale", [], ["$provide", function($provide) {
        var PLURAL_CATEGORY = {
          ZERO: "zero",
          ONE: "one",
          TWO: "two",
          FEW: "few",
          MANY: "many",
          OTHER: "other"
        };
        function getDecimals(n) {
          n = n + '';
          var i = n.indexOf('.');
          return (i == -1) ? 0 : n.length - i - 1;
        }
        function getVF(n, opt_precision) {
          var v = opt_precision;
          if (undefined === v) {
            v = Math.min(getDecimals(n), 3);
          }
          var base = Math.pow(10, v);
          var f = ((n * base) | 0) % base;
          return {
            v: v,
            f: f
          };
        }
        $provide.value("$locale", {
          "DATETIME_FORMATS": {
            "AMPMS": ["AM", "PM"],
            "DAY": ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
            "ERANAMES": ["Before Christ", "Anno Domini"],
            "ERAS": ["BC", "AD"],
            "FIRSTDAYOFWEEK": 6,
            "MONTH": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
            "SHORTDAY": ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
            "SHORTMONTH": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
            "WEEKENDRANGE": [5, 6],
            "fullDate": "EEEE, MMMM d, y",
            "longDate": "MMMM d, y",
            "medium": "MMM d, y h:mm:ss a",
            "mediumDate": "MMM d, y",
            "mediumTime": "h:mm:ss a",
            "short": "M/d/yy h:mm a",
            "shortDate": "M/d/yy",
            "shortTime": "h:mm a"
          },
          "NUMBER_FORMATS": {
            "CURRENCY_SYM": "$",
            "DECIMAL_SEP": ".",
            "GROUP_SEP": ",",
            "PATTERNS": [{
              "gSize": 3,
              "lgSize": 3,
              "maxFrac": 3,
              "minFrac": 0,
              "minInt": 1,
              "negPre": "-",
              "negSuf": "",
              "posPre": "",
              "posSuf": ""
            }, {
              "gSize": 3,
              "lgSize": 3,
              "maxFrac": 2,
              "minFrac": 2,
              "minInt": 1,
              "negPre": "-\u00a4",
              "negSuf": "",
              "posPre": "\u00a4",
              "posSuf": ""
            }]
          },
          "id": "en-us",
          "pluralCat": function(n, opt_precision) {
            var i = n | 0;
            var vf = getVF(n, opt_precision);
            if (i == 1 && vf.v == 0) {
              return PLURAL_CATEGORY.ONE;
            }
            return PLURAL_CATEGORY.OTHER;
          }
        });
      }]);
      jqLite(document).ready(function() {
        angularInit(document, bootstrap);
      });
    })(window, document);
    !window.angular.$$csp().noInlineStyle && window.angular.element(document.head).prepend('<style type="text/css">@charset "UTF-8";[ng\\:cloak],[ng-cloak],[data-ng-cloak],[x-ng-cloak],.ng-cloak,.x-ng-cloak,.ng-hide:not(.ng-hide-animate){display:none !important;}ng\\:form{display:block;}.ng-animate-shim{visibility:hidden;}.ng-anchor{position:absolute;}</style>');
  })(require("5"));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("7", ["6"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  require("6");
  module.exports = angular;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("8", ["7"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = require("7");
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("9", ["5"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  "format cjs";
  (function(process) {
    (function(global) {
      "use strict";
      var Long = function(low, high, unsigned) {
        this.low = low | 0;
        this.high = high | 0;
        this.unsigned = !!unsigned;
      };
      Long.isLong = function(obj) {
        return (obj && obj instanceof Long) === true;
      };
      var INT_CACHE = {};
      var UINT_CACHE = {};
      Long.fromInt = function(value, unsigned) {
        var obj,
            cachedObj;
        if (!unsigned) {
          value = value | 0;
          if (-128 <= value && value < 128) {
            cachedObj = INT_CACHE[value];
            if (cachedObj)
              return cachedObj;
          }
          obj = new Long(value, value < 0 ? -1 : 0, false);
          if (-128 <= value && value < 128)
            INT_CACHE[value] = obj;
          return obj;
        } else {
          value = value >>> 0;
          if (0 <= value && value < 256) {
            cachedObj = UINT_CACHE[value];
            if (cachedObj)
              return cachedObj;
          }
          obj = new Long(value, (value | 0) < 0 ? -1 : 0, true);
          if (0 <= value && value < 256)
            UINT_CACHE[value] = obj;
          return obj;
        }
      };
      Long.fromNumber = function(value, unsigned) {
        unsigned = !!unsigned;
        if (isNaN(value) || !isFinite(value))
          return Long.ZERO;
        if (!unsigned && value <= -TWO_PWR_63_DBL)
          return Long.MIN_VALUE;
        if (!unsigned && value + 1 >= TWO_PWR_63_DBL)
          return Long.MAX_VALUE;
        if (unsigned && value >= TWO_PWR_64_DBL)
          return Long.MAX_UNSIGNED_VALUE;
        if (value < 0)
          return Long.fromNumber(-value, unsigned).negate();
        return new Long((value % TWO_PWR_32_DBL) | 0, (value / TWO_PWR_32_DBL) | 0, unsigned);
      };
      Long.fromBits = function(lowBits, highBits, unsigned) {
        return new Long(lowBits, highBits, unsigned);
      };
      Long.fromString = function(str, unsigned, radix) {
        if (str.length === 0)
          throw Error('number format error: empty string');
        if (str === "NaN" || str === "Infinity" || str === "+Infinity" || str === "-Infinity")
          return Long.ZERO;
        if (typeof unsigned === 'number')
          radix = unsigned, unsigned = false;
        radix = radix || 10;
        if (radix < 2 || 36 < radix)
          throw Error('radix out of range: ' + radix);
        var p;
        if ((p = str.indexOf('-')) > 0)
          throw Error('number format error: interior "-" character: ' + str);
        else if (p === 0)
          return Long.fromString(str.substring(1), unsigned, radix).negate();
        var radixToPower = Long.fromNumber(Math.pow(radix, 8));
        var result = Long.ZERO;
        for (var i = 0; i < str.length; i += 8) {
          var size = Math.min(8, str.length - i);
          var value = parseInt(str.substring(i, i + size), radix);
          if (size < 8) {
            var power = Long.fromNumber(Math.pow(radix, size));
            result = result.multiply(power).add(Long.fromNumber(value));
          } else {
            result = result.multiply(radixToPower);
            result = result.add(Long.fromNumber(value));
          }
        }
        result.unsigned = unsigned;
        return result;
      };
      Long.fromValue = function(val) {
        if (typeof val === 'number')
          return Long.fromNumber(val);
        if (typeof val === 'string')
          return Long.fromString(val);
        if (Long.isLong(val))
          return val;
        return new Long(val.low, val.high, val.unsigned);
      };
      var TWO_PWR_16_DBL = 1 << 16;
      var TWO_PWR_24_DBL = 1 << 24;
      var TWO_PWR_32_DBL = TWO_PWR_16_DBL * TWO_PWR_16_DBL;
      var TWO_PWR_64_DBL = TWO_PWR_32_DBL * TWO_PWR_32_DBL;
      var TWO_PWR_63_DBL = TWO_PWR_64_DBL / 2;
      var TWO_PWR_24 = Long.fromInt(TWO_PWR_24_DBL);
      Long.ZERO = Long.fromInt(0);
      Long.UZERO = Long.fromInt(0, true);
      Long.ONE = Long.fromInt(1);
      Long.UONE = Long.fromInt(1, true);
      Long.NEG_ONE = Long.fromInt(-1);
      Long.MAX_VALUE = Long.fromBits(0xFFFFFFFF | 0, 0x7FFFFFFF | 0, false);
      Long.MAX_UNSIGNED_VALUE = Long.fromBits(0xFFFFFFFF | 0, 0xFFFFFFFF | 0, true);
      Long.MIN_VALUE = Long.fromBits(0, 0x80000000 | 0, false);
      Long.prototype.toInt = function() {
        return this.unsigned ? this.low >>> 0 : this.low;
      };
      Long.prototype.toNumber = function() {
        if (this.unsigned) {
          return ((this.high >>> 0) * TWO_PWR_32_DBL) + (this.low >>> 0);
        }
        return this.high * TWO_PWR_32_DBL + (this.low >>> 0);
      };
      Long.prototype.toString = function(radix) {
        radix = radix || 10;
        if (radix < 2 || 36 < radix)
          throw RangeError('radix out of range: ' + radix);
        if (this.isZero())
          return '0';
        var rem;
        if (this.isNegative()) {
          if (this.equals(Long.MIN_VALUE)) {
            var radixLong = Long.fromNumber(radix);
            var div = this.div(radixLong);
            rem = div.multiply(radixLong).subtract(this);
            return div.toString(radix) + rem.toInt().toString(radix);
          } else
            return '-' + this.negate().toString(radix);
        }
        var radixToPower = Long.fromNumber(Math.pow(radix, 6), this.unsigned);
        rem = this;
        var result = '';
        while (true) {
          var remDiv = rem.div(radixToPower),
              intval = rem.subtract(remDiv.multiply(radixToPower)).toInt() >>> 0,
              digits = intval.toString(radix);
          rem = remDiv;
          if (rem.isZero())
            return digits + result;
          else {
            while (digits.length < 6)
              digits = '0' + digits;
            result = '' + digits + result;
          }
        }
      };
      Long.prototype.getHighBits = function() {
        return this.high;
      };
      Long.prototype.getHighBitsUnsigned = function() {
        return this.high >>> 0;
      };
      Long.prototype.getLowBits = function() {
        return this.low;
      };
      Long.prototype.getLowBitsUnsigned = function() {
        return this.low >>> 0;
      };
      Long.prototype.getNumBitsAbs = function() {
        if (this.isNegative())
          return this.equals(Long.MIN_VALUE) ? 64 : this.negate().getNumBitsAbs();
        var val = this.high != 0 ? this.high : this.low;
        for (var bit = 31; bit > 0; bit--)
          if ((val & (1 << bit)) != 0)
            break;
        return this.high != 0 ? bit + 33 : bit + 1;
      };
      Long.prototype.isZero = function() {
        return this.high === 0 && this.low === 0;
      };
      Long.prototype.isNegative = function() {
        return !this.unsigned && this.high < 0;
      };
      Long.prototype.isPositive = function() {
        return this.unsigned || this.high >= 0;
      };
      Long.prototype.isOdd = function() {
        return (this.low & 1) === 1;
      };
      Long.prototype.isEven = function() {
        return (this.low & 1) === 0;
      };
      Long.prototype.equals = function(other) {
        if (!Long.isLong(other))
          other = Long.fromValue(other);
        if (this.unsigned !== other.unsigned && (this.high >>> 31) === 1 && (other.high >>> 31) === 1)
          return false;
        return this.high === other.high && this.low === other.low;
      };
      Long.prototype.notEquals = function(other) {
        if (!Long.isLong(other))
          other = Long.fromValue(other);
        return !this.equals(other);
      };
      Long.prototype.lessThan = function(other) {
        if (!Long.isLong(other))
          other = Long.fromValue(other);
        return this.compare(other) < 0;
      };
      Long.prototype.lessThanOrEqual = function(other) {
        if (!Long.isLong(other))
          other = Long.fromValue(other);
        return this.compare(other) <= 0;
      };
      Long.prototype.greaterThan = function(other) {
        if (!Long.isLong(other))
          other = Long.fromValue(other);
        return this.compare(other) > 0;
      };
      Long.prototype.greaterThanOrEqual = function(other) {
        if (!Long.isLong(other))
          other = Long.fromValue(other);
        return this.compare(other) >= 0;
      };
      Long.prototype.compare = function(other) {
        if (this.equals(other))
          return 0;
        var thisNeg = this.isNegative(),
            otherNeg = other.isNegative();
        if (thisNeg && !otherNeg)
          return -1;
        if (!thisNeg && otherNeg)
          return 1;
        if (!this.unsigned)
          return this.subtract(other).isNegative() ? -1 : 1;
        return (other.high >>> 0) > (this.high >>> 0) || (other.high === this.high && (other.low >>> 0) > (this.low >>> 0)) ? -1 : 1;
      };
      Long.prototype.negate = function() {
        if (!this.unsigned && this.equals(Long.MIN_VALUE))
          return Long.MIN_VALUE;
        return this.not().add(Long.ONE);
      };
      Long.prototype.add = function(addend) {
        if (!Long.isLong(addend))
          addend = Long.fromValue(addend);
        var a48 = this.high >>> 16;
        var a32 = this.high & 0xFFFF;
        var a16 = this.low >>> 16;
        var a00 = this.low & 0xFFFF;
        var b48 = addend.high >>> 16;
        var b32 = addend.high & 0xFFFF;
        var b16 = addend.low >>> 16;
        var b00 = addend.low & 0xFFFF;
        var c48 = 0,
            c32 = 0,
            c16 = 0,
            c00 = 0;
        c00 += a00 + b00;
        c16 += c00 >>> 16;
        c00 &= 0xFFFF;
        c16 += a16 + b16;
        c32 += c16 >>> 16;
        c16 &= 0xFFFF;
        c32 += a32 + b32;
        c48 += c32 >>> 16;
        c32 &= 0xFFFF;
        c48 += a48 + b48;
        c48 &= 0xFFFF;
        return Long.fromBits((c16 << 16) | c00, (c48 << 16) | c32, this.unsigned);
      };
      Long.prototype.subtract = function(subtrahend) {
        if (!Long.isLong(subtrahend))
          subtrahend = Long.fromValue(subtrahend);
        return this.add(subtrahend.negate());
      };
      Long.prototype.multiply = function(multiplier) {
        if (this.isZero())
          return Long.ZERO;
        if (!Long.isLong(multiplier))
          multiplier = Long.fromValue(multiplier);
        if (multiplier.isZero())
          return Long.ZERO;
        if (this.equals(Long.MIN_VALUE))
          return multiplier.isOdd() ? Long.MIN_VALUE : Long.ZERO;
        if (multiplier.equals(Long.MIN_VALUE))
          return this.isOdd() ? Long.MIN_VALUE : Long.ZERO;
        if (this.isNegative()) {
          if (multiplier.isNegative())
            return this.negate().multiply(multiplier.negate());
          else
            return this.negate().multiply(multiplier).negate();
        } else if (multiplier.isNegative())
          return this.multiply(multiplier.negate()).negate();
        if (this.lessThan(TWO_PWR_24) && multiplier.lessThan(TWO_PWR_24))
          return Long.fromNumber(this.toNumber() * multiplier.toNumber(), this.unsigned);
        var a48 = this.high >>> 16;
        var a32 = this.high & 0xFFFF;
        var a16 = this.low >>> 16;
        var a00 = this.low & 0xFFFF;
        var b48 = multiplier.high >>> 16;
        var b32 = multiplier.high & 0xFFFF;
        var b16 = multiplier.low >>> 16;
        var b00 = multiplier.low & 0xFFFF;
        var c48 = 0,
            c32 = 0,
            c16 = 0,
            c00 = 0;
        c00 += a00 * b00;
        c16 += c00 >>> 16;
        c00 &= 0xFFFF;
        c16 += a16 * b00;
        c32 += c16 >>> 16;
        c16 &= 0xFFFF;
        c16 += a00 * b16;
        c32 += c16 >>> 16;
        c16 &= 0xFFFF;
        c32 += a32 * b00;
        c48 += c32 >>> 16;
        c32 &= 0xFFFF;
        c32 += a16 * b16;
        c48 += c32 >>> 16;
        c32 &= 0xFFFF;
        c32 += a00 * b32;
        c48 += c32 >>> 16;
        c32 &= 0xFFFF;
        c48 += a48 * b00 + a32 * b16 + a16 * b32 + a00 * b48;
        c48 &= 0xFFFF;
        return Long.fromBits((c16 << 16) | c00, (c48 << 16) | c32, this.unsigned);
      };
      Long.prototype.div = function(divisor) {
        if (!Long.isLong(divisor))
          divisor = Long.fromValue(divisor);
        if (divisor.isZero())
          throw (new Error('division by zero'));
        if (this.isZero())
          return this.unsigned ? Long.UZERO : Long.ZERO;
        var approx,
            rem,
            res;
        if (this.equals(Long.MIN_VALUE)) {
          if (divisor.equals(Long.ONE) || divisor.equals(Long.NEG_ONE))
            return Long.MIN_VALUE;
          else if (divisor.equals(Long.MIN_VALUE))
            return Long.ONE;
          else {
            var halfThis = this.shiftRight(1);
            approx = halfThis.div(divisor).shiftLeft(1);
            if (approx.equals(Long.ZERO)) {
              return divisor.isNegative() ? Long.ONE : Long.NEG_ONE;
            } else {
              rem = this.subtract(divisor.multiply(approx));
              res = approx.add(rem.div(divisor));
              return res;
            }
          }
        } else if (divisor.equals(Long.MIN_VALUE))
          return this.unsigned ? Long.UZERO : Long.ZERO;
        if (this.isNegative()) {
          if (divisor.isNegative())
            return this.negate().div(divisor.negate());
          return this.negate().div(divisor).negate();
        } else if (divisor.isNegative())
          return this.div(divisor.negate()).negate();
        res = Long.ZERO;
        rem = this;
        while (rem.greaterThanOrEqual(divisor)) {
          approx = Math.max(1, Math.floor(rem.toNumber() / divisor.toNumber()));
          var log2 = Math.ceil(Math.log(approx) / Math.LN2),
              delta = (log2 <= 48) ? 1 : Math.pow(2, log2 - 48),
              approxRes = Long.fromNumber(approx),
              approxRem = approxRes.multiply(divisor);
          while (approxRem.isNegative() || approxRem.greaterThan(rem)) {
            approx -= delta;
            approxRes = Long.fromNumber(approx, this.unsigned);
            approxRem = approxRes.multiply(divisor);
          }
          if (approxRes.isZero())
            approxRes = Long.ONE;
          res = res.add(approxRes);
          rem = rem.subtract(approxRem);
        }
        return res;
      };
      Long.prototype.modulo = function(divisor) {
        if (!Long.isLong(divisor))
          divisor = Long.fromValue(divisor);
        return this.subtract(this.div(divisor).multiply(divisor));
      };
      Long.prototype.not = function() {
        return Long.fromBits(~this.low, ~this.high, this.unsigned);
      };
      Long.prototype.and = function(other) {
        if (!Long.isLong(other))
          other = Long.fromValue(other);
        return Long.fromBits(this.low & other.low, this.high & other.high, this.unsigned);
      };
      Long.prototype.or = function(other) {
        if (!Long.isLong(other))
          other = Long.fromValue(other);
        return Long.fromBits(this.low | other.low, this.high | other.high, this.unsigned);
      };
      Long.prototype.xor = function(other) {
        if (!Long.isLong(other))
          other = Long.fromValue(other);
        return Long.fromBits(this.low ^ other.low, this.high ^ other.high, this.unsigned);
      };
      Long.prototype.shiftLeft = function(numBits) {
        if (Long.isLong(numBits))
          numBits = numBits.toInt();
        if ((numBits &= 63) === 0)
          return this;
        else if (numBits < 32)
          return Long.fromBits(this.low << numBits, (this.high << numBits) | (this.low >>> (32 - numBits)), this.unsigned);
        else
          return Long.fromBits(0, this.low << (numBits - 32), this.unsigned);
      };
      Long.prototype.shiftRight = function(numBits) {
        if (Long.isLong(numBits))
          numBits = numBits.toInt();
        if ((numBits &= 63) === 0)
          return this;
        else if (numBits < 32)
          return Long.fromBits((this.low >>> numBits) | (this.high << (32 - numBits)), this.high >> numBits, this.unsigned);
        else
          return Long.fromBits(this.high >> (numBits - 32), this.high >= 0 ? 0 : -1, this.unsigned);
      };
      Long.prototype.shiftRightUnsigned = function(numBits) {
        if (Long.isLong(numBits))
          numBits = numBits.toInt();
        numBits &= 63;
        if (numBits === 0)
          return this;
        else {
          var high = this.high;
          if (numBits < 32) {
            var low = this.low;
            return Long.fromBits((low >>> numBits) | (high << (32 - numBits)), high >>> numBits, this.unsigned);
          } else if (numBits === 32)
            return Long.fromBits(high, 0, this.unsigned);
          else
            return Long.fromBits(high >>> (numBits - 32), 0, this.unsigned);
        }
      };
      Long.prototype.toSigned = function() {
        if (!this.unsigned)
          return this;
        return new Long(this.low, this.high, false);
      };
      Long.prototype.toUnsigned = function() {
        if (this.unsigned)
          return this;
        return new Long(this.low, this.high, true);
      };
      if (typeof require === 'function' && typeof module === 'object' && module && typeof exports === 'object' && exports)
        module["exports"] = Long;
      else if (typeof define === 'function' && define["amd"])
        define(function() {
          return Long;
        });
      else
        (global["dcodeIO"] = global["dcodeIO"] || {})["Long"] = Long;
    })(this);
  })(require("5"));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("a", ["9"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = require("9");
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("b", [], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  ;
  (function(exports) {
    'use strict';
    var Arr = (typeof Uint8Array !== 'undefined') ? Uint8Array : Array;
    var PLUS = '+'.charCodeAt(0);
    var SLASH = '/'.charCodeAt(0);
    var NUMBER = '0'.charCodeAt(0);
    var LOWER = 'a'.charCodeAt(0);
    var UPPER = 'A'.charCodeAt(0);
    var PLUS_URL_SAFE = '-'.charCodeAt(0);
    var SLASH_URL_SAFE = '_'.charCodeAt(0);
    function decode(elt) {
      var code = elt.charCodeAt(0);
      if (code === PLUS || code === PLUS_URL_SAFE)
        return 62;
      if (code === SLASH || code === SLASH_URL_SAFE)
        return 63;
      if (code < NUMBER)
        return -1;
      if (code < NUMBER + 10)
        return code - NUMBER + 26 + 26;
      if (code < UPPER + 26)
        return code - UPPER;
      if (code < LOWER + 26)
        return code - LOWER + 26;
    }
    function b64ToByteArray(b64) {
      var i,
          j,
          l,
          tmp,
          placeHolders,
          arr;
      if (b64.length % 4 > 0) {
        throw new Error('Invalid string. Length must be a multiple of 4');
      }
      var len = b64.length;
      placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0;
      arr = new Arr(b64.length * 3 / 4 - placeHolders);
      l = placeHolders > 0 ? b64.length - 4 : b64.length;
      var L = 0;
      function push(v) {
        arr[L++] = v;
      }
      for (i = 0, j = 0; i < l; i += 4, j += 3) {
        tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3));
        push((tmp & 0xFF0000) >> 16);
        push((tmp & 0xFF00) >> 8);
        push(tmp & 0xFF);
      }
      if (placeHolders === 2) {
        tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4);
        push(tmp & 0xFF);
      } else if (placeHolders === 1) {
        tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2);
        push((tmp >> 8) & 0xFF);
        push(tmp & 0xFF);
      }
      return arr;
    }
    function uint8ToBase64(uint8) {
      var i,
          extraBytes = uint8.length % 3,
          output = "",
          temp,
          length;
      function encode(num) {
        return lookup.charAt(num);
      }
      function tripletToBase64(num) {
        return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F);
      }
      for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
        temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2]);
        output += tripletToBase64(temp);
      }
      switch (extraBytes) {
        case 1:
          temp = uint8[uint8.length - 1];
          output += encode(temp >> 2);
          output += encode((temp << 4) & 0x3F);
          output += '==';
          break;
        case 2:
          temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1]);
          output += encode(temp >> 10);
          output += encode((temp >> 4) & 0x3F);
          output += encode((temp << 2) & 0x3F);
          output += '=';
          break;
      }
      return output;
    }
    exports.toByteArray = b64ToByteArray;
    exports.fromByteArray = uint8ToBase64;
  }(typeof exports === 'undefined' ? (this.base64js = {}) : exports));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("c", ["b"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = require("b");
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("d", [], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  exports.read = function(buffer, offset, isLE, mLen, nBytes) {
    var e,
        m;
    var eLen = nBytes * 8 - mLen - 1;
    var eMax = (1 << eLen) - 1;
    var eBias = eMax >> 1;
    var nBits = -7;
    var i = isLE ? (nBytes - 1) : 0;
    var d = isLE ? -1 : 1;
    var s = buffer[offset + i];
    i += d;
    e = s & ((1 << (-nBits)) - 1);
    s >>= (-nBits);
    nBits += eLen;
    for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}
    m = e & ((1 << (-nBits)) - 1);
    e >>= (-nBits);
    nBits += mLen;
    for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}
    if (e === 0) {
      e = 1 - eBias;
    } else if (e === eMax) {
      return m ? NaN : ((s ? -1 : 1) * Infinity);
    } else {
      m = m + Math.pow(2, mLen);
      e = e - eBias;
    }
    return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
  };
  exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
    var e,
        m,
        c;
    var eLen = nBytes * 8 - mLen - 1;
    var eMax = (1 << eLen) - 1;
    var eBias = eMax >> 1;
    var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0);
    var i = isLE ? 0 : (nBytes - 1);
    var d = isLE ? 1 : -1;
    var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;
    value = Math.abs(value);
    if (isNaN(value) || value === Infinity) {
      m = isNaN(value) ? 1 : 0;
      e = eMax;
    } else {
      e = Math.floor(Math.log(value) / Math.LN2);
      if (value * (c = Math.pow(2, -e)) < 1) {
        e--;
        c *= 2;
      }
      if (e + eBias >= 1) {
        value += rt / c;
      } else {
        value += rt * Math.pow(2, 1 - eBias);
      }
      if (value * c >= 2) {
        e++;
        c /= 2;
      }
      if (e + eBias >= eMax) {
        m = 0;
        e = eMax;
      } else if (e + eBias >= 1) {
        m = (value * c - 1) * Math.pow(2, mLen);
        e = e + eBias;
      } else {
        m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
        e = 0;
      }
    }
    for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}
    e = (e << mLen) | m;
    eLen += mLen;
    for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}
    buffer[offset + i - d] |= s * 128;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("e", ["d"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = require("d");
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("f", [], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var isArray = Array.isArray;
  var str = Object.prototype.toString;
  module.exports = isArray || function(val) {
    return !!val && '[object Array]' == str.call(val);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("10", ["f"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = require("f");
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("11", ["c", "e", "10"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var base64 = require("c");
  var ieee754 = require("e");
  var isArray = require("10");
  exports.Buffer = Buffer;
  exports.SlowBuffer = SlowBuffer;
  exports.INSPECT_MAX_BYTES = 50;
  Buffer.poolSize = 8192;
  var rootParent = {};
  Buffer.TYPED_ARRAY_SUPPORT = global.TYPED_ARRAY_SUPPORT !== undefined ? global.TYPED_ARRAY_SUPPORT : (function() {
    function Bar() {}
    try {
      var arr = new Uint8Array(1);
      arr.foo = function() {
        return 42;
      };
      arr.constructor = Bar;
      return arr.foo() === 42 && arr.constructor === Bar && typeof arr.subarray === 'function' && arr.subarray(1, 1).byteLength === 0;
    } catch (e) {
      return false;
    }
  })();
  function kMaxLength() {
    return Buffer.TYPED_ARRAY_SUPPORT ? 0x7fffffff : 0x3fffffff;
  }
  function Buffer(arg) {
    if (!(this instanceof Buffer)) {
      if (arguments.length > 1)
        return new Buffer(arg, arguments[1]);
      return new Buffer(arg);
    }
    this.length = 0;
    this.parent = undefined;
    if (typeof arg === 'number') {
      return fromNumber(this, arg);
    }
    if (typeof arg === 'string') {
      return fromString(this, arg, arguments.length > 1 ? arguments[1] : 'utf8');
    }
    return fromObject(this, arg);
  }
  function fromNumber(that, length) {
    that = allocate(that, length < 0 ? 0 : checked(length) | 0);
    if (!Buffer.TYPED_ARRAY_SUPPORT) {
      for (var i = 0; i < length; i++) {
        that[i] = 0;
      }
    }
    return that;
  }
  function fromString(that, string, encoding) {
    if (typeof encoding !== 'string' || encoding === '')
      encoding = 'utf8';
    var length = byteLength(string, encoding) | 0;
    that = allocate(that, length);
    that.write(string, encoding);
    return that;
  }
  function fromObject(that, object) {
    if (Buffer.isBuffer(object))
      return fromBuffer(that, object);
    if (isArray(object))
      return fromArray(that, object);
    if (object == null) {
      throw new TypeError('must start with number, buffer, array or string');
    }
    if (typeof ArrayBuffer !== 'undefined') {
      if (object.buffer instanceof ArrayBuffer) {
        return fromTypedArray(that, object);
      }
      if (object instanceof ArrayBuffer) {
        return fromArrayBuffer(that, object);
      }
    }
    if (object.length)
      return fromArrayLike(that, object);
    return fromJsonObject(that, object);
  }
  function fromBuffer(that, buffer) {
    var length = checked(buffer.length) | 0;
    that = allocate(that, length);
    buffer.copy(that, 0, 0, length);
    return that;
  }
  function fromArray(that, array) {
    var length = checked(array.length) | 0;
    that = allocate(that, length);
    for (var i = 0; i < length; i += 1) {
      that[i] = array[i] & 255;
    }
    return that;
  }
  function fromTypedArray(that, array) {
    var length = checked(array.length) | 0;
    that = allocate(that, length);
    for (var i = 0; i < length; i += 1) {
      that[i] = array[i] & 255;
    }
    return that;
  }
  function fromArrayBuffer(that, array) {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      array.byteLength;
      that = Buffer._augment(new Uint8Array(array));
    } else {
      that = fromTypedArray(that, new Uint8Array(array));
    }
    return that;
  }
  function fromArrayLike(that, array) {
    var length = checked(array.length) | 0;
    that = allocate(that, length);
    for (var i = 0; i < length; i += 1) {
      that[i] = array[i] & 255;
    }
    return that;
  }
  function fromJsonObject(that, object) {
    var array;
    var length = 0;
    if (object.type === 'Buffer' && isArray(object.data)) {
      array = object.data;
      length = checked(array.length) | 0;
    }
    that = allocate(that, length);
    for (var i = 0; i < length; i += 1) {
      that[i] = array[i] & 255;
    }
    return that;
  }
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    Buffer.prototype.__proto__ = Uint8Array.prototype;
    Buffer.__proto__ = Uint8Array;
  }
  function allocate(that, length) {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      that = Buffer._augment(new Uint8Array(length));
      that.__proto__ = Buffer.prototype;
    } else {
      that.length = length;
      that._isBuffer = true;
    }
    var fromPool = length !== 0 && length <= Buffer.poolSize >>> 1;
    if (fromPool)
      that.parent = rootParent;
    return that;
  }
  function checked(length) {
    if (length >= kMaxLength()) {
      throw new RangeError('Attempt to allocate Buffer larger than maximum ' + 'size: 0x' + kMaxLength().toString(16) + ' bytes');
    }
    return length | 0;
  }
  function SlowBuffer(subject, encoding) {
    if (!(this instanceof SlowBuffer))
      return new SlowBuffer(subject, encoding);
    var buf = new Buffer(subject, encoding);
    delete buf.parent;
    return buf;
  }
  Buffer.isBuffer = function isBuffer(b) {
    return !!(b != null && b._isBuffer);
  };
  Buffer.compare = function compare(a, b) {
    if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
      throw new TypeError('Arguments must be Buffers');
    }
    if (a === b)
      return 0;
    var x = a.length;
    var y = b.length;
    var i = 0;
    var len = Math.min(x, y);
    while (i < len) {
      if (a[i] !== b[i])
        break;
      ++i;
    }
    if (i !== len) {
      x = a[i];
      y = b[i];
    }
    if (x < y)
      return -1;
    if (y < x)
      return 1;
    return 0;
  };
  Buffer.isEncoding = function isEncoding(encoding) {
    switch (String(encoding).toLowerCase()) {
      case 'hex':
      case 'utf8':
      case 'utf-8':
      case 'ascii':
      case 'binary':
      case 'base64':
      case 'raw':
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return true;
      default:
        return false;
    }
  };
  Buffer.concat = function concat(list, length) {
    if (!isArray(list))
      throw new TypeError('list argument must be an Array of Buffers.');
    if (list.length === 0) {
      return new Buffer(0);
    }
    var i;
    if (length === undefined) {
      length = 0;
      for (i = 0; i < list.length; i++) {
        length += list[i].length;
      }
    }
    var buf = new Buffer(length);
    var pos = 0;
    for (i = 0; i < list.length; i++) {
      var item = list[i];
      item.copy(buf, pos);
      pos += item.length;
    }
    return buf;
  };
  function byteLength(string, encoding) {
    if (typeof string !== 'string')
      string = '' + string;
    var len = string.length;
    if (len === 0)
      return 0;
    var loweredCase = false;
    for (; ; ) {
      switch (encoding) {
        case 'ascii':
        case 'binary':
        case 'raw':
        case 'raws':
          return len;
        case 'utf8':
        case 'utf-8':
          return utf8ToBytes(string).length;
        case 'ucs2':
        case 'ucs-2':
        case 'utf16le':
        case 'utf-16le':
          return len * 2;
        case 'hex':
          return len >>> 1;
        case 'base64':
          return base64ToBytes(string).length;
        default:
          if (loweredCase)
            return utf8ToBytes(string).length;
          encoding = ('' + encoding).toLowerCase();
          loweredCase = true;
      }
    }
  }
  Buffer.byteLength = byteLength;
  Buffer.prototype.length = undefined;
  Buffer.prototype.parent = undefined;
  function slowToString(encoding, start, end) {
    var loweredCase = false;
    start = start | 0;
    end = end === undefined || end === Infinity ? this.length : end | 0;
    if (!encoding)
      encoding = 'utf8';
    if (start < 0)
      start = 0;
    if (end > this.length)
      end = this.length;
    if (end <= start)
      return '';
    while (true) {
      switch (encoding) {
        case 'hex':
          return hexSlice(this, start, end);
        case 'utf8':
        case 'utf-8':
          return utf8Slice(this, start, end);
        case 'ascii':
          return asciiSlice(this, start, end);
        case 'binary':
          return binarySlice(this, start, end);
        case 'base64':
          return base64Slice(this, start, end);
        case 'ucs2':
        case 'ucs-2':
        case 'utf16le':
        case 'utf-16le':
          return utf16leSlice(this, start, end);
        default:
          if (loweredCase)
            throw new TypeError('Unknown encoding: ' + encoding);
          encoding = (encoding + '').toLowerCase();
          loweredCase = true;
      }
    }
  }
  Buffer.prototype.toString = function toString() {
    var length = this.length | 0;
    if (length === 0)
      return '';
    if (arguments.length === 0)
      return utf8Slice(this, 0, length);
    return slowToString.apply(this, arguments);
  };
  Buffer.prototype.equals = function equals(b) {
    if (!Buffer.isBuffer(b))
      throw new TypeError('Argument must be a Buffer');
    if (this === b)
      return true;
    return Buffer.compare(this, b) === 0;
  };
  Buffer.prototype.inspect = function inspect() {
    var str = '';
    var max = exports.INSPECT_MAX_BYTES;
    if (this.length > 0) {
      str = this.toString('hex', 0, max).match(/.{2}/g).join(' ');
      if (this.length > max)
        str += ' ... ';
    }
    return '<Buffer ' + str + '>';
  };
  Buffer.prototype.compare = function compare(b) {
    if (!Buffer.isBuffer(b))
      throw new TypeError('Argument must be a Buffer');
    if (this === b)
      return 0;
    return Buffer.compare(this, b);
  };
  Buffer.prototype.indexOf = function indexOf(val, byteOffset) {
    if (byteOffset > 0x7fffffff)
      byteOffset = 0x7fffffff;
    else if (byteOffset < -0x80000000)
      byteOffset = -0x80000000;
    byteOffset >>= 0;
    if (this.length === 0)
      return -1;
    if (byteOffset >= this.length)
      return -1;
    if (byteOffset < 0)
      byteOffset = Math.max(this.length + byteOffset, 0);
    if (typeof val === 'string') {
      if (val.length === 0)
        return -1;
      return String.prototype.indexOf.call(this, val, byteOffset);
    }
    if (Buffer.isBuffer(val)) {
      return arrayIndexOf(this, val, byteOffset);
    }
    if (typeof val === 'number') {
      if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {
        return Uint8Array.prototype.indexOf.call(this, val, byteOffset);
      }
      return arrayIndexOf(this, [val], byteOffset);
    }
    function arrayIndexOf(arr, val, byteOffset) {
      var foundIndex = -1;
      for (var i = 0; byteOffset + i < arr.length; i++) {
        if (arr[byteOffset + i] === val[foundIndex === -1 ? 0 : i - foundIndex]) {
          if (foundIndex === -1)
            foundIndex = i;
          if (i - foundIndex + 1 === val.length)
            return byteOffset + foundIndex;
        } else {
          foundIndex = -1;
        }
      }
      return -1;
    }
    throw new TypeError('val must be string, number or Buffer');
  };
  Buffer.prototype.get = function get(offset) {
    console.log('.get() is deprecated. Access using array indexes instead.');
    return this.readUInt8(offset);
  };
  Buffer.prototype.set = function set(v, offset) {
    console.log('.set() is deprecated. Access using array indexes instead.');
    return this.writeUInt8(v, offset);
  };
  function hexWrite(buf, string, offset, length) {
    offset = Number(offset) || 0;
    var remaining = buf.length - offset;
    if (!length) {
      length = remaining;
    } else {
      length = Number(length);
      if (length > remaining) {
        length = remaining;
      }
    }
    var strLen = string.length;
    if (strLen % 2 !== 0)
      throw new Error('Invalid hex string');
    if (length > strLen / 2) {
      length = strLen / 2;
    }
    for (var i = 0; i < length; i++) {
      var parsed = parseInt(string.substr(i * 2, 2), 16);
      if (isNaN(parsed))
        throw new Error('Invalid hex string');
      buf[offset + i] = parsed;
    }
    return i;
  }
  function utf8Write(buf, string, offset, length) {
    return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length);
  }
  function asciiWrite(buf, string, offset, length) {
    return blitBuffer(asciiToBytes(string), buf, offset, length);
  }
  function binaryWrite(buf, string, offset, length) {
    return asciiWrite(buf, string, offset, length);
  }
  function base64Write(buf, string, offset, length) {
    return blitBuffer(base64ToBytes(string), buf, offset, length);
  }
  function ucs2Write(buf, string, offset, length) {
    return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length);
  }
  Buffer.prototype.write = function write(string, offset, length, encoding) {
    if (offset === undefined) {
      encoding = 'utf8';
      length = this.length;
      offset = 0;
    } else if (length === undefined && typeof offset === 'string') {
      encoding = offset;
      length = this.length;
      offset = 0;
    } else if (isFinite(offset)) {
      offset = offset | 0;
      if (isFinite(length)) {
        length = length | 0;
        if (encoding === undefined)
          encoding = 'utf8';
      } else {
        encoding = length;
        length = undefined;
      }
    } else {
      var swap = encoding;
      encoding = offset;
      offset = length | 0;
      length = swap;
    }
    var remaining = this.length - offset;
    if (length === undefined || length > remaining)
      length = remaining;
    if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
      throw new RangeError('attempt to write outside buffer bounds');
    }
    if (!encoding)
      encoding = 'utf8';
    var loweredCase = false;
    for (; ; ) {
      switch (encoding) {
        case 'hex':
          return hexWrite(this, string, offset, length);
        case 'utf8':
        case 'utf-8':
          return utf8Write(this, string, offset, length);
        case 'ascii':
          return asciiWrite(this, string, offset, length);
        case 'binary':
          return binaryWrite(this, string, offset, length);
        case 'base64':
          return base64Write(this, string, offset, length);
        case 'ucs2':
        case 'ucs-2':
        case 'utf16le':
        case 'utf-16le':
          return ucs2Write(this, string, offset, length);
        default:
          if (loweredCase)
            throw new TypeError('Unknown encoding: ' + encoding);
          encoding = ('' + encoding).toLowerCase();
          loweredCase = true;
      }
    }
  };
  Buffer.prototype.toJSON = function toJSON() {
    return {
      type: 'Buffer',
      data: Array.prototype.slice.call(this._arr || this, 0)
    };
  };
  function base64Slice(buf, start, end) {
    if (start === 0 && end === buf.length) {
      return base64.fromByteArray(buf);
    } else {
      return base64.fromByteArray(buf.slice(start, end));
    }
  }
  function utf8Slice(buf, start, end) {
    end = Math.min(buf.length, end);
    var res = [];
    var i = start;
    while (i < end) {
      var firstByte = buf[i];
      var codePoint = null;
      var bytesPerSequence = (firstByte > 0xEF) ? 4 : (firstByte > 0xDF) ? 3 : (firstByte > 0xBF) ? 2 : 1;
      if (i + bytesPerSequence <= end) {
        var secondByte,
            thirdByte,
            fourthByte,
            tempCodePoint;
        switch (bytesPerSequence) {
          case 1:
            if (firstByte < 0x80) {
              codePoint = firstByte;
            }
            break;
          case 2:
            secondByte = buf[i + 1];
            if ((secondByte & 0xC0) === 0x80) {
              tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F);
              if (tempCodePoint > 0x7F) {
                codePoint = tempCodePoint;
              }
            }
            break;
          case 3:
            secondByte = buf[i + 1];
            thirdByte = buf[i + 2];
            if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
              tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F);
              if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
                codePoint = tempCodePoint;
              }
            }
            break;
          case 4:
            secondByte = buf[i + 1];
            thirdByte = buf[i + 2];
            fourthByte = buf[i + 3];
            if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
              tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F);
              if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
                codePoint = tempCodePoint;
              }
            }
        }
      }
      if (codePoint === null) {
        codePoint = 0xFFFD;
        bytesPerSequence = 1;
      } else if (codePoint > 0xFFFF) {
        codePoint -= 0x10000;
        res.push(codePoint >>> 10 & 0x3FF | 0xD800);
        codePoint = 0xDC00 | codePoint & 0x3FF;
      }
      res.push(codePoint);
      i += bytesPerSequence;
    }
    return decodeCodePointsArray(res);
  }
  var MAX_ARGUMENTS_LENGTH = 0x1000;
  function decodeCodePointsArray(codePoints) {
    var len = codePoints.length;
    if (len <= MAX_ARGUMENTS_LENGTH) {
      return String.fromCharCode.apply(String, codePoints);
    }
    var res = '';
    var i = 0;
    while (i < len) {
      res += String.fromCharCode.apply(String, codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH));
    }
    return res;
  }
  function asciiSlice(buf, start, end) {
    var ret = '';
    end = Math.min(buf.length, end);
    for (var i = start; i < end; i++) {
      ret += String.fromCharCode(buf[i] & 0x7F);
    }
    return ret;
  }
  function binarySlice(buf, start, end) {
    var ret = '';
    end = Math.min(buf.length, end);
    for (var i = start; i < end; i++) {
      ret += String.fromCharCode(buf[i]);
    }
    return ret;
  }
  function hexSlice(buf, start, end) {
    var len = buf.length;
    if (!start || start < 0)
      start = 0;
    if (!end || end < 0 || end > len)
      end = len;
    var out = '';
    for (var i = start; i < end; i++) {
      out += toHex(buf[i]);
    }
    return out;
  }
  function utf16leSlice(buf, start, end) {
    var bytes = buf.slice(start, end);
    var res = '';
    for (var i = 0; i < bytes.length; i += 2) {
      res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256);
    }
    return res;
  }
  Buffer.prototype.slice = function slice(start, end) {
    var len = this.length;
    start = ~~start;
    end = end === undefined ? len : ~~end;
    if (start < 0) {
      start += len;
      if (start < 0)
        start = 0;
    } else if (start > len) {
      start = len;
    }
    if (end < 0) {
      end += len;
      if (end < 0)
        end = 0;
    } else if (end > len) {
      end = len;
    }
    if (end < start)
      end = start;
    var newBuf;
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      newBuf = Buffer._augment(this.subarray(start, end));
    } else {
      var sliceLen = end - start;
      newBuf = new Buffer(sliceLen, undefined);
      for (var i = 0; i < sliceLen; i++) {
        newBuf[i] = this[i + start];
      }
    }
    if (newBuf.length)
      newBuf.parent = this.parent || this;
    return newBuf;
  };
  function checkOffset(offset, ext, length) {
    if ((offset % 1) !== 0 || offset < 0)
      throw new RangeError('offset is not uint');
    if (offset + ext > length)
      throw new RangeError('Trying to access beyond buffer length');
  }
  Buffer.prototype.readUIntLE = function readUIntLE(offset, byteLength, noAssert) {
    offset = offset | 0;
    byteLength = byteLength | 0;
    if (!noAssert)
      checkOffset(offset, byteLength, this.length);
    var val = this[offset];
    var mul = 1;
    var i = 0;
    while (++i < byteLength && (mul *= 0x100)) {
      val += this[offset + i] * mul;
    }
    return val;
  };
  Buffer.prototype.readUIntBE = function readUIntBE(offset, byteLength, noAssert) {
    offset = offset | 0;
    byteLength = byteLength | 0;
    if (!noAssert) {
      checkOffset(offset, byteLength, this.length);
    }
    var val = this[offset + --byteLength];
    var mul = 1;
    while (byteLength > 0 && (mul *= 0x100)) {
      val += this[offset + --byteLength] * mul;
    }
    return val;
  };
  Buffer.prototype.readUInt8 = function readUInt8(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 1, this.length);
    return this[offset];
  };
  Buffer.prototype.readUInt16LE = function readUInt16LE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 2, this.length);
    return this[offset] | (this[offset + 1] << 8);
  };
  Buffer.prototype.readUInt16BE = function readUInt16BE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 2, this.length);
    return (this[offset] << 8) | this[offset + 1];
  };
  Buffer.prototype.readUInt32LE = function readUInt32LE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 4, this.length);
    return ((this[offset]) | (this[offset + 1] << 8) | (this[offset + 2] << 16)) + (this[offset + 3] * 0x1000000);
  };
  Buffer.prototype.readUInt32BE = function readUInt32BE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 4, this.length);
    return (this[offset] * 0x1000000) + ((this[offset + 1] << 16) | (this[offset + 2] << 8) | this[offset + 3]);
  };
  Buffer.prototype.readIntLE = function readIntLE(offset, byteLength, noAssert) {
    offset = offset | 0;
    byteLength = byteLength | 0;
    if (!noAssert)
      checkOffset(offset, byteLength, this.length);
    var val = this[offset];
    var mul = 1;
    var i = 0;
    while (++i < byteLength && (mul *= 0x100)) {
      val += this[offset + i] * mul;
    }
    mul *= 0x80;
    if (val >= mul)
      val -= Math.pow(2, 8 * byteLength);
    return val;
  };
  Buffer.prototype.readIntBE = function readIntBE(offset, byteLength, noAssert) {
    offset = offset | 0;
    byteLength = byteLength | 0;
    if (!noAssert)
      checkOffset(offset, byteLength, this.length);
    var i = byteLength;
    var mul = 1;
    var val = this[offset + --i];
    while (i > 0 && (mul *= 0x100)) {
      val += this[offset + --i] * mul;
    }
    mul *= 0x80;
    if (val >= mul)
      val -= Math.pow(2, 8 * byteLength);
    return val;
  };
  Buffer.prototype.readInt8 = function readInt8(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 1, this.length);
    if (!(this[offset] & 0x80))
      return (this[offset]);
    return ((0xff - this[offset] + 1) * -1);
  };
  Buffer.prototype.readInt16LE = function readInt16LE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 2, this.length);
    var val = this[offset] | (this[offset + 1] << 8);
    return (val & 0x8000) ? val | 0xFFFF0000 : val;
  };
  Buffer.prototype.readInt16BE = function readInt16BE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 2, this.length);
    var val = this[offset + 1] | (this[offset] << 8);
    return (val & 0x8000) ? val | 0xFFFF0000 : val;
  };
  Buffer.prototype.readInt32LE = function readInt32LE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 4, this.length);
    return (this[offset]) | (this[offset + 1] << 8) | (this[offset + 2] << 16) | (this[offset + 3] << 24);
  };
  Buffer.prototype.readInt32BE = function readInt32BE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 4, this.length);
    return (this[offset] << 24) | (this[offset + 1] << 16) | (this[offset + 2] << 8) | (this[offset + 3]);
  };
  Buffer.prototype.readFloatLE = function readFloatLE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 4, this.length);
    return ieee754.read(this, offset, true, 23, 4);
  };
  Buffer.prototype.readFloatBE = function readFloatBE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 4, this.length);
    return ieee754.read(this, offset, false, 23, 4);
  };
  Buffer.prototype.readDoubleLE = function readDoubleLE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 8, this.length);
    return ieee754.read(this, offset, true, 52, 8);
  };
  Buffer.prototype.readDoubleBE = function readDoubleBE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 8, this.length);
    return ieee754.read(this, offset, false, 52, 8);
  };
  function checkInt(buf, value, offset, ext, max, min) {
    if (!Buffer.isBuffer(buf))
      throw new TypeError('buffer must be a Buffer instance');
    if (value > max || value < min)
      throw new RangeError('value is out of bounds');
    if (offset + ext > buf.length)
      throw new RangeError('index out of range');
  }
  Buffer.prototype.writeUIntLE = function writeUIntLE(value, offset, byteLength, noAssert) {
    value = +value;
    offset = offset | 0;
    byteLength = byteLength | 0;
    if (!noAssert)
      checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0);
    var mul = 1;
    var i = 0;
    this[offset] = value & 0xFF;
    while (++i < byteLength && (mul *= 0x100)) {
      this[offset + i] = (value / mul) & 0xFF;
    }
    return offset + byteLength;
  };
  Buffer.prototype.writeUIntBE = function writeUIntBE(value, offset, byteLength, noAssert) {
    value = +value;
    offset = offset | 0;
    byteLength = byteLength | 0;
    if (!noAssert)
      checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0);
    var i = byteLength - 1;
    var mul = 1;
    this[offset + i] = value & 0xFF;
    while (--i >= 0 && (mul *= 0x100)) {
      this[offset + i] = (value / mul) & 0xFF;
    }
    return offset + byteLength;
  };
  Buffer.prototype.writeUInt8 = function writeUInt8(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert)
      checkInt(this, value, offset, 1, 0xff, 0);
    if (!Buffer.TYPED_ARRAY_SUPPORT)
      value = Math.floor(value);
    this[offset] = value;
    return offset + 1;
  };
  function objectWriteUInt16(buf, value, offset, littleEndian) {
    if (value < 0)
      value = 0xffff + value + 1;
    for (var i = 0,
        j = Math.min(buf.length - offset, 2); i < j; i++) {
      buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>> (littleEndian ? i : 1 - i) * 8;
    }
  }
  Buffer.prototype.writeUInt16LE = function writeUInt16LE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert)
      checkInt(this, value, offset, 2, 0xffff, 0);
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      this[offset] = value;
      this[offset + 1] = (value >>> 8);
    } else {
      objectWriteUInt16(this, value, offset, true);
    }
    return offset + 2;
  };
  Buffer.prototype.writeUInt16BE = function writeUInt16BE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert)
      checkInt(this, value, offset, 2, 0xffff, 0);
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      this[offset] = (value >>> 8);
      this[offset + 1] = value;
    } else {
      objectWriteUInt16(this, value, offset, false);
    }
    return offset + 2;
  };
  function objectWriteUInt32(buf, value, offset, littleEndian) {
    if (value < 0)
      value = 0xffffffff + value + 1;
    for (var i = 0,
        j = Math.min(buf.length - offset, 4); i < j; i++) {
      buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff;
    }
  }
  Buffer.prototype.writeUInt32LE = function writeUInt32LE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert)
      checkInt(this, value, offset, 4, 0xffffffff, 0);
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      this[offset + 3] = (value >>> 24);
      this[offset + 2] = (value >>> 16);
      this[offset + 1] = (value >>> 8);
      this[offset] = value;
    } else {
      objectWriteUInt32(this, value, offset, true);
    }
    return offset + 4;
  };
  Buffer.prototype.writeUInt32BE = function writeUInt32BE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert)
      checkInt(this, value, offset, 4, 0xffffffff, 0);
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      this[offset] = (value >>> 24);
      this[offset + 1] = (value >>> 16);
      this[offset + 2] = (value >>> 8);
      this[offset + 3] = value;
    } else {
      objectWriteUInt32(this, value, offset, false);
    }
    return offset + 4;
  };
  Buffer.prototype.writeIntLE = function writeIntLE(value, offset, byteLength, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert) {
      var limit = Math.pow(2, 8 * byteLength - 1);
      checkInt(this, value, offset, byteLength, limit - 1, -limit);
    }
    var i = 0;
    var mul = 1;
    var sub = value < 0 ? 1 : 0;
    this[offset] = value & 0xFF;
    while (++i < byteLength && (mul *= 0x100)) {
      this[offset + i] = ((value / mul) >> 0) - sub & 0xFF;
    }
    return offset + byteLength;
  };
  Buffer.prototype.writeIntBE = function writeIntBE(value, offset, byteLength, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert) {
      var limit = Math.pow(2, 8 * byteLength - 1);
      checkInt(this, value, offset, byteLength, limit - 1, -limit);
    }
    var i = byteLength - 1;
    var mul = 1;
    var sub = value < 0 ? 1 : 0;
    this[offset + i] = value & 0xFF;
    while (--i >= 0 && (mul *= 0x100)) {
      this[offset + i] = ((value / mul) >> 0) - sub & 0xFF;
    }
    return offset + byteLength;
  };
  Buffer.prototype.writeInt8 = function writeInt8(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert)
      checkInt(this, value, offset, 1, 0x7f, -0x80);
    if (!Buffer.TYPED_ARRAY_SUPPORT)
      value = Math.floor(value);
    if (value < 0)
      value = 0xff + value + 1;
    this[offset] = value;
    return offset + 1;
  };
  Buffer.prototype.writeInt16LE = function writeInt16LE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert)
      checkInt(this, value, offset, 2, 0x7fff, -0x8000);
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      this[offset] = value;
      this[offset + 1] = (value >>> 8);
    } else {
      objectWriteUInt16(this, value, offset, true);
    }
    return offset + 2;
  };
  Buffer.prototype.writeInt16BE = function writeInt16BE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert)
      checkInt(this, value, offset, 2, 0x7fff, -0x8000);
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      this[offset] = (value >>> 8);
      this[offset + 1] = value;
    } else {
      objectWriteUInt16(this, value, offset, false);
    }
    return offset + 2;
  };
  Buffer.prototype.writeInt32LE = function writeInt32LE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert)
      checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000);
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      this[offset] = value;
      this[offset + 1] = (value >>> 8);
      this[offset + 2] = (value >>> 16);
      this[offset + 3] = (value >>> 24);
    } else {
      objectWriteUInt32(this, value, offset, true);
    }
    return offset + 4;
  };
  Buffer.prototype.writeInt32BE = function writeInt32BE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert)
      checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000);
    if (value < 0)
      value = 0xffffffff + value + 1;
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      this[offset] = (value >>> 24);
      this[offset + 1] = (value >>> 16);
      this[offset + 2] = (value >>> 8);
      this[offset + 3] = value;
    } else {
      objectWriteUInt32(this, value, offset, false);
    }
    return offset + 4;
  };
  function checkIEEE754(buf, value, offset, ext, max, min) {
    if (value > max || value < min)
      throw new RangeError('value is out of bounds');
    if (offset + ext > buf.length)
      throw new RangeError('index out of range');
    if (offset < 0)
      throw new RangeError('index out of range');
  }
  function writeFloat(buf, value, offset, littleEndian, noAssert) {
    if (!noAssert) {
      checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38);
    }
    ieee754.write(buf, value, offset, littleEndian, 23, 4);
    return offset + 4;
  }
  Buffer.prototype.writeFloatLE = function writeFloatLE(value, offset, noAssert) {
    return writeFloat(this, value, offset, true, noAssert);
  };
  Buffer.prototype.writeFloatBE = function writeFloatBE(value, offset, noAssert) {
    return writeFloat(this, value, offset, false, noAssert);
  };
  function writeDouble(buf, value, offset, littleEndian, noAssert) {
    if (!noAssert) {
      checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308);
    }
    ieee754.write(buf, value, offset, littleEndian, 52, 8);
    return offset + 8;
  }
  Buffer.prototype.writeDoubleLE = function writeDoubleLE(value, offset, noAssert) {
    return writeDouble(this, value, offset, true, noAssert);
  };
  Buffer.prototype.writeDoubleBE = function writeDoubleBE(value, offset, noAssert) {
    return writeDouble(this, value, offset, false, noAssert);
  };
  Buffer.prototype.copy = function copy(target, targetStart, start, end) {
    if (!start)
      start = 0;
    if (!end && end !== 0)
      end = this.length;
    if (targetStart >= target.length)
      targetStart = target.length;
    if (!targetStart)
      targetStart = 0;
    if (end > 0 && end < start)
      end = start;
    if (end === start)
      return 0;
    if (target.length === 0 || this.length === 0)
      return 0;
    if (targetStart < 0) {
      throw new RangeError('targetStart out of bounds');
    }
    if (start < 0 || start >= this.length)
      throw new RangeError('sourceStart out of bounds');
    if (end < 0)
      throw new RangeError('sourceEnd out of bounds');
    if (end > this.length)
      end = this.length;
    if (target.length - targetStart < end - start) {
      end = target.length - targetStart + start;
    }
    var len = end - start;
    var i;
    if (this === target && start < targetStart && targetStart < end) {
      for (i = len - 1; i >= 0; i--) {
        target[i + targetStart] = this[i + start];
      }
    } else if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
      for (i = 0; i < len; i++) {
        target[i + targetStart] = this[i + start];
      }
    } else {
      target._set(this.subarray(start, start + len), targetStart);
    }
    return len;
  };
  Buffer.prototype.fill = function fill(value, start, end) {
    if (!value)
      value = 0;
    if (!start)
      start = 0;
    if (!end)
      end = this.length;
    if (end < start)
      throw new RangeError('end < start');
    if (end === start)
      return;
    if (this.length === 0)
      return;
    if (start < 0 || start >= this.length)
      throw new RangeError('start out of bounds');
    if (end < 0 || end > this.length)
      throw new RangeError('end out of bounds');
    var i;
    if (typeof value === 'number') {
      for (i = start; i < end; i++) {
        this[i] = value;
      }
    } else {
      var bytes = utf8ToBytes(value.toString());
      var len = bytes.length;
      for (i = start; i < end; i++) {
        this[i] = bytes[i % len];
      }
    }
    return this;
  };
  Buffer.prototype.toArrayBuffer = function toArrayBuffer() {
    if (typeof Uint8Array !== 'undefined') {
      if (Buffer.TYPED_ARRAY_SUPPORT) {
        return (new Buffer(this)).buffer;
      } else {
        var buf = new Uint8Array(this.length);
        for (var i = 0,
            len = buf.length; i < len; i += 1) {
          buf[i] = this[i];
        }
        return buf.buffer;
      }
    } else {
      throw new TypeError('Buffer.toArrayBuffer not supported in this browser');
    }
  };
  var BP = Buffer.prototype;
  Buffer._augment = function _augment(arr) {
    arr.constructor = Buffer;
    arr._isBuffer = true;
    arr._set = arr.set;
    arr.get = BP.get;
    arr.set = BP.set;
    arr.write = BP.write;
    arr.toString = BP.toString;
    arr.toLocaleString = BP.toString;
    arr.toJSON = BP.toJSON;
    arr.equals = BP.equals;
    arr.compare = BP.compare;
    arr.indexOf = BP.indexOf;
    arr.copy = BP.copy;
    arr.slice = BP.slice;
    arr.readUIntLE = BP.readUIntLE;
    arr.readUIntBE = BP.readUIntBE;
    arr.readUInt8 = BP.readUInt8;
    arr.readUInt16LE = BP.readUInt16LE;
    arr.readUInt16BE = BP.readUInt16BE;
    arr.readUInt32LE = BP.readUInt32LE;
    arr.readUInt32BE = BP.readUInt32BE;
    arr.readIntLE = BP.readIntLE;
    arr.readIntBE = BP.readIntBE;
    arr.readInt8 = BP.readInt8;
    arr.readInt16LE = BP.readInt16LE;
    arr.readInt16BE = BP.readInt16BE;
    arr.readInt32LE = BP.readInt32LE;
    arr.readInt32BE = BP.readInt32BE;
    arr.readFloatLE = BP.readFloatLE;
    arr.readFloatBE = BP.readFloatBE;
    arr.readDoubleLE = BP.readDoubleLE;
    arr.readDoubleBE = BP.readDoubleBE;
    arr.writeUInt8 = BP.writeUInt8;
    arr.writeUIntLE = BP.writeUIntLE;
    arr.writeUIntBE = BP.writeUIntBE;
    arr.writeUInt16LE = BP.writeUInt16LE;
    arr.writeUInt16BE = BP.writeUInt16BE;
    arr.writeUInt32LE = BP.writeUInt32LE;
    arr.writeUInt32BE = BP.writeUInt32BE;
    arr.writeIntLE = BP.writeIntLE;
    arr.writeIntBE = BP.writeIntBE;
    arr.writeInt8 = BP.writeInt8;
    arr.writeInt16LE = BP.writeInt16LE;
    arr.writeInt16BE = BP.writeInt16BE;
    arr.writeInt32LE = BP.writeInt32LE;
    arr.writeInt32BE = BP.writeInt32BE;
    arr.writeFloatLE = BP.writeFloatLE;
    arr.writeFloatBE = BP.writeFloatBE;
    arr.writeDoubleLE = BP.writeDoubleLE;
    arr.writeDoubleBE = BP.writeDoubleBE;
    arr.fill = BP.fill;
    arr.inspect = BP.inspect;
    arr.toArrayBuffer = BP.toArrayBuffer;
    return arr;
  };
  var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g;
  function base64clean(str) {
    str = stringtrim(str).replace(INVALID_BASE64_RE, '');
    if (str.length < 2)
      return '';
    while (str.length % 4 !== 0) {
      str = str + '=';
    }
    return str;
  }
  function stringtrim(str) {
    if (str.trim)
      return str.trim();
    return str.replace(/^\s+|\s+$/g, '');
  }
  function toHex(n) {
    if (n < 16)
      return '0' + n.toString(16);
    return n.toString(16);
  }
  function utf8ToBytes(string, units) {
    units = units || Infinity;
    var codePoint;
    var length = string.length;
    var leadSurrogate = null;
    var bytes = [];
    for (var i = 0; i < length; i++) {
      codePoint = string.charCodeAt(i);
      if (codePoint > 0xD7FF && codePoint < 0xE000) {
        if (!leadSurrogate) {
          if (codePoint > 0xDBFF) {
            if ((units -= 3) > -1)
              bytes.push(0xEF, 0xBF, 0xBD);
            continue;
          } else if (i + 1 === length) {
            if ((units -= 3) > -1)
              bytes.push(0xEF, 0xBF, 0xBD);
            continue;
          }
          leadSurrogate = codePoint;
          continue;
        }
        if (codePoint < 0xDC00) {
          if ((units -= 3) > -1)
            bytes.push(0xEF, 0xBF, 0xBD);
          leadSurrogate = codePoint;
          continue;
        }
        codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000;
      } else if (leadSurrogate) {
        if ((units -= 3) > -1)
          bytes.push(0xEF, 0xBF, 0xBD);
      }
      leadSurrogate = null;
      if (codePoint < 0x80) {
        if ((units -= 1) < 0)
          break;
        bytes.push(codePoint);
      } else if (codePoint < 0x800) {
        if ((units -= 2) < 0)
          break;
        bytes.push(codePoint >> 0x6 | 0xC0, codePoint & 0x3F | 0x80);
      } else if (codePoint < 0x10000) {
        if ((units -= 3) < 0)
          break;
        bytes.push(codePoint >> 0xC | 0xE0, codePoint >> 0x6 & 0x3F | 0x80, codePoint & 0x3F | 0x80);
      } else if (codePoint < 0x110000) {
        if ((units -= 4) < 0)
          break;
        bytes.push(codePoint >> 0x12 | 0xF0, codePoint >> 0xC & 0x3F | 0x80, codePoint >> 0x6 & 0x3F | 0x80, codePoint & 0x3F | 0x80);
      } else {
        throw new Error('Invalid code point');
      }
    }
    return bytes;
  }
  function asciiToBytes(str) {
    var byteArray = [];
    for (var i = 0; i < str.length; i++) {
      byteArray.push(str.charCodeAt(i) & 0xFF);
    }
    return byteArray;
  }
  function utf16leToBytes(str, units) {
    var c,
        hi,
        lo;
    var byteArray = [];
    for (var i = 0; i < str.length; i++) {
      if ((units -= 2) < 0)
        break;
      c = str.charCodeAt(i);
      hi = c >> 8;
      lo = c % 256;
      byteArray.push(lo);
      byteArray.push(hi);
    }
    return byteArray;
  }
  function base64ToBytes(str) {
    return base64.toByteArray(base64clean(str));
  }
  function blitBuffer(src, dst, offset, length) {
    for (var i = 0; i < length; i++) {
      if ((i + offset >= dst.length) || (i >= src.length))
        break;
      dst[i + offset] = src[i];
    }
    return i;
  }
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("12", ["11"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = require("11");
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("13", ["12"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__System._nodeRequire ? $__System._nodeRequire('buffer') : require("12");
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("14", ["13"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = require("13");
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("15", ["a", "14"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  "format cjs";
  (function(Buffer) {
    (function(global, factory) {
      if (typeof define === 'function' && define["amd"])
        define(["Long"], factory);
      else if (typeof require === 'function' && typeof module === "object" && module && module["exports"])
        module['exports'] = (function() {
          var Long;
          try {
            Long = require("a");
          } catch (e) {}
          return factory(Long);
        })();
      else
        (global["dcodeIO"] = global["dcodeIO"] || {})["ByteBuffer"] = factory(global["dcodeIO"]["Long"]);
    })(this, function(Long) {
      "use strict";
      var ByteBuffer = function(capacity, littleEndian, noAssert) {
        if (typeof capacity === 'undefined')
          capacity = ByteBuffer.DEFAULT_CAPACITY;
        if (typeof littleEndian === 'undefined')
          littleEndian = ByteBuffer.DEFAULT_ENDIAN;
        if (typeof noAssert === 'undefined')
          noAssert = ByteBuffer.DEFAULT_NOASSERT;
        if (!noAssert) {
          capacity = capacity | 0;
          if (capacity < 0)
            throw RangeError("Illegal capacity");
          littleEndian = !!littleEndian;
          noAssert = !!noAssert;
        }
        this.buffer = capacity === 0 ? EMPTY_BUFFER : new ArrayBuffer(capacity);
        this.view = capacity === 0 ? null : new Uint8Array(this.buffer);
        this.offset = 0;
        this.markedOffset = -1;
        this.limit = capacity;
        this.littleEndian = typeof littleEndian !== 'undefined' ? !!littleEndian : false;
        this.noAssert = !!noAssert;
      };
      ByteBuffer.VERSION = "4.0.0";
      ByteBuffer.LITTLE_ENDIAN = true;
      ByteBuffer.BIG_ENDIAN = false;
      ByteBuffer.DEFAULT_CAPACITY = 16;
      ByteBuffer.DEFAULT_ENDIAN = ByteBuffer.BIG_ENDIAN;
      ByteBuffer.DEFAULT_NOASSERT = false;
      ByteBuffer.Long = Long || null;
      var ByteBufferPrototype = ByteBuffer.prototype;
      ByteBufferPrototype.__isByteBuffer__;
      Object.defineProperty(ByteBufferPrototype, "__isByteBuffer__", {
        value: true,
        enumerable: false,
        configurable: false
      });
      var EMPTY_BUFFER = new ArrayBuffer(0);
      var stringFromCharCode = String.fromCharCode;
      function stringSource(s) {
        var i = 0;
        return function() {
          return i < s.length ? s.charCodeAt(i++) : null;
        };
      }
      function stringDestination() {
        var cs = [],
            ps = [];
        return function() {
          if (arguments.length === 0)
            return ps.join('') + stringFromCharCode.apply(String, cs);
          if (cs.length + arguments.length > 1024)
            ps.push(stringFromCharCode.apply(String, cs)), cs.length = 0;
          Array.prototype.push.apply(cs, arguments);
        };
      }
      ByteBuffer.accessor = function() {
        return Uint8Array;
      };
      ByteBuffer.allocate = function(capacity, littleEndian, noAssert) {
        return new ByteBuffer(capacity, littleEndian, noAssert);
      };
      ByteBuffer.concat = function(buffers, encoding, littleEndian, noAssert) {
        if (typeof encoding === 'boolean' || typeof encoding !== 'string') {
          noAssert = littleEndian;
          littleEndian = encoding;
          encoding = undefined;
        }
        var capacity = 0;
        for (var i = 0,
            k = buffers.length,
            length; i < k; ++i) {
          if (!ByteBuffer.isByteBuffer(buffers[i]))
            buffers[i] = ByteBuffer.wrap(buffers[i], encoding);
          length = buffers[i].limit - buffers[i].offset;
          if (length > 0)
            capacity += length;
        }
        if (capacity === 0)
          return new ByteBuffer(0, littleEndian, noAssert);
        var bb = new ByteBuffer(capacity, littleEndian, noAssert),
            bi;
        i = 0;
        while (i < k) {
          bi = buffers[i++];
          length = bi.limit - bi.offset;
          if (length <= 0)
            continue;
          bb.view.set(bi.view.subarray(bi.offset, bi.limit), bb.offset);
          bb.offset += length;
        }
        bb.limit = bb.offset;
        bb.offset = 0;
        return bb;
      };
      ByteBuffer.isByteBuffer = function(bb) {
        return (bb && bb["__isByteBuffer__"]) === true;
      };
      ByteBuffer.type = function() {
        return ArrayBuffer;
      };
      ByteBuffer.wrap = function(buffer, encoding, littleEndian, noAssert) {
        if (typeof encoding !== 'string') {
          noAssert = littleEndian;
          littleEndian = encoding;
          encoding = undefined;
        }
        if (typeof buffer === 'string') {
          if (typeof encoding === 'undefined')
            encoding = "utf8";
          switch (encoding) {
            case "base64":
              return ByteBuffer.fromBase64(buffer, littleEndian);
            case "hex":
              return ByteBuffer.fromHex(buffer, littleEndian);
            case "binary":
              return ByteBuffer.fromBinary(buffer, littleEndian);
            case "utf8":
              return ByteBuffer.fromUTF8(buffer, littleEndian);
            case "debug":
              return ByteBuffer.fromDebug(buffer, littleEndian);
            default:
              throw Error("Unsupported encoding: " + encoding);
          }
        }
        if (buffer === null || typeof buffer !== 'object')
          throw TypeError("Illegal buffer");
        var bb;
        if (ByteBuffer.isByteBuffer(buffer)) {
          bb = ByteBufferPrototype.clone.call(buffer);
          bb.markedOffset = -1;
          return bb;
        }
        if (buffer instanceof Uint8Array) {
          bb = new ByteBuffer(0, littleEndian, noAssert);
          if (buffer.length > 0) {
            bb.buffer = buffer.buffer;
            bb.offset = buffer.byteOffset;
            bb.limit = buffer.byteOffset + buffer.byteLength;
            bb.view = new Uint8Array(buffer.buffer);
          }
        } else if (buffer instanceof ArrayBuffer) {
          bb = new ByteBuffer(0, littleEndian, noAssert);
          if (buffer.byteLength > 0) {
            bb.buffer = buffer;
            bb.offset = 0;
            bb.limit = buffer.byteLength;
            bb.view = buffer.byteLength > 0 ? new Uint8Array(buffer) : null;
          }
        } else if (Object.prototype.toString.call(buffer) === "[object Array]") {
          bb = new ByteBuffer(buffer.length, littleEndian, noAssert);
          bb.limit = buffer.length;
          for (var i = 0; i < buffer.length; ++i)
            bb.view[i] = buffer[i];
        } else
          throw TypeError("Illegal buffer");
        return bb;
      };
      ByteBufferPrototype.readBytes = function(length, offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + length > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + length + ") <= " + this.buffer.byteLength);
        }
        var slice = this.slice(offset, offset + length);
        if (relative)
          this.offset += length;
        return slice;
      };
      ByteBufferPrototype.writeBytes = ByteBufferPrototype.append;
      ByteBufferPrototype.writeInt8 = function(value, offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof value !== 'number' || value % 1 !== 0)
            throw TypeError("Illegal value: " + value + " (not an integer)");
          value |= 0;
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 0 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 0 + ") <= " + this.buffer.byteLength);
        }
        offset += 1;
        var capacity0 = this.buffer.byteLength;
        if (offset > capacity0)
          this.resize((capacity0 *= 2) > offset ? capacity0 : offset);
        offset -= 1;
        this.view[offset] = value;
        if (relative)
          this.offset += 1;
        return this;
      };
      ByteBufferPrototype.writeByte = ByteBufferPrototype.writeInt8;
      ByteBufferPrototype.readInt8 = function(offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 1 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 1 + ") <= " + this.buffer.byteLength);
        }
        var value = this.view[offset];
        if ((value & 0x80) === 0x80)
          value = -(0xFF - value + 1);
        if (relative)
          this.offset += 1;
        return value;
      };
      ByteBufferPrototype.readByte = ByteBufferPrototype.readInt8;
      ByteBufferPrototype.writeUint8 = function(value, offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof value !== 'number' || value % 1 !== 0)
            throw TypeError("Illegal value: " + value + " (not an integer)");
          value >>>= 0;
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 0 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 0 + ") <= " + this.buffer.byteLength);
        }
        offset += 1;
        var capacity1 = this.buffer.byteLength;
        if (offset > capacity1)
          this.resize((capacity1 *= 2) > offset ? capacity1 : offset);
        offset -= 1;
        this.view[offset] = value;
        if (relative)
          this.offset += 1;
        return this;
      };
      ByteBufferPrototype.writeUInt8 = ByteBufferPrototype.writeUint8;
      ByteBufferPrototype.readUint8 = function(offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 1 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 1 + ") <= " + this.buffer.byteLength);
        }
        var value = this.view[offset];
        if (relative)
          this.offset += 1;
        return value;
      };
      ByteBufferPrototype.readUInt8 = ByteBufferPrototype.readUint8;
      ByteBufferPrototype.writeInt16 = function(value, offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof value !== 'number' || value % 1 !== 0)
            throw TypeError("Illegal value: " + value + " (not an integer)");
          value |= 0;
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 0 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 0 + ") <= " + this.buffer.byteLength);
        }
        offset += 2;
        var capacity2 = this.buffer.byteLength;
        if (offset > capacity2)
          this.resize((capacity2 *= 2) > offset ? capacity2 : offset);
        offset -= 2;
        if (this.littleEndian) {
          this.view[offset + 1] = (value & 0xFF00) >>> 8;
          this.view[offset] = value & 0x00FF;
        } else {
          this.view[offset] = (value & 0xFF00) >>> 8;
          this.view[offset + 1] = value & 0x00FF;
        }
        if (relative)
          this.offset += 2;
        return this;
      };
      ByteBufferPrototype.writeShort = ByteBufferPrototype.writeInt16;
      ByteBufferPrototype.readInt16 = function(offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 2 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 2 + ") <= " + this.buffer.byteLength);
        }
        var value = 0;
        if (this.littleEndian) {
          value = this.view[offset];
          value |= this.view[offset + 1] << 8;
        } else {
          value = this.view[offset] << 8;
          value |= this.view[offset + 1];
        }
        if ((value & 0x8000) === 0x8000)
          value = -(0xFFFF - value + 1);
        if (relative)
          this.offset += 2;
        return value;
      };
      ByteBufferPrototype.readShort = ByteBufferPrototype.readInt16;
      ByteBufferPrototype.writeUint16 = function(value, offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof value !== 'number' || value % 1 !== 0)
            throw TypeError("Illegal value: " + value + " (not an integer)");
          value >>>= 0;
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 0 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 0 + ") <= " + this.buffer.byteLength);
        }
        offset += 2;
        var capacity3 = this.buffer.byteLength;
        if (offset > capacity3)
          this.resize((capacity3 *= 2) > offset ? capacity3 : offset);
        offset -= 2;
        if (this.littleEndian) {
          this.view[offset + 1] = (value & 0xFF00) >>> 8;
          this.view[offset] = value & 0x00FF;
        } else {
          this.view[offset] = (value & 0xFF00) >>> 8;
          this.view[offset + 1] = value & 0x00FF;
        }
        if (relative)
          this.offset += 2;
        return this;
      };
      ByteBufferPrototype.writeUInt16 = ByteBufferPrototype.writeUint16;
      ByteBufferPrototype.readUint16 = function(offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 2 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 2 + ") <= " + this.buffer.byteLength);
        }
        var value = 0;
        if (this.littleEndian) {
          value = this.view[offset];
          value |= this.view[offset + 1] << 8;
        } else {
          value = this.view[offset] << 8;
          value |= this.view[offset + 1];
        }
        if (relative)
          this.offset += 2;
        return value;
      };
      ByteBufferPrototype.readUInt16 = ByteBufferPrototype.readUint16;
      ByteBufferPrototype.writeInt32 = function(value, offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof value !== 'number' || value % 1 !== 0)
            throw TypeError("Illegal value: " + value + " (not an integer)");
          value |= 0;
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 0 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 0 + ") <= " + this.buffer.byteLength);
        }
        offset += 4;
        var capacity4 = this.buffer.byteLength;
        if (offset > capacity4)
          this.resize((capacity4 *= 2) > offset ? capacity4 : offset);
        offset -= 4;
        if (this.littleEndian) {
          this.view[offset + 3] = (value >>> 24) & 0xFF;
          this.view[offset + 2] = (value >>> 16) & 0xFF;
          this.view[offset + 1] = (value >>> 8) & 0xFF;
          this.view[offset] = value & 0xFF;
        } else {
          this.view[offset] = (value >>> 24) & 0xFF;
          this.view[offset + 1] = (value >>> 16) & 0xFF;
          this.view[offset + 2] = (value >>> 8) & 0xFF;
          this.view[offset + 3] = value & 0xFF;
        }
        if (relative)
          this.offset += 4;
        return this;
      };
      ByteBufferPrototype.writeInt = ByteBufferPrototype.writeInt32;
      ByteBufferPrototype.readInt32 = function(offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 4 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 4 + ") <= " + this.buffer.byteLength);
        }
        var value = 0;
        if (this.littleEndian) {
          value = this.view[offset + 2] << 16;
          value |= this.view[offset + 1] << 8;
          value |= this.view[offset];
          value += this.view[offset + 3] << 24 >>> 0;
        } else {
          value = this.view[offset + 1] << 16;
          value |= this.view[offset + 2] << 8;
          value |= this.view[offset + 3];
          value += this.view[offset] << 24 >>> 0;
        }
        value |= 0;
        if (relative)
          this.offset += 4;
        return value;
      };
      ByteBufferPrototype.readInt = ByteBufferPrototype.readInt32;
      ByteBufferPrototype.writeUint32 = function(value, offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof value !== 'number' || value % 1 !== 0)
            throw TypeError("Illegal value: " + value + " (not an integer)");
          value >>>= 0;
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 0 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 0 + ") <= " + this.buffer.byteLength);
        }
        offset += 4;
        var capacity5 = this.buffer.byteLength;
        if (offset > capacity5)
          this.resize((capacity5 *= 2) > offset ? capacity5 : offset);
        offset -= 4;
        if (this.littleEndian) {
          this.view[offset + 3] = (value >>> 24) & 0xFF;
          this.view[offset + 2] = (value >>> 16) & 0xFF;
          this.view[offset + 1] = (value >>> 8) & 0xFF;
          this.view[offset] = value & 0xFF;
        } else {
          this.view[offset] = (value >>> 24) & 0xFF;
          this.view[offset + 1] = (value >>> 16) & 0xFF;
          this.view[offset + 2] = (value >>> 8) & 0xFF;
          this.view[offset + 3] = value & 0xFF;
        }
        if (relative)
          this.offset += 4;
        return this;
      };
      ByteBufferPrototype.writeUInt32 = ByteBufferPrototype.writeUint32;
      ByteBufferPrototype.readUint32 = function(offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 4 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 4 + ") <= " + this.buffer.byteLength);
        }
        var value = 0;
        if (this.littleEndian) {
          value = this.view[offset + 2] << 16;
          value |= this.view[offset + 1] << 8;
          value |= this.view[offset];
          value += this.view[offset + 3] << 24 >>> 0;
        } else {
          value = this.view[offset + 1] << 16;
          value |= this.view[offset + 2] << 8;
          value |= this.view[offset + 3];
          value += this.view[offset] << 24 >>> 0;
        }
        if (relative)
          this.offset += 4;
        return value;
      };
      ByteBufferPrototype.readUInt32 = ByteBufferPrototype.readUint32;
      if (Long) {
        ByteBufferPrototype.writeInt64 = function(value, offset) {
          var relative = typeof offset === 'undefined';
          if (relative)
            offset = this.offset;
          if (!this.noAssert) {
            if (typeof value === 'number')
              value = Long.fromNumber(value);
            else if (typeof value === 'string')
              value = Long.fromString(value);
            else if (!(value && value instanceof Long))
              throw TypeError("Illegal value: " + value + " (not an integer or Long)");
            if (typeof offset !== 'number' || offset % 1 !== 0)
              throw TypeError("Illegal offset: " + offset + " (not an integer)");
            offset >>>= 0;
            if (offset < 0 || offset + 0 > this.buffer.byteLength)
              throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 0 + ") <= " + this.buffer.byteLength);
          }
          if (typeof value === 'number')
            value = Long.fromNumber(value);
          else if (typeof value === 'string')
            value = Long.fromString(value);
          offset += 8;
          var capacity6 = this.buffer.byteLength;
          if (offset > capacity6)
            this.resize((capacity6 *= 2) > offset ? capacity6 : offset);
          offset -= 8;
          var lo = value.low,
              hi = value.high;
          if (this.littleEndian) {
            this.view[offset + 3] = (lo >>> 24) & 0xFF;
            this.view[offset + 2] = (lo >>> 16) & 0xFF;
            this.view[offset + 1] = (lo >>> 8) & 0xFF;
            this.view[offset] = lo & 0xFF;
            offset += 4;
            this.view[offset + 3] = (hi >>> 24) & 0xFF;
            this.view[offset + 2] = (hi >>> 16) & 0xFF;
            this.view[offset + 1] = (hi >>> 8) & 0xFF;
            this.view[offset] = hi & 0xFF;
          } else {
            this.view[offset] = (hi >>> 24) & 0xFF;
            this.view[offset + 1] = (hi >>> 16) & 0xFF;
            this.view[offset + 2] = (hi >>> 8) & 0xFF;
            this.view[offset + 3] = hi & 0xFF;
            offset += 4;
            this.view[offset] = (lo >>> 24) & 0xFF;
            this.view[offset + 1] = (lo >>> 16) & 0xFF;
            this.view[offset + 2] = (lo >>> 8) & 0xFF;
            this.view[offset + 3] = lo & 0xFF;
          }
          if (relative)
            this.offset += 8;
          return this;
        };
        ByteBufferPrototype.writeLong = ByteBufferPrototype.writeInt64;
        ByteBufferPrototype.readInt64 = function(offset) {
          var relative = typeof offset === 'undefined';
          if (relative)
            offset = this.offset;
          if (!this.noAssert) {
            if (typeof offset !== 'number' || offset % 1 !== 0)
              throw TypeError("Illegal offset: " + offset + " (not an integer)");
            offset >>>= 0;
            if (offset < 0 || offset + 8 > this.buffer.byteLength)
              throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 8 + ") <= " + this.buffer.byteLength);
          }
          var lo = 0,
              hi = 0;
          if (this.littleEndian) {
            lo = this.view[offset + 2] << 16;
            lo |= this.view[offset + 1] << 8;
            lo |= this.view[offset];
            lo += this.view[offset + 3] << 24 >>> 0;
            offset += 4;
            hi = this.view[offset + 2] << 16;
            hi |= this.view[offset + 1] << 8;
            hi |= this.view[offset];
            hi += this.view[offset + 3] << 24 >>> 0;
          } else {
            hi = this.view[offset + 1] << 16;
            hi |= this.view[offset + 2] << 8;
            hi |= this.view[offset + 3];
            hi += this.view[offset] << 24 >>> 0;
            offset += 4;
            lo = this.view[offset + 1] << 16;
            lo |= this.view[offset + 2] << 8;
            lo |= this.view[offset + 3];
            lo += this.view[offset] << 24 >>> 0;
          }
          var value = new Long(lo, hi, false);
          if (relative)
            this.offset += 8;
          return value;
        };
        ByteBufferPrototype.readLong = ByteBufferPrototype.readInt64;
        ByteBufferPrototype.writeUint64 = function(value, offset) {
          var relative = typeof offset === 'undefined';
          if (relative)
            offset = this.offset;
          if (!this.noAssert) {
            if (typeof value === 'number')
              value = Long.fromNumber(value);
            else if (typeof value === 'string')
              value = Long.fromString(value);
            else if (!(value && value instanceof Long))
              throw TypeError("Illegal value: " + value + " (not an integer or Long)");
            if (typeof offset !== 'number' || offset % 1 !== 0)
              throw TypeError("Illegal offset: " + offset + " (not an integer)");
            offset >>>= 0;
            if (offset < 0 || offset + 0 > this.buffer.byteLength)
              throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 0 + ") <= " + this.buffer.byteLength);
          }
          if (typeof value === 'number')
            value = Long.fromNumber(value);
          else if (typeof value === 'string')
            value = Long.fromString(value);
          offset += 8;
          var capacity7 = this.buffer.byteLength;
          if (offset > capacity7)
            this.resize((capacity7 *= 2) > offset ? capacity7 : offset);
          offset -= 8;
          var lo = value.low,
              hi = value.high;
          if (this.littleEndian) {
            this.view[offset + 3] = (lo >>> 24) & 0xFF;
            this.view[offset + 2] = (lo >>> 16) & 0xFF;
            this.view[offset + 1] = (lo >>> 8) & 0xFF;
            this.view[offset] = lo & 0xFF;
            offset += 4;
            this.view[offset + 3] = (hi >>> 24) & 0xFF;
            this.view[offset + 2] = (hi >>> 16) & 0xFF;
            this.view[offset + 1] = (hi >>> 8) & 0xFF;
            this.view[offset] = hi & 0xFF;
          } else {
            this.view[offset] = (hi >>> 24) & 0xFF;
            this.view[offset + 1] = (hi >>> 16) & 0xFF;
            this.view[offset + 2] = (hi >>> 8) & 0xFF;
            this.view[offset + 3] = hi & 0xFF;
            offset += 4;
            this.view[offset] = (lo >>> 24) & 0xFF;
            this.view[offset + 1] = (lo >>> 16) & 0xFF;
            this.view[offset + 2] = (lo >>> 8) & 0xFF;
            this.view[offset + 3] = lo & 0xFF;
          }
          if (relative)
            this.offset += 8;
          return this;
        };
        ByteBufferPrototype.writeUInt64 = ByteBufferPrototype.writeUint64;
        ByteBufferPrototype.readUint64 = function(offset) {
          var relative = typeof offset === 'undefined';
          if (relative)
            offset = this.offset;
          if (!this.noAssert) {
            if (typeof offset !== 'number' || offset % 1 !== 0)
              throw TypeError("Illegal offset: " + offset + " (not an integer)");
            offset >>>= 0;
            if (offset < 0 || offset + 8 > this.buffer.byteLength)
              throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 8 + ") <= " + this.buffer.byteLength);
          }
          var lo = 0,
              hi = 0;
          if (this.littleEndian) {
            lo = this.view[offset + 2] << 16;
            lo |= this.view[offset + 1] << 8;
            lo |= this.view[offset];
            lo += this.view[offset + 3] << 24 >>> 0;
            offset += 4;
            hi = this.view[offset + 2] << 16;
            hi |= this.view[offset + 1] << 8;
            hi |= this.view[offset];
            hi += this.view[offset + 3] << 24 >>> 0;
          } else {
            hi = this.view[offset + 1] << 16;
            hi |= this.view[offset + 2] << 8;
            hi |= this.view[offset + 3];
            hi += this.view[offset] << 24 >>> 0;
            offset += 4;
            lo = this.view[offset + 1] << 16;
            lo |= this.view[offset + 2] << 8;
            lo |= this.view[offset + 3];
            lo += this.view[offset] << 24 >>> 0;
          }
          var value = new Long(lo, hi, true);
          if (relative)
            this.offset += 8;
          return value;
        };
        ByteBufferPrototype.readUInt64 = ByteBufferPrototype.readUint64;
      }
      function ieee754_read(buffer, offset, isLE, mLen, nBytes) {
        var e,
            m,
            eLen = nBytes * 8 - mLen - 1,
            eMax = (1 << eLen) - 1,
            eBias = eMax >> 1,
            nBits = -7,
            i = isLE ? (nBytes - 1) : 0,
            d = isLE ? -1 : 1,
            s = buffer[offset + i];
        i += d;
        e = s & ((1 << (-nBits)) - 1);
        s >>= (-nBits);
        nBits += eLen;
        for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}
        m = e & ((1 << (-nBits)) - 1);
        e >>= (-nBits);
        nBits += mLen;
        for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}
        if (e === 0) {
          e = 1 - eBias;
        } else if (e === eMax) {
          return m ? NaN : ((s ? -1 : 1) * Infinity);
        } else {
          m = m + Math.pow(2, mLen);
          e = e - eBias;
        }
        return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
      }
      function ieee754_write(buffer, value, offset, isLE, mLen, nBytes) {
        var e,
            m,
            c,
            eLen = nBytes * 8 - mLen - 1,
            eMax = (1 << eLen) - 1,
            eBias = eMax >> 1,
            rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),
            i = isLE ? 0 : (nBytes - 1),
            d = isLE ? 1 : -1,
            s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;
        value = Math.abs(value);
        if (isNaN(value) || value === Infinity) {
          m = isNaN(value) ? 1 : 0;
          e = eMax;
        } else {
          e = Math.floor(Math.log(value) / Math.LN2);
          if (value * (c = Math.pow(2, -e)) < 1) {
            e--;
            c *= 2;
          }
          if (e + eBias >= 1) {
            value += rt / c;
          } else {
            value += rt * Math.pow(2, 1 - eBias);
          }
          if (value * c >= 2) {
            e++;
            c /= 2;
          }
          if (e + eBias >= eMax) {
            m = 0;
            e = eMax;
          } else if (e + eBias >= 1) {
            m = (value * c - 1) * Math.pow(2, mLen);
            e = e + eBias;
          } else {
            m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
            e = 0;
          }
        }
        for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}
        e = (e << mLen) | m;
        eLen += mLen;
        for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}
        buffer[offset + i - d] |= s * 128;
      }
      ByteBufferPrototype.writeFloat32 = function(value, offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof value !== 'number')
            throw TypeError("Illegal value: " + value + " (not a number)");
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 0 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 0 + ") <= " + this.buffer.byteLength);
        }
        offset += 4;
        var capacity8 = this.buffer.byteLength;
        if (offset > capacity8)
          this.resize((capacity8 *= 2) > offset ? capacity8 : offset);
        offset -= 4;
        ieee754_write(this.view, value, offset, this.littleEndian, 23, 4);
        if (relative)
          this.offset += 4;
        return this;
      };
      ByteBufferPrototype.writeFloat = ByteBufferPrototype.writeFloat32;
      ByteBufferPrototype.readFloat32 = function(offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 4 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 4 + ") <= " + this.buffer.byteLength);
        }
        var value = ieee754_read(this.view, offset, this.littleEndian, 23, 4);
        if (relative)
          this.offset += 4;
        return value;
      };
      ByteBufferPrototype.readFloat = ByteBufferPrototype.readFloat32;
      ByteBufferPrototype.writeFloat64 = function(value, offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof value !== 'number')
            throw TypeError("Illegal value: " + value + " (not a number)");
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 0 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 0 + ") <= " + this.buffer.byteLength);
        }
        offset += 8;
        var capacity9 = this.buffer.byteLength;
        if (offset > capacity9)
          this.resize((capacity9 *= 2) > offset ? capacity9 : offset);
        offset -= 8;
        ieee754_write(this.view, value, offset, this.littleEndian, 52, 8);
        if (relative)
          this.offset += 8;
        return this;
      };
      ByteBufferPrototype.writeDouble = ByteBufferPrototype.writeFloat64;
      ByteBufferPrototype.readFloat64 = function(offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 8 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 8 + ") <= " + this.buffer.byteLength);
        }
        var value = ieee754_read(this.view, offset, this.littleEndian, 52, 8);
        if (relative)
          this.offset += 8;
        return value;
      };
      ByteBufferPrototype.readDouble = ByteBufferPrototype.readFloat64;
      ByteBuffer.MAX_VARINT32_BYTES = 5;
      ByteBuffer.calculateVarint32 = function(value) {
        value = value >>> 0;
        if (value < 1 << 7)
          return 1;
        else if (value < 1 << 14)
          return 2;
        else if (value < 1 << 21)
          return 3;
        else if (value < 1 << 28)
          return 4;
        else
          return 5;
      };
      ByteBuffer.zigZagEncode32 = function(n) {
        return (((n |= 0) << 1) ^ (n >> 31)) >>> 0;
      };
      ByteBuffer.zigZagDecode32 = function(n) {
        return ((n >>> 1) ^ -(n & 1)) | 0;
      };
      ByteBufferPrototype.writeVarint32 = function(value, offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof value !== 'number' || value % 1 !== 0)
            throw TypeError("Illegal value: " + value + " (not an integer)");
          value |= 0;
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 0 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 0 + ") <= " + this.buffer.byteLength);
        }
        var size = ByteBuffer.calculateVarint32(value),
            b;
        offset += size;
        var capacity10 = this.buffer.byteLength;
        if (offset > capacity10)
          this.resize((capacity10 *= 2) > offset ? capacity10 : offset);
        offset -= size;
        this.view[offset] = b = value | 0x80;
        value >>>= 0;
        if (value >= 1 << 7) {
          b = (value >> 7) | 0x80;
          this.view[offset + 1] = b;
          if (value >= 1 << 14) {
            b = (value >> 14) | 0x80;
            this.view[offset + 2] = b;
            if (value >= 1 << 21) {
              b = (value >> 21) | 0x80;
              this.view[offset + 3] = b;
              if (value >= 1 << 28) {
                this.view[offset + 4] = (value >> 28) & 0x0F;
                size = 5;
              } else {
                this.view[offset + 3] = b & 0x7F;
                size = 4;
              }
            } else {
              this.view[offset + 2] = b & 0x7F;
              size = 3;
            }
          } else {
            this.view[offset + 1] = b & 0x7F;
            size = 2;
          }
        } else {
          this.view[offset] = b & 0x7F;
          size = 1;
        }
        if (relative) {
          this.offset += size;
          return this;
        }
        return size;
      };
      ByteBufferPrototype.writeVarint32ZigZag = function(value, offset) {
        return this.writeVarint32(ByteBuffer.zigZagEncode32(value), offset);
      };
      ByteBufferPrototype.readVarint32 = function(offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 1 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 1 + ") <= " + this.buffer.byteLength);
        }
        var size = 0,
            value = 0 >>> 0,
            temp,
            ioffset;
        do {
          ioffset = offset + size;
          if (!this.noAssert && ioffset > this.limit) {
            var err = Error("Truncated");
            err['truncated'] = true;
            throw err;
          }
          temp = this.view[ioffset];
          if (size < 5)
            value |= ((temp & 0x7F) << (7 * size)) >>> 0;
          ++size;
        } while ((temp & 0x80) === 0x80);
        value = value | 0;
        if (relative) {
          this.offset += size;
          return value;
        }
        return {
          "value": value,
          "length": size
        };
      };
      ByteBufferPrototype.readVarint32ZigZag = function(offset) {
        var val = this.readVarint32(offset);
        if (typeof val === 'object')
          val["value"] = ByteBuffer.zigZagDecode32(val["value"]);
        else
          val = ByteBuffer.zigZagDecode32(val);
        return val;
      };
      if (Long) {
        ByteBuffer.MAX_VARINT64_BYTES = 10;
        ByteBuffer.calculateVarint64 = function(value) {
          if (typeof value === 'number')
            value = Long.fromNumber(value);
          else if (typeof value === 'string')
            value = Long.fromString(value);
          var part0 = value.toInt() >>> 0,
              part1 = value.shiftRightUnsigned(28).toInt() >>> 0,
              part2 = value.shiftRightUnsigned(56).toInt() >>> 0;
          if (part2 == 0) {
            if (part1 == 0) {
              if (part0 < 1 << 14)
                return part0 < 1 << 7 ? 1 : 2;
              else
                return part0 < 1 << 21 ? 3 : 4;
            } else {
              if (part1 < 1 << 14)
                return part1 < 1 << 7 ? 5 : 6;
              else
                return part1 < 1 << 21 ? 7 : 8;
            }
          } else
            return part2 < 1 << 7 ? 9 : 10;
        };
        ByteBuffer.zigZagEncode64 = function(value) {
          if (typeof value === 'number')
            value = Long.fromNumber(value, false);
          else if (typeof value === 'string')
            value = Long.fromString(value, false);
          else if (value.unsigned !== false)
            value = value.toSigned();
          return value.shiftLeft(1).xor(value.shiftRight(63)).toUnsigned();
        };
        ByteBuffer.zigZagDecode64 = function(value) {
          if (typeof value === 'number')
            value = Long.fromNumber(value, false);
          else if (typeof value === 'string')
            value = Long.fromString(value, false);
          else if (value.unsigned !== false)
            value = value.toSigned();
          return value.shiftRightUnsigned(1).xor(value.and(Long.ONE).toSigned().negate()).toSigned();
        };
        ByteBufferPrototype.writeVarint64 = function(value, offset) {
          var relative = typeof offset === 'undefined';
          if (relative)
            offset = this.offset;
          if (!this.noAssert) {
            if (typeof value === 'number')
              value = Long.fromNumber(value);
            else if (typeof value === 'string')
              value = Long.fromString(value);
            else if (!(value && value instanceof Long))
              throw TypeError("Illegal value: " + value + " (not an integer or Long)");
            if (typeof offset !== 'number' || offset % 1 !== 0)
              throw TypeError("Illegal offset: " + offset + " (not an integer)");
            offset >>>= 0;
            if (offset < 0 || offset + 0 > this.buffer.byteLength)
              throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 0 + ") <= " + this.buffer.byteLength);
          }
          if (typeof value === 'number')
            value = Long.fromNumber(value, false);
          else if (typeof value === 'string')
            value = Long.fromString(value, false);
          else if (value.unsigned !== false)
            value = value.toSigned();
          var size = ByteBuffer.calculateVarint64(value),
              part0 = value.toInt() >>> 0,
              part1 = value.shiftRightUnsigned(28).toInt() >>> 0,
              part2 = value.shiftRightUnsigned(56).toInt() >>> 0;
          offset += size;
          var capacity11 = this.buffer.byteLength;
          if (offset > capacity11)
            this.resize((capacity11 *= 2) > offset ? capacity11 : offset);
          offset -= size;
          switch (size) {
            case 10:
              this.view[offset + 9] = (part2 >>> 7) & 0x01;
            case 9:
              this.view[offset + 8] = size !== 9 ? (part2) | 0x80 : (part2) & 0x7F;
            case 8:
              this.view[offset + 7] = size !== 8 ? (part1 >>> 21) | 0x80 : (part1 >>> 21) & 0x7F;
            case 7:
              this.view[offset + 6] = size !== 7 ? (part1 >>> 14) | 0x80 : (part1 >>> 14) & 0x7F;
            case 6:
              this.view[offset + 5] = size !== 6 ? (part1 >>> 7) | 0x80 : (part1 >>> 7) & 0x7F;
            case 5:
              this.view[offset + 4] = size !== 5 ? (part1) | 0x80 : (part1) & 0x7F;
            case 4:
              this.view[offset + 3] = size !== 4 ? (part0 >>> 21) | 0x80 : (part0 >>> 21) & 0x7F;
            case 3:
              this.view[offset + 2] = size !== 3 ? (part0 >>> 14) | 0x80 : (part0 >>> 14) & 0x7F;
            case 2:
              this.view[offset + 1] = size !== 2 ? (part0 >>> 7) | 0x80 : (part0 >>> 7) & 0x7F;
            case 1:
              this.view[offset] = size !== 1 ? (part0) | 0x80 : (part0) & 0x7F;
          }
          if (relative) {
            this.offset += size;
            return this;
          } else {
            return size;
          }
        };
        ByteBufferPrototype.writeVarint64ZigZag = function(value, offset) {
          return this.writeVarint64(ByteBuffer.zigZagEncode64(value), offset);
        };
        ByteBufferPrototype.readVarint64 = function(offset) {
          var relative = typeof offset === 'undefined';
          if (relative)
            offset = this.offset;
          if (!this.noAssert) {
            if (typeof offset !== 'number' || offset % 1 !== 0)
              throw TypeError("Illegal offset: " + offset + " (not an integer)");
            offset >>>= 0;
            if (offset < 0 || offset + 1 > this.buffer.byteLength)
              throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 1 + ") <= " + this.buffer.byteLength);
          }
          var start = offset,
              part0 = 0,
              part1 = 0,
              part2 = 0,
              b = 0;
          b = this.view[offset++];
          part0 = (b & 0x7F);
          if (b & 0x80) {
            b = this.view[offset++];
            part0 |= (b & 0x7F) << 7;
            if ((b & 0x80) || (this.noAssert && typeof b === 'undefined')) {
              b = this.view[offset++];
              part0 |= (b & 0x7F) << 14;
              if ((b & 0x80) || (this.noAssert && typeof b === 'undefined')) {
                b = this.view[offset++];
                part0 |= (b & 0x7F) << 21;
                if ((b & 0x80) || (this.noAssert && typeof b === 'undefined')) {
                  b = this.view[offset++];
                  part1 = (b & 0x7F);
                  if ((b & 0x80) || (this.noAssert && typeof b === 'undefined')) {
                    b = this.view[offset++];
                    part1 |= (b & 0x7F) << 7;
                    if ((b & 0x80) || (this.noAssert && typeof b === 'undefined')) {
                      b = this.view[offset++];
                      part1 |= (b & 0x7F) << 14;
                      if ((b & 0x80) || (this.noAssert && typeof b === 'undefined')) {
                        b = this.view[offset++];
                        part1 |= (b & 0x7F) << 21;
                        if ((b & 0x80) || (this.noAssert && typeof b === 'undefined')) {
                          b = this.view[offset++];
                          part2 = (b & 0x7F);
                          if ((b & 0x80) || (this.noAssert && typeof b === 'undefined')) {
                            b = this.view[offset++];
                            part2 |= (b & 0x7F) << 7;
                            if ((b & 0x80) || (this.noAssert && typeof b === 'undefined')) {
                              throw Error("Buffer overrun");
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
          var value = Long.fromBits(part0 | (part1 << 28), (part1 >>> 4) | (part2) << 24, false);
          if (relative) {
            this.offset = offset;
            return value;
          } else {
            return {
              'value': value,
              'length': offset - start
            };
          }
        };
        ByteBufferPrototype.readVarint64ZigZag = function(offset) {
          var val = this.readVarint64(offset);
          if (val && val['value'] instanceof Long)
            val["value"] = ByteBuffer.zigZagDecode64(val["value"]);
          else
            val = ByteBuffer.zigZagDecode64(val);
          return val;
        };
      }
      ByteBufferPrototype.writeCString = function(str, offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        var i,
            k = str.length;
        if (!this.noAssert) {
          if (typeof str !== 'string')
            throw TypeError("Illegal str: Not a string");
          for (i = 0; i < k; ++i) {
            if (str.charCodeAt(i) === 0)
              throw RangeError("Illegal str: Contains NULL-characters");
          }
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 0 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 0 + ") <= " + this.buffer.byteLength);
        }
        k = utfx.calculateUTF16asUTF8(stringSource(str))[1];
        offset += k + 1;
        var capacity12 = this.buffer.byteLength;
        if (offset > capacity12)
          this.resize((capacity12 *= 2) > offset ? capacity12 : offset);
        offset -= k + 1;
        utfx.encodeUTF16toUTF8(stringSource(str), function(b) {
          this.view[offset++] = b;
        }.bind(this));
        this.view[offset++] = 0;
        if (relative) {
          this.offset = offset;
          return this;
        }
        return k;
      };
      ByteBufferPrototype.readCString = function(offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 1 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 1 + ") <= " + this.buffer.byteLength);
        }
        var start = offset,
            temp;
        var sd,
            b = -1;
        utfx.decodeUTF8toUTF16(function() {
          if (b === 0)
            return null;
          if (offset >= this.limit)
            throw RangeError("Illegal range: Truncated data, " + offset + " < " + this.limit);
          b = this.view[offset++];
          return b === 0 ? null : b;
        }.bind(this), sd = stringDestination(), true);
        if (relative) {
          this.offset = offset;
          return sd();
        } else {
          return {
            "string": sd(),
            "length": offset - start
          };
        }
      };
      ByteBufferPrototype.writeIString = function(str, offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof str !== 'string')
            throw TypeError("Illegal str: Not a string");
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 0 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 0 + ") <= " + this.buffer.byteLength);
        }
        var start = offset,
            k;
        k = utfx.calculateUTF16asUTF8(stringSource(str), this.noAssert)[1];
        offset += 4 + k;
        var capacity13 = this.buffer.byteLength;
        if (offset > capacity13)
          this.resize((capacity13 *= 2) > offset ? capacity13 : offset);
        offset -= 4 + k;
        if (this.littleEndian) {
          this.view[offset + 3] = (k >>> 24) & 0xFF;
          this.view[offset + 2] = (k >>> 16) & 0xFF;
          this.view[offset + 1] = (k >>> 8) & 0xFF;
          this.view[offset] = k & 0xFF;
        } else {
          this.view[offset] = (k >>> 24) & 0xFF;
          this.view[offset + 1] = (k >>> 16) & 0xFF;
          this.view[offset + 2] = (k >>> 8) & 0xFF;
          this.view[offset + 3] = k & 0xFF;
        }
        offset += 4;
        utfx.encodeUTF16toUTF8(stringSource(str), function(b) {
          this.view[offset++] = b;
        }.bind(this));
        if (offset !== start + 4 + k)
          throw RangeError("Illegal range: Truncated data, " + offset + " == " + (offset + 4 + k));
        if (relative) {
          this.offset = offset;
          return this;
        }
        return offset - start;
      };
      ByteBufferPrototype.readIString = function(offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 4 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 4 + ") <= " + this.buffer.byteLength);
        }
        var temp = 0,
            start = offset,
            str;
        if (this.littleEndian) {
          temp = this.view[offset + 2] << 16;
          temp |= this.view[offset + 1] << 8;
          temp |= this.view[offset];
          temp += this.view[offset + 3] << 24 >>> 0;
        } else {
          temp = this.view[offset + 1] << 16;
          temp |= this.view[offset + 2] << 8;
          temp |= this.view[offset + 3];
          temp += this.view[offset] << 24 >>> 0;
        }
        offset += 4;
        var k = offset + temp,
            sd;
        utfx.decodeUTF8toUTF16(function() {
          return offset < k ? this.view[offset++] : null;
        }.bind(this), sd = stringDestination(), this.noAssert);
        str = sd();
        if (relative) {
          this.offset = offset;
          return str;
        } else {
          return {
            'string': str,
            'length': offset - start
          };
        }
      };
      ByteBuffer.METRICS_CHARS = 'c';
      ByteBuffer.METRICS_BYTES = 'b';
      ByteBufferPrototype.writeUTF8String = function(str, offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 0 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 0 + ") <= " + this.buffer.byteLength);
        }
        var k;
        var start = offset;
        k = utfx.calculateUTF16asUTF8(stringSource(str))[1];
        offset += k;
        var capacity14 = this.buffer.byteLength;
        if (offset > capacity14)
          this.resize((capacity14 *= 2) > offset ? capacity14 : offset);
        offset -= k;
        utfx.encodeUTF16toUTF8(stringSource(str), function(b) {
          this.view[offset++] = b;
        }.bind(this));
        if (relative) {
          this.offset = offset;
          return this;
        }
        return offset - start;
      };
      ByteBufferPrototype.writeString = ByteBufferPrototype.writeUTF8String;
      ByteBuffer.calculateUTF8Chars = function(str) {
        return utfx.calculateUTF16asUTF8(stringSource(str))[0];
      };
      ByteBuffer.calculateUTF8Bytes = function(str) {
        return utfx.calculateUTF16asUTF8(stringSource(str))[1];
      };
      ByteBuffer.calculateString = ByteBuffer.calculateUTF8Bytes;
      ByteBufferPrototype.readUTF8String = function(length, metrics, offset) {
        if (typeof metrics === 'number') {
          offset = metrics;
          metrics = undefined;
        }
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (typeof metrics === 'undefined')
          metrics = ByteBuffer.METRICS_CHARS;
        if (!this.noAssert) {
          if (typeof length !== 'number' || length % 1 !== 0)
            throw TypeError("Illegal length: " + length + " (not an integer)");
          length |= 0;
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 0 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 0 + ") <= " + this.buffer.byteLength);
        }
        var i = 0,
            start = offset,
            sd;
        if (metrics === ByteBuffer.METRICS_CHARS) {
          sd = stringDestination();
          utfx.decodeUTF8(function() {
            return i < length && offset < this.limit ? this.view[offset++] : null;
          }.bind(this), function(cp) {
            ++i;
            utfx.UTF8toUTF16(cp, sd);
          });
          if (i !== length)
            throw RangeError("Illegal range: Truncated data, " + i + " == " + length);
          if (relative) {
            this.offset = offset;
            return sd();
          } else {
            return {
              "string": sd(),
              "length": offset - start
            };
          }
        } else if (metrics === ByteBuffer.METRICS_BYTES) {
          if (!this.noAssert) {
            if (typeof offset !== 'number' || offset % 1 !== 0)
              throw TypeError("Illegal offset: " + offset + " (not an integer)");
            offset >>>= 0;
            if (offset < 0 || offset + length > this.buffer.byteLength)
              throw RangeError("Illegal offset: 0 <= " + offset + " (+" + length + ") <= " + this.buffer.byteLength);
          }
          var k = offset + length;
          utfx.decodeUTF8toUTF16(function() {
            return offset < k ? this.view[offset++] : null;
          }.bind(this), sd = stringDestination(), this.noAssert);
          if (offset !== k)
            throw RangeError("Illegal range: Truncated data, " + offset + " == " + k);
          if (relative) {
            this.offset = offset;
            return sd();
          } else {
            return {
              'string': sd(),
              'length': offset - start
            };
          }
        } else
          throw TypeError("Unsupported metrics: " + metrics);
      };
      ByteBufferPrototype.readString = ByteBufferPrototype.readUTF8String;
      ByteBufferPrototype.writeVString = function(str, offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof str !== 'string')
            throw TypeError("Illegal str: Not a string");
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 0 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 0 + ") <= " + this.buffer.byteLength);
        }
        var start = offset,
            k,
            l;
        k = utfx.calculateUTF16asUTF8(stringSource(str), this.noAssert)[1];
        l = ByteBuffer.calculateVarint32(k);
        offset += l + k;
        var capacity15 = this.buffer.byteLength;
        if (offset > capacity15)
          this.resize((capacity15 *= 2) > offset ? capacity15 : offset);
        offset -= l + k;
        offset += this.writeVarint32(k, offset);
        utfx.encodeUTF16toUTF8(stringSource(str), function(b) {
          this.view[offset++] = b;
        }.bind(this));
        if (offset !== start + k + l)
          throw RangeError("Illegal range: Truncated data, " + offset + " == " + (offset + k + l));
        if (relative) {
          this.offset = offset;
          return this;
        }
        return offset - start;
      };
      ByteBufferPrototype.readVString = function(offset) {
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 1 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 1 + ") <= " + this.buffer.byteLength);
        }
        var temp = this.readVarint32(offset),
            start = offset,
            str;
        offset += temp['length'];
        temp = temp['value'];
        var k = offset + temp,
            sd = stringDestination();
        utfx.decodeUTF8toUTF16(function() {
          return offset < k ? this.view[offset++] : null;
        }.bind(this), sd, this.noAssert);
        str = sd();
        if (relative) {
          this.offset = offset;
          return str;
        } else {
          return {
            'string': str,
            'length': offset - start
          };
        }
      };
      ByteBufferPrototype.append = function(source, encoding, offset) {
        if (typeof encoding === 'number' || typeof encoding !== 'string') {
          offset = encoding;
          encoding = undefined;
        }
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 0 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 0 + ") <= " + this.buffer.byteLength);
        }
        if (!(source instanceof ByteBuffer))
          source = ByteBuffer.wrap(source, encoding);
        var length = source.limit - source.offset;
        if (length <= 0)
          return this;
        offset += length;
        var capacity16 = this.buffer.byteLength;
        if (offset > capacity16)
          this.resize((capacity16 *= 2) > offset ? capacity16 : offset);
        offset -= length;
        this.view.set(source.view.subarray(source.offset, source.limit), offset);
        source.offset += length;
        if (relative)
          this.offset += length;
        return this;
      };
      ByteBufferPrototype.appendTo = function(target, offset) {
        target.append(this, offset);
        return this;
      };
      ByteBufferPrototype.assert = function(assert) {
        this.noAssert = !assert;
        return this;
      };
      ByteBufferPrototype.capacity = function() {
        return this.buffer.byteLength;
      };
      ByteBufferPrototype.clear = function() {
        this.offset = 0;
        this.limit = this.buffer.byteLength;
        this.markedOffset = -1;
        return this;
      };
      ByteBufferPrototype.clone = function(copy) {
        var bb = new ByteBuffer(0, this.littleEndian, this.noAssert);
        if (copy) {
          bb.buffer = new ArrayBuffer(this.buffer.byteLength);
          bb.view = new Uint8Array(bb.buffer);
        } else {
          bb.buffer = this.buffer;
          bb.view = this.view;
        }
        bb.offset = this.offset;
        bb.markedOffset = this.markedOffset;
        bb.limit = this.limit;
        return bb;
      };
      ByteBufferPrototype.compact = function(begin, end) {
        if (typeof begin === 'undefined')
          begin = this.offset;
        if (typeof end === 'undefined')
          end = this.limit;
        if (!this.noAssert) {
          if (typeof begin !== 'number' || begin % 1 !== 0)
            throw TypeError("Illegal begin: Not an integer");
          begin >>>= 0;
          if (typeof end !== 'number' || end % 1 !== 0)
            throw TypeError("Illegal end: Not an integer");
          end >>>= 0;
          if (begin < 0 || begin > end || end > this.buffer.byteLength)
            throw RangeError("Illegal range: 0 <= " + begin + " <= " + end + " <= " + this.buffer.byteLength);
        }
        if (begin === 0 && end === this.buffer.byteLength)
          return this;
        var len = end - begin;
        if (len === 0) {
          this.buffer = EMPTY_BUFFER;
          this.view = null;
          if (this.markedOffset >= 0)
            this.markedOffset -= begin;
          this.offset = 0;
          this.limit = 0;
          return this;
        }
        var buffer = new ArrayBuffer(len);
        var view = new Uint8Array(buffer);
        view.set(this.view.subarray(begin, end));
        this.buffer = buffer;
        this.view = view;
        if (this.markedOffset >= 0)
          this.markedOffset -= begin;
        this.offset = 0;
        this.limit = len;
        return this;
      };
      ByteBufferPrototype.copy = function(begin, end) {
        if (typeof begin === 'undefined')
          begin = this.offset;
        if (typeof end === 'undefined')
          end = this.limit;
        if (!this.noAssert) {
          if (typeof begin !== 'number' || begin % 1 !== 0)
            throw TypeError("Illegal begin: Not an integer");
          begin >>>= 0;
          if (typeof end !== 'number' || end % 1 !== 0)
            throw TypeError("Illegal end: Not an integer");
          end >>>= 0;
          if (begin < 0 || begin > end || end > this.buffer.byteLength)
            throw RangeError("Illegal range: 0 <= " + begin + " <= " + end + " <= " + this.buffer.byteLength);
        }
        if (begin === end)
          return new ByteBuffer(0, this.littleEndian, this.noAssert);
        var capacity = end - begin,
            bb = new ByteBuffer(capacity, this.littleEndian, this.noAssert);
        bb.offset = 0;
        bb.limit = capacity;
        if (bb.markedOffset >= 0)
          bb.markedOffset -= begin;
        this.copyTo(bb, 0, begin, end);
        return bb;
      };
      ByteBufferPrototype.copyTo = function(target, targetOffset, sourceOffset, sourceLimit) {
        var relative,
            targetRelative;
        if (!this.noAssert) {
          if (!ByteBuffer.isByteBuffer(target))
            throw TypeError("Illegal target: Not a ByteBuffer");
        }
        targetOffset = (targetRelative = typeof targetOffset === 'undefined') ? target.offset : targetOffset | 0;
        sourceOffset = (relative = typeof sourceOffset === 'undefined') ? this.offset : sourceOffset | 0;
        sourceLimit = typeof sourceLimit === 'undefined' ? this.limit : sourceLimit | 0;
        if (targetOffset < 0 || targetOffset > target.buffer.byteLength)
          throw RangeError("Illegal target range: 0 <= " + targetOffset + " <= " + target.buffer.byteLength);
        if (sourceOffset < 0 || sourceLimit > this.buffer.byteLength)
          throw RangeError("Illegal source range: 0 <= " + sourceOffset + " <= " + this.buffer.byteLength);
        var len = sourceLimit - sourceOffset;
        if (len === 0)
          return target;
        target.ensureCapacity(targetOffset + len);
        target.view.set(this.view.subarray(sourceOffset, sourceLimit), targetOffset);
        if (relative)
          this.offset += len;
        if (targetRelative)
          target.offset += len;
        return this;
      };
      ByteBufferPrototype.ensureCapacity = function(capacity) {
        var current = this.buffer.byteLength;
        if (current < capacity)
          return this.resize((current *= 2) > capacity ? current : capacity);
        return this;
      };
      ByteBufferPrototype.fill = function(value, begin, end) {
        var relative = typeof begin === 'undefined';
        if (relative)
          begin = this.offset;
        if (typeof value === 'string' && value.length > 0)
          value = value.charCodeAt(0);
        if (typeof begin === 'undefined')
          begin = this.offset;
        if (typeof end === 'undefined')
          end = this.limit;
        if (!this.noAssert) {
          if (typeof value !== 'number' || value % 1 !== 0)
            throw TypeError("Illegal value: " + value + " (not an integer)");
          value |= 0;
          if (typeof begin !== 'number' || begin % 1 !== 0)
            throw TypeError("Illegal begin: Not an integer");
          begin >>>= 0;
          if (typeof end !== 'number' || end % 1 !== 0)
            throw TypeError("Illegal end: Not an integer");
          end >>>= 0;
          if (begin < 0 || begin > end || end > this.buffer.byteLength)
            throw RangeError("Illegal range: 0 <= " + begin + " <= " + end + " <= " + this.buffer.byteLength);
        }
        if (begin >= end)
          return this;
        while (begin < end)
          this.view[begin++] = value;
        if (relative)
          this.offset = begin;
        return this;
      };
      ByteBufferPrototype.flip = function() {
        this.limit = this.offset;
        this.offset = 0;
        return this;
      };
      ByteBufferPrototype.mark = function(offset) {
        offset = typeof offset === 'undefined' ? this.offset : offset;
        if (!this.noAssert) {
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 0 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 0 + ") <= " + this.buffer.byteLength);
        }
        this.markedOffset = offset;
        return this;
      };
      ByteBufferPrototype.order = function(littleEndian) {
        if (!this.noAssert) {
          if (typeof littleEndian !== 'boolean')
            throw TypeError("Illegal littleEndian: Not a boolean");
        }
        this.littleEndian = !!littleEndian;
        return this;
      };
      ByteBufferPrototype.LE = function(littleEndian) {
        this.littleEndian = typeof littleEndian !== 'undefined' ? !!littleEndian : true;
        return this;
      };
      ByteBufferPrototype.BE = function(bigEndian) {
        this.littleEndian = typeof bigEndian !== 'undefined' ? !bigEndian : false;
        return this;
      };
      ByteBufferPrototype.prepend = function(source, encoding, offset) {
        if (typeof encoding === 'number' || typeof encoding !== 'string') {
          offset = encoding;
          encoding = undefined;
        }
        var relative = typeof offset === 'undefined';
        if (relative)
          offset = this.offset;
        if (!this.noAssert) {
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: " + offset + " (not an integer)");
          offset >>>= 0;
          if (offset < 0 || offset + 0 > this.buffer.byteLength)
            throw RangeError("Illegal offset: 0 <= " + offset + " (+" + 0 + ") <= " + this.buffer.byteLength);
        }
        if (!(source instanceof ByteBuffer))
          source = ByteBuffer.wrap(source, encoding);
        var len = source.limit - source.offset;
        if (len <= 0)
          return this;
        var diff = len - offset;
        if (diff > 0) {
          var buffer = new ArrayBuffer(this.buffer.byteLength + diff);
          var view = new Uint8Array(buffer);
          view.set(this.view.subarray(offset, this.buffer.byteLength), len);
          this.buffer = buffer;
          this.view = view;
          this.offset += diff;
          if (this.markedOffset >= 0)
            this.markedOffset += diff;
          this.limit += diff;
          offset += diff;
        } else {
          var arrayView = new Uint8Array(this.buffer);
        }
        this.view.set(source.view.subarray(source.offset, source.limit), offset - len);
        source.offset = source.limit;
        if (relative)
          this.offset -= len;
        return this;
      };
      ByteBufferPrototype.prependTo = function(target, offset) {
        target.prepend(this, offset);
        return this;
      };
      ByteBufferPrototype.printDebug = function(out) {
        if (typeof out !== 'function')
          out = console.log.bind(console);
        out(this.toString() + "\n" + "-------------------------------------------------------------------\n" + this.toDebug(true));
      };
      ByteBufferPrototype.remaining = function() {
        return this.limit - this.offset;
      };
      ByteBufferPrototype.reset = function() {
        if (this.markedOffset >= 0) {
          this.offset = this.markedOffset;
          this.markedOffset = -1;
        } else {
          this.offset = 0;
        }
        return this;
      };
      ByteBufferPrototype.resize = function(capacity) {
        if (!this.noAssert) {
          if (typeof capacity !== 'number' || capacity % 1 !== 0)
            throw TypeError("Illegal capacity: " + capacity + " (not an integer)");
          capacity |= 0;
          if (capacity < 0)
            throw RangeError("Illegal capacity: 0 <= " + capacity);
        }
        if (this.buffer.byteLength < capacity) {
          var buffer = new ArrayBuffer(capacity);
          var view = new Uint8Array(buffer);
          view.set(this.view);
          this.buffer = buffer;
          this.view = view;
        }
        return this;
      };
      ByteBufferPrototype.reverse = function(begin, end) {
        if (typeof begin === 'undefined')
          begin = this.offset;
        if (typeof end === 'undefined')
          end = this.limit;
        if (!this.noAssert) {
          if (typeof begin !== 'number' || begin % 1 !== 0)
            throw TypeError("Illegal begin: Not an integer");
          begin >>>= 0;
          if (typeof end !== 'number' || end % 1 !== 0)
            throw TypeError("Illegal end: Not an integer");
          end >>>= 0;
          if (begin < 0 || begin > end || end > this.buffer.byteLength)
            throw RangeError("Illegal range: 0 <= " + begin + " <= " + end + " <= " + this.buffer.byteLength);
        }
        if (begin === end)
          return this;
        Array.prototype.reverse.call(this.view.subarray(begin, end));
        return this;
      };
      ByteBufferPrototype.skip = function(length) {
        if (!this.noAssert) {
          if (typeof length !== 'number' || length % 1 !== 0)
            throw TypeError("Illegal length: " + length + " (not an integer)");
          length |= 0;
        }
        var offset = this.offset + length;
        if (!this.noAssert) {
          if (offset < 0 || offset > this.buffer.byteLength)
            throw RangeError("Illegal length: 0 <= " + this.offset + " + " + length + " <= " + this.buffer.byteLength);
        }
        this.offset = offset;
        return this;
      };
      ByteBufferPrototype.slice = function(begin, end) {
        if (typeof begin === 'undefined')
          begin = this.offset;
        if (typeof end === 'undefined')
          end = this.limit;
        if (!this.noAssert) {
          if (typeof begin !== 'number' || begin % 1 !== 0)
            throw TypeError("Illegal begin: Not an integer");
          begin >>>= 0;
          if (typeof end !== 'number' || end % 1 !== 0)
            throw TypeError("Illegal end: Not an integer");
          end >>>= 0;
          if (begin < 0 || begin > end || end > this.buffer.byteLength)
            throw RangeError("Illegal range: 0 <= " + begin + " <= " + end + " <= " + this.buffer.byteLength);
        }
        var bb = this.clone();
        bb.offset = begin;
        bb.limit = end;
        return bb;
      };
      ByteBufferPrototype.toBuffer = function(forceCopy) {
        var offset = this.offset,
            limit = this.limit;
        if (!this.noAssert) {
          if (typeof offset !== 'number' || offset % 1 !== 0)
            throw TypeError("Illegal offset: Not an integer");
          offset >>>= 0;
          if (typeof limit !== 'number' || limit % 1 !== 0)
            throw TypeError("Illegal limit: Not an integer");
          limit >>>= 0;
          if (offset < 0 || offset > limit || limit > this.buffer.byteLength)
            throw RangeError("Illegal range: 0 <= " + offset + " <= " + limit + " <= " + this.buffer.byteLength);
        }
        if (!forceCopy && offset === 0 && limit === this.buffer.byteLength)
          return this.buffer;
        if (offset === limit)
          return EMPTY_BUFFER;
        var buffer = new ArrayBuffer(limit - offset);
        new Uint8Array(buffer).set(new Uint8Array(this.buffer).subarray(offset, limit), 0);
        return buffer;
      };
      ByteBufferPrototype.toArrayBuffer = ByteBufferPrototype.toBuffer;
      ByteBufferPrototype.toString = function(encoding, begin, end) {
        if (typeof encoding === 'undefined')
          return "ByteBufferAB(offset=" + this.offset + ",markedOffset=" + this.markedOffset + ",limit=" + this.limit + ",capacity=" + this.capacity() + ")";
        if (typeof encoding === 'number')
          encoding = "utf8", begin = encoding, end = begin;
        switch (encoding) {
          case "utf8":
            return this.toUTF8(begin, end);
          case "base64":
            return this.toBase64(begin, end);
          case "hex":
            return this.toHex(begin, end);
          case "binary":
            return this.toBinary(begin, end);
          case "debug":
            return this.toDebug();
          case "columns":
            return this.toColumns();
          default:
            throw Error("Unsupported encoding: " + encoding);
        }
      };
      var lxiv = function() {
        "use strict";
        var lxiv = {};
        var aout = [65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 43, 47];
        var ain = [];
        for (var i = 0,
            k = aout.length; i < k; ++i)
          ain[aout[i]] = i;
        lxiv.encode = function(src, dst) {
          var b,
              t;
          while ((b = src()) !== null) {
            dst(aout[(b >> 2) & 0x3f]);
            t = (b & 0x3) << 4;
            if ((b = src()) !== null) {
              t |= (b >> 4) & 0xf;
              dst(aout[(t | ((b >> 4) & 0xf)) & 0x3f]);
              t = (b & 0xf) << 2;
              if ((b = src()) !== null)
                dst(aout[(t | ((b >> 6) & 0x3)) & 0x3f]), dst(aout[b & 0x3f]);
              else
                dst(aout[t & 0x3f]), dst(61);
            } else
              dst(aout[t & 0x3f]), dst(61), dst(61);
          }
        };
        lxiv.decode = function(src, dst) {
          var c,
              t1,
              t2;
          function fail(c) {
            throw Error("Illegal character code: " + c);
          }
          while ((c = src()) !== null) {
            t1 = ain[c];
            if (typeof t1 === 'undefined')
              fail(c);
            if ((c = src()) !== null) {
              t2 = ain[c];
              if (typeof t2 === 'undefined')
                fail(c);
              dst((t1 << 2) >>> 0 | (t2 & 0x30) >> 4);
              if ((c = src()) !== null) {
                t1 = ain[c];
                if (typeof t1 === 'undefined')
                  if (c === 61)
                    break;
                  else
                    fail(c);
                dst(((t2 & 0xf) << 4) >>> 0 | (t1 & 0x3c) >> 2);
                if ((c = src()) !== null) {
                  t2 = ain[c];
                  if (typeof t2 === 'undefined')
                    if (c === 61)
                      break;
                    else
                      fail(c);
                  dst(((t1 & 0x3) << 6) >>> 0 | t2);
                }
              }
            }
          }
        };
        lxiv.test = function(str) {
          return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(str);
        };
        return lxiv;
      }();
      ByteBufferPrototype.toBase64 = function(begin, end) {
        if (typeof begin === 'undefined')
          begin = this.offset;
        if (typeof end === 'undefined')
          end = this.limit;
        if (!this.noAssert) {
          if (typeof begin !== 'number' || begin % 1 !== 0)
            throw TypeError("Illegal begin: Not an integer");
          begin >>>= 0;
          if (typeof end !== 'number' || end % 1 !== 0)
            throw TypeError("Illegal end: Not an integer");
          end >>>= 0;
          if (begin < 0 || begin > end || end > this.buffer.byteLength)
            throw RangeError("Illegal range: 0 <= " + begin + " <= " + end + " <= " + this.buffer.byteLength);
        }
        var sd;
        lxiv.encode(function() {
          return begin < end ? this.view[begin++] : null;
        }.bind(this), sd = stringDestination());
        return sd();
      };
      ByteBuffer.fromBase64 = function(str, littleEndian, noAssert) {
        if (!noAssert) {
          if (typeof str !== 'string')
            throw TypeError("Illegal str: Not a string");
          if (str.length % 4 !== 0)
            throw TypeError("Illegal str: Length not a multiple of 4");
        }
        var bb = new ByteBuffer(str.length / 4 * 3, littleEndian, noAssert),
            i = 0;
        lxiv.decode(stringSource(str), function(b) {
          bb.view[i++] = b;
        });
        bb.limit = i;
        return bb;
      };
      ByteBuffer.btoa = function(str) {
        return ByteBuffer.fromBinary(str).toBase64();
      };
      ByteBuffer.atob = function(b64) {
        return ByteBuffer.fromBase64(b64).toBinary();
      };
      ByteBufferPrototype.toBinary = function(begin, end) {
        begin = typeof begin === 'undefined' ? this.offset : begin;
        end = typeof end === 'undefined' ? this.limit : end;
        if (!this.noAssert) {
          if (typeof begin !== 'number' || begin % 1 !== 0)
            throw TypeError("Illegal begin: Not an integer");
          begin >>>= 0;
          if (typeof end !== 'number' || end % 1 !== 0)
            throw TypeError("Illegal end: Not an integer");
          end >>>= 0;
          if (begin < 0 || begin > end || end > this.buffer.byteLength)
            throw RangeError("Illegal range: 0 <= " + begin + " <= " + end + " <= " + this.buffer.byteLength);
        }
        if (begin === end)
          return "";
        var cc = [],
            pt = [];
        while (begin < end) {
          cc.push(this.view[begin++]);
          if (cc.length >= 1024)
            pt.push(String.fromCharCode.apply(String, cc)), cc = [];
        }
        return pt.join('') + String.fromCharCode.apply(String, cc);
      };
      ByteBuffer.fromBinary = function(str, littleEndian, noAssert) {
        if (!noAssert) {
          if (typeof str !== 'string')
            throw TypeError("Illegal str: Not a string");
        }
        var i = 0,
            k = str.length,
            charCode,
            bb = new ByteBuffer(k, littleEndian, noAssert);
        while (i < k) {
          charCode = str.charCodeAt(i);
          if (!noAssert && charCode > 255)
            throw RangeError("Illegal charCode at " + i + ": 0 <= " + charCode + " <= 255");
          bb.view[i++] = charCode;
        }
        bb.limit = k;
        return bb;
      };
      ByteBufferPrototype.toDebug = function(columns) {
        var i = -1,
            k = this.buffer.byteLength,
            b,
            hex = "",
            asc = "",
            out = "";
        while (i < k) {
          if (i !== -1) {
            b = this.view[i];
            if (b < 0x10)
              hex += "0" + b.toString(16).toUpperCase();
            else
              hex += b.toString(16).toUpperCase();
            if (columns) {
              asc += b > 32 && b < 127 ? String.fromCharCode(b) : '.';
            }
          }
          ++i;
          if (columns) {
            if (i > 0 && i % 16 === 0 && i !== k) {
              while (hex.length < 3 * 16 + 3)
                hex += " ";
              out += hex + asc + "\n";
              hex = asc = "";
            }
          }
          if (i === this.offset && i === this.limit)
            hex += i === this.markedOffset ? "!" : "|";
          else if (i === this.offset)
            hex += i === this.markedOffset ? "[" : "<";
          else if (i === this.limit)
            hex += i === this.markedOffset ? "]" : ">";
          else
            hex += i === this.markedOffset ? "'" : (columns || (i !== 0 && i !== k) ? " " : "");
        }
        if (columns && hex !== " ") {
          while (hex.length < 3 * 16 + 3)
            hex += " ";
          out += hex + asc + "\n";
        }
        return columns ? out : hex;
      };
      ByteBuffer.fromDebug = function(str, littleEndian, noAssert) {
        var k = str.length,
            bb = new ByteBuffer(((k + 1) / 3) | 0, littleEndian, noAssert);
        var i = 0,
            j = 0,
            ch,
            b,
            rs = false,
            ho = false,
            hm = false,
            hl = false,
            fail = false;
        while (i < k) {
          switch (ch = str.charAt(i++)) {
            case '!':
              if (!noAssert) {
                if (ho || hm || hl) {
                  fail = true;
                  break;
                }
                ho = hm = hl = true;
              }
              bb.offset = bb.markedOffset = bb.limit = j;
              rs = false;
              break;
            case '|':
              if (!noAssert) {
                if (ho || hl) {
                  fail = true;
                  break;
                }
                ho = hl = true;
              }
              bb.offset = bb.limit = j;
              rs = false;
              break;
            case '[':
              if (!noAssert) {
                if (ho || hm) {
                  fail = true;
                  break;
                }
                ho = hm = true;
              }
              bb.offset = bb.markedOffset = j;
              rs = false;
              break;
            case '<':
              if (!noAssert) {
                if (ho) {
                  fail = true;
                  break;
                }
                ho = true;
              }
              bb.offset = j;
              rs = false;
              break;
            case ']':
              if (!noAssert) {
                if (hl || hm) {
                  fail = true;
                  break;
                }
                hl = hm = true;
              }
              bb.limit = bb.markedOffset = j;
              rs = false;
              break;
            case '>':
              if (!noAssert) {
                if (hl) {
                  fail = true;
                  break;
                }
                hl = true;
              }
              bb.limit = j;
              rs = false;
              break;
            case "'":
              if (!noAssert) {
                if (hm) {
                  fail = true;
                  break;
                }
                hm = true;
              }
              bb.markedOffset = j;
              rs = false;
              break;
            case ' ':
              rs = false;
              break;
            default:
              if (!noAssert) {
                if (rs) {
                  fail = true;
                  break;
                }
              }
              b = parseInt(ch + str.charAt(i++), 16);
              if (!noAssert) {
                if (isNaN(b) || b < 0 || b > 255)
                  throw TypeError("Illegal str: Not a debug encoded string");
              }
              bb.view[j++] = b;
              rs = true;
          }
          if (fail)
            throw TypeError("Illegal str: Invalid symbol at " + i);
        }
        if (!noAssert) {
          if (!ho || !hl)
            throw TypeError("Illegal str: Missing offset or limit");
          if (j < bb.buffer.byteLength)
            throw TypeError("Illegal str: Not a debug encoded string (is it hex?) " + j + " < " + k);
        }
        return bb;
      };
      ByteBufferPrototype.toHex = function(begin, end) {
        begin = typeof begin === 'undefined' ? this.offset : begin;
        end = typeof end === 'undefined' ? this.limit : end;
        if (!this.noAssert) {
          if (typeof begin !== 'number' || begin % 1 !== 0)
            throw TypeError("Illegal begin: Not an integer");
          begin >>>= 0;
          if (typeof end !== 'number' || end % 1 !== 0)
            throw TypeError("Illegal end: Not an integer");
          end >>>= 0;
          if (begin < 0 || begin > end || end > this.buffer.byteLength)
            throw RangeError("Illegal range: 0 <= " + begin + " <= " + end + " <= " + this.buffer.byteLength);
        }
        var out = new Array(end - begin),
            b;
        while (begin < end) {
          b = this.view[begin++];
          if (b < 0x10)
            out.push("0", b.toString(16));
          else
            out.push(b.toString(16));
        }
        return out.join('');
      };
      ByteBuffer.fromHex = function(str, littleEndian, noAssert) {
        if (!noAssert) {
          if (typeof str !== 'string')
            throw TypeError("Illegal str: Not a string");
          if (str.length % 2 !== 0)
            throw TypeError("Illegal str: Length not a multiple of 2");
        }
        var k = str.length,
            bb = new ByteBuffer((k / 2) | 0, littleEndian),
            b;
        for (var i = 0,
            j = 0; i < k; i += 2) {
          b = parseInt(str.substring(i, i + 2), 16);
          if (!noAssert)
            if (!isFinite(b) || b < 0 || b > 255)
              throw TypeError("Illegal str: Contains non-hex characters");
          bb.view[j++] = b;
        }
        bb.limit = j;
        return bb;
      };
      var utfx = function() {
        "use strict";
        var utfx = {};
        utfx.MAX_CODEPOINT = 0x10FFFF;
        utfx.encodeUTF8 = function(src, dst) {
          var cp = null;
          if (typeof src === 'number')
            cp = src, src = function() {
              return null;
            };
          while (cp !== null || (cp = src()) !== null) {
            if (cp < 0x80)
              dst(cp & 0x7F);
            else if (cp < 0x800)
              dst(((cp >> 6) & 0x1F) | 0xC0), dst((cp & 0x3F) | 0x80);
            else if (cp < 0x10000)
              dst(((cp >> 12) & 0x0F) | 0xE0), dst(((cp >> 6) & 0x3F) | 0x80), dst((cp & 0x3F) | 0x80);
            else
              dst(((cp >> 18) & 0x07) | 0xF0), dst(((cp >> 12) & 0x3F) | 0x80), dst(((cp >> 6) & 0x3F) | 0x80), dst((cp & 0x3F) | 0x80);
            cp = null;
          }
        };
        utfx.decodeUTF8 = function(src, dst) {
          var a,
              b,
              c,
              d,
              fail = function(b) {
                b = b.slice(0, b.indexOf(null));
                var err = Error(b.toString());
                err.name = "TruncatedError";
                err['bytes'] = b;
                throw err;
              };
          while ((a = src()) !== null) {
            if ((a & 0x80) === 0)
              dst(a);
            else if ((a & 0xE0) === 0xC0)
              ((b = src()) === null) && fail([a, b]), dst(((a & 0x1F) << 6) | (b & 0x3F));
            else if ((a & 0xF0) === 0xE0)
              ((b = src()) === null || (c = src()) === null) && fail([a, b, c]), dst(((a & 0x0F) << 12) | ((b & 0x3F) << 6) | (c & 0x3F));
            else if ((a & 0xF8) === 0xF0)
              ((b = src()) === null || (c = src()) === null || (d = src()) === null) && fail([a, b, c, d]), dst(((a & 0x07) << 18) | ((b & 0x3F) << 12) | ((c & 0x3F) << 6) | (d & 0x3F));
            else
              throw RangeError("Illegal starting byte: " + a);
          }
        };
        utfx.UTF16toUTF8 = function(src, dst) {
          var c1,
              c2 = null;
          while (true) {
            if ((c1 = c2 !== null ? c2 : src()) === null)
              break;
            if (c1 >= 0xD800 && c1 <= 0xDFFF) {
              if ((c2 = src()) !== null) {
                if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
                  dst((c1 - 0xD800) * 0x400 + c2 - 0xDC00 + 0x10000);
                  c2 = null;
                  continue;
                }
              }
            }
            dst(c1);
          }
          if (c2 !== null)
            dst(c2);
        };
        utfx.UTF8toUTF16 = function(src, dst) {
          var cp = null;
          if (typeof src === 'number')
            cp = src, src = function() {
              return null;
            };
          while (cp !== null || (cp = src()) !== null) {
            if (cp <= 0xFFFF)
              dst(cp);
            else
              cp -= 0x10000, dst((cp >> 10) + 0xD800), dst((cp % 0x400) + 0xDC00);
            cp = null;
          }
        };
        utfx.encodeUTF16toUTF8 = function(src, dst) {
          utfx.UTF16toUTF8(src, function(cp) {
            utfx.encodeUTF8(cp, dst);
          });
        };
        utfx.decodeUTF8toUTF16 = function(src, dst) {
          utfx.decodeUTF8(src, function(cp) {
            utfx.UTF8toUTF16(cp, dst);
          });
        };
        utfx.calculateCodePoint = function(cp) {
          return (cp < 0x80) ? 1 : (cp < 0x800) ? 2 : (cp < 0x10000) ? 3 : 4;
        };
        utfx.calculateUTF8 = function(src) {
          var cp,
              l = 0;
          while ((cp = src()) !== null)
            l += (cp < 0x80) ? 1 : (cp < 0x800) ? 2 : (cp < 0x10000) ? 3 : 4;
          return l;
        };
        utfx.calculateUTF16asUTF8 = function(src) {
          var n = 0,
              l = 0;
          utfx.UTF16toUTF8(src, function(cp) {
            ++n;
            l += (cp < 0x80) ? 1 : (cp < 0x800) ? 2 : (cp < 0x10000) ? 3 : 4;
          });
          return [n, l];
        };
        return utfx;
      }();
      ByteBufferPrototype.toUTF8 = function(begin, end) {
        if (typeof begin === 'undefined')
          begin = this.offset;
        if (typeof end === 'undefined')
          end = this.limit;
        if (!this.noAssert) {
          if (typeof begin !== 'number' || begin % 1 !== 0)
            throw TypeError("Illegal begin: Not an integer");
          begin >>>= 0;
          if (typeof end !== 'number' || end % 1 !== 0)
            throw TypeError("Illegal end: Not an integer");
          end >>>= 0;
          if (begin < 0 || begin > end || end > this.buffer.byteLength)
            throw RangeError("Illegal range: 0 <= " + begin + " <= " + end + " <= " + this.buffer.byteLength);
        }
        var sd;
        try {
          utfx.decodeUTF8toUTF16(function() {
            return begin < end ? this.view[begin++] : null;
          }.bind(this), sd = stringDestination());
        } catch (e) {
          if (begin !== end)
            throw RangeError("Illegal range: Truncated data, " + begin + " != " + end);
        }
        return sd();
      };
      ByteBuffer.fromUTF8 = function(str, littleEndian, noAssert) {
        if (!noAssert)
          if (typeof str !== 'string')
            throw TypeError("Illegal str: Not a string");
        var bb = new ByteBuffer(utfx.calculateUTF16asUTF8(stringSource(str), true)[1], littleEndian, noAssert),
            i = 0;
        utfx.encodeUTF16toUTF8(stringSource(str), function(b) {
          bb.view[i++] = b;
        });
        bb.limit = i;
        return bb;
      };
      return ByteBuffer;
    });
  })(require("14").Buffer);
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("16", ["15"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = require("15");
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("17", [], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  if ($__System._nodeRequire) {
    module.exports = $__System._nodeRequire('fs');
  } else {
    exports.readFileSync = function(address) {
      var output;
      var xhr = new XMLHttpRequest();
      xhr.open('GET', address, false);
      xhr.onreadystatechange = function(e) {
        if (xhr.readyState == 4) {
          var status = xhr.status;
          if ((status > 399 && status < 600) || status == 400) {
            throw 'File read error on ' + address;
          } else
            output = xhr.responseText;
        }
      };
      xhr.send(null);
      return output;
    };
  }
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("18", ["17"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = require("17");
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("19", ["5"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    function normalizeArray(parts, allowAboveRoot) {
      var up = 0;
      for (var i = parts.length - 1; i >= 0; i--) {
        var last = parts[i];
        if (last === '.') {
          parts.splice(i, 1);
        } else if (last === '..') {
          parts.splice(i, 1);
          up++;
        } else if (up) {
          parts.splice(i, 1);
          up--;
        }
      }
      if (allowAboveRoot) {
        for (; up--; up) {
          parts.unshift('..');
        }
      }
      return parts;
    }
    var splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
    var splitPath = function(filename) {
      return splitPathRe.exec(filename).slice(1);
    };
    exports.resolve = function() {
      var resolvedPath = '',
          resolvedAbsolute = false;
      for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
        var path = (i >= 0) ? arguments[i] : process.cwd();
        if (typeof path !== 'string') {
          throw new TypeError('Arguments to path.resolve must be strings');
        } else if (!path) {
          continue;
        }
        resolvedPath = path + '/' + resolvedPath;
        resolvedAbsolute = path.charAt(0) === '/';
      }
      resolvedPath = normalizeArray(filter(resolvedPath.split('/'), function(p) {
        return !!p;
      }), !resolvedAbsolute).join('/');
      return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
    };
    exports.normalize = function(path) {
      var isAbsolute = exports.isAbsolute(path),
          trailingSlash = substr(path, -1) === '/';
      path = normalizeArray(filter(path.split('/'), function(p) {
        return !!p;
      }), !isAbsolute).join('/');
      if (!path && !isAbsolute) {
        path = '.';
      }
      if (path && trailingSlash) {
        path += '/';
      }
      return (isAbsolute ? '/' : '') + path;
    };
    exports.isAbsolute = function(path) {
      return path.charAt(0) === '/';
    };
    exports.join = function() {
      var paths = Array.prototype.slice.call(arguments, 0);
      return exports.normalize(filter(paths, function(p, index) {
        if (typeof p !== 'string') {
          throw new TypeError('Arguments to path.join must be strings');
        }
        return p;
      }).join('/'));
    };
    exports.relative = function(from, to) {
      from = exports.resolve(from).substr(1);
      to = exports.resolve(to).substr(1);
      function trim(arr) {
        var start = 0;
        for (; start < arr.length; start++) {
          if (arr[start] !== '')
            break;
        }
        var end = arr.length - 1;
        for (; end >= 0; end--) {
          if (arr[end] !== '')
            break;
        }
        if (start > end)
          return [];
        return arr.slice(start, end - start + 1);
      }
      var fromParts = trim(from.split('/'));
      var toParts = trim(to.split('/'));
      var length = Math.min(fromParts.length, toParts.length);
      var samePartsLength = length;
      for (var i = 0; i < length; i++) {
        if (fromParts[i] !== toParts[i]) {
          samePartsLength = i;
          break;
        }
      }
      var outputParts = [];
      for (var i = samePartsLength; i < fromParts.length; i++) {
        outputParts.push('..');
      }
      outputParts = outputParts.concat(toParts.slice(samePartsLength));
      return outputParts.join('/');
    };
    exports.sep = '/';
    exports.delimiter = ':';
    exports.dirname = function(path) {
      var result = splitPath(path),
          root = result[0],
          dir = result[1];
      if (!root && !dir) {
        return '.';
      }
      if (dir) {
        dir = dir.substr(0, dir.length - 1);
      }
      return root + dir;
    };
    exports.basename = function(path, ext) {
      var f = splitPath(path)[2];
      if (ext && f.substr(-1 * ext.length) === ext) {
        f = f.substr(0, f.length - ext.length);
      }
      return f;
    };
    exports.extname = function(path) {
      return splitPath(path)[3];
    };
    function filter(xs, f) {
      if (xs.filter)
        return xs.filter(f);
      var res = [];
      for (var i = 0; i < xs.length; i++) {
        if (f(xs[i], i, xs))
          res.push(xs[i]);
      }
      return res;
    }
    var substr = 'ab'.substr(-1) === 'b' ? function(str, start, len) {
      return str.substr(start, len);
    } : function(str, start, len) {
      if (start < 0)
        start = str.length + start;
      return str.substr(start, len);
    };
    ;
  })(require("5"));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1a", ["19"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = require("19");
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1b", ["1a"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__System._nodeRequire ? $__System._nodeRequire('path') : require("1a");
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1c", ["1b"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = require("1b");
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1d", ["16", "18", "1c", "14", "5"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  "format cjs";
  (function(Buffer, process) {
    (function(global, factory) {
      if (typeof define === 'function' && define["amd"])
        define(["ByteBuffer"], factory);
      else if (typeof require === "function" && typeof module === "object" && module && module["exports"])
        module["exports"] = factory(require("16"));
      else
        (global["dcodeIO"] = global["dcodeIO"] || {})["ProtoBuf"] = factory(global["dcodeIO"]["ByteBuffer"]);
    })(this, function(ByteBuffer) {
      "use strict";
      var ProtoBuf = {};
      ProtoBuf.ByteBuffer = ByteBuffer;
      ProtoBuf.Long = ByteBuffer.Long || null;
      ProtoBuf.VERSION = "4.0.0";
      ProtoBuf.WIRE_TYPES = {};
      ProtoBuf.WIRE_TYPES.VARINT = 0;
      ProtoBuf.WIRE_TYPES.BITS64 = 1;
      ProtoBuf.WIRE_TYPES.LDELIM = 2;
      ProtoBuf.WIRE_TYPES.STARTGROUP = 3;
      ProtoBuf.WIRE_TYPES.ENDGROUP = 4;
      ProtoBuf.WIRE_TYPES.BITS32 = 5;
      ProtoBuf.PACKABLE_WIRE_TYPES = [ProtoBuf.WIRE_TYPES.VARINT, ProtoBuf.WIRE_TYPES.BITS64, ProtoBuf.WIRE_TYPES.BITS32];
      ProtoBuf.TYPES = {
        "int32": {
          name: "int32",
          wireType: ProtoBuf.WIRE_TYPES.VARINT,
          defaultValue: 0
        },
        "uint32": {
          name: "uint32",
          wireType: ProtoBuf.WIRE_TYPES.VARINT,
          defaultValue: 0
        },
        "sint32": {
          name: "sint32",
          wireType: ProtoBuf.WIRE_TYPES.VARINT,
          defaultValue: 0
        },
        "int64": {
          name: "int64",
          wireType: ProtoBuf.WIRE_TYPES.VARINT,
          defaultValue: ProtoBuf.Long ? ProtoBuf.Long.ZERO : undefined
        },
        "uint64": {
          name: "uint64",
          wireType: ProtoBuf.WIRE_TYPES.VARINT,
          defaultValue: ProtoBuf.Long ? ProtoBuf.Long.UZERO : undefined
        },
        "sint64": {
          name: "sint64",
          wireType: ProtoBuf.WIRE_TYPES.VARINT,
          defaultValue: ProtoBuf.Long ? ProtoBuf.Long.ZERO : undefined
        },
        "bool": {
          name: "bool",
          wireType: ProtoBuf.WIRE_TYPES.VARINT,
          defaultValue: false
        },
        "double": {
          name: "double",
          wireType: ProtoBuf.WIRE_TYPES.BITS64,
          defaultValue: 0
        },
        "string": {
          name: "string",
          wireType: ProtoBuf.WIRE_TYPES.LDELIM,
          defaultValue: ""
        },
        "bytes": {
          name: "bytes",
          wireType: ProtoBuf.WIRE_TYPES.LDELIM,
          defaultValue: null
        },
        "fixed32": {
          name: "fixed32",
          wireType: ProtoBuf.WIRE_TYPES.BITS32,
          defaultValue: 0
        },
        "sfixed32": {
          name: "sfixed32",
          wireType: ProtoBuf.WIRE_TYPES.BITS32,
          defaultValue: 0
        },
        "fixed64": {
          name: "fixed64",
          wireType: ProtoBuf.WIRE_TYPES.BITS64,
          defaultValue: ProtoBuf.Long ? ProtoBuf.Long.UZERO : undefined
        },
        "sfixed64": {
          name: "sfixed64",
          wireType: ProtoBuf.WIRE_TYPES.BITS64,
          defaultValue: ProtoBuf.Long ? ProtoBuf.Long.ZERO : undefined
        },
        "float": {
          name: "float",
          wireType: ProtoBuf.WIRE_TYPES.BITS32,
          defaultValue: 0
        },
        "enum": {
          name: "enum",
          wireType: ProtoBuf.WIRE_TYPES.VARINT,
          defaultValue: 0
        },
        "message": {
          name: "message",
          wireType: ProtoBuf.WIRE_TYPES.LDELIM,
          defaultValue: null
        },
        "group": {
          name: "group",
          wireType: ProtoBuf.WIRE_TYPES.STARTGROUP,
          defaultValue: null
        }
      };
      ProtoBuf.MAP_KEY_TYPES = [ProtoBuf.TYPES["int32"], ProtoBuf.TYPES["sint32"], ProtoBuf.TYPES["sfixed32"], ProtoBuf.TYPES["uint32"], ProtoBuf.TYPES["fixed32"], ProtoBuf.TYPES["int64"], ProtoBuf.TYPES["sint64"], ProtoBuf.TYPES["sfixed64"], ProtoBuf.TYPES["uint64"], ProtoBuf.TYPES["fixed64"], ProtoBuf.TYPES["bool"], ProtoBuf.TYPES["string"], ProtoBuf.TYPES["bytes"]];
      ProtoBuf.ID_MIN = 1;
      ProtoBuf.ID_MAX = 0x1FFFFFFF;
      ProtoBuf.convertFieldsToCamelCase = false;
      ProtoBuf.populateAccessors = true;
      ProtoBuf.populateDefaults = true;
      ProtoBuf.Util = (function() {
        "use strict";
        var Util = {};
        Util.IS_NODE = !!(typeof process === 'object' && process + '' === '[object process]');
        Util.XHR = function() {
          var XMLHttpFactories = [function() {
            return new XMLHttpRequest();
          }, function() {
            return new ActiveXObject("Msxml2.XMLHTTP");
          }, function() {
            return new ActiveXObject("Msxml3.XMLHTTP");
          }, function() {
            return new ActiveXObject("Microsoft.XMLHTTP");
          }];
          var xhr = null;
          for (var i = 0; i < XMLHttpFactories.length; i++) {
            try {
              xhr = XMLHttpFactories[i]();
            } catch (e) {
              continue;
            }
            break;
          }
          if (!xhr)
            throw Error("XMLHttpRequest is not supported");
          return xhr;
        };
        Util.fetch = function(path, callback) {
          if (callback && typeof callback != 'function')
            callback = null;
          if (Util.IS_NODE) {
            if (callback) {
              require("18").readFile(path, function(err, data) {
                if (err)
                  callback(null);
                else
                  callback("" + data);
              });
            } else
              try {
                return require("18").readFileSync(path);
              } catch (e) {
                return null;
              }
          } else {
            var xhr = Util.XHR();
            xhr.open('GET', path, callback ? true : false);
            xhr.setRequestHeader('Accept', 'text/plain');
            if (typeof xhr.overrideMimeType === 'function')
              xhr.overrideMimeType('text/plain');
            if (callback) {
              xhr.onreadystatechange = function() {
                if (xhr.readyState != 4)
                  return;
                if (xhr.status == 200 || (xhr.status == 0 && typeof xhr.responseText === 'string'))
                  callback(xhr.responseText);
                else
                  callback(null);
              };
              if (xhr.readyState == 4)
                return;
              xhr.send(null);
            } else {
              xhr.send(null);
              if (xhr.status == 200 || (xhr.status == 0 && typeof xhr.responseText === 'string'))
                return xhr.responseText;
              return null;
            }
          }
        };
        Util.toCamelCase = function(str) {
          return str.replace(/_([a-zA-Z])/g, function($0, $1) {
            return $1.toUpperCase();
          });
        };
        return Util;
      })();
      ProtoBuf.Lang = {
        OPEN: "{",
        CLOSE: "}",
        OPTOPEN: "[",
        OPTCLOSE: "]",
        OPTEND: ",",
        EQUAL: "=",
        END: ";",
        COMMA: ",",
        STRINGOPEN: '"',
        STRINGCLOSE: '"',
        STRINGOPEN_SQ: "'",
        STRINGCLOSE_SQ: "'",
        COPTOPEN: '(',
        COPTCLOSE: ')',
        LT: '<',
        GT: '>',
        DELIM: /[\s\{\}=;\[\],'"\(\)<>]/g,
        RULE: /^(?:required|optional|repeated|map)$/,
        TYPE: /^(?:double|float|int32|uint32|sint32|int64|uint64|sint64|fixed32|sfixed32|fixed64|sfixed64|bool|string|bytes)$/,
        NAME: /^[a-zA-Z_][a-zA-Z_0-9]*$/,
        TYPEDEF: /^[a-zA-Z][a-zA-Z_0-9]*$/,
        TYPEREF: /^(?:\.?[a-zA-Z_][a-zA-Z_0-9]*)+$/,
        FQTYPEREF: /^(?:\.[a-zA-Z][a-zA-Z_0-9]*)+$/,
        NUMBER: /^-?(?:[1-9][0-9]*|0|0[xX][0-9a-fA-F]+|0[0-7]+|([0-9]*(\.[0-9]*)?([Ee][+-]?[0-9]+)?)|inf|nan)$/,
        NUMBER_DEC: /^(?:[1-9][0-9]*|0)$/,
        NUMBER_HEX: /^0[xX][0-9a-fA-F]+$/,
        NUMBER_OCT: /^0[0-7]+$/,
        NUMBER_FLT: /^([0-9]*(\.[0-9]*)?([Ee][+-]?[0-9]+)?|inf|nan)$/,
        ID: /^(?:[1-9][0-9]*|0|0[xX][0-9a-fA-F]+|0[0-7]+)$/,
        NEGID: /^\-?(?:[1-9][0-9]*|0|0[xX][0-9a-fA-F]+|0[0-7]+)$/,
        WHITESPACE: /\s/,
        STRING: /(?:"([^"\\]*(?:\\.[^"\\]*)*)")|(?:'([^'\\]*(?:\\.[^'\\]*)*)')/g,
        BOOL: /^(?:true|false)$/i
      };
      ProtoBuf.DotProto = (function(ProtoBuf, Lang) {
        "use strict";
        var DotProto = {};
        var Tokenizer = function(proto) {
          this.source = "" + proto;
          this.index = 0;
          this.line = 1;
          this.stack = [];
          this.readingString = false;
          this.stringEndsWith = Lang.STRINGCLOSE;
        };
        var TokenizerPrototype = Tokenizer.prototype;
        TokenizerPrototype._readString = function() {
          Lang.STRING.lastIndex = this.index - 1;
          var match;
          if ((match = Lang.STRING.exec(this.source)) !== null) {
            var s = typeof match[1] !== 'undefined' ? match[1] : match[2];
            this.index = Lang.STRING.lastIndex;
            this.stack.push(this.stringEndsWith);
            return s;
          }
          throw Error("Unterminated string at line " + this.line + ", index " + this.index);
        };
        TokenizerPrototype.next = function() {
          if (this.stack.length > 0)
            return this.stack.shift();
          if (this.index >= this.source.length)
            return null;
          if (this.readingString) {
            this.readingString = false;
            return this._readString();
          }
          var repeat,
              last;
          do {
            repeat = false;
            while (Lang.WHITESPACE.test(last = this.source.charAt(this.index))) {
              this.index++;
              if (last === "\n")
                this.line++;
              if (this.index === this.source.length)
                return null;
            }
            if (this.source.charAt(this.index) === '/') {
              if (this.source.charAt(++this.index) === '/') {
                while (this.source.charAt(this.index) !== "\n") {
                  this.index++;
                  if (this.index == this.source.length)
                    return null;
                }
                this.index++;
                this.line++;
                repeat = true;
              } else if (this.source.charAt(this.index) === '*') {
                last = '';
                while (last + (last = this.source.charAt(this.index)) !== '*/') {
                  this.index++;
                  if (last === "\n")
                    this.line++;
                  if (this.index === this.source.length)
                    return null;
                }
                this.index++;
                repeat = true;
              } else
                throw Error("Unterminated comment at line " + this.line + ": /" + this.source.charAt(this.index));
            }
          } while (repeat);
          if (this.index === this.source.length)
            return null;
          var end = this.index;
          Lang.DELIM.lastIndex = 0;
          var delim = Lang.DELIM.test(this.source.charAt(end));
          if (!delim) {
            ++end;
            while (end < this.source.length && !Lang.DELIM.test(this.source.charAt(end)))
              end++;
          } else
            ++end;
          var token = this.source.substring(this.index, this.index = end);
          if (token === Lang.STRINGOPEN)
            this.readingString = true, this.stringEndsWith = Lang.STRINGCLOSE;
          else if (token === Lang.STRINGOPEN_SQ)
            this.readingString = true, this.stringEndsWith = Lang.STRINGCLOSE_SQ;
          return token;
        };
        TokenizerPrototype.peek = function() {
          if (this.stack.length === 0) {
            var token = this.next();
            if (token === null)
              return null;
            this.stack.push(token);
          }
          return this.stack[0];
        };
        TokenizerPrototype.toString = function() {
          return "Tokenizer(" + this.index + "/" + this.source.length + " at line " + this.line + ")";
        };
        DotProto.Tokenizer = Tokenizer;
        var Parser = function(proto) {
          this.tn = new Tokenizer(proto);
        };
        var ParserPrototype = Parser.prototype;
        ParserPrototype.parse = function() {
          var topLevel = {
            "name": "[ROOT]",
            "package": null,
            "messages": [],
            "enums": [],
            "imports": [],
            "options": {},
            "services": []
          };
          var token,
              head = true;
          while (token = this.tn.next()) {
            switch (token) {
              case 'package':
                if (!head || topLevel["package"] !== null)
                  throw Error("Unexpected package at line " + this.tn.line);
                topLevel["package"] = this._parsePackage(token);
                break;
              case 'import':
                if (!head)
                  throw Error("Unexpected import at line " + this.tn.line);
                topLevel.imports.push(this._parseImport(token));
                break;
              case 'message':
                this._parseMessage(topLevel, null, token);
                head = false;
                break;
              case 'enum':
                this._parseEnum(topLevel, token);
                head = false;
                break;
              case 'option':
                this._parseOption(topLevel, token);
                break;
              case 'service':
                this._parseService(topLevel, token);
                break;
              case 'extend':
                this._parseExtend(topLevel, token);
                break;
              case 'syntax':
                topLevel["syntax"] = this._parseSyntax(topLevel);
                break;
              default:
                throw Error("Unexpected token at line " + this.tn.line + ": " + token);
            }
          }
          delete topLevel["name"];
          return topLevel;
        };
        ParserPrototype._parseNumber = function(val) {
          var sign = 1;
          if (val.charAt(0) == '-')
            sign = -1, val = val.substring(1);
          if (Lang.NUMBER_DEC.test(val))
            return sign * parseInt(val, 10);
          else if (Lang.NUMBER_HEX.test(val))
            return sign * parseInt(val.substring(2), 16);
          else if (Lang.NUMBER_OCT.test(val))
            return sign * parseInt(val.substring(1), 8);
          else if (Lang.NUMBER_FLT.test(val)) {
            if (val === 'inf')
              return sign * Infinity;
            else if (val === 'nan')
              return NaN;
            else
              return sign * parseFloat(val);
          }
          throw Error("Illegal number at line " + this.tn.line + ": " + (sign < 0 ? '-' : '') + val);
        };
        ParserPrototype._parseString = function() {
          var value = "",
              token,
              delim;
          do {
            delim = this.tn.next();
            value += this.tn.next();
            token = this.tn.next();
            if (token !== delim)
              throw Error("Illegal end of string at line " + this.tn.line + ": " + token);
            token = this.tn.peek();
          } while (token === Lang.STRINGOPEN || token === Lang.STRINGOPEN_SQ);
          return value;
        };
        ParserPrototype._parseId = function(val, neg) {
          var id = -1;
          var sign = 1;
          if (val.charAt(0) == '-')
            sign = -1, val = val.substring(1);
          if (Lang.NUMBER_DEC.test(val))
            id = parseInt(val);
          else if (Lang.NUMBER_HEX.test(val))
            id = parseInt(val.substring(2), 16);
          else if (Lang.NUMBER_OCT.test(val))
            id = parseInt(val.substring(1), 8);
          else
            throw Error("Illegal id at line " + this.tn.line + ": " + (sign < 0 ? '-' : '') + val);
          id = (sign * id) | 0;
          if (!neg && id < 0)
            throw Error("Illegal id at line " + this.tn.line + ": " + (sign < 0 ? '-' : '') + val);
          return id;
        };
        ParserPrototype._parsePackage = function(token) {
          token = this.tn.next();
          if (!Lang.TYPEREF.test(token))
            throw Error("Illegal package name at line " + this.tn.line + ": " + token);
          var pkg = token;
          token = this.tn.next();
          if (token != Lang.END)
            throw Error("Illegal end of package at line " + this.tn.line + ": " + token);
          return pkg;
        };
        ParserPrototype._parseImport = function(token) {
          token = this.tn.peek();
          if (token === "public")
            this.tn.next(), token = this.tn.peek();
          if (token !== Lang.STRINGOPEN && token !== Lang.STRINGOPEN_SQ)
            throw Error("Illegal start of import at line " + this.tn.line + ": " + token);
          var imported = this._parseString();
          token = this.tn.next();
          if (token !== Lang.END)
            throw Error("Illegal end of import at line " + this.tn.line + ": " + token);
          return imported;
        };
        ParserPrototype._parseOption = function(parent, token) {
          token = this.tn.next();
          var custom = false;
          if (token == Lang.COPTOPEN)
            custom = true, token = this.tn.next();
          if (!Lang.TYPEREF.test(token))
            if (!/google\.protobuf\./.test(token))
              throw Error("Illegal option name in message " + parent.name + " at line " + this.tn.line + ": " + token);
          var name = token;
          token = this.tn.next();
          if (custom) {
            if (token !== Lang.COPTCLOSE)
              throw Error("Illegal end in message " + parent.name + ", option " + name + " at line " + this.tn.line + ": " + token);
            name = '(' + name + ')';
            token = this.tn.next();
            if (Lang.FQTYPEREF.test(token))
              name += token, token = this.tn.next();
          }
          if (token !== Lang.EQUAL)
            throw Error("Illegal operator in message " + parent.name + ", option " + name + " at line " + this.tn.line + ": " + token);
          var value;
          token = this.tn.peek();
          if (token === Lang.STRINGOPEN || token === Lang.STRINGOPEN_SQ)
            value = this._parseString();
          else {
            this.tn.next();
            if (Lang.NUMBER.test(token))
              value = this._parseNumber(token, true);
            else if (Lang.BOOL.test(token))
              value = token === 'true';
            else if (Lang.TYPEREF.test(token))
              value = token;
            else
              throw Error("Illegal option value in message " + parent.name + ", option " + name + " at line " + this.tn.line + ": " + token);
          }
          token = this.tn.next();
          if (token !== Lang.END)
            throw Error("Illegal end of option in message " + parent.name + ", option " + name + " at line " + this.tn.line + ": " + token);
          parent["options"][name] = value;
        };
        ParserPrototype._parseIgnoredStatement = function(parent, keyword) {
          var token;
          do {
            token = this.tn.next();
            if (token === null)
              throw Error("Unexpected EOF in " + parent.name + ", " + keyword + " at line " + this.tn.line);
            if (token === Lang.END)
              break;
          } while (true);
        };
        ParserPrototype._parseService = function(parent, token) {
          token = this.tn.next();
          if (!Lang.NAME.test(token))
            throw Error("Illegal service name at line " + this.tn.line + ": " + token);
          var name = token;
          var svc = {
            "name": name,
            "rpc": {},
            "options": {}
          };
          token = this.tn.next();
          if (token !== Lang.OPEN)
            throw Error("Illegal start of service " + name + " at line " + this.tn.line + ": " + token);
          do {
            token = this.tn.next();
            if (token === "option")
              this._parseOption(svc, token);
            else if (token === 'rpc')
              this._parseServiceRPC(svc, token);
            else if (token !== Lang.CLOSE)
              throw Error("Illegal type of service " + name + " at line " + this.tn.line + ": " + token);
          } while (token !== Lang.CLOSE);
          parent["services"].push(svc);
        };
        ParserPrototype._parseServiceRPC = function(svc, token) {
          var type = token;
          token = this.tn.next();
          if (!Lang.NAME.test(token))
            throw Error("Illegal method name in service " + svc["name"] + " at line " + this.tn.line + ": " + token);
          var name = token;
          var method = {
            "request": null,
            "response": null,
            "request_stream": false,
            "response_stream": false,
            "options": {}
          };
          token = this.tn.next();
          if (token !== Lang.COPTOPEN)
            throw Error("Illegal start of request type in service " + svc["name"] + "#" + name + " at line " + this.tn.line + ": " + token);
          token = this.tn.next();
          if (token.toLowerCase() === "stream") {
            method["request_stream"] = true;
            token = this.tn.next();
          }
          if (!Lang.TYPEREF.test(token))
            throw Error("Illegal request type in service " + svc["name"] + "#" + name + " at line " + this.tn.line + ": " + token);
          method["request"] = token;
          token = this.tn.next();
          if (token != Lang.COPTCLOSE)
            throw Error("Illegal end of request type in service " + svc["name"] + "#" + name + " at line " + this.tn.line + ": " + token);
          token = this.tn.next();
          if (token.toLowerCase() !== "returns")
            throw Error("Illegal delimiter in service " + svc["name"] + "#" + name + " at line " + this.tn.line + ": " + token);
          token = this.tn.next();
          if (token != Lang.COPTOPEN)
            throw Error("Illegal start of response type in service " + svc["name"] + "#" + name + " at line " + this.tn.line + ": " + token);
          token = this.tn.next();
          if (token.toLowerCase() === "stream") {
            method["response_stream"] = true;
            token = this.tn.next();
          }
          method["response"] = token;
          token = this.tn.next();
          if (token !== Lang.COPTCLOSE)
            throw Error("Illegal end of response type in service " + svc["name"] + "#" + name + " at line " + this.tn.line + ": " + token);
          token = this.tn.next();
          if (token === Lang.OPEN) {
            do {
              token = this.tn.next();
              if (token === 'option')
                this._parseOption(method, token);
              else if (token !== Lang.CLOSE)
                throw Error("Illegal start of option inservice " + svc["name"] + "#" + name + " at line " + this.tn.line + ": " + token);
            } while (token !== Lang.CLOSE);
            if (this.tn.peek() === Lang.END)
              this.tn.next();
          } else if (token !== Lang.END)
            throw Error("Illegal delimiter in service " + svc["name"] + "#" + name + " at line " + this.tn.line + ": " + token);
          if (typeof svc[type] === 'undefined')
            svc[type] = {};
          svc[type][name] = method;
        };
        ParserPrototype._parseMessage = function(parent, fld, token) {
          var msg = {};
          var isGroup = token === "group";
          token = this.tn.next();
          if (!Lang.NAME.test(token))
            throw Error("Illegal " + (isGroup ? "group" : "message") + " name" + (parent ? " in message " + parent["name"] : "") + " at line " + this.tn.line + ": " + token);
          msg["name"] = token;
          if (isGroup) {
            token = this.tn.next();
            if (token !== Lang.EQUAL)
              throw Error("Illegal id assignment after group " + msg.name + " at line " + this.tn.line + ": " + token);
            token = this.tn.next();
            try {
              fld["id"] = this._parseId(token);
            } catch (e) {
              throw Error("Illegal field id value for group " + msg.name + "#" + fld.name + " at line " + this.tn.line + ": " + token);
            }
            msg["isGroup"] = true;
          }
          msg["fields"] = [];
          msg["enums"] = [];
          msg["messages"] = [];
          msg["options"] = {};
          msg["oneofs"] = {};
          token = this.tn.next();
          if (token === Lang.OPTOPEN && fld)
            this._parseFieldOptions(msg, fld, token), token = this.tn.next();
          if (token !== Lang.OPEN)
            throw Error("Illegal start of " + (isGroup ? "group" : "message") + " " + msg.name + " at line " + this.tn.line + ": " + token);
          do {
            token = this.tn.next();
            if (token === Lang.CLOSE) {
              token = this.tn.peek();
              if (token === Lang.END)
                this.tn.next();
              break;
            } else if (Lang.RULE.test(token))
              this._parseMessageField(msg, token);
            else if (token === "oneof")
              this._parseMessageOneOf(msg, token);
            else if (token === "enum")
              this._parseEnum(msg, token);
            else if (token === "message")
              this._parseMessage(msg, null, token);
            else if (token === "option")
              this._parseOption(msg, token);
            else if (token === "extensions")
              msg["extensions"] = this._parseExtensions(msg, token);
            else if (token === "extend")
              this._parseExtend(msg, token);
            else if (Lang.TYPEREF.test(token))
              this._parseMessageField(msg, "optional", token);
            else
              throw Error("Illegal token in message " + msg.name + " at line " + this.tn.line + ": " + token);
          } while (true);
          parent["messages"].push(msg);
          return msg;
        };
        ParserPrototype._parseMessageField = function(msg, token, nextToken) {
          var fld = {},
              grp = null;
          fld["rule"] = token;
          fld["options"] = {};
          token = typeof nextToken !== 'undefined' ? nextToken : this.tn.next();
          if (fld["rule"] === "map") {
            if (token !== Lang.LT)
              throw Error("Illegal token in message " + msg.name + " at line " + this.tn.line + ": " + token);
            token = this.tn.next();
            if (!Lang.TYPE.test(token) && !Lang.TYPEREF.test(token))
              throw Error("Illegal token in message " + msg.name + " at line " + this.tn.line + ": " + token);
            fld["keytype"] = token;
            token = this.tn.next();
            if (token !== Lang.COMMA)
              throw Error("Illegal token in message " + msg.name + " at line " + this.tn.line + ": " + token);
            token = this.tn.next();
            if (!Lang.TYPE.test(token) && !Lang.TYPEREF.test(token))
              throw Error("Illegal token in message " + msg.name + " at line " + this.tn.line + ": " + token);
            fld["type"] = token;
            token = this.tn.next();
            if (token !== Lang.GT)
              throw Error("Illegal token in message " + msg.name + " at line " + this.tn.line + ": " + token);
            token = this.tn.next();
            if (!Lang.NAME.test(token))
              throw Error("Illegal token in message " + msg.name + " at line " + this.tn.line + ": " + token);
            fld["name"] = token;
            token = this.tn.next();
            if (token !== Lang.EQUAL)
              throw Error("Illegal token in field " + msg.name + "#" + fld.name + " at line " + this.line + ": " + token);
            token = this.tn.next();
            try {
              fld["id"] = this._parseId(token);
            } catch (e) {
              throw Error("Illegal field id in message " + msg.name + "#" + fld.name + " at line " + this.tn.line + ": " + token);
            }
            token = this.tn.next();
            if (token === Lang.OPTOPEN) {
              this._parseFieldOptions(msg, fld, token);
              token = this.tn.next();
            }
            if (token !== Lang.END)
              throw Error("Illegal delimiter in message " + msg.name + "#" + fld.name + " at line " + this.tn.line + ": " + token);
          } else if (token === "group") {
            grp = this._parseMessage(msg, fld, token);
            if (!/^[A-Z]/.test(grp["name"]))
              throw Error('Group names must start with a capital letter');
            fld["type"] = grp["name"];
            fld["name"] = grp["name"].toLowerCase();
            token = this.tn.peek();
            if (token === Lang.END)
              this.tn.next();
          } else {
            if (!Lang.TYPE.test(token) && !Lang.TYPEREF.test(token))
              throw Error("Illegal field type in message " + msg.name + " at line " + this.tn.line + ": " + token);
            fld["type"] = token;
            token = this.tn.next();
            if (!Lang.NAME.test(token))
              throw Error("Illegal field name in message " + msg.name + " at line " + this.tn.line + ": " + token);
            fld["name"] = token;
            token = this.tn.next();
            if (token !== Lang.EQUAL)
              throw Error("Illegal token in field " + msg.name + "#" + fld.name + " at line " + this.tn.line + ": " + token);
            token = this.tn.next();
            try {
              fld["id"] = this._parseId(token);
            } catch (e) {
              throw Error("Illegal field id in message " + msg.name + "#" + fld.name + " at line " + this.tn.line + ": " + token);
            }
            token = this.tn.next();
            if (token === Lang.OPTOPEN)
              this._parseFieldOptions(msg, fld, token), token = this.tn.next();
            if (token !== Lang.END)
              throw Error("Illegal delimiter in message " + msg.name + "#" + fld.name + " at line " + this.tn.line + ": " + token);
          }
          msg["fields"].push(fld);
          return fld;
        };
        ParserPrototype._parseMessageOneOf = function(msg, token) {
          token = this.tn.next();
          if (!Lang.NAME.test(token))
            throw Error("Illegal oneof name in message " + msg.name + " at line " + this.tn.line + ": " + token);
          var name = token,
              fld;
          var fields = [];
          token = this.tn.next();
          if (token !== Lang.OPEN)
            throw Error("Illegal start of oneof " + name + " at line " + this.tn.line + ": " + token);
          while (this.tn.peek() !== Lang.CLOSE) {
            fld = this._parseMessageField(msg, "optional");
            fld["oneof"] = name;
            fields.push(fld["id"]);
          }
          this.tn.next();
          msg["oneofs"][name] = fields;
        };
        ParserPrototype._parseFieldOptions = function(msg, fld, token) {
          var first = true;
          do {
            token = this.tn.next();
            if (token === Lang.OPTCLOSE)
              break;
            else if (token === Lang.OPTEND) {
              if (first)
                throw Error("Illegal start of options in message " + msg.name + "#" + fld.name + " at line " + this.tn.line + ": " + token);
              token = this.tn.next();
            }
            this._parseFieldOption(msg, fld, token);
            first = false;
          } while (true);
        };
        ParserPrototype._parseFieldOption = function(msg, fld, token) {
          var custom = false;
          if (token === Lang.COPTOPEN)
            token = this.tn.next(), custom = true;
          if (!Lang.TYPEREF.test(token))
            throw Error("Illegal field option in " + msg.name + "#" + fld.name + " at line " + this.tn.line + ": " + token);
          var name = token;
          token = this.tn.next();
          if (custom) {
            if (token !== Lang.COPTCLOSE)
              throw Error("Illegal delimiter in " + msg.name + "#" + fld.name + " at line " + this.tn.line + ": " + token);
            name = '(' + name + ')';
            token = this.tn.next();
            if (Lang.FQTYPEREF.test(token))
              name += token, token = this.tn.next();
          }
          if (token !== Lang.EQUAL)
            throw Error("Illegal token in " + msg.name + "#" + fld.name + " at line " + this.tn.line + ": " + token);
          var value;
          token = this.tn.peek();
          if (token === Lang.STRINGOPEN || token === Lang.STRINGOPEN_SQ) {
            value = this._parseString();
          } else if (Lang.NUMBER.test(token, true))
            value = this._parseNumber(this.tn.next(), true);
          else if (Lang.BOOL.test(token))
            value = this.tn.next().toLowerCase() === 'true';
          else if (Lang.TYPEREF.test(token))
            value = this.tn.next();
          else
            throw Error("Illegal value in message " + msg.name + "#" + fld.name + ", option " + name + " at line " + this.tn.line + ": " + token);
          fld["options"][name] = value;
        };
        ParserPrototype._parseEnum = function(msg, token) {
          var enm = {};
          token = this.tn.next();
          if (!Lang.NAME.test(token))
            throw Error("Illegal enum name in message " + msg.name + " at line " + this.tn.line + ": " + token);
          enm["name"] = token;
          token = this.tn.next();
          if (token !== Lang.OPEN)
            throw Error("Illegal start of enum " + enm.name + " at line " + this.tn.line + ": " + token);
          enm["values"] = [];
          enm["options"] = {};
          do {
            token = this.tn.next();
            if (token === Lang.CLOSE) {
              token = this.tn.peek();
              if (token === Lang.END)
                this.tn.next();
              break;
            }
            if (token == 'option')
              this._parseOption(enm, token);
            else {
              if (!Lang.NAME.test(token))
                throw Error("Illegal name in enum " + enm.name + " at line " + this.tn.line + ": " + token);
              this._parseEnumValue(enm, token);
            }
          } while (true);
          msg["enums"].push(enm);
        };
        ParserPrototype._parseEnumValue = function(enm, token) {
          var val = {};
          val["name"] = token;
          token = this.tn.next();
          if (token !== Lang.EQUAL)
            throw Error("Illegal token in enum " + enm.name + " at line " + this.tn.line + ": " + token);
          token = this.tn.next();
          try {
            val["id"] = this._parseId(token, true);
          } catch (e) {
            throw Error("Illegal id in enum " + enm.name + " at line " + this.tn.line + ": " + token);
          }
          enm["values"].push(val);
          token = this.tn.next();
          if (token === Lang.OPTOPEN) {
            var opt = {'options': {}};
            this._parseFieldOptions(enm, opt, token);
            token = this.tn.next();
          }
          if (token !== Lang.END)
            throw Error("Illegal delimiter in enum " + enm.name + " at line " + this.tn.line + ": " + token);
        };
        ParserPrototype._parseExtensions = function(msg, token) {
          var range = [];
          token = this.tn.next();
          if (token === "min")
            range.push(ProtoBuf.ID_MIN);
          else if (token === "max")
            range.push(ProtoBuf.ID_MAX);
          else
            range.push(this._parseNumber(token));
          token = this.tn.next();
          if (token !== 'to')
            throw Error("Illegal extensions delimiter in message " + msg.name + " at line " + this.tn.line + ": " + token);
          token = this.tn.next();
          if (token === "min")
            range.push(ProtoBuf.ID_MIN);
          else if (token === "max")
            range.push(ProtoBuf.ID_MAX);
          else
            range.push(this._parseNumber(token));
          token = this.tn.next();
          if (token !== Lang.END)
            throw Error("Illegal extensions delimiter in message " + msg.name + " at line " + this.tn.line + ": " + token);
          return range;
        };
        ParserPrototype._parseExtend = function(parent, token) {
          token = this.tn.next();
          if (!Lang.TYPEREF.test(token))
            throw Error("Illegal message name at line " + this.tn.line + ": " + token);
          var ext = {};
          ext["ref"] = token;
          ext["fields"] = [];
          token = this.tn.next();
          if (token !== Lang.OPEN)
            throw Error("Illegal start of extend " + ext.name + " at line " + this.tn.line + ": " + token);
          do {
            token = this.tn.next();
            if (token === Lang.CLOSE) {
              token = this.tn.peek();
              if (token == Lang.END)
                this.tn.next();
              break;
            } else if (Lang.RULE.test(token))
              this._parseMessageField(ext, token);
            else if (Lang.TYPEREF.test(token))
              this._parseMessageField(ext, "optional", token);
            else
              throw Error("Illegal token in extend " + ext.name + " at line " + this.tn.line + ": " + token);
          } while (true);
          parent["messages"].push(ext);
          return ext;
        };
        ParserPrototype._parseSyntax = function(parent) {
          var token = this.tn.next();
          if (token !== Lang.EQUAL)
            throw Error("Illegal token at line " + this.tn.line + ": " + token);
          token = this.tn.peek();
          if (token !== Lang.STRINGOPEN && token !== Lang.STRINGOPEN_SQ)
            throw Error("Illegal token at line " + this.tn.line + ": " + token);
          var syntax_str = this._parseString();
          token = this.tn.next();
          if (token !== Lang.END)
            throw Error("Illegal token at line " + this.tn.line + ": " + token);
          return syntax_str;
        };
        ParserPrototype.toString = function() {
          return "Parser";
        };
        DotProto.Parser = Parser;
        return DotProto;
      })(ProtoBuf, ProtoBuf.Lang);
      ProtoBuf.Reflect = (function(ProtoBuf) {
        "use strict";
        var Reflect = {};
        var T = function(builder, parent, name) {
          this.builder = builder;
          this.parent = parent;
          this.name = name;
          this.className;
        };
        var TPrototype = T.prototype;
        TPrototype.fqn = function() {
          var name = this.name,
              ptr = this;
          do {
            ptr = ptr.parent;
            if (ptr == null)
              break;
            name = ptr.name + "." + name;
          } while (true);
          return name;
        };
        TPrototype.toString = function(includeClass) {
          return (includeClass ? this.className + " " : "") + this.fqn();
        };
        TPrototype.build = function() {
          throw Error(this.toString(true) + " cannot be built directly");
        };
        Reflect.T = T;
        var Namespace = function(builder, parent, name, options, syntax) {
          T.call(this, builder, parent, name);
          this.className = "Namespace";
          this.children = [];
          this.options = options || {};
          this.syntax = syntax || "proto2";
        };
        var NamespacePrototype = Namespace.prototype = Object.create(T.prototype);
        NamespacePrototype.getChildren = function(type) {
          type = type || null;
          if (type == null)
            return this.children.slice();
          var children = [];
          for (var i = 0,
              k = this.children.length; i < k; ++i)
            if (this.children[i] instanceof type)
              children.push(this.children[i]);
          return children;
        };
        NamespacePrototype.addChild = function(child) {
          var other;
          if (other = this.getChild(child.name)) {
            if (other instanceof Message.Field && other.name !== other.originalName && this.getChild(other.originalName) === null)
              other.name = other.originalName;
            else if (child instanceof Message.Field && child.name !== child.originalName && this.getChild(child.originalName) === null)
              child.name = child.originalName;
            else
              throw Error("Duplicate name in namespace " + this.toString(true) + ": " + child.name);
          }
          this.children.push(child);
        };
        NamespacePrototype.getChild = function(nameOrId) {
          var key = typeof nameOrId === 'number' ? 'id' : 'name';
          for (var i = 0,
              k = this.children.length; i < k; ++i)
            if (this.children[i][key] === nameOrId)
              return this.children[i];
          return null;
        };
        NamespacePrototype.resolve = function(qn, excludeNonNamespace) {
          var part = typeof qn === 'string' ? qn.split(".") : qn,
              ptr = this,
              i = 0;
          if (part[i] === "") {
            while (ptr.parent !== null)
              ptr = ptr.parent;
            i++;
          }
          var child;
          do {
            do {
              if (!(ptr instanceof Reflect.Namespace)) {
                ptr = null;
                break;
              }
              child = ptr.getChild(part[i]);
              if (!child || !(child instanceof Reflect.T) || (excludeNonNamespace && !(child instanceof Reflect.Namespace))) {
                ptr = null;
                break;
              }
              ptr = child;
              i++;
            } while (i < part.length);
            if (ptr != null)
              break;
            if (this.parent !== null)
              return this.parent.resolve(qn, excludeNonNamespace);
          } while (ptr != null);
          return ptr;
        };
        NamespacePrototype.qn = function(t) {
          var part = [],
              ptr = t;
          do {
            part.unshift(ptr.name);
            ptr = ptr.parent;
          } while (ptr !== null);
          for (var len = 1; len <= part.length; len++) {
            var qn = part.slice(part.length - len);
            if (t === this.resolve(qn, t instanceof Reflect.Namespace))
              return qn.join(".");
          }
          return t.fqn();
        };
        NamespacePrototype.build = function() {
          var ns = {};
          var children = this.children;
          for (var i = 0,
              k = children.length,
              child; i < k; ++i) {
            child = children[i];
            if (child instanceof Namespace)
              ns[child.name] = child.build();
          }
          if (Object.defineProperty)
            Object.defineProperty(ns, "$options", {"value": this.buildOpt()});
          return ns;
        };
        NamespacePrototype.buildOpt = function() {
          var opt = {},
              keys = Object.keys(this.options);
          for (var i = 0,
              k = keys.length; i < k; ++i) {
            var key = keys[i],
                val = this.options[keys[i]];
            opt[key] = val;
          }
          return opt;
        };
        NamespacePrototype.getOption = function(name) {
          if (typeof name === 'undefined')
            return this.options;
          return typeof this.options[name] !== 'undefined' ? this.options[name] : null;
        };
        Reflect.Namespace = Namespace;
        var Element = function(type, resolvedType, isMapKey, syntax) {
          this.type = type;
          this.resolvedType = resolvedType;
          this.isMapKey = isMapKey;
          this.syntax = syntax;
          if (isMapKey && ProtoBuf.MAP_KEY_TYPES.indexOf(type) < 0)
            throw Error("Invalid map key type: " + type.name);
        };
        var ElementPrototype = Element.prototype;
        function mkDefault(type) {
          if (typeof type === 'string')
            type = ProtoBuf.TYPES[type];
          if (typeof type.defaultValue === 'undefined')
            throw Error("default value for type " + type.name + " is not supported");
          if (type == ProtoBuf.TYPES["bytes"])
            return new ByteBuffer(0);
          return type.defaultValue;
        }
        ElementPrototype.defaultFieldValue = mkDefault;
        function mkLong(value, unsigned) {
          if (value && typeof value.low === 'number' && typeof value.high === 'number' && typeof value.unsigned === 'boolean' && value.low === value.low && value.high === value.high)
            return new ProtoBuf.Long(value.low, value.high, typeof unsigned === 'undefined' ? value.unsigned : unsigned);
          if (typeof value === 'string')
            return ProtoBuf.Long.fromString(value, unsigned || false, 10);
          if (typeof value === 'number')
            return ProtoBuf.Long.fromNumber(value, unsigned || false);
          throw Error("not convertible to Long");
        }
        ElementPrototype.verifyValue = function(value) {
          var fail = function(val, msg) {
            throw Error("Illegal value for " + this.toString(true) + " of type " + this.type.name + ": " + val + " (" + msg + ")");
          }.bind(this);
          switch (this.type) {
            case ProtoBuf.TYPES["int32"]:
            case ProtoBuf.TYPES["sint32"]:
            case ProtoBuf.TYPES["sfixed32"]:
              if (typeof value !== 'number' || (value === value && value % 1 !== 0))
                fail(typeof value, "not an integer");
              return value > 4294967295 ? value | 0 : value;
            case ProtoBuf.TYPES["uint32"]:
            case ProtoBuf.TYPES["fixed32"]:
              if (typeof value !== 'number' || (value === value && value % 1 !== 0))
                fail(typeof value, "not an integer");
              return value < 0 ? value >>> 0 : value;
            case ProtoBuf.TYPES["int64"]:
            case ProtoBuf.TYPES["sint64"]:
            case ProtoBuf.TYPES["sfixed64"]:
              {
                if (ProtoBuf.Long)
                  try {
                    return mkLong(value, false);
                  } catch (e) {
                    fail(typeof value, e.message);
                  }
                else
                  fail(typeof value, "requires Long.js");
              }
            case ProtoBuf.TYPES["uint64"]:
            case ProtoBuf.TYPES["fixed64"]:
              {
                if (ProtoBuf.Long)
                  try {
                    return mkLong(value, true);
                  } catch (e) {
                    fail(typeof value, e.message);
                  }
                else
                  fail(typeof value, "requires Long.js");
              }
            case ProtoBuf.TYPES["bool"]:
              if (typeof value !== 'boolean')
                fail(typeof value, "not a boolean");
              return value;
            case ProtoBuf.TYPES["float"]:
            case ProtoBuf.TYPES["double"]:
              if (typeof value !== 'number')
                fail(typeof value, "not a number");
              return value;
            case ProtoBuf.TYPES["string"]:
              if (typeof value !== 'string' && !(value && value instanceof String))
                fail(typeof value, "not a string");
              return "" + value;
            case ProtoBuf.TYPES["bytes"]:
              if (ByteBuffer.isByteBuffer(value))
                return value;
              return ByteBuffer.wrap(value, "base64");
            case ProtoBuf.TYPES["enum"]:
              {
                var values = this.resolvedType.getChildren(ProtoBuf.Reflect.Enum.Value);
                for (i = 0; i < values.length; i++)
                  if (values[i].name == value)
                    return values[i].id;
                  else if (values[i].id == value)
                    return values[i].id;
                if (this.syntax === 'proto3') {
                  if (typeof value !== 'number' || (value === value && value % 1 !== 0))
                    fail(typeof value, "not an integer");
                  if (value > 4294967295 || value < 0)
                    fail(typeof value, "not in range for uint32");
                  return value;
                } else {
                  fail(value, "not a valid enum value");
                }
              }
            case ProtoBuf.TYPES["group"]:
            case ProtoBuf.TYPES["message"]:
              {
                if (!value || typeof value !== 'object')
                  fail(typeof value, "object expected");
                if (value instanceof this.resolvedType.clazz)
                  return value;
                if (value instanceof ProtoBuf.Builder.Message) {
                  var obj = {};
                  for (var i in value)
                    if (value.hasOwnProperty(i))
                      obj[i] = value[i];
                  value = obj;
                }
                return new (this.resolvedType.clazz)(value);
              }
          }
          throw Error("[INTERNAL] Illegal value for " + this.toString(true) + ": " + value + " (undefined type " + this.type + ")");
        };
        ElementPrototype.calculateLength = function(id, value) {
          if (value === null)
            return 0;
          var n;
          switch (this.type) {
            case ProtoBuf.TYPES["int32"]:
              return value < 0 ? ByteBuffer.calculateVarint64(value) : ByteBuffer.calculateVarint32(value);
            case ProtoBuf.TYPES["uint32"]:
              return ByteBuffer.calculateVarint32(value);
            case ProtoBuf.TYPES["sint32"]:
              return ByteBuffer.calculateVarint32(ByteBuffer.zigZagEncode32(value));
            case ProtoBuf.TYPES["fixed32"]:
            case ProtoBuf.TYPES["sfixed32"]:
            case ProtoBuf.TYPES["float"]:
              return 4;
            case ProtoBuf.TYPES["int64"]:
            case ProtoBuf.TYPES["uint64"]:
              return ByteBuffer.calculateVarint64(value);
            case ProtoBuf.TYPES["sint64"]:
              return ByteBuffer.calculateVarint64(ByteBuffer.zigZagEncode64(value));
            case ProtoBuf.TYPES["fixed64"]:
            case ProtoBuf.TYPES["sfixed64"]:
              return 8;
            case ProtoBuf.TYPES["bool"]:
              return 1;
            case ProtoBuf.TYPES["enum"]:
              return ByteBuffer.calculateVarint32(value);
            case ProtoBuf.TYPES["double"]:
              return 8;
            case ProtoBuf.TYPES["string"]:
              n = ByteBuffer.calculateUTF8Bytes(value);
              return ByteBuffer.calculateVarint32(n) + n;
            case ProtoBuf.TYPES["bytes"]:
              if (value.remaining() < 0)
                throw Error("Illegal value for " + this.toString(true) + ": " + value.remaining() + " bytes remaining");
              return ByteBuffer.calculateVarint32(value.remaining()) + value.remaining();
            case ProtoBuf.TYPES["message"]:
              n = this.resolvedType.calculate(value);
              return ByteBuffer.calculateVarint32(n) + n;
            case ProtoBuf.TYPES["group"]:
              n = this.resolvedType.calculate(value);
              return n + ByteBuffer.calculateVarint32((id << 3) | ProtoBuf.WIRE_TYPES.ENDGROUP);
          }
          throw Error("[INTERNAL] Illegal value to encode in " + this.toString(true) + ": " + value + " (unknown type)");
        };
        ElementPrototype.encodeValue = function(id, value, buffer) {
          if (value === null)
            return buffer;
          switch (this.type) {
            case ProtoBuf.TYPES["int32"]:
              if (value < 0)
                buffer.writeVarint64(value);
              else
                buffer.writeVarint32(value);
              break;
            case ProtoBuf.TYPES["uint32"]:
              buffer.writeVarint32(value);
              break;
            case ProtoBuf.TYPES["sint32"]:
              buffer.writeVarint32ZigZag(value);
              break;
            case ProtoBuf.TYPES["fixed32"]:
              buffer.writeUint32(value);
              break;
            case ProtoBuf.TYPES["sfixed32"]:
              buffer.writeInt32(value);
              break;
            case ProtoBuf.TYPES["int64"]:
            case ProtoBuf.TYPES["uint64"]:
              buffer.writeVarint64(value);
              break;
            case ProtoBuf.TYPES["sint64"]:
              buffer.writeVarint64ZigZag(value);
              break;
            case ProtoBuf.TYPES["fixed64"]:
              buffer.writeUint64(value);
              break;
            case ProtoBuf.TYPES["sfixed64"]:
              buffer.writeInt64(value);
              break;
            case ProtoBuf.TYPES["bool"]:
              if (typeof value === 'string')
                buffer.writeVarint32(value.toLowerCase() === 'false' ? 0 : !!value);
              else
                buffer.writeVarint32(value ? 1 : 0);
              break;
            case ProtoBuf.TYPES["enum"]:
              buffer.writeVarint32(value);
              break;
            case ProtoBuf.TYPES["float"]:
              buffer.writeFloat32(value);
              break;
            case ProtoBuf.TYPES["double"]:
              buffer.writeFloat64(value);
              break;
            case ProtoBuf.TYPES["string"]:
              buffer.writeVString(value);
              break;
            case ProtoBuf.TYPES["bytes"]:
              if (value.remaining() < 0)
                throw Error("Illegal value for " + this.toString(true) + ": " + value.remaining() + " bytes remaining");
              var prevOffset = value.offset;
              buffer.writeVarint32(value.remaining());
              buffer.append(value);
              value.offset = prevOffset;
              break;
            case ProtoBuf.TYPES["message"]:
              var bb = new ByteBuffer().LE();
              this.resolvedType.encode(value, bb);
              buffer.writeVarint32(bb.offset);
              buffer.append(bb.flip());
              break;
            case ProtoBuf.TYPES["group"]:
              this.resolvedType.encode(value, buffer);
              buffer.writeVarint32((id << 3) | ProtoBuf.WIRE_TYPES.ENDGROUP);
              break;
            default:
              throw Error("[INTERNAL] Illegal value to encode in " + this.toString(true) + ": " + value + " (unknown type)");
          }
          return buffer;
        };
        ElementPrototype.decode = function(buffer, wireType, id) {
          if (wireType != this.type.wireType)
            throw Error("Unexpected wire type for element");
          var value,
              nBytes;
          switch (this.type) {
            case ProtoBuf.TYPES["int32"]:
              return buffer.readVarint32() | 0;
            case ProtoBuf.TYPES["uint32"]:
              return buffer.readVarint32() >>> 0;
            case ProtoBuf.TYPES["sint32"]:
              return buffer.readVarint32ZigZag() | 0;
            case ProtoBuf.TYPES["fixed32"]:
              return buffer.readUint32() >>> 0;
            case ProtoBuf.TYPES["sfixed32"]:
              return buffer.readInt32() | 0;
            case ProtoBuf.TYPES["int64"]:
              return buffer.readVarint64();
            case ProtoBuf.TYPES["uint64"]:
              return buffer.readVarint64().toUnsigned();
            case ProtoBuf.TYPES["sint64"]:
              return buffer.readVarint64ZigZag();
            case ProtoBuf.TYPES["fixed64"]:
              return buffer.readUint64();
            case ProtoBuf.TYPES["sfixed64"]:
              return buffer.readInt64();
            case ProtoBuf.TYPES["bool"]:
              return !!buffer.readVarint32();
            case ProtoBuf.TYPES["enum"]:
              return buffer.readVarint32();
            case ProtoBuf.TYPES["float"]:
              return buffer.readFloat();
            case ProtoBuf.TYPES["double"]:
              return buffer.readDouble();
            case ProtoBuf.TYPES["string"]:
              return buffer.readVString();
            case ProtoBuf.TYPES["bytes"]:
              {
                nBytes = buffer.readVarint32();
                if (buffer.remaining() < nBytes)
                  throw Error("Illegal number of bytes for " + this.toString(true) + ": " + nBytes + " required but got only " + buffer.remaining());
                value = buffer.clone();
                value.limit = value.offset + nBytes;
                buffer.offset += nBytes;
                return value;
              }
            case ProtoBuf.TYPES["message"]:
              {
                nBytes = buffer.readVarint32();
                return this.resolvedType.decode(buffer, nBytes);
              }
            case ProtoBuf.TYPES["group"]:
              return this.resolvedType.decode(buffer, -1, id);
          }
          throw Error("[INTERNAL] Illegal decode type");
        };
        ElementPrototype.valueFromString = function(str) {
          if (!this.isMapKey) {
            throw Error("valueFromString() called on non-map-key element");
          }
          switch (this.type) {
            case ProtoBuf.TYPES["int32"]:
            case ProtoBuf.TYPES["sint32"]:
            case ProtoBuf.TYPES["sfixed32"]:
            case ProtoBuf.TYPES["uint32"]:
            case ProtoBuf.TYPES["fixed32"]:
              return this.verifyValue(parseInt(str));
            case ProtoBuf.TYPES["int64"]:
            case ProtoBuf.TYPES["sint64"]:
            case ProtoBuf.TYPES["sfixed64"]:
            case ProtoBuf.TYPES["uint64"]:
            case ProtoBuf.TYPES["fixed64"]:
              return this.verifyValue(str);
            case ProtoBuf.TYPES["bool"]:
              return str === "true";
            case ProtoBuf.TYPES["string"]:
              return this.verifyValue(str);
            case ProtoBuf.TYPES["bytes"]:
              return ByteBuffer.fromBinary(str);
          }
        };
        ElementPrototype.valueToString = function(value) {
          if (!this.isMapKey) {
            throw Error("valueToString() called on non-map-key element");
          }
          if (this.type === ProtoBuf.TYPES["bytes"]) {
            return value.toString("binary");
          } else {
            return value.toString();
          }
        };
        Reflect.Element = Element;
        var Message = function(builder, parent, name, options, isGroup, syntax) {
          Namespace.call(this, builder, parent, name, options, syntax);
          this.className = "Message";
          this.extensions = [ProtoBuf.ID_MIN, ProtoBuf.ID_MAX];
          this.clazz = null;
          this.isGroup = !!isGroup;
          this._fields = null;
          this._fieldsById = null;
          this._fieldsByName = null;
        };
        var MessagePrototype = Message.prototype = Object.create(Namespace.prototype);
        MessagePrototype.build = function(rebuild) {
          if (this.clazz && !rebuild)
            return this.clazz;
          var clazz = (function(ProtoBuf, T) {
            var fields = T.getChildren(ProtoBuf.Reflect.Message.Field),
                oneofs = T.getChildren(ProtoBuf.Reflect.Message.OneOf);
            var Message = function(values, var_args) {
              ProtoBuf.Builder.Message.call(this);
              for (var i = 0,
                  k = oneofs.length; i < k; ++i)
                this[oneofs[i].name] = null;
              for (i = 0, k = fields.length; i < k; ++i) {
                var field = fields[i];
                this[field.name] = field.repeated ? [] : (field.map ? new ProtoBuf.Map(field) : null);
                if ((field.required || T.syntax === 'proto3') && field.defaultValue !== null)
                  this[field.name] = field.defaultValue;
              }
              if (arguments.length > 0) {
                var value;
                if (arguments.length === 1 && values !== null && typeof values === 'object' && (typeof values.encode !== 'function' || values instanceof Message) && !Array.isArray(values) && !(values instanceof ProtoBuf.Map) && !ByteBuffer.isByteBuffer(values) && !(values instanceof ArrayBuffer) && !(ProtoBuf.Long && values instanceof ProtoBuf.Long)) {
                  this.$set(values);
                } else
                  for (i = 0, k = arguments.length; i < k; ++i)
                    if (typeof(value = arguments[i]) !== 'undefined')
                      this.$set(fields[i].name, value);
              }
            };
            var MessagePrototype = Message.prototype = Object.create(ProtoBuf.Builder.Message.prototype);
            MessagePrototype.add = function(key, value, noAssert) {
              var field = T._fieldsByName[key];
              if (!noAssert) {
                if (!field)
                  throw Error(this + "#" + key + " is undefined");
                if (!(field instanceof ProtoBuf.Reflect.Message.Field))
                  throw Error(this + "#" + key + " is not a field: " + field.toString(true));
                if (!field.repeated)
                  throw Error(this + "#" + key + " is not a repeated field");
                value = field.verifyValue(value, true);
              }
              if (this[key] === null)
                this[key] = [];
              this[key].push(value);
              return this;
            };
            MessagePrototype.$add = MessagePrototype.add;
            MessagePrototype.set = function(keyOrObj, value, noAssert) {
              if (keyOrObj && typeof keyOrObj === 'object') {
                noAssert = value;
                for (var ikey in keyOrObj)
                  if (keyOrObj.hasOwnProperty(ikey) && typeof(value = keyOrObj[ikey]) !== 'undefined')
                    this.$set(ikey, value, noAssert);
                return this;
              }
              var field = T._fieldsByName[keyOrObj];
              if (!noAssert) {
                if (!field)
                  throw Error(this + "#" + keyOrObj + " is not a field: undefined");
                if (!(field instanceof ProtoBuf.Reflect.Message.Field))
                  throw Error(this + "#" + keyOrObj + " is not a field: " + field.toString(true));
                this[field.name] = (value = field.verifyValue(value));
              } else
                this[keyOrObj] = value;
              if (field && field.oneof) {
                if (value !== null) {
                  if (this[field.oneof.name] !== null)
                    this[this[field.oneof.name]] = null;
                  this[field.oneof.name] = field.name;
                } else if (field.oneof.name === keyOrObj)
                  this[field.oneof.name] = null;
              }
              return this;
            };
            MessagePrototype.$set = MessagePrototype.set;
            MessagePrototype.get = function(key, noAssert) {
              if (noAssert)
                return this[key];
              var field = T._fieldsByName[key];
              if (!field || !(field instanceof ProtoBuf.Reflect.Message.Field))
                throw Error(this + "#" + key + " is not a field: undefined");
              if (!(field instanceof ProtoBuf.Reflect.Message.Field))
                throw Error(this + "#" + key + " is not a field: " + field.toString(true));
              return this[field.name];
            };
            MessagePrototype.$get = MessagePrototype.get;
            for (var i = 0; i < fields.length; i++) {
              var field = fields[i];
              if (field instanceof ProtoBuf.Reflect.Message.ExtensionField)
                continue;
              if (T.builder.options['populateAccessors'])
                (function(field) {
                  var Name = field.originalName.replace(/(_[a-zA-Z])/g, function(match) {
                    return match.toUpperCase().replace('_', '');
                  });
                  Name = Name.substring(0, 1).toUpperCase() + Name.substring(1);
                  var name = field.originalName.replace(/([A-Z])/g, function(match) {
                    return "_" + match;
                  });
                  var setter = function(value, noAssert) {
                    this[field.name] = noAssert ? value : field.verifyValue(value);
                    return this;
                  };
                  var getter = function() {
                    return this[field.name];
                  };
                  if (T.getChild("set" + Name) === null)
                    MessagePrototype["set" + Name] = setter;
                  if (T.getChild("set_" + name) === null)
                    MessagePrototype["set_" + name] = setter;
                  if (T.getChild("get" + Name) === null)
                    MessagePrototype["get" + Name] = getter;
                  if (T.getChild("get_" + name) === null)
                    MessagePrototype["get_" + name] = getter;
                })(field);
            }
            MessagePrototype.encode = function(buffer, noVerify) {
              if (typeof buffer === 'boolean')
                noVerify = buffer, buffer = undefined;
              var isNew = false;
              if (!buffer)
                buffer = new ByteBuffer(), isNew = true;
              var le = buffer.littleEndian;
              try {
                T.encode(this, buffer.LE(), noVerify);
                return (isNew ? buffer.flip() : buffer).LE(le);
              } catch (e) {
                buffer.LE(le);
                throw (e);
              }
            };
            Message.encode = function(data, buffer, noVerify) {
              return new Message(data).encode(buffer, noVerify);
            };
            MessagePrototype.calculate = function() {
              return T.calculate(this);
            };
            MessagePrototype.encodeDelimited = function(buffer) {
              var isNew = false;
              if (!buffer)
                buffer = new ByteBuffer(), isNew = true;
              var enc = new ByteBuffer().LE();
              T.encode(this, enc).flip();
              buffer.writeVarint32(enc.remaining());
              buffer.append(enc);
              return isNew ? buffer.flip() : buffer;
            };
            MessagePrototype.encodeAB = function() {
              try {
                return this.encode().toArrayBuffer();
              } catch (e) {
                if (e["encoded"])
                  e["encoded"] = e["encoded"].toArrayBuffer();
                throw (e);
              }
            };
            MessagePrototype.toArrayBuffer = MessagePrototype.encodeAB;
            MessagePrototype.encodeNB = function() {
              try {
                return this.encode().toBuffer();
              } catch (e) {
                if (e["encoded"])
                  e["encoded"] = e["encoded"].toBuffer();
                throw (e);
              }
            };
            MessagePrototype.toBuffer = MessagePrototype.encodeNB;
            MessagePrototype.encode64 = function() {
              try {
                return this.encode().toBase64();
              } catch (e) {
                if (e["encoded"])
                  e["encoded"] = e["encoded"].toBase64();
                throw (e);
              }
            };
            MessagePrototype.toBase64 = MessagePrototype.encode64;
            MessagePrototype.encodeHex = function() {
              try {
                return this.encode().toHex();
              } catch (e) {
                if (e["encoded"])
                  e["encoded"] = e["encoded"].toHex();
                throw (e);
              }
            };
            MessagePrototype.toHex = MessagePrototype.encodeHex;
            function cloneRaw(obj, binaryAsBase64, longsAsStrings, fieldType, resolvedType) {
              var clone = undefined;
              if (obj === null || typeof obj !== 'object') {
                if (fieldType == ProtoBuf.TYPES["enum"]) {
                  var values = resolvedType.getChildren(ProtoBuf.Reflect.Enum.Value);
                  for (var i = 0; i < values.length; i++) {
                    if (values[i]['id'] === obj) {
                      obj = values[i]['name'];
                      break;
                    }
                  }
                }
                clone = obj;
              } else if (ByteBuffer.isByteBuffer(obj)) {
                if (binaryAsBase64) {
                  clone = obj.toBase64();
                } else {
                  clone = obj.toBuffer();
                }
              } else if (Array.isArray(obj)) {
                var src = obj;
                clone = [];
                for (var idx = 0; idx < src.length; idx++)
                  clone.push(cloneRaw(src[idx], binaryAsBase64, longsAsStrings, fieldType, resolvedType));
              } else if (obj instanceof ProtoBuf.Map) {
                var it = obj.entries();
                clone = {};
                for (var e = it.next(); !e.done; e = it.next())
                  clone[obj.keyElem.valueToString(e.value[0])] = cloneRaw(e.value[1], binaryAsBase64, longsAsStrings, obj.valueElem.type, obj.valueElem.resolvedType);
              } else if (obj instanceof ProtoBuf.Long) {
                if (longsAsStrings)
                  clone = obj.toString();
                else
                  clone = new ProtoBuf.Long(obj);
              } else {
                clone = {};
                var type = obj.$type;
                var field = undefined;
                for (var i in obj) {
                  if (obj.hasOwnProperty(i)) {
                    var value = obj[i];
                    if (type) {
                      field = type.getChild(i);
                    }
                    clone[i] = cloneRaw(value, binaryAsBase64, longsAsStrings, field.type, field.resolvedType);
                  }
                }
              }
              return clone;
            }
            MessagePrototype.toRaw = function(binaryAsBase64, longsAsStrings) {
              return cloneRaw(this, !!binaryAsBase64, !!longsAsStrings, ProtoBuf.TYPES["message"], this.$type);
            };
            MessagePrototype.encodeJSON = function() {
              return JSON.stringify(cloneRaw(this, true, true, ProtoBuf.TYPES["message"], this.$type));
            };
            Message.decode = function(buffer, enc) {
              if (typeof buffer === 'string')
                buffer = ByteBuffer.wrap(buffer, enc ? enc : "base64");
              buffer = ByteBuffer.isByteBuffer(buffer) ? buffer : ByteBuffer.wrap(buffer);
              var le = buffer.littleEndian;
              try {
                var msg = T.decode(buffer.LE());
                buffer.LE(le);
                return msg;
              } catch (e) {
                buffer.LE(le);
                throw (e);
              }
            };
            Message.decodeDelimited = function(buffer, enc) {
              if (typeof buffer === 'string')
                buffer = ByteBuffer.wrap(buffer, enc ? enc : "base64");
              buffer = ByteBuffer.isByteBuffer(buffer) ? buffer : ByteBuffer.wrap(buffer);
              if (buffer.remaining() < 1)
                return null;
              var off = buffer.offset,
                  len = buffer.readVarint32();
              if (buffer.remaining() < len) {
                buffer.offset = off;
                return null;
              }
              try {
                var msg = T.decode(buffer.slice(buffer.offset, buffer.offset + len).LE());
                buffer.offset += len;
                return msg;
              } catch (err) {
                buffer.offset += len;
                throw err;
              }
            };
            Message.decode64 = function(str) {
              return Message.decode(str, "base64");
            };
            Message.decodeHex = function(str) {
              return Message.decode(str, "hex");
            };
            Message.decodeJSON = function(str) {
              return new Message(JSON.parse(str));
            };
            MessagePrototype.toString = function() {
              return T.toString();
            };
            var $optionsS;
            var $options;
            var $typeS;
            var $type;
            if (Object.defineProperty)
              Object.defineProperty(Message, '$options', {"value": T.buildOpt()}), Object.defineProperty(MessagePrototype, "$options", {"value": Message["$options"]}), Object.defineProperty(Message, "$type", {"value": T}), Object.defineProperty(MessagePrototype, "$type", {"value": T});
            return Message;
          })(ProtoBuf, this);
          this._fields = [];
          this._fieldsById = {};
          this._fieldsByName = {};
          for (var i = 0,
              k = this.children.length,
              child; i < k; i++) {
            child = this.children[i];
            if (child instanceof Enum || child instanceof Message || child instanceof Service) {
              if (clazz.hasOwnProperty(child.name))
                throw Error("Illegal reflect child of " + this.toString(true) + ": " + child.toString(true) + " cannot override static property '" + child.name + "'");
              clazz[child.name] = child.build();
            } else if (child instanceof Message.Field)
              child.build(), this._fields.push(child), this._fieldsById[child.id] = child, this._fieldsByName[child.name] = child;
            else if (!(child instanceof Message.OneOf) && !(child instanceof Extension))
              throw Error("Illegal reflect child of " + this.toString(true) + ": " + this.children[i].toString(true));
          }
          return this.clazz = clazz;
        };
        MessagePrototype.encode = function(message, buffer, noVerify) {
          var fieldMissing = null,
              field;
          for (var i = 0,
              k = this._fields.length,
              val; i < k; ++i) {
            field = this._fields[i];
            val = message[field.name];
            if (field.required && val === null) {
              if (fieldMissing === null)
                fieldMissing = field;
            } else
              field.encode(noVerify ? val : field.verifyValue(val), buffer);
          }
          if (fieldMissing !== null) {
            var err = Error("Missing at least one required field for " + this.toString(true) + ": " + fieldMissing);
            err["encoded"] = buffer;
            throw (err);
          }
          return buffer;
        };
        MessagePrototype.calculate = function(message) {
          for (var n = 0,
              i = 0,
              k = this._fields.length,
              field,
              val; i < k; ++i) {
            field = this._fields[i];
            val = message[field.name];
            if (field.required && val === null)
              throw Error("Missing at least one required field for " + this.toString(true) + ": " + field);
            else
              n += field.calculate(val);
          }
          return n;
        };
        function skipTillGroupEnd(expectedId, buf) {
          var tag = buf.readVarint32(),
              wireType = tag & 0x07,
              id = tag >>> 3;
          switch (wireType) {
            case ProtoBuf.WIRE_TYPES.VARINT:
              do
                tag = buf.readUint8();
 while ((tag & 0x80) === 0x80);
              break;
            case ProtoBuf.WIRE_TYPES.BITS64:
              buf.offset += 8;
              break;
            case ProtoBuf.WIRE_TYPES.LDELIM:
              tag = buf.readVarint32();
              buf.offset += tag;
              break;
            case ProtoBuf.WIRE_TYPES.STARTGROUP:
              skipTillGroupEnd(id, buf);
              break;
            case ProtoBuf.WIRE_TYPES.ENDGROUP:
              if (id === expectedId)
                return false;
              else
                throw Error("Illegal GROUPEND after unknown group: " + id + " (" + expectedId + " expected)");
            case ProtoBuf.WIRE_TYPES.BITS32:
              buf.offset += 4;
              break;
            default:
              throw Error("Illegal wire type in unknown group " + expectedId + ": " + wireType);
          }
          return true;
        }
        MessagePrototype.decode = function(buffer, length, expectedGroupEndId) {
          length = typeof length === 'number' ? length : -1;
          var start = buffer.offset,
              msg = new (this.clazz)(),
              tag,
              wireType,
              id,
              field;
          while (buffer.offset < start + length || (length === -1 && buffer.remaining() > 0)) {
            tag = buffer.readVarint32();
            wireType = tag & 0x07;
            id = tag >>> 3;
            if (wireType === ProtoBuf.WIRE_TYPES.ENDGROUP) {
              if (id !== expectedGroupEndId)
                throw Error("Illegal group end indicator for " + this.toString(true) + ": " + id + " (" + (expectedGroupEndId ? expectedGroupEndId + " expected" : "not a group") + ")");
              break;
            }
            if (!(field = this._fieldsById[id])) {
              switch (wireType) {
                case ProtoBuf.WIRE_TYPES.VARINT:
                  buffer.readVarint32();
                  break;
                case ProtoBuf.WIRE_TYPES.BITS32:
                  buffer.offset += 4;
                  break;
                case ProtoBuf.WIRE_TYPES.BITS64:
                  buffer.offset += 8;
                  break;
                case ProtoBuf.WIRE_TYPES.LDELIM:
                  var len = buffer.readVarint32();
                  buffer.offset += len;
                  break;
                case ProtoBuf.WIRE_TYPES.STARTGROUP:
                  while (skipTillGroupEnd(id, buffer)) {}
                  break;
                default:
                  throw Error("Illegal wire type for unknown field " + id + " in " + this.toString(true) + "#decode: " + wireType);
              }
              continue;
            }
            if (field.repeated && !field.options["packed"]) {
              msg[field.name].push(field.decode(wireType, buffer));
            } else if (field.map) {
              var keyval = field.decode(wireType, buffer);
              msg[field.name].set(keyval[0], keyval[1]);
            } else {
              msg[field.name] = field.decode(wireType, buffer);
              if (field.oneof) {
                if (this[field.oneof.name] !== null)
                  this[this[field.oneof.name]] = null;
                msg[field.oneof.name] = field.name;
              }
            }
          }
          for (var i = 0,
              k = this._fields.length; i < k; ++i) {
            field = this._fields[i];
            if (msg[field.name] === null)
              if (field.required) {
                var err = Error("Missing at least one required field for " + this.toString(true) + ": " + field.name);
                err["decoded"] = msg;
                throw (err);
              } else if (ProtoBuf.populateDefaults && field.defaultValue !== null)
                msg[field.name] = field.defaultValue;
          }
          return msg;
        };
        Reflect.Message = Message;
        var Field = function(builder, message, rule, keytype, type, name, id, options, oneof, syntax) {
          T.call(this, builder, message, name);
          this.className = "Message.Field";
          this.required = rule === "required";
          this.repeated = rule === "repeated";
          this.map = rule === "map";
          this.keyType = keytype || null;
          this.type = type;
          this.resolvedType = null;
          this.id = id;
          this.options = options || {};
          this.defaultValue = null;
          this.oneof = oneof || null;
          this.syntax = syntax || 'proto2';
          this.originalName = this.name;
          this.element = null;
          this.keyElement = null;
          if (this.builder.options['convertFieldsToCamelCase'] && !(this instanceof Message.ExtensionField))
            this.name = ProtoBuf.Util.toCamelCase(this.name);
        };
        var FieldPrototype = Field.prototype = Object.create(T.prototype);
        FieldPrototype.build = function() {
          this.element = new Element(this.type, this.resolvedType, false, this.syntax);
          if (this.map)
            this.keyElement = new Element(this.keyType, undefined, true, this.syntax);
          this.defaultValue = typeof this.options['default'] !== 'undefined' ? this.verifyValue(this.options['default']) : null;
          if (this.syntax === 'proto3' && !this.repeated && !this.map)
            this.defaultValue = this.element.defaultFieldValue(this.type);
        };
        FieldPrototype.verifyValue = function(value, skipRepeated) {
          skipRepeated = skipRepeated || false;
          var fail = function(val, msg) {
            throw Error("Illegal value for " + this.toString(true) + " of type " + this.type.name + ": " + val + " (" + msg + ")");
          }.bind(this);
          if (value === null) {
            if (this.required)
              fail(typeof value, "required");
            if (this.syntax === 'proto3' && this.type !== ProtoBuf.TYPES["message"])
              fail(typeof value, "proto3 field without field presence cannot be null");
            return null;
          }
          var i;
          if (this.repeated && !skipRepeated) {
            if (!Array.isArray(value))
              value = [value];
            var res = [];
            for (i = 0; i < value.length; i++)
              res.push(this.element.verifyValue(value[i]));
            return res;
          }
          if (this.map && !skipRepeated) {
            if (!(value instanceof ProtoBuf.Map)) {
              if (!(value instanceof Object)) {
                fail(typeof value, "expected ProtoBuf.Map or raw object for map field");
              }
              return new ProtoBuf.Map(this, value);
            } else {
              return value;
            }
          }
          if (!this.repeated && Array.isArray(value))
            fail(typeof value, "no array expected");
          return this.element.verifyValue(value);
        };
        FieldPrototype.hasWirePresence = function(value) {
          if (this.syntax !== 'proto3') {
            return (value !== null);
          } else {
            switch (this.type) {
              case ProtoBuf.TYPES["int32"]:
              case ProtoBuf.TYPES["sint32"]:
              case ProtoBuf.TYPES["sfixed32"]:
              case ProtoBuf.TYPES["uint32"]:
              case ProtoBuf.TYPES["fixed32"]:
                return value !== 0;
              case ProtoBuf.TYPES["int64"]:
              case ProtoBuf.TYPES["sint64"]:
              case ProtoBuf.TYPES["sfixed64"]:
              case ProtoBuf.TYPES["uint64"]:
              case ProtoBuf.TYPES["fixed64"]:
                return value.low !== 0 || value.high !== 0;
              case ProtoBuf.TYPES["bool"]:
                return value;
              case ProtoBuf.TYPES["float"]:
              case ProtoBuf.TYPES["double"]:
                return value !== 0.0;
              case ProtoBuf.TYPES["string"]:
                return value.length > 0;
              case ProtoBuf.TYPES["bytes"]:
                return value.remaining() > 0;
              case ProtoBuf.TYPES["enum"]:
                return value !== 0;
              case ProtoBuf.TYPES["message"]:
                return value !== null;
              default:
                return true;
            }
          }
        };
        FieldPrototype.encode = function(value, buffer) {
          if (this.type === null || typeof this.type !== 'object')
            throw Error("[INTERNAL] Unresolved type in " + this.toString(true) + ": " + this.type);
          if (value === null || (this.repeated && value.length == 0))
            return buffer;
          try {
            if (this.repeated) {
              var i;
              if (this.options["packed"] && ProtoBuf.PACKABLE_WIRE_TYPES.indexOf(this.type.wireType) >= 0) {
                buffer.writeVarint32((this.id << 3) | ProtoBuf.WIRE_TYPES.LDELIM);
                buffer.ensureCapacity(buffer.offset += 1);
                var start = buffer.offset;
                for (i = 0; i < value.length; i++)
                  this.element.encodeValue(this.id, value[i], buffer);
                var len = buffer.offset - start,
                    varintLen = ByteBuffer.calculateVarint32(len);
                if (varintLen > 1) {
                  var contents = buffer.slice(start, buffer.offset);
                  start += varintLen - 1;
                  buffer.offset = start;
                  buffer.append(contents);
                }
                buffer.writeVarint32(len, start - varintLen);
              } else {
                for (i = 0; i < value.length; i++)
                  buffer.writeVarint32((this.id << 3) | this.type.wireType), this.element.encodeValue(this.id, value[i], buffer);
              }
            } else if (this.map) {
              value.forEach(function(val, key, m) {
                var length = ByteBuffer.calculateVarint32((1 << 3) | this.keyType.wireType) + this.keyElement.calculateLength(1, key) + ByteBuffer.calculateVarint32((2 << 3) | this.type.wireType) + this.element.calculateLength(2, val);
                buffer.writeVarint32((this.id << 3) | ProtoBuf.WIRE_TYPES.LDELIM);
                buffer.writeVarint32(length);
                buffer.writeVarint32((1 << 3) | this.keyType.wireType);
                this.keyElement.encodeValue(1, key, buffer);
                buffer.writeVarint32((2 << 3) | this.type.wireType);
                this.element.encodeValue(2, val, buffer);
              }, this);
            } else {
              if (this.hasWirePresence(value)) {
                buffer.writeVarint32((this.id << 3) | this.type.wireType);
                this.element.encodeValue(this.id, value, buffer);
              }
            }
          } catch (e) {
            throw Error("Illegal value for " + this.toString(true) + ": " + value + " (" + e + ")");
          }
          return buffer;
        };
        FieldPrototype.calculate = function(value) {
          value = this.verifyValue(value);
          if (this.type === null || typeof this.type !== 'object')
            throw Error("[INTERNAL] Unresolved type in " + this.toString(true) + ": " + this.type);
          if (value === null || (this.repeated && value.length == 0))
            return 0;
          var n = 0;
          try {
            if (this.repeated) {
              var i,
                  ni;
              if (this.options["packed"] && ProtoBuf.PACKABLE_WIRE_TYPES.indexOf(this.type.wireType) >= 0) {
                n += ByteBuffer.calculateVarint32((this.id << 3) | ProtoBuf.WIRE_TYPES.LDELIM);
                ni = 0;
                for (i = 0; i < value.length; i++)
                  ni += this.element.calculateLength(this.id, value[i]);
                n += ByteBuffer.calculateVarint32(ni);
                n += ni;
              } else {
                for (i = 0; i < value.length; i++)
                  n += ByteBuffer.calculateVarint32((this.id << 3) | this.type.wireType), n += this.element.calculateLength(this.id, value[i]);
              }
            } else if (this.map) {
              value.forEach(function(val, key, m) {
                var length = ByteBuffer.calculateVarint32((1 << 3) | this.keyType.wireType) + this.keyElement.calculateLength(1, key) + ByteBuffer.calculateVarint32((2 << 3) | this.type.wireType) + this.element.calculateLength(2, val);
                n += ByteBuffer.calculateVarint32((this.id << 3) | ProtoBuf.WIRE_TYPES.LDELIM);
                n += ByteBuffer.calculateVarint32(length);
                n += length;
              }, this);
            } else {
              if (this.hasWirePresence(value)) {
                n += ByteBuffer.calculateVarint32((this.id << 3) | this.type.wireType);
                n += this.element.calculateLength(this.id, value);
              }
            }
          } catch (e) {
            throw Error("Illegal value for " + this.toString(true) + ": " + value + " (" + e + ")");
          }
          return n;
        };
        FieldPrototype.decode = function(wireType, buffer, skipRepeated) {
          var value,
              nBytes;
          var wireTypeOK = (!this.map && wireType == this.type.wireType) || (!skipRepeated && this.repeated && this.options["packed"] && wireType == ProtoBuf.WIRE_TYPES.LDELIM) || (this.map && wireType == ProtoBuf.WIRE_TYPES.LDELIM);
          if (!wireTypeOK)
            throw Error("Illegal wire type for field " + this.toString(true) + ": " + wireType + " (" + this.type.wireType + " expected)");
          if (wireType == ProtoBuf.WIRE_TYPES.LDELIM && this.repeated && this.options["packed"] && ProtoBuf.PACKABLE_WIRE_TYPES.indexOf(this.type.wireType) >= 0) {
            if (!skipRepeated) {
              nBytes = buffer.readVarint32();
              nBytes = buffer.offset + nBytes;
              var values = [];
              while (buffer.offset < nBytes)
                values.push(this.decode(this.type.wireType, buffer, true));
              return values;
            }
          }
          if (this.map) {
            var key = this.keyElement.defaultFieldValue(this.keyType);
            value = this.element.defaultFieldValue(this.type);
            nBytes = buffer.readVarint32();
            if (buffer.remaining() < nBytes)
              throw Error("Illegal number of bytes for " + this.toString(true) + ": " + nBytes + " required but got only " + buffer.remaining());
            var msgbuf = buffer.clone();
            msgbuf.limit = msgbuf.offset + nBytes;
            buffer.offset += nBytes;
            while (msgbuf.remaining() > 0) {
              var tag = msgbuf.readVarint32();
              wireType = tag & 0x07;
              var id = tag >>> 3;
              if (id === 1) {
                key = this.keyElement.decode(msgbuf, wireType, id);
              } else if (id === 2) {
                value = this.element.decode(msgbuf, wireType, id);
              } else {
                throw Error("Unexpected tag in map field key/value submessage");
              }
            }
            return [key, value];
          }
          return this.element.decode(buffer, wireType, this.id);
        };
        Reflect.Message.Field = Field;
        var ExtensionField = function(builder, message, rule, type, name, id, options) {
          Field.call(this, builder, message, rule, null, type, name, id, options);
          this.extension;
        };
        ExtensionField.prototype = Object.create(Field.prototype);
        Reflect.Message.ExtensionField = ExtensionField;
        var OneOf = function(builder, message, name) {
          T.call(this, builder, message, name);
          this.fields = [];
        };
        Reflect.Message.OneOf = OneOf;
        var Enum = function(builder, parent, name, options, syntax) {
          Namespace.call(this, builder, parent, name, options, syntax);
          this.className = "Enum";
          this.object = null;
        };
        var EnumPrototype = Enum.prototype = Object.create(Namespace.prototype);
        EnumPrototype.build = function() {
          var enm = {},
              values = this.getChildren(Enum.Value);
          for (var i = 0,
              k = values.length; i < k; ++i)
            enm[values[i]['name']] = values[i]['id'];
          if (Object.defineProperty)
            Object.defineProperty(enm, '$options', {"value": this.buildOpt()});
          return this.object = enm;
        };
        Reflect.Enum = Enum;
        var Value = function(builder, enm, name, id) {
          T.call(this, builder, enm, name);
          this.className = "Enum.Value";
          this.id = id;
        };
        Value.prototype = Object.create(T.prototype);
        Reflect.Enum.Value = Value;
        var Extension = function(builder, parent, name, field) {
          T.call(this, builder, parent, name);
          this.field = field;
        };
        Extension.prototype = Object.create(T.prototype);
        Reflect.Extension = Extension;
        var Service = function(builder, root, name, options) {
          Namespace.call(this, builder, root, name, options);
          this.className = "Service";
          this.clazz = null;
        };
        var ServicePrototype = Service.prototype = Object.create(Namespace.prototype);
        ServicePrototype.build = function(rebuild) {
          if (this.clazz && !rebuild)
            return this.clazz;
          return this.clazz = (function(ProtoBuf, T) {
            var Service = function(rpcImpl) {
              ProtoBuf.Builder.Service.call(this);
              this.rpcImpl = rpcImpl || function(name, msg, callback) {
                setTimeout(callback.bind(this, Error("Not implemented, see: https://github.com/dcodeIO/ProtoBuf.js/wiki/Services")), 0);
              };
            };
            var ServicePrototype = Service.prototype = Object.create(ProtoBuf.Builder.Service.prototype);
            var rpc = T.getChildren(ProtoBuf.Reflect.Service.RPCMethod);
            for (var i = 0; i < rpc.length; i++) {
              (function(method) {
                ServicePrototype[method.name] = function(req, callback) {
                  try {
                    try {
                      req = method.resolvedRequestType.clazz.decode(ByteBuffer.wrap(req));
                    } catch (err) {
                      if (!(err instanceof TypeError))
                        throw err;
                    }
                    if (!req || !(req instanceof method.resolvedRequestType.clazz)) {
                      setTimeout(callback.bind(this, Error("Illegal request type provided to service method " + T.name + "#" + method.name)), 0);
                      return;
                    }
                    this.rpcImpl(method.fqn(), req, function(err, res) {
                      if (err) {
                        callback(err);
                        return;
                      }
                      try {
                        res = method.resolvedResponseType.clazz.decode(res);
                      } catch (notABuffer) {}
                      if (!res || !(res instanceof method.resolvedResponseType.clazz)) {
                        callback(Error("Illegal response type received in service method " + T.name + "#" + method.name));
                        return;
                      }
                      callback(null, res);
                    });
                  } catch (err) {
                    setTimeout(callback.bind(this, err), 0);
                  }
                };
                Service[method.name] = function(rpcImpl, req, callback) {
                  new Service(rpcImpl)[method.name](req, callback);
                };
                if (Object.defineProperty)
                  Object.defineProperty(Service[method.name], "$options", {"value": method.buildOpt()}), Object.defineProperty(ServicePrototype[method.name], "$options", {"value": Service[method.name]["$options"]});
              })(rpc[i]);
            }
            var $optionsS;
            var $options;
            var $typeS;
            var $type;
            if (Object.defineProperty)
              Object.defineProperty(Service, "$options", {"value": T.buildOpt()}), Object.defineProperty(ServicePrototype, "$options", {"value": Service["$options"]}), Object.defineProperty(Service, "$type", {"value": T}), Object.defineProperty(ServicePrototype, "$type", {"value": T});
            return Service;
          })(ProtoBuf, this);
        };
        Reflect.Service = Service;
        var Method = function(builder, svc, name, options) {
          T.call(this, builder, svc, name);
          this.className = "Service.Method";
          this.options = options || {};
        };
        var MethodPrototype = Method.prototype = Object.create(T.prototype);
        MethodPrototype.buildOpt = NamespacePrototype.buildOpt;
        Reflect.Service.Method = Method;
        var RPCMethod = function(builder, svc, name, request, response, request_stream, response_stream, options) {
          Method.call(this, builder, svc, name, options);
          this.className = "Service.RPCMethod";
          this.requestName = request;
          this.responseName = response;
          this.requestStream = request_stream;
          this.responseStream = response_stream;
          this.resolvedRequestType = null;
          this.resolvedResponseType = null;
        };
        RPCMethod.prototype = Object.create(Method.prototype);
        Reflect.Service.RPCMethod = RPCMethod;
        return Reflect;
      })(ProtoBuf);
      ProtoBuf.Builder = (function(ProtoBuf, Lang, Reflect) {
        "use strict";
        function propagateSyntax(syntax, msg) {
          msg['syntax'] = syntax;
          if (msg['messages']) {
            msg['messages'].forEach(function(msg) {
              propagateSyntax(syntax, msg);
            });
          }
          if (msg['enums']) {
            msg['enums'].forEach(function(en) {
              propagateSyntax(syntax, en);
            });
          }
        }
        var Builder = function(options) {
          this.ns = new Reflect.Namespace(this, null, "");
          this.ptr = this.ns;
          this.resolved = false;
          this.result = null;
          this.files = {};
          this.importRoot = null;
          this.options = options || {};
        };
        var BuilderPrototype = Builder.prototype;
        BuilderPrototype.reset = function() {
          this.ptr = this.ns;
        };
        BuilderPrototype.define = function(pkg) {
          if (typeof pkg !== 'string' || !Lang.TYPEREF.test(pkg))
            throw Error("Illegal package: " + pkg);
          var part = pkg.split("."),
              i,
              ns;
          for (i = 0; i < part.length; i++)
            if (!Lang.NAME.test(part[i]))
              throw Error("Illegal package: " + part[i]);
          for (i = 0; i < part.length; i++) {
            ns = this.ptr.getChild(part[i]);
            if (ns === null)
              this.ptr.addChild(ns = new Reflect.Namespace(this, this.ptr, part[i]));
            this.ptr = ns;
          }
          return this;
        };
        Builder.isValidMessage = function(def) {
          if (typeof def["name"] !== 'string' || !Lang.NAME.test(def["name"]))
            return false;
          if (typeof def["values"] !== 'undefined' || typeof def["rpc"] !== 'undefined')
            return false;
          var i;
          if (typeof def["fields"] !== 'undefined') {
            if (!Array.isArray(def["fields"]))
              return false;
            var ids = [],
                id;
            for (i = 0; i < def["fields"].length; i++) {
              if (!Builder.isValidMessageField(def["fields"][i]))
                return false;
              id = parseInt(def["fields"][i]["id"], 10);
              if (ids.indexOf(id) >= 0)
                return false;
              ids.push(id);
            }
            ids = null;
          }
          if (typeof def["enums"] !== 'undefined') {
            if (!Array.isArray(def["enums"]))
              return false;
            for (i = 0; i < def["enums"].length; i++)
              if (!Builder.isValidEnum(def["enums"][i]))
                return false;
          }
          if (typeof def["messages"] !== 'undefined') {
            if (!Array.isArray(def["messages"]))
              return false;
            for (i = 0; i < def["messages"].length; i++)
              if (!Builder.isValidMessage(def["messages"][i]) && !Builder.isValidExtend(def["messages"][i]))
                return false;
          }
          if (typeof def["extensions"] !== 'undefined')
            if (!Array.isArray(def["extensions"]) || def["extensions"].length !== 2 || typeof def["extensions"][0] !== 'number' || typeof def["extensions"][1] !== 'number')
              return false;
          if (def["syntax"] === 'proto3') {
            for (i = 0; i < def["fields"].length; i++) {
              var field = def["fields"][i];
              if (field["rule"] === "required")
                return false;
              if (field["default"])
                return false;
              if (field["options"]) {
                var optionKeys = Object.keys(field["options"]);
                for (var j = 0; j < optionKeys.length; j++) {
                  if (optionKeys[j] === "default") {
                    return false;
                  }
                }
              }
            }
            if (def["extensions"])
              return false;
          }
          return true;
        };
        Builder.isValidMessageField = function(def) {
          if (typeof def["rule"] !== 'string' || typeof def["name"] !== 'string' || typeof def["type"] !== 'string' || typeof def["id"] === 'undefined')
            return false;
          if (!Lang.RULE.test(def["rule"]) || !Lang.NAME.test(def["name"]) || !Lang.TYPEREF.test(def["type"]) || !Lang.ID.test("" + def["id"]))
            return false;
          if (typeof def["options"] !== 'undefined') {
            if (typeof def["options"] !== 'object')
              return false;
            var keys = Object.keys(def["options"]);
            for (var i = 0,
                key; i < keys.length; i++)
              if (typeof(key = keys[i]) !== 'string' || (typeof def["options"][key] !== 'string' && typeof def["options"][key] !== 'number' && typeof def["options"][key] !== 'boolean'))
                return false;
          }
          return true;
        };
        Builder.isValidEnum = function(def) {
          if (typeof def["name"] !== 'string' || !Lang.NAME.test(def["name"]))
            return false;
          if (typeof def["values"] === 'undefined' || !Array.isArray(def["values"]) || def["values"].length == 0)
            return false;
          for (var i = 0; i < def["values"].length; i++) {
            if (typeof def["values"][i] != "object")
              return false;
            if (typeof def["values"][i]["name"] !== 'string' || typeof def["values"][i]["id"] === 'undefined')
              return false;
            if (!Lang.NAME.test(def["values"][i]["name"]) || !Lang.NEGID.test("" + def["values"][i]["id"]))
              return false;
          }
          if (def["syntax"] === 'proto3') {
            if (def["values"][0]["id"] !== 0) {
              return false;
            }
          }
          return true;
        };
        BuilderPrototype.create = function(defs) {
          if (!defs)
            return this;
          if (!Array.isArray(defs))
            defs = [defs];
          else {
            if (defs.length === 0)
              return this;
            defs = defs.slice();
          }
          var stack = [];
          stack.push(defs);
          while (stack.length > 0) {
            defs = stack.pop();
            if (Array.isArray(defs)) {
              while (defs.length > 0) {
                var def = defs.shift();
                if (Builder.isValidMessage(def)) {
                  var obj = new Reflect.Message(this, this.ptr, def["name"], def["options"], def["isGroup"], def["syntax"]);
                  var oneofs = {};
                  if (def["oneofs"]) {
                    var keys = Object.keys(def["oneofs"]);
                    for (var i = 0,
                        k = keys.length; i < k; ++i)
                      obj.addChild(oneofs[keys[i]] = new Reflect.Message.OneOf(this, obj, keys[i]));
                  }
                  if (def["fields"] && def["fields"].length > 0) {
                    for (i = 0, k = def["fields"].length; i < k; ++i) {
                      var fld = def['fields'][i];
                      if (obj.getChild(fld['id']) !== null)
                        throw Error("Duplicate field id in message " + obj.name + ": " + fld['id']);
                      if (fld["options"]) {
                        var opts = Object.keys(fld["options"]);
                        for (var j = 0,
                            l = opts.length; j < l; ++j) {
                          if (typeof opts[j] !== 'string')
                            throw Error("Illegal field option name in message " + obj.name + "#" + fld["name"] + ": " + opts[j]);
                          if (typeof fld["options"][opts[j]] !== 'string' && typeof fld["options"][opts[j]] !== 'number' && typeof fld["options"][opts[j]] !== 'boolean')
                            throw Error("Illegal field option value in message " + obj.name + "#" + fld["name"] + "#" + opts[j] + ": " + fld["options"][opts[j]]);
                        }
                      }
                      var oneof = null;
                      if (typeof fld["oneof"] === 'string') {
                        oneof = oneofs[fld["oneof"]];
                        if (typeof oneof === 'undefined')
                          throw Error("Illegal oneof in message " + obj.name + "#" + fld["name"] + ": " + fld["oneof"]);
                      }
                      fld = new Reflect.Message.Field(this, obj, fld["rule"], fld["keytype"], fld["type"], fld["name"], fld["id"], fld["options"], oneof, def["syntax"]);
                      if (oneof)
                        oneof.fields.push(fld);
                      obj.addChild(fld);
                    }
                  }
                  var subObj = [];
                  if (typeof def["enums"] !== 'undefined' && def['enums'].length > 0)
                    for (i = 0; i < def["enums"].length; i++)
                      subObj.push(def["enums"][i]);
                  if (def["messages"] && def["messages"].length > 0)
                    for (i = 0; i < def["messages"].length; i++)
                      subObj.push(def["messages"][i]);
                  if (def["services"] && def["services"].length > 0)
                    for (i = 0; i < def["services"].length; i++)
                      subObj.push(def["services"][i]);
                  if (def["extensions"]) {
                    obj.extensions = def["extensions"];
                    if (obj.extensions[0] < ProtoBuf.ID_MIN)
                      obj.extensions[0] = ProtoBuf.ID_MIN;
                    if (obj.extensions[1] > ProtoBuf.ID_MAX)
                      obj.extensions[1] = ProtoBuf.ID_MAX;
                  }
                  this.ptr.addChild(obj);
                  if (subObj.length > 0) {
                    stack.push(defs);
                    defs = subObj;
                    subObj = null;
                    this.ptr = obj;
                    obj = null;
                    continue;
                  }
                  subObj = null;
                  obj = null;
                } else if (Builder.isValidEnum(def)) {
                  obj = new Reflect.Enum(this, this.ptr, def["name"], def["options"], def["syntax"]);
                  for (i = 0; i < def["values"].length; i++)
                    obj.addChild(new Reflect.Enum.Value(this, obj, def["values"][i]["name"], def["values"][i]["id"]));
                  this.ptr.addChild(obj);
                  obj = null;
                } else if (Builder.isValidService(def)) {
                  obj = new Reflect.Service(this, this.ptr, def["name"], def["options"]);
                  for (i in def["rpc"])
                    if (def["rpc"].hasOwnProperty(i))
                      obj.addChild(new Reflect.Service.RPCMethod(this, obj, i, def["rpc"][i]["request"], def["rpc"][i]["response"], !!def["rpc"][i]["request_stream"], !!def["rpc"][i]["response_stream"], def["rpc"][i]["options"]));
                  this.ptr.addChild(obj);
                  obj = null;
                } else if (Builder.isValidExtend(def)) {
                  obj = this.ptr.resolve(def["ref"], true);
                  if (obj) {
                    for (i = 0; i < def["fields"].length; i++) {
                      if (obj.getChild(def['fields'][i]['id']) !== null)
                        throw Error("Duplicate extended field id in message " + obj.name + ": " + def['fields'][i]['id']);
                      if (def['fields'][i]['id'] < obj.extensions[0] || def['fields'][i]['id'] > obj.extensions[1])
                        throw Error("Illegal extended field id in message " + obj.name + ": " + def['fields'][i]['id'] + " (" + obj.extensions.join(' to ') + " expected)");
                      var name = def["fields"][i]["name"];
                      if (this.options['convertFieldsToCamelCase'])
                        name = ProtoBuf.Util.toCamelCase(def["fields"][i]["name"]);
                      fld = new Reflect.Message.ExtensionField(this, obj, def["fields"][i]["rule"], def["fields"][i]["type"], this.ptr.fqn() + '.' + name, def["fields"][i]["id"], def["fields"][i]["options"]);
                      var ext = new Reflect.Extension(this, this.ptr, def["fields"][i]["name"], fld);
                      fld.extension = ext;
                      this.ptr.addChild(ext);
                      obj.addChild(fld);
                    }
                  } else if (!/\.?google\.protobuf\./.test(def["ref"]))
                    throw Error("Extended message " + def["ref"] + " is not defined");
                } else
                  throw Error("Not a valid definition: " + JSON.stringify(def));
                def = null;
              }
            } else
              throw Error("Not a valid namespace: " + JSON.stringify(defs));
            defs = null;
            this.ptr = this.ptr.parent;
          }
          this.resolved = false;
          this.result = null;
          return this;
        };
        BuilderPrototype["import"] = function(json, filename) {
          if (typeof filename === 'string') {
            if (ProtoBuf.Util.IS_NODE)
              filename = require("1c")['resolve'](filename);
            if (this.files[filename] === true) {
              this.reset();
              return this;
            }
            this.files[filename] = true;
          } else if (typeof filename === 'object') {
            var root = filename.root;
            if (ProtoBuf.Util.IS_NODE)
              root = require("1c")['resolve'](root);
            var fname = [root, filename.file].join('/');
            if (this.files[fname] === true) {
              this.reset();
              return this;
            }
            this.files[fname] = true;
          }
          if (!!json['imports'] && json['imports'].length > 0) {
            var importRoot,
                delim = '/',
                resetRoot = false;
            if (typeof filename === 'object') {
              this.importRoot = filename["root"];
              resetRoot = true;
              importRoot = this.importRoot;
              filename = filename["file"];
              if (importRoot.indexOf("\\") >= 0 || filename.indexOf("\\") >= 0)
                delim = '\\';
            } else if (typeof filename === 'string') {
              if (this.importRoot)
                importRoot = this.importRoot;
              else {
                if (filename.indexOf("/") >= 0) {
                  importRoot = filename.replace(/\/[^\/]*$/, "");
                  if (importRoot === "")
                    importRoot = "/";
                } else if (filename.indexOf("\\") >= 0) {
                  importRoot = filename.replace(/\\[^\\]*$/, "");
                  delim = '\\';
                } else
                  importRoot = ".";
              }
            } else
              importRoot = null;
            for (var i = 0; i < json['imports'].length; i++) {
              if (typeof json['imports'][i] === 'string') {
                if (!importRoot)
                  throw Error("Cannot determine import root: File name is unknown");
                var importFilename = json['imports'][i];
                if (importFilename === "google/protobuf/descriptor.proto")
                  continue;
                importFilename = importRoot + delim + importFilename;
                if (this.files[importFilename] === true)
                  continue;
                if (/\.proto$/i.test(importFilename) && !ProtoBuf.DotProto)
                  importFilename = importFilename.replace(/\.proto$/, ".json");
                var contents = ProtoBuf.Util.fetch(importFilename);
                if (contents === null)
                  throw Error("Failed to import '" + importFilename + "' in '" + filename + "': File not found");
                if (/\.json$/i.test(importFilename))
                  this["import"](JSON.parse(contents + ""), importFilename);
                else
                  this["import"]((new ProtoBuf.DotProto.Parser(contents + "")).parse(), importFilename);
              } else if (!filename)
                this["import"](json['imports'][i]);
              else if (/\.(\w+)$/.test(filename))
                this["import"](json['imports'][i], filename.replace(/^(.+)\.(\w+)$/, function($0, $1, $2) {
                  return $1 + "_import" + i + "." + $2;
                }));
              else
                this["import"](json['imports'][i], filename + "_import" + i);
            }
            if (resetRoot)
              this.importRoot = null;
          }
          if (json['package'])
            this.define(json['package']);
          if (json['syntax']) {
            propagateSyntax(json['syntax'], json);
          }
          var base = this.ptr;
          if (json['options'])
            Object.keys(json['options']).forEach(function(key) {
              base.options[key] = json['options'][key];
            });
          if (json['messages'])
            this.create(json['messages']), this.ptr = base;
          if (json['enums'])
            this.create(json['enums']), this.ptr = base;
          if (json['services'])
            this.create(json['services']), this.ptr = base;
          if (json['extends'])
            this.create(json['extends']);
          this.reset();
          return this;
        };
        Builder.isValidService = function(def) {
          return !(typeof def["name"] !== 'string' || !Lang.NAME.test(def["name"]) || typeof def["rpc"] !== 'object');
        };
        Builder.isValidExtend = function(def) {
          if (typeof def["ref"] !== 'string' || !Lang.TYPEREF.test(def["ref"]))
            return false;
          var i;
          if (typeof def["fields"] !== 'undefined') {
            if (!Array.isArray(def["fields"]))
              return false;
            var ids = [],
                id;
            for (i = 0; i < def["fields"].length; i++) {
              if (!Builder.isValidMessageField(def["fields"][i]))
                return false;
              id = parseInt(def["id"], 10);
              if (ids.indexOf(id) >= 0)
                return false;
              ids.push(id);
            }
            ids = null;
          }
          return true;
        };
        BuilderPrototype.resolveAll = function() {
          var res;
          if (this.ptr == null || typeof this.ptr.type === 'object')
            return;
          if (this.ptr instanceof Reflect.Namespace) {
            var children = this.ptr.children;
            for (var i = 0,
                k = children.length; i < k; ++i)
              this.ptr = children[i], this.resolveAll();
          } else if (this.ptr instanceof Reflect.Message.Field) {
            if (!Lang.TYPE.test(this.ptr.type)) {
              if (!Lang.TYPEREF.test(this.ptr.type))
                throw Error("Illegal type reference in " + this.ptr.toString(true) + ": " + this.ptr.type);
              res = (this.ptr instanceof Reflect.Message.ExtensionField ? this.ptr.extension.parent : this.ptr.parent).resolve(this.ptr.type, true);
              if (!res)
                throw Error("Unresolvable type reference in " + this.ptr.toString(true) + ": " + this.ptr.type);
              this.ptr.resolvedType = res;
              if (res instanceof Reflect.Enum) {
                this.ptr.type = ProtoBuf.TYPES["enum"];
                if (this.ptr.syntax === 'proto3' && res.syntax !== 'proto3')
                  throw Error("Proto3 message refers to proto2 enum; " + "this is not allowed due to differing " + "enum semantics in proto3");
              } else if (res instanceof Reflect.Message)
                this.ptr.type = res.isGroup ? ProtoBuf.TYPES["group"] : ProtoBuf.TYPES["message"];
              else
                throw Error("Illegal type reference in " + this.ptr.toString(true) + ": " + this.ptr.type);
            } else
              this.ptr.type = ProtoBuf.TYPES[this.ptr.type];
            if (this.ptr.map) {
              if (!Lang.TYPE.test(this.ptr.keyType))
                throw Error("Illegal key type for map field in " + this.ptr.toString(true) + ": " + this.ptr.type);
              this.ptr.keyType = ProtoBuf.TYPES[this.ptr.keyType];
            }
          } else if (this.ptr instanceof ProtoBuf.Reflect.Enum.Value) {} else if (this.ptr instanceof ProtoBuf.Reflect.Service.Method) {
            if (this.ptr instanceof ProtoBuf.Reflect.Service.RPCMethod) {
              res = this.ptr.parent.resolve(this.ptr.requestName, true);
              if (!res || !(res instanceof ProtoBuf.Reflect.Message))
                throw Error("Illegal type reference in " + this.ptr.toString(true) + ": " + this.ptr.requestName);
              this.ptr.resolvedRequestType = res;
              res = this.ptr.parent.resolve(this.ptr.responseName, true);
              if (!res || !(res instanceof ProtoBuf.Reflect.Message))
                throw Error("Illegal type reference in " + this.ptr.toString(true) + ": " + this.ptr.responseName);
              this.ptr.resolvedResponseType = res;
            } else {
              throw Error("Illegal service type in " + this.ptr.toString(true));
            }
          } else if (!(this.ptr instanceof ProtoBuf.Reflect.Message.OneOf) && !(this.ptr instanceof ProtoBuf.Reflect.Extension))
            throw Error("Illegal object in namespace: " + typeof(this.ptr) + ":" + this.ptr);
          this.reset();
        };
        BuilderPrototype.build = function(path) {
          this.reset();
          if (!this.resolved)
            this.resolveAll(), this.resolved = true, this.result = null;
          if (this.result === null)
            this.result = this.ns.build();
          if (!path)
            return this.result;
          else {
            var part = typeof path === 'string' ? path.split(".") : path,
                ptr = this.result;
            for (var i = 0; i < part.length; i++)
              if (ptr[part[i]])
                ptr = ptr[part[i]];
              else {
                ptr = null;
                break;
              }
            return ptr;
          }
        };
        BuilderPrototype.lookup = function(path, excludeNonNamespace) {
          return path ? this.ns.resolve(path, excludeNonNamespace) : this.ns;
        };
        BuilderPrototype.toString = function() {
          return "Builder";
        };
        Builder.Message = function() {};
        Builder.Service = function() {};
        return Builder;
      })(ProtoBuf, ProtoBuf.Lang, ProtoBuf.Reflect);
      ProtoBuf.Map = (function(ProtoBuf, Reflect) {
        "use strict";
        var Map = function(field, contents) {
          if (!field.map)
            throw Error("field is not a map");
          this.field = field;
          this.keyElem = new Reflect.Element(field.keyType, null, true, field.syntax);
          this.valueElem = new Reflect.Element(field.type, field.resolvedType, false, field.syntax);
          this.map = {};
          Object.defineProperty(this, "size", {get: function() {
              return Object.keys(this.map).length;
            }});
          if (contents) {
            var keys = Object.keys(contents);
            for (var i = 0; i < keys.length; i++) {
              var key = this.keyElem.valueFromString(keys[i]);
              var val = this.valueElem.verifyValue(contents[keys[i]]);
              this.map[this.keyElem.valueToString(key)] = {
                key: key,
                value: val
              };
            }
          }
        };
        var MapPrototype = Map.prototype;
        function arrayIterator(arr) {
          var idx = 0;
          return {next: function() {
              if (idx < arr.length)
                return {
                  done: false,
                  value: arr[idx++]
                };
              return {done: true};
            }};
        }
        MapPrototype.clear = function() {
          this.map = {};
        };
        MapPrototype["delete"] = function(key) {
          var keyValue = this.keyElem.valueToString(this.keyElem.verifyValue(key));
          var hadKey = keyValue in this.map;
          delete this.map[keyValue];
          return hadKey;
        };
        MapPrototype.entries = function() {
          var entries = [];
          var strKeys = Object.keys(this.map);
          for (var i = 0,
              entry; i < strKeys.length; i++)
            entries.push([(entry = this.map[strKeys[i]]).key, entry.value]);
          return arrayIterator(entries);
        };
        MapPrototype.keys = function() {
          var keys = [];
          var strKeys = Object.keys(this.map);
          for (var i = 0; i < strKeys.length; i++)
            keys.push(this.map[strKeys[i]].key);
          return arrayIterator(keys);
        };
        MapPrototype.values = function() {
          var values = [];
          var strKeys = Object.keys(this.map);
          for (var i = 0; i < strKeys.length; i++)
            values.push(this.map[strKeys[i]].value);
          return arrayIterator(values);
        };
        MapPrototype.forEach = function(cb, thisArg) {
          var strKeys = Object.keys(this.map);
          for (var i = 0,
              entry; i < strKeys.length; i++)
            cb.call(thisArg, (entry = this.map[strKeys[i]]).value, entry.key, this);
        };
        MapPrototype.set = function(key, value) {
          var keyValue = this.keyElem.verifyValue(key);
          var valValue = this.valueElem.verifyValue(value);
          this.map[this.keyElem.valueToString(keyValue)] = {
            key: keyValue,
            value: valValue
          };
          return this;
        };
        MapPrototype.get = function(key) {
          var keyValue = this.keyElem.valueToString(this.keyElem.verifyValue(key));
          if (!(keyValue in this.map))
            return undefined;
          return this.map[keyValue].value;
        };
        MapPrototype.has = function(key) {
          var keyValue = this.keyElem.valueToString(this.keyElem.verifyValue(key));
          return (keyValue in this.map);
        };
        return Map;
      })(ProtoBuf, ProtoBuf.Reflect);
      ProtoBuf.loadProto = function(proto, builder, filename) {
        if (typeof builder === 'string' || (builder && typeof builder["file"] === 'string' && typeof builder["root"] === 'string'))
          filename = builder, builder = undefined;
        return ProtoBuf.loadJson((new ProtoBuf.DotProto.Parser(proto)).parse(), builder, filename);
      };
      ProtoBuf.protoFromString = ProtoBuf.loadProto;
      ProtoBuf.loadProtoFile = function(filename, callback, builder) {
        if (callback && typeof callback === 'object')
          builder = callback, callback = null;
        else if (!callback || typeof callback !== 'function')
          callback = null;
        if (callback)
          return ProtoBuf.Util.fetch(typeof filename === 'string' ? filename : filename["root"] + "/" + filename["file"], function(contents) {
            if (contents === null) {
              callback(Error("Failed to fetch file"));
              return;
            }
            try {
              callback(null, ProtoBuf.loadProto(contents, builder, filename));
            } catch (e) {
              callback(e);
            }
          });
        var contents = ProtoBuf.Util.fetch(typeof filename === 'object' ? filename["root"] + "/" + filename["file"] : filename);
        return contents === null ? null : ProtoBuf.loadProto(contents, builder, filename);
      };
      ProtoBuf.protoFromFile = ProtoBuf.loadProtoFile;
      ProtoBuf.newBuilder = function(options) {
        options = options || {};
        if (typeof options['convertFieldsToCamelCase'] === 'undefined')
          options['convertFieldsToCamelCase'] = ProtoBuf.convertFieldsToCamelCase;
        if (typeof options['populateAccessors'] === 'undefined')
          options['populateAccessors'] = ProtoBuf.populateAccessors;
        return new ProtoBuf.Builder(options);
      };
      ProtoBuf.loadJson = function(json, builder, filename) {
        if (typeof builder === 'string' || (builder && typeof builder["file"] === 'string' && typeof builder["root"] === 'string'))
          filename = builder, builder = null;
        if (!builder || typeof builder !== 'object')
          builder = ProtoBuf.newBuilder();
        if (typeof json === 'string')
          json = JSON.parse(json);
        builder["import"](json, filename);
        builder.resolveAll();
        return builder;
      };
      ProtoBuf.loadJsonFile = function(filename, callback, builder) {
        if (callback && typeof callback === 'object')
          builder = callback, callback = null;
        else if (!callback || typeof callback !== 'function')
          callback = null;
        if (callback)
          return ProtoBuf.Util.fetch(typeof filename === 'string' ? filename : filename["root"] + "/" + filename["file"], function(contents) {
            if (contents === null) {
              callback(Error("Failed to fetch file"));
              return;
            }
            try {
              callback(null, ProtoBuf.loadJson(JSON.parse(contents), builder, filename));
            } catch (e) {
              callback(e);
            }
          });
        var contents = ProtoBuf.Util.fetch(typeof filename === 'object' ? filename["root"] + "/" + filename["file"] : filename);
        return contents === null ? null : ProtoBuf.loadJson(JSON.parse(contents), builder, filename);
      };
      return ProtoBuf;
    });
  })(require("14").Buffer, require("5"));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1e", ["1d"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = require("1d");
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1f", ["1e"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = require("1e").newBuilder({})['import']({
    "package": null,
    "options": {"java_package": "com.ilmservice.personalbudget.protobufs"},
    "messages": [{
      "name": "Test",
      "fields": [{
        "rule": "optional",
        "type": "int32",
        "name": "id",
        "id": 1
      }, {
        "rule": "optional",
        "type": "string",
        "name": "greeting",
        "id": 2
      }]
    }]
  }).build();
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("22", ["5"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    if (typeof module !== "undefined" && typeof exports !== "undefined" && module.exports === exports) {
      module.exports = 'ui.router';
    }
    (function(window, angular, undefined) {
      'use strict';
      var isDefined = angular.isDefined,
          isFunction = angular.isFunction,
          isString = angular.isString,
          isObject = angular.isObject,
          isArray = angular.isArray,
          forEach = angular.forEach,
          extend = angular.extend,
          copy = angular.copy;
      function inherit(parent, extra) {
        return extend(new (extend(function() {}, {prototype: parent}))(), extra);
      }
      function merge(dst) {
        forEach(arguments, function(obj) {
          if (obj !== dst) {
            forEach(obj, function(value, key) {
              if (!dst.hasOwnProperty(key))
                dst[key] = value;
            });
          }
        });
        return dst;
      }
      function ancestors(first, second) {
        var path = [];
        for (var n in first.path) {
          if (first.path[n] !== second.path[n])
            break;
          path.push(first.path[n]);
        }
        return path;
      }
      function objectKeys(object) {
        if (Object.keys) {
          return Object.keys(object);
        }
        var result = [];
        forEach(object, function(val, key) {
          result.push(key);
        });
        return result;
      }
      function indexOf(array, value) {
        if (Array.prototype.indexOf) {
          return array.indexOf(value, Number(arguments[2]) || 0);
        }
        var len = array.length >>> 0,
            from = Number(arguments[2]) || 0;
        from = (from < 0) ? Math.ceil(from) : Math.floor(from);
        if (from < 0)
          from += len;
        for (; from < len; from++) {
          if (from in array && array[from] === value)
            return from;
        }
        return -1;
      }
      function inheritParams(currentParams, newParams, $current, $to) {
        var parents = ancestors($current, $to),
            parentParams,
            inherited = {},
            inheritList = [];
        for (var i in parents) {
          if (!parents[i].params)
            continue;
          parentParams = objectKeys(parents[i].params);
          if (!parentParams.length)
            continue;
          for (var j in parentParams) {
            if (indexOf(inheritList, parentParams[j]) >= 0)
              continue;
            inheritList.push(parentParams[j]);
            inherited[parentParams[j]] = currentParams[parentParams[j]];
          }
        }
        return extend({}, inherited, newParams);
      }
      function equalForKeys(a, b, keys) {
        if (!keys) {
          keys = [];
          for (var n in a)
            keys.push(n);
        }
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          if (a[k] != b[k])
            return false;
        }
        return true;
      }
      function filterByKeys(keys, values) {
        var filtered = {};
        forEach(keys, function(name) {
          filtered[name] = values[name];
        });
        return filtered;
      }
      function indexBy(array, propName) {
        var result = {};
        forEach(array, function(item) {
          result[item[propName]] = item;
        });
        return result;
      }
      function pick(obj) {
        var copy = {};
        var keys = Array.prototype.concat.apply(Array.prototype, Array.prototype.slice.call(arguments, 1));
        forEach(keys, function(key) {
          if (key in obj)
            copy[key] = obj[key];
        });
        return copy;
      }
      function omit(obj) {
        var copy = {};
        var keys = Array.prototype.concat.apply(Array.prototype, Array.prototype.slice.call(arguments, 1));
        for (var key in obj) {
          if (indexOf(keys, key) == -1)
            copy[key] = obj[key];
        }
        return copy;
      }
      function pluck(collection, key) {
        var result = isArray(collection) ? [] : {};
        forEach(collection, function(val, i) {
          result[i] = isFunction(key) ? key(val) : val[key];
        });
        return result;
      }
      function filter(collection, callback) {
        var array = isArray(collection);
        var result = array ? [] : {};
        forEach(collection, function(val, i) {
          if (callback(val, i)) {
            result[array ? result.length : i] = val;
          }
        });
        return result;
      }
      function map(collection, callback) {
        var result = isArray(collection) ? [] : {};
        forEach(collection, function(val, i) {
          result[i] = callback(val, i);
        });
        return result;
      }
      angular.module('ui.router.util', ['ng']);
      angular.module('ui.router.router', ['ui.router.util']);
      angular.module('ui.router.state', ['ui.router.router', 'ui.router.util']);
      angular.module('ui.router', ['ui.router.state']);
      angular.module('ui.router.compat', ['ui.router']);
      $Resolve.$inject = ['$q', '$injector'];
      function $Resolve($q, $injector) {
        var VISIT_IN_PROGRESS = 1,
            VISIT_DONE = 2,
            NOTHING = {},
            NO_DEPENDENCIES = [],
            NO_LOCALS = NOTHING,
            NO_PARENT = extend($q.when(NOTHING), {
              $$promises: NOTHING,
              $$values: NOTHING
            });
        this.study = function(invocables) {
          if (!isObject(invocables))
            throw new Error("'invocables' must be an object");
          var invocableKeys = objectKeys(invocables || {});
          var plan = [],
              cycle = [],
              visited = {};
          function visit(value, key) {
            if (visited[key] === VISIT_DONE)
              return;
            cycle.push(key);
            if (visited[key] === VISIT_IN_PROGRESS) {
              cycle.splice(0, indexOf(cycle, key));
              throw new Error("Cyclic dependency: " + cycle.join(" -> "));
            }
            visited[key] = VISIT_IN_PROGRESS;
            if (isString(value)) {
              plan.push(key, [function() {
                return $injector.get(value);
              }], NO_DEPENDENCIES);
            } else {
              var params = $injector.annotate(value);
              forEach(params, function(param) {
                if (param !== key && invocables.hasOwnProperty(param))
                  visit(invocables[param], param);
              });
              plan.push(key, value, params);
            }
            cycle.pop();
            visited[key] = VISIT_DONE;
          }
          forEach(invocables, visit);
          invocables = cycle = visited = null;
          function isResolve(value) {
            return isObject(value) && value.then && value.$$promises;
          }
          return function(locals, parent, self) {
            if (isResolve(locals) && self === undefined) {
              self = parent;
              parent = locals;
              locals = null;
            }
            if (!locals)
              locals = NO_LOCALS;
            else if (!isObject(locals)) {
              throw new Error("'locals' must be an object");
            }
            if (!parent)
              parent = NO_PARENT;
            else if (!isResolve(parent)) {
              throw new Error("'parent' must be a promise returned by $resolve.resolve()");
            }
            var resolution = $q.defer(),
                result = resolution.promise,
                promises = result.$$promises = {},
                values = extend({}, locals),
                wait = 1 + plan.length / 3,
                merged = false;
            function done() {
              if (!--wait) {
                if (!merged)
                  merge(values, parent.$$values);
                result.$$values = values;
                result.$$promises = result.$$promises || true;
                delete result.$$inheritedValues;
                resolution.resolve(values);
              }
            }
            function fail(reason) {
              result.$$failure = reason;
              resolution.reject(reason);
            }
            if (isDefined(parent.$$failure)) {
              fail(parent.$$failure);
              return result;
            }
            if (parent.$$inheritedValues) {
              merge(values, omit(parent.$$inheritedValues, invocableKeys));
            }
            extend(promises, parent.$$promises);
            if (parent.$$values) {
              merged = merge(values, omit(parent.$$values, invocableKeys));
              result.$$inheritedValues = omit(parent.$$values, invocableKeys);
              done();
            } else {
              if (parent.$$inheritedValues) {
                result.$$inheritedValues = omit(parent.$$inheritedValues, invocableKeys);
              }
              parent.then(done, fail);
            }
            for (var i = 0,
                ii = plan.length; i < ii; i += 3) {
              if (locals.hasOwnProperty(plan[i]))
                done();
              else
                invoke(plan[i], plan[i + 1], plan[i + 2]);
            }
            function invoke(key, invocable, params) {
              var invocation = $q.defer(),
                  waitParams = 0;
              function onfailure(reason) {
                invocation.reject(reason);
                fail(reason);
              }
              forEach(params, function(dep) {
                if (promises.hasOwnProperty(dep) && !locals.hasOwnProperty(dep)) {
                  waitParams++;
                  promises[dep].then(function(result) {
                    values[dep] = result;
                    if (!(--waitParams))
                      proceed();
                  }, onfailure);
                }
              });
              if (!waitParams)
                proceed();
              function proceed() {
                if (isDefined(result.$$failure))
                  return;
                try {
                  invocation.resolve($injector.invoke(invocable, self, values));
                  invocation.promise.then(function(result) {
                    values[key] = result;
                    done();
                  }, onfailure);
                } catch (e) {
                  onfailure(e);
                }
              }
              promises[key] = invocation.promise;
            }
            return result;
          };
        };
        this.resolve = function(invocables, locals, parent, self) {
          return this.study(invocables)(locals, parent, self);
        };
      }
      angular.module('ui.router.util').service('$resolve', $Resolve);
      $TemplateFactory.$inject = ['$http', '$templateCache', '$injector'];
      function $TemplateFactory($http, $templateCache, $injector) {
        this.fromConfig = function(config, params, locals) {
          return (isDefined(config.template) ? this.fromString(config.template, params) : isDefined(config.templateUrl) ? this.fromUrl(config.templateUrl, params) : isDefined(config.templateProvider) ? this.fromProvider(config.templateProvider, params, locals) : null);
        };
        this.fromString = function(template, params) {
          return isFunction(template) ? template(params) : template;
        };
        this.fromUrl = function(url, params) {
          if (isFunction(url))
            url = url(params);
          if (url == null)
            return null;
          else
            return $http.get(url, {
              cache: $templateCache,
              headers: {Accept: 'text/html'}
            }).then(function(response) {
              return response.data;
            });
        };
        this.fromProvider = function(provider, params, locals) {
          return $injector.invoke(provider, null, locals || {params: params});
        };
      }
      angular.module('ui.router.util').service('$templateFactory', $TemplateFactory);
      var $$UMFP;
      function UrlMatcher(pattern, config, parentMatcher) {
        config = extend({params: {}}, isObject(config) ? config : {});
        var placeholder = /([:*])([\w\[\]]+)|\{([\w\[\]]+)(?:\:((?:[^{}\\]+|\\.|\{(?:[^{}\\]+|\\.)*\})+))?\}/g,
            searchPlaceholder = /([:]?)([\w\[\]-]+)|\{([\w\[\]-]+)(?:\:((?:[^{}\\]+|\\.|\{(?:[^{}\\]+|\\.)*\})+))?\}/g,
            compiled = '^',
            last = 0,
            m,
            segments = this.segments = [],
            parentParams = parentMatcher ? parentMatcher.params : {},
            params = this.params = parentMatcher ? parentMatcher.params.$$new() : new $$UMFP.ParamSet(),
            paramNames = [];
        function addParameter(id, type, config, location) {
          paramNames.push(id);
          if (parentParams[id])
            return parentParams[id];
          if (!/^\w+(-+\w+)*(?:\[\])?$/.test(id))
            throw new Error("Invalid parameter name '" + id + "' in pattern '" + pattern + "'");
          if (params[id])
            throw new Error("Duplicate parameter name '" + id + "' in pattern '" + pattern + "'");
          params[id] = new $$UMFP.Param(id, type, config, location);
          return params[id];
        }
        function quoteRegExp(string, pattern, squash, optional) {
          var surroundPattern = ['', ''],
              result = string.replace(/[\\\[\]\^$*+?.()|{}]/g, "\\$&");
          if (!pattern)
            return result;
          switch (squash) {
            case false:
              surroundPattern = ['(', ')' + (optional ? "?" : "")];
              break;
            case true:
              surroundPattern = ['?(', ')?'];
              break;
            default:
              surroundPattern = ['(' + squash + "|", ')?'];
              break;
          }
          return result + surroundPattern[0] + pattern + surroundPattern[1];
        }
        this.source = pattern;
        function matchDetails(m, isSearch) {
          var id,
              regexp,
              segment,
              type,
              cfg,
              arrayMode;
          id = m[2] || m[3];
          cfg = config.params[id];
          segment = pattern.substring(last, m.index);
          regexp = isSearch ? m[4] : m[4] || (m[1] == '*' ? '.*' : null);
          type = $$UMFP.type(regexp || "string") || inherit($$UMFP.type("string"), {pattern: new RegExp(regexp, config.caseInsensitive ? 'i' : undefined)});
          return {
            id: id,
            regexp: regexp,
            segment: segment,
            type: type,
            cfg: cfg
          };
        }
        var p,
            param,
            segment;
        while ((m = placeholder.exec(pattern))) {
          p = matchDetails(m, false);
          if (p.segment.indexOf('?') >= 0)
            break;
          param = addParameter(p.id, p.type, p.cfg, "path");
          compiled += quoteRegExp(p.segment, param.type.pattern.source, param.squash, param.isOptional);
          segments.push(p.segment);
          last = placeholder.lastIndex;
        }
        segment = pattern.substring(last);
        var i = segment.indexOf('?');
        if (i >= 0) {
          var search = this.sourceSearch = segment.substring(i);
          segment = segment.substring(0, i);
          this.sourcePath = pattern.substring(0, last + i);
          if (search.length > 0) {
            last = 0;
            while ((m = searchPlaceholder.exec(search))) {
              p = matchDetails(m, true);
              param = addParameter(p.id, p.type, p.cfg, "search");
              last = placeholder.lastIndex;
            }
          }
        } else {
          this.sourcePath = pattern;
          this.sourceSearch = '';
        }
        compiled += quoteRegExp(segment) + (config.strict === false ? '\/?' : '') + '$';
        segments.push(segment);
        this.regexp = new RegExp(compiled, config.caseInsensitive ? 'i' : undefined);
        this.prefix = segments[0];
        this.$$paramNames = paramNames;
      }
      UrlMatcher.prototype.concat = function(pattern, config) {
        var defaultConfig = {
          caseInsensitive: $$UMFP.caseInsensitive(),
          strict: $$UMFP.strictMode(),
          squash: $$UMFP.defaultSquashPolicy()
        };
        return new UrlMatcher(this.sourcePath + pattern + this.sourceSearch, extend(defaultConfig, config), this);
      };
      UrlMatcher.prototype.toString = function() {
        return this.source;
      };
      UrlMatcher.prototype.exec = function(path, searchParams) {
        var m = this.regexp.exec(path);
        if (!m)
          return null;
        searchParams = searchParams || {};
        var paramNames = this.parameters(),
            nTotal = paramNames.length,
            nPath = this.segments.length - 1,
            values = {},
            i,
            j,
            cfg,
            paramName;
        if (nPath !== m.length - 1)
          throw new Error("Unbalanced capture group in route '" + this.source + "'");
        function decodePathArray(string) {
          function reverseString(str) {
            return str.split("").reverse().join("");
          }
          function unquoteDashes(str) {
            return str.replace(/\\-/g, "-");
          }
          var split = reverseString(string).split(/-(?!\\)/);
          var allReversed = map(split, reverseString);
          return map(allReversed, unquoteDashes).reverse();
        }
        for (i = 0; i < nPath; i++) {
          paramName = paramNames[i];
          var param = this.params[paramName];
          var paramVal = m[i + 1];
          for (j = 0; j < param.replace; j++) {
            if (param.replace[j].from === paramVal)
              paramVal = param.replace[j].to;
          }
          if (paramVal && param.array === true)
            paramVal = decodePathArray(paramVal);
          values[paramName] = param.value(paramVal);
        }
        for (; i < nTotal; i++) {
          paramName = paramNames[i];
          values[paramName] = this.params[paramName].value(searchParams[paramName]);
        }
        return values;
      };
      UrlMatcher.prototype.parameters = function(param) {
        if (!isDefined(param))
          return this.$$paramNames;
        return this.params[param] || null;
      };
      UrlMatcher.prototype.validates = function(params) {
        return this.params.$$validates(params);
      };
      UrlMatcher.prototype.format = function(values) {
        values = values || {};
        var segments = this.segments,
            params = this.parameters(),
            paramset = this.params;
        if (!this.validates(values))
          return null;
        var i,
            search = false,
            nPath = segments.length - 1,
            nTotal = params.length,
            result = segments[0];
        function encodeDashes(str) {
          return encodeURIComponent(str).replace(/-/g, function(c) {
            return '%5C%' + c.charCodeAt(0).toString(16).toUpperCase();
          });
        }
        for (i = 0; i < nTotal; i++) {
          var isPathParam = i < nPath;
          var name = params[i],
              param = paramset[name],
              value = param.value(values[name]);
          var isDefaultValue = param.isOptional && param.type.equals(param.value(), value);
          var squash = isDefaultValue ? param.squash : false;
          var encoded = param.type.encode(value);
          if (isPathParam) {
            var nextSegment = segments[i + 1];
            if (squash === false) {
              if (encoded != null) {
                if (isArray(encoded)) {
                  result += map(encoded, encodeDashes).join("-");
                } else {
                  result += encodeURIComponent(encoded);
                }
              }
              result += nextSegment;
            } else if (squash === true) {
              var capture = result.match(/\/$/) ? /\/?(.*)/ : /(.*)/;
              result += nextSegment.match(capture)[1];
            } else if (isString(squash)) {
              result += squash + nextSegment;
            }
          } else {
            if (encoded == null || (isDefaultValue && squash !== false))
              continue;
            if (!isArray(encoded))
              encoded = [encoded];
            encoded = map(encoded, encodeURIComponent).join('&' + name + '=');
            result += (search ? '&' : '?') + (name + '=' + encoded);
            search = true;
          }
        }
        return result;
      };
      function Type(config) {
        extend(this, config);
      }
      Type.prototype.is = function(val, key) {
        return true;
      };
      Type.prototype.encode = function(val, key) {
        return val;
      };
      Type.prototype.decode = function(val, key) {
        return val;
      };
      Type.prototype.equals = function(a, b) {
        return a == b;
      };
      Type.prototype.$subPattern = function() {
        var sub = this.pattern.toString();
        return sub.substr(1, sub.length - 2);
      };
      Type.prototype.pattern = /.*/;
      Type.prototype.toString = function() {
        return "{Type:" + this.name + "}";
      };
      Type.prototype.$normalize = function(val) {
        return this.is(val) ? val : this.decode(val);
      };
      Type.prototype.$asArray = function(mode, isSearch) {
        if (!mode)
          return this;
        if (mode === "auto" && !isSearch)
          throw new Error("'auto' array mode is for query parameters only");
        function ArrayType(type, mode) {
          function bindTo(type, callbackName) {
            return function() {
              return type[callbackName].apply(type, arguments);
            };
          }
          function arrayWrap(val) {
            return isArray(val) ? val : (isDefined(val) ? [val] : []);
          }
          function arrayUnwrap(val) {
            switch (val.length) {
              case 0:
                return undefined;
              case 1:
                return mode === "auto" ? val[0] : val;
              default:
                return val;
            }
          }
          function falsey(val) {
            return !val;
          }
          function arrayHandler(callback, allTruthyMode) {
            return function handleArray(val) {
              val = arrayWrap(val);
              var result = map(val, callback);
              if (allTruthyMode === true)
                return filter(result, falsey).length === 0;
              return arrayUnwrap(result);
            };
          }
          function arrayEqualsHandler(callback) {
            return function handleArray(val1, val2) {
              var left = arrayWrap(val1),
                  right = arrayWrap(val2);
              if (left.length !== right.length)
                return false;
              for (var i = 0; i < left.length; i++) {
                if (!callback(left[i], right[i]))
                  return false;
              }
              return true;
            };
          }
          this.encode = arrayHandler(bindTo(type, 'encode'));
          this.decode = arrayHandler(bindTo(type, 'decode'));
          this.is = arrayHandler(bindTo(type, 'is'), true);
          this.equals = arrayEqualsHandler(bindTo(type, 'equals'));
          this.pattern = type.pattern;
          this.$normalize = arrayHandler(bindTo(type, '$normalize'));
          this.name = type.name;
          this.$arrayMode = mode;
        }
        return new ArrayType(this, mode);
      };
      function $UrlMatcherFactory() {
        $$UMFP = this;
        var isCaseInsensitive = false,
            isStrictMode = true,
            defaultSquashPolicy = false;
        function valToString(val) {
          return val != null ? val.toString().replace(/\//g, "%2F") : val;
        }
        function valFromString(val) {
          return val != null ? val.toString().replace(/%2F/g, "/") : val;
        }
        var $types = {},
            enqueue = true,
            typeQueue = [],
            injector,
            defaultTypes = {
              string: {
                encode: valToString,
                decode: valFromString,
                is: function(val) {
                  return val == null || !isDefined(val) || typeof val === "string";
                },
                pattern: /[^/]*/
              },
              int: {
                encode: valToString,
                decode: function(val) {
                  return parseInt(val, 10);
                },
                is: function(val) {
                  return isDefined(val) && this.decode(val.toString()) === val;
                },
                pattern: /\d+/
              },
              bool: {
                encode: function(val) {
                  return val ? 1 : 0;
                },
                decode: function(val) {
                  return parseInt(val, 10) !== 0;
                },
                is: function(val) {
                  return val === true || val === false;
                },
                pattern: /0|1/
              },
              date: {
                encode: function(val) {
                  if (!this.is(val))
                    return undefined;
                  return [val.getFullYear(), ('0' + (val.getMonth() + 1)).slice(-2), ('0' + val.getDate()).slice(-2)].join("-");
                },
                decode: function(val) {
                  if (this.is(val))
                    return val;
                  var match = this.capture.exec(val);
                  return match ? new Date(match[1], match[2] - 1, match[3]) : undefined;
                },
                is: function(val) {
                  return val instanceof Date && !isNaN(val.valueOf());
                },
                equals: function(a, b) {
                  return this.is(a) && this.is(b) && a.toISOString() === b.toISOString();
                },
                pattern: /[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[1-2][0-9]|3[0-1])/,
                capture: /([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])/
              },
              json: {
                encode: angular.toJson,
                decode: angular.fromJson,
                is: angular.isObject,
                equals: angular.equals,
                pattern: /[^/]*/
              },
              any: {
                encode: angular.identity,
                decode: angular.identity,
                equals: angular.equals,
                pattern: /.*/
              }
            };
        function getDefaultConfig() {
          return {
            strict: isStrictMode,
            caseInsensitive: isCaseInsensitive
          };
        }
        function isInjectable(value) {
          return (isFunction(value) || (isArray(value) && isFunction(value[value.length - 1])));
        }
        $UrlMatcherFactory.$$getDefaultValue = function(config) {
          if (!isInjectable(config.value))
            return config.value;
          if (!injector)
            throw new Error("Injectable functions cannot be called at configuration time");
          return injector.invoke(config.value);
        };
        this.caseInsensitive = function(value) {
          if (isDefined(value))
            isCaseInsensitive = value;
          return isCaseInsensitive;
        };
        this.strictMode = function(value) {
          if (isDefined(value))
            isStrictMode = value;
          return isStrictMode;
        };
        this.defaultSquashPolicy = function(value) {
          if (!isDefined(value))
            return defaultSquashPolicy;
          if (value !== true && value !== false && !isString(value))
            throw new Error("Invalid squash policy: " + value + ". Valid policies: false, true, arbitrary-string");
          defaultSquashPolicy = value;
          return value;
        };
        this.compile = function(pattern, config) {
          return new UrlMatcher(pattern, extend(getDefaultConfig(), config));
        };
        this.isMatcher = function(o) {
          if (!isObject(o))
            return false;
          var result = true;
          forEach(UrlMatcher.prototype, function(val, name) {
            if (isFunction(val)) {
              result = result && (isDefined(o[name]) && isFunction(o[name]));
            }
          });
          return result;
        };
        this.type = function(name, definition, definitionFn) {
          if (!isDefined(definition))
            return $types[name];
          if ($types.hasOwnProperty(name))
            throw new Error("A type named '" + name + "' has already been defined.");
          $types[name] = new Type(extend({name: name}, definition));
          if (definitionFn) {
            typeQueue.push({
              name: name,
              def: definitionFn
            });
            if (!enqueue)
              flushTypeQueue();
          }
          return this;
        };
        function flushTypeQueue() {
          while (typeQueue.length) {
            var type = typeQueue.shift();
            if (type.pattern)
              throw new Error("You cannot override a type's .pattern at runtime.");
            angular.extend($types[type.name], injector.invoke(type.def));
          }
        }
        forEach(defaultTypes, function(type, name) {
          $types[name] = new Type(extend({name: name}, type));
        });
        $types = inherit($types, {});
        this.$get = ['$injector', function($injector) {
          injector = $injector;
          enqueue = false;
          flushTypeQueue();
          forEach(defaultTypes, function(type, name) {
            if (!$types[name])
              $types[name] = new Type(type);
          });
          return this;
        }];
        this.Param = function Param(id, type, config, location) {
          var self = this;
          config = unwrapShorthand(config);
          type = getType(config, type, location);
          var arrayMode = getArrayMode();
          type = arrayMode ? type.$asArray(arrayMode, location === "search") : type;
          if (type.name === "string" && !arrayMode && location === "path" && config.value === undefined)
            config.value = "";
          var isOptional = config.value !== undefined;
          var squash = getSquashPolicy(config, isOptional);
          var replace = getReplace(config, arrayMode, isOptional, squash);
          function unwrapShorthand(config) {
            var keys = isObject(config) ? objectKeys(config) : [];
            var isShorthand = indexOf(keys, "value") === -1 && indexOf(keys, "type") === -1 && indexOf(keys, "squash") === -1 && indexOf(keys, "array") === -1;
            if (isShorthand)
              config = {value: config};
            config.$$fn = isInjectable(config.value) ? config.value : function() {
              return config.value;
            };
            return config;
          }
          function getType(config, urlType, location) {
            if (config.type && urlType)
              throw new Error("Param '" + id + "' has two type configurations.");
            if (urlType)
              return urlType;
            if (!config.type)
              return (location === "config" ? $types.any : $types.string);
            return config.type instanceof Type ? config.type : new Type(config.type);
          }
          function getArrayMode() {
            var arrayDefaults = {array: (location === "search" ? "auto" : false)};
            var arrayParamNomenclature = id.match(/\[\]$/) ? {array: true} : {};
            return extend(arrayDefaults, arrayParamNomenclature, config).array;
          }
          function getSquashPolicy(config, isOptional) {
            var squash = config.squash;
            if (!isOptional || squash === false)
              return false;
            if (!isDefined(squash) || squash == null)
              return defaultSquashPolicy;
            if (squash === true || isString(squash))
              return squash;
            throw new Error("Invalid squash policy: '" + squash + "'. Valid policies: false, true, or arbitrary string");
          }
          function getReplace(config, arrayMode, isOptional, squash) {
            var replace,
                configuredKeys,
                defaultPolicy = [{
                  from: "",
                  to: (isOptional || arrayMode ? undefined : "")
                }, {
                  from: null,
                  to: (isOptional || arrayMode ? undefined : "")
                }];
            replace = isArray(config.replace) ? config.replace : [];
            if (isString(squash))
              replace.push({
                from: squash,
                to: undefined
              });
            configuredKeys = map(replace, function(item) {
              return item.from;
            });
            return filter(defaultPolicy, function(item) {
              return indexOf(configuredKeys, item.from) === -1;
            }).concat(replace);
          }
          function $$getDefaultValue() {
            if (!injector)
              throw new Error("Injectable functions cannot be called at configuration time");
            var defaultValue = injector.invoke(config.$$fn);
            if (defaultValue !== null && defaultValue !== undefined && !self.type.is(defaultValue))
              throw new Error("Default value (" + defaultValue + ") for parameter '" + self.id + "' is not an instance of Type (" + self.type.name + ")");
            return defaultValue;
          }
          function $value(value) {
            function hasReplaceVal(val) {
              return function(obj) {
                return obj.from === val;
              };
            }
            function $replace(value) {
              var replacement = map(filter(self.replace, hasReplaceVal(value)), function(obj) {
                return obj.to;
              });
              return replacement.length ? replacement[0] : value;
            }
            value = $replace(value);
            return !isDefined(value) ? $$getDefaultValue() : self.type.$normalize(value);
          }
          function toString() {
            return "{Param:" + id + " " + type + " squash: '" + squash + "' optional: " + isOptional + "}";
          }
          extend(this, {
            id: id,
            type: type,
            location: location,
            array: arrayMode,
            squash: squash,
            replace: replace,
            isOptional: isOptional,
            value: $value,
            dynamic: undefined,
            config: config,
            toString: toString
          });
        };
        function ParamSet(params) {
          extend(this, params || {});
        }
        ParamSet.prototype = {
          $$new: function() {
            return inherit(this, extend(new ParamSet(), {$$parent: this}));
          },
          $$keys: function() {
            var keys = [],
                chain = [],
                parent = this,
                ignore = objectKeys(ParamSet.prototype);
            while (parent) {
              chain.push(parent);
              parent = parent.$$parent;
            }
            chain.reverse();
            forEach(chain, function(paramset) {
              forEach(objectKeys(paramset), function(key) {
                if (indexOf(keys, key) === -1 && indexOf(ignore, key) === -1)
                  keys.push(key);
              });
            });
            return keys;
          },
          $$values: function(paramValues) {
            var values = {},
                self = this;
            forEach(self.$$keys(), function(key) {
              values[key] = self[key].value(paramValues && paramValues[key]);
            });
            return values;
          },
          $$equals: function(paramValues1, paramValues2) {
            var equal = true,
                self = this;
            forEach(self.$$keys(), function(key) {
              var left = paramValues1 && paramValues1[key],
                  right = paramValues2 && paramValues2[key];
              if (!self[key].type.equals(left, right))
                equal = false;
            });
            return equal;
          },
          $$validates: function $$validate(paramValues) {
            var keys = this.$$keys(),
                i,
                param,
                rawVal,
                normalized,
                encoded;
            for (i = 0; i < keys.length; i++) {
              param = this[keys[i]];
              rawVal = paramValues[keys[i]];
              if ((rawVal === undefined || rawVal === null) && param.isOptional)
                break;
              normalized = param.type.$normalize(rawVal);
              if (!param.type.is(normalized))
                return false;
              encoded = param.type.encode(normalized);
              if (angular.isString(encoded) && !param.type.pattern.exec(encoded))
                return false;
            }
            return true;
          },
          $$parent: undefined
        };
        this.ParamSet = ParamSet;
      }
      angular.module('ui.router.util').provider('$urlMatcherFactory', $UrlMatcherFactory);
      angular.module('ui.router.util').run(['$urlMatcherFactory', function($urlMatcherFactory) {}]);
      $UrlRouterProvider.$inject = ['$locationProvider', '$urlMatcherFactoryProvider'];
      function $UrlRouterProvider($locationProvider, $urlMatcherFactory) {
        var rules = [],
            otherwise = null,
            interceptDeferred = false,
            listener;
        function regExpPrefix(re) {
          var prefix = /^\^((?:\\[^a-zA-Z0-9]|[^\\\[\]\^$*+?.()|{}]+)*)/.exec(re.source);
          return (prefix != null) ? prefix[1].replace(/\\(.)/g, "$1") : '';
        }
        function interpolate(pattern, match) {
          return pattern.replace(/\$(\$|\d{1,2})/, function(m, what) {
            return match[what === '$' ? 0 : Number(what)];
          });
        }
        this.rule = function(rule) {
          if (!isFunction(rule))
            throw new Error("'rule' must be a function");
          rules.push(rule);
          return this;
        };
        this.otherwise = function(rule) {
          if (isString(rule)) {
            var redirect = rule;
            rule = function() {
              return redirect;
            };
          } else if (!isFunction(rule))
            throw new Error("'rule' must be a function");
          otherwise = rule;
          return this;
        };
        function handleIfMatch($injector, handler, match) {
          if (!match)
            return false;
          var result = $injector.invoke(handler, handler, {$match: match});
          return isDefined(result) ? result : true;
        }
        this.when = function(what, handler) {
          var redirect,
              handlerIsString = isString(handler);
          if (isString(what))
            what = $urlMatcherFactory.compile(what);
          if (!handlerIsString && !isFunction(handler) && !isArray(handler))
            throw new Error("invalid 'handler' in when()");
          var strategies = {
            matcher: function(what, handler) {
              if (handlerIsString) {
                redirect = $urlMatcherFactory.compile(handler);
                handler = ['$match', function($match) {
                  return redirect.format($match);
                }];
              }
              return extend(function($injector, $location) {
                return handleIfMatch($injector, handler, what.exec($location.path(), $location.search()));
              }, {prefix: isString(what.prefix) ? what.prefix : ''});
            },
            regex: function(what, handler) {
              if (what.global || what.sticky)
                throw new Error("when() RegExp must not be global or sticky");
              if (handlerIsString) {
                redirect = handler;
                handler = ['$match', function($match) {
                  return interpolate(redirect, $match);
                }];
              }
              return extend(function($injector, $location) {
                return handleIfMatch($injector, handler, what.exec($location.path()));
              }, {prefix: regExpPrefix(what)});
            }
          };
          var check = {
            matcher: $urlMatcherFactory.isMatcher(what),
            regex: what instanceof RegExp
          };
          for (var n in check) {
            if (check[n])
              return this.rule(strategies[n](what, handler));
          }
          throw new Error("invalid 'what' in when()");
        };
        this.deferIntercept = function(defer) {
          if (defer === undefined)
            defer = true;
          interceptDeferred = defer;
        };
        this.$get = $get;
        $get.$inject = ['$location', '$rootScope', '$injector', '$browser'];
        function $get($location, $rootScope, $injector, $browser) {
          var baseHref = $browser.baseHref(),
              location = $location.url(),
              lastPushedUrl;
          function appendBasePath(url, isHtml5, absolute) {
            if (baseHref === '/')
              return url;
            if (isHtml5)
              return baseHref.slice(0, -1) + url;
            if (absolute)
              return baseHref.slice(1) + url;
            return url;
          }
          function update(evt) {
            if (evt && evt.defaultPrevented)
              return;
            var ignoreUpdate = lastPushedUrl && $location.url() === lastPushedUrl;
            lastPushedUrl = undefined;
            function check(rule) {
              var handled = rule($injector, $location);
              if (!handled)
                return false;
              if (isString(handled))
                $location.replace().url(handled);
              return true;
            }
            var n = rules.length,
                i;
            for (i = 0; i < n; i++) {
              if (check(rules[i]))
                return;
            }
            if (otherwise)
              check(otherwise);
          }
          function listen() {
            listener = listener || $rootScope.$on('$locationChangeSuccess', update);
            return listener;
          }
          if (!interceptDeferred)
            listen();
          return {
            sync: function() {
              update();
            },
            listen: function() {
              return listen();
            },
            update: function(read) {
              if (read) {
                location = $location.url();
                return;
              }
              if ($location.url() === location)
                return;
              $location.url(location);
              $location.replace();
            },
            push: function(urlMatcher, params, options) {
              var url = urlMatcher.format(params || {});
              if (url !== null && params && params['#']) {
                url += '#' + params['#'];
              }
              $location.url(url);
              lastPushedUrl = options && options.$$avoidResync ? $location.url() : undefined;
              if (options && options.replace)
                $location.replace();
            },
            href: function(urlMatcher, params, options) {
              if (!urlMatcher.validates(params))
                return null;
              var isHtml5 = $locationProvider.html5Mode();
              if (angular.isObject(isHtml5)) {
                isHtml5 = isHtml5.enabled;
              }
              var url = urlMatcher.format(params);
              options = options || {};
              if (!isHtml5 && url !== null) {
                url = "#" + $locationProvider.hashPrefix() + url;
              }
              if (url !== null && params && params['#']) {
                url += '#' + params['#'];
              }
              url = appendBasePath(url, isHtml5, options.absolute);
              if (!options.absolute || !url) {
                return url;
              }
              var slash = (!isHtml5 && url ? '/' : ''),
                  port = $location.port();
              port = (port === 80 || port === 443 ? '' : ':' + port);
              return [$location.protocol(), '://', $location.host(), port, slash, url].join('');
            }
          };
        }
      }
      angular.module('ui.router.router').provider('$urlRouter', $UrlRouterProvider);
      $StateProvider.$inject = ['$urlRouterProvider', '$urlMatcherFactoryProvider'];
      function $StateProvider($urlRouterProvider, $urlMatcherFactory) {
        var root,
            states = {},
            $state,
            queue = {},
            abstractKey = 'abstract';
        var stateBuilder = {
          parent: function(state) {
            if (isDefined(state.parent) && state.parent)
              return findState(state.parent);
            var compositeName = /^(.+)\.[^.]+$/.exec(state.name);
            return compositeName ? findState(compositeName[1]) : root;
          },
          data: function(state) {
            if (state.parent && state.parent.data) {
              state.data = state.self.data = extend({}, state.parent.data, state.data);
            }
            return state.data;
          },
          url: function(state) {
            var url = state.url,
                config = {params: state.params || {}};
            if (isString(url)) {
              if (url.charAt(0) == '^')
                return $urlMatcherFactory.compile(url.substring(1), config);
              return (state.parent.navigable || root).url.concat(url, config);
            }
            if (!url || $urlMatcherFactory.isMatcher(url))
              return url;
            throw new Error("Invalid url '" + url + "' in state '" + state + "'");
          },
          navigable: function(state) {
            return state.url ? state : (state.parent ? state.parent.navigable : null);
          },
          ownParams: function(state) {
            var params = state.url && state.url.params || new $$UMFP.ParamSet();
            forEach(state.params || {}, function(config, id) {
              if (!params[id])
                params[id] = new $$UMFP.Param(id, null, config, "config");
            });
            return params;
          },
          params: function(state) {
            return state.parent && state.parent.params ? extend(state.parent.params.$$new(), state.ownParams) : new $$UMFP.ParamSet();
          },
          views: function(state) {
            var views = {};
            forEach(isDefined(state.views) ? state.views : {'': state}, function(view, name) {
              if (name.indexOf('@') < 0)
                name += '@' + state.parent.name;
              views[name] = view;
            });
            return views;
          },
          path: function(state) {
            return state.parent ? state.parent.path.concat(state) : [];
          },
          includes: function(state) {
            var includes = state.parent ? extend({}, state.parent.includes) : {};
            includes[state.name] = true;
            return includes;
          },
          $delegates: {}
        };
        function isRelative(stateName) {
          return stateName.indexOf(".") === 0 || stateName.indexOf("^") === 0;
        }
        function findState(stateOrName, base) {
          if (!stateOrName)
            return undefined;
          var isStr = isString(stateOrName),
              name = isStr ? stateOrName : stateOrName.name,
              path = isRelative(name);
          if (path) {
            if (!base)
              throw new Error("No reference point given for path '" + name + "'");
            base = findState(base);
            var rel = name.split("."),
                i = 0,
                pathLength = rel.length,
                current = base;
            for (; i < pathLength; i++) {
              if (rel[i] === "" && i === 0) {
                current = base;
                continue;
              }
              if (rel[i] === "^") {
                if (!current.parent)
                  throw new Error("Path '" + name + "' not valid for state '" + base.name + "'");
                current = current.parent;
                continue;
              }
              break;
            }
            rel = rel.slice(i).join(".");
            name = current.name + (current.name && rel ? "." : "") + rel;
          }
          var state = states[name];
          if (state && (isStr || (!isStr && (state === stateOrName || state.self === stateOrName)))) {
            return state;
          }
          return undefined;
        }
        function queueState(parentName, state) {
          if (!queue[parentName]) {
            queue[parentName] = [];
          }
          queue[parentName].push(state);
        }
        function flushQueuedChildren(parentName) {
          var queued = queue[parentName] || [];
          while (queued.length) {
            registerState(queued.shift());
          }
        }
        function registerState(state) {
          state = inherit(state, {
            self: state,
            resolve: state.resolve || {},
            toString: function() {
              return this.name;
            }
          });
          var name = state.name;
          if (!isString(name) || name.indexOf('@') >= 0)
            throw new Error("State must have a valid name");
          if (states.hasOwnProperty(name))
            throw new Error("State '" + name + "'' is already defined");
          var parentName = (name.indexOf('.') !== -1) ? name.substring(0, name.lastIndexOf('.')) : (isString(state.parent)) ? state.parent : (isObject(state.parent) && isString(state.parent.name)) ? state.parent.name : '';
          if (parentName && !states[parentName]) {
            return queueState(parentName, state.self);
          }
          for (var key in stateBuilder) {
            if (isFunction(stateBuilder[key]))
              state[key] = stateBuilder[key](state, stateBuilder.$delegates[key]);
          }
          states[name] = state;
          if (!state[abstractKey] && state.url) {
            $urlRouterProvider.when(state.url, ['$match', '$stateParams', function($match, $stateParams) {
              if ($state.$current.navigable != state || !equalForKeys($match, $stateParams)) {
                $state.transitionTo(state, $match, {
                  inherit: true,
                  location: false
                });
              }
            }]);
          }
          flushQueuedChildren(name);
          return state;
        }
        function isGlob(text) {
          return text.indexOf('*') > -1;
        }
        function doesStateMatchGlob(glob) {
          var globSegments = glob.split('.'),
              segments = $state.$current.name.split('.');
          for (var i = 0,
              l = globSegments.length; i < l; i++) {
            if (globSegments[i] === '*') {
              segments[i] = '*';
            }
          }
          if (globSegments[0] === '**') {
            segments = segments.slice(indexOf(segments, globSegments[1]));
            segments.unshift('**');
          }
          if (globSegments[globSegments.length - 1] === '**') {
            segments.splice(indexOf(segments, globSegments[globSegments.length - 2]) + 1, Number.MAX_VALUE);
            segments.push('**');
          }
          if (globSegments.length != segments.length) {
            return false;
          }
          return segments.join('') === globSegments.join('');
        }
        root = registerState({
          name: '',
          url: '^',
          views: null,
          'abstract': true
        });
        root.navigable = null;
        this.decorator = decorator;
        function decorator(name, func) {
          if (isString(name) && !isDefined(func)) {
            return stateBuilder[name];
          }
          if (!isFunction(func) || !isString(name)) {
            return this;
          }
          if (stateBuilder[name] && !stateBuilder.$delegates[name]) {
            stateBuilder.$delegates[name] = stateBuilder[name];
          }
          stateBuilder[name] = func;
          return this;
        }
        this.state = state;
        function state(name, definition) {
          if (isObject(name))
            definition = name;
          else
            definition.name = name;
          registerState(definition);
          return this;
        }
        this.$get = $get;
        $get.$inject = ['$rootScope', '$q', '$view', '$injector', '$resolve', '$stateParams', '$urlRouter', '$location', '$urlMatcherFactory'];
        function $get($rootScope, $q, $view, $injector, $resolve, $stateParams, $urlRouter, $location, $urlMatcherFactory) {
          var TransitionSuperseded = $q.reject(new Error('transition superseded'));
          var TransitionPrevented = $q.reject(new Error('transition prevented'));
          var TransitionAborted = $q.reject(new Error('transition aborted'));
          var TransitionFailed = $q.reject(new Error('transition failed'));
          function handleRedirect(redirect, state, params, options) {
            var evt = $rootScope.$broadcast('$stateNotFound', redirect, state, params);
            if (evt.defaultPrevented) {
              $urlRouter.update();
              return TransitionAborted;
            }
            if (!evt.retry) {
              return null;
            }
            if (options.$retry) {
              $urlRouter.update();
              return TransitionFailed;
            }
            var retryTransition = $state.transition = $q.when(evt.retry);
            retryTransition.then(function() {
              if (retryTransition !== $state.transition)
                return TransitionSuperseded;
              redirect.options.$retry = true;
              return $state.transitionTo(redirect.to, redirect.toParams, redirect.options);
            }, function() {
              return TransitionAborted;
            });
            $urlRouter.update();
            return retryTransition;
          }
          root.locals = {
            resolve: null,
            globals: {$stateParams: {}}
          };
          $state = {
            params: {},
            current: root.self,
            $current: root,
            transition: null
          };
          $state.reload = function reload(state) {
            return $state.transitionTo($state.current, $stateParams, {
              reload: state || true,
              inherit: false,
              notify: true
            });
          };
          $state.go = function go(to, params, options) {
            return $state.transitionTo(to, params, extend({
              inherit: true,
              relative: $state.$current
            }, options));
          };
          $state.transitionTo = function transitionTo(to, toParams, options) {
            toParams = toParams || {};
            options = extend({
              location: true,
              inherit: false,
              relative: null,
              notify: true,
              reload: false,
              $retry: false
            }, options || {});
            var from = $state.$current,
                fromParams = $state.params,
                fromPath = from.path;
            var evt,
                toState = findState(to, options.relative);
            var hash = toParams['#'];
            if (!isDefined(toState)) {
              var redirect = {
                to: to,
                toParams: toParams,
                options: options
              };
              var redirectResult = handleRedirect(redirect, from.self, fromParams, options);
              if (redirectResult) {
                return redirectResult;
              }
              to = redirect.to;
              toParams = redirect.toParams;
              options = redirect.options;
              toState = findState(to, options.relative);
              if (!isDefined(toState)) {
                if (!options.relative)
                  throw new Error("No such state '" + to + "'");
                throw new Error("Could not resolve '" + to + "' from state '" + options.relative + "'");
              }
            }
            if (toState[abstractKey])
              throw new Error("Cannot transition to abstract state '" + to + "'");
            if (options.inherit)
              toParams = inheritParams($stateParams, toParams || {}, $state.$current, toState);
            if (!toState.params.$$validates(toParams))
              return TransitionFailed;
            toParams = toState.params.$$values(toParams);
            to = toState;
            var toPath = to.path;
            var keep = 0,
                state = toPath[keep],
                locals = root.locals,
                toLocals = [];
            if (!options.reload) {
              while (state && state === fromPath[keep] && state.ownParams.$$equals(toParams, fromParams)) {
                locals = toLocals[keep] = state.locals;
                keep++;
                state = toPath[keep];
              }
            } else if (isString(options.reload) || isObject(options.reload)) {
              if (isObject(options.reload) && !options.reload.name) {
                throw new Error('Invalid reload state object');
              }
              var reloadState = options.reload === true ? fromPath[0] : findState(options.reload);
              if (options.reload && !reloadState) {
                throw new Error("No such reload state '" + (isString(options.reload) ? options.reload : options.reload.name) + "'");
              }
              while (state && state === fromPath[keep] && state !== reloadState) {
                locals = toLocals[keep] = state.locals;
                keep++;
                state = toPath[keep];
              }
            }
            if (shouldSkipReload(to, toParams, from, fromParams, locals, options)) {
              if (hash)
                toParams['#'] = hash;
              $state.params = toParams;
              copy($state.params, $stateParams);
              if (options.location && to.navigable && to.navigable.url) {
                $urlRouter.push(to.navigable.url, toParams, {
                  $$avoidResync: true,
                  replace: options.location === 'replace'
                });
                $urlRouter.update(true);
              }
              $state.transition = null;
              return $q.when($state.current);
            }
            toParams = filterByKeys(to.params.$$keys(), toParams || {});
            if (options.notify) {
              if ($rootScope.$broadcast('$stateChangeStart', to.self, toParams, from.self, fromParams).defaultPrevented) {
                $rootScope.$broadcast('$stateChangeCancel', to.self, toParams, from.self, fromParams);
                $urlRouter.update();
                return TransitionPrevented;
              }
            }
            var resolved = $q.when(locals);
            for (var l = keep; l < toPath.length; l++, state = toPath[l]) {
              locals = toLocals[l] = inherit(locals);
              resolved = resolveState(state, toParams, state === to, resolved, locals, options);
            }
            var transition = $state.transition = resolved.then(function() {
              var l,
                  entering,
                  exiting;
              if ($state.transition !== transition)
                return TransitionSuperseded;
              for (l = fromPath.length - 1; l >= keep; l--) {
                exiting = fromPath[l];
                if (exiting.self.onExit) {
                  $injector.invoke(exiting.self.onExit, exiting.self, exiting.locals.globals);
                }
                exiting.locals = null;
              }
              for (l = keep; l < toPath.length; l++) {
                entering = toPath[l];
                entering.locals = toLocals[l];
                if (entering.self.onEnter) {
                  $injector.invoke(entering.self.onEnter, entering.self, entering.locals.globals);
                }
              }
              if (hash)
                toParams['#'] = hash;
              if ($state.transition !== transition)
                return TransitionSuperseded;
              $state.$current = to;
              $state.current = to.self;
              $state.params = toParams;
              copy($state.params, $stateParams);
              $state.transition = null;
              if (options.location && to.navigable) {
                $urlRouter.push(to.navigable.url, to.navigable.locals.globals.$stateParams, {
                  $$avoidResync: true,
                  replace: options.location === 'replace'
                });
              }
              if (options.notify) {
                $rootScope.$broadcast('$stateChangeSuccess', to.self, toParams, from.self, fromParams);
              }
              $urlRouter.update(true);
              return $state.current;
            }, function(error) {
              if ($state.transition !== transition)
                return TransitionSuperseded;
              $state.transition = null;
              evt = $rootScope.$broadcast('$stateChangeError', to.self, toParams, from.self, fromParams, error);
              if (!evt.defaultPrevented) {
                $urlRouter.update();
              }
              return $q.reject(error);
            });
            return transition;
          };
          $state.is = function is(stateOrName, params, options) {
            options = extend({relative: $state.$current}, options || {});
            var state = findState(stateOrName, options.relative);
            if (!isDefined(state)) {
              return undefined;
            }
            if ($state.$current !== state) {
              return false;
            }
            return params ? equalForKeys(state.params.$$values(params), $stateParams) : true;
          };
          $state.includes = function includes(stateOrName, params, options) {
            options = extend({relative: $state.$current}, options || {});
            if (isString(stateOrName) && isGlob(stateOrName)) {
              if (!doesStateMatchGlob(stateOrName)) {
                return false;
              }
              stateOrName = $state.$current.name;
            }
            var state = findState(stateOrName, options.relative);
            if (!isDefined(state)) {
              return undefined;
            }
            if (!isDefined($state.$current.includes[state.name])) {
              return false;
            }
            return params ? equalForKeys(state.params.$$values(params), $stateParams, objectKeys(params)) : true;
          };
          $state.href = function href(stateOrName, params, options) {
            options = extend({
              lossy: true,
              inherit: true,
              absolute: false,
              relative: $state.$current
            }, options || {});
            var state = findState(stateOrName, options.relative);
            if (!isDefined(state))
              return null;
            if (options.inherit)
              params = inheritParams($stateParams, params || {}, $state.$current, state);
            var nav = (state && options.lossy) ? state.navigable : state;
            if (!nav || nav.url === undefined || nav.url === null) {
              return null;
            }
            return $urlRouter.href(nav.url, filterByKeys(state.params.$$keys().concat('#'), params || {}), {absolute: options.absolute});
          };
          $state.get = function(stateOrName, context) {
            if (arguments.length === 0)
              return map(objectKeys(states), function(name) {
                return states[name].self;
              });
            var state = findState(stateOrName, context || $state.$current);
            return (state && state.self) ? state.self : null;
          };
          function resolveState(state, params, paramsAreFiltered, inherited, dst, options) {
            var $stateParams = (paramsAreFiltered) ? params : filterByKeys(state.params.$$keys(), params);
            var locals = {$stateParams: $stateParams};
            dst.resolve = $resolve.resolve(state.resolve, locals, dst.resolve, state);
            var promises = [dst.resolve.then(function(globals) {
              dst.globals = globals;
            })];
            if (inherited)
              promises.push(inherited);
            function resolveViews() {
              var viewsPromises = [];
              forEach(state.views, function(view, name) {
                var injectables = (view.resolve && view.resolve !== state.resolve ? view.resolve : {});
                injectables.$template = [function() {
                  return $view.load(name, {
                    view: view,
                    locals: dst.globals,
                    params: $stateParams,
                    notify: options.notify
                  }) || '';
                }];
                viewsPromises.push($resolve.resolve(injectables, dst.globals, dst.resolve, state).then(function(result) {
                  if (isFunction(view.controllerProvider) || isArray(view.controllerProvider)) {
                    var injectLocals = angular.extend({}, injectables, dst.globals);
                    result.$$controller = $injector.invoke(view.controllerProvider, null, injectLocals);
                  } else {
                    result.$$controller = view.controller;
                  }
                  result.$$state = state;
                  result.$$controllerAs = view.controllerAs;
                  dst[name] = result;
                }));
              });
              return $q.all(viewsPromises).then(function() {
                return dst.globals;
              });
            }
            return $q.all(promises).then(resolveViews).then(function(values) {
              return dst;
            });
          }
          return $state;
        }
        function shouldSkipReload(to, toParams, from, fromParams, locals, options) {
          function nonSearchParamsEqual(fromAndToState, fromParams, toParams) {
            function notSearchParam(key) {
              return fromAndToState.params[key].location != "search";
            }
            var nonQueryParamKeys = fromAndToState.params.$$keys().filter(notSearchParam);
            var nonQueryParams = pick.apply({}, [fromAndToState.params].concat(nonQueryParamKeys));
            var nonQueryParamSet = new $$UMFP.ParamSet(nonQueryParams);
            return nonQueryParamSet.$$equals(fromParams, toParams);
          }
          if (!options.reload && to === from && (locals === from.locals || (to.self.reloadOnSearch === false && nonSearchParamsEqual(from, fromParams, toParams)))) {
            return true;
          }
        }
      }
      angular.module('ui.router.state').value('$stateParams', {}).provider('$state', $StateProvider);
      $ViewProvider.$inject = [];
      function $ViewProvider() {
        this.$get = $get;
        $get.$inject = ['$rootScope', '$templateFactory'];
        function $get($rootScope, $templateFactory) {
          return {load: function load(name, options) {
              var result,
                  defaults = {
                    template: null,
                    controller: null,
                    view: null,
                    locals: null,
                    notify: true,
                    async: true,
                    params: {}
                  };
              options = extend(defaults, options);
              if (options.view) {
                result = $templateFactory.fromConfig(options.view, options.params, options.locals);
              }
              if (result && options.notify) {
                $rootScope.$broadcast('$viewContentLoading', options);
              }
              return result;
            }};
        }
      }
      angular.module('ui.router.state').provider('$view', $ViewProvider);
      function $ViewScrollProvider() {
        var useAnchorScroll = false;
        this.useAnchorScroll = function() {
          useAnchorScroll = true;
        };
        this.$get = ['$anchorScroll', '$timeout', function($anchorScroll, $timeout) {
          if (useAnchorScroll) {
            return $anchorScroll;
          }
          return function($element) {
            return $timeout(function() {
              $element[0].scrollIntoView();
            }, 0, false);
          };
        }];
      }
      angular.module('ui.router.state').provider('$uiViewScroll', $ViewScrollProvider);
      $ViewDirective.$inject = ['$state', '$injector', '$uiViewScroll', '$interpolate'];
      function $ViewDirective($state, $injector, $uiViewScroll, $interpolate) {
        function getService() {
          return ($injector.has) ? function(service) {
            return $injector.has(service) ? $injector.get(service) : null;
          } : function(service) {
            try {
              return $injector.get(service);
            } catch (e) {
              return null;
            }
          };
        }
        var service = getService(),
            $animator = service('$animator'),
            $animate = service('$animate');
        function getRenderer(attrs, scope) {
          var statics = function() {
            return {
              enter: function(element, target, cb) {
                target.after(element);
                cb();
              },
              leave: function(element, cb) {
                element.remove();
                cb();
              }
            };
          };
          if ($animate) {
            return {
              enter: function(element, target, cb) {
                var promise = $animate.enter(element, null, target, cb);
                if (promise && promise.then)
                  promise.then(cb);
              },
              leave: function(element, cb) {
                var promise = $animate.leave(element, cb);
                if (promise && promise.then)
                  promise.then(cb);
              }
            };
          }
          if ($animator) {
            var animate = $animator && $animator(scope, attrs);
            return {
              enter: function(element, target, cb) {
                animate.enter(element, null, target);
                cb();
              },
              leave: function(element, cb) {
                animate.leave(element);
                cb();
              }
            };
          }
          return statics();
        }
        var directive = {
          restrict: 'ECA',
          terminal: true,
          priority: 400,
          transclude: 'element',
          compile: function(tElement, tAttrs, $transclude) {
            return function(scope, $element, attrs) {
              var previousEl,
                  currentEl,
                  currentScope,
                  latestLocals,
                  onloadExp = attrs.onload || '',
                  autoScrollExp = attrs.autoscroll,
                  renderer = getRenderer(attrs, scope);
              scope.$on('$stateChangeSuccess', function() {
                updateView(false);
              });
              scope.$on('$viewContentLoading', function() {
                updateView(false);
              });
              updateView(true);
              function cleanupLastView() {
                if (previousEl) {
                  previousEl.remove();
                  previousEl = null;
                }
                if (currentScope) {
                  currentScope.$destroy();
                  currentScope = null;
                }
                if (currentEl) {
                  renderer.leave(currentEl, function() {
                    previousEl = null;
                  });
                  previousEl = currentEl;
                  currentEl = null;
                }
              }
              function updateView(firstTime) {
                var newScope,
                    name = getUiViewName(scope, attrs, $element, $interpolate),
                    previousLocals = name && $state.$current && $state.$current.locals[name];
                if (!firstTime && previousLocals === latestLocals)
                  return;
                newScope = scope.$new();
                latestLocals = $state.$current.locals[name];
                var clone = $transclude(newScope, function(clone) {
                  renderer.enter(clone, $element, function onUiViewEnter() {
                    if (currentScope) {
                      currentScope.$emit('$viewContentAnimationEnded');
                    }
                    if (angular.isDefined(autoScrollExp) && !autoScrollExp || scope.$eval(autoScrollExp)) {
                      $uiViewScroll(clone);
                    }
                  });
                  cleanupLastView();
                });
                currentEl = clone;
                currentScope = newScope;
                currentScope.$emit('$viewContentLoaded');
                currentScope.$eval(onloadExp);
              }
            };
          }
        };
        return directive;
      }
      $ViewDirectiveFill.$inject = ['$compile', '$controller', '$state', '$interpolate'];
      function $ViewDirectiveFill($compile, $controller, $state, $interpolate) {
        return {
          restrict: 'ECA',
          priority: -400,
          compile: function(tElement) {
            var initial = tElement.html();
            return function(scope, $element, attrs) {
              var current = $state.$current,
                  name = getUiViewName(scope, attrs, $element, $interpolate),
                  locals = current && current.locals[name];
              if (!locals) {
                return;
              }
              $element.data('$uiView', {
                name: name,
                state: locals.$$state
              });
              $element.html(locals.$template ? locals.$template : initial);
              var link = $compile($element.contents());
              if (locals.$$controller) {
                locals.$scope = scope;
                locals.$element = $element;
                var controller = $controller(locals.$$controller, locals);
                if (locals.$$controllerAs) {
                  scope[locals.$$controllerAs] = controller;
                }
                $element.data('$ngControllerController', controller);
                $element.children().data('$ngControllerController', controller);
              }
              link(scope);
            };
          }
        };
      }
      function getUiViewName(scope, attrs, element, $interpolate) {
        var name = $interpolate(attrs.uiView || attrs.name || '')(scope);
        var inherited = element.inheritedData('$uiView');
        return name.indexOf('@') >= 0 ? name : (name + '@' + (inherited ? inherited.state.name : ''));
      }
      angular.module('ui.router.state').directive('uiView', $ViewDirective);
      angular.module('ui.router.state').directive('uiView', $ViewDirectiveFill);
      function parseStateRef(ref, current) {
        var preparsed = ref.match(/^\s*({[^}]*})\s*$/),
            parsed;
        if (preparsed)
          ref = current + '(' + preparsed[1] + ')';
        parsed = ref.replace(/\n/g, " ").match(/^([^(]+?)\s*(\((.*)\))?$/);
        if (!parsed || parsed.length !== 4)
          throw new Error("Invalid state ref '" + ref + "'");
        return {
          state: parsed[1],
          paramExpr: parsed[3] || null
        };
      }
      function stateContext(el) {
        var stateData = el.parent().inheritedData('$uiView');
        if (stateData && stateData.state && stateData.state.name) {
          return stateData.state;
        }
      }
      $StateRefDirective.$inject = ['$state', '$timeout'];
      function $StateRefDirective($state, $timeout) {
        var allowedOptions = ['location', 'inherit', 'reload', 'absolute'];
        return {
          restrict: 'A',
          require: ['?^uiSrefActive', '?^uiSrefActiveEq'],
          link: function(scope, element, attrs, uiSrefActive) {
            var ref = parseStateRef(attrs.uiSref, $state.current.name);
            var params = null,
                url = null,
                base = stateContext(element) || $state.$current;
            var hrefKind = Object.prototype.toString.call(element.prop('href')) === '[object SVGAnimatedString]' ? 'xlink:href' : 'href';
            var newHref = null,
                isAnchor = element.prop("tagName").toUpperCase() === "A";
            var isForm = element[0].nodeName === "FORM";
            var attr = isForm ? "action" : hrefKind,
                nav = true;
            var options = {
              relative: base,
              inherit: true
            };
            var optionsOverride = scope.$eval(attrs.uiSrefOpts) || {};
            angular.forEach(allowedOptions, function(option) {
              if (option in optionsOverride) {
                options[option] = optionsOverride[option];
              }
            });
            var update = function(newVal) {
              if (newVal)
                params = angular.copy(newVal);
              if (!nav)
                return;
              newHref = $state.href(ref.state, params, options);
              var activeDirective = uiSrefActive[1] || uiSrefActive[0];
              if (activeDirective) {
                activeDirective.$$addStateInfo(ref.state, params);
              }
              if (newHref === null) {
                nav = false;
                return false;
              }
              attrs.$set(attr, newHref);
            };
            if (ref.paramExpr) {
              scope.$watch(ref.paramExpr, function(newVal, oldVal) {
                if (newVal !== params)
                  update(newVal);
              }, true);
              params = angular.copy(scope.$eval(ref.paramExpr));
            }
            update();
            if (isForm)
              return;
            element.bind("click", function(e) {
              var button = e.which || e.button;
              if (!(button > 1 || e.ctrlKey || e.metaKey || e.shiftKey || element.attr('target'))) {
                var transition = $timeout(function() {
                  $state.go(ref.state, params, options);
                });
                e.preventDefault();
                var ignorePreventDefaultCount = isAnchor && !newHref ? 1 : 0;
                e.preventDefault = function() {
                  if (ignorePreventDefaultCount-- <= 0)
                    $timeout.cancel(transition);
                };
              }
            });
          }
        };
      }
      $StateRefActiveDirective.$inject = ['$state', '$stateParams', '$interpolate'];
      function $StateRefActiveDirective($state, $stateParams, $interpolate) {
        return {
          restrict: "A",
          controller: ['$scope', '$element', '$attrs', function($scope, $element, $attrs) {
            var states = [],
                activeClass;
            activeClass = $interpolate($attrs.uiSrefActiveEq || $attrs.uiSrefActive || '', false)($scope);
            this.$$addStateInfo = function(newState, newParams) {
              var state = $state.get(newState, stateContext($element));
              states.push({
                state: state || {name: newState},
                params: newParams
              });
              update();
            };
            $scope.$on('$stateChangeSuccess', update);
            function update() {
              if (anyMatch()) {
                $element.addClass(activeClass);
              } else {
                $element.removeClass(activeClass);
              }
            }
            function anyMatch() {
              for (var i = 0; i < states.length; i++) {
                if (isMatch(states[i].state, states[i].params)) {
                  return true;
                }
              }
              return false;
            }
            function isMatch(state, params) {
              if (typeof $attrs.uiSrefActiveEq !== 'undefined') {
                return $state.is(state.name, params);
              } else {
                return $state.includes(state.name, params);
              }
            }
          }]
        };
      }
      angular.module('ui.router.state').directive('uiSref', $StateRefDirective).directive('uiSrefActive', $StateRefActiveDirective).directive('uiSrefActiveEq', $StateRefActiveDirective);
      $IsStateFilter.$inject = ['$state'];
      function $IsStateFilter($state) {
        var isFilter = function(state) {
          return $state.is(state);
        };
        isFilter.$stateful = true;
        return isFilter;
      }
      $IncludedByStateFilter.$inject = ['$state'];
      function $IncludedByStateFilter($state) {
        var includesFilter = function(state) {
          return $state.includes(state);
        };
        includesFilter.$stateful = true;
        return includesFilter;
      }
      angular.module('ui.router.state').filter('isState', $IsStateFilter).filter('includedByState', $IncludedByStateFilter);
    })(window, window.angular);
  })(require("5"));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("23", ["22"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = require("22");
  global.define = __define;
  return module.exports;
});

$__System.register('20', ['1f'], function (_export) {
  'use strict';

  var Restart, protobufs;
  return {
    setters: [function (_f) {
      Restart = _f['default'];
    }],
    execute: function () {
      protobufs = angular.module('client.protobufs', []);

      protobufs.value('TestBuilder', Restart.Test);

      _export('default', protobufs);
    }
  };
});
$__System.register('21', [], function (_export) {
  'use strict';

  var HomeController;

  _export('default', registerRouteAndController);

  function registerRouteAndController($stateProvider, module) {
    $stateProvider.state('home', {
      url: '/',
      templateUrl: 'app/routes/home.tmpl.html',
      controller: HomeController,
      controllerAs: 'vm'
    });
  }

  return {
    setters: [],
    execute: function () {
      HomeController = ['$scope', 'TestBuilder', function HomeController($scope, TestBuilder) {
        this.transactions = [];

        debugger;
      }];
    }
  };
});
$__System.register('24', ['8', '21', '23'], function (_export) {
    'use strict';

    var angular, RegisterHome, routes;
    return {
        setters: [function (_3) {
            angular = _3['default'];
        }, function (_) {
            RegisterHome = _['default'];
        }, function (_2) {}],
        execute: function () {
            routes = angular.module('client.routes', ['ui.router']);

            routes.config(['$stateProvider', '$urlRouterProvider', function ($stateProvider, $urlRouterProvider) {
                $urlRouterProvider.otherwise('/');

                RegisterHome($stateProvider, routes);
            }]);

            console.log('loaded routes');

            _export('default', routes);
        }
    };
});
$__System.register('25', [], function (_export) {
  "use strict";

  _export('default', registerDirective);

  function registerDirective(module) {
    module.directive('transactionList', function transactionList() {
      return {
        restrict: 'E',
        templateUrl: "app/directives/transactionList/transactionList.tmpl.html",
        controllerAs: "vm",
        controller: [function () {
          this.getDateString = function (date) {
            return 'null';
          };
          this.getDollarsString = function (dollars) {
            return 'null';
          };
          this.getDescriptionString = function (transaction) {
            return 'null';
          };
        }],
        bindToController: true,
        scope: {
          transactions: '='
        }
      };
    });
  }

  return {
    setters: [],
    execute: function () {}
  };
});
$__System.register('26', ['8', '25'], function (_export) {
  'use strict';

  var angular, registerTransactionList, _module;

  return {
    setters: [function (_) {
      angular = _['default'];
    }, function (_2) {
      registerTransactionList = _2['default'];
    }],
    execute: function () {
      _module = angular.module('client.directives', []);

      registerTransactionList(_module);

      _export('default', _module);
    }
  };
});
$__System.register('27', ['8'], function (_export) {

  //import registerTransactionList from './transactionList/transactionList'

  'use strict';

  var angular, _module, bp;

  return {
    setters: [function (_) {
      angular = _['default'];
    }],
    execute: function () {
      _module = angular.module('client.services', []);
      bp = 1;

      //registerTransactionList(module);

      _export('default', _module);
    }
  };
});
$__System.register('1', ['8', '20', '24', '26', '27'], function (_export) {
  'use strict';

  var angular, app;
  return {
    setters: [function (_) {
      angular = _['default'];
    }, function (_2) {}, function (_3) {}, function (_4) {}, function (_5) {}],
    execute: function () {

      //import templateCache from '../templates'

      app = angular.module('client', ['template-cache', 'client.protobufs', 'client.directives', 'client.services', 'client.routes']);
    }
  };
});
})
(function(factory) {
  factory();
});
//# sourceMappingURL=index.js.map