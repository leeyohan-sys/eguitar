import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import { auth, googleProvider, isFirebaseConfigured } from './firebase.js'

/** 로그인 상태 구독 */
export function subscribeAuth(callback) {
  if (!isFirebaseConfigured() || !auth) {
    callback(null)
    return () => {}
  }
  return onAuthStateChanged(auth, callback)
}

/** Google 계정으로 로그인 */
export async function signInWithGoogle() {
  if (!isFirebaseConfigured() || !auth) {
    throw new Error('Firebase is not configured.')
  }
  const result = await signInWithPopup(auth, googleProvider)
  return result.user
}

/** 로그아웃 */
export async function signOutUser() {
  if (!auth) return
  await firebaseSignOut(auth)
}
