const magnet = 'magnet:?xt=urn:btih:d64d2bd087a67ccfc9375d3ca74fec070bf2551a&dn=LibreOffice_26.2.2_MacOS_aarch64.dmg&tr=http%3A%2F%2Ftracker.documentfoundation.org%3A6969%2Fannounce&ws=https%3A%2F%2Ftdf.mirror.rafal.ca%2Flibreoffice%2Fstable%2F26.2.2%2Fmac%2Faarch64%2FLibreOffice_26.2.2_MacOS_aarch64.dmg';

async function test() {
  console.log("Loading webtorrent...");
  try {
    const WebTorrent = (await import('webtorrent')).default;
    console.log("WebTorrent class loaded successfully. Instantiating client...");
    const client = new WebTorrent();
    console.log("Client instantiated successfully. Adding torrent...");
    
    client.on('error', (err) => {
      console.error("Client error:", err.message);
    });

    client.add(magnet, { path: __dirname }, (torrent) => {
      console.log("Torrent ready callback fired!");
      console.log("Torrent name:", torrent.name);
      console.log("Torrent size:", torrent.length);
      
      torrent.on('download', (bytes) => {
        console.log(`Progress: ${(torrent.progress * 100).toFixed(1)}% | Peers: ${torrent.numPeers} | Speed: ${(client.downloadSpeed / 1024).toFixed(1)} KB/s`);
      });
      
      torrent.on('done', () => {
        console.log("Download completed!");
        process.exit(0);
      });
    });
    
    // Check status after 8 seconds
    setInterval(() => {
      const active = client.torrents[0];
      if (active) {
        console.log(`Checking - Name: ${active.name} | Peers: ${active.numPeers} | Progress: ${(active.progress * 100).toFixed(1)}%`);
      } else {
        console.log("No torrents in client.torrents array.");
      }
    }, 3000);
    
    // Timeout after 20 seconds
    setTimeout(() => {
      console.log("Exiting test script due to timeout.");
      process.exit(0);
    }, 20000);
    
  } catch (err) {
    console.error("Global Error occurred:", err.stack);
  }
}

test();
