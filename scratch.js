const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');

async function testSearch(dirPath, query, extParam, searchContent) {
    const resultsMap = new Map();
    const ext = extParam && extParam.trim().length > 0 ? extParam.replace(/^\./, '').toLowerCase() : null;
    const lowerQuery = query.toLowerCase();
    
    async function walk(currentPath, forceIncludeAll = false) {
      try {
        const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
        for (let entry of entries) {
           if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
           const fullPath = path.join(currentPath, entry.name);
           const isMatchQuery = forceIncludeAll || entry.name.toLowerCase().includes(lowerQuery);
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
             await walk(fullPath, isMatch);
           }
        }
      } catch (err) {}
    }
    await walk(dirPath);

    if (searchContent !== false) {
      const rgArgs = ['-i', '-C', '1', '-F', '--json', '--hidden', '--glob', '!node_modules/**', '--glob', '!.git/**'];
      if (ext) rgArgs.push('-g', `*.${ext}`);
      rgArgs.push(query, dirPath);

      await new Promise((resolve) => {
        const rgPath = require('vscode-ripgrep').rgPath;
        const rgProcess = spawn(rgPath, rgArgs);
        let buffer = '';
        rgProcess.stdout.on('data', (data) => {
          buffer += data.toString();
          let lines = buffer.split('\n');
          buffer = lines.pop(); 
          for (let line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === 'match') {
                 const matchPath = parsed.data.path.text;
                 const lineText = parsed.data.lines.text.trim();
                 const lineNum = parsed.data.line_number;
                 if (!resultsMap.has(matchPath)) {
                   resultsMap.set(matchPath, { name: path.basename(matchPath), isDirectory: false, path: matchPath, matchType: 'content', context: [] });
                 }
                 const item = resultsMap.get(matchPath);
                 if (item.matchType === 'content' || item.matchType === 'name' || item.matchType === 'nest') {
                   if (!item.context) item.context = [];
                   if (item.context.length < 5) item.context.push({ num: lineNum, text: lineText });
                 }
              } else if (parsed.type === 'context') {
                 const matchPath = parsed.data.path.text;
                 const lineText = parsed.data.lines.text.trim();
                 const lineNum = parsed.data.line_number;
                 if (resultsMap.has(matchPath)) {
                   const item = resultsMap.get(matchPath);
                   if (item.context && item.context.length < 5) item.context.push({ num: lineNum, text: lineText, isContext: true });
                 }
              }
            } catch (e) {}
          }
        });
        rgProcess.on('close', () => resolve());
      });
    }

    const results = Array.from(resultsMap.values());
    const treePathsSet = new Set(results.map(r => r.path));
    
    for (let result of results) {
       let currentDir = path.dirname(result.path);
       while (currentDir.length >= dirPath.length && currentDir !== dirPath && currentDir !== '/') {
          if (!treePathsSet.has(currentDir)) {
             treePathsSet.add(currentDir);
             resultsMap.set(currentDir, { name: path.basename(currentDir), isDirectory: true, path: currentDir, matchType: 'parent_link', context: null });
          }
          currentDir = path.dirname(currentDir);
       }
    }
    return Array.from(resultsMap.values());
}

testSearch('/Users/ryanj.buchanan/4one2/4one2 Master', 'test', null, true).then(res => {
   console.log(JSON.stringify(res, null, 2));
});
