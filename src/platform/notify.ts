import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Best-effort OS notification for `ctx.notify()`. Never throws — a failed
 * toast must not break a plugin action (specs.md Rule 6).
 */
export async function showNotification(title: string, message: string): Promise<void> {
  try {
    if (process.platform === "darwin") {
      const script = `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}"`;
      await execFileAsync("osascript", ["-e", script]);
      return;
    }
    if (process.platform === "linux") {
      await execFileAsync("notify-send", [title, message]);
      return;
    }
    if (process.platform === "win32") {
      await runWindowsToast(title, message);
    }
  } catch {
    // Notifications are a convenience, not a guarantee — swallow and move on.
  }
}

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function runWindowsToast(title: string, message: string): Promise<void> {
  const escape = (v: string) => v.replace(/"/g, '""');
  const script = `
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] > $null
    $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
    $texts = $template.GetElementsByTagName("text")
    $texts.Item(0).AppendChild($template.CreateTextNode("${escape(title)}")) > $null
    $texts.Item(1).AppendChild($template.CreateTextNode("${escape(message)}")) > $null
    $toast = [Windows.UI.Notifications.ToastNotification]::new($template)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("OpenPanel").Show($toast)
  `;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    encoded,
  ]);
}
