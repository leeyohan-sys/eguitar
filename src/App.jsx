import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bell,
  CalendarDays,
  Check,
  Guitar,
  ImagePlus,
  Pause,
  Play,
  RotateCcw,
  Music2,
  Video,
} from 'lucide-react'
import { loadAllStepImages, loadCompletedDates, loadTimerState, saveCompletedDates, saveStepImage, saveTimerState } from './practiceStore.js'

const TOTAL_SECONDS = 60 * 60 // 전체 60분
/** 이미지 업로드를 지원하는 단계 */
const STEP_IMAGE_CONFIG = {
  0: { windowName: 'eguitar-stroke-image' },
  1: { windowName: 'eguitar-scale-image' },
}
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

/** 날짜의 일의 자리 + 홀짝일에 따른 코드 쌍 (순서 포함) */
function getMelodyChordPair(dayOfMonth) {
  const digit = dayOfMonth % 10
  if (digit === 0) return []

  let pair
  if ([1, 4, 7].includes(digit)) pair = ['C', 'G']
  else if ([2, 5, 8].includes(digit)) pair = ['D', 'A']
  else pair = ['E', 'F']

  // 홀수일: 첫 번째 코드 먼저 / 짝수일: 두 번째 코드 먼저 (21일→C,G / 24일→G,C)
  if (dayOfMonth % 2 === 0) pair = [pair[1], pair[0]]
  return pair
}

/** 날짜의 일의 자리에 따른 멜로디 연습 안내 */
function getMelodyGuide(dayOfMonth) {
  const pair = getMelodyChordPair(dayOfMonth)
  if (pair.length === 0) return '스케일 집중 연습'
  return `${pair.join(', ')} 코드 멜로디 연습`
}

/** 10·20·30일 스케일 집중 연습 유튜브 */
const SCALE_FOCUS_YOUTUBE =
  'https://www.youtube.com/watch?v=EFCvyjXUFM0&list=PL-bWLXECK9oQB8l_cwZ6lQMuTHmXMppXP'

/** 코드별 유튜브 연습 링크 */
const MELODY_YOUTUBE = {
  C: 'https://www.youtube.com/watch?v=-z7Km5RUqOI&list=PLNOQEpM6CkBpETRGUzFauQoIvMaIVTF1J',
  D: 'https://www.youtube.com/watch?v=dQnGFlJSz2E&list=PLNOQEpM6CkBr-yIn-Fh7cJ-q4fG-mOyGV',
  E: 'https://www.youtube.com/watch?v=Vrfk2aJj2Fo&list=PLNOQEpM6CkBqran86XI_vACdV96DFxKRB',
  F: 'https://www.youtube.com/watch?v=vt5mir1oXU4&list=PLNOQEpM6CkBoQhtm1GgIuL8hSNZVsBTsO',
  G: 'https://www.youtube.com/watch?v=OuFk61490aE&list=PLNOQEpM6CkBocaUPCbzjbTYjkEX5bCyX2',
  A: 'https://www.youtube.com/watch?v=kgM3PD0ytsI&list=PLNOQEpM6CkBqtd99EWsPvKcEck1I0JD7J',
}

const POPUP_BLOCKED_MSG =
  '팝업이 차단되었습니다.\n\n브라우저 주소창 오른쪽의 팝업 차단 아이콘을 눌러\n이 사이트(localhost)의 팝업을 허용한 뒤 다시 시도해 주세요.'

/** 날짜별 오늘 연습할 코드 목록 (연습 순서) */
function getMelodyChordsForDay(dayOfMonth) {
  return getMelodyChordPair(dayOfMonth)
}

/** 10·20·30일 스케일 집중일 */
function isScaleFocusDay(dayOfMonth) {
  return dayOfMonth % 10 === 0
}

/** 3단계 시작 시 자동으로 열 유튜브 URL (첫 번째 코드 또는 스케일) */
function getMelodyAutoYoutubeUrl(dayOfMonth) {
  if (isScaleFocusDay(dayOfMonth)) return SCALE_FOCUS_YOUTUBE
  const chords = getMelodyChordPair(dayOfMonth)
  if (chords.length === 0) return null
  return MELODY_YOUTUBE[chords[0]]
}

/** 멜로디 연습에 유튜브가 있는 날 */
function hasMelodyYoutube(dayOfMonth) {
  return isScaleFocusDay(dayOfMonth) || getMelodyChordPair(dayOfMonth).length > 0
}

function getFullscreenPopupFeatures() {
  return [
    `width=${window.screen.availWidth}`,
    `height=${window.screen.availHeight}`,
    'left=0',
    'top=0',
    'menubar=no',
    'toolbar=no',
    'location=yes',
    'status=no',
    'scrollbars=yes',
    'resizable=yes',
  ].join(',')
}

/** 유튜브 watch 페이지를 새 창으로 직접 열기 (플레이리스트 표시) */
function openYoutubeWatchWindow(existingWindow, watchUrl, windowName = 'eguitar-youtube') {
  const features = getFullscreenPopupFeatures()

  if (existingWindow && !existingWindow.closed) {
    existingWindow.location.href = watchUrl
    existingWindow.focus()
    try {
      existingWindow.moveTo(0, 0)
      existingWindow.resizeTo(window.screen.availWidth, window.screen.availHeight)
    } catch {
      // 일부 브라우저는 창 크기 조절 제한
    }
    return existingWindow
  }

  const popup = window.open(watchUrl, windowName, features)
  if (!popup) {
    window.alert(POPUP_BLOCKED_MSG)
    return null
  }

  popup.focus()
  try {
    popup.moveTo(0, 0)
    popup.resizeTo(window.screen.availWidth, window.screen.availHeight)
  } catch {
    // 일부 브라우저는 창 크기 조절 제한
  }

  return popup
}

/** 악보 멜로디 연습 — 코드 선택 팝업 (수동 선택용) */
function openMelodyYoutubeWindow(existingWindow, chords, guideText) {
  if (chords.length === 0) return null

  const linksHtml = chords
    .map((chord) => {
      const url = MELODY_YOUTUBE[chord]
      return `<button type="button" class="chord-btn" data-watch="${url}">${chord} 코드</button>`
    })
    .join('')

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>악보 멜로디 연습</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      background: #0c0a09;
      color: #fafaf9;
      font-family: "Segoe UI", system-ui, sans-serif;
    }
    .wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      padding: 2rem;
      gap: 1.25rem;
      text-align: center;
    }
    .title {
      font-size: 1.25rem;
      font-weight: 700;
      color: #fbbf24;
    }
    .guide {
      font-size: 0.9375rem;
      color: #a8a29e;
    }
    .links {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 0.75rem;
    }
    .chord-btn {
      padding: 0.75rem 1.5rem;
      border-radius: 0.75rem;
      border: 1px solid #57534e;
      background: #292524;
      color: #fafaf9;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
    }
    .chord-btn:hover {
      border-color: #f59e0b;
      background: rgba(245, 158, 11, 0.12);
      color: #fbbf24;
    }
    .hint {
      font-size: 0.8125rem;
      color: #57534e;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <p class="title">악보 멜로디 연습</p>
    <p class="guide">${guideText}</p>
    <div class="links">${linksHtml}</div>
    <p class="hint">코드를 누르면 유튜브 플레이리스트 화면이 열립니다.<br>Esc 키로 창 닫기</p>
  </div>
  <script>
    document.querySelectorAll(".chord-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        // embed 대신 YouTube watch 페이지로 이동 → 오른쪽 플레이리스트 표시
        window.location.href = btn.dataset.watch;
      });
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") window.close();
    });
  </script>
</body>
</html>`

  const windowName = 'eguitar-melody-youtube'

  if (existingWindow && !existingWindow.closed) {
    existingWindow.document.open()
    existingWindow.document.write(html)
    existingWindow.document.close()
    existingWindow.focus()
    try {
      existingWindow.moveTo(0, 0)
      existingWindow.resizeTo(window.screen.availWidth, window.screen.availHeight)
    } catch {
      // 일부 브라우저는 창 크기 조절 제한
    }
    return existingWindow
  }

  const features = getFullscreenPopupFeatures()

  const popup = window.open('', windowName, features)
  if (!popup) {
    window.alert(POPUP_BLOCKED_MSG)
    return null
  }

  popup.document.open()
  popup.document.write(html)
  popup.document.close()
  popup.focus()

  try {
    popup.moveTo(0, 0)
    popup.resizeTo(window.screen.availWidth, window.screen.availHeight)
  } catch {
    // 일부 브라우저는 창 크기 조절 제한
  }

  return popup
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

/** 저장된 타이머 상태를 화면용 값으로 변환 */
function hydrateTimerState(saved) {
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
}

/** 업로드 이미지를 적당히 축소 (IndexedDB 저장용) */
function resizeImageFile(file, maxWidth = 1400, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('이미지를 불러올 수 없습니다.'))
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width)
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

/** 연습 참고 이미지를 새 창(모니터 전체)으로 표시 — 확대/이동 지원 */
function openStepImageWindow(existingWindow, dataUrl, title, windowName) {
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #0c0a09;
      color: #fafaf9;
      font-family: "Segoe UI", system-ui, sans-serif;
    }
    body {
      display: flex;
      flex-direction: column;
    }
    .toolbar {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.625rem 1rem;
      background: #1c1917;
      border-bottom: 1px solid #44403c;
    }
    .toolbar button {
      width: 2.25rem;
      height: 2.25rem;
      border: 1px solid #57534e;
      border-radius: 0.5rem;
      background: #292524;
      color: #fafaf9;
      font-size: 1.125rem;
      line-height: 1;
      cursor: pointer;
    }
    .toolbar button:hover {
      border-color: #f59e0b;
      color: #fbbf24;
    }
    .toolbar button.active {
      border-color: #f59e0b;
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
    }
    #zoom-level {
      min-width: 3.5rem;
      text-align: center;
      font-size: 0.8125rem;
      color: #a8a29e;
      font-variant-numeric: tabular-nums;
    }
    .title-text {
      margin-right: auto;
      font-size: 0.875rem;
      font-weight: 600;
      color: #fbbf24;
    }
    .hint {
      font-size: 0.75rem;
      color: #78716c;
    }
    .viewport {
      flex: 1;
      position: relative;
      overflow: hidden;
      background: #000;
      cursor: grab;
      touch-action: none;
    }
    .viewport.dragging { cursor: grabbing; }
    .viewport.zoom-mode { cursor: zoom-in; }
    .stage {
      position: absolute;
      top: 50%;
      left: 50%;
      transform-origin: center center;
      will-change: transform;
    }
    #viewer-img {
      display: block;
      max-width: none;
      max-height: none;
      user-select: none;
      -webkit-user-drag: none;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <span class="title-text">${title}</span>
    <button type="button" id="zoom-out" title="축소">−</button>
    <span id="zoom-level">100%</span>
    <button type="button" id="zoom-in" title="확대">+</button>
    <button type="button" id="zoom-fit" title="화면 맞춤">⛶</button>
    <button type="button" id="zoom-reset" title="원본 크기">1:1</button>
    <button type="button" id="zoom-lens" title="돋보기 모드">🔍</button>
    <span class="hint">드래그: 이동 · 휠/클릭(돋보기): 확대 · Esc: 닫기</span>
  </div>
  <div class="viewport" id="viewport">
    <div class="stage" id="stage">
      <img id="viewer-img" src="${dataUrl}" alt="${title} 참고 이미지" />
    </div>
  </div>
  <script>
    (function () {
      const viewport = document.getElementById("viewport");
      const stage = document.getElementById("stage");
      const img = document.getElementById("viewer-img");
      const zoomLabel = document.getElementById("zoom-level");
      const lensBtn = document.getElementById("zoom-lens");

      let scale = 1;
      let tx = 0;
      let ty = 0;
      let fitScale = 1;
      let dragging = false;
      let startX = 0;
      let startY = 0;
      let startTx = 0;
      let startTy = 0;
      let lensMode = false;

      function clampScale(v) {
        return Math.min(8, Math.max(0.2, v));
      }

      function applyTransform() {
        stage.style.transform = "translate(calc(-50% + " + tx + "px), calc(-50% + " + ty + "px)) scale(" + scale + ")";
        zoomLabel.textContent = Math.round(scale * 100) + "%";
      }

      function calcFitScale() {
        const vw = viewport.clientWidth;
        const vh = viewport.clientHeight;
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        if (!iw || !ih) return 1;
        return Math.min(vw / iw, vh / ih, 1);
      }

      function fitToScreen() {
        scale = calcFitScale();
        fitScale = scale;
        tx = 0;
        ty = 0;
        applyTransform();
      }

      function resetOneToOne() {
        scale = 1;
        tx = 0;
        ty = 0;
        applyTransform();
      }

      function zoomAt(factor, cx, cy) {
        const prev = scale;
        const next = clampScale(scale * factor);
        if (next === prev) return;
        const rect = viewport.getBoundingClientRect();
        const px = (cx ?? rect.left + rect.width / 2) - rect.left - rect.width / 2;
        const py = (cy ?? rect.top + rect.height / 2) - rect.top - rect.height / 2;
        const ratio = next / prev;
        tx = px - (px - tx) * ratio;
        ty = py - (py - ty) * ratio;
        scale = next;
        applyTransform();
      }

      img.addEventListener("load", fitToScreen);
      if (img.complete) fitToScreen();

      viewport.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startTx = tx;
        startTy = ty;
        viewport.classList.add("dragging");
      });

      window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        tx = startTx + (e.clientX - startX);
        ty = startTy + (e.clientY - startY);
        applyTransform();
      });

      window.addEventListener("mouseup", () => {
        dragging = false;
        viewport.classList.remove("dragging");
      });

      viewport.addEventListener("click", (e) => {
        if (!lensMode) return;
        zoomAt(1.4, e.clientX, e.clientY);
      });

      viewport.addEventListener("wheel", (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        zoomAt(factor, e.clientX, e.clientY);
      }, { passive: false });

      document.getElementById("zoom-in").addEventListener("click", () => zoomAt(1.25));
      document.getElementById("zoom-out").addEventListener("click", () => zoomAt(1 / 1.25));
      document.getElementById("zoom-fit").addEventListener("click", fitToScreen);
      document.getElementById("zoom-reset").addEventListener("click", resetOneToOne);

      lensBtn.addEventListener("click", () => {
        lensMode = !lensMode;
        lensBtn.classList.toggle("active", lensMode);
        viewport.classList.toggle("zoom-mode", lensMode);
      });

      window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") window.close();
        if (e.key === "+" || e.key === "=") zoomAt(1.2);
        if (e.key === "-") zoomAt(1 / 1.2);
        if (e.key === "0") fitToScreen();
      });

      window.addEventListener("resize", fitToScreen);
    })();
  </script>
</body>
</html>`

  // 이미 열린 창이 있으면 뷰어 전체 갱신
  if (existingWindow && !existingWindow.closed) {
    existingWindow.document.open()
    existingWindow.document.write(html)
    existingWindow.document.close()
    existingWindow.focus()
    try {
      existingWindow.moveTo(0, 0)
      existingWindow.resizeTo(window.screen.availWidth, window.screen.availHeight)
    } catch {
      // 일부 브라우저는 창 크기 조절 제한
    }
    return existingWindow
  }

  const features = getFullscreenPopupFeatures()

  const popup = window.open('', windowName, features)
  if (!popup) {
    window.alert(POPUP_BLOCKED_MSG)
    return null
  }

  popup.document.open()
  popup.document.write(html)
  popup.document.close()
  popup.focus()

  try {
    popup.moveTo(0, 0)
    popup.resizeTo(window.screen.availWidth, window.screen.availHeight)
  } catch {
    // 일부 브라우저는 창 크기 조절 제한
  }

  return popup
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
  try {
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'default') {
      // 브라우저가 권한 창을 안 띄워도 타이머가 멈추지 않도록 타임아웃
      await Promise.race([
        Notification.requestPermission(),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ])
    }
  } catch {
    // 알림 미지원/차단 시 무시
  }
}

export default function App() {
  const today = useMemo(() => new Date(), [])
  const todayKey = toDateKey(today)
  const melodyGuide = getMelodyGuide(today.getDate())
  const melodyChords = useMemo(
    () => getMelodyChordsForDay(today.getDate()),
    [today],
  )
  const scaleFocusDay = useMemo(() => isScaleFocusDay(today.getDate()), [today])
  const melodyYoutubeAvailable = useMemo(
    () => hasMelodyYoutube(today.getDate()),
    [today],
  )

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

  const [remaining, setRemaining] = useState(TOTAL_SECONDS)
  const [running, setRunning] = useState(false)
  const [endAt, setEndAt] = useState(null)
  const [notifiedEnds, setNotifiedEnds] = useState([])
  const [completedDates, setCompletedDates] = useState([])
  const [storageReady, setStorageReady] = useState(false)
  const [showCelebrate, setShowCelebrate] = useState(false)
  const [showCompleteSuggest, setShowCompleteSuggest] = useState(false)
  const [alarmToast, setAlarmToast] = useState(null)
  const [popupNotice, setPopupNotice] = useState(null)
  const [stepImages, setStepImages] = useState({ 0: '', 1: '' })
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())

  const stepsRef = useRef(steps)
  stepsRef.current = steps
  const notifiedRef = useRef(notifiedEnds)
  notifiedRef.current = notifiedEnds
  const stepFileRefs = useRef({})
  const stepImageWindowRefs = useRef({})
  const melodyYoutubeWindowRef = useRef(null)
  const prevActiveStepRef = useRef(0)

  const elapsed = TOTAL_SECONDS - remaining
  const activeStep = stepIndexFromElapsed(elapsed)
  const isTodayDone = completedDates.includes(todayKey)
  const isTodayDoneRef = useRef(isTodayDone)
  isTodayDoneRef.current = isTodayDone

  /** IndexedDB에서 저장 데이터 불러오기 (기존 localStorage 데이터 자동 이전) */
  useEffect(() => {
    let cancelled = false
    Promise.all([loadAllStepImages(), loadCompletedDates(), loadTimerState()])
      .then(([images, dates, timer]) => {
        if (cancelled) return
        setStepImages(images)
        setCompletedDates(dates)
        const hydrated = hydrateTimerState(timer)
        setRemaining(hydrated.remaining)
        setRunning(hydrated.running)
        setEndAt(hydrated.endAt)
        setNotifiedEnds(hydrated.notifiedEnds)
        notifiedRef.current = hydrated.notifiedEnds
        setStorageReady(true)
      })
      .catch(() => {
        if (!cancelled) setStorageReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  /** 상태 영속화 (초기 로드 전에는 기본값으로 덮어쓰지 않음) */
  useEffect(() => {
    if (!storageReady) return
    saveTimerState({
      remaining,
      running,
      endAt,
      notifiedEnds,
    })
  }, [remaining, running, endAt, notifiedEnds, storageReady])

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
      if (!isTodayDoneRef.current) {
        setShowCompleteSuggest(true)
      }
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

  // 팝업 차단 안내 자동 닫기
  useEffect(() => {
    if (!popupNotice) return undefined
    const t = setTimeout(() => setPopupNotice(null), 6000)
    return () => clearTimeout(t)
  }, [popupNotice])

  const notifyPopupBlocked = useCallback(() => {
    setPopupNotice({
      title: '팝업이 차단되었습니다',
      body: '주소창 오른쪽 팝업 차단 아이콘 → 이 사이트 허용 후 다시 시도해 주세요.',
    })
  }, [])

  const showStepImage = useCallback((stepId, dataUrl, title) => {
    if (!dataUrl || !STEP_IMAGE_CONFIG[stepId]) return
    const config = STEP_IMAGE_CONFIG[stepId]
    const win = openStepImageWindow(
      stepImageWindowRefs.current[stepId],
      dataUrl,
      title,
      config.windowName,
    )
    stepImageWindowRefs.current[stepId] = win
    if (!win) notifyPopupBlocked()
  }, [notifyPopupBlocked])

  /** 악보 멜로디 연습 유튜브 (autoOpenFirst: 3단계 시작 시 첫 코드/스케일 자동 열기) */
  const showMelodyYoutube = useCallback((autoOpenFirst = false) => {
    const day = today.getDate()
    if (!hasMelodyYoutube(day)) return

    if (autoOpenFirst) {
      const autoUrl = getMelodyAutoYoutubeUrl(day)
      if (autoUrl) {
        const win = openYoutubeWatchWindow(
          melodyYoutubeWindowRef.current,
          autoUrl,
          'eguitar-melody-youtube',
        )
        melodyYoutubeWindowRef.current = win
        if (!win) notifyPopupBlocked()
        return
      }
    }

    if (scaleFocusDay) {
      const win = openYoutubeWatchWindow(
        melodyYoutubeWindowRef.current,
        SCALE_FOCUS_YOUTUBE,
        'eguitar-melody-youtube',
      )
      melodyYoutubeWindowRef.current = win
      if (!win) notifyPopupBlocked()
      return
    }

    const win = openMelodyYoutubeWindow(
      melodyYoutubeWindowRef.current,
      melodyChords,
      melodyGuide,
    )
    melodyYoutubeWindowRef.current = win
    if (!win) notifyPopupBlocked()
  }, [today, scaleFocusDay, melodyChords, melodyGuide, notifyPopupBlocked])

  // 타이머 진행 중 3단계(멜로디)에 진입하면 첫 코드/스케일 유튜브 자동 열기
  useEffect(() => {
    if (running && activeStep === 2 && prevActiveStepRef.current !== 2) {
      showMelodyYoutube(true)
    }
    prevActiveStepRef.current = activeStep
  }, [activeStep, running, showMelodyYoutube])

  const handleStartPause = () => {
    if (remaining <= 0) return

    if (!running) {
      // 타이머를 먼저 시작하고, 알림 권한은 백그라운드로 요청
      const nextEndAt = Date.now() + remaining * 1000
      const currentStep = stepIndexFromElapsed(TOTAL_SECONDS - remaining)
      const stepImage = stepImages[currentStep]

      setEndAt(nextEndAt)
      setRunning(true)
      if (stepImage && STEP_IMAGE_CONFIG[currentStep]) {
        showStepImage(currentStep, stepImage, steps[currentStep].title)
      }
      if (currentStep === 2) {
        showMelodyYoutube(true)
      }

      void ensureNotificationPermission()
    } else {
      // 일시정지: 벽시계 기준으로 남은 시간 확정
      const rem = endAt ? remainingFromEndAt(endAt) : remaining
      setRemaining(rem)
      setEndAt(null)
      setRunning(false)
    }
  }

  /** 단계별 참고 이미지 업로드 (덮어쓰기 저장) */
  const handleStepImageUpload = async (stepId, event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !file.type.startsWith('image/')) return
    try {
      const dataUrl = await resizeImageFile(file)
      await saveStepImage(stepId, dataUrl)
      setStepImages((prev) => ({ ...prev, [stepId]: dataUrl }))
      // 이미지 창이 열려 있으면 새 이미지로 즉시 갱신
      const win = stepImageWindowRefs.current[stepId]
      if (win && !win.closed) {
        showStepImage(stepId, dataUrl, steps[stepId].title)
      }
    } catch (err) {
      window.alert(err.message || '이미지를 저장하지 못했습니다. 다시 시도해 주세요.')
    }
  }

  const handleReset = () => {
    setRunning(false)
    setEndAt(null)
    setRemaining(TOTAL_SECONDS)
    setNotifiedEnds([])
    notifiedRef.current = []
  }

  /** 슬라이더로 경과 시간(세션 위치) 조절 */
  const handleTimeSliderChange = (elapsedSec) => {
    const clamped = Math.max(0, Math.min(TOTAL_SECONDS, elapsedSec))
    const nextRemaining = TOTAL_SECONDS - clamped

    setRemaining(nextRemaining)

    if (running) {
      if (nextRemaining <= 0) {
        setRunning(false)
        setEndAt(null)
        setRemaining(0)
        if (!isTodayDoneRef.current) {
          setShowCompleteSuggest(true)
        }
      } else {
        setEndAt(Date.now() + nextRemaining * 1000)
      }
    }

    // 슬라이더 이동에 맞춰 단계 알림 상태도 동기화
    const already = getFinishedStepIds(clamped)
    setNotifiedEnds(already)
    notifiedRef.current = already
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
    setShowCompleteSuggest(false)
    setShowCelebrate(true)
  }, [isTodayDone, todayKey])

  const unmarkTodayComplete = useCallback(() => {
    if (!isTodayDone) return
    setCompletedDates((prev) => {
      const next = prev.filter((d) => d !== todayKey)
      saveCompletedDates(next)
      return next
    })
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
  const elapsedSec = TOTAL_SECONDS - remaining

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
    <div className="min-h-dvh w-full px-6 py-8 lg:px-10 lg:py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        {/* 헤더 */}
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400">
              <Guitar size={26} strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-stone-50">
                E-Guitar 60분 루틴
              </h1>
              <p className="text-sm text-stone-400">매일 한 시간, 꾸준한 연습</p>
            </div>
          </div>
          <p className="hidden text-sm text-stone-500 sm:block">
            {today.getFullYear()}.
            {String(today.getMonth() + 1).padStart(2, '0')}.
            {String(today.getDate()).padStart(2, '0')}
          </p>
        </header>

        {/* PC 2열: 좌측 달력 / 우측 타이머+루틴 */}
        <div className="grid gap-6 lg:grid-cols-[340px_1fr] lg:items-start">
          {/* 좌측: 달력 + 완료 */}
          <aside className="flex flex-col gap-4">
            <section className="rounded-2xl border border-stone-700/80 bg-stone-900/80 p-5 shadow-lg shadow-black/20">
              <div className="mb-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={goPrevMonth}
                  className="rounded-lg px-3 py-2 text-lg text-stone-400 hover:bg-stone-800 hover:text-stone-200"
                  aria-label="이전 달"
                >
                  ‹
                </button>
                <div className="flex items-center gap-2 text-base font-semibold text-stone-100">
                  <CalendarDays size={18} className="text-amber-400" />
                  {monthLabel}
                </div>
                <button
                  type="button"
                  onClick={goNextMonth}
                  className="rounded-lg px-3 py-2 text-lg text-stone-400 hover:bg-stone-800 hover:text-stone-200"
                  aria-label="다음 달"
                >
                  ›
                </button>
              </div>

              <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-medium text-stone-500">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="py-1.5">
                    {w}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
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
                          : 'text-stone-300 hover:bg-stone-800/60',
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

            <button
              type="button"
              onClick={isTodayDone ? unmarkTodayComplete : markTodayComplete}
              className={[
                'flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold shadow-lg transition-all hover:brightness-110',
                isTodayDone
                  ? 'border border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
                  : 'bg-emerald-500 text-stone-950 shadow-emerald-900/30',
              ].join(' ')}
            >
              {isTodayDone ? (
                <>
                  <Check size={22} strokeWidth={2.5} />
                  오늘 연습 완료됨 · 출석 취소
                </>
              ) : (
                <>
                  <Check size={22} strokeWidth={2.5} />
                  오늘 연습 완료
                </>
              )}
            </button>
          </aside>

          {/* 우측: 타이머 + 루틴 */}
          <main className="flex flex-col gap-5">
            <section className="rounded-2xl border border-stone-700/80 bg-gradient-to-b from-stone-900 to-stone-950 px-8 py-10 text-center shadow-lg shadow-black/25">
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-stone-500">
                Total Session
              </p>
              <div
                className={[
                  'font-mono text-7xl font-bold tabular-nums tracking-tight text-stone-50 lg:text-8xl',
                  running ? 'timer-running' : '',
                ].join(' ')}
              >
                {formatTime(remaining)}
              </div>

              <div className="mx-auto mt-6 w-full max-w-md">
                <input
                  type="range"
                  min={0}
                  max={TOTAL_SECONDS}
                  step={1}
                  value={elapsedSec}
                  onChange={(e) => handleTimeSliderChange(Number(e.target.value))}
                  className="timer-slider"
                  style={{ '--progress': `${progressPct}%` }}
                  aria-label="연습 시간 조절"
                />
                <div className="mt-2 flex justify-between text-[11px] tabular-nums text-stone-500">
                  <span>00:00</span>
                  <span className="text-stone-400">
                    {formatTime(remaining)} 남음 · {steps[activeStep].range}
                  </span>
                  <span>60:00</span>
                </div>
              </div>

              <p className="mt-3 text-sm text-stone-400">
                {steps[activeStep].label} · {steps[activeStep].title}
              </p>

              <div className="mt-8 flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={handleStartPause}
                  disabled={remaining <= 0}
                  className="flex h-14 min-w-[160px] items-center justify-center gap-2 rounded-2xl bg-amber-500 px-8 text-base font-bold text-stone-950 shadow-md shadow-amber-900/40 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
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
                  className="flex h-14 w-14 items-center justify-center rounded-2xl border border-stone-600 bg-stone-800 text-stone-200 hover:bg-stone-700"
                  aria-label="리셋"
                >
                  <RotateCcw size={22} />
                </button>
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center gap-2">
                <Music2 size={18} className="text-amber-400" />
                <h2 className="text-base font-semibold text-stone-200">연습 루틴</h2>
              </div>

              <ul className="grid gap-3 sm:grid-cols-2">
                {steps.map((step) => {
                  const isActive = activeStep === step.id
                  const isFinished = notifiedEnds.includes(step.id)
                  const hasImageUpload = Boolean(STEP_IMAGE_CONFIG[step.id])
                  const stepImage = stepImages[step.id]
                  return (
                    <li key={step.id}>
                      <div
                        className={[
                          'flex h-full w-full items-start gap-3 rounded-xl border px-4 py-4 transition-colors',
                          isActive
                            ? 'border-amber-500/50 bg-amber-500/10'
                            : 'border-stone-700/70 bg-stone-900/60 hover:border-stone-500',
                        ].join(' ')}
                      >
                        <button
                          type="button"
                          onClick={() => selectStep(step)}
                          className="flex min-w-0 flex-1 items-start gap-3 text-left"
                        >
                          <span
                            className={[
                              'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold',
                              isActive
                                ? 'bg-amber-500 text-stone-950'
                                : isFinished
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : 'bg-stone-800 text-stone-400',
                            ].join(' ')}
                          >
                            {isFinished && !isActive ? (
                              <Check size={18} strokeWidth={2.5} />
                            ) : (
                              step.id + 1
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span
                                className={[
                                  'text-sm font-semibold',
                                  isActive ? 'text-amber-300' : 'text-stone-200',
                                ].join(' ')}
                              >
                                {step.title}
                              </span>
                              <span className="shrink-0 text-xs text-stone-500">
                                {step.range}
                              </span>
                            </span>
                            <span className="mt-1 block text-xs leading-relaxed text-stone-400">
                              {step.detail}
                            </span>
                          </span>
                          {isActive && (
                            <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" />
                          )}
                        </button>

                        {/* 스트록·스케일 연습: 참고 이미지 업로드 */}
                        {hasImageUpload && (
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <button
                              type="button"
                              onClick={() => stepFileRefs.current[step.id]?.click()}
                              className="inline-flex items-center gap-1 rounded-lg border border-stone-600 bg-stone-800 px-2.5 py-1.5 text-[11px] font-medium text-stone-200 hover:border-amber-500/50 hover:bg-stone-700 hover:text-amber-300"
                              title={`${step.title} 참고 이미지 업로드`}
                            >
                              <ImagePlus size={14} />
                              {stepImage ? '이미지 변경' : '이미지 업로드'}
                            </button>
                            {stepImage && (
                              <button
                                type="button"
                                onClick={() =>
                                  showStepImage(step.id, stepImage, step.title)
                                }
                                className="text-[10px] text-amber-400/80 hover:text-amber-300"
                              >
                                새 창으로 보기
                              </button>
                            )}
                          </div>
                        )}

                        {/* 악보 멜로디 연습: 오늘 코드/스케일 유튜브 */}
                        {step.id === 2 && melodyYoutubeAvailable && (
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <button
                              type="button"
                              onClick={() => showMelodyYoutube(false)}
                              className="inline-flex items-center gap-1 rounded-lg border border-stone-600 bg-stone-800 px-2.5 py-1.5 text-[11px] font-medium text-stone-200 hover:border-red-500/50 hover:bg-stone-700 hover:text-red-300"
                              title="오늘의 멜로디/스케일 유튜브 연습"
                            >
                              <Video size={14} />
                              유튜브 보기
                            </button>
                            <span className="text-[10px] text-stone-500">
                              {scaleFocusDay
                                ? '스케일 집중'
                                : `${melodyChords.join(' · ')} 코드`}
                            </span>
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>

              {[0, 1].map((stepId) => (
                <input
                  key={stepId}
                  ref={(el) => {
                    stepFileRefs.current[stepId] = el
                  }}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => handleStepImageUpload(stepId, event)}
                />
              ))}
            </section>
          </main>
        </div>
      </div>

      {/* 팝업 차단 안내 */}
      {popupNotice && (
        <div className="animate-celebrate fixed inset-x-0 bottom-6 z-50 mx-auto flex w-[calc(100%-2rem)] max-w-md items-start gap-3 rounded-2xl border border-red-500/40 bg-stone-900 px-4 py-3 shadow-xl shadow-black/40">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500/20 text-red-400">
            !
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-red-300">{popupNotice.title}</p>
            <p className="mt-0.5 text-xs text-stone-400">{popupNotice.body}</p>
          </div>
          <button
            type="button"
            onClick={() => setPopupNotice(null)}
            className="text-stone-500 hover:text-stone-300"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
      )}

      {/* 60분 완료 시 출석 제안 */}
      {showCompleteSuggest && !isTodayDone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6">
          <div className="animate-celebrate w-full max-w-sm rounded-3xl border border-emerald-500/30 bg-stone-900 px-8 py-10 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-3xl">
              🎸
            </div>
            <p className="text-xl font-bold text-emerald-300">60분 연습 완료!</p>
            <p className="mt-2 text-sm text-stone-400">
              오늘 연습을 출석 달력에 기록할까요?
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                onClick={markTodayComplete}
                className="rounded-2xl bg-emerald-500 py-3 text-base font-bold text-stone-950 hover:bg-emerald-400"
              >
                완료 처리
              </button>
              <button
                type="button"
                onClick={() => setShowCompleteSuggest(false)}
                className="rounded-2xl border border-stone-600 py-3 text-sm text-stone-300 hover:bg-stone-800"
              >
                나중에
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 단계 종료 토스트 */}
      {alarmToast && (
        <div className="animate-celebrate fixed right-6 top-6 z-50 flex w-full max-w-sm items-start gap-3 rounded-2xl border border-amber-500/40 bg-stone-900 px-4 py-3 shadow-xl shadow-black/40">
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
            className="text-stone-500 hover:text-stone-300"
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
          <div className="animate-celebrate max-w-[360px] rounded-3xl border border-amber-500/30 bg-stone-900 px-10 py-12 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/20 text-3xl">
              🎸
            </div>
            <p className="text-2xl font-bold text-amber-300">
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
