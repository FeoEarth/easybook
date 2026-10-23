import subprocess,time,xml.etree.ElementTree as ET,re,pathlib
P='com.feoearth.easybook'
def adb(*args): return subprocess.check_output(['adb',*args],text=True)
def dump():
 adb('shell','uiautomator','dump','/sdcard/window.xml')
 text=adb('shell','cat','/sdcard/window.xml')
 pathlib.Path('smoke').mkdir(exist_ok=True);pathlib.Path('smoke/window.xml').write_text(text)
 return text
def tap(label):
 for attempt in range(5):
  root=ET.fromstring(dump())
  candidates=[n for n in root.iter('node') if n.get('text')==label or n.get('content-desc')==label]
  if candidates:
   bounds=re.findall(r'\d+',candidates[0].get('bounds',''))
   if len(bounds)==4:
    x,y,a,b=map(int,bounds);adb('shell','input','tap',str((x+a)//2),str((y+b)//2));return
  time.sleep(1)
 raise AssertionError('Missing control: '+label)
def screenshot(name):
 pathlib.Path('smoke').mkdir(exist_ok=True)
 with open('smoke/'+name,'wb') as f: subprocess.run(['adb','exec-out','screencap','-p'],stdout=f,check=True)
try:
 adb('install','-r','app/build/outputs/apk/debug/app-debug.apk')
 print(adb('shell','dumpsys','webviewupdate'));print(adb('shell','am','start','-n',P+'/.MainActivity'));time.sleep(6)
 screenshot('home.png')
 home=dump()
 assert '我的笔记' in home, 'Home did not render: '+home
 tap('新建笔记');time.sleep(1)
 adb('shell','input','text','GlassSmoke')
 tap('笔记正文');adb('shell','input','text','Saved_offline_and_restored')
 time.sleep(1)
 adb('shell','input','keyevent','4');time.sleep(1)
 screenshot('editor.png')
 tap('返回笔记');time.sleep(1)
 assert 'GlassSmoke' in dump(), 'Created note missing from list'
 adb('shell','am','force-stop',P);adb('shell','am','start','-n',P+'/.MainActivity');time.sleep(3)
 assert 'GlassSmoke' in dump(), 'Note was not persisted across process restart'
 tap('我的空间');time.sleep(1)
 screenshot('settings.png')
 assert '导出备份' in dump(), 'Native backup action unavailable'
 adb('shell','logcat','-d','-s','AndroidRuntime:E')
 print('PASS Android: launch, create, edit, back navigation, process restart persistence, settings')
finally:
 print(adb('shell','logcat','-d','-s','AndroidRuntime:E','chromium:E'))
