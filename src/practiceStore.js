const DB_NAME = 'eguitar-practice'
const DB_VERSION = 2
const STORE_IMAGES = 'step-images'
const STORE_APP_STATE = 'app-state'

/** app-state 저장소 키 */
const APP_KEYS = {
  completedDates: 'completed-dates',
  timerState: 'timer-state',
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

/** IndexedDB에 단계별 이미지 저장 */
export async function saveStepImage(stepId, dataUrl) {
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readwrite')
    const store = tx.objectStore(STORE_IMAGES)
    const request = store.put(dataUrl, String(stepId))
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
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
