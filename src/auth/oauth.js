export function getAuthUrlForProvider(provider) {
  if (provider === 'google') return null;
  if (provider === 'facebook') return process.env.REACT_APP_FACEBOOK_AUTH_URL || null;
  if (provider === 'apple') return process.env.REACT_APP_APPLE_AUTH_URL || null;
  return null;
}
