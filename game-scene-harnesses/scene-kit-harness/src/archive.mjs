import { crc32 } from './png.mjs';
import { portablePath } from './files.mjs';
import { demand } from './errors.mjs';

// Bounded ZIP32, stored entries, fixed 1980 date, no executable attributes or
// path extraction. PKWARE APPNOTE 6.3.10 sections 4.3.7, 4.3.12 and 4.3.16.
export function storeArchive(files) {
  demand(files instanceof Map && files.size > 0 && files.size <= 8192, 'ARCHIVE_LIMIT', 'archive', '/', 'Archive entry budget exceeded');
  const local = [], central = []; let offset = 0, centralBytes = 0;
  for (const [path, bytes] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    demand(portablePath(path) && path.length <= 1024 && Buffer.isBuffer(bytes), 'ARCHIVE_PATH', 'archive', '/', 'Only portable byte-buffer entries are supported');
    const name = Buffer.from(path), crc = crc32(bytes), header = Buffer.alloc(30), entry = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(bytes.length, 20); entry.writeUInt32LE(bytes.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    local.push(header, name, bytes); central.push(entry, name); offset += header.length + name.length + bytes.length; centralBytes += entry.length + name.length;
    demand(offset + centralBytes + 22 <= 268435456, 'ARCHIVE_LIMIT', 'archive', '/', 'Archive exceeds the 256 MiB budget');
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(centralBytes, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

// Read the bounded stored ZIP32 format emitted above; never extract a path here.
export function readStoredArchive(bytes,{maxBytes=134217728,maxEntries=8192}={}){
  const check=(ok,code='ARCHIVE_INVALID')=>demand(ok,code,'archive','/','Unsupported or corrupt portable archive');
  check(Buffer.isBuffer(bytes)&&bytes.length>=22&&bytes.length<=maxBytes,'ARCHIVE_LIMIT');
  const end=bytes.length-22;check(bytes.readUInt32LE(end)===0x06054b50&&bytes.readUInt16LE(end+4)===0&&bytes.readUInt16LE(end+6)===0&&bytes.readUInt16LE(end+20)===0);
  const count=bytes.readUInt16LE(end+10),start=bytes.readUInt32LE(end+16),size=bytes.readUInt32LE(end+12);
  check(count>0&&count<=maxEntries&&count===bytes.readUInt16LE(end+8)&&start+size===end,'ARCHIVE_LIMIT');
  const files=new Map(),folded=new Set();let cursor=start,local=0;
  for(let i=0;i<count;i++){
    check(cursor+46<=end&&bytes.readUInt32LE(cursor)===0x02014b50);
    const length=bytes.readUInt16LE(cursor+28),bodySize=bytes.readUInt32LE(cursor+24),offset=bytes.readUInt32LE(cursor+42),crc=bytes.readUInt32LE(cursor+16);
    check(bytes.readUInt16LE(cursor+8)===0&&bytes.readUInt16LE(cursor+10)===0&&bytes.readUInt32LE(cursor+20)===bodySize&&bytes.readUInt16LE(cursor+30)===0&&bytes.readUInt16LE(cursor+32)===0&&bytes.readUInt16LE(cursor+34)===0&&bytes.readUInt32LE(cursor+38)===0);
    check(length>0&&length<=1024&&cursor+46+length<=end);
    const nameBytes=bytes.subarray(cursor+46,cursor+46+length),name=nameBytes.toString('utf8');
    check(portablePath(name)&&Buffer.from(name).equals(nameBytes)&&!folded.has(name.toLowerCase())&&name.split('/').every(part=>!/[. ]$/.test(part)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)),'ARCHIVE_PATH');
    check(offset===local&&offset+30+length+bodySize<=start&&bytes.readUInt32LE(offset)===0x04034b50);
    check(bytes.readUInt16LE(offset+6)===0&&bytes.readUInt16LE(offset+8)===0&&bytes.readUInt32LE(offset+14)===crc&&bytes.readUInt32LE(offset+18)===bodySize&&bytes.readUInt32LE(offset+22)===bodySize&&bytes.readUInt16LE(offset+26)===length&&bytes.readUInt16LE(offset+28)===0&&bytes.subarray(offset+30,offset+30+length).equals(nameBytes));
    const body=bytes.subarray(offset+30+length,offset+30+length+bodySize);check(crc32(body)===crc,'ARCHIVE_CHECKSUM');
    files.set(name,Buffer.from(body));folded.add(name.toLowerCase());local=offset+30+length+bodySize;cursor+=46+length;
  }
  check(cursor===end&&local===start);
  for(const name of folded){const parts=name.split('/');for(let i=1;i<parts.length;i++)check(!folded.has(parts.slice(0,i).join('/')),'ARCHIVE_PATH');}
  return files;
}
