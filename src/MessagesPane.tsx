import { useEffect, useState, useCallback } from 'react'

type Message = {
  _id: string
  user: string
  respondent: string
  text: string
  date: string
  type: 'in' | 'out'
  unread?: boolean
  outMessage?: string
}

type MessageUser = {
  _id: string
  username?: string
  badge?: unknown
}

type Conversation = {
  _id: string
  message: Message
}

interface MessagesPaneProps {
  apiFetch: <T>(path: string, init?: RequestInit) => Promise<T>
  userId?: string
}

export default function MessagesPane({ apiFetch, userId }: MessagesPaneProps) {
  const [index, setIndex] = useState<Conversation[]>([])
  const [users, setUsers] = useState<Record<string, MessageUser>>({})
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [input, setInput] = useState('')
  const [unreadCount, setUnreadCount] = useState(0)

  const loadUnreadCount = useCallback(async () => {
    try {
      const data = await apiFetch<{ count: number }>('/api/user/messages/unread-count')
      setUnreadCount(data.count ?? 0)
    } catch {
      setUnreadCount(0)
    }
  }, [apiFetch])

  const loadIndex = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiFetch<{ messages: Conversation[]; users: Record<string, MessageUser> }>('/api/user/messages/index')
      setIndex(data.messages ?? [])
      setUsers(data.users ?? {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  const loadMessages = useCallback(async (user: string) => {
    setLoading(true)
    setError('')
    try {
      const data = await apiFetch<{ messages: Message[] }>(`/api/user/messages/list?respondent=${user}`)
      const nextMessages = data.messages ?? []
      setMessages(nextMessages)
      setSelectedUser(user)

      const unreadIncoming = nextMessages.filter((message) => message.type === 'in' && message.unread)
      for (const message of unreadIncoming) {
        await apiFetch('/api/user/messages/mark-read', {
          method: 'POST',
          body: JSON.stringify({ id: message._id }),
        })
      }

      if (unreadIncoming.length > 0) {
        setMessages((current) => current.map((message) => (
          unreadIncoming.some((item) => item._id === message._id)
            ? { ...message, unread: false }
            : message
        )))
        await Promise.all([loadIndex(), loadUnreadCount()])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [apiFetch, loadIndex, loadUnreadCount])

  useEffect(() => {
    void Promise.all([loadIndex(), loadUnreadCount()])
  }, [loadIndex, loadUnreadCount])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedUser || !input.trim()) return
    try {
      await apiFetch('/api/user/messages/send', {
        method: 'POST',
        body: JSON.stringify({ respondent: selectedUser, text: input }),
      })
      setInput('')
      await Promise.all([loadMessages(selectedUser), loadIndex()])
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Send failed')
    }
  }

  const selectedLabel = selectedUser ? (users[selectedUser]?.username ?? selectedUser) : null

  return (
    <div className="dock-pane">
      <div className="pane-header">
        <span className="panel-title">Messages {unreadCount > 0 ? `(${unreadCount})` : ''}</span>
        {selectedUser && (
          <button className="btn-ghost compact" onClick={() => setSelectedUser(null)}>← Back</button>
        )}
      </div>

      <div className="pane-scroll">
        {loading && <div style={{ padding: 10 }} className="muted">Loading…</div>}
        {error && <div style={{ padding: 10 }} className="form-error">{error}</div>}

        {!loading && !selectedUser && (
          <div className="convo-list">
            {index.map((conversation) => {
              const lastMessage = conversation.message
              const respondent = conversation._id
              const unread = lastMessage.type === 'in' && lastMessage.unread
              return (
                <div key={respondent} className={`convo-row ${unread ? 'unread' : ''}`} onClick={() => void loadMessages(respondent)}>
                  <span className="convo-user">{users[respondent]?.username ?? respondent}</span>
                  {unread && <span className="convo-dot">●</span>}
                  <span className="convo-preview muted">{lastMessage.text}</span>
                  <span className="convo-date muted">{new Date(lastMessage.date).toLocaleDateString()}</span>
                </div>
              )
            })}
            {index.length === 0 && <div className="market-empty">No conversations yet.</div>}
          </div>
        )}

        {!loading && selectedUser && (
          <div className="msg-thread">
            {messages.map((message) => (
              <div key={message._id} className={`msg-bubble ${(message.type === 'out' || message.user === userId) ? 'mine' : 'theirs'}`}>
                <div className="msg-text">{message.text}</div>
                <div className="msg-meta muted">
                  {new Date(message.date).toLocaleTimeString()}
                  {message.unread && message.type === 'in' ? ' · unread' : ''}
                </div>
              </div>
            ))}
            {messages.length === 0 && <div className="market-empty">No messages with {selectedLabel} yet.</div>}
          </div>
        )}
      </div>

      {selectedUser && (
        <form className="msg-compose console-input-row" onSubmit={handleSend}>
          <input
            className="console-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Message to ${selectedLabel ?? selectedUser}…`}
          />
          <button type="submit" className="btn-ghost compact" disabled={!input.trim()}>Send</button>
        </form>
      )}
    </div>
  )
}
