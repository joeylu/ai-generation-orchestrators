import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readTemplate } from '../src/templates/contract.mjs';
import { buildTemplates, templateStatus, defaultConfig, defaultOutput, hash } from '../src/templates/build.mjs';

export async function main(args = process.argv.slice(2)) {
  try {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
      config: { type: 'string' }, out: { type: 'string' }, browser: { type: 'string', default: 'chromium' }, help: { type: 'boolean' },
    } });
    if (values.help) {
      console.log('node scripts/templates.mjs validate|build|status [--config path] [--out path] [--browser chromium|chrome|msedge]');
      return;
    }
    if (positionals.length !== 1 || !['validate','build','status'].includes(positionals[0])) throw new Error('usage');
    const options = { config: values.config ? resolve(values.config) : defaultConfig, output: values.out ? resolve(values.out) : defaultOutput, channel: values.browser };
    let result;
    if (positionals[0] === 'validate') {
      const { spec, bytes } = await readTemplate(options.config);
      result = { status: 'valid-draft', templateVersion: spec.version, revision: spec.revision,
        sheetCount: spec.sheets.length, partCount: spec.sheets.reduce((n,s) => n+s.parts.length,0), sourceSha256: hash(bytes) };
    } else if (positionals[0] === 'build') result = await buildTemplates(options);
    else result = await templateStatus(options);
    console.log(JSON.stringify(result,null,2));
    if (!['valid-draft','built','current'].includes(result.status)) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: 'failed', issues: error.issues ?? [{ path: '/', code: error.code ?? 'command.failed', message: '命令参数、输入文件或运行环境有误；使用 --help 查看参数，依赖安装方法见 README。' }] },null,2));
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
