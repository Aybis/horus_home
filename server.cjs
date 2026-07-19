const express = require('express');
const { cpus, totalmem, loadavg, uptime } = require('os');
const { execSync, spawn } = require('child_process');
const path = require('path');

const app = express();
const PORT = 5174;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.get('/api/stats', (req, res) => {
  try {
    const cpuCount = cpus().length;
    const totalMem = totalmem();
    const sysUptime = uptime();

    let memPct = 0;
    let usedMem = 0;
    try {
      const vmStat = execSync('vm_stat', { encoding: 'utf8', timeout: 5000 });
      const lines = vmStat.split('\n');
      const pageSize = 16384;
      let pagesActive = 0, pagesWired = 0, pagesCompressed = 0;
      for (const line of lines) {
        if (line.includes('Pages active:')) pagesActive = parseInt(line.match(/\d+/)?.[0] || '0');
        if (line.includes('Pages wired down:')) pagesWired = parseInt(line.match(/\d+/)?.[0] || '0');
        if (line.includes('Pages stored in compressor:')) pagesCompressed = parseInt(line.match(/\d+/)?.[0] || '0');
      }
      usedMem = (pagesActive + pagesWired + pagesCompressed) * pageSize;
      memPct = Math.round((usedMem / totalMem) * 100);
    } catch {
      usedMem = totalMem - require('os').freemem();
      memPct = Math.round((usedMem / totalMem) * 100);
    }

    const [load1, load5, load15] = loadavg();

    let processes = [];
    try {
      const psOutput = execSync('ps aux -r | head -21 | tail -20', { encoding: 'utf8', timeout: 5000 });
      const lines = psOutput.trim().split('\n');
      processes = lines.map(line => {
        const parts = line.trim().split(/\s+/);
        return {
          user: parts[0],
          pid: parseInt(parts[1]),
          cpu: parseFloat(parts[2]),
          mem: parseFloat(parts[3]),
          command: parts.slice(10).join(' ').substring(0, 60),
        };
      });
    } catch {}

    let disk = { used: 0, total: 0, pct: 0 };
    try {
      const dfOutput = execSync('df -k /System/Volumes/Data | tail -1', { encoding: 'utf8', timeout: 5000 });
      const parts = dfOutput.trim().split(/\s+/);
      const total = parseInt(parts[1]) * 1024;
      const used = parseInt(parts[2]) * 1024;
      disk = { used, total, pct: Math.round((used / total) * 100) };
    } catch {}

    res.json({
      cpus: cpuCount,
      load: { load1: Math.round(load1 * 100) / 100, load5: Math.round(load5 * 100) / 100, load15: Math.round(load15 * 100) / 100 },
      memory: { used: usedMem, total: totalMem, pct: memPct },
      disk,
      uptime: sysUptime,
      processes,
      timestamp: Date.now(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Chat endpoint - spawn hermes chat -q and parse output
app.post('/api/chat', (req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const { prompt } = JSON.parse(body);
      if (!prompt) {
        res.status(400).json({ error: 'Prompt is required' });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const hermesPath = '/Users/horus/.hermes/hermes-agent/venv/bin/hermes';
      const child = spawn('bash', [hermesPath, 'chat', '-q', prompt], {
        cwd: '/Users/horus',
        env: { ...process.env, TERM: 'dumb', PYTHONUNBUFFERED: '1' },
      });

      let output = '';
      child.stdout.on('data', (data) => { output += data.toString(); });
      child.stderr.on('data', (data) => { output += data.toString(); });

      child.on('close', (code) => {
        // Parse the Hermes output to extract the actual answer
        let answer = output;
        
        // Find response in Hermes box format
        const boxStart = output.indexOf('╭─ ⚕ Hermes');
        if (boxStart !== -1) {
          const boxEnd = output.indexOf('╰─', boxStart);
          if (boxEnd !== -1) {
            answer = output.substring(boxStart + 1, boxEnd).split('\n').slice(1, -1).map(l => l.replace(/^    /, '')).join('\n').trim();
          }
        }
        
        res.write(`data: ${JSON.stringify({ chunk: answer })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true, code })}\n\n`);
        res.end();
      });

      req.on('close', () => child.kill());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Horus API running on http://0.0.0.0:${PORT}`);
});
