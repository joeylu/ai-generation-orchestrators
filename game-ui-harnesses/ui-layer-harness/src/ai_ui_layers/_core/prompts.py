def _prompt(asset: dict) -> str:
    fidelity = (' Treat the reference artwork as the reconstruction target, not permission to redesign. '
                'Preserve observed silhouettes, border weight, ornament shapes, colors and contrast. '
                'Do not add focal objects, decorative hardware, glow or details absent from the reference. '
                'Explicit ownership exclusions and declared output placement still apply. ')
    scoped = 'native-material-ownership-v1:' in asset['prompt']
    symbols = ('Preserve symbols only in their explicitly assigned layers; surface exclusions take precedence.'
               if scoped else 'Preserve only pictograms and graphic symbols explicitly owned by this material; explicit removal instructions take precedence. Do not restore excluded icons or controls as decoration.')
    width, height = asset["output_size"]
    # The explicit existing board marker denotes a complete cell inventory.
    # output_size is its preview support, not permission to recenter/resize cells.
    if asset['route']=='generated_isolation' and 'component-family-board-v1:' in asset['prompt']:
        backdrop=('a genuinely transparent RGBA background with real alpha; never a checkerboard'
                  if asset['output_mode']=='transparent_component' else 'a flat uniform vivid magenta #F808F8 background; no checkerboard, gradient or transparency simulation')
        layout=('Keep every part in its explicitly assigned relative search window. Preserve each part\'s aspect ratio; do not merge or reorder parts. '
                if 'component-family-relative-cell-v1' in asset['prompt'] else
                'Keep the explicitly declared raw canvas and every cell coordinate and size. Do not recenter, rescale, merge or reorder the individual parts. ')
        if 'component-family-content-gap-v1.1' in asset['prompt']:
            layout=('The planned canvas and windows are packing guidance, not exact pixel placement. '
                    'Use exactly one horizontal row in the declared order, with full outer margins. '
                    'Preserve each individual part aspect ratio. Separate whole components by wide uniform key-color gutters, '
                    'clearly larger than any tiny disconnected strokes within an icon. Do not join, omit, duplicate or reorder parts. ')
        return (asset['prompt'].strip()+fidelity+' Use each declared reference region as that part\'s visual target. '
                'Return exactly one complete material board on '+backdrop+'. '
                +layout+
                'No text, numerals, pseudo-text, labels, logos or watermarks; '+symbols)
    common = (f" Target support ratio is {width}:{height}. Use the full UI reference and exact "
              "crop as the visual reconstruction target. Do not draw text, numerals, pseudo-text, labels, logos, "
              "or watermarks. " + fidelity + symbols)
    if asset["route"] == "generated_completion":
        return (asset["prompt"].strip() + common + " Return one complete opaque UI-free scene."
                " Preserve visible background composition and brightness; complete only occluded regions"
                " with local surrounding texture. Do not invent a new central subject or relocate visible motifs.")
    if asset["output_mode"] == "transparent_component":
        return (asset["prompt"].strip() + common
                + " Return exactly one complete component centered on a genuinely transparent "
                  "background with an alpha channel. Leave clean transparent margin on every edge, "
                  "preserve internal holes and soft translucent edges, and do not draw a checkerboard, "
                  "ground, backdrop or cast shadow outside the component.")
    return (asset["prompt"].strip() + common
            + " Return exactly one complete component centered on a flat uniform vivid magenta "
              "#F808F8 background. Leave clean margin on every edge and preserve internal holes. Do not draw a checkerboard or transparency simulation.")
