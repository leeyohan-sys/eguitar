import { useEffect, useState } from 'react'
import { FileText, Loader2, Download, X } from 'lucide-react'
import { akboApi, openOrDownloadPdf } from './akboApi.js'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * 악보플레이 PDF 만들기 화면을 eguitar용으로 이식
 * 유튜브 재생목록 URL → 곡별 악보 이미지 검색 → 가로 2곡 PDF
 */
export default function PlaylistPdf({ open, onClose }) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [status, setStatus] = useState('')
  const [jobId, setJobId] = useState(null)

  useEffect(() => {
    if (!open) {
      setUrl('')
      setLoading(false)
      setError(null)
      setResult(null)
      setStatus('')
      setJobId(null)
      return undefined
    }
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const downloadReadyPdf = async (id, fileName) => {
    const fileUrl = akboApi.playlistScorePdfFileUrl(id)
    const blob = await akboApi.downloadPlaylistScorePdfFile(id)
    await openOrDownloadPdf(blob, fileName, fileUrl)
  }

  const makePdf = async () => {
    setError(null)
    setResult(null)
    setJobId(null)
    const playlistUrl = url.trim()
    if (!playlistUrl) {
      setError('유튜브 재생목록 URL을 입력해 주세요.')
      return
    }

    setLoading(true)
    setStatus('서버 연결 확인 중…')
    try {
      try {
        await akboApi.wakeUp()
      } catch {
        /* 계속 시도 */
      }

      setStatus('작업 시작 중…')
      const started = await akboApi.startPlaylistScorePdfJob(playlistUrl)
      const id = started.jobId
      if (!id) throw new Error('작업 ID를 받지 못했습니다.')
      setJobId(id)
      setStatus('재생목록·악보 검색 중…')

      let final = null
      const startedAt = Date.now()
      const maxMs = 4 * 60 * 1000

      while (Date.now() - startedAt < maxMs) {
        await sleep(2000)
        const job = await akboApi.getPlaylistScorePdfJob(id)
        if (job.message) setStatus(job.message)
        else if (job.total) {
          setStatus(`진행 중… ${job.current || 0}/${job.total}`)
        }

        if (job.status === 'done') {
          final = job
          break
        }
        if (job.status === 'error') {
          throw new Error(job.error || job.message || 'PDF 생성 실패')
        }
      }

      if (!final?.result) {
        throw new Error('시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.')
      }

      const out = { ...final.result, jobId: id }
      setResult(out)
      setStatus(
        `${out.playlistTitle} · ${out.songCount}곡 · ${out.pageCount}페이지 · 악보 ${out.foundCount}곡`,
      )

      if (out.hasPdf) {
        setStatus((prev) => `${prev}\n다운로드 중…`)
        await downloadReadyPdf(id, out.fileName || 'akboplay-score.pdf')
        setStatus(
          `${out.playlistTitle} · ${out.songCount}곡 · ${out.pageCount}페이지 · 악보 ${out.foundCount}곡`,
        )
      }
    } catch (e) {
      const raw =
        e instanceof Error
          ? e.message
          : '재생목록 악보 PDF 생성에 실패했습니다.'
      const msg = /404|Cannot POST|찾을 수 없/i.test(raw)
        ? 'API 서버가 아직 업데이트되지 않았습니다. 잠시 후 다시 시도해 주세요.'
        : raw
      setError(msg)
      setStatus('')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/80 px-3 py-3 sm:items-center sm:px-6"
      style={{
        paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
      }}
      role="dialog"
      aria-modal="true"
      aria-label="PDF 만들기"
    >
      <div className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-stone-600 bg-stone-950 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-stone-800 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-amber-500/90">
              Playlist → Score PDF
            </p>
            <p className="mt-0.5 text-sm font-bold text-stone-100 sm:text-base">
              PDF 만들기
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-stone-500 sm:text-xs">
              유튜브 재생목록 URL을 넣으면 곡마다 악보 이미지를 검색해
              <br />
              가로 한 페이지에 좌·우 2곡씩 PDF로 만듭니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-stone-600 text-stone-300 hover:bg-stone-800"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-4 sm:px-5">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-amber-500/80">
              재생목록 URL
            </span>
            <textarea
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://youtube.com/playlist?list=..."
              disabled={loading}
              rows={3}
              className="w-full resize-none rounded-xl border border-amber-500/30 bg-stone-900 px-3 py-2.5 text-sm text-stone-100 outline-none placeholder:text-stone-600 focus:border-amber-500/60 disabled:opacity-50"
            />
          </label>

          {status && (
            <p className="whitespace-pre-line text-xs text-amber-300/90">
              {status}
            </p>
          )}
          {error && (
            <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          {result?.songs?.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-stone-200">곡 목록</p>
              <ul className="space-y-1.5">
                {result.songs.map((s) => (
                  <li
                    key={`${s.index}-${s.title}`}
                    className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-stone-900/70 px-3 py-2"
                  >
                    <span className="w-6 shrink-0 text-center text-xs font-bold text-amber-400">
                      {s.index}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-stone-100">
                        {s.title}
                      </p>
                      <p className="truncate text-[11px] text-stone-500">
                        {s.scoreFound
                          ? s.scoreVideoTitle || '악보 이미지 찾음'
                          : '악보 미발견'}
                      </p>
                    </div>
                    <span
                      className={[
                        'shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold',
                        s.scoreFound
                          ? 'bg-amber-400 text-stone-950'
                          : 'bg-stone-700 text-stone-400',
                      ].join(' ')}
                    >
                      {s.scoreFound ? '악보' : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-stone-800 px-4 py-3 sm:px-5">
          <button
            type="button"
            disabled={loading}
            onClick={makePdf}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-sm font-bold text-stone-950 hover:bg-amber-400 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <FileText size={16} />
            )}
            {loading ? 'PDF 만드는 중…' : 'PDF 만들기'}
          </button>
          {result?.hasPdf && (result.jobId || jobId) && (
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                const id = result.jobId || jobId
                if (!id) return
                downloadReadyPdf(
                  id,
                  result.fileName || 'akboplay-score.pdf',
                ).catch((e) =>
                  setError(
                    e instanceof Error ? e.message : '다운로드에 실패했습니다.',
                  ),
                )
              }}
              className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-stone-600 px-3 text-xs text-stone-200 hover:bg-stone-800 disabled:opacity-50"
            >
              <Download size={14} />
              다시 다운로드
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export { FileText as PlaylistPdfIcon }
