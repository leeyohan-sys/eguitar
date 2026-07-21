import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bell,
  CalendarDays,
  Check,
  Guitar,
  Pause,
  Play,
  RotateCcw,
  Music2,
} from 'lucide-react'

const TOTAL_SECONDS = 60 * 60 // 전체 60분
const STORAGE_KEY = 'eguitar-completed-dates'
const TIMER_STORAGE_KEY = 'eguitar-timer-state'
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

/** 각 단계가 끝나는 경과 초 (0=1단계 종료 … 3=전체 종료) */
const STEP_END_AT = [10 * 60, 20 * 60, 30 * 60, 60 * 60]

/** YYYY-MM-DD 형식으로 날짜 키 생성 */
function toDateKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 초 → mm:ss 또는 hh:mm:ss */
function formatTime(totalSec) {
  const s = Math.max(0, Math.ceil(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/** 날짜의 일의 자리에 따른 멜로디 연습 안내 */
function getMelodyGuide(dayOfMonth) {
  const digit = dayOfMonth % 10
  if (digit === 0) return '스케일 집중 연습'
  if ([1, 4, 7].includes(digit)) return 'C, G 코드 멜로디 연습'
  if ([2, 5, 8].includes(digit)) return 'D, A 코드 멜로디 연습'
  return 'E, F 코드 멜로디 연습'
}

/** 경과 초(elapsed)로 현재 단계 인덱스 계산 */
function stepIndexFromElapsed(elapsed) {
  if (elapsed < 10 * 60) return 0
  if (elapsed < 20 * 60) return 1
  if (elapsed < 30 * 60) return 2
  return 3
}

/** 경과 시간 기준으로 이미 끝난 단계 id 목록 */
function getFinishedStepIds(elapsed) {
  return STEP_END_AT.map((endAt, id) => (elapsed >= endAt ? id : null)).filter(
    (id) => id !== null,
  )
}

function loadCompletedDates() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveCompletedDates(dates) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dates))
}

/** 타이머 상태 복원 (백그라운드/새로고침 대응) */
function loadTimerState() {
  try {
    const raw = localStorage.getItem(TIMER_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function saveTimerState(state) {
  localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(state))
}

/** endAt 기준으로 남은 초 계산 (벽시계) */
function remainingFromEndAt(endAt) {
  return Math.max(0, (endAt - Date.now()) / 1000)
}

/** 짧은 알람음 (Web Audio) */
function playAlarmSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const now = ctx.currentTime

    ;[0, 0.18, 0.36].forEach((offset, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = i === 2 ? 880 : 660
      gain.gain.setValueAtTime(0.0001, now + offset)
      gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.15)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + offset)
      osc.stop(now + offset + 0.16)
    })

    // 오디오 컨텍스트 정리
    setTimeout(() => ctx.close().catch(() => {}), 800)
  } catch {
    // 오디오 미지원 환경은 무시
  }
}

/** 시스템 알림 + 진동 + 사운드 */
async function fireStepAlarm(step, isSessionEnd) {
  playAlarmSound()

  if (navigator.vibrate) {
    navigator.vibrate(isSessionEnd ? [300, 120, 300, 120, 400] : [220, 100, 220])
  }

  const title = isSessionEnd ? '60분 연습 완료!' : `${step.label} 종료`
  const body = isSessionEnd
    ? '전체 루틴이 끝났습니다. 수고하셨어요!'
    : `${step.title}이(가) 끝났습니다. 다음 단계로 넘어가세요.`

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body,
        icon: '/favicon.svg',
        tag: `eguitar-step-${step.id}`,
        renotify: true,
      })
    } catch {
      // 일부 브라우저는 Notification 생성 실패 가능
    }
  }

  return { title, body }
}

async function ensureNotificationPermission() {
  if (typeof Notification === 'undefined') return
  if (Notification.permission === 'default') {
    await Notification.requestPermission()
  }
}

export default function App() {
  const today = useMemo(() => new Date(), [])
  const todayKey = toDateKey(today)
  const melodyGuide = getMelodyGuide(today.getDate())

  const steps = useMemo(
    () => [
      {
        id: 0,
        label: '1단계',
        range: '00~10분',
        title: '스트록 연습',
        detail: '리듬 & 피킹 정확도',
        durationMin: 10,
        startSec: 0,
      },
      {
        id: 1,
        label: '2단계',
        range: '10~20분',
        title: '스케일 연습',
        detail: '포지션 이동 & 핑거링',
        durationMin: 10,
        startSec: 10 * 60,
      },
      {
        id: 2,
        label: '3단계',
        range: '20~30분',
        title: '악보 멜로디 연습',
        detail: melodyGuide,
        durationMin: 10,
        startSec: 20 * 60,
      },
      {
        id: 3,
        label: '4단계',
        range: '30~60분',
        title: '곡 연습',
        detail: '오늘의 곡 집중 연주',
        durationMin: 30,
        startSec: 30 * 60,
      },
    ],
    [melodyGuide],
  )

  const initial = useMemo(() => {
    const saved = loadTimerState()
    if (!saved) {
      return {
        remaining: TOTAL_SECONDS,
        running: false,
        endAt: null,
        notifiedEnds: [],
      }
    }
    if (saved.running && saved.endAt) {
      const rem = remainingFromEndAt(saved.endAt)
      return {
        remaining: rem,
        running: rem > 0,
        endAt: rem > 0 ? saved.endAt : null,
        notifiedEnds: Array.isArray(saved.notifiedEnds) ? saved.notifiedEnds : [],
      }
    }
    return {
      remaining: typeof saved.remaining === 'number' ? saved.remaining : TOTAL_SECONDS,
      running: false,
      endAt: null,
      notifiedEnds: Array.isArray(saved.notifiedEnds) ? saved.notifiedEnds : [],
    }
  }, [])

  const [remaining, setRemaining] = useState(initial.remaining)
  const [running, setRunning] = useState(initial.running)
  const [endAt, setEndAt] = useState(initial.endAt)
  const [notifiedEnds, setNotifiedEnds] = useState(initial.notifiedEnds)
  const [completedDates, setCompletedDates] = useState(loadCompletedDates)
  const [showCelebrate, setShowCelebrate] = useState(false)
  const [alarmToast, setAlarmToast] = useState(null)
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())

  const stepsRef = useRef(steps)
  stepsRef.current = steps
  const notifiedRef = useRef(notifiedEnds)
  notifiedRef.current = notifiedEnds

  const elapsed = TOTAL_SECONDS - remaining
  const activeStep = stepIndexFromElapsed(elapsed)
  const isTodayDone = completedDates.includes(todayKey)

  /** 상태 영속화 */
  useEffect(() => {
    saveTimerState({
      remaining,
      running,
      endAt,
      notifiedEnds,
    })
  }, [remaining, running, endAt, notifiedEnds])

  /** 새로 끝난 단계에 알람 발송 */
  const processStepEnds = useCallback(async (nextRemaining) => {
    const nextElapsed = TOTAL_SECONDS - nextRemaining
    const finished = getFinishedStepIds(nextElapsed)
    const pending = finished.filter((id) => !notifiedRef.current.includes(id))
    if (pending.length === 0) return

    const updated = [...notifiedRef.current, ...pending]
    notifiedRef.current = updated
    setNotifiedEnds(updated)

    // 백그라운드에서 여러 단계가 지났으면 마지막만 토스트, 알림은 각각
    for (const id of pending) {
      const step = stepsRef.current[id]
      const isSessionEnd = id === 3
      const info = await fireStepAlarm(step, isSessionEnd)
      setAlarmToast(info)
    }
  }, [])

  /** 벽시계 기준으로 남은 시간 동기화 */
  const syncFromClock = useCallback(() => {
    if (!running || !endAt) return
    const next = remainingFromEndAt(endAt)
    setRemaining(next)
    processStepEnds(next)
    if (next <= 0) {
      setRunning(false)
      setEndAt(null)
      setRemaining(0)
    }
  }, [running, endAt, processStepEnds])

  // 실행 중: 짧은 간격으로 벽시계 동기화 (백그라운드 복귀 시에도 정확)
  useEffect(() => {
    if (!running || !endAt) return undefined
    syncFromClock()
    const id = setInterval(syncFromClock, 250)
    return () => clearInterval(id)
  }, [running, endAt, syncFromClock])

  // 단계 종료 시각에 맞춰 알람 예약 (백그라운드에서도 가능한 한 정각에 울리도록)
  useEffect(() => {
    if (!running || !endAt) return undefined

    const timers = []
    const sessionStartAt = endAt - TOTAL_SECONDS * 1000

    STEP_END_AT.forEach((endSec, stepId) => {
      if (notifiedRef.current.includes(stepId)) return
      const fireAt = sessionStartAt + endSec * 1000
      const delay = fireAt - Date.now()
      if (delay <= 0) return
      timers.push(
        setTimeout(() => {
          syncFromClock()
        }, delay + 30),
      )
    })

    return () => timers.forEach(clearTimeout)
  }, [running, endAt, syncFromClock])

  // 탭 복귀 / 화면 켜짐 시 즉시 동기화
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') syncFromClock()
    }
    const onFocus = () => syncFromClock()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pageshow', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pageshow', onFocus)
    }
  }, [syncFromClock])

  // 알람 토스트 자동 닫기
  useEffect(() => {
    if (!alarmToast) return undefined
    const t = setTimeout(() => setAlarmToast(null), 4000)
    return () => clearTimeout(t)
  }, [alarmToast])

  // 축하 오버레이 자동 닫기
  useEffect(() => {
    if (!showCelebrate) return undefined
    const t = setTimeout(() => setShowCelebrate(false), 2400)
    return () => clearTimeout(t)
  }, [showCelebrate])

  const handleStartPause = async () => {
    if (remaining <= 0) return

    if (!running) {
      await ensureNotificationPermission()
      const nextEndAt = Date.now() + remaining * 1000
      setEndAt(nextEndAt)
      setRunning(true)
    } else {
      // 일시정지: 벽시계 기준으로 남은 시간 확정
      const rem = endAt ? remainingFromEndAt(endAt) : remaining
      setRemaining(rem)
      setEndAt(null)
      setRunning(false)
    }
  }

  const handleReset = () => {
    setRunning(false)
    setEndAt(null)
    setRemaining(TOTAL_SECONDS)
    setNotifiedEnds([])
    notifiedRef.current = []
  }

  /** 단계 선택 시 해당 단계 시작 시각으로 타이머 이동 */
  const selectStep = (step) => {
    setRunning(false)
    setEndAt(null)
    const rem = TOTAL_SECONDS - step.startSec
    setRemaining(rem)
    // 이미 지난 단계 종료 알림은 스킵 처리
    const already = getFinishedStepIds(step.startSec)
    setNotifiedEnds(already)
    notifiedRef.current = already
  }

  const markTodayComplete = useCallback(() => {
    if (isTodayDone) return
    setCompletedDates((prev) => {
      if (prev.includes(todayKey)) return prev
      const next = [...prev, todayKey]
      saveCompletedDates(next)
      return next
    })
    setShowCelebrate(true)
  }, [isTodayDone, todayKey])

  const calendarCells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1)
    const startWeekday = first.getDay()
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
    const cells = []

    for (let i = 0; i < startWeekday; i += 1) {
      cells.push({ type: 'empty', key: `e-${i}` })
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(viewYear, viewMonth, day)
      const key = toDateKey(date)
      cells.push({
        type: 'day',
        key,
        day,
        isToday: key === todayKey,
        isDone: completedDates.includes(key),
      })
    }
    return cells
  }, [viewYear, viewMonth, todayKey, completedDates])

  const monthLabel = `${viewYear}년 ${viewMonth + 1}월`
  const progressPct = ((TOTAL_SECONDS - remaining) / TOTAL_SECONDS) * 100

  const goPrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1)
      setViewMonth(11)
    } else {
      setViewMonth((m) => m - 1)
    }
  }

  const goNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1)
      setViewMonth(0)
    } else {
      setViewMonth((m) => m + 1)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col bg-[var(--bg)] px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
      {/* 헤더 */}
      <header className="mb-4 flex items-center gap-2.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
          <Guitar size={22} strokeWidth={2} />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-stone-50">
            E-Guitar 60분 루틴
          </h1>
          <p className="text-xs text-stone-400">매일 한 시간, 꾸준한 연습</p>
        </div>
      </header>

      {/* 달력 */}
      <section className="mb-5 rounded-2xl border border-stone-700/80 bg-stone-900/80 p-3.5 shadow-lg shadow-black/20">
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            onClick={goPrevMonth}
            className="rounded-lg px-2.5 py-1.5 text-sm text-stone-400 active:bg-stone-800"
            aria-label="이전 달"
          >
            ‹
          </button>
          <div className="flex items-center gap-1.5 text-sm font-semibold text-stone-100">
            <CalendarDays size={16} className="text-amber-400" />
            {monthLabel}
          </div>
          <button
            type="button"
            onClick={goNextMonth}
            className="rounded-lg px-2.5 py-1.5 text-sm text-stone-400 active:bg-stone-800"
            aria-label="다음 달"
          >
            ›
          </button>
        </div>

        <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[11px] font-medium text-stone-500">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-1">
              {w}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-0.5">
          {calendarCells.map((cell) => {
            if (cell.type === 'empty') {
              return <div key={cell.key} className="aspect-square" />
            }
            return (
              <div
                key={cell.key}
                className={[
                  'relative flex aspect-square flex-col items-center justify-center rounded-lg text-sm',
                  cell.isToday
                    ? 'bg-amber-500/20 font-bold text-amber-300 ring-1 ring-amber-500/60'
                    : 'text-stone-300',
                ].join(' ')}
              >
                <span>{cell.day}</span>
                {cell.isDone && (
                  <span
                    className="absolute bottom-0.5 text-[10px] leading-none"
                    title="연습 완료"
                  >
                    ✅
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* 전체 타이머 */}
      <section className="mb-5 rounded-2xl border border-stone-700/80 bg-gradient-to-b from-stone-900 to-stone-950 p-5 text-center shadow-lg shadow-black/25">
        <p className="mb-1 text-xs font-medium uppercase tracking-widest text-stone-500">
          Total Session
        </p>
        <div
          className={[
            'font-mono text-5xl font-bold tabular-nums tracking-tight text-stone-50',
            running ? 'timer-running' : '',
          ].join(' ')}
        >
          {formatTime(remaining)}
        </div>

        <div className="mx-auto mt-4 h-1.5 w-full max-w-[280px] overflow-hidden rounded-full bg-stone-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-600 to-amber-400 transition-[width] duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <p className="mt-2 text-xs text-stone-500">
          {steps[activeStep].label} · {steps[activeStep].title}
        </p>

        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={handleStartPause}
            disabled={remaining <= 0}
            className="flex h-14 min-w-[140px] items-center justify-center gap-2 rounded-2xl bg-amber-500 px-6 text-base font-bold text-stone-950 shadow-md shadow-amber-900/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? (
              <>
                <Pause size={22} fill="currentColor" />
                일시정지
              </>
            ) : (
              <>
                <Play size={22} fill="currentColor" />
                시작
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="flex h-14 w-14 items-center justify-center rounded-2xl border border-stone-600 bg-stone-800 text-stone-200 active:scale-[0.98] active:bg-stone-700"
            aria-label="리셋"
          >
            <RotateCcw size={22} />
          </button>
        </div>
      </section>

      {/* 세부 루틴 */}
      <section className="mb-4 flex-1">
        <div className="mb-2.5 flex items-center gap-1.5">
          <Music2 size={16} className="text-amber-400" />
          <h2 className="text-sm font-semibold text-stone-200">연습 루틴</h2>
        </div>

        <ul className="flex flex-col gap-2">
          {steps.map((step) => {
            const isActive = activeStep === step.id
            const isFinished = notifiedEnds.includes(step.id)
            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => selectStep(step)}
                  className={[
                    'flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors active:scale-[0.99]',
                    isActive
                      ? 'border-amber-500/50 bg-amber-500/10'
                      : 'border-stone-700/70 bg-stone-900/60',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold',
                      isActive
                        ? 'bg-amber-500 text-stone-950'
                        : isFinished
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-stone-800 text-stone-400',
                    ].join(' ')}
                  >
                    {isFinished && !isActive ? (
                      <Check size={16} strokeWidth={2.5} />
                    ) : (
                      step.id + 1
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={[
                          'text-sm font-semibold',
                          isActive ? 'text-amber-300' : 'text-stone-200',
                        ].join(' ')}
                      >
                        {step.title}
                      </span>
                      <span className="shrink-0 text-[11px] text-stone-500">
                        {step.range}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-stone-400">
                      {step.detail}
                    </span>
                  </span>
                  {isActive && (
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-400" />
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      {/* 오늘 연습 완료 */}
      <div className="sticky bottom-0 pt-2">
        <button
          type="button"
          onClick={markTodayComplete}
          disabled={isTodayDone}
          className={[
            'flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold shadow-lg transition-all active:scale-[0.99]',
            isTodayDone
              ? 'cursor-default border border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
              : 'bg-emerald-500 text-stone-950 shadow-emerald-900/30',
          ].join(' ')}
        >
          {isTodayDone ? (
            <>
              <Check size={22} strokeWidth={2.5} />
              오늘 연습 완료됨
            </>
          ) : (
            <>
              <Check size={22} strokeWidth={2.5} />
              오늘 연습 완료
            </>
          )}
        </button>
      </div>

      {/* 단계 종료 토스트 */}
      {alarmToast && (
        <div className="animate-celebrate fixed inset-x-0 top-4 z-50 mx-auto flex w-[calc(100%-2rem)] max-w-[448px] items-start gap-3 rounded-2xl border border-amber-500/40 bg-stone-900 px-4 py-3 shadow-xl shadow-black/40">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400">
            <Bell size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-amber-300">{alarmToast.title}</p>
            <p className="mt-0.5 text-xs text-stone-400">{alarmToast.body}</p>
          </div>
          <button
            type="button"
            onClick={() => setAlarmToast(null)}
            className="text-stone-500 active:text-stone-300"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
      )}

      {/* 축하 오버레이 */}
      {showCelebrate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6"
          role="dialog"
          aria-live="polite"
          onClick={() => setShowCelebrate(false)}
        >
          <div className="animate-celebrate max-w-[320px] rounded-3xl border border-amber-500/30 bg-stone-900 px-8 py-10 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/20 text-3xl">
              🎸
            </div>
            <p className="text-xl font-bold text-amber-300">
              오늘의 연습 complete!
            </p>
            <p className="mt-2 text-sm text-stone-400">
              출석이 달력에 기록되었어요.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
