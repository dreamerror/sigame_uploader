export const IPC_CHANNELS = {
  checkTools: 'tools:check',
  fetchMetadata: 'media:metadata',
  preparePreview: 'media:prepare-preview',
  prepareLocalMediaPreview: 'media:prepare-local-preview',
  getCookieCacheStatus: 'cookies:cache-status',
  refreshCookieCache: 'cookies:refresh-cache',
  clearCookieCache: 'cookies:clear-cache',
  selectOutputFolder: 'dialog:select-output-folder',
  selectSiqPackage: 'dialog:select-siq-package',
  selectMediaFile: 'dialog:select-media-file',
  exportClip: 'media:export-clip',
  downloadThumbnail: 'media:download-thumbnail',
  importSiqPackage: 'siq:import-package',
  createSiqPackage: 'siq:create-package',
  openYouTubeSignIn: 'external:open-youtube-sign-in'
} as const
