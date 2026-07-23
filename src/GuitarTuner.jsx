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
/** 자동 매칭 허용 범위 (±반음 3개) */
const MATCH_CENTS = 300
const BUFFER_SIZE = 4096
/** 기타 개방현 탐지 대역 */
const MIN_DETECT_HZ = 70
const MAX_DETECT_HZ = 400

function freqToCents(freq, target) {
  if (!freq || !target || freq <= 0) return 0
  return 1200 * Math.log2(freq / target)
}

/**
 * YIN 피치 검출 — 기타 개방현에 안정적
 * @returns {{ freq: number, rms: number, clarity: number } | null}
 */
function detectPitchYin(buf, sampleRate, minFreq, maxFreq) {
  const size = buf.length
  let rms = 0
  for (let i = 0; i < size; i += 1) rms += buf[i] * buf[i]
  rms = Math.sqrt(rms / size)
  if (rms < 0.002) return null

  const minTau = Math.max(2, Math.floor(sampleRate / maxFreq))
  const maxTau = Math.min(Math.floor(sampleRate / minFreq), Math.floor(size / 2) - 1)
  if (minTau >= maxTau) return null

  const yin = new Float32Array(maxTau + 1)
  const half = size >> 1

  // difference function
  for (let tau = 1; tau <= maxTau; tau += 1) {
    let sum = 0
    for (let i = 0; i < half; i += 1) {
      const d = buf[i] - buf[i + tau]
      sum += d * d
    }
    yin[tau] = sum
  }

  // cumulative mean normalized difference
  yin[0] = 1
  let running = 0
  for (let tau = 1; tau <= maxTau; tau += 1) {
    running += yin[tau]
    yin[tau] = running > 0 ? (yin[tau] * tau) / running : 1
  }

  const threshold = 0.2
  let tauEstimate = -1
  for (let tau = minTau; tau < maxTau; tau += 1) {
    if (yin[tau] < threshold) {
      while (tau + 1 < maxTau && yin[tau + 1] < yin[tau]) tau += 1
      tauEstimate = tau
      break
    }
  }
  if (tauEstimate < 0) return null

  // 포물선 보간으로 소수점 lag
  const x0 = Math.max(1, tauEstimate - 1)
  const x1 = tauEstimate
  const x2 = Math.min(maxTau, tauEstimate + 1)
  const s0 = yin[x0]
  const s1 = yin[x1]
  const s2 = yin[x2]
  const denom = 2 * (2 * s1 - s0 - s2)
  const betterTau = denom !== 0 ? x1 + (s2 - s0) / denom : x1

  const freq = sampleRate / betterTau
  if (freq < minFreq || freq > maxFreq) return null
  return { freq, rms, clarity: 1 - yin[tauEstimate] }
}

/** 감지 주파수를 가장 가까운 개방현에 매핑 */
function nearestString(freq, lockedId) {
  if (lockedId != null) {
    const locked = OPEN_STRINGS.find((s) => s.id === lockedId)
    if (locked) return locked
  }
  let best = OPEN_STRINGS[0]
  let bestAbs = Infinity
  for (const s of OPEN_STRINGS) {
    const abs = Math.abs(freqToCents(freq, s.freq))
    if (abs < bestAbs) {
      bestAbs = abs
      best = s
    }
  }
  // 너무 멀면 매칭 안 함 (잡음/하모닉 오인 방지)
  if (bestAbs > MATCH_CENTS) return null
  return best
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
 * 단일 피치(YIN) 검출 후 가장 가까운 현에 표시
 */
export default function GuitarTuner({ open, onClose }) {
  const [strings, setStrings] = useState(emptyStrings)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState(null)
  const [level, setLevel] = useState(0)
  const [lockedId, setLockedId] = useState(null)
  const [detectedHz, setDetectedHz] = useState(null)

  const audioRef = useRef(null)
  const rafRef = useRef(0)
  const centsSmoothRef = useRef(null)
  const lockedIdRef = useRef(null)
  const startGenRef = useRef(0)

  useEffect(() => {
    lockedIdRef.current = lockedId
  }, [lockedId])

  const stopAudio = () => {
    startGenRef.current += 1
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    const ctx = audioRef.current
    if (ctx) {
      ctx.stream?.getTracks().forEach((t) => t.stop())
      ctx.audioCtx?.close().catch(() => {})
      audioRef.current = null
    }
    centsSmoothRef.current = null
    setListening(false)
    setLevel(0)
    setDetectedHz(null)
  }

  const startAudio = async () => {
    setError(null)
    const gen = ++startGenRef.current
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone API not available (HTTPS required).')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          // 노트북 내장 마이크는 AGC 켜야 신호가 잡히는 경우가 많음
          autoGainControl: true,
        },
      })

      // StrictMode 더블 마운트 / 빠른 닫기 시 정리
      if (gen !== startGenRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume()
      }
      if (gen !== startGenRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        await audioCtx.close().catch(() => {})
        return
      }

      const source = audioCtx.createMediaStreamSource(stream)

      // 기타 개방현 대역만 통과 (좁은 현별 bandpass 제거 — 신호가 사라지던 원인)
      const highpass = audioCtx.createBiquadFilter()
      highpass.type = 'highpass'
      highpass.frequency.value = 55
      highpass.Q.value = 0.7

      const lowpass = audioCtx.createBiquadFilter()
      lowpass.type = 'lowpass'
      lowpass.frequency.value = 450
      lowpass.Q.value = 0.7

      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = BUFFER_SIZE
      analyser.smoothingTimeConstant = 0

      source.connect(highpass)
      highpass.connect(lowpass)
      lowpass.connect(analyser)

      const buf = new Float32Array(BUFFER_SIZE)
      audioRef.current = { stream, audioCtx, analyser, buf }
      setListening(true)

      let noiseFloor = 0.001

      const tick = () => {
        if (gen !== startGenRef.current) return
        const state = audioRef.current
        if (!state) return

        state.analyser.getFloatTimeDomainData(state.buf)

        let rms = 0
        for (let i = 0; i < state.buf.length; i += 1) {
          rms += state.buf[i] * state.buf[i]
        }
        rms = Math.sqrt(rms / state.buf.length)
        setLevel(Math.min(1, rms * 18))

        // 조용할 때 노이즈 플로어 학습
        if (rms < noiseFloor * 1.5) {
          noiseFloor = noiseFloor * 0.95 + rms * 0.05
        }
        const gate = Math.max(0.003, noiseFloor * 4)

        const pitch =
          rms >= gate
            ? detectPitchYin(
                state.buf,
                state.audioCtx.sampleRate,
                MIN_DETECT_HZ,
                MAX_DETECT_HZ,
              )
            : null

        if (!pitch || pitch.clarity < 0.55) {
          centsSmoothRef.current = null
          setDetectedHz(null)
          setStrings((prev) =>
            prev.map((s) => ({
              ...s,
              detectedHz: null,
              cents: 0,
              active: false,
              inTune: false,
              strength: Math.min(1, rms * 18),
            })),
          )
        } else {
          setDetectedHz(pitch.freq)
          const match = nearestString(pitch.freq, lockedIdRef.current)
          let cents = match ? freqToCents(pitch.freq, match.freq) : 0
          if (match) {
            const prev = centsSmoothRef.current
            cents =
              prev == null || prev.stringId !== match.id
                ? cents
                : prev.cents * 0.65 + cents * 0.35
            centsSmoothRef.current = { stringId: match.id, cents }
          } else {
            centsSmoothRef.current = null
          }

          setStrings(
            OPEN_STRINGS.map((s) => {
              const active = match != null && match.id === s.id
              return {
                ...s,
                detectedHz: active ? pitch.freq : null,
                cents: active ? cents : 0,
                active,
                inTune: active && Math.abs(cents) <= IN_TUNE_CENTS,
                strength: active ? Math.min(1, pitch.rms * 18) : 0,
              }
            }),
          )
        }

        rafRef.current = requestAnimationFrame(tick)
      }

      tick()
    } catch (err) {
      if (gen !== startGenRef.current) return
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
      setLockedId(null)
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

  const active = strings.find((s) => s.active)

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
              Pluck one string near the mic
              {lockedId != null ? ' · string locked' : ' · tap a string to lock'}
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
            <div className="ml-2 h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-stone-800">
              <div
                className={[
                  'h-full rounded-full transition-[width]',
                  level > 0.05 ? 'bg-emerald-400' : 'bg-stone-600',
                ].join(' ')}
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </div>
            {detectedHz != null && (
              <span className="shrink-0 font-mono text-[10px] text-sky-400">
                {detectedHz.toFixed(1)} Hz
              </span>
            )}
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
            Low input — allow mic permission, then pluck closer to the microphone.
          </p>
        )}

        {active?.inTune && (
          <p className="px-4 pb-2 text-center text-sm font-bold text-emerald-400 sm:px-5">
            {active.label} in tune ✓
          </p>
        )}

        <div className="min-h-0 flex-1 space-y-2.5 overflow-auto px-4 pb-5 sm:px-5">
          {[...strings].reverse().map((s) => {
            const clamped = Math.max(-50, Math.min(50, s.cents))
            const needle = ((clamped + 50) / 100) * 100
            const isLocked = lockedId === s.id

            return (
              <button
                key={s.id}
                type="button"
                onClick={() =>
                  setLockedId((prev) => (prev === s.id ? null : s.id))
                }
                className={[
                  'w-full rounded-2xl border px-3 py-2.5 text-left transition',
                  s.inTune
                    ? 'border-emerald-500/50 bg-emerald-500/10'
                    : s.active
                      ? 'border-amber-500/40 bg-stone-900'
                      : isLocked
                        ? 'border-sky-500/40 bg-stone-900'
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
                    {isLocked && (
                      <span className="text-[10px] font-semibold text-sky-400">
                        LOCK
                      </span>
                    )}
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
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export { Mic as TunerIcon }
