import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, X } from 'lucide-react'

/** 표준 튜닝 (저음→고음) */
const OPEN_STRINGS = [
  { id: 6, label: '6E', note: 'E2', freq: 82.4069 },
  { id: 5, label: '5A', note: 'A2', freq: 110.0 },
  { id: 4, label: '4D', note: 'D3', freq: 146.832 },
  { id: 3, label: '3G', note: 'G3', freq: 195.998 },
  { id: 2, label: '2B', note: 'B3', freq: 246.942 },
  { id: 1, label: '1E', note: 'E4', freq: 329.628 },
]

const FFT_SIZE = 16384
const IN_TUNE_CENTS = 5
const SEARCH_CENTS = 80 // 각 현 주변 탐색 폭

function freqToCents(freq, target) {
  if (!freq || !target || freq <= 0) return 0
  return 1200 * Math.log2(freq / target)
}

function centsToFreq(target, cents) {
  return target * 2 ** (cents / 1200)
}

/** 파라볼릭 보간으로 피크 주파수 추정 */
function interpolatePeak(mags, bin, sampleRate, fftSize) {
  const prev = mags[bin - 1] ?? mags[bin]
  const curr = mags[bin]
  const next = mags[bin + 1] ?? mags[bin]
  const denom = prev - 2 * curr + next
  const delta = denom === 0 ? 0 : (0.5 * (prev - next)) / denom
  return ((bin + delta) * sampleRate) / fftSize
}

/**
 * FFT 스펙트럼에서 각 개방현 주파수 대역의 피크를 찾아
 * 6현을 동시에 추정 (합주/전현 스트럼 대응)
 */
function detectAllStrings(mags, sampleRate) {
  const binHz = sampleRate / FFT_SIZE

  return OPEN_STRINGS.map((string) => {
    const lowHz = centsToFreq(string.freq, -SEARCH_CENTS)
    const highHz = centsToFreq(string.freq, SEARCH_CENTS)
    let startBin = Math.max(1, Math.floor(lowHz / binHz))
    let endBin = Math.min(mags.length - 2, Math.ceil(highHz / binHz))

    // 저음 현은 하모닉 간섭을 줄이기 위해 기본음 근처만
    let bestBin = startBin
    let bestMag = -Infinity
    for (let i = startBin; i <= endBin; i += 1) {
      if (mags[i] > bestMag) {
        bestMag = mags[i]
        bestBin = i
      }
    }

    // 노이즈 플로어 대비 상대 강도
    let noise = 0
    let noiseCount = 0
    for (let i = startBin; i <= endBin; i += 1) {
      noise += mags[i]
      noiseCount += 1
    }
    const avg = noiseCount ? noise / noiseCount : 0
    const active = bestMag > avg * 2.2 && bestMag > 0.012

    if (!active) {
      return {
        ...string,
        detectedHz: null,
        cents: 0,
        active: false,
        inTune: false,
        strength: 0,
      }
    }

    const detectedHz = interpolatePeak(mags, bestBin, sampleRate, FFT_SIZE)
    const cents = freqToCents(detectedHz, string.freq)
    return {
      ...string,
      detectedHz,
      cents,
      active: true,
      inTune: Math.abs(cents) <= IN_TUNE_CENTS,
      strength: Math.min(1, bestMag * 8),
    }
  })
}

function centsLabel(cents, active) {
  if (!active) return '—'
  if (Math.abs(cents) <= IN_TUNE_CENTS) return 'OK'
  return cents > 0 ? `+${cents.toFixed(0)}¢` : `${cents.toFixed(0)}¢`
}

/**
 * 기타 튜너 — 마이크 + FFT로 6현 동시 튜닝
 */
export default function GuitarTuner({ open, onClose }) {
  const [strings, setStrings] = useState(() =>
    OPEN_STRINGS.map((s) => ({
      ...s,
      detectedHz: null,
      cents: 0,
      active: false,
      inTune: false,
      strength: 0,
    })),
  )
  const [listening, setListening] = useState(false)
  const [error, setError] = useState(null)

  const audioRef = useRef(null)
  const rafRef = useRef(0)

  const stopAudio = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    const ctx = audioRef.current
    if (ctx) {
      ctx.stream?.getTracks().forEach((t) => t.stop())
      ctx.audioCtx?.close().catch(() => {})
      audioRef.current = null
    }
    setListening(false)
  }

  const startAudio = async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = FFT_SIZE
      analyser.smoothingTimeConstant = 0.7
      source.connect(analyser)

      const mags = new Float32Array(analyser.frequencyBinCount)
      audioRef.current = { stream, audioCtx, analyser, mags }

      const tick = () => {
        const state = audioRef.current
        if (!state) return
        state.analyser.getFloatFrequencyData(state.mags)
        // dB → 선형 근사 강도
        const linear = new Float32Array(state.mags.length)
        for (let i = 0; i < state.mags.length; i += 1) {
          linear[i] = 10 ** (state.mags[i] / 20)
        }
        setStrings(detectAllStrings(linear, state.audioCtx.sampleRate))
        rafRef.current = requestAnimationFrame(tick)
      }

      setListening(true)
      tick()
    } catch (err) {
      setError(
        err?.name === 'NotAllowedError'
          ? 'Microphone permission denied. Allow mic access and try again.'
          : 'Could not access microphone.',
      )
      stopAudio()
    }
  }

  useEffect(() => {
    if (!open) {
      stopAudio()
      return undefined
    }
    void startAudio()
    return () => stopAudio()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const allInTune =
    strings.every((s) => s.inTune) && strings.some((s) => s.active)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/80 px-3 py-3 sm:items-center sm:px-6"
      style={{
        paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Guitar Tuner"
    >
      <div className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-stone-600 bg-stone-950 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-stone-800 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-300 sm:text-base">
              Guitar Tuner
            </p>
            <p className="mt-0.5 text-[11px] text-stone-500 sm:text-xs">
              Strum all strings — tunes all six at once
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

        <div className="flex items-center justify-between gap-2 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2 text-xs text-stone-400">
            {listening ? (
              <>
                <Mic size={16} className="text-emerald-400" />
                Listening…
              </>
            ) : (
              <>
                <MicOff size={16} className="text-stone-500" />
                Mic off
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => (listening ? stopAudio() : startAudio())}
            className="rounded-lg border border-stone-600 px-3 py-1.5 text-xs text-stone-200 hover:bg-stone-800"
          >
            {listening ? 'Pause' : 'Start mic'}
          </button>
        </div>

        {error && (
          <p className="px-4 pb-2 text-xs text-red-400 sm:px-5">{error}</p>
        )}

        {allInTune && (
          <p className="px-4 pb-2 text-center text-sm font-bold text-emerald-400 sm:px-5">
            All detected strings in tune ✓
          </p>
        )}

        <div className="min-h-0 flex-1 space-y-2.5 overflow-auto px-4 pb-5 sm:px-5">
          {[...strings].reverse().map((s) => {
            // 바늘: -50¢ ~ +50¢ → 0% ~ 100%
            const clamped = Math.max(-50, Math.min(50, s.cents))
            const needle = ((clamped + 50) / 100) * 100

            return (
              <div
                key={s.id}
                className={[
                  'rounded-2xl border px-3 py-2.5 transition',
                  s.inTune
                    ? 'border-emerald-500/50 bg-emerald-500/10'
                    : s.active
                      ? 'border-amber-500/40 bg-stone-900'
                      : 'border-stone-700/70 bg-stone-900/50',
                ].join(' ')}
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-bold text-stone-100">
                      {s.label}
                    </span>
                    <span className="text-[11px] text-stone-500">{s.note}</span>
                    <span className="font-mono text-[10px] text-stone-600">
                      {s.freq.toFixed(1)} Hz
                    </span>
                  </div>
                  <span
                    className={[
                      'font-mono text-xs font-semibold tabular-nums',
                      s.inTune
                        ? 'text-emerald-400'
                        : s.active
                          ? 'text-amber-300'
                          : 'text-stone-600',
                    ].join(' ')}
                  >
                    {centsLabel(s.cents, s.active)}
                  </span>
                </div>

                {/* 플랫 ← → 샤프 게이지 */}
                <div className="relative h-3 overflow-hidden rounded-full bg-stone-800">
                  <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-stone-500" />
                  {s.active && (
                    <div
                      className={[
                        'absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow',
                        s.inTune ? 'bg-emerald-400' : 'bg-amber-400',
                      ].join(' ')}
                      style={{ left: `${needle}%` }}
                    />
                  )}
                </div>
                <div className="mt-1 flex justify-between text-[9px] uppercase tracking-wider text-stone-600">
                  <span>Flat</span>
                  <span>Sharp</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export { Mic as TunerIcon }
