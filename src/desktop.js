const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const SetWindowPos = user32.func(
  'bool __stdcall SetWindowPos(uint64 hWnd, int64 hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags)',
);
const SystemParametersInfoW = user32.func(
  'bool __stdcall SystemParametersInfoW(uint uiAction, uint uiParam, str16 pvParam, uint fWinIni)',
);

const HWND_BOTTOM = 1n;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_FRAMECHANGED = 0x0020;
const GWL_STYLE = -16;
const WS_CAPTION = 0x00c00000;
const WS_THICKFRAME = 0x00040000;
const WS_SYSMENU = 0x00080000;
const SPI_SETDESKWALLPAPER = 0x0014;
const SPIF_UPDATEINIFILE = 0x01;
const SPIF_SENDCHANGE = 0x02;

const GetWindowLongPtrW = user32.func('int64 __stdcall GetWindowLongPtrW(uint64 hWnd, int nIndex)');
const SetWindowLongPtrW = user32.func('int64 __stdcall SetWindowLongPtrW(uint64 hWnd, int nIndex, int64 dwNewLong)');

function hwndOf(win) {
  const buffer = win.getNativeWindowHandle();
  return buffer.length >= 8 ? buffer.readBigUInt64LE(0) : BigInt(buffer.readUInt32LE(0));
}

function hideCaption(win) {
  try {
    const hwnd = hwndOf(win);
    const style = GetWindowLongPtrW(hwnd, GWL_STYLE);
    const next = BigInt(style) & ~BigInt(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU);
    SetWindowLongPtrW(hwnd, GWL_STYLE, next);
    SetWindowPos(
      hwnd,
      0n,
      0,
      0,
      0,
      0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
    );
  } catch {
    /* 去掉标题栏失败时，窗口仍按无边框创建 */
  }
}

function sendToBottom(win) {
  try {
    SetWindowPos(hwndOf(win), HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
  } catch {
    /* 贴底失败时保持普通层级，窗口仍然可用 */
  }
}

function setWallpaper(filePath) {
  return SystemParametersInfoW(
    SPI_SETDESKWALLPAPER,
    0,
    filePath,
    SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
  );
}

module.exports = { sendToBottom, setWallpaper, hideCaption };
