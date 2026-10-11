import { spawn } from "node:child_process";

/** Private stdio connection to the installed CLI; never opens a listener. */
export class CodexRpc {
  constructor(executable, args, { cwd, onNotification = () => {} } = {}) {
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.onNotification = onNotification;
    this.child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "";
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 96 * 1024 * 1024)
        return this.fail(new Error("CODEX_PROTOCOL_TOO_LARGE"));
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          this.message(JSON.parse(line));
        } catch {
          this.fail(new Error("CODEX_PROTOCOL_INVALID"));
        }
      }
    });
    // CLI diagnostics can contain account data or local paths. Do not publish them.
    this.child.stderr.resume();
    this.child.stdin.on("error", () => {});
    this.child.on("error", () => this.fail(new Error("CODEX_CLI_UNAVAILABLE")));
    this.child.on("close", () => this.fail(new Error("CODEX_CLI_CLOSED")));
  }
  message(message) {
    if (message.method && message.id !== undefined) {
      // This adapter never grants shell/network/tool approvals on a user's behalf.
      this.send({
        id: message.id,
        error: { code: -32601, message: "Interactive action unavailable" },
      });
    } else if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        const error = new Error("CODEX_REQUEST_FAILED");
        error.rpcMethod = pending.method;
        error.rpcCode = Number.isInteger(message.error.code)
          ? message.error.code
          : null;
        pending.reject(error);
      } else pending.resolve(message.result);
    } else if (message.method) this.onNotification(message);
  }
  send(message) {
    if (!this.closed) this.child.stdin.write(JSON.stringify(message) + "\n");
  }
  request(method, params, timeoutMs = 30000) {
    if (this.closed) return Promise.reject(new Error("CODEX_CLI_CLOSED"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("CODEX_REQUEST_TIMEOUT"));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.send({ id, method, params });
    });
  }
  async initialize() {
    await this.request("initialize", {
      clientInfo: { name: "ui_reference_local_adapter", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: "initialized" });
  }
  fail(error) {
    if (this.closed) return;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.onNotification({ method: "adapter/closed", params: {} });
    this.close();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("CODEX_CLI_CLOSED"));
    }
    this.pending.clear();
    this.child.stdin.end();
    this.child.kill();
  }
}
