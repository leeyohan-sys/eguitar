import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Grid3x3, X } from 'lucide-react'

/** 표준 튜닝 개방현 (0=6번줄 저음 E … 5=1번줄 고음 E) */
const OPEN_NOTES = ['E', 'A', 'D', 'G', 'B', 'E']
const STRING_LABELS = ['1E', '2B', '3G', '4D', '5A', '6E']

const ALL_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const NOTE_INDEX = Object.fromEntries(ALL_NOTES.map((note, i) => [note, i]))

/** 이명동음 → 프렛 비교용 피치 클래스 */
const TO_PITCH_CLASS = {
  Db: 'C#',
  Eb: 'D#',
  Fb: 'E',
  Gb: 'F#',
  Ab: 'G#',
  Bb: 'A#',
  Cb: 'B',
  'E#': 'F',
  'B#': 'C',
}

function toPitchClass(note) {
  return TO_PITCH_CLASS[note] || note
}

/** Major Key 목록 (조표 + 스케일 음) */
const MAJOR_KEYS = [
  {
    id: 'C',
    label: 'C Major',
    accidentals: [],
    notes: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
  },
  {
    id: 'G',
    label: 'G Major',
    accidentals: ['F#'],
    notes: ['G', 'A', 'B', 'C', 'D', 'E', 'F#'],
  },
  {
    id: 'D',
    label: 'D Major',
    accidentals: ['F#', 'C#'],
    notes: ['D', 'E', 'F#', 'G', 'A', 'B', 'C#'],
  },
  {
    id: 'A',
    label: 'A Major',
    accidentals: ['F#', 'C#', 'G#'],
    notes: ['A', 'B', 'C#', 'D', 'E', 'F#', 'G#'],
  },
  {
    id: 'E',
    label: 'E Major',
    accidentals: ['F#', 'C#', 'G#', 'D#'],
    notes: ['E', 'F#', 'G#', 'A', 'B', 'C#', 'D#'],
  },
  {
    id: 'F',
    label: 'F Major',
    accidentals: ['Bb'],
    notes: ['F', 'G', 'A', 'Bb', 'C', 'D', 'E'],
  },
  {
    id: 'Bb',
    label: 'Bb Major',
    accidentals: ['Bb', 'Eb'],
    notes: ['Bb', 'C', 'D', 'Eb', 'F', 'G', 'A'],
  },
]

const LETTER_STEP = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }

/** 오선에 올릴 기본 옥타브 (가온다 근처, 읽기 쉬운 위치) */
const DISPLAY_OCTAVE = {
  C: 5,
  D: 5,
  E: 4,
  F: 4,
  G: 4,
  A: 4,
  B: 4,
}

const FRETS = 20 // 1~20프렛
const FRET_CELL = 56 // 프렛 칸 너비(px 단위 viewBox)
const BOARD = {
  height: 220,
  padTop: 28,
  padBottom: 28,
  nutX: 28,
  nutW: 12,
  get endX() {
    return this.nutX + this.nutW + FRETS * FRET_CELL
  },
  get width() {
    return this.endX + 16
  },
}

function noteAt(stringIndex, fret) {
  const open = NOTE_INDEX[OPEN_NOTES[stringIndex]]
  return ALL_NOTES[(open + fret) % 12]
}

function rowToStringIndex(row) {
  return 5 - row
}

function pickRandomNote(pool, avoid) {
  const candidates = pool.filter((n) => n !== avoid)
  const list = candidates.length > 0 ? candidates : pool
  return list[Math.floor(Math.random() * list.length)]
}

function parseStaffNote(noteName) {
  const letter = noteName[0]
  let accidental = null
  if (noteName.endsWith('#')) accidental = 'sharp'
  else if (noteName.length > 1 && noteName.endsWith('b')) accidental = 'flat'
  const octave = DISPLAY_OCTAVE[letter] ?? 4
  const step = LETTER_STEP[letter] + (octave - 4) * 7
  return { letter, accidental, octave, step, label: noteName }
}

/** 조표 음(#/b)의 오선 위치 (트레블, C4=0 · 윗줄 F5=10) */
const SHARP_SIG_STEPS = {
  'F#': 10, // 윗줄
  'C#': 7, // 셋째 칸
  'G#': 12, // 윗줄 위
  'D#': 8, // 넷째 줄
  'A#': 5, // 둘째 칸 (A4)
  'E#': 9, // 넷째 칸
  'B#': 6, // 셋째 줄
}
const FLAT_SIG_STEPS = {
  Bb: 6, // 셋째 줄
  Eb: 9, // 넷째 칸
  Ab: 5, // 둘째 칸
  Db: 8, // 넷째 줄
  Gb: 4, // 둘째 줄
  Cb: 7, // 셋째 칸
  Fb: 3, // 첫째 칸
}

function stringY(row) {
  const usable = BOARD.height - BOARD.padTop - BOARD.padBottom
  return BOARD.padTop + (usable * row) / 5
}

/**
 * 오선지 + 음표 SVG
 * 조표와 목표 음을 표시 (문자 대신 시각적 기보)
 */
function StaffNotePrompt({ noteName, keyAccidentals }) {
  const parsed = parseStaffNote(noteName)
  const topY = 28
  const gap = 14
  // 트레블 윗줄 = F5(step 10), 아래줄 = E4(step 2)
  // 줄: E4=2, G4=4, B4=6, D5=8, F5=10 → G는 아래에서 두 번째 줄
  const TOP_LINE_STEP = 10
  const stepY = (step) => topY + (TOP_LINE_STEP - step) * (gap / 2)
  const noteY = stepY(parsed.step)
  const noteX = 168

  // 덧줄 (C4=0 등)
  const uniqueLedgers = Array.from(
    new Set(
      parsed.step <= 1
        ? [0]
        : parsed.step >= 12
          ? Array.from(
              { length: Math.ceil((parsed.step - 11) / 2) },
              (_, i) => 12 + i * 2,
            )
          : [],
    ),
  )

  const inKeySig = keyAccidentals.includes(noteName)
  const showAccidental = parsed.accidental && !inKeySig
  const stemDown = parsed.step >= 7 // B4 이상은 줄기 아래

  return (
    <div className="rounded-2xl border border-stone-700 bg-stone-900/80 px-2 py-2">
      <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-[0.2em] text-stone-500">
        Find this note
      </p>
      <svg
        viewBox="0 0 280 130"
        className="h-28 w-full max-w-[320px] sm:h-32"
        role="img"
        aria-label={`Staff note ${noteName}`}
      >
        {/* 오선 */}
        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={i}
            x1={52}
            y1={topY + i * gap}
            x2={268}
            y2={topY + i * gap}
            stroke="#d6d3d1"
            strokeWidth={1.4}
          />
        ))}

        {/* 트레블 클레프 */}
        <text
          x={54}
          y={topY + gap * 3.15}
          fontSize="64"
          fill="#fafaf9"
          fontFamily="Georgia, 'Times New Roman', serif"
        >
          𝄞
        </text>

        {/* 조표 */}
        {keyAccidentals.map((acc, i) => {
          const isSharp = acc.includes('#')
          const step = isSharp ? SHARP_SIG_STEPS[acc] : FLAT_SIG_STEPS[acc]
          if (step == null) return null
          return (
            <text
              key={`${acc}-${i}`}
              x={108 + i * 14}
              y={stepY(step) + 5}
              textAnchor="middle"
              fontSize="20"
              fill="#fbbf24"
              fontFamily="Georgia, serif"
            >
              {isSharp ? '♯' : '♭'}
            </text>
          )
        })}

        {/* 덧줄 */}
        {uniqueLedgers.map((s) => (
          <line
            key={`led-${s}`}
            x1={noteX - 16}
            y1={stepY(s)}
            x2={noteX + 16}
            y2={stepY(s)}
            stroke="#d6d3d1"
            strokeWidth={1.4}
          />
        ))}

        {/* 임시표 (조표에 없는 경우만) */}
        {showAccidental && (
          <text
            x={noteX - 22}
            y={noteY + 6}
            textAnchor="middle"
            fontSize="22"
            fill="#fbbf24"
            fontFamily="Georgia, serif"
          >
            {parsed.accidental === 'sharp' ? '♯' : '♭'}
          </text>
        )}

        {/* 음표 머리 */}
        <ellipse
          cx={noteX}
          cy={noteY}
          rx={9}
          ry={7}
          fill="#fbbf24"
          transform={`rotate(-18 ${noteX} ${noteY})`}
        />
        {/* 줄기 */}
        <line
          x1={noteX + (stemDown ? -8 : 8)}
          y1={noteY}
          x2={noteX + (stemDown ? -8 : 8)}
          y2={stemDown ? noteY + 36 : noteY - 36}
          stroke="#fbbf24"
          strokeWidth={2}
        />
      </svg>
    </div>
  )
}

/**
 * 참고 이미지형 지판 (0~20프렛)
 * 하단 그리드로 좌우 이동
 */
function FretboardGraphic({ feedback, locked, onFretClick }) {
  const inlaysSingle = [3, 5, 7, 9, 15, 17, 19]
  const stringRows = [0, 1, 2, 3, 4, 5]
  const boardTop = 18
  const boardBottom = BOARD.height - 22
  const playableLeft = BOARD.nutX + BOARD.nutW
  const cellW = FRET_CELL
  const scrollRef = useRef(null)
  const [activeFret, setActiveFret] = useState(0)

  const posX = (fret) => {
    if (fret === 0) return BOARD.nutX + BOARD.nutW / 2
    return playableLeft + cellW * (fret - 0.5)
  }

  const wireX = (fretNum) => playableLeft + cellW * fretNum

  /** 선택한 프렛이 보이도록 스크롤 */
  const scrollToFret = (fret) => {
    const el = scrollRef.current
    if (!el) return
    setActiveFret(fret)
    const svg = el.querySelector('svg')
    if (!svg) return
    const scale = svg.clientWidth / BOARD.width
    const targetX = posX(fret) * scale - el.clientWidth / 2
    el.scrollTo({ left: Math.max(0, targetX), behavior: 'smooth' })
  }

  const nudge = (dir) => {
    const next = Math.min(FRETS, Math.max(0, activeFret + dir * 3))
    scrollToFret(next)
  }

  // 정답/오답 위치가 화면에 보이도록
  useEffect(() => {
    if (feedback?.fret != null) scrollToFret(feedback.fret)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback?.stringIndex, feedback?.fret, feedback?.type])

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div
        ref={scrollRef}
        className="overflow-x-auto rounded-xl bg-black p-2 sm:p-3"
      >
        <svg
          viewBox={`0 0 ${BOARD.width} ${BOARD.height}`}
          className="h-auto"
          style={{ width: `${BOARD.width}px`, minWidth: `${BOARD.width}px` }}
          role="img"
          aria-label="Guitar fretboard 0-20 frets"
        >
          <rect
            x={BOARD.nutX}
            y={boardTop}
            width={BOARD.endX - BOARD.nutX}
            height={boardBottom - boardTop}
            fill="#5c3d1e"
          />
          <rect
            x={BOARD.nutX}
            y={boardTop}
            width={BOARD.nutW}
            height={boardBottom - boardTop}
            fill="#f5f5f4"
          />

          {Array.from({ length: FRETS }, (_, i) => {
            const fretNum = i + 1
            const x = wireX(fretNum)
            return (
              <line
                key={`fret-${fretNum}`}
                x1={x}
                y1={boardTop}
                x2={x}
                y2={boardBottom}
                stroke="#f5f5f4"
                strokeWidth={fretNum === FRETS ? 2.4 : 1.5}
              />
            )
          })}

          {inlaysSingle.map((fret) => (
            <circle
              key={`dot-${fret}`}
              cx={posX(fret)}
              cy={(stringY(2) + stringY(3)) / 2}
              r={6}
              fill="#c4c4c4"
            />
          ))}
          <circle
            cx={posX(12)}
            cy={(stringY(1) + stringY(2)) / 2}
            r={6}
            fill="#c4c4c4"
          />
          <circle
            cx={posX(12)}
            cy={(stringY(3) + stringY(4)) / 2}
            r={6}
            fill="#c4c4c4"
          />

          {stringRows.map((row) => {
            const y = stringY(row)
            const wound = row >= 3
            return (
              <line
                key={`string-${row}`}
                x1={BOARD.nutX}
                y1={y}
                x2={BOARD.endX}
                y2={y}
                stroke={wound ? '#e8a317' : '#f0f0f0'}
                strokeWidth={wound ? 3.4 + (row - 3) * 0.5 : 1.4 + row * 0.12}
                strokeLinecap="round"
              />
            )
          })}

          {stringRows.map((row) => {
            const stringIndex = rowToStringIndex(row)
            const y = stringY(row)
            return Array.from({ length: FRETS + 1 }, (_, fret) => {
              const cx = posX(fret)
              const isHit =
                feedback &&
                feedback.stringIndex === stringIndex &&
                feedback.fret === fret
              const hitW = fret === 0 ? BOARD.nutW + 10 : cellW
              const hitX = fret === 0 ? BOARD.nutX - 2 : cx - cellW / 2

              return (
                <g key={`hit-${row}-${fret}`}>
                  <rect
                    x={hitX}
                    y={y - 15}
                    width={hitW}
                    height={30}
                    fill="transparent"
                    className={locked ? 'cursor-default' : 'cursor-pointer'}
                    onClick={() => {
                      if (!locked) onFretClick(stringIndex, fret)
                    }}
                  >
                    <title>{`${STRING_LABELS[row]} fret ${fret}`}</title>
                  </rect>
                  {isHit && (
                    <circle
                      cx={cx}
                      cy={y}
                      r={12}
                      fill="#e11d2e"
                      stroke={feedback.type === 'ok' ? '#86efac' : '#1a0505'}
                      strokeWidth={feedback.type === 'ok' ? 3 : 1}
                    />
                  )}
                </g>
              )
            })
          })}

          {Array.from({ length: FRETS + 1 }, (_, fret) => (
            <text
              key={`num-${fret}`}
              x={posX(fret)}
              y={BOARD.height - 4}
              textAnchor="middle"
              fill="#78716c"
              fontSize="11"
              fontFamily="ui-monospace, monospace"
            >
              {fret}
            </text>
          ))}
        </svg>
      </div>

      {/* 프렛 이동 그리드 */}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => nudge(-1)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-stone-600 text-stone-300 hover:bg-stone-800"
          aria-label="Scroll left"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="grid min-w-0 flex-1 grid-cols-7 gap-1 sm:grid-cols-11">
          {Array.from({ length: FRETS + 1 }, (_, fret) => (
            <button
              key={fret}
              type="button"
              onClick={() => scrollToFret(fret)}
              className={[
                'rounded-md py-1.5 font-mono text-[10px] font-semibold tabular-nums sm:text-[11px]',
                activeFret === fret
                  ? 'bg-amber-500 text-stone-950'
                  : 'border border-stone-700 bg-stone-900 text-stone-400 hover:border-amber-500/50 hover:text-amber-300',
              ].join(' ')}
            >
              {fret}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => nudge(1)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-stone-600 text-stone-300 hover:bg-stone-800"
          aria-label="Scroll right"
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <p className="mt-1.5 text-center text-[10px] text-stone-500">
        Tap a fret number to jump · open = 0 · frets 1–20
      </p>
    </div>
  )
}

/**
 * 기타 자판 외우기 퀴즈
 * 오선 음표를 보고 Major Key 스케일 음을 지판에서 찾기
 */
export default function FretboardQuiz({ open, onClose }) {
  const [keyId, setKeyId] = useState('C')
  const [targetNote, setTargetNote] = useState('C')
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [misses, setMisses] = useState(0)
  const [feedback, setFeedback] = useState(null)
  const [locked, setLocked] = useState(false)

  const activeKey = useMemo(
    () => MAJOR_KEYS.find((k) => k.id === keyId) || MAJOR_KEYS[0],
    [keyId],
  )

  const notePool = activeKey.notes

  const nextRound = useCallback(
    (avoid) => {
      setTargetNote(pickRandomNote(notePool, avoid))
      setFeedback(null)
      setLocked(false)
    },
    [notePool],
  )

  useEffect(() => {
    if (!open) return
    setScore(0)
    setStreak(0)
    setMisses(0)
    nextRound(null)
  }, [open, keyId, nextRound])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const handleFretClick = (stringIndex, fret) => {
    if (locked) return
    const played = noteAt(stringIndex, fret)
    const targetPc = toPitchClass(targetNote)

    if (played === targetPc) {
      setLocked(true)
      setScore((s) => s + 1)
      setStreak((s) => s + 1)
      setFeedback({
        type: 'ok',
        text: `Correct · ${targetNote} · ${STRING_LABELS[5 - stringIndex]} fret ${fret}`,
        stringIndex,
        fret,
      })
      window.setTimeout(() => nextRound(targetNote), 750)
      return
    }

    setStreak(0)
    setMisses((m) => m + 1)
    setFeedback({
      type: 'bad',
      text: `That was ${played} · looking for ${targetNote}`,
      stringIndex,
      fret,
    })
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
      aria-label="Fretboard Drill"
    >
      <div className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-stone-600 bg-stone-950 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-stone-800 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-300 sm:text-base">
              Fretboard Drill
            </p>
            <p className="mt-0.5 text-[11px] text-stone-500 sm:text-xs">
              Read the staff note, then tap it on the fretboard
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

        {/* Major Key 선택 — 오선 위 */}
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3 sm:px-5">
          <span className="mr-1 text-[10px] uppercase tracking-wider text-stone-500">
            Key
          </span>
          {MAJOR_KEYS.map((key) => (
            <button
              key={key.id}
              type="button"
              onClick={() => setKeyId(key.id)}
              className={[
                'rounded-lg px-2.5 py-1.5 text-[11px] font-medium sm:text-xs',
                keyId === key.id
                  ? 'bg-amber-500 text-stone-950'
                  : 'border border-stone-600 text-stone-300 hover:bg-stone-800',
              ].join(' ')}
            >
              {key.label}
            </button>
          ))}
        </div>

        {/* 오선 문제 + 점수 */}
        <div className="flex flex-wrap items-end justify-between gap-3 px-4 py-3 sm:px-5">
          <StaffNotePrompt
            noteName={targetNote}
            keyAccidentals={activeKey.accidentals}
          />
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-4 text-right text-xs text-stone-400 sm:text-sm">
              <div>
                <p className="text-stone-500">Score</p>
                <p className="font-mono text-lg font-bold text-stone-100">{score}</p>
              </div>
              <div>
                <p className="text-stone-500">Streak</p>
                <p className="font-mono text-lg font-bold text-emerald-400">{streak}</p>
              </div>
              <div>
                <p className="text-stone-500">Miss</p>
                <p className="font-mono text-lg font-bold text-red-400">{misses}</p>
              </div>
            </div>
            {feedback && (
              <p
                className={[
                  'text-xs font-medium sm:text-sm',
                  feedback.type === 'ok' ? 'text-emerald-400' : 'text-red-400',
                ].join(' ')}
              >
                {feedback.text}
              </p>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-2 pb-4 sm:px-4">
          <FretboardGraphic
            feedback={feedback}
            locked={locked}
            onFretClick={handleFretClick}
          />
          <p className="mt-2 text-center text-[10px] text-stone-500 sm:text-[11px]">
            Notes follow the selected major scale · open = 0 · frets 1–20
          </p>
        </div>
      </div>
    </div>
  )
}

export { Grid3x3 as FretboardIcon }
