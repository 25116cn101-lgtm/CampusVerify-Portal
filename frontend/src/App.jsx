import React, { useEffect, useRef, useState } from 'react'
import {
  ShieldCheck, GraduationCap, FileCheck2, ClipboardList, Users, LogOut,
  Upload, RefreshCw, CheckCircle2, AlertCircle, Clock3, CalendarDays,
  Search, Settings, FileText, ArrowRight, Eye, Trash2
} from 'lucide-react'
import { request, setSession, clearSession, getUser, getToken } from './api'

const moneySafeDate = () => new Date().toISOString().slice(0, 10)

function App() {
  const [user, setUser] = useState(getUser())
  const [identifier, setIdentifier] = useState('student@campusverify.local')
  const [password, setPassword] = useState('ChangeMe-Student-123!')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState('overview')
  const [dashboard, setDashboard] = useState(null)
  const [checklist, setChecklist] = useState([])
  const [docs, setDocs] = useState([])
  const [queue, setQueue] = useState([])
  const [students, setStudents] = useState([])
  const [rules, setRules] = useState([])
  const [audit, setAudit] = useState([])
  const [notice, setNotice] = useState('')
  const [slotDate, setSlotDate] = useState(moneySafeDate())
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')

  // Camera and photo preview state
  const [cameraRule, setCameraRule] = useState(null)
  const [cameraPreview, setCameraPreview] = useState(null)
  const [cameraPreviewUrl, setCameraPreviewUrl] = useState('')
  const [cameraError, setCameraError] = useState('')
  const videoRef = useRef(null)

  async function login(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const data = await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password })
      })

      setSession(data.access_token, data.user)
      setUser(data.user)
      setPage('overview')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function stopCamera() {
    const video = videoRef.current

    if (video?.srcObject) {
      video.srcObject.getTracks().forEach(track => track.stop())
      video.srcObject = null
    }
  }

  function closeCamera() {
    stopCamera()
    setCameraRule(null)
    setCameraPreview(null)
    if (cameraPreviewUrl) URL.revokeObjectURL(cameraPreviewUrl)
    setCameraPreviewUrl('')
    setCameraError('')
  }

  function logout() {
    closeCamera()
    clearSession()
    setUser(null)
    setDashboard(null)
    setChecklist([])
    setDocs([])
    setQueue([])
  }

  async function refresh() {
    if (!user) return

    setError('')

    try {
      const [cl, ds, q] = await Promise.all([
        request('/api/checklist'),
        request('/api/documents'),
        request('/api/queue?slot_date=' + slotDate)
      ])

      setChecklist(cl)
      setDocs(ds)
      setQueue(q)

      if (user.role === 'student') {
        setDashboard(await request('/api/student/dashboard'))
      }

      if (['staff', 'admin'].includes(user.role)) {
        setStudents(await request('/api/staff/students'))
      }

      if (user.role === 'admin') {
        setRules(await request('/api/admin/rules'))
        setAudit(await request('/api/admin/audit'))
      }
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    if (user) refresh()
  }, [user, slotDate])

  useEffect(() => {
    if (!user || page !== 'queue') return

    const timer = setInterval(() => {
      request('/api/queue?slot_date=' + slotDate)
        .then(setQueue)
        .catch(() => {})
    }, 8000)

    return () => clearInterval(timer)
  }, [user, page, slotDate])

  // Open the camera when the user selects Take Photo.
  useEffect(() => {
    if (cameraRule === null || cameraPreview) return

    let stream = null
    let cancelled = false

    async function openCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            'Camera is unavailable. Please use Choose File instead.'
          )
        }

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        })

        if (cancelled) {
          stream.getTracks().forEach(track => track.stop())
          return
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }

        setCameraError('')
      } catch (err) {
        setCameraError(
          err.message ||
          'Camera could not open. Allow camera permission or use Choose File.'
        )
      }
    }

    openCamera()

    return () => {
      cancelled = true

      if (stream) {
        stream.getTracks().forEach(track => track.stop())
      }

      if (videoRef.current) {
        videoRef.current.srcObject = null
      }
    }
  }, [cameraRule, cameraPreview])

  async function act(fn, success) {
    setBusy(true)
    setError('')
    setNotice('')

    try {
      await fn()
      setNotice(success)
      await refresh()
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function uploadFile(ruleKey, file) {
    if (!file) return false

    const form = new FormData()
    form.append('rule_key', ruleKey)
    form.append('file', file)

    return await act(
      () => request('/api/documents', {
        method: 'POST',
        body: form
      }),
      'Document uploaded. This is not final verification.'
    )
  }

  // Open a document securely using the logged-in user's access token.
  async function viewDocument(doc) {
    let objectUrl = ''

    try {
      setError('')

      const response = await fetch(
        `${import.meta.env.VITE_API_BASE || ''}/api/documents/${doc.id}/file`,
        {
          headers: {
            Authorization: `Bearer ${getToken()}`
          }
        }
      )

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || 'Unable to open document')
      }

      const blob = await response.blob()
      objectUrl = URL.createObjectURL(blob)
      const opened = window.open(objectUrl, '_blank')

      if (!opened) {
        const link = document.createElement('a')
        link.href = objectUrl
        link.download = doc.filename || 'document'
        link.click()
      }

      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000)
    } catch (err) {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setError(err.message || 'Unable to open document')
    }
  }

  async function deleteDocument(doc) {
    const confirmed = window.confirm(
      `Delete "${doc.filename}"? This cannot be undone.`
    )

    if (!confirmed) return

    await act(
      () => request(`/api/documents/${doc.id}`, { method: 'DELETE' }),
      'Document deleted successfully.'
    )
  }

  function openCamera(ruleKey) {
    setCameraError('')
    setCameraPreview(null)
    setCameraPreviewUrl('')
    setCameraRule(ruleKey)
  }

  function capturePhoto() {
    const video = videoRef.current

    if (!video || !video.videoWidth) {
      setCameraError('Camera is not ready. Please try again.')
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    const context = canvas.getContext('2d')

    if (!context) {
      setCameraError('Could not capture photo. Please try again.')
      return
    }

    context.drawImage(video, 0, 0)

    canvas.toBlob(blob => {
      if (!blob) {
        setCameraError('Could not create photo. Please try again.')
        return
      }

      const photo = new File(
        [blob],
        `document-${Date.now()}.jpg`,
        { type: 'image/jpeg' }
      )

      setCameraPreview(photo)
      setCameraPreviewUrl(URL.createObjectURL(photo))
      setCameraError('')
    }, 'image/jpeg', 0.92)
  }

  function retakePhoto() {
    setCameraPreview(null)

    if (cameraPreviewUrl) {
      URL.revokeObjectURL(cameraPreviewUrl)
    }

    setCameraPreviewUrl('')
    setCameraError('')
  }

  async function submitCameraPhoto() {
    if (!cameraRule || !cameraPreview) return

    const success = await uploadFile(cameraRule, cameraPreview)

    if (success) {
      closeCamera()
    }
  }

  async function createToken() {
    await act(
      () => request('/api/queue/tokens', {
        method: 'POST',
        body: JSON.stringify({
          slot_date: slotDate,
          counter: 'Main Counter'
        })
      }),
      'Token created.'
    )
  }

  async function queueAction(token, action) {
    await act(
      () => request(`/api/queue/tokens/${token.id}/${action}`, {
        method: 'POST',
        ...(action === 'reschedule'
          ? {
              body: JSON.stringify({
                slot_date: slotDate,
                counter: 'Main Counter'
              })
            }
          : {})
      }),
      `Token ${action.replaceAll('_', ' ')} successful.`
    )
  }

  async function saveRule(r) {
    await act(
      () => request('/api/admin/rules', {
        method: 'PUT',
        body: JSON.stringify(r)
      }),
      'Checklist rule saved.'
    )
  }

  const title = ({
    overview: 'Overview',
    documents: 'Documents & checklist',
    queue: 'Live token queue',
    students: 'Student review',
    rules: 'Checklist rules',
    audit: 'Audit history'
  })[page] || 'Overview'

  if (!user) {
    return (
      <main className="login-wrap">
        <div className="login-art">
          <div className="brand">
            <span className="brand-mark"><ShieldCheck size={24} /></span>
            <span>Campus<span className="brand-light">Verify</span></span>
          </div>

          <div className="hero-copy">
            <span className="eyebrow">SCHOLARSHIP SUBMISSION, SIMPLIFIED</span>
            <h1>Arrive prepared.<br /><em>Submit with confidence.</em></h1>
            <p>Know what to bring, prepare your documents, and track your college counter queue in one place.</p>
            <div className="hero-points">
              <span><CheckCircle2 size={17} /> Personalised checklist</span>
              <span><CheckCircle2 size={17} /> Document pre-checks</span>
              <span><CheckCircle2 size={17} /> Live token status</span>
            </div>
          </div>

          <div className="login-foot">
            A preparation and queue tool — not a scholarship approval system.
          </div>
        </div>

        <div className="login-panel">
          <div className="mobile-brand brand">
            <span className="brand-mark"><ShieldCheck size={22} /></span>
            <span>Campus<span className="brand-light">Verify</span></span>
          </div>

          <div className="login-card">
            <div className="login-icon"><GraduationCap size={24} /></div>
            <h2>Welcome back</h2>
            <p className="muted">Sign in to your college portal</p>

            <form onSubmit={login}>
              <label>Email or admission number</label>
              <input
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                autoComplete="username"
                required
              />

              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />

              {error && (
                <div className="error">
                  <AlertCircle size={16} />{error}
                </div>
              )}

              <button className="primary full" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in'}
                <ArrowRight size={17} />
              </button>
            </form>

            <div className="demo-box">
              <strong>Local demo accounts</strong>
              <button
                type="button"
                onClick={() => {
                  setIdentifier('student@campusverify.local')
                  setPassword('ChangeMe-Student-123!')
                }}
              >
                Student
              </button>
              <button
                type="button"
                onClick={() => {
                  setIdentifier('staff@campusverify.local')
                  setPassword('ChangeMe-Staff-123!')
                }}
              >
                Staff
              </button>
              <button
                type="button"
                onClick={() => {
                  setIdentifier('admin@campusverify.local')
                  setPassword('ChangeMe-Admin-123!')
                }}
              >
                Admin
              </button>
              <small>Only available when SEED_DEMO=true.</small>
            </div>
          </div>

          <p className="legal">
            By continuing, use only college-approved rules and protect sensitive documents.
          </p>
        </div>
      </main>
    )
  }

  const nav = [
    { id: 'overview', label: 'Overview', icon: ClipboardList },
    { id: 'documents', label: 'Documents & checklist', icon: FileCheck2 },
    { id: 'queue', label: 'Live token queue', icon: Clock3 },
    ...(user.role !== 'student'
      ? [{ id: 'students', label: 'Student review', icon: Users }]
      : []),
    ...(user.role === 'admin'
      ? [
          { id: 'rules', label: 'Checklist rules', icon: Settings },
          { id: 'audit', label: 'Audit history', icon: FileText }
        ]
      : [])
  ]

  const applicable = checklist.filter(r =>
    r.applies_to === 'All' ||
    r.applies_to === 'Conditional' ||
    dashboard?.profile?.application_type === r.applies_to ||
    (r.applies_to === 'Hosteller' && dashboard?.profile?.hostel_status)
  )

  const uploadedKeys = new Set(
    docs.filter(d => d.status !== 'Rejected').map(d => d.rule_key)
  )

  const missing = applicable.filter(
    r => r.required && !uploadedKeys.has(r.key)
  )

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><ShieldCheck size={23} /></span>
          <span>Campus<span className="brand-light">Verify</span></span>
        </div>

        <div className="college-switch">
          <div className="college-avatar">CV</div>
          <div>
            <strong>Demo College</strong>
            <small>Academic session 2026–27</small>
          </div>
        </div>

        <div className="nav-label">WORKSPACE</div>

        <nav>
          {nav.map(n => (
            <button
              key={n.id}
              className={page === n.id ? 'nav-item active' : 'nav-item'}
              onClick={() => setPage(n.id)}
            >
              <n.icon size={18} />
              {n.label}
              {n.id === 'queue' && <span className="nav-dot" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="support-card">
            <div className="support-icon"><ShieldCheck size={18} /></div>
            <strong>Keep documents safe</strong>
            <p>
              Only upload files requested by your college.
              Final verification happens at the counter.
            </p>
          </div>

          <div className="user-mini">
            <div className="avatar">
              {(user.full_name || 'U').slice(0, 1).toUpperCase()}
            </div>
            <div className="user-info">
              <strong>{user.full_name}</strong>
              <small>{user.role}</small>
            </div>
            <button
              className="icon-btn"
              title="Sign out"
              onClick={logout}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="breadcrumb">
              CampusVerify <span>/</span> {title}
            </div>
            <h1>{title}</h1>
          </div>

          <div className="top-actions">
            <span className="session-pill">
              <span className="green-dot" /> 2026–27 session
            </span>
            <button
              className="icon-btn refresh"
              onClick={refresh}
              title="Refresh"
            >
              <RefreshCw size={17} />
            </button>
            <div className="avatar">
              {(user.full_name || 'U').slice(0, 1).toUpperCase()}
            </div>
          </div>
        </header>

        {error && (
          <div className="alert error">
            <AlertCircle size={17} />
            {error}
            <button onClick={() => setError('')}>Dismiss</button>
          </div>
        )}

        {notice && (
          <div className="alert success">
            <CheckCircle2 size={17} />
            {notice}
            <button onClick={() => setNotice('')}>Dismiss</button>
          </div>
        )}

        {page === 'overview' && (
          <>
            <section className="welcome-banner">
              <div>
                <span className="eyebrow light">YOUR SCHOLARSHIP WORKSPACE</span>
                <h2>
                  {user.role === 'student'
                    ? `Hello, ${(user.full_name || 'Student').split(' ')[0]}.`
                    : `Welcome, ${(user.full_name || 'Team').split(' ')[0]}.`}
                </h2>
                <p>
                  {user.role === 'student'
                    ? 'Prepare your documents before visiting the college counter.'
                    : 'Review student submissions and keep the counter queue moving.'}
                </p>
              </div>
              <div className="banner-art">
                <div className="art-circle"><FileCheck2 size={42} /></div>
                <div className="art-check"><CheckCircle2 size={20} /></div>
              </div>
            </section>

            <div className="stats-grid">
              <Stat
                icon={FileCheck2}
                label={user.role === 'student' ? 'Checklist readiness' : 'Students'}
                value={user.role === 'student'
                  ? `${dashboard?.readiness_percent ?? 0}%`
                  : students.length}
                note={user.role === 'student'
                  ? `${dashboard?.uploaded_count ?? 0} required items uploaded`
                  : 'In your college'}
                tone="green"
              />
              <Stat
                icon={Upload}
                label="Documents uploaded"
                value={user.role === 'student'
                  ? docs.length
                  : students.reduce((a, s) => a + s.document_count, 0)}
                note="Pre-check only; staff verifies"
                tone="blue"
              />
              <Stat
                icon={Clock3}
                label="Queue waiting"
                value={queue.filter(q => q.status === 'Waiting').length}
                note="Selected date"
                tone="amber"
              />
              <Stat
                icon={CheckCircle2}
                label="Completed today"
                value={queue.filter(q => q.status === 'Completed').length}
                note="Hardcopy receipt recorded"
                tone="purple"
              />
            </div>

            <div className="content-grid">
              <section className="panel checklist-panel">
                <div className="panel-head">
                  <div>
                    <h3>
                      {user.role === 'student'
                        ? 'Your document checklist'
                        : 'Counter queue snapshot'}
                    </h3>
                    <p>
                      {user.role === 'student'
                        ? 'Start with required documents marked below.'
                        : 'Live queue for the selected date.'}
                    </p>
                  </div>
                  <button
                    className="text-btn"
                    onClick={() => setPage(
                      user.role === 'student' ? 'documents' : 'queue'
                    )}
                  >
                    View all <ArrowRight size={15} />
                  </button>
                </div>

                {user.role === 'student' ? (
                  <>
                    <div className="progress-line">
                      <div>
                        <strong>{dashboard?.readiness_percent ?? 0}% ready</strong>
                        <span>{missing.length} required items missing</span>
                      </div>
                      <div className="progress-track">
                        <div style={{
                          width: `${dashboard?.readiness_percent ?? 0}%`
                        }} />
                      </div>
                    </div>
                    <div className="checklist-list">
                      {applicable.slice(0, 5).map(r => (
                        <ChecklistRow
                          key={r.key}
                          rule={r}
                          uploaded={uploadedKeys.has(r.key)}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <QueueRows
                    queue={queue.slice(0, 5)}
                    onAction={queueAction}
                    role={user.role}
                    busy={busy}
                  />
                )}
              </section>

              <section className="panel next-panel">
                <div className="panel-head">
                  <div>
                    <h3>
                      {user.role === 'student' ? 'Submission visit' : 'Queue controls'}
                    </h3>
                    <p>
                      {user.role === 'student'
                        ? 'Plan your hardcopy submission.'
                        : 'Manage counter operations.'}
                    </p>
                  </div>
                  <span className="soft-icon"><CalendarDays size={19} /></span>
                </div>

                <label className="field-label">Submission date</label>
                <input
                  type="date"
                  min={moneySafeDate()}
                  value={slotDate}
                  onChange={e => setSlotDate(e.target.value)}
                  className="date-input"
                />

                {user.role === 'student' ? (
                  <>
                    <div className="token-preview">
                      <div className="token-icon"><Clock3 size={20} /></div>
                      <div>
                        <strong>
                          {queue.find(q =>
                            q.mine && ['Waiting', 'Called', 'In Progress'].includes(q.status)
                          )
                            ? `Token #${queue.find(q =>
                                q.mine && ['Waiting', 'Called', 'In Progress'].includes(q.status)
                              ).token_number}`
                            : 'No active token'}
                        </strong>
                        <p>
                          {queue.find(q =>
                            q.mine && ['Waiting', 'Called', 'In Progress'].includes(q.status)
                          )?.status || 'Book after preparing your documents'}
                        </p>
                      </div>
                    </div>

                    <button
                      className="primary full"
                      disabled={busy || !!queue.find(q =>
                        q.mine && ['Waiting', 'Called', 'In Progress'].includes(q.status)
                      )}
                      onClick={createToken}
                    >
                      Get submission token <ArrowRight size={17} />
                    </button>
                    <p className="fine-print">
                      Only book when you are ready to bring the hardcopy set.
                      Your college may apply additional eligibility rules.
                    </p>
                  </>
                ) : (
                  <button
                    className="primary full"
                    onClick={() => setPage('queue')}
                  >
                    Open counter queue <ArrowRight size={17} />
                  </button>
                )}
              </section>
            </div>

            <div className="disclaimer">
              <ShieldCheck size={18} />
              <div>
                <strong>Important reminder</strong>
                <p>
                  Automated checks cannot confirm authenticity or guarantee
                  scholarship acceptance. College staff performs final document
                  verification and confirms physical receipt.
                </p>
              </div>
            </div>
          </>
        )}

        {page === 'documents' && (
          <>
            <div className="section-intro">
              <div>
                <h2>Prepare your document set</h2>
                <p>
                  Requirements shown here are configurable and must be
                  confirmed by your college.
                </p>
              </div>
              <span className="count-pill">{docs.length} files uploaded</span>
            </div>

            <div className="panel document-panel">
              <div className="document-summary">
                <div>
                  <span className="summary-number">{applicable.length}</span>
                  <span>Checklist items</span>
                </div>
                <div>
                  <span className="summary-number">{missing.length}</span>
                  <span>Required missing</span>
                </div>
                <div>
                  <span className="summary-number">{docs.length}</span>
                  <span>Files uploaded</span>
                </div>
              </div>

              <div className="checklist-list">
                {applicable.map(r => {
                  const ruleDocs = docs.filter(d => d.rule_key === r.key)

                  return (
                    <div className="document-row" key={r.key}>
                      <div className={`doc-icon ${uploadedKeys.has(r.key) ? 'doc-done' : ''}`}>
                        {uploadedKeys.has(r.key)
                          ? <CheckCircle2 size={20} />
                          : <FileText size={20} />}
                      </div>

                      <div className="doc-detail">
                        <div className="doc-title">
                          {r.label}
                          {r.required && <span className="required-tag">Required</span>}
                        </div>
                        <p>{r.description}</p>

                        <div className="uploaded-doc-list">
                          {ruleDocs.length === 0 ? (
                            <small>PDF, PNG or JPEG · max 10 MB</small>
                          ) : (
                            ruleDocs.map(d => (
                              <div className="uploaded-doc-item" key={d.id}>
                                <span className="uploaded-doc-name">
                                  <FileText size={15} />
                                  <span>{d.filename} · {d.status}</span>
                                </span>
                                <div className="upload-actions">
                                  <button
                                    type="button"
                                    className="upload-btn"
                                    disabled={busy}
                                    onClick={() => viewDocument(d)}
                                  >
                                    <Eye size={15} /> View
                                  </button>
                                  <button
                                    type="button"
                                    className="secondary-btn"
                                    disabled={busy}
                                    onClick={() => deleteDocument(d)}
                                  >
                                    <Trash2 size={15} /> Delete
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="upload-actions">
                        <button
                          type="button"
                          className="upload-btn"
                          disabled={busy}
                          onClick={() => openCamera(r.key)}
                        >
                          📷 Take Photo
                        </button>

                        <label className={`upload-btn ${busy ? 'disabled' : ''}`}>
                          <Upload size={15} /> Choose File
                          <input
                            type="file"
                            multiple
                            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                            disabled={busy}
                            onChange={async e => {
                              const files = Array.from(e.target.files || [])
                              e.target.value = ''

                              for (const file of files) {
                                const success = await uploadFile(r.key, file)
                                if (!success) break
                              }
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="info-note">
                <AlertCircle size={17} />
                <span>
                  Upload only documents the college has authorised you to submit.
                  Uploaded files are not publicly accessible. OCR and authenticity
                  verification are not included in this starter.
                </span>
              </div>
            </div>
          </>
        )}

        {page === 'queue' && (
          <>
            <div className="section-intro">
              <div>
                <h2>Submission counter queue</h2>
                <p>
                  Queue state is stored by the backend. Refresh to fetch
                  the latest authoritative state.
                </p>
              </div>
              <div className="date-inline">
                <CalendarDays size={17} />
                <input
                  type="date"
                  min={moneySafeDate()}
                  value={slotDate}
                  onChange={e => setSlotDate(e.target.value)}
                />
                <button className="icon-btn" onClick={refresh}>
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>

            <div className="queue-summary">
              <Stat
                icon={Clock3}
                label="Waiting"
                value={queue.filter(q => q.status === 'Waiting').length}
                tone="amber"
              />
              <Stat
                icon={Users}
                label="Called / In progress"
                value={queue.filter(q => ['Called', 'In Progress'].includes(q.status)).length}
                tone="blue"
              />
              <Stat
                icon={CheckCircle2}
                label="Completed"
                value={queue.filter(q => q.status === 'Completed').length}
                tone="green"
              />
            </div>

            <div className="panel">
              <div className="panel-head">
                <div>
                  <h3>Tokens for {slotDate}</h3>
                  <p>Skipped history is preserved; rescheduling creates a new token.</p>
                </div>
                <span className="count-pill">{queue.length} total</span>
              </div>

              <QueueRows
                queue={queue}
                onAction={queueAction}
                role={user.role}
                busy={busy}
              />

              {user.role === 'student' &&
                queue.some(q => q.mine && ['Waiting', 'Called'].includes(q.status)) && (
                  <p className="fine-print queue-foot">
                    You may skip your own token before it enters In Progress.
                    Rescheduling is available for skipped/no-show tokens under college policy.
                  </p>
                )}
            </div>
          </>
        )}

        {page === 'students' && (
          <>
            <div className="section-intro">
              <div>
                <h2>Student submissions</h2>
                <p>Review uploaded document metadata and record a staff status.</p>
              </div>
              <div className="searchbox">
                <Search size={16} />
                <input
                  placeholder="Search students"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="panel table-panel">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Admission no.</th>
                      <th>Files</th>
                      <th>Uploaded documents</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students
                      .filter(s =>
                        (s.name + ' ' + s.admission_number)
                          .toLowerCase()
                          .includes(search.toLowerCase())
                      )
                      .map(s => (
                        <tr key={s.id}>
                          <td>
                            <strong>{s.name}</strong>
                            <small>{s.email}</small>
                          </td>
                          <td>{s.admission_number || '—'}</td>
                          <td>{s.document_count}</td>
                          <td>
                            {s.documents.map(d => (
                              <div className="review-doc" key={d.id}>
                                <span>{d.filename}</span>
                                <button
                                  type="button"
                                  className="small-btn"
                                  disabled={busy}
                                  onClick={() => viewDocument(d)}
                                >
                                  <Eye size={14} /> View
                                </button>
                                <select
                                  value={d.status}
                                  disabled={busy}
                                  onChange={e => act(
                                    () => request(`/api/staff/students/${d.id}/status`, {
                                      method: 'POST',
                                      body: JSON.stringify({
                                        status: e.target.value,
                                        note: ''
                                      })
                                    }),
                                    'Document status updated.'
                                  )}
                                >
                                  <option>Uploaded</option>
                                  <option>Verified</option>
                                  <option>Correction Required</option>
                                  <option>Rejected</option>
                                </select>
                              </div>
                            ))}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {students.length === 0 && (
                  <div className="empty-state">No student records found.</div>
                )}
              </div>
            </div>
          </>
        )}

        {page === 'rules' && (
          <>
            <div className="section-intro">
              <div>
                <h2>College checklist rules</h2>
                <p>Confirm current official requirements before enabling them for students.</p>
              </div>
            </div>

            <div className="panel">
              <div className="rules-list">
                {rules.map(r => (
                  <div className="rule-row" key={r.key}>
                    <div className="rule-info">
                      <strong>{r.label}</strong>
                      <p>{r.description}</p>
                      <small>{r.key} · {r.applies_to}</small>
                    </div>
                    <div className="rule-controls">
                      <label>
                        <input
                          type="checkbox"
                          checked={r.required}
                          onChange={e => saveRule({ ...r, required: e.target.checked })}
                        /> Required
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={r.active}
                          onChange={e => saveRule({ ...r, active: e.target.checked })}
                        /> Active
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {page === 'audit' && (
          <>
            <div className="section-intro">
              <div>
                <h2>Audit history</h2>
                <p>Recent administrative and workflow changes.</p>
              </div>
            </div>

            <div className="panel table-panel">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Actor ID</th>
                      <th>Action</th>
                      <th>Target</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map(a => (
                      <tr key={a.id}>
                        <td>{new Date(a.created_at).toLocaleString()}</td>
                        <td>{a.actor_user_id ?? 'System'}</td>
                        <td>{a.action}</td>
                        <td>{a.target_type} #{a.target_id}</td>
                        <td>{a.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {cameraRule !== null && (
          <div className="camera-overlay">
            <div
              className="camera-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="camera-title"
            >
              <div className="camera-header">
                <div>
                  <h2 id="camera-title">Capture Document</h2>
                  <p>Take a clear photo of your document.</p>
                </div>

                <button
                  type="button"
                  className="icon-btn"
                  onClick={closeCamera}
                  aria-label="Close camera"
                >
                  ✕
                </button>
              </div>

              {cameraError && (
                <div className="alert error">
                  <AlertCircle size={17} />
                  {cameraError}
                </div>
              )}

              <div className="camera-preview">
                {cameraPreviewUrl ? (
                  <img
                    src={cameraPreviewUrl}
                    alt="Captured document preview"
                  />
                ) : (
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                  />
                )}
              </div>

              <p className="camera-help">
                Make sure the complete document is visible, with readable text
                and good lighting.
              </p>

              <div className="camera-actions">
                {!cameraPreview ? (
                  <button
                    type="button"
                    className="primary"
                    onClick={capturePhoto}
                  >
                    📷 Capture Photo
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={busy}
                      onClick={retakePhoto}
                    >
                      ↻ Retake
                    </button>

                    <button
                      type="button"
                      className="primary"
                      disabled={busy}
                      onClick={submitCameraPhoto}
                    >
                      <Upload size={16} />
                      {busy ? 'Uploading…' : 'Use Photo & Upload'}
                    </button>
                  </>
                )}

                <button
                  type="button"
                  className="secondary-btn"
                  disabled={busy}
                  onClick={closeCamera}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <footer className="app-footer">
          <span>© 2026 CampusVerify · College workflow assistant</span>
          <span>
            <ShieldCheck size={14} />
            Private by design · Final verification by college staff
          </span>
        </footer>
      </main>
    </div>
  )
}

function Stat({ icon: Icon, label, value, note, tone = 'green' }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`}>
        <Icon size={19} />
      </div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  )
}

function ChecklistRow({ rule, uploaded }) {
  return (
    <div className="check-row">
      <span className={`check-status ${uploaded ? 'done' : ''}`}>
        {uploaded ? <CheckCircle2 size={17} /> : <span />}
      </span>

      <span className="check-name">{rule.label}</span>

      <span className={uploaded ? 'status status-green' : 'status status-amber'}>
        {uploaded ? 'Uploaded' : rule.required ? 'Required' : 'Optional'}
      </span>
    </div>
  )
}

function QueueRows({ queue, onAction, role, busy }) {
  if (!queue.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><Clock3 size={23} /></div>
        <strong>No tokens for this date</strong>
        <p>New submissions will appear here when students book a token.</p>
      </div>
    )
  }

  return (
    <div className="queue-list">
      {queue.map(q => (
        <div className="queue-row" key={q.id}>
          <div className="queue-number">
            #{q.token_number.toString().padStart(3, '0')}
          </div>

          <div className="queue-person">
            <strong>{q.student_name}{q.mine ? ' (You)' : ''}</strong>
            <small>{q.counter} · {q.slot_date}</small>
          </div>

          <span className={`status status-${q.status.toLowerCase().replace(' ', '-')}`}>
            {q.status}
          </span>

          <div className="queue-actions">
            {role === 'student' &&
              q.mine &&
              ['Waiting', 'Called'].includes(q.status) && (
                <button
                  className="small-btn"
                  disabled={busy}
                  onClick={() => onAction(q, 'skip')}
                >
                  Skip
                </button>
              )}

            {['staff', 'admin'].includes(role) && q.status === 'Waiting' && (
              <button
                className="small-btn primary-mini"
                disabled={busy}
                onClick={() => onAction(q, 'call')}
              >
                Call
              </button>
            )}

            {['staff', 'admin'].includes(role) && q.status === 'Called' && (
              <button
                className="small-btn primary-mini"
                disabled={busy}
                onClick={() => onAction(q, 'start')}
              >
                Start
              </button>
            )}

            {['staff', 'admin'].includes(role) && q.status === 'In Progress' && (
              <button
                className="small-btn primary-mini"
                disabled={busy}
                onClick={() => onAction(q, 'complete')}
              >
                Received
              </button>
            )}

            {q.mine && ['Skipped', 'No-show'].includes(q.status) && (
              <button
                className="small-btn"
                disabled={busy}
                onClick={() => onAction(q, 'reschedule')}
              >
                Reschedule
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export default App