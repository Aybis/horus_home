const express = require('express');
const { cpus, totalmem, loadavg, uptime } = require('os');
const { execSync, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = 5174;
const DB_PATH = path.join(__dirname, 'inventory.db');

// Initialize SQLite database
const db = new Database(DB_PATH);
console.log(`SQLite database initialized at ${DB_PATH}`);

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Other',
    quantity INTEGER NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'pcs',
    min_stock INTEGER NOT NULL DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stock_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    old_quantity INTEGER,
    new_quantity INTEGER NOT NULL,
    delta INTEGER NOT NULL,
    reason TEXT DEFAULT 'manual',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
  CREATE INDEX IF NOT EXISTS idx_stock_history_item_id ON stock_history(item_id);
`);

// Insert default categories if empty
const categoryCount = db.prepare('SELECT COUNT(*) as count FROM categories').get();
if (categoryCount.count === 0) {
  const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
  ['Food', 'Soap', 'Shampoo', 'Toothpaste', 'Drinks', 'Snacks', 'Other'].forEach(cat => {
    insertCategory.run(cat);
  });
  console.log('Default categories inserted');
}

// Insert default items if empty
const itemCount = db.prepare('SELECT COUNT(*) as count FROM items').get();
if (itemCount.count === 0) {
  const insertItem = db.prepare('INSERT INTO items (id, name, category, quantity, unit, min_stock) VALUES (?, ?, ?, ?, ?, ?)');
  const defaults = [
    ['1', 'Nasi Putih', 'Food', 2, 'cup', 5],
    ['2', 'Sabun Cuci Piring', 'Soap', 3, 'pcs', 1],
    ['3', 'Shampoo Sunsilk', 'Shampoo', 2, 'bottles', 1],
    ['4', 'Pepsodent', 'Toothpaste', 2, 'tubes', 1],
  ];
  defaults.forEach(item => insertItem.run(...item));
  console.log('Default items inserted');
}

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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

// ── INVENTORY API (SQLite) ────────────────────────────────────────────────

// Get all categories
app.get('/api/inventory/categories', (req, res) => {
  try {
    const rows = db.prepare('SELECT name FROM categories ORDER BY name').all();
    res.json({ categories: rows.map(r => r.name) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all items with optional filter
app.get('/api/inventory/items', (req, res) => {
  try {
    let sql = 'SELECT * FROM items';
    const params = [];
    const conditions = [];

    if (req.query.category && req.query.category !== 'all') {
      conditions.push('category = ?');
      params.push(req.query.category);
    }

    if (req.query.search) {
      conditions.push('name LIKE ?');
      params.push(`%${req.query.search}%`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY category, name';

    const items = db.prepare(sql).all(...params);
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single item
app.get('/api/inventory/items/:id', (req, res) => {
  try {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get item history
app.get('/api/inventory/items/:id/history', (req, res) => {
  try {
    const history = db.prepare('SELECT * FROM stock_history WHERE item_id = ? ORDER BY created_at DESC LIMIT 50').all(req.params.id);
    res.json({ history });
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
      const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

      db.prepare(`
        INSERT INTO items (id, name, category, quantity, unit, min_stock, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        newItem.name || 'Unnamed',
        newItem.category || 'Other',
        Number(newItem.quantity) || 0,
        newItem.unit || 'pcs',
        Number(newItem.min_stock) || 0,
        newItem.notes || ''
      );

      // Record initial stock in history
      db.prepare(`INSERT INTO stock_history (item_id, old_quantity, new_quantity, delta, reason) VALUES (?, ?, ?, ?, ?)`)
        .run(id, 0, Number(newItem.quantity) || 0, Number(newItem.quantity) || 0, 'initial');

      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
      res.json({ success: true, item });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
});

// Update item quantity (quick +/-)
app.patch('/api/inventory/items/:id/quantity', (req, res) => {
  let body = '' || '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const { delta, quantity, reason } = JSON.parse(body);
      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
      if (!item) return res.status(404).json({ error: 'Item not found' });

      let newQuantity;
      if (delta !== undefined) {
        newQuantity = Math.max(0, item.quantity + delta);
      } else if (quantity !== undefined) {
        newQuantity = Math.max(0, Number(quantity));
      } else {
        return res.status(400).json({ error: 'delta or quantity required' });
      }

      const actualDelta = newQuantity - item.quantity;

      db.prepare('UPDATE items SET quantity = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newQuantity, req.params.id);
      db.prepare(`INSERT INTO stock_history (item_id, old_quantity, new_quantity, delta, reason) VALUES (?, ?, ?, ?, ?)`)
        .run(req.params.id, item.quantity, newQuantity, actualDelta, reason || 'manual');

      const updatedItem = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
      res.json({ success: true, item: updatedItem });
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
      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
      if (!item) return res.status(404).json({ error: 'Item not found' });

      const fields = [];
      const values = [];

      if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
      if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category); }
      if (updates.quantity !== undefined) { fields.push('quantity = ?'); values.push(Number(updates.quantity)); }
      if (updates.unit !== undefined) { fields.push('unit = ?'); values.push(updates.unit); }
      if (updates.min_stock !== undefined) { fields.push('min_stock = ?'); values.push(Number(updates.min_stock)); }
      if (updates.notes !== undefined) { fields.push('notes = ?'); values.push(updates.notes); }

      fields.push('updated_at = datetime(\'now\')');
      values.push(req.params.id);

      db.prepare(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`).run(...values);

      // Record quantity change if quantity was updated
      if (updates.quantity !== undefined && updates.quantity !== item.quantity) {
        const delta = updates.quantity - item.quantity;
        db.prepare(`INSERT INTO stock_history (item_id, old_quantity, new_quantity, delta, reason) VALUES (?, ?, ?, ?, ?)`)
          .run(req.params.id, item.quantity, updates.quantity, delta, 'edit');
      }

      const updatedItem = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
      res.json({ success: true, item: updatedItem });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
});

// Delete item
app.delete('/api/inventory/items/:id', (req, res) => {
  try {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
    db.prepare('DELETE FROM stock_history WHERE item_id = ?').run(req.params.id);

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
      db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)').run(name);
      const rows = db.prepare('SELECT name FROM categories ORDER BY name').all();
      res.json({ success: true, categories: rows.map(r => r.name) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
});

// Get stock summary/stats
app.get('/api/inventory/summary', (req, res) => {
  try {
    const totalItems = db.prepare('SELECT COUNT(*) as count FROM items').get().count;
    const totalStock = db.prepare('SELECT COALESCE(SUM(quantity), 0) as total FROM items').get().total;
    const lowStock = db.prepare('SELECT COUNT(*) as count FROM items WHERE quantity <= min_stock').get().count;
    const categories = db.prepare('SELECT COUNT(DISTINCT category) as count FROM items').get().count;
    const recentChanges = db.prepare('SELECT COUNT(*) as count FROM stock_history WHERE created_at >= datetime(\'now\', \'-7 days\')').get().count;

    res.json({ totalItems, totalStock, lowStock, categories, recentChanges });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
