import {Buffer} from 'node:buffer';
// Public signing certificate verified in successful APK run 40303058214.
// This is the existing development signer, not a secret or a newly generated key.
export const ANDROID_SIGNING_SHA256='bad616fcc0d492003abed757c85d327147782ed4b9884f7541ae9f01c865d494';
export const ANDROID_APP_ORIGIN='android:apk-key-hash:'+Buffer.from(ANDROID_SIGNING_SHA256,'hex').toString('base64url');
export const androidAssetLinks=[{relation:['delegate_permission/common.get_login_creds'],target:{namespace:'android_app',package_name:'com.feoearth.easybook.notes',sha256_cert_fingerprints:[ANDROID_SIGNING_SHA256.match(/../g).join(':').toUpperCase()]}}];
