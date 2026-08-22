// Explicit rather than left to auto-detection, because of one hoisting
// quirk this workspace cannot avoid -- see the long note below.
const path = require('node:path');

/**
 * babel-preset-expo adds its expo-router plugin -- the thing that inlines
 * `process.env.EXPO_ROUTER_APP_ROOT` inside expo-router's own `_ctx`
 * module -- only when a bare `require.resolve('expo-router')` succeeds
 * *from the preset's own directory* (see `hasModule` in
 * babel-preset-expo/build/common.js).
 *
 * In this workspace that check fails. React must stay pinned at 19.1.0
 * for apps/mobile while the root holds 19.2.7 for apps/web (see
 * metro.config.js for why), so npm nests React under apps/mobile and
 * drags expo-router down with it, while babel-preset-expo itself hoists
 * to the repo root. Node resolution from
 * <root>/node_modules/babel-preset-expo/ never looks inside
 * apps/mobile/node_modules, so the preset concludes expo-router isn't
 * installed and silently skips the plugin. The bundle then dies with:
 *
 *   Invalid call at line 2: process.env.EXPO_ROUTER_APP_ROOT
 *   First argument of `require.context` should be a string
 *
 * Adding the plugin here does exactly what the preset would have done if
 * hoisting had gone the other way -- it is not a behavior change, just a
 * resolution one.
 *
 * Deliberately conditional: the moment a future install does put
 * expo-router somewhere the preset can see, this stops adding anything
 * and the preset takes over again. Nothing to remember to undo.
 */
function presetAlreadySeesExpoRouter() {
  try {
    const presetDir = path.dirname(require.resolve('babel-preset-expo/package.json'));
    require.resolve('expo-router', { paths: [presetDir] });
    return true;
  } catch {
    return false;
  }
}

module.exports = function babelConfig(api) {
  api.cache(true);

  const plugins = [];
  if (!presetAlreadySeesExpoRouter()) {
    plugins.push(require('babel-preset-expo/build/expo-router-plugin').expoRouterBabelPlugin);
  }

  return {
    presets: ['babel-preset-expo'],
    plugins,
  };
};
