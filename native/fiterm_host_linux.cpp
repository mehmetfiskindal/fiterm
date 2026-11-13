#include "fiterm_host.h"
#include "fiterm_input.h"
#ifdef FITERM_SAILFISH
#include "sailfish_keyboard.h"
extern "C" int sailfish_display_rotation();
extern "C" void sailfish_display_set_rotation(int rotation);
#endif

#include <pty.h>
#include <utmp.h>
#include <termios.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <fcntl.h>
#include <unistd.h>
#include <signal.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cerrno>
#include <string>
#include <vector>
#include <memory>
#include <sstream>

#if __has_include("nlohmann/json.hpp")
#include "nlohmann/json.hpp"
#else
#include "vendor/nlohmann/json.hpp"
#endif

namespace {
using Json = nlohmann::json;

int gMasterFd = -1;
pid_t gChildPid = -1;
bool gIsAlive = false;
std::string gUtf8Carry;

// Number of trailing bytes forming an incomplete (but so far valid) UTF-8 sequence.
size_t utf8IncompleteTail(const std::string &s) {
  size_t n = s.size();
  for (size_t back = 1; back <= 3 && back <= n; ++back) {
    unsigned char c = static_cast<unsigned char>(s[n - back]);
    if ((c & 0xC0) == 0x80) continue;  // continuation byte, keep looking
    size_t need = (c & 0xE0) == 0xC0 ? 2 : (c & 0xF0) == 0xE0 ? 3 : (c & 0xF8) == 0xF0 ? 4 : 1;
    return need > back ? back : 0;
  }
  return 0;
}

// Simple, fast Base64 encoder for binary-safe ANSI and terminal output transmission
static const char kB64Chars[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string base64Encode(const unsigned char *data, size_t len) {
  std::string out;
  out.reserve(((len + 2) / 3) * 4);
  for (size_t i = 0; i < len; i += 3) {
    uint32_t b = (static_cast<uint32_t>(data[i]) << 16);
    if (i + 1 < len) b |= (static_cast<uint32_t>(data[i + 1]) << 8);
    if (i + 2 < len) b |= static_cast<uint32_t>(data[i + 2]);

    out.push_back(kB64Chars[(b >> 18) & 0x3f]);
    out.push_back(kB64Chars[(b >> 12) & 0x3f]);
    out.push_back((i + 1 < len) ? kB64Chars[(b >> 6) & 0x3f] : '=');
    out.push_back((i + 2 < len) ? kB64Chars[b & 0x3f] : '=');
  }
  return out;
}

std::vector<unsigned char> base64Decode(const std::string &in) {
  std::vector<unsigned char> out;
  if (in.empty()) return out;
  std::vector<int> T(256, -1);
  for (int i = 0; i < 64; i++) T[kB64Chars[i]] = i;

  int val = 0, valb = -8;
  for (unsigned char c : in) {
    if (T[c] == -1) break;
    val = (val << 6) + T[c];
    valb += 6;
    if (valb >= 0) {
      out.push_back(static_cast<unsigned char>((val >> valb) & 0xff));
      valb -= 8;
    }
  }
  return out;
}

void ptyCloseInternal() {
  if (gMasterFd >= 0) {
    close(gMasterFd);
    gMasterFd = -1;
  }
  if (gChildPid > 0) {
    kill(-gChildPid, SIGHUP);
    kill(gChildPid, SIGHUP);
    int status = 0;
    for (int i = 0; i < 5; ++i) {
      pid_t r = waitpid(gChildPid, &status, WNOHANG);
      if (r != 0) break;
      usleep(10000);
    }
    kill(-gChildPid, SIGKILL);
    kill(gChildPid, SIGKILL);
    waitpid(gChildPid, &status, WNOHANG);
    gChildPid = -1;
  }
  gUtf8Carry.clear();
  gIsAlive = false;
}

std::string jsonResponse(bool success, const Json &data = Json::object(), const std::string &error = "") {
  Json resp = {
    {"ok", success},
    {"data", data}
  };
  if (!error.empty()) {
    resp["error"] = error;
  }
  // Never throw on stray invalid bytes from the shell; replace them with U+FFFD.
  return resp.dump(-1, ' ', false, Json::error_handler_t::replace);
}
} // namespace

bool gFitermAppCursorKeys = false;

void fiterm_pty_write_raw(const char *data, std::size_t len) {
  static const bool trace = [] { const char *v = std::getenv("FITERM_TRACE"); return v && *v && *v != '0'; }();
  if (trace) std::fprintf(stderr, "[fiterm.trace] pty write %zu bytes (fd=%d alive=%d)\n", len, gMasterFd, gIsAlive ? 1 : 0);
  if (gMasterFd < 0 || !gIsAlive || !data || len == 0) return;
  while (len > 0) {
    ssize_t n = write(gMasterFd, data, len);
    if (n > 0) {
      data += n;
      len -= static_cast<std::size_t>(n);
    } else if (n < 0 && errno == EINTR) {
      continue;
    } else {
      break;  // EAGAIN on a full PTY buffer: drop the rest rather than block the UI
    }
  }
}

std::string fiterm_host_invoke(const std::string &method, const std::string &payload) {
  try {
    Json req = payload.empty() ? Json::object() : Json::parse(payload);

    if (method == "pty.spawn") {
      ptyCloseInternal();

      int rows = req.value("rows", 24);
      int cols = req.value("cols", 80);
      if (rows < 2) rows = 2;
      if (cols < 10) cols = 10;

      std::string cwd = req.value("cwd", "");
      if (cwd.empty()) {
        const char *h = std::getenv("HOME");
        cwd = h && *h ? h : "/home/defaultuser";
      }

      std::string shell = req.value("shell", "");
      if (shell.empty()) {
        const char *s = std::getenv("SHELL");
        if (s && *s && access(s, X_OK) == 0) {
          shell = s;
        } else if (access("/bin/bash", X_OK) == 0) {
          shell = "/bin/bash";
        } else {
          shell = "/bin/sh";
        }
      }

      struct winsize ws;
      std::memset(&ws, 0, sizeof(ws));
      ws.ws_row = static_cast<unsigned short>(rows);
      ws.ws_col = static_cast<unsigned short>(cols);

      pid_t pid = forkpty(&gMasterFd, nullptr, nullptr, &ws);
      if (pid < 0) {
        return jsonResponse(false, {}, std::string("forkpty failed: ") + std::strerror(errno));
      }

      if (pid == 0) {
        // Child process
        setsid();
        setenv("TERM", "xterm-256color", 1);
        setenv("COLORTERM", "truecolor", 1);
        setenv("LANG", "C.UTF-8", 1);
        setenv("LC_ALL", "C.UTF-8", 1);
        if (!cwd.empty()) {
          chdir(cwd.c_str());
        }

        const char *shellPath = shell.c_str();
        const char *arg0 = "-bash";
        if (shell.find("sh") != std::string::npos && shell.find("bash") == std::string::npos) {
          arg0 = "-sh";
        }
        execl(shellPath, arg0, "-l", nullptr);
        // Fallback
        execl("/bin/sh", "-sh", "-l", nullptr);
        _exit(127);
      }

      // Parent process
      gChildPid = pid;
      gIsAlive = true;
      gFitermAppCursorKeys = false;

      // Make master fd non-blocking
      int flags = fcntl(gMasterFd, F_GETFL, 0);
      if (flags >= 0) {
        fcntl(gMasterFd, F_SETFL, flags | O_NONBLOCK);
      }

      return jsonResponse(true, {
        {"pid", gChildPid},
        {"shell", shell},
        {"cwd", cwd},
        {"rows", rows},
        {"cols", cols}
      });
    }

    if (method == "pty.read") {
      if (gMasterFd < 0) {
        return jsonResponse(false, {}, "No active terminal process");
      }

      // Check if child process is still alive
      if (gIsAlive && gChildPid > 0) {
        int status = 0;
        pid_t res = waitpid(gChildPid, &status, WNOHANG);
        if (res == gChildPid || res < 0) {
          gIsAlive = false;
        }
      }

      unsigned char buf[16384];
      std::string accumulated;
      while (true) {
        ssize_t n = read(gMasterFd, buf, sizeof(buf));
        if (n > 0) {
          accumulated.append(reinterpret_cast<const char*>(buf), n);
          if (n < static_cast<ssize_t>(sizeof(buf))) {
            break;
          }
        } else {
          if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            // No more data right now
            break;
          }
          if (n == 0 || (n < 0 && errno == EIO)) {
            // EIO is returned on Linux when the slave pty is closed
            gIsAlive = false;
            break;
          }
          break;
        }
      }

      // A read can end mid UTF-8 sequence; hold the partial tail back for the
      // next read so the JSON "text" field stays valid UTF-8.
      accumulated.insert(0, gUtf8Carry);
      gUtf8Carry.clear();
      size_t keep = utf8IncompleteTail(accumulated);
      if (keep > 0) {
        gUtf8Carry = accumulated.substr(accumulated.size() - keep);
        accumulated.resize(accumulated.size() - keep);
      }

      {
        static const bool trace = [] { const char *v = std::getenv("FITERM_TRACE"); return v && *v && *v != '0'; }();
        if (trace && !accumulated.empty()) std::fprintf(stderr, "[fiterm.trace] pty read %zu bytes\n", accumulated.size());
      }
      std::string b64 = base64Encode(reinterpret_cast<const unsigned char*>(accumulated.data()), accumulated.size());
      return jsonResponse(true, {
        {"alive", gIsAlive},
        {"bytes", accumulated.size()},
        {"b64", b64},
        {"text", accumulated}
      });
    }

    if (method == "pty.write") {
      if (gMasterFd < 0 || !gIsAlive) {
        return jsonResponse(false, {}, "Terminal not running");
      }

      bool isB64 = req.value("isBase64", false);
      std::string data = req.value("data", "");
      ssize_t written = 0;

      if (isB64) {
        std::vector<unsigned char> decoded = base64Decode(data);
        if (!decoded.empty()) {
          written = write(gMasterFd, decoded.data(), decoded.size());
        }
      } else {
        if (!data.empty()) {
          written = write(gMasterFd, data.data(), data.size());
        }
      }

      return jsonResponse(true, {{"written", written}});
    }

    if (method == "pty.resize") {
      if (gMasterFd < 0) {
        return jsonResponse(false, {}, "Terminal not running");
      }
      int rows = req.value("rows", 24);
      int cols = req.value("cols", 80);
      if (rows < 2) rows = 2;
      if (cols < 10) cols = 10;

      struct winsize ws;
      std::memset(&ws, 0, sizeof(ws));
      ws.ws_row = static_cast<unsigned short>(rows);
      ws.ws_col = static_cast<unsigned short>(cols);

      int r = ioctl(gMasterFd, TIOCSWINSZ, &ws);
      if (gChildPid > 0) {
        kill(-gChildPid, SIGWINCH);
        kill(gChildPid, SIGWINCH);
      }

      return jsonResponse(r == 0, {{"rows", rows}, {"cols", cols}});
    }

    if (method == "pty.signal") {
      if (gChildPid <= 0 || !gIsAlive) {
        return jsonResponse(false, {}, "Terminal not running");
      }
      std::string sigStr = req.value("signal", "SIGINT");
      int sig = SIGINT;
      if (sigStr == "SIGTERM") sig = SIGTERM;
      else if (sigStr == "SIGKILL") sig = SIGKILL;
      else if (sigStr == "SIGTSTP") sig = SIGTSTP;
      else if (sigStr == "SIGQUIT") sig = SIGQUIT;
      else if (sigStr == "SIGHUP") sig = SIGHUP;

      kill(-gChildPid, sig);
      kill(gChildPid, sig);
      return jsonResponse(true, {{"signal", sigStr}});
    }

    if (method == "pty.close") {
      ptyCloseInternal();
      return jsonResponse(true);
    }

    if (method == "input.mode") {
      gFitermAppCursorKeys = req.value("appCursor", false);
      return jsonResponse(true);
    }

    if (method == "keyboard.toggle") {
#ifdef FITERM_SAILFISH
      sailfish_keyboard_toggle_forced();
#endif
      return jsonResponse(true);
    }

    if (method == "clipboard.set") {
      bool ok = false;
#ifdef FITERM_SAILFISH
      ok = fiterm_clipboard_set(req.value("text", "").c_str());
#endif
      return jsonResponse(ok);
    }

    if (method == "clipboard.paste") {
      bool ok = false;
#ifdef FITERM_SAILFISH
      ok = fiterm_clipboard_paste();
#endif
      return jsonResponse(ok);
    }

    if (method == "url.open") {
      const std::string url = req.value("url", "");
      if (url.rfind("http://", 0) != 0 && url.rfind("https://", 0) != 0) {
        return jsonResponse(false, {}, "Only http(s) URLs can be opened");
      }
      // Double fork so the browser launcher is never our zombie; no shell involved.
      pid_t pid = fork();
      if (pid == 0) {
        if (fork() == 0) {
          execlp("xdg-open", "xdg-open", url.c_str(), nullptr);
        }
        _exit(0);
      }
      if (pid > 0) waitpid(pid, nullptr, 0);
      return jsonResponse(pid > 0);
    }

    if (method == "display.rotate") {
      // Cycles portrait -> landscape -> inverted landscape -> portrait.
#ifdef FITERM_SAILFISH
      const int r = sailfish_display_rotation();
      sailfish_display_set_rotation(r == 0 ? 1 : r == 1 ? 3 : 0);
#endif
      return jsonResponse(true);
    }

    if (method == "platform.info") {
      const char *user = std::getenv("USER");
      const char *home = std::getenv("HOME");
      const char *shell = std::getenv("SHELL");
      return jsonResponse(true, {
        {"platform", "sailfish"},
        {"user", user ? user : "defaultuser"},
        {"home", home ? home : "/home/defaultuser"},
        {"shell", shell ? shell : "/bin/bash"},
        {"alive", gIsAlive}
      });
    }

    return jsonResponse(false, {}, "Unknown method: " + method);
  } catch (const Json::exception &e) {
    return jsonResponse(false, {}, std::string("JSON error: ") + e.what());
  } catch (const std::exception &e) {
    return jsonResponse(false, {}, std::string("Error: ") + e.what());
  }
}

#ifndef FITERM_HOST_STANDALONE
namespace {
std::string fiterm_host_thunk(void *, std::string method, std::string payload) {
  return fiterm_host_invoke(method, payload);
}
}
gea::CallableObject<std::string(std::string, std::string)> fitermHostInvoke{fiterm_host_thunk, nullptr};
#endif
