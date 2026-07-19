import { useState, useEffect, useRef } from 'react'
import { AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

const API = 'http://100.111.117.127:5174/api/stats'

interface SystemStats {
  cpus: number
  load: { load1: number; load5: number; load15: number }
  memory: { used: number; total: number; pct: number }
  disk: { used: number; total: number; pct: number }
  uptime: number
  processes: { user: string; pid: number; cpu: number; mem: number; command: string }[]
  timestamp: number
}

interface Capability {
  id: string
  name: string
  category: string
  status: 'online' | 'pending' | 'offline'
  description: string
  connections: string[]
  usage: number
}

interface Activity {
  id: string
  time: string
  action: string
  status: 'success' | 'warning' | 'error'
  app: string
}

interface Stat {
  label: string
  value: number
  suffix?: string
  trend?: number
}

// ── Mock Data ──────────────────────────────────────────────────────────────

const capabilities: Capability[] = [
  { id: '1', name: 'Apple Notes', category: 'Apple', status: 'online', description: 'Read, create, edit Apple Notes', connections: ['macOS', 'Apple ID'], usage: 12 },
  { id: '2', name: 'Apple Reminders', category: 'Apple', status: 'online', description: 'Manage reminders via CLI', connections: ['macOS', 'Apple ID'], usage: 8 },
  { id: '3', name: 'FindMy', category: 'Apple', status: 'online', description: 'Track devices/AirPods', connections: ['macOS', 'Apple ID'], usage: 3 },
  { id: '4', name: 'iMessage', category: 'Apple', status: 'online', description: 'Send/receive iMessages', connections: ['macOS', 'Apple ID'], usage: 15 },
  { id: '5', name: 'Claude Code', category: 'AI Agents', status: 'online', description: 'Delegate coding to Claude Code CLI', connections: ['Terminal', 'Claude API'], usage: 7 },
  { id: '6', name: 'Codex', category: 'AI Agents', status: 'online', description: 'Delegate coding to OpenAI Codex', connections: ['Terminal', 'OpenAI API'], usage: 4 },
  { id: '7', name: 'OpenCode', category: 'AI Agents', status: 'pending', description: 'Delegate coding to OpenCode', connections: ['Terminal'], usage: 0 },
  { id: '8', name: 'Computer Use', category: 'Core', status: 'online', description: 'Drive any GUI app in background', connections: ['macOS', 'cua-driver'], usage: 25 },
  { id: '9', name: 'Google Workspace', category: 'Productivity', status: 'online', description: 'Gmail, Calendar, Drive, Docs, Sheets', connections: ['Google API', 'OAuth'], usage: 18 },
  { id: '10', name: 'Notion', category: 'Productivity', status: 'online', description: 'Read, create, edit Notion pages', connections: ['Notion API'], usage: 5 },
  { id: '11', name: 'Airtable', category: 'Productivity', status: 'pending', description: 'CRUD on Airtable records', connections: ['Airtable API'], usage: 0 },
  { id: '12', name: 'GitHub', category: 'Dev Tools', status: 'online', description: 'PRs, issues, CI, repos', connections: ['GitHub API', 'SSH'], usage: 20 },
  { id: '13', name: 'PowerPoint', category: 'Productivity', status: 'online', description: 'Create/edit .pptx decks', connections: ['Microsoft Office'], usage: 6 },
  { id: '14', name: 'Excel', category: 'Productivity', status: 'online', description: 'Create/edit .xlsx files', connections: ['Microsoft Office'], usage: 4 },
  { id: '15', name: 'Word', category: 'Productivity', status: 'online', description: 'Create/edit .docx files', connections: ['Microsoft Office'], usage: 8 },
  { id: '16', name: 'Himalaya', category: 'Email', status: 'online', description: 'IMAP/SMTP email via CLI', connections: ['SMTP/IMAP'], usage: 3 },
  { id: '17', name: 'X/Twitter', category: 'Social', status: 'pending', description: 'Post, search, DMs via xurl', connections: ['Twitter API'], usage: 0 },
  { id: '18', name: 'YouTube', category: 'Media', status: 'online', description: 'Transcripts, summaries', connections: ['YouTube Data API'], usage: 9 },
  { id: '19', name: 'arXiv', category: 'Research', status: 'online', description: 'Search academic papers', connections: ['arXiv API'], usage: 6 },
  { id: '20', name: 'Polymarket', category: 'Research', status: 'pending', description: 'Query betting markets', connections: ['Polymarket API'], usage: 0 },
  { id: '21', name: 'Blogwatcher', category: 'Research', status: 'online', description: 'Monitor blogs/RSS feeds', connections: ['RSS'], usage: 4 },
  { id: '22', name: 'Comic/ASCII', category: 'Creative', status: 'online', description: 'ASCII art, comics, diagrams', connections: [], usage: 3 },
  { id: '23', name: 'Manim', category: 'Creative', status: 'pending', description: 'Math/algorithm animations', connections: ['FFmpeg'], usage: 0 },
  { id: '24', name: 'ComfyUI', category: 'Creative', status: 'pending', description: 'Image/video generation', connections: ['ComfyUI'], usage: 0 },
  { id: '25', name: 'p5.js', category: 'Creative', status: 'online', description: 'Generative art & shaders', connections: ['Browser'], usage: 2 },
  { id: '26', name: 'Philips Hue', category: 'Smart Home', status: 'pending', description: 'Light/scene control', connections: ['Hue Bridge'], usage: 0 },
  { id: '27', name: 'HuggingFace', category: 'ML/AI', status: 'online', description: 'Search/download models', connections: ['HF Hub'], usage: 5 },
  { id: '28', name: 'vLLM', category: 'ML/AI', status: 'pending', description: 'LLM serving/inference', connections: ['GPU'], usage: 0 },
  { id: '29', name: 'llama.cpp', category: 'ML/AI', status: 'online', description: 'Local GGUF inference', connections: ['GGUF models'], usage: 3 },
  { id: '30', name: 'W&B', category: 'ML/AI', status: 'pending', description: 'Experiment tracking', connections: ['W&B API'], usage: 0 },
]

const recentActivity: Activity[] = [
  { id: '1', time: '2 min ago', action: 'Apple Notes — created note', status: 'success', app: 'apple-notes' },
  { id: '2', time: '5 min ago', action: 'Computer Use — typed invoice in Word', status: 'success', app: 'computer-use' },
  { id: '3', time: '10 min ago', action: 'PostgreSQL — created dev + staging DBs', status: 'success', app: 'terminal' },
  { id: '4', time: '15 min ago', action: 'Claude — typed "hi" via computer_use', status: 'success', app: 'claude' },
  { id: '5', time: '20 min ago', action: 'python-docx — generated invoice', status: 'success', app: 'terminal' },
  { id: '6', time: '30 min ago', action: 'Computer Use — attempted Word click', status: 'warning', app: 'computer-use' },
  { id: '7', time: '1 hr ago', action: 'npm install — recharts + tailwind', status: 'success', app: 'terminal' },
  { id: '8', time: '2 hrs ago', action: 'brew install postgresql@16', status: 'success', app: 'terminal' },
  { id: '9', time: '3 hrs ago', action: 'Homebrew — cleanup', status: 'success', app: 'terminal' },
  { id: '10', time: '5 hrs ago', action: 'GitHub PR workflow — attempted', status: 'error', app: 'github' },
]

const tasksByHour = [
  { hour: '00', tasks: 0 }, { hour: '01', tasks: 0 }, { hour: '02', tasks: 0 },
  { hour: '03', tasks: 0 }, { hour: '04', tasks: 0 }, { hour: '05', tasks: 0 },
  { hour: '06', tasks: 0 }, { hour: '07', tasks: 0 }, { hour: '08', tasks: 1 },
  { hour: '09', tasks: 2 }, { hour: '10', tasks: 3 }, { hour: '11', tasks: 5 },
  { hour: '12', tasks: 8 }, { hour: '13', tasks: 4 }, { hour: '14', tasks: 6 },
  { hour: '15', tasks: 3 }, { hour: '16', tasks: 2 }, { hour: '17', tasks: 1 },
  { hour: '18', tasks: 0 }, { hour: '19', tasks: 0 }, { hour: '20', tasks: 0 },
  { hour: '21', tasks: 0 }, { hour: '22', tasks: 0 }, { hour: '23', tasks: 0 },
]

const categoryData = [
  { name: 'Apple', value: 4, color: '#6366f1' },
  { name: 'AI Agents', value: 3, color: '#8b5cf6' },
  { name: 'Core', value: 1, color: '#a855f7' },
  { name: 'Productivity', value: 5, color: '#d946ef' },
  { name: 'Dev Tools', value: 1, color: '#ec4899' },
  { name: 'Email', value: 1, color: '#f43f5e' },
  { name: 'Social', value: 1, color: '#ef4444' },
  { name: 'Media', value: 1, color: '#f97316' },
  { name: 'Research', value: 3, color: '#f59e0b' },
  { name: 'Creative', value: 4, color: '#eab308' },
  { name: 'Smart Home', value: 1, color: '#84cc16' },
  { name: 'ML/AI', value: 4, color: '#22c55e' },
]

const connectionData = [
  { name: 'macOS', count: 5 }, { name: 'Terminal', count: 8 },
  { name: 'Google API', count: 1 }, { name: 'GitHub API', count: 1 },
  { name: 'Notion API', count: 1 }, { name: 'Claude API', count: 1 },
  { name: 'OpenAI API', count: 1 }, { name: 'Apple ID', count: 4 },
  { name: 'cua-driver', count: 1 }, { name: 'SSH', count: 1 },
  { name: 'SMTP/IMAP', count: 1 }, { name: 'YouTube Data API', count: 1 },
  { name: 'arXiv API', count: 1 }, { name: 'RSS', count: 1 },
]

// ── Components ──────────────────────────────────────────────────────────────

const StatusBadge = ({ status }: { status: Capability['status'] }) => {
  const cls = status === 'online' ? 'badge-green' : status === 'pending' ? 'badge-amber' : 'badge-red'
  const dot = status === 'online' ? '🟢' : status === 'pending' ? '🟡' : '🔴'
  return <span className={`badge ${cls}`}> {dot} {status}</span>
}

const formatBytes = (bytes: number) => {
  const gb = bytes / (1024 ** 3)
  return `${gb.toFixed(1)} GB`
}

const formatUptime = (seconds: number) => {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${d}d ${h}h ${m}m`
}

const StatCard = ({ label, value, suffix, trend }: Stat & { trend?: number }) => (
  <div className="card">
    <div className="stat-value">{value}{suffix}</div>
    <div className="stat-label">{label}</div>
    {trend !== undefined && (
      <div className={`mt-2 text-sm ${trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
        {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}%
      </div>
    )}
  </div>
)

// ── Nav Item Type ───────────────────────────────────────────────────────────

type TabId = 'dashboard' | 'chat' | 'system' | 'capabilities' | 'activity' | 'connections'

interface NavItem {
  id: TabId
  icon: string
  label: string
}

const navItems: NavItem[] = [
  { id: 'dashboard', icon: '📊', label: 'Dashboard' },
  { id: 'chat', icon: '💬', label: 'Chat' },
  { id: 'system', icon: '🖥️', label: 'System' },
  { id: 'capabilities', icon: '⚡', label: 'Capabilities' },
  { id: 'activity', icon: '📜', label: 'Activity Log' },
  { id: 'connections', icon: '🔗', label: 'Connections' },
]

// ── Main App ───────────────────────────────────────────────────────────────

export default function App() {
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [timeRange, setTimeRange] = useState('24h')
  const [activeTab, setActiveTab] = useState<TabId>('dashboard')
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [history, setHistory] = useState<{ time: string; cpu: number; mem: number }[]>([])
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(API)
        const data = await res.json()
        setStats(data)
        const now = new Date()
        const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
        setHistory(prev => {
          const next = [...prev, { time, cpu: Math.round((data.load.load1 / data.cpus) * 100), mem: data.memory.pct }]
          return next.slice(-20)
        })
      } catch {}
    }
    fetchStats()
    const interval = setInterval(fetchStats, 2000)
    return () => clearInterval(interval)
  }, [])

  const filtered = capabilities.filter(c => {
    if (filter !== 'all' && c.category !== filter) return false
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const categories = Array.from(new Set(capabilities.map(c => c.category)))

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <div>
            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <StatCard label="Total Capabilities" value={capabilities.length} trend={12} />
              <StatCard label="Active Now" value={capabilities.filter(c => c.status === 'online').length} />
              <StatCard label="Pending Setup" value={capabilities.filter(c => c.status === 'pending').length} />
              <StatCard label="Connections" value={connectionData.length} />
            </div>

            {/* Charts Row */}
            <div className="grid md:grid-cols-3 gap-6 mb-6">
              <div className="card md:col-span-2">
                <h2 className="text-lg font-semibold text-white mb-4">📈 Task Activity (Last 24h)</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={tasksByHour}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="hour" stroke="#94a3b8" fontSize={12} />
                    <YAxis stroke="#94a3b8" fontSize={12} />
                    <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569' }} />
                    <Area type="monotone" dataKey="tasks" stroke="#8b5cf6" fill="#8b5cf620" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="card">
                <h2 className="text-lg font-semibold text-white mb-4">🎯 Categories</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`} labelLine={false}>
                      {categoryData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Connections Chart */}
            <div className="card mb-6">
              <h2 className="text-lg font-semibold text-white mb-4">🔗 Active Connections</h2>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={connectionData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} angle={-20} textAnchor="end" height={60} />
                  <YAxis stroke="#94a3b8" fontSize={12} />
                  <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569' }} />
                  <Bar dataKey="count" fill="#a855f7" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Recent Activity */}
            <div className="card">
              <h2 className="text-lg font-semibold text-white mb-4">📜 Recent Activity</h2>
              <div className="space-y-3">
                {recentActivity.slice(0, 5).map(act => (
                  <div key={act.id} className="flex items-center gap-4 bg-slate-900 rounded-lg p-3 border border-slate-700">
                    <div className={`w-2 h-2 rounded-full ${act.status === 'success' ? 'bg-green-400' : act.status === 'warning' ? 'bg-amber-400' : 'bg-red-400'}`} />
                    <div className="flex-1">
                      <p className="text-sm text-slate-200">{act.action}</p>
                      <p className="text-xs text-slate-500">{act.app}</p>
                    </div>
                    <span className="text-xs text-slate-500">{act.time}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )

      case 'chat':
        return (
          <div className="card">
            <h2 className="text-lg font-semibold text-white mb-4">💬 Chat with Horus</h2>
            <div className="h-96 overflow-y-auto bg-slate-900 rounded-lg p-4 mb-4 space-y-3 border border-slate-700">
              {chatMessages.length === 0 && (
                <div className="text-center text-slate-500 mt-16">
                  <p className="text-4xl mb-2">🦅</p>
                  <p>Chat with Horus directly from the dashboard.</p>
                  <p className="text-sm mt-1">Type a message below to start.</p>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                    msg.role === 'user'
                      ? 'bg-violet-600 text-white rounded-br-sm'
                      : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-bl-sm'
                  }`}>
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="bg-slate-800 rounded-2xl px-4 py-2.5 text-violet-400 text-sm border border-slate-700 rounded-bl-sm">
                    <span className="flex items-center gap-2">
                      <span className="flex gap-1">
                        <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce" />
                        <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                        <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                      </span>
                      Thinking...
                    </span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                const text = chatInput.trim()
                if (!text || chatLoading) return
                setChatMessages(prev => [...prev, { role: 'user', content: text }])
                setChatInput('')
                setChatLoading(true)
                try {
                  const res = await fetch('http://100.111.117.127:5174/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt: text }),
                  })
                  const reader = res.body?.getReader()
                  const decoder = new TextDecoder()
                  let assistantMsg = ''
                  setChatMessages(prev => [...prev, { role: 'assistant', content: '' }])
                  while (reader) {
                    const { done, value } = await reader.read()
                    if (done) break
                    const chunk = decoder.decode(value)
                    const lines = chunk.split('\n')
                    for (const line of lines) {
                      if (line.startsWith('data: ')) {
                        try {
                          const data = JSON.parse(line.slice(6))
                          if (data.chunk !== undefined) {
                            assistantMsg += data.chunk
                            setChatMessages(prev => {
                              const updated = [...prev]
                              updated[updated.length - 1] = { role: 'assistant', content: assistantMsg }
                              return updated
                            })
                          }
                        } catch {}
                      }
                    }
                  }
                } catch (err) {
                  setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err}` }])
                } finally {
                  setChatLoading(false)
                }
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                placeholder="Type a message to Horus..."
                className="flex-1 bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500 transition-colors"
              />
              <button
                type="submit"
                disabled={chatLoading}
                className="bg-violet-600 hover:bg-violet-700 text-white px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                Send
              </button>
            </form>
          </div>
        )

      case 'system':
        return (
          <div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <StatCard label="CPU Cores" value={stats?.cpus ?? 0} />
              <StatCard label="CPU Load" value={stats?.load.load1?.toFixed(1) ?? '0'} trend={stats ? Math.round((stats.load.load1 / stats.cpus) * 100) : 0} />
              <StatCard label="Memory" value={stats?.memory.pct ?? 0} suffix="%" />
              <StatCard label="Disk" value={stats?.disk.pct ?? 0} suffix="%" />
            </div>
            <div className="grid md:grid-cols-2 gap-6 mb-6">
              <div className="card">
                <h2 className="text-lg font-semibold text-white mb-4">💾 Memory</h2>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Used: {stats ? formatBytes(stats.memory.used) : '—'}</span>
                  <span className="text-xs text-slate-400">Total: {stats ? formatBytes(stats.memory.total) : '—'}</span>
                </div>
                <div className="overflow-hidden h-3 text-xs flex rounded bg-slate-700 mt-2">
                  <div style={{ width: `${stats?.memory.pct ?? 0}%` }} className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-gradient-to-r from-violet-500 to-purple-600 transition-all duration-500" />
                </div>
                <div className="mt-2 text-sm text-slate-300">{stats?.memory.pct ?? 0}% utilized</div>
              </div>
              <div className="card">
                <h2 className="text-lg font-semibold text-white mb-4">📁 Disk</h2>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Used: {stats ? formatBytes(stats.disk.used) : '—'}</span>
                  <span className="text-xs text-slate-400">Total: {stats ? formatBytes(stats.disk.total) : '—'}</span>
                </div>
                <div className="overflow-hidden h-3 text-xs flex rounded bg-slate-700 mt-2">
                  <div style={{ width: `${stats?.disk.pct ?? 0}%` }} className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-gradient-to-r from-amber-500 to-orange-600 transition-all duration-500" />
                </div>
                <div className="mt-2 text-sm text-slate-300">{stats?.disk.pct ?? 0}% utilized</div>
              </div>
            </div>
            <div className="card mb-6">
              <h2 className="text-lg font-semibold text-white mb-4">📊 Load Averages & Uptime</h2>
              <div className="grid grid-cols-4 gap-4 text-center">
                <div><div className="text-2xl font-bold text-violet-400">{stats?.load.load1?.toFixed(2) ?? '—'}</div><div className="text-xs text-slate-500 mt-1">1m</div></div>
                <div><div className="text-2xl font-bold text-blue-400">{stats?.load.load5?.toFixed(2) ?? '—'}</div><div className="text-xs text-slate-500 mt-1">5m</div></div>
                <div><div className="text-2xl font-bold text-green-400">{stats?.load.load15?.toFixed(2) ?? '—'}</div><div className="text-xs text-slate-500 mt-1">15m</div></div>
                <div><div className="text-2xl font-bold text-amber-400">{stats ? formatUptime(stats.uptime) : '—'}</div><div className="text-xs text-slate-500 mt-1">Uptime</div></div>
              </div>
            </div>
            <div className="card mb-6">
              <h2 className="text-lg font-semibold text-white mb-4">📈 Load History</h2>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="time" stroke="#94a3b8" fontSize={12} />
                  <YAxis stroke="#94a3b8" fontSize={12} />
                  <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569' }} />
                  <Line type="monotone" dataKey="cpu" stroke="#8b5cf6" strokeWidth={2} name="CPU %" dot={false} />
                  <Line type="monotone" dataKey="mem" stroke="#22c55e" strokeWidth={2} name="Memory %" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="card">
              <h2 className="text-lg font-semibold text-white mb-4">⚡ Top Processes by CPU</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-700">
                      <th className="pb-2 pr-4">PID</th>
                      <th className="pb-2 pr-4">USER</th>
                      <th className="pb-2 pr-4">CPU%</th>
                      <th className="pb-2 pr-4">MEM%</th>
                      <th className="pb-2">COMMAND</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats?.processes.map(proc => (
                      <tr key={proc.pid} className="border-b border-slate-700/50 hover:bg-slate-800/50">
                        <td className="py-2 pr-4 text-slate-400 font-mono">{proc.pid}</td>
                        <td className="py-2 pr-4 text-slate-400">{proc.user}</td>
                        <td className="py-2 pr-4">
                          <span className={`font-medium ${proc.cpu > 50 ? 'text-red-400' : proc.cpu > 10 ? 'text-amber-400' : 'text-green-400'}`}>
                            {proc.cpu}%
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-slate-300">{proc.mem}%</td>
                        <td className="py-2 text-slate-300 font-mono text-xs truncate max-w-xs">{proc.command}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="mt-4 text-center">
              <span className="text-xs text-slate-500">
                Last updated: {stats ? new Date(stats.timestamp).toLocaleTimeString() : '—'} • Auto-refreshes every 2s
              </span>
            </div>
          </div>
        )

      case 'capabilities':
        return (
          <div className="card">
            <h2 className="text-lg font-semibold text-white mb-4">⚡ Capabilities</h2>
            <div className="flex flex-wrap gap-4 mb-6">
              <input
                type="text"
                placeholder="🔍 Search capabilities..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500"
              />
              <select
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-violet-500"
              >
                <option value="all">All Categories</option>
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(cap => (
                <div key={cap.id} className="bg-slate-900 rounded-lg p-4 border border-slate-700 hover:border-violet-500 transition-colors">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-white text-sm">{cap.name}</h3>
                    <StatusBadge status={cap.status} />
                  </div>
                  <p className="text-xs text-slate-400 mb-3">{cap.description}</p>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {cap.connections.map(conn => (
                      <span key={conn} className="badge badge-blue">{conn}</span>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-700">
                    <span className="text-xs text-slate-500">{cap.category}</span>
                    <span className="text-xs text-violet-400">{cap.usage} uses</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )

      case 'activity':
        return (
          <div className="card">
            <h2 className="text-lg font-semibold text-white mb-4">📜 Recent Activity</h2>
            <div className="flex items-center justify-between mb-4">
              <select value={timeRange} onChange={e => setTimeRange(e.target.value)} className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-1 text-sm text-slate-200">
                <option value="1h">Last hour</option>
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
              </select>
            </div>
            <div className="space-y-3">
              {recentActivity.map(act => (
                <div key={act.id} className="flex items-center gap-4 bg-slate-900 rounded-lg p-3 border border-slate-700">
                  <div className={`w-2 h-2 rounded-full ${act.status === 'success' ? 'bg-green-400' : act.status === 'warning' ? 'bg-amber-400' : 'bg-red-400'}`} />
                  <div className="flex-1">
                    <p className="text-sm text-slate-200">{act.action}</p>
                    <p className="text-xs text-slate-500">{act.app}</p>
                  </div>
                  <span className="text-xs text-slate-500">{act.time}</span>
                </div>
              ))}
            </div>
          </div>
        )

      case 'connections':
        return (
          <div className="card">
            <h2 className="text-lg font-semibold text-white mb-4">🔗 Connections Map</h2>
            <p className="text-sm text-slate-400 mb-6">Which external apps and services Hermes can connect to</p>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {connectionData.map(conn => (
                <div key={conn.name} className="flex items-center justify-between bg-slate-900 rounded-lg p-4 border border-slate-700">
                  <div>
                    <p className="font-medium text-white text-sm">{conn.name}</p>
                    <p className="text-xs text-slate-500">{conn.count} capability{conn.count !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-violet-900/50 border border-violet-500 flex items-center justify-center text-violet-400 font-bold text-sm">
                    {conn.count}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div className="flex min-h-screen bg-slate-900">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 border-r border-slate-700 p-6 flex flex-col">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">🦅 Horus</h1>
          <p className="text-sm text-slate-500">System Monitor</p>
        </div>
        <nav className="flex-1 space-y-1">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                activeTab === item.id
                  ? 'bg-violet-600/20 text-violet-400 border-l-2 border-violet-500 font-medium'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white border-l-2 border-transparent'
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="mt-auto pt-6 border-t border-slate-700">
          <p className="text-xs text-slate-600">Horus v1.0</p>
          <p className="text-xs text-slate-600">Maya's Instance</p>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 overflow-y-auto">
        {renderContent()}
      </main>
    </div>
  )
}
