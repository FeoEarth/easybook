// The minimum supported APK is an operator-controlled compatibility floor.
// Default to no required upgrade until a compatible signed Release exists.
const code = value => {
  const raw=String(value??'');
  if(!/^(0|[1-9][0-9]{0,9})$/.test(raw))return 0;
  const number=Number(raw);
  return number<=2147483647?number:0;
};

export function androidVersionPolicy(env){
  const minSupportedVersionCode=code(env.EASYBOOK_ANDROID_MIN_SUPPORTED_CODE);
  const configured=typeof env.EASYBOOK_ANDROID_MIN_VERSION_REASON==='string'
    ?env.EASYBOOK_ANDROID_MIN_VERSION_REASON.trim():'';
  const reason=configured.slice(0,200)||'当前 Android 版本已不再兼容必要服务，请安装最新正式发行版。';
  return {schema:1,minSupportedVersionCode,reason};
}
