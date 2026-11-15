export const environmentLibraryRoles = Object.freeze(['foreground', 'environment', 'middle', 'far', 'background']);

const renderingDirections = Object.freeze({
  foreground: 'Draw this as a near-camera foreground element, with clearly readable edges and detail appropriate to the project style.',
  middle: 'Draw this as a middle-distance scenery element, with clear major forms and restrained fine detail.',
  far: 'Draw this as a distant scenery element, with simplified masses, subdued detail and depth consistent with the project style.',
  background: 'Draw this as one isolated element of the deepest background, with broad quiet shapes that sit behind the scene and transparent open space around it.',
});

export const environmentLibraryRenderingDirection = role => renderingDirections[role];
