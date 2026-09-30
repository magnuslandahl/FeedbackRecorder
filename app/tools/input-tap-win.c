// Listen-only global input hooks. Never inspect text, focused controls, or
// window titles: printable keys leave this process only as a typing flag.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static HHOOK mouse_hook, keyboard_hook;
static DWORD main_thread;
static LARGE_INTEGER frequency, start_time;
static HANDLE output;
static DWORD parent_pid;
static int ctrl, alt, shift, win;
static DWORD last_click_time;
static POINT last_click_point;
static const char *last_button;
static int click_count;

static double seconds_now(void) {
  LARGE_INTEGER now;
  QueryPerformanceCounter(&now);
  return (double)(now.QuadPart - start_time.QuadPart) / (double)frequency.QuadPart;
}

static void emit(const char *fields) {
  char line[384];
  DWORD written;
  int size = snprintf(line, sizeof(line), "{\"time\":%.3f,%s}\n", seconds_now(), fields);
  if (size < 0 || size >= (int)sizeof(line) ||
      !WriteFile(output, line, (DWORD)size, &written, NULL) || written != (DWORD)size)
    PostQuitMessage(0);
}

static int named_key(DWORD code) {
  switch (code) {
    case VK_RETURN: case VK_TAB: case VK_BACK: case VK_ESCAPE:
    case VK_HOME: case VK_PRIOR: case VK_DELETE: case VK_END:
    case VK_NEXT: case VK_LEFT: case VK_RIGHT: case VK_DOWN: case VK_UP:
    case VK_HELP:
      return 1;
    default:
      return code >= VK_F1 && code <= VK_F12;
  }
}

static int shortcut_key(DWORD code) {
  return (code >= 'A' && code <= 'Z') ||
    (code >= '0' && code <= '9') ||
    code == VK_SPACE;
}

static int modifier_key(DWORD code) {
  return code == VK_CONTROL || code == VK_LCONTROL || code == VK_RCONTROL ||
    code == VK_MENU || code == VK_LMENU || code == VK_RMENU ||
    code == VK_SHIFT || code == VK_LSHIFT || code == VK_RSHIFT ||
    code == VK_LWIN || code == VK_RWIN ||
    code == VK_CAPITAL || code == VK_NUMLOCK || code == VK_SCROLL;
}

static void emit_key(DWORD code, int control, int option, int shifted, int windows) {
  char fields[256], modifiers[96] = "";
  int named = named_key(code);
  // Ctrl+Alt is also AltGr on Windows. Treat *all* printable Ctrl+Alt
  // combinations as typing so alternate keyboard layouts cannot leak text.
  if (!named && !((control && !option) || windows) ) {
    emit("\"type\":\"key\",\"typing\":true");
    return;
  }
  if (!named && (option || !shortcut_key(code))) {
    emit("\"type\":\"key\",\"typing\":true");
    return;
  }
  if (control) strcat_s(modifiers, sizeof(modifiers), "\"ctrl\",");
  if (option) strcat_s(modifiers, sizeof(modifiers), "\"alt\",");
  if (shifted) strcat_s(modifiers, sizeof(modifiers), "\"shift\",");
  if (windows) strcat_s(modifiers, sizeof(modifiers), "\"cmd\",");
  if (*modifiers) modifiers[strlen(modifiers) - 1] = '\0';
  snprintf(fields, sizeof(fields),
    "\"type\":\"key\",\"platform\":\"win32\",\"code\":%lu,\"modifiers\":[%s]",
    (unsigned long)code, modifiers);
  emit(fields);
}

static LRESULT CALLBACK keyboard_callback(int n, WPARAM message, LPARAM data) {
  if (n >= 0) {
    KBDLLHOOKSTRUCT *key = (KBDLLHOOKSTRUCT *)data;
    DWORD code = key->vkCode;
    int down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
    int up = message == WM_KEYUP || message == WM_SYSKEYUP;
    if (!(key->flags & LLKHF_INJECTED) && (down || up)) {
      if (code == VK_CONTROL || code == VK_LCONTROL || code == VK_RCONTROL) ctrl = down;
      else if (code == VK_MENU || code == VK_LMENU || code == VK_RMENU) alt = down;
      else if (code == VK_SHIFT || code == VK_LSHIFT || code == VK_RSHIFT) shift = down;
      else if (code == VK_LWIN || code == VK_RWIN) win = down;
      if (down && !modifier_key(code))
        emit_key(code, ctrl, alt || (key->flags & LLKHF_ALTDOWN) != 0, shift, win);
    }
  }
  return CallNextHookEx(NULL, n, message, data);
}

static LRESULT CALLBACK mouse_callback(int n, WPARAM message, LPARAM data) {
  if (n >= 0) {
    MSLLHOOKSTRUCT *mouse = (MSLLHOOKSTRUCT *)data;
    const char *button = NULL;
    char fields[192];
    if (mouse->flags & LLMHF_INJECTED) return CallNextHookEx(NULL, n, message, data);
    if (message == WM_LBUTTONDOWN) button = "left";
    else if (message == WM_RBUTTONDOWN) button = "right";
    else if (message == WM_MBUTTONDOWN) button = "middle";
    else if (message == WM_MOUSEWHEEL || message == WM_MOUSEHWHEEL)
      emit("\"type\":\"scroll\"");
    if (button) {
      int dx = abs(mouse->pt.x - last_click_point.x);
      int dy = abs(mouse->pt.y - last_click_point.y);
      if (last_button && strcmp(button, last_button) == 0 &&
          mouse->time - last_click_time <= GetDoubleClickTime() &&
          dx <= GetSystemMetrics(SM_CXDOUBLECLK) / 2 &&
          dy <= GetSystemMetrics(SM_CYDOUBLECLK) / 2)
        ++click_count;
      else
        click_count = 1;
      last_button = button;
      last_click_time = mouse->time;
      last_click_point = mouse->pt;
      snprintf(fields, sizeof(fields),
        "\"type\":\"click\",\"button\":\"%s\",\"clicks\":%d,\"x\":%ld,\"y\":%ld",
        button, click_count, (long)mouse->pt.x, (long)mouse->pt.y);
      emit(fields);
    }
  }
  return CallNextHookEx(NULL, n, message, data);
}

static DWORD WINAPI watch_stdin(void *unused) {
  char buffer[64];
  DWORD read;
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  (void)unused;
  while (ReadFile(input, buffer, sizeof(buffer), &read, NULL) && read) {}
  PostThreadMessageW(main_thread, WM_QUIT, 0, 0);
  return 0;
}

static DWORD WINAPI watch_parent(void *unused) {
  HANDLE parent = OpenProcess(SYNCHRONIZE, FALSE, parent_pid);
  (void)unused;
  if (parent) {
    WaitForSingleObject(parent, INFINITE);
    CloseHandle(parent);
  }
  PostThreadMessageW(main_thread, WM_QUIT, 0, 0);
  return 0;
}

int main(int argc, char **argv) {
  int check = argc > 1 && strcmp(argv[1], "--check") == 0;
  int selftest = argc > 1 && strcmp(argv[1], "--selftest") == 0;
  char pid_text[32], status_line[192];
  MSG message;
  HANDLE thread;
  output = GetStdHandle(STD_OUTPUT_HANDLE);
  QueryPerformanceFrequency(&frequency);
  QueryPerformanceCounter(&start_time);
  if (selftest) {
    emit("\"type\":\"click\",\"button\":\"left\",\"clicks\":2,\"x\":-120,\"y\":80");
    emit("\"type\":\"scroll\"");
    emit_key('S', 1, 0, 0, 0);
    emit_key('E', 0, 0, 0, 0);
    emit_key('E', 1, 1, 0, 0);
    emit_key(VK_RETURN, 0, 0, 0, 0);
    return 0;
  }
  // Low-level hooks are confined to this desktop; failure is reported instead
  // of silently claiming a complete recording.
  mouse_hook = SetWindowsHookExW(WH_MOUSE_LL, mouse_callback, GetModuleHandleW(NULL), 0);
  keyboard_hook = SetWindowsHookExW(WH_KEYBOARD_LL, keyboard_callback, GetModuleHandleW(NULL), 0);
  snprintf(status_line, sizeof(status_line),
    "\"type\":\"status\",\"pointer\":%s,\"keyboard\":%s",
    mouse_hook ? "true" : "false", keyboard_hook ? "true" : "false");
  emit(status_line);
  if (check || (!mouse_hook && !keyboard_hook)) goto done;
  if (!GetEnvironmentVariableA("FR_PARENT_PID", pid_text, sizeof(pid_text))) goto done;
  parent_pid = strtoul(pid_text, NULL, 10);
  if (!parent_pid) goto done;
  main_thread = GetCurrentThreadId();
  PeekMessageW(&message, NULL, WM_USER, WM_USER, PM_NOREMOVE);
  thread = CreateThread(NULL, 0, watch_parent, NULL, 0, NULL);
  if (!thread) goto done;
  CloseHandle(thread);
  thread = CreateThread(NULL, 0, watch_stdin, NULL, 0, NULL);
  if (!thread) goto done;
  CloseHandle(thread);
  while (GetMessageW(&message, NULL, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
done:
  if (mouse_hook) UnhookWindowsHookEx(mouse_hook);
  if (keyboard_hook) UnhookWindowsHookEx(keyboard_hook);
  return 0;
}
