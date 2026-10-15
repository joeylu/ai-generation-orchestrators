import {Graphics} from 'pixi.js';
import {inventoryIcons} from './inventory-policy.mjs';

// Deliberate programmatic examples. No skin texture is cropped into an item,
// and no icon claims to be game art supplied by the user.
export function inventoryExampleIcon(kind,size){
  if(!inventoryIcons.includes(kind))throw Object.assign(new Error('未知程序示例物品图标。'),{code:'inventory.icon'});
  const g=new Graphics(),line={color:0xffffff,width:1.2,alpha:.8};
  if(kind==='gem')g.poly([16,1,29,11,24,28,8,28,3,11]).fill(0x5adbf5).stroke(line).moveTo(3,11).lineTo(29,11).moveTo(9,2).lineTo(16,28).lineTo(23,2).stroke({color:0xffffff,width:1,alpha:.5});
  if(kind==='potion')g.roundRect(11,2,10,6,2).fill(0xd3af7d).roundRect(12,7,8,6,1).fill(0xd8efff).roundRect(6,12,20,18,6).fill(0xe45b9d).stroke(line).roundRect(10,16,3,8,1).fill({color:0xffffff,alpha:.6});
  if(kind==='coin')g.circle(16,16,14).fill(0xf2bf47).stroke(line).circle(16,16,10).stroke({color:0x925d1b,width:2}).moveTo(16,9).lineTo(16,23).stroke({color:0x925d1b,width:3});
  if(kind==='material')g.poly([2,18,10,7,17,12,24,3,30,20,19,29,7,28]).fill(0xb4a78e).stroke(line).moveTo(10,7).lineTo(12,22).lineTo(24,3).moveTo(12,22).lineTo(19,29).stroke({color:0x675e55,width:1.5});
  if(kind==='scroll')g.roundRect(7,4,20,24,2).fill(0xf3deb0).stroke(line).roundRect(3,3,7,7,2).fill(0xc79152).roundRect(22,23,7,7,2).fill(0xc79152).moveTo(12,11).lineTo(23,11).moveTo(12,16).lineTo(23,16).moveTo(12,21).lineTo(19,21).stroke({color:0x946b3d,width:1.5});
  if(kind==='sword')g.poly([25,2,30,2,29,9,13,24,8,19]).fill(0xd3ebf2).stroke(line).poly([5,16,17,28,13,31,2,20]).fill(0xf2bf47).poly([5,23,10,28,6,32,1,27]).fill(0x9b6150);
  if(kind==='shield')g.poly([16,1,29,6,27,21,22,27,16,31,10,27,5,21,3,6]).fill(0x65a2dd).stroke(line).poly([16,5,24,9,23,20,16,26,9,20,8,9]).fill(0xa5c7df).moveTo(16,6).lineTo(16,26).stroke({color:0xffffff,width:2,alpha:.6});
  if(kind==='food')g.circle(12,19,10).fill(0xe96c48).circle(21,19,10).fill(0xec854b).poly([16,9,17,2,22,1,20,7]).fill(0x76bf5c).roundRect(8,15,3,7,1).fill({color:0xffffff,alpha:.5});
  g.scale.set(size/32);g.eventMode='none';g.label='inventory-example-'+kind;
  return g;
}
