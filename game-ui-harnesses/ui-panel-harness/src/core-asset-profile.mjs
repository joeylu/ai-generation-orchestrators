import { validateAssetBatch } from './asset-descriptor.mjs';

// An explicit, small selection from the owned library. Never infer a source by filename.
const profile = [
  ['play','继续游戏','icon.play','modern-mint/texture-47f17635587635a44cc213d4@0.1.0',['播放','开始','继续游戏','继续','resume','play']],
  ['pause','暂停','icon.pause','modern-mint/texture-126709bd7121380bde5ec315@0.1.0',['暂停','pause']],
  ['settings','设置','icon.settings','modern-mint/texture-b2b14cf1ba03336bb4be0b03@0.1.0',['设置','偏好','配置','settings']],
  ['back','返回','icon.arrow-simple-left','modern-mint/texture-a0a536d4792364606fa82bc1@0.1.0',['返回','后退','back']],
  ['home','主菜单','icon.home','modern-mint/texture-bbe2caa6e3e257cc5c348205@0.1.0',['主菜单','主页','首页','home']],
  ['volume','音量','icon.speaker','modern-mint/texture-ad2392a3924b99c50f8c88cb@0.1.0',['主音量','音量','声音','扬声器','volume','speaker']],
  ['music','音乐','icon.music','modern-mint/texture-51279d9e850196e5e0f814d9@0.1.0',['音乐','背景音乐','music']],
  ['mute','静音','audio.mute','game-ui/mute@1.0.0',['静音','关闭声音','mute']],
  ['user','角色','icon.user','modern-mint/texture-f1dcfbb8a91bcc3ca9171131@0.1.0',['角色','角色名','命名','用户','账户','user']],
  ['confirm','确认','icon.check','modern-mint/texture-26b9a563df457bd04723f990@0.1.0',['确认','完成','勾选','confirm','check']],
  ['close','取消','icon.close','modern-mint/texture-1384615d72ad6f91258df733@0.1.0',['取消','关闭','close','cancel']],
  ['reset','恢复默认','icon.refresh','modern-mint/texture-485aecab3531403fab964013@0.1.0',['恢复默认','重置','刷新','reset','refresh']],
];

/** Requires a fully verified index. This function chooses metadata, never authenticates pixels. */
export function createCoreAssetBatch(index) {
  const records = new Map(index.records.map(record => [record.key, record]));
  const selections = profile.map(([id, name, family, sourceKey, tags]) => {
    const record = records.get(sourceKey);
    if (!record || record.metadata.role !== 'icon' || record.metadata.family !== family
      || !['default','outline'].includes(record.metadata.variant) || record.metadata.slice !== null) {
      throw new Error('CORE_ASSET_SOURCE_MISMATCH');
    }
    return { sourceKey, sourceSha256: record.source.file.sha256, pngSha256: record.file.sha256,
      asset: { id, version:'1.0.0', file:`${id}.${record.source.format}`, name, role:'icon', family,
        style:'modern-core', variant:record.metadata.variant, tags, size:record.metadata.size, slice:null } };
  });
  const batch = validateAssetBatch({assetBatchVersion:'0.1',namespace:'panel-core',assets:selections.map(s=>s.asset)});
  return {profileVersion:'0.1',batch,selections};
}
