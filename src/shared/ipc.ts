export const IPC_CHANNELS = {
  checkTools: 'tools:check',
  fetchMetadata: 'media:metadata',
  preparePreview: 'media:prepare-preview',
  getCookieCacheStatus: 'cookies:cache-status',
  refreshCookieCache: 'cookies:refresh-cache',
  clearCookieCache: 'cookies:clear-cache',
  selectOutputFolder: 'dialog:select-output-folder',
  exportClip: 'media:export-clip',
  downloadThumbnail: 'media:download-thumbnail',
  openYouTubeSignIn: 'external:open-youtube-sign-in'
} as const
