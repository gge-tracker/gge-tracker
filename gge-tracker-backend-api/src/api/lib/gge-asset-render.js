'use strict';

(function () {
  function levelSuffix(level) {
    return level ? 'Level' + level : '';
  }

  function capitalize(value) {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
  }

  function lookupLoose(container, name) {
    if (!container || !name) return null;
    if (typeof container[name] === 'function') return container[name];
    var wanted = String(name).toLowerCase();
    for (var key in container) {
      if (key.toLowerCase() === wanted && typeof container[key] === 'function') return container[key];
    }
    return null;
  }

  function variantNames(libraryName, options) {
    var suffix = levelSuffix(options.level);
    var quality = capitalize(options.quality);
    var names = [];
    switch (options.type) {
      case 'gate': {
        if (quality) names.push(quality + '_Gate_' + suffix);
        names.push('Basic_Gate_' + suffix);
        break;
      }
      case 'defence': {
        if (quality) names.push('Castlewall_' + quality + '_Defence_' + suffix, quality + '_Defence_' + suffix);
        names.push('Castlewall_Defence_' + suffix, 'Basic_Castlewall_' + suffix);
        break;
      }
      case 'tower': {
        if (quality) names.push(quality + '_Tower_' + suffix);
        names.push('Guard_Tower_' + suffix, 'Basic_Tower_Corner' + suffix + '_0');
        break;
      }
      default: {
        if (!suffix) break;
        var parts = libraryName.split('_');
        var last = parts.pop();
        names.push(parts.join('_') + '_' + suffix + '_' + last);
      }
    }
    return names.filter(Boolean);
  }

  function resolveConstructor(container, libraryName, options) {
    if (typeof container[libraryName] === 'function') return container[libraryName];
    var names = variantNames(libraryName, options);
    for (const name of names) {
      var found = lookupLoose(container, name);
      if (found) return found;
    }
    return null;
  }

  globalThis.renderGgeAsset = function (options) {
    return new Promise(function (resolve, reject) {
      var library = globalThis.Library;
      if (!library) return reject(new Error('Library not found'));
      var libraryName = Object.keys(library)[0];
      var container = library[libraryName];
      if (!container) return reject(new Error('Empty library for ' + libraryName));
      var loader = globalThis.AssetLoader;
      if (!loader) return reject(new Error('AssetLoader not found'));

      var canvas = globalThis.document.createElement('canvas');
      canvas.id = 'canvas';
      canvas.width = 1;
      canvas.height = 1;
      globalThis.document.body.append(canvas);
      var stage = new globalThis.createjs.Stage(canvas);

      loader.maintainScriptOrder = true;
      if (loader.setCrossOrigin) loader.setCrossOrigin('anonymous');

      loader.on('error', function (error) {
        reject(new Error('Loader error: ' + (error?.message || JSON.stringify(error))));
      });

      loader.on('complete', function () {
        try {
          var Symbol_ = resolveConstructor(container, libraryName, options);
          if (!Symbol_) return reject(new Error('No renderable symbol in ' + libraryName));
          var display = new Symbol_();
          stage.addChild(display);
          stage.update();

          var bounds = display.getBounds() || display.nominalBounds;
          if (!bounds?.width || !bounds.height) {
            return reject(new Error('Asset has no measurable bounds'));
          }
          var scale = Math.min(1, options.maxDimension / Math.max(bounds.width, bounds.height));
          canvas.width = Math.max(1, Math.round(bounds.width * scale));
          canvas.height = Math.max(1, Math.round(bounds.height * scale));
          display.scaleX = scale;
          display.scaleY = scale;
          display.regX = bounds.x;
          display.regY = bounds.y;
          display.x = 0;
          display.y = 0;
          stage.update();

          resolve({
            webp: canvas.toDataURL('image/webp', options.webpQuality),
            png: canvas.toDataURL('image/png'),
          });
        } catch (error) {
          reject(error);
        }
      });

      loader.loadFile({
        id: libraryName,
        type: 'spritesheet',
        src: options.spritesheetUrl,
        crossOrigin: 'anonymous',
      });
    });
  };
})();
