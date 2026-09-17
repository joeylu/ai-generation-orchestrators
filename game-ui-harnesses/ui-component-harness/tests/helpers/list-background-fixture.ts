import {compositeListFixture} from './list-item-contents-fixture.ts';
import {listTextHandoffFixture} from './list-text-fixture.ts';
export async function listBackgroundFixture(mode?:'own'|'parent') {
 const f=compositeListFixture(); (f.document.root as any).type='Panel';(f.document.root.props as any).title=''; if(!('children' in f.document.root))throw Error('fixture');
 const list=f.document.root.children.find(n=>n.type==='List')!;if(list.type!=='List')throw Error('fixture');
 list.props.rowGap=4; return listTextHandoffFixture(f.document,f.resources,mode);
}
