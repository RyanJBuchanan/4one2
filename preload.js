const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getDefaultDir: () => ipcRenderer.invoke('get-default-dir'),
  getHomeDir: () => ipcRenderer.invoke('get-home-dir'),
  readDir: (path) => ipcRenderer.invoke('read-dir', path),
  searchDir: (path, query, ext, searchContent) => ipcRenderer.invoke('search-dir', path, query, ext, searchContent),
  fsCopy: (source, targetFolder) => ipcRenderer.invoke('fs-copy', source, targetFolder),
  fsMove: (source, targetFolder) => ipcRenderer.invoke('fs-move', source, targetFolder),
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  readFileBase64: (path) => ipcRenderer.invoke('read-file-base64', path),
  fsDelete: (path) => ipcRenderer.invoke('fs-delete', path),
  fsRename: (path, newName) => ipcRenderer.invoke('fs-rename', path, newName),
  fsReveal: (path) => ipcRenderer.invoke('fs-reveal', path),
  
  // RSS Hub APIs
  fetchRSS: (url) => ipcRenderer.invoke('rss-fetch', url),
  publishRSSEntry: (feedPath, entry) => ipcRenderer.invoke('rss-publish-local', feedPath, entry),
  
  // Torrent Suite APIs
  addTorrent: (torrentId, downloadDir) => ipcRenderer.invoke('torrent-add', torrentId, downloadDir),
  getTorrentStatus: () => ipcRenderer.invoke('torrent-get-status'),
  pauseResumeTorrent: (torrentId) => ipcRenderer.invoke('torrent-pause-resume', torrentId),
  removeTorrent: (torrentId, deleteFiles) => ipcRenderer.invoke('torrent-remove', torrentId, deleteFiles),
  createTorrentFromFolder: (folderPath, targetDir, comment) => ipcRenderer.invoke('torrent-create-from-folder', folderPath, targetDir, comment),
  updateTorrentSettings: (options) => ipcRenderer.invoke('torrent-update-settings', options),
  getLocalIp: () => ipcRenderer.invoke('get-local-ip'),
  getPublicUrl: () => ipcRenderer.invoke('get-public-url'),
  getFeedsDir: () => ipcRenderer.invoke('get-feeds-dir'),
  gitSyncFeed: (feedPath) => ipcRenderer.invoke('git-sync-feed', feedPath),
  getGitRemote: () => ipcRenderer.invoke('get-git-remote')
});

