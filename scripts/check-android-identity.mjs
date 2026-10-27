import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {ANDROID_SIGNING_SHA256,ANDROID_APP_ORIGIN,androidAssetLinks} from '../worker/android-identity.mjs';
const sdk=process.env.ANDROID_HOME;if(!sdk)throw Error('Android SDK unavailable');
const apk=process.argv[2];if(!apk)throw Error('APK path required');
const output=execFileSync(join(sdk,'build-tools','35.0.0','apksigner'),['verify','--print-certs',apk],{encoding:'utf8',maxBuffer:1024*1024});
const certificate=output.match(/Signer #1 certificate SHA-256 digest: ([a-f0-9]{64})/i)?.[1]?.toLowerCase();
assert.equal(certificate,ANDROID_SIGNING_SHA256,'APK signing certificate differs from the reviewed Passkey association');
assert.equal(ANDROID_APP_ORIGIN,'android:apk-key-hash:'+Buffer.from(certificate,'hex').toString('base64url'));
assert.equal(androidAssetLinks[0].target.package_name,'com.feoearth.easybook.notes');
const manifest=execFileSync(join(sdk,'build-tools','35.0.0','aapt2'),['dump','xmltree',apk,'--file','AndroidManifest.xml'],{encoding:'utf8',maxBuffer:1024*1024});
assert.ok(manifest.includes('com.feoearth.easybook.notes'),'APK package must match the Passkey association');
assert.ok(manifest.includes('asset_statements'),'APK must declare its website credential association');
console.log('PASS APK signing certificate matches the native Passkey origin and Digital Asset Links');

