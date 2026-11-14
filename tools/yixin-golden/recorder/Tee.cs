// Z0 엔진 녹취기: GUI 와 실제 엔진(rapfi-real.exe) 사이에 끼어 모든 줄을 시각과 함께 JSONL 로 남긴다.
//   {"t":ms,"dir":"gui>eng"|"eng>gui"|"eng!err"|"exit","line":"..."}
// 기록 위치: 환경변수 Z0_LOG, 없으면 cwd 의 z0-session.jsonl. 인자는 그대로 엔진에 넘긴다.
using System; using System.Diagnostics; using System.IO; using System.Text; using System.Threading; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles;
class Tee {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO { public int cb; public IntPtr r, d, t; public int x, y, xs, ys, xc, yc, fill, flags; public short show, cbReserved2; public IntPtr lpReserved2, hIn, hOut, hErr; }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern void GetStartupInfoW(ref STARTUPINFO si);
  /// msvcrt 의 fd 상속 표: int n, n 바이트 플래그, n 개 HANDLE(정렬 없음). fd0/fd1 의 핸들을 꺼낸다.
  static bool CrtStdHandles(out IntPtr h0, out IntPtr h1) {
    h0 = h1 = IntPtr.Zero;
    var si = new STARTUPINFO(); si.cb = Marshal.SizeOf(typeof(STARTUPINFO)); GetStartupInfoW(ref si);
    if (si.lpReserved2 == IntPtr.Zero || si.cbReserved2 < 4) return false;
    int n = Marshal.ReadInt32(si.lpReserved2);
    if (n < 2 || si.cbReserved2 < 4 + n + n * IntPtr.Size) return false;
    IntPtr hs = si.lpReserved2 + 4 + n;
    h0 = Marshal.ReadIntPtr(hs); h1 = Marshal.ReadIntPtr(hs + IntPtr.Size);
    return h0 != IntPtr.Zero && h0 != new IntPtr(-1) && h1 != IntPtr.Zero && h1 != new IntPtr(-1);
  }
  static readonly object Gate = new object();
  static StreamWriter Log; static Stopwatch Clock = Stopwatch.StartNew();
  static string Esc(string s) {
    var b = new StringBuilder();
    foreach (var c in s) {
      if (c == (char)34) b.Append((char)92).Append((char)34);
      else if (c == (char)92) b.Append((char)92).Append((char)92);
      else if (c < 0x20) b.Append((char)92).Append('u').Append(((int)c).ToString("x4"));
      else b.Append(c);
    }
    return b.ToString();
  }
  static void Rec(string dir, string line) {
    lock (Gate) { Log.WriteLine("{\"t\":" + Clock.ElapsedMilliseconds + ",\"dir\":\"" + dir + "\",\"line\":\"" + Esc(line) + "\"}"); Log.Flush(); }
  }
  static int Main(string[] args) {
    var utf8 = new UTF8Encoding(false);
    var here = AppDomain.CurrentDomain.BaseDirectory;
    Log = new StreamWriter(Environment.GetEnvironmentVariable("Z0_LOG") ?? Path.Combine(Environment.CurrentDirectory, "z0-session.jsonl"), true, utf8);
    var argLine = string.Join(" ", Array.ConvertAll(args, a => a.Contains(" ") ? "\"" + a + "\"" : a));
    var p = new ProcessStartInfo(Path.Combine(here, "rapfi-real.exe"), argLine) {
      UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Environment.CurrentDirectory,
      RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
      StandardOutputEncoding = utf8, StandardErrorEncoding = utf8 };
    var eng = Process.Start(p);
    var engIn = new StreamWriter(eng.StandardInput.BaseStream, utf8) { AutoFlush = true, NewLine = "\n" };
    Stream sin = Console.OpenStandardInput(), sout = Console.OpenStandardOutput();
    IntPtr h0, h1;
    if (CrtStdHandles(out h0, out h1)) {
      // GLib gspawn 은 msvcrt _spawnv 로 띄운다 — 파이프가 STARTUPINFO.lpReserved2(CRT fd 표)로만 온다.
      sin = new FileStream(new SafeFileHandle(h0, false), FileAccess.Read, 1);
      sout = new FileStream(new SafeFileHandle(h1, false), FileAccess.Write, 1);
      Rec("note", "stdio from CRT lpReserved2");
    }
    var guiOut = new StreamWriter(sout, utf8) { AutoFlush = true, NewLine = "\n" };
    var guiIn = new StreamReader(sin, utf8);
    var tin = new Thread(() => { string l; try { while ((l = guiIn.ReadLine()) != null) { Rec("gui>eng", l); engIn.WriteLine(l); } } catch {} try { engIn.Close(); } catch {} }) { IsBackground = true };
    var tout = new Thread(() => { string l; while ((l = eng.StandardOutput.ReadLine()) != null) { Rec("eng>gui", l); try { guiOut.WriteLine(l); } catch {} } });
    var terr = new Thread(() => { string l; while ((l = eng.StandardError.ReadLine()) != null) Rec("eng!err", l); }) { IsBackground = true };
    tin.Start(); tout.Start(); terr.Start();
    eng.WaitForExit(); tout.Join(2000); Rec("exit", eng.ExitCode.ToString());
    return eng.ExitCode;
  }
}
