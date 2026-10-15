import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { readContracts } from "../src/contracts/validate.mjs";
import {
  buildContracts,
  contractStatus,
  defaults,
} from "../src/contracts/build.mjs";
import { dependencyEvidence } from "../src/contracts/dependencies.mjs";

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      registry: { type: "string" },
      usage: { type: "string" },
      template: { type: "string" },
      out: { type: "string" },
      "require-ready": { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help)
    console.log(
      "node scripts/contracts.mjs validate|build|status [--registry path] [--usage path] [--template path] [--out path] [--require-ready (validate only)]",
    );
  else {
    if (
      positionals.length !== 1 ||
      !["validate", "build", "status"].includes(positionals[0]) ||
      (values["require-ready"] && positionals[0] !== "validate")
    )
      throw Error("usage");
    const options = { ...defaults };
    for (const k of ["registry", "usage", "template"])
      if (values[k]) options[k] = resolve(values[k]);
    if (values.out) options.output = resolve(values.out);
    let result;
    if (positionals[0] === "build") result = await buildContracts(options);
    else if (positionals[0] === "status")
      result = await contractStatus(options);
    else {
      const inputs = await readContracts(options),
        dependencies = await dependencyEvidence();
      result = {
        status: values["require-ready"] ? "not-ready" : "valid-draft",
        componentTypeCount: new Set(inputs.registry.recipes.map((r) => r.type))
          .size,
        recipeCount: inputs.registry.recipes.length,
        productionReady: false,
        blockerCount: inputs.blockers.length,
        dependencies: dependencies.packages.map(({ name, version }) => ({
          name,
          version,
        })),
        blockers: inputs.blockers,
      };
    }
    console.log(JSON.stringify(result, null, 2));
    if (!["valid-draft", "built-draft", "current"].includes(result.status))
      process.exitCode = 1;
  }
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status: "failed",
        issues: error.issues ?? [
          {
            path: "/",
            code: "command.failed",
            message: "命令参数或环境有误；使用 --help 查看参数。",
          },
        ],
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
