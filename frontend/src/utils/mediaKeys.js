const ROBUSTNESS_FALLBACK = 'SW_SECURE_DECODE';

const addRobustness = (caps) => {
  if (!Array.isArray(caps)) return caps;
  return caps.map((cap) => {
    if (!cap || cap.robustness) return cap;
    return { ...cap, robustness: ROBUSTNESS_FALLBACK };
  });
};

const createPatchedRequest = (original) => async (keySystem, configs = []) => {
  const patchedConfigs = Array.isArray(configs)
    ? configs.map((config) => {
      if (!config) return config;
      return {
        ...config,
        audioCapabilities: addRobustness(config.audioCapabilities),
        videoCapabilities: addRobustness(config.videoCapabilities),
      };
    })
    : configs;
  try {
    return await original(keySystem, patchedConfigs);
  } catch (err) {
    return original(keySystem, configs);
  }
};

let patched = false;

const tryPatch = (target, patchedFn) => {
  if (!target) return false;
  try {
    target.requestMediaKeySystemAccess = patchedFn;
    if (target.requestMediaKeySystemAccess === patchedFn) return true;
  } catch (err) {
    // Fall through to defineProperty.
  }
  try {
    Object.defineProperty(target, 'requestMediaKeySystemAccess', {
      value: patchedFn,
      configurable: true,
      writable: true,
    });
    return true;
  } catch (err) {
    return false;
  }
};

const patchMediaKeySystemAccess = () => {
  if (patched) return true;
  if (typeof navigator === 'undefined' || typeof navigator.requestMediaKeySystemAccess !== 'function') {
    return false;
  }
  const original = navigator.requestMediaKeySystemAccess.bind(navigator);
  const patchedFn = createPatchedRequest(original);
  const applied = tryPatch(navigator, patchedFn)
    || (typeof Navigator !== 'undefined' ? tryPatch(Navigator.prototype, patchedFn) : false);
  if (applied) patched = true;
  return applied;
};

export { patchMediaKeySystemAccess };
