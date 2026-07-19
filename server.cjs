const express = require('express');
const { cpus, totalmem, loadavg, uptime } = require('os');
const { execSync, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5174;
const INVENTORY_DB = path.join(__dirname, 'inventory.json');

// Initialize inventory DB if not exists
function initInventoryDB() {
  if (!fs.existsSync(INVENTORY_DB)) {
    const initialData = {
      items: [
        { id: '1', name: 'Nasi Putih', category: 'Food quantity: 2, unit: ' cup', min_stock: 5, notes: '', last_updated: new Date().toISOString() },
        { id: '2', name: 'Sabun Cuci Piring', category: 'Soap', quantity: 3, unit: ' pcs', min_stock: 1, notes: '', last_updated: new Date().toISOString() },
        { id: '3', name: 'Shampoo Sunsilk', category: 'Shampoo', quantity: 2, unit: ' bottles', min_stock: 1, notes: '', last_updated: new Date().toISOString() },
        { id: '4', name: 'Pepsodent', category: 'Toothpaste', quantity: 2, unit: ' tubes', min_stock: 1, notes: '', last_updated: new Date().toISOString() },
      ],
      categories: ['Food', 'Soap', 'Shampoo', 'Toothpaste', 'Drinks', 'Snacks', 'Other'],
    };
    fs.writeFileSync(INVENTORY_DB, JSON.stringify(initialData, null, 2));
    console.log(`Inventory DB initialized at ${INVENTORY_DB}`);
  }
}
initInventoryDB();

function readInventory() {
  return JSON.parse(fs.readFileSync(INVENTORY_DB, 'utf8'));
}

function writeInventory(data) {
  fs.writeFileSync(INVENTORY_DB, JSON.stringify(data, null, 2));
}

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

// ── INVENTORY API ──────────────────────────────────────────────────────────

// Get all categories
app.get('/api/inventory/categories', (req, res) => {
  try {
    const data = readInventory();
    res.json({ categories: data.categories || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all items (with optional category filter)
app.get('/api/inventory/items', (req, res) => {
  try {
    const data = readInventory();
    let items = data.items || [];

    // Filter by category
    if (req.query.category && req.query.category !== 'all') {
      items = items.filter(item => item.category === req.query.category);
    }

    // Search by name
    if (req.query.search) {
      const search = req.query.search.toLowerCase();
      items = items.filter(item => item.name.toLowerCase().includes(search));
    }

    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new item
app.post('/api/inventory/items', (req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const newItem = JSON.parse(body);
      const data = readInventory();

      // Generate ID
      const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
      const item = {
        id,
        name: newItem.name || 'Unnamed',
        category: newItem.category || 'Other',
        quantity: Number(newItem.quantity) || 0,
        unit: newItem.unit || 'pcs',
        min_stock: Number(newItem.min_stock) || 0,
        notes: newItem.notes || '',
        last_updated: new Date().toISOString(),
      };

      data.items.push(item);
      writeInventory(data);

      res.json({ success: true, item });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
});

// Update item quantity (quick +/-)
app.patch('/api/inventory/items/:id/quantity', (req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const { delta, quantity } = JSON.parse(body);
      const data = readInventory();

      const idx = data.items.findIndex(i => i.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: 'Item not found' });

      if (delta !== undefined) {
        data.items[idx].quantity = (data.items[idx].quantity || 0) + delta;
      } else if (quantity !== undefined) {
        data.items[idx].quantity = Number(quantity);
      }
      data.items[idx].last_updated = new Date().toISOString();
      writeInventory(data);

      res.json({ success: true, item: data.items[idx] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
});

// Edit full item
app.put('/api/inventory/items/:id', (req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const updates = JSON.parse(body);
      const data = readInventory();

      const idx = data.items.findIndex(i => i.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: 'Item not found' });

      data.items[idx] = { ...data.items[idx], ...updates, last_updated: new Date().toISOString() };
      writeInventory(data);

      res.json({ success: true, item: data.items[idx] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
});

// Delete item
app.delete('/api/inventory/items/:id', (req, res) => {
  try {
    const data = readInventory();
    data.items = data.items.filter(i => i.id !== req.params.id);
    writeInventory(data);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new category
app.post('/api/inventory/categories', (req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const { name } = JSON.parse(body);
      const data = readInventory();

      if (!data.categories.includes(name)) {
        data.categories.push(name);
        writeInventory(data);
      }

      res.json({ success: true, categories: data.categories });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
});

// Chat endpoint
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
      const usageFile = `/tmp/hermes_usage_${Date.now()}.json`;
      const safePrompt = prompt.replace(/'/g, "'\\''");
      const cmd = `"${hermesPath}" -z '${safePrompt}' --usage-file ${usageFile} 2>&1`;
      const startTime = Date.now();

      exec(cmd, { cwd: '/Users/horus', timeout: 120000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        const elapsed = Date.now() - startTime;
        const output = (stdout || '').trim() || (stderr || '').trim() || 'No response';

        let usage = null;
        try {
          if (fs.existsSync(usageFile)) {
            usage = JSON.parse(fs.readFileSync(usageFile, 'utf8'));
            fs.unlinkSync(usageFile);
          }
        } catch (e) {
          console.error('[CHAT USAGE ERROR]', e.message);
        }

        res.write(`data: ${JSON.stringify({ chunk: output, usage, elapsed: Math.round(elapsed / 1000) })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Horus API running on http://0.0.0.0:${PORT}`);
});
