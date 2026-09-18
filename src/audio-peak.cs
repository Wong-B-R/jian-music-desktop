using System;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;

class AudioPeak {
  [DllImport("ole32.dll")] static extern int CoInitializeEx(IntPtr reserved, uint coInit);

  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumerator { }

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }

  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int Item(int index, out IMMDevice device);
  }

  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activation, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  }

  [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    [PreserveSig] int GetAudioSessionControl(IntPtr guid, int flags, [MarshalAs(UnmanagedType.IUnknown)] out object ctrl);
    [PreserveSig] int GetSimpleAudioVolume(IntPtr guid, int flags, [MarshalAs(UnmanagedType.IUnknown)] out object vol);
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator enumerator);
  }

  [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetSession(int index, [MarshalAs(UnmanagedType.IUnknown)] out object session);
  }

  [Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    [PreserveSig] int GetState(out int state);
    [PreserveSig] int GetDisplayName(out IntPtr name);
    [PreserveSig] int SetDisplayName(IntPtr name, IntPtr ctx);
    [PreserveSig] int GetIconPath(out IntPtr path);
    [PreserveSig] int SetIconPath(IntPtr path, IntPtr ctx);
    [PreserveSig] int GetGroupingParam(out Guid grouping);
    [PreserveSig] int SetGroupingParam(ref Guid grouping, IntPtr ctx);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr client);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr client);
    [PreserveSig] int GetSessionIdentifier(out IntPtr id);
    [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr id);
    [PreserveSig] int GetProcessId(out int pid);
    [PreserveSig] int IsSystemSoundsSession();
    [PreserveSig] int SetDuckingPreference(bool optOut);
  }

  [Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioMeterInformation {
    [PreserveSig] int GetPeakValue(out float peak);
  }

  static float PeakFor(string processName) {
    float best = 0;
    var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDeviceCollection devices;
    if (enumerator.EnumAudioEndpoints(0, 1, out devices) != 0 || devices == null) return 0;
    int count;
    devices.GetCount(out count);
    var managerId = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
    for (int i = 0; i < count; i++) {
      IMMDevice device;
      if (devices.Item(i, out device) != 0 || device == null) continue;
      object activated;
      if (device.Activate(ref managerId, 1, IntPtr.Zero, out activated) != 0 || activated == null) continue;
      var manager = (IAudioSessionManager2)activated;
      IAudioSessionEnumerator sessions;
      if (manager.GetSessionEnumerator(out sessions) != 0 || sessions == null) continue;
      int sessionCount;
      sessions.GetCount(out sessionCount);
      for (int s = 0; s < sessionCount; s++) {
        object sessionObj;
        if (sessions.GetSession(s, out sessionObj) != 0 || sessionObj == null) continue;
        var control = sessionObj as IAudioSessionControl2;
        if (control == null) continue;
        int pid;
        if (control.GetProcessId(out pid) != 0 || pid == 0) continue;
        string name = "";
        try { name = Process.GetProcessById(pid).ProcessName; } catch { continue; }
        float peak = 0;
        var meter = sessionObj as IAudioMeterInformation;
        if (meter != null) meter.GetPeakValue(out peak);
        if (Environment.GetEnvironmentVariable("PEAK_DEBUG") == "1") {
          Console.Error.WriteLine(name + " " + pid + " " + peak.ToString("0.000", CultureInfo.InvariantCulture));
        }
        if (!name.Equals(processName, StringComparison.OrdinalIgnoreCase)) continue;
        if (peak > best) best = peak;
      }
    }
    return best;
  }

  static void Main(string[] args) {
    CoInitializeEx(IntPtr.Zero, 0);
    string name = args.Length > 0 ? args[0] : "cloudmusic";
    while (true) {
      float peak = 0;
      try { peak = PeakFor(name); } catch { peak = 0; }
      bool playing = peak > 0.008f;
      Console.WriteLine("{\"playing\":" + (playing ? "true" : "false") + ",\"peak\":" + peak.ToString("0.000", CultureInfo.InvariantCulture) + "}");
      Console.Out.Flush();
      Thread.Sleep(300);
    }
  }
}
