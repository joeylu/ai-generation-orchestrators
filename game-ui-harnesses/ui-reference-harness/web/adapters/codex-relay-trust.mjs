/** Trust only the two adapter-owned definitions, for this invocation only. */
export function vettedRelayHooks(result, config, trusted = false) {
  if (
    !Array.isArray(result.data) ||
    result.data.length !== 1 ||
    result.data.some((item) => item.errors?.length)
  )
    throw new Error("CODEX_RELAY_GATE_UNAVAILABLE");
  const own = result.data
    .flatMap((item) => item.hooks)
    .filter((hook) => hook.source === "sessionFlags");
  if (own.length !== 2) throw new Error("CODEX_RELAY_GATE_UNAVAILABLE");
  const states = {};
  for (const [event, field] of [
    ["preToolUse", "hooks.PreToolUse"],
    ["postToolUse", "hooks.PostToolUse"],
  ]) {
    const expected = config[field][0].hooks[0],
      found = own.filter((hook) => hook.eventName === event);
    if (found.length !== 1) throw new Error("CODEX_RELAY_GATE_UNAVAILABLE");
    const hook = found[0];
    if (
      !hook.enabled ||
      hook.handlerType !== "command" ||
      hook.matcher !== null ||
      hook.command !==
        (process.platform === "win32"
          ? expected.command_windows
          : expected.command) ||
      typeof hook.key !== "string" ||
      !hook.key ||
      !/^sha256:[a-f0-9]{64}$/.test(hook.currentHash) ||
      (trusted && hook.trustStatus !== "trusted")
    )
      throw new Error("CODEX_RELAY_GATE_UNAVAILABLE");
    states[hook.key] = { enabled: true, trusted_hash: hook.currentHash };
  }
  return states;
}

export async function trustRelayHooks(config, cwd, rpcFactory, argsFor) {
  const list = async (launch) => {
    const rpc = rpcFactory(argsFor(launch), { cwd });
    try {
      await rpc.initialize();
      return await rpc.request("hooks/list", { cwds: [cwd] });
    } finally {
      rpc.close();
    }
  };
  const states = vettedRelayHooks(await list(config), config);
  const trusted = { ...config, "hooks.state": states };
  vettedRelayHooks(await list(trusted), trusted, true);
  return trusted;
}
