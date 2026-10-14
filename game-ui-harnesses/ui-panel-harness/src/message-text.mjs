import {literalReadOnlyLabelPairs} from './literal-text-labels.mjs';

/** An explicit recipe choice; never guesses visibility from label words. */
export function isMessageText(row,catalog){
  return row.kind==='text'&&(catalog?.recipes?.some(recipe=>recipe.kind==='text-row'&&recipe.id===row.recipe?.id&&recipe.version===row.recipe?.version&&recipe.labelDisplay==='hidden')??false);
}

/** Native interpretation cannot hide a definite user-specified read-only label. */
export function nativeMessageLabelMismatch(context,body){
  const pairs=literalReadOnlyLabelPairs(context.request.text);if(!pairs.length)return null;
  const visit=(node,path)=>{
    if(node.kind==='tabs'){
      for(const [i,page] of node.pages.entries()){const found=visit(page.body,`${path}.pages[${i}].body`);if(found)return found;}
    }else if(node.kind==='section'){
      for(const [i,row] of node.rows.entries()){
        if(row.kind!=='text'||!pairs.some(pair=>pair.label===row.label&&pair.text===row.text))continue;
        if(context.catalog.recipes.some(recipe=>`${recipe.id}@${recipe.version}`===row.recipeKey&&recipe.labelDisplay==='hidden'))return `${path}.rows[${i}].recipeKey`;
      }
    }else for(const [i,child] of node.children.entries()){const found=visit(child,`${path}.children[${i}]`);if(found)return found;}
    return null;
  };
  return visit(body,'$.panel.body');
}
