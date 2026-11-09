"""Convert the Playwright recording to H.264 MP4 (plays in QuickTime, Slack, PowerPoint)."""
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg

out = Path(__file__).parent / "out"
trim = sys.argv[1] if len(sys.argv) > 1 else "0.4"
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
subprocess.run(
    [ffmpeg, "-y", "-loglevel", "error", "-ss", trim, "-i", str(out / "walkthrough.webm"),
     "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "slow", "-movflags", "+faststart",
     str(out / "shift-scheduler-demo.mp4")],
    check=True,
)
for t in (3, 12, 22, 33, 45, 60, 75, 85):
    subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-ss", str(t), "-i", str(out / "shift-scheduler-demo.mp4"),
                    "-frames:v", "1", "-vf", "scale=720:-1", str(out / f"frame_{t:02d}.jpg")], check=True)
print(out / "shift-scheduler-demo.mp4")
