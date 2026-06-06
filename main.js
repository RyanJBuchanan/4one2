const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const util = require('util');
const { exec, spawn } = require('child_process');
const rgPath = require('vscode-ripgrep').rgPath;

const execPromise = util.promisify(exec);

// Removed electron-squirrel-startup as it's not needed during development

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0f172a', // Slate 900
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile('index.html');
  mainWindow.webContents.openDevTools();

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] ${message} (${path.basename(sourceId)}:${line})`);
  });
};

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// File System IPC Handlers
const HOME_DIR = os.homedir();
const DEFAULT_DIR = path.join(HOME_DIR, '4one2');
const FEEDS_DIR = path.join(__dirname, 'feeds');

// Ensure the default directory exists
if (!fs.existsSync(DEFAULT_DIR)) {
  fs.mkdirSync(DEFAULT_DIR, { recursive: true });
}
if (!fs.existsSync(FEEDS_DIR)) {
  fs.mkdirSync(FEEDS_DIR, { recursive: true });
}

// Migrate existing XML feeds from DEFAULT_DIR to FEEDS_DIR
try {
  const files = fs.readdirSync(DEFAULT_DIR);
  files.forEach(file => {
    if (file.endsWith('.xml')) {
      const oldPath = path.join(DEFAULT_DIR, file);
      const newPath = path.join(FEEDS_DIR, file);
      if (!fs.existsSync(newPath)) {
        fs.copyFileSync(oldPath, newPath);
        console.log(`Migrated feed ${file} to feeds directory.`);
      }
    }
  });
} catch (err) {
  console.error('Failed to migrate existing feeds:', err);
}

ipcMain.handle('get-default-dir', () => {
  return DEFAULT_DIR;
});

ipcMain.handle('get-feeds-dir', () => {
  return FEEDS_DIR;
});

ipcMain.handle('get-home-dir', () => {
  return HOME_DIR;
});

// Collision handler helper
function getUniquePath(destPath) {
  if (!fs.existsSync(destPath)) return destPath;
  const dir = path.dirname(destPath);
  const ext = path.extname(destPath);
  const base = path.basename(destPath, ext);
  let counter = 1;
  let newPath = path.join(dir, `${base} (${counter})${ext}`);
  while (fs.existsSync(newPath)) {
    counter++;
    newPath = path.join(dir, `${base} (${counter})${ext}`);
  }
  return newPath;
}

ipcMain.handle('fs-copy', async (event, source, destFolder) => {
  try {
    const fileName = path.basename(source);
    const targetPath = getUniquePath(path.join(destFolder, fileName));
    await fs.promises.cp(source, targetPath, { recursive: true });
    return { success: true, newPath: targetPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('fs-move', async (event, source, destFolder) => {
  try {
    const fileName = path.basename(source);
    const targetPath = getUniquePath(path.join(destFolder, fileName));
    // Fallback to cp+rm if rename fails across partitions
    try {
      await fs.promises.rename(source, targetPath);
    } catch(err) {
      if (err.code === 'EXDEV') {
        await fs.promises.cp(source, targetPath, { recursive: true });
        await fs.promises.rm(source, { recursive: true, force: true });
      } else {
        throw err;
      }
    }
    return { success: true, newPath: targetPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('read-dir', async (event, dirPath) => {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    
    // Sort directories first, then files
    const sortedEntries = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    const result = sortedEntries.map(entry => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      path: path.join(dirPath, entry.name)
    }));

    // Filter out restricted/hidden files for neatness if desired
    return { success: true, count: result.length, data: result.filter(e => !e.name.startsWith('.')) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('search-dir', async (event, dirPath, query, extParam, searchContent) => {
  try {
    const resultsMap = new Map(); // Use Map to track unique paths
    
    // Process extension parameter (remove leading dot if they accidentally typed it)
    const ext = extParam && extParam.trim().length > 0 ? extParam.replace(/^\./, '').toLowerCase() : null;
    
    // 1. Filename & Folder Walk Search
    const lowerQuery = query.toLowerCase();
    
    async function walk(currentPath, forceIncludeAll = false) {
      try {
        const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
        for (let entry of entries) {
           if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
           
           const fullPath = path.join(currentPath, entry.name);
           const isMatchQuery = forceIncludeAll || entry.name.toLowerCase().includes(lowerQuery);
           
           // If an extension filter exists, files MUST match it.
           let passedExtCheck = true;
           if (!entry.isDirectory() && ext) {
               passedExtCheck = entry.name.toLowerCase().endsWith('.' + ext);
           }
           
           const isMatch = isMatchQuery && (entry.isDirectory() || passedExtCheck);
           
           if (isMatch) {
              resultsMap.set(fullPath, {
                 name: entry.name,
                 isDirectory: entry.isDirectory(),
                 path: fullPath,
                 matchType: forceIncludeAll ? 'nest' : 'name',
                 context: null
              });
           }
           
           if (entry.isDirectory()) {
             // If folder matches, we force include everything in its nest
             await walk(fullPath, isMatch);
           }
        }
      } catch (err) {
        // ignore permission errors
      }
    }
    await walk(dirPath);

    // 2. Content Search using Ripgrep (skip if searchContent toggle is unchecked)
    if (searchContent !== false) {
      const rgArgs = [
        '-i',            // case insensitive
        '-C', '1',       // 1 line of context before and after
        '-F',            // fixed strings (disables regex so special characters work literally)
        '--json',        // JSON output format
        '--hidden',      // search hidden files if needed
        '--glob', '!node_modules/**',
        '--glob', '!.git/**'
      ];
      
      if (ext) {
         rgArgs.push('-g', `*.${ext}`);
      }
      
      rgArgs.push(query, dirPath);

      await new Promise((resolve) => {
        const rgProcess = spawn(rgPath, rgArgs);
        
        let buffer = '';
        rgProcess.stdout.on('data', (data) => {
          buffer += data.toString();
          let lines = buffer.split('\n');
          buffer = lines.pop(); // keep last incomplete line in buffer
          
          for (let line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === 'match') {
                 const matchPath = parsed.data.path.text;
                 // Get matched text and immediate lines
                 const lineText = parsed.data.lines.text.trim();
                 const lineNum = parsed.data.line_number;
                 
                 if (!resultsMap.has(matchPath)) {
                   resultsMap.set(matchPath, {
                      name: path.basename(matchPath),
                      isDirectory: false,
                      path: matchPath,
                      matchType: 'content',
                      context: []
                   });
                 }
                 const item = resultsMap.get(matchPath);
                 if (item.matchType === 'content' || item.matchType === 'name' || item.matchType === 'nest') {
                   if (!item.context) item.context = [];
                   if (item.context.length < 5) { // limit context lines
                     item.context.push({ num: lineNum, text: lineText });
                   }
                 }
              } else if (parsed.type === 'context') {
                 const matchPath = parsed.data.path.text;
                 const lineText = parsed.data.lines.text.trim();
                 const lineNum = parsed.data.line_number;
                 if (resultsMap.has(matchPath)) {
                   const item = resultsMap.get(matchPath);
                   if (item.context && item.context.length < 5) {
                     item.context.push({ num: lineNum, text: lineText, isContext: true });
                   }
                 }
              }
            } catch (e) {
              // parsing error, ignore line
            }
          }
        });
        
        rgProcess.on('close', () => resolve());
      });
    }

    const results = Array.from(resultsMap.values());
    
    // Ensure all parent directories of results are also in the results so we can build a proper tree.
    const treePathsSet = new Set(results.map(r => r.path));
    
    for (let result of results) {
       let currentDir = path.dirname(result.path);
       while (currentDir.length >= dirPath.length && currentDir !== '/') {
          if (!treePathsSet.has(currentDir)) {
             treePathsSet.add(currentDir);
             resultsMap.set(currentDir, {
                name: path.basename(currentDir),
                isDirectory: true,
                path: currentDir,
                matchType: 'parent_link',
                context: null
             });
          }
          currentDir = path.dirname(currentDir);
       }
    }

    return { success: true, count: resultsMap.size, data: Array.from(resultsMap.values()) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('read-file', async (event, filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.mp3', '.wav', '.mp4', '.webm', '.ogg'];
    
    if (binaryExtensions.includes(ext)) {
      return { success: true, isBinary: true, ext };
    } else {
      const stats = await fs.promises.stat(filePath);
      if (stats.size > 1024 * 1024) { // 1MB limit for previewing text
        return { success: false, error: 'File is too large to preview (>1MB)' };
      }
      const content = await fs.promises.readFile(filePath, 'utf8');
      return { success: true, isBinary: false, content, ext };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('read-file-base64', async (event, filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const content = await fs.promises.readFile(filePath, 'base64');
    return { success: true, content, ext };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('fs-delete', async (event, targetPath) => {
  try {
    await fs.promises.rm(targetPath, { recursive: true, force: true });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('fs-rename', async (event, targetPath, newName) => {
  try {
    const dir = path.dirname(targetPath);
    const dest = path.join(dir, newName);
    if (fs.existsSync(dest)) {
      return { success: false, error: 'File or folder already exists' };
    }
    await fs.promises.rename(targetPath, dest);
    return { success: true, newPath: dest };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('fs-reveal', async (event, targetPath) => {
  try {
    const { shell } = require('electron');
    shell.showItemInFolder(targetPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});


// =========================================================================
// RSS Feed Reader & Publisher IPC Handlers
// =========================================================================
const Parser = require('rss-parser');
const parser = new Parser();

ipcMain.handle('rss-fetch', async (event, url) => {
  try {
    const feed = await parser.parseURL(url);
    return {
      success: true,
      title: feed.title || 'Untitled Feed',
      description: feed.description || '',
      link: feed.link || '',
      items: (feed.items || []).map(item => ({
        title: item.title || 'Untitled Article',
        link: item.link || '',
        pubDate: item.pubDate || item.isoDate || new Date().toUTCString(),
        content: item.contentSnippet || item.content || item.summary || 'No description provided.',
        enclosure: item.enclosure || null
      }))
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

ipcMain.handle('rss-publish-local', async (event, feedPath, entry) => {
  try {
    let items = [];
    
    if (fs.existsSync(feedPath)) {
      try {
        const content = await fs.promises.readFile(feedPath, 'utf8');
        // Simple robust regex parser to extract existing items so we don't break XML structures
        const itemMatches = content.match(/<item>[\s\S]*?<\/item>/g) || [];
        for (let match of itemMatches) {
          const rawTitle = (match.match(/<title>(.*?)<\/title>/) || [])[1] || '';
          const rawLink = (match.match(/<link>(.*?)<\/link>/) || [])[1] || '';
          const title = unescapeXml(rawTitle);
          const link = unescapeXml(rawLink);
          
          // Match description, accounting for CDATA wrappers
          let description = '';
          const descMatch = match.match(/<description>([\s\S]*?)<\/description>/);
          if (descMatch) {
            description = descMatch[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
          }
          
          const pubDate = (match.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
          items.push({ title, link, description, pubDate });
        }
      } catch (readErr) {
        console.error("Error reading existing RSS feed file, recreating it:", readErr);
      }
    }
    
    // Add the new item at the beginning
    const cleanMagnet = (entry.magnet || '').replace(/&/g, '&amp;');
    const cleanComment = (entry.comment || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    items.unshift({
      title: entry.title,
      link: entry.magnet || '#',
      description: `<strong>Comments:</strong> ${cleanComment}<br><strong>Size:</strong> ${entry.size || 'Unknown'}<br><a href="${cleanMagnet}">Magnet Link</a>`,
      pubDate: entry.date || new Date().toUTCString()
    });
    
    // Limit to 50 items for performance
    if (items.length > 50) items = items.slice(0, 50);
    
    // Rebuild feed XML
    const feedTitle = path.basename(feedPath, '.xml');
    let xml = `<?xml version="1.0" encoding="UTF-8" ?>\n`;
    xml += `<rss version="2.0">\n`;
    xml += `<channel>\n`;
    xml += `  <title>${escapeXml(feedTitle)}</title>\n`;
    xml += `  <link>file://${escapeXml(feedPath)}</link>\n`;
    xml += `  <description>4one2 Custom RSS Feed for Shared Torrents</description>\n`;
    
    for (let item of items) {
      xml += `  <item>\n`;
      xml += `    <title>${escapeXml(item.title)}</title>\n`;
      xml += `    <link>${escapeXml(item.link)}</link>\n`;
      xml += `    <description><![CDATA[${item.description}]]></description>\n`;
      xml += `    <pubDate>${item.pubDate}</pubDate>\n`;
      xml += `  </item>\n`;
    }
    
    xml += `</channel>\n`;
    xml += `</rss>\n`;
    
    // Ensure parent dir exists
    await fs.promises.mkdir(path.dirname(feedPath), { recursive: true });
    await fs.promises.writeFile(feedPath, xml, 'utf8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// =========================================================================
// Torrent Manager & Creator IPC Handlers
// =========================================================================
let WebTorrent = null;
let torrentClient = null;
let torrentClientOptions = {
  maxConns: 55
};

async function getTorrentClient() {
  if (!torrentClient) {
    const module = await import('webtorrent');
    WebTorrent = module.default;
    torrentClient = new WebTorrent(torrentClientOptions);
    torrentClient.on('error', (err) => {
      console.error('WebTorrent client error:', err.message);
    });
  }
  return torrentClient;
}

ipcMain.handle('torrent-update-settings', async (event, options) => {
  try {
    if (options.maxConns) {
      torrentClientOptions.maxConns = parseInt(options.maxConns, 10);
      if (torrentClient) {
        torrentClient.maxConns = torrentClientOptions.maxConns;
        torrentClient.torrents.forEach(t => {
          t.maxConns = torrentClientOptions.maxConns;
        });
      }
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('torrent-add', async (event, torrentId, downloadDir) => {
  try {
    const client = await getTorrentClient();
    
    // Avoid duplicate download jobs, resume if paused
    const existing = await client.get(torrentId);
    if (existing) {
      if (existing.paused) {
        existing.resume();
      }
      return { success: true, alreadyExists: true };
    }
    
    const torrentInstance = client.add(torrentId, { path: downloadDir || DEFAULT_DIR }, (torrent) => {
      console.log(`Started torrent download: ${torrent.name}`);
      torrent.on('done', () => {
        console.log(`Successfully completed torrent: ${torrent.name}`);
      });
      torrent.on('error', (err) => {
        console.error(`Torrent error for ${torrent.name || torrentId}:`, err.message);
      });
    });
    
    // Also bind error handler to the client's new torrent object immediately
    if (torrentInstance) {
      torrentInstance.on('error', (err) => {
        console.error(`Torrent error during metadata fetch:`, err.message);
      });
    }
    
    return { success: true };
  } catch (error) {
    console.error('Failed to add torrent:', error.message);
    return { success: false, error: error.message };
  }
});

function getSafeProgress(t) {
  try {
    const p = t.progress;
    if (typeof p === 'number' && !isNaN(p)) return p;
  } catch (e) {}
  
  try {
    if (t.pieces && t.pieces.length > 0) {
      let downloaded = 0;
      for (const piece of t.pieces) {
        if (piece) {
          downloaded += (piece.length - (piece.missing || 0));
        }
      }
      const total = t.length || 0;
      if (total > 0) return downloaded / total;
    }
  } catch (e) {}
  return 0;
}

ipcMain.handle('torrent-get-status', async () => {
  try {
    const client = await getTorrentClient();
    const torrents = client.torrents.map(t => {
      let progress = 0;
      let downloadSpeed = 0;
      let uploadSpeed = 0;
      let numPeers = 0;
      let isDone = false;
      let isPaused = false;
      
      try { progress = getSafeProgress(t); } catch (e) {}
      try { downloadSpeed = t.downloadSpeed || 0; } catch (e) {}
      try { uploadSpeed = t.uploadSpeed || 0; } catch (e) {}
      try { numPeers = t.numPeers || 0; } catch (e) {}
      try { isDone = t.done || false; } catch (e) {}
      try { isPaused = t.paused || false; } catch (e) {}
      
      return {
        id: t.infoHash,
        name: t.name || 'Retrieving metadata...',
        progress,
        downloadSpeed,
        uploadSpeed,
        numPeers,
        status: isDone ? 'Seeding' : (isPaused ? 'Paused' : 'Downloading'),
        path: t.path,
        magnetURI: t.magnetURI
      };
    });
    return { success: true, torrents };
  } catch (error) {
    console.error("Error fetching torrent status:", error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('torrent-pause-resume', async (event, torrentId) => {
  try {
    const client = await getTorrentClient();
    const torrent = client.get(torrentId);
    if (torrent) {
      if (torrent.paused) {
        torrent.resume();
      } else {
        torrent.pause();
      }
      return { success: true };
    }
    return { success: false, error: 'Torrent not found' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('torrent-remove', async (event, torrentId, deleteFiles) => {
  try {
    const client = await getTorrentClient();
    const torrent = client.get(torrentId);
    if (torrent) {
      await new Promise((resolve, reject) => {
        client.remove(torrentId, { destroyStore: deleteFiles }, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
      return { success: true };
    }
    return { success: false, error: 'Torrent not found' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('torrent-create-from-folder', async (event, folderPath, targetDir, comment) => {
  try {
    const client = await getTorrentClient();
    
    return new Promise((resolve) => {
      client.seed(folderPath, {
        announce: [
          'udp://tracker.leechers-paradise.org:6969',
          'udp://tracker.coppersurfer.tk:6969/announce',
          'udp://open.demonii.com:1337/announce',
          'udp://tracker.opentrackr.org:1337/announce'
        ],
        comment: comment || 'Created with 4one2 File Explorer'
      }, (torrent) => {
        const torrentFileName = `${torrent.name}.torrent`;
        const torrentFilePath = path.join(targetDir, torrentFileName);
        
        fs.writeFile(torrentFilePath, torrent.torrentFile, (err) => {
          if (err) {
            return resolve({ success: false, error: `Failed to write .torrent file: ${err.message}` });
          }
          resolve({
            success: true,
            name: torrent.name,
            torrentPath: torrentFilePath,
            magnetURI: torrent.magnetURI,
            infoHash: torrent.infoHash,
            sizeBytes: torrent.length
          });
        });
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Dynamic RSS Feed Hosting Server
const http = require('http');

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const interfaceName in interfaces) {
    for (const iface of interfaces[interfaceName]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const RSS_SERVER_PORT = 4122;
const rssServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  
  if (pathname.startsWith('/feed/')) {
    const feedFileName = pathname.substring(6); // remove '/feed/'
    const safeFileName = path.basename(feedFileName);
    const feedFilePath = path.join(FEEDS_DIR, safeFileName.endsWith('.xml') ? safeFileName : safeFileName + '.xml');
    
    if (fs.existsSync(feedFilePath)) {
      fs.readFile(feedFilePath, 'utf8', (err, data) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('500 Internal Server Error');
          return;
        }
        res.writeHead(200, { 
          'Content-Type': 'application/xml; charset=utf-8',
          'Access-Control-Allow-Origin': '*' // allow CORS
        });
        res.end(data);
      });
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Feed Not Found');
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
});

let publicUrl = null;
let tunnelProcess = null;

function startPublicTunnel() {
  console.log('Starting serveo.net SSH tunnel...');
  const ssh = spawn('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-R', '80:localhost:4122',
    'serveo.net'
  ]);
  tunnelProcess = ssh;
  
  ssh.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(`[Serveo SSH Tunnel] ${output}`);
    const match = output.match(/Forwarding HTTP traffic from (https:\/\/[a-zA-Z0-9.-]+)/);
    if (match) {
      publicUrl = match[1];
      console.log(`Public feed sharing URL: ${publicUrl}`);
    }
  });

  ssh.stderr.on('data', (data) => {
    console.warn(`[Serveo SSH Warning] ${data.toString()}`);
  });

  ssh.on('close', (code) => {
    console.log(`Serveo tunnel connection closed with code ${code}. Reconnecting in 10s...`);
    publicUrl = null;
    setTimeout(startPublicTunnel, 10000);
  });
}

rssServer.listen(RSS_SERVER_PORT, '0.0.0.0', () => {
  console.log(`RSS feed sharing server listening on port ${RSS_SERVER_PORT}`);
  startPublicTunnel();
});

ipcMain.handle('get-local-ip', () => {
  return getLocalIpAddress();
});

ipcMain.handle('get-public-url', () => {
  return publicUrl;
});

async function gitPushFeed(feedPath) {
  return new Promise((resolve) => {
    const relativePath = path.relative(__dirname, feedPath);
    const escapedPath = relativePath.replace(/"/g, '\\"');
    
    exec('git remote get-url origin', { cwd: __dirname }, (remoteErr, remoteUrl) => {
      if (remoteErr || !remoteUrl) {
        return resolve({ success: false, error: 'No git remote "origin" configured. Set a remote to sync.' });
      }
      
      const gitCmd = `git add "${escapedPath}" && git commit -m "Update RSS feed: ${path.basename(feedPath)}" && git push origin`;
      exec(gitCmd, { cwd: __dirname }, (err, stdout, stderr) => {
        if (err) {
          console.error('Git sync failed:', stderr || err.message);
          return resolve({ success: false, error: stderr || err.message });
        }
        resolve({ success: true, stdout: stdout, remoteUrl: remoteUrl.trim() });
      });
    });
  });
}

ipcMain.handle('git-sync-feed', async (event, feedPath) => {
  return await gitPushFeed(feedPath);
});

ipcMain.handle('get-git-remote', async () => {
  return new Promise((resolve) => {
    exec('git remote get-url origin', { cwd: __dirname }, (remoteErr, remoteStdout) => {
      if (remoteErr || !remoteStdout) {
        return resolve(null);
      }
      exec('git branch --show-current', { cwd: __dirname }, (branchErr, branchStdout) => {
        const branch = (!branchErr && branchStdout) ? branchStdout.trim() : 'main';
        resolve({ remoteUrl: remoteStdout.trim(), branch: branch });
      });
    });
  });
});

app.on('will-quit', () => {
  if (tunnelProcess) {
    tunnelProcess.kill();
  }
});



