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

const IN_TUNE_CENTS = 8
const ACCEPT_CENTS = 100 // 이 범위 안이면 해당 현으로 인정
const BUFFER_SIZE = 4096

function freqToCents(freq, target) {
  if (!freq || !target || freq <= 0) return 0
  return 1200 * Math.log2(freq / target)
}

/**
 * 자기상관 기반 피치 검출 (단일 대역 신호용)
 * 반환: Hz 또는 null
 */
function detectPitchAutoCorr(buf, sampleRate, minFreq, maxFreq) {
  const size = buf.length
  let rms = 0
  for (let i = 0; i < size; i += 1) rms += buf[i] * buf[i]
  rms = Math.sqrt(rms / size)
  if (rms < 0.004) return null // 너무 조용하면 무시

  // DC 제거
  let mean = 0
  for (let i = 0; i < size; i += 1) mean += buf[i]
  mean /= size

  const minLag = Math.floor(sampleRate / maxFreq)
  const maxLag = Math.min(Math.floor(sampleRate / minFreq), size - 1)
  if (minLag >= maxLag) return null

  let bestLag = -1
  let bestCorr = -1
  let prevCorr = 0
  let foundPeak = false

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let corr = 0
    for (let i = 0; i < size - lag; i += 1) {
      const a = buf[i] - mean
      const b = buf[i + lag] - mean
      corr += a * b
    }
    corr /= size - lag

    // rising edge 이후 첫 로컬 피크
    if (corr > bestCorr && corr > prevCorr) {
      bestCorr = corr
      bestLag = lag
      foundPeak = true
    } else if (foundPeak && corr < prevCorr && bestCorr > 0.01) {
      break
    }
    prevCorr = corr
  }

  if (bestLag <= 0 || bestCorr < 0.01) return null

  // 주변 보간으로 정밀도 향상
  const lag = bestLag
  let corrAt = (l) => {
    let c = 0
    for (let i = 0; i < size - l; i += 1) {
      const a = buf[i] - mean
      const b = buf[i + l] - mean
      c += a * b
    }
    return c / (size - l)
  }
  const y0 = lag > minLag ? corrAt(lag - 1) : bestCorr
  const y1 = bestCorr
  const y2 = lag < maxLag ? corrAt(lag + 1) : bestCorr
  const denom = 2 * (2 * y1 - y0 - y2)
  const shift = denom !== 0 ? (y0 - y2) / denom : 0
  const refinedLag = lag + shift

  const freq = sampleRate / refinedLag
  if (freq < minFreq || freq > maxFreq) return null
  return { freq, rms, clarity: bestCorr }
}

/**
 * 각 현 밴드패스 신호에서 피치 검출 → 6현 동시 튜닝
 */
function detectAllFromChannels(channels, sampleRate) {
  return OPEN_STRINGS.map((string, idx) => {
    const ch = channels[idx]
    if (!ch) {
      return {
        ...string,
        detectedHz: null,
        cents: 0,
        active: false,
        inTune: false,
        strength: 0,
      }
    }

    // 목표 ±1 반음 정도만 허용 (옥타브/하모닉 오인 방지)
    const minFreq = string.freq * 2 ** (-ACCEPT_CENTS / 1200)
    const maxFreq = string.freq * 2 ** (ACCEPT_CENTS / 1200)
    const result = detectPitchAutoCorr(ch.buf, sampleRate, minFreq, maxFreq)

    if (!result) {
      return {
        ...string,
        detectedHz: null,
        cents: 0,
        active: false,
        inTune: false,
        strength: Math.min(1, ch.rms * 12),
      }
    }

    const cents = freqToCents(result.freq, string.freq)
    const active = Math.abs(cents) <= ACCEPT_CENTS && result.rms > 0.004
    return {
      ...string,
      detectedHz: result.freq,
      cents,
      active,
      inTune: active && Math.abs(cents) <= IN_TUNE_CENTS,
      strength: Math.min(1, result.rms * 12),
    }
  })
}

function centsLabel(cents, active) {
  if (!active) return '—'
  if (Math.abs(cents) <= IN_TUNE_CENTS) return 'OK'
  return cents > 0 ? `+${cents.toFixed(0)}¢` : `${cents.toFixed(0)}¢`
}

function emptyStrings() {
  return OPEN_STRINGS.map((s) => ({
    ...s,
    detectedHz: null,
    cents: 0,
    active: false,
    inTune: false,
    strength: 0,
  }))
}

/**
 * 기타 튜너
 * 현마다 bandpass → 자기상관으로 6현을 동시에 측정
 */
export default function GuitarTuner({ open, onClose }) {
  const [strings, setStrings] = useState(emptyStrings)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState(null)
  const [level, setLevel] = useState(0)

  const audioRef = useRef(null)
  const rafRef = useRef(0)
  const centsSmoothRef = useRef(OPEN_STRINGS.map(() => null))

  const stopAudio = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    const ctx = audioRef.current
    if (ctx) {
      ctx.stream?.getTracks().forEach((t) => t.stop())
      ctx.audioCtx?.close().catch(() => {})
      audioRef.current = null
    }
    centsSmoothRef.current = OPEN_STRINGS.map(() => null)
    setListening(false)
    setLevel(0)
  }

  const startAudio = async () => {
    setError(null)
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone API not available (HTTPS required).')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      // 브라우저 자동재생 정책: suspended면 재개
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume()
      }

      const source = audioCtx.createMediaStreamSource(stream)

      // 저주파 럼블 제거
      const highpass = audioCtx.createBiquadFilter()
      highpass.type = 'highpass'
      highpass.frequency.value = 60
      highpass.Q.value = 0.7
      source.connect(highpass)

      // 전체 입력 레벨 미터
      const levelAnalyser = audioCtx.createAnalyser()
      levelAnalyser.fftSize = 2048
      highpass.connect(levelAnalyser)
      const levelBuf = new Float32Array(levelAnalyser.fftSize)

      // 현별 밴드패스 + Analyser
      const channels = OPEN_STRINGS.map((string) => {
        const band = audioCtx.createBiquadFilter()
        band.type = 'bandpass'
        band.frequency.value = string.freq
        // 저음은 Q를 조금 낮춰 대역을 넓힘
        band.Q.value = string.freq < 120 ? 12 : string.freq < 200 ? 16 : 22

        const analyser = audioCtx.createAnalyser()
        analyser.fftSize = BUFFER_SIZE
        analyser.smoothingTimeConstant = 0

        highpass.connect(band)
        band.connect(analyser)

        return {
          analyser,
          buf: new Float32Array(BUFFER_SIZE),
          rms: 0,
        }
      })

      audioRef.current = { stream, audioCtx, channels, levelAnalyser, levelBuf }
      setListening(true)

      const tick = () => {
        const state = audioRef.current
        if (!state) return

        // 입력 레벨
        state.levelAnalyser.getFloatTimeDomainData(state.levelBuf)
        let rms = 0
        for (let i = 0; i < state.levelBuf.length; i += 1) {
          rms += state.levelBuf[i] * state.levelBuf[i]
        }
        rms = Math.sqrt(rms / state.levelBuf.length)
        setLevel(Math.min(1, rms * 14))

        // 현별 버퍼 채우기
        state.channels.forEach((ch) => {
          ch.analyser.getFloatTimeDomainData(ch.buf)
          let r = 0
          for (let i = 0; i < ch.buf.length; i += 1) r += ch.buf[i] * ch.buf[i]
          ch.rms = Math.sqrt(r / ch.buf.length)
        })

        const detected = detectAllFromChannels(
          state.channels,
          state.audioCtx.sampleRate,
        )

        // 센트 값 스무딩 (바늘 떨림 완화)
        const smoothed = detected.map((s, i) => {
          if (!s.active) {
            centsSmoothRef.current[i] = null
            return s
          }
          const prev = centsSmoothRef.current[i]
          const next =
            prev == null ? s.cents : prev * 0.72 + s.cents * 0.28
          centsSmoothRef.current[i] = next
          return {
            ...s,
            cents: next,
            inTune: Math.abs(next) <= IN_TUNE_CENTS,
          }
        })

        setStrings(smoothed)
        rafRef.current = requestAnimationFrame(tick)
      }

      tick()
    } catch (err) {
      const msg =
        err?.name === 'NotAllowedError'
          ? 'Microphone permission denied. Allow mic access and try again.'
          : err?.message || 'Could not access microphone.'
      setError(msg)
      stopAudio()
    }
  }

  useEffect(() => {
    if (!open) {
      stopAudio()
      setStrings(emptyStrings())
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

  const activeCount = strings.filter((s) => s.active).length
  const allInTune =
    activeCount >= 2 && strings.filter((s) => s.active).every((s) => s.inTune)

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
              Play near the mic · one string or all six
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
          <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-stone-400">
            {listening ? (
              <>
                <Mic size={16} className="shrink-0 text-emerald-400" />
                <span>Listening</span>
              </>
            ) : (
              <>
                <MicOff size={16} className="shrink-0 text-stone-500" />
                <span>Mic off</span>
              </>
            )}
            {/* 입력 레벨 바 */}
            <div className="ml-2 h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-stone-800">
              <div
                className={[
                  'h-full rounded-full transition-[width]',
                  level > 0.05 ? 'bg-emerald-400' : 'bg-stone-600',
                ].join(' ')}
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => (listening ? stopAudio() : startAudio())}
            className="shrink-0 rounded-lg border border-stone-600 px-3 py-1.5 text-xs text-stone-200 hover:bg-stone-800"
          >
            {listening ? 'Pause' : 'Start mic'}
          </button>
        </div>

        {error && (
          <p className="px-4 pb-2 text-xs text-red-400 sm:px-5">{error}</p>
        )}

        {listening && level < 0.02 && (
          <p className="px-4 pb-2 text-xs text-amber-400/90 sm:px-5">
            Low input — move the guitar closer to the microphone.
          </p>
        )}

        {allInTune && (
          <p className="px-4 pb-2 text-center text-sm font-bold text-emerald-400 sm:px-5">
            Detected strings in tune ✓
          </p>
        )}

        <div className="min-h-0 flex-1 space-y-2.5 overflow-auto px-4 pb-5 sm:px-5">
          {[...strings].reverse().map((s) => {
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
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-bold text-stone-100">
                      {s.label}
                    </span>
                    <span className="text-[11px] text-stone-500">{s.note}</span>
                    <span className="font-mono text-[10px] text-stone-600">
                      {s.freq.toFixed(1)} Hz
                    </span>
                    {s.active && s.detectedHz != null && (
                      <span className="font-mono text-[10px] text-sky-400/90">
                        → {s.detectedHz.toFixed(1)} Hz
                      </span>
                    )}
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
