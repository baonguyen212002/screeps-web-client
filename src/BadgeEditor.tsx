import { useEffect, useRef, useState, useCallback } from 'react'

interface BadgeEditorProps {
  onSave: (badge: unknown) => Promise<void>
  onClose: () => void
}

const COLORS = [
  '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
  '#000000', '#ff8000', '#8000ff', '#0080ff', '#ff0080', '#80ff00', '#00ff80',
]

export default function BadgeEditor({ onSave, onClose }: BadgeEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [color, setColor] = useState('#ffffff')
  const [secondaryColor, setSecondaryColor] = useState('#000000')
  const [type, setType] = useState(1)
  const [saving, setSaving] = useState(false)

  const updatePreview = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, 200, 200)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(100, 100, 90, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = secondaryColor
    if (type === 1) {
      ctx.beginPath(); ctx.arc(100, 100, 40, 0, Math.PI * 2); ctx.fill()
    } else if (type === 2) {
      ctx.fillRect(80, 40, 40, 120)
    } else if (type === 3) {
      ctx.beginPath(); ctx.moveTo(100, 50); ctx.lineTo(150, 140); ctx.lineTo(50, 140); ctx.closePath(); ctx.fill()
    }
  }, [color, secondaryColor, type])

  useEffect(() => {
    void updatePreview()
  }, [updatePreview])

  async function handleSave() {
    setSaving(true)
    try {
      await onSave({ color, secondaryColor, type })
      onClose()
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" style={{ width: 400 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="panel-title">Badge Editor</span>
          <button className="btn-ghost compact" onClick={onClose}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 20, padding: 20 }}>
          <canvas ref={canvasRef} width={200} height={200} style={{ width: 140, height: 140, background: '#111', borderRadius: '50%' }} />
          
          <div className="stack" style={{ flex: 1 }}>
            <div className="muted" style={{ fontSize: '0.7rem' }}>Primary Color</div>
            <div className="flag-color-row">
              {COLORS.map(c => (
                <div
                  key={c}
                  className={`flag-dot ${color === c ? 'flag-dot-sel' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>

            <div className="muted" style={{ fontSize: '0.7rem', marginTop: 10 }}>Secondary Color</div>
            <div className="flag-color-row">
              {COLORS.map(c => (
                <div
                  key={c}
                  className={`flag-dot ${secondaryColor === c ? 'flag-dot-sel' : ''}`}
                  style={{ background: c }}
                  onClick={() => setSecondaryColor(c)}
                />
              ))}
            </div>

            <div className="muted" style={{ fontSize: '0.7rem', marginTop: 10 }}>Pattern</div>
            <div className="btn-group">
              {[1, 2, 3].map(t => (
                <button
                  key={t}
                  className={`btn-ghost compact ${type === t ? 'tab-active' : ''}`}
                  onClick={() => setType(t)}
                >{t}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-footer" style={{ padding: '0 20px 20px', display: 'flex', gap: 10 }}>
          <button className="btn-primary" style={{ flex: 1 }} onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save Badge'}
          </button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
