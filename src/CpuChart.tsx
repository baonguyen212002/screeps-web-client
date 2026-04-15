type DataPoint = { cpu: number; memory: number }

const W = 192
const H = 72
const PAD = { top: 6, right: 4, bottom: 18, left: 30 }
const CW = W - PAD.left - PAD.right
const CH = H - PAD.top - PAD.bottom

export default function CpuChart({ data, cpuLimit }: { data: DataPoint[]; cpuLimit?: number }) {
  if (data.length < 2) {
    return (
      <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>Waiting for data…</span>
      </div>
    )
  }

  const maxCpu = Math.max(cpuLimit ?? 0, ...data.map((d) => d.cpu), 5) * 1.15
  const maxMem = Math.max(...data.map((d) => d.memory), 1024) * 1.1

  function x(i: number) { return PAD.left + (i / (data.length - 1)) * CW }
  function cy(v: number) { return PAD.top + CH - (v / maxCpu) * CH }
  function my(v: number) { return PAD.top + CH - (v / maxMem) * CH }

  const cpuPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${cy(d.cpu).toFixed(1)}`).join(' ')
  const memPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${my(d.memory).toFixed(1)}`).join(' ')

  const last = data[data.length - 1]
  const memKb = (last.memory / 1024).toFixed(0)
  const limitY = cpuLimit != null && cpuLimit <= maxCpu ? cy(cpuLimit) : null

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      {/* grid */}
      {[0, 0.5, 1].map((f) => (
        <line key={f}
          x1={PAD.left} y1={PAD.top + CH * (1 - f)}
          x2={PAD.left + CW} y2={PAD.top + CH * (1 - f)}
          stroke="rgba(255,255,255,0.07)" strokeWidth={1}
        />
      ))}
      {/* cpu limit */}
      {limitY != null && (
        <line x1={PAD.left} y1={limitY} x2={PAD.left + CW} y2={limitY}
          stroke="rgba(239,68,68,0.45)" strokeWidth={1} strokeDasharray="3,3"
        />
      )}
      {/* memory line */}
      <path d={memPath} fill="none" stroke="#4bcffa" strokeWidth={1.5} opacity={0.65} />
      {/* cpu line */}
      <path d={cpuPath} fill="none" stroke="#ffe56d" strokeWidth={1.5} />
      {/* y-axis labels */}
      <text x={PAD.left - 3} y={PAD.top + 4} fill="#ffe56d" fontSize={7} textAnchor="end">{Math.round(maxCpu)}</text>
      <text x={PAD.left - 3} y={PAD.top + CH + 4} fill="#ffe56d" fontSize={7} textAnchor="end">0</text>
      {/* legend */}
      <text x={PAD.left} y={H - 2} fill="#ffe56d" fontSize={8}>CPU {last.cpu.toFixed(1)}</text>
      <text x={PAD.left + 68} y={H - 2} fill="#4bcffa" fontSize={8}>Mem {memKb} KB</text>
    </svg>
  )
}
