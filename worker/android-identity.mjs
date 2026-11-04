import {Buffer} from 'node:buffer';
// Keep the existing development signer trusted for previously installed APKs.
// The Release signer is the owner-generated certificate (public fingerprint only).
export const ANDROID_SIGNING_SHA256='bad616fcc0d492003abed757c85d327147782ed4b9884f7541ae9f01c865d494';
export const ANDROID_RELEASE_SIGNING_SHA256='6934266cba128c7ea18b39619cc4cb9a2beb0f7f4dc5cb41e93d58c575d096e5';
export const ANDROID_TRUSTED_SIGNING_SHA256=[ANDROID_SIGNING_SHA256,ANDROID_RELEASE_SIGNING_SHA256];
export const ANDROID_APP_ORIGIN='android:apk-key-hash:'+Buffer.from(ANDROID_SIGNING_SHA256,'hex').toString('base64url');
export const ANDROID_TRUSTED_APP_ORIGINS=ANDROID_TRUSTED_SIGNING_SHA256.map(cert=>'android:apk-key-hash:'+Buffer.from(cert,'hex').toString('base64url'));
export const androidAssetLinks=[{relation:['delegate_permission/common.handle_all_urls','delegate_permission/common.get_login_creds'],target:{namespace:'android_app',package_name:'com.feoearth.easybook.notes',sha256_cert_fingerprints:ANDROID_TRUSTED_SIGNING_SHA256.map(cert=>cert.match(/../g).join(':').toUpperCase())}},{relation:['delegate_permission/common.get_login_creds'],target:{namespace:'web',site:'https://easybook.loonxy.com'}}];

