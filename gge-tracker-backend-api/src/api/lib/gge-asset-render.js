'use strict';

(function () {
  function lookupLoose(container, name) {
    if (!container || !name) return null;
    if (typeof container[name] === 'function') return container[name];
    var wanted = String(name).toLowerCase();
    for (var key in container) {
      if (key.toLowerCase() === wanted && typeof container[key] === 'function') return container[key];
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
          var Symbol_ = lookupLoose(container, options.symbol);
          if (!Symbol_) return reject(new Error('No symbol ' + options.symbol + ' in ' + libraryName));
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
