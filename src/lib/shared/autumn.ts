export const AUTUMN_CREDIT_FEATURE_ID = (() => {
  const featureId = import.meta.env.VITE_AUTUMN_CREDIT_FEATURE_ID;
  if (!featureId || featureId.length === 0) {
    throw new Error(
      'VITE_AUTUMN_CREDIT_FEATURE_ID environment variable is required. ' +
        'Please set it in your .env.local file. See docs/AUTUMN_SETUP.md for setup instructions.',
    );
  }
  return featureId;
})();
