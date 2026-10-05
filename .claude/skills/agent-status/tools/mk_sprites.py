# 產生 agent-status 面板用的跑步序列幀：python3 tools/mk_sprites.py → 直接覆寫 hooks/sprites.ts
# 需要 Pillow（pip install pillow）；素材來源是 repo 根目錄 brain_map_img/run_*_f*.png
import sys, base64, io, json
from collections import deque
from PIL import Image
import os
SRC=os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../../brain_map_img/')
CH={'luffy':6,'robin':6,'franky':12,'zoro':12,'chopper':12,'nami':12,'usopp':12}
H=80; COLORS=64

def widest_cols(im):
    """依「整欄透明」切段，只留最寬那段（去掉左右邊緣的隔壁格殘影）"""
    w,h=im.size; im=im.copy(); p=im.load()
    E=max(3,w//40)   # 來源格子左右邊緣幾欄常帶格線/隔壁格碎片，直接清掉
    for x in list(range(E))+list(range(w-E,w)):
        for y in range(h): p[x,y]=(0,0,0,0)
    a=im.getchannel('A'); px=a.load()
    occ=[any(px[x,y]>40 for y in range(h)) for x in range(w)]
    segs=[];st=None
    for x,o in enumerate(occ+[False]):
        if o and st is None: st=x
        if not o and st is not None: segs.append((st,x)); st=None
    x0,x1=max(segs,key=lambda t:t[1]-t[0])
    out=Image.new('RGBA',im.size); out.paste(im.crop((x0,0,x1,h)),(x0,0))
    return out

def main_body(im):
    """只保留面積最大的不透明連通區塊（含其外框內的小碎塊），去掉隔壁格殘影"""
    w,h=im.size; a=im.getchannel('A').load()
    seen=[[False]*w for _ in range(h)]; best=None
    for y in range(h):
        for x in range(w):
            if a[x,y]>40 and not seen[y][x]:
                q=deque([(x,y)]); seen[y][x]=True; n=0; x0=x1=x; y0=y1=y
                while q:
                    cx,cy=q.popleft(); n+=1
                    x0=min(x0,cx);x1=max(x1,cx);y0=min(y0,cy);y1=max(y1,cy)
                    for dx,dy in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,-1),(1,-1),(-1,1)):
                        nx,ny=cx+dx,cy+dy
                        if 0<=nx<w and 0<=ny<h and not seen[ny][nx] and a[nx,ny]>40:
                            seen[ny][nx]=True; q.append((nx,ny))
                if best is None or n>best[0]: best=(n,(x0,y0,x1+1,y1+1),(x,y))
    # 第二輪：從主體起點擴張（容許小間隙：半徑2內的不透明點視為相連），其餘清成透明
    sx,sy=best[2]; keep=[[False]*w for _ in range(h)]; keep[sy][sx]=True; q=deque([(sx,sy)])
    while q:
        cx,cy=q.popleft()
        for dx in range(-2,3):
            for dy in range(-2,3):
                nx,ny=cx+dx,cy+dy
                if 0<=nx<w and 0<=ny<h and not keep[ny][nx] and a[nx,ny]>40:
                    keep[ny][nx]=True; q.append((nx,ny))
    out=im.copy(); p=out.load()
    for y in range(h):
        for x in range(w):
            if not keep[y][x]: p[x,y]=(0,0,0,0)
    return out.crop(out.getbbox())

out={}
for name,n in CH.items():
    idx=list(range(n)) if n==6 else (list(range(1,n,2)) if name=='zoro' else list(range(0,n,2)))
    frames=[Image.open(f'{SRC}run_{name}_f{i+1}.png').convert('RGBA') for i in idx]
    frames=[main_body(widest_cols(f)) if n==12 else f.crop(f.getbbox()) for f in frames]
    fw=max(f.width for f in frames); fh=max(f.height for f in frames)
    s=H/fh; w=max(1,round(fw*s))
    sheet=Image.new('RGBA',(w*len(frames),H))
    for i,f in enumerate(frames):
        g=f.resize((max(1,round(f.width*s)),max(1,round(f.height*s))),Image.LANCZOS)
        sheet.paste(g,(i*w+(w-g.width)//2,H-g.height))   # 底部置中對齊
    q=sheet.quantize(colors=COLORS,method=Image.FASTOCTREE,dither=Image.NONE)
    buf=io.BytesIO(); q.save(buf,'PNG',optimize=True); b=buf.getvalue()
    out[name]={'w':w,'h':H,'n':len(frames),'b64':base64.b64encode(b).decode()}
    print(name,(w,H),len(frames),'b64',len(out[name]['b64']))
HERE=os.path.dirname(os.path.abspath(__file__))
lines=['// 由 brain_map_img/run_*_f*.png 壓縮產生的跑步序列幀（高 80px、6 幀橫排、64 色 PNG）',
'// 重新產生：python3 tools/mk_sprites.py，不要手改 base64',
'export type Sprite = { w: number; h: number; n: number; b64: string }',
'export const SPRITES: Record<string, Sprite> = {']
for k,v in out.items():
    lines.append(f"  {k}: {{ w: {v['w']}, h: {v['h']}, n: {v['n']}, b64: '{v['b64']}' }},")
lines.append('}')
open(os.path.join(HERE,'..','hooks','sprites.ts'),'w').write('\n'.join(lines)+'\n')
print('已寫入 hooks/sprites.ts')
