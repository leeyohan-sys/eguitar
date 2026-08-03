/** 악보플레이(akboplay) API — TAB 변환 · 재생목록 악보 PDF */

const DEFAULT_API = 'https://akboplay-api.onrender.com'

function resolveApiBase() {
  const fromEnv = import.meta.env.VITE_AKBOPLAY_API_URL
  if (fromEnv) return String(fromEnv).replace(/\/$/, '')
  return DEFAULT_API
}

export const AKBOPLAY_API_BASE = resolveApiBase()

function friendlyFetchError(e) {
  if (e instanceof Error && e.name === 'AbortError') {
    return new Error(
      '요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요. (무료 서버는 깨어나는 데 30~60초 걸릴 수 있습니다)',
    )
  }
  const msg = e instanceof Error ? e.message : String(e)
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return new Error(
      '서버에 연결하지 못했습니다. 무료 API가 잠들어 있거나 재배포 중일 수 있습니다. 10초 뒤 다시 시도해 주세요.',
    )
  }
  if (/502|503|504|bad gateway/i.test(msg)) {
    return new Error(
      '서버가 문서를 처리하다 중단되었습니다. 잠시 후 다시 시도해 주세요.',
    )
  }
  return e instanceof Error ? e : new Error(msg)
}

async function request(path, init = {}) {
  const timeoutMs = init.timeoutMs ?? 30000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const { timeoutMs: _t, ...fetchInit } = init

  try {
    const res = await fetch(`${AKBOPLAY_API_BASE}${path}`, {
      ...fetchInit,
      signal: controller.signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (res.status >= 502 && res.status <= 504) {
        throw new Error(`Bad Gateway (${res.status})`)
      }
      throw new Error(data.error || data.message || `요청 실패 (${res.status})`)
    }
    return data
  } catch (e) {
    throw friendlyFetchError(e)
  } finally {
    clearTimeout(timer)
  }
}

export const akboApi = {
  baseUrl: AKBOPLAY_API_BASE,

  health: () =>
    request('/api/health', {
      timeoutMs: 90000,
    }),

  /** Render 무료 플랜 슬립 깨우기 */
  wakeUp: async () => {
    try {
      const h = await akboApi.health()
      return { ok: Boolean(h?.ok), version: h?.version }
    } catch {
      await new Promise((r) => setTimeout(r, 2500))
      const h = await akboApi.health()
      return { ok: Boolean(h?.ok), version: h?.version }
    }
  },

  /** 웹 File → 기타 탭 변환 */
  convertToTabFile: async (file, opts = {}) => {
    const form = new FormData()
    const name = file.name || 'score.png'
    form.append('fileName', name)
    if (opts.force) form.append('force', '1')
    form.append('file', file, name)
    const q = opts.force ? '?force=1' : ''
    return request(`/api/tab-convert${q}`, {
      method: 'POST',
      body: form,
      timeoutMs: 150000,
      headers: opts.force ? { 'X-Tab-Force': '1' } : undefined,
    })
  },

  /** 유튜브 재생목록 → 악보 PDF 작업 시작 */
  startPlaylistScorePdfJob: (playlistUrl) =>
    request('/api/playlist-score-pdf/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistUrl }),
      timeoutMs: 60000,
    }),

  /** 작업 상태 폴링 */
  getPlaylistScorePdfJob: (jobId) =>
    request(`/api/playlist-score-pdf/jobs/${encodeURIComponent(jobId)}`, {
      timeoutMs: 30000,
    }),

  playlistScorePdfFileUrl: (jobId) =>
    `${AKBOPLAY_API_BASE}/api/playlist-score-pdf/jobs/${encodeURIComponent(jobId)}/file`,

  downloadPlaylistScorePdfFile: async (jobId) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60000)
    try {
      const res = await fetch(
        `${AKBOPLAY_API_BASE}/api/playlist-score-pdf/jobs/${encodeURIComponent(jobId)}/file`,
        { signal: controller.signal },
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `PDF 다운로드 실패 (${res.status})`)
      }
      return await res.blob()
    } catch (e) {
      throw friendlyFetchError(e)
    } finally {
      clearTimeout(timer)
    }
  },
}

/** base64 → 파일 다운로드 */
export function downloadBase64(base64, mime, fileName) {
  const a = document.createElement('a')
  a.href = `data:${mime};base64,${base64}`
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** Blob PDF 저장/열기 */
export async function openOrDownloadPdf(blob, fileName, fileUrl) {
  const url = URL.createObjectURL(blob)
  const ua = navigator.userAgent || ''
  const isIOS = /iPad|iPhone|iPod/i.test(ua)
  const isAndroid = /Android/i.test(ua)

  try {
    if (isIOS) {
      const opened = window.open(url, '_blank')
      if (!opened && fileUrl) window.location.href = fileUrl
      return
    }
    if (isAndroid && fileUrl) {
      window.location.href = fileUrl
      return
    }
    const a = document.createElement('a')
    a.href = url
    a.download = fileName || 'akboplay-score.pdf'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}
