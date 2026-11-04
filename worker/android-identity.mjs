import {Buffer} from 'node:buffer';
// Official owner-held Release certificate. Fingerprint is public; the private key is not stored in this repository.
export const ANDROID_SIGNING_SHA256='6934266cba128c7ea18b39619cc4cb9a2beb0f7f4dc5cb41e93d58c575d096e5';
export const ANDROID_RELEASE_SIGNING_SHA256=ANDROID_SIGNING_SHA256;
export const ANDROID_TRUSTED_SIGNING_SHA256=[ANDROID_SIGNING_SHA256];
export const ANDROID_APP_ORIGIN='android:apk-key-hash:'+Buffer.from(ANDROID_SIGNING_SHA256,'hex').toString('base64url');
export const ANDROID_TRUSTED_APP_ORIGINS=[ANDROID_APP_ORIGIN];
export const androidAssetLinks=[{relation:['delegate_permission/common.handle_all_urls','delegate_permission/common.get_login_creds'],target:{namespace:'android_app',package_name:'com.feoearth.easybook.notes',sha256_cert_fingerprints:ANDROID_TRUSTED_SIGNING_SHA256.map(cert=>cert.match(/../g).join(':').toUpperCase())}},{relation:['delegate_permission/common.get_login_creds'],target:{namespace:'web',site:'https://easybook.loonxy.com'}}];
