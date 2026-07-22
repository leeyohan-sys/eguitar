import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { getDownloadURL, ref, uploadString } from 'firebase/storage'
import { db, storage, isFirebaseConfigured } from './firebase.js'

function userStateRef(uid) {
  return doc(db, 'users', uid, 'data', 'state')
}

function imageStorageRef(uid, stepId) {
  return ref(storage, `users/${uid}/step-images/${stepId}.jpg`)
}

/** Firestore에서 사용자 상태 불러오기 */
export async function loadCloudState(uid) {
  if (!isFirebaseConfigured() || !db || !uid) return null
  const snap = await getDoc(userStateRef(uid))
  if (!snap.exists()) return null
  return snap.data()
}

/** Firestore에 사용자 상태 저장 */
export async function saveCloudState(uid, payload) {
  if (!isFirebaseConfigured() || !db || !uid) return
  await setDoc(
    userStateRef(uid),
    {
      completedDates: payload.completedDates ?? [],
      timerState: payload.timerState ?? null,
      stepDurations: payload.stepDurations ?? null,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

/** 클라우드에 연습 이미지 업로드 후 URL 반환 */
export async function uploadCloudStepImage(uid, stepId, dataUrl) {
  if (!isFirebaseConfigured() || !storage || !uid || !dataUrl) return ''
  const imageRef = imageStorageRef(uid, stepId)
  await uploadString(imageRef, dataUrl, 'data_url')
  return getDownloadURL(imageRef)
}

/** 클라우드 연습 이미지 URL 불러오기 */
export async function loadCloudStepImageUrl(uid, stepId) {
  if (!isFirebaseConfigured() || !storage || !uid) return ''
  try {
    return await getDownloadURL(imageStorageRef(uid, stepId))
  } catch {
    return ''
  }
}

/** 스트록·스케일 이미지 URL 전체 로드 */
export async function loadCloudStepImages(uid) {
  const [stroke, scale] = await Promise.all([
    loadCloudStepImageUrl(uid, 0),
    loadCloudStepImageUrl(uid, 1),
  ])
  return { 0: stroke, 1: scale }
}
