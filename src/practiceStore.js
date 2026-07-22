import {
  loadCloudState,
  loadCloudStepImages,
  saveCloudState,
  uploadCloudStepImage,
} from './cloudStore.js'

const DB_NAME = 'eguitar-practice'
const DB_VERSION = 2
const STORE_IMAGES = 'step-images'
const STORE_APP_STATE = 'app-state'

/** app-state 저장소 키 */
const APP_KEYS = {
  completedDates: 'completed-dates',
  timerState: 'timer-state',
  stepDurations: 'step-durations',
}

/** localStorage → IndexedDB 이전용 (기존 사용자 데이터 보존) */
const LEGACY_STORAGE_KEYS = {
  images: {
    0: 'eguitar-stroke-practice-image',
    1: 'eguitar-scale-practice-image',
  },
  completedDates: 'eguitar-completed-dates',
  timerState: 'eguitar-timer-state',
}

/** 로그인된 Firebase 사용자 uid (없으면 로컬만 사용) */
let currentUid = null
let timerCloudSaveTimer = null

/** 로그인 사용자 설정 — 이후 저장은 클라우드에도 반영 */
export function setAuthUid(uid) {
  currentUid = uid || null
}

export function getAuthUid() {
  return currentUid
}

/** 타이머 클라우드 저장은 디바운스 (쓰기 과다 방지) */
function scheduleCloudTimerSave(state) {
  if (!currentUid) return
  if (timerCloudSaveTimer) clearTimeout(timerCloudSaveTimer)
  timerCloudSaveTimer = setTimeout(async () => {
    timerCloudSaveTimer = null
    try {
      await saveCloudState(currentUid, {
        completedDates: (await getAppValue(APP_KEYS.completedDates)) || [],
        timerState: state,
        stepDurations: await getAppValue(APP_KEYS.stepDurations),
      })
    } catch {
      // 네트워크 실패 시 무시
    }
  }, 2500)
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES)
      }
      if (!db.objectStoreNames.contains(STORE_APP_STATE)) {
        db.createObjectStore(STORE_APP_STATE)
      }
    }
  })
}

async function getAppValue(key) {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_APP_STATE, 'readonly')
      const store = tx.objectStore(STORE_APP_STATE)
      const request = store.get(key)
      request.onsuccess = () => resolve(request.result ?? null)
      request.onerror = () => reject(request.error)
    })
  } catch {
    return null
  }
}

async function setAppValue(key, value) {
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_APP_STATE, 'readwrite')
    const store = tx.objectStore(STORE_APP_STATE)
    const request = store.put(value, key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

/** 현재 로컬 상태를 클라우드에 동기화 */
async function pushLocalStateToCloud() {
  if (!currentUid) return
  try {
    const [completedDates, timerState, stepDurations] = await Promise.all([
      getAppValue(APP_KEYS.completedDates),
      getAppValue(APP_KEYS.timerState),
      getAppValue(APP_KEYS.stepDurations),
    ])
    await saveCloudState(currentUid, {
      completedDates: Array.isArray(completedDates) ? completedDates : [],
      timerState: timerState ?? null,
      stepDurations: Array.isArray(stepDurations) ? stepDurations : null,
    })
  } catch {
    // 네트워크 실패 시 로컬은 유지
  }
}

/** IndexedDB에서 단계별 이미지 불러오기 */
export async function loadStepImage(stepId) {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_IMAGES, 'readonly')
      const store = tx.objectStore(STORE_IMAGES)
      const request = store.get(String(stepId))
      request.onsuccess = () => resolve(request.result || '')
      request.onerror = () => reject(request.error)
    })
  } catch {
    return ''
  }
}

/** IndexedDB(+로그인 시 Storage)에 단계별 이미지 저장 */
export async function saveStepImage(stepId, dataUrl) {
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readwrite')
    const store = tx.objectStore(STORE_IMAGES)
    const request = store.put(dataUrl, String(stepId))
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })

  if (currentUid) {
    try {
      await uploadCloudStepImage(currentUid, stepId, dataUrl)
    } catch {
      // 클라우드 업로드 실패해도 로컬 저장은 유지
    }
  }
}

/** 출석 완료 날짜 목록 불러오기 */
export async function loadCompletedDates() {
  await migrateLegacyAppState()
  const value = await getAppValue(APP_KEYS.completedDates)
  return Array.isArray(value) ? value : []
}

/** 출석 완료 날짜 목록 저장 */
export async function saveCompletedDates(dates) {
  try {
    await setAppValue(APP_KEYS.completedDates, dates)
    if (currentUid) {
      await saveCloudState(currentUid, {
        completedDates: dates,
        timerState: await getAppValue(APP_KEYS.timerState),
        stepDurations: await getAppValue(APP_KEYS.stepDurations),
      })
    }
  } catch {
    // 저장 실패 시 무시
  }
}

/** 타이머 상태 불러오기 */
export async function loadTimerState() {
  await migrateLegacyAppState()
  return getAppValue(APP_KEYS.timerState)
}

/** 타이머 상태 저장 */
export async function saveTimerState(state) {
  try {
    await setAppValue(APP_KEYS.timerState, state)
    scheduleCloudTimerSave(state)
  } catch {
    // 저장 실패 시 무시
  }
}

/** 단계별 연습 시간(분) 불러오기 */
export async function loadStepDurations() {
  const value = await getAppValue(APP_KEYS.stepDurations)
  return Array.isArray(value) ? value : null
}

/** 단계별 연습 시간(분) 저장 */
export async function saveStepDurations(durationsMin) {
  try {
    await setAppValue(APP_KEYS.stepDurations, durationsMin)
    if (currentUid) {
      await saveCloudState(currentUid, {
        completedDates: (await getAppValue(APP_KEYS.completedDates)) || [],
        timerState: await getAppValue(APP_KEYS.timerState),
        stepDurations: durationsMin,
      })
    }
  } catch {
    // 저장 실패 시 무시
  }
}

/** localStorage에 남아 있는 예전 이미지를 IndexedDB로 이전 */
async function migrateLegacyImages() {
  for (const [stepId, legacyKey] of Object.entries(LEGACY_STORAGE_KEYS.images)) {
    const id = Number(stepId)
    const existing = await loadStepImage(id)
    if (existing) continue

    try {
      const legacy = localStorage.getItem(legacyKey)
      if (!legacy) continue
      await saveStepImage(id, legacy)
      localStorage.removeItem(legacyKey)
    } catch {
      // 이전 실패 시 기존 localStorage 데이터는 유지
    }
  }
}

/** localStorage에 남아 있는 출석·타이머 데이터를 IndexedDB로 이전 */
async function migrateLegacyAppState() {
  try {
    const existingDates = await getAppValue(APP_KEYS.completedDates)
    if (existingDates == null) {
      const legacyDates = localStorage.getItem(LEGACY_STORAGE_KEYS.completedDates)
      if (legacyDates) {
        const parsed = JSON.parse(legacyDates)
        if (Array.isArray(parsed)) {
          await setAppValue(APP_KEYS.completedDates, parsed)
        }
        localStorage.removeItem(LEGACY_STORAGE_KEYS.completedDates)
      }
    }

    const existingTimer = await getAppValue(APP_KEYS.timerState)
    if (existingTimer == null) {
      const legacyTimer = localStorage.getItem(LEGACY_STORAGE_KEYS.timerState)
      if (legacyTimer) {
        const parsed = JSON.parse(legacyTimer)
        if (parsed && typeof parsed === 'object') {
          await setAppValue(APP_KEYS.timerState, parsed)
        }
        localStorage.removeItem(LEGACY_STORAGE_KEYS.timerState)
      }
    }
  } catch {
    // 이전 실패 시 기존 localStorage 데이터는 유지
  }
}

/** 스트록·스케일 연습 이미지 전체 로드 */
export async function loadAllStepImages() {
  await migrateLegacyImages()
  const [stroke, scale] = await Promise.all([loadStepImage(0), loadStepImage(1)])
  return { 0: stroke, 1: scale }
}

/**
 * 로그인 직후: 로컬 ↔ 클라우드 병합
 * - 출석: 양쪽 합집합
 * - 타이머/시간: 클라우드 우선, 없으면 로컬
 * - 이미지: 클라우드 있으면 사용, 없으면 로컬을 업로드
 */
export async function syncAfterLogin(uid) {
  setAuthUid(uid)

  const [localDates, localTimer, localDurations, localImages, cloudState, cloudImages] =
    await Promise.all([
      loadCompletedDates(),
      loadTimerState(),
      loadStepDurations(),
      loadAllStepImages(),
      loadCloudState(uid),
      loadCloudStepImages(uid),
    ])

  const cloudDates = Array.isArray(cloudState?.completedDates)
    ? cloudState.completedDates
    : []
  const mergedDates = Array.from(new Set([...localDates, ...cloudDates])).sort()

  const nextTimer =
    cloudState?.timerState != null ? cloudState.timerState : localTimer
  const nextDurations = Array.isArray(cloudState?.stepDurations)
    ? cloudState.stepDurations
    : localDurations

  await setAppValue(APP_KEYS.completedDates, mergedDates)
  if (nextTimer != null) await setAppValue(APP_KEYS.timerState, nextTimer)
  if (nextDurations != null) await setAppValue(APP_KEYS.stepDurations, nextDurations)

  const nextImages = { 0: '', 1: '' }
  for (const stepId of [0, 1]) {
    const cloudUrl = cloudImages[stepId]
    const localUrl = localImages[stepId]
    if (cloudUrl) {
      nextImages[stepId] = cloudUrl
      // 로컬 캐시에도 URL 보관 (오프라인 대비는 dataUrl이 더 낫지만 URL도 표시 가능)
      await setAppValueForImage(stepId, cloudUrl)
    } else if (localUrl) {
      nextImages[stepId] = localUrl
      try {
        await uploadCloudStepImage(uid, stepId, localUrl)
      } catch {
        // 업로드 실패 시 로컬 유지
      }
    }
  }

  await saveCloudState(uid, {
    completedDates: mergedDates,
    timerState: nextTimer ?? null,
    stepDurations: nextDurations ?? null,
  })

  return {
    completedDates: mergedDates,
    timerState: nextTimer,
    stepDurations: nextDurations,
    stepImages: nextImages,
  }
}

async function setAppValueForImage(stepId, value) {
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readwrite')
    const store = tx.objectStore(STORE_IMAGES)
    const request = store.put(value, String(stepId))
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

/** 로그아웃 시 클라우드 저장 중단 (로컬 데이터는 유지) */
export function clearAuthSync() {
  currentUid = null
}

export { pushLocalStateToCloud }
