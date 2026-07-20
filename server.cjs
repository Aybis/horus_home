const express = require('express');
const { cpus, totalmem, loadavg, uptime } = require('os');
const { execSync, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = 5174;
const DB_PATH = path.join(__dirname, 'horus.db');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Initialize SQLite database
const db = new Database(DB_PATH);
console.log(`SQLite database initialized at ${DB_PATH}`);

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

  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT,
    vendor TEXT NOT NULL,
    date TEXT,
    subtotal REAL DEFAULT 0,
    tax REAL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    currency TEXT DEFAULT 'IDR',
    category TEXT DEFAULT 'Other',
    notes TEXT DEFAULT '',
    status TEXT DEFAULT 'unpaid',
    document_path TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    quantity REAL DEFAULT 1,
    unit_price REAL DEFAULT 0,
    total REAL DEFAULT 0,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
  CREATE INDEX IF NOT EXISTS idx_stock_history_item_id ON stock_history(item_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_vendor ON invoices(vendor);
  CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date);
  CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
`);

// Seed default data
const categoryCount = db.prepare('SELECT COUNT(*) as count FROM categories').get();
if (categoryCount.count === 0) {
  const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
  ['Food', 'Soap', 'Shampoo', 'Toothpaste', 'Drinks', 'Snacks', 'Other'].forEach(cat => insertCategory.run(cat));
}

const itemCount = db.prepare('SELECT COUNT(*) as count FROM items').get();
if (itemCount.count === 0) {
  const insertItem = db.prepare('INSERT INTO items (id, name, category, quantity, unit, min_stock) VALUES (?, ?, ?, ?, ?, ?)');
  [['1', 'Nasi Putih', 'Food', 2, 'cup', 5], ['2', 'Sabun Cuci Piring', 'Soap', 3, 'pcs', 1], ['3', 'Shampoo Sunsilk', 'Shampoo', 2, 'bottles', 1], ['4', 'Pepsodent', 'Toothpaste', 2, 'tubes', 1]].forEach(item => insertItem.run(...item));
}

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.use('/uploads', express.static(UPLOAD_DIR));

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
        return { user: parts[0], pid: parseInt(parts[1]), cpu: parseFloat(parts[2]), mem: parseFloat(parts[3]), command: parts.slice(10).join(' ').substring(0, 60) };
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

    res.json({ cpus: cpuCount, load: { load1: Math.round(load1 * 100) / 100, load5: Math.round(load5 * 100) / 100, load15: Math.round(load15 * 100) / 100 }, memory: { used: usedMem, total: totalMem, pct: memPct }, disk, uptime: sysUptime, processes, timestamp: Date.now() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── INVENTORY API ──────────────────────────────────────────────────────────

app.get('/api/inventory/categories', (req, res) => {
  try {
    const rows = db.prepare('SELECT name FROM categories ORDER BY name').all();
    res.json({ categories: rows.map(r => r.name) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/inventory/items', (req, res) => {
  try {
    let sql = 'SELECT * FROM items'; const params = []; const conditions = [];
    if (req.query.category && req.query.category !== 'all') { conditions.push('category = ?'); params.push(req.query.category); }
    if (req.query.search) { conditions.push('name LIKE ?'); params.push(`%${req.query.search}%`); }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY category, name';
    const items = db.prepare(sql).all(...params);
    res.json({ items });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/inventory/items/:id', (req, res) => {
  try {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({ item });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/inventory/items/:id/history', (req, res) => {
  try {
    const history = db.prepare('SELECT * FROM stock_history WHERE item_id = ? ORDER BY created_at DESC LIMIT 50').all(req.params.id);
    res.json({ history });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/inventory/items', (req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const newItem = JSON.parse(body);
      const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
      db.prepare('INSERT INTO items (id, name, category, quantity, unit, min_stock, notes) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, newItem.name || 'Unnamed', newItem.category || 'Other', Number(newItem.quantity) || 0, newItem.unit || 'pcs', Number(newItem.min_stock) || 0, newItem.notes || '');
      db.prepare('INSERT INTO stock_history (item_id, old_quantity, new_quantity, delta, reason) VALUES (?, ?, ?, ?, ?)').run(id, 0, Number(newItem.quantity) || 0, Number(newItem.quantity) || 0, 'initial');
      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
      res.json({ success: true, item });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
});

app.patch('/api/inventory/items/:id/quantity', (req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const { delta, quantity, reason } = JSON.parse(body);
      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
      if (!item) return res.status(404).json({ error: 'Item not found' });
      let newQuantity;
      if (delta !== undefined) newQuantity = Math.max(0, item.quantity + delta);
      else if (quantity !== undefined) newQuantity = Math.max(0, Number(quantity));
      else return res.status(400).json({ error: 'delta or quantity required' });
      const actualDelta = newQuantity - item.quantity;
      db.prepare('UPDATE items SET quantity = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newQuantity, req.params.id);
      db.prepare('INSERT INTO stock_history (item_id, old_quantity, new_quantity, delta, reason) VALUES (?, ?, ?, ?, ?)').run(req.params.id, item.quantity, newQuantity, actualDelta, reason || 'manual');
      const updatedItem = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
      res.json({ success: true, item: updatedItem });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
});

app.put('/api/inventory/items/:id', (req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const updates = JSON.parse(body);
      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
      if (!item) return res.status(404).json({ error: 'Item not found' });
      const fields = []; const values = [];
      if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
      if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category); }
      if (updates.quantity !== undefined) { fields.push('quantity = ?'); values.push(Number(updates.quantity)); }
      if (updates.unit !== undefined) { fields.push('unit = ?'); values.push(updates.unit); }
      if (updates.min_stock !== undefined) { fields.push('min_stock = ?'); values.push(Number(updates.min_stock)); }
      if (updates.notes !== undefined) { fields.push('notes = ?'); values.push(updates.notes); }
      fields.push('updated_at = datetime(\'now\')'); values.push(req.params.id);
      db.prepare(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      if (updates.quantity !== undefined && updates.quantity !== item.quantity) {
        const delta = updates.quantity - item.quantity;
        db.prepare('INSERT INTO stock_history (item_id, old_quantity, new_quantity, delta, reason) VALUES (?, ?, ?, ?, ?)').run(req.params.id, item.quantity, updates.quantity, delta, 'edit');
      }
      const updatedItem = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
      res.json({ success: true, item: updatedItem });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
});

app.delete('/api/inventory/items/:id', (req, res) => {
  try {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
    db.prepare('DELETE FROM stock_history WHERE item_id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/inventory/categories', (req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const { name } = JSON.parse(body);
      db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)').run(name);
      const rows = db.prepare('SELECT name FROM categories ORDER BY name').all();
      res.json({ success: true, categories: rows.map(r => r.name) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
});

app.get('/api/inventory/summary', (req, res) => {
  try {
    const totalItems = db.prepare('SELECT COUNT(*) as count FROM items').get().count;
    const totalStock = db.prepare('SELECT COALESCE(SUM(quantity), 0) as total FROM items').get().total;
    const lowStock = db.prepare('SELECT COUNT(*) as count FROM items WHERE quantity <= min_stock').get().count;
    const categories = db.prepare('SELECT COUNT(DISTINCT category) as count FROM items').get().count;
    const recentChanges = db.prepare('SELECT COUNT(*) as count FROM stock_history WHERE created_at >= datetime(\'now\', \'-7 days\')').get().count;
    res.json({ totalItems, totalStock, lowStock, categories, recentChanges });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── INVOICE API ────────────────────────────────────────────────────────────

app.get('/api/invoices', (req, res) => {
  try {
    let sql = 'SELECT * FROM invoices';
    const params = []; const conditions = [];
    if (req.query.status && req.query.status !== 'all') { conditions.push('status = ?'); params.push(req.query.status); }
    if (req.query.vendor) { conditions.push('vendor LIKE ?'); params.push(`%${req.query.vendor}%`); }
    if (req.query.category && req.query.category !== 'all') { conditions.push('category = ?'); params.push(req.query.category); }
    if (req.query.from) { conditions.push('date >= ?'); params.push(req.query.from); }
    if (req.query.to) { conditions.push('date <= ?'); params.push(req.query.to); }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY date DESC, created_at DESC';
    const invoices = db.prepare(sql).all(...params);
    res.json({ invoices });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/invoices/summary', (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as sum FROM invoices').get();
    const paid = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as sum FROM invoices WHERE status = \'paid\'').get();
    const unpaid = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as sum FROM invoices WHERE status = \'unpaid\'').get();
    const overdue = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as sum FROM invoices WHERE status = \'unpaid\' AND date < date(\'now\', \'-30 days\')').get();
    const byCategory = db.prepare('SELECT category, COUNT(*) as count, SUM(total) as total FROM invoices GROUP BY category ORDER BY total DESC').all();
    const recent = db.prepare('SELECT vendor, total, date, status FROM invoices ORDER BY created_at DESC LIMIT 5').all();
    res.json({
      total: { count: total.count, sum: total.sum },
      paid: { count: paid.count, sum: paid.sum },
      unpaid: { count: unpaid.count, sum: unpaid.sum },
      overdue: { count: overdue.count, sum: overdue.sum },
      byCategory, recent
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/invoices/:id', (req, res) => {
  try {
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(req.params.id);
    res.json({ invoice, items });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/invoices', (req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      const result = db.prepare(`
        INSERT INTO invoices (invoice_number, vendor, date, subtotal, tax, total, currency, category, notes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.invoice_number || null, data.vendor || 'Unknown', data.date || null,
        Number(data.subtotal) || 0, Number(data.tax) || 0, Number(data.total) || 0,
        data.currency || 'IDR', data.category || 'Other', data.notes || '', data.status || 'unpaid'
      );
      const invoiceId = result.lastInsertRowid;
      if (data.items && Array.isArray(data.items)) {
        const insertItem = db.prepare('INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total) VALUES (?, ?, ?, ?, ?)');
        data.items.forEach(item => {
          insertItem.run(invoiceId, item.description || '', Number(item.quantity) || 1, Number(item.unit_price) || 0, Number(item.total) || 0);
        });
      }
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
      res.json({ success: true, invoice });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
});

app.put('/api/invoices/:id', (req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      const fields = []; const values = [];
      if (data.invoice_number !== undefined) { fields.push('invoice_number = ?'); values.push(data.invoice_number); }
      if (data.vendor !== undefined) { fields.push('vendor = ?'); values.push(data.vendor); }
      if (data.date !== undefined) { fields.push('date = ?'); values.push(data.date); }
      if (data.subtotal !== undefined) { fields.push('subtotal = ?'); values.push(Number(data.subtotal)); }
      if (data.tax !== undefined) { fields.push('tax = ?'); values.push(Number(data.tax)); }
      if (data.total !== undefined) { fields.push('total = ?'); values.push(Number(data.total)); }
      if (data.currency !== undefined) { fields.push('currency = ?'); values.push(data.currency); }
      if (data.category !== undefined) { fields.push('category = ?'); values.push(data.category); }
      if (data.notes !== undefined) { fields.push('notes = ?'); values.push(data.notes); }
      if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
      if (fields.length > 0) {
        fields.push('updated_at = datetime(\'now\')'); values.push(req.params.id);
        db.prepare(`UPDATE invoices SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      }
      const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
      res.json({ success: true, invoice: updated });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
});

app.delete('/api/invoices/:id', (req, res) => {
  try {
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
    db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/invoices/:id/items', (req, res) => {
  try {
    const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(req.params.id);
    res.json({ items });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── INVOICE OCR (AI VISION) ───────────────────────────────────────────────

let multer;
try {
  multer = require('multer');
} catch (e) {
  console.error('multer not installed - invoice scan disabled');
}

if (multer) {
  const upload = multer({ dest: UPLOAD_DIR + '/' });

  app.post('/api/invoices/scan', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
      // Read image as base64
      const imageBuffer = fs.readFileSync(req.file.path);
      const base64Image = imageBuffer.toString('base64');
      const mimeType = req.file.mimetype || 'image/jpeg';
      const dataUrl = `data:${mimeType};base64,${base64Image}`;

      const docFilename = `invoice_${Date.now()}_${req.file.originalname}`;
      const savedPath = path.join(UPLOAD_DIR, docFilename);
      fs.renameSync(req.file.path, savedPath);

      // Use OpenRouter with a cheap vision model
      const prompt = `Look at this invoice/receipt image and extract the following as JSON:
{
  "invoice_number": "string or null",
  "vendor": "store/company name",
  "date": "invoice date in YYYY-MM-DD format or null",
  "subtotal": number,
  "tax": number,
  "total": number,
  "currency": "IDR or other",
  "category": "Food/Utilities/Transport/etc",
  "items": [
    {"description": "item name", "quantity": number, "unit_price": number, "total": number}
  ]
}

Extract all text visible. Return ONLY valid JSON. No explanation.`;

      const apiBody = JSON.stringify({
        model: process.env.SURPLUS_VISION_MODEL || 'claude-fable-5',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }],
        max_tokens: 1024,
        temperature: 0
      });

      const https = require('https');
      const apiReq = https.request({
        hostname: 'api.surplusintelligence.ai',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SURPLUS_API_KEY || 'inf_d00b4eeb4a204c30bb7419bac8c00cba'}`
        }
      }, (apiRes) => {
        let responseData = '';
        apiRes.on('data', chunk => responseData += chunk);
        apiRes.on('end', () => {
          try {
            const parsed = JSON.parse(responseData);
            if (parsed.error) {
              console.error('[SCAN API ERROR]', JSON.stringify(parsed.error));
              res.json({ success: false, error: parsed.error.message || 'API error', raw: responseData, document_path: `/uploads/${docFilename}` });
            } else {
              const output = parsed.choices?.[0]?.message?.content || '';
              res.json({ success: true, raw: output, document_path: `/uploads/${docFilename}` });
            }
          } catch {
            console.error('[SCAN PARSE ERROR]', responseData.substring(0, 500));
            res.json({ success: false, raw: responseData, document_path: `/uploads/${docFilename}` });
          }
        });
      });

      apiReq.on('error', (err) => {
        console.error('[SCAN ERROR]', err.message);
        res.json({ success: false, error: err.message, raw: '', document_path: `/uploads/${docFilename}` });
      });

      apiReq.write(apiBody);
      apiReq.end();
    } catch (err) {
      console.error('[SCAN EXCEPTION]', err.message);
      res.status(500).json({ error: err.message });
    }
  });
}

// Chat endpoint
app.post('/api/chat', (req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const { prompt } = JSON.parse(body);
      if (!prompt) { res.status(400).json({ error: 'Prompt is required' }); return; }
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
        } catch (e) { console.error('[CHAT USAGE ERROR]', e.message); }
        res.write(`data: ${JSON.stringify({ chunk: output, usage, elapsed: Math.round(elapsed / 1000) })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Horus API running on http://0.0.0.0:${PORT}`);
});
