import asyncio,sys,time,numpy as np
from pathlib import Path
import argparse
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
parser=argparse.ArgumentParser()
parser.add_argument('--ntsc-cli',default='ntsc-rs-cli')
args=parser.parse_args()
from sinks.vhs import VhsSink
from sinks.base import StreamSink, VideoFormat, AudioFormat
class CheckSink(StreamSink):
 def __init__(self):self.values=[]
 async def start(self,v,a):self.video=v
 def send_video(self,f):assert f.shape==(480,840,3)
 def send_audio(self,a):
  if a[0]:
   assert np.all(a==a[0]);self.values.append(int(a[0]))
 async def stop(self):pass
 @property
 def alive(self):return True
async def main():
 import logging
 logging.basicConfig(level=logging.INFO)
 out=CheckSink()
 sink=VhsSink(out,args.ntsc_cli,str(Path(__file__).resolve().parents[1]/'presets/vhs.json'))
 await sink.start(VideoFormat(1344,768,24),AudioFormat(48000,1))
 frame=np.zeros((768,1344,3),dtype=np.uint8);frame[:,:,0]=100;frame[:,::40,:]=220
 start=time.monotonic()
 try:
  for i in range(24*32):
   await asyncio.sleep(max(0,start+i/24-time.monotonic()))
   sink.send_video(frame);sink.send_audio(np.full(2000,i+1,dtype=np.int16))
  assert len(out.values)>=384,(len(out.values),sink.hold_ticks)
  assert out.values==list(range(1,len(out.values)+1))
  print('PASS',len(out.values),'paired frames; holds',sink.hold_ticks,'ticks; no audio skips or reordering')
 finally:await sink.stop()
asyncio.run(main())
