import subprocess,pathlib

def adb(*args): return subprocess.check_output(['adb',*args],text=True)
adb('shell','input','keyevent','KEYCODE_WAKEUP')
adb('shell','wm','dismiss-keyguard')
adb('shell','settings','put','system','screen_off_timeout','1800000')
adb('shell','svc','power','stayon','true')
print(adb('install','-r','app/build/outputs/apk/debug/app-debug.apk'))
print(adb('install','-r','app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'))
result=adb('shell','am','instrument','-w','com.feoearth.easybook.test/com.feoearth.easybook.GlassInstrumentation')
print(result)
pathlib.Path('smoke').mkdir(exist_ok=True)
subprocess.run(['adb','pull','/sdcard/Android/data/com.feoearth.easybook/files/smoke/.','smoke/'],check=False)
print(adb('shell','logcat','-d','-s','AndroidRuntime:E','chromium:E'))
assert 'passed=true' in result, 'Android WebView instrumentation failed'
print('PASS Android: launch, editor, local save, todo toggle, favorite, back, restart persistence, dark appearance, native actions')
