/** An explicit catalog profile, never inferred from words or applied to saved legacy themes. */
export const isReadableGameTheme = theme => ['game-readable-v1','game-readable-v2','game-readable-v3','game-readable-v4','game-readable-v5'].includes(theme?.draftSizing);
export const isReadableGameLayoutTheme = theme => ['game-readable-v2','game-readable-v3','game-readable-v4','game-readable-v5'].includes(theme?.draftSizing);
export const readableThemeForSpec = (spec,catalog) => isReadableGameTheme(catalog?.themes.find(theme=>theme.id===spec.theme.id&&theme.version===spec.theme.version));
export const readableRadioHeight = readable => readable ? 64 : 36;

export const hasWrappedGameChoices = theme => ['game-readable-v3','game-readable-v4','game-readable-v5'].includes(theme?.draftSizing);
