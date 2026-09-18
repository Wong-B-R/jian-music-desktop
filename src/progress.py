import ctypes
import json
import queue
import subprocess
import sys
import threading
import time
from ctypes import wintypes
from pathlib import Path

import cv2
import numpy as np
from windows_capture import WindowsCapture

ROOT = Path(__file__).resolve().parent
OCR = ROOT / "ocr.ps1"
FRAME = Path(r"C:\Users\ASUS\AppData\Local\Temp\jian-netease-frame.png")
INFO = Path(r"C:\Users\ASUS\AppData\Local\Temp\jian-netease-info.png")
INFO_TXT = Path(r"C:\Users\ASUS\AppData\Local\Temp\jian-netease-info.txt")

user32 = ctypes.windll.user32
try:
    user32.SetProcessDPIAware()
except Exception:
    pass

EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)


class RECT(ctypes.Structure):
    _fields_ = [("l", ctypes.c_long), ("t", ctypes.c_long), ("r", ctypes.c_long), ("b", ctypes.c_long)]


def find_host():
    found = {"area": 0, "title": "", "x": 0, "y": 0, "w": 0, "h": 0}

    def cb(hwnd, _lparam):
        cls = ctypes.create_unicode_buffer(128)
        user32.GetClassNameW(hwnd, cls, 128)
        if cls.value != "OrpheusBrowserHost":
            return True
        rect = RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        width = max(0, rect.r - rect.l)
        height = max(0, rect.b - rect.t)
        area = width * height
        if area > found["area"]:
            title = ctypes.create_unicode_buffer(512)
            user32.GetWindowTextW(hwnd, title, 512)
            found.update(
                {
                    "area": area,
                    "title": title.value,
                    "hwnd": hwnd,
                    "x": rect.l,
                    "y": rect.t,
                    "w": width,
                    "h": height,
                }
            )
        return True

    user32.EnumWindows(EnumWindowsProc(cb), 0)
    return found


def progress_geometry(image):
    height, width = image.shape[:2]
    top = int(height * 0.78)
    band = image[top:]
    lum = band.astype(np.int16).sum(axis=2)
    best = None
    for y in range(6, lum.shape[0] - 2):
        diff = lum[y] - lum[y - 5]
        xs = np.flatnonzero(diff > 30)
        if xs.size < 40:
            continue
        cuts = np.flatnonzero(np.diff(xs) > 4)
        starts = np.r_[0, cuts + 1]
        ends = np.r_[cuts, xs.size - 1]
        for start, end in zip(starts, ends):
            length = int(xs[end] - xs[start])
            if best is None or length > best[0]:
                best = (length, int(xs[start]), int(xs[end]), top + y)
    if not best:
        return None
    _length, left, head, y = best
    right = width - max(8, left)
    span = right - left
    if span < width * 0.4:
        return None
    ratio = max(0.0, min(0.995, (head - left) / span))
    return {"ratio": ratio, "left": left, "right": right, "y": y}


def read_album():
    image = cv2.imread(str(FRAME))
    if image is None:
        return ""
    height, width = image.shape[:2]
    crop = image[int(height * 0.08) : int(height * 0.42), int(width * 0.46) : width - 20]
    cv2.imwrite(str(INFO), crop)
    subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(OCR),
            str(INFO),
            str(INFO_TXT),
        ],
        check=False,
        timeout=12,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if not INFO_TXT.exists():
        return ""
    text = INFO_TXT.read_text(encoding="utf-8", errors="ignore")
    return "".join(text.split())


commands = queue.Queue()
pointer = {"bar": None, "play": None}


def stdin_loop():
    for line in sys.stdin:
        text = line.strip()
        if text:
            commands.put(text)


def widget_hwnd():
    found = {"hwnd": 0}

    def cb(hwnd, _lparam):
        title = ctypes.create_unicode_buffer(32)
        user32.GetWindowTextW(hwnd, title, 32)
        if title.value == "笺":
            found["hwnd"] = hwnd
            return False
        return True

    user32.EnumWindows(EnumWindowsProc(cb), 0)
    return found["hwnd"]


def strip_caption(hwnd):
    if not hwnd:
        return
    get_long = user32.GetWindowLongPtrW
    set_long = user32.SetWindowLongPtrW
    get_long.restype = ctypes.c_ssize_t
    get_long.argtypes = [wintypes.HWND, ctypes.c_int]
    set_long.restype = ctypes.c_ssize_t
    set_long.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_ssize_t]
    style = get_long(hwnd, -16) & ~0x00CC0000
    set_long(hwnd, -16, style)
    user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020)


def click(x, y):
    class POINT(ctypes.Structure):
        _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

    point = POINT()
    user32.GetCursorPos(ctypes.byref(point))
    user32.SetCursorPos(int(x), int(y))
    time.sleep(0.04)
    user32.mouse_event(2, 0, 0, 0, 0)
    time.sleep(0.02)
    user32.mouse_event(4, 0, 0, 0, 0)
    time.sleep(0.02)
    user32.SetCursorPos(point.x, point.y)


def send_hotkey(keys):
    for vk in keys:
        user32.keybd_event(vk, 0, 0, 0)
    time.sleep(0.04)
    for vk in reversed(keys):
        user32.keybd_event(vk, 0, 2, 0)


def handle_one(line):
    if line == "toggle":
        send_hotkey((0x11, 0x12, 0x50))
    elif line == "prev":
        send_hotkey((0x11, 0x12, 0x25))
    elif line == "next":
        send_hotkey((0x11, 0x12, 0x27))
    elif line.startswith("seek ") and pointer["bar"]:
        try:
            ratio = min(0.995, max(0.0, float(line.split()[1])))
        except ValueError:
            return
        bar = pointer["bar"]
        x = bar["x"] + ratio * (bar["right"] - bar["x"])
        click(x, bar["y"])


def command_loop():
    while True:
        line = commands.get()
        try:
            handle_one(line)
        except Exception:
            continue


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def watch(title):
    album = {"text": "", "at": 0}
    capture = WindowsCapture(window_name=title, cursor_capture=False, draw_border=False)

    @capture.event
    def on_frame_arrived(frame, capture_control):
        now = time.time()
        if now - album.get("frame", 0) < 0.7:
            return
        album["frame"] = now
        frame.save_as_image(str(FRAME))
        image = cv2.imread(str(FRAME))
        geo = progress_geometry(image) if image is not None else None
        if now - album["at"] > 8 or not album["text"]:
            try:
                album["text"] = read_album()
            except Exception:
                album["text"] = album["text"]
            album["at"] = now
        host = find_host()
        if host["title"] and host["title"] != title:
            capture_control.stop()
            return
        if host["w"]:
            pointer["hwnd"] = host.get("hwnd") or 0
            if geo and image is not None:
                ih, iw = image.shape[:2]
                sx = host["w"] / iw if iw else 1
                sy = host["h"] / ih if ih else 1
                pointer["bar"] = {
                    "x": host["x"] + geo["left"] * sx,
                    "right": host["x"] + geo["right"] * sx,
                    "y": host["y"] + geo["y"] * sy,
                }
            elif not pointer["bar"]:
                pointer["bar"] = {
                    "x": host["x"] + 36,
                    "right": host["x"] + host["w"] - 36,
                    "y": host["y"] + host["h"] - 123,
                }
            pointer["play"] = {
                "x": host["x"] + host["w"] // 2,
                "y": host["y"] + host["h"] - 78,
            }
            dpi = 144
            try:
                value = user32.GetDpiForWindow(pointer["hwnd"])
                if value:
                    dpi = value
            except Exception:
                dpi = 144
            pointer["gap"] = int(round(52 * dpi / 96))
        emit(
            {
                "ok": geo is not None,
                "ratio": None if geo is None else geo["ratio"],
                "album": album["text"],
                "title": title,
            }
        )

    @capture.event
    def on_closed():
        pass

    capture.start()


def main():
    threading.Thread(target=stdin_loop, daemon=True).start()
    threading.Thread(target=command_loop, daemon=True).start()
    current = ""
    while True:
        host = find_host()
        if host["area"] < 700 * 420 or not host["title"]:
            emit({"ok": False})
            time.sleep(1)
            continue
        if host["title"] != current:
            current = host["title"]
        try:
            watch(current)
        except Exception as error:
            emit({"ok": False, "error": str(error)})
            time.sleep(1)
        current = ""


if __name__ == "__main__":
    main()
