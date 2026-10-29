const API = import.meta.env.VITE_API_BASE || ''

export function getToken() {
  return localStorage.getItem('cv_token') || ''
}

export function setSession(token, user) {
  localStorage.setItem('cv_token', token)
  localStorage.setItem('cv_user', JSON.stringify(user))
}

export function clearSession() {
  localStorage.removeItem('cv_token')
  localStorage.removeItem('cv_user')
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem('cv_user') || 'null')
  } catch {
    return null
  }
}

export async function request(path, options = {}) {
  const headers = new Headers(options.headers || {})
  const token = getToken()

  if (token) {
   headers.set('Authorization', `Bearer ${token}`)
  }

  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${API}${path}`, {
    ...options,
    headers,
  })

  if (response.status === 401) {
    clearSession()
    if (window.location.pathname !== '/') {
      window.location.href = '/'
    }
  }

  if (response.status === 204) return null

  const contentType = response.headers.get('content-type') || ''
  let data

  if (contentType.includes('application/json')) {
    data = await response.json().catch(() => ({
      detail: 'Invalid JSON response from server',
    }))
  } else {
    const text = await response.text().catch(() => '')
    data = { detail: text || 'Unexpected server response' }
  }

  if (!response.ok) {
    throw new Error(
      data?.detail || `Request failed (${response.status})`
    )
  }

  return data
}

