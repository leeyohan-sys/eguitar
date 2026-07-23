import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, X } from 'lucide-react'

const NOTE_NAMES = [
  'C',
  'C♯',
  'D',
  'D♯',
  'E',
  'F',
  'F♯',
  'G',
  'G♯',
  'A',
  'A♯',
  'B',
]

/** 참고용 개방현 (표시 힌트만) */
const OPEN_STRINGS = [
  { label: '6E', freq: 82.41 },
  { label: '5A', freq: 110.0 },
  { label: '4D', freq: 146.83 },
  { label: '3G', freq: 196.0 },
  { label: '2B', freq: 246.94 },
  { label: '1E', freq: 329.63 },
]

const A4 = 440
const IN_TUNE_CENTS = 8
const BUFFER_SIZE = 4096
/** 일반적인 기타 음역 (프렛 포함) */
const MIN_DETECT_HZ = 60
const MAX_DETECT_HZ = 1200

/**
 * YIN 피치 검출
 * @returns {{ freq: number, rms: number, clarity: number } | null}
 */
function detectPitchYin(buf, sampleRate, minFreq, maxFreq) {
  const size = buf.length
  let rms = 0
  for (let i = 0; i < size; i += 1) rms += buf[i] * buf[i]
  rms = Math.sqrt(rms / size)
  if (rms < 0.002) return null

  const minTau = Math.max(2, Math.floor(sampleRate / maxFreq))
  const maxTau = Math.min(
    Math.floor(sampleRate / minFreq),
    Math.floor(size / 2) - 1,
  )
  if (minTau >= maxTau) return null

  const yin = new Float32Array(maxTau + 1)
  const half = size >> 1

  for (let tau = 1; tau <= maxTau; tau += 1) {
    let sum = 0
    for (let i = 0; i < half; i += 1) {
      const d = buf[i] - buf[i + tau]
      sum += d * d
    }
    yin[tau] = sum
  }

  yin[0] = 1
  let running = 0
  for (let tau = 1; tau <= maxTau; tau += 1) {
    running += yin[tau]
    yin[tau] = running > 0 ? (yin[tau] * tau) / running : 1
  }

  const threshold = 0.15
  let tauEstimate = -1
  for (let tau = minTau; tau < maxTau; tau += 1) {
    if (yin[tau] < threshold) {
      while (tau + 1 < maxTau && yin[tau + 1] < yin[tau]) tau += 1
      tauEstimate = tau
      break
    }
  }
  if (tauEstimate < 0) return null

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

/** Hz → 가장 가까운 음이름 + 센트 */
function freqToNote(freq) {
  const midi = 69 + 12 * Math.log2(freq / A4)
  const rounded = Math.round(midi)
  const cents = (midi - rounded) * 100
  const noteIndex = ((rounded % 12) + 12) % 12
  const octave = Math.floor(rounded / 12) - 1
  return {
    name: NOTE_NAMES[noteIndex],
    octave,
    cents,
    midi: rounded,
    targetHz: A4 * 2 ** ((rounded - 69) / 12),
  }
}

/** 개방현에 가까우면 라벨 반환 */
function openStringHint(freq) {
  let best = null
  let bestAbs = Infinity
  for (const s of OPEN_STRINGS) {
    const cents = 1200 * Math.log2(freq / s.freq)
    const abs = Math.abs(cents)
    if (abs < bestAbs) {
      bestAbs = abs
      best = s
    }
  }
  if (best && bestAbs <= 50) return best.label
  return null
}

/**
 * 일반 크로매틱 튜너 — 들리는 음에 바늘/음이름 표시
 */
export default function GuitarTuner({ open, onClose }) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState(null)
  const [level, setLevel] = useState(0)
  const [reading, setReading] = useState(null) // { name, octave, cents, hz, hint, inTune }

  const audioRef = useRef(null)
  const rafRef = useRef(0)
  const smoothCentsRef = useRef(null)
  const holdRef = useRef({ until: 0, value: null })
  const startGenRef = useRef(0)

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
    smoothCentsRef.current = null
    holdRef.current = { until: 0, value: null }
    setListening(false)
    setLevel(0)
    setReading(null)
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
          autoGainControl: true,
        },
      })

      if (gen !== startGenRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      if (audioCtx.state === 'suspended') await audioCtx.resume()
      if (gen !== startGenRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        await audioCtx.close().catch(() => {})
        return
      }

      const source = audioCtx.createMediaStreamSource(stream)

      const highpass = audioCtx.createBiquadFilter()
      highpass.type = 'highpass'
      highpass.frequency.value = 50
      highpass.Q.value = 0.7

      const lowpass = audioCtx.createBiquadFilter()
      lowpass.type = 'lowpass'
      lowpass.frequency.value = 1400
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

        const now = performance.now()

        if (pitch && pitch.clarity >= 0.5) {
          const note = freqToNote(pitch.freq)
          const prev = smoothCentsRef.current
          // 음이 바뀌면 스무딩 리셋
          const cents =
            prev && prev.midi === note.midi
              ? prev.cents * 0.6 + note.cents * 0.4
              : note.cents
          smoothCentsRef.current = { midi: note.midi, cents }

          const next = {
            name: note.name,
            octave: note.octave,
            cents,
            hz: pitch.freq,
            hint: openStringHint(pitch.freq),
            inTune: Math.abs(cents) <= IN_TUNE_CENTS,
          }
          holdRef.current = { until: now + 350, value: next }
          setReading(next)
        } else if (holdRef.current.value && now < holdRef.current.until) {
          // 짧은 무음은 마지막 값 유지 (바늘 깜빡임 완화)
          setReading(holdRef.current.value)
        } else {
          smoothCentsRef.current = null
          holdRef.current = { until: 0, value: null }
          setReading(null)
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
      setReading(null)
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

  const cents = reading?.cents ?? 0
  const clamped = Math.max(-50, Math.min(50, cents))
  const needle = ((clamped + 50) / 100) * 100
  const hasTone = reading != null

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
      <div className="flex w-full max-w-md flex-col overflow-hidden rounded-3xl border border-stone-600 bg-stone-950 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-stone-800 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-300 sm:text-base">
              Guitar Tuner
            </p>
            <p className="mt-0.5 text-[11px] text-stone-500 sm:text-xs">
              Chromatic · play any note near the mic
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
            Low input — allow mic, then pluck closer to the microphone.
          </p>
        )}

        {/* 중앙 음이름 + 바늘 */}
        <div className="flex flex-col items-center px-4 pb-6 pt-2 sm:px-5">
          <div
            className={[
              'flex h-28 w-full items-center justify-center rounded-2xl border transition',
              reading?.inTune
                ? 'border-emerald-500/50 bg-emerald-500/10'
                : hasTone
                  ? 'border-amber-500/30 bg-stone-900'
                  : 'border-stone-800 bg-stone-900/60',
            ].join(' ')}
          >
            {hasTone ? (
              <div className="text-center">
                <p
                  className={[
                    'text-6xl font-bold tracking-tight sm:text-7xl',
                    reading.inTune ? 'text-emerald-400' : 'text-stone-100',
                  ].join(' ')}
                >
                  {reading.name}
                  <span className="ml-1 align-super text-2xl font-semibold text-stone-500 sm:text-3xl">
                    {reading.octave}
                  </span>
                </p>
                {reading.hint && (
                  <p className="mt-1 text-xs font-semibold text-sky-400">
                    Open {reading.hint}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-4xl font-bold text-stone-700">—</p>
            )}
          </div>

          <div className="mt-5 w-full">
            <div className="relative h-4 overflow-hidden rounded-full bg-stone-800">
              {/* 중앙 눈금 */}
              <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-stone-400" />
              {/* 인튠 구간 표시 */}
              {/* ±8¢ 인튠 구간 */}
              <div
                className="absolute inset-y-1 rounded-full bg-emerald-500/20"
                style={{ left: '42%', width: '16%' }}
              />
              {hasTone && (
                <div
                  className={[
                    'absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full shadow transition-[left]',
                    reading.inTune ? 'bg-emerald-400' : 'bg-amber-400',
                  ].join(' ')}
                  style={{ left: `${needle}%` }}
                />
              )}
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] uppercase tracking-wider text-stone-600">
              <span>Flat (−)</span>
              <span>Sharp (+)</span>
            </div>
          </div>

          <div className="mt-4 flex min-h-[1.5rem] items-center gap-3 font-mono text-sm tabular-nums">
            {hasTone ? (
              <>
                <span
                  className={
                    reading.inTune
                      ? 'font-bold text-emerald-400'
                      : 'text-amber-300'
                  }
                >
                  {reading.inTune
                    ? 'OK'
                    : cents > 0
                      ? `+${cents.toFixed(0)}¢`
                      : `${cents.toFixed(0)}¢`}
                </span>
                <span className="text-stone-600">·</span>
                <span className="text-stone-400">{reading.hz.toFixed(1)} Hz</span>
              </>
            ) : (
              <span className="text-stone-600">Waiting for sound…</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export { Mic as TunerIcon }
