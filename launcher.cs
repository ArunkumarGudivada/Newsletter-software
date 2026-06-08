// ============================================================
//  Newsletter Builder — native launcher (compiled to .exe)
//  Opens index.html in Edge/Chrome "app mode" (own window,
//  no tabs or address bar). No dependencies, no internet.
// ============================================================
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

class Launcher
{
    [STAThread]
    static void Main()
    {
        // Folder where this .exe lives — index.html sits next to it.
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string html = Path.Combine(baseDir, "index.html");

        if (!File.Exists(html))
        {
            System.Windows.Forms.MessageBox.Show(
                "index.html was not found next to this app.\n\nKeep Newsletter Builder.exe in the same folder as index.html, script.js and styles.css.",
                "Newsletter Builder", System.Windows.Forms.MessageBoxButtons.OK,
                System.Windows.Forms.MessageBoxIcon.Warning);
            return;
        }

        string url = "file:///" + html.Replace("\\", "/");
        string appArg = "--app=" + url + " --window-size=1500,950";

        // Candidate browsers, in priority order.
        string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string[] candidates = {
            Path.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(pf,   @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(pf,   @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(pf86, @"Google\Chrome\Application\chrome.exe"),
        };

        foreach (string exe in candidates)
        {
            if (File.Exists(exe))
            {
                Process.Start(new ProcessStartInfo(exe, appArg) { UseShellExecute = false });
                return;
            }
        }

        // Fallback: open in the default browser.
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }
}
