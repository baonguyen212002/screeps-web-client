import { useEffect, useState, useCallback, useMemo, useRef } from 'react'

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

type NotifyPrefs = {
  disabledOnMessages?: boolean
  sendOnline?: boolean
}

interface MessagesPaneProps {
  apiFetch: <T>(path: string, init?: RequestInit) => Promise<T>
  userId?: string
  subscribeSocketChannel: (channel: string, listener: (data: unknown) => void) => () => void
  onUnreadCountChange?: (count: number) => void
  onToast?: (text: string) => void
}

function sortMessages(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

function mergeMessage(current: Message[], incoming: Message): Message[] {
  const existingIndex = current.findIndex((item) => item._id === incoming._id)
  if (existingIndex >= 0) {
    return current.map((item) => (item._id === incoming._id ? { ...item, ...incoming } : item))
  }

  if (incoming.type === 'out') {
    const optimisticIndex = current.findIndex((item) =>
      item._id.startsWith('temp-') &&
      item.type === 'out' &&
      item.respondent === incoming.respondent &&
      item.text === incoming.text,
    )
    if (optimisticIndex >= 0) {
      return sortMessages(current.map((item, index) => (index === optimisticIndex ? incoming : item)))
    }
  }

  return sortMessages([...current, incoming])
}

function upsertConversation(index: Conversation[], respondent: string, message: Message): Conversation[] {
  const next = [{ _id: respondent, message }, ...index.filter((item) => item._id !== respondent)]
  return next.sort((a, b) => new Date(b.message.date).getTime() - new Date(a.message.date).getTime())
}

export default function MessagesPane({ apiFetch, userId, subscribeSocketChannel, onUnreadCountChange, onToast }: MessagesPaneProps) {
  const [index, setIndex] = useState<Conversation[]>([])
  const [users, setUsers] = useState<Record<string, MessageUser>>({})
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [threadCache, setThreadCache] = useState<Record<string, Message[]>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [input, setInput] = useState('')
  const [unreadCount, setUnreadCount] = useState(0)
  const [newUsername, setNewUsername] = useState('')
  const [notifyPrefs, setNotifyPrefs] = useState<NotifyPrefs>({})
  const usersRef = useRef<Record<string, MessageUser>>({})
  const threadCacheRef = useRef<Record<string, Message[]>>({})
  const resolvingUsersRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    usersRef.current = users
  }, [users])

  useEffect(() => {
    threadCacheRef.current = threadCache
  }, [threadCache])

  const resolveUser = useCallback(async (id: string) => {
    if (!id || usersRef.current[id] || resolvingUsersRef.current.has(id)) return
    resolvingUsersRef.current.add(id)
    try {
      const data = await apiFetch<{ user?: MessageUser }>('/api/user/find?id=' + encodeURIComponent(id))
      if (data.user?._id) {
        setUsers((current) => current[data.user!._id] ? current : ({ ...current, [data.user!._id]: data.user! }))
      }
    } catch {
      /* ignore */
    } finally {
      resolvingUsersRef.current.delete(id)
    }
  }, [apiFetch])

  const messages = useMemo(() => (selectedUser ? (threadCache[selectedUser] ?? []) : []), [selectedUser, threadCache])

  const setUnread = useCallback((next: number) => {
    setUnreadCount(next)
    onUnreadCountChange?.(next)
  }, [onUnreadCountChange])

  const loadUnreadCount = useCallback(async () => {
    try {
      const data = await apiFetch<{ count: number }>('/api/user/messages/unread-count')
      setUnread(data.count ?? 0)
    } catch {
      setUnread(0)
    }
  }, [apiFetch, setUnread])

  const loadIndex = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiFetch<{ messages: Conversation[]; users: Record<string, MessageUser> }>('/api/user/messages/index')
      const normalized = (data.messages ?? []).map((conversation) => ({
        _id: conversation.message.respondent,
        message: conversation.message,
      }))
      setIndex(normalized.sort((a, b) => new Date(b.message.date).getTime() - new Date(a.message.date).getTime()))
      setUsers((current) => ({ ...current, ...(data.users ?? {}) }))
      normalized.forEach((conversation) => { void resolveUser(conversation._id) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [apiFetch, resolveUser])

  const markThreadRead = useCallback(async (threadUser: string, currentMessages: Message[]) => {
    const unreadIncoming = currentMessages.filter((message) => message.type === 'in' && message.unread)
    if (unreadIncoming.length === 0) return

    setThreadCache((cache) => ({
      ...cache,
      [threadUser]: (cache[threadUser] ?? []).map((message) => (
        unreadIncoming.some((item) => item._id === message._id)
          ? { ...message, unread: false }
          : message
      )),
    }))

    try {
      await Promise.all(unreadIncoming.map((message) => apiFetch('/api/user/messages/mark-read', {
        method: 'POST',
        body: JSON.stringify({ id: message._id }),
      })))
      await loadUnreadCount()
    } catch {
      /* ignore */
    }
  }, [apiFetch, loadUnreadCount])

  const loadMessages = useCallback(async (threadUser: string, force = false) => {
    setSelectedUser(threadUser)
    void resolveUser(threadUser)

    if (!force && threadCacheRef.current[threadUser]) {
      void markThreadRead(threadUser, threadCacheRef.current[threadUser])
      return
    }

    setLoading(true)
    setError('')
    try {
      const data = await apiFetch<{ messages: Message[] }>(`/api/user/messages/list?respondent=${threadUser}`)
      const nextMessages = sortMessages(data.messages ?? [])
      setThreadCache((cache) => ({ ...cache, [threadUser]: nextMessages }))
      void markThreadRead(threadUser, nextMessages)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [apiFetch, markThreadRead, resolveUser])

  useEffect(() => {
    void Promise.all([loadIndex(), loadUnreadCount()])
  }, [loadIndex, loadUnreadCount])

  useEffect(() => {
    let cancelled = false
    void apiFetch<{ notifyPrefs?: NotifyPrefs }>('/api/auth/me')
      .then((data) => {
        if (!cancelled) setNotifyPrefs(data.notifyPrefs ?? {})
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [apiFetch])

  useEffect(() => {
    if (!userId) return
    return subscribeSocketChannel(`user:${userId}/newMessage`, (payload) => {
      const message = (payload as { message?: Message }).message
      if (!message) return

      const threadUser = message.respondent
      const senderName = users[threadUser]?.username ?? threadUser
      void resolveUser(threadUser)
      setThreadCache((cache) => ({
        ...cache,
        [threadUser]: mergeMessage(cache[threadUser] ?? [], message),
      }))
      setIndex((current) => upsertConversation(current, threadUser, message))
      setUnread(selectedUser === threadUser ? unreadCount : unreadCount + 1)
      if (selectedUser === threadUser) {
        void markThreadRead(threadUser, mergeMessage(threadCache[threadUser] ?? [], message))
      } else {
        onToast?.(`New message from ${senderName}`)
      }
    })
  }, [markThreadRead, onToast, resolveUser, selectedUser, subscribeSocketChannel, threadCache, unreadCount, userId, users, setUnread])

  useEffect(() => {
    if (!userId || !selectedUser) return

    return subscribeSocketChannel(`user:${userId}/message:${selectedUser}`, (payload) => {
      const message = (payload as { message?: Partial<Message> & { _id: string } }).message
      if (!message?._id) return

      if ('text' in message && 'date' in message && 'type' in message && 'respondent' in message && 'user' in message) {
        const fullMessage = message as Message
        setThreadCache((cache) => ({
          ...cache,
          [selectedUser]: mergeMessage(cache[selectedUser] ?? [], fullMessage),
        }))
        setIndex((current) => upsertConversation(current, selectedUser, fullMessage))
        if (fullMessage.type === 'in' && fullMessage.unread) {
          void markThreadRead(selectedUser, mergeMessage(threadCache[selectedUser] ?? [], fullMessage))
        }
        return
      }

      setThreadCache((cache) => ({
        ...cache,
        [selectedUser]: (cache[selectedUser] ?? []).map((item) => (
          item._id === message._id ? { ...item, ...message } : item
        )),
      }))
    })
  }, [markThreadRead, selectedUser, subscribeSocketChannel, threadCache, userId])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedUser || !input.trim() || !userId) return

    const text = input.trim()
    const optimisticMessage: Message = {
      _id: `temp-${Date.now()}`,
      user: userId,
      respondent: selectedUser,
      text,
      date: new Date().toISOString(),
      type: 'out',
      unread: false,
    }

    setThreadCache((cache) => ({
      ...cache,
      [selectedUser]: mergeMessage(cache[selectedUser] ?? [], optimisticMessage),
    }))
    setIndex((current) => upsertConversation(current, selectedUser, optimisticMessage))
    setInput('')

    try {
      await apiFetch('/api/user/messages/send', {
        method: 'POST',
        body: JSON.stringify({ respondent: selectedUser, text }),
      })
    } catch (sendError) {
      setThreadCache((cache) => ({
        ...cache,
        [selectedUser]: (cache[selectedUser] ?? []).filter((message) => message._id !== optimisticMessage._id),
      }))
      setError(sendError instanceof Error ? sendError.message : 'Send failed')
    }
  }

  async function handleStartConversation(e: React.FormEvent) {
    e.preventDefault()
    const username = newUsername.trim()
    if (!username) return

    setLoading(true)
    setError('')
    try {
      const data = await apiFetch<{ user?: MessageUser }>('/api/user/find?username=' + encodeURIComponent(username))
      const foundUser = data.user
      if (!foundUser?._id) {
        setError(`User "${username}" not found`)
        return
      }
      setUsers((current) => ({ ...current, [foundUser._id]: foundUser }))
      setNewUsername('')
      await loadMessages(foundUser._id)
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : 'User lookup failed')
    } finally {
      setLoading(false)
    }
  }

  async function updateNotifyPrefs(patch: NotifyPrefs) {
    const next = { ...notifyPrefs, ...patch }
    setNotifyPrefs(next)
    try {
      await apiFetch('/api/user/notify-prefs', {
        method: 'POST',
        body: JSON.stringify(patch),
      })
    } catch (prefError) {
      setError(prefError instanceof Error ? prefError.message : 'Notify prefs save failed')
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
        {!selectedUser && (
          <>
            <form className="msg-compose console-input-row" onSubmit={handleStartConversation} style={{ padding: 10 }}>
              <input
                className="console-input"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="Start a conversation by username…"
              />
              <button type="submit" className="btn-ghost compact" disabled={!newUsername.trim()}>Open</button>
            </form>
            <div className="notify-prefs">
              <label className="notify-pref">
                <input
                  type="checkbox"
                  checked={!notifyPrefs.disabledOnMessages}
                  onChange={(e) => void updateNotifyPrefs({ disabledOnMessages: !e.target.checked })}
                />
                <span>Backend notifications for messages</span>
              </label>
              <label className="notify-pref">
                <input
                  type="checkbox"
                  checked={!!notifyPrefs.sendOnline}
                  onChange={(e) => void updateNotifyPrefs({ sendOnline: e.target.checked })}
                />
                <span>Send notifications while online</span>
              </label>
            </div>
          </>
        )}

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
              <div key={message._id} className={`msg-bubble ${message.type === 'out' ? 'mine' : 'theirs'}`}>
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
