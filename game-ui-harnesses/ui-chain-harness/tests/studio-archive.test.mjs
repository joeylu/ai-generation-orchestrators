import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveFiles} from '../src/studio/archive.mjs';
test('ZIP keeps UTF-8 paths, bytes, CRC and central offsets for complete offline delivery',()=>{
 const files=new Map([['中文/asset.bin',Buffer.from('123456789')],['empty.json',Buffer.alloc(0)]]),zip=archiveFiles(files);
 let offset=0;
 for(const [name,bytes]of files){
  assert.equal(zip.readUInt32LE(offset),0x04034b50);assert.equal(zip.readUInt16LE(offset+6),0x800);
  const size=zip.readUInt32LE(offset+18),n=zip.readUInt16LE(offset+26);
  assert.equal(zip.subarray(offset+30,offset+30+n).toString(),name);
  assert.deepEqual(zip.subarray(offset+30+n,offset+30+n+size),bytes);
  if(bytes.length)assert.equal(zip.readUInt32LE(offset+14),0xcbf43926);
  offset+=30+n+size;
 }
 const end=zip.length-22;assert.equal(zip.readUInt32LE(end),0x06054b50);assert.equal(zip.readUInt16LE(end+10),2);assert.equal(zip.readUInt32LE(end+16),offset);
 assert.equal(zip.readUInt32LE(offset),0x02014b50);assert.equal(zip.readUInt32LE(offset+42),0);
 assert.deepEqual(archiveFiles(files),zip);
});
test('ZIP rejects paths outside the delivery root',()=>{for(const path of ['../secret','/secret','a\\b'])assert.throws(()=>archiveFiles(new Map([[path,Buffer.alloc(0)]])),/ZIP_PATH/);});
