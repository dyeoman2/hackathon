// Client-side export using Vite environment variables
export const AUTUMN_CREDIT_FEATURE_ID = (() => {
  // Only run this on the client side where import.meta.env is available
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    const featureId = import.meta.env.VITE_AUTUMN_CREDIT_FEATURE_ID;
    if (!featureId || featureId.length === 0) {
      throw new Error(
        'VITE_AUTUMN_CREDIT_FEATURE_ID environment variable is required. ' +
          'Please set it in your .env.local file. See docs/AUTUMN_SETUP.md for setup instructions.',
      );
    }
    return featureId;
  }
  // This should not be called on the server side
  throw new Error(
    'AUTUMN_CREDIT_FEATURE_ID should not be accessed on the server side. Use getAutumnCreditFeatureId() from env.server.ts instead.',
  );
})();
