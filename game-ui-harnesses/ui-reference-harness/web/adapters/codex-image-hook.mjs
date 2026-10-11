import * as fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const imageTool = (name) =>
  [
    "image_gen.imagegen",
    "image_gen__imagegen",
    "image_genimagegen",
    "imagegen",
  ].includes(name);
const deny = (reason) => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: reason,
  },
});

/** An atomic claim, rather than a prompt instruction, limits image calls. */
export function imageHook(job, input) {
  if (input.hook_event_name === "PostToolUse")
    return imageTool(input.tool_name)
      ? { continue: false, stopReason: "The single image attempt has ended." }
      : {};
  if (input.hook_event_name !== "PreToolUse") return deny("Unknown event.");
  if (!imageTool(input.tool_name))
    return deny("Only the image tool is allowed.");
  try {
    const frozen = JSON.parse(fs.readFileSync(path.join(job, "input.json")));
    if (!/^[a-f0-9]{64}$/.test(frozen.requestSha256))
      return deny("Invalid frozen request.");
    for (const image of frozen.images) {
      if (
        path.dirname(image.path) !== path.resolve(job) ||
        hash(fs.readFileSync(image.path)) !== image.sha256
      )
        return deny("Reference fingerprint changed.");
    }
    const updatedInput = {
      prompt: frozen.prompt,
      transparent_background: false,
      ...(frozen.images.length
        ? { referenced_image_paths: frozen.images.map((image) => image.path) }
        : {}),
    };
    fs.writeFileSync(
      path.join(job, "image-call.json"),
      JSON.stringify({
        requestSha256: frozen.requestSha256,
        toolUseId: input.tool_use_id,
        toolName: input.tool_name,
        inputSha256: hash(Buffer.from(JSON.stringify(updatedInput))),
      }),
      { flag: "wx" },
    );
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput,
      },
    };
  } catch {
    return deny("The image request is already claimed or cannot be verified.");
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (hash(fs.readFileSync(process.argv[1])) !== process.argv[2])
      throw new Error("HOOK_CHANGED");
    process.stdout.write(JSON.stringify(imageHook(input.cwd, input)));
  } catch {
    process.stdout.write(JSON.stringify(deny("Image gate unavailable.")));
  }
}
