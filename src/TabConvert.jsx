import { useCallback, useEffect, useRef, useState } from 'react'
import { FileMusic, Loader2, RefreshCw, Download, X } from 'lucide-react'
import { akboApi, downloadBase64 } from './akboApi.js'

/**
 * 악보플레이 TAB 변환 화면을 eguitar용으로 이식
 * 오선 악보 이미지/PDF → 기타 TAB (PNG/PDF/ASCII)
 */
export default function TabConvert({ open, onClose }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [hasLastUpload, setHasLastUpload] = useState(false)
  const lastFileRef = useRef(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (!open) {
      setLoading(false)
      setError(null)
      setResult(null)
      setHasLastUpload(false)
      lastFileRef.current = null
      if (fileInputRef.current) fileInputRef.current.value = ''
      return undefined
    }
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const runConvert = useCallback(async (file, force) => {
    setError(null)
    setLoading(true)
    if (force) setResult(null)
    try {
      try {
        await akboApi.wakeUp()
      } catch {
        // wake 실패해도 변환은 시도
      }

      const doConvert = () => akboApi.convertToTabFile(file, { force })

      let out
      try {
        out = await doConvert()
      } catch (firstErr) {
        const msg =
          firstErr instanceof Error ? firstErr.message : String(firstErr)
        if (/연결하지|시간|초과|Failed to fetch|network/i.test(msg)) {
          await new Promise((r) => setTimeout(r, 3000))
          await akboApi.wakeUp().catch(() => undefined)
          out = await doConvert()
        } else {
          throw firstErr
        }
      }

      if (force && out.cached) {
        setError(
          '서버가 아직 캐시 결과를 반환했습니다. 잠시 후 다시 시도해 주세요.',
        )
      }
      setResult(out)
    } catch (e) {
      setError(e instanceof Error ? e.message : '탭 변환에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  const onFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    lastFileRef.current = file
    setHasLastUpload(true)
    await runConvert(file, false)
  }

  const reconvert = async () => {
    const file = lastFileRef.current
    if (!file) {
      setError('다시 변환할 파일이 없습니다. 먼저 악보를 업로드해 주세요.')
      return
    }
    await runConvert(file, true)
  }

  if (!open) return null

  const pngUri = result?.pngBase64
    ? `data:image/png;base64,${result.pngBase64}`
    : null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/80 px-3 py-3 sm:items-center sm:px-6"
      style={{
        paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
      }}
      role="dialog"
      aria-modal="true"
      aria-label="TAB 변환"
    >
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-stone-600 bg-stone-950 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-stone-800 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-amber-500/90">
              Score → Guitar TAB
            </p>
            <p className="mt-0.5 text-sm font-bold text-stone-100 sm:text-base">
              TAB 변환
            </p>
            <p className="mt-0.5 text-[11px] text-stone-500 sm:text-xs">
              오선 악보 이미지를 올리면 기타 탭으로 바꿔 보여 줍니다.
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
          {error && (
            <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          {result ? (
            <div className="space-y-3">
              <div>
                <p className="text-lg font-bold text-stone-100">
                  {result.title || 'Guitar Tab'}
                </p>
                <p className="mt-1 text-xs text-amber-400/90">
                  {[
                    result.key ? `Key ${result.key}` : null,
                    result.positionLabel || null,
                    result.tempo ? `♩=${result.tempo}` : null,
                    result.timeSignature,
                    result.measureCount != null
                      ? `${result.measureCount}마디`
                      : null,
                    result.method === 'demo' ? '데모' : 'AI 변환',
                    result.forceApplied ? '재변환' : null,
                    result.cached ? '캐시' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {result.note && (
                  <p className="mt-1 text-xs text-stone-500">{result.note}</p>
                )}
              </div>

              {pngUri && (
                <button
                  type="button"
                  onClick={() => window.open(pngUri, '_blank')}
                  className="block w-full overflow-hidden rounded-xl border border-amber-500/30 bg-[#F7F3E8]"
                >
                  <img
                    src={pngUri}
                    alt="Guitar tab preview"
                    className="mx-auto max-h-[480px] w-full object-contain"
                  />
                </button>
              )}

              {result.asciiTab && (
                <div className="rounded-xl border border-stone-700 bg-stone-900/80 p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-amber-500/80">
                    ASCII TAB
                  </p>
                  <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-stone-400">
                    {result.asciiTab}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-amber-500/30 bg-stone-900/50 px-4 py-10 text-center">
              <p className="text-2xl text-amber-400/90">𝄞 → TAB</p>
              <p className="mt-2 text-xs leading-relaxed text-stone-500">
                JPG·PNG·PDF 악보를 업로드하세요.
                <br />
                변환에는 잠시(최대 1~2분) 걸릴 수 있습니다.
              </p>
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-stone-800 px-4 py-3 sm:px-5">
          <button
            type="button"
            disabled={loading}
            onClick={() => fileInputRef.current?.click()}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-sm font-bold text-stone-950 hover:bg-amber-400 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <FileMusic size={16} />
            )}
            {loading ? '변환 중…' : '악보 이미지/PDF 업로드'}
          </button>
          <div className="flex flex-wrap gap-2">
            {hasLastUpload && (
              <button
                type="button"
                disabled={loading}
                onClick={reconvert}
                className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-stone-600 px-3 text-xs text-stone-200 hover:bg-stone-800 disabled:opacity-50"
              >
                <RefreshCw size={14} />
                다시 변환
              </button>
            )}
            {result?.pngBase64 && (
              <button
                type="button"
                disabled={loading}
                onClick={() =>
                  downloadBase64(
                    result.pngBase64,
                    'image/png',
                    `${(result.title || 'tab').replace(/\s+/g, '_')}.png`,
                  )
                }
                className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-stone-600 px-3 text-xs text-stone-200 hover:bg-stone-800 disabled:opacity-50"
              >
                <Download size={14} />
                PNG 저장
              </button>
            )}
            {result?.pdfBase64 && (
              <button
                type="button"
                disabled={loading}
                onClick={() =>
                  downloadBase64(
                    result.pdfBase64,
                    'application/pdf',
                    `${(result.title || 'tab').replace(/\s+/g, '_')}.pdf`,
                  )
                }
                className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-stone-600 px-3 text-xs text-stone-200 hover:bg-stone-800 disabled:opacity-50"
              >
                <Download size={14} />
                PDF 저장
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,.pdf,.png,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={onFileChange}
          />
        </div>
      </div>
    </div>
  )
}

export { FileMusic as TabConvertIcon }
