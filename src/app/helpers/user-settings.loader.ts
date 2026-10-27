/** Load existing settings normalization only for an account that needs it. */
export function loadUserSettingsUtilities() {
  return import('../utils/app.user.utilities')
    .then(module => module.AppUserUtilities)
    .catch(cause => {
      // Browsers can retain a failed module fetch for the life of this page.
      // Keep the account blocked and offer an explicit reload instead of a same-page retry loop.
      throw Object.assign(new Error('Could not load the account settings module.'), {
        code: 'account/settings-load-failed', cause,
      });
    });
}
